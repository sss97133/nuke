# Fix Vehicle Edit Permissions - URGENT

## Problem

You're seeing "You do not have permission to edit this vehicle" because:

1. **Frontend checking wrong table** - `EditVehicle.tsx` was checking `vehicle_contributor_roles` (old table)
2. **RLS policies checking different table** - Database RLS checks `vehicle_contributors` (new table)
3. **Multiple conflicting RLS policies** - 3 different UPDATE policies on vehicles table
4. **Missing permission columns** - `vehicle_contributors` table missing `can_edit`, `can_delete`, etc.

## Root Cause

There's a mismatch between what the frontend thinks is the permission table vs what the database actually checks. Plus you have a super-permissive policy "Any authenticated user can edit vehicles" which means the database WOULD allow the edit, but the frontend blocks you first!

---

## Solution Deployed

### 1. New Migration: `20251122150004_fix_vehicle_edit_permissions.sql`

**What it does:**
- ✅ Drops ALL conflicting RLS policies (3 duplicates removed)
- ✅ Creates ONE comprehensive policy checking ALL permission sources
- ✅ Adds missing columns to `vehicle_contributors` table (`can_edit`, `can_delete`, etc.)
- ✅ Syncs data from old `vehicle_contributor_roles` to new `vehicle_contributors`
- ✅ Creates `user_can_edit_vehicle()` function for easy permission checks
- ✅ Creates `vehicle_permissions_debug` view for troubleshooting

### 2. Frontend Fix: `EditVehicle.tsx`

**Changed from:**
```typescript
// OLD: Checked vehicle_contributor_roles table directly
const { data: contribData } = await supabase
  .from('vehicle_contributor_roles')
  .select('role')
  ...
```

**Changed to:**
```typescript
// NEW: Uses RPC function that checks ALL permission sources
const { data: canEdit } = await supabase
  .rpc('user_can_edit_vehicle', {
    p_vehicle_id: vehicleId,
    p_user_id: user?.id
  });
```

---

## Permission Sources Checked

The new comprehensive policy checks **ALL** of these (you only need ONE to edit):

1. ✅ **uploaded_by** - You originally created the vehicle
2. ✅ **user_id** - You're set as user_id (legacy field)
3. ✅ **owner_id** - You're set as owner_id (legacy field)
4. ✅ **vehicle_contributors** - You have an active contributor role with `can_edit = true`
5. ✅ **vehicle_contributor_roles** - You have a role in the old table (backwards compatibility)
6. ✅ **organization_vehicles + organization_contributors** - You're a member of an org that owns the vehicle

---

## Deployment Steps

```bash
cd /Users/skylar/nuke

# 1. Deploy the permission fix migration
supabase db push

# 2. Deploy frontend fix
cd nuke_frontend
# (frontend changes already accepted by user)

# 3. Deploy to production
cd /Users/skylar/nuke
vercel --prod --force --yes

# 4. Verify deployment
curl -s https://n-zero.dev | grep -o '_next/static/[^/]*' | head -1
```

---

## Testing After Deployment

### Test 1: Check Your Permissions

```sql
-- See if you can edit a specific vehicle
SELECT user_can_edit_vehicle(
  'VEHICLE_ID_HERE',
  'YOUR_USER_ID_HERE'
);
-- Should return: true
```

### Test 2: Debug Permissions

```sql
-- See all permission paths for a vehicle
SELECT * FROM vehicle_permissions_debug
WHERE vehicle_id = 'VEHICLE_ID_HERE';

-- This will show:
-- - uploaded_by, user_id, owner_id
-- - contributors list
-- - old_contributor_roles list
-- - org_access list
```

### Test 3: Try Editing a Vehicle

1. Go to `/vehicle/VEHICLE_ID/edit`
2. Should load without "You do not have permission" error
3. Make a change and save
4. Should successfully update

---

## Why This Happened

**Historical Context:**

1. **Old System** used `vehicle_contributor_roles` table
2. **New System** (from today) uses `vehicle_contributors` table with more features
3. **Frontend** wasn't updated to use new table
4. **RLS policies** were added ad-hoc over time, creating conflicts

**Result:** Frontend and database were checking different things!

---

## What Changed

### Before:
```
Frontend checks: vehicle_contributor_roles
Database allows: ANY authenticated user (!)
Result: Frontend blocks you even though database would allow it
```

### After:
```
Frontend checks: user_can_edit_vehicle() function
Database allows: Comprehensive check of all permission sources
Result: Both frontend and database agree on permissions
```

---

## Common Scenarios

### Scenario 1: You created the vehicle
**Before:** ❌ "No permission" (frontend checked contributor table)
**After:** ✅ Can edit (checks uploaded_by)

### Scenario 2: You're in an organization that owns it
**Before:** ❌ "No permission" (frontend didn't check org membership)
**After:** ✅ Can edit (checks organization_contributors)

### Scenario 3: You were added as a collaborator
**Before:** ❌ "No permission" (frontend checked wrong table)
**After:** ✅ Can edit (checks vehicle_contributors)

---

## Admin Tools

### Add Someone as a Contributor

```sql
INSERT INTO vehicle_contributors (
  vehicle_id,
  user_id,
  role,
  can_edit,
  can_delete,
  status
) VALUES (
  'VEHICLE_ID',
  'USER_ID',
  'contributor',
  true,  -- can edit
  false, -- cannot delete
  'active'
);
```

### Check All Policies on Vehicles Table

```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'vehicles'
ORDER BY cmd, policyname;
```

### See Who Has Access to a Vehicle

```sql
SELECT * FROM vehicle_permissions_debug
WHERE vehicle_id = 'VEHICLE_ID';
```

---

## Rollback (If Needed)

If something breaks:

```sql
-- Restore the old permissive policy temporarily
CREATE POLICY "temp_permissive_for_rollback"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Then investigate what went wrong using:
SELECT * FROM vehicle_permissions_debug WHERE vehicle_id = 'PROBLEM_VEHICLE_ID';
```

---

## Success Metrics

After deployment, you should be able to:
- ✅ Edit any vehicle you created
- ✅ Edit any vehicle in your organization
- ✅ Edit any vehicle where you're a contributor
- ✅ See clear permission errors if you truly don't have access

---

## Notes

- **Backwards Compatible** - Still checks old `vehicle_contributor_roles` table
- **Organization-Aware** - Checks org membership automatically
- **Debuggable** - `vehicle_permissions_debug` view shows everything
- **Secure** - No more overly-permissive "anyone can edit" policy
- **Fast** - Single RPC function call instead of multiple queries

---

**Deploy this NOW to fix the permission issue!**

