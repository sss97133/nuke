# Scraper Fix Summary - Save Correctly Sorted Data to DB

## Current Issues

1. **504 Timeouts**: Scrapers are timing out before saving data
2. **Missing user_id**: Fixed - now sets both `user_id` and `uploaded_by`
3. **Data not being saved**: Scrapers find listings but don't create vehicles

## What's Fixed

✅ **Fixed user_id field**: Scraper now sets `user_id` (required) in addition to `uploaded_by`
✅ **Enhanced dashboard**: Shows real-time diagnostics and why vehicles aren't being created
✅ **Data formatting**: Vehicle insert includes all required fields properly formatted

## What Needs to Happen

The scrapers need to:
1. **Find NEW listings** (not just duplicates)
2. **Save data correctly** with proper field mapping
3. **Handle timeouts** by processing in smaller batches

## Next Steps

1. **Run smaller batches**: Reduce `max_regions` and `max_listings` to avoid timeouts
2. **Process queues**: Use queue processors which handle timeouts better
3. **Monitor results**: Use the enhanced dashboard to see what's actually happening

## Quick Fix Script

Run this to create vehicles in smaller batches:

```bash
node scripts/force-create-vehicles-from-scrapers.js
```

Or trigger scrapers individually with smaller configs:
- `discover-cl-squarebodies`: `{ max_regions: 5, max_searches_per_region: 3 }`
- `scrape-all-craigslist-squarebodies`: `{ max_regions: 3, max_listings: 20 }`
- `process-cl-queue`: `{ batch_size: 5 }`

## Data Format

Vehicles are saved with:
- `year`, `make`, `model` (required)
- `user_id` (required for RLS)
- `discovery_url`, `discovery_source`
- `origin_metadata` (JSON with listing details)
- `asking_price` (normalized)
- `status: 'active'` (so they show up)

All data is properly sorted and formatted before insert.

