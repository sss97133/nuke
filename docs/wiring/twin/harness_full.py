#!/usr/bin/env python3
"""K5 harness in CAD (v4), whole truck: every physical end placed, every registry wire routed over the channel graph
(harness_graph.py), each channel edge sized from the wires in it, clamps spaced, rule checks run, parts audited
against the twin (body interference, exhaust clearance, overlaps).

    python3 docs/wiring/twin/harness_full.py --mesh-dir <export_twin_meshes.py output>

Writes, in docs/wiring/calc-data/cad/: scene_v4.json (Blender input), routes.json (layout page: segments, nodes,
clips), routes.yaml (per-loom audit), parts.yaml (per-part audit). Builds on harness_cad.py (the engine bay sample:
the engine loom tree and the DC primary cables are reused as they were reviewed, extended to the cab and the rear).
Every route is a PROPOSAL for the owner and the builder to confirm (.claude/rules/wiring-receipt.md). Every number
carries its source or says it is not sourced.
"""
import argparse, json, math, os, subprocess, sys
from collections import defaultdict, Counter
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness_cad as H            # noqa: E402
import harness_graph as G          # noqa: E402

REPO, CAD, MM, IN, S = H.REPO, H.CAD, H.MM, H.IN, H.S
POS = json.load(open(CAD / "positions_v3.json"))
MOUNTS = yaml.safe_load(open(REPO / "docs/wiring/calc-data/catalog/mounts.yaml"))
ENDS = {e["id"]: e for e in MOUNTS["ends"]}
COLORS = (json.load(open(CAD / "part_colors.json")) if (CAD / "part_colors.json").exists() else {"parts": {}})["parts"]
PARTS_DIR = Path(os.path.expanduser("~/k5-harness-pull/parts/samples"))
SNAP = "reference_documents/web_snapshots/"
y_fw = H.y_fw


def part_params(eid):
    """The parts lane's record for a part: part_models.yaml (repo, else branch wiring/part-art), else the sample's params.json."""
    for src in (REPO / "docs/wiring/calc-data/catalog/part_models.yaml",):
        if src.exists():
            for p in yaml.safe_load(open(src)).get("parts", []):
                if p["id"] == eid:
                    return p, str(src.relative_to(REPO))
    for p in PM_BRANCH:
        if p["id"] == eid:
            return p, "docs/wiring/calc-data/catalog/part_models.yaml (branch wiring/part-art)"
    for f in PARTS_DIR.glob(f"*/{eid}.params.json"):
        return json.load(open(f)), f"parts lane sample {eid}.params.json (not yet in part_models.yaml)"
    return None, None


try:
    PM_BRANCH = yaml.safe_load(subprocess.run(["git", "-C", str(REPO), "show", "origin/wiring/part-art:docs/wiring/calc-data/catalog/part_models.yaml"],
                                              capture_output=True, text=True, check=True).stdout).get("parts", [])
except Exception:
    PM_BRANCH = []


def glb_path(eid):
    for p in PARTS_DIR.glob(f"*/{eid}.glb"):
        return str(p)
    return None


# ------------------------------------------------------------------ placements of the parts lane's models
# Local frame: origin at the mounting-face centre, +Z out of the mounting face. rot = world images of local X, Y, Z.
ROT_FW_CAB = ((-1, 0, 0), (0, 0, 1), (0, 1, 0))       # MoTeC case flat on the firewall's cab face, plugs down
ROT_BATT_P = ((0, 1, 0), (-1, 0, 0), (0, 0, 1))       # passenger battery: side terminals inboard (+x), + post forward
ROT_BATT_D = ((0, -1, 0), (1, 0, 0), (0, 0, 1))       # driver battery: side terminals inboard (-x), so + post at the rear
ROT_WALL_D = ((0, -1, 0), (0, 0, 1), (-1, 0, 0))      # base on the driver inner-fender wall, terminals down
GLB_PLACE = {
    "M130-A": dict(origin=(0.655, -1.452, 1.040), rot=ROT_FW_CAB,
                   why="PROPOSED: the firewall's cab face just outboard of the 61-pin plate, plugs down, 9 mm off the face. The twin leaves "
                       "only 130 mm of vertical firewall between the toe board (z 0.90) and the dash's modelled lower panel (z 1.03), so the "
                       "case rises behind the dash (the twin's panel is a closure, not structure: tape T-04). Assumes the 90-degree boots "
                       "(HELD in part_models.yaml) so the wires turn at the plugs; a straight boot needs 60-80 mm under them. The parking-brake "
                       "pedal sits outboard on the real truck: its keep-out is not modelled"),
    "PDM30-A": dict(origin=(0.085, -1.372, 1.010), rot=ROT_FW_CAB,
                    why="PROPOSED: its own plate on the tunnel bulge of the firewall (the cab face runs y -1.378..-1.405 across the case, so "
                        "the plate bridges it), open air round the case (MoTeC), ~0.5 m from the M130. Same 90-degree-boot assumption; the "
                        "case top rises 43 mm behind the twin's dash panel (T-04)"),
    "ODYSSEY": dict(origin=(-0.600, -2.300, 1.010), rot=ROT_BATT_P,
                    why="PROPOSED: GM's right battery tray spot (1977 LTSM p.122), long side fore-aft, side terminals and posts inboard, + forward; "
                        "tray height not published (base drawn at z 1.01)"),
    "ACC-BATT": dict(origin=(0.600, -2.300, 1.010), rot=ROT_BATT_D,
                     why="PROPOSED: GM's auxiliary left battery spot (1977 LTSM p.122), long side fore-aft, posts inboard; with the YellowTop's "
                         "layout that puts + at the rear; base drawn at z 1.01"),
    "DCDC": dict(origin=(0.510, -2.000, 0.955), rot=ROT_WALL_D,
                 why="PROPOSED: base on the engine side of the driver inner-fender wall (twin wall x 0.513, z 0.77..1.04), behind the "
                     "YellowTop, terminals down; positions_v3 (0.66, -2.0, 1.06) was inside the fender well"),
}

OVERRIDE = {
    "CLT-ECU": ([0.182, -1.994, 0.965], "Swap Specialties p.6: front of the driver head. The twin anchor (0.286, -1.869, 0.84) sat inside the #1 header flange; moved onto the head's front face (twin E3_Head_L front y -1.992)"),
    "FUELP": ([0.000, -2.052, 0.983], "fuel-system lane 2026-09-30 (docs/wiring/research/2026-09-30_fuel-system-and-regulator.md s7, PR #423): AEM 30-2131-100 in the Aeromotive 13139's 1/8 NPT gauge port on its front face; plug face at (0.000, -2.052, 0.983), wires leave -y"),
    "OILT": ([-0.170, -1.670, 0.622], "pieces lane 2026-09-29: GM oil level and temperature sensor in the pan, passenger side, behind and below knock 2, +-50 mm (vehicle_images 9365b1d0)"),
    "DAK-OILP": ([0.075, -1.480, 0.990], "positions_v3 put it 10 mm behind the twin firewall face; kept at the tee's height on the engine side"),
    "COIL-GROUND-RINGS": ([0.150, -1.468, 1.000], "back of the driver head beside the coil cluster (mounts.yaml: back of the cylinder heads, one bolt on each)"),
    "WIPER-MOTOR": ([0.000, -1.470, 1.220], "factory wiper hole on the cowl, engine side (mounts.yaml); z lowered from 1.30 to below the twin cowl skin (z 1.25)"),
    "WASHER-PUMP": ([0.030, -1.482, 1.200], "pieces lane 2026-09-29 / 1977 LTSM p.803 Fig. 8-16: the factory pump rides on the wiper motor"),
    "FAN": ([0.000, -2.300, 0.955], "the fan motor hub on the engine side of the radiator core (mounts.yaml FAN)"),
    "GND-BANK-CAB": ([-0.075, -1.362, 0.985], "PROPOSED: beside the PDM30 on the tunnel bulge of the firewall, passenger side of it (mounts.yaml: beside the PDM30); keeps the 2 AWG return short to H3 and clear of the pedals"),
    "AMP-BLOCK": ([0.740, 1.400, 1.140], "PROPOSED: on the driver side panel behind the amp's rear end (mounts.yaml: beside the amp); positions_v3 put it inside the amp's case"),
    "AMP-PASS": ([0.550, 1.300, 0.850], "rear floor near the amplifier (mounts.yaml); on the twin's cargo floor, z 0.845"),
    "GND-SPLICE-REAR": ([0.600, 1.500, 0.880], "inside the rear body (mounts.yaml); positions_v3 had it under the floor"),
    "FIREWALL-BODY-C": ([0.180, -0.620, 0.680], "floor by the transfer case (mounts.yaml, hole set at the mock-up)"),
    "FUEL-PUMP": ([0.100, 1.300, 0.830], "pieces lane 2026-09-29: pump hanger on the tank top, tank centre (-0.03, 1.33, 0.67), 840 x 750 x 320 mm"),
    "FUEL-LEVEL": ([0.050, 1.300, 0.830], "on the hanger (mounts.yaml), tank per the pieces lane"),
    "SPL-FUEL-SND": ([0.150, 1.300, 0.840], "above the tank lid (mounts.yaml)"),
    "AC-HP-SW": ([-0.620, -2.080, 1.050], "candidate spot (not decided): on the liquid line (not plumbed), on the passenger inner-fender shelf behind the Odyssey; positions_v3 put it inside the Odyssey"),
    "PORT-ETH": ([-0.500, -1.060, 1.080], "glovebox (mounts.yaml), inside the dash (twin Dash_Main)"),
    "PORT-UTC": ([-0.560, -1.060, 1.080], "glovebox (mounts.yaml), inside the dash (twin Dash_Main)"),
}
REAR_CONN = {"id": "REAR-CONN", "xyz": list(G.N["RC"]), "why": "mounts.yaml box REAR-CONN (open): 'rear floor, driver side, so the body comes off the frame with one unplug'; the task's rear loom ends here before the frame rail"}
FUSE_BATT = [-0.455, -2.200, 1.150]   # the three battery-corner inline fuses (mounts.yaml: at the battery end of their feeds)

# ------------------------------------------------------------------ sourced stand-ins (mm)
SIZES = {
    "WIDEBAND": ("box", (26, 38, 14), "MoTeC LTCD: 38 x 26 x 14 mm without looms (LTCD user manual p.31)", "#2a2b2c", "MoTeC product photo"),
    "AMP": ("box", (54, 249, 171), "JL Audio VX700/5i: 9-13/16 x 2-1/8 x 6-3/4 in (" + SNAP + "www.crutchfield.com__JL-Audio-VX700-5i.md), upright on the side panel", "#858991", "Crutchfield product photo"),
    "SUB": ("disc_x", (254, 83), "JBL Club 102SL: 10 in nominal, 3.25 in mounting depth (" + SNAP + "www.crutchfield.com__JBL-Club-102SL.md); the enclosure is not designed", "#353337", "Crutchfield product photo"),
    "SUB-2": ("disc_x", (254, 83), "JBL Club 102SL (as SUB)", "#353337", "Crutchfield product photo"),
    "SPK-FL": ("disc_x", (165, 65), "JL Audio C2-650X: 6.5 in, 2-9/16 in mounting depth (" + SNAP + "www.crutchfield.com__JL-Audio-C2-650X.md)", "#2c2c2c", "Crutchfield product photo"),
    "SPK-FR": ("disc_x", (165, 65), "as SPK-FL", "#2c2c2c", "Crutchfield product photo"),
    "SPK-RL": ("disc_x", (165, 65), "as SPK-FL", "#2c2c2c", "Crutchfield product photo"),
    "SPK-RR": ("disc_x", (165, 65), "as SPK-FL", "#2c2c2c", "Crutchfield product photo"),
    "FAN": ("disc_y", (406, 79), "SPAL 30107090: 16 in fan, 3.10 in thick (" + SNAP + "www.kartek.com__spal-30107090-plus-series-16-brushless-puller-fan-300w-2053-peak-cfm-drop-in-mount-sits-in-shroud.md)", "#212223", "Wizard Cooling photo of a sibling fan"),
    "MIRROR-MON": ("box", (268, 25, 80), "Rear View Safety mirror monitor 10.55 x 3.15 x 1 in (" + SNAP + "www.rearviewsafety.com__license-plate-backup-camera-system-rvs-7180355-ir.md)", "#42413f", "Rear View Safety photo"),
    "Backup_Camera": ("box", (190, 25, 25), "Rear View Safety camera 1 x 7.5 x 1 in (same snapshot)", "#252729", "Rear View Safety photo"),
    "CARGO-LAMP": ("box", (51, 330, 27), "Truck-Lite 80251C '2 x 13 in rectangular', 1.08 in deep (" + SNAP + "www.truck-lite.com__80251c-1.md); the top-design lane reads 462 x 146 x 27.4 overall: unreconciled", "#b9c2c5", "Truck-Lite photo"),
    "CHMSL": ("box", (178, 25, 25), "ORACLE 4514-003 7 in long (registry text); height and depth not read", "#893532", "ORACLE photo (red lens)"),
    "HEADLIGHT-L": ("disc_y", (178, 80), "Truck-Lite 27270C 7 in round (" + SNAP + "a1truckparts.net__truck-lite-27270c-clear-7-round-high-low-beam-headlight-hardwired-h4-connectors.md); depth not read, drawn 80", "#403d3c", "Truck-Lite photo"),
    "HEADLIGHT-R": ("disc_y", (178, 80), "as HEADLIGHT-L", "#403d3c", "Truck-Lite photo"),
}
TWIN_OBJ = {  # ends the twin already models: drawn opaque in the part colour at the twin object
    "TB": (["E3_ThrottleBody_12699160", "E3_TB_MotorHousing", "E3_TB_Bore"], "#cbc5b4", "GM catalogue photo of 12699160"),
    "ALTERNATOR-SENSE": (["E3_Alternator_197-302", "E3_Alternator_Fan", "E3_Alternator_Pulley"], "#c9c7c0", "natural finish (owner photos 2024-10-03)"),
    "AC-CLUTCH": (["E3_AC_Compressor_SD7_planned", "E3_AC_Clutch_planned"], "#bdc2c0", "eBay photo of the bought Sanden SD7"),
    "STARTER-S": (["E3_Starter_DFSR-8715", "E3_Starter_Solenoid"], "#3d3d40", "not read: drawn dark"),
    **{f"COIL-{i}": ([f"E3_Coil_{i}", f"E3_Coil_{i}_Tower"], "#353535", "GM catalogue photo of D510C") for i in range(1, 9)},
    **{f"INJ-{i}": ([f"E3_Injector_{i}"], "#a9a6ab", "Siemens Deka photo of FI114961") for i in range(1, 9)},
}
DEFAULT_ENV = {"sensor": (30, 30, 40), "switch": (30, 25, 30), "lamp": (80, 40, 60), "connector": (35, 35, 35), "module": (120, 40, 90),
               "actuator": (90, 90, 90), "audio": (100, 60, 100), "power": (60, 60, 40)}
SMALL = {"FUEL-PUMP": (80, 80, 12, "the hanger's top (the in-tank pump hangs below it)"), "FUEL-LEVEL": (40, 40, 12, "the sender's plug on the hanger"),
         "SPL-FUEL-SND": (30, 30, 20, "the splice above the tank lid"), "AMP-PASS": (60, 60, 30, "a Blue Sea CableClam-size pass-through"),
         "GND-BANK-CAB": (60, 40, 60, "a stud bank")}
DEFAULT_SRC = "size not sourced: a {} x {} x {} mm envelope for a {}, centred on the end; the parts lane's model replaces it"


def rot_apply(R, v):
    X, Y, Z = (np.array(a, float) for a in R)
    return X * v[0] + Y * v[1] + Z * v[2]


def colour_of(eid):
    c = COLORS.get(eid) or {}
    cl = c.get("clusters")
    if cl:
        return cl[0]["hex"], f"product photo k-means ({c.get('photo') or 'photo'})"
    return None, "not read"


def local_box(prm):
    """The part's local envelope (metres): MoTeC cases stand on their back face, batteries and the DC-DC on their base."""
    d = prm.get("dims_mm") or {}
    l, w, h = d.get("l", 100) * MM, d.get("w", 100) * MM, d.get("h", 40) * MM
    if prm["axes"]["mount_normal"] == "+Z" and prm["axes"].get("maker_up") == "+Y":      # MoTeC: X = l wide, Y = w tall (headers below), Z = h deep
        return np.array([-l / 2, -w / 2 - 0.035, 0.0]), np.array([l / 2, w / 2, h])
    return np.array([-l / 2, -w / 2, 0.0]), np.array([l / 2, w / 2, h])              # base-mounted: X = l, Y = w, Z = h up


def aabb_of(rec):
    k = rec["kind"]
    if k == "glb":
        lo, hi = rec["_lbox"]
        corners = [rot_apply(rec["rot"], np.array([x, y, z])) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        P = np.array(corners) + np.array(rec["origin"])
        return P.min(axis=0).tolist(), P.max(axis=0).tolist()
    c = np.array(rec.get("centre"), float)
    if k in ("box", "battery", "isolator", "context_box", "plate", "ring"):
        s = np.array(rec["size_mm"], float) * MM / 2
        return (c - s).tolist(), (c + s).tolist()
    if k == "disc_x":
        d, t = rec["size_mm"]; s = np.array([t / 2, d / 2, d / 2]) * MM
        return (c - s).tolist(), (c + s).tolist()
    if k == "disc_y":
        d, t = rec["size_mm"]; s = np.array([d / 2, t / 2, d / 2]) * MM
        return (c - s).tolist(), (c + s).tolist()
    return None


def make_glb_rec(eid, rec):
    g = GLB_PLACE[eid]
    prm, src = part_params(eid)
    o = np.array(g["origin"], float)
    ports = {}
    for a in prm.get("attach", []):
        key = a["ep"] if a["ep"] != eid or a.get("n") in ("plug",) else f"{eid}.{a['n']}"
        if eid in ("ODYSSEY", "ACC-BATT", "DCDC"):
            key = f"{eid}.{a['n']}"
        ports[key] = {"at": [round(float(x), 4) for x in o + rot_apply(g["rot"], np.array(a["at"]) * MM)],
                      "dir": [round(float(x), 3) for x in rot_apply(g["rot"], np.array(a.get("dir", [0, 0, 1]), float))]}
    lb = local_box(prm)
    gp = glb_path(eid)
    rec.update(kind="glb", glb=(gp.replace(os.path.expanduser("~"), "~", 1) if gp else None), origin=list(g["origin"]), rot=[list(r) for r in g["rot"]], dims_mm=prm.get("dims_mm"),
               model=f"parts-lane model ({src})", position_basis=g["why"], status="proposed",
               colour_basis="the parts lane's model colours (" + src + ")", sources=[f"{src}: {prm.get('shape_basis', '')}; {prm.get('dims_note', '') or ''}".strip()],
               ports=ports, _lbox=(lb[0].tolist(), lb[1].tolist()),
               centre=[round(float(x), 4) for x in o + rot_apply(g["rot"], (lb[0] + lb[1]) / 2)])
    return rec


def build_full_parts():
    """Every physical end: parts-lane models first, then sourced stand-ins, twin objects, dashed defaults."""
    H.build_sample_parts()
    P = {p["id"]: p for p in H.PARTS}
    for eid in ("ODYSSEY", "ACC-BATT"):          # the sample's battery boxes become the parts lane's models
        if glb_path(eid):
            rec = make_glb_rec(eid, P[eid])
            rec["posts"] = {"pos": list(rec["ports"][f"{eid}.pos_post"]["at"]), "neg": list(rec["ports"][f"{eid}.neg_post"]["at"])}
            for k in ("pos", "neg"):
                rec["posts"][k][2] = round(rec["posts"][k][2] - 0.019, 4)   # the sample adds the post height and the lug
            for k in ("size_mm", "colours", "post_size_mm"):
                rec.pop(k, None)
    placed = {}
    for eid, e in ENDS.items():
        pv = POS[eid]
        if pv.get("cat") == "harness":
            continue                                   # a splice, fuse or second plug: part of its box (a port)
        xyz, basis = list(pv["xyz"]), pv["basis"]
        if eid in OVERRIDE:
            xyz, basis = list(OVERRIDE[eid][0]), OVERRIDE[eid][1]
        placed[eid] = xyz
        if eid in P:
            P[eid].setdefault("zone", e.get("zone")); P[eid].setdefault("mounts_where", e.get("where"))
            continue
        rec = {"id": eid, "endpoint": eid, "what": e.get("what"), "status": e.get("status"), "position_basis": basis,
               "mounts_where": e.get("where"), "zone": e.get("zone")}
        col, cb = colour_of(eid)
        if eid in GLB_PLACE and glb_path(eid):
            make_glb_rec(eid, rec)
            placed[eid] = rec["centre"]
        elif eid in SIZES:
            sh, dims, src, colh, colb = SIZES[eid]
            rec.update(kind=sh, size_mm=list(dims), centre=[round(float(c), 4) for c in xyz], model="stand-in (true size)", sources=[src], colour=colh, colour_basis=colb)
        elif eid in TWIN_OBJ:
            objs, colh, colb = TWIN_OBJ[eid]
            rec.update(kind="twin", objects=objs, centre=[round(float(c), 4) for c in xyz], model="twin v3 object (twin lane, built from published dimensions)",
                       colour=colh, colour_basis=colb, sources=["docs/wiring/twin/build_engine_v3.py"])
        else:
            dims = DEFAULT_ENV.get(pv.get("cat"), (40, 40, 40))
            if eid in SMALL:
                dims = SMALL[eid][:3]
            rec.update(kind="box", size_mm=list(dims), centre=[round(float(c), 4) for c in xyz], model="dashed (size not sourced)",
                       colour=col or "#9aa0a6", colour_basis=cb if col else "not read (neutral grey)",
                       sources=[DEFAULT_SRC.format(dims[0], dims[1], dims[2], pv.get("cat"))])
        H.PARTS.append(rec)
    H.PARTS.append({"id": "REAR-CONN", "endpoint": None, "kind": "box", "size_mm": [45, 45, 30], "centre": REAR_CONN["xyz"],
                    "model": "dashed (size not sourced)", "status": "open", "colour": "#5b5d3f", "colour_basis": "marker (olive like the 61-pin)",
                    "what": "Proposed round rear-floor connector (the rear loom's one unplug)", "sources": [REAR_CONN["why"]]})
    H.PARTS.append({"id": "FUSE-BATT", "endpoint": None, "kind": "box", "size_mm": [60, 40, 30], "centre": FUSE_BATT,
                    "model": "dashed (size not sourced)", "status": "proposed", "colour": "#d8c9a0", "colour_basis": "not read",
                    "what": "Battery-corner inline fuses: FUSE-IBOOST_PERM, FUSE-ISO_PWR, FUSE-ISO_SW_PWR (Blue Sea 5065 holders per the registry)",
                    "sources": ["mounts.yaml: 'at the battery end of its feed, in the battery corner'; positions_v3 put them inside the Odyssey"]})
    H.PARTS.append({"id": "CTX-FUEL-TANK", "endpoint": None, "kind": "context_box", "size_mm": [840, 750, 320], "centre": [-0.030, 1.330, 0.670],
                    "model": "context", "status": "context", "colour": "#7c8387", "colour_basis": "neutral steel (not read)",
                    "what": "Fuel tank (the body model's own)", "sources": ["pieces lane 2026-09-29: the body model's own tank, probed (Under_Engine_Simple x -0.453..0.39, y 0.954..1.705, z 0.505..0.829)"]})
    for p in H.PARTS:
        bb = aabb_of(p)
        if bb:
            p["aabb"] = [[round(float(v), 4) for v in bb[0]], [round(float(v), 4) for v in bb[1]]]
        p.pop("_lbox", None)
    return placed


# ------------------------------------------------------------------ part audit against the twin
BODY_MESHES = ["Under_Main_Blazer", "Interior_Main", "Interior_Body", "Interior_Panels_Rear", "Dash_Main", "Under_Frame_Blazer",
               "Exterior_Body_Blazer", "Exterior_Body_Blazer_Rear", "Interior_Spare_Tire_Carrier", "Wheel_Spare_Tire", "Tailgate_Main",
               "Door_Left_Main", "Door_Right_Main", "Steering_Main", "K5H_Radiator", "Interior_Center_Box", "Interior_Seat_Rear"]


def host_meshes(p):
    """Twin meshes a part is meant to sit in or on (its host panel), so touching them is not a clash."""
    i, where = p["id"], (p.get("mounts_where") or "").lower()
    if i.startswith(("DOOR-L", "WIN-SW-L", "LOCK-SW-L")) or i in ("lock_actuator_DS", "window_motor_DS", "SPK-FL"):
        return {"Door_Left_Main", "Interior_Body", "Interior_Panels_Rear"}
    if i.startswith(("DOOR-R", "WIN-SW-R", "LOCK-SW-R")) or i in ("lock_actuator_PS", "window_motor_PS", "SPK-FR"):
        return {"Door_Right_Main", "Interior_Body", "Interior_Panels_Rear"}
    if i.startswith("TG-") or i == "rear_window_motor":
        return {"Tailgate_Main"}
    if any(k in where for k in ("dash", "instrument panel", "control head", "glovebox", "radio opening", "column", "wheel centre")):
        return {"Dash_Main", "Steering_Main"}
    if i.startswith(("Tail_Light", "Backup_Light", "MARKER", "PARK-TURN", "HEADLIGHT", "CLEARANCE", "LICENSE", "CHMSL", "CARGO")):
        return {"Exterior_Body_Blazer", "Exterior_Body_Blazer_Rear", "Exterior_Roof"}
    if i in ("SPK-RL", "SPK-RR", "SUB", "SUB-2", "AMP", "AMP-BLOCK"):
        return {"Interior_Panels_Rear"}
    if i in ("AMP-PASS", "REAR-CONN", "FIREWALL-BODY-C"):
        return {"Under_Main_Blazer", "Interior_Main", "Exterior_Body_Blazer_Rear"}
    if i in ("DOME-LAMP", "DOOR-JAMB-L", "DOOR-JAMB-R"):
        return {"Interior_Main", "Interior_Body"}
    if i in ("WIPER-MOTOR", "HORN", "BLOWER-MOTOR"):
        return {"Under_Main_Blazer"}
    return set()


def part_audit(mesh_dir, obst):
    pts = {}
    if mesh_dir and os.path.isdir(mesh_dir):
        for n in BODY_MESHES:
            f = os.path.join(mesh_dir, n + ".npz")
            if os.path.exists(f):
                d = np.load(f); V, T = d["V"], d["T"]
                pts[n] = np.concatenate([V, V[T].mean(axis=1)])
    boxes = [(p["id"], np.array(p["aabb"][0]), np.array(p["aabb"][1])) for p in H.PARTS if p.get("aabb") and p["kind"] != "context_box"]
    fw61 = {"FW61-PLATE", "FIREWALL-ENGINE", "FIREWALL-CABIN"}
    for p in H.PARTS:
        checks = []
        if not p.get("aabb") or p["kind"] in ("context_box",):
            p["checks"] = checks
            continue
        lo, hi = np.array(p["aabb"][0]) + 0.003, np.array(p["aabb"][1]) - 0.003
        hits, hosted = {}, {}
        host = host_meshes(p)
        for n, Q in pts.items():
            m = int(np.all((Q > lo) & (Q < hi), axis=1).sum())
            if m:
                (hosted if n in host else hits)[n] = m
        why = ("its envelope holds twin surface: " + ", ".join(f"{k} ({v} pts)" for k, v in sorted(hits.items(), key=lambda kv: -kv[1])) +
               " - re-check at the mock-up (or the twin is off there: tapes)") if hits else "no twin body surface inside its envelope"
        if hosted:
            why += "; sits in its host panel " + ", ".join(sorted(hosted))
        checks.append({"rule": "clear of the body (twin)", "source": "twin meshes (TurboSquid body; margins.yaml tolerance per zone)",
                       "result": "flag" if hits else "pass", "why": why})
        if p["id"] in ("SUB", "SUB-2"):
            near = {}
            for n in ("Interior_Spare_Tire_Carrier", "Wheel_Spare_Tire"):
                if n in pts:
                    c = np.clip(pts[n], np.array(p["aabb"][0]), np.array(p["aabb"][1]))
                    near[n] = float(np.min(np.linalg.norm(pts[n] - c, axis=1)))
            if near:
                dmin = min(near.values())
                checks.append({"rule": "clear of the spare tire and its carrier", "source": "owner call 2026-09-29 (subs behind the rear wheel wells on a built structure; flag the spare-tire carrier in the right rear corner); twin Interior_Spare_Tire_Carrier, Wheel_Spare_Tire",
                               "result": "flag" if dmin < 0.10 else "pass",
                               "why": "driver alone: " + ", ".join(f"{k} {v / MM:.0f} mm" for k, v in near.items()) +
                                      ("; the enclosure (not designed; JBL's volume not read) and its structure land inside the carrier's reach: a clash to resolve with the spare's mount" if dmin < 0.10 else "")})
        over = [oid for oid, a, b in boxes if oid != p["id"] and not ({oid, p["id"]} <= fw61) and np.all(np.minimum(hi, b) > np.maximum(lo, a))]
        if over:
            checks.append({"rule": "clear of neighbouring parts", "source": "part envelopes in this scene", "result": "flag", "why": "envelope overlaps " + ", ".join(over)})
        if obst and obst.ok:
            c = np.clip(obst.exh, np.array(p["aabb"][0]), np.array(p["aabb"][1]))
            d = float(np.min(np.linalg.norm(obst.exh - c, axis=1)))
            if d < 0.30:
                res = "fail" if d < 0.0254 else ("flag" if d < 0.150 else "pass")
                checks.append({"rule": ">= 1 in from the exhaust (heat)", "source": S["heat"], "result": res,
                               "why": f"{d / MM:.0f} mm from the twin's headers/collectors/tails" + ("; within 150 mm: heat shield or move" if d < 0.150 else "")})
        p["checks"] = checks


# ------------------------------------------------------------------ DC primary, whole truck
def dc_full():
    """The sample's DC cables (reviewed), with their rear and cab ends drawn, plus the cables the sample left out."""
    R = {r["id"]: r for r in H.ROUTES if r["loom"] == "dc"}
    P = {p["id"]: p for p in H.PARTS}

    def rail_low(y, drop):
        return list(G.rail_xyz(+1, y, below_top=drop, off=0.012))

    lug = 0.009
    acc = P["ACC-BATT"]
    ap_ = [acc["posts"]["pos"][0], acc["posts"]["pos"][1], round(acc["posts"]["pos"][2] + 0.019 + lug, 4)]
    an_ = [acc["posts"]["neg"][0], acc["posts"]["neg"][1], round(acc["posts"]["neg"][2] + 0.019 + lug, 4)]
    rail_y = (-1.80, -1.60, -1.50, -1.40, -1.30, -1.20, -0.70, 0.10, 0.20, 0.30, 0.40, 0.50, 0.75, 0.95, 1.10, 1.20)
    # 32: the YellowTop's + (rear, inboard) down its inboard face to the driver rail, back on the rail's lower web, up through AMP-PASS
    r = R["DC-32"]
    r["pts"] = ([ap_, [0.485, ap_[1], ap_[2]], [0.485, ap_[1] + 0.030, 1.120], [0.470, -2.140, 0.900], rail_low(-2.05, 0.085)] +
                [rail_low(y, 0.085) for y in rail_y] +
                [[0.500, 1.290, 0.700], [0.550, 1.300, 0.850], [0.600, 1.330, 0.960], [0.700, 1.385, 1.090], [0.735, 1.398, 1.130]])
    r["to"] = "AMP-BLOCK (through AMP-PASS)"
    r["path_why"] = ("down the YellowTop's inboard face (its + post is at the rear with the posts inboard) to the driver frame rail, back on the "
                     "rail's lower outboard web (the loom rides the upper web; the twin's exhaust tail is inside that rail), up through the "
                     "AMP-PASS CableClam to the reducing block")
    r = R["DC-AMP_GND"]
    k = next(i for i, p in enumerate(r["pts"]) if p[2] < 0.80 and abs(p[0]) > 0.40)
    r["pts"] = (r["pts"][:k] + [rail_low(-2.05, 0.105)] + [rail_low(y, 0.105) for y in rail_y] +
                [[0.510, 1.275, 0.690], [0.565, 1.290, 0.850], [0.615, 1.320, 0.955], [0.710, 1.378, 1.085], [0.745, 1.395, 1.125]])
    r["to"] = "AMP-BLOCK (through AMP-PASS)"
    r["path_why"] = r["path_why"] + "; then with #32 on the rail's lower web and up through AMP-PASS"
    # ACC_NEG: from the YellowTop's - post (front, inboard) onto the core support
    r = R["DC-ACC_NEG"]
    r["pts"] = [an_, [0.490, an_[1], an_[2]], [0.440, -2.395, 1.195]] + r["pts"][3:]
    # PDM_BPOS and GND_RET_CAB through H3: the hole is mid-cable now, so every bend there is open-run (10 x OD, AC 43.13-1B
    # 11-96 aa) and the cab side sweeps out ~0.16 m behind the firewall before it turns (checked with harness_cad.fillet)
    stud = P["PDM30-A"]["ports"]["PDM30-STUD"]["at"]
    lug_y = round(stud[1] + 0.006, 4)
    r = R["DC-PDM_BPOS"]
    r["pts"] = r["pts"][:3] + [[-0.495, -1.700, 1.055], [-0.470, -1.580, 0.960], [-0.357, -1.540, 0.905], [-0.357, -1.300, 0.905],
                               [0.000, -1.300, 0.935], [stud[0], lug_y, 0.940], [stud[0], lug_y, stud[2]]]
    r["fw_idx"] = [5, 6, 7, 8, 9]
    r["to"] = "PDM30-STUD (M6, through H3: the exception)"
    r["path_why"] = ("back along the passenger inner-fender edge, down behind the head to H3 (the exception route); in the cab it sweeps "
                     "out behind the firewall at 10 x OD, over the tunnel and up to the PDM30's M6 stud (parts lane: 74.3 mm up, 17.9 proud)")
    gb = P["GND-BANK-CAB"]["centre"]
    r = R["DC-GND_RET_CAB"]
    r["pts"] = [[gb[0], gb[1] + 0.030, gb[2]], [gb[0] - 0.065, gb[1] + 0.032, gb[2] - 0.025], [-0.343, -1.290, 0.895], [-0.343, -1.560, 0.895],
                [-0.450, -1.620, 0.925], [-0.480, -1.740, 1.025], [-0.470, -1.950, 1.045], [-0.470, -1.985, 0.960], [-0.480, -2.010, 0.925]]
    r["frm"] = "GND-BANK-CAB (through H3: the exception)"
    r["fw_idx"] = [0, 1, 2, 3]
    r["path_why"] = "from the cab ground bank beside the PDM30, swept out behind the firewall to H3, then paired with PDM_BPOS on the passenger inner-fender edge into the ground star's rear face"
    # cables the sample left out
    dcp = P["DCDC"]["ports"]
    tin, tout, tgnd = dcp["DCDC.in_pos"]["at"], dcp["DCDC.out_pos"]["at"], dcp["DCDC.gnd"]["at"]
    CS_Y = -2.425
    new = [
        dict(id="DC-DCDC_IN", wire="DCDC_IN", frm="PS-STUDS (MIDI 60)", to="DCDC (IN +, terminal block)", polarity="+", parallel=1,
             pts=[[-0.480, -2.120, 1.070], [-0.480, -2.120, 1.130], [-0.400, CS_Y, 1.175], [0.400, CS_Y, 1.175], [0.470, -2.320, 1.130],
                  [0.495, -2.150, 0.960], [0.480, -2.060, 0.820], [tin[0], tin[1], 0.800], tin],
             fixed_to="radiator (core) support, driver inner-fender wall",
             path_why="along the core support under #59 (clear of the fan and belt), down the driver inner-fender wall in front of the charger, up into its input terminal (terminals face down)"),
        dict(id="DC-DCDC_OUT", wire="DCDC_OUT", frm="DCDC (OUT +)", to="ACC-BATT + (YellowTop)", polarity="+", parallel=1,
             pts=[tout, [tout[0], tout[1], 0.830], [0.470, -2.120, 0.845], [0.485, -2.200, 0.990], [0.485, ap_[1], 1.150], [0.485, ap_[1], ap_[2]], ap_],
             fixed_to="driver inner-fender wall, YellowTop hold-down",
             path_why="the charger's output down, forward and up the YellowTop's inboard face to its + post (shortest; stays outboard of the alternator)"),
        dict(id="DC-DCDC_GND", wire="DCDC_GND", frm="DCDC (-)", to="GND-BANK-ENG", polarity="-", parallel=1,
             pts=[tgnd, [tgnd[0], tgnd[1], 0.815], [0.462, -2.110, 0.830], [0.470, -2.260, 1.000], [0.455, -2.380, 1.130], [0.400, CS_Y, 1.155],
                  [-0.400, CS_Y, 1.155], [-0.440, -2.300, 1.040], [-0.480, -2.160, 0.945], [-0.480, -2.110, 0.925]],
             fixed_to="driver inner-fender wall, radiator (core) support",
             path_why="the charger's return to the one ground star, clamped under the other returns along the core support"),
        dict(id="DC-G3", wire="G3", frm="engine: back of the passenger head", to="firewall bond stud (engine side)", polarity="-", parallel=1,
             pts=[[-0.200, -1.492, 0.985], [-0.260, -1.495, 0.990], [-0.380, -1.490, 1.000], [-0.420, round(y_fw(-0.42) - 0.012, 4), 1.000]],
             fixed_to="cylinder-head bolt, firewall stud", service_loop=True, lands_on_engine=True,
             path_why="the engine-to-body strap across the gap behind the passenger head; both ends' spots are not sourced (set at the mock-up)"),
        dict(id="DC-AMP_PWR_TAIL", wire="AMP_PWR_TAIL", frm="AMP-BLOCK (+ out)", to="AMP (+12 V, power plug)", polarity="+", parallel=1,
             pts=[[0.740, 1.380, 1.150], [0.760, 1.355, 1.150], [0.772, 1.335, 1.150]], fixed_to="side panel", side="body",
             path_why="the 4 AWG tail from the reducing block into the amp's power plug (JL: 4 AWG minimum); plug spot on the case not read"),
        dict(id="DC-AMP_GND_TAIL", wire="AMP_GND_TAIL", frm="AMP (ground, power plug)", to="AMP-BLOCK (- in)", polarity="-", parallel=1,
             pts=[[0.790, 1.335, 1.120], [0.775, 1.360, 1.120], [0.750, 1.385, 1.120]], fixed_to="side panel", side="body",
             path_why="the 4 AWG ground tail from the amp's power plug to the reducing block"),
    ]
    for d in new:
        H.route(loom="dc", kind="cable", members=[d["wire"]], **d)
    for r in H.ROUTES:
        if r["loom"] == "dc":
            r.setdefault("side", "engine")
    return [r for r in H.ROUTES if r["loom"] == "dc"]


# ------------------------------------------------------------------ wires -> the channel graph
def port_of(ep):
    """Where a registry end sits for routing: a part's plug, its box, or its own place."""
    if ep in ("PDM30-B", "M130-B", "PDM30-STUD"):
        return ep
    if ep in ("PDM15-B", "PDM15-STUD", "FAN-JUNCTION") or ep.startswith("SPL-PDM15"):
        return "PDM15-A"
    if ep == "CAN-BUS":
        return "M130-B"
    if ep.startswith("SPL-PDM30") or ep.startswith(("FUSE-DAK", "FUSE-PCS", "FUSE-TRANS")):
        return "PDM30-A"
    if ep in ("FUSE-IBOOST_PERM", "FUSE-ISO_PWR", "FUSE-ISO_SW_PWR"):
        return "FUSE-BATT"
    if ep == "SPL-ISO-YEL":
        return "ISO-SWITCH"
    return ep


EPIDS = sorted(ENDS.keys(), key=len, reverse=True)


def ep_in(text):
    t = (text or "").upper()
    for e in EPIDS:
        if e.upper() in t:
            return e
    return None


def build_graph(engine_routes, E0):
    g = G.Graph()
    for cid, loom, fixed, pts in G.CHANNELS:
        g.add_edge(cid, [list(E0) if (isinstance(p, str) and p == "E0") else p for p in pts], loom, fixed)
    for r in engine_routes:
        if r["kind"] in ("trunk", "branch"):
            g.add_edge(r["id"], r["pts"], "engine", r.get("fixed_to"))
    # stitch: a channel that ends on another channel's run joins it there (split the run at that point)
    for _ in range(3):
        for eid in list(g.edges):
            if eid not in g.edges:
                continue
            for end in ("a", "b"):
                e = g.edges.get(eid)
                if e is None:
                    break
                k = e[end]
                q = g.nodes[k]
                for oid in list(g.edges):
                    if oid == eid or oid not in g.edges:
                        continue
                    o = g.edges[oid]
                    if k in (o["a"], o["b"]):
                        continue
                    d, i, t, pnt = G.nearest_on(o["pts"], q)
                    if d < 0.006:
                        g.attach(oid, q, snap=0.004)
                        break
    for cid, loom, what, pts, tag in G.CROSSINGS:
        pts = [list(E0) if (isinstance(p, str) and p == "E0") else p for p in pts]
        g.add_edge(cid, pts, loom, what, kind="crossing", allowed=tag)
    # a crossing end that lands mid-channel: split that channel there
    for cid, loom, what, pts, tag in G.CROSSINGS:
        for end in ("a", "b"):
            e = g.edges[cid]; k = e[end]
            if len(g.adj[k]) > 1:
                continue
            q = g.nodes[k]
            cands = [x for x, ee in g.edges.items() if ee["kind"] == "channel"]
            best = min(cands, key=lambda x: G.nearest_on(g.edges[x]["pts"], q)[0])
            if G.nearest_on(g.edges[best]["pts"], q)[0] > 0.05:
                continue
            nk = g.attach(best, q, snap=0.004)
            if nk != k:
                pts2 = [list(p) for p in e["pts"]]
                pts2[0 if end == "a" else -1] = list(g.nodes[nk])
                g.remove_edge(cid); g.add_edge(cid, pts2, loom, what, kind="crossing", allowed=tag)
    ports = {}
    for r in engine_routes:
        dev = ep_in(r["to"])
        if r["kind"] == "drop" and dev:
            q = r["pts"][0]
            k = g.key(q)
            if not (k in g.nodes and g.adj.get(k)):
                cands = [x for x, ee in g.edges.items() if ee["kind"] == "channel" and ee["loom"] == "engine"]
                best = min(cands, key=lambda x: G.nearest_on(g.edges[x]["pts"], q)[0])
                nk = g.attach(best, q, snap=0.004)
                r = dict(r); r["pts"] = [list(g.nodes[nk])] + [list(p) for p in r["pts"][1:]]
            g.add_edge(f"DROP-{dev}", r["pts"], "engine", r.get("fixed_to"), kind="device", device=dev)
            g.edges[f"DROP-{dev}"]["src_route"] = r["id"]
            ports[dev] = list(r["pts"][-1])
        elif r["kind"] == "branch" and dev and dev not in ("PDM15-B",):
            ports[dev] = list(r["pts"][-1])
    return g, ports


def attach_device(g, dev, pos, zone, ports):
    allowed = G.ZONE_CHANNELS.get(zone) or G.ZONE_CHANNELS["bay"]
    chans = [x for x, e in g.edges.items() if e["kind"] == "channel" and x.split("~")[0] in allowed]
    if zone == "engine":
        chans += [x for x, e in g.edges.items() if e["loom"] == "engine" and e["kind"] == "channel"]
    best = min(chans, key=lambda x: G.nearest_on(g.edges[x]["pts"], pos)[0])
    loom = g.edges[best]["loom"]
    node = g.attach(best, pos)
    p0 = g.nodes[node]
    ports[dev] = list(pos)
    if np.linalg.norm(np.array(p0) - np.array(pos)) < 0.004:
        ports[dev] = list(p0)    # sits on a junction (an in-line connector such as a door pass-through): wires pass through it
        return
    g.add_edge(f"DROP-{dev}", G.drop_path(p0, pos), loom, "device drop", kind="device", device=dev)
    g.terminal.add(g.key(pos))


def route_all(reg, placed, dc_routes, engine_routes, E0):
    W = {w["id"]: w for w in reg["wires"] + reg["implied"]}
    w2e = defaultdict(list)
    for k, v in reg["endpoints"].items():
        for wid in v["wires"]:
            w2e[wid].append(k)
    dc_wires = {m for r in dc_routes for m in r["members"]}
    g, ports = build_graph(engine_routes, E0)
    P = {p["id"]: p for p in H.PARTS}
    special = {}
    for pid in ("M130-A", "PDM30-A"):
        for k, v in (P[pid].get("ports") or {}).items():
            special[k] = (v["at"], "cab")
    special["PDM15-A"] = (list(G.N["PDM15"]), "bay")
    special["FUSE-BATT"] = (FUSE_BATT, "bay")
    special["RAIL-COIL_PWR"] = ([0.000, -1.510, 1.118], None)
    special["RAIL-INJ_PWR"] = (list(G.N["H0"]), None)
    special["FIREWALL-ENGINE"] = (list(E0), None)
    special["FIREWALL-CABIN"] = (list(G.N["C61"]), None)
    for dev, (pos, zone) in special.items():
        k = g.key(pos)
        if k in g.nodes and g.adj.get(k):
            ports[dev] = list(pos)
            if dev not in ("RAIL-COIL_PWR", "RAIL-INJ_PWR", "FIREWALL-ENGINE", "FIREWALL-CABIN"):
                g.terminal.add(k)
            continue
        attach_device(g, dev, pos, zone or "bay", ports)
    for dev, xyz in placed.items():
        if dev in ports or dev in ("FIREWALL-GROMMET", "FIREWALL-ENGINE", "FIREWALL-CABIN", "M130-A", "PDM30-A", "PDM15-A"):
            continue
        zone = G.zone_of_end(dev, xyz, ENDS[dev].get("zone"))
        if ENDS[dev].get("zone") == "engine" and zone == "bay":
            inside = abs(xyz[0]) < 0.42 and xyz[2] < 1.20 and -2.20 < xyz[1] < -1.40
            zone = "engine" if inside else "bay"
        attach_device(g, dev, xyz, zone, ports)
    edge_members, open_edges = defaultdict(list), defaultdict(list)
    info = {"unrouted": [], "rehomed": [], "open": [], "h3": [], "no_ends": [], "one_end": []}
    for wid, w in W.items():
        eps = w2e.get(wid, [])
        if not eps:
            info["no_ends"].append(wid); continue
        if wid in dc_wires:
            continue
        allowed = {"rear"}
        chain = list(eps)
        if "FIREWALL-CABIN" in chain and "FIREWALL-ENGINE" in chain:
            chain = [e for e in chain if e not in ("FIREWALL-CABIN", "FIREWALL-ENGINE")]; allowed.add("61pin")
            if len({port_of(e) for e in chain}) == 1:     # a drain or a wire that ends at the 61-pin's far face
                far = chain[0]
                chain = chain + (["FIREWALL-ENGINE"] if ENDS.get(far, {}).get("zone") in ("cab", "doors", "rear", "underbody") else ["FIREWALL-CABIN"])
        if "FIREWALL-GROMMET" in chain:
            chain.remove("FIREWALL-GROMMET"); allowed.add("h3"); info["h3"].append(wid)
        if "FIREWALL-BODY-C" in chain:
            chain.remove("FIREWALL-BODY-C"); allowed.add("bodyc")
        if "AMP-PASS" in chain:
            chain.remove("AMP-PASS"); allowed.add("amp")
        if "PCS-HARNESS-4610-CASE" in chain:
            allowed.add("trans")
        is_open = False
        body = [e for e in chain if e in ("FIREWALL-BODY-A", "FIREWALL-BODY-B", "FIREWALL-BODY-P")]
        if body:
            chain = [e for e in chain if e not in body]
            cab = [e for e in chain if port_of(e) in ("PDM30-A", "PDM30-B", "PDM30-STUD")]
            bay = [e for e in chain if port_of(e) == "PDM15-A"]
            if cab:
                chain = ["PDM15-A" if e in cab else e for e in chain]; info["rehomed"].append((wid, "PDM30 -> bay box (PDM15/PDM32)"))
            elif bay:
                chain = ["PDM30-A" if e in bay else e for e in chain]; info["rehomed"].append((wid, "bay box -> PDM30")); allowed.add("61pin")
            else:
                allowed.add("61pin"); is_open = True; info["open"].append(wid)
        ch = []
        for e in chain:
            p = port_of(e)
            if p not in ch:
                ch.append(p)
        if len(ch) < 2:
            info["one_end"].append((wid, eps, "both ends at one box (a pigtail inside it)" if len(eps) > 1 else "one end listed in the registry")); continue
        frm = str(w.get("frm") or "").upper()
        start = next((c for c in ch if c.split("-")[0] in frm), ch[0])
        order = [start]; rest = [c for c in ch if c != start]
        while rest:
            last = np.array(ports.get(order[-1], [0, 0, 0]), float)
            nxt = min(rest, key=lambda c: float(np.linalg.norm(np.array(ports.get(c, [9, 9, 9]), float) - last)))
            order.append(nxt); rest.remove(nxt)
        ok, why = True, None
        for a, b in zip(order, order[1:]):
            if a not in ports or b not in ports:
                ok, why = False, f"no position for {a if a not in ports else b}"; break
            pa, pb = g.key(ports[a]), g.key(ports[b])
            if pa == pb:
                continue
            path = g.path(pa, pb, allowed)
            if path is None:
                ok, why = False, f"no path {a} -> {b} with crossings {sorted(allowed)}"; break
            for eid in path:
                if is_open and eid == "X-61PIN":
                    open_edges[eid].append(wid); continue
                edge_members[eid].append(wid)
        if not ok:
            info["unrouted"].append((wid, order, why))
    info["ports"] = ports
    return g, edge_members, open_edges, info


def node_name(g, k):
    for n, q in G.N.items():
        if g.key(q) == k:
            return n
    p = g.nodes[k]
    return f"break-out ({p[0]:.3f}, {p[1]:.3f}, {p[2]:.3f})"


def graph_routes(g, edge_members, open_edges, engine_routes):
    src = {r["id"]: r for r in engine_routes}
    out = []
    for eid, e in g.edges.items():
        mem = sorted(set(edge_members.get(eid, [])))
        if not mem:
            continue
        base = eid.split("~")[0]
        kind = {"device": "drop", "crossing": "crossing"}.get(e["kind"], "branch")
        dev = e.get("device")
        rec = {"id": eid, "edge_of": base, "loom": e["loom"], "kind": kind, "members": mem,
               "frm": ("break-out on " + base) if kind == "drop" else node_name(g, e["a"]),
               "to": dev if dev else node_name(g, e["b"]), "pts": e["pts"], "fixed_to": e["fixed_to"]}
        s0 = src.get(e.get("src_route") or base)
        if s0:
            if s0["kind"] == "trunk":
                rec["kind"] = "trunk"
            for k in ("conflict", "position_open", "ends_at_fan", "why"):
                if s0.get(k):
                    rec[k] = s0[k]
        if kind == "crossing":
            rec["crossing_tag"] = e["allowed"]; rec["to"] = e["fixed_to"]
            if e["allowed"] == "h3":
                rec["crossing"] = "H3"
        if open_edges.get(eid):
            rec["open_wires"] = sorted(set(open_edges[eid]))
        rec["side"] = "cab" if e["loom"] in ("cab", "door") else ("body" if e["loom"] in ("rear", "under") else "engine")
        if dev in ("AC-CLUTCH", "ALTERNATOR-SENSE"):
            rec["ends_at_belt"] = True
        if base in ("F-TOHUB", "ENG-CAN", "ENG-T0") or (kind == "drop" and e["loom"] == "front" and ENDS.get(dev, {}).get("status") == "fixed_by_engine"):
            rec["engine_gap"] = True
        P = np.array(e["pts"])
        idx = [i for i, p in enumerate(P) if abs(p[1] - y_fw(p[0])) < 0.080 and p[2] > 0.88 and abs(p[0]) < 0.78]
        if idx and len(idx) < len(P):
            rec["fw_idx"] = idx
        out.append(rec)
    return out


# ------------------------------------------------------------------ audit lists
def loom_audit(routes, info):
    looms = defaultdict(list)
    for r in routes:
        looms[r["loom"]].append(r)
    doc = {"generated_by": "docs/wiring/twin/harness_full.py", "status": "PROPOSAL (owner and builder to confirm)",
           "frame": "twin metres: +x driver, -y front, +z up", "sources": S, "looms": []}
    for lid in ("engine", "front", "dc", "cab", "door", "rear", "under"):
        rs = looms.get(lid, [])
        if not rs:
            continue
        wires = sorted({m for r in rs for m in r["members"]})
        chk = Counter(c["result"] for r in rs for c in r["checks"])
        passes = sorted({r["to"] for r in rs if r["kind"] == "crossing"} | ({"H3 (the exception)"} if any(r.get("crossing") == "H3" for r in rs) else set()))
        segs = [{"id": r["id"], "kind": r["kind"], "from": r["from"], "to": r["to"], "wires": r["members"], "cables": r["cables"],
                 "bundle_od_mm": r["bundle_od_mm"], "od_basis": r["bundle_od_basis"], "od_unknowns": r["od_unknowns"],
                 "length_mm": r["length_mm"], "length_basis": r["length_basis"], "clamps": len(r["clamps"]),
                 "firewall_shift_mm": r.get("firewall_shift_mm"), "dr25_estimate": r.get("dr25_estimate"), "why": r.get("why"),
                 "checks": [{"rule": c["rule"], "source": c["source"], "result": c["result"], "why": c["why"]} for c in r["checks"]]} for r in rs]
        doc["looms"].append({"loom": lid, "name": H.LOOM_NAMES.get(lid, lid), "status": "PROPOSAL", "member_wires": wires,
                             "wire_count": len(wires), "segments": len(rs), "bundle_od_mm_max": round(max(r["bundle_od_mm"] for r in rs), 2),
                             "length_mm_total": int(sum(r["length_mm"] for r in rs)), "clamp_count": int(sum(len(r["clamps"]) for r in rs)),
                             "pass_throughs": passes, "checks_summary": dict(chk), "segments_detail": segs})
    doc["unrouted"] = [{"wire": w, "chain": o, "why": y} for w, o, y in info["unrouted"]]
    doc["rehomed_to_other_box"] = [{"wire": w, "how": h} for w, h in info["rehomed"]]
    doc["open_no_crossing"] = {"wires": info["open"], "why": (
        "these used the retired bulkheads A/B/P and have no PDM on the far side to re-home to: drawn to the 61-pin on both sides as a "
        "placeholder but NOT counted in it. The 61-pin already carries 58 wires in its 61-way insert (registry FIREWALL-ENGINE), so each "
        "needs a re-home (e.g. a PDM input + CAN + an output on the other side) or the owner's call (state row 0ah). A denser insert is out: "
        "shell 25 is the series' largest and none of its inserts beats 25-61's 61 x #20, and a #20 contact does not take these 16/18 AWG wires "
        "(reference_documents/component_drawings/MILNEC_D38999_series_III_catalog.pdf p.B-19 'Insert Arrangement Selection', read by the pieces "
        "lane 2026-09-30). Left for Skylar and Dave: (1) re-home so only CAN crosses (a multi-position switch could share one PDM input "
        "through a resistor ladder: PDM inputs read 0-51 V in 0.2 V steps, PDM manual p.1; a possibility, not a design), or (2) a second "
        "round connector (the owner's one-crossing rule)")}
    doc["through_h3"] = {"wires": info["h3"], "why": "the registry routes these through FIREWALL-GROMMET (H3) with the cab power box's feed and ground: the exception under review"}
    doc["single_end_or_no_end"] = {"one_end": [{"wire": w, "ends": e, "why": y} for w, e, y in info["one_end"]], "no_ends": info["no_ends"]}
    return doc


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh-dir", default=None)
    a = ap.parse_args()
    reg = json.load(open(H.REG_PATH))
    W = {w["id"]: w for w in reg["wires"] + reg["implied"]}
    placed = build_full_parts()
    H.build_sample_routes(reg)
    for r in H.ROUTES:
        if r["id"] == "ENG-FUELP":   # FUELP now sits in the regulator's gauge port (fuel-system lane): the drop comes down in front of it
            r["pts"] = [[0.030, -1.985, 1.120], [0.006, -2.075, 1.100], [0.000, -2.078, 1.010], [0.000, -2.052, 0.983]]
            r["to"] = "FUELP (AEM 30-2131-100 in the regulator's gauge port)"; r["position_open"] = False
            r["fixed_to"] = "regulator gauge port (fuel-system lane)"
    engine_routes = [r for r in H.ROUTES if r["loom"] == "engine"]
    E0 = list(engine_routes[0]["pts"][0])
    obst = H.Obstacles(a.mesh_dir)
    dc_routes = dc_full()
    g, members, open_edges, info = route_all(reg, placed, dc_routes, engine_routes, E0)
    groutes = graph_routes(g, members, open_edges, engine_routes)
    H.ROUTES[:] = dc_routes + groutes
    out = H.evaluate(obst, W)
    for r in out:
        for k, txt in (("start", r["from"]), ("end", r["to"])):
            ep = ep_in(txt)
            r[k + "_ep"] = ep
            r[k + "_status"] = ENDS.get(ep, {}).get("status") if ep else "breakout"
    part_audit(a.mesh_dir, obst)
    landed = defaultdict(set)
    for r in out:
        for ep in (r["start_ep"], r["end_ep"]):
            if ep:
                landed[ep] |= set(r["members"])
    for p in H.PARTS:
        p["wires_landing"] = sorted(landed.get(p.get("endpoint") or p["id"], set()))
    notes = {"unrouted": info["unrouted"], "rehomed": info["rehomed"], "open_no_crossing": info["open"], "through_h3": info["h3"]}
    json.dump(clean({"frame": "twin metres: +x driver, -y front, +z up", "scope": "all", "parts": H.PARTS, "routes": out, "notes": notes, "sources": S}),
              open(CAD / "scene_v4.json", "w"), indent=1)
    lay = H.export_layout(out, reg)
    lay["scope"] = "whole truck: engine, front (bay box), DC primary, cab/dash, doors, rear, underbody/trans"
    for n in lay["nodes"]:
        pp = next((p for p in H.PARTS if p.get("endpoint") and p.get("endpoint") == n.get("ep") and p.get("aabb")), None)
        if pp:
            n["size_mm"] = [round((pp["aabb"][1][i] - pp["aabb"][0][i]) / MM, 1) for i in range(3)]
            n["part_model"] = pp.get("model")
    json.dump(clean(lay), open(CAD / "routes.json", "w"), indent=1)
    yaml.safe_dump(clean(loom_audit(out, info)), open(CAD / "routes.yaml", "w"), sort_keys=False, width=160, allow_unicode=True)
    keys = ("id", "endpoint", "what", "status", "model", "kind", "size_mm", "dims_mm", "centre", "origin", "rot", "aabb", "colour", "colour_basis",
            "position_basis", "mounts_where", "zone", "sources", "ports", "wires_landing", "checks")
    yaml.safe_dump(clean({"generated_by": "docs/wiring/twin/harness_full.py", "frame": "twin metres: +x driver, -y front, +z up",
                          "parts": [{k: p.get(k) for k in keys if p.get(k) is not None} for p in H.PARTS]}),
                   open(CAD / "parts.yaml", "w"), sort_keys=False, width=160, allow_unicode=True)
    looms = Counter(r["loom"] for r in out)
    res = Counter(c["result"] for r in out for c in r["checks"])
    pres = Counter(c["result"] for p in H.PARTS for c in p.get("checks", []))
    models = Counter(p.get("model", "?").split(" (")[0] for p in H.PARTS)
    print("parts", len(H.PARTS), dict(models))
    print("segments", len(out), dict(looms), "route checks", dict(res), "part checks", dict(pres))
    print("unrouted", len(info["unrouted"]), info["unrouted"][:25])
    print("rehomed", len(info["rehomed"]), "open", len(info["open"]), info["open"], "h3", len(info["h3"]), "one_end", len(info["one_end"]), info["one_end"][:8], "no_ends", len(info["no_ends"]))
    for r in out:
        f = [c["rule"] + ": " + c["why"] for c in r["checks"] if c["result"] == "fail"]
        if f:
            print(f"FAIL {r['id']:24s} {r['loom']:6s} od {r['bundle_od_mm']:6.2f} len {r['length_mm']:5d}  " + " ; ".join(f)[:400])
    for p in H.PARTS:
        f = [c["rule"] + ": " + c["why"] for c in p.get("checks", []) if c["result"] in ("fail", "flag")]
        if f:
            print(f"PART {p['id']:22s} " + " ; ".join(f)[:300])


if __name__ == "__main__":
    main()
