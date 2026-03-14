#!/usr/bin/env python3
"""
Seed vehicle_surface_templates with OEM dimensions for top Y/M/M combos.

Maps each L0 zone code to a physical bounding box (inches) on the vehicle envelope.
Dimensions sourced from OEM spec sheets and standard references.

Usage:
    cd /Users/skylar/nuke && dotenvx run -- python3 scripts/seed-surface-templates.py
"""

import os
import json
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Zone layout ratios — maps each L0 zone to a normalized bounding box
# {u_min, u_max} = front-to-rear (0=front bumper, 1.0=rear bumper) as fraction of length
# {v_min, v_max} = driver-to-passenger (0=driver, 1.0=passenger) as fraction of width
# {h_min, h_max} = ground-to-roof (0=ground, 1.0=roof) as fraction of height
# These ratios are vehicle-class-specific and get multiplied by actual dimensions

ZONE_LAYOUT_TRUCK = {
    # Exterior
    "ext_front":            {"u": (0.00, 0.08), "v": (0.10, 0.90), "h": (0.20, 0.70)},
    "ext_front_driver":     {"u": (0.00, 0.20), "v": (0.00, 0.50), "h": (0.20, 0.85)},
    "ext_front_passenger":  {"u": (0.00, 0.20), "v": (0.50, 1.00), "h": (0.20, 0.85)},
    "ext_rear":             {"u": (0.92, 1.00), "v": (0.10, 0.90), "h": (0.20, 0.70)},
    "ext_rear_driver":      {"u": (0.80, 1.00), "v": (0.00, 0.50), "h": (0.20, 0.85)},
    "ext_rear_passenger":   {"u": (0.80, 1.00), "v": (0.50, 1.00), "h": (0.20, 0.85)},
    "ext_driver_side":      {"u": (0.15, 0.85), "v": (0.00, 0.05), "h": (0.20, 0.85)},
    "ext_passenger_side":   {"u": (0.15, 0.85), "v": (0.95, 1.00), "h": (0.20, 0.85)},
    "ext_roof":             {"u": (0.15, 0.55), "v": (0.05, 0.95), "h": (0.95, 1.00)},
    "ext_undercarriage":    {"u": (0.05, 0.95), "v": (0.10, 0.90), "h": (0.00, 0.15)},
    # Fenders
    "fender_front_driver":     {"u": (0.05, 0.22), "v": (0.00, 0.15), "h": (0.25, 0.65)},
    "fender_front_passenger":  {"u": (0.05, 0.22), "v": (0.85, 1.00), "h": (0.25, 0.65)},
    "fender_rear_driver":      {"u": (0.60, 0.80), "v": (0.00, 0.15), "h": (0.25, 0.55)},
    "fender_rear_passenger":   {"u": (0.60, 0.80), "v": (0.85, 1.00), "h": (0.25, 0.55)},
    # Doors
    "door_driver":          {"u": (0.22, 0.50), "v": (0.00, 0.10), "h": (0.25, 0.80)},
    "door_passenger":       {"u": (0.22, 0.50), "v": (0.90, 1.00), "h": (0.25, 0.80)},
    # Bed (truck-specific)
    "bed_floor":            {"u": (0.55, 0.95), "v": (0.10, 0.90), "h": (0.30, 0.35)},
    "bed_side_driver":      {"u": (0.55, 0.95), "v": (0.00, 0.10), "h": (0.30, 0.55)},
    "bed_side_passenger":   {"u": (0.55, 0.95), "v": (0.90, 1.00), "h": (0.30, 0.55)},
    "tailgate":             {"u": (0.95, 1.00), "v": (0.10, 0.90), "h": (0.30, 0.55)},
    # Interior
    "int_dashboard":        {"u": (0.15, 0.25), "v": (0.10, 0.90), "h": (0.45, 0.75)},
    "int_steering":         {"u": (0.18, 0.25), "v": (0.15, 0.45), "h": (0.50, 0.70)},
    "int_gauges":           {"u": (0.15, 0.22), "v": (0.20, 0.55), "h": (0.55, 0.72)},
    "int_center_console":   {"u": (0.20, 0.40), "v": (0.40, 0.60), "h": (0.35, 0.55)},
    "int_front_seats":      {"u": (0.25, 0.45), "v": (0.10, 0.90), "h": (0.30, 0.80)},
    "int_rear_seats":       {"u": (0.45, 0.55), "v": (0.10, 0.90), "h": (0.30, 0.80)},
    "int_headliner":        {"u": (0.15, 0.55), "v": (0.10, 0.90), "h": (0.85, 0.98)},
    "int_cargo":            {"u": (0.55, 0.95), "v": (0.10, 0.90), "h": (0.30, 0.55)},
    "int_door_panel_driver":    {"u": (0.22, 0.50), "v": (0.00, 0.08), "h": (0.30, 0.75)},
    "int_door_panel_passenger": {"u": (0.22, 0.50), "v": (0.92, 1.00), "h": (0.30, 0.75)},
    # Mechanical
    "mech_engine_bay":      {"u": (0.00, 0.18), "v": (0.10, 0.90), "h": (0.35, 0.70)},
    "mech_exhaust":         {"u": (0.30, 0.95), "v": (0.10, 0.90), "h": (0.05, 0.15)},
    "mech_suspension":      {"u": (0.05, 0.25), "v": (0.00, 1.00), "h": (0.00, 0.25)},
    "mech_transmission":    {"u": (0.25, 0.45), "v": (0.30, 0.70), "h": (0.05, 0.20)},
    # Wheels
    "wheel_fl":             {"u": (0.10, 0.18), "v": (0.00, 0.12), "h": (0.00, 0.30)},
    "wheel_fr":             {"u": (0.10, 0.18), "v": (0.88, 1.00), "h": (0.00, 0.30)},
    "wheel_rl":             {"u": (0.70, 0.78), "v": (0.00, 0.12), "h": (0.00, 0.30)},
    "wheel_rr":             {"u": (0.70, 0.78), "v": (0.88, 1.00), "h": (0.00, 0.30)},
    # Detail
    "detail_badge":         {"u": (0.00, 1.00), "v": (0.00, 1.00), "h": (0.00, 1.00)},
    "detail_vin_plate":     {"u": (0.15, 0.22), "v": (0.15, 0.50), "h": (0.45, 0.55)},
    "detail_damage":        {"u": (0.00, 1.00), "v": (0.00, 1.00), "h": (0.00, 1.00)},
    "other":                {"u": (0.00, 1.00), "v": (0.00, 1.00), "h": (0.00, 1.00)},
}

# Use same layout for sedans/coupes/SUVs with minor adjustments
ZONE_LAYOUT_SEDAN = {**ZONE_LAYOUT_TRUCK}
# Sedans don't have bed zones — map them to trunk area
ZONE_LAYOUT_SEDAN["bed_floor"] = {"u": (0.70, 0.92), "v": (0.10, 0.90), "h": (0.25, 0.35)}
ZONE_LAYOUT_SEDAN["bed_side_driver"] = {"u": (0.70, 0.92), "v": (0.00, 0.10), "h": (0.25, 0.45)}
ZONE_LAYOUT_SEDAN["bed_side_passenger"] = {"u": (0.70, 0.92), "v": (0.90, 1.00), "h": (0.25, 0.45)}
ZONE_LAYOUT_SEDAN["tailgate"] = {"u": (0.92, 1.00), "v": (0.10, 0.90), "h": (0.25, 0.55)}

BODY_LAYOUTS = {
    "truck": ZONE_LAYOUT_TRUCK,
    "suv": ZONE_LAYOUT_TRUCK,
    "sedan": ZONE_LAYOUT_SEDAN,
    "coupe": ZONE_LAYOUT_SEDAN,
    "convertible": ZONE_LAYOUT_SEDAN,
    "roadster": ZONE_LAYOUT_SEDAN,
    "wagon": ZONE_LAYOUT_SEDAN,
}


def make_zone_bounds(layout: dict, length: int, width: int, height: int) -> dict:
    """Convert normalized zone ratios to physical inch coordinates."""
    bounds = {}
    for zone, ratios in layout.items():
        u = ratios["u"]
        v = ratios["v"]
        h = ratios["h"]
        bounds[zone] = {
            "u_min": round(u[0] * length, 1),
            "u_max": round(u[1] * length, 1),
            "v_min": round(v[0] * width, 1),
            "v_max": round(v[1] * width, 1),
            "h_min": round(h[0] * height, 1),
            "h_max": round(h[1] * height, 1),
        }
    return bounds


# Top 20 Y/M/M templates — OEM dimensions (inches)
# Sources: manufacturer spec sheets, edmunds.com, automobile-catalog.com
TEMPLATES = [
    # GM Trucks (huge in the dataset)
    {"year_start": 1973, "year_end": 1987, "make": "Chevrolet", "model": "K10", "body_style": "truck",
     "length_inches": 212, "width_inches": 79, "height_inches": 73, "wheelbase_inches": 131},
    {"year_start": 1973, "year_end": 1987, "make": "Chevrolet", "model": "K20", "body_style": "truck",
     "length_inches": 212, "width_inches": 79, "height_inches": 73, "wheelbase_inches": 131},
    {"year_start": 1973, "year_end": 1987, "make": "GMC", "model": "K2500", "body_style": "truck",
     "length_inches": 212, "width_inches": 79, "height_inches": 73, "wheelbase_inches": 131},
    {"year_start": 1973, "year_end": 1987, "make": "Chevrolet", "model": "Blazer", "body_style": "suv",
     "length_inches": 185, "width_inches": 79, "height_inches": 73, "wheelbase_inches": 106},
    {"year_start": 1966, "year_end": 1977, "make": "Ford", "model": "Bronco", "body_style": "suv",
     "length_inches": 152, "width_inches": 69, "height_inches": 72, "wheelbase_inches": 92},
    # Mercedes SL
    {"year_start": 1963, "year_end": 1971, "make": "Mercedes-Benz", "model": "230SL", "body_style": "roadster",
     "length_inches": 169, "width_inches": 69, "height_inches": 52, "wheelbase_inches": 94},
    {"year_start": 1967, "year_end": 1971, "make": "Mercedes-Benz", "model": "280SL", "body_style": "roadster",
     "length_inches": 169, "width_inches": 69, "height_inches": 52, "wheelbase_inches": 94},
    {"year_start": 1971, "year_end": 1989, "make": "Mercedes-Benz", "model": "350SL", "body_style": "roadster",
     "length_inches": 180, "width_inches": 71, "height_inches": 51, "wheelbase_inches": 96},
    {"year_start": 1971, "year_end": 1989, "make": "Mercedes-Benz", "model": "450SL", "body_style": "roadster",
     "length_inches": 180, "width_inches": 71, "height_inches": 51, "wheelbase_inches": 96},
    {"year_start": 1986, "year_end": 1989, "make": "Mercedes-Benz", "model": "560SL", "body_style": "roadster",
     "length_inches": 180, "width_inches": 71, "height_inches": 51, "wheelbase_inches": 96},
    # Porsche
    {"year_start": 1964, "year_end": 1973, "make": "Porsche", "model": "911", "body_style": "coupe",
     "length_inches": 164, "width_inches": 64, "height_inches": 52, "wheelbase_inches": 87},
    {"year_start": 1974, "year_end": 1989, "make": "Porsche", "model": "911", "body_style": "coupe",
     "length_inches": 169, "width_inches": 65, "height_inches": 52, "wheelbase_inches": 90},
    {"year_start": 1997, "year_end": 2004, "make": "Porsche", "model": "911", "body_style": "coupe",
     "length_inches": 175, "width_inches": 69, "height_inches": 51, "wheelbase_inches": 93},
    # Muscle cars
    {"year_start": 1967, "year_end": 1969, "make": "Chevrolet", "model": "Camaro", "body_style": "coupe",
     "length_inches": 185, "width_inches": 73, "height_inches": 51, "wheelbase_inches": 108},
    {"year_start": 1964, "year_end": 1973, "make": "Ford", "model": "Mustang", "body_style": "coupe",
     "length_inches": 182, "width_inches": 68, "height_inches": 51, "wheelbase_inches": 108},
    {"year_start": 1966, "year_end": 1972, "make": "Chevrolet", "model": "Chevelle", "body_style": "coupe",
     "length_inches": 197, "width_inches": 75, "height_inches": 53, "wheelbase_inches": 112},
    # Classics
    {"year_start": 1953, "year_end": 1962, "make": "Chevrolet", "model": "Corvette", "body_style": "convertible",
     "length_inches": 168, "width_inches": 73, "height_inches": 52, "wheelbase_inches": 102},
    {"year_start": 1955, "year_end": 1957, "make": "Ford", "model": "Thunderbird", "body_style": "convertible",
     "length_inches": 175, "width_inches": 70, "height_inches": 52, "wheelbase_inches": 102},
    {"year_start": 1981, "year_end": 1983, "make": "DeLorean", "model": "DMC-12", "body_style": "coupe",
     "length_inches": 169, "width_inches": 79, "height_inches": 45, "wheelbase_inches": 95},
    # Italian
    {"year_start": 1969, "year_end": 1974, "make": "Ferrari", "model": "Dino 246", "body_style": "coupe",
     "length_inches": 167, "width_inches": 67, "height_inches": 44, "wheelbase_inches": 92},
]


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    inserted = 0
    skipped = 0

    for t in TEMPLATES:
        # Check if template already exists
        existing = (
            sb.table("vehicle_surface_templates")
            .select("id")
            .eq("make", t["make"])
            .eq("model", t["model"])
            .eq("year_start", t["year_start"])
            .eq("year_end", t["year_end"])
            .execute()
        )
        if existing.data:
            print(f"  SKIP {t['year_start']}-{t['year_end']} {t['make']} {t['model']} (exists)")
            skipped += 1
            continue

        layout = BODY_LAYOUTS.get(t["body_style"], ZONE_LAYOUT_SEDAN)
        zone_bounds = make_zone_bounds(
            layout, t["length_inches"], t["width_inches"], t["height_inches"]
        )

        row = {
            "year_start": t["year_start"],
            "year_end": t["year_end"],
            "make": t["make"],
            "model": t["model"],
            "body_style": t["body_style"],
            "length_inches": t["length_inches"],
            "width_inches": t["width_inches"],
            "height_inches": t["height_inches"],
            "wheelbase_inches": t.get("wheelbase_inches"),
            "zone_bounds": zone_bounds,
            "source": "oem_spec",
        }
        sb.table("vehicle_surface_templates").insert(row).execute()
        inserted += 1
        print(f"  INSERT {t['year_start']}-{t['year_end']} {t['make']} {t['model']} ({len(zone_bounds)} zones)")

    print(f"\nDone: {inserted} inserted, {skipped} skipped")


if __name__ == "__main__":
    main()
