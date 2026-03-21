# Observation System

## Source-Agnostic Data Ingestion with Provenance

This document describes the observation architecture: the unified intake system designed to accept data from any source, attach trust scores, deduplicate, resolve vehicles, and store structured observations with full provenance. This is the target architecture the system is migrating toward.

---

## Table of Contents

1. [Philosophy and Design Goals](#1-philosophy-and-design-goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Observation Sources](#3-observation-sources)
4. [The ingest-observation Function](#4-the-ingest-observation-function)
5. [Trust Scoring Mechanism](#5-trust-scoring-mechanism)
6. [Content Hashing for Deduplication](#6-content-hashing-for-deduplication)
7. [Vehicle Resolution Logic](#7-vehicle-resolution-logic)
8. [Confidence Scoring](#8-confidence-scoring)
9. [Observation Kinds](#9-observation-kinds)
10. [The Analysis Engine](#10-the-analysis-engine)
11. [Relationship to Legacy Tables](#11-relationship-to-legacy-tables)
12. [Source Census and Coverage](#12-source-census-and-coverage)
13. [Migration Path](#13-migration-path)
14. [Complete Observation Flow Diagram](#14-complete-observation-flow-diagram)
15. [API Reference](#15-api-reference)

---

## 1. Philosophy and Design Goals

The observation system embodies a core Nuke principle: **every data point is an observation with provenance, not a fact to be asserted.**

### 1.1 Key Principles

**Source agnosticism.** The system does not privilege auction data over forum posts, or professional appraisals over owner claims. Every source has a trust score, and every observation carries its source's trust rating. The system trusts no single source absolutely.

**Deduplication by content.** The same information arriving from multiple sources is detected via content hashing and stored once. Multiple arrivals of the same observation increase confidence rather than creating duplicate records.

**Vehicle resolution with confidence.** Observations may arrive without knowing which vehicle they describe. The system resolves vehicle matches using a cascading strategy (VIN, URL, year/make/model) and records the confidence of each match, including cases where no match can be made.

**Immutable observations.** Once an observation is written, its `structured_data` is never modified. New information about the same subject creates new observations, not updates to existing ones. This preserves the historical record and supports temporal queries ("what did we know about this vehicle at time T?").

**Fire-and-forget analysis.** When a new observation arrives, downstream analysis is triggered asynchronously. The ingestion path never blocks on analysis completion.

### 1.2 The Body Without Organs

In the rhizomatic analysis of the system (see `docs/writing/RHIZOME.md`), the "observation" concept was identified as the Body without Organs -- the concept that lives equally in every machine (ingestion, processing, infrastructure, intelligence, vision). It has no single home territory. If fully realized, the observation model dissolves the boundaries between all subsystems.

This is the architectural expression of that insight: a single intake path for all data, regardless of type or source.

---

## 2. Architecture Overview

```
+==========================================================================+
|                      OBSERVATION SYSTEM ARCHITECTURE                      |
+==========================================================================+

  [Any External Source]
        |
        | HTTP POST
        v
  +-----+------------------+
  | ingest-observation     |
  | (unified intake)       |
  +-----+------------------+
        |
        +-- 1. Validate source (observation_sources lookup)
        +-- 2. Validate observation kind (supported by source?)
        +-- 3. Compute content hash (SHA-256)
        +-- 4. Check for duplicate (content_hash lookup)
        +-- 5. Resolve vehicle (VIN -> URL -> fuzzy)
        +-- 6. Compute confidence score
        +-- 7. INSERT into vehicle_observations
        +-- 8. Fire-and-forget: trigger analysis engine
        |
        v
  [vehicle_observations]
        |
        ==> (async)
        v
  [analysis-engine-coordinator]
        |
        v
  [observation_discoveries / comment_discoveries / ...]

+==========================================================================+
```

---

## 3. Observation Sources

The `observation_sources` table is the registry of all data sources in the system. Every observation must reference a registered source.

### 3.1 Source Properties

```
observation_sources
+-------------------------+---------------+------------------------------------+
| Column                  | Type          | Purpose                            |
+-------------------------+---------------+------------------------------------+
| id                      | UUID PK       | Unique source identifier           |
| slug                    | TEXT UNIQUE   | URL-friendly ID (e.g. "bat")       |
| display_name            | TEXT          | Human-readable name                |
| category                | TEXT          | Source category (see below)         |
| base_trust_score        | DECIMAL       | 0.0-1.0 default trust rating       |
| supported_observations  | TEXT[]        | Array of allowed observation kinds  |
| base_url                | TEXT          | Platform base URL                  |
| scrape_config           | JSONB         | Scraping configuration             |
| is_active               | BOOLEAN       | Whether source is active           |
| created_at              | TIMESTAMPTZ   | Registration time                  |
| updated_at              | TIMESTAMPTZ   | Last modification                  |
+-------------------------+---------------+------------------------------------+
```

### 3.2 Source Categories

| Category | Description | Examples | Typical Trust Score |
|----------|-------------|----------|-------------------|
| `auction` | Established auction houses with structured data | BaT, C&B, RM Sotheby's, Mecum, Barrett-Jackson, Bonhams, Gooding | 0.75-0.90 |
| `forum` | Enthusiast forums with community knowledge | Rennlist, Pelican Parts, model-specific forums | 0.40-0.60 |
| `social_media` | Social platforms with vehicle content | Instagram, YouTube | 0.30-0.50 |
| `marketplace` | Buy/sell platforms | eBay Motors, Craigslist, Hagerty Marketplace, FB Marketplace | 0.50-0.70 |
| `registry` | Authoritative registries and valuation services | Marque registries, Hagerty valuation | 0.80-0.95 |
| `shop` | Service and restoration records | Independent shops, dealer service departments | 0.70-0.85 |
| `owner` | Direct owner input | Owner-submitted data | 0.60-0.80 |
| `documentation` | Physical documents (digitized) | Titles, build sheets, window stickers, receipts | 0.85-0.95 |

### 3.3 Registering a New Source

To add a new data source to the system:

```sql
INSERT INTO observation_sources
  (slug, display_name, category, base_trust_score, supported_observations)
VALUES
  ('xyz-auctions', 'XYZ Auctions', 'auction', 0.75,
   ARRAY['listing', 'comment', 'bid', 'image']);
```

The `supported_observations` array determines which observation kinds the source can produce. The `ingest-observation` function validates that every incoming observation's kind is in this list.

### 3.4 Trust Score Rationale

Trust scores reflect the reliability of data from each source category:

- **Documentation (0.85-0.95):** Physical documents (build sheets, titles) are the most reliable because they were created at the time of the event they describe.
- **Registry (0.80-0.95):** Official registries maintain curated records, often cross-referenced against documentation.
- **Auction (0.75-0.90):** Auction houses have structured, vetted data, but sellers can misrepresent.
- **Shop (0.70-0.85):** Service records are reliable for what was done, but may not capture full history.
- **Owner (0.60-0.80):** Owners know their vehicles but may have biases or incomplete knowledge.
- **Marketplace (0.50-0.70):** Seller-provided data with incentive to embellish.
- **Forum (0.40-0.60):** Community knowledge is valuable but unverified.
- **Social media (0.30-0.50):** Lowest baseline trust due to casual, unstructured data.

---

## 4. The ingest-observation Function

`ingest-observation` (`supabase/functions/ingest-observation/index.ts`) is the single entry point for all observations. Every extractor, crawler, user input, and automated system writes through this function.

### 4.1 Input Schema

```typescript
interface ObservationInput {
  // Required fields
  source_slug: string;          // Must match observation_sources.slug
  kind: string;                 // Must be in source's supported_observations
  observed_at: string;          // ISO 8601 timestamp

  // Source identification
  source_url?: string;          // URL of the source material
  source_identifier?: string;   // Platform-specific ID (comment ID, listing ID)

  // Content
  content_text?: string;        // Raw observation text
  structured_data?: Record<string, unknown>;  // Extracted structured fields

  // Vehicle linkage
  vehicle_id?: string;          // Direct link (if known)
  vehicle_hints?: {             // Resolution hints (if vehicle_id unknown)
    vin?: string;
    plate?: string;
    year?: number;
    make?: string;
    model?: string;
    url?: string;
  };

  // Observer metadata
  observer_raw?: Record<string, unknown>;  // Raw observer data (username, etc.)

  // Extraction provenance
  extractor_id?: string;                    // Which extractor produced this
  extraction_metadata?: Record<string, unknown>;  // Extraction context
}
```

### 4.2 Processing Pipeline

```
POST /functions/v1/ingest-observation
  {source_slug, kind, observed_at, ...}
       |
       v
  STEP 1: VALIDATE REQUIRED FIELDS
  source_slug, kind, observed_at must be present
  -> 400 if missing
       |
       v
  STEP 2: LOOK UP SOURCE
  SELECT id, base_trust_score, supported_observations
  FROM observation_sources
  WHERE slug = source_slug
  -> 400 if source not found (with hint to register)
       |
       v
  STEP 3: VALIDATE OBSERVATION KIND
  Check: kind IN source.supported_observations
  -> 400 if kind not supported by this source
       |
       v
  STEP 4: COMPUTE CONTENT HASH
  content_for_hash = JSON.stringify({
    source: source_slug,
    kind: kind,
    identifier: source_identifier,
    text: content_text,
    data: structured_data
  })
  content_hash = SHA-256(content_for_hash)
       |
       v
  STEP 5: CHECK FOR DUPLICATE
  SELECT id FROM vehicle_observations
  WHERE content_hash = computed_hash
  -> If found: return {success:true, duplicate:true, observation_id}
       |
       v
  STEP 6: RESOLVE VEHICLE (if vehicle_id not provided)
  Cascade: VIN match -> URL match -> Year/Make/Model fuzzy match
  (see Section 7 for full details)
       |
       v
  STEP 7: COMPUTE CONFIDENCE SCORE
  Base: source.base_trust_score
  Bonuses:
    +0.10 if vehicle_match_confidence >= 0.95
    +0.05 if source_url provided
    +0.05 if content_text > 100 chars
  Capped at 1.0
       |
       v
  STEP 8: DETERMINE CONFIDENCE LEVEL
  >= 0.95 -> "verified"
  >= 0.85 -> "high"
  >= 0.40 -> "medium"
  < 0.40  -> "low"
       |
       v
  STEP 9: INSERT INTO vehicle_observations
  {vehicle_id, vehicle_match_confidence, vehicle_match_signals,
   observed_at, source_id, source_url, source_identifier,
   kind, content_text, content_hash, structured_data,
   confidence, confidence_score, confidence_factors,
   observer_raw, extractor_id, extraction_metadata}
       |
       v
  STEP 10: TRIGGER ANALYSIS (fire-and-forget)
  If vehicle_id is set:
    POST analysis-engine-coordinator
    {action: "observation_trigger",
     vehicle_id, observation_kind}
  (non-blocking, catch errors silently)
       |
       v
  RETURN
  {success: true, observation_id, vehicle_id,
   vehicle_resolved: boolean,
   vehicle_match_confidence,
   confidence_score, duplicate: false}
```

### 4.3 Response Examples

**Successful new observation:**
```json
{
  "success": true,
  "observation_id": "a1b2c3d4-...",
  "vehicle_id": "e5f6g7h8-...",
  "vehicle_resolved": true,
  "vehicle_match_confidence": 0.99,
  "confidence_score": 0.85,
  "duplicate": false
}
```

**Duplicate observation:**
```json
{
  "success": true,
  "duplicate": true,
  "observation_id": "existing-id-...",
  "message": "Observation already exists"
}
```

**Unknown source:**
```json
{
  "error": "Unknown source: xyz-forum",
  "hint": "Register source in observation_sources table first"
}
```

---

## 5. Trust Scoring Mechanism

Trust in the observation system operates at two levels: source-level trust (static) and observation-level confidence (computed per observation).

### 5.1 Source-Level Trust

Each source has a `base_trust_score` (0.0-1.0) set at registration time. This reflects the general reliability of the source.

```
Source                  base_trust_score
------                  ----------------
Window sticker (doc)         0.95
Marque registry              0.90
BaT (auction)                0.85
RM Sotheby's (auction)       0.85
Service record (shop)        0.80
C&B (auction)                0.80
Owner submission             0.70
Craigslist (marketplace)     0.55
Forum post                   0.50
Instagram (social)           0.35
```

### 5.2 Observation-Level Confidence

The source's base trust is the starting point. Observation-specific factors add or subtract:

```
confidence_score = base_trust_score
                 + vehicle_match_bonus (0.10 if high confidence match)
                 + source_url_bonus (0.05 if URL provided)
                 + content_substance_bonus (0.05 if content > 100 chars)

Capped at 1.0.
```

### 5.3 Confidence Levels

```
Score Range     Level       Meaning
-----------     -----       -------
>= 0.95         verified    Cross-verified from multiple authoritative sources
>= 0.85         high        Authoritative single source with strong vehicle match
>= 0.40         medium      Reasonable source, acceptable match quality
<  0.40         low         Unreliable source or weak vehicle match
```

### 5.4 Future Trust Evolution

The trust scoring system is designed to evolve toward dynamic trust:

- **Source reputation tracking:** Sources that consistently provide accurate data get trust increases. Sources with frequent conflicts get trust decreases.
- **Observer reputation:** Individual observers (e.g., forum members, auction commenters) could accumulate reputation based on the accuracy of their past observations.
- **Temporal decay:** The encyclopedia defines "half-lives" for different observation types. A mileage reading from 5 years ago is less trustworthy than one from today.
- **Cross-verification bonuses:** When multiple independent sources agree on a fact, confidence increases superlinearly.

None of these are implemented yet. The current system uses static source trust with per-observation bonuses.

---

## 6. Content Hashing for Deduplication

### 6.1 Hash Computation

Content deduplication uses SHA-256 hashing of a normalized content representation:

```typescript
const contentForHash = JSON.stringify({
  source: input.source_slug,
  kind: input.kind,
  identifier: input.source_identifier,
  text: input.content_text,
  data: input.structured_data
});
const contentHash = SHA-256(contentForHash);
```

### 6.2 What's Included in the Hash

The hash includes:
- **source_slug**: Same content from different sources creates different hashes (intentional -- we want to record that both BaT and a forum mentioned the same thing)
- **kind**: Same content interpreted as different kinds creates different hashes
- **source_identifier**: Platform-specific ID (ensures same comment from same platform doesn't duplicate)
- **content_text**: Raw text content
- **structured_data**: Extracted structured fields

### 6.3 What's NOT Included in the Hash

The hash excludes:
- **observed_at**: Same content observed at different times is still a duplicate
- **vehicle_id**: Vehicle resolution may change over time, but the observation content hasn't changed
- **vehicle_hints**: These are metadata about matching, not content
- **observer_raw**: Observer identity doesn't change the observation content
- **confidence scores**: These are computed properties, not intrinsic content

### 6.4 Deduplication Behavior

When a duplicate is detected (content_hash match in `vehicle_observations`):
1. The insertion is skipped
2. The existing observation's ID is returned
3. `duplicate: true` is set in the response
4. No analysis is triggered (already processed)

This means re-running an extractor against the same data is safe and idempotent -- it will detect the duplicates and skip them.

---

## 7. Vehicle Resolution Logic

When an observation arrives without a `vehicle_id`, the system attempts to resolve which vehicle it describes using a cascading match strategy.

### 7.1 Resolution Cascade

```
vehicle_hints provided?
       |
       +-- No hints: vehicle_id = NULL, unresolved observation
       |
       +-- hints.vin provided?
       |       |
       |       v
       |   SELECT id FROM vehicles WHERE vin = hints.vin
       |       |
       |       +-- Match found: confidence = 0.99, signal = {vin_match: true}
       |       |
       |       +-- No match: continue to URL match
       |
       +-- hints.url provided?
       |       |
       |       v
       |   SELECT vehicle_id FROM vehicle_events
       |   WHERE source_url = hints.url
       |   AND vehicle_id IS NOT NULL
       |       |
       |       +-- Match found: confidence = 0.95, signal = {url_match: true}
       |       |
       |       +-- No match: continue to fuzzy match
       |
       +-- hints.year AND hints.make provided?
               |
               v
           SELECT id FROM vehicles
           WHERE year = hints.year
           AND make ILIKE '%hints.make%'
           LIMIT 5
               |
               +-- Exactly 1 match: confidence = 0.60,
               |   signal = {fuzzy_match: true, year, make}
               |
               +-- Multiple matches: vehicle_id = NULL,
               |   signal = {multiple_candidates: true, count, hints}
               |   (left unresolved for manual review)
               |
               +-- No matches: vehicle_id = NULL
```

### 7.2 Resolution Confidence

| Match Method | Confidence | Signal |
|-------------|-----------|--------|
| VIN exact match | 0.99 | `{vin_match: true}` |
| URL exact match (via vehicle_events) | 0.95 | `{url_match: true}` |
| Year+Make single match | 0.60 | `{fuzzy_match: true, year, make}` |
| Year+Make multiple matches | N/A (unresolved) | `{multiple_candidates: true, count}` |
| No match | N/A (unresolved) | `{}` |

### 7.3 Unresolved Observations

When vehicle resolution fails, the observation is still stored with `vehicle_id = NULL`. These unresolved observations can be:
1. Resolved later when more vehicles are imported
2. Manually assigned by a curator
3. Used for discovery (an unresolved observation about a 1967 Porsche 911 might prompt the system to search for that vehicle)

The `vehicle_match_signals` JSONB column preserves the resolution context for later review:

```json
{
  "multiple_candidates": true,
  "count": 3,
  "hints": {
    "year": 1967,
    "make": "Porsche",
    "model": "911"
  }
}
```

---

## 8. Confidence Scoring

### 8.1 Confidence Factors

The `confidence_factors` JSONB column records what contributed to the final confidence score:

```json
{
  "vehicle_match": 0.10,       // Added if vehicle_match_confidence >= 0.95
  "has_source_url": 0.05,      // Added if source_url is provided
  "substantial_content": 0.05  // Added if content_text > 100 chars
}
```

### 8.2 Score Computation

```
confidence_score = min(1.0,
    source.base_trust_score
  + sum(confidence_factors)
)
```

### 8.3 Example Calculations

**BaT listing observation with VIN match:**
```
base_trust_score = 0.85 (BaT auction)
+ vehicle_match = 0.10 (VIN match, confidence 0.99)
+ has_source_url = 0.05
+ substantial_content = 0.05
= min(1.0, 1.05) = 1.0
confidence_level = "verified"
```

**Forum post with fuzzy match:**
```
base_trust_score = 0.50 (forum)
+ vehicle_match = 0.00 (fuzzy match confidence 0.60, below 0.95 threshold)
+ has_source_url = 0.05
+ substantial_content = 0.05
= 0.60
confidence_level = "medium"
```

**Instagram post, no vehicle match:**
```
base_trust_score = 0.35 (social media)
+ vehicle_match = 0.00 (no match)
+ has_source_url = 0.05
+ substantial_content = 0.00 (caption < 100 chars)
= 0.40
confidence_level = "medium"
```

---

## 9. Observation Kinds

An observation's `kind` field categorizes what type of data it represents. The allowed kinds are defined per-source in `observation_sources.supported_observations`.

### 9.1 Standard Kinds

| Kind | Description | Typical Sources |
|------|-------------|----------------|
| `listing` | Vehicle for-sale listing | Auction, marketplace, dealer |
| `comment` | Community comment on a listing | Auction, forum |
| `bid` | Monetary bid on a vehicle | Auction |
| `image` | Vehicle photograph | Any |
| `price_history` | Historical price data point | Registry, auction |
| `condition_report` | Professional condition assessment | Registry, shop |
| `service_record` | Maintenance/repair record | Shop, owner |
| `ownership_change` | Transfer of ownership | Documentation, registry |
| `build_record` | Factory production data | Documentation, registry |
| `modification` | Vehicle modification record | Shop, owner, forum |
| `valuation` | Professional or algorithmic valuation | Registry |
| `sighting` | Vehicle spotted at event/location | Social media, owner |
| `recall` | Manufacturer recall notice | Registry |
| `insurance_claim` | Insurance claim record | Documentation |
| `race_result` | Competition result | Registry, documentation |

### 9.2 Kind Validation

When `ingest-observation` receives an observation, it checks that the kind is in the source's `supported_observations` array:

```sql
-- Source registration
INSERT INTO observation_sources (slug, supported_observations)
VALUES ('bat', ARRAY['listing', 'comment', 'bid', 'image', 'price_history']);

-- Attempting to ingest a 'service_record' from BaT would fail:
-- "Source bat does not support observation kind: service_record"
```

This prevents data quality issues from mismatched source/kind combinations (e.g., an auction house should not be producing service records).

---

## 10. The Analysis Engine

When a new observation is ingested and linked to a vehicle, the system asynchronously triggers the analysis engine.

### 10.1 Trigger Mechanism

```typescript
// In ingest-observation, after successful insert:
if (vehicleId && input.kind) {
  fetch(`${supabaseUrl}/functions/v1/analysis-engine-coordinator`, {
    method: "POST",
    headers: { ... },
    body: JSON.stringify({
      action: "observation_trigger",
      vehicle_id: vehicleId,
      observation_kind: input.kind
    }),
  }).catch(() => {}); // fire-and-forget
}
```

### 10.2 Analysis Engine Coordinator

The `analysis-engine-coordinator` receives the trigger and dispatches analysis tasks based on the observation kind:

```
observation_kind = "comment"
  -> discover-comment-data (sentiment, themes, market signals)

observation_kind = "listing"
  -> discover-from-descriptions (field extraction)
  -> compute-vehicle-valuation (price update)

observation_kind = "image"
  -> photo-pipeline-orchestrator (angle classification, condition)

observation_kind = "condition_report"
  -> update-condition-assessment
```

### 10.3 Analysis Results

Analysis outputs are stored in various downstream tables:
- `comment_discoveries` -- AI insights from comments
- `description_discoveries` -- Structured fields from descriptions
- `observation_discoveries` -- Source-agnostic analysis results

Each analysis result references back to the observation(s) that triggered it, maintaining the provenance chain.

---

## 11. Relationship to Legacy Tables

The observation system coexists with several legacy tables that predate it. The migration strategy is gradual: new data flows through observations, while legacy data is migrated in batches.

### 11.1 Legacy Table Mapping

```
Legacy Table          Observation Kind    Migration Status
-----------           ----------------    ----------------
auction_comments      "comment"           Parallel (both populated)
vehicle_events        "listing"           Parallel
auction_events        "listing"           Parallel
vehicle_images        "image"             Separate pipeline
price_history         "price_history"     Partial migration
comment_discoveries   (analysis output)   Downstream of observations
description_discoveries (analysis output) Downstream of observations
```

### 11.2 Dual-Write Strategy

Currently, many extractors write to both the legacy tables (e.g., `auction_comments`) and the observation system (via `ingest-observation`). This dual-write ensures:
1. Legacy code that reads from `auction_comments` continues to work
2. New observation-based analysis can process the same data
3. The migration can be verified by comparing results

### 11.3 Key Differences

| Aspect | Legacy Tables | Observation System |
|--------|--------------|-------------------|
| Source awareness | Platform-specific columns | Source registry with trust scores |
| Deduplication | URL-based (listing_url UNIQUE) | Content-hash-based (SHA-256) |
| Vehicle resolution | Extractor-specific logic | Unified cascade (VIN/URL/fuzzy) |
| Confidence tracking | Binary (exists or doesn't) | Numeric (0-1 with factors) |
| Immutability | Mutable (fields can be updated) | Immutable (structured_data frozen) |
| Kind system | Implicit (table = type) | Explicit (kind column) |
| Trust scoring | None | Source base_trust + observation bonuses |
| Write interface | Direct INSERT/UPDATE | Through ingest-observation only |

---

## 12. Source Census and Coverage

The source census system tracks how much of each external data source has been ingested.

### 12.1 Source Census Table

```
source_census
+-------------------------+---------------+------------------------------------+
| Column                  | Type          | Purpose                            |
+-------------------------+---------------+------------------------------------+
| id                      | UUID PK       | Census record ID                   |
| source_id               | UUID FK       | -> observation_sources.id          |
| universe_total          | INTEGER       | Total items at source              |
| universe_active         | INTEGER       | Currently live/active items        |
| universe_historical     | INTEGER       | Completed/sold/archived items      |
| census_method           | TEXT          | How counting was done:             |
|                         |               | sitemap/api/pagination/rss/        |
|                         |               | estimate/manual                    |
| census_confidence       | DECIMAL(3,2)  | 0.00-1.00 confidence in count     |
| census_url              | TEXT          | URL/endpoint used for counting     |
| census_at               | TIMESTAMPTZ   | When census was taken              |
| census_duration_ms      | INTEGER       | How long counting took             |
| next_census_at          | TIMESTAMPTZ   | When to recount                    |
| by_year                 | JSONB         | Breakdown by year                  |
| by_make                 | JSONB         | Breakdown by make                  |
| by_category             | JSONB         | Breakdown by category              |
| raw_response            | JSONB         | Raw census data                    |
+-------------------------+---------------+------------------------------------+
```

### 12.2 Coverage Targets

```
coverage_targets
+-------------------------+---------------+------------------------------------+
| Column                  | Type          | Purpose                            |
+-------------------------+---------------+------------------------------------+
| source_id               | UUID FK       | -> observation_sources.id          |
| segment_type            | TEXT          | all/make/year/year_range/category  |
| segment_value           | TEXT          | e.g. "Porsche", "1960-1970"        |
| target_coverage_pct     | DECIMAL(5,2)  | Target: 95.00 = 95% of universe   |
| target_freshness_hours  | INTEGER       | Data freshness SLA                 |
| target_extraction_hours | INTEGER       | New item processing SLA            |
| priority                | INTEGER       | Resource allocation priority        |
+-------------------------+---------------+------------------------------------+
```

### 12.3 Usage Pattern

```sql
-- Get latest census for BaT
SELECT * FROM get_latest_census('bat');

-- Result:
-- source_slug | universe_total | universe_active | census_method | census_confidence | age_hours
-- bat         | 141000         | 250             | sitemap       | 0.90              | 12.5

-- Check coverage: how many BaT vehicles do we have vs universe?
SELECT
  sc.universe_total,
  (SELECT count(*) FROM vehicles WHERE discovery_source = 'bat') as our_count,
  round(100.0 * (SELECT count(*) FROM vehicles WHERE discovery_source = 'bat')
    / sc.universe_total, 1) as coverage_pct
FROM source_census sc
JOIN observation_sources os ON sc.source_id = os.id
WHERE os.slug = 'bat'
ORDER BY sc.census_at DESC LIMIT 1;
```

---

## 13. Migration Path

### 13.1 Current State (March 2026)

- `observation_sources`: ~30 registered sources
- `vehicle_observations`: ~20,000 observations
- `ingest-observation`: Deployed and operational
- Legacy tables: Still the primary data path for most extractors
- Dual-write: Partial (some extractors write to both, others only to legacy)

### 13.2 Target State

```
All data flows through ingest-observation
       |
       v
  vehicle_observations (single source of truth)
       |
       v
  Analysis engine processes all observations
       |
       v
  vehicles table is a materialized view
  (computed from vehicle_observations aggregate)
```

### 13.3 Migration Steps

1. **Register all sources** in `observation_sources` (DONE for ~30 sources)
2. **Deploy ingest-observation** as mandatory intake (DONE)
3. **Add dual-write** to all extractors (PARTIAL)
4. **Migrate historical data** from legacy tables to `vehicle_observations` via `migrate-to-observations`
5. **Validate** that observation-based analysis matches legacy analysis
6. **Switch reads** from legacy tables to observation views
7. **Deprecate** direct writes to legacy tables
8. **Archive** legacy tables

Steps 3-4 are in progress. Steps 5-8 are planned but not yet started.

---

## 14. Complete Observation Flow Diagram

```
+==========================================================================+
|                    COMPLETE OBSERVATION FLOW                               |
+==========================================================================+

  [External Source]
  (Auction, Forum, Social,
   Marketplace, Shop, Owner,
   Documentation, Registry)
        |
        | Extract data
        v
  [Extractor Function]
  (Platform-specific or generic AI)
        |
        | POST /functions/v1/ingest-observation
        | {source_slug, kind, observed_at,
        |  content_text, structured_data,
        |  vehicle_hints, ...}
        |
        v
  +-----+---------------------------+
  | INGEST-OBSERVATION               |
  |                                  |
  | 1. Validate source_slug         |
  |    observation_sources lookup    |
  |    -> 400 if unknown source     |
  |                                  |
  | 2. Validate kind                |
  |    Check supported_observations |
  |    -> 400 if unsupported kind   |
  |                                  |
  | 3. Hash content                 |
  |    SHA-256({source, kind,       |
  |    identifier, text, data})     |
  |                                  |
  | 4. Dedup check                  |
  |    content_hash lookup          |
  |    -> RETURN if duplicate       |
  |                                  |
  | 5. Resolve vehicle              |
  |    +-- VIN match (conf=0.99)    |
  |    +-- URL match (conf=0.95)    |
  |    +-- Fuzzy match (conf=0.60)  |
  |    +-- Unresolved (NULL)        |
  |                                  |
  | 6. Score confidence             |
  |    base_trust + bonuses         |
  |    -> verified/high/medium/low  |
  |                                  |
  | 7. INSERT observation           |
  |    -> vehicle_observations      |
  |                                  |
  | 8. Trigger analysis             |
  |    -> analysis-engine-coord     |
  |    (fire-and-forget)            |
  +-----+---------------------------+
        |
        v
  [vehicle_observations]
  +-----+---------------------------+
  | id                              |
  | vehicle_id (nullable)           |
  | source_id -> observation_sources|
  | kind                            |
  | observed_at                     |
  | content_hash (dedup key)        |
  | structured_data (IMMUTABLE)     |
  | confidence / confidence_score   |
  | vehicle_match_confidence        |
  | vehicle_match_signals           |
  +-----+---------------------------+
        |
        | (async)
        v
  +-----+---------------------------+
  | ANALYSIS ENGINE                  |
  |                                  |
  | comment -> discover-comment-data |
  | listing -> discover-from-desc.   |
  | image   -> photo-pipeline        |
  | ...                              |
  +-----+---------------------------+
        |
        v
  [Analysis Results]
  comment_discoveries
  description_discoveries
  observation_discoveries
  vehicles (enriched fields)

+==========================================================================+

  PARALLEL LEGACY PATH (being migrated):

  [Extractor]
       |
       +-- Direct writes to:
           auction_comments
           vehicle_events
           auction_events
           vehicles
           vehicle_images

+==========================================================================+
```

---

## 15. API Reference

### 15.1 POST /functions/v1/ingest-observation

**Request:**
```json
{
  "source_slug": "bat",
  "kind": "comment",
  "observed_at": "2024-01-15T10:30:00Z",
  "source_url": "https://bringatrailer.com/listing/1967-porsche-911-2/",
  "source_identifier": "comment-789456",
  "content_text": "Original paint confirmed by PPI...",
  "structured_data": {
    "sentiment": "positive",
    "mentions_condition": true,
    "mentions_originality": true
  },
  "vehicle_hints": {
    "url": "https://bringatrailer.com/listing/1967-porsche-911-2/",
    "year": 1967,
    "make": "Porsche",
    "model": "911"
  },
  "observer_raw": {
    "username": "porsche_expert_42",
    "member_since": "2019"
  }
}
```

**Response (success, new observation):**
```json
{
  "success": true,
  "observation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "vehicle_id": "12345678-abcd-ef12-3456-7890abcdef12",
  "vehicle_resolved": true,
  "vehicle_match_confidence": 0.95,
  "confidence_score": 0.90,
  "duplicate": false
}
```

**Response (duplicate):**
```json
{
  "success": true,
  "duplicate": true,
  "observation_id": "existing-observation-uuid",
  "message": "Observation already exists"
}
```

**Response (error: unknown source):**
```json
{
  "error": "Unknown source: new-forum",
  "hint": "Register source in observation_sources table first"
}
```

**Response (error: unsupported kind):**
```json
{
  "error": "Source bat does not support observation kind: service_record",
  "supported": ["listing", "comment", "bid", "image", "price_history"]
}
```

**Response (error: missing fields):**
```json
{
  "error": "Missing required fields: source_slug, kind, observed_at"
}
```

### 15.2 Source Registration

```sql
-- Register a new source
INSERT INTO observation_sources
  (slug, display_name, category, base_trust_score, supported_observations)
VALUES
  ('xyz-auctions', 'XYZ Auctions', 'auction', 0.75,
   ARRAY['listing', 'comment', 'bid']);

-- Configure an extractor for the source
INSERT INTO observation_extractors
  (source_id, extractor_type, edge_function_name, produces_kinds)
VALUES
  ((SELECT id FROM observation_sources WHERE slug = 'xyz-auctions'),
   'edge_function', 'extract-xyz-listing', ARRAY['listing', 'comment']);
```

### 15.3 Querying Observations

```sql
-- All observations for a vehicle, newest first
SELECT * FROM vehicle_observations
WHERE vehicle_id = '12345678-...'
ORDER BY observed_at DESC;

-- Unresolved observations (no vehicle match)
SELECT * FROM vehicle_observations
WHERE vehicle_id IS NULL
ORDER BY created_at DESC
LIMIT 100;

-- High-confidence observations from auctions
SELECT vo.*, os.display_name as source_name
FROM vehicle_observations vo
JOIN observation_sources os ON vo.source_id = os.id
WHERE os.category = 'auction'
  AND vo.confidence_score >= 0.85
ORDER BY vo.observed_at DESC;

-- Observations with vehicle match conflicts
SELECT * FROM vehicle_observations
WHERE vehicle_match_signals->>'multiple_candidates' = 'true';
```
