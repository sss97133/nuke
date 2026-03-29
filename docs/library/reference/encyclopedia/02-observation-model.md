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

## Summary

The observation model transforms the platform from a vehicle listing database into an evidence accumulation system. No data point enters without provenance. No claim stands without a source. No source is trusted absolutely. The convergence of independent observations, weighted by source trust and temporal relevance, produces the materialized truth in the `vehicles` table — a truth that improves with every new observation ingested.
