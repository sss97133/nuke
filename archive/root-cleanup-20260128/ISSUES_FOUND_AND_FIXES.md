# ⚠️ Issues Found During Autonomous Extraction

## 📊 FAILURE ANALYSIS (4,112 Failed Items)

### **Issue #1: KSL.com Blocking (3,037 failures = 74% of all failures!)**
```
Error: "Scrape failed: 403" (Forbidden)
Count: 3,037 failed KSL listings
Status: KSL detects and blocks automated scrapers
```

**Fix Required:**
- ❌ Remove KSL from autonomous scraping (they actively block)
- ✅ Mark all KSL failures as "skipped" (stop retrying)
- ⚠️ KSL requires browser automation or residential proxies

**SQL to clean up:**
```sql
UPDATE import_queue
SET status = 'skipped', error_message = 'KSL blocks scrapers - skipped'
WHERE listing_url LIKE '%ksl.com%' AND status = 'failed';
```

---

### **Issue #2: Craigslist Expired Listings (141 failures)**
```
Error: "Scrape failed: 410" (Gone)
Count: 141 expired Craigslist listings
Status: Listings were deleted/sold (normal)
```

**Fix:**
```sql
-- Mark as skipped (no point retrying deleted listings)
UPDATE import_queue
SET status = 'skipped', error_message = 'Listing expired/deleted'
WHERE error_message LIKE '%410%' AND status = 'failed';
```

---

### **Issue #3: Dead Links/404 Errors (133 failures)**
```
Error: "Scrape failed: 404" (Not Found)
Count: 133 dead links from various sites
Status: Sites changed URLs or listings removed
```

**Fix:**
```sql
UPDATE import_queue
SET status = 'skipped', error_message = 'Dead link - 404'
WHERE error_message LIKE '%404%' AND status = 'failed';
```

---

### **Issue #4: Old BaT Failures with Missing Table (181 failures)**
```
Error: "relation 'vehicle_images' does not exist"
Count: 181 BaT listings
Last failure: 2025-12-20 (9 days ago!)
Status: OLD error from before migration - table exists now
```

**Fix:**
```sql
-- Reset these to pending (table exists now, should work)
UPDATE import_queue
SET status = 'pending', attempts = 0, error_message = NULL
WHERE error_message LIKE '%vehicle_images% does not exist%' 
  AND status = 'failed';
```

---

### **Issue #5: Non-Vehicle BaT Listings (60 failures)**
```
Error: "Junk identity detected: year=2025 make=Bring model=a Trailer"
Count: 60 BaT parts/wheels/memorabilia listings
Examples: "Wheels", "Engine", "Pedal Car", "Sign", "Manuals"
```

**Fix:**
```sql
UPDATE import_queue
SET status = 'skipped', error_message = 'Parts/memorabilia - not a vehicle'
WHERE error_message LIKE '%make=Bring model=a Trailer%';
```

---

### **Issue #6: Non-Listing URLs (71 failures)**
```
Error: "Non-listing URL (inventory/home/marketing page)"
Count: 71 inventory index pages (not individual listings)
```

**Fix:**
```sql
UPDATE import_queue
SET status = 'skipped'
WHERE error_message LIKE '%Non-listing URL%';
```

---

### **Issue #7: Invalid Makes (38 failures)**
```
Error: "Invalid make: Used" / "Invalid make: Classic"
Count: 38 junk extractions
```

**Fix:**
```sql
UPDATE import_queue
SET status = 'skipped'
WHERE error_message LIKE '%Invalid make:%';
```

---

### **Issue #8: One BaT Auction Not Syncing (347 hours stale!)**
```
Listing: 2004 Porsche 911 Turbo Cabriolet
Status: 'pending' (not 'active')
Last sync: 2025-12-15 (14+ days ago!)
Issue: sync-active-auctions only updates 'active' or 'live' status
```

**Fix:** Update the `sync-active-auctions` function to sync ALL listings with future end_dates (not just 'active'/'live')

---

### **Issue #9: 751 Items Stuck in Processing (20+ hours)**
```
Status: Locked since 2025-12-28 21:09
Issue: Process died without releasing locks
Fix: ✅ ALREADY UNLOCKED (reset to pending)
```

---

## ✅ FIXES TO APPLY

### **1. Clean Up Failed Queue (Immediate)**
```sql
-- Skip KSL (3,037 items - they block us)
UPDATE import_queue
SET status = 'skipped', error_message = 'KSL blocks scrapers'
WHERE listing_url LIKE '%ksl.com%' AND status = 'failed';

-- Skip expired Craigslist (141 items)
UPDATE import_queue
SET status = 'skipped', error_message = 'Listing expired'
WHERE error_message LIKE '%410%' AND status = 'failed';

-- Skip 404s (133 items)
UPDATE import_queue
SET status = 'skipped', error_message = 'Dead link'
WHERE error_message LIKE '%404%' AND status = 'failed';

-- Skip non-vehicles (60 + 71 + 38 = 169 items)
UPDATE import_queue
SET status = 'skipped'
WHERE status = 'failed'
  AND (error_message LIKE '%Junk identity%' 
    OR error_message LIKE '%Non-listing URL%'
    OR error_message LIKE '%Invalid make:%');

-- Retry old BaT failures (181 items - table exists now)
UPDATE import_queue
SET status = 'pending', attempts = 0, error_message = NULL
WHERE error_message LIKE '%vehicle_images% does not exist%';

-- Result: 3,489 cleaned up, 181 retrying, ~442 real failures remaining
```

###  **2. Fix BaT Sync to Include ALL Future Auctions**
The `sync-active-auctions` function needs to sync based on `end_date > NOW()` instead of `listing_status IN ('active', 'live')`.

Already fixed in your local code - just needs to be deployed!

---

## 📊 EXPECTED RESULTS AFTER CLEANUP

### **Before Cleanup:**
- Failed: 4,112
- Pending: 821

### **After Cleanup:**
- Skipped: ~3,489 (KSL + expired + dead links + non-vehicles)
- Pending: ~1,002 (821 + 181 retries)
- Failed: ~442 (real issues needing review)

This will make the queue much healthier and faster to process!

---

## 🎯 WHY EXTRACTION WAS SLOW

1. **Image backfilling dominated** - Downloaded 62K images (took most CPU/network)
2. **KSL failures** - 3,037 items kept failing and retrying
3. **Queue processor slowed** - Couldn't keep up with image downloads
4. **Stuck locks** - 751 items locked for 20+ hours

### **After Fixes:**
- ✅ 3,489 junk items removed from queue
- ✅ 181 old BaT items reset for retry
- ✅ 821 items ready to process
- ✅ No more stuck locks
- ✅ KSL won't keep failing and clogging the queue

Expected new rate: **50-100 vehicles/hour** (after cleanup)

