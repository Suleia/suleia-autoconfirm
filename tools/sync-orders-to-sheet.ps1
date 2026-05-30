$ErrorActionPreference = 'Stop'

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

    if ([string]::IsNullOrWhiteSpace($key) -or [string]::IsNullOrWhiteSpace($value)) {
      return
    }

    if (-not [System.Environment]::GetEnvironmentVariable($key)) {
      Set-Item -Path "Env:$key" -Value $value
    }
  }
}

function To-Base64Url {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-FirstValue {
  param(
    [Parameter(Mandatory = $true)]$Values,
    [Parameter(Mandatory = $false)]$Fallback = ''
  )

  foreach ($value in $Values) {
    if ($null -ne $value -and "$value" -ne '') {
      return $value
    }
  }

  return $Fallback
}

function Normalize-Pem {
  param([Parameter(Mandatory = $true)][string]$Text)
  $Text -replace '\\n', "`n"
}

function Read-DerLength {
  param(
    [Parameter(Mandatory = $true)][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][ref]$Index
  )

  $first = $Bytes[$Index.Value]
  $Index.Value++

  if (($first -band 0x80) -eq 0) {
    return $first
  }

  $count = $first -band 0x7F
  $length = 0
  for ($i = 0; $i -lt $count; $i++) {
    $length = ($length -shl 8) -bor $Bytes[$Index.Value]
    $Index.Value++
  }

  return $length
}

function Parse-Pkcs8PrivateKey {
  param([Parameter(Mandatory = $true)][string]$Pem)

  $base64 = ($Pem -replace '-----BEGIN PRIVATE KEY-----', '' -replace '-----END PRIVATE KEY-----', '' -replace '\s', '')
  $bytes = [Convert]::FromBase64String($base64)
  $index = 0

  if ($bytes[$index] -ne 0x30) { throw 'Clave privada inesperada: no comienza como SEQUENCE.' }
  $index++
  [void](Read-DerLength -Bytes $bytes -Index ([ref]$index))

  if ($bytes[$index] -ne 0x02) { throw 'Clave privada inesperada: falta version.' }
  $index++
  $versionLength = Read-DerLength -Bytes $bytes -Index ([ref]$index)
  $index += $versionLength

  if ($bytes[$index] -ne 0x30) { throw 'Clave privada inesperada: falta algoritmo.' }
  $index++
  $algLength = Read-DerLength -Bytes $bytes -Index ([ref]$index)
  $index += $algLength

  if ($bytes[$index] -ne 0x04) { throw 'Clave privada inesperada: falta OCTET STRING.' }
  $index++
  $keyLength = Read-DerLength -Bytes $bytes -Index ([ref]$index)
  $privateBytes = New-Object byte[] $keyLength
  [Array]::Copy($bytes, $index, $privateBytes, 0, $keyLength)

  $inner = 0
  if ($privateBytes[$inner] -ne 0x30) { throw 'Clave RSA inesperada: no comienza como SEQUENCE.' }
  $inner++
  [void](Read-DerLength -Bytes $privateBytes -Index ([ref]$inner))

  if ($privateBytes[$inner] -ne 0x02) { throw 'Clave RSA inesperada: falta version.' }
  $inner++
  $versionLength2 = Read-DerLength -Bytes $privateBytes -Index ([ref]$inner)
  $inner += $versionLength2

  function Read-IntegerBytes {
    param(
      [Parameter(Mandatory = $true)][byte[]]$Source,
      [Parameter(Mandatory = $true)][ref]$Pos,
      [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Source[$Pos.Value] -ne 0x02) {
      throw "ASN.1 inesperado en ${Label}: se esperaba INTEGER y se obtuvo $($Source[$Pos.Value])."
    }

    $Pos.Value++
    $length = Read-DerLength -Bytes $Source -Index $Pos
    $result = New-Object byte[] $length
    [Array]::Copy($Source, $Pos.Value, $result, 0, $length)
    $Pos.Value += $length

    while ($result.Length -gt 1 -and $result[0] -eq 0) {
      $result = $result[1..($result.Length - 1)]
    }

    return ,$result
  }

  $modulus = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'modulus'
  $exponent = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'exponent'
  $d = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'private exponent'
  $p = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'prime1'
  $q = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'prime2'
  $dp = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'exponent1'
  $dq = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'exponent2'
  $iq = Read-IntegerBytes -Source $privateBytes -Pos ([ref]$inner) -Label 'coefficient'

  $rsaParams = New-Object System.Security.Cryptography.RSAParameters
  $rsaParams.Modulus = $modulus
  $rsaParams.Exponent = $exponent
  $rsaParams.D = $d
  $rsaParams.P = $p
  $rsaParams.Q = $q
  $rsaParams.DP = $dp
  $rsaParams.DQ = $dq
  $rsaParams.InverseQ = $iq
  return $rsaParams
}

function Get-GoogleAccessToken {
  param(
    [Parameter(Mandatory = $true)][string]$ServiceAccountEmail,
    [Parameter(Mandatory = $true)][string]$PrivateKey
  )

  $normalizedKey = Normalize-Pem -Text $PrivateKey
  $rsaParams = Parse-Pkcs8PrivateKey -Pem $normalizedKey

  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
  $rsa.PersistKeyInCsp = $false
  $rsa.ImportParameters($rsaParams)

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $header = @{ alg = 'RS256'; typ = 'JWT' } | ConvertTo-Json -Compress
  $claims = @{
    iss = $ServiceAccountEmail
    scope = 'https://www.googleapis.com/auth/spreadsheets'
    aud = 'https://oauth2.googleapis.com/token'
    iat = $now
    exp = $now + 3600
  } | ConvertTo-Json -Compress

  $unsigned = '{0}.{1}' -f (To-Base64Url -Bytes ([Text.Encoding]::UTF8.GetBytes($header))), (To-Base64Url -Bytes ([Text.Encoding]::UTF8.GetBytes($claims)))
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $signatureBytes = $rsa.SignData([Text.Encoding]::UTF8.GetBytes($unsigned), $sha256)
  $jwt = '{0}.{1}' -f $unsigned, (To-Base64Url -Bytes $signatureBytes)

  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.UseProxy = $false
  $handler.SslProtocols = [System.Security.Authentication.SslProtocols]::Tls12

  $client = New-Object System.Net.Http.HttpClient($handler)
  $body = 'grant_type={0}&assertion={1}' -f [Uri]::EscapeDataString('urn:ietf:params:oauth:grant-type:jwt-bearer'), [Uri]::EscapeDataString($jwt)
  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, 'https://oauth2.googleapis.com/token')
  $request.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/x-www-form-urlencoded')

  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

  if (-not $response.IsSuccessStatusCode) {
    throw "Google token respondió $([int]$response.StatusCode): $text"
  }

  $data = $text | ConvertFrom-Json
  if (-not $data.access_token) {
    throw 'Google no devolvió access_token.'
  }

  return $data.access_token
}

function Invoke-DropeaGraphQL {
  param(
    [Parameter(Mandatory = $true)][string]$Query,
    [Parameter(Mandatory = $true)][hashtable]$Variables
  )

  if (-not $env:DROPEA_API_KEY) {
    throw 'Falta DROPEA_API_KEY.'
  }

  $body = @{
    query = $Query
    variables = $Variables
  } | ConvertTo-Json -Depth 12

  $response = Invoke-RestMethod -Method Post -Uri 'https://api.dropea.com/graphql/dropshippers' -Headers @{
    'x-api-key' = $env:DROPEA_API_KEY
  } -ContentType 'application/json' -Body $body

  if ($response.errors) {
    throw "Dropea devolvio errores: $($response.errors | ConvertTo-Json -Depth 12)"
  }

  return $response.data
}

function Get-SheetsToken {
  if (-not $script:GoogleAccessToken) {
    if (-not $env:GOOGLE_SERVICE_ACCOUNT_EMAIL -or -not $env:GOOGLE_PRIVATE_KEY) {
      throw 'Faltan credenciales de Google Sheets en el archivo .env.'
    }
    $script:GoogleAccessToken = Get-GoogleAccessToken -ServiceAccountEmail $env:GOOGLE_SERVICE_ACCOUNT_EMAIL -PrivateKey $env:GOOGLE_PRIVATE_KEY
  }
  return $script:GoogleAccessToken
}

function Invoke-SheetsRequest {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET','POST','PUT')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [object]$Body
  )

  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.UseProxy = $false
  $handler.SslProtocols = [System.Security.Authentication.SslProtocols]::Tls12

  $client = New-Object System.Net.Http.HttpClient($handler)
  $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), $Url)
  $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', (Get-SheetsToken))

  if ($Method -ne 'GET') {
    $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 12 } else { '{}' }
    $request.Content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, 'application/json')
  }

  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

  if (-not $response.IsSuccessStatusCode) {
    throw "Sheets respondió $([int]$response.StatusCode): $text"
  }

  if (-not [string]::IsNullOrWhiteSpace($text)) {
    return $text | ConvertFrom-Json
  }

  return $null
}

function Ensure-SheetHeaders {
  param(
    [Parameter(Mandatory = $true)][string]$SheetId,
    [Parameter(Mandatory = $true)][string]$SheetName,
    [string[]]$Headers
  )

  $encodedSheet = [uri]::EscapeDataString($SheetName)
  $range = "$encodedSheet!A:Z"
  $url = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$range"
  $current = Invoke-SheetsRequest -Method GET -Url $url
  $values = @($current.values)

  if (-not $values -or $values.Count -eq 0) {
    $headerRange = "$encodedSheet!A1:G1"
    $headerUrl = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$headerRange?valueInputOption=RAW"
    [void](Invoke-SheetsRequest -Method PUT -Url $headerUrl -Body @{ values = @($Headers) })
    return ,@($Headers)
  }

  return ,$values
}

function Upsert-SheetRow {
  param(
    [Parameter(Mandatory = $true)][string]$SheetId,
    [Parameter(Mandatory = $true)][string]$SheetName,
    [Parameter(Mandatory = $true)][hashtable]$Order
  )

  $headers = @(
    'orderId',
    'nombre',
    'telefono',
    'fecha_creacion',
    'estado',
    'importe',
    'fecha_confirmacion'
  )

  $encodedSheet = [uri]::EscapeDataString($SheetName)
  $range = "$encodedSheet!A:Z"
  $url = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$range"
  $current = Invoke-SheetsRequest -Method GET -Url $url
  $values = @($current.values)

  if (-not $values -or $values.Count -eq 0) {
    $headerRange = "$encodedSheet!A1:G1"
    $headerUrl = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$headerRange?valueInputOption=RAW"
    [void](Invoke-SheetsRequest -Method PUT -Url $headerUrl -Body @{ values = @($headers) })
    $values = @($headers)
  }

  $sheetHeaders = @($values[0])
  if (-not $sheetHeaders -or $sheetHeaders.Count -eq 0) {
    $sheetHeaders = $headers
  }

  $orderIdIndex = [Array]::IndexOf($sheetHeaders, 'orderId')
  if ($orderIdIndex -lt 0) {
    $sheetHeaders = $headers
    $orderIdIndex = 0
    $headerRange = "$encodedSheet!A1:G1"
    $headerUrl = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$headerRange?valueInputOption=RAW"
    [void](Invoke-SheetsRequest -Method PUT -Url $headerUrl -Body @{ values = @($sheetHeaders) })
    $values = @($sheetHeaders)
  }

  $rowIndex = $null
  for ($i = 1; $i -lt $values.Count; $i++) {
    $row = @($values[$i])
    if ($row.Count -gt $orderIdIndex -and [string]$row[$orderIdIndex] -eq [string]$Order.orderId) {
      $rowIndex = $i + 1
      break
    }
  }

  $rowValues = @(
    [string]$Order.orderId,
    [string](Get-FirstValue @($Order.customerName, '')),
    [string](Get-FirstValue @($Order.customerPhone, '')),
    [string](Get-FirstValue @($Order.createdAt, '')),
    [string](Get-FirstValue @($Order.status, '')),
    [string](Get-FirstValue @($Order.orderAmount, '')),
    [string](Get-FirstValue @($Order.confirmedAt, ''))
  )

  if ($rowIndex) {
    $updateRange = "$encodedSheet!A$rowIndex:G$rowIndex"
    $updateUrl = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$updateRange?valueInputOption=RAW"
    [void](Invoke-SheetsRequest -Method PUT -Url $updateUrl -Body @{ values = @($rowValues) })
    return @{ updated = $true; rowIndex = $rowIndex }
  }

  $appendUrl = "https://sheets.googleapis.com/v4/spreadsheets/$SheetId/values/$range:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
  [void](Invoke-SheetsRequest -Method POST -Url $appendUrl -Body @{ values = @($rowValues) })
  return @{ appended = $true }
}

function Sync-PendingOrdersToSheet {
  $queryAll = @'
query Orders($limit: Int!, $page: Int!) {
  orders(limit: $limit, page: $page) {
    data {
      id
      status
      customer { full_name phone email }
      total_amount
      created_at
    }
  }
}
'@

  $queryPending = @'
query PendingOrders($status: OrderStateEnum!, $limit: Int!, $page: Int!) {
  orders(status: $status, limit: $limit, page: $page) {
    data {
      id
      status
      customer { full_name phone email }
      total_amount
      created_at
    }
  }
}
'@

  $sheetId = $env:GOOGLE_SHEET_ID
  $sheetName = if ($env:GOOGLE_SHEET_NAME) { $env:GOOGLE_SHEET_NAME } else { 'Pedidos' }
  if (-not $sheetId) {
    throw 'Falta GOOGLE_SHEET_ID.'
  }

  $projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

  function Get-LocalOrderMirror {
    $mirrorPath = Join-Path $projectRoot 'shopify-orders-summary.json'
    if (-not (Test-Path -LiteralPath $mirrorPath)) {
      return @()
    }

    $mirror = Get-Content -LiteralPath $mirrorPath -Raw | ConvertFrom-Json
    $orders = New-Object System.Collections.Generic.List[object]

    foreach ($item in $mirror) {
      $orders.Add([ordered]@{
        orderId = [string]$item.name
        customerName = [string](Get-FirstValue @($item.customer, ''))
        customerPhone = ''
        customerEmail = [string](Get-FirstValue @($item.email, ''))
        createdAt = [string](Get-FirstValue @($item.createdAt, ''))
        status = [string](Get-FirstValue @($item.financialStatus, ''))
        orderAmount = [string](Get-FirstValue @($item.total, ''))
        confirmedAt = [string](Get-FirstValue @($item.cancelledAt, ''))
        raw = $item
      })
    }

    return $orders
  }

  $allOrders = New-Object System.Collections.Generic.List[object]
  $page = 1
  $limit = 100

  while ($true) {
    Write-Host "Leyendo pedidos de Dropea, pagina $page..."
    try {
      $data = Invoke-DropeaGraphQL -Query $queryAll -Variables @{
        limit = $limit
        page = $page
      }
    }
    catch {
      try {
        $data = Invoke-DropeaGraphQL -Query $queryPending -Variables @{
          status = 'PENDING'
          limit = $limit
          page = $page
        }
      }
      catch {
        $localOrders = Get-LocalOrderMirror
        if ($localOrders.Count -gt 0) {
          $allOrders.AddRange($localOrders)
          break
        }

        throw
      }
    }

    $items = @($data.orders.data)
    if (-not $items -or $items.Count -eq 0) {
      break
    }

    foreach ($order in $items) {
      $allOrders.Add([ordered]@{
        orderId = [string](Get-FirstValue @($order.id, $order.order_id, $order.orderId))
        customerName = if ($order.customer) { $order.customer.full_name } else { $null }
        customerPhone = if ($order.customer) { $order.customer.phone } else { $null }
        customerEmail = if ($order.customer) { $order.customer.email } else { $null }
        createdAt = [string](Get-FirstValue @($order.created_at, $order.createdAt, (Get-Date).ToString('o')))
        status = [string](Get-FirstValue @($order.status, 'PENDING')).ToUpperInvariant()
        orderAmount = [decimal](Get-FirstValue @($order.total_amount, $order.amount, $order.total, 0))
        currencyCode = 'EUR'
        raw = $order
      })
    }

    if ($items.Count -lt $limit) {
      break
    }

    $page++
  }

  if ($allOrders.Count -eq 0) {
    return @{ processed = 0; synced = 0; message = 'No hay pedidos pendientes.' }
  }

  $sheetRows = 0
  foreach ($order in $allOrders) {
    [void](Upsert-SheetRow -SheetId $sheetId -SheetName $sheetName -Order $order)
    $sheetRows++
  }

  return @{ processed = $allOrders.Count; synced = $sheetRows }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Load-EnvFile -Path (Join-Path $scriptDir '..\.env')
Load-EnvFile -Path (Join-Path $scriptDir '..\a.env')

Write-Host 'Sincronizando pedidos de Dropea con Google Sheets...'
$result = Sync-PendingOrdersToSheet
Write-Host ($result | ConvertTo-Json -Depth 8)
