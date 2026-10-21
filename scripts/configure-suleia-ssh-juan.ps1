[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
function Test-JuanSshAuthentication([string] $Diagnostic) {
    $authentication = [regex]::Match($Diagnostic, '(?m)^Authenticated to 169\.58\.77\.219 [^\r\n]+ using "?publickey"?\.\r?$')
    if (!$authentication.Success) { return $false }
    $acceptedKeys = [regex]::Matches($Diagnostic.Substring(0, $authentication.Index), '(?m)^debug1: Server accepts key:[^\r\n]+')
    if ($acceptedKeys.Count -eq 0) { return $false }
    return $acceptedKeys[$acceptedKeys.Count - 1].Value -match 'SHA256:NdcrZ16r/sGEsmIPWNlAxMydEmH5VYkvKQEeraBeu\+Q(?:\s|$)'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (($identity.Name -split '\\')[-1] -ine 'juan') {
    throw 'Ejecuta este script en la sesion Windows de juan, en su propio PC.'
}

$profilePath = [Environment]::GetFolderPath('UserProfile')
$sshDirectory = Join-Path $profilePath '.ssh'
$keyPath = Join-Path $sshDirectory 'suleia_juan_ed25519'
$publicPath = $keyPath + '.pub'
$configPath = Join-Path $sshDirectory 'config'
$knownHostsPath = Join-Path $sshDirectory 'known_hosts_suleia'
$expectedPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDDGXdM6oRIH5tX1b/jUOTmuXNFXtLiHu5EPKrWIxzdE'
$hostPin = '169.58.77.219 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPyoRfcNsoAzDqMFFtf1pTD4KFa4Ou1GMc8iTityVSNW'
$utf8 = New-Object Text.UTF8Encoding($false)

foreach ($itemPath in @($profilePath, $sshDirectory, $keyPath, $publicPath, $configPath, $knownHostsPath)) {
    if (Test-Path -LiteralPath $itemPath) {
        if ((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Revisar enlace antes de continuar: $itemPath"
        }
    }
}
if (!(Test-Path -LiteralPath $keyPath -PathType Leaf) -or !(Test-Path -LiteralPath $publicPath -PathType Leaf)) {
    throw 'Falta la pareja de claves de Juan. No se genera ni se reemplaza ninguna clave.'
}
$publicParts = ([IO.File]::ReadAllText($publicPath).Trim() -split '\s+')
if ($publicParts.Count -lt 2 -or (($publicParts[0..1] -join ' ') -cne $expectedPublicKey)) {
    throw 'La clave publica local no coincide con la autorizada para Juan.'
}

if (Test-Path -LiteralPath $knownHostsPath) {
    if ([IO.File]::ReadAllText($knownHostsPath).Trim() -cne $hostPin) {
        throw 'El pin local del servidor es distinto. Revisarlo; no se sobrescribe.'
    }
} else {
    $pinStream = [IO.File]::Open($knownHostsPath, [IO.FileMode]::CreateNew)
    try {
        $pinBytes = $utf8.GetBytes($hostPin + "`n")
        $pinStream.Write($pinBytes, 0, $pinBytes.Length)
    } finally { $pinStream.Dispose() }
}

$existing = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { '' }
$managedPattern = '(?ms)^# BEGIN SULEIA JUAN\r?\n.*?^# END SULEIA JUAN\r?\n?'
$unmanaged = [regex]::Replace($existing, $managedPattern, '')
$sshKey = $keyPath.Replace('\', '/')
$pinPath = $knownHostsPath.Replace('\', '/')
$managed = @"
# BEGIN SULEIA JUAN
Host suleia
    HostName 169.58.77.219
    User suleiaops
    Port 22
    IdentityFile "$sshKey"
    IdentitiesOnly yes
    ForwardAgent no
    StrictHostKeyChecking yes
    UserKnownHostsFile "$pinPath"
    GlobalKnownHostsFile none
    KnownHostsCommand none
    VerifyHostKeyDNS no
    HostKeyAlias 169.58.77.219
    HostKeyAlgorithms ssh-ed25519
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ProxyCommand none
    ProxyJump none
Host *
# END SULEIA JUAN
"@
$desired = $managed + "`n" + $unmanaged
if ($desired -cne $existing) {
    $temporaryPath = Join-Path $sshDirectory ('config.suleia-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporaryPath, $desired, $utf8)
    if (Test-Path -LiteralPath $configPath) {
        $backupPath = $configPath + '.before-suleia-' + [guid]::NewGuid().ToString('N')
        [IO.File]::Replace($temporaryPath, $configPath, $backupPath)
        Write-Host "Configuracion anterior conservada en $backupPath"
    } else {
        [IO.File]::Move($temporaryPath, $configPath)
    }
}

$effective = @(& ssh -G suleia 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'ssh -G suleia ha fallado. Revisar config.' }
foreach ($expected in @('hostname 169.58.77.219', 'user suleiaops', 'port 22', 'identitiesonly yes', 'forwardagent no', 'stricthostkeychecking true')) {
    if ($effective -notcontains $expected) { throw "Configuracion efectiva inesperada: $expected" }
}
foreach ($expected in @("userknownhostsfile $pinPath", 'globalknownhostsfile none', 'verifyhostkeydns false', 'hostkeyalias 169.58.77.219', 'hostkeyalgorithms ssh-ed25519')) {
    if ($effective -notcontains $expected) { throw "Pin efectivo inesperado: $expected" }
}
Write-Host 'Alias configurado. Verificando acceso real mediante ssh suleia...'
$diagnosticPath = Join-Path $sshDirectory ('suleia-check-' + [guid]::NewGuid().ToString('N') + '.log')
try {
    $remoteUser = @(& ssh -v -E $diagnosticPath -o ConnectTimeout=15 suleia whoami)
    $connectionExit = $LASTEXITCODE
    $diagnostic = if (Test-Path -LiteralPath $diagnosticPath) { [IO.File]::ReadAllText($diagnosticPath) } else { '' }
    $acceptedOwnKey = Test-JuanSshAuthentication $diagnostic
    if ($connectionExit -ne 0 -or ($remoteUser -join "`n").Trim() -cne 'suleiaops' -or !$acceptedOwnKey) {
        throw 'No se ha confirmado el acceso con la clave de Juan. Revisar localmente la clave/passphrase y el error SSH, sin compartir secretos.'
    }
} finally {
    if (Test-Path -LiteralPath $diagnosticPath) { Remove-Item -LiteralPath $diagnosticPath }
}
Write-Host 'VERIFICADO: ssh suleia entra como suleiaops en 169.58.77.219 desde la cuenta Windows juan.'
