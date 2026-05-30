$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$autoScript = Join-Path $scriptDir 'auto-sync-autoconfirm.ps1'

if (-not (Test-Path -LiteralPath $autoScript)) {
  throw "No se encontro $autoScript"
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$valueName = 'Suleia AutoConfirm Sync'
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$autoScript`""

New-ItemProperty -Path $runKey -Name $valueName -Value $command -PropertyType String -Force | Out-Null

Write-Host 'AutoConfirm configurado para iniciarse al entrar en Windows.'
Write-Host "Comando: $command"
