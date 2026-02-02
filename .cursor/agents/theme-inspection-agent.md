# Theme inspection agent

Use this when you need an agent (or manual pass) to **inspect light/dark mode** and fix cases where **dark mode shows light color schemes**.

## Goal

- Dark mode must use dark backgrounds and light text everywhere; no page or component should force a light scheme when the user has selected dark.
- Single source of truth for theme: `ThemeContext` → `data-theme` and `document.documentElement.style.colorScheme`.

## Steps (in order)

1. **Find theme overrides**
   - Grep: `setAttribute.*data-theme`, `data-theme\s*=`, `colorScheme\s*=`, `color-scheme\s*:`
   - Exclude: `src/contexts/ThemeContext.tsx` (it is the source of truth).
   - Fix: Remove any code that sets `data-theme` or `colorScheme` outside ThemeContext. If the intent was "default before ThemeProvider mounts", rely on ThemeProvider only (e.g. no "force light" in a page).

2. **Find light-only CSS**
   - Grep: `:root[data-theme="light"]` and `data-theme="light"` in CSS.
   - Check: Each such block should have a matching `:root[data-theme="dark"]` (or design tokens) so dark mode is defined. Ensure no rule sets `color-scheme: light` globally without a dark counterpart.

3. **Find hardcoded light Tailwind**
   - In components, look for `bg-white`, `bg-gray-50`, `text-gray-900`, `text-gray-800`, `border-gray-200` (etc.) **without** a `dark:` variant or use of CSS variables.
   - Fix: Add `dark:bg-gray-800`, `dark:text-white`, `dark:text-gray-400`, `dark:border-gray-600` (or equivalent) or replace with `var(--surface)`, `var(--text)`, `var(--border)`.

4. **Check modals and overlays**
   - Open modal/dialog components and full-page wrappers; ensure background and text use `var(--bg)`, `var(--surface)`, `var(--text)` or Tailwind with `dark:` so they are not white in dark mode.

5. **Verify ThemeContext application**
   - In `ThemeContext.tsx`, confirm `useLayoutEffect` sets:
     - `root.setAttribute('data-theme', theme)` (where `theme` is `'dark' | 'light'`).
     - `root.style.colorScheme = theme` (so native controls and scrollbars match).
   - No other code should overwrite these after mount.

## Quick reference

| Issue | Fix |
|-------|-----|
| Page sets `data-theme="light"` on mount | Remove; let ThemeProvider set theme. |
| CSS has `color-scheme: light` on `:root` | Remove or make conditional on `[data-theme="light"]` and set `color-scheme: dark` for `[data-theme="dark"]`. |
| Component uses `bg-white` only | Add `dark:bg-gray-800` (or use `var(--surface)`). |
| Modal looks white in dark mode | Use `var(--surface)` / `var(--bg)` and `var(--text)` for modal container and text. |

## Files to check first

- `nuke_frontend/src/contexts/ThemeContext.tsx` — only place that sets `data-theme` and `colorScheme`.
- `nuke_frontend/src/index.css` — dark overrides for Tailwind utilities.
- `nuke_frontend/src/styles/unified-design-system.css` — `:root[data-theme="light"]` and `:root[data-theme="dark"]`.
- Any page that previously "forced" theme (e.g. OrganizationProfile had a force-light effect; removed so dark mode is not overwritten).
