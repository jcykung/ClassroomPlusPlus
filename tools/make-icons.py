#!/usr/bin/env python3
"""Generate the Classroom++ extension icons (pure stdlib, no Pillow needed).

Renders a green chalkboard with a warm wooden frame (just like Google Classroom)
and a white chalk '++' symbol in the center.

Run from the repo root:
    python3 tools/make-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4  # render at 4x, downsample by averaging

# Google Classroom Chalkboard Colors
FRAME_OUTER = (229, 169, 60)   # Warm amber/wood frame top #E5A93C
FRAME_INNER = (200, 134, 25)   # Warm amber/wood frame bottom #C88619
BOARD_TOP   = (22, 128, 60)    # Chalkboard green top #16803C
BOARD_BOT   = (15, 95, 43)     # Chalkboard green bottom #0F5F2B
WHITE       = (255, 255, 255)  # White chalk

RADIUS_RATIO = 0.20       # Outer corner radius
INNER_RADIUS_RATIO = 0.10 # Inner chalkboard corner radius
FRAME_THICKNESS = 0.10    # Frame width relative to size


def mix(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def rounded_rect_dist(x, y, w, h, r):
    """Distance to rounded rectangle [0, w] x [0, h] with corner radius r.
    Negative inside, positive outside."""
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    dx = x - cx
    dy = y - cy
    return math.hypot(dx, dy) - r


def in_plus(x, y, s, cx, cy, arm, thick):
    """Is point (x, y) inside a plus glyph centered at (cx, cy)?"""
    horiz = abs(y - cy) <= thick / 2 and abs(x - cx) <= arm / 2
    vert = abs(x - cx) <= thick / 2 and abs(y - cy) <= arm / 2
    return horiz or vert


def glyph_cover(x, y, s):
    """Check if point (x, y) is inside the '++' chalk glyphs."""
    arm = 0.22 * s
    thick = 0.065 * s
    cy = 0.50 * s
    left = in_plus(x, y, s, 0.36 * s, cy, arm, thick)
    right = in_plus(x, y, s, 0.64 * s, cy, arm, thick)
    return left or right


def render(size):
    supers = SUPERSAMPLE
    s = size * supers
    outer_r = RADIUS_RATIO * s
    frame_w = FRAME_THICKNESS * s
    inner_w = s - 2 * frame_w
    inner_h = s - 2 * frame_w
    inner_r = INNER_RADIUS_RATIO * s

    pixels = bytearray()
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r_acc = g_acc = b_acc = a_acc = 0.0
            for oy in range(supers):
                for ox in range(supers):
                    x = px * supers + ox + 0.5
                    y = py * supers + oy + 0.5

                    # 1. Outer rounded rectangle (The Wood Frame)
                    d_outer = rounded_rect_dist(x, y, s, s, outer_r)
                    if d_outer > 0:
                        continue  # Outside the entire icon

                    # Frame color gradient
                    t_y = y / s
                    fr, fg, fb = mix(FRAME_OUTER, FRAME_INNER, t_y)

                    # 2. Inner rounded rectangle (The Green Chalkboard)
                    ix = x - frame_w
                    iy = y - frame_w
                    d_inner = rounded_rect_dist(ix, iy, inner_w, inner_h, inner_r)

                    if d_inner <= 0:
                        # Inside chalkboard
                        t_inner = iy / inner_h if inner_h > 0 else 0.5
                        br, bg, bb = mix(BOARD_TOP, BOARD_BOT, t_inner)

                        # Chalk ++ glyph
                        if glyph_cover(x, y, s):
                            cr, cg, cb = WHITE
                        else:
                            cr, cg, cb = br, bg, bb
                    elif d_inner < 1.0:
                        # Antialiased border transition between frame and board
                        blend = d_inner
                        t_inner = max(0, min(1, iy / inner_h)) if inner_h > 0 else 0.5
                        br, bg, bb = mix(BOARD_TOP, BOARD_BOT, t_inner)
                        cr = int(round(br * (1 - blend) + fr * blend))
                        cg = int(round(bg * (1 - blend) + fg * blend))
                        cb = int(round(bb * (1 - blend) + fb * blend))
                    else:
                        # Frame
                        cr, cg, cb = fr, fg, fb

                    # Antialiased outer edge
                    alpha = 1.0
                    if d_outer > -1.0:
                        alpha = max(0.0, min(1.0, -d_outer))

                    r_acc += cr * alpha
                    g_acc += cg * alpha
                    b_acc += cb * alpha
                    a_acc += alpha

            n = supers * supers
            alpha = a_acc / n
            if alpha <= 0.001:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((
                    int(round(r_acc / a_acc)),
                    int(round(g_acc / a_acc)),
                    int(round(b_acc / a_acc)),
                    int(round(alpha * 255))
                ))
        pixels += b"\x00" + bytes(row)
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
