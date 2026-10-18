"""The 1977 K5 Blazer frame at true size, for the twin and the site (nuke_frontend/public/models/k5-frame.glb).

    ~/.nuke/cad-venv/bin/python docs/wiring/calc-data/cad/fab/chassis_frame.py [out_dir]

Writes k5-frame.glb (metres, glTF Y-up, twin axes: +x driver, -y forward, +z up) and k5-frame.params.json
(every number, its source and basis). Receipt: docs/wiring/receipts/2026-09-30_frame-3d.md.

Every printed number is read by id from calc-data/cad/dimensions.yaml (geometry-scan's table of published
dimensions, receipt 2026-09-30_research-vehicle-geometry); this file adds only what it derives, scales or assumes.
Sources (all on file under reference_documents/, none traced; shapes come from the numbers):
  FR88   k5_factory_docs/1988_Blazer_4WD_Frame_Dimensions.pdf p1, Fig 1 "Complete underbody frame", 2-door 4WD Blazer,
         2705 mm (106-1/2") wheelbase, measuring points A-N. Side view = heights above its datum line and fore-aft
         spacings; bottom view = widths ("combined when equal": divide by 2 for one side) and tram lengths.
         The 73-91 K5 shares this frame; its tram lengths check against the side view to 1 mm (A-G 1587, G-J 1366,
         J-N 1411, diagonals 1769 / 1624 / 1651), so the sheet is self-consistent.
  LTSM   k5_factory_docs/1977_Light_Truck_Service_Manual.pdf p2A-3/2A-4, Fig 2A-2 / 2A-3, row KA105 (1977 K Blazer):
         half-widths to the inside of the rail web T = U = 16-7/8", V = 14"; vertical check points A-N.
  KLM84  k5_factory_docs/KLM_1984_Blazer_4WD_CHT-1.jpg (106.5" WB): body-mount spacing and widths.
  TX469  vehicle_base_drawings/GM_cab_chassis_TX000469_dimensions.jpg (a K30 cab-chassis sheet, same front frame
         family): front spring eye centrelines 31.50" / 31.76".
  RB     Rust Buster frame repair sections RB7354 / RB7352 (rustbuster.com, read 2026-09-30): "Heavy-Duty 7 Gauge Steel".
  PHOTO  the owner's photos of this frame restored, 2024-08-24 (vehicle_images 5453db6e, e843ebed, 90035ad2,
         f0c9d010, b7e7ea8e, 1cac3aa9, 3d50eddb, 9f6c5c4b): which members exist and their shapes, never sizes.
Station s = mm rearward of FR88 point A (the 15 mm hole at the front of the rail). Heights zm = mm above the FR88
datum. Placement in the twin: y = FRONT_AXLE_Y + (s - S_FRONT_AXLE) / 1000, z = Z_DATUM + zm / 1000.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from build123d import Axis, Box, Cylinder, Location, Pos, Solid, Vector, Wire

sys.path.insert(0, str(Path(__file__).parent))
from k5cad import Dim, body, write_glb  # noqa: E402

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[5] / "nuke_frontend/public/models"
DIMS = Path(__file__).resolve().parents[1] / "dimensions.yaml"     # geometry-scan's table of published dimensions


def _load_dims():
    """id -> value_mm from dimensions.yaml (block entries; the cad venv has no PyYAML, so a two-key scan)."""
    out, cur = {}, None
    for line in DIMS.read_text().splitlines():
        if line.startswith("- id: "):
            cur = line[6:].strip()
        elif cur and line.startswith("  value_mm: "):
            out[cur] = float(line.split(":", 1)[1])
            cur = None
    return out


DV = _load_dims()


def D(i):
    return DV[i]


def DS(i):
    return f"dimensions.yaml {i} = {D(i):g}"
FR88 = "FR88 1988 Blazer 4WD frame sheet p1 Fig 1"
LTSM = "LTSM 1977 p2A-4 Fig 2A-3 row KA105"
KLM = "KLM84 1984 Blazer 4WD chart CHT-1"
TX = "TX469 GM cab-chassis sheet TX000469 (K30)"
TWIN = "layout builder build.py (wiring/layout-ui) FRONT_AXLE / REAR_AXLE"

BM2_S = 1457.0   # front cab mount station, scaled (see P["bm2_s"])

P = {  # every number the model uses: value (mm unless noted), source, basis
    # ---- stations: FR88 side view fore-aft spacings, from point A
    "s_A": Dim(0, FR88 + ": A, centre of 15 mm hole inside the front rail (origin)"),
    "s_B": Dim(D("fr88.frame.len.A-G") - D("fr88.frame.len.B-G"), DS("fr88.frame.len.A-G") + " less " + DS("fr88.frame.len.B-G")),
    "s_C": Dim(D("fr88.frame.len.A-G") - D("fr88.frame.len.C-G"), DS("fr88.frame.len.A-G") + " less " + DS("fr88.frame.len.C-G")),
    "s_D": Dim(D("fr88.frame.len.A-G") - D("fr88.frame.len.D-G"), DS("fr88.frame.len.A-G") + " less " + DS("fr88.frame.len.D-G")),
    "s_E": Dim(D("fr88.frame.len.A-G") - D("fr88.frame.len.E-G"), DS("fr88.frame.len.A-G") + " less " + DS("fr88.frame.len.E-G")),
    "s_F": Dim(D("fr88.frame.len.A-G") - D("fr88.frame.len.F-G"), DS("fr88.frame.len.A-G") + " less " + DS("fr88.frame.len.F-G")),
    "s_G": Dim(D("fr88.frame.len.A-G"), DS("fr88.frame.len.A-G")),
    "s_H": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-H"), DS("fr88.frame.len.G-H") + " behind G"),
    "s_I": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-I"), DS("fr88.frame.len.G-I") + " behind G"),
    "s_J": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-J"), DS("fr88.frame.len.G-J") + " behind G"),
    "s_K": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-J") + D("fr88.frame.len.J-K"), DS("fr88.frame.len.J-K") + " behind J"),
    "s_L": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-J") + D("fr88.frame.len.J-L"), DS("fr88.frame.len.J-L") + " behind J"),
    "s_M": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-J") + D("fr88.frame.len.J-M"), DS("fr88.frame.len.J-M") + " behind J"),
    "s_N": Dim(D("fr88.frame.len.A-G") + D("fr88.frame.len.G-J") + D("fr88.frame.len.J-N"), DS("fr88.frame.len.J-N") + " behind J; KLM pad B + 1861 (klm84.frame.bodymount.B-rear-end.driver) lands here too"),
    "s_front_tip": Dim(-45, FR88 + " side view: rail end drawn 12 px ahead of A at the sheet's ~3.9 mm/px", "scaled",
                       "+/-20"),
    "s_rear_tip": Dim(4412, FR88 + " side view: rail end drawn 15 px behind N at ~3.9 mm/px", "scaled", "+/-20"),
    # ---- heights above the FR88 datum (points as the sheet defines them)
    "zm_A": Dim(D("fr88.frame.height.A"), DS("fr88.frame.height.A") + ": A hole centre, read as mid-web of the horn"),
    "zm_B": Dim(D("fr88.frame.height.B"), DS("fr88.frame.height.B") + ": tip of the front hanger's eye bolt"),
    "zm_C": Dim(D("fr88.frame.height.C"), DS("fr88.frame.height.C") + ": crossmember rivet tip on the hump's bottom flange"),
    "zm_E": Dim(D("fr88.frame.height.E"), DS("fr88.frame.height.E") + ": motor-mount bolt tip"),
    "zm_F": Dim(D("fr88.frame.height.F"), DS("fr88.frame.height.F") + ": front spring rear hanger bolt, mid-web, so a hanger-to-rail bolt"),
    "zm_G": Dim(D("fr88.frame.height.G"), DS("fr88.frame.height.G") + ": 16 mm hole, mid-web of the level centre section"),
    "zm_I": Dim(D("fr88.frame.height.I"), DS("fr88.frame.height.I") + ": head of the rear spring front hanger's eye bolt"),
    "zm_J": Dim(D("fr88.frame.height.J"), DS("fr88.frame.height.J") + ": 18x33 oval, mid-web on the kick-up"),
    "zm_K": Dim(D("fr88.frame.height.K"), DS("fr88.frame.height.K") + ": 17x33 oval, mid-web at the top of the kick-up"),
    "zm_L": Dim(D("fr88.frame.height.L"), DS("fr88.frame.height.L") + ": L/L' lower web"),
    "zm_M": Dim(D("fr88.frame.height.M"), DS("fr88.frame.height.M") + ": head of the rear shackle hanger bolt"),
    "zm_N_frame": Dim(D("fr88.frame.height.N-frame"), DS("fr88.frame.height.N-frame") + ": bottom of the rear rail at N"),
    "rivet_head": Dim(6, "rivet head proud of the flange, so the C/D flange sits 6 above the rivet tips", "assumed", "+/-3"),
    # ---- widths: half of FR88's combined numbers; LTSM to the web's inside face
    "web_in_front": Dim(D("gm77.frame.KA105.V"), DS("gm77.frame.KA105.V") + " (14 in): centreline to the inside of the web, front"),
    "web_in_mid_rear": Dim(D("gm77.frame.KA105.T"), DS("gm77.frame.KA105.T") + " = " + DS("gm77.frame.KA105.U")
                           + " (16-7/8 in): inside of the web, centre and rear; FR88 G 866/2 and K 862/2 are web holes"),
    "taper_start": Dim(366, FR88 + " bottom view: rails start to spread between B and C (read at x=290 px)", "scaled",
                       "+/-60"),
    "taper_end": Dim(1212, FR88 + " bottom view: spread done just ahead of F (read at x=480 px)", "scaled", "+/-60"),
    "t": Dim(4.55, "RB: Rust Buster RB7354/RB7352 frame sections are '7 Gauge Steel' (0.179 in); the OEM gauge is not"
                   " printed in any source on file", "vendor", "+/-0.8"),
    "flange": Dim(57, FR88 + " bottom view: rail drawn 18-20 px wide against the printed 824/866 widths", "scaled", "+/-8"),
    # ---- rail depth (perpendicular), from LTSM KA105: a mid-web gauge hole to the underside of the top flange
    #      (the circled points) is half the inside depth
    "d_front_horn": Dim(105, LTSM + ": B(+) 15-1/4 minus A 13-3/8 = 1-7/8 in = half the inside depth", "scaled", "+/-15"),
    "d_front_hump": Dim(155, LTSM + ": D(+) 19-7/8 minus C 17 = 2-7/8 in = half the inside depth", "scaled", "+/-15"),
    "d_center": Dim(160, LTSM + ": F(+) 13 minus G 10 = 3 in = half the inside depth (161); the TurboSquid body in the"
                              " twin draws 150", "scaled", "+/-15"),
    "d_kickup_top": Dim(140, "between d_center and d_rear, at K", "assumed", "+/-15"),
    "d_rear": Dim(120, LTSM + ": N(+) 17-3/4 minus M 15-5/8 = 2-1/8 in = half the inside depth (117)", "scaled", "+/-15"),
    # ---- placement in the twin
    "front_axle_y": Dim(-1.896, TWIN, "design", "twin metres"),
    "wheelbase": Dim(D("fr88.frame.wheelbase"), DS("fr88.frame.wheelbase") + "; the twin uses 2703 (rear axle 0.807), 2 mm short"),
    "s_front_axle": Dim(690.5, "front axle under the front spring: midpoint of B and F (701.5) less 11, so the rear spring"
                               " midpoint (I, M: 3384.5) sits 11 ahead of the rear axle at +2705", "assumed", "+/-25"),
    "z_rail_bottom_center": Dim(0.500, "twin metres; front and rear springs reach the twin's axle centres (z 0.396) with"
                                      " 2-3 in of arch from the FR88 hanger heights; the TurboSquid frame in the twin sits"
                                      " at 0.496. Stock height: the truck has a Rough Country lift (build log,"
                                      " vehicle_observations aa5bff91), height not recorded, which lowers the axles and"
                                      " wheels against frame and body. Needs one tape: floor to the rail's bottom flange"
                                      " at the transmission crossmember, and tyre size", "assumed", "+/-0.040 m"),
    # ---- crossmembers (FR88 bottom view, read against the station lines)
    "cm1_s": Dim(257, FR88 + " bottom view: front crossmember between B and C (x 252-272 px)", "scaled", "+/-20"),
    "cm1_w": Dim(78, FR88 + " bottom view: 20 px at 3.9 mm/px", "scaled", "+/-15"),
    "cm1_h": Dim(100, "channel depth", "assumed", "+/-20"),
    "cm2_s_ds": Dim(562, FR88 + ": C is the crossmember's driver-side rivet"),
    "cm2_s_ps": Dim(621, FR88 + ": D is the crossmember's passenger-side rivet"),
    "cm2_rivet_ds": Dim(D("fr88.frame.cl.C"), DS("fr88.frame.cl.C")),
    "cm2_rivet_ps": Dim(D("fr88.frame.cl.D"), DS("fr88.frame.cl.D")),
    "cm2_dip": Dim(125, "drop of the engine crossmember's middle below the rail (hoop shape from the photos, clears the"
                        " oil pan)", "assumed", "+/-40"),
    "cm2_w": Dim(70, "fore-aft width", "assumed", "+/-15"),
    "cm2_h": Dim(60, "section height", "assumed", "+/-15"),
    "cm3_s0": Dim(1582, FR88 + " bottom view: transmission crossmember's front edge on the G line"),
    "cm3_s1": Dim(1779, FR88 + " bottom view: rear edge 54 px behind G at 3.64 mm/px", "scaled", "+/-20"),
    "cm3_h": Dim(90, "flange height", "assumed", "+/-20"),
    "cm4_s": Dim(3025, FR88 + " bottom view: crossmember just behind J (x 955-970 px)", "scaled", "+/-20"),
    "cm4_w": Dim(60, FR88 + " bottom view: 15 px at 3.94 mm/px", "scaled", "+/-15"),
    "cm5_s": Dim(3676, FR88 + " bottom view: crossmember ahead of LL' (x 1100-1115 px)", "scaled", "+/-25"),
    "cm5_w": Dim(77, FR88 + " bottom view: 15 px at 5.16 mm/px", "scaled", "+/-15"),
    "cm6_s": Dim(4336, FR88 + " bottom view: rear crossmember x 1290-1310 px, ahead of N", "scaled", "+/-20"),
    "cm6_w": Dim(78, FR88 + " bottom view: 20 px at 3.89 mm/px", "scaled", "+/-15"),
    "cm_h_rear": Dim(100, "channel depth of crossmembers 4-6", "assumed", "+/-20"),
    # ---- spring hangers (the eye bolts' ends are printed; plate spacing from a 2.5 in eye)
    "B_tip_x": Dim(D("fr88.frame.width.B-B") / 2, DS("fr88.frame.width.B-B") + ", /2: tip of the front hanger's eye bolt"),
    "F_tip_x": Dim(D("fr88.frame.width.F-F") / 2, DS("fr88.frame.width.F-F") + ", /2: tip of the rear hanger's bolt through the web"),
    "I_head_x": Dim(D("fr88.frame.width.I-I") / 2, DS("fr88.frame.width.I-I") + ", /2: head of the rear spring front hanger's eye bolt"),
    "M_head_x": Dim(D("fr88.frame.width.M-M") / 2, DS("fr88.frame.width.M-M") + ", /2: head of the rear shackle hanger's bolt"),
    "front_spring_x_rear": Dim(403.4, TX + ": 31.76 in between front spring rear eyes (K30 sheet)", "maker", "+/-35"),
    "eye_w": Dim(63.5, "2.5 in spring eye width", "assumed", "+/-6"),
    "bolt_tip_proud": Dim(12, "bolt tip proud of the hanger plate (nut + thread)", "assumed", "+/-5"),
    "F_pivot_drop": Dim(22, "front shackle's upper pivot below the rail's bottom flange", "assumed", "+/-40"),
    "shackle_len": Dim(76, "shackle eye-to-eye", "assumed", "+/-15"),
    "hanger_len": Dim(80, "fore-aft length of a hanger", "assumed", "+/-20"),
    # ---- body mounts, engine mounts
    "bm1_s": Dim(60, "core support mount on top of the horn near the tip (photos); not in FR88/KLM84", "assumed", "+/-40"),
    "bm2_s": Dim(BM2_S, FR88 + " bottom view: front cab mount outrigger centre 46 px behind F at 3.51 mm/px", "scaled",
                 "+/-25"),
    "bm2_x": Dim(D("klm84.frame.bodymount.A.width") / 2, DS("klm84.frame.bodymount.A.width") + ", /2 (KLM pad A = front cab mount)"),
    "bm3_s": Dim(BM2_S + D("klm84.frame.bodymount.A-B.driver"), "bm2_s + " + DS("klm84.frame.bodymount.A-B.driver") + " (FR88 bottom view reads 2501)", "scaled", "+/-25"),
    "bm3_x": Dim(D("klm84.frame.bodymount.B.width") / 2, DS("klm84.frame.bodymount.B.width") + ", /2 (KLM pad B = rear cab mount)"),
    "E_tip_x": Dim(D("fr88.frame.width.E-E") / 2, DS("fr88.frame.width.E-E") + ", /2: motor-mount bolt tip through the bottom flange"),
    "J_x": Dim(D("fr88.frame.width.J-J") / 2, DS("fr88.frame.width.J-J") + ", /2: 14 mm outboard of the web (431 at G and"
                " K), so J's oval is in a plate on the web; the G-J and J-N diagonals close only with it"),
}


def val(k):
    return float(P[k].value)


S_FA, FA_Y = val("s_front_axle"), val("front_axle_y")
T, FL = val("t"), val("flange")


def pchip(xs, ys):
    """Monotone cubic (Fritsch-Carlson): smooth, no overshoot between the sourced knots."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs)
    dlt = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = dlt[0], dlt[-1]
    for i in range(1, len(xs) - 1):
        if dlt[i - 1] * dlt[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dlt[i - 1] + w2 / dlt[i])

    def f(x):
        x = np.clip(x, xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
        t = (x - xs[i]) / h[i]
        h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
        return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
    return f


# ---- the rail: bottom-flange line and depth along s (FR88 datum mm)
d_h, d_hump, d_c, d_k, d_r = (val(k) for k in ("d_front_horn", "d_front_hump", "d_center", "d_kickup_top", "d_rear"))
Z_HUMP = val("zm_C") + val("rivet_head")                       # C/D rivets are on the hump's bottom flange
Z_CENTER = val("zm_G") - d_c / 2                              # G and F are mid-web on the level centre section
Z_REAR = val("zm_N_frame")
Z_K = val("zm_K") - d_k / 2
BOTTOM_KNOTS = [  # (s, bottom zm): printed points, joined smoothly where the sheet draws the bends
    (val("s_front_tip"), val("zm_A") - d_h / 2 + 7),   # tip's bottom edge curves up (drawn)
    (val("s_A"), val("zm_A") - d_h / 2),               # A hole = mid-web
    (val("s_B"), 395.0),                               # lowest point of the horn, over the front hanger (drawn)
    (200, 400.0), (330, 430.0), (470, Z_HUMP - 3),
    (val("s_C"), Z_HUMP), (val("s_E"), Z_HUMP),        # hump: C, D rivets and E motor-mount bolt on its bottom
    (900, Z_HUMP - 17), (1050, 375.0), (1180, Z_CENTER + 15), (1260, Z_CENTER),
    (2640, Z_CENTER),                                  # kick-up starts just ahead of I (drawn at x 870 px)
    (2800, Z_CENTER + 21), (val("s_J"), val("zm_J") - 152 / 2), (3150, 460.0), (val("s_K"), Z_K),
    (3560, Z_K), (3640, Z_K - 15), (3700, Z_REAR + 2),  # the step down behind K (drawn at x 1100-1115 px)
    (3760, Z_REAR), (val("s_rear_tip"), Z_REAR),
]
DEPTH_KNOTS = [(val("s_front_tip"), d_h - 5), (val("s_B"), d_h), (250, 118.0), (470, d_hump), (900, d_hump),
               (1260, d_c), (2640, d_c), (val("s_K"), d_k), (3700, d_r), (val("s_rear_tip"), d_r)]
z_bot = pchip(*zip(*BOTTOM_KNOTS))
depth = pchip(*zip(*DEPTH_KNOTS))
WEB_F, WEB_M = val("web_in_front") + T, val("web_in_mid_rear") + T     # web outer faces


def web_x(s):
    a, b = val("taper_start"), val("taper_end")
    u = min(1.0, max(0.0, (s - a) / (b - a)))
    return WEB_F + (WEB_M - WEB_F) * (1 - math.cos(math.pi * u)) / 2


Z_DATUM_MM = val("z_rail_bottom_center") * 1000 - Z_CENTER    # twin z (mm) of the FR88 datum


def Y(s):
    return (FA_Y * 1000) + (s - S_FA)      # twin y, mm


def Zt(zm):
    return Z_DATUM_MM + zm                 # twin z, mm


def rail_section(s, side, boxed=False, grow=0.0):
    """C-channel (web outboard, flanges inboard) in the plane y = Y(s); vertical extents stretched by 1/cos(slope)."""
    ds = 5.0
    slope = (z_bot(s + ds) + depth(s + ds) / 2 - z_bot(s - ds) - depth(s - ds) / 2) / (2 * ds)
    k = math.sqrt(1 + slope * slope)
    xw, zb, d, tv = web_x(s), Zt(float(z_bot(s))), float(depth(s)) * k, T * k
    y = Y(s)
    if boxed:   # the boxing plate: a flat plate closing the C on its inboard side
        pts = [(xw - FL, zb + tv), (xw - FL + T, zb + tv), (xw - FL + T, zb + d - tv), (xw - FL, zb + d - tv)]
    else:
        pts = [(xw, zb), (xw, zb + d), (xw - FL, zb + d), (xw - FL, zb + d - tv), (xw - T, zb + d - tv),
               (xw - T, zb + tv), (xw - FL, zb + tv), (xw - FL, zb)]
    return Wire.make_polygon([Vector(side * x, y, z) for x, z in pts], close=True)


def loft_rail(s0, s1, side, boxed=False, step=40.0):
    ss = sorted(set([s0, s1] + [s for s in np.arange(s0, s1, step)] + [s for s, _ in BOTTOM_KNOTS if s0 < s < s1]))
    ss = [s for i, s in enumerate(ss) if i == 0 or s - ss[i - 1] > 4.0]
    return Solid.make_loft([rail_section(s, side, boxed) for s in ss], ruled=True)


def rail_top(s):
    return Zt(float(z_bot(s)) + float(depth(s)))


def rail_bot(s):
    return Zt(float(z_bot(s)))


def box(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))


def bolt_x(x0, x1, y, z, dia=14.3):
    """A bolt lying along x from x0 to x1."""
    c = Cylinder(dia / 2, abs(x1 - x0), rotation=(0, 90, 0))
    return Pos((x0 + x1) / 2, y, z) * c


def channel_x(xa, xb, s0, s1, z0, z1, open_side="down"):
    """A C-channel crossmember running along x between xa and xb, fore-aft s0..s1, heights z0..z1 (twin mm)."""
    y0, y1 = Y(s0), Y(s1)
    web = box(xa, xb, y0, y1, z1 - T, z1) if open_side == "down" else box(xa, xb, y0, y1, z0, z0 + T)
    f1 = box(xa, xb, y0, y0 + T, z0, z1)
    f2 = box(xa, xb, y1 - T, y1, z0, z1)
    return web + f1 + f2


FRAME = "#1c1d1f"      # chassis black (the restored frame in the owner's photos)
BRACKET = "#26282b"
BOLT = "#8a8d91"
bodies = []


def add(shape, label, hexc=FRAME, finish="paint"):
    bodies.append(body(shape, label, hexc, finish=finish))


s_tip, s_end = val("s_front_tip"), val("s_rear_tip")
cm1_s, cm1_w = val("cm1_s"), val("cm1_w")
BOX_END = 1260.0                     # front section boxed from the tip to the end of the hump's descent (photos)
for side, sfx in ((1, "L"), (-1, "R")):   # L = driver = +x
    add(loft_rail(s_tip, cm1_s - cm1_w / 2, side), f"bumper_horn_front_{sfx}")
    add(loft_rail(cm1_s - cm1_w / 2, s_end, side), f"frame_rail_{sfx}")
    add(loft_rail(s_tip, BOX_END, side, boxed=True, step=60.0), f"frame_rail_boxing_front_{sfx}", BRACKET)

# ---- crossmembers
x_in = lambda s: web_x(s) - FL                       # inboard edge of the flanges / boxing plate  # noqa: E731
z1 = rail_top(cm1_s) - 8
add(channel_x(-x_in(cm1_s), x_in(cm1_s), cm1_s - cm1_w / 2, cm1_s + cm1_w / 2, z1 - val("cm1_h"), z1),
    "crossmember_1_front")

# 2: engine crossmember, a hoop under the oil pan; ends under the rails' bottom flanges at C (driver) and D (passenger)
secs = []
xw2 = web_x((val("cm2_s_ds") + val("cm2_s_ps")) / 2)
for xi in np.linspace(-xw2, xw2, 17):
    u = (xi + xw2) / (2 * xw2)                               # 0 at passenger (-x), 1 at driver (+x)
    s = val("cm2_s_ps") + (val("cm2_s_ds") - val("cm2_s_ps")) * u
    inner = max(0.0, (abs(xi) - 0.0) / (xw2 - FL))           # 0 at centre, 1 at the flange's inner edge
    drop = val("cm2_dip") * (1 - min(1.0, inner) ** 4) ** 1.5 if abs(xi) < xw2 - FL else 0.0
    ztop = Zt(Z_HUMP) - drop
    y0, y1 = Y(s) - val("cm2_w") / 2, Y(s) + val("cm2_w") / 2
    h = val("cm2_h")
    pts = [(y0, ztop), (y1, ztop), (y1, ztop - h), (y1 - T, ztop - h), (y1 - T, ztop - T), (y0 + T, ztop - T),
           (y0 + T, ztop - h), (y0, ztop - h)]
    secs.append(Wire.make_polygon([Vector(xi, yy, zz) for yy, zz in pts], close=True))
add(Solid.make_loft(secs, ruled=False), "crossmember_2_engine")

s0, s1 = val("cm3_s0"), val("cm3_s1")
zb3 = rail_bot((s0 + s1) / 2)
add(channel_x(-(web_x(s0) - T), web_x(s0) - T, s0, s1, zb3, zb3 + val("cm3_h"), open_side="up"),
    "crossmember_3_transmission")
for key, wkey, name in (("cm4_s", "cm4_w", "crossmember_4_center"), ("cm5_s", "cm5_w", "crossmember_5_over_axle"),
                        ("cm6_s", "cm6_w", "crossmember_6_rear")):
    s, w = val(key), val(wkey)
    zc = (rail_bot(s) + rail_top(s)) / 2
    h = min(val("cm_h_rear"), float(depth(s)) - 2 * T - 4)
    add(channel_x(-(web_x(s) - T), web_x(s) - T, s - w / 2, s + w / 2, zc - h / 2, zc + h / 2), name)

# ---- spring hangers and shackles
HL, EW, TIP = val("hanger_len"), val("eye_w"), val("bolt_tip_proud")
PL = 6.0   # hanger plate thickness (assumed, listed in the receipt)
for side, sfx in ((1, "L"), (-1, "R")):
    sx = side
    # front spring, front hanger at B: the eye bolt's tip is printed; plates straddle a 2.5 in eye
    sB, zB = val("s_B"), Zt(val("zm_B"))
    xo1 = val("B_tip_x") - TIP                    # outer plate's outer face
    xo0, xi1 = xo1 - PL, xo1 - PL - EW - 4        # outer plate inner face, inner plate outer face
    xw = web_x(sB)
    yb0, yb1 = Y(sB) - HL / 2, Y(sB) + HL / 2
    top = rail_bot(sB)
    hng = (box(sx * xo0, sx * xo1, yb0, yb1, zB - 40, top) + box(sx * (xi1 - PL), sx * xi1, yb0, yb1, zB - 40, top)
           + box(sx * xw, sx * xo1, yb0, yb1, top - 14, top) + box(sx * (xw - T), sx * xw, yb0, yb1, top - 14, top + 45))
    add(hng, f"spring_hanger_{sfx}F_front", BRACKET)
    add(bolt_x(sx * (xi1 - PL - 8), sx * val("B_tip_x"), Y(sB), zB), f"spring_bolt_{sfx}F_front", BOLT, "metal")

    # front spring, rear hanger at F: bracket on the web (its bolt tip printed), wrapping under to the shackle pivot
    sF = val("s_F")
    xw = web_x(sF)
    xs = val("front_spring_x_rear")
    zp = rail_bot(sF) - val("F_pivot_drop")
    yf0, yf1 = Y(sF) - HL / 2, Y(sF) + HL / 2
    plate = box(sx * xw, sx * (xw + 8), yf0, yf1, zp - 30, Zt(val("zm_F")) + 50)
    under = box(sx * (xs - EW / 2 - 12), sx * (xw + 8), yf0, yf1, zp - 30, rail_bot(sF))
    inner = box(sx * (xs - EW / 2 - 12), sx * (xs - EW / 2 - 12 + PL), yf0, yf1, zp - 30, rail_bot(sF))
    add(plate + under + inner, f"spring_hanger_{sfx}F_rear", BRACKET)
    add(bolt_x(sx * (xw - T - 10), sx * val("F_tip_x"), Y(sF), Zt(val("zm_F")), 11.1), f"spring_bolt_{sfx}F_rear",
        BOLT, "metal")
    L = val("shackle_len")
    sh = None
    for xc in (xs - EW / 2 - 6, xs + EW / 2 + 6):
        p = Pos(sx * xc, Y(sF) + 10, zp - L / 2) * Box(5, 40, L + 34)
        sh = p if sh is None else sh + p
    add(sh.rotate(Axis((sx * xs, Y(sF), zp), (1, 0, 0)), -15), f"shackle_{sfx}F", BOLT, "metal")

    # rear spring, front hanger at I: outrigger; the eye bolt's head is printed
    sI, zI = val("s_I"), Zt(val("zm_I"))
    xw = web_x(sI)
    xo1 = val("I_head_x") - 8
    xo0, xi1 = xo1 - PL, xo1 - PL - EW - 4
    yi0, yi1 = Y(sI) - HL / 2, Y(sI) + HL / 2
    zt = min(rail_top(sI), zI + 150)
    hng = (box(sx * xo0, sx * xo1, yi0, yi1, zI - 40, zI + 95) + box(sx * (xi1 - PL), sx * xi1, yi0, yi1, zI - 40, zI + 95)
           + box(sx * xw, sx * xo1, yi0, yi1, zI + 85, zI + 95) + box(sx * xw, sx * (xw + 8), yi0 - 30, yi1 + 30, zI - 20, zt))
    add(hng, f"spring_hanger_{sfx}R_front", BRACKET)
    add(bolt_x(sx * (xi1 - PL - TIP), sx * val("I_head_x"), Y(sI), zI), f"spring_bolt_{sfx}R_front", BOLT, "metal")

    # rear spring, rear (shackle) hanger at M: outrigger below the rail; the bolt head is printed
    sM, zM = val("s_M"), Zt(val("zm_M"))
    xw = web_x(sM)
    xo1 = val("M_head_x") - 8
    xo0, xi1 = xo1 - PL, xo1 - PL - EW - 4 - 12       # room for the shackle's two plates around the eye
    ym0, ym1 = Y(sM) - HL / 2 - 30, Y(sM) + HL / 2 + 30
    hng = (box(sx * xo0, sx * xo1, ym0, ym1, zM - 40, rail_top(sM)) + box(sx * (xi1 - PL), sx * xi1, ym0, ym1, zM - 40,
                                                                       rail_top(sM))
           + box(sx * xw, sx * (xi1 - PL), ym0 - 40, ym1 + 40, rail_bot(sM) - 20, rail_top(sM)))
    add(hng, f"spring_hanger_{sfx}R_rear", BRACKET)
    add(bolt_x(sx * (xi1 - PL - TIP), sx * val("M_head_x"), Y(sM), zM), f"spring_bolt_{sfx}R_rear", BOLT, "metal")
    xs = (xi1 + xo0) / 2
    sh = None
    for xc in (xs - EW / 2 - 6, xs + EW / 2 + 6):
        p = Pos(sx * xc, Y(sM), zM - L / 2) * Box(5, 40, L + 34)
        sh = p if sh is None else sh + p
    add(sh.rotate(Axis((sx * xs, Y(sM), zM), (1, 0, 0)), 20), f"shackle_{sfx}R", BOLT, "metal")

    # body mounts
    s1b = val("bm1_s")
    xw = web_x(s1b)
    zt = rail_top(s1b)
    bm1 = box(sx * (xw - FL), sx * (xw + 55), Y(s1b) - 45, Y(s1b) + 45, zt, zt + 6) \
        + box(sx * xw, sx * (xw + 6), Y(s1b) - 45, Y(s1b) + 45, zt - 60, zt + 6)
    bm1 -= Pos(sx * (xw + 10), Y(s1b), zt) * Cylinder(17, 40)
    add(bm1, f"body_mount_1_core_support_{sfx}", BRACKET)
    for n, sk, xk in ((2, "bm2_s", "bm2_x"), (3, "bm3_s", "bm3_x")):
        s, xb = val(sk), val(xk)
        xw = web_x(s)
        zt = rail_top(s)
        pad = box(sx * xw, sx * (xb + 45), Y(s) - 45, Y(s) + 45, zt - 6, zt)
        web = box(sx * xw, sx * (xb + 45), Y(s) - 3, Y(s) + 3, zt - 70, zt)
        mnt = pad + web + box(sx * xw, sx * (xw + 6), Y(s) - 45, Y(s) + 45, zt - float(depth(s)) + 10, zt)
        mnt -= Pos(sx * xb, Y(s), zt) * Cylinder(11, 200)
        add(mnt, f"body_mount_{n}_cab_{'front' if n == 2 else 'rear'}_{sfx}", BRACKET)

    # engine-mount frame brackets at E (the factory position; the LS3 swap's mounts are not recorded)
    sE = val("s_E")
    xin = web_x(sE) - FL
    zb = rail_bot(sE)
    mm = box(sx * (xin - 10), sx * xin, Y(sE) - 55, Y(sE) + 55, zb, zb + 110) \
        + box(sx * (xin - 70), sx * xin, Y(sE) - 55, Y(sE) + 55, zb + 104, zb + 110)
    add(mm, f"frame_engine_mount_{sfx}", BRACKET)
    add(Pos(sx * val("E_tip_x"), Y(sE), zb - (Z_HUMP - val("zm_E")) / 2) * Cylinder(6, Z_HUMP - val("zm_E") + 8),
        f"frame_engine_mount_bolt_{sfx}", BOLT, "metal")

def strip_and_scan(path):
    """Drop root and scene extras, then refuse to ship if the bytes carry a credential-looking string."""
    import struct
    raw = path.read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jl])
    rest = raw[20 + jl:]
    j.pop("extras", None)
    for sc in j.get("scenes", []):
        sc.pop("extras", None)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    raw = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
    # the lead's GLB rules (2026-09-30): no credential words, no 32-hex runs, no Draco (prod's CSP blocks the decoder)
    import re
    low = raw.lower()
    hits = [w for w in (b"api_key", b"token", b"secret", b"blendermcp", b"sketchfab") if w in low]
    hits += [b"hex32"] if re.search(rb"[0-9a-fA-F]{32}", raw) else []
    hits += [b"draco"] if b"KHR_draco" in raw else []
    if hits:
        raise SystemExit(f"refusing to ship {path}: found {hits}")
    path.write_bytes(raw)
    return len(raw)


def mid_web(s):
    return float(z_bot(s)) + float(depth(s)) / 2


def checks():
    """The model's own measuring points against FR88's printed tram lengths and diagonals (mm)."""
    pt = {"A": (WEB_F - T / 2, val("s_A"), mid_web(val("s_A"))), "G": (WEB_M - T / 2, val("s_G"), mid_web(val("s_G"))),
          "J": (val("J_x"), val("s_J"), mid_web(val("s_J"))), "N": (D("fr88.frame.width.N-N") / 2, val("s_N"), D("fr88.frame.height.N-bolt"))}  # tow-bolt tips
    dist = lambda a, b, cross: math.dist((a[0], a[1], a[2]), ((-b[0]) if cross else b[0], b[1], b[2]))  # noqa: E731
    out = []
    for a, b in (("A", "G"), ("G", "J"), ("J", "N")):
        same, diag = D(f"fr88.frame.p2p.{a}-{b}.driver"), D(f"fr88.frame.diag.{a}-{b}")
        for kind, want, cross in (("tram", same, False), ("diagonal", diag, True)):
            got = dist(pt[a], pt[b], cross)
            out.append({"check": f"{a}-{b} {kind}", "model": round(got, 1), "FR88": want, "ok": abs(got - want) <= 5})
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    glb = OUT / "k5-frame.glb"
    write_glb(bodies, glb, linear=0.6, angular=0.35)
    size = strip_and_scan(glb)
    assert size < 10_000_000, size
    table = [{"name": k, "value": d.value, "source": d.source, "basis": d.basis, **({"note": d.note} if d.note else {})}
             for k, d in P.items()]
    stations = {k[2:]: {"s_mm": val(k), "twin_y_m": round(Y(val(k)) / 1000, 4)} for k in P if k.startswith("s_")
                and k not in ("s_front_axle",)}
    rail = [{"s_mm": float(s), "twin_y_m": round(Y(s) / 1000, 4), "web_x_m": round(web_x(s) / 1000, 4),
             "bottom_z_m": round(rail_bot(s) / 1000, 4), "top_z_m": round(rail_top(s) / 1000, 4)}
            for s in list(np.arange(s_tip, s_end, 100.0)) + [s_end]]
    meta = {"file": glb.name, "axes": "twin metres: +x driver, -y forward, +z up; glTF (X,Y,Z) = (x, z, -y)",
            "front_axle_y": FA_Y, "rear_axle_y_by_this_frame": round((Y(S_FA + val("wheelbase"))) / 1000, 4),
            "datum_z_m": round(Z_DATUM_MM / 1000, 4), "nodes": [b.label for b in bodies], "params": table,
            "stations": stations, "rail_profile": rail, "checks": checks()}
    for c in meta["checks"]:
        print(c)
    Path(__file__).with_suffix(".params.json").write_text(json.dumps(meta, indent=1))
    print("wrote", glb, glb.stat().st_size, "bytes,", len(bodies), "nodes")
