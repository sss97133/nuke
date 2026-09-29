#!/usr/bin/env python3
"""MoTeC M130 engine computer (MoTeC part 13130): true-size reference model for the K5 harness (build123d B-rep).

This is the maker's part redrawn from MoTeC's printed dimensions, so brackets, clearances and the harness can be laid
out around it. It is not a MoTeC file and nothing is traced from MoTeC's images. Endpoints on this piece: M130-A
(34-way plug) and M130-B (26-way plug), both TE Superseal 1.0 Key 1 (MoTeC #65044 / #65045).

Frame (mm): origin at the centre of the flat back (the mounting face). +X is right and +Y is up in MoTeC's front
view; +Z points out of the back face, toward the viewer of that view. The plugs face -Y (down).

Run with the parts venv (build123d):
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/M130-A.py <out_dir>
Writes M130-A.step, M130-A_keepout.step, M130-A.glb, M130-A_drawing.svg, M130-A.params.json.
"""
import json
import math
import sys
from pathlib import Path

from build123d import (Align, Axis, Box, Compound, Cylinder, Plane, Polygon, Pos, RectangleRounded, extrude, fillet)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/motec_m130_datasheet.pdf"
P2 = f"{DS} p.2 (Physical)"
P3 = f"{DS} p.3 (Dimensions and Mounting)"
P3X = f"{DS} p.3; same drawing in motec_m1_hardware_techspec.pdf p.42 (M130 - Small Case Tyco Connector)"
SC = f"scaled off {DS} p.3, drawing scale from its printed 107.5 width"
TE = "reference_documents/component_drawings/te_C-2-1437285-3_superseal_1.0_plug_housing_34_26_customer_drawing.pdf"
KO = ("receipts/2026-06-09_as-built-photo-survey-corrections.md (MoTeC environment constraints) and "
      "research/2026-06-09_design-inputs-recon.md: 60-80 mm below the connector face for the plug and boot")
PHOTO = "MoTeC product photo https://assets.motec.com.au/strapi/large_m130_052880dbeb.webp (fetched 2026-09-29), k-means of the region"

P = {
    # ---- the case (printed on p.3; p.2 repeats the overall size)
    "case_w": Dim(107.5, P3X),
    "case_h": Dim(127.5, P3X),
    "depth": Dim(38.7, f"{P2}; {P3}"),
    "corner_r": Dim(5.5, P3),
    "plate_t": Dim(15.5, P3, note="thickness of the flat upper case"),
    "housing_h": Dim(41.0, P3, note="height of the lower connector housing above the bottom edge"),
    "draft_deg": Dim(18.0, P3, note="side draft of the connector housing (bottom view); the plugs themselves exit straight down"),
    # ---- mounting holes (printed on p.3)
    "hole_d": Dim(5.2, P3X, note="3 holes, to suit M5 or 3/16 in"),
    "washer_max": Dim(13.0, P3, note="max washer or head diameter"),
    "hole_edge": Dim(5.0, P3, note="lower holes: centre 5 in from each side edge"),
    "hole_pitch": Dim(97.5, P3),
    "hole_low": Dim(47.5, P3, note="lower holes above the bottom edge"),
    "hole_rise": Dim(75.0, P3, note="top hole above the lower holes (so 5 below the top edge)"),
    # ---- the plug headers (printed on p.3)
    "hdr_proud": Dim(5.6, P3, note="headers stand this far below the bottom edge"),
    "hdr_depth": Dim(23.9, P3, note="header size front-to-back"),
    "hdr_z": Dim(21.2, P3, note="header centre from the back face"),
    "hdr_span": Dim(67.5, P3, note="over both headers"),
    # ---- scaled off the p.3 drawing (no printed number)
    "hdr_a_w": Dim(34.9, SC, "scaled", "header A width; with the printed 67.5 span it sets both header centres",
                   "fit-critical, scaled"),
    "hdr_b_w": Dim(29.2, SC, "scaled", "header B width", "fit-critical, scaled"),
    "hdr_wall": Dim(1.6, "not shown on any MoTeC drawing", "assumed", "shroud wall"),
    "hdr_r": Dim(2.0, SC, "scaled", "header corner radius"),
    "latch_w": Dim(3.2, SC, "scaled", "latch window on each header, front view"),
    "latch_proud": Dim(2.8, SC, "scaled", "latch ramp, side view"),
    "front_flat_h": Dim(26.6, SC, "scaled", "housing front face is vertical this high above the bottom edge"),
    "slope_top_h": Dim(38.9, SC, "scaled", "housing slope meets the case front at this height (41 is to the top of the blend)"),
    "slope_front_h": Dim(30.2, SC, "scaled", "slope line meets the front face at this height (before the R5 blend)"),
    "slope_r": Dim(5.0, SC, "scaled", "blend between the front face and the slope"),
    "draft_start": Dim(12.0, SC, "scaled", "housing is full width back to this depth, drafted in front of it"),
    "front_edge_r": Dim(4.0, SC, "scaled", "housing front corners, front view"),
    "plate_fillet": Dim(3.0, SC, "scaled", "front edge round of the flat case (tangent line 3 in from the edge)"),
    "label_w": Dim(77.9, SC, "scaled", "label recess on the housing front"),
    "label_h": Dim(17.9, SC, "scaled"),
    "label_y": Dim(14.8, SC, "scaled", "label centre above the bottom edge"),
    "label_depth": Dim(0.4, "not shown on any MoTeC drawing", "assumed"),
    # ---- the Superseal 1.0 pin field and plugs (TE's drawing of the mating plug)
    "pin_pitch": Dim(3.0, f"{TE} p.1 and p.2 (face view: 3 mm pitch, rows offset 1.5)"),
    "row_gap_outer": Dim(3.5, f"{TE} p.1 and p.2 (rows 3.5 / 4 / 3.5)"),
    "row_gap_inner": Dim(4.0, f"{TE} p.1 and p.2"),
    "plug34_w": Dim(38.2, f"{TE} p.1 (34-way plug housing 2-1437285-3)"),
    "plug26_w": Dim(32.2, f"{TE} p.2 (26-way plug housing 2-1437285-2)"),
    "plug_h": Dim(38.0, f"{TE} p.1 and p.2 (overall, over the lock arms)"),
    "plug_l": Dim(32.15, f"{TE} p.1 and p.2 (mating face to rear)"),
    # ---- clearance we design around
    "keepout_min": Dim(60.0, KO, "design"),
    "keepout": Dim(80.0, KO, "design"),
}
COLORS = {
    "case": ("#28292a", PHOTO + " (upper case, 95%)"),
    "housing": ("#2b2b28", PHOTO + " (connector housing, 65%)"),
    "label": ("#121416", PHOTO + " (label panel, 57%); the maker's branding is not reproduced"),
    "header": ("#2e3032", PHOTO + " (plug headers, 86%)"),
    "pins": ("#b9b4a8", "not visible in the photo; drawn as tin-plated brass (colour not sourced)"),
    "keepout": ("#f0a030", "design aid, not a product colour"),
    "plug": ("#5d6670", "design aid (envelope of TE's plug), not a product colour"),
}
W, H, D = K.v(P["case_w"]), K.v(P["case_h"]), K.v(P["depth"])
T = K.v(P["plate_t"])
Y0 = -H / 2                     # bottom edge
T18 = math.tan(math.radians(K.v(P["draft_deg"])))
HDR_Z = K.v(P["hdr_z"])
HDR_D = K.v(P["hdr_depth"])
HDR_FACE = Y0 - K.v(P["hdr_proud"])
A_X0 = -K.v(P["hdr_span"]) / 2
A_X1 = A_X0 + K.v(P["hdr_a_w"])
B_X1 = K.v(P["hdr_span"]) / 2
B_X0 = B_X1 - K.v(P["hdr_b_w"])
A_CX, B_CX = (A_X0 + A_X1) / 2, (B_X0 + B_X1) / 2
HOLES = [(0.0, Y0 + K.v(P["hole_low"]) + K.v(P["hole_rise"])),
         (-K.v(P["hole_pitch"]) / 2, Y0 + K.v(P["hole_low"])), (K.v(P["hole_pitch"]) / 2, Y0 + K.v(P["hole_low"]))]


FILLETS = {}


def _near(a, b, tol=0.05):
    return abs(a - b) < tol


def case_solid():
    outline = extrude(RectangleRounded(W, H, K.v(P["corner_r"])), amount=T)
    plate = fillet(outline.edges().group_by(Axis.Z)[-1], radius=K.v(P["plate_fillet"]))
    # flat washer lands (washer or head 13 max): the front round stops short of each hole, clipped to the outline
    for (x, y) in HOLES:
        land = Pos(x, y, T - 5) * Cylinder(K.v(P["washer_max"]) / 2, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
        plate += land & outline
    # connector housing: side profile (y, z) with the R5 blend, extruded across, then cut to the 18 degree side draft
    prof = [(Y0, 10.0), (Y0, D), (Y0 + K.v(P["slope_front_h"]), D), (Y0 + K.v(P["slope_top_h"]), T), (Y0 + K.v(P["slope_top_h"]), 10.0)]
    face = Plane.YZ * Polygon(*prof, align=None)
    corner = [vx for vx in face.vertices() if _near(vx.Z, D, 0.05) and _near(vx.Y, Y0 + K.v(P["slope_front_h"]), 0.05)]
    face = fillet(corner, radius=K.v(P["slope_r"]))
    housing = extrude(face, amount=W / 2, both=True)
    z_top = 48.0
    ds = K.v(P["draft_start"])
    xw = W / 2 - (z_top - ds) * T18
    wedge = extrude(Plane.XZ * Polygon((-W / 2, -1), (W / 2, -1), (W / 2, ds), (xw, z_top), (-xw, z_top), (-W / 2, ds), align=None),
                    amount=90, both=True)
    housing = housing & wedge
    # round the housing's front corners (the drafted sides meeting the front face and the blend), largest that holds
    side = [e for e in housing.edges() if e.center().Z > ds + 4 and abs(e.center().X) > 38
            and e.center().Y < Y0 + K.v(P["slope_front_h"]) + 1 and not _near(e.center().Y, Y0, 0.3)]
    for r in (K.v(P["front_edge_r"]), 3.0, 2.0):
        try:
            housing = fillet(side, radius=r)
            FILLETS["front_edge_r"] = r
            break
        except ValueError:
            continue
    shell = plate + housing
    for (x, y) in HOLES:
        shell -= Pos(x, y, -1) * Cylinder(K.v(P["hole_d"]) / 2, T + 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    lab = extrude(RectangleRounded(K.v(P["label_w"]), K.v(P["label_h"]), 2.9), amount=2)
    shell -= Pos(0, Y0 + K.v(P["label_y"]), D - K.v(P["label_depth"])) * lab
    return shell


def label_solid():
    lab = extrude(RectangleRounded(K.v(P["label_w"]) - 0.3, K.v(P["label_h"]) - 0.3, 2.75), amount=K.v(P["label_depth"]) - 0.15)
    return Pos(0, Y0 + K.v(P["label_y"]), D - K.v(P["label_depth"])) * lab


def header_solid(x0, x1):
    w = x1 - x0
    cx = (x0 + x1) / 2
    proud = K.v(P["hdr_proud"])
    wall = K.v(P["hdr_wall"])
    outer = Pos(cx, Y0 - proud / 2, HDR_Z) * Box(w, proud, HDR_D)
    outer = fillet(outer.edges().filter_by(Axis.Y), radius=K.v(P["hdr_r"]))
    cav = Pos(cx, Y0 - proud / 2 - 0.5, HDR_Z) * Box(w - 2 * wall, proud - 1.0 + 0.02, HDR_D - 2 * wall)
    cav = fillet(cav.edges().filter_by(Axis.Y), radius=max(0.3, K.v(P["hdr_r"]) - wall))
    shroud = outer - cav
    lw, lp = K.v(P["latch_w"]), K.v(P["latch_proud"])
    latch = Pos(cx, Y0 - 3.2, HDR_Z + HDR_D / 2 + lp / 2) * Box(lw, 2.2, lp)
    return shroud + latch


def pins_solid(cx, outer_n):
    """Superseal 1.0 pin field: 4 rows along X; outer rows outer_n pins, inner rows outer_n - 1 (offset half a pitch)."""
    pitch = K.v(P["pin_pitch"])
    zo = K.v(P["row_gap_inner"]) / 2 + K.v(P["row_gap_outer"])
    zi = K.v(P["row_gap_inner"]) / 2
    pins = []
    for dz, n in ((zo, outer_n), (zi, outer_n - 1), (-zi, outer_n - 1), (-zo, outer_n)):
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * pitch
            pins.append(Pos(x, Y0 - 1.0 - 1.75, HDR_Z + dz) * Box(1.0, 3.5, 0.6))
    return Compound(children=pins).fuse() if len(pins) > 1 else pins[0]


def keepout_solids():
    face = HDR_FACE
    zc = HDR_Z
    ph, pl = K.v(P["plug_h"]), K.v(P["plug_l"])
    a_w, b_w = K.v(P["plug34_w"]), K.v(P["plug26_w"])
    plug_a = Pos(A_CX, face - pl / 2, zc) * Box(a_w, pl, ph)
    plug_b = Pos(B_CX, face - pl / 2, zc) * Box(b_w, pl, ph)
    x0, x1 = A_CX - a_w / 2, B_CX + b_w / 2
    kmin, kmax = K.v(P["keepout_min"]), K.v(P["keepout"])
    k60 = Pos((x0 + x1) / 2, face - kmin / 2, zc) * Box(x1 - x0, kmin, ph)
    k80 = Pos((x0 + x1) / 2, face - kmin - (kmax - kmin) / 2, zc) * Box(x1 - x0, kmax - kmin, ph)
    return plug_a, plug_b, k60, k80, (x0, x1)


def build():
    case = K.body(case_solid(), "M130 case (MoTeC 13130)", COLORS["case"][0])
    label = K.body(label_solid(), "M130 label panel", COLORS["label"][0])
    hdr_a = K.body(header_solid(A_X0, A_X1), "M130-A header: 34-way TE Superseal 1.0 Key 1 (mates MoTeC #65044)", COLORS["header"][0])
    hdr_b = K.body(header_solid(B_X0, B_X1), "M130-B header: 26-way TE Superseal 1.0 Key 1 (mates MoTeC #65045)", COLORS["header"][0])
    pins_a = K.body(pins_solid(A_CX, 9), "M130-A pins (34)", COLORS["pins"][0])
    pins_b = K.body(pins_solid(B_CX, 7), "M130-B pins (26)", COLORS["pins"][0])
    plug_a, plug_b, k60, k80, span = keepout_solids()
    ko = [K.body(plug_a, "M130-A mated plug envelope (TE 2-1437285-3, 38.2 x 38 x 32.15)", COLORS["plug"][0], 0.45),
          K.body(plug_b, "M130-B mated plug envelope (TE 2-1437285-2, 32.2 x 38 x 32.15)", COLORS["plug"][0], 0.45),
          K.body(k60, "keep-out 0-60 mm below the plug faces (minimum)", COLORS["keepout"][0], 0.22),
          K.body(k80, "keep-out 60-80 mm below the plug faces (budget)", COLORS["keepout"][0], 0.12)]
    return [case, label, hdr_a, hdr_b, pins_a, pins_b], ko, span


def attach_points():
    return [
        {"n": "plug", "ep": "M130-A", "at": [round(A_CX, 2), round(HDR_FACE, 2), HDR_Z], "dir": [0, -1, 0],
         "note": "34-way plug face; the plug and its boot hang straight down (keep-out 60-80 mm)"},
        {"n": "plug", "ep": "M130-B", "at": [round(B_CX, 2), round(HDR_FACE, 2), HDR_Z], "dir": [0, -1, 0],
         "note": "26-way plug face"},
    ]


def drawing(path, meta, span):
    S = K.Sheet(480, 272, "MoTeC M130")
    solid = [(b, "solid") for b in meta["_bodies"]]
    ko_shapes = [(b, "keepout") for b in meta["_ko"]]
    FX, FY = 100, 96                       # front view origin (the back-face centre) on the sheet
    RX = FX + 130                          # right view: its u = -z, so the back face sits at RX
    BY = FY + 150                          # bottom view: its w = z, the back face at BY
    front = S.view("front", solid, (FX, FY), hidden=False)
    right = S.view("right", solid + ko_shapes, (RX, FY), hidden=True)
    bottom = S.view("bottom", solid + ko_shapes[:2], (FX, BY), hidden=False)
    S.text((FX, FY - H / 2 - 22), "FRONT VIEW", size=3.6, weight="bold")
    S.text((RX - 20, FY - H / 2 - 22), "RIGHT VIEW", size=3.6, weight="bold")
    S.text((FX, BY + 12), "BOTTOM VIEW  (looking up at the plug faces; the front of the unit is at the top)", size=3.0, weight="bold")
    # ---- front view
    S.dim(front, (-W / 2, H / 2, 0), (W / 2, H / 2, 0), 10, P["case_w"])
    S.dim(front, (-W / 2, Y0, 0), (-W / 2, H / 2, 0), -24, P["case_h"])
    hx, hy = HOLES[1]
    S.dim(front, (-W / 2, Y0, 0), (hx, hy, 0), -12, P["hole_low"], axis="v")
    S.dim(front, (hx, hy, 0), (HOLES[0][0], HOLES[0][1], 0), -12 - (hx + W / 2), P["hole_rise"], axis="v")
    S.dim(front, (HOLES[1][0], hy, 0), (HOLES[2][0], hy, 0), 9, P["hole_pitch"])
    S.dim(front, (HOLES[2][0], hy, 0), (W / 2, hy, 0), 9, P["hole_edge"])
    for (x, y) in HOLES:
        S.centre_mark(front, (x, y, T), 4.2)
    S.leader(front, (HOLES[0][0] - 1.9, HOLES[0][1] - 1.9, T), (-14, 20), "Ø5.2 THRU ×3", anchor="start")
    S.text(front.xy((-W / 2 + 22, HOLES[0][1] - 26, T)), "to suit M5 or 3/16 in; washer or head Ø13 max", size=2.8,
           anchor="start", color=K.BASIS_COLOR["maker"])
    S.leader(front, (-W / 2 + 1.6, H / 2 - 1.6, T), (-7, -9), "R5.5", anchor="end")
    S.dim(front, (A_X0, HDR_FACE, 0), (B_X1, HDR_FACE, 0), -13, P["hdr_span"])
    S.dim(front, (A_X0, HDR_FACE, 0), (A_X1, HDR_FACE, 0), -6, P["hdr_a_w"])
    S.dim(front, (B_X0, HDR_FACE, 0), (B_X1, HDR_FACE, 0), -6, P["hdr_b_w"])
    S.dim(front, (W / 2, Y0, 0), (W / 2, HDR_FACE, 0), 7, P["hdr_proud"], axis="v")
    S.text(front.xy((A_CX, Y0 + 2.2, D)), "A · 34-way", size=2.6)
    S.text(front.xy((B_CX, Y0 + 2.2, D)), "B · 26-way", size=2.6)
    # ---- right view (the front of the unit is on the left)
    S.dim(right, (0, H / 2, 0), (0, H / 2, T), 7, P["plate_t"])
    S.dim(right, (0, H / 2, 0), (0, H / 2, D), 15, P["depth"])
    S.dim(right, (0, Y0, D), (0, Y0 + K.v(P["housing_h"]), D), -7, P["housing_h"], axis="v")
    kmin, kmax = K.v(P["keepout_min"]), K.v(P["keepout"])
    zb = HDR_Z - K.v(P["plug_h"]) / 2
    S.dim(right, (0, HDR_FACE, zb), (0, HDR_FACE - kmin, zb), 6, P["keepout_min"], axis="v")
    S.dim(right, (0, HDR_FACE, zb), (0, HDR_FACE - kmax, zb), 13, P["keepout"], axis="v")
    S.text(right.xy((0, HDR_FACE - 45, HDR_Z)), "KEEP-OUT", size=3.0, color=K.BASIS_COLOR["design"], weight="bold")
    S.text(right.xy((0, HDR_FACE - 50, HDR_Z)), "plug + boot + bend", size=2.4, color=K.BASIS_COLOR["design"])
    S.text(right.xy((0, HDR_FACE - 18, HDR_Z)), "TE plug", size=2.4, color="#5d6670")
    S.text(right.xy((0, HDR_FACE - 22, HDR_Z)), "38 × 32.15", size=2.2, color="#5d6670")
    # ---- bottom view
    S.dim(bottom, (-W / 2, 0, 0), (-W / 2, 0, D), -9, P["depth"], axis="v")
    S.dim(bottom, (A_X0, 0, 0), (A_X0, 0, HDR_Z), -(A_X0 + W / 2) - 17, P["hdr_z"], axis="v")
    S.dim(bottom, (B_X1, 0, HDR_Z - HDR_D / 2), (B_X1, 0, HDR_Z + HDR_D / 2), (W / 2 - B_X1) + 9, P["hdr_depth"], axis="v")
    ds = K.v(P["draft_start"])
    S.line(bottom.xy((W / 2, 0, ds)), bottom.xy((W / 2, 0, D + 8)), "ext")
    S.angle(bottom, (W / 2, 0, ds), 90, 108, 22, "18°")
    S.text(bottom.xy((A_CX, 0, 3.5)), "A · 34-way", size=2.5)
    S.text(bottom.xy((B_CX, 0, 3.5)), "B · 26-way", size=2.5)
    S.text(bottom.xy((0, 0, D + 12)), "latch ramps on the front side of each header (away from the mounting face); plugs exit straight down",
           size=2.5, color="#10151a")
    S.text(bottom.xy((0, 0, D + 8)), "green dashed = TE plug outline over each header", size=2.3, color=K.BASIS_COLOR["design"])
    # ---- title block and the dimension table
    tx, ty = 272, 18
    S.text((tx, ty), "MoTeC M130 engine computer · MoTeC part 13130", size=5.2, anchor="start", weight="bold")
    S.text((tx, ty + 6), "K5 harness reference model (build123d) · mm · 1:1 on a 480 × 272 mm sheet · third-angle projection",
           size=2.8, anchor="start")
    S.text((tx, ty + 10.5), "Redrawn from MoTeC's printed dimensions, not a MoTeC drawing. Endpoints M130-A and M130-B.", size=2.8,
           anchor="start")
    S.text((tx, ty + 15), "Origin: centre of the back (mounting) face. +Y up, +Z out of the back face; plugs face -Y.", size=2.8,
           anchor="start")
    S.text((tx, ty + 21), "blue = printed by MoTeC · orange ≈ scaled off MoTeC's drawing · green = our clearance · red = assumed",
           size=2.6, anchor="start", weight="bold")
    refs = [("[1]", "motec_m130_datasheet.pdf p.3", "MoTeC datasheet part 13130 (published 6 June 2014) p.3 Dimensions and Mounting"),
            ("[2]", "motec_m130_datasheet.pdf p.2", "same datasheet p.2 Physical: 107.5 x 127.5 x 38.7 mm, 300 g"),
            ("[3]", "techspec.pdf p.42", "MoTeC M1 ECU Hardware (7 Nov 2013) p.42: the same drawing"),
            ("[4]", "scaled off", "measured off [1] at its printed scale (107.5 wide)"),
            ("[5]", "te_C-2-1437285-3", "TE customer drawing 2-1437285-3 (Superseal 1.0 plug housings 34/26), sheets 1-2"),
            ("[6]", "receipts/2026-06-09", "receipts/2026-06-09_as-built-photo-survey-corrections.md (MoTeC environment limits)"),
            ("[7]", "not shown", "no drawing gives it: assumed")]
    y = S.table(P, tx, ty + 28, refs)
    S.text((tx, y + 2), "Colours (MoTeC product photo, k-means per region): case " + COLORS["case"][0] + ", housing " + COLORS["housing"][0]
           + ", label " + COLORS["label"][0] + ", headers " + COLORS["header"][0] + "; pins " + COLORS["pins"][0] + " not sourced.",
           size=2.3, anchor="start")
    S.text((tx, y + 5.5), "Not modelled: the Key 1 ribs inside the headers (no drawing on file); the 1 mm step in the bottom edge at the headers;",
           size=2.3, anchor="start", color=K.BASIS_COLOR["assumed"])
    S.text((tx, y + 9), "the raised label badge (photo) is drawn as a flush panel in a 0.4 mm recess so the printed 38.7 holds; its artwork is not reproduced.",
           size=2.3, anchor="start", color=K.BASIS_COLOR["assumed"])
    S.text((tx, y + 12.5), "The mated plug is drawn seated at the header face (insertion depth not dimensioned).",
           size=2.3, anchor="start", color=K.BASIS_COLOR["assumed"])
    S.text((tx, y + 17), "Cross-check: TE's 34- and 26-way housings differ by two 3 mm pin columns (38.2 vs 32.2); the scaled headers differ by 5.7.",
           size=2.3, anchor="start", color=K.BASIS_COLOR["scaled"])
    S.write(path, {k: v for k, v in meta.items() if not k.startswith("_")})


def checks(bodies):
    """Measure the built solids against the printed numbers (the critic's list), so a drift shows up at build time."""
    from build123d import GeomType as G
    case, _label, hdr_a, hdr_b, pins_a, pins_b = bodies
    res = []

    def chk(name, got, want, tol=0.05):
        ok = abs(got - want) <= tol
        res.append({"check": name, "model": round(got, 3), "drawing": want, "ok": ok})

    bb = case.bounding_box()
    chk("case width (x)", bb.size.X, 107.5)
    chk("case height (y)", bb.size.Y, 127.5)
    chk("case depth (z)", bb.size.Z, 38.7)
    holes = []
    for e in case.edges():
        if e.geom_type == G.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01 and abs(e.arc_center.Z) < 0.01:
            c = e.arc_center
            holes.append((round(c.X, 3), round(c.Y, 3)))
    holes = sorted(set(holes), key=lambda h: (-h[1], h[0]))
    res.append({"check": "hole count", "model": len(holes), "drawing": 3, "ok": len(holes) == 3})
    if len(holes) == 3:
        top, low = holes[0], sorted(holes[1:])
        chk("hole pitch", low[1][0] - low[0][0], 97.5)
        chk("hole rise (lower to top)", top[1] - low[0][1], 75.0)
        chk("lower holes above the bottom edge", low[0][1] - Y0, 47.5)
        chk("hole centre from the side edge", low[0][0] + W / 2, 5.0)
        chk("top hole on the centreline", top[0], 0.0)
    for nm, h, w in (("A", hdr_a, K.v(P["hdr_a_w"])), ("B", hdr_b, K.v(P["hdr_b_w"]))):
        hb = h.bounding_box()
        chk(f"header {nm} width", hb.size.X, w)
        chk(f"header {nm} below the bottom edge", Y0 - hb.min.Y, 5.6)
        chk(f"header {nm} depth (z, less the latch ramp)", hb.size.Z - K.v(P["latch_proud"]), 23.9)
    span = hdr_b.bounding_box().max.X - hdr_a.bounding_box().min.X
    chk("span over both headers", span, 67.5)
    hz = hdr_a.bounding_box()
    chk("header centre from the back face", (hz.min.Z + hz.max.Z - K.v(P["latch_proud"])) / 2, 21.2)
    res.append({"check": "pins A", "model": len(pins_a.solids()), "drawing": 34, "ok": len(pins_a.solids()) == 34})
    res.append({"check": "pins B", "model": len(pins_b.solids()), "drawing": 26, "ok": len(pins_b.solids()) == 26})
    return res


def part_meta(bodies):
    """The audit record for catalog/part_models.yaml (index_v5.py reads it): what, frame, colours, ends, sources, checks."""
    return {"id": "M130-A", "endpoints": ["M130-A", "M130-B"], "what": "Engine computer, MoTeC M130",
            "maker": "MoTeC", "maker_pn": "13130", "shape_basis": "maker drawing",
            "dims_mm": {"l": W, "w": round(H + K.v(P["hdr_proud"]), 2), "h": D},
            "dims_note": "107.5 wide x 127.5 tall x 38.7 deep; the plug headers stand 5.6 below the bottom edge (133.1 overall)",
            "frame": "origin at the centre of the back (mounting) face; +X right, +Y up in MoTeC's front view; +Z out of the back face; plugs face -Y",
            "colors": {k: {"hex": c[0], "from": c[1]} for k, c in COLORS.items()},
            "attach": attach_points(),
            "mount": [{"n": f"hole_{i}", "at": [x, y, 0], "dir": [0, 0, -1], "d": K.v(P["hole_d"]),
                       "note": "M5 or 3/16 in; washer or head 13 max"} for i, (x, y) in enumerate(HOLES)],
            "keepout": {"what": "plug + boot + wire bend below both plug faces", "min_mm": K.v(P["keepout_min"]),
                        "budget_mm": K.v(P["keepout"]), "source": KO},
            "params": K.params_table(P),
            "checks": checks(bodies),
            "unknowns": ["The Key 1 rib geometry inside the headers is not in any drawing on file; the latch side is modelled.",
                         "The mated plug is drawn seated at the header face; its insertion depth over the header is not dimensioned.",
                         "Scaled values (orange on the drawing) are read off MoTeC's drawing at its printed scale, not printed numbers.",
                         "Pin colour is not visible in the photo."],
            "cross_checks": [
                "Header widths vs TE: the 34- and 26-way plug housings differ by two 3 mm pin columns (38.2 vs 32.2 wide, "
                "TE 2-1437285-3 sheets 1-2). The scaled headers differ by 5.7 (34.9 vs 29.2), within 0.3 mm of that. Held to the "
                "printed 67.5 span with a 6.0 difference they would be 35.05 and 29.05. The ECU-side headers are TE cap assemblies "
                "(3-1437285-x, TE sheet 1 table 1), whose drawings are not on file."],
            "notes": ["The 18 degree angle on MoTeC's p.3 is the connector housing's side draft (bottom view). The plugs exit "
                      "straight down; research/2026-06-09_design-inputs-recon.md reads it as an '18 degree connector exit'.",
                      "MoTeC's label is a raised badge (product photo). It is drawn as a flush panel in a 0.4 mm recess so the "
                      "printed 38.7 depth holds; the badge thickness is not printed and the artwork is not reproduced."]}


def main(out):
    out = Path(out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    bodies, ko, span = build()
    desc = ["K5 harness reference model: MoTeC M130 engine computer, MoTeC part 13130 (not a MoTeC file)",
            "Units mm. Origin: centre of the back (mounting) face. +Y up in MoTeC's front view, +Z out of the back, plugs face -Y."]
    desc += [f"{k} = {d.value:g} [{d.basis}] {d.source}" for k, d in P.items()]
    K.write_step(Compound(children=bodies, label="M130"), out / "M130-A.step", desc)
    K.write_step(Compound(children=ko, label="M130 keep-out"), out / "M130-A_keepout.step",
                 ["K5 harness: clearance around the MoTeC M130 plugs (design aid, not a product)", KO, f"plugs: {TE}"])
    K.write_glb(bodies + ko, out / "M130-A.glb")
    meta = part_meta(bodies)
    bad = [c for c in meta["checks"] if not c["ok"]]
    for c in meta["checks"]:
        print(("ok  " if c["ok"] else "BAD ") + f"{c['check']}: model {c['model']} vs drawing {c['drawing']}")
    drawing(out / "M130-A_drawing.svg", {**meta, "_bodies": bodies, "_ko": ko}, span)
    (out / "M130-A.params.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    bb = Compound(children=bodies).bounding_box()
    print(f"M130-A: {bb.size.X:.2f} x {bb.size.Y:.2f} x {bb.size.Z:.2f} mm "
          f"(x {bb.min.X:.2f}..{bb.max.X:.2f}, y {bb.min.Y:.2f}..{bb.max.Y:.2f}, z {bb.min.Z:.2f}..{bb.max.Z:.2f})")
    if bad:
        raise SystemExit(f"{len(bad)} checks failed")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
