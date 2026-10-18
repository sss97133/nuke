-- Describe extraction_metadata: the 11 columns without a comment (1 of 12 had one, confidence_score, written by the
-- creating migration 20251202_extraction_provenance_system.sql and kept unchanged; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 1,672,512 rows on 2026-10-07 17:54Z by exact count (the
-- atlas estimate of 1,658,270 is a stale pg_class.reltuples); 9,525 rows arrived in the 24 hours to 17:52Z.
--
-- METHOD (read 2026-10-07 17:50-18:00Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege and relacl for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; the views that read it
--   (low_confidence_extractions, data_truth_audit_report) from pg_depend and pg_rewrite, with owners, options and grants.
--   Exact over the whole table (786 MB heap, read only; each pass under 10 s): the counts by field_name, extraction_method,
--   scraper_version, validation_status, confidence_score and created month; the fills; the clock ranges; the distinct
--   vehicles; the rows of the last day and week; the field_name by validation_status split. On a 1% sample (TABLESAMPLE
--   SYSTEM (1) REPEATABLE (20261007), 16,006 rows): the source hosts, the keys of raw_extraction_data and the skew between
--   extracted_at and created_at. What anon can read comes from counts under SET LOCAL ROLE anon in a read-only
--   transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 2d1d414da (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps): the creating migration 20251202_extraction_provenance_system.sql;
--   20261007002507_declare_table_owners_1.sql; extract-bat-core (index.ts, trySaveExtractionMetadata and the calls of the
--   shared layer, EXTRACTOR_VERSION 4.4.0); _shared/batUpsertWithProvenance.ts (the Tetris write layer) and its callers
--   _shared/observationWriter.ts, bat-snapshot-parser, bat-price-propagation, ingest/craigslistCapture.ts and
--   extract-vehicle-data-ai/vehicleWrite.ts; process-cl-queue; scripts/backfill-single-vehicle.js; the readers
--   nuke_frontend/src/hooks/useDealRead.ts, generate-vehicle-description, scripts/bat-corrections and
--   scripts/test-description-source-input.mjs. The column of the same name on vehicle_observations is a different thing and
--   is not described here. Bodies read with pg_get_functiondef: the 2 live functions whose body reads the table
--   (get_extraction_history, backfill_evidence_for_vehicle), with their EXECUTE grants; cron.job (no job names the table);
--   write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 row; none is added or changed here).
-- LIMITS:
--   That the Tetris confirmation receipt never lands is read from the code (it sends validation_status confirmed, which the
--   CHECK rejects, and does not check the insert error) and from the absence of such rows; the rejected inserts are not
--   logged anywhere read here. Source hosts, raw_extraction_data keys and the clock skew come from the 1% sample. Who wrote
--   the 2 rows of 2025-12-02 is not recorded. pg_stat_user_tables counters began at the last server start (2026-09-29
--   09:20Z), and the reads of this session added sequential scans to them after 17:50Z. The rows hold public listing text,
--   places, prices, VINs and platform handles of sellers and buyers: quoted values are field names, method and version
--   labels, status codes, host names and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Tracks provenance: WHEN, HOW, BY WHAT VERSION each field was extracted". The sentence stays. Added:
--   the grain and the dedupe rule, the writers, the confirmation status that never lands, liveness, readers, and the
--   policy that lets any API caller write the table.
--   Column confidence_score: unchanged (its scale stands; the default 0.5 is on no row, see the table comment).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.extraction_metadata IS
'Tracks provenance: WHEN, HOW, BY WHAT VERSION each field was extracted. One row per new or changed value of one field of one vehicle read from one source page (grain: one extracted field value): before each insert the writer looks up the latest row for the same vehicle_id, field_name and source_url and skips the insert when the value is the same. 1,672,512 rows on 2026-10-07 17:54Z (exact) for 231,800 vehicles; 99% of a 1% sample come from bringatrailer.com pages. Writers. (1) extract-bat-core, 78.5% of the rows, through its receipt helper trySaveExtractionMetadata (raw_listing_description, auction_mileage, auction_drivetrain, and VINs it rejects) and through the shared Tetris write layer _shared/batUpsertWithProvenance.ts, which writes a receipt for each vehicles field it is offered when it fills an empty field (unvalidated) or finds a different stored value (conflicting, with a bat_quarantine row). (2) The same layer called by _shared/observationWriter.ts (observation-writer:1.0.0, 201,963 rows since 2026-03-31; about 20 extractors call it), bat-snapshot-parser (batParser:1.0.0, 141,689 rows, 2026-03-15 to 2026-07-02) and bat-price-propagation (5,030 rows, 2026-03-15 to 04-12). (3) Older and one-off writers: extract-premium-auction and process-cl-queue (label v1, 2025-12 to 2026-02), a local BaT archive run (9 rows, 2026-09-27), scripts/backfill-single-vehicle.js and 4 single rows. No writer updates or deletes a row (0 updates and 0 deletes since the server start); a vehicle delete cascades to its rows. The Tetris confirmation receipt (an extracted value equal to the stored one) sends validation_status confirmed, which the CHECK rejects, so it never lands and a confirmed value leaves no trace. confidence_score is a constant per writer and field (0.20 to 0.95; 0.80 or more on 99.3% of rows; the default 0.5 on none), not a measured probability. Liveness: pg_stat_user_tables counts 146,926 inserts, 0 updates and 0 deletes since the server last started (2026-09-29 09:20Z; read 17:54Z); 9,525 rows in the 24 hours to 17:52Z, 58,513 in 7 days; no row was written in 2026-05, 2026-06 or 2026-08. Reads: 825,302 index scans and 2 sequential scans since the server start before this session read the table (17:50Z), most of them the lookup each writer makes before every insert attempt. Readers of the content: nuke_frontend/src/hooks/useDealRead.ts and the edge function generate-vehicle-description (raw_listing_description, provenance_snippet), get_extraction_history(uuid), backfill_evidence_for_vehicle(uuid), the views low_confidence_extractions and data_truth_audit_report, and scripts/bat-corrections. No trigger, cron job or write receipt. pipeline_registry holds one table-level row (owner extract-bat-core, do_not_write_directly true). Access: RLS is on, but the policy named Service role can manage extraction metadata is FOR ALL to every role with USING (true) and WITH CHECK (true), and anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, so any caller with the public API key can insert, change or delete any row; the creating migration 20251202_extraction_provenance_system.sql meant that policy for the service role, and scripts/test-description-source-input.mjs already treats the table as publicly writable. The policy Anyone can view extraction metadata lets anon read every row (1,672,511, counted under SET LOCAL ROLE anon, 2026-10-07), platform handles of sellers and buyers, listing write-ups, places and prices included. The view low_confidence_extractions (owner postgres, no security_invoker, SELECT for anon and authenticated) adds year, make and model for the 1,316 rows under 0.6 confidence; get_extraction_history(uuid) is EXECUTE for anon. Clocks: extracted_at is the extractor clock just before the insert; created_at is the database insert time; there is no clock of when the source published the value.';

-- ── The value and its target ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.extraction_metadata.id IS
'Surrogate key of the receipt, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 1,672,512 values (2026-10-07 17:54Z). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one extracted field value. Clock: n/a.';
COMMENT ON COLUMN public.extraction_metadata.vehicle_id IS
'Vehicle the value was extracted for: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed (idx_extraction_vehicle), so deleting a vehicle deletes its receipts. 231,800 distinct vehicles (2026-10-07). With field_name and source_url it is the key of the lookup that precedes every insert. Unit: none (uuid). Source: the extractor (the vehicle it is writing). Grain: one extracted field value. Clock: n/a.';
COMMENT ON COLUMN public.extraction_metadata.field_name IS
'Name of the field the value is for, text NOT NULL, no CHECK, indexed (idx_extraction_field). 54 values (2026-10-07 17:50Z); the largest are raw_listing_description 252,428, auction_mileage 221,886, transmission 163,124, high_bid 79,198, engine_size 68,212, reserve_status 58,192, bat_views 47,404, interior_color 44,333, color 43,931 and listing_location 43,370; 17 values have fewer than 1,000 rows. Mostly names of vehicles columns (the Tetris layer), plus names of extractor fields (bat_seller, bat_buyer, bat_lot_number, auction_mileage, auction_drivetrain, raw_listing_description, provenance_snippet). bat_seller (35,255 rows) and bat_buyer (27,770) hold platform handles of people. Unit: none (field name). Source: the extractor. Grain: one extracted field value. Clock: n/a.';
COMMENT ON COLUMN public.extraction_metadata.field_value IS
'The value as extracted, text, nullable, filled on every row (2026-10-07): writers trim it and skip empty values. A new row is written only when this value differs from the latest row for the same vehicle, field and source_url, so the table holds the value changes per source, not every read. It holds listing write-ups (raw_listing_description), platform handles (bat_seller, bat_buyer), places, VINs and prices from public listings; none is quoted here. Read by useDealRead.ts and generate-vehicle-description (raw_listing_description, provenance_snippet) and by get_extraction_history. Unit: none (text, in the units the source writes). Source: the extractor, from the page at source_url. Grain: one extracted field value. Clock: as of extracted_at.';
COMMENT ON COLUMN public.extraction_metadata.source_url IS
'Page the value was read from, text, nullable, filled on every row (2026-10-07). In a 1% sample (2026-10-07) 99.0% are bringatrailer.com listings; the rest are mecum.com, barrett-jackson.com, carsandbids.com and craigslist.org pages. Part of the lookup key (vehicle_id, field_name, source_url). Public listing URLs; none is quoted here. Unit: none (URL). Source: the extractor. Grain: one extracted field value. Clock: n/a.';

-- ── How it was read ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.extraction_metadata.extraction_method IS
'How the value was read, text NOT NULL, no CHECK, indexed (idx_extraction_method). 18 values (2026-10-07 17:50Z): html_match 613,209, extract-bat-core 478,304, regex 283,320, html_parse 143,437, table_parse 135,683, extract-premium-auction 5,838, craigslist_scraper 5,052, bat_listings_cross_validate 5,030, essentials_block 1,306, url_slug 673, dom_parse 596, ai_extraction 21, and 6 values with fewer than 10 rows each. extract-bat-core writes its own name on its direct receipts and essentials_block on a VIN it rejects; the Tetris layer passes the parsing method of the field (regex, table_parse, html_match, url_slug); observation-writer passes the method its caller names. The column therefore mixes parsing techniques and writer names. Unit: none (text code). Source: the extractor. Grain: one extracted field value. Clock: n/a.';
COMMENT ON COLUMN public.extraction_metadata.scraper_version IS
'Writer and version label, text, nullable; NULL on 2 rows (2025-12-02). By label family (2026-10-07 17:50Z): extract-bat-core 1,312,907 rows (78.5%: extract-bat-core:3.0.0 938,893 from 2026-02-02 to 2026-07-28; v4 96,573 from 2026-01-11 to 2026-02-02; extract-bat-core:4.0.0 to 4.4.0 277,441 since 2026-09-27, the current 4.4.0 since 2026-10-06); observation-writer:1.0.0 201,963 (_shared/observationWriter.ts, since 2026-03-31); batParser:1.0.0 141,689 (bat-snapshot-parser, 2026-03-15 to 2026-07-02); v1 10,891 (extract-premium-auction, process-cl-queue and 1 hand row, 2025-12 to 2026-02); bat-price-propagation:1.0.0 5,030; the label of a local BaT archive run on 9 rows and 1.0 on 1 row. The Tetris layer also writes the same label into the *_source column of a vehicles field it fills. Unit: none (text label). Source: the writer constant (EXTRACTOR_VERSION, WRITER_VERSION, BAT_PARSER_VERSION, PROPAGATION_VERSION). Grain: one extracted field value. Clock: n/a.';
COMMENT ON COLUMN public.extraction_metadata.validation_status IS
'Check state of the value, text, nullable, default unvalidated, CHECK unvalidated, valid, invalid, conflicting or low_confidence. Exact (2026-10-07 17:54Z): unvalidated 1,141,121 (68.2%), conflicting 297,456 (17.8%), valid 232,628, invalid 1,306, low_confidence 1. The writer sets it once and no process checks a row later (0 updates since the server start). unvalidated: a Tetris gap fill or a direct receipt such as raw_listing_description. conflicting: the Tetris layer found a different value already stored on the vehicle, kept the stored one and also wrote a bat_quarantine row (transmission 134,355, sale_status 22,646, model 18,251, interior_color 15,275, high_bid 15,222 and others). valid: only the extract-bat-core receipts of auction_mileage (221,886) and auction_drivetrain (10,741), marked so by the writer, not by a check. invalid: VINs extract-bat-core rejected from the essentials block. The Tetris confirmation path sends confirmed, which the CHECK rejects, so no confirmation receipt exists. Unit: none (text code). Source: the writer. Grain: one extracted field value. Clock: as of created_at.';
COMMENT ON COLUMN public.extraction_metadata.raw_extraction_data IS
'Writer context, jsonb, nullable; NULL on 2 rows (2025-12-02) and an object on the rest. In a 1% sample (16,006 rows, 2026-10-07): source_signal and tetris_version (the Tetris layer: the page block that gave the value, and tetris:1.0.0) on 72%; listing_url, extractor, mode and field (the direct receipts of extract-bat-core) on about 27%; the whole parsed listing (title, location, description, images, asking_price and more) on the process-cl-queue rows. Exact: 1,181,999 rows carry tetris_version (70.7%, 2026-10-07 17:54Z). It holds listing text and places; none is quoted here. Unit: none (jsonb). Source: the writer. Grain: one extracted field value. Clock: as of extracted_at.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.extraction_metadata.extracted_at IS
'When the extractor handled the value, timestamptz, nullable, default now(); filled on every row. Writers send their own clock (JavaScript toISOString, millisecond precision) just before the insert: in a 1% sample (2026-10-07) it precedes created_at by a median 23 ms and at most 15 s, and leads it by at most 55 ms (clock skew). It is the processing time, not when the source published the value. The pre-insert lookup and the readers order by it. 2025-12-02 to now. Unit: timestamptz. Source: the writer clock (the column default when absent). Grain: one extracted field value. Clock: ingest time (extractor clock).';
COMMENT ON COLUMN public.extraction_metadata.created_at IS
'When the row was inserted, timestamptz, nullable, default now() (database clock); filled on every row. 2025-12-02 19:26Z to now; by month (2026-10-07 17:51Z): 2025-12 4,703, 2026-01 70,938, 02 160,194, 03 719,518, 04 162,049, 07 209,405, 09 296,689, 10 49,012; none in 2026-05, 06 and 08. Not indexed. Unit: timestamptz. Source: column default. Grain: one extracted field value. Clock: ingest time (database clock).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.extraction_metadata'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'extraction_metadata: every column has a comment';
  ELSE
    RAISE NOTICE 'extraction_metadata columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
