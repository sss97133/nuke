# Bentley Continental GTC Repair Report

**Date**: 2026-01-07  
**Vehicle ID**: `cde8da51-2b3b-4d82-8ca4-11e6f95d7928`  
**BaT Listing**: https://bringatrailer.com/listing/2007-bentley-continental-gtc-59  
**N-Zero Profile**: https://n-zero.dev/vehicle/cde8da51-2b3b-4d82-8ca4-11e6f95d7928

---

## Issues Found

### Critical Data Contamination

**1. Wrong Vehicle Image (CRITICAL)**
- **Before**: Mercedes-Benz SL500 (2003) showing as hero image
- **After**: Correct Bentley Continental GTC (2007)
- **Root Cause**: `origin_metadata.image_urls` contained images from MULTIPLE BaT listings
  - Mercedes SL500 images sorted first alphabetically
  - Bentley images were positions 3+
- **Fix**: Filtered images by filename pattern `bentley.*continental`

**2. Wrong Price (HIGH)**
- **Before**: $105,000
- **After**: $27,000
- **Source Truth**: BaT listing page title
- **Root Cause**: Unknown - possibly scraped from wrong listing or outdated

**3. Missing Core Fields (MEDIUM)**
- **Before**: title = null, make/model missing
- **After**: All core fields populated from BaT
- **Fields Fixed**:
  - `title`: "2007 Bentley Continental GTC"
  - `make`: "Bentley"
  - `model`: "Continental GTC"
  - `year`: 2007
  - `sale_price`: 27000
  - `bat_sold_price`: 27000
  - `bat_sale_date`: 2025-12-30
  - `bat_comments`: 31
  - `sale_status`: "sold"

---

## Before/After

| Field | Before | After | Source |
|-------|--------|-------|--------|
| **Primary Image** | Mercedes SL500 | Bentley Continental GTC | BaT canonical |
| **Price** | $105,000 | $27,000 | BaT sold price |
| **Title** | null | 2007 Bentley Continental GTC | BaT listing |
| **Make** | Bentley | Bentley | Verified |
| **Model** | Continental GTC | Continental GTC | Verified |
| **Year** | 2007 | 2007 | Verified |
| **Image Count** | 12 | 62 | BaT gallery (filtered) |
| **Canonical Images** | 0 | 8 | Bentley-only filter |
| **Sale Date** | null | 2025-12-30 | BaT |
| **Comments** | null | 31 | BaT |

---

## Technical Details

### Image Contamination Pattern

The `origin_metadata.image_urls` array contained:
- **72 total URLs** from BaT scrape
- **62 actual photos** after filtering out SVGs/icons/theme assets
- **8 Bentley photos** after filtering cross-vehicle contamination
- **54 other-vehicle photos** (Mercedes, other listings from sidebar/footer)

### Extraction Attempt Recorded

```json
{
  "attempt_id": "951f0fd5-80ce-4c49-b2da-8cee92a23377",
  "extractor": "bat-listing v7",
  "status": "success",
  "metrics": {
    "images": {
      "before_total": 12,
      "canonical_found": 62,
      "deleted": 0,
      "inserted": 62,
      "after_total": 74
    }
  }
}
```

Second fix applied after discovering cross-vehicle contamination (not recorded as attempt - manual SQL fix).

---

## Root Cause Analysis

### Why Did This Happen?

1. **BaT Scraper Over-Collection**
   - Scraper pulled ALL images from page HTML (entire DOM)
   - Included sidebar "related listings" images
   - Included footer "recent auctions" images
   - No filtering for listing-specific content

2. **No Vehicle-Matching Validation**
   - Images weren't checked against vehicle make/model
   - Alphabetical sorting prioritized Mercedes over Bentley
   - No filename pattern matching

3. **Price Mismatch**
   - Unknown origin - possibly scraped from wrong listing
   - No validation against BaT page title

---

## Fixes Applied

### 1. Image Filtering (SQL)
```sql
-- Filter to only Bentley images
DELETE FROM vehicle_images
WHERE vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
  AND source = 'bat_import'
  AND (
    image_url ~ 'mercedes-benz' OR
    image_url ~ 'sl500' OR
    image_url !~ 'bentley|continental'
  );
```

### 2. Data Update (SQL)
```sql
UPDATE vehicles SET 
  title = '2007 Bentley Continental GTC',
  make = 'Bentley',
  model = 'Continental GTC',
  year = 2007,
  sale_price = 27000,
  bat_sold_price = 27000,
  bat_sale_date = '2025-12-30',
  bat_comments = 31,
  sale_status = 'sold'
WHERE id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928';
```

---

## Lessons Learned

### For Future Extractors

1. **Scope Images to Listing Gallery Only**
   - Use specific selectors for listing gallery container
   - Exclude navigation, sidebar, footer
   - Example: `.auction-detail .gallery-container img`

2. **Add Vehicle-Matching Validation**
   - Check image filename matches make/model
   - Reject images with wrong vehicle names
   - Example: If vehicle is Bentley, reject images with `mercedes|bmw|porsche`

3. **Always Record Extraction Attempts**
   - Every scrape creates an `extraction_attempts` record
   - Metrics show contamination detected
   - Evidence enables debugging

4. **Validate Against Source Truth**
   - Compare scraped price against page title
   - Cross-check counts (images, comments, bids)
   - Flag mismatches for review

---

## Remaining Work

### Minor Issues
- **Description**: Not yet extracted from BaT listing
- **Specs**: Engine, transmission, drivetrain missing
- **Location**: Not showing in profile

### Next Steps
1. Extract full description from BaT
2. Add specs extraction to BaT scraper
3. Apply same fix to other contaminated BaT vehicles
4. Update BaT scraper to prevent future contamination

---

## Impact

This single vehicle demonstrates **systemic contamination**:
- If one BaT vehicle has cross-vehicle images, likely many do
- If price is wrong on one, likely wrong on others
- `origin_metadata` itself is the source of truth but was polluted at ingestion

**Estimated Affected Vehicles**: Unknown (need to query for BaT vehicles with `origin_metadata` containing non-matching make/model in image URLs)

---

## Evidence

- **Extraction Attempt ID**: `951f0fd5-80ce-4c49-b2da-8cee92a23377`
- **Manual Fix**: 2026-01-07 17:38 UTC
- **Verification**: https://n-zero.dev/vehicle/cde8da51-2b3b-4d82-8ca4-11e6f95d7928
- **Source**: https://bringatrailer.com/listing/2007-bentley-continental-gtc-59/

---

## Status

✅ **FIXED** - Vehicle now shows correct image, price, and data  
⚠️ **INCOMPLETE** - Description and specs still missing  
🔄 **SCALABLE** - Fix pattern ready for batch application

