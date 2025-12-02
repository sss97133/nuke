# Comment-Based Self-Healing System

## The Problem

When a trusted user (dealer, organization member) posts a BAT URL in comments, the vehicle profile should automatically enrich itself with:
- Images from the BAT listing
- Missing specs (engine, transmission, mileage, color)
- Seller/buyer information

**Previous Behavior:**
- BAT URL processing ONLY triggered when submitting NEW comments
- Existing comments with BAT URLs were NEVER processed
- If the initial processing failed, the data was never enriched

**Result:** The vehicle profile `3f1791fe-4fe2-4994-b6fe-b137ffa57370` had a BAT URL comment but remained empty (0 images, missing specs).

## The Fix

Added automatic BAT URL detection for **existing comments** when the comments section loads.

### Changes Made

**File:** `nuke_frontend/src/components/VehicleComments.tsx`

1. **Added `checkExistingCommentsForBATUrls()` function** (Line ~290)
   - Checks if vehicle already has images (avoid redundant scraping)
   - Scans existing comments for BAT URLs
   - Verifies commenter is trusted (dealer, organization member)
   - Processes BAT URL automatically

2. **Integrated into `loadAllComments()`** (Line ~160)
   - Calls `checkExistingCommentsForBATUrls()` after loading comments
   - Non-blocking (doesn't slow down comment loading)

### Trust Requirements

**Trusted Users** (who can trigger self-healing):
- Users with `user_type` = 'dealer'
- Users with `user_type` = 'organization'
- Users with active organization affiliations (`organization_contributors`)

**Non-Trusted Users:**
- Regular users (no org affiliations)
- Users without dealer/organization status

### Workflow

```
1. User views vehicle profile
   ↓
2. Comments load
   ↓
3. System scans existing comments for BAT URLs
   ↓
4. Finds BAT URL: https://bringatrailer.com/listing/1976-chevrolet-c20-pickup-5/
   ↓
5. Checks if commenter is trusted
   ↓
6. Commenter is trusted (dealer/org member)
   ↓
7. Checks if vehicle has images
   ↓
8. Vehicle has 0 images → proceed with enrichment
   ↓
9. Scrapes BAT listing
   ↓
10. Validates VIN match (strict - never mixes data)
   ↓
11. Fills missing fields (engine, transmission, mileage, color)
   ↓
12. Downloads images
   ↓
13. Updates vehicle record
   ↓
14. Self-healing complete ✅
```

### Safety Mechanisms

1. **VIN Validation (Strict)**
   - If VINs don't match → REJECT enrichment
   - Never mixes data from different vehicles

2. **Rate Limiting**
   - Only processes if vehicle has 0 images
   - Avoids redundant scraping

3. **Trust Requirements**
   - Only trusted users can trigger self-healing
   - Prevents spam/abuse

4. **Existing Data Protection**
   - Only fills NULL/empty fields
   - Never overwrites user-entered data

## Testing

### Test Case 1: Empty BAT Profile (Your Profile)
**Vehicle:** `3f1791fe-4fe2-4994-b6fe-b137ffa57370`
- Has BAT URL comment: ✅
- Commenter is trusted: ✅ (skylar williams - organization member)
- Vehicle has 0 images: ✅

**Expected Result:**
1. View vehicle profile
2. Comments load
3. System detects BAT URL in existing comment
4. Verifies commenter is trusted
5. Triggers BAT URL processing
6. Scrapes listing, fills data, downloads images
7. Profile is now enriched

**How to Test:**
1. Open: https://n-zero.dev/vehicle/3f1791fe-4fe2-4994-b6fe-b137ffa57370
2. Open browser console (Cmd+Option+J)
3. Look for logs:
   - `[VehicleComments] Found BAT URL in existing comment`
   - `[VehicleComments] Trusted user detected, processing BAT URL`
   - `[VehicleComments] Scraping BAT listing...`
4. Wait 10-30 seconds for processing
5. Refresh page to see enriched data

### Test Case 2: Non-Trusted User
**Scenario:** Regular user posts BAT URL

**Expected Result:**
- BAT URL detected
- User not trusted → Skip processing
- No enrichment happens

### Test Case 3: Vehicle Already Has Images
**Scenario:** Trusted user posts BAT URL on vehicle with images

**Expected Result:**
- BAT URL detected
- Vehicle already has images → Skip processing
- No redundant scraping

## Deployment

```bash
cd /Users/skylar/nuke/nuke_frontend
vercel --prod --force --yes
```

## Monitoring

**Console Logs to Watch:**
- `[VehicleComments] Found BAT URL in existing comment` - BAT URL detected
- `[VehicleComments] Trusted user detected, processing BAT URL` - Trusted user verified
- `[VehicleComments] User not trusted, skipping BAT URL processing` - Non-trusted user
- `[VehicleComments] Vehicle already has images, skipping BAT URL processing` - Rate limiting
- `[VehicleComments] Scraping BAT listing...` - Processing started
- `[VehicleComments] Self-healing complete` - Success

**Database Changes to Verify:**
```sql
-- Check if vehicle was enriched
SELECT 
  id,
  year,
  make,
  model,
  engine_size,
  transmission,
  mileage,
  color,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = vehicles.id) as image_count
FROM vehicles
WHERE id = '3f1791fe-4fe2-4994-b6fe-b137ffa57370'
```

## Next Steps

1. ✅ **Implement comment-based self-healing** - DONE
2. ⏳ **Deploy to production** - READY
3. ⏳ **Test on live profile** - WAITING
4. ⏳ **Verify enrichment works** - WAITING
5. ⏳ **Monitor for edge cases** - WAITING

## Related Files

- `nuke_frontend/src/components/VehicleComments.tsx` - Comment component with self-healing
- `supabase/functions/scrape-vehicle/index.ts` - BAT scraping edge function
- `docs/SELF_HEALING_WORKFLOW.md` - Original self-healing workflow docs
- `docs/SELF_HEALING_IMPLEMENTATION.md` - Self-healing service implementation

