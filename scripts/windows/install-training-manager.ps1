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

function Get-InstalledTrainingManagerProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $normalizedTarget = [IO.Path]::GetFullPath($TargetPath)
    return @(
        Get-CimInstance Win32_Process `
            -Filter "Name = 'tome-training-manager.exe'" `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ExecutablePath -and
                [string]::Equals(
                    [IO.Path]::GetFullPath($_.ExecutablePath),
                    $normalizedTarget,
                    [StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

function Stop-InstalledTrainingManager {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [int]$KnownProcessId = 0
    )

    if ($KnownProcessId -gt 0) {
        $normalizedTarget = [IO.Path]::GetFullPath($TargetPath)
        $knownProcess = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $KnownProcessId" `
            -ErrorAction SilentlyContinue
        $isInstalledProcess = (
            $null -ne $knownProcess -and
            $knownProcess.ExecutablePath -and
            [string]::Equals(
                [IO.Path]::GetFullPath($knownProcess.ExecutablePath),
                $normalizedTarget,
                [StringComparison]::OrdinalIgnoreCase
            )
        )
        if ($isInstalledProcess) {
            Write-Host "Stopping Training Manager service process $KnownProcessId..."
            Stop-Process -Id $KnownProcessId -Force -ErrorAction SilentlyContinue
        }
    }

    foreach ($process in @(Get-InstalledTrainingManagerProcesses -TargetPath $TargetPath)) {
        Write-Host "Stopping stale installed Training Manager process $($process.ProcessId)..."
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $runningProcesses = @(Get-InstalledTrainingManagerProcesses -TargetPath $TargetPath)
    while ($runningProcesses.Count -gt 0) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "The installed Training Manager process did not exit within 30 seconds."
        }
        Start-Sleep -Milliseconds 250
        $runningProcesses = @(Get-InstalledTrainingManagerProcesses -TargetPath $TargetPath)
    }
}

function Copy-FileWithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination,
        [int]$Attempts = 20
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -eq $Attempts) {
                throw "Could not replace '$Destination' after $Attempts attempts. $($_.Exception.Message)"
            }

            Write-Host "Installed executable is still busy; retrying copy ($attempt/$Attempts)..."
            Start-Sleep -Milliseconds 750
        }
    }
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
$serviceProcessId = 0
if ($null -ne $existingService) {
    $serviceInstance = Get-CimInstance Win32_Service `
        -Filter "Name = '$serviceName'" `
        -ErrorAction SilentlyContinue
    if ($null -ne $serviceInstance) {
        $serviceProcessId = [int]$serviceInstance.ProcessId
    }
}

if ($null -ne $existingService -and $existingService.Status -ne "Stopped") {
    Write-Host "Stopping the existing Tome Training Manager service..."
    Stop-Service -Name $serviceName -Force
    try {
        $existingService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    catch {
        Write-Warning "The service did not report Stopped in time; checking its exact process."
    }
}

Stop-InstalledTrainingManager -TargetPath $binaryTarget -KnownProcessId $serviceProcessId

New-Item -ItemType Directory -Force -Path $InstallRoot, $workerRoot | Out-Null
try {
    Copy-FileWithRetry -Source $binarySource -Destination $binaryTarget
}
catch {
    if ($null -ne $existingService) {
        Write-Warning "Executable replacement failed; attempting to restore the existing service."
        Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    }
    throw
}
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
    New-Service -Name $serviceName `
        -BinaryPathName $serviceBinaryPath `
        -DisplayName "Tome Training Manager" `
        -Description "Receives Tome datasets, manages external AI training jobs, and registers completed models with Ollama." `
        -StartupType Automatic | Out-Null
}

$firewallName = "Tome Training Manager (TCP 11435)"
if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 11435 -Profile Any -RemoteAddress LocalSubnet | Out-Null
}

Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

$health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:11435/v1/health" `
    -TimeoutSec 15
Write-Host "Tome Training Manager installed and running."
Write-Host "Health: $($health.status); protocol: $($health.protocol); Ollama: $($health.ollamaReachable)"
Write-Host "Configure Tome with http://$(hostname):11435 or this server's LAN IP."
