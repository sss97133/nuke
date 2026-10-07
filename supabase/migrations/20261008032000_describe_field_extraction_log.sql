-- Describe field_extraction_log: all 16 columns (0 of 16 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas (4,790 inserts and 8,000 deletes since the statistics
-- counters began): 4,157,179 rows on 2026-10-07 14:58Z by exact count (the atlas estimate of 3,890,480 is a stale
-- pg_class.reltuples); the newest row was created 2026-10-07 14:31Z.
--
-- METHOD (read 2026-10-07 14:57-15:02Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint,
--   pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in and views from pg_constraint and
--   pg_depend (none). Exact over the whole table (1,092 MB heap, 1,437 MB in all, read only): the row count, the
--   created_at range and the rows under 90 days old, the counts by extractor_name and month, the fill of every column,
--   the counts by extraction_status, and the 502 validation_fail rows by extractor, field, error code and json type.
--   Everything else comes from a 0.1% block sample (TABLESAMPLE SYSTEM (0.1) REPEATABLE (20261007), 3,343 rows from 281
--   runs, created 2026-01-28 .. 2026-03-23): sources, field names, run structure, confidence values, URL hosts, clock
--   precision and orphan vehicle ids. Two exact scans (by source, and by source since 2026-04) exceeded the 10 s timeout,
--   so the sources of rows written after 2026-03 are not measured. What anon can read comes from a count under SET LOCAL
--   ROLE anon in a read-only transaction (refused). "Filled" means non-NULL.
--   Writers and readers from code at origin/main aa850dad4 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted extractors): the creating migration
--   supabase/migrations/20260124_extraction_health_system.sql (not in supabase_migrations.schema_migrations; the only
--   logged migration that names the table is 20260314031411 rls_lockdown_internal_tables);
--   20260623200000_analysis_events_pipeline_feed.sql; 20260927170200_revoke_delete_truncate_on_testimony.sql; the writer
--   supabase/functions/_shared/extractionHealth.ts (ExtractionLogger) and its importers extract-vehicle-data-ai (deployed
--   version 182, 2026-10-06 21:29Z, after the last commit to its source), extract-ebay-motors and scrape-vehicle; the
--   direct insert in identify-vehicle-from-image (deployed 2026-09-27 15:56Z); the former extractors bat-simple-extract
--   and bat-extract (deleted by commit 43b72deae, 2026-03-07; read at 43b72deae^; neither in the deployed function list,
--   328 functions, read through the management API); pg_proc (no function body names the table); cron.job and
--   cron.job_run_details (retention-field-extraction-log, jobid 417, 119 runs); pg_depend (no view); pg_trigger (none);
--   write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 table-level row; none is added or changed here).
-- LIMITS:
--   Sources, field names, confidence values and orphan shares come from a 0.1% block sample that holds rows of
--   2026-01-28 .. 2026-03-23 only; the 12,582 rows of the last 90 days are not in it. Per-extractor fills of vehicle_id
--   are sampled. The retention job deletes rows chosen without order, so the month counts are what is left, not what was
--   written. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). extracted_value and
--   source_url hold public listing URLs, auction-site handles, seller locations and listing text: quoted values are
--   extractor, source, status, field and error codes, URL hosts with paths masked, column and function names and counts
--   only; no handle, location, URL path, VIN or vehicle id.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Field-level extraction outcome log: one row per field an extractor attempted on one source (grain:
--   extraction run x field), with status, value, expected value, confidence and timing. Created by
--   20260124_extraction_health_system for drift detection. Writers: _shared extraction helpers (identify-vehicle-from-image
--   and callers of _shared). Event and ingest time = created_at (logged as the extraction runs; 2026-01-25 .. 2026-10-04).
--   Cron retention-field-extraction-log prunes old rows." The opening and the grain stay. Corrected: expected value and
--   timing are never filled; identify-vehicle-from-image writes no row (its insert fails); nothing on prod does drift
--   detection or reads the log; created_at is the writer clock at the end of a run, not the time each field was read;
--   the retention job removes 1,000 rows a day against 4.1 million eligible. Added: the writers by volume, the deleted
--   extractors, the liveness, the missing vehicle ids, the access and the clocks.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.field_extraction_log IS
'Field-level extraction outcome log: one row per field an extractor attempted in one run (grain: extraction run x field), with status, value and confidence. 4,157,179 rows on 2026-10-07 by exact count (the atlas estimate of 3,890,480 is a stale reltuples), created 2026-01-25 00:36Z .. 2026-10-07 14:31Z. Writer: ExtractionLogger in supabase/functions/_shared/extractionHealth.ts, which collects the fields of one run under a random extraction_run_id and inserts them in one batch at flush. By extractor (exact): bat-simple-extract 3,394,468 rows (81.7%, 2026-01-25 .. 2026-03-06) and bat-extract 14,637 (2026-02-01 .. 2026-02-02), both deleted from the repo by commit 43b72deae on 2026-03-07 and not deployed; extract-vehicle-data-ai 748,007 (2026-01-27 .. 2026-10-07; deployed, the only writer since 2026-03-19); extract-ebay-motors 67 (2026-03). scrape-vehicle imports the logger and has no row. identify-vehicle-from-image inserts directly, but its insert names columns the table lacks (confidence, extraction_method, status, metadata) and omits three NOT NULL ones, so it fails, the function swallows the error, and no row comes from it. Liveness: pg_stat_user_tables counts 4,790 inserts, 0 updates and 8,000 deletes since the server last started (2026-09-29 09:20Z; read 14:57Z); 12,582 rows are under 90 days old. Retention: the cron job retention-field-extraction-log (jobid 417, daily 03:30 UTC, active) deletes 1,000 rows older than 90 days per run, chosen without order; 111 runs did so from 2026-04-25 (111,000 rows) and 7 failed at startup. 4,144,597 rows (99.7%) are older than 90 days, so at that rate the backlog lasts about 11 years. Readers: none; no SQL function, view, edge function, script or page selects from it, and the cron job only deletes. The drift-detection functions and views, the policy and six of the seven secondary indexes of the creating migration supabase/migrations/20260124_extraction_health_system.sql are absent on prod; that file is not in the prod migration log, where the only migration naming the table is 20260314031411 rls_lockdown_internal_tables. Never filled: expected_value and extraction_time_ms. vehicle_id is NULL on 962,174 rows (extract-vehicle-data-ai never sets it), and in a 0.1% block sample 5.7% of the filled ids point at a vehicle that no longer exists. Access: RLS is on with no policy; anon and authenticated hold no privilege (a count as anon is refused, 2026-10-07). No write receipts and no triggers. pipeline_registry holds one table-level row (owner extractionHealth). The values include public auction-site handles and seller locations (see extracted_value). Clock: created_at is the writer clock at the end of the run (flush), shared by the rows of a run; no column holds when each field was read.';

-- ── Identity and run ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.id IS
'Surrogate key of the log row, uuid, gen_random_uuid() default, the PRIMARY KEY. 4,157,179 values (exact count, 2026-10-07). Nothing references it. Unit: none (uuid). Source: column default. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.vehicle_id IS
'Vehicle the extraction was for: a vehicles.id, uuid, nullable, foreign key ON DELETE CASCADE (validated), indexed (idx_field_extraction_vehicle, the only secondary index). Filled on 3,195,005 rows (76.9%, exact, 2026-10-07). extract-vehicle-data-ai never sets it (its logger gets no vehicle id; 0 of 465 sampled rows); bat-simple-extract set it on 2,604 of 2,868 sampled rows. In a 0.1% block sample, 148 of the 2,614 filled values (5.7%) point at an id that is not in vehicles although the key cascades; how is not recorded. Unit: none (uuid). Source: the extractor (the logger config, or setVehicleId after the vehicle was created). Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.extraction_run_id IS
'Id of the extraction run: crypto.randomUUID() of one ExtractionLogger instance, shared by every field row of the run, uuid NOT NULL, no foreign key, no index (the creating migration indexed it; prod lacks the index), stored in no other table. In a 0.1% block sample (281 runs) a run has a median of 12 rows and at most 23, one source_url, at most one vehicle and each field once (extract-vehicle-data-ai adds a second vin row for a failed VIN check); 273 of the 281 runs carry one created_at. Unit: none (uuid). Source: ExtractionLogger. Grain: one field of one extraction run. Clock: n/a.';

-- ── Source and extractor ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.source IS
'Source the extractor read, a free-text slug, text NOT NULL, no CHECK. In a 0.1% block sample (3,343 rows, 2026-01-28 .. 2026-03-23): bat 2,878 (bat-simple-extract and bat-extract), collecting_cars 306 and unknown 159 (extract-vehicle-data-ai, which logs the caller source or the URL slug, else unknown). extract-ebay-motors logs ebay-motors. The sources of rows written after 2026-03 were not measured (the exact scans exceeded the 10 s timeout). Unit: none (text code). Source: the extractor config. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.source_url IS
'Page the extractor read, text, nullable, filled on every row (exact, 2026-10-07), one per run. In the 0.1% sample: bringatrailer.com/listing/ pages for the BaT extractors; collectingcars.com/for-sale/, barrett-jackson.com and jamesedition.com pages and conceptcarz:// pseudo-URLs (a non-web scheme holding an event id and a title; 63 of the 159 rows of source unknown) for extract-vehicle-data-ai. Public listing pages; none is quoted here. Unit: none (URL). Source: the extractor (sourceUrl). Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.extractor_name IS
'Edge function that ran the extraction, text NOT NULL, no index (the creating migration indexed it; prod lacks the index). 4 values occur (exact, 2026-10-07): bat-simple-extract 3,394,468 (2026-01-25 .. 2026-03-06; deleted by commit 43b72deae on 2026-03-07, not deployed), extract-vehicle-data-ai 748,007 (2026-01-27 .. 2026-10-07, deployed, the only writer since 2026-03-19), bat-extract 14,637 (2026-02-01 16:38Z .. 2026-02-02 01:10Z; deleted by 43b72deae, not deployed) and extract-ebay-motors 67 (2026-03-01 .. 2026-03-19, deployed). scrape-vehicle imports the logger but has no row. Unit: none (text code). Source: the extractor config. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.extractor_version IS
'Version string the extractor passes to the logger, text, nullable, filled on every row (exact, 2026-10-07): 1.0 for bat-simple-extract, extract-vehicle-data-ai and extract-ebay-motors, bat-extract:2.0.0 for bat-extract (0.1% sample and code). A constant in the code that was not changed with the code (extract-vehicle-data-ai still says 1.0 at deployed version 182), so it does not identify the code that ran. Unit: none (text). Source: the extractor config. Grain: one field of one extraction run. Clock: n/a.';

-- ── Field outcome ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.field_name IS
'Field the extractor tried to read, text NOT NULL, no CHECK. Fixed lists in the extractor code: in the 0.1% sample bat-simple-extract logs 23 fields (vin, year, make, model, title, mileage, location, exterior_color, interior_color, engine, drivetrain, body_style, transmission, seller_username, buyer_username, sale_price, high_bid, bid_count, comment_count, lot_number, reserve_status, description, images) and extract-vehicle-data-ai 19 (vin, year, make, model, series, trim, mileage, price, sold_price, exterior_color, interior_color, engine, transmission, drivetrain, body_style, description, images, seller, location). The creating migration indexed it with extraction_status; prod lacks the index. Unit: none (text code). Source: the extractor code. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.extraction_status IS
'Outcome of the attempt, text NOT NULL, CHECK in (extracted, not_found, parse_error, validation_fail, low_confidence). Exact counts (2026-10-07): extracted 3,186,906 (76.7%), not_found 936,267 (22.5%), low_confidence 33,504, validation_fail 502, parse_error never. Rule of ExtractionLogger.logField: not_found when the value is null, undefined or empty; low_confidence when the confidence is below the threshold (0.6 for extract-vehicle-data-ai, else 0.5); else extracted. validation_fail rows come from logValidationFail and are all VIN checks; bat-simple-extract logs a failed VIN only as validation_fail, extract-vehicle-data-ai logs it as extracted and again as validation_fail. Unit: none (text code). Source: ExtractionLogger. Grain: one field of one extraction run. Clock: n/a.';

-- ── Value and confidence ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.extracted_value IS
'The value read, as text (String(value)), nullable. Filled on 3,220,912 rows (77.5%, exact, 2026-10-07): every extracted, low_confidence and validation_fail row; NULL on not_found rows. For images it is an image count (bat-simple-extract), for bid_count and comment_count a number, else the text as read: titles, descriptions, colours, prices as written, and public auction-site handles (seller_username, buyer_username) and seller locations, which the table keeps; none is quoted here. Unit: none (text; per field). Source: the extractor. Grain: one field of one extraction run. Clock: as of created_at.';
COMMENT ON COLUMN public.field_extraction_log.expected_value IS
'Intended known-correct value for accuracy checks (creating migration: if known, for accuracy checking), text, nullable. NULL on all 4,157,179 rows (exact, 2026-10-07): logField accepts an expectedValue option but never stores it. Unit: none (text). Source: none (never written). Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.confidence_score IS
'Confidence the extractor assigned, numeric(3,2), nullable, CHECK 0 to 1. Filled on 4,156,677 rows (exact, 2026-10-07); NULL on the 502 validation_fail rows. A constant, not a measured accuracy: bat-simple-extract uses a fixed value per field from 0.70 (interior colour) to 0.95 (title, year, a 17-character VIN, handles, sale price, counts, lot number, images) and 0 when the field is absent; extract-vehicle-data-ai scales the model overall confidence (default 0.8) by a per-field factor, 0 when absent. In the 0.1% sample 0.00 on 699 rows and 0.40 .. 0.95 otherwise. Unit: ratio (0 to 1). Source: the extractor constants. Grain: one field of one extraction run. Clock: n/a.';

-- ── Errors and timing ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.error_code IS
'Structured error code, text, nullable, no index (the creating migration had a partial index on it; prod lacks it). Filled only on the 502 validation_fail rows (exact, 2026-10-07), all on field vin: INVALID_VIN_CHARS 329, INVALID_VIN_LENGTH 106, INVALID_VIN_FORMAT 64, INVALID_CHASSIS_FORMAT 3, from validateVin in supabase/functions/_shared/extractionHealth.ts. parse_error, the other status meant to carry a code, never occurs. Unit: none (text code). Source: validateVin. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.error_details IS
'Details of the error, jsonb, nullable. Filled on the same 502 rows (exact, 2026-10-07). ExtractionLogger stores JSON.stringify(details), so the value is a jsonb string that holds JSON text, not an object (jsonb_typeof string on all 502); parse the string to read its keys. Unit: none (jsonb string). Source: validateVin through ExtractionLogger. Grain: one field of one extraction run. Clock: n/a.';
COMMENT ON COLUMN public.field_extraction_log.extraction_time_ms IS
'Intended time spent on the field (from ExtractionLogger.startField to logField), integer, nullable. NULL on all 4,157,179 rows (exact, 2026-10-07): no extractor calls startField, so the logger records no time. Unit: milliseconds. Source: none (never measured). Grain: one field of one extraction run. Clock: n/a.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_extraction_log.created_at IS
'When the extractor flushed the run: ExtractionLogger.flush sends new Date().toISOString() of the edge function for every row of the run, so it is the writer clock (millisecond precision on every sampled row) at the end of the run, after the fields were read, not the time of each field; the default now() applies only to a writer that omits it. 2026-01-25 00:36Z .. 2026-10-07 14:31Z (exact, 2026-10-07). By extractor and month (exact): bat-simple-extract 2026-01 1,278,726, 2026-02 2,115,591, 2026-03 151; extract-vehicle-data-ai 2026-01 28,067, 2026-02 40,988, 2026-03 661,428, 2026-04 3,515, 2026-05 152, 2026-06 57, 2026-07 7,109, 2026-08 361, 2026-09 2,586, 2026-10 3,744; bat-extract 2026-02 14,637; extract-ebay-motors 2026-03 67. These are the rows left after the retention job removed 111,000 rows older than 90 days, chosen without order. No index (the creating migration indexed it with source, status and extractor; prod has none), so a time filter scans the whole table. Unit: timestamptz. Source: the writer clock. Grain: one field of one extraction run. Clock: writer time at the end of the run (ingest).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.field_extraction_log'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'field_extraction_log: every column has a comment';
  ELSE
    RAISE NOTICE 'field_extraction_log columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
