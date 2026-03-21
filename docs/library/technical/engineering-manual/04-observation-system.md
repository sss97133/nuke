# Chapter 4: Observation System

## What This Subsystem Does

The observation system is the unified data ingestion layer. Every piece of information about a vehicle -- a listing, a comment, a bid, a photo, a forum post, a service record -- enters the system as an "observation" from a registered source. The observation system validates the source, deduplicates by content hash, resolves the vehicle (matching the observation to an existing vehicle record), computes a confidence score, and fires downstream analysis triggers. This replaces the earlier architecture where each data type had its own intake path.

---

## Key Tables and Functions

### Tables

| Table | Purpose |
|-------|---------|
| `observation_sources` | Registry of all data sources with trust scores. |
| `vehicle_observations` | Unified event store for all observations. |
| `observation_extractors` | Maps sources to their extractor functions. |
| `observation_discoveries` | AI-derived insights from observations. |

### Edge Functions

| Function | Purpose |
|----------|---------|
| `ingest-observation` | Single entry point for all observations. |
| `discover-from-observations` | AI analysis of observations. |
| `migrate-to-observations` | Ports legacy data into the observation model. |
| `analysis-engine-coordinator` | Triggered by new observations for widget evaluation. |

---

## The Observation Source Registry

Every data source must be registered in `observation_sources` before observations can be ingested from it.

### Schema

```sql
CREATE TABLE observation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  base_trust_score NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  supported_observations TEXT[] NOT NULL DEFAULT '{}',
  config JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Source Categories

| Category | Trust Range | Examples |
|----------|------------|---------|
| `registry` | 0.90-0.95 | VIN decode, manufacturer records, build sheets |
| `auction` | 0.75-0.90 | BaT, RM Sotheby's, Gooding, Mecum |
| `dealer` | 0.65-0.75 | Hemmings, Hagerty, PCarMarket |
| `marketplace` | 0.45-0.55 | eBay, Craigslist, Facebook Marketplace |
| `forum` | 0.40-0.50 | Rennlist, Pelican Parts, TheSamba |
| `social_media` | 0.30-0.40 | Instagram, YouTube, Facebook groups |
| `owner` | 0.55-0.65 | Direct owner input via Nuke |
| `documentation` | 0.80-0.90 | Titles, build sheets, service manuals |

### Supported Observation Kinds

Each source declares which kinds of observations it can produce:

```sql
-- BaT produces listings, comments, bids
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('bat', 'Bring a Trailer', 'auction', 0.90, ARRAY['listing', 'comment', 'bid', 'result']);

-- iPhoto produces images
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('iphoto', 'Apple Photos', 'owner', 0.60, ARRAY['photo']);
```

---

## The ingest-observation Function

This is the single entry point for all data entering the system. Every extractor writes through this function.

### Input Schema

```typescript
interface ObservationInput {
  source_slug: string;        // Registered source (e.g., "bat", "craigslist")
  kind: string;               // Observation type (e.g., "listing", "comment", "bid")
  observed_at: string;        // ISO timestamp of when the observation occurred
  source_url?: string;        // URL of the source page
  source_identifier?: string; // Source-specific ID (e.g., BaT comment ID)
  content_text?: string;      // Human-readable text content
  structured_data?: Record<string, unknown>;  // Machine-readable structured data
  vehicle_id?: string;        // If already resolved
  vehicle_hints?: {           // Hints for vehicle resolution
    vin?: string;
    plate?: string;
    year?: number;
    make?: string;
    model?: string;
    url?: string;
  };
  observer_raw?: Record<string, unknown>;    // Raw observer data (username, etc.)
  extractor_id?: string;                     // Which extractor produced this
  extraction_metadata?: Record<string, unknown>; // Extraction run metadata
}
```

### Processing Pipeline

The function processes each observation through five stages:

**Stage 1: Source Validation**

```typescript
const { data: source } = await supabase
  .from("observation_sources")
  .select("id, base_trust_score, supported_observations")
  .eq("slug", input.source_slug)
  .maybeSingle();

if (!source) {
  return error(`Unknown source: ${input.source_slug}`);
}

if (!source.supported_observations?.includes(input.kind)) {
  return error(`Source ${input.source_slug} does not support kind: ${input.kind}`);
}
```

**Stage 2: Content Hash Deduplication**

Every observation is hashed by its source, kind, identifier, text, and structured data. Duplicate content is rejected idempotently:

```typescript
const contentForHash = JSON.stringify({
  source: input.source_slug,
  kind: input.kind,
  identifier: input.source_identifier,
  text: input.content_text,
  data: input.structured_data
});
const contentHash = await hashContent(contentForHash);

const { data: existing } = await supabase
  .from("vehicle_observations")
  .select("id")
  .eq("content_hash", contentHash)
  .maybeSingle();

if (existing) {
  return { success: true, duplicate: true, observation_id: existing.id };
}
```

The hash function is SHA-256:

```typescript
async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}
```

**Stage 3: Vehicle Resolution**

If `vehicle_id` is not provided, the system attempts to resolve it using the three-pass cascade described in Chapter 3:

1. VIN match (confidence 0.99)
2. URL match via vehicle_events (confidence 0.95)
3. Fuzzy year/make match (confidence 0.60, only if unique)

If multiple candidates are found, the observation is stored without a vehicle_id and flagged with `multiple_candidates: true` in the match signals.

**Stage 4: Confidence Scoring**

The confidence score combines the source's base trust score with contextual factors:

```typescript
const confidenceFactors = {};
if (vehicleMatchConfidence >= 0.95) confidenceFactors.vehicle_match = 0.1;
if (input.source_url) confidenceFactors.has_source_url = 0.05;
if (input.content_text?.length > 100) confidenceFactors.substantial_content = 0.05;

const confidenceScore = Math.min(1.0,
  source.base_trust_score +
  Object.values(confidenceFactors).reduce((a, b) => a + b, 0)
);

// Map score to level
let confidenceLevel = "medium";
if (confidenceScore >= 0.95) confidenceLevel = "verified";
else if (confidenceScore >= 0.85) confidenceLevel = "high";
else if (confidenceScore < 0.4) confidenceLevel = "low";
```

**Stage 5: Insert and Trigger Analysis**

```typescript
const { data: observation } = await supabase
  .from("vehicle_observations")
  .insert({
    vehicle_id: vehicleId,
    vehicle_match_confidence: vehicleId ? vehicleMatchConfidence : null,
    vehicle_match_signals: vehicleMatchSignals,
    observed_at: input.observed_at,
    source_id: source.id,
    source_url: input.source_url,
    source_identifier: input.source_identifier,
    kind: input.kind,
    content_text: input.content_text,
    content_hash: contentHash,
    structured_data: input.structured_data || {},
    confidence: confidenceLevel,
    confidence_score: confidenceScore,
    confidence_factors: confidenceFactors,
    observer_raw: input.observer_raw,
    extractor_id: input.extractor_id,
    extraction_metadata: input.extraction_metadata
  })
  .select()
  .maybeSingle();

// Fire-and-forget: trigger analysis engine
if (vehicleId && input.kind) {
  fetch(`${supabaseUrl}/functions/v1/analysis-engine-coordinator`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({
      action: "observation_trigger",
      vehicle_id: vehicleId,
      observation_kind: input.kind
    }),
  }).catch(() => {});  // intentionally fire-and-forget
}
```

The analysis trigger is non-blocking. If the analysis engine is down or slow, it does not affect observation ingestion.

---

## The vehicle_observations Table

### Schema

```sql
CREATE TABLE vehicle_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_match_confidence NUMERIC(3,2),
  vehicle_match_signals JSONB,
  observed_at TIMESTAMPTZ NOT NULL,
  source_id UUID REFERENCES observation_sources(id) NOT NULL,
  source_url TEXT,
  source_identifier TEXT,
  kind TEXT NOT NULL,
  content_text TEXT,
  content_hash TEXT NOT NULL,
  structured_data JSONB DEFAULT '{}',
  confidence TEXT DEFAULT 'medium',
  confidence_score NUMERIC(3,2),
  confidence_factors JSONB DEFAULT '{}',
  observer_raw JSONB,
  extractor_id TEXT,
  extraction_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Deduplication index
CREATE UNIQUE INDEX idx_observations_content_hash ON vehicle_observations (content_hash);

-- Vehicle lookup index
CREATE INDEX idx_observations_vehicle ON vehicle_observations (vehicle_id, kind, observed_at DESC)
  WHERE vehicle_id IS NOT NULL;

-- Unresolved observations (for manual review)
CREATE INDEX idx_observations_unresolved ON vehicle_observations (created_at DESC)
  WHERE vehicle_id IS NULL;

-- Source filtering
CREATE INDEX idx_observations_source ON vehicle_observations (source_id, kind);
```

---

## How to Register a New Observation Source

### Step 1: Insert the Source

```sql
INSERT INTO observation_sources (
  slug, display_name, category, base_trust_score, supported_observations
) VALUES (
  'xyz-auctions',
  'XYZ Auctions',
  'auction',
  0.75,
  ARRAY['listing', 'comment', 'bid', 'result']
);
```

### Step 2: Configure the Extractor (Optional)

If an edge function exists for this source:

```sql
INSERT INTO observation_extractors (
  source_id,
  extractor_type,
  edge_function_name,
  produces_kinds
) VALUES (
  (SELECT id FROM observation_sources WHERE slug = 'xyz-auctions'),
  'edge_function',
  'extract-xyz',
  ARRAY['listing', 'comment']
);
```

### Step 3: Send Observations

```typescript
const response = await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    source_slug: "xyz-auctions",
    kind: "listing",
    observed_at: new Date().toISOString(),
    source_url: "https://xyz-auctions.com/lot/12345",
    source_identifier: "lot-12345",
    content_text: "1967 Porsche 911S in Silver...",
    structured_data: {
      year: 1967,
      make: "Porsche",
      model: "911S",
      sale_price: 285000,
    },
    vehicle_hints: {
      year: 1967,
      make: "Porsche",
      model: "911S",
      url: "https://xyz-auctions.com/lot/12345"
    }
  })
});
```

---

## Migrating Legacy Data to Observations

The system has legacy data in purpose-specific tables (`auction_comments`, `description_discoveries`, `comment_discoveries`). The `migrate-to-observations` function ports this data into the unified observation model.

### Migration Pattern

```typescript
// For each legacy comment
for (const comment of legacyComments) {
  await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
    method: "POST",
    body: JSON.stringify({
      source_slug: "bat",
      kind: "comment",
      observed_at: comment.posted_at,
      source_url: comment.source_url,
      source_identifier: `comment-${comment.id}`,
      content_text: comment.comment_text,
      structured_data: {
        username: comment.username,
        is_seller: comment.is_seller,
        is_buyer: comment.is_buyer,
      },
      vehicle_id: comment.vehicle_id,
    })
  });
}
```

The content hash deduplication ensures that re-running the migration is safe (already-migrated observations are skipped).

---

## How to Build the Observation System from Scratch

### Step 1: Create observation_sources

```sql
CREATE TABLE observation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'auction', 'dealer', 'marketplace', 'forum',
    'social_media', 'registry', 'shop', 'owner',
    'documentation'
  )),
  base_trust_score NUMERIC(3,2) NOT NULL DEFAULT 0.50
    CHECK (base_trust_score >= 0 AND base_trust_score <= 1),
  supported_observations TEXT[] NOT NULL DEFAULT '{}',
  config JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Step 2: Seed the core sources

```sql
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations) VALUES
  ('bat', 'Bring a Trailer', 'auction', 0.90, ARRAY['listing', 'comment', 'bid', 'result']),
  ('mecum', 'Mecum Auctions', 'auction', 0.75, ARRAY['listing', 'result']),
  ('rm-sothebys', 'RM Sotheby''s', 'auction', 0.90, ARRAY['listing', 'result']),
  ('craigslist', 'Craigslist', 'marketplace', 0.50, ARRAY['listing']),
  ('facebook-marketplace', 'Facebook Marketplace', 'marketplace', 0.45, ARRAY['listing']),
  ('iphoto', 'Apple Photos', 'owner', 0.60, ARRAY['photo']),
  ('vin-decode', 'NHTSA VIN Decode', 'registry', 0.95, ARRAY['vin_data']),
  ('owner-input', 'Owner Direct Input', 'owner', 0.60, ARRAY['listing', 'photo', 'document', 'service_record']);
```

### Step 3: Create vehicle_observations

Use the schema shown above.

### Step 4: Deploy ingest-observation

The full implementation is at `supabase/functions/ingest-observation/index.ts`. Key components:
1. Source validation (lookup by slug, check supported kinds)
2. Content hash computation (SHA-256 of source+kind+identifier+text+data)
3. Deduplication check (unique index on content_hash)
4. Vehicle resolution (three-pass cascade)
5. Confidence scoring (base_trust_score + contextual factors)
6. Insert with all metadata
7. Fire-and-forget analysis trigger

### Step 5: Set up the analysis trigger

The analysis engine coordinator receives observation triggers and queues relevant analysis widgets for the vehicle:

```sql
-- The analysis engine is called with:
-- { action: "observation_trigger", vehicle_id: "...", observation_kind: "listing" }
-- It looks up which widgets care about this observation kind and queues them.
```

---

## Known Problems

1. **No batch ingestion endpoint.** Each observation requires a separate HTTP call to `ingest-observation`. For bulk imports (migrating 100K legacy comments), this is slow. A batch endpoint that accepts arrays would be more efficient.

2. **Content hash is too strict.** If the same listing is scraped twice and the description has a single whitespace difference, the hashes differ and both are stored. Fuzzy hashing or pre-normalization of content before hashing would reduce near-duplicates.

3. **Vehicle resolution runs on every ingestion.** For high-volume sources (FB Marketplace, 1000+ listings/sweep), the three-pass resolution adds latency. Batch resolution or a pre-resolved vehicle_id from the scraper would be faster.

4. **Confidence scoring is simplistic.** The current formula (base_trust + small bonuses) does not account for contradiction (two sources disagreeing on the same field), recency, or observation volume. A Bayesian approach would be more robust.

5. **Analysis trigger is fire-and-forget.** If the analysis engine coordinator is down or returns an error, the trigger is silently lost. A queue-based approach (insert into `analysis_queue`) would be more reliable.

---

## Target Architecture

The observation system is the foundation for the Digital Twin architecture described in the encyclopedia. The target state:

1. **Every data point is an observation.** No more direct writes to `vehicles` from extractors. All data flows through `ingest-observation`, which becomes the sole write path.

2. **Materialized vehicle profiles.** The `vehicles` table becomes a materialized view computed from the sum of all observations, weighted by source trust and recency.

3. **Contradiction detection.** When two observations disagree on the same field (e.g., different VINs from different sources), the system flags the conflict and computes which source to trust based on the hierarchy.

4. **Temporal decay.** Observations have half-lives based on their category. A mileage reading from 5 years ago is less trustworthy than one from last month. The materialized profile reflects this.

5. **Full provenance.** Every field in the vehicle profile traces back to specific observations with specific sources. "Where did this sale price come from?" is always a single query.
