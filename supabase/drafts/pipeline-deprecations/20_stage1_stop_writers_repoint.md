# Stage 1: stop writers, repoint readers (ships as one release with 21_stage1_guard.sql)

Every line below cites a reference on `origin/main` as of 2026-11-23. Generic names (`labels`,
`verification_status`, `vehicle_make/model/year`, `filename`, `uploaded_at`) also exist on other tables,
so confirm that each hit reads `vehicle_images` before editing it.

## Must land before stage 2 (they name columns explicitly)

| Reader | What to change |
|---|---|
| `nuke_frontend/src/lib/vehicleImageColumns.ts` `VEHICLE_IMAGE_PUBLIC_COLUMNS` (signed-out reads) | Remove all 37 candidate names. Otherwise PostgREST refuses the anon select after the rename. |
| `nuke_frontend/src/lib/vehicleImageColumns.ts` `VEHICLE_IMAGE_ANON_EXCLUDED_COLUMNS` | Drop `location_confidence`. |
| Generated types (`database.types.ts`) | Regenerate after stage 2. |
| Views `vehicle_images_public`, `user_organized_photos`, `user_photo_inbox`, `organized_ai_analysis`, `v_books_audit_tiers` | No change in stage 2 (a rename carries through). Stage 3 swaps each candidate for `NULL::type AS col` so the view keeps its shape. |

## Per column

| Column | Writers to stop | Readers to repoint → replacement |
|---|---|---|
| `doc_flag` | none live (4 rows from 2026-10-06) | SQL: `attribute_testimony`, `capture_sets_build`, `capture_sets_score`, `compute_retained_analysis_widget`, `contributor_retained_reading_for`, `evaluate_contributor_evidence_item`, `get_service_vehicles_for_org`, `get_user_contribution_calendar`, `get_user_contribution_days`, `get_user_day_receipt`, `get_vehicle_specs`, `guard_reviewed_image_analysis`, `image_stage_gaps`, `image_stage_photo_levels`, `profile_fix_review_resolve_v1`, `project_reviewed_image_analysis`, `record_vin_upload_exposures`, trigger fn `withdraw_reviewed_image_analysis`. Edge: `photo-pipeline-orchestrator/index.ts`, `photo-pipeline-orchestrator/reviewedAnalysis.ts`, `_shared/vehicleAssessment.ts`, `generate-listing-package/index.ts`. iOS: `AttributionEngine.swift` (row struct and 5 uses), `LibraryPrivacyGate.swift`. Each `OR doc_flag` becomes nothing (it is always ORed with `is_document`). |
| `doc_confidence`, `document_classification` | `imageUploadService.ts` (`document_classification`) | `v_books_audit_tiers` → `document_category` |
| `angle_confidence` | none | `get_inventory_angle_coverage_metrics` → `ai_detected_angle_confidence` |
| `yaw_deg`, `yaw_confidence`, `perspective`, `surface_coord_u/v` | `api-v1-vision`, `yono-analyze` (surface coords; YONO is retired) | `AdminMissionControl.tsx` (`yaw_deg`) → `image_camera_position` |
| `vehicle_make/model/year/confidence/source` | none | `find_duplicate_image`, `get_orphan_sessions`, `get_user_profile_photos`, `check_bundle_fits_timeline` (verify the table), iOS `ProfilePhotos.swift` (verify) → `ai_detected_vehicle` / `photo_extracted_fields` |
| `uploaded_at` | the column default (dropped in 21) | `backfill_vehicle_image_positions`, `job_evidence_candidates_read`, `queue_images_for_ai_analysis`, `update_vehicle_stats`; web `VehicleOwnershipPanel`, `KnowledgeLibrary`, `VehicleReferenceLibrary`, `VehicleEditModal`, `Library`, `OrganizationProfile` (verify each reads `vehicle_images`) → `created_at` |
| `filename` | `insert_vehicle_image_bulk`, `contributor_intake_file`, pcarmarket importer | `cleanup_duplicate_images_on_upload`, `find_duplicate_image`, `get_vehicle_images_with_source`, `hold_wrong_byte_images`, `search_images_by_component` → `file_name` (backfill `file_name` from `filename` first: 2.2% vs 0.1%) |
| `perceptual_hash` | `ingest_image_identity_first`, `imageUploadService.ts` | `admin_image_radar`, `find_duplicate_images`, `AdminMissionControl.tsx`, `imageDuplicateLinker.ts` → `phash` |
| `labels` | `extract_ai_analysis_to_fields` (orphan) | 13 SQL fns mention the word; review each (most use other tables or JSON keys) → `apple_ml_labels` / `image_tags` |
| `ai_last_scanned` | `update_image_ai_metadata` (orphan; its table is gone) | **Bug fix:** `ImageGallery.tsx:4011,4107` → `vision_analyzed_at ?? ai_processing_completed_at`; `UserRecentPhotos.tsx`, `globalUploadStatusService.ts`, `forensic-deal-jacket` |
| `verification_status` | the column default (dropped in 21); check `vehicle_images_verification_status_check` | `create_citation_from_ai_component`, `device_create_vehicle_profile` → `approval_status` / `vision_gate_status` |
| `process_stage`, `workflow_role` | `AddEventWizard.tsx:272`, `unifiedImageImportService.ts:467` → write `fabrication_stage` | **Bug fix:** `useImageViewerState.ts:79` filter → `fabrication_stage` |
| `image_context` | facebook_marketplace importer (0.005%) | `VehicleTimeline.tsx`, `useVehicleTimeline.ts` → `source` |
| `ai_suggestions` | default (dropped in 21) | `get_unorganized_photos_optimized`, `personalPhotoLibraryService.ts` → `auto_suggested_vehicle_id`, `auto_suggestion_confidence` |
| `spatial_tags` | default; `migrate_existing_ai_data` (orphan) | none (`tagging-constants.ts` is an unrelated constant) |
| `user_tags`, `analysis_history`, `context_score`, `processing_models_used`, `total_processing_cost` | defaults (dropped in 21) | `organized_ai_analysis` view (`total_processing_cost`) |
| `temp_session_id`, `pending_submission_id`, `task_id`, `safe_preview_url`, `optimized_at`, `location_confidence` | none | `mcp-connector` comment only |
| `yono_queued_at` | `claim_yono_vision_batch` (orphan) | none |

## Exit check before stage 2

Watch the logs for `deprecated vehicle_images column write` for one release. A write that still
appears is a writer this list missed: fix it, or take that column out of stage 2.

## Triggers whose column lists name a candidate (a rename is fine; stage 3 recreates them)

* `trg_withdraw_reviewed_image_analysis`: `BEFORE UPDATE OF ... doc_flag ...`
* `image_retained_analysis_change`: `AFTER ... UPDATE OF ... doc_flag, ... verification_status ...`
* `vehicle_images_verification_status_check` (CHECK constraint): dropped in stage 3, restored `NOT VALID` by the revert.
