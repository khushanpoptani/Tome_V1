[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$serviceName = "TomeTrainingManager"
$firewallName = "Tome Training Manager (TCP 11435)"

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
    if ($service.Status -ne "Stopped") {
        Stop-Service -Name $serviceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(45))
    }
    & sc.exe delete $serviceName | Out-Null
}

Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule

Write-Host "Tome Training Server was removed. Training data remains in C:\ProgramData\Tome\TrainingManager."
