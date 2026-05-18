$ErrorActionPreference = "Stop"

$TaskName = "CyberbossSharedBridge"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Uninstalled scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task not found: $TaskName"
}
