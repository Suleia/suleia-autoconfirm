param(
  [ValidateSet('preflight', 'preview', 'execute')]
  [string]$Mode = 'preflight',
  [string]$BusinessDate = '',
  [string]$OutputPath = '',
  [string]$RenderServiceId = 'srv-d8dkdrf40ujc73cpskag',
  [string]$RenderTokenSecureFile = 'C:\Users\samue\OneDrive\Documentos\Suleia\private-secrets\render-token.secure.txt',
  [string]$NodeExecutable = 'C:\Users\samue\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runner = Join-Path $repositoryRoot 'services\today-batch-runner.mjs'
$sensitiveNames = @(
  'SHOPIFY_ADMIN_ACCESS_TOKEN',
  'SHOPIFY_ACCESS_TOKEN',
  'CHATBY_TOKEN',
  'DASHBOARD_SESSION_SECRET'
)
$bstr = [IntPtr]::Zero
$renderToken = $null

function Set-BatchEnvironment {
  param([hashtable]$RenderEnvironment)

  $fixed = @{
    APP_ENV = 'staging'
    RUN_MODE = 'SIMULATION'
    SIMULATION_ONLY = 'true'
    PRODUCTION_WRITES_ENABLED = 'false'
    ACTION_EXECUTOR_ENABLED = 'false'
    MCP_WRITE_TOOLS_ENABLED = 'false'
    OPENAI_API_ENABLED = 'false'
    OPENAI_API_AUTOMATION_ENABLED = 'false'
    EXTERNAL_LLM_CALLS_ENABLED = 'false'
    LIVE_WEBHOOKS_ENABLED = 'false'
    LIVE_CRON_ENABLED = 'false'
    LIVE_POLLING_ENABLED = 'false'
    PII_MASKING_ENABLED = 'true'
    AUDIT_LOGGING_ENABLED = 'true'
    REAL_DATA_READ_ENABLED = 'true'
    REAL_DATA_WRITE_ENABLED = 'false'
    MASK_BEFORE_PERSISTENCE = 'true'
    RAW_REAL_PAYLOAD_PERSISTENCE = 'false'
    CONNECTOR_READ_ONLY_ENFORCED = 'true'
    STAGING_PUBLIC_ACCESS_ENABLED = 'false'
    TODAY_BATCH_SIMULATION_ENABLED = 'true'
    BUSINESS_TIMEZONE = 'Europe/Madrid'
    ORDER_DATE_FIELD = 'created_at'
    ORDER_BATCH_SCOPE = 'TODAY'
    ORDER_IMPORT_LIMIT = 'UNLIMITED_WITHIN_DATE_RANGE'
    MAX_PAGES_PER_SOURCE = '200'
    MAX_RETRIES_PER_PAGE = '3'
    MAX_BATCH_RUNTIME = '600000'
    MAX_CONCURRENT_ORDERS = '5'
    MAX_CONCURRENT_REQUESTS_PER_SOURCE = '2'
    CURRENT_SYSTEM_BASE_URL = 'https://suleia-autoconfirm.onrender.com'
  }
  foreach ($entry in $fixed.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  if ($BusinessDate) {
    [Environment]::SetEnvironmentVariable('BUSINESS_DATE', $BusinessDate, 'Process')
  }

  $allowed = @(
    'SHOPIFY_DOMAIN',
    'SHOPIFY_SHOP',
    'SHOPIFY_API_VERSION',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'SHOPIFY_ACCESS_TOKEN',
    'CHATBY_TOKEN',
    'CHATBY_BASE_URL',
    'DASHBOARD_SESSION_SECRET',
    'CRON_SECRET',
    'PUBLIC_BASE_URL',
    'RENDER_EXTERNAL_URL'
  )
  foreach ($name in $allowed) {
    if ($RenderEnvironment.ContainsKey($name) -and $RenderEnvironment[$name]) {
      [Environment]::SetEnvironmentVariable($name, [string]$RenderEnvironment[$name], 'Process')
    }
  }
  if (-not $env:DASHBOARD_SESSION_SECRET -and $env:CRON_SECRET) {
    [Environment]::SetEnvironmentVariable('DASHBOARD_SESSION_SECRET', $env:CRON_SECRET, 'Process')
  }
  if ($env:PUBLIC_BASE_URL) {
    [Environment]::SetEnvironmentVariable('CURRENT_SYSTEM_BASE_URL', $env:PUBLIC_BASE_URL, 'Process')
  } elseif ($env:RENDER_EXTERNAL_URL) {
    [Environment]::SetEnvironmentVariable('CURRENT_SYSTEM_BASE_URL', $env:RENDER_EXTERNAL_URL, 'Process')
  }
  if ($Mode -eq 'execute') {
    if (-not $OutputPath) { throw 'OutputPath is required for execute mode.' }
    [Environment]::SetEnvironmentVariable('TODAY_BATCH_OUTPUT', $OutputPath, 'Process')
  }
}

try {
  if (-not (Test-Path -LiteralPath $NodeExecutable)) {
    throw 'Bundled Node.js runtime was not found.'
  }
  $renderEnvironment = @{}
  if ($Mode -ne 'preflight') {
    $encrypted = (Get-Content -Raw -LiteralPath $RenderTokenSecureFile).Trim()
    $secureToken = ConvertTo-SecureString $encrypted
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $renderToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $headers = @{
      Accept = 'application/json'
      Authorization = "Bearer $renderToken"
    }
    $response = Invoke-RestMethod `
      -Method Get `
      -Uri "https://api.render.com/v1/services/$RenderServiceId/env-vars" `
      -Headers $headers
    $rows = if ($response -is [Array]) { $response } elseif ($response.data) { $response.data } else { @($response) }
    foreach ($row in $rows) {
      $item = if ($row.envVar) { $row.envVar } else { $row }
      if ($item.key) { $renderEnvironment[[string]$item.key] = [string]$item.value }
    }
  }
  Set-BatchEnvironment -RenderEnvironment $renderEnvironment
  & $NodeExecutable $runner "--mode=$Mode"
  exit $LASTEXITCODE
} finally {
  foreach ($name in $sensitiveNames) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  [Environment]::SetEnvironmentVariable('CRON_SECRET', $null, 'Process')
  $renderToken = $null
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
