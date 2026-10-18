"""Post-process the twin renders with PIL: side-by-side comparison and plug labels.

  python3 docs/wiring/twin/compose.py sbs  <photo.jpg> <render.png> <out.png> [caption-left] [caption-right]
  python3 docs/wiring/twin/compose.py label <render.png> <anchors2d.json> <out.png>

Labels use Dave's names (TPS, oil PSI, coolant temp, crank, cam, knock L/R, MAP, O2 L/R, coils 1-8, inj 1-8),
drawn from the 2D projections render_twin.py dumps; yellow = position unknown/low confidence, orange = cited/medium.
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            try: return ImageFont.truetype(f, sz)
            except Exception: pass
    return ImageFont.load_default()

def sbs(photo, render, out, cap_l="IMG_6531 (2026-01-31)", cap_r="twin v3 render, same camera"):
    a = Image.open(photo).convert("RGB"); b = Image.open(render).convert("RGB")
    h = min(a.height, b.height, 900)
    a = a.resize((int(a.width * h / a.height), h)); b = b.resize((int(b.width * h / b.height), h))
    gap = 16; bar = 44
    im = Image.new("RGB", (a.width + b.width + gap, h + bar), (24, 24, 24))
    im.paste(a, (0, bar)); im.paste(b, (a.width + gap, bar))
    d = ImageDraw.Draw(im); f = font(22)
    d.text((10, 10), cap_l, fill=(255, 255, 255), font=f); d.text((a.width + gap + 10, 10), cap_r, fill=(255, 255, 255), font=f)
    im.save(out); print("wrote", out, im.size)

def label(render, anchors_json, out, skip=(), caption=None):
    im = Image.open(render).convert("RGB"); W, H = im.size
    data = json.load(open(anchors_json)); d = ImageDraw.Draw(im); f = font(15); fs = font(13)
    items = []
    for k, a in data["anchors"].items():
        if k in skip or a["depth"] <= 0: continue
        x = a["u"] * W; y = (1 - a["v"]) * H
        if not (0 <= x < W and 0 <= y < H): continue
        items.append((k, a, x, y))
    # spread labels: alternate offsets so neighbours don't stack
    items.sort(key=lambda t: (round(t[3] / 40), t[2]))
    used = []
    for i, (k, a, x, y) in enumerate(items):
        name = a.get("dave") or k
        col = (255, 210, 30) if a.get("conf") in ("unknown", "low") else (255, 120, 20)
        tw = d.textlength(name, font=f) + 8
        # candidate label spots around the anchor
        for dx, dy in ((28, -22), (-tw - 28, -22), (28, 18), (-tw - 28, 18), (0, -46), (0, 34), (48, -8), (-tw - 48, -8)):
            lx, ly = x + dx, y + dy
            if lx < 2 or ly < 2 or lx + tw > W - 2 or ly + 20 > H - 2: continue
            box = (lx, ly, lx + tw, ly + 20)
            if all(box[2] < u[0] or box[0] > u[2] or box[3] < u[1] or box[1] > u[3] for u in used):
                used.append(box); break
        else:
            lx, ly = x + 28, y - 22; box = (lx, ly, lx + tw, ly + 20); used.append(box)
        d.line((x, y, lx + (0 if lx > x else tw), ly + 10), fill=col, width=2)
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=col, outline=(0, 0, 0))
        d.rectangle(box, fill=(20, 20, 20), outline=col)
        d.text((lx + 4, ly + 2), name, fill=col, font=f)
    if caption:
        d.rectangle((6, 6, 16 + d.textlength(caption, font=fs), 30), fill=(20, 20, 20)); d.text((12, 10), caption, fill=(255, 255, 255), font=fs)
    d.rectangle((6, H - 44, 430, H - 6), fill=(20, 20, 20))
    d.text((12, H - 40), "orange = cited or photo-placed   yellow = unknown / low confidence", fill=(230, 230, 230), font=fs)
    d.text((12, H - 24), "anchors: docs/wiring/calc-data/twin_engine_anchors.json", fill=(180, 180, 180), font=fs)
    im.save(out); print("wrote", out, len(items), "labels")

if __name__ == "__main__":
    if sys.argv[1] == "sbs": sbs(*sys.argv[2:])
    elif sys.argv[1] == "label": label(sys.argv[2], sys.argv[3], sys.argv[4], caption=(sys.argv[5] if len(sys.argv) > 5 else None))
