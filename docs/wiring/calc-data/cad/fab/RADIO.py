#!/usr/bin/env python3
"""Radio: RetroSound RetroRadio Motor-2B for 1973-87 Chevrolet C/K trucks (radio motor + face + knobs on the InfiniMount
brackets).

Drawn from RetroSound's Motor-2B user manual p.21 Specifications: the radio motor 3.96 in W x 1.98 in H x 4.30 in D and the
radio face 3.5 in W x 1.5 in H x 1.05 in D ('dimensions will vary depending on model purchased'). The brackets, the knob
shafts' spacing and the knobs are sized off Retro Manufacturing's photo of the 1973-87 C/K kit against the printed 3.5 in
face (the face and knob option is not recorded, so the photo's is drawn).

Frame (mm): origin at the centre of the brackets' front face, where they seat on the back of the dash. +Z toward the
driver, +Y up, +X right; the face and knobs stand in front (+Z), the motor behind (-Z).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/RADIO.py <out_dir>
"""
import sys
from pathlib import Path

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

MAN = "reference_documents/component_drawings/RetroSound_Motor-2B_User_Manual.pdf p.21, Specifications"
PHURL = ("https://cdn.shopify.com/s/files/1/0932/8664/products/B-116-03-73_a3f66b26-a268-4a22-b316-45189a60fd9e.jpg "
         "(Retro Manufacturing, fetched 2026-09-29)")
PH = f"sized off Retro Manufacturing's product photo {PHURL} against the printed 3.5 in face width"
PHOTO = f"Retro Manufacturing product photo {PHURL}, k-means of the region"

P = {
    "motor_w": Dim(100.6, f"{MAN}: 'Dimensions (Radio Motor) 3.96\"W'"),
    "motor_h": Dim(50.3, f"{MAN}: '1.98\"H'"),
    "motor_d": Dim(109.2, f"{MAN}: '4.30\"D'"),
    "face_w": Dim(88.9, f"{MAN}: 'Dimensions (Radio Face) 3.5\"W'", note="varies with the face picked"),
    "face_h": Dim(38.1, f"{MAN}: '1.5\"H'"),
    "face_d": Dim(26.7, f"{MAN}: '1.05\"D'"),
    "shaft_pitch": Dim(125.0, PH, "photo", "knob shaft centres, set by the InfiniMount brackets for the C/K dash", "fit-critical, scaled"),
    "knob_d": Dim(26.0, PH, "photo", "chrome knob"), "knob_l": Dim(20.0, PH, "photo"),
    "knob_z0": Dim(4.0, PH, "photo", "knob back off the brackets' face (the dash panel sits between)"),
    "bracket_w": Dim(169.0, PH, "photo", "bracket plates tip to tip"), "bracket_h": Dim(38.0, PH, "photo"),
    "bracket_t": Dim(1.5, PH, "photo", "bracket plate"),
    "window_w": Dim(64.0, PH, "photo", "display window"), "window_h": Dim(12.0, PH, "photo"),
    "bezel_wall": Dim(4.5, PH, "photo", "chrome bezel rim"),
    "plug_w": Dim(30.0, "the power plug body is not dimensioned", "assumed"), "plug_h": Dim(12.0, "as plug_w", "assumed"),
}
COLORS = {
    "motor": ("#b9bcbf", PHOTO + " (motor case, zinc-silver)"),
    "bezel": ("#d7d9db", PHOTO + " (chrome face bezel)"),
    "window": ("#161718", PHOTO + " (display window, black)"),
    "button": ("#1c1c1e", PHOTO + " (push buttons, black)"),
    "knob": ("#d0d3d6", PHOTO + " (chrome knobs)"),
    "bracket": ("#18181a", PHOTO + " (InfiniMount brackets, black)"),
    "plug": ("#1d1d1f", "power harness plug: black (not in the photo)"),
    "rca": ("#b8a270", "RCA jacks: drawn gold"),
    "display": ("#e8eef0", PHOTO + " (display segments, white)"),
}
PART = {
    "pid": "RADIO", "endpoints": ["RADIO"], "maker": "RetroSound (Retro Manufacturing)", "pn": "Motor-2B, 1973-87 C/K kit (face not picked)",
    "title": "RetroSound RetroRadio Motor-2B (1973-87 C/K)",
    "what": "Radio, RetroSound RetroRadio Motor-2B for 1973-87 Chevy C/K trucks: power plug A, front / rear / sub RCA pre-outs, "
            "amp turn-on lead",
    "shape_basis": "datasheet dims", "viewset": "wall",
    "dims_mm": {"l": 169.0, "w": 50.3, "h": 159.9},
    "dims_note": "motor 100.6 W x 50.3 H x 109.2 D behind the dash; face 88.9 x 38.1 x 26.7 in front (RetroSound); knobs on "
                 "shafts ~125 apart on the brackets (photo)",
    "margin": {"mm": 5.0, "why": "motor and face envelopes printed by RetroSound (the face varies by model); the brackets, knob "
                                "shafts and knobs sized off the photo (±5)"},
    "frame": "origin at the centre of the brackets' front face on the back of the dash; +Z toward the driver, +Y up; face in "
             "front, motor behind (-Z)",
    "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"face": "+Z", "plugs": "-Z"}},
    "photo": {"url": "https://cdn.shopify.com/s/files/1/0932/8664/products/B-116-03-73_a3f66b26-a268-4a22-b316-45189a60fd9e.jpg",
              "page": "https://www.retromanufacturing.com/products/1973-87-chevrolet-c-k-series-trucks-retroradio", "fetched": "2026-09-29"},
    "photo_short": "Retro Manufacturing photo, 1973-87 C/K RetroRadio (116-03-73 face)",
    "branding": ["display 'FM1 87.5' segments", "five push buttons"],
    "dims_draw": [("front", "x", "bracket_w", -10), ("right", (0, 0, -109.2), (0, 0, 0), "motor_d", -10),
                  ("right", (0, 0, 0), (0, 0, 26.7), "face_d", -10)],
    "refs": [("[1]", "Specifications", "RetroSound Motor-2B user manual p.21: Specifications (motor, face)"),
             ("[2]", "sized off Retro", "sized off Retro Manufacturing's 1973-87 C/K photo against the printed 3.5 in face"),
             ("[3]", "not dimensioned", "not in any source: assumed")],
    "drawing_notes": [
        ("Power harness (plug A): red ignition #31, yellow constant, black ground, blue/white amp turn-on, each spliced;", "#10151a"),
        ("front, rear and sub RCA pre-outs plug in (registry). The face and knob option is not picked: the photo's is drawn.", "#10151a"),
    ],
    "unknowns": ["Face and knob option not recorded (HB/HC/HBC/HCB-M2-<face>-<knobs>): the face envelope varies by model.",
                 "Knob shaft spacing is set by the InfiniMount brackets for the dash: sized off the photo (≈125).",
                 "Plug and RCA positions on the motor's back are not dimensioned: drawn centred."],
}
MW, MH, MD = K.v(P["motor_w"]), K.v(P["motor_h"]), K.v(P["motor_d"])
FW, FH, FD = K.v(P["face_w"]), K.v(P["face_h"]), K.v(P["face_d"])
SX = K.v(P["shaft_pitch"]) / 2


def build():
    motor = Pos(0, 0, -MD) * Box(MW, MH, MD, align=D.BASE)
    for i in range(9):
        motor -= Pos(-36.0 + 9.0 * i, 0, -MD + 12.0) * Box(3.0, 2.0, MD - 30.0, align=D.BASE).moved(K.Location((0, MH / 2 - 0.9, 0)))
    bw = K.v(P["bezel_wall"])
    face = D.rbox(FW, FH, FD, r=2.0, r_top=1.5)
    face -= Pos(0, 3.0, FD - 3.0) * D.rbox(FW - 2 * bw, FH - 2 * bw - 6.0, 4.0, r=1.0)
    window = Pos(0, 5.0, FD - 3.2) * Box(K.v(P["window_w"]), K.v(P["window_h"]), 0.6, align=D.BASE)
    buttons = [Pos(-26.0 + 13.0 * i, -12.0, FD - 3.0) * D.rbox(11.0, 5.0, 3.5, r=0.6) for i in range(5)]
    bt = K.v(P["bracket_t"])
    brackets = Pos(0, 0, -bt) * Box(K.v(P["bracket_w"]), K.v(P["bracket_h"]), bt, align=D.BASE)
    brackets -= Pos(0, 0, -bt - 1) * Box(MW + 0.5, MH + 1, bt + 2, align=D.BASE)
    parts = [K.body(motor, "RADIO motor (radio chassis)", COLORS["motor"][0], finish="metal"),
             K.body(face, "RADIO face (chrome bezel)", COLORS["bezel"][0], finish="chrome"),
             K.body(window, "RADIO display window", COLORS["window"][0], finish="gloss"),
             K.body(Compound(children=buttons).fuse(), "RADIO push buttons", COLORS["button"][0]),
             K.body(brackets, "RADIO InfiniMount brackets", COLORS["bracket"][0], finish="paint")]
    kd, kl, kz = K.v(P["knob_d"]), K.v(P["knob_l"]), K.v(P["knob_z0"])
    for sx in (-1, 1):
        shaft = D.cyl(6.0, kz + 2.0, at=(sx * SX, 0, -1.0))
        knob = D.cyl(kd, kl * 0.55, at=(sx * SX, 0, kz)) + D.cyl(kd * 0.78, kl * 0.45, at=(sx * SX, 0, kz + kl * 0.55))
        side = "left" if sx < 0 else "right"
        parts.append(K.body(shaft, f"RADIO {side} control shaft", COLORS["motor"][0], finish="metal"))
        parts.append(K.body(knob, f"RADIO {side} knobs (front + rear)", COLORS["knob"][0], finish="chrome"))
    plug = Pos(-20.0, -8.0, -MD - 14.0) * Box(K.v(P["plug_w"]), K.v(P["plug_h"]), 14.0, align=D.BASE)
    parts.append(K.body(plug, "RADIO power harness plug A", COLORS["plug"][0]))
    for i in range(6):
        parts.append(K.body(D.cyl(8.0, 10.0, at=(14.0 + 10.0 * (i % 3), 10.0 - 14.0 * (i // 3), -MD - 10.0)),
                            f"RADIO RCA pre-out {['front L', 'front R', 'rear L', 'rear R', 'sub L', 'sub R'][i]}",
                            COLORS["rca"][0], finish="metal"))
    keep = [K.body(Pos(0, 0, -MD - 60.0) * Box(MW + 10, MH + 10, 46.0, align=D.BASE),
                   "keep-out: harness plug, RCA plugs and their bend behind the motor (60 mm)", "#2e7d32", alpha=0.25)]
    return parts, keep, branding()


def branding():
    t = K.text_solid("FM1  87.5", 5.5, (-4.0, 5.0, FD - 2.55), depth=0.1, style="regular")
    return [K.body(t, "RADIO branding: display 'FM1 87.5' (redrawn from the photo, cosmetic)", COLORS["display"][0], finish="print")]


def attach_points():
    return [{"n": "power_A", "ep": "RADIO", "at": [-20.0, -2.0, round(-MD - 14.0, 2)], "dir": [0, 0, -1], "kind": "plug",
             "note": "power harness plug A: red IGN (#31), yellow constant, black ground, blue/white amp turn-on"},
            {"n": "rca", "ep": "RADIO", "at": [24.0, 3.0, round(-MD - 10.0, 2)], "dir": [0, 0, -1], "kind": "RCA jacks",
             "note": "front, rear and sub pre-outs (plug-in)"}]


def terminals():
    z = -MD - 14.0
    rows = []
    for pin, rx in (("RED", r"^red"), ("YEL", r"^yellow"), ("BLK", r"^black"), ("BLU/WHT", r"^blue/white")):
        rows.append({"pin": pin, "endpoint": "RADIO", "name": f"{pin.lower()} lead of the power harness (plug A)", "kind": "harness lead",
                     "match": rx, "at": (-20.0, -2.0, z), "dir": (0, 0, -1)})
    for pin, rx, i in (("RCA_F", r"^FRONT RCA", 0), ("RCA_R", r"^REAR RCA", 2), ("RCA_S", r"^SUBWOOFER", 4)):
        rows.append({"pin": pin, "endpoint": "RADIO", "name": f"{pin} pre-out (RCA pair)", "kind": "RCA", "match": rx,
                     "at": (14.0 + 10.0 * (i % 3), 10.0 - 14.0 * (i // 3), -MD - 10.0), "dir": (0, 0, -1)})
    return rows


def mount_points():
    return [{"n": f"shaft_{s}", "at": [sx * SX, 0, 0], "dir": [0, 0, -1],
             "note": "knob shaft through the dash's shaft hole; nut on the front"} for s, sx in (("L", -1), ("R", 1))]


def part_meta(bodies):
    return D.part_meta(D.ns(globals()), bodies)


CHECKS = [
    ("motor width", lambda b: b[0].bounding_box().size.X, 100.6),
    ("motor height", lambda b: b[0].bounding_box().size.Y, 50.3),
    ("motor depth", lambda b: b[0].bounding_box().size.Z, 109.2),
    ("face width", lambda b: b[1].bounding_box().size.X, 88.9),
    ("face height", lambda b: b[1].bounding_box().size.Y, 38.1),
    ("face depth", lambda b: b[1].bounding_box().size.Z, 26.7),
]

if __name__ == "__main__":
    D.main(sys.modules[__name__], sys.argv)
