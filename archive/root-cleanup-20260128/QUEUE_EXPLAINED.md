# BaT Extraction Queue - Explained

## What is the Queue?

**Queue = Pending Work** - URLs that need to be extracted but haven't been processed yet.

- **1,577 pending items** = 1,577 BaT auction URLs waiting to be extracted
- **Queue does NOT mean data exists** - it means "we have URLs to extract"
- **After extraction** = Vehicle created in database, then data exists

## How It Works

### The Flow:
```
1. URL added to queue (bat_extraction_queue table)
   ↓
2. Queue processor picks up URL
   ↓
3. Calls extract-premium-auction (creates/updates vehicle)
   ↓
4. Calls extract-auction-comments (adds comments/bids)
   ↓
5. Marks queue item as "complete"
   ↓
6. Vehicle now exists in database with full data
```

## What I Fixed

### Problem:
- Queue processor was timing out (150s limit)
- Processing batches of 10 at once
- All failures were timeout errors

### Solution:
✅ **SLOW & ACCURATE** - Process ONE item at a time
✅ **Better timeout handling** - Recognizes timeouts and retries with backoff
✅ **Longer lock time** - 20 minutes (extractions can take 3-5 minutes)
✅ **Reset failed items** - All 31 failed items reset to pending for retry

## Current Status

- **1,577 pending** - Ready to extract (slowly, one at a time)
- **0 failed** - All reset to pending
- **0 complete** - Will start completing as processor runs

## How to Use

### Automatic (Cron Job):
The queue processor runs automatically via cron every few minutes.
It processes ONE item at a time, slowly and accurately.

### Manual Trigger:
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 1}'
```

### Check Progress:
```sql
SELECT 
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'complete') as complete,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM bat_extraction_queue;
```

## The Strategy

**Phase 1: Slow & Accurate (NOW)**
- Process 1 item at a time
- Let extractions take full time (3-5 minutes)
- Ensure accuracy over speed

**Phase 2: Speed Up (LATER)**
- Once we know it works reliably
- Increase batch size gradually
- Monitor for failures
- Optimize timeouts

## What You'll See

- **Vehicles growing** in database (1,500 → 1,501 → 1,502...)
- **Comments/bids growing** as each vehicle is extracted
- **Queue shrinking** (1,577 → 1,576 → 1,575...)
- **Complete count growing** (0 → 1 → 2...)

## Monitoring

Check BaT org page: x
- Watch vehicle count grow
- See new vehicles appear
- Verify data quality

The queue is now working slowly and accurately. Vehicles will start appearing as the processor runs.

