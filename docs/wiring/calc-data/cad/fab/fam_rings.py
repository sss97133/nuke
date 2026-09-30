#!/usr/bin/env python3
"""Ring terminals and lugs the registry names for the ground banks, the power studs and the fan junction: ProWire's
heavy-duty tinned-copper lugs (238LTP, 2516LTP, 838TP, 638TP, 610TP, DL438, DL214) and its hi-temp rings (9906, 9912,
9916, 9918). Each lug carries ProWire's own dimension table (barrel flare I, barrel I.D. C, tang width W, tang length F,
barrel length D, overall length E, tang thickness T: basis "vendor", ProWire names no maker); the hi-temp rings, which
ProWire lists without a table, are sized off ProWire's product photo against the stud they take (photo, +-15 %).

Frame (mm): the tang flat on z = 0 (the stud's seat), the stud hole centre at the origin, the barrel toward +X; the
wire leaves along +X.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_rings.py <out_root> [id ...]
"""
import json
import re
import sys
import types
from pathlib import Path

from build123d import Compound

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z  # noqa: E402

STUD = {'#10 (M5)': 4.83, '1/4" (M6)': 6.35, '5/16" (M8)': 7.94, '3/8" (M9)': 9.525, 'M6': 6.0, "1/4": 6.35, "3/8": 9.525,
        "5/16": 7.94}


def PW(pn):
    return f"prowireusa.com/{pn} (ProWire product page, read 2026-09-29)"


def D(v, src, basis="vendor", note="", fit=""):
    return Dim(v, src, basis, note, fit)


# ProWire's tables (inch values as printed, converted here), read 2026-09-29
LUGS = {
    '238LTP': {'what': 'ProWire 238LTP: heavy-duty tinned-copper lug, 2 AWG, 3/8" (M9) stud', 'colour': ('#c8c9c4', PW('238LTP') + ': Material: Tinned Copper (tin colour)'), 'stud': '3/8" (M9)', 'C': D(round(.336 * 25.4, 3), PW('238LTP') +  'Barrel I.D. (C): .336 in'), 'W': D(round(.65 * 25.4, 3), PW('238LTP') +  'Tang Width (W): .65 in'), 'F': D(round(.69 * 25.4, 3), PW('238LTP') +  'Tang Length (F): .69 in'), 'Dl': D(round(.525 * 25.4, 3), PW('238LTP') +  'Barrel Length (D): .525 in'), 'E': D(round(1.69 * 25.4, 3), PW('238LTP') +  'Overall Length (E): 1.69 in'), 'T': D(round(.1 * 25.4, 3), PW('238LTP') +  'Tang Thickness (T): .1 in'), 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('238LTP') + ' Stud Size: 3/8" (M9), + 0.4 clearance', 'design'), 'I': D(round(.472 * 25.4, 3), PW('238LTP') +  'Barrel Flare (I): .472 in')},
    '2516LTP': {'what': 'ProWire 2516LTP: heavy-duty tinned-copper lug, 2 AWG, 5/16" (M8) stud', 'colour': ('#c8c9c4', PW('2516LTP') + ': Material: Tinned Copper (tin colour)'), 'stud': '5/16" (M8)', 'C': D(round(.336 * 25.4, 3), PW('2516LTP') +  'Barrel I.D. (C): .336 in'), 'W': D(round(.65 * 25.4, 3), PW('2516LTP') +  'Tang Width (W): .65 in'), 'F': D(round(.69 * 25.4, 3), PW('2516LTP') +  'Tang Length (F): .69 in'), 'Dl': D(round(.525 * 25.4, 3), PW('2516LTP') +  'Barrel Length (D): .525 in'), 'E': D(round(1.69 * 25.4, 3), PW('2516LTP') +  'Overall Length (E): 1.69 in'), 'T': D(round(.1 * 25.4, 3), PW('2516LTP') +  'Tang Thickness (T): .1 in'), 'hole': D(STUD['5/16" (M8)'] + 0.4, PW('2516LTP') + ' Stud Size: 5/16" (M8), + 0.4 clearance', 'design'), 'I': D(round(.472 * 25.4, 3), PW('2516LTP') +  'Barrel Flare (I): .472 in')},
    '838TP': {'what': 'ProWire 838TP: heavy-duty tinned-copper lug, 8 AWG, 3/8" (M9) stud', 'colour': ('#c8c9c4', PW('838TP') + ': Material: Tinned Copper (tin colour)'), 'stud': '3/8" (M9)', 'C': D(round(.186 * 25.4, 3), PW('838TP') +  'Barrel I.D. (C): .186 in'), 'W': D(round(.57 * 25.4, 3), PW('838TP') +  'Tang Width (W): .57 in'), 'F': D(round(.64 * 25.4, 3), PW('838TP') +  'Tang Length (F): .64 in'), 'Dl': D(round(.27 * 25.4, 3), PW('838TP') +  'Barrel Length (D): .27 in'), 'E': D(round(1.13 * 25.4, 3), PW('838TP') +  'Overall Length (E): 1.13 in'), 'T': D(round(.05 * 25.4, 3), PW('838TP') +  'Tang Thickness (T): .05 in'), 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('838TP') + ' Stud Size: 3/8" (M9), + 0.4 clearance', 'design'), 'I': D(round(.285 * 25.4, 3), PW('838TP') +  'Barrel Flare (I): .285 in')},
    '638TP': {'what': 'ProWire 638TP: heavy-duty tinned-copper lug, 6 AWG, 3/8" (M9) stud', 'colour': ('#c8c9c4', PW('638TP') + ': Material: Tinned Copper (tin colour)'), 'stud': '3/8" (M9)', 'C': D(round(.232 * 25.4, 3), PW('638TP') +  'Barrel I.D. (C): .232 in'), 'W': D(round(.53 * 25.4, 3), PW('638TP') +  'Tang Width (W): .53 in'), 'F': D(round(.64 * 25.4, 3), PW('638TP') +  'Tang Length (F): .64 in'), 'Dl': D(round(.425 * 25.4, 3), PW('638TP') +  'Barrel Length (D): .425 in'), 'E': D(round(1.32 * 25.4, 3), PW('638TP') +  'Overall Length (E): 1.32 in'), 'T': D(round(.061 * 25.4, 3), PW('638TP') +  'Tang Thickness (T): .061 in'), 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('638TP') + ' Stud Size: 3/8" (M9), + 0.4 clearance', 'design'), 'I': D(round(.342 * 25.4, 3), PW('638TP') +  'Barrel Flare (I): .342 in')},
    '610TP': {'what': 'ProWire 610TP: heavy-duty tinned-copper lug, 6 AWG, #10 (M5) stud', 'colour': ('#c8c9c4', PW('610TP') + ': Material: Tinned Copper (tin colour)'), 'stud': '#10 (M5)', 'C': D(round(.232 * 25.4, 3), PW('610TP') +  'Barrel I.D. (C): .232 in'), 'W': D(round(.474 * 25.4, 3), PW('610TP') +  'Tang Width (W): .474 in'), 'F': D(round(.7 * 25.4, 3), PW('610TP') +  'Tang Length (F): .7 in'), 'Dl': D(round(.425 * 25.4, 3), PW('610TP') +  'Barrel Length (D): .425 in'), 'E': D(round(1.32 * 25.4, 3), PW('610TP') +  'Overall Length (E): 1.32 in'), 'T': D(round(.061 * 25.4, 3), PW('610TP') +  'Tang Thickness (T): .061 in'), 'hole': D(STUD['#10 (M5)'] + 0.4, PW('610TP') + ' Stud Size: #10 (M5), + 0.4 clearance', 'design'), 'I': D(round(.342 * 25.4, 3), PW('610TP') +  'Barrel Flare (I): .342 in')},
    'DL438': {'what': 'ProWire DL438: heavy-duty tinned-copper lug, 4 AWG, 3/8" (M9) stud', 'colour': ('#c8c9c4', PW('DL438') + ': Material: Tinned Copper (tin colour)'), 'stud': '3/8" (M9)', 'C': D(round(.275 * 25.4, 3), PW('DL438') +  'Barrel I.D. (C): .275 in'), 'W': D(round(.7 * 25.4, 3), PW('DL438') +  'Tang Width (W): .7 in'), 'F': D(round(.83 * 25.4, 3), PW('DL438') +  'Tang Length (F): .83 in'), 'Dl': D(round(.5 * 25.4, 3), PW('DL438') +  'Barrel Length (D): .5 in'), 'E': D(round(1.68 * 25.4, 3), PW('DL438') +  'Overall Length (E): 1.68 in'), 'T': D(round(.1 * 25.4, 3), PW('DL438') +  'Tang Thickness (T): .1 in'), 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('DL438') + ' Stud Size: 3/8" (M9), + 0.4 clearance', 'design'), 'OD': D(round(.425 * 25.4, 3), PW('DL438') +  'Barrel O.D.: .425 in')},
    'DL214': {'what': 'ProWire DL214: heavy-duty tinned-copper lug, 2 AWG, 1/4" (M6) stud', 'colour': ('#c8c9c4', PW('DL214') + ': Material: Tinned Copper (tin colour)'), 'stud': '1/4" (M6)', 'C': D(round(.385 * 25.4, 3), PW('DL214') +  'Barrel I.D. (C): .385 in'), 'W': D(round(.69 * 25.4, 3), PW('DL214') +  'Tang Width (W): .69 in'), 'F': D(round(.86 * 25.4, 3), PW('DL214') +  'Tang Length (F): .86 in'), 'Dl': D(round(.6 * 25.4, 3), PW('DL214') +  'Barrel Length (D): .6 in'), 'E': D(round(2.13 * 25.4, 3), PW('DL214') +  'Overall Length (E): 2.13 in'), 'T': D(round(.121 * 25.4, 3), PW('DL214') +  'Tang Thickness (T): .121 in'), 'hole': D(STUD['1/4" (M6)'] + 0.4, PW('DL214') + ' Stud Size: 1/4" (M6), + 0.4 clearance', 'design'), 'OD': D(round(.480 * 25.4, 3), PW('DL214') +  'Barrel O.D.: .480 in')},
}
RINGS = {
    '9906': {'what': 'ProWire 9906: hi-temp non-insulated ring terminal, 22-18 AWG, 3/8" (M9) stud', 'colour': ('#c9c8c2', PW('9906') + ' photo: bare tinned ring (reads silver)'), 'stud': '3/8" (M9)', 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('9906') + ' STUD SIZE 3/8" (M9), + 0.4 clearance', 'design'), 'W': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: the ring OD is 1.75 x the hole'), 'F': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'E': D(round(2.6 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: overall 2.6 x the hole'), 'C': D(1.7, PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-20 %: the barrel bore for 22-18 AWG'), 'Dl': D(round(0.9 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'T': D(0.8, PW('9906') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-25 %')},
    '9912': {'what': 'ProWire 9912: hi-temp non-insulated ring terminal, 16-14 AWG, 3/8" (M9) stud', 'colour': ('#c9c8c2', PW('9912') + ' photo: bare tinned ring (reads silver)'), 'stud': '3/8" (M9)', 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('9912') + ' STUD SIZE 3/8" (M9), + 0.4 clearance', 'design'), 'W': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: the ring OD is 1.75 x the hole'), 'F': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'E': D(round(2.6 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: overall 2.6 x the hole'), 'C': D(2.4, PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-20 %: the barrel bore for 16-14 AWG'), 'Dl': D(round(0.9 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'T': D(0.9, PW('9912') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-25 %')},
    '9918': {'what': 'ProWire 9918: hi-temp non-insulated ring terminal, 12-10 AWG, 3/8" (M9) stud', 'colour': ('#c9c8c2', PW('9918') + ' photo: bare tinned ring (reads silver)'), 'stud': '3/8" (M9)', 'hole': D(STUD['3/8" (M9)'] + 0.4, PW('9918') + ' STUD SIZE 3/8" (M9), + 0.4 clearance', 'design'), 'W': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: the ring OD is 1.75 x the hole'), 'F': D(round(1.75 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'E': D(round(2.6 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %: overall 2.6 x the hole'), 'C': D(3.6, PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-20 %: the barrel bore for 12-10 AWG'), 'Dl': D(round(0.9 * (STUD['3/8" (M9)'] + 0.4), 2), PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-15 %'), 'T': D(1.0, PW('9918') + ' photo, scaled from the hole that clears its STUD SIZE 3/8" (M9) stud', 'photo', '+-25 %')},
    '9916': {'what': 'ProWire 9916: hi-temp non-insulated ring terminal, 12-10 AWG, 1/4" (M6) stud', 'colour': ('#c9c8c2', PW('9916') + ' photo: bare tinned ring (reads silver)'), 'stud': '1/4" (M6)', 'hole': D(STUD['1/4" (M6)'] + 0.4, PW('9916') + ' STUD SIZE 1/4" (M6), + 0.4 clearance', 'design'), 'W': D(round(1.75 * (STUD['1/4" (M6)'] + 0.4), 2), PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-15 %: the ring OD is 1.75 x the hole'), 'F': D(round(1.75 * (STUD['1/4" (M6)'] + 0.4), 2), PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-15 %'), 'E': D(round(2.6 * (STUD['1/4" (M6)'] + 0.4), 2), PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-15 %: overall 2.6 x the hole'), 'C': D(3.6, PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-20 %: the barrel bore for 12-10 AWG'), 'Dl': D(round(0.9 * (STUD['1/4" (M6)'] + 0.4), 2), PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-15 %'), 'T': D(1.0, PW('9916') + ' photo, scaled from the hole that clears its STUD SIZE 1/4" (M6) stud', 'photo', '+-25 %')},
}

def lug_bodies(pn):
    s = LUGS.get(pn) or RINGS.get(pn)
    v = {k: (K.v(d) if isinstance(d, Dim) else d) for k, d in s.items() if k not in ("what", "colour", "title", "ends", "stud")}
    W, F, T, E = v["W"], v["F"], v["T"], v["E"]
    hole = v["hole"]
    tang = cyl_z(W / 2, 0.0, T, 0, 0) + box(0, F - W / 2, -W / 2, W / 2, 0.0, T)
    tang -= cyl_z(hole / 2, -1, T + 1, 0, 0)
    bar_od = v["OD"] if "OD" in v else v["C"] + 2 * max(0.8, T * 0.45)
    x0 = F - W / 2
    barrel = box(x0, x0 + 1.5, -bar_od / 2 * 0.8, bar_od / 2 * 0.8, 0.0, T) if bar_od > 0 else None
    from build123d import Axis, Cylinder, Pos, Rot
    L_bar = E - F - 1.0                       # the barrel runs from the tang to the overall length E
    tube = Pos(x0 + 1.0, 0, bar_od / 2) * Rot(0, 90, 0) * Cylinder(bar_od / 2, L_bar, align=(Align_c(), Align_c(), Align_m()))
    tube -= Pos(x0 + 0.5, 0, bar_od / 2) * Rot(0, 90, 0) * Cylinder(v["C"] / 2, L_bar + 2.0, align=(Align_c(), Align_c(), Align_m()))
    body = tang + tube + (barrel if barrel else tang)
    out = [K.body(body, f"{pn} {'lug' if pn in LUGS else 'ring'}", s["colour"][0], finish="metal")]
    return out


def Align_c():
    from build123d import Align
    return Align.CENTER


def Align_m():
    from build123d import Align
    return Align.MIN


def module(pn, ends):
    s = LUGS.get(pn) or RINGS.get(pn)
    m = types.SimpleNamespace()
    m.P = {k: d for k, d in s.items() if isinstance(d, Dim)}
    m.COLORS = {"metal": s["colour"]}
    b = lug_bodies(pn)
    bb = Compound(children=b).bounding_box()
    m.PART = {"pid": pn, "endpoints": ends, "maker": "ProWire USA", "pn": pn, "title": f"ProWire {pn}", "what": s["what"],
              "shape_basis": "datasheet dims" if pn in LUGS else "scaled from photo", "viewset": "floor", "kind": "piece",
              "family": "rings and lugs", "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"{bb.size.X:.1f} long, tang {K.v(s['W']):g} wide", "frame": "tang on z = 0, stud hole at the origin, barrel toward +X",
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"wire": "+X"}},
              "refs": [("[1]", "prowireusa.com", "ProWire product pages (dimension tables, photos)")],
              "unknowns": ([] if pn in LUGS else ["ProWire prints no dimensions for its hi-temp rings: sized off its photo "
                                                 "against the stud they take (+-15 %)."]),
              "notes": [f"lands on: {', '.join(ends)}"]}
    m.build = lambda: (lug_bodies(pn), [], [])
    m.attach_points = lambda: [{"n": "wire", "ep": ends[0], "at": [round(K.v(s["E"]) - K.v(s["W"]) / 2, 2), 0.0, 1.0],
                                "dir": [1, 0, 0], "kind": "crimp barrel"}]
    m.mount_points = lambda: [{"n": "stud", "at": [0.0, 0.0, 0.0], "dir": [0, 0, -1], "d": K.v(s["hole"]), "note": s.get("stud", "")}]
    m.CHECKS = [("overall length E (ProWire)", lambda b: round(b[0].bounding_box().size.X, 1), round(K.v(s["E"]), 1), 0.6),
                ("tang width W (ProWire)", lambda b: round(b[0].bounding_box().size.Y, 2), K.v(s["W"]), 0.05)]
    return m


def load():
    """Build LUGS / RINGS from the ProWire tables read on 2026-09-29 (scratch copies of the pages)."""
    return


# ------------------------------------------------------------------------------------------ stud stacks (pins.json)
MAN = "reference_documents/component_drawings/motec_pdm_user_manual.pdf"
P47 = f"{MAN} PDF p.50 (printed p.47, 'Mounting Dimensions', PDM15 and PDM30)"
P47S = f"{P47}, side view of the stud, scaled at its printed 17.9 (the values motec_pdm.py uses, PR #443)"
PCON = f"{MAN} PDF p.46-47 (connector C: 'M6 stud', 'Mating: eyelet and M6 nut', 'C_1 Battery +')"
ORDER = ("proposed, the builder's call: the ring that carries the stud's whole current sits on the seat, the others follow "
         "in the registry's order. No source on file gives a stacking order, and the registry gives none.")
CLOCK = "design: the barrels are drawn spread round the stud so they clear; the real clocking follows the cable runs"
PDM_STUD = {"stud_l": D(17.9, f"{P47}: the M6 stud stands 17.9 out of the flat case front", "maker"),
            "stud_d": D(6.0, f"{P47}: 'M6 Stud'", "maker"),
            "base_af": D(14.0, P47S, "scaled", "the black insulating hex base, across flats"),
            "base_t": D(6.5, P47S, "scaled", "the hex base's height: the rings seat on it"),
            "nut_af": D(10.0, P47S, "scaled", "the M6 nut, across flats"),
            "nut_t": D(5.0, P47S, "scaled", "the nut's height")}
STACKS = {
    "FAN-JUNCTION": {"base": "2103", "order": ["21", "FAN_LEG1", "FAN_LEG2"],
                     "stud": "3/8-16 UNC x 3/4 in (Blue Sea 2101-2103 drawing table; product page 'Stud Size 3/8\"-16 x 3/4\"')",
                     "torque": "140 in-lb (15.82 Nm): reference_documents/web_snapshots/www.bluesea.com__PowerPost_Plus_-_3_8in-16"
                               "_Stud.md 'Terminal Stud Torque'",
                     "nut": "Blue Sea's own split lock washer and terminal nut (drawn as the 2101-2103 drawing shows them)"},
    "PDM30-STUD": {"base": "PDM", "order": ["PDM_BPOS", "DAK_CONST_FH", "PCS_BATT_FH", "TRANS_BATT_FH"],
                   "stud": f"M6, 17.9 out of the case front ({P47}; {PCON})",
                   "torque": {"unknown": True, "needs": "MoTeC's torque for the M6 battery stud: neither the PDM user manual "
                                                        "nor the PDM30 data sheet on file prints one"},
                   "nut": f"M6 nut ({PCON}); no part named in the registry",
                   "cap": f"{P47}: 'Cover power stud with insulating cap'; the registry names no cap"},
    "PDM15-STUD": {"base": "PDM", "order": ["PDM15_BPOS"],
                   "stud": f"M6, 17.9 out of the case front ({P47}; {PCON})",
                   "torque": {"unknown": True, "needs": "MoTeC's torque for the M6 battery stud: neither the PDM user manual "
                                                        "nor the PDM30 data sheet on file prints one"},
                   "nut": f"M6 nut ({PCON}); no part named in the registry",
                   "cap": f"{P47}: 'Cover power stud with insulating cap'; the registry names no cap"},
}
CAP_MISSING = "the stud's insulating cap (MoTeC p.47: 'Cover power stud with insulating cap'; not named in the registry)"
BANK_LAYOUT = ("layout only: the bank's studs are not picked, so the rings lie in a row in the registry's ring order "
               "(no stud, no stack)")


def _term(end, wire):
    for t in K.registry()["terminations"]:
        if t["endpoint"] == end and t["wire"] == wire:
            return t
    raise KeyError((end, wire))


def _placed(pn, label, z, ang_deg, x=0.0):
    from build123d import Pos, Rot
    b = lug_bodies(pn)[0]
    s_ = LUGS.get(pn) or RINGS.get(pn)
    return K.body(Pos(x, 0, z) * Rot(0, 0, ang_deg) * b, label, s_["colour"][0], finish="metal")


def stack_module(end):
    import math
    from build123d import Pos, RegularPolygon, extrude
    st = STACKS[end]
    order = st["order"]
    rings = [(w, _term(end, w)["part"]) for w in order]
    n = len(rings)
    angs = [i * 360.0 / n for i in range(n)] if n > 1 else [0.0]
    P, COLORS = {}, {}
    if st["base"] == "2103":
        import fam_power as FP
        base_P = dict(FP.PP)
        seat = K.v(FP.PP["seat_z"])
        P.update({k: FP.PP[k] for k in ("A", "stud_d", "stud_l", "seat_z", "hex0_h", "washer_t", "washer_d", "nut_ac", "nut_h")})
        COLORS.update({k: FP.COL[k] for k in ("base", "stud")})
    else:
        seat = K.v(PDM_STUD["base_t"])
        P.update(PDM_STUD)
        COLORS["stud"] = ("#bab1a8", "MoTeC product photo: the stud's nut reads zinc-plated steel (as motec_pdm.py, PR #443)")
        COLORS["stud base"] = ("#1d1d1f", f"{P47S}: the black insulating hex base")
    zs, z = [], seat
    for w, pn in rings:
        s_ = LUGS.get(pn) or RINGS.get(pn)
        P[f"T_{pn}"] = s_["T"]
        zs.append(z)
        z += K.v(s_["T"])
    top = z
    for w, pn in rings:
        COLORS[pn] = (LUGS.get(pn) or RINGS.get(pn))["colour"]

    def build_bodies():
        out = []
        if st["base"] == "2103":
            import fam_power as FP
            out += FP.powerpost_bodies(stack_h=top - seat)
        else:
            v = {k: K.v(d) for k, d in PDM_STUD.items()}
            hexb = extrude(RegularPolygon(v["base_af"] / 2 / math.cos(math.pi / 6), 6), amount=v["base_t"])
            stud = cyl_z(v["stud_d"] / 2, v["base_t"], v["stud_l"], 0, 0)
            nut = Pos(0, 0, top) * extrude(RegularPolygon(v["nut_af"] / 2 / math.cos(math.pi / 6), 6), amount=v["nut_t"])
            nut -= cyl_z(v["stud_d"] / 2, 0, 99, 0, 0)
            out += [K.body(hexb, f"{end}: MoTeC insulating hex base (black)", "#1d1d1f"),
                    K.body(stud, f"{end}: M6 stud", "#bab1a8", finish="metal"),
                    K.body(nut, f"{end}: M6 nut", "#bab1a8", finish="metal")]
        for i, ((w, pn), zi, a) in enumerate(zip(rings, zs, angs)):
            out.append(_placed(pn, f"{end}: ring {i + 1} of {n}, {pn} ({w})", zi, a))
        return out

    rows = []
    for i, ((w, pn), zi, a) in enumerate(zip(rings, zs, angs)):
        rows.append({"pin": f"ring {i + 1}", "endpoint": end, "wire": w, "match": ".",
                     "name": f"{pn} ({w})", "full_name": f"ring {i + 1} of {n} from the seat: {pn} on {w}",
                     "at": (0.0, 0.0, round(zi, 3)), "dir": (round(math.cos(math.radians(a)), 4), round(math.sin(math.radians(a)), 4), 0),
                     "stud": st["stud"], "stack": f"{i + 1} of {n} (1 = on the seat)", "ring": pn,
                     "order_basis": ORDER if n > 1 else "one ring"})
    if st["base"] == "2103":
        import fam_power as FP
        v = {k: K.v(d) for k, d in FP.PP.items()}
        thread = v["A"] - seat
        used = (top - seat) + v["washer_t"] + v["nut_h"]
    else:
        v = {k: K.v(d) for k, d in PDM_STUD.items()}
        thread = v["stud_l"] - v["base_t"]
        used = (top - seat) + v["nut_t"]
    photo = [pn for _, pn in rings if pn in RINGS]
    fit = (f"the rings{', washer' if st['base'] == '2103' else ''} and nut take {used:.2f} of the {thread:.2f} mm of stud "
           f"above the seat"
           + (f"; {', '.join(sorted(set(photo)))} thickness is photo-scaled (+-25 %), so the margin is +-{0.25 * sum(K.v(RINGS[p]['T']) for p in photo):.2f}"
              if photo else ""))
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    bb = Compound(children=build_bodies()).bounding_box()
    pieces_ = ([st["base"]] if st["base"] == "2103" else []) + sorted({pn for _, pn in rings})
    missing = [CAP_MISSING] if "cap" in st else []
    m.PART = {"pid": end, "endpoints": [end], "maker": "(assembly)", "pn": " + ".join(pn for _, pn in rings),
              "title": f"{end} stud stack", "kind": "assembly", "family": "rings and lugs",
              "what": f"{end}: the rings on the stud in their stack order, with the wire on each ({st['stud']})",
              "shape_basis": "datasheet dims", "viewset": "floor",
              "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"{n} ring(s) on the stud; {fit}",
              "frame": ("the post's base at z = 0, the stud up (+Z)" if st["base"] == "2103"
                        else "the PDM's flat case front at z = 0, the stud up (+Z) out of it"),
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "prowireusa.com", "ProWire product pages"), ("[2]", "k5_registry.json", "terminations")],
              "pieces": pieces_, "missing": missing,
              "unknowns": ([] if n == 1 else [f"Stack order {ORDER}", f"Clocking {CLOCK}"])
                          + ([f"Torque: {st['torque']['needs']}"] if isinstance(st["torque"], dict) else []),
              "notes": [f"stud: {st['stud']}", f"torque: {st['torque'] if isinstance(st['torque'], str) else 'unknown'}",
                        f"nut: {st['nut']}", f"fit: {fit}"] + ([f"cap: {st['cap']}"] if "cap" in st else [])}
    m.build = lambda: (build_bodies(), [], [])
    m.attach_points = lambda: [{"n": f"ring{i + 1}", "ep": end, "at": [0.0, 0.0, round(zi, 3)],
                                "dir": [round(math.cos(math.radians(a)), 4), round(math.sin(math.radians(a)), 4), 0],
                                "kind": f"{pn} ({w})"} for i, ((w, pn), zi, a) in enumerate(zip(rings, zs, angs))]
    m.mount_points = lambda: [{"n": "stud", "at": [0.0, 0.0, 0.0], "dir": [0, 0, -1], "d": 6.0 if st["base"] != "2103" else 9.525,
                               "note": st["stud"]}]
    m.terminals = lambda: rows
    m.PINS_EXTRA = {"stud": st["stud"], "torque": st["torque"], "stack_order": ORDER if n > 1 else "one ring",
                    "clocking": CLOCK, "nut": st["nut"], "fit": fit, **({"cap": st["cap"]} if "cap" in st else {})}
    nring = n
    m.CHECKS = [("rings on the stud (registry terminations)", lambda b: sum(1 for x in b if ": ring " in (x.label or "")), nring, 0),
                ("top ring's seat above the stud's seat (the rings below it)",
                 lambda b: round(max(x.bounding_box().min.Z for x in b if ": ring " in (x.label or "")) - seat, 2),
                 round(zs[-1] - seat, 2), 0.02)]
    return m


def bank_module(end):
    import math
    terms = [t for t in K.registry()["terminations"] if t["endpoint"] == end]
    terms.sort(key=lambda t: int(re.sub(r"\D", "", str(t.get("cavity"))) or 0))
    pitch = 24.0
    P = {"pitch": D(pitch, "layout only: the rings are spaced 24 apart in a row", "design")}
    COLORS = {}
    placed = []
    for i, t in enumerate(terms):
        pn = str(t.get("part") or "")
        if pn in LUGS or pn in RINGS:
            COLORS[pn] = (LUGS.get(pn) or RINGS.get(pn))["colour"]
        placed.append((t, pn, i * pitch))

    def build_bodies():
        out = []
        for t, pn, x in placed:
            if pn in LUGS or pn in RINGS:
                out.append(_placed(pn, f"{end}: {t['cavity']}, {pn} ({t['wire']})", 0.0, 90.0, x))
        return out

    rows = []
    for t, pn, x in placed:
        ok = pn in LUGS or pn in RINGS
        rows.append({"pin": str(t["cavity"]), "endpoint": end, "wire": t["wire"], "match": ".",
                     "name": f"{pn if ok else 'ring OPEN'} ({t['wire']})", "full_name": f"{t['cavity']}: {pn} on {t['wire']}",
                     "at": (x, 0.0, 0.0), "dir": (0, 1, 0), "stud": "not assigned: the bank's studs are not picked",
                     "stack": "open", "ring": pn if ok else None,
                     **({} if ok else {"note": f"the registry: {pn}"})})
    bb = Compound(children=build_bodies()).bounding_box()
    nr = sum(1 for _, pn, _x in placed if pn in LUGS or pn in RINGS)
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    m.PART = {"pid": end, "endpoints": [end], "maker": "(assembly)", "pn": f"{len(terms)} rings",
              "title": f"{end} ring layout", "kind": "assembly", "family": "rings and lugs",
              "what": f"{end}: every ring the registry lands here, with its wire ({BANK_LAYOUT})",
              "shape_basis": "datasheet dims", "viewset": "floor",
              "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"{nr} rings drawn of {len(terms)} terminations", "frame": f"{BANK_LAYOUT}; ring 1 at the origin, along +X",
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "prowireusa.com", "ProWire product pages"), ("[2]", "k5_registry.json", "terminations")],
              "pieces": sorted({pn for _, pn, _x in placed if pn in LUGS or pn in RINGS}), "missing": [BANK],
              "unknowns": ["Which ring sits on which stud, and in what order, waits on the stud bank (receipt "
                           "2026-09-29_part-models-batch5 proposes Blue Sea 2103 posts)."],
              "notes": [BANK_LAYOUT]}
    m.build = lambda: (build_bodies(), [], [])
    m.attach_points = lambda: [{"n": f"ring{i + 1}", "ep": end, "at": [x, 0.0, 0.0], "dir": [0, 1, 0], "kind": f"{pn} ({t['wire']})"}
                               for i, (t, pn, x) in enumerate(placed)]
    m.mount_points = lambda: []
    m.terminals = lambda: rows
    m.PINS_EXTRA = {"stud": "not assigned: the bank's studs are not picked", "stack_order": "open (waits on the stud bank)",
                    "layout": BANK_LAYOUT}
    m.CHECKS = [("rings drawn (registry terminations with a ring picked)", lambda b: len(b), nr, 0)]
    return m


def pieces():
    out = []
    use = {}
    for t in K.registry()["terminations"]:
        for pn in re.split(r"\s*\+\s*", str(t.get("part") or "")):
            if pn in LUGS or pn in RINGS:
                use.setdefault(pn, [])
                if t["endpoint"] not in use[pn]:
                    use[pn].append(t["endpoint"])
    for pn in list(LUGS) + list(RINGS):
        if pn in use:
            out.append(module(pn, use[pn]))
    for end in STACKS:
        out.append(stack_module(end))
    for end in ("GND-BANK-ENG", "GND-BANK-CAB"):
        out.append(bank_module(end))
    return out


BANK = "stud bank hardware: not picked (proposed for the registry pass: see receipt 2026-09-29_part-models-batch5)"
END_NEEDS = {"GND-BANK-ENG": ["9906", "9912", "9918", "638TP", "838TP", "238LTP", BANK,
                              "one ring for the AMP Research kit lead (the registry: gauge unknown, IM75146 names none)"],
             "GND-BANK-CAB": ["9906", "9912", "9918", BANK],
             "PS-STUDS": ["238LTP", "2516LTP", "DL438", "838TP", "610TP", "9918", "AMP-KIT-RING (the AMP Research kit's own ring)"],
             "FAN-JUNCTION": ["9918", "838TP"], "PDM30-STUD": ["DL214", "9916"], "PDM15-STUD": ["DL214"]}
for _e in ("FAN-JUNCTION", "PDM30-STUD", "PDM15-STUD", "GND-BANK-ENG", "GND-BANK-CAB"):
    END_NEEDS[_e].append(_e)          # the stack (or layout) assembly with its pins.json


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    for m in pieces():
        print(f"== {m.PART['pid']}")
        K.run(m, out_root / m.PART["pid"])


if __name__ == "__main__":
    main(sys.argv)
