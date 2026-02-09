# PROJECT N-ZERO
## Business Plan

**DRAFT - CONFIDENTIAL**
**February 2026**

---

## Table of Contents

1. Introduction to N-Zero
2. Platform Architecture
3. Data Assets & Intelligence
4. Market Research
5. Competitive Landscape
6. Business Model
7. Development Roadmap
8. Team & Organization
9. 5-Year Financial Projections
10. Financing Strategy

---

## 1. INTRODUCTION

### What is N-Zero?

N-Zero is the data infrastructure layer for the collector vehicle market. Built by Nuke, it is an autonomous platform that aggregates vehicle data from across the fragmented collector ecosystem - auctions, forums, registries, service shops, social media, government databases, and private collections - and structures it into verified, confidence-scored intelligence.

The platform serves organizations, vehicles, and users as the foundational data layer required for the collector vehicle market to mature into a properly valued, financeable asset class.

**Core thesis: Collector vehicles represent over $1 trillion in asset value with less data infrastructure than a $200K house.**

### What N-Zero Is NOT

N-Zero is not an AI wrapper around existing data. It is the vehicle - the platform the AI drives and maintains. The system:

- Owns the data pipeline (310 microservices extracting from 80+ source types)
- Owns the data model (922 database tables, source-agnostic observation architecture)
- Owns the intelligence layer (proprietary ML models, valuation engine, sentiment analysis)
- Owns the distribution layer (production SDK, API, webhooks)

Every component was built in-house. There is no dependency on any single third-party data source.

---

## 2. PLATFORM ARCHITECTURE

### System Overview

```
[80+ Source Types]
    ↓
[310 Edge Functions - Autonomous Extraction]
    ↓
[Observation Store - Immutable, Confidence-Scored]
    ↓
[AI Intelligence Layer - YONO, Sentiment, Valuation]
    ↓
[Distribution - SDK, API, Webhooks]
    ↓
[Organizations | Vehicles | Users]
```

### Technology Stack

| Layer | Technology | Scale |
|-------|-----------|-------|
| **Ingestion** | 310 Deno TypeScript edge functions | Processing 8,320+ vehicles/day autonomously |
| **Database** | PostgreSQL (Supabase) | 100 GB, 922 tables, 768K vehicles |
| **Backend** | Elixir/Phoenix | High-concurrency, fault-tolerant |
| **Frontend** | React TypeScript | 93+ pages/components |
| **ML/Vision** | PyTorch (EfficientNet-B0) | YONO: 100K+ training images |
| **API** | RESTful + SDK | Production TypeScript SDK |
| **Infrastructure** | Supabase + Vercel + AWS | Cloud-native, auto-scaling |

### Named Technology Assets

#### YONO - "You Only Nuke Once"
Proprietary vehicle image classification system trained on 100,000+ labeled images from the Nuke database.
- Architecture: EfficientNet-B0 (5M parameters)
- Coverage: 300+ vehicle makes
- Use cases: Auto-tagging uploads, photo validation, visual search, non-vehicle filtering
- Training phases: 5 progressive phases scaling from 25K to 100K training images

#### Ralph Wiggum - Autonomous Extraction Coordinator
AI-powered operations system managing the entire extraction pipeline:
- Queue health monitoring and priority routing
- Error triage and domain-level failure analysis
- Recursive Language Model (RLM) compression for complex contexts
- Self-healing: identifies and routes around blocked sources

#### Observation Architecture
Source-agnostic, bitemporal event store:
- Every data point is an immutable observation with provenance
- Confidence scoring per source type (0.0 to 1.0)
- Trust scores: Ferrari Classiche (0.98), NHTSA (0.95), BaT (0.85), Forum posts (0.50)
- Supports 14 observation types: listing, sale_result, comment, bid, sighting, work_record, ownership, specification, provenance, valuation, condition, media, social_mention, expert_opinion

#### Nuke SDK
Production TypeScript API client:
- Full CRUD for vehicles, observations, batch operations
- Webhook support with HMAC-SHA256 signature verification
- Idempotency keys for retry safety
- Rate-limit aware with automatic backoff
- Auto-chunking for bulk imports (up to 1,000 per request)

### Infrastructure Metrics

| Metric | Value |
|--------|-------|
| Edge functions deployed | 310 |
| Database tables | 922 |
| Database size | 100 GB |
| Extraction queue completions | 241,914 |
| Service executions logged | 284,005 |
| Field extraction log entries | 2,901,902 |
| Listing page snapshots | 325,367 |

---

## 3. DATA ASSETS & INTELLIGENCE

### Data Scale (Live - February 8, 2026)

| Asset | Count |
|-------|-------|
| **Vehicles** | 768,288 |
| **Vehicle images** | 28,361,696 |
| **Auction comments** | 10,876,766 |
| **Tracked bids** | 3,486,742 |
| **Transaction value tracked** | $41,617,202,366 |
| **Vehicles with price data** | 514,961 |
| **Valuation estimates** | 474,484 |
| **AI sentiment analyses** | 127,109 |
| **Image AI extractions** | 212,985 |
| **Image tags** | 203,065 |
| **User profiles** | 493,265 |
| **Timeline events** | 767,940 |
| **Vehicle observations** | 628,695 |
| **Build thread posts** | 58,519 |
| **Organization behavior signals** | 137,561 |
| **Distinct makes** | 6,089 |
| **Distinct make/model combos** | 120,350 |

### Market Coverage by Vehicle Era

| Era | Vehicles w/ Prices | Avg Sale Price | Total Value Tracked |
|-----|-------------------|----------------|---------------------|
| Pre-1950 | 42,244 | $134,357 | ~$5.67B |
| 1950s | 54,606 | $116,310 | ~$6.35B |
| 1960s | 116,485 | $88,700 | ~$10.33B |
| 1970s | 82,589 | $52,174 | ~$4.31B |
| 1980s | 46,198 | $40,901 | ~$1.89B |
| 1990s | 54,284 | $47,722 | ~$2.59B |
| 2000s | 64,032 | $48,217 | ~$3.09B |
| 2010s | 33,668 | $146,119 | ~$4.92B |
| 2020s | 11,475 | $210,680 | ~$2.42B |

**Note:** N-Zero targets the collector and enthusiast vehicle market specifically - not the mass-market new car segment. Average tracked vehicle value is $80,816 with a median of $31,213.

### Top Vehicle Makes by Volume

| Make | Count | % of DB |
|------|-------|---------|
| Chevrolet | 147,881 | 19.2% |
| Ford | 96,069 | 12.5% |
| Mercedes-Benz | 41,219 | 5.4% |
| Porsche | 39,103 | 5.1% |
| BMW | 26,436 | 3.4% |
| Pontiac | 22,292 | 2.9% |
| Dodge | 19,821 | 2.6% |
| Cadillac | 18,082 | 2.4% |
| Jaguar | 16,621 | 2.2% |
| Toyota | 14,523 | 1.9% |
| Volkswagen | 14,191 | 1.8% |
| Ferrari | 14,092 | 1.8% |

### Highest-Value Vehicles in Database

| Year | Make | Model | Sale Price |
|------|------|-------|-----------|
| 1962 | Ferrari | 250 GTO by Scaglietti | $43,260,000 |
| 1962 | Ferrari | 250 GTO | $38,500,000 |
| 1957 | Ferrari | 335 Sport Scaglietti | $35,916,918 |
| 1964 | Ferrari | 250 LM by Scaglietti | $34,880,000 |
| 1954 | Mercedes-Benz | W196R Formula 1 | $29,604,866 |

### Data Source Ecosystem

N-Zero tracks **491,605 external identities** across the collector vehicle ecosystem and **2,401 registered businesses**, organized across 9 source categories:

| Category | Configured Sources | Description |
|----------|-------------------|-------------|
| Registry | 34 | Ferrari Classiche, Porsche CoA, NHTSA, State DMVs, marque clubs |
| Auction | 12 | BaT, RM Sotheby's, Mecum, Barrett-Jackson, Bonhams, Gooding |
| Forum | 12 | Rennlist, Pelican Parts, NastyZ28, model-specific communities |
| Shop | 9 | ICON 4x4, Ringbrothers, Velocity Restorations, East Coast Defender |
| Marketplace | 7 | Hagerty, Classic Driver, AutoTrader Classics |
| Social Media | 2 | Instagram, YouTube |
| Aggregator | 2 | Classic.com, Carfax competitor tracking |
| Owner | 1 | Direct owner input |
| Internal | 1 | System inference engine |

**Registered Business Types (2,401 total):**
- Dealers: 108
- Garages: 67
- Auction houses: 52
- Restoration shops: 4
- Performance shops: 3
- Unclassified (pending categorization): 2,167

**Auction Event Coverage:**
| Platform | Events Tracked |
|----------|---------------|
| Bring a Trailer | 107,310 |
| Mecum | 7,480 |
| BaT (alt source) | 3,547 |
| Cars & Bids | 900 |
| Facebook Marketplace | 139 |
| Collecting Cars | 122 |
| PCarMarket | 70 |

### AI Intelligence: Proven Value Creation

#### Valuation Engine
- **447,928 vehicles** with both estimates and actual sale prices
- **Median accuracy: 6.3% error** (median absolute percentage error)
- **Average confidence score: 59.95%** (system self-reports uncertainty)
- Inputs: comparable sales, market sentiment, provenance depth, condition signals

**Accuracy by Price Segment:**

| Segment | Vehicles | Median Error |
|---------|----------|-------------|
| Under $25K | 185,959 | 9.7% |
| $25K-$50K | 125,509 | 6.2% |
| $50K-$100K | 92,487 | 3.3% |
| $100K-$250K | 34,112 | <1% |
| $250K-$1M | 9,146 | <1% |
| Over $1M | 742 | <1% |

Accuracy improves with vehicle value - the higher-value collector market has deeper comparable data and more consistent pricing signals.

#### Sentiment Analysis → Price Correlation

Analysis of 100,711 vehicles with community sentiment data:

| Community Sentiment | Median Sale Price | Price Premium vs. Negative |
|---|---|---|
| Very Negative (<0.2) | $13,250 | Baseline |
| Negative (0.2-0.4) | $15,911 | +20% |
| Neutral (0.4-0.6) | $16,500 | +25% |
| Positive (0.6-0.8) | $20,000 | +51% |
| Very Positive (0.8+) | $25,000 | +89% |

**Vehicles with strong positive community sentiment sell at nearly 2x the price of negatively-perceived vehicles.** This is original intelligence that does not exist in any competing product.

#### Image Intelligence (YONO)
- 28.3M images indexed
- 212,985 images with AI-extracted metadata
- 203,065 images with auto-generated tags
- 86,823 images with camera position analysis
- Training data: 100,000+ labeled vehicle images

### Data Quality & Freshness

| Metric | Value |
|--------|-------|
| Data updated in last 7 days | 97.8% |
| Data updated in last 30 days | 100% |
| VIN coverage | 21.0% (161,065 vehicles) |
| Vehicles with timeline events | 767,940 |
| Autonomous additions (last 24h) | 8,320 |

**Note on VIN coverage:** Many collector vehicles predate the VIN standardization (1981). For pre-1981 vehicles, identification relies on chassis numbers, engine stamps, and registry verification - all of which N-Zero tracks via the observation system.

### Growth Velocity

| Period | Vehicles Added | Daily Rate |
|--------|---------------|-----------|
| Through Nov 2025 | ~100 | Development |
| Dec 2025 | 9,697 | ~313/day |
| Jan 2026 | 196,417 | ~6,336/day |
| Feb 1-8, 2026 | 561,994 | ~70,249/day (foundation for autonomous) |

**Feb 1-8 set the foundation for autonomous operation.** From that base, growth trajectory (8,320 vehicles/day = ~3M/year) is rapidly building coverage across the 43 million collector vehicles in the US.

---

## 4. MARKET RESEARCH

### Collector Vehicle Market Size

| Metric | Value | Source |
|--------|-------|--------|
| **Collector vehicles in the US** | 43 million | Hagerty |
| **Total insurable value** | $1 trillion+ | Hagerty |
| **Car enthusiasts in the US** | 69 million | Hagerty |
| **Annual auction + online sales (2025)** | $4.8 billion | Hagerty/CNBC |
| **YoY auction market growth (2025)** | +10% | Hagerty |
| **Online auction sales (2025)** | $2.5 billion | Hagerty |
| **Live auction sales (2025)** | $2.3 billion | Hagerty |
| **Vehicles sold at auction (2025)** | ~71,000 | Hagerty |
| **Seven-figure car sales record (2025)** | $1 billion | Hagerty |
| **Global classic car market (2024)** | $39.7 billion | Credence Research |
| **Global market projected (2032)** | $77.8 billion | Credence Research |
| **Global market CAGR** | 8.7% | Credence Research |
| **Vehicles insured by Hagerty alone** | 2.7 million | Hagerty |

### TAM / SAM / SOM

| Level | Market | N-Zero's Role |
|-------|--------|---------------|
| **TAM** | $1T+ in collector vehicle asset value across 43M vehicles in the US | Data infrastructure for the entire collector ecosystem |
| **SAM** | $4.8B annual auction market + adjacent services (insurance, lending, parts) | Intelligence layer for active market participants |
| **SOM** | ~71K annual auction transactions + 2,401 tracked businesses + 491K ecosystem participants | API subscriptions, lead commissions, data licensing |

### N-Zero's Current Market Penetration

- **768,288 vehicles tracked** out of 43 million US collector vehicles = 1.8% of total population
- **$41.6 billion in tracked transaction value** vs. $4.8B annual auction volume = 8.7x annual market volume in historical data
- **514,961 vehicles with price data** vs. ~71K annual auction sales = 7.3x annual transaction coverage
- **At current growth rate (8,320/day)**, the platform adds ~3M vehicles per year toward full market coverage

### Adjacent Market Opportunities

- **Vehicle financing** - Collector vehicle loans require valuation data. N-Zero provides collateral valuation with 6.3% median accuracy.
- **Insurance** - $1T in insurable value needs accurate pricing. Hagerty alone insures 2.7M vehicles.
- **Estate planning** - High-net-worth collectors need portfolio-level data across entire collections.
- **Investment funds** - Collector car funds need pricing indices. N-Zero has 237K price histories.
- **Dealer operations** - 108 dealers tracked. Inventory management, pricing, marketing powered by data.

### Industry Trends

- **Online disruption**: Online auction sales ($2.5B) now exceed live events ($2.3B) for the first time. Over 50,000 collector vehicles sold online annually, up 6% YoY.
- **Generational shift**: Baby boomers aging out. Gen X, millennials, and Gen Z entering as collectors, bringing digital-native expectations for data and transparency.
- **Asset class maturation**: Seven-figure car sales hit $1B in 2025 (record). Average seven-figure sale: $3M. Collector vehicles increasingly treated as alternative investments.
- **Data demand**: Insurance companies, lenders, and fractional ownership platforms all seeking better valuation and provenance tools.
- **Strong 2026 outlook**: Hagerty CEO predicts continued momentum in 2026 based on strong pipeline and private market activity.

### International Market Opportunity

#### European Market

The European Union represents the **largest regional market** for collector car auction sales globally, driven by heritage marques (Ferrari, Porsche, Mercedes-Benz, Jaguar, Aston Martin) and premium events (Rétromobile Paris, Goodwood Festival of Speed, Villa d'Este).

**N-Zero's European data position:**

| Metric | Value |
|--------|-------|
| European-make vehicles in database | 192,773 (25.1% of DB) |
| European vehicles with price data | 138,865 |
| Average sale price (European makes) | $140,780 |
| Total European-make value tracked | $19.5 billion |

Key European auction results in 2025:
- RM Sotheby's Zurich: CHF 69.7M ($87M) - highest-earning European auction in RM history
- RM Sotheby's Munich: €26.1M
- RM Sotheby's London: £23.7M ($31.5M)
- Bonhams Paris: €18M across 162 lots
- Bonhams Goodwood: £10.2M (80% sell-through rate)

The platform is architecturally ready for international expansion. European source integration (Classic Driver, AutoScout24, marque registries, European auction houses) would extend coverage into the EU's active collector market. Germany, Italy, and the UK represent the largest European collector car populations.

#### Japanese / JDM Market

The Japanese Domestic Market (JDM) collector segment is one of the fastest-appreciating in the world. Models like the R34 Nissan Skyline GT-R, FD Mazda RX-7, and Toyota Supra are seeing 20%+ annual appreciation.

**N-Zero's JDM data position:**

| Make | Vehicles | Avg Sale Price |
|------|----------|---------------|
| Toyota | 14,558 | $28,759 |
| Honda | 10,023 | $10,242 |
| Nissan | 6,353 | $26,112 |
| Mazda | 3,181 | $19,176 |
| Lexus | 3,082 | $25,109 |
| Subaru | 1,982 | $20,937 |
| Mitsubishi | 1,655 | $21,166 |
| Acura | 1,518 | $57,007 |
| **Total JDM** | **~44,200** | |

The US is the leading destination for JDM exports from Japan, with the 25-year import rule creating a rolling window of newly eligible vehicles each year. N-Zero's architecture is positioned to track the Japan-to-US export pipeline, providing provenance continuity from Japanese auction houses (USS, JAA) through import to US registration.

#### Global Expansion Roadmap

| Phase | Market | Data Sources | Vehicle Population |
|-------|--------|-------------|-------------------|
| Current | US (primary) | 80+ source types | 43M collector vehicles |
| Near-term | UK / Europe | Classic Driver, Bonhams, RM EU, marque registries | Estimated 15-20M |
| Medium-term | Japan (JDM export) | USS auctions, JAA, BH Auction, export dealers | Estimated 5M+ |
| Long-term | Middle East, Australia | Regional auction houses, import registries | Growing markets |

---

## 5. COMPETITIVE LANDSCAPE

### Position: Enabler, Not Competitor

N-Zero does not compete with existing market participants. It provides a data infrastructure service that does not currently exist and is designed to integrate with everyone via API. The platform makes the entire ecosystem more efficient.

**"We don't make money if YOU don't make money."**

### Ecosystem Relationships

| Player | Their Business | N-Zero's Relationship | How They Benefit |
|--------|---------------|----------------------|-----------------|
| **Carfax** | Title/accident history | Future data source (~$700/mo available) | N-Zero already enriches far beyond what Carfax covers using free public sources. Carfax integration available as paid enrichment layer. |
| **Hagerty** | Insurance + valuation | Data customer + source | Better valuation data improves their pricing accuracy; their insured vehicle data enriches ours |
| **Bring a Trailer** | Online auction marketplace | Lead source + API partner | We send them qualified seller leads on commission; they get higher conversion |
| **RM Sotheby's** | Premium auction house | Lead source + data partner | We identify undervalued consignment opportunities; they get curated intake |
| **Mecum** | Volume auction house | Lead source + data partner | Same as above - we are their data layer, not their competitor |
| **Cars & Bids** | Online auction marketplace | Lead source + API partner | We surface vehicles for their platform demographic |
| **Classic.com** | Price aggregation | Data source + potential customer | They aggregate; we provide the depth they can't |
| **Dealers** | Buy/sell vehicles | API customers | Inventory data, pricing intelligence, buyer matching |
| **Shops/Restorers** | Service & restoration | API customers + workspace tenants | Parts recommendations, project data, workspace facilities |
| **Insurance companies** | Risk pricing | Data licensing customers | Accurate valuations, provenance verification, condition data |
| **Lenders** | Vehicle-backed loans | Data licensing customers | Collateral valuation, depreciation curves, market liquidity data |

### Why No One Is Competing With Us

The granular data N-Zero captures is simply available - in auction comments, forum threads, shop records, registry documents, social media posts, and owner knowledge. **No one has built the database and pipeline to accept it.** That's the gap.

Existing players are either:
- **Marketplaces** (BaT, C&B, Mecum) - they generate data but don't structure it
- **Aggregators** (Classic.com) - they scrape prices but don't go deeper
- **Insurance/editorial** (Hagerty) - they publish guides but don't compute from raw data
- **Mass market** (Carfax, KBB) - they don't serve collectors at all

N-Zero is the infrastructure layer underneath all of them.

---

## 6. BUSINESS MODEL

### Core Philosophy: "We don't make money if YOU don't make money."

Every revenue stream is aligned with participant success. N-Zero earns when the ecosystem earns.

### Revenue Stream 1: Auction Lead Commission

**Framework:** N-Zero is the home for buyers and the home for technicians. We are not a dealer tool—we allow dealers to participate when they're willing to operate with full transparency. The industry has long suffered from opacity and from actors who take advantage of buyers; we protect all interests through **maximum transparency**. Transparency is what lets everyone make money fairly: our system gives every price a clear *why* and every listing a clear *what needs to be fixed*, so buyers trust and sellers get paid. We want to rebuild the dealer model, especially for dealers who are struggling and ready to do it right.

N-Zero's AI identifies vehicles likely to sell and matches them to the optimal auction house based on vehicle type, price tier, seller location, and platform demographics.

- **Mechanism**: Commission on successful auction placements originated through N-Zero
- **Data basis**: 119,579 auction events tracked, seller behavior patterns, platform conversion rates
- **Example**: System identifies a 1970 Plymouth 'Cuda with positive sentiment (0.85) and growing price trend. Routes to BaT (best fit for muscle cars in this price range). Seller consigns, vehicle sells, N-Zero earns commission.

### Revenue Stream 2: AI-Recommended Parts Sales (Commission %)
Platform recommends specific parts, services, and maintenance based on vehicle data, owner history, and community intelligence.

- **Mechanism**: % commission on parts sales made through AI recommendations
- **Data basis**: 768K vehicles with specs, 58K build posts with parts data, 10.8M comments mentioning maintenance/parts
- **Example**: Owner of a 1973 911T receives alert: "Based on 47 similar vehicles, your engine mounts are likely due for replacement. Here are verified parts from 3 suppliers."

### Revenue Stream 3: Transaction Escrow
Handle peer-to-peer vehicle transactions with data-backed confidence.

- **Mechanism**: Escrow fee on completed transactions (% of sale price)
- **Data basis**: $41.6B in tracked transaction volume, trust scoring, provenance verification
- **Value proposition**: Buyer gets verified data. Seller gets qualified buyers. Both get escrow protection.

### Revenue Stream 4: Derivative & Asset Market (SEC-Filed)
Create a regulated derivative and asset market treating collector vehicles as a proper asset class.

- **Mechanism**: Trading fees on derivative instruments, advisor collaboration fees
- **Data basis**: 474K valuation estimates, 237K price histories, sentiment-price correlation, market indices
- **Regulatory**: SEC filing required. Advisor collaborations for fund structures.
- **Vision**: Collector vehicles become financeable assets with the same data infrastructure as real estate

### Revenue Stream 5: Sponsorship & Event Collaboration
Partner with auction houses and events (not compete with them) to create data-enhanced experiences.

- **Mechanism**: Sponsorship fees, event collaboration revenue
- **Data basis**: 137K organization behavior signals, event demographics
- **Key principle**: N-Zero does NOT run its own auctions. We enhance others' events.

### Revenue Stream 6: Physical Workspaces (Garages)
Build N-Zero garages and workspaces for builders, restorers, and collectors.

- **Mechanism**: Workspace fees + data loop (work done in N-Zero garages feeds platform data)
- **Physical-digital loop**: Every repair, restoration, and build creates structured data that increases platform value
- **Scale-up**: Workspaces increase productivity and generate revenue while deepening the data moat

### Revenue Stream 7: Live Auction Prediction Market

A Kalshi-style prediction market where viewers of live auctions can predict final sale prices in real-time. The closest prediction wins.

- **Mechanism**: Entry fees for prediction contests, spread on prediction contracts
- **Regulatory model**: CFTC-regulated prediction market (Designated Contract Market), similar to Kalshi's framework. Kalshi operates in 43 US states under federal regulation, demonstrating the viability of this regulatory path.
- **Data basis**: N-Zero's valuation engine provides the baseline predictions. 474K valuation estimates and 6.3% median accuracy give the platform a unique informational advantage.
- **User experience**: Watch a live BaT or Mecum auction. Place a prediction on final price from your phone. N-Zero shows you the AI estimate, sentiment data, and comparable sales. Closest prediction wins the pot (minus platform fee).
- **Network effect**: Prediction data feeds back into the valuation engine. Each prediction event generates thousands of data points about market perception, creating a real-time crowd-sourced price discovery mechanism.
- **Why it works**: Collector car auctions are entertainment. 10.8M comments and 3.4M bids prove the community already watches and engages. This monetizes that engagement while generating valuable pricing data.

### Revenue Stream 8: API Access (B2B Data Subscriptions)
Tiered API access for developers, organizations, and third-party builders.

- **Mechanism**: Monthly subscription tiers
- **Data basis**: Production SDK ready, 310 microservices, 922 tables of data
- **Tiers**: Basic lookup → Full profile → Real-time feed → Enterprise licensing

### Revenue Modeling (Conservative Scenarios)

| Stream | Year 1 Basis | Conservative Annual |
|--------|-------------|-------------------|
| Auction leads (2% commission on $100M GMV) | 1,000 leads placed | $2M |
| Parts commissions (5% on $10M parts) | 50K recommendations | $500K |
| Escrow (1% on $50M transactions) | 500 transactions | $500K |
| API subscriptions ($299/mo x 200 orgs) | 200 subscribers | $718K |
| Workspace (10 bays x $2K/mo) | 1 location | $240K |
| Prediction market (5% rake on $5M volume) | 10K contests | $250K |
| **Year 1 blended** | | **$4-5M** |

---

## 7. DEVELOPMENT ROADMAP

### Phase 1: Foundation (Completed - 2025)
- ✅ Core database architecture (922 tables)
- ✅ Extraction pipeline (310 edge functions)
- ✅ Observation system with confidence scoring
- ✅ AI analysis pipeline (sentiment, valuation)
- ✅ YONO image classification (5 training phases)
- ✅ Nuke SDK (production TypeScript client)
- ✅ Frontend dashboard (93+ pages)

### Phase 2: Scale (Current - Q1 2026)
- ✅ Autonomous extraction at scale (8,320+ vehicles/day)
- ✅ 768K+ vehicles in database
- 🔄 YONO Phase 4-5 training (75K-100K images)
- 🔄 Expanding source coverage (Craigslist, eBay, Broad Arrow)
- 🔄 Valuation engine refinement

### Phase 3: Distribution (Q2-Q3 2026)
- [ ] Public API launch
- [ ] B2B sales to dealers, auction houses, insurers
- [ ] Nuke SDK ecosystem development
- [ ] Webhook integrations for real-time market data
- [ ] Geographic coverage visualization

### Phase 4: Intelligence Products (Q4 2026 - 2027)
- [ ] "Nuke Index" - Market indices by make/model/era (like S&P 500 for collector cars)
- [ ] Provenance verification certificates
- [ ] Lending/insurance data products
- [ ] Portfolio-level analytics for collections
- [ ] Predictive pricing models

### Phase 5: Platform Ecosystem (2027-2028)
- [ ] Third-party developer ecosystem
- [ ] White-label data for dealer websites
- [ ] Real-time auction intelligence feeds
- [ ] International market expansion

---

## 8. TEAM & ORGANIZATION

### Founder

**Skylar Williams** - Founder & CEO, Nuke Ltd

Sole architect of the N-Zero platform, responsible for the complete technology stack from database design through ML pipeline to production API. Built the system from zero to 768K+ vehicles with no external engineering team, demonstrating both the depth of technical capability and the leverage of the autonomous architecture.

**Key accomplishments:**
- Designed 922-table PostgreSQL architecture for multi-source vehicle intelligence
- Built 310 autonomous edge functions handling ingestion, analysis, and distribution
- Developed YONO image classification system through 5 progressive training phases (100K+ images)
- Created Ralph Wiggum autonomous coordinator for self-healing pipeline operations
- Shipped production TypeScript SDK for B2B integration
- Scaled from 100 vehicles to 768K+ in 3 months with zero additional headcount

### Company

| Field | Detail |
|-------|--------|
| Legal Name | Nuke Ltd |
| Incorporation | Nevada, 2022 |
| Address | 676 Wells Rd, Boulder City, NV 89005, USA |
| Website | [nukeltd.com](https://www.nukeltd.com) |
| Email | info@nukeltd.com |
| NAICS | 811111 |
| Status | Active |

### Capital Structure

| Detail | Value |
|--------|-------|
| Authorized shares | 10,000,000 |
| Issued & outstanding | 1,000,000 Common Stock |
| Founder ownership | 100% |
| Share class | Common Stock (voting, participating) |
| Votes per share | 1.00 |
| Liquidation preference | 1.00x |
| Outstanding debt | $0 |

### Current Architecture

The platform operates with minimal human overhead. The autonomous systems handle extraction, error triage, queue management, and scaling without intervention.

| Function | Coverage | Status |
|----------|---------|--------|
| Platform Architecture | Skylar Williams | Full-stack design and implementation |
| AI/ML | YONO (PyTorch), LLM pipelines | 5 training phases complete |
| Data Engineering | 310 autonomous edge functions | Self-healing with Ralph Wiggum |
| Frontend | React TypeScript (93+ pages) | Production |
| Backend | Elixir/Phoenix | Production |
| Operations | Ralph Wiggum (autonomous) | Queue health, error triage, priority routing |
| Quality | Duplicate detection, scraping health | 336K detection jobs, 2.3M health records |

### Visual Identity

The N-Zero platform employs a distinctive retro-modern design language that bridges automotive heritage with data-native precision:

**Design Philosophy:** Windows 95-inspired aesthetic merged with modern data density. Small fonts (8-11px), compact spacing, and 2px solid borders maximize information display without visual clutter.

**Color System:**
- Primary: `#f5f5f5` (light) / `#1e1e1e` (dark) - moderate contrast, no extreme black/white
- Status: Success `#16825d`, Warning `#b05a00`, Error `#d13438`
- N-Zero logo: Blue pixel-art circular glow (`#66ccff`) with retro computing aesthetic

**Automotive Accent Themes:** The design system includes 20+ accent colorways drawn from automotive racing heritage:
- Gulf livery (`#ff5f00` + `#9dd9f3`)
- Ferrari Rosso Corsa (`#e4002b` + `#ffd100`)
- British Racing Green (`#00573f` + `#ffef00`)
- Martini Racing (`#012169` + `#da291c`)
- BMW M-Sport (`#00a3e0` + `#c8102e`)
- Mopar heritage (Plum Crazy, Sublime, Hemi Orange)

**Accessibility:** Full dark mode, high contrast, and greyscale profiles supported via CSS variable system.

**Brand Assets:**
- Logo: [nukeltd.com](https://www.nukeltd.com) | [Squarespace CDN](https://images.squarespace-cdn.com/content/v1/660f87f31386427935b72e33/aa5d61d7-35cb-43b8-b029-ae75cde06503/nukelogo.png)
- Font: Arial/system sans-serif (body), SF Mono/Cascadia Code (data)

### Advisory Network

N-Zero operates an advisory model consistent with its autonomous architecture: AI advisory agents provide continuous strategic intelligence, supplemented by a human network of domain experts and strategic relationships.

#### AI Advisory Agents (Public)

The N-Zero advisory board is composed of AI agents - autonomous systems modeled on domain expertise profiles that provide continuous, real-time strategic guidance. Unlike a traditional advisory board that meets quarterly, AI advisors operate 24/7, processing market signals, competitive intelligence, and operational data to surface actionable recommendations.

This is not a gimmick - it is the logical extension of the platform's autonomous thesis. If 310 microservices can extract and analyze vehicle data without human intervention, the same architecture can provide strategic advisory functions. Each AI advisor specializes in a domain: market intelligence, competitive analysis, regulatory navigation, partnership development, financial modeling.

**The advisory board is public and transparent.** Agent reasoning, recommendations, and performance are visible. This builds trust with investors, partners, and the community - and generates a new category of operational data that feeds back into the platform.

#### Key Hire: Co-Founder / CTO

The single most important near-term hire is a technical co-founder or CTO who can:
- Share architectural ownership of the platform
- Lead the engineering team post-funding
- Reduce key-person risk (currently 100% founder-dependent)
- Bring complementary skills (ML/AI depth, B2B sales engineering, or infrastructure scaling)

This hire is the #1 use of initial funding. The right co-founder transforms N-Zero from a remarkable solo achievement into a scalable organization.

---

## 9. 5-YEAR FINANCIAL PROJECTIONS

### Data-Driven Growth Assumptions

| Metric | 2026 (Current) | 2027 | 2028 | 2029 | 2030 |
|--------|----------------|------|------|------|------|
| Vehicles in DB | 768K → 3.5M | 8M | 15M | 25M | 43M+ |
| Images | 28M → 100M | 250M | 500M | 800M | 1.2B |
| AI Analyses | 127K → 500K | 2M | 5M | 10M | 20M |
| Markets covered | US | US + UK/EU | + Japan | + Middle East | Global |
| Org Subscribers | 50 | 300 | 1,000 | 3,000 | 8,000 |
| API Calls/Month | 100K | 2M | 10M | 50M | 200M |

### Revenue Projections

| Stream | 2026 | 2027 | 2028 | 2029 | 2030 |
|--------|------|------|------|------|------|
| API subscriptions | $300K | $1.5M | $5M | $12M | $25M |
| Auction lead commissions | $500K | $2M | $5M | $10M | $20M |
| Parts commissions | $100K | $500K | $2M | $5M | $10M |
| Transaction escrow | - | $500K | $3M | $8M | $15M |
| Prediction market | - | $500K | $2M | $5M | $10M |
| Data licensing | $100K | $1M | $3M | $8M | $15M |
| Physical workspaces | - | $500K | $2M | $4M | $8M |
| Derivative/asset market | - | - | $3M | $8M | $15M |
| **Total Revenue** | **$1-2M** | **$6-8M** | **$25M** | **$60M** | **$118M** |

### Cost Structure

The platform's autonomous architecture creates exceptionally high gross margins. There is no human extraction labor - the 310 microservices operate continuously without intervention.

**Historical Spend (from QuickBooks / receipt system):**

The company has tracked all expenditures through its own receipt processing system (242 receipts, AI-extracted, QuickBooks export ready):

| Year | Receipts | Vehicle Project Spend | Vendors |
|------|----------|-----------------------|---------|
| 2021 | 69 | $11,048 | 13 |
| 2022 | 2 | - | - |
| 2023 | 80 | $13,534 | 20 |
| 2024 | 31 | $2,037 | 7 |
| 2025 | 3 | - | 1 |
| **Total** | **242** | **$27,311** | **30+ unique vendors** |

Top vendors: AutoZone ($5,312), American Polishing & Plating ($5,300), LMC Truck ($2,644), CTI Industrial Supply ($2,124), Carquest ($2,497), Speedway Motors ($1,536), George's Tire & Auto ($1,045), Holley Performance ($1,020).

**Current monthly infrastructure burn:**

| Service | Monthly Cost | Purpose |
|---------|-------------|---------|
| Supabase (DB + Functions) | ~$160 | Database, 310 edge functions |
| OpenAI API | $200-$500 | LLM extraction, analysis |
| Anthropic Claude | $200-$500 | AI analysis, coordination |
| Cursor | ~$200 | AI-assisted development |
| Firecrawl | ~$200 | Web scraping with JS rendering |
| Vercel | TBD | Frontend hosting |
| Domain / Squarespace | ~$20 | nukeltd.com |
| **Total monthly burn** | **~$1,000-$1,600/mo** | |

All 768K vehicles have been built entirely from freely available public data sources - no paid data feeds. Carfax integration (~$700/mo) is available as a future enrichment layer but has not been needed.

**The platform was built and scaled to 768K vehicles on ~$1,000-$1,600/month in operating costs.** This is the power of the autonomous architecture - a single founder with minimal burn built a data asset tracking $41.6B in vehicle value.

| Cost Category | Current | 2027 | 2028 |
|--------------|---------|------|------|
| Infrastructure (Supabase, Vercel) | ~$160/mo | $15K/mo | $50K/mo |
| AI/API (OpenAI, Anthropic, Firecrawl) | ~$800/mo | $10K/mo | $30K/mo |
| Development tools (Cursor) | $200/mo | $500/mo | $1K/mo |
| Data sources (Carfax, etc.) | $0/mo | $3K/mo | $10K/mo |
| Team (post-funding) | $0 | $80K/mo | $200K/mo |
| Vehicle R&D (parts, projects) | ~$500/mo | $2K/mo | $5K/mo |
| Operations / Legal | ~$50/mo | $10K/mo | $30K/mo |
| **Total OpEx** | **~$1,200/mo** | **$120K/mo** | **$326K/mo** |

**Key insight:** The platform generates revenue before significant OpEx scaling is needed. Current infrastructure costs (~$1,200/mo) are negligible relative to the data asset being built ($41.6B tracked). The receipt processing system already feeds into QuickBooks for clean financial reporting.

### Margin Analysis

| Year | Revenue | OpEx | Gross Margin |
|------|---------|------|-------------|
| 2026 | $1-2M | <$500K | 60-75% |
| 2027 | $6-8M | $1.4M | 75-82% |
| 2028 | $25M | $3.8M | 85% |
| 2029 | $60M | $8M | 87% |
| 2030 | $118M | $15M | 87% |

**The data platform model scales with near-zero marginal cost per additional data consumer.** Once the data exists, serving it via API, SDK, or report costs almost nothing.

---

## 10. FINANCING STRATEGY

### Current Capital Position

| Detail | Value |
|--------|-------|
| Legal entity | Nuke Ltd (Nevada, 2022) |
| Authorized shares | 10,000,000 Common Stock |
| Issued & outstanding | 1,000,000 |
| Founder ownership | 100% (Skylar Williams) |
| Outstanding debt | $0 |
| Prior rounds | None (bootstrapped) |
| Current burn | Minimal (infrastructure only) |

### Proposed Transaction

| Parameter | Detail |
|-----------|--------|
| Instrument | Post-Money SAFE (Y Combinator standard) |
| Amount | $2,000,000 |
| Valuation cap | $18,000,000 post-money |
| Discount | None |
| Implied ownership | ~11.1% (at cap) |
| Prior rounds | None (bootstrapped) |
| Outstanding debt | $0 |
| Share headroom | 9M authorized but unissued shares available |

**Why SAFE:** SAFEs now represent 92% of all pre-seed rounds (Carta Q3 2025). No maturity date pressure, no interest accrual, standardized Y Combinator terms with minimal legal costs. Allows stacking multiple investors at different closing dates without reopening terms.

**Why $18M cap:** N-Zero's data asset (770K+ vehicles, $41.6B tracked, 922 tables, 310 microservices, proprietary ML) represents years of compressed development. The median AI pre-seed valuation cap in 2025 was $17M post-money. N-Zero's working product exceeds what most pre-seed startups have built at the time of their first raise. The closest comparable - CoStar Group - provides data infrastructure for commercial real estate and generates $2.7B in annual revenue from a similar model applied to a similar-sized asset class.

### Use of Funds

| Category | Amount | % | Purpose |
|----------|--------|---|---------|
| **Co-Founder + Key Hires** | $800,000 | 40% | Technical co-founder/CTO (priority #1), 1-2 engineers. Reduces key-person risk and enables team scaling. |
| **Infrastructure & Scaling** | $400,000 | 20% | Database scaling (read replicas, compute), storage for 100M+ images, API infrastructure for production B2B traffic, uptime/reliability hardening |
| **Regulatory & Legal** | $300,000 | 15% | SEC registration (Form D for derivative market), CFTC DCM application (prediction market), corporate counsel, IP/trademark protection (N-Zero, YONO, Nuke) |
| **Revenue Launch** | $300,000 | 15% | API monetization infrastructure, first enterprise sales hires, partnership development with auction houses and dealers, initial go-to-market |
| **Operations & Buffer** | $200,000 | 10% | Office/workspace, insurance, accounting, travel for partnerships, 6-month emergency buffer at current burn |

#### Detailed allocation (how the money is spent)

**1. Co-Founder + Key Hires ($800,000)**  
- **Technical co-founder/CTO (priority #1):** Cash comp $180–220K/year over the funding period; equity grant per board approval. Expected hire within 0–6 months. Covers architectural ownership, engineering leadership, and key-person risk reduction.  
- **Engineer 1 (backend/platform):** $140–170K/year; target hire in months 1–3. Owns API scaling, database performance, and production reliability.  
- **Engineer 2 (ML/B2B or full-stack):** $120–150K/year; target hire in months 6–9. Focus on valuation/ML pipeline, B2B integration, or frontend depending on CTO roadmap.  
- **Payroll taxes, benefits, and employer costs:** ~18–22% of wages over the period.  
- **Recruiting:** Contingency for retained search or signing incentives ($15–30K) if needed to close CTO.  

**2. Infrastructure & Scaling ($400,000)**  
- **Database and compute:** Read replicas, connection pooling, and compute scaling for 10x current traffic; estimated $40–80K over 18 months.  
- **Storage:** Capacity for 100M+ images and growing observation/audit data; estimated $25–50K.  
- **API and edge:** Rate limiting, usage metering, and edge capacity for B2B and public API; estimated $30–60K.  
- **Monitoring, observability, and security:** Logging, alerting, incident response, and security tooling; estimated $40–80K.  
- **Uptime and reliability:** Backups, disaster recovery, load testing, and hardening; estimated $30–50K.  
- **Contingency:** Remainder reserved for unexpected scaling (e.g., new data partnerships, traffic spikes).  

**3. Regulatory & Legal ($300,000)**  
- **SEC:** Form D and any registration or exemption work for derivative/asset market initiatives; estimated $35–75K.  
- **CFTC:** Designated Contract Market (DCM) application and ongoing compliance for prediction market; estimated $100–180K (phased over 18–24 months).  
- **Corporate counsel:** Retainer for corporate, contracts, and governance; estimated $4–8K/month over the period ($72–144K).  
- **IP and trademarks:** USPTO filings and enforcement for N-Zero, YONO, Nuke; estimated $8–20K.  

**4. Revenue Launch ($300,000)**  
- **API monetization build:** Billing, usage metering, customer dashboards, and tiered access; estimated $40–80K.  
- **First enterprise/sales capacity:** One full-time or fractional enterprise/sales hire (or equivalent in contract); estimated $90–140K over 12–18 months.  
- **Partnership development:** Travel, events, and structured outreach to auction houses, dealers, and insurers; estimated $40–70K.  
- **Go-to-market:** Collateral, trials, demos, and initial marketing; estimated $25–50K.  

**5. Operations & Buffer ($200,000)**  
- **Office/workspace:** Co-working or small dedicated space; estimated $1.5–2.5K/month over 18 months ($27–45K).  
- **Insurance:** D&O, E&O, general liability; estimated $15–35K.  
- **Accounting, payroll, and compliance:** Monthly bookkeeping, payroll, and year-end/tax; estimated $3–5K/month ($54–90K).  
- **Travel and misc. operations:** Partnership travel, conferences, and operational contingencies; estimated $20–40K.  
- **Emergency buffer:** 6-month runway at current burn held in reserve; remainder of category.  

Spending is phased to match hiring and milestones; the largest outlays (personnel and legal) are timed to board-approved hiring and regulatory steps. No single category is a black box—each has defined line items and ranges so investors can see exactly how the capital is deployed.

#### Operational priorities: what we're actually buying

**1. Turning on the machines: extraction + storage + security**  
The immediate need is running more data processes and securing that data. Compute (cloud vs. own metal), storage for 100M+ images, and securing data (backups, access control, audit). Cloud: ~$8–20K/mo at 3–5x extraction; own metal option $30–80K upfront. Storage: **$25–50K** over 18 months. Securing data: **$15–35K**.

**2. Training proprietary models on our data**  
GPU/training runs on 768K+ vehicles, 28M+ images, comment/listing text. Cloud GPU (Lambda, RunPod): **$25–75K** over 18 months for multiple cycles; up to **$50–100K** for larger or frequent retrains. Data pipeline for training: **$10–25K**.

**3. Co-founder and team: security blanket + attracting the right person**  
Funding is a security blanket and enables attracting the right co-founder when we find them—passionate, tech insider (accomplished or dynamic younger), spokesperson for the platform. In the meantime: lean (interns, contractors). Reserve is there to close when the right person appears; we're not committed to burning it all on headcount.

**4. SEC & legal**  
Unchanged: **$300K** (SEC, CFTC DCM, counsel, IP/trademarks).

**5. API monetization**  
Billing/metering (Stripe + usage), customer dashboard, tiers (Free / Pro / Enterprise). Build: **$50–100K**. Remainder of Revenue Launch → organic growth.

**6. Organic growth and partnerships**  
Gas and travel ($15–35K), press and influence—dinners, events, Venice Biennale–style, influencer friends, documenting stories ($25–55K). Creative spaces: partner with best (N0 café concept, hotels, design districts); **$40–90K** for partnerships. Proof by doing: buy/sell cars, workspace as showpiece; **$30–60K** (can be self-liquidating). **Fun builds with preferred builders:** Some builds run $300–400K; we bring in **sponsors** (parts brands, dealers, collectors) to back them—like YC backs startups. We curate and put in catalyst capital ($40–80K per build); sponsors carry the rest. Builders adopt the tech; we get adoption, data, and stories.

**7. Reserve and buffer**  
Runway to build in peace and collaborate without financial stress; option to spend wisely rather than "use it or lose it" on hires we don't yet need.

### Why Now?

The platform is at an inflection point:

1. **Data moat is established** - 768K vehicles, $41.6B tracked, 28.3M images. This took months of engineering; a competitor starting today would take years to replicate.
2. **Autonomous growth is proven** - 561,994 vehicles added in 8 days with zero human intervention. The system scales without proportional headcount.
3. **Revenue model is defined** - 8 revenue streams identified, all aligned with ecosystem success. Conservative Year 1: $1-2M.
4. **Production infrastructure is built** - SDK, API, webhooks all production-ready. B2B integration is a sales problem, not a technology problem.
5. **Market timing is optimal** - Collector car auction market grew 10% in 2025. Online overtook live for the first time. Generational shift is accelerating demand for data-native tools.
6. **International markets are untapped** - 192K European-make vehicles and 44K JDM vehicles already tracked, providing a beachhead for EU and Japan expansion.

---

---

## USE CASES & VALUE CREATION

### Use Case 1: Dealer Inventory Intelligence

**Scenario:** A specialty Porsche dealer in California lists a 1973 911S Targa for sale.

**Without N-Zero:** Dealer relies on gut feeling, a few comparable sales from memory, and a Hagerty value guide. Pricing takes hours of research. They might under-price (leaving money on the table) or over-price (vehicle sits for months).

**With N-Zero (API integration):**
- Instant valuation: $67,500 (±3.3% accuracy for this segment) with confidence interval
- 47 comparable sales from the last 24 months with detailed pricing breakdown
- Sentiment analysis: 0.82 (very positive) - community enthusiasm for this model is rising
- AI-recommended listing platform: BaT (82% sell-through rate for early 911s in this price range)
- Market trend: Up 12% YoY for early 911 Targas
- Total time: seconds via API call

**Revenue for N-Zero:** $299/mo API subscription + auction lead commission if vehicle routes to BaT

### Use Case 2: Insurance Valuation

**Scenario:** An insurer needs to price a policy for a collection of 15 collector vehicles.

**Without N-Zero:** Manual appraisal required for each vehicle. Cost: $200-$500 per vehicle. Time: 2-3 weeks. Accuracy: depends on appraiser's knowledge.

**With N-Zero:** Batch API call returns valuations for all 15 vehicles with confidence scores, comparable sales, condition signals, and provenance depth. Cost: pennies per API call. Time: milliseconds. Accuracy: 6.3% median error (better than most human appraisals).

**Revenue for N-Zero:** Data licensing agreement ($0.01-$0.10 per vehicle per year)

### Use Case 3: Live Auction Prediction Market

**Scenario:** RM Sotheby's is auctioning a 1965 Ferrari 275 GTB in Monterey. 50,000 viewers are watching online.

**With N-Zero Prediction Market:**
- N-Zero displays its AI estimate: $2.8M (based on 14,092 Ferrari records, sentiment data, comparable sales)
- 5,000 viewers place predictions ranging from $1.5M to $4.5M
- Entry fee: $10 each ($50K pot)
- Vehicle sells for $3.1M
- Closest predictor wins $45K (minus 10% platform rake of $5K)
- All 5,000 predictions feed back into N-Zero's pricing engine as real-time market sentiment data

**Revenue for N-Zero:** $5K rake + invaluable crowd-sourced pricing data

### Use Case 4: Cross-Border Provenance (JDM Import)

**Scenario:** A buyer in Texas is considering a 1995 Nissan Skyline GT-R (R33) imported from Japan.

**Without N-Zero:** Buyer has no way to verify Japanese auction history, service records, or accident history. Import paperwork may be incomplete. Risk of chassis number fraud.

**With N-Zero:** Complete provenance chain: Japanese auction house (USS) → export dealer → US customs → state registration. Chassis number verification against Japanese records. Service history from Japanese shops. Accident checks. Original auction photos from Japan.

**Revenue for N-Zero:** Provenance verification report ($50-$100) + escrow service if transaction proceeds

### Use Case 5: Collection Portfolio Management

**Scenario:** A high-net-worth collector owns 40 vehicles across 3 states, worth approximately $8M.

**With N-Zero:** Real-time portfolio dashboard showing current valuation, 12-month performance, individual vehicle trends, insurance adequacy alerts, and maintenance recommendations. Monthly portfolio report with market commentary.

**Revenue for N-Zero:** Enterprise API subscription ($999/mo) + individual valuation reports

---

## RISK FACTORS

### Market Risks
- **Economic downturn**: Collector vehicle market is correlated with discretionary spending. However, premium vehicles ($100K+) have historically been resilient during downturns, and N-Zero's data becomes MORE valuable when pricing certainty is scarce.
- **Market saturation**: With 43M collector vehicles in the US alone, market saturation is not a near-term risk. International expansion provides additional growth vectors.

### Technology Risks
- **Data source access**: Some sources may restrict scraping or API access. N-Zero mitigates this through 80+ source types - loss of any single source has minimal impact. The observation architecture is designed for source-level resilience.
- **AI accuracy degradation**: Market shifts could temporarily reduce valuation accuracy. Continuous training and sentiment monitoring provide self-correcting feedback loops.
- **Infrastructure scaling**: Rapid data growth requires database scaling. Supabase/PostgreSQL architecture supports horizontal read replicas and vertical scaling.

### Regulatory Risks
- **Prediction market regulation**: CFTC approval required for prediction market contracts. Kalshi has established regulatory precedent in 43 states, but legal challenges remain ongoing.
- **SEC filing complexity**: Derivative/asset market requires SEC approval. Timeline and cost are uncertain.
- **Data privacy**: Vehicle data may be subject to state-level privacy regulations. N-Zero's data is primarily about vehicles (assets), not individuals.

### Competitive Risks
- **Large player entry**: Hagerty, Carfax, or a major tech company could build a competing data platform. N-Zero's head start (768K vehicles, 28.3M images, 310 microservices, 922 tables) represents 12+ months of development that would be difficult to replicate.
- **Data commoditization**: If vehicle data becomes widely available, N-Zero's moat shifts from data to intelligence (AI analysis, valuation accuracy, sentiment scoring).

### Operational Risks
- **Single founder dependency**: Currently a one-person operation. Funding enables team expansion to reduce key-person risk. The autonomous architecture mitigates this - the system operates without daily intervention.
- **Burn rate post-funding**: Adding team members increases fixed costs. Revenue activation is designed to precede or coincide with team scaling.

---

## APPENDICES

### Appendix A: Full Database Schema Summary

922 tables organized across the following domains:

| Domain | Tables | Key Tables |
|--------|--------|-----------|
| **Vehicles** | ~50 | vehicles, vehicle_images, vehicle_observations, vehicle_quality_scores, vehicle_status_metadata, vehicle_field_evidence, vehicle_agents, vehicle_sentiment |
| **Auction** | ~30 | auction_events, auction_comments, bat_bids, bat_listings, bat_user_profiles, clean_vehicle_prices |
| **Intelligence** | ~40 | nuke_estimates, comment_discoveries, description_discoveries, image_work_extractions, image_tags, image_camera_position |
| **Organizations** | ~50 | businesses, organization_behavior_signals, organization_capabilities, organization_vehicles, organization_images, organization_inventory |
| **Users** | ~20 | bat_user_profiles, external_identities, admin_users, professional_profiles |
| **Pipeline** | ~40 | import_queue, service_executions, field_extraction_log, extraction_metadata, listing_page_snapshots, scraping_health |
| **Observations** | ~15 | vehicle_observations, observation_sources, observation_extractors, observation_discoveries |
| **System** | ~30 | system_logs, duplicate_detection_jobs, business_financial_statements, business_share_classes |
| **Timeline** | ~10 | timeline_events, vehicle_price_history, business_timeline_events |
| **Search** | ~5 | vehicle_reference_links, vehicle_mailboxes, external_listings |

### Appendix B: Edge Function Registry

310 deployed Deno TypeScript edge functions organized by purpose:

| Category | Count | Examples |
|----------|-------|---------|
| **Extraction** | ~80 | bat-simple-extract, extract-cars-and-bids-core, extract-hagerty-listing, import-pcarmarket-listing, extract-vehicle-data-ai |
| **Analysis** | ~40 | discover-comment-data, discover-from-observations, yono-classify-image, extract-vehicle-intelligence |
| **API** | ~30 | universal-search, vehicle-lookup, batch-operations, webhook-dispatch |
| **Coordination** | ~20 | ralph-wiggum-rlm-extraction-coordinator, backfill-comments, discovery-snowball |
| **Organization** | ~25 | org-intelligence-analyzer, org-behavior-signal, org-inventory-sync |
| **Data Quality** | ~15 | duplicate-detection, data-freshness-check, vin-validator |
| **Admin** | ~20 | db-stats, migration-runner, queue-manager, system-health |
| **Integration** | ~15 | nuke-sdk-handler, oauth-flow, webhook-receiver |
| **Image** | ~10 | image-processor, yono-inference, camera-position-analyzer |
| **Other** | ~55 | Various utility, monitoring, and support functions |

### Appendix C: Source Trust Scores

Complete listing of observation source types with confidence ratings:

| Source | Category | Trust Score | Rationale |
|--------|---------|-------------|-----------|
| Ferrari Classiche | Registry | 0.98 | Factory authentication |
| Porsche Certificate of Authenticity | Registry | 0.98 | Factory verification |
| Galen Govier Mopar Registry | Registry | 0.98 | Recognized marque authority |
| Shelby American Registry | Registry | 0.98 | Official Shelby records |
| NHTSA | Registry | 0.95 | US federal government |
| State DMV (all states) | Registry | 0.95 | State government records |
| Hagerty Price Guide | Registry | 0.90 | Industry standard valuation |
| RM Sotheby's | Auction | 0.90 | Premium global auction house |
| Bonhams | Auction | 0.90 | Premium global auction house |
| Gooding & Company | Auction | 0.90 | Premium Monterey auction |
| Bring a Trailer | Auction | 0.85 | Largest US online auction |
| ICON 4x4 | Shop | 0.85 | Premium builder, detailed records |
| Ringbrothers | Shop | 0.85 | Award-winning builder |
| Cars & Bids | Auction | 0.80 | Growing online platform |
| Mecum | Auction | 0.75 | High-volume live auction |
| Barrett-Jackson | Auction | 0.75 | High-volume live auction |
| Classic Driver | Marketplace | 0.75 | European marketplace |
| AutoTrader Classics | Marketplace | 0.75 | US marketplace |
| Hagerty Marketplace | Marketplace | 0.70 | Insurance company marketplace |
| Carfax | Aggregator | 0.70 | Mass-market title history |
| Classic.com | Aggregator | 0.65 | Price aggregation |
| Rennlist | Forum | 0.60 | Porsche community |
| Pelican Parts | Forum | 0.60 | Porsche/BMW community |
| Ferrari Chat | Forum | 0.60 | Ferrari community |
| NastyZ28 | Forum | 0.50 | Camaro/Firebird community |
| YouTube | Social | 0.50 | Video content |
| Instagram | Social | 0.40 | Photos/stories |
| System inference | Internal | 0.50 | Computed from other observations |

### Appendix D: Vehicle Intelligence Field Catalog

Each vehicle entity can carry 119+ structured fields organized across 8 categories:

**Identity (12 fields)**
year, make, model, trim, generation, body_style, VIN, chassis_number, engine_number, production_number, production_total, factory_color_code

**Provenance (15 fields)**
owner_count, current_owner_duration, acquisition_date, acquisition_price, geographic_history, title_state, title_status, lien_status, accident_history, theft_history, import_history, export_history, celebrity_ownership, racing_history, concours_history

**Condition (18 fields)**
running_status, drivability, body_condition, paint_condition, interior_condition, mechanical_condition, electrical_condition, frame_condition, rust_presence, rust_severity, known_issues, recent_maintenance, upcoming_maintenance, tire_condition, glass_condition, chrome_condition, convertible_top_condition, undercarriage_condition

**Documentation (12 fields)**
service_records_present, build_sheet_present, window_sticker_present, owner_manual_present, tool_kit_present, spare_tire_present, books_records_completeness, title_present, registration_current, inspection_current, insurance_current, import_documents

**Modifications (10 fields)**
modification_level, modification_list, originality_percentage, matching_numbers, original_engine, original_transmission, original_color, repaint_history, engine_swap_history, period_correct_modifications

**Specifications (15 fields)**
engine_type, displacement, horsepower, torque, transmission_type, transmission_speeds, drivetrain, wheelbase, curb_weight, fuel_type, top_speed, zero_to_sixty, production_years, special_edition, factory_options

**Community (12 fields)**
sentiment_score, sentiment_label, community_discussion_volume, expert_opinions, comparable_sales_count, market_trend_direction, desirability_index, rarity_score, investment_grade, cultural_significance, media_appearances, auction_frequency

**Financial (15 fields)**
sale_price, estimated_value, value_low, value_high, confidence_score, price_tier, deal_score, heat_score, appreciation_rate_1yr, appreciation_rate_5yr, insurance_value, replacement_cost, restoration_cost_estimate, parts_availability_score, maintenance_cost_index

### Appendix E: Valuation Engine Methodology

**Inputs (per vehicle):**
1. Comparable sales (same make/model/year, adjusted for condition, options, provenance)
2. Market sentiment (community discussion sentiment from forums and auction comments)
3. Provenance depth (number of data sources, documentation completeness)
4. Condition signals (extracted from descriptions, photos, and expert opinions)
5. Market trend (rolling price index for the vehicle's segment)
6. Rarity factors (production numbers, special editions, matching numbers)

**Outputs:**
- `estimated_value` - Point estimate
- `value_low` / `value_high` - Confidence interval
- `confidence_score` - Model self-reported uncertainty (0.0 to 1.0)
- `deal_score` - How the current asking price compares to estimate
- `heat_score` - Market activity level for this vehicle type
- `signal_weights` - Which inputs most influenced the estimate
- `input_count` - Number of data points used in estimation

**Accuracy (backtested against 447,928 actual sales):**

| Segment | Sample Size | Median Error | Mean Error |
|---------|------------|-------------|-----------|
| Under $25K | 185,959 | 9.7% | 42.7% |
| $25K-$50K | 125,509 | 6.2% | 17.5% |
| $50K-$100K | 92,487 | 3.3% | 16.6% |
| $100K-$250K | 34,112 | <1% | 17.1% |
| $250K-$1M | 9,146 | <1% | 11.7% |
| Over $1M | 742 | <1% | 10.4% |
| **Overall** | **447,928** | **6.3%** | **27.3%** |

The higher mean error vs. median error indicates a small number of outlier predictions (typically vehicles with unusual modifications or provenance). The median error of 6.3% is the more representative accuracy metric and outperforms industry-standard appraisals.

### Appendix F: Sentiment Analysis Methodology

**Process:**
1. Collect all community discussion (auction comments, forum posts, social media mentions)
2. LLM-powered sentiment extraction per comment (positive, negative, neutral with confidence)
3. Aggregate into vehicle-level sentiment score (0.0 to 1.0)
4. Correlate with sale prices to identify predictive signal

**Results (100,712 vehicles with both sentiment and price data):**

| Sentiment Band | Vehicles | Avg Price | Median Price | Max Price |
|---------------|----------|-----------|-------------|-----------|
| Very Negative (<0.2) | 1,447 | $17,877 | $13,250 | $220,000 |
| Negative (0.2-0.4) | 2,777 | $26,831 | $15,911 | $1,985,000 |
| Neutral (0.4-0.6) | 8,031 | $27,162 | $16,500 | $20,000,000 |
| Positive (0.6-0.8) | 25,291 | $32,430 | $20,000 | $12,000,000 |
| Very Positive (0.8+) | 63,166 | $45,410 | $25,000 | $11,000,000 |

**Key finding:** The collector car community has a strong positive sentiment bias (average: 0.79). This is expected - enthusiasts tend to celebrate vehicles rather than criticize them. The important signal is that vehicles with VERY positive sentiment sell for nearly 2x the price of negatively-perceived vehicles. This intelligence is exclusive to N-Zero.

**Implication:** Sentiment is a leading indicator of price movement. A vehicle gaining positive community attention is likely to appreciate. N-Zero can surface these opportunities before they are reflected in asking prices.

### Appendix G: YONO Image Classification System

**Architecture:** EfficientNet-B0 (5 million parameters)

**Training History:**
| Phase | Images | Focus | Accuracy |
|-------|--------|-------|----------|
| Phase 1 | 25,000 | Basic vehicle/non-vehicle classification | Baseline |
| Phase 2 | 50,000 | Make identification (top 50 makes) | Improved |
| Phase 3 | 75,000 | Make + angle classification | Further improved |
| Phase 4 | 90,000 | Extended make coverage (200+ makes) | Near-production |
| Phase 5 | 100,000+ | Full production (300+ makes, all angles) | Production |

**Capabilities:**
- Vehicle vs. non-vehicle classification (filter auction site photos of documents, people, etc.)
- Make identification (300+ makes)
- Camera angle classification (front, rear, side, 3/4, interior, engine, detail, aerial)
- Photo quality scoring
- Damage detection (future training phase)

**Production Usage:**
- 28.3M images indexed
- 212,985 images with AI-extracted metadata
- 203,065 images with auto-generated tags
- 86,823 images with camera position analysis

### Appendix H: Ralph Wiggum - Autonomous Extraction Coordinator

**Purpose:** AI-powered operations system managing the entire extraction pipeline without human intervention.

**Capabilities:**
- Queue health monitoring and alerting
- Error triage and domain-level failure analysis
- Priority routing (high-value vehicles, trending makes, data gaps)
- Self-healing: identifies and routes around blocked sources
- Recursive Language Model (RLM) compression for complex operational contexts
- Multi-agent coordination across concurrent extraction workers

**Operating Stats:**
| Metric | Value |
|--------|-------|
| Queue completions | 241,914 |
| Queue pending | 69 |
| Queue failed | 74,437 (with error categorization) |
| Queue skipped | 21,031 |
| Active sources | 451 |
| Service executions | 284,005 |
| Daily vehicle additions | 8,320+ |

**Self-Healing Example:** When a source blocks IP access, Ralph Wiggum detects the error pattern, deprioritizes that source, re-routes extraction through alternative paths, and flags the domain for manual review. The pipeline continues without interruption.

---

*This document is confidential and intended only for the addressee.*
*Generated from live system data on February 8, 2026.*
*All figures verified from database queries unless otherwise noted.*
