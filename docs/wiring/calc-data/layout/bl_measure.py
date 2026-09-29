"""Measure body-model lamp meshes per side (world metres, twin axes). Read-only.
Run: Blender -b K5_harness_workspace_v3.blend -P bl_measure.py -- <out.json>"""
import bpy, json, sys
out = sys.argv[sys.argv.index("--") + 1]
NAMES = ["Headlights", "Parking_Lights", "Marker_Lights", "Tail_Lights_Main", "Tail_Lights_Glass_Front", "Interior_Dome_Light_Blazer",
         "Steering_Main", "Dash_Speedo", "Exterior_Windshield_Wiper_Systems_Left", "Exterior_Windshield_Wiper_Systems_Right"]
res = {}
for n in NAMES:
    ob = bpy.data.objects.get(n)
    if not ob or ob.type != "MESH":
        continue
    mw = ob.matrix_world
    pts = [mw @ v.co for v in ob.data.vertices]
    for side, f in (("driver", lambda p: p.x > 0), ("passenger", lambda p: p.x < 0), ("all", lambda p: True)):
        sel = [p for p in pts if f(p)]
        if not sel:
            continue
        mn = [min(p[i] for p in sel) for i in range(3)]
        mx = [max(p[i] for p in sel) for i in range(3)]
        res[n + ":" + side] = {"min": [round(v, 4) for v in mn], "max": [round(v, 4) for v in mx],
                               "size_mm": [round((b - a) * 1000, 1) for a, b in zip(mn, mx)], "verts": len(sel)}
    # parent/instancing note
    res[n + ":meta"] = {"parent": ob.parent.name if ob.parent else None, "loc": [round(v, 4) for v in ob.matrix_world.translation]}
json.dump(res, open(out, "w"), indent=1)
print("measured", len(res))
