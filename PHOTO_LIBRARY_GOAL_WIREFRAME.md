# Photo Library - Goal & Wireframe

**What you're trying to do:** Organize 30,000 mixed photos into vehicle profiles as fast as possible.

---

## 🎯 THE ACTUAL GOAL

### Current Problem:
You have 30,000 photos on your phone/computer:
- Family photos
- Car photos (multiple vehicles)
- Random stuff
- All mixed together chronologically

### What You Need To Do:
1. **Separate car photos** from family photos
2. **Group by vehicle** (Bronco photos, C10 photos, etc.)
3. **Link to vehicle profiles** in database
4. **Never see organized photos again** while triaging

### End State:
- All car photos → organized into vehicle profiles
- All other photos → ignored/deleted
- Inbox Zero reached
- Can stop using iCloud Photos for car work

---

## 🖼️ WIREFRAME: The Actual Interface

### Full-Screen Layout (NO wasted space)

```
┌────────────────────────────────────────────────────────────────────┐
│ n-zero  [Home] [Vehicles] [Auctions] [Organizations]    [@skylar] │ Main Nav
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ PHOTO LIBRARY                                                       │
├─────────────────────┬──────────────────────────────────────────────┤
│                     │                                              │
│ SIDEBAR (220px)     │        PHOTOS (fills remaining space)       │
│                     │                                              │
│ ☑ Hide Organized    │  ▓▓ ▓▓ ▓▓ ▓▓ ▓▓                          │
│                     │  ▓▓ ▓▓ ▓▓ ▓▓ ▓▓                          │
│ FILTER BY:          │  ▓▓ ▓▓ ▓▓ ▓▓ ▓▓                          │
│                     │  ▓▓ ▓▓ ▓▓ ▓▓ ▓▓                          │
│ AI Complete: 800    │  ▓▓ ▓▓ ▓▓ ▓▓ ▓▓                          │
│ AI Pending:  2047   │                                              │
│                     │  Photos, photos, photos                      │
│ Vehicle Found: 900  │  Nothing else                                │
│ No Vehicle:   1947  │  Just photos                                 │
│                     │                                              │
│ Angle:              │  (Zero gap, edge-to-edge)                    │
│ Front:       245    │                                              │
│ Rear:        198    │                                              │
│ Side:        312    │                                              │
│ Interior:    89     │                                              │
│                     │                                              │
│ VEHICLES:           │                                              │
│ > 1969 Bronco       │                                              │
│ > 1972 C10          │                                              │
│ > Unlinked          │                                              │
│                     │                                              │
└─────────────────────┴──────────────────────────────────────────────┘
│ 2,847 photos  │ [Link to...▼] [Organize] [Delete] │ [Grid: ░███] │ Bottom Bar
└────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 THE WORKFLOW (Step by Step)

### Scenario: You upload 1,000 photos

```
STEP 1: Upload
─────────────────────────────────────────────
Drag 1,000 photos → they upload in background
Counter shows: "1,000 photos"

STEP 2: Filter (while AI processes)
─────────────────────────────────────────────
Sidebar:
☑ Hide Organized (default ON)
Click: "Front: 245"

Grid shows: Only 245 front-angle photos
(Other 755 hidden by filter)

STEP 3: Select All Front Photos
─────────────────────────────────────────────
Cmd+A → All 245 selected
Bottom bar: "245 selected"

STEP 4: Bulk Link
─────────────────────────────────────────────
Click: [Link to...▼]
Select: "1969 Ford Bronco"
Click confirm

STEP 5: Photos Disappear
─────────────────────────────────────────────
Those 245 photos now have vehicle_id = Bronco
"Hide Organized" filter hides them
Grid now shows: 755 remaining photos

Counter: "1,000 → 755 photos"

STEP 6: Repeat
─────────────────────────────────────────────
Click: "Rear: 198"
Cmd+A
Link to vehicle
Photos disappear

Counter: "755 → 557 photos"

Keep going until: "0 photos"
= INBOX ZERO ✓
```

---

## 📊 WHAT THE SIDEBAR ACTUALLY DOES

It's not just filters - it's a **smart dashboard showing what you have**:

```
┌──────────────────────┐
│ LIBRARY              │
├──────────────────────┤
│ ☑ Hide Organized     │ ← Toggle to see progress
├──────────────────────┤
│ AI STATUS            │
│ ────────────────────│
│ Complete:    800 →  │ Click number to filter
│ Pending:   2,047 →  │ Click again to clear
│ Processing:   0     │
│ Failed:       0     │
├──────────────────────┤
│ VEHICLE DETECTED     │
│ ────────────────────│
│ Found:       900 →  │
│ Not Found: 1,947 →  │
│ Uncertain:   0      │
├──────────────────────┤
│ ANGLE                │
│ ────────────────────│
│ Front:       245 →  │ Click to show only fronts
│ Rear:        198 →  │
│ Side:        312 →  │
│ Interior:     89 →  │
│ Engine Bay:  134 →  │
│ Detail:      422 →  │
├──────────────────────┤
│ AI SUGGESTIONS       │
│ ────────────────────│
│ 1969 Ford Bronco     │
│ 247 photos      [✓] │ Click ✓ to accept
│                      │
│ 1972 Chevy C10       │
│ 156 photos      [✓] │
│                      │
│ Unknown Vehicle      │
│ 12 photos       [✗] │ Click ✗ to reject
└──────────────────────┘
```

**Numbers are clickable** = instant filter

---

## 🎯 THE REAL WORKFLOW YOU WANT

### Option A: AI-Assisted (Fastest)
```
1. Upload 1,000 photos
2. Wait 5 mins for AI
3. Sidebar shows: "AI Suggestions"
   - 1969 Bronco (247 photos) [✓]
   - 1972 C10 (156 photos) [✓]
4. Click [✓] on each suggestion
5. 403 photos organized instantly
6. Manually organize remaining 597
```

### Option B: Manual by Angle (Most Control)
```
1. Upload 1,000 photos
2. Sidebar → Click "Front: 245"
3. Grid shows only front-angle photos
4. Cmd+A → select all 245
5. Bottom bar: [Link to...▼] → "1969 Bronco"
6. Photos disappear
7. Sidebar → Click "Rear: 198"
8. Repeat
```

### Option C: Manual by Vehicle (When AI Works)
```
1. Upload 1,000 photos
2. Sidebar → Click "Found: 900"
   (Shows only photos where AI detected vehicle)
3. Look at first photo
4. If it's your Bronco:
   - Select it (+ similar ones with Cmd+Click)
   - Link to Bronco
5. Repeat for C10, etc.
```

---

## 🤔 QUESTIONS FOR YOU:

### 1. What should the DEFAULT view show?
- a) Everything (all photos, no filter)
- b) Unorganized only (Hide Organized ON by default)
- c) AI Complete only (so you can organize right away)

### 2. Sidebar numbers - should they be:
- a) **Clickable filters** (click "Front: 245" → shows only fronts)
- b) **Just info** (counts only, checkboxes to filter)
- c) **Both** (click number OR checkbox)

### 3. When AI suggests a vehicle grouping:
- a) One-click accept in sidebar → auto-creates vehicle + links photos
- b) Click to view photos first, then confirm
- c) Auto-create vehicle, let you review/reject after

### 4. Grid size - which do you want as DEFAULT?
- a) Small (8 columns, see hundreds at once)
- b) Medium (5 columns, balanced)
- c) Large (3 columns, see details)

### 5. When you select photos and link to vehicle:
- a) They disappear immediately (if Hide Organized is ON)
- b) They stay but show "✓ ORGANIZED" badge
- c) They grey out

---

## 💡 MY RECOMMENDATION

Based on what you described, I think you want:

```
DEFAULT STATE:
- Hide Organized: ON (so organized photos disappear)
- Sort: Newest first
- Grid: Medium (5 columns)
- Sidebar: Open (shows counts)

SIDEBAR:
- Numbers are CLICKABLE (click to filter instantly)
- Combine filters (Front + AI Complete + Vehicle Found)
- AI Suggestions with one-click accept

GRID:
- Zero gap (photos touch)
- Click photo = select it
- Cmd+Click = multi-select
- Selected photos show checkmark

BOTTOM BAR (when selecting):
- Quick dropdown to link to vehicle
- One-click "Mark Organized"
- Delete button
- Clear selection

WORKFLOW:
Click "Front: 245" → Cmd+A → Link to Bronco → Photos disappear → Click "Rear: 198" → Repeat
```

**Is this the right mental model?** Tell me what's wrong and I'll adjust before building.

