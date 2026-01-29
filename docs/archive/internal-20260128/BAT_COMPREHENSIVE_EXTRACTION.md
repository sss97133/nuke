# BaT Comprehensive Data Extraction

## Overview
The `extract-premium-auction` function now extracts **ALL** data from BaT listings and stores it comprehensively in the database.

## Data Extraction Schema

### Vehicle Identification
- ✅ **VIN** - From BaT Essentials section
- ✅ **Year, Make, Model, Trim** - From title parsing
- ✅ **Lot Number** - From URL or Essentials

### Technical Specifications
- ✅ **Mileage** - Odometer reading
- ✅ **Color** - Exterior color
- ✅ **Interior Color** - Upholstery
- ✅ **Transmission** - Type (e.g., "Five-Speed Manual")
- ✅ **Drivetrain** - RWD, AWD, 4WD, FWD
- ✅ **Engine Size** - Description (e.g., "3.5-Liter V6")
- ✅ **Displacement** - Engine displacement (e.g., "3.5L")
- ✅ **Fuel Type** - Gas, Diesel, Electric, etc.
- ✅ **Body Style** - Roadster, Coupe, Sedan, etc.

### Auction Data
- ✅ **Current Bid** - For active auctions
- ✅ **High Bid** - Highest bid (for ended auctions)
- ✅ **Final Bid** - Winning bid amount
- ✅ **Sale Price** - Final sale price
- ✅ **Reserve Price** - If disclosed
- ✅ **Reserve Met** - Boolean
- ✅ **Bid Count** - Total number of bids
- ✅ **View Count** - Number of views
- ✅ **Watcher Count** - Number of watchers
- ✅ **Comment Count** - Number of comments
- ✅ **Auction Start Date** - When auction started
- ✅ **Auction End Date** - When auction ends/ended
- ✅ **Sale Date** - When vehicle sold

### Location & Parties
- ✅ **Location** - Vehicle location (city, state)
- ✅ **Seller** - Seller name/username
- ✅ **Seller Username** - BaT username
- ✅ **Buyer** - Buyer name/username (if sold)
- ✅ **Buyer Username** - BaT username (if sold)

### Content
- ✅ **Title** - Full listing title
- ✅ **Description** - Full listing description
- ✅ **Features** - Array of features/equipment

### Images
- ✅ **ALL Images** - Extracted from `data-gallery-items` JSON
- ✅ **High Resolution** - Upgraded URLs (removes resize params, -scaled suffixes)
- ✅ **Prioritizes Full/Original** - Uses `full` or `original` URLs from gallery
- ✅ **No Limit** - Extracts all images (up to 50+ per listing)

## Database Storage

### `vehicles` Table
All core vehicle data is stored:
- `year`, `make`, `model`, `trim`, `vin`
- `mileage`, `color`, `interior_color`
- `transmission`, `engine_size`, `drivetrain`, `displacement`, `fuel_type`, `body_style`
- `sale_price`, `asking_price`, `current_bid`, `bid_count`
- `auction_end_date`, `sale_date`
- `bat_seller`, `bat_location`, `bat_bids`, `bat_views`, `bat_comments`
- `description`, `listing_url`, `listing_title`

### `external_listings` Table
Comprehensive auction data:
- `platform: 'bat'`
- `listing_url`, `listing_id` (lot number)
- `listing_status` (active, ended, sold, reserve_not_met)
- `start_date`, `end_date`, `sold_at`
- `current_bid`, `final_price`, `reserve_price`
- `bid_count`, `view_count`, `watcher_count`
- `metadata` (JSONB) with:
  - `lot_number`, `seller`, `seller_username`, `buyer`, `buyer_username`
  - `location`, `comment_count`, `reserve_met`, `features`
  - `auction_start_date`, `auction_end_date`, `sale_date`

### `vehicle_images` Table
All images stored with:
- `source: 'bat_import'` (correct badge)
- `image_url` - Full-resolution URL
- `is_primary` - First image marked as primary
- `position` - Display order
- `exif_data` - Source metadata

### `extraction_metadata` Table
Raw listing description stored with provenance:
- `field_name: 'raw_listing_description'`
- `field_value` - Full description text
- `source_url` - BaT listing URL
- `extraction_method: 'extract-premium-auction'`

## Extraction Process

1. **Firecrawl Structured Extraction**
   - Uses comprehensive schema to extract all fields
   - Waits 5 seconds for gallery to load
   - Gets both structured data and HTML

2. **HTML Gallery Extraction**
   - Extracts from `data-gallery-items` JSON
   - Prioritizes `full` or `original` URLs
   - Upgrades all URLs to highest resolution

3. **Data Merging**
   - Combines Firecrawl extraction with HTML gallery
   - Preserves all fields comprehensively
   - Handles missing data gracefully

4. **Database Storage**
   - Upserts vehicle (by VIN if available)
   - Creates/updates external_listings
   - Inserts all images with correct source
   - Stores raw description in extraction_metadata

## Verification

The fix script (`fix-shitty-bat-listings.js`) will:
1. Re-extract all problematic listings
2. Get fresh high-res images from source
3. Extract ALL data comprehensively
4. Store everything in the correct tables
5. Fix source badges and image quality

## Result

Every BaT listing will have:
- ✅ All images (full-resolution, properly sourced)
- ✅ All vehicle specs (complete technical data)
- ✅ All auction data (bids, dates, status, metrics)
- ✅ All metadata (seller, buyer, location, features)
- ✅ Proper database relationships (vehicles, external_listings, images)

