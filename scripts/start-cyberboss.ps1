param(
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Command = "cd `"$Root`"; npm.cmd run shared:start"
$WindowStyle = if ($Visible) { "Normal" } else { "Hidden" }

Start-Process powershell.exe `
  -WorkingDirectory $Root `
  -WindowStyle $WindowStyle `
  -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command

Write-Host "Cyberboss shared:start launched. WindowStyle=$WindowStyle"
Write-Host "Root=$Root"
