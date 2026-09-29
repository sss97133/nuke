#!/usr/bin/env python3
"""Numbered tags and a legend panel over a v4 render (PIL). Reads <view>.png + <view>_labels.json written by
build_harness_v4.py and the route data in scene_v4.json; writes <view>_labelled.png (render + legend panel).

    python3 docs/wiring/twin/label_v4.py --scene docs/wiring/calc-data/cad/scene_v4.json --dir <render dir> --view bay_sample
"""
import argparse, json, math, os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--scene", default="docs/wiring/calc-data/cad/scene_v4.json")
ap.add_argument("--dir", required=True)
ap.add_argument("--view", required=True)
ap.add_argument("--title", default="K5 engine bay: harness in CAD (sample)")
ap.add_argument("--panel", type=int, default=700)
a = ap.parse_args()

SC = json.load(open(a.scene))
LB = json.load(open(os.path.join(a.dir, a.view + "_labels.json")))
img = Image.open(os.path.join(a.dir, a.view + ".png")).convert("RGB")
W, H = img.size
PANEL = a.panel
out = Image.new("RGB", (W + PANEL, H), (246, 247, 249))
out.paste(img, (0, 0))
d = ImageDraw.Draw(out)


def font(sz, bold=False):
    for f in (("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
              "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, sz)
            except Exception:
                pass
    return ImageFont.load_default()


F_TAG, F_TXT, F_SM, F_H = font(19, True), font(17), font(15), font(22, True)
ROUTES = {r["id"]: r for r in SC["routes"]}
COL = {"engine": (255, 122, 0), "dc+": (217, 16, 42), "dc-": (22, 22, 22)}


def colour(r):
    if r["loom"] == "dc":
        return COL["dc+"] if r.get("polarity") == "+" else COL["dc-"]
    return COL["engine"]


# which segments get a tag: every DC cable, every engine trunk/branch of >= 90 mm
tagged = []
for lr in LB["routes"]:
    r = ROUTES[lr["id"]]
    if r["loom"] == "dc" or (r["kind"] in ("trunk", "branch") and r["length_mm"] >= 90):
        tagged.append((r, lr))
dc = [t for t in tagged if t[0]["loom"] == "dc"]
en = [t for t in tagged if t[0]["loom"] != "dc"]
num = {}
for i, (r, lr) in enumerate(dc, 1):
    num[r["id"]] = f"D{i}"
for i, (r, lr) in enumerate(en, 1):
    num[r["id"]] = f"E{i}"

# end markers: filled = fixed by the engine / decided; hollow = proposed or open spot
def is_prop(status):
    return status in (None, "proposed", "open", "flag") or (status or "").startswith(("proposed", "open"))


for lr in LB["routes"]:
    r = ROUTES[lr["id"]]
    for k in ("start", "end"):
        st = r.get(k + "_status")
        if st == "breakout" or r.get(k + "_ep") is None:
            continue
        x, y, z = lr[k]
        if z <= 0 or not (0 <= x <= W and 0 <= y <= H):
            continue
        rr = 7
        if is_prop(st):
            d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(20, 90, 200), width=3)
        else:
            d.ellipse([x - rr + 2, y - rr + 2, x + rr - 2, y + rr - 2], fill=(20, 90, 200))

# tag placement: greedy ring search around each mid-run anchor, no overlaps, inside the image
boxes = []


def free(bx):
    x0, y0, x1, y1 = bx
    if x0 < 4 or y0 < 4 or x1 > W - 4 or y1 > H - 4:
        return False
    return all(x1 < b[0] or x0 > b[2] or y1 < b[1] or y0 > b[3] for b in boxes)


for r, lr in dc + en:
    x, y, z = lr["mid"]
    if z <= 0 or not (0 <= x <= W and 0 <= y <= H):
        continue
    t = num[r["id"]]
    tw = d.textlength(t, font=F_TAG) + 14; th = 26
    placed = None
    for rad in (46, 64, 84, 108, 136, 168):
        for k in range(24):
            ang = math.radians(-60 + k * 15)
            cx, cy = x + rad * math.cos(ang), y + rad * math.sin(ang)
            bx = (cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2)
            if free(bx):
                placed = (cx, cy, bx); break
        if placed:
            break
    if not placed:
        cx, cy = x + 40, y - 40
        placed = (cx, cy, (cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2))
    cx, cy, bx = placed
    boxes.append(bx)
    c = colour(r)
    d.line([x, y, cx, cy], fill=(40, 40, 40), width=2)
    d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=c, outline=(255, 255, 255))
    d.rounded_rectangle(bx, radius=6, fill=(255, 255, 255), outline=c, width=3)
    d.text((bx[0] + 7, bx[1] + 2), t, font=F_TAG, fill=(20, 20, 20))

# legend panel
X = W + 24
yy = 20
d.text((X, yy), a.title, font=F_H, fill=(20, 20, 20)); yy += 32
d.text((X, yy), "Every route is a PROPOSAL for the owner and Dave to confirm. Nothing is tape-measured.", font=F_SM, fill=(90, 30, 30)); yy += 28
for c, t in ((COL["engine"], "engine loom from the 61-pin (engine side)"), (COL["dc+"], "DC primary +"), (COL["dc-"], "DC primary - and grounds")):
    d.rectangle([X, yy + 4, X + 34, yy + 14], fill=c); d.text((X + 44, yy), t, font=F_TXT, fill=(20, 20, 20)); yy += 24
d.ellipse([X + 10, yy + 2, X + 24, yy + 16], outline=(20, 90, 200), width=3); d.text((X + 44, yy), "end at a PROPOSED or open spot", font=F_TXT, fill=(20, 20, 20)); yy += 24
d.ellipse([X + 12, yy + 4, X + 22, yy + 14], fill=(20, 90, 200)); d.text((X + 44, yy), "end fixed by the engine or decided", font=F_TXT, fill=(20, 20, 20)); yy += 24
d.ellipse([X + 8, yy + 1, X + 26, yy + 19], outline=(60, 64, 70), width=3); d.text((X + 44, yy), "clamp (MS21919-family P-clamp, symbol)", font=F_TXT, fill=(20, 20, 20)); yy += 24
d.ellipse([X + 8, yy + 1, X + 26, yy + 19], outline=(242, 195, 24), width=4); d.text((X + 44, yy), "H3: the exception under review", font=F_TXT, fill=(20, 20, 20)); yy += 24
d.rectangle([X + 6, yy + 2, X + 28, yy + 18], outline=(120, 120, 120), width=1); d.text((X + 44, yy), "see-through box: part size not sourced", font=F_TXT, fill=(20, 20, 20)); yy += 32


def short(r):
    L = r["length_mm"] / 1000
    if r["loom"] == "dc":
        g = f"{r['parallel']} x " if r.get("parallel", 1) == 2 else ""
        awg = {9.85: "2", 7.92: "4", 6.35: "6", 5.05: "8"}.get(r["bundle_od_mm"], "?")
        fr = r["from"].split(" (")[0]; to = r["to"].split(" (")[0]
        return f"#{r['wire']}  {g}{awg} AWG  {fr} > {to}  {L:.2f} m"
    return f"{r['to'][:34]}  {r['cables']} cables  dia {r['bundle_od_mm']:.1f} mm  {L:.2f} m"


d.text((X, yy), "DC primary (wire OD, ProWire M22759/16)", font=F_H, fill=(20, 20, 20)); yy += 30
for r, lr in dc:
    d.text((X, yy), num[r["id"]], font=F_TAG, fill=colour(r)); d.text((X + 44, yy + 1), short(r), font=F_SM, fill=(20, 20, 20)); yy += 21
yy += 10
d.text((X, yy), "Engine loom (bundle OD = sqrt(sum d^2 / 0.65))", font=F_H, fill=(20, 20, 20)); yy += 30
for r, lr in en:
    d.text((X, yy), num[r["id"]], font=F_TAG, fill=colour(r)); d.text((X + 44, yy + 1), short(r), font=F_SM, fill=(20, 20, 20)); yy += 21
yy += 10
npass = sum(1 for r in SC["routes"] for c in r["checks"] if c["result"] == "pass")
nfail = sum(1 for r in SC["routes"] for c in r["checks"] if c["result"] == "fail")
for t in (f"Rule checks: {npass} pass, {nfail} fail (bend radius, exhaust 1 in, fan and belt 25 mm,",
          "no DC over the intake, no runs under the pan, clamps 18 in / 12 in near heat, service loops).",
          "Sources: ProWire OD tables; k5_harness_calc.py packing; FAA AC 43.13-1B 11-96 aa; ABYC E-11."):
    d.text((X, yy), t, font=F_SM, fill=(60, 60, 60)); yy += 20
p = os.path.join(a.dir, a.view + "_labelled.png")
out.save(p)
print("LABELLED", p, out.size, "tags", len(num))
