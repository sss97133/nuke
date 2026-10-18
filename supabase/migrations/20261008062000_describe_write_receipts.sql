-- Describe write_receipts: all 9 columns (0 of 9 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 1,529,188 rows on 2026-10-07 17:35Z by exact count (the
-- atlas estimate of 1,403,660 is a stale pg_class.reltuples); 88,481 rows arrived in the 24 hours to 17:34Z.
--
-- METHOD (read 2026-10-07 17:25-17:40Z UTC):
--   Columns, types, identity, defaults, constraints, indexes, triggers, policies, RLS, grants (has_table_privilege for
--   anon and authenticated, relacl) and the existing comment from pg_attribute, pg_attrdef, pg_constraint, pg_indexes,
--   pg_trigger, pg_policy, pg_class and pg_description; the views that read it (v_schema_atlas and v_write_pulse; v_residual
--   through the atlas) from pg_depend and pg_rewrite, with their owners, options and grants; the 41 triggers that call
--   record_write_receipt, with the RLS, grants and write policies of their 16 tables. Exact over the whole table (206 MB
--   heap, read only): the counts by tbl, op, writer, db_role, app_name and day; the fills; rows; the id and txid ranges.
--   What anon can read comes from a count under SET LOCAL ROLE anon in a read-only transaction. Completeness: the rows
--   that arrived in vehicle_observations (ingested_at) and auction_comments (created_at) in the 24 hours to 2026-10-07
--   17:00Z against the receipt rows of the same window, and the pg_stat_user_tables write counters of the gated tables since
--   the server start against their receipt rows. Coverage: the write counters of every public table since the server start
--   against the tables that carry the trigger or are named by a self-receipting function.
--   Writers and readers from code at origin/main ccec3f9a2 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the creating migration): the creating migration
--   supabase/migrations/20260721000000_write_receipts_observability.sql of commit 13d780885 (2026-07-21), which is only on
--   the branch feat/cohort-terminal and not on main (prod migration history holds 20260721031417 write_receipts_observability
--   and 20260721031536 write_receipts_header_channel); 20261002000100_observe_fresh_auction_comment_writes.sql;
--   20261004052152_observe_image_observation_writes.sql; 20261006090000_key_auction_comment_authors.sql (the comment UPDATE
--   trigger); 20261006053000_register_organization_stats_columns.sql (the undeclared organizations updates);
--   20260928200000_schema_atlas_and_job_health.sql; 20261006210524_v_residual_ranked_backlog.sql; the 8 edge functions that
--   send X-Nuke-Writer (ingest, ingest-observation, extract-bat-core, extract-auction-comments, extract-cars-and-bids-core,
--   extract-gooding, import-pcarmarket-listing, sync-live-auctions); scripts/check-image-observation-health.mjs; the 18
--   contracts in supabase/sql that build the table locally; docs/ledger/CRON_LEDGER.md. Bodies read with
--   pg_get_functiondef: record_write_receipt; the 9 functions that insert their own receipt (key_auction_event_identities,
--   key_vehicle_event_listing_ids, resolve_dangling_vehicle_events, grade_hammer_predictions_by_lot,
--   key_vehicle_location_county_from_zip, flag_fabricated_field_evidence, snapshot_stack_coverage,
--   fold_external_identity_location, create_organization_batch); the functions that set app.writer
--   (key_auction_comment_authors, key_auction_comment_lots, create_missing_bat_auction_events,
--   supersede_vehicle_event_episode, supersede_vehicle_event_episodes, mag_flag_caption_echoes and two guards that read it),
--   with their EXECUTE grants; cron.job (no job names the table; concierge-partner-sync, jobid 496); pg_stat_user_tables;
--   pipeline_registry (1 row; none is added or changed here).
-- LIMITS:
--   Why no receipt was written between 2026-08-07 07:02Z and 2026-09-24 18:15Z is not recorded: the ids (1,324,787 to
--   1,324,820) and transaction ids (196,938,859 to 196,940,212) barely move across it, so the database ran almost no
--   transactions in that window. Which writer sent the undeclared statements is not in the rows; the organizations updates
--   are attributed to the row trigger update_organization_stats by 20261006053000 and by their single-row shape. The
--   completeness check covers two gated tables over one day and three more through counters. The daily claude.ai routine
--   that reads the table is known from docs/ledger/CRON_LEDGER.md only. pg_stat_user_tables counters began at the last
--   server start (2026-09-29 09:20Z), and the reads of this session added about 20 sequential scans to them. Rows arrive
--   while this is read, so live counts move by about 30 a minute. The rows hold table names, operation codes, counts,
--   writer labels (function, script and agent names), role and client names and transaction ids; quoted values are those
--   codes and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Write-observability ledger (phase 1: observe). One row per DML statement on the gated entity tables.
--   Justification: 40+ raw write paths, zero visibility; owner directive 2026-07-20. Phase 2 = enforcement." The opening
--   stays. Corrected: a receipt is written only for a statement that changed at least one row; 9 SQL functions also insert
--   receipts for 8 tables without a trigger; the gated set grew from the 12 entity tables to 16 tables (the vehicle log
--   tables since 2026-10-02); phase 2, rejecting undeclared writes, was never built. Added: the writers, liveness,
--   completeness, the tables that leave no receipt, db_role, readers and access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.write_receipts IS
'Write-observability ledger (phase 1: observe): one row per data-changing statement that changed at least one row of a table carrying a receipt trigger, or per write a self-receipting SQL function reports (grain: one statement on one table). 1,529,188 rows on 2026-10-07 17:35Z (exact): UPDATE 1,319,258, INSERT 209,727, DELETE 203; 2026-07-21 03:14Z to now. Writers. (1) The trigger function record_write_receipt (SECURITY DEFINER, owner postgres; any error inside it is swallowed, so a failed receipt never blocks the write and is silent), fired by 41 AFTER triggers FOR EACH STATEMENT with transition tables (trg_write_receipt_ins, _upd and _del) on 16 tables: INSERT, UPDATE and DELETE on 12 entity tables since 2026-07-21 (organizations, properties, price_observations, villa_availability_observations, villa_calendar_crawls, concierge_products, publication_features, organization_brands, publication_pages, concierge_partner_connections, org_assets, mag_stories; creating migration 20260721000000_write_receipts_observability.sql of commit 13d780885, on a branch never merged to main); INSERT on auction_comments since 2026-10-02 (20261002000100) and UPDATE since 2026-10-06 (20261006090000); INSERT on vehicle_observations, observation_witnesses and vehicle_images since 2026-10-04 (20261004052152). 13 of the 16 tables have receipts; price_observations, villa_availability_observations and villa_calendar_crawls have none and no write counted since the server start. (2) Nine SQL functions insert their own receipt for a table without a trigger, the way record_write_receipt does: key_auction_event_identities (auction_events), key_vehicle_event_listing_ids and resolve_dangling_vehicle_events (vehicle_events, superseded_rows), grade_hammer_predictions_by_lot (hammer_predictions), key_vehicle_location_county_from_zip (vehicle_location_observations), flag_fabricated_field_evidence (vehicle_field_evidence), snapshot_stack_coverage (stack_coverage_snapshots), and, with no receipt yet, fold_external_identity_location (external_identities) and create_organization_batch (organizations); 4,289 rows, all 2026-10-06 22:04Z to 2026-10-07. Writers seen: 33 labels (see writer); undeclared on 1,306,408 rows (85.4%), 1,286,980 of them single-row organizations updates by the row trigger update_organization_stats; since 2026-10-07 00:11Z the only undeclared rows are concierge_partner_connections updates. Liveness: 88,481 rows in the 24 hours to 2026-10-07 17:34Z (ingest-observation, extract-bat-core, ingest, sync-live-auctions and the SQL keyers); pg_stat_user_tables counts 241,241 inserts, 0 updates and 0 deletes since the server last started (2026-09-29 09:20Z; read 17:35Z) against 241,212 rows written since then (the rest rolled back with their write). No row was written between 2026-08-07 07:02Z and 2026-09-24 18:15Z, when the database ran almost no transactions. Completeness: where a trigger is installed the receipts match the rows that arrived (vehicle_observations 75,350 and auction_comments 12,909 in the 24 hours to 2026-10-07 17:00Z; organizations, concierge_products and concierge_partner_connections against their pg_stat counters since the server start). Coverage: of the 103 public tables with writes counted since the server start (2026-10-07), 7 carry the trigger, 8 are named by a self-receipting function, whose receipts cover only its own statements, and 88 have no receipt path, among them vehicles, bat_user_profiles, vehicle_status_metadata, monitored_auctions, analysis_events, transfer_milestones, field_evidence, extraction_metadata, bat_quarantine and vehicle_live_metrics; the other writers of auction_events and vehicle_events leave none. create_missing_bat_auction_events and supersede_vehicle_event_episode set app.writer but write tables without a trigger, so they leave none. Readers: v_schema_atlas (writers_30d, undeclared_stmts_30d and last_write over 30 days; NULL for a table with no receipt) and through it v_residual (the owner tag); v_write_pulse (7 days by tbl, writer, db_role and op); scripts/check-image-observation-health.mjs (sensor rows for vehicle_observations, observation_witnesses and vehicle_images); 18 contracts in supabase/sql that build the table locally; a daily claude.ai routine, per docs/ledger/CRON_LEDGER.md. No cron job names it. pipeline_registry holds one table-level row (owner record_write_receipt, do_not_write_directly true). Access: RLS is on with no policy; anon and authenticated hold no privilege on the table; service_role holds SELECT, INSERT, UPDATE, DELETE and TRUNCATE, so append-only is a convention (0 updates and 0 deletes counted since the server start). Paths around it: the view v_write_pulse runs with the rights of its owner (postgres, no security_invoker) and grants SELECT to anon and authenticated, so both read its 7-day aggregates (39 rows covering 227,602 statements, counted under SET LOCAL ROLE anon, 2026-10-07 17:36Z); record_write_receipt is EXECUTE for anon and authenticated but runs only as a trigger, so a signed-in account adds receipts only by writing organizations or vehicle_images through their RLS policies, and then names any writer it likes in X-Nuke-Writer. Clocks: at is the start of the writing transaction (database clock), not the commit; there is no source or event clock.';

-- ── The receipt ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.write_receipts.id IS
'Surrogate key of the receipt, bigint NOT NULL, GENERATED ALWAYS AS IDENTITY (sequence write_receipts_id_seq), the PRIMARY KEY. 1 to 1,644,988 on 1,529,172 rows (2026-10-07 17:34Z): ids are not dense, because a receipt inserted in a transaction that rolls back keeps its consumed id (about 30 since the server start, pg_stat inserts minus rows); whether rows were also removed before 2026-09-29 is not recorded. It grows with insertion but does not order the rows by at, which is the transaction start. No foreign key points at it. Unit: none (bigint). Source: identity sequence. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.tbl IS
'Name of the table written, text NOT NULL, without schema (every table named is in public): TG_TABLE_NAME in record_write_receipt, a literal in the self-receipting functions. 20 values (2026-10-07 17:35Z): organizations 1,289,218 (UPDATE 1,289,208, INSERT 10), vehicle_observations 181,644, auction_comments 28,106 (INSERT 23,266, UPDATE 4,840), concierge_products 12,836, publication_pages 8,544, vehicle_images 4,043, auction_events 3,720, vehicle_events 258, concierge_partner_connections 217, superseded_rows 186, mag_stories 169, vehicle_field_evidence 87, observation_witnesses 72, org_assets 27, vehicle_location_observations 21, publication_features 18, hammer_predictions 16, organization_brands 4, properties 1, stack_coverage_snapshots 1. Seven of them (auction_events, vehicle_events, superseded_rows, vehicle_field_evidence, vehicle_location_observations, hammer_predictions, stack_coverage_snapshots) carry no trigger: their receipts cover only the function that wrote them, not the table. Indexed with at (idx_write_receipts_tbl). Unit: none (table name). Source: record_write_receipt or the self-receipting function. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.op IS
'Operation of the statement, text NOT NULL, no CHECK: INSERT, UPDATE or DELETE (TG_OP, or the literal the self-receipting function passes). Exact (2026-10-07 17:35Z): UPDATE 1,319,258, INSERT 209,727, DELETE 203. An INSERT with ON CONFLICT DO UPDATE fires both statement triggers, so on a table with both it can leave an INSERT and an UPDATE receipt; resolve_dangling_vehicle_events reports one retirement as a vehicle_events DELETE and a superseded_rows INSERT of the same count. TRUNCATE leaves no receipt. Unit: none (text code). Source: record_write_receipt or the self-receipting function. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.rows IS
'Number of rows the statement changed, integer NOT NULL: the size of the transition table (new_rows for INSERT and UPDATE, old_rows for DELETE) in record_write_receipt, or the count the self-receipting function reports. Never 0: no receipt is written for a statement that changed no row. 1 on 1,509,656 rows (98.7%), median 1, at most 26,942 (an auction_comments UPDATE by key-comment-authors, 2026-10-06); sum 9,874,909 (2026-10-07 17:34Z). An UPDATE counts every row it rewrote, whether or not a value changed. Unit: count of rows. Source: record_write_receipt or the self-receipting function. Grain: one receipt. Clock: n/a.';

-- ── Who wrote ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.write_receipts.writer IS
'Who declared the write, text NOT NULL: the setting app.writer of the transaction (set_config by a SQL writer), else the X-Nuke-Writer header of a PostgREST request (read from request.headers), else the constant undeclared. A declaration, not authentication: any caller can name any writer, and a statement run by a trigger carries the writer of the transaction that fired it. 33 values (2026-10-07 17:36Z): undeclared 1,306,408 (85.4%; 1,286,980 of them single-row organizations updates from the row trigger update_organization_stats on organization_vehicles, organization_images and business_timeline_events, 1,211,684 rows of all kinds before 2026-08-08), ingest-observation 189,426, extract-bat-core 16,758, key-auction-event-identities 3,720, key-comment-lots 3,688, vision-v2 2,784, ingest 2,148, image-class-v1 1,201, key-comment-authors 1,152, and 24 labels with fewer than 800 rows each (edge functions, SQL writers, scripts, agents and probes). The edge functions on main that send the header are ingest, ingest-observation, extract-bat-core, extract-auction-comments, extract-cars-and-bids-core, extract-gooding, import-pcarmarket-listing and sync-live-auctions. Since 2026-10-07 00:11Z the only undeclared rows are concierge_partner_connections updates by the edge function concierge-partner (cron job concierge-partner-sync, jobid 496, hourly at minute 23; its source is not on main). v_schema_atlas counts undeclared rows as undeclared_stmts_30d, and v_residual then tags the table owner. Unit: none (text label). Source: app.writer, the X-Nuke-Writer header or the constant undeclared. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.db_role IS
'Database role recorded with the write, text NOT NULL: current_user inside the writing function. record_write_receipt is SECURITY DEFINER, so current_user is its owner, postgres, not the caller; the self-receipting functions are SECURITY DEFINER too (create_organization_batch is SECURITY INVOKER and has written no receipt). postgres on all 1,529,172 rows (2026-10-07 17:34Z), so the column cannot tell a service-role write from a signed-in user write, though the creating migration meant the role of the caller. A grouping key of v_write_pulse. Unit: none (role name). Source: current_user in the writing function. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.app_name IS
'Client application of the writing session, text, nullable: current_setting(application_name). Filled on every row (2026-10-07 17:34Z): PostgREST 14.1 1,211,637 (all before 2026-08-08), PostgREST 14.5 307,597 (since 2026-09-24), Supavisor 9,802 (connections through the pooler: the SQL keyers and backfills such as key-comment-lots, key-comment-authors, key-auction-event-identities and resolve-dangling-vehicle-events), mgmt-api 136 (the Management API SQL endpoint). Edge functions write through PostgREST, so it names the gateway, not the function; no row comes from pg_cron. It is the only column that tells API writes from pooler and Management API writes. Unit: none (text). Source: the session setting application_name. Grain: one receipt. Clock: n/a.';
COMMENT ON COLUMN public.write_receipts.txid IS
'Transaction id of the write, bigint NOT NULL: txid_current() (epoch-extended), so every receipt of one transaction carries the same value. 185,505,270 to 202,036,360; 161,823 distinct values on 1,530,219 rows (2026-10-07 17:37Z), so many transactions leave several receipts: the 1,193,530 organizations updates of 2026-07-21 to 2026-08-07 share 11,882 transactions (about 100 each, one update per child row of a batch, as the row trigger update_organization_stats fires), while the 318,750 rows since 2026-09-24 span 134,930. Between the last receipt of 2026-08-07 and the first of 2026-09-24 it moves by about 1,350. Not indexed; no view, job or script reads it. Unit: none (transaction id). Source: txid_current(). Grain: one receipt. Clock: n/a.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.write_receipts.at IS
'When the write happened, as the start of the writing transaction: timestamptz NOT NULL, default now() (database clock). record_write_receipt leaves it to the default; fold_external_identity_location and create_organization_batch pass now(), the same value. In a long transaction it precedes the statement and the commit, so it is not a commit time. Indexed (idx_write_receipts_at, at DESC; idx_write_receipts_tbl, tbl and at DESC). 2026-07-21 03:14Z to now (2026-10-07): 1,211,684 rows 2026-07-21 to 2026-08-07 07:02Z, none until 2026-09-24 18:15Z, 318,535 since then (17:37Z). Readers window on it: v_schema_atlas 30 days (last_write is its maximum), v_write_pulse 7 days, scripts/check-image-observation-health.mjs from its since argument. Unit: timestamptz. Source: column default (now()). Grain: one receipt. Clock: write time (transaction start).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.write_receipts'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'write_receipts: every column has a comment';
  ELSE
    RAISE NOTICE 'write_receipts columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
