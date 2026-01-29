# Extraction Verification & Fixes

**Status:** ✅ **FIXES DEPLOYED**

## Issues Found

### ❌ Problem 1: `auction_events` Not Created for All Vehicles

**Issue:** `auction_events` were only created if `comments` or `bid_history` existed in the extraction result. This meant:
- **301 vehicles** extracted in last 7 days have NO `auction_events`
- **150 of those** have `sale_price` but no outcome tracking
- No way to verify sale status correctness

**Root Cause:** Line 3681 had condition: `if (data?.id && listingUrl && (Array.isArray(vehicle.comments) || Array.isArray(vehicle.bid_history)))`

**Fix Applied:** Removed the comments/bid_history condition. Now `auction_events` are ALWAYS created/updated for BaT listings.

### ❌ Problem 2: Existing `auction_events` Not Updated with Correct Outcome

**Issue:** When updating existing `auction_events`, the code wasn't updating `outcome`, `high_bid`, or `winning_bid`. This meant:
- Wrong outcomes persisted even after re-extraction
- Status never corrected from "sold" to "bid_to"

**Fix Applied:** Added outcome recalculation and full field updates on existing events.

### ❌ Problem 3: No Source Data Verification

**Issue:** No logging or verification step to confirm extracted data matches source page.

**Fix Applied:** Added verification logging that shows:
- What HTML extraction found ("Bid to $X" vs "Sold for $X")
- Final extracted values (sale_price, high_bid, outcome)
- Expected outcome based on extracted data

## Current Status

### Vehicles Needing Backfill

**Total:** 1,000+ vehicles identified

**Breakdown:**
- Wrong sale status: 139 vehicles
- Missing critical data: 411 vehicles  
- Incorrect price data: 377 vehicles
- Missing auction outcome: 73 vehicles

### Queue Processing

- **29 vehicles** pending in queue (priority 100)
- **34 vehicles** completed recently
- **1,524 vehicles** failed (may need retry)

### Verification Checks

**From Database (Last 7 Days):**
- ❌ **301 vehicles** extracted but NO `auction_events` (will be fixed by new code)
- ⚠️ **150 vehicles** have `sale_price` but may be incorrectly marked as sold
- ✅ **1 vehicle** correctly marked as sold (has sale_price + outcome='sold')

## How Verification Works Now

### 1. HTML Extraction Verification

The `extractBatSpecsFromHtml()` function:
- ✅ Detects "Bid to $X" patterns → sets `high_bid`, NOT `sale_price`
- ✅ Detects "Sold for $X" patterns → sets `sale_price`
- ✅ Detects "got away" indicators → sets `reserve_met = false`
- ✅ Logs what was extracted for verification

### 2. Outcome Calculation Verification

The code now:
- ✅ Only sets `sale_price` if HTML found "Sold for" (not "Bid to")
- ✅ Calculates outcome: `hasSalePrice ? 'sold' : (hasHighBid ? 'bid_to' : 'no_sale')`
- ✅ Logs expected outcome before creating `auction_events`

### 3. `auction_events` Creation/Update Verification

Every extraction now:
- ✅ **Always** creates/updates `auction_events` (no longer requires comments/bid_history)
- ✅ Updates outcome on existing events (fixes wrong status)
- ✅ Sets `winning_bid` ONLY when actually sold
- ✅ Sets `high_bid` for all auctions (regardless of outcome)

## Manual Verification

### Check a Specific Vehicle

```sql
-- Check vehicle data
SELECT 
  v.id,
  v.year, v.make, v.model,
  v.sale_price,
  v.bat_auction_url,
  ae.outcome,
  ae.high_bid,
  ae.winning_bid,
  ae.updated_at as ae_updated
FROM vehicles v
LEFT JOIN auction_events ae ON ae.vehicle_id = v.id
WHERE v.bat_auction_url LIKE '%bronco-raptor-11%'
   OR v.discovery_url LIKE '%bronco-raptor-11%';
```

### Expected Results for "Bid to $89,500" (NOT SOLD)

- ✅ `v.sale_price` = `NULL`
- ✅ `ae.outcome` = `'bid_to'` or `'no_sale'`
- ✅ `ae.high_bid` = `89500`
- ✅ `ae.winning_bid` = `NULL`

### Expected Results for "Sold for $X" (SOLD)

- ✅ `v.sale_price` = `X`
- ✅ `ae.outcome` = `'sold'`
- ✅ `ae.high_bid` = `X` (or higher)
- ✅ `ae.winning_bid` = `X`
- ✅ `ae.winning_bidder` = buyer name

## Next Steps

1. **Re-extract vehicles with wrong sale_price** - The backfill queue will process these
2. **Monitor extraction logs** - Check for verification messages showing correct "Bid to" vs "Sold for" detection
3. **Verify outcomes** - Query `auction_events` to ensure outcomes match source data

## Verification Queries

### Find Vehicles with Wrong Sale Status

```sql
-- Vehicles marked as sold but should be "bid_to"
SELECT 
  v.id,
  v.year, v.make, v.model,
  v.sale_price,
  ae.outcome,
  ae.high_bid,
  LEFT(v.bat_auction_url, 60) as bat_url
FROM vehicles v
JOIN auction_events ae ON ae.vehicle_id = v.id
WHERE v.bat_auction_url ~* 'bringatrailer\.com'
  AND ae.outcome = 'sold'
  AND (v.sale_price IS NULL OR v.sale_price = 0)
  AND ae.high_bid IS NOT NULL;
```

### Find Vehicles Needing Re-extraction

```sql
-- Use the backfill function
SELECT * FROM queue_bat_backfill_vehicles(50, 75);
```

---

**Last Updated:** 2026-01-10  
**Status:** ✅ **FIXES DEPLOYED - VERIFICATION LOGGING ACTIVE**

