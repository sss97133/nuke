import bpy, json
out = {}
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    if not any(c.name in ("1978_Chevrolet_Blazer",) for c in ob.users_collection) and ob.name not in ("Body_Mount_Crossmembers", "Exterior_Body_Blazer"):
        continue
    mw = ob.matrix_world
    pts = [mw @ v.co for v in ob.data.vertices]
    sel = [p for p in pts if 0.9 <= p.y <= 1.9 and 0.3 <= p.z <= 0.95 and abs(p.x) <= 0.75]
    if len(sel) < 20:
        continue
    xs = sorted(p.x for p in sel); ys = sorted(p.y for p in sel); zs = sorted(p.z for p in sel)
    q = lambda a, f: a[int(f * (len(a) - 1))]
    out[ob.name] = {"n": len(sel), "x": [round(q(xs, .02), 3), round(q(xs, .98), 3)], "y": [round(q(ys, .02), 3), round(q(ys, .98), 3)],
                    "z": [round(q(zs, .02), 3), round(q(zs, .98), 3)]}
json.dump(out, open("/private/tmp/claude-501/-Users-skylar/ebc425ad-1dc1-45a9-8e44-0ccef2f39e27/scratchpad/loc/tank_probe.json", "w"), indent=1)
print("probe", len(out))
