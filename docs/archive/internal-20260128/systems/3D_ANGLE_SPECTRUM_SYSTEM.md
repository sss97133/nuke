# 3D Angle Spectrum System

## Overview

Combines **precise X,Y,Z coordinates** with **named zones** for both specificity and generalization.

## Coordinate System

### X-Axis (Azimuth): Left-Right
- **-90°**: Driver side (left)
- **0°**: Center
- **+90°**: Passenger side (right)

### Y-Axis (Elevation): Front-Rear
- **-90°**: Front
- **0°**: Side
- **+90°**: Rear

### Z-Axis (Height): Ground-Overhead
- **0°**: Ground level
- **30°**: Eye level
- **60°**: High elevation
- **90°**: Overhead/directly above

## Named Zones

Zones are **coordinate ranges** that map to named sections:

### Example: `front_three_quarter_driver_zone`
- **X**: -90° to -45° (driver side)
- **Y**: -45° to -15° (front three-quarter)
- **Z**: 0° to 30° (ground to low elevation)

**Result**: Any angle with coordinates in this range gets assigned to this zone, but we also store the **precise coordinates**.

## Usage

### Record Precise Angle
```sql
SELECT record_angle_observation(
  'image-id',
  'vehicle-id',
  -60,  -- X: Driver side
  -30,  -- Y: Front three-quarter
  15,   -- Z: Low elevation
  5.0,  -- Distance: 5 meters
  0.85, -- Confidence: 85%
  'ai', -- Source
  'gpt-4o', -- Model
  '{"features": ["grille", "headlight", "fender"]}'::jsonb
);
```

**Automatically:**
- Determines zone: `front_three_quarter_driver_zone`
- Maps to canonical angle: `exterior.front_three_quarter.driver`
- Stores precise coordinates: (-60, -30, 15)

### Query by Zone (General)
```sql
SELECT * FROM angle_spectrum_view
WHERE zone_name = 'front_three_quarter_driver_zone';
```

### Query by Precise Coordinates (Specific)
```sql
SELECT * FROM angle_spectrum_view
WHERE x_coordinate BETWEEN -65 AND -55
  AND y_coordinate BETWEEN -35 AND -25
  AND z_coordinate BETWEEN 10 AND 20;
```

### Query Similar Angles (Within Range)
```sql
SELECT * FROM angle_spectrum_view
WHERE 
  ABS(x_coordinate - -60) < 10  -- Within 10° on X axis
  AND ABS(y_coordinate - -30) < 10
  AND ABS(z_coordinate - 15) < 10;
```

## Benefits

1. **Very Specific**: Precise X,Y,Z coordinates for exact positioning
2. **Generalizable**: Named zones for "all front three-quarter driver shots"
3. **Queryable**: Find similar angles by coordinate proximity
4. **Future-proof**: Add new zones without breaking existing data
5. **AI-Friendly**: AI can output coordinates, system maps to zones/angles

## Zone Definitions

Each zone has:
- **Coordinate ranges** (x_min, x_max, y_min, y_max, z_min, z_max)
- **Domain** (exterior, interior, engine, undercarriage)
- **Side applicability** (driver, passenger, both, none)
- **Typical use case** (appraisal, documentation, comparison)

## Migration Path

1. ✅ Create zone system
2. ⚠️ Update `analyze-image` to output X,Y,Z coordinates
3. ⚠️ Backfill existing angles by re-analyzing with coordinate detection
4. ⚠️ Map weak labels (`exterior_three_quarter`) to zones based on image analysis

