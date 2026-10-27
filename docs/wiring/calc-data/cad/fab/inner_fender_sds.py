"""K5 1973-80 front inner fender (fender skirt), sculpted as a subdivision surface against reference photos.

Run headless:  Blender -b -P inner_fender_sds.py -- <out.blend> [<out.glb>]
Twin metres: +x driver, -y forward, +z up. LH is built, RH is its mirror. The GLB is Y-up, (X,Y,Z) = (x, z, -y).

Shape (receipt docs/wiring/receipts/2026-10-26_k5-inner-fender-sds.md names the photo for each feature):
one deep-drawn tub. A low-poly cage is placed by hand: a top grid (the dome, full and high nearly to both ends) and six
rings hung off its boundary (shoulder, wall top, wall, bend, flange root, flange tip). The engine-side wall drops to a
straight bottom flange on the frame rail; the outboard side drops to the wheel-arch rim and its lip under the fender;
the front end is a full-width bowl whose flange runs forward flat; the rear end closes against the cowl.
Catmull-Clark level 3 rounds it; stamped detail (front-flange ribs, the shelf's cross ribs and pan, clip holes) is
pressed into the subdivided sheet, then it is solidified to 1 mm.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

# ---- placement (agreed twin anchors) -------------------------------------------------------------------------------
X_WALL = 0.420        # engine-side wall plane
X_OUT = 0.832         # outboard wall plane; its lip runs out to the fender line
X_LIP = 0.858         # lip edge, under the outer fender's top lip
Z_RAIL = 0.620        # straight bottom flange on the frame rail
Y_FRONT = -2.505      # front flange tip on the core support's rear face
Y_REAR = -1.440       # rear flange at the cowl
Y_FWALL = -2.440      # front bowl wall (flange 65 mm forward of it, Raybuck LH 1-5)
Y_RWALL = -1.462      # rear end wall
TOP = 1.085           # dome crown (bottom flange + ~18 in OER box height, less the rim drop)
# outboard rim height along y: b_eckler_1 trace for the crown, ends pulled down by eye to the arch in Raybuck LH 9/13, RH 9/12
RIM = [(-2.505, 0.700), (-2.42, 0.780), (-2.30, 0.880), (-2.18, 0.950), (-2.03, 0.978), (-1.87, 0.980),
       (-1.75, 0.968), (-1.64, 0.930), (-1.56, 0.850), (-1.50, 0.740), (-1.44, 0.640)]
FRONT_BOT = 0.740     # the front flange lies flat at this height (Raybuck LH 1-5, b_oer_1 left end)
REAR_BOT = 0.640      # rear edge comes down the cowl to near the rail (b_jegs_1 holed leg)


def lerp_tab(tab, y):
    if y <= tab[0][0]: return tab[0][1]
    if y >= tab[-1][0]: return tab[-1][1]
    for (y0, z0), (y1, z1) in zip(tab, tab[1:]):
        if y0 <= y <= y1: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


# ---- cage -----------------------------------------------------------------------------------------------------------
NU, NV = 6, 12                        # top grid quads across (inboard -> outboard) and along (front -> rear)
XT0, XT1 = 0.505, 0.775               # top grid x extent (shoulders roll off outside it)
YT0, YT1 = -2.385, -1.520             # top grid y extent: the dome stays high nearly to both ends


def top_z(x, y):
    u = (x - XT0) / (XT1 - XT0); v = (y - YT0) / (YT1 - YT0)
    z = TOP + 0.012 * (1 - u)                       # crest sits a little inboard (b_jegs_1 highlight, Raybuck LH 9)
    z -= 0.030 * (2 * u - 1) ** 4                   # flattening off toward the shoulders
    z -= 0.022 * max(0.0, 1 - fold_d(x, y) / 0.06)   # the fold: a shallow valley along FOLD
    z -= 0.050 * (2 * v - 1) ** 2 + 0.050 * (2 * v - 1) ** 4   # crowned along y, ends roll off (Raybuck LH 9, RH 9)
    return z


FOLD = ((0.525, -1.98), (0.760, -1.62))   # dome's diagonal fold, running rearward and outboard (Raybuck LH 9, RH 9/12)


def fold_d(x, y):
    (x0, y0), (x1, y1) = FOLD
    t = max(0.0, min(1.0, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)))
    return math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)))


def boundary(nu, nv):
    """grid indices (i, j) around the top grid's boundary, counter-clockwise seen from above (LH)."""
    ring = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)]
    ring += [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
    return ring


def side_of(i, j):
    """outward direction (dx, dy) and which wall a boundary vertex hangs off."""
    dx = 1 if i == NU else (-1 if i == 0 else 0)
    dy = -1 if j == 0 else (1 if j == NV else 0)
    return dx, dy


def wall_point(x, y, dx, dy):
    """where a boundary vertex lands on the wall planes, and the bottom height there."""
    wx = X_OUT if dx > 0 else (X_WALL if dx < 0 else x)
    wy = Y_FWALL if dy < 0 else (Y_RWALL if dy > 0 else y)
    if dx < 0: zb = Z_RAIL                            # straight engine-side flange (Raybuck RH 1, RH 9)
    elif dx > 0: zb = lerp_tab(RIM, wy)               # wheel-arch rim
    elif dy < 0:                                      # front bowl: flat flange, meets the rail flange at the inboard corner
        t = (x - XT0) / (XT1 - XT0); zb = FRONT_BOT + (lerp_tab(RIM, wy) - FRONT_BOT) * max(t - 0.6, 0) / 0.4
        zb = Z_RAIL + (zb - Z_RAIL) * min(1, 0.35 + t * 1.6)
    else:                                             # rear end: down the cowl
        t = (x - XT0) / (XT1 - XT0); zb = REAR_BOT + (lerp_tab(RIM, wy) - REAR_BOT) * t ** 2
    if dx < 0 and dy != 0: zb = Z_RAIL
    if dx > 0 and dy != 0: zb = lerp_tab(RIM, wy)
    return wx, wy, zb


def build_cage():
    bm = bmesh.new()
    xs = [XT0 + (XT1 - XT0) * i / NU for i in range(NU + 1)]
    ys = [YT0 + (YT1 - YT0) * j / NV for j in range(NV + 1)]
    G = [[bm.verts.new((xs[i], ys[j], top_z(xs[i], ys[j]))) for j in range(NV + 1)] for i in range(NU + 1)]
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]))
    ring_ij = boundary(NU, NV)
    rings = [[G[i][j] for i, j in ring_ij]]
    layers = []
    for i, j in ring_ij:
        x, y = xs[i], ys[j]; zt = top_z(x, y); dx, dy = side_of(i, j)
        wx, wy, zb = wall_point(x, y, dx, dy)
        h = zt - zb
        s = min(0.085, 0.55 * h)                      # shoulder drop: big rounded shoulder (Raybuck LH 5, RH 3)
        k = 0.90 if (dx < 0 or dy > 0) else 0.72      # defined shoulder line on the wall side and the cowl end (Raybuck LH 9, RH 9, RH 1-3)
        sx, sy = x + (wx - x) * k, y + (wy - y) * k
        fl = 0.030 if dx > 0 else 0.032               # flange widths: lip to the fender line, rail flange (b_jegs_1)
        if dy < 0 and dx == 0: fl = Y_FWALL - Y_FRONT  # front flange runs forward to the core support
        if dy > 0 and dx == 0: fl = 0.022
        fx = (X_LIP - X_OUT) if dx > 0 else (-fl if dx < 0 else 0)
        fy = -(Y_FWALL - Y_FRONT) if dy < 0 else (0.022 if dy > 0 else 0)
        cols = [
            (sx, sy, zt - 0.32 * s),                  # shoulder
            (wx, wy, zt - s),                         # wall top
            (wx, wy, zb + 0.35 * (zt - s - zb) + 0.012),
            (wx, wy, zb + 0.012),                     # bend support
            (wx + fx * 0.25, wy + fy * 0.25, zb),     # flange root
            (wx + fx, wy + fy, zb),                   # flange tip
        ]
        layers.append(cols)
    for k in range(6):
        rings.append([bm.verts.new(layers[n][k]) for n in range(len(ring_ij))])
    N = len(ring_ij)
    for a, b in zip(rings, rings[1:]):
        for n in range(N):
            m = (n + 1) % N
            bm.faces.new((a[n], a[m], b[m], b[n]))
    # creases live in the cage: the wall-to-dome shoulder line (ring 2) on the engine side and the cowl end, and the
    # dome's long diagonal fold toward the rear (Raybuck LH 9, RH 9, RH 12)
    cr = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    for n in range(N):
        m = (n + 1) % N; dxn, dyn = side_of(*ring_ij[n]); dxm, dym = side_of(*ring_ij[m])
        if (dxn < 0 and dxm < 0) or (dyn > 0 and dym > 0):
            e = bm.edges.get((rings[2][n], rings[2][m]))
            if e: e[cr] = 0.85
    for e in bm.edges:
        a, b = e.verts
        if a.co.z > 0.95 and b.co.z > 0.95 and fold_d(*((a.co + b.co) / 2)[:2]) < 0.02: e[cr] = 0.6
    # rear: the long holed leg down the cowl at the outboard corner, a channel with turned edges (b_jegs_1, Raybuck RH 1-3)
    yl = Y_RWALL + 0.004
    cols = [(0.600, yl + 0.018), (0.612, yl), (0.720, yl), (0.825, yl), (0.835, yl + 0.018)]
    zs = [0.44, 0.52, 0.60, 0.68, 0.76]
    L = [[bm.verts.new((x, y, z)) for (x, y) in cols] for z in zs]
    for r in range(len(zs) - 1):
        for c in range(len(cols) - 1):
            bm.faces.new((L[r][c], L[r][c + 1], L[r + 1][c + 1], L[r + 1][c]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("cage"); bm.to_mesh(me); bm.free()
    for p in me.polygons:
        if p.normal.z < -0.2 and p.center.z > 1.0: p.flip()
    return me


# ---- stamped detail, pressed into the subdivided sheet ---------------------------------------------------------------
def bump(d, w):
    return 0.5 + 0.5 * math.cos(math.pi * min(abs(d) / w, 1.0))


def stamp(me):
    me.update()
    for v in me.vertices:
        x, y, z = v.co; n = v.normal; off = 0.0
        # front flange: stamped stiffening ribs across it (Raybuck LH 1-5, b_oer_1 upper left)
        if y < Y_FWALL - 0.008 and abs(n.z) > 0.7:
            for k in range(7):
                xc = 0.47 + k * 0.055
                if abs(x - xc) < 0.012 and Y_FRONT + 0.012 < y < Y_FWALL - 0.012: off += 0.006 * bump(x - xc, 0.012)
        # outboard flange, front third: short ribs across the lip (b_oer_1 top edge, Raybuck RH 5-8)
        if x > X_OUT + 0.006 and y < -2.15:
            for k in range(6):
                yc = -2.40 + k * 0.045
                if abs(y - yc) < 0.009: off += 0.004 * bump(y - yc, 0.009)
        # shelf: the "+" stamped ribs and the shallow pan beside them (b_oer_1, mirrored to LH)
        if n.z > 0.85:
            cy, cx = -1.80, 0.640
            if abs(y - cy) < 0.10 and abs(x - cx) < 0.010: off += 0.004 * bump(x - cx, 0.010)
            if abs(x - cx) < 0.09 and abs(y - cy) < 0.010: off += 0.004 * bump(y - cy, 0.010)
            r = math.hypot((x - 0.650) / 0.085, (y - (-1.93)) / 0.075)
            if r < 1: off -= 0.008 * bump(r, 1.0)
        # rail flange: a long stiffening bead just above the bend (Raybuck RH 9-12)
        if abs(x - X_WALL) < 0.006 and abs(z - (Z_RAIL + 0.040)) < 0.010 and -2.40 < y < -1.50:
            off += 0.004 * bump(z - (Z_RAIL + 0.040), 0.010) * -1
        # engine-side wall: the long step bead at mid height that catches the highlight band (Raybuck LH 9, RH 9)
        if abs(x - X_WALL) < 0.01 and abs(n.x) > 0.7 and -2.42 < y < -1.48:
            zc = Z_RAIL + 0.20
            if abs(z - zc) < 0.025: off -= 0.007 * bump(z - zc, 0.025)
        # front bowl: the cup pocket pressed into the end face (Raybuck LH 1-5)
        if n.y < -0.8 and y < Y_FWALL + 0.06:
            r = math.hypot((x - 0.565) / 0.070, (z - 0.855) / 0.060)
            if r < 1: off -= 0.030 * bump(r, 1.0)
        # rear end panel: the diagonal crease across it (Raybuck RH 1-3, b_jegs_1)
        if n.y > 0.6 and y > Y_RWALL - 0.03:
            (x0, z0), (x1, z1) = (0.47, 0.70), (0.74, 0.99)
            dd = abs((x1 - x0) * (z0 - z) - (x0 - x) * (z1 - z0)) / math.hypot(x1 - x0, z1 - z0)
            if dd < 0.012 and x0 - 0.01 < x < x1 + 0.01: off -= 0.008 * bump(dd, 0.012)
        if off: v.co = v.co + n * off


HOLES = (  # clip/bolt holes: (x, y, z, axis, radius); from b_jegs_1, b_oer_1, b_jegs_7
    [(X_WALL - 0.020, -2.30 + k * 0.20, Z_RAIL, 'Z', 0.0045) for k in range(5)] +          # rail flange
    [(X_OUT + 0.016, y, lerp_tab(RIM, y), 'Z', 0.004) for y in (-2.33, -2.12, -1.90, -1.68, -1.56)] +   # fender lip
    [(0.48 + k * 0.11, Y_FRONT + 0.030, FRONT_BOT, 'Z', 0.005) for k in range(3)] +        # front flange
    [(0.62, Y_RWALL, 0.82, 'Y', 0.011)] +                                                    # rear end face, big round
    [(0.72, Y_RWALL + 0.004, 0.48 + k * 0.08, 'Y', 0.006) for k in range(3)] +             # holes down the leg
    [(0.62, -2.25, top_z(0.62, -2.25), 'Z', 0.0035), (0.70, -1.62, top_z(0.70, -1.62), 'Z', 0.0035)]  # shelf
)


def make_side(name, me_cage, sx, mat):
    me = me_cage.copy(); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    sub = ob.modifiers.new("sub", "SUBSURF"); sub.levels = sub.render_levels = 3
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="sub")
    stamp(ob.data)
    sol = ob.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.001; sol.offset = 0
    bpy.ops.object.modifier_apply(modifier="sol")
    cutters = []
    for (x, y, z, ax, r) in HOLES:
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=0.04, location=(x, y, z),
                                            rotation=(math.pi / 2, 0, 0) if ax == 'Y' else (0, 0, 0))
        cutters.append(bpy.context.object)
    for c in cutters: c.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]; bpy.ops.object.join(); cut = bpy.context.object
    b = ob.modifiers.new("holes", "BOOLEAN"); b.object = cut; b.operation = 'DIFFERENCE'; b.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="holes")
    bpy.data.objects.remove(cut)
    if sx < 0:
        ob.scale.x = -1; bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.flip_normals(); bpy.ops.object.mode_set(mode='OBJECT')
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.materials.append(mat)
    return ob


def paint():
    m = bpy.data.materials.new("satin_black"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.012, 0.012, 0.014, 1)
    b.inputs["Metallic"].default_value = 0.0; b.inputs["Roughness"].default_value = 0.35
    b.inputs["Coat Weight"].default_value = 0.25; b.inputs["Coat Roughness"].default_value = 0.15
    return m


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cage = build_cage(); mat = paint()
    make_side("inner_fender_L", cage, 1, mat); make_side("inner_fender_R", cage, -1, mat)
    bpy.data.meshes.remove(cage)
    if argv: bpy.ops.wm.save_as_mainfile(filepath=argv[0])
    if len(argv) > 1:   # web copy: decimated to keep the GLB under 2 MB; the .blend keeps the full sheet
        for o in [o for o in bpy.data.objects if o.type == 'MESH']:
            d = o.modifiers.new("dec", "DECIMATE"); d.ratio = 0.6
        bpy.ops.export_scene.gltf(filepath=argv[1], export_format='GLB', export_yup=True, export_apply=True,
                                  export_extras=False, export_draco_mesh_compression_enable=False,
                                  export_texcoords=False, export_cameras=False, export_lights=False)
    for o in bpy.data.objects:
        if o.type == 'MESH': print("BUILT", o.name, len(o.data.polygons), [round(v, 3) for v in o.dimensions])


if __name__ == "__main__":
    main()
