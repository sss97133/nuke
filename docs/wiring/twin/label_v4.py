#!/usr/bin/env python3
"""Tags and a legend panel over a v4 render (PIL). Reads <view>.png + <view>_labels.json written by
build_harness_v4.py and the route and part data in scene_v4.json; writes <view>_labelled.png (render + legend panel).

    python3 docs/wiring/twin/label_v4.py --scene docs/wiring/calc-data/cad/scene_v4.json --dir <render dir> --view bay
    python3 docs/wiring/twin/label_v4.py --scene ... --dir <render dir> --all      (every *_labels.json in the dir)

Whole-truck scenes (scope "all") get loom tags, part tags and a loom legend; the engine-bay sample keeps its numbered
cable list.
"""
import argparse, glob, json, math, os
from collections import Counter, defaultdict
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--scene", default="docs/wiring/calc-data/cad/scene_v4.json")
ap.add_argument("--dir", required=True)
ap.add_argument("--view", default="")
ap.add_argument("--all", action="store_true")
ap.add_argument("--title", default="")
ap.add_argument("--panel", type=int, default=720)
a = ap.parse_args()
SC = json.load(open(a.scene))
ROUTES = {r["id"]: r for r in SC["routes"]}
PARTS = {p["id"]: p for p in SC["parts"]}


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
LOOM_RGB = {"engine": (255, 122, 0), "front": (22, 184, 201), "cab": (138, 77, 255), "rear": (39, 194, 74), "door": (240, 208, 0),
            "under": (255, 79, 163), "dc+": (217, 16, 42), "dc-": (22, 22, 22)}
LOOM_NAME = {"engine": "engine loom (61-pin, engine side)", "front": "front loom (bay box)", "dc": "DC primary (+ red, - black)",
             "cab": "cab / dash loom (61-pin cab side, M130, PDM30)", "door": "door looms (hinge side)",
             "rear": "rear loom (sill, rear connector, frame rail, rear body)", "under": "underbody / trans loom"}
TITLES = {"iso_front_left": "3/4 front-left", "iso_rear_right": "3/4 rear-right", "plan": "plan (front to the left)",
          "side_driver": "driver side", "bay": "engine bay", "firewall_engine": "firewall, engine side", "firewall_cab": "firewall, cab side",
          "rear_quarter": "rear quarter: subs, amp, spare tire", "underbody": "underbody"}


def colour(r):
    if r["loom"] == "dc":
        return LOOM_RGB["dc+"] if r.get("polarity") == "+" else LOOM_RGB["dc-"]
    return LOOM_RGB.get(r["loom"], (90, 90, 90))


def is_prop(status):
    return status in (None, "proposed", "open", "flag") or (status or "").startswith(("proposed", "open"))


def label_one(view):
    LB = json.load(open(os.path.join(a.dir, view + "_labels.json")))
    img = Image.open(os.path.join(a.dir, view + ".png")).convert("RGB")
    W, H = img.size
    out = Image.new("RGB", (W + a.panel, H), (246, 247, 249))
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    boxes = []

    def inside(p):
        return p[2] > 0 and 6 <= p[0] <= W - 6 and 6 <= p[1] <= H - 6

    def free(bx):
        x0, y0, x1, y1 = bx
        if x0 < 4 or y0 < 4 or x1 > W - 4 or y1 > H - 4:
            return False
        return all(x1 < b[0] or x0 > b[2] or y1 < b[1] or y0 > b[3] for b in boxes)

    def tag(anchor, text, col, fill=(255, 255, 255), fg=(20, 20, 20)):
        x, y = anchor[0], anchor[1]
        tw = d.textlength(text, font=F_TAG) + 14; th = 26
        placed = None
        for rad in (40, 58, 78, 102, 130, 164, 204):
            for k in range(24):
                ang = math.radians(-60 + k * 15)
                cx, cy = x + rad * math.cos(ang), y + rad * math.sin(ang)
                bx = (cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2)
                if free(bx):
                    placed = (cx, cy, bx); break
            if placed:
                break
        if not placed:
            return False
        cx, cy, bx = placed
        boxes.append(bx)
        d.line([x, y, cx, cy], fill=(40, 40, 40), width=2)
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=col, outline=(255, 255, 255))
        d.rounded_rectangle(bx, radius=6, fill=fill, outline=col, width=3)
        d.text((bx[0] + 7, bx[1] + 2), text, font=F_TAG, fill=fg)
        return True

    focus = LB.get("focus")
    lroutes = [lr for lr in LB["routes"] if lr["id"] in ROUTES]
    # end markers for the loom in focus (or the close-ups): filled = decided / fixed by the engine, hollow = proposed or open
    close = view in ("bay", "firewall_engine", "firewall_cab", "rear_quarter", "underbody") or focus
    if close:
        for lr in lroutes:
            r = ROUTES[lr["id"]]
            if focus and r["loom"] != focus:
                continue
            for k in ("start", "end"):
                if r.get(k + "_ep") is None:
                    continue
                p = lr[k]
                if not inside(p):
                    continue
                x, y = p[0], p[1]; rr = 7
                if is_prop(r.get(k + "_status")):
                    d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(20, 90, 200), width=3)
                else:
                    d.ellipse([x - rr + 2, y - rr + 2, x + rr - 2, y + rr - 2], fill=(20, 90, 200))
    numbered = []
    if focus:
        # per-loom render: number that loom's biggest segments
        cand = [(ROUTES[lr["id"]], lr) for lr in lroutes if ROUTES[lr["id"]]["loom"] == focus and inside(lr["mid"])
                and (ROUTES[lr["id"]]["loom"] == "dc" or (len(ROUTES[lr["id"]]["members"]) >= 4 and ROUTES[lr["id"]]["length_mm"] >= 120))]
        cand.sort(key=lambda t: -t[0]["bundle_od_mm"] * (1 + t[0]["length_mm"] / 2000))
        for r, lr in cand[:26]:
            t = f"{'D' if r['loom'] == 'dc' else 'L'}{len(numbered) + 1}"
            if tag(lr["mid"], t, colour(r)):
                numbered.append((t, r))
    else:
        # whole views: one tag per loom at its longest visible segment, then the key parts
        best = {}
        for lr in lroutes:
            r = ROUTES[lr["id"]]
            if not inside(lr["mid"]) or r["kind"] == "crossing":
                continue
            key = r["loom"] if r["loom"] != "dc" else "dc"
            if key not in best or r["length_mm"] > best[key][0]["length_mm"]:
                best[key] = (r, lr)
        for key in ("engine", "front", "dc", "cab", "door", "rear", "under"):
            if key in best:
                r, lr = best[key]
                tag(lr["mid"], {"dc": "DC"}.get(key, key.upper()), colour(r))
    key_parts = ["M130-A", "PDM30-A", "PDM15-A", "ODYSSEY", "ACC-BATT", "DCDC", "FW61-PLATE", "FIREWALL-GROMMET", "REAR-CONN", "AMP", "SUB", "SUB-2",
                 "WIDEBAND", "IBOOSTER", "DEL-STRIBUTOR-POST", "GND-BANK-ENG", "PS-STUDS", "ISOLATOR", "GND-BANK-CAB", "AMP-PASS", "CTX-FUEL-TANK", "FAN"]
    names = {"FW61-PLATE": "61-pin", "FIREWALL-GROMMET": "H3", "CTX-FUEL-TANK": "tank", "DEL-STRIBUTOR-POST": "coil ring", "PDM15-A": "bay box (PDM32)",
             "ACC-BATT": "YellowTop", "ODYSSEY": "Odyssey", "WIDEBAND": "LTCD", "PS-STUDS": "dist. stud", "GND-BANK-ENG": "ground star",
             "GND-BANK-CAB": "cab ground", "DCDC": "DC-DC"}
    pp = {x["id"]: x for x in LB["parts"]}
    nparts = 0
    for pid in key_parts:
        if pid not in pp or not inside(pp[pid]["px"]):
            continue
        if focus and focus not in ("dc", "engine", "front", "cab", "rear") and pid not in ("REAR-CONN", "AMP", "SUB", "SUB-2", "AMP-PASS", "CTX-FUEL-TANK"):
            continue
        p = PARTS.get(pid, {})
        flag = [c for c in p.get("checks", []) if c["result"] in ("flag", "fail") and c["rule"].startswith(("clear of the spare", "clear of neighbouring"))]
        txt = names.get(pid, pid)
        if pid == "SUB-2" and any(c["rule"].startswith("clear of the spare") for c in flag):
            txt = "SUB-2: spare-carrier clash"
        if tag(pp[pid]["px"], txt, (60, 64, 70) if not flag else (200, 30, 30), fill=(255, 255, 255) if not flag else (255, 236, 236)):
            nparts += 1
    # legend panel
    X = W + 24; yy = 20
    title = a.title or ("K5 harness in CAD: " + (f"the {LOOM_NAME.get(focus, focus)}" if focus else TITLES.get(view, view)))
    d.text((X, yy), title, font=F_H, fill=(20, 20, 20)); yy += 32
    d.text((X, yy), "Every route is a PROPOSAL for Skylar and Dave to confirm. Nothing is taped.", font=F_SM, fill=(150, 30, 30)); yy += 26
    looms = defaultdict(list)
    for r in SC["routes"]:
        looms[r["loom"]].append(r)
    for key in ("engine", "front", "dc", "cab", "door", "rear", "under"):
        rs = looms.get(key, [])
        if not rs:
            continue
        wires = len({m for r in rs for m in r["members"]})
        c = LOOM_RGB["dc+"] if key == "dc" else LOOM_RGB[key]
        dim = focus and focus != key
        d.rectangle([X, yy + 4, X + 34, yy + 14], fill=(200, 204, 208) if dim else c)
        if key == "dc":
            d.rectangle([X + 17, yy + 4, X + 34, yy + 14], fill=(200, 204, 208) if dim else LOOM_RGB["dc-"])
        txt = f"{LOOM_NAME[key]}: {wires} wires, {len(rs)} segs, max {max(r['bundle_od_mm'] for r in rs):.1f} mm, {sum(r['length_mm'] for r in rs) / 1000:.1f} m, {sum(len(r['clamps']) for r in rs)} clamps"
        d.text((X + 44, yy), txt[:88], font=F_SM, fill=(120, 120, 120) if dim else (20, 20, 20)); yy += 22
    yy += 6
    for draw, t in ((lambda: d.ellipse([X + 10, yy + 2, X + 24, yy + 16], outline=(20, 90, 200), width=3), "end at a PROPOSED or open spot"),
                    (lambda: d.ellipse([X + 12, yy + 4, X + 22, yy + 14], fill=(20, 90, 200)), "end fixed by the engine or decided"),
                    (lambda: d.ellipse([X + 8, yy + 1, X + 26, yy + 19], outline=(60, 64, 70), width=3), "clamp (MS21919-family P-clamp; 18 in, 12 in near heat)"),
                    (lambda: d.ellipse([X + 8, yy + 1, X + 26, yy + 19], outline=(242, 195, 24), width=4), "H3: the exception under review"),
                    (lambda: d.rectangle([X + 6, yy + 2, X + 28, yy + 18], outline=(120, 120, 120), width=1), "see-through box: size not sourced"),
                    (lambda: d.rectangle([X + 6, yy + 2, X + 28, yy + 18], fill=(255, 236, 236), outline=(200, 30, 30), width=2), "red tag: a flagged clash")):
        draw(); d.text((X + 44, yy), t, font=F_TXT, fill=(20, 20, 20)); yy += 24
    yy += 8
    if numbered:
        d.text((X, yy), "Numbered segments (bundle OD = sqrt(sum d^2 / 0.65), ProWire ODs)", font=F_H, fill=(20, 20, 20)); yy += 30
        for t, r in numbered:
            if yy > H - 150:
                break
            to = (r.get("to") or "")[:30]
            if r["loom"] == "dc":
                s = f"#{r.get('wire')}  {r['bundle_od_mm']:.2f} mm  {r['from'][:24]} > {to}  {r['length_mm'] / 1000:.2f} m"
            else:
                s = f"{len(r['members'])} wires  {r['bundle_od_mm']:.1f} mm  {r['length_mm'] / 1000:.2f} m  > {to}"
            d.text((X, yy), t, font=F_TAG, fill=colour(r)); d.text((X + 50, yy + 1), s, font=F_SM, fill=(20, 20, 20)); yy += 21
        yy += 8
    res = Counter(c["result"] for r in SC["routes"] for c in r["checks"])
    pres = Counter(c["result"] for p in SC["parts"] for c in p.get("checks", []))
    models = Counter(str(p.get("model", "")).split(" (")[0] for p in SC["parts"])
    notes = SC.get("notes", {})
    for t in (f"Route checks: {res.get('pass', 0)} pass, {res.get('fail', 0)} fail, {res.get('exception', 0)} exception (H3), {res.get('flag', 0)} flagged,",
              f"{res.get('not run', 0)} not run (the exhaust route aft of y -1.07 is unknown).",
              f"Parts: {models.get('parts-lane model', 0)} parts-lane CAD models, {models.get('stand-in', 0)} true-size stand-ins, {models.get('twin v3 object', 0)} twin objects,",
              f"{models.get('dashed', 0)} dashed (size not sourced). Part checks: {pres.get('pass', 0)} pass, {pres.get('flag', 0)} flagged.",
              f"Wires: {len(notes.get('unrouted', []))} unrouted; {len(notes.get('open_no_crossing', []))} with no sanctioned firewall crossing (owner call).",
              "Margins: firewall +-100 mm (inconclusive), frame +-5 mm, body shell +-15 mm.",
              "Sources: ProWire OD tables; k5_harness_calc.py packing; FAA AC 43.13-1B 11-96 aa;",
              "ABYC E-11; objectTraits heat rule; parts lane (part_models.yaml); delstributor lane (PR #434).",
              "The body is a licensed model, drawn as an x-ray; it is not exported."):
        if yy > H - 22:
            break
        d.text((X, yy), t, font=F_SM, fill=(60, 60, 60)); yy += 20
    p = os.path.join(a.dir, view + "_labelled.png")
    out.save(p)
    print("LABELLED", p, out.size, "tags", len(boxes))
    return p


views = [a.view] if a.view else []
if a.all:
    views = sorted(os.path.basename(f)[:-len("_labels.json")] for f in glob.glob(os.path.join(a.dir, "*_labels.json")))
for v in views:
    if os.path.exists(os.path.join(a.dir, v + ".png")):
        label_one(v)
