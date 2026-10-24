#!/usr/bin/env bash
# Build the three brand icons from one 1024x1024 PNG.
# Output: brand/assets/apps/desktop/assets/icon.icns, icon.ico, icon.png
# Pack does not run this. ImageMagick is required for the .ico.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=${OKVEVO_ICON_OUT:-$root/brand/assets/apps/desktop/assets}
if [[ $# -ne 1 ]]; then
  echo "usage: make_icons.sh path/to/1024.png" >&2
  exit 2
fi
src=$1
width=$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}')
height=$(sips -g pixelHeight "$src" | awk '/pixelHeight/{print $2}')
if [[ "$width" != 1024 || "$height" != 1024 ]]; then
  echo "input must be 1024x1024, got ${width}x${height}" >&2
  exit 1
fi
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
iset="$tmp/icon.iconset"
mkdir -p "$iset"
while IFS=: read -r size name; do
  sips -z "$size" "$size" "$src" --out "$iset/$name" >/dev/null
done <<'EOF'
16:icon_16x16.png
32:icon_16x16@2x.png
32:icon_32x32.png
64:icon_32x32@2x.png
128:icon_128x128.png
256:icon_128x128@2x.png
256:icon_256x256.png
512:icon_256x256@2x.png
512:icon_512x512.png
1024:icon_512x512@2x.png
EOF
iconutil -c icns "$iset" -o "$out/icon.icns"
sips -z 1024 1024 "$src" --out "$out/icon.png" >/dev/null
if command -v convert >/dev/null 2>&1; then
  convert "$src" -define icon:auto-resize=256,128,64,48,32,16 "$out/icon.ico"
elif command -v magick >/dev/null 2>&1; then
  magick "$src" -define icon:auto-resize=256,128,64,48,32,16 "$out/icon.ico"
else
  echo "ImageMagick convert or magick is required for icon.ico. Install with: brew install imagemagick" >&2
  exit 1
fi
