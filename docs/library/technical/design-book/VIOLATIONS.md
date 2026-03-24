# VIOLATIONS.md — Anti-Pattern Lookup Table

**Check this file before writing any UI code.** Every entry documents a specific violation pattern, why it happens, how to detect it, and how to fix it.

**ESLint enforcement:** `nuke_frontend/eslint-plugin-design-system.js`
**CSS enforcement:** `nuke_frontend/src/styles/unified-design-system.css` (global `!important` rules)

---

### VIOLATION V-01: border-radius on any element

**Temptation:** Rounded corners are the default in every UI framework and Tailwind. They look "friendly" and "modern." Component libraries (Headless UI, Radix) ship with border-radius by default.

**Symptom:**
```tsx
// Inline styles
style={{ borderRadius: 4 }}
style={{ borderRadius: '8px' }}

// Tailwind classes
className="rounded-md"
className="rounded-full"
className="rounded-lg"

// CSS
border-radius: 4px;
```

**Impact:** Violates the zero-radius aesthetic. The design deliberately evokes instrument panels, technical schematics, data terminals. Rounded corners say "consumer app." Square corners say "precision machine."

**Detection:** ESLint rule `design-system/no-border-radius` catches `borderRadius` values greater than 0 in inline style objects. The global CSS rule `* { border-radius: 0 !important; }` overrides any CSS-based border-radius.

**Fix:** Remove entirely. No border-radius. On any element. Including buttons, inputs, cards, modals, tooltips, tags, badges, dropdowns, popovers.

---

### VIOLATION V-02: box-shadow for depth or emphasis

**Temptation:** Drop shadows communicate layering and focus in standard web design. Modal dialogs, dropdown menus, and elevated cards commonly use shadows.

**Symptom:**
```tsx
// Inline styles
style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}

// Tailwind classes
className="shadow-md"
className="shadow-lg"

// CSS
box-shadow: 0 4px 12px rgba(0,0,0,0.15);
```

**Impact:** Violates the flat schematic aesthetic. Depth is communicated through border weight and background contrast, not shadows. Shadows imply a light source that does not exist on a flat screen.

**Detection:** ESLint rule `design-system/no-box-shadow` catches any `boxShadow` value except `'none'`. The global CSS rule `* { box-shadow: none !important; }` overrides any CSS-based shadows.

**Fix:** Use `border: 2px solid var(--border-focus)` for emphasis. Use `background: var(--surface-elevated)` for layering. Never use box-shadow.

---

### VIOLATION V-03: Hardcoded hex colors

**Temptation:** Copying a hex value from a design mockup directly into JSX. Using known values like `#2a2a2a` instead of the CSS variable `var(--text)`.

**Symptom:**
```tsx
style={{ color: '#2a2a2a' }}
style={{ background: '#f5f5f5' }}
style={{ borderColor: '#bdbdbd' }}
className="bg-blue-500 text-white"
```

**Impact:** Dark mode breaks. Theming fails. Racing accent colorways cannot override hardcoded values. Future palette changes require global search-replace instead of a single variable update.

**Detection:** ESLint rule `design-system/no-hardcoded-colors` catches hex color patterns in JSX style props on color-related properties (`color`, `backgroundColor`, `background`, `borderColor`, etc.). Allowlisted contexts: SVG `fill`/`stroke` in chart components, files matching `/recharts/i`, `/chart/i`, `/svg/i`, `/leaflet/i`, `/d3/i`.

**Fix:** ALWAYS use CSS variables:
- `color: 'var(--text)'` not `color: '#2a2a2a'`
- `background: 'var(--bg)'` not `background: '#f5f5f5'`
- `borderColor: 'var(--border)'` not `borderColor: '#bdbdbd'`

See TOKENS.md for the complete token-to-hex mapping.

---

### VIOLATION V-04: Wrong font family

**Temptation:** Using system-ui, Inter, -apple-system, Roboto, or any named typeface because it "looks better" or because a component library imports its own font.

**Symptom:**
```tsx
style={{ fontFamily: 'Inter' }}
style={{ fontFamily: 'system-ui' }}
style={{ fontFamily: '-apple-system, BlinkMacSystemFont' }}
style={{ fontFamily: 'Helvetica Neue' }}
```

**Impact:** The Arial choice is deliberate. Arial has no era, no personality, no associations. It disappears cognitively and lets data be the signal. Any other font introduces visual noise and inconsistency across platforms.

**Detection:** ESLint rule `design-system/no-banned-fonts` catches `fontFamily` values containing anything other than `Arial`, `Courier New`, `monospace`, `inherit`, `sans-serif`, or `var(--`.

**Fix:**
- UI text, labels, navigation: `fontFamily: 'Arial, sans-serif'` or `fontFamily: 'var(--font-family)'`
- Machine data, VINs, codes, prices, timestamps: `fontFamily: "'Courier New', monospace"` or `fontFamily: 'var(--font-mono)'`
- Never import a Google Font. Never reference a variable font. Never use `system-ui`.

---

### VIOLATION V-05: Font size too large

**Temptation:** 14px-16px feels "readable." Modern design systems use 14-16px body text. Accessibility guidelines suggest larger minimums.

**Symptom:**
```tsx
style={{ fontSize: '14px' }}
style={{ fontSize: '16px' }}
style={{ fontSize: '1rem' }}
className="text-sm"  // Tailwind: resolves to 14px
className="text-base"  // Tailwind: resolves to 16px
```

**Impact:** The 8-11px range is the design statement. The interface is a data instrument, not a reading surface. Larger fonts reduce information density and make the UI feel like a consumer app.

**Detection:** No automated rule currently catches font-size values above 13px (the ESLint plugin does not enforce this). Detection is by code review.

**Fix:**
- ALL CAPS labels: `var(--fs-8)` (8px)
- Secondary text, metadata: `var(--fs-9)` (9px)
- Primary body text, inputs: `var(--fs-10)` (10px)
- Headings, section titles: `var(--fs-11)` (11px)
- Large headings (rare): `var(--fs-12)` (12px)
- Display text (header wordmark): `var(--fs-13)` (13px)
- Never use 14px or larger in data contexts.

---

### VIOLATION V-06: Gradients (linear-gradient, radial-gradient)

**Temptation:** Gradients add visual polish and depth. Used for hero backgrounds, button states, card headers.

**Symptom:**
```tsx
style={{ background: 'linear-gradient(to right, #f5f5f5, #ebebeb)' }}
style={{ backgroundImage: 'radial-gradient(circle, ...)' }}
className="bg-gradient-to-r from-blue-500 to-purple-500"
```

**Impact:** Gradients are decorative. This design is anti-decorative. Every pixel serves information function. Gradients also break the flat schematic aesthetic and fight the greyscale palette.

**Detection:** ESLint rule `design-system/no-gradient` catches `background` and `backgroundImage` properties containing `linear-gradient`, `radial-gradient`, or `conic-gradient`.

**Fix:** Flat solid colors only. Use `background: var(--surface)` or `background: var(--bg)`. Use `var(--surface-elevated)` for visual hierarchy.

---

### VIOLATION V-07: Colored borders for emphasis

**Temptation:** Using accent colors on borders to draw attention. Blue for active state, red for error, green for success.

**Symptom:**
```tsx
style={{ border: '1px solid blue' }}
style={{ borderColor: '#ef4444' }}
style={{ borderColor: 'var(--accent)' }}  // in functional UI context
```

**Impact:** Racing accent colors are Easter eggs, not functional UI states. Using them for borders makes the UI look like a themed consumer app instead of an instrument panel.

**Detection:** Code review only. The ESLint plugin does not catch semantic misuse of tokens.

**Fix:**
- Default borders: `border: 2px solid var(--border)`
- Emphasized borders (active, focused): `border: 2px solid var(--border-focus)`
- Active card state: `border: 2px solid var(--text)` (as in CardShell expanded state)
- Error indication: Use error text label with `color: var(--error)`, not red borders
- Accent colors: ONLY for racing livery swatches, badge accent indicators, and deliberate Easter-egg moments

---

### VIOLATION V-08: Tailwind utility classes for design properties

**Temptation:** Tailwind is installed in the project. `rounded-sm` feels less bad than `borderRadius: 4`. Classes are easy to apply.

**Symptom:**
```tsx
className="rounded-md shadow-lg bg-blue-500 text-white p-4 font-sans"
```

**Impact:** Every class in that string violates a rule. `rounded-md` adds border-radius. `shadow-lg` adds box-shadow. `bg-blue-500` hardcodes a color. `text-white` hardcodes a color. `font-sans` may resolve to system-ui. Tailwind utilities bypass the CSS variable system.

**Detection:** The ESLint plugin catches some Tailwind patterns indirectly. Many slip through.

**Fix:** Tailwind CAN be used for: `flex`, `grid`, `gap-*`, `p-*`, `m-*`, `w-*`, `h-*`, `items-*`, `justify-*` (layout utilities that map to the 4px grid). For colors, typography, borders, shadows, and border-radius: use CSS variables and design system classes ONLY.

---

### VIOLATION V-09: Empty states that are dead ends

**Temptation:** Render "No data available" or a spinner with no affordance when a query returns empty.

**Symptom:**
```tsx
<div>No vehicles found.</div>
<p>Nothing here yet!</p>
{data.length === 0 && <span>Empty</span>}
```

**Impact:** Empty states are the most important UX moment. The user has a need the system cannot fulfill. Dead-end empty states cause abandonment. The design spec requires every empty state to offer the next action.

**Detection:** Code review only.

**Fix:** Every empty state must:
1. Acknowledge the gap without apologizing (NO exclamation marks, NO "oops", NO emoji)
2. Explain why briefly (ALL CAPS label, 8-9px, `var(--text-secondary)`)
3. Offer a specific action: link, button, or search suggestion
4. Use the correct text hierarchy: primary message at 12px, secondary at 10px, action at 8-9px

Example (from FeedEmptyState):
```tsx
<div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
  NO VEHICLES MATCH
</div>
<div style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
  Try adjusting your filters or search terms.
</div>
<button className="btn-base btn-sm btn-secondary">RESET ALL FILTERS</button>
```

---

### VIOLATION V-10: Loading states that flash or stutter

**Temptation:** Using `React.lazy()` with `Suspense` and a spinner fallback. Rendering nothing while data fetches.

**Symptom:**
```tsx
<Suspense fallback={<div>Loading...</div>}>
<Suspense fallback={<Spinner />}>
{isLoading && <LoadingSpinner />}
```

**Impact:** Visible loading breaks the "machine that always knows" illusion. Layout shift on data arrival is jarring. Spinners add motion that the design does not support.

**Detection:** Runtime observation only.

**Fix:**
- Skeleton screens that match the exact layout of loaded content (same widths, heights, padding)
- Skeleton elements use `background: var(--surface)` as fill
- Skeletons have ZERO animation (no pulse, no shimmer, no fade)
- Use TanStack Query `prefetchQuery` on hover to pre-fetch
- Route-level code splitting: `Suspense` fallback must be a pixel-perfect skeleton with `background: var(--bg)`, not a spinner

Example (from FeedStatsStrip loading state):
```tsx
<div style={{ height: '32px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} />
```

---

### VIOLATION V-11: Inline style objects for design properties

**Temptation:** Quick fixes via `style={{ borderRadius: 8, boxShadow: '...' }}`.

**Symptom:**
```tsx
style={{
  borderRadius: 8,
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  background: '#ffffff',
  fontFamily: 'Inter',
}}
```

**Impact:** Bypasses both the CSS variable system AND the ESLint rules (complex objects may evade detection).

**Detection:** ESLint rules `no-border-radius`, `no-box-shadow`, `no-hardcoded-colors` catch many cases. Complex expressions may slip through.

**Fix:** Move all design properties to CSS classes using design system tokens. If a property cannot be expressed as an existing CSS class, create a new utility class in `unified-design-system.css`. Inline styles are acceptable for: `position`, `display`, `flex`, `grid`, `width`, `height`, `padding`, `margin`, `gap`, `z-index`, `overflow`, `cursor`, `white-space`, `text-overflow` (layout properties), and `transition` with design system timing values.

---

### VIOLATION V-12: Third-party component default styles leaking

**Temptation:** Importing `<DatePicker>`, `<Select>`, `<Modal>`, `<Tooltip>` from a component library and using default styles.

**Symptom:** Rounded corners on dropdowns. Blue focus rings. Grey shadows on modals. Default Recharts tooltip styling.

**Impact:** Every third-party component ships with its own design system. Theirs violates ours.

**Detection:** Visual inspection only. The global `* { border-radius: 0 !important; box-shadow: none !important; }` catches most shape violations but not color or font violations.

**Fix:**
1. The global `*` rule catches border-radius and box-shadow automatically
2. For color violations: wrap the component in a CSS class that overrides using CSS variables
3. For font violations: add `font-family: var(--font-family) !important` to the component container
4. For components with injected `<style>` tags: add targeted CSS overrides in `unified-design-system.css`

See Chapter 06 (Third-Party Components) for component-by-component override instructions.

---

### VIOLATION V-13: Badge elements not wired as BadgePortals

**Temptation:** Rendering a badge as a plain `<span>` with styling but no click handler or depth state.

**Symptom:**
```tsx
<span className="badge" style={{ fontSize: '8px', textTransform: 'uppercase' }}>FUEL</span>
<div style={{ padding: '2px 6px', border: '1px solid var(--border)' }}>MANUAL</div>
```

**Impact:** The badge IS the interaction. The badge click model is the fundamental UX primitive. A badge that is just a label is architecturally wrong. Every data point is a portal into its cluster.

**Detection:** Code review.

**Fix:** Use the `<BadgePortal>` component:
```tsx
<BadgePortal
  dimension="transmission"
  value="manual"
  label="MANUAL"
/>
```

If the badge genuinely should not be interactive (rare), use `<BadgePortal static>` to explicitly mark it as non-interactive.

---

### VIOLATION V-14: Dark mode applied inconsistently

**Temptation:** Adding `dark:` Tailwind classes on some elements. Checking `window.matchMedia` in component code. Using different rendering paths for light/dark.

**Symptom:**
```tsx
className="bg-white dark:bg-gray-900"
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
{isDark ? <DarkCard /> : <LightCard />}
```

**Impact:** The dark mode system uses CSS custom property swaps via `[data-theme="dark"]` on `:root`. Any component that bypasses this creates inconsistency: some elements flip, others stay light.

**Detection:** Visual inspection in dark mode.

**Fix:** Every color value must use a CSS token that has a dark-mode equivalent. Never hardcode colors. Never use `dark:` Tailwind utilities. Never conditionally render different components based on theme. See Chapter 08 (Dark Mode).

---

### VIOLATION V-15: 12px+ font size on data labels and column headers

**Temptation:** Labels at 12px feel like "minimum accessible size."

**Symptom:**
```tsx
style={{ fontSize: '12px', textTransform: 'uppercase' }}  // on a column header
style={{ fontSize: '14px' }}  // on a badge label
```

**Impact:** The 8-9px ALL CAPS label is a signature of the design. It communicates: this is a data instrument. Larger labels make it feel like a generic dashboard.

**Detection:** Code review.

**Fix:** ALL CAPS labels for columns, categories, section headers:
```tsx
style={{
  fontFamily: 'Arial, sans-serif',
  fontSize: 'var(--fs-8)',  // 8px
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-secondary)',
}}
```

---

### VIOLATION V-16: Decorative icons or emoji

**Temptation:** Using check mark icons for success, warning triangles for errors, emoji for empty states, decorative SVG illustrations.

**Symptom:**
```tsx
<CheckCircleIcon className="text-green-500" />
<span>No results found</span>
<div>No vehicles found</div>
```

**Impact:** The design is text-first, data-first. Icons add visual noise unless they carry precise semantic meaning (maps, sensor readings, favicons for source attribution).

**Detection:** Code review.

**Fix:** Replace decorative icons with ALL CAPS text labels: `SUCCESS`, `WARNING`, `ERROR`. For empty states, use structured text. If an icon is truly necessary (map markers, source favicons), use minimal monochrome SVG aligned to the 4px grid.

---

### VIOLATION V-17: Padding or margin not on the 4px grid

**Temptation:** Using `padding: 10px` or `margin: 6px` for "visual balance."

**Symptom:**
```tsx
style={{ padding: '10px' }}
style={{ margin: '6px' }}
style={{ gap: '5px' }}
style={{ padding: '3px 7px' }}
```

**Detection:** No automated detection. Code review.

**Fix:** ALL spacing must be multiples of 4: 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px. Use spacing tokens: `var(--space-1)` through `var(--space-6)`.

**Exception:** The `2px` border width and `1px` internal divider width are allowed (these are border values, not spacing). `3px` padding on small badges is tolerated when the 4px padding makes the element visually too large (e.g., `padding: '2px 6px'` on BadgePortal).

---

### VIOLATION V-18: Z-index values not from the z-index scale

**Temptation:** `z-index: 9999` to ensure a modal is on top.

**Symptom:**
```tsx
style={{ zIndex: 9999 }}
style={{ zIndex: 100 }}
style={{ zIndex: 50 }}
```

**Fix:** Use the z-index scale documented in TOKENS.md: `auto/0` (base), `10` (expanded cards), `500` (badge panels), `1000` (header/nav), `10000` (portaled popups). Never use values not in the scale.

---

### VIOLATION V-19: Flex/Grid gaps not on the 4px grid

See V-17. `gap`, `row-gap`, and `column-gap` follow the same 4px grid rule. Exception: `2px` gap is allowed for tight grid layouts (BadgeClusterPanel preview grid uses `gap: 2px`).

---

### VIOLATION V-20: Component library default focus rings

**Temptation:** Leaving default browser or library focus rings (blue outline, box-shadow outline).

**Symptom:** Blue or purple outline on focused buttons, inputs, links. `outline: 2px solid -webkit-focus-ring-color`.

**Fix:**
```css
:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none;
}
```

This pattern preserves keyboard navigation visibility while removing focus rings on mouse click. Verify this is not being overridden by third-party component styles.

[TOKEN NEEDED: These focus styles should be added to `unified-design-system.css` if not already present.]

---

## ESLint Rule Reference

| Rule Name | What It Catches | Allowlisted Contexts |
|-----------|----------------|---------------------|
| `design-system/no-hardcoded-colors` | Hex color literals in JSX style objects and template literals on color-related properties | Files matching: `/recharts/i`, `/chart/i`, `/svg/i`, `/leaflet/i`, `/maplibre/i`, `/d3/i`, `/deck.gl/i`, `/three/i`, `/canvas/i`, `.test.`, `.spec.`, `.stories.`. SVG/chart props: `fill`, `stroke`, `stopColor`, `floodColor`, `lightingColor`. |
| `design-system/no-border-radius` | `borderRadius` property with value > 0 (allows `0`, `'0'`, `'0px'`) | None |
| `design-system/no-box-shadow` | `boxShadow` property with value other than `'none'`, `'0'`, or `0` | None |
| `design-system/no-gradient` | `background` or `backgroundImage` containing `linear-gradient`, `radial-gradient`, or `conic-gradient` | None |
| `design-system/no-banned-fonts` | `fontFamily` containing any font not in: `arial`, `courier new`, `monospace`, `inherit`, `sans-serif`, or starting with `var(--` | None |

---

## Changelog

| Date | Change | Prompted By |
|------|--------|-------------|
| 2025-10-21 | Unified design system CSS created | 1,817 borderRadius violations in single cleanup |
| 2026-03-24 | VIOLATIONS.md created as part of Design Interface Encyclopedia | Recurring cycle of violation introduction and cleanup |
