# NUKE CANONICAL LEDGER

**Generated 2026-07-12** from per-subsystem rulings by agents that read the real code (repo `supabase/functions/`, `nuke_frontend/src/`, router files, scripts, launchd), the live deployment list (286 deployed edge functions), and the live DB (pg_cron, pg_stat, direct `count(*)`).

## THE ONE RULE

> **Before you build anything, look here. If a CANONICAL asset exists for the capability, EXTEND it. Never mint a new function, table, page, queue, or script for a capability that already has a canonical owner.** See `CAPABILITY_MAP.md` in this dir for the fast lookup, and `ledger.json` for machine-readable form.

Verdicts:
- **CANONICAL** — the one true implementation. Extend this.
- **LIVE-SECONDARY** — works, but a canonical alternative exists. Don't build on it.
- **HALF-BUILT** — wired on one side only (undeployed fn with live callers, empty table with live readers, etc.). Needs a decision, not a fresh implementation.
- **DEAD** — deleted, ghost (map-only), zombie (deployed w/o source), or 0-rows-0-writers. Never call, never resurrect without explicit decision.

Cross-cutting truths that every subsystem confirmed:
1. **`CODEBASE_MAP.md` (2026-02-26) is ~half fiction.** 397 function dirs existed then; 204 now. It names dozens of deleted functions as canonical and lists tables that were dropped or never created. Treat this ledger, not the map, as inventory.
2. **Deployment ≠ liveness.** ~40 functions are deployed with their source deleted from the repo ("zombies"). A few zombies are LOAD-BEARING (transfer-automator/advance/status-api, send-transaction-sms, smart-receipt-linker, extract-organization-from-seller) — their source exists only in git history + the deployed copy. Never run a "clean up undeployed/missing functions" sweep.
3. **cron.job has 136 rows; only 18 are active.** An inactive cron row is not evidence a function is live.
4. **pg_stat n_live_tup lies after stats resets.** Use `count(*)` (this bit the treemap MVs and ownership_transfers).
5. **The live skeleton is small**: 18 active crons + a handful of request-driven functions + per-minute SQL drain routines. Almost everything else is shell.

---

## SCOREBOARD

| Subsystem | Canonical | Live-secondary | Half-built | Dead | Uncertain | Total |
|---|---|---|---|---|---|---|
| EXTRACTION | 39 | 10 | 4 | 66 | 0 | 119 |
| AI / VISION (YONO) | 25 | 2 | 1 | 25 | 0 | 53 |
| PLATFORM / INFRA | 32 | 20 | 4 | 32 | 4 | 92 |
| VEHICLE INTELLIGENCE | 31 | 2 | 8 | 31 | 0 | 72 |
| DEAL FLOW / TRADING | 17 | 2 | 16 | 40 | 2 | 77 |
| ORGS & IDENTITY | 9 | 8 | 7 | 60 | 2 | 86 |
| DOCUMENTS & VAULT | 11 | 9 | 12 | 32 | 0 | 64 |
| PHOTOS | 13 | 2 | 5 | 20 | 0 | 40 |
| COMMS & BOTS | 16 | 0 | 3 | 50 | 0 | 69 |
| RESTORATION / WORK | 7 | 9 | 15 | 30 | 0 | 61 |
| INVESTOR / BUSINESS | 9 | 3 | 11 | 13 | 0 | 36 |
| FRONTEND (pages) | 69 | 59 | 0 | 8 | 0 | 136 |
| REPO HYGIENE | 13 | 8 | 1 | 25 | 5 | 52 |
| **TOTAL** | **291** | **134** | **87** | **432** | **13** | **957** |

45% of everything audited is DEAD. The canonical core that actually runs the platform is roughly 30 functions, ~20 tables, ~10 SQL routines, and 18 crons.

---

## THE 18 ACTIVE CRONS (the living skeleton)

| Cron | Target | Cadence |
|---|---|---|
| poll-listing-feeds | poll-listing-feeds fn | */15min |
| bat-daily-discovery | bat-url-discovery fn | daily 06:00 |
| bat-extraction-queue-slow | process-bat-extraction-queue fn | */5min |
| photo-pipeline-drain | photo-pipeline-orchestrator fn | */5min |
| photo-pipeline-reset-stuck | reset_stuck_photo_pipeline_images() | */15min |
| derivation-queue-drain | derive-dispatch fn | */10min |
| sync-live-auctions (488) | sync-live-auctions fn | */15min |
| drain_vehicle_metric/completion/value/stats_queue (474–477) | SQL routines | every minute |
| cleanup_ended_auctions (424) | SQL routine | hourly |
| pipeline_heartbeat (486) | SQL routine | 6h |
| refresh-market-views (491, 492) | marketplace_metro_pulse / velocity / mv_market_pulse | */20–30min |
| retention: app_events (480), field_extraction_log (417) | SQL | nightly |

Everything downstream of these is alive; anything whose only driver is one of the other 118 (inactive) cron rows is dormant or dead.

---

## 1. EXTRACTION

**Live core:** three active crons (bat-url-discovery, process-bat-extraction-queue, poll-listing-feeds) + universal `ingest` endpoint driving the two-step BaT pipeline (`extract-bat-core` → `extract-auction-comments`), with `process-import-queue` as the ONE router to ~15 deployed per-source extractors and `extract-vehicle-data-ai` as fallback. Living tables: import_queue (265k), bat_listings (11k), auction_comments (105k), marketplace_listings (116k), listing_feeds, listing_page_snapshots.
**Dead shell:** three layers — ~30 CODEBASE_MAP ghost names (incl. `smart-extraction-router`, which the map wrongly calls the entry point; `ingest` replaced it), ~24 zombie deployments from the Mar-2026 triage, and on-disk-but-undeployed code that live routing/UI still wires into 404s.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| ingest | fn | Universal URL/text/batch entry; called by poll-listing-feeds cron, agent-chat, imessage-router, api-v1-events |
| poll-listing-feeds | fn | ACTIVE cron */15; writes listing_feeds + import_queue |
| process-bat-extraction-queue | fn | ACTIVE cron */5; drains bat_extraction_queue |
| bat-url-discovery | fn | ACTIVE daily cron; feeds bat_extraction_queue |
| extract-bat-core | fn | THE BaT extractor (2,498 LOC, 15 callers); identity/spec only |
| extract-auction-comments | fn | Comment half of the BaT two-step; feeds auction_comments |
| process-import-queue | fn | THE import_queue router → 17 source extractors + AI fallback |
| extract-vehicle-data-ai | fn | Generic AI fallback extractor (10 callers) |
| extract-facebook-marketplace + refine-fb-listing | fn | FB lane, redeployed 2026-07-08; refine invoked over HTTP by fb-scraper skill |
| Per-source extractors | fn | extract-craigslist, extract-cars-and-bids-core/-comments, extract-hagerty-listing, import-pcarmarket-listing, extract-mecum, extract-barrett-jackson, extract-gooding, extract-rmsothebys, extract-bonhams, extract-broad-arrow, extract-bh-auction, extract-gaa-classics, extract-ebay-motors, extract-barn-finds-listing, extract-jamesedition, import-classiccars-listing — all routed by process-import-queue |
| batch-extract-snapshots | fn | THE multi-source snapshot re-parser (idle, sole standard impl) |
| extract-bat-profile-vehicles | fn | BaT profile pages; called by frontend + queue |
| onboard-source, extraction-watchdog | fn | Sole implementations (idle; watchdog cron dormant) |
| import_queue | table | 265k rows, 6M reads — extraction spine |
| listing_page_snapshots | table | archiveFetch() target for every external fetch |
| bat_listings, bat_extraction_queue, auction_comments, listing_feeds, marketplace_listings, field_extraction_log | table | The living ledgers (auction_comments is testimony — never delete/overwrite) |

### Live-secondary (don't build on)
continuous-queue-processor (dup router, no cron), extract-premium-auction (3rd router), bat-snapshot-parser, backfill-comments, extract-bonhams-typesense, extract-cab-bids, haiku-extraction-worker (agent lane), import-fb-marketplace, process-cl-queue, process-profile-queue.

### Half-built (broken wiring — fix or strip, don't reimplement)
- **import-classic-auction, extract-specialty-builder** — on disk, ROUTED by process-import-queue, NOT deployed → queue items 404.
- **scrape-vehicle** — 2,670 LOC undeployed; AddVehicle.tsx + ScraperDashboard.tsx still call it (broken UI). Use `ingest`.
- **collecting-cars-discovery** — discovery half only; extractor partner deleted.

### Dead (66) — one-liners
- **Undeployed w/ callers:** complete-bat-import (404 since 2026-07-07; BATListingManager/BaTBulkImporter/VehicleProfileContext still call it), re-extract-pending-vehicles (ScraperDashboard button 404s).
- **Undeployed, no callers:** bat-queue-worker, bat-year-crawler, discover-cl-squarebodies.
- **Deployed, dormant/no callers:** bat-price-propagation, process-classic-seller-queue, fb-marketplace-orchestrator, monitor-fb-marketplace.
- **Zombies (deployed, source deleted):** sync-bat-listing, bat-extraction-test-harness, hagerty-bid-tracker, unified-scraper-orchestrator, extract-blocket/leboncoin/thesamba/rennlist/historics-uk/victorylap/ksl/wayback, micro-scrape-bandaid, process-orphan-snapshots, process-url-drop, store-auction-listing, register-auction-monitor, migrate-snapshots-to-storage, backfill-cl-asking-price/-descriptions, backfill-gooding/mecum/rmsothebys-descriptions, backfill-vin-from-snapshots.
- **Ghosts (CODEBASE_MAP only, exist nowhere):** smart-extraction-router, bat-simple-extract, crawl-bat-active, bat-multisignal-postprocess, cab-url-discovery, fb-marketplace-sweep/-bot-scraper, message-fb-seller, discover-cl-muscle-cars, scrape-all-craigslist-squarebodies, extract-collecting-cars(+simple), discover-ebay-parts, forum lane ×4, barn-finds-discovery, extract-vehicle-data-ollama, extract-with-playwright, extract-with-proof-and-backfill, extract-using-catalog, bulk-enqueue-inventory-extraction, crawler lane ×5, extraction-quality-validator, save-extraction-comparison.
- **Tables:** bat_crawl_state, bat_scrape_jobs (0 rows); bat_comments (DOES NOT EXIST — comments live in auction_comments).

---

## 2. AI / VISION (YONO)

**Live core:** (1) analysis-engine-coordinator loop (via derive-dispatch cron; analysis_queue written TODAY; 1.25M analysis_signals); (2) YONO chain (yono-analyze → yono-classify → local sidecar) on the photo-pipeline cron, currently held by `NUKE_ANALYSIS_PAUSED`; (3) June-2026 BYOK funnel (analyze-with-claude, set-ai-provider, api-v1-vision).
**Dead shell:** CODEBASE_MAP §2 itself — 21 of its 34 functions were deleted Mar-2026 (incl. "analyze-image is the gateway"; the gateway is yono-analyze), 2 of its 9 tables no longer exist. The discovery pipelines are dormant but their ledgers are live-read canonical substrate — **reuse, never re-mint**.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| analysis-engine-coordinator | fn | The analysis heart; drains analysis_queue → analysis_signals |
| yono-analyze → yono-classify | fn | Tier-0 local vision gateway (YONO before cloud AI) |
| analyze-with-claude | fn | The one user-billed BYOK AI entrypoint (web settings + iOS) |
| api-v1-vision | fn | Public vision API |
| set-ai-provider | fn | BYOK config side |
| enrich-vehicle-profile-ai, analyze-vehicle-documents, image-ai-chat, nlq-sql, generate-vehicle-description, auto-analyze-upload, validate-vehicle-image | fn | Sole implementations with live callers (validate-vehicle-image contested — see Contested section) |
| analyze-comments-fast + batch-comment-discovery | fn | The one comment-analysis impl (dormant cron) — do not mint another |
| discover-description-data | fn | Only description-discovery impl (dormant) |
| analysis_signals (1.25M), analysis_queue (written today), analysis_widgets | table | Live engine substrate |
| comment_discoveries (126k), description_discoveries (124k), observation_discoveries, vehicle_sentiment (126k), vehicle_intelligence (83k) | table | Dormant-write, LIVE-READ ledgers (valuation + frontend read them). Testimony — never delete |
| yono/ | dir | Local YONO model workspace (training, modal runners) |

### Live-secondary
identify-vehicle-from-image (cloud path via MCP/cockpit — violates YONO-first internally), api-v1-analysis (unadvertised read API).

### Half-built
ai_work_assessments (schema + 1 test row, never wired).

### Dead (25) — one-liners
update-live-sentiment (0 callers, target orphaned); deleted Mar-2026: analyze-image, vision-analyze-image, yono-batch-process, export-training-batch (now yono/ scripts), validate-bat-image, batch-analyze-vehicle, analyze-engine-bay, score-vehicle-condition, detailed-component-extractor, discover-comment-data, analyze-auction-comments, aggregate-sentiment, analyze-batch-contextual, analyze-vehicle-description, analyze-work-photos-with-products, analyze-vehicle-tags, analyze-market-signals, intelligence-evaluate, market-intelligence-agent, aggregate-meta-insights, test-gemini; tables: ai_angle_classifications_audit (no live reader/writer; preserve rows), ai_training_exports + auction_sentiment_timeline (DO NOT EXIST in DB).

---

## 3. PLATFORM / INFRASTRUCTURE

**Live core:** the 18 active crons (table above) driving 4 edge functions + the SQL drain-routine family that **replaced edge-function queue workers**; import_queue / pipeline_registry / derivation_queue / four `*_recompute_queue` tables; `db-stats` + ralph coordinator `{action:'brief'}` as the two real status endpoints; `universal-search` as the search backend; get_service_url() building every cron URL.
**Dead shell:** ~33 of 61 map-listed platform functions gone from disk — whole webhook/OAuth-callback layer, agent fleet, monitors, backfills. Webhooks are half-built end-to-end (fn+UI exist, tables don't). Root of repo carries ~111 loose files.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| db-stats | fn | THE stats endpoint (CLAUDE.md quick command, admin UI) |
| ralph-wiggum-rlm-extraction-coordinator | fn | THE queue-health brief ({action:'brief'}) |
| photo-pipeline-orchestrator, process-bat-extraction-queue, poll-listing-feeds, derive-dispatch | fn | The 4 cron-driven functions |
| process-import-queue | fn | Import router (function-to-function invoked) |
| universal-search | fn | The live Search-page backend |
| api-v1-vehicles, api-v1-observations, api-v1-vision | fn | Public API surface |
| get_service_url(), pipeline_heartbeat(), drain_vehicle_*_queue() ×4, reset_stuck_photo_pipeline_images(), cleanup_ended_auctions() | routine | The SQL skeleton (active crons) |
| import_queue, pipeline_registry (9 rows — query before writing computed fields), derivation_queue, vehicle_{metric,completion,value,stats}_recompute_queue, app_events, field_extraction_log, queue_lock_health | table/view | Living substrate. NOTE: real names include `_recompute_` |
| cron.job | table | 136 jobs, 18 active — inactive rows are a ghost layer |
| marketplace_metro_pulse, marketplace_velocity, mv_market_pulse | MV | Actively refreshed |
| AdminHome.tsx, AdminRalphBrief.tsx, ApiKeysPage.tsx, AIAccessPage.tsx + ~32 core routed+linked product pages | page | See FRONTEND section |
| Root config: package.json, vercel.json, middleware.ts, api/, DONE.md, PROJECT_STATE.md, docs/, database/ | file/dir | Deploy + ledger surface |

### Live-secondary
extraction-watchdog, continuous-queue-processor (map's cron claim FALSE), document-ocr-worker, process-cl-queue, process-all-images-cron (name lies — no cron), backfill-images, auto-fix-vehicle-profile, batch-ymm-propagate, live-admin, api-v1-search (docs-only), release_stale_locks() (cron gone — manual only), ~45 routed-but-weakly-linked pages + admin dashboards.

### Half-built
- **webhooks-manage + WebhooksPage** — fn+UI exist; tables webhook_endpoints/webhook_deliveries DO NOT EXIST.
- agent_registry/tasks/configs/messages/registrations — schema survives its deleted agent fleet (rows ≤ 4).
- SubjectProfile.tsx — unrouted yet /subject/ links exist (dangling nav).

### Dead (32) — one-liners
On-disk no-callers: system-health-monitor, pipeline-dashboard, queue-status, enrich-vehicles-cron (no cron despite name), trickle-backfill-images. Deleted from disk: platform-status, check-scraper-health, data-quality-monitor (map still calls it "the system status endpoint" — FALSE), photo-sync-orchestrator, process-content-extraction, 7 backfill fns, 10-fn webhook+OAuth layer, 9-fn ralph/agent fleet, api-v1-listings/makes, search, crawler-scheduler, sms-reminder-scheduler. Tables: import_queue_archive, app_config (0 rows); webhook_endpoints/deliveries, agent_execution_logs, app_settings (DO NOT EXIST). Pages: DailyWorkOrder, LivePage, Place, Profile.legacy, ShopFinancials. Root cruft → see REPO HYGIENE.

### Uncertain (investigate before touching)
output/ (git-tracked, written 2026-07-09 — identify writer), data/ (possible un-ingested substrate), backups/ (1 old dump), 36 loose IMG_* root photos (verify ingested before archiving).

---

## 4. VEHICLE INTELLIGENCE

**Live core:** four per-minute SQL drain crons recomputing derived fields on `vehicles` (921k rows); `compute-vehicle-valuation` writing **`nuke_estimates`** (776k rows, 31k recalcs/week — the REAL valuation ledger, absent from CODEBASE_MAP); `sync-live-auctions` */15 feeding auction_events; three actively-refreshed market MVs.
**Dead shell:** map's valuation tables are phantoms; 15 of its 38 functions deleted (7 still deployed as ghosts); 4 frontend components call deleted functions. Hammer/shard cron layer dormant since 2026-04-25. **Rule: valuations go through compute-vehicle-valuation into nuke_estimates; market reads come from the three pulse MVs; VIN decode is batch-vin-decode; nothing named treemap/index/valuation-feed is real** (treemap contested — see INVESTOR + Contested).

### Canonical

| Asset | Kind | Why |
|---|---|---|
| compute-vehicle-valuation | fn | Sole writer of nuke_estimates; 31k recalcs last 7d |
| nuke_estimates | table | THE valuation ledger (776k rows, 10.4M reads) |
| vehicles | table | The 921k-row spine (534M reads) |
| auction_events, vehicle_price_history, vehicle_live_metrics, vehicle_stats_cache | table | Written today / by active crons |
| vehicle_{completion,metric,stats}_recompute_queue | table | Drained every minute |
| drain_vehicle_completion_queue + calculate_vehicle_completion_algorithmic, drain_vehicle_metric_queue, drain_vehicle_stats_queue + update_vehicle_stats, cleanup_ended_auctions | routine | Own completeness/metrics/stats/auction-close now (NOT edge fns) |
| sync-live-auctions | fn | ACTIVE cron */15 |
| mv_market_pulse, marketplace_metro_pulse, marketplace_velocity | MV | Actively refreshed, 266k rows total |
| api-v1-comps, value-trends, api-v1-market-trends, calculate-vehicle-scores, auction-trends-stats, batch-vin-decode, api-v1-vin-lookup, enrich-factory-specs, enrich-msrp, enrich-bulk, map-vehicles, api-v1-vehicle-history, api-v1-vehicle-auction | fn | Deployed, called, sole implementations |

### Live-secondary
drain_vehicle_value_queue + compute_vehicle_value (scheduled no-op — empty queue; duplicates valuation), run_valuation_batch_by_quality (5 dormant shards).

### Half-built
predict-hammer-price (deleted from disk, STILL DEPLOYED; **open prediction in hammer_predictions matures 2026-07-15 — do not archive before then**), score-live-auctions, calculate-market-indexes (undeployed; marketIndexService.ts broken), auto-detect-vehicle-owner (undeployed; QuickRelationshipEditor broken), treemap-vehicles (contested), vin_decoded_data (read, never written), vehicle_value_recompute_queue (0 writes ever), hammer_predictions.

### Dead (31) — one-liners
Ghost deployments (deleted from disk, still deployed): api-v1-valuations, price-analytics, market-spread-calculator, enrich-listing-content, enrich-collection-intelligence, geocode-vehicle-locations. Deleted w/ BROKEN FE refs: bid-curve-analysis (VehicleBidCard, BidCompareOverlay, BidderProfileCard), calculate-advanced-metrics, split-vehicle-from-source. Deployed 0-callers: decode-vin-and-update, calculate-market-trends. Undeployed: extract-vin-from-vehicle, calculate-profile-completeness (superseded by SQL), sync-live-auction (singular). Others: auction-intelligence, detect-record-prices, data-flag-price-outliers, monitor-price-drops, treemap-data, treemap_refresh_all (dormant cron — see contested). Tables: vehicle_valuations (0 rows, 16k reads of nothing), vehicle_valuations_components + vehicle_price_baselines (DO NOT EXIST), vin_decode_cache, vin_validations, market_segment_stats_cache, vehicle_dynamic_data, market_indexes; MVs clean_vehicle_prices, vehicle_valuation_feed, mv_treemap_* (CONTESTED — Investor lane found them populated).

---

## 5. DEAL FLOW / TRADING

**Live core:** the auction→transfer chain — sync-live-auctions cron → DB trigger `auto_create_transfer_on_auction_close` → deployed `transfer-automator` → ownership_transfers (81k rows, written today) + transfer_milestones (1.46M) → TransferPartyPage (/t/:transferId) + admin TransfersDashboard — plus the money spine: stripe-webhook + create-api-access-checkout + create-checkout + setup-payment-method + api-keys-manage.
**CRITICAL HAZARD:** transfer-automator / transfer-advance / transfer-status-api were **deleted from the repo 2026-03-31 but remain deployed and load-bearing**. Source lives only in git history + deployed copies. Any redeploy-from-disk or cleanup sweep destroys the live transfer system. **Recover source to repo before touching anything transfer-related.**
**Dead shell:** entire exchange/trading layer, DocuSign ds-*, shipping, market-proof — deleted Mar-2026; 11 of 14 map-listed tables DROPPED while the map still advertises them.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| transfer-automator, transfer-advance, transfer-status-api | fn | Live transfer system (DEPLOYED-ONLY SOURCE — see hazard) |
| auto_create_transfer_on_auction_close | routine | The trigger creating today's transfers |
| cleanup_ended_auctions | routine | Hourly cron |
| ownership_transfers (81k), transfer_milestones (1.46M) | table | Written today |
| stripe-webhook | fn | Single Stripe event sink (redeployed 2026-06) |
| create-api-access-checkout | fn | API-subscription revenue path (June 2026) |
| create-checkout | fn | Cash-balance/credits checkout |
| setup-payment-method | fn | Stripe SetupIntent path |
| api-keys-manage + api_keys | fn/table | API key system (7 keys, newest 2026-06-11) |
| payment_events | table | Skylar's real payment substrate (17 rows) |
| deal_contacts | table | Only deal-party contact store |
| TransferPartyPage.tsx, admin/TransfersDashboard.tsx | page | The transfer surfaces |

### Live-secondary
backfill_transfers_for_sold_auctions (manual repair twin), AcquisitionPipeline.tsx (renders empty).

### Half-built (16) — one-liners
acquire-vehicle + acquisition_pipeline (0 rows ever, routed page), create-vehicle-transaction-checkout (deployed; its table vehicle_transactions DROPPED — runtime-broken), create-setup-session (undeployed; ProfileVerification broken), deal-jacket-pipeline + forensic-deal-jacket + deal_jackets family (deal_documents, deal_vehicle_details, deal_ownership, deal_reconditioning — 0 rows, cron dormant, thousands of empty reads), transfer_staleness_sweep (cron inactive), user_cash_balances / payment_card_attribution (0 rows, wired reads), auctionPaymentService.ts (half-broken: bid path calls deleted fn), vehicleTransactionService.ts.

### Dead (40) — one-liners
Deleted fns: execute-auto-buy, place-bid-with-deposit (**dangling caller auctionPaymentService.ts — bidding runtime-broken**), place-market-order, update-exchange-prices (map's "runs every 15min job 212" is FALSE), api-v1-exchange, trading, paper-trade-autopilot, decompose-deal-jacket, deal-wire-automation, deal-brief, ds-* ×5 (ds-extract-document dangling in document-ocr-worker), create-shipping-listing, send-shipping-notification, batch-market-proof, backtest-hammer-simulator (dangling in score-live-auctions). Orphan deploys to undeploy: stripe-checkout, market-proof. DROPPED tables: vehicle_transactions, vehicle_financial_transactions, vehicle_trade_items, vehicle_trades, vehicle_deal_offers, vehicle_bonds, vehicle_funds, user_wallets, auction_bids, auto_buy_executions, work_contracts. 0-row: market_segment_stats_cache, vehicle_offerings, paper_trades, ds_deals, ds_credit_transactions, stripe_connect_accounts. Files: shippingService.ts, ShippingNotificationManager.tsx.

### Uncertain
transfer-email-webhook / transfer-sms-webhook (zombie deploys; external provider wiring unverified).

---

## 6. ORGANIZATIONS & IDENTITY

**Live core:** three tables fed as a **byproduct of the BaT/auction extraction crons** — organizations (5.7k, updated today), organization_vehicles (285k, inserted today), **external_identities (573k, inserted today — THE identity graph; the nodes/edges experiment was deleted, never re-mint it)** — plus the /org UI module and two deployed workhorses (create-org-from-url, search-identities).
**Dead shell:** CODEBASE_MAP §6 — 14 of 25 listed functions deleted, 7 of 8 listed tables DROPPED, all 6 org crons inactive. Two hazard classes: prod-orphan functions (deployed, no source) and live pages calling three UNdeployed functions (silent 404s).

### Canonical

| Asset | Kind | Why |
|---|---|---|
| create-org-from-url | fn | The org-creation entry point |
| search-identities | fn | Backs /claim-identity (573k-row external_identities) |
| organizations, organization_vehicles, external_identities | table | Written today by extraction path |
| Organizations.tsx (/org), OrganizationProfile.tsx (/org/:orgId), CreateOrganization.tsx (/org/create), ClaimExternalIdentity.tsx (/claim-identity) | page | Live UI module (each has a broken call to an undeployed fn — see half-built) |

### Live-secondary
update-org-from-website, compute-org-seller-stats (dormant cron; only repo-and-deployed seller-stats impl), extract-organization-from-seller (prod-orphan, called by deployed link-document-entities), api-v1-business-data, external_identity_claims view, organization_analysis_queue view, identity_engagement_stats MV (likely stale), AdminIdentityClaims.tsx.

### Half-built
- **auto-merge-duplicate-orgs** — NOT deployed; invoked by live CreateOrganization.tsx AND deployed create-org-from-url → 404s. Deploy or strip.
- **generate-org-due-diligence** — NOT deployed per this lane (Investor lane disagrees — see Contested); called by deployed fns.
- **org-extraction-coverage** — NOT deployed; fetched by live /org pages (its table DROPPED).
- report-marketplace-sale (undeployed, FE caller), organization_inventory_sync_queue (fills, nothing drains), organization_contributors (0 rows, 1.27M permission reads), organization_images (0 rows, UI reads).

### Dead (60) — one-liners
Deleted fns: classify-organization-type, ingest-org-complete, build-identity-graph, discover-entity-graph, clarification-responder, ECR suite ×3, extract-all-orgs-inventory, bulk-enqueue-inventory-extraction, scrape-organization-site, process-instagram-webhook, process-classic-seller-queue chain. Prod orphans (deployed, no source): scrape-ecr-collection-inventory, enrich-collection-intelligence, sync-instagram-organization, api-v1-seller-stats, geocode-organization-locations, index-classic-com-dealer. 0-row tables: organization_locations, classic_seller_queue, organization_hierarchy/relationships/brands/behavior_signals/investability_scores/external_profiles/seller_stats/ownership_verifications/capabilities/narratives/vehicle_notifications, person_organization_roles, work_organization_matches, organizations_archived_20260129, org_assets, org_mention_queue, bat_seller_monitors, seller_tiers/blocklist/sightings, _seller_extract, fb_marketplace_sellers, pipeline_sellers, ecr_makes/models, identity_claim_stats. DROPPED (map-listed!): organization_profiles, seller_profiles, identity_nodes, identity_edges, ecr_collections, ecr_collection_vehicles, org_extraction_coverage. Dead views: org_profiles, organizations_compat, bat_identity_stats_v1, image_with_identity, marketplace_seller_leaderboard, org_mention_stats. Page: ShopFinancials.tsx (contested — see RESTORATION).

### Uncertain
api-v1-organizations, enrich-seller (deployed orphans; possible external consumers — do not build on).

---

## 7. DOCUMENTS & VAULT

**Live core:** work_sessions (1,899 rows — but this is RESTORATION's ledger), receipts/receipt_items (fed via derive-dispatch cron), vehicle_documents (223k reads), the script-fed reference library (service_manual_chunks 42k + library_documents + reference_documents), and three deployed fns: document-ocr-worker (dormant, not dead), extract-title-data, get-manual-pages.
**Dead shell:** entire Vault layer + DocuSign bridge + a dozen deleted OCR/receipt fns with dangling references. Nine on-disk functions are frontend-wired but NOT deployed (404 paths); two run in prod with no repo source.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| document-ocr-worker | fn | THE OCR worker (dormant cron; contains dangling ds-extract-document call) |
| extract-title-data | fn | TitleScan.tsx caller |
| get-manual-pages | fn | ManualAnnotationViewer caller |
| work_sessions | table | Live work-story ledger (see RESTORATION) |
| receipts, receipt_items | table | Receipt ledger (derive-dispatch cron path) |
| vehicle_documents | table | THE per-vehicle doc store |
| document_ocr_queue | table | Documented OCR intake (dormant) — use it, don't mint another |
| reference_documents, library_documents, service_manual_chunks | table | Reference library (script-fed; mcp-connector reads chunks) |

### Live-secondary
smart-receipt-linker (**prod orphan on live SmartInvoiceUploader path — recover source before changing**), document_pages, secure_documents (read-live, writer undeployed), work_orders/work_order_parts (contested rows — see RESTORATION), deal_documents, Library.tsx, UnlinkedReceipts.tsx, WorkOrderStatement.tsx.

### Half-built (12) — one-liners
Undeployed-but-FE-wired fns (calls 404): receipt-extract (aiGateway + receiptExtractionService), detect-sensitive-document (map calls it a mandatory gate; can't run), parse-reference-document (Library.tsx), index-reference-document, extract-bat-parts-brands, recommend-parts-for-vehicle (contested — RESTORATION says deployed), generate-work-logs (see RESTORATION: DEAD), generate-wiring-quote, query-wiring-needs. Tables: documents/document_extractions (3 rows), vehicle_spid_data (1 row, producer deleted).

### Dead (32) — one-liners
process-receipt (deployed orphan, 0 callers); vault-* ×5 (deleted 2026-03-07); ds-upload-and-extract, ds-extract-document (dangling ref); extract-pdf-text (dangling in process-file-upload), part-number-ocr + receipt-photo-ocr (dangling in photo-pipeline-orchestrator), receipt-llm-validate, index-service-manual (dangling in referenceDocumentService), auto-discover-reference-docs, index-2002ad-parts, scrape-holley-product, detect-spid-sheet. Tables: vehicle_receipts (0), vehicle_title_documents + vehicle_manuals + vehicle_manual_links + vault_access_requests + vault_attestations (DO NOT EXIST despite map), vault_sms_sessions, secure_document_duplicates, ds_document_pages, component_documents, tool_receipt_documents, wiring_reference_documents. Pages/files: DailyWorkOrder.tsx, vault-manifest.json, daily-receipts/.

---

## 8. PHOTOS

**Live core:** vehicle_images (**39.7M rows**) drained by photo-pipeline-orchestrator (*/5 cron) with reset_stuck janitor; image-intake as upload front door; derive-image-exif via the registry-routed derivation loop; and the newly-alive Mac-library identity chain: **scripts/photo-sync-daemon.mjs (launchd ag.nuke.photo-sync) → image_identities (24.3k, growing) → image_appearances (11.8k)**.
**Dead shell:** 8 of 16 map-listed fns gone (3 with dangling live callers); 4 of 10 map-listed tables DO NOT EXIST — including **vehicle_image_tags, still queried by universal-search, tagService, AnnotoriousImageTagger (those paths fail at runtime; do NOT "fix" by creating the table without a design decision)**.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| photo-pipeline-orchestrator | fn | THE drain loop (*/5 cron) |
| reset_stuck_photo_pipeline_images | routine | Janitor (*/15 cron) |
| image-intake | fn | Upload front door (imessage-router, uploadClient, PhotoSyncPage) |
| derive-image-exif | fn | Registry-routed via derive-dispatch cron |
| check-image-vehicle-match | fn | On the BaT-cron extraction path |
| auto-sort-photos, auto-create-bundle-events, suggest-bundle-label | fn | FE-invoked, sole impls |
| vehicle_images | table | 39.7M rows; angle/exif/status are COLUMNS here |
| image_identities, image_appearances | table | Mac-library identity chain (live) |
| scripts/photo-sync-daemon.mjs | file | Automated Photos-library sync (launchd) |
| scripts/iphoto-intake.mjs | file | Album-driven manual intake |

### Live-secondary
process-all-images-cron (no cron despite name; mcp-connector only), backfill-images (import-path only).

### Half-built
production_files (100k rows, ZERO code refs), nuke_production_credits, image_contracts (schema, 0 rows), vehicle_image_classifications (0 rows, live code refs), vehicle_image_comments (0 rows, 4+ FE components query — shipped UI over empty table).

### Dead (20) — one-liners
trickle-backfill-images, dedup-vehicle-images, validate-vehicle-image (contested vs AI/VISION). Deleted w/ dangling refs: nuke-box-upload (process-file-upload), backfill-image-angles (AdminMissionControl button), match-vehicles-by-images (vehicleImageMatcher.ts). Deleted clean: ingest-photo-library, photo-sync-orchestrator, retry-image-backfill, reprocess-image-exif, ds-connect-photos. Tables: album_sync_map (0), vehicle_image_angles (0 — angle lives on vehicle_images.angle), ai_angle_classifications_audit; NONEXISTENT: vehicle_image_assets, vehicle_image_tags (live queriers!), vehicle_image_likes, vehicle_image_facts. Scripts: photo_sync_album_manager.py + photo-sync-album-manager.py (byte-identical duplicates).

---

## 9. COMMS & BOTS

**Live core:** four in-repo email/webhook fns on routed pages (agent-email, reply-email, send-invoice-email, webhooks-manage — registration-only, delivery is dead), the two notification tables the FE actually reads (user_notifications, admin_notifications), and the live **concierge system owned by a SEPARATE repo (/Users/skylar/lofficiel-concierge) deploying into the same Supabase project — never recreate concierge code in nuke**.
**Dead shell:** nearly all of CODEBASE_MAP §9 — all Telegram fns, all 4 bots, all SMS/X/Instagram fns deleted Mar-2026, yet ~14 remain deployed as zombies. **send-transaction-sms is a zombie ON A LIVE PATH (BuyVehicleButton) — recover source before touching.** No COMMS asset is on any active cron.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| agent-email, reply-email | fn | TeamInbox / AdminInbox / AdminAgentInbox |
| send-invoice-email | fn | WorkOrderStatement + GenerateBill |
| webhooks-manage | fn | Registration UI (delivery counterpart DEAD; tables missing — half-capability) |
| send-transaction-sms | fn | Live FE path; ZOMBIE (source deleted 2026-03-31) — restore from git history first |
| user_notifications | table | The ONLY notification store the FE reads (insert directly) |
| admin_notifications | table | Admin surface |
| concierge-ground/house/partner/partner-invite | fn | LIVE, external repo owner (lofficiel-concierge) |
| concierge_products (12k), concierge_partner_connections/invitations/sync_runs, concierge_quotes | table | Live concierge substrate (external writers) |

### Half-built
concierge_pulse, concierge_trip_events, concierge_fulfillment_milestones (read-wired, never written).

### Dead (50) — one-liners
Telegram layer ×6 fns + 5 tables (0 rows; map's "@Sss97133_bot running" is FALSE); bots: nuke-data-bot (→ mcp-connector), nuke-tech-bot, nukeproof-bot, nuke-mini; nuke-repo concierge trio; SMS: sms-verification-intake/review/reminder-scheduler/work-intake, phone-verify + 3 sms tables; email: inbound-email, process-alert-email + gmail-alert-poller (dormant cron, alert_email_log 0 writes ever), send-inquiry-notification, process-ksl-email; social: x-post, x-media-upload (zombie), instagram ×2; notifications: create-notification (zombie), notifications/notification_events/preferences/templates/duplicate_notifications (0-row quintet); webhooks-deliver (zombie); transfer-email/sms-webhook, notify-transfer-parties (zombies); user_inbox_messages + user_inbox_threads (DO NOT EXIST despite map); vault_sms_sessions, contact_inbox.

---

## 10. RESTORATION / WORK

**Live core:** **work_sessions** (1,899 rows; 1,485 in last 30d via photo-pipeline cron → auto-sort-photos, plus mcp-connector `confirm_work_session`), create-work-session-from-evidence (VehicleTimeline entry point), **catalog_parts** (10,853 rows) + recommend-parts-for-vehicle, and WiringPlan whose math is **client-side harnessDerivation.ts — NOT the server wiring functions**.
**Dead shell is dangerously well-named:** `work-session` fn has ZERO callers despite the canonical-sounding name; generate-work-logs (2,002 LOC) was explicitly repointed off 2026-07-06; the whole work_orders family (8 tables) + wiring_* schema (6 tables) are populated-never — live UI queries them thousands of times against zero rows.

### Canonical

| Asset | Kind | Why |
|---|---|---|
| work_sessions | table | THE work ledger (never work_orders / vehicle_jobs) |
| create-work-session-from-evidence | fn | The ONE UI entry: photo evidence → work event |
| recommend-parts-for-vehicle | fn | Parts recs off catalog_parts (deploy status contested w/ DOCS lane) |
| catalog_parts | table | THE parts catalog (10,853 rows) — never parts_catalog |
| harnessDerivation.ts | file | The canonical wiring compute (client-side) |
| RestorationIntake.tsx, WiringPlan.tsx | page | Routed surfaces |

### Live-secondary
extract-bat-parts-brands, generate-cut-list / generate-vehicle-diagram / generate-wiring-diagram (server fallbacks only), parts_catalog (different grain, reference-doc surfaces — don't add parts here), WorkOrderStatement.tsx (renders empty schema), ShareWiring.tsx, ShopFinancials.tsx (embedded component — contested), CatalogBrowser.tsx.

### Half-built (15) — one-liners
compute-wiring-overlay (1 row ever), work_orders + work_order_line_items/parts/labor/payments + work_organization_matches (0 rows, thousands of live reads), parts_fitment (9 seed rows), vehicle_wiring_overlays (1 row), wiring_harnesses/decisions/policy_rules/design_issues/enrichment_status/reference_documents (full schema, all empty).

### Dead (30) — one-liners
work-session fn (0 callers — TRAP name), generate-work-logs (2,002 LOC, repointed off), query-wiring-needs → generate-wiring-quote (dead chain), generate-wiring-bom, generate-harness-spec; deleted: work-intake-batch, sms-work-intake, intelligent-work-detector, telegram-restoration-bot (map's "Telegram work intake operational" = FALSE), telegram-task-worker, index-2002ad-parts, scrape-holley-product, estimate-restoration-cost, go-grinder, analyze-work-photos-with-products. NONEXISTENT map-listed tables: work_session_photos, wiring_connections, vehicle_job_holds. 0-row: vehicle_jobs, user_labor_rates, work_session_parts, work_order_assignments/edit_log/status_history, ebay_parts_catalog, parts_reception, parts_transfers, vehicle_suggested_parts. Page: DailyWorkOrder.tsx.

---

## 11. INVESTOR / BUSINESS

**Live core:** market analytics, not investor-facing — the treemap stack (11 treemap_* SQL routines over 9 **populated** MVs; 211k rows in mv_treemap_years by direct count; refresh cron DORMANT so data is frozen — **reactivate `treemap-refresh` cron, don't build a new refresh path**), auction-trends-stats + get_auction_trends_v2 (/trends), api-v1-market-trends, generate-org-due-diligence, BusinessIntelligence page.
**Dead shell:** the investor portal is retired (router says so); **custom_investment_contracts is a FABRICATED $150M demo — never resurrect as substrate**; investor_offerings never existed (map fiction); acquisition_pipeline is the canonical half-built trap (fully wired, zero rows ever).

### Canonical

| Asset | Kind | Why |
|---|---|---|
| treemap_* SQL routines ×11 | routine | THE treemap API (HomePage/BrowseVehicles call via supabase.rpc) |
| mv_treemap_* ×9 | MV | Populated backing store (frozen — dormant refresh cron) |
| treemap_refresh_all | routine | The one refresh mechanism (reactivate cron) |
| auction-trends-stats + get_auction_trends_v2 | fn/routine | Live /trends dashboard |
| api-v1-market-trends + get_market_trends | fn/routine | Public trends API |
| generate-org-due-diligence | fn | Only due-diligence impl (deploy status contested w/ ORGS lane) |
| BusinessIntelligence.tsx | page | Routed + nav-linked admin BI |

### Live-secondary
treemap-vehicles (wrapper for MarketMap only), AcquisitionPipeline.tsx, BusinessSettings.tsx.

### Half-built (11) — one-liners
acquisition_pipeline + acquisition_stage_log + pipeline_sellers + pipeline_cross_posts + seller_sightings + market_proof_reports (wired, 0 rows ever); vehicle_offerings + share_holdings + market_orders (the REAL offerings schema, never launched); organization_investability_scores + compute_org_investability_score (never produced a row).

### Dead (13) — one-liners
investor-portal-stats, treemap-data, source-census (deleted); daily-report (dormant cron + calls deleted RPC get_queue_summary — doubly dead); source_census, mv_vehicle_census + census routines (abandoned); custom_investment_contracts + contract_assets (FABRICATED demo); investor_offerings (NEVER EXISTED); investability_tier_requirements; InvestorDashboard.tsx + InvestorOffering.tsx (deleted; "Offering page live at nuke.ag/offering" map claim FALSE).

---

## 12. FRONTEND (pages + router)

**Live core:** App.tsx → HomeGate (**IntakePage = logged-out front door per F6; HomePage = logged-in**) → routes/DomainRoutes.tsx → five domain modules (vehicle, organization, dealer, admin, marketplace). Every rendered page flows through these six route files. Beating heart: VehicleProfile + its 10 subpages, UserProfile (/u/:handle), Search/Browse/CohortTerminal, market module, admin suite behind AdminHome.
**Map is stale:** MarketExchange, TradingPage, MarketFundDetail, InvestorOffering, InvestorDashboard, Invest, VaultPage, VaultScanPage — none exist on disk.
**Rule: never mint a new admin dashboard, profile, list, or landing page — a routed one almost certainly already exists** (59 routed-but-unlinked pages are live-secondary).

### Canonical (69 pages, grouped)
- **Core:** HomePage, intake/IntakePage, Search, BrowseVehicles, CohortTerminal (active dev 2026-07-08), VehicleProfile (+DayPage, ObservationPage, InventoryPage, VendorPage/VendorsPage, PartPage, ImagePage, LifecyclePage, TablePage, AnalysisStreamPage), VehiclesDashboard, add-vehicle/AddVehicle, EditVehicle, WiringPlan, VehiclePortfolio.
- **People/orgs:** UserProfile (/profile, /u/:handle), Organizations, OrganizationProfile, CreateOrganization, ClaimExternalIdentity.
- **Capture/media:** Capture, Capsule, PersonalPhotoLibrary (/inbox), Notifications.
- **Market/auctions:** AuctionMarketplace, AuctionListing, MarketDashboard, MarketSegments, MarketSegmentDetail, AcquisitionPipeline, InvoiceManager, journal/JournalIndex + JournalPage.
- **Dev/API:** developers/index, ApiLanding, DeveloperSignup, DeveloperDashboard, settings/{ApiKeysPage, AIAccessPage (2026-07-09), WebhooksPage, UsageDashboardPage}.
- **Transfers:** TransferPartyPage (/t/:transferId).
- **Legal/entry:** About, PrivacyPolicy, TermsOfService, DataDeletion, BrandStudio, ResetPassword, DropboxCallback.
- **Admin:** admin/AdminHome (hub), AdminDashboard (/admin/reviews), AdminVerifications, AdminIdentityClaims, AdminInbox, AdminAgentInbox, AdminMissionControl, SystemStatus, CatalogBrowser, BulkPriceEditor, KSLScraper, NLQueryConsole, BusinessIntelligence, AdminRalphBrief.

### Live-secondary (59)
LandingPage (legacy A/B only), ProductPage, VehicleShowcase, DeckPage, ShareWiring, EULA, Extension, Valuation, LocalDiscover/LocalVehicle, TechCapture, CurationQueue, UnlinkedReceipts, BusinessSettings, QuickBooksCallback, RestorationIntake, Library, BaTMembers, WorkOrderStatement, ImportDataPage, PhotoSyncPage, DailyDebrief, SellDashboard, TeamInbox, ConnectedAgentsPage, BuildDashboard, LiveIntakeScreen, VehicleJobs, VehicleListFromPhotos, Dashboard, VLVAFinancialReport, Dealer* ×3, MergeProposalsDashboard, AdminPendingVehicles, + ~25 typed-URL admin tools (AdminPulse, DataPulse, ScriptControlCenter, ImageProcessingDashboard, BatchImageAnalysis, ExtractionMonitor, ExtractionReview, SourcesDashboard, InventoryAnalytics, PriceCsvImport, ScraperDashboard, MemeLibraryAdmin, VehicleMakeLogosCatalog, MarketDataTools, DatabaseAudit, DataDiagnostic, TestContributions, BotTestDashboard, UnifiedScraperDashboard, DataQualityDashboard, TransfersDashboard, UserMetrics, QuestionIntelligence).

### Dead (8, ~6,700 LOC — safe deletions)
Vehicles.tsx (2,262 LOC → VehiclesDashboard), Profile.tsx + Profile.legacy.tsx (→ UserProfile), LivePage.tsx (→ src/live/LiveFloor.tsx), Place.tsx, SubjectProfile.tsx, ShopFinancials.tsx (contested — RESTORATION found it embedded in Profile/Capsule), DailyWorkOrder.tsx.

---

## 13. REPO HYGIENE (root cruft)

**Live core at root:** package.json (Jul 11), vercel.json + middleware.ts + api/ (the actual deploy surface), DONE.md/TOOLS.md ledgers, and three working dirs — output/ (staging), logs/ (743MB, 25 launchd writers — rotate, don't delete), wiring/ (K5 active).
**Sediment:** Feb extraction-fleet sprint, Mar-10 Ralph-loop freeze, one-off reports, shell accidents. Three traps: build-index.mjs + dhash-backfill.mjs look fresh (Jul 8) but are completed one-offs; root .ralph symlinks look live but coordination is `.claude/`; **priv/kalshi private_key.pem is an unencrypted secret at repo root — relocate, never commit**.

### Canonical
README, CLAUDE.md, package.json(+lock), vercel.json, middleware.ts, api/, DONE.md, TOOLS.md, PROJECT_STATE.md, CODEBASE_MAP.md (stale — refresh, don't delete), VISION.md, root config set (.gitignore etc.).

### Live-secondary
output/ (staging only — facts land in DB), logs/, wiring/, yono/, mcp-server/ (desktop package; prod is supabase/functions/mcp-connector), deno.lock, 4 tracked strategy docs (move to docs/), tracked support dirs (tools/, database/, tests/, reference_documents/, ...).

### Half-built
dealerscan/ (standalone app, zero references).

### Dead (25 groups) — one-liners
35 root status .md files (→ DONE.md/docs), 36 root IMG_* photos (verify ingestion first — user substrate), fb-* scrape residue + fb-session-* dirs (6,322 files), root scrape/analysis JSONs + HTML reports, build-index.mjs + dhash-backfill.mjs (completed one-offs), scratch test scripts, windsurf pair, extraction-fleet residue (agents/, agent/, extraction-agent/ — 4,762 files), Ralph loop layer (.ralph/ + symlinks, frozen 2026-03-10), shell-accident junk ('25.5%.', 'EXIT_CODE: ', git-tracked UUID file — delete), tmp/ (1,675 files), scratch_audit/ + ops/ + Projects/ (empty), site-inspections/, root dist/, analysis-reports/reports/audit/, test artifacts, backups/ (4-month-old dump), archive/ (the graveyard — destination for the rest), misc dormant dirs (prompts/, mcp/, mcp-servers/, workshop/, .venv-gopro/, daily-receipts/, reference_materials/), NukePhotoSync.app.

### Uncertain
Dockerfile.ksl-scraper + fly.toml (check `fly status -a nuke-ksl-scraper`), data/ (mixed regenerable + financial exports — triage per file), **priv/ (live Kalshi secret)**, training-data/ (verify mirrored before archiving), .context/ (370 entries, no known consumer).

---

## CONTESTED RULINGS (double-check before acting)

Where two subsystem agents disagreed. Prefer the safer reading until a human verifies.

| Asset | Lane A says | Lane B says | Safer reading |
|---|---|---|---|
| mv_treemap_* MVs | VEHICLE INTEL: all 0 rows, DEAD | INVESTOR: populated (direct count(*), 211k in years), CANONICAL-frozen | INVESTOR (count(*) beats stale n_live_tup); reactivate refresh cron rather than rebuild |
| treemap-vehicles fn | VEHICLE INTEL: NOT deployed, broken caller | INVESTOR: deployed wrapper serving MarketMap | Verify deployment before touching MarketMap |
| recommend-parts-for-vehicle | DOCS: NOT deployed (404 path) | RESTORATION: deployed, canonical | Check deployment list before relying on it |
| generate-org-due-diligence | ORGS: NOT deployed (callers 404) | INVESTOR: canonical, reachable | Check deployment list |
| validate-vehicle-image | AI/VISION: canonical (registry caller) | PHOTOS: dead (ref is a comment) | Treat as dormant; confirm the registry call is real code |
| webhooks-manage | COMMS: canonical | PLATFORM: half-built (tables DO NOT EXIST) | PLATFORM — the feature cannot work end-to-end |
| work_orders rows | DOCS: 26 rows | RESTORATION: 0 rows | Recount; either way work_sessions is the ledger |
| ShopFinancials.tsx | FRONTEND/PLATFORM: dead (0 importers) | RESTORATION: embedded in Profile.tsx:960 + Capsule.tsx:222 | Capsule is live → don't delete without checking that embed |
| daily-report sendTelegram | COMMS: last surviving Telegram impl | INVESTOR: daily-report doubly dead | It's dead either way; the inline pattern is the only precedent |
| AcquisitionPipeline.tsx | FRONTEND: canonical nav-linked | PLATFORM/INVESTOR: routed-unlinked, renders empty | Page is live; the FEATURE is half-built (0 rows ever) |
| SubjectProfile.tsx | PLATFORM: half-built (dangling /subject/ links) | FRONTEND: dead | Dead page + dangling links to strip |
| ownership_transfers rows | pg_stat: 2,656 | count(*): 80,965 | Always count(*) |
