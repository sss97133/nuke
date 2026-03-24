# DESIGN BOOK — Chapter 3: Interactions

How every interactive element behaves. The click anxiety elimination model.

**Cross-references:**
- Component specs: [02-components.md](./02-components.md)
- Design tokens: [TOKENS.md](./TOKENS.md)
- Violation patterns: [VIOLATIONS.md](./VIOLATIONS.md)

---

## The Rule

**Every interaction is reversible in place.** If clicking something navigates away, destroys context, or requires the back button — it's a bug.

---

## Badge Click

Every badge (year, make, model, source, deal score, body style, drivetrain, transmission) follows the same pattern everywhere in the app:

```
IDLE          HOVER (200ms)       CLICK              CLICK AGAIN / ESC
┌──────┐     ┌──────────────┐    ┌──────────────┐    ┌──────┐
│ 1991 │ ──→ │ 1991  ·847   │ ──→│ 1991  ·847   │ ──→│ 1991 │
└──────┘     └──────────────┘    │ ┌──────────┐ │    └──────┘
                                  │ │ preview  │ │
                                  │ │  grid    │ │
                                  │ └──────────┘ │
                                  └──────────────┘
```

1. Hover loads depth count (200ms debounce, cached after first load)
2. Click opens inline panel below badge
3. Panel shows 6 preview vehicles + total count
4. Click badge again, Escape, or click outside → collapses
5. Parent context is **never** modified

**This pattern is identical across:**
- Vehicle profile sub-header
- Feed card deal scores
- Feed card expanded view (all dimensions)
- Vehicle hero image empty state
- Any future surface that shows categorized data

---

## Feed Card Click (Grid Mode)

```
IDLE              CLICK                 CLICK OUTSIDE / ESC
┌──────────┐     ┌──────────┐          ┌──────────┐
│  image   │     │  image   │          │  image   │
│  YMM     │ ──→ │  YMM     │    ──→   │  YMM     │
│  specs   │     │  specs   │          │  specs   │
└──────────┘     ├──────────┤          └──────────┘
                 │ [1991]   │
                 │ [GMC]    │  ← BadgePortals
                 │ [STEAL]  │
                 │ specs    │
                 │    OPEN →│
                 └──────────┘
```

- **Single click:** Expand in place. Card border becomes `--text`. Expanded area shows BadgePortals + specs + "OPEN PROFILE →" button.
- **Cmd/Ctrl+click:** Open profile in new tab (browser default behavior).
- **Click on badge/link inside:** Handled by that element (not intercepted by card).
- **"OPEN PROFILE →":** Navigates to full vehicle profile page.
- **Escape or click outside:** Collapse back to original card size.

Gallery and technical views use standard `<Link>` navigation (these are compact modes where expansion doesn't fit).

---

## Empty State Actions

Every empty state must offer at least one next action. The interface never says "nothing here" without saying "but here's where to go."

| State | Next actions |
|-------|-------------|
| No hero image | BadgePortals for year, make, model, body, transmission |
| No timeline events | Suggests exploring comparable vehicles by year/make |
| No price history | Explains what price data is and how it accumulates |
| No search results | Links to Search page + Auctions page |
| No feed results | "Reset filters" button + Search + Auctions links |
| No live auctions | Shows recently ended auctions (last 30 days) |

---

## Keyboard

| Key | Context | Action |
|-----|---------|--------|
| Escape | Badge panel open | Close panel |
| Escape | Card expanded | Collapse card |
| Escape | Detail panel open | Close panel |
| Enter/Space | Badge focused | Toggle panel |
| Cmd/Ctrl+Click | Feed card | Open profile in new tab |

---

## Hover States

| Element | Hover effect | Timing |
|---------|-------------|--------|
| Feed card border | `--border` → `--border-focus` | 180ms cubic-bezier(0.16, 1, 0.3, 1) |
| Badge border | `--border` → `--text-secondary` | 180ms |
| Badge (open) border | stays `--text` | — |
| Badge depth count | appears inline (·847) | 200ms debounce on data fetch |
| Auction card border | `--border` → `--text` | 180ms |
| "OPEN PROFILE →" button | opacity 1 → 0.8 | 180ms |
| Dossier source badges | opacity 0.3 → 1, expand from "Nx" count to full badges | 180ms |

---

## What Never Happens

- A click that navigates away without the user explicitly choosing "OPEN" or Cmd+click
- A panel that opens with no way to close it
- A loading state that shows nothing (always show depth count or skeleton)
- An empty view with no outbound connections
- A badge that behaves differently in different locations
- An animation longer than 180ms

---

## Animation Specifications

Every transition and animation in the design system, with exact values.

### Badge Portal Open

**Trigger:** Click on a BadgePortal element
**Element:** BadgeClusterPanel (positioned absolute below badge)
**Property:** `opacity`
**Duration:** 180ms
**Easing:** `ease-out`
**From:** `opacity: 0`
**To:** `opacity: 1`
**Implementation:** `animation: fadeIn180 180ms ease-out` on BadgeClusterPanel
**Notes:** Panel border is `2px solid var(--text)`. Badge border transitions to `var(--text)` simultaneously.

### Badge Hover

**Trigger:** Mouse enter on BadgePortal
**Element:** Badge border
**Property:** `border-color`
**Duration:** 180ms
**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
**From:** `var(--border)` (idle) or variant border color
**To:** `var(--text-secondary)`
**Notes:** 200ms debounce on depth data fetch. Depth count appears inline after data loads.

### Feed Card Hover

**Trigger:** Mouse enter on CardShell
**Element:** Card border
**Property:** `border-color`
**Duration:** 180ms
**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
**From:** `var(--border)`
**To:** `var(--border-focus)` (which resolves to `var(--text)`)
**Notes:** Applied via JavaScript (`e.currentTarget.style.borderColor`). Resets on mouse leave unless card is expanded.

### Feed Card Expand

**Trigger:** Click on CardShell in grid mode
**Element:** Expanded content area
**Property:** `opacity`
**Duration:** 180ms
**Easing:** `ease-out`
**From:** `opacity: 0`
**To:** `opacity: 1`
**Implementation:** `animation: fadeIn180 180ms ease-out` on expanded content div
**Notes:** Card border simultaneously changes to `var(--text)`. Card `overflow` changes from `hidden` to `visible`. Card `z-index` changes to `10`.

### Route Change

**Trigger:** Navigation via `<Link>` or router
**Element:** Page content
**Property:** None — no page transition animation
**Notes:** Route changes are instant. No fade, no slide, no transition. The interface replaces content immediately. React Suspense fallback is a pixel-perfect skeleton, not a transition.

### Data Loading (Skeleton to Content)

**Trigger:** TanStack Query resolves data
**Element:** Skeleton placeholder to actual content
**Property:** No animation — skeleton is replaced by content in a single render
**Notes:** Skeletons have ZERO animation. No pulse, no shimmer. They are static `var(--surface)` fills. Content appears instantly when data arrives.

### Dropdown Open/Close

**Trigger:** Click on dropdown trigger
**Element:** Dropdown menu
**Property:** `opacity`
**Duration:** 180ms
**Easing:** `ease-out`
**From:** `opacity: 0`
**To:** `opacity: 1`
**Notes:** Close is immediate (no exit animation). Dropdown background: `var(--surface)`. Border: `2px solid var(--border)`.

### Command Input Focus

**Trigger:** Click on header search input or `Cmd+K`
**Element:** Search input border
**Property:** `border-color`
**Duration:** 180ms
**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
**From:** `var(--border)`
**To:** `var(--accent)`
**Notes:** Search overlay appears below with `fadeIn180` animation.

### Toast Notification

**Trigger:** Action completion (save, error, etc.)
**Element:** Toast container
**Property:** `opacity`, `transform`
**Duration:** Controlled by react-hot-toast (override to <=180ms)
**Notes:** Toast must use design system tokens for background, border, text. See Chapter 06.

### Table Row Hover

**Trigger:** Mouse enter on table row
**Element:** Row background
**Property:** `background-color`
**Duration:** 180ms
**Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`
**From:** transparent or `var(--surface)`
**To:** `var(--surface-hover)`

### Tab Switch

**Trigger:** Click on tab
**Element:** Active tab indicator
**Property:** `border-bottom-color`
**Duration:** Instant (no animation on tab indicator change)
**Notes:** Tab content transitions are handled by content replacement, not animation.

### Form Field Focus

**Trigger:** Focus on input/textarea/select
**Element:** Input border
**Property:** `border-color`
**Duration:** Defined by `--transition: 0.12s ease`
**From:** `var(--border)`
**To:** `var(--border-focus)`

---

## The "No Surprise" Rule

Every interaction must have a predictable outcome. The user should never be surprised by what a click, hover, or keyboard action does.

- Hover states ALWAYS precede click states visually (the user sees the hover change before they decide to click)
- Every clickable element shows `cursor: pointer` on hover
- Every destructive action requires explicit confirmation (modal or inline confirm)
- Every navigation action updates the URL (deep-linkable state)
- No auto-playing animations or transitions (the user initiates all motion)

---

## Keyboard Navigation

### Global

| Key | Action |
|-----|--------|
| `Cmd+K` / `Ctrl+K` | Focus command input in header |
| `Escape` | Close any open panel, modal, dropdown, or expanded card |

### Badge Portals

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next badge |
| `Enter` / `Space` | Toggle badge panel open/close |
| `Escape` | Close open panel |

### Feed Cards (Grid Mode)

| Key | Action |
|-----|--------|
| `Tab` | Move to next card |
| `Enter` | Expand/collapse card (equivalent to click) |
| `Escape` | Collapse expanded card |

### Dropdowns and Menus

| Key | Action |
|-----|--------|
| `Arrow Down` | Move to next item |
| `Arrow Up` | Move to previous item |
| `Enter` | Select current item |
| `Escape` | Close dropdown |

### Tab Order

Visual left-to-right, top-to-bottom. Interactive elements within a card are reachable via Tab. Badge portals within an expanded card are in the tab order after the card's main content.
