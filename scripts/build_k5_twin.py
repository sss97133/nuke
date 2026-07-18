"""
K5 Blazer digital twin — first-pass geometry from K5_dimensions_atoms.yaml.

Run inside Blender (Scripting tab → New → paste → Run Script).
Produces a starter scene: frame rails, engine bay envelope, LS3 + 6L80 + Holley
mid-mount + iBooster as placed boxes, wheels as cylinders for spatial sense.

Coordinate convention:
  Origin = front face of front frame crossmember, on vehicle centerline, at ground
  X = rear-positive (vehicle longitudinal)
  Y = passenger-side-positive (vehicle lateral)
  Z = up

All values mm, then scaled to Blender meters at the end.
Iterate from here — this is a starter, not engineering accurate.
"""

import bpy
import bmesh
from mathutils import Vector

# ============================================================
# DIMENSIONAL DATA — pulled from docs/wiring/output/K5_dimensions_atoms.yaml
# Hardcoded here so the script runs without YAML parsing dependencies.
# Update when atoms YAML changes.
# ============================================================

# Frame (FR-88 1988 Blazer 4WD, applies to 73-91 squarebody ±2mm)
WHEELBASE = 2705                  # mm
FRAME_RAIL_INSIDE_WIDTH = 800     # mm, approx mid-frame; FR-88 varies 791-961 by station
FRAME_RAIL_BOX_HEIGHT = 286       # mm at mid-cab (FR-88 atom)
FRAME_RAIL_BOX_WIDTH = 80         # mm typical squarebody C-channel converted to box
FRAME_HEIGHT_MIDBAY = 400         # mm ground to bottom of rail at level run (approx)

# Engine bay envelope (FR-88 page 2)
BAY_WIDTH_FIREWALL = 1715         # mm
BAY_INNER_TOWER_TO_TOWER = 2204   # mm (1102 each side from CL)
BAY_LENGTH_FIREWALL_TO_RADSUPPORT = 1523  # mm
BAY_DIAGONAL = 1957               # mm (squareness check)

# LS3 long-block (Marine spec sheet, no headers, no accessories)
LS3_LENGTH = 710                  # mm damper-to-bellhousing
LS3_WIDTH = 705                   # mm valve cover to valve cover
LS3_HEIGHT = 716                  # mm oil pan to top of intake
LS3_BORE_CENTER = 111.76          # mm cyl pitch

# Holley Mid-Mount 20-131 with A/C (Holley fitment guide PDF page 2)
HOLLEY_WIDTH_LEFT = 411           # mm CL to left accessories
HOLLEY_WIDTH_RIGHT = 433          # mm CL to right accessories
HOLLEY_HEIGHT_ABOVE_CL = 406      # mm tallest accessory above crank CL
HOLLEY_DEPTH_FORWARD = 165        # mm forward of front of block (estimate ~6.5 in)
HOLLEY_BELOW_CL = 339             # mm lowest accessory below CL

# 6L80E (research agent — vendor published)
TRANS_LENGTH_4WD = 689            # mm bellhousing face to end of output shaft
TRANS_CASE_LENGTH = 592           # mm bellhousing face to end of case
TRANS_BELLHOUSING_OD = 317.5      # mm
TRANS_TAIL_OD = 279               # mm

# iBooster Gen 2 (Tesla Model 3 donor, community-measured)
IBOOST_LENGTH = 390               # mm flange to reservoir end
IBOOST_WIDTH = 190                # mm
IBOOST_HEIGHT_TOP = 100           # mm above CL
IBOOST_HEIGHT_BOTTOM = 160        # mm below CL
IBOOST_BOOSTER_DEPTH = 155        # mm into bay
IBOOST_MC_PROTRUSION = 97         # mm forward of booster body
IBOOST_BOLT_PITCH = 72            # mm square pattern

# Headers (eBay generic, Hooker-shape — low confidence)
HEADER_OUTLET_DIA = 63.5          # mm = 2.5 in (confirmed via QTP cutout receipt)
HEADER_OUTLET_BELOW_CRANK = 178   # mm typical shorty
HEADER_OUTLET_FORWARD_OF_BELLHOUSING = 100  # mm typical

# Champion radiator (typical CC-490 K5 fitment — low confidence)
RAD_CORE_WIDTH = 762              # mm ≈ 30 in
RAD_CORE_HEIGHT = 432             # mm ≈ 17 in
RAD_CORE_THICK = 76               # mm ≈ 3 in

# Mount-point coordinates (X back-positive, Y passenger-positive, Z up)
# Frame point E from FR-88 = motor mount bolt station, 1587 mm rearward of front frame
MOTOR_MOUNT_X = 1587              # mm rearward from front of frame
# Crank centerline height above ground — approximate, depends on motor mount + stance
CRANK_CL_Z = 600                  # mm typical for K5 stock height
# Firewall plane location (X) — engine bay ends at firewall
FIREWALL_X = MOTOR_MOUNT_X + LS3_LENGTH / 2 + 100  # behind engine + service gap
# Radiator support plane
RAD_SUPPORT_X = FIREWALL_X - BAY_LENGTH_FIREWALL_TO_RADSUPPORT

# ============================================================
# HELPERS
# ============================================================

MM_TO_M = 0.001  # Blender uses meters

def clear_scene():
    """Wipe the scene (keep a clean slate for re-runs)."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)


def add_box(name, x_mm, y_mm, z_mm, length_mm, width_mm, height_mm, color=(0.5, 0.5, 0.5, 1.0)):
    """Add a box centered at (x,y,z) with given size. Coordinates in mm."""
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(x_mm * MM_TO_M, y_mm * MM_TO_M, z_mm * MM_TO_M),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (length_mm * MM_TO_M, width_mm * MM_TO_M, height_mm * MM_TO_M)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Material
    mat = bpy.data.materials.new(name=f"mat_{name}")
    mat.diffuse_color = color
    obj.data.materials.append(mat)
    return obj


def add_cylinder(name, x_mm, y_mm, z_mm, radius_mm, depth_mm, axis='Z', color=(0.4, 0.4, 0.4, 1.0)):
    """Add a cylinder centered at (x,y,z). axis determines orientation."""
    rotation = {
        'Z': (0, 0, 0),
        'X': (0, 1.5708, 0),
        'Y': (1.5708, 0, 0),
    }[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius_mm * MM_TO_M,
        depth=depth_mm * MM_TO_M,
        location=(x_mm * MM_TO_M, y_mm * MM_TO_M, z_mm * MM_TO_M),
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    mat = bpy.data.materials.new(name=f"mat_{name}")
    mat.diffuse_color = color
    obj.data.materials.append(mat)
    return obj


def add_wireframe_box(name, x_mm, y_mm, z_mm, length_mm, width_mm, height_mm, color=(1, 1, 1, 1)):
    """Add a wireframe-only box — used for envelope volumes that should not be solid."""
    obj = add_box(name, x_mm, y_mm, z_mm, length_mm, width_mm, height_mm, color)
    # Toggle to wireframe display
    obj.display_type = 'WIRE'
    return obj


# ============================================================
# BUILD SCENE
# ============================================================

def build_frame():
    """Two parallel rails running the wheelbase + 500mm front overhang + 300mm rear."""
    rail_total_length = WHEELBASE + 500 + 300
    rail_x_center = rail_total_length / 2 - 500  # center of rail, with origin at frame front
    rail_y_offset = (FRAME_RAIL_INSIDE_WIDTH + FRAME_RAIL_BOX_WIDTH) / 2
    rail_z = FRAME_HEIGHT_MIDBAY + FRAME_RAIL_BOX_HEIGHT / 2

    color = (0.15, 0.15, 0.15, 1.0)
    add_box("Frame_Rail_Driver", rail_x_center, -rail_y_offset, rail_z,
            rail_total_length, FRAME_RAIL_BOX_WIDTH, FRAME_RAIL_BOX_HEIGHT, color)
    add_box("Frame_Rail_Passenger", rail_x_center, +rail_y_offset, rail_z,
            rail_total_length, FRAME_RAIL_BOX_WIDTH, FRAME_RAIL_BOX_HEIGHT, color)
    # Front + rear crossmembers (simplified)
    add_box("Frame_Crossmember_Front", 0, 0, rail_z,
            FRAME_RAIL_BOX_WIDTH, FRAME_RAIL_INSIDE_WIDTH, FRAME_RAIL_BOX_HEIGHT, color)
    add_box("Frame_Crossmember_Rear", WHEELBASE, 0, rail_z,
            FRAME_RAIL_BOX_WIDTH, FRAME_RAIL_INSIDE_WIDTH, FRAME_RAIL_BOX_HEIGHT, color)


def build_wheels():
    """Four wheels for spatial reference. K5 typical 31-33 inch tire = ~800mm OD."""
    tire_radius = 400  # mm
    tire_width = 280
    track_width_half = 800  # half of front/rear track (typical K5 ~63 in)
    front_axle_x = 0
    rear_axle_x = WHEELBASE
    z = tire_radius
    color = (0.05, 0.05, 0.05, 1.0)
    for label, x in [("Front", front_axle_x), ("Rear", rear_axle_x)]:
        for side, y in [("DR", -track_width_half), ("PS", +track_width_half)]:
            add_cylinder(f"Tire_{label}_{side}", x, y, z, tire_radius, tire_width, axis='Y', color=color)


def build_engine_bay_envelope():
    """Wireframe box defining the engine bay volume."""
    bay_length = BAY_LENGTH_FIREWALL_TO_RADSUPPORT
    bay_width = BAY_WIDTH_FIREWALL
    bay_height = 900  # approximate — top of fender to bottom of frame, refine later
    bay_x = (FIREWALL_X + RAD_SUPPORT_X) / 2
    bay_z = FRAME_HEIGHT_MIDBAY + bay_height / 2 + FRAME_RAIL_BOX_HEIGHT
    add_wireframe_box("EngineBay_Envelope", bay_x, 0, bay_z,
                      bay_length, bay_width, bay_height, color=(0, 1, 1, 1))
    # Shock tower constraint planes
    add_wireframe_box("ShockTower_Driver_Inner", bay_x, -1102, bay_z,
                      bay_length, 50, bay_height, color=(1, 1, 0, 1))
    add_wireframe_box("ShockTower_Passenger_Inner", bay_x, +1102, bay_z,
                      bay_length, 50, bay_height, color=(1, 1, 0, 1))


def build_engine():
    """LS3 long block — solid box for now."""
    add_box(
        "LS3_LongBlock",
        x_mm=MOTOR_MOUNT_X,
        y_mm=0,
        z_mm=CRANK_CL_Z + LS3_HEIGHT / 2 - 200,  # crank CL roughly 200mm up from oil pan bottom
        length_mm=LS3_LENGTH,
        width_mm=LS3_WIDTH,
        height_mm=LS3_HEIGHT,
        color=(0.6, 0.5, 0.3, 1.0),
    )


def build_holley_midmount():
    """Holley 20-131 accessory drive cluster — extends forward of block."""
    holley_x = MOTOR_MOUNT_X - LS3_LENGTH / 2 - HOLLEY_DEPTH_FORWARD / 2
    # Total cluster height = above CL + below CL
    cluster_height = HOLLEY_HEIGHT_ABOVE_CL + HOLLEY_BELOW_CL
    cluster_z = CRANK_CL_Z + (HOLLEY_HEIGHT_ABOVE_CL - HOLLEY_BELOW_CL) / 2
    cluster_width = HOLLEY_WIDTH_LEFT + HOLLEY_WIDTH_RIGHT
    cluster_y = (HOLLEY_WIDTH_RIGHT - HOLLEY_WIDTH_LEFT) / 2
    add_box("Holley_MidMount_20-131",
            holley_x, cluster_y, cluster_z,
            HOLLEY_DEPTH_FORWARD, cluster_width, cluster_height,
            color=(0.7, 0.7, 0.75, 1.0))


def build_transmission():
    """6L80E behind engine."""
    trans_x = MOTOR_MOUNT_X + LS3_LENGTH / 2 + TRANS_LENGTH_4WD / 2
    trans_z = CRANK_CL_Z  # roughly aligned with crank CL
    add_cylinder("Trans_6L80E_Bellhousing",
                 x_mm=MOTOR_MOUNT_X + LS3_LENGTH / 2 + 50,
                 y_mm=0,
                 z_mm=trans_z,
                 radius_mm=TRANS_BELLHOUSING_OD / 2,
                 depth_mm=100,
                 axis='X',
                 color=(0.4, 0.45, 0.5, 1.0))
    # Tail case as tapered box (approximate as average diameter)
    avg_dia = (TRANS_BELLHOUSING_OD + TRANS_TAIL_OD) / 2
    add_box("Trans_6L80E_Case",
            trans_x + 50, 0, trans_z,
            TRANS_CASE_LENGTH - 100, avg_dia, avg_dia,
            color=(0.4, 0.45, 0.5, 1.0))


def build_ibooster():
    """iBooster Gen 2 mounted on firewall, driver side, at factory iBooster H3 location."""
    # Driver side, ~250mm right of vehicle CL (driver is -Y in our convention)
    boost_x = FIREWALL_X + IBOOST_BOOSTER_DEPTH / 2  # protrudes BACK into cab from firewall
    boost_y = -300  # driver side
    boost_z = CRANK_CL_Z + 50  # roughly brake pedal height
    # Booster body
    add_box("iBooster_Body",
            boost_x, boost_y, boost_z,
            IBOOST_BOOSTER_DEPTH, IBOOST_WIDTH, IBOOST_HEIGHT_TOP + IBOOST_HEIGHT_BOTTOM,
            color=(0.2, 0.3, 0.4, 1.0))
    # Master cylinder protrudes forward INTO engine bay
    mc_x = FIREWALL_X - IBOOST_MC_PROTRUSION / 2
    add_box("iBooster_MasterCyl",
            mc_x, boost_y, boost_z + 30,
            IBOOST_MC_PROTRUSION, 100, 100,
            color=(0.3, 0.4, 0.5, 1.0))


def build_radiator():
    """Champion-style radiator at radiator support plane."""
    rad_x = RAD_SUPPORT_X
    rad_z = CRANK_CL_Z + 100  # roughly centered with engine height
    add_box("Radiator_Champion",
            rad_x, 0, rad_z,
            RAD_CORE_THICK, RAD_CORE_WIDTH, RAD_CORE_HEIGHT,
            color=(0.8, 0.5, 0.2, 1.0))


def build_firewall():
    """Plane representing the firewall, for reference."""
    add_box("Firewall_Plane",
            FIREWALL_X, 0, CRANK_CL_Z + 200,
            10, BAY_WIDTH_FIREWALL, 1200,
            color=(0.4, 0.4, 0.4, 0.5))


# ============================================================
# MAIN
# ============================================================

def main():
    print("Building K5 digital twin from atoms...")
    clear_scene()

    build_frame()
    build_wheels()
    build_engine_bay_envelope()
    build_firewall()
    build_engine()
    build_holley_midmount()
    build_transmission()
    build_radiator()
    build_ibooster()

    # Set up viewport
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.length_unit = 'METERS'

    # Frame all objects in viewport
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    override = {'area': area, 'region': region}
                    bpy.ops.view3d.view_all(override)
                    break

    print("Done. Objects in scene:")
    for obj in bpy.data.objects:
        print(f"  {obj.name}: {obj.location} m, dims {obj.dimensions} m")


if __name__ == "__main__":
    main()
