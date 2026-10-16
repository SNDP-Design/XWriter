"""Draw the XWriter toolbar icons: a Supabase-green tile with a dark X and a text cursor."""

import math
import struct
import zlib
from pathlib import Path

GREEN = (0x3E, 0xCF, 0x8E)
INK = (0x17, 0x17, 0x17)
SUPERSAMPLE = 6
OUT = Path(__file__).resolve().parent.parent / "icons"


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def in_rounded_rect(x, y, left, top, right, bottom, radius):
    if not (left <= x <= right and top <= y <= bottom):
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return math.hypot(x - cx, y - cy) <= radius


def shade(x, y):
    """Return (rgb, alpha) for a point in a 1x1 unit square."""
    if not in_rounded_rect(x, y, 0.0, 0.0, 1.0, 1.0, 0.24):
        return None, 0.0

    stroke = 0.075
    if segment_distance(x, y, 0.22, 0.25, 0.54, 0.71) <= stroke:
        return INK, 1.0
    if segment_distance(x, y, 0.54, 0.25, 0.22, 0.71) <= stroke:
        return INK, 1.0
    if in_rounded_rect(x, y, 0.66, 0.68, 0.84, 0.78, 0.04):
        return INK, 1.0
    return GREEN, 1.0


def render(size):
    rows = []
    n = SUPERSAMPLE
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(n):
                for sx in range(n):
                    color, alpha = shade((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size)
                    if alpha:
                        r += color[0] * alpha
                        g += color[1] * alpha
                        b += color[2] * alpha
                        a += alpha
            samples = n * n
            if a:
                row += bytes([round(r / a), round(g / a), round(b / a), round(255 * a / samples)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, pixels):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels, 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    for size in (16, 32, 48, 128):
        (OUT / f"icon{size}.png").write_bytes(png(size, render(size)))
        print(f"icon{size}.png")
