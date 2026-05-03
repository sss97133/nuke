# Nuke Tool Registry

**Read this before building anything.** Every common operation has an existing tool.
Building a duplicate wastes compute, creates data forks, and breaks pipeline tracking.

---

## How to Use This Document

1. Find your intent in the table below → use the listed function
2. If your intent isn't here → check `supabase/functions/` before writing new code
3. If you're writing to a DB field → query `pipeline_registry` to see who owns it:
   ```sql
   SELECT * FROM pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';
   ```

---

## Vehicle Data Extraction

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract any listing URL (unknown source) | `extract-vehicle-data-ai` | Handles generic AI extraction |
| Extract Bring a Trailer listing | `complete-bat-import` | Two-step: extract-bat-core + extract-auction-comments. |
| Extract Cars & Bids listing | `extract-cars-and-bids-core` | Handles C&B structure |
| Extract Hagerty Marketplace listing | `extract-hagerty-listing` | |
| Extract PCarMarket listing | `import-pcarmarket-listing` | |
| Extract Craigslist listing | `extract-craigslist` | |
| Extract eBay Motors listing | `extract-ebay-motors` | |
| Extract Facebook Marketplace listing | `extract-facebook-marketplace` or `fb-marketplace-orchestrator` | Use orchestrator for bulk. Supports `mode: "direct"` for agent-extracted data (skips Firecrawl). |
| Import Facebook Saved vehicles | MCP `import_facebook_saved` tool or `scripts/fb-saved-extractor.js` | Two-step: extract (returns browser JS) → submit (POSTs to ingest). Runs client-side in user's browser on facebook.com/saved. |
| Extract Bonhams auction | `extract-bonhams` | |
| Extract RM Sotheby's | `extract-rmsothebys` | |
| Extract Mecum | `extract-mecum` | |
| Extract Gooding & Co | `extract-gooding` | |
| Extract Barrett-Jackson | `extract-barrett-jackson` | |
| Extract Collecting Cars | `extract-collecting-cars-core` | |
| Extract Broad Arrow | `extract-broad-arrow` | |
| Extract ClassicCars.com listing | `import-classiccars-listing` | |
| Extract Hagerty bidding platform | `extract-hagerty-listing` | |
| Route a URL to the right extractor | `extract-vehicle-data-ai` | Use AI extractor directly; `smart-extraction-router` was deleted |
| Queue a URL for background extraction | `continuous-queue-processor` → `import_queue` | Insert to `import_queue`, worker picks it up |

---

## VIN Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Decode a VIN and update vehicle record | `decode-vin-and-update` | Calls NHTSA VPIC API, writes make/model/year/etc. |
| Decode VIN only (no DB write) | `api-v1-vin-lookup` | Returns decoded data |
| Batch decode VINs | `batch-vin-decode` | Processes multiple vehicles |
| Extract VIN from an image | `extract-vin-from-vehicle` | AI-powered OCR from photo |
| Find VIN conflicts | `vin-data-conflicts` table | Query directly |

---

## Vehicle Enrichment

| Intent | Use This | Notes |
|--------|----------|-------|
| Enrich a vehicle profile with AI | `enrich-vehicle-profile-ai` | General AI enrichment |
| Enrich factory specs (OEM data) | `enrich-factory-specs` | Writes OEM spec fields |
| Enrich MSRP | `enrich-msrp` | Writes `vehicles.msrp` |
| Batch enrich pending vehicles | `enrich-bulk` | Calls `enrich-vehicle-profile-ai` in bulk |
| Propagate YMM to related records | `batch-ymm-propagate` | Fixes missing year/make/model |
| Fix vehicle profile issues | `auto-fix-vehicle-profile` | Automated repair |

---

## Scoring & Valuation

| Intent | Use This | Writes To |
|--------|----------|-----------|
| Compute Nuke estimate (AI valuation) | `compute-vehicle-valuation` | `vehicles.nuke_estimate`, `vehicles.nuke_estimate_confidence` |
| Calculate performance/social scores | `calculate-vehicle-scores` | `vehicles.perf_*_score`, `vehicles.social_positioning_score`, `vehicles.investment_quality_score` |
| Assess market signals (deal/heat score) | `analyze-market-signals` | `vehicles.signal_score`, `vehicles.signal_reasons`, `vehicles.last_signal_assessed_at` |
| Calculate profile completeness | `calculate-profile-completeness` | `vehicles.completion_percentage`, `vehicles.data_quality_score` |
| Calculate quality scores | `calculate-vehicle-scores` or `calculate-profile-completeness` | `vehicles.quality_grade` |
| Get comps for a vehicle | `api-v1-comps` | Read-only — returns comparables |
| Get market trends | `api-v1-market-trends` | Read-only |
| Compute taste affinity for FB listings | `compute_taste_score()` (SQL trigger) | `marketplace_listings.taste_score`, `.enrichment_priority` |
| View taste model metrics | `SELECT * FROM taste_model_metrics` | Read-only — hit rate, match rate, misses |
| View taste Smart Folders | `SELECT * FROM taste_smart_folders` | Read-only — intent-matched inventory |
| View geographic taste coverage | `SELECT * FROM taste_geographic_coverage` | Read-only — metro-level gaps |
| Backfill bat_seller → organization links | `npm run backfill:bat-seller-to-org` (script) | `organization_vehicles`, `vehicle_events.source_organization_id`, `external_identities` |
| Backfill ownership classification | `npm run backfill:ownership-classification` (script) | `organization_vehicles.relationship_type` (owner/consigner/supplier_build) |
| Backfill analysis signals | `npm run ops:signals` (script) | `analysis_signals` — calls `analysis-engine-coordinator` per vehicle |
| Compute Auction Readiness Score | `compute_auction_readiness()` (SQL) | `auction_readiness.*` |
| Persist ARS + tier transitions | `persist_auction_readiness()` (SQL) | `auction_readiness`, `ars_tier_transitions` |
| Generate listing package | `generate-listing-package` | Read-only — returns submission bundle |
| MCP: Get ARS | `mcp-connector` → `get_auction_readiness` | Calls `persist_auction_readiness()` |
| MCP: Get coaching plan | `mcp-connector` → `get_coaching_plan` | Read-only from `auction_readiness` |
| MCP: Prepare listing | `mcp-connector` → `prepare_listing` | Read-only preview |
| MCP: Auction briefing | `mcp-connector` → `get_auction_briefing` | One-call composite: identity, auction data, valuation, seller profile, comps, market history, sentiment, condition. Accepts vehicle_id or listing_url. |
| HTTP: Auction briefing | `get-auction-briefing` | Standalone edge function — same composite briefing as MCP tool but callable via HTTP POST. Body: `{vehicle_id}` or `{listing_url}`. Returns identity, auction metrics, seller analytics, comps, sentiment, condition. |
| Seller analytics (SQL) | `get_seller_analytics(p_seller_username)` | Returns seller profile from bat_listings: sell-through rate, pricing stats, engagement metrics, reserve behavior, recent sales, primary makes. ~60ms even for 1400-listing sellers. |

---

## Image Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| Process pending vehicle images (AI analysis) | `photo-pipeline-orchestrator` | Sets `ai_processing_status` |
| Batch process all pending images | `process-all-images-cron` | Cron-driven, calls pipeline orchestrator |
| Classify image angle/perspective | `yono-classify` | YONO local model, writes `vehicle_images.angle` |
| Batch YONO classification | `yono-batch-process` | Bulk angle detection |
| Auto-sort photos into categories | `auto-sort-photos` | Uses `vehicle_images.organization_status` |
| Sync photos from iPhoto library | `scripts/iphoto-intake.mjs` | See MEMORY.md for usage |
| Sync photos from camera roll | `scripts/photo-sync.mjs` | Scans macOS Photos by date, filters vehicle photos via Apple ML labels, uploads and routes through image-intake |
| Upload image and trigger analysis | `image-intake` | Handles upload + queues processing |
| Backfill image angles | `backfill-image-angles` | Retroactively adds angle data |
| Identify vehicle from image | `identify-vehicle-from-image` | AI-powered vehicle recognition |
| Get attribute checklist for a subject (laser-tag harness) | `mcp-connector` tool `get_attribute_checklist` | Returns L1–L5 attribute schedule a caller agent can answer for image / vehicle / person / cluster. Source = `_shared/cockpit/attribute-registry.ts`. Pairs with `submit_attribute_value` for caller-side BYOK extraction. |
| Submit caller-extracted attribute value (laser-tag write) | `mcp-connector` tool `submit_attribute_value` | Caller agent submits a single answer from the checklist. Auto-registers caller's model in `model_registry` (caller_kind='walkin', base_trust=0.30) on first call. Auto-registers prompt in `prompt_template_registry`. Validates value against expected_shape + enum_values. Writes signed envelope to `projection_event`. Result_kind enforced per registry. |
| Query atoms accumulated for a subject (laser-tag read) | `mcp-connector` tool `query_subject_atoms` | Read-side of the laser-tag loop. Returns ALL projection_event atoms for a subject (no top-K), grouped by attribute, each with caller_kind / base_trust / confidence. Composers (work_log, invoice, profile) call this to incorporate caller-extracted atoms before rendering. Multiple submissions per attribute = dialectic; consumer synthesizes. |
| Find subjects needing atoms (laser-tag discovery) | `mcp-connector` tool `find_subjects_needing_atoms` | Discovery for walk-in callers. Returns subjects (image / vehicle) with fewer than min_atoms in projection_event, recent-first. Activates the harness at scale: any third-party LLM can hit this, get a worklist, run the checklist, submit answers. Without this, callers don't know where to start; with it, the entire BYOK compute base can attack thin substrate spots in priority order. |
| Submit batch of attribute values (laser-tag write batch) | `mcp-connector` tool `submit_attribute_values` | Plural version of submit_attribute_value. One call submits N atoms for the same subject + caller. Cuts 17 round-trips to 1 when iterating a full checklist. Same auto-registration semantics. |
| Synthesize consensus value for an attribute (L4 dialectic) | `mcp-connector` tool `synthesize_attribute` | Computes ONE consensus value per (subject, attribute) from all non-retracted atoms, weighted by base_trust × confidence. Returns winner + weighted_confidence + contradiction_score + contributing_atoms. Use when consumers want a single answer instead of the raw atom stream from query_subject_atoms. Implements L4 of project_signal-substrate-five-layer.md. |
| Project invoice from work-order substrate (audit-grade) | `mcp-connector` tool `project_invoice` | Wraps `resolve_work_order_status(query)` RPC and writes the composed invoice to `projection_event` with audit envelope. audience = client (redacted) / irs (provenance-annotated) / internal (full). Re-call to re-project when substrate changes. First implementation of `vehicle.invoice_artifact` — the tax-meld MVP per `project_tax_filing_as_first_meld_mvp.md`. |
| Project shop work-log for a date (journal-shaped) | `mcp-connector` tool `project_work_log` | Composes photos + work_order_{labor,parts,payments} for one shop day, audience-tiered (public/owner/counterparty). Returns `vehicle.work_log_artifact` with provenance. Same engine as project_invoice, time-bounded subject. Audit row to `projection_event`. Powers nuke.ag/journal/[date] once the route is wired. |
| Project money-flow artifact for a window (AR + expenses + monthly) | `mcp-connector` tool `project_money_flow` | Composes (1) accounts receivable from work_orders less completed work_order_payments, (2) expenses out grouped by receipts.scope_type/scope_id, (3) monthly income vs expense over the trailing 6 months. Returns `money_flow_artifact` with audit envelope. Powers nuke.ag/me/money. audience = owner (default) / counterparty (scoped). |
| Validate image is a vehicle | `validate-vehicle-image` | Screening step (GPT-4o, quota exhausted) |
| Check image matches assigned vehicle | `check-image-vehicle-match` | Claude Haiku vision — classifies as confirmed/mismatch/ambiguous/unrelated |
| Reprocess stale images | `trickle-backfill-images` | Slow drip backfill |
| Ingest a video frame (GoPro/dashcam/etc.) | `ingest-video-frame` | Inserts vehicle_images row (source='gopro_frame'/etc) + image_observations row (role='subject', vehicle_id=null, confidence_basis carries source_clip/frame_offset/wall_clock/youtube_url/inherited_lat-lon). Idempotent on content_sha256. Per chapter 12 image_observations foundation. |
| Universal artifact intake (photo / video_frame / receipt / bank_tx / card_tx / work_order / document) | `ingest-artifact` | Single front door — discriminated union by `kind`. Validates source, dedups by content_sha256 via `artifact_dispatch_log`, routes to type-appropriate handler (photo→orchestrator, video_frame→ingest-video-frame, receipt/work_order/document→ingest-observation, bank_tx/card_tx→Phase-2 stub). ALWAYS emits observations through `ingest-observation` — never writes vehicle_observations directly. Contract: `docs/library/technical/engineering-manual/16-artifact-dispatcher.md`. |
| Map receipt → entity scope (NUKE / Viva / personal / household / vehicle) | `classify-receipt-scope` | Deterministic-first (attribution block → card lookup → merchant regex → line-item category → gpt-4o-mini fallback). Returns `{scope_type, scope_id, method, confidence, reasons[]}`. Used by Jenny-receipt ingest and the 2,034-row backfill. |

---

## Comments & Sentiment Analysis

| Intent | Use This | Notes |
|--------|----------|-------|
| Extract auction comments from BaT | `extract-auction-comments` | Scrapes BaT page, writes to `auction_comments` |
| Discover/analyze comment data with AI | `discover-comment-data` | Writes to `comment_discoveries` |
| Fast batch comment analysis | `analyze-comments-fast` | Batch version of discovery |
| Batch comment discovery | `batch-comment-discovery` | Parallel comment analysis |
| Update live sentiment | `update-live-sentiment` | Writes to `auction_sentiment_timeline` |

---

## Document Processing

| Intent | Use This | Notes |
|--------|----------|-------|
| OCR a vehicle document | `document-ocr-worker` | Reads from `document_ocr_queue` |
| Queue a document for OCR | Insert to `document_ocr_queue` | Worker picks up automatically |
| Extract title/registration data | `extract-title-data` | Writes to `vehicle_title_documents` |
| Parse reference documentation | `parse-reference-document` | Service manuals, specs |
| Detect sensitive content in document | `detect-sensitive-document` | PII screening |

---

## Agent Hierarchy (Haiku/Sonnet/Opus)

| Intent | Use This | Notes |
|--------|----------|-------|
| Run full extraction pipeline (Haiku+Sonnet) | `agent-tier-router` with `{"action":"run_pipeline","pipeline_config":{"haiku_batch_size":10,"max_cycles":1}}` | Dispatches Haiku workers, Sonnet reviews |
| Route a task to the right tier | `agent-tier-router` with `{"action":"route_task","task_type":"...","task_data":{}}` | Auto-classifies complexity |
| Get agent system status | `agent-tier-router` with `{"action":"status"}` | Queue counts, tier health, cost estimates |
| Get cost report | `agent-tier-router` with `{"action":"cost_report"}` | Cost breakdown by tier, savings vs Sonnet-only |
| Run Opus strategy query | `agent-tier-router` with `{"action":"strategy","strategy_query":"..."}` | Source prioritization, market intel |
| Extract listing with Haiku (cheap) | `haiku-extraction-worker` with `{"action":"extract_listing","url":"...","html":"..."}` | 3x cheaper than Sonnet |
| Parse title with Haiku | `haiku-extraction-worker` with `{"action":"parse_title","title":"..."}` | Fast YMM extraction |
| Batch parse titles | `haiku-extraction-worker` with `{"action":"parse_titles","titles":["..."]}` | Single API call for many titles |
| Process queue batch with Haiku | `haiku-extraction-worker` with `{"action":"batch_extract","batch_size":10}` | Pulls from import_queue |
| Supervisor review batch | `sonnet-supervisor` with `{"action":"review_batch","batch_size":10}` | Reviews Haiku escalations |
| Supervisor dispatch + review | `sonnet-supervisor` with `{"action":"dispatch_haiku"}` | Full loop: dispatch Haiku then review |
| Resolve edge case | `sonnet-supervisor` with `{"action":"resolve_edge_case","content":"..."}` | Complex vehicles (replicas, restomods) |
| Quality report | `sonnet-supervisor` with `{"action":"quality_report"}` | Extraction quality metrics |

### Tier Routing Rules
- **Haiku** ($1/$5 per MTok): Routine extraction, title parsing, field extraction, simple classification
- **Sonnet** ($3/$15 per MTok): Quality review, edge cases, multi-field validation, escalation decisions
- **Opus** ($5/$25 per MTok): Source prioritization, market intelligence, pipeline optimization strategy

---

## Analysis Engine

| Intent | Use This | Notes |
|--------|----------|-------|
| Get analysis status | `analysis-engine-coordinator` with `{"action": "status"}` | Widget counts, signal counts, queue health |
| Evaluate all widgets for a vehicle | `analysis-engine-coordinator` with `{"action": "evaluate_vehicle", "vehicle_id": "..."}` | Runs all configured widgets, upserts signals |
| Run cron sweep (stale/new vehicles) | `analysis-engine-coordinator` with `{"action": "sweep", "batch_size": 20}` | Finds stale signals, queues recomputation |
| Process analysis queue | `analysis-engine-coordinator` with `{"action": "compute", "batch_size": 20}` | Claims and processes queue items |
| Trigger from observation | `analysis-engine-coordinator` with `{"action": "observation_trigger", "vehicle_id": "...", "observation_kind": "..."}` | Queues relevant widgets |
| Get analysis dashboard | `analysis-engine-coordinator` with `{"action": "dashboard", "vehicle_id": "..."}` | All signals by severity |
| Acknowledge signal | `analysis-engine-coordinator` with `{"action": "acknowledge", "signal_id": "..."}` | Mark as seen |
| Dismiss/snooze signal | `analysis-engine-coordinator` with `{"action": "dismiss", "signal_id": "...", "dismiss_hours": 72}` | Hide for N hours |
| Sell-through cliff analysis | `widget-sell-through-cliff` with `{"vehicle_id": "..."}` | DOM-based sell-through probability |
| Rerun decay analysis | `widget-rerun-decay` with `{"vehicle_id": "..."}` | Multi-listing price decay tracking |
| Deal health composite | `widget-time-kills-deals` with `{"vehicle_id": "..."}` | Master aggregator of 7 sub-signals |
| Completion discount | `widget-completion-discount` with `{"vehicle_id": "..."}` | Deficiency detection + buyer discount calc |
| Presentation ROI | `widget-presentation-roi` with `{"vehicle_id": "..."}` | Photo/description quality scoring |
| Broker exposure | `widget-broker-exposure` with `{"vehicle_id": "..."}` | Multi-platform exclusivity erosion |
| Buyer qualification | `widget-buyer-qualification` with `{"vehicle_id": "..."}` | Buyer readiness scoring via deal jacket |
| Commission optimizer | `widget-commission-optimizer` with `{"vehicle_id": "..."}` | Commission structure + margin analysis |
| Deal readiness | `widget-deal-readiness` with `{"vehicle_id": "..."}` | Checklist-based deal closing readiness |
| Geographic arbitrage | `widget-geographic-arbitrage` with `{"vehicle_id": "..."}` | Regional price differential analysis |
| Map data (choropleth/points/histogram) | `map-vehicles` with `mode=state\|county\|points\|histogram` | Supports bbox, zoom, time_start/end, make, year/price filters. Temporal county uses VLO county_fips index. |
| County detail (vehicles, makes, platforms) | `get_county_detail(p_fips)` RPC | Returns JSONB: top 20 vehicles, make distribution, platform breakdown |
| Make geographic density | `get_make_heatmap(p_make)` RPC | Returns county-level density for a specific make from mv_make_geographic_density |
| Nearby vehicles | `find_vehicles_near(p_lat, p_lng, p_radius_miles)` RPC | Spatial search on vehicles.gps_latitude/longitude |
| **SDK/API: Get all signals** | `api-v1-analysis` GET `?vehicle_id=<uuid>` | Auth required. Returns health + all signals |
| **SDK/API: Get single signal** | `api-v1-analysis` GET `?vehicle_id=<uuid>&widget=<slug>` | Single widget signal |
| **SDK/API: Refresh signals** | `api-v1-analysis` POST `{"action":"refresh","vehicle_id":"..."}` | Triggers recompute |
| **SDK/API: Signal history** | `api-v1-analysis/history` GET `?vehicle_id=<uuid>&widget=<slug>` | Change history |

### Analysis Engine Tables
- `analysis_widgets` — Widget registry (14 widgets, 6 categories)
- `analysis_signals` — Per-vehicle widget outputs (UNIQUE vehicle_id + widget_slug)
- `analysis_signal_history` — Audit trail of changes
- `analysis_queue` — Processing queue (same lock pattern as import_queue)

### Cron: Job 368 — `analysis-engine-sweep` every 15 minutes

---

### import_queue Status Flow
```
pending → [haiku-extraction-worker] → complete (auto-approved, quality >= 0.9)
                                    → pending_review (needs supervisor, quality 0.6-0.9)
                                    → pending_review (escalated, no content or low confidence)
pending_review → [sonnet-supervisor] → complete (approved or corrected)
                                     → pending_strategy (escalated to Opus)
                                     → failed (rejected)
```

---

## Queue Management

| Intent | Use This | Notes |
|--------|----------|-------|
| Check overall pipeline health | `ralph-wiggum-rlm-extraction-coordinator` with `{"action":"brief"}` | Returns queue stats, errors, recommendations |
| Check queue status | `queue-status` | `import_queue` breakdown |
| View pipeline dashboard | `pipeline-dashboard` | Full system overview |
| Check database stats | `db-stats` | Vehicle/image/queue counts |
| Release stale locked records | `SELECT release_stale_locks()` | SQL function — releases locks older than 30 min |
| Check system health | `system-health-monitor` | |
| Monitor extraction health | `extraction-watchdog` | Alerts on failures |
| **Data quality report (all sources)** | `data-quality-monitor` with `{"action":"report"}` | Per-source YMM%, VIN%, price%, grade A-F |
| **Data quality alerts only** | `data-quality-monitor` with `{"action":"alerts"}` | Only sources with issues |
| **Snapshot quality metrics to DB** | `data-quality-monitor` with `{"action":"snapshot"}` | Writes to source_quality_snapshots (cron runs at 2am UTC) |
| **Query live quality view** | `SELECT * FROM source_quality_current` | Live per-source stats (slow on full table) |
| Process queued imports | `continuous-queue-processor` | **Don't call directly** — runs on cron |

---

## BaT-Specific Operations

| Intent | Use This | Notes |
|--------|----------|-------|
| Queue BaT listings for extraction | `crawl-bat-active` | Discovers active auctions |
| Process BaT extraction queue | `process-bat-extraction-queue` | Works `bat_extraction_queue` |
| Monitor a BaT seller | `bat-seller-monitors` table | Insert record to start monitoring |
| Monitor a BaT buyer | `bat-buyer-monitors` table | Insert record to start monitoring |
| Parse BaT snapshot HTML | `bat-snapshot-parser` | Parses archived BaT pages |
| Extract a BaT listing (entry point) | `complete-bat-import` | Calls extract-bat-core + extract-auction-comments in sequence |

---

## Organizations

| Intent | Use This | Notes |
|--------|----------|-------|
| Create org from URL | `create-org-from-url` | Scrapes site, creates `organizations` record |
| Update org from website | `update-org-from-website` | Refreshes org data |
| Classify organization type | `classify-organization-type` | Sets `organizations.type` |
| Get org due diligence | `generate-org-due-diligence` | AI analysis report |
| Merge duplicate orgs | `auto-merge-duplicate-orgs` | Deduplication |

---

## Work Order Intelligence

| Intent | Use This | Notes |
|--------|----------|-------|
| "Update me on the [name] build" | `resolve_work_order_status(p_query)` RPC | One call, full answer. Returns vehicle, contact, all work orders with itemized parts/labor/payments/balance. Callable via `supabase.rpc()`, curl, or `npm run wo:resolve` |
| Get balance for a single work order | `work_order_balance(p_work_order_id)` RPC | Returns JSONB balance summary via `work_order_receipt_unified` view |
| View unified receipt for all work orders | `SELECT * FROM work_order_receipt_unified` | Bridges system 1 (timeline_events) and system 2 (work_orders) |
| Ingest Zelle payments from iMessage | `npm run wo:ingest-zelle -- --vehicle <id>` | Reads SMS short code 767666 from chat.db, dedupes, writes to `work_order_payments` |
| Seed parts from known receipts | `npm run wo:ingest-receipts -- --seed` | Pre-extracted Amazon/Summit receipts → `work_order_parts` |
| Ingest iMessage thread events | `npm run wo:ingest-thread -- "+1XXXXXXXXXX" --vehicle <id>` | Classifies messages into price_agreement, scope_change, status_update → `vehicle_observations` |
| Look up book hours for an operation | `estimate_labor_from_description(text, year)` | Searches `labor_operations` table (64 operations) |
| Resolve labor rate for a job | `resolve_labor_rate(org, user, vehicle, client)` | Cascade: contract → user → org → system_default ($125) |
| Send invoice email to customer | `send-invoice-email` | POST `{ to, subject, invoice_number, customer_name, vehicle_title, invoice_date, total, paid, balance, line_items }`. Builds HTML email, sends via Resend, updates `generated_invoices.sent_at`. Called from GenerateBill.tsx. |

---

## Platform Accounting & Financials

| Intent | Use This | Notes |
|--------|----------|-------|
| Get financial summary (public) | `platform-financials` action=`summary` | No auth required. Returns revenue, expenses, burn rate, health, recent income. |
| Income statement (monthly P&L) | `platform-financials` action=`income_statement` | Service key required. Revenue/COGS/expenses/net income by month. |
| Balance sheet | `platform-financials` action=`balance_sheet` | Service key required. Assets/liabilities/equity/revenue/expenses. |
| Platform burn rate | `platform-financials` action=`burn_rate` | Service key required. 30/60/90 day tech spend + monthly detail. |
| Accounting health check | `platform-financials` action=`health` | Service key required. Unposted counts, ledger balance, freshness. |
| Post unposted platform expenses | `SELECT post_unposted_expenses()` | Idempotent. Maps vendor→account via `vendor_account_mapping`. |
| Post unposted QB transactions | `SELECT post_unposted_qb_transactions()` | Idempotent. Posts Purchase-type QB entries. |
| Post vehicle sale revenue | `SELECT post_vehicle_sale_revenue(vehicle_id, price, date, acq_cost, buyer)` | Dr Cash / Cr Revenue + optional COGS. |
| Post unposted invoices | `SELECT post_unposted_invoices()` | Dr AR / Cr Labor Revenue for generated_invoices. |
| Reconcile expenses across sources | `SELECT reconcile_expenses()` | Matches platform_expenses↔qb_transactions by date+amount+vendor. |
| View trial balance | `SELECT * FROM trial_balance` | Shows all accounts with debit/credit totals. Must sum to 0. |
| Monthly expense ledger | `SELECT * FROM ledger_monthly` | Journal-backed. Replaces old platform_expenses-only view. |
| View all accounts | `SELECT * FROM balance_sheet` | Shows every account with natural balance. |

---

## Wiring System (Agentic Harness Design)

| Intent | Use This | Notes |
|--------|----------|-------|
| Compute wiring overlay (harness spec) | `compute-wiring-overlay` | POST `{ vehicle_id }`. Returns wire list, ECU/PDM/alternator sizing, bulkhead pin assignments, warnings. Upserts to `vehicle_wiring_overlays`. |
| Generate harness fabrication spec | `generate-harness-spec` | POST `{ vehicle_id, format? }`. Formats: "full" (JSON+text), "text" (plaintext spec), "csv" (wire schedule for Excel), "workstation" (live build progress + blockers), "wire_schedule" (tables only). The document you hand to a fabricator or Fiverr illustrator. |
| Render wiring visual (DB-driven) | `render-wiring-visual` | POST `{ vehicle_id, visual_type, target?, mode?, format? }`. visual_type: "connector_face" / "cutting_list" / "wire_schedule" / "formboard" / "list". mode: "blank" / "populated". target: "M130_Connector_A", "D38999_J61", "ENGINE", "DASH", etc. Returns SVG + completeness_pct + missing_data[] + warnings[]. Use "list" to discover all available targets. |
| Scan wiring enrichment gaps | `npm run wiring:gaps` | Scans all 131 devices, reports P0-P7 gaps (missing pin maps, datasheets, cavity layouts, current ratings, prices, wire lengths, crimp specs). Generates agent prompts for automated gap-filling. |
| Harness build workstation view | `SELECT * FROM harness_workstation` | Live builder spreadsheet — every device with zone, integration decision (KEEP/REPLACE/NEW/SPLICE), wire progress (not_started→wire_cut→terminated→installed→tested→verified), blockers, and notes. Pull this up every time you work on the harness. |
| Update wire build progress | `UPDATE vehicle_build_manifest SET wire_status = 'terminated' WHERE device_name = '...'` | Track physical build progress per device. |
| Generate vehicle-layout diagram (plan view SVG) | `generate-vehicle-diagram` | POST `{ vehicle_id, view?, show_bulkhead?, highlight_zone? }`. Returns `diagram_url` + summary. View: "plan" (top-down truck layout), "engine_bay", "dash", etc. Toggle bulkhead connector in/out — wire lengths auto-recalculate. |
| Generate connection diagram (WireViz) | `generate-wiring-diagram` | POST `{ vehicle_id, zone?, format? }`. Returns `diagram_url` + summary. Connection-level nodes-and-edges diagram via Kroki.io. Zone optional. Format: "svg" (default) or "png". |
| Generate wiring BOM | `generate-wiring-bom` | POST `{ vehicle_id }`. Parts list with pricing. |
| Generate cost quote | `generate-wiring-quote` | POST `{ vehicle_id }`. Itemized labor + parts quote. |
| Read/write build manifest | `execute_sql` MCP on `vehicle_build_manifest` | INSERT/UPDATE devices directly. |
| Search GM wiring specs | `search_service_manuals` MCP | Torque specs, wire gauges, procedures. |
| Resolve components | SQL on `component_library` | 95 entries, extensible via INSERT. |
| Tech-packet: wire list | `supabase.rpc('wiring_tech_wire_list', { p_vehicle_id })` | Unioned upgrade + custom circuits with gauge/color/length/fuse/category. `src` column = 'upgrade' or 'custom'. Mirrors `gen_wire_list()` in `wiring/scripts/generate_k5_tech_packet.py`. |
| Tech-packet: PDM channel map | `supabase.rpc('wiring_tech_pdm_channel_map', { p_vehicle_id })` | One row per real PDM output (PDM30 + PDM15). Columns: pdm, channel, device, wire_gauge_awg, wire_color, fuse_rating_amps, circuit_code. Input: `'e04bf9c5-b488-433b-be9a-3d307861d90b'::uuid` for K5. |
| Tech-packet: BOM wire rollup | `supabase.rpc('wiring_tech_bom_wire', { p_vehicle_id })` | Wire quantities by (gauge, color) with +30% margin + suggested spool size (25ft/100ft/500ft). |
| Tech-packet: BOM connectors | `supabase.rpc('wiring_tech_bom_connectors', { p_vehicle_id })` | Connectors rolled up by (device_model, connector_type, pin_count). Always includes MoTeC + peripheral fallback set. |
| Tech-packet: manifest summary | `supabase.rpc('wiring_tech_manifest_summary', { p_vehicle_id })` | One-row summary: devices_total, devices_purchased, devices_pending, spent_usd, pending_usd, total_spec_usd. |

### Agentic Loop
```
User: "Move the ECU under the dash"
Agent: → UPDATE location_zone = 'dash' in manifest
       → Bulkhead connector auto-inserts (engine↔interior boundary)
       → Wire lengths recalculate (engine devices route through bulkhead)
       → curl generate-vehicle-diagram { vehicle_id, view: "plan" }
       → Returns plan view SVG with ECU under dash, wires through milspec connector
```

**Retired:** `query-wiring-needs` (NL query handler) — the agent IS the NL interface now.

---

## Discovery & Lead Generation

| Intent | Use This | Notes |
|--------|----------|-------|
| Discover vehicles from a source URL | `discover-from-observations` | Source-agnostic |
| Discover squarebody Craigslist listings | `discover-cl-squarebodies` | Regional CL scanner |
| Discover barn finds | `barn-finds-discovery` | Monitors barn find sources |
| Discover build threads | `discover-build-threads` | Forum build thread finder |
| Recursive lead discovery | `discovery-snowball` | Follows discovery chains |

---

## Search & Lookup

| Intent | Use This | Notes |
|--------|----------|-------|
| Search vehicles, orgs, users, tags | `universal-search` | Magic input handler with thumbnails |
| API vehicle search | `api-v1-search` | REST API endpoint |
| Get vehicle history | `api-v1-vehicle-history` | Historical data |
| Get auction data | `api-v1-vehicle-auction` | Auction-specific fields |
| Get observations for a vehicle | `api-v1-observations` | All source observations |

---

## Observation Ingestion

| Intent | Use This | Notes |
|--------|----------|-------|
| Ingest a single observation | `ingest-observation` | Unified intake: dedup, vehicle resolution, confidence scoring. All extractors write through here. |
| Ingest observations in bulk | `ingest-observation-batch` | Wraps `ingest-observation` for batch processing. Max 200 per request. Options: `gap_fill` (backfill vehicles table), `write_evidence` (field_evidence rows). |
| Write observation + gap-fill + evidence (from code) | `import { writeObservation } from "../_shared/observationWriter.ts"` | Shared module for edge functions. Wraps observation + Tetris gap-fill + field_evidence in one call. |
| Migrate legacy data to observations | `migrate-to-observations` | Ports existing auction_comments, vehicle_events, etc. to vehicle_observations |

---

## External Agent Write API (`/v1/events`)

Public agent-writable surface. External LLM agents (Claude, ChatGPT, etc.) submit structured vehicle events on behalf of authenticated users. See `docs/external-agent-write-api.md`, `docs/api/QUICKSTART.md`, and the OpenAPI spec at `docs/api/openapi.yaml` (v1.5.0+).

| Intent | Use This | Notes |
|--------|----------|-------|
| Submit a vehicle event (REST) | `POST nuke.ag/v1/events` → `api-v1-events` | Envelope spec at `docs/api/schemas/v1/envelope.json`. Maps `event_type=service` → `kind=work_record` source=`shop`; `event_type=note` → `kind=comment` source=`agent-submission`. VIN is canonical key (resolved internally). |
| Read events back (REST) | `GET nuke.ag/v1/events?vin={VIN}` → `api-v1-events` | Returns events written through `/v1/events` (filtered by source: shop, agent-submission). Params: `limit` (default 50, max 200), `include_superseded` (default false). |
| Submit a vehicle event (MCP) | MCP tool `submit_vehicle_event` (in `mcp-connector`) | Wraps `/v1/events` with VIN-keyed entry. Same envelope. |
| Get event JSON Schema (MCP) | MCP tool `get_event_schema` | Returns inline Draft 2020-12 schema for self-validation. |
| Verify VIN access (MCP) | MCP tool `verify_vehicle_access` | Returns whether caller's scopes can write to a VIN. |
| Issue a key for a specific VIN | `nuke.ag/settings/connected-agents` | Scope grammar: `events:write:vehicle:{vin}` (narrow) or `events:write:all` (broad). |
| Discover the public surface | `https://nuke.ag/v1/openapi.json` (programmatic) or `https://nuke.ag/api/docs` (Redoc UI) | OpenAPI 3.1 spec. |

**Auth contract:** `X-API-Key: nk_live_...` (preferred for external agents) OR `Authorization: Bearer <service-role>` (internal). Per-vehicle scope check via `_shared/apiKeyAuth.ts → requireVehicleScope()` and `_shared/scopeGrammar.ts`. Rate limits enforced atomically via `check_api_key_rate_limit(p_key_hash, p_endpoint)` RPC.

**Substrate:** Reuses `vehicle_observations` + `ingest-observation`. Append-only with supersession via `is_superseded`/`superseded_by` (correction_of in envelope).

---

## YONO (Local Vision Model)

| Intent | Use This | Notes |
|--------|----------|-------|
| Full image intelligence (make + condition + zone + damage) | `api-v1-vision/analyze` | POST `{image_url}` → make, condition_score, vehicle_zone, damage_flags, $0/image |
| Classify make from image | `api-v1-vision/classify` or `yono-classify` | Hierarchical: tier1 family, tier2 make. $0/image |
| Analyze condition/zone/damage | `yono-analyze` | Florence-2 vision analysis. Writes to vehicle_images if image_id provided |
| Batch classify images | `api-v1-vision/batch` or `yono-batch-process` | Bulk version, max 100 images |
| Background vision processing | `yono-vision-worker` | Cron worker, claims batches, writes to vehicle_images |
| Keep sidecar warm | `yono-keepalive` | Pings Modal every 5 min (cron job 249) |
| Export training data | `export-training-batch` | Prepares training dataset |
| Sidecar URL | `YONO_SIDECAR_URL` env var | Default: `https://sss97133--yono-serve-fastapi-app.modal.run` |

### Modal GPU Jobs (yono/)

| Intent | Tool | Notes |
|--------|------|-------|
| Batch extract descriptions (235K backlog) | `modal run yono/modal_description_discovery.py` | Qwen2.5-7B 4-bit on T4, 4 containers, writes `description_discoveries` with `model_used='qwen2.5:7b-modal'` |
| GLiNER NER extraction | `modal run yono/modal_extract.py` | GLiNER medium-v2.1, writes `vehicle_observations` |
| LLM inference server | `modal deploy yono/modal_vllm_serve.py` | Qwen2.5-7B HTTP API, used by `--provider modal` |
| YONO vision batch | `modal run yono/modal_batch.py` | Florence-2 + classifiers, writes `vehicle_images` |
| YONO classification API | `modal deploy yono/modal_serve.py` | REST API for image classification |

---

## DO NOT BUILD THESE — They Already Exist

These are the most common "agent reimplementation" antipatterns. If you find yourself writing any of these, stop and use the existing tool.

| What you're about to build | What to use instead |
|---------------------------|---------------------|
| A VIN decoder | `decode-vin-and-update` |
| A fetch wrapper that saves pages | `_shared/archiveFetch.ts` — use `archiveFetch()` |
| An image AI analyzer | `photo-pipeline-orchestrator` |
| A queue poller | `continuous-queue-processor` — insert to queue, don't poll |
| A "get vehicle data" endpoint | `api-v1-vehicles` |
| A duplicate detector | `duplicate-detection-jobs` table + `auto-merge-duplicate-orgs` |
| A vehicle valuation calculator | `compute-vehicle-valuation` |
| A comment sentiment analyzer | `discover-comment-data` |
| A search endpoint | `universal-search` |
| A BaT scraper | `complete-bat-import` |
| A Craigslist scraper | `extract-craigslist` or `discover-cl-squarebodies` |
| A Facebook scraper | `extract-facebook-marketplace` |
| A market trend calculator | `calculate-market-trends` |

---

## Key Shared Utilities (`supabase/functions/_shared/`)

Always import from these rather than reimplementing:

| File | Purpose |
|------|---------|
| `archiveFetch.ts` | Fetch any URL + auto-archive to `listing_page_snapshots` |
| `cors.ts` | CORS headers |
| `supabaseClient.ts` | Supabase client factory |
| `hybridFetcher.ts` | **Deprecated** — use `archiveFetch.ts` instead |

---

## Pipeline Ownership Quick Reference

Query the `pipeline_registry` table for authoritative field ownership:

```sql
-- Who owns a field?
SELECT owned_by, description, do_not_write_directly
FROM pipeline_registry
WHERE table_name = 'vehicles' AND column_name = 'nuke_estimate';

-- What does a function write?
SELECT table_name, column_name, description
FROM pipeline_registry
WHERE owned_by = 'compute-vehicle-valuation';

-- All fields agents should not write directly
SELECT table_name, column_name, owned_by
FROM pipeline_registry
WHERE do_not_write_directly = true
ORDER BY table_name, column_name;
```

---

## Queue Insert Patterns

### Add a URL to the extraction queue
```sql
INSERT INTO import_queue (listing_url, listing_title, status, priority)
VALUES ('https://bringatrailer.com/listing/...', 'Optional Title', 'pending', 100);
```

### Add a document for OCR
```sql
INSERT INTO document_ocr_queue (storage_path, status, priority, document_type)
VALUES ('vehicle-docs/abc123.pdf', 'pending', 50, 'title');
```

### Check queue depth
```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c \
  'curl -s "$VITE_SUPABASE_URL/functions/v1/queue-status" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

---

## Operational Notes

- **Never write `ai_processing_status`, `signal_score`, `nuke_estimate`, `deal_score`, or `heat_score` directly.** These are computed fields owned by specific pipeline functions.
- **Never change `locked_by` / `locked_at` on queue tables.** The lock mechanism is managed by queue workers; breaking it causes duplicate processing.
- **Check `ACTIVE_AGENTS.md`** before touching any edge function file — another agent may be mid-deployment.

---

## Archived (deployed but not invoked)

Per `slim-by-deactivate-not-delete`: storage is cheap, compute hurts. These functions remain deployed (zero idle cost) but are not called from frontend, MCP, or active crons as of 2026-04-25 audit. Treat as retired — do not invoke, do not extend. Recovery is one-line if a use case re-emerges.

Confidence ratings reflect how thoroughly the audit could rule out callers. Promote a function to a category above before re-using it; remove from this list with a dated note.

| Function | Confidence | Reason | Eval source |
|---|---|---|---|
| `extract-bh-auction` | MEDIUM | Only legacy `loadVehicleImages.ts` reference; no live invocation found | infra-stewardship-eval-2026-04-25 |
| `extract-premium-auction` | MEDIUM | Same as above | infra-stewardship-eval-2026-04-25 |
| `imessage-router` | HIGH | Superseded by local script `imessage-bridge.mjs` | infra-stewardship-eval-2026-04-25 |
| `gmail-alert-poller` | MEDIUM | No frontend reference; no cron schedule | infra-stewardship-eval-2026-04-25 |
| `review-agent-submissions` | MEDIUM | No frontend reference; no live caller | infra-stewardship-eval-2026-04-25 |

**Pending invocation-log review (~15-20 more):** the audit identified ~20-25 truly orphaned functions out of 195 deployed. The five above are the highest-confidence subset where callers were ruled out via grep. The rest need 30-day no-fire confirmation from `cron.job_run_details` and edge function logs before they can be marked archived. Until then, they remain in the active list as middling.

**Functions kept despite rare invocation:** `live-admin`, `nlq-sql`, `onboard-source` — admin-only or registry-growth paths. Low frequency is by design, not orphan status.
- **Always use `archiveFetch()`** for fetching external URLs — never raw `fetch()`.
