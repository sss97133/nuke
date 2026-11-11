"""1973-80 C/K + K5 front inner fender skirts (wheelhouse tubs), driver and passenger, built headless in Blender.

Run (writes the GLB and k5_inner_fender_landmarks.json; deterministic; reads no image and no other model):

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P \
        docs/wiring/calc-data/cad/fab/inner_fender_sds.py [-- <out.glb> [<landmarks.json>]]

Defaults: nuke_frontend/public/models/k5-inner-fender.glb and k5_inner_fender_landmarks.json next to this script.
Frame: twin metres, +x driver, -y forward, +z up (Blender's Z-up frame is the twin frame here). The glTF exporter turns
it Y-up, (X, Y, Z) = (x, z, -y), the same turn as k5cad.write_glb. Receipt: docs/wiring/receipts/
2026-10-27_k5-inner-fender-3d.md (photo ids, the measured spec, the gate table, what is assumed).

How the part is made: one lofted sheet per side (rim wall, outboard shoulder, crown shelf, inboard flank, lower band,
rail ledge) from cross-sections at about 130 stations between the core support and the cowl, plus a flat rear panel
at the cowl, a front closing panel and a front tab at the core support. Stampings are displacements of that sheet
along its normal (rim bead, flank steps, cup blister, '+' ribs, dish, rear crease, cowl leg) or small separate
pressings (ledge ribs). Holes are boolean cuts. Sheet 0.9 mm, solidified toward the wheel so the modelled surface is
the engine-side face that the photos see.

Where the numbers come from (sigma in mm; photos are named by id only, none is read here):
- Crown ridge, wheel-centre section, rim apex, inboard edge, rear-panel and cup positions: the inner-fender camera
  solve of 2026-10-27 (owner photos f6203444 and 069ba2a5, Nuke vehicle_images ids, bundled with a5718305 and
  c1f5b457) and the vendor repro photos it scaled to the twin (OER T70124 LH inboard elevation, USA1 16303 rear view).
  Absolute sigma 60-110 mm; the relative shape (level ridge, fall-offs) is better than the absolute height.
- Rim plane x 0.858 (FR-88 cowl 1715/2). Fender wheel opening (where the rim arch follows the fender lip): ray-cast of
  the scale-verified TurboSquid 1978 Blazer body (k5-blazer.glb), opening top z 0.97-0.98 over y -2.25..-1.65.
- Frame rail outer face: chassis_frame.params.json rail_profile web_x + 6 mm (the twin frame).
- Core-support stations: radiator face y -2.527 (BRIEF), lower tie-bar shelf top z 0.738 and end wall x 0.865-0.890
  (core-support generator of 2026-10-27).
- Values no photo or catalog fixes are marked "assumed" where they are set.
"""
import json
import math
import os
import re
import struct
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if argv else os.path.join(REPO, "nuke_frontend", "public", "models", "k5-inner-fender.glb")
OUT_LM = argv[1] if len(argv) > 1 else os.path.join(HERE, "k5_inner_fender_landmarks.json")

# ---------------------------------------------------------------- stations (twin metres)
Y_F = -2.522        # front closing panel, 5 mm behind the core-support radiator face y -2.527 (BRIEF station)
Y_R = -1.470        # rear panel plane at the cowl (solve I10, +-40); firewall face -1.46
X_RIM = 0.858       # rim plane (FR-88 1715/2, +-10)
X_CROWN = 0.665     # crown peak 0.45 W from the rim (USA1 16303-1 rear view, +-35)
Z_LEDGE = 0.705     # rail ledge (I8 holes z 0.70 in OER T70124 LH-01, +-70)
Z_TAB = 0.7405      # front tab bottom on the core-support lower tie-bar shelf (top 0.738); spec 0.72 +-80
Z_FOLD = 0.848      # rear panel fold (solve I10, inherited, +-60)
LEDGE_W = 0.055     # rail ledge width, I8 50-70 mm; turned OUTBOARD (assumed: inboard it would cut the rail)
D_BOT = 0.412       # crown 1.117 to the ledge corner 0.705 at the wheel centre
T = 0.0009          # sheet, assumed (20 ga)
FLANGE = 0.025      # rim flange height under the shoulder, I1 20-25 mm
Z_POSTFOOT = 0.782  # inboard bottom edge at the support: clears the radiator-post foot (top 0.776, core-support model)
X_POSTFOOT = 0.515  # the front panel's inboard notch over that foot (foot x to 0.507)

# crown ridge z at x 0.665 (solve I2 series: OER T70124 LH-01 top silhouette, L 1.194 m, H 0.512; sigma 89);
# the ends: front roll to the support (I2 y -2.517 1.032), rear fall to the fold (I10 0.848 at the panel)
RIDGE = [(-2.522, 1.024), (-2.517, 1.032), (-2.458, 1.103), (-2.398, 1.114), (-2.339, 1.116), (-2.279, 1.117),
         (-2.220, 1.120), (-2.160, 1.120), (-2.101, 1.119), (-2.041, 1.118), (-1.982, 1.117), (-1.922, 1.115),
         (-1.863, 1.112), (-1.803, 1.105), (-1.744, 1.093), (-1.684, 1.075), (-1.625, 1.057), (-1.565, 1.032),
         (-1.506, 1.017), (-1.488, 0.975), (-1.470, Z_FOLD)]
# fender wheel-opening top (k5-blazer.glb ray-cast at x 1.3 toward -x, first skin hit outboard of x 0.85)
OPENING = [(-2.335, 0.70), (-2.320, 0.76), (-2.300, 0.84), (-2.275, 0.91), (-2.250, 0.95), (-2.200, 0.96),
           (-2.150, 0.97), (-1.950, 0.98), (-1.700, 0.98), (-1.650, 0.97), (-1.600, 0.95), (-1.550, 0.93),
           (-1.500, 0.85), (-1.470, 0.80)]
# frame rail web x (chassis_frame.params.json rail_profile); outer face = web + 6 mm
RAIL_WEB = [(-2.6315, 0.3602), (-2.2315, 0.3602), (-2.1315, 0.3621), (-2.0315, 0.3688), (-1.9315, 0.3792),
            (-1.8315, 0.3921), (-1.7315, 0.4055), (-1.6315, 0.4178), (-1.5315, 0.4271), (-1.4315, 0.4323)]
# wheel-centre section y -1.935 as (x, drop below the crown) (solve SEC_wc table: USA1 16303-1 rear-view envelope,
# W 0.43, H 0.512, sigma 75): outboard shoulder from the rim-wall top to the crown, inboard flank to the ledge corner
SHOULDER = [(0.858, 0.130), (0.857, 0.118), (0.852, 0.100), (0.843, 0.080), (0.825, 0.051), (0.797, 0.026),
            (0.757, 0.010), (0.710, 0.002), (X_CROWN, 0.0)]
FLANK = [(X_CROWN, 0.0), (0.620, 0.003), (0.576, 0.010), (0.545, 0.026), (0.514, 0.051), (0.480, 0.102),
         (0.461, 0.154), (0.445, 0.205), (0.438, 0.256), (0.431, 0.307), (0.429, 0.350), (0.428, 0.390),
         (0.428, D_BOT)]
# rear panel bottom outline at the cowl (solve I10: lowest point 0.608 at x 0.598, panel 0.34 m wide; outboard edge cut
# back below 0.4 H = the arch's rear leg, U-rear); the curve between those points is assumed
OUTLINE_R = [(0.50, 0.617), (0.598, 0.608), (0.66, 0.622), (0.70, 0.652), (0.74, 0.712), (0.78, 0.752)]

CUP = dict(y=-2.242, d=0.360, ly=0.105, la=0.050, depth=0.032)       # I7 LH (T124-1): 0.20 x 0.09, 30-50 mm, assumed 32
PLUS = dict(x=0.600, y=-2.020, arm_y=0.100, arm_x=0.040, w=0.0125, h=0.010)   # I9 RH (T123-1): 0.20 x 0.08, 10-20 mm
DISH = dict(x=0.640, y=-2.270, ry=0.105, rx=0.065, depth=0.015)      # I7 RH dish (T123-1): 0.21 x 0.13 +-25 %
STEPS = (0.165, 0.255)                                               # I5 flank steps, 60-100 mm apart, 10-20 mm


def pchip(pts):
    """Monotone cubic (Fritsch-Carlson) through (x, y) pairs; clamped outside the range."""
    pts = sorted(pts)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]; dl = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = dl[0], dl[-1]
    for i in range(1, n - 1):
        if dl[i - 1] * dl[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])

    def f(x):
        if x <= xs[0]: return ys[0]
        if x >= xs[-1]: return ys[-1]
        lo, hi = 0, n - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= x: lo = mid
            else: hi = mid
        i = lo
        t = (x - xs[i]) / h[i]; t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1]
                + (t3 - t2) * h[i] * m[i + 1])
    return f


zc = pchip(RIDGE)
_open = pchip(OPENING)
_rail = pchip(RAIL_WEB)


def smooth01(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def zfront(y):
    """bottom level toward the support: ledge 0.705 rising to the front tab on the lower tie-bar shelf."""
    return Z_LEDGE + (Z_TAB - Z_LEDGE) * smooth01((-2.40 - y) / (-2.40 - Y_F)) if y < -2.40 else Z_LEDGE


def zbot(y):
    """inboard bottom edge / ledge z: ledge 0.705; at the support it rises over the radiator-post foot (x 0.382-0.507,
    z to 0.776, y to -2.492 in the core-support model); at the cowl it falls to the rear panel's inboard corner."""
    if y < -2.40:
        return Z_LEDGE + (Z_POSTFOOT - Z_LEDGE) * smooth01((-2.40 - y) / (-2.40 + 2.497))
    if y > -1.56:
        return Z_LEDGE + (0.640 - Z_LEDGE) * smooth01((y + 1.56) / (Y_R + 1.56))
    return Z_LEDGE


def x_in(y):
    """inboard lower band x: 0.428 (rim - W 0.43, USA1 17 in) or 10 mm outboard of the rail's outer face."""
    return max(0.428, _rail(y) + 0.006 + 0.010)


def vscale(y):
    return (zc(y) - zbot(y)) / D_BOT


def rimtop(y):
    return zc(y) - SHOULDER[0][1] * vscale(y)


def arch(y):
    """lower edge of the rim wall: the fender opening (+15 mm), closed down to the bottom in front of the opening."""
    a = zfront(y) if y < -2.335 else _open(y) + 0.015
    return min(a, rimtop(y) - FLANGE)


def _dense(keys, n):
    """dense (x, drop) curve through key points, parameterised by chord length, monotone in each coordinate."""
    c = [0.0]
    for a, b in zip(keys, keys[1:]):
        c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    fx, fd = pchip(list(zip(c, [k[0] for k in keys]))), pchip(list(zip(c, [k[1] for k in keys])))
    return [(fx(c[-1] * i / (n - 1)), fd(c[-1] * i / (n - 1))) for i in range(n)]


SH_D = _dense(SHOULDER, 80)
FL_D = _dense(FLANK, 160)


def _resample(pl, n, dense_first=None):
    """resample a polyline [(x, z, du)] to n points by arc length -> [(x, z, du, arc)]; dense_first=(k, len) puts the
    first k points inside the first len metres."""
    s = [0.0]
    for a, b in zip(pl, pl[1:]):
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    L = s[-1]
    if dense_first:
        k, ln = dense_first; ln = min(ln, 0.5 * L)
        targets = [ln * i / k for i in range(k)] + [ln + (L - ln) * i / (n - k - 1) for i in range(n - k)]
    else:
        targets = [L * i / (n - 1) for i in range(n)]
    out, j = [], 0
    for tg in targets:
        while j < len(s) - 2 and s[j + 1] < tg:
            j += 1
        seg = s[j + 1] - s[j]
        t = 0.0 if seg <= 0 else min(max((tg - s[j]) / seg, 0.0), 1.0)
        a, b = pl[j], pl[j + 1]
        out.append(tuple(a[q] + (b[q] - a[q]) * t for q in range(3)) + (tg,))
    return out


N_AB, N_C, N_D = 50, 100, 9


def section(y):
    """points from the rim edge, up the rim wall, over the shoulder and crown, down the flank to the ledge corner and
    out along the ledge: [(x, z, drop_unscaled, arc, segment)]."""
    s = vscale(y); c = zc(y); dx = x_in(y) - 0.428
    a, rt = arch(y), rimtop(y)
    ab = [(X_RIM, a + (rt - a) * k / 20, 9.0) for k in range(20)]
    ab += [(x, c - d * s, d) for x, d in SH_D]
    fl = [(x + dx * (d / D_BOT), c - d * s, d) for x, d in FL_D]
    ab_r = _resample(ab, N_AB, dense_first=(12, 0.050))
    fl_r = _resample(fl, N_C)
    xe, ze = x_in(y), zbot(y)
    pts = [(p[0], p[1], p[2], p[3], "AB") for p in ab_r]
    pts += [(p[0], p[1], p[2], p[3], "C") for p in fl_r[1:]]
    pts += [(xe + LEDGE_W * k / (N_D - 1), ze, D_BOT, LEDGE_W * k / (N_D - 1), "D") for k in range(1, N_D)]
    return pts


def stations():
    ys, y = [Y_F], Y_F
    while y < Y_R - 1e-9:
        fine = (y < Y_F + 0.07) or (y > -1.70) or (-2.40 <= y <= -1.90)
        y = min(y + (0.007 if fine else 0.015), Y_R)
        if Y_R - y < 0.003:
            y = Y_R
        ys.append(y)
    return ys


YS = stations()


# ---------------------------------------------------------------- stampings: displacement along the sheet normal
def bump(u, w, flat=0.4):
    """1 inside |u| < flat*w, cosine shoulder to 0 at |u| = w."""
    a = abs(u) / w
    if a >= 1: return 0.0
    if a <= flat: return 1.0
    return 0.5 + 0.5 * math.cos(math.pi * (a - flat) / (1 - flat))


def fade(y, y0, y1, r=0.04):
    return smooth01((y - y0) / r) * smooth01((y1 - y) / r)


def arc_at_drop(sec, d0):
    """arc position on the flank where the unscaled drop crosses d0."""
    cs = [p for p in sec if p[4] == "C"]
    for a, b in zip(cs, cs[1:]):
        if a[2] <= d0 <= b[2]:
            t = (d0 - a[2]) / max(b[2] - a[2], 1e-9)
            return a[3] + (b[3] - a[3]) * t
    return None


def arch_slope(y, h=0.004):
    return abs(arch(y + h) - arch(y - h)) / (2 * h)


def displacement(side, y, p, step_arcs, cup_arc, bead_w):
    x, z, du, arc, seg = p
    d = 0.0
    if seg == "AB" and bead_w > 0:                                  # I1 rolled bead just above the 25 mm flange
        d += 0.004 * bump(arc - 0.032, 0.008, 0.2) * bead_w
    if seg == "C":
        for sa in step_arcs:                                        # I5 longitudinal steps on the inboard flank
            if sa is not None:
                d += 0.008 * bump(arc - sa, 0.020, 0.35) * fade(y, -2.36, -1.62, 0.08)
        if side == "L" and cup_arc is not None:                     # I7 cup blister, pushed inboard
            r2 = ((y - CUP["y"]) / CUP["ly"]) ** 2 + ((arc - cup_arc) / CUP["la"]) ** 2
            d += CUP["depth"] * smooth01((1 - r2) / 0.75)
    if seg in ("AB", "C") and du < 0.06 and side == "R":           # crown stampings, RH only (I9 '+', dish)
        rib = max(bump(x - PLUS["x"], PLUS["w"], 0.3) * bump(y - PLUS["y"], PLUS["arm_y"], 0.85),
                  bump(y - PLUS["y"], PLUS["w"], 0.3) * bump(x - PLUS["x"], PLUS["arm_x"], 0.80))
        d += PLUS["h"] * rib
        r2 = ((y - DISH["y"]) / DISH["ry"]) ** 2 + ((x - DISH["x"]) / DISH["rx"]) ** 2
        d -= DISH["depth"] * smooth01((1 - r2) / 0.6)
    if seg in ("AB", "C") and y > Y_R - 0.08:                       # I12 diagonal crease on the rear face, 45 deg
        ax, ay, bx, by = 0.534, Y_R - 0.004, 0.470, Y_R - 0.068
        vx, vy = bx - ax, by - ay; L = math.hypot(vx, vy)
        t = ((x - ax) * vx + (y - ay) * vy) / (L * L)
        if -0.05 < t < 1.05:
            dist = abs((x - ax) * vy - (y - ay) * vx) / L
            d -= 0.004 * bump(dist, 0.014, 0.1) * smooth01(min(t + 0.05, 1.05 - t) / 0.15)
    return d


# ---------------------------------------------------------------- the lofted sheet (LH coordinates)
def tub_bmesh(side):
    secs = [section(y) for y in YS]
    P = [[Vector((p[0], y, p[1])) for p in sec] for y, sec in zip(YS, secs)]
    nj, ni = len(P), len(P[0])
    N = [[None] * ni for _ in range(nj)]
    for j in range(nj):
        for i in range(ni):
            du = P[j][min(i + 1, ni - 1)] - P[j][max(i - 1, 0)]
            dv = P[min(j + 1, nj - 1)][i] - P[max(j - 1, 0)][i]
            n = dv.cross(du)
            N[j][i] = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
    jc = min(range(nj), key=lambda j: abs(YS[j] + 2.0)); ic = min(range(ni), key=lambda i: abs(P[jc][i].x - X_CROWN))
    sgn = 1.0 if N[jc][ic].z > 0 else -1.0                          # normals point to the engine side (top)
    cup, best = None, 9.0
    bm = bmesh.new()
    V = []
    for j, (y, sec) in enumerate(zip(YS, secs)):
        steps = [arc_at_drop(sec, d0) for d0 in STEPS]
        ca = arc_at_drop(sec, CUP["d"]) if (side == "L" and abs(y - CUP["y"]) < CUP["ly"] * 1.1) else None
        bw = 1.0 - smooth01((arch_slope(y) - 0.4) / 0.6)
        row = []
        for i, p in enumerate(sec):
            d = displacement(side, y, p, steps, ca, bw)
            q = P[j][i] + N[j][i] * sgn * d
            row.append(bm.verts.new(q))
            if ca is not None and p[4] == "C":
                e = math.hypot(y - CUP["y"], p[3] - ca)
                if cup is None or e < best:
                    best, cup = e, q.copy()
        V.append(row)
    for j in range(nj - 1):
        for i in range(ni - 1):
            bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
    bm.normal_update()
    fc = min(bm.faces, key=lambda f: (f.calc_center_median() - Vector((X_CROWN, -2.0, zc(-2.0)))).length)
    if fc.normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:]); bm.normal_update()
    return bm, dict(secs=secs, cup=cup)


def envelope_top(sec):
    """roof z as a function of x for one section (upper envelope of the rim-wall/shoulder/flank polyline)."""
    pl = [(p[0], p[1]) for p in sec if p[4] in ("AB", "C")]
    x_lo, x_hi = min(p[0] for p in pl), max(p[0] for p in pl)

    def f(x):
        x = min(max(x, x_lo), x_hi)
        best = None
        for a, b in zip(pl, pl[1:]):
            lo, hi = min(a[0], b[0]), max(a[0], b[0])
            if lo - 1e-9 <= x <= hi + 1e-9:
                z = max(a[1], b[1]) if hi - lo < 1e-9 else a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
                best = z if best is None else max(best, z)
        return best
    return f


def panel_bmesh(y, top, bottom, x0, x1, ncol=72, nrow=22, ydisp=None):
    """flat transverse panel at y between bottom(x) and top(x) for x in [x0, x1]; ydisp(x, z, zb, zt) presses it in y."""
    bm = bmesh.new(); G = []
    for r in range(nrow):
        row = []
        for k in range(ncol):
            x = x0 + (x1 - x0) * k / (ncol - 1)
            zt, zb = top(x), bottom(x)
            z = zb + (zt - zb) * r / (nrow - 1)
            row.append(bm.verts.new((x, y + (ydisp(x, z, zb, zt) if ydisp else 0.0), z)))
        G.append(row)
    for r in range(nrow - 1):
        for k in range(ncol - 1):
            bm.faces.new((G[r][k], G[r][k + 1], G[r + 1][k + 1], G[r + 1][k]))
    bm.normal_update()
    return bm


def to_object(name, bm, side, want):
    """mirror for RH; mesh object; solidify 0.9 mm toward the world direction `want` (None = against the normals)."""
    if side == "R":
        for v in bm.verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update(); bm.faces.ensure_lookup_table()
    n0 = bm.faces[len(bm.faces) // 2].normal.copy()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    sol = ob.modifiers.new("sol", "SOLIDIFY"); sol.thickness = T; sol.use_even_offset = True
    sol.offset = -1.0 if want is None else (1.0 if n0.dot(Vector(want)) > 0 else -1.0)
    return ob


def apply_all(ob):
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def cut_holes(ob, holes):
    """holes: [(point, axis, radius)]; one EXACT boolean with all cutters joined."""
    if not holes:
        return
    bm = bmesh.new()
    for p, ax, r in holes:
        q = Vector(ax).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
        q.translation = Vector(p)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r, depth=0.03, matrix=q)
    me = bpy.data.meshes.new("cut"); bm.to_mesh(me); bm.free()
    cut = bpy.data.objects.new("cut", me); bpy.context.scene.collection.objects.link(cut)
    b = ob.modifiers.new("holes", "BOOLEAN"); b.object = cut; b.operation = "DIFFERENCE"; b.solver = "EXACT"
    apply_all(ob)
    bpy.data.objects.remove(cut)
    bpy.data.meshes.remove(me)


def add_bar(bm, centre, size, bevel=0.0015):
    m = Vector(centre)
    res = bmesh.ops.create_cube(bm, size=1.0)
    vs = res["verts"]
    for v in vs:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + m
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect="EDGES", clamp_overlap=True)


def bvh_of(ob):
    me = ob.data
    return BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])


def hit(bvh, o, d):
    loc, n, i, dist = bvh.ray_cast(Vector(o), Vector(d).normalized(), 3.0)
    return loc


# ---------------------------------------------------------------- one side
def build_side(side, mat):
    sx = 1.0 if side == "L" else -1.0
    S = side
    LM = {}
    bm, info = tub_bmesh(side)
    tub = to_object(f"inner_fender_{S}_tub", bm, side, None)
    bvh_top = bvh_of(tub)                                           # the engine-side surface, before thickness

    def zs(x, y):
        h = hit(bvh_top, (sx * x, y, 2.0), (0, 0, -1)); return None if h is None else h.z

    def x_inboard(y, z):
        h = hit(bvh_top, (0.0, y, z), (sx, 0, 0)); return None if h is None else abs(h.x)

    # rear panel (cowl end) and front closing panel (core-support end)
    sec_r, sec_f = info["secs"][-1], info["secs"][0]
    top_r, top_f = envelope_top(sec_r), envelope_top(sec_f)
    xr0, xf0 = x_in(Y_R), x_in(Y_F)
    out_r = pchip([(xr0, zbot(Y_R) - 0.0005)] + OUTLINE_R + [(X_RIM, arch(Y_R))])
    leg_x = xr0 + 0.090                     # I11 holed cowl leg: 0.09 m from the inboard edge, 20-35 mm wide (28)

    def leg(x, z, zb, zt):                  # pressed 8 mm rearward (toward the cowl), fading out under the fold
        return 0.008 * bump(x - leg_x, 0.020, 0.45) * smooth01((zt - z) / 0.03)
    def front_bottom(x):                    # notch over the radiator-post foot, then the tab level
        return Z_TAB + (Z_POSTFOOT - Z_TAB) * (1 - smooth01((x - X_POSTFOOT) / 0.012))
    rear = to_object(f"inner_fender_{S}_rear_panel", panel_bmesh(Y_R, top_r, out_r, xr0, X_RIM, ydisp=leg), side,
                     (0, -1, 0))
    front = to_object(f"inner_fender_{S}_front_panel", panel_bmesh(Y_F, top_f, front_bottom, xf0, X_RIM), side,
                      (0, 1, 0))
    # front tab: rearward flange on the core-support lower tie-bar shelf (x 0.507-0.889, y to -2.446)
    tb = bmesh.new(); gx, gy = 24, 6
    G = [[tb.verts.new((0.515 + (0.835 - 0.515) * k / (gx - 1), Y_F + 0.066 * r / (gy - 1), Z_TAB)) for k in range(gx)]
         for r in range(gy)]
    for r in range(gy - 1):
        for k in range(gx - 1):
            tb.faces.new((G[r][k], G[r][k + 1], G[r + 1][k + 1], G[r + 1][k]))
    tab = to_object(f"inner_fender_{S}_front_tab", tb, side, (0, 0, 1))
    # I8 ledge ribs: 5-6 transverse ribs 30-40 mm long at 40-60 mm pitch; placed between holes 2 and 3 (assumed)
    rbm = bmesh.new()
    for k in range(6):
        y = -1.975 - 0.050 * k
        add_bar(rbm, (sx * (x_in(y) + 0.030), y, zbot(y) + 0.0025), (0.034, 0.008, 0.005))
    ribs = bpy.data.objects.new(f"inner_fender_{S}_ledge_ribs", bpy.data.meshes.new(f"inner_fender_{S}_ledge_ribs"))
    rbm.to_mesh(ribs.data); rbm.free(); bpy.context.scene.collection.objects.link(ribs)
    for ob in (tub, rear, front, tab):
        apply_all(ob)

    holes = {"tub": [], "rear": [], "tab": []}
    # I14 shelf hole H1 (owner f6203444 x 069ba2a5 triangulation, x/y kept, z = this surface)
    z = zs(0.595, -2.153); LM["I14_roof_hole_H1"] = (0.595, -2.153, z)
    holes["tub"].append(((sx * 0.595, -2.153, z), (0, 0, 1), 0.004))
    # I14 roof holes v1..v5 (OER T70124 LH-01 picks: y, z kept; x on this surface, the solve's x was a flank guess)
    for nm, y, z in (("v1", -1.698, 0.983), ("v2", -1.764, 1.071), ("v3", -1.778, 0.857), ("v4", -1.846, 0.862),
                     ("v5", -2.069, 0.968)):
        x = x_inboard(y, z); LM["I14_roof_hole_" + nm] = (x, y, z)
        holes["tub"].append(((sx * x, y, z), (-sx, 0, 0.5), 0.0035))
    # I8 rail-ledge holes, 17 mm, at the T124-1 y positions, ledge centre
    for k, y in enumerate((-1.563, -1.894, -2.264), 1):
        x = x_in(y) + 0.030; LM[f"I8_rail_flange_hole_{k}"] = (x, y, zbot(y))
        holes["tub"].append(((sx * x, y, zbot(y)), (0, 0, 1), 0.0085))
    # I1 rim holes: 9 x 8 mm at equal arc length along the rim edge, 12 mm above it (LH_2: 9-11 at 100-150 mm)
    ys = [-2.30 + (-1.52 + 2.30) * k / 200 for k in range(201)]
    pts = [(y, arch(y) + 0.012) for y in ys]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for k in range(9):
        tg = cum[-1] * k / 8; i = min(range(len(cum)), key=lambda q: abs(cum[q] - tg))
        holes["tub"].append(((sx * X_RIM, pts[i][0], pts[i][1]), (1, 0, 0), 0.004))
    # I6: three bolts through the front outboard wall into the core-support end wall (x 0.865-0.890, y to -2.487)
    for z in (0.82, 0.92, 1.02):
        holes["tub"].append(((sx * X_RIM, Y_F + 0.017, z), (1, 0, 0), 0.0045))
    # I11: 26 mm hole between leg and inboard edge (0.05 m from the edge, 0.21 m above the bottom), 15 mm hole on the
    # outboard part, two 9 mm holes on the leg (assumed positions on the leg)
    LM["I11_hole_26"] = (xr0 + 0.05, Y_R, 0.608 + 0.21)
    holes["rear"].append(((sx * (xr0 + 0.05), Y_R, 0.608 + 0.21), (0, 1, 0), 0.013))
    holes["rear"].append(((sx * 0.705, Y_R, 0.735), (0, 1, 0), 0.0075))
    for z in (0.680, 0.770):
        holes["rear"].append(((sx * leg_x, Y_R + 0.008, z), (0, 1, 0), 0.0045))
    # front tab: 4 holes (T124-2, rh_4)
    for x in (0.56, 0.64, 0.72, 0.80):
        holes["tab"].append(((sx * x, Y_F + 0.035, Z_TAB), (0, 0, 1), 0.0045))
    cut_holes(tub, holes["tub"]); cut_holes(rear, holes["rear"]); cut_holes(tab, holes["tab"])

    # landmarks read off the built surfaces (twin coordinates, LH sign)
    for y in (-1.506, -1.565, -1.625, -1.684, -1.744, -1.803, -1.863, -1.922, -1.982, -2.041, -2.101, -2.160, -2.220,
              -2.279, -2.339, -2.398, -2.458, -2.517):
        LM[f"I2_crown_ridge_y{y:.2f}"] = (X_CROWN, y, zs(X_CROWN, y))
    LM["SEC_se_top_shelf"] = (X_CROWN, -2.45, zs(X_CROWN, -2.45))
    LM["SEC_ce_top"] = (X_CROWN, -1.50, zs(X_CROWN, -1.50))
    LM["I1_rim_apex"] = (X_RIM, -1.990, rimtop(-1.990))
    yw = -1.935
    LM["I4_inboard_edge_wheelcentre"] = (x_in(yw), yw, zc(yw) - 0.377 * vscale(yw))
    LM["I4_rail_flange_outer_corner"] = (x_in(yw), yw, zbot(yw))
    LM["I8_front_tab_tip"] = (0.600, Y_F, Z_TAB)
    LM["SEC_se_tab_top"] = (0.600, Y_F, top_f(0.600))
    LM["SEC_se_tab_bottom"] = (0.600, Y_F, Z_TAB)
    LM["I10_rear_panel_bottom_tip"] = (0.598, Y_R, out_r(0.598))
    LM["I10_rear_panel_fold"] = (0.598, Y_R, top_r(0.598))
    LM["I11_leg_top"] = (leg_x, Y_R + 0.008, top_r(leg_x))
    if info["cup"] is not None:
        q = info["cup"]; LM["I7_cup_centre"] = (q.x, q.y, q.z)
    if side == "R":
        LM["R_I9_plus_centre"] = (-PLUS["x"], PLUS["y"], zs(PLUS["x"], PLUS["y"]))
        LM["R_I7_dish_centre"] = (-DISH["x"], DISH["y"], zs(DISH["x"], DISH["y"]))
    parts = [tub, rear, front, tab, ribs]
    for ob in parts:
        ob.data.materials.clear(); ob.data.materials.append(mat)
    return parts, LM


def envelope(objs):
    """rear-view envelope (projection along y) of the tub over y -2.40..-1.50: outboard / inboard |x| at height z."""
    V = []
    for o in objs:
        V += [o.matrix_world @ v.co for v in o.data.vertices]

    def at(z, outboard):
        s = [abs(v.x) for v in V if abs(v.z - z) < 0.004 and -2.40 < v.y < -1.50]
        return (max(s) if outboard else min(s)) if s else None
    return at


def tyre_clearance(objs):
    """min distance from the LH skirt to the TurboSquid tyre (k5-blazer.glb Wheel_Front_Left: centre (0.860, -1.8955,
    0.3957), r 0.4063, x 0.691..1.029) swept +-35 deg about a vertical kingpin at x 0.72 (assumed), static and +60 mm
    bump (assumed). The owner's tyre size is unknown."""
    pts = []
    for o in objs:
        pts += [o.matrix_world @ v.co for v in o.data.vertices]
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    res = {}
    for bz in (0.0, 0.06):
        best = (9.0, None)
        for th in range(-35, 36, 5):
            c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
            for k in range(7):
                xw = 0.691 + (1.029 - 0.691) * k / 6
                for a in range(0, 360, 6):
                    ph = math.radians(a)
                    y0, z0 = -1.8955 + 0.4063 * math.cos(ph), 0.3957 + bz + 0.4063 * math.sin(ph)
                    if z0 < 0.55:
                        continue
                    dx, dy = xw - 0.72, y0 + 1.8955
                    p = Vector((0.72 + dx * c - dy * s, -1.8955 + dx * s + dy * c, z0))
                    co, i, dist = kd.find(p)
                    if dist < best[0]:
                        best = (dist, [th, round(p.x, 3), round(p.y, 3), round(p.z, 3)])
        res["bump_%dmm" % round(bz * 1000)] = [round(best[0] * 1000, 1), best[1]]
    return res


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = bpy.data.materials.new("bare_primer"); m.use_nodes = True     # BRIEF addendum: bare primer / EDP parts
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.18, 0.18, 0.19, 1); b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.6
    allparts, LM_all, clear = [], {}, {}
    for side in ("L", "R"):
        parts, LM = build_side(side, m)
        root = bpy.data.objects.new(f"inner_fender_{side}", None); bpy.context.scene.collection.objects.link(root)
        for o in parts:
            o.parent = root
        allparts += parts
        if side == "L":
            LM_all.update(LM)
            env = envelope([parts[0]])
            for f, z in (("f40", 0.813), ("f50", 0.864), ("f60", 0.915), ("f70", 0.966), ("f80", 1.018), ("f90", 1.069),
                         ("f95", 1.094), ("f98", 1.110)):
                xo, xi = env(z, True), env(z, False)
                if xo is not None: LM_all[f"SEC_wc_out_{f}"] = (xo, -1.935, z)
                if xi is not None: LM_all[f"SEC_wc_in_{f}"] = (xi, -1.935, z)
            clear = tyre_clearance(parts)
        else:
            for k in ("R_I9_plus_centre", "R_I7_dish_centre"):
                LM_all[k] = LM[k]
    for o in allparts:
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    tris = sum(len(p.vertices) - 2 for o in allparts for p in o.data.polygons)
    bpy.ops.object.select_all(action="SELECT")
    os.makedirs(os.path.dirname(os.path.abspath(OUT_GLB)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_yup=True,
                              export_extras=False, export_apply=True, export_draco_mesh_compression_enable=False,
                              export_texcoords=False, export_normals=True, export_cameras=False, export_lights=False)
    # strip extras and refuse credential-looking bytes (the rules of chassis_frame.strip_and_scan)
    raw = open(OUT_GLB, "rb").read()
    jl = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jl]); rest = raw[20 + jl:]
    j.pop("extras", None)
    for sc in j.get("scenes", []):
        sc.pop("extras", None)
    js = json.dumps(j, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    raw = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
    low = raw.lower()
    hits = [w for w in (b"api_key", b"token", b"secret", b"blendermcp", b"sketchfab") if w in low]
    hits += [b"hex32"] if re.search(rb"[0-9a-fA-F]{32}", js) else []
    hits += [b"draco"] if b"KHR_draco" in raw else []
    if hits:
        raise SystemExit(f"refusing to ship {OUT_GLB}: found {hits}")
    open(OUT_GLB, "wb").write(raw)
    out = {"_frame": "twin metres, +x driver, -y forward, +z up; driver (LH) skirt unless prefixed R_; written by "
                     "inner_fender_sds.py from its own geometry"}
    for k in sorted(LM_all):
        if any(c is None for c in LM_all[k]):
            continue
        out[k] = [round(float(c), 4) for c in LM_all[k]]
    with open(OUT_LM, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    print(f"INNER_FENDER glb {OUT_GLB} {len(raw)} bytes, {len(allparts)} meshes, {tris} triangles, {len(out) - 1} landmarks")
    print("INNER_FENDER tyre clearance mm [min, [steer deg, x, y, z]]", json.dumps(clear))


main()
