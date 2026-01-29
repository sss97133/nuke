# External Auction Monitoring - Complete Guide

**Last Updated:** 2026-01-09  
**Status:** ✅ Active System with Some Gaps

---

## 🎯 What's Happening (Current State)

### ✅ **Working Systems:**

1. **BaT (Bring a Trailer) Extraction Queue**
   - **1,577 pending items** waiting to be extracted
   - Queue processor runs every 5 minutes via cron
   - Processes **1 item at a time** (slow but accurate)
   - Two-step workflow: Core data → Comments/Bids

2. **Live Auction Monitoring**
   - `sync-active-auctions` cron job runs **every 15 minutes**
   - Monitors active auctions from multiple platforms:
     - BaT (Bring a Trailer)
     - Cars & Bids
     - Mecum
     - Barrett-Jackson
   - Updates `external_listings` table with:
     - Current bid amounts
     - Bid counts
     - End dates
     - Listing status

3. **Frontend Real-time Updates**
   - Frontend subscribes to `external_listings` changes via Supabase realtime
   - UI automatically updates when bids change (no page refresh needed)
   - "Auction pulse" shows live bid and countdown timer

### ⚠️ **Gaps & Issues:**

1. **Cars & Bids Extraction**
   - ❌ Only extracting **9 images** instead of 100+
   - ❌ Missing comments extraction function (like BaT's `extract-auction-comments`)
   - ⚠️ Sync function uses simple HTML regex (should use Firecrawl/LLM)

2. **Queue Processing**
   - Very slow (1 item every 5 minutes = ~12/hour)
   - 1,577 items = ~131 hours to complete (5+ days)

---

## 🔄 How It's Supposed to Work

### **The Complete Flow:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DISCOVERY PHASE                                           │
│    - URLs added to extraction queue (bat_extraction_queue) │
│    - Or discovered via platform-specific discovery functions │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. EXTRACTION PHASE (Two-Step)                              │
│                                                              │
│    Step 1: Core Data                                        │
│    ┌────────────────────────────────────────────┐          │
│    │ extract-premium-auction                     │          │
│    │ - VIN, specs, images, auction metadata     │          │
│    │ - Creates: vehicles, external_listings    │          │
│    └────────────────────────────────────────────┘          │
│                          ↓                                   │
│    Step 2: Comments/Bids                                    │
│    ┌────────────────────────────────────────────┐          │
│    │ extract-auction-comments                   │          │
│    │ - All comments, bids, bidders              │          │
│    │ - Creates: auction_comments, external_     │          │
│    │   identities                                │          │
│    └────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. LIVE MONITORING PHASE                                     │
│                                                              │
│    Every 15 minutes:                                        │
│    ┌────────────────────────────────────────────┐          │
│    │ sync-active-auctions (cron)               │          │
│    │ - Finds active listings                   │          │
│    │ - Calls platform-specific sync functions: │          │
│    │   • sync-bat-listing                      │          │
│    │   • sync-cars-and-bids-listing            │          │
│    │ - Updates external_listings table         │          │
│    └────────────────────────────────────────────┘          │
│                          ↓                                   │
│    Frontend Real-time Subscription:                        │
│    ┌────────────────────────────────────────────┐          │
│    │ Supabase Realtime on external_listings    │          │
│    │ - UI auto-updates when bids change        │          │
│    │ - Shows live countdown timer              │          │
│    └────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### **Key Tables:**

1. **`bat_extraction_queue`** - URLs waiting to be extracted
   - Status: `pending`, `processing`, `complete`, `failed`
   - Processed by: `process-bat-extraction-queue` (cron every 5 min)

2. **`external_listings`** - All auction listings (active + ended)
   - Platform: `bring_a_trailer`, `cars_and_bids`, `mecum`, etc.
   - Fields: `current_bid`, `bid_count`, `end_date`, `listing_status`
   - Synced by: `sync-active-auctions` (cron every 15 min)

3. **`vehicles`** - Extracted vehicle data
   - Created by: `extract-premium-auction`
   - Linked to: `external_listings` via `listing_url`

4. **`auction_comments`** - Comments from auctions
   - Created by: `extract-auction-comments`
   - Linked to: `external_listings` via `listing_url`

---

## ❌ What's Missing

### **1. Cars & Bids Comments Extraction**
- **Status:** ❌ Missing function
- **Needed:** `extract-cars-and-bids-comments` (similar to BaT's `extract-auction-comments`)
- **Impact:** No comments/bids data for Cars & Bids auctions
- **Fix:** Create function following BaT pattern, use Firecrawl for JavaScript rendering

### **2. Cars & Bids Image Extraction**
- **Status:** ⚠️ Partial (only 9 images instead of 100+)
- **Problem:** Not extracting from `__NEXT_DATA__` JSON
- **Impact:** Missing 90+ images per listing
- **Fix:** Update `extract-premium-auction` to extract all images from `__NEXT_DATA__`

### **3. Better Sync Functions**
- **Status:** ⚠️ Working but basic
- **Problem:** Using simple HTML regex instead of Firecrawl/LLM
- **Impact:** May miss some data updates
- **Fix:** Enhance `sync-cars-and-bids-listing` to use Firecrawl/LLM like BaT

### **4. Queue Processing Speed**
- **Status:** ⚠️ Very slow (1 item every 5 minutes)
- **Problem:** Processing 1 at a time to avoid timeouts
- **Impact:** Takes 5+ days to process 1,577 items
- **Fix:** Gradually increase batch size once reliability is proven

---

## 📊 How to Monitor External Auctions

### **Option 1: SQL Monitoring Dashboard (Recommended)**

Run this in Supabase SQL Editor:

```sql
-- ============================================================================
-- EXTERNAL AUCTION MONITORING DASHBOARD
-- ============================================================================

-- 1. LIVE AUCTION STATUS
SELECT 
  platform,
  COUNT(*) as total_listings,
  COUNT(*) FILTER (WHERE listing_status = 'active') as active,
  COUNT(*) FILTER (WHERE listing_status = 'ended') as ended,
  COUNT(*) FILTER (WHERE end_date > NOW()) as ending_soon,
  MAX(current_bid) as highest_bid,
  MAX(last_synced_at) as last_sync
FROM external_listings
GROUP BY platform
ORDER BY active DESC;

-- 2. SYNC STATUS (Is sync-active-auctions working?)
SELECT 
  'sync-active-auctions' as job_name,
  active as is_active,
  schedule,
  start_time as last_run,
  status as last_status,
  return_message as last_message
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status, return_message
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE jobname = 'sync-active-auctions';

-- 3. ACTIVE AUCTIONS NEEDING SYNC
SELECT 
  platform,
  COUNT(*) as needing_sync,
  MIN(last_synced_at) as oldest_sync
FROM external_listings
WHERE listing_status = 'active'
  AND sync_enabled = TRUE
  AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '15 minutes')
GROUP BY platform;

-- 4. RECENT AUCTION UPDATES (Last Hour)
SELECT 
  platform,
  listing_url,
  current_bid,
  bid_count,
  end_date,
  updated_at as last_updated
FROM external_listings
WHERE updated_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC
LIMIT 20;

-- 5. QUEUE STATUS (BaT Extraction)
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM bat_extraction_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
  END;
```

### **Option 2: Frontend Dashboard**

Navigate to: `/admin/scraper-dashboard`

Shows:
- Queue status (pending/complete/failed counts)
- Recent activity
- System stats
- Can trigger scrapers manually

### **Option 3: Terminal Commands**

```bash
# Check queue status
npx supabase db remote exec "
SELECT status, COUNT(*) 
FROM bat_extraction_queue 
GROUP BY status;
"

# Check live auctions
npx supabase db remote exec "
SELECT platform, COUNT(*), MAX(current_bid) as highest_bid
FROM external_listings 
WHERE end_date > NOW() 
GROUP BY platform;
"

# Check sync job status
npx supabase db remote exec "
SELECT jobname, active, schedule, start_time, status
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE jobname = 'sync-active-auctions';
"

# Watch Edge Function logs
npx supabase functions logs sync-active-auctions --tail
```

### **Option 4: Full Monitoring Script**

Run the complete monitoring dashboard:

```bash
# In Supabase SQL Editor, paste contents of:
scripts/monitor-autonomous-extraction.sql
```

This shows:
- Database size and capacity
- Queue health
- Live auction tracking
- Recent activity
- System health summary

---

## 🔧 Cron Jobs Overview

### **Active Monitoring Jobs:**

| Job Name | Schedule | Purpose | Status |
|----------|----------|---------|--------|
| `sync-active-auctions` | Every 15 min | Sync active auctions (bids, end dates) | ✅ Active |
| `process-bat-queue` | Every 5 min | Process BaT extraction queue | ✅ Active |
| `sbxcars-monitor` | Every 30 min | Monitor SBX Cars auctions | ✅ Active |
| `cl-process-queue` | Every 30 min | Process Craigslist queue | ✅ Active |

### **Check Cron Job Status:**

```sql
SELECT 
  jobname,
  active,
  schedule,
  start_time as last_run,
  status as last_status
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE jobname IN (
  'sync-active-auctions',
  'process-bat-queue',
  'sbxcars-monitor',
  'cl-process-queue'
)
ORDER BY jobname;
```

---

## 🚨 Troubleshooting

### **Problem: Auctions not updating**
1. Check if `sync-active-auctions` cron is active:
   ```sql
   SELECT active FROM cron.job WHERE jobname = 'sync-active-auctions';
   ```
2. Check last run time:
   ```sql
   SELECT start_time, status FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sync-active-auctions')
   ORDER BY start_time DESC LIMIT 1;
   ```
3. Check Edge Function logs:
   ```bash
   npx supabase functions logs sync-active-auctions --tail
   ```

### **Problem: Queue not processing**
1. Check queue status:
   ```sql
   SELECT status, COUNT(*) FROM bat_extraction_queue GROUP BY status;
   ```
2. Check if cron is active:
   ```sql
   SELECT active FROM cron.job WHERE jobname = 'process-bat-queue';
   ```
3. Manually trigger:
   ```bash
   curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue" \
     -H "Authorization: Bearer YOUR_SERVICE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"batchSize": 1}'
   ```

### **Problem: Frontend not updating**
1. Check if Supabase realtime is enabled for `external_listings`
2. Check browser console for subscription errors
3. Verify `external_listings` table has recent updates:
   ```sql
   SELECT MAX(updated_at) FROM external_listings WHERE listing_status = 'active';
   ```

---

## 📈 Expected Performance

### **Queue Processing:**
- **Current:** 1 item every 5 minutes = 12/hour = 288/day
- **1,577 items:** ~5.5 days to complete
- **Goal:** Increase to 10/hour once reliability proven

### **Live Auction Sync:**
- **Frequency:** Every 15 minutes
- **Batch size:** 20 listings per run
- **Coverage:** All active auctions synced within 15-30 minutes

### **Frontend Updates:**
- **Real-time:** Updates within 1-2 seconds of database change
- **No refresh needed:** UI automatically reflects new bids

---

## ✅ Summary

**What's Working:**
- ✅ BaT extraction queue system
- ✅ Live auction monitoring (every 15 min)
- ✅ Frontend real-time updates
- ✅ Multiple platform support

**What's Missing:**
- ❌ Cars & Bids comments extraction
- ⚠️ Cars & Bids full image extraction (only 9/100+)
- ⚠️ Better sync functions (use Firecrawl/LLM)
- ⚠️ Queue processing speed (very slow)

**How to Monitor:**
1. Use SQL dashboard (`scripts/monitor-autonomous-extraction.sql`)
2. Check frontend dashboard (`/admin/scraper-dashboard`)
3. Watch Edge Function logs
4. Check cron job status

**Next Steps:**
1. Create `extract-cars-and-bids-comments` function
2. Fix Cars & Bids image extraction (extract from `__NEXT_DATA__`)
3. Enhance sync functions to use Firecrawl/LLM
4. Gradually increase queue processing speed

