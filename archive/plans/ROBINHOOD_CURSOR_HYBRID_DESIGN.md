# Robinhood × Cursor Hybrid Design for Automotive

**Date:** November 5, 2025  
**Goal:** X-style flow + Robinhood/Cursor feel for cars

---

## Design Philosophy

### X (Twitter) - Navigation Flow
- ✅ Vertical feed (scroll, not tabs)
- ✅ Minimal chrome (no heavy toolbars)
- ✅ Bottom nav only
- ✅ Thumb-zone optimized

### Robinhood - Financial Data Visualization
- ✅ Real-time value display (like stock price)
- ✅ Green/red for gains/losses
- ✅ Spark line charts
- ✅ Portfolio-style stat cards
- ✅ Dark mode default

### Cursor - Code Editor Aesthetic
- ✅ Monospace for numbers/data
- ✅ Inline diagnostics (AI insights)
- ✅ Dark theme, high contrast
- ✅ Precise, technical feel

---

## Component Breakdown

### 1. **Vehicle Value Hero** (Robinhood Stock Price)

```
┌─────────────────────────────────┐
│                                 │
│      ESTIMATED VALUE            │ ← Light grey, uppercase
│                                 │
│        $77,350                  │ ← Large, monospace, white
│     +$3,200 (4.3%)             │ ← Green for appreciation
│                                 │
│  [Spark line chart]            │ ← Simple line graph
│                                 │
└─────────────────────────────────┘
```

**Design:**
- Dark background (#0d0d0d)
- Large monospace price (#f5f5f5)
- Green for gains (#00c805)
- Red for losses (#ff5050)
- Minimal spark chart (80px height)

### 2. **Timeline Feed** (X Feed + Cursor Code Style)

```
┌─────────────────────────────────┐
│ 🔧  Engine Rebuild    Nov 3    │ ← Icon + title + date
│     New cam, lifters, springs   │ ← Description
│     -$4,250 • 12 images        │ ← Cost (red) + meta
├─────────────────────────────────┤
│ 🎨  Paint Correction  Oct 15   │
│     3-stage polish, ceramic     │
│     -$850 • 6 images           │
├─────────────────────────────────┤
│ 🛞  New Tires        Sep 2     │
│     BFG KO2 35x12.5R17         │
│     -$1,200 • 4 images         │
└─────────────────────────────────┘
```

**Design:**
- Clean list items (X-style)
- Monospace dates/costs (Cursor-style)
- Red for expenses, green for value-adds
- Hover state: slightly lighter background
- No heavy borders, just 1px dividers

### 3. **Stat Grid** (Robinhood Portfolio Cards)

```
┌──────────┬──────────┬──────────┐
│  PHOTOS  │  EVENTS  │   WORK   │
│   189    │    21    │  $8,450  │
│  +12     │   +3     │  +$750   │ ← 30-day change
└──────────┴──────────┴──────────┘
```

**Design:**
- Grid layout (3 columns)
- 1px gap between cells
- Monospace numbers
- Green/red for changes
- Uppercase labels (11px)

### 4. **Specs Sheet** (Cursor Code Editor)

```
┌─────────────────────────────────┐
│ engine         302 V8          │ ← Key: grey, Value: white
│ displacement   5.0L             │ ← Numbers: blue (#5ac8fa)
│ transmission   3-speed manual   │
│ drivetrain     4WD              │
│ compression    8.8:1            │
└─────────────────────────────────┘
```

**Design:**
- Monospace font (SF Mono, Roboto Mono)
- Keys left-aligned (grey)
- Values right-aligned (white)
- Numbers highlighted blue (like code)
- Hover: lighter background
- Looks like VSCode/Cursor inspector

### 5. **AI Insights** (Cursor Inline Diagnostics)

```
┌─────────────────────────────────┐
│ ℹ️  AI INSIGHT                   │ ← Blue accent
│                                 │
│ Based on 47 similar sales,     │
│ this vehicle is 12% above       │
│ market average. Originality     │
│ adds significant value.         │
└─────────────────────────────────┘
```

**Design:**
- Blue left border (3px)
- Blue background (10% opacity)
- Small label (11px, uppercase)
- Body text (14px, white)
- Variants: warning (orange), success (green)

### 6. **Bottom Nav** (X-style but Robinhood aesthetic)

```
┌─────────────────────────────────┐
│  [📈]    [📋]    [📸]    [⚙️]  │
│  Value  Timeline  Add   More    │
└─────────────────────────────────┘
```

**Design:**
- Fixed bottom, 56px height
- Dark background with blur
- 1px top border
- Icon + label (11px)
- 4 main actions
- Grey when inactive, white when active
- No color except on active state

---

## Color Usage Rules

### Dark Mode (Default)
```css
Background: #0d0d0d (almost black)
Surface:    #1a1a1a (card backgrounds)
Border:     #2a2a2a (subtle dividers)

Text:       #f5f5f5 (primary)
Text:       #a8a8a8 (secondary)
Text:       #6e6e6e (tertiary)

Green:      #00c805 (gains, appreciation, success)
Red:        #ff5050 (losses, expenses, errors)
Orange:     #ff8c42 (warnings, pending)
Blue:       #5ac8fa (links, info, numbers in code)
```

### When to Use Color

**Green (#00c805):**
- ✅ Vehicle value appreciation
- ✅ Positive cost changes
- ✅ Value-adding mods (engine, suspension)
- ✅ Success messages

**Red (#ff5050):**
- ✅ Expenses, costs
- ✅ Depreciation
- ✅ Errors, critical issues

**Orange (#ff8c42):**
- ✅ Maintenance due
- ✅ Pending actions
- ✅ Warnings

**Blue (#5ac8fa):**
- ✅ Links, clickable items
- ✅ Numbers in specs (like code highlighting)
- ✅ Info messages

**NO COLOR (Grey/White):**
- ✅ Everything else!
- ✅ Navigation
- ✅ Body text
- ✅ Borders
- ✅ Backgrounds

---

## Typography Rules

### Font Families
```css
Sans-serif: -apple-system, BlinkMacSystemFont, "Segoe UI"
  Use for: Body text, headings, UI labels

Monospace: 'SF Mono', 'Roboto Mono', 'Consolas'
  Use for: Prices, dates, numbers, specs, code-like data
```

### Font Sizes
```css
36px: Hero price (vehicle value)
20px: Stat values
15px: Body text, titles
14px: Descriptions
13px: Metadata, dates, labels
11px: Small labels, uppercase tags
```

### Font Weights
```css
300: Hero price (thin, elegant)
400: Body text (normal)
500: Nav labels
600: Titles, button text
700: Rarely used
```

---

## Mobile Layout Example

```
┌─────────────────────────────────┐
│  ← 1974 Ford Bronco         ⋮  │ ← Minimal header
├─────────────────────────────────┤
│                                 │
│      ESTIMATED VALUE            │
│        $77,350                  │ ← Robinhood-style
│     +$3,200 (4.3%)             │
│  [Spark line chart]            │
│                                 │
├─────────────────────────────────┤
│  [Full-width image carousel]   │ ← No border, full bleed
├─────────────────────────────────┤
│ 189 photos • 21 events • 8,450 │ ← Inline stats
├─────────────────────────────────┤
│                                 │
│ 🔧  Engine Rebuild    Nov 3    │ ← X-style feed
│     New cam, lifters, springs   │
│     -$4,250 • 12 images        │
├─────────────────────────────────┤
│ 🎨  Paint Correction  Oct 15   │
│     3-stage polish, ceramic     │
│     -$850 • 6 images           │
├─────────────────────────────────┤
│ ℹ️  AI INSIGHT                   │ ← Cursor-style inline
│     Based on 47 similar sales   │
│     ...                          │
├─────────────────────────────────┤
│ engine         302 V8          │ ← Cursor code style
│ displacement   5.0L             │
│ transmission   3-speed manual   │
└─────────────────────────────────┘
│ [📈] [📋] [📸] [⚙️]            │ ← Bottom nav (X-style)
└─────────────────────────────────┘
```

---

## Interaction Patterns

### Gestures (X-style)
- **Swipe left/right:** Next/prev image
- **Pull down:** Refresh (Robinhood-style spinner)
- **Long press:** Context menu
- **Tap:** View details

### Transitions (Robinhood snappy)
```css
transition: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
```
- Smooth but fast
- No slow fades
- Button press: scale(0.98) on active

### Animations (Minimal)
- Chart lines: smooth draw-in
- Value changes: number ticker (Robinhood-style)
- Feed items: slide up on load
- NO: Spinning, bouncing, pulsing

---

## Key Differences from Current Design

### BEFORE (Current)
- ❌ 8-11px text (too small)
- ❌ Colored buttons (green, blue, yellow)
- ❌ 2px borders everywhere
- ❌ Light mode default
- ❌ Cards with padding
- ❌ Tabs for navigation

### AFTER (Robinhood × Cursor)
- ✅ 15-17px text (readable)
- ✅ Grey buttons, color only for financial data
- ✅ 1px borders (minimal)
- ✅ Dark mode default
- ✅ Full-bleed sections
- ✅ Vertical feed, bottom nav

---

## Implementation Checklist

### Phase 1: Core Styles
- [x] Create `robinhood-cursor-hybrid.css`
- [ ] Import in main app
- [ ] Apply dark theme globally

### Phase 2: Vehicle Value Hero
- [ ] Large monospace price display
- [ ] Green/red gain/loss indicator
- [ ] Spark line chart (Recharts or custom SVG)

### Phase 3: Timeline Feed
- [ ] Convert timeline to X-style list
- [ ] Add hover states
- [ ] Monospace dates/costs
- [ ] Red for expenses

### Phase 4: Specs Sheet
- [ ] Code editor layout
- [ ] Monospace font
- [ ] Blue highlighting for numbers

### Phase 5: Bottom Nav
- [ ] Replace existing toolbar
- [ ] 4 main actions (Value, Timeline, Add, More)
- [ ] Active state styling

### Phase 6: Charts
- [ ] Integrate Recharts or Victory
- [ ] Robinhood-style value chart
- [ ] Maintenance cost chart
- [ ] Timeline visualization

---

## Tools & Libraries

### Charts
```bash
npm install recharts
```
- **Why:** React charts library, flexible, Robinhood-style
- **Alt:** Victory (more customizable)

### Gestures
```bash
npm install react-swipeable
```
- **Why:** Smooth swipe gestures

### Number Animation
```bash
npm install react-countup
```
- **Why:** Robinhood-style number ticker

---

## Example Code

### Vehicle Value Hero
```tsx
import { LineChart, Line } from 'recharts';

export function VehicleValueHero({ value, change, history }) {
  const isPositive = change >= 0;
  
  return (
    <div className="rh-value-hero">
      <div className="rh-value-label">Estimated Value</div>
      <div className="rh-value-price">${value.toLocaleString()}</div>
      <div className={`rh-value-change ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? '↑' : '↓'} ${Math.abs(change).toLocaleString()} 
        ({((change / value) * 100).toFixed(1)}%)
      </div>
      
      <LineChart width={300} height={80} data={history} className="rh-spark-chart">
        <Line 
          type="monotone" 
          dataKey="value" 
          stroke={isPositive ? '#00c805' : '#ff5050'} 
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </div>
  );
}
```

### Timeline Item
```tsx
export function TimelineItem({ event }) {
  return (
    <div className="rh-timeline-item">
      <div className="rh-timeline-icon">🔧</div>
      <div className="rh-timeline-content">
        <div className="rh-timeline-header">
          <div className="rh-timeline-title">{event.title}</div>
          <div className="rh-timeline-date">{event.date}</div>
        </div>
        <div className="rh-timeline-desc">{event.description}</div>
        <div className="rh-timeline-meta">
          <span className="rh-cost expense">-${event.cost}</span>
          <span>{event.imageCount} images</span>
        </div>
      </div>
    </div>
  );
}
```

---

## TL;DR

**X-style flow:**
- Vertical feed, not tabs
- Bottom nav, no heavy chrome
- Swipe gestures, thumb-friendly

**Robinhood feel:**
- Dark mode default
- Real-time value like stock price
- Green/red for financial data
- Spark line charts
- Portfolio-style stats

**Cursor aesthetic:**
- Monospace for data
- Code editor layout for specs
- Inline AI insights
- High contrast, technical

**Result:** Professional automotive data platform that feels like trading app for cars.

