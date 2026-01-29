# Scott Drake Mustang Parts Catalog Indexing

This repo can ingest supplier parts catalogs into the `catalog_parts` table.

For Scott Drake Mustang parts, we index from the website using:
- Supabase Edge Function: `scrape-scott-drake-catalog`
- Runner script: `scripts/scrape-scott-drake-mustang-catalog.js`

## What gets stored

Each product becomes a row in `catalog_parts` with:
- `manufacturer = 'Scott Drake'`
- `supplier_url` (direct product/category page URL)
- `price_current`, `product_image_url` (when available)
- `category`, `subcategory` (best-effort)
- `fits_models` (defaults to `["Mustang"]` if unknown)
- `year_start`, `year_end` (best-effort inference)
- `application_data` containing source metadata

## Prereqs

- The Supabase project must have `FIRECRAWL_API_KEY` set as an Edge Function secret (already required by other catalog scrapers).
- You need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your `.env` to run the script.

## Deploy the edge function

From the repo root:

```bash
supabase functions deploy scrape-scott-drake-catalog
```

## Run indexing

### Option 0: Index from a PDF (quick seeding)

If you have a supplier PDF (even an older catalog), you can extract parts directly into `catalog_parts` using the existing PDF pipeline.

Example:

```bash
node scripts/index-scott-drake-pdf.js \
  "https://performancev8.com/PDFs/ScottDrakeCatalog_mustang.pdf" \
  --batch-size 50
```

### Option A: Discover URLs from sitemap

```bash
node scripts/scrape-scott-drake-mustang-catalog.js \
  --base https://YOUR_SCOTT_DRAKE_DOMAIN_HERE \
  --sitemap \
  --limit 500 \
  --delay-ms 1500
```

### Option B: Provide a URL list file

Create a newline-delimited list of category/product URLs:

```text
# data/scott-drake-urls.txt
https://YOUR_SCOTT_DRAKE_DOMAIN_HERE/collections/interior
https://YOUR_SCOTT_DRAKE_DOMAIN_HERE/products/c5zz-xxxxxxx-a
```

Then run:

```bash
node scripts/scrape-scott-drake-mustang-catalog.js \
  --url-file data/scott-drake-urls.txt \
  --limit 500 \
  --delay-ms 1500
```

## Verify in DB

```sql
select count(*)
from catalog_parts
where manufacturer = 'Scott Drake';
```

And confirm the source row:

```sql
select *
from catalog_sources
where provider = 'Scott Drake';
```


