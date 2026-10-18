#!/usr/bin/env python3
"""12 V outlet: Blue Sea Systems 1011 12 V DC dash socket with watertight cap, 15 A, 1-1/8 in hole.

Drawn from Blue Sea's dimensioned drawing (BlueSea_1011_Dash_Socket_dimensioned_drawing.jpg): flange 59.8 x 42.3 with
R8.0 corners and two Ø4.0 holes 47.8 apart, flange 4.9 thick, body Ø28.6 and 36.5 behind the flange, socket bore Ø21.6,
cap Ø28.5 with its Ø22.0 plug 10.6 tall, 6.4 x 0.7 blade terminals. The nut, the lock ring and the terminal positions are
scaled off the same drawing at its printed 59.8 flange width. The cut-out (1-1/8 in) is Blue Sea's page.

Frame (mm): origin at the centre of the flange's back face, where it seats on the panel. +Z out of the panel toward the
user, +Y up (the cap's strap up), +X right; the body, nut and blades are behind the panel (-Z). Drawn with the cap shut.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/OUTLET-12V.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DWG = "reference_documents/component_drawings/BlueSea_1011_Dash_Socket_dimensioned_drawing.jpg (Blue Sea Socket.jpg)"
PAGE = ("reference_documents/web_snapshots/www.bluesea.com__Dash_Socket_12V_DC_with_Watertight_Cap.md (Blue Sea 1011 page, "
        "fetched 2026-09-28)")
SC = f"scaled off {DWG}, scale from its printed 59.8 flange width"
PHURL = "https://dh778tpvmt77t.cloudfront.net/images/products/1011.jpg (Blue Sea, fetched 2026-09-29)"
PHOTO = f"Blue Sea product photo {PHURL}, k-means of the region"

P = {
    "flange_w": Dim(59.8, f"{DWG} (front view, 2.35 in)"),
    "flange_h": Dim(42.3, f"{DWG} (front view, 1.66 in)"),
    "flange_r": Dim(8.0, f"{DWG} (front view, R 0.31 in)"),
    "flange_t": Dim(4.9, f"{DWG} (side view, 0.19 in)"),
    "hole_d": Dim(4.0, f"{DWG} (front view, Ø0.16 in)"),
    "hole_pitch": Dim(47.8, f"{DWG} (front view, 1.88 in)"),
    "bore_d": Dim(21.6, f"{DWG} (front view, Ø0.85 in socket bore)"),
    "body_d": Dim(28.6, f"{DWG} (side view, Ø1.12 in threaded body)"),
    "body_l": Dim(36.5, f"{DWG} (side view, 1.44 in behind the flange)"),
    "cap_d": Dim(28.5, f"{DWG} (front view, cap Ø1.12 in)"),
    "cap_plug_d": Dim(22.0, f"{DWG} (side view, cap plug Ø0.866 in)"),
    "cap_h": Dim(10.6, f"{DWG} (side view, cap 0.42 in)"),
    "strap_w": Dim(10.5, f"{DWG} (front view, cap strap 0.41 in)"),
    "blade_w": Dim(6.4, f"{DWG} (side view, 0.25 in blade)"),
    "blade_t": Dim(0.7, f"{DWG} (side view, 0.03 in blade)"),
    "cutout": Dim(28.58, f"{PAGE}: 'Cut Out Dimensions 1 1/8 in (28.58 mm) dia. hole'"),
    "ring_d": Dim(39.0, SC, "scaled", "raised lock ring round the bore ('TURN TO UNLOCK / LOCK POINT')"),
    "ring_h": Dim(1.5, SC, "scaled", "lock ring above the flange face"),
    "nut_d": Dim(38.0, SC, "scaled", "mounting nut across its flats (drawn round-hex)"),
    "nut_t": Dim(7.0, SC, "scaled", "mounting nut thickness, seated on the panel's back"),
    "blade_l": Dim(10.8, SC, "scaled", "blade length past the body"),
    "blade_off": Dim(11.0, SC, "scaled", "outer (-) blade off the axis; the + blade is on the axis"),
    "panel_t": Dim(1.5, "the dash panel thickness is not set: the nut is drawn on a 1.5 mm panel", "design"),
}
COLORS = {
    "body": ("#232324", PHOTO + " (flange and body, black)"),
    "cap": ("#2a2a2b", PHOTO + " (cap, black)"),
    "blade": ("#c7c2b4", "tin-plated blades: not sampled; drawn tin"),
    "mark": ("#e8e8e8", PHOTO + " (ring lettering, white)"),
}
PART = {
    "pid": "OUTLET-12V", "endpoints": ["OUTLET-12V"], "maker": "Blue Sea Systems", "pn": "1011",
    "title": "Blue Sea Systems 1011 12 V dash socket with cap",
    "what": "12 V outlet, Blue Sea 1011 12 V DC dash socket with watertight cap, 15 A, 1-1/8 in hole",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 59.8, "w": 42.3, "h": 62.8},
    "dims_note": "flange 59.8 x 42.3 x 4.9 on the panel; body Ø28.6 x 36.5 behind it plus ~11 of blades; the shut cap stands "
                 "10.6 proud",
    "margin": {"mm": 1.0, "why": "flange, body, cap and blades printed by Blue Sea; the nut, lock ring and blade spacing scaled"},
    "frame": "origin at the centre of the flange's back face on the panel; +Z toward the user, +Y up (cap strap up), body behind (-Z)",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"socket": "+Z", "blades": "-Z"}},
    "photo": {"url": "https://dh778tpvmt77t.cloudfront.net/images/products/1011.jpg", "page": "https://www.bluesea.com/products/1011",
              "fetched": "2026-09-29"},
    "photo_short": "Blue Sea product photo 1011",
    "branding": ["'TURN TO UNLOCK' and 'LOCK POINT' round the ring (redrawn as plain text)"],
    "dims_draw": [("front", "x", "flange_w", -8), ("front", "y", "flange_h", -8), ("right", "z", "body_l", 8)],
    "refs": [("[1]", "Dash_Socket_dimensioned_drawing", "Blue Sea dimensioned drawing, 1011 dash socket (Socket.jpg)"),
             ("[2]", "Dash_Socket_12V_DC_with_Watertight_Cap", "Blue Sea 1011 product page snapshot (1-1/8 in cut-out)"),
             ("[3]", "scaled off", "measured off [1] at its printed scale (59.8 flange)"),
             ("[4]", "panel thickness", "our choice: 1.5 mm panel for the nut")],
    "drawing_notes": [
        ("Mounts in a 1-1/8 in (28.58) hole with the nut; the two Ø4.0 flange holes take screws on a flat panel.", "#10151a"),
        ("#72 (+) lands on the centre blade, OUT12V_GND (-) on the outer blade, each through a lead spliced in the loom.", "#10151a"),
        ("Drawn with the cap shut; open, the cap swings up on its strap (54.0 above the flange's top edge, Blue Sea).", "#10151a"),
    ],
    "unknowns": ["Which blade is + is read off the socket (centre contact + is the lighter-socket convention; Blue Sea's page "
                 "does not say): check before crimping.",
                 "The nut size and the blade spacing are scaled off the drawing."],
}
FT, BL = K.v(P["flange_t"]), K.v(P["body_l"])
ZE = -BL                                        # body end
XB = K.v(P["blade_off"])
BLL = K.v(P["blade_l"])


def build():
    fw, fh = K.v(P["flange_w"]), K.v(P["flange_h"])
    flange = D.rbox(fw, fh, FT, r=K.v(P["flange_r"]), r_top=0.8)
    for sx in (-1, 1):
        flange -= D.cyl(K.v(P["hole_d"]), FT + 2, at=(sx * K.v(P["hole_pitch"]) / 2, 0, -1))
    flange += D.cyl(K.v(P["ring_d"]), K.v(P["ring_h"]), at=(0, 0, FT - 0.01))
    body = D.cyl(K.v(P["body_d"]), BL + 0.01, at=(0, 0, ZE))
    socket = flange + body
    socket -= D.cyl(K.v(P["bore_d"]), BL + FT, at=(0, 0, ZE + 6.0))
    cz = FT + K.v(P["ring_h"])
    cap = D.cyl(K.v(P["cap_d"]), K.v(P["cap_h"]) - 6.0, at=(0, 0, cz)) + D.cyl(K.v(P["cap_plug_d"]) - 0.4, 6.0, at=(0, 0, cz - 6.0))
    cap += Pos(0, K.v(P["cap_d"]) / 2 + 2.0, cz + 0.8) * Box(K.v(P["strap_w"]), 6.0, 1.6)
    pt = K.v(P["panel_t"])
    nut = D.cyl(K.v(P["nut_d"]), K.v(P["nut_t"]), at=(0, 0, -pt - K.v(P["nut_t"]))) - D.cyl(K.v(P["body_d"]), 20, at=(0, 0, -30))
    parts = [K.body(socket, "OUTLET-12V socket (flange and body)", COLORS["body"][0]),
             K.body(cap, "OUTLET-12V watertight cap (shut)", COLORS["cap"][0], finish="rubber"),
             K.body(nut, "OUTLET-12V mounting nut", COLORS["body"][0])]
    for x, nm in ((0.0, "+ centre"), (XB, "- outer")):
        b = D.blade((x, 0, ZE + 0.01), axis="-z", w=K.v(P["blade_w"]), t=K.v(P["blade_t"]), l=BLL)
        parts.append(K.body(b, f"OUTLET-12V blade {nm}", COLORS["blade"][0], finish="metal"))
    keep = [K.body(Pos(0, 0, ZE - BLL - 25.0) * Box(40.0, 40.0, 25.0, align=D.BASE),
                   "keep-out: insulated quick-connects and lead bend behind the blades (25 mm)", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    z = FT + K.v(P["ring_h"])
    items = []
    for s, y in (("TURN TO UNLOCK", -16.2), ("LOCK POINT", 16.2)):
        t = K.text_solid(s, 2.0, (0, y, z), depth=0.1, style="bold")
        items.append(K.body(t, f"OUTLET-12V branding: '{s}' (redrawn from the drawing as plain text, cosmetic)", COLORS["mark"][0],
                            finish="print"))
    return items


def attach_points():
    return [{"n": "pos", "ep": "OUTLET-12V", "at": [0, 0, round(ZE - BLL, 2)], "dir": [0, 0, -1], "kind": "0.250 blade",
             "note": "+ centre blade (#72 via its lead)"},
            {"n": "neg", "ep": "OUTLET-12V", "at": [XB, 0, round(ZE - BLL, 2)], "dir": [0, 0, -1], "kind": "0.250 blade",
             "note": "- outer blade (OUT12V_GND via its lead)"}]


def terminals():
    return [{"pin": "+", "endpoint": "OUTLET-12V", "name": "+ centre blade", "kind": "0.250 blade", "wires": ["72"],
             "at": (0, 0, ZE - BLL), "dir": (0, 0, -1)},
            {"pin": "-", "endpoint": "OUTLET-12V", "name": "- outer blade", "kind": "0.250 blade", "wires": ["OUT12V_GND"],
             "at": (XB, 0, ZE - BLL), "dir": (0, 0, -1)}]


def mount_points():
    hp = K.v(P["hole_pitch"]) / 2
    return [{"n": "cutout", "at": [0, 0, 0], "dir": [0, 0, -1], "d": K.v(P["cutout"]), "note": "1-1/8 in hole, nut behind the panel"},
            {"n": "screw_L", "at": [-hp, 0, FT], "dir": [0, 0, -1], "d": K.v(P["hole_d"]), "note": "flange screw hole"},
            {"n": "screw_R", "at": [hp, 0, FT], "dir": [0, 0, -1], "d": K.v(P["hole_d"]), "note": "flange screw hole"}]


def _holes(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01}
    return sorted(cs)


CHECKS = [
    ("flange width", lambda b: b[0].bounding_box().size.X, 59.8),
    ("flange height", lambda b: b[0].bounding_box().size.Y, 42.3),
    ("body behind the flange", lambda b: -b[0].bounding_box().min.Z, 36.5),
    ("screw holes", lambda b: len(_holes(b)), 2),
    ("screw hole centres", lambda b: _holes(b)[1][0] - _holes(b)[0][0], 47.8),
    ("body fits the 1-1/8 in hole", lambda b: K.v(P["body_d"]) <= K.v(P["cutout"]) + 0.05, True),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
