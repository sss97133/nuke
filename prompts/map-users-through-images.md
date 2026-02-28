# Mapping Users Through Their Image Data

## Context

Nuke has 34.7M images in `vehicle_images` across 143 columns — but only ~0.012% have GPS coordinates stored. The schema already supports everything needed: `latitude`, `longitude`, `exif_data` (JSONB), `taken_at`, `camera_pose`, `yaw_deg`, `ai_detected_angle`, `location_name`, `location_confidence`. PostGIS is active. The extraction code exists on both client (`exifr`) and server (`reprocess-image-exif` edge function). The gap isn't architecture — it's that nobody's actually flowing GPS data through.

Meanwhile, the user has 83,000+ GPS-tagged photos in Apple Photos. The iPhoto intake script (`scripts/iphoto-intake.mjs`) uploads images but doesn't harvest GPS metadata from `osxphotos`. This is the most immediate source of rich spatial-temporal user data sitting untapped.

The goal: **every user image becomes a spatial-temporal data point**. Not just "a photo of a car" but "a photo taken at 36.0228° N, 114.9811° W on Jan 15 2024 at 2:34 PM facing northeast of a 1984 Chevrolet K10 in a garage." That's the atom. Everything builds from there.

---

## The Atom: A Mapped Image

```
{
  image_id: uuid,
  user_id: uuid,

  // WHERE (spatial)
  latitude: 36.0228,
  longitude: -114.9811,
  altitude_m: 542,
  location_name: "Boulder City, NV",
  location_precision: "gps_exif",    // gps_exif | reverse_geocode | zip_centroid | manual_pin

  // WHEN (temporal)
  taken_at: "2024-01-15T14:34:12Z",  // from EXIF DateTimeOriginal
  uploaded_at: "2026-02-28T...",

  // WHAT (content)
  ai_detected_vehicle: { year: 1984, make: "Chevrolet", model: "K10", confidence: 0.94 },
  ai_detected_angle: "driver_front_quarter",
  ai_detected_angle_confidence: 0.87,
  vehicle_id: uuid,                   // linked vehicle (if matched)

  // HOW (camera)
  camera_make: "Apple",
  camera_model: "iPhone 15 Pro",
  yaw_deg: 42.5,                      // compass heading camera was facing
  camera_pose: { position: [x,y,z], rotation: [rx,ry,rz] },
  focal_length_mm: 6.86,

  // WHO (provenance)
  source: "iphoto",
  documented_by_user_id: uuid,
  photographer_attribution: "skylar"
}
```

Every field here already exists as a column in `vehicle_images`. This isn't a new schema — it's about actually populating what's already there.

---

## Phase 1: Harvest GPS From Existing Photos

### 1A. Fix iPhoto Intake to Extract GPS

The `osxphotos` CLI outputs GPS when you use `--exiftool` or query metadata directly. The intake script needs to:

```bash
# osxphotos already knows GPS for every photo
osxphotos query --album "1984 Chevrolet K20 LWB" --json | jq '.[0].location'
# → [36.0228, -114.9811]
```

**Changes to `scripts/iphoto-intake.mjs`:**
1. Before uploading, query `osxphotos` for full metadata JSON per photo
2. Extract: `latitude`, `longitude`, `date` (taken_at), `title`, `description`, `place.name`
3. Pass these as columns when inserting into `vehicle_images`
4. Also store raw EXIF in `exif_data` JSONB

This alone maps 83K+ photos with GPS in one batch run.

### 1B. Backfill GPS From EXIF on Existing Images

34.7M images exist. Most were scraped from BaT/auction sites — those won't have GPS (web-stripped EXIF). But the ~9K user uploads and ~5K owner imports might. And the `exif_data` JSONB may already contain GPS that was never extracted to the top-level columns.

```sql
-- Find images with GPS buried in exif_data but not in top-level columns
UPDATE vehicle_images
SET latitude = (exif_data->'location'->>'latitude')::double precision,
    longitude = (exif_data->'location'->>'longitude')::double precision
WHERE latitude IS NULL
  AND exif_data->'location'->>'latitude' IS NOT NULL
LIMIT 1000;  -- batch it per BATCHED MIGRATION PRINCIPLE
```

Also re-run `reprocess-image-exif` edge function on all `source IN ('user_upload', 'iphoto', 'owner_import')` images that have `exif_data IS NULL`.

### 1C. Frontend Upload: Ensure GPS Always Flows Through

The client-side EXIF extraction (`imageMetadata.ts` using `exifr`) already extracts GPS. Verify:
1. `ImageUploadService.uploadImage()` passes `latitude`/`longitude` to the DB insert
2. The `photo-pipeline-orchestrator` doesn't overwrite GPS with null
3. Reverse geocoding populates `location_name` from coordinates

---

## Phase 2: The Photo Map Layer

Add a new layer to `UnifiedMap.tsx` that renders user photos as map pins.

### Data Source

```sql
-- Images with GPS for the map
SELECT id, vehicle_id, image_url, thumbnail_url, latitude, longitude,
       taken_at, ai_detected_vehicle, ai_detected_angle, source,
       documented_by_user_id, location_name
FROM vehicle_images
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
ORDER BY taken_at DESC
LIMIT 50000;
```

### Layer Design

At continent/country zoom (z3-z6):
- Cluster thumbnails (like Apple Photos Map)
- Show count badges on clusters
- Glow layer showing photo density

At city zoom (z8-z10):
- Individual thumbnail pins
- Hover shows photo preview + date + location
- Color-coded by source (blue=user, orange=iphoto, green=auction)

At street zoom (z12+):
- Full thumbnail previews at exact GPS locations
- Click opens side panel with full image + EXIF details
- Camera heading indicator (arrow showing which way the camera was facing)
- If multiple photos at same location → fan them out or stack with count

### Timeline Integration

Photos have `taken_at` timestamps. The timeline slider (already built) filters photos just like vehicles. Scrub from 2020→2026 and watch your photo footprint grow across the map.

---

## Phase 3: User Activity Heatmap

Once photos carry GPS, we can build a user's spatial fingerprint:

```sql
-- Where does this user take photos?
SELECT
  ST_SnapToGrid(ST_MakePoint(longitude, latitude), 0.01) as grid_cell,
  COUNT(*) as photo_count,
  MIN(taken_at) as first_visit,
  MAX(taken_at) as last_visit,
  array_agg(DISTINCT ai_detected_vehicle->>'make') as makes_photographed
FROM vehicle_images
WHERE documented_by_user_id = $user_id
  AND latitude IS NOT NULL
GROUP BY grid_cell;
```

This produces:
- **Home base detection**: Where does the user take the most photos? That's likely their garage/shop.
- **Travel patterns**: Routes between photo clusters
- **Specialization zones**: "This user photographs Porsches in LA and trucks in Nevada"
- **Temporal patterns**: Weekend warrior vs daily documenter

### Profile Map Tab

Each user profile gets a "Map" tab showing:
- Their photo locations as a heatmap
- Their vehicles plotted where they were photographed
- A timeline showing their spatial activity over time
- Stats: "432 photos across 12 cities, 6 states"

---

## Phase 4: Camera Angle + Scene Reconstruction

### 4A. Camera Heading from EXIF

iPhone photos include `GPSImgDirection` in EXIF — the compass heading the camera was facing. Extract this:

```typescript
// In exifr extraction
const heading = exif.GPSImgDirection; // 0-360 degrees
// Store in vehicle_images.yaw_deg
```

On the map, render an arrow or cone from each photo pin showing camera direction. This immediately tells you "this photo was taken facing northeast at this parking lot."

### 4B. Multi-Photo Location Clustering

When multiple photos share a location (within ~50m):

```sql
-- Find photo clusters
SELECT
  ST_ClusterDBSCAN(ST_MakePoint(longitude, latitude), eps := 0.0005, minpoints := 3)
    OVER () as cluster_id,
  id, latitude, longitude, taken_at, ai_detected_angle, yaw_deg
FROM vehicle_images
WHERE documented_by_user_id = $user_id
  AND latitude IS NOT NULL
ORDER BY cluster_id, taken_at;
```

Each cluster = a "scene" (a garage, a car show, a parking lot). Multiple angles of the same scene = potential 3D reconstruction input.

### 4C. Vision Model: Angle + Scene Classification

YONO already classifies `ai_detected_angle` (front, rear, side, interior, engine_bay, etc.). Extend to:

1. **Scene type**: garage, parking lot, road, showroom, auction floor, gas station, driveway
2. **Lighting**: natural daylight, overcast, golden hour, flash, indoor fluorescent
3. **Camera height**: ground level, standing, elevated, aerial
4. **Relative vehicle position**: centered, left third, background, partial

This metadata, combined with GPS + heading, gives you enough to place every photo in 3D space.

---

## Phase 5: Timeline Simulation

### The "Life Playback" View

A dedicated full-screen mode:

1. Map centered on user's home base
2. Timeline bar at bottom spans their entire photo history
3. Press play → map animates through time:
   - Camera smoothly follows the user's photo trail
   - Photos appear at their GPS locations as time passes
   - Vehicle pins light up when a new photo documents them
   - Lines connect sequential photos (travel path)
   - Speed: 1 month per second (adjustable)

### Data Requirements

All of this works with data that already fits in existing columns:
- `taken_at` → when (temporal axis)
- `latitude`/`longitude` → where (spatial axis)
- `ai_detected_vehicle` → what (content)
- `yaw_deg` → camera direction
- `documented_by_user_id` → who

### Future: 3D Scene Reconstruction

When a location has 10+ photos from different angles:
- Feed to NeRF or Gaussian splatting pipeline
- Generate 3D model of the scene
- Place the 3D model at its GPS coordinate on the map
- Timeline scrubber shows the scene changing over time (vehicle being built, painted, modified)

This is the "my future family can live my life" moment. Every garage session, every car show, every road trip — reconstructed spatially and temporally from the photos you already took.

---

## Implementation Priority

### Do Now (this session)
1. **Fix `iphoto-intake.mjs`** to extract GPS + taken_at from `osxphotos` metadata
2. **Re-run intake** for all 83K photos with GPS metadata flowing through
3. **Backfill** `latitude`/`longitude` from `exif_data` JSONB where it exists

### Do Next (next session)
4. **Photo map layer** in UnifiedMap — render GPS-tagged images as pins
5. **Thumbnail clustering** at low zoom, individual pins at high zoom
6. **Side panel** shows full image + EXIF + location when clicked

### Do Later (planned)
7. Camera heading arrows on map pins
8. User profile "Map" tab with activity heatmap
9. Scene clustering (DBSCAN on photo locations)
10. Timeline playback animation
11. 3D reconstruction pipeline (NeRF/Gaussian splatting)

---

## Key Technical Notes

- `vehicle_images` already has 143 columns including everything needed
- GPS columns: `latitude` NUMERIC, `longitude` NUMERIC (NOT double precision — check compatibility)
- EXIF: `exif_data` JSONB with nested `location.latitude`, `location.longitude`
- Camera: `camera_pose` JSONB, `yaw_deg` REAL, `ai_detected_angle` TEXT
- Timeline: `taken_at` TIMESTAMPTZ
- PostGIS is active — can use `ST_MakePoint`, `ST_Distance`, `ST_ClusterDBSCAN`
- `osxphotos` CLI can output full metadata JSON including GPS per photo
- The `reprocess-image-exif` edge function already handles server-side EXIF extraction
- `vehicle_location_observations` table exists for time-series location data with `source_type = 'exif'`
- Photo pipeline orchestrator (`photo-pipeline-orchestrator`) triggers on new image inserts

## The Thesis

User data starts with images because images are the richest atom of user-contributed data. Every photo carries:
- **Where** you were (GPS)
- **When** you were there (timestamp)
- **What** you were looking at (content — vehicle, scene)
- **How** you saw it (camera angle, device)
- **Who** you are (user attribution)

Map all five dimensions and you don't just have a photo gallery — you have a spatial-temporal reconstruction of a person's relationship with vehicles. That's the product. That's what makes Nuke different from every other car platform.

The 83K photos in your Apple Photos library are the proof of concept. Get those mapped, and the vision sells itself.
