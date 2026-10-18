#!/usr/bin/env python3
"""Brake booster: Bosch iBooster Gen 1, Tesla Model S/X 1037123-00-B (1037123-00-A is the same housing), with its master
cylinder and reservoir.

Which generation is drawn: Gen 1. The registry names 1037123-00-B, from the salvage-yard order (record obs:a7276b88,
'listed with revision -A but we will ship out a revision B') and the controller label in the owner's photo of it on the
truck (vehicle_images 40e5e5f9, 2026-01-31: 'P/N 1?37123-0?-B ... iBooster'); the listing photo in the owner's library
(7ba386f0, IMG_0255) reads '(P)1037123-00-A'. openinverter's table lists 1037123-00-A and -B together as Gen 1 (Tesla
Model S / X) with one flange and one envelope. K5_WIRING_STATE's 'iBooster Gen 2' line disagrees with those part numbers
(Tesla S/X boosters are Gen 1; Gen 2 is Model 3, Accord and others), so it is flagged, not followed.

On the truck (40e5e5f9) the booster sits on a flat adapter plate on the driver firewall, the ECU faces inboard, and the
Tesla reservoir is replaced by two polished billet reservoirs on the master cylinder (part number not recorded): they are
drawn as the photo shows them.

Envelope from EVcreate's installing page (Gen 1: 320 flange to reservoir end, centre to top 125, to bottom 90, 155 wide,
85 from the centre to the ECU edge, 5 kg) and openinverter's table (firewall bolts 72 x 72, bolt Ø8.5, cut-out Ø76.35,
320 x 155 x 215, master cylinder 26 mm with M12x1 ports). The pushrod, studs, housings, ECU and reservoir split is sized
off the owner's photo against the printed 320.

Frame (mm): origin at the centre of the firewall flange's face (it bolts to the engine side of the firewall). +Z along
the booster axis away from the firewall (toward the master cylinder), +Y up, +X toward the ECU side (the booster can be
rotated to put the ECU either side; the placement decides). Studs and pushrod go through the firewall (-Z).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/IBOOSTER.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

EVC = ("reference_documents/web_snapshots/www.evcreate.com__installing-the-ibooster.md (EVcreate, 'iBooster dimensions and bolt "
       "pattern', GEN1)")
OI = "reference_documents/web_snapshots/openinverter.org__Bosch_iBooster.md (openinverter iBooster table, 1037123-00-A/-B, Gen 1)"
PHOTO_DB = ("owner's photo vehicle_images 7ba386f0 (iphoto IMG_0255, 2024-08-30), label '(P)1037123-00-A'")
PH = f"sized off the {PHOTO_DB} against EVcreate's printed 320 (flange to reservoir end)"
TRUCK = "owner's photo of the booster on the truck, vehicle_images 40e5e5f9 (2026-01-31)"
PHT = f"sized off the {TRUCK} against the ECU's 189 top to bottom (perspective, ±15)"

P = {
    "length": Dim(320.0, f"{EVC}: 'from flange to the end of the reservoir is 32 cm'; {OI}: 320 x 155 x 215", "vendor"),
    "top": Dim(125.0, f"{EVC}: 'Center to top is 12,5 cm'", "vendor"),
    "bottom": Dim(90.0, f"{EVC}: 'to bottom is 9 cm'", "vendor"),
    "width": Dim(155.0, f"{EVC}: 'Overall width is 15,5 cm'", "vendor"),
    "ecu_edge": Dim(85.0, f"{EVC}: 'center to ECU edge is 8,5 cm'", "vendor"),
    "bolt_sq": Dim(72.0, f"{OI}: 'Firewall bolts (W x H) 72 x 72'", "vendor"),
    "bolt_d": Dim(8.5, f"{OI}: bolt Ø 8.5", "vendor", note="the firewall hole for each stud; the studs are drawn M8"),
    "cutout": Dim(76.35, f"{OI}: cut-out ID 76.35", "vendor"),
    "mc_bore": Dim(26.0, f"{OI}: master cylinder 26 mm, 2 x M12x1 ports", "vendor"),
    "port_thread": Dim(12.0, f"{OI}: M12x1 brake line ports", "vendor"),
    "stud_l": Dim(29.0, PH, "photo", "studs through the firewall"),
    "boss_d": Dim(75.0, PH, "photo", "input boss into the firewall cut-out (sits in the 76.35 hole)"),
    "boss_l": Dim(10.0, PH, "photo"),
    "rod_l": Dim(97.0, PH, "photo", "flange face to the pushrod clevis end"), "boot_d": Dim(34.0, PH, "photo"),
    "housing_d": Dim(150.0, PH, "photo", "motor and gear housing (fills the top-to-bottom envelope with the ECU)"),
    "housing_l": Dim(168.0, PH, "photo", "flange to the master cylinder"),
    "ecu_t": Dim(45.0, PH, "photo", "ECU box thickness (its outer face at the 85 edge)"),
    "ecu_z0": Dim(27.0, PH, "photo", "ECU start off the flange"), "ecu_top": Dim(99.0, PH, "photo", "ECU top above the axis"),
    "mc_l": Dim(85.0, PH, "photo", "master cylinder body"), "mc_d": Dim(52.0, PH, "photo"),
    "res_d": Dim(60.0, PHT, "photo", "billet reservoir, each of two"), "res_h": Dim(75.0, PHT, "photo"),
    "res_z": Dim(212.0, PHT, "photo", "reservoir axes along the booster axis (two, 42 apart)"),
}
COLORS = {
    "housing": ("#b9bcbd", f"{PHOTO_DB} (cast aluminium housings)"),
    "ecu": ("#2c2d2e", f"{PHOTO_DB} (ECU cover, black)"),
    "label": ("#f2f2f0", f"{PHOTO_DB} (ECU label, white)"),
    "reservoir": ("#d4d7da", f"{TRUCK} (billet reservoirs, polished aluminium)"),
    "boot": ("#1d1d1d", f"{PHOTO_DB} (pushrod boot, black rubber)"),
    "steel": ("#c9ccd0", f"{PHOTO_DB} (studs, pushrod, clevis: zinc)"),
    "plug": ("#1e1e1f", "controller plug: black (not in the photo's view)"),
}
PART = {
    "pid": "IBOOSTER", "endpoints": ["IBOOSTER"], "maker": "Bosch (Tesla)", "pn": "1037123-00-B (Gen 1; -00-A same housing)",
    "title": "Bosch iBooster Gen 1 (Tesla 1037123-00-B)",
    "what": "Brake booster, Bosch iBooster Gen 1 from a Tesla Model S/X (1037123-00-B), with master cylinder and reservoir",
    "shape_basis": "datasheet dims", "viewset": "wall",
    "dims_mm": {"l": 155.0, "w": 320.0, "h": 215.0},
    "dims_note": "Gen 1 booster and ECU 90 below the axis and 155 wide (85 to the ECU side, EVcreate); 72 x 72 stud square; the "
                 "owner's billet reservoirs in place of the Tesla one (EVcreate's 320 flange-to-reservoir and 125 to the top are the "
                 "Tesla reservoir's); studs and pushrod reach ~97 through the firewall (photo)",
    "margin": {"mm": 15.0, "why": "booster envelope from EVcreate / openinverter (vendor figures); housings, ECU, master cylinder "
                                 "and pushrod off the owner's photos (±8); the billet reservoirs off the truck photo (±15)"},
    "frame": "origin at the centre of the firewall flange's face; +Z along the axis away from the firewall, +Y up, +X to the ECU "
             "side; studs and pushrod through the firewall (-Z)",
    "axes": {"mount_normal": "-Z", "maker_up": "+Y", "faces": {"flange": "-Z", "ecu": "+X", "ports": "+X", "reservoir": "+Y"}},
    "photo": {"url": "vehicle_images 40e5e5f9 (the owner's photo on the truck) and 7ba386f0 (listing photo)",
              "page": "Nuke vehicle e08bf694 images", "fetched": "2026-09-29"},
    "photo_short": "owner's photos 40e5e5f9 (on the truck) and IMG_0255",
    "branding": ["ECU label 'iBooster (P)1037123-00-A'"],
    "dims_draw": [("front", "x", "width", -10), ("front", "y", "top", -10), ("right", (0, 0, 0), (0, 0, 320.0), "length", -10)],
    "refs": [("[1]", "evcreate.com__installing", "EVcreate, installing the iBooster: Gen 1 dimensions"),
             ("[2]", "openinverter.org__Bosch_iBooster", "openinverter iBooster table: 1037123-00-A/-B Gen 1"),
             ("[3]", "sized off the owner's photo", "sized off the owner's photo IMG_0255 against the printed 320"),
             ("[4]", "on the truck", "sized off the owner's photo on the truck (40e5e5f9)")],
    "drawing_notes": [
        ("Gen 1, not Gen 2: registry / part_media 1037123-00-B, the owner's photo 1037123-00-A; openinverter puts both in Gen 1.", "#10151a"),
        ("K5_WIRING_STATE says 'Gen 2': flagged as a conflict with those part numbers.", "assumed"),
        ("Controller plug (Tulay Gen-1 harness): #52 4 mm² pin 1, IBOOST_PERM pin 17, IBOOST_WAKE pin 20, IBOOST_GND pin 9; CAN "
         "16/25 candidate.", "#10151a"),
    ],
    "unknowns": ["Generation: Gen 1 per the order and the truck photo's label (-B); K5_WIRING_STATE says Gen 2 (flagged).",
                 "The billet reservoirs' part number and size are not recorded: sized off the truck photo (±15).",
                 "The firewall adapter plate on the truck is not drawn (fabricated; its size is not recorded).",
                 "The ECU side (rotation about the axis) is the placement's call; the controller plug's position on the ECU is "
                 "not dimensioned (drawn on the ECU's lower edge).",
                 "Pushrod length and clevis to the pedal are the pedal's adapter (not drawn to a pedal)."],
}
L_, TOPY, BOTY = K.v(P["length"]), K.v(P["top"]), -K.v(P["bottom"])
XE = K.v(P["ecu_edge"])
XO = XE - K.v(P["width"])                       # the side away from the ECU (-70)
BQ = K.v(P["bolt_sq"]) / 2
PLUG = (XE - 5.0, BOTY + 18.0, 120.0)


def build():
    hl, hd = K.v(P["housing_l"]), K.v(P["housing_d"])
    flange = Pos(0, 0, 0) * D.rbox(K.v(P["bolt_sq"]) + 26, K.v(P["bolt_sq"]) + 26, 12.0, r=10.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            flange -= D.cyl(K.v(P["bolt_d"]), 14, at=(sx * BQ, sy * BQ, -1))
    housing = flange + D.cyl(hd, hl - 12.0 + 0.01, at=(0, 0, 11.99))
    clip = Pos((XO + XE) / 2, (TOPY - 20.0 + BOTY) / 2, -20.0) * Box(XE - XO, TOPY - 20.0 - BOTY, 400.0, align=D.BASE)
    housing = housing & clip
    boss = D.cyl(K.v(P["boss_d"]), K.v(P["boss_l"]), at=(0, 0, -K.v(P["boss_l"])))
    mcl, mcd = K.v(P["mc_l"]), K.v(P["mc_d"])
    mc = D.cyl(mcd, mcl, at=(0, 0, hl - 0.01))
    for z in (hl + 25.0, hl + 62.0):
        mc += D.cyl(20.0, 10.0, at=(mcd / 2 - 2.0, 0, z), axis="x")
        mc -= D.cyl(K.v(P["port_thread"]), 10.0, at=(mcd / 2 + 1.0, 0, z), axis="x")
    et = K.v(P["ecu_t"])
    ez0 = K.v(P["ecu_z0"])
    ecu = Pos(XE - et / 2, (K.v(P["ecu_top"]) + BOTY) / 2, ez0) * D.rbox(et, K.v(P["ecu_top"]) - BOTY, hl - ez0, r=6.0, align=(D.Align.CENTER, D.Align.CENTER, D.Align.MIN))
    rd, rh, rz = K.v(P["res_d"]), K.v(P["res_h"]), K.v(P["res_z"])
    res = D.cyl(rd, rh, at=(-10.0, mcd / 2 + 8.0, rz - 21.0), axis="y") + D.cyl(rd, rh, at=(-10.0, mcd / 2 + 8.0, rz + 21.0), axis="y")
    res = res & Pos(0, 0, 0) * Box(400, 400, L_ * 2, align=D.BASE).moved(K.Location((0, 0, -L_)))
    stem = Pos(-10.0, mcd / 2 - 4, rz) * Box(30.0, 14.0, 80.0, align=(D.Align.CENTER, D.Align.MIN, D.Align.CENTER))
    parts = [K.body(housing + boss, "IBOOSTER flange, motor and gear housing", COLORS["housing"][0], finish="cast"),
             K.body(mc + stem, "IBOOSTER master cylinder (26 mm, 2 x M12x1 ports)", COLORS["housing"][0], finish="cast"),
             K.body(ecu, "IBOOSTER ECU (controller)", COLORS["ecu"][0]),
             K.body(res, "IBOOSTER billet reservoirs (2, on the master cylinder, as on the truck)", COLORS["reservoir"][0], finish="chrome")]
    sl = K.v(P["stud_l"])
    studs = [D.cyl(8.0, sl + 12.0, at=(sx * BQ, sy * BQ, -sl)) for sx in (-1, 1) for sy in (-1, 1)]
    parts.append(K.body(Compound(children=studs).fuse(), "IBOOSTER firewall studs (4, M8)", COLORS["steel"][0], finish="metal"))
    rl = K.v(P["rod_l"])
    rod = D.cyl(10.0, rl - 20.0, at=(0, 0, -rl + 20.0)) + Pos(0, 0, -rl) * Box(16.0, 12.0, 22.0, align=D.BASE)
    boot = D.cyl(K.v(P["boot_d"]), 48.0, at=(0, 0, -K.v(P["boss_l"]) - 48.0))
    parts.append(K.body(rod, "IBOOSTER input pushrod and clevis", COLORS["steel"][0], finish="metal"))
    parts.append(K.body(boot, "IBOOSTER pushrod boot", COLORS["boot"][0], finish="rubber"))
    plug = Pos(*PLUG) * Box(22.0, 20.0, 60.0)
    parts.append(K.body(plug, "IBOOSTER controller plug (26-way, Tulay Gen-1 harness)", COLORS["plug"][0]))
    keep = [K.body(Pos(XE + 40.0, BOTY + 18.0, 120.0) * Box(80.0, 40.0, 70.0), "keep-out: controller plug and harness bend (80 mm)",
                   "#2e7d32", alpha=0.25),
            K.body(Pos(0, 0, -rl - 40.0) * Box(90, 90, 40.0, align=D.BASE), "keep-out: pushrod to the pedal inside the cab (40 mm past "
                   "the clevis)", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    et = K.v(P["ecu_t"])
    lab = Pos(XE + 0.05, 60.0, 90.0) * Box(0.12, 26.0, 52.0)
    items = [K.body(lab, "IBOOSTER branding: ECU label (redrawn from the photo, cosmetic)", COLORS["label"][0], finish="print")]
    return items


def attach_points():
    return [{"n": "controller", "ep": "IBOOSTER", "at": [PLUG[0] + 11.0, PLUG[1], PLUG[2]], "dir": [1, 0, 0], "kind": "plug",
             "note": "controller plug (Tulay Gen-1 universal harness: 4 loose leads + CAN candidate)"}]


def terminals():
    at = (PLUG[0] + 11.0, PLUG[1], PLUG[2])
    rows = []
    for pin, rx in (("1", r"pin 1\b"), ("17", r"pin 17"), ("20", r"pin 20"), ("9", r"pin 9\b"), ("16", r"pin 16"), ("25", r"pin 25")):
        rows.append({"pin": pin, "endpoint": "IBOOSTER", "name": f"controller plug pin {pin}", "kind": "Tulay harness lead", "match": rx,
                     "at": at, "dir": (1, 0, 0), "note": "the Tulay harness carries the plug; our wires land on its loose leads"})
    return rows


def mount_points():
    return [{"n": f"stud_{'L' if sx < 0 else 'R'}{'T' if sy > 0 else 'B'}", "at": [sx * BQ, sy * BQ, 0], "dir": [0, 0, -1],
             "d": K.v(P["bolt_d"]), "note": "M8 stud through the firewall (72 x 72 square), nut inside the cab"}
            for sx in (-1, 1) for sy in (-1, 1)]


def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


def _bb(b):
    return Compound(children=[x for x in b if "stud" not in x.label and "pushrod" not in x.label and "boot" not in x.label
                              and "plug" not in x.label]).bounding_box()


CHECKS = [
    ("master cylinder end inside EVcreate's 320", lambda b: _bb(b).max.Z <= 320.0, True),
    ("centre to bottom", lambda b: -_bb(b).min.Y, 90.0),
    ("centre to the ECU edge", lambda b: _bb(b).max.X, 85.0),
    ("overall width", lambda b: _bb(b).size.X, 155.0, 1.0),
    ("stud square", lambda b: 2 * BQ, 72.0),
    ("input boss fits the 76.35 cut-out", lambda b: K.v(P["boss_d"]) < K.v(P["cutout"]), True),
]

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
