# DONE — Completed Work Log

**Append-only. Add entries when completing significant work.**
Agents read this to avoid rebuilding things that already exist.

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
