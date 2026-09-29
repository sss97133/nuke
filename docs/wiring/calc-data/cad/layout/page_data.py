#!/usr/bin/env python3
"""Post-process the renders and build the page data: every end with its record, its position basis and its pixel
position in each view; the DC primary cable runs as polylines."""
import importlib.util, json, math, os
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(D, "render")
OUT = os.path.join(D, "site")
os.makedirs(OUT, exist_ok=True)
spec = importlib.util.spec_from_file_location("ends", os.path.join(D, "ends.py"))
ends = importlib.util.module_from_spec(spec); spec.loader.exec_module(ends)
P = json.load(open(os.path.join(D, "positions.json")))
CAM = json.load(open(os.path.join(R, "cameras.json")))

SIZES = {"top": 2400, "side": 2400, "bay": 1800}


def clean(name):
    im = Image.open(os.path.join(R, f"view_{name}.png")).convert("L")
    bg = im.getpixel((5, 5))
    lut = [max(0, min(255, int(round(255 - max(0, bg - v) * 1.55)))) for v in range(256)]
    im = im.point(lut)
    w = SIZES[name]
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, f"{name}.jpg"), quality=84, optimize=True)
    return im.size


def proj(view, xyz, size):
    c = CAM[view]
    (cx, cy, cz), rx, ry, S = c["location"], c["res"][0], c["res"][1], c["ortho_scale"]
    ppm = rx / S
    x, y, z = xyz
    if view in ("top", "bay"):
        u = rx / 2 + (y - cy) * ppm
        v = ry / 2 + (x - cx) * ppm
    else:
        u = rx / 2 + (y - cy) * ppm
        v = ry / 2 - (z - cz) * ppm
    k = size[0] / rx
    return round(u * k, 1), round(v * k, 1)


sizes = {v: clean(v) for v in SIZES}
recs = {e["id"]: e for e in ends.ENDS}
items = []
for code, e in recs.items():
    p = P[code]
    it = {"id": code, "what": e["what"], "where": e["where"], "zone": e["zone"], "status": e["status"],
          "why": e["why"], "open": e.get("open", []), "follows": e.get("follows"), "cat": p["cat"], "basis": p["basis"],
          "grouped": p.get("grouped"), "xyz": p["xyz"], "px": {}}
    for v, sz in sizes.items():
        u, w = proj(v, p["xyz"], sz)
        if 0 <= u <= sz[0] and 0 <= w <= sz[1]:
            it["px"][v] = [u, w]
    # stations for the reader: inches behind the front axle, inches off the centreline (+ driver), height above ground
    x, y, z = p["xyz"]
    it["station_in"] = round((y + 1.896) / 0.0254)
    it["lateral_in"] = round(x / 0.0254)
    it["height_in"] = round(z / 0.0254)
    items.append(it)

# DC primary runs (world points), candidate B battery spots
RUNS = [
    {"id": "starter", "label": "Starter cable, 2 AWG, unfused", "pts": [(-0.50, -2.04, 1.02), (-0.58, -1.90, 0.75), (-0.36, -1.56, 0.64), (-0.22, -1.44, 0.68)]},
    {"id": "alternator", "label": "Alternator charge cable, 2 AWG", "pts": [(-0.50, -2.04, 1.02), (-0.42, -2.40, 1.10), (0.36, -2.40, 1.10), (0.30, -2.05, 1.04)]},
    {"id": "ibooster", "label": "iBooster feed, over the cowl lip", "pts": [(-0.50, -2.04, 1.02), (-0.62, -1.62, 1.26), (0.40, -1.56, 1.30), (0.40, -1.52, 1.06)]},
    {"id": "cabpdm", "label": "Cab PDM feed through H3, 2 AWG", "pts": [(-0.50, -2.04, 1.02), (-0.60, -1.70, 1.00), (-0.35, -1.46, 0.92), (-0.12, -1.40, 0.88), (0.10, -1.38, 0.88)]},
    {"id": "baypdm", "label": "Engine power box feed", "pts": [(-0.50, -2.04, 1.02), (-0.68, -1.90, 1.02)]},
    {"id": "amp", "label": "Amp feed from the YellowTop, 2 AWG, along the driver frame rail", "pts": [(0.62, -2.26, 0.95), (0.55, -2.15, 0.60), (0.40, -2.05, 0.52), (0.40, 1.20, 0.52), (0.55, 1.30, 0.70), (0.78, 1.20, 1.18)]},
    {"id": "dcdc", "label": "DC-DC: running side to the YellowTop", "pts": [(-0.50, -2.04, 1.02), (-0.42, -2.40, 1.10), (0.50, -2.40, 1.10), (0.66, -2.00, 1.06), (0.62, -2.26, 0.95)]},
]
runs = []
for r in RUNS:
    rr = {"id": r["id"], "label": r["label"], "px": {}}
    for v, sz in sizes.items():
        rr["px"][v] = [proj(v, p, sz) for p in r["pts"]]
    L = sum(math.dist(a, b) for a, b in zip(r["pts"], r["pts"][1:]))
    rr["length_ft"] = round(L / 0.3048, 1)
    runs.append(rr)
import footprints as FPM
fps = []
for f in FPM.FP:
    code = f["id"]
    if code not in P:
        continue
    x, y, z = P[code]["xyz"]
    if code == "FUEL-PUMP":                # the tank is drawn at the body model's own tank
        x, y, z = -0.03, 1.33, 0.67
    rec = {"id": code, "size": f["size"], "color": f["color"], "top": f.get("top"), "side": f.get("side"),
           "label": f.get("context"), "px": {}}
    if f["shape"] == "box":
        dx, dy, dz = f["dx"] / 1000, f["dy"] / 1000, f["dz"] / 1000
    else:
        d, tt = f["d"] / 1000, f["t"] / 1000
        dx, dy, dz = {"x": (tt, d, d), "y": (d, tt, d), "z": (d, d, tt)}[f["axis"]]
    for v, sz in sizes.items():
        ppm = CAM[v]["res"][0] / CAM[v]["ortho_scale"] * sz[0] / CAM[v]["res"][0]
        cu, cv = proj(v, (x, y, z), sz)
        if v in ("top", "bay"):
            w, h = dy * ppm, dx * ppm
            round_ = f["shape"] == "disc" and f["axis"] == "z"
        else:
            w, h = dy * ppm, dz * ppm
            round_ = f["shape"] == "disc" and f["axis"] == "x"
        if -w <= cu <= sz[0] + w and -h <= cv <= sz[1] + h:
            rec["px"][v] = {"cx": round(cu, 1), "cy": round(cv, 1), "w": round(w, 1), "h": round(h, 1), "round": round_,
                            "fill": f.get("top") if v in ("top", "bay") else f.get("side")}
    rec["mm"] = [f.get("dx") or f.get("t") if f["shape"] == "disc" and f.get("axis") == "x" else f.get("dx"),
                 f.get("dy"), f.get("dz")]
    fps.append(rec)
axes = {}
for v, sz in sizes.items():
    axes[v] = []
    for label, yy in (("FRONT AXLE", -1.896), ("FIREWALL", -1.46), ("REAR AXLE", 0.807)):
        u, _ = proj(v, (0, yy, 0), sz)
        if 0 <= u <= sz[0]:
            axes[v].append({"label": label, "u": u, "station_in": round((yy + 1.896) / 0.0254, 1)})
json.dump({"sizes": sizes, "items": items, "runs": runs, "axes": axes, "fps": fps}, open(os.path.join(OUT, "layout.json"), "w"))
print(sizes, len(items), [(r["id"], r["length_ft"]) for r in runs])
