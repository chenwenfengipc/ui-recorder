"""Draws the UI Recorder extension icon and writes the sizes the extension and the store need.

    python store/icon/make_icon.py

Writes icons/icon16.png, icons/icon48.png, icons/icon128.png (RGBA, the extension's own icons) and
store/icon/ui-recorder-icon-1024.png (master copy). The design: a blue rounded square (the UI's accent colour),
a red record button (the recording mark), and a cursor arrow (the clicks that become steps).
"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SIZE = 1024  # master is drawn large and scaled down, so the small sizes stay smooth

BLUE_TOP = (63, 128, 240)
BLUE_BOTTOM = (31, 79, 168)
RED = (255, 71, 71)
WHITE = (255, 255, 255)
INK = (29, 36, 51)


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    px = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        px.line((0, y, size, y), fill=color)
    return img


def draw_icon():
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # blue rounded square
    tile = gradient(SIZE, BLUE_TOP, BLUE_BOTTOM).convert("RGBA")
    base.paste(tile, (0, 0), rounded_mask(SIZE, 225))

    # white ring + red record disc, centred
    cx = cy = 470
    ring_r = 285
    disc_r = 200
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r), fill=WHITE + (255,))
    d.ellipse((cx - disc_r, cy - disc_r, cx + disc_r, cy + disc_r), fill=RED + (255,))
    base = Image.alpha_composite(base, layer)

    # cursor arrow at the bottom right, with a soft shadow so it reads on the blue
    arrow = [(0, 0), (0, 330), (92, 255), (152, 392), (214, 364), (154, 232), (270, 232)]
    scale = 1.0
    ox, oy = 560, 560
    pts = [(ox + x * scale, oy + y * scale) for x, y in arrow]

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 14, y + 16) for x, y in pts], fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    base = Image.alpha_composite(base, shadow)

    cursor = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cursor)
    cd.polygon(pts, fill=WHITE + (255,), outline=INK + (255,), width=18)
    base = Image.alpha_composite(base, cursor)
    return base


def main():
    master = draw_icon()
    store_dir = os.path.join(HERE)
    os.makedirs(store_dir, exist_ok=True)
    master.save(os.path.join(store_dir, "ui-recorder-icon-1024.png"))

    icons_dir = os.path.join(ROOT, "icons")
    for size in (16, 48, 128):
        small = master.resize((size, size), Image.LANCZOS)
        small.save(os.path.join(icons_dir, f"icon{size}.png"), optimize=True)
        print(f"wrote icons/icon{size}.png")
    print("wrote store/icon/ui-recorder-icon-1024.png")


if __name__ == "__main__":
    main()
