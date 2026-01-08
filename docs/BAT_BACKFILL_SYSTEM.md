# BaT Backfill System - Automated Profile Repair

**Status:** ✅ **DEPLOYED AND RUNNING**

## Overview

The backfill system automatically identifies and re-extracts BaT vehicles with:
- ❌ **Wrong sale status** (marked as "sold" but should be "bid_to" or "no_sale")
- ❌ **Missing critical data** (VIN, mileage, color, transmission, drivetrain)
- ❌ **Incorrect price data** (high_bid incorrectly stored as sale_price)
- ❌ **Missing auction outcome data**

## How It Works

### 1. Automatic Queuing (Every 10 Minutes)

The `pipeline-orchestrator` (runs every 10 minutes via GitHub Actions) automatically:
- Identifies vehicles needing backfill using `auto_queue_bat_backfills()`
- Queues 20 vehicles per run with priority 75 (lower than new extractions)
- Re-queues previously failed items

### 2. Processing (Continuous)

The existing `process-bat-extraction-queue` function processes both:
- **New extractions** (priority 100) - from auto-extraction triggers
- **Backfills** (priority 75) - from the backfill queuing function

Both use the same two-step workflow:
1. `extract-premium-auction` - Core data with fixed sale status logic
2. `extract-auction-comments` - Comments and bids

### 3. Fixed Extraction Logic

The updated `extract-premium-auction` now correctly:
- ✅ Distinguishes "Bid to $X" (NOT sold) vs "Sold for $X" (sold)
- ✅ Detects "got away" indicators
- ✅ Only sets `sale_price` when actually sold
- ✅ Sets correct `auction_events.outcome` ('bid_to', 'no_sale', 'sold')
- ✅ Extracts bid count separately from comment count

## Database Functions

### `queue_bat_backfill_vehicles(p_limit, p_priority)`

Identifies vehicles needing backfill. Returns:
- `vehicle_id` - UUID of vehicle
- `reason` - Why it needs backfill
- `bat_url` - BaT listing URL

**Example:**
```sql
SELECT * FROM queue_bat_backfill_vehicles(50, 75);
```

### `auto_queue_bat_backfills(p_batch_size, p_priority)`

Automatically queues vehicles for backfill. Returns:
- `queued_count` - Number of vehicles queued
- `skipped_count` - Number already queued

**Example:**
```sql
SELECT * FROM auto_queue_bat_backfills(20, 75);
```

## What Gets Fixed

### Sale Status Corrections

**Before (WRONG):**
- Vehicle shows "Bid to $89,500"
- Extraction sets: `sale_price = 89500`, `outcome = 'sold'`
- **Result:** Incorrect data showing as sold

**After (CORRECT):**
- Vehicle shows "Bid to $89,500"
- Extraction sets: `high_bid = 89500`, `sale_price = null`, `outcome = 'bid_to'`
- **Result:** Accurate data showing not sold

### Missing Data Enrichment

Vehicles missing critical fields will be re-extracted to get:
- VIN (from BaT Essentials)
- Mileage (odometer reading)
- Color (exterior color)
- Transmission (gear type)
- Drivetrain (AWD/RWD/4WD/FWD)
- Full image galleries
- Complete auction data

## Queue Priorities

- **Priority 100:** New extractions (auto-queued from triggers)
- **Priority 75:** Backfill extractions (from backfill queuing)
- Processed in priority order (100 first, then 75)

## Monitoring

### Check Queue Status

```sql
-- See pending backfill items
SELECT 
  beq.*,
  v.year, v.make, v.model,
  v.bat_auction_url
FROM bat_extraction_queue beq
JOIN vehicles v ON v.id = beq.vehicle_id
WHERE beq.status = 'pending'
  AND beq.priority = 75
ORDER BY beq.created_at ASC
LIMIT 50;
```

### Check Backfill Progress

```sql
-- Vehicles queued for backfill today
SELECT 
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'processing') as processing,
  COUNT(*) FILTER (WHERE status = 'complete') as complete,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM bat_extraction_queue
WHERE priority = 75
  AND created_at::date = CURRENT_DATE;
```

## Automation

### GitHub Actions (Every 10 Minutes)

The `pipeline-orchestrator` GitHub Action automatically:
1. Queues 20 backfill vehicles per run
2. Processes both new and backfill extractions
3. Runs continuously while you're away

**File:** `.github/workflows/pipeline-orchestrator.yml`

### Pipeline Orchestrator (Edge Function)

The orchestrator:
1. **Step 0:** Auto-queues backfills (20 per run)
2. **Step 1:** Unlocks orphaned queue items
3. **Step 2:** Triggers scrapers for new listings
4. **Step 3:** Processes queues (import_queue, bat_extraction_queue)
5. **Step 4:** Collects metrics

## Manual Operations

### Queue a Specific Vehicle

```sql
INSERT INTO bat_extraction_queue (vehicle_id, bat_url, priority, status)
VALUES (
  'vehicle-uuid-here',
  'https://bringatrailer.com/listing/...',
  75,
  'pending'
)
ON CONFLICT (vehicle_id) DO UPDATE SET
  status = 'pending',
  priority = GREATEST(bat_extraction_queue.priority, 75);
```

### Force Process Backfills

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 10, "maxAttempts": 3}'
```

## Expected Results

- **Immediate:** New extractions use fixed sale status logic (no more wrong data)
- **Ongoing:** Backfill system gradually fixes existing incorrect data
- **Rate:** ~20 vehicles queued per 10-minute cycle = ~120/hour = ~2,880/day

## Notes

- Backfills use **priority 75** so new extractions (priority 100) are processed first
- The system respects the queue's concurrency locking (no duplicate processing)
- Failed items are automatically re-queued with exponential backoff
- The orchestrator runs every 10 minutes and will continue working while you're away

---

**Last Updated:** 2026-01-10  
**Status:** ✅ **PRODUCTION - RUNNING AUTOMATICALLY**

