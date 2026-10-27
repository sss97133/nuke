"""The K5's firewall (dash panel, toe board, cowl sides) drawn from reference photos, for the twin and the site
(nuke_frontend/public/models/k5-firewall.glb). Blender headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b -P docs/wiring/calc-data/cad/fab/firewall_blender.py -- docs/wiring/calc-data/cad/fab/firewall_ba.json nuke_frontend/public/models/k5-firewall.glb [mesh.npz]

Frame: twin metres, +x driver, -y forward, +z up; the glTF exporter's Y-up turn gives (x, z, -y), as k5cad.write_glb.
Stock 1973-80 C/K non-AC pressing (the owner's panel; scott-bay 058). Landmarks come from a bundle adjustment over three
camera-matched photos (WVUT f_0785 bare straight on, WVUT f_0009 bare passenger 3/4, owner 058), scaled by the FR-88 cowl
point pair (1715 mm) placed on the dash panel's outer cowl-flange tips. ba.json holds the solved points and cameras; the
photos are vendor and owner images and stay out of the repo. Then run chassis_frame.strip_and_scan on the GLB. Receipt: docs/wiring/receipts/2026-10-26_k5-firewall-3d.md.
"""
import json
import math
import sys

import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BA = json.load(open(argv[0]))
OUT = argv[1] if len(argv) > 1 else "k5-firewall.glb"
NPZ = argv[2] if len(argv) > 2 else None
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


# ---- outline traced on WVUT f_0785 (pixels), passenger end first, clockwise as seen from ahead
OUTLINE_PX = [(22, 178), (200, 125), (600, 112), (1000, 112), (1400, 118), (1700, 150), (1835, 222), (1845, 300),
              (1840, 420), (1830, 500), (1750, 590), (1300, 600), (1290, 580), (1150, 500), (1000, 478), (880, 490),
              (700, 562), (300, 585), (195, 585), (60, 520), (15, 420), (10, 300)]
outline = np.array([onface(*p) for p in OUTLINE_PX])
# pin the traced ends to the solved landmarks (the trace and the solve share the 0785 camera)
tun_top, tun_foot = PT["tun_top"], PT["tun_footP"]


def inside(poly, x, z):
    n, c = len(poly), np.zeros_like(x, bool)
    for i in range(n):
        x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % n]
        m = ((z1 > z) != (z2 > z)) & (x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-12) + x1)
        c ^= m
    return c


def mm(px):  # 0785 pixels -> metres at the face (local scale near the centre)
    a, b = onface(900, 350), onface(1000, 350)
    return px * abs(b[0] - a[0]) / 100


# ---- stamped features, each from a photo (WVUT 0785 unless named)
bl, bo, wi, bh = PT["blower"], PT["booster"], PT["wiper"], PT["bulkhead"]
hc = (PT["heaterTL"] + PT["heaterBR"]) / 2
HOLES = {
    "blower_hole": ("circle", bl[0], bl[2], mm(125) / 2),            # 0785 hole 65-190 px
    "heater_opening": ("rect", hc[0], hc[2], mm(168) / 2, mm(204) / 2),  # 0785 rect 460-628 x 308-512 px
    "booster_hole": ("circle", bo[0], bo[2], mm(60) / 2),             # 0785 1358-1418 px
    "wiper_motor_hole": ("circle", wi[0], wi[2], mm(65) / 2),         # 0785 1600-1665 px
    "bulkhead_hole": ("rect", bh[0], bh[2], 0.0275, 0.045),           # owner 058 connector 35 x 60 px at 1.54 mm/px
}
pc = onface(1410, 495)
HOLES["pedal_column_opening"] = ("rect", pc[0], pc[1], mm(140) / 2, mm(110) / 2)  # 0785 1340-1480 x 440-550 px
pad0, pad1 = onface(1305, 205), onface(1500, 570)                     # booster/pedal reinforcement pad, 0785
rib0, rib1 = onface(200, 200), onface(1250, 285)                      # upper horizontal channel, 0785 / 0009 / 058


def hole_mask(x, z):
    m = np.zeros_like(x, bool)
    for h in HOLES.values():
        if h[0] == "circle":
            m |= (x - h[1]) ** 2 + (z - h[2]) ** 2 < h[3] ** 2
        else:
            m |= (abs(x - h[1]) < h[3]) & (abs(z - h[2]) < h[4])
    return m


def smoothstep(a, b, t):
    s = np.clip((t - a) / (b - a), 0, 1)
    return s * s * (3 - 2 * s)


def face_y(x, z):
    y = np.full_like(x, FACE_Y)
    # outer ends wrap rearward to the cowl sides (0009, 0161; the flange tips solve at y -1.43)
    y += 0.03 * smoothstep(0.70, 0.86, abs(x))
    # upper channel: a 15 mm rearward recess across the panel (depth assumed +/-8 mm; band and length from 0785)
    zb, zt = sorted((rib0[1], rib1[1]))
    xa, xb = sorted((rib0[0], rib1[0]))
    band = smoothstep(zb - 0.01, zb + 0.01, z) * (1 - smoothstep(zt - 0.01, zt + 0.01, z))
    band *= smoothstep(xa - 0.02, xa + 0.02, x) * (1 - smoothstep(xb - 0.02, xb + 0.02, x))
    y += 0.015 * band
    # blower ring: a 15 mm forward dome around the blower hole (0785 ring ~230 px across; 058 shows the same ring)
    r = np.hypot(x - bl[0], z - bl[2])
    y -= 0.015 * (1 - smoothstep(mm(115) * 0.7, mm(115), r))
    # booster pad: a 5 mm forward plate (0785, 0009, 0161)
    xp0, xp1 = sorted((pad0[0], pad1[0])); zp0, zp1 = sorted((pad0[1], pad1[1]))
    y -= 0.005 * ((x > xp0) & (x < xp1) & (z > zp0) & (z < zp1))
    return y


def grid_mesh(xs, zs, keep, yfun):
    X, Z = np.meshgrid(xs, zs)
    K = keep(X, Z)
    idx = -np.ones(X.shape, int)
    idx[K] = np.arange(K.sum())
    verts = np.stack([X[K], yfun(X[K], Z[K]), Z[K]], 1)
    faces = []
    for i in range(len(zs) - 1):
        for j in range(len(xs) - 1):
            q = (idx[i, j], idx[i, j + 1], idx[i + 1, j + 1], idx[i + 1, j])
            if min(q) >= 0:
                faces.append(q)
    return verts, faces


STEP = 0.008
xmin, xmax = outline[:, 0].min(), outline[:, 0].max()
zmin, zmax = outline[:, 1].min(), outline[:, 1].max()
dash = grid_mesh(np.arange(xmin, xmax + STEP, STEP), np.arange(zmin, zmax + STEP, STEP),
                 lambda x, z: inside(outline, x, z) & ~hole_mask(x, z), face_y)

# ---- toe board: from the dash's lower edge rearward and down to the floor, with the tunnel continuing through it.
# Floor line (y -1.22, z 0.66) is the old generator's assumed toe_bottom (+/-0.04 m); no photo shows the toe board.
TOE_Y1, TOE_Z1 = -1.220, 0.660
toe_z0 = float(np.median(outline[[17, 18, 11], 1]))  # dash lower edge, 0785
tx0, tw_top, tw_foot, tz_top = tun_top[0], 0.10, abs(tun_foot[0] - tun_top[0]), tun_top[2]
# tunnel half widths: foot from the solved tun_footP, top flat from 0785 (880-1150 px across the arch crown)


def tunnel_h(x):
    d = abs(x - tx0)
    return np.where(d < tw_top, tz_top, np.where(d < tw_foot, tz_top - (tz_top - toe_z0) * smoothstep(tw_top, tw_foot, d), -9))


def toe_mesh():
    xs = np.arange(-0.80, 0.80 + STEP, STEP * 1.5)
    ts = np.linspace(0, 1, 30)
    V, F = [], []
    for i, t in enumerate(ts):
        y = FACE_Y + t * (TOE_Y1 - FACE_Y)
        zf = toe_z0 + t * (TOE_Z1 - toe_z0)
        for x in xs:
            h = tunnel_h(x)
            z = max(zf, float(h) - 0.04 * t) if h > -1 else zf
            V.append((x, y, z))
    n = len(xs)
    for i in range(len(ts) - 1):
        for j in range(n - 1):
            F.append((i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j))
    return np.array(V), F


toe = toe_mesh()


def cowl_side(sign):
    """Kick panel the fender bolts to: a flat wall at the FR-88 cowl point x, from the flange tip (solved z) down to
    the toe line; extents assumed (repro part photos only, no real bare cab side shown)."""
    x = sign * 0.8575
    ys, zs = np.linspace(-1.43, -1.25, 12), np.linspace(toe_z0, PT["ear_P"][2], 16)
    V = [(x, y, z) for z in zs for y in ys]
    n = len(ys)
    F = [(i * n + j, i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j) for i in range(len(zs) - 1) for j in range(n - 1)]
    return np.array(V), F


parts = {"firewall_dash": dash, "firewall_toe_board": toe, "cowl_side_L": cowl_side(-1), "cowl_side_R": cowl_side(1)}

LANDMARKS = {
    "panel_width_at_cowl_m": float(PT["ear_D"][0] - PT["ear_P"][0]),
    "cowl_flange_tip_z": float(PT["ear_P"][2]),
    "cowl_seam_centre_yz": [float(PT["Q"][1]), float(PT["Q"][2])],
    "booster_hole_xz": [float(bo[0]), float(bo[2])],
    "blower_hole_xz": [float(bl[0]), float(bl[2])],
    "wiper_hole_xz": [float(wi[0]), float(wi[2])],
    "bulkhead_hole_xz": [float(bh[0]), float(bh[2])],
    "heater_opening_xz": [float(hc[0]), float(hc[2])],
    "pedal_column_opening_xz": [float(pc[0]), float(pc[1])],
    "tunnel_top_xz": [float(tx0), float(tz_top)],
    "tunnel_width_at_foot_m": float(2 * tw_foot),
    "dash_lower_edge_z": toe_z0,
    "toe_board_angle_deg": math.degrees(math.atan2(toe_z0 - TOE_Z1, TOE_Y1 - FACE_Y)),
    "holes": {k: [float(v) for v in h[1:]] for k, h in HOLES.items()},
}
print("LANDMARKS", json.dumps(LANDMARKS))

if NPZ:
    np.savez(NPZ, **{f"{k}_v": np.array(v[0]) for k, v in parts.items()}, **{f"{k}_f": np.array(v[1]) for k, v in parts.items()})

import bpy  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new("firewall_paint")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.32, 0.06, 0.07, 1)  # the owner's oxblood (058)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.6

# clash check against the twin's engine (k5-engine-ls3.glb): engine and 6L90 vertices behind the face
import os  # noqa: E402
eng = os.path.join(os.path.dirname(OUT), "k5-engine-ls3.glb")
if os.path.exists(eng):
    bpy.ops.import_scene.gltf(filepath=eng)
    pts = []
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH":
            M = o.matrix_world
            pts += [tuple(M @ v.co) for v in o.data.vertices]
    P = np.array(pts)
    hits = []
    for x, y, z in P[P[:, 1] > FACE_Y - 0.01]:
        floor = max(float(tunnel_h(x)), toe_z0) if True else 0
        if z > floor and abs(x) < 0.80 and z < zmax:
            hits.append((x, y, z))
    H = np.array(hits) if hits else np.zeros((0, 3))
    print("CLASH", json.dumps({"engine_pts_behind_face": int((P[:, 1] > FACE_Y).sum()), "inside_stock_panel": len(H),
                               "x": [float(H[:, 0].min()), float(H[:, 0].max())] if len(H) else None,
                               "y_max": float(H[:, 1].max()) if len(H) else None,
                               "z": [float(H[:, 2].min()), float(H[:, 2].max())] if len(H) else None}))
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)

for name, (V, F) in parts.items():
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in V], [], [tuple(map(int, f)) for f in F])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness = 0.0012  # 18 ga, Classic Industries' repro panel
    sol.offset = 1.0
    for p in me.polygons:
        p.use_smooth = True

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_extras=False, export_materials="EXPORT", use_selection=False)
print("WROTE", OUT, os.path.getsize(OUT))
