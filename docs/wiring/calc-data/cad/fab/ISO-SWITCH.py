#!/usr/bin/env python3
"""Isolator dash switch: Blue Sea Systems 2145 momentary SPDT (ON)-OFF-(ON) Contura switch with LED (ships with the 7700).

Drawn from Blue Sea's instruction sheet 990180170-006 p.2 control-switch drawing: face 25.65 x 49.91, 15.10 in front of
the panel, 28.58 behind it to the back of the housing, panel cut-out 21.08 x 36.83; and Blue Sea's 2145-2146 pin-out
drawing for the pin positions (+8 and -7 on the top row, 1 / 2 / 3 down the left column, seen from the back). The pin
rows and the housing steps are scaled off the side view at its printed 49.91; the column spacing is not printed.

Frame (mm): origin at the centre of the bezel's back face, where it seats on the dash panel. +Z out of the panel toward
the driver, +Y up (the red 'ON' half up), +X right as the driver sees it; the housing and pins are behind the panel (-Z).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/ISO-SWITCH.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf"
DWG = f"{DS} p.2, control switch drawing"
PIN = ("https://d2pyqm2yd3fw2i.cloudfront.net/files/resources/pin_out_drawing/2145-2146.jpg (Blue Sea 2145-2146 pin-out "
       "drawing, fetched 2026-09-29)")
SC = f"scaled off {DS} p.2 control switch side view (400 dpi), scale from its printed 49.91 face height"
PHURL = "https://dh778tpvmt77t.cloudfront.net/images/products/2145.jpg (Blue Sea, fetched 2026-09-29)"
PHOTO = f"Blue Sea product photo {PHURL}, k-means of the region"
PH = f"sized off the Blue Sea product photo {PHURL} against the printed 25.65 face width"

P = {
    "face_w": Dim(25.65, f"{DWG} (1.010 in)"),
    "face_h": Dim(49.91, f"{DWG} (1.965 in)"),
    "proud": Dim(15.10, f"{DWG} (0.595 in, in front of the panel)"),
    "behind": Dim(28.58, f"{DWG} (1.125 in, panel to the back of the housing)"),
    "cut_w": Dim(21.08, f"{DWG} (panel cut-out 0.830 in)"),
    "cut_h": Dim(36.83, f"{DWG} (panel cut-out 1.450 in)"),
    "bezel_t": Dim(5.5, PH, "photo", "bezel frame thickness in front of the panel; the rocker fills the rest of the 15.10"),
    "bezel_wall": Dim(2.3, PH, "photo", "bezel frame wall"),
    "body1_h": Dim(35.1, SC, "scaled", "front housing height behind the panel (fills the cut-out)"),
    "body1_l": Dim(12.5, SC, "scaled", "front housing length behind the panel"),
    "body2_h": Dim(31.5, SC, "scaled", "rear housing height"),
    "pin_row_top": Dim(14.4, SC, "scaled", "pins 8 and 7 above the face centre"),
    "pin_row_1": Dim(8.3, SC, "scaled", "pin 1 above the face centre (pin 2 at the centre, pin 3 8.3 below)"),
    "pin_l": Dim(10.1, SC, "scaled", "tab length past the housing"),
    "pin_col": Dim(10.0, "the pin columns' spacing is not printed (side view only)", "assumed",
                   "left column 8 / 1 / 2 / 3, right column 7 (seen from the back)"),
    "tab_w": Dim(6.35, "registry family 'contura': 0.250 in quick-connect (not confirmed on a Blue Sea 2145 sheet)", "assumed"),
    "tab_t": Dim(0.81, "0.250 in quick-connect tab, 0.032 in (SAE J858 size; not on a Blue Sea sheet)", "assumed"),
}
COLORS = {
    "bezel": ("#1f1f21", PHOTO + " (bezel, black)"),
    "rocker_top": ("#c0282d", PHOTO + " (upper rocker, red)"),
    "rocker_bot": ("#2a2a2c", PHOTO + " (lower rocker, black)"),
    "housing": ("#232325", PHOTO + " (housing behind the panel)"),
    "tab": ("#c8c3b6", "tin-plated tab: not sampled (thin in the photo); drawn tin"),
    "mark_white": ("#f1f1f1", PHOTO + " (white marks on the rocker)"),
    "lens": ("#f4f4f2", PHOTO + " (LED lens strip, white)"),
}
PART = {
    "pid": "ISO-SWITCH", "endpoints": ["ISO-SWITCH"], "maker": "Blue Sea Systems", "pn": "2145",
    "title": "Blue Sea Systems 2145 Contura control switch (7700 remote)",
    "what": "Isolator dash switch, Blue Sea 2145 momentary SPDT (ON)-OFF-(ON) Contura with LED, included with the 7700",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 25.65, "w": 49.91, "h": 53.78},
    "dims_note": "face 25.65 x 49.91, 15.10 in front of the panel, 28.58 behind it to the housing back and ~10 more to the tab "
                 "tips (scaled); panel cut-out 21.08 x 36.83",
    "margin": {"mm": 1.0, "why": "face, depth and cut-out printed by Blue Sea; the housing steps and pin rows scaled (±1); "
                                "the pin-column spacing is assumed"},
    "frame": "origin at the centre of the bezel's back face on the dash panel; +Z toward the driver, +Y up (red 'ON' half up), "
             "housing and pins behind (-Z)",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"rocker": "+Z", "pins": "-Z"}},
    "photo": {"url": "https://dh778tpvmt77t.cloudfront.net/images/products/2145.jpg", "page": "https://www.bluesea.com/products/2145",
              "fetched": "2026-09-29"},
    "photo_short": "Blue Sea product photo 2145",
    "branding": ["battery symbol", "white LED strip", "'I ON'", "double arrows on the lower rocker"],
    "dims_draw": [("front", "x", "face_w", -8), ("front", "y", "face_h", -8), ("right", "z", "proud", 8)],
    "refs": [("[1]", "p.2, control switch drawing", "Blue Sea 990180170-006 p.2: control switch drawing (face, side, cut-out)"),
             ("[2]", "2145-2146", "Blue Sea 2145-2146 pin-out drawing (circuit diagram)"),
             ("[3]", "scaled off", "measured off [1] at its printed scale (49.91 face)"),
             ("[4]", "sized off the Blue Sea product photo", "sized off Blue Sea's product photo against the printed 25.65"),
             ("[5]", "registry family", "the registry's contura family (0.250 in quick-connect)"),
             ("[6]", "not printed", "not in any source: assumed")],
    "drawing_notes": [
        ("Pins (from the back): +8 LED power and 1 OPEN / 2 common / 3 CLOSE down the left column, -7 LED ground top right.", "#10151a"),
        ("ISO_SW_PWR lands on 2 + 8 (jumpered), ISO_OPEN on 1, ISO_CLOSE on 3, ISO_LED on 7 (registry).", "#10151a"),
        ("Cut the panel 21.08 x 36.83 (Blue Sea: test cut the hole in the actual centre).", "#10151a"),
        ("The rocker marks are redrawn from Blue Sea's photo (cosmetic).", "photo"),
    ],
    "unknowns": ["The pin columns' spacing is not printed (side view only): assumed 10 mm.",
                 "Tab size 0.250 x 0.032 in is the family's, not confirmed on a 2145 sheet (bluesea.com answered 403 on 2026-09-28).",
                 "The rocker's rocked positions are not drawn: it is drawn at OFF (centre)."],
}
FW, FH = K.v(P["face_w"]), K.v(P["face_h"])
ZF = K.v(P["proud"])
ZB = -K.v(P["behind"])
XL, XR = -K.v(P["pin_col"]) / 2, K.v(P["pin_col"]) / 2          # left / right pin columns as the driver sees them
# seen from the back the left column is the driver's right: pins 8/1/2/3 sit at +X from the driver's side
PINS = [("8", "LED power (+8)", XR, K.v(P["pin_row_top"])), ("7", "LED ground (-7)", XL, K.v(P["pin_row_top"])),
        ("1", "OPEN (1)", XR, K.v(P["pin_row_1"])), ("2", "common (2)", XR, 0.0), ("3", "CLOSE (3)", XR, -K.v(P["pin_row_1"]))]
WIRES = {"8": ["ISO_SW_PWR"], "7": ["ISO_LED"], "1": ["ISO_OPEN"], "2": ["ISO_SW_PWR"], "3": ["ISO_CLOSE"]}


def build():
    bt, bw = K.v(P["bezel_t"]), K.v(P["bezel_wall"])
    bezel = D.rbox(FW, FH, bt, r=3.2, r_top=1.2)
    bezel -= Pos(0, 0, 0.8) * D.rbox(FW - 2 * bw, FH - 2 * bw, bt, r=2.0)
    ih = (FH - 2 * bw) / 2
    top = Pos(0, ih / 2 + 0.2, 0.8) * D.rbox(FW - 2 * bw - 0.6, ih - 0.4, ZF - 0.8, r=1.2, r_top=1.5)
    bot = Pos(0, -ih / 2 - 0.2, 0.8) * D.rbox(FW - 2 * bw - 0.6, ih - 0.4, ZF - 0.8 - 2.2, r=1.2, r_top=1.5)
    h1, l1, h2 = K.v(P["body1_h"]), K.v(P["body1_l"]), K.v(P["body2_h"])
    b1 = Pos(0, 0, -l1) * Box(K.v(P["cut_w"]) - 0.4, h1, l1, align=D.BASE)
    b2 = Pos(0, 0, ZB) * Box(K.v(P["cut_w"]) - 1.6, h2, -ZB - l1 + 0.01, align=D.BASE)
    parts = [K.body(bezel, "ISO-SWITCH bezel", COLORS["bezel"][0]),
             K.body(top, "ISO-SWITCH rocker, upper (ON: close)", COLORS["rocker_top"][0]),
             K.body(bot, "ISO-SWITCH rocker, lower (open)", COLORS["rocker_bot"][0]),
             K.body(b1 + b2, "ISO-SWITCH housing", COLORS["housing"][0])]
    pl = K.v(P["pin_l"])
    for n, nm, x, y in PINS:
        t = D.blade((x, y, ZB + 0.01), axis="-z", w=K.v(P["tab_w"]), t=K.v(P["tab_t"]), l=pl)
        parts.append(K.body(t, f"ISO-SWITCH pin {n} {nm} (0.250 tab)", COLORS["tab"][0], finish="metal"))
    keep = [K.body(Pos(0, 0, ZB - pl - 25.0) * Box(FW + 10, FH + 10, 25.0, align=D.BASE),
                   "keep-out: insulated quick-connects and lead bend behind the tabs (25 mm)", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    items = []
    bw = K.v(P["bezel_wall"])
    ih = (FH - 2 * bw) / 2
    z = ZF
    icon = Pos(0, ih / 2 + 5.0, z) * (Box(9.0, 5.5, 0.12, align=D.BASE) - Box(7.8, 4.3, 0.2, align=D.BASE))
    icon += Pos(-2.4, ih / 2 + 8.2, z) * Box(1.4, 0.9, 0.12, align=D.BASE) + Pos(2.4, ih / 2 + 8.2, z) * Box(1.4, 0.9, 0.12, align=D.BASE)
    items.append(K.body(icon, "ISO-SWITCH branding: battery symbol (redrawn from the photo, cosmetic)", COLORS["mark_white"][0], finish="print"))
    lens = Pos(0, ih / 2 - 0.5, z) * Box(12.0, 1.3, 0.14, align=D.BASE)
    items.append(K.body(lens, "ISO-SWITCH LED strip (lens)", COLORS["lens"][0], finish="lens"))
    t = K.text_solid("I   ON", 3.2, (0, ih / 2 - 5.0, z), depth=0.12, style="bold")
    items.append(K.body(t, "ISO-SWITCH branding: 'I ON' (redrawn from the photo, cosmetic)", COLORS["mark_white"][0], finish="print"))
    return items


def attach_points():
    return [{"n": f"pin_{n}", "ep": "ISO-SWITCH", "at": [x, y, round(ZB - K.v(P["pin_l"]), 2)], "dir": [0, 0, -1],
             "kind": "0.250 tab", "note": nm} for n, nm, x, y in PINS]


def terminals():
    return [{"pin": n, "endpoint": "ISO-SWITCH", "name": nm, "kind": "0.250 in tab", "wires": WIRES[n],
             "at": (x, y, ZB - K.v(P["pin_l"])), "dir": (0, 0, -1)} for n, nm, x, y in PINS]


def mount_points():
    return [{"n": "cutout", "at": [0, 0, 0], "dir": [0, 0, -1],
             "note": "snaps into a 21.08 x 36.83 panel cut-out; the bezel's back face seats on the panel"}]


def _bb(b):
    return Compound(children=b).bounding_box()


CHECKS = [
    ("face width", lambda b: b[0].bounding_box().size.X, 25.65),
    ("face height", lambda b: b[0].bounding_box().size.Y, 49.91),
    ("in front of the panel", lambda b: _bb(b).max.Z, 15.10),
    ("behind the panel to the housing back", lambda b: -b[3].bounding_box().min.Z, 28.58),
    ("housing fits the cut-out width", lambda b: b[3].bounding_box().size.X <= 21.08, True),
    ("housing fits the cut-out height", lambda b: b[3].bounding_box().size.Y <= 36.83, True),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
