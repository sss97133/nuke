# VP Deal Flow → VP Extraction — 2026-02-26

## Problem
190 acquisition_pipeline entries at stage `market_proofed` have `asking_price = NULL`.
All score 40/FAIR as a result — pipeline is unusable until prices are populated.

## Root Cause
`discover-cl-muscle-cars` captures URLs but only gets prices from JSON-LD (~24% hit rate).
`process-cl-queue` should backfill prices but 174 entries are stuck — `processed_at = NULL`.

## What We Need
For each `acquisition_pipeline` row where:
- `asking_price IS NULL`
- `discovery_url LIKE 'https://%.craigslist.org%'`
- `stage IN ('discovered', 'market_proofed')`

Scrape the CL listing page and extract:
- `asking_price` (from page price field)
- `seller_contact` / phone if present
- Update `acquisition_pipeline.asking_price`

Then re-run `batch-market-proof` on those entries to get real scores.

## Relevant Functions
- `process-cl-queue` — already does this but queue is stalled
- `batch-market-proof` — re-score after prices populated
- Stage filter for batch-market-proof: pass `stage_filter: 'market_proofed'` to re-score already-processed entries with new prices

## Count
```sql
SELECT count(*) FROM acquisition_pipeline 
WHERE asking_price IS NULL 
AND discovery_url LIKE 'https://%.craigslist.org%';
-- Returns: ~174
```

## Priority
High. Pipeline scores are garbage without prices. 5 STRONG_BUY and 63 BUY deals identified
with prices — unknown how many more are hiding in the 190 unpriced entries.
