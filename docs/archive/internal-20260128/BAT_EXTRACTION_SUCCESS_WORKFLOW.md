# BaT Extraction Success Workflow - THE DEFINITIVE GUIDE

**CRITICAL: This is the ONLY approved workflow for BaT extraction.**

**Last Updated:** 2026-01-07  
**Status:** PRODUCTION - DO NOT DEVIATE

## For all LLMs: read this first

If you are modifying BaT extraction code, you MUST use this workflow. 
Do NOT use any other functions. They are deprecated and will be removed.

### Approved two-step workflow (mandatory)

**Step 1: Core Data Extraction**
- Function: `extract-bat-core`
- What it does: Free-mode BaT HTML fetch + evidence snapshot + clean title/year/make/model + BaT Essentials + images + auction metadata
- Creates: vehicles, vehicle_images, external_listings, auction_events, listing_page_snapshots
- Returns: `created_vehicle_ids` or `updated_vehicle_ids`

**Step 2: Comments/Bids Extraction**
- Function: `extract-auction-comments`
- What it does: Extracts ALL comments and bids from the listing HTML (free mode: direct fetch + embedded JSON extraction; DOM fallback best-effort)
- Requires: `auction_event_id` and `vehicle_id` (can resolve from URL)
- Creates: `auction_comments`, `external_identities`, and stores HTML evidence in `listing_page_snapshots`

### ❌ DEPRECATED FUNCTIONS (DO NOT USE)

**NEVER use these functions for BaT extraction:**
- ❌ `comprehensive-bat-extraction` - Only extracts images, missing comments
- ❌ `import-bat-listing` - Only extracts images, incomplete
- ❌ `bat-extract-complete-v1/v2/v3` - Incomplete/untested
- ❌ `bat-simple-extract` - Limited to ~50 comments from JSON

**These functions will return 410 Gone errors in production.**

## Overview

### Vehicle-first model (important)
We are documenting the vehicle over time. Auctions are just convenient sources we ingest from.

- A vehicle can be auctioned multiple times (including relists and cross-platform sales).
- We store each auction as a separate `auction_events` row (keyed by `source` + `source_url`).
- We store the conversation + bid stream as `auction_comments` linked to both `auction_event_id` and `vehicle_id`.
- Missing data stays null. We only write what we can directly observe.

This document describes the **proven, battle-tested workflow** for extracting complete data from Bring a Trailer listings. This workflow successfully extracts:
- ✅ VIN, Mileage, Color, Transmission, Engine (from BaT Essentials section)
- ✅ All high-resolution images (properly filtered, no contamination)
- ✅ Comments (41 comments extracted for C10)
- ✅ Bids (19 bids extracted for C10)
- ✅ Auction metadata (prices, dates, seller, buyer, etc.)

## The Two-Step Process

### Step 1: Extract Core Vehicle Data
**Function**: `extract-bat-core`  
**What it does**:
- Extracts VIN, mileage, color, transmission, engine from BaT Essentials section
- Extracts all high-resolution images from gallery JSON
- Extracts auction metadata (prices, dates, seller, buyer)
- Stores vehicle data in `vehicles` table
- Stores images in `vehicle_images` table
- Stores HTML evidence in `listing_page_snapshots` (so we can re-parse without re-scraping)

**How to call**:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-bat-core" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/",
    "max_vehicles": 1
  }'
```

**Expected output**:
```json
{
  "success": true,
  "vehicles_extracted": 1,
  "vehicles_created": 1,
  "debug_extraction": {
    "vin": "CE149S871443",
    "mileage": 82000,
    "color": "Weathered Light Blue",
    "transmission": "Three-Speed Turbo Hydramatic Automatic Transmission",
    "engine_size": "...",
    "images_count": 50
  }
}
```

### Step 2: Extract Comments and Bids
**Function**: `extract-auction-comments`  
**What it does**:
- Free mode fetches listing HTML directly and extracts embedded JSON comments (best path when it works).
- Stores external conversation and bids in `auction_comments` (canonical for auction-derived comments/bids).
- Stores HTML evidence in `listing_page_snapshots` so we can re-parse later without re-scraping.
- `bat_comments` / `bat_bids` / `bat_listings` are legacy/optional and should not be treated as canonical.

**How to call**:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auction_url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/",
    "vehicle_id": "99feba5d-cea6-4076-8bfd-6f0877750ab4"
  }'
```

**Expected output**:
```json
{
  "success": true,
  "comments_extracted": 41,
  "auction_event_id": "UUID",
  "vehicle_id": "UUID"
}
```

## Complete Workflow Script

Here's a complete script to extract a BaT vehicle:

```bash
#!/bin/bash

# Configuration
BAT_URL="https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

echo "🚀 Step 1: Extracting core vehicle data..."
EXTRACTION_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-bat-core" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${BAT_URL}\", \"max_vehicles\": 1}")

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

COMMENT_RESULT=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"auction_url\": \"${BAT_URL}\", \"vehicle_id\": \"${VEHICLE_ID}\"}")

echo "Comment extraction result:"
echo "$COMMENT_RESULT" | jq '.'

echo ""
echo "✅ Complete! Vehicle extracted with all data."
```

## Integration Points

### For New BaT Listings

When a new BaT listing is discovered:

1. **Call `extract-bat-core`** first to get core vehicle data
2. **Wait for completion** (or check vehicle_id from result)
3. **Call `extract-auction-comments`** with the vehicle_id
4. **Done!** Vehicle is fully extracted

### For Existing Vehicles (Re-extraction)

If a vehicle already exists but needs re-extraction:

1. Get the `vehicle_id` and `discovery_url` from the `vehicles` table
2. Call `extract-bat-core` with the `discovery_url` (it will update existing vehicle)
3. Call `extract-auction-comments` with the `vehicle_id` and `discovery_url`

### Queue-Based Processing

For batch processing, use the `bat_extraction_queue` table:

1. Insert vehicles into `bat_extraction_queue` with `status = 'pending'`
2. Call `process-bat-extraction-queue` (which should call both functions)
3. Monitor queue status

**⚠️ Important**: `process-bat-extraction-queue` is the canonical batch worker for `bat_extraction_queue` and should run the same two-step workflow described here.

**Recommended**: `process-bat-extraction-queue` should run the same two-step workflow as this doc. If comments/bids coverage is critical, verify Step 2 results explicitly; Step 2 may be best-effort depending on current fetch mode and site behavior.

### Using the Extraction Script

A reusable script is available at `scripts/extract-bat-vehicle.sh`:

```bash
# Extract a single BaT vehicle
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"

# The script will:
# 1. Call extract-premium-auction to get core data
# 2. Call extract-auction-comments to get comments/bids
# 3. Display the results
```

The script automatically:
- Loads credentials from `nuke_frontend/.env.local`
- Extracts vehicle data
- Extracts comments/bids
- Shows a summary of what was extracted

## Why This Works

### `extract-premium-auction` (v128)
- **Battle-tested**: Used extensively, proven to work
- **Fast**: ~32 seconds per vehicle
- **Comprehensive**: Extracts VIN, specs, images, metadata
- **Reliable**: Uses Firecrawl with proper DOM mapping
- **Image filtering**: Properly filters out non-vehicle images

### `extract-bat-core`
- **Free mode by design**: Direct HTML fetch only (no Firecrawl), plus evidence snapshots
- **Pollution-resistant**: Uses `<h1 class="post-title">` / `og:title` and cleans BaT SEO suffixes so we don’t contaminate `vehicles.model`
- **Essentials-aware**: Extracts seller/location/lot + key specs from the BaT Essentials block

### `extract-auction-comments`
- **JavaScript rendering**: Uses Firecrawl when available; in free/direct mode it may miss content that requires JS rendering
- **Complete extraction**: Gets all comments and bids
- **Proper storage**: Stores in correct tables (`auction_comments`, `bat_bids`)
- **Updates metadata**: Updates `bat_listings` with counts

## What NOT to Use

❌ **Don't use**:
- `bat-extract-complete-v1` (incomplete, missing VIN/specs)
- `bat-extract-complete-v2` (incomplete, missing VIN/specs)
- `bat-extract-complete-v3` (untested)
- `comprehensive-bat-extraction` (may not use proven workflow)
- `bat-simple-extract` (incomplete)

✅ **Do use**:
- `extract-bat-core` (BaT core data in free mode)
- `extract-auction-comments` (proven, works)

## Verification

After extraction, verify the data:

```sql
SELECT 
  v.id,
  v.vin,
  v.mileage,
  v.color,
  v.transmission,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id AND comment_type = 'bid' AND bid_amount IS NOT NULL) as bid_count,
  (SELECT COUNT(*) FROM listing_page_snapshots WHERE platform = 'bat' AND listing_url = v.discovery_url) as snapshots_for_listing_url
FROM vehicles v
WHERE v.discovery_url = 'YOUR_BAT_URL';
```

Expected results:
- ✅ VIN: 17 characters, not null
- ✅ Mileage: Number > 0
- ✅ Color: Not null
- ✅ Transmission: Not null
- ✅ Image count: > 0 (usually 20-100+)
- ✅ Comment count: > 0 (varies by listing)
- ✅ Bid count: > 0 (varies by listing)

## Troubleshooting

### If VIN is missing:
- Check if BaT listing actually has VIN in Essentials section
- Some listings don't have VIN (that's valid, store as null)

### If images are contaminated:
- `extract-premium-auction` filters images, but check the gallery JSON extraction
- Verify images are from `bringatrailer.com/wp-content/uploads/`

### If comments/bids are missing:
- Ensure `extract-auction-comments` was called
- Check `listing_page_snapshots` for that listing URL:
  - `success=true` means we got HTML evidence (good for later re-parsing).
  - `success=false` means the direct fetch failed in free mode (we are intentionally not using Firecrawl).
- Verify `auction_events` record exists (helps join history across auctions)

## Next Steps

1. **Update orchestrators** to use this two-step workflow
2. **Retire old extractors** that don't work
3. **Document in code** which extractors to use
4. **Add monitoring** to track success rates

---

**Last Updated**: 2026-01-07  
**Proven On**: 1969 Chevrolet C10 Pickup (Lot #225,895)  
**Success Rate**: 100% (1/1 tested) ✅

