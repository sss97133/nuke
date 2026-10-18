"""Render the v3 twin's engine bay: photo-match view, bay top, 3/4 iso, firewall face; dump 2D anchor
positions for labelling (labels are drawn afterwards by label_renders.py with PIL).

  /Applications/Blender.app/Contents/MacOS/Blender -b ~/k5-harness-pull/K5_harness_workspace_v3.blend \
      --python docs/wiring/twin/render_twin.py -- --out docs/wiring/output/twin --views photo,top,iso,firewall [--scale 0.5]

Camera for the photo match: iPhone 15 Pro main camera, EXIF FocalLength 6.765 mm = 24 mm equivalent, 4:3 frame.
Blender: lens 24 mm on a 34.6 mm wide sensor (the 4:3 crop of the 43.27 mm full-frame diagonal), horizontal fit.
"""
import bpy, json, math, os, sys
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = "docs/wiring/output/twin"; VIEWS = ["photo", "top", "iso", "firewall"]; SCALE = 1.0
CAM_POS = None; CAM_TGT = None; ROOT_YZ = None; CAM_ROT = None
for i, a in enumerate(argv):
    if a == "--out": OUT = argv[i + 1]
    if a == "--views": VIEWS = argv[i + 1].split(",")
    if a == "--scale": SCALE = float(argv[i + 1])
    if a == "--campos": CAM_POS = [float(v) for v in argv[i + 1].split(",")]
    if a == "--camtgt": CAM_TGT = [float(v) for v in argv[i + 1].split(",")]
    if a == "--root": ROOT_YZ = [float(v) for v in argv[i + 1].split(",")]
    if a == "--camrot": CAM_ROT = [float(v) for v in argv[i + 1].split(",")]
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene

# ---- render settings: EEVEE, fast -------------------------------------------------------------
sc.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "SceneEEVEE") and "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.eevee.taa_render_samples = 24
sc.render.film_transparent = False
sc.use_nodes = False                      # no v2 compositor
sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"; sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
sc.eevee.use_shadows = True if hasattr(sc.eevee, "use_shadows") else None
sc.render.image_settings.file_format = "PNG"
w = bpy.data.worlds.new("K5H3_world"); sc.world = w
w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
bgn = nt.nodes.new("ShaderNodeBackground"); outn = nt.nodes.new("ShaderNodeOutputWorld")
bgn.inputs[0].default_value = (0.78, 0.78, 0.78, 1); bgn.inputs[1].default_value = 1.0
nt.links.new(bgn.outputs[0], outn.inputs[0])

# ---- opaque presentation materials for the TurboSquid body (v2 carries an x-ray look) ---------
def pmat(name, rgb, metallic=0.0, rough=0.5):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metallic; b.inputs["Roughness"].default_value = rough
    b.inputs["Alpha"].default_value = 1.0
    return m
M_BODY = pmat("K5H3_body_burgundy", (0.30, 0.05, 0.06), 0.1, 0.35)
M_TIRE = pmat("K5H3_tire", (0.03, 0.03, 0.03), 0.0, 0.9)
M_RIM = pmat("K5H3_rim", (0.6, 0.6, 0.62), 0.9, 0.35)
M_INT = pmat("K5H3_interior", (0.45, 0.40, 0.33), 0.0, 0.8)
M_FRAME = pmat("K5H3_frame", (0.10, 0.10, 0.10), 0.3, 0.6)
M_GLASS = pmat("K5H3_glass", (0.7, 0.8, 0.85), 0.0, 0.1)
blz = bpy.data.collections.get("1978_Chevrolet_Blazer")
def body_meshes():
    """The TurboSquid body: the Blazer collection plus the ghosted shell the v2 session left in the Scene Collection."""
    seen = set(); out = []
    for o in (list(blz.all_objects) if blz else []) + [o for o in bpy.data.objects if o.type == "MESH" and any(sl.material and sl.material.name == "K5H_ghost" for sl in o.material_slots)]:
        if o.type == "MESH" and o.name not in seen: seen.add(o.name); out.append(o)
    return out
BODY_MESHES = body_meshes()   # resolve BEFORE the material override renames the ghost material away
print("BODY MESHES", len(BODY_MESHES), [o.name for o in BODY_MESHES if o.name.startswith("Exterior_Body")])
for o in bpy.data.objects:
    if o.name in ("Floor_Cycles",) or any(c.name == "Render_Stuff" for c in o.users_collection): o.hide_render = True
if True:
    for o in BODY_MESHES:
        if o.type != "MESH": continue
        n = o.name
        m = M_BODY
        if n.startswith("Wheel_Rim") or n == "Wheel_Spare_Rim": m = M_RIM
        elif n.startswith("Wheel") or n.startswith("Turn_Wheel"): m = M_TIRE
        elif n.startswith("Interior") or n.startswith("Dash") or n.startswith("Steering"): m = M_INT
        elif n.startswith("Under_Frame") or n == "Undercarriage" or n == "Under_Engine_Simple": m = M_FRAME
        elif "Window" in n or "Glass" in n: m = M_GLASS
        o.data.materials.clear(); o.data.materials.append(m)
# the v2 component boxes: keep their colours but make them opaque
for o in bpy.data.objects:
    if o.name.startswith("K5H_") and o.type == "MESH":
        for slot in o.material_slots:
            if slot.material and slot.material.use_nodes:
                b = slot.material.node_tree.nodes.get("Principled BSDF")
                if b: b.inputs["Alpha"].default_value = 1.0
            if slot.material: slot.material.blend_method = "OPAQUE"

# ---- cut the front clip (hood, fenders, inner fenders, core support) off the body meshes -----
# The truck in IMG_6531 has no front clip; the firewall shares the mesh with the hood, so cut, don't hide.
CUT_DONE = set()
FENDER_CUT = "iso" in VIEWS or "firewall" in VIEWS
def front_clip_cut(enable):
    """Delete the front-clip faces (hood, fenders, inner fenders, core support) from a COPY of each body mesh.
    The truck in IMG_6531 has no front clip. Faces with centroid y < -1.55 (forward of the firewall at y=-1.46)
    and z > 0.42 go; the frame, axle and wheels are separate objects and untouched. Nothing is saved."""
    if not enable: return
    import bmesh
    for o in BODY_MESHES:
        if o.type != "MESH" or o.name in CUT_DONE or o.name.startswith("Wheel") or o.name.startswith("Turn_Wheel") or o.name.startswith("Under_Frame") or o.name == "Undercarriage": continue
        pts = [(o.matrix_world @ Vector(c)) for c in o.bound_box]
        if min(p.y for p in pts) > -1.60: continue
        o.data = o.data.copy()
        bm = bmesh.new(); bm.from_mesh(o.data)
        mw = o.matrix_world
        kill = [f for f in bm.faces if (lambda c: (c.y < -1.55 and c.z > 0.42) or (FENDER_CUT and c.y < -1.15 and c.z > 0.75 and abs(c.x) > 0.55))(mw @ f.calc_center_median())]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(o.data); bm.free(); CUT_DONE.add(o.name)
        print("CLIPCUT", o.name, len(kill), "faces removed")

# ---- hide stale v2 layers (harness curves/landmarks drawn to the old engine) ------------------
def exclude_coll(name, exclude=True):
    def walk(lc):
        if lc.collection.name == name: lc.exclude = exclude; return True
        return any(walk(c) for c in lc.children)
    walk(bpy.context.view_layer.layer_collection)
for cn in ("K5H_Harness", "K5H_Landmarks", "K5H_v2_retired_engine"): exclude_coll(cn, True)
NOT_IN_PHOTO = ["K5H_MoTeC_M130", "K5H_MoTeC_PDM30", "K5H_Holley_T43_TCU", "K5H_Wideband_Ctrl", "K5H_Amplifier", "K5H_Subwoofer",
                "K5H_FWG_MAIN", "K5H_EStopp_Actuator", "K5H_Battery", "K5H_Radiator", "K5H_RadFan_1", "K5H_RadFan_2", "K5H_FuelPump_Sender", "K5H_FuelTank"]

# ---- hide what the photo does not have (front clip removed on the truck) ------------------------
FRONT_CLIP = ["Headlights", "Exterior_Grille", "Exterior_Bumper_Front", "Exterior_Windshield_Wiper_Systems_Left", "Exterior_Windshield_Wiper_Systems_Right",
              "Exterior_Window_Front", "Under_Engine_Simple", "Exterior_License_Plate_Front", "Marker_Lights", "Parking_Lights"]
def set_hidden(names, hidden):
    for n in names:
        o = bpy.data.objects.get(n)
        if o: o.hide_render = hidden

# TurboSquid backdrop/ground planes (the huge 'material-*' objects) off
for o in bpy.data.objects:
    if o.name.startswith("material-"): o.hide_render = True

# ---- lights ---------------------------------------------------------------------------------
for o in bpy.data.objects:
    if o.type == "LIGHT" and o.name not in ("K5H_Sun", "K5H3_Fill"): o.hide_render = True
sun = bpy.data.objects.get("K5H_Sun")
if sun is None:
    bpy.ops.object.light_add(type="SUN", location=(2, -3, 6)); sun = bpy.context.active_object; sun.name = "K5H_Sun"
sun.data.energy = 2.2; sun.rotation_euler = (math.radians(35), math.radians(15), math.radians(-30))
sun.data.angle = math.radians(8)
fill = bpy.data.objects.get("K5H3_Fill")
if fill is None:
    bpy.ops.object.light_add(type="AREA", location=(0, -2.0, 3.2)); fill = bpy.context.active_object; fill.name = "K5H3_Fill"
fill.data.energy = 120; fill.data.size = 3.0; fill.rotation_euler = (0, 0, 0)

def make_cam(name, loc, tgt, lens=35, ortho=None, sensor=36.0):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name); cam = bpy.data.objects.new(name, cd); sc.collection.objects.link(cam)
    cam.location = loc
    cam.data.lens = lens; cam.data.sensor_width = sensor; cam.data.sensor_fit = "HORIZONTAL"
    cam.data.clip_start = 0.05; cam.data.clip_end = 100
    if ortho:
        cam.data.type = "ORTHO"; cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
    d = Vector(tgt) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam["target"] = list(tgt)
    return cam

ANCHOR_OBJS = [o for o in bpy.data.objects if o.name.startswith("ANCHOR_")]

def render(cam, name, res, hide_clip=True, extra_hide=()):
    sc.camera = cam
    sc.render.resolution_x = int(res[0] * SCALE); sc.render.resolution_y = int(res[1] * SCALE); sc.render.resolution_percentage = 100
    set_hidden(FRONT_CLIP, hide_clip); set_hidden(extra_hide, True); set_hidden(NOT_IN_PHOTO, hide_clip); front_clip_cut(hide_clip)
    path = os.path.join(OUT, name + ".png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # 2D anchor positions for labelling
    pts = {}
    dg = bpy.context.evaluated_depsgraph_get(); cpos = cam.matrix_world.translation
    for o in ANCHOR_OBJS:
        wpos = o.matrix_world.translation
        v = world_to_camera_view(sc, cam, wpos)
        # occlusion: ray from the camera toward the anchor; a hit more than 25 mm short of it means something is in front
        d = wpos - cpos; dist = d.length; d.normalize()
        hit, loc, nrm, idx, hobj, mtx = sc.ray_cast(dg, cpos, d, distance=dist - 0.025)
        hidden = bool(hit and hobj is not None and hobj.name != o.name and not hobj.name.startswith("ANCHOR_") and not hobj.hide_render)
        pts[o.name.replace("ANCHOR_", "")] = {"u": round(v.x, 4), "v": round(v.y, 4), "depth": round(v.z, 3), "dave": o.get("dave_name", ""), "conf": o.get("confidence", ""),
                                              "hidden": hidden, "hidden_by": (hobj.name if hidden else None), "in_frame": bool(0 <= v.x <= 1 and 0 <= v.y <= 1 and v.z > 0)}
    with open(os.path.join(OUT, name + "_anchors2d.json"), "w") as f: json.dump({"res": [sc.render.resolution_x, sc.render.resolution_y], "anchors": pts}, f, indent=1)
    set_hidden(extra_hide, False)
    print("RENDERED", path)

root = bpy.data.objects.get("K5H_Engine_v3_root")
if root and ROOT_YZ: root.location = (ROOT_YZ[2] if len(ROOT_YZ) > 2 else 0, ROOT_YZ[0], ROOT_YZ[1]); bpy.context.view_layer.update(); print("ROOT moved to", ROOT_YZ)
ex, ey, ez = root.location if root else (0, -1.33, 0.76)

if "photo" in VIEWS:
    # IMG_6531: camera above the front of the truck, looking down and rearward at the firewall
    pos = CAM_POS or [0.05, -2.50, 1.70]; tgt = CAM_TGT or [0.0, -1.93, 1.00]
    cam = make_cam("K5H_Cam_IMG6531", pos, tgt, lens=24, sensor=34.6)
    if CAM_ROT: cam.rotation_euler = CAM_ROT; cam["pose_source"] = "photo_match.py PnP"
    render(cam, "twin_photo_match_IMG6531", (1200, 900))
if "top" in VIEWS:
    cam = make_cam("K5H_Cam_E3_Top", (0, ey - 0.35, 5.0), (0, ey - 0.35, ez), ortho=1.9)
    cam.rotation_euler = (0, 0, math.radians(90))   # front (-y) at the top of the image... rotate so driver side is on the right
    cam.rotation_euler = (0, 0, math.radians(180))  # image up = -y (front)
    render(cam, "twin_enginebay_top", (1400, 1050))
if "iso" in VIEWS:
    cam = make_cam("K5H_Cam_E3_Iso", (-2.2, -3.3, 2.5), (0.05, ey - 0.3, ez + 0.2), lens=40)
    render(cam, "twin_iso_passenger_front", (1400, 1000))
if "firewall" in VIEWS:
    cam = make_cam("K5H_Cam_E3_Firewall", (0.0, -2.35, 2.0), (0.0, -1.46, 1.0), lens=30)
    render(cam, "twin_firewall_face", (1400, 1000))
print("DONE")
