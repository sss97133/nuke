#!/usr/bin/env python3
"""Amplifier: JL Audio VX700/5i 5-channel class D amplifier with DSP (75 W x 4 + 300 W sub).

Drawn from JL Audio's own connection guide (JL_Audio_VX700-5i_Manual.pdf p.1): top view 250 x 168 with the four corner
mounting holes 222 x 141, the connection-panel view 54 tall with its ten connections numbered 1-10 (power connector
+12 VDC / Ground / Remote, JLid-COMM, JLid-CTRL, the 25-way analog input, SD + Reset, USB, digital in / out, the 8-pin
speaker outputs A/B C/D and the 4-pin subwoofer output). The top panel, the badge and the connection positions are
scaled off the same page at its printed 250 and 54.

Frame (mm): origin at the centre of the base (it mounts flat on its base). +Z up, +X along the 250 length, the connection
panel faces -Y; the power connector is at -X.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/AMP.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Axis, Box, Compound, Pos, fillet

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

DS = "reference_documents/component_drawings/JL_Audio_VX700-5i_Manual.pdf"
TOPV = f"{DS} p.1, top view"
PANV = f"{DS} p.1, connection panel view"
SCT = f"scaled off {TOPV} (300 dpi) at its printed 250 length"
SCP = f"scaled off {PANV} (300 dpi) at its printed 54 height (±3)"
PHURL = ("https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2021/30/136/g13698640-M.jpg (Crutchfield, "
         "fetched 2026-09-29)")
PHOTO = f"Crutchfield product photo {PHURL}, k-means of the region"

P = {
    "length": Dim(250.0, f"{TOPV} (9.81 in / 250 mm)"),
    "width": Dim(168.0, f"{TOPV} (6.62 in / 168 mm)"),
    "height": Dim(54.0, f"{PANV} (2.12 in / 54 mm)"),
    "hole_px": Dim(222.0, f"{TOPV} (8.72 in / 222 mm, hole centres)"),
    "hole_py": Dim(141.0, f"{TOPV} (5.53 in / 141 mm, hole centres)"),
    "end_r": Dim(24.0, SCT, "scaled", "corner round in the top view"),
    "top_r": Dim(10.0, SCP, "scaled", "top edge round (the shell's curved flanks)"),
    "panel_l": Dim(216.0, SCT, "scaled", "recessed top panel, 212.7 inside / 219.5 outside its rim"),
    "panel_w": Dim(135.0, SCT, "scaled", "recessed top panel, 131.6 inside / 138.5 outside"),
    "panel_d": Dim(1.5, "the panel recess depth is not printed", "assumed"),
    "badge_d": Dim(72.0, SCT, "scaled", "round logo badge"),
    "hole_d": Dim(6.0, "the hole size is not printed (the corner caps hide it)", "assumed", "", "fit-critical, scaled"),
    "cap_d": Dim(15.0, SCT, "scaled", "corner cap"),
    "pwr_x": Dim(-78.9, SCP, "scaled", "power connector: Ground receptacle across (+12 VDC at -93.2, Remote at -68.6)"),
    "pwr_z": Dim(32.5, SCP, "scaled", "power receptacles above the base"),
    "db25_x": Dim(-3.2, SCP, "scaled", "25-way analog input centre"), "db25_z": Dim(34.0, SCP, "scaled"),
    "spk_x": Dim(56.0, SCP, "scaled", "8-pin speaker output centre"), "spk_z": Dim(31.5, SCP, "scaled"),
    "sub_x": Dim(74.8, SCP, "scaled", "4-pin subwoofer output centre"), "sub_z": Dim(30.5, SCP, "scaled"),
    "panel_inset": Dim(6.0, SCP, "scaled", "connection panel set back from the shell's side"),
}
COLORS = {
    "shell": ("#5b5e63", PHOTO + " (anodised shell, gunmetal)"),
    "panel": ("#1d1f22", PHOTO + " (brushed top panel, black)"),
    "badge": ("#b9bcc0", PHOTO + " (badge, brushed silver)"),
    "badge_mark": ("#2a2c30", PHOTO + " (badge logo, dark)"),
    "cap": ("#1a1a1b", PHOTO + " (corner caps, black)"),
    "conn": ("#8a8e93", PHOTO + " (plug housings, grey)"),
    "conn_dark": ("#1b1b1c", "connection panel face: black in the manual's view"),
    "metal": ("#c9ccd0", "set screws and contacts: drawn zinc"),
}
PART = {
    "pid": "AMP", "endpoints": ["AMP"], "maker": "JL Audio", "pn": "VX700/5i",
    "title": "JL Audio VX700/5i 5-channel amplifier with DSP",
    "what": "Amplifier, JL Audio VX700/5i 5-channel class D with DSP (75 W x 4 at 4 ohm + 300 W x 1 at 2 ohm)",
    "shape_basis": "maker drawing", "viewset": "floor",
    "dims_mm": {"l": 250.0, "w": 168.0, "h": 54.0},
    "dims_note": "250 x 168 x 54 (JL's connection guide); holes 222 x 141; the harness plugs stand off the connection panel "
                 "(the harnesses are not drawn)",
    "margin": {"mm": 3.0, "why": "envelope and holes printed by JL; the top panel, badge and connection positions scaled (±3); "
                                "hole size and panel recess assumed"},
    "frame": "origin at the centre of the base; +Z up, +X along the 250 length, the connection panel faces -Y, power at -X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"connections": "-Y", "badge": "+Z"}},
    "photo": {"url": "https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2021/30/136/g13698640-M.jpg",
              "page": "https://www.crutchfield.com/p_136VX7005I/JL-Audio-VX700-5i.html", "fetched": "2026-09-29"},
    "photo_short": "Crutchfield product photo VX700/5i",
    "branding": ["round badge with the JL mark", "'VX700/5i'", "'JL AUDIO' on the flank"],
    "dims_draw": [("front", "x", "length", -10), ("top", (-111.0, 70.5, 54.0), (111.0, 70.5, 54.0), "hole_px", 14),
                  ("top", (111.0, -70.5, 54.0), (111.0, 70.5, 54.0), "hole_py", 14), ("right", "z", "height", 10),
                  ("right", "y", "width", -10)],
    "refs": [("[1]", "p.1, top view", "JL Audio VX700/5i connection guide p.1: top view (250 x 168, holes 222 x 141)"),
             ("[2]", "p.1, connection panel view", "same page: connection panel view (54 high, connections 1-10)"),
             ("[3]", "scaled off", "measured off [1] / [2] at their printed scale"),
             ("[4]", "not printed", "not in any source: assumed")],
    "drawing_notes": [
        ("Power connector (1): +12 VDC and Ground set-screw receptacles for 4 AWG (JL: '4 AWG is the required copper wire size'),", "#10151a"),
        ("and Remote; the registry's #32 / AMP_GND are 2 AWG, so the tails into the plug are the open item (registry).", "#10151a"),
        ("Give it 1 in (25 mm) of air above the shell (JL cooling note); keep-out drawn.", "design"),
    ],
    "unknowns": ["Mounting hole size is not printed (corner caps hide it); drawn Ø6.",
                 "Connection positions on the panel are scaled off JL's view (±3).",
                 "The harnesses (analog input, speaker, subwoofer) are not drawn; their lead colours are read on the harness."],
}
L, W, H = K.v(P["length"]), K.v(P["width"]), K.v(P["height"])
HX, HY = K.v(P["hole_px"]) / 2, K.v(P["hole_py"]) / 2
YP = -W / 2 + K.v(P["panel_inset"])                 # connection panel plane


def build():
    shell = D.rbox(L, W, H, r=K.v(P["end_r"]))
    shell = fillet(shell.edges().group_by(Axis.Z)[-1], radius=K.v(P["top_r"]))
    pl, pw, pd = K.v(P["panel_l"]), K.v(P["panel_w"]), K.v(P["panel_d"])
    shell -= Pos(0, 0, H - pd) * D.rbox(pl, pw, pd + 1.0, r=12.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            shell -= D.cyl(K.v(P["hole_d"]), H + 2, at=(sx * HX, sy * HY, -1))
            shell -= D.cyl(K.v(P["cap_d"]) + 0.4, 4.0, at=(sx * HX, sy * HY, H - 3.5))
    # connection panel set into the -Y flank
    shell -= Pos(0, -W / 2 - 1.0, 12.0) * Box(L - 2 * 22.0, 2 * (K.v(P["panel_inset"]) + 1.0), 32.0, align=D.BASE)
    parts = [K.body(shell, "AMP shell (anodised heat sink)", COLORS["shell"][0], finish="metal")]
    parts.append(K.body(Pos(0, 0, H - pd - 0.01) * D.rbox(pl - 0.6, pw - 0.6, 0.6, r=11.7), "AMP top panel (brushed)", COLORS["panel"][0]))
    parts.append(K.body(D.cyl(K.v(P["badge_d"]), pd + 0.4, at=(0, 0, H - pd - 0.4)), "AMP logo badge", COLORS["badge"][0], finish="metal"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(K.body(D.cyl(K.v(P["cap_d"]), 3.5, at=(sx * HX, sy * HY, H - 3.5)),
                                f"AMP corner cap {'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", COLORS["cap"][0]))
    face = Pos(0, YP - 0.5, 12.0) * Box(L - 2 * 22.0, 1.0, 32.0, align=D.BASE)
    parts.append(K.body(face, "AMP connection panel", COLORS["conn_dark"][0]))
    # the ten connections, as housings on the panel (positions scaled off JL's panel view)
    px, pz = K.v(P["pwr_x"]), K.v(P["pwr_z"])
    pwr = Pos(px, YP - 7.0, pz) * D.rbox(38.0, 14.0, 22.0, r=3.0, align=D.CEN)
    for dx, d in ((-14.3, 8.5), (0.0, 8.5), (10.3, 4.0)):
        pwr -= D.cyl(d, 10.0, at=(px + dx, YP - 14.5, pz), axis="y")
    parts.append(K.body(pwr, "AMP (1) power connector plug: +12 VDC / Ground / Remote set-screw receptacles", COLORS["conn"][0]))
    blocks = [("(5) JLid-COMM (RJ45)", -50.8, 30.5, 16.5, 14.0), ("(6) JLid-CTRL (RJ45)", -30.6, 30.5, 16.5, 14.0),
              ("(2) analog audio input (25-way)", K.v(P["db25_x"]), K.v(P["db25_z"]), 36.0, 9.0),
              ("(7) SD + Reset", -4.9, 21.5, 23.0, 8.0), ("(8) USB", 19.8, 23.5, 12.0, 11.0), ("(9) digital in (Toslink)", 33.8, 23.5, 9.0, 10.0),
              ("(10) digital out (Toslink)", 46.8, 23.5, 9.0, 10.0),
              ("(3) speaker outputs A/B C/D (8-pin)", K.v(P["spk_x"]), K.v(P["spk_z"]), 19.0, 11.0),
              ("(4) subwoofer output (4-pin)", K.v(P["sub_x"]), K.v(P["sub_z"]), 12.5, 13.0)]
    for nm, x, z, w, h in blocks:
        parts.append(K.body(Pos(x, YP - 1.5, z) * Box(w, 3.0, h), f"AMP {nm}", COLORS["conn"][0]))
    keep = [K.body(Pos(0, 0, H) * Box(L, W, 25.4, align=D.BASE), "keep-out: 1 in of air above the shell (JL cooling note)",
                   "#2e7d32", alpha=0.25),
            K.body(Pos(0, -W / 2 - 40.0, 0) * Box(L - 30, 80.0, H, align=D.BASE),
                   "keep-out: plugs, harnesses and 4 AWG bend in front of the connection panel (80 mm)", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    items = []
    z = H
    t = K.text_solid("JL", 18.0, (0, 2.0, z), depth=0.15, style="bold")
    items.append(K.body(t, "AMP branding: badge 'JL' mark (redrawn from the photo, cosmetic)", COLORS["badge_mark"][0], finish="print"))
    t = K.text_solid("JL AUDIO", 4.0, (0, -14.0, z), depth=0.15, style="bold")
    items.append(K.body(t, "AMP branding: 'JL AUDIO' on the badge (cosmetic)", COLORS["badge_mark"][0], finish="print"))
    t = K.text_solid("VX700/5i", 4.2, (86.0, -58.0, H - K.v(P["panel_d"])), depth=0.12, style="regular")
    items.append(K.body(t, "AMP branding: 'VX700/5i' (redrawn from the drawing, cosmetic)", COLORS["badge"][0], finish="print"))
    return items


def attach_points():
    px, pz = K.v(P["pwr_x"]), K.v(P["pwr_z"])
    return [{"n": "power", "ep": "AMP", "at": [px, round(YP - 14.0, 2), pz], "dir": [0, -1, 0], "kind": "set-screw plug",
             "note": "(1) +12 VDC / Ground / Remote"},
            {"n": "analog_in", "ep": "AMP", "at": [K.v(P["db25_x"]), round(YP - 3.0, 2), K.v(P["db25_z"])], "dir": [0, -1, 0],
             "kind": "harness", "note": "(2) analog input harness: 6 RCA inputs"},
            {"n": "speaker_out", "ep": "AMP", "at": [K.v(P["spk_x"]), round(YP - 3.0, 2), K.v(P["spk_z"])], "dir": [0, -1, 0],
             "kind": "harness", "note": "(3) speaker output harness, channels A-D"},
            {"n": "sub_out", "ep": "AMP", "at": [K.v(P["sub_x"]), round(YP - 3.0, 2), K.v(P["sub_z"])], "dir": [0, -1, 0],
             "kind": "harness", "note": "(4) subwoofer output harness (two pairs in parallel)"}]


def terminals():
    px, pz = K.v(P["pwr_x"]), K.v(P["pwr_z"])
    y = YP - 14.0
    rows = [{"pin": "+12VDC", "endpoint": "AMP", "name": "+12 VDC set screw", "kind": "set-screw receptacle", "match": r"^\+12 VDC",
             "at": (px - 14.3, y, pz), "dir": (0, -1, 0)},
            {"pin": "GND", "endpoint": "AMP", "name": "Ground set screw", "kind": "set-screw receptacle", "match": r"^Ground",
             "at": (px, y, pz), "dir": (0, -1, 0)},
            {"pin": "REM", "endpoint": "AMP", "name": "Remote turn-on set screw", "kind": "set-screw receptacle", "match": r"^Remote",
             "at": (px + 10.3, y, pz), "dir": (0, -1, 0)},
            {"pin": "IN", "endpoint": "AMP", "name": "analog input harness (RCA inputs 1-6)", "kind": "harness", "match": r"^Input",
             "at": (K.v(P["db25_x"]), YP - 3.0, K.v(P["db25_z"])), "dir": (0, -1, 0)},
            {"pin": "SPK", "endpoint": "AMP", "name": "speaker output harness A-D", "kind": "harness", "match": r"^speaker output",
             "at": (K.v(P["spk_x"]), YP - 3.0, K.v(P["spk_z"])), "dir": (0, -1, 0)},
            {"pin": "SUB", "endpoint": "AMP", "name": "subwoofer output harness", "kind": "harness", "match": r"^subwoofer",
             "at": (K.v(P["sub_x"]), YP - 3.0, K.v(P["sub_z"])), "dir": (0, -1, 0)}]
    return rows


def mount_points():
    return [{"n": f"hole_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", "at": [sx * HX, sy * HY, H], "dir": [0, 0, -1],
             "d": K.v(P["hole_d"]), "note": "corner hole under its cap"} for sx in (-1, 1) for sy in (-1, 1)]


def _holes(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["hole_d"]) / 2) < 0.01}
    return sorted(cs)


CHECKS = [
    ("length", lambda b: b[0].bounding_box().size.X, 250.0),
    ("width", lambda b: b[0].bounding_box().size.Y, 168.0),
    ("height", lambda b: b[0].bounding_box().size.Z, 54.0),
    ("hole count", lambda b: len(_holes(b)), 4),
    ("hole centres along", lambda b: _holes(b)[-1][0] - _holes(b)[0][0], 222.0),
    ("hole centres across", lambda b: _holes(b)[1][1] - _holes(b)[0][1], 141.0),
]

def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
