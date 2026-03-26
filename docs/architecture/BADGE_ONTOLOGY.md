# Badge Ontology — Every Badge Is a Data Portal

## The Rule

If it looks like a badge, it IS a button. If it's a button, it opens data.
No dead badges. No decorative badges. No badges that just repeat the title.

---

## Three Badge Types

### 1. DIMENSION BADGE (navigational)
Opens a popup or filters the feed to explore that dimension.

| Badge | Shows | On Click | Example |
|-------|-------|----------|---------|
| MAKE | Make name | MakePopup (median price, top models, price range) | `PORSCHE` |
| MODEL | Model name | ModelPopup (price range, recent sales) | `911` |
| YEAR | Year | Feed filter to that year | `1973` |
| BODY | Body style | Feed filter to that body | `COUPE` |
| SOURCE | Platform abbreviation | SourcePopup (fill rates, top makes) | `BAT` |
| DRIVE | Drivetrain | Feed filter | `4WD` |
| TRANS | Transmission | Feed filter | `MANUAL` |

**Look:** `var(--surface)` bg, `var(--border)` border, 2px solid, 8px Courier New UPPERCASE

### 2. METRIC BADGE (data display + portal)
Shows a number. Click opens deeper data about that metric.

| Badge | Shows | On Click | Example |
|-------|-------|----------|---------|
| PRICE | Sale/asking price | PriceContextPopup (estimate, comps, vs median) | `$47,500` |
| ESTIMATE | Nuke estimate | PriceContextPopup | `$57,000` |
| BIDS | Bid count | BidsPopup (bid history) | `8` |
| COMMENTS | Comment count | CommentsPopup (scrollable list) | `247` |
| WATCHERS | Watcher count | WatchersPopup (vs average) | `3,379` |
| IMAGES | Photo count | Image gallery popup | `76` |
| MILEAGE | Odometer reading | Mileage context (vs average for model) | `23,000 MI` |
| DEAL SCORE | Deal percentage | Deal context (price vs comps) | `87%` |
| HEAT | Heat score | Heat context (what's driving attention) | `HOT` |

**Look:** `var(--bg)` bg, `var(--border)` border, label 7px UPPERCASE, value 11px Courier New BOLD

### 3. STATUS BADGE (state indicator)
Shows current state. Click goes to source or relevant action.

| Badge | Shows | On Click | Example |
|-------|-------|----------|---------|
| LIVE | Auction is active | Link to auction page | `■ LIVE` (green dot) |
| SOLD | Auction completed | PriceContextPopup | `SOLD` (green text) |
| FOR SALE | Active listing | Link to listing | `FOR SALE` |
| ENDS | Time remaining | Link to auction | `ENDS 1D 12H` |
| VERIFIED | Data verified | FieldProvenanceDrawer | `✓ VERIFIED` |
| VIEWED | User has seen this | View history popup | `VIEWED` |

**Look:** No background, `var(--text-secondary)` text, status-specific color for the indicator only

---

## What Badges Are NOT

- NOT decorative labels (if it says COUPE and clicking does nothing, remove it)
- NOT title repetitions (year + make + model badges below a title that says "1973 PORSCHE 911" is redundant)
- NOT emoji containers (no lock, eye, checkmark emojis)
- NOT platform branding (no "Bring a Trailer" text, just "BAT" abbreviation)
- NOT average prices (never)

---

## Badge Sizing

| Context | Label Size | Value Size | Padding | Border |
|---------|-----------|------------|---------|--------|
| Feed card | 7px | 9px | 2px 4px | 2px solid var(--border) |
| Profile header | 8px | 11px | 4px 8px | 2px solid var(--border) |
| Popup content | 7px | 9px | 2px 6px | 2px solid var(--border) |
| Hero panel | 8px | 10px | 4px 8px | 2px solid var(--border) |

All: zero border-radius. Courier New for values. Arial for labels. UPPERCASE labels.

---

## Badge Interaction States

```
DEFAULT:    bg: var(--surface)   border: var(--border)    text: var(--text)
HOVER:      bg: var(--surface)   border: var(--text)      text: var(--text)
ACTIVE:     bg: var(--text)      border: var(--text)      text: var(--bg)
DISABLED:   bg: var(--bg)        border: var(--border)    text: var(--text-disabled)
```

Transition: 150ms ease on border-color and background-color.
Cursor: pointer (always — every badge is clickable).

---

## Implementation

One component: `<Badge dimension="make" value="PORSCHE" onClick={...} />`

Props:
- `dimension`: which ontology dimension this badge represents
- `value`: the display value
- `count?`: optional count (shown as secondary text)
- `onClick`: handler (popup, filter, or link)
- `size`: 'sm' | 'md' | 'lg' (maps to sizing table above)
- `variant`: 'dimension' | 'metric' | 'status'
- `status?`: 'live' | 'sold' | 'for_sale' | 'verified' | 'viewed' (for status badges)

Every badge in the codebase should eventually use this single component.
No more ad-hoc styled divs with cursor:pointer.

---

## Audit Checklist

Before shipping any page, verify:
- [ ] Every element that looks clickable IS clickable
- [ ] Every badge opens useful data (not a dead end)
- [ ] No badge repeats information already visible in the title/header
- [ ] No badge shows "average price"
- [ ] No badge uses emoji
- [ ] All badges use the 3-state interaction (default/hover/active)
- [ ] All values in Courier New, all labels in Arial
- [ ] Zero border-radius on all badges
