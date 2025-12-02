# SPID Sheet Verification System - Complete Flow

**Your Expectation:** SPID sheet images automatically extract codes and verify vehicle data

---

## WHAT HAPPENS ON UPLOAD (Current System)

### Step 1: Image Upload
```
User uploads SPID sheet image
  ↓
ImageUploadService.uploadImage()
  ↓
Image saved to vehicle_images table
  ↓
triggerBackgroundAIAnalysis() calls 'analyze-image' edge function
```

### Step 2: AI Analysis Pipeline (analyze-image function)

```typescript
// Lines 38-50 of supabase/functions/analyze-image/index.ts

1. Run AWS Rekognition (basic labels)
   ↓
2. Determine context (exterior, interior, engine, etc.)
   ↓
3. Run Appraiser Brain (detailed analysis)
   ↓
4. ✅ DETECT SPID SHEET  ← THIS ALREADY EXISTS!
   ↓
5. If SPID detected → Extract all data:
   - VIN
   - Build date
   - Paint codes (exterior/interior)
   - RPO codes (all options)
   - Engine code
   - Transmission code
   - Axle ratio
   ↓
6. Save to image metadata:
   {
     "spid_data": {
       "is_spid_sheet": true,
       "confidence": 95,
       "extracted_data": {
         "vin": "1GCEK14K8HZ123456",
         "rpo_codes": ["G80", "KC4", "YE9", "Z62"],
         "paint_code_exterior": "70",
         "engine_code": "L31",
         ...
       }
     }
   }
```

---

## WHAT'S MISSING (Verification Step)

### Current: Data Extracted but NOT Used for Verification

```
SPID extracted → Saved to ai_scan_metadata → ❌ STOPS HERE
                                               ↓
                                     NOT used to verify vehicle data
                                     NOT shown in UI prominently
                                     NOT used as validation source
```

### Expected: SPID Data Used for Verification

```
SPID extracted → Save to ai_scan_metadata
              ↓
              → Check vehicle.vin matches SPID.vin
              → Verify paint_code matches
              → Add missing RPO codes
              → Flag discrepancies
              → Show "Verified by SPID" badge
              → Link to SPID image from vehicle fields
```

---

## SOLUTION: Add SPID Verification Layer

### 1. Create vehicle_spid_data Table (Dedicated Storage)

```sql
CREATE TABLE IF NOT EXISTS vehicle_spid_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  
  -- Extracted data
  vin TEXT,
  build_date TEXT,
  sequence_number TEXT,
  paint_code_exterior TEXT,
  paint_code_interior TEXT,
  rpo_codes TEXT[], -- Array of RPO codes
  engine_code TEXT,
  transmission_code TEXT,
  axle_ratio TEXT,
  
  -- Metadata
  extraction_confidence INTEGER, -- 0-100
  raw_text TEXT, -- Original OCR text
  extraction_model TEXT, -- 'gpt-4o'
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Verification status
  vin_matches_vehicle BOOLEAN,
  paint_verified BOOLEAN,
  options_added BOOLEAN,
  
  UNIQUE(vehicle_id) -- One SPID per vehicle
);

CREATE INDEX idx_vehicle_spid_vehicle_id ON vehicle_spid_data(vehicle_id);
CREATE INDEX idx_vehicle_spid_image_id ON vehicle_spid_data(image_id);
```

### 2. Auto-Verify Function (Triggered on SPID Extraction)

```sql
CREATE OR REPLACE FUNCTION verify_vehicle_from_spid()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_record RECORD;
  verification_results JSONB;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record 
  FROM vehicles 
  WHERE id = NEW.vehicle_id;
  
  -- Initialize results
  verification_results := '{}'::JSONB;
  
  -- 1. VIN VERIFICATION
  IF NEW.vin IS NOT NULL THEN
    NEW.vin_matches_vehicle := (vehicle_record.vin = NEW.vin);
    
    IF NOT NEW.vin_matches_vehicle AND vehicle_record.vin IS NULL THEN
      -- Auto-fill VIN if empty
      UPDATE vehicles 
      SET vin = NEW.vin,
          verification_source = 'spid'
      WHERE id = NEW.vehicle_id;
      
      verification_results := verification_results || 
        jsonb_build_object('vin', 'auto_filled');
    END IF;
  END IF;
  
  -- 2. PAINT CODE VERIFICATION
  IF NEW.paint_code_exterior IS NOT NULL THEN
    IF vehicle_record.paint_code IS NULL THEN
      -- Auto-fill paint code
      UPDATE vehicles 
      SET paint_code = NEW.paint_code_exterior
      WHERE id = NEW.vehicle_id;
      
      NEW.paint_verified := TRUE;
      verification_results := verification_results || 
        jsonb_build_object('paint_code', 'auto_filled');
    ELSE
      NEW.paint_verified := (vehicle_record.paint_code = NEW.paint_code_exterior);
      
      IF NOT NEW.paint_verified THEN
        verification_results := verification_results || 
          jsonb_build_object('paint_code', 'mismatch_detected');
      END IF;
    END IF;
  END IF;
  
  -- 3. RPO CODES - ADD TO VEHICLE OPTIONS
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    -- Insert each RPO code as a vehicle option
    INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
    SELECT 
      NEW.vehicle_id,
      unnest(NEW.rpo_codes),
      'spid',
      TRUE
    ON CONFLICT (vehicle_id, option_code) DO NOTHING;
    
    NEW.options_added := TRUE;
    verification_results := verification_results || 
      jsonb_build_object('rpo_codes_added', array_length(NEW.rpo_codes, 1));
  END IF;
  
  -- 4. ENGINE CODE VERIFICATION
  IF NEW.engine_code IS NOT NULL THEN
    IF vehicle_record.engine IS NULL OR vehicle_record.engine = '' THEN
      UPDATE vehicles 
      SET engine = NEW.engine_code
      WHERE id = NEW.vehicle_id;
      
      verification_results := verification_results || 
        jsonb_build_object('engine', 'auto_filled');
    END IF;
  END IF;
  
  -- Log verification results
  INSERT INTO vehicle_verification_log (
    vehicle_id,
    verification_type,
    source,
    results,
    created_at
  ) VALUES (
    NEW.vehicle_id,
    'spid_auto_verification',
    'spid_sheet',
    verification_results,
    NOW()
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_verify_vehicle_from_spid
  BEFORE INSERT OR UPDATE ON vehicle_spid_data
  FOR EACH ROW
  EXECUTE FUNCTION verify_vehicle_from_spid();
```

### 3. Update analyze-image Function to Save to vehicle_spid_data

```typescript
// In supabase/functions/analyze-image/index.ts
// After line 50 where SPID is detected:

if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
  spidData = spidResponse.extracted_data;
  
  // Save to dedicated table (triggers verification)
  const { error: spidError } = await supabase
    .from('vehicle_spid_data')
    .upsert({
      vehicle_id: vehicle_id,
      image_id: imageId, // Link to source image
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
      onConflict: 'vehicle_id' // Update if SPID already exists
    });
    
  if (spidError) {
    console.error('Failed to save SPID data:', spidError);
  } else {
    console.log('✅ SPID data saved and verification triggered');
  }
}
```

---

## UI DISPLAY - Show SPID Data Everywhere

### 1. Vehicle Profile - Basic Info Card

```tsx
// VehicleBasicInfo.tsx

<div className="basic-info-card">
  <div className="field">
    <label>VIN</label>
    <div className="value-with-verification">
      <span>{vehicle.vin}</span>
      {spidData?.vin_matches_vehicle && (
        <span className="verified-badge">✓ Verified by SPID</span>
      )}
      {spidData && !spidData.vin_matches_vehicle && (
        <span className="warning-badge">
          ⚠ SPID shows: {spidData.vin}
        </span>
      )}
    </div>
  </div>
  
  <div className="field">
    <label>Paint Code</label>
    <div className="value-with-verification">
      <span>{vehicle.paint_code}</span>
      {spidData?.paint_verified && (
        <span className="verified-badge">✓ Verified by SPID</span>
      )}
      {spidData?.image_id && (
        <a href={`#spid-image-${spidData.image_id}`}>
          View SPID Sheet →
        </a>
      )}
    </div>
  </div>
  
  {spidData?.rpo_codes && spidData.rpo_codes.length > 0 && (
    <div className="field">
      <label>RPO Codes (from SPID)</label>
      <div className="rpo-codes">
        {spidData.rpo_codes.map(code => (
          <span key={code} className="rpo-badge">{code}</span>
        ))}
      </div>
      <a href={`#spid-image-${spidData.image_id}`}>
        View SPID Sheet →
      </a>
    </div>
  )}
</div>
```

### 2. SPID Sheet Badge on Image

```tsx
// In ImageGallery component

{image.ai_scan_metadata?.spid_data?.is_spid_sheet && (
  <div className="spid-badge">
    <span>SPID SHEET DETECTED</span>
    <span>{image.ai_scan_metadata.spid_data.extracted_data.rpo_codes?.length || 0} codes</span>
  </div>
)}
```

### 3. Dedicated SPID Viewer Modal

```tsx
const SPIDSheetViewer = ({ vehicleId }) => {
  const [spidData, setSpidData] = useState(null);
  
  // Load SPID data
  useEffect(() => {
    supabase
      .from('vehicle_spid_data')
      .select('*, vehicle_images(*)')
      .eq('vehicle_id', vehicleId)
      .single()
      .then(({ data }) => setSpidData(data));
  }, [vehicleId]);
  
  if (!spidData) return <div>No SPID sheet uploaded</div>;
  
  return (
    <div className="spid-viewer">
      <div className="spid-image">
        <img src={spidData.vehicle_images.image_url} alt="SPID Sheet" />
      </div>
      
      <div className="spid-data">
        <h3>Extracted Data</h3>
        
        <div className="data-section">
          <h4>Identification</h4>
          <div className="field">VIN: {spidData.vin}</div>
          <div className="field">Build Date: {spidData.build_date}</div>
          <div className="field">Sequence: {spidData.sequence_number}</div>
        </div>
        
        <div className="data-section">
          <h4>Paint Codes</h4>
          <div className="field">Exterior: {spidData.paint_code_exterior}</div>
          <div className="field">Interior: {spidData.paint_code_interior}</div>
        </div>
        
        <div className="data-section">
          <h4>RPO Codes ({spidData.rpo_codes.length})</h4>
          <div className="rpo-grid">
            {spidData.rpo_codes.map(code => (
              <div key={code} className="rpo-card">
                <span className="code">{code}</span>
                <span className="description">{getRPODescription(code)}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="data-section">
          <h4>Drivetrain</h4>
          <div className="field">Engine: {spidData.engine_code}</div>
          <div className="field">Transmission: {spidData.transmission_code}</div>
          <div className="field">Axle Ratio: {spidData.axle_ratio}</div>
        </div>
        
        <div className="confidence-bar">
          <span>Extraction Confidence: {spidData.extraction_confidence}%</span>
          <div className="bar">
            <div style={{ width: `${spidData.extraction_confidence}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## PROCESS YOUR JANUARY IMAGES

### Script to Process Unprocessed Images

```javascript
// scripts/process-january-images.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Finding January 2024 images...\n');
  
  // Get all January images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, file_name, taken_at')
    .gte('taken_at', '2024-01-01')
    .lt('taken_at', '2024-02-01')
    .is('ai_scan_metadata', null) // Only unprocessed
    .order('taken_at');
    
  if (error) {
    console.error('Error fetching images:', error);
    return;
  }
  
  console.log(`Found ${images.length} unprocessed January images\n`);
  
  // Process each image
  for (const image of images) {
    console.log(`Processing: ${image.file_name}`);
    console.log(`  Date: ${image.taken_at}`);
    console.log(`  URL: ${image.image_url.substring(0, 60)}...`);
    
    try {
      // Call analyze-image function
      const { data, error: analyzeError } = await supabase.functions.invoke(
        'analyze-image',
        {
          body: {
            image_url: image.image_url,
            vehicle_id: image.vehicle_id,
            image_id: image.id
          }
        }
      );
      
      if (analyzeError) {
        console.error(`  ❌ Failed:`, analyzeError.message);
      } else {
        console.log(`  ✅ Processed successfully`);
        
        // Check if SPID was detected
        if (data?.spid_data?.is_spid_sheet) {
          console.log(`  🎯 SPID SHEET DETECTED!`);
          console.log(`     Confidence: ${data.spid_data.confidence}%`);
          console.log(`     RPO Codes: ${data.spid_data.extracted_data.rpo_codes?.join(', ')}`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Error:`, err.message);
    }
    
    // Wait 2 seconds between images to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n✅ Processing complete!');
}

main();
```

---

## IMMEDIATE ACTIONS

### 1. Create Tables
```bash
cd /Users/skylar/nuke
psql $DATABASE_URL < database/spid_verification_system.sql
```

### 2. Process January Images
```bash
node scripts/process-january-images.js
```

### 3. View Results
Navigate to vehicle profile and see:
- Verified badges on fields
- SPID data displayed
- RPO codes extracted
- Link to view SPID sheet image

---

## SUMMARY

**What You Expect:**
✅ Upload SPID → Codes extracted automatically
✅ VIN verified against SPID
✅ Paint code verified
✅ RPO codes added to vehicle
✅ SPID used as verification source across UI

**Current State:**
✅ SPID detection working (analyze-image function)
✅ Data extraction working
❌ Data NOT saved to dedicated table
❌ Verification NOT triggered
❌ UI NOT showing SPID data

**Solution:**
1. Create `vehicle_spid_data` table
2. Save extracted data (triggers verification)
3. Update UI to show verification badges
4. Link SPID image from vehicle fields

**Want me to implement this now?**

