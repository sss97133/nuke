# Image Extraction Pipeline Verification

## Current Status

**2,742 images** in database
- **2,539 unprocessed** (92.6%)
- **1 processed** (0.04%)
- **0 with Rekognition data**
- **0 with Appraiser Brain data**
- **0 with SPID data**

## What the `analyze-image` Function Does

1. **AWS Rekognition** - Detects labels, parts, damage, tools
2. **Appraiser Brain** (OpenAI Vision) - Structured Yes/No checklist based on image angle
3. **SPID Extraction** (OpenAI Vision) - Detects and extracts GM SPID sheet data
4. **Auto-tagging** - Creates image_tags from Rekognition results
5. **Metadata Storage** - Saves all data to `vehicle_images.ai_scan_metadata`
6. **SPID Table** - Saves structured SPID data to `vehicle_spid_data` table

## Required Edge Function Secrets

These must be set in Supabase Dashboard:
- `OPENAI_API_KEY` - For Appraiser Brain + SPID extraction
- `AWS_ACCESS_KEY_ID` - For Rekognition
- `AWS_SECRET_ACCESS_KEY` - For Rekognition  
- `SERVICE_ROLE_KEY` - For database access

**Dashboard**: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

## How to Verify It Works

### Option 1: Test Script
```bash
node scripts/test_analyze_image.js
```

This will:
- Get one unprocessed image
- Call `analyze-image` function
- Verify data was saved to DB
- Show what extractions succeeded/failed

### Option 2: Manual Test via UI
1. Go to any vehicle profile
2. Open an image in Lightbox
3. Click "AI" button
4. Check if "Appraiser Notes" appear in Details tab

### Option 3: Check Logs
```bash
# Check Edge Function logs for analyze-image calls
# Should see successful 200 responses, not 500 errors
```

## What Success Looks Like

After processing, you should see:
- `vehicle_images.ai_scan_metadata.rekognition` - AWS labels
- `vehicle_images.ai_scan_metadata.appraiser` - Structured checklist
- `vehicle_images.ai_scan_metadata.spid` - SPID extraction (if SPID sheet found)
- `vehicle_spid_data` table - Structured SPID records
- `image_tags` table - Auto-generated tags

## Known Issues

1. **No recent `analyze-image` calls in logs** - Function may not be getting triggered
2. **All images have empty metadata** - Suggests function hasn't run
3. **Upload service fixed** - Now calls `analyze-image` instead of old `auto-analyze-upload`

## Next Steps

1. ✅ **Verify Edge Function secrets are set** (Dashboard)
2. ✅ **Test with single image** (`test_analyze_image.js`)
3. ✅ **If test passes, run batch processing** (`batch_process_images.js`)
4. ✅ **Monitor logs for errors** during batch processing

