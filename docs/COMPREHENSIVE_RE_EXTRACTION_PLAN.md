# Comprehensive Re-Extraction Plan
## Maximizing Data Quality for All 6,329 Incomplete Profiles

### Goals
1. **Maximum viable data** for all 6,329 incomplete profiles
2. **High confidence, high signal data** in correct database fields
3. **Unmapped data** preserved in `origin_metadata` backup
4. **Highest quality DOM extraction** - don't miss data
5. **Full-res images + downscaled variants** saved to reduce resizing
6. **Minimum viable data**: Year, Make, Model, Image, Location, Listing Date, Price

---

## Current State Analysis

### Incomplete Profiles Breakdown
- **Total**: 6,329 vehicles missing critical fields
- **48 vehicles**: Have mappable metadata (can extract without re-scraping)
- **898 vehicles**: Have URLs, need re-extraction
- **49 BaT vehicles**: Need extraction (786 already queued)
- **5 vehicles**: No URL/metadata (manual entry)

### Missing Data Fields
- **VIN**: 5,047 missing (79%)
- **Color**: 5,456 missing (85%)
- **Mileage**: 5,277 missing (83%)
- **Transmission**: 6,004 missing (94%)
- **Drivetrain**: 6,131 missing (96%)
- **Engine**: 6,198 missing (97%)
- **Price**: 1,587 missing (25%)

---

## Implementation Strategy

### Phase 1: Map Existing Metadata (48 vehicles)
**Status**: ✅ Script created (`scripts/map-metadata-to-columns.js`)

**Action**: Extract data from `origin_metadata` JSONB when available
- Color, mileage, transmission, drivetrain, engine
- Map to direct columns
- Preserve original in metadata

### Phase 2: Enhanced DOM Extraction

#### 2.1 BaT Extraction (`comprehensive-bat-extraction`)
**Current**: Good quality, but can improve:
- ✅ Full-res image extraction (via `batDomMap.ts`)
- ✅ Price extraction (handles RNM, active auctions)
- ✅ Location extraction
- ✅ Listing date extraction
- ⚠️ **Needs**: Downscaled image variants

#### 2.2 Craigslist Extraction (`scrape-all-craigslist-squarebodies`, `process-cl-queue`)
**Current**: Basic extraction
- ✅ Price normalization (handles "15" → "15000")
- ✅ Location extraction
- ✅ Posted date extraction
- ⚠️ **Needs**: 
  - Enhanced price extraction (trade, OBO, description prices)
  - Full-res image extraction (currently saves thumbnails)
  - Downscaled variants

#### 2.3 Generic Extraction (`process-import-queue`)
**Current**: Multi-source handler
- ✅ Handles various sources
- ⚠️ **Needs**: 
  - Source-specific DOM mapping
  - Enhanced price extraction
  - Full-res + variants

### Phase 3: Image Processing Enhancement

#### Requirements
1. **Full Resolution**: Always save original/highest available resolution
2. **Downscaled Variants**: Create during upload
   - Thumbnail: 150x150 (for lists)
   - Medium: 400px width (for cards)
   - Large: 800px width (for detail views)
   - Full: Original (for zoom/print)

#### Implementation
- Use Sharp (or similar) in Edge Functions
- Generate variants during image upload
- Store in `vehicle_images` table:
  - `image_url` (full-res)
  - `thumbnail_url` (150x150)
  - `medium_url` (400px)
  - `large_url` (800px)

### Phase 4: Price Extraction Enhancement

#### Price Complexity Handling

**1. Auctions (BaT, Mecum, etc.)**
- Active: `current_bid` (not `asking_price`)
- Sold: `sale_price`
- RNM: `high_bid` (not `sale_price`)
- Reserve: `reserve_price` (if disclosed)

**2. Craigslist Variations**
- Headline price: `$15,000`
- Description price: "Asking $15,000"
- Trade: "Trade for X" → `price_type: 'trade'`
- OBO: "$15,000 OBO" → `price_type: 'obo'`
- No price: `price_type: 'contact'`

**3. Database Schema**
```sql
-- Add price metadata
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_type TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_confidence INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS price_source TEXT;
```

**4. Extraction Logic**
- Try structured fields first (`.price` element)
- Fallback to title/description patterns
- Detect context (trade, OBO, auction)
- Store confidence score
- Preserve raw text in `origin_metadata`

### Phase 5: Location & Date Extraction

#### Location
- **Craigslist**: `.mapaddress` or title parentheses
- **BaT**: Seller location from listing
- **Other**: Extract from structured fields or description
- Store in `listing_location` column
- Preserve raw in `origin_metadata`

#### Listing Date
- **Craigslist**: `<time datetime>` attribute
- **BaT**: Auction start date
- **Other**: Extract from structured fields
- Store in `listing_date` or `discovery_date`
- Use for timeline events

---

## Execution Plan

### Step 1: Run Metadata Mapping
```bash
node scripts/map-metadata-to-columns.js
```
**Expected**: 48 vehicles updated

### Step 2: Queue Re-Extractions
```bash
node scripts/comprehensive-re-extraction-pipeline.js
```
**Expected**: 
- 49+ BaT vehicles queued
- 898 Craigslist vehicles queued
- 200+ other sources queued

### Step 3: Enhance Extraction Functions

#### 3.1 Enhance `comprehensive-bat-extraction`
- ✅ Already has good DOM extraction
- ⚠️ Add: Image variant generation
- ⚠️ Add: Enhanced price confidence scoring

#### 3.2 Enhance `scrape-all-craigslist-squarebodies`
- ⚠️ Add: Full-res image extraction (upgrade from thumbnails)
- ⚠️ Add: Enhanced price extraction (trade, OBO, description)
- ⚠️ Add: Image variant generation
- ⚠️ Add: Location extraction improvement

#### 3.3 Enhance `process-import-queue`
- ⚠️ Add: Source-specific DOM mapping
- ⚠️ Add: Image variant generation
- ⚠️ Add: Enhanced price extraction

### Step 4: Create Image Processing Service
**New Edge Function**: `process-image-variants`
- Downloads full-res image
- Generates variants (thumbnail, medium, large)
- Uploads all variants to storage
- Updates `vehicle_images` table

### Step 5: Monitor Progress
```bash
node scripts/analyze-incomplete-profiles.js
```
**Track**:
- Vehicles completed
- Data quality improvements
- Extraction success rates

---

## Success Metrics

### Data Completeness
- **Before**: 6,329 incomplete (79% missing VIN, 85% missing color)
- **Target**: < 1,000 incomplete (< 15% missing critical fields)

### Image Quality
- **Before**: Mixed resolutions, some thumbnails
- **Target**: 100% full-res + variants saved

### Price Accuracy
- **Before**: 25% missing, some incorrect (monthly payments)
- **Target**: 95%+ with correct price type (asking/sale/trade/OBO)

### Location Coverage
- **Before**: Inconsistent
- **Target**: 90%+ with location data

---

## Next Steps

1. ✅ Create analysis scripts
2. ✅ Create queueing scripts
3. ⚠️ Enhance extraction functions (in progress)
4. ⚠️ Create image variant processor
5. ⚠️ Deploy and monitor

---

## Notes

- **Confidence Scoring**: All extracted data should have confidence scores
- **Provenance**: Track source of each field (DOM extraction, AI, manual)
- **Backup**: Always preserve raw data in `origin_metadata`
- **Validation**: Validate extracted data before saving (price ranges, date formats, etc.)

