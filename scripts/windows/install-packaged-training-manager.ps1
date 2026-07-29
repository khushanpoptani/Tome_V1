[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$DataRoot,
    [Parameter(Mandatory = $true)]
    [string]$BinaryPath,
    [Parameter(Mandatory = $true)]
    [string]$PythonInstaller
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$serviceName = "TomeTrainingManager"
$firewallName = "Tome Training Manager (TCP 11435)"
$configPath = Join-Path $DataRoot "config.json"
$workerRoot = Join-Path $DataRoot "workers"
$pythonRoot = Join-Path $DataRoot "python"
$pythonPath = Join-Path $pythonRoot "python.exe"
$venvRoot = Join-Path $DataRoot "venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$logPath = Join-Path $DataRoot "installer.log"

function Write-InstallLog {
    param([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    & $FilePath @Arguments 2>&1 |
        ForEach-Object {
            Write-InstallLog $_.ToString()
        }
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage Exit code: $LASTEXITCODE. See $logPath."
    }
}

function Find-OllamaExecutable {
    $command = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
    )) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Ollama was not found. Install and start Ollama before installing Tome Training Server."
}

function Wait-ForServiceStop {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        return
    }
    if ($service.Status -ne "Stopped") {
        Write-InstallLog "Stopping the existing Tome Training Server service."
        Stop-Service -Name $serviceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(45))
    }
}

function Wait-ForHealth {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $lastError = ""
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            return Invoke-RestMethod `
                -Method Get `
                -Uri "http://127.0.0.1:11435/v1/health" `
                -TimeoutSec 5
        }
        catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Seconds 2
        }
    }

    $status = (Get-Service -Name $serviceName -ErrorAction SilentlyContinue).Status
    throw "The service did not become healthy within 60 seconds. Service status: $status. Last error: $lastError. See $logPath."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Administrator permission is required."
}

New-Item -ItemType Directory -Force -Path $DataRoot, $workerRoot | Out-Null
Set-Content -LiteralPath $logPath -Value "" -Encoding UTF8

try {
    Write-InstallLog "Starting Tome Training Server installation."
    $ollamaPath = Find-OllamaExecutable
    Write-InstallLog "Found Ollama at $ollamaPath."

    try {
        $ollamaHealth = Invoke-RestMethod `
            -Method Get `
            -Uri "http://127.0.0.1:11434/api/version" `
            -TimeoutSec 10
        Write-InstallLog "Ollama is responding with version $($ollamaHealth.version)."
    }
    catch {
        throw "Ollama is installed but http://127.0.0.1:11434 is not responding. Start Ollama and run setup again."
    }

    $dataDrive = (Get-Item -LiteralPath $DataRoot).PSDrive
    $minimumFreeBytes = 12GB
    if ($dataDrive.Free -lt $minimumFreeBytes) {
        $freeGb = [Math]::Round($dataDrive.Free / 1GB, 1)
        throw "At least 12 GB of free space is required for the training runtime. $freeGb GB is available on $($dataDrive.Name):."
    }

    if (-not (Test-Path -LiteralPath $pythonPath)) {
        if (-not (Test-Path -LiteralPath $PythonInstaller)) {
            throw "The bundled Python runtime installer is missing."
        }
        Write-InstallLog "Installing the private Python training runtime."
        Invoke-CheckedProcess `
            -FilePath $PythonInstaller `
            -Arguments @(
                "/quiet",
                "InstallAllUsers=1",
                "TargetDir=$pythonRoot",
                "Include_doc=0",
                "Include_launcher=0",
                "Include_test=0",
                "PrependPath=0",
                "Shortcuts=0"
            ) `
            -FailureMessage "Python runtime installation failed."
    }

    Copy-Item `
        -LiteralPath (Join-Path $InstallRoot "workers\train.py") `
        -Destination (Join-Path $workerRoot "train.py") `
        -Force
    Copy-Item `
        -LiteralPath (Join-Path $InstallRoot "workers\requirements.txt") `
        -Destination (Join-Path $workerRoot "requirements.txt") `
        -Force

    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-InstallLog "Creating the isolated Python environment."
        Invoke-CheckedProcess `
            -FilePath $pythonPath `
            -Arguments @("-m", "venv", $venvRoot) `
            -FailureMessage "Could not create the Python environment."
    }

    Write-InstallLog "Installing or updating model-training dependencies. This can take several minutes."
    Invoke-CheckedProcess `
        -FilePath $venvPython `
        -Arguments @("-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "pip") `
        -FailureMessage "Could not update pip."
    Invoke-CheckedProcess `
        -FilePath $venvPython `
        -Arguments @(
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            (Join-Path $workerRoot "requirements.txt")
        ) `
        -FailureMessage "Could not install the training dependencies."
    Invoke-CheckedProcess `
        -FilePath $venvPython `
        -Arguments @((Join-Path $workerRoot "train.py"), "--probe") `
        -FailureMessage "The training dependency verification failed."

    if (-not (Test-Path -LiteralPath $configPath)) {
        Write-InstallLog "Creating the Training Server configuration."
        Invoke-CheckedProcess `
            -FilePath $BinaryPath `
            -Arguments @("--write-default-config", $configPath) `
            -FailureMessage "Could not create the Training Server configuration."
    }

    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $config.bind = "0.0.0.0:11435"
    $config.dataDir = $DataRoot
    $config.ollamaUrl = "http://127.0.0.1:11434"
    $config.ollamaExecutable = $ollamaPath
    $config.pythonExecutable = $venvPython
    $config.workerScript = Join-Path $workerRoot "train.py"
    [IO.File]::WriteAllText(
        $configPath,
        ($config | ConvertTo-Json -Depth 20),
        [Text.UTF8Encoding]::new($false)
    )

    Wait-ForServiceStop
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    $serviceCommand = "`"$BinaryPath`" --service"
    if ($null -eq $service) {
        Write-InstallLog "Registering the Windows service."
        & sc.exe create $serviceName `
            "binPath=" $serviceCommand `
            "start=" "auto" `
            "DisplayName=" "Tome Training Server" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not register the Windows service. Exit code: $LASTEXITCODE."
        }
    }
    else {
        Write-InstallLog "Updating the existing Windows service."
        & sc.exe config $serviceName `
            "binPath=" $serviceCommand `
            "start=" "auto" `
            "DisplayName=" "Tome Training Server" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not update the Windows service. Exit code: $LASTEXITCODE."
        }
    }
    & sc.exe description $serviceName `
        "Receives Tome datasets, manages AI training jobs, and registers completed models with Ollama." |
        Out-Null
    & sc.exe failure $serviceName `
        "reset=" "86400" `
        "actions=" "restart/5000/restart/15000/none/0" |
        Out-Null

    if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
        Write-InstallLog "Allowing trusted LAN access on TCP port 11435."
        New-NetFirewallRule `
            -DisplayName $firewallName `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 11435 `
            -Profile Any `
            -RemoteAddress LocalSubnet |
            Out-Null
    }

    Write-InstallLog "Starting the Tome Training Server service."
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus(
        "Running",
        [TimeSpan]::FromSeconds(45)
    )
    $health = Wait-ForHealth
    Write-InstallLog "Installation completed. Version: $($health.version); Ollama reachable: $($health.ollamaReachable)."
}
catch {
    Write-InstallLog "INSTALLATION FAILED: $($_.Exception.Message)"
    throw
}
