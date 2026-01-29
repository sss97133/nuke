# Cars & Bids Missing Data Backfill

## Problem Summary

Many Cars & Bids profiles have missing or incomplete data:

1. **Missing Vehicle Fields**: Many profiles have NULL values for:
   - Mileage
   - Color
   - Transmission
   - Engine Size
   - Drivetrain

2. **Low Image Counts**: Profiles only have 9-10 images when listings show 40-250+ images:
   - Example: Listing says "All Photos (84)" but only 9 images stored
   - Example: Listing says "All Photos (122)" but only 9 images stored

3. **Low Comment Counts**: Profiles have 0-5 comments when listings show 20-400+ comments:
   - Example: Listing says "Comments 47" but 0 extracted
   - Example: Listing says "Comments 431" but only 20 extracted

4. **Missing Auction Metadata**: Some profiles are missing bid_count, view_count, and other auction data

## Root Causes

1. **Image Extraction**: The `extractCarsAndBidsImagesFromHtml()` function may not be finding all images in `__NEXT_DATA__` structure
2. **Comments Extraction**: The `extract-cars-and-bids-comments` function may not be extracting all comments (especially paginated ones)
3. **Field Extraction**: LLM extraction may not be finding all fields in some listings
4. **Image Storage**: Images are extracted into metadata but may not all be passed to `insertVehicleImages()`

## Solution: Backfill Script

Run the backfill script to re-extract missing data:

```bash
# Dry run first (shows what would be extracted)
node scripts/backfill-cars-and-bids-data.js --limit=10 --dry-run

# Actually backfill (starts with 10 profiles)
node scripts/backfill-cars-and-bids-data.js --limit=10

# Backfill more profiles
node scripts/backfill-cars-and-bids-data.js --limit=50
```

## What the Script Does

1. **Finds Profiles with Missing Data**:
   - Missing vehicle fields (mileage, color, transmission, engine, drivetrain)
   - Low image counts (< 20 images)
   - Low comment counts (< 5 comments)

2. **Re-extracts Data**:
   - Calls `extract-premium-auction` Edge Function to re-extract core vehicle data
   - Calls `extract-cars-and-bids-comments` Edge Function to extract all comments
   - Images are automatically extracted and stored by `extract-premium-auction`

3. **Updates Database**:
   - Updates vehicle records with missing fields
   - Adds missing images to `vehicle_images` table
   - Adds missing comments to `auction_comments` table

## Next Steps

1. **Run Backfill**: Start with a small limit (10-20 profiles) to test
2. **Monitor Results**: Check if re-extraction finds more images/comments
3. **Fix Extraction Functions**: If backfill shows improvement, the issue may be in initial extraction
4. **Investigate Image Extraction**: If images still missing, may need to enhance `extractCarsAndBidsImagesFromHtml()` to better parse `__NEXT_DATA__`

## Database Function

A helper function `find_cars_and_bids_missing_data()` has been created to identify profiles with missing data:

```sql
SELECT * FROM find_cars_and_bids_missing_data(50);
```

## Manual Re-extraction

You can also manually re-extract a single profile:

```bash
# Extract core data
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://carsandbids.com/auctions/EXAMPLE/2023-ferrari-roma",
    "site_type": "carsandbids",
    "max_vehicles": 1,
    "debug": true
  }'

# Extract comments
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-cars-and-bids-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auction_url": "https://carsandbids.com/auctions/EXAMPLE/2023-ferrari-roma",
    "vehicle_id": "VEHICLE_ID_HERE"
  }'
```

## Status

- ✅ Backfill script created: `scripts/backfill-cars-and-bids-data.js`
- ✅ Database function created: `find_cars_and_bids_missing_data()`
- ⏳ Ready for testing and execution
- ⏳ Extraction functions may need enhancement if backfill shows same issues

