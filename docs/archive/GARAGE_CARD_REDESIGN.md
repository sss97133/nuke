# Garage Vehicle Card Redesign

## Problem Statement

The original vehicle cards in the garage view (`/vehicles` page) displayed minimal value:
- **ROI:** "Add purchase price" (placeholder text with no guidance)
- **Build:** "0 photos · 0 events" (raw counts without context)
- **Interest:** "0 views" (passive metrics)

These cards were described as "completely deprecated crappy" with no valuable information present. The design didn't scale well whether a user had 1 vehicle or 100 vehicles.

## Solution

Created `GarageVehicleCard.tsx` - a redesigned card that surfaces actionable insights instead of placeholder text.

### Key Features

#### 1. **Health Score (0-100%)**
Visual indicator showing profile completeness:
- **+25%** for value information (purchase/current price)
- **+25%** for images uploaded
- **+25%** for timeline events logged
- **+25%** for recent activity (within 30 days)

Color-coded: Green (75%+), Yellow (50-74%), Red (0-49%)

#### 2. **Smart Primary Actions**
Cards intelligently suggest the most important next step:
- **Priority 1:** "Set Value" - if no pricing data
- **Priority 2:** "Add Photos" - if events exist but no documentation
- **Priority 3:** "Log Activity" - if 30+ days since last update
- **Priority 4:** "Start Building" - if completely empty

Each action includes context ("Track your investment", "X events need documentation")

#### 3. **Real Metrics Instead of Placeholders**
- **Value/ROI:** Shows actual current value + gain/loss in dollars (color-coded green/red)
- **Latest Activity:** "Installed headers 2d ago" instead of generic counts
- **Stats Row:** Compact footer with events, views, mileage

#### 4. **Live Data Loading**
Each card fetches real metrics on mount:
- Image count from `vehicle_images` table
- Event count from `timeline_events` table
- Latest activity with timestamp
- Valuation data from `vehicle_valuations` table
- View count from `vehicle_analytics` table

#### 5. **Relationship Status Badges**
Clear visual indicators with semantic colors:
- **Owned:** Green (verified ownership)
- **Contributor:** Blue
- **Watching:** Yellow (interested)
- **Discovered:** Purple
- **Curated:** Orange
- **Consigned:** Cyan
- **Previous Owner:** Gray

### Visual Design

- **Image height:** 140px (more compact than before)
- **Responsive grid:** `repeat(auto-fill, minmax(280px, 1fr))` - scales from 1 to 100+ vehicles
- **Hover states:** Lift effect with border highlight
- **Status overlays:** Health score (top right), relationship badge (top left), photo count (bottom left)

### Data Architecture

The card makes 5 parallel queries on mount to load real metrics:
```typescript
const [
  { count: imageCount },      // vehicle_images table
  { count: eventCount },       // timeline_events table
  { data: latestEvent },       // Most recent activity
  { data: valuation },         // Latest value estimate
  { count: viewCount }         // Analytics data
] = await Promise.all([...]);
```

This ensures every card shows accurate, up-to-date information without relying on denormalized counts that may be stale.

## User Experience Improvements

### Before
- User sees "0 photos · 0 events" → No guidance on what to do
- User sees "Add purchase price" → No explanation of why it matters
- User sees "0 views" → Passive metric, no action

### After
- User sees "78% Health" → Clear progress indicator
- User sees "SET VALUE: Track your investment" → Actionable with reason
- User sees "Last: Installed headers 2d ago" → Actual context of their work

### Scales for All Users

**1 Vehicle:**
- Focus on completing profile (health score)
- Clear next steps for building documentation

**10 Vehicles:**
- Quick scan of which need attention (red/yellow health scores)
- See recent activity at a glance

**100+ Vehicles:**
- Efficient grid layout (responsive sizing)
- Visual triage via color coding
- Minimal chrome, maximum density

## Implementation

### Files Changed
- **NEW:** `/nuke_frontend/src/components/vehicles/GarageVehicleCard.tsx` (372 lines)
- **UPDATED:** `/nuke_frontend/src/pages/Vehicles.tsx` (replaced card rendering section)

### Breaking Changes
None - the component accepts the same props as before but renders differently.

### Performance Considerations
- Each card makes 5 database queries on mount
- For a garage with 50 vehicles, this means 250 total queries
- **Optimization opportunity:** Consider batch loading metrics in parent component and passing down as props

### Future Enhancements
1. **Batch metrics loading** - Load all vehicle metrics in one RPC call
2. **Click actions** - Make primary action button directly navigate to specific section (pricing, upload, etc.)
3. **Trend indicators** - Show value change arrows (up/down/flat)
4. **Quick actions menu** - Right-click context menu for common operations
5. **Drag-to-reorder** - Let users organize their garage manually

## Testing Recommendations

1. **Empty vehicle** - No data, should show "Start Building" action
2. **Partial vehicle** - Some data, should show appropriate next step
3. **Complete vehicle** - All fields filled, should show 100% health
4. **Stale vehicle** - 90+ days inactive, should prompt activity
5. **High-value vehicle** - Large ROI, should highlight gains clearly

## Design Principles Applied

1. **Show, don't tell** - Real data instead of placeholder text
2. **Guide, don't confuse** - Clear next actions with reasoning
3. **Scale gracefully** - Works for 1 or 1000 vehicles
4. **Information density** - Maximum value in minimum space
5. **Visual hierarchy** - Most important info (health, value) is prominent

## Result

A garage view that functions as a **dashboard** rather than just a list - showing owners what needs attention, what's performing well, and what's next.

