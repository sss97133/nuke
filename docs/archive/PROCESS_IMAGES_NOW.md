# Process Images & Enable SPID Verification - RUN NOW

**Goal:** Get January images processed + enable automatic SPID extraction for new uploads

---

## STEP 1: Create SPID Tables (30 seconds)

```bash
cd /Users/skylar/nuke

# Run the SQL to create tables
npx supabase db execute --file database/spid_verification_system.sql
```

This creates:
- `vehicle_spid_data` - Stores extracted SPID data
- `vehicle_options` - Stores RPO codes
- `vehicle_verification_log` - Logs all verifications
- Auto-verification trigger that runs when SPID detected

---

## STEP 2: Process January 2024 Images (5-10 minutes)

```bash
# Make script executable
chmod +x scripts/process-january-images.js

# Run processing
node scripts/process-january-images.js
```

**What it does:**
- Finds all January 2024 images
- Triggers AI analysis for unprocessed ones
- Extracts SPID data if detected
- Auto-verifies VIN, paint code, options
- Shows summary of what was found

**Expected output:**
```
=============================================================
PROCESSING JANUARY 2024 IMAGES
=============================================================

🔍 Finding January 2024 images...

📊 Found 9 total images
   0 already processed
   9 need processing

🚀 Processing 9 images...

  📸 IMG_0001.jpg
     Date: 1/6/2024
     ✅ Processed

  📸 IMG_0002.jpg
     Date: 1/6/2024
     ✅ Processed
     🎯 SPID SHEET DETECTED!
        Confidence: 95%
        VIN: 1GCEK14K8HZ123456
        Paint: 70
        RPO Codes: G80, KC4, YE9, Z62

...

=============================================================
PROCESSING COMPLETE
=============================================================
✅ Successfully processed: 9
❌ Failed: 0
🎯 SPID sheets found: 1

💡 To view SPID data:
   1. Go to vehicle profile
   2. Check Basic Info for "Verified by SPID" badges
   3. View RPO codes extracted from SPID
   4. Click "View SPID Sheet" link to see original image

✨ Done!
```

---

## STEP 3: Update Edge Function (Update SPID Saving)

The `analyze-image` function already detects SPID, but needs to save to the new table.

**File:** `supabase/functions/analyze-image/index.ts`

**Find this code (around line 38-50):**
```typescript
// 3.5. Check for SPID sheet and extract data if found
let spidData = null
let spidResponse = null
try {
  spidResponse = await detectSPIDSheet(image_url, vehicle_id)
  if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
    spidData = spidResponse.extracted_data
    console.log('SPID sheet detected:', spidData)
  }
} catch (err) {
  console.warn('SPID detection failed:', err)
}
```

**Replace with:**
```typescript
// 3.5. Check for SPID sheet and extract data if found
let spidData = null
let spidResponse = null
try {
  spidResponse = await detectSPIDSheet(image_url, vehicle_id)
  if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
    spidData = spidResponse.extracted_data
    console.log('SPID sheet detected:', spidData)
    
    // Save to vehicle_spid_data table (triggers auto-verification)
    const imageId = (await req.json()).image_id // Get image ID from request
    const { error: spidSaveError } = await supabase
      .from('vehicle_spid_data')
      .upsert({
        vehicle_id: vehicle_id,
        image_id: imageId,
        vin: spidData.vin,
        build_date: spidData.build_date,
        paint_code_exterior: spidData.paint_code_exterior,
        paint_code_interior: spidData.paint_code_interior,
        rpo_codes: spidData.rpo_codes || [],
        engine_code: spidData.engine_code,
        transmission_code: spidData.transmission_code,
        axle_ratio: spidData.axle_ratio,
        extraction_confidence: spidResponse.confidence,
        raw_text: spidResponse.raw_text,
        extraction_model: 'gpt-4o'
      }, {
        onConflict: 'vehicle_id' // Update if vehicle already has SPID
      });
      
    if (spidSaveError) {
      console.error('Failed to save SPID data:', spidSaveError);
    } else {
      console.log('✅ SPID data saved, auto-verification triggered');
    }
  }
} catch (err) {
  console.warn('SPID detection failed:', err)
}
```

**Deploy the update:**
```bash
npx supabase functions deploy analyze-image
```

---

## STEP 4: Upload New Images (SPID Will Auto-Extract)

Now when you upload any SPID sheet image:

1. **Upload normally** (camera or gallery)
2. Image processes automatically
3. If SPID detected:
   - VIN extracted → Verifies or fills vehicle.vin
   - Paint code extracted → Verifies or fills vehicle.paint_code
   - RPO codes extracted → Added to vehicle_options table
   - Engine/trans codes → Fill if empty
4. See results immediately in vehicle profile

---

## VERIFY IT WORKED

### Check January Images
```sql
SELECT 
  vi.file_name,
  vi.taken_at,
  CASE 
    WHEN vi.ai_scan_metadata IS NULL THEN 'UNPROCESSED'
    WHEN vi.ai_scan_metadata->'spid_data'->>'is_spid_sheet' = 'true' THEN 'SPID DETECTED'
    ELSE 'PROCESSED (NO SPID)'
  END as status
FROM vehicle_images vi
WHERE vi.taken_at >= '2024-01-01' 
  AND vi.taken_at < '2024-02-01'
ORDER BY vi.taken_at;
```

### Check SPID Data
```sql
SELECT 
  v.year,
  v.make,
  v.model,
  s.vin,
  s.paint_code_exterior,
  array_length(s.rpo_codes, 1) as rpo_code_count,
  s.extraction_confidence,
  s.vin_matches_vehicle,
  s.paint_verified
FROM vehicle_spid_data s
JOIN vehicles v ON v.id = s.vehicle_id;
```

### Check Verification Log
```sql
SELECT 
  v.year,
  v.make,
  v.model,
  vl.verification_type,
  vl.results,
  vl.created_at
FROM vehicle_verification_log vl
JOIN vehicles v ON v.id = vl.vehicle_id
ORDER BY vl.created_at DESC
LIMIT 10;
```

---

## WHAT YOU'LL SEE IN UI

### Vehicle Profile - Basic Info Card
```
┌──────────────────────────────────────┐
│ BASIC INFORMATION               [✏]  │
├──────────────────────────────────────┤
│ VIN:  1GCEK14K8HZ123456              │
│       ✓ Verified by SPID             │
│       [View SPID Sheet →]            │
├──────────────────────────────────────┤
│ Paint Code:  70 (Cardinal Red)       │
│       ✓ Verified by SPID             │
│       [View SPID Sheet →]            │
├──────────────────────────────────────┤
│ Factory Options (12 codes from SPID) │
│ [G80] [KC4] [YE9] [Z62] [AU3] ...   │
│ [View SPID Sheet →]                  │
└──────────────────────────────────────┘
```

### Image Gallery
```
┌──────────────────────────────────────┐
│ [SPID SHEET IMAGE]                   │
│                                      │
│ 🎯 SPID SHEET DETECTED               │
│    12 option codes extracted         │
│    [VIEW DETAILS →]                  │
└──────────────────────────────────────┘
```

---

## TROUBLESHOOTING

### "No January images found"
- Check dates in database match January 2024
- Images might have different `taken_at` dates

### "Edge function not found"
- Deploy the function: `npx supabase functions deploy analyze-image`

### "SPID not detecting"
- Check image quality (needs clear, high-res SPID photo)
- SPID confidence must be >70% to trigger extraction
- Check logs: `npx supabase functions logs analyze-image`

### "Table does not exist"
- Run Step 1 SQL again
- Check connection to correct database

---

## SUMMARY

**Run These Commands:**
```bash
# 1. Create tables
npx supabase db execute --file database/spid_verification_system.sql

# 2. Process January images  
node scripts/process-january-images.js

# 3. Deploy updated edge function (after editing)
npx supabase functions deploy analyze-image
```

**Result:**
✅ January images processed and organized
✅ SPID sheets detected and codes extracted
✅ Vehicle data auto-verified from SPID
✅ New uploads will auto-extract SPID data
✅ RPO codes displayed in vehicle profile

**Ready to run?** Start with Step 1! 🚀

