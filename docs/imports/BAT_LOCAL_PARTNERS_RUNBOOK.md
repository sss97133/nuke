### Runbook: BaT Local Partners (orgs + vehicles)

This is the **repeatable, safe-to-rerun** flow for importing:

- **All BaT Local Partners** into `public.businesses`
- **All their BaT listings** into `public.vehicles`, linked via `organization_vehicles`

Source: `https://bringatrailer.com/local-partners/`

## Prereqs

- Env:
  - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
  - Preferred for local reads/writes: `SUPABASE_SERVICE_ROLE_KEY` (or `VITE_SUPABASE_SERVICE_ROLE_KEY`)
  - If you don’t have service role locally, the pipeline still works by invoking Edge Functions with:
    - `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`)

## One-command flow (recommended)

From repo root:

```bash
npm run ingest:bat-local-partners -- --concurrency 1 --max-pages 10
```

This runs:
1) `index:bat-local-partners` (org upsert)
2) `enrich:bat-local-partners` (profile/brand enrichment)
3) `import:bat-local-partner-vehicles` (vehicle import + org linking)

## Production-safe staging

Start small:

```bash
npm run ingest:bat-local-partners -- --limit 50 --limit-partners 10 --listing-limit 25 --concurrency 1 --max-pages 5
```

Then scale up:

```bash
npm run ingest:bat-local-partners -- --concurrency 1 --max-pages 25
```

## Resuming

- **Resume enrichment** (by snapshot index):

```bash
npm run enrich:bat-local-partners -- --resume-from 200 --concurrency 3
```

- **Resume vehicle import** (by partner index):

```bash
npm run import:bat-local-partner-vehicles -- --resume-from-partner 200 --concurrency 1
```

## Idempotency guarantees

- **Org indexing** is keyed by `businesses.geographic_key` and only fills missing fields.
- **Vehicle import** is idempotent by URL:
  - `vehicles.bat_auction_url` (primary)
  - `vehicles.discovery_url` / `vehicles.listing_url` (fallbacks)
- **Org linking** happens when confident:
  - For this pipeline we set `forceDealerLink=true`, and we pass `organizationId` when available for deterministic linking.

## Rate limits / pacing guidance

BaT pages are sensitive to aggressive scraping.

- Keep `--concurrency 1` for the vehicle importer when doing a full run.
- Increase `--max-pages` gradually (e.g. 10 → 25 → 50).
- If you see repeated HTTP 429/403, reduce concurrency and increase pacing (the scripts already sleep between calls).

## Notes / troubleshooting

- If you don’t have service role locally, set `--index-via-edge` or rely on auto-detection:

```bash
npm run ingest:bat-local-partners -- --index-via-edge
```

- Vehicle importer default behavior is to **skip URLs already linked** to that org (`--no-skip-existing` to disable).

## “Give me meat now” (inventory)

If you already indexed partners but your orgs still look empty, run the inventory backfill:

```bash
npm run inventory:bat-local-partners -- --limit 100 --process-inventory-batches 20 --process-import-batches 100
```

This will:
- enqueue inventory sync for BaT partners
- scrape inventory pages via `process-inventory-sync-queue` (which calls `scrape-multi-source`)
- create/update vehicles + `dealer_inventory` via `process-import-queue`

## Favicons + primary images

Two important improvements:
- `scrape-multi-source` now writes `businesses.favicon_url` (not just `metadata.brand_assets.favicon_url`)
- `backfill-org-primary-images` also writes `businesses.favicon_url` when it discovers one

If you have existing half-baked orgs, re-running enrichment + then calling the backfill function will fill most missing media:

```bash
npm run enrich:bat-local-partners -- --concurrency 3
```

## Cloud-only (no laptop)

This repo supports **Supabase pg_cron** calling Edge Functions directly (so it runs even if your computer is asleep).

- **What to deploy**
  - Edge Functions:
    - `enqueue-bat-local-partner-inventory` (new)
    - `process-inventory-sync-queue`
    - `process-import-queue`
    - `backfill-org-primary-images`
    - `scrape-multi-source` (favicon persistence fix)
  - SQL migration:
    - `supabase/migrations/20251214000031_bat_local_partners_cloud_inventory_cron.sql`

- **Critical config**
  - Ensure your DB has a service key available to cron jobs via **either** setting name:
    - `app.settings.service_role_key`
    - `app.service_role_key`

The new cron migration uses `COALESCE()` across both keys so you don’t get silent auth failures.



