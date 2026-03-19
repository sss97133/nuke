# nuke

Vehicle data intelligence.

---

One person built a system of record for every collector vehicle
in the world — from a garage in Boulder City, Nevada,
between oil changes.

645,000 vehicles. 11.6 million auction comments. 32 million images.
609,000 valuations. 510,000 identity seeds. A vision model that
classifies vehicles from photos at zero cost per image.

Every data point is an observation — source-attributed,
confidence-scored, time-ordered. Nothing overwrites.
Everything compounds.

---

## What this is

A **database**, a set of **analysis functions**, and **trained ML models** for collector vehicles.

| What | Scale |
|------|-------|
| Vehicles | 645,725 entities with year, make, model, VIN, specs, provenance |
| Auction comments | 11.6M  — sentiment-scored |
| Images | 32.7M vehicle photos, classified by 41-zone taxonomy |
| Valuations | 609,433 nuke estimates (94.4% coverage) |
| Sale events | 192,539 extracted across 10+ auction platforms |
| Organizations | 4,973 dealers, shops, auction houses |
| External identities | 510,086 seller/buyer/commenter profiles |

## What you can do with it

### Query the database

```bash
# Search vehicles
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-search?q=porsche+911&year_from=1970&year_to=1995&limit=20" \
  -H "X-API-Key: YOUR_KEY"

# Get a vehicle by ID
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles?id=VEHICLE_UUID" \
  -H "X-API-Key: YOUR_KEY"

# Decode a VIN
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vin-lookup?vin=WP0AB2966NS420575" \
  -H "X-API-Key: YOUR_KEY"

# Get comparable vehicles
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-comps?vehicle_id=VEHICLE_UUID" \
  -H "X-API-Key: YOUR_KEY"
```

### Run analysis

```bash
# Get deal health signals for a vehicle
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-analysis?vehicle_id=VEHICLE_UUID" \
  -H "X-API-Key: YOUR_KEY"

# Get market trends
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-market-trends?make=Porsche&model=911" \
  -H "X-API-Key: YOUR_KEY"

# Get valuations
curl "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-valuations?vehicle_id=VEHICLE_UUID" \
  -H "X-API-Key: YOUR_KEY"
```

### Classify images (free, zero cost)

```bash
# Classify make from a photo (YONO model, 4ms, $0)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vision" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/car.jpg", "mode": "classify"}'

# Full vision analysis (make + condition + zone + damage)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vision" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/car.jpg", "mode": "analyze"}'
```

### Ingest vehicle data

```bash
# From a URL (auto-detects BaT, C&B, eBay, Craigslist, FB Marketplace, Hagerty, etc.)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/1974-chevrolet-c10/"}'

# From freeform text
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "1980 Chevy C10 $27,500 Greeneville TN"}'

# Structured JSON
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"year": 1980, "make": "Chevrolet", "model": "C10", "price": 27500}'

# Batch (up to 50)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch": [{"url": "..."}, {"url": "..."}, {"text": "1969 Camaro SS $45,000"}]}'

# Bulk programmatic import (up to 1,000 vehicles)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-batch" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicles": [{"year": 1974, "make": "Chevrolet", "model": "C10", "vin": "CCY144Z123456"}]}'
```

### Use the SDK

```bash
npm install @nuke1/sdk
```

```typescript
import Nuke from '@nuke1/sdk';
const nuke = new Nuke('nk_live_...');

const results = await nuke.search.query({ q: 'porsche 911', year_from: 1970 });
const vehicle = await nuke.vehicles.get('VEHICLE_UUID');
const vision  = await nuke.vision.classify({ image_url: 'https://...' });

await nuke.ingest({ url: 'https://bringatrailer.com/listing/...' });
```

## API reference

Base URL: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api-v1-search` | GET | Full-text vehicle search with filters |
| `/api-v1-vehicles` | GET/POST/PATCH | Vehicle CRUD |
| `/api-v1-vision` | POST | Image classification and analysis (YONO) |
| `/api-v1-analysis` | GET/POST | Deal health signals and widgets |
| `/api-v1-comps` | GET | Comparable vehicles |
| `/api-v1-valuations` | GET | Market valuations |
| `/api-v1-vin-lookup` | GET | VIN decoding (NHTSA) |
| `/api-v1-makes` | GET | Make/model catalog |
| `/api-v1-observations` | GET/POST | Source-attributed data points |
| `/api-v1-vehicle-history` | GET | Event timeline |
| `/api-v1-vehicle-auction` | GET | Auction-specific data |
| `/api-v1-market-trends` | GET | Market analytics |
| `/api-v1-listings` | GET | Listing status and events |
| `/api-v1-batch` | POST | Bulk vehicle import (up to 1,000) |
| `/api-v1-export` | POST | Data export |
| `/api-v1-signal` | GET | Market signal scoring |
| `/ingest` | POST | Universal intake (URL, text, JSON, batch) |

**Auth**: `X-API-Key: nk_live_...` header or `Authorization: Bearer JWT` header.

## Data model

Entity-Attribute-Value Modeling at Total Resolution — a Knowledge Graph materialized as relational schema. The database doesn't describe the vehicle. The database IS the vehicle.

The technical names:
- **Domain Ontology Engineering**
- **Canonical Data Model**
- **Schema-Guided Generation with Evidential Grounding**
- **Fully Normalized Domain Ontology at Component Resolution with Full Provenance Tracking**

```
vehicle (identity)
  -> factory_specification (what it left the factory as — every bolt, every option, every part number)
  -> component_state (what it is NOW — per-component condition, modifications, replacements)
  -> observations (append-only evidence log — every claim traced to source with confidence)
  -> field_evidence (multi-source provenance per field — agreement, conflict, citations)
  -> component_events (work log — who did what, when, where, with what parts)
  -> actors (builders, shops, inspectors, owners — reputation through evidence chain)
  -> images (classified by 41-zone taxonomy: exterior, interior, engine bay, undercarriage, detail)
  -> market_intelligence (auctions, valuations, comparables, listings across platforms)
  -> validation_results (clone detection, VIN cross-check, code verification, known issues)
```

**Schema-Guided Generation with Evidential Grounding**: the SQL schema IS the specification. Hand the DDL to any LLM with source material (photos, descriptions, documents, comments), get back INSERT statements with citations. Every cell proves what it claims. Multi-model jury for verification — where models agree, fact emerges. Where they diverge, investigation begins.

**Scale**: ~950 tables, ~5,000-8,000 columns per subsystem at bedrock. 10,000-100,000 data points per fully documented vehicle. 419 RPO codes, 63 validation rules, 107K evidence rows and growing.

Source trust scores: NHTSA 0.95, major auctions 0.85, forums 0.50, AI extraction 0.70. Confidence decays over time.

## Architecture

```
Vercel (React SPA) ──> Supabase Edge Functions (Deno, REST) ──> PostgreSQL v15
                                    |
                          +---------+---------+
                          |         |         |
                        Modal    Firecrawl   External APIs
                       (YONO ML) (scraping)  (BaT, FB, NHTSA...)
```

**Full technical overview**: [docs/REPOSITORY_OVERVIEW.md](docs/REPOSITORY_OVERVIEW.md)

## The writing

This project generated a body of writing about how
systems get built, what data reveals about itself,
and what happens when one person talks to AI for
13,758 prompts across 141 days.

- [The conceptual foundation](VISION.md)
- [Rhizomatic analysis](docs/writing/RHIZOME.md) —
  11 machines mapped from the prompt corpus
- [Concept genealogy](docs/writing/CONCEPT_GENEALOGY.md) —
  biography of 8 load-bearing ideas
- [The narrative arc](docs/writing/NARRATIVE_ARC.md) —
  the 20-week story
- [Vocabulary evolution](docs/writing/VOCABULARY_EVOLUTION.md) —
  how the language changed
- [Dead features](docs/writing/DEAD_FEATURES.md) —
  archaeology of abandoned ideas
- [All 23 documents](docs/writing/)

---

[nuke.ag](https://nuke.ag)
