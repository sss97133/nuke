-- Describe image_coordinate_observations: all 24 columns, none had a COMMENT ON COLUMN (0 of 24 described before, catalog
-- count on prod, 2026-10-07), and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 79,424 rows on 2026-10-07 13:30Z by exact count (the
-- atlas estimate of 86,115 is a stale pg_class.reltuples), no write since the statistics counters began; every row was
-- written on 2025-12-29 between 00:14:56Z and 00:15:18Z.
--
-- METHOD (read 2026-10-07 13:29-14:10Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy
--   and pg_description; the views that read the table from pg_depend, with their options and grants. Fill, sources,
--   positions, confidence values, the evidence key sets and labels, the subject keys, the zone columns against
--   angle_spectrum_zones, the write transactions and the NULL vehicle ids are exact counts over the whole table (54 MB
--   heap, read only). Rows whose image or vehicle no longer exists, and the comparison of the label with the image row,
--   come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 776 rows joined to vehicle_images and
--   vehicles), because the exact anti-joins exceeded the 10 s timeout while other sessions loaded the database. What anon
--   gets comes from a select on the view image_coordinate_consensus under SET LOCAL ROLE anon in a read-only transaction.
--   "Filled" means non-NULL and, for jsonb, not the empty default.
--   Writers and readers from code at origin/main 0e4fad07a (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps, docs; also git history): no CREATE TABLE in any repo file, commit or logged
--   migration; the deprecation 20260618090000_deprecate_orphaned_image_tables_phase82_round2.sql (the former table
--   comment); the bodies, read with pg_get_functiondef, of the four live functions whose body names the table
--   (add_coordinate_observation and add_subject_observation write it, find_similar_subject_shots and
--   get_observations_by_subject read it; none is SECURITY DEFINER) and of get_angle_zone; angle_spectrum_zones (7 rows,
--   the only definition of the axes) and subject_taxonomy; the design doc docs/IMAGE_ANALYSIS_3D_COORDINATE_SYSTEM.md at
--   81a20740d (2025-12-29), which defines the sister table image_camera_position but not this one; the prod migration log
--   supabase_migrations.schema_migrations (only 20260314031411 rls_lockdown_internal_tables names the table; it is not in
--   the repo); cron.job (no command names the table, its views or its functions); pg_depend (4 views); write_receipts (no
--   rows); pg_stat_user_tables; pipeline_registry (no row; none is added here); nuke_frontend/docs/investor (two
--   documents list the table).
-- LIMITS:
--   The SQL that wrote the 2025-12-29 rows is not in the repo, so the label mapping is read from the values it left. The
--   axes are defined only by the zone bounds and that mapping. Orphans come from a 1% block sample and can miss rare cases.
--   pg_stat_user_tables counters began at an unrecorded time (the server last started 2026-09-29 09:20Z). The table holds
--   no personal data; quoted values are labels, subject keys, zone names, positions in degrees, column and function names
--   and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff." The
--   table is not empty: it has held 79,424 rows since 2025-12-29, and 20260618090000 read reset pg_stat counters
--   (n_live_tup and n_tup_ins of 0) as an empty table, the same misreading recorded for image_camera_position. "Zero code
--   refs" holds for the repo code but not for the four live SQL functions and four views. The new comment keeps the drop
--   question open and says what the rows are. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.image_coordinate_observations IS
'Camera position of an image relative to its vehicle, derived from the image angle label: one row per image, source, source_version and position (grain: one position estimate of one image; UNIQUE (image_id, source, source_version, x_estimate, y_estimate, z_estimate); today every image has exactly one row). 79,424 rows on 2026-10-07 (the atlas estimate of 86,115 is a stale reltuples) for 79,424 images of 3,336 vehicles, all written on 2025-12-29 in two transactions (48,203 rows at 00:14:56Z and 31,221 at 00:15:18Z) by SQL that is in no repo file, commit or logged migration; the CREATE TABLE is in none either. Not empty, despite the former comment: 20260618090000 read reset pg_stat counters as an empty table, as it did for image_camera_position. 79,421 rows are source label_derived v1. Each copies vehicle_images.ai_detected_angle into evidence.original_label (equal on 756 of 756 linked rows of a 1% block sample) and maps the label to one fixed position and one fixed confidence. So only 19 distinct positions occur, and the rows add no measurement to the label: interior_dashboard to (0, -45, 40) at 0.85 (22,014 rows), detail_shot to (0, 0, 30) at 0.3 (18,931), exterior_three_quarter to (-45, -35, 15) at 0.35 (12,524), exterior to (0, 0, 15) at 0.2 (7,800), undercarriage to (0, 0, 0) at 0.6 (4,603), engine_bay to (0, -30, 75) at 0.8 (4,478), exterior_side to (-85, 0, 15) at 0.5 (4,211), exterior_rear to (0, 75, 15) at 0.8 (2,727), exterior_front to (0, -75, 15) at 0.8 (1,407), and 16 rarer labels. Where the label names no side or direction (exterior_side, exterior_three_quarter, front_3quarter, rear_3quarter, side: 16,796 rows) the mapping still placed the camera on the driver side, and the row carries needs_refinement true in evidence (48,758 rows in all). 3 rows are source human_review v1 (confidence 0.85, 0.85 and 0.9). Axes, as the zone bounds of angle_spectrum_zones and the label mapping read them, in degrees: x left to right (driver side negative, passenger side positive), y fore and aft (front negative, rear positive), z elevation (0 level, 90 overhead); no document defines them. Writers: add_coordinate_observation and add_subject_observation (upserts on the unique key; closed to anon and authenticated) have no caller in the repo, cron.job or other functions, nothing has written since 2025-12-29, and pg_stat_user_tables shows 0 inserts, updates and deletes and 4 index scans since its counters began (the server last started 2026-09-29 09:20Z; read 13:30Z). Readers: the views image_coordinate_consensus and image_subject_analysis (security_invoker, granted to anon and authenticated, who get permission denied on this table), coordinate_system_stats and subject_coverage_stats (closed to both roles), and the functions find_similar_subject_shots and get_observations_by_subject; nothing in the repo or cron.job reads any of them. Orphans: in a 1% block sample 20 of 776 rows (2.6%) point at an image and a vehicle that no longer exist, although both foreign keys (ON DELETE CASCADE) are validated and their triggers are enabled. Access: RLS is on with no policy, and anon and authenticated hold no privilege (revoked by the logged migration 20260314031411 rls_lockdown_internal_tables, which is not in the repo). Mislabel elsewhere: nuke_frontend/docs/investor/TECHNICAL_EXHIBITS.md calls it GPS/location data from images; it holds camera angles relative to the vehicle and no geographic location. Drop question: still open for the owner; recorded here as a fact, not decided. No pipeline_registry row and no write receipts. Clocks: observed_at is the database clock of the 2025-12-29 insert, not when the photo was taken or analysed.';

-- ── Identity and links ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.id IS
'Surrogate key of the observation, uuid, gen_random_uuid() default, the PRIMARY KEY. 79,424 values (2026-10-07). Nothing points at it. Unit: none (uuid). Source: column default. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.image_id IS
'Image the position belongs to: a vehicle_images.id, NOT NULL, foreign key ON DELETE CASCADE (validated, its triggers enabled), indexed (idx_coord_obs_image) and the first column of the unique key. 79,424 distinct values on 79,424 rows (2026-10-07): one row per image. In a 1% block sample 20 of 776 rows (2.6%) point at an image that no longer exists (deleted with the RI triggers off, together with its vehicle), and 4 linked images now belong to another vehicle than vehicle_id says. Unit: none (uuid). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.vehicle_id IS
'Vehicle of the image when the row was written: a vehicles.id, nullable, foreign key ON DELETE CASCADE (validated), indexed (idx_coord_obs_vehicle). Filled on 76,625 rows (96.5%, 2026-10-07; NULL on 2,799 label_derived rows), 3,336 distinct vehicles. Copied, not kept in step: it can disagree with the current vehicle_images.vehicle_id (4 of 756 linked sampled rows). In a 1% block sample 20 of 776 rows point at a vehicle that no longer exists. Unit: none (uuid). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';

-- ── Vehicle-relative position ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.x_estimate IS
'Left-right angle of the camera around the vehicle, in degrees, NOT NULL, CHECK -180 .. 180: negative on the driver side, positive on the passenger side, as the zone bounds of angle_spectrum_zones read it (side_driver_zone -90 .. -60, side_passenger_zone 60 .. 90). Observed -85 .. 85 in 7 values (2026-10-07): the label_derived rows use -85, -70, -45, 0 and 85, each fixed by the label (exterior_side -85, exterior_three_quarter -45, most labels 0), and the 3 human_review rows -55, 82 and 85. Part of the unique key. Unit: degrees. Source: label mapping of the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.y_estimate IS
'Fore-aft angle of the camera around the vehicle, in degrees, NOT NULL, CHECK -180 .. 180: negative toward the front, positive toward the rear, as the zone bounds and the label mapping read it (exterior_front -75, exterior_rear 75, interior_dashboard -45). Observed -75 .. 75 (2026-10-07), fixed by the angle label. Part of the unique key. Unit: degrees. Source: label mapping of the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.z_estimate IS
'Elevation of the camera above the vehicle horizon, in degrees, NOT NULL, CHECK 0 .. 90 (0 level, 90 straight down from above; the engine bay zones span 60 .. 90). Observed 0 .. 85 (2026-10-07), fixed by the angle label (most exterior labels 15, engine_bay 75, undercarriage 0, which the CHECK cannot place below the vehicle). Part of the unique key. Unit: degrees. Source: label mapping of the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.distance_estimate_m IS
'Intended distance from the camera to the vehicle, numeric, nullable. NULL on all 79,424 rows (2026-10-07): an angle label carries no distance. add_coordinate_observation would write it from p_distance_m. Unit: meters. Source: none. Grain: one position estimate of one image. Clock: n/a.';

-- ── Confidence and provenance ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.confidence IS
'Confidence of the position, 0 .. 1 by CHECK, NOT NULL, default 0.5. Fixed per label by the mapping, not measured (2026-10-07): 0.85 on 22,016 rows, 0.3 on 18,934, 0.35 on 12,526, 0.8 on 8,612, 0.2 on 7,800, 0.6 on 4,987, 0.5 on 4,213, 0.1 on 239, 0.4 on 59, 0.7 on 31, 0.9 on 7. Every row at 0.6 or below carries needs_refinement true in evidence. On a conflict the writer functions keep the larger value. Unit: probability, 0 .. 1. Source: label mapping, or the human review. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.source IS
'Method that produced the position, text NOT NULL, part of the unique key. 2 values (2026-10-07): label_derived 79,421 (mapped from vehicle_images.ai_detected_angle) and human_review 3. Unit: none (text code). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.source_version IS
'Version of the method, text, nullable, part of the unique key. v1 on all 79,424 rows (2026-10-07). Unit: none (text). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.source_model IS
'Intended name of the model that estimated the position, text, nullable. NULL on all 79,424 rows (2026-10-07): no model ran; the label in evidence names what the position came from. Unit: none (text). Source: none. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.evidence IS
'Why the position was set, jsonb, default {}, filled on every row (2026-10-07). Keys: original_label on all 79,424 (the vehicle_images.ai_detected_angle label that was mapped, 25 distinct labels on the label_derived rows), needs_refinement and refinement_reason on the 79,421 label_derived rows (needs_refinement true on 48,758; reasons such as unknown_subject, unknown_side_and_direction, generic_exterior, position_unknown, unknown_side, no_signal), and analysis and reviewed_at on the 3 human_review rows, context on 1. Unit: none (jsonb). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';

-- ── Zone ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.zone_id IS
'Named viewing zone that contains the position: an angle_spectrum_zones.zone_id, nullable, foreign key (validated, no delete action). Filled on 38,825 rows (48.9%, 2026-10-07), all pointing at an existing zone: interior_dash_zone 22,030, front_three_quarter_driver_zone 12,576, side_driver_zone 4,218 and side_passenger_zone 1. Not kept consistent with zone_name: 22,036 rows carry both, 16,789 only the id and 8,612 only a name. add_coordinate_observation sets it through get_angle_zone (the narrowest of the 7 zones whose bounds contain x, y and z). Unit: none (uuid). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.zone_name IS
'Name of the viewing zone, a text copy, nullable. Filled on 30,648 rows (38.6%, 2026-10-07): interior_dash_zone 22,030 (with a matching zone_id), and 8,612 rows that name zones absent from angle_spectrum_zones today and carry no zone_id (engine_bay_full_zone 4,478, rear_straight_zone 2,727, front_straight_zone 1,407), plus side_driver_zone 5 and side_passenger_zone 1. Unit: none (text code). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';

-- ── Subject ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.subject_id IS
'Subject of the image in the subject taxonomy: a subject_taxonomy.subject_id, nullable, foreign key (validated). Filled on all 79,424 rows (2026-10-07), the id of subject_key. Unit: none (uuid). Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_key IS
'Key of the subject the image shows, a subject_taxonomy key, text, nullable. Filled on all 79,424 rows (2026-10-07), 14 values, also fixed by the label: interior.dashboard 22,014, vehicle 20,385, detail 19,172, engine.bay 4,861, undercarriage 4,603, exterior.side.driver 4,218 (4,211 of them from the label exterior_side, which names no side), exterior.rear 2,727, exterior.front 1,407, and 6 rarer keys. Unit: none (text code). Source: label mapping of the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_x IS
'Left-right angle of the camera relative to the subject, in degrees, nullable. Filled on all 79,424 rows and equal to x_estimate on 79,422 (2026-10-07): the bulk insert copied the vehicle-relative position, so it adds nothing. add_subject_observation would convert it to vehicle coordinates through subject_to_vehicle_coords. Unit: degrees. Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_y IS
'Fore-aft angle of the camera relative to the subject, in degrees, nullable. Filled on all 79,424 rows and equal to y_estimate with x and z on 79,422 (2026-10-07). Unit: degrees. Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_z IS
'Elevation of the camera relative to the subject, in degrees, nullable, without the 0 .. 90 CHECK of z_estimate (observed -10 .. 85). Filled on all 79,424 rows and equal to z_estimate with x and y on 79,422 (2026-10-07). Unit: degrees. Source: the 2025-12-29 bulk insert. Grain: one position estimate of one image. Clock: observed_at.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_distance_m IS
'Intended distance from the camera to the subject, numeric, nullable. NULL on all 79,424 rows (2026-10-07). Unit: meters. Source: none. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.secondary_subjects IS
'Intended list of other subjects visible in the image, jsonb, default []. The empty array on all 79,424 rows (2026-10-07). Unit: none (jsonb array). Source: none. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.framing_quality IS
'Intended score of how well the image frames its subject, numeric, nullable. NULL on all 79,424 rows (2026-10-07); its scale is not recorded. Unit: unknown (never written). Source: none. Grain: one position estimate of one image. Clock: n/a.';
COMMENT ON COLUMN public.image_coordinate_observations.subject_coverage_pct IS
'Intended share of the subject visible in the image, numeric, nullable. NULL on all 79,424 rows (2026-10-07). Unit: percent (never written). Source: none. Grain: one position estimate of one image. Clock: n/a.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.image_coordinate_observations.observed_at IS
'When the row was written, default now(), the transaction clock of the insert; the writer functions reset it on a conflict. Two values on all 79,424 rows (2026-10-07): 2025-12-29 00:14:56Z (48,203 rows) and 00:15:18Z (31,221, including the 3 human_review rows). Not the time the photo was taken (vehicle_images has its own capture clock) or analysed. Unit: timestamptz. Source: column default. Grain: one position estimate of one image. Clock: ingest time of the write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.image_coordinate_observations'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'image_coordinate_observations: every column has a comment';
  ELSE
    RAISE NOTICE 'image_coordinate_observations columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
