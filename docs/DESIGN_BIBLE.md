# NUKE DESIGN BIBLE

> **SUPERSEDED:** This file is now superseded by the [Design Interface Encyclopedia](./library/technical/design-book/README.md) as the canonical implementation reference. This Design Bible remains as the philosophical foundation and source of the three laws. For token values, component specs, violation patterns, and implementation details, refer to the Design Book.

**The interface IS the data topology. Design is end to end.**

---

## THE THREE LAWS

### 1. Every Data Point is a Live Badge

Every piece of data on screen is clickable. Every click explodes into its cluster or collapses back. Nothing is decoration. Nothing is a dead label.

"1991 GMC V3500" is not a title. It's three filters stacked. Click 1991, you see every 1991 vehicle. Click GMC, you see the make cluster. Click V3500, you see the model lineage. Every badge is a portal into its bucket.

- Badges show depth on hover ("1991 · 847 vehicles")
- Click expands an inline preview panel with the top items from that cluster
- Click again or Escape collapses. Parent context preserved.
- Signal depth is visible through density, not decoration. A badge backed by 500 provenance entries looks different from one backed by 3 observations.
- The interface never dead-ends. Every view has outbound connections.

**Component:** `BadgePortal` — the atomic unit. Used everywhere: feed cards, vehicle profile, search results, sub-headers.

### 2. Zero Click Anxiety

With good end-to-end design, you're excited to click. You don't get click anxiety. If a user hesitates before clicking, the design has failed.

- **Every interaction is reversible in place.** Click opens, click closes. No navigation. No page transitions. No context loss.
- **Expand, don't navigate.** Badges explode inline or as layered panels. The parent view stays visible. Escape or click-outside always collapses back.
- **Instant feedback.** Zero loading states visible to the user. Data is either there or the badge shows its depth count so you know what you're about to open. No clicking into void.
- **No dead ends.** Every view has outbound connections. If you drill into "1982" and there are 47 vehicles, each vehicle has badges that lead further. The graph never terminates.
- **Predictable interaction model.** Every badge behaves the same way everywhere. Year badges, make badges, source badges, deal badges — same click behavior, same expand pattern, same collapse behavior. Learn it once, trust it everywhere.
- **Context stacking, not context switching.** Opening a detail doesn't close the list. Opening a sub-cluster doesn't close the parent. The user builds up layers of context and peels them off. Like papers layered on a desk — you can always see the edges of what's underneath.

**The excitement to click comes from trust.** Trust that clicking won't break anything, won't lose anything, won't strand you. The system rewards curiosity instead of punishing it.

### 3. See First, Know Later

The entry point is always the work. Not metadata, not a search result, not a list. The image. You look at it. Then the data layers in as you want it.

- The journey: see → feel → learn → want → discover depth → keep going
- Every step is a click with zero anxiety
- Every step goes deeper
- The system never says "dead end, go back"

---

## VISUAL IDENTITY

### Typography

| Role | Font | Size | Weight | Case | Spacing |
|------|------|------|--------|------|---------|
| Labels | Arial | 8-9px | 700 | ALL CAPS | 0.08-0.12em |
| Body | Arial | 10-11px | 400 | Sentence | default |
| Headings | Arial | 11-14px | 700 | ALL CAPS | 0.04em |
| Data values | Courier New | 10-11px | 700 | as-is | default |
| Data labels | Courier New | 8-9px | 400 | ALL CAPS | 0.06em |

**Only two fonts exist.** Arial for everything human. Courier New for everything machine. No exceptions.

### Color

**Core palette — greyscale:**

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | #f5f5f5 | #1e1e1e | Page background |
| `--surface` | #ebebeb | #252526 | Card/section surfaces |
| `--surface-hover` | #e0e0e0 | #2d2d30 | Hover states |
| `--border` | #bdbdbd | #3e3e42 | Standard borders |
| `--text` | #2a2a2a | #cccccc | Primary text |
| `--text-secondary` | #666666 | #858585 | Secondary text |
| `--text-disabled` | #999999 | #656565 | Disabled/metadata |

**Status colors:**

| Token | Value | Usage |
|-------|-------|-------|
| `--success` | #16825d | Verified, sold, confirmed |
| `--warning` | #b05a00 | Caution, above market |
| `--error` | #d13438 | Critical, overpriced, ending |

**Racing accents — Easter eggs only, never primary UI:**

| Livery | Token | Value |
|--------|-------|-------|
| Gulf Blue | `--gulf-blue` | #6AADE4 |
| Gulf Orange | `--gulf-orange` | #EE7623 |
| Martini Red | `--martini-red` | #C8102E |
| JPS Gold | `--jps-gold` | #C8A951 |
| British Racing Green | `--brg` | #004225 |
| Papaya Orange | `--papaya` | #FF8000 |

### Borders & Surfaces

- **Border width:** 2px for containers, 1px for internal dividers
- **Border radius:** 0px. Always. Enforced globally with `!important`.
- **Box shadow:** None. Enforced globally with `!important`.
- **Gradients:** None. Never.
- **Transitions:** 180ms `cubic-bezier(0.16, 1, 0.3, 1)` for all interactive states

### Spacing

4px base unit. All spacing derives from multiples of 4.

```
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
```

---

## COMPONENT PATTERNS

### BadgePortal

The fundamental building block. A badge that is also a portal into its data cluster.

```
┌─────────────┐
│ 1991  ·847  │  ← hover shows depth count
└─────────────┘
       │
       ▼ click
┌──────────────────────────────┐
│ 1991              847 VEHICLES│
├──────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐       │
│ │ img│ │ img│ │ img│       │
│ │1991│ │1991│ │1991│       │
│ │Fox │ │911 │ │240 │       │
│ └────┘ └────┘ └────┘       │
│ ┌────┐ ┌────┐ ┌────┐       │
│ │ img│ │ img│ │ img│       │
│ └────┘ └────┘ └────┘       │
│              VIEW ALL 847 → │
└──────────────────────────────┘
```

### Feed Card (Grid Mode)

```
┌──────────────────────────┐
│                          │
│       [vehicle image]    │
│   $24,500    [BAT icon]  │
│                          │
├──────────────────────────┤
│ 1991 GMC V3500           │  ← CardIdentity
│ 45,200 mi · Manual · 4WD│  ← CardMeta
│ [STEAL]                  │  ← CardDealScore (BadgePortal)
└──────────────────────────┘
         │
         ▼ click (expand in place)
┌──────────────────────────┐
│       [vehicle image]    │
├──────────────────────────┤
│ 1991 GMC V3500           │
│ 45,200 mi · Manual · 4WD│
│ [STEAL]                  │
├──────────────────────────┤
│ [1991] [GMC] [V3500]    │  ← BadgePortals
│ [MANUAL] [4WD] [STEAL]  │
│ [BAT]                    │
│                          │
│ 45,200 MI · 4WD · ...147│
│                          │
│ CLICK BADGES    [OPEN →] │
└──────────────────────────┘
```

- Single click: expand in place
- Cmd/Ctrl+click: open in new tab
- "OPEN PROFILE →": navigate to full vehicle page
- Escape or click outside: collapse

### Empty States

Every empty state must offer a next action. No dead ends.

| State | Wrong | Right |
|-------|-------|-------|
| No hero image | Black void, "No photo" | Vehicle identity + BadgePortals for every dimension |
| No timeline | "No timeline data" | "Explore [year] [make] vehicles for comparables" |
| No price history | "No history yet" | Explanation of what price data is + how it accumulates |
| No search results | "No results" | Search + Auctions links |
| No feed results | "No vehicles found" | Reset filters + Search + Auctions links |

---

## VOICE

- Max 7 words per label
- Active voice
- Write like a control panel, not a marketing page
- ALL CAPS for labels
- Sentence case for body text only

| DO | DON'T |
|----|-------|
| `1,256,239 VEHICLES` | `Over a million vehicles and counting!` |
| `QUEUE: 872 PENDING` | `Almost there! Just 872 more to go!` |
| `NO TIMELINE DATA` | `Oops! We don't have timeline data yet.` |
| `CLICK BADGES TO EXPLORE` | `Try clicking on the badges above to discover more!` |
| `847 VEHICLES` | `847 results found` |

---

## ANTI-PATTERNS

**Never do:**

- Rounded corners (enforced with `!important`)
- Drop shadows (enforced with `!important`)
- Gradients
- Neon/glowing dark-mode SaaS aesthetic
- Gradient text
- Emoji in labels or badges
- Exclamation marks in UI text
- Title Case in labels (always ALL CAPS)
- `backdropFilter: blur()` on badges
- Navigate away on badge click (always expand in place)
- Loading spinners (show depth count or skeleton)
- Dead-end empty states (always offer next action)
- "Click here" or "Learn more" (badges ARE the interaction)

---

## TECHNICAL REFERENCE

**Canonical CSS:** `nuke_frontend/src/styles/unified-design-system.css`
**Badge system:** `nuke_frontend/src/components/badges/BadgePortal.tsx`
**Panel system:** `nuke_frontend/src/components/panels/DetailPanel.tsx`

**CSS custom properties:** 481 tokens defined in unified-design-system.css covering colors, spacing, typography, layout, accent colorways (15 racing liveries), and chart palette.

**Global enforcement:**
```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

---

*The database IS the vehicle. The interface IS the graph. Design is end to end.*
