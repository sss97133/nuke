"""K5 1973-80 front inner fender (fender skirt), built against reference photos.

Run headless:  Blender -b -P inner_fender_sds.py -- <out.blend> [<out.glb>]
Twin metres: +x driver, -y forward, +z up. LH is built, RH is its mirror. The GLB is Y-up, (X,Y,Z) = (x, z, -y).

The part is four elements (receipt docs/wiring/receipts/2026-10-26_k5-inner-fender-sds.md names the photos):
1. DOME: a superellipsoid (round across, fuller along its length) cut by the rim plane, the bottom-flange plane and the
   two end planes; the inboard-upper part is kept. It has real curvature everywhere, so it reads as a pillow.
2. ARCH RIM: the dome's cut edge on the rim plane is the wheel arch. A short fillet strip (the shoulder line) steps out
   to a flange band in the fender plane with a rolled double bead. The band runs past the dome as a short front tail
   and as the holed leg down the cowl.
3. END PANELS: flat transverse panels close the dome. The rear one (at the cowl, i_bat_27) has the diagonal crease and
   one hole. The front one carries the stamped cup and turns into the ribbed front flange.
4. BOTTOM FLANGE: a flat strip off the dome's foot on the frame rail, with transverse ribs and holes about 150 mm apart.
Ends are set from the installed photos (i_bat_27, i_bat_15); the JEGS bare photos (a RH part) give shape.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

# ---- placement (agreed twin anchors) -------------------------------------------------------------------------------
X_RIM = 0.858         # fender plane: the rim flange bolts under the outer fender's lip
X_CUT = 0.835         # dome's outboard cut; the fillet strip steps from here out to X_RIM (b_jegs_7 shoulder line)
Z_RAIL = 0.620        # bottom flange on the frame rail
Y_FRONT = -2.505      # front tail and front flange end at the core support's rear face
Y_REAR = -1.440       # rear leg end at the cowl
MM_PX = (Y_REAR - Y_FRONT) / 1460          # b_jegs_7 scale from the tail-to-tail span, 0.73 mm/px
Y_REND = Y_REAR - 220 * MM_PX              # rear end panel (b_jegs_7 dome silhouette, col 240), y -1.601
Y_FEND = Y_REAR - 1270 * MM_PX             # front end panel (col 1290), y -2.367

# ---- dome: superellipsoid |x/A|^2 + |y/B|^4 + |z/C|^2 = 1 about (XC, YC, Z_RAIL) --------------------------------------
# A, XC: the engine-side face is vertical at x 0.42 at the rail and the cut at X_CUT lies at u = 0.8 across,
#        sits at U_CUT across. C 0.34 gives crown 0.96: under the point-matched b_jegs_7 camera, a taller dome
#        forces the camera below the rim (it would see into the wheel well, which the photo does not).
# B, YC: the arch closes at about the front end panel (rim z ~0.69 there) and stands at ~0.80 at the rear panel,
#        as traced in b_jegs_7; YC puts the apex 0.05 m behind CF.FA_Y (-1.896).
C = 0.340
U_CUT = (1 - (0.24 / C) ** 2) ** 0.5   # where the rim plane cuts across, so the arch apex is z 0.86
A = (X_CUT - 0.420) / (1 + U_CUT)
XC = 0.420 + A
B = 0.550
YC = -1.950
P_Y = 4.0             # exponent along y: >2 keeps the dome full and high toward both ends (Raybuck LH 9, b_jegs_3)


def dome_mesh(bm):
    res = bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=72, radius=1.0)
    for v in res['verts']:
        x, y, z = v.co.y, v.co.z, v.co.x          # sphere poles on +-y
        ys = math.copysign(abs(y) ** (2.0 / P_Y), y)
        v.co = Vector((XC + A * x, YC + B * ys, Z_RAIL + C * z))     # x^2 + ys^4 + z^2 = 1
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    for co, no, inner in (((0, 0, Z_RAIL), (0, 0, 1), True), ((X_CUT, 0, 0), (1, 0, 0), False),
                          ((0, Y_FEND, 0), (0, 1, 0), True), ((0, Y_REND, 0), (0, 1, 0), False)):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no,
                                   clear_inner=inner, clear_outer=not inner, dist=1e-6)


def boundary(bm, pred):
    return [v for v in bm.verts if v.is_boundary and pred(v.co)]


# ---- traced tails (b_jegs_7 rim lower edge, rear = image left for this RH part) -------------------------------------
RIM_PX = [(20, 650), (60, 580), (110, 470), (160, 400), (210, 340), (1250, 480), (1320, 520), (1400, 560), (1480, 590)]
TAIL = sorted((Y_REAR - (c - 20) * MM_PX, 1.080 - (r - 22) * MM_PX) for c, r in RIM_PX)
BAND = 0.036          # flange band height below the shoulder (b_jegs_7 ~45 px)


def lerp(tab, y):
    if y <= tab[0][0]: return tab[0][1]
    if y >= tab[-1][0]: return tab[-1][1]
    for (y0, z0), (y1, z1) in zip(tab, tab[1:]):
        if y0 <= y <= y1: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


def build():
    bm = bmesh.new()
    dome_mesh(bm)
    bm.verts.ensure_lookup_table()
    eps = 1e-4
    arc = sorted(boundary(bm, lambda c: abs(c.x - X_CUT) < eps and c.z > Z_RAIL + eps), key=lambda v: v.co.y)
    foot = sorted(boundary(bm, lambda c: abs(c.z - Z_RAIL) < eps and c.x < X_CUT - eps), key=lambda v: v.co.y)
    ends = {}
    for name, yy in (("front", Y_FEND), ("rear", Y_REND)):
        sec = boundary(bm, lambda c, yy=yy: abs(c.y - yy) < eps)
        ends[name] = sorted(sec, key=lambda v: math.atan2(v.co.z - Z_RAIL, -(v.co.x - XC)))   # inboard foot -> rim
    # 2. fillet strip and rim band: rows at the arc points, then tails
    def band_col(y, z_top, low_extra=0.0):
        return [Vector((X_RIM - 0.006, y, z_top - 0.006)), Vector((X_RIM, y, z_top - 0.014))] + \
               [Vector((X_RIM + (0.0025 if k in (1, 3) else 0.0), y, z_top - 0.014 - (BAND + low_extra) * k / 5))
                for k in range(1, 6)]
    cols = [[v] + [bm.verts.new(p) for p in band_col(v.co.y, v.co.z)] for v in arc]
    y0, z0 = arc[0].co.y, arc[0].co.z           # front tail: arc's front end down to the core support
    front = []
    for k in range(1, 5):
        y = y0 + (Y_FRONT - y0) * k / 4; zt = z0 + (lerp(TAIL, Y_FRONT) + BAND - z0) * k / 4
        front.append([bm.verts.new(p) for p in [Vector((X_CUT, y, zt + 0.004))] + band_col(y, zt)])
    y1, z1 = arc[-1].co.y, arc[-1].co.z         # rear: the holed leg down the cowl to the rail (b_jegs_7, b_jegs_1)
    rear = []
    for k in range(1, 6):
        y = y1 + (Y_REAR - y1) * k / 5; zt = z1 + (lerp(TAIL, Y_REAR) + BAND - z1) * k / 5
        rear.append([bm.verts.new(p) for p in [Vector((X_CUT, y, zt + 0.004))] + band_col(y, zt, 0.045 * k / 5)])
    allc = front[::-1] + cols + rear
    for a, b in zip(allc, allc[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
    # 3. end panels: grid from the dome section to the chord (inboard foot -> band bottom), flat in the end plane
    panel_rows = {}
    for name, sec in ends.items():
        bottom = cols[0][-1] if name == "front" else cols[-1][-1]
        ring = sec + [cols[0][1] if name == "front" else cols[-1][1], bottom]
        p0, p1 = ring[0].co.copy(), ring[-1].co.copy()
        rows = [ring]; n = len(ring)
        for k in range(1, 8):
            t = k / 8; r = []
            for j, v in enumerate(ring):
                if j in (0, n - 1): r.append(v); continue
                ch = p0.lerp(p1, j / (n - 1)); q = v.co.lerp(ch, t if k < 7 else 0.985); q.y = v.co.y
                r.append(bm.verts.new(q))
            rows.append(r)
        for ra, rb in zip(rows, rows[1:]):
            for j in range(n - 1):
                u = []
                for v in (ra[j], ra[j + 1], rb[j + 1], rb[j]):
                    if v not in u: u.append(v)
                if len(u) >= 3:
                    try: bm.faces.new(u)
                    except ValueError: pass
        panel_rows[name] = rows
    # front flange: from the front panel's chord forward, flat, to the core support (b_jegs_3, b_jegs_5)
    chord = panel_rows["front"][-1]
    fz = chord_z(chord)
    prev = chord
    for k in (1, 2):
        y = Y_FEND + (Y_FRONT - Y_FEND) * k / 2
        cur = [bm.verts.new((v.co.x, y, v.co.z)) for v in prev]
        for j in range(len(cur) - 1): bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
        prev = cur
    # 4. bottom flange along the dome's foot, inboard and flat on the rail
    out = [bm.verts.new((v.co.x - 0.036, v.co.y, Z_RAIL)) for v in foot]
    for j in range(len(foot) - 1): bm.faces.new((foot[j], foot[j + 1], out[j + 1], out[j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # rear panel: the diagonal crease from the top shoulder down toward the leg (b_jegs_1)
    for v in bm.verts:
        if abs(v.co.y - Y_REND) < 1e-4:
            (x0, z0_), (x1_, z1_) = (0.52, 0.97), (0.80, 0.70)
            dd = abs((x1_ - x0) * (z0_ - v.co.z) - (x0 - v.co.x) * (z1_ - z0_)) / math.hypot(x1_ - x0, z1_ - z0_)
            if dd < 0.012 and x0 - 0.01 < v.co.x < x1_ + 0.01: v.co.y -= 0.007 * (0.5 + 0.5 * math.cos(math.pi * dd / 0.012))
    me = bpy.data.meshes.new("skirt"); bm.to_mesh(me); bm.free()
    return me, fz


def chord_z(chord):
    pts = sorted((v.co.x, v.co.z) for v in chord)
    return lambda x: lerp(pts, x)


def beads(fz):
    """front-flange ribs and bottom-flange ribs: small bevelled bars laid on the flanges, joined to the part."""
    obs = []
    for k in range(7):                       # front flange, b_jegs_3 lower right
        x = 0.47 + k * 0.058
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, (Y_FEND + Y_FRONT) / 2, fz(x) + 0.002))
        o = bpy.context.object; o.scale = (0.010, 0.10, 0.006); obs.append(o)
    for k in range(10):                      # bottom flange, b_jegs_5 lower edge
        y = -2.30 + k * 0.075
        x = XC - A * max(0.0, 1 - ((y - YC) / B) ** 4) ** 0.5 - 0.018
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, Z_RAIL + 0.002))
        o = bpy.context.object; o.scale = (0.026, 0.009, 0.006); obs.append(o)
    for o in obs:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(scale=True)
        m = o.modifiers.new("bv", "BEVEL"); m.width = 0.0025; m.segments = 3
        bpy.ops.object.modifier_apply(modifier="bv")
    return obs


def cup(fz):
    """the stamped round cup on the front panel just above the flange: a ~100 mm dish (b_jegs_3, b_jegs_5)."""
    x, z = 0.68, fz(0.68) + 0.075
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.050, depth=0.030, location=(x, Y_FEND + 0.015, z),
                                        rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y < -0.9], context='FACES')   # open toward the front
    bm.to_mesh(o.data); bm.free()
    m = o.modifiers.new("bv", "BEVEL"); m.width = 0.008; m.segments = 4; m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier="bv")
    return o, (x, Y_FEND, z)


def holes(fz):
    H = [(XC - A * max(0.0, 1 - ((y - YC) / B) ** 4) ** 0.5 - 0.024, y, Z_RAIL, 'Z', 0.0045)
         for y in (-2.30, -2.15, -2.00, -1.85, -1.70)]                                       # bottom flange, ~150 mm
    H += [(X_RIM, y, None, 'X', 0.004) for y in (-2.20, -1.95, -1.75)]                       # rim band
    H += [(X_RIM, -1.48, None, 'L', 0.009)]                                                  # leg's big hole
    H += [(0.64, Y_REND, 0.84, 'Y', 0.0065), (0.60, Y_FEND, fz(0.60) + 0.07, 'Y', 0.005)]   # rear panel, by the cup
    H += [(x, (Y_FEND + Y_FRONT) / 2, fz(x), 'Z', 0.0045) for x in (0.50, 0.64, 0.79)]      # front flange
    H += [(0.66, -2.14, Z_RAIL + C * (1 - ((0.66 - XC) / A) ** 2 - ((-2.14 - YC) / B) ** 4) ** 0.5, 'Z', 0.0035)]
    return H


def make(mat):
    me, fz = build()
    ob = bpy.data.objects.new("inner_fender_L", me); bpy.context.scene.collection.objects.link(ob)
    parts = beads(fz); c, cpos = cup(fz); print('FEAT cup', [round(t, 3) for t in cpos])
    sol = ob.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.001; sol.offset = 0
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier="sol")
    # cut the cup's opening, then hang the dish in it
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.046, depth=0.03, location=cpos, rotation=(math.pi / 2, 0, 0))
    cutters = [bpy.context.object]
    rot = {'X': (0, math.pi / 2, 0), 'L': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}
    for (x, y, z, ax, r) in holes(fz):
        if z is None:
            near = [v.co.z for v in me.vertices if abs(v.co.x - X_RIM) < 0.001 and abs(v.co.y - y) < 0.01]
            z = (min(near) + max(near)) / 2 if near else 0.75
            if ax == 'L': z = min(near) + 0.02 if near else 0.65
        print("FEAT hole", ax, round(x, 3), round(y, 3), round(z, 3))
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=r, depth=0.05, location=(x, y, z), rotation=rot[ax])
        cutters.append(bpy.context.object)
    bpy.ops.object.select_all(action='DESELECT')
    for o in cutters: o.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]; bpy.ops.object.join(); cut = bpy.context.object
    b = ob.modifiers.new("holes", "BOOLEAN"); b.object = cut; b.operation = 'DIFFERENCE'; b.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier="holes")
    bpy.data.objects.remove(cut)
    s2 = c.modifiers.new("sol", "SOLIDIFY"); s2.thickness = 0.001
    bpy.context.view_layer.objects.active = c; bpy.ops.object.modifier_apply(modifier="sol")
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts + [c, ob]: o.select_set(True)
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.join()
    bv = ob.modifiers.new("edges", "BEVEL"); bv.width = 0.0025; bv.segments = 2; bv.limit_method = 'ANGLE'
    bv.angle_limit = math.radians(30); bv.use_clamp_overlap = True       # flange edges catch a highlight
    bpy.ops.object.modifier_apply(modifier="edges")
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    ob.data.materials.append(mat)
    R = ob.copy(); R.data = ob.data.copy(); R.name = "inner_fender_R"; bpy.context.scene.collection.objects.link(R)
    bpy.ops.object.select_all(action='DESELECT'); R.select_set(True); bpy.context.view_layer.objects.active = R
    R.scale.x = -1; bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob, R


def paint():
    m = bpy.data.materials.new("satin_black"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.13, 0.13, 0.135, 1)   # satin dark grey, shared with core support and firewall
    b.inputs["Metallic"].default_value = 0.0; b.inputs["Roughness"].default_value = 0.35
    b.inputs["Coat Weight"].default_value = 0.25; b.inputs["Coat Roughness"].default_value = 0.15
    return m


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make(paint())
    if argv: bpy.ops.wm.save_as_mainfile(filepath=argv[0])
    if len(argv) > 1:
        for o in [o for o in bpy.data.objects if o.type == 'MESH']:
            d = o.modifiers.new("dec", "DECIMATE"); d.ratio = 0.6
        bpy.ops.export_scene.gltf(filepath=argv[1], export_format='GLB', export_yup=True, export_apply=True,
                                  export_extras=False, export_draco_mesh_compression_enable=False,
                                  export_texcoords=False, export_cameras=False, export_lights=False)
    for o in bpy.data.objects:
        if o.type == 'MESH': print("BUILT", o.name, len(o.data.polygons), [round(v, 3) for v in o.dimensions])


if __name__ == "__main__":
    main()
