# Storage RLS Configuration Guide

## Current Status
The `tool-data` bucket is created but lacks INSERT policies, preventing direct file uploads.
Currently using base64 encoding as a workaround.

## S3 Credentials (for debugging)
```
Access Key ID: 6bd04f9857cbf16fddf175fe74ffa5f4
Secret Access Key: f7b2dd91ea42ec028fc42e60473e5caafb7be6745ab8ba4a0a95a02b0a21a616
```

## To Fix RLS Policies in Supabase Dashboard

### Step 1: Navigate to Storage Policies
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project (qkgaybvrernstplzjaam)
3. Go to **Storage** → **Policies**
4. Select the `tool-data` bucket

### Step 2: Add INSERT Policy
Click **New Policy** → **For full customization** and add:

```sql
-- Policy Name: Allow authenticated uploads
-- Operation: INSERT
-- Target Roles: authenticated

-- Policy Definition:
true
```

Or for more restrictive (user-specific folders):
```sql
(auth.uid()::text = (storage.foldername(name))[1])
```

### Step 3: Add SELECT Policy (if needed)
```sql
-- Policy Name: Public read access
-- Operation: SELECT
-- Target Roles: anon, authenticated

-- Policy Definition:
true
```

### Step 4: Add UPDATE Policy
```sql
-- Policy Name: Users can update their own files
-- Operation: UPDATE
-- Target Roles: authenticated

-- Policy Definition:
(auth.uid()::text = (storage.foldername(name))[1])
```

### Step 5: Add DELETE Policy
```sql
-- Policy Name: Users can delete their own files
-- Operation: DELETE
-- Target Roles: authenticated

-- Policy Definition:
(auth.uid()::text = (storage.foldername(name))[1])
```

## Alternative: Use SQL (requires service role key)
```sql
-- Run with service role privileges
CREATE POLICY "Allow authenticated uploads to tool-data" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'tool-data');

CREATE POLICY "Allow public viewing of tool-data" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'tool-data');
```

## Testing
After configuring, test with:
```bash
node scripts/fix-storage-rls.js
```

## Current Workaround
The system currently uses base64 encoding to store receipt files directly in the database, which:
- ✅ Bypasses all RLS restrictions
- ✅ Works immediately without configuration
- ⚠️ Increases data size by ~33%
- ⚠️ Not ideal for large files

Once RLS policies are configured, update `receiptService.ts` to use direct uploads again.
