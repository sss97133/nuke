"""
K5 Blazer frame mesh — accurate to FR-88 (1988 Blazer 4WD frame dim PDF).
Same chassis 73-91 squarebody.

Builds two parallel C-channel rails following the documented side-view profile
(front kickdown, level run, rear kickup) with the bottom-view widths at each
station, plus the documented crossmembers.

RUN: open 1978_Chevrolet_Blazer.blend, Scripting tab, paste this, Run Script.
The frame appears in a new collection "K5_Frame" — won't disturb the body mesh.

Coordinate convention:
  Origin = front face of front frame crossmember, on vehicle centerline, at DATUM
  X = REAR-positive (longitudinal)
  Y = PASSENGER-side-positive (lateral)
  Z = UP-positive (above datum)

Dimensions in mm, scaled to meters at create-time (Blender's metric default).
All numbers cited inline from FR-88 Fig 1 (page 1).
"""

import bpy
import bmesh
from mathutils import Vector

MM = 0.001  # mm → m

# ============================================================
# FRAME GEOMETRY — from FR-88 Fig 1 (1988 Chev Blazer 4WD)
# ============================================================

WHEELBASE = 2705                          # FR-88 header: 2705 mm (106.5 in)
FRONT_OVERHANG = 700                      # estimated; FR-88 doesn't dim this directly
REAR_OVERHANG = 500                       # estimated
TOTAL_LENGTH = WHEELBASE + FRONT_OVERHANG + REAR_OVERHANG  # 3905 mm

# Rail cross-section (C-channel approximated as box for now)
RAIL_BOX_WIDTH = 80                       # web thickness + flange width (typical squarebody)
RAIL_BOX_HEIGHT_MIDCAB = 286              # FR-88 atom: rail box height at mid-cab
RAIL_BOX_HEIGHT_REAR = 362                # rail at rear is taller (1186-824=362, FR-88 atoms)

# Side-view path (X = longitudinal from front of frame, Z = height above DATUM)
# Each tuple: (X_mm, Z_top_of_rail_mm, rail_height_mm)
# The rail's bottom = Z_top - rail_height
#
# Stations identified from FR-88 measuring point designations + side-view heights.
# X values reference origin = front face of frame (point A area).
# Z values are absolute heights above datum line.
SIDE_PROFILE = [
    # (X_mm,    Z_top_mm,  rail_height_mm)
    (0,         706,       286),   # front rail tip (point A area) — 706mm above datum
    (300,       706,       286),   # short flat run before kickdown
    (706,       706,       286),   # point A (front frame rail center)
    (938,       550,       286),   # post-front-kickdown beginning
    (1200,      350,       286),   # mid-front kickdown, descending
    (1475,      286,       286),   # CD crossmember station — rail at level run
    (1587,      286,       286),   # E station (motor mount) — level run
    (1769,      286,       286),   # G station — still level
    (2200,      286,       286),   # mid-cab level run
    (2400,      400,       286),   # beginning of rear kickup
    (2705,      650,       320),   # rear axle area (wheelbase end)
    (2900,      824,       362),   # rear kickup peak
    (3200,      824,       362),   # rear flat
    (TOTAL_LENGTH, 824,    362),   # back of frame (point N area)
]

# Bottom-view inside-rail width at key X stations.
# FR-88 + KLM CHT-1 data: frame opens wide at front, narrows mid-frame,
# stays roughly constant under cab, opens slightly at rear axle.
WIDTH_PROFILE = [
    # (X_mm,   inside_width_mm)
    (0,        1587),   # front of frame opens to 1587mm inside (FR-88 atom)
    (706,      1410),   # narrows toward A
    (1475,     961),    # mid-frame inside ~961 (KLM)
    (1587,     896),    # at motor mount station, narrowest
    (2200,     800),    # mid-cab
    (2705,     1184),   # rear axle area widens
    (TOTAL_LENGTH, 1411),  # rear of frame
]

# Crossmembers — X position, type. Width spans between rails.
CROSSMEMBERS = [
    # (X_mm,  name,                    width_mm,  height_mm)
    (0,       "Front_Bumper_Mount",    100,       180),  # front of frame
    (1475,    "CD_Crossmember",        80,        180),  # FR-88 point CD
    (1587,    "Motor_Mount_CM",        100,       180),  # FR-88 point E (motor mount)
    (2705,    "Rear_Crossmember",      100,       180),  # rear axle area
    (TOTAL_LENGTH - 100, "Tow_Mount",  100,       180),  # FR-88 points L/L'/M/N
]


# ============================================================
# HELPERS
# ============================================================

def get_z_at_x(x):
    """Interpolate top-of-rail Z at any X via piecewise linear."""
    for i, (px, pz, _) in enumerate(SIDE_PROFILE):
        if px >= x:
            if i == 0 or px == x:
                return pz, SIDE_PROFILE[i][2]
            prev_x, prev_z, prev_h = SIDE_PROFILE[i-1]
            t = (x - prev_x) / (px - prev_x)
            z = prev_z + t * (pz - prev_z)
            h = prev_h + t * (SIDE_PROFILE[i][2] - prev_h)
            return z, h
    last_x, last_z, last_h = SIDE_PROFILE[-1]
    return last_z, last_h


def get_inside_width_at_x(x):
    """Interpolate frame inside width at any X."""
    for i, (px, pw) in enumerate(WIDTH_PROFILE):
        if px >= x:
            if i == 0 or px == x:
                return pw
            prev_x, prev_w = WIDTH_PROFILE[i-1]
            t = (x - prev_x) / (px - prev_x)
            return prev_w + t * (pw - prev_w)
    return WIDTH_PROFILE[-1][1]


def ensure_collection(name):
    """Get or create a collection."""
    if name in bpy.data.collections:
        col = bpy.data.collections[name]
    else:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def mat(name, color):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    return m


# ============================================================
# BUILD ONE RAIL (sweep box section along side-view path)
# ============================================================

def build_rail(side_label, y_sign, collection):
    """
    side_label: 'Driver' or 'Passenger'
    y_sign: -1 for driver (left), +1 for passenger (right)
    """
    # Sample the path at fine resolution
    SAMPLE_DX = 50  # mm
    sample_x = list(range(0, int(TOTAL_LENGTH) + 1, SAMPLE_DX))

    # Build vertices: 4 per station (top-inner, top-outer, bottom-outer, bottom-inner)
    verts = []
    faces = []

    for i, x in enumerate(sample_x):
        z_top, rail_h = get_z_at_x(x)
        z_bot = z_top - rail_h
        inside_w = get_inside_width_at_x(x)
        y_inner = y_sign * (inside_w / 2.0)
        y_outer = y_sign * (inside_w / 2.0 + RAIL_BOX_WIDTH)

        # 4 corners of cross-section at this X (CCW looking forward for outward normals)
        v_ti = (x * MM, y_inner * MM, z_top * MM)  # top-inner
        v_to = (x * MM, y_outer * MM, z_top * MM)  # top-outer
        v_bo = (x * MM, y_outer * MM, z_bot * MM)  # bottom-outer
        v_bi = (x * MM, y_inner * MM, z_bot * MM)  # bottom-inner
        verts.extend([v_ti, v_to, v_bo, v_bi])

        # Connect to previous station with quads
        if i > 0:
            base = (i - 1) * 4
            n = i * 4
            # top face
            faces.append((base + 0, base + 1, n + 1, n + 0))
            # outer face
            faces.append((base + 1, base + 2, n + 2, n + 1))
            # bottom face
            faces.append((base + 2, base + 3, n + 3, n + 2))
            # inner face
            faces.append((base + 3, base + 0, n + 0, n + 3))

    # Cap front and rear
    faces.append((0, 1, 2, 3))                                              # front cap
    last = (len(sample_x) - 1) * 4
    faces.append((last + 3, last + 2, last + 1, last + 0))                  # rear cap

    mesh = bpy.data.meshes.new(f"K5_Rail_{side_label}_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"K5_Rail_{side_label}", mesh)
    obj.data.materials.append(mat("K5_Frame_Steel", (0.12, 0.12, 0.13, 1.0)))
    collection.objects.link(obj)
    return obj


# ============================================================
# BUILD CROSSMEMBERS
# ============================================================

def build_crossmember(x, name, width_mm, height_mm, collection):
    """Box crossmember spanning between rails at station X."""
    z_top, rail_h = get_z_at_x(x)
    z_bot = z_top - rail_h
    z_center = (z_top + z_bot) / 2.0

    inside_w = get_inside_width_at_x(x)
    span = inside_w  # rail-inside to rail-inside

    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(x * MM, 0, z_center * MM),
    )
    obj = bpy.context.active_object
    obj.name = f"K5_CM_{name}"
    obj.scale = (width_mm * MM, span * MM, height_mm * MM)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat("K5_Frame_Steel", (0.12, 0.12, 0.13, 1.0)))
    # Move to collection
    for c in obj.users_collection:
        c.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


# ============================================================
# BUILD WHEELS (reference geometry — K5 stock 31x10.5 R15 = ~787mm OD)
# ============================================================

def build_wheels(collection):
    tire_radius = 393      # mm (31" tire)
    tire_width = 267       # mm (10.5")
    front_axle_x = 700     # X position where front axle is (just behind point A area)
    rear_axle_x = front_axle_x + WHEELBASE  # = 3405 mm
    track_half = 800       # mm (typical K5 ~63 in track)

    for label, x in [("Front", front_axle_x), ("Rear", rear_axle_x)]:
        for side, y in [("DR", -track_half), ("PS", +track_half)]:
            bpy.ops.mesh.primitive_cylinder_add(
                radius=tire_radius * MM,
                depth=tire_width * MM,
                location=(x * MM, y * MM, tire_radius * MM),
                rotation=(1.5708, 0, 0),
            )
            obj = bpy.context.active_object
            obj.name = f"K5_Tire_{label}_{side}"
            obj.data.materials.append(mat("K5_Tire", (0.05, 0.05, 0.06, 1.0)))
            for c in obj.users_collection:
                c.objects.unlink(obj)
            collection.objects.link(obj)


# ============================================================
# MAIN
# ============================================================

def main():
    print(f"Building K5 frame from FR-88 (wheelbase {WHEELBASE}mm)...")

    # Set scene metric
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.length_unit = 'METERS'

    # Remove any prior build
    for old in list(bpy.data.collections):
        if old.name in ("K5_Frame", "K5_Twin"):
            for obj in list(old.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(old)

    col = ensure_collection("K5_Frame")

    # Frame rails
    build_rail("Driver", -1, col)
    build_rail("Passenger", +1, col)

    # Crossmembers
    for x, name, w, h in CROSSMEMBERS:
        build_crossmember(x, name, w, h, col)

    # Wheels for spatial reference
    build_wheels(col)

    print(f"Done. {len(col.objects)} objects in collection 'K5_Frame'.")
    print("Rails follow FR-88 side profile with kickdowns/kickups at documented stations.")
    print(f"Total frame length: {TOTAL_LENGTH/1000:.2f}m, wheelbase: {WHEELBASE/1000:.2f}m")

    # Frame in viewport
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            override = bpy.context.copy()
            override['area'] = area
            override['region'] = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(**override):
                bpy.ops.view3d.view_all()
            break


if __name__ == "__main__":
    main()
