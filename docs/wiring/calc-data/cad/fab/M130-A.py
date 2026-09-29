#!/usr/bin/env python3
"""MoTeC M130 engine computer (MoTeC part 13130): true-size reference model for the K5 harness (build123d B-rep).

This is the maker's part redrawn from MoTeC's printed dimensions, so brackets, clearances and the harness can be laid
out around it. It is not a MoTeC file and nothing is traced from MoTeC's images. Endpoints on this piece: M130-A
(34-way plug) and M130-B (26-way plug), both TE Superseal 1.0 Key 1 (MoTeC #65044 / #65045). The case geometry is
shared with the PDM15 and PDM30 (motec_m1case.py); this file holds the M130's own numbers and their pages.

Frame (mm): origin at the centre of the flat back (the mounting face). +X is right and +Y is up in MoTeC's front
view; +Z points out of the back face, toward the viewer of that view. The plugs face -Y (down).

    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/M130-A.py <out_dir>
Writes M130-A.step (+ _mated, _keepout), M130-A.glb, M130-A_drawing.svg, M130-A_pinout.svg, M130-A.pins.json,
M130-A.params.json.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import motec_m1case as M1  # noqa: E402
import superseal as SS  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/motec_m130_datasheet.pdf"
P2 = f"{DS} p.2 (Physical)"
P3 = f"{DS} p.3 (Dimensions and Mounting)"
P3X = f"{DS} p.3; same drawing in motec_m1_hardware_techspec.pdf p.42 (M130 - Small Case Tyco Connector)"
SC = f"scaled off {DS} p.3, drawing scale from its printed 107.5 width"
SC6 = (f"scaled off {DS} p.3 at 600 dpi (107.5 printed width = 2212 px); the PDM manual p.47 drawing measures the same "
       "(34.98 / 28.92) and TE's housings differ by two 3 mm pin columns")
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
    "hdr_a_w": Dim(35.0, SC6, "scaled", "header A width; with the printed 67.5 span it sets both header centres",
                   "fit-critical, scaled"),
    "hdr_b_w": Dim(29.0, SC6, "scaled", "header B width", "fit-critical, scaled"),
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
    # ---- the Superseal 1.0 pin field (TE's drawing of the mating plug)
    "pin_pitch": Dim(3.0, f"{SS.TE} p.1 and p.2 (face view: 3 mm pitch, rows offset 1.5)"),
    "row_gap_outer": Dim(3.5, f"{SS.TE} p.1 and p.2 (rows 3.5 / 4 / 3.5)"),
    "row_gap_inner": Dim(4.0, f"{SS.TE} p.1 and p.2"),
    "cav_depth": Dim(13.8, f"inferred: TE's plug nose ({SS.TE} sheets 1-2, scaled 13.7) seats fully inside the header; "
                     "MoTeC does not draw the header internals", "scaled", "header cavity depth above the header face"),
    # ---- clearance we design around
    "keepout_min": Dim(60.0, KO, "design"),
    "keepout": Dim(80.0, KO, "design"),
}
P.update(SS.P)
RED = ("#9f1718", PHOTO + " (label frame and underline, 22% of the label region)")
WHITE = ("#e4e0dd", PHOTO + " (label lettering, 34% of the label region)")
COLORS = {
    "case": ("#28292a", PHOTO + " (upper case, 95%)"),
    "housing": ("#2b2b28", PHOTO + " (connector housing, 65%)"),
    "label": ("#121416", PHOTO + " (label panel, 57%)"),
    "header": ("#2e3032", PHOTO + " (plug headers, 86%)"),
    "pins": ("#b9b4a8", "not visible in the photo; drawn as tin-plated brass (colour not sourced)"),
    "numbers": ("#6a6e72", "cavity numbers are moulded in the housing colour; drawn lighter so they read (cosmetic)"),
    "brand_red": RED,
    "brand_white": WHITE,
    "keepout": ("#f0a030", "design aid, not a product colour"),
    "plug": SS.C_PLUG,
    "backshell": SS.C_BS,
}
# MoTeC's label, sized off the photo against the 77.9 mm label panel (x right, y up from the panel centre, mm).
BRANDING = [
    {"what": "red frame around the maker mark", "kind": "frame", "x": -16.6, "y": 0.9, "w": 42.4, "h": 15.6, "r": 3.4, "t": 0.85,
     "color": RED[0]},
    {"what": "maker mark 'MoTeC' (Arial Bold Italic stand-in)", "kind": "text", "s": "MoTeC", "size": 11.0, "style": "bolditalic",
     "x": -16.6, "y": 0.6, "color": WHITE[0]},
    {"what": "model 'M130'", "kind": "text", "s": "M130", "size": 7.4, "x": 6.4, "y": 3.6, "align": "left", "color": WHITE[0]},
    {"what": "red underline", "kind": "bar", "x": 22.6, "y": -1.2, "w": 32.4, "t": 0.5, "color": RED[0]},
    {"what": "'ENGINE MANAGEMENT'", "kind": "text", "s": "ENGINE MANAGEMENT", "size": 2.0, "x": 6.4, "y": -3.7, "align": "left",
     "color": WHITE[0]},
    {"what": "'SYSTEM'", "kind": "text", "s": "SYSTEM", "size": 2.0, "x": 6.4, "y": -6.0, "align": "left", "color": WHITE[0]},
]

SPEC = {
    "pid": "M130-A", "endpoints": {"A": "M130-A", "B": "M130-B"}, "name": "M130", "pn": "13130",
    "title": "MoTeC M130 engine computer · MoTeC part 13130", "what": "Engine computer, MoTeC M130",
    "dims_note": "107.5 wide x 127.5 tall x 38.7 deep; the plug headers stand 5.6 below the bottom edge (133.1 overall)",
    "P": P, "colors": COLORS, "branding": BRANDING, "photo_short": "MoTeC product photo large_m130",
    "keepout_src": KO,
    "designations": "m130_designations.txt",
    "designations_src": "docs/wiring/calc-data/m130_designations.txt (MoTeC datasheet 13130 pp.4-5; M1 ECU Hardware pp.16-17)",
    "pin_orientation_note": ("Which way the plug's polarity side faces is not printed by MoTeC: the model puts TE's "
                             "polarity-marked lock on the header's latch side (the front of the unit), which puts A01 and "
                             "B01 front-left looking up. Check A01 against the moulded numbers before a pin is trusted."),
    "printed": {"case_w": 107.5, "case_h": 127.5, "depth": 38.7, "hole_pitch": 97.5, "hole_rise": 75.0, "hole_low": 47.5,
                "hole_edge": 5.0, "hdr_proud": 5.6, "hdr_depth": 23.9, "hdr_span": 67.5, "hdr_z": 21.2},
    "refs": [("[1]", "motec_m130_datasheet.pdf p.3", "MoTeC datasheet part 13130 (published 6 June 2014) p.3 Dimensions and Mounting"),
             ("[2]", "motec_m130_datasheet.pdf p.2", "same datasheet p.2 Physical: 107.5 x 127.5 x 38.7 mm, 300 g"),
             ("[3]", "techspec.pdf p.42", "MoTeC M1 ECU Hardware (7 Nov 2013) p.42: the same drawing"),
             ("[4]", f"scaled off {DS}", "measured off [1] at its printed scale (107.5 wide)"),
             ("[5]", "te_C-2-1437285-3", "TE customer drawing 2-1437285-3 (Superseal 1.0 plug housings 34/26), sheets 1-2 (orange = scaled off it)"),
             ("[6]", "receipts/2026-06-09", "receipts/2026-06-09_as-built-photo-survey-corrections.md (MoTeC environment limits)"),
             ("[7]", "not shown on any", "no drawing gives it: assumed"),
             ("[8]", "ProWire SSB", "ProWire SSB-34BS-PA66 / SSB-26BS-PA66 product photos (ProWire prints no dimensions)"),
             ("[9]", "inferred:", "inferred from [5]: the plug nose seats fully inside the header")],
    "drawing_notes": [
        ("Not modelled: the Key 1 ribs inside the headers (no drawing on file); the 1 mm step in the bottom edge at the headers.", "assumed"),
        ("The raised label badge is a flush panel in a 0.4 mm recess so the printed 38.7 holds. Its lettering is redrawn from the photo (cosmetic).", "assumed"),
        ("The plugs are drawn fully seated (TE's 13.7 mm nose inside the header); TE does not dimension the mated stack.", "assumed"),
        ("The ProWire backshells are sized off ProWire's photos; the boot (straight / 70 / 90) is HELD, so the model ends at the collar.", "photo"),
        ("Header widths: MoTeC p.3 and the PDM p.47 drawing both measure 35.0 / 29.0 at 600 dpi; TE's housings differ by 6.0 (two 3 mm columns).", "scaled"),
        ("Pinout: M130-A_pinout.svg and M130-A.pins.json (TE numbering; A01 front-left looking up, orientation to confirm on the part).", "#10151a"),
    ],
    "unknowns": ["The Key 1 rib geometry inside the headers is not in any drawing on file; the latch side is modelled.",
                 "Which way the plug's polarity side faces (so where A01 sits) is not printed by MoTeC; the model's choice is marked.",
                 "The plug is drawn fully seated (its 13.7 mm nose inside the header); TE does not dimension the mated stack.",
                 "The ProWire backshells are sized off ProWire's photos (no printed dimensions): basis photo, fit not guaranteed.",
                 "The boot (straight / 70 / 90 degrees) is HELD, so the model stops at the backshell's exit collar.",
                 "Scaled values (orange on the drawing) are read off MoTeC's drawing at its printed scale, not printed numbers.",
                 "Pin colour is not visible in the photo."],
    "cross_checks": [
        "Header widths: re-measured at 600 dpi on MoTeC p.3 (35.01 / 29.01) and on the PDM manual p.47 drawing of the same case "
        "(34.98 / 28.92); TE's 34- and 26-way housings differ by two 3 mm pin columns (38.2 vs 32.2), and 35.0 - 29.0 = 6.0. The "
        "ECU-side headers are TE cap assemblies (3-1437285-x, TE sheet 1 table 1), whose drawings are not on file."],
    "notes": ["The 18 degree angle on MoTeC's p.3 is the connector housing's side draft (bottom view). The plugs exit straight "
              "down; research/2026-06-09_design-inputs-recon.md reads it as an '18 degree connector exit'.",
              "MoTeC's label is a raised badge (product photo). It is drawn as a flush panel in a 0.4 mm recess so the printed "
              "38.7 depth holds; its lettering is redrawn from the photo as cosmetic text, not MoTeC's artwork."],
}
UNIT = M1.M1Unit(SPEC)


def build():
    return UNIT.build()


def part_meta(bodies):
    return UNIT.part_meta(bodies)


if __name__ == "__main__":
    UNIT.main(sys.argv[1] if len(sys.argv) > 1 else "out")
