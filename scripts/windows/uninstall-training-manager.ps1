[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "High")]
param(
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$serviceName = "TomeTrainingManager"
$installRoot = "$env:ProgramData\Tome\TrainingManager"
$firewallName = "Tome Training Manager (TCP 11435)"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this uninstaller from an elevated PowerShell session."
}

if ($PSCmdlet.ShouldProcess($serviceName, "stop and delete Windows service")) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
        if ($service.Status -ne "Stopped") {
            Stop-Service -Name $serviceName -Force
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
        }
        & sc.exe delete $serviceName
        if ($LASTEXITCODE -ne 0) {
            throw "Could not delete the Windows service."
        }
    }
    Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule
}

if ($RemoveData -and $PSCmdlet.ShouldProcess($installRoot, "remove all datasets, jobs, logs, configuration, and binaries")) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
    Write-Host "Removed $installRoot. This data is not recoverable unless separately backed up."
}
elseif (-not $RemoveData) {
    Write-Host "Service removed. Training data remains at $installRoot."
}
