#!/usr/bin/env python3
"""USB charging port: Blue Sea Systems 1045 dual USB charger socket, 4.8 A at 5 V, 9-32 V in, 1-1/8 in hole.

Drawn from Blue Sea's dimensioned drawing 980021560-1 (SubAssy Skt Fmt USB Chg 12-24V 4.8A, rev 1, two sheets, scale
1:1): face Ø35, cap Ø40, 51.6 from the face to the terminal tips with the cap open and 60 overall with it shut, mounting
hole Ø28.6, 0.250 in quick-connect input terminals. The nut, the threaded body, the rear housing, the blade spacing and
the USB openings are scaled off the same 1:1 drawing (read at 200 dpi, 7.874 px/mm, checked against its printed 51.6).

Frame (mm): origin at the centre of the face flange's back, where it seats on the panel. +Z out of the panel toward the
user, +Y up (the cap's hinge up), +X right; the body, nut and blades are behind the panel (-Z). Drawn with the cap shut.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/USB-PORT.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/BlueSea_1045_Dual_USB_dim.pdf (Blue Sea dwg 980021560-1 rev 1)"
S1, S2 = f"{DS} sheet 1", f"{DS} sheet 2"
SC = f"scaled off {DS} sheet 1 (drawn 1:1; read at 200 dpi against its printed 51.6)"
PHURL = "https://dh778tpvmt77t.cloudfront.net/images/products/1045.jpg (Blue Sea, fetched 2026-09-29)"
PHOTO = f"Blue Sea product photo {PHURL}, k-means of the region"

P = {
    "face_d": Dim(35.0, f"{S1} (front view, Ø35)"),
    "cap_d": Dim(40.0, f"{S2} (closed front view, Ø40)"),
    "open_l": Dim(51.6, f"{S1} (side view, face to terminal tips, 51.6)"),
    "closed_l": Dim(60.0, f"{S2} (closed side view, 60 overall)"),
    "hole_d": Dim(28.6, f"{S1} (mounting hole Ø28.6 [1.13])"),
    "face_t": Dim(5.2, SC, "scaled", "face flange in front of the panel"),
    "nut_d": Dim(37.3, SC, "scaled", "castellated mounting nut"), "nut_t": Dim(5.9, SC, "scaled"),
    "body_d": Dim(28.4, SC, "scaled", "threaded body (the drawing reads 28.9 over its thread lines; it passes the Ø28.6 hole)"),
    "rear_d": Dim(26.4, SC, "scaled", "rear housing"), "rear_l": Dim(4.5, SC, "scaled"),
    "blade_l": Dim(10.2, SC, "scaled", "blade length past the rear housing"),
    "blade_pitch": Dim(12.6, SC, "scaled", "- and + blades apart (back view)"),
    "port_w": Dim(6.3, SC, "scaled", "USB opening"), "port_h": Dim(13.3, SC, "scaled"), "port_pitch": Dim(8.5, SC, "scaled"),
    "blade_w": Dim(6.35, f"{S1}: '.250\" QUICK CONNECT INPUT TERMINALS'"),
    "blade_t": Dim(0.81, "0.250 in quick-connect tab, 0.032 in (SAE J858 size; not printed by Blue Sea)", "assumed"),
    "panel_t": Dim(1.5, "the panel thickness is not set: the nut is drawn on a 1.5 mm panel", "design"),
}
COLORS = {
    "body": ("#262627", PHOTO + " (face, body and cap, black)"),
    "port": ("#0d0d0e", PHOTO + " (USB openings)"),
    "tongue": ("#e0e0dc", PHOTO + " (USB contact tongues, white)"),
    "blade": ("#c7c2b4", "tin-plated blades: not sampled; drawn tin"),
}
PART = {
    "pid": "USB-PORT", "endpoints": ["USB-PORT"], "maker": "Blue Sea Systems", "pn": "1045",
    "title": "Blue Sea Systems 1045 dual USB charger socket",
    "what": "USB charging port, Blue Sea 1045 dual USB charger, 4.8 A total at 5 V, 9-32 V in, IP45 with cap, 1-1/8 in hole",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 40.0, "w": 40.0, "h": 60.0},
    "dims_note": "cap Ø40 over the Ø35 face; 60 overall shut (face 5.2 + cap 8.4 in front of the panel, 46.4 behind it to the "
                 "blade tips)",
    "margin": {"mm": 1.0, "why": "face, cap, length and hole printed by Blue Sea; nut, body, rear housing and blades scaled off "
                                "the 1:1 drawing (±1)"},
    "frame": "origin at the centre of the face flange's back on the panel; +Z toward the user, +Y up (cap hinge up), body behind (-Z)",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"ports": "+Z", "blades": "-Z"}},
    "photo": {"url": "https://dh778tpvmt77t.cloudfront.net/images/products/1045.jpg", "page": "https://www.bluesea.com/products/1045",
              "fetched": "2026-09-29"},
    "photo_short": "Blue Sea product photo 1045",
    "branding": ["'BLUE SEA SYSTEMS', '1045', '4.8A' moulded round the face (redrawn as plain raised text)"],
    "dims_draw": [("front", "x", "cap_d", -8), ("right", "z", "closed_l", 8)],
    "refs": [("[1]", "sheet 1", "Blue Sea dwg 980021560-1 sheet 1 (cap open: front, side, back, hole)"),
             ("[2]", "sheet 2", "same drawing sheet 2 (cap shut: front, side)"),
             ("[3]", "scaled off", "measured off [1] (drawn 1:1) at 200 dpi"),
             ("[4]", "SAE J858", "0.250 x 0.032 in tab (not printed)"), ("[5]", "panel thickness", "our choice: 1.5 mm panel")],
    "drawing_notes": [
        ("Mounts in a 1-1/8 in (28.6) hole with its castellated nut.", "#10151a"),
        ("#70 (+) and USB_GND (-) land on the two 0.250 blades through leads spliced in the loom; polarity is marked on the "
         "back (- left, + right seen from the back).", "#10151a"),
        ("Drawn with the cap shut (60 overall); open, the cap swings up about its hinge.", "#10151a"),
    ],
    "unknowns": ["Nut, body, rear housing, blade spacing and the USB openings are scaled off the 1:1 drawing (±1)."],
}
FT = K.v(P["face_t"])
ZTIP = FT - K.v(P["open_l"])                    # blade tips
BLL = K.v(P["blade_l"])
ZR = ZTIP + BLL                                 # rear housing end
ZCAP = ZTIP + K.v(P["closed_l"])                # cap front, shut
BX = K.v(P["blade_pitch"]) / 2


def build():
    face = D.cyl(K.v(P["face_d"]), FT, at=(0, 0, 0))
    rl = K.v(P["rear_l"])
    body = D.cyl(K.v(P["body_d"]), -(ZR + rl) + 0.01, at=(0, 0, ZR + rl)) + D.cyl(K.v(P["rear_d"]), rl + 0.01, at=(0, 0, ZR))
    sock = face + body
    pw, ph, pp = K.v(P["port_w"]), K.v(P["port_h"]), K.v(P["port_pitch"])
    for sx in (-1, 1):
        sock -= Pos(sx * pp / 2, 0, FT - 11.0) * Box(pw, ph, 11.5, align=D.BASE)
    cap = D.cyl(K.v(P["cap_d"]), ZCAP - FT, at=(0, 0, FT)) - D.cyl(K.v(P["face_d"]) + 0.6, ZCAP - FT - 1.6, at=(0, 0, FT - 0.01))
    cap += Pos(0, K.v(P["cap_d"]) / 2 + 2.0, ZCAP - 2.0) * Box(9.0, 6.0, 2.0, align=D.BASE)
    pt = K.v(P["panel_t"])
    nut = D.cyl(K.v(P["nut_d"]), K.v(P["nut_t"]), at=(0, 0, -pt - K.v(P["nut_t"]))) - D.cyl(K.v(P["body_d"]), 20, at=(0, 0, -30))
    parts = [K.body(sock, "USB-PORT socket (face, body, rear housing)", COLORS["body"][0]),
             K.body(cap, "USB-PORT cap (shut)", COLORS["body"][0], finish="rubber"),
             K.body(nut, "USB-PORT castellated nut", COLORS["body"][0])]
    for sx in (-1, 1):
        parts.append(K.body(Pos(sx * pp / 2 - pw * 0.15, 0, FT - 10.0) * Box(pw * 0.3, ph - 3.0, 8.0, align=D.BASE),
                            f"USB-PORT USB-A contact tongue {'L' if sx < 0 else 'R'}", COLORS["tongue"][0]))
    for x, nm in ((-BX, "+"), (BX, "-")):       # seen from the back (sheet 1): - on the left, + on the right, so + is at -X
        b = D.blade((x, 0, ZR + 0.01), axis="-z", w=K.v(P["blade_w"]), t=K.v(P["blade_t"]), l=BLL)
        parts.append(K.body(b, f"USB-PORT blade {nm}", COLORS["blade"][0], finish="metal"))
    keep = [K.body(Pos(0, 0, ZTIP - 25.0) * Box(40.0, 40.0, 25.0, align=D.BASE),
                   "keep-out: insulated quick-connects and lead bend behind the blades (25 mm)", "#2e7d32", alpha=0.25),
            K.body(Pos(0, K.v(P["cap_d"]) / 2 + 4, FT) * Box(K.v(P["cap_d"]), 10.0, 42.0, align=D.BASE),
                   "keep-out: the cap swinging open above the face", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    items = []
    for s, y in (("1045", 11.8), ("4.8A", -11.8)):
        t = K.text_solid(s, 3.2, (0, y, FT), depth=0.15, style="bold")
        items.append(K.body(t, f"USB-PORT branding: '{s}' (redrawn from the photo, cosmetic)", "#3a3a3b", finish="print"))
    return items


def attach_points():
    return [{"n": "pos", "ep": "USB-PORT", "at": [-BX, 0, round(ZTIP, 2)], "dir": [0, 0, -1], "kind": "0.250 blade",
             "note": "+ blade (#70 via its lead)"},
            {"n": "neg", "ep": "USB-PORT", "at": [BX, 0, round(ZTIP, 2)], "dir": [0, 0, -1], "kind": "0.250 blade",
             "note": "- blade (USB_GND via its lead)"}]


def terminals():
    return [{"pin": "+", "endpoint": "USB-PORT", "name": "+ blade", "kind": "0.250 blade", "wires": ["70"],
             "at": (-BX, 0, ZTIP), "dir": (0, 0, -1)},
            {"pin": "-", "endpoint": "USB-PORT", "name": "- blade", "kind": "0.250 blade", "wires": ["USB_GND"],
             "at": (BX, 0, ZTIP), "dir": (0, 0, -1)}]


def mount_points():
    return [{"n": "hole", "at": [0, 0, 0], "dir": [0, 0, -1], "d": K.v(P["hole_d"]), "note": "Ø28.6 hole, castellated nut behind"}]


def _bb(b):
    return Compound(children=b).bounding_box()


CHECKS = [
    ("face diameter", lambda b: b[0].bounding_box().size.X, 35.0),
    ("cap diameter", lambda b: b[1].bounding_box().size.X, 40.0),
    ("face to blade tips (cap open)", lambda b: FT - _bb(b).min.Z, 51.6),
    ("overall, cap shut", lambda b: _bb(b).max.Z - _bb(b).min.Z, 60.0),
    ("body passes the Ø28.6 hole", lambda b: K.v(P["body_d"]) < K.v(P["hole_d"]), True),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
