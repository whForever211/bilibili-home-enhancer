# 生成扩展图标（粉底白色“找回”环形箭头）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-icons.ps1
# 输出：icons/icon16/32/48/128.png
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function GetPoint([double]$cx, [double]$cy, [double]$angDeg, [double]$rad) {
  $x = $cx + $rad * [Math]::Cos($angDeg * [Math]::PI / 180.0)
  $y = $cy + $rad * [Math]::Sin($angDeg * [Math]::PI / 180.0)
  return New-Object System.Drawing.PointF([float]$x, [float]$y)
}

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pink = [System.Drawing.Color]::FromArgb(251, 114, 153)
  $white = [System.Drawing.Color]::White

  # 圆角粉色底
  $m = [double]$size * 0.04
  $r = [double]$size * 0.22
  $w = [double]$size - 2.0 * $m
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2.0 * $r
  $path.AddArc([float]$m, [float]$m, [float]$d, [float]$d, 180, 90)
  $path.AddArc([float]($m + $w - $d), [float]$m, [float]$d, [float]$d, 270, 90)
  $path.AddArc([float]($m + $w - $d), [float]($m + $w - $d), [float]$d, [float]$d, 0, 90)
  $path.AddArc([float]$m, [float]($m + $w - $d), [float]$d, [float]$d, 90, 90)
  $path.CloseFigure()
  $bgBrush = New-Object System.Drawing.SolidBrush($pink)
  $g.FillPath($bgBrush, $path)

  # 环形箭头：右侧留缺口（约 ±65°）
  $penWidth = [float]($size * 0.085)
  $pen = New-Object System.Drawing.Pen($white, $penWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cx = $size / 2.0
  $cy = $size * 0.54
  $ringR = $size * 0.26
  $ringRect = New-Object System.Drawing.RectangleF(
    [float]($cx - $ringR), [float]($cy - $ringR), [float](2.0 * $ringR), [float](2.0 * $ringR))
  $g.DrawArc($pen, $ringRect, 65, 230)

  # 箭头头部（缺口上端）
  $t = $size * 0.10
  $p1 = GetPoint $cx $cy -78 $ringR
  $p2 = GetPoint $cx $cy -28 ($ringR - 1.25 * $t)
  $p3 = GetPoint $cx $cy -20 ($ringR + 1.25 * $t)
  $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tri.AddLine($p1, $p2)
  $tri.AddLine($p2, $p3)
  $tri.CloseFigure()
  $wBrush = New-Object System.Drawing.SolidBrush($white)
  $g.FillPath($wBrush, $tri)

  $g.Dispose()
  $outFile = Join-Path $outDir ("icon" + $size + ".png")
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("written " + $outFile)
}
