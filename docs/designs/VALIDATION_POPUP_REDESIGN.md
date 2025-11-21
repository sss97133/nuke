# Validation Popup Redesign - Mockup for Approval

## Current vs Proposed Design

### CURRENT (Too Wordy, Generic)
```
┌──────────────────────────────────────┐
│ Validation: MAKE                   × │
├──────────────────────────────────────┤
│ Current Value                        │
│ Chevrolet                            │
│                                      │
│ Sources: 1  Validators: 0  Avg: 80% │
│                                      │
│ Validation Sources (1)               │
│ ┌──────────────────────────────────┐ │
│ │ DOCUMENT UPLOAD        80%       │ │
│ │ DOCUMENT - pending               │ │
│ │ Validated 9/30/2025              │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Have additional proof?               │
│ Upload a title, receipt...           │
└──────────────────────────────────────┘
```

### PROPOSED (Clean, Factual, Visual)
```
┌─────────────────────────────────────────────┐
│  [Chevy Bowtie Logo]  MAKE                × │
├─────────────────────────────────────────────┤
│                                             │
│        C H E V R O L E T                    │
│        ────────────────                     │
│        80% confidence ⓘ                     │
│                                             │
├─────────────────────────────────────────────┤
│ Proof Sources (1)  Validators (0) *         │
├─────────────────────────────────────────────┤
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ [Blurred Title Image Preview]           │ │
│ │                                         │ │
│ │ ARIZONA TITLE • 9/30/2025              │ │
│ │ 80% • Click to view full document →    │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ + Add proof source                          │
│                                             │
└─────────────────────────────────────────────┘
```

## Key Improvements

### 1. Header
- **OLD**: "Validation: MAKE" 
- **NEW**: Chevrolet emblem (year-specific SVG) + field name
- Cleaner, brand-aware, professional

### 2. Value Display
- **OLD**: Box with "Current Value" label + value
- **NEW**: Large centered value with underline, confidence below
- More confident, less wordy

### 3. Source Display
- **OLD**: "DOCUMENT UPLOAD" (generic)
- **NEW**: "ARIZONA TITLE" (actual document type from metadata)
- Show document preview (blurred for sensitive data)
- Click to view full document

### 4. Interactive Elements
- **Confidence Score**: Click to see algorithm breakdown
  ```
  Popup: "How confidence is calculated"
  - Title document: +40%
  - VIN matches: +20%
  - Multiple validators: +20%
  Total: 80%
  ```

- **Validators Count**: Click * for explainer
  ```
  Popup: "What are validators?"
  Validators verify data by:
  - Uploading matching documents
  - Confirming with their own evidence
  - Cross-referencing public records
  
  Your data becomes verified when 2+ 
  validators confirm the same information.
  ```

### 5. Emblem Integration
Source year-specific GM emblems from:
- `/public/emblems/chevrolet/1977-bowtie.svg`
- `/public/emblems/gmc/1977-shield.svg`
- Fallback to generic if year not available

## Layout Specs

```css
.validation-popup {
  max-width: 480px;
  border-radius: 8px;
}

.validation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 2px solid var(--border);
}

.emblem {
  width: 32px;
  height: 32px;
}

.field-value {
  font-size: 24pt;
  font-weight: 700;
  letter-spacing: 2px;
  text-align: center;
  padding: 24px 0;
}

.confidence-badge {
  font-size: 9pt;
  color: var(--text-muted);
  cursor: pointer;
  text-decoration: underline dotted;
}

.proof-preview {
  position: relative;
  width: 100%;
  height: 200px;
  overflow: hidden;
  border-radius: 4px;
}

.blurred-doc {
  filter: blur(8px);
  opacity: 0.7;
}

.doc-metadata {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
  padding: 12px;
  color: white;
  font-size: 8pt;
}
```

## Implementation Files

1. `/nuke_frontend/src/components/vehicle/ValidationPopupV2.tsx` (new clean component)
2. `/nuke_frontend/src/components/vehicle/ConfidenceExplainer.tsx` (algorithm popup)
3. `/nuke_frontend/src/components/vehicle/ValidatorExplainer.tsx` (what are validators)
4. `/nuke_frontend/public/emblems/` (logo assets)

## Data Requirements

From `ownership_verifications` table:
- `document_type` → "title" | "registration" | "bill_of_sale"
- `document_url` → Image to display (blurred)
- `verification_status` → "pending" | "verified"
- `document_state` → "ARIZONA" for state-specific display
- `created_at` → Validation date

From `vehicle_images` table:
- `sensitive_type` → "title" | "registration" | "vin_plate"
- `image_url` → Preview image
- `exif_data` → Extract location/date

---

## Approval Needed

**Do you approve this design direction?**
- ✅ Emblem in header
- ✅ Large centered value
- ✅ Clickable confidence/validators
- ✅ Document preview (blurred)
- ✅ Actual source names (not generic labels)

**Concerns/Changes?**
- Different emblem placement?
- Different blur intensity?
- Different info density?

Let me know and I'll implement!

