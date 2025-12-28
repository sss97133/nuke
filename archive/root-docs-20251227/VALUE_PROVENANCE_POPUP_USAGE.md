# Value Provenance Popup - Usage Guide

## What It Does

**Simple transparency**: Click any value → See where it came from

## Features

### 1. **Instant Provenance**
```
Click: $25,000
  ↓
Popup shows:
┌─────────────────────────────────────┐
│ VALUE PROVENANCE         [CLOSE]    │
│ $25,000                             │
├─────────────────────────────────────┤
│ Source                              │
│ Manual Entry (No Proof)             │
│                                     │
│ Confidence                          │
│ 50% ⚠️                              │
│                                     │
│ Inserted By                         │
│ Skylar Williams                     │
│ Nov 2, 2024 1:04 AM                 │
│                                     │
│ Supporting Evidence                 │
│ 0 sources                           │
│                                     │
│ ⚠️ NO EVIDENCE FOUND                │
│ This value has no supporting        │
│ evidence. Upload receipts or        │
│ build estimates to verify.          │
│                                     │
│ [EDIT VALUE]                        │ ← Only you see this
└─────────────────────────────────────┘
```

### 2. **Permission-Based Editing**

**If you inserted it:**
- ✅ See [EDIT VALUE] button
- ✅ Can change value
- ✅ Creates new evidence record

**If someone else inserted:**
- ❌ No edit button
- ✅ Can see who/when
- ✅ Message: "Only [name] can edit this"

### 3. **Multiple Evidence Sources**

```
Click: $31,633 (after CSV import)
  ↓
Popup shows:
┌─────────────────────────────────────┐
│ VALUE PROVENANCE         [CLOSE]    │
│ $31,633                             │
├─────────────────────────────────────┤
│ Source                              │
│ Build Estimate CSV                  │
│                                     │
│ Confidence                          │
│ 75% (Estimate, not receipts)        │
│                                     │
│ Supporting Evidence                 │
│ 3 sources                           │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Build Estimate CSV              │ │
│ │ Value: $31,633 • Conf: 75%      │ │
│ │ "Sept 2024 revised estimate"    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ GPS Photo Cluster               │ │
│ │ Value: N/A • Conf: 95%          │ │
│ │ "417 photos at 707 Yucca"       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ AI Work Detection               │ │
│ │ Value: N/A • Conf: 85%          │ │
│ │ "Paint + Interior work detected"│ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## How to Integrate

### In VehicleHeader.tsx:

```typescript
import { ValueProvenancePopup } from '../components/ValueProvenancePopup';

// Add state
const [showProvenance, setShowProvenance] = useState(false);
const [provenanceField, setProvenanceField] = useState<string>('current_value');

// Make price clickable
<div 
  onClick={() => {
    setProvenanceField('current_value');
    setShowProvenance(true);
  }}
  style={{
    cursor: 'pointer',
    textDecoration: 'underline dotted'
  }}
>
  ${vehicle.current_value?.toLocaleString() || '25,000'}
</div>

// Show popup
{showProvenance && (
  <ValueProvenancePopup
    vehicleId={vehicleId}
    field={provenanceField}
    value={vehicle.current_value || 25000}
    onClose={() => setShowProvenance(false)}
    onUpdate={(newValue) => {
      // Refresh vehicle data
      loadVehicle();
    }}
  />
)}
```

---

## Access Levels

### Owner / Inserter (Full Access)
- ✅ See provenance
- ✅ Edit value
- ✅ Add evidence
- ✅ See all sources

### Contributor (Read + Add Evidence)
- ✅ See provenance
- ❌ Can't edit value
- ✅ Can add supporting evidence
- ✅ See all sources

### Public (Read Only)
- ✅ See provenance
- ❌ Can't edit
- ❌ Can't add evidence  
- ✅ See confidence level

---

## Your Specific Case

**Current:**
```
$25,000 displayed
No way to see where from
Can't tell who set it
Can't verify it's correct
```

**After:**
```
$25,000 (clickable)
  ↓
Popup shows:
  Source: Manual entry
  Confidence: 50%
  Inserted by: Skylar Williams
  Evidence: None
  [EDIT VALUE] ← Your button
```

**After uploading receipts:**
```
$53,915 (clickable)
  ↓
Popup shows:
  Source: Verified Receipts
  Confidence: 95%
  Supporting evidence:
    - Receipt #1: Paint ($21,848)
    - Receipt #2: Interior ($7,067)
    - Purchase price: $25,000
  Total: $53,915
```

---

## Benefits

### 1. **Instant Transparency** (2 seconds)
- No digging through database
- No wondering "where did this come from?"
- Click → see source

### 2. **Permission-Based Security**
- Only inserter can edit
- Others see read-only
- Full audit trail

### 3. **Evidence Building**
- Start with manual entry (50% confidence)
- Add CSV estimate (75% confidence)
- Add receipts (95% confidence)
- Confidence increases with evidence

### 4. **No New Complexity**
- Uses existing `field_evidence` table
- Uses existing permission system
- One simple popup component
- **Streamlines what exists** ✅

---

## Deploy This?

1. Add `ValueProvenancePopup.tsx`
2. Make prices clickable in VehicleHeader
3. Rebuild and deploy

**Result**: Click $25,000 → See "Manual entry by Skylar, no evidence, 50% confidence"

**This is the "finish timeline logic" you asked for** - connecting data to UI with instant transparency.

