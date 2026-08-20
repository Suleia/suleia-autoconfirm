param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^/]+\.supabase\.co/?$')]
  [string]$SupabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$PublishableKeySecureFile,
  [Parameter(Mandatory = $true)]
  [string]$ShadowReaderTokenSecureFile,
  [string]$SshKeyFile = 'C:\Users\samue\.ssh\suleia-operations-staging_ed25519',
  [string]$KnownHostsFile = 'C:\Users\samue\OneDrive\Documentos\Suleia\private-secrets\vps-known-hosts',
  [string]$VpsHost = '169.58.77.219',
  [string]$VpsUser = 'suleiaops'
)

$ErrorActionPreference = 'Stop'
$publishablePtr = [IntPtr]::Zero
$tokenPtr = [IntPtr]::Zero
$publishableKey = $null
$readerToken = $null
$url64 = $null
$publishable64 = $null
$reader64 = $null
$remoteScript = $null
try {
  $securePublishable = (Get-Content -Raw -LiteralPath $PublishableKeySecureFile).Trim() | ConvertTo-SecureString
  $secureToken = (Get-Content -Raw -LiteralPath $ShadowReaderTokenSecureFile).Trim() | ConvertTo-SecureString
  $publishablePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePublishable)
  $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $publishableKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($publishablePtr)
  $readerToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
  if (-not $publishableKey.StartsWith('sb_publishable_')) { throw 'The Supabase publishable key is unavailable or invalid' }
  if ([string]::IsNullOrWhiteSpace($readerToken)) { throw 'The technical read-only token is unavailable' }
  $url64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SupabaseUrl.TrimEnd('/')))
  $publishable64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publishableKey))
  $reader64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($readerToken))
  $remoteScript = @"
set -Eeuo pipefail
umask 077
env_file=/opt/suleia-operations/.env
test -f "`$env_file"
source_url=`$(printf '%s' '$url64' | base64 -d)
source_publishable=`$(printf '%s' '$publishable64' | base64 -d)
source_reader=`$(printf '%s' '$reader64' | base64 -d)
tmp_file=`$(mktemp /opt/suleia-operations/.env.shadow.XXXXXX)
awk '!/^(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SHADOW_READER_TOKEN|SUPABASE_SERVICE_ROLE_KEY|MIGRATION_HASH_KEY)=/' "`$env_file" > "`$tmp_file"
printf 'SUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\nSUPABASE_SHADOW_READER_TOKEN=%s\n' "`$source_url" "`$source_publishable" "`$source_reader" >> "`$tmp_file"
if grep -q '^MIGRATION_HASH_KEY=.' "`$env_file"; then
  grep '^MIGRATION_HASH_KEY=' "`$env_file" >> "`$tmp_file"
else
  printf 'MIGRATION_HASH_KEY=%s\n' "`$(openssl rand -hex 32)" >> "`$tmp_file"
fi
chown root:root "`$tmp_file"
chmod 0600 "`$tmp_file"
mv -f "`$tmp_file" "`$env_file"
unset source_url source_publishable source_reader
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
  $publishableKey = $null
  $readerToken = $null
  $url64 = $null
  $publishable64 = $null
  $reader64 = $null
  $remoteScript = $null
  if ($publishablePtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($publishablePtr) }
  if ($tokenPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr) }
}
