#!/usr/bin/env python3
"""figures_v5.py — component-location figures rendered from the digital twin (Blender, headless).

GM draws component locations as ink line art at a chosen angle with the body cut away for context (1987 LDTSM 0A-5
Fig. 7; 8E8-5 numbered call-outs). The twin (~/k5-harness-pull/K5_harness_workspace_v2.blend: TurboSquid 1978 Blazer
body + the K5H_* component insert) gives the body outline and every component's true position; the camera's clip plane
removes the hood. Components are still the insert's primitives (boxes/cylinders) until vendor CAD replaces them, so
this figure locates parts; it does not depict them.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b <twin.blend> --python figures_v5.py -- <out dir>
Writes fig_bay_<view>.png and fig_bay_<view>_positions.json (component -> normalised x, y on the image).
Camera pose is stated in numbers: azimuth (0 = dead ahead of the truck, + = towards the passenger side) and elevation.
"""
import math, sys, os, json
if "--composite" not in sys.argv:
    import bpy
if "--composite" not in sys.argv:
    from mathutils import Vector
    from bpy_extras.object_utils import world_to_camera_view
def render_figures():
    OUT = sys.argv[sys.argv.index("--")+1]
    sc = bpy.context.scene; O = bpy.data.objects
    def bb(o):
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    for n in ("Exterior_Body_Blazer", "K5H_LS3_Block", "K5H_MoTeC_M130", "K5H_Radiator", "K5H_Battery", "K5H_ThrottleBody_12605109", "Under_Frame_Blazer"):
        if n in O: lo, hi = bb(O[n]); print("BB", n, [round(v, 2) for v in lo], [round(v, 2) for v in hi])
    names = [o.name for o in O if o.name.startswith("K5H_") and o.type == "MESH"]
    body = [o for o in O if o.type == "MESH" and not o.name.startswith("K5H_") and not o.name.startswith("Brochure")]
    sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.render.use_freestyle = True; sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1100; sc.render.resolution_percentage = 100
    vl = sc.view_layers[0]; fs = vl.freestyle_settings; fs.crease_angle = math.radians(140)
    for ls in list(fs.linesets): fs.linesets.remove(ls)
    cc = bpy.data.collections.new("FIG_COMP"); bc = bpy.data.collections.new("FIG_BODY"); sc.collection.children.link(cc); sc.collection.children.link(bc)
    for n in names: cc.objects.link(O[n])
    for o in body: bc.objects.link(o)
    l1 = fs.linesets.new("comp"); l1.select_by_collection = True; l1.collection = cc; l1.linestyle.color = (0, 0, 0); l1.linestyle.thickness = 1.8
    l2 = fs.linesets.new("body"); l2.select_by_collection = True; l2.collection = bc; l2.linestyle.color = (0.5, 0.5, 0.5); l2.linestyle.thickness = 0.7; l2.select_crease = False
    white = bpy.data.materials.new("paper"); white.use_nodes = True; nt = white.node_tree; nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs[0].default_value = (1, 1, 1, 1); out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs[0])
    for o in O:
        if o.type == "MESH":
            keep = o.name in names or o in body
            o.hide_render = not keep
            if keep: o.data.materials.clear(); o.data.materials.append(white)
        elif o.type in ("CURVE", "FONT"): o.hide_render = True
    eng = O["K5H_LS3_Block"]; lo, hi = bb(eng); c = (lo + hi) / 2
    cam = bpy.data.objects.new("BayCam", bpy.data.cameras.new("BayCam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 35
    VIEWS = (("top", -20, 62), ("quarter", -50, 35))            # (tag, azimuth deg, elevation deg)
    comp_objs = [O[n] for n in names]
    for tag, az_deg, el_deg in VIEWS:
        az, el = math.radians(az_deg), math.radians(el_deg)
        d = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
        dist = 4.0
        cam.location = c + d * dist
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_end = 60
        # pass 1: the body as ghost lines, the near part of the hood cut away by the clip plane 0.30 m above the block
        cut_z = hi.z + 0.30
        cam.data.clip_start = max(0.1, (cam.location.z - cut_z) / d.z)
        for o in comp_objs: o.hide_render = True
        for o in body: o.hide_render = False
        sc.render.filepath = os.path.join(OUT, f"fig_bay_{tag}_body.png"); bpy.ops.render.render(write_still=True)
        # pass 2: the components alone, nothing in front of them, so every part's lines are seen (an x-ray, as the GM
        # cutaways are: the body drawn only where it helps)
        cam.data.clip_start = 0.1
        for o in body: o.hide_render = True
        for o in comp_objs: o.hide_render = False
        sc.render.filepath = os.path.join(OUT, f"fig_bay_{tag}_comp.png"); bpy.ops.render.render(write_still=True)
        print("CAM", tag, [round(v, 2) for v in cam.location], "az", az_deg, "el", el_deg)
        pos = {}
        for n in names:
            o = O[n]; l_, h_ = bb(o); v = world_to_camera_view(sc, cam, (l_ + h_) / 2); pos[n] = [round(v.x, 4), round(1 - v.y, 4)]
        json.dump(pos, open(os.path.join(OUT, f"fig_bay_{tag}_positions.json"), "w"), indent=1)
    print("WROTE")



if __name__ == "__main__" and "--composite" not in sys.argv:
    render_figures()

# ---- composite (system python with Pillow): python3 figures_v5.py --composite <out dir>
if __name__ == "__main__" and "--composite" in sys.argv:
    from PIL import Image
    out = sys.argv[sys.argv.index("--composite") + 1]
    for tag in ("top", "quarter"):
        body_im = Image.open(os.path.join(out, f"fig_bay_{tag}_body.png")).convert("RGBA")
        comp_im = Image.open(os.path.join(out, f"fig_bay_{tag}_comp.png")).convert("RGBA")
        paper = Image.new("RGBA", body_im.size, (255, 255, 255, 255))
        paper.alpha_composite(body_im); paper.alpha_composite(comp_im)
        paper.convert("RGB").save(os.path.join(out, f"fig_bay_{tag}.png"))
        print("composited", tag)
