<#
  Grok Bot <-> V.A.U.L.T. / B.R.E.A.C.H. koprusu.

  Mesaj gonder ve cevabi bekle:
    powershell -NoProfile -ExecutionPolicy Bypass -File grok.ps1 -Mesaj "merhaba" [-Mod breach|vault]
  Uzun mesaj (UTF-8 dosyadan):
    powershell -NoProfile -ExecutionPolicy Bypass -File grok.ps1 -Dosya C:\yol\mesaj.txt
  Gelen kutusu (B.R.E.A.C.H.'in Grok'a biraktigi mesajlar):
    powershell -NoProfile -ExecutionPolicy Bypass -File grok.ps1 -Gelen
#>
param(
  [string]$Mesaj,
  [string]$Dosya,
  [ValidateSet('breach', 'vault')][string]$Mod = 'breach',
  [switch]$Gelen,
  [switch]$Beklemeden,
  [int]$Sure = 300,
  [int]$Port = 7777
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$base = "http://127.0.0.1:$Port/api"

function Show-Outbox($list) {
  foreach ($m in $list) { Write-Output ("[{0} -> Grok | {1}] {2}" -f $m.from.ToUpper(), $m.at, $m.text) }
}

try {
  if ($Gelen) {
    $r = Invoke-RestMethod "$base/bridge/outbox?to=grok"
    if (-not $r.messages -or $r.messages.Count -eq 0) { Write-Output 'Gelen kutusu bos.' } else { Show-Outbox $r.messages }
    exit 0
  }

  if ($Dosya) { $Mesaj = [IO.File]::ReadAllText($Dosya, [Text.Encoding]::UTF8) }
  if (-not $Mesaj) { Write-Error 'Mesaj bos. -Mesaj "..." veya -Dosya yol.txt kullanin.'; exit 1 }

  $body = @{ text = $Mesaj; from = 'grok'; mode = $Mod; wait = (-not $Beklemeden); timeoutSec = $Sure } | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $r = Invoke-RestMethod "$base/bridge/message" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec ($Sure + 30)

  $name = if ($Mod -eq 'breach') { 'B.R.E.A.C.H.' } else { 'V.A.U.L.T.' }
  switch ($r.status) {
    'done'    { Write-Output "${name}: $($r.text)" }
    'error'   { Write-Output "${name} HATA: $($r.text)"; exit 2 }
    'pending' { Write-Output "Mesaj iletildi, cevap henuz hazir degil (id $($r.id)). Daha sonra: Invoke-RestMethod '$base/bridge/reply?id=$($r.id)'" }
    default   { Write-Output ($r | ConvertTo-Json -Depth 5) }
  }
  if ($r.outbox) { Show-Outbox $r.outbox }
}
catch {
  Write-Output "Kopru hatasi: $($_.Exception.Message)"
  Write-Output "V.A.U.L.T./B.R.E.A.C.H. calisiyor mu? (start.bat ile baslatin, adres $base)"
  exit 3
}
