# Image Extraction Fixes - Cars & Bids & Other Platforms

**Date:** 2025-01-XX  
**Status:** ✅ Fixed and Deployed

## Problem Summary

1. **Wrong URLs being extracted**: System was capturing `/video` URLs instead of actual listing URLs
2. **Bad image quality**: Extracting thumbnails, video freeze frames, interior shots instead of full-resolution exterior photos
3. **Organization logos as vehicle images**: Dealer/organization logos appearing as vehicle primary images
4. **Missing gallery targeting**: Not specifically targeting the image gallery section on listing pages
5. **Incorrect source attribution**: Image sources not properly mapped to platforms

## Fixes Implemented

### 1. URL Extraction Fix ✅

**Problem:** Extracting `/auctions/ID/video` instead of `/auctions/ID/year-make-model`

**Solution:**
- Updated `extractCarsAndBidsListingUrls()` to prioritize `auction-link` class hrefs
- Prioritizes full listing URLs with `year-make-model` pattern
- Excludes `/video` URLs completely
- Strips `/video` suffix if it somehow gets through

**Location:** `supabase/functions/extract-premium-auction/index.ts`
- Lines: `extractCarsAndBidsListingUrls()` function
- Lines: `extractCarsAndBidsListingUrlsFromText()` function
- Lines: Direct listing URL cleanup in `extractCarsAndBids()`

### 2. Image Quality & Gallery Targeting ✅

**Problem:** Extracting thumbnails, video frames, wrong images

**Solution:**
- **Gallery Detection**: Now specifically targets gallery containers:
  - IDs/classes: `photo-gallery`, `image-gallery`, `photos-container`, `vehicle-photos`, `listing-gallery`
  - Data attributes: `data-gallery`, `data-photos`, `data-images`
  - Only extracts from gallery sections if found (200k char limit)
  
- **Image URL Upgrading**: 
  - Removes query params (resize, width, height)
  - Upgrades thumbnails: `-150x150`, `-thumb`, `-small` → full resolution
  - Prioritizes `data-full` → `data-src` → `data-original` → `src`

- **Noise Filtering**:
  - Excludes video thumbnails (`/video`, `/videos/`)
  - Excludes UI elements (`/icon`, `/logo`, `/button`, `/ui/`, `/assets/`)
  - Excludes interior/engine bay shots from primary position
  - Prioritizes exterior shots first

**Location:** `supabase/functions/extract-premium-auction/index.ts`
- Function: `extractCarsAndBidsImagesFromHtml()` (lines 116-305)
- Key functions: `upgradeToFullRes()`, `isVehicleImage()`

### 3. Organization Logo Filtering ✅

**Problem:** Organization/dealer logos appearing as vehicle images

**Solution:**
- **Frontend Filtering** (`VehicleProfile.tsx`):
  - Added `isOrganizationLogo()` helper function
  - Filters out: `organization-logos/`, `images.classic.com/uploads/dealer/`, any logo in storage paths
  - Primary image selection excludes organization logos
  - Fallback image pool excludes organization logos

- **Backend Filtering** (`extract-premium-auction`):
  - Filters organization logos at insertion time
  - Prevents org logos from being stored as vehicle images

**Location:**
- `nuke_frontend/src/pages/VehicleProfile.tsx` - `filterProfileImages()`, `isOrganizationLogo()`
- `supabase/functions/extract-premium-auction/index.ts` - `insertVehicleImages()`

### 4. Image Source Attribution ✅

**Problem:** Sources not properly mapped (BAT sometimes, Craigslist yes, others not sure)

**Solution:**
- Platform-specific source mapping based on listing URL:
  - **Bring a Trailer** → `bat_import`
  - **Cars & Bids** → `external_import`
  - **Craigslist** → `craigslist_scrape`
  - **KSL** → `ksl_scrape`
  - **PCarMarket** → `pcarmarket_listing`
  - **Mecum/Barrett-Jackson** → `external_import`

**Location:** `supabase/functions/extract-premium-auction/index.ts`
- Function: `insertVehicleImages()` (lines 1620-1728)
- Detection: Uses listing URL first (most reliable), falls back to source string

### 5. Database Matching Fix ✅

**Problem:** Trying to insert instead of update existing vehicles

**Solution:**
- Added check for existing vehicle by `discovery_url` before inserting
- Ensures vehicles are updated, not duplicated

**Location:** `supabase/functions/extract-premium-auction/index.ts`
- Function: `storeVehiclesInDatabase()` (lines 1119-1520)

## Testing & Verification

### What to Check:

1. **URLs are correct**: Listing URLs should be `/auctions/ID/year-make-model`, NOT `/video`
2. **Images are full-res**: No `-thumb`, `-small`, `-150x150` suffixes
3. **Exterior shots first**: Primary image should be exterior, not interior/engine bay
4. **No organization logos**: Vehicle images should not show dealer logos
5. **Source attribution**: Check `vehicle_images.source` column matches platform

### Database Queries to Verify:

```sql
-- Check for vehicles with /video URLs (should be 0)
SELECT COUNT(*) FROM vehicles 
WHERE platform_url LIKE '%/video%' OR discovery_url LIKE '%/video%';

-- Check for organization logos as primary images (should be 0)
SELECT COUNT(*) FROM vehicles v
JOIN vehicle_images vi ON vi.vehicle_id = v.id AND vi.is_primary = true
WHERE vi.image_url LIKE '%organization-logos%' 
   OR vi.image_url LIKE '%uploads/dealer/%';

-- Check image sources are correct
SELECT source, COUNT(*) 
FROM vehicle_images 
WHERE source IS NOT NULL
GROUP BY source
ORDER BY COUNT(*) DESC;
```

## Files Modified

1. `supabase/functions/extract-premium-auction/index.ts`
   - URL extraction fixes
   - Gallery detection improvements
   - Image quality upgrades
   - Source attribution mapping
   - Organization logo filtering

2. `nuke_frontend/src/pages/VehicleProfile.tsx`
   - Organization logo filtering
   - Primary image selection improvements

3. `scripts/fix-video-urls-in-db.js` (new)
   - Fixes existing vehicles with `/video` URLs

4. `scripts/fix-all-bad-images-homepage.js` (new)
   - Fixes bad primary images on homepage

## Deployment Status

✅ **extract-premium-auction** function deployed  
✅ Frontend changes merged  
✅ Database cleanup scripts available

## Verification Checklist

When checking if images are extracted correctly, verify:

✅ **URLs are correct**: Listing URLs should be `/auctions/ID/year-make-model`, NOT `/video`  
✅ **Images are full-res**: No `-thumb`, `-small`, `-150x150` suffixes in URLs  
✅ **Exterior shots first**: Primary image should be exterior, not interior/engine bay  
✅ **No organization logos**: Vehicle images should not show dealer logos  
✅ **Source attribution**: Check `vehicle_images.source` column matches platform  
✅ **Gallery images only**: Should extract from gallery section, not random page images

## Next Steps for Existing Data

Run these scripts to fix existing problematic listings:

```bash
# Fix vehicles with /video URLs
node scripts/fix-video-urls-in-db.js

# Fix bad primary images
node scripts/fix-all-bad-images-homepage.js

# Re-extract Cars & Bids listings with bad images
node scripts/fix-cars-and-bids-listings.js
```

## How to Test New Extractions

1. **Extract a new Cars & Bids listing**:
   ```bash
   # Call extract-premium-auction function with a listing URL
   ```

2. **Check the results**:
   - Verify `platform_url` is correct (no `/video`)
   - Check `vehicle_images` table - should have full-res images
   - Verify `primary_image_url` is an exterior shot
   - Check `source` column is `external_import` for Cars & Bids

3. **Verify on homepage**:
   - Vehicle card should show exterior photo
   - No organization logos
   - Image should be high quality (not pixelated)

## Notes for Future Reference

- **Always target gallery sections first** - Don't extract random images from page
- **Upgrade thumbnails to full-res** - Remove size suffixes and query params
- **Filter organization logos** - They belong in `organization_images`, not `vehicle_images`
- **Use listing URL for source detection** - More reliable than source string
- **Prioritize exterior shots** - Interior/engine bay shots should not be primary

