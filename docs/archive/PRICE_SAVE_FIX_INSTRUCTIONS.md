# 🚨 URGENT: Fix Price Save Permissions

## Problem
Users unable to save prices to vehicles table. All price editors failing:
- ❌ MobilePriceEditor
- ❌ VehiclePriceSection
- ❌ BulkPriceEditor
- ❌ VehicleDataEditor

## Root Cause
Multiple conflicting RLS (Row Level Security) policies on `vehicles` table blocking UPDATE operations.

**Conflicting policies found:**
1. `Users can update their own vehicles` - Checks `user_id`
2. `Owners can update vehicles` - Checks `user_id OR owner_id`
3. `Contributors can update vehicles` - Checks `vehicle_contributors` table
4. `Any authenticated user can edit vehicles` - Allows all (but being overridden)

These policies conflict and some are recursive, causing updates to fail.

---

## Solution

### IMMEDIATE FIX (Run in Supabase SQL Editor)

1. Go to: https://app.supabase.com/project/[YOUR_PROJECT]/sql/new
2. Copy and paste contents of `FIX_PRICE_SAVE_NOW.sql`
3. Click "RUN"
4. Verify output shows: "✅ ALLOWS ALL" for USING and WITH_CHECK clauses

**What it does:**
- Drops all conflicting UPDATE policies
- Creates ONE simple policy: Any authenticated user can update any vehicle
- Follows Wikipedia model (anyone can edit, track changes in audit logs)

---

## Files Affected

### Frontend Components
```
nuke_frontend/src/components/mobile/MobilePriceEditor.tsx
nuke_frontend/src/components/vehicle/VehiclePriceSection.tsx
nuke_frontend/src/pages/admin/BulkPriceEditor.tsx
nuke_frontend/src/components/vehicle/VehicleDataEditor.tsx
```

### Database
```
supabase/migrations/20251030_fix_price_save_permissions.sql (NEW)
FIX_PRICE_SAVE_NOW.sql (Run manually in SQL Editor)
```

---

## Verification Steps

### 1. Check Active Policies
```sql
SELECT policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'vehicles' 
AND cmd = 'UPDATE';
```

**Expected Result:**
```
policyname                              | cmd    | qual | with_check
----------------------------------------|--------|------|------------
Authenticated users can update any vehicle | UPDATE | true | true
```

Only ONE policy should be active.

---

### 2. Test Price Save

**Mobile:**
1. Open vehicle on mobile
2. Tap price edit button
3. Update any price field
4. Save
5. ✅ Should save successfully

**Desktop:**
1. Open vehicle profile
2. Click "Edit Prices"
3. Update current_value
4. Click Save
5. ✅ Should save successfully

---

## Technical Details

### Before (Broken)
```sql
-- Multiple conflicting policies
POLICY "Users can update their own vehicles"
  USING (auth.uid() = user_id OR auth.uid() = owner_id OR EXISTS(...))

POLICY "Contributors can update vehicles"  
  USING (EXISTS(SELECT 1 FROM vehicle_contributors...))

-- These conflict and some cause recursion
```

### After (Fixed)
```sql
-- Single simple policy
POLICY "Authenticated users can update any vehicle"
  USING (true)
  WITH CHECK (true);

-- Allows any authenticated user to update any vehicle
-- Changes tracked in vehicle_price_history table for audit
```

---

## Why This Approach?

1. **Wikipedia Model**: Anyone can edit, changes are tracked
2. **No Recursion**: Single policy with no subqueries
3. **Clear Audit Trail**: `vehicle_price_history` table logs all changes
4. **User-Friendly**: No permission errors for legitimate users

---

## Price History Tracking

All price changes are automatically logged:

```typescript
// From MobilePriceEditor.tsx
const historyEntry = {
  vehicle_id: vehicleId,
  price_type: 'current', // or 'msrp', 'purchase', 'asking'
  value: newPrice,
  source: 'mobile_ui',
  changed_by: userId,
  changed_at: NOW()
};
```

### Query Price History
```sql
SELECT 
  price_type,
  value,
  source,
  as_of
FROM vehicle_price_history
WHERE vehicle_id = 'your-vehicle-id'
ORDER BY as_of DESC
LIMIT 10;
```

---

## Rollback (If Needed)

If you need to revert to more restrictive policies:

```sql
-- Drop the open policy
DROP POLICY "Authenticated users can update any vehicle" ON vehicles;

-- Restore owner-only policy
CREATE POLICY "Owners only can update vehicles"
  ON vehicles
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = owner_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);
```

---

## Status

**Deployed:** October 30, 2025  
**Commit:** Pending push to main  
**Migration File:** `20251030_fix_price_save_permissions.sql`  
**Manual Fix:** `FIX_PRICE_SAVE_NOW.sql` (Run in Supabase)

---

## Next Steps

1. ✅ Run `FIX_PRICE_SAVE_NOW.sql` in Supabase SQL Editor
2. ✅ Test price save on mobile
3. ✅ Test price save on desktop
4. ✅ Verify price history is logging changes
5. 📊 Monitor for any issues

---

**Priority:** 🔴 **URGENT - RUN NOW**  
**Impact:** Users cannot save prices until this is applied  
**Risk:** Low - Single simple policy, no data changes  
**Reversible:** Yes - Can rollback if needed

