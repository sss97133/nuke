"""Export the v3 engine-bay assembly (dimension-built parts + anchors) as a GLB for the site's 3D view.

  /Applications/Blender.app/Contents/MacOS/Blender -b ~/k5-harness-pull/K5_harness_workspace_v3.blend \
      --python docs/wiring/twin/export_glb.py -- --out nuke_frontend/public/models/k5-enginebay.glb

Only our own dimension-built geometry goes out (K5H_Engine_v3 collection: E3_* parts and ANCHOR_* spheres); nothing
from the TurboSquid body, nothing from maker downloads. Node names = object names; anchor provenance rides along as
glTF extras (source, method, confidence, dave_name). Coordinates stay in the twin frame (metres, +x driver, -y front,
z up; glTF is Y-up so the exporter applies its usual Z-up -> Y-up conversion).
"""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = "nuke_frontend/public/models/k5-enginebay.glb"
for i, a in enumerate(argv):
    if a == "--out": OUT = argv[i + 1]
OUT = os.path.abspath(OUT); os.makedirs(os.path.dirname(OUT), exist_ok=True)

coll = bpy.data.collections["K5H_Engine_v3"]
objs = [o for o in coll.all_objects if o.type in ("MESH", "CURVE", "EMPTY")]
bpy.ops.object.select_all(action="DESELECT")
# curves (headers, belt) -> meshes so the exporter keeps them; modifiers (bevels) get applied by the exporter
for o in objs:
    if o.type == "CURVE":
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target="MESH")
        o.select_set(False)
for o in coll.all_objects:
    if o.type in ("MESH", "EMPTY"): o.select_set(True)
# decimate the round parts a little (they are already low-poly primitives)
tri = sum(len(o.data.polygons) for o in coll.all_objects if o.type == "MESH")
print("EXPORT objects", len([o for o in coll.all_objects if o.select_get()]), "faces", tri)
kw = dict(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_extras=True, export_yup=True,
          export_materials="EXPORT", export_normals=True, export_texcoords=False, export_animations=False, export_skins=False,
          export_cameras=False, export_lights=False)
try:
    bpy.ops.export_scene.gltf(**kw, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    print("DRACO on")
except Exception as e:
    print("DRACO unavailable:", e)
    bpy.ops.export_scene.gltf(**kw)
# Scene custom properties hold add-on settings (the Blender MCP add-on keeps an API key there), and
# export_extras=True writes them into the GLB. Keep the node extras (anchor provenance); drop scene and top-level extras.
import json, struct
def _strip_scene_extras(path):
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl]); rest = b[20 + jl:]
    for s in j.get("scenes", []):
        s.pop("extras", None)
    j.pop("extras", None)
    nj = json.dumps(j, separators=(",", ":")).encode()
    nj += b" " * ((4 - len(nj) % 4) % 4)
    open(path, "wb").write(b"glTF" + struct.pack("<II", 2, 20 + len(nj) + len(rest)) + struct.pack("<II", len(nj), 0x4E4F534A) + nj + rest)
_strip_scene_extras(OUT)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
