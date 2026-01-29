# Bulk Inventory Extraction

Easy way to backfill all missing vehicle inventories for organizations.

## Quick Start

### 1. Queue all organizations with missing inventory

```bash
# Queue all orgs with < 5 vehicles and a website
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/bulk-enqueue-inventory-extraction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "run_mode": "both",
    "limit": 1000,
    "min_inventory_threshold": 5,
    "only_with_website": true
  }'
```

### 2. Process the queue

The queue will be processed automatically by the cron job, or you can trigger it manually:

```bash
# Process inventory sync queue
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/process-inventory-sync-queue" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_size": 10,
    "max_results": 200
  }'
```

## Parameters

### `bulk-enqueue-inventory-extraction`

- **`run_mode`** (optional): `"current"` | `"sold"` | `"both"` (default: `"both"`)
  - `current`: Only extract current inventory
  - `sold`: Only extract sold inventory
  - `both`: Extract both current and sold inventory

- **`limit`** (optional): Max number of organizations to check (default: 1000, max: 5000)

- **`min_inventory_threshold`** (optional): Only queue orgs with inventory count below this (default: 5)

- **`only_with_website`** (optional): Only queue orgs that have a website URL (default: true)

- **`business_type`** (optional): Filter by business type (e.g., `"dealer"`, `"auction_house"`)

- **`requeue_failed`** (optional): Requeue previously failed extractions (default: true)

- **`dry_run`** (optional): Preview what would be queued without actually queuing (default: false)

## Examples

### Queue all dealers with missing inventory

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/bulk-enqueue-inventory-extraction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "business_type": "dealer",
    "min_inventory_threshold": 10,
    "limit": 500
  }'
```

### Preview what would be queued (dry run)

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/bulk-enqueue-inventory-extraction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true,
    "limit": 100
  }'
```

### Queue only organizations with zero inventory

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/bulk-enqueue-inventory-extraction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "min_inventory_threshold": 1,
    "only_with_website": true
  }'
```

## How It Works

1. **`bulk-enqueue-inventory-extraction`** finds organizations with low/no inventory
2. Queues them in `organization_inventory_sync_queue` table
3. **`process-inventory-sync-queue`** processes the queue:
   - Calls `scrape-multi-source` to extract inventory from websites
   - Creates vehicles and links them to organizations
   - Updates `dealer_inventory` and `organization_vehicles` tables

## Monitoring

Check queue status:

```sql
SELECT 
  status,
  COUNT(*) as count
FROM organization_inventory_sync_queue
GROUP BY status;
```

View pending items:

```sql
SELECT 
  b.business_name,
  b.website,
  q.status,
  q.attempts,
  q.next_run_at
FROM organization_inventory_sync_queue q
JOIN businesses b ON b.id = q.organization_id
WHERE q.status IN ('pending', 'processing')
ORDER BY q.next_run_at NULLS FIRST
LIMIT 20;
```

## Notes

- The system automatically extracts inventory from:
  - Organization websites (inventory pages)
  - Classic.com profiles (if linked)
  - BaT profiles (if linked)
  - External platform listings

- Extraction is rate-limited to avoid overwhelming websites
- Failed extractions are automatically retried with exponential backoff
- The cron job runs `process-inventory-sync-queue` every 30 minutes

