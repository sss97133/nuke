-- Describe ai_scan_sessions: all 29 columns, none had a COMMENT ON COLUMN (0 of 29 described before, catalog count on
-- prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 632,036 rows on 2026-10-07 10:55Z by exact count (the
-- atlas estimate of 631,463 is a stale pg_class.reltuples), no insert, update or delete since the statistics counters began;
-- the newest row is from 2026-02-28.
--
-- METHOD (read 2026-10-07 10:50-11:05Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants and existing comments from pg_attribute,
--   pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and pg_description. Fill, values,
--   distributions and date windows are exact counts over the whole table (330 MB heap, read only, one scan per query); the
--   key sets and elements of context_available and fields_extracted are exact counts too. The orphan count is an anti-join to
--   vehicles over the whole table; whether the analyzed image still exists comes from a 1% block sample (TABLESAMPLE SYSTEM
--   (1) REPEATABLE (20261007), 5,600 rows) joined to vehicle_images. What anon can read comes from a count under SET LOCAL
--   ROLE anon in a read-only transaction. "Filled" means non-NULL and, for arrays, non-empty where stated.
--   Writers and readers from code at origin/main 0850d71b9 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs) and from git history: the edge function analyze-image, which wrote almost
--   every row and was deleted by commit 43b72deae (2026-03-07), read at c8a3004ee (version stamp analyze-image@2025-12-14)
--   and at 43b72deae^ (stamp analyze-image@2026-02-19); the edge function generate-work-logs (still in the repo, inserts and
--   updates the table); the two live public SQL functions that name the table (get_vehicle_ai_stats, which reads it, and
--   update_session_stats, which updates it and is attached to no trigger); the creating files
--   docs/archive/database/implement_ai_vision_schema.sql (the 16 original columns) and
--   supabase/migrations/20251205_ai_scan_history_system.sql (the other 13 columns and two policies); cron.job (no command names
--   the table or either edge function); pg_depend (no view or rule); write_receipts (no rows); pg_stat_user_tables;
--   pipeline_registry (no row for the table or mentioning it; none is added here).
-- LIMITS:
--   Rows have no run log; runs are dated by created_at. The 2025-12-14 stamp covers several revisions of analyze-image, so
--   which revision wrote a row is known only through the keys of context_available and the filled columns. The cause of the
--   orphan rows is not recorded. The 1% sample can miss rare cases. Quoted values are categorical codes, model names,
--   function names, key names and counts only: no ids, names or amounts of a person.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Each AI analysis run creates a session - all sessions saved (never replaced)". The first half
--   is true per image, not per run; the table comment now states the grain, the writers, the dormancy and what the columns
--   hold. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.ai_scan_sessions IS
'Audit log of AI image analysis runs, one row per image: the edge function analyze-image inserted a row after each image it analyzed (best effort, never replaced), so an image analyzed again gets another row (grain: one analysis run of one image; image_ids holds exactly one id on every row; 205 images have more than one row, at most 18). 632,036 rows on 2026-10-07 (the atlas estimate of 631,463 is a stale reltuples) for 29,814 vehicles (median 9 rows per vehicle, mean 21.2, maximum 10,758; 64 vehicles hold 1,000 or more rows, 181,988 in all). Dormant: every row was written between 2025-12-15 06:12Z and 2026-02-28 19:43Z, 607,929 of them on 8 days of February 2026 (2026-02-16 326,182; 2026-02-18 163,813; 2026-02-17 107,265), and pg_stat shows 0 writes since the counters began. Two writer stamps in ai_model_version: analyze-image@2025-12-14 on 631,406 rows (2025-12-15 .. 2026-02-18, several revisions of the function) and analyze-image@2026-02-19 on 630 rows (2026-02-19 .. 2026-02-28). analyze-image was deleted from the repo by commit 43b72deae on 2026-03-07 (platform triage); its code is in git history. The only writer left in the repo is generate-work-logs, which inserts one session per run with gpt-4o-mini or gpt-4o as ai_model_version and then updates scan_duration_seconds and event_id; it is run by hand (scripts/analyze-bundle-direct.js, scripts/analyze-image-bundles.js, scripts/generate-ai-work-logs.js), no cron calls it, and no row carries its stamp, so it has never written here. Shape: the columns come from two designs that were never reconciled in the migrations. 16 are from the AI vision schema (docs/archive/database/implement_ai_vision_schema.sql, meant for batch sessions: id, vehicle_id, session_start, session_end, ai_model, total_images_processed, successful_scans, failed_scans, total_components_detected, total_api_cost_usd, avg_processing_time_ms, status, error_message, batch_size, user_initiated, created_at) and 13 from 20251205_ai_scan_history_system.sql (event_id, image_ids, ai_model_version, ai_model_cost, context_available, total_images_analyzed, scan_duration_seconds, total_tokens_used, overall_confidence, fields_extracted, concerns_flagged, scanned_at, created_by), the ones analyze-image filled. By content (exact, 2026-10-07): 7 columns are NULL on every row (session_end, total_api_cost_usd, avg_processing_time_ms, error_message, batch_size, event_id, overall_confidence), 9 hold one constant on every row (ai_model, total_images_processed, successful_scans, failed_scans, total_components_detected, status, user_initiated, concerns_flagged, total_images_analyzed), session_start, created_at and scanned_at are the same instant on every row, and 10 carry data (id, vehicle_id, image_ids, ai_model_version, ai_model_cost, context_available, scan_duration_seconds, total_tokens_used, fields_extracted, created_by). Prod does not match the history migration (vehicle_id, image_ids and ai_model_version are nullable where it says NOT NULL, created_by has no ON DELETE SET NULL, and its indexes on event_id, scanned_at and ai_model_version are absent), so its CREATE TABLE IF NOT EXISTS did not create this table, and no ALTER TABLE in the repo adds its columns: they were added outside the migrations. The child tables the creating files name, ai_scan_field_confidence, image_forensic_attribution and ai_component_detections, do not exist on prod; nothing references this table by foreign key. Cost accounting is missing: ai_model_cost is 0 on 630,065 rows (99.7%) and positive on 1,971 (17.3325 USD in all). vehicle_id has a foreign key to vehicles ON DELETE CASCADE, validated, yet 73,417 rows (11.6%) point at a vehicle that no longer exists (created 2025-12 879, 2026-01 829, 2026-02 71,709); in a 1% sample the analyzed image is still in vehicle_images for 4,829 of 5,600 rows (86.2%). Readers: none live. The deleted analyze-image summed ai_model_cost per day against a daily cap (ANALYZE_IMAGE_DAILY_CAP, default 50 USD), which could not bite with cost recorded on 0.3% of rows. get_vehicle_ai_stats(uuid) (SECURITY DEFINER, executable by anon) reads max(session_start) but fails on every call with 42P01 because it reads ai_component_detections, which does not exist, and its search_path is empty; nothing in the repo calls it. update_session_stats() is a trigger function with no trigger attached and compares the wrong id. nuke_frontend/src/services/forensicReceiptService.ts names the table in a comment only. No view, rule, cron.job command or other edge function reads it; pg_stat showed 1 index scan and 0 sequential scans at about 10:50Z, before this work scanned it. A drop-list candidate (409 MB in all): no live writer, no live reader, nothing since 2026-02-28; recorded as a fact and not decided here. Access: RLS is on. The policy Public can view scan sessions (SELECT, true, all roles) lets anon read every row (632,036 counted under SET LOCAL ROLE anon on 2026-10-07), including created_by, a user id, on 97 of them. The policy Service role can create scan sessions (INSERT, WITH CHECK true) is not limited to service_role, so with the INSERT grant anyone with the public API key can insert rows. ai_sessions_owner_policy (ALL) lets the uploader of the vehicle change or delete its rows. No pipeline_registry row, no write receipts. Clocks: created_at, scanned_at and session_start are the database default now() at insert and are equal on every row; there is no event time of the analysis.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.ai_scan_sessions.id IS
'Surrogate key of the session row. Unit: none (uuid). Source: gen_random_uuid() default. Nothing references it by foreign key on prod (the creating files expected ai_scan_field_confidence.scan_session_id, a table that does not exist). Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.vehicle_id IS
'Vehicle the analyzed image belongs to: a vehicles.id, foreign key ON DELETE CASCADE (validated), nullable here although the history migration says NOT NULL. Filled on all 632,036 rows (2026-10-07); 29,814 distinct vehicles; 73,417 rows (11.6%) point at a vehicle that no longer exists, so the cascade did not remove them. Rows per vehicle: median 9, mean 21.2, maximum 10,758. The writer inserted a row only when the caller passed a vehicle id. Unit: none (uuid). Source: analyze-image request body vehicle_id. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.event_id IS
'Timeline event the analysis was attached to (creating comment: set after the timeline event is created), no foreign key. NULL on all 632,036 rows (2026-10-07): analyze-image wrote the timeline_event_id its caller supplied, and context_available.timeline_event_id is false on every row, so no caller supplied one; generate-work-logs would set it after creating a timeline_events row but has never written here. Unit: none (uuid, timeline_events.id). Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.image_ids IS
'Images analyzed in the run, an array of vehicle_images.id with no foreign key. Filled on every row with exactly one element (cardinality 1 on all 632,036 rows, 2026-10-07), because analyze-image analyzes one image per call; 205 images appear in more than one row (at most 18 rows for one image). In a 1% sample (5,600 rows) the image is still in vehicle_images, with the same vehicle, for 4,827 rows (86.2%). generate-work-logs would store the whole bundle here. Unit: none (uuid array). Source: analyze-image, the id of the vehicle_images row it processed. Grain: one analysis run of one image. Clock: n/a.';

-- ── Original batch-session columns (written by nothing) ─────────────────────────────────────────────────────────

COMMENT ON COLUMN public.ai_scan_sessions.session_start IS
'Start of a batch session in the original AI vision design. Default now(), no writer sets it, so it is the insert time and equals created_at and scanned_at on every row (632,036, 2025-12-15 06:12Z .. 2026-02-28 19:43Z). get_vehicle_ai_stats reads its maximum per vehicle as the last scan time, but that function fails. Unit: timestamptz. Source: column default. Grain: one analysis run of one image. Clock: ingest time.';
COMMENT ON COLUMN public.ai_scan_sessions.session_end IS
'End of a batch session in the original design. NULL on all 632,036 rows (100%, 2026-10-07): no writer closes a session. Unit: timestamptz. Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.ai_model IS
'Model name in the original design, varchar(50), NOT NULL, default gpt-4o. gpt-4o on all 632,036 rows (2026-10-07) because no writer sets it, so it is the default and not the model used: context_available.models_used shows aws-rekognition-detect-labels on 631,406 rows, gpt-4o-mini on 615,621 and gpt-4o on 42. Do not use it to tell models apart. Unit: none (text). Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.total_images_processed IS
'Images processed in a batch session in the original design, integer, default 0. 0 on all 632,036 rows (non-NULL, 2026-10-07); no writer sets it (total_images_analyzed is the column analyze-image filled). Unit: count. Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.successful_scans IS
'Successful scans in a batch session in the original design, integer, default 0. 0 on all 632,036 rows (non-NULL, 2026-10-07); no writer sets it. Unit: count. Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.failed_scans IS
'Failed scans in a batch session in the original design, integer, default 0. 0 on all 632,036 rows (non-NULL, 2026-10-07); no writer sets it, and analyze-image wrote no row for a failed image. Unit: count. Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.total_components_detected IS
'Vehicle components detected in a session in the original design, integer, default 0. 0 on all 632,036 rows (non-NULL, 2026-10-07). The only code that would change it is the trigger function update_session_stats(), which is attached to no trigger and compares the detection row id with the session id. Unit: count. Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.total_api_cost_usd IS
'API cost of a batch session in the original design, numeric(10,4). NULL on all 632,036 rows (100%, 2026-10-07): no writer sets it; the cost analyze-image recorded is in ai_model_cost. Unit: USD. Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.avg_processing_time_ms IS
'Average processing time per image in a batch session in the original design, integer. NULL on all 632,036 rows (100%, 2026-10-07); the run time analyze-image recorded is in scan_duration_seconds. Unit: milliseconds. Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.status IS
'Session state, varchar(20), default in_progress, CHECK in (in_progress, completed, failed, cancelled). in_progress on all 632,036 rows (2026-10-07) because no writer ever sets it or closes a session, so it is the default and says nothing about whether the analysis finished. Unit: none (text). Source: column default. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.error_message IS
'Error text of a failed session in the original design. NULL on all 632,036 rows (100%, 2026-10-07); analyze-image inserted its row only after it marked the image completed, so a failed analysis has no row. Unit: none (text). Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.batch_size IS
'Images requested in a batch session in the original design, integer. NULL on all 632,036 rows (100%, 2026-10-07); no writer sets it. Unit: count. Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.user_initiated IS
'Whether a person started the session, boolean, default true. true on all 632,036 rows (non-NULL, 2026-10-07) because no writer sets it, so it does not separate user requests from batch runs; created_by is filled on only 97 rows. Unit: none (boolean). Source: column default. Grain: one analysis run of one image. Clock: n/a.';

-- ── What analyze-image recorded ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.ai_scan_sessions.ai_model_version IS
'Writer version stamp of the run, text, not a model version: analyze-image@2025-12-14 on 631,406 rows (2025-12-15 .. 2026-02-18; several revisions of the function carry this stamp) and analyze-image@2026-02-19 on 630 rows (2026-02-19 .. 2026-02-28). Filled on every row (2026-10-07). The creating comment expected a model name such as gpt-4o-mini, which is what generate-work-logs would write, but no row has one. Use context_available.models_used for the models. Unit: none (text). Source: analyze-image. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.ai_model_cost IS
'Cost of the run in USD as the writer computed it, numeric(10,6), default 0. 0 on 630,065 rows (99.7%, 2026-10-07) and positive on 1,971: 1,406 rows of the 2025-12-14 stamp (14.9552 USD in all, the same sum as context_available.openai_cost_usd) and 565 rows of the 2026-02-19 stamp (2.3773 USD); maximum 0.032231; 645 distinct values. The early analyze-image revisions wrote 0, so the column understates spend: the daily cap that summed it per day saw almost nothing. Unit: USD. Source: analyze-image. Grain: one analysis run of one image. Clock: as of created_at.';
COMMENT ON COLUMN public.ai_scan_sessions.context_available IS
'What the run had and used, a JSON object, default {}, never empty on prod. Two key sets (exact, 2026-10-07): models_used, openai_cost_usd, openai_tokens, rekognition, timeline_event_id, vehicle_id on 631,406 rows (stamp 2025-12-14) and cost_usd, models_used, timeline_event_id, tokens, vehicle_id on 630 (stamp 2026-02-19). rekognition, timeline_event_id and vehicle_id are booleans meaning supplied or present, not ids: rekognition true on 631,406 rows, vehicle_id true on all, timeline_event_id false on all. models_used is an array of aws-rekognition-detect-labels (631,406 rows), gpt-4o-mini (615,621) and gpt-4o (42); openai_cost_usd or cost_usd and openai_tokens or tokens are numbers. The keys the creating comment lists (exif_data, source_url, vehicle_history_count and others) are written only by generate-work-logs and occur on no row. Unit: none (jsonb). Source: analyze-image. Grain: one analysis run of one image. Clock: as of created_at.';
COMMENT ON COLUMN public.ai_scan_sessions.total_images_analyzed IS
'Images analyzed in the run, integer. 1 on all 632,036 rows (non-NULL, 2026-10-07), equal to the length of image_ids, because analyze-image analyzes one image per call. Unit: count. Source: analyze-image (constant 1). Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.scan_duration_seconds IS
'Run time of the analysis in seconds, numeric(8,2). Filled on all 632,036 rows (2026-10-07): minimum 0.16, mean 2.04, maximum 85.03. Measured by analyze-image as the elapsed time of the call. Unit: seconds. Source: analyze-image (and generate-work-logs would update it after the insert). Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.total_tokens_used IS
'Language-model tokens used by the run, integer. Filled on 1,971 rows (0.3%, 2026-10-07): 1,406 of the 2025-12-14 stamp and 565 of the 2026-02-19 stamp, range 783 .. 53,428; NULL on 630,065 rows, so most runs have no token count. Unit: tokens. Source: analyze-image. Grain: one analysis run of one image. Clock: as of created_at.';
COMMENT ON COLUMN public.ai_scan_sessions.overall_confidence IS
'Confidence of the run in its own output, numeric(5,2), CHECK between 0 and 100. NULL on all 632,036 rows (100%, 2026-10-07): analyze-image passes null explicitly. generate-work-logs would write its work log confidence times 100 but has never written a row. Unit: score, 0 .. 100. Source: none. Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.fields_extracted IS
'Which outputs the run produced, a text array with no CHECK. Filled on all 632,036 rows (non-NULL; empty on 65, 2026-10-07). Elements: tags (631,406 rows; AWS Rekognition labels saved on the image), tier1 (615,621; the gpt-4o-mini appraiser result), vin (36; a VIN tag read) and spid (6; an SPID label read); length 1 on 16,882 rows, 2 on 615,080, 3 on 9. The creating comment lists parts, labor, materials and quality, which only generate-work-logs writes and no row holds. Unit: none (text array). Source: analyze-image. Grain: one analysis run of one image. Clock: as of created_at.';
COMMENT ON COLUMN public.ai_scan_sessions.concerns_flagged IS
'Issues the run flagged, a text array. An empty array on all 632,036 rows (non-NULL, 2026-10-07): analyze-image always writes an empty list. Unit: none (text array). Source: analyze-image (constant empty). Grain: one analysis run of one image. Clock: n/a.';
COMMENT ON COLUMN public.ai_scan_sessions.created_by IS
'Account that requested the analysis: an auth.users id (foreign key with no ON DELETE action), taken from the user_id of the request. Filled on 97 rows (0.015%, 2026-10-07): 96 of the 2025-12-14 stamp and 1 of the 2026-02-19 stamp; NULL on 631,939, calls whose request carried no user_id. Readable by anon through the public read policy. Unit: none (uuid). Source: analyze-image request body user_id. Grain: one analysis run of one image. Clock: n/a.';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.ai_scan_sessions.created_at IS
'When the row was inserted: default now(), set by the database. 2025-12-15 06:12Z .. 2026-02-28 19:43Z on all 632,036 rows (2026-10-07), equal to session_start and scanned_at on every row; by month 2025-12 17,933 (17 days), 2026-01 6,174 (24 days), 2026-02 607,929 (8 days); the largest days are 2026-02-16 (326,182), 2026-02-18 (163,813) and 2026-02-17 (107,265). Ingest time of the analysis; the image or vehicle event time is not recorded. Unit: timestamptz. Source: column default. Grain: one analysis run of one image. Clock: ingest time.';
COMMENT ON COLUMN public.ai_scan_sessions.scanned_at IS
'When the scan happened per the history design: default now(), set by the database, indexed in the creating migration by scanned_at DESC but not on prod. Equal to created_at and session_start on every row (2026-10-07), so it carries no information beyond them. Unit: timestamptz. Source: column default. Grain: one analysis run of one image. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.ai_scan_sessions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'ai_scan_sessions: every column has a comment';
  ELSE
    RAISE NOTICE 'ai_scan_sessions columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
