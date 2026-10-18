-- Describe image_work_extractions: all 21 columns (0 of 21 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 200,835 rows on 2026-10-07 15:16Z by exact count (the
-- atlas estimate of 200,835 matches); no write since the statistics counters began; the newest row is from
-- 2025-12-17 17:58Z.
--
-- METHOD (read 2026-10-07 15:15-15:20Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description; the foreign key that points at the table from
--   pg_constraint; views from pg_depend (none). Exact over the whole table (34 MB heap, 54 MB in all, read only): the
--   counts by status, ai_model and extraction_method, the fill of every column, the work types and confidence ranges,
--   the confidence formula, the ai_analysis keys and response model, the clock comparisons, the distinct images and
--   vehicles, and the 269 extracted rows against vehicle_images. The 200,566 pending rows against vehicle_images and
--   vehicles come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 1,392 rows), because the exact
--   join exceeded the 10 s timeout. What anon can read comes from a count under SET LOCAL ROLE anon in a read-only
--   transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main aa850dad4 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating migration
--   supabase/migrations/20250125000013_intelligent_work_detection_and_matching.sql; 20250125000014_auto_work_detection_
--   trigger.sql and 20250125000019_fix_work_detection_trigger_metadata.sql (the queue trigger);
--   20250125000015_work_approval_notifications.sql; 20250125000016_multi_stage_processing_pipeline.sql;
--   20251202000001_dashboard_functions.sql; 20260927190000_p3_8_repin_search_path_on_live_functions.sql;
--   20261005021008_photo_library_source_analysis_coverage.sql; prod migration 20260314050315
--   fix_broken_work_detection_trigger (supabase_migrations.schema_migrations; not in the repo); the former writer
--   supabase/functions/intelligent-work-detector (added by db2025788, 2025-11-25; deleted by 9871ee4fb, 2026-03-31; read
--   at 9871ee4fb^; not in the deployed function list, 328 functions, read through the management API); the bodies, read
--   with pg_get_functiondef, of the 5 live functions whose body names the table (auto_link_approved_work,
--   create_work_approval_notification, get_photo_library_stats, match_work_to_organizations,
--   process_pending_work_extractions); pg_trigger (trigger_auto_link_approved_work on work_organization_matches);
--   cron.job (no command names the table or its functions); write_receipts (no rows); pg_stat_user_tables;
--   pipeline_registry (no row; none is added here). Reader code: scripts/generate-ai-analysis-report.sql,
--   scripts/process-stage2-detailed.sh; nuke_frontend/src/services/personalPhotoLibraryService.ts calls
--   get_photo_library_stats.
-- LIMITS:
--   The pending rows against images and vehicles come from a 1% block sample. How the orphan rows lost their image or
--   vehicle is not recorded. When the queue trigger stopped inserting (the last row is from 2025-12-17) and why is
--   inferred from prod migration 20260314050315, which records only the drop. pg_stat_user_tables counters began at the
--   last server start (2026-09-29 09:20Z). The extracted rows describe photos mostly of one account, with GPS points:
--   quoted values are work-type, status, method and model codes, column and function names and counts only; no
--   description, coordinate, image id, vehicle id or user id.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Stores AI-extracted work data from images. Used for probabilistic matching to organizations." That
--   stays as the opening; the new comment adds the grain, the two kinds of rows, the queue trigger and its removal, the
--   broken processors, the deleted writer, the model mislabel, the orphans, the readers, the access and the clocks.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_work_extractions IS
'Stores AI-extracted work data from images. Used for probabilistic matching to organizations. One row per image queued for or read by the work detector (grain: one image; image_id is distinct on every row), with the detected kind of work, parts, date, place and confidences. 200,835 rows on 2026-10-07 by exact count, untouched since 2025-12-17. Two kinds of rows. (1) 200,566 pending queue placeholders (99.9%), inserted 2025-11-26 03:40Z .. 2025-12-17 17:58Z by the trigger trg_auto_work_detection on vehicle_images (trigger_work_detection_on_image_upload, migrations 20250125000014 and 20250125000019) for each new image with a vehicle; they carry only the image date and, on 751, its GPS point, for 4,885 vehicles; in a 1% block sample every one is a scraped listing image (bat_import, bat_listing, dealer_scrape, external_import, organization_import) without an uploader. Nothing processed them: process_pending_work_extractions, match_work_to_organizations and create_work_approval_notification set search_path to empty while naming tables without a schema, so a call cannot resolve those tables, and no cron job or code calls them; prod migration 20260314050315 (not in the repo) dropped the trigger, recording that its empty search_path had broken it and that the queue had no consumer. (2) 269 extracted rows, 2025-11-25 00:48Z .. 01:30Z, written by the edge function intelligent-work-detector (added by commit db2025788 on 2025-11-25; deleted by 9871ee4fb on 2026-03-31; not deployed) from gpt-4o reads of 269 photos of 28 vehicles, 228 of them uploaded by one account. Liveness: pg_stat_user_tables counts 0 inserts, 0 updates and 0 deletes since the server last started (2026-09-29 09:20Z; read 15:15Z), and updated_at equals created_at on every row, so no row was ever changed. Orphans: image_id and vehicle_id cascade on delete (validated), yet 34 of the 269 extracted rows point at a deleted image, and 32 of 1,386 sampled pending rows at a deleted image and vehicle; how is not recorded. Mislabel: ai_model says gpt-4-vision (the column default) on every row; the stored responses of the 269 extracted rows name gpt-4o-2024-08-06, and no model ran on the pending rows. Never filled: detected_location_address. Readers: get_photo_library_stats(uuid) (SECURITY DEFINER, EXECUTE for authenticated; called by personalPhotoLibraryService.ts) counts images with any row here as images_with_work_extractions, pending placeholders included; work_organization_matches.image_work_extraction_id (foreign key ON DELETE CASCADE; 1 row, pending, from 2025-11-25); scripts/generate-ai-analysis-report.sql and scripts/process-stage2-detailed.sh. Access: RLS is on. View work extractions (SELECT, every role) admits a row to a contributor of an organization linked to the vehicle through organization_vehicles or to the uploader of the image: anon reads 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07). anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, but no policy admits a write, so they cannot write rows through the API. One indirect write remains by design: a manager of the matched organization may approve a work_organization_matches row (policy Update own work matches), which fires trigger_auto_link_approved_work (auto_link_approved_work, SECURITY DEFINER) and sets status approved here. No pipeline_registry row, no write receipts, no triggers on the table. The creating migration supabase/migrations/20250125000013_intelligent_work_detection_and_matching.sql declared indexes on status, work type, date and location that prod lacks. Clocks: detected_date is the photo date (taken_at, else when the image was stored); processed_at is the writer clock of the extraction; created_at is the insert time; updated_at never moved.';

-- ── Identity and subject ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.id IS
'Surrogate key of the row, uuid, gen_random_uuid() default, the PRIMARY KEY. 200,835 values (2026-10-07). Referenced by work_organization_matches.image_work_extraction_id (ON DELETE CASCADE; 1 row). Unit: none (uuid). Source: column default. Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.image_work_extractions.image_id IS
'Image the row is about: a vehicle_images.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_work_extractions_image). Distinct on all 200,835 rows (2026-10-07), though no UNIQUE constraint enforces it; the queue trigger inserted with ON CONFLICT DO NOTHING, which only the primary key could hit. 34 of the 269 extracted rows and 32 of 1,386 rows of a 1% block sample of pending rows point at an image no longer in vehicle_images, although the key cascades; how is not recorded. Unit: none (uuid). Source: the queue trigger (the new image) or the detector request. Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.image_work_extractions.vehicle_id IS
'Vehicle of the image when the row was written: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_work_extractions_vehicle). 4,885 vehicles on pending rows and 28 on extracted rows (2026-10-07); equal to the current vehicle of the image on 1,353 of the 1,354 sampled pending rows whose image exists. 32 of 1,386 sampled pending rows point at a vehicle no longer in vehicles. The read policy joins it to organization_vehicles. Unit: none (uuid). Source: the image row at insert. Grain: one image. Clock: n/a.';

-- ── Detected work ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.detected_work_type IS
'Kind of work the model saw in the photo, text, nullable, no CHECK (the creating migration names upholstery, paint, engine and body_work among others). Filled only on the 269 extracted rows (2026-10-07): paint 108, other 64, body_work 37, upholstery 28, engine 15, suspension 11, electrical 3, transmission 2, detailing 1; NULL on every pending row. Unit: none (text code). Source: gpt-4o through intelligent-work-detector. Grain: one image. Clock: as of processed_at.';
COMMENT ON COLUMN public.image_work_extractions.detected_work_description IS
'Model sentence describing the work in the photo, text, nullable. Filled on the 269 extracted rows only (2026-10-07). It describes photos mostly of one account; none is quoted here. Unit: none (text). Source: gpt-4o through intelligent-work-detector. Grain: one image. Clock: as of processed_at.';
COMMENT ON COLUMN public.image_work_extractions.detected_components IS
'Parts the model named in the photo, text[], nullable. Non-empty on 209 of the 269 extracted rows and empty on the other 60; NULL on every pending row (2026-10-07). Unit: none (text array). Source: gpt-4o through intelligent-work-detector. Grain: one image. Clock: as of processed_at.';

-- ── Detected time and place ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.detected_date IS
'Date of the photo, taken as the date of the work, date, nullable. Filled on every row (2026-10-07). Pending rows: the queue trigger wrote the image taken_at date, else its created_at date (matching on all 1,354 rows of a 1% block sample whose image exists), 2023-09-19 .. 2025-12-17. Extracted rows: the detector wrote taken_at, else the EXIF DateTimeOriginal, else the image created_at (see date_confidence). It is when the photo was taken or stored, not a date read from the photo. Unit: date. Source: vehicle_images taken_at, EXIF or created_at. Grain: one image. Clock: event date of the photo.';
COMMENT ON COLUMN public.image_work_extractions.detected_location_address IS
'Intended street address of the place of the work, text, nullable. NULL on all 200,835 rows (2026-10-07): the detector always sent NULL and the queue trigger never set it. Unit: none (text). Source: none (never written). Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.image_work_extractions.detected_location_lat IS
'Latitude of the photo, numeric(10,8), nullable. Filled on 988 rows (2026-10-07): 751 pending rows (the image latitude copied by the queue trigger) and 237 extracted rows (the image latitude, else the EXIF GPS latitude). Visible only through the read policy (the uploader, or contributors of a linked organization). Unit: degrees. Source: vehicle_images latitude or EXIF. Grain: one image. Clock: as of detected_date.';
COMMENT ON COLUMN public.image_work_extractions.detected_location_lng IS
'Longitude of the photo, numeric(11,8), nullable; filled exactly where detected_location_lat is (988 rows, 2026-10-07), from the same sources. Unit: degrees. Source: vehicle_images longitude or EXIF. Grain: one image. Clock: as of detected_date.';

-- ── Confidence (extracted rows only) ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.work_type_confidence IS
'Confidence in detected_work_type, numeric(3,2), nullable: the confidence the model returned, else 0.8 (the detector rule). 0.70 .. 0.95 on the 269 extracted rows; NULL on every pending row (2026-10-07). The model self-report, not a measured accuracy. Unit: ratio (0 to 1). Source: gpt-4o through intelligent-work-detector. Grain: one image. Clock: as of processed_at.';
COMMENT ON COLUMN public.image_work_extractions.date_confidence IS
'Confidence in detected_date by the detector rule: 0.9 when the image had taken_at, 0.7 when only EXIF DateTimeOriginal, else 0.5. numeric(3,2), nullable; 0.50 .. 0.90 on the 269 extracted rows, NULL on every pending row (2026-10-07). Unit: ratio (0 to 1). Source: intelligent-work-detector. Grain: one image. Clock: as of processed_at.';
COMMENT ON COLUMN public.image_work_extractions.location_confidence IS
'Confidence in the place by the detector rule: 0.9 when the photo had coordinates, else 0.5 (the rule holds on all 269 extracted rows). numeric(3,2), nullable; NULL on every pending row (2026-10-07). Unit: ratio (0 to 1). Source: intelligent-work-detector. Grain: one image. Clock: as of processed_at.';
COMMENT ON COLUMN public.image_work_extractions.overall_confidence IS
'Weighted confidence: 0.6 x work_type_confidence + 0.2 x date_confidence + 0.2 x location_confidence, the detector formula, exact on all 269 extracted rows (0.74 .. 0.93); NULL on every pending row (2026-10-07). A weighting of rule values, not a calibrated probability. Unit: ratio (0 to 1). Source: intelligent-work-detector. Grain: one image. Clock: as of processed_at.';

-- ── Model and method ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.ai_model IS
'Meant as the model that read the photo, text, nullable, default gpt-4-vision. gpt-4-vision on all 200,835 rows (2026-10-07) only because no writer sends it: the 269 extracted rows were read by gpt-4o (their stored responses name gpt-4o-2024-08-06), and no model ran on the pending rows. Read the model from ai_analysis model instead. Unit: none (text). Source: column default. Grain: one image. Clock: n/a.';
COMMENT ON COLUMN public.image_work_extractions.ai_analysis IS
'The model response as returned, an OpenAI chat completion object (keys choices, created, id, model, object, service_tier, system_fingerprint, usage), jsonb, nullable. Filled on the 269 extracted rows (response clocks 2025-11-25 00:48Z .. 01:30Z), NULL on every pending row (2026-10-07). Holds the model text about the photo; none is quoted here. Unit: none (jsonb). Source: the OpenAI API through intelligent-work-detector. Grain: one image. Clock: its created field, the response time.';
COMMENT ON COLUMN public.image_work_extractions.extraction_method IS
'How the row was extracted, text, nullable (the creating migration lists exif, ai_vision, ocr and combined). ai_vision on the 269 extracted rows, NULL on every pending row (2026-10-07). Unit: none (text code). Source: intelligent-work-detector. Grain: one image. Clock: n/a.';

-- ── Status and clocks ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_work_extractions.status IS
'Stage of the row, text, nullable, default pending, CHECK in (pending, extracted, matched, approved, rejected), no index (the creating migration had one). 2 values occur (2026-10-07): pending 200,566 and extracted 269; matched, approved and rejected never. pending rows are queue placeholders that were never processed (see the table comment), not results; a reader that counts rows, such as get_photo_library_stats, counts them as extractions. process_pending_work_extractions would set extracted but cannot run; auto_link_approved_work sets approved when an organization manager approves the match. Unit: none (text code). Source: the writer. Grain: one image. Clock: as of updated_at.';
COMMENT ON COLUMN public.image_work_extractions.processed_at IS
'When the detector processed the image, timestamptz, nullable. Filled on the 269 extracted rows, within 5 s of created_at (the writer clock at insert, 2025-11-25); NULL on every pending row (2026-10-07). Unit: timestamptz. Source: intelligent-work-detector. Grain: one image. Clock: writer time of the extraction.';
COMMENT ON COLUMN public.image_work_extractions.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert. Extracted rows 2025-11-25 00:48Z .. 01:30Z; pending rows 2025-11-26 03:40Z .. 2025-12-17 17:58Z; no row since (2026-10-07). Unit: timestamptz. Source: column default. Grain: one image. Clock: ingest time.';
COMMENT ON COLUMN public.image_work_extractions.updated_at IS
'Meant as the time of the last change, timestamptz, nullable, default now(). No trigger maintains it and no writer changed a row: equal to created_at on all 200,835 rows (2026-10-07). Unit: timestamptz. Source: column default. Grain: one image. Clock: ingest time (never moved).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.image_work_extractions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'image_work_extractions: every column has a comment';
  ELSE
    RAISE NOTICE 'image_work_extractions columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
