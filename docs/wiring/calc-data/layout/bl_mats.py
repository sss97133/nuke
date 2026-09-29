"""Dump material base colours (and face share) of body-model lamp meshes. Read-only.
Run: Blender -b K5_harness_workspace_v3.blend -P bl_mats.py -- <out.json>"""
import bpy, json, sys
out = sys.argv[sys.argv.index("--") + 1]
NAMES = ["Headlights", "Parking_Lights", "Marker_Lights", "Tail_Lights_Main", "Tail_Lights_Glass_Front", "Tail_Lights_Glass_Behind", "Interior_Dome_Light_Blazer"]
res = {}
for n in NAMES:
    ob = bpy.data.objects.get(n)
    if not ob:
        continue
    me = ob.data
    counts = {}
    for p in me.polygons:
        counts[p.material_index] = counts.get(p.material_index, 0) + 1
    tot = sum(counts.values()) or 1
    slots = []
    for i, s in enumerate(ob.material_slots):
        m = s.material
        col = None
        if m:
            if m.use_nodes:
                for nd in m.node_tree.nodes:
                    if nd.type == "BSDF_PRINCIPLED":
                        col = list(nd.inputs["Base Color"].default_value)[:3]
                        alpha = nd.inputs["Alpha"].default_value
                        trans = nd.inputs.get("Transmission Weight") or nd.inputs.get("Transmission")
                        slots.append({"slot": i, "name": m.name, "rgb": [round(c, 3) for c in col], "alpha": round(alpha, 2),
                                      "transmission": round(trans.default_value, 2) if trans else None, "share": round(counts.get(i, 0) / tot, 2)})
                        break
                else:
                    slots.append({"slot": i, "name": m.name, "diffuse": [round(c, 3) for c in m.diffuse_color[:3]], "share": round(counts.get(i, 0) / tot, 2)})
            else:
                slots.append({"slot": i, "name": m.name, "diffuse": [round(c, 3) for c in m.diffuse_color[:3]], "share": round(counts.get(i, 0) / tot, 2)})
    res[n] = slots
json.dump(res, open(out, "w"), indent=1)
print("mats", len(res))
