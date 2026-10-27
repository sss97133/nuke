"""K5 1973-80 front inner fender (fender skirt), sculpted as a subdivision surface against reference photos.

Run headless:  Blender -b -P inner_fender_sds.py -- <out.blend> [<out.glb>]
Twin metres: +x driver, -y forward, +z up. LH is built, RH is its mirror. The GLB is Y-up, (X,Y,Z) = (x, z, -y).

Built as the four elements the JEGS product photos show (receipt docs/wiring/receipts/2026-10-26_k5-inner-fender-sds.md):
1. ARCH RIM (b_jegs_7): a flange in the fender plane following the wheel arc, a rolled double bead along it, running
   past the dome as a short tail at the front and a long flat bolt leg at the rear (the cowl leg).
2. DOME (b_jegs_3, b_jegs_1): a pillowed quarter-dome stepping inboard off the rim at a shoulder line, peak forward of the
   arc centre, its engine-side face running down nearly vertical to the bottom flange.
3. END PANELS (b_jegs_1 rear; b_jegs_3, b_jegs_5 front): a flat transverse rear panel with a diagonal crease and one
   hole; a lower front end with a stamped round cup and a hole beside it.
4. BOTTOM FLANGE (b_jegs_3, b_jegs_5): flat along the engine-side bottom edge, a dozen transverse ribs, holes ~150 mm.
The cage is placed by hand from the traced curves below; Catmull-Clark level 3 with creased loops rounds it; beads, ribs,
the cup and the panel crease are pressed into the subdivided sheet; solidify 1 mm; holes by boolean.
"""
import bpy, bmesh, math, sys

# ---- placement (agreed twin anchors) -------------------------------------------------------------------------------
X_RIM = 0.858         # rim flange plane: the fender plane, under the outer fender's lip
X_WALL = 0.420        # engine-side face of the dome
Z_RAIL = 0.620        # bottom flange on the frame rail
Y_FRONT = -2.505      # front tail and bottom flange end at the core support's rear face
Y_REAR = -1.440       # rear leg end at the cowl

# ---- traced curves ---------------------------------------------------------------------------------------------------
# b_jegs_7 (1500 x 660 px, LH, from outboard and a little above: the dome's convex top shows above the rim, so image
# left = front; the steep left tail drops to the core support, the long flat right tail is the cowl leg). Scale 0.73 mm/px from the tail-to-tail span (1460 px = Y_REAR - Y_FRONT). Heights from the same
# scale, hung from the dome top at z 1.080: the photo's tail-tip-to-dome-top height (628 px = 0.46 m) is the OER T70124
# box height (18 in) over the rail flange, so the tails end at the rail and the rim apex lands at z 0.86.
# Rim = lower edge of the flange band, (px column, px row):
RIM_PX = [(20, 650), (60, 580), (110, 470), (160, 400), (210, 340), (260, 320), (400, 330), (600, 345), (800, 365),
          (1000, 400), (1150, 440), (1250, 480), (1320, 520), (1400, 560), (1480, 590)]
MM_PX = (Y_REAR - Y_FRONT) / 1460


def px_y(c): return Y_FRONT + (c - 20) * MM_PX


RIM = sorted((px_y(c), 1.080 - (r - 22) * MM_PX) for c, r in RIM_PX)
# dome top silhouette in the same photo, (column, row)
DOME_PX = [(240, 240), (300, 200), (400, 60), (550, 30), (700, 22), (900, 35), (1000, 70), (1150, 120), (1240, 250),
           (1290, 330)]
DOME = sorted((px_y(c), 1.080 - (r - 22) * MM_PX) for c, r in DOME_PX)
Y_FEND = px_y(240)    # front end panel (dome silhouette's front end in _7), y -2.344
Y_REND = px_y(1290)   # rear end panel plane (dome's rear end), y -1.578
BAND = 0.035          # rim flange band height (b_jegs_7: ~45 px)


def lerp(tab, y):
    if y <= tab[0][0]: return tab[0][1]
    if y >= tab[-1][0]: return tab[-1][1]
    for (y0, z0), (y1, z1) in zip(tab, tab[1:]):
        if y0 <= y <= y1: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


def section(y):
    """(x, z) LH from the rim's arch edge round the dome to the bottom flange tip, and per-point crease weights."""
    zr = lerp(RIM, y); zt = max(lerp(DOME, y), zr + 0.07)
    zf = min(0.80 + 0.06 * max(0.0, min(1.0, (zt - 0.90) / 0.18)), zt - 0.12)          # where the engine-side face goes vertical
    pts = [
        (X_RIM, zr), (X_RIM, zr + 0.5 * BAND), (X_RIM, zr + BAND),            # flange band in the fender plane
        (X_RIM - 0.024, zr + BAND + 0.012),                                   # step: the shoulder line (b_jegs_7)
        (X_RIM - 0.040, zr + 0.45 * (zt - zr) + 0.02),                        # outboard flank of the dome
        (0.77, zt - 0.025), (0.66, zt), (0.54, zt - 0.025),                   # pillowed crown
        (0.455, zt - 0.10),                                                   # roll onto the engine-side face
        (X_WALL + 0.004, zf), (X_WALL, Z_RAIL + 0.05), (X_WALL, Z_RAIL + 0.008),   # near-vertical face, bend
        (X_WALL - 0.015, Z_RAIL), (X_WALL - 0.040, Z_RAIL),                   # bottom flange
    ]
    crease = {2: 0.9, 3: 0.7, 11: 0.8}                                        # band top, shoulder, flange bend
    return pts, crease


NS = 14
STATIONS = [Y_FEND + (Y_REND - Y_FEND) * i / (NS - 1) for i in range(NS)]


def build_cage():
    bm = bmesh.new()
    cr = bm.edges.layers.float.new('crease_edge')
    rows = []
    for y in STATIONS:
        pts, crease = section(y)
        rows.append([bm.verts.new((x, y, z)) for x, z in pts])
    npt = len(rows[0])
    for a, b in zip(rows, rows[1:]):
        for i in range(npt - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    _, crease = section(STATIONS[0])
    for a, b in zip(rows, rows[1:]):
        for i, w in crease.items():
            e = bm.edges.get((a[i], b[i]))
            if e: e[cr] = w

    def panel(row, y, sign):
        """flat transverse end panel: the section closed by its chord from the shoulder to the flange bend."""
        sec = row[3:12]; p0, p1 = sec[0].co.copy(), sec[-1].co.copy()
        n = len(sec); grid = [sec]
        for k in (1, 2, 3):
            t = k / 4
            r = []
            for j, v in enumerate(sec):
                if j in (0, n - 1): r.append(v); continue
                ch = p0.lerp(p1, j / (n - 1))
                r.append(bm.verts.new(v.co.lerp(ch, t) if k < 3 else v.co.lerp(ch, 0.96)))
            grid.append(r)
        for ra, rb in zip(grid, grid[1:]):
            for j in range(n - 1):
                q = [ra[j], ra[j + 1], rb[j + 1], rb[j]]
                u = []
                for v in q:
                    if v not in u: u.append(v)
                if len(u) >= 3: bm.faces.new(u if sign > 0 else u[::-1])
        for j in range(n - 1):      # crease the panel's boundary with the dome: the end shoulder
            e = bm.edges.get((sec[j], sec[j + 1]))
            if e: e[cr] = 0.55
        # band below the shoulder closes down to the arch edge in the panel plane
        bm.faces.new((row[0], row[1], row[2], row[3]) if sign > 0 else (row[3], row[2], row[1], row[0]))

    panel(rows[-1], Y_REND, 1)
    panel(rows[0], Y_FEND, -1)

    def tail(row, y_to, n, extra_low=0.0):
        """rim band (and, at the front, the bottom flange) carried past the dome to y_to along the arch."""
        prev = [row[0], row[1], row[2]]
        y0 = row[0].co.y
        for k in range(1, n + 1):
            y = y0 + (y_to - y0) * k / n; zr = lerp(RIM, y)
            cur = [bm.verts.new((X_RIM, y, zr - extra_low)), bm.verts.new((X_RIM, y, zr + 0.5 * BAND)),
                   bm.verts.new((X_RIM, y, zr + BAND))]
            for i in range(2): bm.faces.new((prev[i], prev[i + 1], cur[i + 1], cur[i]))
            prev = cur

    tail(rows[-1], Y_REAR, 4, extra_low=0.025)     # the long flat bolt leg to the cowl (b_jegs_7 right, b_jegs_1)
    tail(rows[0], Y_FRONT, 3)                      # the short front tail
    prev = rows[0][10:]                            # bottom flange runs on to the core support (b_jegs_3, _5)
    for k in (1, 2):
        y = Y_FEND + (Y_FRONT - Y_FEND) * k / 2
        cur = [bm.verts.new((v.co.x, y, v.co.z)) for v in prev]
        for i in range(len(cur) - 1): bm.faces.new((prev[i], prev[i + 1], cur[i + 1], cur[i]))
        prev = cur
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("cage"); bm.to_mesh(me); bm.free()
    return me


# ---- stamped detail, pressed into the subdivided sheet ---------------------------------------------------------------
def bump(d, w):
    return 0.5 + 0.5 * math.cos(math.pi * min(abs(d) / w, 1.0))


def stamp(me):
    me.update()
    for v in me.vertices:
        x, y, z = v.co; n = v.normal; off = 0.0
        # rim: rolled double bead along the band (b_jegs_7, b_jegs_3)
        if x > X_RIM - 0.004 and abs(n.x) > 0.7:
            zr = lerp(RIM, y)
            for zc in (zr + 0.010, zr + 0.024):
                if abs(z - zc) < 0.006: off += 0.0035 * bump(z - zc, 0.006)
        # bottom flange: a dozen short transverse stiffening ribs (b_jegs_3 lower right, b_jegs_5)
        if x < X_WALL - 0.008 and z < Z_RAIL + 0.004 and abs(n.z) > 0.7:
            for k in range(12):
                yc = -2.47 + k * 0.074
                if abs(y - yc) < 0.007: off += 0.004 * bump(y - yc, 0.007)
        # front end: the stamped round cup, ~100 mm, near the bottom (b_jegs_3, b_jegs_5)
        if n.y < -0.6 and y < Y_FEND + 0.05:
            r = math.hypot((x - 0.50) / 0.050, (z - 0.74) / 0.050)
            if r < 1: off -= 0.025 * bump(r, 1.0)
        # rear panel: the diagonal crease from the top shoulder down toward the leg (b_jegs_1)
        if n.y > 0.6 and y > Y_REND - 0.03:
            (x0, z0), (x1, z1) = (0.52, 0.99), (0.80, 0.80)
            dd = abs((x1 - x0) * (z0 - z) - (x0 - x) * (z1 - z0)) / math.hypot(x1 - x0, z1 - z0)
            if dd < 0.010 and x0 - 0.01 < x < x1 + 0.01: off -= 0.007 * bump(dd, 0.010)
        if off: v.co = v.co + n * off


HOLES = (  # (x, y, z, axis, radius)
    [(X_WALL - 0.027, -2.46 + k * 0.15, Z_RAIL, 'Z', 0.0045) for k in range(6)] +          # bottom flange, ~150 mm
    [(X_RIM, y, lerp(RIM, y) + 0.017, 'X', 0.004) for y in (-2.30, -2.05, -1.80)] +        # rim band (b_jegs_7, _5)
    [(X_RIM, -1.50, lerp(RIM, -1.50) + 0.005, 'X', 0.0055)] +                             # the leg's hole (b_jegs_1)
    [(0.64, Y_REND, 0.86, 'Y', 0.0065)] +                                                   # rear panel, mid height
    [(0.575, Y_FEND, 0.72, 'Y', 0.005)] +                                                   # beside the cup
    [(0.66, -1.95, lerp(DOME, -1.95), 'Z', 0.0035)]                                         # crown hole (b_jegs_7)
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
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}
    for (x, y, z, ax, r) in HOLES:
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=0.04, location=(x, y, z), rotation=rot[ax])
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
