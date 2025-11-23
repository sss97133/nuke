# 1932 Ford Roadster - Receipt & Pricing Investigation

**Vehicle ID:** `21ee373f-765e-4e24-a69d-e59e2af4f467`  
**VIN:** AZ370615  
**Date:** November 22, 2025

---

## Issues Found

### 1. ✅ FIXED: Price Using Outdated Estimate

**Problem:**
- Vehicle showed `current_value = $75,000` (old estimate)
- Ignored `purchase_price = $110,000` (receipt-backed)
- Asking price is $99,500

**Fix Applied:**
- Updated `current_value` from $75k → $110k to reflect documented purchase price
- Now shows receipt-backed valuation instead of outdated estimate

**SQL:**
```sql
UPDATE vehicles
SET current_value = 110000.00
WHERE id = '21ee373f-765e-4e24-a69d-e59e2af4f467';
```

---

### 2. 🔍 INVESTIGATING: Missing Receipt Display

**Timeline Event Found:**
- Event ID: `71240e29-e228-4e11-99a6-497be2676e94`
- Type: `purchase`
- Title: "Purchase receipt"
- Description: "Document uploaded: 🧾 Receipt"
- Date: November 1, 2025

**Receipt Tables Available:**
- `receipts` - Main receipts table
- `vehicle_receipts` - Vehicle-specific receipts
- `timeline_event_documents` - Links events to documents
- `secure_documents` - Secure document storage
- `vehicle_receipts_rollup_v` - Aggregated view

**Next Steps:**
1. Query actual receipt data from tables
2. Find the uploaded receipt file
3. Link it properly to vehicle profile display
4. Add receipt viewer component if missing

---

### 3. 🔄 TODO: Image Loading & Ordering

**Current Issues:**
- Images loading in wrong order (fixed created_at DESC but needs verification)
- Not using optimized resolutions for load speed
- Should use thumbnail_url for grid, large_url for hero

**Need to:**
1. Verify image ordering after deployment
2. Check if thumbnail URLs are being used
3. Implement lazy loading for large galleries (243 images!)

---

## Data Summary

| Field | Value |
|-------|-------|
| Current Value | $110,000 (✅ Fixed) |
| Purchase Price | $110,000 |
| Asking Price | $99,500 |
| MSRP (1932) | $500 |
| Condition Rating | NULL (needs assessment) |
| Total Images | 243 |
| Timeline Events | 19 |
| Receipt Events | 1 (Nov 1, 2025) |

---

## Next Actions

1. ✅ Price updated to reflect receipts
2. ⏳ Find and display actual receipt document
3. ⏳ Verify image loading performance
4. ⏳ Test on production after deployment

