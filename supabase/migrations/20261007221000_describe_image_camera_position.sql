-- Describe image_camera_position: all 22 columns, none had a COMMENT ON COLUMN (0 of 22 described before, catalog count
-- on prod, 2026-10-07), and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 692,434 rows on 2026-10-07 11:37Z by exact count (the
-- atlas estimate of 693,181 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row is
-- from 2026-02-28 19:43Z.
--
-- METHOD (read 2026-10-07 11:35-12:00Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy,
--   information_schema and pg_description. Fill, values, poses, confidence, the key sets of evidence, the sign of the
--   Cartesian columns at each cardinal azimuth, their agreement with the spherical columns and the date windows are exact
--   counts over the whole table (322 MB heap, read only). Rows whose vehicle no longer exists come from an exact anti-join
--   to vehicles; rows whose image no longer exists, and the image's current vehicle, come from a 1% block sample
--   (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 6,117 rows) joined to vehicle_images. What anon gets comes from a select
--   on the table and a call of find_similar_camera_positions under SET LOCAL ROLE anon in read-only transactions.
--   "Filled" means non-NULL.
--   Writers and readers from code at origin/main 795e38e0f (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs) and from git history: the edge function analyze-image (function
--   insertCameraPosition and its fallback angleToCameraPosition), deleted by commit 43b72deae (2026-03-07) and read at
--   43b72deae^; the design doc docs/IMAGE_ANALYSIS_3D_COORDINATE_SYSTEM.md at 81a20740d (2025-12-29, the schema, the
--   subject taxonomy and the axes); the live functions whose bodies name the table, read with pg_get_functiondef
--   (add_camera_position, which writes, and find_similar_camera_positions, which reads; neither is SECURITY DEFINER) and
--   spherical_to_cartesian; the view image_camera_analysis (pg_depend, security_invoker); the deprecations
--   20260617080000 and 20260618090000; 20260927170000 (revoked anon EXECUTE on add_camera_position); the prod migration
--   log supabase_migrations.schema_migrations (only 20260314031411 rls_lockdown_internal_tables names the table; it is not
--   in the repo); cron.job (no command names the table or its functions); write_receipts (no rows);
--   pg_stat_user_tables; pipeline_registry (no row; none is added here).
-- LIMITS:
--   The CREATE TABLE is in no repo file, no commit and no logged migration; the 2025-12-29 design doc is the nearest record
--   of intent. The two label backfills of 2025-12-29 have no code in the repo and are described by their content. The
--   evidence does not record which vision model produced the 722 estimated poses. The cause of the orphan rows is not
--   recorded. The 1% sample can miss rare cases. Quoted values are categorical codes, labels, HTTP status codes, column and
--   function names and counts only; the table holds no personal data.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff."
--   The table is not empty: it held about 692K rows before that date (all were written 2025-12-29 .. 2026-02-28), and
--   20260618090000 read reset pg_stat counters (n_live_tup and n_tup_ins of 0) as an empty table. Its writer had been
--   deleted on 2026-03-07, so "zero code refs" held for the writer but not for the two live SQL readers. The new comment
--   keeps the drop question open and says what the rows are. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_camera_position IS
'Camera pose per image: where the camera stood relative to the vehicle center when the photo was taken, as spherical (azimuth_deg, elevation_deg, distance_mm) and Cartesian (camera_x_mm, camera_y_mm, camera_z_mm) coordinates, plus the subject photographed (grain: one pose per image, subject_key, source and source_version, the UNIQUE key unique_camera_position). Designed on 2025-12-29 (docs/IMAGE_ANALYSIS_3D_COORDINATE_SYSTEM.md, in git history at 81a20740d) so photos could be searched by angle and distance. Not empty: 692,434 rows on 2026-10-07 for 692,422 images (the atlas estimate of 693,181 is a stale reltuples). The former comment (DEPRECATED 2026-06-18: empty, zero code refs) came from 20260618090000, which read n_live_tup = 0 and n_tup_ins = 0 in pg_stat_user_tables as an empty table; those counters had been reset, and the round-one migration of 2026-06-17 had already seen about 692K rows. What the rows are (exact, 2026-10-07): only 722 rows (0.10%) carry a pose a vision model estimated (evidence.ai_camera_position is an object; analyze-image v3 691 rows, v4 31). The other 691,712 (99.9%) are placeholders. 612,265 analyze-image rows (88.4%) record a failed OpenAI call (evidence.ai_subject openai_failed; HTTP 429 on 612,128), after which the function wrote the fixed fallback pose of its text label anyway (general: azimuth 45, elevation 15, distance 8,000 mm, confidence 0.25; engine and undercarriage: their own constants). 79,415 rows come from two label backfills inserted within one minute on 2025-12-29 (label_derived 49,744, label_derived_catchall 29,671) that map a text angle label to a fixed pose; their code is not in the repo. 32 more analyze-image rows hold a fallback pose without a recorded failure. So 545,131 rows (78.7%) hold one identical pose, and only the 722 can answer an angle query. Writer: analyze-image (function insertCameraPosition, an upsert on the unique key with the Cartesian values computed in TypeScript), deleted from the repo by the platform triage commit 43b72deae on 2026-03-07; its code is in git history. No writer remains: add_camera_position(...) (an upsert that converts between the two coordinate forms) has no caller in the repo, and since 20260927170000 anon cannot execute it. The CREATE TABLE is in no repo file, commit or logged migration; the prod migration log names the table only in 20260314031411 rls_lockdown_internal_tables, which revoked client grants and is not in the repo. Liveness: the newest row is from 2026-02-28 19:43Z; pg_stat_user_tables shows 0 inserts, updates and deletes and 2 sequential and 3 index scans since its counters began (read 11:35Z, before this work scanned the table). Readers: the view image_camera_analysis (security_invoker; adds direction, elevation and distance buckets) and find_similar_camera_positions(...) read it, but no code in the repo calls either; docs/features/image-processing/IMAGE_ANALYSIS_STRATEGY.md describes angle search on it as planned. Integrity: the foreign keys to vehicles and vehicle_images are ON DELETE CASCADE and validated, yet 73,635 rows (10.7% of those with a vehicle) point at a deleted vehicle and, in a 1% block sample, 11.6% point at a deleted image. Coordinates: camera_y_mm is negative for a camera in front of the vehicle (azimuth 0) on every row where it is not 0, the reverse of the design doc axis (Y positive toward the front), while camera_x_mm follows the doc (driver side negative); the 29,671 catch-all rows store 0, 0, 0 as the camera point, which contradicts their own spherical values. focal_length_mm, fov_horizontal_deg, look_yaw_deg and look_pitch_deg are NULL on every row. A drop-list candidate (461 MB with indexes): no writer, no live reader, 99.9% placeholders; recorded as a fact, not decided here. Access: RLS is on with no policy, and anon and authenticated hold no grant, so they get permission denied (42501), also through find_similar_camera_positions, which anon can execute. No pipeline_registry row, no write receipts. Clocks: observed_at is the insert time; nothing records when a photo was taken.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.id IS
'Surrogate key of the pose row, uuid, gen_random_uuid() default, the PRIMARY KEY. 692,434 rows (2026-10-07); nothing references it. Unit: none (uuid). Source: column default. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.image_id IS
'Image the pose describes: a vehicle_images.id, NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_camera_position_image) and the first column of the UNIQUE key unique_camera_position (image_id, subject_key, source, source_version). 692,422 distinct images on 692,434 rows (2026-10-07); 10 images hold 2 or 3 rows from different sources. In a 1% block sample (6,117 rows) 707 (11.6%) point at an image no longer in vehicle_images, so the cascade did not remove them; 672 of those also point at a deleted vehicle. Unit: none (uuid). Source: analyze-image (the id of the vehicle_images row it analyzed) or the label backfill. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.vehicle_id IS
'Vehicle of the image at write time: a vehicles.id, nullable, foreign key ON DELETE CASCADE (validated), indexed (idx_camera_position_vehicle). Filled on 689,634 rows (99.6%, 2026-10-07); NULL on 2,800, where analyze-image got no vehicle id in its request. 73,635 of the filled rows (10.7%) point at a vehicle that no longer exists although the cascade is validated; the same unexplained delete left orphans in ai_scan_sessions and vehicle_status_metadata. In a 1% block sample the image now belongs to a different vehicle, or gained one, on 16 of the 5,410 rows whose image still exists. Unit: none (uuid). Source: analyze-image request vehicle_id or the label backfill. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.subject_key IS
'What the camera was pointed at, a dotted path of the subject taxonomy in the 2025-12-29 design doc (vehicle, engine.bay, interior.dashboard, undercarriage, exterior.panel.fender.front.driver and so on); default vehicle, nullable but filled on every row, no CHECK and no foreign key to subject_taxonomy. Part of the UNIQUE key. 102 distinct values (2026-10-07): vehicle 590,210 rows, engine.bay 69,086, interior.dashboard 22,034, undercarriage 10,546, and 98 finer keys on 558 rows in all (document.vin_tag 38, exterior.panel.fender.front.driver 36, exterior.panel.trunk 33 and others). On the 691,712 placeholder rows the key comes from the text-label mapping (the label general maps to vehicle), so only the 722 rows with an estimated pose carry a subject a model chose. Unit: none (text). Source: analyze-image appraiser subject, else the label mapping. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';

-- ── Camera position, spherical ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.azimuth_deg IS
'Horizontal direction of the camera around the vehicle: 0 front, 90 driver side, 180 rear, 270 passenger side (design doc; the view image_camera_analysis buckets it the same way). Filled on every row (2026-10-07), range 0 .. 315. Not a measurement on 691,712 rows (99.9%): 545,131 rows hold the same pose (azimuth 45, elevation 15, distance 8,000 mm), the fallback analyze-image wrote for the label general or after a failed OpenAI call, and the label-derived rows hold a fixed value per text label (detail_shot 45, exterior 0, exterior_side 90, exterior_rear 180, interior_dashboard 45 and others; the catch-all maps passenger_side to 90, the driver side). Only the 722 rows whose evidence.ai_camera_position is an object carry a model estimate. Unit: degrees. Source: analyze-image appraiser camera_position, else the label mapping. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.elevation_deg IS
'Vertical angle of the camera above (positive) or below (negative) the vehicle center. Filled on every row (2026-10-07), range -60 .. 60. A placeholder on 691,712 rows: 15 by default, 60 for engine bays, -20 for dashboards, -45 for undercarriages and other label constants; model estimates on the 722 rows range -60 .. 45. Unit: degrees. Source: analyze-image appraiser camera_position, else the label mapping. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.distance_mm IS
'Distance from the vehicle center to the camera. Filled on every row (2026-10-07), range 0 .. 8,000; 0 on 8 rows. A placeholder on 691,712 rows: 8,000 for whole-vehicle defaults (also for the catch-all undercarriage label), 1,500 for engine bays and the analyze-image undercarriage fallback, 800 for dashboards and 600 for detail shots; among the 722 model estimates the median is 800 (v3) and 1,000 (v4). Unit: millimetres. Source: analyze-image appraiser camera_position, else the label mapping. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';

-- ── Camera position, Cartesian (derived) ────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.camera_x_mm IS
'Camera position across the vehicle, from the vehicle center: round(-distance x cos(elevation) x sin(azimuth)), computed by analyze-image in TypeScript and by the SQL function spherical_to_cartesian. Filled on every row (2026-10-07), range -7,922 .. 5,000. Negative on the driver side and positive on the passenger side (no row at azimuth 90 is positive and none at 270 negative), as the design doc says. 0 on the 29,671 label_derived_catchall rows, together with camera_y_mm and camera_z_mm, which contradicts their own spherical values; it equals the conversion on every other row. Unit: millimetres. Source: derived from the spherical columns. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.camera_y_mm IS
'Camera position along the vehicle, from the vehicle center: round(-distance x cos(elevation) x cos(azimuth)). Filled on every row (2026-10-07), range -7,727 .. 7,727. Sign: the design doc says Y is positive toward the front, but the formula makes a camera in front negative: of the 84,608 rows at azimuth 0 (front), 84,549 are negative, 59 are 0 and none positive, and of the 2,840 at azimuth 180 (rear) none is negative. Read it as positive toward the rear, or recompute from azimuth_deg. 0 on the 29,671 catch-all rows (see camera_x_mm). Unit: millimetres. Source: derived from the spherical columns. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.camera_z_mm IS
'Camera height relative to the vehicle center: round(distance x sin(elevation)); the design doc puts the ground about 700 mm below the center. Filled on every row (2026-10-07), range -1,061 .. 2,071. 0 on the 29,671 catch-all rows (see camera_x_mm). Unit: millimetres. Source: derived from the spherical columns. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';

-- ── Subject position (estimated rows only) ──────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.subject_x_mm IS
'Position of the photographed subject across the vehicle, from the vehicle center, as the analyze-image appraiser estimated it (subject_position.x_mm; same axis as camera_x_mm). Filled on the 722 model-estimated rows only (0.10%, 2026-10-07), range -1,800 .. 3,000; NULL on every placeholder row. Unit: millimetres. Source: analyze-image appraiser subject_position. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.subject_y_mm IS
'Position of the photographed subject along the vehicle, from the vehicle center, as the appraiser estimated it (subject_position.y_mm). Filled on the 722 model-estimated rows only (0.10%, 2026-10-07), range -1,800 .. 3,500; NULL elsewhere. Whether the model used the doc axis (front positive) or the stored camera axis (front negative) is not recorded. Unit: millimetres. Source: analyze-image appraiser subject_position. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.subject_z_mm IS
'Height of the photographed subject relative to the vehicle center, as the appraiser estimated it (subject_position.z_mm). Filled on the 722 model-estimated rows only (0.10%, 2026-10-07), range -700 .. 1,500; NULL elsewhere. Unit: millimetres. Source: analyze-image appraiser subject_position. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';

-- ── Lens and look direction (never written) ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.look_yaw_deg IS
'Intended horizontal direction the camera looked. NULL on all 692,434 rows (100%, 2026-10-07): neither analyze-image nor add_camera_position writes it. Unit: degrees. Source: none. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.look_pitch_deg IS
'Intended vertical direction the camera looked. NULL on all 692,434 rows (100%, 2026-10-07): no writer sets it. Unit: degrees. Source: none. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.focal_length_mm IS
'Intended focal length of the capture. NULL on all 692,434 rows (100%, 2026-10-07): add_camera_position would write it but has no caller, and analyze-image put its model guess into evidence.focal_length_mm instead (a number on 29 rows). Unit: millimetres. Source: none. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.fov_horizontal_deg IS
'Intended horizontal field of view of the capture. NULL on all 692,434 rows (100%, 2026-10-07): no writer sets it; analyze-image kept its guess in evidence.lens_angle_of_view_deg (a number on 29 rows). Unit: degrees. Source: none. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';

-- ── Confidence, provenance and evidence ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.confidence IS
'Confidence of the pose, CHECK between 0 and 1, default 0.5, filled on every row (2026-10-07). On placeholder rows it is a constant of the mapping, not a model score: 0.25 on 548,111 rows (the analyze-image fallback for the labels general and undercarriage, half of the mapping value), 0.3 on 64,186 (its fallback for engine), 0.1 on 37,471, 0.05 on 18,933, 0.15 on 14,011, 0.6 on 8,617 and 0.5 on 383 (label backfill constants). The 722 model estimates carry the model value (mean 0.83; 0 on 8 rows). 714 rows reach 0.7 or more. Do not filter on it without excluding the placeholders. Unit: score, 0 .. 1. Source: appraiser camera_position.confidence, else the mapping constant. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';
COMMENT ON COLUMN public.image_camera_position.source IS
'Who produced the pose, text NOT NULL, default ai, part of the UNIQUE key. 3 values (2026-10-07): analyze-image 613,019 rows (2025-12-29 .. 2026-02-28); label_derived 49,744 and label_derived_catchall 29,671, each inserted in one transaction on 2025-12-29 (03:12:00Z and 03:12:24Z) by a backfill that mapped a text angle label (kept in evidence.original_label) to a fixed pose and whose code is not in the repo. The default ai occurs on no row. Unit: none (text). Source: writer constant. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.source_version IS
'Version stamp of the writer, text, nullable but filled on every row, part of the UNIQUE key. v3 on 612,988 rows (analyze-image, 2025-12-29 03:21Z .. 2026-02-18 22:00Z), v4 on 31 (analyze-image, 2026-02-27 .. 2026-02-28 19:43Z; the last revision before its deletion writes v4), v1 on 79,415 (the two label backfills). Because the version is part of the unique key, an analysis by a new version adds a row instead of replacing the old one. Unit: none (text). Source: writer constant. Grain: one pose per image, subject_key, source and source_version. Clock: n/a.';
COMMENT ON COLUMN public.image_camera_position.evidence IS
'What the writer saw, a JSON object, default {}, never empty on prod (2026-10-07). analyze-image rows carry detected_angle, ai_camera_position, ai_subject_position, ai_subject, category, description and is_close_up, and on 606,095 rows lens_angle_of_view_deg and focal_length_mm (a number on 29). On 612,265 rows (88.4%) ai_subject is openai_failed, category error and description the error (OpenAI returned status 429 on 612,128 rows; 400, 403, 503 and 520 on the rest): the vision call failed and the pose columns hold the fallback for detected_angle, so these rows record a failure, not a camera position. ai_camera_position is an object on the 722 model-estimated rows and null elsewhere. label_derived rows carry original_label, needs_reanalysis and migration_date (2025-12-29); label_derived_catchall rows carry original_label and needs_reanalysis, true on every row. Unit: none (jsonb). Source: the writer. Grain: one pose per image, subject_key, source and source_version. Clock: as of observed_at.';

-- ── Row clock ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_camera_position.observed_at IS
'When the row was first inserted: default now(), set by the database. analyze-image upserts without it, so a later upsert of the same key keeps the first time (add_camera_position would reset it to now(), but nothing calls it). Range 2025-12-29 03:12Z .. 2026-02-28 19:43Z on all 692,434 rows (2026-10-07), 612,918 distinct instants; by month 2025-12 80,873, 2026-01 5,435, 2026-02 606,126; the largest days 2026-02-16 325,197, 2026-02-18 163,719, 2026-02-17 107,209 and 2025-12-29 80,311 (the two label backfills). It is our write time, not when the photo was taken or the pose observed. Unit: timestamptz. Source: column default. Grain: one pose per image, subject_key, source and source_version. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.image_camera_position'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'image_camera_position: every column has a comment';
  ELSE
    RAISE NOTICE 'image_camera_position columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
