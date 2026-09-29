"""Export evaluated world-space triangles of named twin objects to .npz, for the margin study (margins_v4.py) and the
exhaust clearance checks (harness_cad.py). The .npz files hold TurboSquid geometry, so they stay local (never commit).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup ~/k5-harness-pull/K5_harness_workspace_v3.blend \
      --python docs/wiring/twin/export_twin_meshes.py -- <outdir> [<object> ...]
With no object names it exports the set the margin study and the checks use.
"""
import bpy, sys, os
import numpy as np

DEFAULT = ["Under_Frame_Blazer", "Under_Main_Blazer", "Exterior_Body_Blazer", "Exterior_Body_Blazer_Rear", "Interior_Main",
           "Interior_Body", "Interior_Panels_Rear", "Tailgate_Main", "Exterior_Window_Front", "Exterior_Bumper_Front",
           "Steering_Main", "Interior_Spare_Tire_Carrier", "Wheel_Spare_Tire",
           "E3_Header_L_1", "E3_Header_L_3", "E3_Header_L_5", "E3_Header_L_7", "E3_Header_R_2", "E3_Header_R_4", "E3_Header_R_6",
           "E3_Header_R_8", "E3_Collector_L", "E3_Collector_R", "E3_Exhaust_Tail_L", "E3_Exhaust_Tail_R", "E3_ExhFlange_L_1",
           "E3_ExhFlange_L_3", "E3_ExhFlange_L_5", "E3_ExhFlange_L_7", "E3_ExhFlange_R_2", "E3_ExhFlange_R_4", "E3_ExhFlange_R_6",
           "E3_ExhFlange_R_8"]
argv = sys.argv[sys.argv.index("--") + 1:]
out, names = argv[0], (argv[1:] or DEFAULT)
os.makedirs(out, exist_ok=True)
dg = bpy.context.evaluated_depsgraph_get()
for n in names:
    ob = bpy.data.objects.get(n)
    if ob is None or ob.type not in ("MESH", "CURVE"):
        print("SKIP", n); continue
    ev = ob.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
    M = ob.matrix_world
    V = np.array([tuple(M @ v.co) for v in me.vertices], dtype=np.float64)
    T = np.array([tuple(t.vertices) for t in me.loop_triangles], dtype=np.int32)
    np.savez_compressed(os.path.join(out, n + ".npz"), V=V, T=T)
    print("EXPORT", n, V.shape, T.shape)
    ev.to_mesh_clear()
# wheel centres for the wheelbase
import json
w = {}
for n in ("Turning_Wheel_Left", "Turning_Wheel_Right", "Wheel_Back_Left", "Wheel_Back_Right"):
    o = bpy.data.objects.get(n)
    if o:
        from mathutils import Vector
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        w[n] = {"loc": list(o.matrix_world.translation), "bbox_centre": [sum(p[i] for p in bb) / 8 for i in range(3)]}
json.dump(w, open(os.path.join(out, "wheels.json"), "w"), indent=1)
print("WHEELS", w)
