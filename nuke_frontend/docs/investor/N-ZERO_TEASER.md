# PROJECT N-ZERO
## Executive Summary / Teaser

**DRAFT - CONFIDENTIAL**

---

### The Opportunity

N-Zero is a **data layer and provenance engine**: a database-structured backbone that integrates seamlessly into any workflow. We aggregate, structure, and score vehicle data from across fragmented sources—turning scattered history into structured, auditable intelligence. Our API can be used in any workflow, human or agent.

**The value problem:** Even at best, vehicle data is hardly tracked. Histories live in auction houses, forums, registries, shops, and private collections with no unified system of record. That gap is the opportunity. We provide the backbone so that vehicles—as **stores of value**, investible assets, and value creators—can be **valued, verified, and financed** with real data. In theory, these commodities could be owned by AI or other entities as vessels of commerce; we aim to help facilitate the **legal storage and ownership** of the asset class of vehicles for entities, users, and organizations.

There are 43 million vehicles in the United States that function as stores of value, representing over $1 trillion in asset value. Auction and online sales alone reached $4.8 billion in 2025, growing 10% year-over-year. N-Zero is the system of record that connects them.

---

### Key Figures (Live System - February 2026)

| | |
|---|---|
| **Vehicles tracked** | 768,288 |
| **Total transaction value tracked** | $41.6 billion |
| **Vehicle images indexed** | 28.3 million |
| **Auction comments processed** | 10.8 million |
| **Valuation estimates generated** | 474,484 |
| **Valuation accuracy (median error)** | 6.3% |
| **Data sources (organizations)** | 491,605 identities across the ecosystem |
| **Registered businesses** | 2,401 (dealers, auction houses, shops, collections) |
| **Autonomous AI analyses** | 127,109 vehicles with sentiment scoring |
| **Database** | 100 GB across 922 tables |
| **Microservices** | 310 edge functions |
| **Data freshness** | 97.8% updated within last 7 days |

---

### Platform Architecture

N-Zero is a vertically-integrated data platform:

1. **Ingestion** - Three paths. **Agentic extraction** is primary: AI-driven pipelines that discover, fetch, and structure data from 80+ source types (auctions, forums, registries, shops, social media, government databases) with minimal human intervention; 310 microservices run continuously. **Traditional fallback tooling** (scheduled scrapers, APIs, Firecrawl) handles sources where agentic flows aren’t deployed yet. **User-driven ingestion**: users grant access via the app or by downloading our software and interact through text messaging; the system is fully agentic end-to-end—like a ClawdBot for car data. Users just give us access; we do the rest.

2. **Intelligence** - AI-powered analysis of every data point: sentiment scoring, valuation estimation, provenance verification, image classification. Every observation is immutable and confidence-scored.

3. **Distribution** - Production TypeScript SDK, RESTful API, webhooks for real-time events. An API that can be used in any workflow, human or agent. Third parties build on N-Zero.

**In-House Technology:**
- **YONO** ("You Only Nuke Once") - Proprietary vehicle image classification trained on 100K+ labeled images
- **Ralph Wiggum** - Autonomous extraction coordinator managing queue health, error triage, and priority routing
- **Observation Architecture** - Source-agnostic, bitemporal event store with confidence scoring per data point
- **Nuke SDK** - Production TypeScript client for B2B integration

---

### Proven Intelligence: Sentiment Predicts Value

Our AI analysis of 100,711 vehicles with community sentiment data reveals a direct correlation:

| Community Sentiment | Median Sale Price |
|---|---|
| Very Negative (<0.2) | $13,250 |
| Negative (0.2-0.4) | $15,911 |
| Neutral (0.4-0.6) | $16,500 |
| Positive (0.6-0.8) | $20,000 |
| Very Positive (0.8+) | $25,000 |

**Vehicles with strong positive community sentiment sell at nearly 2x the price of negatively-perceived vehicles.** This intelligence doesn't exist anywhere else.

---

### Market Position: Enabler, Not Competitor

N-Zero does not compete with existing players. It integrates with everyone via API and earns when the ecosystem earns.

| Player | Their Role | N-Zero's Relationship |
|---|---|---|
| Carfax | Title history | Future data source (~$700/mo available). We already enrich far beyond what they cover using free public sources. |
| Hagerty | Insurance + valuation | Data customer. Better valuations improve their pricing. |
| BaT / Mecum / RM | Auction houses | We send them qualified leads on commission. |
| Dealers / Shops | Buy/sell/service | API customers. Data they can't get anywhere else. |
| Lenders / Insurers | Finance vehicles | Data licensing. Collateral valuation, risk pricing. |

**The granular data we're after is simply available - in comments, forums, shops, registries. No one has built the database and pipeline to accept it. That's N-Zero.**

**"We don't make money if YOU don't make money."**

---

### Growth Trajectory

| Period | Vehicles Added | Cumulative |
|---|---|---|
| Through Nov 2025 | ~100 | Seed/development phase |
| Dec 2025 | 9,697 | Pipeline activation |
| Jan 2026 | 196,417 | Autonomous operation begins |
| Feb 1-8, 2026 | 561,994 | Full autonomous scale |

**The platform added more vehicles in the last 8 days than in all prior months combined.** The autonomous extraction system is scaling exponentially without additional human capital.

---

### The Data Layer for Funding

N-Zero's architecture serves three stakeholder groups:

- **Organizations** (dealers, auction houses, shops, collections) - Structured data for inventory management, pricing, marketing
- **Vehicles** (the assets themselves) - Complete provenance timelines, valuation scoring, condition intelligence
- **Users** (collectors, investors, enthusiasts) - Transparent market data for buying, selling, and financing decisions

We offer an **API** that plugs into any workflow—human or agent. The platform enables a future where vehicles as stores of value can be **valued, verified, and financed** with the same data confidence as real estate or public equities, and where legal storage and ownership of the asset class can be facilitated for any entity.

---

### Team

**Skylar Williams** - Founder & CEO

Sole founder and architect of Nuke Ltd and the N-Zero platform. Designed and built the entire technology stack: 310 microservices, 922-table database architecture, proprietary ML pipeline (YONO), autonomous extraction coordinator (Ralph Wiggum), and production TypeScript SDK. The platform processes 8,320+ vehicles per day with zero additional headcount.

**Nuke Ltd** - Nevada corporation (2022). 676 Wells Rd, Boulder City, NV 89005. [nukeltd.com](https://www.nukeltd.com)

---

### Revenue Model

| Stream | How It Works |
|--------|-------------|
| Auction lead commissions | AI matches vehicles to optimal auction houses. Commission on placements. |
| Consignment | We place inventory (vehicles, parts) with the right buyer or venue; we earn a cut when it sells (like auction lead commissions). |
| Labor & job brokering | Like Uber for work: we match jobs to workers. Users log what they do, we ingest and send them jobs; they accept the contract and deliver. We earn when the match closes. |
| Parts sales (AI-recommended) | Platform recommends parts/services based on vehicle data. % on sales. |
| Transaction escrow | Data-backed escrow for peer-to-peer vehicle transactions. |
| Derivative & asset market | SEC-filed regulated market for collector vehicles as an asset class. |
| Event sponsorship | Collaborate with auction houses (never compete). Bring in sponsors. |
| Physical workspaces | Build garages. Work done in N-Zero spaces feeds back into the data platform. |
| API access | Tiered B2B data subscriptions for developers and organizations. |
| Live auction prediction market | Kalshi-style prediction contracts on live auction outcomes. Viewers guess finish prices in real-time. |

### Proposed Transaction

| Parameter | Detail |
|-----------|--------|
| **Instrument** | Post-Money SAFE (Y Combinator standard) |
| **Amount** | $2,000,000 |
| **Valuation cap** | $18,000,000 post-money |
| **Use of funds** | Co-founder/CTO + engineering (40%), Infrastructure scaling (20%), Regulatory & legal (15%), Revenue launch (15%), Operations (10%) |

The Company has a clean cap table (100% founder, $0 debt, no prior rounds) with 9M authorized but unissued shares providing full headroom for investor allocation and future rounds.

---

**Contact:**
Skylar Williams, Founder & CEO
info@nukeltd.com
[nukeltd.com](https://www.nukeltd.com)

*This document is confidential and intended only for the addressee. It does not constitute an offer or solicitation.*
