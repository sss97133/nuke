# URGENT: Fix Image Upload (403 Forbidden Error)

## The Problem
- Image uploads are failing with **403 Forbidden** error
- This is due to Row Level Security (RLS) policies on the `vehicle_images` table being too restrictive
- The upload button shows, processes the image, but nothing happens because the database insert is rejected

## The Solution
Run this SQL in your Supabase SQL Editor:

**Go to**: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new

**Copy and paste this entire SQL block**:

```sql
-- Fix RLS policies for vehicle_images to allow uploads

-- Drop all existing restrictive policies
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can update images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can delete images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners and contributors to insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners to update images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners to delete images" ON vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can insert images for vehicles they own" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update their own images or vehicle images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete their own images or vehicle images" ON vehicle_images;

-- Create simple, working INSERT policy
CREATE POLICY "vehicle_images_insert_policy" 
ON vehicle_images FOR INSERT 
WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = vehicle_id
        AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
    )
);

-- Allow UPDATE for image uploader or vehicle owner
CREATE POLICY "vehicle_images_update_policy" 
ON vehicle_images FOR UPDATE 
USING (
    auth.uid() IS NOT NULL
    AND (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
    )
);

-- Allow DELETE for image uploader or vehicle owner  
CREATE POLICY "vehicle_images_delete_policy"
ON vehicle_images FOR DELETE
USING (
    auth.uid() IS NOT NULL
    AND (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
    )
);

-- Verify the policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd
FROM pg_policies 
WHERE tablename = 'vehicle_images'
ORDER BY policyname;
```

**Click "Run"** - You should see 3 new policies created.

---

## About the Timeline (Not a Bug)

The timeline is showing **2 events in 2025** because:
- It loaded all 149 events successfully ✅
- The timeline filters by YEAR (by design)
- Most of your images have EXIF dates from other years
- **To see other years**: Click on the year buttons on the right side of the timeline

The year selector shows all years that have events. Click different years to see those events.

---

## After Running the SQL

1. Go back to: https://n-zero.dev/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c
2. Try uploading an image
3. It should work now! 🎉

---

## Why This Happened

The previous RLS policies were checking for tables (`vehicle_user_permissions`) that either:
- Don't exist yet in your schema
- Or the user isn't in them

The new policies are simpler: they just check if you own the vehicle (`vehicles.user_id` or `vehicles.uploaded_by`).

