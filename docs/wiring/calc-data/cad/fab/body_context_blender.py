"""K5 truck body context: the TurboSquid 1978 Blazer split into named nodes, drawn at stance around the photo-built parts.

Run (headless, deterministic, never against a running Blender session):
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P body_context_blender.py -- \
      <out_dir> [<landmarks.json>] [<blend>]
Reads  nuke_frontend/public/models/k5-blazer.glb (the TurboSquid body, Draco; the Blender glTF importer decodes it).
Writes <out_dir>/k5-body-context.glb and <out_dir>/k5-body-hood.glb (plain glTF, no Draco, no textures), and the
numbers it measured to <landmarks.json> (default: k5_body_context_landmarks.json beside this script).

Frames. The blazer GLB imports straight into twin metres (+x driver, -y forward, +z up) with no rescale or offset,
so the body sits with k5-frame, k5-firewall, k5-core-support, k5-inner-fender and the LS3 as published. The glTF
exporter turns it Y-up, (X, Y, Z) = (x, z, -y), the same turn k5cad.write_glb makes. "Left" is the driver side, +x.

What it makes (design: the body-context audit, section 5 and 6):
- body_cab (cab upper + lower, without the cowl strip), body_cowl_top (the strip the firewall layer replaces),
  body_fender_L/R, body_valance, body_tub (tub, cargo floor, tailgate, tail lamps, rear bumper), body_trim_chrome
  (mouldings, windshield trim, wipers), body_glass, body_doors_L/R, body_interior, body_wheel_FL/FR/RL/RR (tyre + rim),
  body_axles (axle tubes, diffs, knuckles and the parts hung on them, from the TurboSquid underbody), body_grille,
  body_lamps, body_bumper_F. The hood is its own file: body_hood, origin on its rear edge (the hinge line).
- Left out: the TurboSquid underbody (flat bay lid, dome inner fenders, blob engine, frame; the photo-built layers
  replace them), the removable rear top and tailgate glass (the top is off in the booth and bay photos), the spare,
  seat belts, rear trim panels and the rear bench (his is unknown).
- Dash and interior are bisected at y -1.43 so nothing pokes through the firewall layer (dash face y -1.46).
- Paint: material firewall_paint on the body (the firewall lane's PBR, BRIEF addendum 2026-10-27), roof_white on the
  roof (faces centred above z 1.85 with normal z over 0.6), chrome (metallic 1.0, rough 0.15), rubber.
- Tyres are decimated to about 12k triangles each; every other part ships as modelled.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:                                         # exec'd without __file__
    HERE = os.path.abspath(".")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = ARGS[0] if ARGS else "."
LM_JSON = ARGS[1] if len(ARGS) > 1 else None
BLEND = ARGS[2] if len(ARGS) > 2 else None
SRC = os.environ.get("K5_BLAZER_GLB") or os.path.join(REPO, "nuke_frontend", "public", "models", "k5-blazer.glb")
FRAME_PARAMS = os.path.join(HERE, "chassis_frame.params.json")     # front_axle_y, rear_axle_y_by_this_frame

# ── sourced and measured constants (twin metres) ──────────────────────────────────────────────────────────────────
TRIM_Y = -1.43               # interior bisect: the firewall layer's dash face is y -1.46, the dash model reaches -1.4786
COWL_Y, COWL_Z = -1.33, 1.40  # cowl strip = cab-upper faces forward of COWL_Y and below COWL_Z (audit 2: 65-73 mm high)
ROOF_Z, ROOF_NZ = 1.85, 0.6   # roof_white: face centre above ROOF_Z, normal z above ROOF_NZ
TYRE_TRIS = 12000            # per tyre
# triangle budgets for the heavy parts (source tris in the comment): both files together stay near 250k, about 8 MB
BUDGET = {"Tailgate_Main": 9000,                      # 21,584: the back of the truck, seen small
          "Door_Left_Details": 6000, "Door_Right_Details": 6000,   # 12,823 each: door cards and handles
          "Exterior_Windshield_Wiper_Systems_Left": 1500, "Exterior_Windshield_Wiper_Systems_Right": 1500,   # 3,664
          "Exterior_Grille": 14000,                  # 25,756
          "Dash_Main": 3000, "Dash_Panel_01": 3000, "Dash_Panel_02": 3000, "Dash_Speedo": 3000,   # 6.2-7.7k each
          "Steering_Main": 4000,                     # 10,004
          "Interior_Seat_Front_Left": 5000, "Interior_Seat_Front_Right": 5000,   # 8,616
          "Interior_Main": 8000}                     # 15,114
GROUND_Z, TYRE_R = -0.0105, 0.406                      # tyre bottom and radius, the brief's stance
BAY = ((-0.55, 0.55), (-2.45, -1.45), (0.55, 1.30))    # the engine bay between the inner-fender walls
PAINT = ((0.30, 0.055, 0.035), 0.65, 0.32)             # PBR base linear, metallic, roughness; clearcoat 1.0 / 0.02


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
def link(o, coll=None):
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def bake_world(o):
    """Bake the object's world matrix into its vertices (a negative scale flips the faces back), then unparent."""
    mw = o.matrix_world.copy()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(mw)
    if mw.determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    o.parent = None
    o.matrix_world.identity()
    o.location, o.scale, o.rotation_euler = (0, 0, 0), (1, 1, 1), (0, 0, 0)


def mats_of(o):
    return [s.material.name if s.material else "none" for s in o.material_slots]


def bbox(objs):
    pts = [v.co for o in objs for v in o.data.vertices]
    if not pts:
        return None
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def ntris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def split_loose(o):
    select_only([o])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [x for x in bpy.context.selected_objects if x.type == "MESH"]
    return sorted(parts, key=lambda x: x.name)


def _cut(me, idx):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in idx], context="FACES")
    bm.to_mesh(me)
    bm.free()


def carve(o, pred, name):
    """Move the faces for which pred(centre, normal, material name) is true into a new object; None if no face."""
    me, mn = o.data, mats_of(o)
    take, keep = [], []
    for p in me.polygons:
        (take if pred(p.center, p.normal, mn[p.material_index]) else keep).append(p.index)
    if not take:
        return None
    new = link(bpy.data.objects.new(name, me.copy()))
    _cut(new.data, keep)
    _cut(me, take)
    return new


def join(objs, name):
    objs = [o for o in objs if o is not None and len(o.data.polygons)]
    if not objs:
        return None
    select_only(objs)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


def trim_forward_of(o, y0):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, y0, 0), plane_no=(0, -1, 0), clear_outer=True)
    bm.to_mesh(o.data)
    bm.free()


# ── materials ─────────────────────────────────────────────────────────────────────────────────────────────────────
def make_mats():
    M = {}

    def mat(name, rgb, metal, rough, coat=0.0, coat_rough=0.1, alpha=1.0, emit=None):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1.0)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        b.inputs["Coat Weight"].default_value = coat          # exports as KHR_materials_clearcoat
        b.inputs["Coat Roughness"].default_value = coat_rough
        if alpha < 1.0:
            b.inputs["Alpha"].default_value = alpha
            m.blend_method = "BLEND"
        if emit:
            b.inputs["Emission Color"].default_value = (*emit, 1.0)
            b.inputs["Emission Strength"].default_value = 1.0
        M[name] = m

    mat("firewall_paint", PAINT[0], PAINT[1], PAINT[2], coat=1.0, coat_rough=0.02)
    mat("roof_white", (0.85, 0.85, 0.83), 0.0, 0.35)
    mat("chrome", (0.90, 0.90, 0.92), 1.0, 0.15)
    mat("chrome_yellow", (0.80, 0.42, 0.02), 0.9, 0.2)
    mat("rubber", (0.015, 0.015, 0.015), 0.0, 0.9)
    mat("black_trim", (0.02, 0.02, 0.022), 0.2, 0.5)
    mat("primer", (0.18, 0.18, 0.19), 0.0, 0.6)           # bare primer / EDP parts (BRIEF addendum)
    mat("glass", (0.05, 0.08, 0.09), 0.0, 0.05, alpha=0.28)
    mat("lamp_glass", (0.85, 0.87, 0.85), 0.0, 0.05, alpha=0.45)
    mat("tail_lens", (0.55, 0.02, 0.02), 0.0, 0.15)
    mat("interior_plaid", (0.30, 0.20, 0.10), 0.0, 0.6)
    mat("interior_buckskin", (0.35, 0.25, 0.15), 0.0, 0.7)
    mat("gauge_face", (0.75, 0.75, 0.72), 0.0, 0.3)
    mat("gauge_pointer", (0.8, 0.077, 0.014), 0.0, 0.5)
    return M


def final_name(n):
    n = n.lower()
    if n.startswith("car_paint"):
        return "firewall_paint"
    if n == "window_glass":
        return "glass"
    if n == "headlights_glass":
        return "lamp_glass"
    if n == "tail_lights_bulbs":
        return "tail_lens"
    if n == "chrome_yellow":
        return "chrome_yellow"
    if "chrome" in n or n in ("wheel_metal_light", "steering_wheel_logo", "chrome_mirror"):
        return "chrome"
    if n in ("rubber", "wheel_tire", "carpets_rubber"):
        return "rubber"
    if n.startswith("undercarriage"):
        return "primer"
    if n == "plaid":
        return "interior_plaid"
    if n in ("leather", "carpet", "fabric", "dashboard_plastic_yellow", "leather_spare_cover"):
        return "interior_buckskin"
    if n == "dash_speedo":
        return "gauge_face"
    if n == "dash_speedo_arrows":
        return "gauge_pointer"
    return "black_trim"


def finalize(o, M, override=None):
    """One mesh, final material set (sorted, so the file is deterministic), smooth by angle, no stale attributes."""
    me, src = o.data, mats_of(o)
    per = []
    for p in me.polygons:
        nm = final_name(src[p.material_index])
        if override:
            nm = override(p, nm) or nm
        per.append(nm)
    uniq = sorted(set(per))
    idx = [uniq.index(x) for x in per]
    me.materials.clear()
    for u in uniq:
        me.materials.append(M[u])
    for p, i in zip(me.polygons, idx):
        p.material_index = i
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    select_only([o])
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except RuntimeError:
        pass
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    return o


def decimate(o, tris):
    n = ntris(o)
    if n <= tris:
        return
    md = o.modifiers.new("dec", "DECIMATE")
    md.ratio = tris / n
    md.use_collapse_triangulate = True
    select_only([o])
    bpy.ops.object.modifier_apply(modifier=md.name)


# ── build ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            bake_world(o)
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    O = {o.name: o for o in bpy.data.objects}
    for n, t in BUDGET.items():
        decimate(O[n], t)
    M = make_mats()
    log = {}
    N = {}            # node name -> final object
    hood_parts = []

    # Exterior_Body_Blazer: 72 loose parts, classed by bounding-box centre (the audit's rules)
    G = {k: [] for k in ("hood", "valance", "fender", "cab_upper", "cab_lower", "tub")}
    for p in split_loose(O["Exterior_Body_Blazer"]):
        mn, mx = bbox([p])
        mn, mx = Vector(mn), Vector(mx)
        c, diag = (mn + mx) / 2, (mx - mn).length
        if c.y < -1.2 and c.z > 1.15 and abs(c.x) < 0.5 and diag > 1.0:
            G["hood"].append(p)
        elif c.y < -2.5:
            G["valance"].append(p)
        elif c.y < -1.15 and abs(c.x) > 0.75 and mn.y < -1.3:
            G["fender"].append(p)
        elif c.z > 1.28 and mx.y < 0.1:
            G["cab_upper"].append(p)
        elif c.y < -0.05:
            G["cab_lower"].append(p)
        else:
            G["tub"].append(p)
    log["body_parts"] = {k: len(v) for k, v in G.items()}

    # chrome mouldings out of every painted group, into one trim node
    is_chrome = lambda c, n, m: m.lower().startswith("chrome")
    trim = []
    for k in ("valance", "fender", "cab_upper", "cab_lower", "tub"):
        for p in G[k]:
            t = carve(p, is_chrome, p.name + "_chrome")
            if t:
                trim.append(t)
    G["tub"] = [p for p in G["tub"] if len(p.data.polygons)]

    # the cowl strip: the TurboSquid cab-top strip over the firewall layer's seam and plenum
    cowl = []
    for p in G["cab_upper"]:
        t = carve(p, lambda c, n, m: c.y < COWL_Y and c.z < COWL_Z, p.name + "_cowl")
        if t:
            cowl.append(t)
    log["cowl_top_tris"] = sum(ntris(c) for c in cowl)

    # windows: glass faces to body_glass, their frames and seals to the trim
    glass = []
    for n in ("Exterior_Window_Front", "Door_Left_Window", "Door_Right_Window"):
        g = carve(O[n], lambda c, nn, m: m == "Window_Glass", n + "_glass")
        glass.append(g)
        trim.append(O[n])
    trim += [O["Exterior_Windshield_Wiper_Systems_Left"], O["Exterior_Windshield_Wiper_Systems_Right"]]

    side = lambda o: "L" if sum(v.co.x for v in o.data.vertices) / max(1, len(o.data.vertices)) > 0 else "R"
    fend = {"L": [p for p in G["fender"] if side(p) == "L"], "R": [p for p in G["fender"] if side(p) == "R"]}

    interior_src = ["Interior_Seat_Front_Left", "Interior_Seat_Front_Right", "Steering_Main", "Steering_Wheel", "Interior_Body",
                    "Interior_Carpets_Rubber", "Interior_Center_Box", "Dash_Main", "Dash_Panel_01", "Dash_Panel_02",
                    "Dash_Speedo", "Interior_Main"]
    for n in interior_src:
        trim_forward_of(O[n], TRIM_Y)
    log["interior_trim_y"] = TRIM_Y

    # axles: parts of the TurboSquid underbody hung on the axle lines (tubes, diffs, knuckle housings, hubs, tie rods)
    fa = -1.896
    ra = 0.809
    if os.path.exists(FRAME_PARAMS):
        fp = json.load(open(FRAME_PARAMS))
        fa, ra = fp["front_axle_y"], fp["rear_axle_y_by_this_frame"]
    axle_parts = []
    for n in ("Under_Frame_Blazer", "Under_Engine_Simple"):
        for p in split_loose(O[n]):
            mn, mx = bbox([p])
            cy, cz = (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2
            near = min(abs(cy - fa), abs(cy - ra)) < 0.12
            if near and 0.25 < cz < 0.55 and (mx[1] - mn[1]) < 0.28:
                axle_parts.append(p)
            else:
                bpy.data.objects.remove(p)
    for n in ("Turn_Wheel_Left", "Turn_Wheel_Right"):
        axle_parts.append(O[n])
    log["axle_parts"] = len(axle_parts)

    def white_roof(p, nm):
        if nm == "firewall_paint":
            c, nz = p.center, p.normal.z
            if c.z > ROOF_Z and nz > ROOF_NZ:
                return "roof_white"
        return None

    # assemble nodes (finalize: material set per node, shading)
    N["body_cab"] = finalize(join(G["cab_upper"] + G["cab_lower"], "body_cab"), M, white_roof)
    N["body_cowl_top"] = finalize(join(cowl, "body_cowl_top"), M, white_roof)
    N["body_fender_L"] = finalize(join(fend["L"], "body_fender_L"), M)
    N["body_fender_R"] = finalize(join(fend["R"], "body_fender_R"), M)
    N["body_valance"] = finalize(join(G["valance"], "body_valance"), M)
    N["body_tub"] = finalize(join(G["tub"] + [O["Exterior_Body_Blazer_Rear"], O["Tailgate_Main"], O["Tail_Lights_Main"],
                                             O["Exterior_Bumper_Rear_Blazer"]], "body_tub"), M)
    N["body_trim_chrome"] = finalize(join(trim, "body_trim_chrome"), M)
    N["body_glass"] = finalize(join(glass, "body_glass"), M)
    for s, nm in (("L", "Left"), ("R", "Right")):
        N[f"body_doors_{s}"] = finalize(join([O[f"Door_{nm}_Main"], O[f"Door_{nm}_Details"], O[f"Door_{nm}_Mirror"]],
                                             f"body_doors_{s}"), M)
    N["body_interior"] = finalize(join([O[n] for n in interior_src], "body_interior"), M)
    for nm, src_name in (("body_grille", "Exterior_Grille"), ("body_lamps", "Headlights"), ("body_bumper_F", "Exterior_Bumper_Front")):
        ob = O[src_name]
        ob.name = ob.data.name = nm
        N[nm] = finalize(ob, M)
    N["body_axles"] = finalize(join(axle_parts, "body_axles"), M)
    for key, tyre, rim in (("FL", "Wheel_Front_Left", "Wheel_Rim_Front_Left"), ("FR", "Wheel_Front_Right", "Wheel_Rim_Front_Right"),
                           ("RL", "Wheel_Back_Left", "Wheel_Rim_Rear_Left"), ("RR", "Wheel_Back_Right", "Wheel_Rim_Rear_Right")):
        decimate(O[tyre], TYRE_TRIS)
        N[f"body_wheel_{key}"] = finalize(join([O[tyre], O[rim]], f"body_wheel_{key}"), M)

    # the hood: its own file, origin on the rear edge (the hinge line), so a viewer can raise it
    hood = join(G["hood"], "body_hood")
    hmn, hmx = bbox([hood])
    ry = hmx[1]
    rear = [v.co for v in hood.data.vertices if v.co.y > ry - 0.02]
    hinge = Vector((0.0, ry, min(v.z for v in rear)))
    for v in hood.data.vertices:
        v.co -= hinge
    hood.location = hinge
    finalize(hood, M)
    log["hood_hinge"] = [round(x, 4) for x in hinge]

    # all other nodes: drop whatever the audit leaves out (the TurboSquid underbody, top, spare, belts, rear trim)
    keep = set(map(id, list(N.values()) + [hood]))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and id(o) not in keep:
            bpy.data.objects.remove(o)
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.name = o.name

    # roots and report
    root = link(bpy.data.objects.new("k5_body_context", None))
    for o in N.values():
        o.parent = root
    hroot = link(bpy.data.objects.new("k5_body_hood", None))
    hood.parent = hroot
    M_used = {}
    tot = 0
    for n, o in sorted(N.items()):
        t = ntris(o)
        tot += t
        mn, mx = bbox([o])
        log.setdefault("nodes", {})[n] = {"tris": t, "min": [round(x, 3) for x in mn], "max": [round(x, 3) for x in mx],
                                          "materials": [m.name for m in o.data.materials]}
    log["context_tris"] = tot
    log["hood_tris"] = ntris(hood)

    # stance: tyre centres against the frame's axles; ground; radius
    w = {}
    for key in ("FL", "FR", "RL", "RR"):
        tyre_pts = [v.co for v in N[f"body_wheel_{key}"].data.vertices]
        mn = [min(p[i] for p in tyre_pts) for i in range(3)]
        mx = [max(p[i] for p in tyre_pts) for i in range(3)]
        w[key] = {"cy": round((mn[1] + mx[1]) / 2, 4), "cz": round((mn[2] + mx[2]) / 2, 4), "cx": round((mn[0] + mx[0]) / 2, 4),
                  "r_z": round((mx[2] - mn[2]) / 2, 4), "bottom": round(mn[2], 4), "top": round(mx[2], 4)}
    log["wheels"] = w
    log["stance"] = {
        "front_axle_y_params": fa, "rear_axle_y_params": ra,
        "front_delta_mm": round((sum(w[k]["cy"] for k in ("FL", "FR")) / 2 - fa) * 1000, 1),
        "rear_delta_mm": round((sum(w[k]["cy"] for k in ("RL", "RR")) / 2 - ra) * 1000, 1),
        "ground_z_brief": GROUND_Z, "tyre_r_brief": TYRE_R,
        "ground_delta_mm": round((min(w[k]["bottom"] for k in w) - GROUND_Z) * 1000, 1),
        "radius_delta_mm": round((sum(w[k]["r_z"] for k in w) / 4 - TYRE_R) * 1000, 1),
    }

    # bay intrusion: vertices of any context node inside the bay volume between the inner-fender walls
    def inside(p):
        return all(lo <= p[i] <= hi for i, (lo, hi) in enumerate(BAY))
    hits = {}
    for n, o in list(N.items()) + [("body_hood", hood)]:
        off = o.location if o is hood else Vector((0, 0, 0))      # the hood's mesh is relative to its hinge
        pts = [(v.co + off) for v in o.data.vertices]
        ins = [p for p in pts if inside(p)]
        if ins:
            hits[n] = {"verts": len(ins), "min": [round(min(p[i] for p in ins), 3) for i in range(3)],
                       "max": [round(max(p[i] for p in ins), 3) for i in range(3)]}
    log["bay_intrusion"] = {"box_x": BAY[0], "box_y": BAY[1], "box_z": BAY[2], "nodes_with_vertices_inside": hits}

    # export
    os.makedirs(OUT_DIR, exist_ok=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(export_format="GLB", use_selection=True, export_yup=True, export_extras=False, export_apply=True,
              export_draco_mesh_compression_enable=False, export_texcoords=False, export_normals=True,
              export_cameras=False, export_lights=False, export_vertex_color="NONE", export_materials="EXPORT")
    kw = {k: v for k, v in kw.items() if k in props}
    for fn, objs in (("k5-body-context.glb", [root] + list(N.values())), ("k5-body-hood.glb", [hroot, hood])):
        select_only(objs)
        for o in objs:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, fn), **kw)
        log.setdefault("files", {})[fn] = os.path.getsize(os.path.join(OUT_DIR, fn))
    path = LM_JSON or os.path.join(HERE, "k5_body_context_landmarks.json")
    json.dump(log, open(path, "w"), indent=1, sort_keys=True)
    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("BODY_CONTEXT", json.dumps({k: log[k] for k in ("context_tris", "hood_tris", "files", "stance", "hood_hinge")}))


main()
