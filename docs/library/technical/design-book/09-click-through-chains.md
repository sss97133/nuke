# 09 — Click-Through Chains

> Every data point is a query. Every click drills toward source evidence. The chain always terminates at ground truth.

---

## The Principle

The vehicle profile is not a document. It is a **query surface**. Every visible data point — every field value, every badge, every number, every keyword in a description — is a compressed representation of underlying data. Clicking it decompresses: it runs the query and shows the results.

The results are one of:
1. **Another aggregation** — click "Chevrolet" → all Chevrolets in the system
2. **Source evidence** — click VIN → NHTSA decode response + VIN plate photos
3. **Image evidence** — click "scratches" → photos tagged with condition issues

The click-through chain always moves in one direction: **from inference toward ground truth**. Ground truth for vehicles is ultimately images, documents, and physical measurements.

---

## The Chain

```
Layer 0: AGGREGATION     "There are 814K vehicles"
    ↓ click
Layer 1: FILTERED SET    "3,200 Chevrolets"
    ↓ click
Layer 2: PROFILE         "1983 GMC K2500"
    ↓ click any data point
Layer 3: EVIDENCE        "VIN decoded by NHTSA + listed on BaT + AI-extracted from photos"
    ↓ click source
Layer 4: SOURCE          "BaT listing page archived 2026-02-15"
    ↓ click claim
Layer 5: GROUND TRUTH    "Photo of VIN plate showing 1GTGK24M1DJ514592"
```

Layer 0-1 already exists (BadgePortal cluster panels, search, browse).
Layer 2 is the profile itself.
Layer 3-5 is what's mostly missing. The provenance drawers show Layer 3 (which sources contributed a value) but don't link through to Layer 4-5 (the actual source page, the actual photo).

---

## Examples

### VIN Click-Through
```
Click VIN "1GTGK24M1DJ514592" in dossier panel
  → Popup:
    NHTSA DECODE
    Year: 1983  Make: GMC  Model: K2500
    Plant: Pontiac, MI  Body: Pickup
    Engine: 5.7L V8  GVWR: 6001-7000 lbs

    VIN EVIDENCE (3 photos)
    [photo of VIN plate on door jamb]
    [photo of VIN on title document]
    [photo of VIN on dash visible through windshield]

    SOURCES
    NHTSA decode · BaT listing · User upload
```

### Description → Image Evidence
```
Description says: "Some scratches on the driver's side rear quarter panel"
  → Click "scratches"
  → Gallery filters to: images tagged with condition issues on driver rear quarter
  → Or if no tagged images exist: shows "No visual evidence for this claim"
```

### Field Value → Source Chain
```
Click "350ci SBC V8" in ENGINE TYPE field
  → Popup:
    3 SOURCES AGREE (consensus)

    [VIN] NHTSA decode → 5.7L V8 (confidence: decoded)
    [BaT] Listing title → "350ci V8" (confidence: listing text)
    [AI]  Vision analysis → SBC V8 identified from engine bay photo
          → [photo: engine bay showing valve covers + intake]

    ENGINE BAY PHOTOS (8)
    [grid of engine bay photos]
```

### Price → Comp Chain
```
Click "$31,000" in SALE PRICE
  → Popup:
    SOLD on BaT · Feb 15, 2026 · No Reserve

    COMPARABLE SALES (method: canonical)
    1981 K20 Scottsdale — $28,500 (BaT, Jan 2026)
    1985 K10 Custom Deluxe — $33,000 (BaT, Dec 2025)
    1979 K20 Bonanza — $26,200 (Mecum, Nov 2025)

    → Click any comp → opens that vehicle's profile
```

---

## What Makes a Data Point "Click-Through Ready"

A data point can be made interactive when ALL of these exist:
1. **The value itself** (what's displayed)
2. **At least one source** (where the value came from)
3. **At least one piece of evidence** (photo, document, decoded data, or archived page)

If only #1 exists → the data point stays dead text. That's honest. An empty popup is worse than dead text.

If #1 + #2 exist → the click shows the provenance chain (which sources contributed).

If #1 + #2 + #3 exist → the click shows provenance AND links to ground truth (images, documents).

---

## Implementation Pattern

Every click-through uses the same popup pattern:

```typescript
// Generic: click any field value
onClick={() => openPopup(
  <FieldEvidencePopup
    field={fieldName}
    value={displayValue}
    evidence={fieldEvidence}       // from useFieldEvidence hook
    vehicleId={vehicleId}
    galleryFilter={{ tag: fieldName }}  // cross-column coupling
  />,
  `${fieldLabel} — Evidence`,
  520,
  false,
)}
```

The `FieldEvidencePopup` component:
1. Shows the value prominently
2. Lists all sources with trust level (VIN > BaT > AI > User)
3. Shows tagged photos if they exist
4. Links to archived source pages if they exist
5. Shows "No visual evidence" honestly when images don't exist

---

## What Blocks Click-Through (Pipeline Gaps)

| Data Point | What's Missing | Pipeline Fix |
|-----------|---------------|-------------|
| Mileage history | Only snapshot readings, no continuous tracking | Every event needs odometer state |
| Nuke Estimate | No robust inference algorithm | Need granular comp weighting system |
| Condition claims | Image analysis too shallow for targeted queries | Deeper vision models or multi-model ensemble |
| Description keywords | No keyword → image tag bridging | NLP extraction + image tag matching |
| Modification details | Sparse photo tagging per modification | Vision pipeline needs mod-specific classifiers |

These gaps are pipeline problems, not UI problems. Don't fake click-through with empty popups. Show what you have, hide what you don't.

---

## Already Implemented

| Pattern | Where | Status |
|---------|-------|--------|
| BadgePortal cluster panels | VehicleSubHeader | Working — year, make, model, trim, body, engine, trans, drivetrain, location |
| Provenance drawer | VehicleDossierPanel | Working — expands to show all evidence sources per field |
| Gallery filter coupling | WorkspaceContent ↔ ImageGallery | Working — zone, category, tag, dateRange filters |
| Day Card popup | BarcodeTimeline | Working — click day → receipt → + → full day card |
| Signal detail popup | AnalysisSignalsSection | Working — click signal → evidence + recommendations |
| Modification → gallery | VehicleListingDetailsCard | Working — click mod name → filters gallery |
| Color → gallery | VehicleDossierPanel | Working — click color value → exterior/interior filter |

---

## Next to Implement

Priority order (based on existing data availability):

1. **VIN → decode + VIN photos** — decode data exists (NHTSA), VIN plate photos filterable by zone
2. **Field value → evidence popup with photos** — field_evidence exists, image zones exist, need bridge
3. **Sale price → comp popup** — comp data exists in nuke_estimates, need presentation layer
4. **Description claims → image evidence** — description_discoveries + image tags, need keyword matching
5. **Hero image 5Ws** — image metadata exists (taken_at, zone, category, ai_scan_metadata)

---

*This document defines the click-through philosophy. Read it before adding any onClick handler. If the underlying data doesn't exist to complete the chain, don't add the click.*
