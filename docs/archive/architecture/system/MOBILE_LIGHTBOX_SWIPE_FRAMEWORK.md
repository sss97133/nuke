# Mobile Lightbox - Swipe Gesture Framework

**Date**: November 23, 2025  
**Status**: PROPOSAL / FRAMEWORK

---

## Current State vs Proposed

### CURRENT (Just Shipped)
```
┌─────────────────────────────────────┐
│  ✕   1 of 15 • SWIPE TO NAVIGATE  ⋮ │ ← 35px toolbar
├─────────────────────────────────────┤
│                                     │
│                                     │
│                                     │
│             [IMAGE]                 │
│                                     │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘

Swipes: LEFT/RIGHT = navigate images
        TAP = toggle toolbar
        MENU = open sidebar (from right)
```

### PROPOSED (Advanced Gestures)
```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│                                     │
│             [IMAGE]                 │ ← FULL SCREEN
│                                     │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘

Swipes: 
  LEFT/RIGHT    = navigate images (existing)
  UP            = show info overlay (from bottom)
  DOWN          = dismiss info / close lightbox
  TWO-FINGER UP = quick actions menu
  DOUBLE-TAP    = zoom/unzoom
  LONG-PRESS    = contextual options
```

---

## 🎯 Gesture Map

### Primary Navigation Gestures

#### 1. **SWIPE LEFT/RIGHT** (Existing ✅)
```
     [PREV]  ←  [IMAGE]  →  [NEXT]
     
Use: Navigate through image gallery
Speed: Fast swipe = skip to next
       Slow drag = preview/scrub
```

#### 2. **SWIPE UP** (New - Info Panel)
```
┌─────────────────────────────────────┐
│                                     │
│             [IMAGE]                 │
│                                     │
├─────────────────────────────────────┤ ← Drag handle
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ 📍 May 17, 2022 • San Francisco     │
│ 📸 Shot on iPhone 13 Pro            │
│ 👤 Uploaded by @skylar              │
│                                     │
│ [TAGS: engine, front, detail]       │
│                                     │
│ 💬 3 comments  •  👁 24 views       │
└─────────────────────────────────────┘

States:
  Peek (50%):  Swipe up 20% = snap to half
  Full (90%):  Swipe up 60% = snap to full
  Dismiss:     Swipe down = dismiss panel
```

#### 3. **SWIPE DOWN** (New - Dismiss/Close)
```
Action depends on context:

IF info panel open:
  → Dismiss info panel
  
IF info panel closed:
  → Close lightbox entirely
  → Return to gallery
  
Threshold: 100px drag minimum
```

#### 4. **TWO-FINGER SWIPE UP** (New - Quick Actions)
```
┌─────────────────────────────────────┐
│                                     │
│             [IMAGE]                 │
│                                     │
├─────────────────────────────────────┤
│  [TAG]  [⭐]  [↻]  [👁]  [🗑]      │ ← Quick bar
└─────────────────────────────────────┘

5 Quick Actions (always same order):
  TAG    - Open tagger
  STAR   - Set as primary
  ROTATE - Rotate 90°
  HIDE   - Mark sensitive
  DELETE - Delete image
  
Dismiss: Tap image or swipe down
```

---

## 📱 Info Panel Design (Swipe Up)

### State 1: PEEK (50% height)
```
┌─────────────────────────────────────┐
│                                     │
│             [IMAGE]                 │ ← 50% visible
│                                     │
├─────────────────────────────────────┤
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │ ← Drag handle
├─────────────────────────────────────┤
│                                     │
│ May 17, 2022 • 3:45 PM              │
│ San Francisco, CA                   │
│                                     │
│ iPhone 13 Pro Max                   │
│ f/1.5 • 1/120s • ISO 100            │
│                                     │
│ @skylar • 2 days ago                │
│                                     │
│ engine bay • front • detail         │
│                                     │
│ 3 comments • 24 views               │
│                                     │
└─────────────────────────────────────┘

Quick Facts (no headers, just data):
  - Date/time + location
  - Camera + EXIF
  - Uploader + when
  - Tags (first 3)
  - Engagement metrics
```

### State 2: FULL (90% height)
```
┌──────────────┐
│   [IMAGE]    │ ← 10% visible (thumbnail)
├──────────────┤
│ ▔▔▔▔▔▔▔▔▔▔▔ │
├──────────────┴──────────────────────┐
│ [INFO] [TAGS] [COMMENTS] [ACTIONS] │ ← Tabs
├─────────────────────────────────────┤
│                                     │
│ May 17, 2022 • 3:45:23 PM           │
│ 37.7749° N, 122.4194° W             │
│ San Francisco, CA 94103             │
│ [View on map]                       │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ iPhone 13 Pro Max                   │
│ 26mm f/1.5 • 1/120s • ISO 100       │
│ 4032 × 3024 (12.2 MP)               │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ @skylar                             │
│ 2 days ago                          │
│ iPhone 13 Pro Max                   │
│ Source: dropbox_import              │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Timeline: "Engine Work" (May 17)    │
│ Event: "Oil Change & Inspection"    │
│ [View event]                        │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ 24 views • 3 comments               │
│ 2 image sets • 5 tags               │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ engine bay • front • detail         │
│ oil filter • inspection             │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Front 3/4 • High (95%)              │
│ 12 parts detected                   │
│ [View analysis]                     │
│                                     │
└─────────────────────────────────────┘

Clean info (no headers):
  - Just data, separated by dividers
  - Users know what each section is
  - Contextual links where relevant
```

---

## 🎨 Gesture Interactions

### Double Tap = Zoom Toggle
```
STATE 1: FIT TO SCREEN
┌─────────────────────────────────────┐
│                                     │
│        ┌─────────────────┐          │
│        │                 │          │
│        │     [IMAGE]     │          │
│        │                 │          │
│        └─────────────────┘          │
│                                     │
└─────────────────────────────────────┘
         ↓ DOUBLE TAP
         
STATE 2: 2X ZOOM (where tapped)
┌─────────────────────────────────────┐
│███████████████████████████████████│ ← Zoomed region
│███████████████████████████████████│
│█████ [DETAIL] ████████████████████│
│███████████████████████████████████│
│███████████████████████████████████│
└─────────────────────────────────────┘

Pinch to zoom: Continuous zoom 1x-4x
Double tap: Toggle 1x ↔ 2x
```

### Long Press = Context Menu
```
┌─────────────────────────────────────┐
│                                     │
│             [IMAGE]                 │
│         (LONG PRESS)                │
│              ↓                      │
│     ┌───────────────────┐          │
│     │ Set as Primary    │          │
│     │ Add to Set...     │          │
│     │ Tag Image         │          │
│     │ Copy Image URL    │          │
│     │ Download Original │          │
│     │ Mark Sensitive    │          │
│     │ ─────────────     │          │
│     │ Delete Image      │          │
│     └───────────────────┘          │
│                                     │
└─────────────────────────────────────┘

Shows: Contextual quick actions
Dismiss: Tap outside or swipe away
```

### Pinch = Zoom In/Out
```
┌─────────────────────────────────────┐
│                                     │
│        ↙️  [IMAGE]  ↘️               │ ← Pinch out = zoom in
│                                     │
│        ↖️          ↗️                │ ← Pinch in = zoom out
│                                     │
└─────────────────────────────────────┘

Range: 1x (fit) → 4x (max)
Reset: Double tap or swipe down
```

---

## 🔄 Gesture Priority & Conflicts

### Gesture Resolution Logic

```
┌─────────────────────────────────────┐
│         GESTURE DECISION TREE       │
├─────────────────────────────────────┤
│                                     │
│  Touch Start                        │
│    ↓                                │
│  Single finger?                     │
│    ├─ YES → Track movement          │
│    │         ↓                      │
│    │       Horizontal > 50px?       │
│    │         ├─ YES → Navigate      │
│    │         └─ NO → Check vertical │
│    │                   ↓            │
│    │                 Vertical > 50? │
│    │                   ├─ UP → Info │
│    │                   └─ DN → Close│
│    │                                │
│    └─ NO → Two fingers?             │
│              ├─ Pinch → Zoom        │
│              ├─ Swipe Up → Actions  │
│              └─ Swipe Down → Ignore │
│                                     │
│  Touch Hold > 500ms?                │
│    └─ YES → Context Menu            │
│                                     │
│  Double Tap (< 300ms)?              │
│    └─ YES → Toggle Zoom             │
│                                     │
└─────────────────────────────────────┘
```

### Priority Order (when conflicts)
1. **Pinch** (two-finger) - Always zoom
2. **Horizontal swipe** - Always navigate
3. **Vertical swipe** - Context-dependent (info vs close)
4. **Long press** - Context menu
5. **Double tap** - Zoom toggle
6. **Single tap** - Toggle UI visibility

---

## 📐 Info Panel Sections (Full View)

### Tab 1: INFO (Default)
```
┌─────────────────────────────────────┐
│ [INFO] TAGS  COMMENTS  ACTIONS      │
├─────────────────────────────────────┤
│                                     │
│ May 17, 2022 • 3:45:23 PM           │
│ 2 days ago                          │
│                                     │
│ San Francisco, CA                   │
│ 37.7749° N, 122.4194° W             │
│ [View on map]                       │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Apple iPhone 13 Pro Max             │
│ Back Dual Camera 5.7mm f/1.5        │
│ 1/120s • f/1.5 • ISO 100            │
│ 4032 × 3024 (12.2 MP)               │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Photographer: Unknown               │
│ @skylar                             │
│ Skylar's Garage                     │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Timeline: "Engine Work"             │
│ Sets: Restoration (2)               │
│ Parts: Oil Filter (1)               │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ 24 views • 3 comments               │
│ 5 tags • 2 sets                     │
│ Priority: 85 (High)                 │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Front 3/4 View (95%)                │
│ High quality                        │
│ 12 parts detected                   │
│ [View details]                      │
│                                     │
└─────────────────────────────────────┘
```

### Tab 2: TAGS
```
┌─────────────────────────────────────┐
│ INFO  [TAGS] COMMENTS  ACTIONS      │
├─────────────────────────────────────┤
│                                     │
│ [engine bay]  [front]  [detail]    │
│ [oil filter]  [inspection]          │
│                                     │
│ [+ Add tag]                         │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Oil Filter - Front                  │
│ K&N HP-1017                         │
│ [View] [Shop]                       │
│                                     │
│ Air Intake - Left                   │
│ OEM Part #17220-5AA-A00             │
│ [View] [Shop]                       │
│                                     │
│ Battery - Right                     │
│ Interstate MTZ-65                   │
│ [View] [Shop]                       │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ Radiator Hose (87%)                 │
│ [Verify] [Reject]                   │
│                                     │
│ Engine Mount (73%)                  │
│ [Verify] [Reject]                   │
│                                     │
│ [View 5 more]                       │
│                                     │
└─────────────────────────────────────┘
```

### Tab 3: COMMENTS
```
┌─────────────────────────────────────┐
│ INFO  TAGS  [COMMENTS] ACTIONS      │
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ @mechanic_mike • 1 day ago      │ │
│ │                                 │ │
│ │ Looks like that oil filter      │ │
│ │ needs replacing soon. See the   │ │
│ │ slight discoloration?           │ │
│ │                                 │ │
│ │ [Reply] [Like (2)]              │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ @skylar • 1 day ago             │ │
│ │                                 │ │
│ │ Good catch! I'll swap it out    │ │
│ │ this weekend.                   │ │
│ │                                 │ │
│ │ [Reply] [Like (1)]              │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ @parts_supplier • 12 hours ago  │ │
│ │                                 │ │
│ │ We have K&N HP-1017 in stock!   │ │
│ │ $12.99 + free shipping          │ │
│ │                                 │ │
│ │ [Reply] [Like] [Shop Now]       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ [Write a comment...]            │ │
│ │                                 │ │
│ │                         [Send]  │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### Tab 4: ACTIONS (Quick Access)
```
┌─────────────────────────────────────┐
│ INFO  TAGS  COMMENTS  [ACTIONS]     │
├─────────────────────────────────────┤
│                                     │
│ [TAG IMAGE]                         │
│ Open spatial tagging tool           │
│                                     │
│ [SET AS PRIMARY]                    │
│ Make this the hero image            │
│                                     │
│ [ROTATE 90°]                        │
│ Rotate clockwise                    │
│                                     │
│ [MARK SENSITIVE]                    │
│ Blur for privacy                    │
│                                     │
│ [ADD TO SET]                        │
│ Add to image collection             │
│                                     │
│ [DOWNLOAD]                          │
│ Download original quality           │
│                                     │
│ [COPY LINK]                         │
│ Copy shareable URL                  │
│                                     │
│ [SHARE]                             │
│ Share to social media               │
│                                     │
│ ─────────────────────────────────   │
│                                     │
│ [DELETE IMAGE]                      │
│ Permanently remove (can't undo)     │
│                                     │
└─────────────────────────────────────┘
```

---

## 💡 Smart Features

### 1. Adaptive Info Panel
```
Context-aware content (no headers, just smart ordering):

IF image has EXIF → Show camera/location first
IF image has tags → Show spatial tags near top
IF image has parts → Show shoppable parts prominently
IF image linked to event → Show event context early
IF image has AI data → Show confidence scores

Order adapts to what's most relevant for THAT image.
Users understand context from the data itself.
```

### 2. Gesture Hints
```
First-time user sees overlay:

┌─────────────────────────────────────┐
│                                     │
│             [IMAGE]                 │
│                                     │
│     ← Swipe to navigate →           │
│     ↑ Swipe up for info             │
│     ↓ Swipe down to close           │
│                                     │
│          [Got it!]                  │
└─────────────────────────────────────┘

Shown once, dismissed forever
```

### 3. Peek Gesture (iOS-style)
```
Partial swipe reveals preview:

┌─────────────────────────────────────┐
│             [CURRENT]               │
│                                     │
│  ┌──────┐                   ┌─────│ ← Peeking next
│  │ PREV │                   │ NEXT│
│  └──────┘                   └─────│
│                                     │
└─────────────────────────────────────┘

Drag > 50% = commit to next image
Drag < 50% = snap back to current
```

### 4. Quick Scrub Mode
```
Fast horizontal swipe = scrub mode:

┌─────────────────────────────────────┐
│  [1] [2] [3] [4] [5] [6] [7] [8]   │ ← Filmstrip
├─────────────────────────────────────┤
│                                     │
│             [IMAGE 4]               │
│                                     │
│           4 of 15 photos            │
└─────────────────────────────────────┘

Drag finger = scrub through images
Release = stay on current
```

---

## 🎯 Recommended Implementation

### Phase 1: Foundation (1-2 hours) ✅ DONE
- [x] Single-row toolbar
- [x] Swipe left/right navigation
- [x] Sidebar menu

### Phase 2: Info Panel (2-3 hours)
- [ ] Swipe up gesture detector
- [ ] Info panel with drag handle
- [ ] Peek (50%) and Full (90%) states
- [ ] Smooth spring animations
- [ ] Tab navigation (Info, Tags, Comments, Actions)

### Phase 3: Advanced Gestures (2-3 hours)
- [ ] Double-tap zoom toggle
- [ ] Pinch to zoom (1x-4x)
- [ ] Two-finger swipe up for quick actions
- [ ] Long-press context menu
- [ ] Swipe down to dismiss/close

### Phase 4: Polish (1-2 hours)
- [ ] Haptic feedback on gestures
- [ ] Gesture hints for first-time users
- [ ] Peek preview on partial swipe
- [ ] Quick scrub mode
- [ ] Smooth transitions & animations

---

## 📱 Technical Implementation Notes

### Gesture Detection Library
```typescript
// Recommended: react-use-gesture
import { useGesture } from '@use-gesture/react';
import { useSpring, animated } from 'react-spring';

const bind = useGesture({
  onDrag: ({ down, movement: [mx, my], direction: [dx, dy] }) => {
    // Horizontal swipe = navigate
    if (Math.abs(mx) > Math.abs(my) && Math.abs(mx) > 50) {
      if (dx > 0) onPrev();
      else onNext();
    }
    // Vertical swipe = info panel
    else if (Math.abs(my) > 50) {
      if (dy < 0) openInfoPanel();
      else closeInfoPanel();
    }
  },
  onPinch: ({ offset: [scale] }) => {
    setZoom(scale);
  },
  onDoubleTap: () => {
    toggleZoom();
  }
});
```

### Info Panel States
```typescript
type PanelState = 'closed' | 'peek' | 'full';

const [panelState, setPanelState] = useState<PanelState>('closed');
const [{ y }, api] = useSpring(() => ({ y: window.innerHeight }));

const openToPeek = () => {
  api.start({ y: window.innerHeight * 0.5 });
  setPanelState('peek');
};

const openToFull = () => {
  api.start({ y: window.innerHeight * 0.1 });
  setPanelState('full');
};

const close = () => {
  api.start({ y: window.innerHeight });
  setPanelState('closed');
};
```

### Gesture Priority
```typescript
// Order matters! Check in this sequence:
1. Pinch (two fingers) → Zoom
2. Two-finger swipe → Quick actions
3. Long press → Context menu
4. Horizontal swipe → Navigate
5. Vertical swipe → Info panel
6. Double tap → Zoom toggle
7. Single tap → UI toggle
```

---

## 🎨 Design Tokens

### Animation Timings
```css
--gesture-snap-duration: 250ms;
--gesture-spring-tension: 280;
--gesture-spring-friction: 60;
--panel-transition: cubic-bezier(0.4, 0, 0.2, 1);
```

### Gesture Thresholds
```typescript
SWIPE_THRESHOLD = 50; // px
SWIPE_VELOCITY_THRESHOLD = 0.5; // px/ms
LONG_PRESS_DURATION = 500; // ms
DOUBLE_TAP_DELAY = 300; // ms
PINCH_SCALE_MIN = 1.0;
PINCH_SCALE_MAX = 4.0;
```

---

## Summary

### What This Gets You:
1. **More screen space** - Full-screen image by default
2. **Natural gestures** - Swipe up for info, down to close
3. **Quick actions** - Two-finger swipe or sidebar menu
4. **Rich metadata** - Full EXIF, AI analysis, comments in info panel
5. **Better mobile UX** - Gesture-first, not button-first

### Key Insight:
**Stop trying to fit desktop UI into mobile.** Use the whole screen for the image, let gestures reveal UI contextually.

Ready to implement Phase 2? 🚀

