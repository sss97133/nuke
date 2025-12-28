# Cars & Bids Video URL Issue - Root Cause Analysis

## Problem Summary

Vehicles are being created with `/video` URLs instead of proper listing URLs, resulting in:
- Low-quality thumbnail images (Vimeo CDN thumbnails, 80px wide)
- Missing proper vehicle photos
- Poor data quality

## Root Cause

### 1. URL Discovery Phase

The scraper discovers listing URLs from the Cars & Bids index page. The discovery functions (`extractCarsAndBidsListingUrls` and `extractCarsAndBidsListingUrlsFromText`) **do** filter out `/video` URLs:

```typescript
// Line 2013: Exclude /video URLs
if (path.includes('/video')) continue;
```

**However**, the issue occurs when:
- The scraper is given a direct `/video` URL as input (not discovered from index)
- OR the URL pattern matching misses some edge cases
- OR the URL gets through before the filtering happens

### 2. URL Cleaning in Extraction

In `extractCarsAndBids()` function (line 1198), there IS cleaning:
```typescript
const cleanListingUrl = listingUrl.replace(/\/video\/?$/, '');
```

But this cleaned URL is stored in `vehicle.listing_url`, while `discovery_url` might still use the original URL.

### 3. Vehicle Storage

In `storeVehiclesInDatabase()` (line 1416-1426):
```typescript
let listingUrl = vehicle.listing_url || vehicle.platform_url || vehicle.url || null;
// CRITICAL: Reject /video URLs - these are not actual listing pages
if (listingUrl && (listingUrl.includes('/video') || listingUrl.endsWith('/video'))) {
  console.warn(`⚠️ Rejecting /video URL: ${listingUrl}`);
  errors.push(`Rejected /video URL: ${listingUrl}`);
  continue;
}
```

**The problem**: This rejection happens, but if the vehicle was already created with a video URL in `discovery_url` (line 1475), the vehicle still gets created with the bad URL.

### 4. Image Extraction from Video Pages

When scraping a `/video` page:
- The page contains Vimeo video embeds
- Image extraction finds Vimeo CDN thumbnail URLs like: `https://i.vimeocdn.com/video/...?mw=80&q=85`
- These are 80px wide thumbnails, not full-resolution vehicle photos
- The scraper doesn't detect these as low-quality thumbnails

## Evidence from Database

Looking at vehicle `61e457a7-c52e-46ed-bd7e-24d8b7a9912e`:
- `discovery_url`: `https://carsandbids.com/auctions/307oqG4p/video` ❌
- `origin_metadata`: `{"import_date":"2025-12-26","discovery_url":"https://carsandbids.com/auctions/307oqG4p/video","import_source":"cars & bids"}`
- Images: 2 Vimeo thumbnails (80px wide)
- Created: `2025-12-26 04:16:05`

There's a better duplicate: `91a585e3-62f3-443b-8338-01ec5f08997a` with proper URL:
- `discovery_url`: `https://carsandbids.com/auctions/307oqG4p/1981-toyota-land-cruiser` ✅

## What Went Wrong

1. **URL Discovery**: The scraper found or was given `/video` URLs instead of proper listing URLs
2. **Incomplete Filtering**: The video URL filtering didn't catch all cases
3. **Image Extraction**: When scraping video pages, only Vimeo thumbnails were found
4. **No Quality Check**: The system didn't detect that 80px thumbnails are too small

## Fixes Needed

### Immediate Fix (Cleanup)
- ✅ Created `scripts/cleanup-video-thumbnail-vehicles.js` to merge/delete problematic vehicles

### Code Fixes Needed

1. **Strengthen URL Filtering** (Line 1418-1426 in `extract-premium-auction/index.ts`):
   - Make the `/video` rejection more aggressive
   - Also check `discovery_url` field, not just `listing_url`

2. **Improve Image Quality Detection**:
   - Detect Vimeo CDN URLs with `mw=80` or `mw=100` parameters
   - Reject thumbnails smaller than 200px
   - Prefer full-resolution images from `media.carsandbids.com`

3. **URL Normalization**:
   - When a `/video` URL is detected, automatically convert to listing URL
   - Pattern: `/auctions/ID/video` → `/auctions/ID/year-make-model`
   - This requires fetching the actual listing page to get the proper URL

4. **Pre-creation Validation**:
   - Before creating a vehicle, validate the URL is a proper listing page
   - Check image quality before storing
   - Reject vehicles with only thumbnail images

## Timeline

- **2025-12-26 04:16:05**: Vehicle created with video URL
- **2025-12-26**: Multiple vehicles created with same issue (21 total found)
- **Current**: Cleanup script ready, code fixes needed

