# Granular Data Validation: The Race to Fill the Blanks

## The Core Concept

**Data is granular. Transparency is granular. Trust is granular.**

Every field (VIN, engine, color, mileage, etc.) is a **blank to be filled**.  
Multiple sources **race** to fill each blank.  
The first source fills **1st place**.  
Additional sources become **2nd, 3rd, 4th** validators.

---

## NOT This (What I Built Wrong):

```
┌─────────────────────────────────┐
│ External Listings               │  ← WRONG: Separate section
├─────────────────────────────────┤
│ Bring a Trailer: $40,000        │  ← WRONG: Repetitive display
│ 3 bids, 653 watchers            │  ← WRONG: Not granular
└─────────────────────────────────┘
```

## YES This (What You Want):

```
Vehicle Details:
┌────────────────────────────────────────┐
│ VIN: C1446S140169 [click to see sources] │ ← Click opens popup
└────────────────────────────────────────┘

[User clicks on VIN]

Popup appears:
┌─────────────────────────────────────────┐
│ VIN: C1446S140169                        │
├─────────────────────────────────────────┤
│ 🥇 1st: BaT Listing (100% confidence)   │  ← Winner
│    Source: https://bringatrailer.com/...│
│    Validated: May 3, 2024               │
│                                         │
│ 🥈 2nd: Deal Jacket (95% confidence)    │  ← 2nd place
│    Source: PDF scan                     │
│    Validated: Nov 2, 2025               │
│                                         │
│ 🥉 3rd: User Input (80% confidence)     │  ← 3rd place
│    Source: Manual entry                 │
│    Validated: Oct 30, 2025              │
└─────────────────────────────────────────┘

**Consensus**: All 3 sources AGREE ✓
```

---

## Example: CONFLICTING Data (The Interesting Case)

```
Engine Field:
┌────────────────────────────────────────┐
│ Engine: 327ci V8 [⚠️ CONFLICT]          │
└────────────────────────────────────────┘

[User clicks]

Popup:
┌─────────────────────────────────────────┐
│ Engine: CONFLICT DETECTED               │
├─────────────────────────────────────────┤
│ 🥇 1st: 327ci V8                         │
│    BaT Listing (95% confidence)         │
│    Deal Jacket (90% confidence)         │
│    → 2 sources AGREE                    │
│                                         │
│ ⚠️  2nd: LS3 V8                          │
│    User Input (70% confidence)          │
│    Uploaded: Oct 15, 2025               │
│    → WHY THE DIFFERENCE?                │
│                                         │
│ [Request Proof] [Flag for Review]       │
└─────────────────────────────────────────┘

System asks: "WHY is there an LS3 claim when BaT and deal jacket say 327ci?"

Expected answer: "Engine was swapped during restoration"

System demands: "PROOF?"

User uploads: Image bundle showing LS3 swap process (10 photos documenting the swap)

→ New validation created:
  - engine_original: 327ci V8 (BaT, deal jacket)
  - engine_current: LS3 V8 (10 photos, receipt, dyno sheet)

→ Cause and effect documented
→ Timeline event created: "Engine swapped from 327ci to LS3"
```

---

## How BaT URL Should Work

### Step 1: Parse URL, Extract EVERY Data Point
```typescript
batUrl = "https://bringatrailer.com/listing/1966-chevrolet-c10-pickup-105/"

Extracted:
  year: 1966
  make: Chevrolet
  model: C10
  trim: Custom Pickup
  vin: [search for it in description]
  engine: 327ci V8
  transmission: 3-speed manual
  color: Saddle Metallic and White
  mileage: 4,900 (FLAGGED: "unknown" per BaT notes)
  sale_price: null (reserve not met)
  high_bid: $40,000
  features: [Power steering, A/C, Oak bed, Rally wheels, ...]
  images: [50 URLs from BaT gallery]
```

### Step 2: Create Validation Entry for EACH Field
```sql
INSERT INTO data_validations:
  - (field_name: 'year', field_value: '1966', source: 'bat_listing', confidence: 100%)
  - (field_name: 'make', field_value: 'Chevrolet', source: 'bat_listing', confidence: 100%)
  - (field_name: 'model', field_value: 'C10', source: 'bat_listing', confidence: 100%)
  - (field_name: 'engine', field_value: '327ci V8', source: 'bat_listing', confidence: 95%)
  - (field_name: 'color', field_value: 'Saddle Metallic and White', source: 'bat_listing', confidence: 90%)
  - (field_name: 'mileage', field_value: '4900', source: 'bat_listing', confidence: 50%, notes: 'BaT says total mileage unknown')
  - ... etc for EVERY field
```

### Step 3: Download BaT Images, Save to DB
```sql
-- For each image from BaT gallery:
INSERT INTO vehicle_images:
  - vehicle_id: '655f224f-d8ae-4fc6-a3ec-4ab8db234fdf'
  - image_url: [our Supabase storage URL after download]
  - user_id: NULL  ← Photographer unknown
  - source: 'bat_listing'
  - category: 'exterior' or 'interior' (guess from content)
  - metadata: {
      original_bat_url: 'https://bringatrailer.com/...',
      bat_lot_number: '105',
      photographer_unknown: true,
      claimable: true,  ← Photographer can claim later
      attribution: 'BaT listing - photographer pending'
    }
```

### Step 4: User Clicks on "Engine" Field
```typescript
// DataValidationPopup component (already built!) shows:

Field: engine
Current Value: 327ci V8

Validations:
🥇 1st Place: BaT Listing (95% confidence)
   Source: https://bringatrailer.com/listing/...
   Extracted: "327ci V8"
   Validated: May 3, 2024

🥈 2nd Place: (empty - awaiting validation)
🥉 3rd Place: (empty - awaiting validation)

[+ Add Validation] button
```

---

## Example: Multiple Sources (The Good Case)

```
VIN Field after multiple imports:

🥇 1st: BaT Listing (100%)
   Value: C1446S140169
   Source: BaT #105
   
🥈 2nd: Deal Jacket (95%)
   Value: C1446S140169
   Source: PDF scan
   
🥉 3rd: User Input (80%)
   Value: C1446S140169
   Source: Manual entry
   
Consensus: ✓ ALL AGREE
Trust Score: 100% (3/3 sources match)
```

---

## Example: Conflicting Data (The Interesting Case)

```
Mileage Field:

🥇 1st: BaT Listing (50% - LOW)
   Value: 4,900 miles
   Notes: "BaT warns: total mileage unknown"
   Flagged: LOW CONFIDENCE
   
🥈 2nd: Title Document (85%)
   Value: 124,900 miles
   Source: Scanned title
   
❓ WHY THE DIFFERENCE?

Investigation:
- Odometer shows 4,900
- But it rolled over (5 digits, not 6)
- Title shows TRUE mileage: 124,900

Resolution:
- displayed_mileage: 4,900 (what odometer shows)
- actual_mileage: 124,900 (true mileage)
- Create timeline event: "Odometer rollover detected"
- Update BaT validation confidence to 50% (correct but misleading)
```

---

## The Racing System

### Each Field Is a Race:

**Starting Line**: Field is empty  
**1st Place Finisher**: First validation source (highest confidence)  
**2nd/3rd/4th Place**: Additional validators (reinforcement or conflict)  
**Consensus**: When all sources agree → high trust  
**Conflict**: When sources disagree → INVESTIGATE

### Scoring:

- **1 source**: 50% trust (needs validation)
- **2 sources agree**: 80% trust (good)
- **3+ sources agree**: 100% trust (excellent)
- **Sources conflict**: 0% trust (needs resolution)

---

## Implementation (Correct Way)

### Parse BaT URL:
```typescript
function parseBaTListing(url: string) {
  return {
    granularData: {
      year: { value: 1966, confidence: 100 },
      make: { value: 'Chevrolet', confidence: 100 },
      model: { value: 'C10', confidence: 100 },
      trim: { value: 'Custom', confidence: 95 },
      vin: { value: null, confidence: 0 },  // Not found
      engine: { value: '327ci V8', confidence: 95 },
      transmission: { value: '3-speed manual', confidence: 95 },
      color: { value: 'Saddle Metallic/White', confidence: 90 },
      mileage: { value: 4900, confidence: 50, warning: 'total mileage unknown' }
    },
    images: [/* 50 URLs */]
  };
}
```

### For EACH Field:
```sql
-- Create individual validation
INSERT INTO data_validations (field_name, field_value, confidence_score, notes)

-- NOT a single "BaT data" blob
-- YES individual validations for year, make, model, engine, etc.
```

### When Displayed:
```typescript
// Click on "Engine" field
<DataValidationPopup 
  fieldName="engine"
  fieldValue="327ci V8"
  validations={[
    { source: 'bat_listing', value: '327ci V8', confidence: 95% },
    { source: 'deal_jacket', value: '327ci V8', confidence: 90% },
    // If someone claims LS3 swap:
    { source: 'user_input', value: 'LS3 V8', confidence: 70%, proof_images: 10 }
  ]}
/>

System detects conflict → asks WHY → demands PROOF → user uploads image bundle
→ Timeline event created documenting the swap
→ Both validations kept (original: 327ci, current: LS3)
```

---

## Images from BaT

### Download All Images:
```typescript
// Scrape BaT gallery (50 images)
for (const batImageUrl of batGallery) {
  // Download image
  const blob = await fetch(batImageUrl).then(r => r.arrayBuffer());
  
  // Upload to OUR storage
  const ourUrl = await uploadToSupabase(blob);
  
  // Save with attribution
  await createVehicleImage({
    vehicle_id: vehicleId,
    image_url: ourUrl,
    user_id: null,  // Photographer unknown
    source: 'bat_listing',
    metadata: {
      original_bat_url: batImageUrl,
      photographer_unknown: true,
      claimable: true,
      attribution_note: 'Image from BaT listing - photographer can claim with proof'
    }
  });
}
```

### Photographer Can Claim Later:
```typescript
// User views image from BaT gallery
// Recognizes it as their photo
// Clicks "This is my photo"
// Uploads EXIF data or original file as proof
// System validates (matches resolution, date, etc.)
// Updates user_id to photographer
// Photographer now gets credit retroactively
```

---

## Summary

**What I built:** External Listings card (redundant, not granular)  
**What you want:** Granular validations filling each field position

**BaT URL parsing should:**
1. Extract EVERY data point
2. Create validation for EACH field
3. Download ALL images
4. Attribute to "unknown photographer" (claimable)
5. Let the DataValidationPopup (already built!) show the race

**The popup already exists** - I just need to feed it granular data from BaT, not show BaT as a separate section.

Let me fix this now.

