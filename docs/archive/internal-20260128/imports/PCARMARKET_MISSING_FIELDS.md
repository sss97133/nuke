# PCarMarket Extraction - Missing Fields Summary

## ✅ Currently Extracted

### Core Vehicle Data
- ✅ Year
- ✅ Make
- ✅ Model
- ✅ Trim
- ✅ VIN
- ✅ Mileage
- ✅ Title/Description (basic)

### Origin Tracking
- ✅ Profile Origin (`pcarmarket_import`)
- ✅ Discovery Source (`pcarmarket`)
- ✅ Discovery URL
- ✅ Listing URL

### Metadata (JSONB)
- ✅ PCarMarket URL
- ✅ Listing Title
- ✅ Seller Username
- ✅ Auction ID/Slug
- ✅ Bid Count
- ✅ View Count
- ✅ Sold Status
- ✅ Import Timestamp

---

## ❌ Missing from Current Extraction

### Critical Missing Data

1. **Images** ❌
   - Issue: Database constraint violation
   - Required: Need to fix image insertion (user_id or category issue)
   - Impact: No visual gallery

2. **Organization Link** ❌
   - Issue: Wrong column name or schema mismatch
   - Required: Fix `organization_vehicles` insertion
   - Impact: Vehicle not linked to PCarMarket org

### Vehicle Specification Fields

3. **Color** ❌
   - Could extract from auction page description
   - Field: `vehicles.color`

4. **Transmission** ❌
   - Manual/Automatic/Semi-auto
   - Field: `vehicles.transmission`

5. **Engine Size** ❌
   - e.g., "6.0L V12"
   - Field: `vehicles.engine_size`

6. **Drivetrain** ❌
   - RWD/AWD/FWD
   - Field: `vehicles.drivetrain`

7. **Body Style** ❌
   - Coupe/Sedan/Convertible/etc
   - Field: `vehicles.body_style`

### Auction Details

8. **Full Description** ⚠️
   - Currently: Only title captured
   - Needed: Full auction description text
   - Field: `vehicles.description` (enhance)

9. **Auction Dates** ❌
   - Start date
   - End date (if available)
   - Fields: `vehicles.auction_start_date`, `vehicles.auction_end_date`

10. **Reserve Price** ❌
    - If visible on auction page
    - Could store in `origin_metadata`

11. **Buy-It-Now Price** ❌
    - If applicable
    - Could store in `origin_metadata`

### Seller/Buyer Details

12. **Seller Full Name/Business** ❌
    - Currently: Only username
    - Could extract seller profile/business name
    - Store in `origin_metadata`

13. **Buyer Information** ❌ (for sold listings)
    - Buyer username/name
    - Already partially tracked in metadata

### Location Data

14. **Vehicle Location** ❌
    - City, State, Country
    - Store in `origin_metadata.location`

### Auction Activity

15. **Bid History** ❌
    - Full list of bids (if available)
    - Store in `origin_metadata.bid_history`

16. **Comments** ❌
    - Comments count (partially captured)
    - Full comments (if needed)
    - Store in `origin_metadata`

17. **View Count** ⚠️
    - Partially captured in metadata
    - Could be more accurate from page

### Vehicle Condition/History

18. **Condition** ❌
    - Condition rating/grade
    - Store in `origin_metadata` or `vehicles.condition_rating`

19. **Service History** ❌
    - If mentioned in description
    - Store in `origin_metadata` or separate table

20. **Modifications** ❌
    - If any modifications mentioned
    - Store in `origin_metadata.modifications`

---

## 🛠️ Immediate Fixes Needed

### 1. Fix Image Import
**Issue:** Constraint violation on `vehicle_images`  
**Fix:** Need to check schema requirements (likely needs `user_id` or different `category` value)

### 2. Fix Organization Link
**Issue:** Column name mismatch (`listing_url` not in schema)  
**Fix:** Check actual `organization_vehicles` schema and use correct columns

---

## 📋 Enhancement Priorities

### High Priority
1. Fix image import (constraint violation)
2. Fix organization link (schema mismatch)
3. Extract full description text
4. Extract vehicle specs (color, transmission, engine, etc.)

### Medium Priority
5. Extract auction dates
6. Extract location
7. Extract seller details (beyond username)
8. Extract bid history

### Low Priority
9. Extract service history
10. Extract modifications
11. Extract condition details
12. Extract reserve price (if visible)

---

## 🎯 What We Have vs What's Possible

### Current Implementation
- ✅ Basic vehicle identification (YMM, VIN)
- ✅ Basic auction status (sold/unsold, price)
- ✅ Metadata storage
- ❌ Images (needs fix)
- ❌ Organization link (needs fix)
- ❌ Detailed specs

### Full Extraction Potential
- All basic fields ✅
- All vehicle specs
- Complete auction history
- Full gallery images
- Seller/buyer profiles
- Bid history
- Comments
- Location data

---

## Next Steps

1. **Fix immediate issues:**
   - Resolve image constraint violation
   - Fix organization link schema mismatch

2. **Enhance scraping:**
   - Add Playwright/Firecrawl for full page rendering
   - Extract detailed specs from auction page
   - Extract full description

3. **Complete metadata:**
   - Extract all available fields
   - Store in appropriate tables/JSONB

