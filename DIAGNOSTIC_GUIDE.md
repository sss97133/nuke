# Diagnostic Guide: Vehicle Relationships & Photo Library Issues

## 🔍 Current Problem

The Vehicles page is showing PGRST201 errors, which means:
- PostgREST can't resolve which FK relationship to use between `vehicles` and `vehicle_images`
- This happens because `vehicle_images` has TWO foreign keys to `vehicles`:
  1. `vehicle_id` (main relationship)
  2. `suggested_vehicle_id` (added Nov 23 for photo library)

## ✅ What Should Be Fixed

1. **RPC Function**: `get_user_vehicle_relationships()` should exist and be callable
2. **Frontend Code**: Should call RPC first, fallback to separate queries
3. **Database Schema**: Two FKs exist (this is correct, but causes PostgREST ambiguity)

## 🔧 Diagnostic Steps

### Step 1: Check if RPC Functions Exist

Run this in Supabase SQL Editor:

```sql
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_user_vehicle_relationships',
    'get_unorganized_photos_optimized',
    'get_photo_library_stats'
  )
ORDER BY routine_name;
```

**Expected Result**: Should see all 3 functions listed.

**If Missing**: Run the migration files manually:
- `supabase/migrations/20250125000007_get_user_vehicle_relationships.sql`
- `supabase/migrations/20250125000008_optimize_photo_library_queries.sql`

---

### Step 2: Check Foreign Keys

```sql
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'vehicle_images'
  AND ccu.table_name = 'vehicles'
ORDER BY tc.constraint_name;
```

**Expected Result**: Should see 2 FKs:
- `vehicle_images_vehicle_id_fkey` → `vehicles.id`
- `vehicle_images_suggested_vehicle_id_fkey` → `vehicles.id`

---

### Step 3: Test RPC Function Manually

Replace `YOUR_USER_ID` with your actual user ID:

```sql
SELECT get_user_vehicle_relationships('YOUR_USER_ID'::uuid);
```

**Expected Result**: Should return JSON with `user_added_vehicles`, `discovered_vehicles`, `verified_ownerships`.

**If Error**: Check the error message - likely permission or schema issue.

---

### Step 4: Check Browser Console

After rebuilding frontend, check console for:

**Good Signs**:
- `[Vehicles] Attempting to call RPC function: get_user_vehicle_relationships`
- `[Vehicles] ✅ RPC function succeeded, using optimized path`
- `[Vehicles] RPC data keys: ['user_added_vehicles', 'discovered_vehicles', 'verified_ownerships']`

**Bad Signs**:
- `[Vehicles] RPC function error: ...` (shows why RPC failed)
- `[Vehicles] RPC function not available, using fallback queries` (RPC doesn't exist)
- `Error loading added vehicles: {code: 'PGRST201'...}` (fallback is still using old queries)

---

### Step 5: Check Frontend Build

The console errors you're seeing suggest the **old code is still running**. 

**Check**:
1. Is the frontend rebuilt? (`npm run build` in `nuke_frontend/`)
2. Is the new bundle deployed?
3. Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)

**Verify New Code**:
- Open browser DevTools → Network tab
- Look for request to `/rest/v1/rpc/get_user_vehicle_relationships`
- If you see this request, the new code is running
- If you see requests to `/rest/v1/vehicles?select=...vehicle_images`, old code is running

---

## 🐛 Common Issues & Fixes

### Issue 1: RPC Function Doesn't Exist

**Symptom**: Console shows "RPC function not available"

**Fix**: Run migrations manually in Supabase SQL Editor

### Issue 2: RPC Function Exists But Returns Error

**Symptom**: Console shows RPC error with code/message

**Common Causes**:
- Permission issue: Function needs `GRANT EXECUTE TO authenticated`
- Schema issue: Function references non-existent columns
- RLS issue: Function can't access data due to RLS policies

**Fix**: Check error message and fix accordingly

### Issue 3: Old Frontend Code Still Running

**Symptom**: Still seeing PGRST201 errors, no RPC call in Network tab

**Fix**: 
1. Rebuild frontend: `cd nuke_frontend && npm run build`
2. Deploy to hosting
3. Hard refresh browser
4. Check Network tab for RPC calls

### Issue 4: RPC Works But Returns Empty Data

**Symptom**: RPC succeeds but `user_added_vehicles` is empty

**Possible Causes**:
- User has no vehicles
- RLS policies blocking data
- Function logic issue

**Fix**: Test RPC manually with SQL to see what it returns

---

## 📊 Database Schema Summary

**vehicle_images table**:
- `vehicle_id` → `vehicles.id` (FK, nullable after Nov 23)
- `suggested_vehicle_id` → `vehicles.id` (FK, nullable, added Nov 23)

**Why PGRST201 Happens**:
When PostgREST sees `vehicles?select=*,vehicle_images(*)`, it doesn't know which FK to use:
- Should it use `vehicle_id`? (main relationship)
- Should it use `suggested_vehicle_id`? (suggestion relationship)

**Solution**: Use RPC function with explicit JOINs instead of PostgREST embedding.

---

## 🚀 Next Steps

1. **Run diagnostic SQL** (Step 1-3 above) to verify database state
2. **Check browser console** for RPC call attempts
3. **Rebuild frontend** if old code is still running
4. **Check Network tab** to see if RPC is being called
5. **Share results** so we can pinpoint the exact issue


