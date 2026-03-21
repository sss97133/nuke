# DESIGN BOOK — Chapter 3: Interactions

How every interactive element behaves. The click anxiety elimination model.

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
