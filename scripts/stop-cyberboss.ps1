$ErrorActionPreference = "Stop"

$StateDir = if ($env:CYBERBOSS_STATE_DIR) { $env:CYBERBOSS_STATE_DIR } else { Join-Path $HOME ".cyberboss" }
$LogDir = Join-Path $StateDir "logs"
$PidFiles = @(
  (Join-Path $LogDir "shared-wechat.pid"),
  (Join-Path $LogDir "shared-app-server.pid"),
  (Join-Path $LogDir "nightly.pid")
)

foreach ($PidFile in $PidFiles) {
  if (!(Test-Path -LiteralPath $PidFile)) {
    continue
  }

  $RawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if (!$RawPid) {
    continue
  }

  $PidNumber = 0
  if (![int]::TryParse($RawPid, [ref]$PidNumber)) {
    continue
  }

  $Process = Get-Process -Id $PidNumber -ErrorAction SilentlyContinue
  if ($Process) {
    try {
      Stop-Process -Id $PidNumber -Force -ErrorAction Stop
      Write-Host "Stopped process $PidNumber ($($Process.ProcessName))"
    } catch {
      Write-Host "Stop-Process failed for $PidNumber; falling back to taskkill /T /F"
      & taskkill.exe /PID $PidNumber /T /F | Out-Host
    }
  }

  if (!(Get-Process -Id $PidNumber -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Cyberboss stop command finished."
