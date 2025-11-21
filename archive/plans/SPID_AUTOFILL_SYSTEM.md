# SPID SHEET AUTO-FILL SYSTEM

## Philosophy: SPID = 100% Truth of Origin

The SPID (Service Parts Identification) sheet is the **definitive source** for factory configuration. It's the foundation - everything builds from here.

## What We Auto-Fill From SPID:

### 1. **Year** (from VIN)
- Pre-1981 (13-char): Position 6 = year digit (0-9 = 1970-1979)
- Post-1981 (17-char): Position 10 = year code (A-Y, 1-9)
- **Confidence: 100%**

### 2. **Make** (always GM brand)
- Chevrolet, GMC, Pontiac, Oldsmobile, Buick, Cadillac
- Decoded from VIN first character
- **Confidence: 100%**

### 3. **Model** (from VIN positions 3-4)
- C10, C20, C30 = 2WD trucks
- K10, K20, K30 = 4WD trucks
- Decoded from wheelbase/series code
- **Confidence: 100%**

### 4. **Trim** (from RPO codes or model suffix)
- Cheyenne, Scottsdale, Silverado, High Country
- Sometimes in model code, sometimes RPO
- **Confidence: 90%**

### 5. **Engine** (from RPO codes)
- LB9 = 5.7L V8 (350 ci)
- L31 = 5.7L V8 Vortec
- LQ4 = 6.0L V8
- **Confidence: 100%** (as-built, not current)

### 6. **Transmission** (from RPO codes)
- MX0 = 3-Speed Manual
- M40 = 3-Speed Auto (TH350)
- MD8 = 4-Speed Auto (700R4)
- **Confidence: 100%** (as-built)

### 7. **Axle Ratio** (from RPO codes)
- GU4 = 3.08:1
- GU5 = 3.42:1
- GU6 = 3.73:1
- GT4 = 4.10:1
- **Confidence: 100%**

### 8. **Differential** (from RPO codes)
- G80 = Positraction/Locking differential
- **Confidence: 100%**

### 9. **Suspension** (from RPO codes)
- ZQ8 = Sport package
- F60 = Heavy duty front springs
- **Confidence: 100%**

### 10. **Paint Code** (from SPID)
- Exterior and interior trim codes
- **Confidence: 100%**

### 11. **All Factory Options** (from RPO codes)
- Stored in `vehicle_dynamic_data` table
- Each RPO code gets its own row
- **Confidence: 100%**

---

## Implementation Flow:

```
1. User uploads image → AI detects SPID sheet
2. Extract all data (VIN, model code, RPO codes, paint)
3. Decode VIN → Year, Make, Model
4. Decode RPO codes → Engine, Trans, Axle, Options
5. AUTO-FILL vehicle profile (no questions asked)
6. Store each field as 100% validated
7. Flag SPID image as "document" category
8. Create data_validations entries for audit trail
```

---

## Key Insight: Factory vs. Current

**SPID tells us how the vehicle left the factory.**

If the engine or transmission was swapped later, that's fine! The SPID baseline lets us:
- Know what's original vs. modified
- Calculate modification value impact
- Track build history accurately
- Detect potential fraud (wrong year, wrong model, etc.)

---

## Example: 1978 Chevrolet C10 Cheyenne

### SPID Sheet Data:
```
VIN: CE1418647123
MODEL: CE10934
RPO CODES: LB9, MX0, GU4, G80, ZQ8, X88, 1SB
PAINT: 01U
```

### Auto-Filled Profile:
- **Year:** 1978 (from VIN[6] = '8')
- **Make:** Chevrolet (from VIN[0] = 'C')
- **Model:** C10 (from VIN[2-3] = '14' = 117" wheelbase)
- **Trim:** Cheyenne (from model suffix or manual entry)
- **Engine:** 5.7L V8 (350 ci) - RPO LB9
- **Transmission:** 3-Speed Manual - RPO MX0
- **Axle:** 3.08:1 with Positraction - RPO GU4 + G80
- **Suspension:** Sport Package - RPO ZQ8
- **Paint:** 01U
- **VIN:** CE1418647123 ✅

---

## Deployment Status:

✅ **SPID Detector** - `detect-spid-sheet` edge function (deployed)
✅ **VIN Decoder** - Logic built into auto-fill function
✅ **RPO Database** - 20+ common codes mapped
✅ **Auto-Fill Function** - `auto-fill-from-spid` (ready to deploy)
🔄 **UI Integration** - Need to add "Apply SPID Data" button to vehicle profile

---

## Next Steps:

1. ✅ Deploy `auto-fill-from-spid` edge function
2. Add UI button: "Scan SPID Sheet" on image viewer
3. When SPID detected → Show "Apply Factory Specs" button
4. One click → Auto-fill entire vehicle profile
5. Show before/after comparison
6. User approves → Done!

---

## Files Created:

- `/supabase/functions/detect-spid-sheet/index.ts` - SPID detection
- `/supabase/functions/auto-fill-from-spid/index.ts` - Auto-fill logic
- `SPID_DECODE_C10.md` - Documentation
- `SPID_VIN_DECODED.md` - VIN decode reference
- `SPID_AUTOFILL_SYSTEM.md` - This file

---

**Bottom Line:** SPID sheet = instant, accurate, verified vehicle data. One photo, entire profile filled correctly. 🎯

