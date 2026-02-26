# YONO Vision — Strategic Roadmap
*Written 2026-02-26. Do not lose this.*

---

## The Core Insight

We have 4,400 BaT vehicles with 100-200 professional photos each.
That's the best vehicle photogrammetry corpus in existence outside of an OEM.

BaT photographers systematically walk every vehicle. Every angle. Every panel. Professional lighting.
This is exactly the input COLMAP needs for 3D reconstruction.

We also have 364K BaT auction comments where bidders describe specific damage/mods in text.
These map to the same surface coordinate system.

**No one else has this combination. This is a moat.**

---

## What We're Building: Per-Vehicle Condition Maps

For every vehicle in the DB, produce:

```json
{
  "vehicle_id": "abc-123",
  "make": "Porsche", "model": "911", "year": 1987,
  "surface_coverage_pct": 0.91,
  "uncovered_zones": ["ext_undercarriage", "int_trunk"],
  "condition_findings": [
    {
      "surface_coord": {"U": 142.3, "V": 18.7},
      "zone": "panel_fender_rr",
      "finding": "rust",
      "severity": 2,
      "confidence": 0.87,
      "source_images": ["img_001.jpg", "img_043.jpg"],
      "comment_corroboration": "user 'porsche_buyer' noted 'small rust bubble rear quarter'"
    }
  ],
  "overall_condition": 3.4,
  "report_generated_at": "2026-02-26T..."
}
```

This is an insurance-grade condition report from photos + comments, automatically generated.

---

## Data Sources (in priority order)

### 1. BaT Listings (highest quality)
- 4,400 vehicles in `bat_listings` table
- 100-200 professional images per vehicle (in `vehicle_images`)
- 364K bidder comments in `auction_comments` describing specific condition
- Images: systematic, overlapping, professional — perfect for COLMAP
- **Use these first for 3D reconstruction**

### 2. Our 90K cached images
- `yono/.image_cache/` — 94K images already downloaded
- Mix of sources (BaT, listings, user uploads)
- Many are single-angle shots (good for L0 zone classification, not COLMAP)

### 3. 28M total vehicle_images in DB
- Long-tail, not yet cached
- Run inference on these after model is validated

---

## Pipeline

### Phase 0: Zone Classifier (ship first, ~1 week)
- Florence-2-base fine-tuned on ~3000 labeled images
- Output: vehicle_zone + condition_score + damage_flags + photo_quality
- Works on ANY single image
- Store in vehicle_images: condition_score, vehicle_zone, damage_flags

### Phase 1: BaT Reconstruction (~2 weeks)
- For each BaT vehicle_id: collect all vehicle_images
- Run COLMAP (Structure from Motion) to get:
  - Camera poses for each image
  - Sparse 3D point cloud
- Register point cloud to vehicle coordinate system
- Store: per-image camera_pose (4x4 matrix), point_cloud for vehicle

### Phase 2: Pixel-to-Surface Mapping (~2 weeks)
- Given camera pose + point cloud: project zone classifications to surface coords
- Upgrade zone tags to (U, V) coordinates
- Build vehicle_surface_coverage table

### Phase 3: Comment Correlation (~1 week)
- Parse auction_comments for damage/condition mentions using existing AI pipeline
- Fuzzy-match to surface coordinates ("passenger rear quarter" → panel_fender_rr)
- Boost confidence scores where image + comment agree

### Phase 4: Condition Report Generation
- Aggregate all findings per vehicle
- Generate structured report (JSON + human-readable summary)
- Surface via API: `GET /vehicles/{id}/condition-report`

### Phase 5: Scale to Full DB
- Run Phase 0 inference on all 28M images
- Run Phases 1-3 on all vehicles with 10+ images

---

## Technical Stack

| Component | Tool | Why |
|-----------|------|-----|
| Zone classification | Florence-2-base (fine-tuned) | Small, fast, language-grounded |
| 3D reconstruction | COLMAP | Best open-source SfM, battle-tested |
| Surface registration | Open3D + ICP | Point cloud alignment |
| Auto-labeling | claude-haiku-4-5-20251001 vision | Cheap, fast, good at structured extraction |
| Inference server | FastAPI + Florence-2 | Existing YONO sidecar pattern |
| Storage | Supabase + Modal volume | Existing infra |

---

## DB Schema

### vehicle_images additions
```sql
vehicle_zone          text          -- L0 zone classification
surface_coord_u       numeric(8,2)  -- inches from origin (null until L2+)
surface_coord_v       numeric(8,2)  -- inches from origin (null until L2+)
condition_score       smallint      -- 1-5, for what's visible in this image
damage_flags          text[]        -- damage visible in this image
modification_flags    text[]
photo_quality_score   smallint      -- 1-5
camera_pose           jsonb         -- 4x4 matrix from COLMAP (null until Phase 1)
vision_analyzed_at    timestamptz
vision_model_version  text
```

### New tables
```sql
-- Per-vehicle 3D reconstruction
vehicle_reconstructions (
  vehicle_id       uuid references vehicles(id),
  point_cloud_url  text,         -- stored in Modal/Supabase storage
  camera_poses     jsonb,        -- {image_id: 4x4_matrix}
  reconstruction_quality  text,  -- 'good'/'poor'/'failed'
  image_count      int,
  reconstructed_at timestamptz
)

-- Per-vehicle condition report (aggregated)
vehicle_condition_reports (
  vehicle_id        uuid references vehicles(id),
  surface_coverage  numeric(4,3),  -- 0.0-1.0
  overall_score     numeric(3,1),  -- 1.0-5.0
  findings          jsonb,         -- array of {zone, coord, finding, severity, confidence}
  uncovered_zones   text[],
  image_count       int,
  generated_at      timestamptz,
  model_version     text
)
```

---

## The Product

**Consumer API** (this is what @nuke1/sdk ships):
```typescript
const report = await nuke.vision.conditionReport(vehicleId)
// {
//   overallScore: 3.4,
//   coverage: 0.91,
//   findings: [{zone: 'panel_fender_rr', issue: 'rust', severity: 2, photoEvidence: [...]}],
//   missingCoverage: ['undercarriage', 'trunk'],
//   summary: "Good driver-quality car. Rust bubble on rear passenger quarter..."
// }
```

This is the intelligence layer that makes SDK worth paying for.
No one else has 1"×1" granularity condition reports from photos.
