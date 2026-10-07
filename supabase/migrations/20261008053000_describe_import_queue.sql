-- Describe import_queue: the 18 columns without a comment, the 7 that had one (each replaced, reasons below) and a
-- corrected table comment: 25 of 25 columns (7 of 25 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07).
-- Comments only. Its archive import_queue_archive is described in 20261007202000_describe_import_queue_archive.sql.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 288,468 rows on 2026-10-07 16:48Z by exact count (the
-- atlas estimate of 263,647 is a stale pg_class.reltuples); rows arrive every 15 minutes (the newest created 16:46Z).
--
-- METHOD (read 2026-10-07 16:48-17:15Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers (with tgenabled), policies (with their
--   role lists), RLS, grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute,
--   pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; the foreign key in
--   (vehicles.import_queue_id) from pg_constraint; the 6 views and 1 materialized view that read it from pg_depend, with
--   their options and anon grants. Above the 200,000-row line, but one aggregate pass over the 159 MB heap takes about a
--   second, so the counts by status, source, creation month, priority, failure_category, extractor_version and writer tag
--   and the fills and clock comparisons are exact over the whole table (read only); the raw_data keys and the vehicle
--   links against vehicles come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 2,512 rows), because
--   the exact anti-join exceeded the 10 s timeout. Source names from a join to scrape_sources. What anon can read comes
--   from a count under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 1a9c80357 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps): the queue functions 20251215000003_import_queue_schema_and_locking.sql,
--   20260927232500_release_stale_locks_back_on.sql, 20261006123000_enable_gooding_intake.sql and
--   20261006143000_reenable_gooding_drain_requeue.sql; 20261006073000_table_purpose_live_tables.sql (the former table
--   comment); the edge functions poll-listing-feeds (with captureLedger.ts), process-import-queue, bat-closed-lots-sync,
--   bat-url-discovery, extract-gooding, process-alert-email, extract-craigslist, continuous-queue-processor,
--   bat-queue-worker and extraction-watchdog; the scripts that touch the table. Bodies read with pg_get_functiondef: the 21
--   live functions whose body names the table, among them claim_import_queue_batch, claim_import_queue_batch_by_domain,
--   claim_import_queue_batch_by_source_id, release_stale_locks_fast, release_stale_locks, cleanup_import_queue (both),
--   and the trigger functions check_import_url, auto_set_import_queue_source, update_import_queue_updated_at and
--   trigger_process_import_queue_url, with their EXECUTE grants; cron.job and cron.job_run_details since 2026-09-29 (jobs
--   419, 503, 504, 457, 371 and 188 active; 146, 420, 451 and others inactive); write_receipts (no rows);
--   pg_stat_user_tables; pipeline_registry (5 rows; none is added or changed here); the deployed function list read
--   through the management API (328 functions, 2026-10-07).
-- LIMITS:
--   The vehicle links are checked on a 1% block sample. Rows do not record their writer: the writer of a row is read from
--   raw_data (ingested_via or source) and from the source; 957 rows tagged data-audit-2026-09-29 have no writer in the
--   repo. claim_import_queue_batch is read from its body, not called. Rows arrive while this is read, so counts read
--   minutes apart differ by a few rows. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z).
--   The rows hold public listing URLs and fields and queue state: quoted values are status, failure, writer and source
--   codes, platform names, column and function names and counts only; no URL, title, price, id or error text.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Work queue of listing URLs to extract ... Writers: discovery functions (bat-closed-lots-sync,
--   bat-url-discovery, bat-year-crawler, collecting-cars-discovery, extract-* discovery paths); claimed through
--   claim_import_queue_batch*; bat-queue-worker drains BaT rows. created_at = when queued (... 2026-03-21 .. 2026-10-06)".
--   Kept: work queue, one row per listing URL. Corrected: the largest live writer is poll-listing-feeds, whose rows are
--   ledger entries written already complete or skipped and never claimed; bat-queue-worker has no cron job; the drains
--   are process-import-queue jobs 504 and 457, for two sources only. Added: the liveness, the stuck rows, the readers and
--   the anonymous claim path.
--   status: it listed six values and said "Enforced by CHECK constraint". The CHECK is NOT VALID (new rows only) and also
--   allows pending_review and pending_strategy, which process-import-queue can write; failed is set after 5 or 8 attempts
--   by process-import-queue, not after max_attempts.
--   vehicle_id: it said "FK to vehicles.id" and "NULL = not yet processed". There is no foreign key, and 64,023 complete
--   rows have no vehicle_id.
--   attempts: it said "Incremented on each failure. When attempts >= max_attempts, status becomes failed." Every claim
--   adds 1 and process-import-queue adds 1 more on every outcome; 126 pending rows are at or over max_attempts.
--   locked_at and locked_by: they gave a 30-minute stale threshold and release_stale_locks(); the live release is
--   release_stale_locks_fast(5) every 5 minutes (cron job 188), a claim also takes a lock older than its TTL (900 s by
--   default), and locked_by is the worker id each caller passes (the cqp- format only on 55 leftover rows).
--   extractor_version: it said "Used to re-queue records when extractor is updated"; no code reads it and no live writer
--   sets it.
--   failure_category: it listed six values; three of them (not_found, network_error, validation_error) never occur and
--   nine others do.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.import_queue IS
'Work queue and ledger of listing URLs: one row per listing URL (UNIQUE listing_url; grain: one listing URL), with source, listing fields as discovered, status, priority, attempts, lock and error. Two kinds of rows share it: work items written pending and claimed by a drain, and ledger rows written already complete or skipped by poll-listing-feeds to remember what it has seen. 288,468 rows on 2026-10-07 16:48Z (exact): complete 208,642, skipped 73,843, failed 5,857, pending 126; processing, duplicate, pending_review and pending_strategy none. Created 2026-03-21 06:26Z .. 2026-10-07 16:46Z: by month 2026-03 174,308, 04 49,471, 05 31,473, 06 8,387, 07 4,135, 08 1,408, 09 12,041, 10 7,245. Finished rows older than 7 days went to import_queue_archive until 2026-04-02 (cleanup_import_queue; cron job daily-import-queue-cleanup, jobid 146, inactive), so the queue now keeps every row since 2026-03-21. Top sources by scrape_sources.name: Craigslist 76,785, Classic Driver 52,203, Bring a Trailer 34,875, ClassicCars.com 33,900, KSL Cars 22,261, Barrett-Jackson 18,237, Mecum 16,772, Gooding 9,561; no source on 10,446. Writers since the server start (2026-09-29 09:20Z), by the writer tag in raw_data (exact): poll-listing-feeds (cron job 419, every 15 minutes) 8,654 ledger rows (poll_firecrawl_html 8,529, rss_article_hop 125), bat-closed-lots-sync (cron job 503, daily) 1,505, a run tagged data-audit-2026-09-29 (writer not in the repo) 957, extract-gooding (cron job 371, discover_and_enqueue) 282, process-alert-email 77, bat-url-discovery 56; 11,531 rows in all. Insert triggers: validate_import_url (check_import_url) turns an invalid URL into a skipped row with failure_category filtered; trigger_auto_set_import_queue_source sets source_id from the URL when missing; auto_process_import_queue (would call continuous-queue-processor) is disabled. trg_update_import_queue_updated_at sets updated_at on every update. Drains: process-import-queue claims through claim_import_queue_batch for two sources only, BaT settlement (cron job bat-settlement-drain, 504, every 5 minutes) and Gooding Auctions (cron job 457, every 10 minutes); extract-gooding claims Gooding rows; bat-queue-worker and continuous-queue-processor are deployed but have no active job. release_stale_locks_fast(5) (cron job 188, every 5 minutes) returns processing rows locked over 5 minutes to pending. So the 126 pending rows, of other sources (Beverly Hills Car Club 77 from 2026-10-02, Bring a Trailer 25, a Hemmings feed 19, no source 5), all at 3 attempts or more, are claimed by no active job. Liveness: pg_stat_user_tables counts 11,541 inserts, 8,735 updates and 0 deletes since the server last started (read 16:48Z). Readers: the drains above, poll-listing-feeds (ledger lookup), extraction-watchdog, sonnet-supervisor, queue-status and other monitors; SQL get_import_queue_stats, get_queue_health, get_queue_status_counts, get_queue_stats_24h, get_extraction_health (SECURITY INVOKER; anon gets nothing), admin_pulse and get_pipeline_pulse (SECURITY DEFINER, EXECUTE for anon; aggregates); views import_queue_stats, queue_lock_health, sources_without_extractors, source_target_coverage, v_extraction_health (security_invoker), v_bat_settlement_probe (owner rights, SELECT for anon; daily counts) and the materialized view discovery_throughput (SELECT for anon; daily counts). vehicles.import_queue_id points at it (foreign key ON DELETE SET NULL; 102,404 vehicles, 2026-10-07). pipeline_registry holds 5 rows (2026-03: owner haiku-extraction-worker / agent-tier-router; their stale-lock and NULL texts repeat the corrected column comments). No write receipts. Access: RLS is on with one policy, import_queue_service_role (ALL, service_role); anon reads 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07); anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE but no policy admits them. Paths around RLS: claim_import_queue_batch and claim_import_queue_batch_by_domain are SECURITY DEFINER with EXECUTE for anon and authenticated, so an anonymous call claims up to 200 pending rows (status processing, attempts plus 1, a lock under any worker id) and returns them in full; claim_import_queue_batch_by_source_id runs with the rights of the caller and claims nothing for anon. Clocks: created_at is when the URL was queued (database clock); processed_at, last_attempt_at and next_attempt_at are writer clocks; locked_at is the claim time; updated_at the last update.';

-- ── Identity and source ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue.id IS
'Surrogate key of the queue row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 288,468 values (2026-10-07). vehicles.import_queue_id points at it (ON DELETE SET NULL; 102,404 vehicles); import_queue_archive keeps the ids of rows moved out. Unit: none (uuid). Source: column default. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.source_id IS
'Scrape source that discovered the URL: a scrape_sources.id, uuid, nullable, foreign key ON DELETE CASCADE (validated), indexed (idx_import_queue_source, idx_import_queue_source_status). Set by the writer, or by the BEFORE INSERT trigger trigger_auto_set_import_queue_source from the URL (lookup_source_from_url) when the writer leaves it NULL. Filled on 278,022 rows; NULL on 10,446 (3.6%, 2026-10-07). The active drains filter on it (BaT settlement and Gooding Auctions). Unit: none (uuid). Source: the writer or the trigger. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.listing_url IS
'URL of the listing to extract, text NOT NULL, UNIQUE (import_queue_listing_url_key), so a URL is queued once; writers upsert on it. Every value starts with http:// or https:// (2026-10-07); the BEFORE INSERT trigger validate_import_url (check_import_url, validate_import_url) marks an unwanted URL skipped instead of refusing it. poll-listing-feeds looks up seen URLs by it, and claim_import_queue_batch_by_domain matches it with LIKE. A URL can also sit in import_queue_archive from an earlier pass. Public listing URLs; none is quoted here. Unit: none (URL). Source: the writer. Grain: one listing URL. Clock: n/a.';

-- ── Listing fields as discovery saw them ───────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue.listing_title IS
'Listing title as the writer had it at discovery, free text, nullable. Filled on 247,868 rows (85.9%, 2026-10-07). Not updated by extraction. Unit: none (text). Source: the writer (feed item, search page or catalog). Grain: one listing URL. Clock: as of created_at.';
COMMENT ON COLUMN public.import_queue.listing_price IS
'Price as the writer had it at discovery, in whole currency units as scraped; the currency is not stored; bigint, nullable. Its meaning depends on the writer (asking price, current or final bid, estimate). Filled on 61,306 rows (21.3%, 2026-10-07): 171 are 0, median 7,900, 18 exceed 100,000,000, so placeholder values occur and a range filter is needed before use. Unit: currency units (currency not recorded). Source: the writer. Grain: one listing URL. Clock: as of created_at.';
COMMENT ON COLUMN public.import_queue.listing_year IS
'Model year as the writer had it at discovery (parsed from the title or taken from the source record), integer, nullable. Filled on 231,198 rows (80.1%); 35 outside 1885 .. 2027 (2026-10-07). The claim functions order by it after priority (newest year first). Unit: model year. Source: the writer. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.listing_make IS
'Make as the writer had it at discovery, free text with no key to a make table, nullable. Filled on 215,577 rows (74.7%), 3,707 distinct spellings (2026-10-07). Unit: none (text). Source: the writer. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.listing_model IS
'Model as the writer had it at discovery, free text with no key to a model table, nullable. Filled on 213,718 rows (74.1%), 43,431 distinct spellings (2026-10-07). Unit: none (text). Source: the writer. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.thumbnail_url IS
'URL of the listing thumbnail as the writer had it, text, nullable; the image is not stored here. Filled on 60,144 rows (20.8%, 2026-10-07). Unit: none (URL). Source: the writer. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.raw_data IS
'Writer payload, jsonb, nullable, default {}. Non-empty on 219,830 rows (76.2%), never NULL (2026-10-07). It names the writer where the row has one: ingested_via (poll_firecrawl_html, rss_article_hop, email_alert, bat_url_discovery) or source (bat-closed-lots-sync, data-audit-2026-09-29). Frequent keys in a 1% block sample of 2,512 rows: ingested_via, feed_id, feed_source, feed_published, ingested_at, feed_name, feed_location, source, cd_id, location; Craigslist ledger rows carry the post attributes and capture outcome (poll-listing-feeds captureLedger.ts), and v_bat_settlement_probe reads auction_end_date and listing_status from BaT settlement rows. Rows moved to import_queue_archive lost it (the batched cleanup writes NULL). Unit: none (jsonb). Source: the writer. Grain: one listing URL. Clock: n/a (ingested_at inside, where present).';

-- ── Queue state ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue.status IS
'Queue state of the row, text, nullable, default pending, indexed (idx_import_queue_status, with priority and with next_attempt_at). CHECK pending, processing, complete, failed, skipped, duplicate, pending_review or pending_strategy, NOT VALID (checked on new and updated rows only). Exact (2026-10-07): complete 208,642, skipped 73,843, failed 5,857, pending 126; processing, duplicate, pending_review and pending_strategy none. Meanings: pending waits for a claim; processing is claimed (a claim function sets it; release_stale_locks_fast returns it to pending after 5 minutes); complete was processed, or is a poll-listing-feeds ledger row written complete at insert (its ingest call created or matched a vehicle); skipped was bypassed (written so by poll-listing-feeds, or by the URL check at insert, or by a drain for a non-vehicle page); failed is set by process-import-queue after 5 attempts (8 for transient errors), not by max_attempts, or written at insert by poll-listing-feeds when its ingest call failed (89 rows since 2026-09-29); pending_review would be set by process-import-queue for a quality score under 0.3. Unit: none (text code). Source: the writer, the claim functions and the drains. Grain: one listing URL. Clock: as of updated_at.';
COMMENT ON COLUMN public.import_queue.priority IS
'Claim priority, integer, nullable, default 0: the claim functions take the highest first (COALESCE(priority, 0) DESC, then listing_year DESC, then created_at). Exact (2026-10-07): 3 on 98,139, 5 on 91,059, 0 on 62,220, 1 on 18,457, 2 on 15,791, 10 on 2,116, 70 on 342, 4 on 320, 50 on 24. Set by the writer. Unit: rank (higher is claimed sooner). Source: the writer. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.attempts IS
'Number of processing passes counted on the row, integer, nullable, default 0. Every claim (claim_import_queue_batch and its two variants) adds 1, and process-import-queue adds 1 more when it records the outcome, so one pass through process-import-queue counts 2; poll-listing-feeds adds 1 for each failed ingest of a ledger URL (a billing failure jumps to max_attempts). Above 0 on 60,949 rows, at most 9 (2026-10-07). The claim functions skip rows at or over their p_max_attempts argument (3 by default, 8 from process-import-queue, 5 by default for the by-source variant), not over max_attempts; process-import-queue sets failed at 5 (8 for transient errors). 126 pending rows are at 3 or more and no active job claims their sources. Unit: count of passes. Source: the claim functions and process-import-queue. Grain: one listing URL. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue.max_attempts IS
'Retry limit of the row, integer, nullable, default 3. 3 on all 288,468 rows (2026-10-07). poll-listing-feeds reads it for its failed ledger rows (no retry time once attempts reach it; poll-listing-feeds/ledger.ts) and scripts/specialty-builder-coordinator.sh compares attempts with it; the claim functions and process-import-queue use their own limits and do not read it. Unit: count of attempts. Source: column default. Grain: one listing URL. Clock: n/a.';
COMMENT ON COLUMN public.import_queue.error_message IS
'Reason text of the last failure or skip, free text, nullable. Filled on 39,748 rows (13.8%, 2026-10-07). Written by the URL check at insert (Auto-filtered: and the reason), by poll-listing-feeds and by the drains; process-import-queue clears it on success. No text is quoted here. Unit: none (text). Source: the writer or the drain. Grain: one listing URL. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue.failure_category IS
'Category of the last failure or skip, text, nullable, no CHECK, indexed (idx_import_queue_failure_category). Exact (2026-10-07): filtered 26,882 (the URL check at insert), extraction_failed 7,461, unknown 2,554, rate_limited 1,324, http_error 1,035, duplicate 307, bad_data 136, parse_error 96, billing 76, timeout 26, blocked 16, missing_fields 3; NULL on 248,552. process-import-queue treats timeout, rate_limited and blocked as transient (retry up to 8 attempts). The archive holds 24 categories. Unit: none (text code). Source: the URL check, poll-listing-feeds and the drains. Grain: one listing URL. Clock: as of last_attempt_at.';
COMMENT ON COLUMN public.import_queue.vehicle_id IS
'Vehicle the import created or matched: a vehicles.id, uuid, nullable, indexed (idx_import_queue_vid), with no foreign key. Filled on 145,552 rows (2026-10-07): 144,619 of the 208,642 complete rows (69.3%), 926 skipped and 7 failed rows; NULL on 64,023 complete rows, led by the drain-no-ai:1.0.0 pass of 2026-03 (at least 26,939, 24,306 of them Bring a Trailer), extract-craigslist-v1 (21,187), sitemap ingests (7,965) and Gooding rows (6,716), so complete does not mean a vehicle was linked. In a 1% block sample of 2,512 rows, 1,217 linked rows point at no missing vehicle and 8 at a deleted one. process-import-queue writes the id the extractor returns; merge_vehicle_into_primary_by_url repoints it when vehicles merge. The reverse link is vehicles.import_queue_id. Unit: none (uuid). Source: the drain or the writer. Grain: one listing URL. Clock: as of processed_at.';
COMMENT ON COLUMN public.import_queue.extractor_version IS
'Version tag of the process that finished the row, text, nullable. Filled on 153,858 rows (2026-10-07): drain-no-ai:1.0.0 127,976 (processed 2026-03-26 .. 2026-03-30), extract-craigslist-v1 21,188 (to 2026-07-01), bat 3,510 (2026-03-26), bonhams-typesense-v1 1,184 (to 2026-04-14). No live writer sets it and no code reads it to re-queue rows. Unit: none (text tag). Source: the 2026-03 .. 2026-07 drains and scripts. Grain: one listing URL. Clock: as of processed_at.';

-- ── Locks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue.locked_at IS
'When a worker claimed the row, timestamptz, nullable, indexed (idx_import_queue_locked_at). The claim functions set it to the claim time; a claim also takes a row whose lock is older than its TTL (p_lock_ttl_seconds, 900 by default); release_stale_locks_fast(5) (cron job 188, every 5 minutes) frees processing rows locked over 5 minutes, and release_stale_locks frees those over 30 minutes by default. process-import-queue clears it after a pass. Set on 2,556 rows, all complete or skipped and claimed 2026-03-30 .. 2026-04-01 (leftovers of an older worker); no row is processing (2026-10-07). Unit: timestamptz. Source: the claim functions. Grain: one listing URL. Clock: derived (claim time).';
COMMENT ON COLUMN public.import_queue.locked_by IS
'Worker id of the claim, text, nullable: the p_worker_id the caller passes to a claim function (process-import-queue sends process-import-queue: and its clock; unknown when none is passed). An anonymous caller of claim_import_queue_batch can set any value. Cleared with locked_at. Set on 55 rows, all leftovers of continuous-queue-processor (format cqp- and a timestamp and a random suffix) claimed 2026-03-30 (2026-10-07). Unit: none (text). Source: the claim caller. Grain: one listing URL. Clock: as of locked_at.';
COMMENT ON COLUMN public.import_queue.next_attempt_at IS
'Earliest time a pending row may be claimed again, timestamptz, nullable, indexed with status and created_at. process-import-queue sets a backoff after a failed pass (5 or 10 minutes times 2 to the power of attempts, at most 2 hours), and poll-listing-feeds sets one on a failed ledger row (hours for short-backoff categories, else 24 hours; none once attempts reach max_attempts); the claim functions skip rows whose time has not come. Filled on 10,661 rows, 10,583 of them already complete or skipped (left over); no pending row waits on it (2026-10-07). Unit: timestamptz. Source: process-import-queue and poll-listing-feeds (writer clocks). Grain: one listing URL. Clock: derived (scheduled retry).';
COMMENT ON COLUMN public.import_queue.last_attempt_at IS
'When the row was last attempted, timestamptz, nullable: the claim functions set it to the claim time, and poll-listing-feeds to its own clock on a failed ledger row. Filled on 61,117 rows (2026-10-07); the newest 2026-10-07 15:17Z. The 21,060 ledger rows that poll-listing-feeds wrote complete or skipped were never claimed and keep it NULL. Unit: timestamptz. Source: the claim functions and poll-listing-feeds. Grain: one listing URL. Clock: derived (attempt time).';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.import_queue.created_at IS
'When the URL was queued, timestamptz, nullable, default now() (database clock of the insert). 2026-03-21 06:26Z .. 2026-10-07 16:46Z (2026-10-07); see the table comment for the months. Rows queued before 2026-03-21 were archived to import_queue_archive or are gone. Unit: timestamptz. Source: column default. Grain: one listing URL. Clock: ingest time.';
COMMENT ON COLUMN public.import_queue.processed_at IS
'When the row was finished, timestamptz, nullable, set by the writer clock: process-import-queue on success, poll-listing-feeds when it writes a ledger row. Filled on 241,084 rows; 13,529 complete rows have none (2026-10-07). poll-listing-feeds sends its own clock in the same upsert that inserts the row, so on 21,112 rows it precedes created_at (median 20 ms, at most 16 s). The archive cleanup used COALESCE(processed_at, updated_at, created_at) to pick rows older than 7 days. Unit: timestamptz. Source: the writer clock. Grain: one listing URL. Clock: derived (completion time, writer clock).';
COMMENT ON COLUMN public.import_queue.updated_at IS
'When the row was last updated, timestamptz, nullable, no default: the trigger trg_update_import_queue_updated_at (BEFORE UPDATE, update_import_queue_updated_at) sets it to now() on every update, so it is NULL on the 47,736 rows never updated after insert (2026-10-07); the newest 2026-10-07 08:30Z. Unit: timestamptz. Source: trigger (now()). Grain: one listing URL. Clock: write time (last update).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.import_queue'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'import_queue: every column has a comment';
  ELSE
    RAISE NOTICE 'import_queue columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
