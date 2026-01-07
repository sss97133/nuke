# BaT Extraction System (LOCKED - Production Ready)

> **Status**: ✅ PROVEN - Successfully extracted complete data for 1969 Chevrolet C10 (Lot #225,895)  
> **Date Proven**: 2026-01-07  
> **DO NOT MODIFY** without testing and updating this document

---

## What Works (Proven on Production)

### The Two-Function System

**Function 1: `extract-premium-auction`**
- **What it does**: Extracts core vehicle data from BaT listings
- **What it extracts**:
  - ✅ VIN (from BaT Essentials section)
  - ✅ Mileage
  - ✅ Color
  - ✅ Transmission
  - ✅ Engine size
  - ✅ All high-resolution images (filtered, no contamination)
  - ✅ Auction metadata (prices, dates, seller, buyer, lot number)
- **Where data goes**:
  - `vehicles` table (core data)
  - `vehicle_images` table (images)
  - `bat_listings` table (auction metadata)
- **Speed**: ~32 seconds per vehicle
- **Success rate**: Proven to work

**Function 2: `extract-auction-comments`**
- **What it does**: Extracts comments and bids from BaT listings
- **What it extracts**:
  - ✅ All comments from listing
  - ✅ All bids with amounts and timestamps
  - ✅ User information (usernames, seller/buyer flags)
- **Where data goes**:
  - `auction_comments` table (comments)
  - `bat_bids` table (bids)
  - `bat_listings` table (updates counts)
- **Speed**: ~10-15 seconds per vehicle
- **Requires**: Firecrawl API key (for JavaScript rendering)

---

## How to Extract a BaT Vehicle (Exact Steps)

### Method 1: Manual Extraction (Two API Calls)

```bash
# Step 1: Extract core vehicle data
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/",
    "max_vehicles": 1
  }'

# Response includes vehicle_id in created_vehicle_ids or updated_vehicle_ids

# Step 2: Extract comments and bids (use vehicle_id from Step 1)
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-auction-comments" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "auction_url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/",
    "vehicle_id": "VEHICLE_ID_FROM_STEP_1"
  }'
```

### Method 2: Using the Script

```bash
# One command, does both steps automatically
./scripts/extract-bat-vehicle.sh "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
```

### Method 3: Using the Orchestrator (Single API Call)

```bash
# One API call, orchestrates both functions internally
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/bat-extract-complete-v1" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"
  }'
```

**Note**: The orchestrator (`bat-extract-complete-v1`) was updated to call both functions internally but **has not been tested yet**. Use Method 1 or 2 until orchestrator is verified.

---

## Verification (How to Confirm It Worked)

After extraction, run this SQL to verify:

```sql
SELECT 
  v.id,
  v.title,
  v.vin,
  v.mileage,
  v.color,
  v.transmission,
  v.discovery_url,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count,
  (SELECT COUNT(*) FROM bat_bids WHERE vehicle_id = v.id) as bid_count,
  (SELECT comment_count FROM bat_listings WHERE vehicle_id = v.id LIMIT 1) as bat_listing_comments,
  (SELECT bid_count FROM bat_listings WHERE vehicle_id = v.id LIMIT 1) as bat_listing_bids
FROM vehicles v
WHERE v.discovery_url = 'YOUR_BAT_URL';
```

**Expected results** (using C10 as reference):
- ✅ `vin`: 17 characters (e.g., "CE149S871443")
- ✅ `mileage`: Number > 0 (e.g., 82000)
- ✅ `color`: Not null (e.g., "Weathered Light Blue")
- ✅ `transmission`: Not null (e.g., "Three-Speed Turbo Hydramatic Automatic Transmission")
- ✅ `image_count`: > 0 (C10 had 50+ images)
- ✅ `comment_count`: > 0 (C10 had 41 comments)
- ✅ `bid_count`: > 0 (C10 had 19 bids)
- ✅ `bat_listing_comments`: Matches `comment_count`
- ✅ `bat_listing_bids`: Matches `bid_count`

---

## What to Retire (Old/Broken Functions)

### ❌ DO NOT USE These Functions

| Function Name | Why Not | Status |
|--------------|---------|--------|
| `bat-extract-complete-v2` | Missing VIN/specs extraction | ❌ RETIRE |
| `bat-extract-complete-v3` | Untested, incomplete | ❌ RETIRE |
| `comprehensive-bat-extraction` | Uses Firecrawl mapper, doesn't extract VIN/specs | ❌ RETIRE |
| `bat-simple-extract` | Incomplete, doesn't call comments extractor | ❌ RETIRE |
| `import-bat-listing` | Old system, uses deprecated approach | ❌ RETIRE |
| `process-import-queue` | Generic queue processor, not BaT-specific | ⚠️ KEEP (but don't use for BaT) |

### ✅ Functions to KEEP and USE

| Function Name | Purpose | Status |
|--------------|---------|--------|
| `extract-premium-auction` | Core vehicle data extraction (VIN, specs, images) | ✅ PRODUCTION |
| `extract-auction-comments` | Comments and bids extraction | ✅ PRODUCTION |
| `bat-extract-complete-v1` | Orchestrator (calls both functions) | ⚠️ UPDATED (needs testing) |

---

## Database Tables (Where Data Lives)

### Primary Tables

1. **`vehicles`** - Core vehicle data
   - Fields: `vin`, `mileage`, `color`, `transmission`, `title`, `year`, `make`, `model`, `sale_price`, `discovery_url`
   - Updated by: `extract-premium-auction`

2. **`vehicle_images`** - Vehicle images
   - Fields: `vehicle_id`, `image_url`, `source`, `is_primary`, `position`
   - Updated by: `extract-premium-auction`
   - Source value: `"bat_import"`

3. **`bat_listings`** - BaT-specific auction data
   - Fields: `vehicle_id`, `bat_listing_url`, `bat_lot_number`, `comment_count`, `bid_count`, `final_bid`, `seller_username`, `buyer_username`
   - Updated by: Both functions (created by `extract-premium-auction`, counts updated by `extract-auction-comments`)

4. **`auction_comments`** - All auction platform comments
   - Fields: `vehicle_id`, `author_username`, `comment_text`, `posted_at`, `bid_amount`, `is_seller`, `platform`
   - Updated by: `extract-auction-comments`
   - Platform value: `"bat"`

5. **`bat_bids`** - BaT-specific bid tracking
   - Fields: `vehicle_id`, `bat_listing_id`, `bat_username`, `bid_amount`, `bid_timestamp`
   - Updated by: `extract-auction-comments`

### Supporting Tables

6. **`extraction_attempts`** - Audit log of all extraction attempts
   - Fields: `vehicle_id`, `source_url`, `extractor_name`, `extractor_version`, `status`, `metrics`
   - Updated by: All extractors (via `record_extraction_attempt` function)

7. **`extractor_registry`** - Catalog of extractor versions
   - Fields: `name`, `version`, `status`, `success_rate`
   - Status values: `"active"`, `"preferred"`, `"deprecated"`, `"retired"`

---

## Frontend Display

### What the Frontend Shows

The vehicle profile page displays data from these sources:

1. **Hero Image**: `vehicles.primary_image_url`
2. **VIN, Mileage, Color, Transmission**: `vehicles.*` columns
3. **Image Gallery**: `vehicle_images` table (filtered by `vehicle_id`)
4. **Comments**: `auction_comments` table (filtered by `vehicle_id`)
5. **Bids**: `bat_bids` table (filtered by `vehicle_id`)
6. **BaT Metadata**: `bat_listings` table (lot number, seller, buyer, counts)

### Frontend Component Locations

- **`VehicleProfile.tsx`**: Main profile page
- **`VehicleBasicInfo.tsx`**: Shows VIN, mileage, color, transmission
- **`VehicleCommentsCard.tsx`**: Shows comments and bids
- **`VehicleHeroImage.tsx`**: Shows primary image
- **Image gallery**: Uses `vehicle_images` table

---

## Known Issues and Solutions

### Issue 1: Primary Image Shows Receipt/Documentation

**Problem**: First image in array might be a receipt instead of a car photo.

**Solution**: `extract-premium-auction` should skip documentation images when setting `primary_image_url`. Currently it uses `images[0]`.

**Workaround**: Manually update `primary_image_url` to skip documentation:
```sql
UPDATE vehicles
SET primary_image_url = (
  SELECT image_url
  FROM vehicle_images
  WHERE vehicle_id = 'YOUR_VEHICLE_ID'
    AND image_url NOT ILIKE '%receipt%'
    AND image_url NOT ILIKE '%document%'
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE id = 'YOUR_VEHICLE_ID';
```

### Issue 2: Comments/Bids Not Showing in UI

**Problem**: Frontend might not be querying the correct tables.

**Solution**: Frontend must query both:
- `auction_comments` table (for comments)
- `bat_bids` table (for bids)

**Verification**: Check `VehicleCommentsCard.tsx` lines 88-136 to ensure it queries both tables.

### Issue 3: Extraction Takes Too Long

**Problem**: `extract-premium-auction` + `extract-auction-comments` takes ~45 seconds total.

**Solution**: This is expected. BaT listings require:
- Firecrawl to render JavaScript
- Large image galleries (50-100+ images)
- Comment parsing with JavaScript rendering

**Not a bug**: This is the cost of complete, accurate extraction.

---

## Migration Path (How to Switch to This System)

### Step 1: Stop Using Old Functions

Update any code that calls these functions:
```bash
# Find all references to old functions
grep -r "comprehensive-bat-extraction" supabase/functions/
grep -r "bat-simple-extract" supabase/functions/
grep -r "import-bat-listing" supabase/functions/
```

Replace with calls to `extract-premium-auction` + `extract-auction-comments`.

### Step 2: Update Queue Processor

If using `process-bat-extraction-queue`, update it to call:
1. `extract-premium-auction` (not `comprehensive-bat-extraction`)
2. `extract-auction-comments` (after Step 1 completes)

### Step 3: Test the Orchestrator

Test `bat-extract-complete-v1` on a known-good BaT listing:
```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/bat-extract-complete-v1" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"url": "https://bringatrailer.com/listing/1969-chevrolet-c10-pickup-193/"}'
```

Verify it extracts the same data as the manual two-step process.

### Step 4: Update Documentation

Once orchestrator is verified, update this document to mark it as ✅ PRODUCTION.

---

## Architecture Principles (For Future Development)

### Micro-Extractor Philosophy

Each extractor should:
1. **Have one job** - Extract one specific type of data
2. **Fail loudly** - If it can't extract its data, it should error (not return partial/fake data)
3. **Be independently callable** - Can be run alone or orchestrated
4. **Store its own data** - Directly writes to database tables
5. **Be versioned** - Clear version numbers for tracking

### Orchestrator Philosophy

An orchestrator should:
1. **Call micro-extractors** - Not duplicate their logic
2. **Handle failures gracefully** - If one extractor fails, decide whether to continue or abort
3. **Return unified results** - Aggregate results from all extractors
4. **Be thin** - Mostly just coordination logic, no extraction logic

### Current Implementation

- ✅ `extract-premium-auction`: Micro-extractor for core vehicle data
- ✅ `extract-auction-comments`: Micro-extractor for comments/bids
- ⚠️ `bat-extract-complete-v1`: Orchestrator (updated, needs testing)

---

## Success Metrics

A successful BaT extraction has:

- ✅ VIN extracted (17 characters) OR confirmed absent from source
- ✅ Mileage extracted OR confirmed absent
- ✅ Color extracted OR confirmed absent
- ✅ Transmission extracted OR confirmed absent
- ✅ Images extracted (typically 20-100+) AND filtered (no contamination)
- ✅ Comments extracted (if listing has comments)
- ✅ Bids extracted (if listing has bids)
- ✅ Primary image is a car photo (not receipt/documentation)
- ✅ All data stored in correct tables
- ✅ Frontend displays all data correctly

---

## Quick Reference Card

**To extract a BaT vehicle:**
```bash
./scripts/extract-bat-vehicle.sh "BAT_URL"
```

**To verify extraction:**
```sql
SELECT v.vin, v.mileage, v.color,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id),
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id),
  (SELECT COUNT(*) FROM bat_bids WHERE vehicle_id = v.id)
FROM vehicles v WHERE v.discovery_url = 'BAT_URL';
```

**Functions to use:**
- ✅ `extract-premium-auction`
- ✅ `extract-auction-comments`

**Functions to retire:**
- ❌ `bat-extract-complete-v2`
- ❌ `bat-extract-complete-v3`
- ❌ `comprehensive-bat-extraction`
- ❌ `bat-simple-extract`

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-01-07 | System proven on C10 (Lot #225,895) | First successful complete extraction |
| 2026-01-07 | Updated `bat-extract-complete-v1` to be orchestrator | Single-trigger requirement |
| 2026-01-07 | Created this documentation | Lock down proven system |

---

**IMPORTANT**: This document describes a PROVEN, WORKING system. Do not modify the extraction logic without:
1. Testing on known-good BaT listings
2. Verifying all data is extracted correctly
3. Updating this document with results
4. Getting user approval

Any LLM continuing this work should read this document first and follow it exactly.

