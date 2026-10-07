-- Describe import_queue_archive: all 26 columns, none had a COMMENT ON COLUMN (0 of 26 described before, catalog count on
-- prod, 2026-10-07) and a table comment, which was missing. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 830,737 rows on 2026-10-07 10:45Z by exact count (the atlas
-- estimate of 808,846 is a stale pg_class.reltuples; pg_stat n_live_tup is 0 because the table was never analyzed), no
-- insert, update or delete since the statistics counters began; the last row was archived on 2026-04-02.
--
-- METHOD (read 2026-10-07 10:44-10:58Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants and existing comments from pg_attribute,
--   pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and pg_description; the shape of the
--   source table public.import_queue (columns, constraints, comments) the same way. Fill, values, distributions and date windows
--   are exact counts over the whole table (227 MB heap, read only, one scan per query); source names come from a join to
--   scrape_sources; links to vehicles and to the live queue from anti-joins and joins over the whole table. What anon can read
--   comes from a count under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main abb9f2aab (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs; also a whole-repo search for the table name): the bodies of the 2 live public
--   SQL functions that name the table, read with pg_get_functiondef (cleanup_import_queue() and cleanup_import_queue(integer);
--   neither is a trigger, neither is SECURITY DEFINER), the cron.job and cron.job_run_details rows for jobid 146, the migration
--   20260927170000_p0_4_close_rpc_write_door.sql (which revokes both functions from anon and authenticated), pg_depend (no
--   view or rule), pg_trigger (none), write_receipts (no rows), pg_stat_user_tables and pipeline_registry (no row for the table
--   and none mentions it; no row is added here). No migration in the repo creates the table or the two functions (git history
--   searched with a pickaxe on the name: only the gooding intake migration of 2026-10-06 mentions the table).
-- LIMITS:
--   Rows have no run log; runs are dated by archived_at, which is one value per cleanup run (34 values). cron.job_run_details
--   keeps 2 rows for the job, so runs before 2026-04-14 are known only through archived_at. The queue clocks (created_at,
--   processed_at, last_attempt_at, next_attempt_at, locked_at, updated_at) are copied from the queue row and say nothing about
--   the move. Error text is described by its first 24 characters with digits masked, as a template, never by full value.
--   Listing text, URLs and ids are not quoted. The junk values in listing_price and listing_year come from the
--   functions that queued the rows, not from this table.
-- CHANGED EXISTING COMMENTS:
--   None: the table had no comment and no column comment. Noted for the queue, not changed here: the comment on
--   import_queue.failure_category lists six values (rate_limited, not_found, parse_error, network_error, duplicate,
--   validation_error); the archive holds 24 values and 3 of those six never occur in it.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.import_queue_archive IS
'Archive of finished import_queue rows: a copy of each queue row (same column names, same ids, same values) made by cleanup_import_queue at the moment it deleted the row from public.import_queue, the work queue of listing URLs to extract, plus archived_at. Grain: one archived queue row, not one URL: 830,737 rows hold 767,386 distinct listing_url, and 51,410 URLs were archived two to five times because the URL was queued again after it was archived (50,829 archive rows, 31,625 URLs, are in the live queue now); no id is in both tables. 830,737 rows on 2026-10-07 (the atlas estimate of 808,846 is a stale reltuples; pg_stat n_live_tup is 0 because the table was never analyzed, which is why docs/ledger/ledger.json lists it as DEAD with evidence 0 rows). Moved rows had status complete 533,649, skipped 248,114, duplicate 40,589 or failed 8,385 and were older than 7 days by COALESCE(processed_at, updated_at, created_at); they came from 278 sources, led by Bring a Trailer 256,535, Bonhams 170,215, Craigslist 85,858, Cars & Bids 53,669, Barrett-Jackson 49,603, Mecum 39,564, PCarMarket 34,465 and KSL Cars 34,056. Dormant: archived_at holds 34 values from 2026-02-10 10:21Z to 2026-04-02 03:00Z, one run outside the schedule on 2026-02-10 (129,755 rows) and 33 daily runs at 03:00Z (673,965 rows in March, the largest 388,584 on 2026-03-01, and 27,017 on 2026-04-01 and 2026-04-02); nothing has been written since and pg_stat shows 0 inserts, updates or deletes since the counters began. Writers: cleanup_import_queue() (moves every eligible row at once and copies raw_data) and cleanup_import_queue(integer) (batches of 5000 with a pause, writes raw_data as NULL; this is the variant cron job daily-import-queue-cleanup, jobid 146, calls: SELECT cleanup_import_queue(5000) at 0 3 * * *). raw_data is NULL on every archived row, which matches the batched variant. The job is inactive and its two recorded runs failed: 2026-04-14 03:00Z with a statement timeout inside the vehicles.import_queue_id SET NULL cascade, and 2026-04-25 03:00Z with a job startup timeout. Both functions were revoked from anon and authenticated by migration 20260927170000; service_role keeps EXECUTE. Both also delete archive rows whose archived_at is older than 90 days; the newest archived_at is 2026-04-02, so all 830,737 rows are already past that cutoff and the next successful run of either function deletes the whole table. Readers: none in code. No view, rule, policy, trigger, edge function, script or frontend code reads it, the only function bodies that name it are the two cleanup functions (insert and purge only), and pg_stat showed 4 sequential scans and 0 index scans at about 10:45Z, before this work scanned it. By hand, the Gooding intake lane counted listing URLs that are in none of import_queue, import_queue_archive or vehicles (comment in migration 20261006123000_enable_gooding_intake.sql), so it works as a memory of URLs already seen. A drop-list candidate (227 MB heap, no payload, no writer since 2026-04-02), recorded as a fact and not decided here. Unlike the queue it has no primary key, no NOT NULL, no CHECK and no foreign key, and one index on archived_at. Moving a row out of the queue sets vehicles.import_queue_id to NULL (foreign key ON DELETE SET NULL): none of the 102,404 vehicles with an import_queue_id points at an archived id (2026-10-07), so vehicle_id here is the only link left between an archived import and its vehicle. Access: RLS is on with no policy, so anon sees 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07) although anon and authenticated hold every table privilege; service_role and postgres read it. No pipeline_registry row, no write receipts. Content: scraped listing fields (url, title, price, year, make, model, thumbnail), queue state and error text; the payload column is empty. Clocks: created_at, processed_at, last_attempt_at, next_attempt_at, locked_at and updated_at are the queue row clocks copied unchanged; archived_at = when the cleanup run moved the row.';

-- ── Identity and source ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue_archive.id IS
'Id of the queue row that was archived: copied unchanged from import_queue.id (a gen_random_uuid() there). Nullable and with no primary key or unique constraint here, but 830,737 rows hold 830,737 distinct values (2026-10-07), and none of them is in import_queue now. vehicles.import_queue_id pointed at it until the delete from the queue set that column to NULL; no vehicle points at an archived id. Unit: none (uuid). Source: import_queue.id. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.source_id IS
'Scrape source that discovered the URL: a scrape_sources.id, copied from import_queue.source_id (a foreign key ON DELETE CASCADE there, none here). 278 distinct values, all present in scrape_sources (2026-10-07); NULL on 25,731 rows (3.1%). By rows: Bring a Trailer 256,535, Bonhams 170,215, Craigslist 85,858, Cars & Bids 53,669, Barrett-Jackson 49,603, Mecum 39,564, PCarMarket 34,465, KSL Cars 34,056 (scrape_sources.name). Unit: none (uuid). Source: import_queue.source_id, stamped when the URL was queued. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.listing_url IS
'URL of the listing that was queued for extraction, copied from import_queue.listing_url (unique in the queue, not unique here). Filled on every row (2026-10-07); 767,386 distinct values over 830,737 rows, 51,410 URLs archived two to five times (114,761 rows in all) because a URL can be queued again after its first row was archived; 50,829 rows (31,625 URLs) are in import_queue now. 7,449 rows (0.9%) do not start with http:// or https://. Unit: none (text, URL). Source: import_queue.listing_url, set by the function that queued it. Grain: one archived queue row. Clock: n/a.';

-- ── Listing fields as discovery saw them ────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue_archive.listing_title IS
'Title of the listing as the function that queued the URL had it, free text, copied from the queue. Filled on 254,318 rows (30.6%, 2026-10-07), NULL on 576,419; 2 rows hold an empty string. Unit: none (text). Source: import_queue.listing_title. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.listing_price IS
'Price the function that queued the URL had, in whole currency units as scraped; the currency is not stored. Its meaning depends on the writer: sale price or final bid (bat-closed-lots-sync), current bid (collecting-cars-discovery), hammer price or estimate (extract-bonhams-typesense), asking price (extract-craigslist; haiku-extraction-worker takes sale or asking price). bigint. Filled on 91,629 rows (11.0%, 2026-10-07): minimum 0 (470 rows are exactly 0), median 8,200, 99th percentile 45,001,988, maximum 111,111,111,111,111, so placeholder and junk values are present and the column needs a range filter before any use. Unit: currency units, currency unrecorded. Source: import_queue.listing_price. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.listing_year IS
'Model year the function that queued the URL had (parsed from the title or taken from the source record), integer, copied from the queue. Filled on 290,411 rows (35.0%, 2026-10-07); range 0 .. 3000 with 146 rows outside 1900 .. 2027 (parse errors). claim_import_queue_batch used it to order claims (newest year first after priority). Unit: model year. Source: import_queue.listing_year. Grain: one archived queue row. Clock: event time (model year, as parsed).';
COMMENT ON COLUMN public.import_queue_archive.listing_make IS
'Make the function that queued the URL had, free text with no key to a make table, copied from the queue. Filled on 291,195 rows (35.1%, 2026-10-07); 5,729 distinct spellings. Unit: none (text). Source: import_queue.listing_make. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.listing_model IS
'Model the function that queued the URL had, free text with no key to a model table, copied from the queue. Filled on 286,520 rows (34.5%, 2026-10-07); 61,961 distinct spellings. Unit: none (text). Source: import_queue.listing_model. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.thumbnail_url IS
'URL of the listing thumbnail image (the first image URL for extract-craigslist), copied from the queue; the image itself is not stored. Filled on 76,325 rows (9.2%, 2026-10-07); 44,742 distinct values. Unit: none (text, URL). Source: import_queue.thumbnail_url. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.raw_data IS
'Raw payload the queuing function attached to the queue row (default {} in the queue; extract-craigslist stores the post attribute block there: mileage, location, colors, drivetrain, fuel type and more). NULL on all 830,737 rows (2026-10-07): the batched cleanup function cleanup_import_queue(integer), which cron job 146 calls, writes NULL::jsonb instead of copying it, so no archived row keeps its payload. Unit: none (jsonb). Source: none (dropped on archive). Grain: one archived queue row. Clock: n/a.';

-- ── Queue state at the time of the move ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue_archive.status IS
'Final queue status of the row when it was moved, text, no CHECK here (the queue CHECK allows pending, processing, complete, failed, skipped, duplicate, pending_review and pending_strategy). Only the four statuses the cleanup functions select occur (2026-10-07): complete 533,649 (successfully processed), skipped 248,114 (intentionally bypassed; 248,066 of them carry an error_message giving the reason), duplicate 40,589 (the queue comment: URL already exists) and failed 8,385 (gave up). Filled on every row. Unit: none (text). Source: import_queue.status. Grain: one archived queue row. Clock: as of the move (archived_at).';
COMMENT ON COLUMN public.import_queue_archive.priority IS
'Claim priority of the row: workers claim the highest first (claim_import_queue_batch orders by COALESCE(priority, 0) DESC, then listing_year DESC, then created_at ASC). Filled on every row (2026-10-07); the queue default is 0 and other values are set by the function that queued the URL. Most frequent values: 0 on 409,606 rows (49.3%), 3 on 152,760, 2 on 78,362, 35 on 62,708, 5 on 43,525, 8 on 25,050, 50 on 22,074, 4 on 21,877. Unit: rank (integer, higher is claimed sooner). Source: import_queue.priority. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.error_message IS
'Reason text recorded when the row was failed, skipped or marked duplicate, free text copied from the queue. Filled on 319,500 rows (38.5%, 2026-10-07): 248,066 of the 248,114 skipped rows, 34,598 duplicate, 8,385 failed and 28,451 complete rows. Most frequent templates (first 24 characters, digits masked): Skipped: exceeded max re 57,226; Auto-filtered: Non-vehic 35,867; VIN already exists in ve 32,314; Auto-filtered: KSL block 27,031; Non-vehicle item (memora 26,534; memorabilia: skipped by 17,964; page.goto: Target page, 17,128 (a browser error); Auto-filtered: Memorabil 13,256; Non-vehicle item (parts/ 8,093; Skipped: exceeded max at 7,923. Unit: none (text). Source: import_queue.error_message. Grain: one archived queue row. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue_archive.failure_category IS
'Categorized reason for a failure or skip, free text with no CHECK, copied from the queue. Filled on 164,072 rows (19.8%, 2026-10-07), NULL on 666,665 (including most complete rows). 24 values: filtered 78,170, blocked 22,600, http_error 9,714, timeout 9,511, extraction_failed 8,436, listing_removed 7,053, gone 5,167, bad_data 3,952, unknown 3,315, needs_proxy 2,975, duplicate 2,402, no_data 2,222, needs_auth 2,086, rate_limited 1,522, non_vehicle 1,516, missing_fields 1,478, browser_crash 1,092, parse_error 678, redirect 73, auth_required 63, server_error 23, wrong_pipeline 18, invalid_url 3, data_quality 3. The comment on import_queue.failure_category lists six values; only duplicate, parse_error and rate_limited occur here, and not_found, network_error and validation_error never do. Unit: none (text). Source: import_queue.failure_category. Grain: one archived queue row. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue_archive.vehicle_id IS
'Vehicle the import created or matched: a vehicles.id copied from import_queue.vehicle_id, with no foreign key here. Filled on 420,905 rows (50.7%, 2026-10-07): 367,401 complete (68.8% of them), 30,926 duplicate, 16,230 skipped and 6,348 failed rows; 292,105 distinct vehicles, so several queue rows can point at one vehicle. 47,885 of the filled rows (11.4%) point at a vehicle that no longer exists. Once the queue row was deleted, vehicles.import_queue_id became NULL (ON DELETE SET NULL), so this column is the only remaining link from an archived import to its vehicle. Unit: none (uuid). Source: import_queue.vehicle_id. Grain: one archived queue row. Clock: as of processed_at.';

-- ── Attempts, locks and extractor ───────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue_archive.attempts IS
'Number of processing attempts the row had used when it was moved, integer, copied from the queue. Filled on every row (2026-10-07): 0 on 172,652, 1 on 185,841, 2 on 100,634, 3 on 111,888, 4 on 128,296, 5 on 128,249, 6 .. 9 on 3,177. Mean by status: complete 2.30, skipped 2.03, duplicate 3.07, failed 5.15 (above the usual cap of 3). Unit: count. Source: import_queue.attempts. Grain: one archived queue row. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue_archive.max_attempts IS
'Attempt cap the row carried when it was moved, integer, copied from the queue. Filled on every row (2026-10-07): 3 on 779,485 rows (93.8%), 5 on 50,030, 8 on 730, 7 on 492. Unit: count. Source: import_queue.max_attempts. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.locked_at IS
'When a worker claimed the row, copied from the queue; the cleanup does not clear it, so it is a leftover lock on rows that were archived while claimed. Filled on 64,268 rows (7.7%, 2026-10-07), 2026-01-24 .. 2026-03-09 (the queue treats a claim older than 30 minutes as stale). Unit: timestamptz. Source: import_queue.locked_at. Grain: one archived queue row. Clock: event time of the claim as our worker saw it.';
COMMENT ON COLUMN public.import_queue_archive.locked_by IS
'Worker instance that claimed the row, copied from the queue (the queue comment gives the format cqp-timestamp-random for continuous-queue-processor); a leftover on rows archived while claimed. Filled on 61,231 rows (7.4%, 2026-10-07), 3,037 fewer than locked_at. By the part before the first hyphen: process 58,945, cqp 994, bat 932, claude 268, parallel 79, sonnet 13. Unit: none (text). Source: import_queue.locked_by. Grain: one archived queue row. Clock: n/a.';
COMMENT ON COLUMN public.import_queue_archive.extractor_version IS
'Version label of the extractor that processed the row, copied from the queue (the queue comment: used to re-queue records when an extractor is updated). Filled on 75,304 rows (9.1%, 2026-10-07): extract-craigslist-v1 70,481, bat 1,789, bonhams-typesense-v1 1,696, bat-extract:2.0.0 1,008, collecting-cars-simple-v1 329, bat-extract:2.0.0-test 1; NULL on 755,433. Unit: none (text). Source: import_queue.extractor_version. Grain: one archived queue row. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue_archive.created_at IS
'When the URL was queued: the queue row created_at, copied unchanged (ingest time of our queue, not the date of the listing). Filled on every row (2026-10-07), 2025-12-02 .. 2026-03-26; by month: 2025-12 13,752, 2026-01 133,922, 2026-02 573,067, 2026-03 109,996. Queue rows created after 2026-03-26 were never archived. Unit: timestamptz. Source: import_queue.created_at. Grain: one archived queue row. Clock: ingest time.';
COMMENT ON COLUMN public.import_queue_archive.processed_at IS
'When the queue row was finished, copied from the queue. Filled on 593,954 rows (71.5%, 2026-10-07), 2025-12-02 .. 2026-03-26 03:00Z, never earlier than created_at: complete 494,125 of 533,649, duplicate 34,666 of 40,589, failed 7,175 of 8,385, skipped 57,988 of 248,114. Part of the age test the cleanup applies: COALESCE(processed_at, updated_at, created_at) older than 7 days. Unit: timestamptz. Source: import_queue.processed_at. Grain: one archived queue row. Clock: ingest time of our processing.';
COMMENT ON COLUMN public.import_queue_archive.next_attempt_at IS
'When a retry was scheduled (backoff), copied from the queue; on an archived row it is a retry that never ran. Filled on 175,576 rows (21.1%, 2026-10-07), 2025-12-26 .. 2026-03-26. Unit: timestamptz. Source: import_queue.next_attempt_at. Grain: one archived queue row. Clock: scheduled time, as set by our queue.';
COMMENT ON COLUMN public.import_queue_archive.last_attempt_at IS
'When the latest processing attempt started, copied from the queue. Filled on 661,749 rows (79.7%, 2026-10-07), 2025-12-16 .. 2026-03-31. Unit: timestamptz. Source: import_queue.last_attempt_at. Grain: one archived queue row. Clock: ingest time of the last attempt.';
COMMENT ON COLUMN public.import_queue_archive.updated_at IS
'The queue row own updated_at when it was moved, copied unchanged; the archive has no trigger and sets nothing. Filled on 752,926 rows (90.6%, 2026-10-07), NULL on 77,811 (9.4%, rows whose queue writers never set it); 2026-01-22 .. 2026-04-02 00:35Z. Part of the age test the cleanup applies. Unit: timestamptz. Source: import_queue.updated_at. Grain: one archived queue row. Clock: ingest time of the last queue update.';
COMMENT ON COLUMN public.import_queue_archive.archived_at IS
'When the cleanup run moved the row into the archive: default now(), the transaction clock of the run, so every row of one run shares one value. Filled on every row (2026-10-07), 34 distinct values from 2026-02-10 10:21:16Z to 2026-04-02 03:00:00Z: 2026-02-10 129,755 rows (a run outside the 03:00 schedule), 31 daily runs in March 673,965 rows (388,584 on 2026-03-01, 89,227 on 03-07, 87,263 on 03-06), 2026-04-01 and 2026-04-02 27,017. Index idx_import_queue_archive_archived_at. This is the key of the 90-day purge in both cleanup functions: every row is older than that cutoff today. Unit: timestamptz. Source: column default. Grain: one archived queue row. Clock: ingest time of the move.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.import_queue_archive'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'import_queue_archive: every column has a comment';
  ELSE
    RAISE NOTICE 'import_queue_archive columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
