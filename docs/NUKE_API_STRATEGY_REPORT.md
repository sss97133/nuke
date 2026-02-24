# NUKE: The Automotive Data API

## Strategic Positioning & Product Report

**Prepared:** February 2026
**Classification:** Internal — Founder's Eyes Only
**Version:** 1.0

---

\newpage

# Table of Contents

1. Executive Summary
2. The Thesis
3. Market Landscape
4. Competitive Analysis
5. Where Everyone Else Falls Short
6. What Nuke Has Built
7. The Data Advantage
8. Platform Metrics — Current State
9. The Observation Model
10. Confidence & Provenance — The Real Product
11. The Valuation Engine
12. Source Coverage
13. Pipeline & Ingestion Architecture
14. Current API Surface
15. The SDK
16. Webhooks & Event System
17. The Target API Surface
18. API Design Philosophy
19. Developer Experience Roadmap
20. Pricing Strategy
21. Customer Segments
22. Go-to-Market
23. Competitive Positioning Matrix
24. Technical Moat Analysis
25. Risks & Mitigations
26. 90-Day Execution Plan
27. Appendix A: Current Database Schema
28. Appendix B: Full Endpoint Inventory
29. Appendix C: Sample API Responses

---

\newpage

# 1. Executive Summary

Nuke is positioning as **the definitive API for automotive data** — not an AI company that happens to have cars, but a data company whose product is the most complete, most traceable, most trustworthy automotive dataset ever assembled.

The automotive data market is estimated at $6-8B globally and growing at 15-20% CAGR, driven by fintech, insurtech, dealer SaaS, and the explosion of online vehicle marketplaces. Yet the existing providers — KBB, Black Book, J.D. Power, Edmunds — are built on decades-old models: editorial estimates, dealer surveys, guidebook valuations. They tell you what a vehicle *should* be worth. They don't tell you what vehicles *actually* sold for, where, when, and with what level of confidence.

Nuke does.

**Current state as of February 2026:**
- 812,913 vehicles in the database
- 30.4 million images
- 507,071 computed valuations (62.4% coverage)
- 617,385 observations from 517 active sources
- 132,630 indexed BaT listings with 11M+ auction comments
- 22,775 new vehicles ingested in the last 24 hours
- 25+ platform integrations across auctions, classifieds, and marketplaces
- Published OpenAPI 3.0 spec, TypeScript SDK, webhook system

The infrastructure is built. The data is flowing. The question now is packaging and positioning.

---

\newpage

# 2. The Thesis

**Every other automotive data provider is an opinion. Nuke is a record.**

Traditional automotive valuation works like this: an editorial team surveys dealers, reviews wholesale auction data (Manheim, ADESA), applies adjustment factors, and publishes a "value." This number is an estimate — a blend of methodology, judgment, and update frequency (often monthly or quarterly).

Nuke works differently. Every piece of data in the system is an **observation** — a discrete, timestamped, source-attributed data point. A BaT hammer price is an observation. A Craigslist asking price is an observation. A Facebook Marketplace listing that sat for 47 days and sold for 15% below ask is an observation. A forum post where someone mentions buying their car for $12,000 in 2019 is an observation.

These observations are:
- **Immutable** — once recorded, they cannot be changed
- **Source-attributed** — every observation carries its origin (platform, URL, extraction method)
- **Confidence-scored** — every observation has a trust rating based on source reliability and corroboration
- **Time-ordered** — creating a true history of the vehicle, not a snapshot

This is not a better opinion. It is a different category of product.

**The thesis is simple: in a world of increasingly sophisticated data consumers — algorithmic lenders, programmatic insurance underwriters, AI-powered dealer tools — the winner is whoever can provide the rawest, most traceable, most comprehensive automotive transaction data. Not summaries. Not estimates. Observations.**

---

\newpage

# 3. Market Landscape

## 3.1 Market Size

The global automotive data market spans several overlapping segments:

| Segment | Estimated Size | Growth Rate |
|---------|---------------|-------------|
| Vehicle valuation & pricing data | $2.5B | 12-15% |
| VIN decoding & specification data | $800M | 8-10% |
| Vehicle history reports | $1.5B | 10-12% |
| Dealer analytics & market intelligence | $1.2B | 18-22% |
| Insurance & lending vehicle data | $1.8B | 15-18% |
| **Total addressable** | **~$7.8B** | **~15%** |

The fastest-growing segments are dealer analytics (driven by margin compression and inventory optimization needs) and insurance/lending data (driven by algorithmic underwriting and embedded finance).

## 3.2 Market Structure

The market is currently structured around **use-case-specific providers** rather than general-purpose data APIs:

- **Valuation**: KBB, Black Book, J.D. Power (NADA), Edmunds
- **VIN/Specs**: DataOne, Chrome Data (Autodata), NHTSA
- **History**: CarFax, AutoCheck (Experian)
- **Listings/Inventory**: MarketCheck, AutoDev, Cars.com
- **Enthusiast/Classic**: Hagerty, Classic.com, BaT (raw data)

No single provider offers a unified, source-attributed dataset spanning all of these. Every consumer stitches together 3-5 providers, pays for redundant coverage, and reconciles conflicting data manually.

## 3.3 Market Trends

**1. Programmatic consumption is replacing manual lookup.** Dealers used to open KBB in a browser. Now their DMS calls an API. Lenders used to pull a NADA guide. Now their decisioning engine calls a valuation API in the loan origination flow.

**2. Classic and enthusiast vehicles are underserved.** KBB and Black Book focus on vehicles 1-20 years old. The collector market ($30B+ in annual transactions) has no equivalent data infrastructure. Hagerty's price guide is editorial. BaT results are public but unstructured.

**3. Data provenance is becoming a requirement.** Regulators, auditors, and institutional buyers increasingly require explainability — not just "the car is worth $X" but "here's why, based on these transactions, with this confidence level."

**4. Real-time is replacing periodic.** Monthly guidebook updates are too slow for a market where auction results, listing prices, and market sentiment change daily.

---

\newpage

# 4. Competitive Analysis

## 4.1 Kelley Blue Book (KBB) / Cox Automotive

**What they offer:** Consumer-facing and API-based vehicle valuations for vehicles 1-20 years old. Trade-in, private party, and dealer retail values. Powers many dealer and lending integrations.

**Strengths:** Brand recognition (96% consumer awareness). Massive dealer network through Cox (Autotrader, Dealer.com, vAuto). Integration with major DMS platforms.

**Weaknesses:** Valuation methodology is opaque — editorial + algorithmic blend with no source attribution. Poor coverage of vehicles >20 years old. No auction transaction data. API access is enterprise-only with long sales cycles. No real-time data. Values update periodically, not continuously.

**Pricing:** Enterprise contracts, typically $50K-$500K/year depending on volume and use case. No self-serve API.

**Gap Nuke fills:** Source-level transparency, real-time auction data, classic/enthusiast coverage, self-serve API access.

## 4.2 Black Book

**What they offer:** Wholesale and retail vehicle valuations, primarily serving dealers, lenders, and insurers. Strong in wholesale (Manheim/ADESA auction data). Daily value updates.

**Strengths:** Deep wholesale auction integration. Daily updates (faster than KBB). Strong in lending — used by many auto lenders for loan-to-value calculations. Condition-adjusted values.

**Weaknesses:** Wholesale-focused — less relevant for retail/consumer transactions. No enthusiast/classic coverage. No retail auction data (BaT, C&B, etc.). Opaque methodology. Enterprise pricing only.

**Pricing:** Enterprise contracts, $30K-$200K/year. Per-VIN pricing available for some tiers ($0.10-$0.50/lookup).

**Gap Nuke fills:** Retail auction transparency, enthusiast/classic data, observation-level detail, accessible pricing.

## 4.3 J.D. Power (formerly NADA Guides)

**What they offer:** Vehicle valuation guides used extensively in lending and insurance. The "NADA value" is the standard for many credit unions and insurance companies.

**Strengths:** Regulatory acceptance — many lenders are contractually required to use NADA values. Long history and institutional trust. Good condition adjustment methodology.

**Weaknesses:** Extremely slow update cycle. Conservative valuations (by design — lenders want downside protection). No transaction-level data. No auction data. Classic coverage is minimal. API is dated.

**Pricing:** Enterprise contracts, often bundled with J.D. Power analytics.

**Gap Nuke fills:** Transaction-level data for audit trails, real-time values, enthusiast/classic coverage.

## 4.4 Edmunds

**What they offer:** Consumer-facing vehicle information, reviews, and pricing. TMV (True Market Value) pricing. API program for inventory and pricing data.

**Strengths:** Strong consumer brand. Good editorial content. Decent API program with self-serve options. New car transaction data from dealer partners.

**Weaknesses:** Primarily new/near-new vehicles. No auction data. No classic/enthusiast coverage. TMV is modeled, not observed. API has been deprioritized (limited updates in recent years).

**Pricing:** API plans from $0 (limited) to custom enterprise.

**Gap Nuke fills:** Used/classic vehicle depth, auction data, observation model.

## 4.5 MarketCheck

**What they offer:** Automotive listing aggregation API. Real-time inventory data from dealer websites, classifieds, and marketplaces. VIN decoding. Pricing analytics.

**Strengths:** Good listing coverage (~5M active listings claimed). Clean API design. Self-serve access. Reasonable pricing. Active development.

**Weaknesses:** Listing data only — no auction results, no transaction history, no sold prices. No provenance tracking. No classic/enthusiast focus. Aggregation without confidence scoring.

**Pricing:** From $99/mo (5K requests) to $999/mo (100K requests). Enterprise custom.

**Gap Nuke fills:** Sold prices, auction data, confidence scoring, provenance, classic coverage.

## 4.6 Hagerty

**What they offer:** Hagerty Valuation Tools (HVT) — the de facto pricing guide for collector vehicles. Insurance-focused. Some API access for partners. Market trend reports.

**Strengths:** Best brand in classic/collector segment. Extensive editorial expertise. Good condition-adjusted valuations for classics. Large insured vehicle dataset.

**Weaknesses:** Editorial valuations (expert opinion, not transaction data). Slow update cycles. Limited API access (partner-only). No real-time auction data despite owning auction platforms. No cross-platform aggregation. No source attribution — just a number.

**Pricing:** Partner API access by agreement. Consumer access via website/app.

**Gap Nuke fills:** Transaction-based valuations instead of editorial, cross-platform auction aggregation, source attribution, real-time updates.

## 4.7 Classic.com

**What they offer:** Auction result aggregation for classic and collector vehicles. Price history charts. Market analytics.

**Strengths:** Good historical auction result coverage. Clean UI. Growing dataset. Some API access.

**Weaknesses:** Aggregation only — limited original data extraction. No observation model. No confidence scoring. No classified/marketplace data. API is limited.

**Pricing:** Subscription-based consumer product. API pricing not publicly documented.

**Gap Nuke fills:** Broader source coverage (classifieds, marketplaces, not just auctions), observation model, confidence scoring, richer data per vehicle.

## 4.8 Drivly

**What they offer:** "The Stripe for Car Buying" — APIs for VIN decode, vehicle data, pricing, and automotive commerce workflows.

**Strengths:** Developer-friendly positioning. Modern API design. Multi-endpoint approach (similar to what Nuke should do). Good marketing.

**Weaknesses:** Thin data layer — largely aggregating from other providers (NHTSA, etc.) rather than original sourcing. No auction data. No observation model. No classic coverage. Limited proven scale.

**Pricing:** Self-serve, usage-based. Approx $0.05-$0.15 per API call depending on endpoint.

**Gap Nuke fills:** Original source data instead of re-aggregation, auction depth, classic coverage, provenance.

## 4.9 CarFax / AutoCheck

**What they offer:** Vehicle history reports — accident history, title events, odometer readings, service records.

**Strengths:** Massive brand (CarFax). Deep DMV/insurance/service data partnerships. Near-universal adoption in dealer transactions.

**Weaknesses:** History-focused, not valuation-focused. No pricing data. No auction data. No market analytics. API access is expensive and restricted. Per-report pricing ($40+ consumer).

**Gap Nuke fills:** Different product category — Nuke is complementary, not competitive. Could integrate CarFax data as another observation source.

---

\newpage

# 5. Where Everyone Else Falls Short

Every incumbent automotive data provider shares the same structural weakness: **they don't show their work.**

When KBB says a 2015 Ford F-150 is worth $28,500, you get a number. You don't get:
- Which transactions informed that number
- How recent those transactions are
- Whether the comparable vehicles were actually comparable (same trim, same condition, same region)
- How confident the provider is in the estimate
- What the spread of actual transaction prices looks like

When Hagerty says a 1970 Chevelle SS 396 in Condition 2 is worth $78,000, you get an editorial opinion. You don't get:
- The actual auction results that inform it
- The asking prices on current marketplace listings
- The sentiment from auction comment sections
- Whether that number was updated last week or last quarter
- How many actual sales that estimate is based on

**This opacity was acceptable when the consumer was a human making a judgment call.** A dealer glancing at KBB to set a trade-in value can apply their own experience and intuition.

**It is unacceptable when the consumer is an algorithm.** A lending model, an insurance underwriting engine, a dealer pricing optimizer, an investment fund — these consumers need:

1. **Raw transaction data** to feed their own models
2. **Source attribution** for regulatory compliance and audit
3. **Confidence intervals** to calibrate risk
4. **Real-time updates** to avoid stale pricing
5. **Coverage of the full market** — not just new/near-new or just classics

No existing provider delivers all five. Nuke does.

---

\newpage

# 6. What Nuke Has Built

## 6.1 The Platform

Nuke is a full-stack automotive data platform consisting of:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Data Pipeline | 312 Supabase Edge Functions (Deno/TypeScript) | Extraction, processing, enrichment |
| Database | PostgreSQL via Supabase | 687 migrations, RLS-secured |
| Backend API | Elixir/Phoenix | RESTful endpoints, rate limiting |
| Frontend | React + Vite | Consumer interface (nuke.ag) |
| SDK | TypeScript (@nuke/sdk) | Developer client library |
| Mobile | Nuke Scanner, Nuke Desktop | Field data collection |
| Sub-product | DealerScan | Dealer document OCR |
| AI Layer | Claude, GPT, Gemini, Ollama | Extraction, analysis, sentiment |
| MCP Server | Model Context Protocol | AI-native data access |

## 6.2 What Makes It Different from a Scraper

Many startups have built automotive scrapers. Nuke is not a scraper — it is a **data platform with an observation-based architecture**. The distinction matters:

**A scraper** collects listing data, stores it in a table, and serves it. When the listing changes, the old data is overwritten. There is no history, no provenance, no confidence model.

**Nuke's observation model** treats every piece of information as a discrete event:
- An observation is created when data is extracted from a source
- The observation is immutable — it is never modified after creation
- Multiple observations about the same vehicle create a timeline
- Conflicting observations are not resolved by overwriting — they coexist with different confidence scores
- The consumer (human or algorithm) can see all observations and decide which to trust

This is the difference between a database and a ledger. Nuke is a ledger.

---

\newpage

# 7. The Data Advantage

## 7.1 Breadth of Sources

Nuke ingests data from 25+ platforms across four categories:

### Auction Houses (15 platforms)
| Platform | Coverage | Data Depth |
|----------|----------|-----------|
| Bring a Trailer | 132,630 listings, 11M+ comments | Full: bids, comments, sentiment, images |
| Cars & Bids | Active extraction | Listings, bids, comments |
| RM Sotheby's | Active extraction | Results, lot details |
| Mecum | Active extraction | Results, lot details |
| Barrett-Jackson | Active extraction | Results, lot details |
| Bonhams | Active extraction | Results, lot details |
| Gooding & Company | Active extraction | Results, lot details |
| Historics UK | Active extraction | Results, lot details |
| GAA Classics | Active extraction | Results, lot details |
| PCarMarket | Active extraction | Listings, results |
| Collecting Cars | Active extraction | Listings, results |
| VictoryLap | Active extraction | Listings, results |
| BH Auction | Active extraction | Results |
| Hagerty Marketplace | Active extraction | Listings, valuations |
| eBay Motors | Active extraction | Listings, sold items |

### Classifieds & Marketplaces (8+ platforms)
| Platform | Coverage | Data Depth |
|----------|----------|-----------|
| Facebook Marketplace | 5 dedicated functions | Listings, seller profiles, pricing |
| Craigslist | 3 dedicated functions | Listings, regional coverage |
| KSL Classifieds | Daily scraping | Listings, pricing |
| ClassicCars.com | Active extraction | Listings, dealer inventory |
| Blocket (Sweden) | Active extraction | International listings |
| Leboncoin (France) | Active extraction | International listings |
| TheSamba | Active extraction | VW/Porsche specialist |
| Barn Finds | Active extraction | Discovery/project vehicles |

### Reference & Enrichment
| Source | Data Type |
|--------|----------|
| NHTSA VIN Decoder | Factory specifications, recalls |
| Hagerty Valuation | Editorial price guides |
| Wayback Machine | Historical listings recovery |
| Forum build threads | Owner modification history |
| Service manuals | Technical specifications |
| Parts catalogs | Component identification |

### Community & Social
| Platform | Data Type |
|----------|----------|
| Instagram | Dealer/builder profiles |
| Twitter/X | Market sentiment |
| Telegram | Work intake, technician coordination |
| Forums (Rennlist, etc.) | Build threads, owner history |

## 7.2 Depth of Data Per Vehicle

For a well-covered vehicle, Nuke can provide:

| Data Category | Fields | Source |
|---------------|--------|--------|
| **Identity** | VIN, year, make, model, trim, body style | VIN decode + observations |
| **Specifications** | Engine, transmission, drivetrain, color, interior | VIN decode + listing data |
| **Images** | Exterior, interior, engine, undercarriage, detail | Listings (avg 37 images/vehicle) |
| **Pricing History** | Every asking price, bid, hammer price, time-series | Multi-platform observations |
| **Market Position** | Current value, confidence interval, trend, comps | Valuation engine |
| **Auction Intelligence** | Bid curves, comment sentiment, reserve status, watchers | Real-time tracking |
| **Listing History** | Every listing across all platforms, days on market | Cross-platform dedup |
| **Condition Signals** | Description analysis, photo assessment, owner claims | AI extraction |
| **Provenance** | Source URL, extraction timestamp, confidence score | Observation model |
| **Rarity** | Production numbers, survival estimates, collector demand | Production data + analytics |

**Average images per vehicle: 37.** Compare this to any competitor API that might return 3-5 stock photos.

---

\newpage

# 8. Platform Metrics — Current State

## 8.1 Database Scale

| Metric | Value | Notes |
|--------|-------|-------|
| Total Vehicles | **812,913** | Growing ~22K/day |
| Total Images | **30,373,552** | ~37 per vehicle average |
| Total Observations | **617,385** | New observation system |
| Legacy Auction Comments | **11,095,537** | BaT historical data |
| Computed Valuations | **507,071** | 62.4% coverage |
| BaT Identity Seeds | **497,845** | Unique user profiles |
| Organizations | **2,553** | Dealers, shops, builders |
| Active Sources | **517** | Registered extraction sources |
| BaT Listings Indexed | **132,630** | With full comment data |
| AI Analyses Complete | **127,166** | Comment + description analysis |

## 8.2 Pipeline Throughput

| Metric | Value |
|--------|-------|
| Vehicles created (last 24h) | **22,775** |
| Import queue — pending | 30,118 |
| Import queue — processing | 92 |
| Import queue — complete | 163,836 |
| Import queue — failed | 1,117 (0.57% failure rate) |
| GitHub Actions workflows | 32 automated pipelines |
| Edge functions (active) | 312 |
| Edge functions (archived) | 264 |

## 8.3 Data Quality

| Metric | Value |
|--------|-------|
| Valuation coverage | 62.4% of all vehicles |
| Content deduplication | SHA-256 hash on every observation |
| Vehicle deduplication | VIN + year/make/model matching |
| Org deduplication | Name/website/phone normalization + Jaccard similarity |
| Field-level sourcing | Every field edit tracked with source + confidence |
| Confidence scoring | 4-tier: verified (>=0.95), high (>=0.85), medium (>=0.40), low (<0.40) |

## 8.4 Growth Trajectory

At current ingestion rates:
- **22,775 vehicles/day** = ~683K vehicles/month
- Targeting 1M vehicles within weeks
- At steady state, ~8.2M vehicles/year gross ingest (before dedup)
- Observation volume growing as new sources are onboarded

---

\newpage

# 9. The Observation Model

## 9.1 Architecture

The observation model is the technical foundation of Nuke's data advantage. It consists of four tables:

### observation_sources
The registry of all data sources. Each source has:
- `slug` — unique identifier (e.g., `bring_a_trailer`, `facebook_marketplace`)
- `source_category` — auction, forum, social_media, marketplace, registry, shop, owner, documentation
- `base_trust_score` — baseline confidence for this source (e.g., BaT = 0.75)
- `supported_observations` — array of observation kinds this source can produce

### vehicle_observations
The core event store. Each observation is:
- `vehicle_id` — resolved vehicle reference
- `source_slug` — which source produced this observation
- `kind` — what type: comment, bid, listing, mileage_reading, sale_result, condition_report
- `structured_data` — JSONB payload with type-specific fields
- `content_text` — raw text content
- `content_hash` — SHA-256 for deduplication
- `confidence_score` — computed trust score
- `confidence_factors` — breakdown of how confidence was calculated
- `observed_at` — when the observation was made (not when it was ingested)
- `source_url` — link back to original source

### observation_extractors
Configuration for how to extract observations from each source. Defines extraction strategies, field mappings, and processing rules.

### observation_discoveries
AI-derived insights from observations. When the system analyzes a set of observations, discoveries are generated — trend identification, anomaly detection, condition assessment.

## 9.2 Confidence Calculation

Every observation's confidence score is computed as:

```
confidence = base_trust_score(source)
           + 0.10 if vehicle_match_confidence >= 0.95
           + 0.05 if source_url is present
           + 0.05 if content_text > 100 characters
           [capped at 1.0]
```

Vehicle match confidence varies by resolution method:
- VIN match: 0.99
- URL match (via external_listings): 0.95
- Fuzzy year/make match: 0.60

Confidence levels:
- **Verified** (>= 0.95): VIN-decoded or multi-source corroborated
- **High** (>= 0.85): Strong single-source with URL attribution
- **Medium** (>= 0.40): Reasonable but uncorroborated
- **Low** (< 0.40): Uncertain source or weak match

## 9.3 Why This Matters

Traditional data providers merge conflicting data and present a single "answer." This destroys information. When KBB says a car is worth $28,500, you can't tell whether that's based on 50 comparable transactions or 2. You can't tell if the transactions are from last week or last quarter. You can't tell if they included the exact trim and options package.

With Nuke's observation model, the API consumer gets:
1. **Every observation** — not a summary, the raw signals
2. **Source attribution** — where each signal came from
3. **Confidence scoring** — how much to trust each signal
4. **Temporal ordering** — the full history, not a point-in-time snapshot

This lets sophisticated consumers (lenders, insurers, funds) build their own models on top of Nuke's observations. They don't need our valuation engine — though we offer one — they need our observations as training data, ground truth, and real-time signal.

---

\newpage

# 10. Confidence & Provenance — The Real Product

## 10.1 Field-Level Source Tracking

Nuke tracks provenance at the individual field level via the `vehicle_field_sources` table:

| Column | Purpose |
|--------|---------|
| `vehicle_id` | Which vehicle |
| `field_name` | Which field (year, make, model, sale_price, etc.) |
| `field_value` | The value |
| `source_type` | How it was obtained: user_input, auction_extraction, ai_extraction, vin_decode |
| `source_url` | Original source URL |
| `confidence_score` | 0-100 confidence in this value |
| `user_id` | Who provided it (if manual) |
| `verified_by` | Who verified it |
| `verified_at` | When it was verified |

Every field edit creates an entry in this table and a corresponding `timeline_event`, maintaining a complete audit trail.

**This is what "drills down to the source" means in practice.** When a Nuke API response says `year: 1970, year_confidence: 9, year_source: "vin_decode"`, the consumer knows exactly where that data came from and how much to trust it.

## 10.2 The Provenance Advantage

No other automotive data API exposes this level of transparency. The implications:

**For lenders:** "We valued this vehicle at $45,000 based on 23 comparable transactions from 3 platforms over the last 90 days, with a confidence score of 8.2/10." This is auditable. This satisfies examiners.

**For insurers:** "The replacement value is $52,000-$68,000 based on recent auction results for this make/model/year in Condition 2-3, sourced from BaT and RM Sotheby's." This is defensible.

**For dealers:** "This vehicle is priced 12% below market based on 7 comparable sales. The last similar vehicle on BaT sold for $38,500 with 34 bids." This is actionable.

**For AI/ML teams:** "Here are 500,000 labeled vehicle sale observations with source, timestamp, confidence, and 37 images per vehicle." This is training data.

---

\newpage

# 11. The Valuation Engine

## 11.1 Architecture

Nuke's valuation engine (`compute-vehicle-valuation`) is a multi-signal weighted model. Unlike editorial valuations (Hagerty, KBB), it is computed from observed transaction data.

### Signal Weights by Price Tier

The engine adapts its methodology based on the vehicle's price tier, recognizing that different factors matter at different price points:

| Signal | Budget (<$15K) | Mainstream (<$50K) | Enthusiast (<$150K) | Collector (<$500K) | Trophy ($500K+) |
|--------|-------|------------|------------|-----------|--------|
| Comparables | 0.45 | 0.40 | 0.30 | 0.25 | 0.20 |
| Condition | 0.18 | 0.15 | 0.12 | 0.10 | 0.08 |
| Rarity | 0.02 | 0.05 | 0.10 | 0.15 | 0.18 |
| Sentiment | 0.05 | 0.08 | 0.12 | 0.13 | 0.12 |
| Bid Curve | 0.10 | 0.10 | 0.08 | 0.05 | 0.04 |
| Market Trend | 0.10 | 0.10 | 0.08 | 0.07 | 0.06 |
| Survival Rate | 0.02 | 0.04 | 0.08 | 0.10 | 0.12 |
| Originality | 0.08 | 0.08 | 0.12 | 0.15 | 0.20 |

**Key insight:** For budget/mainstream vehicles, comparables dominate (they're common, data is abundant). For collector/trophy vehicles, rarity, originality, and survival rate matter more — and Nuke accounts for this automatically.

### Confidence Intervals

| Price Tier | Confidence Interval |
|-----------|-------------------|
| Budget | ±8% |
| Mainstream | ±12% |
| Enthusiast | ±18% |
| Collector | ±25% |
| Trophy | ±35% |

Wider intervals at higher price points reflect the reality that trophy vehicles are unique — each one is a market of one.

## 11.2 Deal Score

Every listed vehicle gets a deal score indicating whether it's priced above or below market:

```
deal_score = ((estimated_value - asking_price) / estimated_value) × freshness_decay
```

Freshness decay ensures that old listings are penalized:
- <24 hours: 100% weight
- 1-7 days: 90%
- 7-14 days: 70%
- 14-30 days: 50%
- >30 days: 30%

Labels range from `plus_3` (exceptional deal) through `fair` to `minus_3` (significantly overpriced).

## 11.3 Heat Score

A 0-100 composite measuring current market interest:

| Factor | Points |
|--------|--------|
| Active auction | +30 |
| Recent sale (<7 days) | +25 |
| Strong deal score | +15 |
| High bid velocity | +10 |
| Community buzz (comments) | +10 |
| Ultra-rare vehicle | +10 |
| New listing (<48h) | +5 |

Labels: cold / warm / hot / fire / volcanic

## 11.4 Record Proximity Effect

When a vehicle's estimated value approaches the record price for its segment, the engine automatically widens the confidence interval. This prevents false precision at the edge of known data and signals to consumers that they're in uncharted territory.

---

\newpage

# 12. Source Coverage

## 12.1 Platform Integration Matrix

| Platform | Listings | Sold Prices | Images | Comments | Bids | Sentiment | Seller Data |
|----------|---------|------------|--------|----------|------|-----------|-------------|
| Bring a Trailer | Yes | Yes | Yes | Yes (11M+) | Yes | Yes | Yes |
| Cars & Bids | Yes | Yes | Yes | Yes | Yes | Yes | Partial |
| RM Sotheby's | Yes | Yes | Yes | No | No | No | No |
| Mecum | Yes | Yes | Yes | No | No | No | No |
| Barrett-Jackson | Yes | Yes | Yes | No | No | No | No |
| Bonhams | Yes | Yes | Yes | No | No | No | No |
| Gooding | Yes | Yes | Yes | No | No | No | No |
| eBay Motors | Yes | Yes | Yes | No | No | No | Yes |
| Facebook Marketplace | Yes | No | Yes | No | No | No | Yes |
| Craigslist | Yes | No | Yes | No | No | No | Partial |
| Hagerty | Yes | Partial | Yes | No | No | No | No |
| Collecting Cars | Yes | Yes | Yes | No | No | No | No |
| PCarMarket | Yes | Yes | Yes | No | No | No | No |

## 12.2 Coverage by Vehicle Segment

| Segment | Estimated Market Size | Nuke Coverage | Primary Sources |
|---------|----------------------|---------------|----------------|
| Classic American (pre-1975) | ~2M vehicles | Strong | BaT, Mecum, Barrett-Jackson, Craigslist |
| European Sports/GT | ~500K vehicles | Strong | BaT, RM Sotheby's, Bonhams, Collecting Cars |
| Japanese Classics | ~300K vehicles | Moderate | BaT, C&B, Facebook, forums |
| Trucks & SUVs | ~5M vehicles | Growing | BaT, Craigslist, Facebook, KSL |
| Modern Performance | ~2M vehicles | Moderate | C&B, eBay, Facebook |
| Exotics/Supercars | ~200K vehicles | Moderate | RM Sotheby's, Bonhams, Gooding |
| Barn Finds/Projects | ~1M vehicles | Growing | Barn Finds, Craigslist, Facebook |

## 12.3 International Coverage

| Region | Sources | Status |
|--------|---------|--------|
| North America | 20+ platforms | Primary focus |
| United Kingdom | Historics UK, Bonhams | Active |
| France | Leboncoin | Active |
| Sweden | Blocket | Active |
| Rest of Europe | Collecting Cars, RM Sotheby's EU | Partial |
| Asia/Pacific | Limited | Future |

---

\newpage

# 13. Pipeline & Ingestion Architecture

## 13.1 Data Flow

```
[External Sources]
    ↓
[Source-Specific Extractors] (59 dedicated functions)
    ↓
[Observation Intake] (ingest-observation)
    ↓ SHA-256 dedup check
    ↓ Vehicle resolution (VIN → URL → fuzzy)
    ↓ Confidence scoring
    ↓
[vehicle_observations] ← immutable event store
    ↓
[Vehicle Enrichment]
    ├── VIN decode → specs population
    ├── Image analysis → categorization, quality scoring
    ├── Comment analysis → sentiment, themes
    ├── Valuation compute → estimates, deal scores, heat
    └── Discovery engine → AI insights
    ↓
[vehicles] ← current-state materialized view
    ↓
[API Layer] → consumers
```

## 13.2 Extraction Methods

| Method | Technology | Use Case | Functions |
|--------|-----------|----------|-----------|
| HTTP Scraping | Deno fetch + cheerio | Simple listing pages | ~30 extractors |
| Browser Automation | Playwright | JavaScript-heavy sites, anti-bot | ~10 extractors |
| AI Extraction | Claude/GPT + raw HTML | Unstructured/novel layouts | 3 generic extractors |
| Local LLM | Ollama | Cost-sensitive extraction | 1 extractor |
| Firecrawl | API-based scraping service | Rate-limited or complex sites | ~5 extractors |
| Feed Polling | RSS/API monitoring | Continuous monitoring | 1 orchestrator |

## 13.3 Orchestration

| System | Purpose |
|--------|---------|
| Ralph Wiggum Coordinator | System health monitoring, queue management, failure routing |
| Agent Orchestrator | Multi-agent task coordination |
| Pipeline Orchestrator (GHA) | Scheduled extraction across all sources |
| Crawler Scheduler | Adaptive crawling based on source update frequency |
| Continuous Queue Processor | Background processing of import queue |

## 13.4 Resilience

- **Retry logic**: Exponential backoff on extraction failures
- **Circuit breaker**: Per-domain failure tracking (e.g., Barrett-Jackson: 250 failures → paused)
- **Dedup protection**: Content hashing prevents duplicate ingestion even on re-crawl
- **Queue persistence**: All jobs tracked in `import_queue` with status lifecycle
- **Failure rate**: 0.57% (1,117 failed / 195,071 total)

---

\newpage

# 14. Current API Surface

## 14.1 Production Endpoints

### Core Vehicle API
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api-v1-vehicles` | GET | JWT/API Key | List vehicles with pagination |
| `/api-v1-vehicles/{id}` | GET | JWT/API Key | Get single vehicle |
| `/api-v1-vehicles` | POST | JWT/API Key | Create vehicle |
| `/api-v1-vehicles/{id}` | PATCH | JWT/API Key | Update vehicle |
| `/api-v1-vehicles/{id}` | DELETE | JWT/API Key | Archive vehicle |

### Observations API
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api-v1-observations` | GET | JWT/API Key | List observations (filter by vehicle_id, vin, kind) |
| `/api-v1-observations` | POST | JWT/API Key | Create observation (auto-resolves VIN) |

### Batch API
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api-v1-batch` | POST | JWT/API Key | Bulk import (1000 vehicles, 100 obs/vehicle) |

### Search
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/universal-search` | POST | Optional | Smart search (VIN, URL, text detection) |
| `/search` | POST | Optional | Advanced FTS + fuzzy search |

### API Management
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api-keys-manage` | GET/POST/DELETE | JWT only | API key lifecycle |
| `/webhooks-manage` | GET/POST/PATCH/DELETE | JWT/API Key | Webhook CRUD + secret rotation |

### Platform
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/db-stats` | GET | Service role | Database statistics |
| `/platform-status` | GET | None | Platform configuration |

## 14.2 Authentication

Two methods, both supported on all core endpoints:

**JWT Bearer Token**: Standard Supabase JWT (HS256, 1hr expiry)
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**API Key**: Prefixed key, SHA-256 hashed for storage
```
X-API-Key: nk_live_a1b2c3d4e5f6g7h8...
```

## 14.3 OpenAPI Specification

A complete OpenAPI 3.0.3 specification exists at `/docs/api/openapi.yaml` (981 lines), covering vehicles, observations, batch, and webhooks endpoints. This is ready for documentation generation.

## 14.4 What's Not Yet Exposed

The following data exists in the database but has no public API endpoint:

| Data | Table | Current Access |
|------|-------|---------------|
| Auction results & bid history | external_listings | Internal only |
| Market valuations | nuke_estimates | Internal only |
| Market comparables | Computed on demand | Internal only |
| Market trends & indexes | Computed on demand | Internal only |
| Production/rarity data | vehicle_production_data | Internal only |
| Dealer/org profiles | businesses | Internal only |
| Dealer inventory | business_vehicle_fleet | Internal only |
| Auction comments & sentiment | auction_comments + analysis | Internal only |
| Image analysis results | vehicle_images metadata | Internal only |

**This is the single biggest gap.** Nuke's strongest data is locked behind internal functions.

---

\newpage

# 15. The SDK

## 15.1 Current State

Package: `@nuke/sdk` v1.0.0
Runtime: Node.js 18+
Build: tsup (CJS + ESM + DTS)

```typescript
import Nuke from '@nuke/sdk';

const nuke = new Nuke('nk_live_...');

// Vehicles
const vehicle = await nuke.vehicles.create({ year: 1970, make: 'Porsche', model: '911S' });
const vehicles = await nuke.vehicles.list({ page: 1, limit: 25 });
const all = nuke.vehicles.listAll(); // async generator, auto-pagination

// Observations
const obs = await nuke.observations.create({
  vehicle_id: '...',
  source_type: 'manual',
  data_type: 'price',
  value: '45000',
});

// Batch
const result = await nuke.batch.ingest({
  vehicles: [...],
  options: { match_by: 'vin', skip_duplicates: true }
});

// Webhooks
const hook = await nuke.webhooks.create({
  url: 'https://...',
  events: ['vehicle.created', 'observation.created']
});

// Webhook signature verification (Stripe-compatible)
const event = nuke.webhooks.constructEvent(payload, signature, secret);
```

## 15.2 Error Hierarchy

```
NukeError
├── NukeAPIError (base for all API errors)
│   ├── NukeAuthenticationError (401)
│   ├── NukeRateLimitError (429)
│   ├── NukeValidationError (400)
│   └── NukeNotFoundError (404)
```

## 15.3 Design Patterns

The SDK follows Stripe/Plaid conventions:
- Resource namespaces (`nuke.vehicles`, `nuke.observations`)
- `listAll()` async generators for auto-pagination
- Webhook signature verification with timing-safe comparison
- Batch ingestion with chunking and progress callbacks
- Typed responses with full TypeScript definitions

## 15.4 What's Missing

- **Not published to npm** — exists in `tools/nuke-sdk/` but not released
- **No valuation endpoints** — because the API doesn't expose them yet
- **No market data endpoints** — same reason
- **No auction data endpoints** — same
- **No documentation site** — no hosted docs

---

\newpage

# 16. Webhooks & Event System

## 16.1 Current Implementation

Nuke has a production-ready webhook system modeled on Stripe's:

**Supported Events:**
- `vehicle.created`
- `vehicle.updated`
- `vehicle.deleted`
- `observation.created`
- `document.uploaded`
- `import.completed`
- `*` (wildcard)

**Security:**
- Secrets: `whsec_<64-hex-chars>` (shown once on creation)
- Signatures: HMAC-SHA256 in format `t={timestamp},v1={signature}`
- Dual headers: `Nuke-Signature` and `Stripe-Signature` for interop
- Secret rotation support

**Reliability:**
- Exponential backoff: 1min, 5min, 30min, 2hr, 8hr (max 5 retries)
- Delivery tracking in `webhook_deliveries` table
- Per-endpoint delivery stats (total/failed)
- Scheduler-callable retry for failed deliveries

## 16.2 What Should Be Added

For an API-first business, the webhook system needs more events:

| Event Category | Events Needed |
|----------------|--------------|
| Valuation | `valuation.computed`, `valuation.changed`, `deal_score.changed` |
| Auction | `auction.started`, `auction.bid_placed`, `auction.ending_soon`, `auction.completed` |
| Market | `market.trend_alert`, `market.record_price` |
| Listing | `listing.appeared`, `listing.price_changed`, `listing.sold`, `listing.expired` |

These events represent the real-time data streams that premium API consumers will pay the most for.

---

\newpage

# 17. The Target API Surface

## 17.1 Proposed Endpoint Structure

```
# Vehicle Data
GET  /v1/vehicles/{vin}                    → Identity, specs, images, current status
GET  /v1/vehicles/{vin}/history            → Full observation timeline
GET  /v1/vehicles/{vin}/images             → All images with categories and metadata
GET  /v1/vehicles/{vin}/valuations         → Current value, confidence, range, comps
GET  /v1/vehicles/{vin}/listings           → All listings (active + historical, cross-platform)
GET  /v1/vehicles/{vin}/auction            → Auction results, bids, comments, sentiment
GET  /v1/vehicles/{vin}/similar            → Similar vehicles currently available

# Market Data
GET  /v1/market/comps                      → Comparable sales (filter by make/model/year/condition)
GET  /v1/market/trends                     → Price trends, volume, days-on-market
GET  /v1/market/indexes                    → Segment indexes (muscle, JDM, euro, exotic, truck)
GET  /v1/market/records                    → Record sales by segment
GET  /v1/market/alerts                     → Subscribe to market conditions

# Search & Discovery
GET  /v1/search                            → Unified search (VIN, text, filters)
GET  /v1/discover                          → Recommendation engine (similar to, trending, undervalued)
GET  /v1/feed                              → Chronological feed of new observations

# Dealer / Organization Data
GET  /v1/dealers/{id}                      → Dealer profile, reputation, capabilities
GET  /v1/dealers/{id}/inventory            → Current stock
GET  /v1/dealers/search                    → Find dealers by location, specialty, rating

# Data Ingestion
POST /v1/vehicles                          → Create vehicle
POST /v1/observations                      → Submit observation
POST /v1/batch                             → Bulk import

# Management
POST /v1/auth/keys                         → Create API key
GET  /v1/auth/keys                         → List API keys
POST /v1/webhooks                          → Create webhook
GET  /v1/usage                             → Current usage and quota
```

## 17.2 Design Principles

1. **VIN-first routing.** The VIN is the natural primary key for the automotive industry. Every vehicle endpoint should accept a VIN as the identifier.

2. **Every field carries provenance.** No response should contain a value without a corresponding source and confidence indicator.

3. **Observations are first-class.** The `/history` endpoint returns raw observations, not a summary. Consumers can filter by source, kind, date range, and confidence level.

4. **Market data is derived, not editorial.** Every market endpoint should link back to the observations that inform it.

5. **Real-time over periodic.** Auction data should be live. Valuations should update when new observations arrive, not on a schedule.

---

\newpage

# 18. API Design Philosophy

## 18.1 Learning from the Best

The APIs that developers love — Stripe, Twilio, Plaid — share common traits:

**Stripe:**
- Consistent resource patterns (CRUD on everything)
- Exhaustive documentation with examples in every language
- Webhook-first architecture for async events
- Idempotency keys for safe retries
- Rich error objects with actionable messages

**Twilio:**
- Every resource has a unique SID
- Pagination via next_page_uri (cursor-based)
- Versioned URLs (2010-04-01 is still supported)
- Subresources (Calls → Recordings → Transcriptions)

**Plaid:**
- Clean mental model (Link → Access Token → Data)
- Sandbox environment with predictable test data
- Error codes that tell you exactly what went wrong
- Webhooks for async data availability

## 18.2 Nuke API Principles

**1. Source-attributed responses.** Every value in every response includes provenance metadata. This is not optional or an add-on — it's the core product.

**2. Confidence as a first-class concept.** Confidence scores appear at the field level, the observation level, and the valuation level. API consumers can filter by minimum confidence.

**3. Temporal queries.** Every endpoint supports `as_of` parameters for point-in-time queries. "What did we know about this vehicle on January 15?" is a valid query.

**4. Cursor-based pagination.** No offset/limit — use cursors for stable, performant pagination across large datasets.

**5. Consistent error taxonomy.**
```json
{
  "error": {
    "type": "invalid_request",
    "code": "vehicle_not_found",
    "message": "No vehicle found with VIN 1GCEK19K5RE123456",
    "param": "vin",
    "doc_url": "https://docs.nuke.ag/errors/vehicle_not_found"
  }
}
```

**6. Idempotency.** All POST endpoints accept an `Idempotency-Key` header for safe retries.

**7. Versioning.** URL-based versioning (`/v1/`, `/v2/`) with minimum 24-month deprecation windows.

---

\newpage

# 19. Developer Experience Roadmap

## 19.1 Documentation

| Component | Status | Priority |
|-----------|--------|----------|
| OpenAPI 3.0 spec | Exists (981 lines) | Ship as-is, expand |
| Interactive API reference | Not built | P0 — needed for launch |
| Getting Started guide | Not written | P0 |
| Authentication guide | Not written | P0 |
| Webhook integration guide | Not written | P1 |
| SDK documentation | Not written | P1 |
| Example applications | Not built | P2 |
| Changelog | Not started | P1 |
| Status page | Not built | P1 |

## 19.2 Developer Portal

Components needed:
- **Dashboard**: API key management, usage metrics, billing
- **API Reference**: Auto-generated from OpenAPI spec (Stoplight, Redocly, or custom)
- **Sandbox**: Test environment with seeded data
- **Playground**: Interactive API explorer (try before you sign up)
- **Webhook Testing**: Webhook delivery logs and replay

## 19.3 SDK Expansion

| SDK | Status | Priority |
|-----|--------|----------|
| TypeScript/Node.js | Built, unpublished | P0 — publish to npm |
| Python | Not built | P1 — ML/data science audience |
| Go | Not built | P2 — infrastructure/backend audience |
| REST (curl examples) | In OpenAPI spec | P0 — include in docs |

## 19.4 MCP Server

Nuke already has an MCP (Model Context Protocol) server, positioning it as an AI-native data source. This is forward-looking — as AI agents become primary API consumers, having an MCP integration means Nuke data is available in Claude, Cursor, and other LLM-powered tools without custom integration.

---

\newpage

# 20. Pricing Strategy

## 20.1 Current Pricing

| Product | Price | Unit |
|---------|-------|------|
| API Access (monthly) | $29.99/mo | 1,000 image analyses |
| Prepaid 100 | $4.99 | 100 analyses |
| Prepaid 500 | $19.99 | 500 analyses |
| Prepaid 1,000 | $34.99 | 1,000 analyses |
| DealerScan 100 | $20.00 | 100 document extractions |
| DealerScan 500 | $90.00 | 500 extractions |
| DealerScan 1,000 | $160.00 | 1,000 extractions |

**Problem:** This pricing is product-feature-based (image analysis, document extraction), not data-access-based. For an API-first positioning, the pricing model needs to reflect data consumption.

## 20.2 Proposed Pricing Model

### Tier Structure

| Tier | Monthly Price | Included | Overage | Target Customer |
|------|-------------|----------|---------|----------------|
| **Build** | Free | 500 VIN lookups, 100 observations | — | Hobbyists, evaluation |
| **Startup** | $149/mo | 5,000 VIN lookups, 1,000 observations, basic market data | $0.05/lookup | Early-stage apps |
| **Scale** | $499/mo | 25,000 VIN lookups, 10,000 observations, full market data, webhooks | $0.03/lookup | Growing businesses |
| **Pro** | $1,499/mo | 100,000 VIN lookups, unlimited observations, real-time auction feed, priority support | $0.02/lookup | Dealers, lenders |
| **Enterprise** | Custom | Unlimited, firehose access, SLA, dedicated support, custom endpoints | Negotiated | Insurers, funds, OEMs |

### Premium Add-Ons

| Add-On | Price | Description |
|--------|-------|-------------|
| Real-time auction feed | $299/mo | Live bid updates, soft-close alerts |
| Sentiment analysis | $199/mo | Comment-derived sentiment on auctions |
| Bulk historical export | $0.01/record | One-time data pulls for model training |
| Dedicated IP / VPN peering | $500/mo | Enterprise network integration |

### Rationale

1. **VIN lookup as the unit of value.** A VIN lookup is the atomic action — it's how customers think about their usage. Everything else (observations, valuations, history) is delivered as part of the VIN response.

2. **Free tier for adoption.** 500 lookups/month is enough to build a prototype, not enough to run a business. This drives self-serve signups.

3. **Market data as a tier gate.** Basic VIN data is available at all tiers. Market comps, trends, and indexes unlock at Scale and above. This creates natural upsell pressure.

4. **Real-time as premium.** The auction firehose is the highest-value, highest-cost data stream. It's priced as an add-on to avoid forcing it on customers who don't need it.

## 20.3 Competitive Pricing Context

| Competitor | Pricing | Unit |
|-----------|---------|------|
| MarketCheck | $99-$999/mo | 5K-100K requests |
| Black Book | $30K-$200K/yr | Enterprise contract |
| KBB API | $50K-$500K/yr | Enterprise contract |
| J.D. Power | Custom enterprise | Bundled |
| Drivly | ~$0.05-$0.15/call | Per-call |
| CarFax (history) | ~$40/report | Per-report |
| Edmunds | Free-custom | Per-call |

Nuke's proposed pricing is competitive with MarketCheck at the low end and dramatically cheaper than KBB/Black Book at the enterprise level — while offering data that neither provides (auction results, provenance, confidence scoring).

---

\newpage

# 21. Customer Segments

## 21.1 Primary Segments

### Segment 1: Dealer Tools & DMS Platforms
**Who:** Companies building dealer management systems, pricing tools, inventory management, and CRM platforms.
**What they need:** Real-time market pricing, comparable sales, competitive inventory analysis, automated appraisal tools.
**Why Nuke:** Transaction-based pricing (not estimates), cross-platform visibility (see what competitors are listing), real-time data.
**Example use:** Auto-populate trade-in values based on actual comparable sales, alert when a vehicle is priced below market.
**Revenue potential:** $1,000-$10,000/mo per customer. 500+ potential customers in US alone.

### Segment 2: Automotive Lenders & Fintech
**Who:** Banks, credit unions, fintech companies offering auto loans, refinancing, or vehicle-backed lending.
**What they need:** Defensible valuations for loan-to-value calculations, audit trails for regulators, real-time value updates for portfolio monitoring.
**Why Nuke:** Source-attributed valuations satisfy examiner requirements. Confidence intervals enable risk calibration. Transaction data (not guidebook estimates) reduces model risk.
**Example use:** Real-time LTV monitoring on a portfolio of 50,000 auto loans, with alerts when collateral value drops below threshold.
**Revenue potential:** $5,000-$50,000/mo per customer. 200+ potential customers.

### Segment 3: Insurance & Insurtech
**Who:** Specialty vehicle insurers (Hagerty competitors), agreed-value policy providers, claims adjusters.
**What they need:** Accurate replacement values for specialty/classic vehicles, market trend data for portfolio risk, claims validation.
**Why Nuke:** Covers classic/enthusiast vehicles that KBB/Black Book don't. Transaction-based replacement values. Confidence intervals for underwriting models.
**Example use:** Policy issuance with automated agreed-value recommendation based on recent comparable sales.
**Revenue potential:** $5,000-$100,000/mo per customer. 100+ potential customers.

### Segment 4: Marketplace & Auction Platforms
**Who:** Online vehicle marketplaces, auction platforms, classified sites.
**What they need:** Instant pricing guidance for sellers, market comparison for buyers, listing enrichment.
**Why Nuke:** Cross-platform pricing data. Observation history adds value to listings. Market position indicators (deal score) drive buyer engagement.
**Example use:** "This vehicle is priced 8% below similar vehicles on other platforms" displayed on a listing page.
**Revenue potential:** $2,000-$20,000/mo per customer. 50+ potential customers.

### Segment 5: Data Science & AI/ML Teams
**Who:** Teams building valuation models, price prediction, market analysis, or training automotive AI.
**What they need:** Labeled datasets with images, prices, specs, and transaction outcomes. Clean, structured, large-scale data.
**Why Nuke:** 812K vehicles, 30M images, 500K+ valuations with confidence labels, source attribution. This is training data, not an API to call in production — it's the foundation of their models.
**Example use:** Train a vehicle condition assessment model on 30M labeled images with known sale prices.
**Revenue potential:** $10,000-$100,000 per dataset export. 100+ potential customers.

### Segment 6: Investment & Collector Funds
**Who:** Automotive investment funds, fractional ownership platforms, collector vehicle portfolio managers.
**What they need:** Market indexes, trend analysis, comparable transaction data, portfolio valuation.
**Why Nuke:** Segment-level indexes (muscle, JDM, euro, exotic). Record price tracking. Real-time auction monitoring. Historical trend data.
**Example use:** Monthly mark-to-market on a $50M collector vehicle portfolio using Nuke's comparable transaction data.
**Revenue potential:** $10,000-$50,000/mo per customer. 50+ potential customers.

## 21.2 Market Sizing

| Segment | Customers | Avg Revenue | Annual Revenue Potential |
|---------|-----------|-------------|------------------------|
| Dealer Tools | 500 | $5K/mo | $30M |
| Lenders/Fintech | 200 | $15K/mo | $36M |
| Insurance | 100 | $20K/mo | $24M |
| Marketplaces | 50 | $10K/mo | $6M |
| Data Science | 100 | $50K/yr | $5M |
| Investment Funds | 50 | $25K/mo | $15M |
| **Total** | **1,000** | | **$116M ARR potential** |

This is the addressable market at full product maturity. Near-term (12-month) target: 20-50 paying customers, $500K-$2M ARR.

---

\newpage

# 22. Go-to-Market

## 22.1 Phase 1: Developer Adoption (Months 1-3)

**Goal:** 500 free-tier signups, 20 paying customers.

**Actions:**
1. Ship the public API with the target endpoint surface
2. Publish the TypeScript SDK to npm
3. Launch docs site (docs.nuke.ag)
4. Launch on Hacker News ("Show HN: The automotive data API with source provenance on every field")
5. Post on Product Hunt
6. Submit to API directories (RapidAPI, API Layer, ProgrammableWeb)
7. Write technical blog posts:
   - "Why we built an observation model for automotive data"
   - "How we track confidence scores across 25 auction platforms"
   - "Building a vehicle valuation engine from transaction data"

**Metrics:** Free tier signups, API calls/day, SDK downloads, documentation page views.

## 22.2 Phase 2: Design Partners (Months 3-6)

**Goal:** 5 enterprise design partners, product-market fit validation.

**Actions:**
1. Identify 20 targets across dealer tools, lending, and insurance segments
2. Offer free Pro-tier access for 90 days in exchange for feedback
3. Build custom integrations for 3-5 design partners
4. Iterate on API surface based on partner feedback
5. Develop case studies from partner implementations

**Metrics:** Design partner NPS, API consumption growth, feature requests logged, conversion to paid.

## 22.3 Phase 3: Scale (Months 6-12)

**Goal:** 50+ paying customers, $500K+ ARR.

**Actions:**
1. Launch self-serve billing (Stripe integration already exists)
2. Hire developer relations / developer advocate
3. Conference presence (NADA, DealerSocket, auto fintech events)
4. Partner with DMS platforms for embedded integrations
5. Launch Python SDK for data science audience
6. Introduce enterprise SLAs and dedicated support

**Metrics:** ARR, customer count by tier, churn rate, API uptime, support ticket volume.

## 22.4 Positioning Statement

**For** developers and data teams building automotive applications
**Who** need reliable, traceable vehicle data across the full market
**Nuke** is the automotive data API
**That** provides source-attributed, confidence-scored vehicle data from 25+ platforms in a single, developer-friendly interface
**Unlike** KBB, Black Book, or Hagerty, which deliver opaque editorial estimates
**Nuke** shows you exactly where every data point came from and how much to trust it.

---

\newpage

# 23. Competitive Positioning Matrix

## 23.1 Feature Comparison

| Capability | Nuke | KBB | Black Book | Hagerty | MarketCheck | Classic.com | Drivly |
|-----------|------|-----|-----------|---------|-------------|------------|--------|
| VIN Decode | Yes | Yes | Yes | No | Yes | No | Yes |
| New Car Pricing | No | Yes | Yes | No | Partial | No | Yes |
| Used Car Valuation | Yes | Yes | Yes | Partial | No | Partial | Partial |
| Classic/Enthusiast | **Yes** | No | No | **Yes** | No | **Yes** | No |
| Auction Results | **Yes** | No | No | Partial | No | **Yes** | No |
| Real-time Auctions | **Yes** | No | No | No | No | No | No |
| Listing Aggregation | **Yes** | No | No | No | **Yes** | No | No |
| Transaction History | **Yes** | No | Partial | No | No | Partial | No |
| Source Provenance | **Yes** | No | No | No | No | No | No |
| Confidence Scoring | **Yes** | No | No | No | No | No | No |
| Field-level Sources | **Yes** | No | No | No | No | No | No |
| Observation Model | **Yes** | No | No | No | No | No | No |
| Comment Sentiment | **Yes** | No | No | No | No | No | No |
| Images (avg/vehicle) | 37 | 3-5 | 0 | 2-3 | 5-10 | 3-5 | 0 |
| Self-serve API | **Yes** | No | No | No | **Yes** | Partial | **Yes** |
| Webhooks | **Yes** | No | No | No | No | No | No |
| TypeScript SDK | **Yes** | No | No | No | No | No | No |

## 23.2 Positioning Map

```
                    Editorial / Opaque
                          ↑
                          |
              KBB ●       |       ● Black Book
                          |
              Hagerty ●   |       ● J.D. Power
                          |
     Classic ←————————————+————————————→ Modern
                          |
         Classic.com ●    |       ● MarketCheck
                          |
              Nuke ●      |       ● Drivly
                          |
                          ↓
                    Transaction / Transparent
```

Nuke occupies a unique position: **broad vehicle coverage** (classic through modern) with **transaction-level transparency**. No competitor occupies this quadrant.

---

\newpage

# 24. Technical Moat Analysis

## 24.1 What's Hard to Replicate

**1. The extraction pipeline.** 312 active functions across 25+ platforms, each with platform-specific logic for handling authentication, pagination, anti-bot measures, and data normalization. This represents 18+ months of iteration. A competitor starting from scratch would need 12-18 months to reach equivalent coverage.

**2. The historical dataset.** 812K vehicles, 30M images, 11M auction comments, 617K observations. This is accumulated over time — it cannot be created on demand. Historical auction results (especially pre-2024) are increasingly difficult to scrape as platforms archive older content.

**3. The observation model.** The architectural decision to use an append-only observation model rather than a mutable vehicle record is fundamental. Retrofitting this onto a traditional database design is a full rewrite. Nuke was built observation-first.

**4. The confidence framework.** Source trust scores, field-level provenance, and tiered confidence are woven into every layer of the system — extraction, storage, API, and SDK. This is not a feature that can be bolted on.

**5. The valuation engine.** An 8-signal weighted model with tier-dependent weights, deal scoring with freshness decay, heat scoring, and record proximity effects. This was calibrated on 500K+ valuations and is continuously improving.

## 24.2 What Could Be Replicated

**1. VIN decoding.** NHTSA data is free. Any competitor can build a VIN decoder.

**2. Basic listing scraping.** Individual platform scrapers are not defensible. The breadth and reliability of 25+ is.

**3. Market comparison.** Simple comparable-sales logic is well-understood. The observation-based, confidence-weighted approach is harder.

**4. API packaging.** REST API design is commodity. The data behind it is not.

## 24.3 Moat Strength Assessment

| Moat Component | Strength | Time to Replicate |
|---------------|----------|-------------------|
| Extraction pipeline breadth | Strong | 12-18 months |
| Historical dataset depth | Very Strong | 2-3 years (data is time-locked) |
| Observation architecture | Strong | 6-12 months (architecture decision) |
| Confidence framework | Moderate-Strong | 6 months (concept is describable) |
| Valuation engine | Moderate | 3-6 months (methodology is publishable) |
| Developer experience | Weak (not yet shipped) | 2-3 months |
| Brand / network effects | Weak (early stage) | 12-24 months |

**Conclusion:** The strongest moats are the historical dataset (cannot be replicated without time) and the extraction pipeline (breadth + reliability). The weakest areas are developer experience and brand — which is why shipping the public API and docs is the highest priority.

---

\newpage

# 25. Risks & Mitigations

## 25.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Platform blocks scraping | High | Medium | Diversified sources (25+), Playwright fallback, proxy rotation. No single source represents >30% of data. |
| Data quality degradation | Medium | High | Content hashing prevents duplicates. Confidence scoring surfaces low-quality data. Quality monitoring workflows (scrape-quality-monitor). |
| API uptime | Medium | High | Supabase Edge Functions have built-in redundancy. Need to add dedicated status page and SLA monitoring. |
| Scale limitations | Low | Medium | Supabase handles well to ~1M rows per table. Beyond that, may need to partition or migrate hot paths. |

## 25.2 Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Incumbents launch similar products | Medium | Medium | KBB/Black Book are structurally unable to offer source transparency (their value is the opaque model). Hagerty could but hasn't. First-mover advantage on provenance. |
| Legal challenges from platforms | Medium | High | Data is factual (sale prices, listing details) — generally not copyrightable. However, ToS violations could trigger cease-and-desists. Mitigation: API access where available, respectful scraping rates, caching over re-scraping. |
| Pricing pressure | Low | Medium | Nuke's differentiation is not "cheaper data" but "better data." Provenance and confidence scoring justify premium over commodity alternatives. |
| Slow enterprise sales cycles | High | Medium | Self-serve tiers generate cash flow while enterprise deals mature. Free tier drives adoption and creates inbound demand. |

## 25.3 Market Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Market contraction (auto downturn) | Medium | Low-Medium | Data demand is counter-cyclical in some segments (lenders need more data in downturns for risk management). |
| Platform consolidation | Low | Medium | If BaT, C&B, etc. consolidate, could reduce data diversity. Mitigated by observation model — historical data remains valuable regardless. |
| AI disruption of valuations | Medium | Low | AI can generate valuations, but it needs training data. Nuke provides the training data. AI is a customer, not a competitor. |

---

\newpage

# 26. 90-Day Execution Plan

## Month 1: Ship the API

| Week | Deliverable |
|------|-------------|
| 1 | Stand up `/v1/vehicles/{vin}` (unified endpoint wrapping existing data) |
| 1 | Stand up `/v1/vehicles/{vin}/history` (observations timeline) |
| 2 | Stand up `/v1/vehicles/{vin}/valuations` (expose nuke_estimates) |
| 2 | Stand up `/v1/vehicles/{vin}/listings` (expose external_listings) |
| 3 | Stand up `/v1/market/comps` and `/v1/market/trends` |
| 3 | Stand up `/v1/search` (wrap universal-search) |
| 4 | Implement usage metering and tier enforcement |
| 4 | Publish TypeScript SDK to npm |

## Month 2: Ship the Developer Experience

| Week | Deliverable |
|------|-------------|
| 5 | Launch docs.nuke.ag (auto-generated from OpenAPI + hand-written guides) |
| 5 | Build interactive API playground |
| 6 | Create sandbox environment with seeded test data |
| 6 | Write Getting Started guide, Authentication guide, Webhooks guide |
| 7 | Launch self-serve signup and billing (Stripe) |
| 7 | Build developer dashboard (API keys, usage, billing) |
| 8 | Launch on Hacker News, Product Hunt, API directories |

## Month 3: First Customers

| Week | Deliverable |
|------|-------------|
| 9 | Outreach to 20 target design partners |
| 9 | Stand up `/v1/vehicles/{vin}/auction` (bid history, comment sentiment) |
| 10 | Build 3 example integrations (dealer pricing tool, lender LTV calculator, market dashboard) |
| 10 | Add real-time auction webhooks |
| 11 | Iterate based on first customer feedback |
| 11 | Stand up `/v1/dealers` endpoints |
| 12 | Write first case study |
| 12 | Assess: what's working, what needs to change |

## Key Dependencies

1. **Domain**: Secure `api.nuke.ag` and `docs.nuke.ag`
2. **Hosting**: Decide if API gateway sits in front of Supabase Edge Functions or if Phoenix backend serves the public API
3. **Metering**: Build or buy usage metering (Stripe Billing, Metronome, or custom)
4. **Support**: Set up support channel (Intercom, Discord, or GitHub Discussions)

---

\newpage

# 27. Appendix A: Current Database Schema (Key Tables)

## vehicles
The central table with 100+ columns:

| Column Group | Key Fields |
|-------------|-----------|
| Identity | id (uuid), vin, year, make, model, trim, body_style |
| Specs | engine, transmission, drivetrain, color, interior_color, mileage |
| Pricing | sale_price, asking_price, msrp, current_value, winning_bid, high_bid |
| Confidence | year_confidence, make_confidence, vin_confidence, price_confidence (1-10) |
| Sources | year_source, make_source, discovery_source, discovery_url, platform_source |
| Status | is_public, is_for_sale, is_modified, condition_rating |
| Ownership | user_id, created_at, updated_at |

## vehicle_observations
| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| vehicle_id | uuid | FK to vehicles |
| source_slug | text | FK to observation_sources |
| kind | text | comment, bid, listing, sale_result, etc. |
| structured_data | jsonb | Type-specific payload |
| content_text | text | Raw content |
| content_hash | text | SHA-256 for dedup |
| confidence_score | float | 0-1 trust score |
| confidence_factors | jsonb | Score breakdown |
| observed_at | timestamptz | When the event occurred |
| source_url | text | Original source |

## external_listings
| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| vehicle_id | uuid | FK to vehicles |
| platform | text | bat, cars_and_bids, ebay_motors, etc. |
| listing_url | text | Original listing URL |
| listing_status | text | pending, active, ended, sold, cancelled |
| current_bid | numeric | Current bid amount |
| reserve_price | numeric | Reserve (if known) |
| final_price | numeric | Hammer price |
| bid_count | integer | Number of bids |
| view_count | integer | Listing views |
| start_date | timestamptz | Listing start |
| end_date | timestamptz | Listing end |
| sold_at | timestamptz | Sale timestamp |

## nuke_estimates (valuations)
| Column | Type | Purpose |
|--------|------|---------|
| vehicle_id | uuid | FK to vehicles |
| estimated_value | numeric | Computed market value |
| confidence_score | float | Valuation confidence |
| confidence_interval | numeric | ± range |
| comparable_count | integer | Number of comps used |
| signal_weights | jsonb | Weight breakdown |
| deal_score | text | plus_3 to minus_3 |
| heat_score | integer | 0-100 |
| computed_at | timestamptz | When calculated |

## vehicle_field_sources
| Column | Type | Purpose |
|--------|------|---------|
| vehicle_id | uuid | FK to vehicles |
| field_name | text | Which field |
| field_value | text | The value |
| source_type | text | user_input, auction_extraction, ai_extraction, vin_decode |
| source_url | text | Original source |
| confidence_score | integer | 0-100 |
| verified_by | uuid | Verifier user |

---

\newpage

# 28. Appendix B: Full Endpoint Inventory (Current)

## Production Edge Functions by Category

### Core API (7 functions)
- api-v1-vehicles
- api-v1-observations
- api-v1-batch
- api-v1-business-data
- api-keys-manage
- webhooks-manage
- webhooks-deliver

### Search (2 functions)
- universal-search
- search

### Extraction (59 functions)
- bat-simple-extract, bat-extract, bat-queue-worker, bat-multisignal-postprocess, bat-url-discovery, bat-year-crawler
- extract-cars-and-bids-core, extract-cars-and-bids-comments
- extract-craigslist, extract-ebay-motors, extract-ebay-parts
- extract-facebook-marketplace, fb-marketplace-bot-scraper, fb-marketplace-orchestrator, fb-marketplace-sweep
- extract-hagerty-listing, hagerty-bid-tracker, hagerty-email-parser
- extract-premium-auction, extract-rmsothebys, extract-gooding, extract-bonhams, extract-historics-uk, extract-barrett-jackson, extract-gaa-classics
- extract-blocket, extract-leboncoin, extract-collecting-cars, extract-collecting-cars-simple
- extract-victorylap-listing, extract-bh-auction
- import-pcarmarket-listing, import-classic-auction, import-classiccars-listing, import-fb-marketplace
- extract-vehicle-data-ai, extract-vehicle-data-ollama, intelligent-scraper, unified-scraper-orchestrator
- extract-wayback-listing, extract-wayback-index, wayback-indexer
- [+ 18 more specialized extractors]

### AI & Analysis (30+ functions)
- compute-vehicle-valuation, calculate-vehicle-scores, score-vehicle-condition
- analyze-auction-comments, analyze-comments-fast, analyze-batch-contextual
- identify-vehicle-from-image, validate-vehicle-image, analyze-image
- extract-vehicle-description, analyze-vehicle-description
- decode-vin-and-update, nlq-sql
- market-intelligence-agent, bid-curve-analysis, auction-trends-stats
- [+ 15 more]

### Orchestration (15+ functions)
- ralph-wiggum-rlm-extraction-coordinator
- agent-orchestrator, autonomous-extraction-agent
- crawler-scheduler, continuous-queue-processor
- pipeline-orchestrator (GitHub Action)
- [+ 9 more]

### Payments (8 functions)
- create-checkout, create-api-access-checkout, create-vehicle-transaction-checkout
- stripe-webhook, create-setup-session, setup-payment-method
- place-market-order, place-bid-with-deposit

### Notifications (12+ functions)
- send-transaction-sms, sms-reminder-scheduler, sms-review
- telegram-intake, telegram-webhook, telegram-restoration-bot
- create-notification, concierge-notify
- [+ 4 more]

### Platform (10+ functions)
- db-stats, platform-status, check-scraper-health, system-health-monitor
- queue-status, process-import-queue, process-content-extraction
- [+ 3 more]

---

\newpage

# 29. Appendix C: Sample API Responses

## Vehicle Lookup Response

```json
GET /v1/vehicles/JT2AE86C9P0123456

{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "vin": "JT2AE86C9P0123456",
  "year": 1993,
  "year_confidence": 10,
  "year_source": "vin_decode",
  "make": "Toyota",
  "make_confidence": 10,
  "make_source": "vin_decode",
  "model": "MR2",
  "model_confidence": 10,
  "model_source": "vin_decode",
  "trim": "Turbo",
  "trim_confidence": 7,
  "trim_source": "bring_a_trailer",
  "body_style": "Coupe",
  "engine": "3S-GTE 2.0L Turbo I4",
  "transmission": "Manual",
  "drivetrain": "RWD",
  "color": "Super Red",
  "color_confidence": 8,
  "color_source": "bring_a_trailer",
  "mileage": 78420,
  "mileage_confidence": 7,
  "mileage_source": "bring_a_trailer",
  "mileage_observed_at": "2025-11-15T00:00:00Z",
  "images": {
    "count": 42,
    "primary": "https://storage.nuke.ag/vehicles/a1b2.../primary.jpg",
    "categories": {
      "exterior": 18,
      "interior": 10,
      "engine": 6,
      "undercarriage": 4,
      "detail": 4
    }
  },
  "observations_count": 23,
  "sources": ["bring_a_trailer", "facebook_marketplace", "rennlist_forum"],
  "first_observed": "2024-03-12T08:15:00Z",
  "last_observed": "2026-01-28T14:32:00Z",
  "valuation": {
    "estimated_value": 32500,
    "confidence": 7.8,
    "range": [27000, 38000],
    "based_on_comparables": 15,
    "trend_12mo": "+8.2%",
    "price_tier": "mainstream",
    "deal_score": null,
    "heat_score": 42,
    "heat_label": "warm",
    "computed_at": "2026-02-10T06:00:00Z"
  },
  "latest_listing": {
    "platform": "bring_a_trailer",
    "status": "sold",
    "final_price": 31500,
    "bid_count": 28,
    "sold_at": "2025-11-15T22:00:00Z",
    "url": "https://bringatrailer.com/listing/1993-toyota-mr2-turbo-42/"
  },
  "listing_count": 3,
  "auction_count": 1,
  "created_at": "2024-03-12T08:15:00Z",
  "updated_at": "2026-02-10T06:00:00Z"
}
```

## Observation History Response

```json
GET /v1/vehicles/JT2AE86C9P0123456/history?kind=sale_result,listing

{
  "vehicle_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "vin": "JT2AE86C9P0123456",
  "observations": [
    {
      "id": "obs_001",
      "kind": "sale_result",
      "source": "bring_a_trailer",
      "confidence": 0.92,
      "observed_at": "2025-11-15T22:00:00Z",
      "data": {
        "final_price": 31500,
        "bid_count": 28,
        "reserve_met": true,
        "auction_url": "https://bringatrailer.com/listing/..."
      },
      "source_url": "https://bringatrailer.com/listing/1993-toyota-mr2-turbo-42/"
    },
    {
      "id": "obs_002",
      "kind": "listing",
      "source": "facebook_marketplace",
      "confidence": 0.65,
      "observed_at": "2025-08-03T10:30:00Z",
      "data": {
        "asking_price": 35000,
        "listing_status": "expired",
        "days_listed": 34,
        "location": "Portland, OR"
      },
      "source_url": null
    },
    {
      "id": "obs_003",
      "kind": "listing",
      "source": "facebook_marketplace",
      "confidence": 0.62,
      "observed_at": "2025-03-18T15:45:00Z",
      "data": {
        "asking_price": 38500,
        "listing_status": "expired",
        "days_listed": 62,
        "location": "Portland, OR"
      },
      "source_url": null
    }
  ],
  "pagination": {
    "total": 3,
    "cursor": null,
    "has_more": false
  }
}
```

## Market Comps Response

```json
GET /v1/market/comps?make=Toyota&model=MR2&year_min=1991&year_max=1995&trim=Turbo

{
  "query": {
    "make": "Toyota",
    "model": "MR2",
    "year_range": [1991, 1995],
    "trim": "Turbo"
  },
  "summary": {
    "median_price": 34750,
    "mean_price": 36200,
    "min_price": 18500,
    "max_price": 67000,
    "total_transactions": 47,
    "time_range": "2024-02-10 to 2026-02-10",
    "trend_12mo": "+8.2%",
    "trend_confidence": 0.78
  },
  "transactions": [
    {
      "vehicle_id": "v_abc123",
      "year": 1993,
      "trim": "Turbo",
      "color": "Super Red",
      "mileage": 78420,
      "condition_notes": "Well-maintained, original paint, timing belt service at 72K",
      "sale_price": 31500,
      "platform": "bring_a_trailer",
      "sold_at": "2025-11-15",
      "bid_count": 28,
      "confidence": 0.92,
      "url": "https://bringatrailer.com/listing/..."
    }
  ],
  "pagination": {
    "total": 47,
    "cursor": "eyJwYWdlIjoxfQ==",
    "has_more": true
  }
}
```

---

\newpage

# 30. Conclusion

Nuke has built the hard part: a continuously-running extraction pipeline spanning 25+ platforms, an observation-based data architecture with source provenance on every field, a confidence scoring framework, and an 800K+ vehicle dataset with 30M images.

What remains is packaging: exposing the strongest data through clean API endpoints, building developer experience, and going to market with a clear message.

**The message is not "we have AI." The message is "we went to the source."**

Every field in a Nuke API response tells you where it came from and how much to trust it. No other automotive data provider does this. In a market moving toward algorithmic decision-making — where lenders, insurers, and platforms need auditable, traceable, real-time data — this is the product.

The 90-day plan is straightforward:
1. **Month 1**: Ship the API surface (new endpoints over existing data)
2. **Month 2**: Ship the developer experience (docs, SDK, playground, billing)
3. **Month 3**: Ship to customers (design partners, case studies, iteration)

The data is flowing. The architecture is sound. The moat is deepening every day as more observations are recorded. Now it's time to let the world plug in.

---

*End of Report*

---

**Prepared by:** Nuke Internal
**Classification:** Confidential
**Next Review:** March 2026
