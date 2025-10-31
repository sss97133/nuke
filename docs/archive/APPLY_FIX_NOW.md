# Apply Vehicle Policy Fix to Production

## Step 1: Open Supabase SQL Editor

Go to: **https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new**

## Step 2: Copy and Paste This SQL

```sql
-- FIX VEHICLE UPDATE POLICY RECURSION

-- Drop the problematic combined policy
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;

-- Create Policy 1: Direct owners can update
CREATE POLICY "Owners can update their vehicles"
  ON vehicles
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = owner_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);

-- Create Policy 2: Contributors can update (separate policy breaks recursion)
CREATE POLICY "Contributors can update vehicles"
  ON vehicles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_contributors 
      WHERE vehicle_contributors.vehicle_id = vehicles.id 
      AND vehicle_contributors.user_id = auth.uid()
    )
  );
```

## Step 3: Click "RUN" (bottom right)

## Step 4: Verify Success

You should see: ✓ Success. No rows returned

## Step 5: Test the Fix

1. Go back to: https://n-zero.dev/admin/price-editor
2. Try editing and saving a price
3. Should work without the 500 error!

---

## What This Does

- **Removes** the combined policy that was causing recursion
- **Splits** into two separate policies (owner check + contributor check)
- **Breaks** the recursion loop by evaluating them separately
- **Keeps** all the same permissions - owners and contributors can still update

## Expected Result

✅ No more "infinite recursion detected in policy" error
✅ You can now save price changes in the bulk editor

