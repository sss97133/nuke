## Purpose

This document is the index for the scraping / extraction “toolkit” in this repo. It is meant to stop drift by pointing you to the few canonical workflows, entrypoints, and tables that are actually supposed to be used.

## Start here (canonical)

- **Edge Function governance**: `docs/ops/EDGE_FUNCTION_GOVERNANCE.md`
- **BaT workflow (canonical)**: `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`
- **BaT allowlist (code)**: `supabase/functions/_shared/approved-extractors.ts`
- **Import routing (code)**: `supabase/functions/_shared/select-processor.ts`
- **Primary orchestrator**: `supabase/functions/pipeline-orchestrator/index.ts`
- **BaT queue worker**: `supabase/functions/process-bat-extraction-queue/index.ts`

## BaT (Bring a Trailer): canonical workflow and entrypoints

### The only approved extractors

- **Step 1 (core profile)**: `extract-premium-auction`
- **Step 2 (comments/bids)**: `extract-auction-comments`

Everything else in the repo that looks like a BaT extractor is either legacy, a one-off, or should be treated as deprecated unless it is explicitly listed in `supabase/functions/_shared/approved-extractors.ts`.

### Canonical “entrypoints” that trigger BaT extraction

- **Bulk import**: `supabase/functions/complete-bat-import/index.ts`
- **User URL drop**: `supabase/functions/process-url-drop/index.ts`
- **Import queue routing**: `supabase/functions/pipeline-orchestrator/index.ts` + `supabase/functions/_shared/select-processor.ts`
- **BaT extraction queue**: `supabase/functions/process-bat-extraction-queue/index.ts`
- **Live monitoring**: `supabase/functions/sync-active-auctions/index.ts` → `supabase/functions/sync-bat-listing/index.ts`
- **Comments restoration**: `supabase/functions/restore-bat-comments/index.ts`

### Important note about `process-bat-from-import-queue`

`select-processor.ts` may return `functionName: 'process-bat-from-import-queue'`. That is an internal routing label handled inside `pipeline-orchestrator` (there is no standalone Edge Function directory named `process-bat-from-import-queue`).

If you try to invoke `process-bat-from-import-queue` directly, it will fail because it is not a deployable function.

## Evidence-first: capture HTML once, dissect later

There is already an evidence system designed for exactly this:

### Tables

- **HTML snapshots**: `public.listing_page_snapshots`
- **Per-field health**: `public.listing_extraction_health`

Defined in:

- `supabase/migrations/20251216000008_bat_dom_map_health.sql`
- `supabase/migrations/20251216000010_bat_dom_health_field_breakdown.sql`

### Runner

- `supabase/functions/bat-dom-map-health-runner/index.ts`

This runner can:

- Fetch listing HTML (direct, with optional Firecrawl if `FIRECRAWL_API_KEY` exists)
- Store HTML evidence (deduped by `(platform, listing_url, html_sha256)`)
- Store extraction health payloads so you can see coverage without re-scraping

## Database tables used by the extraction/auction system (canonical)

### Auction and comments

- **Auction event identity**: `public.auction_events` uses `source` and `source_url` (not `platform` and `listing_url`).
- **Comments**: `public.auction_comments` contains both `sequence_number` and `content_hash` (dedupe/identity depends on indexes; confirm in production).

### Listings

- **Platform-agnostic**: `public.external_listings`
- **BaT-specific**: `public.bat_listings`

### Images

- **Images live in**: `public.vehicle_images` (not `vehicles.images`)

## Documents that are known to be out-of-date (treat as legacy until updated)

These documents contain useful context, but they do not match current codepaths or production behavior:

- `docs/systems/IMPORT_QUEUE_ROUTING.md`
  - Still references routing BaT to `import-bat-listing` (deprecated); actual routing is via `select-processor.ts` to the `pipeline-orchestrator` BaT branch.
- `docs/EDGE_FUNCTION_TIMEOUTS.md`
  - Mentions a 60s hard limit; observed runtime limits may differ. Verify against current Supabase behavior and logs.
- `docs/ops/EDGE_FUNCTION_CLEANUP_PLAN.md`
  - Lists `import-bat-listing` as a frontend-called keep; in current system `import-bat-listing` is deprecated (410) and should not be used.
- `docs/architecture/FUNCTION_RETIREMENT_PLAN.md`
  - Claims `process-bat-extraction-queue` calls `comprehensive-bat-extraction`; current code calls `extract-premium-auction` and `extract-auction-comments`.

## Migrations: current drift and “source of truth”

### Source of truth

Treat the production table `supabase_migrations.schema_migrations` as the canonical history of what is actually applied.

### Current drift (as of this audit)

- **Repo**: 523 SQL files under `supabase/migrations/`
- **Production applied**: 397 rows in `supabase_migrations.schema_migrations`

Implications:

- The repo contains migrations that are not applied in production.
- Production contains migration versions that do not exist as filenames in the repo (and some “same name, different version” cases).

Until this is reconciled, do not assume a migration filename in the repo matches what production ran.

