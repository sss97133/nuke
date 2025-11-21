# Secretary Mode - Rapid Data Curation UI

## The Problem (You Nailed It)

**Current UI:**
- Pretty cards that do nothing
- Click → go to profile → maybe add image
- No quick actions
- No AI validation workflow
- No rapid sign-off
- User feels like data entry clerk, not curator

**You have:**
- 92 owned vehicles
- 2,729 images uploaded
- But profile shows: 0 owned, 90 contributing (WRONG)
- And no way to quickly validate/correct AI data

## The Vision: "Boss with Papers"

**User = Executive Curator**
- AI does the heavy lifting (data extraction, tagging, valuations)
- User's job: **Validate, approve, correct** in seconds
- Interface like a secretary handing you papers to sign
- Quick thumbs up/down, inline corrections, rapid notes
- Track contribution merit through curation accuracy

**Not data entry. Data validation.**

---

## What We'll Build

### 1. Context-Aware Notification Bubbles ✅ (Quick)

**On every page, show relevant notifications:**

```
/vehicle/{id}     → Badge: "3 items need review on THIS vehicle"
/org/{id}         → Badge: "2 org updates pending"  
/profile          → Badge: "12 vehicles need your input"
/dashboard        → Badge: "Total: 47 items across all"
```

**Implementation:**
- Component: `<ContextNotificationBubble context="vehicle" contextId={vehicleId} />`
- Queries `notifications` filtered by context
- Click → opens inline review panel (doesn't navigate away)

---

### 2. Vehicle Card → Rapid Input Interface 🎯 (Critical)

**Transform cards from "pretty pictures" to "action stations":**

**Current Card:**
```
┌─────────────────┐
│  [Image]        │
│  1972 K10       │
│  $15,000        │
└─────────────────┘
Click → go to profile
```

**Secretary Mode Card:**
```
┌─────────────────────────────────────────────┐
│ [Image]  1972 Chevrolet K10  $15,000       │
│                                              │
│ AI Found: "Edelbrock 4-barrel carb"    ✓ ✗ │
│ ├─ Cost: $450 (from receipt OCR)       ✓ ✗ │
│ └─ Installed: Aug 2023                 ✓ ✗ │
│                                              │
│ VIN: CKE142B143858                     ✓ ✗ │
│ Mileage: 87,234 (from image)           ✓ ✗ │
│                                              │
│ [Quick Note] [Mark Complete] [Full Profile] │
└─────────────────────────────────────────────┘
```

**Actions:**
- ✓ = Approve data point (logged as validation)
- ✗ = Reject/correct (opens inline editor)
- Quick Note = Add context without navigating
- Mark Complete = "I've reviewed this vehicle"
- Full Profile = Traditional detail view

---

### 3. AI Validation Workflow 🤖

**For every AI-extracted data point:**

```
┌────────────────────────────────────┐
│ AI Detected: "Holley 750 CFM"      │
│ Confidence: 73%                    │
│ Source: Image #47 (engine bay)     │
│                                     │
│ [👍 Correct] [👎 Wrong] [✏️ Fix]  │
└────────────────────────────────────┘
```

**On approval:**
- Confidence → 95%
- Your accuracy score +1
- AI learns from correction
- Data marked as "human-verified"

**On rejection:**
- Opens inline editor
- You correct the value
- AI learns from mistake
- Your tier increases (novice → expert)

---

### 4. Inline Editing Everywhere 📝

**Every piece of data should be editable in-place:**

```
Year: [1972] ✓     ← Click to edit, checkmark to save
Make: [Chevrolet_] ← Inline input, auto-complete
Model: [K10____] ✓ ← Tab to next field
VIN: [CKE142B143858________________] ✓
```

**Keyboard shortcuts:**
- Tab: Next field
- Enter: Save
- Esc: Cancel
- ↑↓: Navigate cards
- Space: Approve current item

---

### 5. Bulk Actions 🚀

**On /vehicles page:**

```
┌─────────────────────────────────────────────┐
│ [✓ Select All] Showing 92 vehicles          │
│                                              │
│ [✓] 1972 K10 - 2 AI detections pending      │
│ [✓] 1974 Bronco - VIN needs confirmation    │
│ [ ] 1985 Suburban - Reviewed ✅             │
│ [✓] 1988 Blazer - 5 price updates           │
│                                              │
│ Selected: 3 vehicles                         │
│ [Approve All AI Data] [Mark Reviewed]       │
│ [Export CSV] [Bulk Edit]                    │
└─────────────────────────────────────────────┘
```

---

### 6. Contribution Merit System 🏆

**Track what earns merit:**

**NOT counted:**
- Just uploading images (anyone can dump photos)
- Creating vehicles (bulk import)
- Clicking around

**DOES count:**
- ✅ Validating AI data (accuracy scored)
- ✅ Correcting errors (weighted by difficulty)
- ✅ Adding missing data (fills blanks)
- ✅ Linking receipts to parts (evidence)
- ✅ Verifying ownership (document upload)

**Your profile should show:**
```
┌──────────────────────────────────────┐
│ Curator Tier: EXPERT (87% accuracy) │
│                                       │
│ This Week:                            │
│  • 147 data points validated         │
│  • 23 AI corrections made            │
│  • 8 missing fields filled           │
│  • 12 receipts linked                │
│                                       │
│ Accuracy: 87% (456/523 correct)      │
│ Tier Progress: 94/100 → Professional │
└──────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Fix Counts & Notifications (30 min)
1. ✅ Fix profile vehicle counts (query correct tables)
2. ✅ Add context notification bubbles to all pages
3. ✅ Create notification query service

### Phase 2: Vehicle Card Quick Actions (1 hour)
1. Add inline validation UI to cards
2. Thumbs up/down for AI data
3. Quick edit pencil icons
4. Batch select checkboxes
5. Bulk action toolbar

### Phase 3: Inline Editing (1 hour)
1. Make all fields click-to-edit
2. Auto-save on blur
3. Keyboard shortcuts
4. Undo/redo
5. Validation feedback

### Phase 4: Secretary Dashboard (1 hour)
1. "Items Needing Review" queue
2. Rapid review interface
3. Swipe/hotkey navigation
4. Progress tracking
5. Daily quota/goals

---

## Starting NOW

Let me build Phase 1 right now - fix the counts and add notification bubbles.

Then we'll transform those useless cards into power tools.

Ready?

