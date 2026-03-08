# AI Restoration Cost Estimator System

**Date:** November 5, 2025  
**Purpose:** Parts + Labor = Value calculation with user opinions

---

## System Overview

### The Formula
```
Parts Cost + Labor Cost = Total Restoration Cost
Current Value + Restoration Cost = Restored Value
Restored Value - (Current Value + Restoration Cost) = Profit
```

### Why This Matters

You said:
> "at the end of the day thats even how a garage makes profit.. Parts + labor = +++value+++ so thats why its so important we credit our laborers"

**Exactly!** This system:
1. **Calculates restoration costs** (parts + labor)
2. **Projects final value** after restoration
3. **Shows profit potential** (ROI)
4. **Credits laborers** (tracks shop labor rates)
5. **Lets users add opinions** (crowd-sourced accuracy)

---

## How It Works

### Step 1: AI Analyzes Images

```typescript
// User drops Craigslist URL → Images extracted
imageUrls = ['img1.jpg', 'img2.jpg', ...];

// GPT-4 Vision analyzes each image
for each image:
  AI detects:
    - Paint condition (faded, chipped, oxidized)
    - Rust (surface, deep, structural)
    - Dents & damage
    - Interior wear (seats, dash, carpet)
    - Chrome condition
    - Glass condition
    - Visible mechanical issues
```

**AI Output:**
```json
{
  "paint_issues": ["faded paint", "clear coat peeling", "rock chips"],
  "bodywork_issues": ["surface rust on tailgate", "small dent passenger door"],
  "interior_issues": ["worn driver seat", "cracked dash pad"],
  "chrome_issues": ["pitted bumpers"],
  "confidence": 85
}
```

### Step 2: Calculate Parts + Labor by Category

```typescript
// PAINT & BODYWORK
if (detected: faded paint, surface rust) {
  parts: $1,500 - $4,000 (paint, primer, sandpaper, body filler)
  labor: 40-80 hours @ $125/hr = $5,000 - $10,000
  total: $6,500 - $14,000
  confidence: 85% (AI saw the issues in photos)
}

// INTERIOR
if (detected: worn seats, cracked dash) {
  parts: $800 - $2,500 (seat covers, dash pad, carpet kit)
  labor: 10-30 hours @ $125/hr = $1,250 - $3,750
  total: $2,050 - $6,250
  confidence: 80%
}

// MECHANICAL (conservative estimate)
parts: $1,000 - $5,000 (fluids, brakes, suspension bushings)
labor: 20-60 hours @ $125/hr = $2,500 - $7,500
total: $3,500 - $12,500
confidence: 40% (can't see mechanical in photos)

// CHROME & TRIM
if (detected: pitted bumpers) {
  parts: $500 - $2,500 (rechrome or replacements)
  labor: 5-15 hours @ $125/hr = $625 - $1,875
  total: $1,125 - $4,375
  confidence: 70%
}
```

### Step 3: Project Final Value

```typescript
// Current vehicle value (market research)
currentValue = $15,000 (1972 GMC C10 in rough condition)

// Total restoration cost
restorationCost = $13,175 - $37,125 (range)

// Restored value (market data for restored examples)
restoredValue = $35,000 - $50,000

// Profit calculation
profit = restoredValue - (currentValue + restorationCost)
profit = $35,000 - ($15,000 + $37,125) = -$17,125 (worst case)
profit = $50,000 - ($15,000 + $13,175) = +$21,825 (best case)

// ROI
roi = (profit / restorationCost) * 100
roi = -46% to +166%
```

### Step 4: User Adds Opinion

```typescript
// User reviews AI estimate
userOpinion = `
  AI is close but missed a few things:
  - Engine needs rebuild ($4,000 parts + 60 hrs labor)
  - Transmission is fine, no work needed
  - Paint estimate is high, I can do $2,500 total
  
  My adjusted total: $25,000
`;

// User adjusts total
aiEstimate = $13,175 - $37,125
userAdjusted = $25,000

// Save opinion
entity_opinions.insert({
  entity_type: 'vehicle',
  entity_id: vehicleId,
  user_id: userId,
  opinion_text: userOpinion,
  data_contributed: {
    restoration_estimate: 25000,
    estimated_at: now()
  }
});

// Award points for opinion
award_points(userId, 'opinion', 20);
```

---

## Component UI (Robinhood × Cursor Style)

```
┌─────────────────────────────────────┐
│ Restoration Cost Calculator         │
├─────────────────────────────────────┤
│                                     │
│   Target Quality:                   │
│   [Driver] [Show Quality] [Concours]│
│                                     │
│   [Generate AI Estimate]            │
│                                     │
└─────────────────────────────────────┘

After analysis:

┌─────────────────────────────────────┐
│ ESTIMATED TOTAL COST                │
│                                     │
│    $13,175 - $37,125                │ ← Large monospace
│    Average: $25,150                 │
├─────────────────────────────────────┤
│  PARTS          │      LABOR        │
│ $5,300-$14,000  │  $7,875-$23,125  │
│                 │ 63-185 hrs @ $125 │
├─────────────────────────────────────┤
│ Cost Breakdown                      │
│                                     │
│ Paint & Bodywork    $6,500-$14,000 │
│ Parts: $1,500-$4,000                │
│ Labor: 40-80 hrs                    │
│ AI Detected: faded paint, surface   │
│ rust, rock chips                    │
│ Confidence: 85%                     │
│                                     │
│ Interior           $2,050-$6,250    │
│ Parts: $800-$2,500                  │
│ Labor: 10-30 hrs                    │
│ AI Detected: worn seats, cracked    │
│ dash                                │
│ Confidence: 80%                     │
│                                     │
│ [... more categories ...]           │
├─────────────────────────────────────┤
│ Value Projection After Restoration  │
│                                     │
│ Current Value      $15,000          │
│ Restored Value     $35,000-$50,000  │
│ Projected Profit   -$17K to +$22K   │
│ ROI: -46% to +166%                  │
├─────────────────────────────────────┤
│ Your Opinion                        │
│ ┌─────────────────────────────────┐│
│ │AI is close but...               ││
│ │                                 ││
│ └─────────────────────────────────┘│
│                                     │
│ Your Adjusted Estimate (Optional)   │
│ ┌─────────────────────────────────┐│
│ │$25,000                          ││
│ └─────────────────────────────────┘│
│                                     │
│ [Save My Opinion]                   │
└─────────────────────────────────────┘
```

---

## Database Schema

### Existing Tables Used:
1. **`entity_opinions`** - User opinions on estimates
2. **`user_contribution_points`** - Points for opinions
3. **`organizations`** - Labor rates from shops

### New Data (Stored in Opinions):
```json
{
  "restoration_estimate": 25000,
  "estimated_at": "2025-11-05T14:00:00Z",
  "ai_baseline": {
    "total_low": 13175,
    "total_high": 37125,
    "confidence": 72
  },
  "user_adjustments": {
    "engine_rebuild": 4000,
    "paint_lower": -2000
  }
}
```

---

## How Shops Make Profit (Your Point)

### Traditional Shop Model:
```
Customer brings vehicle
→ Shop estimates: $10,000 parts + $15,000 labor
→ Customer pays: $25,000
→ Shop profit: $15,000 (labor revenue) - shop costs
```

### Why Labor Tracking Matters:
```sql
-- Credit the laborer
INSERT INTO timeline_events (
  vehicle_id,
  event_type,
  title,
  labor_hours,
  labor_cost,
  performed_by_org_id -- ← Credits the shop!
) VALUES (
  '...',
  'engine_rebuild',
  'Engine Rebuild',
  60, -- hours
  7500, -- $125/hr × 60hrs
  'shop_abc_id' -- ← Shop gets credit + visibility
);

-- Shop's profile shows:
-- "Completed 47 engine rebuilds, avg 58 hours, $125/hr"
-- → Builds reputation + searchability
```

### Profit Formula in System:
```typescript
// For shop:
revenue = laborHours × laborRate
cost = overhead + wages
profit = revenue - cost

// For buyer:
investment = purchasePrice + restorationCost
exit = restoredValue (sale or keep)
profit = exit - investment
```

---

## Widdle Down Costs (Iterative Refinement)

### Iteration 1: AI Spit Ball (Conservative)
```
Total: $13,175 - $37,125
Confidence: 60%
Basis: Image analysis + baseline averages
```

### Iteration 2: User Opinion #1
```
Total: $25,000
Confidence: 70%
User says: "Paint will be $2,500, I can do labor myself"
```

### Iteration 3: Shop Quote
```
Total: $22,000
Confidence: 90%
Shop inspected vehicle, provided detailed quote
```

### Iteration 4: Actual Costs (Post-Restoration)
```
Total: $23,450
Confidence: 100%
Real receipts tracked in timeline_events
```

**Result:** Each iteration increases accuracy, final number is ground truth!

---

## Files Created

### Backend:
1. **`estimate-restoration-cost/index.ts`** - Edge Function
   - Analyzes images with GPT-4 Vision
   - Calculates parts + labor by category
   - Projects value + profit
   - Returns confidence scores

### Frontend:
2. **`RestorationCostCalculator.tsx`** - React component
   - Robinhood-style cost display
   - User opinion input
   - Adjusted estimate field
   - Save to `entity_opinions`

---

## Integration Points

### 1. Add to Vehicle Profile
```tsx
// In VehicleProfile.tsx
import RestorationCostCalculator from '../components/vehicle/RestorationCostCalculator';

// After trading panel
{vehicle.images.length > 0 && (
  <RestorationCostCalculator
    vehicleId={vehicle.id}
    year={vehicle.year}
    make={vehicle.make}
    model={vehicle.model}
    imageUrls={vehicle.images.map(img => img.url)}
  />
)}
```

### 2. Add to URL Drop Flow
```typescript
// After scraping Craigslist URL
1. Extract images
2. Run restoration estimator
3. Show estimate before user submits
4. User reviews, adds opinion, submits vehicle
```

---

## Bonus: Clear Draft Button Fixed ✅

**Problem:** Button didn't reset the form, only cleared localStorage  
**Fix:** Now resets form data AND clears localStorage

```typescript
// BEFORE
const clearAutosave = () => {
  localStorage.removeItem(AUTOSAVE_KEY);
  setAutoSaveState({ hasUnsavedChanges: false });
  // Form data still there!
};

// AFTER
const clearAutosave = () => {
  localStorage.removeItem(AUTOSAVE_KEY);
  setFormData(DEFAULT_FORM_DATA); // ← Reset form!
  setVerificationProgress(calculateVerificationProgress(DEFAULT_FORM_DATA));
  setAutoSaveState({ lastSaved: '', hasUnsavedChanges: false });
  setError(null);
};
```

---

## Next Steps

### Immediate:
1. ✅ Deploy `estimate-restoration-cost` Edge Function
2. ✅ Create `RestorationCostCalculator` component
3. ✅ Fix "Clear Draft" button
4. 🔄 Deploy frontend

### Short-term:
1. Integrate calculator into vehicle profile
2. Add to URL drop workflow
3. Build opinion leaderboard (who gives best estimates?)
4. Track estimate accuracy over time

### Long-term:
1. Machine learning on actual vs estimated costs
2. Shop-specific labor rate database
3. Regional cost variations
4. Parts supplier price lookup API

---

## Summary

✅ **AI analyzes images** - Detects paint, rust, interior issues  
✅ **Calculates Parts + Labor** - By category with ranges  
✅ **Projects profit** - ROI calculation  
✅ **User adds opinion** - Crowd-sourced accuracy  
✅ **Credits shops** - Labor rates from organizations  
✅ **Tracks opinions** - Saved to `entity_opinions`  
✅ **Clear Draft fixed** - Button now actually works  

**This turns restoration from guesswork into data!** 📊

