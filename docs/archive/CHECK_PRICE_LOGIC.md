# Price Display Issue: $1,800 Showing Incorrectly

## Problem
The vehicle header is showing "$1,800" but it should be showing a different value.

## Where Price Comes From

The price display in VehicleHeader uses this logic (line 158-182):

1. **Display mode = 'auto'** (default): Calls `getAutoDisplay()`
2. **Display mode = 'estimate'**: Uses RPC signal or computes from vehicle data

### getAutoDisplay() Logic (line 129):
```typescript
if (rpcSignal && typeof rpcSignal.primary_value === 'number') {
  return { amount: rpcSignal.primary_value, label: rpcSignal.primary_label };
}
// Falls back to computePrimaryPrice() if no RPC signal
```

### computePrimaryPrice() Order:
1. If `is_for_sale` + `asking_price` exists → use that
2. Else if `current_value` exists → use that (THIS IS PROBABLY THE $1,800)
3. Else if `purchase_price` exists → use that
4. Else if `sale_price` exists → use that
5. Else fall back to `current_value` again

## The $1,800 Issue

Most likely the vehicle has:
- `current_value: 1800` in the database
- But the REAL value should be different

## Fix Options

### Option 1: Update Database Value
```sql
UPDATE vehicles 
SET current_value = 140615  -- Correct value
WHERE id = 'vehicle-uuid';
```

### Option 2: Use Asking Price
If vehicle is for sale:
```sql
UPDATE vehicles
SET is_for_sale = true,
    asking_price = 140615  -- Real asking price
WHERE id = 'vehicle-uuid';
```

### Option 3: Change Display Mode
The owner can use the dropdown to select a different price type.
Currently showing: Auto (which uses current_value = 1800)
Should select: "MSRP" or "Estimate" or "Asking"

## Root Cause Check

Run this to see what values exist:
```sql
SELECT 
  id,
  year, make, model,
  current_value,    -- This is probably 1800
  asking_price,
  purchase_price,
  sale_price,
  msrp,
  is_for_sale,
  current_bid
FROM vehicles 
WHERE id = 'your-vehicle-id';
```

If current_value = 1800 but should be higher:
→ Update the database value to correct amount
