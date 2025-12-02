# SPID Data Flow - Complete Path from Upload to Display

**Tracking exactly where data is saved and how it's used**

---

## DATABASE STORAGE - 3 Tables

### 1. `vehicle_spid_data` Table (Main SPID Storage)

**Location:** One row per vehicle
**Contains:** All extracted SPID data

```sql
TABLE: vehicle_spid_data
────────────────────────────────────────────────────────────
id                    UUID (primary key)
vehicle_id            UUID → links to vehicles table
image_id              UUID → links to vehicle_images table
                            (so you can click "View SPID" and see the image)

-- EXTRACTED DATA (from AI)
vin                   TEXT    "1GCEK14K8HZ123456"
build_date            TEXT    "04/15/87"
sequence_number       TEXT    "123456"
paint_code_exterior   TEXT    "70"
paint_code_interior   TEXT    "15"
rpo_codes             TEXT[]  {"G80", "KC4", "YE9", "Z62", "AU3"}
engine_code           TEXT    "L31"
transmission_code     TEXT    "TH700-R4"
axle_ratio            TEXT    "3.73"

-- METADATA
extraction_confidence INTEGER  95
raw_text              TEXT    "Full OCR text..."
extraction_model      TEXT    "gpt-4o"
extracted_at          TIMESTAMP

-- VERIFICATION STATUS (auto-calculated by trigger)
vin_matches_vehicle   BOOLEAN  TRUE/FALSE/NULL
paint_verified        BOOLEAN  TRUE/FALSE/NULL
options_added         BOOLEAN  TRUE/FALSE
────────────────────────────────────────────────────────────
```

**Query to see your SPID data:**
```sql
SELECT 
  v.year, v.make, v.model,
  s.vin,
  s.paint_code_exterior,
  s.rpo_codes,
  s.engine_code,
  s.vin_matches_vehicle,
  s.paint_verified
FROM vehicle_spid_data s
JOIN vehicles v ON v.id = s.vehicle_id;
```

### 2. `vehicle_options` Table (Individual RPO Codes)

**Location:** One row per RPO code per vehicle
**Contains:** Each RPO code as a separate record

```sql
TABLE: vehicle_options
────────────────────────────────────────────────────────────
id                UUID (primary key)
vehicle_id        UUID → links to vehicles table
option_code       TEXT    "G80" (individual code)
option_name       TEXT    "Locking Rear Differential" (decoded)
category          TEXT    "drivetrain"
source            TEXT    "spid" (where it came from)
verified_by_spid  BOOLEAN TRUE
created_at        TIMESTAMP

UNIQUE CONSTRAINT: (vehicle_id, option_code)
────────────────────────────────────────────────────────────
```

**Example data for one vehicle:**
```
vehicle_id: abc-123
option_code: G80,  option_name: Locking Differential,  source: spid
option_code: KC4,  option_name: Electric Transfer Case,  source: spid
option_code: YE9,  option_name: Heavy Duty Suspension,  source: spid
option_code: Z62,  option_name: Off-Road Package,       source: spid
option_code: AU3,  option_name: Power Door Locks,       source: spid
```

**Query to see all options for a vehicle:**
```sql
SELECT 
  option_code,
  option_name,
  category,
  verified_by_spid
FROM vehicle_options
WHERE vehicle_id = 'your-vehicle-id'
ORDER BY option_code;
```

### 3. `vehicle_verification_log` Table (Audit Trail)

**Location:** One row per verification event
**Contains:** History of what was verified/changed

```sql
TABLE: vehicle_verification_log
────────────────────────────────────────────────────────────
id                 UUID (primary key)
vehicle_id         UUID → links to vehicles table
verification_type  TEXT    "spid_auto_verification"
source             TEXT    "spid_sheet"
results            JSONB   {detailed results}
created_at         TIMESTAMP

Example results JSONB:
{
  "vin": "auto_filled",
  "value": "1GCEK14K8HZ123456",
  "paint_code": "verified",
  "spid_code": "70",
  "vehicle_code": "70",
  "rpo_codes_added": 5,
  "codes": ["G80", "KC4", "YE9", "Z62", "AU3"]
}
────────────────────────────────────────────────────────────
```

---

## AUTOMATIC UPDATES TO `vehicles` TABLE

When SPID is detected, the trigger also updates the main `vehicles` table:

```sql
UPDATE vehicles
SET 
  vin = 'extracted_vin'              -- if empty
  paint_code = 'extracted_paint'     -- if empty
  engine = 'extracted_engine'        -- if empty
  transmission = 'extracted_trans'   -- if empty
WHERE id = vehicle_id;
```

---

## UI DISPLAY - Where You See SPID Data

### Location 1: Vehicle Profile → Basic Info Card

**File:** `nuke_frontend/src/pages/vehicle-profile/VehicleBasicInfo.tsx`

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const VehicleBasicInfo = ({ vehicle }) => {
  const [spidData, setSpidData] = useState(null);
  
  // Load SPID data for this vehicle
  useEffect(() => {
    supabase
      .from('vehicle_spid_data')
      .select('*')
      .eq('vehicle_id', vehicle.id)
      .single()
      .then(({ data }) => setSpidData(data));
  }, [vehicle.id]);
  
  return (
    <div className="card">
      <div className="card-header">
        <h3>Basic Information</h3>
        {spidData && (
          <span className="badge-spid-verified">
            Verified by SPID Sheet
          </span>
        )}
      </div>
      
      <div className="card-body">
        {/* VIN FIELD */}
        <div className="field-row">
          <label>VIN</label>
          <div className="field-value-with-verification">
            <span className="value">{vehicle.vin || 'Not set'}</span>
            
            {/* Verification badge */}
            {spidData?.vin_matches_vehicle && (
              <span className="badge-verified">
                ✓ Verified by SPID
              </span>
            )}
            
            {/* Mismatch warning */}
            {spidData && !spidData.vin_matches_vehicle && spidData.vin && (
              <span className="badge-warning">
                ⚠ SPID shows: {spidData.vin}
              </span>
            )}
            
            {/* Link to SPID image */}
            {spidData?.image_id && (
              <a 
                href={`#image-${spidData.image_id}`}
                className="link-spid-image"
              >
                View SPID Sheet →
              </a>
            )}
          </div>
        </div>
        
        {/* PAINT CODE FIELD */}
        <div className="field-row">
          <label>Paint Code</label>
          <div className="field-value-with-verification">
            <span className="value">
              {vehicle.paint_code || 'Not set'}
            </span>
            
            {spidData?.paint_verified && (
              <span className="badge-verified">
                ✓ Verified by SPID
              </span>
            )}
            
            {spidData?.image_id && (
              <a 
                href={`#image-${spidData.image_id}`}
                className="link-spid-image"
              >
                View SPID Sheet →
              </a>
            )}
          </div>
        </div>
        
        {/* ENGINE FIELD */}
        <div className="field-row">
          <label>Engine</label>
          <div className="field-value-with-verification">
            <span className="value">{vehicle.engine || 'Not set'}</span>
            
            {spidData?.engine_code && (
              <span className="badge-from-spid">
                From SPID: {spidData.engine_code}
              </span>
            )}
          </div>
        </div>
        
        {/* TRANSMISSION FIELD */}
        <div className="field-row">
          <label>Transmission</label>
          <div className="field-value-with-verification">
            <span className="value">{vehicle.transmission || 'Not set'}</span>
            
            {spidData?.transmission_code && (
              <span className="badge-from-spid">
                From SPID: {spidData.transmission_code}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Visual result:**
```
┌─────────────────────────────────────────────────────┐
│ BASIC INFORMATION         [Verified by SPID Sheet] │
├─────────────────────────────────────────────────────┤
│ VIN                                                 │
│ 1GCEK14K8HZ123456                                  │
│ ✓ Verified by SPID         [View SPID Sheet →]    │
├─────────────────────────────────────────────────────┤
│ Paint Code                                          │
│ 70 (Cardinal Red)                                   │
│ ✓ Verified by SPID         [View SPID Sheet →]    │
├─────────────────────────────────────────────────────┤
│ Engine                                              │
│ 5.7L V8 (L31)                                      │
│ From SPID: L31                                      │
├─────────────────────────────────────────────────────┤
│ Transmission                                        │
│ 4-Speed Automatic                                   │
│ From SPID: TH700-R4                                │
└─────────────────────────────────────────────────────┘
```

### Location 2: RPO Codes Section (NEW)

**File:** `nuke_frontend/src/components/vehicle/RPOCodesDisplay.tsx`

```tsx
const RPOCodesDisplay = ({ vehicleId }) => {
  const [options, setOptions] = useState([]);
  const [spidData, setSpidData] = useState(null);
  
  useEffect(() => {
    // Load all options
    supabase
      .from('vehicle_options')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('option_code')
      .then(({ data }) => setOptions(data || []));
      
    // Load SPID data
    supabase
      .from('vehicle_spid_data')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .single()
      .then(({ data }) => setSpidData(data));
  }, [vehicleId]);
  
  return (
    <div className="card">
      <div className="card-header">
        <h3>Factory Options (RPO Codes)</h3>
        {spidData && (
          <span className="badge-count">
            {options.filter(o => o.verified_by_spid).length} codes from SPID
          </span>
        )}
      </div>
      
      <div className="card-body">
        {options.length === 0 ? (
          <p>No RPO codes recorded</p>
        ) : (
          <div className="rpo-grid">
            {options.map(option => (
              <div 
                key={option.id} 
                className={`rpo-card ${option.verified_by_spid ? 'verified' : ''}`}
              >
                <div className="rpo-code">{option.option_code}</div>
                <div className="rpo-name">{option.option_name || 'Unknown'}</div>
                <div className="rpo-category">{option.category}</div>
                {option.verified_by_spid && (
                  <div className="rpo-verified">✓ From SPID</div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {spidData?.image_id && (
          <div className="spid-link-footer">
            <a href={`#image-${spidData.image_id}`}>
              View Original SPID Sheet →
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
```

**Visual result:**
```
┌─────────────────────────────────────────────────────┐
│ FACTORY OPTIONS (RPO CODES)        [12 codes from SPID] │
├─────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │   G80    │ │   KC4    │ │   YE9    │            │
│ │ Locking  │ │ Electric │ │  Heavy   │            │
│ │   Diff   │ │ Transfer │ │   Duty   │            │
│ │ Drivetrain│ │  Case    │ │ Suspen.  │            │
│ │ ✓ From SPID│ │ ✓ From SPID│ │ ✓ From SPID│          │
│ └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │   Z62    │ │   AU3    │ │   C60    │            │
│ │ Off-Road │ │  Power   │ │  A/C     │            │
│ │ Package  │ │  Locks   │ │          │            │
│ │ ✓ From SPID│ │ ✓ From SPID│ │ ✓ From SPID│          │
│ └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│ [View Original SPID Sheet →]                       │
└─────────────────────────────────────────────────────┘
```

### Location 3: Image Gallery - SPID Badge

**File:** `nuke_frontend/src/components/images/ImageGallery.tsx`

```tsx
const ImageGallery = ({ vehicleId }) => {
  const [images, setImages] = useState([]);
  
  return (
    <div className="image-gallery">
      {images.map(image => (
        <div key={image.id} className="image-card">
          <img src={image.image_url} alt="" />
          
          {/* SPID Detection Badge */}
          {image.ai_scan_metadata?.spid_data?.is_spid_sheet && (
            <div className="badge-spid-detected">
              <div className="badge-title">SPID SHEET DETECTED</div>
              <div className="badge-details">
                {image.ai_scan_metadata.spid_data.extracted_data.rpo_codes?.length || 0} option codes
              </div>
              <button 
                onClick={() => viewSPIDDetails(image.id)}
                className="badge-action"
              >
                View Extracted Data →
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

**Visual result:**
```
┌─────────────────────────────┐
│  [SPID SHEET IMAGE]         │
│                             │
│  ┌───────────────────────┐  │
│  │ SPID SHEET DETECTED   │  │
│  │ 12 option codes       │  │
│  │ [View Data →]         │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

### Location 4: SPID Sheet Viewer Modal (NEW)

**File:** `nuke_frontend/src/components/vehicle/SPIDSheetViewer.tsx`

```tsx
const SPIDSheetViewer = ({ vehicleId, onClose }) => {
  const [spidData, setSpidData] = useState(null);
  const [image, setImage] = useState(null);
  
  useEffect(() => {
    // Load SPID data with image
    supabase
      .from('vehicle_spid_data')
      .select(`
        *,
        vehicle_images (
          image_url,
          file_name,
          taken_at
        )
      `)
      .eq('vehicle_id', vehicleId)
      .single()
      .then(({ data }) => {
        setSpidData(data);
        setImage(data?.vehicle_images);
      });
  }, [vehicleId]);
  
  if (!spidData) return <div>No SPID sheet uploaded</div>;
  
  return (
    <div className="modal-spid-viewer">
      <div className="modal-header">
        <h2>SPID Sheet - Service Parts Identification</h2>
        <button onClick={onClose}>Close ✕</button>
      </div>
      
      <div className="modal-body">
        {/* Left: Image */}
        <div className="spid-image-panel">
          <img src={image.image_url} alt="SPID Sheet" />
          <div className="image-info">
            <div>Uploaded: {new Date(image.taken_at).toLocaleDateString()}</div>
            <div>Confidence: {spidData.extraction_confidence}%</div>
          </div>
        </div>
        
        {/* Right: Extracted Data */}
        <div className="spid-data-panel">
          <div className="data-section">
            <h3>Identification</h3>
            <div className="data-grid">
              <div className="data-field">
                <label>VIN</label>
                <span>{spidData.vin}</span>
                {spidData.vin_matches_vehicle && <span className="check">✓</span>}
              </div>
              <div className="data-field">
                <label>Build Date</label>
                <span>{spidData.build_date}</span>
              </div>
              <div className="data-field">
                <label>Sequence</label>
                <span>{spidData.sequence_number}</span>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Paint Codes</h3>
            <div className="data-grid">
              <div className="data-field">
                <label>Exterior</label>
                <span>{spidData.paint_code_exterior}</span>
                {spidData.paint_verified && <span className="check">✓</span>}
              </div>
              <div className="data-field">
                <label>Interior</label>
                <span>{spidData.paint_code_interior}</span>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>RPO Codes ({spidData.rpo_codes?.length || 0})</h3>
            <div className="rpo-chips">
              {spidData.rpo_codes?.map(code => (
                <span key={code} className="chip">{code}</span>
              ))}
            </div>
          </div>
          
          <div className="data-section">
            <h3>Drivetrain</h3>
            <div className="data-grid">
              <div className="data-field">
                <label>Engine</label>
                <span>{spidData.engine_code}</span>
              </div>
              <div className="data-field">
                <label>Transmission</label>
                <span>{spidData.transmission_code}</span>
              </div>
              <div className="data-field">
                <label>Axle Ratio</label>
                <span>{spidData.axle_ratio}</span>
              </div>
            </div>
          </div>
          
          {/* Raw OCR Text */}
          <details className="raw-text-section">
            <summary>View Raw OCR Text</summary>
            <pre>{spidData.raw_text}</pre>
          </details>
        </div>
      </div>
    </div>
  );
};
```

---

## VERIFICATION WORKFLOW

### How SPID is Used as Verification Document

```
┌─────────────────────────────────────────────────────────┐
│         SPID SHEET AS VERIFICATION SOURCE                │
└─────────────────────────────────────────────────────────┘

1. UPLOAD SPID SHEET IMAGE
   ↓
2. AI DETECTS & EXTRACTS DATA
   → Saves to: vehicle_spid_data table
   ↓
3. TRIGGER RUNS AUTOMATICALLY
   → Compares extracted data vs vehicle table
   ↓
4. AUTO-VERIFICATION:
   
   VIN CHECK:
   - SPID VIN: 1GCEK14K8HZ123456
   - Vehicle VIN: (empty)
   - ACTION: Fill vehicle.vin with SPID VIN
   - RESULT: vin_matches_vehicle = TRUE
   
   PAINT CODE CHECK:
   - SPID Paint: 70
   - Vehicle Paint: 70
   - ACTION: No change needed
   - RESULT: paint_verified = TRUE
   
   RPO CODES:
   - SPID Codes: [G80, KC4, YE9, Z62, AU3]
   - ACTION: Insert all into vehicle_options table
   - RESULT: options_added = TRUE, count = 5
   
   ENGINE CHECK:
   - SPID Engine: L31
   - Vehicle Engine: (empty)
   - ACTION: Fill vehicle.engine with L31
   
   ↓
5. LOG VERIFICATION RESULTS
   → Saves to: vehicle_verification_log table
   → Results JSON shows what was verified/changed
   ↓
6. UI UPDATES
   → Shows "✓ Verified by SPID" badges
   → Links to SPID image
   → Displays RPO codes with SPID source
```

### Verification Use Cases

**Case 1: Empty Vehicle (New Entry)**
```sql
Before SPID:
  vehicles.vin = NULL
  vehicles.paint_code = NULL
  vehicles.engine = NULL

After SPID Detected:
  vehicles.vin = "1GCEK14K8HZ123456"
  vehicles.paint_code = "70"
  vehicles.engine = "L31"
  
  vehicle_spid_data.vin_matches_vehicle = TRUE
  vehicle_spid_data.paint_verified = TRUE
  
  vehicle_options: 5 new rows added
```

**Case 2: Verify Existing Data**
```sql
Before SPID:
  vehicles.vin = "1GCEK14K8HZ123456" (user entered)
  vehicles.paint_code = "71" (user entered - WRONG!)

After SPID Detected:
  vehicles.vin = "1GCEK14K8HZ123456" (no change)
  vehicles.paint_code = "71" (no change - keep user data)
  
  vehicle_spid_data.vin_matches_vehicle = TRUE ✓
  vehicle_spid_data.paint_verified = FALSE ⚠
  
  UI shows:
  "Paint Code: 71 ⚠ SPID shows: 70"
  → User can see discrepancy and correct it
```

**Case 3: Multiple SPIDs (Re-upload)**
```sql
First SPID Upload:
  vehicle_spid_data row created
  
Second SPID Upload (better photo):
  vehicle_spid_data row UPDATED (UNIQUE constraint)
  New extraction replaces old data
  Re-verification runs
```

---

## QUERIES TO CHECK YOUR DATA

### See All SPID Data
```sql
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  s.vin,
  s.paint_code_exterior,
  array_length(s.rpo_codes, 1) as rpo_count,
  s.rpo_codes,
  s.extraction_confidence,
  s.vin_matches_vehicle,
  s.paint_verified
FROM vehicle_spid_data s
JOIN vehicles v ON v.id = s.vehicle_id
ORDER BY s.extracted_at DESC;
```

### See All RPO Codes for a Vehicle
```sql
SELECT 
  option_code,
  option_name,
  category,
  source,
  verified_by_spid,
  created_at
FROM vehicle_options
WHERE vehicle_id = 'your-vehicle-id'
ORDER BY 
  verified_by_spid DESC,  -- SPID codes first
  option_code;
```

### See Verification History
```sql
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vl.verification_type,
  vl.source,
  vl.results,
  vl.created_at
FROM vehicle_verification_log vl
JOIN vehicles v ON v.id = vl.vehicle_id
WHERE vl.verification_type = 'spid_auto_verification'
ORDER BY vl.created_at DESC;
```

### Find Mismatches
```sql
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  v.vin as vehicle_vin,
  s.vin as spid_vin,
  s.vin_matches_vehicle,
  v.paint_code as vehicle_paint,
  s.paint_code_exterior as spid_paint,
  s.paint_verified
FROM vehicle_spid_data s
JOIN vehicles v ON v.id = s.vehicle_id
WHERE 
  s.vin_matches_vehicle = FALSE
  OR s.paint_verified = FALSE;
```

---

## SUMMARY

**Where SPID Codes are Saved:**
1. `vehicle_spid_data` - All extracted data (VIN, paint, RPO array, engine, trans)
2. `vehicle_options` - Each RPO code as separate row
3. `vehicle_verification_log` - Audit trail of verifications
4. `vehicles` table - Updated with verified data (VIN, paint, engine)

**Where SPID Codes are Shown:**
1. Basic Info Card - VIN, paint with "✓ Verified by SPID" badges
2. RPO Codes Section - Grid of all option codes with SPID source
3. Image Gallery - "SPID SHEET DETECTED" badge on image
4. SPID Viewer Modal - Full extracted data with link to image

**How SPID is Used for Verification:**
1. Auto-fills empty fields (VIN, paint, engine, transmission)
2. Compares existing data and flags mismatches
3. Adds all RPO codes to vehicle_options
4. Shows verification badges in UI
5. Links to source SPID image for reference
6. Logs all changes in verification_log

**The SPID sheet becomes the SOURCE OF TRUTH for factory specifications.**

