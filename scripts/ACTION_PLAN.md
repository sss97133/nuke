# Next Steps: Image Extraction Pipeline

## Current Status ✅

- ✅ OpenAI API key configured
- ✅ All Edge Function secrets set (OpenAI, AWS, Service Role)
- ✅ Function code deployed (`analyze-image` with Rekognition + Appraiser Brain + SPID)
- ✅ Database schema ready (`vehicle_spid_data` table)
- ✅ Upload service fixed to call `analyze-image`

## Immediate Next Steps

### Option 1: Test via UI (Recommended - Fastest)
1. Go to any vehicle profile: https://n-zero.dev/vehicle/[vehicle-id]
2. Open an image in the Lightbox
3. Click the **"AI"** button
4. Check if "Appraiser Notes" appear in the Details tab
5. Verify data in database:
   ```sql
   SELECT ai_scan_metadata 
   FROM vehicle_images 
   WHERE id = '[image-id]';
   ```

### Option 2: Test via Upload (Automatic)
1. Upload a new image to any vehicle
2. The `imageUploadService` will automatically call `analyze-image`
3. Check database after a few seconds

### Option 3: Test with Small Batch (If UI doesn't work)
```bash
# Test with one vehicle (Bronco with SPID sheets)
# First, we need to fix the batch script's API key issue
# Or use a direct function call test
```

## After Successful Test

Once you verify extraction works:

### Step 1: Process High-Priority Vehicle
```bash
# Process the Bronco with SPID sheets
node scripts/batch_process_images.js e08bf694-970f-4cbe-8a74-8715158a0f2e
```

### Step 2: Verify Results
```sql
-- Check extraction results
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

-- Check SPID data
SELECT * FROM vehicle_spid_data 
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
```

### Step 3: Full Batch Processing
```bash
# Process all 2,539 unprocessed images
# Note: This will take time and cost API credits
node scripts/batch_process_images.js
```

## What Success Looks Like

After processing, you should see:
- `vehicle_images.ai_scan_metadata.rekognition` - Array of AWS labels
- `vehicle_images.ai_scan_metadata.appraiser` - Structured Yes/No checklist
- `vehicle_images.ai_scan_metadata.spid` - SPID extraction (if SPID sheet found)
- `vehicle_spid_data` table - Structured SPID records with VIN, RPO codes
- `image_tags` table - Auto-generated tags

## If Test Fails

Check Edge Function logs:
- Dashboard: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions
- Look for `analyze-image` errors
- Common issues:
  - "AWS credentials not configured" → Check AWS secrets
  - "OpenAI API key invalid" → Verify key is correct
  - "Failed to download image" → Image URL issue

## Recommended Order

1. **Test via UI** (fastest, no setup needed)
2. **If successful** → Process Bronco vehicle (has SPID sheets)
3. **Verify SPID extraction** → Check `vehicle_spid_data` table
4. **If all good** → Run full batch processing

