# P03: Enforce Single Write Path

## Context
Read these before executing:
- `docs/library/reference/encyclopedia/README.md` Section 17 — the observation mandate
- `docs/library/technical/engineering-manual/04-observation-system.md` — how ingest-observation works
- `docs/library/technical/engineering-manual/02-extraction.md` — how extractors currently write
- `docs/library/technical/schematics/observation-system.md` — the dual pipeline problem

## Problem
The observation system (`ingest-observation` → `vehicle_observations`) exists and works. But extractors bypass it. `extract-bat-core` writes directly to `auction_comments`, `vehicle_events`, `vehicle_images`. Two parallel data pipelines means no single source of truth, no unified audit trail, no consistent entity resolution.

## Scope
Modify existing extractors to route their writes through `ingest-observation`. Do NOT create new extractors. Do NOT create new tables.

## Prerequisites
- P00 complete (schema-code mismatch fixed)
- P01 complete (audit trail fields added to vehicle_observations)
- P02 complete (universal entity resolver deployed — extractors use resolveEntity)

## Steps

1. Identify ALL direct-write extractors. Read each and map what they write where:

```bash
# Find all functions that INSERT INTO legacy tables
grep -rl "INSERT INTO.*auction_comments\|INSERT INTO.*vehicle_events\|\.from('auction_comments')\|\.from('vehicle_events')" supabase/functions/ --include="*.ts"
```

Expected hits:
- `extract-bat-core` → writes to `auction_comments`, `vehicle_events`, `auction_events`
- `extract-auction-comments` → writes to `auction_comments`
- `extract-cars-and-bids-core` → writes to `vehicle_events`
- `haiku-extraction-worker` → may write to `vehicles` directly
- Others found by grep

2. For EACH extractor found, modify it to write through `ingest-observation` instead of direct INSERT.

**The pattern** (for each write):

BEFORE (direct write):
```typescript
await supabase.from('auction_comments').insert({
  vehicle_id: vehicleId,
  comment_text: comment.text,
  posted_at: comment.date,
  username: comment.author,
  // ...
});
```

AFTER (through observation system):
```typescript
await supabase.functions.invoke('ingest-observation', {
  body: {
    source_slug: 'bat',  // or appropriate source
    kind: 'comment',
    observed_at: comment.date,
    source_url: listingUrl,
    source_identifier: `comment-${comment.id || comment.index}`,
    content_text: comment.text,
    structured_data: {
      username: comment.author,
      // any other structured fields
    },
    vehicle_id: vehicleId,  // if already resolved
    vehicle_hints: vehicleId ? undefined : {
      year: extractedYear,
      make: extractedMake,
      url: listingUrl,
    },
    // NEW audit fields from P01:
    agent_tier: 'haiku',  // or whichever tier
    extraction_method: 'html_parse',  // or 'llm_extraction'
    raw_source_ref: listingUrl,
    extracted_by: 'extract-bat-core',  // the calling function name
  }
});
```

3. Map each legacy write to observation kind:

| Legacy Table | Legacy Fields | Observation Kind | Structured Data Fields |
|-------------|---------------|-----------------|----------------------|
| `auction_comments` | comment_text, username, posted_at | `comment` | { username, posted_at, sentiment, bid_amount } |
| `vehicle_events` | source_platform, source_url, event_type | `listing` | { platform, event_type, listing_title, comment_count } |
| `auction_events` | platform, auction_url, event_type | `auction` | { platform, auction_url, start_date, end_date } |
| Vehicle field updates | year, make, model, price, etc. | `metadata` | { field_name: value } or full extracted object |

4. Do NOT remove legacy table writes yet. For weeks 1-2 of migration, DUAL WRITE — write through ingest-observation AND keep the legacy INSERT. This prevents data loss if the observation path has issues.

Add a comment above each legacy write:
```typescript
// LEGACY: Remove after observation system verified (see P03, dual-write period)
await supabase.from('auction_comments').insert({...});
```

5. Deploy all modified functions:
```bash
cd /Users/skylar/nuke
# Deploy each modified function
supabase functions deploy extract-bat-core --no-verify-jwt
supabase functions deploy extract-auction-comments --no-verify-jwt
# ... etc for each modified function
```

6. After 2 weeks of dual-write with no issues, create a follow-up prompt to remove the legacy writes. NOT in this prompt's scope.

## Verify
```sql
-- After deploying, trigger an extraction and check both paths received data:

-- New path:
SELECT kind, count(*) FROM vehicle_observations
WHERE created_at > now() - interval '1 hour'
GROUP BY kind;
-- Should show comment, listing, and/or metadata kinds

-- Audit trail populated:
SELECT agent_tier, extraction_method, extracted_by, count(*)
FROM vehicle_observations
WHERE created_at > now() - interval '1 hour'
AND agent_tier IS NOT NULL
GROUP BY agent_tier, extraction_method, extracted_by;
-- Should show data — NOT all nulls

-- Legacy path still receiving (dual-write):
SELECT count(*) FROM auction_comments WHERE created_at > now() - interval '1 hour';
-- Should also show data (dual-write active)

-- Entity resolution using universal resolver:
SELECT vehicle_match_confidence, count(*)
FROM vehicle_observations
WHERE created_at > now() - interval '1 hour'
GROUP BY vehicle_match_confidence;
-- No rows with confidence < 0.80 should have vehicle_id set
```

## Anti-Patterns
- Do NOT remove legacy table writes in this prompt. Dual-write for safety. Removal is a separate prompt after verification period.
- Do NOT create new extractors. Modify existing ones.
- Do NOT create new tables. Write to existing `vehicle_observations`.
- Do NOT batch this. Modify one extractor at a time, deploy, verify, then move to the next.
- Do NOT change what data is extracted. Only change WHERE it's written. Same fields, new destination.
- Do NOT skip the audit trail fields. Every write must include agent_tier, extraction_method, raw_source_ref, extracted_by. That's the whole point of P01.

## Library Contribution
After completing:
- Update `docs/library/technical/engineering-manual/02-extraction.md` — document the new write pattern
- Update `docs/library/technical/schematics/observation-system.md` — update the "relationship to legacy tables" section
- Update `docs/library/reference/index/README.md` — note which extractors now use observation path
- Add a post-mortem in `docs/library/working/post-mortems/` if anything broke during migration
