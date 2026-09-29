"""K5 harness in CAD (v4), the Blender half. Loads the v3 twin, restyles it as an x-ray, places the parts and
draws every loom and cable from docs/wiring/calc-data/cad/scene_v4.json (written by harness_full.py, or by
harness_cad.py for the engine-bay sample), saves v4 and renders. Blender headless only (never the live session on
:9876). Extends ~/k5-harness-pull/build_harness.py, whose hashed "zone" placement of devices is retired here: every
part sits at its sourced spot, every loom is a curve at its computed diameter.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup ~/k5-harness-pull/K5_harness_workspace_v3.blend \
      --python docs/wiring/twin/build_harness_v4.py -- --scene docs/wiring/calc-data/cad/scene_v4.json \
      --out ~/k5-harness-pull/renders/v4 --views iso_front_left,plan,... [--looms all] \
      [--save ~/k5-harness-pull/K5_harness_workspace_v4.blend] [--glb_dir ~/k5-harness-pull/glb/v4] [--samples 96] [--res 1920x1200]
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPT = {"scene": "docs/wiring/calc-data/cad/scene_v4.json", "out": os.path.expanduser("~/k5-harness-pull/renders/v4"),
       "views": "bay", "looms": "", "save": "", "samples": "96", "res": "1920x1200", "hide_hood": "1", "only_loom": "",
       "glb": "", "glb_dir": ""}
for i, a in enumerate(argv):
    if a.startswith("--") and i + 1 < len(argv):
        OPT[a[2:]] = argv[i + 1]
SCENE = json.load(open(OPT["scene"]))
OUT = os.path.expanduser(OPT["out"]); os.makedirs(OUT, exist_ok=True)
RX, RY = (int(v) for v in OPT["res"].split("x"))
sc = bpy.context.scene
V3_PATH = bpy.data.filepath
MM = 0.001


def hexrgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)  # sRGB -> linear


# ------------------------------------------------------------------ collections
def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or sc.collection).children.link(c)
    return c


V4 = coll("K5H_v4")
C_PARTS = coll("K5H_v4_Parts", V4)
C_LOOMS = coll("K5H_v4_Looms", V4)
C_CLAMPS = coll("K5H_v4_Clamps", V4)


def exclude(name, ex=True):
    def walk(lc):
        if lc.collection.name == name:
            lc.exclude = ex
            return True
        return any(walk(c) for c in lc.children)
    walk(bpy.context.view_layer.layer_collection)


for cn in ("K5H_Harness", "K5H_Landmarks", "K5H_v2_retired_engine", "K5H_Components", "Render_Stuff", "K5H_Cameras"):
    exclude(cn, True)
for o in bpy.data.objects:
    n = o.name
    if n.startswith(("material-", "S_B", "Brochure", "ANCHOR_", "E3_ltcd_candidate", "Sketchfab", "Collada")):
        o.hide_render = True
    if n in ("K5H_RadFan_1", "K5H_RadFan_2", "K5H_FuelTank", "Floor_Cycles"):
        o.hide_render = True          # v2 two-fan boxes (the truck has one fan) and the v2 tank box (sits too low)
    if o.type == "LIGHT" or o.type == "CAMERA":
        o.hide_render = True


# ------------------------------------------------------------------ materials
def principled(name, rgb, alpha=1.0, rough=0.5, metal=0.0, emit=0.0, edge=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1.0:
        # x-ray: alpha rises toward grazing angles so silhouettes read (Layer Weight facing -> map range -> alpha)
        lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = alpha
        mr.inputs["To Max"].default_value = min(1.0, (edge if edge is not None else alpha * 3.2))
        nt.links.new(lw.outputs["Facing"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], b.inputs["Alpha"])
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
        m.use_backface_culling = False
    m.diffuse_color = (*rgb, alpha)
    return m


M_BODY = principled("v4_xray_body", hexrgb("#7f93a8"), alpha=0.035, rough=0.3, edge=0.20)
M_INNER = principled("v4_xray_inner", hexrgb("#6c7f93"), alpha=0.06, rough=0.4, edge=0.26)
M_FRAME = principled("v4_xray_frame", hexrgb("#4d535b"), alpha=0.14, rough=0.5, edge=0.40)
M_ENGINE = principled("v4_xray_engine", hexrgb("#8a8479"), alpha=0.075, rough=0.4, edge=0.28)
M_EXH = principled("v4_xray_exhaust", hexrgb("#9c5a2c"), alpha=0.20, rough=0.4, edge=0.50)
M_TIRE = principled("v4_xray_tire", hexrgb("#2a2a2a"), alpha=0.08, rough=0.8, edge=0.26)
M_GLASS = principled("v4_xray_glass", hexrgb("#9fb6c8"), alpha=0.02, rough=0.1, edge=0.10)
M_CTX = principled("v4_xray_context", hexrgb("#7c8387"), alpha=0.10, rough=0.5, edge=0.30)
M_CLAMP = principled("v4_clamp", hexrgb("#3d4046"), rough=0.35, metal=0.6)
M_DIM = principled("v4_loom_dimmed", hexrgb("#9aa3ad"), alpha=0.10, rough=0.5, edge=0.25)
LOOM_HEX = {"engine": "#ff7a00", "front": "#16b8c9", "cab": "#8a4dff", "rear": "#27c24a", "door": "#f0d000", "under": "#ff4fa3"}
M_LOOM = {k: principled("v4_loom_" + k, hexrgb(v), rough=0.35, emit=0.12 if k == "engine" else 0.5) for k, v in LOOM_HEX.items()}
M_DC_POS = principled("v4_dc_pos", hexrgb("#d9102a"), rough=0.35, emit=0.10)
M_DC_NEG = principled("v4_dc_neg", hexrgb("#161616"), rough=0.4)
M_DC_EXC = principled("v4_dc_exception_marker", hexrgb("#f2c318"), rough=0.4, emit=0.8)


def body_meshes():
    blz = bpy.data.collections.get("1978_Chevrolet_Blazer")
    out = [o for o in (list(blz.all_objects) if blz else []) if o.type == "MESH" and not o.hide_render]
    for n in ("Exterior_Body_Blazer", "Body_Mount_Crossmembers"):
        o = bpy.data.objects.get(n)
        if o and o not in out:
            out.append(o)
    return out


def set_mat(o, m):
    if o.type not in ("MESH", "CURVE"):
        return
    o.data.materials.clear(); o.data.materials.append(m)


for o in body_meshes():
    n = o.name
    m = M_BODY
    if n.startswith("Wheel_Rim") or n.startswith("Wheel") or n.startswith("Turn_Wheel"):
        m = M_TIRE
    elif "Window" in n or "Glass" in n or n.startswith("Headlights") or n.startswith("Tail_Lights_Glass"):
        m = M_GLASS
    elif n.startswith("Under_Frame") or n == "Body_Mount_Crossmembers":
        m = M_FRAME
    elif n.startswith("Under_Main") or n.startswith("Interior") or n.startswith("Dash") or n.startswith("Steering"):
        m = M_INNER
    set_mat(o, m)
for c in ("K5H_E3_Longblock", "K5H_E3_Induction", "K5H_E3_Ignition", "K5H_E3_AccessoryDrive", "K5H_E3_Driveline", "K5H_Drivetrain"):
    cc = bpy.data.collections.get(c)
    for o in (cc.all_objects if cc else []):
        set_mat(o, M_ENGINE)
cc = bpy.data.collections.get("K5H_E3_Exhaust")
for o in (cc.all_objects if cc else []):
    set_mat(o, M_EXH)


# ------------------------------------------------------------------ TurboSquid fillers off (render copy only)
def cut_faces(obname, pred, tag):
    o = bpy.data.objects.get(obname)
    if not o:
        return 0
    o.data = o.data.copy()
    bm = bmesh.new(); bm.from_mesh(o.data)
    mw = o.matrix_world
    kill = [f for f in bm.faces if pred(mw @ f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data); bm.free()
    print("CUT", obname, tag, len(kill))
    return len(kill)


# the flat lid TurboSquid laid over the whole bay at z 1.25 (not a truck part)
cut_faces("Under_Main_Blazer", lambda c: abs(c.z - 1.25) < 0.012 and -2.46 < c.y < -1.44 and abs(c.x) < 0.95, "bay lid")
if OPT["hide_hood"] == "1":
    cut_faces("Exterior_Body_Blazer", lambda c: c.z > 1.262 and -2.70 < c.y < -1.44 and abs(c.x) < 0.905, "hood")


# ------------------------------------------------------------------ geometry helpers
def link(o, c):
    for uc in list(o.users_collection):
        uc.objects.unlink(o)
    c.objects.link(o)


def box(name, centre, size_m, mat, bevel=0.002, c=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
    o = bpy.context.active_object; o.name = name
    o.scale = size_m
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        md = o.modifiers.new("bevel", "BEVEL"); md.width = min(bevel, min(size_m) / 4); md.segments = 2
    set_mat(o, mat); link(o, c or C_PARTS)
    return o


def cyl(name, p0, p1, d, mat, c=None, verts=32, d1=None):
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    if d1 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=d / 2, depth=L, location=(p0 + p1) / 2)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=d / 2, radius2=d1 / 2, depth=L, location=(p0 + p1) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = (p1 - p0).to_track_quat("Z", "Y").to_euler()
    set_mat(o, mat); link(o, c or C_PARTS)
    return o


def outline_box(name, centre, size_m, mat, thick=0.0012, c=None):
    """A part whose size is not sourced: wire edges and a faint fill (the 'dashed' look)."""
    o = box(name, centre, size_m, mat, bevel=0, c=c)
    md = o.modifiers.new("wire", "WIREFRAME"); md.thickness = thick; md.use_replace = True
    box(name + "_fill", centre, size_m, principled(mat.name + "_fill", tuple(mat.diffuse_color[:3]), alpha=0.18, edge=0.35), bevel=0, c=c)
    return o


def tag(o, rec):
    for k in ("id", "endpoint", "model", "status", "colour_basis"):
        if rec.get(k) is not None:
            o[k] = str(rec[k])
    o["sources"] = " | ".join(rec.get("sources", []) or [])


def rot_matrix(rot):
    X, Y, Z = (Vector(v) for v in rot)
    return Matrix(((X.x, Y.x, Z.x), (X.y, Y.y, Z.y), (X.z, Y.z, Z.z))).to_4x4()


PART_OBJS = {}   # part id -> [objects]


def import_part(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.expanduser(p["glb"]))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    M = Matrix.Translation(Vector(p["origin"])) @ rot_matrix(p["rot"])
    for r in roots:
        r.matrix_world = M @ r.matrix_world
    for o in new:
        link(o, C_PARTS)
        if "keep" in o.name.lower():           # the parts lane's straight-boot keep-out: a design aid, not the part
            o.hide_render = True; o.hide_viewport = True
    if roots:
        tag(roots[0], p)
    return new


# ------------------------------------------------------------------ parts
for n in SCENE.get("hide_twin", []):      # twin objects a lane's better geometry supersedes (the coil grid -> the DEL-Stributor ring)
    ob = bpy.data.objects.get(n)
    if ob is not None:
        ob.hide_render = True; ob.hide_viewport = True
for p in SCENE["parts"]:
    k = p["kind"]
    dashed = str(p.get("model", "")).startswith("dashed")
    objs = []
    if k == "glb" and p.get("glb") and os.path.exists(os.path.expanduser(p["glb"])):
        objs = import_part(p)
    elif k == "battery":
        sx, sy, sz = (v * MM for v in p["size_mm"])
        cx, cy, cz = p["centre"]
        cols = p["colours"]
        if "top" in cols:
            h_top = 0.30 * sz
            o = box(p["id"], (cx, cy, cz - h_top / 2), (sx, sy, sz - h_top), principled("v4_part_" + p["id"] + "_case", hexrgb(cols["case"]), rough=0.45))
            objs.append(box(p["id"] + "_top", (cx, cy, cz + sz / 2 - h_top / 2), (sx, sy, h_top), principled("v4_part_" + p["id"] + "_top", hexrgb(cols["top"]), rough=0.4)))
        else:
            o = box(p["id"], (cx, cy, cz), (sx, sy, sz), principled("v4_part_" + p["id"], hexrgb(cols["case"]), rough=0.45))
        objs.append(o); tag(o, p)
    elif k == "isolator":
        o = box(p["id"], p["centre"], [v * MM for v in p["size_mm"]], principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.5))
        objs.append(o)
        for s in ("A", "B"):
            q = p["studs"][s]
            objs.append(cyl(p["id"] + "_stud_" + s, q, (q[0], q[1], q[2] - p["studs"]["len_mm"] * MM), p["studs"]["d_mm"] * MM,
                            principled("v4_stud_tin", hexrgb("#c9c6bd"), rough=0.3, metal=0.8)))
        tag(o, p)
    elif k == "plate":
        sx, sy, sz = (v * MM for v in p["size_mm"])
        o = box(p["id"], p["centre"], (sx, sy, sz), principled("v4_part_plate_alu", hexrgb(p["colour"]), rough=0.35, metal=0.85), bevel=0)
        bv = o.modifiers.new("corners", "BEVEL"); bv.width = p["corner_r_mm"] * MM; bv.segments = 6; bv.affect = "EDGES"
        bv.limit_method = "ANGLE"
        objs.append(o); tag(o, p)
    elif k == "stack":
        base = Vector(p["base"]); ax = Vector(p["axis"]).normalized()
        cur = base.copy()
        mat = principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.45, metal=0.3)
        for i, (ln, dia, basis) in enumerate(p["segments"]):
            nxt = cur + ax * ln * MM
            if i == len(p["segments"]) - 1 and p["id"] == "FIREWALL-ENGINE":
                o = cyl(f"{p['id']}_seg{i}", cur, nxt, dia * MM, principled("v4_boot_black", hexrgb("#1b1b1b"), rough=0.6), d1=13.5 * MM)
            else:
                o = cyl(f"{p['id']}_seg{i}", cur, nxt, dia * MM, mat)
            o["basis"] = basis
            objs.append(o)
            cur = nxt
        o["id"] = p["id"]
    elif k == "box":
        if dashed:
            o = outline_box(p["id"], p["centre"], [v * MM for v in p["size_mm"]], principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.5))
        else:
            o = box(p["id"], p["centre"], [v * MM for v in p["size_mm"]], principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.45))
        objs.append(o); tag(o, p)
    elif k == "obox":
        mat = principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.45)
        o = box(p["id"], p["centre"], [v * MM for v in p["size_mm"]], mat)
        o.rotation_euler = (0.0, 0.0, math.radians(p.get("yaw_deg", 0.0)))
        objs.append(o); tag(o, p)
        if p.get("tower"):
            t = p["tower"]
            objs.append(cyl(p["id"] + "_tower", (t["at"][0], t["at"][1], t["z0"]), (t["at"][0], t["at"][1], t["z1"]), t["d_mm"] * MM, mat, verts=20))
        if p.get("plug"):
            q = p["plug"]
            pl = box(p["id"] + "_plug", (q["at"][0], q["at"][1], (q["z0"] + q["z1"]) / 2), (q["size_mm"][0] * MM, q["size_mm"][1] * MM, q["z1"] - q["z0"]),
                     principled("v4_plug_black", hexrgb("#1f1f1f"), rough=0.6))
            pl.rotation_euler = (0.0, 0.0, math.radians(p.get("yaw_deg", 0.0)))
            objs.append(pl)
    elif k in ("disc_x", "disc_y"):
        d, t = (v * MM for v in p["size_mm"])
        c = Vector(p["centre"]); ax = Vector((1, 0, 0)) if k == "disc_x" else Vector((0, 1, 0))
        o = cyl(p["id"], c - ax * t / 2, c + ax * t / 2, d, principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.5), verts=48)
        objs.append(o); tag(o, p)
    elif k == "context_box":
        o = box(p["id"], p["centre"], [v * MM for v in p["size_mm"]], M_CTX, bevel=0.01)
        objs.append(o); tag(o, p)
    elif k == "twin":
        mat = principled("v4_part_" + p["id"], hexrgb(p["colour"]), rough=0.45)
        for n in p.get("objects", []):
            ob = bpy.data.objects.get(n)
            if ob is not None:
                set_mat(ob, mat); objs.append(ob)
    elif k == "ring":
        c = Vector(p["centre"])
        bpy.ops.mesh.primitive_torus_add(major_radius=p["size_mm"][0] * MM / 2, minor_radius=0.003, location=c)
        o = bpy.context.active_object; o.name = p["id"]
        o.rotation_euler = (math.radians(90), 0, 0)
        set_mat(o, M_DC_EXC); link(o, C_PARTS); tag(o, p)
        objs.append(o)
    PART_OBJS[p["id"]] = objs
print("PARTS", len(PART_OBJS), sum(len(v) for v in PART_OBJS.values()), "objects")


# ------------------------------------------------------------------ looms and cables
def curve_obj(name, pts, radius, mat, c, radii=None):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    cu.bevel_depth = radius; cu.bevel_resolution = 5; cu.use_fill_caps = True
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, q in enumerate(pts):
        sp.points[i].co = (q[0], q[1], q[2], 1)
        if radii:
            sp.points[i].radius = radii[i]
    o = bpy.data.objects.new(name, cu); c.objects.link(o)
    o.data.materials.append(mat)
    return o


def pair(pts, sep):
    P = [Vector(q) for q in pts]
    T = []
    for i in range(len(P)):
        a = P[max(0, i - 1)]; b = P[min(len(P) - 1, i + 1)]
        T.append((b - a).normalized())
    side = T[0].cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = T[0].cross(Vector((1, 0, 0)))
    side.normalize()
    sides = [side]
    for i in range(1, len(P)):
        s = sides[-1] - T[i] * sides[-1].dot(T[i])
        sides.append(s.normalized() if s.length > 1e-9 else sides[-1])
    return [list(P[i] + sides[i] * sep / 2) for i in range(len(P))], [list(P[i] - sides[i] * sep / 2) for i in range(len(P))]


def key(p):
    return tuple(int(round(c / 0.002)) for c in p)


# the fattest bundle at every node, so a break-out can taper out of its parent (a molded transition, canon ch.16 s7.4)
NODE_OD = {}
for r in SCENE["routes"]:
    if r["loom"] == "dc":
        continue
    for end in (r["path"][0], r["path"][-1]):
        k_ = key(end)
        NODE_OD[k_] = max(NODE_OD.get(k_, 0.0), r["bundle_od_mm"])


def taper_path(path, od, start_od, end_od, L=0.040):
    """Insert points 40 mm in from each end and return (points, radius factors) that ramp from the node's bundle
    size down to this segment's own size: the break-out's molded transition, drawn."""
    P = [Vector(q) for q in path]
    seg = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    tot = sum(seg)
    if tot < 3 * L or od <= 0:
        return [list(p) for p in P], None

    def at(s):
        for i, l in enumerate(seg):
            if s <= l or i == len(seg) - 1:
                return i, P[i] + (P[i + 1] - P[i]) * (s / l if l else 0)
            s -= l
    pts, cums = [], []
    c = 0.0
    for i, p in enumerate(P):
        pts.append(p); cums.append(c)
        if i < len(seg):
            if c < L < c + seg[i]:
                pts.append(P[i] + (P[i + 1] - P[i]) * ((L - c) / seg[i])); cums.append(L)
            if c < tot - L < c + seg[i]:
                pts.append(P[i] + (P[i + 1] - P[i]) * ((tot - L - c) / seg[i])); cums.append(tot - L)
            c += seg[i]
    f0 = min(max(start_od / od, 1.0), 1.8) if start_od else 1.0
    f1 = min(max(end_od / od, 1.0), 1.8) if end_od else 1.0
    rad = []
    for s in cums:
        f = 1.0
        if s < L:
            f = f0 + (1.0 - f0) * (s / L)
        elif s > tot - L:
            f = 1.0 + (f1 - 1.0) * ((s - (tot - L)) / L)
        rad.append(f)
    return [list(p) for p in pts], rad


ONLY = OPT["only_loom"]
LOOM_OBJS = {}
for r in SCENE["routes"]:
    if ONLY and r["loom"] != ONLY:
        continue
    rad = max(r["bundle_od_mm"], 0.8) / 2 * MM
    if r["loom"] == "dc":
        mat = M_DC_POS if r.get("polarity") == "+" else M_DC_NEG
    else:
        mat = M_LOOM.get(r["loom"], M_LOOM["engine"])
    if r.get("parallel", 1) == 2:
        a, b = pair(r["path"], r["bundle_od_mm"] * MM + 0.004)
        objs = [curve_obj(r["id"] + "_a", a, rad, mat, C_LOOMS), curve_obj(r["id"] + "_b", b, rad, mat, C_LOOMS)]
    elif r["loom"] != "dc" and r["kind"] in ("branch", "drop", "trunk"):
        s_od = NODE_OD.get(key(r["path"][0])) if r["kind"] != "trunk" else None
        e_od = NODE_OD.get(key(r["path"][-1])) if r["kind"] != "drop" else None
        pts, radii = taper_path(r["path"], r["bundle_od_mm"], s_od if (s_od or 0) > r["bundle_od_mm"] * 1.05 else None,
                                e_od if (e_od or 0) > r["bundle_od_mm"] * 1.05 else None)
        objs = [curve_obj(r["id"], pts, rad, mat, C_LOOMS, radii)]
    else:
        objs = [curve_obj(r["id"], r["path"], rad, mat, C_LOOMS)]
    for o in objs:
        o["route"] = r["id"]; o["loom"] = r["loom"]; o["members"] = ",".join(r["members"]); o["od_mm"] = r["bundle_od_mm"]; o["status"] = r["status"]
    # clamps: a cushioned P-clamp symbol around the cable (MS21919 family; size by the bundle OD)
    for i, cl in enumerate(r["clamps"]):
        t = Vector(cl["tangent"])
        bpy.ops.mesh.primitive_torus_add(major_radius=rad + 0.0022 + (0.007 if r.get("parallel", 1) == 2 else 0), minor_radius=0.0016,
                                         major_segments=24, minor_segments=8, location=cl["at"])
        o = bpy.context.active_object; o.name = f"{r['id']}-C{i + 1}"
        o.rotation_euler = t.to_track_quat("Z", "Y").to_euler()
        set_mat(o, M_CLAMP); link(o, C_CLAMPS)
        o["loom"] = r["loom"]; objs.append(o)
    LOOM_OBJS.setdefault(r["loom"], []).extend(objs)
print("LOOMS", {k: len(v) for k, v in LOOM_OBJS.items()})

# ------------------------------------------------------------------ world, lights, render settings
sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
except Exception as e:
    print("GPU setup failed, CPU render:", e)
sc.cycles.samples = int(OPT["samples"])
sc.cycles.use_denoising = True
sc.cycles.transparent_max_bounces = 40
sc.cycles.max_bounces = 8
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.film_transparent = False
w = bpy.data.worlds.new("v4_studio"); sc.world = w; w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ"); ramp = nt.nodes.new("ShaderNodeValToRGB")
bg = nt.nodes.new("ShaderNodeBackground"); ow = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Window"], sep.inputs[0]); nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])
ramp.color_ramp.elements[0].color = (*hexrgb("#c3c8ce"), 1); ramp.color_ramp.elements[1].color = (*hexrgb("#e9ebee"), 1)
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0
nt.links.new(bg.outputs[0], ow.inputs[0])


def area(name, loc, rot_deg, size, energy, c=None):
    ld = bpy.data.lights.new(name, "AREA"); ld.size = size; ld.energy = energy
    if c:
        ld.color = c
    o = bpy.data.objects.new(name, ld); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    return o


area("v4_key", (2.2, -3.6, 3.6), (48, 0, 32), 3.0, 520)
area("v4_fill", (-3.0, -2.5, 2.4), (60, 0, -60), 4.0, 180)
area("v4_top", (0.0, -1.0, 5.0), (0, 0, 0), 5.0, 220)
area("v4_rim", (0.0, 2.5, 2.5), (-60, 0, 180), 3.0, 120)
area("v4_top_rear", (0.0, 1.2, 5.0), (0, 0, 0), 5.0, 220)
area("v4_under", (0.0, -0.4, -2.5), (180, 0, 0), 6.0, 160)


def camera(name, loc, tgt, lens=40.0, ortho=None, roll=None):
    cd = bpy.data.cameras.new(name); cam = bpy.data.objects.new(name, cd); sc.collection.objects.link(cam)
    cam.location = loc; cd.lens = lens; cd.sensor_width = 36; cd.clip_start = 0.02; cd.clip_end = 60
    if ortho:
        cd.type = "ORTHO"; cd.ortho_scale = ortho
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if roll is not None:
        cam.rotation_euler = roll
    return cam


VIEWS = {
    "iso_front_left": dict(loc=(3.45, -5.35, 3.05), tgt=(0.05, -0.45, 0.85), lens=36, what="3/4 front-left (driver side, from the front)"),
    "iso_rear_right": dict(loc=(-3.55, 4.75, 2.95), tgt=(0.0, -0.35, 0.85), lens=36, what="3/4 rear-right (passenger side, from the rear)"),
    "plan": dict(loc=(0.0, -0.40, 7.0), tgt=(0.0, -0.40, 0.0), ortho=5.5, roll=(0.0, 0.0, math.radians(90)), what="plan (top, front to the left)"),
    "side_driver": dict(loc=(6.0, -0.40, 1.10), tgt=(0.0, -0.40, 1.10), ortho=5.5, what="driver side (front to the left)"),
    "bay": dict(loc=(0.22, -3.00, 2.30), tgt=(0.0, -1.90, 0.95), lens=29, what="engine bay close-up"),
    "firewall_engine": dict(loc=(0.12, -2.50, 1.55), tgt=(0.18, -1.45, 0.98), lens=24, what="firewall from the engine side"),
    "firewall_cab": dict(loc=(0.28, -0.72, 1.22), tgt=(0.22, -1.42, 0.94), lens=20, what="firewall from the cab side (under the dash)"),
    "rear_quarter": dict(loc=(-1.55, 3.05, 2.35), tgt=(0.05, 1.30, 0.95), lens=27, what="rear quarter: subs, amp, spare-tire clash"),
    "underbody": dict(loc=(2.35, 0.75, -0.95), tgt=(0.0, -0.35, 0.60), lens=22, what="underbody (from below, driver side)"),
}
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = RX, RY, 100
sc.render.image_settings.file_format = "PNG"
from bpy_extras.object_utils import world_to_camera_view


def along(path, f):
    P = [Vector(q) for q in path]
    L = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    tot = sum(L); t = f * tot
    for i, l in enumerate(L):
        if t <= l or i == len(L) - 1:
            return P[i] + (P[i + 1] - P[i]) * (t / l if l > 0 else 0)
        t -= l
    return P[-1]


def label_data(cam, focus=None):
    """2-D anchors for the legend overlay: mid-run of every segment, every route end, every part."""
    def px(p):
        v = world_to_camera_view(sc, cam, Vector(p))
        return [round(v.x * RX, 1), round((1 - v.y) * RY, 1), round(v.z, 3)]
    out = {"res": [RX, RY], "focus": focus, "routes": [], "parts": []}
    for r in SCENE["routes"]:
        out["routes"].append({"id": r["id"], "loom": r["loom"], "kind": r["kind"], "mid": px(along(r["path"], 0.5)),
                              "start": px(r["path"][0]), "end": px(r["path"][-1]), "length_mm": r["length_mm"]})
    for p in SCENE["parts"]:
        c = p.get("centre") or p.get("base") or p.get("origin")
        if c:
            out["parts"].append({"id": p["id"], "px": px(c), "model": p.get("model"), "status": p.get("status")})
    return out


def fit_camera(name, objs, direction=(1.0, -1.25, 0.95), lens=34):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type not in ("MESH", "CURVE"):
            continue
        for c in o.bound_box:
            wv = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, wv)); hi = Vector(map(max, hi, wv))
    ctr = (lo + hi) / 2; ext = (hi - lo).length
    fov = 2 * math.atan(18 / lens) * (RY / RX)          # vertical field (sensor 36 wide)
    dist = max(0.8, ext / 2 / math.tan(fov / 2) * 1.05)
    d = Vector(direction).normalized()
    return camera(name, ctr + d * dist, ctr, lens), ctr, ext


def render(vname, cam, focus=None):
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, vname + ".png")
    bpy.ops.render.render(write_still=True)
    json.dump(label_data(cam, focus), open(os.path.join(OUT, vname + "_labels.json"), "w"), indent=0)
    print("RENDERED", sc.render.filepath, flush=True)
    return sc.render.filepath


MANIFEST = {"generated_by": "docs/wiring/twin/build_harness_v4.py", "scene": OPT["scene"], "resolution": [RX, RY],
            "samples": int(OPT["samples"]), "status": "every route is a PROPOSAL (owner and builder to confirm)", "renders": []}
for vname in [v for v in OPT["views"].split(",") if v]:
    vd = VIEWS[vname]
    cam = camera("v4_cam_" + vname, vd["loc"], vd["tgt"], vd.get("lens", 40), vd.get("ortho"), vd.get("roll"))
    f = render(vname, cam)
    MANIFEST["renders"].append({"file": os.path.basename(f), "view": vname, "what": vd["what"], "kind": "view",
                                "camera": {"loc": list(vd["loc"]), "target": list(vd["tgt"]), "lens": vd.get("lens"), "ortho": vd.get("ortho")}})

# one render per loom: that loom bright, every other loom and cable dimmed to a grey x-ray
LOOMS = [l for l in OPT["looms"].split(",") if l] if OPT["looms"] != "all" else ["engine", "front", "dc", "cab", "door", "rear", "under"]
DIRS = {"engine": (0.55, -1.25, 1.10), "front": (0.9, -1.35, 1.20), "dc": (1.0, -1.1, 1.05), "cab": (0.35, 1.25, 0.85),
        "door": (1.35, 0.25, 0.75), "rear": (-0.95, 1.25, 1.05), "under": (1.15, 0.35, -0.95)}
for lid in LOOMS:
    mine = LOOM_OBJS.get(lid, [])
    if not mine:
        continue
    saved = {}
    for l2, objs in LOOM_OBJS.items():
        if l2 == lid:
            continue
        for o in objs:
            if o.type in ("MESH", "CURVE") and o.data.materials:
                saved[o.name] = o.data.materials[0]
                o.data.materials[0] = M_DIM
    cam, ctr, ext = fit_camera("v4_cam_loom_" + lid, mine, DIRS.get(lid, (1.0, -1.25, 0.95)))
    f = render("loom_" + lid, cam, focus=lid)
    MANIFEST["renders"].append({"file": os.path.basename(f), "view": "loom_" + lid, "what": f"the {lid} loom (others dimmed)", "kind": "loom",
                                "camera": {"loc": list(cam.location), "target": list(ctr), "lens": cam.data.lens}})
    for l2, objs in LOOM_OBJS.items():
        for o in objs:
            if o.name in saved:
                o.data.materials[0] = saved[o.name]
if MANIFEST["renders"]:
    mp = os.path.join(OUT, "manifest_blender.json")
    json.dump(MANIFEST, open(mp, "w"), indent=1)


# ------------------------------------------------------------------ GLB export: own geometry only, per zone
def strip_scene_extras(path):
    """Remove scenes[*].extras, the top-level extras and any credential-named key; rewrite the JSON chunk (4-byte
    padded) and the header lengths. Node extras (id, endpoint, model, status, sources) stay."""
    import struct
    b = open(path, "rb").read()
    magic, ver, _ = struct.unpack("<4sII", b[:12])
    clen, ctype = struct.unpack("<II", b[12:20])
    j = json.loads(b[20:20 + clen]); rest = b[20 + clen:]
    j.pop("extras", None)
    for s_ in j.get("scenes", []):
        s_.pop("extras", None)

    def scrub(o):
        if isinstance(o, dict):
            for k in list(o):
                if any(t in k.lower() for t in ("api_key", "apikey", "token", "secret", "password", "blendermcp")):
                    o.pop(k)
                else:
                    scrub(o[k])
        elif isinstance(o, list):
            for v_ in o:
                scrub(v_)
    scrub(j)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<4sII", magic, ver, 20 + len(js) + len(rest)) + struct.pack("<II", len(js), ctype) + js + rest
    open(path, "wb").write(out)


ZONES = {"bay": (-9.0, -1.40), "cab": (-1.50, 0.15), "rear": (0.05, 9.0)}


def build_export_copies():
    """Flat-material mesh copies of our own geometry: the v3 engine (twin lane, from published dimensions), the parts
    lane's models, our stand-ins, looms and clamps, and context planes from the probe. No TurboSquid mesh (its licence
    keeps it in the private .blend)."""
    keep = []
    mats = {}

    def glb_mat(name, rgb, alpha=1.0, metal=0.0, rough=0.5):
        kk = (name, tuple(round(c, 3) for c in rgb), round(alpha, 2), round(metal, 2), round(rough, 2))
        if kk in mats:
            return mats[kk]
        m = bpy.data.materials.new("glb_" + name); m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough; b.inputs["Alpha"].default_value = alpha
        if alpha < 1:
            m.blend_method = "BLEND"
        mats[kk] = m
        return m
    G_ENG = glb_mat("engine", hexrgb("#8a8479"), alpha=0.22, rough=0.6)
    G_EXH = glb_mat("exhaust", hexrgb("#9c5a2c"), alpha=0.35, rough=0.5)
    G_CTX = glb_mat("context", hexrgb("#7f93a8"), alpha=0.12, rough=0.6)
    twin_part = {}
    for p in SCENE["parts"]:
        if p["kind"] == "twin":
            for n in p.get("objects", []):
                twin_part[n] = p
    dg = bpy.context.evaluated_depsgraph_get()

    def copy_obj(o, mat_override=None, flat=True):
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        nm = o.name; o.name = nm + "__src"
        n = bpy.data.objects.new(nm, me); n.matrix_world = o.matrix_world.copy()
        for k in o.keys():
            if isinstance(o[k], (str, int, float)):
                n[k] = o[k]
        if mat_override is not None:
            me.materials.clear(); me.materials.append(mat_override)
        elif flat:
            new_m = []
            for src in list(me.materials):
                if src is None:
                    new_m.append(glb_mat("part", (0.5, 0.5, 0.5))); continue
                col = tuple(src.diffuse_color[:3]); a = src.diffuse_color[3]
                b = src.node_tree.nodes.get("Principled BSDF") if src.use_nodes else None
                if b is not None and not b.inputs["Base Color"].is_linked:
                    col = tuple(b.inputs["Base Color"].default_value[:3])
                met = b.inputs["Metallic"].default_value if b else 0.0
                rou = b.inputs["Roughness"].default_value if b else 0.5
                new_m.append(glb_mat(src.name[:40], col, alpha=min(1.0, max(a, 0.18)) if a < 1 else 1.0, metal=met, rough=rou))
            me.materials.clear()
            for m in new_m:
                me.materials.append(m)
        keep.append(n)
        return n
    for cn in ("K5H_E3_Longblock", "K5H_E3_Induction", "K5H_E3_Ignition", "K5H_E3_AccessoryDrive", "K5H_E3_Driveline", "K5H_E3_Exhaust"):
        cc = bpy.data.collections.get(cn)
        for o in (list(cc.all_objects) if cc else []):
            if o.type not in ("MESH", "CURVE") or o.hide_render:
                continue
            if o.name in twin_part:
                p = twin_part[o.name]
                n = copy_obj(o, glb_mat("part_" + p["id"], hexrgb(p["colour"]), rough=0.45))
                n["id"] = p["id"]; n["endpoint"] = p["id"]; n["model"] = str(p.get("model")); n["status"] = str(p.get("status"))
            else:
                copy_obj(o, G_EXH if cn == "K5H_E3_Exhaust" else G_ENG)
    FW = [(0.00, -1.375), (0.10, -1.384), (0.15, -1.411), (0.175, -1.454), (0.20, -1.462), (0.35, -1.466), (0.50, -1.458), (0.76, -1.467)]
    verts, faces = [], []
    xs = [-x for x, _ in reversed(FW)] + [x for x, _ in FW[1:]]
    ys = [y for _, y in reversed(FW)] + [y for _, y in FW[1:]]
    for i, (x, y) in enumerate(zip(xs, ys)):
        verts += [(x, y, 0.90), (x, y, 1.25)]
        if i:
            k = 2 * i
            faces.append((k - 2, k, k + 1, k - 1))
    me = bpy.data.meshes.new("CTX-firewall-face"); me.from_pydata(verts, [], faces); me.materials.append(G_CTX)
    keep.append(bpy.data.objects.new("CTX-firewall-face", me))
    planes = [("CTX-core-support-face", [(-0.89, -2.455, 0.78), (0.89, -2.455, 0.78), (0.89, -2.455, 1.25), (-0.89, -2.455, 1.25)]),
              ("CTX-inner-fender-wall-passenger", [(-0.513, -2.30, 0.77), (-0.513, -1.50, 0.77), (-0.513, -1.50, 1.04), (-0.513, -2.30, 1.04)]),
              ("CTX-inner-fender-wall-driver", [(0.513, -2.30, 0.77), (0.513, -1.50, 0.77), (0.513, -1.50, 1.04), (0.513, -2.30, 1.04)]),
              ("CTX-cab-floor", [(-0.80, -1.22, 0.645), (0.80, -1.22, 0.645), (0.80, 0.10, 0.645), (-0.80, 0.10, 0.645)]),
              ("CTX-toe-board", [(-0.80, -1.46, 0.90), (0.80, -1.46, 0.90), (0.80, -1.22, 0.66), (-0.80, -1.22, 0.66)]),
              ("CTX-cargo-floor", [(-0.80, 0.20, 0.845), (0.80, 0.20, 0.845), (0.80, 1.85, 0.845), (-0.80, 1.85, 0.845)])]
    for side in (1, -1):
        rl = [(-2.45, 0.401, 0.609, 0.759), (-1.60, 0.405, 0.456, 0.799), (-1.20, 0.439, 0.498, 0.648), (0.10, 0.441, 0.496, 0.650), (0.45, 0.440, 0.640, 0.801),
              (0.75, 0.441, 0.654, 0.804), (1.20, 0.441, 0.601, 0.751), (1.80, 0.403, 0.591, 0.721)]
        vv, ff = [], []
        for i, (y, wx, zb, zt) in enumerate(rl):
            vv += [(side * wx, y, zb), (side * wx, y, zt)]
            if i:
                k = 2 * i
                ff.append((k - 2, k, k + 1, k - 1))
        me = bpy.data.meshes.new(f"CTX-frame-rail-web-{'driver' if side > 0 else 'passenger'}"); me.from_pydata(vv, [], ff)
        me.materials.append(glb_mat("frame", hexrgb("#4d535b"), alpha=0.30, rough=0.5))
        keep.append(bpy.data.objects.new(me.name, me))
    for name, v4 in planes:
        me = bpy.data.meshes.new(name); me.from_pydata(v4, [], [(0, 1, 2, 3)]); me.materials.append(G_CTX)
        keep.append(bpy.data.objects.new(name, me))
    for c in (C_PARTS, C_LOOMS, C_CLAMPS):
        for o in list(c.all_objects):
            if o.type == "EMPTY" or o.hide_render:
                continue
            if o.type == "CURVE":
                o.data.bevel_resolution = 2
            if o.type not in ("MESH", "CURVE"):
                continue
            n = copy_obj(o)
            if o.parent is not None and o.parent.get("id"):
                for k in ("id", "endpoint", "model", "status"):
                    if o.parent.get(k) is not None and n.get(k) is None:
                        n[k] = str(o.parent[k])
    ex = bpy.data.collections.new("K5H_v4_GLB"); sc.collection.children.link(ex)
    for n in keep:
        ex.objects.link(n)
    return keep


def obj_yrange(o):
    ys = [(o.matrix_world @ Vector(c)).y for c in o.bound_box] if o.type == "MESH" else [o.matrix_world.translation.y]
    return min(ys), max(ys)


def export_zone_glbs(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    keep = build_export_copies()
    for k in list(sc.keys()):     # add-on settings as scene properties (one is a third-party credential): never export
        try:
            del sc[k]
        except Exception:
            pass
    res = {}
    for zone, (y0, y1) in list(ZONES.items()) + [("all", (-9, 9))]:
        sel = [n for n in keep if (lambda a, b: b >= y0 and a <= y1)(*obj_yrange(n))]
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        for n in sel:
            n.select_set(True)
        bpy.context.view_layer.objects.active = sel[0]
        path = os.path.join(out_dir, f"k5_harness_v4_{zone}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                                  export_draco_mesh_compression_enable=False, export_materials="EXPORT",
                                  export_image_format="NONE", export_extras=True, export_yup=True)
        strip_scene_extras(path)
        raw = open(path, "rb").read().lower()
        hits = sum(raw.count(t) for t in (b"blendermcp", b"api_key", b"apikey"))
        assert hits == 0, "credential-like strings left in the GLB"
        res[zone] = {"file": os.path.basename(path), "bytes": os.path.getsize(path), "objects": len(sel), "credential_strings": hits}
        print("GLB", zone, path, os.path.getsize(path), "bytes", len(sel), "objects, credential strings:", hits, flush=True)
    json.dump(res, open(os.path.join(out_dir, "glb_manifest.json"), "w"), indent=1)
    return res


if OPT["save"]:
    dst = os.path.expanduser(OPT["save"])
    assert os.path.abspath(dst) != os.path.abspath(V3_PATH), "never overwrite v3"
    bpy.ops.wm.save_as_mainfile(filepath=dst, copy=True)
    print("SAVED", dst, flush=True)
if OPT["glb_dir"]:
    export_zone_glbs(os.path.expanduser(OPT["glb_dir"]))
print("DONE", [r["file"] for r in MANIFEST["renders"]])
