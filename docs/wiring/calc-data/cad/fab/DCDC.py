#!/usr/bin/env python3
"""DC-DC charger: Victron Orion-Tr Smart 12/12-30A (360 W) non-isolated (Victron ORI121236140).

Drawn from Victron's own dimension drawing for the 360-400 W non-isolated housings ("Dimension Drawing - Orion
360W-400W non isolated", which lists ORI121236140): the base plate, its four slots, the fins, the housing and the
terminal block. The terminal order is printed on the unit ("IN +", "GND -", "OUT +", Victron's product photo).

Frame (mm): origin at the centre of the base (the fins and flanges stand on the mounting surface). +Z up, +X along
the 186 mm length, the terminal block faces -Y (the maker's front view looks at it); the remote plug is at -X.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/DCDC.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cylinder, Pos, Rot, fillet

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402

DWG = ("https://www.victronenergy.com/upload/documents/Orion-Tr-Smart-12V-24V-360W-400W-Non-Isolated_dimensions.pdf "
       "(Victron, fetched 2026-09-29)")
SC = f"scaled off {DWG}, scale from its printed 186 length"
PHURL = ("https://www.victronenergy.com/upload/documents/ORI121236140_Orion-Tr%20Smart%2012-12-30A%20%28360W%29%20"
         "Non-isolated%20DC-DC%20charger%20%28front-angle%29.png (Victron, fetched 2026-09-29)")
PHOTO = f"Victron product photo {PHURL}, k-means of the region"
MAN = "reference_documents/web_snapshots/www.victronenergy.com__34439-Orion-Tr_Smart_DC-DC_Charger-pdf-en.md"

P = {
    "length": Dim(186.0, f"{DWG} (front view, over the flanges)"),
    "depth": Dim(132.3, f"{DWG} (side view, over the heatsink lip)"),
    "height": Dim(84.2, f"{DWG} (front view, base to the housing top)"),
    "flange_t": Dim(4.0, f"{DWG} (front view, flange thickness)"),
    "slot_pitch_x": Dim(174.0, f"{DWG} (top view, slot centres across the length)"),
    "slot_pitch_y": Dim(71.5, f"{DWG} (top view, slot centres)"),
    "slot_edge": Dim(25.0, f"{DWG} (top view, slot centre to the plate edge, both ends)"),
    "slot_w": Dim(8.0, f"{DWG} (detail A, slot width, R4)"), "slot_in": Dim(6.0, f"{DWG} (detail A, slot centre in from the edge)"),
    "housing_over": Dim(5.2, f"{DWG} (top view, housing beyond the plate)"),
    "plate_w": Dim(121.5, f"{DWG}: 25 + 71.5 + 25", note="base plate front to back"),
    "fin_n": Dim(12, SC, "scaled"), "fin_pitch": Dim(13.0, SC, "scaled"), "fin_t": Dim(2.2, SC, "scaled"),
    "fin_top": Dim(32.0, SC, "scaled", "fins end under the heatsink plate"),
    "fin_gap": Dim(1.4, SC, "scaled", "fin tips stop short of the mounting surface"),
    "sink_w": Dim(163.0, SC, "scaled", "heatsink plate / lip length"), "sink_top": Dim(39.6, SC, "scaled"),
    "housing_w": Dim(153.0, SC, "scaled", "blue housing length"), "housing_d": Dim(118.0, SC, "scaled", "blue housing depth"),
    "housing_r": Dim(10.0, SC, "scaled", "top edge round"),
    "block_w": Dim(55.0, SC, "scaled", "black terminal block"), "block_front": Dim(64.6, SC, "scaled", "block face from the centre"),
    "block_back": Dim(40.7, SC, "scaled"), "block_top": Dim(83.0, SC, "scaled"),
    "term_pitch": Dim(10.1, SC, "scaled", "screw terminal pitch"), "term_z": Dim(52.5, SC, "scaled", "terminal centre above the base"),
    "window_w": Dim(34.4, SC, "scaled"), "window_z0": Dim(42.0, SC, "scaled"), "window_z1": Dim(63.0, SC, "scaled"),
    "remote_x": Dim(-43.4, SC, "scaled", "green remote H/L plug centre"), "remote_w": Dim(14.4, SC, "scaled"),
    "remote_z0": Dim(34.4, SC, "scaled"), "remote_z1": Dim(59.0, SC, "scaled"), "remote_proud": Dim(6.4, SC, "scaled"),
}
COLORS = {
    "housing": ("#2490d6", PHOTO + " (housing, 70%)"),
    "sink": ("#2a2925", PHOTO + " (heatsink fins and flanges, 67%)"),
    "block": ("#373430", PHOTO + " (terminal block, 74%)"),
    "clamp": ("#c4ba9c", PHOTO + " (terminal clamps, 79%)"),
    "screw": ("#b8bcc0", "terminal clamp metal: not sampled (small); drawn steel"),
    "remote": ("#59a87f", PHOTO + " (remote plug, the lit face)"),
    "mark_white": ("#f4f6f8", PHOTO + " (label lettering, near-white)"),
    "stripe": ("#f97d09", PHOTO + " (orange stripe, 85%)"),
}
PART = {
    "pid": "DCDC", "endpoints": ["DCDC"], "maker": "Victron Energy", "pn": "ORI121236140 (Orion-Tr Smart 12/12-30A non-isolated)",
    "title": "Victron Orion-Tr Smart 12/12-30A non-isolated DC-DC charger", "shape_basis": "maker drawing", "viewset": "floor",
    "what": "DC-DC charger, Victron Orion-Tr Smart 12/12-30A (360 W) non-isolated",
    "dims_mm": {"l": 186.0, "w": 132.3, "h": 84.2},
    "dims_note": "186 over the base flanges x 132.3 over the heatsink lip x 84.2 tall (Victron's drawing); the terminal block "
                 "and the remote plug stand a few mm proud of the housing front",
    "frame": "origin at the centre of the base; +Z up, +X along the 186 length, the terminal block faces -Y, remote plug at -X",
    "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"terminals": "-Y", "label": "+Z", "remote": "-Y"}},
    "photo_short": "Victron product photo (front-angle) ORI121236140",
    "branding": ["'victron energy'", "'Orion-Tr Smart'", "'12 | 12 - 30'", "'Non-isolated DC/DC charger'", "orange stripe",
                 "'IN + / GND - / OUT +' on the terminal block", "'L H REMOTE'"],
    "refs": [("[1]", "Non-Isolated_dimensions.pdf (Victron", "Victron dimension drawing, Orion 360-400 W non-isolated (lists ORI121236140)"),
             ("[2]", "scaled off", "measured off [1] at its printed scale (186 long)")],
    "drawing_notes": [
        ("Victron's manual: mount vertically on a non-flammable surface with the power terminals facing downwards.", "#10151a"),
        ("Terminal order IN + / GND - / OUT + (left to right, facing the block) is printed on the unit (Victron's photo).", "#10151a"),
        ("The label and marks are redrawn from Victron's photo (cosmetic, Arial stand-ins).", "photo"),
    ],
    "unknowns": ["The fins, heatsink plate, housing, terminal block and remote plug are scaled off the drawing (no printed number).",
                 "The remote H/L plug is unused in this build only while Victron's wire bridge stays in (pin table DCDC)."],
    "notes": [f"Mounting: '{'Mount vertically on a non-flammable surface, with the power terminals facing downwards'}' ({MAN}); "
              "mounts.yaml flags the DCDC placement."],
}
L, Dp, H = K.v(P["length"]), K.v(P["depth"]), K.v(P["height"])
PW = K.v(P["plate_w"])
YB0 = -K.v(P["block_front"])            # terminal block face
ZT = K.v(P["term_z"])
TX = K.v(P["term_pitch"])
SX, SY = K.v(P["slot_pitch_x"]) / 2, K.v(P["slot_pitch_y"]) / 2


def build():
    ft = K.v(P["flange_t"])
    plate = Pos(0, 0, ft / 2) * Box(L, PW, ft)
    sw = K.v(P["slot_w"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = sx * SX
            plate -= Pos(cx + sx * 5, sy * SY, ft / 2) * Box(10, sw, ft + 2)
            plate -= Pos(cx, sy * SY, -1) * Cylinder(sw / 2, ft + 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    n, pitch, t = int(K.v(P["fin_n"])), K.v(P["fin_pitch"]), K.v(P["fin_t"])
    z0f, z1f = K.v(P["fin_gap"]), K.v(P["fin_top"])
    fins = [Pos((i - (n - 1) / 2) * pitch, 0, (z0f + z1f) / 2) * Box(t, PW, z1f - z0f) for i in range(n)]
    st = K.v(P["sink_top"])
    sink = Pos(0, 0, (z1f + st) / 2) * Box(K.v(P["sink_w"]), Dp, st - z1f)
    base = plate + Compound(children=fins).fuse() + sink
    hw, hd = K.v(P["housing_w"]), K.v(P["housing_d"])
    housing = Pos(0, 0, (st + H) / 2) * Box(hw, hd, H - st)
    housing = fillet(housing.edges().group_by(Axis.Z)[-1], radius=K.v(P["housing_r"]))
    bw, bb, bt = K.v(P["block_w"]), -K.v(P["block_back"]), K.v(P["block_top"])
    block = Pos(0, (YB0 + bb) / 2, (st + bt) / 2) * Box(bw, bb - YB0, bt - st)
    block = fillet(block.edges().filter_by(Axis.Z), radius=3.0)
    ww, wz0, wz1 = K.v(P["window_w"]), K.v(P["window_z0"]), K.v(P["window_z1"])
    block -= Pos(0, YB0 + 1.5, (wz0 + wz1) / 2) * Box(ww, 3.2, wz1 - wz0)
    for i in (-1, 0, 1):
        block -= Pos(i * TX, (YB0 + bb) / 2 - 2, bt - 3) * Cylinder(3.6, 6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    clamps = []
    for i in (-1, 0, 1):
        clamps.append(Pos(i * TX, YB0 + 2.9, (wz0 + wz1) / 2) * Box(TX - 1.2, 1.2, wz1 - wz0 - 1.0))
    clamp_face = Compound(children=clamps).fuse()
    for i in (-1, 0, 1):
        clamp_face -= Pos(i * TX, YB0 + 2.0, ZT) * Box(6.0, 3.0, 4.0)
    screws = [Pos(i * TX, YB0 + 3.2, ZT) * Box(5.0, 0.8, 3.2) for i in (-1, 0, 1)]
    rx, rw, rz0, rz1, rp = K.v(P["remote_x"]), K.v(P["remote_w"]), K.v(P["remote_z0"]), K.v(P["remote_z1"]), K.v(P["remote_proud"])
    remote = Pos(rx, -hd / 2 - rp / 2 + 0.5, (rz0 + rz1) / 2) * Box(rw, rp + 1.0, rz1 - rz0)
    parts = [K.body(base, "DCDC heatsink, fins and base plate", COLORS["sink"][0], finish="cast"),
             K.body(housing, "DCDC housing", COLORS["housing"][0]),
             K.body(block, "DCDC terminal block (IN + / GND - / OUT +)", COLORS["block"][0]),
             K.body(clamp_face, "DCDC screw terminal clamps", COLORS["clamp"][0]),
             K.body(Compound(children=screws).fuse(), "DCDC terminal clamp metal", COLORS["screw"][0], finish="metal"),
             K.body(remote, "DCDC remote on/off plug (L / H)", COLORS["remote"][0])]
    return parts, [], branding()


def branding():
    items = []
    zt = H

    def word(s, size, x, y, what, style="bold", align="left", color=None, z=None, plane="xy"):
        t = K.text_solid(s, size, (x, y, z if z is not None else zt), plane=plane, depth=0.12, style=style, align=align)
        items.append(K.body(t, f"DCDC branding: {what} (redrawn from the photo, cosmetic)", color or COLORS["mark_white"][0], finish="print"))

    x0 = -44.0
    word("victron energy", 3.8, x0 + 6, 45.0, "'victron energy'", style="bolditalic")
    word("Orion-Tr Smart", 8.2, x0, 34.0, "'Orion-Tr Smart'")
    word("12 | 12 - 30", 8.2, x0, 23.5, "'12 | 12 - 30'")
    word("Non-isolated DC/DC charger", 4.6, x0, 14.5, "'Non-isolated DC/DC charger'", style="regular")
    stripe = Pos(x0 + 43, 8.0, zt + 0.06) * Box(86.0, 3.6, 0.12)
    items.append(K.body(stripe, "DCDC branding: orange stripe (redrawn from the photo, cosmetic)", COLORS["stripe"][0], finish="print"))
    word("IP43", 3.4, x0 + 36, 1.0, "'IP43'", style="regular")
    bt = K.v(P["block_top"])
    for i, (s, sign) in enumerate((("IN", "+"), ("GND", "-"), ("OUT", "+"))):
        word(s, 2.4, (i - 1) * TX, YB0 + 20.5, f"'{s}' on the block", align="center", z=bt)
        word(sign, 3.0, (i - 1) * TX, YB0 + 8.0, f"'{sign}' on the block", align="center", z=bt)
    word("L H", 2.6, K.v(P["remote_x"]) - 16.0, -K.v(P["housing_d"]) / 2 - 0.12, "'L H'", align="center",
         z=K.v(P["remote_z1"]) - 2.0, plane="xz-")
    word("REMOTE", 2.2, K.v(P["remote_x"]) - 16.0, -K.v(P["housing_d"]) / 2 - 0.12, "'REMOTE'", align="center",
         z=K.v(P["remote_z0"]) + 2.0, plane="xz-")
    return items


def attach_points():
    out = []
    for i, (nm, note) in enumerate((("in_pos", "IN + (input from the Odyssey side, DCDC_IN)"), ("gnd", "GND - (DCDC_GND)"),
                                    ("out_pos", "OUT + (to the accessory battery, DCDC_OUT)"))):
        out.append({"n": nm, "ep": "DCDC", "at": [(i - 1) * TX, round(YB0, 2), ZT], "dir": [0, -1, 0], "kind": "screw terminal",
                    "note": note + "; bare fine-strand wire, 1.6 Nm (manual 4.2, 4.4)"})
    out.append({"n": "remote", "ep": "DCDC", "at": [K.v(P["remote_x"]), round(-K.v(P["housing_d"]) / 2 - K.v(P["remote_proud"]), 2),
                                                     round((K.v(P["remote_z0"]) + K.v(P["remote_z1"])) / 2, 2)],
                "dir": [0, -1, 0], "kind": "plug", "note": "remote on/off L / H, unused in this build (wire bridge in)"})
    return out


def terminals():
    rows = []
    for i, (pin, name, rx) in enumerate((("IN+", "IN +", r"^input \+"), ("GND", "GND -", r"^negative"), ("OUT+", "OUT +", r"^output \+"))):
        rows.append({"pin": pin, "endpoint": "DCDC", "name": name, "full_name": f"{name} screw terminal (printed on the block)",
                     "match": rx, "at": ((i - 1) * TX, YB0, ZT), "dir": (0, -1, 0)})
    rows.append({"pin": "REMOTE", "endpoint": "DCDC", "name": "remote L / H", "match": r"^remote",
                 "at": (K.v(P["remote_x"]), -K.v(P["housing_d"]) / 2 - K.v(P["remote_proud"]), 46.7), "dir": (0, -1, 0)})
    return rows


def mount_points():
    return [{"n": f"slot_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}", "at": [sx * SX, sy * SY, K.v(P["flange_t"])],
             "dir": [0, 0, -1], "d": K.v(P["slot_w"]), "note": "open slot, 8 wide with an R4 end, 6 in from the plate edge"}
            for sx in (-1, 1) for sy in (-1, 1)]


def _bb(b):
    return Compound(children=b).bounding_box()


def _slots(b):
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in b[0].edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - K.v(P["slot_w"]) / 2) < 0.01}
    return sorted(cs)


CHECKS = [
    ("length over the flanges", lambda b: b[0].bounding_box().size.X, 186.0),
    ("depth over the heatsink lip", lambda b: b[0].bounding_box().size.Y, 132.3),
    ("height", lambda b: _bb(b).max.Z, 84.2),
    ("slot count", lambda b: len(_slots(b)), 4),
    ("slot centres across the length", lambda b: _slots(b)[-1][0] - _slots(b)[0][0], 174.0),
    ("slot centres front to back", lambda b: _slots(b)[1][1] - _slots(b)[0][1], 71.5),
    ("slot centre to the plate edge", lambda b: PW / 2 - _slots(b)[1][1], 25.0),
    ("slot centre in from the flange end", lambda b: L / 2 - _slots(b)[-1][0], 6.0),
    ("heatsink lip beyond the plate (top view prints 5.2; 132.3 and 121.5 give 5.4)", lambda b: (b[0].bounding_box().size.Y - PW) / 2, 5.2, 0.3),
]

if __name__ == "__main__":
    K.run(sys.modules[__name__], sys.argv[1] if len(sys.argv) > 1 else "out")
