"""Label a REAL engine-bay photo with the plugs, in Dave's names.

  python3 docs/wiring/twin/label_photo.py <photo.jpg> <anchors2d.json> <out.jpg> [--picks picks.json]

Positions: visible plugs use direct picks read off the photo (picks.json, pixel coords on the 1200 px working copy)
when given, otherwise the twin projection from render_twin.py's anchors2d (u from left, v from bottom). Hidden plugs
(behind/under the engine per the camera ray-cast) get a dashed marker and '(hidden)'. Colour = confidence:
orange = cited or photo-placed, yellow = estimate/low, cyan = candidate/planned (not on the truck yet).
Off-frame plugs are listed in the legend.
"""
import json, sys, os, math
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(f):
            try: return ImageFont.truetype(f, sz)
            except Exception: pass
    return ImageFont.load_default()

def colour(conf):
    if conf in ("candidate", "planned"): return (40, 220, 255)
    if conf in ("unknown", "low", "medium-low"): return (255, 215, 30)
    return (255, 120, 20)

def dashed_circle(d, c, r, col, w=3, n=12):
    for i in range(n):
        a0 = 2 * math.pi * i / n; a1 = a0 + math.pi / n
        d.arc((c[0] - r, c[1] - r, c[0] + r, c[1] + r), math.degrees(a0), math.degrees(a1), fill=col, width=w)

def main(photo, anchors_json, out, picks_path=None, width=1600):
    im = Image.open(photo).convert("RGB")
    im = im.resize((width, int(im.height * width / im.width)))
    Wd, Hd = im.size
    d = ImageDraw.Draw(im); f = font(20); fs = font(15)
    data = json.load(open(anchors_json))["anchors"]
    picks = json.load(open(picks_path)) if picks_path else {}
    pw = picks.get("_width", 1200)
    items = []; offframe = []
    for k, a in data.items():
        name = a.get("dave") or k
        conf = a.get("conf", "")
        planned = conf in ("candidate", "planned") or k.startswith("coil_") or k in ("ac_clutch",)
        if k in picks:
            x, y = picks[k][0] * Wd / pw, picks[k][1] * Wd / pw; hidden = picks[k][2] if len(picks[k]) > 2 else False; src = "pick"
        else:
            if not a.get("in_frame", True) or a["depth"] <= 0:
                offframe.append(name); continue
            x, y = a["u"] * Wd, (1 - a["v"]) * Hd; hidden = a.get("hidden", False); src = "twin"
        if not (0 <= x < Wd and 0 <= y < Hd): offframe.append(name); continue
        items.append((k, name, x, y, hidden, conf, planned, src))
    # coil cluster: one marker
    coils = [it for it in items if it[0].startswith("coil_")]
    if coils:
        cx = sum(it[2] for it in coils) / len(coils); cy = sum(it[3] for it in coils) / len(coils)
        items = [it for it in items if not it[0].startswith("coil_")] + [("coils", "coils 1-8 (DEL-Stributer, planned)", cx, cy, coils[0][4], "candidate", True, coils[0][7])]
    used = []
    items.sort(key=lambda t: (t[3], t[2]))
    for k, name, x, y, hidden, conf, planned, src in items:
        col = colour("candidate" if planned else conf)
        label = name + (" (hidden)" if hidden else "") + ("" if src == "pick" or planned else " ~")
        r = 11
        if hidden: dashed_circle(d, (x, y), r, col)
        elif planned: d.ellipse((x - r, y - r, x + r, y + r), outline=col, width=3)
        else: d.ellipse((x - r, y - r, x + r, y + r), fill=col, outline=(0, 0, 0), width=2)
        tw = d.textlength(label, font=f) + 10; th = 26
        for dx, dy in ((22, -30), (-tw - 22, -30), (22, 14), (-tw - 22, 14), (-tw / 2, -50), (-tw / 2, 24), (40, -8), (-tw - 40, -8), (60, -60), (-tw - 60, -60)):
            lx, ly = x + dx, y + dy
            if lx < 2 or ly < 2 or lx + tw > Wd - 2 or ly + th > Hd - 2: continue
            box = (lx, ly, lx + tw, ly + th)
            if all(box[2] < u[0] or box[0] > u[2] or box[3] < u[1] or box[1] > u[3] for u in used): used.append(box); break
        else:
            lx, ly = x + 22, y - 30; box = (lx, ly, lx + tw, ly + th); used.append(box)
        ax = lx if lx > x else lx + tw
        d.line((x, y, ax, ly + th / 2), fill=col, width=2)
        d.rectangle(box, fill=(18, 18, 18), outline=col, width=2)
        d.text((lx + 5, ly + 3), label, fill=col, font=f)
    # legend
    lines = ["orange = cited / photo-placed   yellow = estimate   cyan = candidate or not fitted yet   dashed = hidden behind parts   ~ = twin projection, not a photo pick",
             "off-frame: " + (", ".join(offframe) if offframe else "none"),
             "anchors: docs/wiring/calc-data/twin_engine_anchors.json (sources + confidence per plug)"]
    lh = 22; d.rectangle((0, 0, Wd, lh * len(lines) + 10), fill=(18, 18, 18))
    for i, t in enumerate(lines): d.text((12, 4 + i * lh), t, fill=(230, 230, 230), font=fs)
    im.save(out, quality=90); print("wrote", out, len(items), "markers;", len(offframe), "off-frame")

if __name__ == "__main__":
    args = sys.argv[1:]
    picks = None
    if "--picks" in args:
        i = args.index("--picks"); picks = args[i + 1]; args = args[:i] + args[i + 2:]
    main(args[0], args[1], args[2], picks)
