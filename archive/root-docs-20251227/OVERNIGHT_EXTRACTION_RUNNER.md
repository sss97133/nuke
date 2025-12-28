# Overnight Extraction Runner

**Automated overnight extraction pipeline for all targets.**

## What It Does

Runs extraction pipelines continuously overnight (8 PM - 8 AM, database timezone):

1. **Classic Seller Discovery** (hourly): Discovers new Classic.com dealers/auction houses
2. **Classic Seller Processing** (every 5 min): Indexes sellers → creates businesses → queues inventory sync
3. **Inventory Sync Queue** (every 5 min): Scrapes dealer/auction house inventories → queues listings
4. **Import Queue** (every 5 min): Turns listing URLs into vehicles with images
5. **BaT Extraction Queue** (every 5 min): Deep extraction (comments/features/dates) for BaT vehicles
6. **BaT Grinder** (every 5 min): Seeds BaT live auctions + imports listing pages

All queues use **concurrency-safe locking** (no double-processing even if cron overlaps).

## Setup

### 1. Apply Migration

```bash
supabase db push
```

Or apply manually in Supabase Dashboard SQL Editor:
- File: `supabase/migrations/20251221000004_overnight_extraction_pulse_and_bat_queue_locking.sql`

### 2. Set Service Role Key (One-Time)

The cron jobs read the service role key from a database setting (never hardcoded):

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = '<your_service_role_key>';
```

Get your service role key from: Supabase Dashboard → Settings → API → Service Role Key

**Note**: This must be the JWT-format key (legacy anon key works) or a valid service role key. Some Supabase projects use non-JWT `sb_...` keys; if cron jobs fail, check Edge Function logs for auth errors.

### 3. Verify Cron Jobs Created

```sql
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname IN ('overnight-extraction-pulse', 'overnight-discover-classic-sellers')
ORDER BY jobname;
```

Expected:
- `overnight-extraction-pulse`: `*/5 20-23,0-7 * * *` (every 5 min, 8 PM-8 AM)
- `overnight-discover-classic-sellers`: `0 20-23,0-7 * * *` (hourly, 8 PM-8 AM)

## Manual Triggering (Testing)

### Trigger Full Pipeline Manually

```bash
# Process classic sellers
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-classic-seller-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 20}'

# Process inventory sync
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-inventory-sync-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 10, "max_results": 250}'

# Process import queue
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 40}'

# Process BaT extraction queue
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 10}'

# Trigger BaT grinder
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/go-grinder" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chain_depth": 6, "seed_every": 1, "bat_import_batch": 1}'
```

## Monitoring

### Check Queue Status

```sql
-- Classic seller queue
SELECT status, COUNT(*) as count
FROM classic_seller_queue
GROUP BY status;

-- Inventory sync queue
SELECT status, COUNT(*) as count, MIN(next_run_at) as next_run
FROM organization_inventory_sync_queue
GROUP BY status;

-- Import queue
SELECT status, COUNT(*) as count
FROM import_queue
GROUP BY status
ORDER BY status;

-- BaT extraction queue
SELECT status, COUNT(*) as count
FROM bat_extraction_queue
GROUP BY status;

-- Recent vehicles created (last 24h)
SELECT COUNT(*) as vehicles_created_24h
FROM vehicles
WHERE created_at >= NOW() - INTERVAL '24 hours';
```

### Check Cron Job Runs

```sql
-- Recent cron job runs
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  d.start_time,
  d.end_time,
  d.status,
  d.return_message
FROM cron.job j
LEFT JOIN cron.job_run_details d ON j.jobid = d.jobid
WHERE j.jobname IN ('overnight-extraction-pulse', 'overnight-discover-classic-sellers')
ORDER BY d.start_time DESC NULLS LAST
LIMIT 20;
```

### View Edge Function Logs

```bash
# All overnight-related functions
supabase functions logs process-classic-seller-queue
supabase functions logs process-inventory-sync-queue
supabase functions logs process-import-queue
supabase functions logs process-bat-extraction-queue
supabase functions logs go-grinder

# Or in Supabase Dashboard:
# Edge Functions → [function name] → Logs
```

### Check for Stuck Work

```sql
-- Items stuck in "processing" for > 1 hour (likely crashed worker)
SELECT COUNT(*) as stuck_classic_sellers
FROM classic_seller_queue
WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '1 hour';

SELECT COUNT(*) as stuck_imports
FROM import_queue
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '1 hour';

SELECT COUNT(*) as stuck_bat_extractions
FROM bat_extraction_queue
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '1 hour';
```

If you find stuck items, they'll automatically unlock after the lock TTL (15 minutes for import/BaT queues). The claim RPCs ignore stale locks.

## Adjusting Schedule

### Change Overnight Window

Edit the cron schedule in the migration:

```sql
-- Current: 8 PM - 8 AM (20:00-23:59, 00:00-07:59)
-- Change to: 10 PM - 6 AM (22:00-23:59, 00:00-05:59)
SELECT cron.unschedule('overnight-extraction-pulse');
SELECT cron.schedule(
  'overnight-extraction-pulse',
  '*/5 22-23,0-5 * * *',  -- Changed hours
  $$ ... $$  -- Same command
);
```

### Change Frequency

```sql
-- Run every 10 minutes instead of 5
SELECT cron.unschedule('overnight-extraction-pulse');
SELECT cron.schedule(
  'overnight-extraction-pulse',
  '*/10 20-23,0-7 * * *',  -- Changed frequency
  $$ ... $$
);
```

### Disable Overnight Runs (Temporarily)

```sql
-- Disable (don't delete)
UPDATE cron.job SET active = false 
WHERE jobname IN ('overnight-extraction-pulse', 'overnight-discover-classic-sellers');

-- Re-enable
UPDATE cron.job SET active = true 
WHERE jobname IN ('overnight-extraction-pulse', 'overnight-discover-classic-sellers');
```

## Troubleshooting

### Cron Jobs Not Running

1. **Check pg_cron is enabled**:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. **Check job is active**:
   ```sql
   SELECT jobname, active FROM cron.job WHERE jobname LIKE 'overnight%';
   ```

3. **Check database timezone** (cron uses DB timezone):
   ```sql
   SHOW timezone;
   SELECT NOW();
   ```

4. **Check service role key setting**:
   ```sql
   SELECT current_setting('app.settings.service_role_key', true);
   ```
   If NULL, set it as described in Setup step 2.

### Functions Timing Out

If Edge Functions time out, the cron jobs will still complete (they fire-and-forget). Check function logs for individual errors. You can increase `timeout_milliseconds` in the cron command if needed.

### Queue Backlog Growing

If queues are growing faster than processing:

1. **Increase batch sizes** in cron command (edit migration):
   - `batch_size` for each queue processor
   - `chain_depth` for go-grinder

2. **Run more frequently** (if not already at 5 min):
   ```sql
   SELECT cron.unschedule('overnight-extraction-pulse');
   SELECT cron.schedule('overnight-extraction-pulse', '*/2 20-23,0-7 * * *', $$ ... $$);
   ```

3. **Check for stuck work** (see "Check for Stuck Work" above) and manually reset if needed.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Overnight Pulse (every 5 min, 8 PM - 8 AM)             │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ process-classic-seller-queue
         │   (indexes sellers → creates businesses)
         │
         ├─→ process-inventory-sync-queue
         │   (scrapes dealer/auction inventories)
         │
         ├─→ process-import-queue
         │   (creates vehicles from listing URLs)
         │
         ├─→ process-bat-extraction-queue
         │   (deep extraction: comments/features/dates)
         │
         └─→ go-grinder
             (BaT live auction seeding + import)

┌─────────────────────────────────────────────────────────┐
│ Classic Seller Discovery (hourly, 8 PM - 8 AM)         │
└─────────────────────────────────────────────────────────┘
         │
         └─→ discover-classic-sellers
             (fills classic_seller_queue)
```

All queues use **atomic claim RPCs** with `FOR UPDATE SKIP LOCKED` to prevent double-processing, even if multiple cron jobs or manual runs overlap.

## Success Metrics

After a night of running, check:

```sql
-- Vehicles created overnight
SELECT COUNT(*) as vehicles_created_overnight
FROM vehicles
WHERE created_at >= NOW() - INTERVAL '12 hours';

-- Queue processing stats
SELECT 
  'classic_sellers' as queue,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM classic_seller_queue
UNION ALL
SELECT 
  'bat_extractions',
  COUNT(*) FILTER (WHERE status = 'complete'),
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM bat_extraction_queue;
```

Expected: Queues should be processing steadily, with pending items decreasing over time if extraction rate > queue fill rate.

