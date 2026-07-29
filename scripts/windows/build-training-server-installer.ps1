[CmdletBinding()]
param(
    [string]$PythonVersion = "3.11.9",
    [string]$PythonSha256 = "5ee42c4eee1e6b4464bb23722f90b45303f79442df63083f05322f1785f5fdde"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$installerRoot = Join-Path $repoRoot "packaging\windows\training-server"
$vendorRoot = Join-Path $installerRoot "vendor"
$pythonInstaller = Join-Path $vendorRoot "python-$PythonVersion-amd64.exe"
$innoScript = Join-Path $installerRoot "TomeTrainingServer.iss"

foreach ($scriptPath in @(
    (Join-Path $PSScriptRoot "install-packaged-training-manager.ps1"),
    (Join-Path $PSScriptRoot "uninstall-packaged-training-manager.ps1")
)) {
    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile(
        $scriptPath,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if ($parseErrors.Count -gt 0) {
        $messages = ($parseErrors | ForEach-Object { $_.Message }) -join "; "
        throw "PowerShell validation failed for $scriptPath`: $messages"
    }
}

if (-not (Get-Command "cargo" -ErrorAction SilentlyContinue)) {
    throw "Required build command 'cargo' was not found in PATH."
}

$isccCommand = Get-Command "iscc" -ErrorAction SilentlyContinue
if ($null -ne $isccCommand) {
    $isccPath = $isccCommand.Source
}
else {
    $innoCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
    )
    if (${env:ProgramFiles(x86)}) {
        $innoCandidates += Join-Path `
            ${env:ProgramFiles(x86)} `
            "Inno Setup 6\ISCC.exe"
    }
    if ($env:ProgramFiles) {
        $innoCandidates += Join-Path `
            $env:ProgramFiles `
            "Inno Setup 6\ISCC.exe"
    }
    $isccPath = $innoCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}
if (-not $isccPath) {
    throw "Inno Setup 6 was not found. Install it with: winget install --id JRSoftware.InnoSetup --exact"
}

Push-Location $repoRoot
try {
    & cargo build --release -p tome-training-manager
    if ($LASTEXITCODE -ne 0) {
        throw "The Windows Training Manager build failed."
    }

    $metadata = & cargo metadata --format-version 1 --no-deps | ConvertFrom-Json
    $version = (
        $metadata.packages |
            Where-Object { $_.name -eq "tome-training-manager" } |
            Select-Object -First 1
    ).version
    if (-not $version) {
        throw "Could not determine the Training Manager version."
    }

    New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
    if (-not (Test-Path -LiteralPath $pythonInstaller)) {
        $pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
        Write-Host "Downloading the bundled Python runtime from $pythonUrl"
        Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstaller
    }
    $actualPythonSha256 = (
        Get-FileHash -LiteralPath $pythonInstaller -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($actualPythonSha256 -ne $PythonSha256.ToLowerInvariant()) {
        throw "The Python runtime checksum did not match the pinned release. Expected $PythonSha256 but received $actualPythonSha256."
    }

    & $isccPath "/DAppVersion=$version" "/DPythonVersion=$PythonVersion" $innoScript
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup failed to create the installer."
    }
}
finally {
    Pop-Location
}

Write-Host "Installer created in target\release\bundle\windows-training-server."
