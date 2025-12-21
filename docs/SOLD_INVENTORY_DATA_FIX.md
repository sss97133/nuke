# Sold Inventory Data Fix

## Problem
The sold inventory table was showing lots of missing data (—) for fields like Trim, Engine, Drive, Miles, Sale Price, etc.

## Root Cause
1. Vehicle data wasn't being synced from BaT listings to vehicles table
2. Component was only checking vehicles table, not BaT listings data
3. BaT listings have data in `raw_data` JSONB field that wasn't being used

## Solution

### 1. Updated Component (`SoldInventoryBrowser.tsx`)
- Now fetches BaT listings data alongside vehicle data
- Merges data from multiple sources:
  - Primary: `vehicles` table
  - Fallback: `bat_listings.raw_data` JSONB
  - Also checks: `external_listings`, `sold_vehicle_proof`
- Extracts missing fields from BaT `raw_data`:
  - year, make, model, trim
  - engine_size, displacement, drivetrain
  - mileage, transmission
  - sale_price, sale_date

### 2. Created Backfill Function
- `backfill_vehicle_data_from_bat_listings()`
- Syncs missing vehicle fields from BaT listings
- Uses `raw_data` JSONB to extract specs
- Only updates NULL/empty fields (doesn't overwrite existing data)

## Usage

### Run Backfill:
```sql
SELECT * FROM backfill_vehicle_data_from_bat_listings();
```

This will:
- Find all sold BaT listings with linked vehicles
- Extract data from `raw_data` JSONB
- Update vehicles table where fields are missing
- Return list of updated vehicles and fields

### Component Now Shows:
- Data from vehicles table (if available)
- Fallback to BaT raw_data (if vehicle field is empty)
- Sale price from multiple sources (org_vehicles, vehicles, bat_listings, external_listings)
- Sale date from multiple sources
- Platform detection (bat, external_listings, proof)

## Result
The sold inventory table should now show:
- ✅ Trim (from BaT raw_data if missing in vehicles)
- ✅ Engine (from BaT raw_data if missing)
- ✅ Drive/Drivetrain (from BaT raw_data if missing)
- ✅ Miles/Mileage (from BaT raw_data if missing)
- ✅ Sale Price (from bat_listings.sale_price or final_bid)
- ✅ Sale Date (from bat_listings.sale_date)
- ✅ Platform (detected from BaT listings)

