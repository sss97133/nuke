-- Table purpose (COMMENT ON TABLE) for every live table that had none: v_schema_atlas rows with purpose NULL and
-- activity written or read-only, 172 on 2026-10-06 (151 at the 04:49Z baseline). listing_page_snapshots is
-- described in its own migration (20261006070000). Lane C (cartographer), night shift 2026-10-05. Comments only.
--
-- EVIDENCE per table (read 2026-10-06 UTC): the v_schema_atlas row (activity, est_rows, writes/reads since the
-- statistics reset, FKs, pipeline_registry owners, writers_30d); the column list; min/max created_at (full scan
-- under 300K rows, 1% tablesample above, 0.05% for vehicle_images); edge functions that name the table and those
-- that insert/upsert/update it; live SQL functions whose body writes it (pg_proc); cron.job commands that name it;
-- the migration that creates it and its header; scripts that write it. "No row writes since the statistics reset"
-- quotes v_schema_atlas.writes_since_stats_reset = 0. Tables with no code, migration or job reference are said so.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

BEGIN;

-- ── written ─────────────────────────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.vehicle_images IS
'One row per image attached to, or awaiting attribution to, a vehicle (grain: one image file reference); 52M rows, 40 tables key to it. Event time = taken_at (EXIF capture; 2018-11 .. 2026-09 in a 0.05% sample). Ingest time = created_at. Writers: extractors (extract-bat-core and others store listing images as URLs), user upload, Apple Photos sync, and analysis functions that fill the analysis columns; pipeline_registry owners photo-pipeline-orchestrator, photo-sync-orchestrator, check-image-vehicle-match, yono-analyze, yono-classify. source says where the image came from.';
COMMENT ON TABLE public.field_extraction_log IS
'Field-level extraction outcome log: one row per field an extractor attempted on one source (grain: extraction run x field), with status, value, expected value, confidence and timing. Created by 20260124_extraction_health_system for drift detection. Writers: _shared extraction helpers (identify-vehicle-from-image and callers of _shared). Event and ingest time = created_at (logged as the extraction runs; 2026-01-25 .. 2026-10-04). Cron retention-field-extraction-log prunes old rows.';
COMMENT ON TABLE public.timeline_events IS
'Vehicle history events: one row per dated event in a vehicle''s life (service, purchase, sale, listing, photo session, work) (grain: one event on one vehicle). Event time = event_date (when it happened; 2003 .. 2026 in a 1% sample, a few future-dated). Ingest time = created_at. Writers: extractors (extract-bat-core, extract-hagerty-listing, extract-rmsothebys, process-cl-queue), document and work functions (analyze-vehicle-documents, create-work-session-from-evidence, generate-work-logs, report-marketplace-sale) and SQL functions (apply_auction_listing_outcome_to_vehicle_timeline, auto_group_photos_into_events, backfill_timeline_event_for_image). The creating migration calls it immutable history.';
COMMENT ON TABLE public.vehicles IS
'The vehicle entity: one row per physical vehicle (grain: one vehicle); 291 tables key to it. Columns hold the current best value per field; canonical columns are resolved by trigger trg_resolve_canonical_columns, and the testimony behind them lives in vehicle_observations and the field evidence tables. Not an event table: created_at is when the row was created (ingest, 2025-11-28 onward), updated_at the last write. Writers: every extractor and many enrichment functions (pipeline_registry owners include extractor, decode-vin-and-update, compute-vehicle-valuation, calculate-vehicle-scores, enrich-msrp, ownership-transfer-system).';
COMMENT ON TABLE public.vehicle_field_evidence IS
'Per-field evidence for vehicle values: one row per claimed value of one field from one source (grain: vehicle x field x source claim) with confidence, extraction method and snapshot. Writers: photo-pipeline-orchestrator, SQL track_spid_form_completion. Event time = extracted_at; ingest time = created_at (2025-12-27 .. 2026-04-01 in a 1% sample; 1 row write since the statistics reset).';
COMMENT ON TABLE public.vehicle_location_observations IS
'Where a source placed a vehicle at a moment: one row per location observation (grain: vehicle x source x observed_at) with raw and cleaned text, region, postal code, coordinates and county. Event time = observed_at (source time; 2003 .. 2026). Ingest time = created_at. Writers: extract-bat-core, extract-cars-and-bids-core, process-cl-queue, scripts/geocode-backfill.mjs. Keys only to vehicles: the place is text and codes, not a FK to a geography table.';
COMMENT ON TABLE public.vehicle_price_history IS
'Price history of vehicles: one row per price of one type (sale, ask, bid, estimate) as of a date (grain: vehicle x price_type x as_of), with proof and outlier flags. Event time = as_of (2020 .. 2026 in a 1% sample). Ingest time = created_at. Writers: SQL log_vehicle_price_history and the vehicle merge functions (merge_vehicle_into_primary_by_url, rehydrate_profile_merge); scripts/backfill-sold-prices.ts.';
COMMENT ON TABLE public.auction_readiness IS
'Auction Readiness Score per vehicle: one row per vehicle with composite score, tier, six dimension scores, gaps, coaching plan and photo zones (grain: one vehicle, current state, overwritten). Writers: SQL persist_auction_readiness and recompute_ars_dimension (pipeline_registry owner compute_auction_readiness). Clock: computed_at (derived, when scored); last_data_event_at is the newest input considered. Tier changes are logged in ars_tier_transitions.';
COMMENT ON TABLE public.vehicle_grades IS
'Grade per vehicle: one row per vehicle with grade, floor and ceiling, confidence, evidence count and dimension scores (grain: one vehicle, current state, overwritten). Writer: SQL persist_vehicle_grade; no edge function in the repo. Clock: calculated_at (derived; 2026-03-07 .. 2026-10-06 in a 1% sample).';
COMMENT ON TABLE public.import_queue IS
'Work queue of listing URLs to extract: one row per listing URL (unique) with source, status, priority, attempts, lock and error (grain: one listing URL). Writers: discovery functions (bat-closed-lots-sync, bat-url-discovery, bat-year-crawler, collecting-cars-discovery, extract-* discovery paths); claimed through claim_import_queue_batch*; bat-queue-worker drains BaT rows. created_at = when queued (ingest; current rows 2026-03-21 .. 2026-10-06); processed_at = when done.';
COMMENT ON TABLE public.external_listings IS
'Legacy listing table (BaT, Cars and Bids, eBay Motors and others): one row per vehicle listing on a platform (grain: vehicle x platform listing). Superseded for new listings by vehicle_events (commit 216f9c545). No edge function writes it in the repo; SQL maintenance functions still name it (reconcile_listing_status, cleanup_stale_listings, merge_duplicate_listings). Rows created 2025-12-07 .. 2026-04-14, none since; 1 row write since the statistics reset.';
COMMENT ON TABLE public.marketplace_listings IS
'Facebook Marketplace listings: one row per listing (facebook_id) with price, location, seller, parsed vehicle fields and review state (grain: one FB listing). Writers: extract-facebook-marketplace, fb-marketplace-orchestrator, import-fb-marketplace, ingest, refine-fb-listing, report-marketplace-sale, SQL detect_disappeared_listings and handle_listing_reappearance. first_seen_at, last_seen_at and scraped_at are our observation times (ingest); created_at 2026-02-02 .. 2026-10-01.';
COMMENT ON TABLE public.analysis_queue IS
'Queue of per-vehicle analysis passes: one row per requested pass with trigger, widgets to compute, status, worker and timings (grain: one queued pass). Writer: analysis-engine-coordinator (pipeline_registry owner); claimed by claim_analysis_queue_batch; enqueued by trigger_ars_on_extraction. created_at = enqueue time (2026-03-23 .. 2026-10-04); completed_at = finish.';
COMMENT ON TABLE public.ars_tier_transitions IS
'Log of Auction Readiness tier changes: one row per change of a vehicle''s tier with old and new score and dimension deltas (grain: vehicle x tier change). Writers: SQL persist_auction_readiness and recompute_ars_dimension. Event and ingest time = created_at (logged at the change; 2026-03-21 .. 2026-10-06).';
COMMENT ON TABLE public.hammer_predictions IS
'Hammer-price predictions on live auctions: one row per prediction for a lot at a moment, with its inputs (bid, counts, hours remaining, comps), predicted range and recommendation, and later the actual result (grain: lot x prediction moment). Writer: score-live-auctions; SQL score_closed_predictions fills actual_hammer and prediction_error_pct. Event time = predicted_at (2026-02-19 .. 2026-10-06); scored_at when graded (608 graded). Created by 20260218100000_hammer_prediction_engine.';
COMMENT ON TABLE public.merge_proposals IS
'Proposed duplicate-vehicle merges: one row per candidate pair (vehicle_a_id, vehicle_b_id) with detection source, match tier, evidence and AI and human verdicts (grain: one proposed pair). Writers: SQL propose_vin_merges and propose_owner_merges, edge function ingest, scripts/generate-merge-proposals.mjs. created_at = proposal time (2026-03-21 .. 2026-10-06); executed_at when merged.';
COMMENT ON TABLE public.user_presence IS
'Who is on a vehicle page now: one row per user x vehicle with last_seen_at (grain: user x vehicle, overwritten). Writer: SQL update_user_presence; cleanup_old_presence prunes it. Clock: last_seen_at (ingest, the latest heartbeat).';
COMMENT ON TABLE public.vehicle_views IS
'Vehicle page view log for discovery attribution: one row per view with viewer and IP address (grain: one page view). No edge function or live SQL function writes it (2026-10-06); 525 row writes since the statistics reset. Event and ingest time = viewed_at (2025-10-05 .. 2026-10-05). ip_address is personal data.';
COMMENT ON TABLE public.organizations IS
'The organization entity: one row per business (dealer, shop, auction house, publisher, venue) (grain: one organization); 105 tables key to it. Writers: extract-bat-core (seller organization resolution), classify-organization-type, extract-gaa-classics, link-document-entities, SQL enrich_organization, and undeclared writers (v_schema_atlas); pipeline_registry owner update_organization_stats. Not an event table: created_at is row creation (2025-11-01 .. 2026-07-25).';
COMMENT ON TABLE public.qb_transactions IS
'QuickBooks transaction lines imported for the owner''s books: one row per QuickBooks line (qb_id) with vendor, amount, account and the vehicle it was matched to (grain: one QB line). Writer: quickbooks-connect; pipeline_registry owner enhance-qb-confidence. Event time = date (transaction date). Ingest time = created_at (2026-03-23 .. 2026-09-30). Amounts are private financial data.';
COMMENT ON TABLE public.vehicle_custom_circuits IS
'Per-vehicle wiring circuits: one row per circuit in a vehicle wiring overlay with wire color, gauge, from and to component, connector, pin, fuse and length (grain: overlay x circuit). pipeline_registry owner wiring-layer-overlay; no edge function in the repo writes it. Created by 20260322200000_wiring_layer_overlay; rows 2026-04-13 .. 2026-09-30.';
COMMENT ON TABLE public.app_events IS
'Launch-funnel analytics events: one row per frontend event (event name, props, session, path, referrer) (grain: one client event). Written by the frontend through anonymous insert (RLS insert-only; 20260610000001_launch_funnel_instrumentation). Event and ingest time = created_at (2026-07-10 .. 2026-10-06). Cron app-events-retention prunes old rows.';
COMMENT ON TABLE public.harness_endpoints IS
'Wiring harness design endpoints: one row per electrical endpoint (device, sensor, actuator) in a harness design with power draw, connector, location zone and canvas and 3D position (grain: design x endpoint). No edge function in the repo writes it; 5 tables key to it. Rows 2026-03-12 .. 2026-09-30.';
COMMENT ON TABLE public.rate_limits IS
'Fixed-window rate-limit counters for public edge functions: one row per key (caller x function x window) with count and expiry (grain: one counter window). Writer: SQL rate_limit_increment; rate_limits_cleanup removes expired rows. Created by 20260226250000_rate_limits_table. Not an event table.';
COMMENT ON TABLE public.pii_audit_log IS
'Audit log of access to personal data: one row per access with accessing user, action, resource, reason and IP (grain: one access). Writer: SQL log_pii_access. Event and ingest time = created_at (2025-09-07 .. 2026-09-29).';
COMMENT ON TABLE public.concierge_partner_sync_runs IS
'Log of concierge partner sync runs: one row per run of one partner connection with items seen, landed and superseded, and the error (grain: connection x run). Written by the concierge-partner-sync cron path; no edge function in the repo. Event time = started_at and finished_at (2026-07-02 .. 2026-10-06).';
COMMENT ON TABLE public.timeline_event_conflicts IS
'Conflicts between timeline events: one row per pair of events that disagree, with type, description and resolution (grain: event pair). Writer: SQL detect_timeline_conflicts. created_at 2026-02-01 .. 2026-09-30.';
COMMENT ON TABLE public.concierge_partner_connections IS
'Concierge partner data connections: one row per organization channel endpoint with mandate, consent, default access tier, sync schedule and last result (grain: org x channel). Writers: instagram-connect and undeclared writers (v_schema_atlas); cron concierge-partner-sync. The credential is referenced by credential_secret_id and read through concierge_read_partner_secret.';
COMMENT ON TABLE public.profile_stats IS
'Per-user aggregate counts (vehicles, images, contributions, timeline events): one row per user (grain: one user, overwritten). Writers: SQL recompute_profile_stats, handle_image_activity, vehicles_stats_aiud. Clock: updated_at (derived). 3 rows.';
COMMENT ON TABLE public.parent_company IS
'Legal entity record of the parent company for securities filings and the QuickBooks connection: one row per company (1 row). Writer: quickbooks-connect (connection fields); created by 20260125100000_legal_entity_setup. Holds tax ids and QuickBooks OAuth tokens: private, never expose.';
COMMENT ON TABLE public.oauth_login_sessions IS
'In-flight OAuth authorize requests during magic-link login: one row per login attempt (grain: one authorize session), short-lived. Writers: oauth-server, connect-claude. created_at = start, completed_at = user finished, expires_at bounds it.';
COMMENT ON TABLE public.harness_templates IS
'Reusable wiring harness templates: one row per template with vehicle type, engine, ECU platform and template data (grain: one template). No writer in the repo; rows created 2026-03-04.';
COMMENT ON TABLE public.oauth_clients IS
'OAuth dynamic client registry for the Nuke OAuth server: one row per registered client (e.g. Claude.ai) with secret hash, redirect URIs, grants and scope (grain: one client). Writer: oauth-server. last_used_at = last token use.';
-- ── read-only (no row writes since the statistics reset) ────────────────────────────────────────────────────
COMMENT ON TABLE public.source_targets IS
'Listing URLs discovered from source sitemaps: one row per source x listing URL with the sitemap file it came from (grain: source x URL). Loaded 2026-02-11 .. 2026-02-12 (first_discovered_at); no writer in the repo; read by db-stats. No row writes since the statistics reset.';
COMMENT ON TABLE public._zero_rel_candidates IS
'Scratch list (id, status), 729K rows. No code, migration or job refers to it (2026-10-06); meaning UNKNOWN. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.mv_bidder_profiles IS
'BaT bidder aggregates: one row per bat_username with total bids, auctions entered, wins, win rate, average and max bid, first and last seen (grain: one bidder handle). Built from bat_bids by 20260215500000_bid_analytics_foundation (a table populated in batches, not a materialized view). Lifetime numbers as of the build: not point-in-time, never feed a past prediction. No row writes since the statistics reset.';
COMMENT ON TABLE public.comment_persona_signals IS
'Per-comment persona signals: one row per auction comment with tone, expertise and style scores (grain: one comment). From 20260129_commenter_personas; filled by scripts/persona-assembly-line.sh. Keyed to comments by comment_id and author_username text, no FK. No row writes since the statistics reset.';
COMMENT ON TABLE public._has_events IS
'Scratch list of vehicle_ids, 167K rows. No code, migration or job refers to it (2026-10-06); meaning UNKNOWN. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public._tmp_buyer_makes_agg IS
'Staging aggregate for refresh_buyer_profiles: one row per BaT username with the makes they bought most (grain: one buyer handle). Written only by SQL refresh_buyer_profiles; lifetime numbers as of its last run. No row writes since the statistics reset.';
COMMENT ON TABLE public._tmp_purchase_stats IS
'Staging aggregate for refresh_buyer_profiles: one row per BaT username with purchase count, total and price spread, first and last purchase date (grain: one buyer handle). Written only by SQL refresh_buyer_profiles; lifetime numbers as of its last run. No row writes since the statistics reset.';
COMMENT ON TABLE public._tmp_sale_stats IS
'Staging aggregate for refresh_buyer_profiles: one row per BaT username with vehicles sold, total earned, average price, first and last sale date (grain: one seller handle). Written only by SQL refresh_buyer_profiles; lifetime numbers as of its last run. No row writes since the statistics reset.';
COMMENT ON TABLE public.oem_vehicle_specs IS
'OEM factory specifications: one row per make, model, year range and trim with dimensions, weights, engine and capacities (grain: one spec configuration). Created by 20251102000003_oem_factory_specs; SQL link_document_to_specs links documents to it. Rows 2025-11-02 .. 2026-03-23; no row writes since the statistics reset.';
COMMENT ON TABLE public.reference_libraries IS
'Reference library per year, make, model, series and body: one row per library that holds contributed manuals, brochures and specs (grain: one library). Writers: SQL get_or_create_library_for_vehicle, link_document_to_specs, trigger_update_library_stats; parse-reference-document. Rows 2025-11-21 .. 2026-04-25; no row writes since the statistics reset.';
COMMENT ON TABLE public.zip_to_fips IS
'US ZIP code to county FIPS lookup: one row per ZIP (grain: one ZIP code). Reference data; no writer in the repo. A candidate geography key for location text (plan lane K). No row writes since the statistics reset.';
COMMENT ON TABLE public._ghost_vehicle_cleanup IS
'Scratch work list of a ghost-vehicle cleanup (vehicle_id, has_links, processed), 40K rows. No code, migration or job refers to it (2026-10-06). Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.enrichment_log IS
'Log of fields applied to vehicles by snapshot enrichment: one row per vehicle x source pass with the fields applied (grain: one enrichment application). Writers: SQL apply_description_discoveries, enrich_bj_from_snapshots, enrich_cab_from_snapshots. Event time = applied_at. No row writes since the statistics reset.';
COMMENT ON TABLE public.property_images IS
'Images of concierge properties: one row per image with URL, caption, category and order (grain: property x image). Loaded by scripts/concierge/migrate-villas-to-properties.ts; rows 2026-01-30 .. 2026-07-20; no row writes since the statistics reset.';
COMMENT ON TABLE public.image_set_members IS
'Membership of images in image sets (albums): one row per image in a set with order, role and caption (grain: set x image). Writers: SQL bulk_add_to_image_set, reorder_image_set. Rows 2025-12-06 .. 2026-04-13; no row writes since the statistics reset.';
COMMENT ON TABLE public.component_conditions IS
'Component-level condition findings from image analysis: one row per component seen in an image with rating, damage types, originality, priority and cost estimate (grain: image x component). Created by 20251122_professional_appraisal_tables; no writer in the repo now. Rows 2026-02-06 .. 2026-03-26.';
COMMENT ON TABLE public.zz_backup_villa_cleanup_20260705_property_images IS
'Backup copy of property_images taken before the 2026-07-05 villa cleanup. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.catalog_parts IS
'The parts catalog (designated in docs/ledger/CAPABILITY_MAP.md): one row per part in an indexed supplier catalog with part number, name, price, application data and name embedding (grain: catalog x part); 11 tables key to it. Writer: index-reference-document; readers recommend-parts-for-vehicle, query-wiring-needs, generate-wiring-quote. Rows 2025-12-03 .. 2026-05-11; no row writes since the statistics reset.';
COMMENT ON TABLE public.market_trends IS
'Aggregated market sentiment and demand by make, model, year range and platform (grain: segment x platform x run). Writer: calculate-market-trends. No row writes since the statistics reset.';
COMMENT ON TABLE public.comment_library_extractions IS
'Facts mined from auction comments for the reference library, by make, model, year range and extraction type, with promotion status (grain: segment x extraction). Writer: scripts/mine-comments-for-library.mjs; rows 2026-03-20 .. 2026-03-24.';
COMMENT ON TABLE public.organization_inventory_sync_queue IS
'Queue of organization inventory syncs: one row per organization sync job with mode, status, attempts and next run (grain: one org sync job). Writers: process-classic-seller-queue, SQL auto_queue_zero_inventory_orgs and trigger_investigate_zero_inventory. Rows 2025-12-14 .. 2026-07-21; no row writes since the statistics reset.';
COMMENT ON TABLE public.fb_listing_disappearances IS
'Facebook Marketplace listings that dropped out of sweeps: one row per disappearance with missed sweeps, last seen price and location, and reappearance (grain: listing x disappearance). Writers: SQL detect_disappeared_listings, handle_listing_reappearance. Rows 2026-02-28 .. 2026-06-11.';
COMMENT ON TABLE public.zz_backup_villa_cleanup_20260705_properties IS
'Backup copy of properties taken before the 2026-07-05 villa cleanup. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.us_county_boundaries IS
'US county boundaries: one row per county FIPS with name, state FIPS and geometry (grain: one county). Reference data; no writer in the repo; read for point-in-county lookups. No row writes since the statistics reset.';
COMMENT ON TABLE public.dealer_inventory IS
'Dealer inventory records: one row per vehicle a dealer holds or sold, with acquisition, asking and sale price and dates (grain: dealer x vehicle). Created by 20251102_dealer_inventory_system; scrape-vehicle names it. Rows 2025-12-13 .. 2025-12-30; no row writes since the statistics reset.';
COMMENT ON TABLE public.source_quality_snapshots IS
'Data quality per source over time: one row per source x snapshot with coverage and validity percentages (grain: source x snapshot_at). Writer: SQL snapshot_source_quality. Event time = snapshot_at; rows 2026-02-26 .. 2026-04-14.';
COMMENT ON TABLE public.photo_sync_items IS
'Per-photo Apple Photos sync tracking: one row per Photos library item (photos_uuid) with dates, hashes, automotive classification and sync status (grain: one library photo). Created by 20260211100000_photo_auto_sync_system; written by scripts/photo-auto-sync-daemon.py and ollama-classify-photo.py. Event time = photos_date_taken; photos_date_added = library add time.';
COMMENT ON TABLE public.business_timeline_events IS
'Organization history events: one row per dated business event (grain: one event on one organization). Event time = event_date; ingest time = created_at (2025-11-01 .. 2026-07-04). Writers: auto-merge-duplicate-orgs, create-org-from-url, generate-work-logs, SQL create_org_timeline_from_vehicle_event.';
COMMENT ON TABLE public.image_sets IS
'Image sets (albums) per vehicle or user, linkable to a timeline event (grain: one set). Created by 20251123_image_sets_system; SQL convert_personal_album_to_vehicle. Rows 2025-12-06 .. 2026-04-13; 6 tables key to it.';
COMMENT ON TABLE public.dealer_inventory_seen IS
'Dealer listing sightings for disappearance detection: one row per dealer x listing URL with first and last seen, last status and count (grain: dealer x listing URL). Created by 20251214000020_classic_seller_import_toolbox. first_seen_at and last_seen_at are our observation times (ingest).';
COMMENT ON TABLE public.prediction_model_coefficients IS
'Bid-curve multipliers of the hammer prediction model: one row per model version x price tier x time window with median, p25 and p75 multiplier and sample size (grain: one coefficient set). Created by 20260218100000_hammer_prediction_engine; read by _shared. trained_at = training time.';
COMMENT ON TABLE public.properties IS
'Concierge property entity (villas and venues): one row per property with location, specs and pricing (grain: one property); 4 tables key to it. Loaded by scripts/concierge/migrate-villas-to-properties.ts; rows 2026-01-30 .. 2026-07-20; no row writes since the statistics reset.';
COMMENT ON TABLE public.bat_users IS
'Earlier BaT user table: one row per BaT username (1,207 rows, created 2025-12-07 .. 2025-12-31). external_identities (611K BaT handles) is the identity entity now; the FK columns that point here (bat_listings, bat_bids, auction_comments.author_bat_user_id) are NULL on every row. Writers: SQL get_or_create_bat_user, update_bat_user_stats.';
COMMENT ON TABLE public._identity_backfill_make_map IS
'Scratch map of vehicle_id to canonical_make_id from an identity backfill. No code, migration or job refers to it (2026-10-06). Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.publications IS
'Magazine publications: one row per issue with publisher, platform ids, date and page count (grain: one issue); 5 tables key to it. pipeline_registry owners issuu-hash-extractor, issuu-publication-seeder, process-publication-pages. Rows 2026-03-01 .. 2026-07-21.';
COMMENT ON TABLE public.org_assets IS
'Brand assets of organizations (logos, images) by org_slug with storage path and dimensions (grain: org x asset). Writer: scripts/scrape-brand-assets.mjs; rows 2025-12-29 .. 2026-07-21.';
COMMENT ON TABLE public.projection_event IS
'Log of model projections (AI outputs): one row per projection with request and result envelopes, model, prompt hash and input observation ids; a retraction points to the retracting row (grain: one projection). Writers: mcp-connector, SQL retract_projection_event. Event time = observed_at; ingest time = recorded_at.';
COMMENT ON TABLE public.line_items IS
'Line items of receipts (parts, tools, services) with part number, quantity and price (grain: receipt x line). Created by 20250102000004_universal_receipt_system; all rows created 2026-01-23. Amounts are private.';
COMMENT ON TABLE public.motec_forum_threads IS
'Scraped MoTeC forum threads with posts and issue classification (grain: one thread). Writer: scripts/scrape-motec-forum.mjs; all rows 2026-03-23. Event time = first_post_at and last_post_at.';
COMMENT ON TABLE public.mag_stories IS
'Stories in magazine issues with title, pages, credits, people and brands (grain: issue x story). No writer in the repo; rows 2026-07-14 .. 2026-07-26.';
COMMENT ON TABLE public.scrape_sources IS
'Registry of listing sources (sites, auction houses, dealers) with scrape config, URL patterns and last scrape (grain: one source); import_queue.source_id keys to it. Writers: import-classic-auction, import-pcarmarket-listing, onboard-source, and migrations (e.g. the BaT settlement source row, 20260927083000). Rows 2025-12-02 .. 2026-09-27.';
COMMENT ON TABLE public.backtest_runs IS
'Hammer-price backtest results: one row per run with model version, lookback, auction count and error metrics (grain: one backtest run). Created by 20260219000001_backtest_simulator_schema; run from scripts (adaptive_comp_weight.mjs and others). Rows 2026-02-18 .. 2026-03-09.';
COMMENT ON TABLE public.author_personas IS
'Aggregated commenter personas: one row per platform author with average tone and expertise scores and primary persona (grain: one author). Writer: SQL aggregate_author_personas over comment_persona_signals. Lifetime aggregates, not point-in-time.';
COMMENT ON TABLE public.library_documents IS
'Documents in reference libraries (manuals, brochures, parts books) with attribution and usage stats (grain: one document). Writers: parse-reference-document, SQL increment_document_stat. Rows 2025-11-21 .. 2026-05-06.';
COMMENT ON TABLE public.zz_backup_sibarth_attribution_fix_20260721_props IS
'Backup of property owner_org_id values captured before the 2026-07-21 St Barth attribution fix. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.vehicle_production_data IS
'Production numbers and rarity by make, model, year, body, trim and engine option (grain: one production configuration). Created by 20250117000001_vehicle_production_data; read by compute-vehicle-valuation. Rows 2025-11-09 .. 2026-06-23.';
COMMENT ON TABLE public.zz_backup_sibarth_attribution_fix_20260721_orgs IS
'Backup of organization slug and logo_url values captured before the 2026-07-21 St Barth attribution fix. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.zz_backup_sibarth_attribution_fix_20260721_assets IS
'Backup of asset rows captured before the 2026-07-21 St Barth attribution fix. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.mag_sources IS
'Magazine source PDFs: one row per uploaded file with hash, pages, publisher match and storage path (grain: one PDF). No writer in the repo; rows 2026-07-14 .. 2026-07-22.';
COMMENT ON TABLE public.receipt_items IS
'Line items parsed from receipt OCR (grain: receipt x line). Writer: SQL extract_parts_from_ocr; read by forensic-deal-jacket. Rows 2026-05-03 .. 2026-05-08. Amounts are private.';
COMMENT ON TABLE public.fb_sweep_jobs IS
'Facebook Marketplace sweep runs: one row per sweep with locations processed, listings found, price changes and disappearances (grain: one sweep). Writers: fb-marketplace-orchestrator, SQL start_fb_sweep and complete_sweep_location. Event time = started_at and completed_at; rows 2026-02-28 .. 2026-06-12.';
COMMENT ON TABLE public.service_records IS
'Service history extracted from vehicle documents: one row per service visit with date, mileage, shop, work and cost (grain: vehicle x service). Writer: analyze-vehicle-documents. Event time = service_date; all rows created 2026-02-01.';
COMMENT ON TABLE public._attribution_drain_20260727 IS
'Scratch record of a 2026-07-27 image attribution drain (image, vehicle before and intended, outcome). No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.agent_tasks IS
'Agent task queue: one row per task with type, status, priority, claim and result (grain: one task). Writer: SQL claim_next_task; scripts nuke-spawn.mjs, otto-spawn.mjs, ralph-spawn.mjs. Rows 2026-01-31 .. 2026-07-19.';
COMMENT ON TABLE public.zz_backup_stbarth_corpus_reclean_20260706 IS
'Backup copy of organizations rows taken before the 2026-07-06 St Barth corpus re-clean. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.ghost_users IS
'Camera-device identities for photos contributed before the owner signs up: one row per device fingerprint (camera make, model, lens, software) with contribution count and claim (grain: one device). Writers: SQL get_or_create_ghost_user, claim_ghost_user, update_ghost_profile_buildability. first_seen_at and last_seen_at are ingest clocks.';
COMMENT ON TABLE public.organizations_archived_20260129 IS
'Archive of the organizations table as it was before the 2026-01-29 rebuild (169 rows); vehicles still has an FK to it. No writer.';
COMMENT ON TABLE public.vehicle_condition_assessments IS
'Professional-style condition assessments: one row per vehicle assessment with overall and area ratings (exterior, interior, mechanical, undercarriage) and a value multiplier (grain: vehicle x assessment). Created by 20251122_professional_appraisal_tables (Hagerty 1-6 scale); no writer in the repo now. Event time = assessment_date; rows created 2026-02-06 .. 2026-03-25.';
COMMENT ON TABLE public.zz_backup_stbarth_prefix_contaminated_20260706 IS
'Backup copy of organizations rows set aside on 2026-07-05/06 during the St Barth prefix clean-up. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.vehicle_build_manifest_pre_v2 IS
'Copy of the vehicle build manifest (devices, parts, suppliers, prices, purchase status) as it was before the v2 rebuild; rows created 2026-03-23 .. 2026-04-13. No code or migration refers to it. Amounts are private.';
COMMENT ON TABLE public.prediction_model_make_corrections IS
'Per-make correction factors of the hammer prediction model: one row per model version x make with factor, sample size and bias (grain: model version x make). Created by 20260219200000_prediction_model_metadata; read by _shared. All rows created 2026-02-19.';
COMMENT ON TABLE public.vehicle_contributors IS
'People and organizations with a role on a vehicle (owner, contributor, mechanic, ...) and their permissions and period (grain: vehicle x person x role). Created as a policy reference table (20250105000001_contributor_system_foundation); 252,867 reads since the statistics reset. Writers: SQL approve_role_application, claim_ghost_user, merge_vehicle_into_primary_by_url. Rows 2025-10-07 .. 2026-07-06.';
COMMENT ON TABLE public.fb_marketplace_sellers IS
'Facebook Marketplace seller profiles: one row per FB user with listing counts, average price and days to sell (grain: one seller). Created by 20260204_b_fb_sweep_infrastructure; filled by FB scraper scripts. Lifetime numbers as of the last sweep. Rows 2026-02-25 .. 2026-04-04.';
COMMENT ON TABLE public.tool_catalog IS
'Tool product catalog: one row per tool product with brand, part and model numbers, specs and prices (grain: one product). Created by 20250930000001_create_tool_tables; loaded by scripts/import_snapon_receipt.js; all rows 2025-10-13.';
COMMENT ON TABLE public.tool_catalog_images IS
'Images of tool_catalog products (grain: product x image). Created by 20250930_comprehensive_tools_schema; all rows 2025-10-13.';
COMMENT ON TABLE public.zz_backup_jz_products_20260721 IS
'Backup of organization product rows taken around 2026-07-15/21. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.classic_seller_queue IS
'Queue of classic-car seller profiles to import as organizations: one row per seller profile URL with status and attempts (grain: one seller profile). Created by 20251214000020_classic_seller_import_toolbox; worker process-classic-seller-queue. discovered_at and processed_at are ingest clocks.';
COMMENT ON TABLE public.parts_catalog IS
'Parts catalog of the build tools: one row per part with OEM and aftermarket numbers, brand, category and fitment (grain: one part); parts_fitment keys to it. Seeded by 20260617150000_seed_observed_k5_parts; SQL update_parts_pricing. A second parts catalog beside catalog_parts (the designated one). Rows 2025-10-05 .. 2026-06-18.';
COMMENT ON TABLE public.tool_usage_stats IS
'How often a user tool was seen in use: one row per user tool with uses, last use and vehicles (grain: one user tool). Loaded by scripts/populate-tool-usage-from-detections.js; all rows 2025-11-03.';
COMMENT ON TABLE public.work_order_parts IS
'Parts used in a work order or work timeline event, with part number, quantity, price, supplier and verification flags (grain: event x part). Created by 20251102000009_work_order_research_system; writers generate-work-logs, mcp-connector; SQL sync_work_order_to_timeline. Rows 2026-02-04 .. 2026-04-06. Amounts are private.';
COMMENT ON TABLE public.vehicle_timeline IS
'An earlier vehicle timeline table (72 rows): one row per event with type, date, source and confidence (grain: one event). timeline_events is the live history table. Referenced by work-session and merge_vehicle_into_primary_by_url. Event time = event_date; ingest time = inserted_at.';
COMMENT ON TABLE public.scratch_rpc_parity_20260721 IS
'Scratch output of a 2026-07-21 RPC parity check (brand, fp, rk, tl, dist, rnk, plc). No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.vehicle_valuations IS
'Stored vehicle valuations: one row per valuation with estimated value, documented components, methodology and justification (grain: vehicle x valuation). Read by mcp-connector; no writer in the repo now. Event time = valuation_date; rows 2025-10-31 .. 2026-03-08.';
COMMENT ON TABLE public.catalog_text_chunks IS
'Text chunks of indexed supplier catalogs awaiting part extraction (grain: catalog x chunk). No writer in the repo; all rows 2025-12-03.';
COMMENT ON TABLE public.reference_documents IS
'User-owned reference documents (manuals, service bulletins) with file hash, scope, topics and base trust score (grain: one document); 3 tables key to it. Created by 20251122_user_reference_library; used by index-reference-document, ingest-observation, calculate-profile-completeness.';
COMMENT ON TABLE public.vehicle_segments IS
'Vehicle segment taxonomy: one row per segment (slug, name, parent, keywords) (grain: one segment); vehicles key to it. Seeded by 20260212000001_vehicle_segments; 425,235 reads since the statistics reset. Rows 2026-01-23 .. 2026-02-12.';
COMMENT ON TABLE public.secure_documents IS
'Metadata of encrypted user documents (no content): one row per document with type, hash, storage path, encryption key id and verification status (grain: one document). Created by 20250903_pii_protection_system; SQL cleanup_expired_documents, set_primary_document. Private.';
COMMENT ON TABLE public.technician_work_evidence IS
'Per-photo technician work evidence: one row per photo or observation that shows a technician doing an operation, with specialty, duration and tools visible (grain: technician x source photo). Writer: SQL cascade_technician_evidence (20260523080100_technicians_table). Event time = observed_at; rows 2026-05-29 .. 2026-07-11.';
COMMENT ON TABLE public.department_presets IS
'Templates of shop departments by business type (grain: business type x department). Seeded by 20250105000001_contributor_system_foundation; rows 2025-10-04 .. 2025-11-09.';
COMMENT ON TABLE public.broadcast_backfill_queue IS
'Queue of auction broadcast videos to match to lots: one row per video with house, auction, date, status and claim (grain: one video). Worked by scripts/broadcast-backfill-worker.ts; all rows 2026-01-31.';
COMMENT ON TABLE public.vehicle_comments IS
'User comments on a vehicle page (grain: one comment). Created by 20250121_universal_commenting_system; moved by SQL merge_vehicle_into_primary_by_url and auto_merge_duplicates_with_notification. Event and ingest time = created_at (2025-09-07 .. 2026-03-04).';
COMMENT ON TABLE public.work_orders IS
'Service and work requests to a shop: one row per work order with customer, vehicle, request, urgency, estimate and status (grain: one work order); 12 tables key to it. Created by 20251212000010_work_orders_schema_backfill; read by mcp-connector and _shared. Rows 2025-11-02 .. 2026-04-30. Customer contact columns are private.';
COMMENT ON TABLE public.part_alternatives IS
'Alternative sources for a work order part: one row per offer with brand, part number, retailer, price and stock (grain: work order part x offer). No writer in the repo; all rows 2026-02-04.';
COMMENT ON TABLE public.work_order_labor IS
'Labor lines of a work order or work timeline event: one row per task with hours, rate, cost and industry standard hours (grain: event x task). Created by 20251102000009_work_order_research_system; writers generate-work-logs, mcp-connector; SQL sync_work_order_to_timeline, update_labor_rates_on_org_change; pipeline_registry owners calculate_labor_cost_fluid(), resolve_labor_rate(). Rows 2026-02-27 .. 2026-04-03.';
COMMENT ON TABLE public.canonical_body_styles IS
'Canonical body style vocabulary: one row per body style with display name, vehicle type and aliases (grain: one body style). Seeded by 20260114000000_canonical_vehicle_types_and_body_styles; read 19,440 times since the statistics reset.';
COMMENT ON TABLE public.part_categories IS
'Category tree for build parts (grain: one category). Created by 20250929000001_vehicle_build_management.';
COMMENT ON TABLE public.catalog_sources IS
'Supplier catalogs indexed into catalog_parts: one row per catalog with provider, base URL and source PDF document (grain: one catalog). Created by 20251203_parts_catalog_system; read by index-reference-document, query-wiring-needs, generate-wiring-quote. Rows 2025-12-03 .. 2026-03-23.';
COMMENT ON TABLE public.canonical_vehicle_types IS
'Canonical vehicle type vocabulary: one row per type with display name and aliases (grain: one type); canonical_body_styles keys to it. Seeded by 20260114000000_canonical_vehicle_types_and_body_styles.';
COMMENT ON TABLE public.user_notifications IS
'In-app notifications to users: one row per notification with type, message, related vehicle or image and read state (grain: one notification). Writers: SQL create_notification, create_user_notification, create_work_approval_notification, auto_merge_duplicates_with_notification; extract-vin-from-vehicle. Rows 2025-11-25 .. 2026-03-08.';
COMMENT ON TABLE public.vehicle_ownerships IS
'Owners of a vehicle over time: one row per owner period with role, current flag, start and end date, proof and authority score (grain: vehicle x owner period). Writers: SQL set_single_current_owner, sync_transfer_to_ownership, sync_verification_to_ownership; derive-title-ownership. Event time = start_date and end_date; rows created 2026-02-01 .. 2026-05-24.';
COMMENT ON TABLE public.vehicle_sale_settings IS
'Owner sale settings per vehicle: for sale, live auction, partners, reserve and display modes (grain: one vehicle, current state). No writer in the repo; read 907 times since the statistics reset. Clock: updated_at.';
COMMENT ON TABLE public.vehicle_part_locations IS
'Where a part sits in images of a make, model and body (part, OEM number, view angle, bounding box) (grain: model x part x view). No writer in the repo; all rows 2025-10-25.';
COMMENT ON TABLE public.service_integrations IS
'Registry of external data services (NHTSA, GM Heritage, Carfax, appraisals) with endpoint, auth method, trigger rules and price (grain: one service). Created and seeded by 20251203_service_integration_framework and 20251203_seed_services; all rows 2025-12-03.';
COMMENT ON TABLE public.organization_seller_stats IS
'Selling statistics per organization on auction platforms (listings, sold, sell-through, gross and median price) (grain: one organization). Writer: compute-org-seller-stats (20260214100000_organization_seller_stats). Lifetime numbers as of the last run; rows 2026-02-14 .. 2026-02-28.';
COMMENT ON TABLE public.part_catalog IS
'Parts marketplace catalog: one row per part with OEM number, fitment and supplier listings (grain: one part). Created by 20251025000001_parts_marketplace; SQL update_part_price_stats. A third parts catalog beside catalog_parts and parts_catalog. All rows 2025-10-26.';
COMMENT ON TABLE public.part_suppliers IS
'Parts marketplace suppliers with URL, API availability, scrape config and commission (grain: one supplier). Created by 20251025000001_parts_marketplace; all rows 2025-10-25. api_key_encrypted is a credential.';
COMMENT ON TABLE public.vehicle_image_comments IS
'User comments on a vehicle image (grain: one comment). Created by 20250120_image_social_features. Event and ingest time = created_at (2025-11-22 .. 2026-01-09).';
COMMENT ON TABLE public.market_funds IS
'Market segment funds (symbol, type, NAV, shares outstanding, AUM) (grain: one fund). Created by 20251214000010_market_funds; SQL market_fund_buy, update_market_nav. All rows 2025-12-21.';
COMMENT ON TABLE public.vehicle_builds IS
'Build or restoration projects of a vehicle: one row per project with dates, status, budget, spend and hours (grain: one build project). Created by 20250929000001_vehicle_build_management; rows 2025-11-11 .. 2025-12-04. Amounts are private.';
COMMENT ON TABLE public.market_segments IS
'Market segment definitions (year range, makes, model keywords, manager type, priority) (grain: one segment); market_funds and market_segment_stats_cache key to it. Created by 20251214000010_market_funds; rows 2025-12-21 .. 2026-07-27.';
COMMENT ON TABLE public.market_segment_stats_cache IS
'Cached statistics per market segment (vehicle count, market cap, average price, 7 and 30 day change) (grain: one segment, overwritten). Writer: SQL refresh_segment_stats_cache. Clock: refreshed_at (derived).';
COMMENT ON TABLE public.vehicle_stats_cache IS
'Cached activity totals per vehicle (images, AI tags, labor hours, receipts value, last activity) (grain: one vehicle, overwritten). Writer: SQL update_vehicle_stats. Clock: updated_at (derived). 3 rows.';
COMMENT ON TABLE public.work_order_status_history IS
'Status changes of work orders: one row per change with old and new status and who changed it (grain: work order x change). Writer: SQL log_work_order_status_change. Event and ingest time = created_at (2026-04-03 .. 2026-04-30).';
COMMENT ON TABLE public.technicians IS
'Technician entity: one row per technician with certifications, specializations, shop and claimed and inferred hourly rate (grain: one technician); 3 tables key to it. Created by 20260523080100_technicians_table; read by api-v1-business-data. Contact columns are private.';
COMMENT ON TABLE public.platform_integrations IS
'Status of platform integrations (Central Dispatch, Twilio, Stripe, ...) with token expiry (grain: one integration). Created by 20251027_platform_integrations; all rows 2025-10-27.';
COMMENT ON TABLE public.component_assembly_map IS
'Assembly definitions for image analysis: one row per assembly (e.g. a door) with its sub-components, catalog part map and visible states (grain: one assembly). Created by 20251206_component_assembly_map; all rows 2025-12-05.';
COMMENT ON TABLE public.ds_cost_tracking IS
'Daily document-extraction cost per provider and model (extractions, tokens, cost, revenue) (grain: day x provider x model). Created by 20260208_f_dealerscan_schema; writer document-ocr-worker. Rows 2026-02-26 .. 2026-02-27.';
COMMENT ON TABLE public.concierge_quotes IS
'Concierge quotes to guests: one row per quote with stay dates, guests, line items, fees, total and deposit (grain: one quote). No writer in the repo; rows 2026-01-31 .. 2026-07-15. Guest contact columns and amounts are private.';
COMMENT ON TABLE public.user_external_profiles IS
'A user''s profiles on outside platforms with username, verification and auto-import flag (grain: user x platform). Read by mcp-connector; rows 2025-11-10 .. 2026-06-11. A user-side link beside external_identities.claimed_by_user_id.';
COMMENT ON TABLE public.shops_archived_20260129 IS
'Archive of the shops table as it was before the 2026-01-29 consolidation into organizations (2 rows); 9 tables still have FKs to it (vehicles, technicians, ...). No writer.';
COMMENT ON TABLE public.community_events IS
'Revenue-generating events hosted at properties or venues (grain: one event). Created by 20260211000001_contract_real_estate_events. Event time = start_date and end_date.';
COMMENT ON TABLE public.buyer_tiers IS
'Buyer tier per platform buyer profile with bids, wins, payment reliability and spend (grain: one buyer). Created by 20251111000005_tiered_auction_system; SQL refresh_platform_tier. 1 row (2026-01-25).';
COMMENT ON TABLE public.lending_partners IS
'Lending partner definitions for vehicle-backed loans (capacity, loan range, rates, LTV) (grain: one partner). Created by 20260125120000_full_financial_products; 1 row (2026-01-25).';
COMMENT ON TABLE public.clients IS
'Shop clients (customers) with contact details, privacy flag and blur level (grain: one client); 2 tables key to it. Created by 20251122_timeline_comprehensive_integration; read by mcp-connector and _shared. Contact columns are private.';
COMMENT ON TABLE public.vehicle_wiring_overlays IS
'Per-vehicle wiring overlay: one row per vehicle with factory generation, wiring tier, applied upgrades, circuit totals and cost range (grain: one vehicle overlay); vehicle_custom_circuits keys to it. Writers: compute-wiring-overlay (pipeline_registry owner), scripts/create-k5-wiring-overlay.mjs; SQL mark_wiring_overlay_stale. Created 2026-03-23.';
COMMENT ON TABLE public.portfolio_stats_cache IS
'Cached platform-wide portfolio totals (vehicles, value, for sale, auctions, daily sales) (grain: one row, overwritten). Writer: SQL refresh_portfolio_stats_cache; read by feed-query.';
COMMENT ON TABLE public.parts_reception IS
'Parts orders received from suppliers with PO, quantities, dates and condition on arrival (grain: PO x part). Created by 20251122_timeline_comprehensive_integration; 1 row (2025-11-21).';
COMMENT ON TABLE public.work_session_parts IS
'Parts recorded in a work session, with cost, vendor and the receipt image they were read from (grain: work session x part). Named by auto-sort-photos; 1 row (2026-02-06).';
COMMENT ON TABLE public.business_ownership IS
'Owners of an organization with share, type and title (grain: organization x owner). Created by 20250915000001_create_business_entities; SQL create_initial_business_ownership. Read 685 times since the statistics reset. 1 row.';
COMMENT ON TABLE public.insurance_partners IS
'Insurance partner definitions with endpoint and supported products (grain: one partner). Created by 20260125120000_full_financial_products; 1 row (2026-01-25). api_key_encrypted is a credential.';
COMMENT ON TABLE public.photo_sync_state IS
'State of the Apple Photos sync daemon per user (last processed photo, last poll and upload, daemon version and host, counts) (grain: one user, overwritten). Created by 20260211100000_photo_auto_sync_system; written by scripts/photo-auto-sync-daemon.py.';
COMMENT ON TABLE public.profile_image_insights IS
'AI insights over a batch of a vehicle''s images (summary, condition, estimated value, labor hours) (grain: image batch x day). Created by 20251101000001_create_profile_image_insights; 1 row (2025-11-10).';
COMMENT ON TABLE public.image_angle_spectrum IS
'3D camera position of an image relative to the vehicle (x, y, z, distance, zone, canonical angle) (grain: one image observation). Created by 20250128000006_3d_angle_spectrum_system; 1 row.';
COMMENT ON TABLE public._identity_backfill_model_map IS
'Scratch map of vehicle_id to canonical model, series and generation from an identity backfill; empty. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public._seller_extract IS
'Scratch list of listing_url to seller; empty. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.concierge_inquiries IS
'Concierge inquiries: one row per inbound request with subject, message, contact, intent and routing status (grain: one inquiry); concierge_messages keys to it. No writer in the repo; rows 2026-07-15 .. 2026-07-27. contact is private.';
COMMENT ON TABLE public.zz_backup_jz_profile_build_20260721 IS
'Backup copy of organizations rows taken on 2026-07-15 before a profile build. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.user_sites IS
'Confirmed work sites of a user from the iOS capture app (name, coordinates, radius, source) used by the GPS shop gate (grain: user x site). Created by 20260611050100_user_sites; rows 2026-06-11 .. 2026-06-12. Location is private.';
COMMENT ON TABLE public.vehicle_pulse IS
'Current headline state per vehicle for the live board (mode, headline kind and amount, live state, ends_at, live bid, bid count) (grain: one vehicle, overwritten). Writer: SQL arbitrate_vehicle_pulse (20260622000000_vehicle_pulse_arbiter). A derived state row, not a log.';
COMMENT ON TABLE public.zz_backup_villa_cleanup_20260705_community_events IS
'Backup copy of community_events taken before the 2026-07-05 villa cleanup. No code refers to it. Candidate for the scratch-table drop list (plan lane H).';
COMMENT ON TABLE public.harness_designs IS
'Wiring harness designs: one row per design with vehicle, build, ECU and PDM platform, template and canvas state (grain: one design); harness_endpoints keys to it. No writer in the repo; read 422,389 times since the statistics reset. Rows 2026-03-06 .. 2026-03-12.';
COMMENT ON TABLE public.parts_fitment IS
'Fitment rules of parts_catalog parts by year range, make, model and engine pattern (grain: part x fitment rule). Seeded by 20260617150000_seed_observed_k5_parts; rows 2026-05-24 .. 2026-06-18.';
COMMENT ON TABLE public.electrical_system_catalog IS
'Reference catalog of vehicle electrical systems with typical amperage, wire gauge, connector and wire color (grain: one system). No writer in the repo; all rows 2026-03-04.';
COMMENT ON TABLE public.partnership_ad_permissions IS
'Brand partnership ad permissions per organization (Instagram handle, permission kind, status, grant and expiry, ad code, disclosure) (grain: org x brand permission). No writer in the repo.';
COMMENT ON TABLE public.concierge_messages IS
'Messages in a concierge inquiry thread (grain: inquiry x message). No writer in the repo. Event and ingest time = created_at (2026-07-15 .. 2026-07-27). Private.';
COMMENT ON TABLE public.concierge_partner_invitations IS
'Invitations for partners to connect a concierge channel: one row per invitation with token hash, scope, expiry and redemption (grain: one invitation). No writer in the repo; all rows 2026-07-02. token_hash is a credential hash; contact is private.';
COMMENT ON TABLE public.user_vehicle_discoveries IS
'Vehicles a user found on a listing platform (price, location, seller and title as discovered, interest) (grain: user x listing). Named by edge function ingest; rows 2026-02-28 .. 2026-07-02.';
COMMENT ON TABLE public.brand_partnerships IS
'Brand partnerships of a publication (type, dates, recurrence, value, deliverables) (grain: one partnership). No writer in the repo. Amounts are private.';

COMMIT;
