# Backfill Vehicle Origins and Merge Duplicates

## Overview

This script addresses core backend logic to prevent duplicate vehicle issues by:

1. **Finding vehicles with poor origin tracking** - vehicles marked as `manual_entry` with no `uploaded_by` or empty `origin_metadata`
2. **Matching to BAT listings** - uses year/make/model to find corresponding Bring a Trailer listings
3. **Updating origin data** - backfills proper `profile_origin`, `bat_auction_url`, and `origin_metadata`
4. **Merging duplicates** - detects and merges duplicate vehicle profiles automatically

## Why This Matters

The user identified that vehicles created through automated processes (like bulk imports) weren't properly tracked, leading to:
- Duplicate vehicle profiles
- Missing origin metadata
- Inability to trace where vehicles came from
- Poor data quality

This script fixes these issues by connecting orphaned vehicles to their source (BAT listings) and consolidating duplicates.

## How It Works

### Step 1: Find Vehicles Needing Backfill
Queries for vehicles with:
- `profile_origin = 'manual_entry'` or `NULL`
- `uploaded_by = NULL` and `user_id = NULL`
- Empty or missing `origin_metadata`

### Step 2: Load BAT Listings
Builds a lookup map of all vehicles with BAT URLs, indexed by `year|make|model` for fast matching.

### Step 3: Match Vehicles to BAT
For each vehicle needing backfill:
- Exact match on year/make/model
- Fuzzy match on model name (handles variations like "Blazer" vs "K5 Blazer")
- Prefers matches from Viva Las Vegas Autos listings

### Step 4: Detect Duplicates
For each vehicle, finds other vehicles with:
- Same year/make/model
- Different VINs (or one has fake VIN like `VIVA-...`)
- Calculates completeness score to determine which to keep

### Step 5: Merge or Update
- **If BAT match found and it's a different vehicle**: Merges current vehicle into BAT vehicle (if BAT is better) or updates current with BAT data
- **If duplicates found**: Merges less complete vehicle into more complete one
- **If no match**: Marks as `bulk_import_legacy` if part of a batch (5+ vehicles created within 5 minutes)

## Running the Script

```bash
cd /Users/skylar/nuke
node scripts/backfill-vehicle-origins-and-merge.js
```

## What Gets Merged

When merging vehicles, the script:
1. **Moves all data** from merged vehicle to kept vehicle:
   - Images (`vehicle_images`)
   - Timeline events (`timeline_events`)
   - Organization links (`organization_vehicles`)
2. **Combines metadata**:
   - Prefers real VIN over fake VIN
   - Combines `origin_metadata` with merge tracking
   - Keeps best `bat_auction_url` and `discovery_url`
3. **Deletes merged vehicle** after data is moved

## Safety Features

- **VIN validation**: Never merges vehicles with different real VINs
- **Completeness scoring**: Always keeps the more complete vehicle
- **Batch detection**: Identifies bulk imports by creation timestamp clustering
- **Dry-run capability**: Can be modified to preview changes before applying

## Expected Output

```
🔍 BACKFILLING VEHICLE ORIGINS AND MERGING DUPLICATES...

📋 Finding vehicles with poor origin tracking...
   Found 26 vehicles needing backfill

📋 Loading BAT listings for matching...
   Loaded 150 unique BAT vehicle patterns from 200 vehicles

🔍 Processing: 1974 Chevrolet Blazer (59743025...)
   ✅ Matched to BAT: https://bringatrailer.com/listing/...
   📝 Updating vehicle with BAT data...

🔍 Processing: 1972 Ford Bronco (abc12345...)
   🔍 Found 1 potential duplicate(s)
   🔀 Merging duplicate: 1972 Ford Bronco
   ✅ Merged successfully

================================================================================
📊 BACKFILL SUMMARY:
   Vehicles processed: 26
   Matched to BAT: 18
   Merged duplicates: 5
   Updated origin: 23
   Skipped: 3
================================================================================
```

## Next Steps

After running this script:
1. Verify origin data is properly populated
2. Check for any remaining duplicates
3. Update automation scripts to set origin data at creation time
4. Consider running periodically to catch new orphaned vehicles

