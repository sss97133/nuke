# Holley Site Indexing (Firecrawl)

Holley’s site is JS-heavy and inconsistent. This repo indexes it using Firecrawl-backed Edge Functions:

- `holley-discover-urls`: discovers URLs (tries Firecrawl map/crawl, falls back to sitemap parsing)
- `scrape-holley-product`: scrapes a Holley URL and upserts products into `catalog_parts`

## What gets stored

Products are stored in:
- `catalog_sources` with `provider = 'Holley'` and `base_url = 'https://www.holley.com'`
- `catalog_parts` with:
  - `part_number` from `mpn` / `sku` (best-effort)
  - `manufacturer` from brand (best-effort; use `--brand` hint to force, e.g. `Scott Drake`)
  - `supplier_url` set to the Holley page URL
  - `application_data` includes breadcrumbs and source URL for traceability

## Deploy the edge functions

```bash
supabase functions deploy holley-discover-urls
supabase functions deploy scrape-holley-product
```

## Run indexing (safe incremental)

### Small test

```bash
node scripts/index-holley-site-products.js --limit 50 --delay-ms 1200
```

### Target Scott Drake on Holley

Use a brand hint + include filter to focus discovery:

```bash
node scripts/index-holley-site-products.js \
  --brand "Scott Drake" \
  --include "scott|drake" \
  --limit 500 \
  --delay-ms 1200
```

### Resume behavior

The runner stores progress at:
- `tmp/holley-index-progress.json`

If the run is interrupted, re-run the same command and it will skip URLs already marked done.

## Verify

```sql
select count(*) from catalog_parts where manufacturer ilike '%Scott Drake%';
```

```sql
select count(*) from catalog_parts
where catalog_id in (select id from catalog_sources where provider = 'Holley');
```



