# Upload Tools Audit & RLS Fixes

## Executive Summary

Complete audit of all upload tools (images, documents, receipts) and their database/storage RLS policies. Found several issues with policy conflicts and missing permissions.

## 🔍 Upload Components Inventory

### 1. **Image Upload Components**
- `ImageUploader.tsx` - Main vehicle image uploader (uses ImageUploadService)
- `UniversalImageUpload.tsx` - Universal image upload wrapper
- `ImageGallery.tsx` - Gallery with upload functionality  
- `SimpleImageViewer.tsx` - Simple viewer with upload
- `RapidCameraCapture.tsx` - Mobile camera capture
- `ProImageViewer.tsx` - Professional image viewer
- `BulkImageUploader.tsx` - Bulk upload tool

**Tables Used:**
- `vehicle_images` (main table)
- `timeline_events` (automatic event creation)

**Storage Buckets:**
- `vehicle-images` (primary)
- `vehicle-data` (fallback)

### 2. **Document Upload Components**
- `VehicleDocumentUploader.tsx` - General document uploads (receipts, invoices, etc.)
- `SmartInvoiceUploader.tsx` - Invoice/receipt parser

**Tables Used:**
- `vehicle_documents`
- `timeline_events` (optional)

**Storage Buckets:**
- `vehicle-data` (path: `vehicles/{vehicleId}/documents/`)

### 3. **Receipt/Tool Upload Components**
- `ProfessionalToolbox.tsx` - Tool receipt import
- Receipt parsing services calling backend

**Tables Used:**
- `receipts`
- `line_items`  
- `payment_records`
- `user_tools`
- `tool_receipt_documents`

**Storage Buckets:**
- `tool-data` (path: `{userId}/receipts/`)

---

## 🚨 Issues Found

### Issue #1: Storage Bucket Policy Conflicts
**Problem:** Multiple overlapping/conflicting policies on `storage.objects`

**Evidence:**
```
For vehicle-images bucket:
- allow_authenticated_uploads_vehicle_images (INSERT, check: bucket_id = 'vehicle-images')
- allow_public_read_vehicle_images (SELECT, using: bucket_id = 'vehicle-images')
- authenticated update vehicle-images (UPDATE)
- authenticated delete vehicle-images (DELETE)

For vehicle-data bucket:
- allow_public_read_vehicle_data
- auth_write_vehicle_data  
- auth_update_vehicle_data
- auth_delete_vehicle_data
- public_read_vehicle_data_vehicles (name LIKE 'vehicles/%')
- Multiple redundant policies
```

**Impact:** Policies are permissive but messy - works but inefficient

---

### Issue #2: Timeline Events Has Conflicting INSERT Policies
**Problem:** Two INSERT policies on `timeline_events` - one restrictive, one permissive

**Evidence:**
```sql
Policy 1: "Users can create timeline events for their vehicles"
  CHECK: auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM vehicles 
    WHERE id = vehicle_id AND (uploaded_by = auth.uid() OR owner_id = auth.uid())
  )

Policy 2: "authenticated_can_insert_timeline_events"  
  CHECK: true  -- ⚠️ OVERLY PERMISSIVE!
```

**Impact:** The `true` policy allows anyone to insert timeline events for ANY vehicle. This is a security issue.

---

### Issue #3: vehicle_images Field Confusion
**Problem:** Policies check `vehicles.user_id` which is a GENERATED column from `uploaded_by`, but some policies also check `owner_id`

**Evidence:**
```sql
vehicles table:
- user_id (GENERATED, default: uploaded_by)  
- uploaded_by (actual creator)
- owner_id (current owner, may differ)

All 22 vehicles have:
- user_id = uploaded_by (always)
- owner_id populated on 20 of 22
```

**Recommendation:** Use `uploaded_by` consistently in RLS policies, not the generated `user_id` field.

---

### Issue #4: Missing vehicle_images INSERT Policy for Contributors
**Problem:** The main INSERT policy only checks vehicle owner, not contributors

**Current Policy:**
```sql
"authenticated_upload_vehicle_images"
WITH CHECK (auth.uid() = user_id)
```

**Missing:** No check for `vehicle_user_permissions` or `vehicle_contributor_roles`

---

### Issue #5: Receipts Table Has No vehicle_id Foreign Key
**Problem:** `receipts` table uses `scope_id` (text) instead of proper FK to vehicles

**Evidence:**
```sql
receipts table has:
- vehicle_id UUID (nullable, has FK constraint)  
- scope_type TEXT
- scope_id TEXT (not a FK!)
```

**Policy checks scope_id:**
```sql
"Users can view vehicle receipts"
  USING ((scope_type = 'vehicle' AND EXISTS (
    SELECT 1 FROM vehicles WHERE id::text = scope_id AND uploaded_by = auth.uid()
  )) OR (scope_type = 'user' AND user_id = auth.uid()))
```

**Impact:** Inefficient text comparison instead of FK join

---

### Issue #6: tool-data Bucket Uses Folder-Based Permissions
**Problem:** Policies require `(foldername(name))[1] = auth.uid()::text` which means uploads must be in `{userId}/...` path structure

**Current Policy:**
```sql
"Allow authenticated users to upload receipts"
  WITH CHECK (bucket_id = 'tool-data' AND (foldername(name))[1] = auth.uid()::text)
```

**Impact:** If upload path doesn't match user's UUID, upload fails. Need to verify frontend uses correct paths.

---

## ✅ Working Correctly

### Storage Buckets - All Created
- ✅ `vehicle-images` (public, 5MB limit, images only)
- ✅ `vehicle-data` (public, unlimited, any type)  
- ✅ `tool-data` (public, 50MB, receipts/images/PDFs)
- ✅ `receipts` (public, 50MB, fully permissive policies)
- ✅ `ownership-documents` (private, 10MB, images/PDFs)
- ✅ `user-documents` (public, 50MB, most types)

### Table Policies - Mostly Good
- ✅ `receipts` - Users can manage their own (permissive)
- ✅ `line_items` - Users can CRUD their own
- ✅ `user_tools` - Users can CRUD their own  
- ✅ `vehicle_documents` - Multiple permissive policies (works for contributors)

---

## 🔧 Fixes Needed

### Fix 1: Clean Up Timeline Events INSERT Policies
**Remove overly permissive policy:**

```sql
-- Drop the dangerous "anyone can insert" policy
DROP POLICY IF EXISTS "authenticated_can_insert_timeline_events" ON timeline_events;

-- Keep only the proper restrictive policy
-- (already exists: "Users can create timeline events for their vehicles")
```

### Fix 2: Add Contributor Support to vehicle_images
**Add missing INSERT policy for contributors:**

```sql
-- Add policy to allow contributors to upload images
CREATE POLICY "Contributors can upload vehicle images" ON vehicle_images
  FOR INSERT 
  WITH CHECK (
    auth.uid() = user_id
    AND (
      -- Vehicle owner via uploaded_by
      EXISTS (
        SELECT 1 FROM vehicles v 
        WHERE v.id = vehicle_id 
        AND v.uploaded_by = auth.uid()
      )
      -- OR active contributor
      OR EXISTS (
        SELECT 1 FROM vehicle_contributor_roles vcr
        WHERE vcr.vehicle_id = vehicle_images.vehicle_id
        AND vcr.user_id = auth.uid()
        AND vcr.is_active = true
      )
      -- OR has vehicle permissions
      OR EXISTS (
        SELECT 1 FROM vehicle_user_permissions vup
        WHERE vup.vehicle_id = vehicle_images.vehicle_id
        AND vup.user_id = auth.uid()
        AND vup.is_active = true
      )
    )
  );
```

### Fix 3: Consolidate Storage Bucket Policies
**Remove duplicate policies:**

```sql
-- Keep only one SELECT policy per bucket
DROP POLICY IF EXISTS "allow_public_read_vehicle_images" ON storage.objects;
DROP POLICY IF EXISTS "list: auth vehicle-data" ON storage.objects;  
DROP POLICY IF EXISTS "read: public vehicle-data" ON storage.objects;

-- Keep simplified set:
-- vehicle-images: public_read_vehicle_images
-- vehicle-data: public_read_vehicle_data_vehicles (name LIKE 'vehicles/%')
```

### Fix 4: Verify Frontend Upload Paths
**Check these services use correct paths:**

1. **ImageUploadService** - Uses `{vehicleId}/{uniqueId}.ext` ✅ CORRECT
2. **ReceiptService** - Uses `{userId}/receipts/{timestamp}_{filename}` ✅ CORRECT
3. **SmartInvoiceUploader** - Uses `vehicles/{vehicleId}/documents/{filename}` ✅ CORRECT

---

## 📊 RLS Policy Summary

### vehicle_images (NEEDS FIX)
**Current:**
- ✅ SELECT: Public read (anyone)
- ✅ INSERT: Authenticated users (auth.uid() = user_id)
- ❌ MISSING: Contributor INSERT policy
- ✅ UPDATE/DELETE: Owner manages

**Action:** Add contributor INSERT policy

### timeline_events (NEEDS FIX)
**Current:**
- ✅ SELECT: Multiple policies (vehicle owner, public vehicles)
- ⚠️ INSERT: Two policies (one TOO PERMISSIVE)
- ✅ UPDATE/DELETE: Owner only

**Action:** Drop `authenticated_can_insert_timeline_events` policy

### receipts (WORKING)
- ✅ SELECT: User can view own + vehicle-scoped receipts
- ✅ INSERT: User creates own
- ✅ UPDATE/DELETE: User manages own
- ✅ ALL: Comprehensive management policy

### line_items (WORKING)
- ✅ All CRUD operations: User manages own (auth.uid() = user_id)

### user_tools (WORKING)
- ✅ All CRUD operations: User manages own (auth.uid() = user_id)

### vehicle_documents (WORKING)
- ✅ SELECT: Owner, verified users, contributors, public docs
- ✅ INSERT: `authenticated_can_insert_vehicle_documents` (permissive ✅)
- ✅ ALL: Contributors can manage (comprehensive policy)

### tool_receipt_documents (WORKING)
- ✅ SELECT: User views own + moderators view all
- ✅ INSERT/UPDATE: User manages own

---

## 🎯 Recommended Actions

### Immediate (Fix Security Issues)
1. ✅ Drop `authenticated_can_insert_timeline_events` policy (security risk)
2. ✅ Add contributor INSERT policy for `vehicle_images`

### Medium Priority (Cleanup)
3. Consolidate duplicate storage bucket policies
4. Add indexes on frequently queried columns (vehicle_id, user_id)

### Low Priority (Optimization)
5. Consider changing `receipts.scope_id` from TEXT to proper FK
6. Add comments to all policies explaining their purpose

---

## 🧪 Test Plan

For each upload component, test:
1. ✅ Owner uploads (should always work)
2. ❌ Contributor uploads (currently fails for images)
3. ✅ Public uploads where allowed (documents, receipts)
4. ✅ Storage bucket access (public buckets accessible)

---

## 📝 SQL Migration Script

See `20251028_fix_upload_rls_policies.sql` for complete migration.


