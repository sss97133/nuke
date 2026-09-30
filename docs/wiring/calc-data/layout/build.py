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
import datetime, glob, importlib.util, json, math, os, re, shutil, subprocess, sys
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
SAMPLES = os.path.expanduser("~/k5-harness-pull/parts/samples/")                     # parts-artist: GLB, pins.json, params.json per part
PARTSLIB = os.path.join(D, "..", "partslib", "build.py")                            # the Parts Library page's part list (facts, open)
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
if not git_show("docs/wiring/calc-data/catalog/part_models.yaml", os.path.join(IN, "part_models.yaml")) and os.path.exists(PARTS_ARTIST):
    shutil.copy(PARTS_ARTIST, os.path.join(IN, "part_models.yaml"))      # main first (#431); the parts-artist worktree before it lands
git_show("docs/wiring/calc-data/cad/tape_list.yaml", os.path.join(IN, "tape_list.yaml"))
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
LISTING = re.compile(r"(?i)\b(?:ebay|amazon)\s+(?:item|listing)\s*#?\s*\d{6,}")
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
    if LISTING.search(str(it["media"].get("maker_pn") or "")) or str(it["media"].get("maker_pn") or "").strip().lower() == "unknown":
        it["media"].pop("maker_pn", None)                  # a listing id points at his purchase; "unknown" is shown as a dash
    if it["media"].get("maker"):
        it["media"]["maker"] = re.sub(r"\s*\((?:eBay|Amazon) seller [^)]*\)", "", it["media"]["maker"]).strip() or "unknown"
    if ph.get("url"):
        listing = bool(re.search(r"(?:ebay|amazon)\.com/(?:itm|dp)/", str(ph.get("page") or "") + str(ph.get("url") or ""), re.I))
        it["media"]["photo"] = {"url": None if listing else ph["url"], "page": None if listing else ph.get("page"), "fetched": ph.get("fetched"), "src": phx.get("src"),
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
        s2["checks_failed"] = sum(1 for c in (s.get("checks") or []) if str(c.get("result", "")).lower() in ("flag", "exception", "fail", "failed"))
        s2["checks_notrun"] = sum(1 for c in (s.get("checks") or []) if str(c.get("result", "")).lower() == "not run")
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
    bad = [s for s in (b"blendermcp", b"api_key", b"apikey", b"sketchfab") if s in raw.lower()]
    if bad:
        print("REFUSED: the bay GLB carries", bad, "- not published")
    else:
        import base64
        os.makedirs(os.path.join(SITE, "3d"), exist_ok=True)
        open(os.path.join(SITE, "3d", "bay_sample.js"), "w").write("window.K5_BAY_GLB=\"" + base64.b64encode(raw).decode() + "\";\n")
        glb = {"src": "3d/bay_sample.js", "from": BAY_GLB.replace(os.path.expanduser("~"), "~"), "bytes": len(raw),
               "made": datetime.datetime.fromtimestamp(os.path.getmtime(BAY_GLB)).strftime("%Y-%m-%d %H:%M"),
               "axes": "glTF (X, Y, Z) = twin (x, z, -y)"}

# ------------------------------------------------------------------ harness-cad's labelled renders of the bay sample (the Engine Bay Sample page's figures)
RENDERS = []
for name, cap in (("bay_labelled", "The whole bay, labelled. Red and black are the DC primary; D1 to D15 give each cable's gauge, ends and length. Orange is the "
                                   "engine loom from the 61-pin; E1 to E16 give each branch's wire count and bundle diameter. Blue marks are sensor plugs, until "
                                   "their true-size models replace them."),
                  ("power", "The power corner. The Odyssey is drawn at 276 x 180 x 200 mm and the Blue Sea 7700 isolator from Blue Sea's dimension drawing, "
                            "with the 2 AWG pairs run side by side."),
                  ("pin61", "The 61-pin at the old fuse-box hole, on the CNC plate from its CAD file. The engine trunk drops into the back of the connector.")):
    src = os.path.join(D, "..", "baysample", name + ".jpg")
    if os.path.exists(src):
        out = os.path.join(SITE, "v", "r_" + name + ".jpg")
        if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
            im = Image.open(src).convert("RGB")
            if im.size[0] > 1600:
                im = im.resize((1600, int(im.size[1] * 1600 / im.size[0])), Image.LANCZOS)
            im.save(out, quality=84, optimize=True)
        RENDERS.append({"src": "v/r_" + name + ".jpg", "cap": cap, "from": "harness-cad, K5 Engine Bay Sample page (2026-09-29)"})

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

# ------------------------------------------------------------------ workspace model: systems > devices > connectors > pins
TAPE = yaml.safe_load(open(os.path.join(IN, "tape_list.yaml"))) if os.path.exists(os.path.join(IN, "tape_list.yaml")) else {"items": []}
natkey = lambda s: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", str(s))]
cav_label = lambda c: "" if c is None else str(c).split(" — ")[0].strip()
cav_key = lambda c: re.sub(r"^([A-Za-z]+)0+(\d)", r"\1\2", cav_label(c))
PASS = re.compile(r"^(FIREWALL-|SPL-|RAIL-)|PASS")
REGW = {w["id"]: w for w in REG["wires"]}
REGW.update({w["id"]: w for w in REG["implied"]})
TERM = {}
for t in REG["terminations"]:
    TERM.setdefault(t["wire"], []).append(t)
SEG = {s["id"]: s for s in (routes or {}).get("segments", [])}


def chain(wid):
    """The ends a wire runs through, in order: the end its registry 'frm' names, then pass-throughs (splices, the 61-pin, bulkheads), then the rest."""
    ts = TERM.get(wid, [])
    frm = str((REGW.get(wid) or {}).get("frm") or "")
    head = re.split(r"[:\s(]", frm, maxsplit=1)[0]
    pin = frm.split(":", 1)[1] if ":" in frm else None
    first = next((t for t in ts if t["endpoint"] == head or (head and t["endpoint"].startswith(head + "-")
                                                              and (pin is None or cav_key(t["cavity"]) == cav_key(pin)))), ts[0] if ts else None)
    rest = [t for t in ts if t is not first]
    cab_first = (EP.get((first or {}).get("endpoint"), {}).get("side") != "engine bay")
    via = sorted([t for t in rest if PASS.search(t["endpoint"])],
                 key=lambda t: (0 if t["endpoint"].startswith("SPL-") else 1, ("CABIN" in t["endpoint"]) != cab_first))
    return ([first] if first else []) + via + [t for t in rest if not PASS.search(t["endpoint"])]


for wid, w in WIRES.items():
    rw = REGW.get(wid) or {}
    w["ch"] = [[t["endpoint"], cav_label(t["cavity"]), t.get("part")] for t in chain(wid)]
    w.update({"len_kind": rw.get("length_kind"), "opt": rw.get("option"), "opt_st": rw.get("option_status"), "notes": rw.get("notes"),
              "src": (rw.get("sources") or [])[:6], "hist": (rw.get("conflicts") or [])[:6], "limit": rw.get("pdm_limit"),
              "prot": rw.get("protection"), "ctl": rw.get("control"), "basis": rw.get("color_basis")})
    segs = [SEG[s] for s in w.get("segs", []) if s in SEG]
    if segs:
        w["rl"] = round(sum(s.get("length_m") or 0 for s in segs), 3)
        w["rm"] = round(math.sqrt(sum((s.get("margin_mm") or 0) ** 2 for s in segs)))

# pins: every cavity the registry terminates, plus every cavity the parts-artist's pins.json names (spares included)
PINS = {}
for t in REG["terminations"]:
    rec = PINS.setdefault(t["endpoint"], {}).setdefault(cav_key(t["cavity"]), {"c": cav_label(t["cavity"]), "w": [], "t": t.get("part")})
    rec["w"].append(t["wire"])
    if len(str(t["cavity"])) > len(rec["c"]) + 2:
        rec["note"] = str(t["cavity"])
    if t.get("factory_circuit"):
        rec["fc"] = t["factory_circuit"]
PINSRC = {}


def face_xy(cavs):
    """Wire-side face positions (mm) from pins.json: the plane square to the exit direction, turned so row 1 is on top and cavity 1 on the left."""
    pts = [c for c in cavs if c.get("wire_side_glb_m") and c.get("exit_dir_glb")]
    if len(pts) < 2:
        return {}
    d = pts[0]["exit_dir_glb"]
    up = (0, 1, 0) if abs(d[1]) < 0.9 else (0, 0, -1)
    f = (-d[0], -d[1], -d[2])
    right = (f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0])
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    xy = {c["pin"]: [dot(c["wire_side_glb_m"], right) * 1000, dot(c["wire_side_glb_m"], up) * 1000] for c in pts}
    rows = [c for c in pts if c.get("row")]
    if rows:
        r1 = [c for c in rows if c["row"] == min(r["row"] for r in rows)]
        rn = [c for c in rows if c["row"] == max(r["row"] for r in rows)]
        if sum(xy[c["pin"]][1] for c in r1) / len(r1) < sum(xy[c["pin"]][1] for c in rn) / len(rn):
            for k in xy:
                xy[k][1] *= -1
        r1.sort(key=lambda c: c.get("cavity") or 0)
        if len(r1) > 1 and xy[r1[0]["pin"]][0] > xy[r1[-1]["pin"]][0]:
            for k in xy:
                xy[k][0] *= -1
    cx = sum(v[0] for v in xy.values()) / len(xy); cy = sum(v[1] for v in xy.values()) / len(xy)
    return {k: [round(v[0] - cx, 2), round(v[1] - cy, 2)] for k, v in xy.items()}


import ast, base64
PL = []                                          # the six parts the pieces lane audited first: their curated facts and mount (partslib/build.py)
if os.path.exists(PARTSLIB):
    _tree = ast.parse(open(PARTSLIB).read())
    PL = next(ast.literal_eval(n.value) for n in _tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "PARTS")
PL_BY = {p["id"]: p for p in PL}

# the part-model index: every modelled end (nuke_frontend/public/wiring/part-models/index.json); the audited batch branch first
PMI, PMI_SRC = {"parts": {}}, None
for ref in ("origin/main",):                           # the merged index only: audited batches land here
    subprocess.run(["git", "-C", REPO, "fetch", "origin", ref.split("/", 1)[1], "--quiet"], capture_output=True)
    r = subprocess.run(["git", "-C", REPO, "show", ref + ":nuke_frontend/public/wiring/part-models/index.json"], capture_output=True)
    if r.returncode == 0:
        PMI, PMI_SRC = json.loads(r.stdout), ref.replace("origin/", "") + " nuke_frontend/public/wiring/part-models/index.json"
        break
MODELLED = {}
for pid, pm in PMI["parts"].items():
    for e in pm.get("endpoints") or []:
        MODELLED.setdefault(e, []).append(pid)


def sample_file(pid, suffix):
    g = sorted(glob.glob(SAMPLES + "*/" + pid + suffix))
    return g[0] if g else None


# pins: each end's own pins.json (its assembly, or the device part that carries it), only the half its wires land on
for ep in sorted(set(EP) | set(MODELLED)):
    cands = [ep] + [pid for pid in MODELLED.get(ep, []) if (PMI["parts"][pid].get("kind") or "device") != "piece"]
    pf = next((f for f in (sample_file(c, ".pins.json") for c in cands) if f), None)
    if not pf:
        continue
    pj = json.load(open(pf))
    cavs = [c for c in pj.get("cavities", []) if (c.get("endpoint") or pj.get("id")) == ep]
    if not cavs:
        continue
    faces = {}
    for c in cavs:
        faces.setdefault(tuple(c.get("exit_dir_glb") or ()), []).append(c)
    use = max(faces.values(), key=lambda g: sum(len(c.get("wires") or []) for c in g))
    mates = sorted({(c.get("full_name") or c.get("name") or "").split(" cavity")[0] for g in faces.values() if g is not use for c in g} - {""})
    xy = face_xy(use)
    PINSRC[ep] = {"file": os.path.basename(pf), "numbering": pj.get("numbering"), "names": pj.get("names"), "orient": pj.get("orientation_unknown"),
                  "frame": pj.get("frame"), "mate_half": mates}
    have = PINS.setdefault(ep, {})
    for c in use:
        label = re.sub(r"^[RP](\d+)$", r"\1", c["pin"])            # an assembly names its halves R/P; the registry numbers the cavities
        full = re.sub(r"^(Hi|Lo)\s+", "", re.sub(r"\s{2,}.*$", "", (c.get("full_name") or "").strip()))
        pw = sorted(w.get("id") for w in c.get("wires") or [] if w.get("id"))
        key = cav_key(label)
        if key not in have and pw:                 # a stud or post: the registry names it in words, so match it by its wires
            key = next((k for k, r in have.items() if set(r["w"]) & set(pw)), key)
        rec = have.setdefault(key, {"c": label, "w": [], "t": None})
        if key == cav_key(label):
            rec["c"] = label
        rec.update({"n": c.get("name"), "f": full, "tec": c.get("cavity"), "row": c.get("row"), "xy": xy.get(c["pin"]), "pj": c["pin"]})
        if pw and sorted(set(rec["w"])) != sorted(set(pw)):
            rec["pj_w"] = pw                         # pins.json and the registry disagree: shown, not merged
PINS = {ep: sorted(v.values(), key=lambda r: natkey(r["c"])) for ep, v in PINS.items()}

# connectors: structured fields from the registry kit, its terminations, part_media and parts.yaml
KIND_FIELD = {"contact": "term", "terminal": "term", "lug": "term", "seal": "seal", "plug": "seal", "wedge": "lock", "tpa": "lock",
              "backshell": "shell", "boot": "shell", "housing": "housing", "kit": "kit", "splice": "term"}
USED_BY = {}
CAPACITY = {}                                   # the registry's capacity table names the 61-pin and the body bulkheads in words
for name, rec in ((REG.get("capacity") or {}).get("resources") or {}).items():
    m = re.match(r"body bulkhead ([A-Z])\b", name)
    eps = ["FIREWALL-CABIN", "FIREWALL-ENGINE"] if name.startswith("61-pin") else (["FIREWALL-BODY-" + m.group(1)] if m else [])
    for e in eps:
        if isinstance(rec.get("capacity"), (int, float)):
            CAPACITY[e] = (int(rec["capacity"]), "k5_registry.json capacity '%s' (%s)" % (name, rec.get("source") or "no source named"))
for i in items:
    code = i["id"]
    r = EP.get(code) or {}
    fields = {}
    for kc, qty in (r.get("kit") or {}).items():
        p = PARTS.get(kc) or {}
        fields.setdefault(KIND_FIELD.get(p.get("kind"), "kit"), []).append({"code": kc, "qty": qty, "name": p.get("name"), "kind": p.get("kind")})
        USED_BY.setdefault(kc, set()).add(code)
    tcount = {}
    for p in PINS.get(code, []):
        for part in re.split(r"\s+\+\s+", str(p.get("t") or "")):
            if part and part != "None":
                tcount[part] = tcount.get(part, 0) + max(1, len(p["w"]))
    for part, n in sorted(tcount.items(), key=lambda kv: -kv[1]):
        pp = PARTS.get(part)
        if pp:
            fields.setdefault(KIND_FIELD.get(pp.get("kind"), "term"), []).append({"code": part, "qty": n, "name": pp.get("name"), "kind": pp.get("kind")})
            USED_BY.setdefault(part, set()).add(code)
        else:
            fields.setdefault("term_open", []).append({"text": part, "qty": n})
    pins = PINS.get(code, [])
    cc = r.get("cavity_count")
    if isinstance(cc, (int, float)):
        cav_n, cav_src = int(cc), "k5_registry.json cavity_count"
    elif code in CAPACITY:
        cav_n, cav_src = CAPACITY[code]
    elif code in PINSRC:
        cav_n, cav_src = len(pins), PINSRC[code]["file"]
    else:
        cav_n, cav_src = None, "no cavity count on file"
    m = i.get("media") or {}
    mates = []
    for x in m.get("mates_with") or []:
        p = PARTS.get(str(x)) or {}
        mates.append({"code": str(x), "name": p.get("name"), "end": str(x) if str(x) in EP else None})
    root = sizes_m.DEVICE_MEMBER.get(code) or SAME_PIECE.get(code) or code
    i["dev"] = sizes_m.DEVICE[root][0] if root in sizes_m.DEVICE else root
    i["conn"] = {"family": r.get("family"), "family_word": sizes_m.FAMILY_WORD.get(r.get("family"), r.get("family")), "cav_n": cav_n, "cav_src": cav_src,
                 "used": sum(1 for p in pins if p["w"]), "fields": fields, "mates": mates, "face": code in PINSRC and any(p.get("xy") for p in pins)}
    i["pins_src"] = PINSRC.get(code)

# devices and systems
DEVS = {}
for i in items:
    d = DEVS.setdefault(i["dev"], {"id": i["dev"], "conns": [], "name": None})
    d["conns"].append(i["id"])
for root, (did, name) in sizes_m.DEVICE.items():
    if did in DEVS:
        DEVS[did]["name"] = name
for d in DEVS.values():
    first = ITEM[d["conns"][0]]
    d["name"] = d["name"] or first["what"]
    d["conns"].sort(key=natkey)
    subs = [WIRES[w["id"]].get("sub") for c in d["conns"] for w in ITEM[c]["w"] if w["id"] in WIRES]
    subs = [s for s in subs if s]
    d["sys"] = max(sorted(set(subs)), key=subs.count) if subs else None
    d["zone"] = first["zone"]
    m = first.get("media") or {}
    d["maker"], d["pn"] = m.get("maker"), m.get("maker_pn")
for name, rec in ((REG.get("capacity") or {}).get("resources") or {}).items():
    did = "61-PIN" if name.startswith("61-pin") else name.split(" ")[0]
    if did in DEVS:                              # outputs, inputs and cavities: used against what the device has
        DEVS[did].setdefault("capacity", []).append({"what": name, "cap": rec.get("capacity"), "used": rec.get("used"), "spare": rec.get("spare"),
                                                     "spare_ids": rec.get("spare_ids"), "src": rec.get("source")})
SYS = {}
for wid, w in WIRES.items():
    s = SYS.setdefault(w.get("sub") or "NONE", {"id": w.get("sub") or "NONE", "wires": [], "devs": []})
    s["wires"].append(wid)
for d in DEVS.values():
    SYS.setdefault(d["sys"] or "NONE", {"id": d["sys"] or "NONE", "wires": [], "devs": []})["devs"].append(d["id"])
for s in SYS.values():
    s["name"] = sizes_m.SUB_NAME.get(s["id"], "No subsystem in the registry" if s["id"] == "NONE" else s["id"].replace("_", " ").title())
    s["wires"].sort(key=natkey); s["devs"].sort(key=lambda x: DEVS[x]["name"].lower())
    s["active"] = sum(1 for x in s["wires"] if WIRES[x]["kind"] == "active")
    s["ft"] = round(sum(WIRES[x].get("len_ft") or 0 for x in s["wires"]), 1)
sys_list = sorted(SYS.values(), key=lambda s: (s["id"] == "NONE", -len(s["wires"])))

# ------------------------------------------------------------------ BOM: devices (priced per end), plug hardware and wire (registry)
DIFF = {str(x.get("item")): x for x in REG.get("diff") or []}


def fetched_of(p):
    """The fetch date a parts.yaml record's sources name, if any."""
    m = re.search(r"fetched (\d{4}-\d{2}-\d{2})", " ".join(str(x) for x in p.get("sources") or []))
    return m.group(1) if m else None


bom = []
groups = {}
for i in items:
    if i.get("drawn") == "piece" or i["id"] in LOOM:
        continue
    m = i.get("media") or {}
    pn = m.get("maker_pn") if m.get("maker_pn") not in (None, "", "unknown") else None
    g = groups.setdefault(norm(pn) if pn else "end:" + i["id"], {"pn": pn, "items": []})
    g["items"].append(i)
for key, g in groups.items():
    its = g["items"]
    i0 = its[0]
    m = i0.get("media") or {}
    price = best_price(i0)
    stats = sorted({i["buy"]["status"] for i in its})
    subs = [i["sys"] for i in its]
    bom.append({"g": "dev", "code": g["pn"] or "\u2014", "name": i0["what"] if len(its) == 1 else m.get("what") or i0["what"], "maker": m.get("maker"),
                "qty": len(its), "unit": "each", "price": price, "status": stats[0] if len(stats) == 1 else "mixed: " + ", ".join(stats),
                "paid": any((i.get("cost") or {}).get("paid") for i in its), "used": [i["id"] for i in its], "sys": max(set(subs), key=subs.count)})
for code, qty in sorted((REG.get("bom") or {}).get("parts", {}).items(), key=lambda kv: natkey(kv[0])):
    p = PARTS.get(code) or {}
    d = DIFF.get(code) or {}
    bom.append({"g": "hw", "code": code, "name": p.get("name"), "kind": p.get("kind"), "qty": qty, "unit": "each", "vendor": p.get("vendor"),
                "price": {"usd": p["price"], "unit": "each", "vendor": p.get("vendor"), "src": "parts.yaml (" + "; ".join(str(x) for x in (p.get("sources") or [])[:2]) + ")",
                          "date": fetched_of(p), "age": age_days(fetched_of(p))} if p.get("price") is not None else None, "cart": d.get("cart"), "status": d.get("status") or "not in the registry's cart check",
                "used": sorted(USED_BY.get(code, []), key=natkey)})
for item, ft in (REG.get("bom") or {}).get("wire_ft", {}).items():
    d = DIFF.get(item) or {}
    bom.append({"g": "wire", "code": item, "name": item, "qty": ft, "unit": "ft", "cart": d.get("cart_ft"),
                "status": d.get("status") or "not in the registry's cart check", "used": []})

# ------------------------------------------------------------------ open items: every question the records hold, with who acts
HANDS = re.compile(r"\basked 20\d\d|\bowner\b|\bSkylar\b|\byou\b|\bmeasure|\btape\b|\bphoto|\bread (?:it|the)\b.*\b(?:bench|truck|valve|head)|\bbuy\b|\bpurchase", re.I)


def who_of(t, default="System"):
    """Skylar acts where a record needs his money or hands; every engineering call is the system's."""
    return "Skylar" if HANDS.search(t) else default


def no_persona(t):
    """Drop the sentences that route a call through a person by name; the system makes engineering calls."""
    parts = re.split(r"(?<=[.;!?])\s+", t)
    kept = [x for x in parts if not re.search(r"\bDave(?:'s)?\b", x)]
    return " ".join(kept).strip()


OPEN = []
def add_open(kind, text, who, rel, src, st="open"):
    text = no_persona(text)
    if not text or re.fullmatch(r"[\w-]+:\s*", text):
        return
    who = "System" if who in ("pieces and harness-cad", "harness-cad", "parts-artist", "layout-ui and parts-artist", "unassigned") else who
    same = next((o for o in OPEN if o["text"] == text), None)
    if same:                                  # one question asked of several ends: one item, all its records
        same["rel"] += [r for r in rel if r not in same["rel"]]
        return
    OPEN.append({"id": "o%d" % (len(OPEN) + 1), "kind": kind, "text": text, "who": who, "rel": list(rel), "src": src, "st": st})


for d in sizes_m.DECISIONS:
    add_open("Needs you", d["title"] + ". " + d["text"], d["who"], d["rel"], sizes_m.DECISIONS_SRC)
    d["open"] = OPEN[-1]["id"]
TAPE_ITEMS = []
for t in TAPE.get("items") or []:
    res = t.get("result") or {}
    TAPE_ITEMS.append({"id": t.get("id"), "what": t.get("what"), "from_to": t.get("from_to"), "settles": t.get("settles"), "priority": t.get("priority"),
                       "tol": t.get("tolerance_mm"), "done": res.get("measured") is not None})
    if res.get("measured") is None and t.get("priority") == 1:
        rel = ["c:FIREWALL-CABIN", "c:FIREWALL-ENGINE"] if t["id"] in ("T-01", "T-02", "T-03", "T-04") else []
        add_open("Measurement", t["id"] + ": " + (t.get("what") or "") + ". Settles: " + (t.get("settles") or ""), "System", rel,
                 "docs/wiring/calc-data/cad/tape_list.yaml " + t["id"])
for b in boxes:
    for o in b.get("open") or []:
        add_open("Placement", b["id"] + ": " + o, who_of(o), ["c:" + n for n in (b.get("nodes") or []) if n in ITEM], "catalog/mounts.yaml box " + b["id"], b.get("status") or "open")
for i in items:
    for o in i.get("open") or []:
        add_open("End", o, who_of(o), ["c:" + i["id"]], "ends.py (pieces lane) " + i["id"])
    for o in (i.get("reg") or {}).get("open") or []:
        add_open("Registry", o, who_of(o), ["c:" + i["id"]], "k5_registry.json endpoints." + i["id"])
    for c in i.get("calls") or []:
        add_open("Placement", c["text"], "Skylar", ["c:" + i["id"]], c["source"])
if routes:
    for n in routes["nodes"]:
        e = ITEM.get(n.get("ep") or "")
        if not e or n.get("gap_mm") is None:
            continue
        m = e["margin"] if e["margin"].get("mm") is not None else (ITEM.get(e.get("grouped") or "", {}).get("margin") or e["margin"])
        lim = max(50, m.get("mm") or 0)
        if n["gap_mm"] > lim:
            n["off"] = True
            add_open("Route landing", "%s: harness-cad lands the route %d mm from %s's spot in pos.py; its margin is ±%d mm. One of the two moves."
                     % (n["id"], n["gap_mm"], e["id"], lim), "pieces and harness-cad", ["c:" + e["id"], "n:" + n["id"]], "routes.json and pos.py")
    for s in routes["segments"]:
        if s.get("checks_failed"):
            add_open("Route check", "%s: %d of %d rule checks not passed." % (s["id"], s["checks_failed"], len(s.get("checks") or [])), "harness-cad",
                     ["s:" + s["id"]], "routes.json " + s["id"])
for text, rel in sizes_m.BAY_FINDINGS:
    add_open("Finding", text, who_of(text, "harness-cad"), rel, sizes_m.BAY_SRC)
for i in items:
    if not i.get("drawn") and i.get("why_not") == "size":
        add_open("Coverage", i["id"] + " is not drawn to size: " + (i.get("why_not_text") or "size not read"), "layout-ui and parts-artist",
                 ["c:" + i["id"]], "sizes.py TODO (layout-ui)")
# ------------------------------------------------------------------ library: every part in the part-model index, turned in 3D with its pins
LIB = []
os.makedirs(os.path.join(SITE, "lib"), exist_ok=True)
KIND_WORD = {"assembly": "End assembly", "piece": "Housing or piece", "device": "Device"}
what_of = lambda v: v.get("what") if isinstance(v, dict) else (v if isinstance(v, str) else None)
for pid, pm in PMI["parts"].items():
    gpath = sample_file(pid, ".glb")
    if not gpath:
        continue
    d = gpath[:-4]
    raw = open(gpath, "rb").read()
    bad = [x for x in (b"blendermcp", b"api_key", b"apikey", b"sketchfab") if x in raw.lower()]
    if bad:
        print("REFUSED: library GLB", pid, "carries", bad)
        continue
    js = os.path.join(SITE, "lib", pid + ".js")
    if not os.path.exists(js) or os.path.getmtime(js) < os.path.getmtime(gpath):
        open(js, "w").write("window.K5_LIB=window.K5_LIB||{};window.K5_LIB[%s]=\"%s\";\n" % (json.dumps(pid), base64.b64encode(raw).decode()))
    pj = json.load(open(d + ".pins.json")) if os.path.exists(d + ".pins.json") else {"cavities": []}
    prm = json.load(open(d + ".params.json")) if os.path.exists(d + ".params.json") else {}
    cur = PL_BY.get(pid, {})
    imgs = []
    for kind, w, cap in (("drawing", 1800, "Dimensioned drawing. Blue is printed by the maker, orange is scaled off the print, purple is sized from a photo, red is assumed."),
                         ("pinout", 1400, "Pinout, wire side, with this build's wires."),
                         ("vs_photo", 1400, "The model beside the maker's product photo. The maker's label artwork is left off on purpose."),
                         ("clearance_800", 800, "The mated plugs and backshells, with the plug-and-boot keep-out in orange.")):
        src = d + "_" + kind + ".png"
        if kind.startswith("clearance") and not prm.get("keepout"):
            continue                                   # only the parts with a plug keep-out have a clearance study
        if os.path.exists(src):
            name = "lib/%s_%s.jpg" % (pid.lower(), kind.split("_8")[0])
            out = os.path.join(SITE, name)
            if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
                im = Image.open(src).convert("RGB")
                if im.size[0] > w:
                    im = im.resize((w, int(im.size[1] * w / im.size[0])), Image.LANCZOS)
                im.save(out, quality=84, optimize=True)
            imgs.append({"src": name, "cap": cap, "kind": kind.split("_8")[0]})
    cav = []
    for c in pj.get("cavities", []):
        full = re.sub(r"^(Hi|Lo)\s+", "", re.sub(r"\s{2,}.*$", "", (c.get("full_name") or "").strip()))
        cav.append({"pin": c["pin"], "maker": c.get("maker_pin"), "ep": c.get("endpoint"), "name": c.get("name"), "full": full, "at": c.get("wire_side_glb_m"),
                    "w": [x.get("id") for x in c.get("wires") or [] if x.get("id")]})
    checks = [{"what": c.get("check"), "model": c.get("model"), "drawing": c.get("drawing"), "tol": c.get("tol"), "ok": c.get("ok")} for c in prm.get("checks") or []]
    dims = pm.get("dims_mm") or prm.get("dims_mm") or {}
    kind = pm.get("kind") or "device"
    LIB.append({"key": pid, "id": pid, "tab": cur.get("tab") or pid, "title": cur.get("title") or pm.get("what") or prm.get("what") or pid,
                "pn": cur.get("pn") or " ".join(x for x in (pm.get("maker"), pm.get("maker_pn")) if x), "mount": cur.get("mount") or "none",
                "facts": cur.get("facts") or [], "open": (cur.get("open") or []) + ["Not modelled yet: " + m for m in pm.get("missing") or []],
                "js": "lib/%s.js" % pid, "bytes": len(raw), "made": datetime.datetime.fromtimestamp(os.path.getmtime(gpath)).strftime("%Y-%m-%d %H:%M"),
                "pins": cav, "orient": pj.get("orientation_unknown"), "checks": checks, "unknowns": prm.get("unknowns") or [],
                "dims": prm.get("dims_note") or (" x ".join("%g" % dims[k] for k in ("l", "w", "h") if dims.get(k)) + " mm" if dims else ""),
                "basis": pm.get("shape_basis") or prm.get("shape_basis"), "maker": pm.get("maker") or prm.get("maker"), "maker_pn": pm.get("maker_pn") or prm.get("maker_pn"),
                "ends": pm.get("endpoints") or [], "images": imgs, "mated": what_of(prm.get("mated")), "keepout": what_of(prm.get("keepout")),
                "kind": kind, "kind_word": KIND_WORD.get(kind, kind), "family": pm.get("family"), "missing": pm.get("missing") or [],
                "color": ((pm.get("colors") or {}).get("housing") or (pm.get("colors") or {}).get("case") or {}).get("hex")})
    for u in prm.get("unknowns") or []:
        add_open("Part model", pid + ": " + u, "System", ["c:" + e for e in (pm.get("endpoints") or []) if e in ITEM], "parts/samples/%s/%s.params.json" % (os.path.basename(os.path.dirname(gpath)), pid))
LIB.sort(key=lambda L: ({"device": 0, "assembly": 1, "piece": 2}.get(L["kind"], 3), natkey(L["id"])))
# an end's own model: its assembly, or the device part that carries it; pieces are parts of an assembly
LIB_OF, LIB_OF_KIND = {}, {}
for L in LIB:
    for e in L["ends"]:
        if L["kind"] != "piece" or e not in LIB_OF:
            if e not in LIB_OF or LIB_OF_KIND.get(e) == "piece":
                LIB_OF[e] = L["key"]; LIB_OF_KIND[e] = L["kind"]

for i in items:
    if i["id"] in LIB_OF:
        i["lib"] = LIB_OF[i["id"]]
    i["m3d"] = MODELLED.get(i["id"], [])          # modelled = a part in the part-model index carries this end (owner: no 3D, not complete)
    _pe = (PMI.get("ends") or {}).get(i["id"]) or {}
    i["m3d_done"] = bool(_pe.get("complete"))     # complete = the index says nothing is missing on this end
    i["m3d_missing"] = _pe.get("missing") or []
for d in DEVS.values():
    d["lib"] = next((LIB_OF[c] for c in d["conns"] if c in LIB_OF), None)
OPEN_BY = {}
for o in OPEN:
    for r in o["rel"]:
        OPEN_BY.setdefault(r, []).append(o["id"])

# ------------------------------------------------------------------ service data for the manual: PDM outputs, splices, crimp tools (no prices, no buying notes)
PDM_OUT = [{"output": x.get("output"), "loads": x.get("loads") or [], "load_a": x.get("load_a"), "wire_a": x.get("wire_cap_a"), "limit_a": x.get("limit_a"),
            "status": re.split(r"\s*[(;:]", str(x.get("status") or ""), maxsplit=1)[0].strip() or None, "src": x.get("source")}
           for x in REG.get("pdm_settings") or []]
SPLICES = [{"at": x.get("at"), "wires": x.get("wires") or [], "pn": x.get("splice"), "awg": x.get("equiv_awg"), "type": x.get("type")} for x in REG.get("splices") or []]
TOOL_WORD = {"picked": "picked", "to_buy": "not on hand", "alt": "alternative"}
TOOLS = [{"id": x.get("id"), "name": x.get("name"), "pn": x.get("pn"), "families": x.get("families") or [], "status": TOOL_WORD.get(x.get("status"), x.get("status"))}
         for x in REG.get("tools") or []]
for i in items:
    i["families"] = sorted({t.get("family") for t in REG["terminations"] if t["endpoint"] == i["id"] and t.get("family")})

# ------------------------------------------------------------------ data on this vehicle: what the database holds for it, and what came in lately
VID = "e08bf694-970f-4cbe-8a74-8715158a0f2e"


def dbq(sql):
    """Read-only, through the repo's own query script (scripts/data/q.sh); None when the database can't be reached."""
    try:
        r = subprocess.run([os.path.join(REPO, "scripts", "data", "q.sh"), sql], capture_output=True, text=True, timeout=120)
        out = json.loads(r.stdout)
        return out if isinstance(out, list) else None
    except Exception:
        return None


LA = "(now() at time zone 'America/Los_Angeles')::date"
def cnt(table, ts, where):
    return (f"select '{table}' t, count(*) n, count(*) filter (where ({ts} at time zone 'America/Los_Angeles')::date = {LA}) today, "
            f"count(*) filter (where {ts} > now() - interval '7 days') week, max({ts}) last from {table} where {where}")
DESIGN_W = f"design_id in (select id from harness_designs where vehicle_id='{VID}') and is_superseded=false and code is not null"
OVER_W = f"overlay_id in (select id from vehicle_wiring_overlays where vehicle_id='{VID}') and is_superseded=false"
rows = dbq(" union all ".join([
    cnt("vehicle_images", "created_at", f"vehicle_id='{VID}'"), cnt("vehicle_observations", "ingested_at", f"vehicle_id='{VID}'"),
    cnt("timeline_events", "created_at", f"vehicle_id='{VID}'"), cnt("vehicle_documents", "created_at", f"vehicle_id='{VID}'"),
    cnt("field_evidence", "created_at", f"vehicle_id='{VID}'"), cnt("work_orders", "created_at", f"vehicle_id='{VID}'"),
    cnt("harness_endpoints", "created_at", DESIGN_W), cnt("vehicle_custom_circuits", "created_at", OVER_W),
    cnt("wire_termination_specs", "created_at", f"vehicle_id='{VID}' and is_superseded=false and circuit_id is not null"),
    cnt("wiring_decisions", "created_at", f"vehicle_id='{VID}' and is_superseded=false and decision_kind is not null")]))
obs = dbq(f"select kind, count(*) n, count(*) filter (where ingested_at > now() - interval '7 days') week, "
          f"count(*) filter (where (ingested_at at time zone 'America/Los_Angeles')::date = {LA}) today from vehicle_observations "
          f"where vehicle_id='{VID}' group by 1 order by 2 desc")
DB_WORD = {"vehicle_images": "Photos", "vehicle_observations": "Observations", "timeline_events": "Timeline events", "vehicle_documents": "Documents",
           "field_evidence": "Field evidence", "work_orders": "Work orders", "harness_endpoints": "Wiring ends (map rows)",
           "vehicle_custom_circuits": "Wires (map rows)", "wire_termination_specs": "Wire ends terminated (map rows)", "wiring_decisions": "Wiring calls"}
git_date = lambda path: subprocess.run(["git", "-C", REPO, "log", "-1", "--format=%cs", "origin/main", "--", path], capture_output=True, text=True).stdout.strip() or None
VEHICLE_DATA = None
if rows:
    VEHICLE_DATA = {"as_of": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "tz": "Las Vegas time",
                    "db": [{"kind": DB_WORD.get(r["t"], r["t"]), "table": r["t"], "n": r["n"], "today": r["today"], "week": r["week"], "last": (r["last"] or "")[:10]} for r in rows],
                    "obs": [{"kind": o["kind"], "n": o["n"], "week": o["week"], "today": o["today"]} for o in (obs or [])],
                    "design": [
                        {"kind": "Parts modelled in 3D", "n": len(PMI["parts"]), "updated": PMI.get("generated"), "src": PMI_SRC},
                        {"kind": "Route segments", "n": len((routes or {}).get("segments", [])), "updated": stamp.get("routes.json", "")[:10], "src": "routes.json (harness-cad)"},
                        {"kind": "End positions", "n": len(items), "updated": stamp.get("pos.py", "")[:10], "src": "pos.py (pieces lane)"},
                        {"kind": "Wires in the registry", "n": len(WIRES), "updated": git_date("docs/wiring/calc-data/k5_registry.json"), "src": "k5_registry.json (main)"}]}
    VEHICLE_DATA["total"] = sum(r["n"] for r in VEHICLE_DATA["db"] if not r["table"].startswith(("harness_", "vehicle_custom", "wire_term", "wiring_")))

# 3D coverage by basis: each end counts once, at the WEAKEST shape basis among its models (a chain is as strong as its weakest
# record). The part-model index writes this itself (ends_by_shape_basis, index_v5); computed here the same way only if it is absent.
BASIS_ORDER = ["maker drawing", "datasheet dims", "scaled from photo", "twin object", "not sourced"]
PM_ENDS = PMI.get("ends") or {}
def weakest_basis(ep):
    bs = [(PMI["parts"].get(pid) or {}).get("shape_basis") for pid in MODELLED.get(ep, [])]
    bs = [b for b in bs if b in BASIS_ORDER]
    return max(bs, key=BASIS_ORDER.index) if bs else None
if PMI.get("ends_by_shape_basis"):
    m3d_basis = {b: int(PMI["ends_by_shape_basis"].get(b, 0)) for b in BASIS_ORDER}
else:
    m3d_basis = {b: 0 for b in BASIS_ORDER}
    for i in items:
        b = weakest_basis(i["id"]) if i["m3d"] else None
        if b:
            m3d_basis[b] += 1
cov = {"ends": len(items), "drawn": sum(1 for i in items if i.get("drawn")), "cad": len(LIB), "m3d": sum(1 for i in items if i["m3d"]),
       "m3d_complete": sum(1 for i in items if (PM_ENDS.get(i["id"]) or {}).get("complete")), "m3d_basis": m3d_basis,
       "pm_src": PMI_SRC, "pm_parts": len(PMI["parts"]), "segs": len((routes or {}).get("segments", [])),
       "wires": len(WIRES), "routed": sum(1 for w in WIRES.values() if w.get("segs")), "off": sum(1 for n in (routes or {}).get("nodes", []) if n.get("off")),
       "open": len(OPEN), "decisions": len(sizes_m.DECISIONS)}
print("workspace: %d systems, %d devices, %d pins on %d connectors, %d wires (%d routed), %d BOM lines, %d open items, %d library parts"
      % (len(SYS), len(DEVS), sum(len(v) for v in PINS.values()), len(PINS), len(WIRES), cov["routed"], len(bom), len(OPEN), len(LIB)))

data = {
    "built": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "main": main_head, "stamp": stamp,
    "views": VIEWS, "items": items, "wires": WIRES, "context": ctx, "routes": routes, "boxes": boxes, "glb": glb,
    "counts": {"ends": len(items), "drawn": drawn}, "body_margin": BODY_MARGIN, "roll": roll, "carts": carts,
    "sys": sys_list, "devs": DEVS, "pins": PINS, "bom": bom, "open": OPEN, "open_by": OPEN_BY, "tape": TAPE_ITEMS, "lib": LIB, "cov": cov,
    "dec": sizes_m.DECISIONS, "dec_src": sizes_m.DECISIONS_SRC, "renders": RENDERS, "vdata": VEHICLE_DATA, "fw_plan": sizes_m.FIREWALL_PLAN, "pdm_out": PDM_OUT, "splices": SPLICES, "tools": TOOLS, "bay": {"stats": sizes_m.BAY_STATS, "src": sizes_m.BAY_SRC},
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
MARKET_ORDER = re.compile(r"(\border\b[^;.)]{0,40}?\b(?:eBay|Amazon)\s+(?:item\s+)?)(\d{9,14})", re.I)   # the listing he bought from, named beside an order
ORDER_NO = re.compile(r"(\b(?:order|invoice|receipt|confirmation)\s*(?:no\.?|number|num)?\s*[:#]?\s*)((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,})", re.I)


def mask(o, money=True):
    """Prices and order numbers stay in the records; the page masks them ($•••, order •••), per the owner's masking rule."""
    if isinstance(o, str):
        if o.startswith("data:"):
            return o
        o = ORDER_NO.sub(lambda m: m.group(1) + "\u2022\u2022\u2022", o)
        o = MARKET_ORDER.sub(lambda m: m.group(1) + "\u2022\u2022\u2022", o)
        o = re.sub(r"(?i)((?:ebay|amazon)\.com/(?:itm|dp)/)[\w-]{6,}", lambda m: m.group(1) + "\u2022\u2022\u2022", o)   # listing links point at his purchases
        o = re.sub(r"(?i)\b((?:eBay|Amazon) (?:item|listing)\s*#?\s*)\d{6,}", lambda m: m.group(1) + "\u2022\u2022\u2022", o)
        return MONEY.sub("$\u2022\u2022\u2022", o) if money else o
    if isinstance(o, list):
        return [mask(v) for v in o]
    if isinstance(o, dict):
        return {k: mask(v) for k, v in o.items()}
    return o


KEEP_PRICES = {"cost", "roll", "carts", "price"}


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

# ------------------------------------------------------------------ the MAP tab's public files on nuke.ag: --export-site <nuke_frontend dir>
# Public, so: no prices, no order or listing ids, no people's names; free text goes through mask(). GLBs under 10 MB each,
# scene extras stripped, then scanned. TODO: positions move into harness_endpoints in the next registry pass.
if "--export-site" in ARGS:
    import struct
    FE = ARGS[ARGS.index("--export-site") + 1]
    today = datetime.date.today().isoformat()

    def eff_mm(i):
        m = i.get("margin") or {}
        if m.get("mm") is None and i.get("grouped") in ITEM:
            m = ITEM[i["grouped"]].get("margin") or {}
        return m.get("mm")

    ends_out = {}
    for i in items:
        e = {"xyz": [round(v, 3) for v in i["xyz"]], "basis": mask(re.sub(r",?\s*ruled by \w+ \d{4}-\d{2}-\d{2}", "", i["basis"].split(" (")[0])), "margin_mm": eff_mm(i),
             "dev": i["dev"], "dev_name": mask(DEVS[i["dev"]]["name"])}
        if i.get("drawn") == "own" and i.get("fp"):
            e["size"] = {k: i["fp"].get(k) for k in ("shape", "dx", "dy", "dz", "d", "t", "axis") if i["fp"].get(k) is not None}
            if i["fp"].get("top"):
                e["color"] = i["fp"]["top"]
        elif i.get("drawn") == "piece":
            e["on"] = i["piece_of"]
        face = {p["c"]: p["xy"] for p in PINS.get(i["id"], []) if p.get("xy")}
        if face:
            e["face"] = face
        ends_out[i["id"]] = e
    json.dump({"vehicle_id": VID, "generated": today, "frame": "twin metres: +x driver, -y forward, +z up",
               "source": "ends.py and pos.py (%s), footprints and part models" % stamp.get("pos.py", ""),
               "ends": ends_out}, open(os.path.join(FE, "public", "wiring", "k5-positions.json"), "w"), separators=(",", ":"))

    def rdp3(pts, eps=0.004):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        ab = [b[k] - a[k] for k in range(3)]
        L2 = sum(v * v for v in ab) or 1e-12
        def dist(p):
            ap = [p[k] - a[k] for k in range(3)]
            t = max(0.0, min(1.0, sum(ap[k] * ab[k] for k in range(3)) / L2))
            return math.dist(p, [a[k] + t * ab[k] for k in range(3)])
        d = [dist(p) for p in pts[1:-1]]
        ix = max(range(len(d)), key=d.__getitem__)
        if d[ix] > eps:
            return rdp3(pts[:ix + 2], eps)[:-1] + rdp3(pts[ix + 1:], eps)
        return [a, b]

    def cov_of(t):   # the covering's name, and whether its size is an estimate; the working notes stay in routes.json
        t = str(t or "")
        base = re.split(r"\s*[;(]", t)[0].strip()
        return (mask(base) + (" (estimated)" if "estimate" in t.lower() else "")) if base else None

    if routes_src:
        RR = json.load(open(os.path.join(IN, "routes.json")))
        node_ep = {n["id"]: n.get("ep") for n in RR.get("nodes", [])}
        clips = {}
        for c in RR.get("clips", []):
            clips[c.get("segment")] = clips.get(c.get("segment"), 0) + 1
        segs_out = [{"id": s["id"], "b": s.get("bundle"), "od": s.get("od_mm"), "par": s.get("parallel") or 1, "len": s.get("length_m"),
                     "mar": s.get("margin_mm"), "cov": cov_of(s.get("covering")),
                     "f": node_ep.get(s.get("from_node")) or s.get("from_node"), "t": node_ep.get(s.get("to_node")) or s.get("to_node"),
                     "w": s.get("wires") or [], "clips": clips.get(s["id"], 0),
                     "pts": [[round(v, 3) for v in p] for p in rdp3(s["points"])]} for s in RR.get("segments", [])]
        json.dump({"vehicle_id": VID, "generated": today, "frame": "twin metres: +x driver, -y forward, +z up", "source": "harness-cad routes.json (%s)" % stamp.get("routes.json", ""),
                   "segments": segs_out}, open(os.path.join(FE, "public", "wiring", "k5-routes.json"), "w"), separators=(",", ":"))

    KEEP_EXTRAS = {"id", "endpoint", "route", "members", "od_mm"}   # model/status are working notes, not results
    for zone in ("bay", "cab", "rear"):
        src = os.path.expanduser("~/k5-harness-pull/glb/v4/k5_harness_v4_%s.glb" % zone)
        raw = open(src, "rb").read()
        magic, ver, _ = struct.unpack("<III", raw[:12])
        jlen, jtype = struct.unpack("<II", raw[12:20])
        js = json.loads(raw[20:20 + jlen])
        tail = raw[20 + jlen:]
        js.pop("extras", None)
        (js.get("asset") or {}).pop("extras", None)
        for key in ("scenes", "materials", "meshes", "textures", "images", "cameras"):
            for obj in js.get(key) or []:
                obj.pop("extras", None)
        for n in js.get("nodes") or []:
            ex = n.get("extras")
            if isinstance(ex, dict):
                ex = {k: v for k, v in ex.items() if k in KEEP_EXTRAS}
                if ex:
                    n["extras"] = ex
                else:
                    n.pop("extras", None)
        jb = json.dumps(js, separators=(",", ":")).encode()
        jb += b" " * ((4 - len(jb) % 4) % 4)
        out = struct.pack("<III", magic, ver, 20 + len(jb) + len(tail)) + struct.pack("<II", len(jb), jtype) + jb + tail
        bad = [x for x in (b"blendermcp", b"api_key", b"apikey", b"sketchfab") if x in out.lower()]
        assert not bad, ("refused: %s carries %s" % (zone, bad))
        assert len(out) <= 10_000_000, ("refused: %s is %d bytes" % (zone, len(out)))
        open(os.path.join(FE, "public", "models", "k5-harness-v4-%s.glb" % zone), "wb").write(out)
        print("export: %s GLB %.1f MB, %d nodes, scanned clean" % (zone, len(out) / 1e6, len(js.get("nodes") or [])))
    print("export: k5-positions.json %d ends, k5-routes.json %d segments" % (len(ends_out), len(segs_out) if routes_src else 0))
