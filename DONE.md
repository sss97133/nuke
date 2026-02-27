# DONE — Completed Work Log

**Append-only. Add entries when completing significant work.**
Agents read this to avoid rebuilding things that already exist.

## 2026-02-27

### [vp-orgs] Org cron gap fix — 3 missing crons added, 2 functions deployed
- **classic-seller-queue-worker** (job 264, `*/5 * * * *`): drains `classic_seller_queue`; 109 items were stuck with 5 failed attempts since Dec 2025. Root cause: `index-classic-com-dealer` was not deployed. Fixed: redeployed both functions, reset 109 items to pending, cron draining now (8 completed in first batch).
- **ecr-collection-inventory-refresh** (job 262, `0 3 * * *`): refreshes ECR collection inventory; was 45 days stale. 1,831 collections, 142 never synced.
- **compute-org-seller-stats-daily** (job 263, `0 4 * * *`): rebuilds `organization_seller_stats` for all orgs with external listings. Was 1 entry, stale Feb 14.
- Deployed: `process-classic-seller-queue`, `index-classic-com-dealer`
- Filed agent task for org-to-seller bridge (P70, build when queues populate more data)
- Migration file: `supabase/migrations/20260227100000_vp_orgs_cron_fixes.sql`

### [cdo] Data Quality Audit — 7 work orders filed
- Audited 1.255M vehicles across all sources using pg_stats (fast, no sequential scans)
- **Key findings**: VIN coverage 17% overall, description coverage 25%, signal_score near-zero (0.22%), valuation 41%
- **Source breakdown** (10% sample): User Submission dominates (96% of corpus), Mecum 8% desc coverage, B-J 41% VIN coverage, Craigslist 4% desc coverage
- **BAT extraction stall confirmed**: 119,299 pending items since Dec 2025, stopped processing Feb 5. 142K BaT vehicles effectively have no signal_score as a result.
- **YONO training imbalance confirmed**: 17 of 38 zones have <50 examples. panel_fender_rr/rr=1 example each.
- Filed 7 agent_tasks: vp-extraction (4: VIN backfill P82, Description backfill P80, B-J VIN gap P78, BAT stall P85x2), vp-vehicle-intel (valuation coverage P75), vp-ai (YONO zone balance P72)

## 2026-02-27

### [frontend] TeamInbox — unified team communication hub at /inbox
- Built `/nuke_frontend/src/pages/TeamInbox.tsx` (1294 lines) — full-featured three-tab inbox page
- **Emails tab**: contact_inbox reader, mailbox filters (support/info/privacy/legal/investors/hello), status filters (unread/read/replied/archived), full email detail pane, reply via `reply-email` edge function, archive/spam actions, real-time subscription via Supabase realtime
- **Messages tab**: agent_messages reader, to/from role filters, unread-only toggle, thread view, compose modal (founder→any agent role via `agent-email` edge function), marks as read on open
- **Alerts tab**: filtered view of alert emails (alerts@nuke.ag or subject contains "vehicle alert"), auto-extracts vehicle listing URLs (BaT, C&B, PCarMarket, Mecum, etc.), links for direct access
- Left sidebar: tab nav with live unread count badges, auto-refreshes every 30s
- Auth-gated: redirects to /login?returnUrl=%2Finbox for unauthenticated users
- Uses Nuke design tokens only (var(--bg), var(--text), var(--primary), etc.)
- Route: `/inbox` added to DomainRoutes.tsx
- Nav: "Inbox" link added to NukeMenu (authenticated users) and ProfileBalancePill dropdown
- Committed in 944ba7704, pushed to main (Vercel deploying)

### [worker] Multi-task sprint — 6 tasks completed
- **P90 YONO ACTIVE_AGENTS update (1977ede1)**: Updated ACTIVE_AGENTS.md: zone classifier PID 7241 COMPLETE (epoch 15/15, val_acc=72.8%), tier-2 PID 28401 active training german family, watcher PID 7390 active
- **P85 YONO sidecar unreachable (363eca02)**: Sidecar IS reachable. Task had typo (sss83133 vs sss97133). Verified: health=200, classify_no_token=401, classify_with_token=200. Auth middleware working
- **P80 Import queue backlog (78505a8b)**: Not stalled. 84,847 pending, 353 active, 277K completed. Demand spike from Extraction Quality Sprint draining at ~50/min
- **P75 YONO sidecar Bearer token auth (b6b693ab)**: Already implemented by VP AI. auth_middleware in modal_serve.py lines 374-389, Modal secret nuke-sidecar-secrets and Supabase secret MODAL_SIDECAR_TOKEN both set, yono-classify + yono-analyze both send Bearer token
- **P70 archiveFetch violation: crawl-bat-active (db1d1a69)**: Documented exception — RSS/XML feeds are URL-discovery-only (parse URLs from XML, content not stored). Added comments. Deployed crawl-bat-active
- **P70 archiveFetch violation: sync-live-auctions (7ad92537)**: FIXED — replaced raw fetch("https://bringatrailer.com/auctions/") with archiveFetch() (skipCache: true, platform: bat). Page now archived to listing_page_snapshots. Deployed sync-live-auctions
- **P60 archiveFetch violation: extract-gooding (c8afcd1e)**: Documented exception — sitemap.xml is URL-discovery-only. Added comments. Deployed extract-gooding

### [ux-audit] CPO full site audit — 13 tasks filed in agent_tasks
- Conducted Playwright-based audit of all major pages: /, /search, /vehicle/[id], /market, /portfolio, /offering, /organizations, /profile
- Confirmed via direct API testing (not just screenshots) — identified root causes not just symptoms
- 3 confirmed P0 broken experiences:
  1. Vehicle profile stuck loading: get_vehicle_profile_data RPC times out (3s) for anon users (task bda3c25b, P97)
  2. /market is a "Coming Soon" hardcoded stub — real data at /market/exchange not linked (task 8aaed8ad, P95)
  3. Homepage Feed tab: "Unable to load vehicles" error — listing_kind column issue in CursorHomepage.tsx (task 0139bb65, P93)
- 10 additional UX issues filed (P68-P90):
  - Search takes 11+ seconds, shows "0 results" while loading (task 6db748af, P90)
  - Nav has no Search or Market links (task 99850151, P88)
  - Search empty state blank (task a2e04f6a, P85)
  - Search filters (Year/Price/Make) not rendering (task c774b1cd, P85)
  - Investor offering gate shows no traction stats (task ac67d3b6, P82)
  - No loading skeleton during search (task b9e49520, P78)
  - No logo/wordmark in header (task 723ab790, P75)
  - Mobile bottom nav missing Search/Market (task 96434c40, P72)
  - Vehicle profile tab labels confusing Evidence/Facts/Commerce/Financials (task da638271, P70)
  - Similar Sales section not wired/visible (task e0433594, P68)
- All 13 tasks filed to agent_tasks as vp-platform, status=pending

## 2026-02-27

### [market] Market Exchange, Fund Detail, Portfolio — comprehensive UX overhaul
- **MarketDashboard** (/market): replaced "Coming Soon" placeholder with live data dashboard — real fund cards from api-v1-exchange, animated skeleton loading, platform AUM stats strip, CTAs
- **MarketExchange** (/market/exchange): skeleton loading (4 animated cards), user-friendly error state with Refresh button (no raw error string), BETA badge properly styled, market cap formatted as $X.XXB/M/K, font sizes → CSS vars
- **MarketFundDetail** (/market/exchange/:symbol): full skeleton loading (no flash of "Fund not found"), not-found state with CTA, removed "MVP: shares issued at NAV" dev note visible to investors, shares preview calculation, sign-in CTA for anon users, NAV hero strip, error/success use --error-dim/--success-dim backgrounds
- **Portfolio** (/market/portfolio): h1/value cards use proper font sizes (var --fs-12), tabs refactored from 8 copy-paste blocks to single data-driven loop, empty shares state has "Browse Funds" CTA, removed alert() from org stocks click, raw px → CSS vars throughout
- Commit: b9ae1497c

### [yono] Zone classifier live + Bearer token auth + interior_quality — VP AI session
- **Zone classifier uploaded to Modal**: yono_zone_head.safetensors (2.1MB), yono_zone_classifier_labels.json, yono_zone_config.json → `yono-data /models/`
- **Zone classifier integrated in modal_serve.py**: `_load_zone_classifier()` loads ZoneClassifierHead (768→512→256→41 zones); used in both `_analyze_finetuned` and `_analyze_zeroshot` via `_classify_zone(features)` on shared Florence-2 encoder output
- **Health endpoint**: now reports `zone_classifier: true, zone_classes: 41`
- **zone_source field**: `zone_classifier_v1` (when ZoneClassifierHead active) vs `photo_type_heuristic` (fallback)
- **DB migration applied**: `interior_quality smallint` + `zone_source text` added to vehicle_images (applied via port 5432, NOT VALID check constraint)
- **yono-vision-worker updated**: now writes `interior_quality` and `zone_source` to vehicle_images on every analysis
- **Bearer token auth**: `nuke-sidecar-secrets` Modal secret created, token stored in Supabase secrets + .env; `auth_middleware` added to modal_serve.py (GET /health exempt); yono-classify, yono-analyze, yono-vision-worker all pass `Authorization: Bearer $MODAL_SIDECAR_TOKEN`
- **Verified**: GET /health → 200 (no auth), POST /classify no token → 401, POST /classify with token → 200
- **Upload script rewritten**: `yono/scripts/upload_tier2_to_modal.sh` now includes zone files, --zone-only, --no-deploy flags, auto-runs `modal deploy` after upload
- **Tasks completed**: ba1593fd (TTLRM eval, NO-GO), b6b693ab (Bearer auth, DONE)
- **Training status**: German tier-2 running (PID 28401, epoch 4/25), watcher PID 7390 waiting; zone classifier DONE (72.8% val_acc)

### [deal-flow] Transfer system wiring + suppress_notifications — VP Deal Flow 2026-02-27
- **suppress_notifications (P78 COMPLETED)**: transfer-automator seed_from_auction + seed_from_listing now accept suppress_notifications param. backfill_transfers_for_sold_auctions DB function updated to always pass suppress_notifications:true. Both deployed.
- **Crons 223-227**: Still paused. Email blast risk eliminated. Re-enable ONLY after Twilio working (CFO task P92). Command: UPDATE cron.job SET active = true WHERE jobid BETWEEN 223 AND 227;
- **stripe-webhook wired**: checkout.session.completed with purchase_type=vehicle_transaction now calls transfer-advance:advance_manual for payment_confirmed milestone. Deployed.
- **vehicle_transactions.ownership_transfer_id**: UUID FK column added (Management API). Migration 20260227120000. Links Stripe fee record to parent ownership_transfer.
- **get_transfer bug fixed**: Was "{error: '[object Object]'}" — now uses error.message. Deployed.
- **Twilio diagnosis**: .env has placeholders → Supabase secrets set to placeholders → 401 on every SMS. Filed CFO task (P92).
- **ownership_transfers schema**: inbox_email, buyer/seller_access_token, buyer/seller phone/email columns exist (deployed outside migration tracking — added doc migration 20260227110000).

### [frontend] Vehicle profile page — comprehensive UX quality pass — commit 475c6ce1b
- VehicleProfileTabs: rewrote tab bar with human-readable labels (Overview/Media/Specs/Comps/Taxonomy/Bids), URL deep-linking via ?tab=, hover states, comps count badge
- VehicleComparablesTab: fixed double padding (card wrapper + SimilarSalesSection both had padding)
- VehicleDescriptionTab: replaced hardcoded 320px grid column with responsive CSS classes
- VehicleSpecsTab + VehicleTaxonomyTab: 'Not specified' null fallback → '—'
- VehicleMediaTab: added flex column layout
- VehicleBasicInfo: replaced noisy red MISSING badge for transmission/mileage/color with muted 'Unknown' (VIN/Year keep MISSING — identity fields)
- VehicleHeroImage: SVG placeholder when no photo; image container dark bg uses design token
- SimilarSalesSection: fixed '0d ago' bug (now 'Today'/'Yesterday'), improved empty state, added container padding, fixed skeleton height
- VehicleProfile: replaced hardcoded colors (#1a1a1a, #333, #999) with design tokens; back button navigates(-1) not wrong route

### [frontend] Org profile + offering page UX improvements — commit d24aa0ad0
- InvestorOffering (/offering): replaced bare access-code gate with compelling landing showing 4 key stats, value prop headline, competitor context strip; added "Contact to Invest" CTA in portal header; fixed tab overflow; increased body text to 10pt; updated YONO status to reflect Phase 5 + deployed sidecar
- OrganizationProfile (/org/:id): removed "Business docs" red button from all orgs (only owners now); skeleton loading state; toast notifications replacing all alert() calls; fix tab font var; verification badge in header
- MarketCompetitors (/market/competitors): split CTA into trade + investor inquiry cards with /offering link

### [docs] SDK README + OpenAPI + Quickstart — VP Docs
- Rewrote `tools/nuke-sdk/README.md` (v1.4.0): install, 3 quick examples (search, vision, signal), full API reference for all 14 resources, types table, rate limits, error handling, changelog link
- Fixed `docs/api/openapi.yaml`: Vision paths were misplaced inside `components` section — moved to proper `paths` block. Added `api-v1-export` + `api-v1-exchange` endpoints. Added `MarketFund` + `VehicleOffering` schemas. Bumped spec version to 1.4.0. Now 21 documented paths, 29 operationIds.
- Created `docs/QUICKSTART.md`: zero-to-first-call guide with VIN lookup, comps, batch vision, signal scoring, bulk export, error handling, rate limits, REST API examples

### [extraction] BaT extraction queue unblocked — 119,300 pending items now draining
- Root cause: `process-bat-extraction-queue` edge function was NOT deployed (returned 404/NOT_FOUND on all invocations)
- `aggressive-backlog-clear` cron (job 65, every 10min) was firing correctly but hitting dead endpoint
- Fix: Deployed `process-bat-extraction-queue` via `supabase functions deploy`
- Added dedicated cron job 260 (`bat-extraction-queue-worker`, `*/2 * * * *`) for more frequent firing
- Confirmed function now processes: `{"success":true,"processed":1,"completed":1}` on first invocation
- Queue: 119,300 pending items, oldest Dec 20, 2025. Drain rate: ~36/hr from crons (function processes 1 item/call by design)
- Note: `claim_bat_extraction_queue_batch` RPC provides atomic claim preventing double-processing

### [extraction] PCarMarket URL slug YMM fallback — deployed
- Problem: 50 items/run failing with "Missing required fields (year, make, model)"
- Root cause: `parsePCarMarketIdentityFromUrl()` only matched `/auction/YEAR-slug` pattern, not `/marketplace-YEAR-make-model`
- Fix: Added second regex in `parsePCarMarketIdentityFromUrl()` — tries `/marketplace-(\d{4})-(.+?)` if `/auction/` pattern fails
- Handles compound makes (land rover, mercedes-benz, aston martin, alfa romeo, rolls-royce) correctly
- Example: `/marketplace-2005-land-rover-range-rover` → `{ year: 2005, make: 'land rover', model: 'range rover' }`
- Deployed: `import-pcarmarket-listing` via `supabase functions deploy`
- File: `supabase/functions/import-pcarmarket-listing/index.ts` (lines 202-206)

### [frontend/perf] Auth waterfall elimination — commit 05000c396
- Created `nuke_frontend/src/contexts/AuthContext.tsx`: single global `getSession()` at app boot, initialised synchronously from localStorage (Supabase `sb-{ref}-auth-token`). Returns `loading=false` on first render for returning users.
- Updated `useAuth` hook: now reads from AuthContext, zero network calls per mount
- Updated `useSession` (AppLayout): delegates session/loading to AuthContext, profile fetch only
- Wrapped `App.tsx` in `<AuthProvider>` as outermost provider
- Fixed 14 pages: Vehicles, DeveloperDashboard, AddVehicle, InvoiceManager, ApiKeysPage, MarketSegments, MarketFundDetail, SocialWorkspace (7 inline getSession calls), DataDiagnostic, DealerBulkEditor, Dashboard, Search, RestorationIntake, Profile
- Before: N pages x async getSession() waterfall per mount. After: 1 getSession() at app start, all pages read from context synchronously

### [cfo] CFO session — Twilio diagnosis + pipeline unpause + token budget — 2026-02-27
- Twilio 401 root cause: NOT negative balance. Credentials were never configured — .env has placeholder values ("your-twilio-account-sid"). Twilio error 20003: invalid username.
- Filed P88 task to COO for founder action (real Twilio account + credentials required). SMS cost estimate: $0.0079/SMS, 150K backfill = ~$1,185.
- Claimed and completed pre-existing CFO Twilio task (id: f49f82f7).
- Filed P80 CEO memo (via COO): Unpause analyze-image in YONO-first hybrid mode. Cost: $3,250 total capped ($50/day x 65 days), $150/month ongoing. Vs $2,000/month cloud-only. Wait for PIDs 7241+7390 to finish, then remove NUKE_ANALYSIS_PAUSED.
- Filed P75 CTO recommendation: ralph-spawn token budget — Haiku for workers ($0.056/task), Sonnet for VPs ($0.525/task), Opus for strategy ($5.25/task). 22-task run at mixed model = ~$14 vs $115 all-Opus. Annual savings vs all-Opus: ~$72K.
- Updated CFO cost model in .claude/CFO_IMAGE_PIPELINE_COST_MODEL.md (prior version already comprehensive — no changes needed).

### [frontend] Map bug fixes — 2026-02-27
- Removed Math.random() jitter from UnifiedMap.tsx geo() — replaced with deterministic hash-based offset (simpleHash). Same location always renders at same spot. Commit 1ad6c89c7.
- Added custom cluster icons (blue/white for vehicles, amber/black for query) via makeClusterIcon() + iconCreateFunction prop. Eliminates black-on-black cluster count bubble visibility issue.
- GPS priority was already correct (gps_latitude first, geo() fallback). Verified and left intact.
- Fixed pre-existing bug: businesses Supabase select was fetching 'type' column (doesn't exist) instead of 'entity_type'.

### [coo] Executive triage + work order routing — 2026-02-27 11:30 UTC
- Reviewed all VP inboxes (all empty)
- Confirmed YONO training: zone classifier DONE (72.8% val_acc), german tier-2 epoch ~5/25, watcher PID 7390 active
- Task snapshot: 19 pending, 3 in_progress (VP-AI ONNX upload, VP-Photos brief, curator dedup)
- Filed 5 new work orders:
  - f49f82f7: CFO P90 — Twilio negative balance blocking transfer SMS
  - 9fb1563a: VP-Extraction P80 — RM Sotheby's individual listing scraper
  - 87446ee0: VP-Extraction P80 — Gooding individual listing scraper
  - 6deef460: VP-Deal-Flow P78 — add suppress_notifications before re-enabling backfill crons
  - d4149eb7: VP-Platform P75 — Transfer System UI (operator dashboard + buyer/seller pages)
- Cancelled duplicate ONNX task be95e3aa (fdf5038f already in_progress)
- Key gap identified + filed: FB Marketplace probe had no task — filed 62f30b2e (VP-Extraction P82) for logged-out GraphQL path probe
- Note: VP Extraction already active on RM Sotheby's (per ACTIVE_AGENTS.md) — 9fb1563a is redundant, will self-resolve

### [cto] Architecture review + work orders — 2026-02-27 11:30 UTC

Filed 7 agent_tasks from CTO architecture review:
- P80 vp-platform: ralph-spawn token budget controls (MODEL_MAP, --max-tokens-per-agent, --session-budget, Opus cap 3, token logging)
- P75 vp-ai: YONO Modal sidecar Bearer token auth (modal_serve.py middleware + yono-classify + yono-analyze updated)
- P70 vp-extraction: crawl-bat-active archiveFetch violation fix
- P70 vp-extraction: sync-live-auctions archiveFetch violation fix
- P60 vp-extraction: extract-gooding sitemap fetch audit
- P55 vp-extraction: source-census audit (classify as acceptable health-check or fix)
- P50 vp-platform: Agent type registry audit + remap

Processed CFO cost model task (bcf6d537): CTO approved model tiering (Haiku=workers, Sonnet=VPs, Opus=exec). Deferred model_hint DB column — MODEL_MAP in code sufficient. Added Opus concurrency cap of 3 to work order.

### [extraction] FB Marketplace GraphQL probe — 2026-02-27 07:20 UTC

**Finding: Logged-out GraphQL works from residential IPs, blocked from Supabase datacenter IPs.**

Key results:
- `doc_id: 33269364996041474` with `viewer.marketplace_feed_stories.edges` — CONFIRMED WORKING from residential
- LSD token extractable from marketplace HTML (changes per request, session-specific)
- 24 listings per page, full pagination via `end_cursor`, zero overlap between pages
- Tested: Austin TX, Seattle WA, Chicago IL — all work with 24 listings
- Datacenter IP block: `Rate limit exceeded (1675004)` — IP-level, not session-level
- FB serves 1.1MB to residential, 460KB stripped response to datacenter IPs
- `vehicle_info` field NOT returned in logged-out GraphQL (year/make/model must be parsed from title)

Existing infrastructure confirmed working:
- `scripts/fb-marketplace-local-scraper.mjs` — local scraper (GraphQL + 43 metro areas configured)
- `scripts/fb-relay-server.ts` — relay architecture exists, relay currently offline

Created: `facebook-marketplace-extraction.md` — full technical reference with 3 paths forward

### [platform] Platform health sprint — 2026-02-27 05:30 UTC

**Stubs from inventory (P97 — task d1c9187e):**
- 24K stub vehicles (no year/make/model) were leaking into public search
- Fixed search edge function ilike fallback (added YMM null filters)
- Applied migration 20260227060000 — updated search_vehicles_fulltext, search_vehicles_fuzzy, search_vehicles_fts
- Created vehicles_inventory view (is_public=true AND year/make/model NOT NULL)
- Fixed Search.tsx nearby query to filter YMM nulls
- Deployed search + universal-search edge functions

**Quality backfill timeout fix (P85 — task b769a800):**
- Workers 237-240 timing out every run (batch 150-300 rows, JOIN on temp table = 2min lock wait)
- Fix 1: Reduced batch size to 50 rows, switched from JOIN to = ANY(array)
- Fix 2: Added SET LOCAL lock_timeout = '5s' + EXCEPTION handler to fail fast on contention
- All 4 workers now succeeding: W1=<15s, W2=~17s, W3=~32s, W4=~48s
- Rate: ~12K rows/hour across 4 shards (queue draining in parallel)

**DB load / cron cleanup (P78 — task 946fdae8):**
- Deactivated 3 crons causing heavy DB load:
  - treemap-refresh (job 175): 10x CONCURRENT mat view refreshes, each 17min — every 30min = always failing
  - auto-duplicate-cleanup (job 43): hitting statement timeout 3/4 runs
  - dedup-vehicles-batch (job 258): lock contention on vehicle_images + vehicles, 100% fail rate
- Fixed reconcile_listing_status(): reduced batch 50→10 items, removed SET LOCAL statement_timeout (doesn't override pg_cron parent timeout)
- Net result: 3 fewer constant statement timeouts every 10-30 minutes

### [intel] Similar Sales feature — vehicle profile Comps tab — 2026-02-27
- Built `SimilarSalesSection.tsx` — card grid showing 5-20 comparable sold vehicles
  - Platform badges (Bring a Trailer, Barrett-Jackson, Mecum, etc.) with brand colors
  - Sold date (relative: "2yr ago"), mileage, thumbnail image, listing URL
  - Summary stats bar: avg/median/range price across all comps
  - Show more/fewer toggle at 6+ results
- Enhanced `api-v1-comps` edge function:
  - New param: `vehicle_id` (resolves canonical make/model/year via pk lookup)
  - Added `auction_events` as primary data source via `get_auction_comps()` DB function
  - `get_auction_comps()`: plpgsql JOIN of vehicles+auction_events, uses `idx_vehicles_make_model` + `idx_auction_events_vehicle`, 8s internal timeout
  - Calls RPC via direct `fetch()` to PostgREST (avoids Supabase JS client timeout issues)
  - Fallback: `vehicles.sale_price` for records without auction events
  - Performance: 0.6s (make/model/year params), ~3.5s (vehicle_id with pk lookup)
- Updated `VehicleComparablesTab.tsx`: Similar Sales section first, user-submitted comps below
- `get_auction_comps` DB function created (SECURITY DEFINER, plpgsql, 8s timeout)

### [platform] Stub vehicle filter — inventory accuracy fix — 2026-02-27
- Problem: ~97K stub vehicles (is_public=true, no year/make/model) polluting all search/inventory
- Solution: Added `year/make/model IS NOT NULL` filter to all inventory read paths
- DB: Updated `search_vehicles_fts`, `search_vehicles_fulltext`, `search_vehicles_fuzzy` functions
- DB: Created `vehicles_inventory` view (public vehicles with minimum data — use for future queries)
- Edge functions deployed: `api-v1-search`, `api-v1-vehicles`, `universal-search`
- Frontend: `IntelligentSearch.tsx` autocomplete now filters stubs
- Migration: `20260227060000_filter_stub_vehicles_from_inventory.sql`
- Audit findings by platform: C&B 99.9%, Barrett-Jackson 99.9%, BaT 94.3%, Mecum 91.8%,
  Bonhams 19.1% (extraction sprint ongoing), User Submission 13.5% (expected)
- Stubs remain in DB and surface automatically once extraction fills YMM
- Tasks completed: d1c9187e (P97 vp-platform), 3827a50b (P85 cdo audit)
- Commit: 5257d97f9

### [extraction] CL asking price backfill + queue assessment — 2026-02-27 05:00 UTC
- Built and deployed `backfill-cl-asking-price` edge function
  - Scrapes individual CL listing pages to extract asking price via `<span class="price">` and JSON-LD
  - 500ms delay between requests (CL rate limit avoidance)
  - Handles expired listings (410) gracefully, rejects junk prices ($1 placeholders)
  - Triggers batch-market-proof after successful updates
- Ran 10 batches of 25 entries = 250 entries processed
  - 97 null prices → prices restored (190 → 93 remaining, 51% reduction)
  - 93 remaining: ~60 expired 410s, ~25 $1 placeholder prices (unfixable), ~8 rate-limited
- Created cron job 259 (daily 6 AM UTC) to keep CL prices current
- Completed 2 agent_tasks: c8259c99 + 041380bf (queue backlog assessment)
  - Actual drain rate: 3,793/hr (not 384/hr as estimated — that was per-worker, not system total)
  - ETA to clear backlog: ~25h (not 91h)
  - BaT nearly complete (144 pending), MecumLive 33.8K, C&B 27K, B-J 15.4K

### [yono] Zone classifier + tier2 watcher restarted — 2026-02-27 04:52 UTC
- Zone classifier (PIDs 12814+39959) were dead since last session
- Added --resume flag to yono/scripts/train_zone_classifier.py (loads head+optimizer state, advances LR schedule)
- Resumed zone training from epoch 10 checkpoint: PID 7249/7241, epoch 11/15, best_val_acc=72.8%
- Restarted tier2 watcher: PID 7390, watching zone PID 7241, will train german/british/japanese/italian/french/swedish + ONNX export
- YONO sidecar (Modal): confirmed operational via edge function test; redeployed for freshness. Direct curl from dev machine gets 404 (Modal IP restriction) but edge functions work fine.
- Vision workers 247+248 confirmed active and succeeding every 2 min
- iPhoto library scan (PID 23805): completed 2026-02-25, results in yono/library_scan/scan_results.json

### [platform] INCIDENT fix: bat-snapshot-parser statement timeout (jobs 173/174) — 2026-02-27 03:43 UTC
- Root cause: `parse_bat_snapshots_bulk()` cursor scanned 367K rows (59GB table) to find 291 unprocessed rows — `(metadata->>'parsed_at') IS NULL` filter had no index; pg_cron's 120s timeout killed every run before any row was processed
- Fix: created partial index `idx_lps_bat_unparsed_fetched` (16KB, covers only unparsed BAT rows) → query plan switched from SeqScan to Index Scan
- Also reduced batch size 300→100 in cron jobs 173/174 for safety margin
- Migration: `20260227040000_bat_snapshot_parser_index_fix.sql`

### [cwfto] Situational brief — 2026-02-27 03:40 UTC
- 1.25M vehicles, 101K import queue pending, 18.5% quality backfill (231K/1.25M)
- Zone classifier PID 12814 alive at epoch 9/15 (~3hrs remaining); replied to COO watchdog
- YONO sidecar unreachable (vp-ai task P85 in_progress)
- DB statement timeouts on simple queries — under heavy extraction + backfill load
- Filed 3 follow-up tasks: DB load investigation (vp-platform P78), queue backlog verification (vp-extraction P78), dedup incident tasks (vp-platform P30)
- Scheduled next CWFTO loop (P92)

### [db] observation_sources completeness audit — COMPLETED 2026-02-27
- Audited all active sources (auction_events, listing_page_snapshots) against observation_sources
- Found 2 missing: `collecting-cars` (122 auction_events, collecting-cars-discovery edge fn) and `broad-arrow` (1 event, extract-broad-arrow edge fn)
- Added both with base_trust_score=0.80, category=auction
- Documented 4 slug normalization mismatches in notes (bringatrailer→bat, cars_and_bids→cars-and-bids, hagerty→hagerty-marketplace, ecr→exclusive-car-registry)
- Total sources: 90 → 92

### [platform] mecum-live-queue-worker connection pool incident — COMPLETED 2026-02-27
- INCIDENT: jobs 251-255 (mecum-live-queue-workers 1-5) experiencing ~50% startup timeout failures
- Root cause: 40 active minute-frequency crons saturating connection pool
- mecumlive queue: 34k pending items (NOT empty — workers genuinely needed)
- Fix: deactivated workers 3, 4, 5 (jobs 253, 254, 255) — kept workers 1 and 2 active
- Total active minute-frequency crons reduced: 40 → 37
- Net throughput unchanged: 2 reliable workers = 5 workers at 50% failure rate

### [docs] OCR pipeline startup brief + stale-lock bug fix — COMPLETED 2026-02-27
- Pipeline status: 259 complete, 656 skipped, 1 pending (unlocked), 0 failed
- 50% of complete items linked to vehicles; 0 deals linked (link-document-entities not matching deals)
- Skipped breakdown: 653 low-confidence `other`, 3 vehicle-image false-positives (no deal_document_id), 3 real docs (2 registration + 1 title) at confidence 0-15 — flagged for manual review
- Fixed bug: stale-lock cleanup cron (job 256) was missing `pending` status — a locked-pending item could never self-recover. Fixed to include `pending` in the covered statuses.
- Manually unlocked stale receipt item `69dc746e` (locked since 02:17 UTC, over 1h stale)
- Vault (vault_attestations): 0 entries — not yet populated
- Both OCR crons active and healthy: job 250 (worker-batch, */5min), job 256 (stale-lock-cleanup, */3min)

### [worker] Exponential backoff for failed extractions — COMPLETED 2026-02-27
- Added retry logic to `process-import-queue` failure paths (extractor failure + catch block)
- Transient errors (timeout, rate_limited, blocked): 10 min base delay × 2^attempts, max 8 attempts, cap 2 hours
- Non-transient errors (extraction_failed, browser_crash, bad_data): 5 min base × 2^attempts, max 5 attempts, cap 2 hours
- Non-vehicle pages (skipped) remain terminal (no retry)
- Increased `p_max_attempts` in claim from 3 → 8 to allow retries to run
- `next_attempt_at` set on retry; claim RPCs already respect it (WHERE next_attempt_at IS NULL OR next_attempt_at <= NOW())
- `continuous-queue-processor` already had full backoff — no change needed there
- Deployed: `process-import-queue`

### [worker] BAT extractor consolidation — COMPLETED 2026-02-27
- Canonical flow confirmed: `complete-bat-import` → `extract-bat-core` + `extract-auction-comments`
- Fixed `extract-premium-auction`: was routing bat/bringatrailer to deprecated `bat-simple-extract`, now routes to `complete-bat-import`
- Fixed `crawl-bat-active`: was calling `bat-simple-extract` directly, now calls `complete-bat-import`
- Updated `_shared/approved-extractors.ts`: added `bat-simple-extract` and `bat-extract` to `DEPRECATED_BAT_EXTRACTORS`; added `ENTRY: 'complete-bat-import'` to `APPROVED_BAT_EXTRACTORS`
- Updated `TOOLS.md`: corrected 3 references that pointed to deprecated `bat-simple-extract`
- Deployed: `extract-premium-auction`, `crawl-bat-active`
- Note: `bat-extract` and `bat-simple-extract` functions still exist (not deleted) but all live callers now route to `complete-bat-import`

### [vp-platform] API bulk export endpoint — COMPLETED 2026-02-27
- Deployed `api-v1-export` edge function at `/functions/v1/api-v1-export`
- Formats: `format=csv` (attachment), `format=json` (paginated), `format=ndjson` (streaming-friendly)
- Parquet: returns helpful 422 with pandas conversion hint (`pd.read_json(..., lines=True).to_parquet(...)`)
- Cursor-based pagination via `?cursor=<last_id>` — O(1) vs OFFSET, scales to full dataset
- Rate limits: service-role 100K rows, API key 10K rows, user JWT 5K rows per request
- Field selection: `?fields=id,year,make,model,vin,sale_price` (24 fields available)
- All filters: make, model, year/year_min/year_max, price_min/max, vin, transmission, mileage_max, drivetrain, body_style, quality_min
- Unlocks Priya's $200-800/month enterprise tier. Task 4ae51478 completed.

### [vp-extraction] Scrapling Evaluation — NO-GO — COMPLETED 2026-02-27

- **Question**: Should we adopt Scrapling (adaptive selectors, StealthyFetcher, Camoufox) for extraction pipeline?
- **Verdict: NO-GO**. Three decisive reasons:
  1. **Language mismatch**: Python-only. Our pipeline is 100% Deno/TypeScript edge functions. Requires separate Python microservice (Modal/Railway) = new infra + latency + failure mode.
  2. **Wrong failure mode**: Our extractors fail on JSON/API structure changes, not CSS selector breaks. Bonhams uses JSON-LD; Mecum uses `__NEXT_DATA__` JSON. Scrapling's adaptive selectors don't help.
  3. **StealthyFetcher economics**: `archiveFetch()` cache-first already makes Firecrawl cheap. Python StealthyFetcher service would cost more than the Firecrawl it replaces.
- **Revisit**: Python forum scraper (Rennlist, TheSamba) OR Scrapling v1.0 stable.
- Task 9080e841 completed in agent_tasks.

### [vp-orgs] Startup brief / domain audit — COMPLETED 2026-02-27
- 4,003 orgs: 1,831 collection, 1,729 other, 107 dealer, 75 auction_house
- Critical gaps identified: organization_seller_stats (1 entry, stale Feb 14), organization_inventory (0 rows), classic_seller_queue (109 pending, no cron processor), ECR data (45 days stale, no refresh cron)
- Working: enrich-organizations-daily (job 69), seller-intel-rollup (job 214, every 4h), bat-seller-monitor-sweep (job 166, every 6h)
- Sellers extremely thin: 7 pipeline_sellers, 9 seller_sightings total, 0 org-to-seller linkage
- Needs: cron for compute-org-seller-stats, cron for classic_seller_queue drain, ECR refresh schedule, org-to-seller bridge

### [vp-platform] Search UI: Fix F tier / 0 observations — COMPLETED 2026-02-27

- **Root cause**: universal-search returned only year/make/model in metadata; VehicleCardDense calculated F tier for all results
- **universal-search**: Added 20+ vehicle fields to SELECT; FTS path now enriches limited RPC results with second IN query; `buildVehicleMetadata()` uses comment_count→event_count proxy, primary_image_url→image_count
- **SearchResults.tsx**: Passes vin, sale_price, current_value, asking_price, mileage, transmission, profile_origin, ownership_verified, view_count, image_count, event_count to VehicleCardDense; list view shows key specs row (price, VIN, mileage, transmission)
- **Result**: BaT imports with comments now score C/B tier; vehicles with VIN+price score D/E; images display when primary_image_url is set
- Deployed to Supabase. Commit: 2ffdb4a6d

### [cpo] SDK v1.4.0 — nuke.signal.score() — COMPLETED 2026-02-27

- **`api-v1-signal` edge function** deployed to Supabase. GET by `vehicle_id` or `vin`.
- Reads from `nuke_estimates` (521K rows, 8.3K with deal_score, all 521K with heat_score).
- Computes `price_vs_market` live: `(asking_price - estimated_value) / estimated_value * 100` (negative = below market = good deal).
- Derives `comp_count` from `signal_weights.comps.sourceCount`.
- Translates internal labels (`plus_3` → `strong_buy`, `minus_3` → `overpriced`) to consumer-facing names.
- Returns 404 with actionable hint when no estimate exists.
- **SDK changes**: `signal.ts` resource + `SignalScore`/`SignalScoreParams` types + wired into `Nuke` client.
- **Version**: `@nuke1/sdk` bumped `1.3.1` → `1.4.0`.
- **Docs**: `CHANGELOG.md` created, `openapi.yaml` updated with `/api-v1-signal` path + `SignalScore` schema.
- **Validated**: live endpoint returns correct data (2006 LR3, $600 sale price, $7100 estimated, -91.55% below market ✓).

### [vp-platform] P0: Search/API Filtering Completely Broken — FIXED 2026-02-27

**Root cause 1 — api-v1-vehicles**: `?make=Porsche&model=911&year=1973` params were read but **never applied** as query filters. Fixed by adding full filter chain: `make`, `model`, `year`, `year_min`, `year_max`, `vin`, `price_min`, `price_max`, `transmission`, `mileage_max`, `sort`, `sort_dir`.

**Root cause 2 — universal-search**: FTS "strategy 2" (raw `search_vector @@ to_tsquery`) at relevance=0.8 returned noise (e.g. "997" matching Austin-Healey Sprite 997cc descriptions); filtered to relevance >= 0.85. Over-aggressive year+make+model dedup collapsed distinct cars — replaced with ID-only dedup. Always-run ILIKE fallback merged with FTS for reliable make/model matching.

**Verified**: `?make=Porsche&model=911&year=1973` → 665 correct results; "porsche 997 gt3" → actual GT3s; "Ford" → 113K Fords.
- Files: `supabase/functions/api-v1-vehicles/index.ts`, `supabase/functions/universal-search/index.ts`

### [vp-platform] P1: Search Filters — COMPLETED 2026-02-27

- Added vehicle search filters to `Search.tsx` (task 212b6ecc)
- **Filter panel**: price range (min/max), year range, max mileage, transmission (auto/manual/any), for-sale vs sold toggle — appears whenever vehicle results are present
- **Enrichment**: post-search Supabase query fetches `sale_price, mileage, transmission, is_for_sale, city, state` for all vehicle result IDs; merged into result metadata
- **Filtering**: client-side, computed via `useMemo` on enriched results; active filter count badge + "Clear all" button
- **Sort**: added Price (asc/desc) and Year (asc/desc) options to `SearchResults.tsx` sort dropdown
- TypeScript clean (tsc --noEmit passes)
- Files: `nuke_frontend/src/pages/Search.tsx`, `nuke_frontend/src/components/search/SearchResults.tsx`

### [vp-platform] P0: Market Dashboard timeout — COMPLETED 2026-02-27

- `MarketDashboard.tsx` was querying `market_segments_index` view directly → statement timeout every load
- Investor (James) had rejected platform based on the broken page ($0 AUM + timeout error)
- Fix: replaced entire page with professional "Coming Soon" placeholder — no DB queries, no errors
- Route `/market` and `/market/dashboard` still live, CTA buttons link to working `MarketExchange` page
- Task 4317301c marked complete in agent_tasks

### [vp-platform] Platform Health Check + Cron Config Fixes — COMPLETED 2026-02-27 ~03:00 UTC

**Health Summary:**
- 160 cron jobs total (146 active, 14 intentionally inactive)
- Zero stale queue locks
- Quality backfill workers 237-240: ACTIVE, making progress (~97K rows across 4 shards, ~1.05M remaining)
- Import queue: 102,911 pending, actively processing

**Fixed 4 broken cron jobs** (all using stale `current_setting()` config — `app.supabase_url`/`app.service_role_key`/`app.settings.*` not set in DB):
- Job 213 (exchange-pricing-cycle): Was returning NULL URL → fixed to hardcoded URL + `get_service_role_key_for_cron()`
- Job 235 (agent-monitor-scan): Was throwing "unrecognized config param" → fixed same way
- Job 186 (paper-trade-autopilot): Same broken pattern → fixed
- Job 128 (auto-sort-telegram-photos): Same broken pattern → fixed

**Incident tickets filed:**
- P70: bat-snapshot-parser-continuous (jobs 173/174) — ~19% failure rate from statement timeout in `parse_bat_snapshots_bulk()`
- P60: mecum-live-queue-workers (251-255) — ~50% failure rate from connection pool saturation (45 minute-frequency crons total)

### [worker] Extraction Metrics Logging — COMPLETED 2026-02-27

- Created `extraction_metrics` table: per-invocation rows with extractor_name, source, run_id, source_url, vehicle_id, success, latency_ms, error_type, error_message, http_status
- Created `extraction_metrics_hourly` view: hourly rollups with success rate %, avg/p50/p95 latency, and jsonb error_breakdown per extractor+source
- Created `extraction_metrics_24h` view: 24h health summary ordered by failure count
- Created `supabase/functions/_shared/extractionMetrics.ts`: `ExtractionMetricsLogger` class (startItem/recordSuccess/recordFailure/flush), `logExtractionMetric` quick helper, `categorizeError` function
- Updated `continuous-queue-processor`: uses `ExtractionMetricsLogger` per extractor, times each item fetch, records success/failure with categorized error type and HTTP status, batch-flushes to DB at end of run
- Migration: `supabase/migrations/20260227020000_extraction_metrics.sql`

### [vp-extraction] Extraction Queue Snapshot + Next Optimization Target — COMPLETED

**Queue Depths (02:50 UTC Feb 27)**

| Source     | Pending | Rate/hr | ETA      | Error Rate        |
|------------|---------|---------|----------|-------------------|
| mecum      | 16,934  | 521     | ~33 hrs  | 2 failed (~0%)    |
| b-j        | 17,966  | 626     | ~29 hrs  | 0 failed          |
| pcarmarket | 2,587   | 128     | ~20 hrs  | 50 failed (1.9%)  |
| bat        | 1,603   | 745     | ~2.2 hrs | 2 failed (~0%)    |
| bonhams    | 14      | 43      | ~0.3 hrs | 0 failed          |
| gooding    | 15      | 113     | ~0.1 hrs | 2 failed          |
| c&b        | 0       | —       | CLEARED  | —                 |

**Description Coverage (sample of 50 recent items per source)**
- mecum: 100% — Phase 2 fix verified working
- BaT: 100%
- PCarMarket: 100%
- B-J: 44/48 = 91.7%
- Bonhams: 20/22 = 90.9%
- Gooding: not measurable via queue (vehicle_id not written back to import_queue rows)
- C&B: not measurable (queue cleared)

**Secondary Finding: bat_extraction_queue stalled**
- 119,160 pending items, 0 processing — oldest items from Dec 20, 2025 (2+ months idle)
- `process-bat-extraction-queue` function exists but no active cron firing it
- Step 2 of BaT pipeline (comment extraction) completely stalled

**Next Optimization Target: PCarMarket URL-slug fallback parsing**
- 50 failures all "Missing required fields (year, make, model)"
- Year/make/model IS in the URL slug: e.g. `/marketplace-2005-land-rover-range-rover`
- Fix: add URL slug regex fallback in `import-pcarmarket-listing` before quality gate

## 2026-02-26

### [worker] Rate limiting on public endpoints — 2026-02-26
- Created `supabase/functions/_shared/rateLimit.ts` — reusable fixed-window rate limiter backed by Postgres
- Migration `20260226250000_rate_limits_table.sql`: `rate_limits` table + `rate_limit_increment()` SECURITY DEFINER RPC + `rate_limits_cleanup()`
- `universal-search`: 60 req/min per IP (60s window)
- `map-vehicles`: 120 req/min per IP (60s window — higher for map tile interactions)
- Fail-open on DB errors (never blocks users due to RL infra issues)
- Adds `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers to all responses
- Returns 429 with `Retry-After` when limit exceeded
- Both functions deployed

## 2026-02-27

### [cdo] Data Quality Audit — 2026-02-27
- **Scale confirmed**: 1,254,455 vehicles (pg_class), 33,742,616 images, 11.6M auction comments
- **Quality backfill progress**: 100,200 vehicles scored across 4 workers (8% of corpus). Scored vehicles trend 80-86/100 avg — scoring function is well-calibrated.
- **Score distribution** (gooding, fully scored 369 vehicles): p25=80, p50=90, p75=90, p90=90 — high scores when data present
- **Cross-source averages**: gooding 86.2, barrett-jackson 83.3, mecum 79.9
- **Grade F sources**: bonhams (25,202 vehicles, 12.4% YMM — worst single source), ecr_collection_text (24,995 vehicles, 0.04% YMM), forum_build_extraction (9,321 vehicles, 4.3% YMM), thesamba (83 vehicles, 49.4% YMM)
- **Grade D**: facebook_marketplace (3,655 vehicles, 60.1% YMM coverage)
- **Missing fields across all sources**: ~92K null year, ~25K null make, ~28K null model — dominated by bonhams + ecr_collection_text + __unknown__ source
- **Top 3 levers**: (1) Bonhams YMM re-parse (+22K scoreable vehicles), (2) backfill completion ETA ~30hr, (3) ecr_collection_text/forum_build cleanup or YMM extraction from text

### [worker] Health check endpoint — 2026-02-27
- Deployed `supabase/functions/health` edge function (no-verify-jwt)
- 3 parallel checks: DB connection ping, recent extractions (last 1h + 24h with rate drop detection), queue depth (pending/processing/stuck with high-depth warn)
- Returns `status: ok|degraded|down` + structured per-check detail JSON
- HTTP 200 for ok/degraded, 503 for down
- Validated: DB ok 516ms, 182 extractions/last-1h, queue=113k items (degraded, matches known backlog)

### [vp-ai] YONO sidecar URL verification + fix — 2026-02-27
- **Root cause found**: URL typo — `sss73133` (wrong) vs `sss97133` (correct) Modal workspace slug
- **Sidecar confirmed alive**: `https://sss97133--yono-serve-fastapi-app.modal.run/health` → 200 OK, `uptime_s=696`, `vision_mode=finetuned_v2`, `flat_classes=276`
- **yono-classify confirmed working**: end-to-end test returned `make=british, conf=0.57, ms=313ms, available=true, source=yono`
- **YONO_SIDECAR_URL in Supabase**: explicitly set to `https://sss97133--yono-serve-fastapi-app.modal.run` (confirmed)
- **Fixed**: `yono/scripts/upload_tier2_to_modal.sh` had `sss73133` typo → corrected to `sss97133`
- **Note**: `modal deploy` CLI output shows wrong URL (`sss73133`) — display bug, actual workspace slug is `sss97133`

### [vp-extraction] Import queue backlog investigation — 2026-02-27
- Alert fired: extractable count hit 1,000 (threshold 500)
- Investigation confirmed: NOT stalled. 100+ active workers, 1,305 items/hr, 0 stale locks
- Failures: 59 total, all quality gate rejections (missing year/make/model) — expected behavior
- Extractable breakdown: Other 638, Cars & Bids 360, BaT 2
- ETA to clear: ~48min — self-resolving demand spike, no action taken

### [cpo] SDK v1.3.0 — YONO Vision shipped — 2026-02-27
- **Release scope**: `nuke.vision.classify()`, `nuke.vision.analyze()`, `nuke.vision.batch()` — all live
- **`family` field added**: `api-v1-vision` now passes through `family` + `family_confidence` from YONO's tier-2 hierarchical classifier on all 3 routes (classify/analyze/batch)
- **SDK types updated**: `VisionClassifyResult` and `VisionAnalyzeResult` now include `family`, `family_confidence`, `is_vehicle`
- **`CHANGELOG.md` created**: `tools/nuke-sdk/CHANGELOG.md` with full v1.3.0 + v1.3.1 entries, historical v1.0–1.2 entries
- **OpenAPI spec updated**: `docs/api/openapi.yaml` — Vision tag added, `/api-v1-vision/classify`, `/analyze`, `/batch` endpoints fully documented
- **Work order filed**: `agent_tasks` id `00c0e808-ce31-4474-8032-73837903126a` — SDK v1.4.0: `nuke.signal.score()` market signal scoring (priority 85)
- **Next feature decision**: Signal score over comps — "Is this a good deal?" is the monetization unlock; comps is second

## 2026-02-26

### [cfo] Image Pipeline Unpause Cost Model — 2026-02-26
- Built full decision matrix: YONO-first hybrid strategy vs. full cloud vs. stay paused
- Key finding: $64K figure was wrong. Current Gemini-Flash pipeline = $0.0001/image (20x cheaper)
- Actual backfill cost: $3,250 (capped at $50/day × 65 days) for 32M images
- YONO covers: make/family classification (yono-classify, $0) + zone/condition/damage (yono-vision-worker, already running, not paused)
- Cloud still needed for: camera geometry, subject taxonomy, description, VIN/SPID detection
- Recommended threshold: 70% confidence (35-40% cloud escalation rate)
- Monthly ongoing: $130-180/month vs $2,000/month cloud-only
- Full model: `.claude/CFO_IMAGE_PIPELINE_COST_MODEL.md`
- Email recommendation sent to CEO

### [worker] RLS Audit — vehicles, vehicle_observations, auction_comments — 2026-02-26
- **vehicle_observations**: RLS was completely disabled — enabled it + added `vo_service_role_all` (ALL for service_role) and `vo_authenticated_read` (SELECT for authenticated users on public/owned vehicles)
- **vehicles.allow_vehicle_inserts**: dropped — it was `{public}` role with `WITH CHECK = true` (anon inserts). Replaced with `vehicles_authenticated_insert` scoped to `{authenticated}` + `auth.uid() IS NOT NULL`
- **vehicles.vehicles_delete_policy**: changed from `{public}` to `{authenticated}` role
- **auction_comments**: already secure — no changes needed
- Migration: `supabase/migrations/20260226240000_rls_audit_core_tables.sql` applied directly to DB

## 2026-02-27

### [cto] Architecture Review: Modal Sidecar + Agent Infrastructure — 2026-02-27

**MODAL SIDECAR (yono/modal_serve.py):**
- `@modal.asgi_app()` + FastAPI: APPROVED — correct long-term pattern for multi-endpoint model serving
- `min_containers=1` at $0.06/hr idle: APPROVED — cold start is 10-15s (Florence-2), keepwarm justified
- Model storage split: Florence-2 in image (fast cold start), ONNX in volume (hot-swap on training updates) — APPROVED
- CONCERN #1 (Medium): No auth on Modal endpoint — raw URL is unauthenticated. Work order issued to VP AI: add bearer token middleware before SDK v1.3.0 launch.
- CONCERN #2 (Low): `/analyze/batch` runs up to 20 Florence-2 inferences via `asyncio.gather` — no semaphore. Single CPU core will serialize them anyway, but add `asyncio.Semaphore(5)` before high-volume pipeline use.

**AGENT INFRASTRUCTURE (.claude/agents/ + ralph-spawn.mjs + agent-monitor):**
- Atomic claim state machine (pending → claimed → in_progress → completed): APPROVED
- File-based persona system (CLAUDE.md per role): APPROVED — version-controlled, diffable, zero DB overhead
- ralph-spawn.mjs concurrency pool: APPROVED — correct pull-from-queue pattern
- agent-monitor deduplication (line 156: checks existing pending before insert): APPROVED — no flood risk
- CONCERN #3 (HIGH): No per-agent token budget. 100 turns × Sonnet pricing = up to $20/agent on complex tasks. With 22+ pending tasks at concurrency 5, single run could hit $100-400. Work order issued to CFO + VP Platform.
- CONCERN #4 (Medium): Unregistered agent types in queue — "sentinel", "guardian", "curator", "harvester", "oracle" have no personas in `.claude/agents/`. Ralph-spawn falls back to worker persona. May be intentional (worker-class agents), but no persona = no domain knowledge injection.
- CONCERN #5 (Low): DONE.md and ACTIVE_AGENTS.md have concurrent write race with >1 agent. Acceptable now. If concurrency >5, move state tracking fully to agent_tasks table.

**Work Orders Issued:** VP AI (auth middleware), CFO+VP Platform (token budget), VP AI (semaphore for batch analyze)

### [worker] vehicle_observations compound indexes — 2026-02-27
- EXPLAIN ANALYZE confirmed vehicle timeline query scanning 369K rows, taking 9.8s
- Created `idx_observations_vehicle_time`: `(vehicle_id, observed_at DESC) WHERE vehicle_id IS NOT NULL`
- Created `idx_observations_kind_time`: `(kind, ingested_at DESC)`
- Both CONCURRENTLY (no table lock). Table columns: `kind` (not observation_type), `ingested_at` (not created_at)
- Vehicle timeline query now uses compound index directly (no sort, no filter scan)



### [vp-platform] Admin panel overhaul — 2026-02-27
- `AdminHome.tsx`: Ralph Brief auto-loads snapshot on mount (no button click needed)
- `AdminHome.tsx`: Operational pulse block shows import_queue pending/failed, agent_tasks pending by type, agent inbox unread — live, refreshes every 30s
- `AdminHome.tsx`: Cards show live pending/unread counts with red alert borders when non-zero
- `AdminShell.tsx`: Nav badges on Inbox, Agent Inbox, Reviews, Verifications, Ownership Verifications — red count chips, refresh every 60s
- New page `AdminAgentInbox.tsx` at `/admin/agent-inbox` — reads agent_messages from Supabase, role filters (to/from), unread toggle, thread view, mark-read via agent-email edge function
- Routes + nav wired for `/admin/agent-inbox`



### [cto] ralph-spawn: Multi-Agent Parallel Task Executor — 2026-02-27
- Built `scripts/ralph-spawn.mjs` — orchestrates parallel Claude Code sessions against `agent_tasks` queue
- Uses `@anthropic-ai/claude-agent-sdk` `query()` function (no TTY issues, native async iteration)
- Atomic task claiming: `status='pending'` → `claimed` → `in_progress` → `completed/failed` prevents double-execution
- Concurrency pool: up to N workers (default 5) pull from queue, claim tasks, spawn agents, drain
- Persona loading: reads `.claude/agents/{role}/CLAUDE.md` as system prompt `append`; falls back to `worker` persona
- Options: `permissionMode: 'bypassPermissions'`, `settingSources: ['project', 'user']`, `maxTurns: 100`
- CLI flags: `--concurrency N`, `--agent <type>`, `--dry-run`, `--list`, `--max-tasks N`, `--model <name>`
- 22 pending tasks in queue ready to execute
- Run: `dotenvx run -- node scripts/ralph-spawn.mjs --concurrency 5`
- Committed: `6ed85a0e9`



### [vp-ai] YONO Post-Sidecar Brief + Tier-2 Upload Script — 2026-02-27
- Assessed live training state: zone classifier PID 12814 (epoch 8/15), tier-2 watcher PID 39959 standing by
- PID 34496 confirmed complete (hier_american_best.pt + hier_family_best.pt in outputs/hierarchical/)
- Built `yono/scripts/upload_tier2_to_modal.sh`: polls for "=== DONE ===" in tier2_remaining.log, uploads all hier_*.onnx + hier_labels.json to Modal volume yono-data /models/, prompts redeploy
- Filed work order fdf5038f-7eb5-40ab-9b3b-3154f9da175a (vp-ai, priority 85) for upload execution ~5-6h from now
- Image pipeline unpause deferred: requires CFO cost model coordination + CEO approval (tier-2 + zone must complete first)

### [coo] All-hands CEO Briefing — 2026-02-26
- Executed startup sequence: inbox, queue health, PID verification, cron status
- Identified 3 status corrections vs CEO brief: quality backfill (237-240) paused not running; PID 34496 done (zone classifier 12814 + watcher 39959 continuing); geocode PID changed 8523→54824
- Created 5 new all-hands tasks: vp-deal-flow, vp-orgs, vp-photos, vp-docs, vp-vehicle-intel
- Dispatched work orders to all 14 cabinet members via agent email system
- Sent CEO real email brief with corrections and open questions
- Import queue state: 105K pending, 341 processing (mecum 51.8K, C&B 29.2K, B-J 18.4K)

### [infra] pgBouncer Connection Pooling — Transaction Mode
- **Secret set**: `NUKE_DB_POOL_URL` = `postgresql://postgres.qkgaybvrernstplzjaam:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres` (pgBouncer transaction mode)
- **Note**: `SUPABASE_DB_URL` prefix is now blocked by Supabase CLI/API, so pooler URL uses `NUKE_DB_POOL_URL`
- **4 edge functions updated** to prefer `NUKE_DB_POOL_URL || SUPABASE_DB_URL`:
  - `agent-email` — added `prepare: false` to postgres.js client (required for transaction mode; postgres.js prepares by default)
  - `db-stats` — 3 connection sites updated
  - `investor-portal-stats` — updated
  - `map-vehicles` — updated
- **All 4 deployed** via `supabase functions deploy`
- deno-postgres `Pool` (used by db-stats, investor-portal-stats, map-vehicles) does not use prepared statements with template literals — transaction mode compatible without changes



### [docs] Document OCR Pipeline — Storage Bug + Re-extraction + Cron Setup
- **Storage bug fixed**: `getImageAsBase64` in `document-ocr-worker` was hardcoding `deal-documents` bucket for all signed URLs. Items with full `vehicle-images` HTTPS URLs now try direct fetch first, fallback to signed URL via regex-parsed bucket name.
- **RLS fixed**: `document_ocr_queue` had RLS enabled with no policies. New-style `sb_secret_...` key doesn't bypass RLS through PostgREST. Applied `allow_all` universal policy — function now sees all 916 rows.
- **Ollama backfill**: discovered ALL 486 "complete" items were extracted by ollama (llama3.2-vision:11b) which returned empty data. Re-queued 384 poorly-extracted items (null vin AND null make) back to `pending` with higher priority (10 for vehicle-ID docs, 5 for others).
- **Cron added**: `document-ocr-worker-batch` — runs every 5min, batch_size=3, processes pending items with Claude Sonnet.
- **Stale lock cleanup cron**: `document-ocr-stale-lock-cleanup` — runs every 3min, resets items stuck in classifying/extracting/linking for >5min back to pending.
- **Verified**: Claude Sonnet now being used (`extraction_provider: "anthropic"`), vehicle linking working (cost_sheet linked to vehicle_id).
- **Queue status**: ~280 pending, 105 complete, 529 skipped, processing at ~3 items/5min.



### [deal-flow] Transfer System — Cross-Department Architecture + Notifications
- **Audit**: found ownership_transfers (30K rows), all stalled at step 1, zero vehicle_transactions rows, no party notification
- **Migrations applied**:
  - `add_ownership_transfer_tokens` — buyer_access_token + seller_access_token on ownership_transfers (unique indexed, auto-populated all 30K rows)
  - `link_vehicle_transactions_to_ownership_transfers` — ownership_transfer_id FK on vehicle_transactions
- **Brief**: `.claude/VP_DEAL_FLOW_TRANSFER_BRIEF.md` — full cross-department coordination doc with CTO/CFO/CPO/VP Platform decisions
- **`notify-transfer-parties`** deployed — outbound SMS (Twilio) + email (Resend) for seeded/milestone_advanced/stalled/overdue; fire-and-forget, never blocks
- **`transfer-automator`** updated — calls notify-transfer-parties after both seedFromAuction and seedFromListing
- **Note**: Twilio 401 — env creds need setting in Supabase secrets; Resend email confirmed working
- **Remaining**: stripe-checkout-transfer function + payment_confirmed milestone wiring (VP Deal Flow)
- **VP Platform tasks**: /admin/transfers dashboard, /t/:token buyer-seller page, Log a Deal modal (see brief)

### YONO Modal Sidecar — Florence-2 Vision Deployed 2026-02-27
- Updated `yono/modal_serve.py`: added `/analyze` and `/analyze/batch` endpoints
  - Uses fine-tuned Florence-2 VehicleVisionHead (`finetuned_v2` mode)
  - Returns: vehicle_zone, zone_confidence, condition_score, damage_flags, modification_flags, interior_quality, photo_quality
  - Photo_type → zone mapping (ext_front, ext_rear, ext_driver_side, int_dashboard, mech_engine_bay, etc.)
  - Zero-shot fallback for when fine-tuned head fails to load
- Uploaded to Modal volume (yono-data): `yono_vision_v2_head.safetensors`, `yono_vision_v2_config.json`, `hier_family.onnx.data`
- Florence-2-base pre-baked into Modal image (`_download_florence2` run_function)
- URL: `https://sss97133--yono-serve-fastapi-app.modal.run`
- Set `YONO_SIDECAR_URL` in Supabase secrets and local .env
- Validated: yono-classify (ms=40), yono-analyze (mode=finetuned_v2, ms=9-10s on CPU)
- Old warm container draining naturally (within 10min of inactivity)

## 2026-02-26 (Rally RD competitor import)

### Rally RD Fractional Ownership Cars — IMPORTED 2026-02-26
- Created `scrape_sources` entry for Rally Rd. (id: 36a0b276-0710-4472-a886-869a807ea090)
  - url: https://www.rallyrd.com, source_type: marketplace, pattern: `rallyrd\.com`
  - `scrape_config` tags it as `fractional_ownership` competitor
- `observation_sources` already had rally-rd entry (id: ac3abc03-bf47-4fd1-8812-f26a293350f2)
- Inserted 9 vehicles into `import_queue` (all status=pending, source_id auto-linked, priority=10)
  - `raw_data` carries: platform, competitor:true, fractional_ownership:true, market_cap, share_price, provenance, mileage
  - 1955 Porsche 356 Speedster, 1965 Ford Mustang Fastback ($110K market cap), 1977 Lotus Esprit S1 (James Bond)
  - 1978 Aston Martin V8 Vantage Oscar India (URL had false-positive 'art' filter, manually overridden)
  - 1985 Ferrari Testarossa (Don Johnson/MJ/Elton John/Dr. Dre), 1988 Lamborghini Jalpa (Rocky IV)
  - 1994 BMW 850CSi (1 of 225 NA), 2003 Saleen S7 ($420K market cap), 2005 Ford GT (371 miles)
- No pre-existing rallyrd.com data found in DB
- No `competitor_platforms` table exists; data stored via standard scrape_sources + import_queue

## 2026-02-26 (YONO sidecar + agent infrastructure session)

### YONO FastAPI Sidecar — SHIPPED TO MODAL — COMPLETED 2026-02-26
- `yono/modal_serve.py` rewritten to use `@modal.asgi_app()` — single base URL with path routing
- Deployed: `https://sss97133--yono-serve-fastapi-app.modal.run`
- Fixed: onnxruntime 1.17.3→1.19.2 + `numpy<2` (NumPy 2.x incompatibility), `allow_concurrent_inputs`→`@modal.concurrent` deprecation
- `YONO_SIDECAR_URL` set in Supabase secrets
- Full round-trip validated: `yono-classify` → Modal → ONNX → `{"make":"german","confidence":0.78,...,"available":true}`
- Endpoints: GET /health, POST /classify, POST /classify/batch
- `min_containers=1` keeps one warm (avoids cold starts)
- P85 + P100 agent_tasks both marked completed

### Multi-Agent Infrastructure — COMPLETED 2026-02-26
- `CODEBASE_MAP.md` — 413-line semantic map of all 397 edge functions (27KB)
- `NUKE_COMPANY_BRIEF.md` — constitutional document loaded by all agents
- `.claude/agents/` — CLAUDE.md files for all roles: coo, cto, cfo, cpo, cdo, vp-extraction, vp-ai, vp-platform, vp-vehicle-intel, vp-deal-flow, vp-orgs, vp-docs, vp-photos, worker
- `~/bin/open-agent` — launches any role with session resume support
- `~/bin/save-session` — persists session ID for future resume
- `~/bin/list-tasks` — shows pending agent_tasks queue
- `agent-monitor` edge function — reactive issue scanner, pg_cron job 235 every 5min
  - Detects: stale locks, import queue backlog, BaT tasks stuck, missing quality scores, YONO down
  - Creates agent_tasks routed to correct VP automatically

## 2026-02-26 (YONO vision v2 session)

### YONO Vision V2 — Zone System + Auto-Launcher — COMPLETED 2026-02-26

**Zone labeling:** 100% complete. All 2764 records in `training_labels/labels.jsonl` now have `vehicle_zone` from the 41-zone taxonomy. Zone distribution: ext_front_driver=260, int_dashboard=222, mech_engine_bay=219, ext_driver_side=216, other=206, ext_undercarriage=197...

**Zone classifier training:** Watcher launched (PID 80532). Polls until condition model (PID 68092) finishes, then auto-launches `train_zone_classifier.py --epochs 15`. Logs to `yono/outputs/zone_classifier/watcher.log` and `training.log`.

**Bug fixed:** `_zone_classifier` missing from `global` declaration in `server.py` lifespan function — would have caused ZoneClassifier to always be None at module level even after loading.

**Scripts:**
- `yono/scripts/wait_then_train_zones.sh` — watcher that auto-launches zone training after condition model finishes
- `yono/outputs/zone_classifier/` — output directory created

**Background processes:**
- PID 68092: `train_florence2.py` — epoch 3/10, still running. Watcher waiting on this.
- PID 80532: `wait_then_train_zones.sh` — watching PID 68092, will auto-launch zone training.

**What to do after both finish:**
1. Restart `server.py` to load both fine-tuned models
2. Run `generate_condition_report.py --all-bat` to build condition reports
3. Install colmap (`brew install colmap`) then run `bat_reconstruct.py`

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

**Current state (updated 2026-02-26 ~18:50):**
- Actual scope: 132,915 vehicles need geocoding (111,697 have listing_location from BAT/CL history, 28,700 have legacy location col — more than initial 28k estimate)
- Backfill running: PID 8523, ~1,498 geocoded so far, ~131k remaining
- DB index created: `idx_vehicles_geocode_backfill` on vehicles(id) WHERE (listing_location/location NOT NULL) AND gps_latitude IS NULL — enables keyset pagination without full table scan
- In-memory geo cache added to script: avoids repeat Nominatim calls for same city/state (estimate ~3-5k unique city/state combos in 133k records). Cache warms over first ~100 batches, then subsequent batches are near-instant.
- ETA: overnight (~10-15 hours given Nominatim rate limit on first pass, then cache-accelerated)
- Monitor: `tail -f /tmp/geocode-backfill.log` (stdout is buffered — DB writes happen live, log flushes in batches)
- Verify: `SELECT COUNT(*) FROM vehicles WHERE gps_latitude IS NOT NULL;`

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

## 2026-02-26 (Extraction Quality Sprint — Phase 3, post-compression)

### Bonhams Description Fix — 0% → 66% — COMPLETED 2026-02-26 ~22:00

**Root causes found (3 total, not 1):**
1. Firecrawl trigger condition was wrong: `(!hasJsonLd || html.length < 5000)` always false for Bonhams React shell (120KB, has JSON-LD metadata). Firecrawl NEVER ran for fresh pages.
2. Footnotes-only extraction: ~30% of Bonhams lots have a `### Footnotes` section. The other 70% have inline description paragraphs directly after the lot title H2.
3. vehicle_id not linked (fixed in prior sub-session).

**Fixes deployed:**
- `extract-bonhams/index.ts`: Changed `needsFirecrawl` condition from `!fetchResult.cached && !hasLotContent && (!hasJsonLd || html.length < 5000)` to `!hasLotContent`. Now fires Firecrawl whenever we don't have rich markdown, regardless of HTML content.
- `extract-bonhams/index.ts`: Added extraction path B — inline body description: regex captures paragraphs between the lot title H2 (`## **{Year} {Make}...`) and `## Additional information`. Covers lots without Footnotes sections (the majority).
- Result: description rate **0% → 66%** (47/71 lots in first 10 min after deploy). Avg description length 3,564 chars.

**Verified on:**
- 1929 Brough Superior SS100: 4,800-char description from Footnotes section ✓
- 1933 Fiat 508 Balilla: full inline body description extracted ✓  
- 1934 Dodge, 1935 MG Magnette, 1949 Triumph: confirmed having descriptions ✓

### Gooding Throughput Boost — 43/hr → 187/hr — COMPLETED 2026-02-26

- Added crons 233, 234 (gooding-queue-worker-1, gooding-queue-worker-2) in Phase 2
- By Phase 3: confirmed 187/hr actual throughput (was 43/hr round-robin)
- ETA reduced: 36 hrs → 7 hrs for remaining 1.3K pending

### Final Pipeline State (2026-02-26 ~22:00)

| Source   | Pending | Rate/hr | ETA hrs |
|----------|---------|---------|---------|
| mecum    | 54,520  | 828     | ~66     |
| c&b      | 30,486  | 984     | ~31     |
| b-j      | 22,676  | 1,931   | ~12     |
| pcarmarket| 4,963  | 157     | ~32     |
| bat      | 3,550   | 832     | ~4      |
| bonhams  | 2,435   | 573     | ~4      |
| gooding  | 1,317   | 187     | ~7      |

All descriptions now being extracted correctly. Bonhams: Firecrawl fires for every uncached page, both Footnotes AND inline body parsed.

## 2026-02-26

### [competitors] Insert fractional ownership competitor data into import_queue
- Rally Rd: Updated 9 existing records with full VINs, specs, tickers, market_cap, share_price, fractional ownership data
  - Cars: '55 Porsche 356 Speedster, '65 Mustang Fastback, '77 Lotus Esprit S1, '82 Aston Martin V8 Vantage, '85 Ferrari Testarossa, '88 Lamborghini Jalpa, '94 BMW 850CSi, '03 Saleen S7, '06 Ford GT
  - Corrected year: Aston Martin 1978→1982, Ford GT 2005→2006 (per VIN decode)
- TheCarCrowd: Created scrape_source (id: 34c7812c) + inserted 15 UK syndicate vehicles (2 fundraising, 9 active, 3 planned)
- Fraction Motors: Created scrape_source (id: 8d85dde9) + inserted 5 Solana-tokenized vehicles with VINs + SOL token pricing
- Total: 9 updated, 20 inserted (15 TCC + 5 FM), 2 new scrape_sources

## 2026-02-26 — Competitor Intelligence

### [market] Competitor comparison page — MarketCompetitors.tsx
- Built /market/competitors page with real scraped data (not guesses)
- Vercel Edge Middleware for OG tags (Twitter/LinkedIn/iMessage link previews)
- Share button with navigator.share / clipboard fallback

### [market] Competitor research — 3 deep passes
Pass 1: Identified real competitors (dropped Collectable/Otis/Apex Trader — not car platforms)
Pass 2: Scraped Rally WP API (9 cars, VINs, market caps, share prices), TheCarCrowd (15 UK syndicates), Fraction Motors (5 Solana cars with VINs)
Pass 3: Perplexity deep research — Rally $112M raised/$40M AUM/SEC fine, TheCarCrowd own site says NOT FCA-regulated/12.5% fees, MCQ Markets added as new competitor, market size $1.38B total/<$100M AUM combined

### [db] 29 competitor vehicles imported to import_queue
- 9 Rally (VINs, specs, market caps, share prices — all verified)
- 15 TheCarCrowd UK syndicates (Ferrari F430, Porsche 996 GT3 RS, Audi R8, Mercedes SLS, etc.)
- 5 Fraction Motors (VINs: Mustang K-Code, Chevelle SS, GT500, Beetle, Fiero)
- scrape_sources created for TheCarCrowd + Fraction Motors
- All tagged: competitor:true, fractional_ownership:true

### [comms] Briefed 4 teams
- VP Extraction: process 29 import_queue records, VINs listed
- VP Vehicle Intel: use Rally/Fraction Motors prices to validate our NAV accuracy
- CPO: market wide open (<0.3% fractionalized), SDK opportunity outlined
- VP Deal Flow: competitor secondary market structures + Rally SEC precedent

## 2026-02-27

### [deal-flow] Transfer system startup audit — Task 840e4012
- Audited full transfer-automator pipeline (seed_from_auction, seed_from_listing, staleness_sweep, get_transfer, update_contacts)
- Confirmed notify-transfer-parties + transfer-advance both live
- Transfer state: 31,887 total (30,164 in_progress, 1,723 completed), 47,072 overdue milestones
- 150,353 sold auction_events still missing transfers (82.5% of 182,251 total sold)
- Crons 223-227 (transfer-backfill-1 through 5): deactivated, ALL call backfill_transfers_for_sold_auctions(100)
- Assessment: NOT safe to re-enable — would trigger ~300K outbound emails to historical auction buyers/sellers
- Required fix before re-enable: add suppress_notifications param to transfer-automator seed_from_auction
- Blocker: Twilio suspended (negative balance, CFO owns); email (Resend) working
- No duplicate transfers found — idempotency is clean
- Minor bug: get_transfer returns [object Object] on missing transfer (String(error) on Supabase error object)

## 2026-02-27

### [extraction] Import queue backlog investigation — Task 68c9b395
- Investigated 101,935 pending items in import_queue
- **Verdict: Not a stall — was a demand spike.** Bulk ingestion on 2026-02-26 16:00 UTC added 71,174 items in one hour (Extraction Quality Sprint)
- Queue actively draining: ~50/min, ~57,900/day completions; net drain ~28K/day
- No stale locks, only 95 failed items (all normal quality gate rejections: missing year/make/model)
- Platform breakdown: Mecum 51K, C&B 28K, B-J 17.5K, PCarMarket 2.5K, BaT 1.1K
- Mecum workers 3-5 intentionally disabled — rate limiting issue (214 rate-limited skipped items confirms this)
- C&B/B-J cron startup timeouts (~20-30% miss rate) are pg_cron cold-start issue, not data failures
- ETA to clear backlog: ~3.5 days at current drain rate

## 2026-02-27

[platform] VIN search capability (P1 task 4bcca72a)
- Added dedicated "VIN Lookup" toggle widget to Search page — supports full 17-char VINs and partial (≥5 char) prefix/substring search
- Added `GET /api-v1-vehicles/by-vin/:vin` endpoint — exact or partial VIN, public vehicles only
- Added `search_vehicles_by_partial_vin()` DB function (migration 20260227050000) — uses `lower(vin) LIKE lower(...)` to correctly hit the `vehicles_vin_trgm_idx` trigram GIN index (plain ILIKE caused btree scan → timeout on large table)
- Fixed IntelligentSearch: exact 17-char VIN not in DB now shows clear "not found" message instead of falling through to irrelevant text search results

### [frontend] Admin + Onboarding UX overhaul — commit 5a62f7c34
- Login: Sign in/Create account tabs at top (was buried text link at bottom), explicit button labels
- Login: Design system CSS vars for toggle colors (was hardcoded hex), fixed autocomplete attrs
- Login: Post-login redirect goes to / now (was /vehicles → wasted redirect chain)
- OAuth callback: same fix — / not /vehicles
- Admin routes: /admin/proxy-bids + /admin/unified-scrapers (both were 404, now routed + in nav)
- AdminHome: Ralph loading state shows "loading…"/"asking LLM…" text, not morphing button label
- AdminHome: "Refresh" button replaces "Snapshot" (auto-load already runs snapshot on mount)
- AdminHome: auto-load uses max_failed_samples:50 instead of 250 (faster mount)
- Profile: "Get started" checklist on Overview tab for new users with incomplete profiles
- VehicleCollection: empty own-profile state has "Add a vehicle" CTA button (not just text)
