# BaT Extraction Field Mapping

This document verifies that extracted BaT data is correctly stored in the appropriate database fields.

## Database Schema → Extraction Mapping

### Vehicles Table - Direct Columns

| Database Column | Type | Source Field | Conversion Notes |
|----------------|------|--------------|------------------|
| `description` | TEXT | `extractedData.description` | Stored as-is (extracted from post-excerpt) |
| `sale_date` | DATE | `extractedData.sale_date` | Must be YYYY-MM-DD format (verified in code) |
| `auction_end_date` | TIMESTAMPTZ | `extractedData.auction_end_date` | Converted to ISO timestamp (midday UTC if date-only) |
| `sale_price` | NUMERIC(10,2) | `extractedData.sale_price` | Stored as number |
| `bat_seller` | TEXT | `extractedData.seller` | Stored as string |
| `bat_bids` | INTEGER | `extractedData.bid_count` | Stored as integer |
| `bat_comments` | INTEGER | `extractedData.comment_count` | Stored as integer |
| `bat_views` | INTEGER | `extractedData.view_count` | Stored as integer |
| `bat_location` | TEXT | `extractedData.location` (normalized) | Stored as cleaned location |
| `bat_auction_url` | TEXT | `batUrl` | Always set to the BaT listing URL |
| `color` | TEXT | `extractedData.color` | Exterior color |
| `interior_color` | TEXT | `extractedData.interior_color` | Interior color |
| `mileage` | INTEGER | `extractedData.mileage` | Stored as integer |
| `engine_size` | TEXT | `extractedData.engine` | Engine description |
| `transmission` | TEXT | `extractedData.transmission` | Transmission type |
| `drivetrain` | TEXT | `extractedData.drivetrain` | Drivetrain type |
| `displacement` | TEXT | `extractedData.displacement` | Engine displacement |
| `trim` | TEXT | `extractedData.trim` | Vehicle trim level |
| `vin` | TEXT | `extractedData.vin` | Updated separately (due to trigger constraints) |
| `year` | INTEGER | `extractedData.year` | Stored as integer |
| `make` | TEXT | `extractedData.make` | Stored as string |
| `model` | TEXT | `extractedData.model` | Stored as string |
| `listing_location` | TEXT | `extractedData.location` (normalized) | Cleaned location |
| `listing_location_raw` | TEXT | `extractedData.location` (raw) | Original location text |
| `listing_location_observed_at` | TIMESTAMPTZ | `extractedData.auction_start_date` | ISO timestamp |
| `listing_location_source` | TEXT | `'bat'` | Always 'bat' for BaT imports |
| `listing_location_confidence` | REAL | `0.7` | Fixed confidence score |

### Vehicles Table - JSONB Fields

| JSONB Path | Source Field | Notes |
|------------|--------------|-------|
| `origin_metadata.bat_features` | `extractedData.features` | Array of feature strings (NEW) |
| `origin_metadata` (existing fields preserved) | Various | Merged with existing metadata |

### External Listings Table

| Database Column | Type | Source Field | Conversion Notes |
|----------------|------|--------------|------------------|
| `start_date` | TIMESTAMPTZ | `extractedData.auction_start_date` | Converted to ISO timestamp |
| `end_date` | TIMESTAMPTZ | `extractedData.auction_end_date` | Converted to ISO timestamp |
| `sold_at` | TIMESTAMPTZ | `extractedData.sale_date` | Converted to ISO timestamp (if not RNM) |
| `final_price` | NUMERIC | `extractedData.sale_price` | Stored if not reserve_not_met |
| `current_bid` | NUMERIC | `extractedData.high_bid` or `sale_price` | RNM uses high_bid, otherwise sale_price |
| `reserve_price` | NUMERIC | `extractedData.reserve_price` | Stored if available |
| `bid_count` | INTEGER | `extractedData.bid_count` | Stored as integer |
| `view_count` | INTEGER | `extractedData.view_count` | Stored as integer |
| `watcher_count` | INTEGER | `extractedData.watcher_count` | Stored as integer |
| `comment_count` | INTEGER | `extractedData.comment_count` | Stored as integer |
| `listing_status` | TEXT | Calculated | 'sold', 'reserve_not_met', or 'ended' |
| `metadata` | JSONB | Various fields | Contains lot_number, seller, buyer, technical_specs, etc. |

## Verification Queries

### Check Description is Stored
```sql
SELECT id, year, make, model, description 
FROM vehicles 
WHERE bat_auction_url IS NOT NULL 
  AND description IS NULL 
LIMIT 10;
```

### Check Features in Metadata
```sql
SELECT id, year, make, model, 
       origin_metadata->'bat_features' as features
FROM vehicles 
WHERE origin_metadata->'bat_features' IS NOT NULL
LIMIT 10;
```

### Check Dates are Stored Correctly
```sql
SELECT id, year, make, model,
       sale_date, 
       auction_end_date,
       bat_auction_url
FROM vehicles
WHERE bat_auction_url IS NOT NULL
  AND (sale_date IS NULL OR auction_end_date IS NULL)
LIMIT 10;
```

### Check Comment Count
```sql
SELECT id, year, make, model,
       bat_comments,
       bat_bids,
       bat_views
FROM vehicles
WHERE bat_auction_url IS NOT NULL
  AND bat_comments IS NULL
LIMIT 10;
```

## Extraction Function Location

All extraction logic is in:
- `supabase/functions/comprehensive-bat-extraction/index.ts`
- Image filtering: `supabase/functions/_shared/batDomMap.ts`
- Vehicle update logic: Lines 1624-1707 of comprehensive-bat-extraction

## Key Improvements Made

1. **Image Filtering**: Enhanced noise filtering in `batDomMap.ts` to prevent non-vehicle images
2. **Description Extraction**: Improved parsing that preserves structure and removes BaT footer noise
3. **Features Extraction**: New function extracts features/equipment and stores in `origin_metadata.bat_features`
4. **Date Handling**: Proper conversion for DATE (sale_date) and TIMESTAMPTZ (auction_end_date) columns
5. **Comment Count**: Now properly stored in `bat_comments` field
6. **Primary Image**: Robust fallback logic ensures vehicles always have a primary image

