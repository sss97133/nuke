# INGESTION FIXES APPLIED

**Date:** December 25, 2025  
**Issue:** User reported "ingestions seems to have failed?"

---

## 🔍 DIAGNOSIS RESULTS

### Issues Found:

1. **Stuck Processing Items**: 100+ items stuck in "processing" state for hours/days
   - Items were locked but never completed
   - Blocked new items from being processed

2. **BaT Parsing Failures**: Many Bring a Trailer listings failing with "Junk identity detected"
   - Error: `year=2003 make=Bring model=a Trailer`
   - HTML title parsing was extracting "Bring a Trailer" instead of vehicle data
   - URL parsing didn't handle all URL patterns

3. **Non-Vehicle Listings**: BaT listings for accessories/parts being processed as vehicles
   - Examples: "windshield", "sign", "statue", "arcade game"
   - These should be skipped, not processed

4. **Missing Motorcycle Makes**: Harley-Davidson, Yamaha, etc. not recognized as valid makes

---

## ✅ FIXES APPLIED

### 1. Unlocked Stuck Items
- **Action**: Ran `scripts/fix-ingestion.js` which unlocked 100 stuck items
- **Result**: Items reset to "pending" status, ready for reprocessing

### 2. Improved BaT URL Parsing
**File**: `supabase/functions/process-import-queue/index.ts`

- **Before**: Only matched pattern `/listing/YEAR-MAKE-MODEL-ID/`
- **After**: Also matches `/listing/YEAR-MAKE-MODEL/` (without numeric ID)
- **Impact**: Handles URLs like `/listing/2003-harley-davidson-electra-glide-classic/`

```typescript
// Now handles both patterns:
// /listing/1992-chevrolet-454-ss-14/ (with ID)
// /listing/2003-harley-davidson-electra-glide-classic/ (without ID)
```

### 3. Fixed HTML Title Parsing
**File**: `supabase/functions/process-import-queue/index.ts`

- **Before**: Extracted "Bring a Trailer" from page titles
- **After**: Removes "| Bring a Trailer" suffix before parsing
- **Impact**: Correctly extracts vehicle make/model from titles

```typescript
// Removes BaT suffixes:
title = title.replace(/\s*\|\s*Bring\s+a\s*Trailer.*$/i, '');
title = title.replace(/\s*on\s*BaT\s*Auctions?.*$/i, '');
```

### 4. Added Non-Vehicle Detection
**File**: `supabase/functions/process-import-queue/index.ts`

- **Action**: Skip processing for non-vehicle listings
- **Keywords**: windshield, sign, statue, arcade, kiddie, ride, illuminated
- **Impact**: Prevents junk data from entering the database

### 5. Added Motorcycle Makes
**File**: `supabase/functions/process-import-queue/index.ts`

- **Added**: Harley-Davidson, Yamaha, Ducati, Kawasaki, Indian, Triumph
- **Impact**: Motorcycle listings now recognized as valid vehicles

---

## 📊 CURRENT STATUS

After fixes:
- **Pending**: 346 items
- **Processing**: 392 items (recently unlocked)
- **Failed**: 4,082 items (many are old BaT failures that can be retried)

---

## 🚀 NEXT STEPS

1. **Monitor Queue Processing**
   - Run `node scripts/diagnose-ingestion.js` to check status
   - Verify items are being processed successfully

2. **Retry Failed Items** (Optional)
   - Many failed items are from before the fixes
   - Can reset failed items to "pending" to retry:
   ```sql
   UPDATE import_queue
   SET status = 'pending', attempts = 0, next_attempt_at = NOW()
   WHERE status = 'failed'
     AND listing_url LIKE '%bringatrailer.com%'
     AND error_message LIKE '%Junk identity%'
     AND created_at > NOW() - INTERVAL '7 days';
   ```

3. **Check Cron Job**
   - Verify `process-import-queue` cron is running every 5 minutes
   - Check Supabase Dashboard → Database → Cron Jobs

4. **Monitor Edge Function Logs**
   - Check for any new errors in `process-import-queue` logs
   - Verify BaT listings are now parsing correctly

---

## 🛠️ TOOLS CREATED

1. **`scripts/diagnose-ingestion.js`**
   - Comprehensive diagnostic script
   - Shows queue status, failures, stuck items, source health

2. **`scripts/fix-ingestion.js`**
   - Automated fix script
   - Unlocks stuck items
   - Triggers manual processing

---

## 📝 NOTES

- The fixes are backward compatible
- Existing failed items can be retried after fixes
- New BaT listings should now parse correctly
- Non-vehicle listings will be skipped automatically

