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
    return out


BANK = "stud bank hardware: not picked (proposed for the registry pass: see receipt 2026-09-29_part-models-batch5)"
END_NEEDS = {"GND-BANK-ENG": ["9906", "9912", "9918", "638TP", "838TP", "238LTP", BANK,
                              "one ring for the AMP Research kit lead (the registry: gauge unknown, IM75146 names none)"],
             "GND-BANK-CAB": ["9906", "9912", "9918", BANK],
             "PS-STUDS": ["238LTP", "2516LTP", "DL438", "838TP", "610TP", "9918", "AMP-KIT-RING (the AMP Research kit's own ring)"],
             "FAN-JUNCTION": ["9918", "838TP"], "PDM30-STUD": ["DL214", "9916"], "PDM15-STUD": ["DL214"]}


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    for m in pieces():
        print(f"== {m.PART['pid']}")
        K.run(m, out_root / m.PART["pid"])


if __name__ == "__main__":
    main(sys.argv)
