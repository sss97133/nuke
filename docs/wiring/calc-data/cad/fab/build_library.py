"""The parts library for the twin: every built part GLB -> one Blender file with the placement conventions.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python \
        docs/wiring/calc-data/cad/fab/build_library.py -- <parts_root> <library.blend>

<parts_root> holds one folder per part with <id>.glb and <id>.params.json (what the part scripts write). For each part:
a collection named by the part id; a root empty of the same name at the part's origin (the centre of its mounting
face; local +Z out of the mounting face), everything parented to it; an empty `<endpoint>.attach.<n>` at each place a
wire or cable lands, its +Z along the way the wire leaves (single arrow); an empty `<id>.mount.<n>` at each mounting
hole or stud, its +Z the way the bolt goes in. The collection's instance offset is the root, so a linked instance
lands on the mounting face. Roots are laid out on a display grid here; set a root's transform to place the part.
The root carries the audit record (params.json) as custom properties.
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
root_dir, out = Path(argv[0]).expanduser(), Path(argv[1]).expanduser()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
lib = bpy.data.collections.new("K5_parts")
scene.collection.children.link(lib)


def empty(name, kind, size, loc_mm, dir_vec, parent, coll, props):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = Vector(loc_mm) / 1000.0
    e.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector(dir_vec).normalized()).to_euler("XYZ")
    for k, v in props.items():
        e[k] = v
    e.parent = parent
    coll.objects.link(e)
    return e


x_cursor = 0.0
done = []
for pj in sorted(root_dir.glob("*/*.params.json")):
    meta = json.loads(pj.read_text())
    pid = meta["id"]
    glb = pj.with_name(f"{pid}.glb")
    if not glb.exists():
        continue
    coll = bpy.data.collections.new(pid)
    lib.children.link(coll)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:                      # the GLB's own root node carries the part id: free the name for our root
        if o.name == pid or o.name.startswith(pid + "."):
            o.name = f"{pid} glb"
    root = bpy.data.objects.new(pid, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.03
    coll.objects.link(root)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        if o.parent is None:
            o.parent = root            # root is at the origin here, so the world transform is kept
            o.matrix_parent_inverse = root.matrix_world.inverted()
    for a in meta.get("attach", []):
        empty(f"{a['ep']}.attach.{a['n']}", "SINGLE_ARROW", 0.03, a["at"], a["dir"], root, coll,
              {"kind": a.get("kind", "plug"), "note": a.get("note", "")})
    for m in meta.get("mount", []):
        empty(f"{pid}.mount.{m['n']}", "PLAIN_AXES", 0.012, m["at"], m.get("dir", [0, 0, -1]), root, coll,
              {"note": m.get("note", ""), **({"hole_d_mm": float(m["d"])} if m.get("d") else {})})
    root["k5_part"] = json.dumps({k: meta[k] for k in ("id", "endpoints", "what", "maker", "maker_pn", "shape_basis", "dims_mm",
                                                         "frame", "axes") if k in meta}, ensure_ascii=False)
    root["shape_basis"] = meta.get("shape_basis", "")
    root["dims_mm"] = {k: float(v) for k, v in meta.get("dims_mm", {}).items()}
    root["sources"] = sorted({p["source"] for p in meta.get("params", [])})[:40]
    root["unknowns"] = meta.get("unknowns", []) or ["none"]
    bpy.context.view_layer.update()
    span = max(float(v) for v in meta.get("dims_mm", {"l": 200}).values()) / 1000.0
    root.location = (x_cursor + span / 2, 0.0, 0.0)
    coll.instance_offset = root.location
    x_cursor += span + 0.15
    done.append(pid)

out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
print("library", out, len(done), "parts:", ", ".join(done))
