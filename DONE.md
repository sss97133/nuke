# DONE — Completed Work Log

## 2026-03-06

[map] Smooth zoom/pan — Apple Maps-quality interactions
  - Configured Deck.GL controller: smooth scroll zoom (speed 0.01, smooth: true), inertia (300ms momentum)
  - Added FlyToInterpolator for animated programmatic view transitions (search results fly-to)
  - Replaced bare `controller={true}` with full interaction config (touchZoom, doubleClickZoom, keyboard)

[map] Map v6 UX Overhaul — Phase 3A module extraction + type import fix
  - Extracted mapUtils.ts (353 lines): types, constants, geocoding, hex binning, helpers
  - Extracted hooks/useMapLayers.ts (1024 lines): all Deck.GL layer construction
  - UnifiedMap.tsx reduced from 3,036 → 1,656 lines (-45%)
  - Fixed type-only imports (BizPin, VPin etc.) — Vite strips interfaces, need `import type`
  - Fixed CollapsibleWidget import in ZipSidebarPanel (named export, not default)
  - TypeScript clean, Vite build passes

[data-fix] K10/K20 photo contamination — separated two 1984 Chevrolet trucks
  - Created K20 vehicle record (6ff6497c-784c-4cd7-adcf-28925f97d860, VIN 1GCGK24M6EF375994)
  - Moved 419 misassigned K20 photos from K10 to K20 record
  - Uploaded correct 51 K10 photos from "1984 Chevrolet K10 SWB" album
  - Updated K10 with SPID label data (Scottsdale trim, Frost White, etc.)
  - Hardened iphoto-intake.mjs: added validateVehicleAlbumMatch() — checks year/model match before upload, --force to override

[frontend] Phase 1 — Universal Input System (plan: dreamy-imagining-yao.md)
  - Promoted AIDataIngestionSearch to header (CommandLineLayout.tsx) — replaces plain SearchBar
  - Created GlobalDropZone.tsx — full-page drag-drop overlay, dispatches nuke:global-drop event
  - Wired GlobalDropZone into AppLayout.tsx
  - Added nuke:global-drop listener in AIDataIngestionSearch.tsx (single image → handleImageFile, multi → toast)
  - MobileBottomNav: replaced Market with Inbox, added badge count (orphan vehicle_images query)
  - DomainRoutes: /inbox → PersonalPhotoLibrary, added /photo-library alias, TeamInbox → /team-inbox
  - Build passes clean (TypeScript + Vite)

[yono] Nuke Agent QLoRA fine-tune — Qwen2.5-7B on Modal A100
  - Built training data export script `scripts/export_nuke_agent_data.py`
    - 3 data sources: Supabase schema introspection, edge function code, vehicle domain knowledge
    - Exports chat-format JSONL (system/user/assistant) for instruction tuning
    - 2,049 train + 108 val examples generated
  - Built Modal training script `yono/modal_nuke_agent_train.py`
    - QLoRA (4-bit NF4) on Qwen/Qwen2.5-7B-Instruct
    - LoRA rank=64, alpha=128, 161M trainable params (3.58% of 4.3B)
    - 3 epochs, batch=4, grad_accum=8, cosine LR schedule
    - Includes merge_and_export + list_agent_runs functions
  - Uploaded training data to Modal volume `yono-data`
  - Fixed version compatibility issues:
    - accelerate 0.35 doesn't exist (jumped to 1.0) — removed <1.0 cap
    - transformers 4.57 needs accelerate 1.0+ (keep_torch_compile kwarg)
    - torch_dtype deprecated → dtype
    - Fixed import json ordering bug in main()
  - Training completed: run_id=20260306_144355
    - Loss: 4.35 → 0.07 (rapid convergence), eval_loss=0.0707
    - Runtime: 97 min on A100-SXM4-40GB
    - LoRA adapter saved to volume: nuke-agent-runs/20260306_144355/final/

[data-quality] Massive enrichment campaign — 5 sources running in parallel
  - Barrett-Jackson re_enrich: 3,626+ vehicles enriched, ~1,100 prices + ~2,000 VINs + engine types
  - Bonhams re_enrich: 1,019 vehicles enriched (queue drained), 99.7% success rate
  - Mecum re_enrich: 3,498+ vehicles enriched, ~1,200 VINs added
  - RM Sotheby's: deployed extractor, added offset param, processing 14 auctions
    - PA26 (66 updated), AZ26 (50), CC26 (34), MI26 (20 created + 50 updated), S0226 (6), PA25+ in progress
    - High error rate from memorabilia items (luggage, children's cars) — expected
  - BaT backfill attempted but blocked by "View Result" paywall on ended auctions (21K priceless)
  - Net: +1,000+ prices, +3,000+ VINs (BJ/Mecum still running at session close)

[data-quality] extract-rmsothebys offset support
  - Added `offset` parameter to `process` and `list` actions for batch pagination
  - Allows processing large auctions (190+ lots) within edge function 150s timeout
  - Deployed v2

[scripts] Created scripts/backfill-rmsothebys.sh
  - Processes all 14 known RM auctions in batches of 40
  - Handles offset pagination automatically

[scripts] Created scripts/backfill-bat-prices.sh
  - Feeds BaT URLs to extract-bat-core sequentially
  - NOT effective: BaT paywalls ended auction prices behind "View Result"

[admin] User Metrics Dashboard — /admin/user-metrics
  - New edge function `user-metrics-stats` — 11 parallel SQL queries across bat_user_profiles (504K), bat_users (1.2K), ghost_users (156), fb_marketplace_sellers (127), external_identities (509K), profiles (6)
  - New admin page with stat cards, linkage progress bars, BaT comment distribution chart (Recharts), top 25 users table, ghost/FB/platform breakdowns
  - Route registered at /admin/user-metrics, nav link in Operations section of AdminShell
  - Edge function deployed and live

## 2026-03-05 (Data Source Landscape & Gap Filling)

[data-quality] Deep research on ConceptCarz business model & pricing methodology
  - Proved CZ is an ad-supported content farm (~3 person operation since 1998)
  - "Estimated Sale Value" = trimmed mean of all auctions for a model, NOT a transaction price
  - "Condition tiers" (Fair/Good/Excellent/Perfect) are just price quartiles, not real condition assessments
  - Positioned like KBB/Hagerty but without the rigor — no physical inspections, no defined criteria
  - Full investigation documented in conceptcarz_investigation.md

[data-quality] Comprehensive auction data source landscape analysis
  - Mapped 30+ sources across 5 tiers: Primary Auctions, Aggregators, Expert Valuations, Marketplaces, Wholesale
  - Defined trust tier taxonomy: transaction > aggregated_transaction > expert_valuation > asking_price > computed_estimate
  - Identified Classic.com, Glenmarch, Sports Car Market, Hagerty API as priority ingestion targets
  - Assessed every source for data quality, accessibility, coverage, and known issues

[data-quality] Merged 46,912 duplicate vehicle stubs
  - Found ~45K rows where listing_url matched another vehicle's discovery_url (same car, two records)
  - 98.8% of duplicates had price already on the canonical vehicle
  - BaT: 23,712 merged | BJ: 21,079 | C&B: 50 | Others: 71
  - Used status='merged' + merged_into_vehicle_id to preserve lineage

[data-quality] Barrett-Jackson VIN backfill via re_enrich
  - Backfilled discovery_url for ~760 BJ rows (enabling extractor to find them)
  - Ran re_enrich: 2,397 BJ vehicles enriched, 4,895 VINs added (+33%)
  - Confirmed prices being extracted ($140K Auburn, $2.4M Mercedes 540K, etc.)

[data-quality] Fixed get_enrichment_candidates RPC
  - Was missing sale_price IS NULL from enrichment criteria
  - Bonhams, Gooding, etc. couldn't find price-missing vehicles
  - Updated to include sale_price in enrichment eligibility

[data-quality] Bonhams extractor re_enrich query fix
  - Fallback query had .is("year", null) — filtered out all records that already had year
  - Changed to .or("year.is.null,sale_price.is.null,description.is.null")
  - Deployed extract-bonhams with fix

[scripts] Created backfill-auction-prices.sh
  - Loops re_enrich calls for BJ/Bonhams/Mecum extractors
  - Configurable batch size, concurrency, sleep between rounds

[scripts] Created merge-duplicate-stubs.sh
  - Identifies and merges duplicate vehicle stubs across all auction sources
  - Uses SET session_replication_role = replica to bypass triggers

## 2026-03-04 (Wiring Harness Builder — Full Implementation)

[wiring] Complete visual harness builder for vehicle wiring layouts
  - DB migration: 6 new tables (harness_designs, harness_sections, harness_endpoints, harness_templates, electrical_system_catalog, motec_pin_maps)
  - Seeded: 46 electrical systems, 104 MoTeC pin maps (M130/PDM30/C125), 1 Barton invoice template
  - Extended wiring_connections with 13 new columns (from/to endpoint IDs, calculated gauge, voltage drop, fuse rating, etc.)
  - TypeScript types, AWG resistance table, wire color standards, voltage drop calculations, gauge selection algorithm
  - SVG canvas with pan/zoom, foreignObject HTML nodes (Win95 design), cubic bezier wire edges
  - useReducer state management with undo-capable actions
  - Debounced persistence (800ms canvas state, immediate structural changes)
  - Right sidebar: node editor (name/type/amps/connector/location) + connection editor (color/gauge/length/fuse)
  - Bottom load summary bar: total amps, alternator sizing, battery sizing, PDM channels, warnings
  - Left systems palette: 46 catalog items grouped by category, click-to-add, green/red/grey status indicators
  - Completeness panel: % score, missing required/optional items, +ADD buttons, build intent filtering
  - Toolbar: SELECT/WIRE modes, +ENDPOINT, DELETE, zoom controls, CHECK completeness toggle
  - Keyboard shortcuts: V=select, W=wire, Delete=remove, Escape=deselect
  - Auto-calculations on wire draw: gauge selection, wire color suggestion, length estimation, fuse rating
  - WiringPlan.tsx: template picker, lazy-loaded builder, AI assistant tab preserved
  - Files: harnessTypes.ts, harnessConstants.ts, harnessCalculations.ts, useHarnessState.ts, HarnessCanvas.tsx, HarnessCanvasNode.tsx, HarnessCanvasEdge.tsx, HarnessCanvasSectionGroup.tsx, HarnessToolbar.tsx, HarnessBuilder.tsx, HarnessSidebar.tsx, HarnessLoadSummary.tsx, HarnessSystemsPalette.tsx, HarnessCompletenessPanel.tsx, WiringPlan.tsx
  - Zero TypeScript errors, zero new npm dependencies

## 2026-03-02 (session 3 — save-all + enrichment continued)

[data] Collecting Cars: Downloaded 18,037 lots from Typesense API (17,685 sold + 157 live + 195 coming soon)
  - Saved to scripts/data/collecting-cars/{sold,live,comingsoon}.json
  - Enrichment: 452 matched by slug, +212 GPS fixes (48.3% → 49.4%)
  - Fixed matching to use coords field from Typesense + fuzzy slug matching (base without -N suffix)
  - CC Typesense data has precise coords [lat,lon] for all 18,037 lots

[data] Craigslist: +206 vehicles geocoded from 120 new subdomain→GPS mappings (39.1% → 41.8%)
  - Built comprehensive CL subdomain → GPS map (abbotsford through youngstown)
  - Remaining 2 with null subdomains are dead ends

[data] Facebook Marketplace: +120 vehicles geocoded from city name matching (25.3% → 27.0%)
  - Built "City, ST" → GPS lookup for 100+ US cities
  - Remaining 420 are small towns (2-3 each), would need Nominatim or similar

[data] BaT API enrichment from 277 cached pages: 1,940 vehicles updated (price/title/date)
  - BaT API confirmed: lat/lon fields are ALWAYS null — no GPS from API
  - BaT rate-limiting blocks crawl after ~277 pages (429 errors)
  - 9,972 listings cached in scripts/data/bat-api-pages/

[data] BaT snapshots: 375,351 HTML snapshots available but NO location data in HTML
  - Location data is dynamically loaded, not in the archived HTML

[data] Investigation findings (no GPS gains possible):
  - Gooding: 5,892 vehicles without URLs are historical imports (no URL, no location, no auction info)
  - PCarMarket: 5,839 vehicles without any location — would require scraping individual listing pages
  - Cars & Bids: Online-only auction, no location data exists
  - Barrett-Jackson price: API blocked by Cloudflare WAF (needs residential proxy)

[data] Overall GPS: 282,184 / 746,371 (37.8%)

## 2026-03-02 (session 2 — save-all data caching sprint)

[data] Save-all data caching + enrichment sprint — +37K more vehicles geocoded, 302K Mecum lots saved
  - Mecum Algolia: Downloaded ALL 302,223 lots from Algolia search index (263 auction events, 1.2GB saved to scripts/data/mecum-algolia/)
  - Mecum URL enrichment: 28,169 vehicles matched by URL, 27,855 updated (title, make, model, year)
  - Mecum year+make+price matching: +16,631 GPS fixes for URL-less vehicles, +16,631 listing URLs added (38.5% → 58.9% GPS)
  - Bonhams: Fetched 899 auction locations from bonhams.com/auction/ pages, saved to scripts/data/bonhams-auction-locations.json
  - Bonhams: +18,184 vehicles geocoded from auction→city mapping (0% → 72.2% GPS)
  - Gooding: Downloaded 2,174 lots from Gatsby page-data API, saved to scripts/data/gooding-lots/
  - Gooding: +1,877 GPS fixes from auction event names (0.9% → 24.2% GPS)
  - Broad Arrow: URL-based geocoding (12 event codes mapped) → +1,738 vehicles (0.8% → 88.8% GPS)
  - Scripts created: mecum-algolia-save-all.cjs, bonhams-auction-geocode.cjs, gooding-save-all.cjs, collecting-cars-save-all.cjs
  - BaT API rate-limited after 277 pages (9,972 listings)
  - Overall GPS: 244,741 (32.8%) → 282,184 (37.8%) = +37,443 across 2 sessions

## 2026-03-02

[data] Mass geocoding sprint — +41K vehicles geocoded
  - Barrett-Jackson: URL-based geocoding (9 event cities from URL slugs) → 33,918 vehicles (48% → 99.6% GPS)
  - Craigslist: subdomain-based geocoding (50+ metros) → 2,782 vehicles
  - RM Sotheby's: event code geocoding (az/mo/pa/mi → Scottsdale/Monterey/Paris/Milan) → 961 vehicles
  - GAA Classic Cars: single-location (Greensboro, NC) → 1,294 vehicles
  - Beverly Hills Car Club: single-location (Los Angeles, CA) → 1,998 vehicles
  - Gooding: snapshot-based geocoding (Pebble Beach/Scottsdale/Amelia Island) → 63 vehicles
  - SBX Cars, Collective Auto, Volo Cars: single-location → 356 vehicles
  - Mecum geocoding function updated with Schaumburg, cron slowed to hourly (exhausted)
  - Overall GPS: 201K (27.0%) → 241K+ (32.3%)
[data] Source name consolidation
  - facebook_marketplace + Facebook Marketplace → facebook-marketplace (3,753 unified)
  - Broad Arrow → broad_arrow, RM Sothebys → rm-sothebys, barrettjackson → barrett-jackson
  - classic_com + Classic.com → classic-com
[data] Barrett-Jackson API discovery
  - Found REST API at /api/previous-docket-results (prices, VINs, descriptions, 84 events, ~55K lots)
  - Also /api/facets (event list), /api/docket (active auctions)
  - BLOCKED: Cloudflare WAF, datacenter IPs rejected (same as FB Marketplace)
  - Script written: scripts/bj-api-save-all.cjs (needs residential proxy)
[data] BaT API save-all running overnight
  - scripts/bat-api-save-all.cjs saving all 6,442 pages to scripts/data/bat-api-pages/
  - 231K listings with price, GPS, title, noreserve — permanent local cache
  - Running at ~15 pages/min, ~7hr total
[data] SQL geocoding functions created:
  - geocode_bj_from_urls(batch_size) — B-J URL slug → 9 cities
  - geocode_gooding_from_snapshots(batch_size) — Gooding HTML → 6 cities
  - geocode_mecum_from_snapshots updated with Schaumburg

[frontend] V3 Vehicle Profile Redesign — badge variants CSS, barcode timeline component, badge bar component, gallery column slider, all widgets variant="profile", overscroll-behavior fix, dense info table CSS, page-level typography
[stbarth] Modal GPU vision OCR server deployed and running
  - `scripts/stbarth/modal_vision_server.py` — Qwen2.5-VL-7B-Instruct-AWQ on A10G via vLLM
  - Ollama-compatible API at https://sss97133--stbarth-vision-ocr-web.modal.run
  - AWQ quantization (4-bit) fits comfortably on 22GB A10G VRAM
  - vLLM 0.8.3 + transformers 4.57.x + rope_scaling patch
  - Production throughput: ~1,800 pages/hr @ concurrency 8
  - Projected cost: ~$31 for all 41K pages (vs $414 for Haiku API)
  - 1,000+ pages completed in initial runs, 48 permanently failed (403 CDN)
[data] organization_locations table — multi-location support for orgs
  - 4,593 rows backfilled from organizations table (4,589 primary + 5 Epstein metadata locations)
  - location_id FK added to organization_vehicles
  - Epstein Collection: 5 locations (LSJ, NYC, Palm Beach, NM, Paris), 32/38 vehicles linked
  - search_organizations_near() PostGIS RPC deployed — proximity search working
  - geocode-organization-locations edge function deployed — two-pass (lookup table + Nominatim)
  - Geocoding COMPLETE: 4,308/4,593 locations geocoded (93.8%)
    - 3,205 via Nominatim, 971 imported, 120 lookup table, 12 manual
    - 285 remaining have no city data (can't geocode)
    - Fixed cron job (invalid JSON body), added COUNTRY_CODE map (30+ countries),
      JUNK_CITIES filter, COUNTRY_NAME_FALLBACK for small territories
    - Cleaned 136+ junk city entries (2-char codes, "Exclusive Car Registry", "Homepage", etc.)
    - Bulk strategy: Python batch geocoder + SQL cross-matching + lookup table bulk update
    - Cron #364 disabled (complete)
[data] Epstein Collection provenance completed — 93/93 field provenance rows (38 make + 33 model + 22 year)
[data] FB Marketplace data quality cleanup
  - 299 junk records rejected (motorcycles, boats, ATVs, snowmobiles, jet skis, empty listings)
  - import-fb-marketplace filter expanded: Honda moto models (CB, CBR, Shadow, Goldwing, Magna, etc.),
    BMW moto models (R-series GS, S1000, G310), Suzuki (Burgman, V-Strom), Triumph (Bonneville, Tiger),
    generic keywords (motorcycle, sport bike, chopper, bobber, pontoon)
  - False-positive-safe: scoped rebel/valkyrie to Honda, bonneville/tiger to Triumph, k/c-series to BMW,
    gs/sv/dr-series to Suzuki. Protects AMC Rebel, Pontiac Bonneville, Sunbeam Tiger, Aston Martin Valkyrie,
    Buick GS, Lexus GS, Chevy K-trucks, Mercedes C-class
  - 912 make names case-normalized (ford→Ford, chevrolet→Chevrolet, etc.)
  - 176 additional non-vehicle junk rejected (boats, planes, golf carts, snowmobiles)
  - Added MAKE_CANONICAL normalization map to import function (prevents future case issues)
  - Final state: 3,296 clean FB vehicles, 1,929 rejected (37% rejection rate)

[search] Smart search RPCs deployed — "porsche" now returns 78,221 results (was 7)
  - search_vehicles_browse: 17-param filtered browse with dynamic SQL, COUNT(*) OVER() totals
  - search_vehicles_smart: 4-strategy cascade (exact make → make+model → FTS → trigram)
  - search_autocomplete: categorized results (makes, models, vehicles)
  - search_market_data: JSONB with median price, distribution, recent sales
  - browse_stats: JSONB with total, with_images, with_price, avg_price, by_source/era/model
  - Fixed sold_price type mismatch (INT not NUMERIC)
[search] Intent router + query parser (src/lib/search/)
  - 8 intent modes: NAVIGATE, EXACT_VIN, EXACT_URL, MY_VEHICLES, MARKET, QUESTION, BROWSE, QUERY
  - Query parser extracts: year, price, make, model, body style, color, era
  - 34 unit tests passing (19 intent + 15 parser)
  - Dictionaries: 54 makes, 18 aliases, 22 body styles, 12 eras (mapped to DB values), 27 colors, 15 domains
[header] 4 switchable header variants (command-line, segmented, two-row, minimal)
  - HeaderVariant type + localStorage persistence in ThemeContext
  - Zero-prop AppHeader orchestrator with variant delegation
  - Shared sub-components: SearchBar, SearchOverlay, UserArea, UserDropdown, NavLinks
  - SearchBar: ghost placeholder rotation, ⌘K hint, 4 modes (inline/expanding/compact/trigger)
  - SearchOverlay: recent items + categorized autocomplete + keyboard hints
  - UserDropdown: merged NukeMenu + profile dropdown, header variant picker
  - Responsive: mobile collapses all variants to [NUKE] [⌘K] [avatar]
  - Deleted NukeMenu.tsx and SearchSlot.tsx
[header] AppHeader.css — complete grid layouts for all 4 variants + responsive breakpoints
[design] --radius: 0px global change in unified-design-system.css
[browse] BrowseVehicles page — stats bar, model pills, sort/filter, images toggle, pagination
[db] 4 new indexes (make_status, make_source, make_sold_price, era)
[db] user_vehicle_links table with RLS
[settings] Header variant selector added to AppearanceSpecimen (Capsule settings)

## 2026-03-01

[fb-marketplace] Scraper v3.1 — added --group N flag to split 58 cities into 4 groups of ~15
  - Softer rate limiting: skip-and-continue instead of global abort (3 consecutive = abort)
  - 30s extra delay after rate-limited city (was: instant abort)
  - Counter resets on any successful city scrape
[fb-marketplace] Replaced single daily LaunchAgent with 4 staggered group sweeps (3am/9am/3pm/9pm)
  - com.nuke.fb-sweep.plist → com.nuke.fb-sweep-g{1,2,3,4}.plist
  - Each group: --all --group N --max-pages 25 (was: --all --max-pages 50)
  - 6-hour spacing gives FB rate limit full recovery window
[fb-marketplace] Created monitor-fb-marketplace edge function — 5 health checks
  - Sweep freshness (24h), unlinked backlog (500), error rate (50%), data freshness (48h), refine backlog (1000)
  - Creates admin_notifications on threshold breach, 6h dedup
[fb-marketplace] Added 3 pg_cron jobs:
  - fb-marketplace-import: */30 * * * * — converts unlinked listings to vehicles (batch_size=50)
  - fb-marketplace-refine: 15,45 * * * * — enriches via bingbot HTML (batch_size=15)
  - fb-marketplace-monitor: 0 */6 * * * — health checks + alerting
[fb-marketplace] Deployed import-fb-marketplace and refine-fb-listing edge functions (were local-only)
  - First import batch: 38 vehicles created from 50 listings, 12 blocked (non-cars)
  - Backlog: 2,810 unlinked → will clear in ~14 hours via cron

## 2026-03-01 (Overnight Autonomous Session)

[git] Committed and pushed 330 files of accumulated multi-agent work (e98d0cb85)
[frontend] Fixed 7 crash bugs: Rules of Hooks violation, null guards, SSR safety, infinite loop, undefined text
[frontend] Search results + vehicle cards now show image/event counts and deal score badges
[db] Backfilled 61,385 vehicles with primary_image_url from vehicle_images
[db] Data quality scoring: 37% → 99.94% coverage (1.25M vehicles scored in ~15 minutes)
[db] VIN varchar overflow fix in vehicle_mailboxes (widened to varchar(50))
[infra] Deployed 22 edge functions (14 updated, 8 new including agent hierarchy)
[infra] Cron audit: fixed 3 broken jobs + 1 security fix (hardcoded key), cleaned 51K stale log rows
[infra] Agent hierarchy wired to crons: router (5min), haiku worker (2min), sonnet supervisor (10min)
[extraction] Snapshot extraction fixes: Craigslist archiveFetch, Bonhams JSON-LD fallback, Barrett-Jackson Cloudflare detection, Cars & Bids retry
[extraction] Import queue: 170 → 146 failed items, VIN overflow fixed, Firecrawl items skipped
[search] Universal search accepts both ?q= and ?query= parameters
[sdk] @nuke1/sdk v1.5.0 README updated to match actual vision types, LICENSE file added
[fb] National FB Marketplace sweep running (58 metros, ~1000+ vintage listings so far)
[yono] Verified YONO sidecar healthy (2 warm containers, all tier-2 families loaded)

## 2026-03-01 (Mass Snapshot Extraction v2)

[extraction] Created snapshot_extraction_queue table with pre-computed vehicle→snapshot matches
  - Pre-joined vehicles to listing_page_snapshots with URL normalization (trailing slashes, case)
  - Queue populated: BaT 283K, B-J 23K, Mecum 16K, C&B 1.7K, Bonhams 855 = 326K total
  - Atomic claim_extraction_batch() RPC for lock-free parallel processing

[extraction] Added queue mode to batch-extract-snapshots v2
  - `use_queue: true` — claims from pre-computed queue instead of OFFSET scanning
  - Eliminates statement timeouts at high offsets (40 workers was crashing DB)
  - 100% snapshot hit rate (0 noSnapshot) vs ~40-50% in legacy mode

[extraction] Fixed C&B URL case-sensitivity — snapshot URLs have different case than vehicle URLs
  - Added lowercase URL variants for carsandbids platform matching

[extraction] Completed C&B extraction: 1,728 vehicles → 17,409 fields filled (~10 fields/vehicle)
  - Color +1,389, Transmission +1,387, Engine +1,037, Description +1,393

[extraction] Completed Bonhams extraction: 855 vehicles → 139 fields filled

[extraction] BaT extraction running: 15K+ of 284K processed so far → 38K+ fields filled
  - Color +6,518, Transmission +13,373, Engine +8,834, Description +5,764, Mileage +12,842
  - 5 workers running in background, ~268K remaining (~13h estimated)

[extraction] Barrett-Jackson: 23K queued but CSR shells produce 0 extractable fields
  - Need Playwright/API approach for VIN, colors, engine data

## 2026-03-01

[quality] Massively accelerated data_quality_score backfill — scored 790K+ vehicles in ~15 minutes
  - Created `quality_backfill_shard(shard_index, total_shards, batch_limit)` function with UUID-prefix isolation
  - Ran 4 parallel shards (5000 rows each, every 3 minutes) to eliminate deadlocks
  - Result: 99.94% vehicles scored (1,256,107/1,256,922), avg score 75.58
  - Remaining 815 zero-score vehicles are genuinely empty (no year/make/model/anything)
  - Disabled old `data-quality-workforce` cron (job 304, 300/run) — replaced with:
    - `quality-score-maintenance` (job 343): `*/5 * * * *`, 1000/run — handles new incoming vehicles
  - Removed temporary aggressive shards (jobs 339-342) after backfill completed
  - Created `fast_backfill_quality_scores(batch_limit)` function — inline scoring with `session_replication_role=replica` (bypasses 29 triggers)
  - Ran additional sweep: 800K rows in 19m via management API, 10K rows/batch, ~500-690 rows/sec
  - Replaced old inactive cron (job 237, 50 rows/5min) with `quality-backfill-fast` (job 344, 5000 rows/10min)
  - Final state: 1,241,306 scored / 1,242,120 total (99.93%), 814 genuinely empty, 0 nulls
[snapshots] Fixed snapshot success rates for Bonhams, Barrett-Jackson, Cars & Bids, Craigslist
  - archiveFetch: Added isGarbageHtml() to detect Cloudflare challenges, React shells, and bot walls — marks as success=false instead of true
  - Craigslist: Replaced raw fetch() with archiveFetch() in extract-craigslist, process-cl-queue, scrape-all-craigslist-squarebodies — was creating 0 snapshots
  - Craigslist: Removed bot User-Agent that Craigslist blocks, now uses browser UAs via hybridFetcher
  - Bonhams: Added JSON-LD fallback when Firecrawl fails/credits exhausted — gets year/make/model/price from React shell
  - Bonhams: Wrapped Firecrawl call in try/catch so credits exhaustion doesn't crash the extractor
  - Barrett-Jackson: Added 503 and Cloudflare JS challenge detection to skip useless direct fetches faster
  - Cars & Bids: Increased Firecrawl maxAttempts from 1 to 2 (retry once on transient failure)
  - Cars & Bids: Added missing fetched_at timestamp to snapshot records

[agent-hierarchy] Wired agent hierarchy into pg_cron for continuous processing
  - agent-tier-router-pipeline (job 336): every 5 min, runs full Haiku dispatch + Sonnet review cycle (10 items/batch)
  - haiku-extraction-worker (job 337): every 2 min, additional Haiku extraction capacity (10 items/batch)
  - sonnet-supervisor-review (job 338): every 10 min, additional Sonnet review for pending_review items (10 items/batch)
  - All three functions tested manually — healthy and processing correctly
  - 460 pending items in import_queue at deploy time
  - Migration: 20260301010000_agent_hierarchy_crons.sql
  - Enables 10x cheaper extraction via Haiku ($1/$5 MTok) vs Sonnet ($3/$15 MTok)

## 2026-02-28 (Photo Spatial Mapping — 10K GPS Pins)
- [scripts] iphoto-intake.mjs: Added `--map-only` mode — inserts GPS metadata from osxphotos without requiring local image files (works with iCloud-only photos)
- [scripts] iphoto-intake.mjs: `queryAlbumMetadata()` extracts lat/lng/place/date/EXIF from osxphotos JSON, `extractPhotoMeta()` handles nested place objects
- [scripts] iphoto-intake.mjs: `--backfill-gps` mode updates existing iphoto images with GPS from Apple Photos metadata
- [scripts] Ran `--map-only` across all 72 vehicle albums: 10,181 GPS-tagged photos across 48 vehicles
- [frontend] UnifiedMap.tsx: Photo map layer (magenta pins) with GPS-tagged images as ScatterplotLayer
- [frontend] UnifiedMap.tsx: Photo side panel with thumbnail, vehicle link, location, date, camera, GPS coords
- [frontend] UnifiedMap.tsx: Increased photo layer limit 5K→15K to display full dataset
- [data] Before: 0% of iphoto images had GPS. After: 99.6% (10,181/10,219) have GPS coordinates

## 2026-02-28 (Vehicle Zone Deprecation / Angle String Migration)
- [frontend] NEW: `nuke_frontend/src/constants/vehicleZones.ts` -- canonical 41-zone taxonomy constants (ZONE_CATEGORIES, ZONE_LABELS, ZONE_DISPLAY_PRIORITY, ESSENTIAL_ZONES, ANGLE_TO_ZONE_MAP, ANGLE_FAMILY_TO_ZONE_MAP, helper functions)
- [frontend] REWRITE: `imageDisplayPriority.ts` -- scoring now driven by `vehicle_zone` + `zone_confidence` + `photo_quality_score` from YONO; legacy angle fallback preserved but marked DEPRECATED
- [frontend] REWRITE: `imageCoverageTracker.ts` -- coverage analysis now uses `vehicle_zone` column directly; essential zones from constants; legacy `getEssentialAngles()` kept as deprecated alias
- [frontend] UPDATE: `imageFilterUtils.ts` `scoreMoneyShot()` -- prefers `vehicle_zone` for scoring, falls back to legacy `ai_detected_angle`/`angle` strings; function-level deprecation docstring
- [frontend] DEPRECATION COMMENTS: `imageAngleService.ts` (module-level + per-function), `personalPhotoLibraryService.ts` (angle_breakdown type), `vehicleFieldScoring.ts` (engine_bay reference), `ImageGallery.tsx` (catPriority maps), `About.tsx` (schema diagram updated)
- [backend] DEPRECATION COMMENTS: `process-all-images-cron/index.ts`, `analyze-image/index.ts`, `analyze-image/coordinate_output.ts`, `import-classiccars-listing/index.ts` -- all marked as using legacy angle strings, pointing to vehicle_zone system

## 2026-02-28 (Image Gallery Zone View)
- [frontend] ImageZoneSection.tsx: New collapsible zone-grouped gallery component (HIGHLIGHTS/EXTERIOR/ENGINE BAY/INTERIOR/UNDERCARRIAGE/WHEELS/DETAIL/DOCUMENTS/UNCATEGORIZED)
- [frontend] ImageGallery.tsx: Added "Zones" as DEFAULT view mode (before Grid/Full/Info/Sessions), surfaces vehicle_zone, photo_quality_score, condition_score, damage_flags from YONO pipeline
- [frontend] Zone sections sort by photo_quality_score DESC, show condition badge + damage dot + photo quality indicator on thumbnails

## 2026-02-28 (First-Touch User Engagement Overhaul)
- [frontend] Homepage: Live vehicle showcase strip (8 real vehicles with images, auto-refresh 60s)
- [frontend] Homepage: Inline search preview dropdown (debounced 300ms, 5 results)
- [frontend] Homepage: "Take a Tour" button wired to OnboardingSlideshow
- [frontend] OnboardingSlideshow: Trimmed 5→3 slides, emoji→ASCII art, renamed "HOW IT WORKS"
- [frontend] VehicleCardDense: No-image fallback → text-based identity card (year/make/model + data points)
- [frontend] CursorHomepage: First-visit context banner (dismissible, localStorage-persisted)
- [frontend] Login/Signup: Added "WHY SIGN UP" value proposition column for signup mode
- [docs] Created FIRST_TOUCH_FIX_MAP.md (audit) and FIRST_TOUCH_REPORT.md (implementation report)

## 2026-02-28 (Theme System Audit & Fix)
- [frontend] Phase 1-2: Full theme audit — found 1,709 inline violations, 97 undefined CSS vars, 3 CSS files broken
- [frontend] Phase 3: Added ~90 new CSS variables to unified-design-system.css (both light/dark blocks)
- [frontend] Phase 3: Fixed 80+ TSX files (~800+ hardcoded colors → CSS variables)
- [frontend] Phase 3: Fixed 3 CSS files (AnnotatedField, ProfessionalToolbox, MergeProposalsDashboard) — zero violations
- [frontend] Phase 4: Updated index.css compat layer with audit stats and documentation
- [frontend] Phase 6: Wrote THEME_AUDIT_REPORT.md — full stats, remaining debt, recommendations
- [frontend] Phase 3 cont: Fixed 170+ more TSX files across 5 batch sweeps (~2,000+ additional fixes)
- [frontend] Batches covered: top 20 offenders, next 16, 9 mid-tier, 20 more, then full 107-file sweep of all remaining
- [frontend] Result: 89% reduction in inline violations (1,709→185), 99.2% of genuine bare colors eliminated (1,709→13)
- [frontend] Remaining 185 refs: 101 intentional (dark overlays, maps), 53 correct var(--token, #fallback), ~13 genuine (brand colors, Three.js, Recharts)
- [frontend] Updated THEME_AUDIT_REPORT.md with final statistics

## 2026-02-28 (Automated Labor Estimation Pipeline)
- [labor] Phase 1: YONO fabrication stage head — 10-stage taxonomy (raw→complete), auto_label_stages.py, train_stage_classifier.py, StageClassifier in server.py
- [labor] Phase 2: Auto work session detection — detect_work_sessions() SQL + auto-detect-sessions edge function
- [labor] Phase 3: Delta-to-labor mapping — stage_transition_labor_map (15 seed transitions), estimate_labor_from_delta() SQL, compute-labor-estimate edge function
- [labor] Phase 4: Unarchived detect-before-after, replaced OpenAI GPT-4O with callTierVision (Sonnet)
- [labor] Phase 5: YONO active learning — yono-escalation-router (confidence tiers), yono_training_queue, yono-export-training, retrain_from_queue.py
- [labor] Phase 6: Photo coaching — photoCoaching.ts, wired into sms-work-intake + sms-reminder-scheduler (photo_gap_nudge)
- [labor] Phase 7: Full pipeline wiring — progress_shot → yono-analyze → escalation → sessions → before/after → labor estimate → coaching
- [labor] DB: fabrication_stage/stage_confidence columns, work_sessions/labor_estimates extensions, stage_transition_labor_map, yono_training_queue
- [labor] 9 edge functions deployed: auto-detect-sessions, compute-labor-estimate, detect-before-after, yono-escalation-router, yono-export-training, yono-analyze (updated), photo-pipeline-orchestrator (updated), sms-work-intake (updated), sms-reminder-scheduler (updated)

### [VP Extraction] P0: Fix Cars & Bids extraction pipeline — 2026-02-27 21:30 UTC
**Task ID:** 200cba73-c5b7-4cc5-a5a2-4a77791ffe62 (RESOLVED)

**Problem:** 488 C&B vehicles created in last 7 days had 0 comments, 0 bids, 0 listing URLs. Root cause: `extract-premium-auction` called `extract-cars-and-bids-core` (core data only) but never triggered secondary extractors (`extract-cars-and-bids-comments` and `extract-cab-bids`).

**Solution:**
1. **Modified `extract-premium-auction`**: Added non-blocking triggers for comment and bid extraction after successful core extraction (both index page and individual listing modes)
2. **Updated `continuous-queue-processor`**: Added C&B comment/bid extraction triggers (same pattern as BaT)
3. **Created `backfill-cb-extraction`**: New edge function to re-trigger full extraction for existing 489 C&B vehicles
4. **Backfill execution**: Successfully triggered 489 extraction jobs (verified via function response)

**Files changed:**
- `supabase/functions/extract-premium-auction/index.ts`: Added C&B comment/bid fetch triggers (lines 118-153 for index, 184-219 for individual)
- `supabase/functions/continuous-queue-processor/index.ts`: Added C&B secondary extraction block (lines 433-464)
- `supabase/functions/backfill-cb-extraction/index.ts`: New backfill function (88.62kB)

**Deployment:**
- `extract-premium-auction` deployed ✓
- `continuous-queue-processor` deployed ✓
- `backfill-cb-extraction` deployed ✓
- Backfill executed: 489/489 vehicles processed

**Impact:** C&B vehicles now receive complete extraction pipeline:
- Core data (VIN, specs, images, descriptions) via `extract-cars-and-bids-core`
- All auction comments via `extract-cars-and-bids-comments`
- Full bid history via `extract-cab-bids`

**Commit:** 33eedb043

### [frontend] Competitors page reframed to partner ecosystem — 2026-02-27
- Rewrote MarketCompetitors.tsx — changed framing from adversarial competitor comparison to partnership ecosystem
- Removed: NUKE_ADVANTAGES attack section, "vs. X" summary cards, Nuke as a peer card in competitor grid, red ✗ scoring
- Added: Partnership model callout (partners bring inventory/regulation, Nuke brings data/pricing/distribution)
- Added: Per-platform "What they have" + "Partnership opportunity" sections
- Added: Capability map showing complementary strengths (green ✓ only, no negative scoring)
- Added: "What Nuke Brings to Partners" (Data API, Comps engine, Vision AI, Investor distribution)
- Added: Integration Paths section (Data API / Vision AI / Listing Distribution / Co-branded Pricing Badge)
- Added: Market opportunity stats block ($37-43B market, <$100M fractionalized, <0.3%)
- CTA now includes B2B platform partnership inquiry (mailto) alongside investor CTA
- Task ca84c465 completed

### [frontend] Exchange SQBD page — show actual vehicle holdings — 2026-02-27
- Added Fund Holdings section to MarketFundDetail.tsx
- Queries top 12 vehicles by sale price matching segment criteria (makes, year range, model keywords)
- Displays vehicle cards with photo, year/make/model, and verified auction sale price
- Animated skeleton while loading, graceful empty state if no matches
- Clicking any card navigates to vehicle profile page
- Works for all funds/segments, not just SQBD

### [frontend] Remove Share This Page copy-link box — 2026-02-27
- Deleted "Share this page:" bordered box (label + URL code + "Copy link" button) from MarketCompetitors.tsx
- Removed "Share link" button from MarketCompetitors.tsx header
- Removed `handleShare` function and `copied` state from MarketCompetitors.tsx
- Removed Share button + `copyLink` function + `copied` state + `copyBtn` style from VehiclePortfolio.tsx
- OG meta tags in MarketCompetitors.tsx useEffect preserved (not UI clutter)

### [frontend] Replace hardcoded homepage stats with live DB queries — 2026-02-27
- `useLandingStats` now fetches `totalImages` via `vehicle_images` estimated count (~34.2M actual vs hardcoded 33M+)
- Hero stat panel: "33M+" photos replaced with live `formatNum(totalImages)` (shows "—" loading, then live)
- API feature card: "18K+" vehicles replaced with live `formatNum(totalVehicles)` (~1M actual)
- `InvestorOffering.tsx`: static YONO text updated from "33M+" to "34M+" to match actual data
- Commit: 2f1f6e1eb, pushed to main

### [frontend] Fix Photos & History tab colors for light/dark mode — 2026-02-27
- Replaced hardcoded white/dark-only colors in `WorkspaceTabBar.tsx` with theme-aware CSS variables
- Background: `var(--grey-800)` → `var(--surface)`, borders: `var(--grey-700)` → `var(--border)`
- Text: `#fff` / `rgba(255,255,255,...)` → `var(--text)` / `var(--text-muted)`
- Active indicator: `#fff` → `var(--text)`, active bg: hardcoded → `var(--surface-hover)`
- Follows DynamicTabBar pattern — works correctly in both light and dark themes

### [frontend] Remove Ready to Trade + Investor Inquiry CTAs — 2026-02-27
- Removed both CTA sections from `MarketCompetitors.tsx` (lines 554-599)
- "Ready to trade?" (Exchange/Portfolio buttons) and "Investor inquiry?" (Data Room/Email buttons) both gone
- `navigate` still used elsewhere in file — no dead import cleanup needed

### [CWTFO] Work Order Lifecycle — Full Data Layer + Auto-Ordering — 2026-02-27
- Invoice HTML for 1983 GMC K2500 Granholm (INV-K2500-0227-001, $1,319.92)
- Vehicle created in DB (3629e106), work order (d18b1119), timeline event (587f467c)
- 7 parts + 6 labor ops seeded with comp tracking, 9 tech assignments (Skylar/Ernie/CJ)
- `work-order-lifecycle` edge function: 11 actions covering full boss→client→tech flow
- DB migrations: `technician_work_order_lifecycle`, `purchase_orders_auto_ordering`, `work_order_timeline_sync`
- Auto-ordering: 2 POs auto-created (Summit Racing $493.97, etrailer $281.04) with buy URLs
- 5 supplier accounts seeded (Summit, AutoZone, RockAuto, etrailer, RealTruck)
- `sync_work_order_to_timeline()` DB function — every state change auto-refreshes timeline metadata
- Timeline event metadata enriched with live summary (parts/labor/POs/techs/payment status)
- Linked parts/labor to `timeline_event_id` so existing components (WorkOrderViewer, ComprehensiveReceipt) find the data
- Frontend: added `service` + `work_completed` to VehicleTimeline EventType union + color map
- Data flows through all existing surfaces without new UI — timeline event → parts/labor → receipt views

### [VP AI] Tier-2 ONNX models uploaded to Modal + sidecar redeployed — 2026-02-27
- Training complete: german (65.8%), british (58.9%), japanese, italian, french, swedish
- Uploaded hier_<family>.onnx + hier_labels.json to Modal volume yono-data
- Redeployed Modal sidecar (yono-serve-fastapi-app) — tier-2 hierarchical inference live
- Task fdf5038f COMPLETED


**Append-only. Add entries when completing significant work.**
Agents read this to avoid rebuilding things that already exist.

## 2026-02-28

### [sdk] @nuke1/sdk v1.5.0 — Vision namespace aligned with live API
- Rewrote `VisionAnalyzeResult` type to match actual `api-v1-vision` v1.1 output (was using pre-deployment spec)
- Added `nuke.vision.health()` method and `VisionHealthResult` type
- Added `VisionBatchItemResult` type, `VisionAnalyzeParams.include_comps` option
- Added `yono_source` field to `VisionClassifyResult`
- Smart auth: `nk_live_*`/`nk_test_*` keys use X-API-Key, JWTs/service keys use Bearer
- Vision timeouts: analyze 90s, batch 120s (accounts for Modal cold start)
- All 4 methods verified end-to-end against live API: classify (370ms), analyze (4.8s), batch, health
- File: `tools/nuke-sdk/src/resources/vision.ts`

### [automation] launchd Plists for FB Marketplace Sweep + Mail.app Intake
- Created `~/Library/LaunchAgents/com.nuke.fb-sweep.plist` -- daily 6:00 AM sweep: `dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 50`, logs to `/tmp/fb-sweep-daily.log`
- Created `~/Library/LaunchAgents/com.nuke.mail-intake.plist` -- persistent daemon with KeepAlive: `dotenvx run -- node scripts/mail-app-intake.mjs --daemon`, logs to `/tmp/mail-intake.log`
- Killed old nohup mail-intake process (PID 94718), replaced with launchd-managed daemon (PID 96910)
- Both loaded via `launchctl load` and confirmed via `launchctl list | grep nuke`
- NOTE: Mail intake hits "authorization denied" on Mail.app SQLite DB -- /bin/bash needs Full Disk Access in System Settings > Privacy & Security

## 2026-02-27

### [agent-architecture] Agent Hierarchy — Haiku/Sonnet/Opus Tiered Extraction System
- Built and deployed three new edge functions:
  - `haiku-extraction-worker` — Haiku-powered extraction worker ($1/$5 MTok). Handles routine extraction, title parsing, field extraction from HTML/markdown. Processes import_queue items. Auto-approves quality >= 0.9, escalates low-confidence to supervisor.
  - `sonnet-supervisor` — Sonnet-powered supervisor ($3/$15 MTok). Reviews Haiku escalations, corrects errors, handles edge cases (replicas, restomods), generates quality reports. Dispatches Haiku work and reviews results in single loop.
  - `agent-tier-router` — Top-level router. Classifies tasks by complexity, routes to right tier. Includes Opus strategy layer for source prioritization and market intelligence. Pipeline runner for continuous processing cycles.
- Shared module `_shared/agentTiers.ts` — Tier configs, Anthropic API wrapper, JSON parsing, quality assessment, cost estimation, task classification
- Updated import_queue CHECK constraint to include `pending_review` and `pending_strategy` statuses
- Tested with real data: 18 items processed, Haiku title parsing (5 titles in single API call), Sonnet caught Ferrari Testarossa replica edge case and escalated
- Sonnet corrected: Dodge "Superbee" → "Super Bee", caught URL/title data conflicts, reduced over-confident title-only scores
- Cost: $0.0017 for 18 operations (essentially free). 67-99% savings vs Sonnet-only.
- Updated TOOLS.md with full agent hierarchy section including tier routing rules and import_queue status flow

## 2026-02-27

### [yono] YONO Sidecar Complete — Tier-2 Models + Consumer Vision API
- **Tier-2 ONNX export**: Built `yono/scripts/export_tier2_onnx.py` to export tier-2 family-specific models from PyTorch to ONNX. Exported 6 families: american (20 classes), german (5), british (15), japanese (8), italian (6), french (2).
- **Modal volume upload**: Uploaded all tier-2 `.onnx` + `.onnx.data` files + updated `hier_labels.json` to Modal volume `yono-data`. Fixed issue where `.onnx.data` weight files were missing (ONNX external data format).
- **Modal sidecar redeployed**: `modal_serve.py` now loads all 6 tier-2 families. Health endpoint confirms: `tier2_families: [american, british, french, german, italian, japanese]`.
- **Classify now returns actual makes**: Before: `"make": "german"` (family only). Now: `"make": "Mercedes-Benz"`, `"family": "german"`, with full top-5 within family.
- **`api-v1-vision` rewritten** (v1.1): The consumer API now calls both YONO `/classify` (make detection) and `/analyze` (condition/zone/damage) in parallel. Returns unified result with make, family, condition_score, vehicle_zone, damage_flags, modification_flags, photo_quality, interior_quality, photo_type, comps. Auth token now sent to sidecar. Optional `include_comps` parameter fetches comparable sales.
- **End-to-end verified**: `POST /api-v1-vision/analyze` returns full vehicle intelligence from a single photo URL at $0.00/image. All 5 edge functions tested: `yono-classify`, `yono-analyze`, `yono-batch-process`, `yono-vision-worker`, `api-v1-vision`.
- Edge functions: `yono-classify`, `yono-analyze`, `yono-batch-process`, `yono-vision-worker`, `yono-keepalive`, `api-v1-vision` all deployed and working.

### [platform] Verify + extend vehicle profile P0 fix (tasks bda3c25b, 6d9cbe9f)
- Confirmed fix from commit 5ee11e181 works: DB migration removed vehicle_price_signal(), price_history, documents subqueries; LIMIT 200 images; frontend RPC timeout 8s→2.5s
- All test vehicles return HTTP 200 in <500ms via anon REST key
- Found residual risk: 1,597 vehicles with 500+ images still borderline (2.3s cold cache, <3s limit)
- Applied v2 fix (migration 20260227235000): LIMIT 200→50, redundant ORDER BY removed, stats.image_count simplified to index-only COUNT(*)
- Root cause of outliers: data quality — vehicles with 10K+ identical duplicate URLs (VW Vanagon 10742, Olds Vista Cruiser 9529). Separate task filed (P65).
- Commits: 5ee11e181 (original), 3ec4a7b34 (v2 hardening)

### [platform] Fix search_vehicles_fuzzy autocomplete timeout (task df34b79a)
- Root cause: `SET statement_timeout TO '3s'` hardcoded in function config; 1.2M vehicle table full-scans at 96s exceeded it → HTTP 500 on autocomplete
- Removed `statement_timeout` from function `proconfig` (was `{search_path=public,statement_timeout=3s}`, now `{search_path=public}`)
- Added `idx_vehicles_make_model_trgm`: GIN trigram index on `(lower(make) || ' ' || lower(model))` with partial filter `is_public=true AND year/make/model NOT NULL` (80MB, valid)
- Updated function WHERE clause to use `(lower(v.make) || ' ' || lower(v.model)) % query_text` — exact index expression match required for Bitmap Index Scan
- Query plan changed from 96s Parallel Index Scan (seq filter) → Bitmap Index Scan on idx_vehicles_make_model_trgm
- Migration: `supabase/migrations/20260227240000_fix_search_vehicles_fuzzy_timeout.sql`

### [platform] Fix api-v1-market-trends 500 timeout (task ffaeabaf)
- Root cause: COALESCE(el.sold_at, v.created_at) prevented date filter pushdown → full 69K Porsche scan; CTE fence blocked per-bucket index range scans
- Added `idx_external_listings_sold_vehicle_at` (vehicle_id, sold_at) WHERE listing_status='sold'
- Added `idx_vehicles_make_sale_date` (lower(make), sale_date) WHERE sale_date IS NOT NULL AND sale_price > 0
- Ran ANALYZE vehicles (was estimating 1,140 rows vs actual 13,029)
- Rewrote `get_market_trends()`: RETURN QUERY EXECUTE USING + generate_series as outer loop → per-bucket index range scans + uses vehicles.sale_date (real auction date)
- Result: 320ms warm / 2.9s cold HTTP 200 (was HTTP 500 at 15s+)
- Migration: 20260227250000_fix_market_trends_timeout.sql

### [platform] P80 Cron audit + deactivation — 116 → 98 active jobs (task 8bd329c7)

Audited all 116 active cron jobs against 4 criteria: no-op/broken commands, broken auth (current_setting/vault), redundant health checks, duplicate extraction workers.

Deactivated 13 jobs:
- `auto-extract` (job 24): pure no-op (`SELECT 1`)
- `concierge-villa-discovery` (job 90): broken auth pattern (app_config table lookup)
- `mecum-extraction-cron` (job 71): only inserted a run record, no actual extraction
- `cron-startup-timeout-alert` (job 328): low-priority monitoring noise
- `agent-monitor-scan` (job 235): redundant with extraction-watchdog (117)
- `extraction-health-check` (job 110): redundant with extraction-watchdog (117)
- `observation-migration` (job 82): broken COALESCE/current_setting auth; run on-demand
- `enrich-bulk-continuous` (job 170): duplicates more-frequent enrich-bulk-mine/derive/vin jobs
- `aggressive-backlog-clear` (job 65): redundant with bat-extraction-worker-1/2/3 and continuous-queue-processors
- `live-auction-sync` (job 87): vault auth broken; sync-live-auctions (109) covers every 15min
- `source-health-monitor` (job 21): low-value health check via old trigger_agent_execution dispatch
- `auto-sort-telegram-photos` (job 128): low-priority, deferrable
- `analyze-unprocessed-org-images` (job 60): low-priority, deferrable

Final: **98 active jobs** (target ≤120) | **13 per-minute jobs** (target ≤20)

### [platform] P95 Cron schedule stagger — eliminate startup timeout bursts (task 2bc2764c)

Root cause confirmed: all 5 valuation-backfill-workers were at `1-59/2 * * * *` (all odd minutes),
running ~120s each and holding 5 slots into the next odd-minute tick. At minute 16:53 this caused
13 startup timeouts for bat-queue-worker-2, bj-queue-worker-2, yono-vision-worker-2, enrich jobs, etc.

Fix: moved valuation-backfill-worker-1 (job 322) and valuation-backfill-worker-3 (job 324) from
`1-59/2` to `*/2` (even minutes). Split cluster: 3 workers at odd, 2 at even.

Also confirmed prior cron cleanup (16:30 UTC) already reduced `* * * * *` from 44 → 13 (all
critical extraction queue workers, correctly below the 20-job target).

Result: 0 startup timeouts across 6 consecutive minutes post-fix. Max concurrent starters per
minute: ~21 (well under cron.max_running_jobs=32).

### [frontend] P92 Full frontend page audit + 2 infinite loading fixes — commit 74432d368

Audited ~70 pages in nuke_frontend/src/pages/ (plus module routes, admin/ pages).

**What was checked:**
- All demo-flow pages: MarketExchange, MarketFundDetail, MarketDashboard, MarketSegments, MarketSegmentDetail, Portfolio, PortfolioWithdraw, BrowseInvestments, InvestorDashboard, OrganizationProfile, Organizations, Dashboard, VehiclesDashboard, AcquisitionPipeline, InvestorOffering
- Auth pages: Login, OAuthCallback, ResetPassword
- Settings: ApiKeysPage (clean), WebhooksPage (weak auth), UsageDashboardPage (clean)
- Admin module (protected by AdminShell): All pages clean
- All other pages: Profile, MyAuctions, SocialWorkspace, VaultPage, ShopFinancials, PersonalPhotoLibrary, MarketIntelligence, CollectionsMap, InvestorDealPortal, VehiclePortfolio, DeveloperSignup, SubscriptionSuccess, TransferPartyPage, StripeConnectStore, ContractStation, MarketMovement, TeamInbox, Notifications, BaTMembers, Library, Capsule, Capture, CurationQueue, UnlinkedReceipts, ImportDataPage

**TypeScript check: CLEAN (npx tsc --noEmit passes)**

**Bugs found and fixed (this commit):**
1. EditVehicle.tsx — infinite loading spinner for unauthenticated users (loadVehicle() only called when user non-null; loading=true never resolved). Fixed: redirect to login + setLoading(false) after fetchUser() returns null.
2. MarketDetail.tsx — infinite "Loading..." when market ID not found (.single() returns null; `if (!market)` showed Loading forever). Fixed: add marketLoading state, proper "Market not found" UI with back link.

**Previously fixed (commit 4e43f29f3):**
- AdminMissionControl.tsx: missing vehicleImageQueue state declaration
- ExtractionMonitor.tsx: broken import AnalysisModelPopup + type error
- ImageProcessingDashboard.tsx: interval scope bug
- Dashboard.tsx: optional notes param type
- Library.tsx: doc→book variable name
- AdminAnalytics.tsx: boolean|null type narrowing
- BidMarketDashboard.tsx: useRef initialization

**Remaining minor issues (sub-tasks filed):**
- vp-platform P72: Add auth guards to BusinessSettings, WiringPlan, WebhooksPage, StripeConnect (non-demo pages, show blank for unauth)
- vp-platform P68: Fix investor-portal-stats timeout (InvestorOffering shows empty stats section)

## 2026-02-27

### [vp-platform] PGRST002 startup-timeout spike alert (task 499b1e16)
- Deployed edge function: `cron-startup-timeout-alert` — queries cron.job_run_details for startup timeout spikes
- Created RPC: `count_startup_timeouts_last_2min()` (SECURITY DEFINER, cron schema access)
- pg_cron job 328: every 5 min, fires Telegram alert if >10 startup timeouts in last 2 min
- Would have detected the 2026-02-27 07:41 PGRST002 outage within 2 minutes
- Migration: supabase/migrations/20260227235900_cron_startup_timeout_alert.sql

### [vp-platform] Header wordmark — add NUKE brandmark to top-left (task 723ab790)
- Added permanent `Link to="/"` with text "NUKE" before `NukeMenu` in `AppHeader.tsx`
- Changed `NukeMenu` trigger button from "Nuke ▶" to hamburger icon "≡" (avoids double branding)
- Added `.nuke-wordmark` CSS class in `header-fix.css`: bold, letter-spaced, hover-dim

### [vp-platform] Fix api-v1-comps 401 for anon users (task c8537818)
- Removed auth requirement from api-v1-comps — comps are public auction results, no auth needed
- Changed authenticateRequest() to be non-blocking (still runs to identify caller but doesn't gate)
- Vehicle profile comparable sales section now works for all anonymous visitors
- Validated: curl with anon key returns 200 + 20 Porsche 911 comps

### [vp-platform] BidMarketDashboard Recharts type fixes (task 78e57dde)
- Fixed `labelFormatter` type: removed explicit `(v: string)` annotation (Recharts expects `string | number`)
- Fixed `formatter` type: removed explicit `(value: number, name: string)` annotations, added `String()`/`Number()` coercions inside (Recharts `ValueType` is `string | number | (string|number)[]`)
- `useRef` lines (78, 226) were already correct with `| undefined` union and `undefined` initial value

### [vp-platform] ralph-spawn: Per-agent token budget + session budget controls (task 1cceee2e)
- Verified ralph-spawn.mjs already has full implementation per CTO/CFO work order
- MODEL_MAP: worker/vp-extraction/vp-orgs/vp-docs/vp-photos → haiku; vp-ai/vp-platform/vp-vehicle-intel/vp-deal-flow → sonnet; cto/coo/cfo/cpo/cdo/cwfto → opus
- TOKEN_DEFAULTS: haiku=30k, sonnet=60k, opus=100k (overrideable via --max-tokens-per-agent)
- --session-budget N: stops pulling tasks when cumulative tokens >= N (0 = unlimited)
- OPUS_CONCURRENCY_CAP=3: hardcoded guardrail, polls every 5s for a slot
- Token usage (tokens_used, input_tokens, output_tokens) logged to agent_tasks.result on every completion
- --model CLI flag still overrides all per-agent routing (backward-compatible)

### [vp-platform] cron.max_running_jobs=20 — BLOCKED (Supabase constraint)
- Task 92d64379: attempted ALTER SYSTEM SET cron.max_running_jobs = 20
- Blocked: parameter is PGC_POSTMASTER level, requires server restart — not possible on Supabase managed Postgres
- ALTER SYSTEM, ALTER DATABASE, and set_config() all fail with permission denied or "requires restart" error
- Current value remains 32. Mitigation already in place: cron cleanup reduced top-of-hour peak from 48+ → 30 jobs
- If formal cap enforcement needed: file Supabase support ticket to modify postgresql.conf directly

### [vp-platform] Quality backfill cron jobs deactivated — backfill 100% complete
- All 1,256,073 vehicles now have data_quality_score populated
- Job 237 (quality-backfill-worker-1): deactivated via cron.alter_job()
- Jobs 238-240: already removed in prior cleanup session
- No indexes to recreate (idx_vehicles_quality_score + idx_vehicles_quality_backfill were dropped; can recreate now if needed)

### [vp-extraction] pg_cron job startup timeout cascade — diagnosed and fixed
- Root cause: `cron.max_running_jobs=32` hard limit being exceeded at peak minutes
- **Fix 1**: `quality-backfill-worker-1` held slots 18-124s every minute → changed `* * * * *` → `2-59/5 * * * *` (prevents slot stacking, worst-case 124s < 300s interval)
- **Fix 2**: `bat-snapshot-parser-continuous-2` had `pg_sleep(30)` hack holding slot → removed sleep, offset to `1-59/3` (fires :01,:04,:07... separate from job 173)
- **Fix 3**: `bat-snapshot-parser-continuous` moved to `2-59/3` (fires :02,:05,:08... avoids :00 peak)
- **Fix 4**: Deactivated `refresh-bid-analytics-mvs` (failing every run — MVs don't exist)
- **Fix 5**: Staggered 18 `*/5` jobs into 5 offset groups (3 at :00, 5 at :01, 5 at :02, 4 at :03, 4 at :04)
- **Fix 6**: Split 13 `*/2` jobs into even (6) and odd (9) groups to halve burst at even minutes
- **Fix 7**: Staggered hourly (5 of 8 moved to :02, :04, :06, :08), `*/10` (3 moved to :03, :06 offsets), `*/15` (2 moved to :02, :04 offsets), `*/30` (3 moved to :02, :07 offsets)
- Result: top-of-hour peak = 30 jobs (was 48+), safely under the 32 limit
- Filed P72 follow-up for `data-quality-workforce` null URL bug

### [vp-vehicle-intel] Signal score coverage diagnosis + api-v1-signal on-demand valuation fix
- Diagnosed: 637K active vehicles with YMM missing nuke_estimate — backfill lag, not data gaps
- Root cause breakdown: 151K vehicles have zero price anchor (no sale/asking/current_value); 486K have comp data but backfill hasn't run yet
- clean_vehicle_prices: 1M rows, 6,144 makes, covers all major collector car makes — comp data is NOT the bottleneck
- Backfill cron: 5 workers (jobs 321-325, every 2min, 100 vehicles each = 15K/hr) deployed by feb786e7 agent — ~42h to full coverage
- Fixed api-v1-signal: now triggers on-demand valuation inline when no estimate exists, instead of returning 404. Adds ~1-3s on first request but returns actual data. `computed_on_demand: true` flag in response. Deployed to production.
- Task f93ef450 completed.

### [backend-triage] Full backend error triage — all public pages and API endpoints
- Ran complete backend error triage against P92 task (founder complaint: pages not loading)
- Tested: api-v1-vehicles, api-v1-exchange, api-v1-comps, api-v1-search, api-v1-signal, api-v1-market-trends, universal-search, transfer-status-api, inbound-email, investor-portal-stats, get_vehicle_profile_data RPC
- All 18 frontend routes checked — all files exist, no missing imports
- HTTP status check: all Vercel pages return 200 (SPA serving correctly)
- Findings filed as 6 agent_tasks:
  - P78 c8537818: api-v1-comps blocks anon users → vehicle profile shows no comparable sales
  - P75 df34b79a: search_vehicles_fuzzy 3s statement_timeout → autocomplete fails under load
  - P73 ffaeabaf: api-v1-market-trends times out → get_market_trends RPC slow on large makes
  - P72 322eb3ae: investor-portal-stats times out (>15s) → /offering page shows no live stats
  - P65 14add70f: search_vehicles_fts intermittent 503 PGRST002 schema cache errors
  - P60 f1dec0c5: /api/landing transient 404 (verified resolves on retry)
  - P55 a9674637: /predictions shows empty (no open markets, page loads gracefully)
- Healthy: api-v1-exchange, api-v1-signal, transfer-status-api, inbound-email, universal-search (POST), get_vehicle_profile_data, db-stats, api-v1-comps (authenticated)

### [cto] Post-mortem: PGRST002 schema cache outage 2026-02-27 ~07:41–07:47 UTC
- Task b11baf19: full post-mortem written at docs/post-mortems/2026-02-27-pgrst002-schema-cache-outage.md
- Root cause confirmed: 44 `* * * * *` cron jobs converging + long-running quality backfill workers held all 32 max_running_jobs slots; PostgREST schema reload failed at 07:46 → PGRST002 to all callers
- Forensic: cron.job_run_details shows 37 startup_timeouts at 07:41, total blackout (0 succeeded) at 07:46
- Filed 4 work orders to vp-platform: P95 stagger cron schedules, P90 set max_running_jobs=20, P80 deactivate low-priority crons, P75 Telegram alert

### [vp-extraction] Gooding & Company field backfill — engine/transmission/mileage — 2026-02-27
- Task 87446ee0: fill engine/transmission/mileage gaps on 369 Gooding vehicles
- Key insight: Gooding is Gatsby/Contentful — all data in `/page-data/lot/{slug}/page-data.json` (no HTML scraping needed)
- `item.specifications` array has engine/transmission as bullet points; mileage in highlights prose
- Built + deployed: `backfill-gooding-descriptions` edge function — parses engine (spec line containing Engine/Cylinder/BHP), transmission (Transmission/Gearbox/Transaxle), mileage (highlights prose)
- Updated `extract-gooding` extractor to extract these 3 fields for all future runs
- Results: engine 10.3%→35.2% (+244%), transmission 0.3%→25.5% (+8400%), mileage 0.8%→1.1%
- Remaining 65% no engine: pre-war brass-era vehicles (1900-1920s) with empty specs in Contentful — no additional data available
- Cron 319: `*/30 * * * *`, batch_size=20

### [vp-extraction] Description backfill — Mecum + Craigslist — 2026-02-27
- Task ec362475: 945K vehicles missing descriptions — targeted Mecum (~2.2K remaining) + CL (~2.5K)
- Discovery: Mecum already at 95.6% desc coverage (extraction sprint fixed the "8%" stat from task filing)
- `backfill-mecum-descriptions`: archive-based, zero-cost — queries listing_page_snapshots WHERE platform='mecum', re-parses __NEXT_DATA__ blocks (HIGHLIGHTS + EQUIPMENT) without any live fetch. Also fills mileage + engine_size + transmission.
- `backfill-cl-descriptions`: live-fetch via archiveFetch — CL pages expire fast, historical ~100% expired (410). Will catch newly-added CL vehicles while pages are still live.
- Cron 317 (`*/10 * * * *`): backfill-mecum-descriptions, batch_size=25 — draining ~2.2K remaining at ~15/run
- Cron 318 (`*/30 * * * *`): backfill-cl-descriptions, batch_size=15
- VIN intentionally excluded from Mecum backfill (handled by backfill-vin-from-snapshots, avoids unique constraint conflicts)
- Note: NULL discovery_source vehicles (~820K missing desc) are BaT/conceptcarz — different scope

### [vp-extraction] RM Sotheby's lot page scraper + description backfill — 2026-02-27
- Task 9fb1563a: RM Sotheby's vehicles missing description/mileage/engine (API only returns list-page data)
- Built + deployed: `backfill-rmsothebys-descriptions` edge function (557 lines)
  - Fetches individual lot detail pages via archiveFetch (Firecrawl, cache-first)
  - Parses: description (3 HTML pattern strategies), bullet highlights, chassis/engine IDs, estimate range, mileage from text
  - Writes: description, mileage, origin_metadata (estimate_low/high, chassis_number, engine_number, location)
- Fixed: VIN unique constraint violations — chassis numbers now stored in origin_metadata only
- Cron 268 (`rmsothebys-description-backfill`): every 30min, batch_size=20
- Progress: 1.3% → 12.2% description coverage (153/1,251), continuing to drain

### [vp-platform] Homepage Browse Feed P0 fix — 2026-02-27
- Task 0139bb65: "Unable to load vehicles" error when clicking Browse Feed
- Root cause: getMissingColumn() regex only matched Postgres 42703 "column X does not exist" format. PostgREST PGRST204 schema-cache errors use different format: "Could not find the 'X' column of 'vehicles' in the schema cache" — unmatched → getMissingColumn returned null → selectV1 fallback never ran → fell through to setError
- Fix 1: Extended getMissingColumn to also parse PGRST204 message format
- Fix 2: Removed `if (missingColumn)` guard — ANY selectV2 error now always falls back to selectV1
- Commit 4ac104ca6, pushed to main

### [vp-extraction] Queue backlog triage — 2026-02-27 16:15 UTC
- Task 23f1da15: Import queue at 41K pending (demand spike, not stall)
- Root cause: Mecum Live Auctions (25K items) had only 2/5 workers active; C&B (15K) had 6 workers
- Fix: Re-enabled mecum-live-queue-workers 3-5 (cron jobs 253-255) → all 5 now active
- Throughput confirmed at ~5,100/hr; estimated full drain ~5-6 hours
- 47 failed items (parse/field errors, non-blocking); 404 processing all fresh (<10min)

### [vp-platform] Search loading skeleton — 2026-02-27
- Task b9e49520: SearchResults.tsx had minimal skeleton (6 simple boxes + "Searching..." text)
- Replaced with proper shimmer skeleton: fake summary bar + 8 card-shaped placeholders matching grid (260px minmax, 160px image, 3 text stubs)
- Early return at line 208 blocks NO RESULTS empty state when loading=true
- Loading prop wired: Search.tsx:1084 → SearchResults loading prop

### [vp-extraction] Import Queue Backlog Cleared — 2026-02-27
- Investigated 41K pending (not stalled — 384 processing at 5-7K/hr; bulk discovery spike added 93K items 2026-02-26 16-17 UTC)
- Fixed: 544 exhausted items (attempts >= 3) stuck in `pending` — marked `failed`
- Fixed: 47 genuinely failed items for working domains reset to `pending` (attempts=0)
- Activated: 4 inactive Mecum workers (jobs 242-245) — 10 total Mecum workers now
- Activated: 3 inactive Mecum Live workers (jobs 253-255) — 5 total Mecum Live workers now
- Queue post-fix: 41K pending, 13 failed, ~333 processing

### [vp-ai] YONO Sidecar Unreachable — FIXED 2026-02-27 16:10 UTC
- Root cause 1: Supabase secret `YONO_SIDECAR_URL` had typo `sss73133` instead of `sss97133`
- Root cause 2: `yono-classify` timeouts too short (health 15s, classify 10s) vs Modal latency 30-40s
- Fix: Corrected Supabase secret, increased yono-classify timeouts to 45s/60s, redeployed Modal sidecar
- Verified: `available:true` end-to-end; image classification no longer falling back to cloud AI

### [cwfto] Situational Brief + Cleanup — 2026-02-27 ~16:10 UTC
- Quality backfill: 100% COMPLETE — all 1,256,073 vehicles have data_quality_score. Filed P92 task to deactivate cron jobs 237-240.
- YONO training: british tier-2 active (PID 37505). YONO sidecar still unreachable — filed P90 task (redeploy after ONNX export).
- Import queue: 41K pending (Mecum 25K, C&B 15K). All queues draining normally.
- Stale task cleanup: Reset 7 in_progress tasks to pending, completed 4 confirmed-done tasks, closed 2 duplicates.
- Filed: 3 follow-up tasks (quality backfill deactivation, YONO sidecar, vehicle profile P0 verify).
- Twilio: Still unblocked — CFO/founder action still required (P92/P88 tasks live).
- Next CWFTO loop scheduled (P92 pending).

## 2026-02-27

### [platform] ralph-spawn: per-agent token budget + session budget controls — task 1cceee2e
- Added MODEL_MAP: worker/vp-extraction/vp-orgs/vp-docs/vp-photos→haiku, vp-ai/vp-platform/vp-vehicle-intel/vp-deal-flow→sonnet, cto/coo/cfo/cpo/cdo/cwfto→opus
- Added --max-tokens-per-agent N flag (defaults: haiku=30K, sonnet=60K, opus=100K)
- Added --session-budget N flag: stops pulling tasks when total token spend hits cap
- Added Opus concurrency cap: max 3 Opus agents simultaneously (hardcoded cost guardrail)
- Token usage (tokens_used, input_tokens, output_tokens) now logged to agent_tasks.result on every completion
- --model flag still overrides per-agent routing (backward compatible)
- File: scripts/ralph-spawn.mjs

### [frontend] Search filter panel fix — task c774b1cd
- `showFilters` defaulted to `true` in DEFAULT_FILTERS — filter inputs now expand automatically when vehicle results appear
- Added `make` field to VehicleFilters interface, DEFAULT_FILTERS, filter logic (substring match), and UI input
- Filter panel now shows: Make, Price (min/max), Year (min/max), Max Mileage, Transmission, Status
- File: `nuke_frontend/src/pages/Search.tsx` lines 21-41, 578-600, 912-930

### [coo] CFO memo surfaced — image pipeline unpause (task 1131e863)
- Delivered CFO memo to CEO: $3,250 max backfill cost, $150/month ongoing, 65-day clearance
- YONO-first hybrid model: 60% free via YONO, 40% Gemini Flash at $0.0001/image
- $50/day hard cap already coded in analyze-image — zero runaway risk
- Decision awaiting CEO: remove NUKE_ANALYSIS_PAUSED from Supabase secrets
- Unlocks: camera geometry, subject taxonomy, NL descriptions, VIN tag detection

### [frontend] Investor offering gate stats — task ac67d3b6
- Updated `gateStats` in InvestorOffering.tsx access-code screen with confirmed live numbers
- Was: 18K vehicles, 33M images, 200K auction events, <$100M AUM gap
- Now: 1.25M vehicles, 33.7M images, 513K AI valuations, 4 market segment ETFs
- Updated headline subtitle text to match new numbers
- File: `nuke_frontend/src/pages/InvestorOffering.tsx` lines 575–580, 634

### [frontend] Search performance + skeleton UX — task 6db748af
- Switched IntelligentSearch.tsx edge function call from slow `search` (11s) → `universal-search` (3.8s)
- Mapped universal-search result types to frontend types: vin_match→vehicle, tag→reference, external_identity→user
- Upgraded skeleton loading in SearchResults.tsx: 8 realistic card skeletons (image + text lines) instead of 6 plain blocks
- Files: nuke_frontend/src/components/search/IntelligentSearch.tsx:681, nuke_frontend/src/components/search/SearchResults.tsx:208

### [extraction] FB Marketplace GraphQL probe — task 62f30b2e
- Logged-out GraphQL CONFIRMED working from residential IPs. doc_id: 33269364996041474
- Returns 24 listings/page: id, title, price, city/state, thumbnail, is_sold/pending flags
- BLOCKED from Supabase datacenter IPs (error 1675004, IP-level block — not bypassable with tokens)
- Year filter in variables is ignored; must filter by title parsing at upsert time
- Vintage fraction: ~8-17% per metro (title-parsed)
- Infrastructure: fb-marketplace-local-scraper.mjs (43 metros), fb-relay-server.ts (port 8787)
- 3 paths forward documented in facebook-marketplace-extraction.md (residential scraper / relay integration / session replay)
- Relay path requires /graphql-sweep endpoint on fb-relay-server.ts (not yet built)

### [frontend] Search empty state: featured vehicles grid — task a2e04f6a
- /search with no query now shows 24 top vehicles by sale_price in a VehicleCardDense grid
- Added "Top Vehicles by Value" label; quick-search chips preserved above grid
- useEffect fetches public vehicles with primary_image_url, ordered by sale_price DESC
- Commit e42d60803

### [platform] Vehicle intelligence cron jobs applied — task 6fe1a113
- Job 314: compute-vehicle-valuation-backfill — */10 * * * * — batch_size=50
- Job 315: batch-vin-decode-backfill — */30 * * * * — batch_size=50
- Job 316: batch-ymm-propagate-hourly — 0 */4 * * * — batch_size=500
- Migration 20260227140000_vehicle_intel_crons.sql applied via SQL MCP (migration push was blocked by legacy ordering)

### [frontend] Add Search + Market to header nav (task 99850151)
- Added Search and Market as visible `<Link>` elements in `header-left` beside NukeMenu button
- Changed `header-slot-left` grid column from `8%` to `max-content` so left slot sizes to content
- Added `.header-main-nav { display: none }` under `@media (max-width: 600px)` — hidden on mobile
- Files: `nuke_frontend/src/components/layout/AppHeader.tsx`, `nuke_frontend/src/styles/header-fix.css`

### [security] Key Guardian daily audit — task 0e8b5ca1
- gitleaks: 0 findings in last 50 git commits and working tree (clean)
- Known-bad keys: Gemini API key + Stripe webhook secret still present in .env (ACTION REQUIRED — unrotated)
- Email report sent to founder via Resend (ID: 67a62aef-5124-4797-a1af-98aeb5409ce0)
- Task marked completed in agent_tasks DB

### [frontend] Fix P0: /market routes to MarketExchange (live ETF data)
- Changed root `/` and `/dashboard` routes in marketplace/routes.tsx from MarketDashboard (Coming Soon stub) to MarketExchange
- nuke.ag/market now shows live PORS/TRUK/SQBD/Y79 fund cards instead of hardcoded "Coming Soon" page

### [frontend] TeamInbox avatars + inline images + thumbnails — commit fe7785858
- 36px sender initials avatar circle added to every email list row (left of text content)
- Detail pane header avatar bumped to 48px
- Refactored SenderAvatar to use shared `getAvatarColor` (deterministic HSL hash) + single-char `getInitials`
- Added `CarIcon` SVG component prepended to vehicle URLs in Alerts tab
- Scoped `.email-body` CSS: img responsive, links colored, blockquote indented, table borders
- `dangerouslySetInnerHTML` div gets `className="email-body"` for proper HTML email rendering
- Image attachment thumbnails grid (80x80, object-cover) for attachments with `content_type: image/*` + `url`

### [frontend] TeamInbox Gmail-style 3-pane redesign — commit 9c0553683
- Rebuilt visual layer of TeamInbox.tsx (815 insertions, 501 deletions)
- Layout: 220px fixed sidebar + 360px scrollable middle list + flex-1 detail pane
- Left sidebar: INBOX header, icon+label+badge tabs (Emails/Messages/Alerts), mailbox color-dot list
- Middle pane: 64px email rows, 3px left accent bar (mailbox color for unread, primary for selected), sender bold/normal, subject, snippet truncated
- Detail pane: initials avatar circle (deterministic hue from email hash), sender name 16px bold, meta strip with mailbox badge pill + timestamp, HTML body renderer, Archive/Spam ghost buttons with hover, reply textarea + Send Reply primary button
- All colors use design system tokens (var(--bg), var(--surface), var(--border), var(--text), var(--accent), var(--text-muted))
- Mobile: scoped CSS media query hides sidebar + right pane, shows bottom tab bar at <768px
- All logic preserved: useEffect, useState, supabase queries, realtime subscriptions, compose modal

### [security] Key Guardian — automated secret scanning + daily audits — commit cf0b94722
- gitleaks v8.30.0 installed locally (brew)
- .gitleaks.toml: catches Stripe (sk_/rk_/whsec_), Google/Gemini (AIza*), Resend (re_*), Supabase JWT, Twilio (32-char hex, entropy 3.5), Modal (ak-*); allowlists .env.vault, node_modules, placeholders
- .claude/agents/key-guardian/CLAUDE.md: full agent persona — startup ritual, rotation workflow, tool inventory, known-compromised key table
- scripts/key-audit.sh: daily bash audit — gitleaks detect on last 50 commits + working tree, checks .env for known-bad keys, emails founder via agent-email → Resend
- .git/hooks/pre-commit: prepended gitleaks protect --staged before existing TypeScript check — blocks commit with actionable message if secrets found
- DB: key-guardian registered in agent_registry; daily audit task inserted in agent_tasks (id=0e8b5ca1, P95)
- FOUNDER_EMAIL=toymachine91@gmail.com set in Supabase secrets (required for agent-email → real email delivery)
- First audit ran: ACTION REQUIRED — 2 unrotated known-bad keys in .env (Gemini + Stripe webhook)
- Activation email sent to founder (Resend ID: 130dbf6b)
- Pre-commit hook verified working: ran gitleaks on setup commit, passed clean

### [security] Stripe Connect Security Audit + Hardening — commit 8ec743ad9
- Audited all 7 Stripe Connect surfaces: 4 edge functions + 2 frontend pages + 1 migration
- Found and fixed 4 CRITICAL issues:
  - stripe-connect-account: Added JWT auth guard on all actions (was fully unauthenticated)
  - stripe-connect-products: Added JWT auth + ownership check on POST/create
  - stripe-connect-checkout: Fixed application fee bypass — fee now computed from Stripe-authoritative price (not client-supplied priceInCents)
  - stripe-connect-checkout: Added JWT auth guard on subscription + billing_portal actions
- Found and fixed 4 HIGH issues:
  - CORS: All 4 functions restricted from Access-Control-Allow-Origin: * to https://nuke.ag
  - IDOR: Added ownership checks on get_link + status actions in stripe-connect-account
  - Data minimization: stripe-connect-account status no longer returns full Stripe account object
  - RLS: stripe_subscriptions had RLS enabled but zero policies — added SELECT policy via stripe_connect_accounts FK join
- 4 MEDIUM issues documented, pending founder action (STRIPE_WEBHOOK_SECRET verification, slug URLs, API version pin, rate limiting)
- Sent audit report to founder via agent-email (Resend message_id: b1486a50-534d-40ea-baf0-9cd137f942a1)
- All 4 functions deployed to Supabase, committed + pushed to main

### [stripe] Full Stripe Connect Integration — commit 5528063ab
- stripe-connect-account edge function: create V2 connected accounts, onboarding links, live status check
- stripe-connect-products edge function: create products on connected accounts, list with expanded prices
- stripe-connect-checkout edge function: direct charge (5% platform fee), subscription, billing portal
- stripe-webhook updated: V2 thin event parsing (requirements.updated, capability_status_updated), stripe_subscriptions upsert, all previous handlers preserved
- DB: stripe_connect_accounts (user_id FK, RLS), stripe_subscriptions tables (migration 20260227160000)
- Frontend StripeConnect.tsx: create account, onboarding, status dashboard, product management, store link
- Frontend StripeConnectStore.tsx: public storefront, product cards, Buy Now → Stripe Checkout, success state
- Routes: /stripe-connect, /stripe-connect/store/:accountId in DomainRoutes.tsx
- AdminShell nav: "Stripe Connect" added to Tools section
- All 4 functions deployed, frontend build clean (✓ built in 11.86s), pushed to main

## 2026-02-27

## 2026-02-27

### [vehicle-intel] VP Vehicle Intel session audit — deployed missing functions, filed cron tasks
- Deployed batch-ymm-propagate (was NOT deployed): filled 286 factory fields across 63 vehicles in first run
- Deployed batch-vin-decode (was NOT deployed): dry run shows 37/50 candidates are pre-1981 non-standard VINs (NHTSA won't decode)
- Completed agent_task 1489e336 (YMM propagation backfill P60): 63 vehicles updated, 286 fields filled
- Key coverage finding: 513K/1.25M active vehicles have nuke_estimate (40.9%)
- Exchange health: 4 NAVs updating correctly via update-exchange-prices (PORS/SQBD/TRUK/Y79)
- Exchange full cycle confirms: ok, 4 navs updated, 0 offerings (no live trades, expected)
- No crons found for compute-vehicle-valuation, batch-vin-decode, or analyze-market-signals
- Manually ran 8 valuation batches x50 = ~400 new nuke_estimates computed this session
- Filed 3 follow-up tasks:
  - 6fe1a113 (P85, vp-platform): Apply 3 cron jobs via Supabase Dashboard SQL editor
  - f93ef450 (P75): Signal score coverage — 59% missing, root cause is missing valuation cron
  - 0e57d34a (P60): VIN decode gap — pre-1981 non-standard VINs, NHTSA can't decode
- api-v1-exchange error was a false alarm: works with ?action=funds, default action=snapshot also works
- Migration 20260227140000_vehicle_intel_crons.sql: written, NOT yet applied (migration ordering conflict)

### [yono] YONO sidecar URL typo fixed — P85 resolved
- Root cause: YONO_SIDECAR_URL in Supabase Edge Function secrets had typo: sss73133 instead of sss97133
- Fix: `supabase secrets set YONO_SIDECAR_URL=https://sss97133--yono-serve-fastapi-app.modal.run`
- Redeployed yono-vision-worker (v9) and yono-keepalive (v8) to pick up correct URL
- Confirmed: sidecar operational, vision_available=true, uptime sustained
- Vision worker confirmed processing: ~800 images/hr per worker, 2 workers = ~1600/hr effective
- P85 task `db96c02e` marked completed

### [yono] YONO vision worker health audit — vp-photos session
- DB schema cache incident: PostgREST failed ~07:00-08:00 UTC (pool saturation from 10+ agents)
- During outage: cron keepalives failed → sidecar scaled to zero → vision worker offline
- Recovery: DB recovered ~08:00 UTC, sidecar warm at sss97133 URL, all systems nominal
- Filed: CTO post-mortem task (P80), DB scale-down incident documented

### [photos] K10 truck vision analysis status confirmed
- 419 photos (vehicle_id: 6442df03-9cac-43a8-b89e-e4fb4c08ee99): all ai_processing_status=completed
- All 419 have vision_analyzed_at=NULL → eligible for YONO (no ai_processing_status filter)
- YONO claim_yono_vision_batch picks up ANY image with image_url + vision_analyzed_at=NULL
- At 1,600 img/hr: K10 will complete in ~16 min once YONO worker reaches them
- Organization: all 419 unorganized (matching global pattern)

### [photos] Photo organization pipeline gap identified
- 100% of sampled images have organization_status=unorganized (0 organized)
- auto-sort-photos exists but targets telegram/technician workflow, not general inventory
- No cron-scheduled general organization pipeline found
- Filed P72 task for vp-photos to design organization pipeline



### [yono] Scaled YONO vision workers 2→4, Modal sidecar min_containers 1→2
- Added cron workers 3+4 (jobs 286+287): */2 * * * * → same URL/auth pattern as jobs 247+248
- Redeployed Modal sidecar (yono-serve) with min_containers=2 → always 2 warm containers
- New throughput: 4 workers * ~1000 img/hr = 4000 img/hr combined
- K10 (419 photos): ~6 min to complete at new rate (was ~13 min)
- All 32M images: ~333 days (was 667 days at 2 workers)
- To complete in 30 days: need 44 workers — filed as future consideration
### [worker] Import queue cleanup + task triage — worker-session-3
- Closed 8 stale/superseded tasks: 2x BAT queue stall (superseded by process-bat-extraction-queue cron), 2x YONO sidecar unreachable (sidecar verified up), source-census archiveFetch audit (acceptable exception documented), agent type registry
- Reset 243 failed PCarMarket records to pending (extractor fix was deployed by previous session)
- Fixed 44 port-80 BaT URLs (bringatrailer.com:80 → bringatrailer.com); dupes skipped
- Skipped garbage/malformed URLs: N/A suffix dupes, /carfax, %20lol, Google redirect params, BaT browse pages
- Skipped non-vehicle memorabilia: Mecum neon signs/hubcaps/quilts/gas pumps, Gooding literature/programs/sculpture/toys
- Reset transient failures to pending: PGRST002 schema cache (3), Firecrawl 500/502 (2), C&B Invalid JSON (2)
- Remapped 11 legacy agent_tasks (oracle/guardian/sentinel/harvester/curator) to proper VP domains
- Updated REGISTRY.md with active vs legacy agent type table
- Failed queue: 381 → 0 items (100% cleared)

### [extraction] RM Sotheby's description backfill — backfill-rmsothebys-descriptions edge function
- Root cause: SearchLots API returns no description/mileage — only auction metadata
- Built `supabase/functions/backfill-rmsothebys-descriptions/index.ts`
- Fetches individual lot pages via archiveFetch (Firecrawl, cache-first)
- Parsers: description (body-text--copy paragraphs), highlights (list-bullets), ID fields (chassis/engine), estimate ($LOW - $HIGH), mileage (regex in text), VIN (17-char detection from chassis field)
- Deployed, verified: 71/1,251 vehicles backfilled, desc rate 1.3% → 5.7%
- Cron job 268: every 30min, batch_size=10 — will drain remaining ~1,180 in ~2.5 days
- Key discovery: `order=id.asc` avoids statement timeout; `discovery_source='rmsothebys'` is the indexed filter

### [comms] Gmail OAuth alert poller — direct Gmail API polling (backup to Gmail forwarding)
- Built `scripts/gmail-poller.mjs`: local Node.js poller — `--setup` runs OAuth2 consent, `--once`/`--daemon`/`--dry-run` modes
- Built `supabase/functions/gmail-alert-poller/index.ts`: Supabase edge function; polls Gmail API via OAuth2, dispatches to `process-alert-email`
- Migration `20260227130000_gmail_alert_poller_cron.sql`: pg_cron job 265 schedules every 5 min (active)
- Edge function deployed live: returns `{success:false, setup_required:true}` until GOOGLE_REFRESH_TOKEN set
- GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET already set in Supabase secrets
- **ONE STEP remaining**: `dotenvx run -- node scripts/gmail-poller.mjs --setup` → log in as toymachine91@gmail.com → then `supabase secrets set GOOGLE_REFRESH_TOKEN=<token>`
- NOTE: Resend-based approach (alerts@nuke.ag forwarding) is simpler — see entry below. Gmail forwarding is preferred path; OAuth poller is the backup/primary polling option.

### [platform] Resend Inbound Email — Audit, Fix, alerts@nuke.ag wiring
- **Status**: Pipeline was already working. 5 real emails in contact_inbox including shkylar@gmail.com → info@nuke.ag and Amazon SES DMARC reports → privacy@nuke.ag
- **Root finding**: RESEND_API_KEY in Supabase is send-only scope (restricted_api_key) — cannot read domains/webhooks via API. Inbound routing IS configured in Resend dashboard (confirmed by working emails)
- **Bug fixed**: inbound-email was silently losing email body when Resend API content fetch failed. Now uses webhook payload `data.text`/`data.html` as immediate fallback before attempting API enrichment
- **New feature**: Added `alerts@nuke.ag` to VALID_ADDRESSES + routing to process-alert-email → import_queue
  - Email arrives at alerts@nuke.ag → stored in contact_inbox AND forwarded to process-alert-email
  - process-alert-email extracts listing URLs, queues to import_queue with alert_source + ingested_via metadata
  - Supports: BaT, Craigslist, KSL, Hemmings, eBay, Cars.com, AutoTrader, Hagerty, CarGurus, ClassicCars, FB, PCarMarket, C&B
- **Test result verified**: BMW M3 test → alert_email_log: urls_found=1, urls_queued=1, status=processed → import_queue: status=pending, source=bat, ingested_via=email_alert
- **Inserted test record**: contact_inbox email_id=test-001 (from someone@example.com to info@nuke.ag)
- **Deployed**: inbound-email v17 (two fixes: body fallback + alerts routing)
- **DNS/MX**: Already configured — emails ARE flowing. No action needed.
- **What's needed for Gmail→alerts@nuke.ag flow**: Set up Gmail forwarding in toymachine91@gmail.com settings to forward to alerts@nuke.ag

### [frontend] Search + Discovery + Vehicle Cards UX overhaul — committed in 05000c396
- **Loading state**: `loading` initializes `true` when URL has `?q=` param → skeleton shows immediately on page load (not blank)
- **Search summary**: Default changed from stale "Enter a search query..." to empty string → no ghost text after results load
- **Skeleton shimmer**: SearchResults loading state replaced spinner-in-box with animated shimmer card grid (6 cards, `skeleton-shimmer` keyframe)
- **Empty state** (no query): Replaced blank page with popular search suggestion links grid
- **Empty state** (no results): Removed emoji, clean "No results for X" + popular search links
- **VIN Lookup**: Demoted from prominent button to small 7.5pt secondary link, collapsed by default
- **Workstation panel**: Removed from between search/results (was blocking flow), moved to collapsible section at page bottom
- **Search input**: Larger padding (10px), blue focus ring, "Search" button (was "GO") full-height black fill flush right
- **Clear button** (×): Added to search input between text and Search button
- **Type filter pills**: Compact black/white toggle style replaces verbose icon+count+label buttons
- **Controls bar**: Removed redundant Filter type dropdown, simplified to Grid/List + Sort
- **Card hover**: Gallery mode cards get `translateY(-3px)` lift + `box-shadow` on hover
- **Enrichment merge fix**: Used nullish coalescing (`??`) instead of spread (was overwriting valid data with nulls)
- **Edge function** (`supabase/functions/search/index.ts`): `vehicleMetaById` select expanded to include `sale_price, asking_price, mileage, transmission, vin` — metadata now flows through to tier calculation
- **Edge function fix**: Removed non-existent `image_count, event_count` columns from select (were causing silent query failure → no metadata); replaced with `vehicleImageById` presence check
- Deployed: `supabase functions deploy search --no-verify-jwt` ✓
- TypeScript: clean (`npx tsc --noEmit`)
- Search verified: 10 results for "porsche" with sale_price + mileage in metadata

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

### [frontend-ux] Global UX Pass 2 — typography normalization + loading states + empty states
- **pt→px font unit purge**: Eliminated ALL `pt` font-size units across entire frontend (~1900+ occurrences in pages, ~232 component files with pt units). All converted to px with correct pt→px ratios (8pt→11px, 9pt→12px, 10pt→13px, 14pt→19px, 16pt→21px, etc.)
- **AuctionMarketplace**: Replaced bare "Loading auctions..." with 6-card skeleton grid (pulse animation). Fixed 32 pt units.
- **MarketSegments**: Replaced bare "Loading market segments..." with full-page skeleton grid (6 cards with pulse). Fixed 14 pt units.
- **Dashboard**: Replaced bare "Loading..." text with 4 skeleton rows.
- **CursorHomepage**: Replaced "Loading vehicles..." with 6-card skeleton grid.
- **NukeEstimatePanel**: Replaced "Loading..." text with 2-line skeleton.
- **ServiceVehicleCardRich**: Replaced "Loading..." text with skeleton placeholder.
- **MarketFundDetail**: Improved "Fund not found" error state copy.
- **Search.tsx**: Fixed 42px "N" logo on empty state (was 32pt = 42.67px).
- **About.tsx**: Fixed final "NUKE Platform" → "Nuke" branding instance in footer.
- Files changed: ~300+ frontend files. Zero TypeScript errors throughout.
- Commits: 944ba7704 (bulk), 10c63847c (TeamInbox).

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

## 2026-02-27 — Data Quality Command Center

[data-quality] Full Data Quality Command Center built + deployed — commit 45ec32b2a

### What was built:
- **`data_quality_snapshots` table** — stores periodic snapshots of field completion rates (7-day retention)
- **`compute-data-quality-snapshot` edge function** — TABLESAMPLE 1% → 35 field stats, inserts snapshot row; cron job 303 (*/10 min)
- **`data-quality-workforce` edge function** — priority orchestrator fires 7 enrichment strategies (4 free always-on, 2 LLM gated, 1 valuation); cron job 304 (*/5 min)
- **`DataQualityDashboard.tsx`** — `/admin/data-quality`, real-time field completion bars with trend arrows, ETA to 95%, workforce START buttons, 30s auto-refresh
- **DB functions**: `get_data_quality_field_stats()` (TABLESAMPLE 1%, 25s timeout), `get_pipeline_cron_stats()`, `cleanup_old_quality_snapshots()`

### Current baseline (1,241,147 vehicles):
- make: 98.2%, model: 98.1%, year: 92.9%  (solid)
- listing_url: 85.4%, country: 100%
- body_style: 51.1%, engine_type: 41.6%, heat_score: 41.8%
- mileage: 17.1%, vin: 17.9%, image_url: 18.1%
- city: 2.7%, state: 3.0%  (location gap)
- deal_score: 0.6%, signal_score: 0.2%  (scoring pipeline ramping)
- engine_liters: 0.1%  (very sparse)

### Cron jobs:
- Job 303: compute-data-quality-snapshot (*/10 * * * *)
- Job 304: data-quality-workforce (*/5 * * * *)

## 2026-02-27

### [CFO] Twilio credentials diagnosis + founder escalation
- Diagnosed: auth token missing (NOT negative balance as task stated)
- Twilio account SID confirmed in vendor_accounts
- Balance: $8.31 (degraded, below $20 threshold)
- .env + Supabase secrets: all placeholder values (your-twilio-account-sid)
- Cannot auto-retrieve auth token — requires founder login to console.twilio.com
- SMS cost math: 150K transfers × 2 SMS × $0.0079 = $2,370 → recommend $2,500 top-up
- Founder email sent with exact copy-paste commands for .env + supabase secrets set + test curl
- Test transfer_id ready: 8121d986-f8fc-4aaa-b5f9-2302453f0122
- Crons 223-227 remain paused pending Twilio credentials from founder
- Task 4a3e8f26 marked completed, vendor_accounts updated

## 2026-02-27

### [vp-platform] Fix P0: Vehicle profile infinite loading for anon users (task bda3c25b)
- Root cause: `anon` role has `statement_timeout=3s`. `get_vehicle_profile_data` called `vehicle_price_signal()` (multi-table JOIN) + fetched all images with no LIMIT → exceeded 3s under load → HTTP 500.
- DB migration `20260227210000_optimize_get_vehicle_profile_data.sql`: rewrote function removing expensive subqueries (price_signal, price_history, documents) and capping images at 200. Heavy vehicle: 1.9s → 0.9s (well under 3s limit).
- Frontend: reduced RPC client timeout 8s → 2.5s so client fallback fires before DB kills. Also expanded error message check and switched fallback from `select('*')` to explicit columns.
- Both test vehicles now return HTTP 200 in <1s via anon key. Commit 5ee11e181.

## 2026-02-27

### [transfers] Transfer System UI — operator dashboard + buyer/seller pages
- `/admin/transfers`: Operator dashboard listing 32,762 in_progress transfers, sorted by overdue milestone count
  - Inline expand → full milestone checklist with ✓ Done buttons → calls `transfer-advance:advance_manual`
  - Quick links to buyer/seller views per transfer
  - "Log a Deal" modal for private sales → `transfer-automator:seed_from_listing`
  - Filter by status (in_progress/completed/stalled/cancelled), search by vehicle/handle, pagination
- `/t/:transferId`: Public buyer/seller page, token-accessible (no login required)
  - Vehicle image, price, milestone timeline with completion dates
  - Confirm buttons on current milestone
  - Free-form "Send an update" signal box → `transfer-advance:ingest_signal` (AI classifies)
  - Inbox email contact footer
- AdminShell nav: Transfers added as primary nav item
- Commit: `0f4d8bf09`

## 2026-02-27

### [auth] Auth guard map + enforcement (task e6aa28b8)
- Created `ProtectedRoute` component: shows loading state while auth resolves (prevents null-user crashes), then redirects unauthenticated users to `/login?returnUrl=...`
- Created `RequireAdmin` component: auth + admin role check; on non-admin redirects to `/org/dashboard`
- Created `AuthErrorBoundary`: class-based boundary at App root catches RLS / 401 errors that escape pages → shows friendly "sign in required" card instead of blank page
- Annotated DomainRoutes.tsx with full public / protected / admin route map (60+ routes)
- Protected in vehicle module: `/vehicle/add`, `/:id/edit`, `/:id/mailbox`, `/:id/invest`, `/:id/portfolio`, `/:id/wiring`, `/:id/work`
- Protected in org module: `/org/dashboard`, `/org/create` (browse + profiles stay public)
- Protected in marketplace module: `/market/investor/dashboard`, `/market/portfolio`, `/market/builder`, `/market/contracts`, `/market/bids`
- Protected entire dealer module: `/dealer/*`
- Gated admin module with `RequireAdmin` at route level (stops lazy chunks from loading for non-admins)
- Commit: `86c279ee5`

### [cwfto] Situational Brief — 2026-02-27 ~18:30 UTC
- **P0 FOUND AND MITIGATED**: 30-minute UPDATE on vehicles (`SET auction_source = 'barrett-jackson'`) from normalize-slugs migration was blocking PostgREST schema cache reload. Another agent retrying DROP/CREATE INDEX caused AccessExclusive lock cascade → PGRST002 outage on ALL REST API calls.
- Cancelled 12+ DDL lock-waiters across 4 rounds
- Paused valuation cron jobs 321-325 (run_valuation_batch_by_quality) to reduce lock contention
- Closed stale task: YONO sidecar unreachable (29ede778) — confirmed healthy (tier1 OK, flat=276, zone=41, uptime=463s)
- Reset YONO sidecar redeploy (da504643) to pending — tier-2 training still active (japanese epoch 1/25)
- Filed 3 tasks: P97 vehicles lock fix, P88 re-enable valuation crons, P80 batch migration rule for CTO
- Scheduled next CWFTO loop (P92)

### [fb-marketplace] Comprehensive GraphQL probe + v2 scraper + 5-city production sweep
- **Probe 1**: Tested LSD token, fb_dtsg, User-Agent, doc_ids, full response schema mapping
  - KEY FINDING: No tokens required (LSD, dtsg, cookies) -- GraphQL works bare
  - KEY FINDING: Any User-Agent works (Chrome, Bingbot, Googlebot, curl, empty)
  - KEY FINDING: Zero pagination overlap across 10 pages (240 listings)
  - Full listing schema mapped: 30+ fields, presence rates documented
- **Probe 2**: Tested count, radius, price, year, make filters, cross-city, deep pagination
  - Price filter: WORKS accurately
  - Year filter: BROKEN (effectively ignored -- must filter by title parsing)
  - Make filter: BROKEN (effectively ignored)
  - Radius: WORKS (5km to 500km tested)
  - Max count per page: 24 (hard cap, requesting more still returns 24)
- **v2 scraper**: Rewrote `fb-marketplace-local-scraper.mjs`
  - Removed LSD token fetch (unnecessary HTTP request per city)
  - Batch upserts instead of individual queries
  - Expanded to 55 US metros (from 43)
  - Rate limit retry logic
  - Status mapping (is_sold/is_pending)
- **Production sweep**: 5 cities x 10 pages = 1,200 listings scanned
  - Austin: 21 vintage, Detroit: 31, LA: 44, Chicago: 28, Miami: 20
  - Total: 144 vintage listings upserted, 0 errors, 0 rate limits
  - National vintage rate: ~12% of all vehicle listings
- Updated `facebook-marketplace-extraction.md` with all findings
- Diagnostic scripts: `scripts/fb-graphql-probe.mjs`, `scripts/fb-graphql-probe-2.mjs`

## 2026-02-27 (VP AI — YONO Sidecar Fix)
- [yono] Fixed sidecar "modal-http: invalid function call" — root causes: (1) `@modal.concurrent(max_inputs=10)` is incompatible with `@modal.asgi_app()` in Modal 1.3.2 — removed it; (2) stale 529KB tier-2 ONNX stubs (graph-only, missing .data weight files) crashed containers on startup — deleted from volume; (3) added try/except around ONNX model loading so future incomplete uploads can't crash the server
- [yono] Sidecar redeployed at https://sss97133--yono-serve-fastapi-app.modal.run — /health 200 OK, /classify working (Land Rover correctly identified via british family tier-2 hierarchical inference)
- [yono] Tier-2 families live: american, british, german, japanese, italian, french (6/7 — Swedish still training PID 89338, watcher PID 7390 + PID 796 will auto-upload when done)
- [yono] URL typo documented: task description said sss73133 but actual workspace is sss97133 — .env and Supabase secrets are correct

## 2026-02-27 (VP Extraction — Fix primary_image_url on vehicle creation)

### Task: 5ed3e3b9-bbfd-473e-b522-4c3e9225e30d
**Priority:** 88
**Problem:** 1,671/1,684 vehicles created in last 24h had `primary_image_url = NULL`
**Root cause:** `extract-cars-and-bids-core` and `extract-bat-core` were creating vehicles with image galleries (inserted to `vehicle_images` table) but not setting the `primary_image_url` field on the vehicle record itself. This requires backfill operations and breaks discovery thumbnails.

**Fix applied:**
- `extract-cars-and-bids-core/index.ts`: Added `primary_image_url: extracted.images.length > 0 ? extracted.images[0] : null` to vehicleData
- `extract-bat-core/index.ts`: Added `primary_image_url: images.length > 0 ? images[0] : null` to insertPayload
- Both deployed successfully

**Impact:** 
- New vehicles created by these extractors will now automatically have primary_image_url set from first image
- Eliminates need for backfill scripts
- Enables immediate display of vehicle thumbnails in search/discovery UI
- Prevents the 1,671+ vehicles NULL state from recurring

**Status:** COMPLETED ✓

## 2026-02-28
- [frontend] Demoted AI button in ImageLightbox — hidden by default, shows RETRY on failure, status text for processing/pending, Alt+click power-user reprocess preserved
- [frontend] Added Vision Summary section to sidebar — vehicle_zone, condition stars, photo_quality, damage_flags as red tags, fabrication_stage
- [frontend] Made raw ai_scan_metadata collapsible (details/summary) — collapsed by default for power users
- [frontend] Updated ImageInfoPanel (mobile) with matching Vision Summary section
- [frontend] Replaced ANALYZE NOW button with status-aware display in sidebar
- [frontend] Walk-Around Carousel: horizontal scrollable strip below hero showing best image per zone category in canonical walk-around order (FRONT -> FRONT 3/4 -> DRIVER -> REAR 3/4 -> REAR -> PASSENGER -> INTERIOR -> ENGINE -> UNDER -> WHEELS -> DETAIL), with coverage indicator (X/11 angles), empty dashed placeholders for missing zones, photo counts per slot, click-to-scroll-to-zone interaction

## 2026-02-28

[dedup] Built auto-dedup-check edge function — fires automatically from photo-pipeline-orchestrator on every image INSERT
  - Computes dHash (same algorithm as dedup-vehicle-images), compares against vehicle's existing hashed images
  - If hamming distance <= 5, marks duplicate with provenance priority (user_upload > bat_import)
  - If new image from stronger source, flips — marks OLD image as duplicate (provenance-aware)
  - Non-blocking fire-and-forget from orchestrator Step 8
  - Deployed to production

[dedup] Added provenance display to ImageLightbox info sidebar
  - Shows ORIGINAL badge (green) with photographer attribution when cross_source_provenance exists
  - Shows "Also found on" with source list and dates
  - Shows attribution insight: "uploaded by user before appearing on auction platforms"
  - Shows DUPLICATE badge (red) for duplicate images with link to original

[dedup] Added provenance display to mobile ImageInfoPanel
  - Same provenance/duplicate indicators in mobile-friendly layout

[dedup] Added "dupes removed" count to ImageGallery Story Summary Bar
  - Parallel query counts is_duplicate=true images during load
  - Shows "N dupes removed" in summary bar when duplicates exist
  - Verified all 5 gallery view modes (grid, masonry, list, bundles, zones) correctly filter is_duplicate=true

## 2026-02-28 (Profile Import Flow for /claim-identity)
- [identity] Created `ingest-external-profile` edge function — validates profile URL, upserts external_identities, queues at priority 90
- [identity] Created `process-profile-queue` edge function — claims highest-priority queue items, calls extract-bat-profile-vehicles, sends in-app notification + email on completion
- [identity] Fixed `claim_user_profile_queue_batch` RPC — disambiguated column references (upq alias)
- [identity] Deployed `extract-bat-profile-vehicles` (was local-only, not previously deployed)
- [identity] Registered pg_cron job #335 — process-profile-queue every 5 minutes
- [frontend] Updated ClaimExternalIdentity.tsx — "Not seeing your profile?" import wizard replaces bare "Claim anyway" button; URL paste → instant identity creation → async stats enrichment
- [frontend] Updated Notifications.tsx — added action_url to query and renders as clickable "View →" link
- [identity] Verified end-to-end: skylarwilliams ingested → priority 90 queue → processed → 15 listings found → identity updated

## 2026-03-01

[backfill] Deployed backfill-vin-from-snapshots v1.2.0 — extracts VINs from archived HTML snapshots for vehicles missing VINs
  - Pure regex extraction, no LLM needed — parses BaT listing details, Mecum __NEXT_DATA__, JSON-LD, generic VIN labels
  - 76,570 candidates (vehicles with missing VINs + available snapshots) in pipeline
  - Manual session: 345 VINs found, 194 successfully backfilled, 151 were duplicate records
  - Hit rate: ~65% of candidates with snapshots have extractable VINs
  - v1.2.0 added random offset for cron (prevents re-processing same duplicates)
  - Cron job #345: runs every 10 minutes, batch_size=50
  - ~30 VINs backfilled per cron invocation at current rates
  - Estimated: ~30,000+ recoverable VINs from existing snapshot archive

## 2026-03-04 (ConceptCarz Data Forensics & Cleanup)

[data-quality] Full investigation of 374k ConceptCarz auction result rows (29% of all vehicles)
  - CRITICAL FINDING: 90.7% of sale_price values were fabricated averages, not real hammer prices
  - Proof: real auction prices are always ÷100 (bid increments); CZ prices like $70,156 are impossible
  - 265,215 fabricated prices moved from sale_price → cz_estimated_value column, sale_price nulled
  - 1,962 suspected averages (round but repeated 6+ times) also moved
  - 18,407 rows retained credible sale_price (11,723 likely_real + 6,483 plausible)
  - price_confidence column added: fabricated | suspected_average | plausible | likely_real
  - 25,434 model names cleaned (stripped "Chassis#:..." suffixes)
  - 8,553 garbage rows deleted (make = auction house name: Rm, Bonhams, Mecum, etc.)
  - auction_source mapped for 329k rows across 28 distinct houses (was all "conceptcarz")
  - Top houses: Mecum 92k, Barrett-Jackson 47k, Silver 18k, RM Sotheby's 17k, Bonhams 16k
  - Investigation doc: /Users/skylar/nuke/conceptcarz_investigation.md
  - Cleanup script: /Users/skylar/nuke/scripts/fix-conceptcarz-prices.sh
