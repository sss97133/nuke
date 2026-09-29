"""Build the K5 twin's engine bay from real dimensions (v3).

Run headless against the v2 workspace; writes a NEW v3 file, never touches v2:

  /Applications/Blender.app/Contents/MacOS/Blender -b ~/k5-harness-pull/K5_harness_workspace_v2.blend \
      --python docs/wiring/twin/build_engine_v3.py -- --out ~/k5-harness-pull/K5_harness_workspace_v3.blend

Twin frame (measured from the TurboSquid body in v2, see inspect notes in TWIN_ENGINE_V3.md):
  +x = driver side (vehicle left; Steering_Wheel bbox x +0.263..+0.666)
  -y = front (Wheel_Front_Left y -2.31..-1.48), +y = rear
  +z = up, metres.

Engine-local frame: origin at the crank centreline on the bellhousing face; x as the twin, y negative
toward the front, z up. The whole engine hangs from one empty (K5H_Engine_v3_root) placed at
(0, Y_BELL, Z_CRANK) in the twin, so the engine position is one number pair.

Every dimension is in DIMS with its source and confidence. 'published' = a maker/GM document,
'derived' = arithmetic on published numbers, 'photo' = scaled from IMG_6531/6530/6532 against the
4.400 in bore spacing, 'estimate' = typical value, not measured on this truck.
"""
import bpy, bmesh, math, json, sys, os
from mathutils import Vector, Matrix, Euler

# ----------------------------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = None
Y_BELL = -1.33      # twin y of the bellhousing face (photo-matched; see TWIN_ENGINE_V3.md)
Z_CRANK = 0.76      # twin z of the crank centreline (photo-matched)
for i, a in enumerate(argv):
    if a == "--out": OUT = argv[i + 1]
    if a == "--ybell": Y_BELL = float(argv[i + 1])
    if a == "--zcrank": Z_CRANK = float(argv[i + 1])
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))

# ----------------------------------------------------------------------------------------------
# Dimension table (mm unless noted). value, source, confidence
# ----------------------------------------------------------------------------------------------
MARINE = "GM Powertrain 'LS3 6.2L V8 Marine Engine' 2009 spec sheet p3 (reference_documents/component_drawings/Marine_LS3_6.2L_Specs.pdf)"
HOLLEY_SP = "Holley instruction 199R10690 'GM LS Street Single-Plane Intake Manifold Kits' (300-131/136) DIMENSIONS section"
HOLLEY_MM = "Holley instruction 199R11485 'Complete Holley Mid-Mount Accessory Drive Kit' (20-180..20-205)"
LSDIY = "lsenginediy.com 'GM Gen III LS PCM/ECM: Crankshaft and Camshaft Signals Guide'"
HOLLEY_T43 = "Holley 199R12431 '6L80/6L90E Transmission Control 558-499' p.? 'Main Transmission Connector - Located on the passenger's rear side of the transmission'"
DELMO = "Delmo Speed 'Del-Stributer' product page + photos CRInstalled.jpg / CRInstalled2.jpg (delmospeed.com/products/del-stributer)"
PHOTO = "IMG_6531/6530/6532 (2026-01-31, vehicle_images) scaled against the 111.76 mm bore spacing"

DIMS = {
    "bore_spacing":     (111.76, MARINE + " 'Bore Center (mm): 111.76'", "published"),
    "bore":             (103.25, MARINE + " 'Bore x Stroke: 103.25 x 92 mm'", "published"),
    "stroke":           (92.0,   MARINE, "published"),
    "bank_angle_deg":   (90.0,   "GM LS family V8, 90 degree bank angle (GM published)", "published"),
    "deck_height":      (234.70, "GM LS Gen III/IV deck height 9.240 in (GM published block spec)", "published"),
    "cam_height":       (124.82, "GM LS cam-to-crank centreline 4.914 in (GM published block spec)", "published"),
    "envelope_length":  (710.0,  MARINE + " side view: damper face to bellhousing face 710 (27.95 in)", "published"),
    "envelope_height":  (716.0,  MARINE + " front view: oil pan to top of (marine) intake 716 (28.19 in)", "published"),
    "envelope_width":   (705.0,  MARINE + " front view 705 (27.75 in) with the marine accessory drive", "published"),
    "block_length":     (610.0,  "derived: envelope 710 minus an estimated 100 mm damper+front-cover protrusion", "derived"),
    "bank_stagger":     (24.0,   "GM V8: left (driver) bank forward of the right bank by one rod width, approx 0.94 in", "derived"),
    "rear_wall":        (140.0,  "estimate: bellhousing face to the rearmost right-bank bore centre", "estimate"),
    "pan_rail_z":       (-70.0,  "estimate: LS deep-skirt pan rail below the crank centreline", "estimate"),
    "block_skirt_halfwidth": (150.0, "estimate: LS crankcase half-width at the skirt", "estimate"),
    "bank_width":       (250.0,  "estimate: deck face width per bank", "estimate"),
    "head_length":      (520.0,  "estimate: LS3 head length (3 x 111.76 pitch + end walls)", "estimate"),
    "head_width":       (220.0,  "estimate: LS3 head width across the deck face", "estimate"),
    "head_thickness":   (120.0,  "estimate: deck face to rocker-cover rail", "estimate"),
    "valve_cover_len":  (480.0,  PHOTO + ": fabricated 'Chevrolet' script covers, no coil brackets", "photo"),
    "valve_cover_w":    (130.0,  "estimate", "estimate"),
    "valve_cover_h":    (70.0,   PHOTO, "photo"),
    "valley_flange_z":  (225.0,  "derived: LS deck inner edges at ~244 mm above the crank (9.240 in deck at 45 deg), valley cover flange ~20 mm lower", "derived"),
    "intake_pad_above_valley": (137.7, HOLLEY_SP + " 'A & B - 5.42 in (0 deg carb flange angle)'; heights measure to the lifter valley cover flange", "published"),
    "intake_port_h":    (63.5,   HOLLEY_SP + " port 2.50 in high x 1.15 in wide", "published"),
    "intake_port_w":    (29.2,   HOLLEY_SP, "published"),
    "carb_flange":      (4150,   HOLLEY_SP + " 'Carburetor Flange - Standard 4150', bolt pattern 5.16 x 5.625 in", "published"),
    "tb_bore":          (92.0,   "vehicle_build_manifest 'Electronic Throttle Body GM/Hitachi 12699160, L8T 6.6L truck, ~92 mm bore' (purchased)", "published"),
    "tb_body_od":       (125.0,  PHOTO + ": TB body vs the 4150 pad", "photo"),
    "tb_height":        (127.0,  PHOTO + " + photo_match.py fit (+42 mm over the first estimate)", "photo"),
    "tb_adapter_h":     (25.0,   PHOTO + ": 4-bolt adapter plate (Delmo Speed order 70079)", "photo"),
    "rail_od":          (22.0,   PHOTO + ": Holley EFI black rails", "photo"),
    "rail_offset_r":    (-40.0,  "photo_match.py bounded fit: rails 40 mm closer to the ports than the first estimate (at the fit bound)", "photo"),
    "rail_offset_s":    (-5.0,   "photo_match.py bounded fit", "photo"),
    "rail_len":         (520.0,  PHOTO, "photo"),
    "injector_len":     (60.0,   "estimate: EV6-style injector body", "estimate"),
    "coil_body":        (90.0,   "estimate: ACDelco D510C body height (manifest: 8x D510C 12611424, invoice_proven)", "estimate"),
    "coil_w":           (65.0,   "estimate", "estimate"),
    "coil_d":           (55.0,   "estimate", "estimate"),
    "delstrib_plate":   (260.0,  DELMO + ": billet plate spanning the rear of the engine, coils in a 2x4 vertical cluster behind the intake, above the bellhousing", "photo"),
    "damper_od":        (190.0,  PHOTO + " (Holley SFI damper per " + HOLLEY_MM + ")", "photo"),
    "damper_t":         (45.0,   "estimate", "estimate"),
    "belt_plane_y":     (-735.0, "derived: damper face 710 from the bell face (marine) + 25 mm for the Holley pulley stack", "derived"),
    "midmount_depth":   (78.0,   PHOTO + ": water-pump manifold depth ahead of the block face", "photo"),
    "midmount_halfwidth_d": (250.0, PHOTO, "photo"),
    "midmount_halfwidth_p": (210.0, PHOTO, "photo"),
    "alt_od":           (145.0,  PHOTO + ": Holley 197-302 150 A 'LT1 style hairpin' alternator (" + HOLLEY_MM + ")", "photo"),
    "alt_len":          (150.0,  "estimate", "estimate"),
    "alt_center":       ((227.0, 280.0), PHOTO + ": alternator HIGH on the DRIVER side (IMG_6531 image-right, IMG_6532 near side); x,z from photo_match.py (bounded fit, z at its 280 bound)", "photo"),
    "ps_center":        ((-240.0, 40.0), PHOTO + ": Type II PS pump LOW on the PASSENGER side", "photo"),
    "tensioner_center": ((-160.0, 190.0), PHOTO + ": tensioner passenger side, mid height", "photo"),
    "ac_center":        ((250.0, -60.0), "planned: Holley mid-mount A/C bracket in a box (state §1 2026-09-24); Holley layout puts the SD7 low on the alternator side (" + HOLLEY_MM + " p1 render)", "estimate"),
    "starter_center":   ((-215.0, -95.0), "GM LS: starter on the right (passenger) side of the block at the rear; CKP 'mounted in the block above the starter' (" + LSDIY + "). Manifest: Delmo/GM DFSR-8715 mini starter", "published-side"),
    "starter_len":      (190.0,  "estimate: mini starter", "estimate"),
    "starter_od":       (80.0,   "estimate", "estimate"),
    "header_primary_od":(45.0,   PHOTO + ": 1 3/4 in primaries", "photo"),
    "header_collector_od": (76.0, "estimate: 3 in collector", "estimate"),
    "oil_pan_depth":    (155.0,  "estimate: retrofit LS pan, sump 155 mm below the pan rail (pan model not in the manifest)", "estimate"),
    "bell_od":          (440.0,  "estimate: LS/SBC bell pattern envelope", "estimate"),
    "trans_case_od":    (250.0,  "estimate: 6L90 main case", "estimate"),
    "trans_len":        (900.0,  "estimate: 6L90 bell face to tailhousing", "estimate"),
}

def D(k):
    v = DIMS[k][0]
    return v

MM = 0.001

# ----------------------------------------------------------------------------------------------
# Scene helpers
# ----------------------------------------------------------------------------------------------
def get_or_make_coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c

def make_mat(name, rgb, metallic=0.0, rough=0.5):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1.0)
    return m

MAT = {
    "alu":      make_mat("K5H3_cast_alu", (0.62, 0.62, 0.60), 0.6, 0.55),
    "alu_raw":  make_mat("K5H3_alu_raw", (0.70, 0.70, 0.68), 0.7, 0.45),
    "polished": make_mat("K5H3_polished", (0.85, 0.85, 0.87), 1.0, 0.15),
    "black":    make_mat("K5H3_black", (0.05, 0.05, 0.05), 0.2, 0.45),
    "black_gloss": make_mat("K5H3_black_gloss", (0.03, 0.03, 0.03), 0.4, 0.25),
    "steel":    make_mat("K5H3_steel", (0.55, 0.56, 0.58), 0.9, 0.35),
    "stainless":make_mat("K5H3_stainless", (0.75, 0.75, 0.74), 1.0, 0.3),
    "grey":     make_mat("K5H3_grey", (0.35, 0.35, 0.35), 0.3, 0.6),
    "anchor":   make_mat("K5H3_anchor", (1.0, 0.25, 0.05), 0.0, 0.5),
    "anchor_unk": make_mat("K5H3_anchor_unknown", (1.0, 0.85, 0.1), 0.0, 0.5),
    "rubber":   make_mat("K5H3_rubber", (0.08, 0.08, 0.08), 0.0, 0.8),
}

ROOT = None
def link(o, coll):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    o.parent = ROOT
    return o

def add_box(name, size_mm, loc_mm, rot=(0, 0, 0), mat="alu", coll=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = (size_mm[0] * MM, size_mm[1] * MM, size_mm[2] * MM)
    o.rotation_euler = rot
    o.location = (loc_mm[0] * MM, loc_mm[1] * MM, loc_mm[2] * MM)
    o.data.materials.append(MAT[mat])
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL"); b.width = bevel * MM; b.segments = 2
    return link(o, coll)

def add_cyl(name, d_mm, len_mm, loc_mm, axis="y", mat="alu", coll=None, verts=32, rot_extra=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=d_mm * MM / 2, depth=len_mm * MM, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    if axis == "y": o.rotation_euler = (math.radians(90), 0, 0)
    elif axis == "x": o.rotation_euler = (0, math.radians(90), 0)
    elif axis == "z": o.rotation_euler = (0, 0, 0)
    if rot_extra is not None: o.rotation_euler = rot_extra
    o.location = (loc_mm[0] * MM, loc_mm[1] * MM, loc_mm[2] * MM)
    o.data.materials.append(MAT[mat])
    return link(o, coll)

def add_tube(name, p0_mm, p1_mm, d_mm, mat="alu", coll=None, verts=20):
    p0 = Vector(p0_mm) * MM; p1 = Vector(p1_mm) * MM
    v = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=d_mm * MM / 2, depth=v.length, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = v.to_track_quat("Z", "Y").to_euler()
    o.location = (p0 + p1) / 2
    o.data.materials.append(MAT[mat])
    return link(o, coll)

def add_bezier_tube(name, pts_mm, d_mm, mat="stainless", coll=None):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"; cu.bevel_depth = d_mm * MM / 2; cu.bevel_resolution = 4; cu.resolution_u = 12
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(len(pts_mm) - 1)
    for bp, p in zip(sp.bezier_points, pts_mm):
        bp.co = Vector(p) * MM; bp.handle_left_type = bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, cu)
    o.data.materials.append(MAT[mat])
    return link(o, coll)

def add_cone(name, d0_mm, d1_mm, len_mm, loc_mm, axis="y", mat="alu", coll=None):
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=d0_mm * MM / 2, radius2=d1_mm * MM / 2, depth=len_mm * MM, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    if axis == "y": o.rotation_euler = (math.radians(-90), 0, 0)   # cone base (radius1) at -y? we place explicitly below
    o.location = (loc_mm[0] * MM, loc_mm[1] * MM, loc_mm[2] * MM)
    o.data.materials.append(MAT[mat])
    return link(o, coll)

def add_anchor(name, loc_mm, dave, source, method, confidence, coll, unknown=False):
    """A small sphere + an empty at a plug/sensor location, with provenance as custom properties."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=9 * MM, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = "ANCHOR_" + name
    o.location = (loc_mm[0] * MM, loc_mm[1] * MM, loc_mm[2] * MM)
    o.data.materials.append(MAT["anchor_unk" if unknown else "anchor"])
    o["dave_name"] = dave; o["source"] = source; o["method"] = method; o["confidence"] = confidence
    o["engine_local_mm"] = [float(v) for v in loc_mm]
    link(o, coll)
    ANCHORS.append(o)
    return o

# bank-frame -> engine-local (mm). side +1 = driver/left bank (+x), -1 = passenger/right bank.
def bank_xz(side, r, s):
    return (side * (r - s) * 0.70710678, (r + s) * 0.70710678)

ANCHORS = []

# ----------------------------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------------------------
def build():
    global ROOT
    sc = bpy.context.scene
    root_coll = get_or_make_coll("K5H_Engine_v3")
    C = {n: get_or_make_coll("K5H_E3_" + n, root_coll) for n in
         ["Longblock", "Induction", "Ignition", "AccessoryDrive", "Exhaust", "Driveline", "Anchors"]}

    # root empty: the engine position in the twin
    ROOT = None
    bpy.ops.object.empty_add(type="ARROWS", location=(0, Y_BELL, Z_CRANK))
    root = bpy.context.active_object; root.name = "K5H_Engine_v3_root"; root.empty_display_size = 0.2
    for c in list(root.users_collection): c.objects.unlink(root)
    root_coll.objects.link(root)
    root["Y_BELL"] = Y_BELL; root["Z_CRANK"] = Z_CRANK
    root["frame"] = "+x driver, -y front, +z up; origin = crank centreline at the bellhousing face"
    ROOT = root

    BS = D("bore_spacing"); DH = D("deck_height"); L = D("block_length"); RW = D("rear_wall"); STAG = D("bank_stagger")
    # cylinder stations (engine-local y, negative = forward). Right bank 2,4,6,8; left bank 1,3,5,7 (left forward by STAG)
    y_right = {8: -RW, 6: -RW - BS, 4: -RW - 2 * BS, 2: -RW - 3 * BS}
    y_left = {7: -RW - STAG, 5: -RW - STAG - BS, 3: -RW - STAG - 2 * BS, 1: -RW - STAG - 3 * BS}
    y_cyl = {**y_right, **y_left}
    y_bank_c = {+1: (y_left[1] + y_left[7]) / 2, -1: (y_right[2] + y_right[8]) / 2}
    y_block_c = -L / 2
    y_front = -L                     # block front face
    y_cover_front = y_front - 12     # front cover face

    # ---- long block --------------------------------------------------------------------------
    hw = D("block_skirt_halfwidth")
    add_box("E3_Block_Crankcase", (2 * hw, L, 170), (0, y_block_c, D("pan_rail_z") + 85), mat="alu", coll=C["Longblock"], bevel=8)
    for side, nm in ((+1, "L"), (-1, "R")):
        yc = y_bank_c[side]
        # bank: from ~60 mm above the crank (radial) to the deck at DH
        r_c = (60 + DH) / 2; t = DH - 60
        x, z = bank_xz(side, r_c, 0)
        add_box(f"E3_Block_Bank_{nm}", (D("bank_width"), L - 30, t), (x, yc, z), rot=(0, side * math.radians(45), 0), mat="alu", coll=C["Longblock"], bevel=6)
        # head
        r_h = DH + D("head_thickness") / 2
        x, z = bank_xz(side, r_h, 0)
        add_box(f"E3_Head_{nm}", (D("head_width"), D("head_length"), D("head_thickness")), (x, yc, z), rot=(0, side * math.radians(45), 0), mat="alu_raw", coll=C["Longblock"], bevel=5)
        # valve cover (black, 'Chevrolet' script, no coils)
        r_v = DH + D("head_thickness") + D("valve_cover_h") / 2
        x, z = bank_xz(side, r_v, 8)
        add_box(f"E3_ValveCover_{nm}", (D("valve_cover_w"), D("valve_cover_len"), D("valve_cover_h")), (x, yc, z), rot=(0, side * math.radians(45), 0), mat="black_gloss", coll=C["Longblock"], bevel=10)
    # valley cover
    add_box("E3_ValleyCover", (250, 380, 8), (0, -RW - 1.5 * BS - 10, D("valley_flange_z") + 4), mat="alu", coll=C["Longblock"])
    # front cover + cam sensor boss face
    add_box("E3_FrontCover", (320, 12, 380), (0, y_cover_front + 6, 110), mat="alu", coll=C["Longblock"])
    # oil pan (rear sump, retrofit)
    prz = D("pan_rail_z")
    add_box("E3_OilPan_Shallow", (300, L - 60, 60), (0, y_block_c - 10, prz - 30), mat="alu", coll=C["Longblock"], bevel=6)
    add_box("E3_OilPan_Sump", (280, 260, D("oil_pan_depth") - 60), (0, -RW - 60, prz - 60 - (D("oil_pan_depth") - 60) / 2), mat="alu", coll=C["Longblock"], bevel=10)
    # rear cover / bell flange plate + flexplate
    add_box("E3_RearCover", (330, 10, 380), (0, -5, 110), mat="alu", coll=C["Longblock"])

    # ---- induction ---------------------------------------------------------------------------
    vz = D("valley_flange_z")
    pad_z = vz + D("intake_pad_above_valley")          # carb pad top, above the crank
    y_int_c = (y_bank_c[+1] + y_bank_c[-1]) / 2
    add_box("E3_Intake_Plenum", (240, 250, 55), (0, y_int_c, pad_z - 15 - 27.5), mat="alu", coll=C["Induction"], bevel=10)
    add_box("E3_Intake_CarbPad", (185, 185, 15), (0, y_int_c, pad_z - 7.5), mat="alu", coll=C["Induction"])
    add_box("E3_Intake_ValleyPan", (300, 400, 10), (0, y_int_c, vz + 20), mat="alu", coll=C["Induction"])
    # runners: plenum floor -> port faces (inner side of each head at port height)
    port_r = DH + 70; port_s = D("head_width") / 2
    for cyl, y in y_cyl.items():
        side = +1 if cyl % 2 == 1 else -1
        x, z = bank_xz(side, port_r, port_s)
        p1 = (x, y, z)
        p0 = (side * 45, y_int_c + (y - y_int_c) * 0.35, pad_z - 70)
        add_tube(f"E3_Intake_Runner_{cyl}", p0, p1, 46, mat="alu", coll=C["Induction"])
        # port flange pad
        add_box(f"E3_Intake_PortFlange_{cyl}", (14, 60, 90), (x, y, z), rot=(0, side * math.radians(45), 0), mat="alu", coll=C["Induction"])
        # injector: boss on the runner near the flange, body angled up-outward to the rail
        ix, iz = bank_xz(side, port_r + 55, port_s + 25)
        rail_x, rail_z = bank_xz(side, port_r + 105 + D("rail_offset_r"), port_s + 40 + D("rail_offset_s"))
        add_tube(f"E3_Injector_{cyl}", (ix, y, iz), (rail_x, y, rail_z), 16, mat="black", coll=C["Induction"])
        add_anchor(f"inj_{cyl}", (rail_x, y, rail_z - 8), f"inj {cyl}", "injector on the Holley EFI rail at cylinder %d (rails+injectors visible IMG_6530/6531)" % cyl,
                   "photo: rail/injector layout; station = cylinder station from the 111.76 mm bore spacing", "medium", C["Anchors"])
    for side, nm in ((+1, "L"), (-1, "R")):
        rail_x, rail_z = bank_xz(side, port_r + 105 + D("rail_offset_r"), port_s + 40 + D("rail_offset_s"))
        add_cyl(f"E3_FuelRail_{nm}", D("rail_od"), D("rail_len"), (rail_x, y_bank_c[side], rail_z), axis="y", mat="black", coll=C["Induction"])
    # 4150 -> 4-bolt adapter, DBW throttle body (vertical bore), blade, motor housing
    add_box("E3_TB_Adapter", (165, 165, D("tb_adapter_h")), (0, y_int_c, pad_z + D("tb_adapter_h") / 2), mat="polished", coll=C["Induction"], bevel=6)
    tb_z0 = pad_z + D("tb_adapter_h")
    add_cyl("E3_ThrottleBody_12699160", D("tb_body_od"), D("tb_height"), (0, y_int_c, tb_z0 + D("tb_height") / 2), axis="z", mat="polished", coll=C["Induction"], verts=48)
    add_cyl("E3_TB_Bore", D("tb_bore"), D("tb_height") + 2, (0, y_int_c, tb_z0 + D("tb_height") / 2), axis="z", mat="grey", coll=C["Induction"], verts=48)
    add_box("E3_TB_Blade", (D("tb_bore") - 2, 4, 1.5), (0, y_int_c, tb_z0 + D("tb_height") * 0.55), mat="steel", coll=C["Induction"])
    add_box("E3_TB_MotorHousing", (60, 90, 55), (-80, y_int_c + 20, tb_z0 + 40), mat="polished", coll=C["Induction"], bevel=6)
    add_anchor("tps", (-112, y_int_c + 20, tb_z0 + 40), "TPS", "DBW throttle body GM 12699160 (manifest: purchased; 6-pin Hitachi connector) on the 4-bolt adapter at the 4150 pad (IMG_6531)",
               "photo: TB position; connector side on the body = estimate", "medium", C["Anchors"])
    # MAP: the Holley intake carries a 3/8 NPT vacuum port; where the MAP sensor mounts on this truck is not recorded
    add_anchor("map", (0, y_int_c + 150, pad_z - 20), "MAP", "Holley 199R10690: 'Vacuum Port Size and Thread - 3/8 NPT' on the manifold; MAP sensor mounting spot on this truck NOT recorded",
               "unknown: placed at the plenum rear as a placeholder", "unknown", C["Anchors"], unknown=True)
    add_anchor("iat", (0, y_int_c, tb_z0 + D("tb_height") + 60), "IAT", "manifest: ACDelco 25036751 IAT; air-filter/inlet tract not built yet",
               "unknown: placeholder above the TB", "unknown", C["Anchors"], unknown=True)
    # fuel pressure regulator seen at the FRONT centre of the intake, above the water-pump manifold (IMG_6531 crop): Aeromotive A1000-style
    add_box("E3_FuelPressReg_asbuilt", (60, 60, 70), (0, y_front + 40, vz + 70), mat="black", coll=C["Induction"], bevel=6)

    # ---- ignition: Del-Stributer plate + 8 coils at the rear centre ----------------------------
    plate_y = -RW + 30
    add_box("E3_DelStributer_Plate", (D("delstrib_plate"), 120, 18), (0, plate_y, vz + 24), mat="polished", coll=C["Ignition"], bevel=4)
    n = 0
    for row, y in enumerate((plate_y - 32, plate_y + 32)):
        for col, x in enumerate((-97.5, -32.5, 32.5, 97.5)):
            n += 1
            zc = vz + 33 + D("coil_body") / 2
            add_box(f"E3_Coil_{n}", (D("coil_w") - 6, D("coil_d") - 4, D("coil_body")), (x, y, zc), mat="black", coll=C["Ignition"], bevel=4)
            add_cyl(f"E3_Coil_{n}_Tower", 24, 26, (x, y, zc + D("coil_body") / 2 + 13), axis="z", mat="black", coll=C["Ignition"], verts=16)
            add_anchor(f"coil_{n}", (x, y + (14 if row else -14), zc), f"coil {n}",
                       "Del-Stributer central coil mount (state §1 locked 'DEL-Stributor, central mount, 8x D510C'); cluster location per " + DELMO + " (rear centre, behind the intake, above the bellhousing)",
                       "photo (Delmo product photos): rear-centre cluster; cylinder-to-coil assignment on the bracket UNKNOWN (numbered by position: front row 1-4 driver->passenger, rear row 5-8)",
                       "medium-low", C["Anchors"])

    # ---- accessory drive: Holley mid-mount --------------------------------------------------
    bp = D("belt_plane_y")
    md = D("midmount_depth")
    add_box("E3_MidMount_WaterPumpManifold", (D("midmount_halfwidth_d") + D("midmount_halfwidth_p"), md, 300),
            ((D("midmount_halfwidth_d") - D("midmount_halfwidth_p")) / 2, y_cover_front - md / 2, 95), mat="alu", coll=C["AccessoryDrive"], bevel=12)
    add_cyl("E3_WaterPump_Snout", 110, 30, (0, y_cover_front - md - 15, 150), axis="y", mat="alu", coll=C["AccessoryDrive"])
    add_cyl("E3_WaterPump_Pulley", 165, 18, (0, bp + 9, 150), axis="y", mat="black", coll=C["AccessoryDrive"], verts=48)
    add_cyl("E3_Damper", D("damper_od"), D("damper_t"), (0, bp + D("damper_t") / 2, 0), axis="y", mat="black", coll=C["AccessoryDrive"], verts=48)
    add_cyl("E3_CrankPulley", 160, 22, (0, bp - 11, 0), axis="y", mat="black", coll=C["AccessoryDrive"], verts=48)
    add_cyl("E3_Damper_Hub", 60, 100, (0, y_cover_front - 50, 0), axis="y", mat="steel", coll=C["AccessoryDrive"])
    ax, az = D("alt_center")
    add_cyl("E3_Alternator_197-302", D("alt_od"), D("alt_len"), (ax, bp + D("alt_len") / 2 + 8, az), axis="y", mat="alu", coll=C["AccessoryDrive"], verts=40)
    add_cyl("E3_Alternator_Pulley", 62, 20, (ax, bp - 2, az), axis="y", mat="black", coll=C["AccessoryDrive"])
    add_cyl("E3_Alternator_Fan", 130, 6, (ax, bp + 6, az), axis="y", mat="black", coll=C["AccessoryDrive"])
    add_anchor("alternator", (ax + D("alt_od") / 2 - 20, bp + D("alt_len") - 20, az + 20), "alternator plug",
               "Holley 197-302 150 A alternator on the mid-mount, DRIVER side high (IMG_6531/6532); wiring per the alternator's own sheet (" + HOLLEY_MM + ")",
               "photo: side + height; plug on the rear face = estimate", "medium", C["Anchors"])
    px, pz = D("ps_center")
    add_cyl("E3_PS_Pump", 125, 130, (px, bp + 65 + 8, pz), axis="y", mat="alu", coll=C["AccessoryDrive"], verts=32)
    add_cyl("E3_PS_Pulley", 150, 20, (px, bp - 2, pz), axis="y", mat="black", coll=C["AccessoryDrive"], verts=40)
    add_cyl("E3_PS_Reservoir", 70, 110, (px - 20, bp + 90, pz + 110), axis="z", mat="alu", coll=C["AccessoryDrive"])
    tx, tz = D("tensioner_center")
    add_cyl("E3_Tensioner_Pulley", 76, 22, (tx, bp - 2, tz), axis="y", mat="black", coll=C["AccessoryDrive"])
    add_box("E3_Tensioner_Body", (60, 50, 80), (tx - 10, bp + 30, tz - 20), mat="alu", coll=C["AccessoryDrive"], bevel=8)
    add_cyl("E3_Idler_Lower", 76, 22, (120, bp - 2, -40), axis="y", mat="black", coll=C["AccessoryDrive"])
    # A/C compressor (planned): Sanden SD7 on the Holley mid-mount A/C bracket, alternator side low
    cx, cz = D("ac_center")
    ac = add_cyl("E3_AC_Compressor_SD7_planned", 120, 200, (cx, bp + 100 + 8, cz), axis="y", mat="grey", coll=C["AccessoryDrive"], verts=32)
    ac["status"] = "planned - bracket in a box (state §1 2026-09-24); not in the 2026-01-31 photos"
    add_cyl("E3_AC_Clutch_planned", 120, 20, (cx, bp - 2, cz), axis="y", mat="black", coll=C["AccessoryDrive"], verts=40)
    add_anchor("ac_clutch", (cx, bp - 12, cz + 60), "A/C clutch", "Sanden SD7 (eBay order 2026-09-24, state §1) on the Holley mid-mount A/C bracket; position from the Holley kit layout, not installed yet",
               "estimate: alternator-side low per " + HOLLEY_MM + " p1 render; NOT on the truck yet", "low", C["Anchors"])
    # belt (visual only): flat ribbon around the pulleys
    add_bezier_tube("E3_Belt", [(0, bp, -82), (px, bp, pz - 77), (px - 70, bp, pz + 20), (tx, bp, tz + 40), (0, bp, 235), (ax - 20, bp, az + 34), (ax + 33, bp, az - 5), (120, bp, -80), (0, bp, -82)], 8, mat="rubber", coll=C["AccessoryDrive"])

    # ---- starter (passenger rear low) ---------------------------------------------------------
    sx, sz = D("starter_center")
    add_cyl("E3_Starter_DFSR-8715", D("starter_od"), D("starter_len"), (sx, -20 - D("starter_len") / 2, sz), axis="y", mat="black", coll=C["Driveline"], verts=24)
    add_cyl("E3_Starter_Solenoid", 45, 120, (sx - 5, -20 - 80, sz + 55), axis="y", mat="black", coll=C["Driveline"], verts=20)
    add_anchor("starter", (sx - 5, -20 - 20, sz + 55), "starter", "GM LS starter on the right (passenger) side of the block at the rear (" + LSDIY + ": CKP 'in the block above the starter'); manifest DFSR-8715 mini starter, purchased",
               "published side; solenoid terminal position = estimate", "medium", C["Anchors"])

    # ---- sensors on the long block --------------------------------------------------------------
    add_anchor("crank", (-hw - 12, -95, 35), "crank", "Gen IV 58x crank sensor (GM 12615626): 'mounted in the block above the starter' (" + LSDIY + ") = right rear of the block. CORRECTS state §4 'CKP AND CMP on front cover'",
               "published (right rear, above the starter); exact boss station = estimate +/-40 mm", "medium", C["Anchors"])
    add_anchor("cam", (45, y_cover_front - 8, D("cam_height") + 40), "cam", "Gen IV cam sensor (GM 12591720) in the FRONT TIMING COVER: 'All Gen IV 24x and 58x engines have a camshaft position sensor in the front timing cover' (" + LSDIY + ")",
               "published (front cover); clock position on the cover = estimate", "medium", C["Anchors"])
    for side, nm, dv in ((+1, "L", "knock L"), (-1, "R", "knock R")):
        add_anchor(f"knock_{nm}", (side * (hw + 8), y_block_c, 45), dv, "manifest: ACDelco 213-1576 / GM 12623730 x2 (Gen IV flat-response knock sensors mount on the block sides)",
                   "side known (Gen IV exterior block bosses); station along the block = estimate", "low", C["Anchors"])
    x, z = bank_xz(+1, DH + 45, -port_s)
    add_anchor("coolant_temp", (x + 10, y_left[1] + 30, z), "coolant temp", "GM LS ECT in the LEFT (driver) cylinder head, front, below the exhaust ports; citation to add (GM service manual)",
               "estimate: side + station typical for LS3; not verified on this truck", "low", C["Anchors"])
    add_anchor("oil_psi", (25, -RW + 60, vz + 45), "oil PSI", "GM LS oil pressure sender at the rear top of the block behind the intake (valley rear); citation to add (GM service manual)",
               "estimate: typical LS location; the Del-Stributer plate now occupies that area - clearance to check", "low", C["Anchors"])

    # ---- exhaust: mid-length headers, collectors with O2 bungs -----------------------------------
    for side, nm, cyls in ((+1, "L", (1, 3, 5, 7)), (-1, "R", (2, 4, 6, 8))):
        col_x = side * 335
        col_y0 = -RW + 20; col_y1 = -RW - 150
        for cyl in cyls:
            y = y_cyl[cyl]
            ex, ez = bank_xz(side, DH + 55, -port_s)
            pts = [(ex, y, ez), (ex + side * 60, y + 10, ez - 20), (col_x, y * 0.35 + col_y1 * 0.65, -120), (col_x, col_y1 - 20, -175)]
            add_bezier_tube(f"E3_Header_{nm}_{cyl}", pts, D("header_primary_od"), mat="stainless", coll=C["Exhaust"])
            add_box(f"E3_ExhFlange_{nm}_{cyl}", (12, 70, 80), (ex, y, ez), rot=(0, side * math.radians(45), 0), mat="stainless", coll=C["Exhaust"])
        add_cyl(f"E3_Collector_{nm}", D("header_collector_od"), 220, (col_x, col_y1 - 20 + 110, -180), axis="y", mat="stainless", coll=C["Exhaust"], verts=24)
        # tail pipe past the collector so the bung can sit >= 1 m of pipe from the ports (MoTeC LTCD manual recommendation)
        add_cyl(f"E3_Exhaust_Tail_{nm}", 70, 420, (col_x, col_y1 - 20 + 220 + 210, -180), axis="y", mat="stainless", coll=C["Exhaust"], verts=24)
        by = col_y1 - 20 + 220 + 180          # ~1.05 m of pipe from the ports (primaries ~0.6 m + collector 0.22 + 0.2)
        bung = add_tube(f"E3_O2_Bung_{nm}", (col_x, by, -150), (col_x + side * 34, by, -122), 22, mat="steel", coll=C["Exhaust"])
        bung["status"] = "candidate position, not a fact"
        add_anchor(f"o2_{nm}", (col_x + side * 40, by, -117), f"O2 {nm}",
                   "CANDIDATE: Bosch LSU 4.9 (manifest x2, 'pre-cat') in the pipe after the collector. MoTeC LTCD user manual, Lambda Sensor Installation: 'Place the sensor on an angle between 10 and 90 degrees to the vertical with the tip of the sensor pointing down'; 'Do not place the sensor in a vertical position'; 'Place the sensor at least 1 metre from the exhaust ports to avoid excessive heat (recommended)'; sensor max continuous 850 degC. Bung not photographed.",
                   "candidate: ~1.05 m of pipe from the ports, 45 deg tip-down on the upper side of the pipe; collector location from IMG_6530/6532", "candidate", C["Anchors"], unknown=True)

    # ---- driveline: 6L90 bell + case --------------------------------------------------------
    bell = add_cone("E3_6L90_Bell", D("bell_od"), D("trans_case_od"), 330, (0, 165, 0), axis="y", mat="alu", coll=C["Driveline"])
    bell.rotation_euler = (math.radians(90), 0, 0)   # cone radius1 (big) at -y end = bell face
    add_cyl("E3_6L90_Case", D("trans_case_od"), D("trans_len") - 330, (0, 330 + (D("trans_len") - 330) / 2, -10), axis="y", mat="alu", coll=C["Driveline"], verts=40)
    add_box("E3_6L90_Pan", (240, 420, 60), (0, 470, -10 - D("trans_case_od") / 2 - 20), mat="alu", coll=C["Driveline"], bevel=8)
    add_anchor("trans_6L90", (-D("trans_case_od") / 2 - 10, 700, 30), "6L90 case", HOLLEY_T43,
               "published side (passenger, rear of the transmission); exact station along the case = estimate", "medium", C["Anchors"])

    # ---- LTCD candidate positions (twin frame, not engine-relative) ----------------------------
    # MoTeC LTCD user manual: 'The LTC should be mounted as far as possible from the exhaust'; 'LTC maximum ambient temperature
    # is 100 degC'; mounting holes 32 mm apart (dia 3.2 mm); max internal device temperature 125 degC. Sensor lead length: not stated
    # in the manual text (unknown). Both candidates are within ~0.5 m of both bungs.
    saved_root = ROOT; ROOT = None
    for nm, loc, why in (("ltcd_candidate_A", (0.0, -1.44, 0.86), "engine-side firewall, low centre above the tunnel: reaches both collectors symmetrically, away from the headers"),
                         ("ltcd_candidate_B", (-0.40, -1.38, 0.62), "passenger frame rail inner face by the bellhousing: shortest leads, but closer to the passenger collector heat")):
        o = add_box("E3_" + nm, (60, 25, 45), tuple(v * 1000 for v in loc), mat="grey", coll=C["Anchors"], bevel=4)
        o["status"] = "candidate position, not a fact"
        a = add_anchor(nm, tuple(v * 1000 for v in loc), "LTCD (" + nm[-1] + ")",
                       "CANDIDATE MoTeC LTCD box: " + why + ". LTCD user manual: mount as far as possible from the exhaust; max ambient 100 degC, max internal 125 degC; holes 32 mm apart. Sensor lead length not found in the manual text = unknown.",
                       "candidate, chosen by reach to both bungs and heat; owner/Dave decide", "candidate", C["Anchors"], unknown=True)
    ROOT = saved_root

    # ---- battery: mirror to the owner's working position (passenger firewall corner) -----------
    # twin_centers.json / v2 had K5H_Battery at x=+0.65 (driver). Axis check: +x = driver (Steering_Wheel x +0.26..+0.67).
    bat = bpy.data.objects.get("K5H_Battery")
    if bat:
        if abs(bat.location.x) < 1e-6:   # v2 built it with world-space verts (bbox x 0.565..0.735): mirror the mesh
            for v in bat.data.vertices: v.co.x = -v.co.x
        else:
            bat.location.x = -bat.location.x
        bat["side_change"] = "mirrored to the passenger side 2026-09-29 (owner working position, state s4); v2 had it on the driver side"

    # retire the v2 atom-built engine (keep everything else). Moved, not deleted.
    retired = get_or_make_coll("K5H_v2_retired_engine")
    old = ["K5H_LS3_Block", "K5H_Head_D", "K5H_Head_P", "K5H_ValveCover_D", "K5H_ValveCover_P", "K5H_Holley_Intake_300-131",
           "K5H_ThrottleBody_12605109", "K5H_DEL_Bracket", "K5H_FuelRail_D", "K5H_FuelRail_P", "K5H_Damper", "K5H_MidMount_Accessories",
           "K5H_Alternator", "K5H_AC_Compressor", "K5H_Starter", "K5H_Exhaust_D", "K5H_Exhaust_P", "K5H_Manifold_D", "K5H_Manifold_P",
           "K5H_O2_D", "K5H_O2_P", "K5H_OilPan", "K5H_6L80E", "K5H_CKP", "K5H_CMP", "K5H_CLT", "K5H_IAT", "K5H_KS1", "K5H_KS2", "K5H_MAP",
           "K5H_OilPress", "K5H_OilTemp", "K5H_FuelPress", "K5H_EWaterPump"] + [f"K5H_Coil_{i}" for i in range(1, 9)] + [f"K5H_Injector_{i}" for i in range(1, 9)]
    moved = []
    for n in old:
        o = bpy.data.objects.get(n)
        if o:
            for c in list(o.users_collection): c.objects.unlink(o)
            retired.objects.link(o); o.hide_render = True; o.hide_viewport = True; moved.append(n)
    # exclude the retired collection from the view layer
    def find_layer(lc, name):
        if lc.collection.name == name: return lc
        for ch in lc.children:
            r = find_layer(ch, name)
            if r: return r
    lc = find_layer(bpy.context.view_layer.layer_collection, retired.name)
    if lc: lc.exclude = True
    # the TurboSquid placeholder engine stays hidden
    ues = bpy.data.objects.get("Under_Engine_Simple")
    if ues: ues.hide_render = True; ues.hide_viewport = True

    # ---- write the anchors + dimension table -----------------------------------------------------
    bpy.context.view_layer.update()
    anchors = {}
    for a in ANCHORS:
        w = a.matrix_world.translation
        anchors[a.name.replace("ANCHOR_", "")] = {
            "xyz_m": [round(w.x, 4), round(w.y, 4), round(w.z, 4)],
            "engine_local_mm": [round(v, 1) for v in a["engine_local_mm"]],
            "dave_name": a["dave_name"], "source": a["source"], "method": a["method"], "confidence": a["confidence"],
        }
    out = {
        "_frame": "twin metres: +x driver, -y front, +z up (measured from the TurboSquid body: Steering_Wheel at x +0.26..+0.67)",
        "_engine_root": {"Y_BELL": Y_BELL, "Z_CRANK": Z_CRANK, "method": "photo-matched against IMG_6531 (see TWIN_ENGINE_V3.md)"},
        "_generated_by": "docs/wiring/twin/build_engine_v3.py",
        "anchors": anchors,
    }
    p = os.path.join(REPO, "docs", "wiring", "calc-data", "twin_engine_anchors.json")
    with open(p, "w") as f: json.dump(out, f, indent=1)
    p2 = os.path.join(REPO, "docs", "wiring", "twin", "dimensions_v3.json")
    with open(p2, "w") as f:
        json.dump({k: {"value": v[0], "unit": "mm" if not isinstance(v[0], tuple) else "mm (x,z)", "source": v[1], "confidence": v[2]} for k, v in DIMS.items()}, f, indent=1)
    print("V3 BUILT: anchors", len(anchors), "retired", len(moved), "->", p, p2)

build()
if OUT:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.expanduser(OUT), copy=False)
    print("SAVED", OUT)
