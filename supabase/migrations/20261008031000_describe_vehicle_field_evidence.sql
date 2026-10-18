-- Describe vehicle_field_evidence: the 18 columns without a comment (1 of 19 had one, flagged_as_incorrect, written tonight
-- by 20261008013000_flag_fabricated_field_evidence.sql and kept unchanged; catalog count on prod, 2026-10-07) and a
-- corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 748,037 rows on 2026-10-07 14:49Z by exact count (the
-- atlas estimate of 748,432 is a stale pg_class.reltuples); the newest row was created 2026-10-02 15:16Z and the newest
-- write is the flag run of 2026-10-07 14:16-14:17Z.
--
-- METHOD (read 2026-10-07 14:49-14:55Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description; foreign keys in and views from pg_constraint and
--   pg_depend (none). The row count, the counts by source_type, field_name and extraction_model, the fills of every
--   column, the placeholder text undefined per field, the value_number ranges, the metadata keys and their agreement with
--   source_id, source_type and created_at, the clock comparisons, the distinct vehicles and sources, the month counts and
--   the ai_visual rows against vehicles and vehicle_images are exact counts over the whole table (372 MB heap, 541 MB in
--   all, read only). The orphan vehicle ids of the service rows, the service_executions match of source_id and the share
--   of rows on vehicles with an uploader come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 6,876
--   rows), because the exact anti-join against vehicles exceeded the 10 s timeout. What anon can read comes from a count
--   under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main aa850dad4 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating migration
--   supabase/migrations/20251203_service_integration_framework.sql; prod migration 20260320161304
--   ai_extraction_passes_and_evidence (supabase_migrations.schema_migrations; not in the repo), which added
--   extraction_method, snapshot_id and extraction_run_id; 20251203_auto_service_triggers.sql;
--   20260927200000_p3_9_spid_and_labor_rate_trigger_bodies.sql; 20261008013000_flag_fabricated_field_evidence.sql and
--   20261008002000_describe_service_executions.sql; the former writer supabase/functions/service-orchestrator (added by
--   544979418, 2025-12-04; moved to _archived by 851a638b9, 2026-02-01; deleted by 43b72deae, 2026-03-07; read at
--   851a638b9^; not in the deployed function list, 328 functions, read through the management API) and its adapters in
--   supabase/functions/_shared/serviceAdapters.ts; supabase/functions/photo-pipeline-orchestrator (deployed version 66,
--   2026-10-03 03:02Z, after the last commit to its source); the bodies, read with pg_get_functiondef, of the 2 live
--   functions whose body names the table (track_spid_form_completion, flag_fabricated_field_evidence); pg_trigger
--   (spid_form_completion_tracker on vehicle_spid_data); cron.job (photo-pipeline-drain, jobid 478, inactive; no command
--   names the table); write_receipts (39 rows); pg_stat_user_tables; pipeline_registry (1 table-level row; none is added
--   or changed here). Reader code: supabase/functions/mcp-connector (query_field_evidence), scripts/expand-normalization-
--   rules.mjs; nuke_frontend/src reads field_evidence, a different table.
-- LIMITS:
--   The orphan shares of the service rows come from a 1% block sample. How the orphan rows lost their vehicle is not
--   recorded. Which adapter key produced which NHTSA value is inferred from the adapter source and the 100% rate of the
--   placeholder on 3 fields, not from stored responses. pg_stat_user_tables counters began at the last server start
--   (2026-09-29 09:20Z). value_text holds VINs on the vin rows: quoted values are source types, field names, model names,
--   the placeholder text undefined, column and function names and counts only; no VIN, vehicle id, user id or value of
--   one vehicle.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Per-field evidence for vehicle values: one row per claimed value of one field from one source (grain:
--   vehicle x field x source claim) with confidence, extraction method and snapshot. Writers: photo-pipeline-orchestrator,
--   SQL track_spid_form_completion. Event time = extracted_at; ingest time = created_at (2025-12-27 .. 2026-04-01 in a 1%
--   sample; 1 row write since the statistics reset)." The opening and the grain stay. Corrected: 746,044 of the rows
--   (99.7%) came from the deleted service-orchestrator, not the two writers named; extraction method and snapshot are
--   never filled; extracted_at is not an event time (it equals created_at on every row, the insert clock); the rows span
--   2025-12-04 .. 2026-10-02. Added: the flag run, the undefined placeholder text, the orphans, the readers and the access.
--   Column flagged_as_incorrect: unchanged (written tonight by 20261008013000; its 193,752 rows are now flagged).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_field_evidence IS
'Per-field evidence for vehicle values: one row per claimed value of one field from one source (grain: vehicle x field x source claim; UNIQUE vehicle_id, field_name, source_type, source_id). 748,037 rows on 2026-10-07 (the atlas estimate of 748,432 is a stale reltuples) for 74,911 vehicles, from 3 source types: nhtsa_vin_decode 552,292 (13 fields on 42,484 vehicles), hagerty_instant_quote 193,752 (4 fields on 48,438 vehicles) and ai_visual 1,993 (the field vin from 1,993 VIN-plate photos of 826 vehicles). Writers: 746,044 rows (99.7%) came from the edge function service-orchestrator, which upserted the fields of each completed service_executions run with source_id set to the run id, created 2025-12-04 .. 2026-02-18 21:55Z (added by commit 544979418; archived by 851a638b9 on 2026-02-01 while its deployed copy kept running; deleted by 43b72deae on 2026-03-07; not deployed now). The deployed photo-pipeline-orchestrator (writer since commit 96d827033, 2026-02-15) upserts the ai_visual rows: 1,993 created 2026-02-16 .. 2026-10-02; its cron job photo-pipeline-drain (jobid 478) is inactive. The trigger spid_form_completion_tracker on vehicle_spid_data (track_spid_form_completion) would add spid_sheet rows, but vehicle_spid_data holds 1 row from 2025-11-22 and no spid_sheet row exists. Correction: flag_fabricated_field_evidence (migration 20261008013000) set flagged_as_incorrect on all 193,752 hagerty_instant_quote rows on 2026-10-07 14:16-14:17Z (39 write receipts), because the adapter returned placeholders (the model year times 100, 150, 200 and 180, confidence 50) and no Hagerty API was ever called; the values stay as written and readers must exclude flagged rows. Not flagged: 238,223 nhtsa_vin_decode rows (43.1% of them) hold the literal text undefined, which is not a decoded value (see value_text). Liveness: pg_stat_user_tables counts 1 insert (the ai_visual row of 2026-10-02), 193,752 updates (the flag run) and 0 deletes since the server last started (2026-09-29 09:20Z; read 14:50Z). Orphans: the foreign key to vehicles is ON DELETE CASCADE and validated, yet 22 of the 1,993 ai_visual rows (exact) and 359 of 6,876 rows of a 1% block sample (5.2%; hagerty_instant_quote 7.4%, nhtsa_vin_decode 4.4%) point at a vehicle id that is not in vehicles; how is not recorded (service_executions shows the same pattern). Never filled: value_date, value_json, extraction_method, snapshot_id and extraction_run_id (NULL), verified_by_user (false). Readers: the mcp-connector tool query_field_evidence returns every row of a vehicle and field, ordered by confidence, flagged rows included, through the service role and to callers without authentication (a read tool); scripts/expand-normalization-rules.mjs; no SQL function, view or frontend page reads the table (the frontend provenance popups read field_evidence, another table). Access: RLS is on. The policy Users can view evidence for their vehicles (SELECT, every role) admits rows whose vehicle has uploaded_by = auth.uid(): anon reads 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07); 34 ai_visual rows sit on vehicles with an uploader (1 account), and no row of the 1% sample does. anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, but no policy admits a write, so they cannot write rows through the API. pipeline_registry holds one table-level row (owner photo-pipeline-orchestrator; write_via names the photo pipeline, the SPID trigger and the flag writer; updated 2026-10-07 14:15Z). The creating migration supabase/migrations/20251203_service_integration_framework.sql declares an index on source_type that prod lacks; extraction_method, snapshot_id and extraction_run_id come from prod migration 20260320161304, which is not in the repo. Clocks: created_at and extracted_at are both the database time of the insert and are equal on every row; no column holds when the source produced the value (metadata.extracted_at on service rows is the worker clock, within 24 s of created_at); the flag time is metadata.flagged_incorrect.at.';

-- ── Identity and subject ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_field_evidence.id IS
'Surrogate key of the evidence row, uuid, gen_random_uuid() default, the PRIMARY KEY. 748,037 values (2026-10-07). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.vehicle_id IS
'Vehicle the claim is about: a vehicles.id, uuid, nullable, foreign key ON DELETE CASCADE (validated), the first column of the UNIQUE key (vehicle_id, field_name, source_type, source_id) and of idx_evidence_vehicle_field (vehicle_id, field_name). Filled on every row (2026-10-07): 74,911 distinct vehicles, nhtsa_vin_decode 42,484, hagerty_instant_quote 48,438, ai_visual 826. Despite the validated key, 22 of the 1,993 ai_visual rows (16 vehicles, exact) and 359 of 6,876 rows of a 1% block sample (5.2%; hagerty_instant_quote 138 of 1,869, nhtsa_vin_decode 220 of 4,978) point at an id that is not in vehicles; deleting the vehicle should have removed them, and how they lost it is not recorded. The RLS policy reads it to admit the uploader of the vehicle. Unit: none (uuid). Source: the writer (the vehicle of the service run, or the vehicle the photo pipeline resolved). Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.field_name IS
'Vehicle field the claim is for, text NOT NULL, a name chosen by the writer (no CHECK, no registry). 18 occur (2026-10-07): from nhtsa_vin_decode body_style, displacement, drivetrain, engine_type, fuel_type, make, manufacturer, model, plant_city, plant_state, series, trim and year (42,484 rows each, the keys of the NHTSA adapter in supabase/functions/_shared/serviceAdapters.ts); from hagerty_instant_quote insurance_value, market_value_avg, market_value_high and market_value_low (48,438 each); from ai_visual vin (1,993). Part of the UNIQUE key and of idx_evidence_vehicle_field. Unit: none (text code). Source: the writer. Grain: one evidence row. Clock: n/a.';

-- ── Value ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_field_evidence.value_text IS
'The claimed value as text, nullable, filled on every row (2026-10-07); the service worker wrote String(value) for every field, so it also carries the numbers of year and of the four Hagerty fields. The literal text undefined, the JavaScript rendering of a missing value, stands in 238,223 of the 552,292 nhtsa_vin_decode rows (43.1%) and is not a decoded value: on every row of displacement, fuel_type and plant_state (42,484 each), because the adapter looks up displacement_l, fuel_type_primary and plant_state_province while its key rule (the NHTSA variable name lower-cased, spaces to underscores) yields other keys for those variables; and where NHTSA returned no value, on drivetrain 31,526, series 28,264, trim 22,194, engine_type 17,173, body_style 3,676, model 3,586, plant_city 2,585, make 1,121 and manufacturer 646 rows. Exclude value_text = undefined. The hagerty_instant_quote values are placeholders (see flagged_as_incorrect). The ai_visual values are VINs read from photos: 17 characters on 1,471 and equal to vehicles.vin ignoring case on 1,202 of the 1,971 rows whose vehicle exists (159 of those vehicles have no VIN). Holds VINs; none is quoted here. Unit: none (text). Source: the writer. Grain: one evidence row. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_field_evidence.value_number IS
'The claimed value as a number where the writer had one, numeric, nullable. Filled on 236,236 rows (2026-10-07): the year rows of nhtsa_vin_decode (42,484; equal to value_text on every row; 1980 .. 2028, with 60 rows of 2027 and 24 of 2028) and the four hagerty_instant_quote fields (193,752, the placeholder amounts described under flagged_as_incorrect). NULL on the other nhtsa_vin_decode fields and on every ai_visual row. Unit: per field: model year for year; US dollars, as placeholders, for the Hagerty fields. Source: the writer. Grain: one evidence row. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_field_evidence.value_date IS
'Intended for date values (creating migration: for dates), date, nullable. NULL on all 748,037 rows (2026-10-07); no writer sets it. Unit: date. Source: none (never written). Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.value_json IS
'Intended for complex values (creating migration: for complex data), jsonb, nullable. NULL on all 748,037 rows (2026-10-07): the photo pipeline sends it only for object values and has stored none; the service worker never sent it. Unit: none (jsonb). Source: none (no values). Grain: one evidence row. Clock: n/a.';

-- ── Source ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_field_evidence.source_type IS
'Kind of source that made the claim, text NOT NULL, no CHECK and no index (the index on it in the creating migration is absent on prod). 3 values occur (2026-10-07): nhtsa_vin_decode 552,292, hagerty_instant_quote 193,752 (all flagged as fabricated placeholders), ai_visual 1,993. On service rows it is the service_key of the service_executions run (equal to metadata.service_key on all 746,044); the photo pipeline writes ai_visual for every image type. The creating migration listed other intended kinds (spid_sheet, user_input, ocr_title, ocr_registration, factory_manual, vin_tag, gm_heritage, carfax, appraisal; nhtsa_decode and hagerty under shorter names); none of them occurs, and track_spid_form_completion would write spid_sheet. Part of the UNIQUE key. Unit: none (text code). Source: the writer. Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.source_id IS
'Id of the source record, uuid, nullable, no foreign key; part of the UNIQUE key, where a NULL never collides. Filled on every row (2026-10-07). On nhtsa_vin_decode and hagerty_instant_quote rows it is the service_executions.id of the run (one run per vehicle and service: 42,484 and 48,438 distinct ids; equal to metadata.service_execution_id on all 746,044 rows; every id of a 1% block sample exists in service_executions). On ai_visual rows it is the vehicle_images.id of the VIN-plate photo (1,993 distinct); of the 1,971 rows whose vehicle exists, 1,790 ids are in vehicle_images, 1,788 of them on the same vehicle. Unit: none (uuid). Source: the writer. Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.confidence_score IS
'Confidence the writer assigned to the claim, integer, nullable, CHECK 0 to 100. Filled on every row (2026-10-07) and fixed per source: nhtsa_vin_decode 95 and hagerty_instant_quote 50, constants of the adapters in supabase/functions/_shared/serviceAdapters.ts; ai_visual 85 to 100 (median 95), which is round(100 x the image classifier confidence that the photo is a VIN plate), not a confidence in the characters read. mcp-connector query_field_evidence orders by it. Unit: percent (0 to 100). Source: the writer. Grain: one evidence row. Clock: as of created_at.';
COMMENT ON COLUMN public.vehicle_field_evidence.extraction_model IS
'Who produced the value, text, nullable. Filled on every row (2026-10-07): NHTSA (US Government) on the 552,292 nhtsa_vin_decode rows and Hagerty on the 193,752 hagerty_instant_quote rows (the provider of the service integration, copied by the worker), photo-pipeline-v1 on the 1,993 ai_visual rows. Hagerty names the intended provider; no Hagerty system produced those values (see flagged_as_incorrect). Unit: none (text). Source: the writer. Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.extraction_method IS
'Added with snapshot_id and extraction_run_id by prod migration 20260320161304 ai_extraction_passes_and_evidence (2026-03-20; not in the repo; it says only Add AI tracking columns), alongside the table ai_extraction_passes, which has columns of the same names for extraction_method and snapshot_id. text, nullable. NULL on all 748,037 rows (2026-10-07); no writer sets it. Unit: none (text). Source: none (never written). Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.snapshot_id IS
'Added by prod migration 20260320161304 (see extraction_method), uuid, nullable, no foreign key; which snapshot table it was meant to reference is not recorded. NULL on all 748,037 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one evidence row. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_field_evidence.extraction_run_id IS
'Added by prod migration 20260320161304 (see extraction_method), uuid, nullable, no foreign key; which run it was meant to reference is not recorded. NULL on all 748,037 rows (2026-10-07). Unit: none (uuid). Source: none (never written). Grain: one evidence row. Clock: n/a.';

-- ── Review ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_field_evidence.verified_by_user IS
'Whether a user confirmed the claim, boolean, nullable, default false. false on all 748,037 rows (2026-10-07); no writer, function or page sets it. Unit: none (boolean). Source: column default. Grain: one evidence row. Clock: n/a.';

-- ── Extras and clocks ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_field_evidence.metadata IS
'Extraction context, jsonb, nullable, an object on every row (2026-10-07). Service rows (746,044): service_execution_id (equal to source_id), service_key (equal to source_type) and extracted_at (the worker clock, within 24 s of created_at). ai_visual rows (1,993): image_type (vin_plate on all) and pipeline (photo-pipeline-orchestrator). Since 2026-10-07 the 193,752 flagged rows add flagged_incorrect {at, writer, reason, source_type}, written by flag_fabricated_field_evidence. Unit: none (jsonb). Source: the writer, then the correction writer. Grain: one evidence row. Clock: as of created_at; flagged_incorrect.at for the flag.';
COMMENT ON COLUMN public.vehicle_field_evidence.extracted_at IS
'Meant as when the value was extracted (creating migration), timestamptz, nullable, default now(). No writer sends it, so it is the database time of the insert: equal to created_at on all 748,037 rows (2026-10-07); an upsert that updates a row keeps it. On service rows the worker clock is in metadata.extracted_at. Unit: timestamptz. Source: column default. Grain: one evidence row. Clock: ingest time, not the time the source produced the value.';
COMMENT ON COLUMN public.vehicle_field_evidence.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert, never updated. Filled on every row, 2025-12-04 23:27Z .. 2026-10-02 15:16Z (2026-10-07); by month 2025-12 29,823, 2026-01 261,436, 2026-02 455,592, 2026-03 937, 2026-04 239, 2026-05 1, 2026-06 1, 2026-07 7, 2026-10 1. Service rows 2025-12-04 .. 2026-02-18 21:55Z, ai_visual rows 2026-02-16 .. 2026-10-02. Equal to extracted_at on every row. Unit: timestamptz. Source: column default. Grain: one evidence row. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_field_evidence'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_field_evidence: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_field_evidence columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
