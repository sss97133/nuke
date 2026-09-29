#!/usr/bin/env python3
"""Radiator fan: SPAL 30107090 16 in brushless puller fan, 300 W, 2053 CFM, drop-in (sits in the shroud).

SPAL's own drawing on file is for the VA97-ABL322P/N-103A (SPAL_VA97-ABL322P-N-103A_datasheet.pdf p.3): ring 432.5 across
its flats and Ø441.5, rear lip Ø417, four Ø7.5 holes on a 315.5 square, 78.4 deep (53.5 ring, 15.5 lip), lead 430 ±10.
The 30107090's own published numbers match it: 16 in, 3.10 in (78.7) deep (Kartek), and the registry's '17 x 17 in housing'
(432 mm). So the model is SPAL's VA97 drawing, flagged as a sibling part number. The connector is sized off the Wizard
Cooling photo of a 30107090 listing against the printed 432.5.

Frame (mm): origin at the centre of the rear lip's face (it sits in the shroud against the radiator). +Z toward the
engine (a puller: the motor faces the engine), +Y up, +X right seen from the engine.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/FAN.py <out_dir>
"""
import math
import sys
from pathlib import Path

from build123d import Axis, Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/SPAL_VA97-ABL322P-N-103A_datasheet.pdf p.3 (SPAL VA97-ABL322P/N-103A drawing)"
KT = ("reference_documents/web_snapshots/www.kartek.com__spal-30107090-plus-series-16-brushless-puller-fan-300w-2053-peak-cfm-drop-"
      "in-mount-sits-in-shroud.md (Kartek 30107090 listing)")
PHURL = "https://wizardcooling.com/images/M198668289.jpg (Wizard Cooling's 30107090 listing photo, fetched 2026-09-29)"
PH = f"sized off {PHURL} against SPAL's printed 432.5"
PHOTO = f"Wizard Cooling photo {PHURL}, k-means of the region"

P = {
    "flats": Dim(432.5, f"{DS} (432.5 across the ring's flats, both ways)", note="the registry's '17 x 17 in' housing"),
    "ring_d": Dim(441.5, f"{DS} (Ø441.5)"),
    "lip_d": Dim(417.0, f"{DS} (Ø417, the rear lip)"),
    "depth": Dim(78.4, f"{DS} (78.4 overall); {KT}: 'Thickness/Depth: 3.10\"'"),
    "ring_depth": Dim(53.5, f"{DS} (53.5)"),
    "lip_depth": Dim(15.5, f"{DS} (15.5)"),
    "hole_sq": Dim(315.5, f"{DS} (315.5 square, both ways)"),
    "hole_d": Dim(7.5, f"{DS} ('N 4 HOLES Ø7.5')"),
    "tab_r": Dim(8.0, f"{DS} (R8)"),
    "lead_l": Dim(430.0, f"{DS} ('(*)430 ±10')"),
    "hub_d": Dim(150.0, f"scaled off {DS} at its printed 432.5", "scaled", "motor hub"),
    "blade_d": Dim(400.0, f"scaled off {DS}", "scaled", "blade sweep inside the ring"),
    "spokes": Dim(11, f"counted on {DS}", "scaled", "ring spokes"),
    "plug_w": Dim(24.0, PH, "photo", "fan connector"), "plug_l": Dim(48.0, PH, "photo"),
}
COLORS = {
    "ring": ("#18181a", PHOTO + " (ring and spokes, black)"),
    "blade": ("#1f1f21", PHOTO + " (blades, black)"),
    "motor": ("#232325", PHOTO + " (motor, black)"),
    "plug": ("#3f86c9", PHOTO + " (connector, blue)"),
    "lead": ("#141415", PHOTO + " (lead sleeve, black)"),
}
PART = {
    "pid": "FAN", "endpoints": ["FAN"], "maker": "SPAL", "pn": "30107090 (drawn from SPAL's VA97-ABL322P/N-103A drawing)",
    "title": "SPAL 30107090 16 in brushless puller fan (drop-in)",
    "what": "Radiator fan, SPAL 30107090 16 in drop-in brushless puller, 300 W, 2053 CFM",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 441.5, "w": 441.5, "h": 78.4},
    "dims_note": "ring 432.5 across its flats, Ø441.5; rear lip Ø417 sits in the shroud; 78.4 deep; holes Ø7.5 on a 315.5 "
                 "square (SPAL's VA97-ABL322P drawing, which matches the 30107090's 16 in, 3.10 in and 17 x 17 in)",
    "margin": {"mm": 3.0, "why": "SPAL's drawing of the sibling VA97-ABL322P; the 30107090 matches it on its three published numbers; "
                                "hub, blades and connector scaled"},
    "frame": "origin at the centre of the rear lip's face (shroud / radiator side); +Z toward the engine, +Y up",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"motor": "+Z", "lip": "-Z"}},
    "photo": {"url": "https://wizardcooling.com/images/M198668289.jpg",
              "page": "https://wizardcooling.com/i-30504347-16-brushless-fan-300-watts-drop-in-style.html", "fetched": "2026-09-29"},
    "photo_short": "Wizard Cooling photo (30107090 listing)",
    "branding": [],
    "dims_draw": [("front", "x", "flats", -12), ("front", (-157.75, -157.75, 53.5), (157.75, -157.75, 53.5), "hole_sq", -40),
                  ("right", "z", "depth", 12)],
    "refs": [("[1]", "SPAL_VA97", "SPAL drawing VA97-ABL322P/N-103A (p.3)"), ("[2]", "kartek.com__spal-30107090", "Kartek 30107090 listing"),
             ("[3]", "scaled off", "measured off [1] at its printed 432.5"), ("[4]", "sized off", "sized off the listing photo")],
    "drawing_notes": [
        ("SPAL's drawing is for the VA97-ABL322P/N-103A: the 30107090 matches its 16 in, 78.4 (3.10 in) depth and 432.5 (17 in) ring.", "#10151a"),
        ("Power (#21), ground (FAN_GND) and PWM (FAN_PWM, white) at the fan's connector on its 430 lead (registry).", "#10151a"),
        ("Drop-in: the rear lip sits inside the shroud's opening; the four tabs bolt to the shroud.", "#10151a"),
    ],
    "unknowns": ["Part-number match: drawn from SPAL's VA97-ABL322P/N-103A (a sibling); confirm the ring and holes on the fan.",
                 "The connector type (and which kit mates it) is open in the registry (ProWire 30130628 kit)."],
}
F2 = K.v(P["flats"]) / 2
HQ = K.v(P["hole_sq"]) / 2
LZ, RZ, DZ = K.v(P["lip_depth"]), K.v(P["ring_depth"]), K.v(P["depth"])
LEAD_END = (60.0, -300.0, RZ - 5.0)


def build():
    rd = K.v(P["ring_d"])
    ring = D.cyl(rd, RZ - LZ, at=(0, 0, LZ)) & Box(2 * F2, 2 * F2, 200, align=D.CEN)
    ring -= D.cyl(rd - 14.0, RZ, at=(0, 0, LZ - 1))
    lip = D.cyl(K.v(P["lip_d"]), LZ + 0.01, at=(0, 0, 0)) - D.cyl(K.v(P["lip_d"]) - 8.0, LZ + 2, at=(0, 0, -1))
    tabs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            t = Pos(sx * HQ, sy * HQ, RZ - 6.0) * D.rbox(2 * K.v(P["tab_r"]) + 4, 2 * K.v(P["tab_r"]) + 4, 6.0, r=K.v(P["tab_r"]),
                                                       align=(D.Align.CENTER, D.Align.CENTER, D.Align.MIN))
            arm = Box(26.0, 8.0, 6.0, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, math.degrees(math.atan2(sy, sx)))
            tabs.append(t + Pos(sx * HQ, sy * HQ, RZ - 6.0) * arm)
    frame = ring + lip + Compound(children=tabs).fuse()
    for sx in (-1, 1):
        for sy in (-1, 1):
            frame -= D.cyl(K.v(P["hole_d"]), 20, at=(sx * HQ, sy * HQ, RZ - 10))
    hub = D.cyl(K.v(P["hub_d"]), DZ - LZ, at=(0, 0, LZ))
    spokes = []
    n = int(K.v(P["spokes"]))
    for i in range(n):
        s = Pos(0, 0, RZ - 8.0) * Box(rd / 2 - 9.0, 6.0, 8.0, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN))
        spokes.append(s.rotate(Axis.Z, 360.0 * i / n + 12.0))
    parts = [K.body(frame + Compound(children=spokes).fuse(), "FAN ring, rear lip, tabs and spokes", COLORS["ring"][0]),
             K.body(hub, "FAN brushless motor (hub)", COLORS["motor"][0])]
    blades = []
    for i in range(9):
        b = Pos(K.v(P["hub_d"]) / 2 - 5.0, 0, LZ + 12.0) * Box(K.v(P["blade_d"]) / 2 - K.v(P["hub_d"]) / 2, 55.0, 3.0,
                                                            align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.X, 25.0)
        blades.append(b.rotate(Axis.Z, 40.0 * i))
    parts.append(K.body(Compound(children=blades).fuse(), "FAN blades (9)", COLORS["blade"][0]))
    lead, _ = D.lead((0, -K.v(P["hub_d"]) / 2, RZ - 5.0), (0, -1, 0), 120.0, d=9.0)
    lead2, e2 = D.lead((0, -K.v(P["hub_d"]) / 2 - 120.0, RZ - 5.0), (LEAD_END[0], LEAD_END[1] + K.v(P["hub_d"]) / 2 + 120.0, 0),
                       ((LEAD_END[0]) ** 2 + (LEAD_END[1] + K.v(P["hub_d"]) / 2 + 120.0) ** 2) ** 0.5, d=9.0)
    plug = Pos(LEAD_END[0], LEAD_END[1] - K.v(P["plug_l"]) / 2, LEAD_END[2]) * Box(K.v(P["plug_w"]), K.v(P["plug_l"]), 18.0)
    cos = [K.body(lead + lead2, "FAN lead (430)", COLORS["lead"][0], finish="rubber"),
           K.body(plug, "FAN connector", COLORS["plug"][0])]
    keep = [K.body(D.cyl(K.v(P["hub_d"]) + 40, 60.0, at=(0, 0, DZ)), "keep-out: engine-side air and the water pump (60 mm)",
                   "#2e7d32", alpha=0.25)]
    return parts, keep, cos


def attach_points():
    return [{"n": "plug", "ep": "FAN", "at": [LEAD_END[0], round(LEAD_END[1] - K.v(P["plug_l"]), 2), LEAD_END[2]], "dir": [0, -1, 0],
             "kind": "connector", "note": "fan connector at the end of the 430 lead: power, ground, PWM"}]


def terminals():
    at = (LEAD_END[0], LEAD_END[1] - K.v(P["plug_l"]), LEAD_END[2])
    return [{"pin": "PWR", "endpoint": "FAN", "name": "power +", "kind": "large terminal", "match": r"^power", "at": at, "dir": (0, -1, 0)},
            {"pin": "GND", "endpoint": "FAN", "name": "ground -", "kind": "large terminal", "match": r"^ground", "at": at, "dir": (0, -1, 0)},
            {"pin": "PWM", "endpoint": "FAN", "name": "PWM control (white)", "kind": "control terminal", "match": r"^PWM", "at": at,
             "dir": (0, -1, 0)}]


def mount_points():
    return [{"n": f"tab_{'L' if sx < 0 else 'R'}{'T' if sy > 0 else 'B'}", "at": [sx * HQ, sy * HQ, RZ], "dir": [0, 0, -1],
             "d": K.v(P["hole_d"]), "note": "tab bolt to the shroud"} for sx in (-1, 1) for sy in (-1, 1)]


def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


def _holes(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01}
    return sorted(cs)


CHECKS = [
    ("across the flats", lambda b: b[0].bounding_box().size.X, 432.5),
    ("overall depth", lambda b: Compound(children=b).bounding_box().size.Z, 78.4),
    ("hole count", lambda b: len(_holes(b)), 4),
    ("hole square", lambda b: _holes(b)[-1][0] - _holes(b)[0][0], 315.5),
]

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
