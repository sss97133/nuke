# Vehicle Data Report
## 1988 Jeep Wrangler Sahara

**Vehicle ID:** `f7a10a48-4cd8-4ff9-9166-702367d1c859`  
**Report Generated:** November 21, 2025  
**BaT Listing:** [https://bringatrailer.com/listing/1988-jeep-wrangler-32/](https://bringatrailer.com/listing/1988-jeep-wrangler-32/)

---

## 🔍 Executive Summary

**CRITICAL ISSUE:** The sold price is **incorrect** in the database.

- **BaT Listing Price:** $11,000 ✅
- **Database `sale_price`:** $0 ❌ **WRONG!**
- **Database `bat_sold_price`:** NULL ❌ **MISSING!**
- **Database `bat_sale_date`:** NULL ❌ **MISSING!**

---

## 📊 Database Data

### Basic Vehicle Information
- **Year:** 1988
- **Make:** Jeep
- **Model:** Wrangler
- **Trim:** Sahara
- **VIN:** 2BCCZ8124JB538686
- **Color:** Green
- **Transmission:** 5-Speed Manual
- **Engine:** 4.2L I6
- **Drivetrain:** 4WD

### Price Data (CURRENT - INCORRECT)
| Field | Value | Status |
|-------|-------|--------|
| `sale_price` | **$0** | ❌ **WRONG - Should be $11,000** |
| `bat_sold_price` | **NULL** | ❌ **MISSING - Should be $11,000** |
| `sale_date` | 2024-04-15 | ✅ Correct |
| `bat_sale_date` | **NULL** | ❌ **MISSING - Should be 2024-04-15** |
| `asking_price` | NULL | N/A |
| `purchase_price` | $3,000 | ✅ (if applicable) |
| `current_value` | $18,750 | ✅ (estimated) |

### BaT Data
- **bat_auction_url:** https://bringatrailer.com/listing/1988-jeep-wrangler-32/ ✅
- **bat_listing_title:** NULL ⚠️ (should be populated)
- **bat_seller:** VivaLasVegasAutos ✅
- **bat_buyer:** scarp215 ✅

### Field Sources
⚠️ **No price-related field sources found in `vehicle_field_sources` table!**

This means there's no attribution/provenance tracking for the price data.

---

## 🌐 Bring a Trailer Listing Data

**Source:** [https://bringatrailer.com/listing/1988-jeep-wrangler-32/](https://bringatrailer.com/listing/1988-jeep-wrangler-32/)

### Extracted Data
- **Title:** "No Reserve: 1988 Jeep Wrangler Sahara for sale on BaT Auctions - sold for $11,000 on April 15, 2024 (Lot #143,328)"
- **Sold Price:** **$11,000** ✅
- **Sale Date:** **April 15, 2024** ✅
- **Lot Number:** **143,328** ✅
- **Seller:** VivaLasVegasAutos ✅
- **Buyer:** scarp215 ✅

---

## 💻 UI Display (Current)

Based on `VehicleHeader.tsx` logic:

### Price Display Logic
The UI shows price entries in this order:

1. **"Recorded Sale"**
   - Amount: `vehicle.sale_price` = **$0** ❌ (WRONG!)
   - Date: `vehicle.sale_date` = 2024-04-15 ✅
   - Source: Field source or "Vehicle record"

2. **"Bring a Trailer Result"** (only shown if `bat_sold_price` exists and differs from `sale_price`)
   - Amount: `vehicle.bat_sold_price` = **NULL** ❌ (Not displayed - MISSING!)
   - Date: `vehicle.bat_sale_date` = NULL ❌
   - Source: "Bring a Trailer"

3. **"Asking Price"**
   - Amount: `vehicle.asking_price` = NULL

### Current UI Behavior
- **Shows:** "Recorded Sale" for **$0** ❌
- **Does NOT show:** "Bring a Trailer Result" because `bat_sold_price` is NULL
- **Result:** Users see incorrect price of $0 instead of $11,000

---

## 🔍 Comparison: BaT vs Database vs UI

| Data Point | BaT Listing | Database | UI Display | Status |
|------------|-------------|----------|------------|--------|
| **Sold Price** | $11,000 | $0 | $0 | ❌ **MISMATCH** |
| **BaT Sold Price** | $11,000 | NULL | (not shown) | ❌ **MISSING** |
| **Sale Date** | April 15, 2024 | 2024-04-15 | 2024-04-15 | ✅ Match |
| **BaT Sale Date** | April 15, 2024 | NULL | (not shown) | ❌ **MISSING** |
| **Lot Number** | 143,328 | (not stored) | (not shown) | ⚠️ Not tracked |
| **Seller** | VivaLasVegasAutos | VivaLasVegasAutos | (shown) | ✅ Match |
| **Buyer** | scarp215 | scarp215 | (shown) | ✅ Match |

---

## 📋 Issues Identified

### Critical Issues
1. ❌ **`sale_price` = $0** (should be $11,000)
2. ❌ **`bat_sold_price` = NULL** (should be $11,000)
3. ❌ **`bat_sale_date` = NULL** (should be 2024-04-15)

### Data Quality Issues
4. ⚠️ **No price field sources** - No attribution/provenance tracking
5. ⚠️ **`bat_listing_title` = NULL** - Should be populated from BaT
6. ⚠️ **Lot number not stored** - Should be in metadata or separate field

### UI Issues
7. ❌ **UI displays $0** instead of $11,000
8. ❌ **BaT price not shown** because `bat_sold_price` is NULL

---

## 🔧 Recommended Fixes

### Immediate Actions Required

1. **Update `sale_price`**
   ```sql
   UPDATE vehicles 
   SET sale_price = 11000 
   WHERE id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';
   ```

2. **Update `bat_sold_price`**
   ```sql
   UPDATE vehicles 
   SET bat_sold_price = 11000 
   WHERE id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';
   ```

3. **Update `bat_sale_date`**
   ```sql
   UPDATE vehicles 
   SET bat_sale_date = '2024-04-15' 
   WHERE id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';
   ```

4. **Add field source attribution**
   ```sql
   INSERT INTO vehicle_field_sources (
     vehicle_id, 
     field_name, 
     field_value, 
     source_type, 
     source_url, 
     extraction_method, 
     confidence_score,
     metadata
   ) VALUES (
     'f7a10a48-4cd8-4ff9-9166-702367d1c859',
     'sale_price',
     '11000',
     'ai_scraped',
     'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
     'url_scraping',
     100,
     '{"source": "BaT_listing", "extracted_at": "2025-11-21", "lot_number": "143328"}'::jsonb
   );
   ```

5. **Update `bat_listing_title`**
   ```sql
   UPDATE vehicles 
   SET bat_listing_title = 'No Reserve: 1988 Jeep Wrangler Sahara' 
   WHERE id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';
   ```

### Long-term Improvements

1. **Add lot number tracking** - Store BaT lot numbers in metadata or separate field
2. **Improve BaT scraping** - Ensure price data is captured during initial import
3. **Add validation** - Prevent `sale_price = 0` when BaT data exists
4. **Add data quality checks** - Flag vehicles with missing BaT price data

---

## 📝 Data Provenance

### Current State
- **No field sources** for price data
- **No attribution** for where price came from
- **No confidence scores** for price accuracy

### Recommended State
- **Field source** with `source_type = 'ai_scraped'`
- **Source URL** pointing to BaT listing
- **Confidence score** of 100% (from official BaT listing)
- **Metadata** including lot number and extraction date

---

## ✅ Verification Steps

After applying fixes:

1. ✅ Verify `sale_price = 11000`
2. ✅ Verify `bat_sold_price = 11000`
3. ✅ Verify `bat_sale_date = '2024-04-15'`
4. ✅ Verify UI shows correct price
5. ✅ Verify field source exists with proper attribution
6. ✅ Verify BaT listing still accessible and matches

---

## 📊 Summary

| Category | Status | Count |
|----------|--------|-------|
| **Correct Data** | ✅ | 5 fields |
| **Incorrect Data** | ❌ | 3 fields |
| **Missing Data** | ⚠️ | 2 fields |
| **Total Issues** | | **5 issues** |

**Primary Issue:** Sold price is $0 instead of $11,000, causing incorrect display in UI.

**Root Cause:** Price data was not properly extracted/stored during BaT import.

**Impact:** Users see incorrect sale price of $0 instead of actual $11,000 BaT sale price.

---

*Report generated by vehicle-data-report.js script*

