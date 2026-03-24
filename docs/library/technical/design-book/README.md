# NUKE DESIGN INTERFACE ENCYCLOPEDIA

**The canonical implementation reference for the nuke.ag interface.**

This is not a style guide. Not a mood board. Not a set of suggestions. This is an engineering specification. Every visual decision, every component behavior, every token value, every violation pattern is documented here. After reading this, there is no ambiguity.

---

## THE THREE ABSOLUTE RULES

```
NO border-radius.  NO box-shadow.  NO hardcoded hex colors.

These are enforced by !important CSS and ESLint.
They are not negotiable. They are not oversights.
They are not "to be revisited later."
```

---

## THE THREE DESIGN LAWS

**1. Every Data Point is a Live Badge.** Every piece of data on screen is clickable. Every click explodes into its cluster or collapses back. Nothing is decoration. Nothing is a dead label.

**2. Zero Click Anxiety.** Every interaction is reversible in place. Click opens, click closes. No navigation. No page transitions. No context loss. The system rewards curiosity instead of punishing it.

**3. See First, Know Later.** The entry point is always the work — the image, the vehicle, the data. You look at it. Then the data layers in as you want it.

---

## QUICK-REFERENCE DESIGN TOKENS

The 10 most used tokens. Complete reference in [TOKENS.md](./TOKENS.md).

```
--bg:             #f5f5f5 / #1e1e1e     Page background
--surface:        #ebebeb / #252526     Card/component background
--border:         #bdbdbd / #3e3e42     Default borders
--text:           #2a2a2a / #cccccc     Primary text
--text-secondary: #666666 / #858585     Secondary text
--font-family:    Arial, sans-serif     All human text
--font-mono:      'Courier New', mono   All machine data
--fs-8:           8px                   ALL CAPS labels
--fs-10:          10px                  Standard body text
--space-1:        4px                   Base spacing unit
```

---

## HOW TO USE THIS ENCYCLOPEDIA

| Task | Read These |
|------|-----------|
| Building a new component | [01-foundations](./01-foundations.md), [02-components](./02-components.md), [TOKENS](./TOKENS.md) |
| Building a new screen | [04-screens](./04-screens.md), [07-finder-model](./07-finder-model.md), [02-site-architecture](./02-site-architecture.md) |
| Fixing a design violation | [VIOLATIONS](./VIOLATIONS.md) first, then the relevant chapter |
| Adding a third-party library | [06-third-party](./06-third-party.md) |
| Working on dark mode | [08-dark-mode](./08-dark-mode.md), [TOKENS](./TOKENS.md) |
| Understanding interaction patterns | [03-interactions](./03-interactions.md) |
| Understanding the header | [05-the-header](./05-the-header.md) |

---

## TABLE OF CONTENTS

### [01 — Foundations](./01-foundations.md)
The philosophy behind every visual decision. Why Arial. Why Courier New. Why 8-11px. Why zero border-radius. Why zero shadow. Why 4px spacing. Why greyscale. Why racing accents as Easter eggs. The Bloomberg Terminal inheritance. The Win95 lineage. The transition speed. The enforcement philosophy. Each rule cross-referenced to its CSS token, ESLint rule, and violation entry.

### [02 — Components](./02-components.md)
Every reusable component specified. BadgePortal (the atomic unit), BadgeClusterPanel, useBadgeDepth, CardShell, CardImage, CardDealScore, CardSource, FeedStatsStrip, FeedEmptyState, ResilientImage, DetailPanel. Props, behavior, composition patterns, CSS tokens used, common violations. Component-to-file mapping table.

### [02 — Site Architecture](./02-site-architecture.md)
Every page in the application. The three entity types (Vehicle, User, Organization). Page hierarchy (Tier 1-5). The Vehicle Profile in detail (8,000+ lines, 14 components). Shared component taxonomy. Derivative page mapping. Component count summary.

### [03 — Interactions](./03-interactions.md)
How every interactive element behaves. Badge click model. Feed card click model. Empty state actions. Keyboard navigation. Hover states with exact timing values. Animation specifications for every transition (badge open, card expand, route change, data loading, dropdown, command input focus, toast, table row hover, tab switch, form field focus). The "No Surprise" rule. What never happens.

### [04 — Screens](./04-screens.md)
**Every screen, every state.** Home/Hub, Vehicle Profile, Feed/Discovery, Search, Browse, Auction Marketplace, Profile, Organization Profile, Add Vehicle, and all remaining pages. For each: route, file, layout spec, loaded/empty/loading/error states, component inventory. Universal screen rules. Route-to-screen mapping table.

### [05 — The Header](./05-the-header.md)
The persistent navigation bar. Three zones: identity (NUKE wordmark), command input, session (user capsule). Exact CSS token reference for every element. Responsive behavior. Dark mode behavior. Context notation. Command input behavior (text, URL, VIN, YMM, natural language, dragged image). Sub-context pattern (breadcrumbs, vehicle tabs). Anti-patterns.

### [06 — Third-Party Components](./06-third-party.md)
Override patterns for every third-party library. Recharts (chart colors, tooltip, legend). Headless UI (unstyled but watch for agent-added violations). Radix UI. Leaflet/MapLibre (allowlisted canvas, override controls). Three.js/Deck.gl (canvas, allowlisted). React Hot Toast (token overrides). Lucide React (icon rules). React Router, TanStack Query, React Markdown, Vite. Global override strategy. New library checklist.

### [07 — Finder Model](./07-finder-model.md)
The product architecture and its design implications. Every element earns its presence. Hierarchy through density, not decoration. The interface feels inevitable. The badge is the fundamental unit. Anti-vanity metrics. The multi-surface model (web, MCP, CLI, extension, embeds). Screen architecture principles.

### [08 — Dark Mode](./08-dark-mode.md)
Complete dark mode token mapping (every token, light and dark values, delta). How dark mode is applied (`[data-theme="dark"]` attribute). The four dark mode rules. High contrast modes (light and dark). Greyscale mode. Third-party dark mode handling. Testing checklist.

### [TOKENS.md](./TOKENS.md)
**Every CSS variable in the design system.** Font scale, font sizes, typography, backgrounds, text, borders, accents, status colors, spacing, layout, chart palette, heatmap, racing accent colorways (22 colorways), contrast profiles, semantic aliases, grey scale aliases, button system, card system, input system, animation, z-index scale.

### [VIOLATIONS.md](./VIOLATIONS.md)
**The anti-pattern lookup table.** 20 violation patterns (V-01 through V-20). For each: temptation, symptom, impact, detection method, fix. ESLint rule reference table. Changelog.

---

## DESIGN VOCABULARY GLOSSARY

**Badge Portal:** The fundamental UI primitive. A rectangle showing a data point (label + value) that, when clicked, opens a depth-appropriate panel showing more context. Not a label. Not a chip. A portal.

**Badge Depth:** The depth level of a badge portal indicating how much data backs the displayed value. Hover shows count; click shows preview grid.

**Signal:** A piece of information about a vehicle derived from a source (listing, document, event, sensor). Signals are the raw inputs to provenance calculations.

**Provenance:** The documented history of a vehicle's ownership, condition, modifications, and events. The core product.

**Feed Card:** The card unit in list/feed views. Shows a vehicle summary with its top signals visible as badges.

**Finder Model:** The product mental model: the primary interaction is finding and exploring data. Everything is a search result.

**Surface:** In design token context, the background color for elevated components (cards, panels). `var(--surface)` is `#ebebeb` (light) / `#252526` (dark).

**Session Zone:** The header area showing user session state: avatar, notification dot.

**Command Input:** The search/command bar in the header. The primary navigation affordance. Accepts text, URLs, VINs, YMM, natural language, dragged images.

**4px Grid:** The spacing system. All margins, padding, and layout measurements are multiples of 4px.

**ALL CAPS Labels:** The label style for column headers, category labels, classification text. 8-9px, Arial, letter-spacing 0.08em, `var(--text-secondary)` color, `text-transform: uppercase`.

**Dead End Empty State:** An anti-pattern. An empty state showing "no data" with no action offered. Explicitly forbidden.

**Zero Click Anxiety:** Design Law 2. Every interaction is reversible in place. Click opens, click closes. The system rewards curiosity.

**See First, Know Later:** Design Law 3. Show the data first. Explain it on demand.

**Every Data Point is a Live Badge:** Design Law 1. Every piece of data is displayable as a badge portal wired to its source and depth.

---

## SUPERSESSION NOTICE

This Design Book supersedes `docs/DESIGN_BIBLE.md` as the canonical design reference. The Design Bible remains for philosophical context and the three laws, but for implementation specifications, this encyclopedia is the single source of truth.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-24 | Design Interface Encyclopedia created. TOKENS.md, VIOLATIONS.md, 04-screens.md, 06-third-party.md, 07-finder-model.md, 08-dark-mode.md written. All existing chapters (01, 02, 02-arch, 03, 05) updated with cross-references, CSS token references, and expanded specifications. README replaced with comprehensive index. |
| 2025-10-21 | Original design-book chapters created (01-foundations, 02-components, 03-interactions, 05-the-header). |

---

*The database IS the vehicle. The interface IS the graph. Design is end to end.*
