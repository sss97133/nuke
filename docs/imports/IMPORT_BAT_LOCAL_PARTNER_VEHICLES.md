### Import: BaT Local Partner Vehicles (link to orgs in `businesses`)

This repo can import **all BaT listing URLs for every BaT Local Partner** (from `https://bringatrailer.com/local-partners/`) and link each listing to the correct org profile in `public.businesses`.

## Prereqs

- Run the org indexer (creates/updates `businesses` rows, keyed by `geographic_key`):

```bash
npm run index:bat-local-partners -- --upsert
```

- Optional: enrich org profiles (brand assets, contact fields, etc):

```bash
npm run enrich:bat-local-partners -- --concurrency 3
```

## Run (dry-run)

```bash
npm run import:bat-local-partner-vehicles -- --dry-run --limit-partners 5
```

## Run (execute)

```bash
npm run import:bat-local-partner-vehicles -- --concurrency 1
```

## Useful flags

- `--limit-partners 25`: process only first N partners
- `--resume-from-partner 100`: resume by partner index (0-based after filtering)
- `--partner-key "<geographic_key>"`: run only one specific partner
- `--listing-limit 50`: cap listings per partner (useful for staged rollouts)
- `--max-pages 10`: cap pagination pages for BaT member pages (follows `rel="next"` / page-numbers)
- `--image-batch-size 25`: controls `import-bat-listing` image backfill batching
- `--no-json`: skip writing `data/bat/bat_local_partner_vehicle_import_summary.json`

## Output

When JSON output is enabled (default), the script writes:

- `data/bat/bat_local_partner_vehicle_import_summary.json`

This includes per-partner counts and overall import stats for resumability and auditing.


