"""Dump twin component objects (K5H_*, E3_*) with world bbox and custom properties. Read-only."""
import bpy, json, sys
out = sys.argv[sys.argv.index("--") + 1]
res = {}
for ob in bpy.data.objects:
    if not (ob.name.startswith("K5H_") or ob.name.startswith("E3_")) or ob.type != "MESH":
        continue
    mw = ob.matrix_world
    pts = [mw @ v.co for v in ob.data.vertices]
    if not pts:
        continue
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    props = {k: (str(ob[k])[:400]) for k in ob.keys() if not k.startswith("_")}
    res[ob.name] = {"colls": [c.name for c in ob.users_collection], "size_mm": [round((b - a) * 1000, 1) for a, b in zip(mn, mx)],
                    "center": [round((a + b) / 2, 4) for a, b in zip(mn, mx)], "props": props, "hide_render": ob.hide_render,
                    "dims_local_mm": [round(d * 1000, 1) for d in ob.dimensions]}
json.dump(res, open(out, "w"), indent=1)
print("parts", len(res))
