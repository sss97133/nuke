"""1973-80 C/K + K5 radiator core support, drawn in Blender (headless) as stamped 1 mm sections from reference photos.

Run: Blender -b -P core_support_blender.py -- <out.glb> [<out.blend>]
Twin metres: +x driver, -y forward, +z up (Blender's Z-up frame is the twin frame here); the glTF exporter turns it
Y-up, (X, Y, Z) = (x, z, -y), the same turn as k5cad.write_glb. Every size below names its source; the receipt is
docs/wiring/receipts/2026-10-26_k5-core-support-3d.md. Photo ids: NOS GM support eBay 227561622754 frames _01/_03/_04/
_05/_06/_10/_13/_16/_17/_21, owner truck scott-bay 045/046. Inches from the tape in _05/_06 (25.4 mm).

Construction (the sections, read from the end and oblique views):
- radiator_face: one sheet as a height field over (x, z): the headlamp panels pressed 30 mm forward in their stepped
  outline (_03/_04 end profile dips forward between the tie bars; _10/_21 step line), the oval bosses domed 12 mm
  toward the engine, a raised bead ring round each headlamp hole; holes cut through after the 1 mm solidify.
- upper/lower tie bars: open channels forward of the face (upper ~62 mm deep, lower a 40 mm trough), open to the engine (_03 near end, _13 end of the upper bar,
  _16/_17/_21 from the front), each with a return lip turned toward the engine (owner 045 lower band).
- radiator posts: hat channels standing forward either side of the opening, tie bar to tie bar (_16, _17, _21).
- end baffles: walls turned 90 degrees to the face along each end, five fender screw holes (_03, _04; GM 2C-9).
Profiles are swept, bends beveled (4 mm, 3 segments), solidified 1 mm, shaded smooth by angle.
"""
import math
import sys
import bpy
import bmesh
from mathutils import Vector

IN = 0.0254
YF = -2.527                       # face plane on the frame's core-support pads (chassis_frame.py body_mount_1)
T = 0.001                         # sheet, ~1 mm (lead's brief; none printed)
D = 0.062                         # upper tie-bar channel depth forward of the face (_03 left end ~90 px at 0.65 mm/px)
DL = 0.040                        # lower tie-bar trough depth, shallower (_03 right end, _17), assumed +/-10 mm
RET = 0.022                       # return flanges on the channels (_03, _13), assumed +/-5 mm
HALF_W = 76.8 * IN / 2            # tie-bar ends 76.8 in apart (_05 tape -2.9 in, _06 tape 73.9 in)
LAMP_Z = 1.052                    # twin headlamp centre (the vertical anchor)
H = 0.627                         # face height 24.7 in (_01 467 px over 18.4 px/in, _05 cross-check 24.9 in)
ZB = LAMP_Z - 0.421               # lamp centre 0.671 H above the lower tie bar's bottom (_01)
ZT = ZB + H
LAMP_X, LAMP_D = 0.851, 5.3 * IN  # centres 1.702 m apart (_05/_06 tape, perspective-corrected); hole 5.3 in (_05)
PARK_X, PARK_Z, PARK_D = 0.820, 0.818, 3.2 * IN   # parking-lamp hole under each headlamp (_01, _05, _06, _10)
OPEN_CX, OPEN_W = 0.025, 30.1 * IN                # radiator opening 19.4-49.55 in on the tape: 1 in toward the driver
OPEN_ZT, OPEN_ZB = ZT - 0.086, ZT - 0.086 - 0.493 # 3.4 in under the top edge (_01), 19.4 in tall (_05 tape)
OPEN_R = 0.045                    # opening corner radius (_01 corners), assumed +/-15 mm
MOUNT_X = 0.367                   # frame-mount brackets 28.9 in apart (_01 bottom edge), over the rail tops
DOME_X, DOME_Z, DOME_A, DOME_B = 0.541, 1.094, 0.107 / 2, 0.195 / 2  # oval boss (owner 045 size; _06 x; _01 z)
TB_H = 0.070                      # upper channel height on the face (_03 left end ~110 px), assumed +/-10 mm
TL_H = 0.060                      # lower trough height on the face (_03 right end), assumed +/-10 mm
POST_W = 0.050                    # radiator post channel width (_21), assumed +/-10 mm
POST_D = (0.045, 0.060)           # post depth, bottom to top: tapers (_16, _17), assumed +/-10 mm
RECESS = 0.030                    # headlamp panel pressed forward (_03/_04 end profile dip), assumed +/-10 mm
FLANGE_SCREWS_Z = [ZB + 0.12 + i * 0.097 for i in range(5)]  # five fender screws (GM 2C-9 step 10; _03 end wall)
GRID = 0.010                      # height-field pitch


def link(name, me):
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def finish(ob, bevel=True, thick=T):
    """Bevel the bends, give the sheet its thickness, apply."""
    if bevel:
        b = ob.modifiers.new("bend", "BEVEL")
        b.width, b.segments, b.limit_method, b.angle_limit = 0.0035, 3, "ANGLE", math.radians(30)
        b.harden_normals = False
    s = ob.modifiers.new("sheet", "SOLIDIFY")
    s.thickness, s.offset, s.use_even_offset = thick, 0.0, True
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def sweep(name, prof, axis, a0, a1, prof1=None):
    """Open profile [(u, v)] swept straight along `axis` from a0 to a1 (to prof1 at a1 for a taper).
    axis 'x': (u, v) = (y, z); 'z': (x, y)."""
    bm = bmesh.new()
    rows = []
    for a, pr in ((a0, prof), (a1, prof1 or prof)):
        row = []
        for u, v in pr:
            co = (a, u, v) if axis == "x" else (u, v, a)
            row.append(bm.verts.new(co))
        rows.append(row)
    for i in range(len(prof) - 1):
        bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def prism(name, loop, y0, y1):
    """Closed (x, z) outline extruded along y: a cutter."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in loop]
    b = [bm.verts.new((x, y1, z)) for x, z in loop]
    n = len(loop)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def circle(cx, cz, r, n=48, sz=1.0):
    return [(cx + r * math.cos(2 * math.pi * i / n), cz + sz * r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rrect(x0, x1, z0, z1, r, n=8):
    pts = []
    for cx, cz, a0 in ((x1 - r, z1 - r, 0), (x0 + r, z1 - r, 90), (x0 + r, z0 + r, 180), (x1 - r, z0 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def cut(target, *tools):
    for t in tools:
        m = target.modifiers.new("cut", "BOOLEAN")
        m.operation, m.object, m.solver = "DIFFERENCE", t, "EXACT"
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(t)
    return target


def join(name, obs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = obs[0].data.name = name
    return obs[0]


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def poly_sd(px, pz, poly):
    """Signed distance to a closed polygon, negative inside."""
    d, inside = 1e9, False
    n = len(poly)
    for i in range(n):
        (ax, az), (bx, bz) = poly[i], poly[(i + 1) % n]
        ex, ez = bx - ax, bz - az
        t = max(0.0, min(1.0, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez)))
        d = min(d, math.hypot(px - ax - t * ex, pz - az - t * ez))
        if (az > pz) != (bz > pz) and px < ax + (pz - az) * ex / ez:
            inside = not inside
    return -d if inside else d


# headlamp panel outline, driver side (mirrored): inner step at x 0.650 (owner 045, 0.109 m outboard of the boss),
# bottom step over the lower tie bar, top step over the headlamp then a diagonal up to the upper tie bar near the
# end (_10 step line, _21 same on the other end); runs out past the end so the end wall takes the dip (_03/_04)
PANEL = [(0.650, ZB + TL_H + 0.015), (HALF_W + 0.05, ZB + TL_H + 0.015), (HALF_W + 0.05, ZT - TB_H - 0.012),
         (0.905, ZT - TB_H - 0.012), (0.800, 1.150), (0.650, 1.150)]
RAMP = 0.028                       # width of the pressed step's wall, a radiused S (_10 step reads ~ 20-30 mm)


def face_y(x, z):
    """Offset of the face sheet from YF: forward (-) in the headlamp panel, rearward (+) on bosses and lamp beads."""
    s = 1 if x >= 0 else -1
    ax = abs(x)
    off = -RECESS * smooth(0.5 - poly_sd(ax, z, PANEL) / RAMP)
    # oval boss, domed 12 mm toward the engine with a flat top (owner 045, _01, _10)
    r = math.hypot((ax - DOME_X) / DOME_A, (z - DOME_Z) / DOME_B)
    off += 0.012 * smooth((1.15 - r) / 0.35)
    # headlamp bead: a ring raised 5 mm round the hole (_01 dark ring, _10 rim)
    rl = math.hypot(ax - LAMP_X, z - LAMP_Z) - LAMP_D / 2
    off += 0.005 * smooth(1 - abs(rl - 0.016) / 0.012)
    return off


FACE_Z = (ZB + TL_H, ZT - TB_H)     # the sheet stops where the channels take over: they are open, not boxes


def height_face():
    bm = bmesh.new()
    nx = int(2 * HALF_W / GRID) + 1
    z0, z1 = FACE_Z
    nz = int((z1 - z0) / GRID) + 1
    xs = [-HALF_W + 2 * HALF_W * i / (nx - 1) for i in range(nx)]
    zs = [z0 + (z1 - z0) * j / (nz - 1) for j in range(nz)]
    vv = [[bm.verts.new((x, YF + face_y(x, z), z)) for z in zs] for x in xs]
    for i in range(nx - 1):
        for j in range(nz - 1):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    me = bpy.data.meshes.new("radiator_face")
    bm.to_mesh(me)
    bm.free()
    return link("radiator_face", me)


bpy.ops.wm.read_factory_settings(use_empty=True)
parts = {}

# ---- the face sheet: height field, solidify, cut the openings
face = finish(height_face(), bevel=False)
open_loop = rrect(OPEN_CX - OPEN_W / 2, OPEN_CX + OPEN_W / 2, OPEN_ZB, OPEN_ZT, OPEN_R)
tools = [prism("o", open_loop, YF - 0.1, YF + 0.1)]
for s in (1, -1):
    tools += [prism("l", circle(s * LAMP_X, LAMP_Z, LAMP_D / 2), YF - 0.1, YF + 0.1),
              prism("p", circle(s * PARK_X, PARK_Z, PARK_D / 2, 32), YF - 0.1, YF + 0.1)]
face = cut(face, *tools)
parts["radiator_face"] = face

# ---- radiator opening return flange, 15 mm toward the engine all round (_01 lit edge, _10 inner lip)
bm = bmesh.new()
a = [bm.verts.new((x, YF, z)) for x, z in open_loop]
b = [bm.verts.new((x, YF + 0.015, z)) for x, z in open_loop]
for i in range(len(a)):
    bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(a)], b[i]))
me = bpy.data.meshes.new("opening_flange")
bm.to_mesh(me)
bm.free()
parts["opening_flange"] = finish(link("opening_flange", me), bevel=False)

# ---- upper tie bar: a channel open toward the engine; lower return flange on the face, top wall back past the face,
# rear lip turned down. Was: a 15 mm lip turned rearward
# over the face top (_13 end of the bar; _03 left end; owner 045 shows no wide flange at the top on the engine side)
ut = [(T, ZT - TB_H - RET), (T, ZT - TB_H), (-D, ZT - TB_H), (-D, ZT), (RET, ZT), (RET, ZT - RET * 0.8)]
# (owner + lead, 2026-10-27: this channel IS the upper tie bar, the top rail at the hood line; the lamp panels run up
# to it and the radiator's top tank sits right under it, _01 and his grille-off photo)
parts["upper_tie_bar"] = finish(sweep("upper_tie_bar", [(YF + u, v) for u, v in ut], "x", -HALF_W, HALF_W))

# hood-latch plate on the bar's front wall, centred (GM 2C-20 upper panel; _01 centre holes): a doubler with a slot
latch = finish(sweep("hood_latch_plate", [(YF - D - 0.003, ZT - 0.062), (YF - D - 0.003, ZT - 0.008)], "x",
                     OPEN_CX - 0.09, OPEN_CX + 0.09), bevel=False, thick=0.002)
parts["hood_latch_plate"] = cut(latch, prism("slot", rrect(OPEN_CX - 0.03, OPEN_CX + 0.03, ZT - 0.045, ZT - 0.027,
                                                          0.009), YF - D - 0.02, YF - D + 0.01))

# ---- lower tie bar: a shallow trough open toward the engine, top return flange on the face, bottom skin the face's bottom edge, a 45 mm rear lip toward the engine
# (owner 045 wide band on the engine side; _03/_04 right end shows the lip standing up)
lt = [(-T, ZB + TL_H + RET), (-T, ZB + TL_H), (-DL, ZB + TL_H), (-DL, ZB), (0.045, ZB), (0.045, ZB + 0.040)]
parts["lower_tie_bar"] = finish(sweep("lower_tie_bar", [(YF + u, v) for u, v in lt], "x", -HALF_W, HALF_W))

# ---- radiator posts: hat channels standing forward either side of the opening, tie bar to tie bar, with a 20 mm
# flange to the face each side (_21 from the front, _16/_17 standing up off the floor)
for s, sfx, xe in ((1, "L", OPEN_CX + OPEN_W / 2), (-1, "R", OPEN_CX - OPEN_W / 2)):
    x0, x1 = xe, xe + s * POST_W
    pr = [[(x0 - s * 0.018, YF - T), (x0, YF - T), (x0 + s * 0.006, YF - d), (x1 - s * 0.006, YF - d), (x1, YF - T),
           (x1 + s * 0.018, YF - T)] for d in POST_D]
    if s < 0:
        pr = [p[::-1] for p in pr]
    parts[f"radiator_post_{sfx}"] = finish(sweep(f"radiator_post_{sfx}", pr[0], "z", ZB + TL_H, ZT - TB_H, pr[1]))

# ---- radiator mounting panel across the opening top on the engine side: a strip with a 20 mm lower return
# (GM Fig 2C-20; _01 strip with two stepped dips over the opening)
rmp = [(YF + 0.002, OPEN_ZT + 0.050), (YF + 0.002, OPEN_ZT - 0.002), (YF + 0.022, OPEN_ZT - 0.002)]
parts["radiator_mounting_panel"] = finish(sweep("radiator_mounting_panel", rmp, "x", OPEN_CX - OPEN_W / 2 - 0.03,
                                                OPEN_CX + OPEN_W / 2 + 0.03))

for s, sfx in ((1, "L"), (-1, "R")):
    # headlamp and parking-lamp collars: the hole edge turned 8 mm forward, the parking collar 15 mm (_10, _21)
    col = []
    for cx, cz, d, dep in ((LAMP_X, LAMP_Z, LAMP_D, 0.005), (PARK_X, PARK_Z, PARK_D, 0.009)):
        bm = bmesh.new()
        y0 = YF + face_y(s * cx, cz + d / 2)
        ring = circle(s * cx, cz, d / 2, 40)
        a = [bm.verts.new((x, y0, z)) for x, z in ring]
        b = [bm.verts.new((x, y0 - dep, z)) for x, z in ring]
        for i in range(len(a)):
            bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(a)], b[i]))
        me = bpy.data.meshes.new("c")
        bm.to_mesh(me)
        bm.free()
        col.append(finish(link("c", me), bevel=False))
    parts[f"lamp_collars_{sfx}"] = join(f"lamp_collars_{sfx}", col)

    # end baffle: a wall turned 90 degrees to the face along the end, front edge following the panel dip, five
    # fender screw holes (_03, _04 end walls; GM 2C-9 step 10). Profile in (x, y), swept up z.
    x = s * HALF_W
    # a 40 mm flange turned rearward off the face edge, following its dip (_03): a strip whose front edge rides the face
    bm = bmesh.new()
    zs = [FACE_Z[0] + (FACE_Z[1] - FACE_Z[0]) * j / 60 for j in range(61)]
    a = [bm.verts.new((x, YF + face_y(x, z), z)) for z in zs]
    b = [bm.verts.new((x, YF + face_y(x, z) + 0.040, z)) for z in zs]
    for j in range(60):
        bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    me = bpy.data.meshes.new("w")
    bm.to_mesh(me)
    bm.free()
    w = finish(link(f"fender_flange_{sfx}", me), bevel=False)
    hs = []
    for z in FLANGE_SCREWS_Z:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0045, depth=0.03,
                                            location=(x, YF + face_y(x, z) + 0.022, z), rotation=(0, math.pi / 2, 0))
        hs.append(bpy.context.active_object)
    parts[f"fender_flange_{sfx}"] = cut(w, *hs)

    # frame mount: a U bracket under the lower tie bar's box on each rail, 45 mm drop, 17 mm bolt hole (_01, _07)
    prof = [(YF - DL + 0.005, ZB), (YF - DL + 0.005, ZB - 0.045), (YF + 0.040, ZB - 0.045), (YF + 0.040, ZB)]
    br = finish(sweep(f"frame_mount_{sfx}", prof, "x", s * MOUNT_X - 0.035, s * MOUNT_X + 0.035))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0085, depth=0.03,
                                        location=(s * MOUNT_X, YF, ZB - 0.045))
    parts[f"frame_mount_{sfx}"] = cut(br, bpy.context.active_object)


def mat(name, rgb, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    return m


# hood-latch support bracket: a vertical flanged plate hung from the upper tie bar at centre, dropping to the
# radiator top-tank line (the opening top), two latch bolt holes (owner 2026-10-27; GM 2C-20 hood latch support).
# 120 mm wide, 20 mm side flanges, assumed.
lx0, lx1, ly = OPEN_CX - 0.060, OPEN_CX + 0.060, YF - 0.030
lb = [(lx0, ly + 0.020), (lx0, ly), (lx1, ly), (lx1, ly + 0.020)]
lbr = finish(sweep("hood_latch_bracket", lb, "z", OPEN_ZT, ZT - TB_H + 0.002))
hs = []
for xx in (OPEN_CX - 0.035, OPEN_CX + 0.035):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.0055, depth=0.03, location=(xx, ly, (OPEN_ZT + ZT - TB_H) / 2),
                                        rotation=(math.pi / 2, 0, 0))
    hs.append(bpy.context.active_object)
parts["hood_latch_bracket"] = cut(lbr, *hs)

for s, sfx in ((1, "L"), (-1, "R")):
    x = s * MOUNT_X
    # lower frame support: two vertical gussets per side from the lower trough down to the mount pad (owner
    # 2026-10-27; 048 shows the bracket under the support beside the rail), triangle 90 mm tall, assumed
    gs = []
    for dx in (-0.035, 0.035):
        bm = bmesh.new()
        vs = [bm.verts.new((x + dx, yy, zz)) for yy, zz in
              ((YF - DL, ZB), (YF + 0.040, ZB), (YF + 0.040, ZB - 0.045), (YF - DL + 0.005, ZB - 0.045))]
        bm.faces.new(vs)
        me = bpy.data.meshes.new("g")
        bm.to_mesh(me)
        bm.free()
        gs.append(finish(link("g", me), bevel=False, thick=0.0015))
    parts[f"frame_support_{sfx}"] = join(f"frame_support_{sfx}", gs)
    # body-mount pad and rubber cushion under it, on the frame's core-support pad (chassis_frame body_mount_1)
    pad = finish(sweep(f"body_mount_pad_{sfx}", [(YF - 0.045, ZB - 0.046), (YF + 0.045, ZB - 0.046)], "x",
                       x - 0.045, x + 0.045), bevel=False, thick=0.003)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0085, depth=0.03, location=(x, YF, ZB - 0.046))
    parts[f"body_mount_pad_{sfx}"] = cut(pad, bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.030, depth=0.025, location=(x, YF, ZB - 0.060))
    cu = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0085, depth=0.05, location=(x, YF, ZB - 0.060))
    cut(cu, bpy.context.active_object)
    parts[f"body_mount_cushion_{sfx}"] = cu
    # radiator mounting boss: rubber saddle on the lower trough behind the radiator's bottom tank (048 two black
    # cushions on the support), 60 x 30 x 25 mm, assumed
    bpy.ops.mesh.primitive_cube_add(size=1, location=(OPEN_CX + s * 0.300, YF + 0.022, ZB + 0.0125))
    sd = bpy.context.active_object
    sd.scale = (0.060, 0.030, 0.025)
    bpy.ops.object.transform_apply(scale=True)
    parts[f"radiator_saddle_{sfx}"] = sd

black = mat("satin_dark_grey_steel", (0.13, 0.13, 0.13), 0.0, 0.35)  # shared with inner fender + firewall (lead)
root = bpy.data.objects.new("core_support", None)
bpy.context.collection.objects.link(root)
rubber = mat("rubber", (0.02, 0.02, 0.02), 0.0, 0.8)
for n, o in parts.items():
    o.name = n
    o.data.materials.clear()
    o.data.materials.append(rubber if "cushion" in n or "saddle" in n else black)
    o.parent = root
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=argv[0], export_format="GLB", use_selection=True, export_yup=True,
                          export_extras=False, export_apply=True, export_draco_mesh_compression_enable=False,
                          export_texcoords=False, export_normals=True)
if len(argv) > 1:
    bpy.ops.wm.save_as_mainfile(filepath=argv[1])
