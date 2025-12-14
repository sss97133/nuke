# Index: L'Art de L'Automobile (example dealer site)

This repo already has the ingestion pipeline:
- Dealer/site discovery -> `import_queue`
- Import processor -> `supabase/functions/process-import-queue`
- Dealer inventory tracking -> `dealer_inventory`
- Canonical org table -> `businesses`

## What was added

- **Edge Function**: `supabase/functions/index-lartdelautomobile/index.ts`
  - Uses **Firecrawl** to discover the site’s **for-sale** and **sold** pages from the homepage nav.
  - Upserts the dealer into `businesses`.
  - Queues every vehicle detail URL into `import_queue` with:
    - `raw_data.organization_id` (business UUID)
    - `raw_data.inventory_extraction = true`
    - `raw_data.business_type = 'dealer'`
    - `raw_data.listing_status = 'in_stock' | 'sold'`

- **Script**: `scripts/index-lartdelautomobile.js`

## Running it

1) Ensure Supabase env vars are available (service role preferred), and Firecrawl is configured in Supabase:
- `FIRECRAWL_API_KEY` in Supabase Function secrets

2) Invoke the indexer:

```bash
node scripts/index-lartdelautomobile.js
```

Optional:

```bash
node scripts/index-lartdelautomobile.js https://www.lartdelautomobile.com/
```

3) Let the cron / queue processor run (or manually invoke `process-import-queue`) to materialize vehicles and images.


