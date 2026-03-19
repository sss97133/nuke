# Nuke Repository Overview

**Repository**: `sss97133/nuke`
**Domain**: nuke.ag
**One-liner**: Vertical data + applied AI platform that makes every collector vehicle in the world liquid.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + TypeScript + Vite | React 18.3.1, TS 5.8.3, Vite 6.4.1 |
| **Styling** | Tailwind CSS + custom design system (CSS vars) | Tailwind 3.3.5 |
| **Routing** | React Router DOM | 7.6.0 |
| **Server State** | TanStack React Query | 5.90.21 |
| **Backend** | Supabase Edge Functions (Deno) | ~385 functions (consolidating to ~50) |
| **Database** | PostgreSQL via Supabase | v15, 810 migrations, ~156 GB |
| **ML/Vision** | PyTorch + Florence-2 + EfficientNet (YONO) | PyTorch >=2.0, served on Modal |
| **ML Serving** | Modal (serverless GPU) | FastAPI sidecar |
| **LLMs** | Anthropic (Haiku/Sonnet/Opus), OpenAI (gpt-4o), Google Gemini | Multi-provider, cost-tiered |
| **Scraping** | Firecrawl, Playwright, custom fetchers | Firecrawl 4.8.2, Playwright 1.58.1 |
| **Payments** | Stripe + Stripe Connect | Stripe 20.3.0 |
| **Auth** | Supabase Auth (JWT + OAuth + SMS) | GitHub, Google, Twilio |
| **Frontend Deploy** | Vercel | SPA, Node 22.x |
| **Functions Deploy** | Supabase (hosted Deno) | Edge runtime |
| **SDK** | @nuke1/sdk (TypeScript) | v2.0.0 (unpublished) |
| **MCP Server** | Custom MCP (12 tools) | v0.5.0 |
| **Maps** | Leaflet, MapLibre, Deck.gl | Multi-renderer |
| **3D** | Three.js + React Three Fiber | Lazy-loaded |
| **Charts** | Recharts, D3 | Lazy-loaded |

---

## Architecture Overview

**Structure**: Monorepo with distinct subsystems, not microservices. Everything talks through Supabase (Postgres + Edge Functions + Realtime).

```
                    Vercel (SPA)
                        |
                  nuke_frontend/
                   React + Vite
                        |
            +-----------+-----------+
            |                       |
    Supabase PostgREST      Edge Functions (385)
     (auto-generated)        (Deno, REST-style)
            |                       |
            +----------++-----------+
                       ||
                  PostgreSQL v15
                   (~156 GB)
                       |
            +----------+----------+
            |          |          |
        Modal       Firecrawl   External APIs
      (YONO ML)    (scraping)   (BaT, FB, NHTSA...)
```

**Subsystems**:
- `nuke_frontend/` — React SPA (79 pages, 425+ components)
- `supabase/functions/` — 385 Deno edge functions (extractors, analyzers, pipelines, API)
- `supabase/migrations/` — 810 SQL migrations
- `yono/` — Python ML pipeline (EfficientNet classifiers, Florence-2 vision, Modal serving)
- `tools/nuke-sdk/` — TypeScript SDK for external consumers
- `mcp-server/` — Model Context Protocol server (12 tools)
- `scripts/` — Automation scripts (93 npm scripts)
- `dealerscan/` — Monorepo sub-project (4 workspaces: web, desktop, CLI, shared)

**Data flow**: External sources -> `archiveFetch()` (archives HTML) -> Extractors -> `import_queue` / `vehicle_observations` -> Enrichment functions -> `vehicles` table -> Analysis engine -> `analysis_signals` -> Frontend / API.

---

## Core Features

### Working in Production
- **Multi-source vehicle extraction**: 40+ extractors across BaT, Cars & Bids, Mecum, eBay, Craigslist, Facebook Marketplace, Hagerty, forums, etc.
- **Unified observation system**: Source-agnostic data ingestion with provenance tracking and confidence scores
- **YONO vision model**: EfficientNet make classifier (276 classes, 4ms/image, $0) + Florence-2 condition/zone analysis
- **Analysis engine**: 14 registered widgets (6 actively computed) for deal health, pricing risk, market signals
- **Archive-first scraping**: `archiveFetch()` stores raw HTML; re-extract without re-crawling (864K snapshots, 79 GB)
- **Comment intelligence**: 364K auction comments with sentiment analysis, expert detection, concern flagging
- **Vehicle events**: 170K deduplicated auction/listing events across platforms
- **Photo pipeline**: Upload, classify (41-zone taxonomy), analyze condition, detect damage
- **iPhoto integration**: Auto-ingest from Apple Photos library via `osxphotos` CLI
- **Public API v1**: 18 REST endpoints (vehicles, search, vision, analysis, VIN lookup, comps, valuations)
- **Facebook Marketplace scraper**: Logged-out GraphQL, 58 US metros, ~12% vintage vehicle rate
- **Forum extraction**: Build threads, posts, images from Rennlist, TheSamba, etc.
- **Pipeline registry**: 63 entries mapping table.column to owning edge function (prevents field conflicts)
- **Queue infrastructure**: Distributed workers with claim/lock/TTL pattern across 4 queues
- **Landing page**: Live data depth exploration (real counts, not marketing copy)

### WIP / Partially Deployed
- **SDK**: v2.0.0 built but unpublished to npm (v1.3.1 on npm, missing vision/signal/analysis)
- **MCP server**: 12 tools built, 2 return 401 errors, not published
- **Analysis widgets**: 8 of 14 not yet computed (geographic arbitrage, broker exposure, commission optimizer, etc.)
- **Document OCR pipeline**: Queue exists, classification works, full extraction incomplete
- **Stripe Connect**: Routes exist, flow incomplete
- **Seller/dealer detection**: `pipeline_sellers` + `pipeline_cross_posts` schema populated, no frontend

### Stubbed / Ghost Features (schema exists, no real activity)
- Financial instruments (funds, contracts, prediction markets) — seed data only
- Storage vaults / physical layer — migration written, never applied
- Standing orders / order book — function exists, never activated
- User engagement loop ("User as Key") — triggers designed, never deployed

---

## Data Models

### Core Entities

**vehicles** (~18K active after dedup) — Year, make, model, VIN, pricing, condition, 30+ computed fields (scores, estimates, completion %). Status enum: active/pending/sold/discovered/merged/rejected/inactive/archived/deleted/duplicate. Every field has `*_source` and `*_confidence` companions.

**vehicle_images** (1M+) — Image URL, classification (41-zone angle taxonomy), AI processing status, YONO classification results. Owned by `photo-pipeline-orchestrator`.

**vehicle_events** (170K) — Unified auction/listing events. Platform, URLs, prices (starting/current/final/reserve), bid/comment/view counts, seller/buyer identities. Deduped on (vehicle_id, platform, listing_id).

**vehicle_observations** (growing) — Append-only, immutable event store. Source-attributed, timestamped, confidence-scored. The new canonical intake path for all data.

**auction_comments** (364K) — Comment text, author, type (bid/question/answer/observation), sentiment, bid amounts. Linked to vehicle + auction event.

**organizations** (~1K) — Businesses, dealers, auction houses. Slug, location, verification status.

**profiles** — 1:1 with auth.users. Email, name, avatar, bio.

### Pipeline Tables

**import_queue** — Universal intake. Status: pending -> processing -> complete/failed. Claim/lock/TTL pattern.

**bat_extraction_queue** — BaT-specific extraction pipeline.

**analysis_queue** — Widget computation queue. Deduped per vehicle.

**document_ocr_queue** — Multi-step document extraction (classify -> extract -> link).

### Analysis System

**analysis_widgets** (14 registered) — Widget registry with triggers, compute mode, staleness config.

**analysis_signals** — Per-vehicle widget outputs. Score 0-100, severity, evidence, recommendations. One active signal per widget per vehicle.

**pipeline_registry** (63 entries) — Canonical map of which edge function owns which table.column. Prevents conflicting writes.

### Key Relationships
```
users -> profiles (1:1)
users -> vehicles (1:many)
vehicles -> vehicle_images (1:many)
vehicles -> vehicle_events (1:many)
vehicles -> vehicle_observations (1:many)
vehicles -> analysis_signals (1:many, 1 per widget)
vehicles -> auction_comments (1:many)
observation_sources -> vehicle_observations (1:many)
organizations -> vehicle_events (1:many)
```

---

## API Surface

**18 public REST endpoints** at `https://{project}.supabase.co/functions/v1/api-v1-*`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `api-v1-vehicles` | GET/POST/PATCH | Vehicle CRUD |
| `api-v1-search` | GET | Full-text search (921K+ vehicles) |
| `api-v1-vision` | GET/POST | YONO classify + Florence-2 analyze |
| `api-v1-analysis` | GET/POST | Analysis signals & widgets |
| `api-v1-comps` | GET | Comparable vehicles |
| `api-v1-valuations` | GET | Market valuations |
| `api-v1-vin-lookup` | GET | VIN decode (NHTSA VPIC) |
| `api-v1-makes` | GET | Make/model catalog |
| `api-v1-observations` | GET | Source-agnostic observations |
| `api-v1-batch` | POST | Bulk ingest |
| `api-v1-market-trends` | GET | Market analytics |
| `api-v1-export` | POST | Data export |

**Auth**: Bearer JWT (Supabase) or `X-API-Key` header (custom API keys, `nk_live_*`). Anonymous: 30 req/min per IP. API keys: 1,000 req/hr.

**Also**: Supabase auto-generated PostgREST on all tables (RLS-gated). No GraphQL except Facebook Marketplace scraping (external).

---

## External Integrations

| Service | Purpose |
|---------|---------|
| **Anthropic** (Haiku/Sonnet/Opus) | Extraction, analysis, vision, supervision |
| **OpenAI** (gpt-4o, gpt-4o-mini) | Vision, text analysis |
| **Google Gemini** (flash-lite, 1.5-pro) | Vision, text (free tier) |
| **Modal** | YONO model serving (GPU) |
| **Firecrawl** | JS-rendered web scraping |
| **Stripe** | Payments, Connect, webhooks |
| **Resend** | Inbound/outbound email |
| **NHTSA VPIC** | VIN decoding (free, public) |
| **Facebook Graph API** | Marketplace scraping (logged-out GraphQL) |
| **Twilio** | SMS verification |
| **GitHub/Google OAuth** | Social login |
| **Dropbox** | Photo sync integration |

---

## Frontend Structure

**79 pages**, domain-based routing via React Router v7:

| Domain | Routes | Protection |
|--------|--------|------------|
| `/` | Home (tabbed: Garage, Feed, Map, Market) | Public |
| `/vehicle/*` | List, profile, add, edit, mailbox | Mixed |
| `/auctions`, `/auction/:id` | Browse, listing detail | Public |
| `/search`, `/browse` | Discovery | Public |
| `/org/*` | Organization management | Protected |
| `/dealer/*` | Dealer tools, bulk edit, AI assistant | Protected |
| `/admin/*` | 20+ admin pages (mission control, extraction monitor, data quality) | Admin only |
| `/developers`, `/api` | Developer docs | Public |

**State**: AuthContext (global session), ThemeContext (dark/light + 21 racing accents), React Query (server state). No Redux/Zustand.

**Design system**: Arial only. Zero border-radius. Zero shadows. Zero gradients. 2px solid borders. ALL CAPS labels at 8-9px. CSS variables in `unified-design-system.css`. Dark mode via `[data-theme="dark"]`.

**Code splitting**: Heavy libs (Three.js, Recharts, PDF, OCR, maps) in separate chunks, lazy-loaded.

---

## What's Missing / TODOs

- **API auth inconsistency**: 10/13 endpoints have hash mismatches causing silent 401s
- **SDK unpublished**: v2.0.0 built, v1.3.1 on npm, missing vision/signal/analysis types
- **No OpenAPI spec**: Blocks auto-generated clients and Postman collections
- **8 analysis widgets** designed but never computed
- **Document OCR**: Queue exists, full extraction incomplete
- **81% vehicles missing `primary_image_url`** despite 35M images in DB
- **35M images pending AI analysis** (pipeline paused globally via `NUKE_ANALYSIS_PAUSED`)
- **No Python SDK** for ML/AI community
- **MCP server**: 2/6 tools return 401, not published
- **Confidence decay not deployed**: "Testimony with half-lives" concept articulated but no system-wide temporal decay function
- **"User as Key" architecture**: Designed (implicit subscriptions, predictive actions) but triggers never deployed
- **Financial layers**: Funds, contracts, prediction markets are ghost towns with seed data
- **Physical layer** (vaults, garage network): Vision doc exists, never built

---

## Environment & Config

**Required env vars** (names only):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `VITE_OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `FIRECRAWL_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `VITE_DROPBOX_app_key`, `VITE_DROPBOX_app_SECRET`, `VITE_DROPBOX_ACCESS_TOKEN`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `VITE_GITHUB_CLIENT_ID`, `VITE_GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`

**Services required**: Supabase (DB + functions), Vercel (frontend), Modal (ML), Stripe (payments).

**Secrets**: Managed via `dotenvx` (encrypted `.env`, never committed plaintext).

---

## The Vision

Nuke treats **collector vehicles as a financial asset class** with an epistemological data architecture:

**Core thesis**: Every other automotive data provider is an opinion. Nuke is a record. 1.29M vehicles, 35M images, 11.7M comments, $41.6B tracked transaction value — but the data must be trustworthy before it can be liquid.

**Philosophical foundations**:
- **Observations are immutable ground truth** — events happened, store them with source attribution and confidence scores, never overwrite
- **Confidence is never 1.0** — all derived facts are probabilistic, temporal decay applies ("testimony with half-lives")
- **Doubt triggers learning** — anomalies create new patterns that grow the taxonomy automatically
- **Fetch once, extract forever** — archive every page, re-extract without re-crawling
- **The Library IS the foundation** — RPO codes, paint codes, trim specs must be massively expanded before extraction scales
- **Vertical data + applied AI** — we own the data layer for this niche; value is in concrete outcomes (find undervalued assets, price repair work, match jobs to people)

**The flywheel**: Detailed vehicle profiles -> confident purchases -> detailed user/org profiles -> organizations become investment targets -> well-funded garages -> vehicles appreciate -> more investment -> more data -> loop.

**The moat** (three layers): Data (1.29M vehicles, nobody else has this combined), Model (YONO trained on Nuke's own corpus), Network (508K external identities, 3,987 organizations).

**What it's becoming**: A platform where any collector vehicle can become liquid at any moment. Not a marketplace — a data infrastructure that makes marketplaces, lenders, insurers, restorers, and AI agents all more effective through API access to the deepest vehicle intelligence ever assembled.

**The honest diagnosis** (from internal analysis): "We built the most sophisticated data infrastructure for collector vehicles on Earth, but we haven't shipped the door that lets anyone use it." The API barely exists. The voice (output) and hands (curation) are the most underdeveloped capabilities.
