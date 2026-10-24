#!/usr/bin/env python3
"""Write brand/ASSET-SPEC.md from the files under brand/assets. --check fails on drift."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "brand" / "assets"
SPEC = ROOT / "brand" / "ASSET-SPEC.md"
IMAGE_EXT = {".png", ".gif", ".ico", ".icns", ".svg", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"}


def png_size(data: bytes) -> str:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return "unknown"
    width, height = struct.unpack(">II", data[16:24])
    return f"{width}x{height}"


def gif_info(data: bytes) -> dict:
    info = {"size": "unknown", "frames": 0, "duration_s": 0.0, "loop": "unknown"}
    if len(data) < 13 or data[:6] not in (b"GIF87a", b"GIF89a"):
        return info
    width, height = struct.unpack("<HH", data[6:10])
    info["size"] = f"{width}x{height}"
    packed = data[10]
    i = 13
    if packed & 0x80:
        i += 3 * (2 << (packed & 0x07))
    frames = 0
    delay_cs = 0
    loop = "once"
    while i < len(data):
        block = data[i]
        if block == 0x3B:
            break
        if block == 0x21 and i + 1 < len(data):
            kind = data[i + 1]
            i += 2
            if kind == 0xF9 and i < len(data):
                size = data[i]
                if i + 4 < len(data):
                    delay_cs += struct.unpack("<H", data[i + 2 : i + 4])[0] or 10
                i += size + 1
                if i < len(data) and data[i] == 0:
                    i += 1
                continue
            if kind == 0xFF:
                if i < len(data):
                    size = data[i]
                    app = data[i + 1 : i + 1 + size]
                    i += size + 1
                    sub = []
                    while i < len(data) and data[i] != 0:
                        n = data[i]
                        sub.append(data[i + 1 : i + 1 + n])
                        i += n + 1
                    if i < len(data) and data[i] == 0:
                        i += 1
                    blob = b"".join(sub)
                    if app.startswith(b"NETSCAPE2.0") and len(blob) >= 3 and blob[0] == 1:
                        count = struct.unpack("<H", blob[1:3])[0]
                        loop = "forever" if count == 0 else str(count)
                continue
            while i < len(data) and data[i] != 0:
                i += data[i] + 1
            if i < len(data):
                i += 1
            continue
        if block == 0x2C and i + 9 < len(data):
            frames += 1
            image_packed = data[i + 9]
            i += 10
            if image_packed & 0x80:
                i += 3 * (2 << (image_packed & 0x07))
            if i < len(data):
                i += 1
            while i < len(data) and data[i] != 0:
                i += data[i] + 1
            if i < len(data):
                i += 1
            continue
        i += 1
    info["frames"] = frames
    info["duration_s"] = round(delay_cs / 100, 2)
    info["loop"] = loop
    return info


def ico_size(data: bytes) -> str:
    if len(data) < 6:
        return "unknown"
    count = struct.unpack("<H", data[4:6])[0]
    sizes = []
    for n in range(count):
        off = 6 + n * 16
        if off + 2 > len(data):
            break
        w = data[off] or 256
        h = data[off + 1] or 256
        sizes.append(f"{w}x{h}")
    return ", ".join(sizes) if sizes else "unknown"


def icns_size(data: bytes) -> str:
    sizes = {
        b"ic07": "128x128",
        b"ic08": "256x256",
        b"ic09": "512x512",
        b"ic10": "1024x1024",
        b"ic11": "32x32",
        b"ic12": "64x64",
        b"ic13": "256x256",
        b"ic14": "512x512",
    }
    found = []
    if data[:4] != b"icns" or len(data) < 8:
        return "icns"
    i = 8
    while i + 8 <= len(data):
        kind = data[i : i + 4]
        length = struct.unpack(">I", data[i + 4 : i + 8])[0]
        if kind in sizes:
            found.append(sizes[kind])
        if length < 8:
            break
        i += length
    return ", ".join(found) if found else "icns"


def used_in(name: str) -> str:
    hits = []
    roots = [ROOT / "apps" / "desktop", ROOT / "scripts" / "okvevo", ROOT / "brand"]
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path == SPEC or path.suffix in {".png", ".gif", ".ico", ".icns"}:
                continue
            if any(part in {"node_modules", "dist", "release", "build"} for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if name in text:
                hits.append(path.relative_to(ROOT).as_posix())
    return ", ".join(hits) if hits else "brand asset"


def describe(path: Path) -> str:
    data = path.read_bytes()
    rel = path.relative_to(ROOT).as_posix()
    ext = path.suffix.lower()
    where = used_in(path.name)
    size_bytes = path.stat().st_size
    if ext == ".png":
        return f"| `{rel}` | png | {png_size(data)} | | | | {size_bytes} | {where} |"
    if ext == ".gif":
        info = gif_info(data)
        return (
            f"| `{rel}` | gif | {info['size']} | {info['frames']} | {info['duration_s']}s | {info['loop']} | {size_bytes} | {where} |"
        )
    if ext == ".ico":
        return f"| `{rel}` | ico | {ico_size(data)} | | | | {size_bytes} | {where} |"
    if ext == ".icns":
        return f"| `{rel}` | icns | {icns_size(data)} | | | | {size_bytes} | {where} |"
    if ext == ".svg":
        return f"| `{rel}` | svg | vector | | | | {size_bytes} | {where} |"
    return f"| `{rel}` | {ext.lstrip('.')} | | | | | {size_bytes} | {where} |"


def render() -> str:
    rows = [describe(path) for path in sorted(ASSETS.rglob("*")) if path.is_file() and path.suffix.lower() in IMAGE_EXT]
    lines = [
        "# Brand asset spec",
        "",
        "Generated by `scripts/okvevo/asset_spec.py`. CI fails if this file drifts.",
        "GIF duration treats a 0-centisecond frame delay as 0.1s (browser default).",
        "",
        "| path | format | pixel size | gif frames | gif duration | gif loop | bytes | used in |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        *rows,
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        current = SPEC.read_text(encoding="utf-8") if SPEC.exists() else ""
        if current != text:
            print("brand/ASSET-SPEC.md does not match brand/assets. Run: python3 scripts/okvevo/asset_spec.py --write", file=sys.stderr)
            return 1
        print("brand/ASSET-SPEC.md matches brand/assets")
        return 0
    if "--write" in sys.argv or "--check" not in sys.argv:
        SPEC.write_text(text, encoding="utf-8")
        print(f"wrote {SPEC.relative_to(ROOT)}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
