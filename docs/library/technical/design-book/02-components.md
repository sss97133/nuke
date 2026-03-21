# DESIGN BOOK — Chapter 2: Components

Every reusable frontend component. What it does, what props it takes, how it composes with other components.

---

## BadgePortal

**File:** `nuke_frontend/src/components/badges/BadgePortal.tsx`
**The atomic unit of the end-to-end design.** Every data point that appears as a badge is a BadgePortal.

### Behavior

1. **Idle:** Renders as a standard badge (8px, ALL CAPS, 700 weight, 1px border)
2. **Hover:** Fires `useBadgeDepth` after 200ms debounce. Shows depth count inline: `1991 ·847`
3. **Click:** Expands `BadgeClusterPanel` inline below the badge. Panel shows header (label + count), 3x2 preview grid of top vehicles, "VIEW ALL →" footer.
4. **Click again / Escape / click-outside:** Collapses. Parent context unchanged. Zero navigation.
5. **Cmd/Ctrl+click:** No special behavior (badges don't navigate).

### Props

```typescript
interface BadgePortalProps {
  dimension: 'year' | 'make' | 'model' | 'source' | 'deal_score' | 'status' | 'body_style' | 'drivetrain' | 'transmission';
  value: string | number | null;
  label: string;
  variant?: 'default' | 'deal' | 'source' | 'status' | 'mileage' | 'price';
  bg?: string;           // override background
  color?: string;        // override text color
  borderColor?: string;  // override border
  tooltip?: string;      // shown before depth loads
  static?: boolean;      // disable portal behavior, render as plain badge
}
```

### Composition

BadgePortal is used inside:
- `VehicleSubHeader` — YMM badges (year, make, model, trim)
- `CardDealScore` — deal score pills (STEAL, GREAT DEAL, etc.)
- `VehicleCard` expanded view — all dimension badges
- `VehicleHeroImage` — no-photo empty state shows badges for exploration

### Dependencies

- `useBadgeDepth` hook (lazy data fetch)
- `BadgeClusterPanel` (the expand panel)

---

## BadgeClusterPanel

**File:** `nuke_frontend/src/components/badges/BadgeClusterPanel.tsx`
**The expand panel that appears when a BadgePortal is clicked.**

### Behavior

- Positioned absolute below the badge (`top: calc(100% + 4px)`)
- 320-480px wide, 2px solid border in `--text` color
- Header: label + vehicle count
- Body: 3-column grid of vehicle thumbnails (4:3 aspect, image + YMM + price)
- Footer: "VIEW ALL X →" when count exceeds preview
- Closes on Escape, click-outside, or parent badge re-click
- Each preview item is a `<Link>` to the vehicle profile (click stops propagation so it doesn't collapse the panel)

### Props

```typescript
interface BadgeClusterPanelProps {
  label: string;
  count: number;
  preview: BadgePreviewItem[];
  loading?: boolean;
  onClose: () => void;
}
```

---

## useBadgeDepth

**File:** `nuke_frontend/src/components/badges/useBadgeDepth.ts`
**Lazy-loads cluster depth and preview items.**

- Queries Supabase: count (exact, head-only) + top 6 vehicles (by feed_rank_score, with images)
- 200ms hover debounce via `setTimeout` in BadgePortal
- Result cache (`Map<string, BadgeDepthData>`) — repeated hovers are instant
- Resets if `value` changes

```typescript
function useBadgeDepth(dimension: BadgeDimension, value: string | number | null)
  → { data: BadgeDepthData | null, loading: boolean, load: () => void }
```

---

## CardShell

**File:** `nuke_frontend/src/feed/components/card/CardShell.tsx`
**The outer wrapper for all feed cards.**

### Grid Mode (click-to-expand)

- **Single click:** Toggles expanded state. Card grows to show `expandedContent`.
- **Cmd/Ctrl+click:** Opens vehicle profile in new tab.
- **Click on links/buttons/badges inside:** Propagates normally (not intercepted).
- **Expanded state:** Border becomes `--text`. Expanded content area appears below card body with `--bg` background.
- **Collapse:** Click outside the card, press Escape, or click the card body again.
- Default expanded content: "CLICK BADGES TO EXPLORE" label + "OPEN PROFILE →" button.

### Gallery / Technical Mode

- Wraps in `<Link to={/vehicle/:id}>` — standard navigation (these are compact views where inline expansion doesn't make sense).

### Props

```typescript
interface CardShellProps {
  vehicleId: string;
  viewMode: 'grid' | 'gallery' | 'technical';
  children: ReactNode;
  expandedContent?: ReactNode;  // shown when expanded (grid mode)
  style?: CSSProperties;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}
```

---

## ResilientImage

**File:** `nuke_frontend/src/components/images/ResilientImage.tsx`
**Image component with automatic fallback chain.**

### Fallback sequence

1. Try optimized URL (CDN resize via `optimizeImageUrl`)
2. Try original URL
3. Try next source in `sources[]` array
4. If all sources fail: show "IMAGE UNAVAILABLE" state (small logo at 15% opacity + label)

### Key behaviors

- `IntersectionObserver` with 1000px rootMargin — images start loading before they enter viewport
- `onLoad` checks `naturalWidth === 0` (some broken URLs fire onLoad with zero-size image)
- `onError` advances to next source
- Failed state renders a structured placeholder instead of a faint ghost logo

---

## CardImage

**File:** `nuke_frontend/src/feed/components/card/CardImage.tsx`
**Vehicle thumbnail with overlays (price, source, auction timer, rank score).**

### No-image handling

When `thumbnailUrl` is null and `viewMode === 'grid'`, renders `NoImageBlock` — a spec card showing:
- Vehicle name (YMM)
- Price (if available)
- Spec chips (body style, transmission, drivetrain, mileage)
- "NO PHOTO" label

This ensures cards without images still communicate useful data instead of being blank rectangles.

---

## DetailPanel

**File:** `nuke_frontend/src/components/panels/DetailPanel.tsx`
**Slide-in overlay panel for context stacking.**

### Behavior

- Slides in from right (180ms animation)
- 560px wide (90vw max on mobile)
- 25% opacity backdrop — feed visible underneath
- Body scroll locked while open, restored to exact position on close
- Escape or backdrop click closes
- Sticky header with "OPEN FULL PROFILE →" link + ESC button

### Status

Foundation component. Not yet wired to feed cards — requires lazy-loaded vehicle profile content to be useful. The CardShell "OPEN PROFILE →" currently uses standard `<Link>` navigation.

---

## CardDealScore

**File:** `nuke_frontend/src/feed/components/card/CardDealScore.tsx`
**Deal and heat score indicator pills.**

Deal score pills are `BadgePortal` instances — clicking "STEAL" expands to show all vehicles with `deal_score_label = 'plus_3'`.

Heat score pills are static badges (no meaningful cluster to expand into).

### Deal score config

| Label | Value | Background | Tooltip |
|-------|-------|-----------|---------|
| STEAL | plus_3 | #16825d | Price significantly below comparable vehicles |
| GREAT DEAL | plus_2 | #16825d | Price well below market average |
| GOOD DEAL | plus_1 | #2d9d78 | Price below market average |
| FAIR | fair | transparent | Price in line with market |
| ABOVE MARKET | minus_1 | #b05a00 | Price above market average |
| OVERPRICED | minus_2 | #d13438 | Price well above comparable vehicles |
| WAY OVER | minus_3 | #d13438 | Price significantly above market |

---

## CardSource

**File:** `nuke_frontend/src/feed/components/card/CardSource.tsx`
**Source favicon + platform label in the image overlay.**

Positioned absolute in bottom-left of image area. Shows favicon (14px) + platform shortcode (7px, white on dark background pill).

Platform labels: BAT, C&B, CL, KSL, FB MARKET, CLASSIC, HEMMINGS, MECUM.

Not a BadgePortal (lives inside `overflow: hidden` image container — dropdown would be clipped). Source exploration happens through BadgePortals in the expanded card view.

---

## FeedStatsStrip

**File:** `nuke_frontend/src/feed/components/FeedStatsStrip.tsx`
**Sticky stats bar above the feed.**

Shows: VEHICLES (or SHOWN X / Y when filtered), VALUE, TODAY (+N), FOR SALE, LIVE auctions. Inline search field right-aligned. CLEAR button when filters active.

Injected into the `AppHeader` toolbar slot via `useAppLayoutContext`.
