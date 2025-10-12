# Fix tool-data Bucket RLS Policies

## Problem
Receipt files are being stored as base64 in the database (bloats data by 33%) instead of uploading to S3 because RLS policies block uploads.

## Solution: Fix in Supabase Dashboard

### Step 1: Open Supabase Dashboard
Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam

### Step 2: Navigate to Storage Policies
1. Click **Storage** in left sidebar
2. Click **Policies** tab
3. Find the **tool-data** bucket

### Step 3: Add INSERT Policy

Click **"New Policy"** on tool-data bucket and add:

**Policy Name:** `Allow authenticated users to upload receipts`

**Allowed Operation:** `INSERT`

**Target Roles:** `authenticated`

**Policy Definition (WITH CHECK):**
```sql
bucket_id = 'tool-data' 
AND (storage.foldername(name))[1] = auth.uid()::text
```

This allows users to upload files to their own folder: `tool-data/{user_id}/receipts/...`

### Step 4: Add SELECT Policy (Read)

Click **"New Policy"** again:

**Policy Name:** `Allow authenticated users to read their receipts`

**Allowed Operation:** `SELECT`

**Target Roles:** `authenticated`

**Policy Definition (USING):**
```sql
bucket_id = 'tool-data' 
AND (storage.foldername(name))[1] = auth.uid()::text
```

### Step 5: Add UPDATE Policy (Optional)

**Policy Name:** `Allow authenticated users to update their receipts`

**Allowed Operation:** `UPDATE`

**Target Roles:** `authenticated`

**Policy Definition (USING):**
```sql
bucket_id = 'tool-data' 
AND (storage.foldername(name))[1] = auth.uid()::text
```

### Step 6: Add DELETE Policy

**Policy Name:** `Allow authenticated users to delete their receipts`

**Allowed Operation:** `DELETE`

**Target Roles:** `authenticated`

**Policy Definition (USING):**
```sql
bucket_id = 'tool-data' 
AND (storage.foldername(name))[1] = auth.uid()::text
```

## Test After Setup

Run this in your browser console after logging in:

```javascript
const { data, error } = await supabase.storage
  .from('tool-data')
  .upload('test-upload.txt', new Blob(['test']), {
    cacheControl: '3600',
    upsert: false
  });

console.log('Upload test:', { data, error });
```

Should see success, not an RLS error!

## What This Fixes

✅ Files upload to S3 properly  
✅ No more database bloat from base64  
✅ Better performance and scalability  
✅ Proper file organization by user  

Files will be stored at:
```
tool-data/
  └── {user-id}/
      └── receipts/
          ├── 1234567890_receipt.pdf
          ├── 1234567891_snap-on.jpg
          └── ...
```
