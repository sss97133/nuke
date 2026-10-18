#!/usr/bin/env python3
"""Accessory battery: Optima YellowTop D34/78 (part 8014-045), dual terminal (SAE posts + GM side terminals).

Optima publishes the overall size and colours, not a drawing: 254.46 x 174.90 x 199.16 mm to the top of the
terminals, "Case: Light Gray, Cover: 'OPTIMA' Yellow", SAE / BCI posts and GM side terminals with 3/8-16 threaded nuts
(Optima YellowTop product specifications, D34/78 page). The six SpiralCell cans, the lid, the terminal towers and the
terminal positions follow Clarios's own front photo of the D34/78, sized against the printed 254.46 length. It is the
candidate the node notes name (mounts.yaml ACC-BATT: status open), not a bought part.

Frame (mm): origin at the centre of the base (it stands on its base). +Z up, +X along the length, the side terminals
face -Y; positive at -X (red, left in the maker's front photo).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/ACC-BATT.py <out_dir>
"""
import math
import sys
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cone, Cylinder, Plane, Polygon, Pos, RectangleRounded, Rot, extrude, fillet

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402

SPEC = "reference_documents/component_drawings/Optima_YellowTop_Full_Specs.pdf"
SP7 = f"{SPEC} p.7 (Product Specifications: Model D34/78, part 8014-045)"
PHURL = ("https://clariosdigitallibrary.widen.net/content/xh7uzu0tla/png/OPTIMA_YT_D34-78_Front_Global.png "
         "(Clarios, fetched 2026-09-29)")
PH = f"sized off Clarios's front photo {PHURL} against the printed 254.46 length"
PHOTO = f"Clarios front photo {PHURL}, k-means of the region"

P = {
    "length": Dim(254.46, f"{SP7}: Length 10.018 in / 254.46 mm"),
    "width": Dim(174.90, f"{SP7}: Width 6.886 in / 174.90 mm", note="taken as the case; Optima does not say if it includes the side terminals"),
    "height": Dim(199.16, f"{SP7}: Height 7.841 in / 199.16 mm (height at the top of terminals)"),
    "side_thread": Dim(9.525, f"{SP7}: 'GM style side terminal (3/8\"-16UNC-2B threaded nut)'"),
    "plinth_h": Dim(13.5, PH, "photo", "base plinth"),
    "can_d": Dim(84.8, f"{PH}; six SpiralCell cans, three across the length (254.46 / 3)", "photo"),
    "lid_z0": Dim(162.0, PH, "photo", "yellow cover's lower edge above the base"),
    "lid_z1": Dim(181.0, PH, "photo", "cover top (the posts stand on it)"),
    "post_x_pos": Dim(-69.0, PH, "photo", "+ post centre along the length"),
    "post_x_neg": Dim(68.6, PH, "photo", "- post centre along the length"),
    "post_y": Dim(-45.05, "no top view in any source: posts drawn over the front row of cans", "assumed"),
    "pos_top_d": Dim(17.5, "Optima prints no post size: a standard SAE positive post is assumed", "assumed"),
    "pos_base_d": Dim(19.5, "as pos_top_d", "assumed"), "neg_top_d": Dim(15.9, "as pos_top_d", "assumed"),
    "neg_base_d": Dim(17.9, "as pos_top_d", "assumed"),
    "side_x_pos": Dim(-40.5, PH, "photo", "+ side terminal centre along the length"),
    "side_x_neg": Dim(45.0, PH, "photo", "- side terminal centre along the length"),
    "side_z": Dim(138.0, PH, "photo", "side terminals above the base"),
    "side_boss_d": Dim(34.0, PH, "photo", "knurled side-terminal boss"),
    "side_proud": Dim(8.0, "no side view in any source", "assumed", "side boss out from the case front"),
    "tower_w": Dim(36.0, PH, "photo", "yellow terminal tower width"), "tower_z0": Dim(121.0, PH, "photo"),
    "label_z0": Dim(47.0, PH, "photo"), "label_z1": Dim(118.0, PH, "photo"), "label_w": Dim(64.0, PH, "photo", "as seen from the front"),
}
COLORS = {
    "case": ("#abbec1", PHOTO + " (case, 58%); Optima states 'Case: Light Gray'"),
    "lid": ("#efc626", PHOTO + " (cover, 59%); Optima states 'Cover: OPTIMA Yellow'"),
    "lead": ("#8f9294", "not visible in the photo (posts are capped); drawn lead grey"),
    "cap_pos": ("#b81e22", PHOTO + " (red + terminal cap, 87%)"),
    "cap_neg": ("#121316", PHOTO + " (black - terminal cap, 94%)"),
    "label_black": ("#201d1d", PHOTO + " (label top band, 63%)"),
    "label_yellow": ("#f0d30e", PHOTO + " (label lower band, 65%)"),
    "label_white": ("#ebe3e2", PHOTO + " (logo outline and stripe)"),
    "logo_red": ("#de212f", PHOTO + " (logo lower half, 88%)"),
    "text_black": ("#262220", PHOTO + " ('OPTIMA' lettering)"),
}
PART = {
    "pid": "ACC-BATT", "endpoints": ["ACC-BATT"], "maker": "Optima (Clarios)", "pn": "8014-045 (YellowTop D34/78)",
    "title": "Optima YellowTop D34/78 (8014-045) battery",
    "what": "Accessory battery, Optima YellowTop D34/78 dual-purpose AGM, dual terminal (the candidate)",
    "shape_basis": "datasheet dims", "viewset": "floor",
    "dims_mm": {"l": 254.46, "w": 174.90, "h": 199.16},
    "dims_note": "254.46 x 174.90 x 199.16 to the post tops (Optima); the side terminal bosses stand 8 mm proud of the case "
                 "front in the model (not in any source)",
    "frame": "origin at the centre of the base; +Z up, +X along the length, the side terminals face -Y, positive at -X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"side_terminals": "-Y", "posts": "+Z", "positive": "-X"}},
    "photo_short": "Clarios front photo OPTIMA_YT_D34-78_Front_Global",
    "branding": ["label on the middle can: black and yellow bands, the logo, 'OPTIMA', 'BY CLARIOS'"],
    "refs": [("[1]", "Optima_YellowTop_Full_Specs.pdf p.7", "Optima YellowTop product specifications, Model D34/78 (8014-045), p.7"),
             ("[2]", "sized off Clarios", "sized off Clarios's front photo of the D34/78 against the printed 254.46"),
             ("[3]", "no top view", "no top view in any source: assumed"),
             ("[4]", "Optima prints no post", "SAE post size assumed (Optima prints none)"),
             ("[5]", "no side view", "no side view in any source: assumed")],
    "drawing_notes": [
        ("Candidate part (the node notes name the D34/78); the bought battery is still open (mounts.yaml ACC-BATT).", "#10151a"),
        ("Optima gives the envelope only: the cans, cover and terminals follow Clarios's photo (purple).", "photo"),
        ("The post depth (front to back) and the side-boss projection are not in any source (red).", "assumed"),
        ("The label is redrawn from the photo and wrapped on the middle can (cosmetic).", "photo"),
    ],
    "unknowns": ["No dimensioned drawing: the six cans, cover, towers and terminal positions are sized off Clarios's photo.",
                 "Where the posts sit front to back is not in any source (no top view); they are drawn over the front cans.",
                 "Whether Optima's 174.90 width includes the side terminals is not stated; the model treats it as the case.",
                 "The SAE post diameters are a standard SAE post (Optima prints none); the caps in the photo are left off.",
                 "The battery that gets bought is still open (mounts.yaml ACC-BATT status open)."],
}
L, W, H = K.v(P["length"]), K.v(P["width"]), K.v(P["height"])
R = K.v(P["can_d"]) / 2
YC = -W / 2 + R                     # front row of cans
YF = -W / 2                         # case front plane
XS = (-2 * R, 0.0, 2 * R)


def build():
    z0, zl0, zl1 = K.v(P["plinth_h"]), K.v(P["lid_z0"]), K.v(P["lid_z1"])
    plinth = extrude(RectangleRounded(L, W, 8.0), amount=z0)
    cans = [Pos(x, y, z0 - 0.01) * Cylinder(R, zl0 - z0 + 0.02, align=(Align.CENTER, Align.CENTER, Align.MIN))
            for x in XS for y in (YC, -YC)]
    core = Pos(0, 0, (z0 + zl0) / 2) * Box(2 * 2 * R, 2 * (-YC), zl0 - z0)
    case = plinth + Compound(children=cans).fuse() + core
    lid = Pos(0, 0, zl0) * extrude(RectangleRounded(L, W, 10.0), amount=zl1 - zl0)
    lid = fillet(lid.edges().group_by(Axis.Z)[-1], radius=3.0)
    tz0, tw = K.v(P["tower_z0"]), K.v(P["tower_w"])
    for xs in (K.v(P["side_x_pos"]), K.v(P["side_x_neg"])):
        lid += Pos(xs, YF + 10.0, (tz0 + zl0 + 1) / 2) * Box(tw, 20.0, zl0 + 1 - tz0)
    parts = [K.body(case, "ACC-BATT case (six SpiralCell cans)", COLORS["case"][0]),
             K.body(lid, "ACC-BATT cover and terminal towers", COLORS["lid"][0])]
    ph = H - zl1
    for key, x, sign in (("pos", K.v(P["post_x_pos"]), "+"), ("neg", K.v(P["post_x_neg"]), "-")):
        post = Pos(x, K.v(P["post_y"]), zl1 - 0.01) * Cone(K.v(P[f"{key}_base_d"]) / 2, K.v(P[f"{key}_top_d"]) / 2, ph + 0.01,
                                                          align=(Align.CENTER, Align.CENTER, Align.MIN))
        parts.append(K.body(post, f"ACC-BATT {sign} SAE post", COLORS["lead"][0], finish="metal"))
    zs, bd, pr = K.v(P["side_z"]), K.v(P["side_boss_d"]), K.v(P["side_proud"])
    for key, x, cap, sign in (("pos", K.v(P["side_x_pos"]), "cap_pos", "+"), ("neg", K.v(P["side_x_neg"]), "cap_neg", "-")):
        boss = Pos(x, YF + 0.5, zs) * Rot(90, 0, 0) * Cylinder(bd / 2, pr + 0.5, align=(Align.CENTER, Align.CENTER, Align.MIN))
        hole = Pos(x, YF - pr + 8.64, zs) * Rot(90, 0, 0) * Cylinder(K.v(P["side_thread"]) / 2, 8.7,
                                                                   align=(Align.CENTER, Align.CENTER, Align.MIN))
        nut = Pos(x, YF - pr + 0.8, zs) * Rot(90, 0, 0) * Cylinder(8.0, 0.8, align=(Align.CENTER, Align.CENTER, Align.MIN))
        parts.append(K.body(boss - hole, f"ACC-BATT {sign} side terminal boss (knurled)", COLORS[cap][0]))
        parts.append(K.body(nut - hole, f"ACC-BATT {sign} side terminal 3/8-16 nut", COLORS["lead"][0], finish="metal"))
    return parts, [], branding()


def _wrap(sketch_xz, r0, r1, color, what):
    """A 2-D shape (on Plane.XZ) projected along Y onto the middle can's surface, between radii r0 and r1."""
    shell = Pos(0, YC, 0) * (Cylinder(r1, 300, align=(Align.CENTER, Align.CENTER, Align.MIN))
                             - Cylinder(r0, 300, align=(Align.CENTER, Align.CENTER, Align.MIN)))
    slab = Pos(0, YC, 0) * extrude(sketch_xz, amount=R + 5)          # Plane.XZ extrudes toward -Y
    solid = slab & shell & Pos(0, YC - R / 2 - 5, 150) * Box(2 * R, R + 10, 300)
    return K.body(solid, f"ACC-BATT branding: {what} (redrawn from the photo, cosmetic)", color, finish="print")


def branding():
    from build123d import Text, FontStyle
    z0, z1, w = K.v(P["label_z0"]), K.v(P["label_z1"]), K.v(P["label_w"])
    zb = z0 + (z1 - z0) * 0.555            # black band from here up (photo: 29 of 71 mm)
    items = []
    items.append(_wrap(Plane.XZ * Pos(0, (zb + z1) / 2) * RectangleRounded(w, z1 - zb, 3.0), R, R + 0.3,
                       COLORS["label_black"][0], "label black band"))
    items.append(_wrap(Plane.XZ * Pos(0, (z0 + zb - 2.7) / 2) * RectangleRounded(w, zb - 2.7 - z0, 6.0), R, R + 0.3,
                       COLORS["label_yellow"][0], "label yellow band"))
    items.append(_wrap(Plane.XZ * Pos(0, zb - 1.35) * RectangleRounded(w, 2.7, 0.5), R, R + 0.3, COLORS["label_white"][0],
                       "label white stripe"))
    # the logo: a slanted panel, black above the stripe and red below, white outline and a white slanted zero
    k = 0.18                                # slant (photo: the logo leans right)
    cz, hh, hw = z0 + 43.2, 19.8, 15.5          # photo: the logo spans 70.4 to 110.1 above the base

    def para(dx0, dz0, dx1, dz1):
        return Polygon((dx0 - k * dz0, dz0), (dx1 - k * dz0, dz0), (dx1 - k * dz1, dz1), (dx0 - k * dz1, dz1), align=None)
    outline = Plane.XZ * Pos(0, cz) * para(-hw, -hh, hw, hh)
    items.append(_wrap(outline, R + 0.3, R + 0.8, COLORS["label_white"][0], "logo outline"))
    inner_red = Plane.XZ * Pos(0, cz) * para(-hw + 1.5, -hh + 1.5, hw - 1.5, zb - cz - 1.5)
    items.append(_wrap(inner_red, R + 0.8, R + 1.3, COLORS["logo_red"][0], "logo red half"))
    inner_blk = Plane.XZ * Pos(0, cz) * para(-hw + 1.5, zb - cz + 1.5, hw - 1.5, hh - 1.5)
    items.append(_wrap(inner_blk, R + 0.8, R + 1.3, COLORS["label_black"][0], "logo black half"))
    zero = Plane.XZ * Pos(1.0, cz) * Text("0", font_size=30, font="Arial", font_style=FontStyle.BOLDITALIC)
    items.append(_wrap(zero, R + 1.3, R + 1.8, COLORS["label_white"][0], "logo slanted zero"))
    word = Plane.XZ * Pos(0, z0 + 12.5) * Text("OPTIMA", font_size=9.5, font="Arial", font_style=FontStyle.BOLD)
    items.append(_wrap(word, R + 0.3, R + 0.8, COLORS["text_black"][0], "'OPTIMA'"))
    by = Plane.XZ * Pos(0, z0 + 6.0) * Text("BY CLARIOS", font_size=3.6, font="Arial", font_style=FontStyle.BOLD)
    items.append(_wrap(by, R + 0.3, R + 0.8, COLORS["text_black"][0], "'BY CLARIOS'"))
    return items


def attach_points():
    top, zs = K.v(P["height"]), K.v(P["side_z"])
    yb = YF - K.v(P["side_proud"])
    return [
        {"n": "pos_post", "ep": "ACC-BATT", "at": [K.v(P["post_x_pos"]), K.v(P["post_y"]), top], "dir": [0, 0, 1], "kind": "post",
         "note": "SAE + post (size assumed); #32 via the MIDI holder, DCDC_OUT"},
        {"n": "neg_post", "ep": "ACC-BATT", "at": [K.v(P["post_x_neg"]), K.v(P["post_y"]), top], "dir": [0, 0, 1], "kind": "post",
         "note": "SAE - post; ACC_NEG"},
        {"n": "pos_side", "ep": "ACC-BATT", "at": [K.v(P["side_x_pos"]), round(yb, 2), zs], "dir": [0, -1, 0], "kind": "stud",
         "note": "GM side terminal +, 3/8-16"},
        {"n": "neg_side", "ep": "ACC-BATT", "at": [K.v(P["side_x_neg"]), round(yb, 2), zs], "dir": [0, -1, 0], "kind": "stud",
         "note": "GM side terminal -, 3/8-16"},
    ]


def terminals():
    top, zs = K.v(P["height"]), K.v(P["side_z"])
    yb = YF - K.v(P["side_proud"])
    return [
        {"pin": "POS_POST", "endpoint": "ACC-BATT", "name": "+ SAE post", "match": r"^\+ post",
         "at": (K.v(P["post_x_pos"]), K.v(P["post_y"]), top), "dir": (0, 0, 1)},
        {"pin": "NEG_POST", "endpoint": "ACC-BATT", "name": "- SAE post", "match": r"^- post",
         "at": (K.v(P["post_x_neg"]), K.v(P["post_y"]), top), "dir": (0, 0, 1)},
        {"pin": "POS_SIDE", "endpoint": "ACC-BATT", "name": "+ GM side terminal (3/8-16)", "match": r"^\+ side",
         "at": (K.v(P["side_x_pos"]), yb, zs), "dir": (0, -1, 0)},
        {"pin": "NEG_SIDE", "endpoint": "ACC-BATT", "name": "- GM side terminal (3/8-16)", "match": r"^- side",
         "at": (K.v(P["side_x_neg"]), yb, zs), "dir": (0, -1, 0)},
    ]


def mount_points():
    return [{"n": "base", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "stands on its plinth; the hold-down clamps the cover or the plinth (tray not set)"}]


def _bb(b):
    return Compound(children=b).bounding_box()


CHECKS = [
    ("length", lambda b: _bb(b).size.X, 254.46),
    ("case width (the cover)", lambda b: b[1].bounding_box().size.Y, 174.90),
    ("height to the post tops", lambda b: _bb(b).max.Z, 199.16),
]

if __name__ == "__main__":
    K.run(sys.modules[__name__], sys.argv[1] if len(sys.argv) > 1 else "out")
