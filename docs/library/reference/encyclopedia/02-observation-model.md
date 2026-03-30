# Chapter 2: The Observation Model

The observation model is the epistemic backbone of the Nuke platform. All data is testimony — a statement from a source, at a time, about a vehicle, with a measured confidence level. Nothing is "true" in the database; everything is observed, and the system's job is to converge on truth by accumulating independent observations.

This chapter documents the full observation pipeline: how data enters, how it is stored, how it is processed, and how it becomes knowledge.

---

## Core Principle: Data as Testimony

The observation model was born from a specific failure: the platform's original extraction system treated LLM outputs as facts. When a reference library was injected into prompts, the LLM hallucinated specifications for 66% of extracted Porsche vehicles — inventing data from the reference material and attributing it to the listing.

The fix was architectural: no data point is a fact. Every data point is testimony — a claim from a source, subject to corroboration, contradiction, and decay. The database does not store truth; it stores evidence, and truth emerges from convergence.

### Four Layers of Certainty

1. **Claims** — what a source says (cheapest to collect, least reliable)
2. **Consensus** — what multiple independent sources agree on (cheap, but can be wrong)
3. **Inspection** — what a qualified observer confirms firsthand (moderate cost)
4. **Scientific Test** — what physical measurement proves (expensive, but bedrock)

The observation model operates primarily at layers 1 and 2. Layers 3 and 4 require physical access to the vehicle.

---

## The vehicle_observations Table

This is the central table of the data pipeline. It holds **5.67 million rows** of observations across all source types and observation kinds.

### Full Schema

```sql
CREATE TABLE vehicle_observations (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id                  uuid,               -- FK to vehicles
    vehicle_match_confidence    numeric,            -- How confident the vehicle match is (0-1)
    vehicle_match_signals       jsonb,              -- What signals drove the match

    -- Temporal
    observed_at                 timestamptz NOT NULL,  -- When the observation was made
    ingested_at                 timestamptz DEFAULT now(), -- When it entered the system

    -- Source provenance
    source_id                   uuid,               -- FK to observation_sources
    source_url                  text,               -- Original URL of the observation
    source_identifier           text,               -- Platform-specific identifier (lot #, post ID)
    observer_id                 uuid,               -- Who made the observation (person/bot)
    observer_raw                jsonb,              -- Raw observer data (username, profile, etc.)

    -- Content
    kind                        observation_kind NOT NULL,  -- Enum: what type of observation
    content_text                text,               -- Raw text content
    content_hash                text,               -- SHA-256 for deduplication
    structured_data             jsonb NOT NULL DEFAULT '{}', -- Extracted structured fields

    -- Confidence
    confidence                  confidence_level DEFAULT 'medium',  -- Enum: verified/high/medium/low/inferred
    confidence_score            numeric,            -- Numeric 0-1 equivalent
    confidence_factors          jsonb DEFAULT '{}', -- What drove the confidence assessment

    -- Processing state
    is_processed                boolean DEFAULT false,  -- Has this been through discovery?
    processing_metadata         jsonb,              -- Processing logs and results

    -- Extraction provenance
    extractor_id                uuid,               -- FK to observation_extractors
    extraction_metadata         jsonb,              -- Extractor-specific metadata

    -- Supersession chain
    is_superseded               boolean DEFAULT false,  -- Has a newer observation replaced this?
    superseded_by               uuid,               -- FK to the superseding observation
    superseded_at               timestamptz,
    lineage_chain               uuid[],             -- Full chain of supersession
    original_source_id          uuid,               -- The root observation in a lineage chain
    original_source_url         text,

    -- Discovery provenance
    discovered_via_id           uuid,               -- Which observation led to discovering this one
    data_freshness_at_discovery interval,           -- How old was the data when we found it

    -- Agent provenance
    submitted_by_user_id        uuid,               -- Human who submitted (if any)
    agent_tier                  text,               -- Which AI tier processed this
    extraction_method           text,               -- Method used (regex, llm, vision, etc.)
    raw_source_ref              text,               -- Raw reference to source material
    agent_model                 text,               -- LLM model used (gemini-2.5-flash-lite, etc.)
    agent_cost_cents            numeric,            -- Cost of the LLM call
    agent_duration_ms           integer,            -- Duration of the extraction
    extracted_by                text                -- Agent/script identifier
);
```

### Observation Kinds

The `kind` column uses the `observation_kind` enum:

| Kind | Count | Description |
|------|-------|-------------|
| `media` | 4,163,420 | Photos, videos, documents |
| `listing` | 585,728 | Auction or marketplace listings |
| `comment` | 425,987 | Comments on listings or forums |
| `bid` | 179,983 | Auction bids |
| `sale_result` | 130,379 | Auction or sale outcomes |
| `condition` | 89,613 | Condition reports and assessments |
| `work_record` | 43,935 | Service records, shop work |
| `specification` | 37,924 | Factory or measured specifications |
| `provenance` | 11,051 | Ownership history, documentation |
| `ownership` | 54 | Direct ownership records |
| `valuation` | 2 | Professional valuations |
| `sighting` | — | Physical sightings (shows, meets) |
| `social_mention` | — | Social media references |
| `expert_opinion` | — | Expert commentary |

### Confidence Levels

The `confidence` column uses the `confidence_level` enum:

| Level | Numeric Range | Meaning |
|-------|--------------|---------|
| `verified` | 0.90-1.00 | Independently confirmed by multiple sources or physical inspection |
| `high` | 0.75-0.89 | From a trusted source with consistent corroboration |
| `medium` | 0.50-0.74 | Default. Single source, no contradiction |
| `low` | 0.25-0.49 | Uncertain source, partial information, or minor contradictions |
| `inferred` | 0.00-0.24 | System-computed, not directly observed |

### The structured_data Column

This JSONB column holds the extracted fields from the observation. Its shape depends on the `kind`:

For `listing` observations:
```json
{
    "year": 1973,
    "make": "Porsche",
    "model": "911 Carrera RS",
    "vin": "9113600784",
    "mileage": 42000,
    "color": "Grand Prix White",
    "engine": "2.7L flat-six",
    "transmission": "5-speed manual",
    "sale_price": 825000,
    "description": "Matching-numbers lightweight..."
}
```

For `bid` observations:
```json
{
    "bid_amount": 45000,
    "bidder_username": "porschenut911",
    "bid_time": "2024-03-15T14:23:00Z",
    "is_winning": false
}
```

For `condition` observations:
```json
{
    "paint_condition": "fair",
    "body_rust": "minor surface rust on rocker panels",
    "interior_condition": "good",
    "mechanical_notes": "engine runs well, needs valve adjustment",
    "overall_rating": 7
}
```

### The Supersession Chain

Observations can be superseded — a newer observation from the same source replaces an older one. This happens when:
- A listing is updated (price change, new photos)
- A correction is posted (seller amends description)
- A re-extraction produces better data from the same source material

The chain is tracked by:
- `is_superseded` — marks the older observation
- `superseded_by` — points to the replacement
- `superseded_at` — when the supersession occurred
- `lineage_chain` — full UUID chain from original to current
- `original_source_id` / `original_source_url` — the root of the chain

This ensures no data is lost — old observations remain in the database, marked as superseded, preserving the full history.

---

## The observation_sources Registry

The `observation_sources` table (159 rows) is the registry of all data sources the system knows about. Each source has a trust profile and capability declaration.

### Full Schema

```sql
CREATE TABLE observation_sources (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    text NOT NULL UNIQUE,          -- Machine-readable identifier
    display_name            text NOT NULL,                 -- Human-readable name
    category                source_category NOT NULL,      -- Enum: what kind of source
    base_url                text,                          -- Root URL of the source
    url_patterns            text[],                        -- URL patterns this source matches
    base_trust_score        numeric DEFAULT 0.50,          -- Default trust score (0-1)
    trust_factors           jsonb DEFAULT '{}',            -- What drives the trust score
    supported_observations  text[],                        -- Which observation kinds this source can produce
    requires_auth           boolean DEFAULT false,         -- Does scraping require authentication?
    rate_limit_per_hour     integer,                       -- Source-imposed rate limits
    makes_covered           text[],                        -- Which makes this source specializes in (null = all)
    years_covered           int4range,                     -- Which year range this source covers
    regions_covered         text[],                        -- Geographic regions
    notes                   text,                          -- Internal notes
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now(),
    business_id             uuid                           -- FK to organizations table
);
```

### Source Categories

The `source_category` enum defines what kind of source this is:

| Category | Count | Description |
|----------|-------|-------------|
| `auction` | ~60 | Auction houses (BaT, Mecum, RM Sotheby's, Barrett-Jackson) |
| `marketplace` | ~25 | Buy/sell platforms (Classic Driver, Hemmings, eBay) |
| `forum` | ~15 | Enthusiast forums (Rennlist, Pelican Parts, model-specific) |
| `social_media` | ~10 | Instagram, YouTube, Facebook groups |
| `registry` | ~8 | Marque registries, VIN databases |
| `shop` | ~5 | Service records, restoration shops |
| `documentation` | ~5 | Titles, build sheets, window stickers |
| `owner` | ~5 | Direct owner input |
| `aggregator` | ~10 | Sites that aggregate listings (ClassicCars.com, CarGurus) |
| `media` | ~5 | Automotive media (articles, reviews) |
| `dealer` | ~5 | Dealership inventory |
| `museum` | ~2 | Museum collections |
| `event` | ~2 | Car shows, concours, rallies |
| `internal` | ~2 | System-generated observations |
| `agent` | ~1 | AI agent observations |

### Trust Score Examples

| Source | Category | Trust Score | Rationale |
|--------|----------|-------------|-----------|
| Gooding & Company | auction | 0.90 | Rigorous pre-sale inspection, institutional reputation |
| RM Sotheby's | auction | 0.90 | Same as Gooding |
| Bonhams | auction | 0.90 | Same as Gooding |
| Bring a Trailer | auction | 0.85 | Community-curated, seller-disclosed, but self-reported |
| Cars & Bids | auction | 0.85 | Similar model to BaT |
| Mecum | auction | 0.75 | Large volume, less individual curation |
| Barrett-Jackson | auction | 0.75 | Entertainment-focused, less documentation depth |
| Classic Driver | marketplace | 0.80 | Curated dealer listings |
| eBay | marketplace | 0.50 | Open platform, minimal verification |
| Forum post | forum | 0.40 | Anecdotal, often expert but unverified |

### Adding a New Source

```sql
INSERT INTO observation_sources (
    slug, display_name, category, base_url, base_trust_score,
    supported_observations, url_patterns
) VALUES (
    'collecting-cars',
    'Collecting Cars',
    'auction',
    'https://collectingcars.com',
    0.80,
    ARRAY['listing', 'sale_result', 'comment', 'bid'],
    ARRAY['collectingcars.com/for-sale/%', 'collectingcars.com/auction/%']
);
```

---

## The observation_extractors Table

Extractors define HOW data is pulled from each source. The table (4 active rows) maps sources to edge functions.

### Full Schema

```sql
CREATE TABLE observation_extractors (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id               uuid NOT NULL,              -- FK to observation_sources
    slug                    text NOT NULL UNIQUE,
    display_name            text NOT NULL,
    extractor_type          text NOT NULL,              -- 'edge_function', 'script', 'cron', etc.
    edge_function_name      text,                       -- Name of the Supabase edge function
    extractor_config        jsonb DEFAULT '{}',         -- Configuration parameters
    produces_kinds          text[] NOT NULL,            -- Which observation kinds this extractor creates
    is_active               boolean DEFAULT true,
    schedule_type           text DEFAULT 'on_demand',   -- 'on_demand', 'cron', 'continuous'
    schedule_cron           text,                       -- Cron expression if scheduled
    rate_limit_per_hour     integer,
    min_interval_seconds    integer DEFAULT 1,
    last_run_at             timestamptz,
    last_success_at         timestamptz,
    last_error              text,
    consecutive_failures    integer DEFAULT 0,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);
```

### Active Extractors

| Slug | Edge Function | Produces | Source |
|------|--------------|----------|--------|
| `bat-extract` | `extract-bat-core` | listing, sale_result, comment | Bring a Trailer |
| `carsandbids-extract` | `extract-cars-and-bids-core` | listing, sale_result | Cars & Bids |
| `mecum-pipeline` | `mecum-proper-extract` | listing, sale_result | Mecum |
| `pcarmarket-extract` | `pcarmarket-proper-extract` | listing | PCarMarket |

### Extractor Types

| Type | Description |
|------|-------------|
| `edge_function` | Supabase edge function called via HTTP |
| `script` | Node.js script run locally or on a schedule |
| `cron` | Scheduled via Supabase pg_cron |
| `manual` | Triggered by operator |

---

## The Ingest Pipeline

### ingest-observation Edge Function

All data writes flow through a single edge function: `ingest-observation`. This is the choke point of the data pipeline — no extractor, no script, no import job writes directly to `vehicle_observations`. Everything goes through `ingest-observation`.

The function:
1. Validates the incoming observation against the schema
2. Computes `content_hash` for deduplication (rejects exact duplicates)
3. Resolves `vehicle_id` — either matches to an existing entity or flags for entity resolution
4. Sets `confidence` and `confidence_score` based on source trust and observation quality
5. Writes to `vehicle_observations`
6. Emits events for downstream processing (discoveries, timeline, etc.)

### Ingest Flow

```
[Extractor / Import / API]
        |
        v
  ingest-observation
        |
        +-- validate schema
        +-- compute content_hash
        +-- deduplicate (reject if hash exists)
        +-- entity resolution (match vehicle_id)
        +-- set confidence from source trust
        +-- INSERT into vehicle_observations
        +-- emit downstream events
        |
        v
  [vehicle_observations row written]
        |
        v
  [triggers / downstream processing]
```

### Legacy Ingest Path

Before the observation model, data entered through:
- Direct `INSERT` into `vehicles` (no provenance)
- The `import_queue` table (batch import)
- Platform-specific edge functions writing directly to `vehicles`

The `migrate-to-observations` edge function ports legacy data into the observation model, creating synthetic observations for data that entered without provenance tracking.

---

## The Discovery Pipeline

Once observations are stored, AI agents process them into discoveries — structured insights derived from the raw testimony.

### observation_discoveries Table (10,454 rows)

Source-agnostic AI analysis across observations:

```sql
CREATE TABLE observation_discoveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id          uuid NOT NULL,
    observation_ids     uuid[],                     -- Which observations fed this discovery
    observation_count   integer,                    -- How many observations were analyzed
    source_categories   text[],                     -- Which source categories contributed
    date_range_start    timestamptz,               -- Earliest observation
    date_range_end      timestamptz,               -- Latest observation
    discovery_type      text NOT NULL,              -- 'sentiment', 'market_signals', 'sentiment_v2'
    raw_extraction      jsonb NOT NULL,             -- Full AI extraction output
    confidence_score    numeric,
    model_used          text,                       -- LLM model used
    prompt_version      text,                       -- Prompt version for reproducibility
    discovered_at       timestamptz DEFAULT now(),
    is_reviewed         boolean DEFAULT false,
    reviewed_at         timestamptz,
    review_notes        text
);
```

Discovery types in production:
- `sentiment` (5,493 rows) — overall sentiment analysis of comment threads
- `market_signals` (4,461 rows) — market interest, pricing signals, demand indicators
- `sentiment_v2` (500 rows) — improved sentiment model

### comment_discoveries Table (126,408 rows)

AI analysis of auction comment threads:

```sql
CREATE TABLE comment_discoveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id          uuid NOT NULL,
    discovered_at       timestamptz,
    model_used          text,
    prompt_version      text,
    raw_extraction      jsonb NOT NULL,             -- Full AI analysis
    comment_count       integer,                    -- Comments analyzed
    total_fields        integer,                    -- Fields extracted
    sale_price          integer,                    -- Price mentioned in comments
    overall_sentiment   text,                       -- positive/negative/mixed/neutral
    sentiment_score     numeric,                    -- -1.0 to 1.0
    reviewed            boolean DEFAULT false,
    review_notes        text,
    data_quality_score  numeric,
    missing_data_flags  text[],                     -- What data the comments lack
    recommended_sources text[],                     -- Where to look for missing data
    question_profile    jsonb                       -- Types of questions asked
);
```

### description_discoveries Table (31,394 rows)

AI extraction from vehicle descriptions:

```sql
CREATE TABLE description_discoveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id          uuid NOT NULL,
    discovered_at       timestamptz,
    model_used          text,
    prompt_version      text,
    raw_extraction      jsonb NOT NULL,             -- Full AI extraction
    keys_found          integer,                    -- How many distinct fields were extracted
    total_fields        integer,                    -- Total fields attempted
    description_length  integer,                    -- Character count of source description
    sale_price          integer,
    reviewed            boolean DEFAULT false,
    review_notes        text,
    schema_suggestions  jsonb,                      -- Suggestions for new schema columns
    promoted_at         timestamptz                 -- When fields were promoted to vehicles table
);
```

### field_evidence Table (3.29M rows)

The bridge between discoveries and the `vehicles` table — individual field-level evidence:

```sql
CREATE TABLE field_evidence (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id              uuid NOT NULL,
    field_name              text NOT NULL,              -- Which vehicles column this evidence supports
    proposed_value          text NOT NULL,              -- The proposed value for that field
    source_type             text NOT NULL,              -- Source category
    source_confidence       integer,                    -- 0-100
    extraction_context      text,                       -- Context around the extraction
    extracted_at            timestamptz,
    supporting_signals      jsonb,                      -- Corroborating evidence
    contradicting_signals   jsonb,                      -- Contradictory evidence
    status                  text,                       -- pending, accepted, rejected, superseded
    assigned_at             timestamptz,
    assigned_by             text,
    raw_extraction_data     jsonb,
    created_at              timestamptz DEFAULT now()
);
```

The field_evidence table is the arbitration layer. When multiple observations claim different values for the same field (e.g., two different mileage readings), the evidence table stores both, with their sources and confidence scores. The highest-confidence, most-recent evidence wins and is materialized into the `vehicles` table.

---

## Discovery Flow

```
vehicle_observations (5.67M)
        |
        +-- [comment observations] --> discover-comment-data --> comment_discoveries (126K)
        |
        +-- [listing descriptions] --> discover-description-data --> description_discoveries (31K)
        |
        +-- [mixed observations] --> discover-from-observations --> observation_discoveries (10K)
        |
        v
  field_evidence (3.29M)
        |
        +-- [highest confidence per field]
        |
        v
  vehicles table columns updated
```

### The discover-from-observations Edge Function

This function operates on the source-agnostic observation model:
1. Selects unprocessed observations (`is_processed = false`)
2. Groups them by vehicle and source category
3. Runs LLM analysis with the appropriate prompt
4. Writes results to `observation_discoveries`
5. Marks observations as processed (`is_processed = true`)

### Processing State

Each observation tracks its processing state:
- `is_processed = false` — awaiting discovery processing
- `is_processed = true` — has been analyzed
- `processing_metadata` — logs of what processing was done, when, and by which model

---

## Source Category Deep Dive

### Auction Sources

Auction platforms produce the richest observations. A single BaT listing can generate:
- 1 `listing` observation (the listing itself)
- 1 `sale_result` observation (the auction outcome)
- 50-500 `comment` observations (community discussion)
- 20-200 `bid` observations (bid history)
- 50-200 `media` observations (listing photos)

### Forum Sources

Forums produce high-context observations but at low volume and variable trust. A Rennlist thread about a specific 993 might contain:
- Expert opinions on engine condition from known mechanics
- Ownership history shared by previous owners
- Modification details with part numbers
- But also speculation, hearsay, and misidentification

### Documentation Sources

The highest-trust non-institutional source. Build sheets, window stickers, and factory order forms are essentially ground truth for factory specifications. These observations carry near-`verified` confidence.

### Shop Sources

Service records from known shops (e.g., registered in the `organizations` table) are high-trust for condition and work history. These typically arrive as `work_record` observations.

---

## Edge Functions in the Observation Pipeline

| Function | Role |
|----------|------|
| `ingest-observation` | Universal intake — all observations flow through here |
| `api-v1-observations` | REST API for observation queries |
| `discover-from-observations` | Source-agnostic AI analysis |
| `migrate-to-observations` | Ports legacy data into the observation model |
| `autonomous-source-ingestion-agent` | Automated source discovery and ingestion |
| `extract-bat-core` | BaT-specific extraction into observations |
| `extract-cars-and-bids-core` | C&B-specific extraction |
| `mecum-proper-extract` | Mecum-specific extraction |
| `pcarmarket-proper-extract` | PCarMarket-specific extraction |

---

## The Content Hash: Deduplication

Every observation has a `content_hash` (SHA-256 of normalized content). This prevents the same observation from being ingested twice — a critical safety net given that extractors may re-process the same source pages.

The deduplication logic:
1. Compute hash of `(source_url, kind, content_text, structured_data)`
2. Check `vehicle_observations` for existing hash
3. If found: skip (or update if `structured_data` has new fields)
4. If not found: insert new observation

---

## The Write Layer: From Observation to Vehicles Table

The observation model records evidence. The vehicles table materializes truth. The write layer is the bridge between them — a set of rules that determine when an observation should update a vehicle column, when it should merely confirm an existing value, and when it should be quarantined as a conflict.

### The Tetris Write Layer (batUpsertWithProvenance)

The Tetris metaphor: data fields fall like Tetris pieces. Each piece either fills a gap (lands in an empty slot), confirms what is already there (stacks neatly), or conflicts with what exists (gets quarantined, not forced in).

The module `_shared/batUpsertWithProvenance.ts` implements three actions for every field write:

| Action | Condition | What Happens |
|--------|-----------|--------------|
| **Gap Fill** | Vehicle column is NULL | Write the value, set `*_source` column, write extraction_metadata receipt |
| **Confirmation** | Vehicle column matches proposed value | Write verification receipt only (no overwrite) |
| **Conflict** | Vehicle column differs from proposed value | Write to bat_quarantine, write extraction_metadata receipt with status "conflicting" |

This prevents data regression — a lower-trust source cannot silently overwrite a higher-trust value. Every write is auditable through `extraction_metadata` receipts.

#### Source Column Tracking

For key vehicle fields, a parallel `*_source` column tracks which extractor version wrote the value:

| Field | Source Column |
|-------|-------------|
| `make` | `make_source` |
| `model` | `model_source` |
| `year` | `year_source` |
| `vin` | `vin_source` |
| `mileage` | `mileage_source` |
| `color` | `color_source` |
| `transmission` | `transmission_source` |
| `engine_size` | `engine_source` |
| `description` | `description_source` |
| `trim` | `trim_source` |

#### extraction_metadata: The Receipt Table

Every field write generates a receipt in `extraction_metadata` (745,881 rows):

| Validation Status | Count | Meaning |
|-------------------|-------|---------|
| `unvalidated` | 574,463 | Written but not cross-checked |
| `valid` | 130,029 | Confirmed by a second independent source |
| `conflicting` | 41,388 | Contradicted by another source |
| `low_confidence` | 1 | Below confidence threshold |

#### The Quarantine Table

When the Tetris layer detects a conflict, the proposed value goes to `bat_quarantine` (43,168 rows) instead of overwriting the existing value. The most quarantined fields reveal where sources disagree most:

| Field | Quarantined | Typical Conflict |
|-------|-------------|------------------|
| `transmission` | 13,433 | "Automatic" vs "4-speed automatic" (specificity mismatch) |
| `sale_status` | 12,692 | Timing: extracted before auction ended vs after |
| `listing_location` | 3,385 | Different location formats ("CA" vs "Los Angeles, CA") |
| `color` | 2,485 | "Silver" vs "Silver Metallic" vs "Silber" |
| `interior_color` | 1,858 | Same normalization issues as exterior |
| `mileage` | 935 | Different sources, different moments (mileage changes) |
| `sale_price` | 711 | Hammer price vs total with premium |

Quarantine is not a failure — it is the system working correctly. Conflicts represent genuine disagreements in the data that require human or algorithmic resolution. The quarantine table is a work queue, not an error log.

### The observationWriter Bridge Module

The `_shared/observationWriter.ts` module (465 lines) bridges the observation system and the legacy write path. It was built to allow extractors to adopt the observation model incrementally — they can call a single function that writes to both systems simultaneously.

#### API

```typescript
import { writeObservation, writeObservationBatch } from "../_shared/observationWriter.ts";

// Single observation + gap-fill + evidence
const result = await writeObservation(supabase, {
  vehicleId: "uuid",
  source: {
    platform: "bat",          // observation_sources.slug
    url: "https://...",       // source URL
    trustScore: 0.85,         // override source base_trust_score
    sourceIdentifier: "lot-123", // platform-specific ID
  },
  fields: {                   // extracted key-value pairs
    year: 1967,
    make: "Porsche",
    model: "911S",
    mileage: 42000,
  },
  observationKind: "listing", // observation_kind enum
  extractionMethod: "dom_parse", // how the data was extracted
  observedAt: "2024-01-15T10:30:00Z", // when the observation was made
  agentModel: "grok-3-mini",  // LLM provenance (optional)
});

// Returns:
{
  observationId: "uuid",      // ID in vehicle_observations
  duplicate: false,           // true if content_hash matched existing
  gapFilled: ["mileage"],     // fields that were NULL and are now filled
  confirmed: ["year", "make", "model"], // fields that matched existing
  conflicted: [],             // fields that disagreed (quarantined)
  evidenceIds: ["uuid", ...], // IDs in field_evidence
  errors: [],                 // any subsystem errors (non-fatal)
}
```

#### Three Parallel Operations

Each `writeObservation` call executes three independent operations in parallel:

1. **Observation Row** — Resolves the source from `observation_sources`, computes content hash for dedup, writes to `vehicle_observations` with computed confidence
2. **Gap Fill** — Filters out computed fields (from `pipeline_registry`), fetches existing vehicle, runs Tetris logic via `batchUpsertWithProvenance`, applies gap-fill update to `vehicles`
3. **Field Evidence** — Writes individual `field_evidence` rows for each extracted field with source confidence and extraction context

Each operation catches its own errors independently. An observation write failure does not block gap-fill, and vice versa. This isolation is critical for production reliability — the system degrades gracefully rather than failing completely.

#### Computed Field Protection

The module queries `pipeline_registry` to identify fields that are computed by other pipelines (23 fields including `nuke_estimate`, `heat_score`, `completion_percentage`, etc.). These fields are automatically excluded from gap-fill, even if the extractor passes them in the `fields` object. This prevents extractors from overwriting values that are computed by dedicated analysis pipelines.

The computed field set is cached in memory for the lifetime of the edge function invocation, so the pipeline_registry lookup happens at most once per request.

#### Source Cache

Source lookups (`observation_sources` by slug) are also cached in memory. Since most batch operations use a single source, this avoids repeated database roundtrips.

#### Batch API

```typescript
const batchResult = await writeObservationBatch(supabase, [
  { vehicleId: "uuid-1", source: {...}, fields: {...}, ... },
  { vehicleId: "uuid-2", source: {...}, fields: {...}, ... },
]);

// Returns:
{
  results: WriteResult[],
  totals: {
    observations: 45,
    duplicates: 3,
    gapFills: 120,
    confirmations: 340,
    conflicts: 5,
    evidenceRows: 450,
    errors: 2,
  }
}
```

Batch operations process sequentially to avoid overwhelming the database. Each individual `writeObservation` already parallelizes its three sub-operations, so the effective throughput is high without requiring connection pooling coordination.

---

## The Batch Ingest Pipeline

### ingest-observation-batch Edge Function

For high-volume ingestion, the `ingest-observation-batch` endpoint accepts up to 200 observations per request. Each observation uses the same schema as `ingest-observation`.

```
POST /functions/v1/ingest-observation-batch
{
  "observations": [
    { "source_slug": "bat", "kind": "listing", "observed_at": "...", ... },
    { "source_slug": "bat", "kind": "comment", "observed_at": "...", ... },
    ...
  ],
  "options": {
    "stop_on_error": false,    // continue on individual failures (default)
    "gap_fill": true,          // also gap-fill vehicles table
    "write_evidence": true     // also write field_evidence rows
  }
}
```

The batch endpoint delegates each observation to `ingest-observation` via internal HTTP. This preserves the full vehicle resolution, source validation, dedup, and confidence scoring pipeline. The tradeoff is latency (sequential HTTP calls) vs. consistency (no duplicated logic).

When `gap_fill` or `write_evidence` options are enabled, the batch endpoint additionally calls `writeObservation` for each successfully ingested observation that has a resolved `vehicle_id` and `structured_data`. This means a single batch call can:
1. Write observation rows (via `ingest-observation`)
2. Gap-fill the vehicles table (via `observationWriter` Tetris layer)
3. Write field_evidence provenance (via `observationWriter`)

Response format:
```json
{
  "success": true,
  "total": 50,
  "ingested": 45,
  "duplicates": 3,
  "failed": 2,
  "results": [
    { "index": 0, "success": true, "observation_id": "uuid", "vehicle_id": "uuid", "duplicate": false },
    { "index": 1, "success": true, "observation_id": "uuid", "duplicate": true },
    { "index": 2, "success": false, "error": "Unknown source: xyz" },
    ...
  ]
}
```

---

## The Retroactive Adoption Pattern

Adopting the observation model across an existing codebase of 30+ extractors cannot happen in a single migration. The observationWriter module enables a "fire-and-forget" adoption pattern: existing extractors keep their legacy write paths, and observation writes are added alongside them.

### Pattern: Fire-and-Forget Observation

```typescript
import { writeObservation } from "../_shared/observationWriter.ts";

// Existing legacy write (preserved for backward compatibility)
await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);

// New observation write (fire-and-forget — errors don't block the extractor)
writeObservation(supabase, {
  vehicleId,
  source: { platform: "bat", url: sourceUrl },
  fields: extractedFields,
  observationKind: "specification",
  extractionMethod: "snapshot_regex_parse",
}).catch((e) => console.warn(`observationWriter error: ${e?.message}`));
```

The `.catch()` on the promise ensures that observation system failures never break the existing extraction pipeline. The observation write is purely additive — it creates provenance records without altering the existing data flow.

### Retrofitted Extractors (as of March 2026)

| Extractor | Observation Kind | Extraction Method | Notes |
|-----------|-----------------|-------------------|-------|
| `batch-extract-snapshots` | `specification` | `snapshot_regex_parse` | Multi-platform (BaT, Mecum, Barrett-Jackson, C&B, Bonhams) |
| `enrich-listing-content` | `specification` | `listing_content_llm` | LLM-extracted content fields (highlights, equipment, modifications) |
| `extract-cars-and-bids-core` | `listing` | `dom_parse` | Full listing data including description sections |
| `discover-description-data` | `specification` | `description_discovery_{model}` | LLM-discovered fields from descriptions. Also uses `ingest-observation` for condition data |

The target is 30/30 extractors using the observation system. Progress is tracked by counting extractors that import `observationWriter.ts` or call `ingest-observation` directly.

### Migration Sequence

The full migration from legacy writes to observation-first writes follows this sequence:

1. **Phase 1: Additive** (current) — Add `writeObservation` calls alongside existing `vehicles` table writes. Both paths execute. The observation system accumulates provenance while the legacy path continues working.

2. **Phase 2: Observation-Primary** — The observation system becomes the source of truth. Gap-fill via `writeObservation` replaces direct `vehicles` table updates. The `vehicles` table is materialized from observations rather than written to directly.

3. **Phase 3: Legacy Removal** — Direct `vehicles` writes are removed from extractors. All data flows through `ingest-observation` or `writeObservation`. The `vehicles` table columns are computed views over `vehicle_observations` and `field_evidence`.

Phase 1 is safe to execute in parallel across all extractors because `writeObservation` is purely additive and its failures are isolated. Phase 2 requires careful coordination because it changes the source of truth. Phase 3 is a cleanup step.

---

## Temporal Decay and Freshness

Observations are testimony at a point in time. A mileage reading from 2020 is less reliable in 2026 than a mileage reading from 2025. The observation model tracks temporal relevance through several mechanisms.

### observed_at vs ingested_at

Every observation has two timestamps:
- `observed_at` — when the observation was actually made (the date of the listing, the date of the comment, the date of the service record)
- `ingested_at` — when the system processed it

These are often different. A BaT listing from 2019 might be ingested in 2026 when the `migrate-to-observations` function processes legacy data. The `observed_at` timestamp is the epistemically relevant one — it tells us when the claim was true (or at least, when the source made the claim).

### Data Freshness at Discovery

The `data_freshness_at_discovery` interval column records how old the observation data was when the system first encountered it. A listing scraped 3 hours after posting has high freshness. The same listing found via the Wayback Machine 5 years later has low freshness.

Freshness matters because:
- Mileage changes over time (a car driven 10K miles/year)
- Prices change (market fluctuations)
- Condition changes (wear, rust, restoration)
- Ownership changes (title transfers)

### Temporal Relevance in Conflict Resolution

When two observations conflict, temporal recency is a tiebreaker (after confidence). A 2024 condition report that says "excellent" is more relevant than a 2019 condition report that says "good" — the car may have been restored in between.

However, temporal recency is not always correct. A 2024 eBay listing (trust 0.5) claiming "matching numbers" is less reliable than a 2019 Porsche Certificate of Authenticity (trust 0.98) saying otherwise. Trust score takes priority; time breaks ties within the same trust tier.

### The Supersession Chain and Temporal Ordering

When the same source updates its claim (a listing is edited, a price changes), the old observation is superseded rather than deleted. The `lineage_chain` preserves the full temporal sequence:

```
observation_v1 (Jan 15, mileage: 42000)
    └── superseded_by → observation_v2 (Jan 20, mileage: 42150)
        └── superseded_by → observation_v3 (Feb 1, mileage: 42300)
```

This chain reveals information that a single snapshot cannot: the car was driven ~300 miles in two weeks during January. The supersession chain is not just version control — it is a signal.

### Decay Functions (Not Yet Implemented)

The system is designed for but does not yet implement formal decay functions. The planned approach:

- **Linear decay**: For fields that change gradually (mileage, condition). Confidence decreases proportionally with age.
- **Step decay**: For fields that change at discrete events (ownership, title status). Confidence drops at known transfer events.
- **No decay**: For immutable fields (VIN, year, factory specifications). A VIN from 1970 is as valid in 2026.

The `confidence_factors` JSONB column on `vehicle_observations` is designed to hold temporal decay metadata when implemented.

---

## Extraction Method Taxonomy

The `extraction_method` column on `vehicle_observations` records HOW data was extracted. This is critical for understanding the epistemic quality of observations — a regex match against structured HTML is fundamentally different from an LLM interpretation of free text.

### Current Methods in Production

| Method | Count | Description | Typical Confidence |
|--------|-------|-------------|-------------------|
| `vehicle_events_migration` | 309,929 | Synthetic observations from legacy `vehicle_events` data | Medium (inherited) |
| `backfill-from-vehicles` | 189,701 | Synthetic observations from legacy `vehicles` columns | Medium (inherited) |
| `backfill-sale-results` | 130,376 | Synthetic observations for sale outcomes | Medium (inherited) |
| `llm_extraction` | 81,379 | LLM-based extraction from text content | Medium |
| `description_condition_v1` | 77,953 | Condition extraction from listing descriptions | Medium |
| `contradiction_detection` | 485 | Multi-source contradiction analysis | High |
| `multi_model_consensus` | 482 | Multiple LLMs agree on the same extraction | High |
| `vision_condition_v1` | 11 | Computer vision condition assessment | Medium |
| `claude_opus_grouped_vision` | 3 | Opus-tier vision analysis of photo groups | High |
| `osxphotos_analysis` | 1 | Local photo library metadata extraction | High |
| `gmail_newsletter_mining` | 1 | Email newsletter content extraction | Medium |

### Method Categories

Methods fall into epistemic categories:

**Deterministic** (highest reliability):
- `snapshot_regex_parse` — Regex against structured HTML fields
- `dom_parse` — DOM element extraction from known page structure
- `json_ld_parse` — Structured data from JSON-LD schema markup

**Statistical** (high reliability):
- `multi_model_consensus` — Multiple independent LLMs agree
- `contradiction_detection` — Cross-source validation

**LLM** (moderate reliability):
- `llm_extraction` — Single LLM extraction from text
- `listing_content_llm` — LLM extraction of listing-specific content
- `description_discovery_{model}` — Open-ended LLM discovery

**Synthetic** (inherited reliability):
- `vehicle_events_migration` — Legacy data ported to observations
- `backfill-from-vehicles` — Existing vehicle columns wrapped as observations
- `backfill-sale-results` — Sale data wrapped as observations

**Vision** (emerging):
- `vision_condition_v1` — Computer vision condition assessment
- `claude_opus_grouped_vision` — Multi-image analysis

### Method and Confidence

The extraction method influences the confidence score computation. Deterministic methods receive a small confidence boost because their error mode is structural (wrong HTML → no data) rather than interpretive (LLM → plausible but wrong data). The system trusts a regex that finds nothing over an LLM that invents something.

---

## Pipeline Statistics (March 2026)

### Scale

| Metric | Count |
|--------|-------|
| Total observations | 5,703,953 |
| Distinct vehicles with observations | 449,747 |
| Total vehicles in system | 508,608 |
| Observation coverage | 88.4% of vehicles |
| Total field_evidence rows | 3,290,472 |
| Registered sources | 160 |
| extraction_metadata receipts | 745,881 |
| Quarantined conflicts | 43,168 |

### Observation Volume by Kind

| Kind | Count | % of Total |
|------|-------|-----------|
| `media` | 4,197,356 | 73.6% |
| `listing` | 585,728 | 10.3% |
| `comment` | 425,987 | 7.5% |
| `bid` | 179,983 | 3.2% |
| `sale_result` | 130,379 | 2.3% |
| `condition` | 89,613 | 1.6% |
| `work_record` | 43,935 | 0.8% |
| `specification` | 37,924 | 0.7% |
| `provenance` | 11,051 | 0.2% |
| `ownership` | 54 | <0.01% |
| `valuation` | 2 | <0.01% |

Media observations dominate because each listing photo generates an individual observation. The epistemically richer observation kinds (specification, condition, provenance) are the frontier for growth.

### Confidence Distribution

| Level | Count | % |
|-------|-------|---|
| `high` | 5,494,455 | 96.3% |
| `medium` | 183,248 | 3.2% |
| `verified` | 26,263 | 0.5% |
| `low` | 0 | 0% |
| `inferred` | 0 | 0% |

The heavy skew toward `high` confidence reflects that most observations come from auction platforms (BaT, Mecum, Barrett-Jackson) which have base trust scores of 0.75-0.85. The `verified` tier requires independent corroboration — only 0.5% of observations have been cross-checked against a second source.

### Field Evidence Coverage

The 20 most-evidenced vehicle fields:

| Field | Evidence Rows | Status: Accepted | Status: Pending |
|-------|--------------|-------------------|-----------------|
| `model` | 358,638 | 96.5% accepted | 3.5% pending |
| `make` | 356,152 | 96.5% | 3.5% |
| `year` | 350,257 | 96.5% | 3.5% |
| `sale_price` | 293,982 | 96.3% | 3.7% |
| `body_style` | 264,895 | 96.4% | 3.6% |
| `transmission` | 259,830 | 96.4% | 3.6% |
| `color` | 247,301 | 96.4% | 3.6% |
| `interior_color` | 239,053 | 96.4% | 3.6% |
| `engine_size` | 219,546 | 96.4% | 3.6% |
| `mileage` | 212,395 | 96.4% | 3.6% |
| `vin` | 209,243 | 96.4% | 3.6% |
| `drivetrain` | 169,726 | 96.3% | 3.7% |

The overall field_evidence status breakdown: 3,172,999 accepted (96.4%), 117,472 pending (3.6%), 1 rejected. The low rejection rate reflects that field_evidence is written alongside gap-fill operations — by the time evidence is written, the value has already been assessed by the Tetris layer.

---

## The Entity Resolution Interface

The observation model and entity resolution system intersect at vehicle matching. When an observation arrives without a `vehicle_id`, the `ingest-observation` function attempts to resolve it:

### Resolution Cascade

1. **VIN match** (confidence 0.99) — Normalize VIN, exact match against `vehicles.vin`
2. **Canonical URL match** (confidence 0.95) — Normalize URL, match canonical listing ID against `vehicles.listing_url` and `discovery_url`
3. **Event URL match** (confidence 0.95) — Exact URL match in `vehicle_events.source_url`
4. **Normalized event URL** (confidence 0.90) — Normalized URL match in `vehicle_events`
5. **Year/Make fuzzy match** (confidence 0.60) — If only one vehicle matches year+make. Multiple matches are left unresolved.

The `vehicle_match_confidence` and `vehicle_match_signals` columns record which resolution tier was used and what signals drove it. Observations with confidence below 0.60 are stored without a `vehicle_id` for later manual resolution.

### Unresolved Observations

Observations that cannot be matched to a vehicle are not discarded. They are stored with `vehicle_id = NULL` and can be resolved later when:
- The vehicle is created (a new listing is extracted)
- A VIN becomes available (from a subsequent extraction pass)
- Manual curation assigns the observation to a vehicle

---

## Summary

The observation model transforms the platform from a vehicle listing database into an evidence accumulation system. No data point enters without provenance. No claim stands without a source. No source is trusted absolutely. The convergence of independent observations, weighted by source trust and temporal relevance, produces the materialized truth in the `vehicles` table — a truth that improves with every new observation ingested.

The write layer (Tetris + observationWriter) ensures that truth materialization is safe: gap-fills never regress, conflicts are quarantined, and every write is auditable. The batch ingest pipeline scales observation intake to hundreds per request. The retroactive adoption pattern allows extractors to join the observation system incrementally without breaking their existing functionality.

At 5.7 million observations across 449,747 vehicles from 160 sources, the observation model is the largest vehicle evidence database in the collector car space. Its value compounds: each new observation makes existing observations more valuable through corroboration, contradiction detection, and temporal sequencing.
