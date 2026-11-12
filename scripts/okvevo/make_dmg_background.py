#!/usr/bin/env python3
"""Paint OkVevo DMG Finder backgrounds (1x 660×400 + 2x 1320×800).

Clean paper wash + brand orange. Only figurative paint: "Drag to Install" and
one horizontal arrow between the icon slots. No wordmark, no down-arrow.
Brand orange from brand/nia.json. Pillow only.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "brand" / "assets" / "apps" / "desktop" / "packaging"
BRAND = ROOT / "brand" / "nia.json"

W, H = 660, 400
PAPER = (244, 242, 238, 255)  # #f4f2ee
SAND = (227, 220, 214, 255)  # #e3dcd6


def brand_orange() -> tuple[int, int, int]:
    hex_ = json.loads(BRAND.read_text(encoding="utf-8"))["palette"]["orange"].lstrip("#")
    return tuple(int(hex_[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def soft_wash(size: tuple[int, int], orange: tuple[int, int, int]) -> Image.Image:
    """Abstract paper + sand + soft orange blobs — no figurative marks."""
    w, h = size
    canvas = Image.new("RGBA", size, PAPER)
    wash = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    # Soft sand pools (top / corners) — keep icon strip clear of ink.
    d.ellipse((-w // 5, -h // 4, w // 2, h // 3), fill=(*SAND[:3], 90))
    d.ellipse((w // 2, -h // 5, w + w // 4, h // 2), fill=(*SAND[:3], 70))
    d.ellipse((w // 4, h // 2, w, h + h // 4), fill=(*SAND[:3], 55))
    # Faint orange accents in the top third only (not a mark / arrow).
    d.ellipse((w // 3, -h // 8, 2 * w // 3, h // 4), fill=(*orange, 28))
    d.ellipse((int(w * 0.55), int(h * 0.05), int(w * 0.85), int(h * 0.28)), fill=(*orange, 18))
    canvas = Image.alpha_composite(canvas, wash.filter(ImageFilter.GaussianBlur(radius=max(12, w // 40))))
    # Paper grain
    grain = Image.effect_noise(size, 10).convert("L").point(lambda p: 128 + (p - 128) // 7)
    grain_rgba = Image.merge("RGBA", (grain, grain, grain, Image.new("L", size, 22)))
    return Image.alpha_composite(canvas, grain_rgba)


def paint_drag_arrow(canvas: Image.Image, orange: tuple[int, int, int]) -> None:
    """Only figurative paint: centered 'Drag to Install' + one rightward arrow."""
    w, h = canvas.size
    scale = w / W
    y = int(175 * scale)
    x0, x1 = int(180 * scale), int(480 * scale)
    mid = (x0 + x1) // 2

    # Mid-light veil over icons + warm mid-sand under Finder labels (light+dark).
    veil = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    vd.rectangle((0, int(y - 70 * scale), w, int(y + 120 * scale)), fill=(244, 242, 238, 100))
    vd.rectangle((0, int(y + 48 * scale), w, int(y + 100 * scale)), fill=(168, 162, 154, 235))
    canvas.alpha_composite(veil)

    arrow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arrow)
    shaft_y = y
    left = x0 + int(70 * scale)
    right = x1 - int(70 * scale)
    ad.line((left, shaft_y, right, shaft_y), fill=(*orange, 210), width=max(2, int(3 * scale)))
    tip = right
    ad.polygon(
        [
            (tip, shaft_y),
            (tip - int(14 * scale), shaft_y - int(10 * scale)),
            (tip - int(14 * scale), shaft_y + int(10 * scale)),
        ],
        fill=(*orange, 230),
    )
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size=max(11, int(13 * scale)))
    except OSError:
        font = ImageFont.load_default()
    label = "Drag to Install"
    bbox = ad.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    ad.text((mid - tw // 2, shaft_y - int(28 * scale)), label, fill=(42, 42, 42, 210), font=font)
    canvas.alpha_composite(arrow)


def render(scale: int) -> Image.Image:
    size = (W * scale, H * scale)
    orange = brand_orange()
    canvas = soft_wash(size, orange)
    paint_drag_arrow(canvas, orange)
    return canvas.filter(ImageFilter.SMOOTH)


def write_png(path: Path, im: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = Image.new("RGB", im.size, PAPER[:3])
    rgb.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
    rgb.save(path, format="PNG", optimize=True)
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    print(f"wrote {path.relative_to(ROOT)} {width}x{height}")


def main() -> int:
    if not BRAND.is_file():
        print(f"missing {BRAND}", file=sys.stderr)
        return 1
    write_png(OUT_DIR / "dmg-background.png", render(1))
    write_png(OUT_DIR / "dmg-background@2x.png", render(2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
