# Vehicle Data Structure Fix - Proper Field Separation

**Problem:** Fields are jumbled and incorrectly combined
**Solution:** Separate fields properly and use SPID as verification source

---

## CURRENT (WRONG) DATA

```
Trim: C20 3+3 454ci
Transmission: automatic
Engine: (not shown or wrong)
```

**Problems:**
1. "Trim" contains Model + Cab + Engine (3 different things!)
2. Transmission too vague ("automatic" - which one?)
3. Engine size not properly separated

---

## CORRECT DATA STRUCTURE

### Proper Field Separation

```
Model:        C20                (body series)
Sub-Model:    3+3 Crew Cab       (cab configuration)
Trim:         Silverado          (trim package)
Engine:       7.4L V8 (454ci)    (engine size + type)
Engine Code:  LS4 or L19         (RPO code from SPID)
Transmission: TH400 Automatic    (specific trans model)
Trans Code:   M40                (RPO code from SPID)
```

### Database Schema Update Needed

```sql
ALTER TABLE vehicles 
  -- Current fields
  ADD COLUMN IF NOT EXISTS model_series TEXT,        -- C10, C20, K10, K20
  ADD COLUMN IF NOT EXISTS cab_config TEXT,          -- Regular, Extended, Crew (3+3)
  ADD COLUMN IF NOT EXISTS trim_level TEXT,          -- Silverado, Cheyenne, Custom Deluxe
  
  -- Engine details (separate from bundled field)
  ADD COLUMN IF NOT EXISTS engine_displacement TEXT, -- 454, 350, 305
  ADD COLUMN IF NOT EXISTS engine_liters NUMERIC,    -- 7.4, 5.7, 5.0
  ADD COLUMN IF NOT EXISTS engine_type TEXT,         -- V8, L6, V6
  ADD COLUMN IF NOT EXISTS engine_code TEXT,         -- LS4, L31, LT1 (RPO)
  
  -- Transmission details (separate from vague "automatic")
  ADD COLUMN IF NOT EXISTS transmission_model TEXT,  -- TH400, 4L60E, NV3500
  ADD COLUMN IF NOT EXISTS transmission_type TEXT,   -- Automatic, Manual
  ADD COLUMN IF NOT EXISTS transmission_code TEXT;   -- M40, M20 (RPO)
```

---

## SPID SHEET AS SOURCE OF TRUTH

### What SPID Contains for Your Vehicle

```
SPID Sheet Image → AI Extracts:

VIN: 1GCXXXXXXXXX
MODEL: CCE2436*    ← This decodes to:
                     CC = C/K series
                     E = 1984
                     24 = C20 (2-ton)
                     36 = 3+3 Crew Cab

RPO CODES:
  LS4 = 454ci (7.4L) V8 engine
  M40 = TH400 Automatic transmission
  Z84 = Silverado trim package
  G80 = Locking rear differential
  KC4 = Electric transfer case (4WD)
  ...

PAINT: 70 (Cardinal Red)
BUILD DATE: 04/15/1984
```

### How to Decode SPID Model Code

```javascript
function decodeGMModelCode(modelCode) {
  // Example: CCE2436
  // Position 1-2: Series (CC = C/K, CK = C/K, CE = C/E)
  // Position 3: Year indicator (E = 1984)
  // Position 4-5: Body series (14 = C10/K10, 24 = C20/K20, 34 = C30/K30)
  // Position 6: Cab config (3 = 3+3 crew, 4 = regular, 5 = extended)
  // Position 7+: Wheelbase/other indicators
  
  const series = modelCode.substring(0, 2);  // CC
  const year = modelCode.charAt(2);          // E = 1984
  const bodySeries = modelCode.substring(3, 5); // 24 = C20
  const cabConfig = modelCode.charAt(5);     // 3 = crew cab
  
  return {
    series: bodySeries === '14' ? 'C10/K10' : 
            bodySeries === '24' ? 'C20/K20' : 
            bodySeries === '34' ? 'C30/K30' : 'Unknown',
    cabConfig: cabConfig === '3' ? 'Crew Cab (3+3)' :
               cabConfig === '4' ? 'Regular Cab' :
               cabConfig === '5' ? 'Extended Cab' : 'Unknown',
    year: decodeYearLetter(year)
  };
}
```

### How to Decode RPO Codes

```javascript
const RPO_DEFINITIONS = {
  // Engine codes
  'LS4': { name: '454ci V8', category: 'engine', displacement: 454, liters: 7.4 },
  'L31': { name: '350ci V8', category: 'engine', displacement: 350, liters: 5.7 },
  'LT1': { name: '350ci V8 (Performance)', category: 'engine', displacement: 350, liters: 5.7 },
  
  // Transmission codes
  'M40': { name: 'TH400 3-Speed Automatic', category: 'transmission', type: 'automatic' },
  'M38': { name: 'TH350 3-Speed Automatic', category: 'transmission', type: 'automatic' },
  'M20': { name: 'SM465 4-Speed Manual', category: 'transmission', type: 'manual' },
  
  // Trim packages
  'Z84': { name: 'Silverado Trim Package', category: 'trim' },
  'YE9': { name: 'Cheyenne Trim Package', category: 'trim' },
  'YF5': { name: 'Custom Deluxe Trim', category: 'trim' },
  
  // Drivetrain
  'G80': { name: 'Locking Rear Differential', category: 'drivetrain' },
  'KC4': { name: 'Electric Transfer Case (4WD)', category: 'drivetrain' },
  
  // Suspension/Chassis
  'Z62': { name: 'Heavy Duty Off-Road Package', category: 'chassis' },
  
  // Comfort/Convenience
  'AU3': { name: 'Power Door Locks', category: 'convenience' },
  'C60': { name: 'Air Conditioning', category: 'comfort' }
};

function decodeRPOCodes(codes) {
  return codes.map(code => ({
    code: code,
    ...RPO_DEFINITIONS[code] || { name: 'Unknown Option', category: 'unknown' }
  }));
}
```

---

## AUTO-CORRECTION FROM SPID

### Updated Trigger Function

```sql
CREATE OR REPLACE FUNCTION verify_vehicle_from_spid()
RETURNS TRIGGER AS $$
DECLARE
  vehicle_record RECORD;
  decoded_model JSONB;
  trim_code TEXT;
  engine_rpo TEXT;
  trans_rpo TEXT;
BEGIN
  -- Get vehicle data
  SELECT * INTO vehicle_record FROM vehicles WHERE id = NEW.vehicle_id;
  
  -- 1. DECODE MODEL CODE (if present in SPID)
  -- Example: CCE2436 → C20, Crew Cab, 1984
  IF NEW.model_code IS NOT NULL THEN
    -- Extract body series (24 = C20)
    UPDATE vehicles 
    SET model_series = CASE substring(NEW.model_code, 4, 2)
      WHEN '14' THEN 'C10'
      WHEN '24' THEN 'C20'
      WHEN '34' THEN 'C30'
      ELSE model_series
    END,
    cab_config = CASE substring(NEW.model_code, 6, 1)
      WHEN '3' THEN 'Crew Cab (3+3)'
      WHEN '4' THEN 'Regular Cab'
      WHEN '5' THEN 'Extended Cab'
      ELSE cab_config
    END
    WHERE id = NEW.vehicle_id;
  END IF;
  
  -- 2. DECODE TRIM FROM RPO CODES
  -- Look for trim codes: Z84=Silverado, YE9=Cheyenne, YF5=Custom Deluxe
  IF NEW.rpo_codes IS NOT NULL THEN
    SELECT code INTO trim_code
    FROM unnest(NEW.rpo_codes) AS code
    WHERE code IN ('Z84', 'YE9', 'YF5', 'YE8')
    LIMIT 1;
    
    IF trim_code IS NOT NULL THEN
      UPDATE vehicles
      SET trim_level = CASE trim_code
        WHEN 'Z84' THEN 'Silverado'
        WHEN 'YE9' THEN 'Cheyenne'
        WHEN 'YF5' THEN 'Custom Deluxe'
        WHEN 'YE8' THEN 'Scottsdale'
        ELSE trim_level
      END
      WHERE id = NEW.vehicle_id;
    END IF;
  END IF;
  
  -- 3. DECODE ENGINE FROM RPO CODES
  -- Look for engine codes: LS4=454, L31=350, LT1=350
  IF NEW.rpo_codes IS NOT NULL THEN
    SELECT code INTO engine_rpo
    FROM unnest(NEW.rpo_codes) AS code
    WHERE code IN ('LS4', 'L19', 'L31', 'LT1', 'L05', 'LL4')
    LIMIT 1;
    
    IF engine_rpo IS NOT NULL THEN
      UPDATE vehicles
      SET 
        engine_code = engine_rpo,
        engine_displacement = CASE engine_rpo
          WHEN 'LS4' THEN '454'
          WHEN 'L19' THEN '454'
          WHEN 'L31' THEN '350'
          WHEN 'LT1' THEN '350'
          WHEN 'L05' THEN '305'
          WHEN 'LL4' THEN '292'
          ELSE engine_displacement
        END,
        engine_liters = CASE engine_rpo
          WHEN 'LS4' THEN 7.4
          WHEN 'L19' THEN 7.4
          WHEN 'L31' THEN 5.7
          WHEN 'LT1' THEN 5.7
          WHEN 'L05' THEN 5.0
          WHEN 'LL4' THEN 4.8
          ELSE engine_liters
        END,
        engine_type = 'V8',
        engine = CASE engine_rpo
          WHEN 'LS4' THEN '7.4L V8 (454ci)'
          WHEN 'L19' THEN '7.4L V8 (454ci)'
          WHEN 'L31' THEN '5.7L V8 (350ci)'
          WHEN 'LT1' THEN '5.7L V8 (350ci)'
          WHEN 'L05' THEN '5.0L V8 (305ci)'
          ELSE engine
        END
      WHERE id = NEW.vehicle_id;
    END IF;
  END IF;
  
  -- 4. DECODE TRANSMISSION FROM RPO CODES
  -- Look for trans codes: M40=TH400, M38=TH350, M20=SM465
  IF NEW.rpo_codes IS NOT NULL THEN
    SELECT code INTO trans_rpo
    FROM unnest(NEW.rpo_codes) AS code
    WHERE code IN ('M40', 'M38', 'M20', 'M21', 'MT1')
    LIMIT 1;
    
    IF trans_rpo IS NOT NULL THEN
      UPDATE vehicles
      SET 
        transmission_code = trans_rpo,
        transmission_model = CASE trans_rpo
          WHEN 'M40' THEN 'TH400'
          WHEN 'M38' THEN 'TH350'
          WHEN 'M20' THEN 'SM465'
          WHEN 'M21' THEN 'SM420'
          WHEN 'MT1' THEN '4L60E'
          ELSE transmission_model
        END,
        transmission_type = CASE trans_rpo
          WHEN 'M40' THEN 'Automatic'
          WHEN 'M38' THEN 'Automatic'
          WHEN 'MT1' THEN 'Automatic'
          WHEN 'M20' THEN 'Manual'
          WHEN 'M21' THEN 'Manual'
          ELSE transmission_type
        END,
        transmission = CASE trans_rpo
          WHEN 'M40' THEN 'TH400 3-Speed Automatic'
          WHEN 'M38' THEN 'TH350 3-Speed Automatic'
          WHEN 'M20' THEN 'SM465 4-Speed Manual'
          WHEN 'M21' THEN 'SM420 4-Speed Manual'
          WHEN 'MT1' THEN '4L60E 4-Speed Automatic'
          ELSE transmission
        END
      WHERE id = NEW.vehicle_id;
    END IF;
  END IF;
  
  -- 5. SAVE RPO CODES TO vehicle_options
  IF NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0 THEN
    INSERT INTO vehicle_options (vehicle_id, option_code, source, verified_by_spid)
    SELECT 
      NEW.vehicle_id,
      unnest(NEW.rpo_codes),
      'spid',
      TRUE
    ON CONFLICT (vehicle_id, option_code) 
    DO UPDATE SET verified_by_spid = TRUE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## YOUR SPECIFIC VEHICLE

### What SPID Should Show

```
SPID Sheet for 1984 Chevy C20 Crew Cab:
─────────────────────────────────────────
VIN:    1GCXXXXXXXXX
MODEL:  CCE2436*
        ↓
        CC  = C/K series
        E   = 1984 model year
        24  = C20 (2-ton)
        3   = Crew Cab (3+3 seating)
        6   = Wheelbase indicator

RPO CODES:
  Z84 = Silverado Trim Package ← TRIM
  LS4 = 454ci V8 Engine        ← ENGINE
  M40 = TH400 Automatic        ← TRANSMISSION
  G80 = Locking Differential
  KC4 = Electric Transfer Case
  ... (more codes)

PAINT: 70 (Cardinal Red)
BUILD: 04/15/1984
```

### How Data Should Be Saved

```sql
UPDATE vehicles SET
  -- Basic identification
  year = 1984,
  make = 'Chevrolet',
  model = 'C20',               ← From SPID model code
  
  -- Configuration
  model_series = 'C20',        ← From model code position 4-5
  cab_config = 'Crew Cab (3+3)', ← From model code position 6
  trim_level = 'Silverado',    ← From RPO code Z84
  
  -- Engine (properly separated)
  engine = '7.4L V8 (454ci)',  ← Complete display
  engine_displacement = '454', ← CID
  engine_liters = 7.4,         ← Liters
  engine_type = 'V8',          ← Configuration
  engine_code = 'LS4',         ← RPO from SPID
  
  -- Transmission (specific model)
  transmission = 'TH400 3-Speed Automatic', ← Complete display
  transmission_model = 'TH400',             ← Specific model
  transmission_type = 'Automatic',          ← Type
  transmission_code = 'M40',                ← RPO from SPID
  
  -- Paint
  paint_code = '70',           ← From SPID
  color = 'Cardinal Red'       ← Decoded from paint code
WHERE id = vehicle_id;
```

---

## UI DISPLAY (Corrected)

### Basic Info Card - BEFORE vs AFTER

**BEFORE (Wrong):**
```
┌──────────────────────────────────┐
│ Trim: C20 3+3 454ci              │ ← Everything jumbled
│ Transmission: automatic          │ ← Too vague
│ Engine: (missing)                │ ← Not shown
└──────────────────────────────────┘
```

**AFTER (Correct):**
```
┌──────────────────────────────────────────────┐
│ BASIC INFORMATION     [Verified by SPID]     │
├──────────────────────────────────────────────┤
│ Year:   1984                                 │
│ Make:   Chevrolet                            │
│ Model:  C20                ✓ From SPID       │
│                                              │
│ Cab:    Crew Cab (3+3)     ✓ From SPID       │
│ Trim:   Silverado          ✓ From SPID (Z84) │
│                                              │
│ Engine: 7.4L V8 (454ci)    ✓ From SPID (LS4) │
│                                              │
│ Transmission: TH400 3-Speed Automatic        │
│               ✓ From SPID (M40)              │
│                                              │
│ [View SPID Sheet →]                          │
└──────────────────────────────────────────────┘
```

---

## IMPLEMENTATION STEPS

### 1. Add New Columns to vehicles Table

```sql
ALTER TABLE vehicles 
  ADD COLUMN IF NOT EXISTS model_series TEXT,
  ADD COLUMN IF NOT EXISTS cab_config TEXT,
  ADD COLUMN IF NOT EXISTS trim_level TEXT,
  ADD COLUMN IF NOT EXISTS engine_displacement TEXT,
  ADD COLUMN IF NOT EXISTS engine_liters NUMERIC,
  ADD COLUMN IF NOT EXISTS engine_type TEXT,
  ADD COLUMN IF NOT EXISTS engine_code TEXT,
  ADD COLUMN IF NOT EXISTS transmission_model TEXT,
  ADD COLUMN IF NOT EXISTS transmission_type TEXT,
  ADD COLUMN IF NOT EXISTS transmission_code TEXT;
```

### 2. Add model_code to vehicle_spid_data

```sql
ALTER TABLE vehicle_spid_data
  ADD COLUMN IF NOT EXISTS model_code TEXT,
  ADD COLUMN IF NOT EXISTS sequence_number TEXT;
```

### 3. Update SPID Detection to Extract Model Code

```typescript
// In detectSPIDSheet function (analyze-image/index.ts)

content: `Extract from SPID sheet:
{
  "is_spid_sheet": boolean,
  "confidence": number,
  "extracted_data": {
    "vin": string,
    "model_code": string,        ← ADD THIS
    "build_date": string,
    "sequence_number": string,   ← ADD THIS
    "paint_code_exterior": string,
    "paint_code_interior": string,
    "rpo_codes": string[],
    ...
  }
}

The MODEL CODE is usually on a line like:
MODEL: CCE2436* or CKE1418Z

Extract the EXACT text after "MODEL:" including all characters.
`
```

### 4. Update Verification Trigger (Use RPO Codes)

Already shown above - decodes RPO codes to fill:
- Trim from Z84/YE9/YF5
- Engine from LS4/L31/LT1
- Transmission from M40/M38/M20

### 5. Update UI to Show Separated Fields

```tsx
// VehicleBasicInfo.tsx

<div className="field-row">
  <label>Model</label>
  <span>{vehicle.model_series || vehicle.model}</span>
  {spidData && <span className="badge">✓ From SPID</span>}
</div>

<div className="field-row">
  <label>Cab Configuration</label>
  <span>{vehicle.cab_config}</span>
  {spidData && <span className="badge">✓ From SPID</span>}
</div>

<div className="field-row">
  <label>Trim Level</label>
  <span>{vehicle.trim_level}</span>
  {spidData?.rpo_codes?.includes('Z84') && (
    <span className="badge">✓ From SPID (Z84)</span>
  )}
</div>

<div className="field-row">
  <label>Engine</label>
  <div>
    <span>{vehicle.engine}</span>
    {vehicle.engine_code && (
      <span className="code-badge">{vehicle.engine_code}</span>
    )}
  </div>
  {spidData?.rpo_codes?.some(c => ['LS4', 'L31', 'LT1'].includes(c)) && (
    <span className="badge">✓ From SPID</span>
  )}
</div>

<div className="field-row">
  <label>Transmission</label>
  <div>
    <span>{vehicle.transmission}</span>
    {vehicle.transmission_code && (
      <span className="code-badge">{vehicle.transmission_code}</span>
    )}
  </div>
  {spidData?.rpo_codes?.some(c => ['M40', 'M38', 'M20'].includes(c)) && (
    <span className="badge">✓ From SPID</span>
  )}
</div>
```

---

## CORRECT YOUR SPECIFIC VEHICLE

### What Should Happen When You Upload SPID

```
CURRENT DATA (WRONG):
  trim = "C20 3+3 454ci"
  transmission = "automatic"
  engine = ???

SPID EXTRACTS:
  model_code = "CCE2436"
  rpo_codes = ["Z84", "LS4", "M40", ...]

TRIGGER DECODES AND UPDATES:
  model_series = "C20"           (from model code)
  cab_config = "Crew Cab (3+3)"  (from model code)
  trim_level = "Silverado"       (from Z84 RPO)
  engine = "7.4L V8 (454ci)"     (from LS4 RPO)
  engine_code = "LS4"
  transmission = "TH400 3-Speed Automatic" (from M40 RPO)
  transmission_code = "M40"

UI DISPLAYS:
  Model: C20 ✓
  Cab: Crew Cab (3+3) ✓
  Trim: Silverado ✓
  Engine: 7.4L V8 (454ci) [LS4] ✓
  Transmission: TH400 3-Speed Automatic [M40] ✓
```

---

## SUMMARY

**Your Issue:** Data jumbled and unverified
**Root Cause:** 
  1. No proper field separation in database
  2. SPID data extracted but not used for verification
  3. RPO codes not decoded

**Solution:**
  1. ✅ Add proper columns (model_series, cab_config, trim_level, engine_code, etc.)
  2. ✅ Decode SPID model code → Model + Cab
  3. ✅ Decode RPO codes → Trim + Engine + Transmission
  4. ✅ Auto-update vehicle record with verified data
  5. ✅ Show "✓ From SPID" badges in UI

**Result:** SPID sheet becomes the authoritative source for factory specifications.

**Want me to create the migration and deploy these fixes?**

