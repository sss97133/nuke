"""Check renders of the chassis GLBs in headless Blender (EEVEE): top, driver side and 3/4, with the twin's axle
centres, wheels and firewall station drawn as thin grey references (render only; they are not in any GLB).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python \
        docs/wiring/calc-data/cad/fab/render_frame.py -- <out_dir> <a.glb> [<b.glb> ...] [--px 2000]
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
px = int(argv[argv.index("--px") + 1]) if "--px" in argv else 2000
args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--px")]
out, glbs = Path(args[0]).expanduser(), [Path(a).expanduser() for a in args[1:]]
out.mkdir(parents=True, exist_ok=True)
FRONT_AXLE, REAR_AXLE, FIREWALL, WHEEL_R, TRACK = -1.896, 0.807, -1.46, 0.406, 1.72   # twin constants; wheel from the
# twin's TurboSquid Wheel_Front_Left (z -0.010..0.802, x 0.694..1.026)

bpy.ops.wm.read_factory_settings(use_empty=True)
for g in glbs:
    bpy.ops.import_scene.gltf(filepath=str(g))
scene = bpy.context.scene
parts = [o for o in scene.objects if o.type == "MESH"]


def mat(name, rgba, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Roughness"].default_value = rough
    if rgba[3] < 1:
        b.inputs["Alpha"].default_value = rgba[3]
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    return m


ref = mat("ref", (0.55, 0.58, 0.62, 0.35))
for x in (TRACK / 2, -TRACK / 2):          # wheels at the twin's axle centres (y is forward-negative, z up)
    for y in (FRONT_AXLE, REAR_AXLE):
        bpy.ops.mesh.primitive_cylinder_add(radius=WHEEL_R, depth=0.25, location=(x, y, WHEEL_R - 0.01),
                                            rotation=(0, math.radians(90), 0))
        o = bpy.context.active_object
        o.name = "ref wheel"
        o.data.materials.append(ref)
for y in (FRONT_AXLE, REAR_AXLE):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=TRACK, location=(0, y, WHEEL_R - 0.01),
                                        rotation=(0, math.radians(90), 0))
    bpy.context.active_object.data.materials.append(ref)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, FIREWALL, 1.2))    # a thin marker at the firewall station
fw = bpy.context.active_object
fw.scale = (1.5, 0.012, 0.6)
fw.data.materials.append(mat("fw", (0.35, 0.55, 0.85, 1.0)))
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, -0.5, -0.012))
bpy.context.active_object.data.materials.append(mat("floor", (0.9, 0.9, 0.91, 1)))

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.92, 0.93, 0.95, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
for name, loc, e in (("key", (-4, -5, 6), 900), ("fill", (5, -2, 3), 350), ("rim", (2, 5, 5), 500)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size = e, 4
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (Vector((0, -0.5, 0.5)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"

pts = [o.matrix_world @ Vector(c) for o in parts for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
ctr = (lo + hi) / 2
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.clip_end = 100


def shoot(name, direction, right=None, ortho=None, w=px, h=int(px * 0.56), dist=12.0):
    """Camera on `direction` from the model's centre, looking back at it; `right` = world axis the image's right edge
    points along (front of the truck to the image's left: right = +y)."""
    d = Vector(direction).normalized()
    cam_d.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam_d.ortho_scale = ortho
    else:
        cam_d.lens = 50
    cam.location = ctr + d * dist
    if right is None:
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    else:
        rx = Vector(right).normalized()
        ry = d.cross(rx).normalized()
        cam.rotation_euler = Matrix((rx, ry, d)).transposed().to_euler()
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = str(out / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)


L = max(hi.y - lo.y, 5.4)
shoot("top", (0, 0, 1), right=(0, 1, 0), ortho=L * 1.06)    # plan from above: front left, driver side at the bottom
shoot("side", (1, 0, 0), right=(0, 1, 0), ortho=L * 1.06)   # from the driver side (+x): front left
shoot("three_quarter", (1.0, -1.1, 0.75), dist=6.8)          # front driver-side 3/4
