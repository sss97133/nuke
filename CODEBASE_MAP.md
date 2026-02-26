# CODEBASE MAP — Nuke Platform
**Generated: 2026-02-26 | Keep this updated as departments shift**

Cabinet members: load this at session start. It tells you who owns what, what constraints exist, and where cross-department handoffs happen. Do not implement — route.

---

## System Scale

| Layer | Count | Notes |
|-------|-------|-------|
| Edge functions | 397 | in `supabase/functions/` |
| DB tables | 964 | `public` schema |
| Frontend pages | 90+ | `nuke_frontend/src/pages/` |
| Cron jobs | 230+ | via `pg_cron` |
| Shared utilities | 38 | in `supabase/functions/_shared/` |

---

## Departments

### 1. EXTRACTION
**Domain:** Getting vehicle data from every external source into `import_queue` or `vehicles`

**Owned Functions (grouped):**
- **BaT (primary source):** `bat-simple-extract`, `extract-bat-core`, `bat-queue-worker`, `process-bat-extraction-queue`, `complete-bat-import`, `extract-auction-comments`, `crawl-bat-active`, `bat-url-discovery`, `bat-snapshot-parser`, `sync-bat-listing`, `bat-multisignal-postprocess`, `bat-year-crawler`
- **Cars & Bids:** `extract-cars-and-bids-core`, `extract-cars-and-bids-comments`, `cab-url-discovery`
- **Facebook Marketplace:** `extract-facebook-marketplace`, `fb-marketplace-orchestrator`, `fb-marketplace-sweep`, `fb-marketplace-bot-scraper`, `refine-fb-listing`, `import-fb-marketplace`, `message-fb-seller`
- **Craigslist:** `extract-craigslist`, `discover-cl-squarebodies`, `discover-cl-muscle-cars`, `scrape-all-craigslist-squarebodies`, `process-cl-queue`
- **Major Auctions:** `extract-mecum`, `extract-barrett-jackson`, `extract-gooding`, `extract-rmsothebys`, `extract-bonhams`, `extract-broad-arrow`, `extract-bh-auction`, `extract-gaa-classics`, `extract-historics-uk`, `extract-premium-auction`, `extract-cab-bids`
- **Hagerty:** `extract-hagerty-listing`, `hagerty-bid-tracker`, `hagerty-email-parser`
- **PCarMarket:** `import-pcarmarket-listing`
- **Collecting Cars:** `extract-collecting-cars`, `extract-collecting-cars-simple`, `collecting-cars-discovery`
- **International:** `extract-blocket`, `extract-leboncoin`, `extract-thesamba`, `extract-rennlist`
- **Classic Platforms:** `import-classiccars-listing`, `extract-victorylap-listing`, `scrape-ksl-listings`
- **eBay:** `extract-ebay-motors`, `discover-ebay-parts`
- **Forums:** `inspect-forum`, `discover-build-threads`, `extract-build-posts`, `structure-build-thread`
- **Barn Finds:** `extract-barn-finds-listing`, `barn-finds-discovery`
- **Generic/Fallback:** `extract-vehicle-data-ai`, `extract-vehicle-data-ollama`, `smart-extraction-router`, `extract-with-playwright`, `extract-with-proof-and-backfill`, `extract-using-catalog`
- **Queue management:** `process-import-queue`, `continuous-queue-processor`, `bulk-enqueue-inventory-extraction`, `re-extract-pending-vehicles`
- **Crawling:** `intelligent-crawler`, `auto-site-mapper`, `thorough-site-mapper`, `unified-scraper-orchestrator`, `scrape-multi-source`, `simple-scraper`
- **Quality:** `extraction-quality-validator`, `extraction-watchdog`, `save-extraction-comparison`

**Owned Tables:** `import_queue`, `listing_page_snapshots`, `bat_listings`, `bat_extraction_queue`, `bat_crawl_state`, `bat_scrape_jobs`, `auction_comments`, `bat_comments`

**Constraints:**
- ALL external fetches via `archiveFetch()` from `_shared/archiveFetch.ts` — never raw `fetch()`
- Pages auto-archive to `listing_page_snapshots` — re-extract from archive, never re-crawl
- BaT requires two-step workflow: `extract-bat-core` then `extract-auction-comments` (not one-step)
- `continuous-queue-processor` runs on cron — don't call directly, insert to `import_queue`
- `smart-extraction-router` is the correct entry point for unknown source URLs

**Status:** Active. FB Marketplace residential-IP scraper deployed. Logged-out GraphQL path being tested. Craigslist squarebody scanner stable.

---

### 2. AI / VISION (YONO)
**Domain:** All AI inference on vehicle data — images, text, comments, descriptions. YONO = local vision model.

**Owned Functions (grouped):**
- **YONO (local model):** `yono-classify` (single image → make/model/year/angle, 4ms, $0), `yono-batch-process` (bulk), `export-training-batch` (training data prep)
- **Image analysis:** `analyze-image`, `vision-analyze-image`, `identify-vehicle-from-image`, `validate-vehicle-image`, `validate-bat-image`, `auto-analyze-upload`, `batch-analyze-vehicle`, `analyze-engine-bay`, `score-vehicle-condition`, `detailed-component-extractor`
- **Comment/text analysis:** `discover-comment-data`, `batch-comment-discovery`, `analyze-comments-fast`, `analyze-auction-comments`, `update-live-sentiment`, `aggregate-sentiment`, `analyze-batch-contextual`
- **Description/enrichment:** `analyze-vehicle-description`, `discover-description-data`, `generate-vehicle-description`, `enrich-vehicle-profile-ai`
- **Documents:** `analyze-vehicle-documents`, `analyze-work-photos-with-products`, `analyze-vehicle-tags`
- **Market signals:** `analyze-market-signals`, `intelligence-evaluate`, `market-intelligence-agent`, `aggregate-meta-insights`
- **AI infrastructure:** `image-ai-chat`, `nlq-sql`, `test-gemini`

**Owned Tables:** `comment_discoveries`, `description_discoveries`, `observation_discoveries`, `ai_angle_classifications_audit`, `ai_work_assessments`, `ai_training_exports`, `auction_sentiment_timeline`, `vehicle_sentiment`, `vehicle_intelligence`

**Writes (via pipeline_registry):**
- `vehicles.signal_score`, `vehicles.signal_reasons` → `analyze-market-signals`
- `vehicle_images.ai_processing_status`, `vehicle_images.angle` → `yono-classify` / `photo-pipeline-orchestrator`

**Constraints:**
- **IMAGE PIPELINE PAUSED** — `NUKE_ANALYSIS_PAUSED` env flag. 32M images pending. Do NOT re-enable without explicit CEO approval.
- YONO sidecar runs locally on port 8472 — edge function proxies to it. Sidecar must be running.
- YONO is tier-0 (free, 4ms) before Gemini/GPT. Do not skip YONO and call cloud AI directly.
- `analyze-image` is the gateway — calls YONO first, falls back to cloud.

**Status:** Phase 5 complete (EfficientNet trained, ONNX exported, YONOClassifier working). Tier 2 hierarchical training running (PID 34496 — DO NOT KILL). FastAPI sidecar = NEXT milestone for SDK v1.3.0. Photo library scan running (check `yono/library_scan/scan.pid`).

**Reference:** `yono.md` — full technical state and build sequence.

---

### 3. PLATFORM / INFRASTRUCTURE
**Domain:** System health, queue workers, webhooks, agent coordination, backfills, crons, API gateway.

**Owned Functions (grouped):**
- **Health/monitoring:** `db-stats`, `system-health-monitor`, `platform-status`, `check-scraper-health`, `data-quality-monitor`, `pipeline-dashboard`, `queue-status`, `extraction-watchdog`
- **Queue workers:** `continuous-queue-processor`, `process-import-queue`, `document-ocr-worker`, `process-bat-extraction-queue`, `process-cl-queue`, `photo-pipeline-orchestrator`, `photo-sync-orchestrator`, `process-all-images-cron`, `enrich-vehicles-cron`, `process-content-extraction`, `trickle-backfill-images`
- **Backfills:** `backfill-image-angles`, `backfill-images`, `backfill-profile-stats`, `backfill-quality-scores`, `batch-repair-vehicles`, `auto-fix-bat-prices`, `auto-fix-vehicle-profile`, `batch-ymm-propagate`, `data-normalize-makes`, `retry-image-backfill`
- **Webhooks:** `webhooks-deliver`, `webhooks-manage`, `centraldispatch-webhook`, `clearing-house-webhook`, `quickbooks-webhook`, `kyc-webhook`
- **OAuth callbacks:** `centraldispatch-oauth-callback`, `facebook-oauth-callback`, `instagram-oauth-callback`, `x-oauth-callback`, `twitch-oauth-callback`
- **Agent infrastructure:** `ralph-wiggum-rlm-extraction-coordinator`, `ralph-wiggum-extract`, `ralph-wiggum-rlm-homepage`, `ai-agent-supervisor`, `agent-orchestrator`, `remote-agent`, `live-admin`, `vehicle-agent`, `vehicle-expert-agent`, `autonomous-extraction-agent`, `autonomous-source-ingestion-agent`
- **API gateway:** `api-v1-vehicles`, `api-v1-search`, `api-v1-listings`, `api-v1-makes`, `api-v1-observations`, `api-v1-vision`, `universal-search`, `search`
- **Scheduling:** `crawler-scheduler`, `poll-listing-feeds`, `sms-reminder-scheduler`

**Owned Tables:** `pipeline_registry`, `import_queue` (shared), `cron.job` (pg_cron), `webhook_deliveries`, `webhook_endpoints`, `agent_registry`, `agent_tasks`, `agent_execution_logs`, `agent_configs`, `app_config`, `app_settings`

**Constraints:**
- `pipeline_registry` is authoritative — always query before writing to computed fields
- `release_stale_locks()` — run to clear locks >30min. Hourly cron (job 188) auto-releases.
- `queue_lock_health` view — live lock state. Check before debugging stuck queues.
- `data-quality-monitor` with `{"action":"brief"}` is the system status endpoint.
- `ralph-wiggum-rlm-extraction-coordinator` with `{"action":"brief"}` is the queue health endpoint.

**Key crons (selected):**
- Job 188: Hourly stale lock release
- Job 212: Exchange pricing every 15min
- Job 213: Segment stats refresh every 4h
- Job 190: Transfer backfill every 2min
- Job 228: Quality backfill, 300 rows/run (~69hr total)
- Job 65: Aggressive backlog clear every 10min

**Status:** Stable. Quality backfill running (job 228). DO NOT recreate dropped indexes `idx_vehicles_quality_score` and `idx_vehicles_quality_backfill` until backfill completes.

---

### 4. VEHICLE INTELLIGENCE
**Domain:** Valuation, scoring, market data, VIN operations, enrichment. Making vehicles legible.

**Owned Functions (grouped):**
- **Valuation:** `compute-vehicle-valuation`, `api-v1-valuations`, `api-v1-comps`, `predict-hammer-price`, `price-analytics`, `value-trends`, `bid-curve-analysis`, `calculate-market-indexes`, `calculate-market-trends`, `api-v1-market-trends`
- **Scoring:** `calculate-vehicle-scores`, `calculate-profile-completeness`, `calculate-advanced-metrics`
- **Market:** `auction-intelligence`, `auction-trends-stats`, `market-spread-calculator`, `score-live-auctions`, `detect-record-prices`, `data-flag-price-outliers`, `monitor-price-drops`
- **VIN:** `decode-vin-and-update`, `batch-vin-decode`, `extract-vin-from-vehicle`, `api-v1-vin-lookup`
- **Enrichment:** `enrich-factory-specs`, `enrich-msrp`, `enrich-listing-content`, `enrich-bulk`, `enrich-collection-intelligence`
- **Geographic/data:** `geocode-vehicle-locations`, `map-vehicles`, `sync-live-auction`, `sync-live-auctions`, `auto-detect-vehicle-owner`, `split-vehicle-from-source`
- **API:** `api-v1-vehicle-history`, `api-v1-vehicle-auction`, `treemap-data`, `treemap-vehicles`

**Owned Tables:** `vehicles` (primary), `vehicle_valuations`, `vehicle_valuations_components`, `vehicle_price_history`, `vehicle_price_baselines`, `vin_decode_cache`, `vin_decoded_data`, `vin_validations`, `market_segment_stats_cache`, `auction_events`, `vehicle_stats_cache`, `vehicle_dynamic_data`

**Writes (via pipeline_registry — DO NOT write directly):**
- `vehicles.nuke_estimate`, `vehicles.nuke_estimate_confidence` → `compute-vehicle-valuation`
- `vehicles.signal_score`, `vehicles.signal_reasons` → `analyze-market-signals`
- `vehicles.deal_score`, `vehicles.heat_score` → computed fields
- `vehicles.data_quality_score`, `vehicles.quality_grade` → `calculate-profile-completeness`
- `vehicles.perf_*_score`, `vehicles.social_positioning_score` → `calculate-vehicle-scores`

**Constraints:**
- NEVER write computed fields directly — always via owning function
- `pipeline_registry` has 33 entries for `vehicles` table alone — always check before writing
- `vin_decode_cache` — check before calling NHTSA VPIC (cache-first)

**Status:** Stable. Market exchange live (PORS $5B, TRUK $1.25B, SQBD $80M, Y79 $317M baselines seeded).

---

### 5. DEAL FLOW / TRADING
**Domain:** Transfers, transactions, deal jackets, market exchange, payments, trading.

**Owned Functions (grouped):**
- **Transfers:** `transfer-automator`, `transfer-advance`, `transfer-email-webhook`, `transfer-sms-webhook`, `transfer-status-api`
- **Transactions:** `acquire-vehicle`, `execute-auto-buy`, `place-bid-with-deposit`, `place-market-order`, `create-vehicle-transaction-checkout`
- **Exchange:** `update-exchange-prices`, `api-v1-exchange`, `trading`, `paper-trade-autopilot`
- **Deal jacket:** `deal-jacket-pipeline`, `forensic-deal-jacket`, `decompose-deal-jacket`, `deal-wire-automation`, `deal-brief`
- **DocuSign:** `ds-connect-photos`, `ds-create-checkout`, `ds-extract-document`, `ds-merge-deal-data`, `ds-upload-and-extract`
- **Payments:** `stripe-webhook`, `stripe-checkout`, `create-checkout`, `create-api-access-checkout`, `create-setup-session`, `setup-payment-method`, `create-shipping-listing`, `send-shipping-notification`
- **Proof/backtesting:** `market-proof`, `batch-market-proof`, `backtest-hammer-simulator`
- **Subscriptions:** `api-keys-manage`

**Owned Tables:** `vehicle_transactions`, `vehicle_financial_transactions`, `vehicle_trade_items`, `vehicle_trades`, `vehicle_deal_offers`, `vehicle_bonds`, `vehicle_offerings`, `vehicle_funds`, `market_segment_stats_cache`, `user_wallets`, `user_cash_balances`, `auction_bids`, `auto_buy_executions`, `work_contracts`

**Constraints:**
- Stripe webhook secret must be set — `stripe-webhook` validates signatures
- `transfer-automator` is the entry point for all ownership transfers — do not handle state transitions manually
- `api-v1-exchange` is the unified read API for funds + offerings + holdings

**Status:** Market exchange live. Transfer badge deployed. `update-exchange-prices` runs every 15min (job 212).

---

### 6. ORGANIZATIONS & IDENTITY
**Domain:** Dealers, auctions houses, shops, collector identities — the who behind vehicles.

**Owned Functions:**
- **Org management:** `create-org-from-url`, `update-org-from-website`, `classify-organization-type`, `ingest-org-complete`, `auto-merge-duplicate-orgs`, `generate-org-due-diligence`, `compute-org-seller-stats`, `org-extraction-coverage`
- **Identity graph:** `build-identity-graph`, `discover-entity-graph`, `search-identities`, `clarification-responder`
- **ECR/Collections:** `discover-ecr-collections`, `scrape-ecr-collection-inventory`, `seed-ecr-collections`, `enrich-collection-intelligence`
- **Inventory:** `extract-all-orgs-inventory`, `index-classic-com-dealer`, `bulk-enqueue-inventory-extraction`, `scrape-organization-site`
- **Social:** `sync-instagram-organization`, `process-instagram-webhook`
- **Seller:** `extract-organization-from-seller`, `report-marketplace-sale`
- **API:** `api-v1-business-data`

**Owned Tables:** `organizations`, `organization_profiles`, `seller_profiles`, `identity_nodes`, `identity_edges`, `ecr_collections`, `ecr_collection_vehicles`, `org_extraction_coverage`

**Status:** Stable. Seller intel rollup scheduled every 4 hours.

---

### 7. DOCUMENTS & VAULT
**Domain:** OCR, receipts, service manuals, title documents, the Vault (provenance/ownership proof).

**Owned Functions:**
- **OCR pipeline:** `document-ocr-worker`, `extract-pdf-text`, `part-number-ocr`, `detect-sensitive-document`
- **Receipts:** `receipt-extract`, `receipt-llm-validate`, `receipt-photo-ocr`, `process-receipt`, `smart-receipt-linker`
- **Titles:** `extract-title-data`, `detect-spid-sheet`
- **Service manuals:** `index-service-manual`, `get-manual-pages`, `parse-reference-document`, `index-reference-document`, `auto-discover-reference-docs`, `index-2002ad-parts`
- **Parts:** `scrape-holley-product`, `extract-bat-parts-brands`, `recommend-parts-for-vehicle`
- **Vault:** `vault-approve-access`, `vault-attestation-submit`, `vault-pwa-submit`, `vault-request-access`, `vault-sms-webhook`
- **Work docs:** `generate-work-logs`, `generate-wiring-quote`, `query-wiring-needs`
- **DocuSign (shared with Deal Flow):** `ds-upload-and-extract`, `ds-extract-document`

**Owned Tables:** `document_ocr_queue`, `vehicle_documents`, `vehicle_title_documents`, `vehicle_receipts`, `vehicle_manuals`, `vehicle_manual_links`, `vault_access_requests`, `vault_attestations`, `vault_sms_sessions`, `vehicle_spid_data`, `work_orders`, `work_sessions`, `work_order_parts`

**Constraints:**
- `document_ocr_queue` → insert here, `document-ocr-worker` picks up automatically
- `detect-sensitive-document` must run before storing any user-uploaded document

**Status:** Stable. Vault PWA deployed.

---

### 8. PHOTOS
**Domain:** Image intake, organization, pipeline, YONO angle classification, photo-to-vehicle linking.

**Owned Functions:**
- **Intake:** `image-intake`, `ingest-photo-library`, `nuke-box-upload`
- **Organization:** `auto-sort-photos`, `auto-create-bundle-events`, `suggest-bundle-label`
- **Pipeline:** `photo-pipeline-orchestrator`, `photo-sync-orchestrator`, `process-all-images-cron`
- **Backfill:** `backfill-image-angles`, `backfill-images`, `retry-image-backfill`, `trickle-backfill-images`, `reprocess-image-exif`
- **Matching:** `match-vehicles-by-images`
- **DocuSign bridge:** `ds-connect-photos`

**Owned Tables:** `vehicle_images` (primary), `album_sync_map`, `vehicle_image_assets`, `vehicle_image_classifications`, `vehicle_image_tags`, `vehicle_image_likes`, `vehicle_image_facts`, `vehicle_image_comments`, `vehicle_image_angles`, `ai_angle_classifications_audit`

**Writes (via pipeline_registry — DO NOT write directly):**
- `vehicle_images.ai_processing_status` → `photo-pipeline-orchestrator`
- `vehicle_images.optimization_status` → optimization worker
- `vehicle_images.organization_status` → `auto-sort-photos`
- `vehicle_images.angle` → `yono-classify`

**Constraints:**
- **IMAGE PIPELINE PAUSED** — see AI/Vision department. 32M pending images.
- K10 truck (vehicle_id: `6442df03-...`) has 419 photos uploaded, queued/paused.
- iPhoto intake script: `scripts/iphoto-intake.mjs` — uses `osxphotos` CLI (album names have trailing spaces)

**Status:** Pipeline paused globally. Bundle review UX deployed and wired into Evidence tab.

---

### 9. COMMS & BOTS
**Domain:** Telegram, SMS, email, social APIs, notification delivery, bots.

**Owned Functions:**
- **Telegram:** `telegram-webhook`, `telegram-approval-webhook`, `telegram-approval-callback`, `telegram-intake`, `telegram-restoration-bot`, `telegram-task-worker`
- **Bots:** `nuke-data-bot`, `nuke-tech-bot`, `nukeproof-bot`, `nuke-mini`
- **Concierge:** `concierge-notify`, `concierge-villa-discovery-worker`, `concierge-webhook`
- **SMS:** `sms-verification-intake`, `sms-review`, `sms-reminder-scheduler`, `phone-verify`, `send-transaction-sms`, `sms-work-intake`
- **Email:** `inbound-email`, `reply-email`, `process-alert-email`, `send-inquiry-notification`
- **Social APIs:** `x-post`, `x-media-upload`, `instagram-oauth-callback`, `process-instagram-webhook`
- **Notifications:** `create-notification`, `webhooks-deliver`

**Owned Tables:** `user_notifications`, `admin_notifications`, `user_inbox_messages`, `user_inbox_threads`, `alert_email_log`, `vault_sms_sessions`

**Status:** Telegram bot `@Sss97133_bot` running. Commands: `/status`, `/logs`, `/errors`.

---

### 10. RESTORATION / WORK
**Domain:** Shop work, restoration tracking, work sessions, wiring, labor — the physical vehicle world.

**Owned Functions:**
- **Work sessions:** `work-session`, `work-intake-batch`, `sms-work-intake`, `intelligent-work-detector`, `create-work-session-from-evidence`
- **Work orders:** `generate-work-logs`, `query-wiring-needs`, `generate-wiring-quote`
- **Parts:** `recommend-parts-for-vehicle`, `index-2002ad-parts`, `scrape-holley-product`
- **Estimation:** `estimate-restoration-cost`
- **Bot:** `telegram-restoration-bot`, `telegram-task-worker`
- **Other:** `go-grinder`, `analyze-work-photos-with-products`

**Owned Tables:** `work_orders`, `work_sessions`, `work_order_parts`, `work_order_labor`, `work_session_photos`, `vehicle_jobs`, `vehicle_job_holds`, `wiring_connections`, `user_labor_rates`

**Status:** Active. Telegram work intake operational.

---

### 11. INVESTOR / BUSINESS
**Domain:** Investor portal, acquisition pipeline, due diligence, market data for external audiences.

**Owned Functions:**
- `investor-portal-stats`, `api-v1-market-trends`, `treemap-data`, `treemap-vehicles`
- `generate-org-due-diligence`, `daily-report`
- `auction-trends-stats`, `source-census`

**Frontend Pages:** `/offering`, `/invest`, `InvestorDashboard.tsx`, `InvestorOffering.tsx`, `AcquisitionPipeline.tsx`

**Owned Tables:** `acquisition_pipeline`, `acquisition_stage_log`, `investor_offerings` (implied)

**Status:** Offering page live at nuke.ag/offering with live stats.

---

## Core DB Tables — Quick Reference

| Table | Owner Dept | Purpose |
|-------|-----------|---------|
| `vehicles` | Vehicle Intelligence | Core entity — 18k+ vehicles |
| `vehicle_images` | Photos | 33M+ images |
| `import_queue` | Extraction | URL intake pipeline |
| `bat_extraction_queue` | Extraction | BaT-specific queue |
| `bat_listings` | Extraction | BaT source data (~4.4k) |
| `auction_comments` | Extraction | 364k+ extracted comments |
| `comment_discoveries` | AI/Vision | AI sentiment analysis |
| `description_discoveries` | AI/Vision | AI field extraction |
| `listing_page_snapshots` | Extraction | All archived pages |
| `organizations` | Orgs & Identity | Dealers, shops, houses |
| `pipeline_registry` | Platform/Infra | Field ownership map (63 entries) |
| `vehicle_observations` | Vehicle Intelligence | Unified observation store |
| `observation_sources` | Vehicle Intelligence | Source registry |
| `vehicle_documents` | Documents | Uploaded docs |
| `vehicle_title_documents` | Documents | Title records |
| `vehicle_transactions` | Deal Flow | Transaction records |
| `vehicle_funds` | Deal Flow | Market exchange funds |
| `work_sessions` | Restoration | Shop work records |

---

## Shared Utilities (`supabase/functions/_shared/`)

| File | Purpose | Critical? |
|------|---------|-----------|
| `archiveFetch.ts` | Fetch any URL + auto-archive to `listing_page_snapshots` | **YES — mandatory** |
| `cors.ts` | CORS headers for all functions | Yes |
| `supabaseClient.ts` | Supabase client factory | Yes |
| `llmProvider.ts` | AI model routing (OpenAI/Gemini) | Yes |
| `normalizeVehicle.ts` | Canonical vehicle data normalization | Yes |
| `resolveVehicleForListing.ts` | Match/create vehicle from extracted data | Yes |
| `proxyConfig.ts` / `proxyRotation.ts` | Residential IP proxy rotation | Yes (extraction) |
| `rlm.ts` | Rate limiting / queue management | Yes |
| `extractionQualityGate.ts` | Quality validation for extracted data | Yes |
| `hybridFetcher.ts` | **DEPRECATED** — use `archiveFetch.ts` | No — avoid |
| `intelligence-layer.ts` | AI analysis orchestration | Yes |
| `vin-decoder.ts` | VIN parsing logic | Yes |

---

## Hard Constraints (Never Violate)

1. **`archiveFetch()` always** — never raw `fetch()` for external URLs. Every page gets archived automatically.
2. **`pipeline_registry` before writing** — query it. 63 fields have owning functions. Direct writes cause data forks.
3. **Image pipeline paused** — `NUKE_ANALYSIS_PAUSED` flag. Don't re-enable. 32M images pending.
4. **BaT two-step** — `extract-bat-core` then `extract-auction-comments`. Not one-step.
5. **Queue inserts only** — don't poll `import_queue` directly. Insert records, `continuous-queue-processor` picks up.
6. **Lock fields** — never touch `locked_by` / `locked_at` on queue tables. Workers manage locks.
7. **Computed fields** — `signal_score`, `nuke_estimate`, `deal_score`, `heat_score`, `data_quality_score` — never write directly.
8. **Quality backfill** — indexes `idx_vehicles_quality_score` and `idx_vehicles_quality_backfill` are DROPPED. Do not recreate until job 228 completes (~69hr from Feb 26).
9. **YONO training** — PID 34496 running. DO NOT KILL.
10. **Supabase export** — check `supabase_export.pid` before touching training-data directory.

---

## Cross-Department Handoff Map

| If the issue is about... | Route to... | Via... |
|--------------------------|------------|--------|
| A source not being scraped | Extraction | `smart-extraction-router` or source-specific function |
| Image classification errors | AI/Vision + Photos | `yono-classify` → `photo-pipeline-orchestrator` |
| Vehicle valuation wrong | Vehicle Intelligence | `compute-vehicle-valuation` |
| Queue stuck / backlog | Platform/Infra | `release_stale_locks()` + `ralph-wiggum` brief |
| Deal transfer not moving | Deal Flow | `transfer-automator` status |
| Org data missing | Orgs & Identity | `create-org-from-url` → `ingest-org-complete` |
| Document not processed | Documents | `document_ocr_queue` insert |
| Photo not uploading | Photos | `image-intake` → `photo-pipeline-orchestrator` |
| Notification not sent | Comms | `webhooks-deliver` → `create-notification` |
| Work order not tracking | Restoration | `work-session` → `telegram-task-worker` |

---

## Frontend Structure (`nuke_frontend/src/pages/`)

| Section | Key Pages | Owner Dept |
|---------|-----------|-----------|
| Vehicle browsing | `Vehicles.tsx`, `VehicleProfile.tsx`, `Search.tsx`, `AuctionMarketplace.tsx` | Vehicle Intelligence |
| Market / Exchange | `MarketExchange.tsx`, `MarketFundDetail.tsx`, `MarketSegments.tsx`, `TradingPage.tsx` | Deal Flow |
| Admin | `AdminDashboard.tsx`, `AdminMissionControl.tsx`, `AdminPendingVehicles.tsx`, `DatabaseAudit.tsx` | Platform/Infra |
| Investor | `InvestorOffering.tsx`, `InvestorDashboard.tsx`, `Invest.tsx`, `AcquisitionPipeline.tsx` | Investor/Business |
| Orgs | `Organizations.tsx`, `OrganizationProfile.tsx`, `BusinessIntelligence.tsx` | Orgs & Identity |
| Vault | `VaultPage.tsx`, `VaultScanPage.tsx` | Documents |
| Restoration | `WiringPlan.tsx`, `RestorationIntake.tsx`, `VehicleJobs.tsx` | Restoration |
| Developer | `DeveloperDashboard.tsx`, `ApiLanding.tsx` | Platform/Infra |
| Photos | `PersonalPhotoLibrary.tsx`, `ImageProcessingDashboard.tsx` | Photos |

---

## Active Work In Flight (as of 2026-02-26)

| Area | Status | DO NOT TOUCH |
|------|--------|-------------|
| YONO Tier 2 training | Running (PID 34496) | Don't kill process |
| Supabase export | Running (~27% complete) | Don't restart |
| Quality backfill (job 228) | ~69hr to complete | Don't recreate dropped indexes |
| Vehicle Profile tabs | Being fixed | VehicleProfile.tsx, vehicle-profile/ |
| FB Marketplace GraphQL | Testing logged-out path | fb-marketplace-* functions |

---

## Quick Status Commands

```bash
# System brief (queue health, errors, recommendations)
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"action\": \"brief\"}"' | jq

# DB stats
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq

# Stale lock check
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "SELECT * FROM release_stale_locks(dry_run:=true);"

# Active agents
cat /Users/skylar/nuke/.claude/ACTIVE_AGENTS.md
```
