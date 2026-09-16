# NUKE CAPABILITY MAP — "how do I do X here?"

**Consult this BEFORE writing any function, table, queue, page, or script.** Column 2 is THE entrypoint — extend it. Column 3 is the graveyard of duplicates — never call, never resurrect, never imitate.

Generated 2026-07-12 from the Canonical Ledger (`CANONICAL_LEDGER.md`, `ledger.json`). Collisions merged across all 13 subsystem lanes (83 raw collision records → 74 deduped capabilities below, plus single-owner capabilities listed for completeness).

⚠ = deployed-only zombie whose source is deleted from the repo: recover source from git history before touching; never run a "clean up missing functions" sweep.
† = contested between lanes; verify deployment/rows before relying on it (see CONTESTED RULINGS in CANONICAL_LEDGER.md).

| Capability | USE THIS (canonical) | AVOID (duplicates / traps) |
|---|---|---|
| **INGESTION / EXTRACTION** | | |
| Ingest ANY listing URL / unknown source | `ingest` edge fn (`nuke.ingest()`) | smart-extraction-router (ghost — map wrongly calls it the entry point), scrape-vehicle (undeployed; AddVehicle.tsx call is broken), process-url-drop, micro-scrape-bandaid, store-auction-listing (zombies) |
| Route/drain import_queue | `process-import-queue` | continuous-queue-processor, extract-premium-auction, unified-scraper-orchestrator (zombie), re-extract-pending-vehicles, process-cl-queue |
| Enqueue extraction work | insert into `import_queue` table | bulk-enqueue-inventory-extraction (ghost), org-specific sync queues |
| BaT listing extraction | `extract-bat-core` THEN `extract-auction-comments` (two-step) | complete-bat-import (undeployed, 404s; 3 FE callers broken), sync-bat-listing (zombie), bat-simple-extract (ghost), extract-premium-auction |
| BaT queue drain | `process-bat-extraction-queue` (active cron */5) | bat-queue-worker |
| BaT URL discovery | `bat-url-discovery` (active daily cron) | bat-year-crawler, crawl-bat-active (ghost) |
| BaT profile pages | `extract-bat-profile-vehicles` | process-profile-queue (wrapper, 0 callers) |
| Auction comment extraction | `extract-auction-comments` → `auction_comments` table | backfill-comments, analyze-auction-comments (deleted); bat_comments table DOES NOT EXIST |
| Re-extract from archived snapshots | `batch-extract-snapshots` (reads listing_page_snapshots) | bat-snapshot-parser, process-orphan-snapshots, backfill-*-descriptions zombies |
| Facebook Marketplace ingestion | `extract-facebook-marketplace` + `refine-fb-listing`; operational lane = com.nuke.fb-* launchd fleet + fb-scraper skill | import-fb-marketplace, fb-marketplace-orchestrator, monitor-fb-marketplace, fb-marketplace-sweep/bot-scraper (ghosts), root fb-* dumps |
| Craigslist | `extract-craigslist` via import_queue | process-cl-queue, discover-cl-* (dead) |
| Bonhams | `extract-bonhams` | extract-bonhams-typesense |
| Cars & Bids comments/bids | `extract-cars-and-bids-comments` | extract-cab-bids |
| Generic AI extraction fallback | `extract-vehicle-data-ai` | haiku-extraction-worker (agent lane only), extract-vehicle-data-ollama / extract-with-playwright (ghosts) |
| Per-source auction/classified extraction | the extract-* fn routed by process-import-queue (hagerty, pcarmarket, mecum, barrett-jackson, gooding, rmsothebys, broad-arrow, bh-auction, gaa, ebay-motors, barn-finds, jamesedition, classiccars) | any new per-source fn; import-classic-auction + extract-specialty-builder (routed but UNDEPLOYED — 404 traps) |
| New-source onboarding | `onboard-source` | scrape-organization-site, auto-site-mapper lane (ghosts) |
| Extraction health monitoring | `extraction-watchdog` (manual/admin; cron dormant) | check-scraper-health, data-quality-monitor (deleted) |
| Extraction quality gating | `_shared/extractionQualityGate.ts` (qualityGate() in ingest) | extraction-quality-validator (ghost) |
| **AI / VISION** | | |
| Image → make/model/angle (tier-0) | `yono-analyze` → `yono-classify` → local sidecar | analyze-image / vision-analyze-image / yono-batch-process (deleted; map still says analyze-image is "the gateway"), identify-vehicle-from-image (cloud — external MCP/cockpit only) |
| Analysis engine / signals | `analysis-engine-coordinator` (drains analysis_queue → analysis_signals) | api-v1-analysis (unadvertised read wrapper) |
| Comment analysis / sentiment | `analyze-comments-fast` + `batch-comment-discovery`; ledger = `comment_discoveries` | update-live-sentiment (dead), discover-comment-data (deleted); NEVER mint a new sentiment store — reuse vehicle_sentiment |
| Description mining | `discover-description-data`; ledger = `description_discoveries` | analyze-vehicle-description (deleted) |
| User-billed AI chat (BYOK funnel) | `analyze-with-claude` (+ `set-ai-provider` config) | image-ai-chat (image-scoped only, not the general funnel) |
| Public vision API | `api-v1-vision` | — |
| Image validation | `validate-vehicle-image` † | validate-bat-image (deleted) |
| AI training-data export | `yono/` root dir scripts (export_nuke_training_data.py) | export-training-batch (deleted); ai_training_exports table DOES NOT EXIST |
| **PLATFORM** | | |
| System status / DB stats | `db-stats` | system-health-monitor, pipeline-dashboard, queue-status, platform-status, data-quality-monitor (map claim FALSE) |
| Queue-health brief | `ralph-wiggum-rlm-extraction-coordinator` `{action:'brief'}` | queue-status, extraction-watchdog, deleted ralph/agent fleet ×9 |
| Site search backend | `universal-search` | api-v1-search (docs page only), `search` (deleted) |
| Derived-field recompute (metric/completion/value/stats) | `drain_vehicle_*_queue()` SQL routines via per-minute crons; enqueue into `vehicle_*_recompute_queue` | legacy backfill edge fns (backfill-profile-stats, backfill-quality-scores — deleted); calculate-profile-completeness (undeployed) |
| Derivation dispatch (registry-routed extractors) | `derive-dispatch` (cron */10) + observation_extractors registry | hand-rolled dispatch |
| Computed-field ownership | query `pipeline_registry` BEFORE writing any computed field | — |
| Cron liveness check | `cron.job WHERE active=true` (18 of 136) | trusting any inactive cron row as evidence of life |
| Table row counts | `count(*)` | pg_stat n_live_tup (stale after stats resets) |
| **VEHICLE INTELLIGENCE** | | |
| Vehicle valuation compute | `compute-vehicle-valuation` | compute_vehicle_value SQL + value-queue cron (scheduled no-op), run_valuation_batch_by_quality, api-v1-valuations / price-analytics (ghost deploys) |
| Valuation storage | `nuke_estimates` (776k rows) | vehicle_valuations (0 rows), vehicle_valuation_feed / clean_vehicle_prices MVs (0 rows), vehicle_valuations_components + vehicle_price_baselines (DO NOT EXIST) |
| VIN decode | `batch-vin-decode` | decode-vin-and-update (0 callers), extract-vin-from-vehicle (undeployed), vin_decode_cache (empty), vin_decoded_data (never written) |
| Profile completeness | `calculate_vehicle_completion_algorithmic` via drain cron | calculate-profile-completeness (undeployed edge fn) |
| Live auction sync | `sync-live-auctions` (cron */15) | sync-live-auction (singular; undeployed) |
| Market trends (public API) | `api-v1-market-trends` + get_market_trends | calculate-market-trends (0 callers), calculate-market-indexes (undeployed, empty tables), market-spread-calculator / price-analytics (ghosts) |
| Auction trend aggregates (admin) | `auction-trends-stats` + `get_auction_trends_v2` (/trends) | auction-intelligence (deleted) |
| Market aggregate substrate | `mv_market_pulse` + `marketplace_metro_pulse` + `marketplace_velocity` (actively refreshed) | market_indexes, market_segment_stats_cache (0 rows) |
| Treemap market-share data | `treemap_*` SQL routines via direct supabase.rpc(); refresh = reactivate `treemap-refresh` cron → treemap_refresh_all() † | treemap-vehicles wrapper †, treemap-data (deleted); do NOT build a new refresh path |
| Geo/map feed | `map-vehicles` | treemap-vehicles †, geocode-vehicle-locations (ghost) |
| Comps | `api-v1-comps` | — |
| Vehicle scores | `calculate-vehicle-scores` (pipeline_registry owner of perf_*_score) | calculate-advanced-metrics (deleted; marketIndexService ref broken) |
| Enrichment (specs/MSRP/bulk) | `enrich-factory-specs`, `enrich-msrp`, `enrich-bulk` | enrich-listing-content, enrich-collection-intelligence (ghost deploys) |
| Hammer prediction | DORMANT — `hammer_predictions` ledger; open prediction matures 2026-07-15; do NOT archive predict-hammer-price before then | backtest-hammer-simulator, market-proof, batch-market-proof (retired) |
| **DEAL FLOW / MONEY** | | |
| Create ownership transfer on sale | `auto_create_transfer_on_auction_close` trigger → `transfer-automator` ⚠ | backfill_transfers_for_sold_auctions (manual repair only) |
| Transfer state read / advance | `transfer-status-api` ⚠ / `transfer-advance` ⚠ | direct .from('ownership_transfers') reads scattered in FE |
| Transfer storage | `ownership_transfers` + `transfer_milestones` | — |
| Stripe checkout (API subscription) | `create-api-access-checkout` | stripe-checkout (orphan deploy — undeploy), ds-create-checkout (deleted) |
| Stripe checkout (credits/cash) | `create-checkout` | create-vehicle-transaction-checkout (its table DROPPED — runtime-broken) |
| Stripe payment-method setup | `setup-payment-method` | create-setup-session (undeployed; ProfileVerification broken) |
| Stripe event handling | `stripe-webhook` | — |
| API keys | `api-keys-manage` + `api_keys` table | — |
| Payment facts | `payment_events` table | vehicle_transactions / vehicle_financial_transactions / user_wallets (DROPPED) |
| Deal jackets / doc forensics | `deal-jacket-pipeline` (dormant; reactivate cron if needed) | forensic-deal-jacket, decompose-deal-jacket, deal-brief, ds-* suite (deleted) |
| Bidding / auto-buy / exchange / trading | CAPABILITY RETIRED 2026-03 | place-bid-with-deposit (auctionPaymentService still calls it — broken), execute-auto-buy, place-market-order, trading, paper-trade-autopilot, api-v1-exchange, update-exchange-prices (map's cron claim FALSE) |
| Vehicle shipping | CAPABILITY RETIRED | create-shipping-listing, send-shipping-notification, shippingService.ts, ShippingNotificationManager.tsx |
| **ORGS & IDENTITY** | | |
| Create/enrich org from URL | `create-org-from-url` | update-org-from-website (no live path), ingest-org-complete, scrape-organization-site, classify-organization-type, extract-organization-from-seller ⚠ |
| Org read model | `organizations` table directly | org_profiles / organizations_compat views (0 refs), organization_profiles (DROPPED) |
| Org↔vehicle links | `organization_vehicles` | — |
| Identity graph (who-is-who cross-platform) | `external_identities` table (573k, written daily) | identity_nodes/edges (DROPPED), build-identity-graph, discover-entity-graph (deleted) — NEVER re-mint a graph layer |
| Identity search & claim | `search-identities` + /claim-identity page | — |
| Seller statistics | `compute-org-seller-stats` (reactivate its cron if needed) | seller_intel_rollup cron (inactive), organization_seller_stats (0 rows), api-v1-seller-stats / enrich-seller (orphan deploys) |
| Org inventory extraction | import_queue extraction lane | organization_inventory_sync_queue (fills, never drains), index-classic-com-dealer ⚠, process-classic-seller-queue, extract-all-orgs-inventory |
| Org dedup / merge | `auto-merge-duplicate-orgs` — DEPLOY IT FIRST (currently undeployed, live callers 404) | re-implementing merge fresh |
| Org due diligence | `generate-org-due-diligence` † (verify deployed) | — |
| ECR collections | CAPABILITY DELETED | all ecr_* fns/tables |
| **DOCUMENTS** | | |
| Receipt extraction | `receipt-extract` (DEPLOY FIRST — on disk, undeployed) | process-receipt (orphan deploy), smart-receipt-linker ⚠, receipt-photo-ocr / receipt-llm-validate (deleted) |
| Receipt storage | `receipts` + `receipt_items` | vehicle_receipts (0 rows) |
| Per-vehicle documents | `vehicle_documents` | documents (3 rows), deal_documents (dormant); secure_documents = sensitive docs only |
| Document OCR | `document-ocr-worker` + `document_ocr_queue` (dormant — reactivate, don't mint) | extract-pdf-text, part-number-ocr, ds-extract-document (deleted, dangling refs) |
| Reference/manual indexing | `scripts/ingest-service-manual.py` + `scripts/library_ingest_to_db.py` → service_manual_chunks / library_documents | parse-reference-document, index-reference-document (undeployed; Library.tsx call broken), index-service-manual (deleted) |
| Title scan | `extract-title-data` | vault-* suite (deleted); vehicle_title_documents DOES NOT EXIST |
| Manual page serving | `get-manual-pages` | vehicle_manuals / vehicle_manual_links (DO NOT EXIST) |
| **PHOTOS** | | |
| Photo pipeline drain | `photo-pipeline-orchestrator` (cron */5) + `reset_stuck_photo_pipeline_images` (cron */15) | process-all-images-cron (NO cron despite name), trickle-backfill-images, photo-sync-orchestrator (deleted) |
| Photo upload intake | `image-intake` | nuke-box-upload (deleted; process-file-upload ref broken) |
| EXIF extraction | `derive-image-exif` (registry-routed via derive-dispatch) | reprocess-image-exif (deleted) |
| Listing-image backfill on import | `backfill-images` (import path only) | trickle-backfill-images, retry-image-backfill, backfill-image-angles (deleted; AdminMissionControl button broken) |
| Mac Photos library sync | `scripts/photo-sync-daemon.mjs` (launchd ag.nuke.photo-sync) → image_identities → image_appearances; manual album intake = `scripts/iphoto-intake.mjs` | photo_sync_album_manager.py twins, ingest-photo-library (deleted), NukePhotoSync.app (unused bundle) |
| Image ↔ vehicle match validation | `check-image-vehicle-match` | match-vehicles-by-images (deleted; vehicleImageMatcher.ts ref broken), dedup-vehicle-images (0 callers) |
| Image storage | `vehicle_images` (39.7M rows); angle = `vehicle_images.angle` COLUMN | vehicle_image_angles table (0 rows); vehicle_image_tags/likes/facts/assets DO NOT EXIST (tags is queried by universal-search/tagService — broken; do not create the table without a design decision) |
| Upload-triggered analysis | `auto-analyze-upload` → yono-analyze | batch-analyze-vehicle (deleted) |
| Photo bundles | `auto-create-bundle-events` + `suggest-bundle-label` | — |
| **COMMS & NOTIFICATIONS** | | |
| User notifications | insert into `user_notifications` (the only table the FE reads) | notifications, notification_events/preferences/templates, duplicate_notifications (0-row quintet), create-notification (zombie) |
| Admin notifications | `admin_notifications` | — |
| Email reply / agent email / invoices | `reply-email`, `agent-email`, `send-invoice-email` | inbound-email, send-inquiry-notification (zombies) |
| Outbound webhooks | `webhooks-manage` — REGISTRATION ONLY; delivery is dead and tables webhook_endpoints/deliveries DO NOT EXIST (half-capability) † | webhooks-deliver (zombie) |
| Transaction SMS | `send-transaction-sms` ⚠ (live FE path, source deleted — restore first) | all other sms-* fns (dead) |
| Telegram / bots | CAPABILITY RETIRED (map's "@Sss97133_bot running" is FALSE) | telegram-* ×6, nuke-data-bot/tech-bot/nukeproof-bot/nuke-mini |
| Conversational DB access | `mcp-connector` (prod /mcp per vercel.json) | nuke-data-bot (folded into mcp-connector 2026-03-20), mcp/ + mcp-servers/ root dirs |
| Concierge | EXTERNAL REPO `/Users/skylar/lofficiel-concierge` (concierge-ground/house/partner) — never mint concierge code in nuke | nuke-repo concierge-notify/-webhook/-villa-discovery (deleted) |
| **RESTORATION / WORK** | | |
| Work record ledger | `work_sessions` table — write via `create-work-session-from-evidence` (UI) or mcp-connector `confirm_work_session` (agent) | `work-session` fn (ZERO callers — trap name), work_orders + 7 satellites (0 rows ever), vehicle_jobs, work-intake-batch / sms-work-intake / telegram-restoration-bot / intelligent-work-detector (deleted) |
| Auto work-log from photos | `photo-pipeline-orchestrator` inline logic | generate-work-logs (2,002 LOC; both callers repointed off it 2026-07-06) |
| Parts catalog | `catalog_parts` (10,853 rows) | parts_catalog (different grain — reference-doc surfaces; don't add parts), ebay_parts_catalog, vehicle_suggested_parts (0 rows) |
| Parts recommendations | `recommend-parts-for-vehicle` † | — |
| Wiring computation (BOM/cut-list/diagram/quote) | `nuke_frontend/src/components/wiring/harnessDerivation.ts` (client-side; what WiringPlan actually renders) | server chain: generate-harness-spec, generate-wiring-bom, generate-wiring-quote, query-wiring-needs, compute-wiring-overlay (1 row ever); wiring_* tables all empty; wiring_connections DOES NOT EXIST |
| Work-order statement | `WorkOrderStatement.tsx` (/work-orders/statement) | DailyWorkOrder.tsx (unrouted, unimported) |
| K5 wiring state | `docs/wiring/K5_WIRING_STATE.md` + wiring/ dir + npm k5:* scripts | — |
| **INVESTOR / BUSINESS** | | |
| Fractional offerings schema (if ever revived) | `vehicle_offerings` + share_holdings + market_orders (extend this FK family) | investor_offerings (NEVER EXISTED — map fiction), InvestorDashboard/InvestorOffering (deleted, "feature retired") |
| Investment contracts | NONE — custom_investment_contracts is a FABRICATED $150M demo; never resurrect as substrate | contract_assets |
| Data census | dead; if revived: `mv_vehicle_census` + reactivate refresh-vehicle-census cron | source_census (producer deleted), record_census/get_latest_census |
| Daily ops report | none live (daily-report doubly dead: dormant cron + calls deleted get_queue_summary RPC) | daily-report |
| Acquisition pipeline | `acquisition_pipeline` schema exists + /pipeline page — 0 rows ever; make a product decision before writing code | acquire-vehicle assumptions of live data |
| **FRONTEND PAGES** | | |
| Vehicle list/dashboard | `VehiclesDashboard.tsx` (/vehicle/list) | Vehicles.tsx (2,262 LOC, unrouted) |
| Vehicle detail | `VehicleProfile.tsx` (/vehicle/:id) — THE convergence point + its 10 subpages | any new vehicle-detail surface |
| Own-user profile | `UserProfile.tsx` (/profile, /u/:handle) | Profile.tsx, Profile.legacy.tsx (both unrouted) |
| Live floor | `src/live/LiveFloor.tsx` (/live) | pages/LivePage.tsx |
| Logged-out front door | `pages/intake/IntakePage.tsx` (F6 canon) | landing/LandingPage.tsx (?legacy_landing=1 only) |
| Admin hub | `pages/admin/AdminHome.tsx` (/admin) | AdminDashboard.tsx (survives as /admin/reviews only), AdminMissionControl |
| Admin scraper dashboard | `admin/UnifiedScraperDashboard.tsx` | ScraperDashboard, SourcesDashboard, KSLScraper |
| Admin health dashboard | `SystemStatus.tsx` (/admin/status) | AdminPulse, DataPulse |
| Org/place profile | `OrganizationProfile.tsx` (/org/:orgId) | Place.tsx, SubjectProfile.tsx (unrouted) |
| Any new admin/list/landing page | DON'T — 59 routed-but-unlinked pages exist; search routes/ first | minting page N+1 |
| **REPO / OPS** | | |
| MCP server | `supabase/functions/mcp-connector` (prod); desktop package = mcp-server/ | mcp/ (Oct-25), mcp-servers/ (Mar-26) |
| Status / work logging | `DONE.md` via `claude-log-done` + docs/ for durable docs | root status-report .md files (35 dead examples) |
| Scratch / staging output | `output/` (facts must still land in Nuke DB) | tmp/, root JSON/HTML dumps, new report .md files |
| Frontend build output | `nuke_frontend/dist` (vercel.json outputDirectory) | root dist/ |
| Agent loop coordination | `.claude/` (HANDOFF.md, agents/active, checkpoints) | `.ralph/` + root symlinks (frozen 2026-03-10 — NOT the live ralph coordinator edge fn) |
| Photo-sync ops | `~/.nuke/run-photo-sync.sh` via ag.nuke.photo-sync launchd | NukePhotoSync.app |
