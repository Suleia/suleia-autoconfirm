param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^/]+\.supabase\.co/?$')]
  [string]$SupabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$PublishableKeySecureFile,
  [Parameter(Mandatory = $true)]
  [string]$ShadowReaderTokenSecureFile,
  [string]$NodeExecutable = 'C:\Users\samue\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
)

$ErrorActionPreference = 'Stop'
$publishablePtr = [IntPtr]::Zero
$tokenPtr = [IntPtr]::Zero
$publishableKey = $null
$readerToken = $null
try {
  if (Test-Path Env:\SUPABASE_SERVICE_ROLE_KEY) { throw 'SUPABASE_SERVICE_ROLE_KEY is forbidden for shadow inventory' }
  $securePublishable = (Get-Content -Raw -LiteralPath $PublishableKeySecureFile).Trim() | ConvertTo-SecureString
  $secureToken = (Get-Content -Raw -LiteralPath $ShadowReaderTokenSecureFile).Trim() | ConvertTo-SecureString
  $publishablePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePublishable)
  $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $publishableKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($publishablePtr)
  $readerToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
  if (-not $publishableKey.StartsWith('sb_publishable_')) { throw 'The Supabase publishable key is unavailable or invalid' }
  if ([string]::IsNullOrWhiteSpace($readerToken)) { throw 'The technical read-only token is unavailable' }
  [Environment]::SetEnvironmentVariable('SUPABASE_URL', $SupabaseUrl.TrimEnd('/'), 'Process')
  [Environment]::SetEnvironmentVariable('SUPABASE_PUBLISHABLE_KEY', $publishableKey, 'Process')
  [Environment]::SetEnvironmentVariable('SUPABASE_SHADOW_READER_TOKEN', $readerToken, 'Process')
  & $NodeExecutable (Join-Path $PSScriptRoot 'inventory-supabase-safe.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Supabase inventory failed' }
} finally {
  Remove-Item Env:\SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\SUPABASE_SHADOW_READER_TOKEN -ErrorAction SilentlyContinue
  $publishableKey = $null
  $readerToken = $null
  if ($publishablePtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($publishablePtr) }
  if ($tokenPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr) }
}
