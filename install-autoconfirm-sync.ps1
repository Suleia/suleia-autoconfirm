$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncScript = Join-Path $scriptDir 'tools\sync-orders-to-sheet.ps1'
$taskName = 'Suleia AutoConfirm Sheets Sync'

if (-not (Test-Path -LiteralPath $syncScript)) {
  throw "No se encontro $syncScript"
}

$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$syncScript`""
$result = schtasks.exe /Create /TN $taskName /SC MINUTE /MO 15 /TR $action /F

Write-Host $result
Write-Host ''
Write-Host "Tarea creada: $taskName"
Write-Host 'Se ejecutara cada 15 minutos en tu usuario.'
