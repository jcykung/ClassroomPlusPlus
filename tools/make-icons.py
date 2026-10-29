#!/usr/bin/env python3
"""Generate the Classroom++ extension icons (pure stdlib, no Pillow needed).

Renders a rounded-square indigo→blue gradient with a white "++" glyph,
supersampled for smooth edges. Run from the repo root:

    python3 tools/make-icons.py
"""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4  # render at 4x, downsample by averaging

TOP = (63, 81, 181)      # indigo #3F51B5
BOTTOM = (33, 150, 243)  # blue #2196F3
WHITE = (255, 255, 255)
RADIUS_RATIO = 0.24


def mix(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def rounded_mask(x, y, s, radius):
    """Fraction inside a rounded rect [0,1]^2 at scale s."""
    rx = min(max(x, radius), s - radius) - x
    ry = min(max(y, radius), s - radius) - y
    d2 = rx * rx + ry * ry
    if d2 <= radius * radius:
        return 1.0
    return 0.0


def in_plus(x, y, s, cx, cy, arm, thick):
    """Is point (x, y) inside a plus glyph centered at (cx, cy)?"""
    horiz = abs(y - cy) <= thick / 2 and abs(x - cx) <= arm / 2
    vert = abs(x - cx) <= thick / 2 and abs(y - cy) <= arm / 2
    return horiz or vert


def glyph_cover(px, py, supers, size):
    """Supersampled coverage of the white '++' artwork at pixel (px, py)."""
    s = size * supers
    total = 0
    for oy in range(supers):
        for ox in range(supers):
            x = (px * supers + ox + 0.5)
            y = (py * supers + oy + 0.5)
            u, v = x / s, y / s  # normalized
            # Two plus glyphs side by side in the middle band.
            arm = 0.24 * s
            thick = 0.075 * s
            left = in_plus(x, y, s, 0.34 * s, 0.56 * s, arm, thick)
            right = in_plus(x, y, s, 0.66 * s, 0.56 * s, arm, thick)
            if left or right:
                total += 1
    return total / (supers * supers)


def render(size):
    supers = SUPERSAMPLE
    radius = RADIUS_RATIO * size * supers
    pixels = bytearray()
    for py in range(size):
        row = bytearray()
        for px in range(size):
            # background: supersampled rounded-rect mask + vertical gradient
            mask = 0.0
            r = g = b = 0.0
            for oy in range(supers):
                for ox in range(supers):
                    x = px * supers + ox + 0.5
                    y = py * supers + oy + 0.5
                    m = rounded_mask(x, y, size * supers, radius)
                    mask += m
                    t = y / (size * supers)
                    cr, cg, cb = mix(TOP, BOTTOM, t)
                    r += cr * m
                    g += cg * m
                    b += cb * m
            n = supers * supers
            mask /= n
            glyph = glyph_cover(px, py, supers, size)
            if mask <= 0 and glyph <= 0:
                row += bytes((0, 0, 0, 0))
                continue
            r, g, b = r / n, g / n, b / n
            # composite white glyph over the gradient background
            alpha = mask
            if glyph > 0 and mask > 0:
                r = WHITE[0] * glyph + r * (1 - glyph)
                g = WHITE[1] * glyph + g * (1 - glyph)
                b = WHITE[2] * glyph + b * (1 - glyph)
            row += bytes((int(r), int(g), int(b), int(round(alpha * 255))))
        pixels += b"\x00" + bytes(row)  # filter byte 0 per scanline
    return zlib.compress(bytes(pixels), 9), size


def png_chunk(ctype, data):
    chunk = ctype + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk))


def write_png(path, size, compressed):
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", compressed)
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        compressed, _ = render(size)
        path = OUT / f"icon{size}.png"
        write_png(path, size, compressed)
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
