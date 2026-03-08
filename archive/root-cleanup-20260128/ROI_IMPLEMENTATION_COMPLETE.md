# ROI Cost Tracking Implementation - Complete

## ✅ What Was Implemented

### 1. **Receipt Extraction** (One-time backfill)
- **Function**: Extracts all existing receipts from `receipts` table → `spend_attributions`
- **Intelligent Categorization**: Auto-detects spend category from vendor name and description
  - Parts vendors (NAPA, O'Reilly, AutoZone) → `parts`
  - Service shops → `labor`
  - Shipping companies → `shipping`
  - Photography vendors → `fee`
  - Auction platforms → `fee`
  - Storage facilities → `overhead`
- **Idempotent**: Only extracts receipts that don't already have attributions

### 2. **Auto-Tracking Triggers** (Future costs)

#### **Listing Fees**
- **Trigger**: `trigger_auto_attribute_listing_fee` on `vehicle_listings` INSERT
- **Logic**: 
  - BaT/Cars & Bids: $99 fee
  - Native listings: $50 default
- **When**: Automatically when auction listing is created

#### **Photography Costs**
- **Trigger**: `trigger_auto_attribute_photography_cost` on `vehicle_images` INSERT
- **Logic**: 
  - Estimates $5/image when vehicle has 5+ images (suggests professional shoot)
  - Only attributes once per vehicle
- **When**: Automatically when images are uploaded

#### **Consignment Fees**
- **Trigger**: `trigger_auto_attribute_consignment_fee` on `organization_vehicles` INSERT
- **Logic**: 
  - 5% of vehicle value (current_value or asking_price)
  - Only for `relationship_type = 'consigner'`
- **When**: Automatically when consignment relationship is established

#### **Platform/AI Costs**
- **Function**: `link_api_usage_to_vehicles()`
- **Logic**: Links `api_usage_logs` (image analysis costs) to vehicles
- **When**: Can be run manually or scheduled

### 3. **Helper Functions**

#### `categorize_receipt_spend(vendor_name, description, category)`
- Intelligently categorizes receipts into spend categories
- Used by extraction and can be used for future receipts

#### `get_receipt_extraction_summary()`
- Returns summary of extraction status
- Shows totals by category, auto-tracked costs, etc.

#### `extract_all_receipts_to_spend_attributions()`
- **Manual trigger** to run extraction on-demand
- Returns counts of what was extracted
- Idempotent (safe to run multiple times)

---

## 🚀 How to Use

### **Run Receipt Extraction Now**

```sql
-- Extract all receipts and link API usage
SELECT extract_all_receipts_to_spend_attributions();

-- Check summary
SELECT get_receipt_extraction_summary();
```

### **Check ROI for a Vehicle**

```sql
-- Get ROI summary (already exists)
SELECT get_vehicle_roi_summary('vehicle-id-here');

-- Check spend attributions
SELECT 
  spend_category,
  SUM(amount_cents) / 100.0 AS total_usd,
  COUNT(*) AS count
FROM spend_attributions
WHERE vehicle_id = 'vehicle-id-here'
  AND direction = 'outflow'
GROUP BY spend_category
ORDER BY total_usd DESC;
```

---

## 📊 What Gets Tracked

### **From Receipts** (Extracted)
- Parts purchases
- Labor costs
- Materials
- Shipping
- Taxes
- Fees
- Other expenses

### **Auto-Tracked** (Future)
- ✅ Listing fees (auction platforms)
- ✅ Photography costs (estimated)
- ✅ Consignment fees (5% of value)
- ✅ Platform/AI costs (image analysis)

### **Not Yet Tracked** (Needs Implementation)
- Storage costs (monthly attribution)
- Transportation costs (unless in receipts)
- Insurance (unless in receipts)
- Registration/title fees (unless in receipts)

---

## 🔧 Next Steps

1. **Run Migration**: Apply `20260115000002_roi_cost_tracking_implementation.sql`
2. **Extract Receipts**: Run `extract_all_receipts_to_spend_attributions()`
3. **Verify**: Check `get_receipt_extraction_summary()` for counts
4. **Test ROI**: Check a vehicle with receipts to see ROI calculation

---

## 💡 Notes

- **Idempotent**: All functions are safe to run multiple times
- **RLS Protected**: All spend_attributions respect RLS policies
- **Metadata Rich**: All attributions include source, dates, and context
- **Extensible**: Easy to add more cost categories or triggers

---

## 🎯 Expected Results

After running extraction, you should see:
- `spend_attributions` table populated with receipt data
- ROI calculations working for vehicles with receipts
- Future costs automatically tracked via triggers
- Investment Summary card showing accurate spend totals
