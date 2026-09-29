#!/usr/bin/env python3
"""Running battery: Odyssey Extreme ODX-AGM34 78 (34/78-PC1500DT), dual terminal (SAE posts + GM side studs).

Drawn from EnerSys's own technical data sheet EN-ODX-AGM34-78-DS (one page): the dimensioned drawing (front, top and
end views, "LEFT POSITIVE DUAL TERMINALS (SAE & SIDE)"), the terminal-type table and the dimensions table. It is the
candidate the battery tray was sized for (mounts.yaml ODYSSEY: status open), not a bought part.

Frame (mm): origin at the centre of the base (it stands on its base). +Z up, +X along the length, the side
terminals face -Y; positive is at -X (the maker's "left positive", seen from the side-terminal face).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/ODYSSEY.py <out_dir>
"""
import math
import sys
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cylinder, Pos, Rot, fillet

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/Odyssey_PC1500DT_Datasheet.pdf"
DWG = f"{DS} p.1, dimensioned drawing"
TT = f"{DS} p.1, Terminal Type table"
TAB = f"{DS} p.1, Dimensions & Weight table"
SC = f"scaled off {DS} p.1 drawing, scale from its printed 277 length"
PH = f"sized off the product photo in {DS} p.1 against the printed 277 length"
PHOTO = f"product photo in {DS} p.1 (EnerSys), k-means of the region"

P = {
    "len_rim": Dim(277.0, f"{DWG} (front view, over the rim); {TAB} 'Length 277 mm'"),
    "len_base": Dim(256.0, f"{DWG} (front view, at the base)"),
    "w_ledges": Dim(173.0, f"{DWG} (end view, over the hold-down ledges); {TAB} 'Width 173 mm'"),
    "w_body": Dim(159.0, f"{DWG} (end view, the case body)"),
    "w_over": Dim(178.0, f"{DWG} (end view, over the side-terminal bosses)"),
    "h_case": Dim(184.0, f"{DWG} (end view); {TAB} 'Height Container 185 mm'"),
    "h_posts": Dim(201.0, f"{DWG}; {TAB} 'Height (to top of terminals) 201 mm'"),
    "post_pitch": Dim(210.0, f"{DWG} (front view, post centres)"),
    "post_from_front": Dim(33.0, f"{DWG} (top view, post centre to the front edge)"),
    "post_from_back": Dim(134.0, f"{DWG} (top view, post centre to the back edge)"),
    "side_z": Dim(128.0, f"{DWG} (front view, side terminals above the base)"),
    "side_below_top": Dim(54.0, f"{DWG} (front view, side terminals below the case top)"),
    "pos_top_d": Dim(17.2, f"{TT} (SAE positive, top)"), "pos_base_d": Dim(19.3, f"{TT} (SAE positive, base)"),
    "neg_top_d": Dim(15.6, f"{TT} (SAE negative, top)"), "neg_base_d": Dim(17.7, f"{TT} (SAE negative, base)"),
    "post_h": Dim(18.6, f"{TT} (SAE post height)"),
    "side_boss_d": Dim(28.5, f"{TT} (side terminal boss, outer circle)"),
    "side_face_d": Dim(21.6, f"{TT} (side terminal, inner circle: the lead face the lug seats on)"),
    "side_thread_d": Dim(9.525, f"{TT} ('3/8-16 THREAD'), 3/8 in major diameter"),
    "side_thread_l": Dim(8.64, f"{TT} ('0.34\" DEEP')"),
    "len_top_body": Dim(269.0, SC, "scaled", "case body length at the top of its tapered ends"),
    "z_rim": Dim(150.0, SC, "scaled", "rim bottom above the base"), "rim_t": Dim(10.0, SC, "scaled"),
    "lid_len": Dim(268.0, SC, "scaled"), "lid_w": Dim(167.0, f"{DWG} (top view: 33 + 134)", note="lid depth front to back"),
    "ledge_len": Dim(240.0, SC, "scaled", "hold-down ledge length"), "ledge_h": Dim(12.0, SC, "scaled"),
    "post_well_d": Dim(24.0, SC, "scaled", "well in the lid round each post (the posts stand 18.6 with their tops at 201)"),
    "tower_w": Dim(29.4, SC, "scaled", "black terminal tower above each side terminal"),
    "tower_z0": Dim(141.0, SC, "scaled", "tower bottom above the base"),
    "label_w": Dim(193.6, SC, "scaled", "label panel on the front"), "label_z0": Dim(34.3, SC, "scaled"),
    "label_z1": Dim(111.8, SC, "scaled"),
    "rib_n": Dim(9, PH, "photo", "vertical cell ribs between the towers"), "rib_w": Dim(3.0, PH, "photo"),
    "rib_t": Dim(1.2, "not in the drawing", "assumed", "rib standing proud of the case front"),
}
COLORS = {
    "case": ("#272526", PHOTO + " (case, 90%)"),
    "lid": ("#e61d2c", PHOTO + " (lid, 91%)"),
    "lead": ("#8f9294", "not visible in the photo (posts are capped); drawn lead grey"),
    "cap_pos": ("#e71c37", PHOTO + " (red + side-terminal cap, 92%)"),
    "cap_neg": ("#202020", PHOTO + " (black - side-terminal cap, 79%)"),
    "label": ("#23232c", PHOTO + " (label background, 71%)"),
    "label_red": ("#f43210", PHOTO + " (label's red band, 79%)"),
    "mark_red": ("#fc330f", PHOTO + " ('ODYSSEY' lettering)"),
    "mark_white": ("#f2f2f2", PHOTO + " (white lettering; near-white, clipped in the photo)"),
}
PART = {
    "pid": "ODYSSEY", "endpoints": ["ODYSSEY"], "maker": "EnerSys (Odyssey)", "pn": "34/78-PC1500DT (ODX-AGM34 78)",
    "title": "Odyssey Extreme ODX-AGM34 78 (34/78-PC1500DT) battery",
    "what": "Running battery, Odyssey Extreme group 34/78, dual terminal (SAE top posts + GM side studs)",
    "shape_basis": "maker drawing", "viewset": "floor",
    "dims_mm": {"l": 277.0, "w": 178.0, "h": 201.0},
    "dims_note": "277 long over the rim (256 at the base); 173 over the hold-down ledges, 159 the body, 178 over the side "
                 "bosses; 184 to the lid, 201 to the post tops",
    "frame": "origin at the centre of the base; +Z up, +X along the length, the side terminals face -Y, positive at -X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"side_terminals": "-Y", "posts": "+Z", "positive": "-X"}},
    "photo_short": f"product photo in {DS} p.1",
    "branding": ["label panel with the red band", "'ODYSSEY'", "'Extreme'", "'ODX-AGM34/78'", "'EnerSys'", "'AGM2'"],
    "refs": [("[1]", "dimensioned drawing", "EnerSys EN-ODX-AGM34-78-DS p.1: dimensioned drawing (front, top, end)"),
             ("[2]", "Terminal Type", "same sheet: Terminal Type table (SAE posts, side terminal)"),
             ("[3]", "Dimensions & Weight", "same sheet: Dimensions & Weight table (277 / 173 / 201 / 185, 22.5 kg)"),
             ("[4]", "scaled off", "measured off [1] at its printed scale (277 long)"),
             ("[5]", "sized off the product photo", "sized off the sheet's product photo against the printed 277"),
             ("[6]", "not in the drawing", "no drawing gives it: assumed")],
    "drawing_notes": [
        ("Candidate part: the tray was sized for it; the bought battery is still open (mounts.yaml ODYSSEY).", "#10151a"),
        ("The post caps in the maker's photo are left off: the SAE posts are drawn bare, as the cables land on them.", "assumed"),
        ("The label and marks are redrawn from the maker's photo (cosmetic, Arial stand-ins).", "photo"),
    ],
    "unknowns": ["The case taper, rim, lid, towers, ledges and label panel are scaled off the drawing, not dimensioned.",
                 "The 173 ledges and the 178 overall only both hold if the ledges end flush with the lid's back edge (the end "
                 "view draws them so): the model offsets them 3 mm toward the side terminals.",
                 "The posts stand 18.6 (terminal table) with their tops at 201 (drawing), so they sit in 1.6 mm wells in the "
                 "184 lid; the well size is scaled.",
                 "The container height reads 184 on the drawing and 185 in the table; the model uses the drawing's 184.",
                 "The drawing's 54 (side terminal to the case top) and 128 (to the base) add to 182, 2 short of its own 184: "
                 "the model keeps 128 and 184.",
                 "The battery that gets bought is still open (mounts.yaml ODYSSEY status open); this is the candidate."],
    "cross_checks": ["batterysales.com gives 10.86 x 7.09 x 7.88 in (276 x 180 x 200). Its 7.09 in (180) is over the side "
                     "bosses (the maker's 178), not the 173 case: a tray sized at 180 wide fits the ledges with 3.5 mm a side."],
}
L0, L1 = K.v(P["len_base"]), K.v(P["len_top_body"])
WB = K.v(P["w_body"])
YF = -WB / 2                       # body front face
LID_W = K.v(P["lid_w"])
YL = -LID_W / 2                    # lid front edge
HC = K.v(P["h_case"])
XP = K.v(P["post_pitch"]) / 2
YP = YL + K.v(P["post_from_front"])
ZS = K.v(P["side_z"])
Y_OVER = LID_W / 2 - K.v(P["w_over"])    # front of the side bosses (178 back to front)


def build():
    from build123d import Plane, Polygon, extrude
    zr = K.v(P["z_rim"])
    body = extrude(Plane.XZ * Polygon((-L0 / 2, 0), (L0 / 2, 0), (L1 / 2, zr), (-L1 / 2, zr), align=None), amount=WB / 2, both=True)
    wl = K.v(P["w_ledges"])
    ledges = Pos(0, LID_W / 2 - wl / 2, K.v(P["ledge_h"]) / 2) * Box(K.v(P["ledge_len"]), wl, K.v(P["ledge_h"]))
    rim = Pos(0, 0, zr + K.v(P["rim_t"]) / 2) * Box(K.v(P["len_rim"]), LID_W, K.v(P["rim_t"]))
    lid_z0 = zr + K.v(P["rim_t"])
    lid = Pos(0, 0, (lid_z0 + HC) / 2) * Box(K.v(P["lid_len"]), LID_W, HC - lid_z0)
    lid = fillet(lid.edges().group_by(Axis.Z)[-1], radius=3.0)
    z_post = K.v(P["h_posts"]) - K.v(P["post_h"])          # posts stand 18.6 in wells, tops at 201
    for sx in (-1, 1):
        lid -= Pos(sx * XP, YP, z_post) * Cylinder(K.v(P["post_well_d"]) / 2, HC - z_post + 1, align=(Align.CENTER, Align.CENTER, Align.MIN))
    case = body + ledges
    # label panel recess, cell ribs, towers
    lw, lz0, lz1 = K.v(P["label_w"]), K.v(P["label_z0"]), K.v(P["label_z1"])
    case -= Pos(0, YF + 0.25, (lz0 + lz1) / 2) * Box(lw, 1.0, lz1 - lz0)
    ribs = []
    n, rw = int(K.v(P["rib_n"])), K.v(P["rib_w"])
    x0, x1 = -XP + K.v(P["tower_w"]) / 2 + 8, XP - K.v(P["tower_w"]) / 2 - 8
    for i in range(n):
        x = x0 + (x1 - x0) * i / (n - 1)
        ribs.append(Pos(x, YF - K.v(P["rib_t"]) / 2, (lz1 + 4 + zr) / 2) * Box(rw, K.v(P["rib_t"]), zr - lz1 - 4))
    case += Compound(children=ribs).fuse()
    tw, tz0 = K.v(P["tower_w"]), K.v(P["tower_z0"])
    towers = []
    for sx in (-1, 1):
        towers.append(Pos(sx * XP, (YF + Y_OVER) / 2, (tz0 + HC - 2) / 2) * Box(tw, YF - Y_OVER, HC - 2 - tz0))
    case += towers[0] + towers[1]
    case = K.body(case, "ODYSSEY case", COLORS["case"][0])
    lid = K.body(rim + lid, "ODYSSEY lid", COLORS["lid"][0])
    parts = [case, lid]
    for sign, key, cap in ((-1, "pos", "cap_pos"), (1, "neg", "cap_neg")):
        d0, d1 = K.v(P[f"{key}_base_d"]), K.v(P[f"{key}_top_d"])
        from build123d import Cone
        z_post = K.v(P["h_posts"]) - K.v(P["post_h"])
        post = Pos(sign * XP, YP, z_post) * Cone(d0 / 2, d1 / 2, K.v(P["post_h"]), align=(Align.CENTER, Align.CENTER, Align.MIN))
        parts.append(K.body(post, f"ODYSSEY {'+' if sign < 0 else '-'} SAE post", COLORS["lead"][0], finish="metal"))
        boss_l = YF - Y_OVER
        boss = Pos(sign * XP, YF + 0.5, ZS) * Rot(90, 0, 0) * Cylinder(K.v(P["side_boss_d"]) / 2, boss_l + 0.5,
                                                                       align=(Align.CENTER, Align.CENTER, Align.MIN))
        hole = Pos(sign * XP, Y_OVER + K.v(P["side_thread_l"]) - 0.01, ZS) * Rot(90, 0, 0) * Cylinder(
            K.v(P["side_thread_d"]) / 2, K.v(P["side_thread_l"]) + 0.02, align=(Align.CENTER, Align.CENTER, Align.MIN))
        insert = Pos(sign * XP, Y_OVER + 0.8, ZS) * Rot(90, 0, 0) * Cylinder(K.v(P["side_face_d"]) / 2, 0.8,
                                                                         align=(Align.CENTER, Align.CENTER, Align.MIN))
        parts.append(K.body(boss - hole, f"ODYSSEY {'+' if sign < 0 else '-'} side terminal (3/8-16)", COLORS[cap][0]))
        parts.append(K.body(insert - hole, f"ODYSSEY {'+' if sign < 0 else '-'} side terminal insert", COLORS["lead"][0], finish="metal"))
    cosmetic = branding()
    return parts, [], cosmetic


def branding():
    lw, lz0, lz1 = K.v(P["label_w"]), K.v(P["label_z0"]), K.v(P["label_z1"])
    lh = lz1 - lz0
    y = YF + 0.25                      # the label sits in its recess, flush with the case front
    zc = (lz0 + lz1) / 2
    from build123d import Pos as _P
    plate = Pos(0, y - 0.15, zc) * Box(lw - 0.4, 0.3, lh - 0.4)
    band = Pos(lw * 0.13, y - 0.35, lz0 + lh * 0.25) * Box(lw * 0.74, 0.12, lh * 0.36)
    items = [
        K.body(plate, "ODYSSEY branding: label panel (redrawn from the photo, cosmetic)", COLORS["label"][0], finish="print"),
        K.body(band, "ODYSSEY branding: red band (redrawn from the photo, cosmetic)", COLORS["label_red"][0], finish="print")]

    def word(s, size, x, z, col, what, style="bolditalic", align="center"):
        t = K.text_solid(s, size, (0, 0, 0), plane="xz-", depth=0.15, style=style, align=align)
        items.append(K.body(_P(x, y - 0.45, z) * t, f"ODYSSEY branding: {what} (redrawn from the photo, cosmetic)", col, finish="print"))

    word("ODYSSEY", 27.0, -14.0, zc + lh * 0.2, COLORS["mark_red"][0], "'ODYSSEY'")
    word("Extreme", 14.0, lw * 0.2, lz0 + lh * 0.3, COLORS["mark_white"][0], "'Extreme'", style="bold")
    word("ODX-AGM34/78", 6.2, lw * 0.26, lz0 + lh * 0.09, COLORS["mark_white"][0], "'ODX-AGM34/78'", style="bold")
    word("AGM2", 8.5, -lw * 0.36, lz0 + lh * 0.12, COLORS["mark_white"][0], "'AGM2'", style="bold")
    word("EnerSys", 5.5, lw * 0.36, zc + lh * 0.3, COLORS["mark_white"][0], "'EnerSys'", style="bolditalic")
    return items


def attach_points():
    return [
        {"n": "pos_post", "ep": "ODYSSEY", "at": [-XP, round(YP, 2), K.v(P["h_posts"])], "dir": [0, 0, 1], "kind": "post",
         "note": "SAE + post, 19.3 mm at the base, 17.2 at the top, 18.6 tall"},
        {"n": "neg_post", "ep": "ODYSSEY", "at": [XP, round(YP, 2), K.v(P["h_posts"])], "dir": [0, 0, 1], "kind": "post",
         "note": "SAE - post, 17.7 / 15.6 mm, 18.6 tall"},
        {"n": "pos_side", "ep": "ODYSSEY", "at": [-XP, round(Y_OVER, 2), ZS], "dir": [0, -1, 0], "kind": "stud",
         "note": "GM side terminal +, 3/8-16 UNC, 0.34 in deep"},
        {"n": "neg_side", "ep": "ODYSSEY", "at": [XP, round(Y_OVER, 2), ZS], "dir": [0, -1, 0], "kind": "stud",
         "note": "GM side terminal -, 3/8-16 UNC"},
    ]


def terminals():
    """The four places a lug lands, with the build's wires (registry terminations for ODYSSEY)."""
    top = K.v(P["h_posts"])
    return [
        {"pin": "POS_POST", "endpoint": "ODYSSEY", "name": "+ SAE post", "match": r"^\+ post", "at": (-XP, YP, top), "dir": (0, 0, 1)},
        {"pin": "NEG_POST", "endpoint": "ODYSSEY", "name": "- SAE post", "match": r"^- post", "at": (XP, YP, top), "dir": (0, 0, 1)},
        {"pin": "POS_SIDE", "endpoint": "ODYSSEY", "name": "+ GM side terminal (3/8-16)", "match": r"^\+ side",
         "at": (-XP, Y_OVER, ZS), "dir": (0, -1, 0)},
        {"pin": "NEG_SIDE", "endpoint": "ODYSSEY", "name": "- GM side terminal (3/8-16)", "match": r"^- side",
         "at": (XP, Y_OVER, ZS), "dir": (0, -1, 0)},
    ]


def mount_points():
    yb = LID_W / 2
    yf = yb - K.v(P["w_ledges"])
    return [{"n": "ledge_front", "at": [0, round(yf + 3.5, 2), K.v(P["ledge_h"])], "dir": [0, 0, -1],
             "note": "hold-down ledge along the side-terminal (-Y) side"},
            {"n": "ledge_rear", "at": [0, round(yb - 3.5, 2), K.v(P["ledge_h"])], "dir": [0, 0, -1],
             "note": "hold-down ledge along the +Y side, flush with the lid's back edge"}]


def _bb(bodies):
    return Compound(children=bodies).bounding_box()


def _posts(bodies):
    return [b for b in bodies if "SAE post" in b.label]


def _base_face(bodies):
    case = bodies[0]
    f = min(case.faces().filter_by(Axis.Z), key=lambda fc: fc.center().Z)
    return f.bounding_box()


CHECKS = [
    ("length over the rim", lambda b: _bb(b).size.X, 277.0),
    ("length at the base", lambda b: _base_face(b).size.X, 256.0),
    ("width over the side bosses (back of lid to boss face)", lambda b: _bb(b).size.Y, 178.0),
    ("width over the hold-down ledges", lambda b: _base_face(b).size.Y, 173.0),
    ("height to the post tops", lambda b: _bb(b).max.Z, 201.0),
    ("post centre spacing", lambda b: abs(_posts(b)[1].bounding_box().center().X - _posts(b)[0].bounding_box().center().X), 210.0),
    ("post centre to the front edge", lambda b: _posts(b)[0].bounding_box().center().Y - YL, 33.0),
    ("post centre to the back edge", lambda b: LID_W / 2 - _posts(b)[0].bounding_box().center().Y, 134.0),
    ("side terminals above the base", lambda b: [x for x in b if "side terminal (3/8" in x.label][0].bounding_box().center().Z, 128.0),
    ("post height", lambda b: _posts(b)[0].bounding_box().size.Z, 18.6, 0.02),
]

if __name__ == "__main__":
    K.run(sys.modules[__name__], sys.argv[1] if len(sys.argv) > 1 else "out")
