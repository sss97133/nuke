# YONO Vision Architecture
**This document is the source of truth. Read before touching any vision code.**
*This design has been discussed for months across many sessions — it is now codified here permanently.*

---

## The Coordinate System — 1"×1"×1" Vehicle Surface Grid

**The end state: every point on every vehicle surface has a precise address.**

A vehicle (~180"×72"×55") has ~40,000 sq inches of surface. The system addresses every square inch.

Coordinate format: `(U, V)` — surface coordinates in inches from a defined origin point per make/model.
3D volumetric: `(X, Y, Z)` — inches from front-center-ground origin.

**What this enables:**
- "Rust at surface coordinate (142.3", 18.7")" = rear passenger quarter panel, 18" from wheel arch
- Coverage map: which sq inches have been photographed? Which have damage?
- Damage reports precise enough for insurance/appraisal
- Before/after restoration: same coordinate, different condition scores

### How It Works (pipeline)

**Step 1: 3D Model** — vehicle geometry defining the coordinate space
- Source A: Generic make/model templates (we build/source per make/model year)
- Source B: COLMAP reconstruction from 10+ overlapping photos of same vehicle
- Source C (future): OEM CAD data

**Step 2: Camera Pose Estimation** — where was the camera for each image?
- Tool: COLMAP (Structure from Motion, open source)
- Input: 10+ photos of same vehicle
- Output: camera position + orientation (6DOF) for each image, sparse point cloud

**Step 3: Pixel-to-Surface Projection** — map image pixels to surface coordinates
- Given camera pose + 3D model: every pixel → (X, Y, Z) on vehicle surface
- "Rust in pixels (340,180)-(420,260)" → "rust at (142.3", 18.7", 24.1")"

**Step 4: Coverage Map** — per-vehicle heat map of surface coverage
- Which sq inches have been photographed?
- Which have damage? Modifications?
- Table: `vehicle_surface_coverage` with resolution buckets

### Resolution Levels (progressive)

| Level | Resolution | Achievable with |
|-------|-----------|-----------------|
| L0 | Zone (~40 named zones) | Single image, any photo |
| L1 | Region (6"×6" cells) | 3-5 overlapping images |
| L2 | Sub-region (2"×2" cells) | 10+ overlapping images + COLMAP |
| L3 | Inch (1"×1" cells) | Systematic photogrammetric capture |

**Today we implement L0. Architecture is designed for L3 from day one.**
Zone names are just human-readable aliases for coarse (U,V) ranges.

---

## What We're Building

A vehicle image intelligence system that answers what TEXT CANNOT tell you.
Make/model classification is WRONG — that's already known from text extraction.

Vision outputs:
1. **vehicle_zone** — where on the vehicle this image is looking (see taxonomy below)
2. **condition_score** (1-5) — condition of what's visible in this zone
3. **damage_flags** — specific damage visible in this zone
4. **modification_flags** — modifications visible in this zone
5. **photo_quality** (1-5) — is this even a usable image

---

## Vehicle Zone Coordinate System

Every image maps to exactly one zone. This is the coordinate system that makes all other analysis spatially meaningful.

"Rust detected" = useless.
"Rust detected at panel_fender_rr" = actionable, insurance-grade.

### Exterior (whole-vehicle shots)
| Zone | Description |
|------|-------------|
| `ext_front` | Straight-on front — bumper, grille, headlights |
| `ext_front_driver` | Front 3/4 angle, driver side |
| `ext_front_passenger` | Front 3/4 angle, passenger side |
| `ext_driver_side` | Flat profile, driver side |
| `ext_passenger_side` | Flat profile, passenger side |
| `ext_rear` | Straight-on rear — bumper, taillights |
| `ext_rear_driver` | Rear 3/4 angle, driver side |
| `ext_rear_passenger` | Rear 3/4 angle, passenger side |
| `ext_roof` | Top-down or roof clearly visible |
| `ext_undercarriage` | Shot from underneath |

### Panels (specific panel is the focus)
| Zone | Description |
|------|-------------|
| `panel_hood` | Hood open or hood detail shot |
| `panel_trunk` | Trunk/tailgate open |
| `panel_door_fl` | Front-left (driver) door |
| `panel_door_fr` | Front-right (passenger) door |
| `panel_door_rl` | Rear-left door |
| `panel_door_rr` | Rear-right door |
| `panel_fender_fl` | Front-left fender/quarter panel |
| `panel_fender_fr` | Front-right fender/quarter panel |
| `panel_fender_rl` | Rear-left quarter panel |
| `panel_fender_rr` | Rear-right quarter panel |

### Wheels
| Zone | Description |
|------|-------------|
| `wheel_fl` | Front-left wheel/tire |
| `wheel_fr` | Front-right wheel/tire |
| `wheel_rl` | Rear-left wheel/tire |
| `wheel_rr` | Rear-right wheel/tire |

### Interior
| Zone | Description |
|------|-------------|
| `int_dashboard` | Dash, steering wheel, gauges, infotainment |
| `int_front_seats` | Front seating area |
| `int_rear_seats` | Rear seating |
| `int_cargo` | Trunk/cargo area interior |
| `int_headliner` | Ceiling/headliner |
| `int_door_panel_fl/fr/rl/rr` | Individual door panel interiors |

### Mechanical
| Zone | Description |
|------|-------------|
| `mech_engine_bay` | Engine compartment |
| `mech_transmission` | Trans tunnel or exposed transmission |
| `mech_suspension` | Suspension components |

### Detail / Other
| Zone | Description |
|------|-------------|
| `detail_vin` | VIN plate close-up |
| `detail_badge` | Brand/trim/series badge |
| `detail_damage` | Tight shot focused on specific damage |
| `detail_odometer` | Instrument cluster / mileage reading |
| `other` | Doesn't fit above (crowd, transport, environment) |

---

## Label Schema

```json
{
  "image_path": "/absolute/path/to/image.jpg",
  "vehicle_zone": "ext_front_driver",
  "condition_score": 4,
  "damage_flags": ["rust", "paint_fade"],
  "modification_flags": ["aftermarket_wheels"],
  "photo_quality": 4,
  "is_usable_for_training": true
}
```

**damage_flags valid values:** `rust`, `dent`, `crack`, `paint_fade`, `broken_glass`, `missing_parts`, `accident_damage`

**modification_flags valid values:** `lift_kit`, `lowered`, `aftermarket_wheels`, `roll_cage`, `engine_swap`, `body_kit`, `widebody`, `custom_interior`

**condition_score scale:**
- 1 = Parts car / major structural damage
- 2 = Rough — needs significant work
- 3 = Driver quality — presentable, issues present
- 4 = Good — minor wear only
- 5 = Excellent / concours — near perfect

**photo_quality scale:**
- 1 = Unusable (blurry, wrong subject, too dark)
- 2 = Poor (visible but difficult)
- 3 = Acceptable
- 4 = Good — clear, well-lit
- 5 = Professional quality

---

## Sampling Strategy for Labeling

DO NOT sample randomly from 94K images — you'll get 3000 images biased toward whatever vehicles have the most photos.

**Correct approach:**
1. Parse `training-data/images/batch_*.jsonl` — each record has `vehicle_id` + `cache_path`
2. Group by `vehicle_id`
3. Sample max 5 images per vehicle (diverse coverage)
4. Target 3000 total labeled images across as many vehicles as possible

---

## Model Architecture

**Phase 1: Zone Classifier** (run first, always)
- Model: Florence-2-base (microsoft/florence-2-base)
- Input: image
- Output: vehicle_zone
- Once you know the zone, damage/condition assessment is zone-contextualized

**Phase 2: Condition/Damage Classifier** (per-zone or global)
- Model: Florence-2-base fine-tuned on labeled data
- Input: image + zone context
- Output: condition_score, damage_flags, modification_flags

**Phase 3: Coverage Map** (per-vehicle aggregate)
- For each vehicle_id: which zones have images? Which zones have damage?
- DB table: `vehicle_coverage_map` — one row per vehicle with zone coverage flags

**Future Phase: 3D Reconstruction**
- For vehicles with 10+ overlapping exterior images: run COLMAP
- Camera poses + sparse point cloud
- Enables "show me all images of the driver side" with actual 3D geometry

---

## What This Enables (Business Value)

- **Buyer trust**: "This listing has complete coverage — all 12 exterior zones photographed"
- **Gap detection**: "Missing: engine bay, passenger side, interior" → request more photos
- **Damage reports**: "Rust at panel_fender_rr, dent at panel_door_rl" — precise, addressable
- **Pricing signals**: condition_score + damage_flags → model price adjustments
- **Comps matching**: find visually similar vehicles in the same condition tier
- **Restoration tracking**: before/after images in the same zone show progress

---

## Files

| File | Purpose |
|------|---------|
| `yono/scripts/auto_label_images.py` | Claude Vision auto-labeling pipeline |
| `yono/training_labels/labels.jsonl` | Ground truth labels |
| `yono/scripts/train_florence2.py` | Florence-2 fine-tuning |
| `yono/server.py` | FastAPI sidecar — `/classify` (make) + `/analyze` (condition/zone) |
| `yono/models/yono_vision_v2.*` | Trained model weights |
| `supabase/functions/yono-analyze/` | Edge function calling sidecar /analyze |

---

## DB Schema Additions (vehicle_images)

```sql
condition_score       smallint      -- 1-5
vehicle_zone          text          -- zone from taxonomy
damage_flags          text[]
modification_flags    text[]
photo_quality_score   smallint      -- 1-5
vision_analyzed_at    timestamptz
vision_model_version  text          -- e.g. "florence2-v1"
```

And a new table:
```sql
vehicle_coverage_map (
  vehicle_id uuid references vehicles(id),
  has_ext_front bool, has_ext_rear bool, has_ext_driver_side bool,
  has_ext_passenger_side bool, has_mech_engine_bay bool,
  has_int_dashboard bool, has_int_front_seats bool,
  -- ... all zones
  total_zones_covered smallint,
  coverage_score numeric(3,2), -- 0.0-1.0
  updated_at timestamptz
)
```
