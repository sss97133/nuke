# Image Analysis 3D Coordinate System

> **Status**: Core system built and tested. Cost optimization needed before scale deployment.
> **Last Updated**: December 29, 2025

## Table of Contents
1. [Overview](#overview)
2. [What Was Built](#what-was-built)
3. [Database Schema](#database-schema)
4. [How It Works](#how-it-works)
5. [Current State](#current-state)
6. [Cost Problem](#cost-problem)
7. [Solution: Gemini Flash](#solution-gemini-flash)
8. [Implementation Plan](#implementation-plan)
9. [Code References](#code-references)
10. [Example Queries](#example-queries)

---

## Overview

A 3D coordinate system for vehicle image analysis that provides:
- **Precise subject identification** using hierarchical taxonomy (e.g., `exterior.panel.fender.rear.passenger`)
- **3D camera position** relative to vehicle center (0,0,0)
- **Spherical coordinates** (azimuth, elevation, distance)
- **Cartesian coordinates** (X, Y, Z in millimeters)
- **Observation-based consensus** - multiple analysis attempts build confidence over time

### The Goal
Enable specific search queries like:
```sql
-- "Show me 100 close-ups of where the fender and hood meet on 73-80 squarebodies, organized by color"
SELECT vi.*, v.year, v.color
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
JOIN image_camera_position icp ON icp.image_id = vi.id
WHERE icp.subject_key LIKE 'exterior.panel.fender%'
  AND icp.distance_mm < 1000  -- close up
  AND v.year BETWEEN 1973 AND 1980
  AND v.body_style = 'squarebody'
ORDER BY v.color
LIMIT 100;
```

---

## What Was Built

### 1. Subject Taxonomy
Hierarchical naming system for what's being photographed:

```
vehicle                          # Full vehicle shot
exterior.panel.fender.front.driver
exterior.panel.fender.front.passenger
exterior.panel.fender.rear.driver
exterior.panel.fender.rear.passenger
exterior.panel.door.front.driver
exterior.panel.door.front.passenger
exterior.panel.hood
exterior.panel.trunk
exterior.bumper.front
exterior.bumper.rear
exterior.wheel.front.driver
exterior.wheel.rear.passenger
exterior.trim.grille
exterior.light.headlight.driver
exterior.glass.windshield
interior.dashboard
interior.dashboard.gauges
interior.seat.front.driver
interior.steering.wheel
engine.bay
engine.block
undercarriage.frame.front
undercarriage.suspension.front
undercarriage.exhaust
damage.dent
damage.scratch
damage.rust
document.vin_tag
document.spid_sheet
```

### 2. Coordinate System

**Origin (0,0,0)**: Center of vehicle based on factory Length × Width × Height

**Axes**:
- **X-axis**: Positive = passenger side, Negative = driver side
- **Y-axis**: Positive = front of vehicle, Negative = rear
- **Z-axis**: Positive = up, Negative = down (ground ≈ -700mm from vehicle center)

**Spherical Coordinates** (how AI reports camera position):
- `azimuth_deg`: 0° = front, 90° = driver side, 180° = rear, 270° = passenger side
- `elevation_deg`: 0° = level with vehicle center, positive = above, negative = below
- `distance_mm`: Distance from vehicle center to camera

**Cartesian Coordinates** (calculated from spherical):
- `camera_x_mm`, `camera_y_mm`, `camera_z_mm`: Exact camera position

### 3. Observation-Based Consensus
Multiple analyses of the same image are stored as separate observations. Consensus is built through weighted averaging based on confidence scores.

---

## Database Schema

### Primary Tables

#### `image_camera_position`
Stores 3D camera position for each image analysis.

```sql
CREATE TABLE image_camera_position (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id),
  vehicle_id UUID REFERENCES vehicles(id),
  
  -- Subject identification
  subject_key TEXT NOT NULL,  -- e.g., 'exterior.panel.fender.rear.passenger'
  
  -- Camera position (Cartesian, in mm from vehicle center)
  camera_x_mm NUMERIC,
  camera_y_mm NUMERIC,
  camera_z_mm NUMERIC,
  
  -- Camera position (Spherical)
  azimuth_deg NUMERIC,      -- 0-360°
  elevation_deg NUMERIC,    -- -90 to 90°
  distance_mm NUMERIC,      -- mm from vehicle center
  
  -- Subject position (where the subject is relative to vehicle center)
  subject_x_mm NUMERIC,
  subject_y_mm NUMERIC,
  subject_z_mm NUMERIC,
  
  -- Metadata
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL,           -- 'analyze-image', 'label_derived', 'human'
  source_version TEXT DEFAULT 'v1',
  evidence JSONB,                 -- Raw AI output, reasoning
  observed_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `vehicle_images.ai_scan_metadata`
JSONB field storing full analysis results:

```json
{
  "appraiser": {
    "category": "exterior",
    "subject": "exterior.panel.fender.rear.passenger",
    "secondary_subjects": [],
    "description": "Close-up of the rear passenger fender with measuring tape",
    "camera_position": {
      "azimuth_deg": 270,
      "elevation_deg": 0,
      "distance_mm": 500,
      "confidence": 0.8
    },
    "subject_position": {
      "x_mm": 500,
      "y_mm": -300,
      "z_mm": 0
    },
    "is_close_up": true,
    "visible_damage": false,
    "condition_notes": "Fender in good condition",
    "visible_components": ["paint", "metal panel"],
    "_usage": { "total_tokens": 26574 },
    "_cost_usd": 0.004068,
    "_model": "gpt-4o-mini"
  }
}
```

### Supporting Tables

#### `subject_taxonomy`
Master list of photographable subjects.

#### `subject_position_templates`
Default positions for subjects relative to vehicle center (e.g., driver front wheel is at X=-900, Y=1200, Z=-350).

#### `vehicle_reference_frame`
Factory dimensions (L×W×H) for vehicles to establish accurate 0,0,0 origin.

#### `angle_coordinate_defaults`
Maps old simple labels to approximate coordinates for migration.

---

## How It Works

### Analysis Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. IMAGE SUBMITTED                                         │
│     - image_url, vehicle_id, image_id                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. AWS REKOGNITION (Label Detection)                       │
│     - Detects: Car, Wheel, Engine, etc.                     │
│     - Provides bounding boxes                               │
│     - Cost: ~$0.001/image                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. OPENAI VISION (Appraiser Brain)                         │
│     - Identifies precise subject                            │
│     - Estimates camera position (spherical)                 │
│     - Generates description                                 │
│     - Cost: ~$0.004/image (GPT-4o-mini)                     │
│     - Cost: ~$0.0001/image (Gemini Flash) ← TARGET          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. COORDINATE CALCULATION                                  │
│     - Spherical → Cartesian conversion                      │
│     - Store in image_camera_position table                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. DATABASE UPDATE                                         │
│     - vehicle_images.ai_scan_metadata (full JSON)           │
│     - vehicle_images.ai_detected_angle (simple label)       │
│     - image_camera_position (structured 3D data)            │
└─────────────────────────────────────────────────────────────┘
```

### Coordinate Conversion

Spherical to Cartesian:
```sql
-- Given: azimuth_deg, elevation_deg, distance_mm
x_mm = distance_mm * cos(elevation_rad) * sin(azimuth_rad)
y_mm = -distance_mm * cos(elevation_rad) * cos(azimuth_rad)  -- negative because 0° is front
z_mm = distance_mm * sin(elevation_rad)
```

SQL function: `spherical_to_cartesian(p_azimuth_deg, p_elevation_deg, p_distance_mm)`

---

## Current State

### What's Working ✅
- [x] 3D coordinate schema and tables created
- [x] Subject taxonomy populated
- [x] `analyze-image` function updated with unified prompt
- [x] Spherical/Cartesian conversion functions
- [x] Camera position storage in `image_camera_position`
- [x] OpenAI API integration fixed (key was stale)
- [x] Tested on 10 images with good results
- [x] Deprecated duplicate functions (tier1, tier2, contextual)

### Sample Results (1983 GMC C10)

| Subject | Azimuth | Elevation | Distance | Camera XYZ (mm) | Confidence |
|---------|---------|-----------|----------|-----------------|------------|
| `exterior.panel.fender.rear.driver` | 90° | 0° | 1500mm | (-1500, 0, 0) | 85% |
| `exterior.trim.grille` | 0° | 10° | 1000mm | (0, -985, 174) | 80% |
| `undercarriage.suspension.front` | 0° | -30° | 900mm | (0, -779, -450) | 85% |
| `vehicle` (full shot) | 180° | 0° | 3000mm | (0, 3000, 0) | 80% |
| `interior.dashboard` | 0° | -10° | 800mm | (0, -788, -139) | 85% |

### What's NOT Done ❌
- [ ] Cost optimization (currently $0.004/image)
- [ ] Batch processing for all 334k images
- [ ] Frontend updated to display new fields
- [ ] CLIP embeddings for similarity search
- [ ] Color detection integration

---

## Cost Problem

### Current Costs
| Model | Cost/Image | 334k Images | Accuracy |
|-------|------------|-------------|----------|
| GPT-4o-mini (current) | $0.0040 | **$1,336** | ⭐⭐⭐⭐⭐ |

### Why So Expensive?
- GPT-4o-mini vision encodes images as ~25,000 tokens
- Plus prompt (~1,000 tokens) and response (~200 tokens)
- Total: ~26,000 tokens × $0.00015/1k = $0.004/image

---

## Solution: Gemini Flash

### Cost Comparison
| Model | Cost/Image | 334k Images | Accuracy |
|-------|------------|-------------|----------|
| GPT-4o-mini | $0.0040 | $1,336 | ⭐⭐⭐⭐⭐ |
| **Gemini 1.5 Flash** | **$0.0001** | **$33** | ⭐⭐⭐⭐ |
| Gemini 1.5 Pro | $0.0005 | $167 | ⭐⭐⭐⭐⭐ |

### Gemini Flash Pricing
- Input: $0.075 per 1M tokens (images count as ~250 tokens)
- Output: $0.30 per 1M tokens
- Effective cost: ~$0.0001/image (40x cheaper than GPT)

### Same Output Format
Gemini can return the exact same JSON structure:
```json
{
  "category": "exterior",
  "subject": "exterior.panel.fender.rear.passenger",
  "camera_position": {
    "azimuth_deg": 270,
    "elevation_deg": 0,
    "distance_mm": 500,
    "confidence": 0.8
  },
  ...
}
```

---

## Implementation Plan

### Phase 1: Gemini Integration (Priority)
1. Add Gemini API key to Supabase secrets
2. Create `runAppraiserBrainGemini()` function
3. A/B test against GPT on 100 images
4. If quality acceptable, switch default to Gemini

### Phase 2: Batch Processing
1. Create queue table for pending images
2. Process in batches of 100 with rate limiting
3. Track progress and costs
4. Estimated time: 334k images ÷ 100/min = 56 hours

### Phase 3: Frontend Integration
1. Update image info display to show new fields
2. Add search/filter by subject, angle, distance
3. Add 3D visualization (optional)

### Phase 4: Advanced Features (Future)
1. CLIP embeddings for similarity search
2. Color detection from Rekognition
3. Damage severity scoring
4. Coverage gap analysis

---

## Code References

### Main Analysis Function
`supabase/functions/analyze-image/index.ts`

Key sections:
- `runAppraiserBrain()` - OpenAI Vision call (line ~811)
- `insertCameraPosition()` - Save to database (line ~300)
- Unified prompt with coordinate system (line ~866)

### Database Functions
- `spherical_to_cartesian(azimuth, elevation, distance)` - Convert coordinates
- `cartesian_to_spherical(x, y, z)` - Reverse conversion
- `get_camera_position_relative_to_vehicle(subject_key, x, y, z)` - Transform subject-relative to vehicle-relative

### Migrations
- `20250128000008_observation_based_coordinates.sql` - Core coordinate tables
- `20250128000009_subject_centric_coordinate_system.sql` - Subject taxonomy
- `20250128000010_subject_coordinate_functions.sql` - Conversion functions

---

## Example Queries

### Find all close-up fender shots
```sql
SELECT vi.image_url, icp.subject_key, icp.distance_mm
FROM vehicle_images vi
JOIN image_camera_position icp ON icp.image_id = vi.id
WHERE icp.subject_key LIKE 'exterior.panel.fender%'
  AND icp.distance_mm < 1000
  AND icp.confidence > 0.7
ORDER BY icp.distance_mm;
```

### Find images by camera angle
```sql
-- All rear shots (camera behind vehicle)
SELECT * FROM image_camera_position
WHERE azimuth_deg BETWEEN 160 AND 200
  AND confidence > 0.7;

-- All overhead shots
SELECT * FROM image_camera_position
WHERE elevation_deg > 45
  AND confidence > 0.7;
```

### Coverage analysis for a vehicle
```sql
SELECT 
  subject_key,
  COUNT(*) as image_count,
  AVG(confidence) as avg_confidence
FROM image_camera_position
WHERE vehicle_id = 'a90c008a-3379-41d8-9eb2-b4eda365d74c'
  AND confidence > 0.5
GROUP BY subject_key
ORDER BY image_count DESC;
```

### Find similar shots across vehicles
```sql
-- Find all front grille close-ups across all vehicles
SELECT 
  v.year, v.make, v.model,
  vi.image_url,
  icp.azimuth_deg, icp.elevation_deg, icp.distance_mm
FROM image_camera_position icp
JOIN vehicle_images vi ON vi.id = icp.image_id
JOIN vehicles v ON v.id = icp.vehicle_id
WHERE icp.subject_key = 'exterior.trim.grille'
  AND icp.distance_mm < 1500
  AND icp.confidence > 0.7
ORDER BY v.year, v.make;
```

---

## Next Steps

1. ~~**Get Gemini API key** and add to Supabase secrets~~ ✅ Done (`free_api_key`)
2. ~~**Implement Gemini integration** in analyze-image function~~ ✅ Done
3. **Fix Gemini model name** - See `docs/GEMINI_INTEGRATION_STATUS.md`
4. **Test on 100 images** and compare quality to GPT
5. **Run batch processing** on all 334k images (~$33)
6. **Update frontend** to display new fields

---

## Appendix: Full Subject Taxonomy

```
vehicle
exterior.panel.fender.front.driver
exterior.panel.fender.front.passenger
exterior.panel.fender.rear.driver
exterior.panel.fender.rear.passenger
exterior.panel.door.front.driver
exterior.panel.door.front.passenger
exterior.panel.door.rear.driver
exterior.panel.door.rear.passenger
exterior.panel.quarter.driver
exterior.panel.quarter.passenger
exterior.panel.hood
exterior.panel.trunk
exterior.panel.tailgate
exterior.panel.roof
exterior.panel.rocker.driver
exterior.panel.rocker.passenger
exterior.bumper.front
exterior.bumper.rear
exterior.wheel.front.driver
exterior.wheel.front.passenger
exterior.wheel.rear.driver
exterior.wheel.rear.passenger
exterior.light.headlight.driver
exterior.light.headlight.passenger
exterior.light.taillight.driver
exterior.light.taillight.passenger
exterior.light.marker
exterior.light.fog
exterior.glass.windshield
exterior.glass.rear
exterior.glass.side.driver.front
exterior.glass.side.driver.rear
exterior.glass.side.passenger.front
exterior.glass.side.passenger.rear
exterior.mirror.driver
exterior.mirror.passenger
exterior.trim.grille
exterior.trim.molding
exterior.trim.chrome
exterior.badge
exterior.emblem
interior.dashboard
interior.dashboard.gauges
interior.dashboard.center_stack
interior.dashboard.glove_box
interior.seat.front.driver
interior.seat.front.passenger
interior.seat.rear
interior.door.panel.front.driver
interior.door.panel.front.passenger
interior.door.panel.rear.driver
interior.door.panel.rear.passenger
interior.console.center
interior.console.shifter
interior.steering.wheel
interior.steering.column
interior.headliner
interior.carpet.front
interior.carpet.rear
interior.trunk
engine.bay
engine.block
engine.intake
engine.exhaust.manifold
engine.alternator
engine.carburetor
engine.air_cleaner
engine.valve_cover
engine.radiator
engine.fan
undercarriage.frame.front
undercarriage.frame.center
undercarriage.frame.rear
undercarriage.suspension.front
undercarriage.suspension.rear
undercarriage.exhaust
undercarriage.exhaust.muffler
undercarriage.exhaust.catalytic
undercarriage.floor.front
undercarriage.floor.rear
undercarriage.fuel_tank
undercarriage.driveshaft
undercarriage.differential
damage.dent
damage.scratch
damage.rust
damage.crack
damage.tear
damage.stain
damage.fade
document.vin_tag
document.spid_sheet
document.title
document.registration
document.window_sticker
```

