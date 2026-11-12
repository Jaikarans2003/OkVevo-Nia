#!/usr/bin/env bash
# Build OkVevo brand icons from one 1024x1024 PNG (Apple HIG ~80% safe-area pad).
# Outputs under brand/assets (desktop app icons, bootstrap installer icons,
# desktop packaging DMG volume icon). Pack overlays these; it does not run this.
# ImageMagick is required for .ico.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
desktop_out=${OKVEVO_ICON_OUT:-$root/brand/assets/apps/desktop/assets}
bootstrap_out=$root/brand/assets/apps/bootstrap-installer/src-tauri/icons
packaging_out=$root/brand/assets/apps/desktop/packaging
public_out=$root/brand/assets/apps/desktop/public
# Apple HIG: keep artwork inside ~80% of the canvas so Dock/taskbar masks fit.
ARTWORK=820
MASTER=1024
if [[ $# -ne 1 ]]; then
  echo "usage: make_icons.sh path/to/1024.png" >&2
  exit 2
fi
src=$1
if [[ ! -f "$src" ]]; then
  echo "missing source: $src" >&2
  exit 1
fi
width=$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}')
height=$(sips -g pixelHeight "$src" | awk '/pixelHeight/{print $2}')
if [[ "$width" != 1024 || "$height" != 1024 ]]; then
  echo "input must be 1024x1024, got ${width}x${height}" >&2
  exit 1
fi
mkdir -p "$desktop_out" "$bootstrap_out" "$packaging_out" "$public_out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
scaled="$tmp/artwork.png"
padded="$tmp/padded.png"
master="$tmp/master.png"
sips -z "$ARTWORK" "$ARTWORK" "$src" --out "$scaled" >/dev/null
sips --padToHeightWidth "$MASTER" "$MASTER" "$scaled" --out "$padded" >/dev/null
# iconutil rejects Display P3 masters; bake sRGB for a valid iconset.
sips -s format png --matchTo '/System/Library/ColorSync/Profiles/sRGB Profile.icc' "$padded" --out "$master" >/dev/null
iset="$tmp/icon.iconset"
mkdir -p "$iset"
while IFS=: read -r size name; do
  sips -z "$size" "$size" "$master" --out "$iset/$name" >/dev/null
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
iconutil -c icns "$iset" -o "$desktop_out/icon.icns"
sips -z 1024 1024 "$master" --out "$desktop_out/icon.png" >/dev/null
if command -v convert >/dev/null 2>&1; then
  convert "$master" -define icon:auto-resize=256,128,64,48,32,16 "$desktop_out/icon.ico"
elif command -v magick >/dev/null 2>&1; then
  magick "$master" -define icon:auto-resize=256,128,64,48,32,16 "$desktop_out/icon.ico"
else
  echo "ImageMagick convert or magick is required for icon.ico. Install with: brew install imagemagick" >&2
  exit 1
fi
# UI mark + touch icon (same padded master).
cp "$master" "$public_out/okvevo.png"
cp "$master" "$public_out/apple-touch-icon.png"
cp "$master" "$desktop_out/okvevo.png"
# Bootstrap installer icons + shared DMG volume artwork (same master).
cp "$desktop_out/icon.icns" "$bootstrap_out/icon.icns"
cp "$desktop_out/icon.ico" "$bootstrap_out/icon.ico"
cp "$desktop_out/icon.icns" "$packaging_out/dmg-volume.icns"
sips -z 32 32 "$master" --out "$bootstrap_out/32x32.png" >/dev/null
sips -z 128 128 "$master" --out "$bootstrap_out/128x128.png" >/dev/null
sips -z 256 256 "$master" --out "$bootstrap_out/128x128@2x.png" >/dev/null
echo "wrote $desktop_out/icon.{icns,ico,png}"
echo "wrote $bootstrap_out/{icon.icns,icon.ico,32x32.png,128x128.png,128x128@2x.png}"
echo "wrote $packaging_out/dmg-volume.icns"
echo "wrote $public_out/{okvevo.png,apple-touch-icon.png}"
