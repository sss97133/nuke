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
DL = 0.060                        # lower trough forward of the face; with the 25 mm rear lip the trough is 85 mm
#                                   front to back (_16; lead read 80-90 mm), assumed +/-15 mm
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
DOME_X, DOME_Z, DOME_A, DOME_B = 0.585, LAMP_Z, 0.110 / 2, 0.060 / 2  # horizontal oval boss on the flat face between
#                                   post and lamp pan, at lamp height (_01, _10, viewer check by the lead), +/-20 %
TB_H = 0.070                      # upper channel height on the face (_03 left end ~110 px), assumed +/-10 mm
TL_H = 0.060                      # lower trough height on the face (_03 right end), assumed +/-10 mm
POST_W = 0.050                    # radiator post channel width (_21), assumed +/-10 mm
POST_D = (0.072, 0.080)           # post depth, bottom to top: tapers slightly (_16, _17), +/-20 %
POST_FL = 0.025                   # post flanges on the face (_16)
END_D = 0.075                     # end wall depth front to back, as deep as the posts (_16), +/-20 %
RECESS = 0.045                    # lamp pan depth, rim to floor (_03, _16 tray rim ~45 mm), +/-20 %
DRAFT = 0.022                     # pan wall run: ~10 deg draft plus bend radii (_03, _16), assumed
FLANGE_SCREWS_Z = [ZB + 0.12 + i * 0.097 for i in range(5)]  # five fender screws (GM 2C-9 step 10; _03 end wall)
GRID = 0.006                      # height-field pitch


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
# lamp pan (supersedes the stepped plate): a rounded trapezoid, wider at the top rail and narrower at the lower bar,
# its rim running round the inboard side and both bars, open to the end wall (_03, _16 trays; lead 2026-10-27)
PANEL = [(0.665, ZT - TB_H - 0.014), (HALF_W + 0.05, ZT - TB_H - 0.014), (HALF_W + 0.05, ZB + TL_H + 0.014),
         (0.735, ZB + TL_H + 0.014)]
RAMP = DRAFT
BEAD_Z = LAMP_Z - 0.060              # face bead height, assumed +/-20 mm


def face_y(x, z):
    """Offset of the face sheet from YF: forward (-) in the headlamp panel, rearward (+) on bosses and lamp beads."""
    s = 1 if x >= 0 else -1
    ax = abs(x)
    off = 0.0
    # oval boss, domed 12 mm toward the engine with a flat top (owner 045, _01, _10)
    r = math.hypot((ax - DOME_X) / DOME_A, (z - DOME_Z) / DOME_B)
    off += 0.012 * smooth((1.0 - r) / 0.45)
    # stiffening bead across the flat face between the post flange and the lamp-pan rim, 12 mm wide, 4 mm proud
    # toward the front (_01, _16). Set 60 mm under the lamp centre so it clears the boss, which sits at lamp height.
    xr = pan_rim_x(BEAD_Z) - 0.014
    off -= 0.004 * smooth(1 - abs(z - BEAD_Z) / 0.007) * smooth((ax - 0.490) / 0.012) * smooth((xr - ax) / 0.012)
    return off


def pan_y(z):
    """The pan floor's offset under the rim along the end, for the end wall and the collars."""
    zt, zb = PANEL[0][1], PANEL[3][1]
    return -RECESS * smooth(min(zt - z, z - zb) / RAMP)


def pan_rim_x(z):
    """Inboard rim of the lamp pan at height z (the trapezoid's slanted side)."""
    (x0, z0), (x1, z1) = PANEL[0], PANEL[3]
    return x0 + (x1 - x0) * (z0 - z) / (z0 - z1)


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


def rounded(poly, r, n=8):
    """Open polyline with each interior corner replaced by an arc of radius r."""
    out = [poly[0]]
    for i in range(1, len(poly) - 1):
        p, a, b = Vector((*poly[i], 0)), Vector((*poly[i - 1], 0)), Vector((*poly[i + 1], 0))
        u, v = (a - p).normalized(), (b - p).normalized()
        ang = u.angle(v)
        dd = r / math.tan(ang / 2)
        p0, p1 = p + u * dd, p + v * dd
        cen = p + (u + v).normalized() * (r / math.sin(ang / 2))
        a0 = math.atan2(p0.y - cen.y, p0.x - cen.x)
        a1 = math.atan2(p1.y - cen.y, p1.x - cen.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        out += [(cen.x + r * math.cos(a0 + da * k / n), cen.y + r * math.sin(a0 + da * k / n)) for k in range(n + 1)]
    return out + [poly[-1]]


def inset(line, d, inside):
    """Offset an open polyline by d toward the interior point."""
    out = []
    for i, (x, z) in enumerate(line):
        a, b = line[max(i - 1, 0)], line[min(i + 1, len(line) - 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, tz)
        nx, nz = -tz / L, tx / L
        if (inside[0] - x) * nx + (inside[1] - z) * nz < 0:
            nx, nz = -nx, -nz
        out.append((x + d * nx, z + d * nz))
    return out


# ---- lamp pans: a clean loft per side, rim on the face, a drafted wall (~10 deg: 8 mm in over 45 mm), a flat floor
# carrying the lamp holes (_03, _16); the face is cut away inside the rim (lead 2026-10-27: no boolean dish)
for s, sfx in ((1, "L"), (-1, "R")):
    (xt, zt), _, _, (xb, zb) = PANEL
    rim = rounded([(HALF_W, zt), (xt, zt), (xb, zb), (HALF_W, zb)], 0.030)
    flo = inset(rim, 0.008, (0.88, (zt + zb) / 2))
    flo[0] = (HALF_W, flo[0][1])
    flo[-1] = (HALF_W, flo[-1][1])
    face = cut(face, prism("pc", [(s * x, z) for x, z in rim + [(HALF_W + 0.05, zb), (HALF_W + 0.05, zt)]],
                           YF - 0.02, YF + 0.02))
    bm = bmesh.new()
    a = [bm.verts.new((s * x, YF, z)) for x, z in rim]
    b = [bm.verts.new((s * x, YF - RECESS, z)) for x, z in flo]
    for i in range(len(a) - 1):
        bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("pan")
    bm.to_mesh(me)
    bm.free()
    pan = finish(link(f"lamp_pan_{sfx}", me))
    parts[f"lamp_pan_{sfx}"] = cut(pan, prism("l", circle(s * LAMP_X, LAMP_Z, LAMP_D / 2), YF - 0.08, YF - 0.02),
                                   prism("p", circle(s * PARK_X, PARK_Z, PARK_D / 2, 32), YF - 0.08, YF - 0.02))
parts["radiator_face"] = face

# ---- radiator opening return flange, 15 mm toward the engine all round (_01 lit edge, _10 inner lip)
bm = bmesh.new()
a = [bm.verts.new((x, YF, z)) for x, z in open_loop]
b = [bm.verts.new((x, YF + 0.020, z)) for x, z in open_loop]   # 20 mm return all round (_16)
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

# ---- lower tie bar: a shallow trough open toward the engine, top return flange on the face, bottom skin the face's bottom edge, a 45 mm rear lip toward the engine
# (owner 045 wide band on the engine side; _03/_04 right end shows the lip standing up)
lt = [(-T, ZB + TL_H + RET), (-T, ZB + TL_H), (-DL, ZB + TL_H), (-DL, ZB), (0.025, ZB), (0.025, ZB + 0.025)]
parts["lower_tie_bar"] = finish(sweep("lower_tie_bar", [(YF + u, v) for u, v in lt], "x", -HALF_W, HALF_W))

# ---- radiator posts: hat channels standing forward either side of the opening, tie bar to tie bar, with a 20 mm
# flange to the face each side (_21 from the front, _16/_17 standing up off the floor)
for s, sfx, xe in ((1, "L", OPEN_CX + OPEN_W / 2), (-1, "R", OPEN_CX - OPEN_W / 2)):
    x0, x1 = xe, xe + s * POST_W
    pr = [[(x0 - s * POST_FL, YF - T), (x0, YF - T), (x0 + s * 0.006, YF - d), (x1 - s * 0.006, YF - d), (x1, YF - T),
           (x1 + s * POST_FL, YF - T)] for d in POST_D]
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
        y0 = YF - RECESS
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

    # end wall: a full-height plate along the end, as deep as the posts (75 mm front to back, _16 near end), its rear
    # edge following the pan dip and stepping 30 mm inboard near the bottom (_03); the fender flange is turned
    # outboard 25 mm off its front edge and carries the five screw holes (_16, GM 2C-9)
    x = s * HALF_W
    xz = lambda z: s * (HALF_W - 0.030 * smooth((ZB + 0.120 - z) / 0.030))
    YW = YF - END_D
    bm = bmesh.new()
    zs = [ZB + (ZT - ZB) * j / 80 for j in range(81)]
    a = [bm.verts.new((xz(z), YF + pan_y(z), z)) for z in zs]
    b = [bm.verts.new((xz(z), YW, z)) for z in zs]
    c = [bm.verts.new((xz(z) + s * 0.025, YW, z)) for z in zs]
    for j in range(80):
        bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
        bm.faces.new((b[j], b[j + 1], c[j + 1], c[j]))
    me = bpy.data.meshes.new("w")
    bm.to_mesh(me)
    bm.free()
    w = finish(link(f"fender_flange_{sfx}", me))
    hs = []
    for z in FLANGE_SCREWS_Z:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0045, depth=0.03,
                                            location=(xz(z) + s * 0.013, YW, z), rotation=(math.pi / 2, 0, 0))
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


# hood-latch support: a vertical plate at centre on the upper tie bar's front wall, from the rail top down past the
# opening's top edge, 150 mm wide with 15 mm side flanges turned rearward, a 60 x 25 mm latch slot and two bolt holes
# (lead's read of _01 and the owner's photos; GM 2C-20 hood latch support), +/-20 %
lx0, lx1, ly = OPEN_CX - 0.075, OPEN_CX + 0.075, YF - D - 0.002
LZ0, LZ1 = OPEN_ZT - 0.050, ZT - 0.004
lb = [(lx0, ly + 0.015), (lx0, ly), (lx1, ly), (lx1, ly + 0.015)]
lbr = finish(sweep("hood_latch_support", lb, "z", LZ0, LZ1), thick=0.0015)
hs = [prism("slot", rrect(OPEN_CX - 0.030, OPEN_CX + 0.030, LZ0 + 0.030, LZ0 + 0.055, 0.008), ly - 0.02, ly + 0.01)]
for xx in (OPEN_CX - 0.050, OPEN_CX + 0.050):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.0045, depth=0.03, location=(xx, ly, LZ1 - 0.030),
                                        rotation=(math.pi / 2, 0, 0))
    hs.append(bpy.context.active_object)
parts["hood_latch_support"] = cut(lbr, *hs)

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
    # radiator saddle: an upstanding bracket on the lower bar's rear lip, 60 mm tall, a formed cup on top holding the
    # rubber cushion (lead's read; 048 two black cushions on the support), 70 mm wide, +/-20 %
    sx = OPEN_CX + s * 0.300
    sb = [(YF + 0.025, ZB + 0.020), (YF + 0.025, ZB + 0.080), (YF + 0.060, ZB + 0.080), (YF + 0.060, ZB + 0.095)]
    sa = finish(sweep(f"radiator_saddle_{sfx}", [(YF + 0.010, ZB + 0.080)] + sb[1:], "x", sx - 0.035, sx + 0.035),
                thick=0.0015)
    st = finish(sweep("st", sb[:2], "x", sx - 0.035, sx + 0.035), thick=0.0015)
    parts[f"radiator_saddle_{sfx}"] = join(f"radiator_saddle_{sfx}", [sa, st])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sx, YF + 0.042, ZB + 0.090))
    cu = bpy.context.active_object
    cu.scale = (0.060, 0.030, 0.020)
    bpy.ops.object.transform_apply(scale=True)
    parts[f"radiator_cushion_{sfx}"] = cu

black = mat("satin_dark_grey_steel", (0.11, 0.11, 0.11), 0.0, 0.38)  # shared with inner fender + firewall (lead)
root = bpy.data.objects.new("core_support", None)
bpy.context.collection.objects.link(root)
rubber = mat("rubber", (0.02, 0.02, 0.02), 0.0, 0.8)
for n, o in parts.items():
    o.name = n
    o.data.materials.clear()
    o.data.materials.append(rubber if "cushion" in n else black)
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
