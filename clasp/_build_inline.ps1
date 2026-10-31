# _build_inline.ps1
# Reconstruye Index.html (autocontenido: CSS + JS inline, sin <?!=) a partir del esqueleto y los fuentes.
# Origen : ..\Index.esqueleto.html  +  ..\app.js  +  ..\styles.css
# Destino: ..\Index.html (copia de referencia)  y  .\Index.html (archivo que se desplega con clasp)
$ErrorActionPreference = 'Stop'

$clasp  = $PSScriptRoot
$base   = Split-Path -Parent $clasp

$skeleton = Join-Path $base 'Index.esqueleto.html'
$jsSrc    = Join-Path $base 'app.js'
$cssSrc   = Join-Path $base 'styles.css'

if (-not (Test-Path $skeleton)) { throw 'Falta Index.esqueleto.html' }
if (-not (Test-Path $jsSrc))    { throw 'Falta app.js' }
if (-not (Test-Path $cssSrc))   { throw 'Falta styles.css' }

$html = [System.IO.File]::ReadAllText($skeleton)
$js   = [System.IO.File]::ReadAllText($jsSrc)
$css  = [System.IO.File]::ReadAllText($cssSrc)

$m1 = "<?!= include('styles.html'); ?>"
$m2 = "<?!= include('app.html'); ?>"
if (-not $html.Contains($m1)) { throw 'No aparece el marcador de styles en el esqueleto.' }
if (-not $html.Contains($m2)) { throw 'No aparece el marcador de app en el esqueleto.' }

$html = $html.Replace($m1, $css)
$html = $html.Replace($m2, '<script>' + [Environment]::NewLine + $js + [Environment]::NewLine + '</script>')

if ($html.Contains('<?!=')) { throw 'Aun quedan marcadores <?!= tras reemplazar.' }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$destinoRef   = Join-Path $base 'Index.html'
$destinoClasp = Join-Path $clasp 'Index.html'
[System.IO.File]::WriteAllText($destinoRef,   $html, $utf8)
[System.IO.File]::WriteAllText($destinoClasp, $html, $utf8)

# Copia a la carpeta de publicación estática (lista para Netlify/GitHub Pages)
$pubDir = Join-Path $base 'para-publicar'
New-Item -ItemType Directory -Force -Path $pubDir | Out-Null
$destinoPub = Join-Path $pubDir 'index.html'
[System.IO.File]::WriteAllText($destinoPub, $html, $utf8)
Write-Output ('OK -> ' + $destinoPub + ' (' + (Get-Item $destinoPub).Length + ' bytes)')

Write-Output ('OK -> ' + $destinoRef   + ' (' + (Get-Item $destinoRef).Length   + ' bytes)')
Write-Output ('OK -> ' + $destinoClasp + ' (' + (Get-Item $destinoClasp).Length + ' bytes)')