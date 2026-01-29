## Scrape / Index / Ingest Toolbox (Backend)

### The golden rule (keeps data clean weeks later)
- **Discovery and extraction can be messy. Normalization must be deterministic.**
- That means: push URLs + raw hints into `import_queue` and let `process-import-queue` be the canonical writer for:
  - `vehicles`
  - `vehicle_images`
  - `organization_vehicles`
  - `dealer_inventory`

### Core Edge Functions
- **`discover-classic-sellers`**
  - **Purpose**: Paginate `classic.com/data` and upsert seller profile URLs into `classic_seller_queue`.
  - **Output**: `classic_seller_queue(profile_url, seller_type, seller_name)`

- **`process-classic-seller-queue`**
  - **Purpose**: Batch index Classic seller profiles using `index-classic-com-dealer`.
  - **Output**:
    - creates/merges `businesses` rows (org profiles)
    - enqueues `organization_inventory_sync_queue` for later inventory syncing

- **`index-classic-com-dealer`**
  - **Purpose**: Turn a Classic.com seller profile (`/s/.../`) into a canonical organization profile.
  - **Precision keys**: `dealer_license` → `website(origin)` → `name+city+state` (`geographic_key`)
  - **Assets**: logo + favicon + primary image (banner) and metadata provenance
  - **Next step**: triggers inventory extraction (currently calls `scrape-multi-source` for a best-guess inventory URL)

- **`scrape-multi-source`**
  - **Purpose**: Enumerate listing URLs from an inventory/catalog page and upsert them into `import_queue`.
  - **Critical tags** (enable correct downstream normalization):
    - `raw_data.organization_id`
    - `raw_data.inventory_extraction = true`
    - `raw_data.listing_status = 'in_stock' | 'sold'`
  - **Fallback images**:
    - Extracts `thumbnail_url` and optional `image_urls` on inventory grids.
    - These are stored in `import_queue.raw_data` so `process-import-queue` can still attach images when per-listing pages block scraping.
  - **Sold tracking**:
    - Updates `dealer_inventory_seen` (last_seen_at/status) for each listing URL queued.

- **`process-import-queue`**
  - **Purpose**: Deterministically normalize listings into canonical tables.
  - **Does**:
    - dedupe by `vehicles.discovery_url == listing_url` (repair-pass friendly)
    - uploads images + creates `vehicle_images` rows (and can defer to `backfill-images`)
    - links inventory:
      - in-stock: `organization_vehicles(consigner, active, for_sale)` + `dealer_inventory(in_stock)`
      - sold: `organization_vehicles(sold_by, sold, sold)` + `dealer_inventory(sold)`
    - cleans up conflicting legacy org relationship types

### Tracking tables (observability + “don’t rot”)
- **`classic_seller_queue`**: roster of Classic sellers to index
- **`organization_inventory_sync_queue`**: inventory sync scheduling (separate from seller indexing)
- **`dealer_inventory_seen`**: per-dealer listing presence tracking (last seen, status)

### Practical runbook (high level)
1) Discover seller roster:
   - call `discover-classic-sellers` with `filter=all` and enough pages
2) Index organizations:
   - run `process-classic-seller-queue` in batches until queue is mostly completed
3) Inventory sync:
   - drive via `organization_inventory_sync_queue` (implementation can evolve without breaking canonical ingest)
4) Normalization:
   - `process-import-queue` runs on cron (already exists) and keeps org inventory correct


