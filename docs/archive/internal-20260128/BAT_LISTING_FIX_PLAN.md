# BaT Listing Fix Plan

## Overview
This document outlines the plan to fix all problematic Bring a Trailer (BaT) listings identified by the diagnostic scripts.

## Issues Detected

### 1. **NO_IMAGES** - Vehicles with zero images
- **Cause**: Images weren't extracted or uploaded during import
- **Fix**: Re-run extraction using `extract-premium-auction` with BaT URL
- **Priority**: HIGH

### 2. **FEW_IMAGES** - Vehicles with ≤12 images
- **Cause**: Old import limit capped at 12 images
- **Fix**: Backfill remaining images using `backfill-images` function
- **Priority**: MEDIUM

### 3. **QUEUE_BADGES** - Images showing "Queue" badge instead of "BaT"
- **Cause**: Images stored with `import_queue` in storage_path instead of `bat_import` source
- **Fix**: Update `source` field to `bat_import` and fix storage_path
- **Priority**: MEDIUM (cosmetic but annoying)

### 4. **LOW_RES_IMAGES** - Images with resize/scaled parameters
- **Cause**: Images extracted with query parameters like `?w=800` or `-scaled.jpg`
- **Fix**: Re-extract images using high-res URL upgrade logic
- **Priority**: MEDIUM

### 5. **WRONG_SOURCE** - Images not marked as `bat_import`
- **Cause**: Images inserted with `external_import` source
- **Fix**: Update `source` field to `bat_import`
- **Priority**: LOW (cosmetic)

### 6. **MISSING_AUCTION_DATA** - No external_listings entry
- **Cause**: `extract-premium-auction` didn't create external_listings
- **Fix**: Re-run extraction or manually create external_listings
- **Priority**: HIGH (affects UI display)

### 7. **MISSING_CURRENT_BID** - Active auction without current_bid
- **Cause**: Extraction didn't capture current_bid or it wasn't stored
- **Fix**: Re-scrape listing and update external_listings
- **Priority**: HIGH (affects UI display)

### 8. **MISSING_END_DATE** - Active auction without end_date
- **Cause**: Extraction didn't capture auction_end_date
- **Fix**: Re-scrape listing and update external_listings
- **Priority**: HIGH (affects timer display)

## Tools Created

### 1. SQL Query: `scripts/find-shitty-bat-listings.sql`
Run in Supabase SQL Editor to get a complete list with all issue flags.

### 2. Node.js Script: `scripts/find-shitty-bat-listings.js`
```bash
cd /Users/skylar/nuke
node scripts/find-shitty-bat-listings.js
```

Outputs:
- `data/shitty-bat-listings.json` - Full detailed list
- `data/shitty-bat-listings.csv` - CSV for spreadsheet analysis
- Console summary with top 20 worst offenders

## Fix Strategy

### Phase 1: Critical Issues (NO_IMAGES, MISSING_AUCTION_DATA)
1. Run diagnostic script to get list
2. For each vehicle with NO_IMAGES:
   - Extract BaT URL from vehicle record
   - Call `extract-premium-auction` function with BaT URL
   - Verify images were inserted

3. For each vehicle with MISSING_AUCTION_DATA:
   - Extract BaT URL
   - Call `extract-premium-auction` function (creates external_listings)
   - Or manually create external_listings entry

### Phase 2: Image Quality Issues (FEW_IMAGES, LOW_RES_IMAGES)
1. For vehicles with FEW_IMAGES:
   - Check if origin_metadata has image_urls
   - Call `backfill-images` function with remaining URLs
   - Or re-extract using `extract-premium-auction`

2. For vehicles with LOW_RES_IMAGES:
   - Re-extract images using high-res URL upgrade
   - Delete old low-res images
   - Insert new high-res images

### Phase 3: Source/Badge Issues (QUEUE_BADGES, WRONG_SOURCE)
1. Create migration to update source field:
   ```sql
   UPDATE vehicle_images
   SET source = 'bat_import'
   WHERE vehicle_id IN (
     SELECT id FROM vehicles 
     WHERE listing_url LIKE '%bringatrailer.com%'
   )
   AND (
     storage_path LIKE '%import_queue%' OR
     source = 'external_import'
   )
   AND image_url LIKE '%bringatrailer.com%';
   ```

### Phase 4: Auction Data Issues (MISSING_CURRENT_BID, MISSING_END_DATE)
1. For active auctions:
   - Re-scrape using `extract-premium-auction`
   - Or use the monitoring sync path (`sync-active-auctions` → `sync-bat-listing`) if you only need live bid/end-date fields updated
   - Update external_listings with current_bid and end_date

## Automated Fix Script

Create a script that:
1. Reads `data/shitty-bat-listings.json`
2. Groups by issue type
3. Applies fixes in batches
4. Logs results
5. Re-runs diagnostic to verify fixes

## Monitoring

After fixes, re-run diagnostic script to:
- Verify issues are resolved
- Track improvement metrics
- Identify any new issues

## Notes

- The new `extract-premium-auction` function now:
  - Extracts high-res BaT images
  - Creates external_listings automatically
  - Sets source to `bat_import`
  - Stores current_bid and auction_end_date

- Old listings imported before these fixes will need manual remediation
- Consider creating a scheduled job to re-extract stale BaT listings

