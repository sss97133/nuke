<!-- 5aec0345-1027-4182-b4d1-133f713a8c0b 078fe148-f382-4417-966a-278667328cd6 -->
# Mobile UX Refinements

## Overview of Changes

Transform mobile profile into sophisticated market platform with:

1. Instagram-style image viewer
2. Swipeable price carousel (share/value/bets/auction)
3. Pinch-zoom on images only (not UI)
4. AI-powered clickable specs
5. Enhanced viewer modes (Feed/Discover/Technical)

## 1. Image Zoom Fix

### Current Problem

- Double-tap zooms entire page/UI ❌
- Zooms into UI elements, not just image ❌

### Required Behavior

- ✅ ONLY pinch-to-zoom gesture
- ✅ ONLY the image expands (not UI)
- ✅ Image fills viewport when zoomed
- ✅ Rest of UI stays at normal scale

**Implementation**:

```javascript
// Remove double-tap zoom handler
// Add pinch gesture detection
// Use CSS transform on image element only
// Prevent page zoom with viewport meta tag
```

## 2. Price Box Swipeable Carousel

### Current

Single static market metrics card

### New: Multi-Screen Swipeable Component

**Screen 1: Share Price** (default)

```
┌──────────────────────────┐
│ $42.15/share  ↑ 2.3%    │
│ Volatility: ●●○○○        │
│ Trading: 🟢 Active       │
└──────────────────────────┘
```

**Screen 2: Total Value** (swipe left)

```
┌──────────────────────────┐
│ Market Cap: $45,200      │
│ Purchase: $38,000        │
│ Gain: +$7,200 (18.9%)    │
└──────────────────────────┘
```

**Screen 3: Bets/Speculation** (swipe left again)

```
┌──────────────────────────┐
│ 🎲 Market Bets           │
│ Will reach $50k: 67%     │
│ Next mod value: +$2k     │
│ Completion: 3 months     │
└──────────────────────────┘
```

**Screen 4: Auction Vote** (swipe left again)

```
┌──────────────────────────┐
│ 🏛️ Send to Auction?      │
│ [Vote Yes] [Vote No]     │
│ Current votes: 3 yes     │
└──────────────────────────┘
```

**Windows 95 Styling**:

- Beveled borders (2px outset/inset)
- Gray background (#c0c0c0)
- Blue accents (#000080)
- Dotted indicators below for screen position

## 3. Instagram-Style Images View

### Current

Simple 2-column grid, all images same size

### New: Instagram Feed Layout

**Three View Modes** (buttons at top):

#### Feed View (Default)

- Single column like Instagram Stories
- Full-width images
- Vertical scrolling
- Like/comment buttons on each
- Optimized for engagement

#### Discover View

- 4 images across (grid)
- Verticals take 2 boxes tall (more space)
- Horizontals single box
- Dense browsing mode
- Shows more images per screen

#### Technical View

- 3 images across
- Overlay shows:
  - View count
  - Engagement score
  - Technical value (AI-rated)
  - Tags count
- Data-driven display

**Layout Logic**:

```javascript
if (viewMode === 'feed') {
  // Single column, full width
  return <InstagramFeedLayout />
}
else if (viewMode === 'discover') {
  // 4-across grid, verticals span 2 rows
  const gridItems = images.map(img => ({
    ...img,
    span: img.orientation === 'vertical' ? 2 : 1
  }))
  return <MasonryGrid items={gridItems} columns={4} />
}
else if (viewMode === 'technical') {
  // 3-across with data overlays
  return <TechnicalGrid images={images} />
}
```

## 4. Clickable AI-Powered Specs

### Current

Static specs list (year, make, model, etc.)

### New: Interactive AI Research

When you click any spec, opens modal with AI-researched data:

**Example: Click "Engine: V8"**

Modal shows:

```
┌─────────────────────────────────────┐
│ ENGINE SPECIFICATIONS               │
├─────────────────────────────────────┤
│ Factory Data (AI-sourced):          │
│ • Type: 350ci V8                    │
│ • HP: 165 hp @ 3,800 rpm            │
│ • Torque: 255 lb-ft @ 2,400 rpm     │
│ • Carburetor: Rochester Quadrajet   │
│                                     │
│ Market Context:                     │
│ • Common engine: 78% of K5s         │
│ • Rebuild cost: $2,500-4,000        │
│ • Reliability: Above average        │
│                                     │
│ Community Intel:                    │
│ • Forum discussions: 1,247 posts    │
│ • Facebook groups: 12 active        │
│ • Common mods: Headers, cam         │
│                                     │
│ Sources:                            │
│ 📄 Factory service manual p.142     │
│ 📊 NADA historical data            │
│ 💬 K5 Blazer Forum (248 threads)   │
│ 📱 Classic Truck FB Group          │
└─────────────────────────────────────┘
```

**AI Guardrails Process**:

1. User clicks "Engine" spec
2. AI identifies vehicle: 1977 Chevrolet K5
3. Searches within bounds:

   - Factory manuals for K5 Blazer
   - Historical value data for 1977
   - Current market comps
   - Forum posts about 350ci V8
   - Facebook group discussions

4. Synthesizes answer with sources
5. Each spec has unique research pathway

**Clickable Specs**:

- Engine → Factory specs + market data
- Transmission → Gear ratios + rebuild costs  
- Drivetrain → 4WD system details
- Axles → Gear ratio + locker options
- Tires → Size compatibility + common upgrades
- Suspension → Lift kit data + ride quality

## 5. Price Carousel Implementation

**Component**: `PriceCarousel.tsx`

Features:

- Horizontal swipe between 4 screens
- Dots indicator at bottom
- Windows 95 beveled style
- Touch-friendly (48px+ touch targets)

Screens:

1. **Share Price** - Trading metrics
2. **Total Value** - Purchase vs current
3. **Bets** - Market speculation/predictions
4. **Auction Vote** - Community voting

## 6. Image Viewer Modes

### Button Bar

```
[Feed] [Discover] [Technical]
```

### Feed Mode

- Instagram single-column layout
- Large images, full engagement
- Like/comment on each
- Optimized for scrolling

### Discover Mode  

- Dense 4-across grid
- Vertical images span 2 rows (portrait gets more space)
- Horizontal images single row
- Quick browsing, see more at once

### Technical Mode

- 3-across grid
- Each image shows overlay:
  - 👁️ 247 views
  - ⭐ 89% engagement
  - 💰 $340 value score
  - 🏷️ 12 tags

## Implementation Todos

### High Priority (Core UX)

1. Fix image zoom to pinch-only (no double-tap, image-only zoom)
2. Create swipeable price carousel (4 screens)
3. Make price box Windows 95 styled
4. Implement Instagram-style feed view

### Medium Priority (Enhanced Features)

5. Add Discover view (4-across masonry)
6. Add Technical view (with data overlays)
7. Make specs clickable with AI research modal
8. Implement spec-specific AI queries

### Low Priority (Data Infrastructure)

9. Create betting/speculation system
10. Create auction voting mechanism
11. Build AI guardrails for spec research
12. Index factory manuals/forums/Facebook groups

## Technical Approach

### Pinch Zoom

```javascript
const [scale, setScale] = useState(1);
const [lastScale, setLastScale] = useState(1);

const handleTouchMove = (e) => {
  if (e.touches.length === 2) {
    const dist = getDistanceBetweenTouches(e.touches);
    const newScale = (dist / initialDist) * lastScale;
    setScale(Math.min(Math.max(1, newScale), 4)); // 1x to 4x
  }
};

// Apply transform only to image element
<img style={{ transform: `scale(${scale})` }} />
```

### Price Carousel

```javascript
<SwipeableViews index={priceScreen} onChangeIndex={setPriceScreen}>
  <SharePriceScreen />
  <TotalValueScreen />
  <BettingScreen />
  <AuctionVoteScreen />
</SwipeableViews>
```

### Image Layout Modes

```javascript
const layouts = {
  feed: { columns: 1, showEngagement: true },
  discover: { columns: 4, spanVerticals: 2 },
  technical: { columns: 3, showMetrics: true }
};
```

### AI Spec Research

```javascript
async function researchSpec(vehicle, specName) {
  // Call AI with guardrails
  const context = {
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    vin: vehicle.vin,
    spec: specName
  };
  
  const sources = [
    'factory_manuals',
    'nada_historical',
    'current_market_comps',
    'forums', 
    'facebook_groups'
  ];
  
  return await ai.research(context, sources, guardrails);
}
```

## Questions for Discussion

1. **Price carousel screens** - Are 4 screens good, or want more/less?
2. **Betting system** - What should users bet on? (Value reaching X, completion date, etc.)
3. **Auction voting** - Threshold votes needed? Who can vote?
4. **Spec AI sources** - Should we index manuals now or wait?
5. **Image engagement tracking** - Track views/likes per image?

## Execution Order

**Phase 1** (Immediate):

- Fix pinch zoom
- Price carousel
- Windows 95 styling

**Phase 2** (Next):

- Instagram feed view
- Discover view
- Technical view

**Phase 3** (After):

- Clickable specs
- AI research
- Betting/auction

Should I proceed with Phase 1, or do you want to adjust the plan first?

### To-dos

- [ ] Analyze timeline event system and identify errors
- [ ] Update useTimelineEvents.ts to use vehicle_timeline_events
- [ ] Update AddEventWizard.tsx to insert into vehicle_timeline_events
- [ ] Update all timeline display components to read from vehicle_timeline_events
- [ ] Update Elixir API endpoints to use vehicle_timeline_events
- [ ] Test event creation and display end-to-end