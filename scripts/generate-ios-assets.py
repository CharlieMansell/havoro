#!/usr/bin/env python3
"""Generates the iOS app icon and splash screen from Havoro's brand mark.

Capacitor scaffolds an app with its own placeholder artwork, which is what
ships until something replaces it. This redraws the same shape as
client/public/icon.svg — the mark used by the PWA, the desktop build and the
website — so all four look like the same product.

    python3 scripts/generate-ios-assets.py

Re-run it after changing the mark. Nothing else regenerates these; `cap sync`
copies web assets only and never touches Assets.xcassets.

Deliberately drawn rather than rendered from the SVG: it keeps the script free
of a rendering dependency, and the mark is four primitives.
"""

from PIL import Image, ImageDraw
import pathlib

GREEN = (31, 107, 69)      # #1f6b45, the theme colour used everywhere else
WHITE = (255, 255, 255)

ICON_SET = pathlib.Path('ios/App/App/Assets.xcassets/AppIcon.appiconset')
SPLASH_SET = pathlib.Path('ios/App/App/Assets.xcassets/Splash.imageset')


def draw_mark(img, size, scale, offset_x=0, offset_y=0):
    """Draws the roof-and-bars mark. Geometry mirrors icon.svg's 512 viewBox."""
    d = ImageDraw.Draw(img)
    u = size / 512 * scale
    ox = offset_x + (size - 512 * u) / 2
    oy = offset_y + (size - 512 * u) / 2

    def pt(x, y):
        return (ox + x * u, oy + y * u)

    # The roof: a five-point house outline.
    d.polygon([pt(256, 88), pt(412, 220), pt(412, 412), pt(100, 412), pt(100, 220)],
              fill=WHITE)

    # Two bars inside it, in the background colour, reading as a chart.
    for x, y, w, h in ((180, 276, 152, 34), (180, 336, 110, 34)):
        d.rounded_rectangle([pt(x, y), pt(x + w, y + h)], radius=h * u / 2, fill=GREEN)


def build_icon(path, size=1024):
    """A full-bleed square. iOS applies its own corner mask, so rounding the
    corners here would show as a dark fringe inside the mask — and an alpha
    channel makes App Store Connect reject the upload outright."""
    img = Image.new('RGB', (size, size), GREEN)
    draw_mark(img, size, scale=0.62)
    img.save(path, 'PNG')
    return path


def build_splash(path, size=2732):
    """Capacitor uses one square image for every orientation and device, so the
    mark sits small and centred and the background does the rest."""
    img = Image.new('RGB', (size, size), GREEN)
    draw_mark(img, size, scale=0.18)
    img.save(path, 'PNG')
    return path


if __name__ == '__main__':
    icon = build_icon(ICON_SET / 'AppIcon-512@2x.png')
    print(f'wrote {icon}')

    # All three splash entries are the same image — Capacitor's template lists
    # light, dark and universal separately.
    for name in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
        print(f'wrote {build_splash(SPLASH_SET / name)}')
