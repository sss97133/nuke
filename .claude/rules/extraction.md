---
paths:
  - "supabase/functions/*extract*/**"
  - "supabase/functions/*ingest*/**"
  - "supabase/functions/*import*/**"
  - "supabase/functions/*discovery*/**"
  - "supabase/functions/_shared/**"
---

# Extraction Rules

## Archive Fetch
- NEVER use raw `fetch()` for external URLs — use `archiveFetch()` from `_shared/archiveFetch.ts`
- Firecrawl calls: `archiveFetch({ useFirecrawl: true })`
- BaT URLs: `archiveFetch()` wraps batFetcher internally
- Exception: JSON API endpoints (not HTML pages)

> "Fetch once, extract forever."

## Schema Discovery
- NEVER pre-define schema before seeing actual data
- Discovery: sample 20-50 documents, enumerate ALL fields
- Aggregate: compile field catalog with frequencies
- Then design schema, then extract

## Single Write Path
- ALL data flows through `ingest-observation` with entity resolution
- NEVER bypass to write directly to `auction_comments`, `vehicle_events`, etc.
- Two parallel data pipelines = data fork = broken

## Entity Resolution
- Auto-match threshold = 0.80 minimum
- Below 0.80 = candidate only, never auto-match
- NEVER call `merge_into_primary` without AI verification (use `merge_proposals`)
- NEVER create new vehicle record if Tier 1/2 match exists

## Before Building
- Check `TOOLS.md` — does a tool already handle this intent?
- Check `pipeline_registry` — who owns this column?
- Check `supabase/functions/` — is there already an extractor?
