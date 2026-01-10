# Fantasy Junction Data Fix Summary

## Current Status
- **Total Fantasy Junction vehicles: 381** (via organization relationship)
- **Website inventory: 21 vehicles** (already scraped)
- **BaT listings: ~360 vehicles** (from BaT profile extraction)

## Data Quality Issues
Based on audit:
- Missing VIN: ~80% (from BaT listings)
- Missing trim: ~95%
- Missing drivetrain: ~80% (though some have it)
- Missing mileage: ~50%

## Root Cause
Fantasy Junction vehicles from BaT were imported via `extract-premium-auction` but the extraction is incomplete/insistent. The Edge Function approach is timing out when called in parallel.

## Recommended Solution

Since the existing `backfill-all-missing-data.js` script is already working for BaT vehicles, we should:

1. **Use existing backfill script** - It processes BaT vehicles successfully
2. **Run it specifically for Fantasy Junction vehicles** - Filter by org relationship
3. **Run in smaller batches** - Process 20-30 at a time to avoid timeouts

## Quick Fix Command

```bash
# Use the existing backfill script but filter to Fantasy Junction vehicles
# The script will automatically find vehicles with missing data and fix them
node scripts/backfill-all-missing-data.js
```

The backfill script already:
- ✅ Scores vehicles by missing data
- ✅ Uses extract-premium-auction (which works when called sequentially)
- ✅ Extracts comments/bids
- ✅ Handles errors gracefully

## Alternative: Direct Database Updates

If Edge Functions continue to fail, we can:
1. Query BaT listings directly to extract missing fields
2. Update vehicles in database directly
3. Use URL parsing for trim/drivetrain where possible
