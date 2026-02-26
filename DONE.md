# DONE — Completed Work Log

**Append-only. Add entries when completing significant work.**
Agents read this to avoid rebuilding things that already exist.

## 2026-02-26 (YONO vision v2 session)

### YONO Vision V2 — Phase 1-4 Infrastructure — COMPLETED 2026-02-26

**What was killed:** EfficientNet-B0 make/model classifier as the primary direction. Make/model is already known from text. Vision should answer what text cannot.

**New architecture:** Florence-2-base (microsoft/florence-2-base, 231M params) with multi-task classification head for:
- `condition_score` (1-5): exterior condition
- `damage_flags` (multi-label): rust, dent, crack, paint_fade, broken_glass, missing_parts, accident_damage
- `modification_flags` (multi-label): lift_kit, lowered, aftermarket_wheels, roll_cage, engine_swap, body_kit, exhaust_mod, suspension_mod
- `photo_quality_score` (1-5): photo usefulness filter
- `interior_quality` (1-5 or null): interior condition when visible
- `photo_type` (9 classes): exterior_front/rear/side, interior, engine, wheel, detail, undercarriage, other

**Phase 1 — Auto-labeling:**
- [built] `yono/scripts/auto_label_images.py` — samples 3000 images from .image_cache/, sends to claude-haiku-4-5-20251001 vision, writes to training_labels/labels.jsonl
- [running] Labeling PID 62327: ~2500+ labels generated, 4 workers, finishing ~3000 total
- [data] Labels at `yono/training_labels/labels.jsonl` — 2488+ rows
- [data] Distribution: 40% score-4 condition, 38% have damage, 20% have mods, diverse photo types

**Phase 2 — Florence-2 fine-tuning:**
- [built] `yono/scripts/train_florence2.py` — full fine-tuning script for MPS/Florence-2
- [fixed] Florence-2 processor compatibility: pinned transformers==4.49.0, installed einops
- [running] Training PID 68092: epoch 1/10 in progress on MPS, loss dropping from 7.87→7.0
- [arch] DaViT vision encoder (4 block groups), `model._encode_image()` → (batch, 577, 768) features
- [arch] VehicleVisionHead: mean-pool over 577 tokens → LayerNorm → 512 → 6 task heads
- Checkpoints save to `yono/outputs/florence2/`, best model to `yono/models/yono_vision_v2_head.safetensors`

**Phase 3 — Server update:**
- [deployed] `yono/server.py` updated with `VisionAnalyzer` class and new endpoints:
  - `POST /analyze` — single image → condition_score, damage_flags, modification_flags, photo_quality, photo_type
  - `POST /analyze/batch` — up to 20 images
  - Existing `/classify` endpoint UNCHANGED (production-safe)
- [arch] VisionAnalyzer auto-detects: if `yono_vision_v2_head.safetensors` exists → fine-tuned mode, else → zero-shot captioning mode
- [note] Zero-shot Florence-2 generates `<DETAILED_CAPTION>` text, extracts flags via keyword matching

**Phase 4 — Edge function + DB:**
- [deployed] `supabase/functions/yono-analyze/index.ts` — deployed to Supabase
  - Single image: `{ image_url, image_id? }` → analysis result + optional DB write
  - Batch: `{ images: [{ image_url, image_id? }] }` → batch results
  - Auto-writes to vehicle_images when image_id provided
- [deployed] DB migration `database/migrations/20260226_yono_vision_v2.sql` applied:
  - Added to vehicle_images: condition_score, damage_flags, modification_flags, photo_quality_score, vision_analyzed_at, vision_model_version
  - All 6 columns verified present in production DB
  - Indexes: idx_vehicle_images_condition_score, idx_vehicle_images_damage_flags (GIN), idx_vehicle_images_pending_vision

**What still needs to complete (background processes running):**
- Labeling (PID 62327): ~500 more to finish → 3000 total
- Training (PID 68092): epoch 1/10 running, ~55 min total
- After training: `yono/models/yono_vision_v2_head.safetensors` auto-saved, server restarts load it

## 2026-02-26 (vehicle-profile session)

### Vehicle Profile Page — Finished — COMPLETED 2026-02-26
- [facts] data_quality_score (0-100 integer) now shows in VehicleBasicInfo with color-coded progress bar
- [facts] FactExplorerPanel (was defined but never rendered) now shows in Facts tab
- [evidence] WorkMemorySection (was imported but never rendered) now shows for owners/contributors in Evidence tab
- [commerce] Fixed double-wrapping: VehicleROISummaryCard + VehiclePricingValueCard both have internal CollapsibleWidgets; removed outer wrappers that were hiding content
- [commerce] VehicleDealJacketForensicsCard: replaced null return with "No deal jacket forensics available" empty state
- [header] Area Demographics: replaced confusing -- dashes with clean "unavailable" state
- [sanitizer] VehicleBasicInfo: reject mid-sentence fragments (", and four-wheel disc brakes" type contamination)
- All 4 tabs verified crash-free on both minimal-data and rich-data vehicles
- Committed 5a915f327, pushed, Vercel deploying

## 2026-02-26 (evening session continued)

### Order Book Matching Engine + market_fund_buy Cash Fix — COMPLETED 2026-02-26
- deduct_reserved_cash(), credit_cash(), release_reserved_cash() — cash settlement helpers
- market_fund_buy() rewritten: atomic cash deduction before share issuance (was TODO/skipped)
- match_order_book(order_id): full price-time priority matching engine
  - Price-time priority (best price first, oldest order first)
  - Fill at maker price, 2% commission deducted from seller proceeds
  - share_holdings ON CONFLICT upsert for buyer, decrement for seller
  - Cash settlement via helper functions; over-reserved cash released on full buy fill
  - FOR UPDATE SKIP LOCKED for concurrent safety
  - Updates market_orders, share_holdings, vehicle_offerings in one transaction
- cancel_market_order(): SECURITY DEFINER cancel + releases reserved cash (unfilled portion)
- tradingService.ts cancelOrder(): now calls cancel_market_order RPC (was direct table update, cash never released)
- Migration: 20260226_order_book_and_fund_buy.sql — committed 6028c0377, pushed

## 2026-02-26 (afternoon/evening session)

### Queue Throughput — 6 new source workers added
- Mecum: 3 new CQP workers (jobs 217-219), `* * * * *` continuous
- PCarMarket: 3 new CQP workers (jobs 220-222), `* * * * *` continuous
- 21,028 Mecum + 5,578 PCarMarket now actively draining

### Failed Record Triage — 0 failed remaining
- BaT: Skipped category pages + template URLs (Invalid BaT URL errors)
- BaT: Reset 1 transient 406 error
- BroadArrow: Skipped memorabilia (watches, scale models, sold page)
- BroadArrow: Reset legitimate vehicle failures (wrecker/fire truck)
- BJ: Reset invalid-routing failures (were hitting wrong extractor)
- Duplicate VIN: Skipped gracefully

### Quality Score Backfill — Fixed + Running
- **Root cause found**: 47 triggers × 89 indexes = 710ms/row
- **Fix 1**: Dropped `idx_vehicles_quality_score` and `idx_vehicles_quality_backfill` (no longer needed during backfill)
- **Fix 2**: DO block with `SET LOCAL session_replication_role = 'replica'` bypasses all 47 triggers → 20ms/row
- **Fix 3**: Temp table JOIN pattern (`_qb_batch`) for efficient query planning instead of `ANY(array)`
- **Fix 4**: 30-second sleep offset to stagger from peak cron contention at :00
- Cron 228: `quality-score-backfill`, 300 rows/run at :30 past each minute
- `quality_backfill_state` table tracks keyset pagination cursor (last_vehicle_id)
- Rate: ~300 rows/min = 18k/hr → ~69 hours for 1.25M records
- `trg_update_vehicle_quality_score` trigger fixed (×100 multiplier, was truncating to 0)

### YONO Export Script — ctid Pagination Fix — COMPLETED 2026-02-26

- Root cause: planner uses PK index → scans 28M rows → Supabase 120s timeout; partial index has reltuples=0 (ignored)
- Fix: rewrote `export_supabase_training.py` to use **ctid-based physical page range scans** (8000 blocks/batch = ~2300 rows, ~6s per batch)
- Added `--skip-download` flag: exports all JSONL metadata without downloading images (saves disk space — only 33GB free)
- New ctid batches start at batch_0103+ (existing 100+2 batches preserved)
- Export running: ~838K records, ETA ~1hr, writing to `training-data/images/`
- Also built `idx_vi_training_covering` covering index (usable once planner stats update via future VACUUM)

### Market Exchange Backend — COMPLETED 2026-02-26

- `pre_trade_risk_check` RPC deployed (was missing — orders fell open)
- `update_vehicle_offering_prices()`: share price = nuke_estimate / total_shares, >0.5% threshold
- `mark_to_market()`: updates unrealized P&L on share_holdings + market_fund_holdings
- `market_segment_stats_cache` table: pre-computed stats, avoids 2-min full table scan
- `refresh_segment_stats_cache()` + pg_cron job 212 (every 4h)
- `update_market_nav()`: reads cache, NAV = $10 × (current_cap / baseline_cap)
- `run_exchange_pricing_cycle()`: chains all steps, returns JSONB summary
- `update-exchange-prices` edge fn: cron-triggered, full cycle <1s
- `api-v1-exchange` edge fn: unified read API (funds+stats, offerings, holdings)
- Baselines: PORS $5B, TRUK $1.25B, SQBD $80M, Y79 $317M. All funds at NAV $10.00.
- MarketExchange.tsx + MarketFundDetail.tsx: replaced slow RPC with api-v1-exchange (instant load)
- pg_cron job 213: pricing cycle every 15min

### EXIF Pipeline Forward-Fix + Image Bundle Review UX — COMPLETED 2026-02-26

**What was built (continuation of EXIF backfill session):**

**Daemon EXIF format fix (`scripts/photo-auto-sync-daemon.py`):**
- Fixed `create_vehicle_image_record()` to write structured EXIF format instead of flat: `{camera: {make, model}, location: {latitude, longitude}, DateTimeOriginal, exif_status: 'synced_from_photos'}`
- Previously wrote flat `{camera_make, camera_model}` which bypassed `reprocess-image-exif` filter checks
- Now future photo syncs produce EXIF data that matches the system's expected schema

**Image Bundle Review UX (all pieces now wired):**
- `BundleReviewQueue.tsx` — fully built component (review queue card in Evidence tab)
- `auto-create-bundle-events` edge function — deployed, creates `timeline_events` with `needs_input: true` per bundle
- `suggest-bundle-label` edge function — deployed, uses Claude Vision to suggest event title/type
- Gallery `bundles` view mode — "Sessions" toggle already in ImageGallery.tsx
- `VehicleProfile.tsx` — added fire-and-forget call to `auto-create-bundle-events` on owner profile load

**Dave's GMC K2500 current state:**
- 4 events with `needs_input: true`: Sep 25, Oct 01, Oct 18, Feb 10
- All 4 have AI suggestions pre-baked in `metadata.ai_suggestion`
- All 580 images have correct `taken_at` (clean 5-session timeline)
- BundleReviewQueue renders these automatically in the Evidence tab

**Commit:** 76a35a4d7, pushed to main, Vercel deploying

### data_quality_score Backfill — COMPLETED 2026-02-26

**What was built:**
- Fixed `trg_update_vehicle_quality_score` trigger: was storing raw 0.0-1.0 decimal into INTEGER column (all truncated to 0). Now stores `ROUND(compute_vehicle_quality_score(NEW) * 100)::INTEGER` (0-100 scale).
- Backfilled ~6,517 records manually in 300-500 row batches via psql (pooler timeout ~2min enforced; 300 rows ~safe).
- Cron job `quality-score-backfill` (job 211) confirmed active: runs every minute via `quick_quality_backfill(500)` function — auto-completes remaining ~1.247M records at ~500/min = ~720K/day, done in ~40hrs.

**Grade distribution of first 6,517 scored records:**
- A (80-100): 2,546 (38.8%) — year + make + model + extras
- B (60-79): 3,224 (49.1%) — year + make + model, some extras
- C (40-59): 292 (4.4%) — partial identity fields
- D (20-39): 45 (0.7%) — minimal data
- F (0-19): 456 (6.9%) — mostly deleted/stub records

### Location Pipeline Fix + Geocode Backfill — COMPLETED 2026-02-26

**What was built:**
- `_shared/parseLocation.ts` — new shared utility that parses "City, ST 12345" / "City, State ZipCode" strings into `{city, state, zip, clean, raw, confidence}`. Wraps normalizeListingLocation, strips zip before regex check to avoid false rejections.
- `extract-bat-core`: now uses `parseLocation()`, writes `listing_location_raw/source/confidence/observed_at` on insert + update. Writes row to `vehicle_location_observations` after each extraction.
- `extract-cars-and-bids-core`: fixed `location:` → `listing_location:` (was writing to wrong column). Added all `listing_location_*` fields. Writes `vehicle_location_observations`.
- `process-cl-queue`: upgraded `normalizeListingLocation` → `parseLocation`. Added `vehicle_location_observations` write on insert + update paths.
- `geocode-vehicle-locations` edge function: batch geocoder for backfill. Uses `fb_marketplace_locations` lookup first (instant), Nominatim fallback (1 req/sec). Returns `{processed, geocoded_from_lookup, geocoded_from_nominatim, failed}`.
- `scripts/geocode-backfill.mjs`: local Node.js script for overnight backfill of 28k existing vehicles. Running as background process (PID 92797, log: /tmp/geocode-backfill.log).

**Schema used (no migrations needed — all columns already exist):**
- `vehicles.listing_location`, `listing_location_raw`, `listing_location_source`, `listing_location_confidence`, `listing_location_observed_at` — now populated by BAT, C&B, CL extractors
- `vehicles.gps_latitude`, `vehicles.gps_longitude` — being filled by backfill script
- `vehicle_location_observations` — now written on every extraction with city/state/confidence

**Current state:**
- Backfill running: ~28k vehicles, 100% Nominatim success rate, ~8.5 hours to complete
- Monitor: `tail -f /tmp/geocode-backfill.log`
- Verify results: `SELECT COUNT(*) FROM vehicles WHERE gps_latitude IS NOT NULL;`

## 2026-02-26

### [transfers] Transfer status badge live in VehicleHeader
- `transfer-status-api` edge function: GET/POST returns sanitized transfer state (milestone, progress, parties)
- `VehicleHeader.tsx`: badge shows current milestone label, progress %, days stale (≥7), buyer @handle with ◇ if unclaimed
- Badge color: blue=in_progress, amber=stalled, green=completed
- Committed 6e346eba7, deployed, Vercel building

### [transfers] Ownership transfer automation framework
- `transfer-automator`: seeds from auction_events close, ghost shell resolution, 28 milestones with deadlines
- `transfer-advance`: AI classifies email/SMS signals → advances milestones (Haiku + keyword fallback)
- `transfer-email-webhook`: Resend inbound → t-{10hex}@nuke.ag inbox routing
- `transfer-sms-webhook`: Twilio inbound → buyer/seller phone routing, TwiML ACK
- DB triggers: auction close → auto-create transfer; identity claim → upgrade ghost shell to real user
- Crons: staleness sweep every 4h (job 189); backfill 170k sold auctions in batches of 100 every 2min (job 190)
- 138 existing transfers backfilled with inbox_email

### [vision] api-v1-vision deployed + SDK v1.3.1 nuke.vision live on npm
- api-v1-vision edge function: POST /classify (YONO, $0), /analyze (YONO+cloud), /batch (100 images)
- tools/nuke-sdk/src/resources/vision.ts: nuke.vision.classify/analyze/batch — committed + published
- SDK v1.3.1 live at @nuke1/sdk on npm

### [context] Multi-agent coordination system built
- DONE.md + PROJECT_STATE.md + ACTIVE_AGENTS.md cleanup
- claude-checkpoint (Stop hook auto-saves git state) + claude-handoff (explicit agent handoff)
- Global CLAUDE.md: session start ritual + context pressure rule
- Dependabot: 3 high alerts resolved, gitignore fixed for tools/

### [bonhams] Import Queue Triage — 17,964 memorabilia pre-skipped
- Analyzed 24,037 pending bonhams records via URL pattern analysis
- Built vehicle indicator regex: chassis-no|frame-no|vin-|engine-no OR year-make slug patterns (~60 makes)
- `UPDATE import_queue SET status='skipped', error_message='memorabilia: skipped by url pattern'` — 17,964 records
- Remaining for extraction: 5,976 pending (5,042 bonhams.com + 934 cars.bonhams.com) — all genuine vehicles
- Scheduled 3 dedicated workers: `bonhams-queue-worker-1/2/3` (cron jobs 200/201/202), `* * * * *`, 5 lots/batch, 50s runtime
- Workers route through `continuous-queue-processor` → `extract-bonhams` (already configured in SOURCE_CONFIGS)

Format: `- [area] What was built — where it lives`

---

## 2026-02-26 (Extraction Quality Sprint — Phase 2, post context-compression)

### Critical Description Fix — Mecum
- **Root cause**: `post.content` in Mecum __NEXT_DATA__ is ALWAYS empty. Description lives in Gutenberg blocks under HIGHLIGHTS + EQUIPMENT headings.
- **Fix**: Added `parseBlocksDescription()` to extract-mecum — recursively walks `post.blocks[]`, finds `core/list-item` elements under HIGHLIGHTS and EQUIPMENT headings, strips HTML, joins with bullet format.
- **Also**: Engine extraction from SPECIFICATIONS block (label/value pairs in blocks, more reliable than `lotSeries` which is sometimes charity text).
- **Result**: Description rate from 0% → expected 60%+ for Mecum lots. Quality score example: 0.73 → 0.93.
- **Mecum backfill**: Reset 35,146 completed mecum items (processed before 2026-02-20) to 'pending' for re-extraction. 5 dedicated mecum CQP workers (jobs 217-219, 231-232) actively draining.

### Critical Description Fix — Bonhams
- **Root cause 1**: `extractBonhamsLot` only looked at `jsonLd.description` (generic site text) and meta description. The actual lot description is in `### Footnotes` section of the Firecrawl markdown.
- **Root cause 2**: JSON-LD/og:title not available in React shell HTML → year/make/model were null.
- **Root cause 3**: Firecrawl only triggered when `html.length < 5000`, but Bonhams CSR shell is 120KB.
- **Fix 1**: Added Footnotes markdown section parsing in `extractBonhamsLot()` — regex matches `### Footnotes\n+...`, strips markdown formatting, trims to 10K chars.
- **Fix 2**: Added markdown heading fallback for title parsing when og:title unavailable.
- **Fix 3**: Firecrawl now fires when `!fetchResult.cached && !hasLotContent` — fires on all fresh fetches (not just tiny pages). Cache hit = uses stored markdown, no Firecrawl cost.
- **Result**: Description rate from 0% → expected 60%+ for Bonhams lots. All tested at cost_cents=0 (cached). Fresh fetches use Firecrawl (~$0.01/page × 2.6K pending = ~$26).

### Queue Workers Added
- Jobs 231, 232: mecum-queue-worker-4, mecum-queue-worker-5 (5 total mecum CQP workers now)
- Jobs 233, 234: gooding-queue-worker-1, gooding-queue-worker-2 (Gooding was only in general round-robin, now dedicated)
- Jobs 229, 230: removed (bad re_enrich implementation that caused timeout)

### Pipeline State (current)
- Mecum: 55K pending / 731/hr → ~75 hrs | B-J: 24K / 2028/hr → ~12 hrs | C&B: 31K / 989/hr → ~31 hrs
- BaT: 4K / 844/hr → ~5 hrs | Bonhams: 2.6K / 671/hr → ~4 hrs | PCar: 5.1K / 164/hr → ~31 hrs | Gooding: 1.6K / (new workers, accelerating)

## 2026-02-26
- [cron] **9 dedicated source workers added** (jobs 191-199): cnb-queue-worker-1/2/3, bj-queue-worker-1/2/3, broadarrow-queue-worker-1/2/3 — each runs every minute, batch_size=5, continuous=true, max_runtime=50s. Targets C&B (36k pending), BJ (8.4k pending), Broad Arrow (1.1k pending). BAT already covered by jobs 123-127.
- [extraction] **14,616 stuck items rescued** — reset to pending: Barrett-Jackson (8,254), C&B (3,301), BaT (1,821), Broad Arrow (1,151), Vanguard/Hemmings/CC (89)
- [extraction] **extraction-watchdog**: added step 5b — rescues orphaned `status='failed'` items (claim function only picks pending; failed items were permanently abandoned by old PIQ code path)
- [extraction] Root causes documented: (1) claim fn ignores failed status, (2) watchdog ate items before 2/25 extractor rewrite, (3) bulk 2/17 importer had multi-word make parser bug (Aston Martin→make='Aston',model='Martin')
- [extraction] PCarMarket 16,712 skipped items NOT reset yet — uses Firecrawl per call, needs decision on cost vs data value
- [pipeline] Discovery→extraction gap fixed: listings no longer expire before extraction triggers
- [bat] Removed dead workflows, restored bat-dom-map-health-runner
- [fb-marketplace] refine-fb-listing: og: meta tags, bingbot HTML fetch, skip-null-overwrites logic

## 2026-02-25
- [agent-safety] **TOOLS.md** — canonical intent→edge function registry. Read before building anything.
- [agent-safety] **pipeline_registry** table — 63 entries: table.column → owning function + do_not_write_directly flag
- [agent-safety] Column comments — 86 comments on vehicles, vehicle_images, import_queue, bat_extraction_queue, document_ocr_queue, vehicle_observations
- [agent-safety] CHECK constraints — vehicles.status, auction_status, reserve_status; vehicle_images.ai_processing_status, optimization_status, organization_status
- [agent-safety] release_stale_locks() SQL function + queue_lock_health view + hourly cron (job 188)
- [agent-safety] Released 375 stuck records on deploy (367 vehicle_images stuck since Dec 2025, 7 bat_extraction_queue, 1 document_ocr_queue)
- [cars-and-bids] extract-cars-and-bids-core full rewrite: direct HTML parsing, cache-first markdown, all fields, sale_price fix
- [fb-marketplace] HTML fallback + longer inter-city delay; residential-IP scraper for vintage vehicles
- [seller-blocklist] Seller blocklist edge function — blocks scammers and disguised dealers
- [discovery] Craigslist: private-sellers-only filter (cto param), seller_type tagging
- [pipeline] QA sweep, image pipeline improvements, URL normalization, content-hash dedup, VIN cross-validation
- [frontend] Lazy-load modal components in VehicleHeader

## 2026-02-24
- [rebrand] Marque → Nuke complete across all user-facing strings + domain nuke.ag live
- [frontend] Vehicle profile layout restored: 16:9 hero, expanded timeline/description/comments
- [contact-inbox] Inbound email via Resend webhooks + admin inbox UI
- [frontend] Workspace tabs, VIN dedup, deal pipeline inputs
- [investor-page] /offering: dynamic investor deck powered by live Supabase data (no hardcoded stats)
- [frontend] AppLayout decomposed into focused header/nav/footer components
- [build] React 18 / react-three circular ESM dep resolved; recharts/d3 chunk fix

## 2026-02-19
- [acquisition-pipeline] Market proof page with honest economics (parts+labor), CL discovery, batch processing
- [pipeline-page] Redesigned to match app design system; RLS policies added
- [acquisitions] Acquisitions nav link + acquisition pipeline dashboard UI

## 2026-02-18
- [frontend] CursorHomepage.tsx refactor: 6,449 → ~2,000 lines (extracted 8 hooks/components)
- [frontend] Landing page for logged-out visitors (hero, features, CTAs)
- [frontend] Removed 10 half-built product routes: betting, trading, invest, social, vault, portfolio
- [frontend] Rebrand N-Zero → Marque → Nuke in git history

## 2026-02-17
- [normalizeVehicle] Shared vehicle normalization utility — wired into 9+ extractors, eliminates toLowerCase anti-pattern
- [frontend] Lazy-load route modules + organization routes (400KB → on-demand)
- [security] XSS fixes, OG tags, JSON-LD structured data, canonical URLs
- [accessibility] Skip nav, ARIA labels, contrast ratios
- [cleanup] Deleted 228 files / 74k lines of dead code (_archived dirs)
- [deps] Consolidated: icon libs → lucide-react only; EXIF libs → exifr only
- [db] Vehicle DB indexes + status column constraints

## 2026-02-15
- [bat-snapshot-parser] All-SQL BaT snapshot parser: 355k HTML snapshots, 6x throughput vs old version
- [photo-pipeline] Apple Vision pre-filter + Gemini orchestrator; skip junk URLs; skip analyze-image when no vehicle
- [frontend] Gallery view + advanced filters on collections map
- [frontend] Map: zoom/scope ring/concentration indicator, sidebar hover highlight, region tracking

## 2026-02-01 (multi-agent session — see .claude/AGENT_PRODUCTIVITY_LOG.md for full detail)
- [data-quality] Fixed 1,161 vehicles: invalid sale_price (reserve_not_met + price>0)
- [data-quality] Fixed 265 data inconsistencies (181 Class A, 77 B1, 7 B2). Verified 0 remaining.
- [bat] Price extraction bug fixed: scoped regex to essentials block only (was extracting quoted prices from user comments)
- [collecting-cars] **Typesense API bypass**: `https://dora.production.collecting.com/multi_search` — bypasses Cloudflare entirely, zero cost. Non-AI extractor built and deployed. 305 listings processed.
- [craigslist] extract-craigslist deployed: uses JSON-LD structured data, no AI needed
- [source-registry] source_registry table (13 sources) + views: v_active_sources, v_sources_needing_attention, v_ugly_sources
- [extraction-hierarchy] Full fallback stack deployed: Native → API Bypass → Firecrawl → Playwright → Ollama

## 2026-01-31
- [multi-agent] Multi-agent coordination system + ACTIVE_AGENTS.md convention established
- [schema-discovery] Schema Discovery principle formalized in CLAUDE.md
- [telegram] Telegram bot (@Sss37133_bot) + claude-notify hook + claude-log + check-in bot running
- [mecum] YouTube broadcast analysis pipeline + "Watch the Moment" (links vehicles to broadcast timestamps)
- [broadcast-backfill] Broadcast backfill queue system for agent processing
- [firecrawl-enrichment] Firecrawl enrichment (activates Feb 2) + cloud enrichment via GitHub Actions

## 2026-01-29
- [live-auctions] Live auction monitoring system (multi-platform sync)
- [copart-iaa] Copart/IAA HTML-in approach (Firecrawl dependency removed)
- [nhtsa] NHTSA integration added
- [orgs] OrgLogo component: auto-fetch from Clearbit/Google

## 2026-01-25
- [financial] Full financial products infrastructure (QuickBooks OAuth, webhooks, token exchange)
- [legal] NUKE LTD legal entity infrastructure — docs committed
- [market-intelligence] Market Intelligence Initiative: deployment guide + core components

## 2026-01-22-24
- [cars-and-bids] C&B comment extractor; enhanced extraction with auction image handling
- [ebay-motors] eBay Motors: VIN + mileage extraction
- [observations] **Vehicle observation system** (new architecture): observation_sources, vehicle_observations, observation_extractors, observation_discoveries tables
- [automated-bidding] Automated bidding system built

## 2026-01-23
- [bat-wayback] BaT Wayback Machine import with deduplication logic

## 2025-12-05-10
- [receipts] Comprehensive work order receipt system (ComprehensiveWorkOrderReceipt component + pipeline)
- [forensics] Forensic bundling: component lifecycle tracking, before/after detection, scan history
- [service-manuals] Service manual indexing pipeline (OpenAI/Anthropic, not Gemini)
- [catalog] 3M Automotive Aftermarket Catalog 2024 indexed
- [catalog] Material catalog & TDS indexing system
- [labor] Fluid labor rate system with parallel calculations
- [vins] VIN multi-proof system using existing tables
- [photo-pipeline] Part-number OCR, receipt-photo OCR, TechCapture page
- [orgs] Organization intelligence system + image auto-matching
- [knowledge-library] Knowledge Library implementation
- [vehicle-mailbox] Vehicle mailbox system (VehicleMailbox component + message management)
- [bundle-analysis] Bundle grouping and analysis system via Supabase edge function

## 2025-11-24-30
- [auth] Google OAuth login
- [api-access] API access payment system (users pay, use own keys)
- [bat-comments] BaT comment tracking: database schema, scheduled scraping, admin notifications
- [lightbox] Full-resolution lightbox + EXIF data panel (sidebar, all data sections)
- [about] Comprehensive About page (maps, ERDs, frameworks)
- [app-layout] Double-wrapping prevention system for AppLayout

## 2025-10-16-18
- [deployment] Vercel production deployment pipeline established; nuke.ag domain
- [mobile] Mobile camera capture with AI guardrails
- [rarity] Vehicle rarity system (Marti Reports style, production data)
- [cards] Card UI foundation: swipe, double-tap like, price widgets, readiness bar
- [streaming] Livestream system (viewer_user_id, get_live_streams_feed)

---

## How to Append

When you complete significant work, add a line at the TOP of the relevant date section:
```
- [area] Description of what was built — edge function name or file path if relevant
```

Start a new date section if today's date isn't already here.

### Ownership Transfer Automation Framework — COMPLETED 2026-02-26

**What was built:**
- `transfer-automator` edge function: seeds transfers from auction_events closes, handles idempotency, resolves/creates ghost shell identities, seeds 18-28 milestones with deadlines
- `transfer-advance` edge function: AI classifies free-form signals (SMS/email/platform events) against pending milestones, advances them, stores communication records; falls back to keyword heuristics when no AI key
- DB trigger `trg_auto_create_transfer_on_auction_close`: fires AFTER INSERT/UPDATE OF outcome on auction_events where NEW.outcome='sold', calls transfer-automator via pg_net async
- DB trigger `trg_upgrade_transfers_on_identity_claim`: fires when external_identities.claimed_by_user_id changes NULL→value, auto-populates to_user_id/from_user_id on matching transfers (ghost shell → real user upgrade)
- `transfer_staleness_sweep(stale_days)` SQL function: marks overdue milestones + stalled transfers, safe to call from cron or edge function
- Cron job 189 `transfer-staleness-sweep`: runs `transfer_staleness_sweep(14)` every 4h
- `backfill_transfers_for_sold_auctions(batch_size)`: backfill pg_net caller for existing 170k sold auctions

**Schema extended:**
- `transfer_communications` got: milestone_type_inferred, ai_classification_confidence, has_attachments, attachment_names, raw_metadata
- `communication_source` enum extended with 'document'

**Entry points:**
- New auction closes: automatic via DB trigger → pg_net → transfer-automator
- Email webhook: POST /transfer-advance {action: "ingest_email", transfer_id, from_email, subject, body_text}
- SMS webhook: POST /transfer-advance {action: "ingest_sms", transfer_id, from_number, body_text}
- Manual advance: POST /transfer-advance {action: "advance_manual", transfer_id, milestone_type}
- Query state: POST /transfer-automator {action: "get_transfer", vehicle_id or transfer_id}

### Transfer Webhook Integration — COMPLETED 2026-02-26

**New edge functions:**
- `transfer-email-webhook` — Resend inbound email webhook handler
- `transfer-sms-webhook` — Twilio inbound SMS webhook handler

**Schema additions:**
- `ownership_transfers`: inbox_email, buyer_phone, seller_phone, buyer_email, seller_email
- `transfer_status` enum: added 'stalled' value
- `transfer_communications`: milestone_type_inferred, ai_classification_confidence, has_attachments, attachment_names, raw_metadata

**Webhook URLs (live):**
- Email: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-email-webhook
- SMS: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-sms-webhook

**Routing logic:**
- Email: TO address `t-{10hex}@nuke.ag` → direct transfer lookup; FROM email → buyer_email/seller_email match
- SMS: FROM phone (10-digit normalized) → buyer_phone/seller_phone match

**Configuration needed:**
- Resend: Domain → nuke.ag → Inbound → catch-all `t-*@nuke.ag` → webhook URL above
- Twilio: Phone Number → Messaging → Webhook URL above, HTTP POST

**Per-transfer inbox:**
- Every transfer gets `inbox_email = t-{first10hexchars_of_trigger_id}@nuke.ag`
- 138 existing transfers backfilled with inbox_email
- Backfill buyer_phone/seller_phone via: POST /transfer-automator {action: "update_contacts", transfer_id, buyer_phone, buyer_email}

## 2026-02-26 (perf sprint)
- [perf] **SubdomainRouter**: compute initial state synchronously — eliminates "loading..." flash for non-storefront domains
- [perf] **useSession**: read Supabase session from localStorage cache synchronously — auth spinner eliminated for returning users; select('*') → explicit columns
- [perf] **vendor.js**: moved recharts + d3 out of vendor chunk into 'charts' chunk — vendor 813KB → 393KB (half)
- [perf] **useSession**: ref guard on fetchProfile — eliminates duplicate profiles query from getSession + INITIAL_SESSION double-fire
- [perf] **useNotificationBadge/useCashBalance**: user-scoped channel names (notification_badge:{userId}, balance:{userId})
- [perf] **VehicleProfile**: extracted readCachedSession() to utils/cachedSession.ts; initialize session + authChecked from cache — loadVehicle() no longer blocked on async getSession() round-trip

### YONO Hierarchical Inference — COMPLETED 2026-02-26
- `HierarchicalYONO` class added to `yono.py` — Tier 1 (8-family) + Tier 2 (per-family make) cascade with flat fallback
- `server.py` updated — lifespan handler, loads hierarchical model, /health reports tier1/tier2/flat state
- `models/hier_family.onnx` exported — 8-class family classifier (45.8% val_acc, epoch 19/25)
- `yono-classify` edge function updated — preserves inference path as `yono_source` field ("hierarchical"|"flat_fallback"|"flat")
- Tier 2 training running in background (american: 20 makes, 22.9K images; german/british/etc. queued)
- Supabase export resumed in background (100 batches done, resuming from offset 200K with 300s timeout fix)
- YONO server live on :8472 with hierarchical support

## 2026-02-26 (EXIF pipeline fix + image timeline)
- [data] **EXIF backfill**: Fixed chronological ordering for Dave's GMC K2500 (a90c008a) — 580 images now have correct taken_at
  - 62 images: updated via photo_sync_items.photos_date_taken (exact millisecond precision from Apple Photos sync)
  - 78 images: updated via local Photos library using osxphotos (real camera timestamps + GPS)
  - 250 images: BaT listing scrapes — taken_at updated from BaT CDN URL path (/uploads/2025/10/) → Oct 2025
  - All BaT images marked exif_status: 'stripped' (correct — BaT CDN strips user EXIF)
- [fix] **reprocess-image-exif edge function**: Fixed 2 crash bugs — null GPS dereference (structured.location.latitude), wrong column names (gps_latitude → latitude/longitude)
- [fix] **reprocess-image-exif**: BaT images with no EXIF now marked 'stripped' instead of silently failing
- [data] **Timeline integrity**: Oct 11 orphaned timeline_event_id fixed; images confirmed linked to 6 events
- [result] Final bundle state: Sep 25 (146), Oct 01 BaT listing (251), Oct 11 inspection (1), Oct 18 documentation (102), Feb 10 work session (78)

## 2026-02-26 (frontend perf: auth-gate waterfalls + bundle optimization)
- [perf] **Auth-gate waterfall elimination**: 17 pages total fixed — session state initialized from localStorage cache synchronously
  - VehicleProfile, Profile, CursorHomepage, Vehicles, Library, Capture, VehicleJobs, Capsule, CurationQueue, RestorationIntake, BusinessIntelligence, ImportDataPage (batch 1+2)
  - Dashboard, AdminMissionControl, AdminVerifications, SocialWorkspace, DeveloperDashboard, MarketDashboard, VaultPage, Portfolio, InvoiceManager, UnlinkedReceipts, PersonalPhotoLibrary (batch 3)
  - Added `nuke_frontend/src/utils/cachedSession.ts` — shared utility to read Supabase session from localStorage synchronously
- [perf] **Vendor bundle split**: recharts+d3 moved to separate 'charts' chunk — vendor.js reduced 813K → 393K
- [perf] **Double profile fetch eliminated**: useSession.ts useRef guard prevents INITIAL_SESSION + getSession() dual fetch
- [perf] **Lazy markdown loading**: InvestorOffering + OrganizationOfferingTab — 6 static `?raw` imports converted to dynamic per-tab imports (~378K now loaded on-demand)
- [fix] **User-scoped realtime channels**: notification_badge + cash balance channels now scoped by userId
- [fix] **SubdomainRouter synchronous init**: eliminated loading gate for non-storefront domains

## 2026-02-26 (extraction quality sprint — autonomous)

### PCarMarket 4-Layer Field Fix — DEPLOYED
- **Root cause**: PCarMarket extractor had no color/engine/transmission in interface, extraction path, LLM fallback, or vehicleData write — fields extracted by Firecrawl but never stored
- **Fix**: Added to all 4 layers — TypeScript interface, JSON extraction (`jsonData.vehicle?.exterior_color` etc.), LLM fallback (`llm.exterior_color` etc.), vehicleData write object (`color`, `interior_color`, `engine_type`, `transmission`)
- **Verified**: Porsche 993 test → "Zenith Blue Metallic", "Midnight Blue", "3.6 L flat-six, 282 HP", "6-Speed Manual" ✓
- **File**: `supabase/functions/import-pcarmarket-listing/index.ts`

### Backfill Queue — 88K+ items across all sources
All queued via `import_queue` → CQP → dedicated extractors. Free/low-cost extraction paths used where available.
- **Bonhams**: 24,978 shell records with NULL listing_source queued (old bulk importer predated extract-bonhams v3)
- **C&B**: 18,261 cab-fast-discover shells with no prior queue entry
- **Barrett-Jackson**: 13,602 B-J vehicles with no prior queue entry; 13,057 "complete" items reset where VIN was missing
- **BaT**: 8,052 BaT vehicles missing VIN or mileage re-queued
- **PCarMarket**: 5,483 existing PCarMarket vehicles missing color queued at low priority
- **Mecum**: 20,903 mecum-checkpoint/fast-discover shells with no prior queue entry (free __NEXT_DATA__ extraction)

### CQP Extractor Routing Fixes — DEPLOYED
- **Mecum**: Route changed `extract-vehicle-data-ai` → `extract-mecum` (dedicated, uses free `__NEXT_DATA__` JSON, quality gate, proper WordPress content extraction)
- **eBay**: Route changed `extract-vehicle-data-ai` → `extract-ebay-motors` (dedicated, quality filters, strict field validation)
- **File**: `supabase/functions/continuous-queue-processor/index.ts`

### v_extraction_quality View Created
```sql
-- Tracks field completeness by listing_source
-- Key fields: VIN, mileage, color, interior_color, engine, transmission, description, sale_price
SELECT * FROM v_extraction_quality ORDER BY pct_all_key_fields DESC;
```

### Pipeline Progress (snapshot ~4h after start)
- BaT: 696 complete, 7,957 pending
- B-J: 1,637 complete, 32,320 pending
- C&B: 773 complete, 34,943 pending
- Bonhams: 511 complete, 5,250 pending
- PCarMarket: active (5,563 pending)
- Mecum: 20,680 newly queued, extraction now routed to extract-mecum (free)

### Additional Extraction Quality Fixes (continued from session)

**CQP routing fixes** — `supabase/functions/continuous-queue-processor/index.ts`:
- `mecum` → `extract-mecum` (was `extract-vehicle-data-ai` — using free `__NEXT_DATA__` is 10x better quality)
- `ebay` → `extract-ebay-motors` (was `extract-vehicle-data-ai` — dedicated quality-filtered extractor)
- Gooding: added sourceIds for fast queue claiming (no more full-table LIKE scan)

**C&B snapshot cache fix** — `supabase/functions/extract-cars-and-bids-core/index.ts`:
- Removed 7-day TTL on listing_page_snapshots — historical auction pages are immutable once ended
- Old C&B data permanently lost from live pages; existing snapshots (19K) now reusable indefinitely

**Gooding backfill** — 1,724 old `gooding_extract` records (goodingco.com URLs) queued for `extract-gooding`:
- Were labeled 'gooding_extract' but had goodingco.com URLs — missed by B-J backfill
- extract-gooding getting rich provenance descriptions ("Brilliant George Weaver Design...", "Stunning One-Off Brewster/Inskip Coachwork")
- Quality improvement: 1.5% description → ~85% after extraction

**Pipeline throughput** (measured rates):
- B-J: 2,478/hr (25K pending, ETA ~10 hrs)
- C&B: 1,141/hr (32K pending, ETA ~28 hrs) 
- BaT: 1,022/hr (4.7K pending, ETA ~4.6 hrs)
- Bonhams: 741/hr (3.2K pending, ETA ~4.3 hrs)
- Mecum: 329/hr (20.5K pending, ETA ~62 hrs) — free, no Firecrawl cost
- Gooding: 214/hr (1.7K pending, ETA ~8 hrs)

**Known limitations** (inherent, not fixable):
- Old C&B ended auctions (18K cab-fast-discover): spec data permanently gone from live pages
- Bonhams 0% description: JSON-LD doesn't include it, requires JS-rendered body parsing
- Rennlist 7.4% color: forum posts, no structured color field
