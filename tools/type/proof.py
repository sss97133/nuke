"""Quick raster proof of a built font: python proof.py font.otf out.png "line one" "line two" ... (sizes 96/36/14)."""
import sys

from PIL import Image, ImageDraw, ImageFont

font, out, *lines = sys.argv[1:]
import os
sizes = [int(s) for s in os.environ.get("SIZES", "120,48,18").split(",")]
rows = []
for size in sizes:
    f = ImageFont.truetype(font, size, layout_engine=ImageFont.Layout.RAQM if ImageFont.core.HAVE_RAQM else ImageFont.Layout.BASIC)
    for ln in lines:
        rows.append((f, ln, int(size * 1.35)))
W = 1800
H = sum(r[2] for r in rows) + 40
im = Image.new('L', (W, H), 255)
d = ImageDraw.Draw(im)
y = 20
for f, ln, h in rows:
    d.text((20, y), ln, font=f, fill=0)
    y += h
im.save(out)
