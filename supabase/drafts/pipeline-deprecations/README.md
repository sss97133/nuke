# Image pipeline: coverage gaps first, then true duplicates

Read-only audit, measured 2026-11-23 (America/Los_Angeles) against project `qkgaybvrernstplzjaam`.
Nothing in this folder has been applied. Every SQL file is a draft for review.

Scope: `public.vehicle_images` (66,175,274 rows est.; heap 59 GB, indexes 17 GB, 78 GB total), its
landing tables, the image columns on `public.vehicles` (1,485,904 rows), the JSON keys inside
`vehicle_images.ai_scan_metadata`, and the functions, triggers and crons that touch them.

Owner correction (2026-11-23): an empty column usually means no prompt asks for it. So a low-fill
column is a **COVERAGE GAP** unless a newer column or table already holds the same fact. Only true
duplicates and superseded fields go into the retirement stages below.

## How the numbers were measured

* Fill: `pg_stats.null_frac` for every column (planner sample, ~30k rows). Where a JSON answer
  could fill a column, a 0.5% `TABLESAMPLE SYSTEM` (330,644 rows) was scaled by 200.1. Expect about
  ±10% on the small counts.
* Writers and readers: `git grep -w` over `origin/main` (edge functions, iOS `Sources/`,
  `nuke_frontend/src`, `scripts/`), plus `pg_proc.prosrc` for the 452 SQL functions that mention
  `vehicle_images`, `pg_depend` for views, `pg_trigger` and `cron.job`.
* Usage: `pg_stat_user_indexes` and `pg_stat_user_tables`. `stats_reset` is null. Insert counters are
  low (2.4M on a 66M table), so the counters have reset recently. Read a 0-scan index as "unused
  since the last reset", not "never used".
* Fewer than 1 in 30,000 rows is shown as 0%.

## 1. Coverage gaps (primary finding)

A *prompt or extractor* is the thing that should produce the field. **Asks?** says whether its
prompt text or output schema requests it. **Free backfill** counts rows whose answer is already
stored in `ai_scan_metadata` and can be projected without reading another pixel. **Re-read** counts
rows that need a model or device pass.

| # | Column(s) | Fill | Prompt / extractor that should fill it | Asks? | Free backfill | Re-read needed |
|---|---|---|---|---|---|---|
| 1 | `image_category` (and `category` stuck at `general`/`gallery`) | 0.014% | legacy Gemini `classifier.ts PROMPT` and v98 `renderPromptV2`, field `image_type` | yes, but no projection to a column | ~9.06M | 0 |
| 2 | `caption` → should be `image_descriptions` | 0.009% (`image_descriptions` 5,379 rows) | both classifier prompts, field `description` | yes, stays in JSON | ~9.07M | 0 |
| 3 | `ai_detected_angle`, `ai_detected_angle_confidence` (`angle` too) | 0.13% | legacy Gemini PROMPT: **no**. v98: yes (`angle.value/confidence`), written by `persistV98Columns` only when conf ≥ 0.6 | legacy no | ~465k coarse (from `image_type`) | ~9.07M legacy-classified rows |
| 4 | `ai_detected_vehicle` (make/model/year hints) | 0.056% | legacy PROMPT `vehicle_hints{make,model,year_range,color}` | yes, never projected | ~358k make, ~474k color | n/a |
| 5 | detected text → `photo_text_lines` | 29,485 rows total | legacy PROMPT `detected_text[]`; v98 `text_lines[]` | yes; legacy never projected | ~327k | 0 |
| 6 | `is_document`, `document_category` | 0.001% | legacy PROMPT: **no**. v98: yes | legacy no | ~7.2k (`image_type=receipt_document`, `is_document` not true) | ~9.07M |
| 7 | `vehicle_vin` (+ `vehicles.vin_source_image_id`, 0 of 1.49M) | 0.001% | legacy `vin_detected`; v98 `vin{value,evidence}` | yes | ~2.4k valid 17-char reads (checksum gate first) | n/a |
| 8 | `components`, `camera_pose`, `ai_component_count` | 0.005% | BYOK deep read (`scripts/lib/byok-stage-schema.mjs`: `camera_pose`, `components_seen`) | yes; projector `promote_image_depth_to_columns()` exists but nothing calls it | ~20k | rest |
| 9 | `fabrication_stage` (`process_stage` is its duplicate) | 0.009% | deep read `build_phase_guess`; registry key `image_visible_assembly_state` exists | yes, not projected | ~16.8k | rest |
| 10 | `damage_type`, `damage_flags` | 0% / almost all `{}` | deep read `damage_localized[]`, `rust_severity`; registry `image_visible_rust_severity` | yes, not projected | ~4.4k | rest |
| 11 | `sensitive_type` (`is_sensitive` typed) | ~0% | iOS `VNDetectFaceRectanglesRequest` (VisionEngine.swift:248); deep read `presence.person` | device computes, does not upload; deep read asks | ~1.4k (deep) | ~31k owner photos on device |
| 12 | `vehicle_score` | 0.001% | iOS VisionEngine vehicle score / `isVehicle` | computed on device; not in `VehicleImageRow` | 0 | ~31k owner photos (device re-push) |
| 13 | `dhash` / `phash` | 0.008% / 0.005% | iOS `PerceptualHash.dHash` (LibraryIngest.swift:442); `scripts/backfill-perceptual-hash.py` | device computes; upload row drops it | 0 | ~31k on device; 66M server-side |
| 14 | `apple_ml_labels` | 0.027% (~18k) | iOS `VNClassifyImageRequest` | yes for new uploads | 0 | ~13k older owner photos (`LocalTagPush`) |
| 15 | `vehicle_zone`, `zone_confidence`, `condition_score`, `photo_quality_score` | 0.4–0.6% | retired YONO lane; nothing current asks for zone or quality | no | 0 | all; land through registry keys, not these columns |

### Prompts with the biggest gaps

1. **Legacy Gemini classifier `PROMPT`** (`supabase/functions/photo-pipeline-orchestrator/classifier.ts:60`).
   It answered about 99.8% of the ~9.07M classified images (Feb–Oct 2026). It never asks for angle,
   `is_document`, document category or type, evidence-bound VIN, `vehicle_fields` or text regions.
   The fields it does ask for (`image_type`, `description`, `vehicle_hints`, `detected_text`) are
   almost never projected out of JSON. It is still the Gemini fallback prompt.
2. **v98 manifest prompt** (`classifierProvider.ts renderPromptV2`). It asks for the right fields
   but has covered only ~18k images since 2026-11-02. `persistV98Columns` lands only `is_document`,
   `document_category`, `vehicle_vin` and `ai_detected_angle`; it never writes `image_category`,
   description or text lines to columns. About 3.17M rows from July 2026 carry
   `classifier_ok=false` and have no answer at all. Per AGENTS.md (2026-11-20), OpenAI is out of
   quota and Gemini refuses on billing, so a re-read must go through the subscription reader
   (`reader:claude-cli`, already seen writing v98).
3. **BYOK deep read schema** (`scripts/lib/byok-stage-schema.mjs`, `scripts/daily-receipt/byok-vision-prompt.md`).
   It asks for the richest set: pose, components, damage, build phase, rust, paint and presence. All
   of it stays in `ai_scan_metadata.byok_deep_analysis` (~22k images), and the projector is orphaned.
4. **iOS Vision** (`VisionEngine.swift`, `OnDeviceAnalysis.swift`). It computes classify labels,
   faces, a feature print, OCR text, a vehicle score and a dHash. It uploads only `apple_ml_labels`
   and EXIF.

### Suggested additions (within the AGENTS.md "Reading photos" rule: no new reader, vocabulary or per-photo table)

* Classifier: retire the legacy `PROMPT` as the Gemini fallback, so Gemini gets `renderPromptV2` too.
  Then `persistV98Columns` also writes `image_category` from `image_type`.
* Projection only (free): `image_type` → `image_category`; `description` → `image_descriptions`;
  `detected_text` → `photo_text_lines`; `vehicle_hints` → `ai_detected_vehicle` (uncited guesses,
  never `vehicles` facts); valid `vin_detected` → `vehicle_vin` through `qualifyVinRead`. See
  `10_coverage_backfills_DRAFT.sql` (counts first, guarded batches commented out).
* Deep read: call `promote_image_depth_to_columns()` after `project_reviewed_image_analysis`. Map
  `build_phase_guess`, `rust_severity` and paint onto the existing registry keys
  `image_visible_assembly_state`, `image_visible_rust_severity` and `image_visible_paint_stage`. No
  registry key exists for view/angle, damage type, document kind or person presence; propose those
  through `schema_proposals`.
* iOS: add `vehicle_score`, `dhash` and a face count (→ `is_sensitive`/`sensitive_type='face'`) to
  `VehicleImageRow`, and extend `LocalTagPush` to re-push them for already-synced photos.

## 2. Dangling readers that are bugs

1. **`photo-pipeline-orchestrator/index.ts:475,539`** reads `vehicle_score` to skip paid
   classification of non-vehicle frames. iOS never sends it, and only `image-intake` writes it
   (0.001% of rows), so the skip never fires.
2. **`nuke_frontend/src/services/valuationEngine.ts:320`** reads `damage_type` (never written) and
   `damage_flags` (only the retired lane wrote it). Valuation never sees image damage.
3. **`ImageGallery.tsx:4011,4107`** shows `ai_last_scanned` (0.016% fill). Its last writer is
   `update_image_ai_metadata()`, a trigger function for the dropped table `ai_component_detections`.
   Analysed images show as unscanned. Repoint to `vision_analyzed_at` / `ai_processing_completed_at`,
   which `UserRecentPhotos.tsx` already uses.
4. **`useImageViewerState.ts:79`** filters on `process_stage` and `workflow_role`. Both are 0 rows,
   so the filter always returns nothing.
5. **~7.2k legacy rows** classified `receipt_document` are not marked `is_document`. Galleries
   exclude documents by `is_document`, so these documents can still show.
6. **885 `vehicles` rows have `primary_image_url = 'jpg'`** (895 are not http URLs). Hero images are
   broken. `vehicles.image_url` disagrees with `primary_image_url` on 12,999 rows.
7. **Drop blockers, not bugs today:**
   * `doc_flag` is read by 17 SQL functions plus `withdraw_reviewed_image_analysis` (trigger), the
     orchestrator, `reviewedAnalysis.ts`, `_shared/vehicleAssessment.ts`,
     `generate-listing-package`, and iOS `AttributionEngine`/`LibraryPrivacyGate`. It is always
     ORed with `is_document`.
   * `VEHICLE_IMAGE_PUBLIC_COLUMNS` (`nuke_frontend/src/lib/vehicleImageColumns.ts`) names every
     column, so any drop breaks signed-out reads.
   * The views `vehicle_images_public`, `user_organized_photos` and `user_photo_inbox` depend on
     most retirement columns.

## 3. True duplicates and superseded fields (retirement candidates)

| Column | Class | Replacement | Fill | Est. bytes on disk | SQL readers | App refs |
|---|---|---|---|---|---|---|
| `user_tags` | DEAD (default `{}` only) | `image_tags` | 100% default | 860 MB | 0 | types only |
| `spatial_tags` | DEAD (default only) | `image_coordinate_observations` | 100% default | 860 MB | `migrate_existing_ai_data` (orphan) | tagging-constants.ts (constant name) |
| `processing_models_used` | DEAD (default only) | `classifier_receipt` | 100% default | 860 MB | 0 | types only |
| `verification_status` | DUPLICATE (single value `approved`) | `approval_status` / `vision_gate_status` | 100% | 596 MB | `create_citation_from_ai_component`, `device_create_vehicle_profile` | generic name, verify |
| `uploaded_at` | DUPLICATE | `created_at` (identical values) | 100% | 529 MB | 4 fns | ~6 web files |
| `analysis_history` | DEAD (default only) | `image_stage_receipts` | 100% default | 463 MB | 0 | 0 |
| `ai_suggestions` | DEAD (default only) | `auto_suggested_vehicle_id` | 100% default | 331 MB | `get_unorganized_photos_optimized` | personalPhotoLibraryService.ts |
| `context_score` | DEAD (default 0) | none | 100% default | 265 MB | 0 | 0 |
| `total_processing_cost` | DEAD (default 0) | spend ledger | 100% default | 199 MB | 0 | 0 |
| `filename` | DUPLICATE, still written | `file_name` | 2.2% | 29 MB | 7 fns incl. `insert_vehicle_image_bulk` | iOS asset JSON only (noise) |
| `labels` | SUPERSEDED (Rekognition) | `apple_ml_labels` / `image_tags` | 0.024% | 2 MB | 13 fns (generic name; review) | — |
| `ai_last_scanned` | SUPERSEDED | `vision_analyzed_at` | 0.016% | <1 MB | `update_image_ai_metadata` (orphan) | ImageGallery, UserRecentPhotos, globalUploadStatusService, forensic-deal-jacket |
| `perceptual_hash` | DUPLICATE | `phash` | 0.005% | <1 MB | `admin_image_radar`, `find_duplicate_images`, `ingest_image_identity_first` | AdminMissionControl, imageDuplicateLinker, imageUploadService |
| `image_context` | SUPERSEDED | `source` | 0.005% | <1 MB | 0 | VehicleTimeline, useVehicleTimeline |
| `process_stage` | DUPLICATE | `fabrication_stage` | 0% | 0 | 0 | AddEventWizard, unifiedImageImportService, useImageViewerState |
| `angle_confidence` | SUPERSEDED | `ai_detected_angle_confidence` | 0% | 0 | `get_inventory_angle_coverage_metrics` | 0 |
| `doc_flag`, `doc_confidence`, `document_classification` | DUPLICATE | `is_document`, `document_category` | 0% | 0 | 17 + trigger (doc_flag) | see §2.7; imageUploadService |
| `yaw_deg`, `yaw_confidence`, `perspective`, `surface_coord_u`, `surface_coord_v` | SUPERSEDED | `image_camera_position` (707k rows), `image_coordinate_observations` (111k) | 0% | 0 | 0 | AdminMissionControl; api-v1-vision, yono-analyze |
| `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_confidence`, `vehicle_source` | SUPERSEDED | `photo_extracted_fields` (122k cited rows) / `ai_detected_vehicle` | 0% | 0 | `find_duplicate_image`, `get_orphan_sessions`, `get_user_profile_photos`, `check_bundle_fits_timeline` | generic names, verify |
| `location_confidence` | SUPERSEDED | `admit_photo_gps_locations` output | 0% | 0 | 0 | anon-exclusion list |
| `temp_session_id`, `pending_submission_id`, `task_id`, `workflow_role`, `safe_preview_url`, `optimized_at`, `yono_queued_at` | DEAD | none | 0% | 0 | `claim_yono_vision_batch` (orphan) for `yono_queued_at` | useImageViewerState (`workflow_role`), mcp-connector comment |

Columns deliberately **not** retired, because they are coverage gaps: `damage_type`,
`fabrication_stage`, `sensitive_type`, `vehicle_score`, `phash`/`dhash`, `components`,
`camera_pose`, `caption`, `image_category`, `is_document`, `document_category`, `ai_detected_angle`,
`vehicle_vin`, `apple_ml_labels`, the video columns (`ScreenCaptureSync` writes them; no recordings
synced yet), and the zone/quality columns.

Later candidates, outside this batch: `angle` vs `ai_detected_angle` (9 SQL readers and 8 views read
`angle`), `is_approved` vs `approval_status`, `vehicles.image_url` vs `vehicles.primary_image_url`.

## 4. Indexes, orphaned functions and crons

* Unused since the last stats reset: `idx_vehicle_images_condition_score` (0 scans, 4 MB),
  `idx_vehicle_images_zone_not_null` (1 scan, 15 MB). `idx_vehicle_images_image_identity_id` also has
  0 scans but backs a foreign key, so keep it.
* Oversized: five indexes lead with `user_id`, a column that is NULL on 99.95% of rows: `user_sync`
  6,322 MB, `user_created` 1,265, `user_capture_stats` 1,018, `user_contrib_day` 793 and
  `user_taken_at` 730. All of them index the NULLs. Making each partial (`WHERE user_id IS NOT NULL`)
  keeps every `user_id = $1` plan and frees about 10.1 GB. `idx_vehicle_images_auto_suggested_vehicle_id`
  is a full 629 MB index on a 99.998%-NULL column; making it partial frees about 0.63 GB. See
  `50_index_rightsizing_DRAFT.sql`.
* Orphaned functions (no trigger, cron, SQL caller or repo caller): `migrate_existing_ai_data`,
  `extract_ai_analysis_to_fields`, `update_image_ai_metadata` (its table `ai_component_detections`
  is gone), `backfill_photo_analysis`, `claim_yono_vision_batch`, `backfill_organization_status` and
  `find_duplicate_images`. `promote_image_depth_to_columns` is also orphaned, but wire it up rather
  than drop it (gap 8).
* Inactive crons: `classify-auction-source`, `document_ocr_queue_lock_release`,
  `photo-pipeline-drain-b`, `weekly-analyze-vehicle-images`. The last one matters: `pg_stats` on a
  66M-row table goes stale without it.
* Backup tables: `bak_vehicle_image_listing_links_dups_20261103` (314 MB),
  `bak_vehicle_images_dupflag_20261103` (108 MB), and ~20 `backup_2026110x_*` tables (a few MB each).

## 5. Reclaimable space

| Item | Est. |
|---|---|
| Retired columns (only after a table rewrite; `DROP COLUMN` alone frees nothing) | ~5.0 GB |
| Partial `user_id` indexes | ~10.1 GB |
| Partial `auto_suggested_vehicle_id` index + 2 unused indexes | ~0.65 GB |
| `bak_*` / `backup_*` image tables | ~0.45 GB |
| **Total** | **~16.2 GB** of 78 GB |

## Stages (draft only; nothing here is applied)

* `20_stage1_stop_writers_repoint.md` lists, per column, the writers to stop and the readers to
  repoint. `21_stage1_guard.sql` adds a warning-only trigger that reports any write to a retired
  column during the release, plus `COMMENT ON COLUMN` markers. Revert: `21_stage1_guard_revert.sql`.
* `30_stage2_rename_deprecated.sql` renames each column to `<col>_deprecated` for one release. Views
  follow a rename automatically. Revert: `30_stage2_rename_deprecated_revert.sql`.
* `40_stage3_drop.sql` takes a sparse-value backup table, recreates the dependent views without the
  columns, and drops them. `40_stage3_drop_revert.sql` re-adds the columns with their original types
  and defaults and restores values from the backup.
* `50_index_rightsizing_DRAFT.sql` uses `CREATE INDEX CONCURRENTLY` partial replacements, then drops
  the old indexes. Its revert block recreates the originals from the captured definitions.
* `00_evidence_queries.sql` holds the read-only queries behind every number above.
