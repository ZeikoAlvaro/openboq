# =========================================================================
#  OpenBOQ escritorio - generador del icono de Windows
# -------------------------------------------------------------------------
#  Windows necesita un .ico con varios tamanios; el icono.svg del proyecto
#  no sirve para el ejecutable ni para el instalador. Este script dibuja el
#  mismo simbolo del favicon (cuadro azul redondeado con "BQ" en blanco) en
#  16/24/32/48/64/128/256 y los arma en un solo icono.ico.
#
#  Cada tamanio se guarda como PNG dentro del .ico. Windows Vista en
#  adelante lo entiende, asi que cubre de Windows 7 a Windows 11.
#
#  Uso:
#      powershell -ExecutionPolicy Bypass -File hacer-icono.ps1
# =========================================================================
Add-Type -AssemblyName System.Drawing

$destino = Join-Path $PSScriptRoot 'icono.ico'
$tamanios = @(16, 24, 32, 48, 64, 128, 256)
$azul = [System.Drawing.ColorTranslator]::FromHtml('#1F3864')

$pngs = @()
foreach ($n in $tamanios) {
  $bmp = New-Object System.Drawing.Bitmap($n, $n, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # cuadro redondeado
  $r = [Math]::Max(2, [int]($n * 0.1875))
  $ruta = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $ruta.AddArc(0, 0, $d, $d, 180, 90)
  $ruta.AddArc($n - $d, 0, $d, $d, 270, 90)
  $ruta.AddArc($n - $d, $n - $d, $d, $d, 0, 90)
  $ruta.AddArc(0, $n - $d, $d, $d, 90, 90)
  $ruta.CloseFigure()
  $pincel = New-Object System.Drawing.SolidBrush($azul)
  $g.FillPath($pincel, $ruta)

  # letras
  $familia = 'Segoe UI'
  try { $f = New-Object System.Drawing.Font($familia, ($n * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
  catch { $f = New-Object System.Drawing.Font('Arial', ($n * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $blanco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $caja = New-Object System.Drawing.RectangleF(0, ($n * 0.02), $n, $n)
  $g.DrawString('BQ', $f, $blanco, $caja, $fmt)

  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,@($n, $ms.ToArray())
  $bmp.Dispose(); $ms.Dispose()
}

# --- contenedor .ico ---
$fs = [System.IO.File]::Create($destino)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)               # reservado
$bw.Write([UInt16]1)               # 1 = icono
$bw.Write([UInt16]$pngs.Count)

$desplazamiento = 6 + (16 * $pngs.Count)
foreach ($p in $pngs) {
  $n = $p[0]; $datos = $p[1]
  $dim = 0; if ($n -lt 256) { $dim = $n }
  $bw.Write([Byte]$dim)             # ancho  (0 = 256)
  $bw.Write([Byte]$dim)             # alto
  $bw.Write([Byte]0)               # colores de paleta
  $bw.Write([Byte]0)               # reservado
  $bw.Write([UInt16]1)             # planos
  $bw.Write([UInt16]32)            # bits por pixel
  $bw.Write([UInt32]$datos.Length)
  $bw.Write([UInt32]$desplazamiento)
  $desplazamiento += $datos.Length
}
foreach ($p in $pngs) { $bw.Write($p[1]) }
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Output ("icono.ico -> " + $destino + "  (" + (Get-Item $destino).Length + " bytes, " + $pngs.Count + " tamanios)")
