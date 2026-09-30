#!/usr/bin/env python3
"""Blower motor: Four Seasons 35587 flanged single-shaft blower motor (12 V, one speed, clockwise from the shaft end), in
the factory Four-Season blower-evaporator case.

Four Seasons prints (MPParts listing): length 5 in (127) with the shaft, motor length 4-1/4 in (108), shaft 1 in (25.4) x
5/16 in (7.9), diameter 3-1/16 in (77.8), flange mount, blade terminal. The flange, its screw holes, the vented boss and
the split of the motor either side of the flange are sized off Four Seasons' product photo against the printed 77.8.

Frame (mm): origin at the centre of the flange's face on the blower case. +Z out of the case into the engine bay (the
motor can), +Y up (the blade terminal is at the bottom, -Y); the shaft and its vented boss go into the case (-Z).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/BLOWER-MOTOR.py <out_dir>
"""
import math
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

MPP = ("reference_documents/web_snapshots/mpparts.com__four-seasons-35587-blower-motor-single-shaft-35587.md (MPParts listing of "
       "Four Seasons 35587, fetched 2026-09-28)")
PHURL = "https://static.summitracing.com/global/images/prod/xlarge/FSS-35587_xl.jpg (Summit Racing, fetched 2026-09-29)"
PH = f"sized off the Four Seasons product photo {PHURL} against the printed 77.8 diameter"
PHOTO = f"product photo {PHURL}, k-means of the region"

P = {
    "can_d": Dim(77.8, f"{MPP}: 'Diameter: 3 1/16\" (77.8mm)'"),
    "motor_l": Dim(108.0, f"{MPP}: 'Motor Length: 4 1/4\" (108mm)'"),
    "overall_l": Dim(127.0, f"{MPP}: 'Length: 5\" (127mm)'", note="127 - 108 leaves 19 of shaft past the motor; the listing's shaft "
                                                                   "length is 25.4 (measured from the boss face)"),
    "shaft_l": Dim(25.4, f"{MPP}: 'Shaft Length: 1\" (25.4mm)'"),
    "shaft_d": Dim(7.9, f"{MPP}: 'Shaft Diameter: 5/16\" (7.9mm)'"),
    "flange_d": Dim(180.0, PH, "photo", "mounting flange (±10)", "fit-critical, scaled"),
    "flange_t": Dim(1.2, PH, "photo", "flange sheet"),
    "flange_holes": Dim(10, PH, "photo", "screw holes round the flange rim"),
    "hole_bc": Dim(166.0, PH, "photo", "flange screw circle"), "hole_d": Dim(4.5, PH, "photo"),
    "boss_d": Dim(70.0, PH, "photo", "vented boss on the case side"), "boss_l": Dim(25.0, PH, "photo"),
    "step_d": Dim(118.0, PH, "photo", "raised step ring on the flange"),
    "blade_z": Dim(12.0, PH, "photo", "blade terminal off the flange face (motor side)"),
}
COLORS = {
    "flange": ("#2f3031", PHOTO + " (flange and can, black paint)"),
    "can": ("#2f3031", PHOTO + " (motor can, black)"),
    "shaft": ("#c9c6bd", PHOTO + " (shaft and nut, zinc)"),
    "blade": ("#c7c2b4", PHOTO + " (blade terminal, tin)"),
}
PART = {
    "pid": "BLOWER-MOTOR", "endpoints": ["BLOWER-MOTOR"], "maker": "Four Seasons", "pn": "35587",
    "title": "Four Seasons 35587 blower motor (flanged, single shaft)",
    "what": "Blower motor, Four Seasons 35587 flanged single-speed 12 V motor, one blade terminal",
    "shape_basis": "datasheet dims", "viewset": "wall",
    "dims_mm": {"l": 180.0, "w": 180.0, "h": 127.0},
    "dims_note": "motor Ø77.8 x 108 plus 19 of shaft (127 overall, Four Seasons); flange ~Ø180 sized off the photo",
    "margin": {"mm": 10.0, "why": "can, lengths and shaft printed by Four Seasons; the flange (and so the case hole pattern) sized "
                                 "off a perspective photo (±10)"},
    "frame": "origin at the centre of the flange face on the blower case; +Z into the engine bay (motor can), +Y up (blade down); "
             "shaft into the case (-Z)",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"can": "+Z", "shaft": "-Z", "blade": "-Y"}},
    "photo": {"url": "https://static.summitracing.com/global/images/prod/xlarge/FSS-35587_xl.jpg",
              "page": "https://www.summitracing.com/parts/fss-35587", "fetched": "2026-09-29"},
    "photo_short": "Four Seasons 35587 photo (Summit)",
    "branding": [],
    "dims_draw": [("front", "x", "flange_d", -10), ("right", "z", "overall_l", -10)],
    "refs": [("[1]", "mpparts.com__four-seasons-35587", "MPParts listing of Four Seasons 35587 (dimensions, blade terminal)"),
             ("[2]", "sized off the Four Seasons", "sized off the product photo against the printed 77.8")],
    "drawing_notes": [
        ("One blade (+): BLOWER_MOT and BLOWER_HI join before it; the 35587 has no ground lead (it grounds through its flange,"
         " registry open BLOWER_GND).", "#10151a"),
        ("The flange must match the Four-Season case's hole pattern: sized off the photo, check against the old motor.", "scaled"),
    ],
    "unknowns": ["Flange diameter and hole circle sized off the photo (±10): compare with the motor removed from the case.",
                 "Ground path: no lead on the 35587 (listing); the factory 1978 C60 motor had a ground lead to a stud (registry)."],
}
CL = K.v(P["motor_l"]) - K.v(P["boss_l"])        # can behind the flange
BL = K.v(P["boss_l"])
SH = K.v(P["overall_l"]) - K.v(P["motor_l"])
BLADE = (0.0, -K.v(P["can_d"]) / 2 - 6.0, K.v(P["blade_z"]))


def build():
    fd, ft = K.v(P["flange_d"]), K.v(P["flange_t"])
    flange = D.cyl(fd, ft) + D.cyl(K.v(P["step_d"]), 3.0, at=(0, 0, -2.0))
    n, bc = int(K.v(P["flange_holes"])), K.v(P["hole_bc"])
    for i in range(n):
        a = math.radians(90 + 360 * i / n)
        flange -= D.cyl(K.v(P["hole_d"]), 8, at=(bc / 2 * math.cos(a), bc / 2 * math.sin(a), -4))
    can = D.cyl(K.v(P["can_d"]), CL - 4.0, at=(0, 0, 0.0)) + D.cyl(K.v(P["can_d"]) - 14.0, 4.0, at=(0, 0, CL - 4.01))
    boss = D.cyl(K.v(P["boss_d"]), BL, at=(0, 0, -BL))
    for i in range(8):
        a = math.radians(360 * i / 8)
        boss -= D.cyl(6.0, 6.0, at=(24.0 * math.cos(a), 24.0 * math.sin(a), -BL - 1))
    shaft = D.cyl(K.v(P["shaft_d"]), SH + 1.0, at=(0, 0, -BL - SH))
    nut = D.hex_prism(12.7, 6.0, at=(0, 0, -BL - 8.0))
    blade = D.blade(BLADE, axis="-y", w=6.35, t=0.8, l=8.0)
    parts = [K.body(flange, "BLOWER-MOTOR mounting flange", COLORS["flange"][0], finish="paint"),
             K.body(can + boss, "BLOWER-MOTOR motor can and vented boss", COLORS["can"][0], finish="paint"),
             K.body(shaft + nut, "BLOWER-MOTOR shaft (5/16) and wheel nut", COLORS["shaft"][0], finish="metal"),
             K.body(Pos(0, -K.v(P["can_d"]) / 2 - 2.0, K.v(P["blade_z"])) * Box(12.0, 6.0, 10.0) + blade,
                    "BLOWER-MOTOR blade terminal (+)", COLORS["blade"][0], finish="metal")]
    keep = [K.body(D.cyl(150.0, 60.0, at=(0, 0, -BL - 60.0)), "keep-out: blower wheel inside the case (Ø150, not drawn)", "#2e7d32",
                   alpha=0.25),
            K.body(Pos(0, -K.v(P["can_d"]) / 2 - 30.0, K.v(P["blade_z"])) * Box(30.0, 40.0, 25.0), "keep-out: blade connector below the can",
                   "#2e7d32", alpha=0.25)]
    return parts, keep, []


def attach_points():
    return [{"n": "blade", "ep": "BLOWER-MOTOR", "at": [BLADE[0], round(BLADE[1] - 8.0, 2), BLADE[2]], "dir": [0, -1, 0],
             "kind": "blade", "note": "+ blade; BLOWER_MOT and BLOWER_HI join ahead of it"}]


def terminals():
    return [{"pin": "+", "endpoint": "BLOWER-MOTOR", "name": "+ blade terminal", "kind": "0.250 blade", "match": r"^\+ blade",
             "at": (BLADE[0], BLADE[1] - 8.0, BLADE[2]), "dir": (0, -1, 0)},
            {"pin": "GND", "endpoint": "BLOWER-MOTOR", "name": "ground (no lead on the 35587: through the flange)", "kind": "flange",
             "wires": ["BLOWER_GND"], "at": (0, -K.v(P["hole_bc"]) / 2, 0), "dir": (0, 0, 1)}]


def mount_points():
    n, bc = int(K.v(P["flange_holes"])), K.v(P["hole_bc"])
    return [{"n": f"screw_{i}", "at": [round(bc / 2 * math.cos(math.radians(90 + 360 * i / n)), 2),
                                       round(bc / 2 * math.sin(math.radians(90 + 360 * i / n)), 2), 0], "dir": [0, 0, -1],
             "d": K.v(P["hole_d"]), "note": "flange screw into the blower case"} for i in range(n)]


def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


CHECKS = [
    ("can diameter", lambda b: b[1].bounding_box().size.X, 77.8, 0.1),
    ("motor length (boss face to can end)", lambda b: b[1].bounding_box().size.Z, 108.0),
    ("overall length with the shaft", lambda b: b[1].bounding_box().max.Z - b[2].bounding_box().min.Z, 127.0),
]

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
