-- ============================================
-- MANUAL FIX: Apply These in Supabase SQL Editor
-- ============================================
-- URL: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
--
-- Migration system is broken (local/remote out of sync).
-- Apply these fixes manually, then we'll reset migrations.
-- ============================================

-- 1. REFRESH SCHEMA CACHE (Fix "created_by" error)
SELECT pg_notify('pgrst', 'reload schema');

-- 2. VERIFY VEHICLES TABLE COLUMNS
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
  AND column_name IN ('user_id', 'uploaded_by', 'discovered_by', 'created_by')
ORDER BY column_name;
-- Expected: user_id, uploaded_by, discovered_by (NO created_by)

-- ============================================
-- 3. FIX PRICE SAVE PERMISSIONS
-- ============================================

-- Drop conflicting policies
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "vehicles_update_policy" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Allow all authenticated updates" ON vehicles;
DROP POLICY IF EXISTS "Temp allow all updates for debugging" ON vehicles;

-- Create simple permissive policy
CREATE POLICY "Authenticated users can update any vehicle" 
ON vehicles FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. FIX IMAGE UPLOAD PERMISSIONS
-- ============================================

-- Drop conflicting image policies
DROP POLICY IF EXISTS "Users can upload images for any vehicle" ON vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can upload images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow all authenticated image uploads" ON vehicle_images;

-- Create simple image upload policy
CREATE POLICY "Authenticated users can insert images"
ON vehicle_images FOR INSERT
TO authenticated
WITH CHECK (true);

-- Create image delete policy
CREATE POLICY "Users can delete their own images"
ON vehicle_images FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());

-- ============================================
-- 5. FIX DOCUMENT UPLOAD PERMISSIONS
-- ============================================

-- Drop conflicting document policies
DROP POLICY IF EXISTS "Users can upload documents for any vehicle" ON vehicle_documents;
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON vehicle_documents;

-- Create simple document upload policy
CREATE POLICY "Authenticated users can insert documents"
ON vehicle_documents FOR INSERT
TO authenticated
WITH CHECK (true);

-- Create document delete policy
CREATE POLICY "Users can delete their own documents"
ON vehicle_documents FOR DELETE
TO authenticated
USING (uploaded_by = auth.uid());

-- ============================================
-- 6. VERIFY FIXES
-- ============================================

-- Check vehicles policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'vehicles'
ORDER BY policyname;

-- Check image policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'vehicle_images'
ORDER BY policyname;

-- Check document policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'vehicle_documents'
ORDER BY policyname;

-- ============================================
-- DONE! Now test on mobile:
-- 1. Add vehicle (should work - no more created_by error)
-- 2. Edit price (should work - permissive policy)
-- 3. Upload document (should work - permissive policy)
-- ============================================

