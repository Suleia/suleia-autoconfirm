$ErrorActionPreference = 'Continue'

function Load-EnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) {
      return
    }

    $parts = $line.Split('=', 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (-not [string]::IsNullOrWhiteSpace($key) -and -not [string]::IsNullOrWhiteSpace($value) -and -not [System.Environment]::GetEnvironmentVariable($key)) {
      Set-Item -Path "Env:$key" -Value $value
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Load-EnvFile -Path (Join-Path $scriptDir '.env')

$logFile = Join-Path $scriptDir 'autoconfirm-sync.log'
$runner = Join-Path $scriptDir 'tools\sync-orders-to-sheet.ps1'

Add-Content -LiteralPath $logFile -Value ("[{0}] AutoConfirm runner started" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))

while ($true) {
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner | Out-Null
    Add-Content -LiteralPath $logFile -Value ("[{0}] Sync OK" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
  }
  catch {
    Add-Content -LiteralPath $logFile -Value ("[{0}] Sync ERROR: {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $_.Exception.Message)
  }

  Start-Sleep -Seconds 900
}
