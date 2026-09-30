#!/usr/bin/env python3
"""Battery isolator: Blue Sea Systems 7700 ML-RBS remote battery switch with manual control, 12 V, 500 A.

Drawn from Blue Sea's own instruction sheet 990180170-006 p.2: the dimension drawing (front, side and stud-end views:
95.25 wide, 138.94 over the studs, 51.56 deep, holes 76.20 x 114.30, studs 48.26 apart and 26.16 off the back) and the
wiring diagram (five control leads: red +12 V 24 h, black ground, brown close, orange open, yellow LED). The stud length
is Blue Sea's product page figure. Everything else is scaled off the drawing at its printed 95.25 width.

Frame (mm): origin at the centre of the four mounting holes on the flat back (the mounting face). +Z out of the back
toward the front, +Y up in Blue Sea's front view (manual knob up, studs down), +X right; stud A at -X, B at +X.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/ISOLATOR.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/BlueSea_7700_ML-RBS_Instructions_990180170-006.pdf"
DWG = f"{DS} p.2, dimension drawing"
WIR = f"{DS} p.2, wiring diagram and control circuit connections"
SC = f"scaled off {DS} p.2 drawing (400 dpi), scale from its printed 95.25 width"
PAGE = ("reference_documents/web_snapshots/www.bluesea.com__ML-RBS_Remote_Battery_Switch_with_Manual_Control_-_12V_DC_500A.md "
        "(Blue Sea product page, fetched 2026-09-28)")
PHURL = "https://dh778tpvmt77t.cloudfront.net/images/products/7700.jpg (Blue Sea, fetched 2026-09-29)"
PHOTO = f"Blue Sea product photo {PHURL}, k-means of the region"

P = {
    "width": Dim(95.25, f"{DWG} (front view, 3.75 in)"),
    "height": Dim(138.94, f"{DWG} (front view, 5.47 in over the studs)"),
    "depth": Dim(51.56, f"{DWG} (side view, 2.03 in)"),
    "hole_px": Dim(76.20, f"{DWG} (front view, 3.00 in hole centres across)"),
    "hole_py": Dim(114.30, f"{DWG} (front view, 4.50 in hole centres up and down)"),
    "stud_pitch": Dim(48.26, f"{DWG} (stud-end view, 1.90 in)"),
    "stud_z": Dim(26.16, f"{DWG} (stud-end view, 1.03 in stud axis off the back)"),
    "stud_d": Dim(9.525, f"{PAGE}: 'Terminal Stud Size 3/8\" - 16 (M10)'", note="3/8 in major diameter"),
    "stud_l": Dim(22.23, f"{PAGE}: 'Terminal Stud Length 0.875in (22.23 mm)'", note="the drawing's threads measure 22.2 at its scale"),
    "ring_clear": Dim(29.97, f"{PAGE}: 'Terminal Ring Diameter Clearance 1.18in (29.97 mm)'", note="largest lug ring that fits"),
    "hole_top": Dim(9.75, SC, "scaled", "upper hole centres below the top edge"),
    "hole_d": Dim(5.0, SC, "scaled", "mounting hole", "fit-critical, scaled"),
    "ear_boss_d": Dim(11.0, SC, "scaled", "raised land round each hole"),
    "ear_t": Dim(7.0, SC, "scaled", "mounting ears' thickness off the back"),
    "cap_h": Dim(19.7, SC, "scaled", "top cap behind the knob: its height below the top edge"),
    "cap_z": Dim(21.0, SC, "scaled", "top cap depth off the back (the knob stands in front of it)"),
    "knob_w": Dim(44.4, SC, "scaled", "manual knob width"), "knob_x": Dim(-4.2, SC, "scaled", "knob centre off the part centre"),
    "knob_z0": Dim(27.0, SC, "scaled", "knob back face off the mounting face"),
    "knob_h": Dim(17.0, SC, "scaled", "knob height below the top edge (2.4 to 19.4)"),
    "seam_y": Dim(100.8, SC, "scaled", "housing seam below the top edge (upper housing / terminal housing)"),
    "low_y": Dim(116.7, SC, "scaled", "terminal housing bottom below the top edge: the stud seat (138.94 - 22.23 = 116.71)"),
    "ear_low": Dim(133.6, SC, "scaled", "lower ears' bottom edge below the top edge"),
    "boot_d": Dim(9.6, SC, "scaled", "control-lead boot"), "boot_z": Dim(41.0, SC, "scaled", "boot axis off the back"),
    "boot_l": Dim(13.9, SC, "scaled", "boot below the terminal housing (its end 130.6 below the top edge)"),
    "back_r": Dim(4.0, SC, "scaled", "front edge round"),
    "label_w": Dim(52.0, SC, "scaled", "front label window"), "label_h": Dim(47.0, SC, "scaled"),
    "lead_d": Dim(2.3, "Blue Sea: 'Use minimum 16 AWG wire for the Control Circuit' (16 AWG insulated ~2.3 mm)", "assumed",
                 "the tinned control leads' own gauge is not printed"),
    "jacket_d": Dim(6.5, "sized off the Blue Sea product photo against the printed 95.25 width", "photo",
                    "black jacket round the five leads, ±1.5 (thin in the photo)"),
    "jacket_l": Dim(110.0, "the jacket length is not printed; the photo shows it about 1.5 x the case height before the split",
                    "assumed"),
    "lead_l": Dim(40.0, "the lead tails' length is not printed", "assumed", "drawn as 40 mm tails past the jacket; read at the bench"),
}
COLORS = {
    "body": ("#575458", PHOTO + " (housing, 73%)"),
    "knob": ("#feef95", PHOTO + " (manual knob, yellow, 44%; the photo's lit face)"),
    "stud": ("#b8a372", "tinned copper stud: not sampled (small in the photo); drawn brass-tin"),
    "nut": ("#c9ccd0", "stud nut: not in the drawing; drawn zinc"),
    "boot": ("#232527", "lead boot and cable jacket: black in the photo (not sampled, thin)"),
    "label": ("#f2f3f3", PHOTO + " (front label: near-white, dropped by the k-means as background)"),
    "mark": ("#0974b0", PHOTO + " (label lettering, blue, 51%)"),
    "plate": ("#030303", PHOTO + " ('ENGINE' plate, black, 94%)"),
    "plate_text": ("#f2f3f3", PHOTO + " ('ENGINE' lettering, white)"),
    "red": (D.LEAD_HEX["red"], f"{WIR}: red +VDC 24 HR"), "black": (D.LEAD_HEX["black"], f"{WIR}: black GROUND"),
    "brown": (D.LEAD_HEX["brown"], f"{WIR}: brown +VDC TO CLOSE"), "orange": (D.LEAD_HEX["orange"], f"{WIR}: orange +VDC TO OPEN"),
    "yellow": (D.LEAD_HEX["yellow"], f"{WIR}: yellow LED OUTPUT"),
}
PART = {
    "pid": "ISOLATOR", "endpoints": ["ISOLATOR"], "maker": "Blue Sea Systems", "pn": "7700 (ML-RBS, manual control)",
    "title": "Blue Sea Systems 7700 ML-RBS remote battery switch",
    "what": "Battery isolator, Blue Sea 7700 ML-RBS remote battery switch with manual control, 12 V, 500 A continuous",
    "shape_basis": "maker drawing", "viewset": "wall",
    "dims_mm": {"l": 95.25, "w": 51.56, "h": 138.94},
    "dims_note": "95.25 wide x 138.94 over the studs x 51.56 deep (Blue Sea's drawing); the control-lead boot hangs a further "
                 "~6 mm below the stud tips (scaled). Margin ±1 on the printed envelope, ±2 on the scaled features.",
    "margin": {"mm": 2.0, "why": "envelope, holes and studs printed by Blue Sea; the cap, knob, seam, ears and boot are scaled "
                                "off the drawing (±2); the control leads' length is not printed"},
    "frame": "origin at the centre of the four holes on the flat back; +Z out of the back, +Y up (knob up, studs down), "
             "stud A at -X, B at +X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"studs": "-Y", "knob": "+Y", "leads": "-Y", "label": "+Z"}},
    "photo": {"url": "https://dh778tpvmt77t.cloudfront.net/images/products/7700.jpg", "page": "https://www.bluesea.com/products/7700",
              "fetched": "2026-09-29"},
    "photo_short": "Blue Sea product photo 7700",
    "branding": ["front label panel (white) with 'BLUE SEA SYSTEMS'", "'ML-RBS'", "'A' / 'B' stud marks"],
    "dims_draw": [("front", "x", "width", 16), ("front", (-38.1, 57.15, 0), (38.1, 57.15, 0), "hole_px", 12),
                  ("front", (38.1, -57.15, 0), (38.1, 57.15, 0), "hole_py", 12), ("right", "z", "depth", 10),
                  ("front", (-24.13, -40.0, 26.16), (24.13, -40.0, 26.16), "stud_pitch", -34)],
    "refs": [("[1]", "p.2, dimension drawing", "Blue Sea 990180170-006 p.2: dimension drawing (front, side, stud end)"),
             ("[2]", "p.2, wiring diagram", "same page: wiring diagram, control circuit connections"),
             ("[3]", "www.bluesea.com__ML-RBS", "Blue Sea 7700 product page snapshot 2026-09-28 (stud 3/8-16 x 0.875 in, ring clearance 1.18 in)"),
             ("[4]", "scaled off", "measured off [1] at its printed scale (95.25 wide)"),
             ("[5]", "not printed", "not in any source: assumed")],
    "drawing_notes": [
        ("Studs A and B are interchangeable (Blue Sea p.2): #63 from the Odyssey + on A, ISO_OUT to the distribution stud on B.", "#10151a"),
        ("Stud nuts 140 in-lb (15.8 Nm) max (Blue Sea p.2). Mount near the battery, not above a vented battery.", "#10151a"),
        ("The five tinned control leads leave through the boot between the studs; 16 AWG minimum (Blue Sea). They are in the GLB as", "#10151a"),
        ("a 110 mm jacket and 40 mm tails (lengths not printed), not in the STEP or on this sheet.", "assumed"),
        ("The label and marks are redrawn from Blue Sea's photo (cosmetic, Arial stand-ins).", "photo"),
    ],
    "unknowns": ["The top cap, manual knob, housing seam, ears and lead boot are scaled off the drawing (no printed number).",
                 "Control-lead length and gauge are not printed: drawn as a 110 mm jacket and 40 mm tails of 16 AWG.",
                 "Mounting hole diameter is scaled (5.0); confirm the screw size on the part before drilling the bracket."],
}
W, H, DP = K.v(P["width"]), K.v(P["height"]), K.v(P["depth"])
HX, HY = K.v(P["hole_px"]) / 2, K.v(P["hole_py"]) / 2
YT = HY + K.v(P["hole_top"])                  # top edge
YTIP = YT - H                                 # stud tips
SX = K.v(P["stud_pitch"]) / 2
SZ = K.v(P["stud_z"])
YSEAT = YTIP + K.v(P["stud_l"])               # lug seat = terminal housing bottom face
YLOW = YT - K.v(P["low_y"])
YBOOT = YLOW - K.v(P["boot_l"])
BZ = K.v(P["boot_z"])
LEADS = [("ISO_PWR", "red", -3.2), ("ISO_GND", "black", -1.6), ("ISO_CLOSE", "brown", 0.0), ("ISO_OPEN", "orange", 1.6),
         ("ISO_LED", "yellow", 3.2)]


def build():
    from build123d import Axis, fillet
    r = K.v(P["back_r"])
    ych = YT - K.v(P["cap_h"])
    yseam = YT - K.v(P["seam_y"])
    et = K.v(P["ear_t"])
    upper = Pos(0, (ych + yseam) / 2, 0) * D.rbox(W - 2.0, ych - yseam, DP, r=r)
    upper = fillet(upper.edges().group_by(Axis.Z)[-1], radius=r)
    lower = Pos(0, (yseam + YLOW) / 2, 0) * D.rbox(W - 3.0, yseam - YLOW, DP - 3.0, r=3.0)
    cap = Pos(0, (YT + ych - 1.0) / 2, 0) * D.rbox(W, YT - ych + 1.0, K.v(P["cap_z"]), r=3.0)
    ylow_ear = YT - K.v(P["ear_low"])
    ears_low = Pos(0, (yseam + ylow_ear) / 2, 0) * D.rbox(W, yseam - ylow_ear, et, r=3.0)
    body = upper + lower + cap + ears_low
    for sx in (-1, 1):
        for sy in (-1, 1):
            body += D.cyl(K.v(P["ear_boss_d"]), et + 1.0, at=(sx * HX, sy * HY, 0))
            body -= D.cyl(K.v(P["hole_d"]), DP + 2, at=(sx * HX, sy * HY, -1))
    kh = K.v(P["knob_h"])
    knob = Pos(K.v(P["knob_x"]), YT - 2.4 - kh / 2, (K.v(P["knob_z0"]) + DP) / 2) * D.rbox(K.v(P["knob_w"]), kh, DP - K.v(P["knob_z0"]),
                                                                                         r=4.0, align=D.CEN)
    knob = K.body(knob, "ISOLATOR manual knob (LOCK OFF / ON)", COLORS["knob"][0])
    pedestal = Pos(K.v(P["knob_x"]), (YT - 2.4 - kh + ych) / 2 + 1.0, (K.v(P["cap_z"]) + DP - 4) / 2) * Box(K.v(P["knob_w"]) + 8, 4.0,
                                                                                                         DP - 4 - K.v(P["cap_z"]))
    body += pedestal
    parts = [K.body(body, "ISOLATOR housing", COLORS["body"][0]), knob]
    for sx, nm in ((-1, "A"), (1, "B")):
        s = D.cyl(K.v(P["stud_d"]), K.v(P["stud_l"]) + 3.0, at=(sx * SX, YTIP, SZ), axis="y")
        parts.append(K.body(s, f"ISOLATOR stud {nm} (3/8-16)", COLORS["stud"][0], finish="metal"))
        nut = D.hex_prism(14.29, 8.33, at=(sx * SX, YSEAT - 8.33 - 0.01, SZ), axis="y")
        nut -= D.cyl(K.v(P["stud_d"]), 12, at=(sx * SX, YSEAT - 10, SZ), axis="y")
        parts.append(K.body(nut, f"ISOLATOR stud {nm} nut (3/8-16, 9/16 hex)", COLORS["nut"][0], finish="metal"))
    boot = D.cyl(K.v(P["boot_d"]), YLOW - YBOOT + 1.0, at=(0, YBOOT, BZ), axis="y")
    parts.append(K.body(boot, "ISOLATOR control-lead boot", COLORS["boot"][0], finish="rubber"))
    leads = []                         # flexible: in the GLB (with the branding), not in the STEP or the drawing
    jl = K.v(P["jacket_l"])
    jacket = D.cyl(K.v(P["jacket_d"]), jl, at=(0, YBOOT - jl + 0.5, BZ), axis="y")
    leads.append(K.body(jacket, "ISOLATOR control cable jacket", COLORS["boot"][0], finish="rubber"))
    for wid, col, dx in LEADS:
        s, _ = D.lead((dx * 0.6, YBOOT - jl + 1.0, BZ), (dx * 0.06, -1, 0), K.v(P["lead_l"]), d=K.v(P["lead_d"]) * 0.6)
        leads.append(K.body(s, f"ISOLATOR lead {col} ({wid})", COLORS[col][0], finish="rubber"))
    keep = [K.body(Pos(0, YTIP - 30, SZ) * Box(W, 60.0, 40.0), "keep-out: cable lugs and bend below the studs (60 mm)",
                   "#2e7d32", alpha=0.25)]
    return parts, keep, leads + branding()


def branding():
    items = []
    lw, lh = K.v(P["label_w"]), K.v(P["label_h"])
    yc = YT - K.v(P["cap_h"]) - 6.0 - lh / 2
    plate = Pos(0, yc, DP + 0.06) * Box(lw, lh, 0.12)
    items.append(K.body(plate, "ISOLATOR branding: label panel (redrawn from the photo, cosmetic)", COLORS["label"][0], finish="print"))

    def word(s, size, x, y, what, style="bold"):
        t = K.text_solid(s, size, (x, y, DP + 0.12), depth=0.1, style=style)
        items.append(K.body(t, f"ISOLATOR branding: {what} (redrawn from the photo, cosmetic)", COLORS["mark"][0], finish="print"))

    word("BLUE SEA", 6.0, -6.0, yc + 17.0, "'BLUE SEA'")
    word("SYSTEMS", 3.0, -6.0, yc + 11.5, "'SYSTEMS'", style="regular")
    word("ML-RBS", 7.0, -8.0, yc + 3.0, "'ML-RBS'")
    word("7700", 3.4, 19.0, yc + 18.0, "'7700 12V'")
    ep = Pos(0, yc - lh / 2 - 12.0, DP + 0.06) * Box(lw * 0.78, 9.0, 0.12)
    items.append(K.body(ep, "ISOLATOR branding: 'ENGINE' plate (redrawn from the photo, cosmetic)", COLORS["plate"][0], finish="print"))
    t = K.text_solid("ENGINE", 4.2, (0, yc - lh / 2 - 12.0, DP + 0.12), depth=0.1, style="regular")
    items.append(K.body(t, "ISOLATOR branding: 'ENGINE' (redrawn from the photo, cosmetic)", COLORS["plate_text"][0], finish="print"))
    return items


def attach_points():
    out = [{"n": f"stud_{nm}", "ep": "ISOLATOR", "at": [sx * SX, round(YSEAT, 2), SZ], "dir": [0, -1, 0], "kind": "stud",
            "note": f"stud {nm}, 3/8-16, lug seats here; nut 140 in-lb max"} for sx, nm in ((-1, "A"), (1, "B"))]
    out.append({"n": "leads", "ep": "ISOLATOR", "at": [0, round(YBOOT, 2), BZ], "dir": [0, -1, 0], "kind": "flying leads",
                "note": "five tinned control leads (red, black, brown, orange, yellow) out of the boot"})
    return out


def terminals():
    rows = [{"pin": "STUD_A", "endpoint": "ISOLATOR", "registry_endpoint": "PS-STUDS", "name": "stud A (3/8-16)",
             "kind": "stud", "wires": ["63"], "at": (-SX, YSEAT, SZ), "dir": (0, -1, 0),
             "note": "registry: wire 63 lands on PS-STUDS 'isolator stud A'"},
            {"pin": "STUD_B", "endpoint": "ISOLATOR", "registry_endpoint": "PS-STUDS", "name": "stud B (3/8-16)",
             "kind": "stud", "wires": ["ISO_OUT"], "at": (SX, YSEAT, SZ), "dir": (0, -1, 0),
             "note": "registry: ISO_OUT 'Isolator stud B to the distribution stud'"}]
    for wid, col, dx in LEADS:
        rows.append({"pin": col.upper(), "endpoint": "ISOLATOR", "name": f"{col} control lead", "kind": "flying lead",
                     "match": rf"^{col}", "at": (0, YBOOT, BZ), "dir": (0, -1, 0),
                     "free": (dx * 0.6 + dx * 0.06 * K.v(P["lead_l"]), YBOOT - K.v(P["jacket_l"]) - K.v(P["lead_l"]), BZ),
                     "note": "leaves the boot inside the black jacket; free end drawn at the assumed jacket + tail length"})
    return rows


def mount_points():
    return [{"n": f"hole_{'L' if sx < 0 else 'R'}{'T' if sy > 0 else 'B'}", "at": [sx * HX, sy * HY, 0], "dir": [0, 0, -1],
             "d": K.v(P["hole_d"]), "note": "through hole in the ear, back face on the bracket"} for sx in (-1, 1) for sy in (-1, 1)]


def _bb(b):
    return Compound(children=b).bounding_box()


def _holes(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01}
    return sorted(cs)


def _studs(b):
    return [x.bounding_box().center() for x in b if "stud" in x.label and "nut" not in x.label]


CHECKS = [
    ("width", lambda b: b[0].bounding_box().size.X, 95.25),
    ("height over the studs", lambda b: YT - min(x.bounding_box().min.Y for x in b if "stud" in x.label and "nut" not in x.label), 138.94),
    ("depth", lambda b: b[0].bounding_box().size.Z, 51.56),
    ("hole count", lambda b: len(_holes(b)), 4),
    ("hole centres across", lambda b: _holes(b)[-1][0] - _holes(b)[0][0], 76.20),
    ("hole centres up and down", lambda b: _holes(b)[1][1] - _holes(b)[0][1], 114.30),
    ("stud centres", lambda b: _studs(b)[1].X - _studs(b)[0].X, 48.26),
    ("stud axis off the back", lambda b: _studs(b)[0].Z, 26.16),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
