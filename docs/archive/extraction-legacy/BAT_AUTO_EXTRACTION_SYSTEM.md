# BaT Auto-Extraction System

## Overview

This system automatically ensures all BaT vehicles have complete data extraction (comments, features, auction dates, etc.) without manual intervention.

## How It Works

### 1. Automatic Queueing

When a BaT vehicle is created or updated and is missing critical fields, a database trigger automatically queues it for extraction:

- **Trigger**: `trigger_auto_extract_bat_data` on `vehicles` table
- **Condition**: Vehicle has `bat_auction_url` or `discovery_url` with 'bringatrailer.com' AND is missing:
  - `bat_comments`
  - `origin_metadata.bat_features`
  - `auction_end_date`

### 2. Queue Processing

The `process-bat-extraction-queue` Edge Function processes queued vehicles:

- Fetches pending items (prioritized by priority, then age)
- Calls `comprehensive-bat-extraction` for each vehicle
- Updates queue status (complete/failed)
- Retries up to 3 times on failure

### 3. Import Integration

`import-bat-listing` now **always** calls comprehensive extraction for new imports, ensuring immediate data completeness.

## Usage

### Process Queue Manually

```bash
# Process queue (default batch size: 10)
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/process-bat-extraction-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 20}'
```

### Schedule Queue Processing (Recommended)

Set up a cron job or scheduled function to run `process-bat-extraction-queue` every few minutes:

```sql
-- Example: Run every 5 minutes (requires pg_cron extension)
SELECT cron.schedule(
  'process-bat-extraction-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url:='https://YOUR_PROJECT.supabase.co/functions/v1/process-bat-extraction-queue',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body:='{"batchSize": 20}'::jsonb
  );
  $$
);
```

### Check Queue Status

```sql
-- View queue status
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM bat_extraction_queue
GROUP BY status;

-- View pending items
SELECT v.year, v.make, v.model, q.bat_url, q.attempts, q.created_at
FROM bat_extraction_queue q
JOIN vehicles v ON v.id = q.vehicle_id
WHERE q.status = 'pending'
ORDER BY q.priority DESC, q.created_at ASC
LIMIT 20;
```

## Database Schema

### `bat_extraction_queue` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vehicle_id` | UUID | References `vehicles.id` |
| `bat_url` | TEXT | BaT listing URL |
| `status` | TEXT | `pending`, `processing`, `complete`, `failed` |
| `priority` | INTEGER | Higher = more urgent (default: 100) |
| `error_message` | TEXT | Error details if failed |
| `attempts` | INTEGER | Number of processing attempts |
| `created_at` | TIMESTAMPTZ | When queued |
| `updated_at` | TIMESTAMPTZ | Last update |
| `completed_at` | TIMESTAMPTZ | When completed |

## Benefits

✅ **Automatic**: No manual scripts needed  
✅ **Scalable**: Processes in batches, handles failures gracefully  
✅ **Efficient**: Only processes vehicles missing data  
✅ **Reliable**: Automatic retries, error tracking  
✅ **Complete**: Ensures all BaT vehicles have full data extraction

