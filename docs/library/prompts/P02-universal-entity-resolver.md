# P02: Universal Entity Resolver

## Context
Read these before executing:
- `docs/library/technical/engineering-manual/03-entity-resolution.md` — current matching logic and its problems
- `docs/library/technical/schematics/data-flow.md` — where matching happens in the pipeline
- `docs/library/intellectual/theoreticals/entity-resolution-theory.md` — the formal theory and threshold derivation
- `docs/library/reference/encyclopedia/README.md` Section 18 — target spec

## Problem
Every extractor implements its own vehicle matching. `extract-bat-core`, `ingest-observation`, and `haiku-extraction-worker` each have different matching logic. The fuzzy Y/M/M match at 60% confidence auto-merges wrong vehicles. Data corruption compounds silently.

Per the entity resolution theory paper: the cost of a false positive (wrong merge) is 20-50x the cost of a false negative (creating a duplicate). The auto-match threshold must be 0.80, not 0.60.

## Scope
One new shared function in `supabase/functions/_shared/`. Then update callers.

## Steps

1. Read the current matching implementations. Find ALL places vehicle matching happens:
```bash
# These files contain vehicle matching logic — read each one
grep -rl "fuzzy\|vehicle.*match\|ILIKE.*make\|vin.*match" supabase/functions/ --include="*.ts"
```

Also specifically read:
- `supabase/functions/ingest-observation/index.ts` (vehicle resolution section)
- `supabase/functions/extract-bat-core/index.ts` (findOrCreateVehicle or similar)
- `supabase/functions/haiku-extraction-worker/index.ts` (matching section)

2. Create `supabase/functions/_shared/resolveEntity.ts`:

```typescript
/**
 * Universal Entity Resolver
 *
 * Single source of truth for matching observations to existing entities.
 * All extractors must use this instead of implementing their own matching.
 *
 * Resolution priority:
 * 1. Unique ID (VIN for vehicles) → 0.99 confidence
 * 2. Source URL exact match → 0.95 confidence
 * 3. URL fuzzy match (ILIKE with normalized URL) → 0.90 confidence
 * 4. Metadata intersection (year + make + model + at least one more field) → 0.80+ confidence
 * 5. Below 0.80 → DO NOT AUTO-MATCH. Return as candidate.
 *
 * See: docs/library/intellectual/theoreticals/entity-resolution-theory.md
 */

export interface ResolutionHints {
  // Strong identifiers
  vin?: string;
  source_url?: string;

  // Medium identifiers
  year?: number;
  make?: string;
  model?: string;
  trim?: string;

  // Supporting identifiers
  exterior_color?: string;
  mileage?: number;
  location?: string;

  // Domain routing
  asset_type: 'vehicle' | 'artwork';
}

export interface ResolutionResult {
  match_type: 'exact' | 'confident' | 'candidate' | 'new';
  entity_id: string | null;
  confidence: number;
  match_signals: {
    vin_match: boolean;
    url_exact_match: boolean;
    url_fuzzy_match: boolean;
    metadata_match: boolean;
    fields_matched: string[];
  };
  candidates?: Array<{
    entity_id: string;
    confidence: number;
    match_signals: object;
  }>;
}

export async function resolveEntity(
  supabase: any,
  hints: ResolutionHints
): Promise<ResolutionResult> {
  // Implementation follows the cascade in the theory paper
  // See entity-resolution-theory.md Section 3: The Resolution Pipeline
}
```

3. Implement the cascade:

**Pass 1: VIN match** (vehicles only)
```sql
SELECT id FROM vehicles WHERE vin = $1 AND length($1) >= 5 LIMIT 1;
```
If found → return `{ match_type: 'exact', confidence: 0.99 }`

**Pass 2: URL exact match**
```sql
SELECT DISTINCT vehicle_id FROM vehicle_events
WHERE source_url = $1 AND vehicle_id IS NOT NULL LIMIT 1;
```
Also check `vehicles.bat_auction_url`, `vehicles.listing_url`.
If found → return `{ match_type: 'exact', confidence: 0.95 }`

**Pass 3: URL fuzzy match**
Normalize the URL (strip protocol, www, trailing slash), then:
```sql
SELECT DISTINCT vehicle_id FROM vehicle_events
WHERE source_url ILIKE $1 AND vehicle_id IS NOT NULL LIMIT 1;
```
If found → return `{ match_type: 'confident', confidence: 0.90 }`

**Pass 4: Metadata intersection**
Only attempt if year AND make are provided:
```sql
SELECT id, year, make, model, trim, exterior_color
FROM vehicles
WHERE year = $1 AND make ILIKE $2;
```
Score each candidate:
- year match: +0.30
- make match (ILIKE): +0.20
- model match (ILIKE): +0.20
- trim match: +0.10
- color match: +0.10
- mileage within 10%: +0.05
- location match: +0.05

If exactly 1 candidate scores >= 0.80 → return `{ match_type: 'confident', confidence: score }`
If multiple candidates → return ALL as candidates, match_type: 'candidate'
If no candidates → return `{ match_type: 'new', confidence: 0.0 }`

**THE HARD RULE**: If the best score is below 0.80, NEVER set entity_id. Return candidates only. The 0.80 threshold is derived from the cost asymmetry analysis in entity-resolution-theory.md.

4. Update callers to use `resolveEntity`:
- `ingest-observation/index.ts` — replace inline vehicle resolution with `resolveEntity` call
- `extract-bat-core/index.ts` — replace findOrCreateVehicle with `resolveEntity` call
- `haiku-extraction-worker/index.ts` — replace matching logic with `resolveEntity` call
- Any other file found in step 1

5. Deploy all modified functions.

## Verify
```sql
-- After deploying, trigger a test extraction and check:
SELECT vehicle_match_confidence, vehicle_match_signals
FROM vehicle_observations
ORDER BY created_at DESC LIMIT 5;
-- No observation should have vehicle_id set with confidence < 0.80

-- Check for any recent wrong merges:
SELECT vo.id, vo.vehicle_id, vo.vehicle_match_confidence, vo.vehicle_match_signals
FROM vehicle_observations vo
WHERE vo.created_at > now() - interval '1 hour'
AND vo.vehicle_match_confidence < 0.80
AND vo.vehicle_id IS NOT NULL;
-- Should return 0 rows
```

## Anti-Patterns
- Do NOT delete the old matching code until the new resolver is deployed and verified. Comment it out with a reference to this prompt.
- Do NOT lower the 0.80 threshold. Read the theory paper for why.
- Do NOT add image matching yet. That's a future enhancement. Start with VIN/URL/metadata.
- Do NOT create a new edge function for this. It's a shared utility in `_shared/`.
- Do NOT match on make alone. Year AND make minimum for metadata pass.

## Library Contribution
After completing:
- Update `docs/library/technical/engineering-manual/03-entity-resolution.md` — document the new implementation
- Update `docs/library/technical/schematics/data-flow.md` — update the vehicle resolution section
- Add `resolveEntity` to `docs/library/reference/index/README.md`
