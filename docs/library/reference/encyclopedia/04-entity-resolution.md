# Chapter 4: Entity Resolution

Entity resolution is the process of discovering that multiple observations refer to the same physical vehicle. A 1970 Chevelle SS 396 might appear on BaT in 2019, on Mecum in 2021, and on a Chevelle forum in 2023 — three separate data streams about one chassis. Entity resolution unifies them.

This chapter documents the resolution workflow, the match tier system, the trust arbitration model, and the safety rules that prevent destructive merges.

---

## Core Principle: The Vehicle is the Entity

The platform does not store listings. It stores vehicles — physical objects that exist in the world. Listings, posts, photos, and comments are observations OF that vehicle. Entity resolution is the discipline of correctly attributing observations to the right physical entity.

Getting this wrong has severe consequences:
- **False positive** (incorrect merge): Two different vehicles are combined into one entity, contaminating both with the other's data. A 1970 SS 396 gets the mileage of a different 1970 SS 396.
- **False negative** (missed merge): The same vehicle lives as two separate entities, with its history fragmented. Neither entity has the full picture.

The system is deliberately conservative — it is far better to have two separate entities for the same vehicle than to incorrectly merge two different vehicles.

---

## The merge_proposals Table

Entity resolution proposals are tracked in `merge_proposals` (26 rows currently). Every proposed merge goes through this table before execution.

### Full Schema

```sql
CREATE TABLE merge_proposals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The two candidate entities
    vehicle_a_id        uuid NOT NULL,              -- FK to vehicles
    vehicle_b_id        uuid NOT NULL,              -- FK to vehicles

    -- Detection
    detection_source    text NOT NULL,              -- What process found this candidate pair
    match_tier          integer,                    -- Match confidence tier (1=highest)
    match_reason        text,                       -- Human-readable match explanation
    confidence          numeric,                    -- Overall match confidence (0-1)

    -- AI verification
    ai_decision         text NOT NULL,              -- AI's merge/no-merge decision
    ai_confidence       numeric,                    -- AI's confidence in the decision
    ai_reasoning        text,                       -- AI's full reasoning
    ai_verified         boolean DEFAULT false,      -- Has AI reviewed this proposal?

    -- Human verification
    human_verified      boolean DEFAULT false,      -- Has a human reviewed this proposal?
    reviewed_at         timestamptz,
    reviewed_by         text,

    -- Resolution
    preferred_primary   text,                       -- Which entity should survive ('a' or 'b')
    evidence            jsonb,                      -- Supporting evidence for the merge

    -- Status
    status              text DEFAULT 'pending',     -- 'pending', 'approved', 'executed'
    proposed_by         text DEFAULT 'system',      -- Who/what proposed this merge
    proposed_at         timestamptz DEFAULT now(),
    executed_at         timestamptz                 -- When the merge was carried out
);
```

### Status Lifecycle

```
pending  -->  approved  -->  executed
   |
   +--> rejected (implicit: not approved)
```

- **pending**: Candidate pair identified, awaiting review
- **approved**: AI and/or human confirmed the merge is correct
- **executed**: The merge has been carried out — one entity's `merged_into_vehicle_id` now points to the other

---

## Match Tier System

Entity resolution operates on a tier system where higher tiers represent higher-confidence matches:

### Tier 1: Exact VIN Match

The strongest possible signal. If two vehicle entities share the same 17-digit VIN, they are almost certainly the same physical vehicle.

```sql
-- Find Tier 1 candidates
SELECT a.id as vehicle_a, b.id as vehicle_b, a.vin
FROM vehicles a
JOIN vehicles b ON a.vin = b.vin AND a.id < b.id
WHERE a.vin IS NOT NULL
  AND length(a.vin) = 17
  AND a.status NOT IN ('merged', 'duplicate', 'rejected')
  AND b.status NOT IN ('merged', 'duplicate', 'rejected');
```

Confidence: 0.95+

Edge cases that prevent automatic merge even at Tier 1:
- VIN reuse (manufacturers occasionally reuse VINs across model years)
- Data entry errors (two different VINs, one is a typo)
- Kit cars or replicas using a donor VIN

### Tier 2: Partial VIN + Corroborating Signals

For pre-1981 vehicles with short chassis numbers, or when only a partial VIN is available:

Matching criteria:
- Short VIN match (6-16 characters) AND
- Year match AND
- Make match AND
- Model match (fuzzy)

Confidence: 0.70-0.90 depending on how many signals align

### Tier 3: Listing URL + Identity Match

When the same listing URL appears in multiple vehicle entities, OR when a unique listing identifier (BaT lot number, Mecum lot number) matches:

```sql
-- Find Tier 3 candidates via URL
SELECT a.id, b.id, a.bat_auction_url
FROM vehicles a
JOIN vehicles b ON a.bat_auction_url = b.bat_auction_url AND a.id < b.id
WHERE a.bat_auction_url IS NOT NULL
  AND a.status NOT IN ('merged', 'duplicate', 'rejected')
  AND b.status NOT IN ('merged', 'duplicate', 'rejected');
```

Confidence: 0.80-0.95 (URLs are strong signals, but the same URL might have been re-listed)

### Tier 4: Fuzzy Identity Match

When no VIN or URL match exists, but the identity fields strongly suggest the same vehicle:

Matching criteria:
- Year exact match AND
- Make exact match AND
- Model fuzzy match AND
- At least one of: same color, same mileage range, same location, same seller

Confidence: 0.40-0.70 (requires AI verification)

This tier is where most false positives occur. Two red 1969 Mustang Mach 1s in California are not necessarily the same car. AI verification is mandatory at this tier.

### Tier 5: Photo-Based Match

Visual similarity detected by the vision pipeline — same car appearing in photos from different sources. Not yet implemented at scale, but the infrastructure exists:
- `visual_signature` JSONB column on `vehicles` stores computed image embeddings
- Photo comparison would operate as a discovery, creating merge proposals

Confidence: 0.30-0.60 (visual similarity is suggestive, not conclusive)

---

## Resolution Workflow

### Step 1: Candidate Detection

Candidates are detected by:

1. **Batch deduplication scripts** — `scripts/generate-merge-proposals.mjs` and `scripts/merge-vin-duplicates.mjs` scan the vehicles table for potential duplicates
2. **Ingest-time checking** — when `ingest-observation` processes a new observation, it checks if the observation matches an existing entity
3. **The `dedup-vehicles` edge function** — on-demand deduplication
4. **The `build-identity-graph` edge function** — constructs a graph of entity relationships

### Step 2: Proposal Creation

When a candidate pair is found, a row is inserted into `merge_proposals`:

```sql
INSERT INTO merge_proposals (
    vehicle_a_id, vehicle_b_id,
    detection_source, match_tier, match_reason, confidence,
    ai_decision, ai_confidence, ai_reasoning,
    evidence
) VALUES (
    $1, $2,
    'vin_match_scan',        -- detection source
    1,                       -- tier
    'Exact 17-digit VIN match: WVWZZZ3CZWE123456',
    0.97,
    'merge',                 -- AI decision
    0.95,
    'Both entities share VIN WVWZZZ3CZWE123456. Year, make, and model are consistent. Vehicle A has 45 observations from BaT, Vehicle B has 12 from Mecum. Recommend merging B into A (more observations).',
    '{"vin_match": "exact", "year_match": true, "make_match": true}'::jsonb
);
```

### Step 3: AI Verification

For Tier 2+ matches, AI verification is mandatory. The AI reviewer:
1. Examines both vehicle entities (all columns)
2. Compares observation histories
3. Checks for contradictions (different colors, wildly different mileages, different locations at the same time)
4. Produces a decision (`merge` or `no_merge`) with reasoning

The AI decision is stored in:
- `ai_decision` — the verdict
- `ai_confidence` — how confident the AI is (0-1)
- `ai_reasoning` — full natural language explanation
- `ai_verified` — set to `true` after AI review

### Step 4: Merge Execution

When a proposal is approved (status = `'approved'`):

1. **Select the primary entity** — the entity with more observations, higher data quality, or longer history becomes the survivor
2. **Reparent observations** — all `vehicle_observations` pointing to the secondary entity are updated to point to the primary
3. **Reparent timeline events** — all `timeline_events` for the secondary entity are moved to the primary
4. **Reparent images** — all `vehicle_images` for the secondary entity are moved to the primary
5. **Mark the secondary** — `vehicles.status` is set to `'merged'` and `vehicles.merged_into_vehicle_id` is set to the primary's ID
6. **Update the proposal** — `merge_proposals.status` is set to `'executed'` and `executed_at` is timestamped

The secondary entity is NEVER deleted. It remains in the database with `status = 'merged'`, serving as a redirect. Any future observation that matches the secondary's identifiers can follow `merged_into_vehicle_id` to find the correct primary.

---

## Trust Arbitration During Merge

When two entities are merged, their fields may conflict. The trust arbitration rules:

### Rule 1: Higher Confidence Wins

If Vehicle A has `vin_confidence = 90` (from `vin_decode`) and Vehicle B has `vin_confidence = 60` (from `web_scrape`), Vehicle A's VIN is kept.

### Rule 2: Source Trust Hierarchy

```
vin_decode > bat_listing > auction_result > user_input > ai_extraction > web_scrape > inferred
```

A field from a higher-trust source always wins over a lower-trust source, regardless of recency.

### Rule 3: Newer Overwrites Same-Trust

When two conflicting values come from sources of equal trust, the more recent value wins. This handles cases like mileage (which legitimately changes over time).

### Rule 4: Never Overwrite Non-Null with Null

If Vehicle A has a value and Vehicle B has NULL for the same field, Vehicle A's value is always preserved, regardless of trust levels.

### Rule 5: Accumulate, Don't Replace (for arrays and JSONB)

For array columns (`quality_issues`, `signal_reasons`, `parts_mentioned`) and JSONB columns (`metadata`, `provenance_metadata`), values are merged rather than overwritten. Both entities' data is combined.

---

## Safety Rules

These rules are enforced at the code level and documented in `docs/architecture/ENTITY_RESOLUTION_RULES.md`:

### Never Call merge_into_primary Without Verification

The `merge_into_primary` function (in `scripts/merge-vin-duplicates.mjs`) executes the actual merge. It must NEVER be called directly without:
1. A row in `merge_proposals` with `status = 'approved'`
2. AI verification (`ai_verified = true`) for any match below Tier 1
3. Evidence JSONB populated with the match signals

### Never Create a New Vehicle If a Match Exists

When `ingest-observation` processes a new observation:
1. First, check for Tier 1 matches (exact VIN)
2. Then, check for Tier 2-3 matches (partial VIN, URL, lot number)
3. Only if NO match is found, create a new vehicle entity

Creating a new entity when a match exists fragments the vehicle's history.

### Never Overwrite Higher-Trust with Lower-Trust

This is enforced during merge execution. The trust comparison is:
```sql
CASE
    WHEN existing_confidence > incoming_confidence THEN 'keep_existing'
    WHEN incoming_confidence > existing_confidence THEN 'use_incoming'
    WHEN incoming_observed_at > existing_observed_at THEN 'use_incoming'  -- tiebreak: recency
    ELSE 'keep_existing'
END
```

### Never Delete the Secondary Entity

Merged entities are marked `status = 'merged'` with `merged_into_vehicle_id` set. They are never physically deleted because:
- External URLs may still reference the old entity ID
- Future observations matching the old identifiers need a redirect path
- The merge can be audited and potentially reversed

### Log Everything

Every merge operation is logged in `merge_proposals` with full evidence. The `ai_reasoning` field preserves the AI's analysis. The `evidence` JSONB stores the specific signals that drove the match.

---

## The Deduplication Pipeline

### Batch Processing

The batch deduplication pipeline runs periodically:

1. **VIN Scan** (`scripts/merge-vin-duplicates.mjs`):
   - Scans for vehicles sharing the same VIN
   - Groups by VIN, identifies duplicates
   - Creates Tier 1 merge proposals
   - Auto-approves exact 17-digit VIN matches

2. **Fuzzy Scan** (`scripts/generate-merge-proposals.mjs`):
   - Scans for vehicles matching on year + make + model + other signals
   - Creates Tier 2-4 merge proposals
   - Requires AI verification before approval

3. **URL Dedup** (`dedup-vehicles` edge function):
   - Scans for vehicles sharing listing URLs
   - Creates Tier 3 merge proposals

### Real-Time Detection

During observation ingest, `ingest-observation` performs lightweight entity resolution:
1. Extract identity signals from the incoming observation (VIN, year, make, model, URL)
2. Query `vehicles` for potential matches
3. If a high-confidence match is found, link the observation to the existing entity
4. If a low-confidence match is found, create a merge proposal for review
5. If no match is found, create a new vehicle entity

---

## Metrics and Monitoring

### Current State (as of 2026-03-29)

| Metric | Value | Source |
|--------|-------|--------|
| Total vehicles | ~1,029,000 | `pg_stat_user_tables` |
| Total vehicle observations | ~5,701,000 | `pg_stat_user_tables` |
| Observation sources registered | 160 | `observation_sources` count |
| Merge proposals (AI-inspected) | 26 | `merge_proposals` count |
| — pending | 9 | `merge_proposals WHERE status='pending'` |
| — approved | 1 | `merge_proposals WHERE status='approved'` |
| — executed | 16 | `merge_proposals WHERE status='executed'` |
| — AI decision: MERGE | 17 | `merge_proposals WHERE ai_decision='MERGE'` |
| — AI decision: SKIP | 5 | `merge_proposals WHERE ai_decision='SKIP'` |
| — AI decision: REVIEW | 4 | `merge_proposals WHERE ai_decision='REVIEW'` |
| Dedup merges (URL-based, via `merge_into_primary`) | ~1,480 | `vehicle_merge_proposals WHERE status='merged'` |
| — by exact listing URL | 1,480 | `vehicle_merge_proposals WHERE match_type='exact_listing_url'` |
| — by fuzzy Y/M/M | 8 | `vehicle_merge_proposals WHERE match_type='year_make_model_fuzzy'` |
| Chassis observations | 0 | Table created, not yet populated |

Two merge tracking tables exist: `merge_proposals` (26 rows, AI-inspected proposals from `generate-merge-proposals.mjs`) and `vehicle_merge_proposals` (~1,500 rows, logged by `merge_into_primary()` during batch dedup). The former is the deliberate review pipeline; the latter is the audit trail from automated URL-based dedup.

### Quality Checks

```sql
-- Find potential duplicates not yet proposed
SELECT a.id, b.id, a.vin, a.year, a.make, a.model
FROM vehicles a
JOIN vehicles b ON a.vin = b.vin AND a.id < b.id
WHERE a.vin IS NOT NULL
  AND length(a.vin) >= 6
  AND a.status NOT IN ('merged', 'duplicate', 'rejected')
  AND b.status NOT IN ('merged', 'duplicate', 'rejected')
  AND NOT EXISTS (
      SELECT 1 FROM merge_proposals mp
      WHERE (mp.vehicle_a_id = a.id AND mp.vehicle_b_id = b.id)
         OR (mp.vehicle_a_id = b.id AND mp.vehicle_b_id = a.id)
  )
LIMIT 100;
```

```sql
-- Audit merge chain integrity
-- Every merged vehicle should have a valid merged_into_vehicle_id
SELECT id, merged_into_vehicle_id
FROM vehicles
WHERE status = 'merged'
  AND (merged_into_vehicle_id IS NULL
       OR merged_into_vehicle_id NOT IN (SELECT id FROM vehicles));
```

---

## Edge Functions

| Function | Role |
|----------|------|
| `dedup-vehicles` | On-demand deduplication scan |
| `build-identity-graph` | Constructs entity relationship graph |
| `discover-entity-graph` | Discovers entity relationships from observations |
| `ingest-observation` | Real-time entity resolution during ingest |

## Scripts

| Script | Role |
|--------|------|
| `scripts/merge-vin-duplicates.mjs` | Batch VIN-based deduplication |
| `scripts/generate-merge-proposals.mjs` | Batch fuzzy deduplication |
| `scripts/data-quality-cleanup.mjs` | Data quality cleanup including dedup |
| `scripts/data-quality-cleanup-phase4.mjs` | Phase 4 cleanup with dedup |

---

## The Word "Merge" Means "Link"

A critical conceptual note: in the Nuke platform, "merging" two vehicles does NOT mean combining their data into a blended entity. It means discovering that two database records represent the same physical vehicle, and linking all observations from the secondary to the primary.

The primary entity keeps its own field values (subject to trust arbitration). The secondary entity becomes a redirect. No data is blended, averaged, or interpolated. The observations from both entities are preserved in full — they simply now all point to the same `vehicle_id`.

This is entity resolution in the knowledge-graph sense: resolving two nodes to one, while preserving all edges (observations) intact.

---

## The Philosophical Foundation: Testimony, Not Records

The canonical rules document (`docs/architecture/ENTITY_RESOLUTION_RULES.md`) establishes the epistemological framework that governs entity resolution:

> The vehicle is the entity. Everything else is testimony.

A URL does not create a vehicle. A vehicle exists in the physical world. A URL is a digital record that testifies to its existence at a point in time, through a specific entity, with a specific level of trustworthiness. A "merge" is not combining two profiles. A merge is discovering that multiple testimonies refer to the same physical chassis and linking them to a single canonical entity.

### What Entity Resolution Actually Means

Entity resolution answers ONE question: do these observations refer to the same physical vehicle?

It does NOT:
- Pick a "winner" between two records
- Overwrite data from one record with another
- Delete or hide any testimony
- Decide which data point is "more correct"

It DOES:
- Assign a canonical `vehicle_id` to observations that refer to the same chassis
- Preserve every observation's provenance (who said what, when, how trustworthy)
- Enable the vehicle's current state to be computed from all linked observations

### Properties of Observations

1. **Observations are immutable.** A BaT listing from 2021 said what it said. We do not update it. If the car sells again in 2024, that is a NEW observation.

2. **Observations have half-lives.** A mileage reading from 2021 is less reliable about 2024 state than a reading from last week. Different claim types decay at different rates (VIN never decays; mileage decays fast; color decays slow).

3. **Observations conflict.** Two listings may report different mileage. This is not an error to resolve — it is a signal. The vehicle's "current mileage" is computed from the most recent, highest-trust observation.

4. **Observations carry images as temporal evidence.** Photos from a 2021 listing show the car's condition as of 2021. Photos from a 2024 listing show it as of 2024. Both are true. Neither supersedes the other.

---

## The Real-Time Resolution Cascade (ingest-observation)

When a new observation arrives through `ingest-observation` (the single entry point for all vehicle data), entity resolution runs as a multi-pass cascade. The function is at `supabase/functions/ingest-observation/index.ts`.

### Input: Vehicle Hints

Every observation can carry `vehicle_hints` — signals the extractor gathered about which vehicle this observation describes:

```typescript
// From ingest-observation/index.ts
interface ObservationInput {
  source_slug: string;
  kind: string;
  observed_at: string;
  vehicle_id?: string;          // If already known
  vehicle_hints?: {
    vin?: string;               // VIN or chassis number
    plate?: string;             // License plate (future)
    year?: number;
    make?: string;
    model?: string;
    url?: string;               // Source listing URL
  };
  // ... content fields
}
```

If `vehicle_id` is already provided by the extractor, the cascade is skipped entirely and the observation is linked directly. Otherwise, the hints drive a four-pass cascade:

### Pass 1: VIN Match (confidence 0.99)

The highest-confidence match. VINs are normalized through `normalizeVin()` before comparison, which strips whitespace, converts to uppercase, and rejects known placeholder values and fake identifiers.

```typescript
// From ingest-observation/index.ts lines 149-163
if (hints.vin) {
  const cleanVin = normalizeVin(hints.vin);
  if (cleanVin) {
    const { data: vinMatch } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", cleanVin)
      .maybeSingle();

    if (vinMatch) {
      vehicleId = vinMatch.id;
      vehicleMatchConfidence = 0.99;
      vehicleMatchSignals = { vin_match: true, normalized_vin: cleanVin };
    }
  }
}
```

The `normalizeVin()` function (`supabase/functions/_shared/urlNormalization.ts`) applies several rejection filters:

- Rejects known placeholder values: "UNKNOWN", "STRING", "N/A", "TBD", "PENDING", etc.
- Rejects single-character repetition: "AAAAAAAAAAAAAAAA"
- Rejects Bonhams engine/lot number patterns: `N` followed by digits and `ENG` suffix
- Rejects too-short values (< 6 characters)
- Returns `null` for any rejected VIN, preventing the match cascade from proceeding on bad data

### Pass 2: URL Match via Canonical Listing ID (confidence 0.90-0.95)

When no VIN match is found but the observation carries a URL, the system attempts to match via canonical listing identifiers. This is the most sophisticated pass, using `normalizeListingUrl()` to extract platform-specific stable identifiers.

```typescript
// From ingest-observation/index.ts lines 167-233
if (!vehicleId && hints.url) {
  const normUrl = normalizeListingUrl(hints.url);

  // Try canonical listing ID match against vehicles.listing_url and discovery_url
  if (normUrl?.canonicalListingId) {
    const listingIdPart = normUrl.canonicalListingId.split(":")[1];
    const { data: urlMatches } = await supabase
      .from("vehicles")
      .select("id, listing_url, discovery_url")
      .or(`listing_url.ilike.%${listingIdPart}%,discovery_url.ilike.%${listingIdPart}%`)
      .not("status", "in", "(merged,deleted)")
      .limit(5);

    if (urlMatches?.length === 1) {
      vehicleId = urlMatches[0].id;
      vehicleMatchConfidence = 0.95;
      vehicleMatchSignals = { normalized_url_match: true, canonical_id: normUrl.canonicalListingId };
    }
    // Multiple matches: attempt exact canonical ID comparison
    // Falls through if ambiguous
  }

  // Fallback: exact URL match in vehicle_events
  if (!vehicleId) {
    const { data: urlMatch } = await supabase
      .from("vehicle_events")
      .select("vehicle_id")
      .eq("source_url", hints.url)
      .not("vehicle_id", "is", null)
      .maybeSingle();

    if (urlMatch?.vehicle_id) {
      vehicleId = urlMatch.vehicle_id;
      vehicleMatchConfidence = 0.95;
      vehicleMatchSignals = { exact_url_match: true };
    }
  }

  // Fallback: normalized URL match in vehicle_events
  if (!vehicleId && normUrl?.normalized && normUrl.normalized !== hints.url) {
    // Try the cleaned version of the URL
    vehicleMatchConfidence = 0.90;
    vehicleMatchSignals = { normalized_event_url_match: true };
  }
}
```

This three-layer URL matching handles progressively looser comparisons:
1. Canonical listing ID extracted from the URL (strongest)
2. Exact URL match against `vehicle_events.source_url`
3. Normalized URL match (strips query params, www prefix, trailing slashes)

### Pass 3: Fuzzy Year/Make Match (confidence 0.60)

The weakest automated pass. Only assigns a match if exactly one candidate exists:

```typescript
// From ingest-observation/index.ts lines 237-258
if (!vehicleId && hints.year && hints.make) {
  const { data: fuzzyMatches } = await supabase
    .from("vehicles")
    .select("id")
    .eq("year", hints.year)
    .ilike("make", `%${hints.make}%`)
    .limit(5);

  if (fuzzyMatches?.length === 1) {
    vehicleId = fuzzyMatches[0].id;
    vehicleMatchConfidence = 0.60;
    vehicleMatchSignals = { fuzzy_match: true, year: hints.year, make: hints.make };
  } else if (fuzzyMatches?.length > 1) {
    // Multiple candidates -- leave unresolved for manual review
    vehicleMatchSignals = {
      multiple_candidates: true,
      count: fuzzyMatches.length,
      hints
    };
  }
}
```

When multiple candidates exist (there are 22 identical 1967 Corvettes at similar price points), the observation is stored with `vehicle_id = NULL` and the ambiguity is recorded in `vehicle_match_signals`. The observation is never lost — it can be linked later when more evidence arrives.

### Pass 4: No Match — Create New Entity or Store Unresolved

If all three passes fail, the observation is inserted without a `vehicle_id`. The `vehicle_match_signals` JSONB captures what was attempted. Future batch processes can attempt to resolve these orphaned observations.

### Confidence Scoring

After resolution, the system computes a composite confidence score for the observation itself:

```typescript
// From ingest-observation/index.ts lines 261-276
const confidenceScore = Math.min(1.0,
  (source.base_trust_score || 0.5) +
  Object.values(confidenceFactors).reduce((a, b) => a + b, 0)
);

let confidenceLevel = "medium";
if (confidenceScore >= 0.95) confidenceLevel = "verified";
else if (confidenceScore >= 0.85) confidenceLevel = "high";
else if (confidenceScore < 0.4) confidenceLevel = "low";
```

The `base_trust_score` comes from the `observation_sources` table (160 registered sources), which ranges from 0.10 (oldcars-com) to 1.00 (imessage, iphoto — first-party owner data). The vehicle match confidence is a separate field (`vehicle_match_confidence`) stored alongside the observation.

---

## URL Normalization: The First Line of Defense

The `urlNormalization.ts` module (`supabase/functions/_shared/urlNormalization.ts`) is the critical preprocessing layer that prevents URL-variant duplicates from creating false entities.

### The Problem It Solves

The same vehicle listing can appear under multiple URL variants:

- `https://www.jamesedition.com/cars/koenigsegg/regera/for-sale-14855981` (clean)
- `https://jamesedition.com/cars/koenigsegg/regera/for-sale-14855981 "2019 Koenigsegg Regera"` (title-appended)
- `https://www.jamesedition.com/cars/koenigsegg/regera/for-sale-14855981/` (trailing slash)
- `https://jamesedition.com/cars/koenigsegg/regera/for-sale-14855981?ref=search` (query params)

Without normalization, each variant creates a separate vehicle record. The URL normalization module extracts the stable identifier (`jamesedition:14855981`) that all variants share.

### Supported Platforms

The module contains platform-specific extractors for 12 auction and listing platforms:

| Platform | Canonical ID Format | Example |
|----------|-------------------|---------|
| JamesEdition | `jamesedition:{numeric_id}` | `jamesedition:14855981` |
| RM Sotheby's | `rmsothebys:{lot_slug}` | `rmsothebys:r0001-1967-chevrolet-corvette` |
| Bring a Trailer | `bat:{listing_slug}` | `bat:1967-porsche-911s-43` |
| Cars & Bids | `carsandbids:{slug}` | `carsandbids:1990-porsche-964` |
| Barrett-Jackson | `barrett-jackson:{path}` | `barrett-jackson:Events/Event/Details/...` |
| Mecum | `mecum:{path}` | `mecum:lots/FL0125-473741/...` |
| Gooding & Co | `gooding:{path}` | `gooding:lot/1967-ferrari-275...` |
| Bonhams | `bonhams:{path}` | `bonhams:auction/28186/lot/1` |
| Broad Arrow | `broadarrow:{path}` | `broadarrow:lots/...` |
| Collecting Cars | `collectingcars:{path}` | `collectingcars:cars/...` |
| Hagerty Marketplace | `hagerty:{path}` | `hagerty:1972-bmw-2002tii` |
| Hemmings | `hemmings:{path}` | `hemmings:dealer/12345` |
| eBay Motors | `ebay:{item_id}` | `ebay:325988123456` |

For unrecognized platforms, the module applies generic noise stripping (remove query params, fragments, trailing slashes, www prefix, normalize to https) and returns `canonicalListingId: null`.

### The stripUrlNoise Function

All URLs pass through a noise-stripping pipeline before comparison:

```typescript
// From urlNormalization.ts
function stripUrlNoise(raw: string): string {
  // 1. Strip appended title text: `url "Title"` or `url 'Title'`
  let cleaned = raw.replace(/\s+["'][^"']*["']?\s*$/, "");
  // 2. Strip anything after a space
  cleaned = cleaned.split(/\s+/)[0];
  // 3. Parse as URL, strip hash and search params, normalize host
  const u = new URL(cleaned);
  u.hash = "";
  u.search = "";
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = (u.pathname || "").replace(/\/+$/, "");
  return `https://${host}${path}`;
}
```

### The urlsMatchSameListing Helper

A convenience function for direct comparison of two URLs:

```typescript
export function urlsMatchSameListing(urlA: string, urlB: string): boolean {
  const normA = normalizeListingUrl(urlA);
  const normB = normalizeListingUrl(urlB);
  if (!normA || !normB) return false;
  // If both have canonical listing IDs, compare those
  if (normA.canonicalListingId && normB.canonicalListingId) {
    return normA.canonicalListingId === normB.canonicalListingId;
  }
  // Fall back to normalized URL comparison
  return normA.normalized === normB.normalized;
}
```

---

## VIN Validation: Rejecting Fake Identifiers

Not every string in a VIN field is actually a VIN. The system encounters several categories of false VINs that must be rejected before they can trigger false Tier 1 matches.

### Categories of False VINs

**Bonhams engine/lot numbers.** Bonhams catalogs use engine numbers or internal lot numbers in VIN fields. These follow patterns like `N12345ENGNEN` or `N88765SEETEXTE`. The `isFakeVin()` function in `scripts/merge-vin-duplicates.mjs` detects these:

```javascript
// From merge-vin-duplicates.mjs
function isFakeVin(vin) {
  if (/^N\d+.*ENG/i.test(vin)) return true;
  if (/^N\d+.*SEE/i.test(vin)) return true;
  if (/^(.)\1+$/.test(vin)) return true;  // Single char repeated
  if (vin.length < 6) return true;
  return false;
}
```

**Placeholder values.** Extractors sometimes produce placeholder strings when no VIN is found: "unknown", "string", "number", "null", "n/a", "none", "tbd", "pending", "SOLDNOBS". The `normalizeVin()` function maintains a set of 14 known placeholders.

**Pre-1981 chassis numbers.** Before the 1981 VIN standardization, manufacturers used chassis numbers, engine numbers, body numbers, and serial numbers of varying length and format. A 1965 Ferrari might have chassis number "06437" — which is a valid identifier for entity resolution within make+era, but not globally unique. The `chassis_observations` table (described below) handles these.

### Make Compatibility in VIN Matching

Even when VINs match exactly, the year and make must be compatible. The `merge-vin-duplicates.mjs` script enforces this with a make aliasing system:

```javascript
// From merge-vin-duplicates.mjs
function makesCompatible(makeA, makeB) {
  if (!makeA || !makeB) return true;  // null = compatible
  const aliases = {
    'shelby': ['ford', 'shelby'],
    'ford': ['ford', 'shelby', 'factoryfive'],
    'factoryfive': ['ford', 'shelby', 'factoryfive'],
    'datsun': ['datsun', 'nissan'],
    'nissan': ['datsun', 'nissan'],
    'cav': ['ford', 'cav'],
    'kirkham': ['shelby', 'kirkham'],
  };
  const aliasA = aliases[normalizeMake(a)] || [normalizeMake(a)];
  const aliasB = aliases[normalizeMake(b)] || [normalizeMake(b)];
  return aliasA.some(x => aliasB.includes(x));
}
```

This handles real-world ambiguity: a Shelby Cobra might be listed under "Ford", "Shelby", "Factory Five" (replica), "CAV" (replica), or "Kirkham" (aluminum body). The aliases define which make names can co-exist on the same VIN without indicating a data error.

---

## The merge_into_primary SQL Function

The actual merge operation is a PostgreSQL function defined in migration `20260227040642_merge_duplicate_vehicles.sql`. It is the only code path that executes merges.

### Full Implementation

```sql
-- From supabase/migrations/20260227040642_merge_duplicate_vehicles.sql
CREATE OR REPLACE FUNCTION merge_into_primary(primary_id UUID, dup_id UUID)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_images_moved INT := 0;
  v_comments_moved INT := 0;
  v_observations_moved INT := 0;
  v_events_moved INT := 0;
  v_bat_deleted INT := 0;
  v_comment_disc_deleted INT := 0;
  v_desc_disc_deleted INT := 0;
  v_obs_disc_moved INT := 0;
BEGIN
  -- Guard: skip if same ID or already merged
  IF primary_id = dup_id THEN
    RETURN jsonb_build_object('skipped', 'same_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = primary_id
                 AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'primary_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = dup_id
                 AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'dup_already_merged');
  END IF;

  -- 1. vehicle_images: re-point
  UPDATE vehicle_images SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_images_moved = ROW_COUNT;

  -- 2. vehicle_observations: de-duplicate then re-point
  DELETE FROM vehicle_observations vo_dup
  WHERE vo_dup.vehicle_id = dup_id
    AND EXISTS (
      SELECT 1 FROM vehicle_observations vo_pri
      WHERE vo_pri.vehicle_id = primary_id
        AND vo_pri.source_id = vo_dup.source_id
        AND vo_pri.source_identifier = vo_dup.source_identifier
        AND vo_pri.kind = vo_dup.kind
    );
  UPDATE vehicle_observations SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_observations_moved = ROW_COUNT;

  -- 3. auction_events: re-point
  UPDATE auction_events SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_events_moved = ROW_COUNT;

  -- 4. auction_comments: de-duplicate by content_hash, then re-point
  DELETE FROM auction_comments ac_dup
  WHERE ac_dup.vehicle_id = dup_id
    AND ac_dup.content_hash IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auction_comments ac_pri
      WHERE ac_pri.vehicle_id = primary_id
        AND ac_pri.content_hash = ac_dup.content_hash
    );
  UPDATE auction_comments SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_comments_moved = ROW_COUNT;

  -- 5. bat_listings: unique on bat_listing_url — delete dup's row
  DELETE FROM bat_listings WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_bat_deleted = ROW_COUNT;

  -- 6-7. Discovery tables: unique on vehicle_id — delete dup's rows
  DELETE FROM comment_discoveries WHERE vehicle_id = dup_id;
  DELETE FROM description_discoveries WHERE vehicle_id = dup_id;

  -- 8. observation_discoveries: re-point
  UPDATE observation_discoveries SET vehicle_id = primary_id WHERE vehicle_id = dup_id;

  -- 9. Soft-delete the duplicate
  UPDATE vehicles
  SET merged_into_vehicle_id = primary_id,
      status = 'merged',
      deleted_at = NOW()
  WHERE id = dup_id;

  -- 10. Log the merge in vehicle_merge_proposals
  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id, duplicate_vehicle_id,
    match_type, confidence_score, status, detected_by, detected_at
  ) VALUES (
    primary_id, dup_id,
    'exact_listing_url', 100, 'merged', 'dedup-worker', NOW()
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'images_moved', v_images_moved,
    'comments_moved', v_comments_moved,
    'observations_moved', v_observations_moved,
    'events_moved', v_events_moved,
    'bat_deleted', v_bat_deleted
  );
END;
$$;
```

### Key Design Decisions in merge_into_primary

1. **Collision handling for observations.** When both vehicles have the same observation (same `source_id`, `source_identifier`, and `kind`), the duplicate's copy is deleted BEFORE re-pointing. This prevents unique constraint violations during the UPDATE.

2. **Collision handling for comments.** Same pattern — comments with identical `content_hash` on both vehicles have the duplicate's copy removed first.

3. **bat_listings deletion.** The `bat_listings` table has a unique constraint on `bat_listing_url`. Since both vehicles share the same URL (that is how the duplicate was detected), the duplicate's row must be deleted — it cannot be re-pointed.

4. **Discovery table handling.** Tables with unique constraints on `vehicle_id` (`comment_discoveries`, `description_discoveries`) have the duplicate's rows deleted. Tables without such constraints (`observation_discoveries`) have rows re-pointed.

5. **Audit logging.** Every merge is logged in `vehicle_merge_proposals` with `ON CONFLICT DO NOTHING` to handle idempotent re-runs.

6. **Guard clauses.** Three checks prevent bad merges: same-ID check, primary-exists check, and duplicate-not-already-merged check. The function returns a JSONB object with `skipped` and the reason if any guard fails.

---

## The Batch Deduplication System (dedup-vehicles)

The `dedup-vehicles` edge function (`supabase/functions/dedup-vehicles/index.ts`) handles bulk deduplication. It operates in two modes:

### Exact Mode (Default)

Groups vehicles by identical `listing_url` and merges duplicates:

```sql
-- From dedup-vehicles/index.ts
SELECT
  listing_url,
  COUNT(*) AS total_count,
  array_agg(id ORDER BY created_at ASC, id ASC) AS ordered_ids
FROM vehicles
WHERE listing_url IS NOT NULL
  AND listing_url != ''
  AND (status IS DISTINCT FROM 'merged')
  AND merged_into_vehicle_id IS NULL
GROUP BY listing_url
HAVING COUNT(*) > 1
LIMIT ${batchSize}
```

The oldest vehicle (by `created_at`) becomes the primary. This is a deliberate choice: the first record likely has the most complete extraction and the longest observation history.

### Normalized Mode

Handles URL-variant duplicates that exact matching misses. Fetches all non-merged vehicles with listing URLs, then groups them by canonical listing ID in application code:

```typescript
// From dedup-vehicles/index.ts — normalized mode
const groups = new Map<string, Array<{id, listing_url, created_at}>>();
for (const row of rows) {
  const norm = normalizeListingUrl(row.listing_url);
  if (!norm?.canonicalListingId) continue;
  const key = norm.canonicalListingId;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(row);
}
```

This catches cases like JamesEdition URLs with and without appended titles, which share the same `jamesedition:14855981` canonical ID but have different raw URL strings.

### Safety Controls

Both modes implement several safety mechanisms:

| Control | Default | Max | Purpose |
|---------|---------|-----|---------|
| `batch_size` | 100 | 1,000 | Max URL groups per invocation |
| `max_merges` | 500 | 5,000 | Max individual merge operations |
| `dry_run` | false | — | Preview mode: reports what would merge |

The function uses a direct Postgres connection (not PostgREST) with `SET statement_timeout = 0` to handle long-running merge batches. This bypasses the default 8-second PostgREST timeout.

### Historical Impact

As of 2026-03-29, the URL-based dedup pipeline has executed ~1,480 merges, all via exact listing URL match. These are logged in `vehicle_merge_proposals` with `match_type='exact_listing_url'`.

---

## AI-Verified Merge Proposals (generate-merge-proposals.mjs)

For cases where automated matching is insufficient, `scripts/generate-merge-proposals.mjs` implements a full AI verification pipeline using local LLM inference.

### Evidence Gathering

For each candidate pair, the script compiles comprehensive evidence:

```javascript
// From generate-merge-proposals.mjs
async function gatherEvidence(pool, idA, idB) {
  // Full vehicle records with child counts
  const vehicleQ = await pool.query(`
    SELECT id, year, make, model, vin, sale_price, listing_url, source,
           description, trim, engine_type, transmission, color, mileage,
           (SELECT count(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
           (SELECT count(*) FROM vehicle_observations WHERE vehicle_id = v.id) as observation_count,
           (SELECT count(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count
    FROM vehicles v
    WHERE id IN ($1::uuid, $2::uuid)
  `, [idA, idB]);

  // Shared images by perceptual hash
  const sharedImages = await pool.query(`
    SELECT a.dhash, a.id as img_a, b.id as img_b
    FROM vehicle_images a
    JOIN vehicle_images b ON a.dhash = b.dhash AND a.dhash IS NOT NULL
    WHERE a.vehicle_id = $1 AND b.vehicle_id = $2
    LIMIT 10
  `, [idA, idB]);

  return {
    vehicleA: vA, vehicleB: vB,
    sharedImageHashes: sharedImages.rows.length,
    signals: {
      sameVin: vA.vin && vB.vin && vA.vin === vB.vin,
      sameYear: vA.year && vB.year && vA.year === vB.year,
      sameMake: ..., samePrice: ..., sameUrl: ...,
      hasSharedImages: sharedImages.rows.length > 0,
    }
  };
}
```

### AI Verification

The evidence is sent to a local Ollama instance (qwen2.5:7b) with a structured prompt that includes:
- Full field comparison of both records
- Matching signals summary
- Domain-specific guidance (Bonhams fake VINs, replica vs original, make aliases)

The LLM returns a JSON decision:

```json
{
  "decision": "MERGE",
  "confidence": 0.95,
  "reasoning": "Both share VIN 1GCEK14L9EJ147915 and consistent year/make/model.",
  "preferred_primary": "A"
}
```

### Decision Distribution (Current Data)

Of the 26 AI-inspected proposals in `merge_proposals`:
- **17 MERGE** — AI confirmed same physical vehicle
- **5 SKIP** — AI determined different vehicles despite signal overlap
- **4 REVIEW** — AI flagged as ambiguous, needs human judgment

All 26 were detected via VIN matching. The ~19% rejection rate (SKIP + REVIEW) demonstrates the value of AI verification even for VIN matches — fake VINs, typos, and kit cars produce real VIN collisions that automated matching cannot distinguish.

### Execution

Approved proposals are executed via `--execute-approved`:

```javascript
// From generate-merge-proposals.mjs
const approved = await pool.query(`
  SELECT * FROM merge_proposals
  WHERE status = 'approved' AND ai_decision = 'MERGE'
  ORDER BY ai_confidence DESC
`);

for (const p of approved.rows) {
  const primaryId = p.preferred_primary === 'B' ? p.vehicle_b_id : p.vehicle_a_id;
  const dupId = p.preferred_primary === 'B' ? p.vehicle_a_id : p.vehicle_b_id;
  await pool.query('SELECT merge_into_primary($1::uuid, $2::uuid)', [primaryId, dupId]);
  await pool.query("UPDATE merge_proposals SET status = 'executed', executed_at = now() WHERE id = $1", [p.id]);
}
```

---

## Chassis Observations: Pre-1981 Entity Resolution

Pre-1981 vehicles lack standardized 17-character VINs. They use chassis numbers, engine numbers, body numbers, serial numbers, and frame numbers — identifiers that are unique within make+era but not globally. The `chassis_observations` table (migration `20260324100000`) provides dedicated infrastructure for this.

### Schema

```sql
-- From 20260324100000_entity_resolution_chassis_observations.sql
CREATE TABLE chassis_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id),
  chassis_number text NOT NULL,
  chassis_number_normalized text NOT NULL,
  number_type text NOT NULL DEFAULT 'chassis'
    CHECK (number_type IN ('chassis', 'engine', 'body', 'serial', 'frame', 'unknown')),
  source_platform text NOT NULL,
  source_url text,
  source_event_id text,
  observed_year int,
  observed_make text,
  observed_model text,
  observed_at timestamptz,
  transcription_confidence numeric DEFAULT 1.0
    CHECK (transcription_confidence BETWEEN 0 AND 1),
  extracted_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now()
);
```

### The ConceptCarz Problem

This table was created to solve a specific data quality issue: the ConceptCarz dataset contains ~35,000 vehicles representing the same physical cars appearing at multiple concours events with no VIN but with chassis numbers. A 1955 Mercedes-Benz 300SL Gullwing with chassis number 198.040.5500130 might appear at Amelia Island 2018, Pebble Beach 2019, and Goodwood 2021. Without chassis-based entity resolution, each appearance creates a separate vehicle record.

### Indexes

```sql
-- Normalized chassis number for fast matching
CREATE INDEX idx_chassis_obs_normalized ON chassis_observations(chassis_number_normalized);
-- Vehicle linkage
CREATE INDEX idx_chassis_obs_vehicle ON chassis_observations(vehicle_id);
-- Make+year for cross-referencing
CREATE INDEX idx_chassis_obs_make_year ON chassis_observations(observed_make, observed_year);
-- Uniqueness: same number + platform + event = one observation
CREATE UNIQUE INDEX idx_chassis_obs_unique
  ON chassis_observations(chassis_number_normalized, source_platform, COALESCE(source_event_id, ''));
```

### Current Status

The table exists but has 0 rows as of 2026-03-29. Population requires extracting chassis numbers from ConceptCarz and other concours-focused sources, which is a planned Phase 2 activity.

---

## The Evidence Hierarchy (Canonical Reference)

The canonical evidence hierarchy is defined in `docs/architecture/ENTITY_RESOLUTION_RULES.md`. This is the authoritative reference — code implementations must follow these confidence ranges.

### Tier 1: Definitive Identity (confidence >= 0.95)

| Signal | Confidence | Notes |
|--------|------------|-------|
| VIN match (17-char, post-1981) | 0.99 | Globally unique. Can still have OCR/typo errors. |
| Chassis number match (pre-1981) | 0.95 | Not globally unique but unique within make+era. |
| Same source URL, same platform | 0.99 | Same listing = same vehicle, always. |

### Tier 2: Strong Evidence (confidence 0.80-0.94)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Normalized URL (same listing ID, different URL format) | 0.95 | JamesEdition listing 14855981 = same car regardless of URL suffix. |
| VIN partial + year + make match | 0.90 | Last 8 of VIN + year + make is very strong. |
| Body/engine/chassis number + year + make | 0.85 | Bonhams uses engine numbers — valid if make+year agree. |
| Perceptual image match (dHash <= 3) + year + make | 0.85 | Same hero photo in two listings of same year+make. |

### Tier 3: Circumstantial Evidence (confidence 0.50-0.79)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Year + make + model + sale_price match | 0.60 | Could be coincidence at scale. |
| Image similarity (dHash 4-8) + year match | 0.60 | Similar but not identical photos. |
| Year + make + color + mileage within 1% | 0.70 | Strong if all four match, but mileage changes. |
| GPS location match + year + make | 0.65 | Same car photographed in same location. |

### Tier 4: Weak / Contextual (confidence < 0.50)

| Signal | Confidence | Notes |
|--------|------------|-------|
| Year + make only | 0.30 | Too many candidates at scale. |
| Facebook page reposting auction images | 0.40 | Derived source — confirms existence, not identity. |
| Forum discussion referencing a listing | 0.50 | Attribution is imprecise. |

### Confidence Does NOT Mean "Merge Automatically"

High confidence means we believe the observations reference the same physical vehicle. The ACTION threshold depends on the operation:

- **Linking an observation** to a vehicle: confidence >= 0.60 is acceptable (we can un-link later)
- **Soft-merging two vehicle records** (re-pointing children): confidence >= 0.85, ideally with AI verification
- **Hard-deleting a duplicate**: NEVER automated. Only after human review.

---

## The Source Trust Hierarchy

Entity resolution interacts with the trust scoring system through the `observation_sources` table. Each source has a `base_trust_score` that affects how its observations are weighted during conflict resolution.

### Sample Trust Scores (from observation_sources)

| Source | Trust Score | Category |
|--------|------------|----------|
| imessage | 1.00 | First-party owner communication |
| iphoto | 1.00 | First-party owner photos |
| ferrari-classiche | 0.98 | Manufacturer certification |
| porsche-certificate | 0.98 | Manufacturer certification |
| galen-govier | 0.98 | Authoritative registry |
| nmvtis | 0.95 | Government database |
| desktop_archive | 0.95 | First-party files |
| bat (Bring a Trailer) | ~0.85 | Major auction platform |
| craigslist | 0.40 | Unverified classifieds |
| facebook-vehicle-pages | 0.30 | Social media, derived content |
| tiktok | 0.25 | Social media, lowest signal |
| oldcars-com | 0.10 | Known poor data quality |

When entity resolution links observations from multiple sources to the same vehicle, the trust score determines which source's claims take precedence during state computation. A Ferrari Classiche certificate saying the chassis number is 12345 (trust 0.98) overrides a Craigslist listing saying it is 12346 (trust 0.40).

---

## The Observation Linking Process (Target Architecture)

The canonical rules document defines the target architecture where the word "merge" is replaced by "resolve" and "link":

### Step 1: Extract Claims
Parse the source into structured claims: year, make, model, VIN, price, condition, photos, description, seller, location, date.

### Step 2: Resolve Entity
Run the evidence hierarchy against existing vehicles:
- Tier 1 match: link with high confidence, proceed
- Tier 2 match: link with moderate confidence, flag for verification
- Tier 3 match: create a candidate link (stored but not active until verified)
- No match: create a new vehicle entity

### Step 3: Ingest as Observations
Each claim becomes a `vehicle_observation` with full provenance.

### Step 4: Recompute Vehicle State
The vehicle's "current" fields are computed from observations:
- Most recent observation per field wins (if trust >= threshold)
- Conflicting observations flagged for review
- Temporal decay applied per field category

### Scenarios Under the Target Architecture

**Same listing ingested twice (exact URL duplicate).**
This should never create two vehicle records. The ingest pipeline should resolve the entity via URL match (Tier 1, 0.99) before creating a second record.

**Same car listed on BaT in 2021 and 2024.**
These are TWO SEPARATE OBSERVATIONS on the SAME ENTITY. Each listing contributes its own observation cluster (photos, price, comments, condition). The vehicle has a richer timeline, not a merged profile.

**Facebook page reposts BaT images with 1000 comments.**
The FB page is a derived source with low trust for vehicle specs (it is just copying) but HIGH value for engagement data. Ingest comments as observations with `source_type='social_media'`, `trust=0.30` for specs, `trust=0.80` for engagement/sentiment.

**Instagram post by the owner showing the car.**
Owner-sourced observation with `trust=0.85`. Photos provide current condition evidence. GPS data provides location evidence.

**Forum build thread documenting a restoration.**
Each post is an observation. Photos show condition changes over time. Technical details (engine swap, paint code, parts sourced) are high-value claims from a knowledgeable source.

---

## Rules for Automated Resolution (Canonical)

These rules are enforced at the code level per `docs/architecture/ENTITY_RESOLUTION_RULES.md`:

1. **NEVER create a new vehicle record if entity resolution finds a Tier 1 or Tier 2 match.** Link to the existing entity.

2. **ALWAYS preserve the source observation even if the entity link is uncertain.** An observation with `vehicle_id=NULL` is better than a lost observation.

3. **NEVER overwrite a field on the vehicles table from a lower-trust source.** If BaT says mileage is 45,000 (trust 0.90) and Facebook says 43,000 (trust 0.30), the BaT value stands.

4. **ALWAYS timestamp observations.** The same field from the same source at different times = two observations, both valid.

5. **Observations from derived sources inherit a trust penalty.** A Facebook page reposting BaT images gets `base_trust * 0.5` for vehicle specs but full trust for engagement data.

6. **AI verification is required for Tier 3 matches before linking.** Store as a candidate link in `merge_proposals` until verified.

7. **VINs are not always VINs.** Bonhams uses engine numbers. Pre-1981 chassis numbers are not globally unique. Validate VIN format before treating as definitive identity.

8. **Images are temporal evidence, not identity signals alone.** dHash matching is Tier 2 evidence only when combined with year+make agreement.

9. **The `merge_into_primary` function is a LAST RESORT.** New data should flow through `ingest-observation` with proper entity resolution. The goal is to never need merge again.

10. **False splits are acceptable. False merges are catastrophic.** When in doubt, create a candidate link and wait for more evidence.

---

## Implementation Phases

### Phase 1: Fix Ingestion (prevent new duplicates) — PARTIALLY COMPLETE

- URL normalization in entity resolution: **DONE** (`urlNormalization.ts`)
- VIN validation: **DONE** (`normalizeVin()`)
- All new data flows through `ingest-observation`: **IN PROGRESS** (extractors being retrofitted)

### Phase 2: Backfill Entity Links — PARTIALLY COMPLETE

- dHash across vehicle_images: **infrastructure exists** (dhash column populated)
- Generate merge proposals with AI verification: **DONE** (`generate-merge-proposals.mjs`, 26 proposals)
- Execute approved proposals: **DONE** (16 executed, 1 approved pending)
- Chassis number extraction from ConceptCarz: **NOT STARTED** (table ready, 0 rows)

### Phase 3: Expand Observation Sources — IN PROGRESS

- Facebook pages: **pipeline exists**, low trust
- Instagram: **planned**
- Forum threads: **planned**
- Owner input (iMessage, email): **sources registered**, intake scripts exist

### Phase 4: Computed Vehicle State — PLANNED

- Vehicle profile fields as materialized views over observations
- Provenance chain per field
- Conflict surfacing in UI

---

## Known Limitations

1. **Fuzzy matching is too aggressive with common vehicles.** A query for `year=1967, make ILIKE '%Porsche%'` returns dozens of 911s. The system correctly refuses to match when multiple candidates exist, but many observations remain unresolved.

2. **No model matching in the fuzzy pass.** The current implementation only matches year + make, not model. Adding model matching requires careful normalization ("911S" vs "911 S" vs "911/S").

3. **Cross-platform dedup without VIN is unsolved at scale.** A vehicle listed on BaT and then on eBay creates two records. Without VIN, no automated method exists to detect this — only image-based matching (Tier 2, not yet at scale) could bridge the gap.

4. **merge_into_primary may not cover all child tables.** The function handles 8 child tables. A comprehensive audit of all foreign keys referencing `vehicles.id` is needed to ensure no orphaned references remain after merges.

5. **No merge undo.** Once merged, reversing the child record re-pointing requires manual SQL. The soft-deleted duplicate preserves an audit trail but automated rollback does not exist.

6. **Chassis observations table is empty.** The infrastructure for pre-1981 entity resolution exists but has no data. ConceptCarz extraction has not yet populated the table.

7. **AI verification is local-only.** The `generate-merge-proposals.mjs` script uses local Ollama (qwen2.5:7b). This limits throughput and is not available in serverless environments. Moving to cloud LLM providers would enable higher-scale verification.

8. **URL normalization covers 12 platforms.** Listings from unsupported platforms fall back to generic noise stripping, which may miss platform-specific URL variants.

---

## Summary

Entity resolution is the integrity layer of the platform. Without it, the same vehicle fragments into multiple incomplete records. With it, the full body of evidence — from every auction house, every forum post, every service record — converges on a single entity.

The system operates at two timescales: real-time (during observation ingest, via the three-pass cascade in `ingest-observation`) and batch (via `dedup-vehicles` and `generate-merge-proposals.mjs`). The real-time system prevents new duplicates; the batch system cleans up historical ones.

The merge_proposals workflow ensures convergence happens safely: AI verification for ambiguous matches, trust arbitration for conflicting data, full auditability for every merge decision. The system is deliberately conservative: false splits are recoverable, false merges are catastrophic.

The target architecture replaces "merge" with "resolve" and "link." The vehicle is the physical entity. Everything else is testimony. Entity resolution discovers which testimonies belong to the same chassis. Nothing is ever lost — only linked.
