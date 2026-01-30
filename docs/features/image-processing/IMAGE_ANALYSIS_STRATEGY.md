# Image Analysis Strategy: User-Manipulable, Gap-Aware, Integrity-Ready

> **Goal**: Image analysis is the last bastion against duplicate images, AI fakes, Photoshop (with leniency), and bad metadata. It must be tip-top, always ready, and support very specific user-manipulable queries (e.g. "only vehicle cards from 140° angle at 50mm FOV"). We can run on a free/cheap LLM to reduce costs and don't have to run it on every image always.

## 1. Why Image Analysis Matters

- **Content identification**: What’s in each image (subject taxonomy, 3D angle, FOV) so we can serve **user-manipulable prompts**.
- **User queries**: e.g. "Show me all vehicle cards from the latest 140° angle at 50mm FOV" — requires angle/FOV/axis in 3D space relative to vehicle center for all vehicles.
- **Gap detection**: Which vehicles have incomplete coverage → hire photography service to fill gaps.
- **Integrity**: Fight duplicates, AI fakes, Photoshop (with some leniency), and bad metadata/source/origin/org/entity associations.

## 2. What We Have Today

### 2.1 Schema (already built)

- **vehicle_images**: `ai_scan_metadata`, `ai_detected_angle`, `ai_detected_angle_confidence`, `perceptual_hash`, `dhash`, `file_hash`, `is_duplicate`, `duplicate_of`, source/origin/org/entity via attribution.
- **image_camera_position**: 3D camera position per image — `azimuth_deg`, `elevation_deg`, `distance_mm`, `camera_x/y/z_mm`, `subject_key`, `confidence`, `evidence` (now includes `lens_angle_of_view_deg`, `focal_length_mm`).
- **image_angle_spectrum**: Zones, precise x/y/z coordinates, `lens_angle_of_view`, `focal_length_mm` (camera geometry).
- **subject taxonomy**: Hierarchical keys (e.g. `exterior.panel.fender.rear.passenger`).

### 2.2 Analysis pipeline

- **analyze-image** (edge function): Gemini Flash first (~$0.0001/image), fallback GPT-4o-mini. Outputs subject, camera position (azimuth, elevation, distance), and **FOV/focal** (added): `lens_angle_of_view_deg`, `focal_length_mm` in prompt and stored in `image_camera_position.evidence` + `ai_scan_metadata.appraiser`.
- **Rekognition**: Labels, bounding boxes (~$0.001/image).
- **Cost**: Default is already cheap (Gemini); we don’t have to run on every image — batch on demand or on a schedule.

### 2.3 User-manipulable queries

- Filter by **angle**: `image_camera_position.azimuth_deg`, `elevation_deg`, or zone (`angle_spectrum_zones`).
- Filter by **FOV/focal**: `evidence->>'lens_angle_of_view_deg'`, `evidence->>'focal_length_mm'` (or columns on `image_angle_spectrum` when populated).
- Filter by **subject**: `subject_key` (e.g. `exterior.trim.grille`).
- Example: "All shots at ~50mm FOV and 140° azimuth" → query `image_camera_position` + `evidence` (or join `image_angle_spectrum` when used).

## 3. User-Manipulable Prompts

- **Back end**: Analysis prompt already includes 3D coordinates, subject taxonomy, and FOV/focal. Stored in `image_camera_position` and `ai_scan_metadata`.
- **API / RPC**: Expose filters for angle (azimuth/elevation or zone), FOV/focal range, subject key, vehicle, so the frontend can build "only 140° at 50mm FOV" type queries.
- **Frontend**: Filters/dropdowns for angle zone, FOV band (e.g. wide / normal / tele), focal length range, subject — all backed by the same schema.

## 4. Gap Detection (Incomplete Data Sets)

- **Per-vehicle coverage**: For each vehicle, which angle zones / FOV buckets have at least one image? Missing zones = gaps.
- **Use case**: Report "vehicles missing rear three-quarter driver at 50mm" → hire photographer for those angles.
- **Implementation**:
  - **Option A**: RPC or view that, per vehicle (or per make/model/year), counts images per zone (from `image_camera_position` + zone mapping or `image_angle_spectrum`). List zones with count = 0.
  - **Option B**: Use existing **analyze-image-gap-finder** for *context* gaps (missing docs/receipts). Add a separate **coverage-gap** report: "missing angle/FOV coverage" per vehicle or segment.
- **Output**: List of vehicle IDs (or segments) and missing angle/FOV combinations so you can commission photography.

## 5. Integrity: Duplicates, Fakes, Photoshop

- **Duplicates**: Use `perceptual_hash`, `dhash`, `file_hash` on `vehicle_images`; mark `is_duplicate` / `duplicate_of` when hashes or similarity exceed threshold. Analysis doesn’t have to run for every duplicate check — run hashing on ingest and periodic batch.
- **AI fakes / synthetic**: Optional in analysis: ask the model "probability this image is synthetic or heavily AI-generated" (or use a dedicated classifier). Store in `ai_scan_metadata` (e.g. `integrity.synthetic_score`) and optionally flag for review.
- **Photoshop / heavy edit**: Optional: "probability of heavy digital manipulation" with **leniency** (e.g. only flag above 0.8). Store in `ai_scan_metadata.integrity.edit_score`. Don’t block; use for ranking or review.
- **Metadata / source / origin**: Already tracked via attribution, source, origin_metadata, org/entity. Analysis can add a consistency check (e.g. "does the visible content match the stated source?").

## 6. Cost: Free / Cheap LLM

- **Current**: Gemini Flash first (~$0.0001/image), then GPT-4o-mini. We don’t have to run on every image.
- **Strategy**:
  - **On upload**: Optional quick analysis (e.g. Gemini only) for critical fields (angle, subject, FOV if possible).
  - **Batch**: Run full analysis (Gemini or free-tier Gemini) on a schedule or on-demand for unprocessed images; rate-limit to stay within free tier if desired.
  - **Expensive models**: Reserve for gap-finder (context gaps) or one-off high-stakes images; keep default pipeline on cheap/free.
- **Always ready**: Pipeline is deployed and configurable; run it when needed (upload, batch, or gap report) rather than blocking on cost.

## 7. Checklist: Keep Analysis Tip-Top

- [x] **FOV/focal in prompt and storage**: `lens_angle_of_view_deg`, `focal_length_mm` in Gemini + GPT prompts and in `image_camera_position.evidence` + appraiser JSON.
- [ ] **API/RPC for angle/FOV/subject filters**: So frontend can serve "only 140° at 50mm FOV" and similar.
- [ ] **Coverage-gap report**: Per vehicle (or segment), which angle/FOV zones have no images; output for hiring photographers.
- [ ] **Duplicate detection**: Ensure perceptual_hash/dhash populated on ingest; periodic batch to set `is_duplicate` where appropriate.
- [ ] **Optional integrity fields**: synthetic_score, edit_score in `ai_scan_metadata` with leniency; optional model step or separate job.
- [ ] **Documentation**: Point UI and scripts at this strategy and at the schema (image_camera_position, image_angle_spectrum, vehicle_images).

## 8. Example Queries (after FOV/angle populated)

```sql
-- All images at ~50mm FOV (from evidence)
SELECT vi.id, vi.vehicle_id, vi.image_url, icp.azimuth_deg, icp.elevation_deg,
       (icp.evidence->>'focal_length_mm')::numeric AS focal_length_mm,
       (icp.evidence->>'lens_angle_of_view_deg')::numeric AS fov_deg
FROM vehicle_images vi
JOIN image_camera_position icp ON icp.image_id = vi.id
WHERE (icp.evidence->>'focal_length_mm')::numeric BETWEEN 45 AND 55
  AND icp.confidence > 0.6;

-- Coverage gaps per vehicle: zones with zero images (pseudo – zone from azimuth/elevation bands)
SELECT v.id AS vehicle_id, v.year, v.make, v.model,
       z.zone_name,
       COUNT(icp.image_id) AS image_count
FROM vehicles v
CROSS JOIN angle_spectrum_zones z
LEFT JOIN image_camera_position icp ON icp.vehicle_id = v.id
  AND get_angle_zone(icp.azimuth_deg, icp.elevation_deg, 0) = z.zone_id
WHERE v.id = $1
GROUP BY v.id, v.year, v.make, v.model, z.zone_id, z.zone_name
HAVING COUNT(icp.image_id) = 0;
```

## 9. References

- **3D coordinate system**: `docs/archive/internal-20260128/IMAGE_ANALYSIS_3D_COORDINATE_SYSTEM.md`
- **Camera geometry**: migrations `20250128000006_3d_angle_spectrum_system.sql`, `20250128000007_camera_geometry_system.sql`
- **Analyze-image**: `supabase/functions/analyze-image/index.ts` (Gemini + GPT prompts, insertCameraPosition, evidence)
- **Gap finder (context)**: `supabase/functions/analyze-image-gap-finder/index.ts`
- **Image analysis system**: `docs/features/image-processing/IMAGE_ANALYSIS_SYSTEM.md`
