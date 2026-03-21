# Chapter 3: Entity Resolution

## What This Subsystem Does

Entity resolution determines whether a newly extracted vehicle record refers to a vehicle already in the database or is genuinely new. The same physical vehicle can appear on multiple platforms (BaT, eBay, Craigslist, Facebook Marketplace), across multiple auctions (failed to sell, relisted), and with different spellings ("'67 Porsche 911S" vs. "1967 Porsche 911 S"). Entity resolution prevents duplicate vehicle records by matching incoming data against existing records using a cascade of matching strategies: exact URL match, VIN match, and fuzzy year/make/model match. When duplicates are found after the fact, the `dedup-vehicles` function merges them by consolidating all child records under a single primary vehicle.

---

## Key Tables and Functions

### Tables

| Table | Purpose |
|-------|---------|
| `vehicles` | The entity table. Each row is one physical vehicle. |
| `vehicle_events` | Links vehicles to source URLs. Used for URL-based matching. |
| `vehicle_images` | Child records migrated during merges. |
| `auction_comments` | Child records migrated during merges. |
| `vehicle_observations` | Child records migrated during merges. |

### Edge Functions and SQL Functions

| Function | Type | Purpose |
|----------|------|---------|
| `dedup-vehicles` | Edge Function | Finds and merges duplicates by listing_url. |
| `merge_into_primary()` | SQL Function | Re-points all child records from duplicate to primary, soft-deletes duplicate. |
| `ingest-observation` | Edge Function | Contains vehicle resolution logic for new observations. |

---

## Current Implementation: Three-Pass Matching

The system uses a three-pass matching cascade, implemented in `ingest-observation/index.ts`. Each pass has a different confidence level.

### Pass 1: VIN Match (Confidence 0.99)

VINs are the strongest identifier. A 17-character VIN uniquely identifies a vehicle globally (for post-1981 vehicles). Classic vehicles have shorter chassis numbers that are still highly unique within make/model.

```typescript
// From ingest-observation/index.ts
if (hints.vin) {
  const { data: vinMatch } = await supabase
    .from("vehicles")
    .select("id")
    .eq("vin", hints.vin)
    .maybeSingle();

  if (vinMatch) {
    vehicleId = vinMatch.id;
    vehicleMatchConfidence = 0.99;
    vehicleMatchSignals = { vin_match: true };
  }
}
```

**Why 0.99 and not 1.0:** VIN data entry errors exist. A single transposed character creates a false match. 0.99 reflects this residual uncertainty.

### Pass 2: URL Match (Confidence 0.95)

If the observation comes from a URL we have seen before (e.g., the same BaT listing), we match to the vehicle already linked to that URL via `vehicle_events`.

```typescript
if (!vehicleId && hints.url) {
  const { data: urlMatch } = await supabase
    .from("vehicle_events")
    .select("vehicle_id")
    .eq("source_url", hints.url)
    .not("vehicle_id", "is", null)
    .maybeSingle();

  if (urlMatch?.vehicle_id) {
    vehicleId = urlMatch.vehicle_id;
    vehicleMatchConfidence = 0.95;
    vehicleMatchSignals = { url_match: true };
  }
}
```

**Why 0.95:** URLs are unique to a listing, but a listing can sometimes cover multiple vehicles (e.g., "pair of matching 911s"). The URL match is strong but not as definitive as VIN.

### Pass 3: Fuzzy Year/Make/Model Match (Confidence 0.60)

When neither VIN nor URL produces a match, the system falls back to year + make fuzzy matching:

```typescript
if (!vehicleId && hints.year && hints.make) {
  const { data: fuzzyMatches } = await supabase
    .from("vehicles")
    .select("id")
    .eq("year", hints.year)
    .ilike("make", `%${hints.make}%`)
    .limit(5);

  if (fuzzyMatches?.length === 1) {
    // Unique match -- use it
    vehicleId = fuzzyMatches[0].id;
    vehicleMatchConfidence = 0.60;
    vehicleMatchSignals = { fuzzy_match: true, year: hints.year, make: hints.make };
  } else if (fuzzyMatches?.length > 1) {
    // Multiple candidates -- leave unresolved
    vehicleMatchSignals = {
      multiple_candidates: true,
      count: fuzzyMatches.length,
      hints
    };
  }
}
```

**Why 0.60:** A 1967 Porsche in the database might be a 911, a 912, or a 356. Year + make alone is weak. The system only assigns the match if there is exactly one candidate. Multiple candidates mean the observation is left unresolved for manual review.

---

## Deduplication: dedup-vehicles

After extraction, duplicate vehicle records inevitably exist. The `dedup-vehicles` edge function finds and merges them.

### How It Finds Duplicates

It groups vehicles by `listing_url`, looking for groups where the same URL is associated with more than one vehicle record:

```typescript
// From dedup-vehicles/index.ts
const dupGroups = await sql`
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
`;
```

### The Merge Process

For each duplicate group, the oldest vehicle (first by `created_at`) is the primary. All newer duplicates are merged into it:

```typescript
for (const group of dupGroups) {
  const primaryId = group.ordered_ids[0];  // oldest = primary
  const dupIds = group.ordered_ids.slice(1);  // rest are duplicates

  for (const dupId of dupIds) {
    await sql`SELECT merge_into_primary(${primaryId}::uuid, ${dupId}::uuid)`;
    stats.total_duplicates_merged++;
  }
}
```

### merge_into_primary() SQL Function

This PostgreSQL function does the actual merge work:

1. **Re-point child records.** All `vehicle_images`, `auction_comments`, `vehicle_observations`, and `vehicle_events` that reference the duplicate's ID are updated to reference the primary's ID.
2. **Merge metadata.** If the duplicate has fields that the primary lacks (e.g., VIN, description), those fields are copied to the primary.
3. **Soft-delete the duplicate.** The duplicate's status is set to `'merged'` and `merged_into_vehicle_id` is set to the primary's ID.

```sql
-- Conceptual structure of merge_into_primary
CREATE OR REPLACE FUNCTION merge_into_primary(
  p_primary_id UUID,
  p_duplicate_id UUID
) RETURNS JSONB AS $$
DECLARE
  images_moved INT := 0;
  comments_moved INT := 0;
  observations_moved INT := 0;
  events_moved INT := 0;
BEGIN
  -- Re-point vehicle_images
  UPDATE vehicle_images SET vehicle_id = p_primary_id
  WHERE vehicle_id = p_duplicate_id;
  GET DIAGNOSTICS images_moved = ROW_COUNT;

  -- Re-point auction_comments
  UPDATE auction_comments SET vehicle_id = p_primary_id
  WHERE vehicle_id = p_duplicate_id;
  GET DIAGNOSTICS comments_moved = ROW_COUNT;

  -- Re-point vehicle_observations
  UPDATE vehicle_observations SET vehicle_id = p_primary_id
  WHERE vehicle_id = p_duplicate_id;
  GET DIAGNOSTICS observations_moved = ROW_COUNT;

  -- Re-point vehicle_events
  UPDATE vehicle_events SET vehicle_id = p_primary_id
  WHERE vehicle_id = p_duplicate_id;
  GET DIAGNOSTICS events_moved = ROW_COUNT;

  -- Soft-delete duplicate
  UPDATE vehicles SET
    status = 'merged',
    merged_into_vehicle_id = p_primary_id
  WHERE id = p_duplicate_id;

  RETURN jsonb_build_object(
    'images_moved', images_moved,
    'comments_moved', comments_moved,
    'observations_moved', observations_moved,
    'events_moved', events_moved
  );
END;
$$ LANGUAGE plpgsql;
```

### Direct Postgres Connection

The dedup function uses a direct Postgres connection (not PostgREST) because it needs to bypass the statement timeout for long-running merge batches:

```typescript
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const sql = postgres(dbUrl, { max: 1, idle_timeout: 600, connect_timeout: 30 });
await sql`SET statement_timeout = 0`;
```

### Safety Features

- **Dry run mode.** `{ dry_run: true }` reports what would be merged without making changes.
- **Batch limits.** `batch_size` limits the number of URL groups processed (default 100). `max_merges` caps total merge operations (default 500).
- **Merge limit break.** Processing stops when `max_merges` is reached, preventing runaway operations.

```typescript
const batchSize = Math.min(body.batch_size ?? 100, 1000);
const maxMergesPerCall = Math.min(body.max_merges ?? 500, 5000);
```

---

## How to Build Entity Resolution from Scratch

### Step 1: Add matching fields to vehicles

```sql
-- Ensure vehicles table has the key matching fields
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS listing_url TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS merged_into_vehicle_id UUID REFERENCES vehicles(id);

-- Index for VIN matching
CREATE INDEX idx_vehicles_vin ON vehicles (vin) WHERE vin IS NOT NULL;

-- Index for URL-based dedup
CREATE INDEX idx_vehicles_listing_url ON vehicles (listing_url)
  WHERE listing_url IS NOT NULL AND listing_url != '';

-- Status for merged vehicles
ALTER TABLE vehicles ADD CONSTRAINT chk_vehicles_status
  CHECK (status IN ('active','pending','sold','discovered','merged','rejected',
                     'inactive','archived','deleted','pending_backfill','duplicate'));
```

### Step 2: Add matching via vehicle_events

```sql
-- vehicle_events links vehicles to source URLs
CREATE INDEX idx_vehicle_events_source_url ON vehicle_events (source_url)
  WHERE source_url IS NOT NULL;
```

### Step 3: Implement the three-pass resolution

In any extractor or observation ingestion function, implement the cascade:

```typescript
async function resolveVehicle(hints: {
  vin?: string;
  url?: string;
  year?: number;
  make?: string;
  model?: string;
}): Promise<{ vehicleId: string | null; confidence: number; signals: any }> {

  // Pass 1: VIN
  if (hints.vin) {
    const match = await supabase.from("vehicles")
      .select("id").eq("vin", hints.vin).maybeSingle();
    if (match?.data) return { vehicleId: match.data.id, confidence: 0.99, signals: { vin_match: true } };
  }

  // Pass 2: URL
  if (hints.url) {
    const match = await supabase.from("vehicle_events")
      .select("vehicle_id").eq("source_url", hints.url)
      .not("vehicle_id", "is", null).maybeSingle();
    if (match?.data?.vehicle_id) return { vehicleId: match.data.vehicle_id, confidence: 0.95, signals: { url_match: true } };
  }

  // Pass 3: Fuzzy Y/M/M
  if (hints.year && hints.make) {
    const matches = await supabase.from("vehicles")
      .select("id").eq("year", hints.year)
      .ilike("make", `%${hints.make}%`).limit(5);
    if (matches?.data?.length === 1) {
      return { vehicleId: matches.data[0].id, confidence: 0.60, signals: { fuzzy_match: true } };
    }
  }

  return { vehicleId: null, confidence: 0, signals: {} };
}
```

### Step 4: Create the merge function

Create `merge_into_primary()` as shown above. The function must:
1. Re-point ALL child table foreign keys
2. Copy missing fields from duplicate to primary
3. Soft-delete the duplicate (never hard-delete -- data provenance matters)

### Step 5: Deploy the dedup worker

Deploy `dedup-vehicles` as an edge function. Run it periodically (daily or on-demand) to clean up duplicates.

---

## Known Problems

1. **Fuzzy matching is too aggressive with common vehicles.** A query for `year=1967, make ILIKE '%Porsche%'` returns dozens of 911s. The system correctly refuses to match when multiple candidates exist, but this means many observations remain unresolved.

2. **No model matching in the fuzzy pass.** The current implementation only matches year + make, not model. Adding model matching would reduce false negatives but requires careful normalization (is "911S" the same model as "911 S"?).

3. **URL-based dedup only catches exact URL duplicates.** The same vehicle listed at `bringatrailer.com/listing/1967-porsche-911s/` and `bringatrailer.com/listing/1967-porsche-911s-43/` (re-listed with a number suffix) will not be caught.

4. **No cross-platform dedup.** A vehicle listed on BaT and then on eBay creates two vehicle records. Without VIN, there is no automated way to detect this.

5. **merge_into_primary does not handle all child tables.** There may be child tables beyond `vehicle_images`, `auction_comments`, `vehicle_observations`, and `vehicle_events` that reference `vehicles.id`. A comprehensive audit of all foreign keys is needed.

6. **No dedup undo.** Once merged, there is no automated way to un-merge. The duplicate is soft-deleted with `merged_into_vehicle_id` set, which provides an audit trail, but reversing the child record re-pointing requires manual intervention.

---

## Target Architecture

The target is a universal entity matcher with a composite confidence score and a 0.80 threshold. The design:

### Multi-Signal Matching

Instead of a simple cascade, compute a composite score from all available signals:

| Signal | Weight | Example |
|--------|--------|---------|
| VIN exact match | 0.50 | VIN "1GCEK14L9EJ147915" matches |
| URL exact match | 0.30 | Same listing URL |
| Year exact match | 0.10 | Same year |
| Make fuzzy match | 0.05 | "Chevrolet" vs "Chevy" |
| Model fuzzy match | 0.05 | "K10" vs "C10 K10" |
| Color match | 0.02 | Same exterior color |
| Location match | 0.03 | Same seller city |
| Image similarity | 0.10 | Perceptual hash match |
| Title similarity | 0.05 | Levenshtein distance < 5 |

Sum the weighted signals. If the composite score exceeds 0.80, treat as a match. Between 0.60 and 0.80, flag for human review. Below 0.60, create a new record.

### Cross-Platform Resolution

Add a `vehicle_fingerprint` column that combines normalized year/make/model/color/location into a searchable hash. This enables fast cross-platform matching even without VIN.

### Automated Re-Resolution

When a vehicle's VIN is later discovered (e.g., from a document OCR), automatically re-run resolution against all unresolved observations. This can retroactively link orphaned observations to the correct vehicle.
