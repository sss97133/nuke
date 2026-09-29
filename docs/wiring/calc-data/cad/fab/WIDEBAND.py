#!/usr/bin/env python3
"""Lambda: MoTeC LTCD dual lambda controller (MoTeC 61301, 'LTCD 4.9') and its two Bosch LSU 4.9 sensors.

The LTCD is drawn from MoTeC's dimension drawing 61301_ltcd_dimensions (front 38 x 26, top 38 x 23.5, two Ø3.2 holes 32
apart and 23 above the bottom edge, looms 200 from the top edge to the connector ends) and the LTC user manual p.31-32
(connectors: A and B take the Bosch LSU 4.9 sensor plugs; Power/CAN is a DTM 4-pin, mating #68054; pins 1 Battery -,
2 CAN Lo, 3 CAN Hi, 4 Battery +). MoTeC's manual prints the case as 38 x 26 x 14: the drawing's 23.5 is kept (the
larger) until the part is measured. The sensors are drawn from Bosch's offer drawing B 261 209 358-03 (LSU 4.9) and the
Bosch Motorsport data sheet 69034379 (M18x1.5, wrench 22, 950 mm lead with the automotive connector).

Frame (mm): origin at the centre of the LTCD's back (the mounting face). +Z out of the back toward the logo face, +Y up
(holes at the top, looms leave the bottom edge), +X right. The two sensors are drawn beside the box at +X (display
position only: they sit in the exhaust bungs, wire up, on their own 950 mm leads).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/WIDEBAND.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DWG = ("https://assets.motec.com.au/strapi/61301_ltcd_dimensions_230fa1e2c4.svg (MoTeC LTCD dimension drawing, fetched "
       "2026-09-29)")
MAN = "reference_documents/component_drawings/motec_ltcd_user_manual.pdf"
SC = f"scaled off {DWG} at its printed 38 width (its looms and plugs are not drawn to scale: ±3)"
BOS = ("https://www.bosch-motorsport.com/media/catalog_content/downloads_catalog/pdf_catalog/offer_drawing_lsu_with_motorsport_"
       "connector_69039371_lambda_sensor_lsu_4-9.pdf (Bosch offer drawing B 261 209 358-03, fetched 2026-09-29)")
BDS = ("https://www.bosch-motorsport.com/media/catalog_content/downloads_catalog/pdf_catalog/data_sheet_69034379_lambda_sensor_"
       "lsu_4-9.pdf (Bosch Motorsport data sheet, fetched 2026-09-29)")
PHURL = "https://assets.motec.com.au/strapi/large_LTCD_7c7a5eed0a.webp (MoTeC, fetched 2026-09-29)"
PHOTO = f"MoTeC product photo {PHURL}, k-means of the region"

P = {
    "box_w": Dim(38.0, f"{DWG} (front view)"),
    "box_h": Dim(26.0, f"{DWG} (front view)"),
    "box_d": Dim(23.5, f"{DWG} (top view)", note=f"{MAN} p.31 prints 38 x 26 x 14: conflict, the larger kept"),
    "hole_d": Dim(3.2, f"{DWG} (Ø3.2, 2x); {MAN} p.31 'Mounting holes spacing 32 mm (Ø3.2 mm)'"),
    "hole_pitch": Dim(32.0, f"{DWG}; {MAN} p.31"),
    "hole_z": Dim(23.0, f"{DWG} (hole centres 23 above the bottom edge)"),
    "loom_reach": Dim(200.0, f"{DWG} (top edge to the connector ends, 200)"),
    "box_r": Dim(1.5, SC, "scaled", "case edge round"),
    "loom_d": Dim(4.3, SC, "scaled", "loom sleeve"),
    "loom_x_a": Dim(-27.0, SC, "scaled", "sensor A plug centre across"), "loom_x_b": Dim(3.3, SC, "scaled", "sensor B plug"),
    "loom_x_p": Dim(31.0, SC, "scaled", "Power/CAN plug"),
    "plug_w": Dim(22.0, SC, "scaled", "LSU sensor plug body"), "plug_t": Dim(16.0, SC, "scaled"), "plug_l": Dim(36.0, SC, "scaled"),
    "dtm_w": Dim(18.0, SC, "scaled", "DTM 4-pin plug body"), "dtm_t": Dim(13.0, SC, "scaled"), "dtm_l": Dim(30.0, SC, "scaled"),
    # ---- Bosch LSU 4.9
    "lsu_thread": Dim(18.0, f"{BOS} (M18x1.56e); {BDS} 'Thread M18x1.5'"),
    "lsu_hex": Dim(22.0, f"{BOS} (SW 22-0.33); {BDS} 'Wrench size 22 mm'"),
    "lsu_tip": Dim(27.8, f"{BOS} (seat face to the probe tip)"),
    "lsu_thread_l": Dim(8.7, f"{BOS} (8.7 ±0.2)"),
    "lsu_tube_d": Dim(15.0, f"{BOS} (Ø15 protection tube)"),
    "lsu_gasket_d": Dim(22.6, f"{BOS} (Ø22.6)"), "lsu_gasket_t": Dim(2.0, f"{BOS} (2 -0.6)"),
    "lsu_hex_l": Dim(7.5, f"{BOS} (7.5)"),
    "lsu_body_l": Dim(57.0, f"{BOS} (57 ±4, seat face to the end of the sleeve)"),
    "lsu_body_d": Dim(17.6, f"{BOS} (Ø17.6 max)"),
    "lsu_weld_d": Dim(16.0, f"{BOS} ('Maximum Ø16 on Laser Weld')"),
    "lsu_wire_start": Dim(97.0, f"{BOS} (97 ±8, seat face to the lead)"),
    "lsu_lead": Dim(950.0, f"{BDS} 'Wire length L 95.0 cm' (automotive connector 1928.404.687)"),
    "lsu_sleeve_d": Dim(7.0, f"sized off {BOS} against its printed Ø15", "scaled", "lead sleeve"),
    "lsu_show": Dim(60.0, "the sensors are drawn with 60 mm of lead (the rest of the 950 is left off)", "design"),
}
COLORS = {
    "box": ("#1d1d1f", PHOTO + " (case, black)"),
    "loom": ("#121213", PHOTO + " (loom sleeve, black)"),
    "plug": ("#262628", PHOTO + " (LSU plugs, black)"),
    "dtm": ("#8f9396", PHOTO + " (Power/CAN DTM plug, grey)"),
    "mark": ("#f1f1f1", PHOTO + " (logo and 'LTCD 4.9', white)"),
    "steel": ("#a7a9ab", "stainless probe and hex: not in the MoTeC photo; drawn steel"),
    "lsu_body": ("#77797c", "sensor housing: not in the MoTeC photo; drawn steel grey"),
    "lsu_sleeve": ("#c9c2b3", f"fibre-glass / silicone sleeve ({BDS} 'Sleeve fiber glass / silicone coated'): drawn natural"),
}
PART = {
    "pid": "WIDEBAND", "endpoints": ["WIDEBAND"], "maker": "MoTeC (sensors: Bosch)", "pn": "61301 LTCD + 2 x Bosch LSU 4.9",
    "title": "MoTeC LTCD dual lambda controller with two Bosch LSU 4.9 sensors",
    "what": "Lambda controller MoTeC LTCD (61301) with two Bosch LSU 4.9 wideband sensors (bought with the M130 via Dave)",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 38.0, "w": 23.5, "h": 26.0},
    "dims_note": "LTCD case 38 x 26 x 23.5 (MoTeC drawing; the manual says 14 thick); looms reach 200 from the case top; each "
                 "LSU 4.9 is 27.8 below and 97 above its seat face, M18x1.5, hex 22, on a 950 mm lead",
    "margin": {"mm": 9.5, "why": "case depth: MoTeC's drawing 23.5 vs its manual 14 (the larger kept); outline, holes, reach and "
                                "the sensor printed; the looms and plugs are scaled off a drawing not to scale (±3)"},
    "frame": "origin at the centre of the LTCD's back; +Z toward the logo face, +Y up (looms leave the bottom), sensors drawn at +X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"logo": "+Z", "looms": "-Y"}},
    "photo": {"url": "https://assets.motec.com.au/strapi/large_LTCD_7c7a5eed0a.webp", "page": "https://www.motec.com.au/products/LTCD",
              "fetched": "2026-09-29"},
    "photo_short": "MoTeC product photo LTCD",
    "branding": ["'MoTeC' logo box", "'LTCD 4.9'"],
    "dims_draw": [("front", "x", "box_w", 10), ("front", (-19.0, -13.0, 0), (-19.0, 13.0, 0), "box_h", -10),
                  ("right", (0, 13.0, 0), (0, 13.0, 23.5), "box_d", 8)],
    "refs": [("[1]", "61301_ltcd_dimensions", "MoTeC LTCD dimension drawing 61301 (front, top, side, looms)"),
             ("[2]", "motec_ltcd_user_manual.pdf", "MoTeC LTC user manual p.31-32 (physical, connectors)"),
             ("[3]", "offer_drawing_lsu", "Bosch offer drawing B 261 209 358-03, LSU 4.9"),
             ("[4]", "data_sheet_69034379", "Bosch Motorsport LSU 4.9 data sheet"),
             ("[5]", "scaled off", "measured off [1] at its printed 38 (looms and plugs not to scale)"),
             ("[6]", "sensors are drawn with", "our choice: the sensors' leads are cut short in the model")],
    "drawing_notes": [
        ("Power/CAN (DTM 4-pin, mating #68054): 1 Battery - (LTCD_GND), 2 CAN Lo, 3 CAN Hi, 4 Battery + (#64). MoTeC p.32.", "#10151a"),
        ("Sensors A and B plug into the LTCD's own looms; mount them 10-90 degrees from vertical, wire up (MoTeC; Bosch).", "#10151a"),
        ("Case depth: MoTeC's drawing 23.5, its manual 14. The model keeps 23.5; measure the part.", "assumed"),
    ],
    "unknowns": ["Case depth 23.5 (drawing) vs 14 (manual p.31): measure the part.",
                 "Loom exit positions, plug bodies and fan-out are scaled off a drawing whose looms are not to scale (±3).",
                 "Where the LTCD mounts is open (mounts.yaml: inside a frame rail near the O2 bungs); the sensors' leads are 950 mm."],
}
BW, BH, BD = K.v(P["box_w"]), K.v(P["box_h"]), K.v(P["box_d"])
YT, YB = BH / 2, -BH / 2
YEND = YT - K.v(P["loom_reach"])               # connector ends
LOOMS = [("A", K.v(P["loom_x_a"]), -5.0), ("B", K.v(P["loom_x_b"]), 0.0), ("PWR", K.v(P["loom_x_p"]), 5.0)]
SENS_X = (70.0, 100.0)


def lsu(x0, y_seat, z0, n):
    """One LSU 4.9, axis along +Y from its seat face at (x0, y_seat, z0): probe down, lead up."""
    out = []
    tip, tl = K.v(P["lsu_tip"]), K.v(P["lsu_thread_l"])
    tube = D.cyl(K.v(P["lsu_tube_d"]), tip - tl + 0.01, at=(x0, y_seat - tip, z0), axis="y")
    thread = D.cyl(K.v(P["lsu_thread"]), tl, at=(x0, y_seat - tl, z0), axis="y")
    gasket = D.cyl(K.v(P["lsu_gasket_d"]), K.v(P["lsu_gasket_t"]), at=(x0, y_seat - K.v(P["lsu_gasket_t"]), z0), axis="y")
    hexp = D.hex_prism(K.v(P["lsu_hex"]), K.v(P["lsu_hex_l"]), at=(x0, y_seat, z0), axis="y")
    out.append(K.body(tube + thread + hexp, f"WIDEBAND LSU 4.9 sensor {n}: probe, M18x1.5 thread and 22 hex", COLORS["steel"][0],
                      finish="metal"))
    out.append(K.body(gasket, f"WIDEBAND LSU 4.9 sensor {n}: seat gasket", COLORS["steel"][0], finish="metal"))
    hl, bl = K.v(P["lsu_hex_l"]), K.v(P["lsu_body_l"])
    body = D.cyl(K.v(P["lsu_weld_d"]), 30.0, at=(x0, y_seat + hl - 0.01, z0), axis="y")
    body += D.cyl(K.v(P["lsu_body_d"]), bl - hl - 30.0, at=(x0, y_seat + hl + 29.99, z0), axis="y")
    ws = K.v(P["lsu_wire_start"])
    body += D.cone(K.v(P["lsu_body_d"]) - 2.0, K.v(P["lsu_sleeve_d"]) + 1.5, ws - bl, at=(x0, y_seat + bl - 0.01, z0), axis="y")
    out.append(K.body(body, f"WIDEBAND LSU 4.9 sensor {n}: housing and grommet", COLORS["lsu_body"][0], finish="cast"))
    return out, (x0, y_seat + ws, z0)


def build():
    box = D.rbox(BW, BH, BD, r=K.v(P["box_r"]), r_top=K.v(P["box_r"]))
    hy = YB + K.v(P["hole_z"])
    for sx in (-1, 1):
        box -= D.cyl(K.v(P["hole_d"]), BD + 2, at=(sx * K.v(P["hole_pitch"]) / 2, hy, -1))
    parts = [K.body(box, "WIDEBAND LTCD case", COLORS["box"][0])]
    zc = BD / 2
    for n, x, x0 in LOOMS:
        kind = "dtm" if n == "PWR" else "plug"
        pl = K.v(P["dtm_l"]) if n == "PWR" else K.v(P["plug_l"])
        ytop = YEND + pl
        s1, p1 = D.lead((x0, YB + 0.5, zc), (0, -1, 0), 22.0, d=K.v(P["loom_d"]))
        s2, p2 = D.lead(p1, (x - x0, -60.0, 0), ((x - x0) ** 2 + 60.0 ** 2) ** 0.5, d=K.v(P["loom_d"]))
        s3, p3 = D.lead(p2, (0, -1, 0), p2[1] - ytop + 0.5, d=K.v(P["loom_d"]))
        parts.append(K.body(s1 + s2 + s3, f"WIDEBAND loom {n}", COLORS["loom"][0], finish="rubber"))
        if kind == "dtm":
            plug = Pos(x, YEND + pl / 2, zc) * Box(K.v(P["dtm_w"]), pl, K.v(P["dtm_t"]))
            parts.append(K.body(plug, "WIDEBAND Power/CAN plug (DTM 4-pin; mates #68054)", COLORS["dtm"][0]))
        else:
            plug = Pos(x, YEND + pl / 2, zc) * D.rbox(K.v(P["plug_w"]), pl, K.v(P["plug_t"]), r=2.0, align=D.CEN)
            parts.append(K.body(plug, f"WIDEBAND sensor {n} plug (Bosch LSU 4.9 sensor connector)", COLORS["plug"][0]))
    cosmetic = branding()
    for i, xs in enumerate(SENS_X):
        bodies, top = lsu(xs, -60.0, zc, "AB"[i])
        parts += bodies
        lead_, _ = D.lead(top, (0, 1, 0), K.v(P["lsu_show"]), d=K.v(P["lsu_sleeve_d"]))
        cosmetic.append(K.body(lead_, f"WIDEBAND LSU 4.9 sensor {'AB'[i]} lead (950 mm, cut short)", COLORS["lsu_sleeve"][0], finish="rubber"))
    keep = [K.body(Pos(0, YB - 20.0, zc) * Box(BW + 8, 40.0, BD + 8), "keep-out: loom exits and bend below the case (40 mm)",
                   "#2e7d32", alpha=0.25)]
    return parts, keep, cosmetic


def branding():
    items = []
    logo = Pos(0, 5.0, BD + 0.05) * (Box(26.0, 8.0, 0.1, align=D.BASE) - Box(24.6, 6.6, 0.3, align=D.BASE))
    items.append(K.body(logo, "WIDEBAND branding: logo frame (redrawn from the photo, cosmetic)", COLORS["mark"][0], finish="print"))
    for s, y, sz in (("MoTeC", 5.0, 5.2), ("LTCD 4.9", -5.5, 5.0)):
        t = K.text_solid(s, sz, (0, y, BD), depth=0.12, style="bolditalic" if s == "MoTeC" else "bold")
        items.append(K.body(t, f"WIDEBAND branding: '{s}' (redrawn from the photo, cosmetic)", COLORS["mark"][0], finish="print"))
    return items


def attach_points():
    x = K.v(P["loom_x_p"])
    return [{"n": "power_can", "ep": "WIDEBAND", "at": [x, round(YEND, 2), BD / 2], "dir": [0, -1, 0], "kind": "plug",
             "note": "DTM 4-pin male on the LTCD loom; the harness brings the DTM06-4S (#68054)"}]


def terminals():
    x = K.v(P["loom_x_p"])
    rows = []
    for pin, nm, wid in (("1", "Battery - (black)", "LTCD_GND"), ("2", "CAN Lo (green)", "CAN_LTCD_L"), ("3", "CAN Hi (white)", "CAN_LTCD_H"),
                         ("4", "Battery + (red)", "64")):
        dx = (int(pin) - 2.5) * 3.0
        rows.append({"pin": pin, "endpoint": "WIDEBAND", "name": nm, "full_name": f"Power/CAN DTM pin {pin}: {nm} (MoTeC p.32)",
                     "kind": "DTM size 20", "wires": [wid], "at": (x + dx * 0.0, YEND, BD / 2), "dir": (0, -1, 0),
                     "note": "pin face of the DTM plug; the pin-to-pin spacing is not modelled"})
    return rows


def mount_points():
    hy = YB + K.v(P["hole_z"])
    return [{"n": f"hole_{s}", "at": [sx * K.v(P["hole_pitch"]) / 2, hy, BD], "dir": [0, 0, -1], "d": K.v(P["hole_d"]),
             "note": "Ø3.2 through the case, screw from the logo face"} for s, sx in (("L", -1), ("R", 1))]


def _holes(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01}
    return sorted(cs)


CHECKS = [
    ("case width", lambda b: b[0].bounding_box().size.X, 38.0),
    ("case height", lambda b: b[0].bounding_box().size.Y, 26.0),
    ("case depth (drawing)", lambda b: b[0].bounding_box().size.Z, 23.5),
    ("hole count", lambda b: len(_holes(b)), 2),
    ("hole spacing", lambda b: _holes(b)[1][0] - _holes(b)[0][0], 32.0),
    ("holes above the bottom edge", lambda b: _holes(b)[0][1] - YB, 23.0),
    ("looms: case top to plug ends", lambda b: YT - min(x.bounding_box().min.Y for x in b if "plug" in x.label), 200.0),
    ("LSU: seat to probe tip", lambda b: -60.0 - [x for x in b if "probe" in x.label][0].bounding_box().min.Y, 27.8),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
