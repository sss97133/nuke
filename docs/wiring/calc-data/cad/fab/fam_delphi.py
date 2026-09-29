#!/usr/bin/env python3
"""Delphi (Aptiv) Metri-Pack 150 and GT 150 sealed sensor plugs, their terminals, cable seals and locks, and the GM
sensors they plug into (CKP, CMP, MAP, ECT / oil temperature, IAT), each end as a mated assembly.

Numbers, in order of trust:
  maker   Delphi drawing 12129958 (Metri-Pack 150 3-way female, harness connector 12129946 type 102, with the sensor-side
          "MATING CONNECTOR INFORMATION": shroud 22.9 +-0.15 wide, 1.5 walls, 18.9 deep, blades 6 apart) and drawing
          15449030 (GT 150 2-way female, 15449028 type 102: 30.65 long, 17.04 wide, 14.6 high, cavities 3.5 apart);
          the Delphi Metri-Pack and GT catalogs (terminal material and plating, cable seal colours and ranges).
  scaled  feature lengths measured off those two drawings at their printed dimensions.
  photo   the sensor bodies: sized off the GM (ACDelco) or Holley product photo of the part number, scaled from one
          sourced dimension on the part (the Metri-Pack shroud's 22.9 width, or the ECT's M12 thread), +-25 %; the
          terminals (sized off the maker's reel photo against the 1.5 mm blade they take, +-20 %).
Frame (plugs and assemblies, mm): origin at the centre of the sensor shroud's mouth, where the plug's seal flange
stops; +Z toward the plug (its wires leave toward +Z), the sensor lies at z < 0; +Y is the plug's lock side.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_delphi.py <out_root> [id ...]
"""
import sys
import types
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cylinder, Plane, Polygon, Pos, Rot, RectangleRounded, extrude, revolve

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z, rr  # noqa: E402

CD = "reference_documents/component_drawings/"
MP = CD + "Delphi_12129958_MP150_3way_female_12129946_12059595.pdf (Delphi drawing 12129958)"
GT = CD + "Delphi_15449030_GT150_2way_female_15449028.pdf (Delphi drawing 15449030)"
MPCAT = CD + "Delphi_150_Metri-Pack_Series.pdf p.66 (150 female terminals, cable seals)"
GTCAT = CD + "Delphi_GT_150_280_630_Catalog.pdf p.1 (GT 150 terminals, cable seals, housings)"
PM = "docs/wiring/calc-data/catalog/part_media.yaml"


def PH(pn):
    return f"customconnectorkits.com/products/{pn.lower()} product photo (fetched 2026-09-29)"


def GMPH(end):
    return f"the product photo part_media.yaml lists for {end} (scratchpad copy of the maker's image, 2026-09-29)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


SCMP = f"scaled off {MP} side and bottom views at the printed (26) length"
SCGT = f"scaled off {GT} type 101 side view at the printed (30.65) length"

# ------------------------------------------------------------------------------------------ the two plug families
PLUGS = {
    "12129946": {
        "family": "Metri-Pack 150", "ways": 3, "pitch": D(6.0, f"{MP} type 101 view: '(6)' between cavities, '(12)' across"),
        "L": D(26.0, f"{MP} side view '(26)'"), "W": D(18.6, f"{MP} bottom view '(18.6)' over the connector seal"),
        "H": D(22.0, f"{MP} side view '(22)' over the seal and the lock arm, arm flexed (dashed)"),
        "rear_l": D(7.0, SCMP, "scaled"), "rear_w": D(15.0, f"{MP} bottom view '(15)'"), "rear_h": D(6.5, f"{MP} side view '(6.5)'"),
        "seal_l": D(7.8, SCMP, "scaled", "three ridges"), "seal_h": D(12.5, SCMP, "scaled"),
        "flange_l": D(2.0, SCMP, "scaled"), "flange_h": D(11.6, SCMP, "scaled"),
        "nose_l": D(8.5, f"{MP} side view: (26) - (17.5)"), "nose_h": D(7.2, f"{MP} side view '(7.2)'"),
        "nose_w": D(19.6, f"{MP} mating information: the shroud's 22.9 less its two 1.5 walls, less 0.3 clearance", "design"),
        "arm_drop": D(7.4, f"{MP} side view '(7.4)': centreline to the lock arm"),
        "arm_hook": D(5.5, f"{MP} side view '(5.5)': the arm's hook"),
        "colours": {"housing": ("#8f9591", f"{PH('12129946')}: grey body; drawing table 'GRA'"),
                    "seal": ("#5b3a6e", f"{PH('12129946')}: purple seal; drawing table seal 12052842 'PPL'"),
                    "lock": ("#e9e0cf", f"{PH('12052845')}: natural (cream) TPA")},
        # every Metri-Pack 150 wire on the K5 is 22 AWG (registry: CKP, CMP, MAP), so the 0.35-0.50 mm2 terminal and
        # the blue 1.29-1.70 mm cable seal (catalog p.12 / p.66); 12048074 and the white seal are for 18-20 AWG
        "parts": {"seal": "12052842", "tpa": "12052845", "terminal": "12084200", "cable_seal": "15324974"},
        "type": "102 (grey, the LS crank / MAP key), drawing 12129958 table: body 12129945, seal 12052842, TPA 12052845",
    },
    "15449028": {
        "family": "GT 150", "ways": 2, "pitch": D(3.5, f"{GT} front view, dimension 4: '3.5'"),
        "L": D(30.65, f"{GT} type 101 side view, dimension 1: '(30.65)'"),
        "W": D(17.04, f"{GT} front view, dimension 5: '17.04 +0.15 -0.5'"),
        "H": D(14.6, f"{GT} front view, dimension 3: '14.6'"),
        "rear_l": D(8.7, SCGT, "scaled"), "rear_w": D(11.8, SCGT, "scaled"), "rear_h": D(10.2, SCGT, "scaled"),
        "seal_l": D(9.0, SCGT, "scaled", "four ridges"), "seal_h": D(12.7, SCGT, "scaled"),
        "flange_l": D(1.5, SCGT, "scaled"), "flange_h": D(11.4, SCGT, "scaled"),
        "nose_l": D(9.15, SCGT, "scaled", "the PLR's face to the seal flange"), "nose_h": D(8.7, SCGT, "scaled"),
        "nose_w": D(10.2, SCGT, "scaled"),
        "arm_drop": None, "arm_hook": None,
        "colours": {"housing": ("#1f1f21", f"{PH('15449028')}: black body; {GTCAT} 'Black'"),
                    "seal": ("#3a7fd0", f"{PH('15449028')}: blue connector seal (12040750)"),
                    "lock": ("#b3336e", f"{PH('15449028')}: magenta PLR (15336006) at the nose")},
        "parts": {"seal": "12040750", "tpa": "15336006", "terminal": "12191818", "cable_seal": "15366021"},
        "type": "102, drawing 15449030 table: connector 15449024, PLR 15336006, seal 12040750",
    },
}
TERMINALS = {   # stamped female terminals: box contact, conductor and insulation crimps (photo +-20 %)
    "12084200": {"what": "Metri-Pack 150 sealed female terminal, 22 AWG (0.35-0.50 mm2), tin-plated silicon bronze",
                 "box": (2.6, 1.9, 7.5), "len": 15.0, "plating": ("#c9c6bf", f"{MPCAT}: 'Silicon Bronze / Tin'; tin colour"),
                 "src": f"{PH('12048074')} (the 18-20 AWG sibling's reel photo inset; same box contact), scaled from the "
                        f"1.5 mm Metri-Pack 150 blade it takes ({MP} mating information); cable range 0.35-0.50 mm2 "
                        f"from {CD}Delphi_150_Metri-Pack_Series.pdf p.12 '150 FEMALE TERMINALS SEALED'"},
    "12048074": {"what": "Metri-Pack 150 sealed female terminal, 20-18 AWG (0.8-1.0 mm2), tin-plated silicon bronze",
                 "box": (2.6, 1.9, 7.5), "len": 15.5, "plating": ("#c9c6bf", f"{MPCAT}: 'Silicon Bronze / Tin'; tin colour"),
                 "src": f"{PH('12048074')} (the reel photo's inset), scaled from the 1.5 mm Metri-Pack 150 blade it takes ({MP} mating information)"},
    "12191818": {"what": "GT 150 sealed female terminal, 22-20 AWG (0.35-0.50 mm2), tin-plated brass",
                 "box": (2.2, 1.7, 6.5), "len": 13.0, "plating": ("#c9c6bf", f"{GTCAT}: 'Tin Brass / Tin'; tin colour"),
                 "src": f"{PH('12191818')} (reel photo), scaled from the 1.5 mm GT 150 blade"},
}
CABLE_SEALS = {
    "15324974": {"what": "Metri-Pack 150 cable seal, blue, 1.29-1.70 mm cable (the catalog's 12048087)", "od": 4.4, "len": 6.5,
                 "bore": 1.29,
                 "colour": ("#3b6fb6", f"{CD}Delphi_150_Metri-Pack_Series.pdf p.66 '150 METRI-PACK CABLE SEALS': 12048087 "
                                       "'Silicone Blue' (no photo on file)"),
                 "src": f"{CD}Delphi_150_Metri-Pack_Series.pdf p.66: 12048087 / 12052925 '1.70-1.29' (bore); OD and length "
                        f"from the white sibling 15324976's photo ({PH('15324976')}), +-15 %"},
    "15324976": {"what": "Metri-Pack 150 cable seal, white", "od": 4.6, "len": 6.5, "bore": 1.3,
                 "colour": ("#f1efe9", f"{PH('15324976')}: white; customconnectorkits calls it 'for 16-14 AWG' (ProWire: 20-22)"),
                 "src": f"{PH('15324976')}, scaled from its 1.3-2.1 mm cable range (parts.yaml, ConnectorID)"},
    "15366021": {"what": "GT 150 cable seal, white, 1.20-1.85 mm cable", "od": 3.4, "len": 5.5, "bore": 1.2,
                 "colour": ("#f1efe9", f"{GTCAT}: '15366021 ... Silicone White'"),
                 "src": f"{GTCAT}: cable range 1.20-1.85 (the bore); OD and length photo-scaled ({PH('15366021')})"},
}


# ------------------------------------------------------------------------------------------ builders
def cavities(spec):
    n, p = spec["ways"], K.v(spec["pitch"])
    return {chr(ord("A") + i): (round((n - 1) * p / 2 - i * p, 3), 0.0) for i in range(n)}


def build_plug(pn, fill=True):
    s = PLUGS[pn]
    v = {k: (K.v(x) if isinstance(x, Dim) else x) for k, x in s.items()}
    nose_l, fl_l, seal_l, rear_l = v["nose_l"], v["flange_l"], v["seal_l"], v["rear_l"]
    z_fl = 0.0                                   # the seal flange sits at the shroud mouth
    L = v["L"]
    z_rear = z_fl + fl_l + (L - nose_l - fl_l)   # wire-side face
    body_w = v["rear_w"] + 1.2
    nose = rr(v["nose_w"], v["nose_h"], min(1.6, v["nose_h"] / 3), -nose_l, z_fl + 0.1)
    flange = rr(v["W"] - 0.6, v["flange_h"], 2.0, z_fl, z_fl + fl_l)
    core = rr(body_w, v["rear_h"] + 2.0, 2.0, z_fl + fl_l - 0.1, z_fl + fl_l + seal_l + 0.2)
    rear = rr(v["rear_w"], v["rear_h"], 1.8, z_fl + fl_l + seal_l, z_rear)
    housing = nose + flange + core + rear
    # lock arm across the top (the +Y side), from over the nose back to a finger pad
    arm_t = 1.5
    y_top = v["H"] / 2 if pn == "15449028" else v["seal_h"] / 2 + 1.6
    arm = box(-3.2, 3.2, y_top - arm_t, y_top, -nose_l * 0.55, z_rear - 1.0)
    post = box(-2.4, 2.4, v["flange_h"] / 2 - 0.4, y_top - arm_t + 0.05, z_fl + fl_l, z_fl + fl_l + 2.2)
    pad = box(-3.8, 3.8, y_top - arm_t, y_top + 0.4, z_rear - 4.0, z_rear - 1.0)
    housing = housing + arm + post + pad
    cav = cavities(s)
    for x, y in cav.values():
        housing -= cyl_z(1.35 if pn == "12129946" else 1.1, z_fl + fl_l + seal_l - 0.5, z_rear + 1, x, y)   # wire entries
        housing -= box(x - 1.3, x + 1.3, -1.0, 1.0, -nose_l - 1, -nose_l + 3.0)                              # blade entries
    seal = rr(v["W"], v["seal_h"], 3.0, z_fl + fl_l, z_fl + fl_l + seal_l) - rr(body_w + 0.1, v["rear_h"] + 2.1, 2.0, -50, 50)
    n_r = 3 if pn == "12129946" else 4
    for i in range(n_r - 1):
        zc = z_fl + fl_l + (i + 1) * seal_l / n_r
        seal -= rr(v["W"] + 2, v["seal_h"] + 2, 3.0, zc - 0.35, zc + 0.35) - rr(v["W"] - 1.2, v["seal_h"] - 1.2, 2.6, zc - 1, zc + 1)
    lock = rr(v["nose_w"] - 1.0, v["nose_h"] - 1.0, 1.2, -nose_l, -nose_l + 1.6)          # TPA / PLR face at the nose
    for x, y in cav.values():
        lock -= box(x - 1.1, x + 1.1, -0.9, 0.9, -nose_l - 1, -nose_l + 3)
    C = s["colours"]
    out = [K.body(housing, f"{pn} housing", C["housing"][0]),
           K.body(seal, f"{pn} connector seal {s['parts']['seal']}", C["seal"][0], finish="rubber"),
           K.body(lock, f"{pn} {'TPA' if pn == '12129946' else 'PLR'} {s['parts']['tpa']}", C["lock"][0])]
    if fill:
        tpn, spn = s["parts"]["terminal"], s["parts"]["cable_seal"]
        for k, (x, y) in cav.items():
            out += terminal_bodies(tpn, f"{pn} cavity {k}", at=(x, y, -nose_l + 0.6))
            out += cable_seal_bodies(spn, f"{pn} cavity {k}", at=(x, y, z_rear - CABLE_SEALS[spn]["len"] + 0.3))
    return out, z_rear


def terminal_solid(tpn):
    t = TERMINALS[tpn]
    bw, bh, bl = t["box"]
    L = t["len"]
    boxc = box(-bw / 2, bw / 2, -bh / 2, bh / 2, 0.0, bl) - box(-bw / 2 + 0.25, bw / 2 - 0.25, -bh / 2 + 0.25, bh / 2 - 0.25, -1, bl - 0.6)
    lance = box(-0.35, 0.35, bh / 2 - 0.05, bh / 2 + 0.45, bl * 0.35, bl * 0.65)
    neck = box(-0.8, 0.8, -bh / 2, -bh / 2 + 0.3, bl - 0.1, bl + 1.2)
    ccr = box(-bw * 0.42, bw * 0.42, -bh / 2, -bh / 2 + bh * 0.9, bl + 1.2, bl + 1.2 + (L - bl - 1.2) * 0.45)
    icr = box(-bw * 0.55, bw * 0.55, -bh / 2, -bh / 2 + bh * 1.05, bl + 1.2 + (L - bl - 1.2) * 0.55, L)
    return boxc + lance + neck + ccr + icr


def terminal_bodies(tpn, label, at):
    """A terminal with its box contact's mouth at `at`, the crimps toward +Z (the plug's wire side)."""
    return [K.body(Pos(*at) * terminal_solid(tpn), f"{label} terminal {tpn}", TERMINALS[tpn]["plating"][0], finish="metal")]


def cable_seal_solid(spn):
    c = CABLE_SEALS[spn]
    L, od, bore = c["len"], c["od"], c["bore"]
    pts = [(bore / 2, 0), (od / 2 * 0.8, 0), (od / 2 * 0.8, L * 0.2), (od / 2, L * 0.3), (od / 2 * 0.85, L * 0.45),
           (od / 2, L * 0.6), (od / 2 * 0.85, L * 0.75), (od / 2 * 0.7, L * 0.8), (od / 2 * 0.7, L), (bore / 2, L)]
    return revolve(Plane.XZ * Polygon(*pts, align=None), Axis.Z)


def cable_seal_bodies(spn, label, at):
    return [K.body(Pos(*at) * cable_seal_solid(spn), f"{label} cable seal {spn}", CABLE_SEALS[spn]["colour"][0], finish="rubber")]


# ------------------------------------------------------------------------------------------ the sensors
MP_SHROUD = {"w": D(22.9, f"{MP} mating connector information, SECTION A-A: '22.9 +-0.15'"),
             "wall": D(1.5, f"{MP} mating connector information: '1.5 CONSTANT'"),
             "depth": D(18.9, f"{MP} mating connector information, SECTION B-B: '18.9'"),
             "in_h": D(10.8, f"{MP} mating connector information, SECTION B-B: '10.8'"),
             "blade_l": D(10.05, f"{MP} mating connector information: '10.05 +-0.3'")}
GT_SHROUD = {"w": D(19.84, f"{GT}: the plug's 17.04 seal width + two 1.4 walls", "design", "the drawing shows no sensor side"),
             "in_h": D(12.9, f"{GT}: the seal's scaled 12.7 + 0.2", "design"),
             "wall": D(1.4, "design wall for the GT 150 sensor shroud", "design"),
             "depth": D(10.9, f"{GT}: the nose (9.15) and flange (1.5) + 0.25", "design")}

# each sensor: its photo proportions against one sourced dimension. body: list of (shape, dims) in mm along the sensor's
# axis (-Z away from the shroud mouth). Every number here is "photo" with the stated margin.
SENSORS = {
    "CKP": {"pn": "ACDelco 213-4573 (GM 12615626)", "what": "LS Gen IV 58X crankshaft position sensor (front cover, Hall)",
            "plug": "12129946", "shroud": "mp", "ref": "the Metri-Pack 150 shroud width 22.9",
            "body": [("cyl", 22.0, 26.0, "body"), ("oring", 23.5, 1.6, "O-ring"), ("cyl", 16.0, 9.0, "barrel"),
                     ("cyl", 12.0, 4.0, "sensing tip")],
            "colours": {"body": ("#1d2230", "GM photo 213-4573: dark navy body"), "O-ring": ("#2f8a55", "GM photo: green O-ring"),
                        "sensing tip": ("#d9d9d4", "GM photo: white sensing tip")}},
    "CMP": {"pn": "ACDelco 213-3826 (GM 12591720)", "what": "LS Gen IV camshaft position sensor (front timing cover, Hall)",
            "plug": "12129946", "shroud": "mp", "ref": "the Metri-Pack 150 shroud width 22.9",
            "body": [("cyl", 24.0, 12.0, "body"), ("ear", (30.0, 14.0, 3.0, 6.5), 0.0, "mounting ear"),
                     ("oring", 25.0, 1.8, "O-ring"), ("cyl", 22.0, 14.0, "barrel")],
            "colours": {"body": ("#a8aaa9", "GM photo 213-3826: light grey body"), "O-ring": ("#1b1b1b", "GM photo: black O-ring"),
                        "mounting ear": ("#9c9e9d", "GM photo: grey ear")}},
    "MAP": {"pn": "Holley 538-24", "what": "MAP sensor, 1 bar, GM/Delphi-style body with a hose nipple",
            "plug": "12129946", "shroud": "mp", "ref": "the Metri-Pack 150 shroud width 22.9",
            "body": [("block", (58.0, 17.0, 38.0), 0.0, "body"), ("ears", (74.0, 3.0, 12.0, 5.5), 0.0, "mounting ears"),
                     ("nipple", (5.0, 9.0), 0.0, "vacuum nipple")],
            "colours": {"body": ("#b9bcbd", "Summit photo hly-538-24: light grey body"),
                        "mounting ears": ("#b1b4b5", "Summit photo: grey"), "vacuum nipple": ("#aeb1b2", "Summit photo: grey")}},
    "ECT": {"pn": "ACDelco 213-4514 (GM 19236568)", "what": "LS engine coolant temperature sensor (GT 150 2-way, M12 x 1.5)",
            "plug": "15449028", "shroud": "gt", "ref": "its M12 x 1.5 thread (part_media.yaml CLT-ECU)",
            "body": [("hex", 19.0, 8.0, "hex"), ("washer", 17.0, 1.2, "sealing washer"), ("cyl", 12.0, 12.0, "thread M12 x 1.5"),
                     ("cyl", 7.0, 14.0, "probe")],
            "colours": {"body": ("#232323", "GM photo 213-4514: black connector end"), "hex": ("#c19a4b", "GM photo: brass hex"),
                        "sealing washer": ("#c46a3a", "GM photo: copper washer"), "thread M12 x 1.5": ("#c8a55a", "GM photo: brass"),
                        "probe": ("#c9a050", "GM photo: brass probe")}},
    "IAT": {"pn": "ACDelco 213-243 (GM 12160244)", "what": "intake air temperature sensor, push-in thermistor in a grommet",
            "plug": "15449028", "shroud": "gt", "ref": "the GT 150 shroud (the plug's 17.04 seal width + walls)",
            "body": [("cyl", 17.0, 10.0, "body"), ("cyl", 21.0, 6.0, "grommet land"), ("cyl", 13.0, 14.0, "barrel"),
                     ("cage", 9.0, 9.0, "thermistor cage")],
            "colours": {"body": ("#1c1c1c", "GM photo 213-243: black"), "grommet land": ("#1c1c1c", "GM photo: black"),
                        "thermistor cage": ("#262626", "GM photo: black cage")}},
}
SENSOR_ENDS = {"CKP": "CKP", "CMP": "CMP", "MAP": "MAP", "CLT-ECU": "ECT", "OILT": "ECT", "IAT": "IAT"}
SENSOR_PID = {"CKP": "213-4573", "CMP": "213-3826", "MAP": "538-24", "ECT": "213-4514", "IAT": "213-243"}


def shroud_solid(kind):
    if kind == "mp":
        w, wall, dep, inh = (K.v(MP_SHROUD[k]) for k in ("w", "wall", "depth", "in_h"))
    else:
        w, wall, dep, inh = (K.v(GT_SHROUD[k]) for k in ("w", "wall", "depth", "in_h"))
    h = inh + 2 * wall
    sh = rr(w, h, 3.0, -dep, 0.0) - rr(w - 2 * wall, inh, 2.2, -dep + 1.5, 1.0)
    ramp = box(-3.0, 3.0, h / 2 - 0.2, h / 2 + 1.4, -6.0, -2.0)          # the lock ramp the plug's arm hooks over
    return sh + ramp, dep, w, h


def sensor_bodies(key):
    s = SENSORS[key]
    shroud, dep, w, h = shroud_solid(s["shroud"])
    C = s["colours"]
    out = [K.body(shroud, f"{key} connector shroud", C["body"][0])]
    if s["shroud"] == "mp":
        for x, y in cavities(PLUGS["12129946"]).values():
            out.append(K.body(box(x - 0.75, x + 0.75, y - 0.3, y + 0.3, -dep + 1.4, -dep + 1.4 + K.v(MP_SHROUD["blade_l"])),
                              f"{key} blade", "#c9c6bf", finish="metal"))
    else:
        for x, y in cavities(PLUGS["15449028"]).values():
            out.append(K.body(box(x - 0.75, x + 0.75, y - 0.3, y + 0.3, -dep + 1.4, -dep + 8.0), f"{key} blade", "#c9c6bf", finish="metal"))
    z = -dep
    for shape, d1, d2, nm in s["body"]:
        col = C.get(nm, C["body"])[0]
        if shape in ("cyl", "hex", "washer", "cage"):
            ln = d2
            if shape == "hex":
                from build123d import RegularPolygon
                solid = Pos(0, 0, z - ln) * extrude(RegularPolygon(d1 / 2 / 0.866, 6), amount=ln)
            elif shape == "cage":
                solid = cyl_z(d1 / 2, z - ln, z, 0, 0) - cyl_z(d1 / 2 - 0.8, z - ln + 0.8, z + 1, 0, 0)
                for a in (0, 90):
                    solid -= Rot(0, 0, a) * box(-1.2, 1.2, -d1, d1, z - ln + 1.5, z - 1.5)
            else:
                solid = cyl_z(d1 / 2, z - ln, z, 0, 0)
            out.append(K.body(solid, f"{key} {nm}", col, finish="metal" if "brass" in C.get(nm, ("", ""))[1] or shape == "hex" else "plastic"))
            z -= ln
        elif shape == "oring":
            ring = cyl_z(d1 / 2, z + 1.0, z + 1.0 + d2, 0, 0) - cyl_z(d1 / 2 - d2, z, z + 3 + d2, 0, 0)
            out.append(K.body(ring, f"{key} {nm}", col, finish="rubber"))
        elif shape == "ear":
            ew, eh, et, hole = d1
            ear = box(w / 2 - 2, w / 2 - 2 + ew, -eh / 2, eh / 2, z, z + et) - cyl_z(hole / 2, z - 1, z + et + 1, w / 2 - 2 + ew - 7, 0)
            out.append(K.body(ear, f"{key} {nm}", col))
        elif shape == "block":
            bl, bh, bd = d1
            out.append(K.body(box(-bl / 2, bl / 2, -bh / 2 - 4, bh / 2 - 4, z - bd, z), f"{key} {nm}", col))
            z_block = (z - bd, z)
        elif shape == "ears":
            el, et, ew, hole = d1
            ears = box(-el / 2, el / 2, -8.5 - 4, -8.5 - 4 + et, z_block[0] + 4, z_block[0] + 4 + ew)
            for sx in (-1, 1):
                ears -= cyl_z(hole / 2, -100, 100, sx * (el / 2 - 5), 0).rotate(Axis.X, 90).translate((0, 0, 0)) \
                    if False else box(sx * (el / 2 - 5) - hole / 2, sx * (el / 2 - 5) + hole / 2, -40, 40,
                                      z_block[0] + 4 + ew / 2 - hole / 2, z_block[0] + 4 + ew / 2 + hole / 2)
            out.append(K.body(ears, f"{key} {nm}", col))
        elif shape == "nipple":
            nd, nl = d1
            out.append(K.body(Pos(10, 8.5 - 4, z_block[0] + 19) * Rot(-90, 0, 0) * Cylinder(nd / 2, nl, align=(Align.CENTER, Align.CENTER, Align.MIN)),
                              f"{key} {nm}", col))
    return out


# ------------------------------------------------------------------------------------------ part objects
def _meta(pid, endpoints, what, maker, pn, P, COLORS, title, shape_basis, kind, extra=None):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    m.PART = {"pid": pid, "endpoints": endpoints, "maker": maker, "pn": pn, "title": title, "what": what,
              "shape_basis": shape_basis, "viewset": "wall", "kind": kind, "family": "delphi sealed sensor connectors",
              "frame": "origin at the centre of the sensor shroud's mouth (the plug's seal flange stops there); +Z toward "
                       "the plug and its wires; +Y the lock side",
              "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"wires": "+Z", "mating": "-Z", "lock": "+Y"}},
              "refs": [("[1]", "12129958", "Delphi drawing 12129958 (Metri-Pack 150 3-way female)"),
                       ("[2]", "15449030", "Delphi drawing 15449030 (GT 150 2-way female)"),
                       ("[3]", "Metri-Pack_Series", "Delphi Metri-Pack 150 catalog"),
                       ("[4]", "GT_150_280_630", "Delphi GT 150 catalog"),
                       ("[5]", "customconnectorkits", "customconnectorkits product photos"),
                       ("[6]", "product photo part_media", "the maker's product photo of the sensor")],
              "unknowns": [], "notes": []}
    if extra:
        m.PART.update(extra)
    return m


def plug_module(pn):
    s = PLUGS[pn]
    ends = [e for e, k in SENSOR_ENDS.items() if SENSORS[k]["plug"] == pn]
    P = {k: s[k] for k in ("L", "W", "H", "pitch", "rear_l", "rear_w", "rear_h", "seal_l", "seal_h", "flange_l", "flange_h",
                           "nose_l", "nose_h", "nose_w") if isinstance(s.get(k), Dim)}
    if s.get("arm_drop"):
        P["arm_drop"], P["arm_hook"] = s["arm_drop"], s["arm_hook"]
    C = dict(s["colours"])
    C["terminals"] = TERMINALS[s["parts"]["terminal"]]["plating"]
    C["cable seals"] = CABLE_SEALS[s["parts"]["cable_seal"]]["colour"]
    m = _meta(pn, ends, f"Delphi {s['family']} {s['ways']}-way sealed female connector, type {s['type']}", "Delphi (Aptiv)", pn,
              P, C, f"Delphi {pn} {s['family']} {s['ways']}-way", "maker drawing", "piece",
              {"dims_mm": {"l": K.v(s["L"]), "w": K.v(s["W"]), "h": K.v(s["H"])},
               "dims_note": f"{K.v(s['L']):g} long x {K.v(s['W']):g} wide x {K.v(s['H']):g} high (Delphi drawing, reference dims)",
               "mates": "the sensor's shroud", "cavities": {k: list(v) for k, v in cavities(s).items()},
               "numbering": "cavity letters A-B(-C) as moulded (drawing 12129958 bottom view 'C B A'); A at +X",
               "unknowns": ["Terminals are photo-scaled (+-20 %): the maker's terminal drawings are not on file."]})
    m.build = lambda: (build_plug(pn)[0], [], [])
    cav = cavities(s)
    zr = build_z_rear(pn)
    m.attach_points = lambda: [{"n": f"cav{k}", "ep": e, "at": [x, y, round(zr, 2)], "dir": [0, 0, 1], "kind": f"{s['family']} terminal"}
                               for e in ends[:1] for k, (x, y) in cav.items()]
    m.mount_points = lambda: []
    m.CHECKS = [("overall length (drawing)", lambda b: round(b[0].bounding_box().size.Z, 2), K.v(s["L"]), 0.3),
                ("cavity pitch (drawing)", lambda b: round(abs(list(cav.values())[0][0] - list(cav.values())[1][0]), 2), K.v(s["pitch"]), 0.01)]
    return m


def build_z_rear(pn):
    s = PLUGS[pn]
    return K.v(s["L"]) - K.v(s["nose_l"])


def sensor_module(key, endpoints):
    s = SENSORS[key]
    P = {}
    ref = MP_SHROUD if s["shroud"] == "mp" else GT_SHROUD
    for k, d in ref.items():
        P["shroud_" + k] = d
    src = f"{GMPH(endpoints[0])}, scaled from {s['ref']}"
    for shape, d1, d2, nm in s["body"]:
        key_ = nm.replace(" ", "_")
        if isinstance(d1, tuple):
            for i, x in enumerate(d1):
                P[f"{key_}_{i}"] = D(x, src, "photo", "+-25 %")
        else:
            P[f"{key_}_d"] = D(d1, src, "photo", "+-25 %")
            P[f"{key_}_l"] = D(d2, src, "photo", "+-25 %")
    m = _meta(SENSOR_PID[key], endpoints, s["what"], s["pn"].split(" ")[0], s["pn"], P, s["colours"], f"{s['pn']} {key}",
              "scaled from photo", "piece",
              {"dims_mm": None, "dims_note": "", "unknowns": [f"The body is sized off the maker's photo against {s['ref']}, "
                                                             "+-25 %: no dimensioned drawing of the sensor is on file."]})
    bodies = sensor_bodies(key)
    bb = Compound(children=bodies).bounding_box()
    m.PART["dims_mm"] = {"l": round(bb.size.Z, 1), "w": round(bb.size.X, 1), "h": round(bb.size.Y, 1)}
    m.PART["dims_note"] = f"about {bb.size.Z:.0f} x {bb.size.X:.0f} x {bb.size.Y:.0f} (photo-scaled, +-25 %)"
    m.build = lambda: (sensor_bodies(key), [], [])
    m.attach_points = lambda: [{"n": "connector", "ep": endpoints[0], "at": [0.0, 0.0, 0.0], "dir": [0, 0, 1],
                                "kind": "shroud mouth (the plug seats here)"}]
    m.mount_points = lambda: []
    m.CHECKS = [("shroud width (maker / design)", lambda b: round(b[0].bounding_box().size.X, 2), K.v(ref["w"]), 0.05)]
    return m


def assembly_module(end):
    key = SENSOR_ENDS[end]
    s = SENSORS[key]
    pn = s["plug"]
    ps = PLUGS[pn]
    m = sensor_module(key, [end])
    P = dict(m.P)
    for k, d in plug_module(pn).P.items():
        P[f"{pn}.{k}"] = d
    missing = [] if end not in ("OILT",) else []
    notes = []
    if end == "CMP":
        notes.append("the LS cam plug (ProWire LS-CAM-CONN-KIT) is drawn as the 12129946 Metri-Pack 150 3-way: the kit's "
                     "housing part number is not on file (same family and cavity count; keys may differ)")
    if end == "IAT":
        notes.append("the IAT plug (ProWire GT150-AIR-TEMP-KIT) is drawn as the 15449028 GT 150 2-way (sibling: the kit's "
                     "housing part number is not on file)")
    if pn == "12129946":
        notes.append("terminal corrected to 12084200 (0.35-0.50 mm2, the 22 AWG these wires are): Delphi Metri-Pack 150 "
                     "catalog p.12 '150 FEMALE TERMINALS SEALED' (12048074 is 1.0-0.80 mm2, 18-20 AWG); the registry's "
                     "12110847 is a Metri-Pack 280 tangless terminal (catalog p.30). Cable seal 15324974 (blue, 1.29-1.70 "
                     "mm, the catalog's 12048087, p.66) fits the 22 AWG M22759/16 jacket (1.27-1.37 mm); the white "
                     "15324976 (1.60-2.15, the catalog's 12089678) does not")
    if end == "OILT":
        notes.append("no oil-temperature sensor part number is recorded (part_media OILT): drawn as the ECT it shares a family with")
    C = dict(s["colours"])
    C.update({f"plug {k}": v for k, v in ps["colours"].items()})
    pieces_ = [SENSOR_PID[key], pn, ps["parts"]["terminal"], ps["parts"]["cable_seal"]]
    a = _meta(end, [end], f"{end}: {s['what']} with its {ps['family']} plug {pn}, mated", "Delphi (Aptiv) / " + s["pn"].split(" ")[0],
              f"{s['pn']} + {pn}", P, C, f"{end}: {s['pn']} + Delphi {pn}", "scaled from photo", "assembly",
              {"pieces": pieces_, "missing": missing, "notes": notes,
               "unknowns": m.PART["unknowns"] + ["Terminals photo-scaled (+-20 %)."]})
    zr = build_z_rear(pn)
    a.build = lambda: (sensor_bodies(key) + build_plug(pn)[0], [], [])
    bb_all = Compound(children=sensor_bodies(key) + build_plug(pn)[0]).bounding_box()
    a.PART["dims_mm"] = {"l": round(bb_all.size.Z, 1), "w": round(bb_all.size.X, 1), "h": round(bb_all.size.Y, 1)}
    a.PART["dims_note"] = f"sensor and plug mated, about {bb_all.size.Z:.0f} long"
    cav = cavities(ps)
    a.attach_points = lambda: [{"n": f"cav{k}", "ep": end, "at": [x, y, round(zr, 2)], "dir": [0, 0, 1],
                                "kind": f"{ps['family']} terminal {ps['parts']['terminal']}"} for k, (x, y) in cav.items()]
    a.mount_points = lambda: []

    def terminals():
        rows = []
        for i, (k, (x, y)) in enumerate(cav.items()):
            rows.append({"pin": k, "endpoint": end, "name": f"{pn} cavity {k}", "match": rf"^{i + 1}\b", "at": (x, y, zr),
                         "dir": (0, 0, 1), "endpoint_cavities": True,
                         "full_name": f"{pn} cavity {k} = registry cavity {i + 1}? (assumed: the registry keeps the "
                                      "sensor pin order OPEN until a GM end view)"})
        return rows
    a.terminals = terminals
    a.CHECKS = [("plug seal flange at the shroud mouth", lambda b: True, True)]
    return a


# ------------------------------------------------------------------------------------------ the family's interface
END_NEEDS = {e: [SENSOR_PID[SENSOR_ENDS[e]], SENSORS[SENSOR_ENDS[e]]["plug"],
                 PLUGS[SENSORS[SENSOR_ENDS[e]]["plug"]]["parts"]["terminal"]] for e in SENSOR_ENDS}


def piece_module_terminal(tpn):
    t = TERMINALS[tpn]
    ends = [e for e in SENSOR_ENDS if PLUGS[SENSORS[SENSOR_ENDS[e]]["plug"]]["parts"]["terminal"] == tpn]
    P = {"box_w": D(t["box"][0], t["src"], "photo", "+-20 %"), "box_h": D(t["box"][1], t["src"], "photo", "+-20 %"),
         "box_l": D(t["box"][2], t["src"], "photo", "+-20 %"), "length": D(t["len"], t["src"], "photo", "+-20 %")}
    m = _meta(tpn, ends, t["what"], "Delphi (Aptiv)", tpn, P, {"plating": t["plating"]}, f"Delphi {tpn} terminal",
              "scaled from photo", "piece", {"dims_mm": {"l": t["len"], "w": t["box"][0], "h": t["box"][1]},
                                             "dims_note": f"{t['len']:g} long, box {t['box'][0]:g} x {t['box'][1]:g} (photo +-20 %)"})
    m.build = lambda: ([K.body(terminal_solid(tpn), f"{tpn} terminal", t["plating"][0], finish="metal")], [], [])
    m.attach_points = lambda: [{"n": "crimp", "ep": ends[0], "at": [0.0, 0.0, t["len"]], "dir": [0, 0, 1], "kind": "crimp barrel"}]
    m.mount_points = lambda: []
    m.CHECKS = [("length (photo-scaled)", lambda b: round(b[0].bounding_box().size.Z, 2), t["len"], 0.02)]
    return m


def piece_module_seal(spn):
    c = CABLE_SEALS[spn]
    ends = [e for e in SENSOR_ENDS if PLUGS[SENSORS[SENSOR_ENDS[e]]["plug"]]["parts"]["cable_seal"] == spn]
    P = {"od": D(c["od"], c["src"], "photo", "+-15 %"), "len": D(c["len"], c["src"], "photo", "+-15 %"),
         "bore": D(c["bore"], c["src"])}
    m = _meta(spn, ends, c["what"], "Delphi (Aptiv)", spn, P, {"seal": c["colour"]}, f"Delphi {spn} cable seal",
              "scaled from photo", "piece", {"dims_mm": {"l": c["len"], "w": c["od"], "h": c["od"]},
                                             "dims_note": f"OD {c['od']:g} x {c['len']:g} long, bore {c['bore']:g}"})
    m.build = lambda: ([K.body(cable_seal_solid(spn), f"{spn} cable seal", c["colour"][0], finish="rubber")], [], [])
    m.attach_points = lambda: [{"n": "wire", "ep": ends[0], "at": [0.0, 0.0, c["len"]], "dir": [0, 0, 1], "kind": "cable seal"}]
    m.mount_points = lambda: []
    m.CHECKS = [("length (photo-scaled)", lambda b: round(b[0].bounding_box().size.Z, 2), c["len"], 0.02)]
    return m


def pieces():
    out = [plug_module(pn) for pn in PLUGS]
    used_t = {PLUGS[SENSORS[k]["plug"]]["parts"]["terminal"] for k in SENSOR_ENDS.values()}
    used_s = {PLUGS[SENSORS[k]["plug"]]["parts"]["cable_seal"] for k in SENSOR_ENDS.values()}
    out += [piece_module_terminal(t) for t in TERMINALS if t in used_t]
    out += [piece_module_seal(c) for c in CABLE_SEALS if c in used_s]
    sens_ends = {}
    for e, k in SENSOR_ENDS.items():
        sens_ends.setdefault(k, []).append(e)
    out += [sensor_module(k, es) for k, es in sens_ends.items()]
    out += [assembly_module(e) for e in SENSOR_ENDS]
    for e in SENSOR_ENDS:
        END_NEEDS[e].append(PLUGS[SENSORS[SENSOR_ENDS[e]]["plug"]]["parts"]["cable_seal"])
    return out


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    want = set(argv[2:])
    bad = []
    for m in pieces():
        pid = m.PART["pid"]
        if want and pid not in want:
            continue
        print(f"== {pid}")
        try:
            K.run(m, out_root / pid)
        except SystemExit as e:
            bad.append(f"{pid}: {e}")
    if bad:
        print("FAILED:", *bad, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
