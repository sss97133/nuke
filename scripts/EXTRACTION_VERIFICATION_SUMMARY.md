# Image Extraction Pipeline - Verification Summary

## The Problem

**2,539 unprocessed images** (92.6% of 2,742 total)
- Only 1 image has `scanned_at` timestamp
- **0 images** have Rekognition, Appraiser, or SPID data
- Function exists and is deployed, but hasn't been called successfully

## What We've Fixed

1. ✅ **Upload Service** - Now calls `analyze-image` instead of old `auto-analyze-upload`
2. ✅ **SPID Table** - Created `vehicle_spid_data` table for structured storage
3. ✅ **Function Code** - `analyze-image` includes Rekognition + Appraiser Brain + SPID extraction
4. ✅ **Batch Script** - Created `batch_process_images.js` for processing existing images

## What Needs Verification

### Edge Function Secrets (in Supabase Dashboard)
The function needs these secrets configured:
- `OPENAI_API_KEY` - For Appraiser Brain + SPID extraction
- `AWS_ACCESS_KEY_ID` - For Rekognition
- `AWS_SECRET_ACCESS_KEY` - For Rekognition
- `SERVICE_ROLE_KEY` - For database access

**Dashboard**: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

### Client API Key (for invoking functions)
The test scripts need a valid API key to invoke the function:
- `VITE_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`

## How to Verify Extraction Works

### Option 1: Test via UI
1. Go to any vehicle profile
2. Open an image in Lightbox
3. Click "AI" button
4. Check if "Appraiser Notes" appear in Details tab
5. Check database: `vehicle_images.ai_scan_metadata` should have data

### Option 2: Check Database After Processing
After running batch processing, verify:
```sql
-- Check processed images
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 1 END) as has_rekognition,
  COUNT(CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 1 END) as has_appraiser,
  COUNT(CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 1 END) as has_spid
FROM vehicle_images
WHERE ai_scan_metadata->>'scanned_at' IS NOT NULL;
```

### Option 3: Small Test Batch
Run batch script on just 10 images first:
```bash
# Process just one vehicle (smaller test)
node scripts/batch_process_images.js e08bf694-970f-4cbe-8a74-8715158a0f2e
```

Then check database to see if data was extracted.

## Expected Results After Processing

- `vehicle_images.ai_scan_metadata.rekognition` - AWS labels array
- `vehicle_images.ai_scan_metadata.appraiser` - Structured Yes/No checklist
- `vehicle_images.ai_scan_metadata.spid` - SPID extraction (if detected)
- `vehicle_spid_data` table - Structured SPID records with VIN, RPO codes
- `image_tags` table - Auto-generated tags from Rekognition

## Current Status

- ✅ Function code is correct
- ✅ Database schema is ready
- ✅ Upload service fixed
- ⚠️ Need to verify Edge Function secrets are valid
- ⚠️ Need to test with real images
- ⚠️ Need to run batch processing

