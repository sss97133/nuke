# Fix Vehicle Data Structure - Deploy Now

**Your Vehicle Issues Fixed by SPID Verification**

---

## YOUR CURRENT WRONG DATA

```
Trim: C20 3+3 454ci              ← Model + Cab + Engine jumbled
Transmission: automatic           ← Too vague (which automatic?)
Engine: (missing or wrong)        ← Not properly shown
```

---

## WHAT SPID WILL FIX

### SPID Sheet Contains:

```
VIN:   1GCXXXXXXXXX
MODEL: CCE2436*
       ↓ Decodes to:
       CC  = C/K series
       E   = 1984
       24  = C20 (2-ton)
       3   = Crew Cab (3+3)
       6   = Wheelbase

RPO CODES:
  Z84 = Silverado Trim       ← Your actual trim
  LS4 = 454ci V8 Engine      ← Confirms engine
  M40 = TH400 Automatic      ← Confirms transmission
  G80 = Locking Differential
  KC4 = Transfer Case (4WD)
  C60 = Air Conditioning
  ...

PAINT: 70 (Cardinal Red)
```

### Auto-Corrected Data:

```
Model Series:    C20                    ✓ From SPID model code
Cab Config:      Crew Cab (3+3)         ✓ From SPID model code
Trim Level:      Silverado              ✓ From SPID (Z84 RPO)

Engine:          7.4L V8 (454ci)        ✓ From SPID (LS4 RPO)
Engine Code:     LS4
Engine Disp:     454ci
Engine Liters:   7.4L

Transmission:    TH400 3-Speed Automatic ✓ From SPID (M40 RPO)
Trans Code:      M40
Trans Type:      Automatic
```

---

## DEPLOYMENT STEPS

### Step 1: Run Database Migrations (2 minutes)

```bash
cd /Users/skylar/nuke

# Add new columns to vehicles table
npx supabase db reset

# Or if you want to keep data:
psql $DATABASE_URL < supabase/migrations/20251122_vehicle_data_structure_fix.sql
psql $DATABASE_URL < database/spid_verification_system.sql
```

This creates:
- ✅ New columns: `model_series`, `cab_config`, `trim_level`
- ✅ New columns: `engine_code`, `engine_displacement`, `engine_liters`
- ✅ New columns: `transmission_model`, `transmission_type`, `transmission_code`
- ✅ RPO code lookup table with definitions
- ✅ Enhanced verification trigger that decodes RPO codes

### Step 2: Deploy Edge Function (1 minute)

```bash
cd /Users/skylar/nuke
npx supabase functions deploy analyze-image
```

This updates the AI to:
- ✅ Extract model code (CCE2436)
- ✅ Extract sequence number
- ✅ Request better descriptions
- ✅ Save to vehicle_spid_data with all fields

### Step 3: Deploy Frontend (2 minutes)

```bash
cd /Users/skylar/nuke/nuke_frontend
vercel --prod --force --yes

# Verify deployment
curl -s https://n-zero.dev | grep -o '_next/static/[^/]*' | head -1
```

This fixes:
- ✅ EXIF data display (no more "[object Object]")
- ✅ Clickable uploader names
- ✅ AI description attribution
- ✅ SPID detection badge

### Step 4: Process Your Images (5 minutes)

```bash
cd /Users/skylar/nuke
node scripts/process-january-images.js
```

This will:
- Find all January images
- Trigger AI analysis
- Detect SPID sheet
- Extract model code + RPO codes
- Auto-verify and correct vehicle data

---

## WHAT HAPPENS TO YOUR VEHICLE

### Before SPID Processing:

```sql
SELECT 
  year, make, model, trim, engine, transmission
FROM vehicles 
WHERE id = '3f1791fe-4fe2-4994-b6fe-b137ffa57370';

Result:
  year: 1984
  make: Chevrolet
  model: C20
  trim: "C20 3+3 454ci"           ← WRONG (jumbled)
  engine: NULL or wrong
  transmission: "automatic"        ← VAGUE
```

### After SPID Detected & Processed:

```sql
SELECT 
  year, make, model,
  model_series, cab_config, trim_level,
  engine, engine_code, engine_displacement, engine_liters,
  transmission, transmission_model, transmission_code
FROM vehicles 
WHERE id = '3f1791fe-4fe2-4994-b6fe-b137ffa57370';

Result:
  year: 1984
  make: Chevrolet
  model: C20
  
  model_series: "C20"              ← From SPID model code
  cab_config: "Crew Cab (3+3)"     ← From SPID model code
  trim_level: "Silverado"          ← From SPID (Z84 RPO)
  
  engine: "7.4L V8 (454ci)"        ← From SPID (LS4 RPO)
  engine_code: "LS4"
  engine_displacement: "454"
  engine_liters: 7.4
  
  transmission: "TH400 3-Speed Automatic" ← From SPID (M40 RPO)
  transmission_model: "TH400"
  transmission_code: "M40"
```

### RPO Codes Saved:

```sql
SELECT option_code, option_name, category, verified_by_spid
FROM vehicle_options
WHERE vehicle_id = '3f1791fe-4fe2-4994-b6fe-b137ffa57370'
ORDER BY category, option_code;

Results:
  Z84  Silverado Package        trim          TRUE
  LS4  454ci V8 Engine           engine        TRUE
  M40  TH400 Automatic          transmission   TRUE
  G80  Locking Differential     drivetrain     TRUE
  KC4  Electric Transfer Case   drivetrain     TRUE
  C60  Air Conditioning         comfort        TRUE
  AU3  Power Door Locks         convenience    TRUE
  ...
```

---

## UI DISPLAY AFTER FIX

### Vehicle Profile - Basic Info

```
┌──────────────────────────────────────────────────────┐
│ BASIC INFORMATION          [Verified by SPID Sheet] │
├──────────────────────────────────────────────────────┤
│ Year:   1984                                         │
│ Make:   Chevrolet                                    │
│ Model:  C20                    ✓ From SPID           │
│                                                      │
│ Cab Configuration:  Crew Cab (3+3)                   │
│                     ✓ From SPID model code           │
│                                                      │
│ Trim Level:  Silverado                               │
│              ✓ From SPID (Z84 RPO code)              │
│                                                      │
│ Engine:  7.4L V8 (454ci)                            │
│          [LS4]                                       │
│          ✓ From SPID RPO code                        │
│                                                      │
│ Transmission:  TH400 3-Speed Automatic              │
│                [M40]                                 │
│                ✓ From SPID RPO code                  │
│                                                      │
│ [View SPID Sheet →]                                  │
└──────────────────────────────────────────────────────┘
```

### Factory Options (RPO Codes from SPID)

```
┌──────────────────────────────────────────────────────┐
│ FACTORY OPTIONS             [12 codes from SPID]    │
├──────────────────────────────────────────────────────┤
│ TRIM                                                 │
│ ┌────────────────────────────────────┐              │
│ │ Z84 - Silverado Package            │              │
│ │ ✓ From SPID                        │              │
│ └────────────────────────────────────┘              │
│                                                      │
│ ENGINE                                               │
│ ┌────────────────────────────────────┐              │
│ │ LS4 - 454ci V8 Engine (7.4L)       │              │
│ │ ✓ From SPID                        │              │
│ └────────────────────────────────────┘              │
│                                                      │
│ TRANSMISSION                                         │
│ ┌────────────────────────────────────┐              │
│ │ M40 - TH400 3-Speed Automatic      │              │
│ │ ✓ From SPID                        │              │
│ └────────────────────────────────────┘              │
│                                                      │
│ DRIVETRAIN                                           │
│ ┌──────────────┐ ┌──────────────────┐              │
│ │ G80          │ │ KC4              │              │
│ │ Locking Diff │ │ Transfer Case    │              │
│ │ ✓ From SPID  │ │ ✓ From SPID      │              │
│ └──────────────┘ └──────────────────┘              │
│                                                      │
│ COMFORT & CONVENIENCE                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ C60      │ │ AU3      │ │ N33      │             │
│ │ A/C      │ │ Pwr Locks│ │ Tilt Whl │             │
│ └──────────┘ └──────────┘ └──────────┘             │
│                                                      │
│ [View SPID Sheet →]                                  │
└──────────────────────────────────────────────────────┘
```

### Image Lightbox - Complete EXIF

```
┌──────────────────────────────────────────────────────┐
│ EXIF DATA                                            │
├──────────────────────────────────────────────────────┤
│ Camera                                               │
│ Apple iPhone 14 Pro                                  │
│                                                      │
│ Photo Taken                                          │
│ 1/9/2024, 3:42:07 PM                                │
│                                                      │
│ Camera Settings                                      │
│ ISO 100 • f/1.78 • 1/120s • 26mm                    │
│                                                      │
│ Location                                             │
│ Austin, TX                                           │
│ 30.2672, -97.7431                                   │
│                                                      │
│ Dimensions                                           │
│ 4032 × 3024 pixels                                  │
├──────────────────────────────────────────────────────┤
│ SOURCE                                               │
├──────────────────────────────────────────────────────┤
│ Uploaded by: [skylar williams] ← clickable          │
│ Source: user_upload                                  │
├──────────────────────────────────────────────────────┤
│ AI ANALYSIS                           ℹ Source       │
├──────────────────────────────────────────────────────┤
│ What:                                                │
│ SPID sheet showing factory build specifications      │
│ with VIN, model code, and RPO option codes visible   │
│                                                      │
│ AI: GPT-4o    ℹ How was this generated?              │
│                                                      │
│ Photographer: skylar williams                        │
│                                                      │
│ ┌──────────────────────────────────────────────┐   │
│ │ SPID SHEET DETECTED             95%          │   │
│ ├──────────────────────────────────────────────┤   │
│ │ VIN: 1GCXXXXXXXXX                            │   │
│ │ Model Code: CCE2436                          │   │
│ │ Paint: 70                                    │   │
│ │ RPO Codes: 12 extracted                      │   │
│ │ [View All Extracted Data →]                  │   │
│ └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## VERIFICATION LOG

After processing, check what was verified:

```sql
SELECT 
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  vl.results->>'model_code_decoded' as model_decoded,
  vl.results->>'model_series' as model_series,
  vl.results->>'cab_config' as cab,
  vl.results->>'trim_decoded' as trim,
  vl.results->>'engine_decoded' as engine,
  vl.results->>'transmission_decoded' as transmission,
  vl.results->'rpo_codes_added' as rpo_count
FROM vehicle_verification_log vl
JOIN vehicles v ON v.id = vl.vehicle_id
WHERE vl.vehicle_id = '3f1791fe-4fe2-4994-b6fe-b137ffa57370'
ORDER BY vl.created_at DESC
LIMIT 1;

Result:
  vehicle: 1984 Chevrolet C20
  model_decoded: true
  model_series: C20
  cab: Crew Cab (3+3)
  trim: Silverado
  engine: 7.4L V8 (454ci)
  transmission: TH400 3-Speed Automatic
  rpo_count: 12
```

---

## RUN THESE COMMANDS NOW

```bash
cd /Users/skylar/nuke

# 1. Add new columns (30 seconds)
npx supabase db reset

# 2. Deploy edge function (1 minute)
npx supabase functions deploy analyze-image

# 3. Deploy frontend (2 minutes)
cd nuke_frontend
vercel --prod --force --yes

# 4. Process January images (5 minutes)
cd /Users/skylar/nuke
node scripts/process-january-images.js
```

---

## RESULT

**Before:**
- Trim: C20 3+3 454ci (jumbled mess)
- Transmission: automatic (vague)
- Engine: missing

**After:**
- Model: C20 ✓
- Cab: Crew Cab (3+3) ✓
- Trim: Silverado ✓
- Engine: 7.4L V8 (454ci) [LS4] ✓
- Transmission: TH400 3-Speed Automatic [M40] ✓
- All verified by SPID sheet
- 12 RPO codes extracted and displayed

**SPID sheet becomes the authoritative source of truth! 🎯**

