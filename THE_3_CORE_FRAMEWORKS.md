# The 3 Core Frameworks (Already Built)

## FRAMEWORK 1: Universal Timeline System ✅

**Purpose**: Every action creates timeline events across ALL related entities

```
YOU UPLOAD 24 PHOTOS (Nov 1, 2024)
         ↓
┌────────────────────────────────────────┐
│ 1. EXIF EXTRACTION                     │
│    - Date taken: Nov 2, 2024           │
│    - GPS: 35.972831, -114.855897       │
│    - Camera: iPhone 14 Pro             │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ 2. CASCADE TO 3 TIMELINES              │
├────────────────────────────────────────┤
│ A) VEHICLE TIMELINE                    │
│    vehicle_timeline_events             │
│    → "24 photos uploaded Nov 2, 2024"  │
│                                        │
│ B) USER TIMELINE                       │
│    user_contributions                  │
│    → "Skylar documented K2500 work"    │
│                                        │
│ C) ORGANIZATION TIMELINE               │
│    business_timeline_events            │
│    → "Work at 707 Yucca (Taylor)"      │
└──────────────┬─────────────────────────┘
               │
               ▼
        ┌──────┴──────┐
        │             │
    VEHICLE       ORGANIZATION
    shows work    shows activity
```

**Status**: ✅ **EXISTS** but cascade incomplete (only vehicle timeline working)

---

## FRAMEWORK 2: Forensic Data System ✅

**Purpose**: Every value has PROOF, not guesses

```
YOU PROVIDE BUILD ESTIMATE CSV
         ↓
┌────────────────────────────────────────┐
│ 1. EVIDENCE COLLECTION                 │
│    field_evidence table                │
├────────────────────────────────────────┤
│ Paint cost: $21,848                    │
│   Source: build_estimate_csv           │
│   Trust level: 75 (estimate)           │
│   Context: "Taylor Customs paint work" │
│   Status: pending                      │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ 2. MULTI-SIGNAL VALIDATION             │
│    build_field_consensus()             │
├────────────────────────────────────────┤
│ Evidence for "paint_cost":             │
│   1. CSV estimate: $21,848 (75% trust) │
│   2. GPS photos: 707 Yucca (95% trust) │
│   3. AI work detection: Paint (85%)    │
│                                        │
│ Consensus: $21,848                     │
│ Confidence: 85% (multiple sources)     │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ 3. ASSIGNMENT WITH PROVENANCE          │
│    vehicle_field_provenance            │
├────────────────────────────────────────┤
│ Field: paint_investment                │
│ Value: $21,848                         │
│ Primary source: build_estimate_csv     │
│ Supporting: GPS + AI work detection    │
│ Confidence: 85%                        │
│                                        │
│ Click to see: CSV file, GPS cluster    │
└────────────────────────────────────────┘
```

**Status**: ✅ **EXISTS** (1,241 evidence records, 144 provenance records)

---

## FRAMEWORK 3: Unified Pricing ✅

**Purpose**: One price, multiple components, full transparency

```
VALUATION CALCULATION
         ↓
┌────────────────────────────────────────┐
│ 1. PURCHASE PRICE FLOOR                │
│    Never go below what you paid        │
│    $25,000 (your purchase)             │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ 2. DOCUMENTED INVESTMENTS              │
│    From RECEIPTS (not estimates)       │
├────────────────────────────────────────┤
│ CURRENT: $0 (no receipts yet)          │
│ ESTIMATE: $31,633 (from CSV)           │
│                                        │
│ When you upload receipts:              │
│   Paint receipt: $21,848 ✅            │
│   Interior receipt: $7,067 ✅          │
│   = $28,915 ACTUAL                     │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│ 3. FINAL VALUATION                     │
├────────────────────────────────────────┤
│ Now: $25,000 (purchase only)           │
│ After receipts: $53,915                │
│   ($25k purchase + $28.9k verified)    │
│                                        │
│ Confidence: 95% (receipts = proof)     │
└────────────────────────────────────────┘
```

**Status**: ✅ **EXISTS** but shows $25k (no receipts linked)

---

## HOW IT'S SUPPOSED TO WORK (Complete Flow)

### USER JOURNEY: Upload Build Estimate CSV

```
STEP 1: YOU DROP CSV
┌──────────────────────────────────────┐
│ "Upload Reference Document"          │
│ [Drop CSV file here]                 │
└──────────────┬───────────────────────┘
               │
               ▼
STEP 2: SYSTEM PARSES
┌──────────────────────────────────────┐
│ BuildImportService.parseCSV()        │
│ → 97 line items extracted            │
│ → $31,633 total budget               │
│ → Paint: $21,848 (Taylor)            │
│ → Interior: $7,067 (Ernies)          │
└──────────────┬───────────────────────┘
               │
               ▼
STEP 3: CREATES EVIDENCE
┌──────────────────────────────────────┐
│ field_evidence inserts:              │
│ - paint_investment: $21,848          │
│ - interior_investment: $7,067        │
│ - total_budget: $31,633              │
│ Source: build_estimate_csv (75%)     │
└──────────────┬───────────────────────┘
               │
               ▼
STEP 4: YOU SEE IMMEDIATELY
┌──────────────────────────────────────┐
│ ✅ "Processed 97 line items"         │
│ ✅ Build Investment: $31,633         │
│ ✅ Confidence: 75% (estimate)        │
│                                      │
│ [View Details] [Upload Receipts]     │
└──────────────┬───────────────────────┘
               │
               ▼
STEP 5: TIMELINE UPDATES
┌──────────────────────────────────────┐
│ Click Nov 1 calendar dot:            │
│                                      │
│ WORK ORDER #AD655A7F                 │
│ Nov 1, 2024                          │
│ Performed by: Taylor Customs         │
│                                      │
│ ESTIMATED COST: $21,848              │ ← FROM CSV!
│   (Paint work - 102.6 hrs)           │
│                                      │
│ Evidence:                            │
│ ✓ Build estimate line items 4-52    │
│ ✓ 24 GPS photos at 707 Yucca         │
│ ✓ Taylor Customs = paint specialist  │
│                                      │
│ Confidence: 85%                      │
└──────────────────────────────────────┘
```

---

## WHAT'S MISSING (The Gaps)

### ❌ Step 2-3: Connection is broken
```
CSV Import → vehicle_builds ✅
           ↓
           ❌ NOT creating field_evidence
           ❌ NOT linking to timeline events
```

### ❌ Step 4: No UI feedback
```
Upload completes → ... nothing visible
                  ↓
                  User sees: Still "$25,000"
                  Should see: "$31,633 (from estimate)"
```

### ❌ Step 5: Timeline not linked
```
Timeline event cost_amount = NULL
Should be: cost_amount = $21,848 (from matching CSV line items)
```

---

## THE SIMPLE FIX (Finish Timeline Logic)

**Connect the 3 frameworks:**

```sql
-- When CSV imported:
-- 1. Create evidence (Framework 2)
INSERT INTO field_evidence (
  vehicle_id,
  field_name,
  proposed_value,
  source_type,
  source_confidence
) VALUES
  ('vehicle-id', 'paint_investment', '21848', 'build_estimate_csv', 75),
  ('vehicle-id', 'interior_investment', '7067', 'build_estimate_csv', 75);

-- 2. Link to timeline events (Framework 1)
UPDATE vehicle_timeline_events
SET 
  cost_amount = 21848,
  labor_hours = 102.6,
  service_provider_name = 'Taylor Customs'
WHERE vehicle_id = 'vehicle-id'
  AND event_date::date = '2024-11-01'
  AND title ILIKE '%paint%';

-- 3. Update valuation (Framework 3)
UPDATE vehicles
SET current_value = 25000 + 31633  -- Purchase + estimated investment
WHERE id = 'vehicle-id';
```

**Result**: 
- Timeline shows: "$21,848 (Taylor - Paint)"
- Header shows: "$56,633 ESTIMATED VALUE"
- Click "Data Sources" → see CSV evidence
- **2 seconds to understand**, no extra clicks

---

## WHAT YOU WANT VS WHAT EXISTS

### YOU WANT:
```
Upload CSV → See value instantly → Click event → See breakdown → Trust it
     2sec       0 clicks           1 click        0 clicks      DONE
```

### WHAT EXISTS:
```
Upload CSV → See nothing → Confused → Check database → Find data buried
     ???      frustration    give up     backend only   not in UI
```

---

## THE FRAMEWORKS ARE SOLID ✅

**You have:**
1. ✅ Forensic evidence system (1,241 records working)
2. ✅ Universal timeline (417 GPS photos working)  
3. ✅ Unified pricing (valuation logic working)

**What's missing:**
- ❌ **Connections between frameworks**
- ❌ **UI to surface the data**
- ❌ **Instant feedback loops**

---

## FINISH TIMELINE LOGIC = Connect the 3

**One function to connect everything:**

```typescript
async function linkBuildEstimateToTimeline(
  buildId: string,
  vehicleId: string
) {
  // 1. Get build line items
  const items = await getBuildLineItems(buildId);
  
  // 2. Group by category + date
  const paintItems = items.filter(i => i.category === 'Paint');
  const interiorItems = items.filter(i => i.category === 'Interior');
  
  // 3. Link to timeline events by work type + date
  await updateTimelineEvent({
    where: { vehicle_id, work_type: 'paint' },
    set: {
      cost_amount: sumCosts(paintItems),
      labor_hours: sumHours(paintItems),
      service_provider_name: 'Taylor Customs',
      evidence_source: 'build_estimate_csv'
    }
  });
  
  // 4. Create field_evidence
  await createEvidence({
    field: 'paint_investment',
    value: sumCosts(paintItems),
    source: 'build_estimate_csv',
    confidence: 75
  });
  
  // 5. Update vehicle valuation
  await recalculateValuation(vehicleId);
}
```

**This connects all 3 frameworks in ONE function.**

---

**Want me to build this ONE connecting function instead of new components?**

