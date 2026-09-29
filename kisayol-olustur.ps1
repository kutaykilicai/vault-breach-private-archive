# Masaustune V.A.U.L.T. // B.R.E.A.C.H. kisayolu olusturur (simgeyi de uretir).
# Calistirmak icin: sag tik > "PowerShell ile calistir"  veya
#   powershell -NoProfile -ExecutionPolicy Bypass -File kisayol-olustur.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path $root 'assets'
$ico = Join-Path $assets 'vault-breach.ico'

if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  New-Item -ItemType Directory -Force -Path $assets | Out-Null
  $S = 256
  $bmp = New-Object System.Drawing.Bitmap $S, $S
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 6, 10, 20))
  $g.FillEllipse($bg, 8, 8, 240, 240)

  $blue = [System.Drawing.Color]::FromArgb(255, 58, 160, 255)
  $red = [System.Drawing.Color]::FromArgb(255, 255, 46, 77)
  $penB = New-Object System.Drawing.Pen $blue, 18
  $penR = New-Object System.Drawing.Pen $red, 18
  $g.DrawArc($penB, 34, 34, 188, 188, 100, 160)
  $g.DrawArc($penR, 34, 34, 188, 188, 280, 160)

  $thinB = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 58, 160, 255)), 4
  $thinR = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 255, 46, 77)), 4
  $g.DrawArc($thinB, 70, 70, 116, 116, 110, 140)
  $g.DrawArc($thinR, 70, 70, 116, 116, 290, 140)

  $core = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 100, 100, 56, 56), $blue, $red, 0.0
  $g.FillEllipse($core, 100, 100, 56, 56)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $fs = [System.IO.File]::Create($ico)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
  $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
  $w.Write($png)
  $w.Close()
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'V.A.U.L.T. - B.R.E.A.C.H..lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $root 'start.bat'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$ico,0"
$lnk.WindowStyle = 7
$lnk.Description = 'V.A.U.L.T. // B.R.E.A.C.H. yerel AI ajan'
$lnk.Save()
Write-Output "Kisayol olusturuldu: $lnkPath"
