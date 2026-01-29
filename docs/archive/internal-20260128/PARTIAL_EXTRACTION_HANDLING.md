# Partial Extraction Handling - How to Fix It

**Status:** ✅ Fixed - Now validates extraction completeness

---

## 🎯 The Problem

The 2-part extractor is solid, BUT:

1. **No validation after extraction** - Items marked "complete" even if:
   - Images weren't extracted (0 images)
   - Images extracted but not stored
   - Critical fields missing (VIN, specs)

2. **Partial extractions marked as complete** - 67% have no images, 43% missing engine

3. **No retry mechanism** - Once marked "complete", never retries

---

## ✅ What I Fixed

### **1. Added Validation After Extraction**

The queue processor now:
- ✅ Checks if images were actually stored (not just extracted)
- ✅ Checks if critical data exists (VIN or specs)
- ✅ Verifies extraction quality from response

### **2. Partial Extraction Detection**

**Before (Bad):**
```typescript
// Mark as complete if function returns success (even if partial)
await supabase.update({ status: 'complete' });
```

**After (Good):**
```typescript
// Validate actual data stored
const hasImages = (imageCount || 0) > 0;
const hasCriticalData = hasVin || hasSpecs;
const isPartial = !hasImages || !hasCriticalData;

if (isPartial) {
  // Retry instead of marking complete
  await supabase.update({ 
    status: 'pending',
    next_attempt_at: retryTime 
  });
} else {
  // Only mark complete if actually complete
  await supabase.update({ status: 'complete' });
}
```

### **3. Retry Logic for Partial Extractions**

- **Partial extraction** → Reset to `pending` with exponential backoff
- **Max attempts reached** → Mark as `failed` (for manual review)
- **Complete extraction** → Mark as `complete` ✅

---

## 🔧 What Happens with Partial Extractions

### **Scenario 1: Images Not Extracted**
```
1. extract-premium-auction runs → Returns success
2. But: 0 images found in HTML
3. Validation: hasImages = false
4. Result: Marked as "partial" → Retry later
```

### **Scenario 2: Images Extracted But Not Stored**
```
1. extract-premium-auction runs → Returns success, says "50 images extracted"
2. But: insertVehicleImages fails or returns 0 stored
3. Validation: extractionSaidImages = true, imagesActuallyStored = false
4. Result: Marked as "partial" → Retry later (may be storage issue)
```

### **Scenario 3: Missing Critical Data**
```
1. extract-premium-auction runs → Returns success
2. But: No VIN, no specs extracted
3. Validation: hasCriticalData = false
4. Result: Marked as "partial" → Retry later
```

### **Scenario 4: Complete Extraction**
```
1. extract-premium-auction runs → Returns success
2. Images: 50 extracted and stored ✅
3. Data: VIN + specs extracted ✅
4. Validation: hasImages = true, hasCriticalData = true
5. Result: Marked as "complete" ✅
```

---

## 🔍 How to Check Partial Extractions

### **SQL Query:**
```sql
-- Find partial extractions (marked complete but missing data)
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  q.bat_url,
  CASE WHEN v.vin IS NULL OR v.vin = '' THEN '❌' ELSE '✅' END as has_vin,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  CASE 
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN '❌ NO IMAGES'
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10 THEN '⚠️ FEW IMAGES'
    ELSE '✅'
  END as images_status
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (
    (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0
    OR (v.vin IS NULL OR v.vin = '')
  )
ORDER BY (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) ASC
LIMIT 50;
```

### **Re-Queue Partial Extractions:**
```sql
-- Reset partial extractions to pending for retry
UPDATE bat_extraction_queue q
SET 
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  next_attempt_at = NULL
FROM vehicles v
WHERE q.vehicle_id = v.id
  AND q.status = 'complete'
  AND (
    (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0
    OR ((v.vin IS NULL OR v.vin = '') AND v.mileage IS NULL AND v.color IS NULL)
  );
```

---

## 🚀 How to Fix Existing Partial Extractions

### **Option 1: Re-Queue and Re-Extract**

Reset partial extractions to pending:
```sql
-- Run in Supabase SQL Editor
UPDATE bat_extraction_queue q
SET status = 'pending', attempts = 0, error_message = NULL
FROM vehicles v
WHERE q.vehicle_id = v.id
  AND q.status = 'complete'
  AND (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0;
```

Then run the queue processor:
```bash
node scripts/process-bat-queue-manual.js 20 10  # Process 200 items
```

### **Option 2: Manual Re-Extraction**

For specific vehicles:
```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/1969-chevrolet-camaro-519/", "max_vehicles": 1}'
```

---

## 📊 Expected Behavior After Fix

**Before Fix:**
- Extraction returns success → Marked "complete" ❌
- 67% have no images but marked complete ❌
- No retry for partial data ❌

**After Fix:**
- Extraction returns success → **Validate actual data** ✅
- If missing images/data → Marked "partial" → **Retry with backoff** ✅
- Only mark "complete" if actually complete ✅

---

## ⚠️ Why Images Aren't Being Extracted

Possible reasons:
1. **HTML structure changed** - `data-gallery-items` attribute moved/renamed
2. **JavaScript rendering required** - BaT may load images via JS (need Firecrawl)
3. **Timeout during extraction** - Images extraction times out before completing
4. **Filtering too aggressive** - Images extracted but filtered out incorrectly

**To investigate:**
- Check Edge Function logs: `supabase functions logs extract-premium-auction --tail`
- Look for: "Extracted X images" vs "No images to insert"
- Test one URL manually to see what's extracted

---

## ✅ Next Steps

1. **Test the fix** - Process a few items and verify validation works
2. **Check extraction logs** - See why images aren't being extracted
3. **Re-queue partial extractions** - Reset the 67% with no images
4. **Improve image extraction** - Add fallbacks if needed

The validation is now in place - partial extractions will be caught and retried instead of being marked complete!

