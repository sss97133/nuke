-- Owner gap, batch 1 of 2 (C28, data-machine-cases.md section 12): declare who writes 33 live tables.
--
-- WHY. public.v_residual tags a table "owner" when it is written (pg_stat counts inserts, updates or deletes since
-- the statistics reset) and has no pipeline_registry row, or when write_receipts holds a statement from an
-- undeclared writer in the last 30 days. On 2026-10-07 00:20Z it tagged 66 of 388 live tables. The repair is
-- cartography: find who writes each table and say so in the registry (data-machine.md: "one owner per computed
-- field (pipeline_registry)"; "not abandoning a fold: an owner in pipeline_registry ..."). This batch is the 33
-- largest of the 66 by est_rows; batch 2 (declare_table_owners_2) holds the other 33. No table or column is minted;
-- no testimony row is touched.
--
-- WHAT. One table-level row (column_name NULL) per table: owned_by is the writer that creates the rows (the
-- dominant one when several do), write_via lists the others, do_not_write_directly is true where every row should
-- come through a function, trigger or edge writer (testimony, logs, derived state) and false for config, cache and
-- UI-written tables. vehicle_observations is in this batch but already has a table-level row (ingest-observation),
-- left as it is; its open gap is an undeclared writer (below).
--
-- CONFLICT RULE. The unique key pipeline_registry_table_name_column_name_key is UNIQUE (table_name, column_name)
-- with NULLS DISTINCT (pg_index.indnullsnotdistinct = false, read live 2026-10-07), and there is no partial unique
-- index on table-level rows. ON CONFLICT (table_name, column_name) therefore never fires for column_name NULL and
-- would add a second table-level row. As in 20261006131500_create_missing_bat_auction_events.sql, the insert is
-- guarded by NOT EXISTS instead, under a SHARE ROW EXCLUSIVE lock so a concurrent registry writer waits rather than
-- racing the check. A table-level row another lane wrote first is left alone, and the NOTICE names it.
--
-- EVIDENCE per table (read-only, 2026-10-06 23:50Z to 2026-10-07 00:25Z, through scripts/data/q.sh): v_residual
-- (activity, est_rows, writers_30d, crons_mentioning); pg_stat_user_tables n_tup_ins / n_tup_upd / n_tup_del, quoted
-- below as "since the stats reset"; non-internal triggers and their functions (pg_trigger); every public function
-- whose body inserts, updates or deletes the table (pg_proc.prosrc, 1,764 functions scanned locally) and their callers
-- (triggers, cron.job commands, other functions, repo rpc calls); edge functions and scripts on origin/main that
-- write it (supabase-js .from(...).insert/upsert/update/delete chains, REST paths, SQL strings); write_receipts
-- grouped by writer; tablesamples of recent rows grouped by their source column where the writer was ambiguous; the
-- loaded launchd jobs (~/Library/LaunchAgents, read only). Counts move between reads.
--
-- STILL OPEN AFTER THIS BATCH (a declaration cannot close it). Three tables of this batch carry undeclared write
-- receipts inside the 30-day window, so v_residual keeps their owner tag until those age out and no new one lands:
--   vehicle_images: 1,507 undeclared INSERT statements (26,469 rows) 2026-10-04..10-07. Matched by window to
--     source: craigslist rows before 2026-10-06 (ingest, which sends X-Nuke-Writer since PR #651) and gooding rows
--     since (847 of 847 undeclared rows in 15:00-15:20Z on 10-06): extract-gooding sends no X-Nuke-Writer.
--   vehicle_observations: 278 undeclared INSERTs; the 20 in 15:00-15:20Z on 10-06 are all gooding sale_result and
--     listing rows (extract-gooding through observationWriter); 1 on 2026-10-06 06:40Z through the Management API
--     (application_name mgmt-api), a merged listing observation from a vehicle merge run by hand.
--   auction_comments: 541 undeclared INSERTs, 2026-10-02..10-05, extract-auction-comments before PR #651; none since.
--   concierge_products: 29 INSERT and 3,578 UPDATE statements, 2026-09-24..10-02, all at minutes 23 to 25, the slot
--     of cron concierge-partner-sync: the deployed edge function concierge-partner, whose source is in neither repo.
-- The fix for extract-gooding is the one-line header PR #651 gave four other writers; it is not in this migration.
--
-- LIMITS. A declared owner is a declaration, not verified responsibility. "Since the stats reset" counts rows, not
-- statements, from pg_stat_user_tables, which a statistics reset restarts. Sample shares come from TABLESAMPLE and
-- are approximate. A writer named only from code (no receipt trigger on the table) is a code reading, not runtime
-- proof. vehicle_quality_scores has no writer in the repo or in prod: it is declared as unknown, not guessed.
--
-- MEASURED BEFORE: v_residual owner gap = 66 (2026-10-07 00:20Z). EXPECTED AFTER THIS BATCH: 37 (29 of the 33 close;
-- vehicle_images, vehicle_observations, auction_comments and concierge_products stay open, see above).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE declare_table_owners_1 (
  table_name text PRIMARY KEY,
  owned_by text NOT NULL,
  description text NOT NULL,
  do_not_write_directly boolean NOT NULL,
  write_via text NOT NULL
) ON COMMIT DROP;

INSERT INTO declare_table_owners_1 (table_name, owned_by, description, do_not_write_directly, write_via) VALUES
('vehicle_images', 'extract-bat-core',
 'Image testimony: one row per image file reference attached to, or awaiting attribution to, a vehicle. Rows are created by the writer of the image source: the listing extractor for listing photos (extract-bat-core created 74% of the 121,101 rows counted by write_receipts 2026-10-04..10-07), image-intake and the capture apps for user photos. Never hand-written; analysis columns have their own column-level owners in this registry.',
 true,
 'Listing photos, at read time: extract-bat-core (BaT); ingest (Craigslist and other URL ingests); extract-gooding, extract-broad-arrow, extract-bonhams, extract-barrett-jackson, import-pcarmarket-listing and the other extract-* functions process-import-queue routes. User photos: image-intake; the Mac photo sync (scripts/photo-sync-daemon.mjs through ingest_image_identity_first); the iOS capture app (apps/nuke-capture-ios). Updates: photo-pipeline-orchestrator, check-image-vehicle-match, derive_vehicle_image_attribution_batch (cron derive-vehicle-image-attribution), reset_stuck_photo_pipeline_images (cron photo-pipeline-reset-stuck), the vehicle merge functions. Open: extract-gooding inserts without X-Nuke-Writer (undeclared receipts through 2026-10-07).'),
('auction_comments', 'extract-bat-core',
 'The auction log: one row per comment or bid posted on a lot. Append-only by writer contract (upserts ignore duplicates on vehicle_id, content_hash). extract-bat-core created 66% of the 49,841 rows counted by write_receipts in the 30 days to 2026-10-07; the BaT live-frame path and the other comment extractors land the rest. Testimony: never hand-written; a wrong row is retired through retire_rows into superseded_rows.',
 true,
 'BaT lot pages: extract-bat-core (upsert on vehicle_id, content_hash). BaT live frames: ingest-observation (batLive.ts) through ingest_bat_live_events. extract-auction-comments (fired by sync-live-auctions) and extract-cars-and-bids-comments. Key columns: key_auction_comment_authors and key_auction_comment_lots (column-level rows). Analysis columns: analyze-comments-fast, batch-comment-discovery. Vehicle merges: merge_into_primary, merge_vehicle_into_primary_by_url, unmerge_vehicle. The 541 undeclared INSERT statements of 2026-10-02..10-05 were extract-auction-comments before it sent X-Nuke-Writer (PR #651).'),
('field_evidence', 'observationWriter',
 'Per-field claims: one row per proposed value of one vehicle field from one source type (unique vehicle_id, field_name, source_type, proposed_value), status pending until consensus. 99% of a 1% sample of the rows created in the 30 days to 2026-10-07 have the shape _shared/observationWriter.ts writes (source_type bat or cars-and-bids, no assigned_by); the rest come from trigger trg_auto_collect_field_evidence on vehicles (source_type system_update). Evidence: never hand-written.',
 true,
 '_shared/observationWriter.ts upsert ignoring duplicates, used by extract-bat-core, ingest, extract-cars-and-bids-core, extract-gooding and the other extractors that import it; ingest/index.ts spec rows; AFTER UPDATE trigger trg_auto_collect_field_evidence on vehicles (auto_collect_field_evidence; fields vin, year, make, model, drivetrain, transmission, engine_type, series, trim); SQL assign_field_forensically, backfill_evidence_for_vehicle, ensure_field_evidence; status by build_field_consensus and correct_field_evidence. 166,990 inserts since the stats reset.'),
('bat_bids', 'extract-bat-core',
 'Bids on BaT lots copied from the auction log: one row per bid (unique bat_listing_id, bat_username, bid_amount, bid_timestamp). A derived copy of bid comments in auction_comments, written only when the lot already has a bat_listings row; one of the bid stores awaiting the owner consolidation ruling (data-machine-cases.md section 12).',
 true,
 'extract-bat-core and extract-auction-comments upsert the bid-type comment rows of a lot on the unique key when the lot has a bat_listings row; SQL backfill_bat_bids_from_comments (no caller found); merge_vehicle_into_primary_by_url repoints rows on vehicle merges. 43,044 inserts and 10,183 updates since the stats reset.'),
('field_extraction_log', 'extractionHealth',
 'Field-level extraction outcome log: one row per field an extractor attempted on one source, with status, value, expected value and confidence, for drift detection. Rows come from the shared extraction-health collector; cron retention-field-extraction-log deletes rows older than 90 days, 1,000 per run.',
 true,
 '_shared/extractionHealth.ts batch insert (collector and logExtractionResults), used by extract-vehicle-data-ai, scrape-vehicle and extract-ebay-motors; identify-vehicle-from-image inserts directly. Cron retention-field-extraction-log (daily 03:30 UTC) deletes. 4,486 inserts and 7,000 deletes since the stats reset.'),
('transfer_milestones', 'transfer-automator',
 'Ordered progress steps of an ownership transfer (about 18 per transfer). Seeded with the transfer by transfer-automator, an edge function deployed but no longer in the repo (removed in 9871ee4fb), which trigger trg_auto_create_transfer_on_auction_close on auction_events calls when a lot first becomes sold.',
 true,
 'transfer-automator (action seed_from_auction, called through net.http_post by auto_create_transfer_on_auction_close unless app.seed_transfers is off); status: transfer-advance (deployed only per the capability map), transfer_staleness_sweep (cron transfer-staleness-sweep, inactive), auto_complete_transfer_obligation (no caller found); trigger trg_transfer_milestone_completed copies completion to ownership_transfers. 192,492 inserts and 10,676 updates since the stats reset.'),
('extraction_metadata', 'extract-bat-core',
 'Field extraction receipts: one row per field value an extractor read from a source URL, with method, scraper version and confidence. extract-bat-core writes most rows, through its own receipt helper and the shared batUpsertWithProvenance layer; a receipt is skipped when the last value for the same field and URL is unchanged.',
 true,
 'extract-bat-core; _shared/batUpsertWithProvenance.ts (the Tetris write layer, also used by ingest/craigslistCapture.ts, extract-vehicle-data-ai, bat-price-propagation, bat-snapshot-parser and observationWriter); process-cl-queue; scripts/backfill-single-vehicle.js. 142,905 inserts since the stats reset.'),
('analysis_events', 'scripts/deep-image-analysis-byok.mjs',
 'Image analysis pipeline event log: one row per stage transition of one image (stages analyzing, verdict_landed, tag_sync_batch, attribution_proposal), read by the pipeline visualizer through get_pipeline_events. Most rows are analyzing events from the BYOK image analysis batches.',
 true,
 'scripts/deep-image-analysis-byok.mjs (analyzing, verdict_landed; run by scripts/daily-receipt/byok-fleet-batch.sh under launchd com.nuke.byok-image-analysis, not loaded on 2026-10-06; newest analyzing row 2026-10-03 in a 1% sample); SQL sync_local_vision_tags from the iOS app (LocalTagPush.swift; tag_sync_batch, newest 2026-10-06); scripts/orphan-attribution-proposals.mjs (attribution_proposal). 344,560 inserts since the stats reset.'),
('write_receipts', 'record_write_receipt',
 'Write-observability ledger: one row per DML statement on a table carrying the trg_write_receipt_* statement triggers, naming the writer from setting app.writer or the X-Nuke-Writer request header, or undeclared when neither is set. Source of v_schema_atlas.writers_30d and of the owner gap in v_residual. db_role is always postgres because the trigger function is SECURITY DEFINER; application_name tells PostgREST from pooler and Management API writes.',
 true,
 'AFTER STATEMENT triggers trg_write_receipt_ins, _upd and _del (record_write_receipt) on auction_comments, concierge_partner_connections, concierge_products, mag_stories, observation_witnesses, org_assets, organization_brands, organizations, price_observations, properties, publication_features, publication_pages, vehicle_images, vehicle_observations, villa_availability_observations and villa_calendar_crawls; key_auction_event_identities records its own auction_events receipts. A writer declares itself with set_config(app.writer) or the X-Nuke-Writer header. 207,616 inserts since the stats reset.'),
('timeline_events', 'extract-bat-core',
 'Vehicle history events: one row per dated event (listing, sale, bid, mileage reading, photo day, work, communication). extract-bat-core writes almost all current rows: 99% of a 3% sample of the rows created in the 30 days to 2026-10-07 carry data_source extract-bat-core (auction_listed, mileage_reading, auction_sold, auction_reserve_not_met, auction_ended).',
 true,
 'extract-bat-core; other extractors (extract-hagerty-listing, extract-rmsothebys, process-cl-queue); create-work-session-from-evidence (photo pending_analysis events); score-live-auctions through create_auction_timeline_event; triggers auto_group_photos_into_events on vehicle_images, apply_auction_listing_outcome_to_vehicle_timeline on vehicle_listings, create_timeline_event_from_work_session on work_sessions; vehicle merge functions (profile_merged); frontend event forms. 43,566 inserts since the stats reset.'),
('vehicle_status_metadata', 'trigger_update_vehicle_status',
 'Per-vehicle completeness and activity state: one row per vehicle, overwritten. Written only by trigger update_vehicle_status_trigger (AFTER INSERT OR UPDATE on vehicles), whose function trigger_update_vehicle_status calls calculate_vehicle_data_completeness and upserts last_activity_at.',
 true,
 'Trigger update_vehicle_status_trigger on vehicles: trigger_update_vehicle_status() and calculate_vehicle_data_completeness(vehicle_id). scripts/cleanup-non-vehicles.ts and scripts/deep-data-cleanup.ts delete rows of removed vehicles. 18,019 inserts and 799,945 updates since the stats reset.'),
('projection_outcomes', 'compute-vehicle-valuation',
 'Valuation projection log for the accuracy feedback loop: one row per projection compute-vehicle-valuation logs after its nuke_estimates upsert.',
 true,
 'compute-vehicle-valuation (insert after the nuke_estimates upsert). No other writer in the repo or in prod functions. 5 inserts since the stats reset.'),
('user_profile_queue', 'queue_user_profile_from_identity',
 'Queue of external profile pages to extract (BaT, Cars and Bids and others): one row per profile URL. Filled by triggers: 81,236 of the 82,166 rows queued in the 3 days to 2026-10-07 came from trigger_queue_profile_from_identity on external_identities (discovered_via trigger). No row update since the stats reset: nothing drains it.',
 true,
 'Triggers trigger_queue_profile_from_identity on external_identities (queue_user_profile_from_identity), trigger_queue_profile_from_auction_comment on auction_comments (queue_user_profile_from_comment), trigger_queue_profile_from_listing on bat_listings (queue_user_profile_from_listing); ingest-external-profile inserts and updates; process-profile-queue claims through claim_user_profile_queue_batch (no cron). 105,253 inserts since the stats reset.'),
('nuke_estimates', 'compute-vehicle-valuation',
 'Nuke Estimate per vehicle: multi-signal valuation with deal and heat scores, one row per vehicle, overwritten. The capability map names it the valuation store; compute-vehicle-valuation upserts it.',
 true,
 'compute-vehicle-valuation (upsert); trigger trg_invalidate_estimates_on_price on vehicles (mark_comp_estimates_stale, AFTER UPDATE OF sale_price, winning_bid, asking_price) marks rows stale; SQL compute_nuke_estimates_bulk (no caller found). 4 inserts and 4,440 updates since the stats reset.'),
('vehicle_field_evidence', 'photo-pipeline-orchestrator',
 'Per-field evidence from images and forms: one row per claimed value of one vehicle field from one source (unique vehicle_id, field_name, source_type, source_id), with confidence, method and snapshot.',
 true,
 'photo-pipeline-orchestrator (upsert on vehicle_id, field_name, source_type, source_id); trigger spid_form_completion_tracker on vehicle_spid_data (track_spid_form_completion). 1 insert since the stats reset.'),
('external_identities', 'extract-bat-core',
 'The identity entity: one row per platform handle (unique platform, handle); 20 tables key to it. Platform readers upsert identities as they meet handles; key_auction_comment_authors created most recent rows while keying existing comment authors (77% of a 5% sample of the rows created in the 14 days to 2026-10-07 carry metadata.source auction_comments author). Never mint a parallel identity table.',
 true,
 'Upsert on (platform, handle): extract-bat-core (comment authors, sellers, buyers), ingest-observation through ingest_bat_live_events (BaT live frames) and retainedIdentity.ts, extract-auction-comments, extract-cars-and-bids-comments, import-pcarmarket-listing, extract-hagerty-listing, extract-bat-profile-vehicles, ingest-external-profile; key_auction_comment_authors(p_batch, p_from_block) for unkeyed comment authors (launchd ag.nuke.key-comment-authors). Claims: request_external_identity_claim, approve_external_identity_claim, the profile UI. process-profile-queue updates profile fields. 89,725 inserts and 95,427 updates since the stats reset.'),
('vehicle_quality_scores', 'unknown',
 'Listing completeness score per vehicle (has_vin, has_price, has_images, overall_score, needs_* flags). Writer unknown: 500 rows written since the stats reset by an undeclared statement, one client batch on 2026-09-30 20:25 to 20:27 UTC (an earlier batch of 500 on 2026-03-20). No function in prod and no code in the repo writes it; the creating migration 20251110000001 upserted it from calculate_vehicle_quality_score, whose live version no longer does. Candidate for the drop list.',
 true,
 'None live. Readers: auto_queue_backfills (trigger trg_auto_queue_backfills on scraper_versions), calculate_verification_layer, queue_vehicle_for_backfill, scripts/backfill-single-vehicle.js.'),
('vehicle_location_observations', 'extract-bat-core',
 'Where a source placed a vehicle at a moment: one row per location observation (vehicle x source x observed_at). Observation testimony landed by the listing extractors at read time.',
 true,
 'extract-bat-core, extract-cars-and-bids-core and process-cl-queue insert at read time; scripts/geocode-backfill.mjs upserts geocodes. 33,917 inserts since the stats reset.'),
('bat_quarantine', 'batUpsertWithProvenance',
 'Conflicts held by the Tetris write layer: when a new extraction disagrees with a stored vehicle value, the disagreement lands here for review instead of overwriting. Written only by _shared/batUpsertWithProvenance.ts.',
 true,
 '_shared/batUpsertWithProvenance.ts, called by extract-bat-core, ingest/craigslistCapture.ts, extract-vehicle-data-ai, bat-price-propagation, bat-snapshot-parser and observationWriter. 55,155 inserts since the stats reset.'),
('vehicle_price_history', 'log_vehicle_price_history',
 'Price history: one row per price of one type (msrp, purchase, current, asking, sale) as of a moment, with outlier flags. Written by trigger trg_log_vehicle_price_history on vehicles when a price column changes.',
 true,
 'Trigger trg_log_vehicle_price_history (AFTER UPDATE OF msrp, purchase_price, current_value, asking_price, sale_price on vehicles; log_vehicle_price_history); vehicle merge functions repoint rows (merge_vehicle_into_primary_by_url, rehydrate_profile_merge, auto_merge_duplicates_with_notification); frontend admin price tools (BulkPriceEditor, PriceCsvImport, DealerTransactionInput); scripts/backfill-sold-prices.ts. 1,249 inserts since the stats reset.'),
('organization_vehicles', 'auto_link_vehicle_to_origin_org',
 'Organization to vehicle links (consigner, owner, service provider, sold-by and others): one row per organization, vehicle and relationship. Most new links come from trigger trigger_auto_link_origin_org on vehicles when a vehicle is created with origin_organization_id (PR #651 traced the organizations counter updates to these links); dealers and the app also edit links directly.',
 false,
 'Trigger trigger_auto_link_origin_org (AFTER INSERT OR UPDATE OF origin_organization_id on vehicles); triggers trg_sync_bat_listing_to_org_vehicles on bat_listings, trg_sync_external_listing_to_org_vehicles and trigger_auto_mark_vehicle_sold on external_listings, trg_auto_tag_org_from_gps on vehicle_images, trg_link_org_from_timeline_event on timeline_events, trigger_apply_verification on vehicle_relationship_verifications; frontend dealer and organization tools; vehicle merge functions. Its own triggers update organizations counters (update_organization_stats). 21,171 inserts since the stats reset.'),
('vehicle_grades', 'persist_vehicle_grade',
 'Grade per vehicle, current state, overwritten: grade, floor, ceiling, confidence and dimension scores from compute_vehicle_grade. Written only by persist_vehicle_grade, which the regrade triggers call.',
 true,
 'persist_vehicle_grade(vehicle_id), called by trigger_regrade_vehicle (triggers trg_regrade_on_timeline on timeline_events, trg_regrade_on_transfer on ownership_transfers, trg_regrade_on_service on service_records), trigger_regrade_vehicle_stmt (statement trigger trg_regrade_on_image on vehicle_images) and batch_grade_vehicles. 20,397 inserts and 14,036 updates since the stats reset.'),
('bat_listings', 'bat-closed-lots-sync',
 'Catalog of Bring a Trailer lots: one row per lot URL. The live writer is bat-closed-lots-sync (cron bat-closed-lots-sync-daily, 06:50 UTC), which upserts closed lots from the BaT listings-filter feed.',
 true,
 'bat-closed-lots-sync (upsert); scripts/bat-keep-fresh.mjs (launchd com.nuke.bat-keep-fresh, not loaded on 2026-10-06); scripts/bat-bid-backfill.mjs (launchd com.nuke.bat-bid-backfill, not loaded); SQL update_bat_listing_comment_count, import_missing_bat_vehicles; merge_into_primary and unmerge_vehicle. Its triggers feed organization_vehicles, vehicles and user_profile_queue. 1,301 inserts since the stats reset.'),
('scraping_health', 'extract-cars-and-bids-core',
 'Scrape attempt log: one row per scrape attempt with its outcome, for reliability monitoring. The only writer in the repo is extract-cars-and-bids-core.',
 true,
 'extract-cars-and-bids-core (insert per attempt). 64 inserts since the stats reset.'),
('vehicle_field_provenance', 'auto_collect_field_evidence',
 'Current value and provenance per vehicle field (unique vehicle_id, field_name). Kept by trigger trg_auto_collect_field_evidence on vehicles (primary_source system_update) when a core identity field changes, and by the forensic consensus functions.',
 true,
 'Trigger trg_auto_collect_field_evidence (AFTER UPDATE on vehicles; auto_collect_field_evidence, upsert); build_field_consensus (called by process-cl-queue and the forensic pipeline functions); backfill_evidence_for_vehicle; scripts/materialize-field-evidence.mjs. 6,268 inserts since the stats reset.'),
('ownership_transfers', 'transfer-automator',
 'One row per transfer of a vehicle from seller to buyer, tracked from deal to title. Seeded by transfer-automator (deployed; source removed from the repo in 9871ee4fb) when trigger trg_auto_create_transfer_on_auction_close on auction_events sees a lot become sold; 2,232 rows created in the 7 days to 2026-10-07.',
 true,
 'transfer-automator (seed_from_auction, called through net.http_post by auto_create_transfer_on_auction_close unless app.seed_transfers is off); transfer-advance and transfer-status-api (deployed only per the capability map); triggers trg_transfer_milestone_completed on transfer_milestones and trg_upgrade_transfers_on_identity_claim on external_identities; transfer_staleness_sweep (cron transfer-staleness-sweep, inactive); frontend TransferPartyPage. 10,725 inserts and 10,676 updates since the stats reset.'),
('external_listings', 'retired',
 'RETIRED legacy listing table, superseded by vehicle_events (commit 216f9c545); no row created since 2026-04-14. Still updated by trigger sync_bid_count_trigger on vehicles (AFTER UPDATE OF bid_count) and by the vehicle merge functions. Do not add rows; new listings belong in vehicle_events.',
 true,
 'Trigger sync_bid_count_trigger on vehicles (sync_bid_count_to_external_listings); merge_vehicle_into_primary_by_url; maintenance functions with no caller found (reconcile_listing_status, whose cron reconcile-listing-status is inactive; cleanup_stale_listings, fix_external_listings_missing_prices, merge_duplicate_listings, backfill_missing_bat_external_listings). 2 updates since the stats reset.'),
('hammer_predictions', 'scripts/market/live-bands.mjs',
 'Prediction ledger for live auctions: one row per prediction for a lot at a moment, with inputs, predicted band and later the actual result. Current rows (model_version 31, 2,268 in the 14 days to 2026-10-07) come from scripts/market/live-bands.mjs under launchd ag.nuke.market-live-bands; score-live-auctions grades closed lots through score_closed_predictions. The table comment naming score-live-auctions as the writer predates live-bands.',
 true,
 'scripts/market/live-bands.mjs (REST insert with the service key, one row per live BaT lot without a version-31 row; launchd ag.nuke.market-live-bands runs it from origin/main); score_closed_predictions (called by score-live-auctions) fills actual_hammer and prediction_error_pct. 79 model_version 24 rows on 2026-09-30 20:40 to 20:42 UTC came from a writer not found in the repo. 1,153 inserts since the stats reset.'),
('image_coverage_by_vehicle', 'refresh_image_coverage',
 'Per-vehicle image-analysis coverage cache (tiers 0 to 4), one row per vehicle, refreshed one vehicle at a time by refresh_image_coverage(); the fleet scoreboard sums it.',
 false,
 'refresh_image_coverage(vehicle_id), called by photo-pipeline-orchestrator and scripts/daily-receipt/byok-fleet-next.mjs; refresh_vehicle_documented_floor (scripts/daily-receipt/byok-image-batch.sh) updates the floor. 4,581 inserts, 49,695 updates and 18 deletes since the stats reset.'),
('concierge_products', 'concierge-partner',
 'Concierge item entities (dishes, boutique items, artworks), each with a price claim, source and access tier; gated products never reach public surfaces. Partner catalog sync writes them: the deployed edge function concierge-partner, called hourly by cron concierge-partner-sync, whose source is in neither repo (nuke, lofficiel-concierge).',
 true,
 'concierge-partner (cron concierge-partner-sync, minute 23; 29 INSERT and 3,578 UPDATE statements 2026-09-24..10-02, all at minutes 23 to 25, carried no writer name); lofficiel-concierge scripts/ingest_shopify_catalog.py inserts catalog rows over REST and writes price as a second, gated step. Open owner gap until concierge-partner sends X-Nuke-Writer.'),
('merge_proposals', 'ingest',
 'Proposed duplicate-vehicle merges: one row per candidate pair with detection source, match tier, evidence and verdicts. All 28,909 proposals of the 14 days to 2026-10-07 came from ingest entity resolution (detection_source ingest-entity-resolution, tier 3, never auto-linked).',
 true,
 'ingest (upsert after it creates the new vehicle); SQL propose_vin_merges and propose_owner_merges through propose_anchor_merges (no caller found); scripts/generate-merge-proposals.mjs. 16,871 inserts since the stats reset.'),
('user_presence', 'VehicleProfileContext.tsx',
 'Who is on a vehicle page now: one row per user and vehicle, overwritten by a heartbeat. Written by the vehicle page in the frontend (nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx upsert).',
 false,
 'Frontend heartbeat upsert in VehicleProfileContext.tsx; SQL update_user_presence and cleanup_old_presence exist with no caller found. 3,780 inserts and 111 updates since the stats reset.');

-- Serialize with any other writer of pipeline_registry rows, so the NOT EXISTS check below cannot race.
LOCK TABLE public.pipeline_registry IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT b.table_name, NULL, b.owned_by, b.description, b.do_not_write_directly, b.write_via
FROM declare_table_owners_1 b
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_registry r
  WHERE r.table_name = b.table_name AND r.column_name IS NULL
);

-- Report: rows of this batch in place, rows another writer declared first (left alone), and any batch table still
-- without a table-level row. vehicle_observations belongs to the batch and is checked here; its row predates it.
DO $$
DECLARE
  v_batch int;
  v_ours int;
  v_kept text[];
  v_missing text[];
BEGIN
  SELECT count(*) INTO v_batch FROM declare_table_owners_1;

  SELECT count(*) INTO v_ours
  FROM declare_table_owners_1 b
  JOIN public.pipeline_registry r
    ON r.table_name = b.table_name AND r.column_name IS NULL AND r.description = b.description;

  SELECT array_agg(r.table_name || ' (' || r.owned_by || ')' ORDER BY r.table_name) INTO v_kept
  FROM public.pipeline_registry r
  WHERE r.column_name IS NULL
    AND r.table_name IN (SELECT table_name FROM declare_table_owners_1 UNION ALL SELECT 'vehicle_observations')
    AND NOT EXISTS (SELECT 1 FROM declare_table_owners_1 b
                    WHERE b.table_name = r.table_name AND b.description = r.description);

  SELECT array_agg(t.table_name ORDER BY t.table_name) INTO v_missing
  FROM (SELECT table_name FROM declare_table_owners_1 UNION ALL SELECT 'vehicle_observations') t
  WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r
                    WHERE r.table_name = t.table_name AND r.column_name IS NULL);

  RAISE NOTICE 'declare_table_owners_1: % of % declared rows in place', v_ours, v_batch;
  IF v_kept IS NOT NULL THEN
    RAISE NOTICE 'declare_table_owners_1: table-level row written by another writer, left alone: %', v_kept;
  END IF;
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'declare_table_owners_1: batch tables still without a table-level row: %', v_missing;
  END IF;
END $$;

COMMIT;

-- Verify live after the deploy (read-only, scripts/data/q.sh):
--   select count(*) from public.v_residual where 'owner' = any(gaps);   -- 66 before; 37 expected after this batch
--   select table_name, owned_by, do_not_write_directly from public.pipeline_registry
--    where column_name is null and created_at > now() - interval '1 day' order by 1;
--   select table_name, gaps, writers_30d from public.v_residual where 'owner' = any(gaps) order by est_rows desc;
