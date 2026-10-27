"""K5 1973-80 front inner fender (fender skirt), LH built and mirrored to RH, for nuke_frontend/public/models/k5-inner-fender.glb.
Twin metres: +x driver, -y forward, +z up. Run: Blender -b -P inner_fender_blender.py; sources, camera matches and the
landmark table: docs/wiring/receipts/2026-10-26_k5-inner-fender-3d.md."""
import bpy, bmesh, math, json, sys
from mathutils import Vector
import os
W = os.environ.get("K5_FENDER_WORK", "/tmp/k5-inner-fender")   # .blend + model.json land here; export: see the receipt
os.makedirs(W, exist_ok=True)

# The part is a wheelhouse tunnel: an arched rim on the outboard face (bolts to the fender's wheel-opening lip), a roof
# running inboard, a fillet, and an engine-side wall with a straight lower flange; the rim follows the wheel arch (b_jegs_1, b_jegs_5,
# b_eckler_1, raybuck frames). Rear end: the long holed leg (b_jegs_1, b_jegs_3); front end: the short tail to the
# core support.
# Rim: b_eckler_1.jpg (LH, inboard side, near-level; rear at left), lower edge of the dark silhouette per column (sil.py)
RIM_BOT = {25: 544, 50: 500, 75: 452, 100: 411, 125: 376, 150: 360, 175: 347, 200: 340, 225: 331, 250: 326, 275: 322,
           300: 318, 325: 314, 350: 313, 375: 311, 400: 310, 450: 309, 500: 310, 550: 311, 600: 312, 650: 313,
           700: 319, 750: 329, 775: 339, 800: 351, 825: 362, 850: 375, 875: 387, 900: 398, 925: 406, 950: 410}
P = dict(
    y_front=-2.505,      # front tail on the core support's rear face (front face y -2.527, sheet ~22 mm) - assumed +/-0.01
    y_rear=-1.440,       # rear leg at the cowl side (FR-88 cowl points y -1.43, firewall station -1.46) - assumed +/-0.02
    col_front=965, col_rear=25,   # b_eckler_1 columns of the two ends
    z_rim_apex=0.980,    # rim apex: tyre top 0.802 (wheel z 0.396 + r 0.406) plus ~0.18 travel and clearance - assumed +/-0.04
    x_out=0.828,         # rim face; its 30 mm lip ends at x 0.858, the FR-88 fender line (cowl pair 1715/2) - maker
    x_in=0.419,          # engine-side wall: derived, 0.858 less the OER box width 0.457, plus the 18 mm bottom flange - +/-0.025
    crown=0.150,         # roof rise from rim to the inboard crest - assumed +/-0.05 (b_eckler_1 dome over rim)
    fillet=0.100,        # crest-to-wall radius, b_jegs_1 / b_oer_1 highlight band - photo +/-0.03
    z_wall_bottom=0.620, # the wall's bottom flange is straight (Raybuck RH 1/9: it lies flat on the table) - fitted
    front_taper=0.02,    # none: Raybuck LH 1 and 5 show the front end full height (mean frame IoU 0.71 vs 0.70 at 0.25) - photo
    arch_k=1.20,         # b_eckler_1 was shot from above: rim drops are divided by cos(elevation) - fitted
    lip=0.030,           # rim flange width, b_jegs_7 - photo +/-0.01
    bump=(0.25, 0.48, 0.09, 0.10, 0.025),   # b_oer_1 stamped "+" bulge on the roof: x frac in from rim, y frac from
                         # front, radii (m), height (m) - photo, height assumed
)
s = (P["y_rear"] - P["y_front"]) / (P["col_rear"] - P["col_front"])
def Ycol(c): return P["y_front"] + (c - P["col_front"]) * s
apex = min(RIM_BOT.values())
RIM = sorted((Ycol(c), P["z_rim_apex"] - (r - apex) * abs(s) * P["arch_k"]) for c, r in RIM_BOT.items())
def lerp(tab, y):
    if y <= tab[0][0]: return tab[0][1]
    if y >= tab[-1][0]: return tab[-1][1]
    for (y0, z0), (y1, z1) in zip(tab, tab[1:]):
        if y0 <= y <= y1: return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
bfx, bfy, brx, bry, bh = P["bump"]
bX = P["x_out"] - bfx * (P["x_out"] - P["x_in"]); bY = P["y_front"] + bfy * (P["y_rear"] - P["y_front"])
Z_BOT = min(z for _, z in RIM)

def section(y, n_roof=12, n_fil=8, n_wall=8):
    """rim lip -> roof rising to the crest -> fillet -> engine-side wall; (x, z) on the LH side."""
    zr = lerp(RIM, y); xo, r = P["x_out"], P["fillet"]
    u = (y - P["y_front"]) / (P["y_rear"] - P["y_front"])
    f = 0.15 + 0.85 * min(1.0, u / P["front_taper"]) ** 0.7       # b_eckler_1: the dome falls onto the front tail
    zc = zr + P["crown"] * f
    xi = P["x_in"]          # full width to the front: b_oer_1 shows no narrowing (b_eckler_1 alone suggests some)
    r = r * (0.4 + 0.6 * f); zwb = min(P["z_wall_bottom"], zc - r - 0.01)
    pts = [(xo + P["lip"], zr), (xo, zr)]
    for i in range(1, n_roof + 1):
        t = i / n_roof
        x = xo + (xi + r - xo) * t
        z = zr + (zc - zr) * math.sin(t * math.pi / 2)
        d = ((x - bX) / brx) ** 2 + ((y - bY) / bry) ** 2
        if d < 1: z += bh * (0.5 + 0.5 * math.cos(math.pi * math.sqrt(d)))
        pts.append((x, z))
    for i in range(1, n_fil + 1):
        a = math.radians(90 + 90 * i / n_fil)
        pts.append((xi + r + r * math.cos(a), zc - r + r * math.sin(a)))
    for i in range(1, n_wall + 1):
        pts.append((xi, zc - r - (zc - r - zwb) * i / n_wall))
    pts.append((xi - P["lip"] * 0.6, zwb))     # wall's bottom flange (b_jegs_1)
    return pts

def build(name, sx):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    ys = [P["y_front"] + (P["y_rear"] - P["y_front"]) * i / 60 for i in range(61)]
    rows = []
    for y in ys:
        rows.append([bm.verts.new((sx * x, y, z)) for x, z in section(y)])
    for a, b in zip(rows, rows[1:]):
        for i in range(len(a) - 1):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]) if sx > 0 else (a[i], b[i], b[i + 1], a[i + 1]))
    # end caps: front flange (core support) and rear leg (cowl) close the tub between lip and wall bottom
    for row, y in ((rows[0], ys[0]), (rows[-1], ys[-1])):
        sec = section(y)
        xo = P["x_out"]
        ring = [bm.verts.new((sx * x, y, z)) for x, z in sec[1:-1]] + [bm.verts.new((sx * xo, y, sec[-2][1]))]
        f = bm.faces.new(ring if (sx > 0) == (y > -2) else ring[::-1])
    bm.normal_update(); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new("t", "SOLIDIFY"); m.thickness = 0.0015; m.offset = 0
    for p in me.polygons: p.use_smooth = True
    mat = bpy.data.materials.get("skirt") or bpy.data.materials.new("skirt")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.03, 0.03, 0.035, 1); bsdf.inputs["Metallic"].default_value = 0.2
    bsdf.inputs["Roughness"].default_value = 0.45
    ob.data.materials.append(mat)
    return ob

def scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    L = build("inner_fender_L", 1); R = build("inner_fender_R", -1)
    return L, R

if __name__ == "__main__":
    scene()
    json.dump({"P": P, "s_m_per_px": s, "rim": RIM, "bump_XY": [bX, bY]}, open(W + "/model.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=W + "/inner_fender.blend")
    print("OK", s, RIM[0], RIM[-1], min(RIM,key=lambda q:q[1]), max(RIM,key=lambda q:q[1]))
