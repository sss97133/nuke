# NUKE: The Conceptual Foundation

> "nuke makes every collector vehicle in the world liquid."

This document is the single source of truth for what Nuke is, who it's for, and where it's going. Every agent, every session, every line of code should be traceable to one of these concepts. If it isn't — it shouldn't exist.

**Companion documents:** `CLAUDE.md` (operational rules), `PROJECT_STATE.md` (sprint focus), `TOOLS.md` (function registry), `docs/VISION.md` (the original founder vision)

---

## I. The Gap

43 million collector and store-of-value vehicles in the US. Over $1 trillion in asset value. Zero system of record.

Real estate has MLS, Zillow, clean comps, mortgage markets, REIT structures. Public equities have Bloomberg terminals, SEC filings, 200 years of price history. Collector vehicles have spreadsheets and auction house PDFs. The data infrastructure is 30 years behind equities and real estate.

Social media already replaced traditional data sources for collector cars. Nobody checks Carfax for a 1973 911 — they read the BaT comments. The data layer shifted to social platforms, but nobody built the infrastructure to make that data structured, searchable, and trustworthy.

We did.

**The market (2026):**
- $1T+ insurable collector vehicle value (Hagerty)
- $4.8B annual auction + online sales (up 10% YoY)
- $1B in seven-figure car sales (2025 record)
- 200+ online-only $1M+ sales since 2019
- Global classic car market: $39.7B (2024) → $77.8B (2032), 8.7% CAGR
- 69 million car enthusiasts in the US
- ~18,000 specialty dealers
- $7.8B global automotive data market (~15% CAGR)

---

## II. What Nuke Is

Nuke is a **data company**. Not a marketplace. Not an auction platform. Not an app. The moat is the corpus and the model trained on it.

> "Every other automotive data provider is an opinion. Nuke is a record."
> — NUKE_API_STRATEGY_REPORT.md

> "Nuke is not an AI wrapper around existing data. It is the vehicle — the platform the AI drives and maintains."
> — NUKE_BUSINESS_PLAN.md

We are the factual layer that makes what AI says or suggests about vehicles *true*. We are the thread connecting ideas to reality. Like an LLM, but specialized — we don't generate opinions, we generate records.

### The Product Stack

**`@nuke1/sdk`** — The product. 15 resource namespaces (vehicles, observations, valuations, comps, vision, signal, analysis, search, listings, batch, webhooks, vinLookup, vehicleHistory, vehicleAuction, marketTrends). Published on NPM. Stripe-pattern design. Zero runtime dependencies.

**YONO** ("You Only Nuke Once") — The intelligence layer. Three-tier model hierarchy:
- Tier 0: EfficientNet-B0 make classification (276 classes, 4ms, $0/image)
- Tier 1: Hierarchical family→make cascade (8 families, per-family specialists)
- Tier 2: Florence-2 vision analysis (41-zone taxonomy, condition scoring, damage detection, modification detection, fabrication stage)
- Consumer promise: `nuke.vision.analyze(url)` → make/model/year/condition/value/comps

**The Observation Architecture** — The trust layer. Every data point is immutable, source-attributed, confidence-scored (0.00-1.00), time-ordered. 30 registered sources with calibrated trust scores (NHTSA: 0.95, BaT: 0.85, Forums: 0.50, AI: 0.70). Content-hashed for deduplication. Lineage chains track chain of custody. When three independent sources confirm the same fact, confidence compounds. Data never overwrites — it supersedes with full audit trail.

> "This is the difference between a database and a ledger. Nuke is a ledger."
> — NUKE_API_STRATEGY_REPORT.md

### What Nuke is NOT

- Not Rally Rd. — "You're the infrastructure that makes a thousand Rally Rds possible."
- Not a marketplace — "We earn when the ecosystem earns."
- Not a scraper — "Many startups have built automotive scrapers. Nuke is a data platform with an observation-based architecture. The distinction matters."
- Not competing with BaT/Hagerty/dealers — "We slide in alongside everyone. We don't take away, we add."

---

## III. Who It's For

**Not Ford. Not GM. Not enterprise fleet management.**

Nuke is for people like Skylar — owners, builders, restorers, collectors, dealers, and enthusiasts who want to make the most of their asset. People who know their vehicle's story better than any database, but have no infrastructure to prove it, share it, or capitalize on it.

> "The person who has everything. All the Porsches they ever wanted, all the fun projects. Now what? We are next-level obsession. We curate. We give people a new hobby backed by real asset infrastructure."
> — docs/VISION.md

> "The people who know the most about these machines are the ones who work on them. I'm building the tool so they don't have to be data scientists too."
> — YC_VIDEO_STORYBOARD.md

### The Users

- **The Owner** — Has a 1984 K10 with 90K photos and 17 months of restoration. Wants that data to mean something: a defensible valuation, insurance that reflects reality, a buyer who sees the provenance.
- **The Dealer** — 40 vehicles on a lot, needs transparent pricing, instant comps, buyers who trust the data enough to wire $85K sight-unseen.
- **The Restorer** — Does the work, proves it with photos. Photos automatically update condition records, trigger parts procurement, build reputation.
- **The Investor** — Sees collector vehicles as an asset class. Wants a Porsche ETF, a standing buy order, a condition-scored collateral assessment.
- **The Lender** — Needs collateral valuations for vehicle-backed loans. Nuke's 6.3% MAPE engine replaces $200-500 manual appraisals.
- **The Insurer** — Needs accurate replacement values. Cloud of batch API calls vs. individual policy reviews.
- **The AI Agent** — Calls `nuke.vehicles.get()` for profiles, `nuke.vision.analyze()` for photos, `nuke.signal.score()` for deal intelligence.

### The Philosophy: "Give Us the Keys, We Do the Rest"

One input — a photo, a VIN, a URL. Nuke returns everything.

> "Traditional Software: Users push buttons → System reacts."
> "Nuke Software: User exists → System proactively works on their behalf."
> "The user is not an operator. The user is a KEY — an authentication token that unlocks automatic, intelligent action."
> — USER_AS_KEY_ARCHITECTURE.md

The user authenticates. The system detects, processes, executes, and notifies. Implicit subscriptions (3 views = auto-subscribe). Background intelligence (crons sync hourly). Predictive actions (connected Dropbox = nightly auto-scan). The user approves, not executes.

---

## IV. The Five Layers

Each layer enables the next. You cannot skip layers. The data layer is the foundation.

> "You need structured data before you can financialize anything."
> — YC_APPLICATION_DRAFT.md (on why tokenization was deprioritized)

### Layer 1: The Data Layer — OPERATIONAL

Aggregate scattered vehicle data into a structured, searchable, confidence-scored system of record. 112+ sources. Observation architecture. Provenance chains. "Fetch once, extract forever."

**Current scale:**
- 1.29M vehicles (663K active, 502K duplicate, 47K pending)
- 35M images (886K AI-analyzed, 34.2M pending)
- 11.7M auction comments
- 1.36M observations (698K media, 442K comment, 188K bid, 27K specification)
- 773K valuations at 6.3% MAPE
- 508K external identities
- 3,987 organizations (108 dealers, 67 garages, 52 auction houses)
- 864K listing page snapshots (79GB archived HTML)
- 171GB total database

**Key data assets by source:**
- BaT: 618K vehicles, 11.7M comments, 4.1M bids — BaT has NO public API. Anyone wanting this data programmatically has one option: us.
- Barrett-Jackson: 69K archived snapshots (only 19% of fields extracted — data sitting there)
- Mecum, RM Sotheby's, Bonhams, Cars & Bids, Gooding, Collecting Cars, ConceptCarz, FB Marketplace (58 US metros), KSL, Craigslist, and 100+ more

**The principle:** Every piece of data Nuke touches gets better over time. Observations compound. Confidence scores increase. The vehicle's digital entity mirror gets sharper with each new data point from any source.

**The honest problem:** 39% data bloat (630K distinct URLs + 157K orphans out of 1.29M rows). BaT has 3.6x duplication (504K comment-scrape artifacts). ConceptCarz has 348K empty shells. Data quality is the bottleneck for everything above it.

### Layer 2: The Intelligence Layer — EMERGING

Train a proprietary model on the corpus. Make it free. Make it fast. Make it the reason developers integrate.

**What exists:**
- YONO Tier 0: EfficientNet-B0 (276 makes, ONNX exported, 4ms CPU inference, $0/image)
- YONO Tier 1: Hierarchical family→make cascade (8 family models, all ONNX exported)
- YONO Tier 2: Florence-2 vision analysis (41-zone taxonomy, 72.8% zone accuracy, condition/damage/modification detection)
- Modal cloud deployment (2 warm containers, 60s scaledown)
- Local FastAPI sidecar (Apple Silicon MPS, port 8472)
- Contextual model (image + sale history → price tier)
- 883K labeled training records, 91K cached training images (151GB)

**The economics:** 35M images × $0.004/image = $140K via cloud AI. YONO = $0/image + ~$640 compute. "That's the difference between a feature and a moat."

**The vision (from VISION_ROADMAP.md):**
- Phase 0 (done): 41-zone spatial classification
- Phase 1 (next): COLMAP 3D reconstruction from 4,400 BaT vehicles (100-200 pro photos each)
- Phase 2: Pixel-to-surface UV mapping
- Phase 3: Cross-reference 364K BaT comments to surface coordinates ("nice patina on that fender" → condition label at specific zone)
- Phase 4: Automated condition reports at 1"×1" granularity
- Phase 5: Scale to all 35M images
- End state: "Rust at surface coordinate (142.3", 18.7")" = rear passenger quarter panel, 18" from wheel arch. Insurance-grade.

> "We have 4,400 BaT vehicles with 100-200 professional photos each. That's the best vehicle photogrammetry corpus in existence outside of an OEM. No one else has this combination. This is a moat."
> — yono/VISION_ROADMAP.md

### Layer 3: The Action Layer — BUILT, NOT LIVE

Use intelligence to automate decisions. Score deals. Match buyers to vehicles. Commission repairs. Execute orders.

**What exists in production:**
- Deal scoring: heat_score, signal_score, deal_score (0-100 with strong_buy/buy/hold/pass/overpriced labels)
- Market intelligence: per-vehicle price_vs_market (% relative to comps)
- 38,133 ownership transfers auto-seeded from sold auctions (682K milestone records)
- Transfer automation: DB triggers fire on auction close, milestones seeded with deadlines, staleness sweeps on cron
- Signal/SMS/email inbound webhooks for transfer advancement

**What exists in code but not active:**
- Standing orders with price-time priority matching (match_order_book function)
- Cash settlement (reserve → deduct → credit flow)
- Commission tracking
- Contract builder with access tiers (public/authenticated/accredited/curator)
- Investor onboarding with risk disclosure

**The concept — "Bots That Hire Humans":**
> "AI is incredible at identifying opportunities. But the last mile in hands-on trades will always be human. We're not replacing tradespeople — we're building bots that hire them."
> — PITCH.md

> "The closest comparison is Uber, but the bot is the rider."
> — YC_APPLICATION_DRAFT.md

AI identifies a 1970 Chevelle SS396 undervalued by 22%. Calculates ROI of paint correction + mechanical refresh. Finds a rated restorer within 50 miles. Commissions the work. Monitors progress via photo submissions. Lists the vehicle when complete. The human turns wrenches. The bot manages everything else. "Our only bottleneck is workspace."

### Layer 4: The Market Layer — SCHEMA BUILT, SEED DATA ONLY

Make vehicles function like financial instruments. Tradeable. Fractionalizable. Financeable.

**What exists in production:**
- 4 market segment funds: PORS ($3.62/share), SQBD ($7.80), TRUK ($4.50), Y79 ($3.45) — NAVs updating from real vehicle data
- 6 vehicle offerings (1,000 shares each, all in "trading" status)
- 5 investment contracts totaling $160M stated AUM (BCHF Blue Chip Prancing Horse $87.6M, LMCH Le Mans Heritage $58.2M, BATD BaT Nostalgia $4.8M, SACP Scottsdale Compound $9.9M)
- 10 market indexes (SQBDY-50, CLSC-100, K5-BLZR, C10-TRK, SUBRBN, etc.)
- 402 betting/prediction markets for auction outcomes
- Full order matching engine (match_order_book with price-time priority)
- Cash ledger (user_cash_balances with reserve/deduct/credit)
- Contract API with Reg D/A/CF regulatory context, LP/LLC/SPV/Trust entity types

**What has ZERO actual activity:**
- 0 market orders placed, 0 trades executed
- 0 contract investors, 0 subscriptions
- 0 bets placed across 402 markets
- 0 user wallets (auto-init trigger exists but never fired for real users)
- Single test user (0b9f107a) holds all seeds

**Key concepts:**

**"Always Acquirable":** "'For sale' is not a status. It's a capability. The platform can broker any vehicle because we have (or will build) direct contact with current owners. We are CLOSERS." Standing orders execute automatically when matching vehicles enter the system.

**"Organization Curating into Liquidity":** A dealer's 40-vehicle inventory is illiquid. Nuke's valuation engine makes each vehicle's value transparent and defensible. A curator bundles them into an investment contract. Investors subscribe. The dealer gets immediate liquidity. This is securitization of dealer inventory, backed by Nuke as the independent pricing oracle.

**Revenue model for this layer:**
1. Auction lead commission (2% on $100M GMV = $2M/yr)
2. Transaction escrow (1% on $50M = $500K/yr)
3. API subscriptions ($299/mo × 200 orgs = $718K/yr)
4. Live auction prediction market (5% rake on $5M = $250K/yr)
5. Derivative & asset market (SEC-filed, regulated)

### Layer 5: The Physical Layer — VISION (MIGRATION NEVER APPLIED)

Big bunkers. Store cars like gold. Generational vaulting. Garages in every city. Cohesive transport network.

**What was designed but NEVER deployed to production:**
- `storage_vaults` table (facility type, security, capacity, location, pricing) — migration exists, never applied
- `vehicle_storage` table (intake→active→suspended→released lifecycle) — never applied
- `storage_fees` table with calculation functions — never applied
- `cashflow_deals` (advance/revenue share) — never applied

**What exists as UI only:**
- VaultPortfolio.tsx, VaultScanPage.tsx, VaultPage.tsx (reference missing tables)
- Vault attestation edge functions (vault-attestation-submit, vault-approve-access, vault-request-access) — these are for a document/identity vault, not physical storage

**The concept — The Vehicle Freeport:**

Modeled on the Geneva Freeport ($100B in art assets), Luxembourg Freeport, Singapore Freeport:
- Goods stored are considered perpetually "in transit" — no import duties until removal
- No VAT/sales tax on trades conducted within the facility
- Ownership transfers without physical movement — asset stays in vault, only paperwork changes
- Collateral lending — vehicles held in freeport secure loans without leaving

Applied to vehicles: A network of high-security, climate-controlled facilities in major markets (Scottsdale, Monterey, Amelia Island, Greenwich, Hershey). Comparable facilities already exist: DriverSource "The Vault" (Houston), Veloce Motors (storage systems), Auto Vault (Miami, NJ). None offer trading, fractional ownership, or financial infrastructure on top. That is the gap.

**The concept — The Nuke Garage:**

Physical workspaces using Nuke's data and methodology. Every service performed feeds data back into the vehicle's digital entity mirror. Physical + digital loop. This is already happening in miniature at 707 Yucca (RTX 3090 server, physical vehicle work, MoTec builds, photography). The K5 Blazer build ($124K invested, 6,580 tracked labor minutes, $150-250K target sale) IS the prototype garage.

Revenue stream: 10 bays × $2K/mo = $240K/yr at a single location.

---

## V. The Flywheel

```
Detailed vehicle profiles
  → enable instant, confident purchases
    → create detailed user/org profiles
      → organizations become targets of investment
        → builds network of well-funded garages and vaults
          → vehicles stay in pristine condition
            → vehicles appreciate
              → more investment
                → more data
                  → better profiles
                    → [loop]
```

The moat is three layers deep:
1. **The data** — 1.29M vehicles, 35M images, 11.7M comments, 4.1M bids, $41.6B tracked transaction value. Hard to replicate.
2. **The model** — YONO trained on Nuke's own corpus. Better data → better model → better API → more developers → more data. Self-reinforcing.
3. **The network** — Trust built over time. 508K external identities to claim. 3,987 organizations to onboard. Observation provenance that compounds.

---

## VI. The Distribution Strategy

### "We Earn When the Ecosystem Earns"

> "Nuke does not compete with existing players. It integrates with everyone via API and earns when the ecosystem earns."
> "Transparency is what lets everyone make money fairly."
> — REVENUE_MODEL.md

- Hagerty needs better valuation data → we license it
- BaT needs qualified leads → we send them, on commission
- Dealers need inventory intelligence → API subscription
- Lenders need collateral values → data licensing
- AI agents need vehicle data → SDK calls
- Rally/MCQ/TheCarCrowd need valuations for fractional offerings → data partnership
- Insurers need replacement values → batch API
- Restorers need parts and comps → marketplace commission

### The Developer Platform

The SDK is the business. Everything else is distribution.

| Channel | Product | Status | Gap |
|---------|---------|--------|-----|
| **NPM** | `@nuke1/sdk` | Published v1.3.1 | v1.6.0 unpublished (vision/signal/analysis missing) |
| **MCP** | `nuke-mcp-server` | Built (6 tools) | Not published, 2/6 tools broken (401), missing 9 resource areas |
| **REST API** | 13 endpoints | Live | Auth hash inconsistency across 10/13 endpoints |
| **CLI** | `nuke` command | Not built | — |
| **Desktop** | Tauri apps | Stubs | — |
| **Scanner** | `@nuke/scanner` | Built | Not published |
| **Python SDK** | For ML/AI community | Not built | — |
| **OpenAPI Spec** | API documentation | Not built | Blocks docs, Postman, multi-language SDKs |
| **MCP Registries** | 8 target registries | 0 submitted | REGISTRY_SUBMISSIONS.md has checklist, all empty |

**Competitive edge:** BaT has NO public API. CLASSIC.COM has no API. Hagerty has no data licensing program. The Classic Valuer has no SDK. Brego (UK) has an API but covers mass-market, not collectors. Nuke is the ONLY collector vehicle data API. First mover advantage is real but only if we ship.

### The Perplexity Pattern

> "I tasked Perplexity to clean up the ECP mess. It output a beautiful CSV with usable data. And it was slow but it DID it. I've asked so many times we do stuff well like that."
> — Session bcd7fd1a, March 4, 2026

Operate like Perplexity Computer — user describes what they want, system browses, scrapes, structures, delivers. This is the certified ingestion method beyond Claude Code: "Here's my vehicle. Here's a folder of photos. Here's a forum post about it. Make it a record." The MCP server is the implementation vehicle for this.

### BaT Data Monopoly

BaT is the dominant platform in collector vehicles — 132K+ listings indexed with 11.7M comments and 4.1M bids. BaT offers no API to anyone. Apify scrapers and GitHub tools exist but produce raw, unstructured data. Nuke has already ingested, structured, and confidence-scored 618K BaT vehicles. Anyone wanting BaT data programmatically — dealers pricing inventory, lenders valuing collateral, AI agents understanding the market — has one path: `nuke.comps.get({ make: 'Porsche', model: '911' })`.

---

## VII. Core Concepts (Glossary for Agents)

### "Fetch Once, Extract Forever"
Every page fetched via `archiveFetch()` is stored as raw HTML in `listing_page_snapshots` (864K rows, 79GB). Future extraction needs are local queries against stored content. No re-crawling. Barrett-Jackson has 69K archived snapshots with only 19% extracted — that's data sitting there waiting.

### "The Data Knows What It Contains"
Schema Discovery Principle. Never pre-define a schema before seeing actual data. Sample 20-50 documents → enumerate all fields → aggregate frequencies → design schema → extract once. This found 27 fields that would have been missed in receipt extraction.

### "Observations, Not Opinions"
Financial data distinguishes between observations (I saw this trade at $42,500) and opinions (I think it's worth $45,000). Nuke records observations. Source. Timestamp. Confidence score. Provenance chain. The opinion (the Nuke Estimate) is derived FROM observations, not substituted for them.

### "Vehicles as Entities"
Each vehicle is an entity we serve. It has a mailbox, a timeline, a provenance record, images, observations. We improve its data fidelity continuously. Eventually, vehicles become autonomous agents: "I know my history, my needs, my value." Phase 4 vision: vehicles own wallets, auto-pay for maintenance, report to owner only when needed.

### "User as Key"
The user is not an operator. They are an authentication token. Their existence triggers action. 3 views of a dealer's vehicles = auto-subscribe. Connected photo library = nightly scan. Background intelligence operates 24/7. The user approves outcomes, not initiates processes.

### "Secretary Mode → Curator Mode"
Evolution of the user role. Secretary Mode (2025): AI extracts, user validates per-vehicle. Curator Mode (2026): user sets strategy ("extract all K5 Blazers from BaT"), agents execute automatically. "You curate and configure, agents execute."

### "The Only API for Fixing Old Cars Is Still Human Interface"
The YC hook line. AI can identify the opportunity, price the work, select the worker. But someone still has to turn wrenches. Nuke bridges the gap — data infrastructure that makes human expertise more valuable, not obsolete.

---

## VIII. The Builder's Constraint

> "I built Nuke alone. 464 edge functions. An 800+ migration database. A proprietary ML model. An autonomous extraction pipeline. A TypeScript SDK. An investor data room with live stats."
> "When you have to maintain everything yourself, you build systems that run themselves. That's the product."
> — X_POSTS.md

The architecture exists because of the constraint. One founder. Zero outside engineering headcount. The pipeline runs itself. 15-agent AI hierarchy (CEO → Executives/Opus → VPs/Sonnet → Workers/Haiku) with email, task queues, and model routing. The CEO wakes up to a better system than the night before.

> "You're not in a WeWork. You're in a garage in Boulder City building data infrastructure between oil changes. That's the whole story."
> — YC_VIDEO_STORYBOARD.md

**The physical business is real:** K5 Blazer build: $124K invested, 6,580 labor minutes, $150-250K target. Highboy consignment: $90-150K relaunch, 17 months managed, $11,927 broker-absorbed costs. 6 active restomod builds. 200+ legacy auto industry contacts from Viva Las Vegas Autos. Server at 707 Yucca running YONO.

---

## IX. Current Reality Check — March 2026

### What works
- Data ingestion from 112+ sources (automated, agent hierarchy)
- Valuation engine at 6.3% MAPE across 474K+ estimates
- SDK with 15 resource namespaces, 30+ methods (published v1.3.1)
- 13 live API endpoints with key-based auth
- YONO 3-tier model: make classification + zone analysis + condition scoring
- Observation architecture with 1.36M observations, 30 calibrated sources
- 38K ownership transfers auto-seeded with 682K milestones
- Vehicle profile page with dense data display (2,073 lines)
- Feed/browse with sophisticated filtering (1,990 lines)
- Universal search bar (paste URL → auto-extract)
- Market funds with live NAV updates

### What's broken
- **Data quality:** 39% bloat, 348K empty shells, 3.6x BaT duplication, 265 impossible states
- **API auth:** Hash prefix inconsistency across 10/13 endpoints (silent 401s possible)
- **SDK↔API mismatch:** Response shapes don't match (data vs vehicles key, field name mismatches)
- **SDK unpublished:** v1.6.0 has vision/signal/analysis, only v1.3.1 is on NPM
- **MCP broken:** 2/6 tools return 401, not published to NPM or any registry
- **Image pipeline:** 35M pending, 28K stuck in "processing", optimization pipeline never ran
- **Frontend↔Backend gap:** Profiles show "0 observations" despite 625K in DB, 81% of vehicles missing primary_image_url despite 35M images
- **User connection layer:** 508K external identities with 0 claims, 37K transfers with 0 user links
- **Financial layer:** All seed data, zero real activity across markets/contracts/betting
- **Storage vaults:** Migration never applied, tables don't exist in production
- **Business license:** Nevada NUKE ltd expired Sep 30, 2025 — needs renewal
- **No certified user ingestion method** beyond Claude Code
- **No engagement loop** — nothing drives daily use

### What's the bottleneck

Not building. **Finishing.**

The code exists for markets, vaults, contracts, order books, fractional shares. But they're ghost towns — seed data, zero users. The financial layers cannot come alive until the data layer underneath them is trustworthy.

> "this amount of slop exceeds my human ability to audit. i can only complain and direct the computational power. i cant inspect how the tools work. i can only sit here and beg a forgetful god."
> — Skylar, session 0bfa2376, March 4, 2026

Fix the data. Ship the SDK. Publish the MCP. Make the founder's own vehicles work perfectly as proof. Then the financial layer has something to stand on.

---

## X. The Long Arc

```
Layer 1: Data          → I know every vehicle that exists
Layer 2: Intelligence  → I understand what I see
Layer 3: Action        → I can make things happen
Layer 4: Markets       → I can make things trade
Layer 5: Physical      → I can make things real
Layer ∞: Autonomy      → The vehicle knows itself
```

> "Humans create data by living, not by answering questions."
> — STRUCTURAL_FOUNDATION.md

> "The only absolute truth is live experience (sitting in the car, holding the art, walking the property). Our job is to compile all observations to approximate truth as closely as possible, while acknowledging the approximation."
> — STRUCTURAL_FOUNDATION.md

> "Doubt is gold — it triggers learning."
> — STRUCTURAL_FOUNDATION.md

---

*Last updated: 2026-03-07. This is the conceptual foundation. Start here, then read CLAUDE.md for operational rules.*
