# Photo Intelligence Pipeline — Full Architecture
**VP Photos | 2026-02-26 (revised after deep research)**
**Status: Design. Pipeline currently paused (`NUKE_ANALYSIS_PAUSED`).**

---

## Design Principle: Schema Always Grows

This architecture is NOT a complete schema. It is a **living expansion framework**.

Every new vision model capability, every new signal type, every new use case spawns new tables and new fields. The pipeline must be designed to absorb that expansion without breaking existing data or requiring re-extraction.

**Expansion pattern** (used everywhere):
- New signal → new observation row, never overwrites old
- New model version → new `source_version`, old rows preserved
- New table → additive, no migration required for existing data
- Low confidence → flag for human/re-model review, not discard

The schema is wrong until it isn't. Assume it is wrong.

---

## What Actually Exists (Corrected Picture)

The prior assessment understated what's built. The pipeline has three deployed tiers:

| Tier | Function | Model | Cost | Status |
|------|----------|-------|------|--------|
| 0 | `yono-classify` | YONO EfficientNet (make/family) | $0 | Deployed, Modal |
| 1 | `analyze-image` → `vision-analyze-image` | Gemini Flash → GPT-4o-mini | ~$0.0001–0.004/img | Active, PAUSED |
| 1.5 | `analyze-engine-bay`, `score-vehicle-condition` | GPT-4o, Claude Haiku | ~$0.002–0.004/img | Implemented |
| 2 | `yono-analyze` | Florence-2 fine-tuned | $0 | Deployed, Modal |
| 3 | COLMAP / `bat_reconstruct.py` | Structure-from-Motion | $0 | Schema only, no pipeline |

Derivative tables that exist and have writers:
- `image_camera_position` ← `analyze-image` (spherical → Cartesian camera position)
- `image_tags` ← `analyze-image` (automated part/issue tags)
- `vehicle_condition_assessments` ← `score-vehicle-condition`
- `component_conditions` ← `score-vehicle-condition`
- `paint_quality_assessments` ← `score-vehicle-condition`
- `vehicle_spid_data` ← `analyze-image` (SPID sheet OCR)
- `vehicle_field_sources` + `vin_validations` ← `analyze-image` (VIN OCR)
- `ai_scan_sessions` ← `analyze-image` (cost audit)
- `vehicle_coverage_map` ← `generate_condition_report.py` (41-zone boolean coverage)
- `vehicle_condition_reports` ← `generate_condition_report.py` (findings array)
- `vehicle_reconstructions` ← schema seeded, COLMAP pipeline not deployed

**What `yono-analyze` already writes to `vehicle_images`:**
```
condition_score       (1-5 integer)
damage_flags          (text[] — boolean presence only, no severity)
modification_flags    (text[])
photo_quality_score   (1-5)
vehicle_zone          (one of 41 zones)
zone_confidence       (0-1)
vision_analyzed_at
vision_model_version  ("finetuned_v2" | "zeroshot_florence2")
```

**Known issues in existing pipeline:**
- `damage_flags` is boolean text array — no severity, no extent, no location within image
- `generate_condition_report.py` may not have a running cron job
- `photo-pipeline-orchestrator` routes to observation system but integration completeness unclear
- `perceptual_hash` and `phash` are duplicate columns — same concept
- `angle_details` jsonb and `angle` text are parallel systems — needs consolidation
- `duplicate_detections` is vehicle-level dedup, not image cross-source appearance tracking

---

## The Three Coordinate Systems (Clarified)

### System A — GPS Coordinates (already partially working)
**Where on earth was this photo taken?**
- Fields: `vehicle_images.latitude`, `vehicle_images.longitude`
- Source: EXIF GPSInfo → `reprocess-image-exif` → structured `exif_data.location`
- Use: Auction venue matching, owner geography, provenance chain
- Gap: Not promoted to top-level columns reliably; GPS stripped from most scraped images

### System B — Camera Pose (6DOF, partially working)
**Where in 3D space around the vehicle was the camera?**
- Table: `image_camera_position` (azimuth_deg, elevation_deg, distance_mm, camera_x/y/z_mm)
- Written by: `analyze-image` via insertCameraPosition — uses detected angle + AI-described position
- Gap: Confidence is low (inferred from text description, not geometric measurement)
- Proper solution: COLMAP — `image_pose_observations` with quaternion rotation (q_w/q_x/q_y/q_z) + translation

### System C — Subject Surface Coordinates (not working yet)
**What point on the vehicle surface does this image depict?**
- Fields: `vehicle_images.surface_coord_u`, `surface_coord_v`
- Requires: COLMAP Structure-from-Motion on 150+ overlapping images per vehicle
- Schema exists: `image_coordinate_observations`, `image_coordinate_consensus`, `vehicle_reconstructions`
- Current state: All null. Waiting for COLMAP pipeline deployment.
- Short-term proxy: Derive UV from zone centroid lookup (angle_label_coordinates table has defaults)

---

## Gap Analysis: What's Missing

### Missing Tables (need to build)

**1. `image_source_appearances`** — the duplicate signal table
The most critical gap. We have `is_duplicate=true/false` which discards signal.
Cross-source appearance frequency is PROVENANCE DATA.

```
image appearing on BaT + Cars&Bids + dealer site = sold multiple times
image appearing 12x = professional shoot, broadly syndicated = quality signal
image appearing once, unique fingerprint = owner-shot = authenticity signal
image appearing on 3 competitor sites = price shopping signal
```

**2. `vehicle_photo_intelligence`** — per-vehicle aggregate summary
No single-row-per-vehicle summary of photo intelligence exists.
All signals are scattered across image-level tables.

**3. `photo_surface_defect_analysis`** — surface condition beyond boolean flags
`damage_flags` = ['rust', 'dent'] tells you nothing about severity, location, or extent.
Need: `{flag, severity: 1-5, area_pct: 0-100, zone: 'panel_door_fl', bbox: {x,y,w,h}}`

**4. `image_forensic_metadata`** — EXIF authenticity and provenance signals
`photo_forensic_analysis` table exists but writer is unclear and scope is narrow.
Need systematic: timestamp_trust_score, sensor_fingerprint_hash, compression_artifact_score,
edit_history_software_list, ai_generation_probability.

**5. `vehicle_condition_history`** — time-series condition tracking
`vehicle_condition_reports` is a snapshot table (unique per vehicle).
No way to track condition changes: before restoration, mid-restoration, after restoration.

**6. `image_component_detections`** — normalized component inventory
`analyze-engine-bay` stores everything in `ai_scan_metadata.engine_bay` jsonb.
`visible_components` from appraiser are free-text strings.
Need: structured rows per detected component, linkable to parts catalog.

### Missing Signals (frontier, not yet modeled)

**Surface Analysis:**
- Paint defects: scratches, swirls, orange peel, overspray, runs — not just "rust" boolean
- Corrosion map: surface rust vs. pitting vs. structural, each with location + extent
- Panel alignment gaps: photogrammetric gap measurement between body panels
- Glass condition: crack/chip location, delamination, aftermarket vs. OEM

**Interior:**
- Upholstery damage map: tears/stains with location, severity
- Dashboard condition: cracks, delamination, airbag cover integrity
- Carpet/floor condition: staining, water damage indicators
- Electronic status: visible warning lights, gauge illumination, button states

**Mechanical (from photos):**
- Tire condition: tread depth estimate from angle shots, sidewall cracking, dry rot
- Brake rotor condition: scoring, glazing, rust rings (active vs. sitting)
- Suspension stance: ride height front/rear, camber visible from rear shots
- Exhaust tip condition: rust, carbon deposits, aftermarket vs. OEM

**EXIF Forensics:**
- Timestamp authenticity: DateTimeOriginal vs. DateTimeDigitized consistency
- Sensor noise signature: device fingerprint for authentication
- Error Level Analysis (ELA): detect re-compressed/edited regions
- C2PA/AI generation detection: synthetic image identification
- Edit software history: Lightroom, Photoshop, Apple Photos traces

**Photography Quality:**
- Hero shot completeness: does front_3/4 show ≥40% of vehicle body?
- Lighting direction: key light vector from specular highlights
- Background context: studio vs. showroom vs. dirty garage vs. outdoor lot
- Presentation bias: is vehicle obviously cleaned for shoot vs. daily condition?

---

## Full Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 0: INTAKE GATE                                               │
│  Every image → hash → cross-source dedup → priority queue          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 1: YONO TIER 0  [YONO EfficientNet, $0, ~4ms]              │
│  make · family · is_vehicle                                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 2: YONO TIER 2  [Florence-2, $0, ~50ms]                    │
│  zone · zone_confidence · condition_score · damage_flags ·          │
│  modification_flags · photo_quality_score                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 3: COORDINATE DERIVATION  [$0, computed from Stage 2]       │
│  camera_pose prior · subject_xyz · surface_uv · EXIF GPS           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  QUALITY GATE        │
                    │  quality_score ≥ 3?  │
                    │  zone_confidence>0.6?│
                    │  coverage gap?       │
                    │  is_document?        │
                    └──────────┬──────────┘
                               │ PASS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 4: CLOUD VISION  [Gemini Flash → GPT-4o, ~$0.0001–0.004]   │
│  appraiser · SPID OCR · VIN OCR · camera_position · tags           │
│  engine_bay · condition_scoring (100pt rubric)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 5: FORENSICS  [$0, EXIF + hash analysis]                    │
│  timestamp_trust · sensor_fingerprint · ELA score ·                 │
│  edit_history · ai_generation_probability                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 6: SURFACE DEFECT EXPANSION  [selective cloud AI]           │
│  paint defects · rust severity+location · tire · brake · glass      │
│  Triggered by: damage_flags non-empty OR zone=panel_*               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 7: COVERAGE ROLLUP  [$0, per-vehicle aggregate]             │
│  vehicle_coverage_map · vehicle_condition_reports ·                  │
│  vehicle_condition_history entry                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 8: SIGNAL AGGREGATION  [$0, per-vehicle summary]            │
│  vehicle_photo_intelligence · cross-source appearance score         │
└─────────────────────────────────────────────────────────────────────┘

STAGE 9 (ASYNC, PER VEHICLE, 150+ IMAGES REQUIRED):
┌─────────────────────────────────────────────────────────────────────┐
│  3D RECONSTRUCTION  [COLMAP SfM, $0 compute]                       │
│  vehicle_reconstructions · surface_coord_u/v · camera_pose (6DOF)  │
│  Enables: precision damage location, UV overlay, insurance-grade    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Stage Definitions

### Stage 0: Intake Gate
**Function:** `image-intake` (refactor)
**Trigger:** Every INSERT to `vehicle_images`

```
1. Compute file_hash (SHA-256) from bytes
2. Compute phash (perceptual hash, 64-bit)
3. Compute dhash (difference hash, 64-bit)
4. Consolidate: if phash IS NULL but perceptual_hash IS NOT NULL → phash = perceptual_hash
5. Check for matches (Hamming distance ≤ 8 on phash)

MATCH FOUND:
  → is_duplicate = true, duplicate_of = <canonical_id>
  → INSERT image_source_appearances (still record the appearance — this IS the signal)
  → Route to Stage 1 still (YONO is free — angle/zone on all images)
  → STOP at Stage 4 quality gate (no cloud AI on duplicates)

NO MATCH:
  → This is canonical
  → INSERT image_source_appearances (first appearance record)
  → ai_processing_status = 'pending'
  → Priority score assigned (see Priority Queue below)
```

### Stage 1: YONO Tier 0 — Make Classification
**Function:** `yono-classify` (existing, no change needed)
**Cost:** $0, ~4ms
Writes: `ai_scan_metadata.yono` {make, confidence, family, top5, is_vehicle}

### Stage 2: YONO Tier 2 — Zone/Condition/Damage
**Function:** `yono-analyze` (existing, DEPLOYED)
**Cost:** $0, ~50ms (Florence-2 sidecar)
Writes to `vehicle_images`:
```
vehicle_zone, zone_confidence
condition_score (1-5 — needs expansion, see below)
damage_flags (text[] — needs expansion to structured severity)
modification_flags (text[])
photo_quality_score (1-5)
vision_analyzed_at, vision_model_version
```
**Expansion target:** `damage_flags` must evolve from `['rust', 'dent']` to:
```jsonb
[
  {"flag": "rust", "severity": 3, "area_pct": 12, "zone": "panel_door_fl", "bbox": {x,y,w,h}},
  {"flag": "dent", "severity": 2, "area_pct": 4, "zone": "panel_fender_fr"}
]
```
This requires Florence-2 fine-tuning update and a new column or migration of the existing field.

### Stage 3: Coordinate Derivation
**Function:** `image-coordinate-mapper` (new)
**Cost:** $0

Step A — GPS from EXIF:
```
exif_data.location.latitude/longitude → vehicle_images.latitude/longitude
(already partially done by reprocess-image-exif, needs to be pipeline-wired)
```

Step B — Camera pose prior from zone + angle:
```
Lookup angle_label_coordinates WHERE label = angle → x_default, y_default, z_default
Lookup zone → refine with zone centroid
INSERT image_pose_observations (source='label_prior', confidence=0.3)
INSERT image_coordinate_observations (x/y/z from prior, confidence=0.3)
UPDATE vehicle_images SET surface_coord_u, surface_coord_v (zone-derived estimate)
```

Step C — Consensus update:
```
UPSERT image_coordinate_consensus (running average, certainty increases with more observations)
UPDATE coordinate_system_stats
```

Note: These are low-confidence priors. Stage 9 (COLMAP) replaces them with measured values.

### Stage 4: Cloud Vision
**Functions:** `analyze-image` → `vision-analyze-image`, `analyze-engine-bay`, `score-vehicle-condition`
**Cost:** $0.0001–$0.004/image (Gemini Flash primary)
**Quality gate (any one condition passes):**
```
photo_quality_score ≥ 3
is_document = true          (all docs get full analysis — VIN, SPID)
coverage gap for vehicle    (missing essential zone)
zone IN ('mech_engine_bay', 'undercarriage', 'detail_vin')
is_duplicate = false        (no cloud AI on duplicates)
```
Writes: (existing — see current function inventory above)
- `ai_scan_metadata.appraiser`, `image_camera_position`, `image_tags`
- `vehicle_spid_data`, `vin_validations`, `vehicle_field_sources`
- `vehicle_condition_assessments`, `component_conditions`, `paint_quality_assessments`
- `ai_scan_sessions` (cost audit)

### Stage 5: Forensics
**Function:** `image-forensics-analyzer` (new)
**Cost:** $0 — EXIF parsing + algorithmic analysis

```
Extract structured EXIF:
  DateTimeOriginal, DateTimeDigitized, DateTime → compare for tampering
  MakerNote presence → camera authenticity
  GPS altitude consistency check

Compute:
  timestamp_trust_score (0-1): are timestamps internally consistent?
  compression_artifact_score (0-1): ELA variance → detect re-compressed regions
  sensor_fingerprint_hash: MD5 of PRNU noise pattern
  edit_history_software: parse XMP Toolkit + Software tag
  exif_completeness_pct: present tags / expected for this camera model
  ai_generation_probability: check C2PA manifest + structured noise pattern

INSERT image_forensic_metadata (new table)
```

### Stage 6: Surface Defect Expansion
**Function:** `image-surface-defect-analyzer` (new — selective cloud AI)
**Cost:** ~$0.002/image (selective trigger)
**Trigger:** `damage_flags IS NOT NULL AND array_length > 0` OR `zone LIKE 'panel_%'`

Produces structured surface defect inventory — not just flags but location, severity, extent.
INSERT `photo_surface_defect_analysis` (new table)

### Stage 7: Coverage Rollup
**Function:** `image-coverage-assessor` (new — thin computed function)
**Cost:** $0
**Trigger:** Stage 2 or 4 completes for any image of a vehicle

```
Aggregate vehicle_images by vehicle_id:
  → UPSERT vehicle_coverage_map (41 boolean zone columns)
  → UPSERT vehicle_condition_reports (findings array, per-zone severity)
  → INSERT vehicle_condition_history (new table — timestamped snapshot, not overwrite)
```

### Stage 8: Signal Aggregation
**Function:** `photo-intelligence-aggregator` (new)
**Cost:** $0, nightly cron + on-demand

```
Per vehicle:
  unique_image_count (exclude is_duplicate=true)
  duplicate_image_count
  cross_source_appearances (from image_source_appearances)
  source_diversity_score
  max_image_appearance_count (most-seen image)
  contributing_sources (distinct sources array)
  coverage_score
  condition_consensus (median condition_score)
  damage_summary (unique damage types + severity distribution)
  modification_summary
  photographer_count (distinct device_fingerprints)
  avg_photo_quality
  zones_with_high_confidence (zone_confidence > 0.7)

UPSERT vehicle_photo_intelligence (new table)
```

### Stage 9: 3D Reconstruction (async, per vehicle)
**Function:** `bat_reconstruct.py` (schema ready, pipeline not deployed)
**Trigger:** Vehicle has ≥150 overlapping images, vehicle_reconstructions.status = 'pending'
**Cost:** $0 compute (COLMAP local)

Produces:
- `vehicle_reconstructions.camera_poses` (JSONB per-image 4x4 matrix)
- `vehicle_reconstructions.point_cloud_url` (stored 3D point cloud)
- `vehicle_images.surface_coord_u/v` (precise UV, replaces Stage 3 priors)
- `vehicle_images.camera_pose` (precise 6DOF, replaces Stage 3 priors)

This is the unlock for insurance-grade precision: "rust at 142.3", 18.7" from front-left corner."

---

## New Tables

### `image_source_appearances`
```sql
CREATE TABLE image_source_appearances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_image_id UUID REFERENCES vehicle_images(id),  -- the first/authoritative image
  phash              TEXT NOT NULL,
  source             TEXT NOT NULL,         -- 'bat', 'cars_and_bids', 'facebook', etc.
  source_url         TEXT,
  vehicle_id         UUID REFERENCES vehicles(id),
  image_id           UUID REFERENCES vehicle_images(id),  -- the specific row
  seen_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (phash, source_url)
);
CREATE INDEX idx_isa_phash ON image_source_appearances(phash);
CREATE INDEX idx_isa_canonical ON image_source_appearances(canonical_image_id);
CREATE INDEX idx_isa_vehicle ON image_source_appearances(vehicle_id);

-- Materialized summary:
CREATE VIEW image_cross_source_stats AS
SELECT
  phash, canonical_image_id,
  COUNT(*) as appearance_count,
  COUNT(DISTINCT source) as source_diversity,
  array_agg(DISTINCT source ORDER BY source) as sources,
  MIN(seen_at) as first_seen, MAX(seen_at) as last_seen
FROM image_source_appearances
GROUP BY phash, canonical_image_id;
```

### `vehicle_photo_intelligence`
```sql
CREATE TABLE vehicle_photo_intelligence (
  vehicle_id                   UUID PRIMARY KEY REFERENCES vehicles(id),
  total_image_count            INTEGER,
  unique_image_count           INTEGER,
  duplicate_image_count        INTEGER,
  cross_source_appearances     INTEGER,       -- sum of appearance_count > 1
  source_diversity_score       NUMERIC(4,2),  -- 0-1
  max_single_image_appearances INTEGER,
  contributing_sources         TEXT[],
  coverage_score               NUMERIC(4,2),
  missing_zones                TEXT[],
  has_undercarriage            BOOLEAN,
  has_engine_bay               BOOLEAN,
  has_interior                 BOOLEAN,
  has_vin_photo                BOOLEAN,
  avg_quality_score            NUMERIC(4,2),
  high_quality_count           INTEGER,
  condition_consensus          NUMERIC(4,2),
  damage_type_summary          TEXT[],
  modification_summary         TEXT[],
  photographer_count           INTEGER,
  zones_mapped                 TEXT[],
  pose_confidence_avg          NUMERIC(4,2),
  computed_at                  TIMESTAMPTZ DEFAULT now()
);
```

### `photo_surface_defect_analysis`
```sql
CREATE TABLE photo_surface_defect_analysis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id      UUID REFERENCES vehicle_images(id),
  vehicle_id    UUID REFERENCES vehicles(id),
  defect_type   TEXT NOT NULL,     -- 'rust', 'dent', 'scratch', 'paint_fade', 'chip', 'crack', ...
  severity      SMALLINT,          -- 1-5
  area_pct      NUMERIC(5,2),      -- 0-100 % of image area
  zone          TEXT,              -- vehicle_zone where defect appears
  bbox          JSONB,             -- {x, y, w, h} normalized 0-1
  confidence    NUMERIC(4,3),
  source        TEXT,              -- 'florence2', 'gemini', 'claude', 'human'
  source_version TEXT,
  observed_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_psda_image ON photo_surface_defect_analysis(image_id);
CREATE INDEX idx_psda_vehicle ON photo_surface_defect_analysis(vehicle_id);
CREATE INDEX idx_psda_type ON photo_surface_defect_analysis(defect_type);
```

### `image_forensic_metadata`
```sql
CREATE TABLE image_forensic_metadata (
  image_id                  UUID PRIMARY KEY REFERENCES vehicle_images(id),
  timestamp_trust_score     NUMERIC(4,3),   -- 0-1, internal EXIF timestamp consistency
  sensor_fingerprint_hash   TEXT,           -- PRNU noise signature
  exif_completeness_pct     NUMERIC(5,2),   -- % of expected tags present
  edit_history_software     TEXT[],         -- ['Adobe Lightroom', 'Apple Photos', ...]
  compression_artifact_score NUMERIC(4,3),  -- 0-1, ELA variance (high = edited)
  ai_generation_probability NUMERIC(4,3),   -- 0-1, synthetic image likelihood
  has_c2pa_manifest         BOOLEAN,
  gps_consistent            BOOLEAN,        -- GPS matches known venue/location
  stripped_exif             BOOLEAN,        -- EXIF removed (scraper artifact)
  overall_authenticity_score NUMERIC(4,3),  -- 0-1 composite
  analyzed_at               TIMESTAMPTZ DEFAULT now(),
  analyzer_version          TEXT
);
```

### `vehicle_condition_history`
Time-series condition tracking — enables before/after restoration analysis.
```sql
CREATE TABLE vehicle_condition_history (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                UUID REFERENCES vehicles(id),
  snapshot_date             TIMESTAMPTZ DEFAULT now(),
  overall_condition_score   NUMERIC(4,2),      -- 0-100
  exterior_score            NUMERIC(4,2),
  interior_score            NUMERIC(4,2),
  mechanical_score          NUMERIC(4,2),
  undercarriage_score       NUMERIC(4,2),
  coverage_pct              NUMERIC(5,2),
  image_count               INTEGER,
  damage_flags_summary      TEXT[],
  modification_flags_summary TEXT[],
  context_label             TEXT,              -- 'pre_restoration', 'mid_restoration', 'post_restoration', 'auction_listing', 'owner_submission'
  source_function           TEXT,             -- which function generated this
  images_sampled            UUID[]
);
CREATE INDEX idx_vch_vehicle_date ON vehicle_condition_history(vehicle_id, snapshot_date DESC);
```

---

## Functions: Build / Refactor / Deprecate

### Refactor (extend existing)
| Function | Change |
|----------|--------|
| `image-intake` | Add phash/dhash/file_hash computation. INSERT to image_source_appearances. |
| `photo-pipeline-orchestrator` | Extend to full 9-stage dispatcher. Currently routes to observation system but doesn't drive full derivative graph. |
| `backfill-image-angles` | Extend to `backfill-photo-intelligence` — drives all stages for 32M backlog. |
| `yono-analyze` | Evolve `damage_flags` from text[] to structured jsonb with severity + location + bbox. |

### Build New
| Function | Stage | Purpose |
|----------|-------|---------|
| `image-dedup-gate` | 0 | Standalone dedup (for bulk intake) |
| `image-coordinate-mapper` | 3 | Camera pose prior + subject xyz + surface UV from zone/angle/EXIF |
| `image-forensics-analyzer` | 5 | EXIF authenticity + ELA + AI generation detection |
| `image-surface-defect-analyzer` | 6 | Structured paint/rust/damage with severity + location |
| `image-coverage-assessor` | 7 | Per-vehicle zone coverage rollup, writes condition_history |
| `photo-intelligence-aggregator` | 8 | Per-vehicle summary → vehicle_photo_intelligence |

### Deprecate
| Item | Reason |
|------|--------|
| `vehicle_images.perceptual_hash` column | Duplicate of `phash`. Migrate then drop after pipeline stable. |
| `duplicate_detection_jobs` / `duplicate_detections` | Vehicle-level dedup — different scope. Keep for vehicle merging, not image pipeline. |

---

## Expansion Protocol

When a new signal type is identified:

1. **Don't add to `vehicle_images`** unless it's a tier-0 classification field (angle, zone, quality_score). Everything else gets its own table.

2. **Observation pattern**: New table always has `source`, `source_version`, `confidence`, `observed_at`. Multiple models can write different rows for the same image. A consensus layer aggregates.

3. **Writer registration**: Every new field or table gets registered in `pipeline_registry` before any code writes to it.

4. **Version the model**: `source_version` on every observation row. When a new model is trained, new rows are inserted — old rows preserved. Drift is detectable.

5. **Schema migration is additive**: New tables, new columns on new tables, new nullable columns on existing tables. Never drop or rename columns that have data.

Example: when tire tread detection becomes possible:
```sql
CREATE TABLE image_tire_analysis (
  image_id UUID, vehicle_id UUID, wheel_position TEXT,
  tread_depth_estimate_32nds SMALLINT,  -- in 32nds of an inch
  sidewall_condition TEXT,              -- 'good', 'cracked', 'bulging'
  dry_rot_visible BOOLEAN,
  tire_brand TEXT, tire_size TEXT,
  confidence NUMERIC(4,3),
  source TEXT, source_version TEXT, observed_at TIMESTAMPTZ
);
```
No migration of `vehicle_images` required. Just a new table with its own writer.

---

## Priority Queue

Not all 32M images are equal. Process in this order:

1. `source = 'user_upload'` OR `source = 'iphoto'` — owner photos, highest authenticity value
2. K10 truck backlog (`vehicle_id = '6442df03-9cac-43a8-b89e-e4fb4c08ee99'`, 419 photos)
3. Vehicles with `vehicle_coverage_map.coverage_score < 0.5` — gap filling
4. `is_duplicate = false` — canonical images before duplicates
5. General backlog, `created_at DESC` (newest first)
6. Duplicates last — Stage 1+2 only (YONO, $0)

---

## Cost Model at Unpause

| Stage | Cost/image | Population | Estimated Total |
|-------|-----------|-----------|----------------|
| Stage 0 (hash + dedup) | ~$0 | 33M | $0 |
| Stage 1 (YONO Tier 0) | $0 | 33M | $0 |
| Stage 2 (YONO Tier 2) | $0 | 33M | $0 |
| Stage 3 (coordinate prior) | $0 | 33M | $0 |
| Stage 4 (cloud vision) | ~$0.0001–$0.002 | ~15% = 5M | ~$500–$10K |
| Stage 5 (forensics) | $0 | 33M | $0 |
| Stage 6 (surface defect) | ~$0.002 | ~5% = 1.65M | ~$3.3K |
| Stage 7-8 (rollup + aggregate) | $0 | per-vehicle | $0 |
| Stage 9 (COLMAP) | $0 compute | vehicles w/ 150+ imgs | $0 |

**Conservative estimate: $4K–$14K total for 33M images.**
Cloud AI is triggered on ~20% of images. YONO handles the rest at $0.
CFO approval threshold: >$5K requires sign-off.

---

## Unpause Preconditions (Ordered Checklist)

- [ ] YONO sidecar healthy (Tier 0 + Tier 2) — PID 68092 training, zone classifier in progress
- [ ] `image_source_appearances` table created and indexed
- [ ] `vehicle_photo_intelligence` table created
- [ ] `photo_surface_defect_analysis` table created
- [ ] `image_forensic_metadata` table created
- [ ] `vehicle_condition_history` table created
- [ ] `image-intake` updated with hash computation
- [ ] `image-coordinate-mapper` deployed
- [ ] `photo-pipeline-orchestrator` refactored for 9 stages
- [ ] `perceptual_hash` → `phash` migration run
- [ ] Priority queue logic confirmed (K10 goes first)
- [ ] Sharded Stage 2 workers (4x, by id range)
- [ ] Quality gate threshold set (default: quality_score ≥ 3)
- [ ] Cost cap configured in `analyze-image` (max $X/day auto-pause)
- [ ] CFO cost approval on record
- [ ] `generate_condition_report.py` cron confirmed running

---

## What This Unlocks

After the pipeline runs on 33M images:

- Every image: angle, zone, condition score, damage inventory (with location + severity), quality score, camera pose estimate, UV surface position, forensic authenticity score
- Every duplicate: tracked as signal — appearance count, source diversity, first/last seen
- Every vehicle: coverage score, condition consensus, damage map, modification inventory, photographer count, condition history snapshots, cross-source exposure signal
- SDK `api-v1-vision`: "show me all 911 RS images, front_3/4 angle, quality ≥ 3, no damage flags"
- Insurance-grade (Stage 9): "rust visible at 142.3" from front-left, severity 3/5, 4.2% of panel area"
- Provenance signal: "this image appears on 4 platforms — vehicle has significant market exposure"
- Authentication signal: "EXIF stripped, AI generation probability 0.87 — flag for review"
