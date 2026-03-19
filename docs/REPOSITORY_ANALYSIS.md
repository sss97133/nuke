# Nuke Repository Analysis

**Repository:** `sss97133/nuke`
**Generated:** 2026-03-18
**Domain:** nuke.ag

---

## 1. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + Vite | 18.3.1 / 6.4.1 |
| **Routing** | React Router | 7.6.0 |
| **State** | React Query + Context API | 5.90.21 |
| **Styling** | Tailwind CSS + custom design system | 3.3.5 |
| **Forms** | React Hook Form + Zod | 7.56.3 / 3.24.4 |
| **3D/Maps** | Three.js, Deck.gl, MapLibre, Leaflet | 0.182.0 / 9.2.10 / 5.19.0 |
| **Charts** | Recharts | 3.7.0 |
| **Backend** | Supabase Edge Functions (Deno) | ~440 functions |
| **Database** | PostgreSQL 15 (Supabase) | 156 GB, 1,013 tables |
| **ML/Vision** | PyTorch, EfficientNet, Florence-2, YOLOv8 | 2.0+ |
| **Inference** | ONNX Runtime, Modal (serverless GPU) | 1.16.0+ |
| **AI/LLM** | Anthropic Claude, OpenAI, Google Gemini, xAI | Multi-provider |
| **Scraping** | Firecrawl, Playwright, Cheerio | 4.8.2 / 1.58.1 / 1.1.2 |
| **Payments** | Stripe | 20.3.0 |
| **Auth** | Supabase Auth (email, SMS/Twilio, GitHub/Google OAuth) | — |
| **Hosting** | Vercel (frontend), Fly.io (scraper sidecar) | — |
| **Secrets** | dotenvx (encrypted) | — |
| **Language** | TypeScript throughout, Python for ML training | 5.8.3 |
| **Node** | 22.x | — |

---

## 2. Architecture Overview

**Monorepo** with four major zones:

```
nuke/
├── nuke_frontend/          # React SPA (Vercel)
├── supabase/functions/     # ~440 Deno edge functions (Supabase)
├── supabase/migrations/    # 800+ PostgreSQL migrations
├── yono/                   # Python ML training (PyTorch → ONNX)
├── scripts/                # Node.js CLI tools (extraction, intake)
├── tools/                  # SDK, widgets, scanner, desktop app
└── mcp-server/             # MCP server (Claude Code integration)
```

**Dependency map:**
```
[Browser] → Vercel (React SPA)
              ↓ Supabase JS SDK
[Supabase Edge Functions] ←→ [PostgreSQL 15]
              ↓                    ↑
[External Sources] ──scrape──→ [import_queue] → [vehicles]
  (BaT, C&B, FB, CL,             ↓
   eBay, 27+ platforms)    [vehicle_observations]
                                   ↓
[YONO on Modal] ←── image_url ── [vehicle_images]
  (EfficientNet + Florence-2)      ↓
                            [analysis_signals]
```

The system is **extraction-first**: scrape external vehicle listings, normalize into observations with provenance, enrich via AI, score via analysis widgets. Frontend is the viewing layer; edge functions are the brain.

---

## 3. Core Features

### Working
- **Multi-source vehicle extraction** — 42 dedicated extractors for BaT, Cars & Bids, Barrett-Jackson, Mecum, RM Sotheby's, Craigslist, eBay Motors, Facebook Marketplace, and 20+ other platforms
- **Observation architecture** — Source-attributed, confidence-scored, time-ordered data points; nothing overwrites, everything compounds
- **YONO vision model** — Proprietary vehicle classifier (58 makes, hierarchical tier-1/tier-2), zone classifier (41 zones), condition analysis via Florence-2. Zero cost per image inference via ONNX
- **3-tier agent hierarchy** — Haiku (routine extraction, $1/MTok) → Sonnet (quality review) → Opus (strategy). Processes import_queue autonomously
- **Analysis engine** — 14 scoring widgets (deal health, pricing, market, presentation, exposure, timing) producing per-vehicle signals
- **Vehicle valuation** — AI-computed estimates with 6.3% MAPE, confidence scoring
- **Comment sentiment analysis** — 364K+ auction comments analyzed for sentiment, themes, specifications
- **Archive-first fetching** — Every external page archived to `listing_page_snapshots`; re-extract forever without re-crawling
- **Universal search** — Searches vehicles, orgs, users, tags with thumbnails
- **18 public REST APIs** — Vehicles, search, VIN lookup, comps, vision, valuations, market trends, listings
- **Facebook Marketplace scraper** — Logged-out GraphQL, 58 US metros, no tokens needed
- **iPhoto intake** — Auto-imports from Apple Photos library albums via osxphotos CLI
- **Multi-tenant storefronts** — Subdomain-based dealer storefronts (`dealer.nuke.ag`)

### WIP / Stubbed
- **SDK publishing** — v1.5.0 ready but not yet on npm
- **MCP server** — v0.5.0 committed, 12 tools, not production-ready
- **Market layer** — 4 segment funds defined, zero real activity
- **Accreditation validation** — Regulatory checks in contracts API are TODO stubs
- **Price history tracking** — Feature stubs returning empty arrays
- **Work order lifecycle** — Payment flows exist but fee logic incomplete
- **Autonomous source ingestion agent** — Function body is entirely TODO

---

## 4. Data Models

### Core Entities

**vehicles** (~141K records) — Master entity. Year/make/model/VIN, sale prices, condition ratings, AI-computed scores (deal, heat, signal, performance, investment), verification status, full provenance tracking per field.

**vehicle_images** (1M+) — Image URLs with processing pipeline status (ai_processing, optimization, organization), angle classification by YONO, position ordering.

**vehicle_events** (170K+) — Unified auction/listing history. Platform, prices (starting/current/final/reserve), bid/comment/view counts, seller/buyer identities. Dedup key: (vehicle_id, platform, listing_id).

**import_queue** — Job queue for extraction. Priority-based, concurrency-safe locking, exponential backoff. Status: pending → processing → complete/failed.

**vehicle_observations** — Source-agnostic event log. Every data point is an observation with kind (listing/comment/bid/condition/specification/etc.), source attribution, confidence score.

**observation_sources** (20+ registered) — Source registry with trust scores, supported observation kinds, URL patterns.

**auction_comments** (364K+) — Normalized BaT comments with sentiment analysis via `comment_discoveries`.

**analysis_signals** — Per-vehicle widget outputs. One active signal per widget per vehicle, with score, severity, reasons, recommendations, change tracking.

### Relationships
```
vehicles 1:N → vehicle_images, vehicle_events, vehicle_observations, analysis_signals
vehicle_events 1:N → auction_comments → comment_discoveries
observation_sources 1:N → vehicle_observations → observation_discoveries
import_queue N:1 → vehicles (linked after processing)
analysis_widgets 1:N → analysis_signals
```

### Pipeline Registry
63 entries mapping `table.column → owning_edge_function`. Prevents duplicate writes. Key protected fields: `nuke_estimate`, `signal_score`, `deal_score` on vehicles; `angle`, `ai_processing_status` on vehicle_images.

---

## 5. API Surface

**Protocol:** REST only (no GraphQL, no WebSocket). All edge functions accept `POST` with JSON body.

**Auth methods:**
- Bearer token (Supabase JWT) — standard user auth
- `X-API-Key` header — rate-limited developer keys (1000 req/hour)
- Service role key — internal function-to-function calls
- Anonymous/IP-based — 30 req/60s for public endpoints

**Public REST APIs (18):** `api-v1-vehicles`, `api-v1-search`, `api-v1-vin-lookup`, `api-v1-comps`, `api-v1-observations`, `api-v1-vision`, `api-v1-valuations`, `api-v1-market-trends`, `api-v1-listings`, `api-v1-makes`, `api-v1-export`, `api-v1-analysis`, `api-v1-signal`, `api-v1-batch`, `api-v1-contracts`, `api-v1-business-data`, `api-v1-vehicle-auction`, `api-v1-vehicle-history`

**Internal functions:** 42 extractors, 22 enrichment, 20 workers, 14 discovery, 10 analysis widgets, 15 auth/webhooks, 5 YONO vision

**Webhooks (inbound):** Stripe, QuickBooks, Telegram approvals, email/SMS transfer notifications, KYC verification

---

## 6. External Integrations

**AI/LLM:** Anthropic Claude (primary), OpenAI, Google Gemini, Perplexity, xAI Grok
**Scraping:** Firecrawl, Browserbase, Playwright
**Payments:** Stripe (payments, Connect, subscriptions)
**Communication:** Twilio (SMS/verify), Telegram (bots, approvals), Resend (email)
**Auth providers:** GitHub, Google, Facebook OAuth
**Cloud:** AWS Rekognition, Modal (GPU inference), Vercel, Fly.io
**File storage:** Supabase Storage, Dropbox
**Business:** QuickBooks (accounting sync)
**Data sources:** 27+ auction/marketplace/forum platforms scraped (BaT, C&B, Barrett-Jackson, Mecum, RM Sotheby's, Bonhams, Gooding, Craigslist, eBay Motors, Facebook Marketplace, Hagerty, KSL, Hemmings, PCarMarket, JamesEdition, Rennlist, TheSamba, and more)
**Reference:** NHTSA VIN decoder (public API)

---

## 7. Frontend Structure

**79 page components** organized into lazy-loaded route modules:

| Module | Key Routes | Auth |
|--------|-----------|------|
| **Home** | `/` (tabbed: Garage, Feed, Map, Market) | Mixed |
| **Vehicle** | `/vehicle/:id`, `/vehicle/list`, `/vehicle/:id/edit` | Mixed |
| **Organization** | `/org/:orgId`, `/org/dashboard`, `/org/create` | Mixed |
| **Admin** | `/admin/*` (audit, diagnostics, mission control) | Admin |
| **Dealer** | `/dealer/*` (AI assistant, bulk editor, Dropbox import) | Auth |
| **Marketplace** | `/market/*` (segments, funds, dashboards) | Mixed |
| **Settings** | `/settings/*` (API keys, webhooks, usage) | Auth |
| **Public** | `/search`, `/browse`, `/auctions`, `/about`, `/developers` | Public |

**State management:** Context API (auth, theme, upload status) + React Query (all server state). No Redux or Zustand.

**Design system:** Arial font only, Courier New for data. Zero border-radius, zero shadows. 2px solid borders. ALL CAPS labels at 8-9px. Racing accent colors (Gulf, Martini, JPS) as easter eggs only.

**Storefront system:** Subdomain-based multi-tenancy. `dealer-slug.nuke.ag` loads a branded StorefrontApp with custom theming from org config.

---

## 8. What's Missing / TODOs

- **Zero real users** — Platform is feature-complete but has no external users
- **SDK unpublished** — v1.5.0 ready, npm publish deferred
- **MCP server broken** — v0.5.0 not production-ready
- **35M images pending analysis** — Pipeline paused globally (`NUKE_ANALYSIS_PAUSED`)
- **483 empty database tables** — Marked for deletion post-triage
- **440 edge functions** vs target of 50 — Consolidation ongoing
- **Payment/fee logic incomplete** — Stripe connected but work-order fees are stubs
- **Accreditation validation** — Regulatory checks in contracts API unimplemented
- **Price history tracking** — Returns empty arrays
- **Autonomous source ingestion** — Entire function body is TODO
- **Data quality gaps** — 79K vehicles missing VIN, 41K missing descriptions

---

## 9. Environment & Config

**Required env vars (names only):**
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_JWT_SECRET`, `FIRECRAWL_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `YONO_SIDECAR_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BRIGHTDATA_HOST/PORT/USERNAME/PASSWORD`, `VITE_DROPBOX_app_key`, `NUKE_ANALYSIS_PAUSED`

**Services required:** Supabase project (PostgreSQL + Edge Functions + Auth + Storage), Vercel (frontend hosting), Modal account (YONO inference). Optional: Fly.io (KSL scraper), Stripe, Twilio, Telegram bot.

---

## 10. The Vision

Nuke is building the **system of record for every collector vehicle in the world**. The thesis: 43M collector vehicles in the US represent $1T+ in value with zero unified data infrastructure — 30 years behind equities and real estate.

The architecture follows five layers: **Data** (1.29M vehicles, 35M images, 11.7M comments) → **Intelligence** (YONO vision model, 3-tier agent hierarchy, 6.3% MAPE valuations) → **Action** (deal scoring, market signals, ownership transfers) → **Markets** (segment funds, structured products) → **Physical** (vehicle freeports, not yet deployed).

The moat is the observation corpus. Every data point is source-attributed, confidence-scored, and time-ordered. Nothing overwrites; everything compounds. The Feb 26-27 triage session (905 prompts, 31.9 hours, 128 commits) established the architectural discipline that prevents the platform from bloating again.

Built solo from a garage in Boulder City, Nevada. The bottleneck is not building — it's finishing. The code exists. Zero users.
