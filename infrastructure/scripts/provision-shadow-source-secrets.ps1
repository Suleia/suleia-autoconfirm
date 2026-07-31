param(
  [string]$RenderServiceId = 'srv-d8dkdrf40ujc73cpskag',
  [string]$RenderTokenSecureFile = 'C:\Users\samue\OneDrive\Documentos\Suleia\private-secrets\render-token.secure.txt',
  [string]$SshKeyFile = 'C:\Users\samue\.ssh\suleia-operations-staging_ed25519',
  [string]$KnownHostsFile = 'C:\Users\samue\OneDrive\Documentos\Suleia\private-secrets\vps-known-hosts',
  [string]$VpsHost = '169.58.77.219',
  [string]$VpsUser = 'suleiaops'
)

$ErrorActionPreference = 'Stop'
$tokenPtr = [IntPtr]::Zero
$renderToken = $null
$sourceValues = @{}
try {
  $secureToken = (Get-Content -Raw -LiteralPath $RenderTokenSecureFile).Trim() | ConvertTo-SecureString
  $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $renderToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
  $response = Invoke-RestMethod -Method Get -Uri "https://api.render.com/v1/services/$RenderServiceId/env-vars" -Headers @{ Accept = 'application/json'; Authorization = "Bearer $renderToken" }
  $rows = if ($response -is [Array]) { $response } elseif ($response.data) { $response.data } else { @($response) }
  foreach ($row in $rows) {
    $item = if ($row.envVar) { $row.envVar } else { $row }
    if ($item.key -in @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') -and $item.value) { $sourceValues[[string]$item.key] = [string]$item.value }
  }
  if (-not $sourceValues.SUPABASE_URL -or -not $sourceValues.SUPABASE_SERVICE_ROLE_KEY) { throw 'The allowlisted Supabase source credentials are unavailable' }
  $url64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sourceValues.SUPABASE_URL))
  $key64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sourceValues.SUPABASE_SERVICE_ROLE_KEY))
  $remoteScript = @"
set -Eeuo pipefail
umask 077
env_file=/opt/suleia-operations/.env
test -f "`$env_file"
source_url=`$(printf '%s' '$url64' | base64 -d)
source_key=`$(printf '%s' '$key64' | base64 -d)
tmp_file=`$(mktemp /opt/suleia-operations/.env.shadow.XXXXXX)
awk '!/^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|MIGRATION_HASH_KEY)=/' "`$env_file" > "`$tmp_file"
printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "`$source_url" "`$source_key" >> "`$tmp_file"
if grep -q '^MIGRATION_HASH_KEY=.' "`$env_file"; then
  grep '^MIGRATION_HASH_KEY=' "`$env_file" >> "`$tmp_file"
else
  printf 'MIGRATION_HASH_KEY=%s\n' "`$(openssl rand -hex 32)" >> "`$tmp_file"
fi
chown root:root "`$tmp_file"
chmod 0600 "`$tmp_file"
mv -f "`$tmp_file" "`$env_file"
unset source_url source_key url64 key64
echo 'Shadow source credentials provisioned without disclosure.'
"@
  $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $ssh
  $safeKeyFile = $SshKeyFile.Replace('"', '\"')
  $safeKnownHosts = $KnownHostsFile.Replace('"', '\"')
  $start.Arguments = "-T -i `"$safeKeyFile`" -o `"UserKnownHostsFile=$safeKnownHosts`" -o StrictHostKeyChecking=yes $VpsUser@$VpsHost sudo /bin/bash -s"
  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true; $start.UseShellExecute = $false
  $process = [Diagnostics.Process]::Start($start)
  $process.StandardInput.Write($remoteScript); $process.StandardInput.Close(); $process.WaitForExit()
  $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0) { throw "VPS secret provisioning failed: $stderr" }
  Write-Output $stdout.Trim()
} finally {
  $sourceValues.Clear(); $renderToken = $null
  if ($tokenPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr) }
}
