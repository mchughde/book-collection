"""Draws the app icons (three books on a shelf) as PNGs, using only the standard library.

Run from the project folder:  python3 tools/make_icons.py
"""
import struct
import zlib

BG = (246, 241, 231)
SHELF = (93, 83, 70)
# (left, top, right, colour, band colour) on a 0-1 grid; books stand on the shelf at 0.74.
BOOKS = [
    (0.22, 0.26, 0.36, (122, 46, 42), (217, 180, 120)),
    (0.38, 0.20, 0.53, (47, 93, 80), (217, 180, 120)),
    (0.55, 0.32, 0.67, (59, 79, 122), (217, 180, 120)),
]


def pixel(x, y):
    # A leaning fourth book, drawn as a parallelogram.
    lean_left = 0.735 - (0.74 - y) * 0.18
    if 0.36 <= y <= 0.74 and lean_left <= x <= lean_left + 0.11:
        band = 0.44 <= y <= 0.47
        return (217, 180, 120) if band else (138, 106, 43)
    for left, top, right, colour, band_colour in BOOKS:
        if left <= x <= right and top <= y <= 0.74:
            if top + 0.06 <= y <= top + 0.085 or 0.64 <= y <= 0.665:
                return band_colour
            return colour
    if 0.15 <= x <= 0.85 and 0.74 <= y <= 0.78:
        return SHELF
    return BG


def png(size, path):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            # 2x2 supersampling for smoother edges on the leaning book.
            samples = [pixel((px + dx) / size, (py + dy) / size) for dx in (0.25, 0.75) for dy in (0.25, 0.75)]
            row += bytes(sum(s[i] for s in samples) // 4 for i in range(3))
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', raw))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    png(192, 'icon-192.png')
    png(512, 'icon-512.png')
    png(180, 'apple-touch-icon.png')
    print('icons written')
