"""Lamp family for the K5 device models: round sealed-beam-size headlamps, flat panel and strip LED lamps, and (in the
factory lamp batch) the 1973-87 C/K factory lamps.

Each maker's lamp is a function returning the part script's namespace (P, COLORS, PART, build, attach_points, terminals,
mount_points, CHECKS, part_meta); the per-end scripts pick the lamp and the end. Frames: origin at the centre of the
mounting face; +Z out of the mounting face toward where the light goes (a headlamp: forward; a dome or cargo lamp: down
into the cab), +Y up in the maker's view; the body and leads behind the mounting face (-Z).
"""
import math
import sys
from pathlib import Path
from types import SimpleNamespace

from build123d import Axis, Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402


def _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS):
    ns = SimpleNamespace(P=P, COLORS=COLORS, PART=PART, build=build, attach_points=attach_points, terminals=terminals,
                         mount_points=mount_points, CHECKS=CHECKS)
    ns.part_meta = lambda bodies: D.part_meta(ns, bodies)
    return vars(ns)


def _leads(pid, C, specs, p0, direction, length, d=2.0, fan=2.6):
    """Flying leads from one exit point: specs = [(colour name, label)]; returns (solids, [free ends])."""
    out, ends = [], []
    n = len(specs)
    for i, (col, lab) in enumerate(specs):
        off = (i - (n - 1) / 2) * fan
        start = (p0[0] + off, p0[1], p0[2])
        s, e = D.lead(start, direction, length, d=d)
        out.append(K.body(s, f"{pid} lead {col} ({lab})", D.LEAD_HEX.get(col, "#888888"), finish="rubber"))
        ends.append(e)
    return out, ends


# ------------------------------------------------------------------------------------------ Truck-Lite 27270C
TL_BRO = ("reference_documents/web_snapshots/www.truck-lite.com__LEDHeadlightBrochure_1.md (Truck-Lite LED headlight brochure: "
          "'27270C | LED Headlight, 7\" round | 12V-24V | 1.45A-2.95A | Aluminum | Polycarbonate | H4')")
TL_A1 = ("reference_documents/web_snapshots/a1truckparts.net__truck-lite-27270c-clear-7-round-high-low-beam-headlight-hardwired-"
         "h4-connectors.md ('Number of Wires: 3', 'Wire Gauge: 16', 'Plug Side Two: H4 Connector')")
TL_SIDE = ("https://www.truck-lite.com/media/trucklite/TL_Spin_Folders/27270C/spinset_01_07_27270C.jpg (Truck-Lite side photo, "
           "fetched 2026-09-29)")
TL_FRONT = ("https://www.truck-lite.com/media/trucklite/TL_Spin_Folders/27270C/spinset_01_01_27270C.jpg (Truck-Lite front photo, "
            "fetched 2026-09-29)")
TL_PH = f"sized off Truck-Lite's side photo {TL_SIDE} against the 7 in flange (2.01 px/mm)"


def truck_lite_27270c(end):
    pid = end
    side = "left" if end.endswith("L") else "right"
    P = {
        "flange_d": Dim(178.0, f"{TL_BRO}: '7\" round'", note="7 in nominal = the flange; SAE type-2 7 in lamps are 178 across"),
        "flange_t": Dim(9.4, TL_PH, "photo", "mounting flange ring"),
        "lens_d": Dim(168.0, TL_PH, "photo", "lens bezel"), "lens_proud": Dim(34.3, TL_PH, "photo", "lens front ahead of the flange's back"),
        "sink_d0": Dim(170.0, TL_PH, "photo", "heat sink behind the flange"), "sink_d1": Dim(55.0, TL_PH, "photo", "heat sink back face"),
        "depth": Dim(60.2, TL_PH, "photo", "heat sink back behind the flange's back face"),
        "plug_l": Dim(13.9, TL_PH, "photo", "H4 plug below the back"),
        "fin_n": Dim(18, TL_PH, "photo", "heat-sink fins round the back"),
        "lead_d": Dim(2.4, f"{TL_A1}: 16 AWG leads", "assumed", "insulated OD of a 16 AWG lead"),
        "lead_l": Dim(60.0, "the lead length to the H4 plug is not printed", "assumed", "drawn as the photo's short loop"),
    }
    COLORS = {
        "sink": ("#332d2b", f"Truck-Lite side photo {TL_SIDE}, k-means (heat sink, black, 67%)"),
        "bezel": ("#c5c5ca", f"Truck-Lite front photo {TL_FRONT}, k-means (bezel ring, 63%)"),
        "lens": ("#e9eef2", "clear polycarbonate lens (brochure): drawn clear"),
        "reflector": ("#9da3a8", f"Truck-Lite front photo {TL_FRONT} (reflector, silver)"),
        "led_bar": ("#1e1e20", f"Truck-Lite front photo {TL_FRONT} (LED bar across the middle, black)"),
        "plug": ("#1c1c1d", f"Truck-Lite side photo {TL_SIDE} (H4 plug, black)"),
    }
    wires = {"HEADLIGHT-L": ("85a", "85b", "HL_L_GND"), "HEADLIGHT-R": ("86a", "86b", "HL_R_GND")}[end]
    PART = {
        "pid": pid, "endpoints": [end], "maker": "Truck-Lite", "pn": "27270C",
        "title": f"Truck-Lite 27270C 7 in round LED headlamp ({side})",
        "what": f"{side.capitalize()} headlight, Truck-Lite 27270C 7 in round LED, low / high + ground on an H4 plug",
        "shape_basis": "scaled from photo", "viewset": "wall",
        "dims_mm": {"l": 178.0, "w": 178.0, "h": 108.4},
        "dims_note": "Ø178 (7 in) flange; lens 34.3 ahead of the flange's back, heat sink 60.2 behind it and the H4 plug ~14 "
                     "more (all but the 7 in scaled off Truck-Lite's side photo)",
        "margin": {"mm": 4.0, "why": "only the 7 in size is printed; depth, bezel and heat sink sized off Truck-Lite's own side "
                                    "photo (near-orthographic, ±4)"},
        "frame": "origin at the centre of the flange's back (on the headlamp bucket's ring); +Z forward (the light), +Y up; "
                 "heat sink and plug behind (-Z)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"lens": "+Z", "plug": "-Z"}},
        "photo": {"url": "https://www.truck-lite.com/media/trucklite/TL_Spin_Folders/27270C/spinset_01_01_27270C.jpg",
                  "page": "https://www.truck-lite.com/", "fetched": "2026-09-29"},
        "photo_short": "Truck-Lite spin photos 27270C (front and side)",
        "branding": [],
        "dims_draw": [("front", "x", "flange_d", -10), ("right", "z", "depth", -10)],
        "refs": [("[1]", "LEDHeadlightBrochure", "Truck-Lite LED headlight brochure (27270C: 7 in round, aluminium, H4)"),
                 ("[2]", "a1truckparts", "A-1 Truck Parts listing: 3 wires, 16 AWG, H4 connector"),
                 ("[3]", "sized off Truck-Lite", "sized off Truck-Lite's side spin photo against the 7 in flange"),
                 ("[4]", "not printed", "not in any source: assumed")],
        "drawing_notes": [
            (f"Three 16 AWG leads hardwired to an H4 plug: LOW ({wires[0]}), HIGH ({wires[1]}), GND ({wires[2]}); which H4 blade is", "#10151a"),
            ("which is open until Truck-Lite's instruction sheet is read (registry).", "assumed"),
            ("Held in the factory bucket by the 7 in retaining ring over the flange.", "#10151a"),
        ],
        "unknowns": ["Depth, bezel and heat sink are sized off the side photo (±4): Truck-Lite prints only '7 in round'.",
                     "Which H4 blade is LOW / HIGH / GND on the 27270C lead is not on the saved listings (registry)."],
    }
    v = K.v

    def build():
        fd, ft = v(P["flange_d"]), v(P["flange_t"])
        flange = D.cyl(fd, ft, at=(0, 0, 0))
        lp = v(P["lens_proud"])
        bezel = D.cyl(v(P["lens_d"]), lp - ft - 3.0, at=(0, 0, ft)) - D.cyl(v(P["lens_d"]) - 10.0, lp, at=(0, 0, ft + 1.0))
        lens = D.cyl(v(P["lens_d"]) - 10.0, 2.0, at=(0, 0, lp - 5.0)) + D.dome(v(P["lens_d"]) - 12.0, 3.0, at=(0, 0, lp - 3.0))
        refl = D.cone(v(P["lens_d"]) - 14.0, v(P["lens_d"]) - 40.0, 6.0, at=(0, 0, lp - 12.0))
        dp = v(P["depth"])
        sink = D.cone(v(P["sink_d1"]), v(P["sink_d0"]), dp + 0.01, at=(0, 0, -dp))
        nf = int(v(P["fin_n"]))
        shell = sink - D.cone(v(P["sink_d1"]) - 12.0, v(P["sink_d0"]) - 12.0, dp + 2, at=(0, 0, -dp - 1))
        slots = []
        for i in range(nf // 2):
            slot = Pos(0, 0, -dp + 3.0) * Box(3.0, v(P["sink_d0"]) + 4, dp - 15.0, align=D.BASE)
            slots.append(slot.rotate(Axis.Z, 360.0 * i / nf))
        sink -= Compound(children=slots).fuse() & shell
        bodies = [K.body(flange + sink, f"{pid} housing: flange and finned heat sink (aluminium)", COLORS["sink"][0], finish="cast"),
                  K.body(bezel, f"{pid} bezel ring", COLORS["bezel"][0], finish="chrome"),
                  K.body(lens, f"{pid} lens (clear polycarbonate)", COLORS["lens"][0], alpha=0.35, finish="lens"),
                  K.body(refl, f"{pid} reflector", COLORS["reflector"][0], finish="chrome")]
        pl = v(P["plug_l"])
        plug = Pos(0, -18.0, -dp - pl) * Box(16.0, 12.0, pl, align=D.BASE)
        bodies.append(K.body(plug, f"{pid} H4 plug (3 blades)", COLORS["plug"][0]))
        bar = Pos(0, 8.0, lp - 18.0) * Box(v(P["lens_d"]) - 26.0, 22.0, 12.0, align=D.BASE)
        bodies.append(K.body(bar & D.cyl(v(P["lens_d"]) - 12.0, 40.0, at=(0, 0, lp - 30.0)), f"{pid} LED bar (photo)", COLORS["led_bar"][0]))
        cos, _ = _leads(pid, COLORS, [("red", "lead 1"), ("green", "lead 2"), ("white", "lead 3")], (0, -6.0, -dp), (0, -0.6, -1),
                        v(P["lead_l"]) * 0.3, d=v(P["lead_d"]))
        keep = [K.body(D.cyl(v(P["sink_d0"]) + 10, 40.0, at=(0, 0, -dp - 40.0)), "keep-out: plug and leads behind the heat sink (40 mm)",
                       "#2e7d32", alpha=0.25)]
        return bodies, keep, cos

    def attach_points():
        dp, pl = v(P["depth"]), v(P["plug_l"])
        return [{"n": "h4", "ep": end, "at": [0, -18.0, round(-dp - pl, 2)], "dir": [0, 0, -1], "kind": "H4 plug",
                 "note": f"LOW {wires[0]}, HIGH {wires[1]}, GND {wires[2]} (blade order open)"}]

    def terminals():
        dp, pl = v(P["depth"]), v(P["plug_l"])
        z = -dp - pl
        return [{"pin": nm, "endpoint": end, "name": f"H4 {nm} blade (position on the plug open)", "kind": "H4 blade", "wires": [w],
                 "at": (dx, -18.0, z), "dir": (0, 0, -1)} for nm, w, dx in (("LOW", wires[0], -4.5), ("HIGH", wires[1], 0.0),
                                                                             ("GND", wires[2], 4.5))]

    def mount_points():
        return [{"n": "flange", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "flange on the bucket's adjuster ring, retaining ring over it"}]

    CHECKS = [
        ("7 in flange", lambda b: b[0].bounding_box().size.X, 178.0),
        ("lens ahead of the flange's back", lambda b: Compound(children=b).bounding_box().max.Z, 34.3, 0.2),
        ("heat sink behind the flange's back", lambda b: -b[0].bounding_box().min.Z, 60.2),
    ]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ Truck-Lite 80251C
TL80 = ("reference_documents/web_snapshots/www.truck-lite.com__80251c-1.md (Truck-Lite 80251C page, fetched 2026-09-28; re-read "
        "2026-09-29)")
TL80_PHURL = ("https://www.truck-lite.com/media/trucklite/TL_Spin_Folders/80251C/spinset_01_01_80251C.jpg (Truck-Lite, fetched "
              "2026-09-29)")
TL80_PH = f"sized off Truck-Lite's front photo {TL80_PHURL} against the printed 462.03 length (146.05 height for the vertical)"


def truck_lite_80251c(end="CARGO-LAMP"):
    pid = end
    P = {
        "length": Dim(462.03, f"{TL80}: 'Length 18.19 inches (462.03 mm)'", note="overall with the bracket"),
        "height": Dim(146.05, f"{TL80}: 'Height 5.75 inches (146.05 mm)'"),
        "depth": Dim(27.43, f"{TL80}: 'Depth 1.08 inches (27.43 mm)'; 'will mount in 1'' deep pocket'"),
        "plate_t": Dim(1.6, TL80_PH, "photo", "bracket plate"),
        "frame_l": Dim(406.9, TL80_PH, "photo", "lens gasket frame"), "frame_h": Dim(97.4, TL80_PH, "photo"),
        "lens_l": Dim(392.0, TL80_PH, "photo", "lens"), "lens_h": Dim(85.7, TL80_PH, "photo"),
        "lens_proud": Dim(3.4, TL80_PH, "photo", "lens and gasket frame in front of the plate"),
        "slot_x": Dim(81.0, TL80_PH, "photo", "top and bottom slots each side of centre"),
        "slot_y": Dim(60.6, TL80_PH, "photo", "top and bottom slots off the centre line"),
        "end_x": Dim(222.6, TL80_PH, "photo", "end slots off the centre"), "end_y": Dim(50.0, TL80_PH, "photo"),
        "slot_w": Dim(31.0, TL80_PH, "photo", "long slot"), "slot_t": Dim(7.0, TL80_PH, "photo"),
        "lead_l": Dim(150.0, "the stripped leads' length is not printed", "assumed"),
    }
    COLORS = {
        "plate": ("#d6e1e3", f"Truck-Lite photo {TL80_PHURL}, k-means (bracket, white powder coat, 80%)"),
        "body": ("#d6e1e3", f"{TL80}: 'Aluminum with White Powder Coat Finish'"),
        "gasket": ("#45474a", f"Truck-Lite photo {TL80_PHURL} (gasket frame, black)"),
        "lens": ("#c3cccf", f"Truck-Lite photo {TL80_PHURL} (clear lens, 72%)"),
        "screw": ("#b8bcc0", "lens screws: drawn zinc"),
    }
    PART = {
        "pid": pid, "endpoints": [end], "maker": "Truck-Lite", "pn": "80251C",
        "title": "Truck-Lite 80251C 80 Series LED dome lamp",
        "what": "Cargo lamp, Truck-Lite 80251C 80 Series 10-LED dome, 2 A, white powder-coat aluminium, hardwired stripped leads",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 462.03, "w": 146.05, "h": 27.43},
        "dims_note": "462.03 x 146.05 x 27.43 overall with the bracket (Truck-Lite); the body sits in a 1 in pocket behind the plate",
        "margin": {"mm": 3.0, "why": "envelope printed by Truck-Lite; plate, lens, slots and body split sized off the photo (±3)"},
        "frame": "origin at the centre of the bracket plate's back (on the ceiling); +Z out of the ceiling toward the cargo floor "
                 "(the light), +Y along the 146 height; the body in its pocket behind (-Z)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"lens": "+Z", "leads": "-Z"}},
        "photo": {"url": "https://www.truck-lite.com/media/trucklite/TL_Spin_Folders/80251C/spinset_01_01_80251C.jpg",
                  "page": "https://www.truck-lite.com/80251c-1.html", "fetched": "2026-09-29"},
        "photo_short": "Truck-Lite photo 80251C",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10), ("front", "y", "height", -10), ("right", "z", "depth", 10)],
        "refs": [("[1]", "80251c-1", "Truck-Lite 80251C product page (dimensions, mounting, finish)"),
                 ("[2]", "sized off Truck-Lite", "sized off Truck-Lite's photo against the printed 462.03 x 146.05"),
                 ("[3]", "not printed", "not in any source: assumed")],
        "drawing_notes": [
            ("'8 Screw Bracket Mount': two slots top, two bottom, two each end. Leads: + (#74) and - (CARGO_GND), stripped (splice).", "#10151a"),
            ("Truck-Lite: 'will mount in 1'' deep pocket' - the body goes into a pocket in the top's ceiling.", "#10151a"),
        ],
        "unknowns": ["Plate / body split and the slot positions are sized off the photo (±3).",
                     "Lead colours and length are not printed; the spot in the top is open (mounts.yaml)."],
    }
    v = K.v
    L_, H_, DP = v(P["length"]), v(P["height"]), v(P["depth"])
    LP = v(P["lens_proud"])
    ZB = -(DP - LP - v(P["plate_t"]))           # body back

    def build():
        pt = v(P["plate_t"])
        plate = D.rbox(L_, H_, pt, r=10.0)
        sw, st = v(P["slot_w"]), v(P["slot_t"])
        for sx in (-1, 1):
            for sy in (-1, 1):
                plate -= Pos(sx * v(P["slot_x"]), sy * v(P["slot_y"]), -1) * D.rbox(sw, st, pt + 2, r=st / 2 - 0.01)
                plate -= Pos(sx * v(P["end_x"]), sy * v(P["end_y"]) * 0.0 + sy * 42.0, -1) * D.rbox(st, sw * 0.5, pt + 2, r=st / 2 - 0.01)
        fl, fh = v(P["frame_l"]), v(P["frame_h"])
        frame = Pos(0, 0, pt) * D.rbox(fl, fh, LP - 0.8, r=6.0) - Pos(0, 0, pt - 1) * D.rbox(v(P["lens_l"]), v(P["lens_h"]), LP + 2, r=4.0)
        lens = Pos(0, 0, pt) * D.rbox(v(P["lens_l"]), v(P["lens_h"]), LP, r=4.0)
        body = Pos(0, 0, ZB) * D.rbox(fl - 10, fh - 6, -ZB + 0.01, r=6.0)
        bodies = [K.body(plate + body, f"{pid} bracket plate and housing (aluminium)", COLORS["plate"][0], finish="paint"),
                  K.body(frame, f"{pid} lens gasket frame", COLORS["gasket"][0], finish="rubber"),
                  K.body(lens, f"{pid} lens (clear polycarbonate)", COLORS["lens"][0], alpha=0.6, finish="lens")]
        screws = []
        for x in (-106.5, 0.0, 106.5):
            for y in (-fh / 2 + 4, fh / 2 - 4):
                screws.append(D.cyl(4.5, 1.0, at=(x, y, pt + LP - 0.8)))
        for x in (-fl / 2 + 4, fl / 2 - 4):
            screws.append(D.cyl(4.5, 1.0, at=(x, 0, pt + LP - 0.8)))
        cos = [K.body(Compound(children=screws).fuse(), f"{pid} lens screws (8)", COLORS["screw"][0], finish="metal")]
        leads, _ = _leads(pid, COLORS, [("white", "+ #74"), ("black", "- CARGO_GND")], (fl / 2 - 30, 0, ZB), (0, 0, -1), v(P["lead_l"]))
        keep = [K.body(Pos(0, 0, ZB - 25.0) * Box(fl, fh, 25.0, align=D.BASE), "keep-out: leads and splice behind the body (25 mm)",
                       "#2e7d32", alpha=0.25)]
        return bodies, keep, cos + leads

    def attach_points():
        return [{"n": "leads", "ep": end, "at": [round(v(P["frame_l"]) / 2 - 30, 2), 0, round(ZB, 2)], "dir": [0, 0, -1],
                 "kind": "stripped leads", "note": "2 hardwired leads, stripped ends (splice D-609-03)"}]

    def terminals():
        x = v(P["frame_l"]) / 2 - 30
        return [{"pin": "+", "endpoint": end, "name": "lamp + lead", "kind": "stripped lead", "wires": ["74"], "at": (x - 1.3, 0, ZB),
                 "dir": (0, 0, -1), "free": (x - 1.3, 0, ZB - v(P["lead_l"]))},
                {"pin": "-", "endpoint": end, "name": "lamp - lead", "kind": "stripped lead", "wires": ["CARGO_GND"], "at": (x + 1.3, 0, ZB),
                 "dir": (0, 0, -1), "free": (x + 1.3, 0, ZB - v(P["lead_l"]))}]

    def mount_points():
        out = [{"n": f"slot_{'L' if sx < 0 else 'R'}{'T' if sy > 0 else 'B'}", "at": [sx * v(P["slot_x"]), sy * v(P["slot_y"]), 0],
                "dir": [0, 0, -1], "note": "bracket slot"} for sx in (-1, 1) for sy in (-1, 1)]
        out += [{"n": f"end_{'L' if sx < 0 else 'R'}{'T' if sy > 0 else 'B'}", "at": [sx * v(P["end_x"]), sy * 42.0, 0], "dir": [0, 0, -1],
                 "note": "end slot"} for sx in (-1, 1) for sy in (-1, 1)]
        return out

    CHECKS = [
        ("length", lambda b: b[0].bounding_box().size.X, 462.03),
        ("height", lambda b: b[0].bounding_box().size.Y, 146.05),
        ("depth", lambda b: Compound(children=b).bounding_box().size.Z, 27.43),
        ("body fits a 1 in pocket", lambda b: -b[0].bounding_box().min.Z <= 25.4, True),
    ]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ ORACLE 4514-003
OR_PAGE = ("reference_documents/web_snapshots/www.oraclelights.com__linear-universal-led-3rd-brake-light-chmsl-module-red.md "
           "(ORACLE 4514-003 page, fetched 2026-09-28)")
OR_PHURL = ("https://www.oraclelights.com/cdn/shop/files/4514-003_A_Primary_0cff9a94-4dc5-4af4-9078-fe02f1d1d6f8.webp "
            "(ORACLE, fetched 2026-09-29)")
OR_PH = f"sized off ORACLE's product photo {OR_PHURL} against the printed 7 in length"


def oracle_4514_003(end="CHMSL"):
    pid = end
    P = {
        "length": Dim(177.8, f"{OR_PAGE}: 'Length: 7 inches'"),
        "width": Dim(12.0, OR_PH, "photo", "module width (±3; the photo is lit and at an angle)"),
        "depth": Dim(8.0, OR_PH, "photo", "module depth off the mounting face (±3)"),
        "tab_l": Dim(10.0, OR_PH, "photo", "screw tab past each end"), "tab_hole": Dim(3.5, "screw-tab hole not printed", "assumed"),
        "lead_l": Dim(150.0, "the lead to the power connector is not printed", "assumed"),
        "plug_l": Dim(14.0, "the power connector is not described ('Power connector', read on arrival)", "assumed"),
    }
    COLORS = {
        "body": ("#141414", f"ORACLE photo {OR_PHURL} (module body, black)"),
        "lens": ("#d8262b", f"ORACLE photo {OR_PHURL} (red lens / LEDs, lit)"),
        "plug": ("#1d1d1e", "power connector: black (not described)"),
    }
    PART = {
        "pid": pid, "endpoints": [end], "maker": "ORACLE Lighting", "pn": "4514-003",
        "title": "ORACLE 4514-003 linear LED third brake light (red, 7 in)",
        "what": "Third brake light, ORACLE 4514-003 Linear Universal LED CHMSL module, red, 7 in, 6 W at 12-24 V, IP68",
        "shape_basis": "scaled from photo", "viewset": "wall",
        "dims_mm": {"l": 197.8, "w": 12.0, "h": 8.0},
        "dims_note": "177.8 long (7 in, ORACLE) plus a screw tab at each end; section 12 x 8 sized off ORACLE's photo (±3)",
        "margin": {"mm": 3.0, "why": "only the 7 in length is printed; the section, tabs and lead are sized off the photo or assumed"},
        "frame": "origin at the centre of the mounting face (screw tabs or VHB tape); +Z out toward the light, +X along the 7 in",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"lens": "+Z", "lead": "+X"}},
        "photo": {"url": "https://www.oraclelights.com/cdn/shop/files/4514-003_A_Primary_0cff9a94-4dc5-4af4-9078-fe02f1d1d6f8.webp",
                  "page": "https://www.oraclelights.com/products/linear-universal-led-3rd-brake-light-chmsl-module-red", "fetched": "2026-09-29"},
        "photo_short": "ORACLE photo 4514-003",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10)],
        "refs": [("[1]", "linear-universal-led-3rd-brake-light", "ORACLE 4514-003 product page ('Length: 7 inches')"),
                 ("[2]", "sized off ORACLE", "sized off ORACLE's photo against the printed 7 in"),
                 ("[3]", "not printed", "not in any source: assumed")],
        "drawing_notes": [("Dual mounting: screw tabs or VHB tape (ORACLE). #93 (+) and CHMSL_GND (-) at its power connector.", "#10151a")],
        "unknowns": ["Section, tabs and lead are not printed: sized off the photo or assumed (the connector is read on arrival).",
                     "The spot is open: top of the tailgate or the top's rear header (mounts.yaml)."],
    }
    v = K.v
    L_, W_, DP = v(P["length"]), v(P["width"]), v(P["depth"])

    def build():
        body = D.rbox(L_, W_, DP * 0.6, r=2.0)
        lens = Pos(0, 0, DP * 0.6 - 0.01) * D.rbox(L_ - 4.0, W_ - 3.0, DP * 0.4, r=1.5, r_top=1.2)
        tl = v(P["tab_l"])
        tabs = []
        for sx in (-1, 1):
            t = Pos(sx * (L_ / 2 + tl / 2 - 1.0), 0, 0) * Box(tl + 2.0, W_ - 2.0, 1.5, align=D.BASE)
            t -= D.cyl(v(P["tab_hole"]), 4, at=(sx * (L_ / 2 + tl / 2), 0, -1))
            tabs.append(t)
        bodies = [K.body(body + tabs[0] + tabs[1], f"{pid} body and screw tabs", COLORS["body"][0]),
                  K.body(lens, f"{pid} red lens (LED strip)", COLORS["lens"][0], finish="lens")]
        lead, end_p = D.lead((L_ / 2 - 6.0, 0, 2.0), (1, 0, -0.1), v(P["lead_l"]), d=3.0)
        plug = D.rbox(v(P["plug_l"]), 8.0, 6.0, align=D.CEN, at=(end_p[0] + v(P["plug_l"]) / 2, 0, end_p[2]))
        cos = [K.body(lead, f"{pid} lead (2-core)", COLORS["body"][0], finish="rubber"),
               K.body(plug, f"{pid} power connector", COLORS["plug"][0])]
        return bodies, [], cos

    def _plug_at():
        x = L_ / 2 - 6.0 + v(P["lead_l"]) * 0.995 + v(P["plug_l"])
        return (x, 0.0, 2.0 - 0.1 * v(P["lead_l"]) * 0.995)

    def attach_points():
        return [{"n": "power", "ep": end, "at": [round(c, 2) for c in _plug_at()], "dir": [1, 0, 0], "kind": "connector",
                 "note": "power connector at the end of the module's lead (type read on arrival)"}]

    def terminals():
        pa = _plug_at()
        return [{"pin": "+", "endpoint": end, "name": "+ feed", "kind": "connector (type open)", "wires": ["93"], "at": pa, "dir": (1, 0, 0)},
                {"pin": "-", "endpoint": end, "name": "- ground", "kind": "connector (type open)", "wires": ["CHMSL_GND"], "at": pa,
                 "dir": (1, 0, 0)}]

    def mount_points():
        tl = v(P["tab_l"])
        return [{"n": f"tab_{'L' if sx < 0 else 'R'}", "at": [sx * (L_ / 2 + tl / 2), 0, 1.5], "dir": [0, 0, -1], "note": "screw tab"}
                for sx in (-1, 1)]

    CHECKS = [("length (without the tabs)", lambda b: b[1].bounding_box().size.X + 4.0, 177.8)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ Lumitec Mini Rail2
LU_PAGE = ("reference_documents/web_snapshots/www.lumiteclighting.com__mini-rail2-led-utility-light-2.md (Lumitec Mini Rail2 page, "
           "fetched 2026-09-28)")
LU_PHURL = "https://www.lumiteclighting.com/media/catalog/product/r/a/rail2_mini_3.png (Lumitec, fetched 2026-09-29)"
LU_PH = f"sized off Lumitec's product photo {LU_PHURL} against the printed 5.90 in length"


def lumitec_mini_rail2(end):
    pid = end
    wires = {"UNDERDASH-LAMPS": ("68", "UD_GND"), "FOOTWELL-LAMPS": ("69", "FW_GND")}[end]
    where = {"UNDERDASH-LAMPS": "Under-dash lamp", "FOOTWELL-LAMPS": "Footwell lamp"}[end]
    P = {
        "length": Dim(149.9, f"{LU_PAGE}: 'Height 5.90in (14.97cm)'", note="Lumitec calls the long side its height"),
        "width": Dim(28.2, f"{LU_PAGE}: 'Width 1.11in (2.82cm)'"),
        "depth": Dim(15.3, f"{LU_PAGE}: 'Depth 0.60in (1.53cm)'"),
        "cap_l": Dim(22.0, LU_PH, "photo", "end cap"), "hole_d": Dim(4.0, LU_PH, "photo", "screw hole in each end cap"),
        "lead_l": Dim(150.0, "the lead length is not printed", "assumed"),
    }
    COLORS = {
        "body": ("#757877", f"Lumitec photo {LU_PHURL}, k-means (aluminium body, 86%)"),
        "cap": ("#dbdbdd", f"Lumitec photo {LU_PHURL}, k-means (end caps, white, 72%)"),
        "lens": ("#f1f3f3", "diffuser lens: white (photo)"),
    }
    PART = {
        "pid": pid, "endpoints": [end], "maker": "Lumitec", "pn": "101241 (Mini Rail2, warm white)",
        "title": f"Lumitec Mini Rail2 101241 LED utility light ({where.lower()})",
        "what": f"{where}, Lumitec Mini Rail2 101241 warm white LED, 360 mA at 12 V, 95 lm, 10-30 V, IP65, leads",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 149.9, "w": 28.2, "h": 15.3},
        "dims_note": "149.9 x 28.2 x 15.3 (Lumitec: 5.90 x 1.11 x 0.60 in); screw holes in the end caps (photo)",
        "margin": {"mm": 1.5, "why": "envelope printed by Lumitec; end caps and holes sized off the photo"},
        "frame": "origin at the centre of the mounting face (the back, on the dash underside); +Z toward the light, +X along the rail",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"lens": "+Z", "lead": "-X"}},
        "photo": {"url": "https://www.lumiteclighting.com/media/catalog/product/r/a/rail2_mini_3.png",
                  "page": "https://www.lumiteclighting.com/mini-rail2-led-utility-light-2", "fetched": "2026-09-29"},
        "photo_short": "Lumitec photo Mini Rail2",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10), ("front", "y", "width", -10), ("right", "z", "depth", 10)],
        "refs": [("[1]", "mini-rail2", "Lumitec Mini Rail2 page (5.90 x 1.11 x 0.60 in)"),
                 ("[2]", "sized off Lumitec", "sized off Lumitec's photo against the printed 5.90 in"),
                 ("[3]", "not printed", "not in any source: assumed")],
        "drawing_notes": [(f"+ ({wires[0]}) and - ({wires[1]}) leads spliced (MiniSeal D-609-03). part_media rates 101241 a family match;"
                           " the end may carry more than one lamp (mounts.yaml).", "#10151a")],
        "unknowns": ["Lead exit and lead length are not printed (drawn from one end cap).",
                     "The part is proposed (mounts.yaml status proposed); drawn one lamp per end."],
    }
    v = K.v
    L_, W_, DP = v(P["length"]), v(P["width"]), v(P["depth"])
    CL = v(P["cap_l"])

    def build():
        body = Pos(0, 0, 0) * D.rbox(L_ - 2 * CL + 2, W_ - 4.0, DP - 2.0, r=3.0, r_top=4.0)
        lens = Pos(0, 0, DP - 2.5) * D.rbox(L_ - 2 * CL, W_ - 10.0, 2.5, r=2.0)
        caps = []
        for sx in (-1, 1):
            c = Pos(sx * (L_ / 2 - CL / 2), 0, 0) * D.rbox(CL, W_, DP, r=5.0, r_top=6.0)
            c -= D.cyl(v(P["hole_d"]), DP + 2, at=(sx * (L_ / 2 - CL / 2), 0, -1))
            caps.append(c)
        bodies = [K.body(body, f"{pid} rail body (aluminium)", COLORS["body"][0], finish="metal"),
                  K.body(lens, f"{pid} diffuser lens", COLORS["lens"][0], finish="lens"),
                  K.body(caps[0] + caps[1], f"{pid} end caps", COLORS["cap"][0])]
        leads, _ = _leads(pid, COLORS, [("red", f"+ {wires[0]}"), ("black", f"- {wires[1]}")], (-L_ / 2, 0, DP * 0.4), (-1, 0, 0),
                          v(P["lead_l"]), d=1.8)
        return bodies, [], leads

    def attach_points():
        return [{"n": "leads", "ep": end, "at": [round(-L_ / 2, 2), 0, round(DP * 0.4, 2)], "dir": [-1, 0, 0], "kind": "flying leads",
                 "note": "2 leads from the end cap (splice)"}]

    def terminals():
        return [{"pin": pin, "endpoint": end, "name": f"{pin} lead", "kind": "flying lead", "wires": [w], "at": (-L_ / 2, dy, DP * 0.4),
                 "dir": (-1, 0, 0), "free": (-L_ / 2 - v(P["lead_l"]), dy, DP * 0.4)} for pin, w, dy in (("+", wires[0], -1.3), ("-", wires[1], 1.3))]

    def mount_points():
        return [{"n": f"hole_{'L' if sx < 0 else 'R'}", "at": [sx * (L_ / 2 - CL / 2), 0, DP], "dir": [0, 0, -1], "d": v(P["hole_d"]),
                 "note": "screw through the end cap"} for sx in (-1, 1)]

    CHECKS = [("length", lambda b: Compound(children=b).bounding_box().size.X, 149.9),
              ("width", lambda b: Compound(children=b).bounding_box().size.Y, 28.2),
              ("depth", lambda b: Compound(children=b).bounding_box().size.Z, 15.3)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)
