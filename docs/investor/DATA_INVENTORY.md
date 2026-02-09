# Investor Document Data Inventory
## Factual Data Available vs. Needed

Generated: 2026-02-08 from live database queries

---

## HARD NUMBERS (Verified from DB)

### Platform Scale
| Metric | Value | Source |
|--------|-------|--------|
| Total vehicles tracked | 768,288 | `SELECT COUNT(*) FROM vehicles` |
| Total vehicle images | 28,361,696 | `vehicle_images` table |
| Total auction comments ingested | 10,876,766 | `auction_comments` table |
| Total bids tracked | 3,486,742 | `bat_bids` table |
| Total dollar volume tracked | $41,617,202,366 | `SUM(sale_price)` |
| Vehicles with price data | 514,961 | `WHERE sale_price > 0` |
| AI sentiment analyses completed | 127,109 | `comment_discoveries` |
| Valuation estimates generated | 474,484 | `nuke_estimates` |
| User profiles mapped | 493,265 | `bat_user_profiles` |
| External identities | 491,605 | `external_identities` |
| Vehicle observations | 628,695 | `vehicle_observations` |
| Image AI extractions | 212,985 | `image_work_extractions` |
| Image tags generated | 203,065 | `image_tags` |
| Camera position analyses | 86,823 | `image_camera_position` |
| Build thread posts | 58,519 | `build_posts` |
| Timeline events | 767,940 | `timeline_events` |
| Organization behavior signals | 137,561 | `organization_behavior_signals` |
| Vehicle agents (autonomous) | 208,373 | `vehicle_agents` |
| Listing page snapshots | 325,367 | `listing_page_snapshots` |
| Field extraction log entries | 2,901,902 | `field_extraction_log` |
| Service executions | 284,005 | `service_executions` |
| Database size | 100 GB | `pg_database_size()` |
| Database tables | 922 | `pg_stat_user_tables` |
| Edge functions deployed | 310 | directory count |
| Registered data sources | 80 | `observation_sources` |
| Distinct vehicle makes | 6,089 | `COUNT(DISTINCT make)` |
| Distinct make/model combinations | 120,350 | `COUNT(DISTINCT make+model)` |
| Highest value vehicle | $43,260,000 | 1962 Ferrari 250 GTO |

### Price Coverage by Decade
| Era | Vehicles w/ Prices | Avg Sale Price | Total Value |
|-----|-------------------|----------------|-------------|
| Pre-1950 | 42,244 | $134,357 | ~$5.67B |
| 1950s | 54,606 | $116,310 | ~$6.35B |
| 1960s | 116,485 | $88,700 | ~$10.33B |
| 1970s | 82,589 | $52,174 | ~$4.31B |
| 1980s | 46,198 | $40,901 | ~$1.89B |
| 1990s | 54,284 | $47,722 | ~$2.59B |
| 2000s | 64,032 | $48,217 | ~$3.09B |
| 2010s | 33,668 | $146,119 | ~$4.92B |
| 2020s | 11,475 | $210,680 | ~$2.42B |

### Top Makes by Volume
| Make | Count | % of Total |
|------|-------|-----------|
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

### Data Source Ecosystem (80 sources across 9 categories)
| Category | Sources | Examples |
|----------|---------|---------|
| Registry | 34 | Ferrari Classiche (0.98), Porsche CoA (0.98), NHTSA (0.95), State DMVs (0.95), Galen Govier (0.98) |
| Auction | 12 | BaT (0.85), RM Sotheby's (0.90), Bonhams (0.90), Mecum (0.75), Gooding (0.90), Barrett-Jackson (0.75) |
| Forum | 12 | Rennlist (0.60), Pelican Parts (0.60), NastyZ28 (0.50), model-specific forums |
| Shop | 9 | ICON 4x4 (0.85), Ringbrothers (0.85), Velocity Restorations (0.85) |
| Marketplace | 7 | Hagerty (0.70), Classic Driver (0.75), AutoTrader Classics (0.75) |
| Social Media | 2 | Instagram (0.40), YouTube (0.50) |
| Aggregator | 2 | Classic.com (0.65), Carfax competitor tracking (0.70) |
| Owner | 1 | Direct owner input (0.70) |
| Internal | 1 | System inference (0.50) |

### Growth Velocity
| Period | Vehicles Added | Rate |
|--------|---------------|------|
| Pre-Nov 2025 | ~100 | Seed phase |
| Dec 2025 | 9,697 | Initial extraction runs |
| Jan 2026 | 196,417 | Pipeline activation |
| Feb 1-8 2026 | 561,994 | Full autonomous operation |
| Last 24 hours | 8,320 | Ongoing autonomous ingestion |

### Queue Health
| Status | Count |
|--------|-------|
| Complete | 241,914 |
| Pending | 69 |
| Failed | 74,437 |
| Skipped | 21,031 |
| Active sources | 451 |

### Infrastructure
| Component | Detail |
|-----------|--------|
| Edge Functions | 310 Deno TypeScript microservices |
| Database Tables | 922 PostgreSQL tables |
| Tech Stack | Elixir/Phoenix + React + Supabase + PyTorch |
| Frontend Pages | 93+ pages/components |
| SDK | Production TypeScript SDK (nuke-sdk) |
| ML Models | YONO (EfficientNet-B0, 5 training phases) |
| API Endpoints | RESTful (vehicles, observations, batch, webhooks) |

---

## TECHNOLOGY ASSETS (Named & Unnamed)

### Named Assets
| Name | What It Is | Status |
|------|-----------|--------|
| **YONO** | "You Only Nuke Once" - Vehicle image classification ML system | 5 training phases, 100K+ training images, EfficientNet-B0 |
| **Ralph Wiggum** | Autonomous extraction coordinator / AI operations persona | Production - manages queue, error triage, priority routing |
| **Nuke SDK** | Official TypeScript API client for third-party integration | Production-ready, 1,309 lines, full docs |
| **Universal Search** | Magic input handler - searches vehicles, orgs, users, tags | Production |

### Unnamed Assets (Need Names for Investor Materials)
| What It Does | Suggested Category |
|-------------|-------------------|
| Observation system (source-agnostic event store with confidence scoring) | Core Architecture |
| Confidence/trust scoring framework (0.0-1.0 per source) | Data Quality Engine |
| Discovery snowball (recursive lead finding from forum threads) | Growth Engine |
| Vehicle intelligence extraction (LLM → structured fields) | AI Extraction |
| Schema discovery principle (data-first schema design) | Methodology |
| Multi-agent coordination system | Operations |
| Bitemporal timeline tracking | Core Architecture |

---

## CALCULATIONS AVAILABLE NOW (Can Compute for Documents)

### 1. Market Coverage
- **Our vehicles**: 768,288
- **US collector vehicles**: 43 million (Hagerty)
- **US car enthusiasts**: 69 million (Hagerty)
- **Total insurable value**: $1 trillion+ (Hagerty)
- **Coverage**: 1.8% of total US collector vehicles
- **Transaction coverage**: $41.6B tracked vs $4.8B/year auction market = 8.7x annual volume

### 2. Data Density per Vehicle
- Avg images per vehicle: 28.3M / 768K = ~36.9 images per vehicle
- Avg comments per vehicle (BaT): 10.8M / 132K listings = ~82 comments per listing
- Avg bids per vehicle (BaT): 3.4M / 132K = ~26 bids per listing

### 3. AI Processing Depth
- 127,109 vehicles with sentiment analysis (16.5% of total)
- 474,484 vehicles with valuation estimates (61.7% of total)
- 212,985 images with AI extraction (0.75% of images - huge growth opportunity)

### 4. Revenue Modeling (Scenarios)
At different API pricing tiers:
| Scenario | Price/Vehicle/Year | Revenue (at 100K subscribers) |
|----------|-------------------|-------------------------------|
| Basic lookup | $0.50 | $50K/yr |
| Full profile | $5.00 | $500K/yr |
| API subscription | $99/mo per org | depends on org count |
| Data licensing | $0.01/record/year | $7.68M at full DB |
| Valuation report | $25/report | $11.86M at current estimate volume |

### 5. Data Growth Projection
- Dec→Jan growth: 20.2x (9.7K → 196K)
- Jan→Feb (projected): 3.4x (196K → ~672K in 8 days)
- At current daily rate (8,320/day): +3M vehicles/year
- Total US collector market: 43M vehicles (Hagerty)
- Annual auction market: $4.8B, ~71K vehicles sold (2025)
- Global classic car market: $39.7B (2024) → $77.8B projected (2032), 8.7% CAGR

---

## PIPELINE ADDITIONS - STATUS

### COMPLETED (Results in Investor Docs)

#### 1. Price Prediction Accuracy Score ✅
**Result**: 6.3% median error across 447,928 comparable pairs.
**By segment**: Under $25K: 9.7%, $25-50K: 6.2%, $50-100K: 3.3%, $100K+: <1%
**Used in**: Teaser, BP, IM

#### 3. Data Freshness Distribution ✅
**Result**: 64.5% within 24h, 97.8% within 7 days, 100% within 30 days
**Used in**: Teaser (97.8% stat), BP, IM

#### 5. Organization Revenue Potential ✅
**Result**: 2,401 businesses: 108 dealers, 67 garages, 52 auction houses, 4 restoration shops, 3 performance shops, 2,167 pending classification
**Used in**: BP, IM

#### 7. Sentiment → Price Correlation ✅
**Result**: 100,712 vehicles analyzed. Very Negative: $13,250 median → Very Positive: $25,000 median = 89% premium. Avg sentiment: 0.79
**Detailed**: Very Negative (1,447 vehicles, avg $17,877), Negative (2,777, avg $26,831), Neutral (8,031, avg $27,162), Positive (25,291, avg $32,430), Very Positive (63,166, avg $45,410)
**Used in**: Teaser, BP, IM

#### 8. VIN Coverage Rate ✅
**Result**: 21.0% (161,065 of 768,309). Many collector vehicles predate VIN standardization (1981).
**Used in**: BP, IM

### REMAINING (Pipeline Additions to Build)

#### 2. Multi-Source Correlation Score
**Status**: Observation system has limited data (only 20 vehicles with 2+ sources). Most data flows through dedicated extractors, not the observation system yet. This stat will improve as more data migrates to observation architecture.
**Action**: Track cross-table corroboration (vehicles with data in images + comments + bids + estimates).

#### 4. User Engagement Scoring
**What**: Activity levels of the 493K tracked users
**Why**: Shows community/marketplace potential. "Top 10% of users participate in X auctions per year."

#### 6. Geographic Coverage Heat Map
**What**: Vehicle distribution by state/county (zip_to_fips has 41K entries)
**Why**: Shows national coverage. Can generate an actual map.

#### 9. Duplicate Detection Effectiveness
**What**: Of 336K duplicate detection jobs, how many actual duplicates found and merged?
**Why**: Shows data quality commitment.

#### 10. Time-Series Value Index ("Nuke Index")
**What**: Track average prices by make/model over time (we have enough historical data)
**Why**: "Nuke Index" - like the S&P 500 for collector cars. This is the killer product.

---

## WHAT WE CANNOT COMPUTE (Need From Founders)

1. ~~**Project name**~~ → **N-Zero** ✅
2. ~~**Founder bios**~~ → Skylar Williams, Founder & CEO. Found in DB (business_related_persons). ✅
3. ~~**Revenue model**~~ → 8-stream model documented ✅
4. ~~**The ask**~~ → $2M Post-Money SAFE, $18M cap, detailed use of funds ✅
5. ~~**Legal entity**~~ → Nuke Ltd, Nevada 2022, 10M auth / 1M issued, 100% founder, $0 debt ✅
6. ~~**Competitive positioning narrative**~~ → "Enabler, Not Competitor" ✅
7. ~~**Visual identity**~~ → Retro-modern Windows 95, #66ccff logo, 20+ automotive themes ✅
8. ~~**Current monthly burn rate**~~ → ~$1,000-$1,600/mo (Supabase, OpenAI, Anthropic, Cursor, Firecrawl) ✅
9. ~~**Advisory board**~~ → AI advisory agents (public) + human strategic network (Combres, Goldfarb, Lopez, Harris) ✅
10. ~~**Co-founder need**~~ → Documented as #1 hire priority, 40% of use of funds ✅

---

## MARKET RESEARCH SOURCES

| Data Point | Value | Source |
|-----------|-------|--------|
| 43M collector vehicles in US | Hagerty | hagertyagent.com/resources/hagerty-insights |
| $1T+ insurable value | Hagerty | hagertyagent.com/resources/hagerty-insights |
| 69M car enthusiasts in US | Hagerty | hagertyagent.com/resources/hagerty-insights |
| $4.8B auction + online sales (2025) | Hagerty via CNBC | cnbc.com (Dec 19, 2025) |
| 10% YoY auction market growth | Hagerty via CNBC | cnbc.com (Dec 19, 2025) |
| $2.5B online / $2.3B live split | Hagerty | hagerty.com/media/market-trends |
| ~71K vehicles sold at auction (2025) | Hagerty | hagerty.com/media/market-trends |
| $1B seven-figure car sales record | Hagerty | carbuzz.com/2025-collector-car-market-results |
| $39.7B global classic car market (2024) | Credence Research | credenceresearch.com |
| $77.8B projected (2032), 8.7% CAGR | Credence Research | credenceresearch.com |
| 2.7M vehicles insured by Hagerty | Hagerty | hagerty.com |
| Strong 2026 outlook | Hagerty CEO | cnbc.com (Dec 19, 2025) |
