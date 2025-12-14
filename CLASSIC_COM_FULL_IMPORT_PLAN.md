# Classic.com Full Seller Import Plan (Dealers + Auction Houses)

## Goals (what “done” means)
- **All Classic.com sellers** listed on `https://www.classic.com/data?filter=all` are discovered into `classic_seller_queue`.
- **Each seller becomes an organization profile** in `public.businesses` with:
  - **name** (canonical `business_name`)
  - **website** (normalized origin where possible)
  - **favicon** (cached via `source_favicons` where possible)
  - **logo** (if available)
  - **primary image** (banner/cover image where possible)
  - **Classic.com profile URL** stored in `businesses.metadata.classic_com_profile`
- **Inventory ingest** runs on a schedule and remains clean over time:
  - **Current inventory** and (if explicitly provided) **sold inventory** are queued and processed
  - **Seen tracking** is updated on every run for disappearance detection (`dealer_inventory_seen`)
  - **Idempotent**: reruns do not create duplicates or degrade data quality

## Deliverables (concrete artifacts)
- **Discovery function**: `supabase/functions/discover-classic-sellers`
  - Output: rows in `public.classic_seller_queue` (unique by `profile_url`)
- **Indexing function**: `supabase/functions/index-classic-com-dealer`
  - Output: upsert into `public.businesses` + brand media (logo/favicon/primary image) + metadata
- **Queue processor**: `supabase/functions/process-classic-seller-queue`
  - Output: marks queue rows `completed` and enqueues inventory sync in `public.organization_inventory_sync_queue`
- **Inventory sync processor**: `supabase/functions/process-inventory-sync-queue`
  - Output: calls `scrape-multi-source` for inventory discovery; schedules next run
- **Inventory scraper**: `supabase/functions/scrape-multi-source`
  - Output: upserts `public.import_queue` (dedupe by `listing_url`) and upserts `public.dealer_inventory_seen`
- **Schema**: migration `supabase/migrations/20251214000020_classic_seller_import_toolbox.sql`
  - Tables: `classic_seller_queue`, `organization_inventory_sync_queue`, `dealer_inventory_seen`

## Source-of-truth identifiers (dedupe rules)
- **Seller identity**
  - **Primary key**: `classic_seller_queue.profile_url` (unique)
  - **Organization dedupe** (in `index-classic-com-dealer`):
    - Prefer **dealer license**
    - Else **website origin**
    - Else **name + city + state**
- **Listing identity**
  - **Primary key**: `import_queue.listing_url` (upsert `onConflict: listing_url`)
  - **Seen tracker key**: `(dealer_inventory_seen.dealer_id, dealer_inventory_seen.listing_url)`

## Pipeline (end-to-end)

### Phase 1: Discover sellers into a queue
- Call `discover-classic-sellers` with:
  - `filter: "all"`
  - `start_page: 1`
  - `max_pages`: enough to cover the full dataset
- Writes to `classic_seller_queue` with `status="pending"`

### Phase 2: Index seller profiles into organizations
- Run `process-classic-seller-queue`
  - Pulls `classic_seller_queue` rows in `pending`
  - Calls `index-classic-com-dealer` for each profile
  - On success:
    - Updates queue row -> `status="completed"`, sets `organization_id`
    - Upserts `organization_inventory_sync_queue` with `run_mode="both"`
  - On failure:
    - Updates queue row -> `status="failed"`, sets `last_error`, increments attempts

### Phase 3: Inventory extraction (current + sold) and tracking
- Run `process-inventory-sync-queue`
  - Loads `businesses` row
  - Chooses URLs (and uses **both** sources when available):
    - **Classic.com source**:
      - `classic_com_profile`: `businesses.metadata.classic_com_profile` (seller page on Classic.com)
    - **Seller-website source** (only if org has a valid `businesses.website` origin):
      - `inventory_url`: `businesses.metadata.inventory_url` or `${origin}/inventory`
      - `sold_inventory_url`: `businesses.metadata.sold_inventory_url` (only if explicitly known)
      - `auctions_url`: `businesses.metadata.auctions_url` or `${origin}/auctions`
  - Calls `scrape-multi-source` with:
    - `organization_id` (critical: enables `dealer_inventory_seen`)
    - Classic.com seller pages: enumerates Classic.com listing links (conservative; downstream `scrape-vehicle` pulls the full detail)
    - Seller website inventory: uses `force_listing_status: "in_stock"` for current, `"sold"` for sold pages
- `scrape-multi-source`:
  - Upserts `import_queue` by `listing_url`
  - Updates `dealer_inventory_seen` with `last_seen_at` and `last_seen_status`

## Sold detection model (precision-first)
- **We only mark “sold” when we have an explicit sold feed/page** (or a strong sold signal like `/sold` paths).
- Otherwise, the system **tracks disappearance** via `dealer_inventory_seen.last_seen_at`:
  - A listing that is not seen for N runs can be flagged for review/automation (future step).
- This avoids “guessing sold” and keeps the DB clean.

## Operational runbook (safe execution order)
1. **Discover**
   - Run `discover-classic-sellers` for `filter="all"` with enough pages.
2. **Index organizations**
   - Run `process-classic-seller-queue` repeatedly until queue is drained (or until failure rate stabilizes).
3. **Inventory sync**
   - Run `process-inventory-sync-queue` repeatedly; it schedules follow-ups via `next_run_at`.
4. **Monitor quality**
   - Spot-check:
     - `businesses` has `business_name`, `website`, `logo_url`/`banner_url` when available
     - `import_queue` grows with unique `listing_url`s
     - `dealer_inventory_seen` updates per run

## “Use MCP” mapping (how MCP fits without breaking patterns)
Your current production import path is queue-driven and Deno/TypeScript-based. The “MCP” idea maps best as:
- A **config-driven extractor interface** behind `scrape-multi-source` and seller indexing
- Output must conform to the existing contracts above (URLs, org fields, listing fields)
- Any MCP implementation must be **idempotent** and **validate before writing**

## Next improvements (optional, but aligned to your goals)
- Classic.com inventory adapter is now used as an **additional source** when `businesses.metadata.classic_com_profile` is present.
- Add a nightly job that materializes “disappearance candidates” from `dealer_inventory_seen` into a review queue (no guessing).


