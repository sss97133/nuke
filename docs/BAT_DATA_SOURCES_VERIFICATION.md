# BaT Data Extraction Sources - Complete Verification

## Problem Statement

There are **multiple BaT extraction sources** in the codebase. We need to verify:
1. What data each source extracts
2. Where that data goes in the database
3. That the data flows correctly through all layers

## Data Sources Identified

### 1. `comprehensive-bat-extraction` Edge Function
**Location**: `supabase/functions/comprehensive-bat-extraction/index.ts`
**Purpose**: Comprehensive extraction of ALL BaT listing data
**When Used**: Primary extraction function for BaT listings

**Data Extracted**:
- ✅ VIN (from essentials div + AI fallback)
- ✅ Year, Make, Model, Trim (from title)
- ✅ Mileage (from essentials)
- ✅ Engine, Transmission, Drivetrain (from essentials)
- ✅ Color, Interior Color (from description/essentials)
- ✅ Description (from post-excerpt div)
- ✅ **Features/Equipment** (NEW - from "Equipment includes" text)
- ✅ Auction dates (start, end, sale)
- ✅ Sale price, reserve price
- ✅ Bid count, view count, watcher count, comment count
- ✅ Location, Seller, Buyer, Lot number
- ✅ Bid history
- ✅ Images (via batDomMap - uses data-gallery-items ONLY)

**Database Fields Populated**:
```
vehicles table:
- description → vehicles.description (TEXT)
- sale_date → vehicles.sale_date (DATE) - converted to YYYY-MM-DD
- auction_end_date → vehicles.auction_end_date (TIMESTAMPTZ) - converted to ISO
- sale_price → vehicles.sale_price
- bat_seller → vehicles.bat_seller
- bat_bids → vehicles.bat_bids
- bat_views → vehicles.bat_views
- bat_comments → vehicles.bat_comments (NEW)
- bat_location → vehicles.bat_location
- color → vehicles.color
- interior_color → vehicles.interior_color
- mileage → vehicles.mileage
- engine_size → vehicles.engine_size
- transmission → vehicles.transmission
- drivetrain → vehicles.drivetrain
- displacement → vehicles.displacement
- trim → vehicles.trim
- vin → vehicles.vin (updated separately due to trigger)
- year, make, model → vehicles.year, vehicles.make, vehicles.model
- origin_metadata.bat_features → origin_metadata.bat_features (JSONB array) (NEW)

external_listings table:
- All auction metrics, dates, prices, status
```

### 2. `import-bat-listing` Edge Function
**Location**: `supabase/functions/import-bat-listing/index.ts`
**Purpose**: Legacy import function using DOM map extraction
**When Used**: Older import path, uses batDomMap.ts

**Data Extracted**:
- Uses `batDomMap.ts` for structured extraction
- Images via `data-gallery-items` attribute (safe)
- Title, location, seller, buyer, dates from DOM
- **NOTE**: This function does NOT extract features separately - only description

**Database Fields Populated**:
- Similar to comprehensive-bat-extraction but uses DOM map
- Does NOT populate `origin_metadata.bat_features`
- Does populate `origin_metadata.image_urls`

### 3. `backfill-origin-vehicle-images` Edge Function
**Location**: `supabase/functions/backfill-origin-vehicle-images/index.ts`
**Purpose**: Backfills images from origin_metadata.image_urls
**When Used**: When vehicles have images in origin_metadata but no vehicle_images records

**Data Extracted**:
- Image URLs from `origin_metadata.image_urls`
- Filters BaT noise using `filterBatNoise` function

**Database Fields Populated**:
- `vehicle_images` table records
- Updates `vehicles.primary_image_url` if missing

### 4. `backfill-images` Edge Function
**Location**: `supabase/functions/backfill-images/index.ts`
**Purpose**: Downloads and stores images from URLs
**When Used**: When image URLs need to be downloaded and stored

**Database Fields Populated**:
- `vehicle_images` table records
- Sets `is_primary = true` for first image
- Updates `vehicles.primary_image_url` if missing (NEW)

## Verification: What Should Be Extracted from BaT Listing

Based on actual BaT listing structure (example: https://bringatrailer.com/listing/2008-tesla-roadster-54/):

### Description
**Source**: `<div class="post-excerpt">` contains full description
**Should Extract**: 
- Full paragraph text
- Preserve paragraph breaks
- Remove BaT footer noise ("This Tesla Roadster got away...")
**Database**: `vehicles.description` (TEXT)
**Status**: ✅ Fixed - improved extraction in comprehensive-bat-extraction

### Features/Equipment
**Source**: Text in description: "Equipment includes 16″ and 17″ forged aluminum wheels, a carbon-fiber hardtop, heated sport seats, an Alpine infotainment system, power windows, cruise control, and air conditioning."
**Should Extract**: 
- Split by commas and "and"
- Individual items: ["16″ and 17″ forged aluminum wheels", "carbon-fiber hardtop", "heated sport seats", etc.]
**Database**: `origin_metadata.bat_features` (JSONB array)
**Status**: ✅ Fixed - extractFeaturesAndEquipment function added

**Problem User Reported**: Features appeared concatenated: "Jet BlackBlack & Brown Leather Upholstery16" & 17" Forged Aluminum Wheels..."
**Root Cause**: Features weren't being extracted separately, description contained everything
**Solution**: Features now extracted separately and stored in origin_metadata.bat_features

### Dates
**Source**: "Sold for USD $51,000 on 12/17/25"
**Should Extract**:
- sale_date: 2025-12-17
- auction_end_date: 2025-12-17 (same as sale_date for ended auctions)
- auction_start_date: 2025-12-10 (calculated: end_date - 7 days)
**Database**: 
- `vehicles.sale_date` (DATE)
- `vehicles.auction_end_date` (TIMESTAMPTZ)
- `external_listings.start_date`, `end_date`, `sold_at` (TIMESTAMPTZ)
**Status**: ✅ Fixed - date extraction improved, proper type conversion

### Images
**Source**: `data-gallery-items` attribute (JSON array)
**Should Extract**: 
- Only images from the actual listing gallery
- NOT images from related auctions, podcast graphics, merch, etc.
**Database**: `vehicle_images` table
**Status**: ✅ Fixed - noise filtering added to batDomMap.ts

## Current Code Status

### ✅ FIXED: Image Filtering
- `batDomMap.ts`: Enhanced noise filtering in extractGalleryImagesFromHtml
- Filters: podcast, merch, winner-template, web-###- patterns, etc.
- Only uses `data-gallery-items` (no regex fallback)

### ✅ FIXED: Description Extraction
- `comprehensive-bat-extraction/index.ts`: Improved post-excerpt parsing
- Better HTML entity decoding
- Removes BaT footer noise
- Preserves paragraph structure

### ✅ FIXED: Features Extraction
- `extractFeaturesAndEquipment` function added
- Extracts from "Equipment includes" text
- Parses comma/and-separated lists
- Stores in `origin_metadata.bat_features`

### ✅ FIXED: Date Handling
- Proper DATE vs TIMESTAMPTZ conversion
- Handles "on 12/17/25" pattern
- Calculates start_date from end_date

### ✅ FIXED: Primary Image
- `backfill-images`: Sets primary_image_url after first upload
- `import-bat-listing`: Improved primary selection logic

### ✅ FIXED: Comment Count
- Now stored in `vehicles.bat_comments` field

## Data Flow Verification

```
BaT Listing HTML
    ↓
comprehensive-bat-extraction function
    ↓
Extract: description, features, dates, specs, metrics
    ↓
Store in vehicles table:
  - description → vehicles.description
  - features → origin_metadata.bat_features (NEW)
  - dates → vehicles.sale_date, vehicles.auction_end_date
  - specs → vehicles.color, vehicles.engine_size, etc.
  - metrics → vehicles.bat_bids, vehicles.bat_comments, etc.
    ↓
Store in external_listings table:
  - All auction data, dates, prices
    ↓
Images via batDomMap (filtered for noise)
    ↓
backfill-images function
    ↓
Store in vehicle_images table
    ↓
Set vehicles.primary_image_url if missing
```

## Remaining Questions

1. **Multiple extraction paths**: Should `import-bat-listing` also extract features? Currently only `comprehensive-bat-extraction` does.

2. **Features display in UI**: The user showed concatenated features in the UI. Need to verify:
   - Are features being displayed from `origin_metadata.bat_features`?
   - Or is the UI still showing description text?

3. **Historical data**: Existing vehicles with contaminated images/descriptions need to be:
   - Re-extracted using comprehensive-bat-extraction
   - Or cleaned up manually

## Next Steps for Verification

1. Test comprehensive-bat-extraction on a fresh BaT listing
2. Verify database fields are populated correctly
3. Check UI displays features from origin_metadata.bat_features (not description)
4. Verify images are filtered correctly (no noise)
5. Verify dates match auction timeline

