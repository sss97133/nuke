## Partial retry (selective retry) — current approach

**Status**: ACTIVE  
**Last Verified**: 2026-01-10  

Partial retry means: **re-run only the failed step** (images, comments, sale outcome) without restarting the whole ingestion flow.

## Why this matters

- **Speed**: avoid re-scraping / re-parsing everything when only one piece failed.
- **Cost**: reuse captured HTML when possible.
- **Reliability**: retries become deterministic and idempotent.

## Current primitives in this repo

### 1) Evidence-first HTML snapshots (preferred)

If we have the HTML, we should not need to keep re-fetching the same listing.

- **Tables**: `listing_page_snapshots`, `listing_extraction_health`
- **Runner**: `supabase/functions/bat-dom-map-health-runner/index.ts`

This lets us store HTML + a content hash, then re-run extractors “at home” and track per-field coverage.

### 2) BaT selective retries (production workflow)

For BaT, the only approved extractors are:

1. `extract-premium-auction` (core data + images + auction_events/external_listings)
2. `extract-auction-comments` (comments + bids; may be best-effort depending on fetch mode)

Batch processing / retries:

- **Queue worker**: `process-bat-extraction-queue`
- **Comments restoration batch**: `restore-bat-comments`

### 3) Images: external URLs first, download later (optional but useful)

If you want “capture now, process later” for images:

- Store external URLs in `vehicle_images` (see `docs/EXTERNAL_URLS_THEN_DOWNLOAD.md`)
- Use backfill/trickle tooling to download/replace later

## What NOT to do

- Do not base the retry strategy on deprecated BaT entrypoints (e.g. `import-bat-listing`).
- Do not rely on “one giant orchestrator” to do everything; use queues and per-step retries.

## Archived legacy doc

The older version of this document (based on deprecated BaT orchestration) lives here:

`docs/archive/extraction-legacy/PARTIAL_SCRAPE_RETRY.md`

