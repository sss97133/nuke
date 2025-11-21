# Batch Processing Status

## Current Status

- **Total Images**: 2,742
- **Processed**: 1 (0.04%)
- **Unprocessed**: 2,741
- **Has Rekognition**: 0
- **Has Appraiser**: 0
- **Has SPID**: 0

## Issue

The batch script is failing with "Invalid API key" error. The script needs to use the **Service Role Key** instead of the Anon Key to have proper permissions.

## Solution

The script has been updated to try `SUPABASE_SERVICE_ROLE_KEY` first, then fall back to `VITE_SUPABASE_ANON_KEY`. 

**Next Steps:**
1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is in `.env.local`
2. Restart the batch script
3. Monitor progress

## How to Run

```bash
# Process all images
node scripts/batch_process_images.js

# Process specific vehicle
node scripts/batch_process_images.js e08bf694-970f-4cbe-8a74-8715158a0f2e
```

## What Gets Processed

Each image will get:
- **Rekognition**: AWS label detection (parts, tools, conditions)
- **Appraiser Brain**: Structured Yes/No checklist (condition, modifications, quality)
- **SPID Extraction**: Factory build sheet data (if SPID sheet detected)
- **Tags**: Auto-generated tags from analysis

## Monitoring

Check progress:
```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) as processed,
  COUNT(CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 1 END) as has_rekognition,
  COUNT(CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 1 END) as has_appraiser,
  COUNT(CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 1 END) as has_spid
FROM vehicle_images;
```

