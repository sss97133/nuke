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
        n = max(64, int(2 * math.pi * (s.r + d) / 0.004))
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
        return resample(np.array(pts), 0.004, nmin=64)


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
        return resample(chaikin(P, 1), 0.004)


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
xb = np.linspace(TOP[-1][0], PS[0][0], 300)
bottom = np.stack([xb, TOE_Z0 + (TUN_CROWN - TOE_Z0) * arch(xb)], 1)
outline_raw = np.vstack([TOP[:-1], bottom, PS])
OUTLINE = resample(chaikin(outline_raw, 3), 0.006)
OUTER = Poly.__new__(Poly)
OUTER.V = OUTLINE


def ear_y(x):
    # ends flare forward into the cowl sides (03 rounded ends, 02 and 06 at 3/4; 30 mm assumed +/-15)
    return -0.030 * smoothstep(0.70, 0.86, np.abs(x))


# ---- stamped features (x, z twin metres) from the 03 crop; each names its photo
bl, wi = cab(125, 260), cab(1180, 127)
bo = cab(1015, 198)
bh = cab(1200, 280)
hc, hh = (cab(358, 202) + cab(463, 355)) / 2, np.abs(cab(463, 355) - cab(358, 202)) / 2
pc = (cab(1020, 300) + cab(1120, 360)) / 2

# Plateaus: (shape, depth y [+ = rearward, into the cab], wall width)
PLATEAUS = [
    # the big centre pressing: an arched-top pocket from the tunnel arch up to near the cowl (03 crop x 500-940,
    # top y 85; 05 and 07 the same). Ceiling lights put its upper wall in shadow, so it is pressed REARWARD (into the
    # cab), continuous with the tunnel; depth assumed 60 +/-20 mm (no side view of it)
    (Poly(cabs([(505, 398), (498, 260), (515, 165), (565, 100), (720, 84), (880, 98), (928, 165), (942, 280),
                (936, 398), (860, 398), (800, 352), (720, 338), (640, 352), (585, 398)])), 0.060, 0.070),
    # upper band: the strip from the crease (crop y 175-215) to the top, cut diagonally at both ends toward the cowl
    # corners (03, 05); stands forward of the lower face, 6 mm assumed +/-4
    (Poly(cabs([(112, 105), (232, 212), (330, 196), (500, 178), (950, 182), (1232, 212), (1335, 108), (1300, 78),
                (720, 72), (150, 80)])), -0.006, 0.010),
    # passenger end: raised bulb around the blower hole inside the diagonal crease (03 crop 40-235, 01 ring)
    (Circle(bl, 0.088), -0.012, 0.016),
    # driver pedal/booster support plate: raised plate with a diagonal outboard edge (03 crop, 05, 08; 01 detail)
    (Poly(cabs([(952, 115), (1068, 110), (1078, 175), (1168, 335), (1162, 402), (985, 405), (962, 330), (950, 250)])), -0.005, 0.008),
    # heater frame: raised rectangle around and below the heater opening (01 bare metal, 03)
    (RRect((cab(330, 190) + cab(480, 375)) / 2, np.abs(cab(480, 375) - cab(330, 190)) / 2, 0.015), -0.004, 0.008),
    # wiper-motor boss (03, 05)
    (Circle(wi, 0.045), -0.004, 0.008),
    # small domed boss at the top of the centre pocket (03 crop 755, 192; 05)
    (Circle(cab(755, 192), 0.012), -0.005, 0.008),
]
# plate studs: two at the top of the plate (03 crop 985/1050, 130; 05 the same pair)
for p in ((985, 130), (1050, 130)):
    PLATEAUS.append((Circle(cab(*p), 0.009), -0.006, 0.005))

# Openings: (shape, flange length rearward, name)
HOLES = [
    (Circle(bl, 43 * CAB_MPX), 0.006, "blower_hole"),              # 03 crop 86 px across; rolled lip (01)
    (RRect(hc, hh, 0.006), 0.012, "heater_opening"),               # 03 crop 358-463 x 202-355
    (Circle(bo, 16 * CAB_MPX), 0.0, "steering_column_hole"),       # 03 crop 1015, 198 (plate hole)
    (Circle(wi, 20 * CAB_MPX), 0.0, "wiper_motor_hole"),           # 03 crop 1180, 127
    (RRect(bh, np.abs(cab(1225, 302) - cab(1175, 258)) / 2, 0.004), 0.008, "bulkhead_hole"),  # 03 crop 1175-1225 x 258-302
    (RRect(pc, np.abs(cab(1120, 360) - cab(1020, 300)) / 2, 0.020), 0.008, "column_seal_opening"),  # 03 crop, 01, 05
]
for p, r in (((258, 232), 10), ((238, 258), 10), ((497, 192), 12), ((943, 198), 9), ((1115, 218), 9), ((1258, 338), 9),
             ((1215, 355), 9), ((965, 268), 7), ((1062, 262), 7)):  # small holes beside the blower and on the plate (03)
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
    for sh, depth, w in PLATEAUS:
        y += depth * (1 - smootherstep(-w / 2, w / 2, sh.sd(P)))
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
    for f in np.linspace(-0.85, 0.85, max(7, int(w / 0.006) | 1)):  # a ring every ~6 mm across the wall
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
for L in loops[1:]:
    add_loop(L)
for L in arch_off:
    add_loop(L, closed=False)

kd = KDTree(len(pts))
for i, p in enumerate(pts):
    kd.insert((p[0], p[1], 0), i)
kd.balance()
G = 0.012
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
    length[on_outer & ~bottom_edge] = np.where(np.abs(P[on_outer & ~bottom_edge, 0]) > 0.80, 0.030, 0.025)
    gin[on_outer] = g_out[on_outer]
    for sh, L, _ in HOLES:
        m = (np.abs(sh.sd(P)) < 0.002) & ~on_outer
        length[m] = max(L, 0.003)  # every opening gets at least a 3 mm rolled edge, so it catches a highlight
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
    xs = np.unique(np.r_[np.arange(-0.78, 0.78, 0.012), np.arange(TUN_X - 0.34, TUN_X + 0.34, 0.005)])
    xs = xs[np.abs(xs) <= 0.78]
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
    return np.array(Vt), Ft


toe = toe_mesh()


COWL_Y1 = -1.08   # rear edge at the hinge pillar: 02 / A37DE48A, the panel runs ~0.4 of the door opening; assumed +/-0.05
COWL_XR = 0.975   # outboard at the hinge pillar (cab side line); assumed +/-0.03
COWL_ZB = 0.58    # bottom, where the kick-panel return turns in above the rocker; assumed +/-0.05
COWL_ZT = 1.24    # top, under the A-pillar base / cowl (03 panel top 1.231)


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
    return max(0.80, float(np.interp(z, zs, xe)))  # no inboard tuck at the top corner, so the top flange does not twist


def cowl_side(sign):
    """Cowl side: the big panel each side from the dash end back to the hinge pillar (owner-cab 02 / A37DE48A, 10,
    13611ED8, 083B873C). It leaves the dash end at the dash's own x and y (no gap), sweeps outboard to the cab side
    line with a soft outboard crown, and turns flanges at its edges: inboard under the A-pillar base at the top, inboard
    as the kick-panel return at the bottom, outboard as the door-seal flange at the rear. Quad grid, no triangles."""
    y0 = FACE_Y + float(ear_y(np.array([0.86]))[0])
    us, vs = np.linspace(0, 1, 26), np.linspace(0, 1, 36)
    G = np.zeros((len(vs), len(us), 3))
    for j, v in enumerate(vs):
        z = COWL_ZB + v * (COWL_ZT - COWL_ZB)
        x0 = dash_end_x(z, sign)
        for i, u in enumerate(us):
            sw = float(smootherstep(0, 1, u ** 0.8))
            ax = x0 + (COWL_XR - x0) * sw + 0.022 * math.sin(math.pi * u) * math.sin(math.pi * v)
            G[j, i] = (sign * ax, y0 + u * (COWL_Y1 - y0), z)

    def flange(edge, d, L):
        """rows bending from an edge row: d = (direction of the flange, normal it leaves along); ~5 mm bend radius"""
        return [edge + np.asarray(d[0], float) * b + np.asarray(d[1], float) * a
                for a, b in ((0.0015, 0.0006), (0.0035, 0.0025), (0.0045, 0.005), (0.005, L))]

    top = flange(G[-1], ((-sign, 0, 0), (0, 0, 1)), 0.040)   # A-pillar base / cowl
    bot = flange(G[0], ((-sign, 0, 0), (0, 0, -1)), 0.040)   # kick-panel return
    A = np.array(bot[::-1] + list(G) + top)
    rear = flange(A[:, -1], ((sign, 0, 0), (0, 1, 0)), 0.025)  # door-seal flange at the hinge pillar
    A = np.concatenate([A] + [r[:, None] for r in rear], 1)
    nr, nc = A.shape[:2]
    V = A.reshape(-1, 3)
    F = [(r * nc + c, r * nc + c + 1, (r + 1) * nc + c + 1, (r + 1) * nc + c) for r in range(nr - 1) for c in range(nc - 1)]
    if sign < 0:
        F = [f[::-1] for f in F]
    return V, F


parts = {"firewall_dash": dash, "firewall_toe_board": toe, "cowl_side_L": cowl_side(-1), "cowl_side_R": cowl_side(1)}

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
bsdf.inputs["Base Color"].default_value = (0.11, 0.010, 0.014, 1)  # the cab's deep metallic maroon (owner-cab 08-14)
bsdf.inputs["Metallic"].default_value = 0.55
bsdf.inputs["Roughness"].default_value = 0.32
bsdf.inputs["Coat Weight"].default_value = 0.3  # clear (exports as KHR_materials_clearcoat 0.3)
bsdf.inputs["Coat Roughness"].default_value = 0.05

for name, (Vp, Fp) in parts.items():
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in Vp], [], [tuple(map(int, f)) for f in Fp])
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness = 0.001  # ~1 mm sheet (18-20 ga)
    sol.offset = 1.0
    sol.use_even_offset = False
    me.shade_smooth()
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
    ob.select_set(False)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_extras=False, export_materials="EXPORT", use_selection=False)
print("WROTE", OUT, os.path.getsize(OUT))
