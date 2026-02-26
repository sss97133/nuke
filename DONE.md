# DONE — Completed Work Log

**Append-only. Add entries when completing significant work.**
Agents read this to avoid rebuilding things that already exist.

Format: `- [area] What was built — where it lives`

---

## 2026-02-26
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
