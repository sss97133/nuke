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
        return resample(s.V + d * s.N, 0.004)


# ---- outline: traced on WVUT f_0785, passenger end first, clockwise from ahead (pixels), bottom edge replaced by the
# toe-board line with the tunnel arch so dash and toe board share one edge
OUTLINE_PX = [(22, 178), (200, 125), (600, 112), (1000, 112), (1400, 118), (1700, 150), (1835, 222), (1845, 300),
              (1840, 420), (1830, 500), (1750, 590)]
OUTLINE_PX_P = [(195, 585), (60, 520), (15, 420), (10, 300)]
TOE_Z0 = 0.827          # dash lower edge, median of the 0785 trace (first version)
TUN_X, TUN_CROWN = float(PT["tun_top"][0]), float(PT["tun_top"][2])        # -0.020, 0.914 (solved)
TUN_HALF = abs(float(PT["tun_footP"][0]) - TUN_X)                              # 0.2656: 531 mm at the foot (solved)
TUN_FLAT = 0.09         # crown half width, 0785 (880-1150 px across the arch top); assumed +/-0.03


def arch(x, t=0.0):
    """Tunnel section height over the toe line at the dash (t=0) and down the toe board (t=1)."""
    half = TUN_HALF + 0.035 * t
    s = 1 - smoothstep(TUN_FLAT, half, np.abs(np.asarray(x) - TUN_X))
    return s


top = np.array([onface(*p) for p in OUTLINE_PX])
ps = np.array([onface(*p) for p in OUTLINE_PX_P])
xb = np.linspace(0.72, -0.70, 285)
bottom = np.stack([xb, TOE_Z0 + (TUN_CROWN - TOE_Z0) * arch(xb)], 1)
outline_raw = np.vstack([top[:-1], bottom, ps])
OUTLINE = resample(chaikin(outline_raw, 3), 0.006)
OUTER = Poly.__new__(Poly)
OUTER.V = OUTLINE


def ear_y(x):
    # outer ends wrap rearward toward the cowl sides (0009, 0161: the flange tips solve at y -1.43)
    return 0.02 * smoothstep(0.74, 0.85, np.abs(x))


# ---- stamped features (x, z twin metres); each traces to a named photo
bl, bo, wi, bh = PT["blower"][[0, 2]], PT["booster"][[0, 2]], PT["wiper"][[0, 2]], PT["bulkhead"][[0, 2]]
hc = (PT["heaterTL"][[0, 2]] + PT["heaterBR"][[0, 2]]) / 2
hh = np.abs(PT["heaterTL"][[0, 2]] - PT["heaterBR"][[0, 2]]) / 2
pc = onface(1410, 495)

# Plateaus: (shape, depth y [+ = rearward, into the cab], wall width). Wall width ~ depth gives 4-8 mm bend radii.
PLATEAUS = [
    # upper rib band: two long pressings with rounded ends across the upper third (0785 px 180-740 x 200-290 and
    # 750-1250 x 195-280; 0009, 0161, AMD repro); pressed rearward, depth assumed 10 +/-5 mm
    (RRect((onface(180, 245) + onface(740, 245)) / 2, (abs(onface(740, 245)[0] - onface(180, 245)[0]) / 2, 0.036), 0.034), 0.010, 0.012),
    (RRect((onface(752, 238) + onface(1250, 238)) / 2, (abs(onface(1250, 238)[0] - onface(752, 238)[0]) / 2, 0.034), 0.032), 0.010, 0.012),
    # centre plateau between heater and booster, pressed forward (0785 diagonal steps px 700/1250 at the top to
    # 670/1290 at the arch; AMD repro); depth assumed 8 +/-4 mm
    (Poly([onface(*p) for p in ((705, 305), (1245, 305), (1285, 470), (1130, 460), (1000, 440), (880, 455), (690, 480))]), -0.008, 0.012),
    # booster / master-cylinder pad: recessed plate (0785 dark plate px 1310-1500 x 205-410; 0009, 0161, 0289)
    (RRect((onface(1310, 205) + onface(1500, 410)) / 2, np.abs(onface(1500, 410) - onface(1310, 205)) / 2, 0.012), 0.007, 0.010),
    # blower ring: raised annulus around the blower hole (0785 ring ~230 px across; 0009, OxeW 0547, 058)
    (Circle(bl, 0.090), -0.014, 0.016),
    # wiper-motor pad: a low round boss (0785 px 1600-1665 hole in a flat ring ~110 px; 0009, 0161)
    (Circle(wi, 0.050), -0.004, 0.008),
    # bulkhead pad: a shallow recess around the connector opening (0009 px 1650-1770 x 630-720; 0161, owner 058)
    (RRect(bh, (0.048, 0.068), 0.012), 0.004, 0.008),
]
# four booster stud bosses on the GM booster's 3.38 in (86 mm) square (pattern assumed; studs visible in 0009 and 0161)
for dx in (-0.043, 0.043):
    for dz in (-0.043, 0.043):
        PLATEAUS.append((Circle(bo + (dx, dz), 0.011), -0.003, 0.005))
# heater opening rim: a raised frame around the opening (0785, 0009, AMD repro)
PLATEAUS.append((RRect(hc, hh + 0.016, 0.018), -0.004, 0.008))

# Openings: (shape, flange length rearward, name). Turned-in flanges where the photos show a rolled edge.
HOLES = [
    (Circle(bl, 0.0567), 0.006, "blower_hole"),                  # 0785 hole 65-190 px; rolled lip (OxeW 0547)
    (RRect(hc, hh, 0.008), 0.012, "heater_opening"),             # solved corners; flange (0009, AMD repro)
    (Circle(bo, 0.0272), 0.0, "booster_hole"),                   # 0785 1358-1418 px
    (Circle(wi, 0.0295), 0.0, "wiper_motor_hole"),               # 0785 1600-1665 px
    (RRect(bh, (0.0275, 0.045), 0.005), 0.008, "bulkhead_hole"),  # owner 058 connector; flange (0161)
    (RRect(pc, (0.0635, 0.050), 0.018), 0.008, "pedal_column_opening"),  # 0785 1340-1480 x 440-550 px
]
for c in (onface(300, 345), onface(290, 378), onface(660, 300)):  # small harness/cable holes (0785)
    HOLES.append((Circle(c, 0.009), 0.0, "small_hole"))

# Bead along the tunnel arch on the dash: 3 mm high, 9 mm wide, 28 mm off the edge (0785 bright line along the arch,
# 0553 seam close-up, AMD repro lip)
ARCH_LINE = bottom[(np.abs(bottom[:, 0] - TUN_X) < TUN_HALF + 0.05)]
BEAD_OFF, BEAD_H, BEAD_W = 0.028, -0.003, 0.009


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
        y += depth * (1 - smoothstep(-w / 2, w / 2, sh.sd(P)))
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
    for f in (-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75):
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
        length[m] = L
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
        hgt = (TUN_CROWN - TOE_Z0) + 0.10 * t  # tunnel rises over the falling toe board (assumed +/-0.03)
        z = zf + hgt * arch(xs, t)
        # stiffening bead on each flank of the hump (0553)
        dx = np.abs(np.abs(xs - TUN_X) - (TUN_HALF + 0.035 * t + 0.03))
        z += 0.003 * np.exp(-(dx / 0.0036) ** 2)
        Vt += [(x, y, zz) for x, zz in zip(xs, z)]
    n = len(xs)
    Ft = [(i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j) for i in range(len(ts) - 1) for j in range(n - 1)]
    return np.array(Vt), Ft


toe = toe_mesh()


def cowl_side(sign):
    """Kick panel the fender bolts to: a wall at the FR-88 cowl point x from the flange tip (solved z) down to the
    toe line, y -1.43 to -1.25, rounded corners, a 20 mm flange turned inboard at its front edge to meet the dash's end
    flange; extents assumed +/-0.05 m (repro kick-panel photos only, no real bare cab side in the set)."""
    x = sign * 0.8575
    z0, z1 = TOE_Z0 - 0.02, float(PT["ear_P"][2])
    pr = RRect(((-1.43 - 1.25) / 2, (z0 + z1) / 2), (0.09, (z1 - z0) / 2), 0.03)
    ys, zs = np.arange(-1.43, -1.25 + 1e-6, 0.008), np.arange(z0, z1 + 1e-6, 0.008)
    Y, Z = np.meshgrid(ys, zs)
    P = np.stack([Y.ravel(), Z.ravel()], 1)
    keep = pr.sd(P) < 0
    pts2 = [tuple(p) for p in pr.contour(0)] + [tuple(p) for p in P[keep & (pr.sd(P) < -0.004)]]
    nb = len(pr.contour(0))
    Vv, _, Fv, _, _, _ = geometry.delaunay_2d_cdt(pts2, [(i, (i + 1) % nb) for i in range(nb)], [], 0, 1e-6)
    Vv = np.array([tuple(v) for v in Vv])
    Fv = [f for f in Fv if pr.sd(np.array([Vv[list(f)].mean(0)]))[0] < 0]
    verts = [(x, v[0], v[1]) for v in Vv]
    # front flange: boundary verts at the front (y < -1.42) turn inboard
    faces = [tuple(f) for f in Fv]
    front = [i for i, v in enumerate(Vv) if v[0] < -1.425 and abs(pr.sd(np.array([v]))[0]) < 1e-3]
    front.sort(key=lambda i: Vv[i][1])
    ring = {}
    for i in front:
        ids = []
        for a, b in ((0.0006, 0.0015), (0.0025, 0.0035), (0.005, 0.0045), (0.020, 0.005)):
            ids.append(len(verts))
            verts.append((x - sign * a, Vv[i][0] - b + 0.0, Vv[i][1]))
        ring[i] = ids
    for a, b in zip(front[:-1], front[1:]):
        ca, cb = [a] + ring[a], [b] + ring[b]
        for k in range(len(ca) - 1):
            faces.append((ca[k], cb[k], cb[k + 1], ca[k + 1]))
    return np.array(verts), faces


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
mat = bpy.data.materials.new("firewall_primer")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.055, 0.057, 0.06, 1)  # satin dark grey primer
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.5

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
