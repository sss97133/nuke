"""1973-80 C/K + K5 radiator core support, drawn in Blender (headless) from reference photos.

Run: Blender -b -P core_support_blender.py -- <out.glb> [<out.obj>]
Twin metres: +x driver, -y forward, +z up (Blender's Z-up frame is the twin frame here); the glTF exporter turns it
Y-up, (X, Y, Z) = (x, z, -y), the same turn as k5cad.write_glb. Every size below names its source; the receipt is
docs/wiring/receipts/k5-core-support-3d.md. Photo ids: NOS GM support eBay 227561622754 frames _01/_05/_06/_07/_10,
owner truck scott-bay 045/046. Inches from the tape in _05/_06 (25.4 mm).
"""
import sys
import bpy
import bmesh
from mathutils import Matrix

IN = 0.0254
YF = -2.527                       # front face on the frame's core-support pads (chassis_frame.py body_mount_1)
T = 0.0015                        # sheet, assumed 16 ga
D = 0.100                         # tie-bar section depth, ~4 in (_07 edge view, _03 end view), assumed +/-15 mm
HALF_W = 76.8 * IN / 2            # tie-bar ends 76.8 in apart (_05 tape -2.9 in, _06 tape 73.9 in)
LAMP_Z = 1.052                    # twin headlamp centre (the vertical anchor; photo gives everything relative to it)
H = 0.627                         # face height 24.7 in (_01 467 px over 18.4 px/in, _05 cross-check 24.9 in)
ZB = LAMP_Z - 0.421               # lamp centre 0.671 H above the lower tie bar's bottom (_01)
ZT = ZB + H
LAMP_X, LAMP_D = 0.851, 5.3 * IN  # centres 1.702 m apart on the _05/_06 tape (perspective-corrected); hole 5.3 in (_05)
PARK_X, PARK_Z, PARK_D = 0.820, 0.818, 3.2 * IN   # parking-lamp hole under each headlamp (_01 overlay, _05, _06, _10)
OPEN_CX, OPEN_W = 0.025, 30.1 * IN                # radiator opening 19.4-49.55 in on the tape: 1 in toward the driver
OPEN_ZT, OPEN_ZB = ZT - 0.086, ZT - 0.086 - 0.493 # 3.4 in under the top edge (_01), 19.4 in tall (_05 tape)
MOUNT_X = 0.367                   # frame-mount brackets 28.9 in apart (_01 bottom edge), over the rail tops (+/-0.368)
DOME_X, DOME_Z = 0.541, 1.094     # stamped oval boss each side of the opening (_01, _05, _06; owner 045)
RECESS = (0.650, HALF_W - 0.02, ZB + 0.03, ZT - 0.09)  # headlamp-panel step: inner edge 0.11 m outboard of the boss
#                                                        (owner 045 at 1491 px/m), outline from _05 left, _06 right
FLANGE_SCREWS_Z = [ZB + 0.09 + i * 0.105 for i in range(5)]  # five fender screws (GM 2C-9 step 10); spacing assumed


def box(name, x0, x1, y0, y1, z0, z1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    bmesh.ops.translate(bm, verts=bm.verts, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def cyl(name, x, y0, y1, z, d, seg=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=d / 2, depth=abs(y1 - y0))
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler = (1.5708, 0, 0)
    ob.location = (x, (y0 + y1) / 2, z)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
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
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


def mat(name, rgb, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
ye = YF + T                        # engine face of the sheet

# radiator mounting face: one sheet with the radiator opening, headlamp, parking-lamp and boss-centre holes
face = box("face", -HALF_W, HALF_W, YF, ye, ZB, ZT)
holes = [box("o", -OPEN_W / 2 + OPEN_CX, OPEN_W / 2 + OPEN_CX, YF - 0.01, ye + 0.01, OPEN_ZB, OPEN_ZT)]
for s in (1, -1):
    holes += [cyl("l", s * LAMP_X, YF - 0.01, ye + 0.01, LAMP_Z, LAMP_D),
              cyl("p", s * PARK_X, YF - 0.01, ye + 0.01, PARK_Z, PARK_D)]
face = cut(face, *holes)
face.name = "radiator_face"

parts = {"radiator_face": face}
# stamped oval bosses beside the opening, standing 12 mm toward the engine: 107 x 195 mm (owner 045; _06 dome)
for s, sfx in ((1, "L"), (-1, "R")):
    o = cyl(f"boss_{sfx}", s * DOME_X, ye, ye + 0.012, DOME_Z, 0.107)
    for v in o.data.vertices:          # oval, 1.8 times taller than wide
        v.co.z = DOME_Z + (v.co.z - DOME_Z) * 1.8
    parts[f"boss_{sfx}"] = o

# upper tie bar: a channel along the top standing FORWARD of the face (owner 045 shows no flange on the engine side
# at the top, while the lower one does), top flange the full section depth, front lip down 60 mm (_03, _07)
parts["upper_tie_bar"] = join("upper_tie_bar", [
    box("ut", -HALF_W + 0.01, HALF_W - 0.01, YF - D, YF, ZT - T, ZT),
    box("ul", -HALF_W + 0.01, HALF_W - 0.01, YF - D, YF - D + T, ZT - 0.060, ZT)])
# radiator mounting panel across the opening top, bolted to the upper tie bar (GM Fig 2C-20; _01 wavy strip)
parts["radiator_mounting_panel"] = box("rmp", OPEN_CX - OPEN_W / 2 - 0.03, OPEN_CX + OPEN_W / 2 + 0.03,
                                       ye, ye + 0.035, OPEN_ZT - 0.002, OPEN_ZT + 0.045)
# lower tie bar: bottom flange the full depth toward the engine, rear lip up 60 mm (_01, _05/_06, owner 045 band)
parts["lower_tie_bar"] = join("lower_tie_bar", [
    box("lb", -HALF_W, HALF_W, YF, YF + D, ZB, ZB + T),
    box("ll", -HALF_W, HALF_W, YF + D - T, YF + D, ZB, ZB + 0.060)])
for s, sfx in ((1, "L"), (-1, "R")):
    x0, x1, z0, z1 = RECESS
    # headlamp panel: the stepped box around lamp and parking lamp, 30 mm deep toward the engine (_05, _06, _10)
    parts[f"headlamp_panel_{sfx}"] = join(f"headlamp_panel_{sfx}", [
        box("a", s * x0 - T / 2, s * x0 + T / 2, ye, ye + 0.03, z0, z1),
        box("b", min(s * x0, s * x1), max(s * x0, s * x1), ye, ye + 0.03, z1 - T, z1),
        box("c", min(s * x0, s * x1), max(s * x0, s * x1), ye, ye + 0.03, z0, z0 + T)])
    # side baffle / fender flange: bent rearward 50 mm at each end, five screw holes (_13/_14 end detail; GM 2C-9)
    fl = box(f"fender_flange_{sfx}", s * HALF_W - T / 2, s * HALF_W + T / 2, YF, YF + 0.05, ZB + 0.03, ZT - 0.03)
    tools = []
    for z in FLANGE_SCREWS_Z:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.004, depth=0.02,
                                            location=(s * HALF_W, YF + 0.03, z), rotation=(0, 1.5708, 0))
        tools.append(bpy.context.active_object)
    parts[f"fender_flange_{sfx}"] = cut(fl, *tools)
    # frame mount: box bracket under the lower tie bar on each rail, 17 mm bolt hole (_01, _07; GM 2C: one per rail)
    br = box(f"frame_mount_{sfx}", s * MOUNT_X - 0.035, s * MOUNT_X + 0.035, YF + 0.005, YF + 0.095, ZB - 0.045, ZB)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0085, depth=0.2, location=(s * MOUNT_X, YF + 0.05, ZB))
    parts[f"frame_mount_{sfx}"] = cut(br, bpy.context.active_object)

black = mat("satin_black_steel", (0.02, 0.02, 0.022), 0.6, 0.55)
root = bpy.data.objects.new("core_support", None)
bpy.context.collection.objects.link(root)
for n, o in parts.items():
    o.name = n
    o.data.materials.clear()
    o.data.materials.append(black)
    o.parent = root

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                          export_extras=False, export_apply=True, export_draco_mesh_compression_enable=False,
                          export_texcoords=False, export_normals=True)
if len(sys.argv) > sys.argv.index("--") + 2:
    import json
    dump = {}
    for n, o in parts.items():
        o.data.calc_loop_triangles()
        dump[n] = {"v": [list(v.co) for v in o.data.vertices], "f": [list(t.vertices) for t in o.data.loop_triangles]}
    json.dump(dump, open(sys.argv[sys.argv.index("--") + 2], "w"))
