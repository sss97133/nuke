# Image Angle Taxonomy & AI Analysis System

## What the AI Button Does

The "AI" button in the image lightbox triggers the `analyze-image` Edge Function which:

1. **Sends the image to AWS Rekognition** for object/part detection
2. **Detects automotive parts, tools, brands, and processes** visible in the image
3. **Creates AI-generated tags** with confidence scores (0-100%)
4. **Inserts tags into `vehicle_image_tags`** table marked as unverified
5. **Returns results within ~2-3 seconds**

Tags can later be verified by users to improve accuracy.

---

## Current Angle Taxonomy (From `backfill-image-angles` Edge Function)

Your system already has a **comprehensive 120+ angle categories**. Here's the complete taxonomy:

### EXTERIOR FULL VEHICLE (17 angles)
- `front_quarter_driver`, `front_quarter_passenger`
- `front_straight`
- `front_three_quarter_driver`, `front_three_quarter_passenger`
- `rear_quarter_driver`, `rear_quarter_passenger`
- `rear_straight`
- `rear_three_quarter_driver`, `rear_three_quarter_passenger`
- `profile_driver`, `profile_passenger`
- `side_driver`, `side_passenger`
- `top_down`, `roof_view`
- `front_corner`, `rear_corner`

### ENGINE BAY (10 angles) ✅ Already granular!
- `engine_bay_full` - Complete engine bay from above
- `engine_bay_driver` - Engine bay from driver side
- `engine_bay_passenger` - Engine bay from passenger side
- `engine_bay_top` - Straight down view
- `engine_component` - Specific engine part closeup
- `engine_detail` - Macro detail shot
- `firewall` - Firewall view
- `battery`, `alternator`, `radiator`, `air_intake`, `exhaust_manifold`, `transmission`

### INTERIOR (14 angles)
- `interior_dash_full`, `interior_dash_driver`, `interior_dash_passenger`
- `interior_center_console`
- `interior_steering_wheel`
- `interior_driver_seat`, `interior_passenger_seat`, `interior_rear_seats`
- `interior_headliner`, `interior_carpet`
- `interior_door_driver`, `interior_door_passenger`, `interior_door_rear`
- `interior_trunk`, `interior_cargo`, `interior_bed`

### UNDERCARRIAGE (15 angles)
- `undercarriage_full`, `undercarriage_front`, `undercarriage_rear`
- `undercarriage_driver`, `undercarriage_passenger`
- `frame_rail_driver_front`, `frame_rail_driver_rear`
- `frame_rail_passenger_front`, `frame_rail_passenger_rear`
- `front_suspension`, `rear_suspension`
- `front_axle`, `rear_axle`, `differential`
- `exhaust_system`, `fuel_tank`, `transmission_underside`, `driveshaft`, `brake_system`

### WHEEL WELLS & WHEELS (10 angles)
- `wheel_well_driver_front`, `wheel_well_driver_rear`
- `wheel_well_passenger_front`, `wheel_well_passenger_rear`
- `wheel_closeup`, `tire_closeup`
- `brake_caliper`, `brake_rotor`, `brake_pad`

### BODY PANELS (25 angles)
- `door_panel_driver`, `door_panel_passenger`
- `door_jamb_driver`, `door_jamb_passenger`
- `door_handle`, `mirror_driver`, `mirror_passenger`
- `window_driver`, `window_passenger`
- `headlight_driver`, `headlight_passenger`
- `taillight_driver`, `taillight_passenger`
- `turn_signal`, `fog_light`
- `grille`, `bumper_front`, `bumper_rear`
- `hood`, `trunk_lid`, `tailgate`
- `fender_driver_front`, `fender_driver_rear`
- `fender_passenger_front`, `fender_passenger_rear`
- `quarter_panel_driver`, `quarter_panel_passenger`
- `rocker_panel_driver`, `rocker_panel_passenger`
- `badges`, `emblems`

### DOCUMENTS & VIN (9 angles)
- `vin_door_jamb`, `vin_dashboard`, `vin_frame`, `vin_engine`
- `title_document`, `registration`
- `receipt`, `invoice`, `manual_page`

### DAMAGE & REPAIR (9 angles)
- `rust_damage`, `paint_damage`, `dent_damage`, `scratch_damage`
- `repair_before`, `repair_after`, `repair_in_progress`
- `labor_step`

---

## The Problem You Identified

You're absolutely right: **"engine_bay" is too broad** because it would contain:
- Full engine bay shots
- Driver side angles
- Passenger side angles  
- Specific component closeups
- Detail shots of alternator
- Battery area
- Radiator views
- Firewall shots

**Good news:** Your system already solves this with 10+ granular engine bay angles!

---

## Proposed Naming Convention & Hierarchy

To make the taxonomy more **queryable and futureproof**, use a hierarchical dot-notation system:

### Three-Level Hierarchy: `AREA.VIEW.COMPONENT`

```
AREA:       exterior | engine_bay | interior | undercarriage | wheels | body | documents | damage
VIEW:       full | driver | passenger | front | rear | top | detail | closeup
COMPONENT:  (specific part name)
```

### Examples of Current → Proposed Mapping:

| Current Label | Proposed Label | Query Pattern |
|--------------|----------------|---------------|
| `engine_bay_full` | `engine_bay.full.overview` | `engine_bay.full.*` |
| `engine_bay_driver` | `engine_bay.driver.overview` | `engine_bay.driver.*` |
| `engine_bay_passenger` | `engine_bay.passenger.overview` | `engine_bay.passenger.*` |
| `battery` | `engine_bay.top.battery` | `engine_bay.*.battery` |
| `alternator` | `engine_bay.driver.alternator` | `engine_bay.*.alternator` |
| `radiator` | `engine_bay.front.radiator` | `engine_bay.front.*` |
| `firewall` | `engine_bay.rear.firewall` | `engine_bay.rear.*` |
| `engine_component` | `engine_bay.detail.component` | `engine_bay.detail.*` |
| `interior_dash_driver` | `interior.driver.dashboard` | `interior.driver.*` |
| `wheel_well_driver_front` | `wheels.driver_front.well` | `wheels.*.well` |

### Benefits of Dot-Notation:

1. **Easy filtering:** `WHERE angle LIKE 'engine_bay.%'` gets all engine bay images
2. **Hierarchical queries:** `WHERE angle LIKE 'engine_bay.driver.%'` gets all driver-side engine shots
3. **Component search:** `WHERE angle LIKE '%.battery'` finds battery shots from any angle
4. **Future-proof:** Add new levels without breaking existing categories
5. **Clear semantics:** `engine_bay.driver.alternator` is self-documenting

---

## Database Schema Recommendation

### Option 1: Keep Current Flat Structure (Simpler)
```sql
ALTER TABLE vehicle_images 
ADD COLUMN angle_category TEXT; -- 'engine_bay', 'interior', etc.
ADD COLUMN angle_view TEXT;     -- 'full', 'driver', 'passenger', etc.
ADD COLUMN angle_component TEXT; -- 'battery', 'alternator', etc.

CREATE INDEX idx_angle_category ON vehicle_images(angle_category);
CREATE INDEX idx_angle_composite ON vehicle_images(angle_category, angle_view, angle_component);
```

### Option 2: Hierarchical Text Column (More Flexible)
```sql
ALTER TABLE vehicle_images 
ADD COLUMN angle_path TEXT; -- 'engine_bay.driver.alternator'

CREATE INDEX idx_angle_path ON vehicle_images USING gin(to_tsvector('simple', angle_path));
```

### Option 3: JSONB for Maximum Flexibility
```sql
ALTER TABLE vehicle_images
ADD COLUMN angle_classification JSONB;

-- Store as:
{
  "area": "engine_bay",
  "view": "driver",
  "component": "alternator",
  "elevation": "eye_level",
  "distance": "medium",
  "full_path": "engine_bay.driver.alternator"
}

CREATE INDEX idx_angle_jsonb ON vehicle_images USING gin(angle_classification);
```

---

## Recommended Master Angle Categories

### 8 Top-Level Areas:

1. **exterior** - Full vehicle shots (front, rear, profile, quarter angles)
2. **engine_bay** - Everything under the hood
3. **interior** - Cabin, seats, dashboard, cargo areas
4. **undercarriage** - Frame, suspension, exhaust, underside
5. **wheels** - Wheel wells, tires, brakes, calipers
6. **body** - Panels, doors, lights, trim, badges
7. **documents** - VINs, title, registration, receipts, manuals
8. **damage** - Rust, dents, scratches, repair documentation

### Standard Views (apply to all areas):

- `full` - Complete view of area
- `driver` / `passenger` - Side-specific view
- `front` / `rear` - Longitudinal view
- `top` - Overhead view
- `detail` - Macro/closeup shot
- `overview` - Wide-angle context shot
- `quarter` - 45° angle
- `straight` - 90° perpendicular

---

## Migration Strategy

1. **Don't break existing system** - Keep current `angle_family` column
2. **Add new hierarchical column** alongside existing one
3. **Backfill gradually** using Edge Function
4. **Update AI classification** to return hierarchical format
5. **Deprecate old column** after 6 months

```sql
-- Step 1: Add new column
ALTER TABLE vehicle_images ADD COLUMN angle_path TEXT;

-- Step 2: Backfill from existing data
UPDATE vehicle_images 
SET angle_path = 
  CASE 
    WHEN angle_family = 'engine_bay_full' THEN 'engine_bay.full.overview'
    WHEN angle_family = 'engine_bay_driver' THEN 'engine_bay.driver.overview'
    WHEN angle_family = 'battery' THEN 'engine_bay.top.battery'
    -- ... etc
  END;

-- Step 3: Create indexes
CREATE INDEX idx_angle_path ON vehicle_images(angle_path);
CREATE INDEX idx_angle_path_pattern ON vehicle_images(angle_path text_pattern_ops);
```

---

## Summary

**What AI button does:**
- AWS Rekognition object detection → AI-generated tags with confidence scores

**Current system:**
- ✅ Already has 120+ granular angles including 10 specific engine bay categories
- ✅ Distinguishes `engine_bay_full` from `battery` from `alternator`
- ❌ Flat structure makes hierarchical queries difficult

**Recommendation:**
- Adopt dot-notation hierarchy: `area.view.component`
- Add alongside existing system (don't break it)
- Enables powerful pattern matching: `engine_bay.*`, `*.battery`, `engine_bay.driver.*`
- Future-proof for adding new categories

Your instinct was right - but your system already has the granular angles! The issue is **organization and queryability**, not lack of detail.

