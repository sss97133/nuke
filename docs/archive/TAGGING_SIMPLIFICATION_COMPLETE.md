# Tagging System Simplification - LMC Style

## Problem Identified

**Current state has 4 competing UIs:**
1. Sidebar with full tag list (lines 821-1062)
2. Minimized sidebar button (lines 1064-1087)  
3. Bottom info panel with repeated tags (lines 1089-1195)
4. Spatial dots + popup (✅ KEEP THIS)

Result: User confused which to use. "Slop."

---

## LMC Truck Model

**Simple:**
- Click on truck diagram area
- Inline price list pops up
- Double-click to order
- That's it

---

## Changes Required

### 1. DELETE Sidebar (Lines 821-1062)
Remove entire `Tags Sidebar - Windows 95 Style` section including:
- Title bar with minimize/add buttons
- Manual tagging instructions
- Tag input forms
- AI analyze button
- ShoppablePartTag list

### 2. DELETE Minimized Button (Lines 1064-1087)
Remove the floating "Tags (3)" restore button

### 3. SIMPLIFY Bottom Info (Lines 1089-1195)
Keep ONLY:
- Image title/number
- Count of shoppable parts ("3 shoppable parts")
Remove:
- Tag badge list
- "Add tags" input
- "Login to add tags" prompt

### 4. SIMPLIFY Top Controls
Replace complex filter dropdown with:
- Simple "Show/Hide Parts" toggle
- "Tag (T)" button for tagging mode
- Close button

---

## What Remains

**Single, clean interface:**
1. Square spatial dots on image (green = shop, grey = info)
2. Click dot → `SpatialPartPopup` at that location
3. Popup shows part name + suppliers + prices
4. Double-click supplier → checkout
5. Press `T` to enter tagging mode
6. Drag box → name part → AI matches catalog → green dot

**No sidebar. No modal spam. Just dots.**

---

## Implementation

File: `ImageLightbox.tsx`

Delete:
- Lines 821-1062 (sidebar)
- Lines 1064-1087 (minimized button)
- Lines 1114-1195 (tag badges + input in bottom info)

Simplify:
- Top controls: Just Show/Hide + Tag(T) + Close
- Bottom info: Just "Image X" + "N shoppable parts"

Keep:
- Spatial dots rendering (lines ~760-820)
- SpatialPartPopup (lines ~1240+)
- Tagging mode logic
- AI analysis logic

---

Result: Clean LMC-style interface with ONE clear objective.

