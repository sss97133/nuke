"""The K5's engine assembly at true size, for the twin and the map tab: GM LS3 long block, the Holley LS intake,
the Holley Mid-Mount accessory drive (A/C delete, as installed), shorty cast headers and down-pipes.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python \
        docs/wiring/calc-data/cad/fab/engine_ls3.py -- --out nuke_frontend/public/models/k5-engine-ls3.glb \
        [--anchors docs/wiring/calc-data/twin_engine_anchors.json] [--table out.md] [--check out.json] [--renders dir]

Owner, 2026-09-30, on the old twin engine: "the engine is modeled very wrong ... exhaust is very wrong, headers wrong it
has shorty cast headers, like hooker brand etc." This replaces the E3_* nodes of the v4 bay GLB.

Frame. Built in engine-local millimetres: origin on the crank axis at the block's rear (bellhousing) face, +x driver,
+y rearward, +z up. Placed in twin metres (+x driver, -y forward, +z up) on the engine root in
twin_engine_anchors.json (Y_BELL, Z_CRANK), so twin = (x/1000, Y_BELL + y/1000, Z_CRANK + z/1000). The GLB is glTF Y-up:
glTF (X, Y, Z) = twin (x, z, -y).

Every number is D(value, source, basis, margin_mm). basis: maker = the maker prints it; scaled = measured off a maker
drawing with one of its printed numbers as the scale; photo = sized off the owner's photos against a sourced number;
receipt = a purchase record names it; derived = computed from other rows (the rule is in the source); assumed = in no
source we hold (the margin says how far off it could be). The throttle body is left out on purpose: layout-ui mounts
the part-library TB on the empty node "tb_flange" (position = the flange face, node +Y = the bore axis, pointing up).
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
ANCHORS = Path(opt("--anchors", REPO / "docs/wiring/calc-data/twin_engine_anchors.json"))

# ------------------------------------------------------------------------------------------ sources
LS3M = "GM Powertrain 2009 'LS3' 6.2L V8 marine spec sheet p.3 (reference_documents/component_drawings/Marine_LS3_6.2L_Specs.pdf)"
LS3M_SIDE = LS3M + ", side outline, scaled at its printed 710 (1.563 px/mm at 600 dpi; the four exhaust-port bosses space 113 mm, bore centre 111.76)"
LS3M_END = LS3M + ", end outline, scaled at its printed 705 / 716 (the sheet's two axes disagree by 6 %, so +-6 %)"
LB = "Chevrolet Performance 19420381 'LS3, LS376-480 & LS376-525 Long Block Specifications' Rev 25JA23 p.4 (reference_documents/component_drawings/LS3_Long_Block_Installation_Guide.pdf)"
H335 = "Holley 199R11335 'Complete Holley Mid-Mount Accessory Drive Kit' rev 11-15-21 (reference_documents/component_drawings/Holley_20-185_Mid_Mount_Install_Guide.pdf)"
H335_BELT = H335 + " p.12 belt-routing render, scaled at the P/S pulley's O170 (1.453 px/mm at 200 dpi); check: the same layout with the A/C gives a 1725 mm belt against Holley's printed BANDO 6PK1715 (0.6 %)"
H290 = "Holley 20-290 (Gen 3 HEMI) Mid-Mount instructions p.2 dimension page (reference_documents/component_drawings/extracted/holley_midmount_dimensional.png): same 197-302 alternator and 97-152 P/S pulley as the LS kit"
RCPT_MM = "Holley receipt 2023-08-02 (receipts 835f0223): LS cooling manifold AC delete 85R9913, water pump 32R120A, 197-302 alternator, 198-101 P/S pump, 97-152 P/S pulley, 97-151 tensioner (grooved), 97-150 idler (smooth, 76 mm), 69R398 crank damper/pulley, belt 70R254 = 6PK1539"
RCPT_IN = "Holley receipt 2023-11-09 (receipts 38a026c6): 20-186 Mid-Mount (WP + alt + PS), 300-129 LS3 dual-plane intake, 534-209 billet fuel rails; the install doc (IMG_9324, state row 28) says 300-131; the casting read is open (state 0ag g)"
H10690 = "Holley 199R10690 'GM LS Street Single-Plane Intake Manifold Kits' (300-131/136), DIMENSIONS section, as quoted in docs/wiring/twin/build_engine_v3.py (the sheet itself is not on disk)"
PH31 = "owner's photo IMG_6531 (vehicle_images 95eafee3 / 40e5e5f9, 2026-01-31): front view over the engine"
PH30 = "owner's photo IMG_6530 (vehicle_images 92367a72, 2026-01-31): passenger side, the passenger header"
PH32 = "owner's photo IMG_6532 (vehicle_images 772c8fff / dff584e9, 2026-01-31): driver side, the driver header, alternator and P/S"
OWNER = "owner 2026-09-30: 'it has shorty cast headers, like hooker brand etc.'"
FR88 = "docs/wiring/calc-data/cad/dimensions.yaml fr88.frame.width.A-A (706: front-rail inside faces)"


class D:
    def __init__(self, value, source, basis, margin=0.0, note=""):
        self.value, self.source, self.basis, self.margin, self.note = value, source, basis, margin, note

    def __float__(self):
        return float(self.value)


P = {
    # ---- long block
    "bore_center": D(111.76, LS3M + " 'Bore Center (mm): 111.76'", "maker", 0.0),
    "bore": D(103.25, LS3M + " 'Bore x Stroke: 103.25 x 92 mm'; " + LB + " '4.065 inch x 3.622 inch'", "maker", 0.0),
    "stroke": D(92.0, LS3M + "; " + LB, "maker", 0.0),
    "firing_order": D("1-8-7-2-6-5-4-3", LS3M + "; " + LB, "maker", 0.0, "odd cylinders on the driver bank, 1 at the front"),
    "bank_angle_deg": D(90.0, "GM Gen IV small-block V8; not printed in the sheets on file (the LS3M end outline draws the bank edges at 45 +-2 deg)", "assumed", 0.0),
    "deck_height": D(234.7, "GM LS block deck height 9.240 in; not printed in the sheets on file (docs/wiring/twin/build_engine_v3.py cites it as GM published)", "assumed", 1.0),
    "bank_stagger": D(24.0, "driver bank ahead of the passenger bank by one rod width; docs/wiring/twin/build_engine_v3.py 'approx 0.94 in'", "assumed", 3.0),
    "y_cyl8": D(-85.0, LS3M_SIDE + ": the rearmost passenger exhaust port sits 85 mm ahead of the block's rear face", "scaled", 12.0,
                "cylinder 8 bore centre; the other stations follow from bore_center and bank_stagger"),
    "block_len": D(510.0, LS3M_SIDE + ": rear face to the front-cover joint 501-514 (the joint line is read two ways)", "scaled", 15.0),
    "pan_rail_z": D(-89.0, LS3M_SIDE + ": pan rail 89 below the damper centre", "scaled", 8.0),
    "skirt_half": D(145.0, "LS crankcase half-width at the pan rail; not dimensioned in any sheet on file", "assumed", 15.0),
    "deck_half": D(108.0, "deck face half-width across the bank (bore radius 51.6 + water jacket + head-bolt bosses); not dimensioned", "assumed", 12.0),
    "valley_z": D(225.0, "valley cover flange height, docs/wiring/twin/build_engine_v3.py 'valley_flange_z' (derived there from the 9.240 in deck)", "derived", 10.0),
    "bell_half": D(237.0, LS3M_END + ": rear flange 474 wide at its lower corners", "scaled", 15.0),
    "bell_t": D(12.0, "rear flange thickness; not dimensioned", "assumed", 5.0),
    "head_w": D(224.0, "head width across the deck (exhaust face to intake face); not dimensioned", "assumed", 15.0),
    "head_h": D(118.0, "deck to the rocker-cover rail; not dimensioned", "assumed", 15.0),
    "head_len": D(470.0, "4 bores (3 x 111.76 + 103.25 = 438.5) + head-bolt bosses at each end; not dimensioned", "assumed", 15.0),
    "cover_w": D(176.0, PH30 + " / " + PH32 + ": Delmo DELVC01 'Chevrolet-Script SB Valve Covers, Black Paint' (receipt item ef6b4452) on the heads", "photo", 15.0),
    "cover_h": D(78.0, PH30 + " / " + PH32 + ": cover height against the head", "photo", 15.0),
    "front_cover_t": D(20.0, "Gen IV front (timing) cover depth ahead of the block face; not dimensioned", "assumed", 8.0),
    "pan_depth_z": D(-225.0, LS3M_SIDE + ": pan bottom 225 below the crank (the marine pan)", "scaled", 15.0,
                     "the truck's pan model is not on record: drawn at the LS3M marine pan depth with a rear sump (4WD front-axle clearance), ASSUMED"),
    "pan_front_z": D(-160.0, "shallow front of a rear-sump swap pan (clears the Dana 44); the truck's pan model is not on record", "assumed", 30.0),
    "sump_len": D(270.0, "rear-sump length; the truck's pan model is not on record", "assumed", 60.0),
    # ---- intake (Holley LS3 rectangular-port, 4150 flange; casting read open)
    "port_s": D(72.0, "intake port centre above the deck, on the head's intake face; not dimensioned", "assumed", 15.0),
    "port_h": D(63.5, H10690 + ": port 2.50 in high", "maker", 0.0),
    "port_w": D(29.2, H10690 + ": port 1.15 in wide", "maker", 0.0),
    "pad_above_valley": D(137.7, H10690 + ": 'A & B - 5.42 in (0 deg carb flange angle)', heights to the lifter-valley cover flange", "maker", 5.0,
                          "300-131 number; if the casting is the 300-129 dual plane its height is not on file"),
    "pad_bolts": D("5.16 x 5.625 in", H10690 + ": 'Carburetor Flange - Standard 4150'", "maker", 0.0),
    "pad_w": D(146.0, "4150 flange outline (bolt pattern 131 x 143 plus bosses)", "derived", 5.0),
    "pad_y": D(-240.0, PH31 + " / " + PH32 + ": the 4150 pad sits at mid-rear of the plenum", "photo", 40.0),
    "plenum_len": D(200.0, PH31 + ": plenum under the TB riser, the runners radiating from it", "photo", 40.0),
    "plenum_w": D(170.0, PH31 + ": plenum between the rails", "photo", 25.0),
    "runner_d": D(56.0, "runners drawn round at the port's area-equivalent size (29.2 x 63.5 port); the casting's runners are rectangular", "derived", 8.0),
    "adapter_h": D(25.0, "Delmo Speed 4150-to-4-bolt truck TB adapter (order record obs:a58db14b), docs/wiring/twin/build_engine_v3.py 'tb_adapter_h' (photo)", "photo", 8.0),
    "tb_bore": D(92.0, "vehicle_build_manifest: GM/Hitachi 12699160 L8T 6.6L truck TB, ~92 mm bore", "receipt", 3.0),
    "rail_sq": D(22.0, "Holley 534-209 billet rails (receipt item 1b3f7d4f), docs/wiring/twin/build_engine_v3.py 'rail_od' (photo)", "photo", 4.0),
    "rail_xz": D((150.0, 372.0), PH31 + " / " + PH32 + ": rails ride just inboard of the valve covers, above the injector bosses", "photo", 20.0),
    # ---- Holley Mid-Mount, A/C delete (receipt 835f0223)
    "mm_bolt": D(115.0, H335 + " p.2 hardware: 'Flange Head Bolt, M8 x 1.25 x 115 - Manifold to Engine Block' (x5)", "maker", 0.0),
    "mm_outline": D("18-point front outline", H335_BELT + " (the casting's front outline traced at the same scale; the A/C adapter corner removed for the A/C-delete 85R9913)", "scaled", 10.0),
    "pk_rib": D(3.56, "PK (6PK) belt rib pitch; the grooved pulleys are drawn with 6 grooves 2.4 deep", "derived", 0.5),
    "mm_depth": D(95.0, "M8 x 115 bolt less ~20 mm thread engagement = the manifold's depth at its bolt bosses", "derived", 8.0),
    "belt_y": D(-690.0, "belt plane: the 190 mm alternator (pulley front to rear cover) must clear the driver head's front face (-512); "
                "rear cover 6 mm ahead of it puts the pulley centre at -690", "derived", 20.0),
    "belt_len": D(1539.0, RCPT_MM + "; the belt in " + PH31 + " reads '6PK1539'", "receipt", 0.0),
    "belt_w": D(21.4, "6PK belt: 6 ribs at the PK pitch 3.56 mm", "derived", 0.5),
    "damper_d": D(176.0, H335_BELT, "scaled", 8.0, "Holley 69R398 crank damper/pulley (receipt 835f0223)"),
    "damper_xz": D((0.0, 0.0), "on the crank axis", "maker", 0.0),
    "wp_d": D(142.0, H335_BELT + " (water-pump pulley, smooth, belt back side)", "scaled", 8.0),
    "wp_xz": D((0.0, 199.6), H335_BELT, "scaled", 8.0),
    "alt_xz": D((184.0, 262.0), H335_BELT + "; driver side high as in " + PH31 + " / " + PH32, "scaled", 8.0),
    "alt_case_d": D(136.0, H335_BELT + " gives 133; " + H290 + " at its printed 255 gives 136-141 (dev_engine.py draws 152)", "scaled", 6.0),
    "alt_len": D(190.0, "dev_engine.py holley_197_302 'length' (pulley front to the rear cover, scaled off " + H290 + ")", "scaled", 8.0),
    "alt_pulley_d": D(58.0, H335_BELT + " (6-rib pulley)", "scaled", 6.0),
    "ps_xz": D((172.0, 102.5), H335_BELT + "; driver side low as in " + PH32, "scaled", 8.0),
    "ps_pulley_d": D(170.0, H290 + ": 'O6 3/4 [170]' Holley 97-152, the pulley on receipt 835f0223", "maker", 0.0),
    "ps_body_d": D(105.0, "Type II pump body behind the pulley; not dimensioned", "assumed", 15.0),
    "res_d": D(88.0, PH32 + ": Holley 198-101 integral reservoir, black with the Holley cap", "photo", 12.0),
    "idler_d": D(76.0, RCPT_MM + " ('Idler pulley, smooth, 76mm' 97-150)", "receipt", 0.0),
    "idler_xz": D((-135.6, 167.0), H335_BELT + ": the A/C kit's back-side (smooth) pulley position; the A/C-delete idler rides there in " + PH31, "scaled", 15.0),
    "tens_d": D(70.0, "97-151 tensioner pulley (grooved), not dimensioned", "assumed", 8.0),
    "tens_xz": D((-168.0, 240.0), "x off " + PH31 + " (scaled against the alternator offset); z solved so the belt path closes at the 6PK1539 length", "derived", 15.0),
    # ---- shorty cast headers (owner testimony; PN unknown)
    "hdr_port_s": D(40.0, "exhaust port centre above the deck, on the head's exhaust face; not dimensioned", "assumed", 12.0),
    "hdr_primary_d": D(54.0, PH30 + " / " + PH32 + ": cast primaries against the port pitch (111.76)", "photo", 8.0),
    "hdr_log_d": D(66.0, PH30 + " / " + PH32 + ": the lower log the primaries merge into", "photo", 10.0),
    "hdr_log_x": D(300.0, PH30 + " / " + PH32 + "; stays inside the frame rails' inside faces at +-353 (" + FR88 + ")", "photo", 20.0),
    "hdr_log_z": D(0.0, PH30 + " / " + PH32 + ": the log runs at about crank height", "photo", 35.0),
    "hdr_outlet_z": D(-70.0, PH30 + ": collector flange at the rear bottom, facing down", "photo", 30.0),
    "downpipe_d": D(64.0, "2.5 in down-pipe; the pipes below the collector flange are not photographed", "assumed", 13.0),
    "downpipe_end_y": D(420.0, "down-pipes drawn to 420 mm behind the bell face (beside the 6L90); route not photographed", "assumed", 150.0),
}
v = lambda k: float(P[k].value) if not isinstance(P[k].value, tuple) else P[k].value

# ------------------------------------------------------------------------------------------ frame
anch = json.loads(ANCHORS.read_text())
Y_BELL = anch["_engine_root"]["Y_BELL"]
Z_CRANK = anch["_engine_root"]["Z_CRANK"]
M_WORLD = Matrix.Translation((0.0, Y_BELL, Z_CRANK)) @ Matrix.Scale(0.001, 4)
S45 = math.sin(math.radians(v("bank_angle_deg") / 2))
C45 = math.cos(math.radians(v("bank_angle_deg") / 2))
DECK = v("deck_height")


def n_(sig):   # cylinder axis of a bank, in (x, z)
    return (sig * S45, C45)


def t_(sig):   # across the deck, toward the exhaust side
    return (sig * C45, -S45)


def bank_pt(sig, s, r, y):
    """engine-local point: s along the bank axis above the deck, r across it (+ = exhaust side)"""
    n, t = n_(sig), t_(sig)
    return Vector(((DECK + s) * n[0] + r * t[0], y, (DECK + s) * n[1] + r * t[1]))


BS, STAG = v("bore_center"), v("bank_stagger")
Y8 = v("y_cyl8")
STATION = {}
for i, cyl in enumerate((2, 4, 6, 8)):
    STATION[cyl] = Y8 - (3 - i) * BS
for cyl in (1, 3, 5, 7):
    STATION[cyl] = STATION[cyl + 1] - STAG
BANK = {1: 1, 3: 1, 5: 1, 7: 1, 2: -1, 4: -1, 6: -1, 8: -1}   # +1 driver (odd), -1 passenger (even)
HEAD_Y = {sig: (sum(STATION[c] for c in STATION if BANK[c] == sig) / 4) for sig in (1, -1)}

# ------------------------------------------------------------------------------------------ materials (colours from his photos)
MATS = {}


def mat(name, hexc, metallic, rough):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    h = hexc.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*lin, 1.0)
    MATS[name] = m
    return m


def M(key):
    return {
        "block": ("cast aluminium (block, heads, front cover)", "#80817c", 0.35, 0.6),   # PH31/PH32 natural castings
        "intake": ("cast aluminium, as-cast Holley intake", "#9a968a", 0.35, 0.65),        # PH31: sandy natural casting
        "manifold": ("cast aluminium, Holley manifold natural", "#a6a49c", 0.4, 0.55),     # PH31: 85R9913 raw
        "cover": ("gloss black paint (valve covers)", "#141517", 0.0, 0.22),             # PH30/PH32 DELVC01 black paint
        "anod": ("black anodised aluminium (rails, pulleys)", "#1c1c1e", 0.5, 0.4),      # PH31/PH32
        "billet": ("polished billet aluminium (TB adapter)", "#d9d9d6", 1.0, 0.15),      # PH31
        "alt": ("natural aluminium (alternator case)", "#b9bcbe", 0.6, 0.4),            # dev_engine.py TRUCK_ENG colour
        "header": ("coated cast header (glossy grey)", "#5f5d5a", 0.8, 0.28),            # PH30/PH32 crops
        "pipe": ("mild steel down-pipe", "#77736d", 1.0, 0.5),                           # assumed, not photographed
        "belt": ("rubber belt", "#151515", 0.0, 0.85),
        "plastic": ("black plastic (P/S reservoir)", "#121212", 0.0, 0.5),               # PH32
        "damper": ("black damper/pulley", "#1b1b1c", 0.4, 0.5),                          # PH31
        "chrome": ("zinc/chrome fittings", "#b8b8b4", 1.0, 0.2),                         # PH31 barbs
        "pan": ("cast aluminium oil pan (model not on record)", "#777874", 0.35, 0.6),
    }[key]


def material(key):
    name, hexc, met, rough = M(key)
    return mat(name, hexc, met, rough)


# ------------------------------------------------------------------------------------------ mesh helpers (engine-local mm)
OBJS = []


def emit(name, bm, key, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.transform(M_WORLD)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material(key))
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel * 0.001
        mod.segments = 2
        mod.limit_method = "ANGLE"
    for p in ob.data.polygons:
        p.use_smooth = False
    OBJS.append(ob)
    return ob


def join(name, parts, key, bevel=0.0):
    bm = bmesh.new()
    for part in parts:
        tmp = bpy.data.meshes.new("tmp")
        part.to_mesh(tmp)
        part.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return emit(name, bm, key, bevel)


def box(c, size, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot is not None:
        bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def cyl(c, d, length, axis="y", seg=40, d2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=d / 2, radius2=(d2 or d) / 2, depth=length)
    rot = {"z": Matrix.Identity(3), "y": Matrix.Rotation(math.radians(-90), 3, "X"), "x": Matrix.Rotation(math.radians(90), 3, "Y")}[axis]
    bmesh.ops.transform(bm, matrix=rot.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def ribbed(c, d, width, ribs=6, depth=2.4, seg=56):
    """a grooved (poly-V) pulley along y: a lathe profile with `ribs` grooves across the belt width, centred at c"""
    bm = bmesh.new()
    R, w = d / 2, width
    pitch = v("pk_rib")
    band = min(w, ribs * pitch)
    prof = [(0.01, -w / 2), (R, -w / 2), (R, -band / 2)]
    for i in range(ribs):
        y0 = -band / 2 + i * pitch
        prof += [(R - depth, y0 + pitch / 2), (R, y0 + pitch)]
    prof += [(R, w / 2), (0.01, w / 2)]
    vs = [bm.verts.new((r, y, 0.0)) for r, y in prof]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 1, 0), angle=2 * math.pi, steps=seg, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def ring(c, d_in, d_out, length, axis="z", seg=48):
    """a tube (annulus prism) along the axis, centred at c"""
    bm = bmesh.new()
    ro, ri, h = d_out / 2, d_in / 2, length / 2
    outer_b, outer_t, inner_b, inner_t = [], [], [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        ca, sa = math.cos(a), math.sin(a)
        outer_b.append(bm.verts.new((ro * ca, ro * sa, -h)))
        outer_t.append(bm.verts.new((ro * ca, ro * sa, h)))
        inner_b.append(bm.verts.new((ri * ca, ri * sa, -h)))
        inner_t.append(bm.verts.new((ri * ca, ri * sa, h)))
    for k in range(seg):
        k2 = (k + 1) % seg
        bm.faces.new((outer_b[k], outer_b[k2], outer_t[k2], outer_t[k]))
        bm.faces.new((inner_b[k2], inner_b[k], inner_t[k], inner_t[k2]))
        bm.faces.new((outer_t[k], outer_t[k2], inner_t[k2], inner_t[k]))
        bm.faces.new((outer_b[k2], outer_b[k], inner_b[k], inner_b[k2]))
    rot = {"z": Matrix.Identity(3), "y": Matrix.Rotation(math.radians(-90), 3, "X")}[axis]
    bmesh.ops.transform(bm, matrix=rot.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return bm


def prism_xz(pts, y0, y1):
    """extrude a polygon given in (x, z) along y from y0 to y1"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    for k in range(n):
        bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bank_box(sig, s0, s1, r0, r1, y0, y1):
    """a box aligned to a bank: s (along the bank axis above the deck) x r (across) x y"""
    bm = bmesh.new()
    corners = {}
    for i, s in enumerate((s0, s1)):
        for j, r in enumerate((r0, r1)):
            for k, y in enumerate((y0, y1)):
                corners[(i, j, k)] = bm.verts.new(bank_pt(sig, s, r, y))
    q = corners
    for f in [((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)), ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)),
              ((0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)), ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)),
              ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)), ((0, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0, 1))]:
        bm.faces.new([q[c] for c in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(name, pts, d, key, closed=False, res=10):
    """a round tube along a smooth path through the given engine-local points (a NURBS-free Bezier with auto handles)"""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = d / 2
    cu.bevel_resolution = 4
    cu.resolution_u = res
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = Vector(p)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name + "_curve", cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def text_mesh(body, size, depth):
    """raised lettering in the XY plane (reads along +X, up +Y, raised along +Z), centred on the origin"""
    cu = bpy.data.curves.new("text", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = 2          # keeps the lettering to a few thousand triangles
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    for f in ("/System/Library/Fonts/Supplemental/Brush Script.ttf",):   # a script face like the covers'; Blender's own font otherwise
        if Path(f).exists():
            cu.font = bpy.data.fonts.load(f)
    ob = bpy.data.objects.new("text", cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.translate(bm, vec=Vector((0, 0, depth / 2)), verts=bm.verts)
    return bm


def empty(name, p_local, note=""):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "ARROWS"
    ob.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(ob)
    ob.location = M_WORLD @ Vector(p_local)
    OBJS.append(ob)
    return ob


# ------------------------------------------------------------------------------------------ build
def build():
    L = v("block_len")
    PR = v("pan_rail_z")
    SK = v("skirt_half")
    DH = v("deck_half")
    VZ = v("valley_z")
    outer = (DECK * S45 + DH * C45, DECK * C45 - DH * S45)      # outer (exhaust-side) deck edge, driver bank
    inner = (DECK * S45 - DH * C45, DECK * C45 + DH * S45)      # inner (valley-side) deck edge
    half = [(0, PR), (SK, PR), (SK, 0), outer, inner, (inner[0] - 30, VZ), (0, VZ)]
    prof = half + [(-x, z) for x, z in reversed(half[1:-1])]
    prof = [(0, PR)] + prof[1:]
    join("block", [prism_xz(prof[:1] + prof[1:], -L, -v("bell_t"))], "block", bevel=3)

    BH = v("bell_half")
    deck_at = lambda x: DECK / C45 - x * S45 / C45      # deck line z at |x| (driver bank)
    bell = [(-BH, PR + 29), (BH, PR + 29), (BH, deck_at(BH)), inner, (-inner[0], inner[1]), (-BH, deck_at(BH))]
    join("bell_face", [prism_xz(bell, -v("bell_t"), 0.0)], "block", bevel=2)

    # heads + valve covers
    HL, HW, HH = v("head_len"), v("head_w"), v("head_h")
    for sig, tag in ((1, "L"), (-1, "R")):
        yc = HEAD_Y[sig]
        join(f"head_{tag}", [bank_box(sig, 0, HH, -HW / 2, HW / 2, yc - HL / 2, yc + HL / 2)], "block", bevel=4)
        CW, CH = v("cover_w"), v("cover_h")
        join(f"valve_cover_{tag}", [bank_box(sig, HH, HH + CH, -CW / 2, CW / 2, yc - HL / 2 + 8, yc + HL / 2 - 8)], "cover", bevel=14)
        # the covers' embossed "Chevrolet" script on the outer face (IMG_6530 / IMG_6532), redrawn, cosmetic
        n3 = Vector((sig * S45, 0, C45))
        t3 = Vector((sig * C45, 0, -S45))
        rot = Matrix((Vector((0, sig, 0)), n3, t3)).transposed().to_4x4()
        txt = text_mesh("Chevrolet", 64.0, 2.5)
        bmesh.ops.transform(txt, matrix=rot, verts=txt.verts)
        bmesh.ops.translate(txt, vec=bank_pt(sig, HH + CH / 2, CW / 2 + 1.0, yc), verts=txt.verts)
        join(f"valve_cover_script_{tag}", [txt], "cover")

    # front cover (Gen IV timing cover) and the balancer
    FT = v("front_cover_t")
    fc = [(-SK + 10, PR + 5), (SK - 10, PR + 5), (SK + 5, 60), (120, 170), (-120, 170), (-SK - 5, 60)]
    join("front_cover", [prism_xz(fc, -L - FT, -L)], "block", bevel=3)

    BY = v("belt_y")
    DD = v("damper_d")
    join("balancer", [ribbed((0, BY, 0), DD, 30), cyl((0, (BY + 15 + (-L - FT)) / 2, 0), 92, abs((-L - FT) - (BY + 15))),
                      cyl((0, BY - 17, 0), 60, 6)], "damper", bevel=0)

    # oil pan: shallow front, rear sump (model not on record)
    PD, PF, SL = v("pan_depth_z"), v("pan_front_z"), v("sump_len")
    pan_front = prism_xz([(-SK + 8, PR), (SK - 8, PR), (SK - 20, PF), (-SK + 20, PF)], -L + 5, -SL)
    pan_sump = prism_xz([(-SK + 8, PR), (SK - 8, PR), (SK - 25, PD), (-SK + 25, PD)], -SL, -v("bell_t") - 2)
    join("oil_pan", [pan_front, pan_sump], "pan", bevel=6)

    # ---- intake
    PAD_Y, PL, PW = v("pad_y"), v("plenum_len"), v("plenum_w")
    PAD_Z = VZ + v("pad_above_valley")
    PZ0 = VZ + 12                                                   # plenum floor, on the valley plate
    parts = [box((0, PAD_Y, (PZ0 + PAD_Z - 12) / 2), (PW, PL, PAD_Z - 12 - PZ0)),
             box((0, PAD_Y, PAD_Z - 6), (v("pad_w"), v("pad_w") + 12, 12)),
             box((0, HEAD_Y[1] / 2 + HEAD_Y[-1] / 2, VZ + 6), (2 * inner[0] - 20, v("head_len") - 30, 12))]
    RD = v("runner_d")
    runner_ends = {}
    for cyl_n, y in STATION.items():
        sig = BANK[cyl_n]
        p0 = bank_pt(sig, v("port_s"), -HW / 2 - 4, y)
        into = Vector((-t_(sig)[0], 0, -t_(sig)[1]))
        p1 = p0 + into * 40
        # runners radiate from the plenum as in IMG_6531: each enters the plenum wall on the line from the plenum
        # centre to its port (the front pair through the front face, the Λ in the photo; the rest through the sides)
        dx, dy = p0.x, y - PAD_Y
        k = min((PW / 2) / abs(dx), (PL / 2) / abs(dy) if dy else 9e9)
        ex, ey = dx * k, PAD_Y + dy * k
        z_in = (PZ0 + PAD_Z - 12) / 2 + 8
        p3 = Vector((ex * 0.8, PAD_Y + (ey - PAD_Y) * 0.8, z_in))
        p2 = Vector((ex + (p1.x - ex) * 0.45, ey + (y - ey) * 0.45, z_in + 6))
        parts.append(tube(f"runner_{cyl_n}", [p0, p1, p2, p3], RD, "intake"))
        # port flange boss on the head's intake face
        parts.append(bank_box(sig, v("port_s") - 42, v("port_s") + 42, -HW / 2 - 14, -HW / 2, y - 26, y + 26))
        runner_ends[cyl_n] = (p0, p1)
    join("intake_300-131", parts, "intake", bevel=0)

    # TB adapter (Delmo 4150 -> 4-bolt truck TB) + the empties layout-ui mounts on
    AH = v("adapter_h")
    join("tb_adapter", [box((0, PAD_Y, PAD_Z + 5), (v("pad_w") - 6, v("pad_w") - 6, 10)),
                        ring((0, PAD_Y, PAD_Z + 10 + (AH - 10) / 2), v("tb_bore"), v("tb_bore") + 26, AH - 10)], "billet", bevel=0)
    empty("intake_4150_pad", (0, PAD_Y, PAD_Z))
    empty("tb_flange", (0, PAD_Y, PAD_Z + AH))

    # fuel rails + injectors
    RX, RZ = v("rail_xz")
    RS = v("rail_sq")
    inj_pos = {}
    for sig, tag in ((1, "L"), (-1, "R")):
        ys = [STATION[c] for c in STATION if BANK[c] == sig]
        join(f"fuel_rail_{tag}", [box((sig * RX, (min(ys) + max(ys)) / 2, RZ), (RS, max(ys) - min(ys) + 90, RS))], "anod", bevel=2)
        inj = []
        for c in STATION:
            if BANK[c] != sig:
                continue
            p0, p1 = runner_ends[c]
            boss = p0 + (p1 - p0) * 0.75 + Vector((0, 0, RD / 2 - 4))
            top = Vector((sig * RX, STATION[c], RZ - RS / 2))
            mid = (boss + top) / 2
            ax = (top - boss)
            lng = ax.length
            rotm = ax.to_track_quat("Z", "Y").to_matrix().to_4x4()
            b = cyl((0, 0, 0), 17, lng, axis="z")
            bmesh.ops.transform(b, matrix=rotm, verts=b.verts)
            bmesh.ops.translate(b, vec=mid, verts=b.verts)
            inj.append(b)
            inj_pos[c] = mid
        join(f"injectors_{tag}", inj, "plastic")

    # ---- Holley Mid-Mount (A/C delete)
    FACE = -L - FT                        # front-cover face the manifold bolts over
    MF = -L - v("mm_depth")               # manifold front face at its bolt bosses
    WX, WZ = v("wp_xz")
    AX, AZ = v("alt_xz")
    PX, PZ = v("ps_xz")
    IX, IZ = v("idler_xz")
    TX, TZ = v("tens_xz")
    D_ = FACE - MF                                                               # manifold depth ahead of the cover
    yc_ = (MF + FACE) / 2
    post = lambda x, z, d: cyl((x, (MF + BY + 13) / 2, z), d, abs(MF - (BY + 13)))
    # front outline of the casting traced off the 199R11335 p.12 render at the same scale (1.453 px/mm, crank at
    # render px 425, 574), with the A/C adapter corner removed for the A/C-delete 85R9913
    outline = [(-65, 116), (65, 116), (93, 168), (127, 189), (148, 223), (134, 271), (93, 292), (52, 271), (0, 278),
               (-65, 271), (-114, 237), (-155, 223), (-189, 189), (-224, 168), (-265, 147), (-265, 92), (-189, 85),
               (-120, 106)]
    mm = [prism_xz(outline, MF, FACE),
          cyl((WX, yc_ - 4, WZ), 190, D_ + 8),                                      # water-pump boss
          cyl((-240, yc_, 118), 70, D_),                                            # thermostat housing (passenger end)
          post(IX, IZ, 34), post(TX, TZ - 45, 56)]                                  # idler post, tensioner arm boss
    join("midmount_bracket", mm, "manifold", bevel=4)
    join("midmount_fittings", [cyl((-95, MF - 20, 225), 19, 45), cyl((-240, MF - 18, 110), 38, 40)], "chrome")   # heater barb, inlet (IMG_6531)

    join("water_pump", [cyl((WX, BY, WZ), v("wp_d"), 30), cyl((WX, (BY + MF) / 2, WZ), 70, abs(MF - BY) + 4),
                        cyl((WX, BY - 16, WZ), 44, 6)], "anod", bevel=0)

    AL, ACD, APD = v("alt_len"), v("alt_case_d"), v("alt_pulley_d")
    y_front = BY - 14
    join("alternator_197-302", [cyl((AX, y_front + 28 + (AL - 28) / 2, AZ), ACD, AL - 28),
                                cyl((AX, y_front + 28 + 12, AZ), ACD + 10, 18)], "alt", bevel=3)
    join("alternator_pulley", [ribbed((AX, BY, AZ), APD, 28), cyl((AX, BY - 15, AZ), 30, 4)], "anod")

    PSD = v("ps_pulley_d")
    join("ps_pulley", [ribbed((PX, BY, PZ), PSD, 26), cyl((PX, BY + 8, PZ), 50, 40)], "anod")
    RES = v("res_d")
    join("ps_pump", [cyl((PX, BY + 30 + 55, PZ), v("ps_body_d"), 110),
                     cyl((PX + 55, BY + 95, PZ + 55), RES, 105, axis="z"),
                     cyl((PX + 55, BY + 95, PZ + 55 + 58), 60, 12, axis="z")], "plastic", bevel=2)
    join("tensioner", [ribbed((TX, BY, TZ), v("tens_d"), 26), box((TX + 8, BY + 30, TZ - 40), (40, 30, 90))], "anod", bevel=2)
    join("idler", [cyl((IX, BY, IZ), v("idler_d"), 26)], "anod")

    # belt path (6PK1539): solve the tangents around the pulleys, loop CCW seen from the front
    order = [("crank", 0.0, 0.0, DD / 2, True), ("ps", PX, PZ, PSD / 2, True), ("alt", AX, AZ, APD / 2, True),
             ("wp", WX, WZ, v("wp_d") / 2, False), ("tens", TX, TZ, v("tens_d") / 2, True), ("idler", IX, IZ, v("idler_d") / 2, False)]
    length, path, arcs = belt_path(order)
    bm = bmesh.new()
    BW, BT = v("belt_w"), 4.5
    loops = []
    for i, (x, z, nx, nz) in enumerate(path):
        vs = []
        for dy in (-BW / 2, BW / 2):
            for dr in (-BT / 2, BT / 2):
                vs.append(bm.verts.new((x + nx * dr, BY + dy, z + nz * dr)))
        loops.append(vs)
    n = len(loops)
    for i in range(n):
        a, b = loops[i], loops[(i + 1) % n]
        for (p, q) in ((0, 1), (1, 3), (3, 2), (2, 0)):
            bm.faces.new((a[p], b[p], b[q], a[q]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit("belt", bm, "belt")

    # ---- shorty cast headers + down-pipes
    PD_, LD = v("hdr_primary_d"), v("hdr_log_d")
    LX, LZ, OZ = v("hdr_log_x"), v("hdr_log_z"), v("hdr_outlet_z")
    ports = {}
    for sig, tag in ((1, "L"), (-1, "R")):
        cyls = sorted([c for c in STATION if BANK[c] == sig], key=lambda c: STATION[c])
        y_front, y_rear = STATION[cyls[0]], STATION[cyls[-1]]
        y_out = y_rear + 42
        parts = [bank_box(sig, v("hdr_port_s") - 34, v("hdr_port_s") + 34, HW / 2, HW / 2 + 12, y_front - 40, y_rear + 40)]
        out_dir = Vector((t_(sig)[0], 0, t_(sig)[1]))
        for c in cyls:
            y = STATION[c]
            p0 = bank_pt(sig, v("hdr_port_s"), HW / 2 + 6, y)
            p1 = p0 + out_dir * 34
            p2 = Vector((sig * LX, y + 12, (p1.z + LZ) / 2 - 5))
            p3 = Vector((sig * LX, y + 30, LZ + 10))
            parts.append(tube(f"primary_{c}", [p0, p1, p2, p3], PD_, "header"))
            ports[c] = p0
        parts.append(tube(f"log_{tag}", [Vector((sig * LX, y_front + 10, LZ + 8)), Vector((sig * LX, (y_front + y_rear) / 2, LZ)),
                                         Vector((sig * LX, y_out - 20, LZ - 8)), Vector((sig * LX, y_out, OZ + 25)),
                                         Vector((sig * LX, y_out + 4, OZ))], LD, "header"))
        parts.append(cyl((sig * LX, y_out + 4, OZ - 4), LD + 30, 8, axis="z"))          # collector flange
        join(f"header_{tag}", parts, "header", bevel=0)
        ye = v("downpipe_end_y")
        dp = [Vector((sig * LX, y_out + 4, OZ - 8)), Vector((sig * (LX + 8), y_out + 50, OZ - 75)),
              Vector((sig * (LX + 15), y_out + 180, OZ - 100)), Vector((sig * (LX + 15), ye, OZ - 105))]
        join(f"downpipe_{tag}", [tube(f"downpipe_{tag}", dp, v("downpipe_d"), "pipe")], "pipe")
    return dict(length=length, arcs=arcs, inj=inj_pos, ports=ports, pad_z=PAD_Z, belt_y=BY)


def belt_path(order, n_arc=28):
    """tangent-arc path around circles in loop order (CCW seen from the front, x = driver, z = up).
    inside=True: the pulley is inside the loop (ribbed side, wrapped CCW); False: the belt's back runs on it (CW).
    Returns the length on the belt's inner face and a list of (x, z, nx, nz) with n pointing out of the loop."""
    N = len(order)
    tans = []
    for i in range(N):
        a, b = order[i], order[(i + 1) % N]
        ra = a[3] if a[4] else -a[3]
        rb = b[3] if b[4] else -b[3]
        dx, dz = b[1] - a[1], b[2] - a[2]
        L = math.hypot(dx, dz)
        th = math.atan2(dz, dx) - math.asin((rb - ra) / L)
        nl = (-math.sin(th), math.cos(th))
        tans.append(((a[1] - ra * nl[0], a[2] - ra * nl[1]), (b[1] - rb * nl[0], b[2] - rb * nl[1])))
    total, pts, arcs = 0.0, [], {}
    for i in range(N):
        p = order[i]
        pin, pout = tans[i - 1][1], tans[i][0]
        a0 = math.atan2(pin[1] - p[2], pin[0] - p[1])
        a1 = math.atan2(pout[1] - p[2], pout[0] - p[1])
        da = (a1 - a0) % (2 * math.pi) if p[4] else -((a0 - a1) % (2 * math.pi))
        arcs[p[0]] = round(math.degrees(abs(da)), 1)
        total += abs(da) * p[3]
        for k in range(n_arc + 1):
            t = a0 + da * k / n_arc
            c, s = math.cos(t), math.sin(t)
            sgn = 1.0 if p[4] else -1.0          # outward from the loop
            pts.append((p[1] + p[3] * c, p[2] + p[3] * s, sgn * c, sgn * s))
        (x0, z0), (x1, z1) = tans[i]
        total += math.hypot(x1 - x0, z1 - z0)
    return total, pts, arcs


# ------------------------------------------------------------------------------------------ anchors check
def anchor_check(info):
    """Where each twin anchor sits against the true-size model: the nearest modelled surface, the distance, inside or
    not. The anchors are not moved; this lists what the model would move."""
    dg = bpy.context.evaluated_depsgraph_get()
    meshes = [o for o in OBJS if o.type == "MESH"]
    rows = []
    for key, a in anch["anchors"].items():
        p = Vector(a["xyz_m"])
        best = None
        for o in meshes:
            oe = o.evaluated_get(dg)
            inv = oe.matrix_world.inverted()
            ok, loc, nrm, _ = oe.closest_point_on_mesh(inv @ p)
            if not ok:
                continue
            w = oe.matrix_world @ loc
            d = (w - p).length
            if best is None or d < best[1]:
                inside = (p - w).dot(oe.matrix_world.to_3x3() @ nrm) < 0
                best = (o.name, d, inside)
        rows.append({"anchor": key, "nearest": best[0], "mm": round(best[1] * 1000, 1), "inside": bool(best[2])})
    for c, pos in info["inj"].items():
        a = anch["anchors"].get(f"inj_{c}")
        if a:
            w = M_WORLD @ pos
            d = w - Vector(a["xyz_m"])
            rows.append({"anchor": f"inj_{c}", "model_injector_m": [round(x, 4) for x in w], "delta_mm": [round(x * 1000, 1) for x in d]})
    tb = M_WORLD @ Vector((0, v("pad_y"), info["pad_z"] + v("adapter_h")))
    rows.append({"anchor": "tb_flange", "xyz_m": [round(x, 4) for x in tb]})
    return rows


# ------------------------------------------------------------------------------------------ renders
VIEWS = {  # name: (direction from the engine to the camera in twin axes, orthographic?)
    "front34": ((0.62, -0.62, 0.48), False),     # driver-front corner, above
    "driver": ((1.0, 0.0, 0.08), True),
    "passenger": ((-1.0, 0.0, 0.08), True),
    "top": ((0.0, 0.0001, 1.0), True),
    "front_high": ((0.0, -0.78, 0.63), False),   # about where IMG_6531 was taken from
}


def render(outdir, px=1400):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    meshes = [o for o in OBJS if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr, size = (lo + hi) / 2, max(hi - lo)
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.64, 0.67, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    for name, loc, energy in (("key", (1.2, -1.6, 2.2), 160), ("fill", (-1.8, -0.8, 1.2), 70), ("rim", (0.3, 1.8, 1.8), 110)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, 1.4
        lo_ = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(lo_)
        lo_.location = ctr + Vector(loc)
        lo_.rotation_euler = (ctr - lo_.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=8, location=(ctr.x, ctr.y, lo.z - 0.01))
    floor = bpy.context.active_object
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.36, 0.38, 1)
    floor.data.materials.append(fm)
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_d.clip_start, cam_d.clip_end = 0.01, 50
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x, scene.render.resolution_y = px, int(px * 0.75)
    for name, (d, ortho) in VIEWS.items():
        d = Vector(d).normalized()
        floor.hide_render = name == "top"
        cam_d.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam_d.ortho_scale = size * 1.15
            cam.location = ctr + d * 4.0
        else:
            cam_d.lens = 50
            cam.location = ctr + d * size * 2.1
        up = "Y" if name == "top" else "Y"
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", up).to_euler()
        scene.render.filepath = str(outdir / f"k5-engine-ls3_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", scene.render.filepath)


# ------------------------------------------------------------------------------------------ export
def export(path):
    for o in bpy.context.scene.objects:
        o.select_set(o in OBJS)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_extras=False, export_cameras=False, export_lights=False,
                              export_draco_mesh_compression_enable=False, export_normals=True, export_texcoords=False,
                              export_materials="EXPORT")
    scrub(path)


def scrub(path):
    """strip every extras (root, scenes, nodes), keep the asset block minimal"""
    import struct
    raw = Path(path).read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jl])
    rest = raw[20 + jl:]
    j.pop("extras", None)
    for key in ("scenes", "nodes", "meshes", "materials"):
        for item in j.get(key, []):
            item.pop("extras", None)
    finish = {M(k)[0]: (M(k)[2], M(k)[3]) for k in ("block", "intake", "manifold", "cover", "anod", "billet", "alt", "header",
                                                  "pipe", "belt", "plastic", "damper", "chrome", "pan")}
    for m in j.get("materials", []):   # the exporter drops factors equal to the glTF default (1.0); write them all
        pbr = m.setdefault("pbrMetallicRoughness", {})
        met, rough = finish.get(m.get("name"), (pbr.get("metallicFactor", 1.0), pbr.get("roughnessFactor", 1.0)))
        pbr["metallicFactor"], pbr["roughnessFactor"] = float(met), float(rough)
    j["asset"] = {"version": "2.0", "generator": "docs/wiring/calc-data/cad/fab/engine_ls3.py (Blender glTF I/O)"}
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    Path(path).write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js + rest)


def table_md():
    lines = ["| name | value | basis | margin (mm) | source |", "|---|---|---|---|---|"]
    for k, d in P.items():
        val = d.value if not isinstance(d.value, tuple) else " , ".join(str(x) for x in d.value)
        src = d.source + (f" ({d.note})" if d.note else "")
        lines.append(f"| {k} | {val} | {d.basis} | {d.margin:g} | {src.replace('|', '/')} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    info = build()
    print(f"belt path length {info['length']:.1f} mm (6PK1539), wraps {info['arcs']}")
    out = opt("--out")
    if out:
        export(out)
        print("wrote", out, Path(out).stat().st_size, "bytes")
    if opt("--table"):
        Path(opt("--table")).write_text(table_md())
    if opt("--check"):
        rows = anchor_check(info)
        Path(opt("--check")).write_text(json.dumps({"belt_mm": round(info["length"], 1), "belt_wraps_deg": info["arcs"],
                                                    "Y_BELL": Y_BELL, "Z_CRANK": Z_CRANK, "rows": rows}, indent=1))
        print("wrote", opt("--check"))
    if opt("--blend"):
        bpy.ops.wm.save_as_mainfile(filepath=opt("--blend"))
    if opt("--renders"):
        render(opt("--renders"))
