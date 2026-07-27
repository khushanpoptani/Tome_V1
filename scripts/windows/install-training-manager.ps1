[CmdletBinding()]
param(
    [string]$InstallRoot = "$env:ProgramData\Tome\TrainingManager",
    [string]$TorchIndexUrl = "",
    [switch]$SkipPythonDependencies
)

$ErrorActionPreference = "Stop"
$serviceName = "TomeTrainingManager"
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$binarySource = Join-Path $sourceRoot "target\release\tome-training-manager.exe"
$binaryTarget = Join-Path $InstallRoot "tome-training-manager.exe"
$configPath = Join-Path $InstallRoot "config.json"
$workerRoot = Join-Path $InstallRoot "workers"
$venvRoot = Join-Path $InstallRoot "venv"
$pythonTarget = Join-Path $venvRoot "Scripts\python.exe"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this installer from an elevated PowerShell session."
}

foreach ($command in @("cargo", "py", "ollama")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found in PATH."
    }
}

Push-Location $sourceRoot
try {
    & cargo build --release -p tome-training-manager
    if ($LASTEXITCODE -ne 0) {
        throw "The Training Manager Rust build failed."
    }
}
finally {
    Pop-Location
}

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $existingService -and $existingService.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force
    $existingService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $workerRoot | Out-Null
Copy-Item -Force $binarySource $binaryTarget
Copy-Item -Force (Join-Path $sourceRoot "services\training-manager\workers\train.py") $workerRoot
Copy-Item -Force (Join-Path $sourceRoot "services\training-manager\workers\requirements.txt") $workerRoot

$createdConfig = -not (Test-Path $configPath)
if ($createdConfig) {
    & $binaryTarget --write-default-config $configPath
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the default Training Manager configuration."
    }
}

if (-not $SkipPythonDependencies) {
    if (-not (Test-Path $pythonTarget)) {
        & py -3 -m venv $venvRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create the Python virtual environment."
        }
    }
    & $pythonTarget -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        throw "Could not update pip."
    }
    if ($TorchIndexUrl) {
        & $pythonTarget -m pip install torch --index-url $TorchIndexUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Could not install PyTorch from $TorchIndexUrl."
        }
    }
    & $pythonTarget -m pip install -r (Join-Path $workerRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install the training worker dependencies."
    }
    & $pythonTarget (Join-Path $workerRoot "train.py") --probe
    if ($LASTEXITCODE -ne 0) {
        throw "The Python training worker dependency probe failed."
    }
}

if ($createdConfig) {
    $config = Get-Content -Raw $configPath | ConvertFrom-Json
    $config.dataDir = $InstallRoot
    $config.ollamaExecutable = (Get-Command ollama).Source
    $config.pythonExecutable = $pythonTarget
    $config.workerScript = Join-Path $workerRoot "train.py"
    $configJson = $config | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText(
        $configPath,
        $configJson,
        [Text.UTF8Encoding]::new($false)
    )
}

if ($null -eq $existingService) {
    $serviceBinaryPath = "`"$binaryTarget`" --service"
    & sc.exe create $serviceName "binPath= $serviceBinaryPath" "start= auto" `
        "DisplayName= Tome Training Manager"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not register the Windows service."
    }
    & sc.exe description $serviceName `
        "Receives Tome datasets, manages external AI training jobs, and registers completed models with Ollama."
    if ($LASTEXITCODE -ne 0) {
        throw "Could not set the Windows service description."
    }
}

$firewallName = "Tome Training Manager (TCP 11435)"
if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 11435 -Profile Private | Out-Null
}

Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

$health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:11435/v1/health" `
    -TimeoutSec 15
Write-Host "Tome Training Manager installed and running."
Write-Host "Health: $($health.status); protocol: $($health.protocol); Ollama: $($health.ollamaReachable)"
Write-Host "Configure Tome with http://$(hostname):11435 or this server's LAN IP."
