# Image Analysis Function Consolidation

## The Problem

We had **7+ duplicate image analysis functions** that each did variations of the same thing:
- Different output formats
- Different AI prompts
- None outputting proper 3D coordinates
- Wasted $500+ on duplicated API calls

## Consolidated Architecture

### One Function to Rule Them All: `analyze-image`

The main `analyze-image` function is the ONLY function that should analyze images. All other functions should either:
1. Forward to `analyze-image`
2. Be deprecated and removed

### Proper 3D Coordinate System

Camera positions are now stored in `image_camera_position` table with:

**Spherical Coordinates:**
- `azimuth_deg`: 0 = front, 90 = driver side, 180 = rear, 270 = passenger
- `elevation_deg`: 0 = level with vehicle center, + = above, - = below
- `distance_mm`: Distance from vehicle/subject center in millimeters

**Cartesian Coordinates (derived):**
- `camera_x_mm`: Lateral position (+ = passenger, - = driver)
- `camera_y_mm`: Longitudinal position (+ = rear, - = front)
- `camera_z_mm`: Vertical position (+ = up from vehicle center)

### Standard Camera Positions

See `canonical_camera_positions` table for standard shots:
- `exterior.front_three_quarter.driver`: azimuth=45, elevation=12, distance=8000mm
- `interior.dashboard.full`: azimuth=0, elevation=-30, distance=800mm
- `engine.bay.overview`: azimuth=0, elevation=60, distance=1500mm

## Deprecated Functions

These functions are DEPRECATED and just forward to `analyze-image`:

| Function | Status | Action |
|----------|--------|--------|
| `analyze-image` | KEEP | Primary analysis function |
| `analyze-image-tier1` | DEPRECATED | Already forwards to analyze-image |
| `analyze-image-tier2` | DEPRECATED | Merge features into analyze-image |
| `analyze-image-contextual` | DEPRECATED | Merge features into analyze-image |
| `ai-tag-image-angles` | DEPRECATED | Use analyze-image instead |
| `backfill-image-angles` | KEEP (batch) | Batch wrapper, calls analyze-image internally |
| `batch-analyze-images` | DEPRECATED | Use backfill-image-angles |
| `batch-analyze-all-images` | DEPRECATED | Use backfill-image-angles |

## Data Tables

### `image_camera_position`
Primary table for camera position observations.

```sql
SELECT 
  image_id,
  subject_key,
  azimuth_deg,
  elevation_deg,
  distance_mm,
  confidence,
  evidence->>'needs_reanalysis' as needs_reanalysis
FROM image_camera_position
WHERE confidence > 0.5  -- Only show confident positions
ORDER BY confidence DESC;
```

### `canonical_camera_positions`
Reference table for standard shot positions.

### Views
- `image_camera_analysis`: Joins image data with camera positions, adds human-readable labels

### Functions
- `cartesian_to_spherical(x, y, z)`: Convert Cartesian to spherical
- `spherical_to_cartesian(azimuth, elevation, distance)`: Convert spherical to Cartesian
- `match_to_canonical_position(...)`: Find closest canonical shot
- `find_similar_camera_positions(...)`: Find images with similar camera angles
- `add_camera_position(...)`: Insert a new camera position observation

## Re-Analysis Priority

Images needing re-analysis (low confidence positions):

```sql
SELECT 
  COUNT(*) FILTER (WHERE confidence < 0.2) as critical_needs_reanalysis,
  COUNT(*) FILTER (WHERE confidence >= 0.2 AND confidence < 0.5) as should_reanalyze,
  COUNT(*) FILTER (WHERE confidence >= 0.5) as good_confidence
FROM image_camera_position;
```

## Usage

### Analyze a single image:
```typescript
const response = await supabase.functions.invoke('analyze-image', {
  body: {
    image_url: 'https://...',
    image_id: 'uuid',
    vehicle_id: 'uuid',
    output_camera_position: true  // Request 3D coordinates
  }
});
```

### Batch analyze:
```typescript
const response = await supabase.functions.invoke('backfill-image-angles', {
  body: {
    vehicleId: 'uuid',  // Optional - process one vehicle
    batchSize: 50,
    minConfidence: 80
  }
});
```

## Cost Tracking

All API calls should record cost in `ai_scan_sessions` table:
- `ai_model_cost`: USD cost of the analysis
- `total_tokens_used`: Token count
- `fields_extracted`: What was extracted

## Next Steps

1. Update `analyze-image` to output camera positions
2. Delete or deprecate duplicate functions
3. Re-analyze images with `confidence < 0.3`
4. Build coverage visualization using camera positions

