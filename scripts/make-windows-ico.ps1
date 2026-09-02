Add-Type -AssemblyName System.Drawing

function Render-LogoBitmap([int]$dim) {
    $bmp = New-Object System.Drawing.Bitmap($dim, $dim, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $s = $dim / 512.0

    # Background squircle
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $dim, $dim)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, [System.Drawing.Color]::FromArgb(255, 13, 15, 21), [System.Drawing.Color]::FromArgb(255, 5, 6, 8), 45.0)
    
    # Path for rounded rectangle
    $rad = [float](112.0 * $s)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [float]($dim - 1)
    $path.AddArc(0, 0, $rad * 2, $rad * 2, 180, 90)
    $path.AddArc($d - $rad * 2, 0, $rad * 2, $rad * 2, 270, 90)
    $path.AddArc($d - $rad * 2, $d - $rad * 2, $rad * 2, $rad * 2, 0, 90)
    $path.AddArc(0, $d - $rad * 2, $rad * 2, $rad * 2, 90, 90)
    $path.CloseFigure()

    $g.FillPath($bgBrush, $path)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(35, 255, 255, 255), [float](2.0 * $s))
    $g.DrawPath($borderPen, $path)

    # Center coords
    $cx = [float]($dim / 2.0)
    $cy = [float]($dim / 2.0)

    # Carrier rings
    $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 56, 189, 248), [float](1.5 * $s))
    $g.DrawEllipse($ringPen, [float]($cx - 210 * $s), [float]($cy - 210 * $s), [float](420 * $s), [float](420 * $s))
    $g.DrawEllipse($ringPen, [float]($cx - 160 * $s), [float]($cy - 160 * $s), [float](320 * $s), [float](320 * $s))

    # Sonic waves left & right
    $w1 = [float](12.0 * $s)
    $w2 = [float](9.0 * $s)
    $w3 = [float](7.0 * $s)
    if ($w1 -lt 1.5) { $w1 = 1.5 }
    if ($w2 -lt 1.2) { $w2 = 1.2 }
    if ($w3 -lt 1.0) { $w3 = 1.0 }

    $p1 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 56, 189, 248), $w1)
    $p2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 37, 99, 235), $w2)
    $p3 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(160, 37, 99, 235), $w3)

    # Left
    $g.DrawArc($p1, [float]($cx - 100 * $s), [float]($cy - 100 * $s), [float](200 * $s), [float](200 * $s), 115.0, 130.0)
    $g.DrawArc($p2, [float]($cx - 160 * $s), [float]($cy - 160 * $s), [float](320 * $s), [float](320 * $s), 125.0, 110.0)
    $g.DrawArc($p3, [float]($cx - 220 * $s), [float]($cy - 220 * $s), [float](440 * $s), [float](440 * $s), 135.0, 90.0)

    # Right
    $g.DrawArc($p1, [float]($cx - 100 * $s), [float]($cy - 100 * $s), [float](200 * $s), [float](200 * $s), -65.0, 130.0)
    $g.DrawArc($p2, [float]($cx - 160 * $s), [float]($cy - 160 * $s), [float](320 * $s), [float](320 * $s), -55.0, 110.0)
    $g.DrawArc($p3, [float]($cx - 220 * $s), [float]($cy - 220 * $s), [float](440 * $s), [float](440 * $s), -45.0, 90.0)

    # Center Bars
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $bw1 = [float](10.0 * $s)
    if ($bw1 -lt 1.5) { $bw1 = 1.5 }
    $g.FillRectangle($white, [float]($cx - $bw1 / 2), [float]($cy - 144 * $s), $bw1, [float](288 * $s))

    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 203, 213, 225))
    $bw2 = [float](8.0 * $s)
    if ($bw2 -lt 1.0) { $bw2 = 1.0 }
    $g.FillRectangle($subBrush, [float]($cx - 23 * $s - $bw2 / 2), [float]($cy - 104 * $s), $bw2, [float](208 * $s))
    $g.FillRectangle($subBrush, [float]($cx + 23 * $s - $bw2 / 2), [float]($cy - 104 * $s), $bw2, [float](208 * $s))

    # Center node
    $cyan = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
    $nr = [float](14.0 * $s)
    if ($nr -lt 2.0) { $nr = 2.0 }
    $g.FillEllipse($cyan, [float]($cx - $nr), [float]($cy - $nr), [float]($nr * 2), [float]($nr * 2))

    $g.Dispose()
    return $bmp
}

# Build true Windows DIB-based ICO for sizes 16, 32, 48, 64, 128, 256
$sizes = @(16, 32, 48, 64, 128, 256)
$images = @()

foreach ($sz in $sizes) {
    $bmp = Render-LogoBitmap $sz
    
    if ($sz -eq 256) {
        # 256x256 is stored as PNG
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $ms.Dispose()
        $images += ,@($sz, $bytes, $true)
    } else {
        # Standard uncompressed 32-bit DIB
        $dibMs = New-Object System.IO.MemoryStream
        $bw = New-Object System.IO.BinaryWriter($dibMs)
        
        # BITMAPINFOHEADER (40 bytes)
        $bw.Write([uint32]40)              # biSize
        $bw.Write([int32]$sz)              # biWidth
        $bw.Write([int32]($sz * 2))        # biHeight (doubled for XOR + AND)
        $bw.Write([uint16]1)               # biPlanes
        $bw.Write([uint16]32)              # biBitCount (32-bit BGRA)
        $bw.Write([uint32]0)               # biCompression (BI_RGB)
        $xorSize = $sz * $sz * 4
        $andRowBytes = [int]([Math]::Ceiling($sz / 32.0) * 4)
        $andSize = $andRowBytes * $sz
        $bw.Write([uint32]($xorSize + $andSize)) # biSizeImage
        $bw.Write([int32]0)                # biXPelsPerMeter
        $bw.Write([int32]0)                # biYPelsPerMeter
        $bw.Write([uint32]0)               # biClrUsed
        $bw.Write([uint32]0)               # biClrImportant

        # Pixel data (bottom-up BGRA)
        for ($y = $sz - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $sz; $x++) {
                $c = $bmp.GetPixel($x, $y)
                $bw.Write([byte]$c.B)
                $bw.Write([byte]$c.G)
                $bw.Write([byte]$c.R)
                $bw.Write([byte]$c.A)
            }
        }

        # AND mask (1 bit per pixel, bottom-up, all 0 for 32-bit alpha)
        $andBytes = New-Object byte[] $andSize
        $bw.Write($andBytes)

        $bw.Flush()
        $bytes = $dibMs.ToArray()
        $dibMs.Dispose()
        $images += ,@($sz, $bytes, $false)
    }
    $bmp.Dispose()
}

# Write ICONDIR
$icoMs = New-Object System.IO.MemoryStream
$icoWriter = New-Object System.IO.BinaryWriter($icoMs)

$icoWriter.Write([uint16]0)                # idReserved
$icoWriter.Write([uint16]1)                # idType (1 = icon)
$icoWriter.Write([uint16]$images.Count)    # idCount

$headerSize = 6 + ($images.Count * 16)
$currentOffset = $headerSize

# Directory entries
foreach ($img in $images) {
    $sz = $img[0]
    $data = $img[1]
    
    $icoWriter.Write([byte]$(if ($sz -eq 256) { 0 } else { $sz })) # bWidth
    $icoWriter.Write([byte]$(if ($sz -eq 256) { 0 } else { $sz })) # bHeight
    $icoWriter.Write([byte]0)               # bColorCount
    $icoWriter.Write([byte]0)               # bReserved
    $icoWriter.Write([uint16]1)             # wPlanes
    $icoWriter.Write([uint16]32)            # wBitCount
    $icoWriter.Write([uint32]$data.Length)  # dwBytesInRes
    $icoWriter.Write([uint32]$currentOffset)# dwImageOffset

    $currentOffset += $data.Length
}

# Image data
foreach ($img in $images) {
    $icoWriter.Write($img[1])
}

$icoWriter.Flush()
[System.IO.File]::WriteAllBytes("assets/icon.ico", $icoMs.ToArray())
$icoMs.Dispose()
Write-Output "Successfully generated production-standard assets/icon.ico with $($images.Count) resolutions!"
