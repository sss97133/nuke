"""Render the K5 twin as two see-through orthographic layers per view, so the page can fade each on its own:
  body   = the TurboSquid 1978 Blazer body (scaled to the 2,703 mm wheelbase)
  mech   = the v3 LS3, induction, exhaust, accessory drive, ignition and driveline
Same cameras as loc/bl_render.py (loc/render/cameras.json), so world -> pixel projection is unchanged.
Workbench, flat light, x-ray, object outlines, transparent film. Read-only: the .blend is never saved.
Run: Blender -b K5_harness_workspace_v3.blend -P bl_layers.py -- <out_dir> [scale_pct] [views]"""
import bpy, json, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/k5layers"
PCT = int(argv[1]) if len(argv) > 1 else 100
ONLY = argv[2].split(",") if len(argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
CAM = json.load(open("/private/tmp/claude-501/-Users-skylar/ebc425ad-1dc1-45a9-8e44-0ccef2f39e27/scratchpad/loc/render/cameras.json"))

LAYERS = {
    "body": ({"1978_Chevrolet_Blazer"}, {"Body_Mount_Crossmembers", "Exterior_Body_Blazer"}),
    "mech": ({"K5H_E3_Longblock", "K5H_E3_Induction", "K5H_E3_Exhaust", "K5H_E3_AccessoryDrive", "K5H_E3_Ignition",
              "K5H_E3_Driveline"}, set()),
}

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "FLAT"
sh.color_type = "SINGLE"
sh.show_xray = True
sh.show_object_outline = True
sh.show_cavity = False
sh.show_shadows = False
sh.show_specular_highlight = False
sc.render.film_transparent = True
sc.display.render_aa = "8"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
try:
    sc.view_settings.view_transform = "Standard"
except Exception:
    pass

cam_data = bpy.data.cameras.new("LayerCam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("LayerCam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

STYLE = {"body": dict(light="STUDIO", color=(0.80, 0.80, 0.80), alpha=0.16, outline=(0.35, 0.37, 0.39)),
         "mech": dict(light="FLAT", color=(0.80, 0.80, 0.80), alpha=0.30, outline=(0.10, 0.11, 0.12))}
for layer, (colls, names) in LAYERS.items():
    for ob in bpy.data.objects:
        keep = (ob.name in names) or any(c.name in colls for c in ob.users_collection)
        if ob.name.startswith("ANCHOR_"):
            keep = False
        ob.hide_render = not keep
    st = STYLE[layer]
    sh.light = st["light"]
    sh.single_color = st["color"]
    sh.xray_alpha = st["alpha"]
    sh.object_outline_color = st["outline"]
    for name, c in CAM.items():
        if ONLY and name not in ONLY:
            continue
        cam.location = c["location"]
        cam.rotation_euler = tuple(math.radians(a) for a in c["rotation_deg"])
        cam_data.ortho_scale = c["ortho_scale"]
        cam_data.clip_start, cam_data.clip_end = 0.01, 100
        sc.render.resolution_x, sc.render.resolution_y = c["res"]
        sc.render.resolution_percentage = PCT
        sc.render.filepath = os.path.join(OUT, f"{name}_{layer}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name, layer, flush=True)
