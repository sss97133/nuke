# PROJECT N-ZERO
## Technical Exhibits & Platform Documentation

**CONFIDENTIAL**
**February 2026**

---

## Table of Contents

1. Platform Architecture Deep Dive
2. Database Architecture & Schema
3. Edge Function Registry (Complete)
4. Autonomous Operations: Ralph Wiggum
5. Image Intelligence: YONO Pipeline
6. Observation System Architecture
7. Valuation Engine Technical Detail
8. Nuke SDK & API Specification
9. Sample Vehicle Intelligence Profiles
10. Data Quality & Integrity Framework
11. Security Architecture
12. Scalability & Infrastructure Roadmap
13. Nuke Index: Market Intelligence Product

---

## 1. PLATFORM ARCHITECTURE DEEP DIVE

### System Topology

```
                    ┌─────────────────────────────────┐
                    │          DATA SOURCES            │
                    │                                  │
                    │  Auctions   Forums    Registries │
                    │  Shops      Social    Government │
                    │  Owners     Markets   Aggregators│
                    │     80+ source types, 9 categories│
                    └──────────────┬────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │     INGESTION LAYER               │
                    │                                    │
                    │  ┌──────────┐  ┌───────────────┐  │
                    │  │ Firecrawl │  │ Direct API    │  │
                    │  │ (JS render)│  │ Integration   │  │
                    │  └────┬──────┘  └──────┬────────┘  │
                    │       │                │            │
                    │  ┌────▼────────────────▼─────────┐ │
                    │  │   310 Edge Functions (Deno)    │ │
                    │  │   Autonomous TypeScript workers │ │
                    │  └────────────┬───────────────────┘ │
                    │               │                      │
                    │  ┌────────────▼───────────────────┐  │
                    │  │   Ralph Wiggum Coordinator     │  │
                    │  │   Queue health, error triage,  │  │
                    │  │   priority routing, self-heal  │  │
                    │  └────────────┬───────────────────┘  │
                    └───────────────┼───────────────────────┘
                                    │
                    ┌───────────────▼───────────────────────┐
                    │      STORAGE LAYER                     │
                    │                                        │
                    │  PostgreSQL (Supabase)                 │
                    │  922 tables │ 100 GB │ 768K vehicles   │
                    │                                        │
                    │  ┌─────────────────────────────────┐   │
                    │  │  Observation Store (Immutable)   │   │
                    │  │  Source-agnostic, bitemporal     │   │
                    │  │  Confidence-scored per data point│   │
                    │  │  628,695 observations            │   │
                    │  └─────────────────────────────────┘   │
                    │                                        │
                    │  ┌─────────────────────────────────┐   │
                    │  │  Entity Tables                   │   │
                    │  │  vehicles (768K) │ images (28.3M)│   │
                    │  │  comments (10.8M) │ bids (3.4M)  │   │
                    │  │  profiles (493K) │ orgs (2,401)  │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼───────────────────────┐
                    │      INTELLIGENCE LAYER                │
                    │                                        │
                    │  ┌──────────┐ ┌───────────┐            │
                    │  │ Valuation│ │ Sentiment │            │
                    │  │ Engine   │ │ Engine    │            │
                    │  │ 474K est.│ │ 127K anal.│            │
                    │  │ 6.3% err │ │ 89% corr. │            │
                    │  └──────────┘ └───────────┘            │
                    │                                        │
                    │  ┌──────────┐ ┌───────────┐            │
                    │  │ YONO     │ │ Field     │            │
                    │  │ Image AI │ │ Extraction│            │
                    │  │ 212K img │ │ 2.9M logs │            │
                    │  │ 300+ make│ │ 119 fields│            │
                    │  └──────────┘ └───────────┘            │
                    │                                        │
                    │  ┌──────────────────────────────────┐  │
                    │  │  Timeline Construction           │  │
                    │  │  767,940 lifecycle events         │  │
                    │  └──────────────────────────────────┘  │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼───────────────────────┐
                    │      DISTRIBUTION LAYER                │
                    │                                        │
                    │  ┌──────────┐ ┌──────────┐ ┌────────┐ │
                    │  │ Nuke SDK │ │ REST API │ │Webhooks│ │
                    │  │ TypeScript│ │ HTTP/JSON│ │HMAC-256│ │
                    │  └──────────┘ └──────────┘ └────────┘ │
                    │                                        │
                    │  ┌──────────────────────────────────┐  │
                    │  │  React Frontend (93+ pages)      │  │
                    │  │  Organization dashboards          │  │
                    │  │  Vehicle profiles & search        │  │
                    │  │  Auction marketplace              │  │
                    │  │  Admin mission control            │  │
                    │  └──────────────────────────────────┘  │
                    └────────────────────────────────────────┘
```

### Technology Stack Detail

| Component | Technology | Version/Detail | Why This Choice |
|-----------|-----------|----------------|-----------------|
| **Runtime** | Deno | TypeScript-native | Secure by default, built-in TypeScript, no node_modules |
| **Database** | PostgreSQL | Via Supabase | Row-level security, real-time subscriptions, edge functions |
| **Backend** | Elixir/Phoenix | OTP platform | Fault tolerance, massive concurrency, hot code reloading |
| **Frontend** | React + TypeScript | Vite build | Type safety, fast dev iteration, 93+ components |
| **ML/Vision** | PyTorch | EfficientNet-B0 | YONO: 5M params, proven mobile-class accuracy |
| **LLM** | OpenAI + Anthropic | GPT-4o + Claude | Structured extraction, sentiment analysis, coordination |
| **Scraping** | Firecrawl | JS-rendered | Handles SPAs, dynamic content, anti-bot bypass |
| **Hosting** | Supabase + Vercel | Cloud-native | Auto-scaling, global CDN, edge compute |
| **Secrets** | dotenvx | Encrypted at rest | No .env files in source, team-safe |
| **Version Control** | Git | GitHub | Standard, CI/CD integration |

### Request Flow: Vehicle Extraction

```
1. Source URL detected (queue, discovery, manual)
                    │
2. Ralph Wiggum assigns priority and selects extractor
                    │
3. Extractor edge function invoked
   ├── Firecrawl scrapes URL (if needed)
   ├── AI extracts structured fields
   ├── Images enumerated and stored
   └── Source metadata recorded
                    │
4. Data written to observation store
   ├── vehicle_observations (immutable)
   ├── vehicles (upsert core entity)
   ├── vehicle_images (all photos)
   └── import_queue (status update)
                    │
5. Intelligence pipeline triggered
   ├── Valuation engine (comparable sales analysis)
   ├── Sentiment engine (if comments exist)
   ├── YONO (image classification)
   └── Field extraction (LLM → 119 structured fields)
                    │
6. Timeline event created
   └── vehicle lifecycle event for provenance chain
                    │
7. Distribution layer updated
   ├── Search index refreshed
   ├── Webhook events dispatched
   └── SDK cache invalidated
```

---

## 2. DATABASE ARCHITECTURE & SCHEMA

### Schema Organization

The 922-table database is organized into 10 functional domains:

#### Domain: Vehicles (~50 tables)

Core entity tables that define the vehicle data model.

| Table | Records | Primary Key | Key Relationships |
|-------|---------|-------------|-------------------|
| `vehicles` | 768,288 | UUID | Central entity - all tables reference this |
| `vehicle_images` | 28,361,696 | UUID | FK → vehicles. Stores URL, source, metadata |
| `vehicle_observations` | 628,695 | UUID | FK → vehicles, observation_sources. Immutable events |
| `vehicle_quality_scores` | 735,816 | UUID | FK → vehicles. Computed data completeness metrics |
| `vehicle_status_metadata` | 706,866 | UUID | FK → vehicles. Processing status tracking |
| `vehicle_field_evidence` | 513,282 | UUID | FK → vehicles. Per-field provenance records |
| `vehicle_agents` | 208,373 | UUID | FK → vehicles. Autonomous agent assignments |
| `vehicle_sentiment` | 126,941 | UUID | FK → vehicles. Aggregated sentiment scores |
| `vehicle_valuation_feed` | 471,886 | UUID | FK → vehicles. Continuous valuation updates |
| `vehicle_mailboxes` | 462,940 | UUID | FK → vehicles. Communication channels |
| `vehicle_reference_links` | 437,018 | UUID | FK → vehicles. Cross-reference URLs |
| `vehicle_price_history` | 237,639 | UUID | FK → vehicles. Historical price records |
| `vehicle_form_completions` | 62,470 | UUID | FK → vehicles. Data completeness tracking |

#### Domain: Auction Data (~30 tables)

Structured auction event data from all tracked platforms.

| Table | Records | Description |
|-------|---------|-------------|
| `auction_events` | 119,579 | Individual auction instances with platform, date, result |
| `auction_comments` | 10,876,766 | Full comment text with author, timestamp, vehicle reference |
| `bat_bids` | 3,486,742 | Individual bid records with amount, bidder, time |
| `bat_listings` | 132,591 | BaT-specific listing metadata (comment count, status) |
| `bat_user_profiles` | 493,265 | Ecosystem participant profiles (buyers, sellers, commenters) |
| `clean_vehicle_prices` | 476,415 | Normalized, deduplicated price records |
| `auction_listings` | ~100,000 | Cross-platform auction listing records |

#### Domain: Intelligence (~40 tables)

AI-generated insights and analysis results.

| Table | Records | Description |
|-------|---------|-------------|
| `nuke_estimates` | 474,484 | AI valuation estimates with confidence intervals |
| `comment_discoveries` | 127,101 | Sentiment analysis results per vehicle |
| `image_work_extractions` | 212,985 | YONO image classification output |
| `image_tags` | 203,065 | Auto-generated image tags |
| `image_camera_position` | 86,823 | Camera angle classification (front, rear, 3/4, etc.) |
| `image_coordinate_observations` | 79,883 | GPS/location data from images |
| `description_discoveries` | ~50,000 | AI-extracted fields from vehicle descriptions |

#### Domain: Organizations (~50 tables)

Business entity tracking and intelligence.

| Table | Records | Description |
|-------|---------|-------------|
| `businesses` | 2,401 | Core business entities (dealers, shops, auction houses) |
| `organization_behavior_signals` | 137,561 | Activity patterns, engagement metrics |
| `organization_vehicles` | 67,973 | Vehicle-business associations |
| `organization_images` | ~10,000 | Business logos, facility photos |
| `organization_capabilities` | ~5,000 | Service offerings, specializations |
| `organization_inventory` | ~15,000 | Current inventory tracking |
| `business_financial_statements` | ~500 | Financial data where available |
| `business_share_classes` | ~200 | Capital structure data |

#### Domain: Pipeline (~40 tables)

Extraction pipeline management and monitoring.

| Table | Records | Description |
|-------|---------|-------------|
| `import_queue` | 377,873 | Extraction job tracking (status, priority, retries) |
| `service_executions` | 284,005 | Edge function execution logs |
| `field_extraction_log` | 2,901,902 | Per-field AI extraction audit trail |
| `extraction_metadata` | 206,635 | Source-specific extraction configuration |
| `listing_page_snapshots` | 325,367 | Archived source page content |
| `scraping_health` | 2,318,506 | Source availability and error monitoring |
| `duplicate_detection_jobs` | 336,425 | Deduplication processing records |

#### Domain: Observations (~15 tables)

The source-agnostic data architecture layer.

| Table | Records | Description |
|-------|---------|-------------|
| `observation_sources` | 80 | Registered data source definitions |
| `vehicle_observations` | 628,695 | Immutable observation events |
| `observation_extractors` | ~50 | Extraction configuration per source |
| `observation_discoveries` | ~30,000 | AI insights derived from observations |

### Data Relationships

```
vehicles ────────────────────────────────────────────────
    │
    ├── vehicle_images (28.3M)
    │       └── image_work_extractions (YONO output)
    │       └── image_tags (auto-generated)
    │       └── image_camera_position (angle detection)
    │
    ├── auction_events (119K)
    │       └── auction_comments (10.8M)
    │       └── bat_bids (3.4M)
    │
    ├── vehicle_observations (628K)
    │       └── observation_sources (provenance)
    │       └── observation_discoveries (AI insights)
    │
    ├── nuke_estimates (474K valuation estimates)
    │
    ├── comment_discoveries (127K sentiment analyses)
    │
    ├── vehicle_field_evidence (513K per-field provenance)
    │
    ├── timeline_events (767K lifecycle events)
    │
    ├── vehicle_quality_scores (735K completeness metrics)
    │
    ├── organization_vehicles (67K org associations)
    │
    └── vehicle_price_history (237K historical prices)
```

### Bitemporal Data Model

Every observation in Nuke carries two timestamps:

| Timestamp | Meaning | Example |
|-----------|---------|---------|
| `observed_at` | When the event actually occurred | "Vehicle sold on Jan 15, 2024" |
| `ingested_at` | When Nuke recorded the data | "We extracted this record on Feb 3, 2026" |

This bitemporal model enables:
- **As-of queries**: "What did we know about this vehicle on date X?"
- **Provenance tracking**: "When did we learn each fact?"
- **Conflict resolution**: Later ingestions with earlier observation dates take precedence
- **Audit trail**: Complete history of data acquisition

---

## 3. EDGE FUNCTION REGISTRY (COMPLETE)

310 deployed Deno TypeScript edge functions, organized by category:

### Extraction Functions (~80 functions)

| Function | Source | Vehicles Processed | Description |
|----------|--------|-------------------|-------------|
| `bat-simple-extract` | Bring a Trailer | 107,310 | Core BaT listing extractor |
| `extract-cars-and-bids-core` | Cars & Bids | 900 | C&B listing extraction |
| `extract-hagerty-listing` | Hagerty | ~5,000 | Hagerty Marketplace listings |
| `import-pcarmarket-listing` | PCarMarket | 70 | PCarMarket European listings |
| `extract-vehicle-data-ai` | Any URL | ~50,000 | Universal AI-powered extraction |
| `extract-auction-comments` | BaT | 10.8M comments | Comment scraping and parsing |
| `extract-bat-bids` | BaT | 3.4M bids | Bid history extraction |
| `extract-mecum-listing` | Mecum | 7,480 | Mecum auction extraction |
| `extract-collecting-cars` | Collecting Cars | 122 | UK auction platform |
| `extract-facebook-marketplace` | Facebook | 139 | Social marketplace scraping |
| `extract-broad-arrow` | Broad Arrow | ~500 | Hagerty-owned auction |
| `extract-rm-sothebys` | RM Sotheby's | ~3,000 | Premium auction data |
| `extract-bonhams` | Bonhams | ~2,000 | European/US premium auction |
| `extract-gooding` | Gooding & Co | ~1,000 | Monterey auction specialist |
| `extract-barrett-jackson` | Barrett-Jackson | ~3,000 | High-volume live auction |
| `scrape-classic-driver` | Classic Driver | ~2,000 | European marketplace |

### Analysis Functions (~40 functions)

| Function | Purpose | Records Processed |
|----------|---------|-------------------|
| `discover-comment-data` | Sentiment analysis from comments | 127,109 vehicles |
| `discover-from-observations` | Source-agnostic AI analysis | ~30,000 |
| `yono-classify-image` | Vehicle image classification | 212,985 images |
| `extract-vehicle-intelligence` | LLM structured field extraction | 2.9M log entries |
| `compute-vehicle-quality-score` | Data completeness scoring | 735,816 vehicles |
| `analyze-camera-position` | Image angle detection | 86,823 images |
| `generate-image-tags` | Auto-tag generation | 203,065 images |
| `compute-nuke-estimate` | AI valuation engine | 474,484 estimates |
| `sentiment-price-correlator` | Sentiment-price analysis | 100,712 vehicles |
| `build-vehicle-timeline` | Timeline event construction | 767,940 events |

### API & Distribution Functions (~30 functions)

| Function | Purpose | Daily Calls |
|----------|---------|-------------|
| `universal-search` | Multi-entity search (vehicles, orgs, users, tags) | ~5,000 |
| `vehicle-lookup` | Single vehicle detail API | ~3,000 |
| `batch-operations` | Bulk CRUD operations | ~500 |
| `webhook-dispatch` | Real-time event notifications | ~1,000 |
| `nuke-sdk-handler` | SDK request processor | ~2,000 |
| `db-stats` | System health and statistics | ~200 |
| `vehicle-valuation-api` | External valuation endpoint | ~500 |

### Coordination & Operations (~20 functions)

| Function | Purpose | Key Metric |
|----------|---------|------------|
| `ralph-wiggum-rlm-extraction-coordinator` | Autonomous pipeline management | 241K completions |
| `backfill-comments` | Historical comment extraction | 10.8M comments |
| `discovery-snowball` | Recursive lead discovery from forums | ~50K leads |
| `queue-manager` | Import queue CRUD and monitoring | 377K jobs |
| `reprocess-failed` | Retry failed extractions with new logic | 74K retries |
| `health-check` | System-wide health monitoring | Every 5 min |

### Organization Intelligence (~25 functions)

| Function | Purpose |
|----------|---------|
| `org-intelligence-analyzer` | Business entity analysis and scoring |
| `org-behavior-signal` | Activity pattern detection |
| `org-inventory-sync` | Inventory tracking and updates |
| `org-financial-analyzer` | Financial data extraction (where available) |
| `org-capability-mapper` | Service offering classification |
| `org-vehicle-linker` | Vehicle-business association |

### Data Quality (~15 functions)

| Function | Purpose | Records |
|----------|---------|---------|
| `duplicate-detection` | Identify potential duplicate vehicles | 336K jobs |
| `data-freshness-check` | Monitor data recency | 2.3M checks |
| `vin-validator` | VIN format and checksum validation | 161K VINs |
| `price-anomaly-detector` | Flag suspicious price data | ~500K checks |
| `image-deduplicator` | Identify duplicate images | ~28M images |

---

## 4. AUTONOMOUS OPERATIONS: RALPH WIGGUM

### Architecture

Ralph Wiggum is the autonomous extraction coordinator - an AI-powered operations system that manages the entire data pipeline without human intervention.

```
                    ┌──────────────────────────────┐
                    │        RALPH WIGGUM          │
                    │   Extraction Coordinator     │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │   Queue Health Monitor  │  │
                    │  │   • Pending: 69         │  │
                    │  │   • Processing: ~100    │  │
                    │  │   • Failed: 74,437      │  │
                    │  │   • Complete: 241,914   │  │
                    │  └────────────────────────┘  │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │   Error Triage Engine   │  │
                    │  │   • Domain-level analysis│  │
                    │  │   • Pattern detection    │  │
                    │  │   • Auto-retry logic     │  │
                    │  │   • Source blacklisting  │  │
                    │  └────────────────────────┘  │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │   Priority Router       │  │
                    │  │   • High-value vehicles │  │
                    │  │   • Trending makes      │  │
                    │  │   • Data gap filling     │  │
                    │  │   • Source rotation      │  │
                    │  └────────────────────────┘  │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │   RLM Context Engine    │  │
                    │  │   • Recursive Language  │  │
                    │  │     Model compression   │  │
                    │  │   • Context window mgmt │  │
                    │  │   • Decision logging    │  │
                    │  └────────────────────────┘  │
                    └──────────────────────────────┘
```

### Operational Statistics

| Metric | Value | Trend |
|--------|-------|-------|
| Total queue completions | 241,914 | Growing |
| Queue pending | 69 | Healthy (low) |
| Queue failed | 74,437 | 23% failure rate (improving) |
| Queue skipped | 21,031 | Intentional (duplicates, blocked) |
| Active sources | 451 | Expanding |
| Service executions | 284,005 | Continuous |
| Daily vehicle additions | 8,320+ | Accelerating |
| Uptime (self-healing) | >99% | Zero-downtime extraction |

### Error Classification

Ralph Wiggum classifies errors into actionable categories:

| Error Category | Count | Auto-Recovery | Action |
|---------------|-------|---------------|--------|
| **Rate limited** | ~15,000 | Yes | Automatic backoff and retry |
| **Source unavailable** | ~12,000 | Yes | Deprioritize source, try later |
| **Parse failure** | ~10,000 | Partial | Try alternative extractor |
| **Authentication** | ~8,000 | No | Flag for manual review |
| **Data quality** | ~7,000 | Yes | Skip and log for audit |
| **Network timeout** | ~5,000 | Yes | Retry with exponential backoff |
| **Unknown** | ~17,000 | Varies | Pattern analysis and routing |

### Self-Healing Example

```
1. Source "classic-car-forum.example" starts returning 403 errors
2. Ralph Wiggum detects: 5 consecutive failures from this domain
3. Action: Deprioritize domain (move to low-priority queue)
4. Action: Route affected vehicles to alternative sources
5. Action: Schedule domain re-check in 24 hours
6. Action: Flag domain in scraping_health table
7. Result: Pipeline continues without interruption
8. Result: 24h later, domain re-tested. If recovered, resume normal priority.
```

### Coordination Brief Format

Ralph Wiggum generates operational briefs on demand:

```json
{
  "brief_type": "coordination",
  "queue_health": {
    "pending": 69,
    "processing": 112,
    "completed_24h": 8320,
    "failed_24h": 247,
    "success_rate": "97.1%"
  },
  "top_errors": [
    {"domain": "example.com", "count": 15, "pattern": "rate_limit"},
    {"domain": "forum.example", "count": 8, "pattern": "parse_failure"}
  ],
  "recommendations": [
    "Expand Craigslist coverage (high vehicle volume, low extraction rate)",
    "Retry Barrett-Jackson Q4 listings (temporary block cleared)",
    "Prioritize JDM extraction (25-year rule makes 2001 models eligible)"
  ],
  "system_health": "OPERATIONAL"
}
```

---

## 5. IMAGE INTELLIGENCE: YONO PIPELINE

### Training Architecture

YONO ("You Only Nuke Once") is a proprietary vehicle image classification system built on EfficientNet-B0.

| Parameter | Value |
|-----------|-------|
| Base architecture | EfficientNet-B0 |
| Total parameters | 5.3 million |
| Input resolution | 224 x 224 pixels |
| Training framework | PyTorch |
| Training hardware | NVIDIA GPU (cloud) |
| Total training images | 100,000+ |
| Vehicle makes covered | 300+ |
| Classification tasks | Make ID, angle, quality, vehicle/non-vehicle |

### Progressive Training Phases

| Phase | Images | Focus | Result |
|-------|--------|-------|--------|
| **Phase 1** | 25,000 | Vehicle vs. non-vehicle binary classification | Baseline accuracy. Filters out document scans, people photos, parts closeups |
| **Phase 2** | 50,000 | Make identification (top 50 makes by volume) | Chevrolet, Ford, Porsche, Ferrari, Mercedes-Benz, BMW, etc. |
| **Phase 3** | 75,000 | Make + camera angle classification | Front, rear, side, 3/4, interior, engine bay, detail, aerial |
| **Phase 4** | 90,000 | Extended make coverage (200+ makes) | Covers 95% of database by vehicle volume |
| **Phase 5** | 100,000+ | Full production (300+ makes, all angles) | Production-grade accuracy for all classification tasks |

### YONO Output Schema

For each image processed, YONO produces:

```json
{
  "image_id": "uuid",
  "vehicle_id": "uuid",
  "classifications": {
    "is_vehicle": true,
    "confidence": 0.97,
    "predicted_make": "Porsche",
    "make_confidence": 0.92,
    "camera_position": "three_quarter_front",
    "position_confidence": 0.88,
    "quality_score": 0.85
  },
  "tags": ["exterior", "outdoor", "daytime", "profile_view", "clean"],
  "metadata": {
    "resolution": "1920x1280",
    "aspect_ratio": 1.5,
    "dominant_colors": ["#C0C0C0", "#1a1a1a", "#4a90d9"],
    "has_background": true,
    "studio_shot": false
  }
}
```

### Production Metrics

| Metric | Value |
|--------|-------|
| Images indexed | 28,361,696 |
| Images with AI metadata | 212,985 |
| Images with auto-tags | 203,065 |
| Camera position analyses | 86,823 |
| Processing throughput | ~1,000 images/hour |
| Classification latency | ~200ms per image |
| Coverage of database (AI-processed) | 0.75% of all images |

**Growth opportunity:** At 0.75% coverage, the vast majority of the 28.3M image library has not yet been classified. Scaling YONO processing represents a significant untapped intelligence asset. At full coverage, every image in the database would carry make identification, angle classification, quality scoring, and auto-generated tags.

### Camera Position Distribution (86,823 analyzed images)

| Position | Count | % | Use Case |
|----------|-------|---|----------|
| Three-quarter front | ~22,000 | 25.3% | Hero shots, listing primary images |
| Side profile | ~15,000 | 17.3% | Body condition assessment |
| Front | ~12,000 | 13.8% | Grille/headlight identification |
| Three-quarter rear | ~10,000 | 11.5% | Tail design, spoiler detection |
| Interior | ~9,000 | 10.4% | Interior condition, originality |
| Rear | ~7,000 | 8.1% | Tail lights, badge identification |
| Engine bay | ~5,000 | 5.8% | Mechanical assessment, matching numbers |
| Detail | ~4,000 | 4.6% | VIN plates, badges, damage documentation |
| Aerial/overhead | ~1,800 | 2.1% | Overall condition, roof assessment |
| Undercarriage | ~1,000 | 1.2% | Frame/rust inspection |

---

## 6. OBSERVATION SYSTEM ARCHITECTURE

### Design Principles

The observation system is the architectural core of Nuke. It replaces traditional table-per-source data models with a unified, source-agnostic event store.

**Key design decisions:**

1. **Immutability**: Observations are never updated or deleted. New observations override old ones based on trust scoring.
2. **Source-agnostic**: The same observation structure stores data from BaT auctions, Ferrari Classiche registries, forum posts, and owner input.
3. **Confidence-scored**: Every observation carries a trust score derived from its source category.
4. **Bitemporal**: Each observation records both when the event occurred and when it was ingested.
5. **Content-hashed**: Deduplication via content hashing prevents redundant storage.

### Observation Schema

```sql
CREATE TABLE vehicle_observations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID REFERENCES vehicles(id),
    source_id       UUID REFERENCES observation_sources(id),

    -- What was observed
    observation_kind VARCHAR(50),    -- listing, sale_result, comment, bid, etc.
    observed_data    JSONB,          -- Structured observation content

    -- Provenance
    observed_at      TIMESTAMPTZ,    -- When the event actually occurred
    ingested_at      TIMESTAMPTZ DEFAULT now(),  -- When we recorded it
    source_url       TEXT,           -- Original source URL
    content_hash     TEXT,           -- Deduplication key

    -- Trust
    confidence_score NUMERIC(3,2),   -- 0.00 to 1.00

    -- Audit
    extractor_id     UUID,           -- Which edge function produced this
    raw_data         JSONB           -- Original unprocessed data
);
```

### Observation Kinds (14 types)

| Kind | Description | Example |
|------|-------------|---------|
| `listing` | Vehicle offered for sale | BaT listing created with description, photos, specs |
| `sale_result` | Transaction completed | Vehicle sold at Mecum for $85,000 |
| `comment` | Community discussion | "The paint looks original based on the door jambs" |
| `bid` | Auction bid placed | $72,000 bid at 2:34 PM from user "collector911" |
| `sighting` | Vehicle seen/photographed | Spotted at Amelia Island Concours |
| `work_record` | Service or restoration | Engine rebuild by Automotion in San Diego |
| `ownership` | Ownership change | Transferred to new owner in California |
| `specification` | Technical detail | Factory option code 450 = air conditioning |
| `provenance` | Historical documentation | Documented chain of ownership since 1972 |
| `valuation` | Price estimate or appraisal | Hagerty values this at $145,000 |
| `condition` | Physical condition report | Frame is solid, no rust, original paint |
| `media` | Photo, video, or document | 47 auction photos from RM Sotheby's |
| `social_mention` | Social media reference | Instagram post by @collecting_cars |
| `expert_opinion` | Professional assessment | "This is one of 12 known survivors" |

### Source Trust Scoring

Every data source carries a base trust score. This score is inherited by all observations from that source and can be adjusted per-observation based on corroboration.

**Trust Score Hierarchy:**

```
0.98  ████████████████████████████████████████████████░░  Factory registries (Ferrari Classiche, Porsche CoA)
0.95  ███████████████████████████████████████████████░░░  Government (NHTSA, State DMVs)
0.90  ██████████████████████████████████████████████░░░░  Premium auctions (RM Sotheby's, Bonhams, Gooding)
0.85  ████████████████████████████████████████████░░░░░░  Major online (BaT), premium shops (ICON 4x4)
0.80  ██████████████████████████████████████████░░░░░░░░  Growing platforms (Cars & Bids)
0.75  ████████████████████████████████████████░░░░░░░░░░  Volume auctions (Mecum, Barrett-Jackson), marketplaces
0.70  ██████████████████████████████████████░░░░░░░░░░░░  Insurance marketplaces (Hagerty), aggregators
0.60  ████████████████████████████████████░░░░░░░░░░░░░░  Enthusiast forums (Rennlist, Pelican Parts)
0.50  ██████████████████████████████████░░░░░░░░░░░░░░░░  Community forums, YouTube, system inference
0.40  ████████████████████████████████░░░░░░░░░░░░░░░░░░  Social media (Instagram, unverified sources)
```

### Conflict Resolution

When multiple sources provide conflicting data for the same vehicle field:

1. **Highest trust score wins** - Ferrari Classiche (0.98) overrides a forum post (0.50)
2. **Most recent observation wins** (for tie-breaking)
3. **Corroborated data gets boosted** - If 3 sources agree, confidence increases
4. **All observations preserved** - The "losing" observation is never deleted; it remains in the audit trail

---

## 7. VALUATION ENGINE TECHNICAL DETAIL

### Input Feature Set

The valuation engine uses 12 input features to generate estimates:

| Feature | Weight | Source |
|---------|--------|--------|
| **Comparable sales** | High | clean_vehicle_prices (476K records) |
| **Market trend** | High | Rolling 90-day price index per make/model |
| **Sentiment score** | Medium | comment_discoveries (127K analyses) |
| **Condition signals** | Medium | AI-extracted from descriptions and photos |
| **Provenance depth** | Medium | Number of data sources per vehicle |
| **Documentation level** | Medium | Books, records, build sheet, window sticker |
| **Modification status** | Medium | Matching numbers, originality percentage |
| **Rarity factors** | Medium | Production numbers, special editions |
| **Geographic market** | Low | Regional price variations |
| **Time on market** | Low | Days listed (if currently for sale) |
| **Seller reputation** | Low | Seller transaction history and ratings |
| **Image quality/count** | Low | Number of photos, quality scores |

### Comparable Sales Algorithm

```
1. Identify make/model/year cluster
2. Expand to ±2 years if sample size < 20
3. Adjust for:
   - Condition differential (±15%)
   - Modification level (matching numbers: +20%, restomod: -10%)
   - Provenance premium (racing history: +30%, celebrity: +15%)
   - Documentation (full records: +10%, no records: -15%)
   - Geography (California premium: +5%, rural discount: -3%)
4. Compute weighted median of adjusted comparables
5. Apply sentiment adjustment (±10% based on community score)
6. Generate confidence interval based on sample variance
```

### Accuracy Deep Dive

| Segment | Sample | Median Error | Mean Error | Std Dev | 95th Percentile |
|---------|--------|-------------|-----------|---------|-----------------|
| Under $10K | 89,500 | 12.1% | 48.2% | 72% | 95% |
| $10K-$25K | 96,459 | 7.8% | 38.1% | 55% | 82% |
| $25K-$50K | 125,509 | 6.2% | 17.5% | 28% | 45% |
| $50K-$100K | 92,487 | 3.3% | 16.6% | 24% | 38% |
| $100K-$250K | 34,112 | <1% | 17.1% | 22% | 35% |
| $250K-$500K | 7,203 | <1% | 12.3% | 18% | 30% |
| $500K-$1M | 1,943 | <1% | 11.0% | 16% | 28% |
| Over $1M | 742 | <1% | 10.4% | 15% | 26% |
| **Overall** | **447,928** | **6.3%** | **27.3%** | | |

**Key insight:** Median error is the more representative metric. The higher mean errors at lower price points are driven by outlier vehicles with unusual characteristics (heavily modified, parts cars, barn finds). The valuation engine is most accurate where it matters most: the $50K+ collector market where transaction stakes are highest.

### Output Schema

```json
{
  "vehicle_id": "uuid",
  "estimated_value": 67500,
  "value_low": 58000,
  "value_high": 78000,
  "confidence_score": 0.82,
  "confidence_interval_pct": 14.8,
  "price_tier": "$50K-$100K",
  "deal_score": 0.73,
  "deal_score_label": "Fair",
  "heat_score": 0.85,
  "heat_score_label": "Hot",
  "signal_weights": {
    "comparable_sales": 0.35,
    "market_trend": 0.20,
    "sentiment": 0.15,
    "condition": 0.10,
    "provenance": 0.10,
    "rarity": 0.10
  },
  "input_count": 47,
  "comparable_count": 23,
  "methodology": "weighted_median_adjusted",
  "generated_at": "2026-02-08T14:30:00Z"
}
```

---

## 8. NUKE SDK & API SPECIFICATION

### SDK Overview

```typescript
import { NukeClient } from 'nuke-sdk';

const nuke = new NukeClient({
  apiKey: 'nk_live_...',
  environment: 'production',
  timeout: 30000,
  retryAttempts: 3,
});
```

### Endpoint Reference

#### Vehicle Endpoints

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| `GET` | `/v1/vehicles/:id` | Get vehicle by ID | 100/min |
| `GET` | `/v1/vehicles/search` | Search vehicles | 60/min |
| `GET` | `/v1/vehicles/:id/images` | Get vehicle images | 100/min |
| `GET` | `/v1/vehicles/:id/timeline` | Get vehicle timeline | 100/min |
| `GET` | `/v1/vehicles/:id/observations` | Get vehicle observations | 60/min |
| `POST` | `/v1/vehicles/batch` | Batch lookup (up to 100) | 10/min |
| `POST` | `/v1/vehicles` | Create vehicle record | 30/min |
| `PUT` | `/v1/vehicles/:id` | Update vehicle record | 30/min |

#### Valuation Endpoints

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| `GET` | `/v1/valuations/:vehicle_id` | Get current valuation | 100/min |
| `POST` | `/v1/valuations/batch` | Batch valuations (up to 50) | 5/min |
| `GET` | `/v1/valuations/:vehicle_id/history` | Valuation history | 60/min |

#### Observation Endpoints

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| `POST` | `/v1/observations` | Submit observation | 60/min |
| `GET` | `/v1/observations` | List observations | 60/min |
| `POST` | `/v1/observations/batch` | Batch submit (up to 1,000) | 5/min |

#### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/webhooks` | Register webhook |
| `GET` | `/v1/webhooks` | List webhooks |
| `DELETE` | `/v1/webhooks/:id` | Remove webhook |

### Webhook Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `vehicle.created` | New vehicle added to database | Vehicle summary |
| `vehicle.updated` | Vehicle data changed | Changed fields |
| `valuation.generated` | New valuation estimate | Full valuation object |
| `observation.ingested` | New observation recorded | Observation summary |
| `auction.started` | Auction begins | Auction event details |
| `auction.completed` | Auction ends (sold/not sold) | Result with final price |

### Authentication & Security

| Feature | Implementation |
|---------|---------------|
| API Key format | `nk_live_` prefix (production), `nk_test_` prefix (sandbox) |
| Transport | HTTPS only (TLS 1.3) |
| Webhook verification | HMAC-SHA256 signature in `X-Nuke-Signature` header |
| Rate limiting | Token bucket algorithm, per-key limits |
| Idempotency | Via `Idempotency-Key` header (UUID) |
| IP allowlisting | Optional per API key |

### SDK Usage Examples

**Search for vehicles:**
```typescript
const results = await nuke.vehicles.search({
  make: 'Porsche',
  model: '911',
  yearMin: 1965,
  yearMax: 1973,
  priceMin: 50000,
  priceMax: 200000,
  sort: 'price_desc',
  limit: 25,
});
// Returns: { vehicles: VehicleDetail[], total: number, page: number }
```

**Get valuation with comparables:**
```typescript
const valuation = await nuke.valuations.get('vehicle-uuid', {
  includeComparables: true,
  includeSignals: true,
});
// Returns: { estimate: 67500, low: 58000, high: 78000, confidence: 0.82, ... }
```

**Submit observation from partner system:**
```typescript
await nuke.observations.create({
  vehicleId: 'vehicle-uuid',
  kind: 'work_record',
  observedAt: '2026-01-15T10:00:00Z',
  data: {
    service_type: 'engine_rebuild',
    provider: 'Automotion San Diego',
    cost: 12500,
    description: 'Complete engine rebuild with new bearings, rings, and gaskets',
    mileage_at_service: 87000,
  },
  idempotencyKey: 'partner-job-12345',
});
```

### Subscription Tiers (Planned)

| Tier | Monthly | API Calls | Features |
|------|---------|-----------|----------|
| **Basic** | $99 | 10,000 | Vehicle lookup, basic search, images |
| **Pro** | $299 | 100,000 | + Valuations, sentiment, batch operations |
| **Business** | $999 | 1,000,000 | + Webhooks, raw data access, priority support |
| **Enterprise** | Custom | Unlimited | + Dedicated support, SLA, custom integrations |

---

## 9. SAMPLE VEHICLE INTELLIGENCE PROFILES

The following examples demonstrate the depth of data Nuke maintains per vehicle. These are representative profiles showing the 119+ structured fields in action.

### Example 1: 1967 Chevrolet Corvette 427/435 Convertible

| Category | Fields |
|----------|--------|
| **Identity** | Year: 1967, Make: Chevrolet, Model: Corvette, Trim: 427/435 Convertible, Generation: C2, Body: Convertible |
| **Numbers** | VIN: 194677Sxxxxxx, Production #847 of 3,754, Factory color: Ermine White (972) |
| **Provenance** | 3 documented owners, acquired 2019 for $148,000, California title (clean), no accidents |
| **Condition** | Running, drivable, body: excellent, paint: older repaint, interior: original, mechanical: excellent, no rust |
| **Documentation** | Service records: present (1972-2024), build sheet: present, window sticker: absent, tool kit: present |
| **Modifications** | Matching numbers (verified), original engine, original transmission, original color (repainted same) |
| **Community** | Sentiment: 0.91 (very positive), 156 comments, 4 expert opinions, 23 comparable sales |
| **Financial** | Est. value: $185,000, Range: $165K-$210K, Confidence: 0.87, Deal score: Good, Heat: Hot |
| **Images** | 67 photos, angles: front (4), rear (3), sides (4), 3/4 (6), interior (12), engine (8), detail (18), undercarriage (4), documents (8) |

### Example 2: 1973 Porsche 911S Targa

| Category | Fields |
|----------|--------|
| **Identity** | Year: 1973, Make: Porsche, Model: 911S, Trim: Targa, Generation: G-Series, Body: Targa |
| **Numbers** | VIN: 9113310xxxx, Chassis: matching, Engine: matching, Production year: 1973 |
| **Provenance** | 5 owners, acquired 2022 for $62,000, Texas title (clean), no accidents, no racing history |
| **Condition** | Running, drivable, body: good (minor dings), paint: recent respray, interior: reupholstered, mechanical: good |
| **Documentation** | Service records: partial (2010-present), Porsche Certificate of Authenticity: obtained |
| **Modifications** | Mild: upgraded stereo, sport seats (period correct), Fuchs wheels (original to model) |
| **Community** | Sentiment: 0.82 (positive), 89 comments, market trend: up 12% YoY for early Targas |
| **Financial** | Est. value: $67,500, Range: $58K-$78K, Confidence: 0.82, Deal score: Fair, Heat: Warm |
| **Images** | 47 photos from BaT listing |

### Example 3: 1962 Ferrari 250 GTO by Scaglietti

| Category | Fields |
|----------|--------|
| **Identity** | Year: 1962, Make: Ferrari, Model: 250 GTO, Trim: by Scaglietti, Body: Berlinetta |
| **Numbers** | Chassis: 3851GT, Engine: matching tipo 168/62, Ferrari Classiche certified |
| **Provenance** | 7 documented owners, racing history (Le Mans 1962, Tour de France Auto 1962), concours history (Pebble Beach, Villa d'Este) |
| **Documentation** | Complete factory records, Marcel Massini report, race results documented, restoration documentation |
| **Community** | Sentiment: 0.98 (extreme positive), 2,340 comments across sources, cultural significance: legendary |
| **Financial** | Last sale: $43,260,000 (2023), Est. current value: $45-50M, Confidence: 0.45 (limited comparables - only 36 GTOs exist) |
| **Sources** | 12 data sources: Ferrari Classiche, RM Sotheby's, Bonhams, Marcel Massini, multiple forums, social media, automotive press |

---

## 10. DATA QUALITY & INTEGRITY FRAMEWORK

### Five-Layer Quality System

```
Layer 5: CROSS-REFERENCE VALIDATION
    └── Multi-source corroboration, conflict detection
Layer 4: DUPLICATE DETECTION
    └── VIN matching, fuzzy matching, image similarity
Layer 3: VEHICLE QUALITY SCORES
    └── Data completeness, source diversity, recency
Layer 2: OBSERVATION CONFIDENCE
    └── Per-observation scoring based on source + method
Layer 1: SOURCE TRUST SCORING
    └── Base trust per source category (0.0 - 1.0)
```

### Quality Metrics (Current)

| Metric | Value | Target |
|--------|-------|--------|
| Data freshness (<7 days) | 97.8% | >95% |
| Data freshness (<30 days) | 100% | 100% |
| VIN coverage | 21.0% (161K) | Expand (limited by pre-1981 vehicles) |
| Duplicate detection coverage | 336K jobs run | Full database |
| Scraping health records | 2.3M | Continuous |
| Field extraction audit trail | 2.9M entries | Full coverage |
| Vehicles with quality scores | 735K (95.7%) | 100% |

### Data Completeness by Field Category

| Category | Fields | Avg Fill Rate | Best Filled | Least Filled |
|----------|--------|--------------|-------------|-------------|
| Identity (12) | Year, make, model | 95% | Year (99.2%), Make (98.8%) | Factory color code (12%) |
| Financial (15) | Prices, estimates | 67% | Sale price (67%), Est. value (61.7%) | Maintenance cost index (2%) |
| Community (12) | Sentiment, discussion | 16.5% | Sentiment score (16.5%) | Cultural significance (3%) |
| Specification (15) | Engine, transmission | 45% | Engine type (55%), Transmission (48%) | Top speed (8%) |
| Condition (18) | Body, paint, mechanical | 25% | Running status (32%) | Undercarriage condition (5%) |
| Provenance (15) | Ownership, history | 20% | Title state (28%) | Celebrity ownership (1%) |
| Documentation (12) | Records, build sheets | 15% | Service records (18%) | Window sticker (4%) |
| Modifications (10) | Originality, changes | 22% | Matching numbers (25%) | Period correct mods (8%) |

---

## 11. SECURITY ARCHITECTURE

### Data Security

| Layer | Protection |
|-------|-----------|
| **Transport** | HTTPS/TLS 1.3 for all API traffic |
| **Database** | Supabase RLS (Row Level Security) on all tables |
| **Secrets** | dotenvx encrypted at rest, never in source control |
| **API keys** | HMAC-SHA256 signed, rotatable, per-organization |
| **Webhooks** | Signature verification prevents spoofing |
| **Access logging** | All data room access logged with session ID, IP, duration |

### Investor Data Room Security

| Feature | Implementation |
|---------|---------------|
| Access code gate | Required before any document access |
| NDA acknowledgement | 4-point confidentiality checklist before entry |
| Viewer identification | Name, email, organization recorded |
| Session tracking | Unique session ID per access |
| Document view logging | Every document view logged with timestamp |
| PDF export logging | Export events logged with viewer identity |
| Watermarking | Session ID and date embedded in all exports |

### Infrastructure Security

| Component | Security Model |
|-----------|---------------|
| Supabase | SOC 2 Type II compliant hosting |
| Vercel | Enterprise-grade CDN with DDoS protection |
| Edge functions | Deno sandbox (secure by default, explicit permissions) |
| Database | Connection pooling via PgBouncer, SSL-only connections |

---

## 12. SCALABILITY & INFRASTRUCTURE ROADMAP

### Current Infrastructure

| Resource | Current | Capacity | Utilization |
|----------|---------|----------|-------------|
| Database storage | 100 GB | 500 GB (current plan) | 20% |
| Edge function executions | ~8,000/day | 500,000/day | 1.6% |
| Image storage | ~5 TB (referenced URLs) | Unlimited (CDN) | N/A |
| API requests | ~10,000/day | 100,000/day | 10% |
| Concurrent workers | ~10 | 100 | 10% |

### Scaling Milestones

| Vehicle Count | Database Size | Key Infrastructure Change |
|---------------|---------------|--------------------------|
| **768K** (current) | 100 GB | Current infrastructure |
| **3.5M** (end 2026) | 450 GB | Read replicas, connection pooling upgrade |
| **8M** (2027) | 1 TB | Dedicated database cluster, CDN for images |
| **15M** (2028) | 2 TB | Sharding strategy, regional deployments |
| **25M** (2029) | 3.5 TB | Multi-region, dedicated ML infrastructure |
| **43M+** (2030) | 5+ TB | Full horizontal scaling, global distribution |

### Cost Scaling Model

| Scale | Monthly Infrastructure | Cost per Vehicle/Year |
|-------|----------------------|----------------------|
| 768K vehicles | ~$160 | $0.0025 |
| 3.5M vehicles | ~$1,500 | $0.0051 |
| 8M vehicles | ~$5,000 | $0.0075 |
| 15M vehicles | ~$15,000 | $0.012 |
| 43M vehicles | ~$50,000 | $0.014 |

**Key insight:** Infrastructure cost per vehicle increases sub-linearly. The data platform model achieves better unit economics at scale because shared infrastructure (AI models, API layer, frontend) does not scale with vehicle count. The primary cost driver is storage, which scales linearly but cheaply.

---

## 13. NUKE INDEX: MARKET INTELLIGENCE PRODUCT

### Concept

The Nuke Index is a family of market indices for collector vehicles - analogous to the S&P 500 for stocks or the Case-Shiller Index for real estate.

### Index Design

| Index | Coverage | Methodology |
|-------|---------|-------------|
| **Nuke 500** | Top 500 most-traded collector vehicles | Price-weighted, monthly rebalance |
| **Nuke American** | American collector cars (Chevrolet, Ford, Dodge, etc.) | Volume-weighted by make |
| **Nuke European** | European collector cars (Ferrari, Porsche, Mercedes, etc.) | Value-weighted |
| **Nuke JDM** | Japanese Domestic Market vehicles | Volume-weighted |
| **Nuke Muscle** | 1964-1972 American muscle cars | Price-weighted by segment |
| **Nuke Modern** | 1990-2010 modern classics | Volume-weighted |
| **Nuke Trophy** | Vehicles over $1M | Equal-weighted |

### Data Basis

| Input | Records | Coverage |
|-------|---------|---------|
| Historical sale prices | 476,415 | Clean, normalized price data |
| Price history records | 237,639 | Time-series price tracking |
| Valuation estimates | 474,484 | AI-generated current values |
| Auction events | 119,579 | Platform, date, result |
| Sentiment scores | 127,109 | Community perception |

### Sample Index Calculation: Nuke Muscle (1964-1972)

| Make/Model | Avg Price (2024) | Avg Price (2025) | YoY Change |
|-----------|-----------------|-----------------|-----------|
| Chevrolet Chevelle SS 396/454 | $52,000 | $55,200 | +6.2% |
| Ford Mustang Boss 302/429 | $78,000 | $82,400 | +5.6% |
| Dodge Challenger R/T | $67,000 | $74,400 | +11.0% |
| Plymouth 'Cuda 340/383/440 | $85,000 | $95,200 | +12.0% |
| Pontiac GTO | $42,000 | $44,100 | +5.0% |
| Chevrolet Camaro Z/28 | $65,000 | $71,500 | +10.0% |
| Ford Torino Cobra/GT | $35,000 | $37,800 | +8.0% |
| AMC Javelin AMX | $28,000 | $31,600 | +12.9% |
| **Nuke Muscle Index** | **Base 1000** | **1078** | **+7.8%** |

### Revenue Model for Nuke Index

| Product | Price | Customer |
|---------|-------|----------|
| Index data feed (real-time) | $499/mo | Funds, institutional investors |
| Monthly market report | $99/mo | Dealers, collectors, advisors |
| Custom index (per make/model) | $199/mo | Insurance companies, lenders |
| Historical data (backfill) | $2,500 one-time | Research institutions, funds |
| White-label index | $999/mo | Media companies, platforms |

### Competitive Advantage

No existing product offers granular, data-driven collector vehicle indices:
- **Hagerty Valuation Tools**: Editorial-based, updated quarterly, limited to insured vehicles
- **Classic.com Market Data**: Price aggregation only, no AI analysis, no sentiment
- **Bloomberg/Reuters**: Do not cover collector vehicles as an asset class

The Nuke Index would be the first institutional-grade, data-driven, real-time market index for collector vehicles - built on 476K clean price records, 474K AI valuations, and 127K sentiment analyses.

---

*This document is confidential and intended only for the addressee.*
*All technical specifications verified from live system on February 8, 2026.*
*Nuke is a project of Nuke Ltd (Nevada, 2022).*
