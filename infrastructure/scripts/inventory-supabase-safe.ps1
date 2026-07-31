param(
  [string]$RenderServiceId = 'srv-d8dkdrf40ujc73cpskag',
  [string]$RenderTokenSecureFile = 'C:\Users\samue\OneDrive\Documentos\Suleia\private-secrets\render-token.secure.txt',
  [string]$NodeExecutable = 'C:\Users\samue\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
)

$ErrorActionPreference = 'Stop'
$tokenPtr = [IntPtr]::Zero
$renderToken = $null
try {
  $secureToken = (Get-Content -Raw -LiteralPath $RenderTokenSecureFile).Trim() | ConvertTo-SecureString
  $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $renderToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
  $response = Invoke-RestMethod -Method Get -Uri "https://api.render.com/v1/services/$RenderServiceId/env-vars" -Headers @{ Accept = 'application/json'; Authorization = "Bearer $renderToken" }
  $rows = if ($response -is [Array]) { $response } elseif ($response.data) { $response.data } else { @($response) }
  foreach ($row in $rows) {
    $item = if ($row.envVar) { $row.envVar } else { $row }
    if ($item.key -in @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')) {
      [Environment]::SetEnvironmentVariable([string]$item.key, [string]$item.value, 'Process')
    }
  }
  & $NodeExecutable (Join-Path $PSScriptRoot 'inventory-supabase-safe.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Supabase inventory failed' }
} finally {
  Remove-Item Env:\SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  $renderToken = $null
  if ($tokenPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr) }
}
