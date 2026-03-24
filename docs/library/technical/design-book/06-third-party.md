# DESIGN BOOK — Chapter 6: Third-Party Components

Third-party components are the #1 source of design violations. Every library ships with its own design system. Theirs violates ours. This chapter documents how to neutralize violations from every third-party library in the project.

**Installed libraries** (from `package.json`): Recharts, Headless UI, Radix UI, React Leaflet, MapLibre GL, Deck.gl, Three.js, Lightweight Charts, React Hot Toast, Lucide React, React Hook Form, React Markdown.

---

## Global Override Strategy

The CSS in `unified-design-system.css` globally neutralizes the two most common third-party violations:

```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

This catches:
- Rounded dropdown menus from any select/combobox library
- Rounded modal corners from any dialog library
- Shadow effects on any tooltip, popover, or overlay
- Rounded buttons from any button component

**This rule is permanent.** Agents must not remove it. It is not sloppy CSS — it is deliberate global enforcement that saves hundreds of individual overrides.

---

## Recharts

**Package:** `recharts@^3.7.0`
**What it does:** Chart rendering (line, bar, area, pie, scatter, composed charts)
**Where used:** Market analytics, price history, inventory dashboards

### Default Violations

| Violation | Global Override Catches It? | Additional Override Needed? |
|-----------|---------------------------|---------------------------|
| Border-radius on chart container | Yes | No |
| Default tooltip styling (rounded, shadowed) | Partially (radius/shadow caught) | Yes — colors and fonts need override |
| Legend font family/size | No | Yes |
| Default chart colors | No | Yes — use chart palette tokens |

### Correct Usage

**Chart colors:** Use the `--chart-*` tokens from TOKENS.md:

```tsx
// CORRECT: Use CSS variable values
const CHART_COLORS = [
  'var(--chart-purple)',
  'var(--chart-green)',
  'var(--chart-gold)',
  'var(--chart-teal)',
  'var(--chart-mauve)',
  'var(--chart-lime)',
  'var(--chart-rose)',
  'var(--chart-slate)',
  'var(--chart-amber)',
  'var(--chart-sage)',
  'var(--chart-olive)',
];

// Note: Recharts SVG fill/stroke attributes require string hex values,
// not CSS var() references. Use getComputedStyle() to resolve tokens,
// or use the hex values from TOKENS.md directly.
// These are ALLOWLISTED in the ESLint plugin for chart contexts.
```

**Tooltip override:**
```tsx
<Tooltip
  contentStyle={{
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    fontFamily: 'Arial, sans-serif',
    fontSize: 'var(--fs-9)',
    color: 'var(--text)',
    padding: '4px 8px',
  }}
  labelStyle={{
    fontFamily: 'Arial, sans-serif',
    fontSize: 'var(--fs-8)',
    fontWeight: 700,
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
  }}
/>
```

**Legend override:**
```tsx
<Legend
  wrapperStyle={{
    fontFamily: 'Arial, sans-serif',
    fontSize: 'var(--fs-8)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  }}
/>
```

### Allowlisted

SVG `fill` and `stroke` attributes in Recharts components are allowlisted in the ESLint plugin because:
1. SVG attributes require string values, not CSS variables
2. Chart data colors use the chart palette (muted, not primary UI colors)
3. The allowlist patterns in `eslint-plugin-design-system.js`: `/recharts/i`, `/chart/i`, `/svg/i`

---

## Headless UI

**Package:** `@headlessui/react@^2.2.3`
**What it does:** Unstyled, accessible UI primitives (Dialog, Disclosure, Listbox, Menu, Popover, Switch, Tabs, Transition)
**Where used:** Modals, dropdowns, menus, transitions

### Default Violations

Headless UI is **unstyled by default** — it does not inject its own CSS. Violations come from the styling that agents ADD when implementing Headless UI components.

| Common Violation | Fix |
|-----------------|-----|
| Adding `rounded-lg` to Dialog.Panel | Remove. Zero border-radius. |
| Adding `shadow-xl` to Dialog overlay | Remove. Zero shadows. |
| Using Tailwind color classes on ListBox | Use CSS variables: `var(--surface)`, `var(--text)` |
| Default Transition durations > 180ms | Use `duration-150` or inline 180ms |

### Correct Usage Pattern

```tsx
import { Dialog } from '@headlessui/react';

<Dialog open={isOpen} onClose={close}>
  <div style={{
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',  // Use var(--overlay) when available
    zIndex: 1000,
  }}>
    <Dialog.Panel style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      padding: '16px',
      maxWidth: '560px',
      margin: '80px auto',
    }}>
      {/* Content */}
    </Dialog.Panel>
  </div>
</Dialog>
```

---

## Radix UI

**Package:** `@radix-ui/react-label@^2.1.7`, `@radix-ui/react-slot@^1.2.3`
**What it does:** Accessible UI primitives (only Label and Slot are installed)

### Default Violations

Label and Slot are unstyled. No violations to override.

---

## React Leaflet / Leaflet

**Package:** `leaflet@^1.9.4`, `react-leaflet@^5.0.0`, `react-leaflet-cluster@^4.0.0`
**What it does:** Map rendering with tile layers, markers, clusters
**Where used:** NukeMap component, image location maps

### Default Violations

| Violation | Global Override? | Additional Override? |
|-----------|-----------------|---------------------|
| Rounded zoom control buttons | Yes | No |
| Shadow on popup tooltips | Yes | No |
| Default blue marker icons | No | Replace with custom markers |
| Leaflet's own font stack | No | Override on `.leaflet-container` |

### Allowlisted

Leaflet renders its own canvas/SVG internally — the design system allows Leaflet's internal rendering. The ESLint plugin allowlists files matching `/leaflet/i`.

### Override

```css
.leaflet-container {
  font-family: Arial, sans-serif;
  font-size: var(--fs-9);
}
.leaflet-popup-content-wrapper {
  background: var(--surface);
  border: 2px solid var(--border);
  color: var(--text);
}
```

---

## MapLibre GL

**Package:** `maplibre-gl@^5.19.0`, `react-map-gl@^8.1.0`
**What it does:** WebGL map rendering
**Where used:** Alternative map views

### Allowlisted

MapLibre renders to a WebGL canvas. Internal rendering is not subject to CSS rules. Map controls are subject to the global override and should use design system tokens for any DOM overlay elements.

---

## Deck.gl

**Package:** `deck.gl@^9.2.10`
**What it does:** Large-scale data visualization layers on maps
**Where used:** Heatmaps, aggregation layers

### Allowlisted

Deck.gl renders to a canvas overlay. No CSS violations from the library itself. Any DOM tooltips or controls built on top must use design system tokens.

---

## Three.js / React Three Fiber

**Package:** `three@^0.182.0`, `@react-three/fiber@^8.18.0`, `@react-three/drei@^9.122.0`
**What it does:** 3D rendering
**Where used:** LivingVehicleAscii, potential vehicle 3D views

### Allowlisted

Three.js renders to a canvas. No CSS violations from the library. The ESLint plugin allowlists `/three/i`.

---

## Lightweight Charts

**Package:** `lightweight-charts@^5.1.0`
**What it does:** Financial-style candlestick/line charts
**Where used:** Price history charts

### Allowlisted

Renders to a canvas. Style configuration is done through the library's API, not CSS. Set chart options to match the design palette:

```tsx
chart.applyOptions({
  layout: {
    background: { type: 'solid', color: 'transparent' },
    textColor: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    fontSize: 9,
  },
  grid: {
    vertLines: { color: 'var(--border)' },
    horzLines: { color: 'var(--border)' },
  },
});
```

---

## React Hot Toast

**Package:** `react-hot-toast@^2.6.0`
**What it does:** Toast notification popups
**Where used:** Success/error feedback after actions

### Default Violations

| Violation | Global Override? | Additional Override? |
|-----------|-----------------|---------------------|
| Rounded toast container | Yes | No |
| Shadow on toast | Yes | No |
| Default icon colors | No | Override via `iconTheme` |
| Default font | No | Override via `style` |

### Correct Usage

```tsx
import toast from 'react-hot-toast';

toast.success('VEHICLE SAVED', {
  style: {
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    padding: '8px 12px',
  },
  iconTheme: {
    primary: 'var(--success)',
    secondary: 'var(--surface)',
  },
});
```

---

## Lucide React

**Package:** `lucide-react@^0.525.0`
**What it does:** Icon library (SVG icons as React components)
**Where used:** Navigation icons, status indicators, action buttons

### Violations to Watch

- Icons used decoratively (see V-16 in VIOLATIONS.md). Icons should carry semantic meaning.
- Icon sizes not aligned to the design system (use 12px, 14px, 16px, or 20px — multiples of 2)
- Icon colors hardcoded instead of using `currentColor` or CSS variables

### Correct Usage

```tsx
import { Search } from 'lucide-react';

<Search
  size={14}
  strokeWidth={2}
  style={{ color: 'var(--text-secondary)' }}
/>
```

---

## React Router DOM

**Package:** `react-router-dom@^7.6.0`
**What it does:** Client-side routing

### No Visual Violations

`<Link>` components must NOT have default underline styles unless they are inline text links. Navigation links use ALL CAPS styling:

```tsx
<Link
  to="/search"
  style={{
    fontFamily: 'Arial, sans-serif',
    fontSize: 'var(--fs-8)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    textDecoration: 'none',
    color: 'var(--text-secondary)',
  }}
>
  SEARCH
</Link>
```

---

## TanStack Query

**Package:** `@tanstack/react-query@^5.90.21`
**What it does:** Server state management, data fetching, caching

### No Visual Violations

TanStack Query does not render UI. However, its state management affects loading/error/empty states which must follow design system patterns:

- **Loading:** Static skeleton fills, no spinners
- **Error:** Text-based error message with retry action
- **Empty:** Never a dead end — always offer a next action

Use `prefetchQuery` on hover to pre-fetch data and reduce visible loading time.

---

## React Markdown

**Package:** `react-markdown@^10.1.0`
**What it does:** Markdown rendering

### Override Required

Markdown renders with browser default styling (serif fonts in some cases, larger headings, colored links). Wrap in a container class:

```css
.nuke-markdown {
  font-family: Arial, sans-serif;
  font-size: var(--fs-10);
  color: var(--text);
  line-height: 1.4;
}
.nuke-markdown h1, .nuke-markdown h2, .nuke-markdown h3 {
  font-size: var(--fs-11);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 12px 0 4px;
}
.nuke-markdown a {
  color: var(--text);
  text-decoration: underline;
}
.nuke-markdown code {
  font-family: var(--font-mono);
  font-size: var(--fs-9);
  background: var(--surface);
  padding: 1px 4px;
}
```

---

## Vite

**Build tool.** No CSS violations from Vite itself. However:
- CSS injected by Vite plugins (PostCSS, CSS modules) must be reviewed for violations
- Tailwind CSS (via PostCSS) generates utility classes — see V-08 in VIOLATIONS.md for allowlisted/prohibited Tailwind patterns

---

## Summary: Override Checklist for New Libraries

Before importing ANY new third-party library:

1. Check if the global `* { border-radius: 0 !important; box-shadow: none !important; }` handles its shape violations
2. Check if it injects its own fonts — if yes, add a CSS override
3. Check if it uses its own color system — if yes, add CSS variable overrides
4. Check if it renders DOM or canvas — canvas rendering is generally allowlisted
5. Document the library in this chapter
6. Test in both light and dark mode

---

*Third-party components are guests in our system. They follow our rules. If they cannot be overridden, they should not be imported.*
