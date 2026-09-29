"""Render orthographic layout views of the K5 twin body (TurboSquid 1978 Blazer, scaled to the 2,703 mm wheelbase)
plus the v3 engine. Writes PNGs and the camera parameters so a 2-D overlay can place endpoints by world coordinates.
Axes: +x = driver, -y = front, +z = up (twin convention)."""
import bpy, json, math, os

OUT = "/private/tmp/claude-501/-Users-skylar/ebc425ad-1dc1-45a9-8e44-0ccef2f39e27/scratchpad/loc/render"
os.makedirs(OUT, exist_ok=True)
KEEP_COLLS = {"1978_Chevrolet_Blazer", "K5H_E3_Longblock", "K5H_E3_Induction", "K5H_E3_Exhaust", "K5H_E3_AccessoryDrive",
              "K5H_E3_Ignition", "K5H_E3_Driveline"}
KEEP_NAMES = {"Body_Mount_Crossmembers", "Exterior_Body_Blazer"}

sc = bpy.context.scene
for ob in bpy.data.objects:
    keep = (ob.name in KEEP_NAMES) or any(c.name in KEEP_COLLS for c in ob.users_collection)
    if ob.name.startswith("ANCHOR_"):
        keep = False
    ob.hide_render = not keep
for c in bpy.data.collections:
    c.hide_render = False

sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"
sh.color_type = "SINGLE"
sh.single_color = (0.80, 0.80, 0.80)
sh.show_xray = True
sh.xray_alpha = 0.22
sh.show_object_outline = True
sh.object_outline_color = (0.15, 0.15, 0.15)
sh.show_cavity = False
sc.render.film_transparent = False
if sc.world is None:
    sc.world = bpy.data.worlds.new("W")
sc.world.color = (1, 1, 1)
sc.display.render_aa = "8"
sc.render.image_settings.file_format = "PNG"

views = {
    # name: (location, rotation_euler degrees, ortho_scale, resx, resy)
    "top": ((0.0, -0.37, 20.0), (0, 0, 90), 5.3, 3200, 1500),
    "side": ((20.0, -0.37, 0.95), (90, 0, 90), 5.3, 3200, 1300),
    "bay": ((0.0, -1.80, 20.0), (0, 0, 90), 2.2, 2400, 2000),
}
cam_data = bpy.data.cameras.new("LayoutCam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("LayoutCam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
meta = {}
for name, (loc, rot, scale, rx, ry) in views.items():
    cam.location = loc
    cam.rotation_euler = tuple(math.radians(a) for a in rot)
    cam_data.ortho_scale = scale
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.render.resolution_percentage = 100
    sc.render.filepath = os.path.join(OUT, f"view_{name}.png")
    bpy.ops.render.render(write_still=True)
    meta[name] = {"location": loc, "rotation_deg": rot, "ortho_scale": scale, "res": [rx, ry]}
json.dump(meta, open(os.path.join(OUT, "cameras.json"), "w"), indent=1)
print("rendered", list(meta))
