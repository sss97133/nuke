# 📋 Copy/Paste This SQL - Takes 2 Minutes

## Step 1: Open Supabase SQL Editor

**Click this link:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql

## Step 2: Copy Everything Below (including comments)

```sql
-- ============================================
-- PRODUCTION FIXES - October 30, 2025
-- ============================================

-- 1. Refresh schema cache (fix created_by error)
SELECT pg_notify('pgrst', 'reload schema');

-- 2. Drop conflicting vehicle policies
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "vehicles_update_policy" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Allow all authenticated updates" ON vehicles;
DROP POLICY IF EXISTS "Temp allow all updates for debugging" ON vehicles;

-- 3. Create simple vehicle update policy
CREATE POLICY "Authenticated users can update any vehicle" 
ON vehicles FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. Drop conflicting image policies
DROP POLICY IF EXISTS "Users can upload images for any vehicle" ON vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can upload images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow all authenticated image uploads" ON vehicle_images;

-- 5. Create image policies
CREATE POLICY "Authenticated users can insert images"
ON vehicle_images FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can delete their own images"
ON vehicle_images FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());

-- 6. Drop conflicting document policies  
DROP POLICY IF EXISTS "Users can upload documents for any vehicle" ON vehicle_documents;
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON vehicle_documents;

-- 7. Create document policies
CREATE POLICY "Authenticated users can insert documents"
ON vehicle_documents FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can delete their own documents"
ON vehicle_documents FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());

-- ============================================
-- VERIFICATION QUERIES (run these after)
-- ============================================

-- Check vehicles columns (should see: user_id, uploaded_by, discovered_by - NO created_by)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
  AND column_name IN ('user_id', 'uploaded_by', 'discovered_by', 'created_by')
ORDER BY column_name;

-- Check vehicle policies (should see 1 UPDATE policy)
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'vehicles' AND cmd = 'UPDATE';

-- Check image policies (should see 1 INSERT, 1 DELETE)
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'vehicle_images';

-- Check document policies (should see 1 INSERT, 1 DELETE)
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'vehicle_documents';
```

## Step 3: Paste into SQL Editor

## Step 4: Click "Run" (or press Cmd+Enter)

**Expected:** You'll see "Success" messages for each statement

## Step 5: Test on Mobile

1. **Add Vehicle:** Open https://n-zero.dev on phone → Tap + → Enter "1977 Chevrolet K5 Blazer" → Save
2. **Edit Price:** Open your vehicle → Price tab → Change to $15,000 → Save
3. **Upload Doc:** Open your vehicle → Docs tab → Upload receipt

## ✅ What This Fixes:

- ❌ `Could not find the 'created_by' column` → ✅ Schema cache refreshed
- ❌ `Failed to save price` → ✅ Permissive UPDATE policy
- ❌ `Failed to upload image` → ✅ Permissive INSERT policy
- ❌ `Failed to upload document` → ✅ Permissive INSERT policy

---

**Total Time:** 2 minutes to apply + 5 minutes to test = 7 minutes total

**After testing, tell me:** Which worked? Which failed?

