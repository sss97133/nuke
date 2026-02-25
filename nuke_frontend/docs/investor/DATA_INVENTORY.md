# Investor Document Data Inventory
## Factual Data Available vs. Needed

Generated: {{GENERATED_DATE_ISO}} from live database queries

---

## HARD NUMBERS (Verified from DB)

### Platform Scale
| Metric | Value | Source |
|--------|-------|--------|
| Total vehicles tracked | {{VEHICLE_COUNT}} | `SELECT COUNT(*) FROM vehicles` |
| Total vehicle images | {{IMAGE_COUNT_EXACT}} | `vehicle_images` table |
| Total auction comments ingested | {{COMMENT_COUNT_EXACT}} | `auction_comments` table |
| Total bids tracked | {{BID_COUNT}} | `bat_bids` table |
| Total dollar volume tracked | {{TOTAL_VALUE_EXACT}} | `SUM(sale_price)` |
| Vehicles with price data | {{VEHICLES_WITH_PRICE}} | `WHERE sale_price > 0` |
| AI sentiment analyses completed | {{ANALYSIS_COUNT}} | `comment_discoveries` |
| Valuation estimates generated | {{ESTIMATE_COUNT}} | `nuke_estimates` |
| User profiles mapped | {{USER_PROFILES}} | `bat_user_profiles` |
| External identities | {{IDENTITY_COUNT}} | `external_identities` |
| Vehicle observations | {{OBSERVATIONS_COUNT}} | `vehicle_observations` |
| Image AI extractions | {{IMAGE_EXTRACTIONS}} | `image_work_extractions` |
| Database size | {{DB_SIZE_GB}} GB | `pg_database_size()` |
| Database tables | {{TABLE_COUNT}} | `pg_stat_user_tables` |
| Edge functions deployed | {{EDGE_FUNCTION_COUNT}} | directory count |
| Registered data sources | 80 | `observation_sources` |

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
| Feb 1-8 2026 | 561,994 | Setting the foundation for autonomous |
| Last 24 hours | {{DAILY_RATE}} | Ongoing autonomous ingestion |

### Queue Health
| Status | Count |
|--------|-------|
| Complete | {{QUEUE_COMPLETE}} |
| Pending | {{QUEUE_PENDING}} |
| Failed | {{QUEUE_FAILED}} |
| Data freshness | {{DATA_FRESHNESS}} updated within 7 days |

### Infrastructure
| Component | Detail |
|-----------|--------|
| Edge Functions | {{EDGE_FUNCTION_COUNT}} Deno TypeScript microservices |
| Database Tables | {{TABLE_COUNT}} PostgreSQL tables |
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
- **Our vehicles**: {{VEHICLE_COUNT}}
- **US collector vehicles**: 43 million (Hagerty)
- **US car enthusiasts**: 69 million (Hagerty)
- **Total insurable value**: $1 trillion+ (Hagerty)
- **Transaction coverage**: {{TOTAL_VALUE_B}} tracked vs $4.8B/year auction market

### 2. Data Density per Vehicle
- Avg images per vehicle: {{IMAGE_COUNT_M}} / {{VEHICLE_COUNT}} = ~36.9 images per vehicle
- Avg comments per vehicle (BaT): {{COMMENT_COUNT_M}} / 132K listings = ~82 comments per listing

### 3. AI Processing Depth
- {{ANALYSIS_COUNT}} vehicles with sentiment analysis
- {{ESTIMATE_COUNT}} vehicles with valuation estimates
- {{IMAGE_EXTRACTIONS}} images with AI extraction

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
- At current daily rate ({{DAILY_RATE}}/day): +3M vehicles/year
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
**Result**: 64.5% within 24h, {{DATA_FRESHNESS}} within 7 days, 100% within 30 days
**Used in**: Teaser ({{DATA_FRESHNESS}} stat), BP, IM

#### 5. Organization Revenue Potential ✅
**Result**: {{ORG_COUNT}} businesses: 108 dealers, 67 garages, 52 auction houses, 4 restoration shops, 3 performance shops, remainder pending classification
**Used in**: BP, IM

#### 7. Sentiment → Price Correlation ✅
**Result**: {{ANALYSIS_COUNT}} vehicles analyzed. Very Negative: $13,250 median → Very Positive: $25,000 median = 89% premium. Avg sentiment: 0.79
**Used in**: Teaser, BP, IM

#### 8. VIN Coverage Rate ✅
**Result**: 21.0% (161,065 of {{VEHICLE_COUNT}}). Many collector vehicles predate VIN standardization (1981).
**Used in**: BP, IM

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
