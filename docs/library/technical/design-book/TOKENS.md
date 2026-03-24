# TOKENS.md — Complete CSS Variable Reference

**Source of truth:** `nuke_frontend/src/styles/unified-design-system.css`
**This file documents EVERY CSS custom property defined in the design system.**

For each token: variable name, light mode value, dark mode value, semantic purpose, and violation pattern.

---

## Global Enforcement Rules

```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

These `!important` rules on the universal selector are **deliberate and permanent**. They exist to:

1. Override third-party component library defaults (Recharts, Headless UI, Radix, Leaflet controls)
2. Override Tailwind utility classes (`rounded-*`, `shadow-*`) that agents or libraries inject
3. Override inline styles that slip through code review
4. Ensure that no element in the DOM can ever have rounded corners or shadows

**Do NOT remove these rules.** They are constitutional, not cosmetic.

**Exception:** Range input thumbs (`input[type="range"]::-webkit-slider-thumb` and `::-moz-range-thumb`) are allowed `border-radius: 50%` for usability.

---

## Font Scale Variable

| Token | Default Value | Purpose |
|-------|---------------|---------|
| `--font-scale` | `1` | User accessibility multiplier. All `--fs-*` tokens reference this. Range: 0.9 to 1.2. |

---

## Font Size Tokens

| Token | Computed Value (at scale 1) | Role | Where Used |
|-------|----------------------------|------|-----------|
| `--fs-7` | `7px` | Micro labels | NO PHOTO label, source platform shortcodes |
| `--fs-8` | `8px` | Small labels | Badge labels, section headers, metadata captions, axis labels, ALL CAPS labels |
| `--fs-9` | `9px` | Secondary text | Breadcrumbs, tab labels, nav links, badge text, OPEN PROFILE buttons |
| `--fs-10` | `10px` | Standard body | Primary content text, card titles, input text, button labels, body text |
| `--fs-11` | `11px` | Headings | Page titles, card section headers, dialog titles |
| `--fs-12` | `12px` | Large headings (rare) | FeedEmptyState primary message, section titles |
| `--fs-13` | `13px` | Display (rare) | Header wordmark (NUKE) |

**Violation pattern:** Using `font-size: 14px` or larger. Using `rem` or `em` units instead of `px`. Using bare pixel values instead of `var(--fs-*)` tokens.

---

## Typography Tokens

| Token | Value | Purpose |
|-------|-------|---------|
| `--font-family` | `Arial, sans-serif` | All human-readable text: labels, navigation, descriptions, headings |
| `--font-mono` | `'Courier New', monospace` | All machine data: prices, VINs, mileage, timestamps, counts, IDs |

**Violation pattern:** Using `system-ui`, `Inter`, `-apple-system`, `Roboto`, `Helvetica Neue`, or any font not in this list. See VIOLATIONS.md V-04.

---

## Background Tokens

| Token | Light Mode | Dark Mode | Purpose | Violation If Replaced With |
|-------|-----------|-----------|---------|---------------------------|
| `--bg` | `#f5f5f5` | `#1e1e1e` | Page background | `#ffffff`, `#fff`, `white`, `#000` |
| `--bg-secondary` | `#fafafa` | `#1a1a1a` | Secondary page areas | Hardcoded hex |
| `--surface` | `#ebebeb` | `#252526` | Card/component backgrounds | `#ffffff`, `white` |
| `--surface-hover` | `#e0e0e0` | `#2d2d30` | Hover state backgrounds | Hardcoded hex |
| `--surface-glass` | `rgba(235, 235, 235, 0.95)` | `rgba(37, 37, 38, 0.92)` | Semi-transparent overlay backgrounds | Hardcoded rgba |
| `--surface-secondary` | `var(--bg)` | `var(--bg)` | Alias for secondary surfaces | Direct hex |
| `--surface-elevated` | `#ffffff` | `#2d2d30` | Elevated elements (modals, dropdowns) | `white`, `#fff` |

---

## Text Tokens

| Token | Light Mode | Dark Mode | Purpose | Used In |
|-------|-----------|-----------|---------|---------|
| `--text` | `#2a2a2a` | `#cccccc` | Primary text. Dark grey, NOT pure black/white. | All primary labels, headings, body text |
| `--text-secondary` | `#666666` | `#858585` | Secondary/supporting text | Metadata, timestamps, breadcrumbs |
| `--text-disabled` | `#999999` | `#656565` | Disabled elements, placeholder text | Loading states, inactive controls |

**Design principle:** Text is dark grey (#2a2a2a), not pure black (#000000). This reduces contrast fatigue during extended use while maintaining clear legibility.

**Violation pattern:** Using `#000000`, `black`, `#ffffff`, `white` for text. See VIOLATIONS.md V-03.

---

## Border Tokens

| Token | Light Mode | Dark Mode | Purpose |
|-------|-----------|-----------|---------|
| `--border` | `#bdbdbd` | `#3e3e42` | Standard borders on cards, inputs, dividers |
| `--border-focus` | `#2a2a2a` | `#cccccc` | Focus state, active state borders |
| `--border-hover` | `var(--border-focus)` | `var(--border-focus)` | Hover state borders (alias) |

**Border width rules:**
- Containers (cards, panels): `2px solid`
- Internal dividers (within cards, between rows): `1px solid`
- Badge borders: `1px solid`

**Violation pattern:** Using `border: 1px solid blue`, colored borders for emphasis, or borders thicker than 2px. See VIOLATIONS.md V-07.

---

## Accent Tokens

| Token | Light Mode | Dark Mode | Purpose |
|-------|-----------|-----------|---------|
| `--accent` | `#2a2a2a` | `#cccccc` | Primary accent color (active nav, focus borders, interactive highlights) |
| `--accent-dim` | `rgba(42, 42, 42, 0.08)` | `rgba(204, 204, 204, 0.12)` | Subtle accent backgrounds |
| `--accent-bright` | `#000000` | `#ffffff` | Maximum contrast accent |
| `--accent-alt` | `#2a2a2a` | `#cccccc` | Secondary accent (used by racing colorways) |
| `--accent-rgb` | `42, 42, 42` | `204, 204, 204` | RGB values for compositing with alpha |

---

## Status Tokens

| Token | Light Mode | Dark Mode | Purpose |
|-------|-----------|-----------|---------|
| `--success` | `#16825d` | `#16825d` | Verified, sold, confirmed, positive deals |
| `--success-dim` | `rgba(22, 130, 93, 0.1)` | `rgba(22, 130, 93, 0.1)` | Subtle success backgrounds |
| `--warning` | `#b05a00` | `#b05a00` | Caution, above market, attention needed |
| `--warning-dim` | `rgba(176, 90, 0, 0.1)` | `rgba(176, 90, 0, 0.1)` | Subtle warning backgrounds |
| `--error` | `#d13438` | `#d13438` | Critical, overpriced, ending, destructive |
| `--error-dim` | `rgba(209, 52, 56, 0.1)` | `rgba(209, 52, 56, 0.1)` | Subtle error backgrounds |
| `--info` | `#0ea5e9` | `#38bdf8` | Informational callouts |
| `--info-dim` | `rgba(14, 165, 233, 0.1)` | `rgba(56, 189, 248, 0.12)` | Subtle info backgrounds |

---

## Spacing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Tight inline gaps (badge padding, icon margins) |
| `--space-2` | `8px` | Standard padding (buttons, small components) |
| `--space-3` | `12px` | Card padding, section margins |
| `--space-4` | `16px` | Section spacing, form gaps |
| `--space-5` | `20px` | Large section margins |
| `--space-6` | `24px` | Page-level spacing |

**Rule:** ALL spacing must be multiples of 4: 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px. No odd values (3px, 5px, 6px, 7px, 10px, 14px). See VIOLATIONS.md V-17.

---

## Layout Tokens

| Token | Value | Purpose |
|-------|-------|---------|
| `--header-height` | `48px` | Persistent header height |
| `--vehicle-tabbar-height` | `48px` | Vehicle profile tab bar height |
| `--radius` | `0px` | Border radius (always zero) |
| `--transition` | `0.12s ease` | Default transition timing |

---

## Chart Palette Tokens

Used for data visualization (Recharts, custom charts). These colors are muted to avoid competing with the greyscale UI.

| Token | Light Mode | Dark Mode | Purpose |
|-------|-----------|-----------|---------|
| `--chart-purple` | `#7d6b91` | `#9d8bb1` | Chart series 1 |
| `--chart-green` | `#6b9d7d` | `#8bbda0` | Chart series 2 |
| `--chart-gold` | `#9d8b6b` | `#bdab8b` | Chart series 3 |
| `--chart-teal` | `#6b8b9d` | `#8babbd` | Chart series 4 |
| `--chart-mauve` | `#8b6b7d` | `#ab8b9d` | Chart series 5 |
| `--chart-lime` | `#7d9d6b` | `#9dbd8b` | Chart series 6 |
| `--chart-rose` | `#9d6b6b` | `#bd8b8b` | Chart series 7 |
| `--chart-slate` | `#6b7d9d` | `#8b9dbd` | Chart series 8 |
| `--chart-amber` | `#9d7d6b` | `#bd9d8b` | Chart series 9 |
| `--chart-sage` | `#6b9d8b` | `#8bbdab` | Chart series 10 |
| `--chart-olive` | `#8b9d6b` | `#abbd8b` | Chart series 11 |

**Usage:** Chart components use these tokens via CSS variables. SVG `fill` and `stroke` attributes in Recharts are ALLOWLISTED for hex colors in the ESLint plugin because they must be string literals, not CSS variables.

---

## Heatmap Tokens

Used for GitHub-style activity grids and heatmap visualizations.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--heat-0` | `#ebedf0` | `#2d2d30` |
| `--heat-1` | `#d9f99d` | `rgba(22, 130, 93, 0.18)` |
| `--heat-2` | `#a7f3d0` | `rgba(22, 130, 93, 0.30)` |
| `--heat-3` | `#34d399` | `rgba(22, 130, 93, 0.44)` |
| `--heat-4` | `#059669` | `rgba(22, 130, 93, 0.62)` |
| `--heat-5` | `#047857` | `rgba(22, 130, 93, 0.78)` |
| `--heat-6` | `#065f46` | `rgba(22, 130, 93, 0.92)` |
| `--heat-border` | `rgba(0, 0, 0, 0.12)` | `rgba(255, 255, 255, 0.10)` |

---

## Racing Accent Colorways

Activated via `data-accent` attribute on `:root`. These are **Easter eggs**, never primary UI. They modify ONLY `--accent`, `--accent-alt`, `--accent-dim`, and `--border-focus`.

### European Racing Liveries

| Colorway | `data-accent` | `--accent` | `--accent-alt` | Origin |
|----------|--------------|-----------|----------------|--------|
| Neutral (default) | `neutral` | `#2a2a2a` | `#2a2a2a` | Default greyscale |
| Gulf | `gulf` | `#ff5f00` | `#9dd9f3` | Gulf Oil racing (Ford GT40, Porsche 917) |
| Martini | `martini` | `#012169` | `#da291c` | Martini Racing (Porsche, Lancia, Williams) |
| Ricard | `ricard` | `#0033a0` | `#ffcd00` | Ligier/Ricard livery |
| Rosso Corsa | `rosso` | `#e4002b` | `#ffd100` | Ferrari red |
| British Racing Green | `brg` | `#00573f` | `#ffef00` | Traditional British motorsport |
| John Player Special | `jps` | `#b9975b` | `#111111` | Lotus F1 black and gold |
| Jaegermeister | `jaeger` | `#fe5000` | `#111111` | Porsche 934/935 orange |
| Alitalia | `alitalia` | `#009a44` | `#c8102e` | Lancia Stratos rally |
| BMW M | `bmw-m` | `#00a3e0` | `#c8102e` | BMW Motorsport tricolor |
| McLaren Papaya | `papaya` | `#ff5f1f` | `#111111` | McLaren papaya orange |

### Americana Colorways

| Colorway | `data-accent` | `--accent` | `--accent-alt` |
|----------|--------------|-----------|----------------|
| Stars & Stripes | `americana` | `#0a2342` | `#c8102e` |
| Route 66 | `route-66` | `#005f73` | `#d4a373` |
| Denim | `denim` | `#1b2a41` | `#d6c9b4` |
| Desert Sun | `desert` | `#c95a00` | `#7b4b2a` |

### Muscle Car / Special

| Colorway | `data-accent` | `--accent` | `--accent-alt` |
|----------|--------------|-----------|----------------|
| Camo OD | `camo-od` | `#4b5320` | `#2a2a2a` |
| Camo Blaze | `camo-blaze` | `#fe5000` | `#111111` |
| Camo Snow | `camo-snow` | `#f4f4f4` | `#44d62c` |
| Mopar Plum Crazy | `mopar-plum` | `#5b2c83` | `#111111` |
| Mopar Sublime | `mopar-sublime` | `#44d62c` | `#111111` |
| Mopar Hemi Orange | `mopar-hemi` | `#ff5f00` | `#111111` |
| Mopar B5 Blue | `mopar-b5` | `#00a3e0` | `#111111` |
| Flames Heat | `flames-heat` | `#ff5f00` | `#fe5000` |
| Flames Blue | `flames-blue` | `#0085ca` | `#00a3e0` |

**Correct use:** Vehicle profile badge for livery-related vehicles; accent highlights in the theme settings panel; discovered as user explores the interface.

**Incorrect use:** Active state indicators, primary CTAs, section headers, general accent colors, error/warning borders. Racing accents are NEVER used as functional UI colors.

---

## Contrast Profiles

| Attribute | Effect |
|-----------|--------|
| `data-contrast="greyscale"` | Maps all accent and status colors to greyscale. `--success`, `--warning`, `--error` become `var(--text)`. |
| `data-contrast="high"` (light) | `--bg: #ffffff`, `--text: #000000`, `--border: #111111`. Maximum readability. |
| `data-contrast="high"` (dark) | `--bg: #0a0a0a`, `--text: #ffffff`, `--accent: #ffd100`. High-vis accessibility mode. |

---

## Semantic Aliases (Legacy)

These aliases exist so legacy components (92 components still importing the old `design-system.css`) do not break during migration. **DO NOT USE IN NEW CODE.** Use the canonical token instead.

| Alias | Resolves To | Use Instead |
|-------|------------|-------------|
| `--text-muted` | `var(--text-secondary)` | `--text-secondary` |
| `--border-light` | `var(--border)` | `--border` |
| `--border-medium` | `var(--border)` | `--border` |
| `--border-dark` | `var(--border-focus)` | `--border-focus` |
| `--font-size-small` | `var(--fs-8)` | `--fs-8` |
| `--font-size` | `var(--fs-9)` | `--fs-9` |
| `--white` | `#ffffff` (light) / `var(--surface)` (dark) | `--surface-elevated` |
| `--danger` | `var(--error)` | `--error` |
| `--primary` | `var(--accent)` | `--accent` |
| `--secondary` | `var(--text-secondary)` | `--text-secondary` |
| `--background` | `var(--bg)` | `--bg` |
| `--card-bg` | `var(--surface)` | `--surface` |
| `--input-bg` | `var(--bg)` | `--bg` |
| `--link` | `var(--accent)` | `--accent` |
| `--foreground` | `var(--text)` | `--text` |
| `--muted` | `var(--text-secondary)` | `--text-secondary` |

The full list of 50+ aliases is in `unified-design-system.css` under the "Legacy token aliases" and "Semantic aliases" comment blocks. Each alias maps to a canonical token and will be removed when its consuming component is migrated.

---

## Grey Scale Aliases

Both American (`--gray-*`) and British (`--grey-*`) spellings are provided. In dark mode, they remap to the dark palette.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--grey-50` / `--gray-50` | `#fafafa` | `var(--bg)` |
| `--grey-100` / `--gray-100` | `#f5f5f5` | `var(--bg)` |
| `--grey-200` | `#eeeeee` | `var(--surface)` |
| `--grey-300` | `#e0e0e0` | `var(--surface-hover)` |
| `--grey-400` / `--gray-400` | `#bdbdbd` | `var(--border)` |
| `--grey-500` / `--gray-500` | `#9e9e9e` | `var(--text-disabled)` |
| `--grey-600` / `--gray-600` | `#757575` | `var(--text-secondary)` |
| `--grey-700` / `--gray-700` | `#616161` | `var(--text-secondary)` |
| `--grey-800` | `#424242` | `var(--text)` |
| `--grey-900` / `--gray-900` | `#212121` | `var(--text)` |

**Do NOT use grey-scale aliases in new code.** Use the semantic tokens (`--bg`, `--surface`, `--border`, `--text`, `--text-secondary`, `--text-disabled`) instead.

---

## Button System Classes

The CSS file defines a complete button system. Use these classes instead of inline styles.

| Class | Border | Background | Text | Hover |
|-------|--------|-----------|------|-------|
| `.btn-base` | `2px solid transparent` | — | — | — |
| `.btn-primary` | `2px solid var(--text)` | `var(--surface)` | `var(--text)` | bg: `var(--text)`, color: `var(--surface)` |
| `.btn-secondary` | `var(--border)` | `var(--surface)` | `var(--text)` | bg: `var(--surface-hover)`, border: `var(--accent)` |
| `.btn-danger` | `var(--error)` | `var(--error-dim)` | `var(--error)` | bg: `var(--error)`, color: `var(--surface)` |
| `.btn-ghost` | transparent | transparent | `var(--text-secondary)` | bg: `var(--accent-dim)`, color: `var(--text)` |
| `.btn-tag` | `var(--border)` | `var(--surface)` | `var(--text-secondary)` | border: `var(--accent)`, color: `var(--text)` |
| `.btn-utility` | `2px solid var(--border)` | `var(--surface)` | `var(--text)` | bg: `var(--surface-hover)`, border: `var(--accent)` |

**Button sizes:**
| Class | Padding | Font Size |
|-------|---------|-----------|
| `.btn-xs` | `1px 6px` | `var(--fs-8)` |
| `.btn-sm` | `3px 8px` | `var(--fs-9)` |
| `.btn-md` | `6px 12px` | `var(--fs-10)` |

---

## Card System Classes

| Class | Purpose | Spec |
|-------|---------|------|
| `.card` | Card container | `background: var(--surface)`, `border: 2px solid var(--border)`, `border-radius: 0`, `overflow: hidden` |
| `.card-header` | Card header section | `padding: 12px`, `border-bottom: 2px solid var(--border)`, `font-size: var(--fs-10)`, `font-weight: 700` |
| `.card-body` | Card content area | `padding: 12px` |

---

## Input System

All text inputs, textareas, and selects share these base styles:

```css
width: 100%;
padding: 8px;
font-size: var(--fs-10);
font-family: var(--font-family);
border: 2px solid var(--border);
border-radius: 0;
background: var(--bg);
color: var(--text);
```

Focus state: `border-color: var(--border-focus)`, `outline: none`.

---

## Animation

| Token / Value | Purpose |
|--------------|---------|
| `--transition: 0.12s ease` | Default transition for interactive states |
| `180ms cubic-bezier(0.16, 1, 0.3, 1)` | Standard interaction animation (hover, expand, collapse). Used inline in components. |
| `@keyframes fadeIn180` | Fade-in animation: `from { opacity: 0 } to { opacity: 1 }`. Used for panel open animations. |

**Rule:** No animation exceeds 180ms. No shimmer, no pulse, no infinite animations. Skeletons are static fills, not animated.

---

## Z-Index Scale

The CSS file does not define explicit z-index tokens. The following values are used by convention in the codebase:

| Layer | Z-Index | Used By |
|-------|---------|---------|
| Base content | `auto` / `0` | Cards, badges, standard layout |
| Expanded card | `10` | CardShell when expanded in grid mode |
| Image overlays | `10` | CardSource favicon overlay |
| Badge cluster panel | `500` | BadgeClusterPanel dropdown |
| Header | `1000` | AppHeader sticky navigation |
| Mobile bottom nav | `1000` | Mobile navigation bar |
| Technical image popup | `10000` | CardImage hover preview (portaled to body) |

[TOKEN NEEDED: Explicit z-index tokens (`--z-base`, `--z-elevated`, `--z-dropdown`, `--z-header`, `--z-overlay`, `--z-popup`) should be defined in `unified-design-system.css` to replace hardcoded values.]

---

## Mobile Bottom Navigation

Hidden on desktop. Visible below 768px viewport width.

```css
.mobile-bottom-nav {
  position: fixed;
  bottom: 0;
  height: 56px;
  background: var(--surface);
  border-top: 2px solid var(--border);
  z-index: 1000;
}
```

Active item: `color: var(--text)`, `font-weight: 700`. Inactive: `color: var(--text-disabled)`.

Content area gets `padding-bottom: 60px` on mobile to clear the nav bar.

---

*Every token documented here is defined in `unified-design-system.css`. If a token is not listed here, it does not exist. If a value is needed that is not in this list, note it as `[TOKEN NEEDED]` and file it for addition — do not hardcode.*
