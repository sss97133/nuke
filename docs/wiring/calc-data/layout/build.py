#!/usr/bin/env python3
"""Build the K5 Harness Layout page from its sourced inputs. Nothing is typed into the HTML by hand: every end,
size, colour, photo, wire and route comes from a file named below, and the page shows where each came from.

Inputs (snapshotted into in/ on every build, so a build can be repeated):
  pieces lane  ../loc/ends.py, pos.py, footprints.py, anchors.json      where each end is, and why
  main         part_media.yaml, k5_registry.json, mounts.yaml (boxes),  photos, wires, the layout calls
               twin_engine_anchors.json                                 anchor confidence
  parts-artist part_models.yaml (its worktree)                           true-size models
  this lane    sizes.py                                                  sourced envelopes for the rest
  harness-cad  routes.json (when it lands)                               loom routes, clips, splices
Outputs: site/k5_layout.html (+ site/v/*.webp layers, site/ph/*.jpg photos).
Axes: twin metres, +x driver, -y forward, +z up; front axle y -1.896, rear axle y 0.807."""
import datetime, importlib.util, json, math, os, re, shutil, subprocess, sys
import yaml
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
LOC = os.path.join(D, "..", "loc")
IN = os.path.join(D, "in"); os.makedirs(IN, exist_ok=True)
SITE = os.path.join(D, "site"); os.makedirs(os.path.join(SITE, "v"), exist_ok=True)
REPO = "/Users/skylar/nuke"
PARTS_ARTIST = REPO + "/.claude/worktrees/agent-a5bfbdebd57f21ece/docs/wiring/calc-data/catalog/part_models.yaml"
HARNESS_CAD = "/Users/skylar/nuke/.claude/worktrees/agent-a0cd58bddb3a59cec/docs/wiring/calc-data/cad/routes.json"
BAY_GLB = os.path.expanduser("~/k5-harness-pull/renders/v4/sample/bay_sample.glb")   # harness-cad's clean re-export
ROUTE_PATHS = [os.path.join(D, "routes.json"), HARNESS_CAD]
ARGS = sys.argv[1:]
if "--routes" in ARGS:                                   # test only: build against a given routes file
    ROUTE_PATHS = [ARGS[ARGS.index("--routes") + 1]]
OUT_HTML = ARGS[ARGS.index("--out") + 1] if "--out" in ARGS else os.path.join(SITE, "k5_layout.html")
FRONT_AXLE, REAR_AXLE, FIREWALL = -1.896, 0.807, -1.46
IN_PER_M = 1 / 0.0254


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def git_show(path, out):
    r = subprocess.run(["git", "-C", REPO, "show", "origin/main:" + path], capture_output=True)
    if r.returncode == 0:
        open(out, "wb").write(r.stdout)
    return r.returncode == 0


# ------------------------------------------------------------------ snapshot the inputs
subprocess.run(["git", "-C", REPO, "fetch", "origin", "main", "--quiet"], capture_output=True)
stamp = {}
for f in ("ends.py", "pos.py", "footprints.py", "anchors.json"):
    shutil.copy(os.path.join(LOC, f), os.path.join(IN, f))
    stamp[f] = datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(LOC, f))).strftime("%Y-%m-%d %H:%M")
for p, out in (("docs/wiring/calc-data/catalog/part_media.yaml", "part_media.yaml"),
               ("docs/wiring/calc-data/k5_registry.json", "k5_registry.json"),
               ("docs/wiring/calc-data/catalog/mounts.yaml", "mounts.yaml"),
               ("docs/wiring/calc-data/twin_engine_anchors.json", "twin_engine_anchors.json")):
    git_show(p, os.path.join(IN, out))
main_head = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "origin/main"], capture_output=True, text=True).stdout.strip()
if os.path.exists(PARTS_ARTIST):
    shutil.copy(PARTS_ARTIST, os.path.join(IN, "part_models.yaml"))
routes_src = next((p for p in ROUTE_PATHS if os.path.exists(p)), None)
if routes_src:
    shutil.copy(routes_src, os.path.join(IN, "routes.json"))
    stamp["routes.json"] = datetime.datetime.fromtimestamp(os.path.getmtime(routes_src)).strftime("%Y-%m-%d %H:%M")
git_show("docs/wiring/calc-data/catalog/suppliers/affordablestreetrods.yaml", os.path.join(IN, "suppliers_asr.yaml"))
git_show("docs/wiring/calc-data/catalog/parts.yaml", os.path.join(IN, "parts.yaml"))

ends_m = load_module("ends", os.path.join(IN, "ends.py"))
pos_m = load_module("pos", os.path.join(IN, "pos.py"))
sys.path.insert(0, IN)
fp_m = load_module("footprints", os.path.join(IN, "footprints.py"))
sizes_m = load_module("sizes", os.path.join(D, "sizes.py"))
PM = yaml.safe_load(open(os.path.join(IN, "part_media.yaml")))
REG = json.load(open(os.path.join(IN, "k5_registry.json")))
MOUNTS = yaml.safe_load(open(os.path.join(IN, "mounts.yaml")))
ANCH = json.load(open(os.path.join(IN, "twin_engine_anchors.json")))["anchors"]
PMOD = yaml.safe_load(open(os.path.join(IN, "part_models.yaml"))) if os.path.exists(os.path.join(IN, "part_models.yaml")) else {"parts": []}
CAM = json.load(open(os.path.join(LOC, "render", "cameras.json")))
PHOTOS = json.load(open(os.path.join(D, "photos", "processed.json")))
P = pos_m.P
ENDS = ends_m.ENDS

# which twin anchor each engine end sits on (pos.py text), for the anchor's own confidence
anchor_of = {}
src_pos = open(os.path.join(IN, "pos.py")).read()
for m in re.finditer(r'put\("([^"]+)",\s*AN\["ANCHOR_([^"]+)"\]', src_pos):
    anchor_of[m.group(1)] = m.group(2)
for i in range(1, 9):
    anchor_of["INJ-%d" % i] = "inj_%d" % i
    anchor_of["COIL-%d" % i] = "coil_%d" % i

# ------------------------------------------------------------------ views: layers and projection
WIDTH = {"top": 2400, "side": 2400, "bay": 1800}
VIEWS = {}
for v, c in CAM.items():
    rx, ry = c["res"]
    w = WIDTH[v]; h = round(ry * w / rx)
    k = w / rx
    VIEWS[v] = {"w": w, "h": h, "ppm": rx / c["ortho_scale"] * k, "layers": {}}
    for layer in ("body", "mech"):
        src = os.path.join(D, "render", f"{v}_{layer}.png")
        out = os.path.join(SITE, "v", f"{v}_{layer}.webp")
        if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
            im = Image.open(src).convert("RGBA").resize((w, h), Image.LANCZOS)
            im.save(out, "WEBP", quality=82, method=6)
        VIEWS[v]["layers"][layer] = f"v/{v}_{layer}.webp"


def proj(v, xyz):
    c = CAM[v]
    (cx, cy, cz), rx, ry, S = c["location"], c["res"][0], c["res"][1], c["ortho_scale"]
    ppm = rx / S
    x, y, z = xyz
    u = rx / 2 + (y - cy) * ppm
    vv = ry / 2 + (x - cx) * ppm if v in ("top", "bay") else ry / 2 - (z - cz) * ppm
    k = VIEWS[v]["w"] / rx
    return round(u * k, 1), round(vv * k, 1)


def inview(v, uv, pad=0):
    return -pad <= uv[0] <= VIEWS[v]["w"] + pad and -pad <= uv[1] <= VIEWS[v]["h"] + pad


def stations(xyz):
    x, y, z = xyz
    return {"station_in": round((y - FRONT_AXLE) * IN_PER_M, 1), "lateral_in": round(x * IN_PER_M, 1), "height_in": round(z * IN_PER_M, 1)}


for v in VIEWS:
    VIEWS[v]["axes"] = []
    for label, yy in (("FRONT AXLE", FRONT_AXLE), ("FIREWALL", FIREWALL), ("REAR AXLE", REAR_AXLE)):
        u, _ = proj(v, (0, yy, 0))
        if 0 <= u <= VIEWS[v]["w"]:
            VIEWS[v]["axes"].append({"label": label, "u": u, "station_in": round((yy - FRONT_AXLE) * IN_PER_M, 1)})
    # world origin of the view in pixels, so the page can turn a cursor position back into stations
    c = CAM[v]
    VIEWS[v]["cam"] = {"cx": c["location"][0], "cy": c["location"][1], "cz": c["location"][2], "res": c["res"], "scale": c["ortho_scale"]}
VIEWS["top"]["caption"] = "Plan view from above. Front to the left, driver side at the bottom."
VIEWS["side"]["caption"] = "Driver side. Front to the left."
VIEWS["bay"]["caption"] = "Engine bay from above. Front to the left, driver side at the bottom."

# ------------------------------------------------------------------ sizes: parts-artist, then this lane, then pieces
def model_fp(p):
    """part_models.yaml record -> box in world axes. The part's own X/Y/Z map to world axes by sizes.MOUNT."""
    dims = p.get("dims_mm") or {}
    l, w, h = dims.get("l"), dims.get("w"), dims.get("h")
    if not (l and w and h):
        return None
    mount = sizes_m.MOUNT.get(p["id"])
    if not mount:
        return None
    ax = dict(zip(mount["axes"], (l, w, h)))            # part X, Y, Z -> world axis names
    cols = p.get("colors") or {}
    case = (cols.get("case") or {})
    checks = p.get("checks") or []
    return {"shape": "box", "dx": ax["x"], "dy": ax["y"], "dz": ax["z"], "top": case.get("hex"), "side": case.get("hex"),
            "size": (p.get("dims_note") or "") + " (" + (p.get("shape_basis") or "") + "; " + p.get("script", "part_models.yaml") + ")",
            "color": "case " + (case.get("from") or "not read"), "basis": p.get("shape_basis") or "part model",
            "from": "part_models.yaml (parts-artist): %d sourced dimensions, %d of %d maker checks pass" % (
                len(p.get("params") or []), sum(1 for c in checks if c.get("ok")), len(checks)),
            "orient": mount["note"], "params": len(p.get("params") or [])}


FPS = {}
PARTIAL = {}
for f in fp_m.FP:
    if "sizes are not read" in f["size"]:
        PARTIAL[f["id"]] = f["size"]
        continue
    r = dict(f); r["from"] = "footprints.py (pieces)"
    r["basis"] = "twin object" if "twin" in f["size"] else ("model tank" if f["id"] == "FUEL-PUMP" else "maker size")
    FPS[f["id"]] = r
for f in sizes_m.S:
    r = dict(f); r["from"] = "sizes.py (layout-ui)"
    r.setdefault("basis", "body model" if "body model" in f["size"] else "maker size")
    FPS[f["id"]] = r
for p in PMOD.get("parts", []):
    r = model_fp(p)
    if r:
        r["id"] = p["id"]
        FPS[p["id"]] = r

# the tank is drawn as context, not as the pump: the pump's own size is the hanger's
CONTEXT = []
if "FUEL-PUMP" in FPS and FPS["FUEL-PUMP"].get("context"):
    t = FPS.pop("FUEL-PUMP")
    CONTEXT.append({"id": "ctx:tank", "label": "Fuel tank (body model's own tank)", "xyz": (-0.03, 1.33, 0.67), "fp": t,
                    "note": t["size"]})


def rect(v, xyz, f):
    if f["shape"] == "box":
        dx, dy, dz = f["dx"] / 1000, f["dy"] / 1000, f["dz"] / 1000
        rnd = False
    else:
        d, t = f["d"] / 1000, f["t"] / 1000
        dx, dy, dz = {"x": (t, d, d), "y": (d, t, d), "z": (d, d, t)}[f["axis"]]
    ppm = VIEWS[v]["ppm"]
    cu, cv = proj(v, xyz)
    if v in ("top", "bay"):
        w, h = dy * ppm, dx * ppm
        rnd = f["shape"] == "disc" and f["axis"] == "z"
        fill = f.get("top")
    else:
        w, h = dy * ppm, dz * ppm
        rnd = f["shape"] == "disc" and f["axis"] == "x"
        fill = f.get("side")
    if not inview(v, (cu, cv), max(w, h)):
        return None
    return {"cx": cu, "cy": cv, "w": round(w, 2), "h": round(h, 2), "round": rnd, "fill": fill}


# ------------------------------------------------------------------ margins of error, by the basis of the position
BODY_MARGIN = sizes_m.BODY_MARGIN


def margin(code, p):
    b = p["basis"]
    m = re.search(r"(?:\+/-|\u00b1)\s*(\d+)\s*mm", b)
    if m:
        return {"mm": int(m.group(1)), "cls": "stated", "text": "the placement note gives it: " + b}
    if b.startswith("twin v3 engine anchor"):
        a = ANCH.get(anchor_of.get(code, ""), {})
        conf = a.get("confidence", "not rated")
        note = "the twin's engine placement class, ±50 mm (docs/wiring/output/K5_landmarks_blender_derived.yaml, assumption A5)"
        extra = "; the anchor's own spot on the engine is rated " + conf + " (twin_engine_anchors.json: " + (a.get("method") or "no method") + ")"
        return {"mm": 50, "cls": "engine", "text": note + extra, "conf": conf}
    if b.startswith("1978 Blazer body model"):
        return dict(BODY_MARGIN)
    if b.startswith("candidate"):
        return {"mm": 300, "cls": "candidate", "text": "the spot is not decided, so it can move anywhere near here; drawn with the owner's upper working margin of 300 mm (12 in, owner 2026-09-29)"}
    if b.startswith("placed from the sourced spot"):
        return {"mm": 150, "cls": "described", "text": "placed inside the area the source names in words (" + b.split("(", 1)[-1].rstrip(")") + "); not measured, so it carries the owner's lower working margin of 150 mm (6 in, owner 2026-09-29)"}
    if b.startswith("grouped with"):
        return {"mm": None, "cls": "grouped", "text": "it sits with " + p.get("grouped", "") + " and takes that part's margin"}
    return {"mm": None, "cls": "unknown", "text": "no margin rule for this basis: " + b}


# ------------------------------------------------------------------ wires: active (cut list v4.2) and implied
WIRES = {}
for w in REG["wires"]:
    to = w.get("to") or {}
    WIRES[w["id"]] = {"id": w["id"], "label": w.get("label"), "awg": w.get("awg"), "gauge": w.get("gauge"), "spec": w.get("spec"),
                      "color": w.get("color"), "len_ft": w.get("length_ft"), "len_basis": w.get("length_basis"),
                      "sub": w.get("subsystem"), "frm": w.get("frm"),
                      "to": " ".join(str(x) for x in (to.get("device"), to.get("pin")) if x) if isinstance(to, dict) else str(to),
                      "kind": "active", "crossing": (w.get("route") or {}).get("crossing")}
for w in REG["implied"]:
    WIRES[w["id"]] = {"id": w["id"], "label": w.get("label"), "awg": w.get("awg"), "gauge": w.get("gauge"), "spec": w.get("spec"),
                      "color": w.get("color"), "len_ft": w.get("length_ft"), "len_basis": w.get("length_basis"),
                      "sub": w.get("subsystem"), "frm": w.get("frm"), "to": w.get("to"), "kind": "implied",
                      "crossing": (w.get("route") or {}).get("crossing")}
EP = REG["endpoints"]
ends_of_wire = {}
for eid, e in EP.items():
    for wid in e.get("wires") or []:
        ends_of_wire.setdefault(wid, []).append(eid)
for wid, w in WIRES.items():
    w["ends"] = ends_of_wire.get(wid, [])

SYSTEM_WORD = {"CORE_ENGINE": "Engine", "LIGHTING_EXTERIOR": "Exterior lights", "AUDIO": "Audio", "DASH_CLUSTER_DAKOTA": "Gauges",
               "HVAC_AC": "Heat and A/C", "TRANS_6L90": "Transmission", "POWER_WINDOWS": "Windows", "LIGHTING_INTERIOR": "Interior lights",
               "CHARGING_STARTING": "Charging and starting", "WIPERS_WASHER": "Wipers", "ACCESSORY_12V": "Accessories (12 V)",
               "BRAKES_IBOOSTER": "Brakes", "POWER_LOCKS": "Locks", "DOME_COURTESY": "Interior lights", "AMP_STEPS": "Power steps",
               "COOLING": "Cooling", "FUEL": "Fuel", "HARNESS_INFRA": "Power and grounds", "EPARKING_BRAKE": "Brakes",
               "CAMERA_REAR": "Camera"}

# ------------------------------------------------------------------ same physical piece (drawn as part of another end)
SAME_PIECE = dict(sizes_m.SAME_PIECE)
for code, e in EP.items():
    pc = (PM.get(code) or {}).get("piece")
    if pc and pc in P and P.get(code, {}).get("grouped") == pc:
        SAME_PIECE.setdefault(code, pc)
LOOM = sizes_m.LOOM            # ends that are pieces of the harness itself: drawn with the routes

def extra_photo(code, rec):
    """A local photo verified to be the exact part (sizes.PHOTO), turned into page files like photos.py does."""
    import base64, hashlib, io
    src = os.path.join(REPO, rec["file"])
    h = hashlib.sha1(rec["file"].encode()).hexdigest()[:16]
    im = Image.open(src).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im); rgb = bg.convert("RGB")
    big = rgb.copy(); big.thumbnail((560, 560), Image.LANCZOS)
    big.save(os.path.join(SITE, "ph", h + ".jpg"), quality=84, optimize=True, progressive=True)
    th = rgb.copy(); th.thumbnail((72, 72), Image.LANCZOS)
    buf = io.BytesIO(); th.save(buf, "JPEG", quality=78, optimize=True)
    return {"url": rec["page"], "page": rec["page"], "fetched": rec.get("fetched"), "src": "ph/" + h + ".jpg",
            "thumb": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), "w": big.size[0], "h": big.size[1]}


# ------------------------------------------------------------------ the ends
items = []
by_id = {e["id"]: e for e in ENDS}
for e in ENDS:
    code = e["id"]
    p = P[code]
    media = PM.get(code) or {}
    ph = media.get("photo") or {}
    phx = PHOTOS.get(ph.get("url") or "", {})
    it = {"id": code, "what": e["what"], "where": e["where"], "zone": e["zone"], "status": e["status"], "why": e["why"],
          "open": e.get("open", []), "follows": e.get("follows"), "cat": p["cat"], "basis": p["basis"], "grouped": p.get("grouped"),
          "xyz": p["xyz"], "st": stations(p["xyz"]), "px": {}}
    for v in VIEWS:
        uv = proj(v, p["xyz"])
        if inview(v, uv):
            it["px"][v] = uv
    it["margin"] = margin(code, p)
    # media
    it["media"] = {k: media.get(k) for k in ("what", "maker", "maker_pn", "confidence", "note", "piece", "mates_with", "drawing", "cad",
                                             "datasheet", "instructions") if media.get(k)}
    if ph.get("url"):
        it["media"]["photo"] = {"url": ph["url"], "page": ph.get("page"), "fetched": ph.get("fetched"), "src": phx.get("src"),
                                "thumb": phx.get("thumb"), "w": phx.get("w"), "h": phx.get("h")}
    if code in sizes_m.PHOTO and not (it["media"].get("photo") or {}).get("src"):
        it["media"]["photo"] = extra_photo(code, sizes_m.PHOTO[code])
        it["media"]["photo_note"] = sizes_m.PHOTO[code]["note"]
    # registry
    r = EP.get(code) or {}
    it["reg"] = {k: r.get(k) for k in ("device", "family", "where", "side", "note", "kit", "cavity_count", "open", "sources") if r.get(k)}
    cav = r.get("cavities") or {}
    it["w"] = [{"id": wid, "cav": cav.get(wid)} for wid in (r.get("wires") or [])]
    subs = [WIRES[x["id"]]["sub"] for x in it["w"] if x["id"] in WIRES and WIRES[x["id"]].get("sub")]
    it["sys"] = SYSTEM_WORD.get(max(set(subs), key=subs.count), "Other") if subs else "Other"
    items.append(it)
ITEM = {i["id"]: i for i in items}
for i in items:
    if i["sys"] == "Other" and i.get("grouped") in ITEM:
        i["sys"] = ITEM[i["grouped"]]["sys"]
    if i["sys"] == "Other" and i["id"] in sizes_m.SYSTEM:
        i["sys"] = sizes_m.SYSTEM[i["id"]]

# footprints per end
def colour_of(code, f):
    if f.get("top") or f.get("side"):
        return f
    ph = (ITEM[code]["media"].get("photo") or {})
    cols = (PHOTOS.get(ph.get("url") or "", {}) or {}).get("colors") or []
    if cols:
        f = dict(f); f["top"] = f["side"] = cols[0]["hex"]
        conf = ITEM[code]["media"].get("confidence")
        f["color"] = "dominant colour of the part_media photo (k-means, %d%% of the part's pixels)%s" % (
            round(cols[0]["share"] * 100), "; the photo is a sibling part" if conf == "same_family_photo" else "")
    return f


drawn = 0
for i in items:                     # pass 1: an end with its own footprint, or the same catalogued part as another end
    code = i["id"]
    f = FPS.get(code)
    src_piece = None
    if not f and code not in SAME_PIECE and not i.get("grouped"):
        pc = (i["media"].get("piece") or "")
        if pc in FPS and pc in ITEM:
            f = FPS[pc]; src_piece = pc
    if f:
        f = colour_of(code, f)
        i["fp"] = {k: f.get(k) for k in ("shape", "dx", "dy", "dz", "d", "t", "axis", "top", "side", "size", "color", "basis", "from", "orient", "params")}
        if src_piece:
            i["fp"]["same_as"] = src_piece
        i["draw"] = {}
        for v in VIEWS:
            g = rect(v, i["xyz"], f)
            if g:
                i["draw"][v] = g
        i["drawn"] = "own"
for i in items:                     # pass 2: ends that are part of another end's piece, and the reasons for the rest
    code = i["id"]
    if i.get("drawn"):
        continue
    tgt = SAME_PIECE.get(code)
    if tgt and ITEM.get(tgt, {}).get("drawn") == "own":
        i["drawn"] = "piece"; i["piece_of"] = tgt
        continue
    i["drawn"] = None
    if code in LOOM:
        i["why_not"] = "unused" if LOOM[code].startswith("not used") else "loom"; i["why_not_text"] = LOOM[code]
    elif tgt:
        i["why_not"] = "size"; i["why_not_text"] = "it is part of " + tgt + ", which is not drawn yet"
    elif i.get("grouped"):
        i["why_not"] = "grouped"
        i["why_not_text"] = "its own spot is not set: it sits with " + i["grouped"] + " for now, so it is not drawn on top of that part"
    else:
        i["why_not"] = "size"
        i["why_not_text"] = sizes_m.TODO.get(code) or ("partly read: " + PARTIAL[code] if code in PARTIAL else "size not read")
drawn = sum(1 for i in items if i["drawn"])

BLOBJ = json.load(open(os.path.join(LOC, "bl_objects.json")))
for name, label, note in sizes_m.CONTEXT_MESHES:
    o = BLOBJ.get(name)
    if not o:
        continue
    mn, mx = o["min"], o["max"]
    CONTEXT.append({"id": "ctx:" + name, "label": label, "xyz": tuple((a + c) / 2 for a, c in zip(mn, mx)),
                    "fp": {"shape": "box", "dx": (mx[0] - mn[0]) * 1000, "dy": (mx[1] - mn[1]) * 1000, "dz": (mx[2] - mn[2]) * 1000,
                           "color": "outline only"},
                    "note": note + " (body model mesh %s: %d x %d x %d mm, stations %.0f to %.0f in)" % (
                        name, (mx[0] - mn[0]) * 1000, (mx[1] - mn[1]) * 1000, (mx[2] - mn[2]) * 1000,
                        (mn[1] - FRONT_AXLE) * IN_PER_M, (mx[1] - FRONT_AXLE) * IN_PER_M)})
for i in items:
    for c in sizes_m.CALLS.get(i["id"], []):
        i.setdefault("calls", []).append(c)

ctx = []
for c in CONTEXT:
    d = {}
    for v in VIEWS:
        g = rect(v, c["xyz"], c["fp"])
        if g:
            d[v] = g
    ctx.append({"id": c.get("id", "ctx:" + c["label"]), "label": c["label"], "note": c["note"], "draw": d, "color": c["fp"].get("color"),
                "calls": sizes_m.CALLS.get(c.get("id", ""), []), "st": stations(c["xyz"])})

# ------------------------------------------------------------------ routes (harness-cad)
routes = None
SEG_KEYS = ("id", "bundle", "status", "from_node", "to_node", "wires", "cables", "parallel", "od_mm", "od_basis", "od_unknowns", "covering",
            "length_m", "margin_mm", "margin_basis", "clip_spacing_mm", "ties", "tie_spacing_mm", "firewall_shift_mm", "why", "basis", "checks",
            "conflict", "position_open")
if routes_src:
    R = json.load(open(os.path.join(IN, "routes.json")))
    routes = {"src": routes_src, "status": R.get("status"), "scope": R.get("scope"), "generated_by": R.get("generated_by"),
              "segments": [], "nodes": [], "clips": [], "sources": R.get("sources") or {}}
    def rdp(pts, eps=0.35):
        """Drop points closer than eps image px to the line through their neighbours (Ramer-Douglas-Peucker)."""
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        L = math.hypot(x2 - x1, y2 - y1) or 1e-9
        d = [abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / L for x, y in pts[1:-1]]
        ix = max(range(len(d)), key=d.__getitem__)
        if d[ix] > eps:
            return rdp(pts[:ix + 2], eps)[:-1] + rdp(pts[ix + 1:], eps)
        return [pts[0], pts[-1]]
    CHECK_SRC = []
    for s in R.get("segments", []):
        s2 = {k: s.get(k) for k in SEG_KEYS if k in s}
        s2["px"] = {v: rdp([proj(v, q) for q in s["points"]]) for v in VIEWS}
        s2["checks"] = []
        for c in s.get("checks") or []:
            src = c.get("source") or ""
            if src not in CHECK_SRC:
                CHECK_SRC.append(src)
            s2["checks"].append({"rule": c.get("rule"), "result": c.get("result"), "why": c.get("why"), "s": CHECK_SRC.index(src)})
        if not s2.get("length_m"):
            s2["length_m"] = round(sum(math.dist(a, c) for a, c in zip(s["points"], s["points"][1:])), 3)
        s2["checks_failed"] = sum(1 for c in (s.get("checks") or []) if str(c.get("result", "")).lower() not in ("pass", "ok"))
        s2["od_basis"] = s.get("od_basis") if s.get("od_basis") not in CHECK_SRC else s.get("od_basis")
        routes["segments"].append(s2)
    for key in ("nodes", "clips"):
        for n in R.get(key, []):
            n2 = dict(n); n2["px"] = {v: proj(v, n["pos"]) for v in VIEWS if inview(v, proj(v, n["pos"]))}
            n2["st"] = stations(n["pos"])
            ep = n.get("ep")
            if ep and ep in ITEM:
                n2["gap_mm"] = round(math.dist(n["pos"], ITEM[ep]["xyz"]) * 1000)
                ITEM[ep].setdefault("route_nodes", []).append({"id": n["id"], "kind": n.get("kind"), "gap_mm": n2["gap_mm"]})
            routes[key].append(n2)
    routes["check_sources"] = CHECK_SRC
    by_node = {}
    for s in routes["segments"]:
        for nid in (s.get("from_node"), s.get("to_node")):
            by_node.setdefault(nid, []).append(s["id"])
    for n in routes["nodes"]:
        n["segments"] = by_node.get(n["id"], [])
    for i in items:
        segs = sorted({sid for rn in i.get("route_nodes", []) for sid in by_node.get(rn["id"], [])})
        if segs:
            i["route_segs"] = segs
    wire_segs = {}
    for s in routes["segments"]:
        for w in s.get("wires") or []:
            wire_segs.setdefault(w, []).append(s["id"])
    for wid, w in WIRES.items():
        if wid in wire_segs:
            w["segs"] = wire_segs[wid]

# ------------------------------------------------------------------ 3D: harness-cad's bay sample, as a script the page loads on demand
glb = None
if os.path.exists(BAY_GLB):
    raw = open(BAY_GLB, "rb").read()
    bad = [s for s in (b"blendermcp", b"api_key", b"apikey", b"API_KEY") if s in raw]
    if bad:
        print("REFUSED: the bay GLB carries", bad, "- not published")
    else:
        import base64
        os.makedirs(os.path.join(SITE, "3d"), exist_ok=True)
        open(os.path.join(SITE, "3d", "bay_sample.js"), "w").write("window.K5_BAY_GLB=\"" + base64.b64encode(raw).decode() + "\";\n")
        glb = {"src": "3d/bay_sample.js", "from": BAY_GLB.replace(os.path.expanduser("~"), "~"), "bytes": len(raw),
               "made": datetime.datetime.fromtimestamp(os.path.getmtime(BAY_GLB)).strftime("%Y-%m-%d %H:%M"),
               "axes": "glTF (X, Y, Z) = twin (x, z, -y)"}

# ------------------------------------------------------------------ cost, status and who is on it (from the records' own words)
ASR = yaml.safe_load(open(os.path.join(IN, "suppliers_asr.yaml"))) if os.path.exists(os.path.join(IN, "suppliers_asr.yaml")) else {"items": []}
PARTS = yaml.safe_load(open(os.path.join(IN, "parts.yaml"))) if os.path.exists(os.path.join(IN, "parts.yaml")) else {}
norm = lambda s: re.sub(r"[^A-Z0-9]", "", str(s or "").upper())
ASR_BY_PN = {}
for it in ASR.get("items") or []:
    if it.get("maker_pn") and it.get("price_usd") is not None:
        ASR_BY_PN.setdefault(norm(it["maker_pn"]), []).append(it)
TODAY = datetime.date.today()
SNAPDIR = os.path.join(REPO, "reference_documents", "web_snapshots")


def snap_url(name):
    """The source URL written in a web snapshot's header."""
    p = os.path.join(SNAPDIR, os.path.basename(name))
    if not p.endswith(".md"):
        p += ".md"
    try:
        m = re.search(r"source:\s*(https?://\S+)", open(p, errors="ignore").read(400))
        return m.group(1) if m else None
    except OSError:
        return None


def snap_date(name):
    """The fetch date written in a web snapshot's header."""
    p = os.path.join(SNAPDIR, os.path.basename(name))
    if not p.endswith(".md"):
        p += ".md"
    try:
        head = open(p, errors="ignore").read(400)
        m = re.search(r"fetched:\s*(\d{4}-\d{2}-\d{2})", head)
        return m.group(1) if m else None
    except OSError:
        return None


def age_days(d):
    try:
        return (TODAY - datetime.date.fromisoformat(d)).days
    except (TypeError, ValueError):
        return None


LINED = re.compile(r"lined up at ([^,;()]+?),\s*\$([\d,]+(?:\.\d+)?)(\s+(?:a pair|each))?")
EVID = [   # (label, pattern, which records may say it, words that cancel the match in the same sentence)
    ("on the truck", re.compile(r"device proof|\bInstalled:|mounted on the|as bought carries", re.I), ("why",),
     re.compile(r"withdrawn", re.I)),
    ("bought", re.compile(r"order record|the owner bought|bought on eBay|bought \d{4}-\d{2}-\d{2}|\bpurchased\b|invoice_proven", re.I), ("media", "reg"),
     re.compile(r"not owned|not bought|via Dave|as bought|to buy|will be bought", re.I)),
    ("lined up, not ordered", re.compile(r"lined up at", re.I), ("reg",), None),
    ("not bought", re.compile(r"not bought|nothing is bought|to_buy|not yet bought|not owned", re.I), ("reg", "media"), None),
]
OWNER = re.compile(r"\bowner\b|owner's|Skylar", re.I)


def texts_of(i, pools):
    """The sentences a record pool holds about an end, with where each came from."""
    out = []
    if "why" in pools:
        out += [(w["text"] + " (" + w["source"] + ")", w["source"]) for w in i.get("why") or []]
    r = i.get("reg") or {}
    if "reg" in pools:
        out += [(r.get("device") or "", "k5_registry.json endpoint device"), (r.get("note") or "", "k5_registry.json endpoint note")]
    m = i.get("media") or {}
    if "media" in pools:
        out += [(m.get("note") or "", "part_media.yaml note")]
    return [(t, s) for t, s in out if t]


for i in items:
    cost = {"list": [], "kit": [], "paid": None}
    r = i.get("reg") or {}
    for t, s in texts_of(i, ("reg",)):
        for m in LINED.finditer(t):
            vendor, price, unit = m.group(1).strip(), float(m.group(2).replace(",", "")), (m.group(3) or "").strip()
            date = url = None
            for src in r.get("sources") or []:
                if vendor.split()[0].lower().rstrip(".com") in src.lower() and "web_snapshots/" in src:
                    snap = src.split("web_snapshots/")[1].split(" ")[0]
                    date, url = snap_date(snap), snap_url(snap)
                    break
            cost["list"].append({"usd": price, "unit": unit or "each", "vendor": vendor, "date": date, "age": age_days(date), "url": url,
                                 "src": "k5_registry.json device text ('lined up at %s')" % vendor + ("; snapshot fetched " + date if date else "; date not recorded")})
    pn = norm((i.get("media") or {}).get("maker_pn"))
    for it in ASR_BY_PN.get(pn, []) if pn else []:
        cost["list"].append({"usd": it["price_usd"], "unit": "each", "vendor": "Affordable Street Rods", "date": it.get("price_scraped_at"),
                             "age": age_days(it.get("price_scraped_at")), "url": it.get("url"),
                             "src": "suppliers/affordablestreetrods.yaml (store JSON, maker_pn %s)" % it["maker_pn"]})
    for code, qty in (r.get("kit") or {}).items():
        p = PARTS.get(code) or {}
        cost["kit"].append({"code": code, "qty": qty, "usd": p.get("price"), "vendor": p.get("vendor"),
                            "src": "; ".join(str(x) for x in (p.get("sources") or [])[:1]) or "parts.yaml"})
    ev = {}
    for label, rx, pools, cancel in EVID:
        for t, s in texts_of(i, pools):
            for sent in re.split(r"(?<=[.;])\s+|\s+\u2014\s+", t):
                m = rx.search(sent)
                if m and not (cancel and cancel.search(sent)):
                    ev[label] = {"text": (t if pools == ("why",) else sent).strip()[:260], "src": s}
                    break
            if label in ev:
                break
    if "bought" in ev:
        cost["paid"] = {"shown": "$\u2022\u2022\u2022, from your records", "evidence": ev["bought"]}
    status = ("on the truck" if "on the truck" in ev else "bought" if "bought" in ev else "lined up, not ordered" if "lined up, not ordered" in ev
              else "needed, not bought" if "not bought" in ev else "unknown")
    i["cost"] = cost
    i["buy"] = {"status": status, "evidence": ev.get("not bought" if status == "needed, not bought" else status)}
    owner_ev = next(({"text": w["text"][:220], "src": w["source"]} for w in i.get("why") or [] if OWNER.search(w["source"])), None)
    design = [{"what": "spot and reasons", "who": "pieces", "file": "ends.py, pos.py"}]
    if i.get("fp"):
        frm = i["fp"].get("from") or ""
        who = "parts-artist" if "parts-artist" in frm else ("layout-ui" if "layout-ui" in frm else "pieces")
        design.append({"what": "size", "who": who, "file": frm})
    if i.get("route_nodes"):
        design.append({"what": "route", "who": "harness-cad", "file": "routes.json (%s)" % (routes or {}).get("status", "")})
    stages = [
        {"stage": "researched", "state": "done" if i.get("why") else "unknown", "ev": "%d sourced reasons in ends.py" % len(i.get("why") or [])},
        {"stage": "designed", "state": "done" if i.get("drawn") and (i.get("media") or {}).get("maker_pn") not in (None, "unknown") else "not yet",
         "ev": "part number picked and drawn to size" if i.get("drawn") else "not drawn to size yet"},
        {"stage": "audited", "state": "unknown", "ev": "no per-part audit record on file"},
        {"stage": "approved by Skylar", "state": "owner call" if owner_ev else "unknown",
         "ev": (owner_ev["text"] + " (" + owner_ev["src"] + ")") if owner_ev else "no owner call on file for this end"},
        {"stage": "ordered", "state": "done" if ("bought" in ev or "on the truck" in ev) else ("not yet" if ("lined up, not ordered" in ev or "not bought" in ev) else "unknown"),
         "ev": (ev.get("bought") or ev.get("on the truck") or ev.get("lined up, not ordered") or ev.get("not bought") or {}).get("text", "no record")},
        {"stage": "built", "state": "unknown", "ev": "no build record on file"},
        {"stage": "verified on the truck", "state": "done" if "on the truck" in ev else "unknown", "ev": (ev.get("on the truck") or {}).get("text", "no record")},
    ]
    i["work"] = {"design": design, "build": "unassigned", "stages": stages}

# roll-ups over physical pieces (an end drawn as part of another is not counted twice)
def best_price(i):
    ps = sorted((i.get("cost") or {}).get("list") or [], key=lambda p: (p.get("age") is None, p.get("age") or 0))
    return ps[0] if ps else None


roll = {"systems": {}, "total": 0.0, "priced": 0, "pieces": 0}
for i in items:
    if i.get("drawn") == "piece":
        continue
    roll["pieces"] += 1
    p = best_price(i)
    s = roll["systems"].setdefault(i["sys"], {"usd": 0.0, "priced": 0, "pieces": 0})
    s["pieces"] += 1
    if p:
        mult = 0.5 if p["unit"] == "a pair" else 1.0
        s["usd"] += p["usd"] * mult; s["priced"] += 1
        roll["total"] += p["usd"] * mult; roll["priced"] += 1
carts = [{k: c.get(k) for k in ("vendor", "captured", "status", "line_count", "total")} for c in REG.get("carts", []) if c.get("total")]

# ------------------------------------------------------------------ layout calls: the mount boxes
boxes = []
for b in MOUNTS.get("boxes", []):
    boxes.append({k: b.get(k) for k in ("id", "what", "where", "zone", "status", "why", "instead", "open", "nodes", "parts")})

data = {
    "built": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "main": main_head, "stamp": stamp,
    "views": VIEWS, "items": items, "wires": WIRES, "context": ctx, "routes": routes, "boxes": boxes, "glb": glb,
    "counts": {"ends": len(items), "drawn": drawn}, "body_margin": BODY_MARGIN, "roll": roll, "carts": carts,
    "stale_days": sizes_m.STALE_DAYS, "builder_note": sizes_m.BUILDER_NOTE, "referral": sizes_m.REFERRAL,
    "sources": {"ends": "pieces lane: ends.py " + stamp["ends.py"] + ", pos.py " + stamp["pos.py"],
                "sizes": "footprints.py (pieces), part_models.yaml (parts-artist), sizes.py (layout-ui)",
                "media": "docs/wiring/calc-data/catalog/part_media.yaml @ " + main_head,
                "registry": "docs/wiring/calc-data/k5_registry.json @ " + main_head,
                "boxes": "docs/wiring/calc-data/catalog/mounts.yaml boxes @ " + main_head,
                "routes": (routes_src + " (" + stamp.get("routes.json", "") + ")") if routes_src else "none yet (harness-cad is routing every bundle in Blender)",
                "3D": (glb["from"] + " (" + glb["made"] + ")") if glb else "none",
                "prices": "k5_registry.json device text and snapshots; suppliers/affordablestreetrods.yaml; parts.yaml (kit parts)"},
}
MONEY = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?")
ORDER_NO = re.compile(r"(\b(?:order|invoice|receipt|confirmation)\s*(?:no\.?|number|num)?\s*[:#]?\s*)((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,})", re.I)


def mask(o, money=True):
    """Prices and order numbers stay in the records; the page masks them ($•••, order •••), per the owner's masking rule."""
    if isinstance(o, str):
        if o.startswith("data:"):
            return o
        o = ORDER_NO.sub(lambda m: m.group(1) + "\u2022\u2022\u2022", o)
        return MONEY.sub("$\u2022\u2022\u2022", o) if money else o
    if isinstance(o, list):
        return [mask(v) for v in o]
    if isinstance(o, dict):
        return {k: mask(v) for k, v in o.items()}
    return o


KEEP_PRICES = {"cost", "roll", "carts"}


def mask_items(o, money=True):
    """Everything gets order numbers masked; list prices in the cost fields stay readable, free text keeps them masked."""
    if isinstance(o, dict):
        return {k: mask_items(v, money and k not in KEEP_PRICES) for k, v in o.items()}
    if isinstance(o, list):
        return [mask_items(v, money) for v in o]
    return mask(o, money)


data = mask_items(data)
blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
src = os.path.join(D, "src")
html = (open(os.path.join(src, "head.html")).read() + open(os.path.join(src, "body.html")).read()
        .replace("__DATA__", blob).replace("__APPJS__", open(os.path.join(src, "app.js")).read()))
open(OUT_HTML, "w").write(html)
js = open(os.path.join(src, "app.js")).read()
open(os.path.join(D, "_check.js"), "w").write(js)
print("ends", len(items), "drawn", drawn, "| html", len(html) // 1024, "KB | routes", bool(routes))
