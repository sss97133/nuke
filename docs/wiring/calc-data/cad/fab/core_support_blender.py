"""1975-80 C/K + K5 radiator core support, built in Blender (headless) from camera-solved photo measurements.

Run (writes the GLB and k5_core_support_landmarks.json; deterministic, no images read):

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P \
        docs/wiring/calc-data/cad/fab/core_support_blender.py [-- <out.glb> [<landmarks.json>]]

Defaults: nuke_frontend/public/models/k5-core-support.glb and k5_core_support_landmarks.json next to this script.
Frame: twin metres, +x driver, -y forward, +z up (Blender's Z-up frame is the twin frame here). The glTF exporter turns
it Y-up, (X, Y, Z) = (x, z, -y), the same turn as k5cad.write_glb. Receipt: docs/wiring/receipts/
2026-10-27_k5-core-support-3d.md (photo ids, the camera solve, the gate table, what is assumed).

Where the numbers come from (sigma in mm; photos are named by id only, none is read here):
- Scale and layout: the owner photo c6b40497 (Nuke vehicle_images id) solved as a lens-plane camera on the two 7-in
  sealed-beam lenses (SAE 178 mm, centres +-0.782 at z 1.052); a vendor repro support photographed square-on (AMD
  350-4075-1 spin frame 01, "frame 01" below) mapped at that lens scale (1.7686 px/mm) and checked against c6b40497
  to 0.1 % on two scale-free ratios. Outline, opening, holes and post/foot edges are read off that frame. The 10-26
  tape scale (+-0.851 lamps, 1.951 m width) is rejected by the lens solve.
- c6b40497 rays intersected with this model's own surfaces give the gate-tested points: tie-bar top front edge,
  hood bumpers, parking lamps, latch lever.
- Sections (channel depths, pan depth, post depth) have no tape across them: those values are marked "assumed".
"""
import json
import math
import os
import re
import struct
import sys

import bmesh
import bpy
from mathutils import Vector, geometry

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if argv else os.path.join(REPO, "nuke_frontend", "public", "models", "k5-core-support.glb")
OUT_LM = argv[1] if len(argv) > 1 else os.path.join(HERE, "k5_core_support_landmarks.json")

# ---------------------------------------------------------------- stations and sizes
YF = -2.527            # face plane (BRIEF station: frame core-support pads)
T = 0.0012             # sheet, assumed (none printed)
PAN_D = 0.040          # lamp pans pressed forward of the face, assumed +-15 (10-26 reads 30-45)
YP = YF - PAN_D        # pan floor y = -2.567, the lens-plane y the c6b40497 solve anchors on
X_END = 0.889          # end walls: face 1.777 m wide (frame 01 at lens scale), +-22
X_TOPEND = 0.866       # tie-bar ends / kink top (frame 01 tabs +-0.866; c6b40497 visible ends >= 0.846)
KINK = ((0.866, 1.156), (0.889, 1.104))   # C12 diagonal (frame 01), +-25
Z_TOP = 1.274          # tie-bar top front edge: c6b40497 rays at the front wall 1.275 / 1.278; frame 01 1.259; +-20
Z_TBB = 1.233          # tie-bar front wall bottom: c6b40497 crease 1.229, frame 01 see-through slits 1.233-1.237
TB_F, TB_B = 0.047, 0.043   # C-channel 47 mm forward and 43 mm behind the face (open end ~90 x 47), assumed +-15
Z_BT, Z_BB = 0.776, 0.713   # lower band top / bottom (frame 01, +-15)
SHELF = 0.080          # lower tie-bar shelf toward the engine, assumed +-20 (pockets sit at y -2.45)
LIP = 0.025            # rear lip of the shelf, assumed
LAMP_X, LAMP_Z, LAMP_D = 0.782, 1.052, 0.120   # lens solve +-20; hole 117-122 mm in frame 01
PARK_X, PARK_Z, PARK_D = 0.775, 0.862, 0.058   # c6b40497 rays on the pan floor 0.772 / -0.764, z 0.860 / 0.869;
#                                                frame 01 holes 0.783 / 0.861-0.863; diameter 56-58 mm
KEY = (0.783, 0.922, 0.956, 0.020, 0.031)      # trapezoid key window: x, z bottom, z top, width bottom, width top
RIM = dict(xi=0.635, zt=1.197, zb=0.785, r=0.030)    # pan rim on the face (frame 01 rim lines), +-10
FLOOR = dict(xi=0.665, zt=1.165, zb=0.800, r=0.016)  # pan floor edge (frame 01 inner step 0.665-0.667), +-10
POST = (0.383, 0.507)  # post inner / outer edge (frame 01: 0.382-0.385 / 0.506-0.512), +-14
POST_D = (0.065, 0.055)  # inner / outer channel depth forward of the face, assumed +-25 (no tape across a post)
SEAM = (0.452, 0.462)  # where the two channels meet (frame 01 post crop), +-8
FOOT_Z = 0.700         # foot box bottom (frame 01 0.695-0.707), +-16
FOOT_X = 0.445         # bolt centre x: feet 0.438 / -0.448 (frame 01), cup 0.455 +-0.04 (dfa1cf15); +-20
FOOT_Y = -2.542        # bolt centre y: inside the post foot under its access hole (81-88 install video), assumed +-40
DOME_X, DOME_Z, DOME_A, DOME_B = 0.546, 1.150, 0.041, 0.052   # C13 oval dome: frame 01 hole -0.545 / 1.146
#                                    (91 x 109 mm) and driver boss 0.547 / 1.159; owner 33a89651 shows the oval dome
DOME_H = 0.010         # domed forward, assumed
TAB_Z = 1.082          # slotted tab hole under the dome (frame 01 -0.546 / 1.082)
POCKETS = (0.380, -0.310)   # C10 cradle pockets (vendor engine-face frame 25, asymmetric, +-38)
POCKET_Z = (0.700, 0.755)
CUP_TOP = 0.695        # frame-side bracket plate top (RB7360 install photo: 37 mm under the horn top 0.732), +-25
HORN_X = 0.3602        # frame horn web outer face (chassis_frame.params.json rail_profile[0..2])
LATCH_X = -0.034       # hood latch lever: c6b40497 ray at the lever plane y -2.602 gives x -0.034, z 1.2685
STUD_X = (0.787, -0.791)    # hood bumpers: c6b40497 rays at y -2.583 give 0.787 / -0.791, top z 1.241 / 1.239
STUD_Z = 1.240

# frame 01 radiator opening outline (twin x, z), traced from the white background, 116 points, +-14
OPENING = [(-0.3516, 1.1658), (-0.3477, 1.1709), (-0.3432, 1.1749), (-0.3387, 1.1778), (-0.3330, 1.1795), (-0.3257, 1.1795),
           (-0.3200, 1.1807), (-0.3087, 1.1801), (-0.2923, 1.1819), (-0.2765, 1.1814), (-0.2731, 1.1831), (-0.2658, 1.1843),
           (-0.2550, 1.1900), (-0.2528, 1.1923), (-0.2511, 1.1923), (-0.2477, 1.1951), (-0.2455, 1.1957), (-0.2449, 1.1968),
           (-0.2426, 1.1974), (-0.2252, 1.2088), (-0.2229, 1.2094), (-0.2223, 1.2105), (-0.2122, 1.2162), (-0.2116, 1.2173),
           (-0.2094, 1.2179), (-0.2088, 1.2190), (-0.1998, 1.2230), (-0.1958, 1.2230), (-0.1896, 1.2248), (-0.1766, 1.2254),
           (-0.1625, 1.2232), (-0.1562, 1.2187), (-0.1494, 1.2119), (-0.1443, 1.2091), (-0.1347, 1.2092), (-0.1273, 1.2120),
           (-0.1133, 1.2228), (-0.1070, 1.2246), (0.0094, 1.2256), (0.0173, 1.2234), (0.0219, 1.2206), (0.0236, 1.2183),
           (0.0247, 1.2183), (0.0304, 1.2127), (0.0361, 1.2099), (0.0479, 1.2100), (0.0592, 1.2162), (0.0603, 1.2179),
           (0.0688, 1.2242), (0.0744, 1.2259), (0.1378, 1.2262), (0.1904, 1.2253), (0.1949, 1.2247), (0.1994, 1.2219),
           (0.2011, 1.2219), (0.2023, 1.2202), (0.2102, 1.2152), (0.2113, 1.2135), (0.2125, 1.2135), (0.2198, 1.2079),
           (0.2232, 1.2073), (0.2323, 1.2085), (0.2503, 1.2221), (0.2548, 1.2227), (0.2565, 1.2239), (0.2774, 1.2245),
           (0.2899, 1.2223), (0.2995, 1.2156), (0.3035, 1.2088), (0.3052, 1.2077), (0.3058, 1.2054), (0.3115, 1.1987),
           (0.3115, 1.1975), (0.3132, 1.1964), (0.3177, 1.1891), (0.3251, 1.1806), (0.3314, 1.1784), (0.3449, 1.1785),
           (0.3495, 1.1773), (0.3557, 1.1734), (0.3591, 1.1700), (0.3648, 1.1604), (0.3648, 1.1531), (0.3677, 1.1328),
           (0.3663, 1.0643), (0.3672, 0.9897), (0.3650, 0.8563), (0.3633, 0.8483), (0.3611, 0.8449), (0.3605, 0.8421),
           (0.3549, 0.8342), (0.3487, 0.8279), (0.3341, 0.8165), (0.2850, 0.7886), (0.2788, 0.7858), (0.2652, 0.7829),
           (0.1663, 0.7853), (-0.0424, 0.7844), (-0.1583, 0.7861), (-0.2646, 0.7851), (-0.2725, 0.7862), (-0.2782, 0.7890),
           (-0.2799, 0.7890), (-0.3060, 0.8053), (-0.3077, 0.8053), (-0.3082, 0.8064), (-0.3133, 0.8086), (-0.3156, 0.8109),
           (-0.3264, 0.8165), (-0.3337, 0.8221), (-0.3445, 0.8339), (-0.3474, 0.8396), (-0.3502, 0.8424), (-0.3502, 0.8441),
           (-0.3531, 0.8486), (-0.3544, 1.1573)]

# frame 01 through-holes (x, z, width mm, height mm), white-background test; lamp/park/key/dome holes are built below
HOLES = [(-0.8704, 1.0519, 11.3, 12.4), (-0.8607, 0.8931, 6.8, 7.4), (-0.8561, 0.8093, 6.8, 7.4), (-0.7981, 0.9556, 6.2, 7.4),
         (-0.7894, 1.1446, 11.3, 12.4), (-0.7595, 1.2129, 10.7, 11.3), (-0.7132, 0.9905, 7.9, 7.9),
         (-0.7114, 1.1185, 26.0, 27.1), (-0.6910, 0.8611, 6.8, 7.9), (-0.6144, 1.1574, 7.4, 8.5), (-0.6144, 1.0583, 7.9, 7.9),
         (-0.6125, 0.8819, 11.3, 10.7), (-0.6064, 1.2151, 11.3, 11.9), (-0.5447, 1.2093, 7.9, 8.5),
         (-0.4231, 1.1178, 13.6, 13.6), (-0.4224, 0.8411, 13.6, 14.1), (-0.3196, 1.2050, 14.1, 14.1),
         (-0.3178, 1.2265, 11.9, 11.9), (-0.3169, 0.7803, 14.7, 14.1), (-0.1379, 1.2336, 11.3, 11.3), (0.0434, 1.2344, 10.7, 10.7),
         (0.2256, 1.2339, 11.3, 11.3), (0.3283, 0.7797, 14.7, 14.7), (0.3327, 1.2052, 14.7, 14.7), (0.4058, 1.2216, 7.4, 8.5),
         (0.4183, 0.8393, 13.0, 13.6), (0.4203, 1.1184, 13.6, 14.1), (0.4300, 1.2078, 22.1, 23.7), (0.5223, 0.9056, 7.4, 8.5),
         (0.5359, 0.8174, 35.6, 36.2), (0.5447, 1.2097, 9.0, 8.5), (0.5481, 1.0008, 7.4, 8.5), (0.5511, 0.9589, 9.6, 10.2),
         (0.5519, 0.8738, 10.2, 10.7), (0.5621, 1.0458, 5.1, 5.1), (0.6031, 0.8169, 7.4, 7.9), (0.6044, 1.2185, 11.9, 11.3),
         (0.6145, 1.0436, 7.4, 7.9), (0.6163, 1.0923, 6.8, 6.8), (0.6903, 0.8586, 7.4, 7.9), (0.7108, 1.1191, 27.1, 27.7),
         (0.7128, 0.9888, 7.9, 7.9), (0.7469, 0.8982, 10.2, 10.2), (0.7590, 0.9085, 8.5, 7.9), (0.7609, 1.2161, 10.7, 11.3),
         (0.7885, 1.1462, 12.4, 12.4), (0.7992, 0.9548, 5.7, 5.7), (0.8144, 0.8134, 7.9, 8.5), (0.8583, 0.8076, 7.4, 7.4),
         (0.8637, 0.8904, 7.4, 7.9), (0.8728, 1.0509, 9.6, 12.4)]
CAGES = [(0.789, 1.146), (0.871, 1.051)]   # square nut-cage holes (frame 01), mirrored; cage boxes on the pan floor
LOCATOR = (0.713, 0.991)                    # domed locator boss with its screw hole (frame 01 0.713 / 0.989-0.991)

LM = {}          # landmark name -> (x, y, z), from the same variables that place the geometry
parts = {}


# ---------------------------------------------------------------- helpers
def link(name, me):
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def solid(ob, t=T, offset=0.0):
    s = ob.modifiers.new("sheet", "SOLIDIFY")
    s.thickness, s.offset, s.use_even_offset = t, offset, False   # even offset blows up on scanfill slivers
    return apply_mods(ob)


def bevel(ob, w=0.003, seg=2, ang=30):
    b = ob.modifiers.new("bend", "BEVEL")
    b.width, b.segments, b.limit_method, b.angle_limit = w, seg, "ANGLE", math.radians(ang)
    return ob


def circle(cx, cz, r, n=32, rz=None):
    rz = r if rz is None else rz
    return [(cx + r * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]


def square(cx, cz, h):
    return [(cx - h, cz - h), (cx + h, cz - h), (cx + h, cz + h), (cx - h, cz + h)]


def mirror(loop, s):
    return [(x, z) for x, z in loop] if s > 0 else [(-x, z) for x, z in reversed(loop)]


def mesh_from(name, verts, faces):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def sheet(name, outer, holes, yfun):
    """Flat (x, z) outline with holes, tessellated, vertices at y = yfun(x, z)."""
    loops = [[Vector((x, z, 0.0)) for x, z in outer]] + [[Vector((x, z, 0.0)) for x, z in h] for h in holes]
    tris = geometry.tessellate_polygon(loops)
    pts = [p for lp in loops for p in lp]
    bm = bmesh.new()
    vs = [bm.verts.new((p.x, yfun(p.x, p.y), p.y)) for p in pts]
    for a, b, c in tris:
        try:
            bm.faces.new((vs[a], vs[b], vs[c]))
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def loft(name, rows, closed=False):
    """Rows of 3D points with equal length; quads between consecutive rows."""
    bm = bmesh.new()
    vv = [[bm.verts.new(p) for p in r] for r in rows]
    n = len(rows[0])
    for i in range(len(rows) - 1):
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            try:
                bm.faces.new((vv[i][j], vv[i][k], vv[i + 1][k], vv[i + 1][j]))
            except ValueError:
                pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def sweep_x(name, prof, x0, x1):
    """Open (y, z) profile swept along x."""
    return loft(name, [[(x0, y, z) for y, z in prof], [(x1, y, z) for y, z in prof]])


def sweep_z(name, prof, z0, z1):
    """Open (x, y) profile swept along z."""
    return loft(name, [[(x, y, z0) for x, y in prof], [(x, y, z1) for x, y in prof]])


def box(name, x0, x1, y0, y1, z0, z1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    ob = bpy.context.active_object
    ob.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    ob.name = ob.data.name = name
    return ob


def cyl(name, loc, r, depth, axis="y", n=24):
    rot = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = ob.data.name = name
    bpy.ops.object.transform_apply(rotation=True)
    return ob


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


def end_x(z):
    """Outer end of the face at height z (the C12 kink between the end wall and the tie-bar end)."""
    (xa, za), (xb, zb) = KINK
    if z >= za:
        return xa
    if z <= zb:
        return xb
    return xb + (xa - xb) * (z - zb) / (za - zb)


def pan_outline(xi, zt, zb, r, n_line=10, n_arc=8):
    """Rim / floor-edge polyline of a lamp pan (driver side): top from the end inboard, inner side down, bottom out."""
    pts = []
    xs = end_x(zt)
    for i in range(n_line):
        pts.append((xs + (xi + r - xs) * i / n_line, zt))
    for i in range(n_arc + 1):
        a = math.pi / 2 + (math.pi / 2) * i / n_arc
        pts.append((xi + r + r * math.cos(a), zt - r + r * math.sin(a)))
    for i in range(1, n_line):
        pts.append((xi, zt - r + ((zb + r) - (zt - r)) * i / n_line))
    for i in range(n_arc + 1):
        a = math.pi + (math.pi / 2) * i / n_arc
        pts.append((xi + r + r * math.cos(a), zb + r + r * math.sin(a)))
    xe = end_x(zb)
    for i in range(1, n_line + 1):
        pts.append((xi + r + (xe - xi - r) * i / n_line, zb))
    return pts


def pan_y(z):
    """Front edge of the end wall: the pan floor where the pan is, the face elsewhere, linear across the pan walls."""
    if z <= RIM["zb"] or z >= RIM["zt"]:
        return YF
    if FLOOR["zb"] <= z <= FLOOR["zt"]:
        return YP
    if z < FLOOR["zb"]:
        return YF - PAN_D * (z - RIM["zb"]) / (FLOOR["zb"] - RIM["zb"])
    return YF - PAN_D * (RIM["zt"] - z) / (RIM["zt"] - FLOOR["zt"])


def where(x, z):
    """Which sheet a frame-01 hole lies in."""
    ax = abs(x)
    if POST[0] <= ax <= POST[1]:
        return "post"
    if math.hypot((ax - DOME_X) / (DOME_A + 0.006), (z - DOME_Z) / (DOME_B + 0.006)) < 1.0:
        return "dome"
    if ax >= FLOOR["xi"] and FLOOR["zb"] < z < FLOOR["zt"]:
        return "floor"
    return "face"


bpy.ops.wm.read_factory_settings(use_empty=True)
RIM_PTS = pan_outline(**RIM)
FLOOR_PTS = pan_outline(**FLOOR)
assert len(RIM_PTS) == len(FLOOR_PTS)

# ---------------------------------------------------------------- C2 radiator face: one flat sheet at YF
# outline counter-clockwise seen from the front: bottom edge, driver end with the pan notch, top, passenger end
outline = [(-X_END, Z_BB), (X_END, Z_BB)]
outline += list(reversed(RIM_PTS))                       # driver: bottom rim at the end -> inner side -> top rim
outline += [(X_TOPEND, Z_TOP), (-X_TOPEND, Z_TOP)]
outline += [(-x, z) for x, z in RIM_PTS]                 # passenger: top rim -> inner side -> bottom rim
face_holes = [OPENING]
face_holes += [circle(s * DOME_X, DOME_Z, DOME_A, 40, DOME_B) for s in (1, -1)]
for x, z, w, h in HOLES:
    if where(x, z) == "face":
        face_holes.append(circle(x, z, (w + h) / 4000.0, 16))
parts["radiator_face"] = solid(sheet("radiator_face", outline, face_holes, lambda x, z: YF))

# opening return flange, 20 mm toward the engine all round (10-26 receipt, NOS _16), assumed
parts["opening_flange"] = solid(loft("opening_flange", [[(x, YF, z) for x, z in OPENING],
                                                         [(x, YF + 0.020, z) for x, z in OPENING]], closed=True))

for s, sfx in ((1, "L"), (-1, "R")):
    # ------------------------------------------------------------ C11 lamp pan: drafted wall, flat floor with holes
    rim = [(s * x, YF, z) for x, z in RIM_PTS]
    flo = [(s * x, YP, z) for x, z in FLOOR_PTS]
    parts[f"lamp_pan_wall_{sfx}"] = solid(bevel(loft(f"lamp_pan_wall_{sfx}", [rim, flo]), 0.004, 2, 20))
    zb, zt = FLOOR["zb"], FLOOR["zt"]
    fl = list(FLOOR_PTS) + [(end_x(z), z) for z in (zb + (zt - zb) * i / 12 for i in range(1, 12))]
    holes = [circle(LAMP_X, LAMP_Z, LAMP_D / 2, 64), circle(PARK_X, PARK_Z, PARK_D / 2, 40),
             [(KEY[0] - KEY[3] / 2, KEY[1]), (KEY[0] + KEY[3] / 2, KEY[1]), (KEY[0] + KEY[4] / 2, KEY[2]),
              (KEY[0] - KEY[4] / 2, KEY[2])]]
    holes += [square(cx, cz, 0.006) for cx, cz in CAGES]
    holes += [circle(LOCATOR[0], LOCATOR[1], 0.004, 12)]
    for x, z, w, h in HOLES:
        far = lambda p: (abs(x) - p[0]) ** 2 + (z - p[1]) ** 2 > 0.0001  # noqa: E731
        if where(x, z) == "floor" and x * s > 0 and far(LOCATOR) and all(far(c) for c in CAGES):
            holes.append(circle(abs(x), z, (w + h) / 4000.0, 16))
    parts[f"lamp_pan_floor_{sfx}"] = solid(sheet(f"lamp_pan_floor_{sfx}", mirror(fl, s), [mirror(h, s) for h in holes],
                                                 lambda x, z: YP))
    LM[f"C11_headlamp_centre_{sfx}"] = (s * LAMP_X, YP, LAMP_Z)
    LM[f"C11_parkinglamp_centre_{sfx}"] = (s * PARK_X, YP, PARK_Z)
    LM[f"C11_key_window_{sfx}"] = (s * KEY[0], YP, (KEY[1] + KEY[2]) / 2)
    LM[f"C11_inner_step_{sfx}"] = (s * FLOOR["xi"], YP, 0.980)

    # cross bead across the floor between the lamps (frame 01 highlight band z 0.958-0.993), 7 mm proud, assumed
    bz0, bz1, bh = 0.960, 0.990, 0.007
    prof = [(YP, bz0 - 0.004), (YP - bh, bz0 + 0.006), (YP - bh, bz1 - 0.006), (YP, bz1 + 0.004)]
    xb0, xb1 = sorted((s * (LOCATOR[0] + 0.018), s * (end_x(0.975) - 0.004)))
    kw = box("kw", s * KEY[0] - 0.017, s * KEY[0] + 0.017, YP - 0.03, YP + 0.01, KEY[1] - 0.01, KEY[2] - 0.001)
    parts[f"cross_bead_{sfx}"] = cut(solid(sweep_x(f"cross_bead_{sfx}", prof, xb0, xb1)), kw)

    # domed locator boss with its screw hole (frame 01), 26 mm, 6 mm proud (height assumed)
    rows = []
    for i in range(7):
        rr = 0.013 * (1 - i / 6) + 0.004 * (i / 6)
        yy = YP - 0.006 * math.sin(math.pi / 2 * i / 6)
        rows.append([(s * LOCATOR[0] + rr * math.cos(2 * math.pi * k / 24), yy, LOCATOR[1] + rr * math.sin(2 * math.pi * k / 24))
                     for k in range(24)])
    parts[f"locator_boss_{sfx}"] = solid(loft(f"locator_boss_{sfx}", rows, closed=True))
    LM[f"C11_locator_boss_{sfx}"] = (s * LOCATOR[0], YP - 0.006, LOCATOR[1])

    # square nut cages on the floor front (frame 01 square holes), 16 mm, 6 mm tall
    cg = []
    for i, (cx, cz) in enumerate(CAGES):
        c = box("cage", s * cx - 0.008, s * cx + 0.008, YP - 0.006, YP, cz - 0.008, cz + 0.008)
        cg.append(cut(c, cyl("h", (s * cx, YP - 0.003, cz), 0.003, 0.02)))
        LM[f"C11_nutcage_{'ab'[i]}_{sfx}"] = (s * cx, YP - 0.006, cz)
    parts[f"nut_cages_{sfx}"] = join(f"nut_cages_{sfx}", cg)

    # notched collars: headlamp edge turned 8 mm forward with three notches, parking-lamp collar 12 mm (frame 01)
    col = []
    for cx, cz, d, dep, notches in ((LAMP_X, LAMP_Z, LAMP_D, 0.008, 3), (PARK_X, PARK_Z, PARK_D, 0.012, 0)):
        n = 72
        ring = [(s * cx + d / 2 * math.cos(2 * math.pi * k / n), cz + d / 2 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        verts = [(x, YP, z) for x, z in ring] + [(x, YP - dep, z) for x, z in ring]
        faces = []
        for k in range(n):
            ang = 360.0 * k / n
            if notches and any(abs(((ang - (90 + 120 * q)) + 180) % 360 - 180) < 8 for q in range(notches)):
                continue
            faces.append((k, (k + 1) % n, n + (k + 1) % n, n + k))
        col.append(solid(mesh_from("c", verts, faces)))
    parts[f"lamp_collars_{sfx}"] = join(f"lamp_collars_{sfx}", col)

    # ------------------------------------------------------------ C13 oval dome (forward) with its slotted tab
    rows = []
    for i in range(9):
        f = i / 8
        rows.append([(s * DOME_X + DOME_A * (1 - f * 0.92) * math.cos(2 * math.pi * k / 40),
                      YF - DOME_H * math.sin(math.pi / 2 * f) ** 0.7,
                      DOME_Z + DOME_B * (1 - f * 0.92) * math.sin(2 * math.pi * k / 40)) for k in range(40)])
    parts[f"oval_dome_{sfx}"] = solid(loft(f"oval_dome_{sfx}", rows, closed=True))
    parts[f"dome_tab_{sfx}"] = solid(sheet(f"dome_tab_{sfx}", circle(s * DOME_X, TAB_Z, 0.016, 24, 0.020),
                                           [circle(s * DOME_X, TAB_Z, 0.004, 12, 0.0075)], lambda x, z: YF - 0.004))
    LM["C13_dome_boss_centre_L" if s > 0 else "C13_dome_centre_R"] = (s * DOME_X, YF - DOME_H, DOME_Z)
    if s < 0:
        LM["C13_dome_hole_centre_R"] = (s * DOME_X, YF, DOME_Z)

    # ------------------------------------------------------------ C12 / C14 end wall at x = end_x(z): from the pan or
    # face edge back to 40 mm behind the face (fender flange), three fender-screw holes (vendor end view frame 13:
    # 173 / 293 / 404 mm below the top, +-10 %), up to the tie bar's open end
    zs = [Z_BB + (Z_TBB - Z_BB) * j / 90 for j in range(91)]
    zs = sorted(set(zs + [KINK[0][1], KINK[1][1], RIM["zb"], FLOOR["zb"], FLOOR["zt"], RIM["zt"]]))
    front = [(s * end_x(z), pan_y(z), z) for z in zs]
    back = [(s * end_x(z), YF + 0.040, z) for z in zs]
    ew = solid(loft(f"end_wall_{sfx}", [front, back]))
    hs = []
    for i, z in enumerate((1.090, 0.970, 0.859)):
        hs.append(cyl("h", (s * end_x(z), YF + 0.020, z), 0.0045, 0.03, "x", 16))
        if s > 0:
            LM[f"C14_flange_hole_{i + 1}_L"] = (s * end_x(z), YF + 0.020, z)
    parts[f"end_wall_{sfx}"] = cut(ew, *hs)
    LM[f"C12_kink_top_{sfx}"] = (s * KINK[0][0], YF, KINK[0][1])
    LM[f"C12_kink_bottom_{sfx}"] = (s * KINK[1][0], YF, KINK[1][1])

    # upper fender tab off the tie bar's front wall end (frame 01 tab at +-0.866, z 1.237; hole 26 mm under the top)
    parts[f"fender_tab_upper_{sfx}"] = solid(sheet(
        f"fender_tab_upper_{sfx}", mirror([(X_TOPEND - 0.010, 1.220), (0.905, 1.222), (0.905, 1.252), (X_TOPEND - 0.010, 1.256)], s),
        [mirror(circle(0.889, 1.237, 0.007, 16), s)], lambda x, z: YF - TB_F))
    LM[f"C1_tiebar_end_tab_{sfx}"] = (s * X_TOPEND, YF - TB_F, 1.237)
    if s > 0:
        LM["C14_upper_tab_hole_L"] = (s * 0.889, YF - TB_F, 1.237)
    # lower angled fender tab, forward off the end wall foot (frame 13: hole ~538 mm under the top), shape assumed
    lt = sweep_z(f"fender_tab_lower_{sfx}", [(s * X_END, YF), (s * X_END, YF - 0.030), (s * (X_END + 0.012), YF - 0.046)],
                 0.705, 0.745)
    parts[f"fender_tab_lower_{sfx}"] = cut(solid(lt), cyl("h", (s * X_END, YF - 0.020, 0.725), 0.006, 0.03, "x", 16))
    if s > 0:
        LM["C14_lower_tab_hole_L"] = (s * X_END, YF - 0.020, 0.725)

# ---------------------------------------------------------------- C1 upper tie bar: open C-channel at the hood line
tb = [(YF + TB_B, Z_TOP - 0.024), (YF + TB_B, Z_TOP), (YF - TB_F, Z_TOP), (YF - TB_F, Z_TBB), (YF - TB_F + 0.015, Z_TBB)]
tbar = solid(bevel(sweep_x("upper_tie_bar", tb, -X_TOPEND, X_TOPEND), 0.003, 2, 30))
# top-flange holes (frame 01 dimples at x -0.357, -0.118, +0.112, +0.350)
parts["upper_tie_bar"] = cut(tbar, *[cyl("h", (x, YF - 0.010, Z_TOP), 0.005, 0.02, "z", 16) for x in (-0.357, -0.118, 0.112, 0.350)])
for s, sfx in ((1, "L"), (-1, "R")):
    LM[f"C1_tiebar_top_edge_{sfx}"] = (s * 0.778, YF - TB_F, Z_TOP)
    LM[f"C1_tiebar_visible_end_{sfx}"] = (s * X_TOPEND, YF - TB_F, Z_TOP)
LM["C1_tiebar_top_pt_L"] = (0.664, YF - TB_F, Z_TOP)    # the x along the edge where c6b40497 was picked
LM["C1_tiebar_top_pt_R"] = (-0.684, YF - TB_F, Z_TOP)
ROW = [(-0.7595, 1.2129), (-0.6064, 1.2151), (-0.3178, 1.2265), (-0.1379, 1.2336), (0.0434, 1.2344), (0.2256, 1.2339),
       (0.5447, 1.2097), (0.6044, 1.2185), (0.7609, 1.2161)]
for i, (x, z) in enumerate(ROW):
    LM[f"C1_row_hole_{i + 1:02d}"] = (x, YF, z)

# hood bumpers (C1 studs): a tab under the front wall and a rubber mushroom on it, at the c6b40497 rays
studs = []
for x in STUD_X:
    studs += [box("t", x - 0.014, x + 0.014, YF - TB_F - 0.024, YF - TB_F, 1.219, 1.222),
              cyl("s", (x, YF - TB_F - 0.012, 1.226), 0.005, 0.008, "z", 16),
              cyl("m", (x, YF - TB_F - 0.012, 1.2355), 0.011, 0.009, "z", 24)]
    LM["C1_hood_stud_L" if x > 0 else "C1_hood_stud_R"] = (x, YF - TB_F - 0.012, STUD_Z)
parts["hood_bumpers"] = join("hood_bumpers", studs)


# ---------------------------------------------------------------- C2 landmarks read off the built opening outline
def op_pt(name, near):
    p = min(OPENING, key=lambda q: (q[0] - near[0]) ** 2 + (q[1] - near[1]) ** 2)
    LM[name] = (p[0], YF, p[1])


def op_cross(v, along_x):
    """Opening outline crossings of the line z = v (along_x) or x = v."""
    out = []
    n = len(OPENING)
    for i in range(n):
        a, b = OPENING[i], OPENING[(i + 1) % n]
        ia, ib = (1, 0) if along_x else (0, 1)
        if (a[ia] - v) * (b[ia] - v) <= 0 and a[ia] != b[ia]:
            out.append(a[ib] + (v - a[ia]) * (b[ib] - a[ib]) / (b[ia] - a[ia]))
    return out


op_pt("C2_opening_corner_L", (0.3636, 1.174))
op_pt("C2_opening_corner_R", (-0.3545, 1.1737))
LM["C2_opening_left_edge"] = (min(op_cross(1.0352, True)), YF, 1.0352)
LM["C2_opening_right_edge"] = (max(op_cross(1.0383, True)), YF, 1.0383)
LM["C2_opening_top_edge"] = (-0.0635, YF, max(op_cross(-0.0635, False)))
op_pt("C2_step_bottom_R", (-0.2754, 1.1837))
op_pt("C2_step_top_R", (-0.2049, 1.2224))
for nm, x in (("C2_tongue_apex_R", -0.1375), ("C2_tongue_apex_C", 0.0434), ("C2_tongue_apex_L", 0.2255)):
    p = min((q for q in OPENING if abs(q[0] - x) < 0.03 and q[1] > 1.1), key=lambda q: q[1])
    LM[nm] = (p[0], YF, p[1])
LM["C9_opening_bottom_edge"] = (0.0063, YF, min(op_cross(0.0063, False)))

# ---------------------------------------------------------------- C5 radiator posts (double channel), C6 feet, C7, C8
for s, sfx in ((1, "L"), (-1, "R")):
    xi, xo = POST
    di, do = POST_D
    prof = [(xi, YF), (xi + 0.007, YF - di), (SEAM[0] - 0.007, YF - di), (SEAM[0], YF - 0.015), (SEAM[1], YF - 0.015),
            (SEAM[1] + 0.006, YF - do), (xo - 0.006, YF - do), (xo, YF)]
    prof = [(s * x, y) for x, y in prof]
    post = solid(bevel(sweep_z(f"radiator_post_{sfx}", prof if s > 0 else prof[::-1], Z_BT, Z_TBB), 0.003, 2, 30))
    hs = [cyl("h", (x, YF - 0.05, z), (w + h) / 4000.0, 0.06, "y", 16) for x, z, w, h in HOLES
          if where(x, z) == "post" and x * s > 0]
    parts[f"radiator_post_{sfx}"] = cut(post, *hs) if hs else post
    LM[f"C5_post_inner_edge_{sfx}"] = (s * xi, YF, 0.980)
    LM[f"C5_post_outer_edge_{sfx}"] = (s * xo, YF, 0.980)

    # post foot: the channels close into a box under the band, bottom plate at FOOT_Z with the vertical bolt hole,
    # an oval access hole in the front over the bolt (81-88 install video), a drop tab at the outer front corner
    x0, x1 = sorted((s * xi, s * xo))
    yb0, yb1 = YF - di, YF + 0.035
    ring = [(x0, yb0), (x1, yb0), (x1, yb1), (x0, yb1), (x0, yb0)]
    walls = sweep_z("fw", ring, FOOT_Z, Z_BT)
    plate = mesh_from("fp", [(x0, yb0, FOOT_Z), (x1, yb0, FOOT_Z), (x1, yb1, FOOT_Z), (x0, yb1, FOOT_Z)], [(0, 1, 2, 3)])
    foot = solid(join(f"post_foot_{sfx}", [walls, plate]))
    acc = cyl("acc", (s * FOOT_X, yb0, 0.745), 0.016, 0.03, "y", 24)
    acc.scale = (1.0, 1.0, 1.35)
    bpy.context.view_layer.objects.active = acc
    bpy.ops.object.transform_apply(scale=True)
    parts[f"post_foot_{sfx}"] = cut(foot, cyl("h", (s * FOOT_X, FOOT_Y, FOOT_Z), 0.0085, 0.03, "z", 24), acc)
    tabx = s * 0.506
    parts[f"foot_tab_{sfx}"] = box(f"foot_tab_{sfx}", tabx - 0.007, tabx + 0.007, YF - 0.0006, YF + 0.0006, 0.682, FOOT_Z + 0.004)
    LM[f"C6_foot_tab_{sfx}"] = (tabx, YF, 0.682)
    LM[f"C6_foot_bottom_centre_{sfx}"] = (s * FOOT_X, FOOT_Y, FOOT_Z)
    LM[f"C6_foot_bottom_inner_{sfx}"] = (s * xi, YF, FOOT_Z)
    LM[f"C6_foot_bottom_outer_{sfx}"] = (s * xo, YF, FOOT_Z)

    # C7 frame-side bracket on the outside of the horn (RB7360 repro of the factory riveted box: top plate with the
    # cushion hole, a wall against the web with 6 rivets, outer wall and two gussets); size assumed +-20
    bx0, bx1 = HORN_X, 0.532
    by0, by1 = FOOT_Y - 0.055, FOOT_Y + 0.055
    top = mesh_from("bt", [(s * bx0, by0, CUP_TOP), (s * bx1, by0, CUP_TOP), (s * bx1, by1, CUP_TOP), (s * bx0, by1, CUP_TOP)],
                    [(0, 1, 2, 3)])
    top = cut(solid(top, 0.003, -1.0 if s > 0 else 1.0), cyl("h", (s * FOOT_X, FOOT_Y, CUP_TOP), 0.024, 0.03, "z", 40))
    web = solid(sweep_z("bw", [(s * (bx0 + 0.002), by0), (s * (bx0 + 0.002), by1)], CUP_TOP - 0.075, CUP_TOP), 0.003)
    outer = solid(sweep_z("bo", [(s * bx1, by0), (s * bx1, by1)], CUP_TOP - 0.040, CUP_TOP), 0.0025)
    gus = [solid(mesh_from("g", [(s * bx0, yy, CUP_TOP - 0.075), (s * bx0, yy, CUP_TOP), (s * bx1, yy, CUP_TOP),
                                 (s * bx1, yy, CUP_TOP - 0.040)], [(0, 1, 2, 3)]), 0.0025) for yy in (by0, by1)]
    riv = [cyl("r", (s * (bx0 + 0.006), by0 + 0.020 + 0.035 * i, CUP_TOP - 0.022 - 0.030 * j), 0.0055, 0.006, "x", 16)
           for i in range(3) for j in range(2)]
    parts[f"frame_bracket_{sfx}"] = join(f"frame_bracket_{sfx}", [top, web, outer] + gus + riv)
    LM[f"C7_cup_hole_centre_{sfx}"] = (s * FOOT_X, FOOT_Y, CUP_TOP)

    # C8 cushion stack: upper cushion ~23 x 62 on the foot plate, lower ~25 x 57 under the bracket plate, M10 bolt,
    # retainer, washer, nut (OER T71209 photo with the bolt head as ruler, +-20 %)
    zt_ = FOOT_Z + 0.0012 + 0.023
    up = cut(cyl("uc", (s * FOOT_X, FOOT_Y, FOOT_Z + 0.0012 + 0.0115), 0.031, 0.023, "z", 40),
             cyl("h", (s * FOOT_X, FOOT_Y, FOOT_Z + 0.012), 0.0085, 0.05, "z", 24))
    lo = cut(cyl("lc", (s * FOOT_X, FOOT_Y, CUP_TOP - 0.003 - 0.0125), 0.0285, 0.025, "z", 40),
             cyl("h", (s * FOOT_X, FOOT_Y, CUP_TOP - 0.015), 0.0085, 0.05, "z", 24))
    parts[f"body_mount_cushion_{sfx}"] = join(f"body_mount_cushion_{sfx}", [up, lo])
    hw = [cyl("w", (s * FOOT_X, FOOT_Y, zt_ + 0.0015), 0.025, 0.003, "z", 32),
          cyl("b", (s * FOOT_X, FOOT_Y, zt_ + 0.003 + 0.004), 0.0085, 0.008, "z", 6),
          cyl("sh", (s * FOOT_X, FOOT_Y, (zt_ + CUP_TOP - 0.045) / 2), 0.005, zt_ - CUP_TOP + 0.045, "z", 16),
          cyl("lw", (s * FOOT_X, FOOT_Y, CUP_TOP - 0.0295), 0.020, 0.003, "z", 32),
          cyl("n", (s * FOOT_X, FOOT_Y, CUP_TOP - 0.036), 0.0085, 0.009, "z", 6)]
    parts[f"mount_hardware_{sfx}"] = join(f"mount_hardware_{sfx}", hw)

# ---------------------------------------------------------------- C9 lower tie bar: band (in the face), shelf, lip
for s, sfx in ((1, "L"), (-1, "R")):
    xa, xb = sorted((s * POST[1], s * X_END))
    sh = solid(bevel(sweep_x(f"lower_tie_bar_{sfx}", [(YF, Z_BB), (YF + SHELF, Z_BB), (YF + SHELF, Z_BB + LIP)], xa, xb),
                     0.003, 2, 30))
    # C15 fender-skirt screw holes in the rear lip (count not established: 3 a side assumed)
    parts[f"lower_tie_bar_{sfx}"] = cut(sh, *[cyl("h", (s * x, YF + SHELF, Z_BB + 0.013), 0.0035, 0.02, "y", 12)
                                              for x in (0.62, 0.72, 0.82)])
    LM[f"C9_band_top_edge_{sfx}"] = ((0.3795 if s > 0 else -0.3613), YF, Z_BT)
    LM[f"C9_band_bottom_edge_{sfx}"] = ((0.3289 if s > 0 else -0.3497), YF, Z_BB)
# centre section between the posts: a channel with a rear wall to band height, two pressed ribs, three holes (NOS _07/_15)
ctr = solid(bevel(sweep_x("lower_tie_bar_centre", [(YF, Z_BB), (YF + SHELF, Z_BB), (YF + SHELF, Z_BT)], -POST[0], POST[0]),
                  0.003, 2, 30))
parts["lower_tie_bar_centre"] = cut(ctr, *[cyl("h", (x, YF + SHELF, 0.745), 0.005, 0.02, "y", 16) for x in (-0.15, 0.0, 0.15)])
ribs = [sweep_x("rib", [(YF + SHELF, z - 0.004), (YF + SHELF + 0.004, z - 0.002), (YF + SHELF + 0.004, z + 0.002),
                         (YF + SHELF, z + 0.004)], -POST[0] + 0.02, POST[0] - 0.02) for z in (0.728, 0.762)]
parts["lower_tie_bar_ribs"] = solid(join("lower_tie_bar_ribs", ribs))

# ---------------------------------------------------------------- C10 radiator cradle pockets with rubber blocks
for x, sfx in zip(POCKETS, ("L", "R")):
    y0, y1 = YF + 0.052, YF + 0.100
    z0, z1 = POCKET_Z
    sides = sweep_z("pk", [(x - 0.030, y0), (x - 0.030, y1), (x + 0.030, y1), (x + 0.030, y0)], z0, z1)
    base = mesh_from("pb", [(x - 0.030, y0, z0), (x + 0.030, y0, z0), (x + 0.030, y1, z0), (x - 0.030, y1, z0)], [(0, 1, 2, 3)])
    pk = solid(join(f"radiator_pocket_{sfx}", [sides, base]))
    slots = [box("sl", x + dx - 0.004, x + dx + 0.004, y1 - 0.01, y1 + 0.01, z0 + 0.012, z1 - 0.010) for dx in (-0.016, 0, 0.016)]
    parts[f"radiator_pocket_{sfx}"] = cut(pk, *slots)
    parts[f"radiator_cushion_{sfx}"] = box(f"radiator_cushion_{sfx}", x - 0.026, x + 0.026, y0 + 0.004, y1 - 0.004, z0 + 0.003,
                                           z1 + 0.012)
    LM[f"C10_pocket_centre_{sfx}"] = (x, (y0 + y1) / 2, (z0 + z1) / 2)

# ---------------------------------------------------------------- C3 hood lock: catch on the tie-bar top, release lever
# in front, full-height centre support (GM ST-330-78 Fig 2C-3); sizes assumed +-20 mm
cs_prof = [(LATCH_X - 0.050, YF - TB_F - 0.001), (LATCH_X - 0.035, YF - TB_F - 0.001), (LATCH_X - 0.030, YF - TB_F - 0.022),
           (LATCH_X + 0.030, YF - TB_F - 0.022), (LATCH_X + 0.035, YF - TB_F - 0.001), (LATCH_X + 0.050, YF - TB_F - 0.001)]
csup = solid(bevel(sweep_z("hood_lock_support", cs_prof, Z_BT + 0.010, Z_TOP), 0.003, 2, 30), 0.0015)
parts["hood_lock_support"] = cut(csup, box("w", LATCH_X - 0.015, LATCH_X + 0.015, YF - 0.09, YF - 0.06, 1.02, 1.11),
                                 box("q", LATCH_X - 0.009, LATCH_X + 0.009, YF - 0.09, YF - 0.06, 0.95, 0.968))
catch = box("hood_lock_catch", LATCH_X - 0.045, LATCH_X + 0.045, YF - TB_F + 0.002, YF + 0.030, Z_TOP, Z_TOP + 0.003)
guide = cut(box("g", LATCH_X - 0.022, LATCH_X + 0.022, YF - 0.035, YF + 0.010, Z_TOP + 0.003, Z_TOP + 0.016),
            cyl("h", (LATCH_X, YF - 0.012, Z_TOP + 0.01), 0.010, 0.04, "z", 24))
lever = box("lv", LATCH_X - 0.010, LATCH_X + 0.010, YF - 0.077, YF - 0.073, 1.190, 1.2685)
arm = box("la", LATCH_X - 0.010, LATCH_X + 0.010, YF - 0.077, YF - TB_F - 0.022, 1.2645, 1.2685)
parts["hood_lock_catch"] = join("hood_lock_catch", [catch, guide, lever, arm])
LM["C3_latch_lever_top"] = (LATCH_X, YF - 0.075, 1.2685)

# ---------------------------------------------------------------- C4 radiator mounting panel: curved hat strip on the
# engine side of the tie-bar top (GM Fig 2C-20; owner f6203444 top view), section assumed
rows = []
for k in range(41):
    x = -0.400 + 0.800 * k / 40
    sag = 0.010 * (1 - (x / 0.400) ** 2)
    rows.append([(x, YF + TB_B - 0.025, Z_TOP + 0.0015), (x, YF + TB_B + 0.020, Z_TOP + 0.0015),
                 (x, YF + TB_B + 0.026, Z_TOP - 0.018 - sag), (x, YF + TB_B + 0.060, Z_TOP - 0.018 - sag),
                 (x, YF + TB_B + 0.066, Z_TOP - 0.040 - sag)])
rows = [list(r) for r in zip(*rows)]   # rows along x per profile point -> loft across the profile
rmp = solid(loft("radiator_mounting_panel", rows), 0.0015)
bolts = [cyl("b", (x, YF + TB_B - 0.010, Z_TOP + 0.006), 0.0085, 0.006, "z", 6) for x in (-0.38, -0.33, 0.33, 0.38)]
parts["radiator_mounting_panel"] = join("radiator_mounting_panel", [rmp] + bolts)


# ---------------------------------------------------------------- materials, names, parent, export
def mat(name, rgb, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    return m


# black e-coat: owner photos 3040b57d (original support, black worn to bare at the edges) and 33a89651 (new support)
EDP = mat("edp_black", (0.035, 0.035, 0.037), 0.0, 0.45)
RUB = mat("rubber", (0.015, 0.015, 0.015), 0.0, 0.85)
ZN = mat("zinc", (0.55, 0.55, 0.52), 1.0, 0.35)
root = bpy.data.objects.new("core_support", None)
bpy.context.collection.objects.link(root)
for n in sorted(parts):
    o = parts[n]
    o.name = n
    o.data.name = n
    o.data.materials.clear()
    o.data.materials.append(RUB if ("cushion" in n or n == "hood_bumpers") else ZN if n.startswith("mount_hardware") else EDP)
    o.parent = root
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))

tris = sum(len(p.vertices) - 2 for o in parts.values() for p in o.data.polygons)
bpy.ops.object.select_all(action="SELECT")
os.makedirs(os.path.dirname(os.path.abspath(OUT_GLB)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_yup=True,
                          export_extras=False, export_apply=True, export_draco_mesh_compression_enable=False,
                          export_texcoords=False, export_normals=True)

# strip extras and refuse credential-looking bytes (the same rules as chassis_frame.strip_and_scan)
raw = open(OUT_GLB, "rb").read()
jl = struct.unpack("<I", raw[12:16])[0]
j = json.loads(raw[20:20 + jl])
rest = raw[20 + jl:]
j.pop("extras", None)
for sc in j.get("scenes", []):
    sc.pop("extras", None)
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
raw = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
low = raw.lower()
hits = [w for w in (b"api_key", b"token", b"secret", b"blendermcp", b"sketchfab") if w in low]
hits += [b"hex32"] if re.search(rb"[0-9a-fA-F]{32}", js) else []
hits += [b"draco"] if b"KHR_draco" in raw else []
if hits:
    raise SystemExit(f"refusing to ship {OUT_GLB}: found {hits}")
open(OUT_GLB, "wb").write(raw)

out = {"_frame": "twin metres, +x driver, -y forward, +z up; written by core_support_blender.py from its own geometry"}
for k in sorted(LM):
    out[k] = [round(float(c), 4) for c in LM[k]]
with open(OUT_LM, "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"CORE_SUPPORT glb {OUT_GLB} {len(raw)} bytes, {len(parts)} meshes, {tris} triangles, {len(LM)} landmarks")
