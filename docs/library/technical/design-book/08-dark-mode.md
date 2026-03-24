# DESIGN BOOK — Chapter 8: Dark Mode

Complete dark mode specification. Token mapping, mechanism, rules, and testing checklist.

---

## How Dark Mode is Applied

Dark mode uses the `[data-theme="dark"]` attribute on the `:root` element. This swaps CSS custom property values defined in `unified-design-system.css`.

### Mechanism

```
:root                         → Default (light mode values)
:root[data-theme="light"]     → Explicit light mode (same values)
:root[data-theme="dark"]      → Dark mode values
```

The attribute is set by:
1. User toggle in the settings/theme picker
2. Persisted to localStorage
3. On first visit, defaults to system preference via `prefers-color-scheme`

### Why Not `@media (prefers-color-scheme: dark)`?

The `data-theme` attribute approach allows:
- User override independent of system setting
- Per-session theming
- Future per-page or per-component theming
- No JavaScript needed for initial render (attribute is set before React hydrates)

---

## Complete Token Mapping

### Core Palette

| Token | Light | Dark | Delta |
|-------|-------|------|-------|
| `--bg` | `#f5f5f5` | `#1e1e1e` | Background inverted. Light grey to dark grey. |
| `--bg-secondary` | `#fafafa` | `#1a1a1a` | Slightly lighter/darker than bg. |
| `--surface` | `#ebebeb` | `#252526` | Card/component background. |
| `--surface-hover` | `#e0e0e0` | `#2d2d30` | Hover state for surfaces. |
| `--surface-glass` | `rgba(235, 235, 235, 0.95)` | `rgba(37, 37, 38, 0.92)` | Semi-transparent overlays. |
| `--surface-elevated` | `#ffffff` | `#2d2d30` | Modal/dropdown backgrounds. |
| `--border` | `#bdbdbd` | `#3e3e42` | Standard border. Lighter in dark mode for visibility. |
| `--border-focus` | `#2a2a2a` | `#cccccc` | Focus/active border. Inverted. |
| `--text` | `#2a2a2a` | `#cccccc` | Primary text. Never pure black or pure white. |
| `--text-secondary` | `#666666` | `#858585` | Secondary text. |
| `--text-disabled` | `#999999` | `#656565` | Disabled/placeholder text. |
| `--accent` | `#2a2a2a` | `#cccccc` | Primary accent. Matches text direction. |
| `--accent-dim` | `rgba(42, 42, 42, 0.08)` | `rgba(204, 204, 204, 0.12)` | Subtle accent backgrounds. |
| `--accent-bright` | `#000000` | `#ffffff` | Maximum contrast accent. |

### Status Colors

Status colors stay consistent across themes for semantic clarity:

| Token | Light | Dark | Notes |
|-------|-------|------|-------|
| `--success` | `#16825d` | `#16825d` | Same. Green is recognizable in both modes. |
| `--warning` | `#b05a00` | `#b05a00` | Same. |
| `--error` | `#d13438` | `#d13438` | Same. |
| `--error-dark` | `#b91c1c` | `#fca5a5` | Inverted: darker red in light, lighter in dark. |
| `--warning-dark` | `#92400e` | `#fbbf24` | Inverted for the same reason. |
| `--info` | `#0ea5e9` | `#38bdf8` | Lighter blue in dark mode for visibility. |

### Chart Palette

Chart colors are lightened in dark mode for readability on dark backgrounds:

| Token | Light | Dark |
|-------|-------|------|
| `--chart-purple` | `#7d6b91` | `#9d8bb1` |
| `--chart-green` | `#6b9d7d` | `#8bbda0` |
| `--chart-gold` | `#9d8b6b` | `#bdab8b` |
| `--chart-teal` | `#6b8b9d` | `#8babbd` |
| `--chart-mauve` | `#8b6b7d` | `#ab8b9d` |
| `--chart-lime` | `#7d9d6b` | `#9dbd8b` |
| `--chart-rose` | `#9d6b6b` | `#bd8b8b` |
| `--chart-slate` | `#6b7d9d` | `#8b9dbd` |
| `--chart-amber` | `#9d7d6b` | `#bd9d8b` |
| `--chart-sage` | `#6b9d8b` | `#8bbdab` |
| `--chart-olive` | `#8b9d6b` | `#abbd8b` |

### Heatmap Tokens

| Token | Light | Dark |
|-------|-------|------|
| `--heat-0` | `#ebedf0` | `#2d2d30` |
| `--heat-1` | `#d9f99d` | `rgba(22, 130, 93, 0.18)` |
| `--heat-2` | `#a7f3d0` | `rgba(22, 130, 93, 0.30)` |
| `--heat-3` | `#34d399` | `rgba(22, 130, 93, 0.44)` |
| `--heat-4` | `#059669` | `rgba(22, 130, 93, 0.62)` |
| `--heat-5` | `#047857` | `rgba(22, 130, 93, 0.78)` |
| `--heat-6` | `#065f46` | `rgba(22, 130, 93, 0.92)` |
| `--heat-border` | `rgba(0, 0, 0, 0.12)` | `rgba(255, 255, 255, 0.10)` |

### Shadow/Overlay

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.15)` | `0 4px 12px rgba(0, 0, 0, 0.5)` |
| `--overlay` | `rgba(0, 0, 0, 0.5)` | `rgba(0, 0, 0, 0.6)` |
| `--shadow-color` | `rgba(0, 0, 0, 0.1)` | `rgba(0, 0, 0, 0.3)` |

### Grey Scale Remapping (Dark Mode)

In dark mode, grey scale aliases invert to map to the dark palette:

| Token | Light | Dark |
|-------|-------|------|
| `--grey-50` | `#fafafa` | `var(--bg)` |
| `--grey-100` | `#f5f5f5` | `var(--bg)` |
| `--grey-200` | `#eeeeee` | `var(--surface)` |
| `--grey-300` | `#e0e0e0` | `var(--surface-hover)` |
| `--grey-400` | `#bdbdbd` | `var(--border)` |
| `--grey-500` | `#9e9e9e` | `var(--text-disabled)` |
| `--grey-600` | `#757575` | `var(--text-secondary)` |
| `--grey-700` | `#616161` | `var(--text-secondary)` |
| `--grey-800` | `#424242` | `var(--text)` |
| `--grey-900` | `#212121` | `var(--text)` |
| `--white` | `#ffffff` | `var(--surface)` |

---

## Dark Mode Rules

### Rule 1: Never hardcode colors

If you use a CSS variable, dark mode is automatic. Hardcoded hex values do not respond to theme changes.

```tsx
// WRONG
style={{ color: '#2a2a2a', background: '#f5f5f5' }}

// CORRECT
style={{ color: 'var(--text)', background: 'var(--bg)' }}
```

### Rule 2: Never use `dark:` Tailwind utilities

Tailwind's `dark:` prefix creates a parallel dark mode system that fights the CSS variable approach. It uses `@media (prefers-color-scheme: dark)` or the `.dark` class, which does not align with our `[data-theme="dark"]` attribute.

```tsx
// WRONG
className="bg-white dark:bg-gray-900 text-black dark:text-white"

// CORRECT
style={{ background: 'var(--surface)', color: 'var(--text)' }}
```

### Rule 3: Never conditionally render different components in dark mode

Do not branch rendering based on theme. Use tokens, not branches.

```tsx
// WRONG
{isDark ? <DarkCard data={data} /> : <LightCard data={data} />}

// CORRECT
<Card data={data} />  // Card uses CSS variables internally
```

### Rule 4: Verify chart colors in dark mode

Chart palette tokens have different values in dark mode (lighter for readability). If using Recharts with hardcoded hex colors for chart series, verify they are from the dark-mode-aware chart palette or use computed styles.

---

## Third-Party Dark Mode

### Global Override

The `* { border-radius: 0 !important; box-shadow: none !important; }` rule applies identically in both modes.

### Recharts

Recharts tooltip `contentStyle` must use CSS variables that automatically flip:
```tsx
contentStyle={{
  background: 'var(--surface)',
  border: '2px solid var(--border)',
  color: 'var(--text)',
}}
```

### React Hot Toast

Toast `style` must use CSS variables:
```tsx
style={{
  background: 'var(--surface)',
  color: 'var(--text)',
  border: '2px solid var(--border)',
}}
```

### Leaflet

Leaflet tile layers have their own appearance. Map controls (zoom, attribution) inherit from the global font override on `.leaflet-container`. Popup styling must use CSS variables.

### Headless UI

Headless UI is unstyled — dark mode behavior comes entirely from the tokens used in your implementation.

---

## High Contrast Modes

Two additional contrast profiles are available for accessibility:

### High Contrast Light

```
:root[data-theme="light"][data-contrast="high"]
```

| Token | Value | Effect |
|-------|-------|--------|
| `--bg` | `#ffffff` | Pure white background |
| `--text` | `#000000` | Pure black text |
| `--border` | `#111111` | Near-black borders |
| `--accent` | `#000000` | Maximum contrast accent |

### High Contrast Dark

```
:root[data-theme="dark"][data-contrast="high"]
```

| Token | Value | Effect |
|-------|-------|--------|
| `--bg` | `#0a0a0a` | Near-black background |
| `--text` | `#ffffff` | Pure white text |
| `--border` | `#f5f5f5` | Near-white borders |
| `--accent` | `#ffd100` | High-visibility gold |
| `--border-focus` | `#ffd100` | Gold focus indicators |

### Greyscale Mode

```
:root[data-contrast="greyscale"]
```

Maps all status and accent colors to greyscale equivalents. `--success`, `--warning`, `--error` become `var(--text)`. Useful for printing or for users who find color distracting.

---

## Dark Mode Testing Checklist

After any component change, verify in dark mode:

- [ ] All text is legible (sufficient contrast against dark background)
- [ ] All borders are visible (not invisible-on-dark)
- [ ] All interactive states (hover, focus, active) are visually distinct
- [ ] Cards are distinguishable from page background
- [ ] Charts/visualizations are readable
- [ ] Empty states are styled correctly
- [ ] Loading skeletons are visible (not invisible `var(--surface)` on dark bg)
- [ ] The header renders correctly
- [ ] Badge portals maintain readability (especially deal score colored badges)
- [ ] Third-party components (toast, tooltip, map controls) use correct tokens
- [ ] No hardcoded hex colors creating "light mode islands" in dark interface
- [ ] Image fallback states ("NO PHOTO") are visible
- [ ] Form inputs have visible borders and placeholder text

---

*Dark mode is not a feature toggle. It is a parallel visual universe that must be equally functional. Every token has a light value and a dark value. If you use the token, both modes work. If you hardcode, one breaks.*
