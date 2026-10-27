"""The K5's firewall (dash panel, toe board, cowl sides) as a stamped 1 mm panel, for the twin and the site
(nuke_frontend/public/models/k5-firewall.glb). Blender headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P docs/wiring/calc-data/cad/fab/firewall_blender.py -- docs/wiring/calc-data/cad/fab/firewall_ba.json nuke_frontend/public/models/k5-firewall.glb

Frame: twin metres, +x driver, -y forward, +z up; the glTF exporter's Y-up turn gives (x, z, -y), as k5cad.write_glb.
Stock 1973-80 C/K non-AC pressing (the owner's panel; scott-bay 058). Layout (outline, hole centres, tunnel, cowl width)
comes from the bundle adjustment in firewall_ba.json (WVUT f_0785, f_0009, owner 058; FR-88 cowl pair 1715 mm), as the
first version. Construction: every stamped feature is a signed-distance shape on the face (circle, rounded rectangle,
rounded polygon, arch); the face is a constrained Delaunay mesh whose vertices follow each feature's offset contours, so
pressings bend over 4-8 mm and openings are round (64+ segments); openings and the outer edge get turned flanges; the
sheet is solidified to 1 mm. Then run chassis_frame.strip_and_scan on the GLB. Receipt:
docs/wiring/receipts/2026-10-26_k5-firewall-3d.md.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import geometry
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BA = json.load(open(argv[0]))
OUT = argv[1] if len(argv) > 1 else "k5-firewall.glb"
PT = {k: np.array(v) for k, v in BA["points"].items()}
CAM = BA["cams"]["0785"]


def rotvec(rv):
    th = float(np.linalg.norm(rv))
    if th < 1e-12:
        return np.eye(3)
    k = np.asarray(rv) / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


def project(c, X, W=1920, H=1080):
    Xc = rotvec(c[:3]) @ X + np.array(c[3:6])
    x = Xc[:2] / Xc[2]
    x = x * (1 + c[7] * (x @ x))
    return np.array([W / 2 + c[6] * W * x[0], H / 2 + c[6] * W * x[1]])


FACE_Y = -1.450  # mean y of the solved face landmarks (blower, heater, booster, wiper, bulkhead: -1.431 to -1.459)


def onface(u, v):
    """0785 pixel -> (x, z) on the plane y = FACE_Y, through the solved 0785 camera."""
    p = np.array([0.0, 1.0])
    for _ in range(30):
        f = project(CAM, np.array([p[0], FACE_Y, p[1]])) - (u, v)
        J = np.zeros((2, 2))
        for i in range(2):
            d = np.zeros(2); d[i] = 1e-4
            J[:, i] = (project(CAM, np.array([p[0] + d[0], FACE_Y, p[1] + d[1]])) - (u, v) - f) / 1e-4
        p = p - np.linalg.solve(J, f)
    return p


def smoothstep(a, b, t):
    s = np.clip((t - a) / (b - a), 0, 1)
    return s * s * (3 - 2 * s)


def smootherstep(a, b, t):
    """C2 ramp for pressing walls: curvature, not just slope, is continuous, so reflections run smooth."""
    s = np.clip((t - a) / (b - a), 0, 1)
    return s * s * s * (s * (6 * s - 15) + 10)


def chaikin(P, n=3, closed=True):
    for _ in range(n):
        Q = np.roll(P, -1, 0) if closed else P[1:]
        A = P if closed else P[:-1]
        P = np.stack([0.75 * A + 0.25 * Q, 0.25 * A + 0.75 * Q], 1).reshape(-1, 2)
    return P


def resample(P, step, closed=True, nmin=0):
    Q = np.vstack([P, P[:1]]) if closed else P
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    n = max(nmin, int(math.ceil(L[-1] / step)))
    s = np.linspace(0, L[-1], n, endpoint=not closed)
    return np.stack([np.interp(s, L, Q[:, 0]), np.interp(s, L, Q[:, 1])], 1)


def sd_poly(P, V):
    """Signed distance from points P (n,2) to closed polygon V (negative inside)."""
    d = np.full(len(P), np.inf)
    s = np.ones(len(P))
    for i in range(len(V)):
        a, b = V[i - 1], V[i]
        e, w = b - a, P - a
        t = np.clip((w @ e) / (e @ e), 0, 1)
        d = np.minimum(d, np.linalg.norm(w - t[:, None] * e, axis=1))
        c1 = P[:, 1] >= a[1]; c2 = P[:, 1] < b[1]; c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s[flip] *= -1
    return s * d


# ---- shapes: sd(P) negative inside; contour(d) is the loop at offset d
class Circle:
    def __init__(s, c, r):
        s.c, s.r = np.asarray(c, float), r

    def sd(s, P):
        return np.linalg.norm(P - s.c, axis=1) - s.r

    def contour(s, d):
        n = max(64, int(2 * math.pi * (s.r + d) / 0.0055))
        a = np.linspace(0, 2 * math.pi, n, endpoint=False)
        return s.c + (s.r + d) * np.stack([np.cos(a), np.sin(a)], 1)


class RRect:
    def __init__(s, c, half, r):
        s.c, s.h, s.r = np.asarray(c, float), np.asarray(half, float), r

    def sd(s, P):
        q = np.abs(P - s.c) - s.h + s.r
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - s.r

    def contour(s, d):
        r = max(s.r + d, 0.0015)
        h = s.h + d - (s.r + d) + r
        pts = []
        for cx, cz, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            cc = s.c + np.array([cx, cz]) * (h - r)
            for a in np.radians(np.linspace(a0, a0 + 90, 17)):
                pts.append(cc + r * np.array([math.cos(a), math.sin(a)]))
        return resample(np.array(pts), 0.0055, nmin=64)


class Poly:
    """A rounded polygon: the Chaikin-smoothed corner points, offset along the outward normal."""
    def __init__(s, V):
        s.V = resample(chaikin(np.asarray(V, float), 4), 0.003)
        if sd_poly(np.array([s.V.mean(0)]), s.V)[0] > 0 or np.cross(s.V[1] - s.V[0], s.V[2] - s.V[1]) < 0:
            pass
        area = 0.5 * np.sum(s.V[:, 0] * np.roll(s.V[:, 1], -1) - np.roll(s.V[:, 0], -1) * s.V[:, 1])
        if area < 0:
            s.V = s.V[::-1]
        t = np.roll(s.V, -1, 0) - np.roll(s.V, 1, 0)
        s.N = np.stack([t[:, 1], -t[:, 0]], 1) / np.linalg.norm(t, axis=1)[:, None]  # outward for CCW

    def sd(s, P):
        return sd_poly(P, s.V)

    def contour(s, d):
        # offset along the normal, then pull each point onto the sd = d level set (normal offsets bunch and cross at
        # concave corners, which is what rippled the pocket wall), then even the spacing
        P = s.V + d * s.N
        for _ in range(4):
            h = 1e-4
            g = np.stack([(s.sd(P + [h, 0]) - s.sd(P - [h, 0])) / (2 * h), (s.sd(P + [0, h]) - s.sd(P - [0, h])) / (2 * h)], 1)
            P = P - (s.sd(P) - d)[:, None] * g / (np.linalg.norm(g, axis=1)[:, None] ** 2 + 1e-12)
        return resample(chaikin(P, 1), 0.0055)


# ---- the owner's cab (scratchpad ref owner-cab, 2026-10-26), primer, straight on: photo 03 cropped to the panel
# (x 170-650, y 460-660 px) and scaled 3x. Scale from the cowl width: the panel ends sit at crop x 40 and 1380, so
# 1340 crop px = 1.715 m (1.28 mm/px); height from the heater opening's solved top edge (z 1.062 at crop y 202). The
# solved layout agrees within 35 mm: blower (-0.749, 0.988) vs -0.774, 1.002; booster (0.39, 1.067) vs 0.364, 1.053;
# wiper (0.60, 1.158) vs 0.618, 1.157; bulkhead (0.627, 0.962) vs 0.633, 0.928. Where they differ, 03 wins.
CAB_MPX, CAB_X0, CAB_Y0, CAB_Z0 = 1.715 / 1340, 710, 202, 1.062


def cab(X, Y):
    """03 crop pixel -> (x, z) twin metres on the face."""
    return np.array([(X - CAB_X0) * CAB_MPX, CAB_Z0 - (Y - CAB_Y0) * CAB_MPX])


def cabs(pts):
    return np.array([cab(*p) for p in pts])


TOE_Z0 = float(cab(0, 410)[1])  # dash lower edge, 03 crop y 410 (0.796)
TUN_X = float(cab(720, 0)[0])   # arch centre, 03 crop x 720 (+0.013)
TUN_CROWN = float(cab(0, 362)[1])  # arch crown at the dash, 03 crop y 362 (0.857)
TUN_HALF = 130 * CAB_MPX + 0.02  # 03 arch 590-850 crop px wide at the dash edge (333 mm), plus the foot fillet


def arch(x, t=0.0):
    """Semicircular tunnel section (03, 05, 07): 1 at the crown, 0 at the foot, at the dash (t=0) and down the toe
    board (t=1), where it widens."""
    half = TUN_HALF + 0.035 * t
    u = np.clip(np.abs(np.asarray(x) - TUN_X) / half, 0, 1)
    return np.sqrt(np.clip(1 - u ** 2, 0, 1)) * (1 - smoothstep(0.80, 1.0, u)) + 0 * u


# outline: 03, passenger end (image left) first, clockwise as seen from ahead; ends bulge outboard at mid height
TOP = cabs([(140, 112), (115, 92), (160, 72), (720, 66), (1290, 72), (1340, 95), (1330, 120), (1365, 175), (1385, 250),
            (1372, 330), (1320, 395), (1300, 410)])
PS = cabs([(140, 410), (100, 380), (55, 330), (40, 260), (62, 175)])
# lower ends: the panel runs down to the toe line at both ends (05, 03), no cut-away corner
TOP[-2], TOP[-1] = (0.84, TOE_Z0 + 0.03), (0.80, TOE_Z0)
PS[0], PS[1] = (-0.80, TOE_Z0), (-0.84, TOE_Z0 + 0.03)
xb = np.linspace(TOP[-1][0], PS[0][0], 300)
bottom = np.stack([xb, TOE_Z0 + (TUN_CROWN - TOE_Z0) * arch(xb)], 1)
outline_raw = np.vstack([TOP[:-1], bottom, PS])
OUTLINE = resample(chaikin(outline_raw, 3), 0.006)
OUTLINE[:, 0] = np.clip(OUTLINE[:, 0], -0.80, 0.80)  # dash face ends where the cowl-side corner starts
OUTLINE = resample(OUTLINE, 0.006)
OUTER = Poly.__new__(Poly)
OUTER.V = OUTLINE


CORNER_R = 0.10 * 1.715
CORNER_X0 = 1.715 / 2 - 0.12 * 1.715


def ear_y(x):
    # ends flare forward into the cowl sides (03 rounded ends, 02 and 06 at 3/4; 30 mm assumed +/-15)
    # the dash turns forward into the cowl side on a 0.1 W radius starting 0.12 W in from the panel end (05, 01: the
    # blower ring sits on this curve)
    d = np.clip(np.abs(x) - CORNER_X0, 0, CORNER_R * 0.999)
    return -(CORNER_R - np.sqrt(CORNER_R ** 2 - d ** 2))


# ---- stamped features (x, z twin metres) from the 03 crop; each names its photo
# Layout in the lead's photo units (2026-10-27 critique, read on 05 / 006214DA, +/-5%): W = cowl width 1.715 m,
# H = dash-face height from the pinch seam to the tunnel-arch crown.
W_ = 1.715
SEAM_Z = float(OUTLINE[:, 1].max())
H_ = SEAM_Z - TUN_CROWN
SHOULDER_Z = SEAM_Z - 0.45 * H_          # horizontal shoulder, the brow's base
DASH_END_X = 0.80                         # the dash face ends here and turns into the cowl side through the corner
bl = np.array([-(W_ / 2 - 0.07 * W_), 0.965])   # blower: 0.07 W in from the cowl side, lower than the 03 read (05, 01)
wi = cab(1180, 127)
bh = cab(1200, 280)
hc, hh = (cab(358, 202) + cab(463, 355)) / 2, np.abs(cab(463, 355) - cab(358, 202)) / 2
# driver reinforcement plate (dp photo): tall rounded rectangle, inboard edge beside the brow, top 0.12 H under the
# seam; 0.13 m x 0.26 m (1:2)
PLATE_X0, PLATE_X1 = 0.262, 0.392
PLATE_Z1 = SEAM_Z - 0.12 * H_
PLATE_Z0 = PLATE_Z1 - 0.26
PLATE = RRect(((PLATE_X0 + PLATE_X1) / 2, (PLATE_Z0 + PLATE_Z1) / 2), ((PLATE_X1 - PLATE_X0) / 2, (PLATE_Z1 - PLATE_Z0) / 2), 0.030)
bo = np.array([PLATE.c[0] - 0.012, PLATE_Z1 - 0.075])          # push-rod hole, upper half, inboard
STUDS = [bo + (dx, dz) for dx in (-0.033, 0.033) for dz in (-0.033, 0.033)]
COL_HOLE = np.array([PLATE.c[0], PLATE_Z0 + 0.065])            # big round column hole, plate's lower half
pc = np.array([PLATE.c[0] + 0.005, PLATE_Z0 - 0.050])          # seal opening below the plate, inside the second rim
pch = np.array([0.055, 0.030])

# Brow: 0.62 W wide above the shoulder, arched top with its crown 0.18 H under the seam, ends down to the shoulder;
# below the shoulder it narrows between the heater frame and the plate and fades into the tunnel arch. Soft ~50 mm
# fillet (wall 0.10 m), deepest just below the shoulder.
# the brow's ends abut the heater opening's inboard edge and the plate's inboard edge (05)
_bx0, _bx1 = float(hc[0] + hh[0]) + 0.075, PLATE_X0 - 0.055  # wall ends on the heater frame and the plate rim
_bc, _bw = (_bx0 + _bx1) / 2, (_bx1 - _bx0) / 2
_arch = [(_bc + x, SHOULDER_Z + (SEAM_Z - 0.18 * H_ - SHOULDER_Z) * (1 - abs(x / _bw) ** 4) ** 0.5)  # wide dome: flat top third (05)
         for x in np.linspace(_bw, -_bw, 17)]
BROW = Poly(np.array(_arch + [(_bx0 + 0.01, SHOULDER_Z - 0.06), (_bx0 + 0.04, TOE_Z0 + 0.03),
                              (_bx1 - 0.03, TOE_Z0 + 0.03), (_bx1 - 0.01, SHOULDER_Z - 0.06)]))


def brow_depth_scale(z):
    # deepest just below the shoulder; 60 % at the crown; fades into the tunnel below
    up = 1 - 0.4 * smoothstep(SHOULDER_Z, SEAM_Z - 0.18 * H_, z)
    return up * smootherstep(TOE_Z0 + 0.01, TOE_Z0 + 0.16, z)


BAND_Z = float(hc[1] + hh[1]) + 0.035 + 0.006  # band's lower edge just above the heater-frame top, so their walls do not cross

# Plateaus: (shape, depth y [+ = rearward, into the cab], wall width)
PLATEAUS = [
    (BROW, -0.110, 0.100),  # 50 mm fillet each side of the wall
    # upper shoulder band: the strip from the shoulder line to the seam, from the heater-frame top across to the plate
    # top (05, 03); the brow rises out of it, so no line crosses the brow; 6 mm forward, assumed +/-4
    (Poly(np.array([(-DASH_END_X + 0.02, BAND_Z), (DASH_END_X - 0.02, BAND_Z), (DASH_END_X - 0.02, SEAM_Z + 0.05),
                    (-DASH_END_X + 0.02, SEAM_Z + 0.05)])), -0.006, 0.010),  # top beyond the seam: no wall along the top edge
    # passenger end: a shallow pressed ring around the blower hole, 10 mm proud (01 bare, 05)
    (Circle(bl, 0.085), -0.010, 0.030),
    # heater frame: raised rectangle starting 0.05 W inboard of the ring, round and below the heater opening (01, 03)
    (RRect(((bl[0] + 0.085 + 0.05 * W_ + hc[0] + hh[0] + 0.018) / 2, hc[1] - 0.01),
           ((hc[0] + hh[0] + 0.018 - (bl[0] + 0.085 + 0.05 * W_)) / 2, hh[1] + 0.035), 0.015), -0.004, 0.008),
    # the flanged lower rectangle under the heater opening with its plate (05)
    (RRect((hc[0], hc[1] - hh[1] - 0.045), (hh[0] + 0.008, 0.028), 0.008), -0.007, 0.006),
    # wiper-motor boss (03, 05)
    (Circle(wi, 0.045), -0.004, 0.008),
    # the single small dimple at the brow's centre (owner front photo, 03 crop 755, 192)
    (Circle(np.array([0.0, SHOULDER_Z + 0.03]), 0.012), 0.005, 0.008),
]
# column area: a second raised rim framing the seal opening below the plate (dp photo, 05, 01)
COL_RIM_O = RRect(pc, pch + 0.024, 0.026)
COL_RIM_I = RRect(pc, pch + 0.004, 0.022)
PLATEAUS += [(COL_RIM_O, -0.004, 0.006), (COL_RIM_I, 0.004, 0.006)]

# Openings: (shape, flange length rearward, name)
HOLES = [
    (Circle(bl, 43 * CAB_MPX), 0.003, "blower_hole"),              # 03 crop 86 px across; shallow lip (01)
    (RRect(hc, hh, 0.006), 0.012, "heater_opening"),               # 03 crop 358-463 x 202-355
    (Circle(bo, 16 * CAB_MPX), 0.0, "pushrod_hole"),               # dp photo, plate upper half
    (Circle(wi, 20 * CAB_MPX), 0.0, "wiper_motor_hole"),           # 03 crop 1180, 127
    (RRect(bh, np.abs(cab(1225, 302) - cab(1175, 258)) / 2, 0.004), 0.008, "bulkhead_hole"),  # 03 crop 1175-1225 x 258-302
    (RRect(pc, pch, 0.020), 0.008, "column_seal_opening"),         # dp photo: below the plate, toothed flange
    (Circle(COL_HOLE, 0.032), 0.008, "steering_column_hole"),      # dp photo: plate's lower half
]
for c in (bl + (0.095, 0.025), bl + (0.095, -0.012)):            # two small holes just inboard of the blower (01, 05)
    HOLES.append((Circle(c, 0.013), 0.0, "small_hole"))
for p, r in (((1115, 218), 9), ((1258, 338), 9), ((1215, 355), 9)):  # small holes (03)
    HOLES.append((Circle(cab(*p), r * CAB_MPX), 0.0, "small_hole"))

# bead along the tunnel arch on the dash (03 lip at crop y 345-385, 05)
ARCH_LINE = bottom[(np.abs(bottom[:, 0] - TUN_X) < TUN_HALF + 0.05)]
BEAD_OFF, BEAD_H, BEAD_W = 0.022, -0.004, 0.010


def dist_polyline(P, L):
    d = np.full(len(P), np.inf)
    for a, b in zip(L[:-1], L[1:]):
        e, w = b - a, P - a
        t = np.clip((w @ e) / (e @ e), 0, 1)
        d = np.minimum(d, np.linalg.norm(w - t[:, None] * e, axis=1))
    return d


def face_y(P):
    y = FACE_Y + ear_y(P[:, 0])
    for k, (sh, depth, w) in enumerate(PLATEAUS):
        fade = brow_depth_scale(P[:, 1]) if k == 0 else 1.0  # brow: deepest under the shoulder, fades into the tunnel
        y += depth * fade * (1 - smootherstep(-w / 2, w / 2, sh.sd(P)))
    da = dist_polyline(P, ARCH_LINE)
    y += BEAD_H * np.exp(-((da - BEAD_OFF) / (BEAD_W / 2.5)) ** 2) * (P[:, 1] > ARCH_LINE[:, 1].min() - 0.01)
    return y


def material_sd(P):
    """Positive where there is sheet: inside the outline and outside every opening."""
    s = -OUTER.sd(P)
    for sh, _, _ in HOLES:
        s = np.minimum(s, sh.sd(P))
    return s


# ---- face mesh: feature-following rings + a background grid, constrained Delaunay, filtered to the sheet
loops = [OUTLINE]
for sh, depth, w in PLATEAUS:
    for f in np.linspace(-0.85, 0.85, min(17, max(7, int(w / 0.007) | 1))):  # a ring every ~6 mm across the wall
        loops.append(sh.contour(f * w))
for sh, L, _ in HOLES:
    for d in (0.0, 0.003, 0.008):
        loops.append(sh.contour(d))
arch_off = []
for off in (BEAD_OFF - BEAD_W / 2, BEAD_OFF - BEAD_W / 4, BEAD_OFF, BEAD_OFF + BEAD_W / 4, BEAD_OFF + BEAD_W / 2):
    t = np.gradient(ARCH_LINE, axis=0)
    n = np.stack([-t[:, 1], t[:, 0]], 1) / np.linalg.norm(t, axis=1)[:, None]
    n *= np.sign(n[:, 1].mean())
    arch_off.append(resample(ARCH_LINE + off * n, 0.004, closed=False))

pts, edges = [], []


def add_loop(L, closed=True, keep_tol=0.0008):
    m = material_sd(L) > -keep_tol
    base = len(pts)
    idx = -np.ones(len(L), int)
    for i, p in enumerate(L):
        if m[i]:
            idx[i] = len(pts)
            pts.append(tuple(p))
    rng = range(len(L)) if closed else range(len(L) - 1)
    for i in rng:
        a, b = idx[i], idx[(i + 1) % len(L)]
        if a >= 0 and b >= 0:
            edges.append((int(a), int(b)))


add_loop(OUTLINE, keep_tol=1.0)
# rings just inside the outline, so the edge strip is regular quads-in-triangles, not long slivers to the grid
_t = np.roll(OUTLINE, -1, 0) - np.roll(OUTLINE, 1, 0)
_n = np.stack([-_t[:, 1], _t[:, 0]], 1) / (np.linalg.norm(_t, axis=1)[:, None] + 1e-12)
_n *= np.sign((OUTER.sd(OUTLINE + 0.003 * _n) < 0).mean() - 0.5)  # point inward
for d in (0.005, 0.011, 0.019):
    add_loop(OUTLINE + d * _n)
for L in loops[1:]:
    add_loop(L)
for L in arch_off:
    add_loop(L, closed=False)

kd = KDTree(len(pts))
for i, p in enumerate(pts):
    kd.insert((p[0], p[1], 0), i)
kd.balance()
G = 0.018
gx, gz = np.meshgrid(np.arange(-0.88, 0.88, G), np.arange(0.78, 1.30, G))
gp = np.stack([gx.ravel(), gz.ravel()], 1)
gp = gp[material_sd(gp) > 0.004]
for p in gp:
    if kd.find((p[0], p[1], 0))[2] > 0.6 * G:
        pts.append(tuple(p))

V, E, F, _, _, _ = geometry.delaunay_2d_cdt([tuple(p) for p in pts], edges, [], 0, 1e-6)
V2 = np.array([tuple(v) for v in V])
F = [f for f in F if len(f) == 3]
cen = np.array([V2[list(f)].mean(0) for f in F])
F = [f for f, ok in zip(F, material_sd(cen) > 0) if ok]


def sd_grad(fn, P, h=1e-4):
    gx = (fn(P + [h, 0]) - fn(P - [h, 0])) / (2 * h)
    gz = (fn(P + [0, h]) - fn(P - [0, h])) / (2 * h)
    g = np.stack([gx, gz], 1)
    return g / (np.linalg.norm(g, axis=1)[:, None] + 1e-12)


def flanged(V2, F):
    """3D face verts plus a turned flange on every boundary edge: openings bend rearward by their flange length,
    the outer edge turns rearward 25 mm at the top (under the cowl) and 30 mm at the ends (cowl-side flanges);
    the bottom edge meets the toe board and stays open."""
    Vf = np.c_[V2[:, 0], face_y(V2), V2[:, 1]]
    from collections import Counter
    cnt = Counter(tuple(sorted((f[i], f[(i + 1) % 3]))) for f in F for i in range(3))
    bnd = [e for e, n in cnt.items() if n == 1]
    bv = sorted({v for e in bnd for v in e})
    P = V2[bv]
    # which feature each boundary vertex sits on
    length = np.zeros(len(bv))
    gin = np.zeros((len(bv), 2))
    so = OUTER.sd(P)
    on_outer = np.abs(so) < 0.002
    g_out = sd_grad(OUTER.sd, P)
    bottom_edge = on_outer & (P[:, 1] < TUN_CROWN + 0.01) & (np.abs(P[:, 0]) < 0.74)
    length[on_outer & ~bottom_edge] = np.where(np.abs(P[on_outer & ~bottom_edge, 0]) > 0.795, 0.0, 0.025)  # ends join the cowl skin
    length[on_outer] = 0.0  # top edge carries the pinch-weld flange (own part), the ends join the cowl skin, the bottom the toe board
    gin[on_outer] = g_out[on_outer]
    for sh, L, nm in HOLES:
        m = (np.abs(sh.sd(P)) < 0.002) & ~on_outer
        length[m] = max(L, 0.003)
        if nm == "column_seal_opening":  # toothed seal flange: 10 mm tabs on a ~14 mm pitch (driver_plate_34_full)
            ang = np.arctan2(P[m, 1] - sh.c[1], P[m, 0] - sh.c[0])
            length[m] = np.where(np.sin(ang * 24) > 0, 0.010, 0.003)  # every opening gets at least a 3 mm rolled edge, so it catches a highlight
        gin[m] = -sd_grad(sh.sd, P[m]) if m.any() else gin[m]
    verts = [tuple(v) for v in Vf]
    faces = [tuple(f) for f in F]
    ring = {}
    for k, v in enumerate(bv):
        if length[k] <= 0:
            continue
        p, g, L = Vf[v], gin[k], length[k]
        prof = [(0.0015, 0.0006), (0.0035, 0.0025), (0.0045, 0.0050), (0.0050, L)]  # ~5 mm bend radius, then straight
        ids = []
        for a, b in prof:
            ids.append(len(verts))
            verts.append((p[0] + g[0] * a, p[1] + b, p[2] + g[1] * a))
        ring[v] = ids
    for a, b in bnd:
        if a in ring and b in ring:
            ca, cb = [a] + ring[a], [b] + ring[b]
            for i in range(len(ca) - 1):
                faces.append((ca[i], cb[i], cb[i + 1], ca[i + 1]))
    return np.array(verts), faces


dash = flanged(V2, F)

# ---- toe board: from the dash's lower edge rearward and down to the floor, the tunnel hump running through it
# and widening; the floor line (y -1.22, z 0.66) is the first version's assumed toe_bottom (+/-0.04 m); 36 degrees.
TOE_Y1, TOE_Z1 = -1.220, 0.660


def toe_mesh():
    xs = np.unique(np.r_[np.arange(-0.80, 0.80, 0.018), [0.80], np.arange(TUN_X - 0.34, TUN_X + 0.34, 0.008)])
    xs = xs[np.abs(xs) <= 0.80]
    ts = np.linspace(0, 1, 36)
    Vt = []
    for t in ts:
        y = FACE_Y + t * (TOE_Y1 - FACE_Y)
        zf = TOE_Z0 + t * (TOE_Z1 - TOE_Z0)
        hgt = (TUN_CROWN - TOE_Z0) + 0.12 * t  # crown holds level while the toe board falls (assumed +/-0.03)
        z = zf + hgt * arch(xs, t)
        # stiffening bead on each flank of the hump (0553)
        dx = np.abs(np.abs(xs - TUN_X) - (TUN_HALF + 0.035 * t + 0.03))
        z += 0.003 * np.exp(-(dx / 0.0036) ** 2)
        Vt += [(x, y, zz) for x, zz in zip(xs, z)]
    n = len(xs)
    Ft = [(i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j) for i in range(len(ts) - 1) for j in range(n - 1)]
    # kick-panel returns: at both ends the toe board's edge drops as a wall to the cowl-side bottom (05, 03, owner)
    Vt = np.array(Vt)
    n0 = len(Vt)
    for j in (0, n - 1):
        col = Vt[:n0][j::n]
        base = len(Vt)
        rows = [np.c_[col[:, 0], col[:, 1], col[:, 2] + (0.58 - col[:, 2]) * k / 6] for k in range(1, 7)]
        Vt = np.vstack([Vt] + rows)
        m = len(col)
        prev = [j + i * n for i in range(m)]
        for k in range(6):
            cur = [base + k * m + i for i in range(m)]
            Ft += [(prev[i], prev[i + 1], cur[i + 1], cur[i]) for i in range(m - 1)]
            prev = cur
    return Vt, Ft


toe = toe_mesh()


def flat_part(outer, holes, hfun, step=0.008):
    """A flat sheet in local 2D coords: CDT over rings that follow its outline, holes and dimples; hfun(P) gives
    the out-of-plane offset (raised rim, weld dimples). Returns 2D verts, heights, faces."""
    pl, ed = [], []

    def add(L):
        b = len(pl)
        pl.extend(map(tuple, L))
        ed.extend((b + i, b + (i + 1) % len(L)) for i in range(len(L)))
    for d in (0.0, -0.002, -0.004, -0.006, -0.008):
        add(outer.contour(d))
    for h in holes:
        for d in (0.0, 0.002):
            add(h.contour(d))
    lo, hi = outer.c - outer.h, outer.c + outer.h
    X, Y = np.meshgrid(np.arange(lo[0], hi[0], step), np.arange(lo[1], hi[1], step))
    g = np.stack([X.ravel(), Y.ravel()], 1)
    ok = outer.sd(g) < -0.011
    for h in holes:
        ok &= h.sd(g) > 0.005
    pl.extend(map(tuple, g[ok]))
    V, _, F, _, _, _ = geometry.delaunay_2d_cdt(pl, ed, [], 0, 1e-7)
    V = np.array([tuple(v) for v in V])
    F = [f for f in F if len(f) == 3]
    c = np.array([V[list(f)].mean(0) for f in F])
    keep = outer.sd(c) < 0
    for h in holes:
        keep &= h.sd(c) > 0
    F = [f for f, k in zip(F, keep) if k]
    return V, hfun(V), F


def cylinder(c, axis, r, L, n=16):
    """A stud: closed cylinder from c along axis (unit 3-vector)."""
    axis = np.asarray(axis, float)
    a = np.cross(axis, [0, 0, 1] if abs(axis[2]) < 0.9 else [1, 0, 0]); a /= np.linalg.norm(a)
    b = np.cross(axis, a)
    V, F = [], []
    for k in range(n):
        t = 2 * math.pi * k / n
        p = np.asarray(c) + r * (math.cos(t) * a + math.sin(t) * b)
        V += [tuple(p), tuple(p + axis * L)]
    for k in range(n):
        i, j = 2 * k, 2 * ((k + 1) % n)
        F.append((i, j, j + 1, i + 1))
    F.append(tuple(range(0, 2 * n, 2))[::-1]); F.append(tuple(range(1, 2 * n, 2)))
    return np.array(V), F


def merge(*parts):
    V, F, o = [], [], 0
    for v, f in parts:
        V.append(np.asarray(v)); F += [tuple(int(i) + o for i in q) for q in f]; o += len(v)
    return np.vstack(V), F


def booster_plate():
    """The welded booster / master-cylinder reinforcement: a separate ~3 mm plate on the dash face, a rounded
    rectangle with a raised rim and spot-weld dimples round its edge, the push-rod hole and four studs through it
    (driver_plate_34, bay_fender_loose_full, 01, 05). Outline from 03 crop (955-1075 x 112-240); the two upper studs
    are on 03 and 05; the lower pair is assumed to mirror them about the push-rod hole."""
    outer = PLATE
    hole = Circle(bo, 16 * CAB_MPX)
    colh = Circle(COL_HOLE, 0.032)
    welds = [outer.contour(-0.010)[k] for k in range(0, len(outer.contour(-0.010)), 11)]

    def h(P):
        rim = -0.0015 * np.exp(-((outer.sd(P) + 0.0075) / 0.004) ** 2)  # ~15 mm rim
        dents = sum(0.0006 * np.exp(-(np.linalg.norm(P - w, axis=1) / 0.0025) ** 2) for w in welds)
        return rim + dents
    V2, H, F = flat_part(outer, [hole, colh], h, 0.006)
    y0 = float(face_y(outer.contour(-0.004)).min()) - 0.0015  # 3 mm plate, 1.5 mm ahead of the face's most forward point under it
    V = np.c_[V2[:, 0], y0 + H, V2[:, 1]]
    studs = [cylinder((p[0], y0 - 0.0015, p[1]), (0, -1, 0), 0.0048, 0.030) for p in
             STUDS]
    return merge((V, F), *studs)


def pinch_flange():
    """Dash-to-plenum pinch weld: two sheets pressed flat together standing up from the dash top edge, 18 mm, with
    spot-weld dimples at 45 mm pitch (owner, 03, 05, 006214DA). Solidified 2 mm (doubled sheet)."""
    # the longest run of outline points along the top, in outline order (sorting by x folded the rounded corner back
    # on itself, which drew the zig-zag at the passenger end)
    m = (OUTLINE[:, 1] > 1.19) & (np.abs(OUTLINE[:, 0]) < 0.79)
    runs, cur = [], []
    for i in range(len(OUTLINE) * 2):
        if m[i % len(OUTLINE)]:
            cur.append(i % len(OUTLINE))
        elif cur:
            runs.append(cur); cur = []
    top = OUTLINE[max(runs, key=len)]
    top = resample(chaikin(top, 2, closed=False), 0.0025, closed=False)
    yb = face_y(top)
    rows = []
    for dz in (0.0, 0.004, 0.009, 0.014, 0.018):
        pitch = np.mod(top[:, 0] - top[0, 0], 0.045)
        dent = 0.0004 * np.exp(-((pitch - 0.0225) / 0.006) ** 2) * math.exp(-((dz - 0.009) / 0.005) ** 2)
        rows.append(np.c_[top[:, 0], yb + dent, top[:, 1] + dz])
    A = np.array(rows)
    nr, nc = A.shape[:2]
    F = [(r * nc + c, r * nc + c + 1, (r + 1) * nc + c + 1, (r + 1) * nc + c) for r in range(nr - 1) for c in range(nc - 1)]
    return A.reshape(-1, 3), F


PLENUM_Y1 = -1.16   # windshield base (assumed +/-0.03)


def cowl_plenum():
    """Cowl top between the dash and the windshield: a flat shelf at the pinch-flange top, with three rectangular vent
    slots per side (two large, one small) and the wiper pivot holes (owner photos; positions and sizes assumed
    +/-0.03 m: no photo of the top has been camera-matched)."""
    zt = float(OUTLINE[:, 1].max()) + 0.018
    outer = RRect((0.0, (FACE_Y + PLENUM_Y1) / 2), (0.78, (PLENUM_Y1 - FACE_Y) / 2), 0.02)  # between the cowl sides
    holes = []
    for sg in (-1, 1):
        for xc, hw in ((0.18, 0.095), (0.42, 0.095), (0.62, 0.045)):
            holes.append(RRect((sg * xc, FACE_Y + 0.11), (hw, 0.022), 0.008))
        holes.append(Circle((sg * 0.50, FACE_Y + 0.20), 0.013))
    V2, H, F = flat_part(outer, holes, lambda P: np.zeros(len(P)), 0.02)
    rise = 0.05 * np.clip((V2[:, 1] - FACE_Y) / (PLENUM_Y1 - FACE_Y), 0, 1) ** 1.5  # rear edge up to the windshield base (assumed)
    return np.c_[V2[:, 0], V2[:, 1], zt + H + rise], F


COWL_Y1 = -1.31   # rear edge at the hinge pillar, measured on A37DE48A (solved camera, 14 px): y -1.29 to -1.34
COWL_XR = 0.875   # outboard at the hinge pillar: in 006214DA nothing shows outboard of the panel ends; assumed +/-0.02
COWL_XF = 0.905   # forward (fender) flange line; assumed +/-0.03
COWL_ZB = 0.58    # bottom, where it curls under toward the rocker; assumed +/-0.05
COWL_ZT = float(OUTLINE[:, 1].max()) + 0.018   # cowl-top / hood-hinge shelf level, at the pinch-flange top


def dash_end_x(z, sign):
    """|x| of the dash outline's end at height z (03 trace); below the dash, the toe board edge."""
    side = OUTLINE[sign * OUTLINE[:, 0] > 0.4]
    zs = np.linspace(COWL_ZB, COWL_ZT, 60)
    xe = np.full(len(zs), np.nan)
    for k, zz in enumerate(zs):
        m = np.abs(side[:, 1] - zz) < 0.012
        if m.any():
            xe[k] = np.abs(side[m, 0]).max()
    good = ~np.isnan(xe)
    xe = np.interp(zs, zs[good], xe[good])
    xe[zs < TOE_Z0] = np.minimum(xe[zs < TOE_Z0], 0.80)
    xe = np.convolve(np.pad(xe, 3, mode="edge"), np.ones(7) / 7, "valid")
    return float(np.interp(z, zs, xe))  # the skin starts exactly on the dash outline's end at every height


def quads(nr, nc):
    return [(r * nc + c, r * nc + c + 1, (r + 1) * nc + c + 1, (r + 1) * nc + c) for r in range(nr - 1) for c in range(nc - 1)]


def cowl_side(sign):
    """Cowl side, one continuous skin per side (02, 06, 083B873C, 10; owner photos). The dash face itself starts its
    corner 0.12 W in from the panel end (CORNER_X0) and curves forward on a 0.1 W radius; the blower ring is pressed
    into that curve (05, 01). At the dash end (x 0.80, ~60 degrees round) this skin takes over: the rest of the arc to
    90 degrees, then the side runs forward with an outboard bow to the vertical fender flange; behind the tangent point
    the same side line runs back to the hinge pillar. The lower 0.3 curls under. The top edge follows the seam and
    slopes down 60 mm toward the flange; a small hood-hinge shelf (120 x 80 mm) with its stud sits at the top-forward
    corner. Reach 200-280 mm ahead of the dash face, assumed +/-0.04 m."""
    nv = 30
    vs = np.linspace(0, 1, nv)
    R, X0 = CORNER_R, CORNER_X0
    phi0 = math.asin(min(1.0, (DASH_END_X - X0) / R))
    rows_f, rows_r = [], []
    for v in vs:
        z = COWL_ZB + v * (COWL_ZT - COWL_ZB)
        reach = R + 0.02 + 0.02 * v  # 0.19-0.21 m; top: hinge stud measured 0.11-0.21 m ahead on A37DE48A; bottom assumed
        curl = 0.08 * max(0.0, 1 - v / 0.3) ** 2
        pts = []
        # one swept profile: start exactly on the dash outline's end at this height, on the dash's own corner circle
        ps = math.asin(float(np.clip((dash_end_x(z, sign) - X0) / R, 0, 1)))
        for p in np.linspace(ps, math.pi / 2, 10):
            pts.append((X0 + R * math.sin(p), FACE_Y - R + R * math.cos(p)))
        xs0 = X0 + R
        y_end = FACE_Y - reach
        for t in np.linspace(0, 1, 9)[1:]:
            pts.append((xs0 + 0.012 * math.sin(math.pi * t) - 0.01 * t, FACE_Y - R + (y_end - (FACE_Y - R)) * t))
        pts = np.array(pts)
        pts[1:, 0] -= curl * np.linspace(0, 1, len(pts) - 1)
        fwd = np.linspace(0, 1, len(pts))
        zz = COWL_ZB + (z - COWL_ZB) * (1 - (0.06 / (COWL_ZT - COWL_ZB)) * fwd * v)  # top slopes down to the flange
        rows_f.append(np.c_[sign * pts[:, 0], pts[:, 1], zz])
        ys = np.linspace(FACE_Y - R, COWL_Y1, 14)
        u = (ys - ys[0]) / (ys[-1] - ys[0])
        xr = xs0 + (COWL_XR - xs0) * smootherstep(0, 1, u) + 0.015 * np.sin(math.pi * u) - curl
        rows_r.append(np.c_[sign * xr, ys, np.full(len(ys), z)])
    Fr, Rr = np.array(rows_f), np.array(rows_r)
    edge = Fr[:, -1]
    fl = [edge + np.array([sign, 0, 0]) * a + np.array([0, -1, 0]) * b
          for a, b in ((0.0006, 0.0015), (0.0025, 0.0035), (0.005, 0.0045), (0.025, 0.005))]
    A = np.concatenate([Fr, np.stack(fl, 1)], 1)
    front = (A.reshape(-1, 3), quads(*A.shape[:2]))
    rear = (Rr.reshape(-1, 3), quads(*Rr.shape[:2]))
    # small hood-hinge shelf at the top-forward corner, 120 mm deep x 80 mm wide, inboard of the skin
    tf = Fr[-1, -1]
    sx = np.linspace(0, 0.08, 5)
    sy = np.linspace(0, 0.12, 7)
    S = np.array([[(tf[0] - sign * a, tf[1] + b, tf[2]) for a in sx] for b in sy])
    shelf = (S.reshape(-1, 3), quads(*S.shape[:2]))
    stud = cylinder((tf[0] - sign * 0.04, tf[1] + 0.06, tf[2]), (0, 0, 1), 0.005, 0.028)
    V, F = merge(front, rear, shelf, stud)
    if sign < 0:
        F = [f[::-1] for f in F]
    return V, F


parts = {"firewall_dash": dash, "firewall_toe_board": toe, "cowl_side_L": cowl_side(-1), "cowl_side_R": cowl_side(1),
         "booster_plate": booster_plate(), "pinch_flange": pinch_flange(), "cowl_plenum": cowl_plenum()}
THICK = {"booster_plate": (0.003, 0.0), "pinch_flange": (0.002, 0.0)}

LANDMARKS = {
    "panel_width_at_cowl_m": float(PT["ear_D"][0] - PT["ear_P"][0]),
    "booster_hole_xz": [float(bo[0]), float(bo[1])],
    "blower_hole_xz": [float(bl[0]), float(bl[1])],
    "wiper_hole_xz": [float(wi[0]), float(wi[1])],
    "bulkhead_hole_xz": [float(bh[0]), float(bh[1])],
    "heater_opening_xz": [float(hc[0]), float(hc[1])],
    "tunnel_crown_xz": [TUN_X, TUN_CROWN],
    "tunnel_width_at_foot_m": 2 * TUN_HALF,
    "dash_lower_edge_z": TOE_Z0,
    "toe_board_angle_deg": math.degrees(math.atan2(TOE_Z0 - TOE_Z1, TOE_Y1 - FACE_Y)),
    "face_verts": len(dash[0]),
}
print("LANDMARKS", json.dumps(LANDMARKS))

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new("firewall_paint")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.20, 0.035, 0.04, 1)  # the cab's deep metallic maroon (owner-cab 08-14)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.42
bsdf.inputs["Coat Weight"].default_value = 0.3  # clear (exports as KHR_materials_clearcoat 0.3)
bsdf.inputs["Coat Roughness"].default_value = 0.2

for name, (Vp, Fp) in parts.items():
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in Vp], [], [tuple(map(int, f)) for f in Fp])
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness, sol.offset = THICK.get(name, (0.001, 1.0))  # ~1 mm sheet (18-20 ga); plate 3 mm; pinch weld doubled
    sol.use_even_offset = False
    me.shade_smooth()
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
    ob.select_set(False)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_extras=False, export_materials="EXPORT", use_selection=False)
print("WROTE", OUT, os.path.getsize(OUT))
