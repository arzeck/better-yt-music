"""
Generate minimal valid PNG icons for the Chrome extension.
Uses only Python stdlib — no PIL required.
"""
import struct, zlib, os

def make_png(size):
    """Create a solid dark-purple square PNG with a musical note glyph approximated by pixels."""
    # Simple solid color PNG: dark gradient-like background
    # Use a flat #1c1c2e background (29, 28, 46)
    bg = (29, 28, 46)
    fg = (255, 107, 157)  # pink accent

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            # Rounded corners mask
            cx, cy = size / 2, size / 2
            r = size / 2
            corner_r = size * 0.22
            # Simple box fill with rounded corners approximation
            px, py = x - cx, y - cy
            # Check if in rounded-corner zones
            in_corner = False
            for ox, oy in [(-r + corner_r, -r + corner_r),
                           ( r - corner_r, -r + corner_r),
                           (-r + corner_r,  r - corner_r),
                           ( r - corner_r,  r - corner_r)]:
                if (px - ox)**2 + (py - oy)**2 > corner_r**2:
                    if abs(px) > r - corner_r and abs(py) > r - corner_r:
                        in_corner = True
                        break

            if in_corner:
                row.extend([0, 0, 0, 0])  # transparent
                continue

            # Musical note icon (simple pixel art for small sizes)
            # Draw a simplified note: vertical bar on right, filled head lower-left
            nx, ny = x / size, y / size  # normalized 0-1

            # Note stem: right side, top 60%
            in_stem = (0.55 < nx < 0.68) and (0.15 < ny < 0.65)
            # Note flag / beam: horizontal top
            in_beam = (0.35 < nx < 0.68) and (0.15 < ny < 0.26)
            # Note head: oval lower-left
            hx, hy = (nx - 0.38) / 0.22, (ny - 0.70) / 0.18
            in_head = (hx*hx + hy*hy) < 1.0

            if in_stem or in_beam or in_head:
                row.extend([fg[0], fg[1], fg[2], 255])
            else:
                # Background with slight gradient
                mix = (x + y) / (2 * size)
                r2 = int(bg[0] + mix * 8)
                g2 = int(bg[1] + mix * 5)
                b2 = int(bg[2] + mix * 12)
                row.extend([r2, g2, b2, 255])

        pixels.append(bytes(row))

    return encode_png(size, size, pixels)


def encode_png(w, h, rows):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    sig   = b'\x89PNG\r\n\x1a\n'
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))

    raw = b''
    for row in rows:
        raw += b'\x00' + row  # filter byte per scanline

    idat  = chunk(b'IDAT', zlib.compress(raw, 9))
    iend  = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size))
    print(f'Created icon{size}.png ({size}x{size})')

print('Done.')
