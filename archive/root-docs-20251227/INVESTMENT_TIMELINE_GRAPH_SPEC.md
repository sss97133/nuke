# Investment Timeline Graph - Specification

## YOUR VISION (Captured)

> "$25,000 eventually needs to be a graph tracking investment pricing during lifetime. Life starts at build date, flatline until our data. Users crawl out of darkness and input data from the 80's. We estimate gas paid, registration fees, etc as estimates. Vehicles with solid documentation are the special ones."

---

## THE GRAPH

```
Value
  │
$60k│                                              ┌─── Current: $56k
    │                                             /│    (Documented)
    │                                            / │
    │                                           /  │
$40k│                                          /   │
    │                                    ┌────/    │ ▲ Receipts
    │                              ┌────/          │   $28k verified
    │                        ┌────/                │
$20k│                  ┌────/                      │ ▲ Purchase
    │            ┌────/  Estimates (dotted)        │   $25k
    │      ┌────/                                  │
$15k│──────┘ MSRP                                  │ ▲ Gas/fees est.
    │  (Factory)                                   │   $3k
    │  Flatline (no data)                          │
  $0└──┴───────────────────────────────┴───────────┴──→ Time
    1983                              2024        2025
  Build Date                     First Data   Current
```

---

## DATA POINTS (In Order)

### 1. **Factory Build (1983)**
```
Value: $15,000 (1983 MSRP for GMC K2500)
Source: VIN decode + GM Heritage Center
Confidence: 100% (authoritative)
Type: DOCUMENTED (solid line)
```

### 2. **The Dark Ages (1983-2024)**
```
Value: Flatline at $15k
Source: No data available
Confidence: 0%
Type: UNKNOWN (grey flatline)

Estimates we could add:
  - Gas: ~30k miles/yr × 41 yrs × 10mpg × $3/gal = $3,690
  - Registration: 41 years × $50/yr = $2,050
  - Insurance: 41 years × $800/yr = $32,800
  - Maintenance: Estimated $500/yr = $20,500
  
Total estimated: ~$59k spent
Disclosure: "ESTIMATED - No documentation"
```

### 3. **Your Purchase (2024)**
```
Value: $25,000
Source: Manual entry (you typed it in)
Confidence: 70% (no receipt to prove)
Type: SEMI-DOCUMENTED (dashed line)

When you upload purchase receipt:
  Confidence: 95% (verified)
  Type: DOCUMENTED (solid line)
```

### 4. **Build Estimate (Sept 2024)**
```
Value: +$31,633 investment planned
Source: Build estimate CSV
Confidence: 75% (estimate, not actual)
Type: ESTIMATED (dotted line)

Components:
  - Paint (Taylor): $21,848
  - Interior (Ernies): $7,067
  - Mechanical: $1,715
```

### 5. **Actual Work (As Completed)**
```
Value: +$X (receipts uploaded)
Source: Verified receipts from Taylor, Ernies
Confidence: 95% (proof of payment)
Type: DOCUMENTED (solid line)

When paint is done:
  - Upload receipt from Taylor: $21,848
  - Line changes: dotted → solid
  - Confidence: 75% → 95%
```

### 6. **Current Value (2025)**
```
Value: $25k purchase + $31k investment = $56,633
Source: Purchase + documented work
Confidence: 85% (mix of verified + estimated)
Type: MIXED (solid for verified, dotted for estimated)
```

---

## GRAPH FEATURES

### Line Types:
- **Solid line** = Documented (receipts, VIN, verified)
- **Dashed line** = User-entered (no receipt)
- **Dotted line** = Estimated (calculated, not verified)
- **Grey line** = Unknown (no data)

### Hover/Click:
```
Hover over any point → Tooltip shows:
┌────────────────────────────────┐
│ Sept 15, 2024                  │
│ Paint Work                     │
│ +$21,848                       │
│                                │
│ Source: Build Estimate CSV     │
│ Confidence: 75%                │
│ Status: In Progress            │
│                                │
│ [Click for details]            │
└────────────────────────────────┘

Click → Opens ValueProvenancePopup
```

### Segments:
- **Factory (1983)**: Grey flatline
- **Dark ages (1983-2024)**: Light grey with dotted estimates
- **Your data (2024+)**: Colored by confidence
  - Green: 90%+ (verified receipts)
  - Blue: 75-89% (estimates, photos)
  - Yellow: 60-74% (manual entry)
  - Red: <60% (no evidence)

---

## DATA SOURCES (By Confidence)

### 100% - Authoritative
- VIN decode (factory specs)
- GM Heritage Center (build sheet)
- Title documents (ownership)

### 95% - Verified
- Receipts (scanned, OCR'd)
- Bank records (payment proof)
- Auction results (BaT, Mecum)

### 75% - Estimated (Documented Basis)
- Build estimates (from shops)
- GPS photo clusters (work confirmed)
- AI work detection (visual proof)

### 50% - Calculated Estimates
- Gas costs (from mileage)
- Registration fees (from state)
- Insurance estimates (from year/model)

### 0% - Unknown
- No data available
- Flatline on graph

---

## SPECIAL VEHICLES (Your Point)

**Regular vehicle:**
```
1983 ─────────────────────── 2024 ──→ 2025
     Grey flatline           Your data
     (no documentation)      (estimates)
     
Confidence: 50%
```

**SPECIAL vehicle:**
```
1983 ────────────────────────────────→ 2025
     Original purchase receipt
     Every service receipt
     All registration records
     Gas receipts saved
     
Confidence: 95%
Documentation: COMPLETE
```

**The special ones = full provenance back to factory**

---

## GM HERITAGE UPGRADE (Your Idea)

> "click here to get a gm heritage upgrade... and we automate the transaction"

### The Flow:
```
User sees: "1983 GMC K2500 - Limited factory data"

Button: [GET GM HERITAGE REPORT] $29.95
  ↓
Click → Stripe checkout
  ↓
Payment → Auto-submit VIN to GM Heritage Center
  ↓
Receive: Build sheet, RPO codes, factory specs
  ↓
Import: Auto-populate factory options, paint codes, etc.
  ↓
Graph: Factory section now SOLID LINE (100% confidence)
  ↓
Badge: "🏭 Factory Verified"
```

**This fills the "dark ages" with authoritative data.**

---

## ESTIMATED vs DOCUMENTED

### Estimates (Dotted Line):
```
⚠️ ESTIMATED
Based on typical costs, no receipts.
Confidence: 50%

Gas: $3,690 (est. 30k mi/yr, 10mpg, $3/gal)
Registration: $2,050 (est. $50/yr × 41 yrs)
Insurance: $32,800 (est. $800/yr × 41 yrs)

Total estimated: $59,040
Disclosure: "Calculations based on averages"
```

### Documented (Solid Line):
```
✅ VERIFIED
Actual receipts uploaded.
Confidence: 95%

Paint: $21,848 (Taylor Customs receipt)
Interior: $7,067 (Ernies receipt)
Purchase: $25,000 (bill of sale)

Total documented: $53,915
Proof: 3 receipts, 417 photos
```

**Special = when dotted becomes solid**

---

## PHASE 1: Click Value → See Source (Deploying Now)

Simple popup, instant transparency.

## PHASE 2: Investment Timeline Graph (Next)

Visual history from build to present.

## PHASE 3: Estimate Dark Ages (Future)

Calculate gas, fees, insurance for missing years.

## PHASE 4: GM Heritage Integration (Future)

Auto-purchase factory docs to fill gaps.

---

**Phase 1 deploying now. Provenance popup live in 3 minutes.**

