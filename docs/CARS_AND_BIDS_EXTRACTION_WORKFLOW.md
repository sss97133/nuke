# ✅ Cars & Bids Extraction Workflow - REMAPPED

**⚠️ CRITICAL: This is the NEW workflow for Cars & Bids extraction (similar to BaT).**

**Last Updated:** 2026-01-08  
**Status:** 🔄 REMAPPING IN PROGRESS

## ⚠️ FOR ALL LLMs: READ THIS FIRST

Cars & Bids extraction has been **remapped** to follow BaT's proven two-step pattern:
1. **LLM Inspection Agent** - Analyzes page structure to identify available data
2. **Two-Step Extraction** - Core data first, then comments/bids separately
3. **Live Auction Monitoring** - `sync-active-auctions` monitors active listings every 15 minutes

## 📋 Context from Recent Function Migration

**BaT Extraction Migration** (2026-01-09):
- ✅ All functions migrated to approved two-step workflow
- ✅ Deprecated functions return 410 Gone
- ✅ Pattern: `extract-premium-auction` (core data) + `extract-auction-comments` (comments/bids)

**Live Auction Monitoring**:
- ✅ `sync-active-auctions` runs every 15 minutes (cron job)
- ✅ Calls platform-specific sync functions: `sync-bat-listing`, `sync-cars-and-bids-listing`
- ✅ Updates `external_listings` table with: `current_bid`, `bid_count`, `end_date`, `listing_status`
- ✅ Frontend subscribes to `external_listings` changes via Supabase realtime (auction pulse)
- ✅ UI automatically updates when bids change (no page refresh needed)

**Cars & Bids Status**:
- ✅ `sync-cars-and-bids-listing` function exists and is called by `sync-active-auctions`
- ✅ `storeVehiclesInDatabase` creates `external_listings` records for Cars & Bids vehicles
- ❌ Missing: Comments extraction function (like BaT's `extract-auction-comments`)
- ❌ Missing: 100+ images not being extracted (only getting 9 images)

## 🎯 The Problem with Current Approach

**Current Issues:**
- Only extracting 9 images when 100+ are available
- Missing comments and bids (they require JavaScript rendering)
- Not properly extracting structured sections (Doug's Take, Highlights, Equipment)
- CDN thumbnail URLs not being upgraded to full-res

**Root Cause:**
- Cars & Bids uses Next.js with JavaScript-rendered content
- Images are in `__NEXT_DATA__` JSON but not being fully extracted
- Comments/bids require Firecrawl JavaScript rendering (like BaT)
- CDN path parameters (`/cdn-cgi/image/width=80,height=80/...`) need cleaning

## ✅ NEW TWO-STEP WORKFLOW (SIMILAR TO BAT)

### Step 0: LLM Inspection (NEW)

**Function**: `inspectCarsAndBidsPage` (in `inspect-cars-and-bids.ts`)  
**What it does**:
- Uses LLM to analyze Cars & Bids page structure
- Identifies where images are located (__NEXT_DATA__ path)
- Identifies how comments/bids are loaded (DOM selectors, pagination)
- Maps structured sections (Doug's Take, Highlights, Equipment)
- Returns extraction strategy and location map

**Output**:
```json
{
  "strategy": {
    "extraction_strategy": "parse_next_data",
    "requires_javascript": true
  },
  "image_extraction": {
    "method": "next_data_gallery",
    "next_data_path": "props.pageProps.auction.images",
    "expected_count": 100,
    "upgrade_thumbnails": true
  },
  "comment_extraction": {
    "method": "dom_selector",
    "requires_javascript": true,
    "estimated_count": 50
  },
  ...
}
```

### Step 1: Extract Core Vehicle Data

**Function**: `extract-premium-auction` (site_type: `carsandbids`)  
**What it does**:
- Uses LLM inspector to analyze page structure first
- Extracts VIN, mileage, color, transmission, engine from structured sections
- Extracts **ALL images** from `__NEXT_DATA__` (100+ images)
- Cleans CDN URLs to full-res (removes `width=80,height=80` params)
- Extracts structured sections (Doug's Take, Highlights, Equipment)
- Stores vehicle data in `vehicles` table
- Stores images in `vehicle_images` table

**How to call**:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://carsandbids.com/auctions/rNMN1gx5/2023-ferrari-roma",
    "site_type": "carsandbids",
    "max_vehicles": 1,
    "debug": true
  }'
```

**Expected output**:
```json
{
  "success": true,
  "vehicles_extracted": 1,
  "vehicles_created": 1,
  "debug": {
    "images_count": 120,
    "structured_sections": {
      "dougs_take": "...",
      "highlights": [...],
      "equipment": [...]
    }
  }
}
```

### Step 2: Extract Comments and Bids

**Function**: `extract-cars-and-bids-comments` (NEW - to be created, similar to BaT's `extract-auction-comments`)  
**What it does**:
- Uses Firecrawl to render JavaScript (REQUIRED for Cars & Bids comments)
- Extracts ALL comments from comments section (50+ comments expected)
- Extracts bid history (may be mixed with comments or separate)
- Links bids to bidders
- Stores comments in `auction_comments` table
- Stores bids in appropriate table
- Updates `external_listings` with comment/bid counts

**Pattern**: Follow the exact same structure as `extract-auction-comments/index.ts` but for Cars & Bids DOM structure

**How to call**:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-cars-and-bids-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "listing_url": "https://carsandbids.com/auctions/rNMN1gx5/2023-ferrari-roma",
    "vehicle_id": "e41d1883-e1c5-4418-a094-42cf31c31472"
  }'
```

**Expected output**:
```json
{
  "success": true,
  "comments_extracted": 45,
  "bids_extracted": 12,
  "bidders_extracted": 8
}
```

## 🔧 Implementation Changes

### 1. Enhanced Image Extraction

**Current**: Only extracting 9 images from thumbnails  
**Fixed**: 
- Extract ALL images from `__NEXT_DATA__ -> props.pageProps.auction.images`
- Clean CDN URLs: `/cdn-cgi/image/width=80,height=80/...` -> `/cdn-cgi/image/...` (full-res)
- Expected: 100+ images per listing

**Code Changes**:
- Updated `cleanImageUrl()` to handle Cars & Bids CDN path parameters
- Enhanced `extractCarsAndBidsImagesFromHtml()` to prioritize `__NEXT_DATA__` extraction
- Fixed `insertVehicleImages()` to not filter out properly cleaned URLs

### 2. LLM Inspection Agent

**New**: `inspectCarsAndBidsPage()` function  
**Purpose**: 
- Analyze page structure before extraction
- Identify where each data type is located
- Return extraction strategy and location map

**Integration**:
- Called at start of `extractCarsAndBids()` function
- Results used to guide extraction methods
- Logs inspection results for debugging

### 3. Separate Comments/Bids Extractor

**New**: `extract-cars-and-bids-comments` Edge Function  
**Pattern**: Similar to `extract-auction-comments` for BaT  
**Requirements**:
- Firecrawl for JavaScript rendering (Cars & Bids comments are dynamic)
- DOM parsing to extract comments
- Bid parsing (may be mixed with comments)
- External identity linking (bidder usernames -> external_identities)

## 📊 Expected Results

### After Step 1 (Core Data):
- ✅ VIN, Mileage, Color, Transmission, Engine extracted
- ✅ **100+ images** stored in `vehicle_images` (not just 9)
- ✅ Structured sections extracted (Doug's Take, Highlights, Equipment)
- ✅ Auction metadata (current bid, reserve status, end date)

### After Step 2 (Comments/Bids):
- ✅ **50+ comments** stored in `auction_comments`
- ✅ **12+ bids** extracted with amounts and timestamps
- ✅ **8+ bidders** linked via `external_identities`
- ✅ Comment/bid counts updated in `external_listings`

## 🚀 Complete Workflow Script

```bash
#!/bin/bash

# Configuration
CARS_AND_BIDS_URL="https://carsandbids.com/auctions/rNMN1gx5/2023-ferrari-roma"
SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

echo "🚀 Step 0: Inspecting Cars & Bids page structure..."
# (Inspection happens automatically in extract-premium-auction)

echo "🚀 Step 1: Extracting core vehicle data..."
EXTRACTION_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${CARS_AND_BIDS_URL}\", \"site_type\": \"carsandbids\", \"max_vehicles\": 1, \"debug\": true}")

echo "Extraction result:"
echo "$EXTRACTION_RESULT" | jq '.'

# Extract vehicle_id from result
VEHICLE_ID=$(echo "$EXTRACTION_RESULT" | jq -r '.created_vehicle_ids[0] // .updated_vehicle_ids[0] // empty')

if [ -z "$VEHICLE_ID" ]; then
  echo "❌ Failed to get vehicle_id from extraction"
  exit 1
fi

echo ""
echo "✅ Vehicle ID: $VEHICLE_ID"
echo ""

echo "🚀 Step 2: Extracting comments and bids..."
COMMENT_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-cars-and-bids-comments" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"listing_url\": \"${CARS_AND_BIDS_URL}\", \"vehicle_id\": \"${VEHICLE_ID}\"}")

echo "Comment extraction result:"
echo "$COMMENT_RESULT" | jq '.'

echo ""
echo "✅ Complete! Vehicle extracted with all data."
```

## 🔄 Step 3: Live Auction Monitoring (Already Working)

**Function**: `sync-active-auctions` (cron: every 15 minutes)  
**What it does**:
- Finds active Cars & Bids listings in `external_listings` table
- Calls `sync-cars-and-bids-listing` for each listing
- Updates `current_bid`, `bid_count`, `end_date`, `listing_status`
- Frontend automatically updates via Supabase realtime subscription

**Current Status**:
- ✅ `sync-cars-and-bids-listing` function exists
- ✅ Called by `sync-active-auctions` every 15 minutes
- ✅ Updates `external_listings` table properly
- ⚠️ Uses simple HTML regex (no Firecrawl) - may miss some data

**Enhancement Needed**:
- Consider using Firecrawl for better data extraction (like BaT)
- Extract end_date from `__NEXT_DATA__` instead of regex patterns

## ✅ Next Steps

1. **✅ Create LLM Inspector** - `inspect-cars-and-bids.ts` (DONE)
2. **🔄 Integrate Inspector** - Update `extract-premium-auction` to use inspector first
3. **⏳ Fix Image Extraction** - Ensure 100+ images from `__NEXT_DATA__` are extracted
4. **⏳ Create Comments Extractor** - `extract-cars-and-bids-comments` function (like BaT's)
5. **⏳ Enhance Sync Function** - Use Firecrawl/LLM for better `sync-cars-and-bids-listing` data
6. **⏳ Test Complete Workflow** - Test on the Ferrari Roma listing
7. **⏳ Update Cron Jobs** - Ensure `cars-and-bids-15m` calls both functions

## 🔗 Integration with Existing System

### Live Auction Monitoring (Already Working)

Cars & Bids vehicles are already monitored for live auction updates:

```sql
-- sync-active-auctions cron runs every 15 minutes
-- It queries external_listings where:
--   platform = 'cars_and_bids' OR 'carsandbids'
--   listing_status = 'active'
--   last_synced_at < NOW() - 15 minutes

-- Then calls sync-cars-and-bids-listing for each active listing
```

**Frontend Integration**:
- `VehicleProfile.tsx` subscribes to `external_listings` changes
- When `current_bid` or `end_date` updates, UI automatically refreshes
- Auction pulse shows live bid and countdown timer

**This means**: Cars & Bids vehicles ARE being monitored, but:
- Initial extraction is incomplete (missing images, comments)
- Sync function could be improved (use Firecrawl/LLM for better data)

---

**Last Updated**: 2026-01-08  
**Status**: 🔄 REMAPPING IN PROGRESS  
**Target**: Match BaT extraction quality (100+ images, 50+ comments, complete data)
**Live Monitoring**: ✅ Already working (every 15 minutes via sync-active-auctions)

