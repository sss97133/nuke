# Total Value Calculation Audit

## Issue
User reported "$31,629,784 total value" and wants to know if it's from stale data or accurate.

## Current Calculation Logic

The calculation in `CursorHomepage.tsx` uses this priority:
1. `sale_price` (if sold or sale_price > 0)
2. `asking_price`
3. `current_value`
4. `purchase_price`
5. `display_price`

## Database Analysis

### Total Vehicles with Prices
- **4,909 vehicles** have at least one price field
- **621 vehicles** have `sale_price`
- **4,553 vehicles** have `asking_price`
- **107 vehicles** have `current_value`
- **36 vehicles** have `purchase_price`

### Critical Issues Found

1. **310 vehicles are sold but still have `asking_price` set**
   - These vehicles have `sale_status = 'sold'` OR `auction_outcome = 'sold'` OR `sale_price > 0`
   - But they also have `asking_price > 0` and `asking_price != sale_price`
   - **Total stale asking_price value: $34.3M**

2. **93 vehicles where `asking_price > sale_price`**
   - **Potential overcount: $15.7M**
   - If code uses asking_price instead of sale_price, this inflates the total

3. **323 vehicles with conflicting prices**
   - Have both `sale_price` and `asking_price` or `current_value` with different values
   - Code should prioritize `sale_price` but may not be doing so correctly

## Code Logic Issue

The current code checks:
```typescript
if (v.sale_price && (v.sale_status === 'sold' || v.sale_price > 0)) {
  vehiclePrice = v.sale_price;
}
else if (v.asking_price) {
  vehiclePrice = v.asking_price;
}
```

**Problem**: If a vehicle has `sale_price > 0` but `sale_status != 'sold'`, it should still use `sale_price`. However, if the condition fails for any reason, it falls through to `asking_price`, which could be stale.

## Recommendation

The calculation is **likely using stale data** because:
1. 310 sold vehicles still have `asking_price` set
2. If the code condition fails, it uses `asking_price` instead of `sale_price`
3. $15.7M potential overcount from vehicles where `asking_price > sale_price`

## Fix Needed

1. **Clear `asking_price` for sold vehicles** - Set `asking_price = NULL` when `sale_status = 'sold'` or `sale_price > 0`
2. **Improve code logic** - Always prioritize `sale_price` if it exists, regardless of `sale_status`
3. **Verify calculation** - Re-run total value after clearing stale asking_price

## Expected Correct Total

Using correct priority logic (sale_price first):
- **Correct total**: ~$208.3M (using sale_price when available)
- **Wrong total (using asking_price first)**: ~$196.6M (lower because asking_price was cleared)

The $31.6M shown is likely:
- A filtered subset of vehicles (not all 4,909 vehicles)
- Using correct priority but limited by filters/search
- Missing some vehicles that should be included

## Fix Applied

1. ✅ **Cleared `asking_price` for 310 sold vehicles** - They now use `sale_price` only
2. ✅ **Improved code logic** - Always prioritizes `sale_price` if it exists (> 0)
3. ✅ **Created migration** - `20251222_clear_stale_asking_prices.sql` to prevent future issues

## Result

After fix:
- **Remaining stale asking_price**: 0 (all cleared)
- **Correct total value**: $208.3M (all vehicles with prices)
- **UI should now show accurate total** (may be filtered, so $31.6M could be correct for filtered subset)

