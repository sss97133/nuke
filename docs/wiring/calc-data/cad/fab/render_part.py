"""Studio render of one part GLB in headless Blender (Cycles).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python \
        docs/wiring/calc-data/cad/fab/render_part.py -- <part.glb> <out_dir> [--upright] [--px 1600]

Writes <out>/<id>_hero.png (3/4 view, keep-outs hidden), <id>_clearance.png (3/4 from below, keep-outs shown)
and <id>_photo_match.png (straight on, a few degrees above, transparent background, for a side-by-side with the
maker's photo). Objects whose name starts with "keep-out" or contains "envelope" are the clearance volumes.
--upright stands a wall-mounted part up the way its maker photographs it (the part's +Y becomes up).
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out = Path(argv[0]).expanduser(), Path(argv[1]).expanduser()
upright = "--upright" in argv
px = int(argv[argv.index("--px") + 1]) if "--px" in argv else 1600
LIGHT = float(argv[argv.index("--light") + 1]) if "--light" in argv else 0.042   # calibrated with the edge lights: the M130 case face renders near the photo's #2d2e2f
FAST = "--fast" in argv
PHOTO_EL = float(argv[argv.index("--photo-el") + 1]) if "--photo-el" in argv else 12.0
out.mkdir(parents=True, exist_ok=True)
pid = glb.stem

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
scene = bpy.context.scene
parts = [o for o in scene.objects if o.type == "MESH"]
root = bpy.data.objects.new("root", None)
scene.collection.objects.link(root)
for o in scene.objects:
    if o.parent is None and o is not root:
        o.parent = root
if upright:
    root.rotation_euler = Euler((math.radians(90), 0, 0))
bpy.context.view_layer.update()


def is_clear(o):
    n = o.name.lower()
    return n.startswith("keep-out") or "envelope" in n


def is_mated(o):
    n = o.name.lower()
    return " plug:" in n or "backshell:" in n or n.startswith("mated ")


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


solid = [o for o in parts if not is_clear(o)]
lo, hi = bounds(solid)
print("part bounds (m):", [round(v, 4) for v in lo], [round(v, 4) for v in hi], "size mm:",
      [round((hi[i] - lo[i]) * 1000, 2) for i in range(3)])
ctr = (lo + hi) / 2
size = max(hi - lo)


# ---- materials: keep each GLB base colour, set the finish
def finish(o):
    n = o.name.lower()
    if "pin" in n:
        return dict(rough=0.3, metal=1.0, spec=0.5)
    if "label" in n:
        return dict(rough=0.3, metal=0.0, spec=0.4)
    if "header" in n:
        return dict(rough=0.4, metal=0.0, spec=0.35)
    return dict(rough=0.5, metal=0.0, spec=0.3, bump=True)


noise_bump = {}
for o in parts:
    for slot in o.material_slots:
        m = slot.material
        if m is None or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        if is_clear(o):
            keep = "keep" in o.name.lower()
            bsdf.inputs["Base Color"].default_value = (0.95, 0.45, 0.05, 1) if keep else (0.25, 0.3, 0.36, 1)
            bsdf.inputs["Roughness"].default_value = 0.6
            bsdf.inputs["Alpha"].default_value = 0.22 if keep else 0.45
            continue
        f = finish(o)
        bsdf.inputs["Roughness"].default_value = f["rough"]
        bsdf.inputs["Metallic"].default_value = f["metal"]
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = f["spec"]
        if f.get("bump") and m.name not in noise_bump:
            tex = nt.nodes.new("ShaderNodeTexNoise")
            tex.inputs["Scale"].default_value = 900.0
            tex.inputs["Detail"].default_value = 2.0
            bump = nt.nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 0.015
            bump.inputs["Distance"].default_value = 0.0002
            nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
            nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
            noise_bump[m.name] = True

# ---- studio: HDRI world, key + rim area lights, a seamless light-grey floor
world = bpy.data.worlds.new("studio")
scene.world = world
world.use_nodes = True
wn = world.node_tree
env = wn.nodes.new("ShaderNodeTexEnvironment")
hdri = Path(bpy.utils.resource_path("LOCAL")) / "datafiles" / "studiolights" / "world" / "studio.exr"
env.image = bpy.data.images.load(str(hdri))
bg = wn.nodes["Background"]
bg.inputs["Strength"].default_value = 0.3 * LIGHT
wn.links.new(env.outputs["Color"], bg.inputs["Color"])

bpy.ops.mesh.primitive_plane_add(size=size * 30, location=(ctr.x, ctr.y, lo.z - 0.012))
floor = bpy.context.active_object
floor.name = "studio floor"
fm = bpy.data.materials.new("floor")
fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.82, 0.83, 0.85, 1)
fb.inputs["Roughness"].default_value = 0.35
floor.data.materials.append(fm)
floor.is_shadow_catcher = True


def area(name, loc, energy, sz):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = sz
    lo_ = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo_)
    lo_.location = loc
    d = ctr - Vector(loc)
    lo_.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return lo_


s = size
area("key", (ctr.x - 2.2 * s, ctr.y - 2.6 * s, ctr.z + 2.8 * s), LIGHT * 60 * s * s * 40, 2.2 * s)
area("fill", (ctr.x + 3.0 * s, ctr.y - 1.5 * s, ctr.z + 1.2 * s), LIGHT * 18 * s * s * 40, 2.5 * s)
area("rim", (ctr.x + 1.5 * s, ctr.y + 3.0 * s, ctr.z + 2.5 * s), LIGHT * 45 * s * s * 40, 1.5 * s)
# edge lights: two strips behind and above, left and right, so black parts show their edges, chamfers and slopes
area("edge_l", (ctr.x - 2.4 * s, ctr.y + 2.2 * s, ctr.z + 1.8 * s), LIGHT * 140 * s * s * 40, 0.6 * s)
area("edge_r", (ctr.x + 2.6 * s, ctr.y + 1.6 * s, ctr.z + 2.4 * s), LIGHT * 120 * s * s * 40, 0.6 * s)

cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.lens = 85
cam_d.sensor_width = 36
cam_d.clip_start = 0.0005      # Blender's 0.1 m default clips parts under ~30 mm (a 7 mm stub splice rendered blank)
cam_d.clip_end = 200.0

scene.render.engine = "CYCLES"
scene.cycles.samples = 16 if FAST else 160
scene.cycles.use_denoising = True
try:
    scene.cycles.device = "GPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception:
    scene.cycles.device = "CPU"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"


wire_objs = []
for o in [o for o in parts if is_clear(o)]:
    bb = [Vector(c) for c in o.bound_box]
    me = bpy.data.meshes.new("wire " + o.name)
    me.from_pydata(bb, [], [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])
    w = bpy.data.objects.new("wire " + o.name, me)
    w.matrix_world = o.matrix_world.copy()
    scene.collection.objects.link(w)
    mod = w.modifiers.new("wire", "WIREFRAME")
    mod.thickness = 0.0006
    wm = bpy.data.materials.new("wire " + o.name)
    wm.use_nodes = True
    wb = wm.node_tree.nodes["Principled BSDF"]
    keep = "keep" in o.name.lower()
    wb.inputs["Base Color"].default_value = (0.75, 0.3, 0.0, 1) if keep else (0.15, 0.18, 0.22, 1)
    w.data.materials.append(wm)
    wire_objs.append(w)


scene.use_nodes = True
ctree = scene.node_tree
for n in list(ctree.nodes):
    ctree.nodes.remove(n)
rl = ctree.nodes.new("CompositorNodeRLayers")
ao = ctree.nodes.new("CompositorNodeAlphaOver")
comp = ctree.nodes.new("CompositorNodeComposite")
ao.inputs[1].default_value = (0.86, 0.87, 0.88, 1.0)
ctree.links.new(rl.outputs["Image"], ao.inputs[2])
ctree.links.new(ao.outputs["Image"], comp.inputs["Image"])


def shoot(name, az_deg, el_deg, w, h, show_clear, transparent=False, fit=1.18, show_mated=True):
    for o in parts:
        o.hide_render = (is_clear(o) and not show_clear) or (is_mated(o) and not show_mated)
    for o in wire_objs:
        o.hide_render = not show_clear
    floor.hide_render = transparent
    scene.render.film_transparent = True
    ao.mute = transparent
    if transparent:
        ctree.links.new(rl.outputs["Image"], comp.inputs["Image"])
    else:
        ctree.links.new(ao.outputs["Image"], comp.inputs["Image"])
    objs = [o for o in parts if not o.hide_render]
    lo_, hi_ = bounds(objs)
    floor.location.z = lo_.z - (0.004 if show_clear else 0.012)
    c = (lo_ + hi_) / 2
    az, el = math.radians(az_deg), math.radians(el_deg)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    corners = [Vector((x, y, z)) for x in (lo_.x, hi_.x) for y in (lo_.y, hi_.y) for z in (lo_.z, hi_.z)]
    f = -d
    r = f.cross(Vector((0, 0, 1))).normalized()
    u = r.cross(f).normalized()
    ext = max(max(abs((p - c).dot(r)) for p in corners) * 2 / (w / h), max(abs((p - c).dot(u)) for p in corners) * 2)
    sensor_h = cam_d.sensor_width * (h / w if w > h else 1.0)
    depth = max(abs((p - c).dot(f)) for p in corners)
    dist = ext * fit * cam_d.lens / sensor_h + depth
    cam.location = c + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = str(out / f"{pid}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)


if FAST:
    shoot("hero", 38, 22, 400, 300, show_clear=False)
else:
    shoot("hero", 38, 22, px, int(px * 0.75), show_clear=False)
    shoot("clearance", 35, -12 if not upright else 18, px, int(px * 0.9), show_clear=True, fit=1.08)
    shoot("photo_match", 0, PHOTO_EL, 1000, 1000, show_clear=False, transparent=True, fit=1.3, show_mated=False)
    shoot("bare", 38, 22, px, int(px * 0.75), show_clear=False, show_mated=False)
