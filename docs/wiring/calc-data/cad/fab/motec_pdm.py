"""MoTeC PDM30 (part 14103) and PDM15 (part 14104): the M130's case with the M6 battery stud, from the PDM manual.

MoTeC's PDM user manual draws both on one sheet ("PDM15 and PDM30", printed p.47) with the same case as the M130:
107.5 x 127.5 x 38.7 mm, three 5.2 mm holes, the 18-degree drafted housing and two Superseal 1.0 headers
(34-way A, 26-way B, 67.5 mm span). What differs from the M130 is the M6 power stud on the flat case front,
74.3 mm above the bottom edge and 17.9 mm proud. What differs between the two PDMs is inside (15 vs 30 outputs,
80 vs 100 A, 260 vs 270 g, specifications p.35) and the label; their cases and connectors are the same (p.35 case
size table, p.43 PDM15 connectors, p.44 PDM30 connectors).
"""
import motec_m1case as M1
import superseal as SS
from k5cad import Dim

MAN = "reference_documents/component_drawings/motec_pdm_user_manual.pdf"
P47 = f"{MAN} printed p.47 (Mounting Dimensions, PDM15 and PDM30)"
P35 = f"{MAN} printed p.35 (Specifications: case size, case, weight)"
M130DS = "reference_documents/component_drawings/motec_m130_datasheet.pdf"
SC = (f"scaled off {M130DS} p.3 (the same case: {MAN} p.47 draws it identically), scale from the printed 107.5 width")
SC47 = f"scaled off {P47} at 600 dpi (107.5 printed width = 1528 px)"
SC47S = f"scaled off {P47}, side view of the stud, scale from its printed 17.9"
KO = ("receipts/2026-06-09_as-built-photo-survey-corrections.md (MoTeC environment constraints) and "
      "research/2026-06-09_design-inputs-recon.md: 60-80 mm below the connector face for the plug and boot")


def make_spec(model):
    pn = {"PDM30": "14103", "PDM15": "14104"}[model]
    photo_url = {"PDM30": "https://assets.motec.com.au/strapi/large_pdm30_c01f1c1cac.webp",
                 "PDM15": "https://assets.motec.com.au/strapi/large_pdm15_ca7836f587.webp"}[model]
    PHOTO = f"MoTeC product photo {photo_url} (fetched 2026-09-29), k-means of the region"
    P = {
        "case_w": Dim(107.5, P47), "case_h": Dim(127.5, P47),
        "depth": Dim(38.7, f"{P47}; {P35} gives 39 (rounded)"),
        "corner_r": Dim(5.5, P47), "plate_t": Dim(15.5, P47, note="thickness of the flat upper case"),
        "housing_h": Dim(41.0, P47, note="height of the lower connector housing above the bottom edge"),
        "draft_deg": Dim(18.0, P47, note="side draft of the connector housing (bottom view)"),
        "hole_d": Dim(5.2, P47, note="3 holes, to suit M5 or 3/16 in"),
        "washer_max": Dim(13.0, P47, note="max washer or head diameter"),
        "hole_edge": Dim(5.0, P47), "hole_pitch": Dim(97.5, P47),
        "hole_low": Dim(47.5, P47, note="lower holes above the bottom edge"),
        "hole_rise": Dim(75.0, P47, note="top hole above the lower holes"),
        "hdr_proud": Dim(5.6, P47, note="headers stand this far below the bottom edge"),
        "hdr_depth": Dim(23.9, P47), "hdr_back": Dim(9.2, P47, note="header rear edge from the back face (so centre 21.15)"),
        "hdr_span": Dim(67.5, P47, note="over both headers"),
        "stud_y": Dim(74.3, P47, note="M6 battery stud centre above the bottom edge, on the centreline"),
        "stud_len": Dim(17.9, P47, note="stud out from the flat case front"),
        "stud_d": Dim(6.0, f"{P47} ('M6 Stud')"),
        "hdr_a_w": Dim(35.0, SC47, "scaled", "header A width (34.98 measured); with the 67.5 span it sets both header centres",
                       "fit-critical, scaled"),
        "hdr_b_w": Dim(29.0, SC47, "scaled", "header B width (28.92 measured)", "fit-critical, scaled"),
        "hdr_wall": Dim(1.6, "not shown on any MoTeC drawing", "assumed", "shroud wall"),
        "hdr_r": Dim(2.0, SC, "scaled", "header corner radius"),
        "latch_w": Dim(3.2, SC, "scaled", "latch window on each header"),
        "latch_proud": Dim(2.8, SC, "scaled", "latch ramp"),
        "front_flat_h": Dim(26.6, SC, "scaled"), "slope_top_h": Dim(38.9, SC, "scaled"),
        "slope_front_h": Dim(30.2, SC, "scaled"), "slope_r": Dim(5.0, SC, "scaled"),
        "draft_start": Dim(12.0, SC, "scaled"), "front_edge_r": Dim(4.0, SC, "scaled"),
        "plate_fillet": Dim(3.0, SC, "scaled"),
        "label_w": Dim(77.9, SC, "scaled", "label recess on the housing front"), "label_h": Dim(17.9, SC, "scaled"),
        "label_y": Dim(14.8, SC, "scaled", "label centre above the bottom edge"),
        "label_depth": Dim(0.4, "not shown on any MoTeC drawing", "assumed"),
        "stud_base_af": Dim(14.0, SC47S, "scaled", "black insulating hex base across flats (16 across corners in the side view; black in the photo)"),
        "stud_base_t": Dim(6.5, SC47S, "scaled", "hex base height"),
        "nut_af": Dim(10.0, SC47S, "scaled", "M6 nut across flats (11.5 across corners in the side view)"),
        "nut_t": Dim(5.0, SC47S, "scaled", "nut height"),
        "pin_pitch": Dim(3.0, f"{SS.TE} p.1 and p.2 (face view: 3 mm pitch, rows offset 1.5)"),
        "row_gap_outer": Dim(3.5, f"{SS.TE} p.1 and p.2 (rows 3.5 / 4 / 3.5)"),
        "row_gap_inner": Dim(4.0, f"{SS.TE} p.1 and p.2"),
        "cav_depth": Dim(13.8, f"inferred: TE's plug nose ({SS.TE} sheets 1-2, scaled 13.7) seats fully inside the header; "
                         "MoTeC does not draw the header internals", "scaled", "header cavity depth above the header face"),
        "keepout_min": Dim(60.0, KO, "design"), "keepout": Dim(80.0, KO, "design"),
    }
    P.update(SS.P)
    RED = ("#9f1718", "MoTeC product photo large_m130 (label frame; the PDM photos show the same red frame)")
    WHITE = ("#e4e0dd", PHOTO + " (label lettering)")
    colors = {
        "case": ("#2a2a2a", PHOTO + " (upper case)"),
        "housing": ("#30312e", PHOTO + " (connector housing)"),
        "label": ("#161716", PHOTO + " (label panel)"),
        "header": ("#2e3032", "MoTeC product photo large_m130 (plug headers; the same headers)"),
        "pins": ("#b9b4a8", "not visible in the photo; drawn as tin-plated brass (colour not sourced)"),
        "stud": ("#bab1a8", PHOTO + " (the stud's nut: zinc-plated steel look)"),
        "numbers": ("#6a6e72", "cavity numbers are moulded in the housing colour; drawn lighter so they read (cosmetic)"),
        "brand_red": RED, "brand_white": WHITE,
        "batt_disc": ("#383230", PHOTO + " (the black '+BATT' ring under the stud)"),
        "keepout": ("#f0a030", "design aid, not a product colour"),
        "plug": SS.C_PLUG, "backshell": SS.C_BS,
    }
    branding = [
        {"what": "red frame around the maker mark", "kind": "frame", "x": -16.9, "y": 0.0, "w": 42.4, "h": 16.4, "r": 3.4,
         "t": 0.85, "color": RED[0]},
        {"what": "maker mark 'MoTeC' (Arial Bold Italic stand-in)", "kind": "text", "s": "MoTeC", "size": 11.0,
         "style": "bolditalic", "x": -16.9, "y": -0.3, "color": WHITE[0]},
        {"what": f"model '{model}'", "kind": "text", "s": model, "size": 6.4, "x": 7.8, "y": 2.6, "align": "left", "color": WHITE[0]},
        {"what": "'Power Distribution'", "kind": "text", "s": "Power Distribution", "size": 2.7, "x": 7.8, "y": -3.3,
         "align": "left", "color": WHITE[0]},
        {"what": "'Module'", "kind": "text", "s": "Module", "size": 2.7, "x": 7.8, "y": -6.6, "align": "left", "color": WHITE[0]},
        {"what": "black '+BATT' ring under the stud", "kind": "disc", "on": "face", "x": 0.0, "y": 74.3, "d": 23.7, "t": 0.4,
         "color": "#383230"},
        {"what": "'+BATT' lettering around the stud", "kind": "ring_text", "on": "face", "x": 0.0, "y": 74.3, "r": 9.9,
         "n": 3, "a0": 90, "s": "+ BATT", "size": 2.3, "color": WHITE[0]},
        {"what": "thin white ring at the edge of the '+BATT' disc", "kind": "frame", "on": "face", "x": 0.0, "y": 74.3,
         "w": 23.2, "h": 23.2, "r": 11.59, "t": 0.35, "color": WHITE[0], "lift": 0.4},
    ]
    other = {"PDM30": "PDM15", "PDM15": "PDM30"}[model]
    return {
        "pid": f"{model}-A", "endpoints": {"A": f"{model}-A", "B": f"{model}-B", "stud": f"{model}-STUD"}, "stud": True,
        "name": model, "pn": pn, "title": f"MoTeC {model} power distribution module · MoTeC part {pn}",
        "what": f"{'Body' if model == 'PDM30' else 'Engine'} power box, MoTeC {model}",
        "dims_note": "107.5 wide x 127.5 tall x 38.7 deep (the M130's case); headers 5.6 below the bottom edge (133.1 overall, "
                     "the manual's 133); the M6 stud stands 17.9 out of the flat case front",
        "P": P, "colors": colors, "branding": branding, "photo_short": f"MoTeC product photo large_{model.lower()}",
        "keepout_src": KO,
        "designations": f"{model.lower()}_designations.txt", "pin_fmt": "{k}{n}",
        "designations_src": f"docs/wiring/calc-data/{model.lower()}_designations.txt (MoTeC PDM manual pinout, "
                            f"{'p.44' if model == 'PDM30' else 'p.43'})",
        "pin_orientation_note": ("Which way the plug's polarity side faces is not printed by MoTeC: the model puts TE's "
                                 "polarity-marked lock on the header's latch side (the front of the unit), which puts A1 and "
                                 "B1 front-left looking up. Check A1 against the moulded numbers before a pin is trusted."),
        "printed": {"case_w": 107.5, "case_h": 127.5, "depth": 38.7, "hole_pitch": 97.5, "hole_rise": 75.0, "hole_low": 47.5,
                    "hole_edge": 5.0, "hdr_proud": 5.6, "hdr_depth": 23.9, "hdr_span": 67.5, "hdr_back": 9.2,
                    "stud_y": 74.3, "stud_len": 17.9},
        "refs": [("[1]", "p.47", "MoTeC PDM user manual (PN 63029) printed p.47: Mounting Dimensions, PDM15 and PDM30"),
                 ("[2]", "p.35", "same manual p.35 Specifications: 107 x 133 x 39 mm case, magnesium, 260 g (PDM15) / 270 g (PDM30)"),
                 ("[3]", f"scaled off {M130DS}", "measured off MoTeC's M130 drawing (the same case) at its printed scale"),
                 ("[4]", "te_C-2-1437285-3", "TE customer drawing 2-1437285-3 (Superseal 1.0 plug housings 34/26), sheets 1-2 (orange = scaled off it)"),
                 ("[5]", "receipts/2026-06-09", "receipts/2026-06-09_as-built-photo-survey-corrections.md (MoTeC environment limits)"),
                 ("[6]", "not shown on any", "no drawing gives it: assumed"),
                 ("[7]", "ProWire SSB", "ProWire SSB-34BS-PA66 / SSB-26BS-PA66 product photos (ProWire prints no dimensions)"),
                 ("[8]", "inferred:", "inferred from [4]: the plug nose seats fully inside the header")],
        "drawing_notes": [
            (f"The {model} shares the M130's case (MoTeC draws them the same). It differs by the M6 stud and the label; "
             f"the {other} is the same outside.", "#10151a"),
            ("Not modelled: the Key 1 ribs inside the headers; the stud's insulating cap (MoTeC draws it dashed); the 1 mm step at the headers.", "assumed"),
            ("The plugs are drawn fully seated (TE's 13.7 mm nose inside the header); TE does not dimension the mated stack.", "assumed"),
            ("The ProWire backshells are sized off ProWire's photos; the boot is HELD, so the model ends at the collar.", "photo"),
            ("The label and the '+BATT' ring are redrawn from the photo as cosmetic text (Arial stand-ins, not MoTeC's artwork).", "#7b3fa0"),
            (f"Pinout: {model}-A_pinout.svg and {model}-A.pins.json (TE numbering; A1 front-left looking up, orientation to confirm on the part).", "#10151a"),
        ],
        "unknowns": ["The Key 1 rib geometry inside the headers is not in any drawing on file; the latch side is modelled.",
                     "Which way the plug's polarity side faces (so where A1 sits) is not printed by MoTeC; the model's choice is marked.",
                     "The stud's hex base and nut sizes are scaled off the side view; the insulating cap is not modelled.",
                     "The plug is drawn fully seated; TE does not dimension the mated stack.",
                     "The ProWire backshells are sized off ProWire's photos (no printed dimensions).",
                     "The boot (straight / 70 / 90 degrees) is HELD, so the model stops at the backshell's exit collar."],
        "cross_checks": [
            "Header widths measured at 600 dpi on p.47: 34.98 / 28.92 (M130 p.3: 35.01 / 29.01); TE's 34- and 26-way housings "
            "differ by two 3 mm pin columns. The p.35 table's 133 mm is 127.5 + the 5.6 mm headers."],
        "notes": [f"{model} vs {other}: same case, headers and stud (p.47 draws both). Inside: PDM15 has 15 outputs and 80 A total, "
                  "PDM30 30 outputs and 100 A; 260 g vs 270 g (p.35). Both are magnesium with only a coated board, not sealed (p.35).",
                  "MoTeC's p.47 sketch shows the battery cable ('4 Power Connection') leaving the stud upward; the attach point "
                  "points +Y."],
    }


def unit(model):
    return M1.M1Unit(make_spec(model))
