# Angle Standardization Strategy: Cross-Vehicle Comparison

## The Core Goal

**Enable queries like:**
- "Show me driver-side engine bay shots from every Bronco in the database"
- "Compare front 3/4 passenger angles across all my vehicles"
- "Find all vehicles with battery closeup shots"
- "Generate appraisal photo checklist based on existing coverage"

This requires **strict standardization** - not just organization.

---

## Critical Requirements

### 1. Controlled Vocabulary (Enum)
**Problem:** Free-form text leads to drift
- One user: `engine_bay_driver`
- Another user: `engine_drivers_side`
- AI: `engine_bay_driver_side`
- Result: Can't compare across vehicles

**Solution:** Database-enforced enum

```sql
CREATE TYPE vehicle_angle_standard AS ENUM (
  -- EXTERIOR FULL (17)
  'exterior.front.straight',
  'exterior.front_quarter.driver',
  'exterior.front_quarter.passenger',
  'exterior.front_three_quarter.driver',
  'exterior.front_three_quarter.passenger',
  'exterior.rear.straight',
  'exterior.rear_quarter.driver',
  'exterior.rear_quarter.passenger',
  'exterior.rear_three_quarter.driver',
  'exterior.rear_three_quarter.passenger',
  'exterior.side.driver',
  'exterior.side.passenger',
  'exterior.profile.driver',
  'exterior.profile.passenger',
  'exterior.top.overhead',
  'exterior.corner.front',
  'exterior.corner.rear',
  
  -- ENGINE BAY (10)
  'engine.bay.full',
  'engine.bay.driver_side',
  'engine.bay.passenger_side',
  'engine.bay.front',
  'engine.bay.top_down',
  'engine.component.battery',
  'engine.component.alternator',
  'engine.component.radiator',
  'engine.component.air_intake',
  'engine.component.exhaust_manifold',
  'engine.component.firewall',
  
  -- INTERIOR (14)
  'interior.dash.full',
  'interior.dash.driver',
  'interior.dash.passenger',
  'interior.console.center',
  'interior.steering.wheel',
  'interior.seat.driver',
  'interior.seat.passenger',
  'interior.seat.rear',
  'interior.ceiling.headliner',
  'interior.floor.carpet',
  'interior.door.driver',
  'interior.door.passenger',
  'interior.door.rear',
  'interior.cargo.area',
  
  -- UNDERCARRIAGE (12)
  'undercarriage.full.center',
  'undercarriage.front.center',
  'undercarriage.rear.center',
  'undercarriage.side.driver',
  'undercarriage.side.passenger',
  'undercarriage.frame.driver_front',
  'undercarriage.frame.driver_rear',
  'undercarriage.frame.passenger_front',
  'undercarriage.frame.passenger_rear',
  'undercarriage.suspension.front',
  'undercarriage.suspension.rear',
  'undercarriage.exhaust.system',
  
  -- WHEELS (8)
  'wheel.well.driver_front',
  'wheel.well.driver_rear',
  'wheel.well.passenger_front',
  'wheel.well.passenger_rear',
  'wheel.tire.closeup',
  'wheel.brake.caliper',
  'wheel.brake.rotor',
  'wheel.assembly.full',
  
  -- BODY PANELS (20)
  'body.door.driver_full',
  'body.door.passenger_full',
  'body.door.jamb_driver',
  'body.door.jamb_passenger',
  'body.light.headlight_driver',
  'body.light.headlight_passenger',
  'body.light.taillight_driver',
  'body.light.taillight_passenger',
  'body.bumper.front',
  'body.bumper.rear',
  'body.panel.hood',
  'body.panel.trunk',
  'body.panel.tailgate',
  'body.fender.driver_front',
  'body.fender.driver_rear',
  'body.fender.passenger_front',
  'body.fender.passenger_rear',
  'body.trim.grille',
  'body.badge.front',
  'body.badge.rear',
  
  -- DOCUMENTS (8)
  'document.vin.door_jamb',
  'document.vin.dashboard',
  'document.vin.frame',
  'document.vin.engine',
  'document.title.front',
  'document.title.back',
  'document.registration.current',
  'document.receipt.work_order',
  
  -- DAMAGE (6)
  'damage.rust.location',
  'damage.dent.location',
  'damage.scratch.location',
  'damage.paint.defect',
  'damage.crack.location',
  'damage.general.overview'
);

ALTER TABLE vehicle_images 
  ALTER COLUMN angle TYPE vehicle_angle_standard USING angle::vehicle_angle_standard;
```

---

## 2. Photography Standards Guide

Each angle needs a **canonical definition** with reference image:

### Example: `exterior.front_three_quarter.driver`

**Definition:**
- Camera positioned 45° to the left of vehicle centerline
- Shooting towards the front-left corner
- Elevation: Eye level (4-5 feet)
- Distance: Full vehicle in frame with 10% margin
- Focal length: 35-50mm equivalent
- Shows: Front grille, driver headlight, driver fender, driver door, front wheel

**Reference Image:** `docs/photo_standards/exterior_front_three_quarter_driver.jpg`

**Use Cases:**
- Appraisal documentation
- Sale listings
- Condition comparison over time
- Cross-vehicle comparison

**AI Confidence Threshold:** 75% minimum

---

## 3. Database Schema for Comparison

```sql
-- Strict angle tracking with comparison metadata
CREATE TABLE vehicle_images (
  id UUID PRIMARY KEY,
  vehicle_id UUID NOT NULL,
  angle vehicle_angle_standard NOT NULL,  -- Enforced enum
  
  -- Classification confidence
  angle_confidence INTEGER CHECK (angle_confidence >= 0 AND angle_confidence <= 100),
  angle_verified_by UUID REFERENCES profiles(id),
  angle_verified_at TIMESTAMPTZ,
  
  -- Comparison metadata
  is_canonical_reference BOOLEAN DEFAULT FALSE,  -- This is a "perfect" example
  comparison_quality_score INTEGER,              -- How good for cross-vehicle comparison
  
  -- Technical parameters (for precise matching)
  camera_elevation_degrees INTEGER,              -- Actual camera angle
  camera_azimuth_degrees INTEGER,                -- Compass direction
  camera_distance_meters DECIMAL(5,2),
  focal_length_mm INTEGER,
  
  -- Lighting conditions (affects comparability)
  lighting_type TEXT CHECK (lighting_type IN ('natural_overcast', 'natural_sunny', 'studio', 'mixed', 'night')),
  lighting_quality_score INTEGER,
  
  -- Image quality
  resolution_megapixels DECIMAL(4,2),
  sharpness_score INTEGER,
  exposure_quality INTEGER,
  
  -- Searchability
  angle_tags TEXT[],                             -- ['full_vehicle', 'exterior', 'driver_side']
  visible_features TEXT[],                       -- ['headlight', 'grille', 'fender', 'door']
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cross-vehicle comparison
CREATE INDEX idx_angle_comparison 
  ON vehicle_images(angle, comparison_quality_score DESC) 
  WHERE angle_verified_at IS NOT NULL;

-- Find all comparable images of specific angle
CREATE INDEX idx_angle_lookup 
  ON vehicle_images(angle, vehicle_id);
```

---

## 4. Comparison Quality Scoring

Not all images of the same "angle" are equally comparable:

```typescript
interface ComparisonQuality {
  angle_match: number;        // 0-100: How well does it match the standard?
  lighting_match: number;     // 0-100: Consistent lighting?
  framing_match: number;      // 0-100: Similar framing/crop?
  resolution_sufficient: boolean;
  occlusions_present: boolean;  // People, tools blocking view?
  overall_score: number;      // Weighted average
}

// Examples:
{
  angle: 'exterior.front_three_quarter.driver',
  angle_match: 95,           // Nearly perfect angle
  lighting_match: 80,        // Overcast vs sunny, but acceptable
  framing_match: 90,         // Full vehicle, good margins
  resolution_sufficient: true,
  occlusions_present: false,
  overall_score: 88          // High quality for comparison
}

{
  angle: 'exterior.front_three_quarter.driver',
  angle_match: 70,           // Slightly off angle
  lighting_match: 40,        // Night shot vs day reference
  framing_match: 60,         // Too tight crop
  resolution_sufficient: true,
  occlusions_present: true,  // Person standing in front
  overall_score: 52          // Marginal for comparison
}
```

---

## 5. Cross-Vehicle Query Patterns

```sql
-- Find all Broncos with driver engine bay shots (sorted by quality)
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  vi.storage_url,
  vi.comparison_quality_score,
  vi.created_at
FROM vehicle_images vi
JOIN vehicles v ON vi.vehicle_id = v.id
WHERE 
  vi.angle = 'engine.bay.driver_side'
  AND v.make = 'Ford'
  AND v.model = 'Bronco'
  AND vi.angle_confidence >= 75
  AND vi.comparison_quality_score >= 70
ORDER BY vi.comparison_quality_score DESC;

-- Compare specific vehicle to fleet average
WITH vehicle_angles AS (
  SELECT angle, COUNT(*) as coverage
  FROM vehicle_images
  WHERE vehicle_id = '12345'
  AND angle_confidence >= 75
  GROUP BY angle
),
fleet_angles AS (
  SELECT angle, COUNT(DISTINCT vehicle_id) as vehicle_count
  FROM vehicle_images
  WHERE angle_confidence >= 75
  GROUP BY angle
)
SELECT 
  fa.angle,
  fa.vehicle_count as "vehicles_with_angle",
  CASE WHEN va.coverage > 0 THEN 'YES' ELSE 'NO' END as "this_vehicle_has"
FROM fleet_angles fa
LEFT JOIN vehicle_angles va ON fa.angle = va.angle
ORDER BY fa.vehicle_count DESC;

-- Find vehicles missing standard documentation angles
SELECT v.id, v.year, v.make, v.model
FROM vehicles v
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_images vi
  WHERE vi.vehicle_id = v.id
  AND vi.angle = 'exterior.front_three_quarter.driver'
  AND vi.angle_confidence >= 75
);

-- Side-by-side comparison grid
SELECT 
  v1.id as vehicle_1,
  v2.id as vehicle_2,
  array_agg(DISTINCT vi1.angle) as shared_angles
FROM vehicles v1
CROSS JOIN vehicles v2
JOIN vehicle_images vi1 ON vi1.vehicle_id = v1.id
JOIN vehicle_images vi2 ON vi2.vehicle_id = v2.id
WHERE 
  v1.id < v2.id  -- Avoid duplicates
  AND vi1.angle = vi2.angle
  AND vi1.angle_confidence >= 75
  AND vi2.angle_confidence >= 75
GROUP BY v1.id, v2.id
HAVING COUNT(DISTINCT vi1.angle) >= 10  -- At least 10 matching angles
ORDER BY COUNT(DISTINCT vi1.angle) DESC;
```

---

## 6. AI Classification Enhancement

Update the AI to return **strict standard angles only**:

```typescript
// Edge Function: classify-image-angle
interface AngleClassification {
  angle: VehicleAngleStandard;  // Must match enum
  confidence: number;            // 0-100
  
  // Why this angle?
  reasoning: {
    features_visible: string[];
    camera_position: string;
    elevation_estimate: number;
    azimuth_estimate: number;
  };
  
  // Comparison suitability
  comparison_quality: {
    angle_match: number;
    lighting_match: number;
    framing_match: number;
    occlusions_present: boolean;
    overall_score: number;
  };
  
  // Alternative interpretations
  alternative_angles?: Array<{
    angle: VehicleAngleStandard;
    confidence: number;
    reason: string;
  }>;
}

// Example result:
{
  angle: 'engine.bay.driver_side',
  confidence: 87,
  reasoning: {
    features_visible: ['alternator', 'battery', 'engine_block_driver', 'fender_well'],
    camera_position: 'standing_left_of_vehicle',
    elevation_estimate: 65,
    azimuth_estimate: 90
  },
  comparison_quality: {
    angle_match: 90,
    lighting_match: 85,
    framing_match: 80,
    occlusions_present: false,
    overall_score: 85
  },
  alternative_angles: [
    {
      angle: 'engine.bay.full',
      confidence: 60,
      reason: 'Could be interpreted as full bay if cropped differently'
    }
  ]
}
```

---

## 7. Reference Library & Validation

Create a canonical reference library:

```sql
CREATE TABLE angle_reference_library (
  id UUID PRIMARY KEY,
  angle vehicle_angle_standard NOT NULL UNIQUE,
  
  -- Reference materials
  canonical_image_id UUID REFERENCES vehicle_images(id),
  description TEXT NOT NULL,
  photography_guide TEXT,
  
  -- Technical specifications
  ideal_elevation_degrees INTEGER,
  ideal_azimuth_degrees INTEGER,
  ideal_distance_meters DECIMAL(5,2),
  ideal_focal_length_mm INTEGER,
  
  -- Acceptable variance
  elevation_tolerance_degrees INTEGER DEFAULT 10,
  azimuth_tolerance_degrees INTEGER DEFAULT 15,
  
  -- Use case metadata
  use_cases TEXT[],
  required_for_appraisal BOOLEAN DEFAULT FALSE,
  difficulty_level TEXT CHECK (difficulty_level IN ('basic', 'intermediate', 'advanced', 'professional')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with standards
INSERT INTO angle_reference_library (angle, description, ideal_elevation_degrees, ideal_azimuth_degrees, required_for_appraisal) VALUES
('exterior.front_three_quarter.driver', 'Driver front 3/4 view showing grille, driver headlight, driver fender, and driver door', 0, 45, true),
('exterior.front_three_quarter.passenger', 'Passenger front 3/4 view showing grille, passenger headlight, passenger fender, and passenger door', 0, 315, true),
('engine.bay.driver_side', 'Driver side engine bay showing alternator, battery, and driver-side accessories', 65, 90, true),
('engine.bay.passenger_side', 'Passenger side engine bay showing intake, belts, and passenger-side accessories', 65, 270, true);
```

---

## 8. Photography Checklist Feature

Generate standardized checklists:

```typescript
// Get recommended angles for vehicle type
async function getPhotoChecklist(vehicleId: string): Promise<PhotoChecklist> {
  const vehicle = await getVehicle(vehicleId);
  const existingAngles = await getExistingAngles(vehicleId);
  
  const standardAngles = await db.query(`
    SELECT 
      angle,
      description,
      required_for_appraisal,
      difficulty_level
    FROM angle_reference_library
    WHERE 
      required_for_appraisal = true
      OR angle IN (
        SELECT angle FROM vehicle_images 
        WHERE vehicle_id IN (
          SELECT id FROM vehicles 
          WHERE make = $1 AND model = $2
          LIMIT 100
        )
        GROUP BY angle
        HAVING COUNT(*) > 10
      )
  `, [vehicle.make, vehicle.model]);
  
  return {
    required: standardAngles.filter(a => a.required_for_appraisal),
    recommended: standardAngles.filter(a => !a.required_for_appraisal),
    completed: existingAngles,
    missing: standardAngles.filter(a => !existingAngles.includes(a.angle)),
    completeness_pct: (existingAngles.length / standardAngles.length) * 100
  };
}
```

---

## 9. Migration Path

```sql
-- Step 1: Create enum
CREATE TYPE vehicle_angle_standard AS ENUM (...);

-- Step 2: Add new column alongside existing
ALTER TABLE vehicle_images 
  ADD COLUMN angle_standard vehicle_angle_standard,
  ADD COLUMN angle_confidence INTEGER,
  ADD COLUMN comparison_quality_score INTEGER;

-- Step 3: Backfill with mapping function
CREATE FUNCTION migrate_angle_to_standard(old_angle TEXT) RETURNS vehicle_angle_standard AS $$
BEGIN
  RETURN CASE old_angle
    WHEN 'engine_bay_full' THEN 'engine.bay.full'::vehicle_angle_standard
    WHEN 'engine_bay_driver' THEN 'engine.bay.driver_side'::vehicle_angle_standard
    WHEN 'battery' THEN 'engine.component.battery'::vehicle_angle_standard
    -- ... rest of mappings
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql;

UPDATE vehicle_images 
SET angle_standard = migrate_angle_to_standard(angle_family);

-- Step 4: Create reference library
INSERT INTO angle_reference_library ...

-- Step 5: Run AI re-classification with new standards
-- (Gradually backfill confidence scores)

-- Step 6: After validation period, make angle_standard NOT NULL
ALTER TABLE vehicle_images ALTER COLUMN angle_standard SET NOT NULL;

-- Step 7: Deprecate old column
ALTER TABLE vehicle_images DROP COLUMN angle_family;
```

---

## Summary: Cross-Vehicle Comparison Strategy

**Core Principle:** Strict standardization enables fleet-wide queries

**Key Changes:**
1. ✅ **Enum-enforced vocabulary** - No drift, perfect matching
2. ✅ **Canonical reference library** - Every angle has a standard definition
3. ✅ **Comparison quality scoring** - Filter for truly comparable shots
4. ✅ **Photography standards** - Document what each angle should look like
5. ✅ **Cross-vehicle indexes** - Optimized for "show me all X" queries

**Query Patterns Unlocked:**
- Find all vehicles missing specific angles
- Compare angle coverage across fleet
- Generate standardized photography checklists
- Build training sets for ML
- Create appraisal comparison grids
- Track documentation completeness

The dot-notation provides **semantic meaning**, the enum provides **standardization**, and the quality scoring provides **comparability filtering**.

