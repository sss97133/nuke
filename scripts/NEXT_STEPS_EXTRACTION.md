# Next Steps: Image Extraction Pipeline

## Current Status

✅ **Code is ready:**
- `analyze-image` function deployed with Rekognition + Appraiser Brain + SPID extraction
- Database schema ready (`vehicle_spid_data` table exists)
- Upload service fixed to call `analyze-image`
- Batch processing script created

⚠️ **Needs verification:**
- 1 image was scanned but has no extraction data (function ran but failed)
- Edge Function secrets may be invalid/expired
- Need to test with real images before batch processing

## The Issue

**1 image has `scanned_at` but no data:**
- Function was called
- `scanned_at` timestamp was saved
- But Rekognition/Appraiser/SPID data is missing

This suggests:
- Function executed but AWS/OpenAI calls failed
- Secrets might be configured but invalid/expired
- Or function errored silently

## Verification Steps

### 1. Check Edge Function Secrets
Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

Verify these secrets exist and are valid:
- `OPENAI_API_KEY` - Should be a valid OpenAI API key
- `AWS_ACCESS_KEY_ID` - Should be valid AWS credentials
- `AWS_SECRET_ACCESS_KEY` - Should match the access key
- `SERVICE_ROLE_KEY` - Should be your Supabase service role key

### 2. Test with Small Batch
Before processing all 2,539 images, test with a small batch:

```bash
# Test with one specific vehicle (Bronco with SPID sheets)
node scripts/batch_process_images.js e08bf694-970f-4cbe-8a74-8715158a0f2e
```

Then check database:
```sql
SELECT 
  id,
  ai_scan_metadata->>'scanned_at' as scanned_at,
  CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 'Yes' ELSE 'No' END as has_rekognition,
  CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 'Yes' ELSE 'No' END as has_appraiser,
  CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 'Yes' ELSE 'No' END as has_spid
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND ai_scan_metadata->>'scanned_at' IS NOT NULL
ORDER BY (ai_scan_metadata->>'scanned_at')::timestamp DESC
LIMIT 10;
```

### 3. Check for SPID Data
If SPID sheets are detected, check:
```sql
SELECT * FROM vehicle_spid_data 
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
```

### 4. If Test Succeeds, Run Full Batch
```bash
# Process all unprocessed images
node scripts/batch_process_images.js
```

## What Success Looks Like

After processing, you should see:
- `vehicle_images.ai_scan_metadata.rekognition` - Array of AWS labels
- `vehicle_images.ai_scan_metadata.appraiser` - Structured Yes/No checklist
- `vehicle_images.ai_scan_metadata.spid` - SPID extraction (if SPID sheet found)
- `vehicle_spid_data` table - Structured SPID records
- `image_tags` table - Auto-generated tags

## If Test Fails

Check Edge Function logs:
- Dashboard: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions
- Look for `analyze-image` errors
- Common errors:
  - "AWS credentials not configured"
  - "OpenAI API key invalid"
  - "Failed to download image"

## Summary

The extraction pipeline is **code-complete** but needs **verification**:
1. ✅ Function code is correct
2. ✅ Database schema is ready
3. ⚠️ Need to verify secrets are valid
4. ⚠️ Need to test with real images
5. ⚠️ Then run full batch processing

