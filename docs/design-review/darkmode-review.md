# Dark Mode Audit

**Date:** 2026-04-05
**Scope:** Full frontend codebase (`nuke_frontend/src/`)
**Verdict:** Infrastructure is excellent. Execution is roughly 40-50% complete. The remaining work is mechanical but large.

---

## Executive Summary

The dark mode *system* is one of the most sophisticated parts of the codebase. It has:
- A proper ThemeContext with auto/system/time-schedule modes
- A complete CSS variable token layer with dark mode overrides
- A Tailwind compat layer that remaps ~44% of Tailwind color utilities
- Vehicle profile-specific dark tokens (`--vp-*` namespace)
- Contrast profiles (standard/greyscale/high) for both themes
- 22 automotive accent colorways that work in both themes
- A live debug/specimen panel (`AppearanceSpecimen.tsx`) with contrast ratio checking

The problem is not architecture. The problem is that hundreds of components bypass the system entirely by using hardcoded hex colors in inline styles and Tailwind utility classes.

---

## What Works (the 40-50% that's theme-aware)

### Token System: Complete
- `unified-design-system.css` defines 90+ CSS variables in `:root[data-theme="light"]` and matching overrides in `:root[data-theme="dark"]`
- Core tokens (`--bg`, `--surface`, `--text`, `--border`, `--accent`) plus extended tokens (`--bg-secondary`, `--surface-elevated`, `--info`, `--link`, etc.)
- Semantic aliases (`--danger`, `--primary`, `--card-bg`, `--input-bg`, etc.) resolve to canonical tokens
- Legacy grey aliases (`--grey-50` through `--grey-900`) are properly remapped in dark mode
- Chart palette has lighter variants for dark backgrounds
- Heatmap tokens have dark mode variants

### Infrastructure Components: Theme-Aware
- **AppHeader.css** — uses `var(--surface)`, `var(--border)`, `var(--text)` throughout, has explicit `data-theme="dark"` override for border width
- **Body/HTML/root** — `index.css` sets `background: var(--bg)` on html, body, #root, .app-layout, .main-content
- **Design system buttons** (`.btn-utility`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`, `.btn-tag`) — all use CSS variables
- **Design system cards** (`.card`, `.card-header`, `.card-body`) — all use CSS variables
- **Design system inputs** — all form elements use `var(--bg)`, `var(--text)`, `var(--border)`
- **Vehicle profile tokens** — `vehicle-profile.css` has a complete dark mode block with `--vp-bg`, `--vp-surface`, `--vp-ink`, `--vp-pencil`, `--vp-ghost`, `--vp-row-alt`
- **Landing page CSS** — uses CSS variables throughout (`var(--bg)`, `var(--text)`, `var(--border)`, etc.)
- **Mobile bottom nav** — uses CSS variables

### Tailwind Compat Layer: Partial
- `index.css` remaps 27 Tailwind utility classes in dark mode (bg-white, bg-gray-*, text-black, text-gray-*, border-gray-*)
- `tailwind-design-system-overrides.css` remaps ~50 more Tailwind classes to CSS variables (bg-white, bg-gray-*, bg-blue-*, bg-green-*, bg-red-*, bg-purple-*, text-*, border-*)
- Per audit note in index.css: **4,765 Tailwind color utility instances exist; 2,084 (44%) are covered by the compat layer; 2,681 (56%) are NOT**

### Components Using `useTheme()`: 5
Only 5 components import and use the theme hook directly:
1. `ThemeContext.tsx` (provider itself)
2. `AppearanceSpecimen.tsx` (settings panel)
3. `StorefrontThemeWrapper.tsx`
4. `UserDropdown.tsx`
5. `ProfileBalancePill.tsx`

---

## What Does Not Work (the 50-60% that breaks in dark mode)

### Category 1: Hardcoded Hex in Inline Styles (Worst Offender)

**~1,420 hardcoded hex color values across 200+ TSX/JSX/TS files.**

Some of these are CSS variable fallbacks (e.g., `var(--text, #2a2a2a)`) which is fine. But the majority are raw hex with no variable reference.

**Worst offenders by file (raw hardcoded hex count):**

| File | Hex Count | Notes |
|------|-----------|-------|
| `WorkOrderStatement.tsx` | 186 | Entire page is hardcoded — a printed repair order with fixed light palette |
| `VehiclePopup.tsx` | 63 | All light-mode hex: `#1a1a1a`, `#666`, `#ccc`, `#999` |
| `GarageVehicleCard.tsx` | 58 | Uses var() with fallbacks — actually mostly OK |
| `MakePopup.tsx` | 36 | `#1a1a1a`, `#666`, `#ccc`, `#e0e0e0` throughout |
| `WiringDetailPanel.tsx` | 35 | Wiring diagram colors |
| `WiringOverlaySandbox.tsx` | 27 | Wiring system rendering |
| `SourcePopup.tsx` | 27 | Same popup pattern |
| `ModelPopup.tsx` | 26 | Same popup pattern |
| `AIDataIngestionSearch.tsx` | 26 | Hardcoded dark text on assumed light bg |
| `PopupContainer.tsx` | 24 | Background, border, text all hardcoded |
| `PriceContextPopup.tsx` | 21 | Same popup pattern |
| `CommentsPopup.tsx` | 20 | Same popup pattern |
| `AuctionTrendsDashboard.tsx` | 20 | Chart/dashboard colors |
| `WatchersPopup.tsx` | 18 | Same popup pattern |
| `BidsPopup.tsx` | 19 | Same popup pattern |
| `HarnessCanvasEdge.tsx` | 19 | Wiring diagram rendering |

**Popup subsystem:** 254 hardcoded hex values across 9 popup files vs only 19 CSS variable references. The entire popup system is dark-mode-blind.

### Category 2: Tailwind Color Utilities Without Dark Mode Coverage

**2,681 uncovered Tailwind color utility instances** (56% of total).

The compat layer covers grayscale (bg-white, bg-gray-*, text-gray-*, border-gray-*) but does NOT cover:

- `bg-blue-*` beyond 50/100/500-900 — partial
- `bg-green-*` — partial
- `bg-red-*` — partial
- `bg-yellow-*` — NOT covered
- `bg-indigo-*` — NOT covered
- `bg-pink-*` — NOT covered
- `bg-orange-*` — NOT covered
- `text-blue-*` — partial
- `text-green-*` — partially
- `text-red-*` — partially
- `text-yellow-*` — NOT covered
- `text-indigo-*` — NOT covered

**Colorful Tailwind usage counts (NOT remapped for dark mode):**
- ~222 instances of `bg-blue/green/red/yellow/purple/indigo/pink/orange-*` in TSX
- ~305 instances of `text-blue/green/red/yellow/purple/indigo/pink/orange-*` in TSX
- ~996 instances of `bg-white/gray/black, text-white/gray/black, border-gray-*` — most are covered by compat layer

### Category 3: `rgba()` Hardcoded Values in TSX

**~116 instances across 50+ files** of inline `rgba()` with hardcoded values (e.g., `rgba(0, 0, 0, 0.5)`, `rgba(255, 255, 255, 0.8)`).

These are typically overlay/modal backdrops that would need to be `var(--overlay)` or similar.

### Category 4: SVG Fill/Stroke Hardcoded

**~35 instances** across 14 files of `fill="#xxx"` or `stroke="#xxx"` in inline SVG. Mostly in the wiring system components.

### Category 5: CSS Hardcoded Colors Outside the Design System

- `design-system.css` (legacy, frozen) — 262 hex color instances. Has its own `data-theme="dark"` block but duplicates the unified system
- `vehicle-profile.css` — 69 hex instances (mostly in the token definitions themselves, which is correct, but also `::selection { background: #1a1a1a; color: #fff; }` which doesn't adapt to dark mode)
- `tailwind-design-system-overrides.css` — 43 hex instances (fallback values in `var()` — acceptable)
- `AppHeader.css` — 2 hex instances (the notification badge `#E4002B` and dropdown badge — doesn't change in dark mode, which is intentional for a red badge)

### Category 6: Missing Dark Mode Adaptations

**`mark` element:** Hardcoded `background-color: #fef08a; color: #000` in `design-system.css` with no dark mode override. Search highlights will be bright yellow on dark backgrounds.

**`::selection`:** Hardcoded `background: #1a1a1a; color: #fff` in vehicle-profile.css. In dark mode, selection would be dark-on-dark (nearly invisible since bg is already dark).

**Scrollbar colors:** `scrollbar-color: #ddd transparent` hardcoded in design-system.css. Vehicle profile uses `var(--vp-ghost)` which is correct.

**Third-party chart libraries:** Recharts is used in ~20 files. Chart colors are typically hardcoded in component props (fill, stroke colors). The design system provides `--chart-*` tokens that have dark variants, but components don't always use them.

---

## Effort Estimate

### Tier 1: Quick Wins (1-2 days, high impact)

1. **Fix `mark` element dark mode** — add `:root[data-theme="dark"] mark { background-color: rgba(234, 179, 8, 0.3); color: var(--text); }`
2. **Fix `::selection` in vehicle-profile.css** — use `var(--text)` / `var(--bg)` or appropriate tokens
3. **Fix scrollbar colors** in design-system.css — use CSS variables
4. **Extend Tailwind compat layer** — add the missing colored utilities (yellow-*, indigo-*, pink-*, orange-*) to index.css dark mode block. ~30 lines of CSS.
5. **Fix AppHeader badge** — the `#E4002B` badge color is arguably intentional (notification dot), but the dropdown badge `color: white` should use a variable

### Tier 2: Systematic Popup Fix (2-3 days)

The entire popup subsystem (9 files, 254 hardcoded values) follows one pattern. A single developer could convert all popups to use `var(--vp-ink)`, `var(--vp-pencil)`, `var(--vp-ghost)`, `var(--vp-surface)` tokens in a focused sprint. These are the most visible dark-mode failures since popups overlay the page.

Files: `VehiclePopup.tsx`, `PopupContainer.tsx`, `MakePopup.tsx`, `ModelPopup.tsx`, `SourcePopup.tsx`, `PriceContextPopup.tsx`, `WatchersPopup.tsx`, `BidsPopup.tsx`, `CommentsPopup.tsx`

### Tier 3: Component-by-Component Migration (5-10 days)

Convert the remaining ~200 component files from hardcoded hex/Tailwind colors to CSS variables. This is mechanical: find `#1a1a1a` -> `var(--text)`, `#666` -> `var(--text-secondary)`, `#ccc` -> `var(--border)`, `#e0e0e0` -> `var(--surface-hover)`, etc.

The mapping is well-established:
- `#1a1a1a`, `#2a2a2a`, `#333` -> `var(--text)`
- `#666`, `#666666` -> `var(--text-secondary)`
- `#999` -> `var(--text-disabled)`
- `#bbb`, `#bdbdbd`, `#ccc` -> `var(--border)`
- `#ddd`, `#e0e0e0` -> `var(--surface-hover)`
- `#eee`, `#ebebeb` -> `var(--surface)`
- `#f5f5f5`, `#fafafa` -> `var(--bg)`
- `#fff`, `#ffffff` -> `var(--surface-elevated)`

### Tier 4: Special Cases (3-5 days)

- **WorkOrderStatement.tsx** (186 hex values) — This is a print-formatted repair order. It may intentionally need a fixed light palette for PDF/print output. Needs design decision: should it honor dark mode or always print light?
- **Wiring system** (~80 hex values across 6 files) — Diagram colors may be semantic (wire colors), not theme-related. Needs individual assessment.
- **Chart components** (~20 files using Recharts) — Need to read `--chart-*` CSS variables at render time and pass them as props
- **Map components** (ChoroplethMap, NukeMap, EventMap) — Mapbox/Leaflet have their own dark mode systems that need to be synchronized

### Tier 5: Legacy Cleanup (ongoing)

- Retire `design-system.css` completely (marked as frozen, but still imported by 30+ components)
- Remove Tailwind color utilities from components as they're migrated to CSS variables
- Reduce the compat layer as components are fixed

---

## Architecture Grade: A-
## Execution Grade: D+

The token system, theme context, auto-switching, accent colorways, contrast profiles, and Tailwind compat layer are all well-designed. The gap is purely in component adoption. The foundation is there — it just hasn't been applied consistently.

**Rough overall dark mode compliance: ~40-45%**
- Infrastructure/shell: 95% (header, body, layout, design system classes)
- Vehicle profile CSS layer: 85% (has dark tokens, but some components inside it use hardcoded colors)
- Popup subsystem: ~7% (254 hardcoded vs 19 variable uses)
- General components: ~35% (mix of Tailwind compat coverage and hardcoded inline styles)
- Charts/visualization: ~20% (chart tokens exist but aren't consistently used)
- Print/statement pages: 0% (intentionally light, needs design decision)

---

## Recommendations

1. **Do not add more compat layers.** The Tailwind compat approach (dark-mode-remapping utility classes) works for legacy code but creates specificity battles. New components should use CSS variables directly.

2. **Convert popups first.** They're the most visible dark-mode failure and follow a consistent pattern. One focused session could fix all 9 files.

3. **Establish a "dark mode lint" step.** A grep for `#[0-9a-fA-F]{3,8}` in TSX that isn't inside a `var()` fallback would catch new regressions.

4. **WorkOrderStatement needs a design decision.** It's a print document — does it honor dark mode or use a fixed light palette? If fixed: wrap it in a `data-theme="light"` container. If adaptive: convert to variables.

5. **Chart colors should be read from CSS variables at render time.** A small utility like `getComputedStyle(document.documentElement).getPropertyValue('--chart-purple')` would let Recharts components honor the theme.
