"""K5 1973-80 front inner fender (fender skirt), built against reference photos.

Run headless:  Blender -b -P inner_fender_sds.py -- <out.blend> [<out.glb>]
Twin metres: +x driver, -y forward, +z up. LH is built, RH is its mirror. The GLB is Y-up, (X,Y,Z) = (x, z, -y).

The part is four elements (receipt docs/wiring/receipts/2026-10-26_k5-inner-fender-sds.md names the photos):
1. DOME: a true ellipsoid octant (semi-axes 0.42 along, 0.40 across, 0.34 up) centred on the rim plane and the rail
   plane, kept inboard and above, cut only by the rear panel plane. Its section in the rim plane is the wheel arch;
   the front is not cut and runs down into the front flange zone.
2. ARCH RIM: a short fillet strip (the shoulder line) steps from the arch out to a flange band in the fender plane
   with a rolled double bead; the band runs on as the holed leg down the cowl, widened into the rear panel.
3. REAR PANEL (at the cowl, i_bat_27): flat, closing the dome's slice down to the rail, with the diagonal crease and
   one hole. The front carries the stamped cup (a bevelled dish set into the dome's lower front).
4. FLANGE: flat on the rail from the dome's footprint out to a straight inboard edge (x 0.38) and, in front, to the
   core-support line, with bevelled rib bars and holes about 150 mm apart.
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

# ---- dome: a true ellipsoid octant ----------------------------------------------------------------------------------
# Semi-axes along the truck SA 0.42, across SB 0.40, up SC 0.34, centred on the rim plane at the solved arch apex
# station (CF.FA_Y - 0.05) and on the rail plane. Kept: inboard of the rim plane, above the rail, forward of the rear
# panel. The arch edge is its section in the rim plane (crown z 0.96 at the rim); the front is not cut, so it runs down
# into the front flange zone (b_jegs_3); the rear panel cuts a slice at the cowl end (b_jegs_1).
SA, SB, SC = 0.42, 0.40, 0.34
YC = -1.896 - 0.05


def dome_mesh(bm):
    res = bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=1.0)
    for v in res['verts']:
        v.co = Vector((X_CUT + SB * v.co.x, YC + SA * v.co.y, Z_RAIL + SC * v.co.z))
    for co, no, inner in (((0, 0, Z_RAIL), (0, 0, 1), True), ((X_CUT, 0, 0), (1, 0, 0), False),
                          ((0, Y_REND, 0), (0, 1, 0), False)):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no,
                               clear_inner=inner, clear_outer=not inner, dist=1e-6)


def dome_z(x, y):
    q = 1 - ((x - X_CUT) / SB) ** 2 - ((y - YC) / SA) ** 2
    return Z_RAIL + SC * math.sqrt(max(q, 0.0))


def boundary(bm, pred):
    return [v for v in bm.verts if v.is_boundary and pred(v.co)]


# ---- traced tails (b_jegs_7 rim lower edge, rear = image left for this RH part) -------------------------------------
RIM_PX = [(20, 650), (60, 580), (110, 470), (160, 400), (210, 340), (1250, 480), (1320, 520), (1400, 560), (1480, 590)]
TAIL = sorted((Y_REAR - (c - 20) * MM_PX, 1.080 - (r - 22) * MM_PX) for c, r in RIM_PX)
BAND = 0.036          # flange band height below the shoulder (b_jegs_7 ~45 px)
X_FLANGE = 0.380      # straight inboard edge of the rail flange (b_jegs_5 lower edge is straight)


def lerp(tab, y):
    if y <= tab[0][0]: return tab[0][1]
    if y >= tab[-1][0]: return tab[-1][1]
    for (y0, z0), (y1, z1) in zip(tab, tab[1:]):
        if y0 <= y <= y1: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


def build():
    bm = bmesh.new()
    dome_mesh(bm)
    eps = 1e-4
    arc = sorted(boundary(bm, lambda c: abs(c.x - X_CUT) < eps and c.z > Z_RAIL + eps), key=lambda v: v.co.y)
    foot = boundary(bm, lambda c: abs(c.z - Z_RAIL) < eps and c.y < Y_REND - eps)
    foot.sort(key=lambda v: math.atan2(v.co.y - YC, -(v.co.x - X_CUT)))     # front tip -> inboard -> rear
    sec = sorted(boundary(bm, lambda c: abs(c.y - Y_REND) < eps), key=lambda v: v.co.x)   # rear section, inboard first
    # rim: fillet strip out to the fender plane, then the beaded band; its bottom stays above the flanges
    def band_col(y, z_top, low_extra=0.0):
        zb = max(z_top - 0.014 - BAND - low_extra, Z_RAIL + 0.012)
        ztop = max(z_top - 0.014, zb + 0.010)
        return [Vector((X_RIM - 0.006, y, z_top - 0.006)), Vector((X_RIM, y, ztop))] + \
               [Vector((X_RIM + (0.0025 if k in (1, 3) else 0.0), y, ztop + (zb - ztop) * k / 5)) for k in range(1, 6)]
    cols = [[v] + [bm.verts.new(p) for p in band_col(v.co.y, max(v.co.z, Z_RAIL + 0.03))] for v in arc]
    y1, z1 = arc[-1].co.y, arc[-1].co.z         # rear: the holed leg down the cowl, widening (b_jegs_7, b_jegs_1)
    rear = []
    for k in range(1, 6):
        y = y1 + (Y_REAR - y1) * k / 5; zt = z1 + (lerp(TAIL, Y_REAR) + BAND + 0.02 - z1) * k / 5
        rear.append([bm.verts.new(p) for p in [Vector((X_CUT, y, zt + 0.004))] + band_col(y, zt, 0.06 * k / 5)])
    allc = cols + rear
    for a, b in zip(allc, allc[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
    # rear panel: the dome's section closed down to the rail and out to the band, a flat grid with the crease
    ring = sec + [cols[-1][1], cols[-1][-1]]
    p0 = Vector((sec[0].co.x, Y_REND, Z_RAIL)); p1 = ring[-1].co.copy()
    rows = [ring]; n = len(ring)
    for k in range(1, 9):
        t = k / 8; r = []
        for j, v in enumerate(ring):
            if j == n - 1 or (j == 0 and k == 8): r.append(v if j == n - 1 else bm.verts.new(p0)); continue
            ch = p0.lerp(p1, j / (n - 1)); q = v.co.lerp(ch, t); q.y = Y_REND; r.append(bm.verts.new(q))
        rows.append(r)
    for ra, rb in zip(rows, rows[1:]):
        for j in range(n - 1):
            u = []
            for v in (ra[j], ra[j + 1], rb[j + 1], rb[j]):
                if v not in u: u.append(v)
            if len(u) >= 3:
                try: bm.faces.new(u)
                except ValueError: pass
    # leg plate: the leg widened into the rear panel (b_jegs_1), in the panel plane below the band
    xs = [0.70, 0.76, 0.81, X_RIM]; zs = [Z_RAIL - 0.045, Z_RAIL + 0.03, Z_RAIL + 0.11]
    G = [[bm.verts.new((x, Y_REND + 0.002, z)) for x in xs] for z in zs]
    for a, b in zip(G, G[1:]):
        for i in range(len(xs) - 1): bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    # flat flange on the rail: from the dome's foot out to a straight inboard edge and the core-support line in front
    out = []
    for v in foot:
        dx, dy = v.co.x - X_CUT, v.co.y - YC
        tx = (X_FLANGE - X_CUT) / dx if dx < -1e-9 else 1e9
        ty = (Y_FRONT - YC) / dy if dy < -1e-9 else 1e9
        t = min(tx, ty)
        out.append(bm.verts.new((max(X_CUT + dx * t, X_FLANGE), min(max(YC + dy * t, Y_FRONT), Y_REND), Z_RAIL)))
    mid = [bm.verts.new(v.co.lerp(o.co, 0.5)) for v, o in zip(foot, out)]
    for a, b in ((foot, mid), (mid, out)):
        for j in range(len(a) - 1):
            try: bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
            except ValueError: pass
    # the flange runs on along the rail behind the dome's foot to the rear panel
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for v in bm.verts:            # rear panel: the diagonal crease from the top shoulder down toward the leg (b_jegs_1)
        if abs(v.co.y - Y_REND) < 1e-4:
            (x0, z0_), (x1_, z1_) = (0.63, 0.80), (0.80, 0.64)
            dd = abs((x1_ - x0) * (z0_ - v.co.z) - (x0 - v.co.x) * (z1_ - z0_)) / math.hypot(x1_ - x0, z1_ - z0_)
            if dd < 0.012 and x0 - 0.01 < v.co.x < x1_ + 0.01: v.co.y -= 0.007 * (0.5 + 0.5 * math.cos(math.pi * dd / 0.012))
    me = bpy.data.meshes.new("skirt"); bm.to_mesh(me); bm.free()
    return me, (lambda x: Z_RAIL)


def beads(fz):
    """front-flange ribs and rail-flange ribs: small bevelled bars laid on the flat flange, joined to the part."""
    obs = []
    for k in range(7):                       # front flange zone, b_jegs_3 lower right
        x = 0.47 + k * 0.058
        yf = YC - SA * math.sqrt(max(1 - ((x - X_CUT) / SB) ** 2, 0.0))
        yl = (Y_FRONT + 0.012 + yf - 0.012) / 2; ln = max(yf - 0.012 - Y_FRONT - 0.012, 0.02)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, yl, Z_RAIL + 0.002))
        o = bpy.context.object; o.scale = (0.010, ln, 0.006); obs.append(o)
    for k in range(8):                       # rail flange, b_jegs_5 lower edge
        y = -2.10 + k * 0.065
        xf = X_CUT - SB * math.sqrt(max(1 - ((y - YC) / SA) ** 2, 0.0))
        bpy.ops.mesh.primitive_cube_add(size=1, location=((X_FLANGE + 0.008 + xf) / 2, y, Z_RAIL + 0.002))
        o = bpy.context.object; o.scale = (max(xf - X_FLANGE - 0.02, 0.02), 0.009, 0.006); obs.append(o)
    for o in obs:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(scale=True)
        m = o.modifiers.new("bv", "BEVEL"); m.width = 0.0025; m.segments = 3
        bpy.ops.object.modifier_apply(modifier="bv")
    return obs


CUP = (0.68, 0.70)    # cup centre (x, z) on the dome's lower front (b_jegs_3, b_jegs_5), ~100 mm across


def cup_frame():
    x, z = CUP
    y = YC - SA * math.sqrt(max(1 - ((x - X_CUT) / SB) ** 2 - ((z - Z_RAIL) / SC) ** 2, 0.0))
    n = Vector(((x - X_CUT) / SB ** 2, (y - YC) / SA ** 2, (z - Z_RAIL) / SC ** 2)).normalized()
    return Vector((x, y, z)), n


def cup(fz):
    """the stamped round cup: a bevelled dish set into an opening in the dome's lower front."""
    p, n = cup_frame()
    q = n.to_track_quat('Z', 'Y')
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.050, depth=0.030, location=p - n * 0.015,
                                        rotation=q.to_euler())
    o = bpy.context.object
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.9], context='FACES')   # open to the outside
    bm.to_mesh(o.data); bm.free()
    m = o.modifiers.new("bv", "BEVEL"); m.width = 0.008; m.segments = 4; m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier="bv")
    return o, p


def holes(fz):
    H = [(X_FLANGE + 0.016, y, Z_RAIL, 'Z', 0.0045) for y in (-2.25, -2.10, -1.95, -1.80, -1.65)]   # rail flange
    H += [(X_RIM, y, None, 'X', 0.004) for y in (-2.20, -1.95, -1.75)]                       # rim band
    H += [(0.78, Y_REND, Z_RAIL - 0.005, "Y", 0.009)]                                          # leg's big hole
    H += [(0.70, Y_REND, 0.72, 'Y', 0.0065)]                                                  # rear panel
    H += [(x, -2.47, Z_RAIL, 'Z', 0.0045) for x in (0.50, 0.64, 0.79)]                        # front flange
    p, n = cup_frame(); s = p + Vector((-0.07, 0, 0.0)); s = Vector((s.x, YC - SA * math.sqrt(max(1 - ((s.x - X_CUT) / SB) ** 2 - ((s.z - Z_RAIL) / SC) ** 2, 0)), s.z))
    H += [(s.x, s.y, s.z, 'Y', 0.005)]                                                       # beside the cup
    H += [(0.70, -2.14, dome_z(0.70, -2.14), 'Z', 0.0035)]                                   # crown hole (b_jegs_7)
    return H


def make(mat):
    me, fz = build()
    ob = bpy.data.objects.new("inner_fender_L", me); bpy.context.scene.collection.objects.link(ob)
    parts = beads(fz); c, cpos = cup(fz); print('FEAT cup', [round(t, 3) for t in cpos])
    sol = ob.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.001; sol.offset = 0
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier="sol")
    # cut the cup's opening, then hang the dish in it
    cp, cn = cup_frame()
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.046, depth=0.03, location=cp, rotation=cn.to_track_quat('Z', 'Y').to_euler())
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
