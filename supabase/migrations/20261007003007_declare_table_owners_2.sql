-- Owner gap, batch 2 of 2 (C28, data-machine-cases.md section 12): declare who writes the other 33 live tables.
--
-- WHY. public.v_residual tags a table "owner" when it is written (pg_stat counts inserts, updates or deletes since
-- the statistics reset) and has no pipeline_registry row, or when write_receipts holds a statement from an
-- undeclared writer in the last 30 days. On 2026-10-07 00:20Z it tagged 66 of 388 live tables. Batch 1
-- (declare_table_owners_1, the 33 largest by est_rows) declares half; this batch declares the 33 smaller ones: the
-- registries, logs, queues and caches. No table or column is minted; no testimony row is touched.
--
-- WHAT. One table-level row (column_name NULL) per table: owned_by is the writer that creates the rows (the live
-- maintainer for config tables whose rows were seeded long ago), write_via lists the others, do_not_write_directly is
-- true where every row should come through a function, trigger or edge writer (audit logs, derived state, trigger
-- queues) and false for config registries, caches and frontend-written logs. None of the 33 had a table-level row.
--
-- CONFLICT RULE. The unique key pipeline_registry_table_name_column_name_key is UNIQUE (table_name, column_name)
-- with NULLS DISTINCT (pg_index.indnullsnotdistinct = false, read live 2026-10-07) and no partial unique index, so
-- ON CONFLICT (table_name, column_name) never fires for column_name NULL. The insert is guarded by NOT EXISTS under a
-- SHARE ROW EXCLUSIVE lock, as in batch 1 and 20261006131500_create_missing_bat_auction_events.sql; a table-level row
-- another lane wrote first is left alone, and the NOTICE names it.
--
-- EVIDENCE per table (read-only, 2026-10-06 23:50Z to 2026-10-07 00:35Z, through scripts/data/q.sh): v_residual;
-- pg_stat_user_tables n_tup_ins / n_tup_upd / n_tup_del, quoted below as "since the stats reset"; non-internal
-- triggers (pg_trigger); every public function whose body writes the table (pg_proc.prosrc) and their callers
-- (triggers, cron.job commands, other functions, repo rpc calls); edge functions, scripts and frontend code on
-- origin/main that write it; write_receipts; newest created_at / updated_at per table and, where several writers were
-- possible, the source columns of the newest rows; the migrations that seeded config rows; the loaded launchd jobs
-- (read only). Counts move between reads.
--
-- STILL OPEN AFTER THIS BATCH (a declaration cannot close it):
--   organizations: 93,453 undeclared UPDATE statements in the 30 days to 2026-10-07 (organization counters through
--     trigger update_organization_stats, fired by organization_vehicles links that new vehicles create). PR #651 gave
--     four writers X-Nuke-Writer; since 2026-10-06 the undeclared ones move hour by hour with the undeclared
--     vehicle_images and vehicle_observations inserts of extract-gooding, which sends no writer header.
--   concierge_partner_connections: 59 undeclared UPDATEs 2026-09-24..10-06, all at minute 23 or 24, the slot of cron
--     concierge-partner-sync: the deployed edge function concierge-partner, whose source is in neither repo.
--
-- LIMITS. A declared owner is a declaration, not verified responsibility. "Since the stats reset" counts rows from
-- pg_stat_user_tables, which a statistics reset restarts. A writer named only from code (no receipt trigger on the
-- table) is a code reading, not runtime proof.
--
-- MEASURED BEFORE: v_residual owner gap = 66 (2026-10-07 00:20Z); 37 expected after batch 1. EXPECTED AFTER BOTH
-- BATCHES: 6 (31 of these 33 close; organizations and concierge_partner_connections stay open, as do batch 1's
-- vehicle_images, vehicle_observations, auction_comments and concierge_products). If this batch deploys first, the
-- count drops from 66 to 35.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE declare_table_owners_2 (
  table_name text PRIMARY KEY,
  owned_by text NOT NULL,
  description text NOT NULL,
  do_not_write_directly boolean NOT NULL,
  write_via text NOT NULL
) ON COMMIT DROP;

INSERT INTO declare_table_owners_2 (table_name, owned_by, description, do_not_write_directly, write_via) VALUES
('sentiment_update_queue', 'queue_sentiment_update',
 'Dedup queue for comment-sentiment recomputation: one row per vehicle with a priority. Filled only by trigger trg_queue_sentiment_update on vehicle_observations (AFTER INSERT); its upsert on vehicle_id accounts for the updates. Nothing drains it on a schedule.',
 true,
 'Trigger trg_queue_sentiment_update on vehicle_observations (queue_sentiment_update; upsert that raises priority to 10 for a vehicle in an active auction); update-live-sentiment drains it when called (no cron). 486 inserts and 33,786 updates since the stats reset.'),
('vehicle_views', 'VehicleProfileContext.tsx',
 'Vehicle page view log for discovery attribution: one row per view. Written by the frontend: the vehicle page inserts a row per view (nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx) and vehicleDiscoveryService.ts logs discovery views. ip_address is personal data.',
 false,
 'Frontend inserts from VehicleProfileContext.tsx and nuke_frontend/src/services/vehicleDiscoveryService.ts. No edge or SQL function writes it. 525 inserts since the stats reset.'),
('organizations', 'create-org-from-url',
 'The organization entity: one row per business or collection; 92 tables key to it. Rows are created by create-org-from-url (the capability map entry point, inserting through the businesses view) and by seed runs; no row created since 2026-07-25. Most updates come from trigger update_organization_stats (counter columns, column-level rows here), fired by organization_vehicles links.',
 true,
 'Create: create-org-from-url and onboard-source (through the businesses view), extract-gaa-classics, link-document-entities; seed scripts (scripts/stbarth/seed-publishers.mjs, scripts/load-perplexity-orgs.ts, scripts/create-forum-orgs.js); the 467 rows of July 2026 carry seed discovered_via values (access.sb, stbarth-corpus, stbarth-brand-targets and others). Update: trigger trg_update_org_stats_on_vehicle on organization_vehicles (update_organization_stats); classify-organization-type; SQL enrich_organization; extract-bat-core, ingest, sync-live-auctions, import-pcarmarket-listing (declared writers); lane-u-first-live-merge. Open: undeclared UPDATEs continue (93,453 in 30 days), since 2026-10-06 co-timed with extract-gooding, which sends no X-Nuke-Writer.'),
('wire_termination_specs', 'load_map_rows.py',
 'K5 wiring design records: one row per wire end (circuit, node, cavity) with terminal, seal and tool part numbers; superseded, never edited in place. Written by the wiring map loader docs/wiring/calc-data/load_map_rows.py (REST with the service key; design trust T3), earlier by scripts/populate-termination-specs.mjs.',
 true,
 'docs/wiring/calc-data/load_map_rows.py (inserts new rows, marks changed rows is_superseded); scripts/populate-termination-specs.mjs (older K5 backfill). The wiring map UI only reads. 54 updates since the stats reset (newest 2026-09-30).'),
('superseded_rows', 'supersede_vehicle_event_episode',
 'Rows retired from a live table by a sanctioned writer, never a raw DELETE: the full row as it was, its citation, reason and asserter; restore by re-inserting row_data. 3,483 of the 3,823 rows came from supersede_vehicle_event_episode runs on 2026-10-06 (asserted_by lane-v-episode-supersession and lane-v2-pcm-write-clock).',
 true,
 'supersede_vehicle_event_episode(p_event_id, p_corrections, p_source, p_reason), batched by supersede_vehicle_event_episodes (launchd ag.nuke.supersede-episodes); retire_rows(p_table, p_ids, p_source, p_reason, p_asserted_by), auction_comments only; correct_vehicle_event_link(p_rows, p_asserted_by) for vehicle_events links (2026-09-28). 3,483 inserts since the stats reset.'),
('reattribution_audit', 'reattribute_observation',
 'Immutable log of reattributions: one row per observation or image moved between vehicles, with old and new ids, reason and actor. Written by the reattribution and merge functions, never by hand.',
 true,
 'reattribute_observation; attribute_testimony (through attribute_image_session; scripts/ingest-mail-alerts.py first attributions on 2026-10-02); relink_testimony (iOS app, agent-chat, scripts/relink-misattributed.mjs); reassign_observation_subject; demote_observation_to_user; supersede_observation_relay; merge_vehicle_into_primary_by_url (20 lot-URL twin merges on 2026-10-06). 31 inserts since the stats reset.'),
('canonical_models', 'supabase/migrations',
 'Factory model vocabulary: one row per make and canonical model (and generation) with year range and aliases. Rows are added by migrations: 20251202_vehicle_nomenclature_standardization created it; 20261001140000_c26_condition_claims_notation added the 2 J80 rows on 2026-10-01.',
 false,
 'A migration file in supabase/migrations, applied by supabase-deploy CI; new vocabulary goes through schema_proposals per SCHEMA_LAW. 2 inserts since the stats reset.'),
('ddl_audit_log', 'ddl_audit_command_end',
 'DDL tripwire: one row per DDL command and per dropped object, written by the event triggers ddl_audit_command_end (ddl_command_end) and ddl_audit_sql_drop (sql_drop). Append-only.',
 true,
 'Event triggers ddl_audit_command_end and ddl_audit_sql_drop (migration 20260927170300_ddl_audit_tripwire). 1,763 inserts since the stats reset.'),
('app_events', 'nuke_frontend track.ts',
 'Launch-funnel analytics: one row per frontend event (name, props, session, path, referrer). Written by the frontend through anonymous insert (RLS insert-only) from nuke_frontend/src/lib/track.ts; cron app-events-retention deletes rows older than 90 days.',
 false,
 'nuke_frontend/src/lib/track.ts (anonymous insert); scripts/photo-sync-daemon.mjs logs its sync events; cron app-events-retention (daily 08:40 UTC) deletes. 1,592 inserts and 45 deletes since the stats reset.'),
('harness_endpoints', 'load_map_rows.py',
 'Wiring harness design endpoints: one row per plug, device, splice or stud of a harness design, with power draw, connector, zone and position; superseded, never edited in place. Written by the wiring map loader docs/wiring/calc-data/load_map_rows.py (REST with the service key).',
 true,
 'docs/wiring/calc-data/load_map_rows.py (inserts new nodes, marks changed nodes is_superseded and links superseded_by); migration 20260929230000_mask_order_number_in_harness_endpoints changed rows. The wiring map UI only reads. 9 inserts and 20 updates since the stats reset (newest 2026-09-30).'),
('listing_feeds', 'poll-listing-feeds',
 'RSS and Atom feed configurations for listing discovery, with poll state (last_polled_at, counts, errors). 719 of the 760 rows were added on 2026-02-06 (Craigslist city feeds); poll-listing-feeds (cron poll-listing-feeds, every 15 minutes) maintains the poll state.',
 false,
 'Rows: scripts/add-cl-cities.ts (upsert). Poll state: poll-listing-feeds (cron) and scripts/poll-feeds.ts (launchd com.nuke.poll-feeds, not loaded on 2026-10-06). 0 inserts and 25,370 updates since the stats reset.'),
('rate_limits', 'rate_limit_increment',
 'Fixed-window rate-limit counters for public edge functions: one row per caller, function and window. Written by rate_limit_increment, which _shared/rateLimit.ts calls.',
 false,
 'rate_limit_increment via _shared/rateLimit.ts; rate_limits_cleanup deletes expired rows (no caller found). 39 inserts and 25 updates since the stats reset.'),
('pii_audit_log', 'log_pii_access',
 'Audit log of access to personal data: one row per access (user, action, resource, reason). Written only by log_pii_access().',
 true,
 'log_pii_access(), called by the frontend secureDocumentService.ts and by cleanup_expired_documents. 4 inserts since the stats reset.'),
('wiring_decision_links', 'load_map_rows.py',
 'Design structure matrix for wiring decisions: one row per depends-on, blocks or coupled-with link between two decisions, or a decision and a harness endpoint. Written by the wiring map loader docs/wiring/calc-data/load_map_rows.py.',
 true,
 'docs/wiring/calc-data/load_map_rows.py (inserts links not yet present); migration 20260927030100_wiring_map_typed_rows created the table. The wiring map UI only reads. 7 inserts since the stats reset (newest 2026-09-30).'),
('concierge_partner_sync_runs', 'concierge-partner',
 'Log of concierge partner sync runs: one row per run of one partner connection, with items seen, landed and superseded and the error. Written by the deployed edge function concierge-partner on each sync; its source is in neither repo (nuke, lofficiel-concierge).',
 true,
 'concierge-partner, called by cron concierge-partner-sync at minute 23 (147 runs started at minute 23, 2026-07-20..10-06; earlier runs at minutes 0 and 30): insert at start, update at finish. 35 inserts and 35 updates since the stats reset.'),
('condition_taxonomy', 'supabase/migrations',
 'Condition descriptor vocabulary (adjectives, mechanisms, states) with taxonomy versions; vehicle_observations.descriptor_id keys to it. Rows are added by migrations and descriptor scripts; 20261001140000_c26_condition_claims_notation added 16 descriptors (c26_2026_10) on 2026-10-01.',
 false,
 'Migrations (20260314000001_condition_knowledge, 20261001140000_c26_condition_claims_notation); scripts/expand-condition-taxonomy.py, scripts/bulk-bridge.py and yono/condition_spectrometer.py wrote the earlier versions. New descriptors go through schema_proposals per SCHEMA_LAW. 16 inserts since the stats reset.'),
('observation_sources', 'supabase/migrations',
 'Registry of data sources (auction houses, marketplaces, forums, owner channels) with trust and agent tier; vehicle_observations.source_id keys to it. Rows are added by migrations (newest 20261005011137_register_ksl_email_observation_source).',
 false,
 'Migrations; evaluate_agent_tier (through record_agent_submission) updates the agent tier. 2 inserts and 1 update since the stats reset.'),
('market_index_values', 'record_bat_live_bids_snapshot',
 'Daily market index values (open, high, low, close, volume) per index. The live writer is record_bat_live_bids_snapshot(), run hourly by cron bat-live-bids-snapshot (minute 7), which upserts the BAT-LIVE-BIDS row of the day with an hourly snapshot.',
 true,
 'record_bat_live_bids_snapshot() (cron bat-live-bids-snapshot; ON CONFLICT (index_id, value_date) DO UPDATE); calculate-market-indexes (edge function the capability map lists as undeployed). 7 inserts and 175 updates since the stats reset.'),
('timeline_event_conflicts', 'detect_timeline_conflicts',
 'Conflicts between timeline events: one row per pair of events that disagree. Written only by trigger detect_timeline_conflicts_trigger on timeline_events (AFTER INSERT OR UPDATE).',
 true,
 'Trigger detect_timeline_conflicts_trigger on timeline_events (detect_timeline_conflicts). 11 inserts since the stats reset.'),
('pipeline_registry', 'supabase/migrations',
 'Canonical map of table and column to owning writer; table-level rows have column_name NULL. Rows are written by migrations applied by supabase-deploy CI. The unique key (table_name, column_name) treats NULLs as distinct, so a table-level row needs a NOT EXISTS guard, not ON CONFLICT.',
 true,
 'A migration file in supabase/migrations: column rows upsert with ON CONFLICT (table_name, column_name); table-level rows insert WHERE NOT EXISTS a row with the same table_name and column_name NULL. 36 inserts and 3 updates since the stats reset.'),
('source_registry', 'onboard-source',
 'Registry of vehicle data extraction sources (auctions, marketplaces, forums) with extractor and health fields. onboard-source creates and updates rows; sync-live-auctions updates health on each run.',
 false,
 'onboard-source (upsert at onboarding, later updates); sync-live-auctions (cron every 15 minutes, updates); migrations seeded the earlier rows (newest 20260208100000_source_registry_auction_houses). 0 inserts and 731 updates since the stats reset.'),
('admin_notifications', 'pipeline_heartbeat',
 'Admin inbox: verification requests and system alerts. The live writer is pipeline_heartbeat() (cron pipeline-heartbeat, every 6 hours), which inserts a system_alert when cron health has findings (9 alerts since 2026-09-01, newest 2026-10-06 12:00 UTC).',
 false,
 'pipeline_heartbeat (cron pipeline-heartbeat); triggers create_admin_notification_trigger on ownership_verifications (create_ownership_verification_notification) and trigger_escalate_bot_finding on bot_findings (escalate_bot_finding_to_admin); frontend adminNotificationService.ts (insert; approve and reject through admin_approve_ownership_verification and admin_reject_ownership_verification). 10 inserts since the stats reset.'),
('make_model_profiles', 'register_make_model_subject',
 'Registry of cohort subjects at year, model and range grain, keyed to canonical_models. register_make_model_subject adds a subject the first time the cohort terminal asks for it (through get_make_model_terminal); migrations added the K5 and range rows.',
 true,
 'register_make_model_subject via get_make_model_terminal (CohortTerminal page, iOS CohortTerminalView, universal-search); project_make_model_canonical (no caller found); migration 20261004010000_cohort_generations_allow_ranges_and_register_k5. 25 inserts and 6 updates since the stats reset.'),
('observation_properties', 'fn_schema_proposal_apply',
 'First-class property registry (AX-032): adding a property is a row, not DDL. The curator path adds rows: a schema_proposals row approved through schema_proposal_reviews applies through fn_schema_proposal_apply. Migrations have also added properties directly (3 on 2026-10-03 by 20261003001412_cached_image_property_keys).',
 true,
 'Approval of a schema_proposals row: a review row in schema_proposal_reviews fires trg_schema_proposal_review_after_insert (fn_schema_proposal_review_handler), which calls fn_schema_proposal_apply; migration files. 3 inserts since the stats reset.'),
('schema_proposals', 'mcp-connector',
 'Intake desk for schema growth (AX-032): anyone submits a proposal row; only curators approve, through schema_proposal_reviews. Submitters: mcp-connector (new image attributes), api-v1-events (unknown fields in rejected events), agents through migrations.',
 false,
 'Submit by insert (trigger trg_schema_proposal_evidence checks the evidence) from mcp-connector, api-v1-events or a migration (20261006213000_key_auction_event_identities wrote the 1 insert since the stats reset). Status moves only on review: fn_schema_proposal_review_handler and fn_schema_proposal_apply.'),
('live_auction_sources', 'bat_live_pull_run',
 'Registry of live auction platforms with sync configuration and capabilities, seeded by database/migrations/20260129_live_auction_sync_registry.sql. bat_live_pull_run() (cron bat-live-pull, every minute) keeps the BaT row state current.',
 false,
 'bat_live_pull_run() (cron bat-live-pull, which sets app.writer bat-live-pull); rows: migrations. 0 inserts and 9,349 updates since the stats reset.'),
('vehicle_completion_recompute_queue', 'drain_vehicle_completion_queue',
 'Work queue for vehicle completion_percentage recomputation: one row per dirty vehicle. Trigger trigger_update_completion on vehicles (AFTER INSERT OR UPDATE, update_vehicle_completion) enqueues; drain_vehicle_completion_queue, run by drain_vehicle_derived_queues (cron drain-vehicle-derived-queues, every 5 minutes), deletes processed rows.',
 true,
 'Enqueue: trigger trigger_update_completion on vehicles (upsert keeping the oldest queued_at). Drain: drain_vehicle_derived_queues() calling drain_vehicle_completion_queue(). 46,693 inserts, 211,849 updates and 192,720 deletes since the stats reset.'),
('source_census', 'scripts/assays/iphoto-census.py',
 'Point-in-time counts of the items at a data source. Current rows come from the Apple Photos census (census_method photos_db_read, source iphoto) run by launchd ag.nuke.iphoto-census; onboard-source writes a census when it onboards a source.',
 true,
 'scripts/assays/iphoto-census.py over REST (launchd ag.nuke.iphoto-census, daily; 5 rows 2026-10-03..10-06); onboard-source (insert at onboarding); SQL record_census (no caller found). 5 inserts since the stats reset.'),
('observation_extractors', 'derive-dispatch',
 'Registry of observation extractors per source: which edge function or config derives observations. Rows are added by migrations (20261003004722_comment_claim_source_links added 1 on 2026-10-03); derive-dispatch (cron derivation-queue-drain, every 10 minutes) routes by it and updates its run state.',
 false,
 'derive-dispatch (updates); migrations (rows). 1 insert and 12 updates since the stats reset.'),
('concierge_partner_connections', 'concierge-partner',
 'Concierge partner data connections: one row per organization channel endpoint with mandate, consent, access tier, sync schedule and last result; the credential is referenced by id. The deployed edge function concierge-partner updates sync results on each hourly sync; instagram-connect (deployed) also writes; neither source is in nuke or lofficiel-concierge.',
 true,
 'concierge-partner (cron concierge-partner-sync, minute 23; 59 UPDATE statements 2026-09-24..10-06 carried no writer name); instagram-connect (1 UPDATE on 2026-09-24 with its writer header); concierge_read_partner_secret touches updated_at when the credential is read. Rows created 2026-07-21. Open owner gap until concierge-partner sends X-Nuke-Writer.'),
('system_state', 'bat-url-discovery',
 'Key-value store for crawler state. The one live key is bat_url_discovery, upserted by bat-url-discovery (newest 2026-10-06); the other four keys (cab_url_discovery, bat_year_crawler, bat_archive_crawl, bat_wayback_crawl) were last written 2026-01-25..02-06.',
 false,
 'bat-url-discovery (upsert on key). 30 updates since the stats reset.'),
('profile_stats', 'handle_image_activity',
 'Per-user aggregate counts (vehicles, images, contributions, timeline events), one row per user, overwritten. Trigger image_activity_trigger on vehicle_images (AFTER INSERT, handle_image_activity) upserts image counts; frontend services also update rows.',
 false,
 'Trigger image_activity_trigger on vehicle_images (handle_image_activity, upsert); SQL recompute_profile_stats and vehicles_stats_aiud (no caller or trigger found); frontend eventPipeline.ts, imageTrackingService.ts, profileActivityService.ts. 45 updates since the stats reset.'),
('parent_company', 'quickbooks-connect',
 'Legal entity record of the parent company (1 row, created by migration 20260125100000_legal_entity_setup) holding the QuickBooks connection. quickbooks-connect writes the connection fields. Holds tax ids and OAuth credentials: private, never expose.',
 true,
 'quickbooks-connect (connect and refresh updates). 2 updates since the stats reset.');

-- Serialize with any other writer of pipeline_registry rows, so the NOT EXISTS check below cannot race.
LOCK TABLE public.pipeline_registry IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT b.table_name, NULL, b.owned_by, b.description, b.do_not_write_directly, b.write_via
FROM declare_table_owners_2 b
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_registry r
  WHERE r.table_name = b.table_name AND r.column_name IS NULL
);

-- Report: rows of this batch in place, rows another writer declared first (left alone), and any batch table still
-- without a table-level row.
DO $$
DECLARE
  v_batch int;
  v_ours int;
  v_kept text[];
  v_missing text[];
BEGIN
  SELECT count(*) INTO v_batch FROM declare_table_owners_2;

  SELECT count(*) INTO v_ours
  FROM declare_table_owners_2 b
  JOIN public.pipeline_registry r
    ON r.table_name = b.table_name AND r.column_name IS NULL AND r.description = b.description;

  SELECT array_agg(r.table_name || ' (' || r.owned_by || ')' ORDER BY r.table_name) INTO v_kept
  FROM public.pipeline_registry r
  JOIN declare_table_owners_2 b ON b.table_name = r.table_name
  WHERE r.column_name IS NULL AND r.description IS DISTINCT FROM b.description;

  SELECT array_agg(b.table_name ORDER BY b.table_name) INTO v_missing
  FROM declare_table_owners_2 b
  WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r
                    WHERE r.table_name = b.table_name AND r.column_name IS NULL);

  RAISE NOTICE 'declare_table_owners_2: % of % declared rows in place', v_ours, v_batch;
  IF v_kept IS NOT NULL THEN
    RAISE NOTICE 'declare_table_owners_2: table-level row written by another writer, left alone: %', v_kept;
  END IF;
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'declare_table_owners_2: batch tables still without a table-level row: %', v_missing;
  END IF;
END $$;

COMMIT;

-- Verify live after the deploy (read-only, scripts/data/q.sh):
--   select count(*) from public.v_residual where 'owner' = any(gaps);   -- 66 before; 6 expected after both batches
--   select table_name, owned_by, do_not_write_directly from public.pipeline_registry
--    where column_name is null and created_at > now() - interval '1 day' order by 1;
--   select table_name, gaps, writers_30d from public.v_residual where 'owner' = any(gaps) order by est_rows desc;
