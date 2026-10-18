-- Describe field_evidence: all 15 columns (0 of 15 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07) and
-- a corrected table comment. Comments only. This is a different table from vehicle_field_evidence, described in
-- 20261008031000_describe_vehicle_field_evidence.sql.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 4,657,550 rows on 2026-10-07 16:38Z by exact count (the
-- atlas estimate of 4,405,857 is a stale pg_class.reltuples); rows arrive every minute (the newest created 16:38Z).
--
-- METHOD (read 2026-10-07 16:37-17:00Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in (none) and the 5 views
--   that read it from pg_depend. Size (930 MB heap, 1.9 GB in all) puts it far above the 200,000-row line, so shapes come
--   from a 0.1% block sample (TABLESAMPLE SYSTEM (0.1) REPEATABLE (20261007), 4,032 rows from about 119 pages). Exact,
--   read only: the row count and min and max of the clocks; counts by status, source_type and assigned_by and of the
--   sparse fills (one aggregate pass each, under the 10 s limit); the rows of a few source types through the source_type
--   index; and every row written since the server start, read through a TID range scan of the last heap pages
--   (ctid >= (111972,0); all rows created since 2026-09-29 09:20Z sit there, 171,477 at 16:45Z). An exact scan for
--   field names timed out, so field-name shares are from the sample. What anon and authenticated can read comes from
--   counts under SET LOCAL ROLE in read-only transactions (the sample, the Facebook seller-name rows and the spend rows).
--   "Filled" means non-NULL; jsonb arrays count non-empty.
--   Writers and readers from code at origin/main 1a9c80357 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps): the creating migration supabase/migrations/20251203_forensic_data_assignment_
--   system.sql (not in prod migration history); 20251203_data_truth_audit_system.sql; supabase/functions/_shared/
--   observationWriter.ts (writeFieldEvidence) and the edge functions that import it, among them extract-bat-core,
--   extract-cars-and-bids-core, extract-gooding, import-pcarmarket-listing and ingest (craigslistCapture.ts and the
--   Facebook path of index.ts); _shared/commentRefinery.ts and batch-comment-discovery (readers); the scripts
--   backfill-field-evidence.sh, backfill-fb-saved-observations.mjs, bridge-extractions-to-field-evidence.mjs,
--   bridge-manuals-to-field-evidence.mjs, enrich-fb-batch.mjs, enrich-fb-ollama.mjs and materialize-field-evidence.mjs;
--   the web hooks useFieldEvidence.ts and useFieldProvenance.ts (nuke_frontend/src/pages/vehicle-profile/hooks) and
--   ValueProvenancePopup.tsx; the iOS VehicleDetailView.swift. Bodies read with pg_get_functiondef: the 12 live functions
--   whose body names the table (auto_collect_field_evidence, ensure_field_evidence, backfill_evidence_for_vehicle,
--   assign_field_forensically, update_vehicle_field_forensically, build_field_consensus, correct_field_evidence,
--   validate_field_with_multiple_signals, get_field_provenance, get_vehicle_specs, compute_vehicle_grade,
--   enrichment_quality_report) and trigger_ars_on_evidence, with their EXECUTE grants; pg_trigger (trg_ars_on_evidence_insert
--   on this table, trg_auto_collect_field_evidence on vehicles); cron.job (no job names the table); write_receipts (no
--   rows); pg_stat_user_tables; pipeline_registry (1 row; none is added or changed here).
-- LIMITS:
--   The block sample is clustered by insert run (rows of one page come from one load), so shares taken from it are rough.
--   Who accepted the 93,972 auto_accept_65 and auto_accept_85 rows (2026-03-19) and wrote the 5,821 algorithm rows is
--   not recorded in the repo; ensure_field_evidence has no caller in the repo or in SQL, yet wrote 21 rows since
--   2026-09-29. Rows arrive while this is read, so counts read minutes apart differ by a few hundred. pg_stat_user_tables
--   counters began at the last server start (2026-09-29 09:20Z). The rows hold claimed vehicle values and some personal
--   and private values: quoted values are field names, platform codes, status and assignment codes, column and function
--   names and counts only; no proposed value, VIN, URL, vendor, person name, free-text source name, vehicle id or amount.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "All evidence collected for each field assignment - tracks provenance and confidence". It is one of
--   several evidence stores (vehicle_field_evidence and vehicle_observations hold others), and most of its accepted rows
--   are back-filled copies of vehicles columns, not collected evidence. The new comment keeps the idea (per-field claims
--   with provenance and confidence) and adds the grain, the writers, the liveness, the readers and the access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.field_evidence IS
'Per-field claims about vehicles: one row per proposed value of one field of one vehicle from one source type (UNIQUE vehicle_id, field_name, source_type, proposed_value; grain: one distinct claimed value), with a confidence, a status and, for live rows, the source URL. A repeated claim of the same value from the same source type does not add a row, so the table keeps distinct values, not every sighting. 4,657,550 rows on 2026-10-07 16:38Z (exact; the atlas estimate of 4,405,857 is a stale reltuples), 151 source types. By status (exact, 2026-10-07): accepted 3,206,638, pending 1,450,888, superseded 25, rejected 2; conflicted never occurs. Writers. (1) Live: the shared writer supabase/functions/_shared/observationWriter.ts (writeFieldEvidence, an upsert that ignores duplicates, status pending) for every vehicle observation of the extractors that import it: since the server start (2026-09-29 09:20Z) 164,563 rows, bat 159,211 (extract-bat-core), craigslist 2,452 (ingest), cars-and-bids 1,456, gooding 1,222, pcarmarket 222. (2) Live: the trigger trg_auto_collect_field_evidence (AFTER UPDATE on vehicles, auto_collect_field_evidence) inserts an accepted system_update row when vin, year, make, model, drivetrain, transmission, engine_type, series or trim changes to a non-NULL value: 172,965 rows since 2026-03-04, 6,893 since the server start. (3) ensure_field_evidence(uuid) (SECURITY DEFINER, EXECUTE for authenticated; no caller in the repo or in SQL) copies the fields of a vehicle that has fewer than 5 rows: 21 rows since the server start. (4) One-time loads, now idle: scripts/backfill-field-evidence.sh on 2026-03-24 07:51-08:37Z, field by field from vehicles columns as accepted, with the source type vehicles.source plus _listing (111 source types end in _listing, 2,939,759 rows, 63.1%; in the sample 2,583 of their 2,619 rows come from that run); ai_extraction (107,656 rows, 2026-03-19, then 93,972 of them accepted as auto_accept_65 or auto_accept_85 by a process not recorded) and ai_description_discovery (89,166 rows, 2026-03-24) from scripts/bridge-extractions-to-field-evidence.mjs; ai_title_extraction (8,081, 2026-03-23/24) from scripts/enrich-fb-batch.mjs and enrich-fb-ollama.mjs; factory_service_manual (4,051, 2026-03-24) from scripts/bridge-manuals-to-field-evidence.mjs; the Facebook path of the edge function ingest and scripts/backfill-fb-saved-observations.mjs (fb_marketplace_listing, 2,963 rows, 2026-03-19/20); 20251203_data_truth_audit_system.sql (the first rows, 2025-12-03). Changes after insert: build_field_consensus and scripts/materialize-field-evidence.mjs accept or reject or supersede pending rows, correct_field_evidence supersedes or rejects with a cited source, and hand corrections of 2026-06-23 superseded 25 rows; pg_stat_user_tables counts 0 updates since the server start, so no status has changed since 2026-09-29 and every live row stays pending. Liveness: 171,601 inserts, 0 updates and 0 deletes since the server last started (read 16:37Z; with no update or delete, its 138 dead tuples are inserts that did not commit); the newest row 2026-10-07 16:38Z. Every insert fires trg_ars_on_evidence_insert (AFTER INSERT, per row), which recomputes the auction_readiness row of the vehicle when one exists (recompute_ars_dimension). Readers: get_field_provenance and get_vehicle_specs (SECURITY DEFINER, EXECUTE for anon; the web vehicle profile through useFieldProvenance.ts and VehicleDescriptionCard.tsx, and the iOS VehicleDetailView.swift), validate_field_with_multiple_signals and build_field_consensus, compute_vehicle_grade, enrichment_quality_report, the web hook useFieldEvidence.ts and ValueProvenancePopup.tsx (direct reads with the public key), _shared/commentRefinery.ts and batch-comment-discovery (existing claims of a vehicle), the views forensic_evidence_dashboard and vehicle_field_source_map (SELECT for anon), data_truth_audit_report, forensic_live_dashboard and vehicles_needing_forensic_review, and many scripts. pipeline_registry holds one table-level row (2026-10-07: owner observationWriter, do_not_write_directly true). No write receipts, no cron job, no foreign key in. Access: RLS is on. Anyone can view evidence (SELECT, every role, USING true) lets anon read every row: all 4,032 rows of the 0.1% sample (2026-10-07), including 491 Facebook seller profile names (field_name seller_name, source type fb_marketplace_listing) and 129 private spend records of one vehicle whose field names carry the category, vendor and date (source types quickbooks, invoice, email_receipt), both counted exactly under SET LOCAL ROLE anon. Service role manages evidence (ALL, service_role). anon and authenticated hold SELECT, INSERT and UPDATE, but no policy admits their writes; ensure_field_evidence lets any signed-in account add derived rows for any vehicle. Clocks: created_at is the insert time; extracted_at equals it on all but 773 rows (ensure_field_evidence back-dates them to the vehicle or decode time); assigned_at is when a status was assigned after insert (94,001 rows). No column holds the time the source published the value; for live rows the observation in vehicle_observations carries it.';

-- ── Identity and claim ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_evidence.id IS
'Surrogate key of the claim, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 4,657,550 values (2026-10-07). No foreign key points at it; correct_field_evidence takes a list of these ids. Unit: none (uuid). Source: column default. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.vehicle_id IS
'Vehicle the claim is about: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), so deleting a vehicle deletes its claims. Indexed alone (idx_field_evidence_vehicle), with field_name (idx_field_evidence_field) and as the first column of the UNIQUE key. The 4,032 rows of the 0.1% block sample cover 2,855 vehicles (2026-10-07). Each insert fires trg_ars_on_evidence_insert for this vehicle. Readers fetch the claims of one vehicle by it. Unit: none (uuid). Source: the writer (the vehicle the extractor resolved, or NEW.id of the vehicles update). Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.field_name IS
'Field the claim is about, text NOT NULL, no CHECK, the second column of the UNIQUE key. Mostly a vehicles column name (make, model, year, vin, color, transmission, mileage, sale_price and so on), else a claim key of the writer (high_bid, mileage_claim, listing_location, discovery_url, import_metadata and others). 30 names in the 0.1% block sample, led by model 674, make 469, body_style 459, year 389, color 389, sale_price 299, transmission 290, mileage 226, engine_size 223 and vin 209 (2026-10-07); since the server start bat rows carry 14 names, led by high_bid. observationWriter writes every key the extractor passes, so names are not checked against a list. It also holds personal and private keys: seller_name on 491 rows (Facebook seller profile names, 2026-03-19/20) and 129 spend keys of one vehicle that name a category, a vendor and a date (2026-03-24), all readable by anon (see the table comment). Unit: none (text). Source: the writer. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.proposed_value IS
'Claimed value as text, text NOT NULL, the fourth column of the UNIQUE key, so another spelling of the same value is another row. observationWriter writes String(value).trim() and skips empty values; ensure_field_evidence skips 0. Up to 186 characters in the 0.1% block sample (2026-10-07). It holds VINs (74 of 4,032 sample rows are 17-character VINs), prices, high bids, mileages, and for the personal keys of field_name a person name or a spend amount; no value is quoted here. Unit: as the field (text; no unit column). Source: the writer, from the source page, the vehicles column or an AI extraction. Grain: one distinct claimed value. Clock: n/a.';

-- ── Source ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_evidence.source_type IS
'Code of the writer family that made the claim, text NOT NULL, no CHECK, the third column of the UNIQUE key, indexed (idx_field_evidence_source). 151 values (exact, 2026-10-07), led by bat 1,313,659, bat_listing 1,270,702, mecum_listing 703,465, cars_and_bids_listing 306,678, barrett-jackson_listing 264,834, system_update 172,965, ai_extraction 107,656, facebook_marketplace_listing 105,161, ai_description_discovery 89,166 and pcarmarket_listing 43,322. Live codes: the platform of observationWriter (bat, craigslist, cars-and-bids, gooding, pcarmarket since 2026-09-29), system_update (the vehicles trigger) and the codes of ensure_field_evidence (bat_listing, craigslist, vehicles.listing_source or vehicle_record). The 111 codes ending in _listing come mostly from scripts/backfill-field-evidence.sh, which wrote vehicles.source plus _listing, so some are free-text names (dealer names, document titles; not quoted here) rather than platform codes. One platform can appear under several codes (bat, bat_listing, bringatrailer_listing, auction_result_bat; cars-and-bids, cars_and_bids_listing, extract-cars-and-bids-core). It names the writer family, not the document: live rows carry the source URL in supporting_signals. Unit: none (text code). Source: the writer. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.source_confidence IS
'Writer-assigned confidence in the claim, 0 to 100, integer, nullable, CHECK 0 to 100; filled on every row (exact, 2026-10-07). Fixed per writer and source, not per value: observationWriter round(trustScore x 100) (bat 85, gooding 90, cars-and-bids 80, pcarmarket 80, craigslist 70 since 2026-09-29), the vehicles trigger 60, ensure_field_evidence 75 for vehicles columns and 100 for NHTSA decodes, the 2026-03-24 backfill 55 to 95 by field, the Facebook writers 20 to 55. validate_field_with_multiple_signals orders and sums claims by it, and build_field_consensus accepts a value at a consensus confidence of 80 or more; get_field_provenance returns it. Unit: points (0 to 100). Source: the writer. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.extraction_context IS
'How or where the claim was extracted, text, nullable. Filled on 1,482,367 rows (31.8%, exact, 2026-10-07). observationWriter writes the method and its version (html_match, html_parse, dom_parse or gatsby_json_parse via observation-writer:1.0.0); ensure_field_evidence writes Vehicle record: and the source code, or VIN decode: and the VIN; the AI writers write the sentence or phrase the value came from; the Facebook writers a fixed phrase per field. NULL on the 2026-03-24 backfill and the trigger rows. No text is quoted here. Unit: none (text). Source: the writer. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.supporting_signals IS
'Evidence for the claim, jsonb, nullable, default []. Non-empty on 1,343,418 rows (28.8%, exact, 2026-10-07), all from observationWriter: one element with the source url and the extraction method. Empty on every other row; no writer records agreement between sources here. Unit: none (jsonb array). Source: observationWriter. Grain: one distinct claimed value. Clock: n/a.';
COMMENT ON COLUMN public.field_evidence.contradicting_signals IS
'Evidence against the claim and its correction trail, jsonb, nullable, default []. Non-empty on 4 rows (exact, 2026-10-07), superseded auction_result_bat rows of 2025-12-03. correct_field_evidence appends one element (correction from and to status, the cited source, asserted_by, asserted_at) when it supersedes or rejects a claim; it has made no change since 2026-09-29 (0 updates). useFieldEvidence.ts reads it as the history of a dropped claim. Unit: none (jsonb array). Source: correct_field_evidence and the 2025-12-03 audit. Grain: one distinct claimed value. Clock: asserted_at inside each element.';
COMMENT ON COLUMN public.field_evidence.raw_extraction_data IS
'Raw payload of the extraction, jsonb, nullable. Filled on 8,341 rows (exact, 2026-10-07): ai_title_extraction 8,081 (the Facebook enrichment scripts), auction_comment_claim 198, scraped_listing 43 and 19 rows of hand-built document and plate sources; observationWriter and the trigger never write it (the raw page of a live row is in vehicle_observations). Unit: none (jsonb). Source: the script writers. Grain: one distinct claimed value. Clock: n/a.';

-- ── Status ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_evidence.status IS
'Review state of the claim, text, nullable, default pending, CHECK pending, accepted, rejected, conflicted or superseded; a partial index covers pending (idx_field_evidence_status). Exact (2026-10-07): accepted 3,206,638, pending 1,450,888, superseded 25, rejected 2, conflicted 0. Mostly the status the writer gave at insert: observationWriter and ensure_field_evidence write pending, the vehicles trigger, the 2026-03-24 backfill and the Facebook writers accepted. Later changes come from build_field_consensus (consensus_algorithm), scripts/materialize-field-evidence.mjs, correct_field_evidence and the hand corrections of 2026-06-23; none since 2026-09-29 (0 updates), so every live claim is still pending, and accepted means reviewed only where assigned_at is set. Readers count pending and accepted claims and skip the others (validate_field_with_multiple_signals, useFieldEvidence.ts). Unit: none (text code). Source: the writer, then the review functions. Grain: one distinct claimed value. Clock: as of assigned_at where set.';
COMMENT ON COLUMN public.field_evidence.assigned_at IS
'When a status was assigned after insert, timestamptz, nullable. Filled on 94,001 rows (exact, 2026-10-07): the auto-accept pass of 2026-03-19 04:59-05:00Z (93,972 rows) and the hand and consensus corrections of 2026-06-23 (29 rows). The vehicles trigger, the backfills and algorithm rows set assigned_by without it. Unit: timestamptz. Source: the process that changed the status. Grain: one distinct claimed value. Clock: derived (review time).';
COMMENT ON COLUMN public.field_evidence.assigned_by IS
'Process or tag that assigned the status, text, nullable. Filled on 274,021 rows (exact, 2026-10-07): system_trigger 172,962 (the vehicles trigger, at insert), auto_accept_65 73,365 and auto_accept_85 20,607 (2026-03-19, process not recorded), algorithm 5,821, backfill_audit 1,216 (20251203_data_truth_audit_system.sql), provenance_backfill_2026_03 21, consensus_algorithm 8 (build_field_consensus), and the 2026-06-23 hand corrections ls3_corpus_correction_20260623 12, hallucinated_spid_revert_20260623 7 and spid_extraction_20260623 2. scripts/materialize-field-evidence.mjs writes materialize-field-evidence (no row carries it). Unit: none (text code). Source: the assigning process. Grain: one distinct claimed value. Clock: as of assigned_at where set.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.field_evidence.extracted_at IS
'Meant as when the value was extracted; timestamptz, nullable, default now(). Equal to created_at on all but 773 rows (exact, 2026-10-07), because the writers leave the default; ensure_field_evidence back-dates its rows to vehicles.created_at, vin_decoded_data.decoded_at or vehicle_field_sources.created_at. Range 2025-09-08 .. 2026-10-07. It is not the time the source published the value. Unit: timestamptz. Source: column default (ensure_field_evidence: the vehicle or decode time). Grain: one distinct claimed value. Clock: ingest time (back-dated on 773 rows).';
COMMENT ON COLUMN public.field_evidence.created_at IS
'When the row was inserted, timestamptz, nullable, default now(), not indexed. 2025-12-03 16:01Z .. 2026-10-07 16:38Z (exact). In the 0.1% block sample 2,818 of 4,032 rows were created in 2026-03 (the one-time loads); 171,477 rows were created since the server start (2026-09-29 09:20Z, exact through the last heap pages, read 16:45Z). Unit: timestamptz. Source: column default (the inserting transaction). Grain: one distinct claimed value. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.field_evidence'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'field_evidence: every column has a comment';
  ELSE
    RAISE NOTICE 'field_evidence columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
