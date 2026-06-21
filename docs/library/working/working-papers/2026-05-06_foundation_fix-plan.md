# Foundation team — UI primitive fix plan
**Date:** 2026-05-06
**Author:** foundation team lead
**Scope:** the primitive layer — components, hooks, lint rules, dark-mode bridge that every other surface depends on

---

## 1. Mission

The Design Interface Encyclopedia (`docs/library/technical/design-book/`) is gospel-complete on tokens, components, screens, interactions. The Three Design Laws are stated. VIOLATIONS.md enumerates 20 anti-patterns. The Click Anxiety contemplation establishes the asymmetry: **one broken interaction destroys the trust built by four good ones.** That asymmetry compounds at the primitive layer — a Card rendered 51 different ways across the codebase is 51 chances to break the contract, 51 places dark mode silently fails, 51 sites where a future fix has to be applied 51 times. The foundation team's job is to collapse the 79 inlined primitive sites into a small set of canonical components, extend the existing ESLint plugin so regressions cost a build, and bridge the design tokens into the two systems (Recharts, Tailwind dark mode) that currently can't read them. Once the primitive layer enforces the canon by default, every other team's fixes go from one-off to mechanical.

---

## 2. Current state

| Surface | Coverage | Source |
|---|---|---|
| `Button.tsx` (canonical primitive, variant + size + as-link/anchor polymorphism) | ✓ solid | `src/components/common/Button.tsx`, audit Stream D |
| `Card` primitive | ✗ inlined 51 times | audit T2.6 / Appendix D |
| `Modal` primitive | ✗ inlined 5 times (4 in settings, 1 in add-vehicle), every one missing focus trap or ARIA | audit T1.5 / T2.6 |
| `TextInput` / `Select` / `Textarea` primitive | ✗ inlined 23 times, two missing `aria-label` on bounce-surface routes | audit T1.4 / T2.6 |
| `LoadingSkeleton` | ✗ — 91 of 97 inspected components have no loading UI; 11 of top 13 public routes show blank screens or ad-hoc text strings (`LOADING…`, `LOADING VEHICLES…`, `LOADING...`) | audit T1.1 / Appendix C |
| `EmptyState` | ✗ — `MarketDashboard` and `BrowseVehicles` `.map()` over potentially-empty arrays with no length guard, despite frontend.md banning empty shells | audit T1.3 |
| Toast error surface | ✗ — 24 silent catches across the app; `react-hot-toast` is already a dependency, just not used | audit T1.2 |
| Dark mode | 43.7% — 209 Tailwind utilities used in `src/` have no dark override. ~20 CSS rules lift coverage to ~85% | audit T2.4 / Appendix D |
| Recharts theme bridge | ✗ — 9 chart files hardcode hex; 3 TODOs in `BidCompareOverlay.tsx` flag this | audit T2.5 |
| Legacy CSS holdout | 1 file (`components/image/ImageLightbox.tsx`) | audit T2.3 |
| ESLint plugin | catches `borderRadius`, `boxShadow`, hex colors, gradients, banned fonts in inline styles. Does **not** catch: `<div onClick>`, font-size > 13px, 4px-grid violations, `.map()` without length guard | `eslint-plugin-design-system.js`, audit T2.1 |
| `<div onClick>` semantic-HTML violations | 27 across the codebase — modal overlays (10), expand/collapse (8), nav/link (7), inline-edit (2) | audit T2.1 / Appendix E |

The asymmetry: `Button` is solved. Everything else is reinvented per page. The primitive layer is one solid and four missing.

---

## 3. The fix list

Each entry: **title, target file, problem, recipe (TS signature + Tailwind/CSS skeleton + ~15 lines pseudo), canon citation, effort.** Every recipe mirrors the `Button.tsx` API model: variant + className builder, no inline design properties, exhaustive variant typing.

### 3.1 — `<LoadingSkeleton>` — pixel-perfect, zero animation

- **Target:** new `nuke_frontend/src/components/common/LoadingSkeleton.tsx`
- **Problem:** 11 of the top 13 public components fall back to text strings (`LOADING…`, `LOADING VEHICLES…`) or blank divs while data fetches. Three different ad-hoc strings is three chances to violate consistency.
- **Canon:** design-book/02-components.md "Loading Skeletons (Pattern)" — `background: var(--surface)`, same dimensions as loaded content, **NO animation** (V-10). The audit-appendix recipe used `animate-pulse` — that **violates V-10** and must be rejected. Skeletons are static fills.
- **Effort:** S (1 file, ~50 lines)

```tsx
type SkeletonVariant = 'text' | 'card' | 'card-list' | 'table-row' | 'avatar' | 'header' | 'badge';

interface LoadingSkeletonProps {
  variant: SkeletonVariant;
  count?: number;          // default 1
  className?: string;
  ariaLabel?: string;      // default 'Loading'
}

// Skeletons are static — no pulse, no shimmer (V-10).
// Each variant matches the dimensions of the loaded content it replaces.
const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text:        'h-3 w-3/4',                                                    // 12px row
  card:        'h-40 w-full border-2 border-[var(--border)]',                  // matches CardShell loaded height
  'card-list': 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2',   // wraps card variant N times
  'table-row': 'h-8 grid grid-cols-[120px_60px_80px_1fr] gap-4',
  avatar:      'h-10 w-10',
  header:      'h-8 w-1/3',                                                    // page-header slot
  badge:       'h-4 w-12',                                                     // badge placeholder
};

// Style applied via className so all colors come from CSS variables:
//   bg-[var(--surface)] is the only fill.
//   No border-radius (global !important rule, but we never set one anyway).
//   role="status" + aria-busy="true" so screen readers announce.
```

### 3.2 — `<EmptyState>` — the dead-end ban

- **Target:** new `nuke_frontend/src/components/common/EmptyState.tsx`
- **Problem:** `MarketDashboard.tsx:87` and `BrowseVehicles.tsx:762` `.map()` over arrays without length guards. Frontend.md explicitly forbids empty shells. V-09 forbids dead-end empty states without a next action.
- **Canon:** design-book/02-components.md "Empty States (Pattern)" — text hierarchy is 12px/700/UPPERCASE primary, 10px sentence secondary, 8-9px UPPERCASE action. **No icons, no emoji, no exclamation marks.** The audit appendix recipe included `icon?: React.ComponentType` — that **violates V-16** and must be rejected. Decorative icons are banned. Action is a `Button`, not a custom button.
- **Effort:** S (1 file, ~35 lines)

```tsx
interface EmptyStateProps {
  title: string;                                    // ALL CAPS, 12px, 700, var(--text-secondary)
  message?: string;                                 // sentence case, 10px, var(--text-disabled)
  action?: { label: string; onClick: () => void } | { label: string; to: string };
  className?: string;
}

// Layout: flex flex-col items-center text-center py-16 px-4 (4px grid)
// NO icon prop. NO illustration. NO emoji. NO "Oops!" copy.
// Title style is locked: textTransform: 'uppercase', fontSize: 'var(--fs-12)', fontWeight: 700,
//   color: 'var(--text-secondary)', fontFamily: 'var(--font-family)'
// Message style: fontSize: 'var(--fs-10)', color: 'var(--text-disabled)'
// Action renders <Button variant="secondary" size="sm"> — reuses existing primitive.
//
// Adoption requires: every list-rendering site wraps .map() with
//   if (!items.length) return <EmptyState title="NO RESULTS" message="..." action={{...}} />;
```

### 3.3 — `useToastError()` — the silent-catch antidote

- **Target:** new `nuke_frontend/src/hooks/useToastError.ts`
- **Problem:** 24 silent catches across the app, including the load-bearing public routes (`HomePage.tsx:168-174`, `BrowseVehicles.tsx`, `AuctionMarketplace.tsx:103-106`, `OrganizationProfile.tsx`, `PublicMap.tsx:54-78`). Users see blank screens on RPC failure with no signal anything went wrong.
- **Canon:** design-book/06-third-party.md (React Hot Toast section), V-01/V-02/V-03 — toast styling must use tokens, no border-radius, no shadow. `react-hot-toast` is already in the dependency tree; do not introduce a second toast library. Toast container is mounted once at `App.tsx` root.
- **Effort:** S (1 file, ~30 lines + global Toaster mount in App.tsx — that's a 5-line edit)

```tsx
import { toast } from 'react-hot-toast';
import { useCallback } from 'react';

interface ToastOpts { title?: string; duration?: number; }

// Returns a wrapper. Pattern: useToastError()(promise).
// Promise rejection -> toast.error(); promise resolves through unchanged.
// Re-throws so callers can still use try/catch / .catch for control flow.
export function useToastError() {
  return useCallback(<T,>(p: Promise<T>, opts?: ToastOpts) =>
    p.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`${opts?.title ?? 'Error'}: ${msg}`, {
        position: 'bottom-right',
        duration: opts?.duration ?? 5000,
        style: {
          background: 'var(--surface)',
          border: '2px solid var(--error)',
          color: 'var(--text)',
          fontFamily: 'var(--font-family)',
          fontSize: 'var(--fs-10)',
          // borderRadius / boxShadow not set — global !important enforces 0/none.
        },
      });
      throw err;
    }), []);
}

// Migration pattern at call sites:
// -  const { data } = await supabase.rpc(...).catch(() => ({}));
// +  const toastError = useToastError();
// +  const { data } = await toastError(supabase.rpc(...), { title: 'Failed to load segments' }).catch(() => ({}));
```

A companion `<ErrorBoundary>` wrapping `<AppLayout>` in `App.tsx` toasts on render error (separate ~20-line file, same canon citations).

### 3.4 — `<Card>` primitive

- **Target:** new `nuke_frontend/src/components/common/Card.tsx`
- **Problem:** 51 inline card patterns across the codebase. Sample sites: `pages/settings/WebhooksPage.tsx:180`, `pages/admin/InventoryAnalytics.tsx:72`, `components/auction/ListingCard.tsx:40`. Each is a chance for a borderRadius slip, a missing dark-mode token, an inconsistent padding.
- **Canon:** design-book/TOKENS.md "Card System Classes" — `.card { background: var(--surface); border: 2px solid var(--border); border-radius: 0; overflow: hidden }` already exists in `unified-design-system.css`. The primitive is a thin React wrapper, not a new style system.
- **Effort:** S (1 file, ~60 lines mirroring Button.tsx shape)

```tsx
type CardVariant = 'default' | 'inset' | 'warning' | 'success' | 'error';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section';   // semantic HTML choice
}

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: 'card',
  inset:   'card card--inset',                  // bg: var(--bg) instead of surface
  warning: 'card card--warning',                // border: 2px solid var(--warning)
  success: 'card card--success',                // border: 2px solid var(--success)
  error:   'card card--error',                  // border: 2px solid var(--error)
};

// Mirrors Button.tsx: class builder, no inline design properties.
// Header renders a .card-header slot (already in unified-design-system.css).
// Footer renders a .card-footer slot (add if missing — small CSS addition, no new tokens).
// New CSS classes (.card--inset etc.) added to unified-design-system.css using existing tokens only.
```

### 3.5 — `<Modal>` primitive — focus trap, escape, ARIA built in

- **Target:** new `nuke_frontend/src/components/common/Modal.tsx`
- **Problem:** 5 inline modal patterns (`pages/settings/WebhooksPage.tsx:175,185,195`, `pages/add-vehicle/AddVehicle.tsx:120,135`); plus `pages/LocalVehicle.tsx:351` lightbox and `components/vehicle/ScoreDetailModal.tsx`. Most are `<div className="fixed inset-0 ...">` with no `role="dialog"`, no `aria-modal="true"`, no Escape handler, no focus return on close.
- **Canon:** design-book/02-components.md `DetailPanel` is the slide-in variant; this primitive is the centered-dialog variant. V-20 (focus rings), V-01/V-02 (no radius, no shadow). The exception that proves the rule (search overlay shadow) is documented; modals do **not** get that exception — depth is communicated via 2px border + `var(--surface-elevated)`.
- **Effort:** M (1 file, ~120 lines including focus trap + click-outside + escape)

```tsx
type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;                               // rendered into .card-header (h2 with id for aria-labelledby)
  footer?: React.ReactNode;                     // renders .card-footer
  size?: ModalSize;                             // 'sm'=320px, 'md'=480px, 'lg'=720px (4px-grid widths)
  children: React.ReactNode;
  className?: string;
  initialFocus?: React.RefObject<HTMLElement>;  // focus this element on open; default = first focusable in body
  ariaLabel?: string;                           // when no title, must provide aria-label
}

// Behavior:
//   - Backdrop: fixed inset-0, bg: rgba(0,0,0,0.4) (light) / rgba(0,0,0,0.6) (dark) — token: --backdrop (add to TOKENS.md)
//   - Click backdrop -> onClose
//   - Escape key -> onClose (capture-phase listener while open)
//   - Focus trap: first/last focusable in dialog cycle on Tab
//   - On open: store document.activeElement; on close: restore focus to it
//   - Body scroll lock while open (overflow:hidden on <body>); restored on close
//   - role="dialog", aria-modal="true", aria-labelledby={titleId} OR aria-label={ariaLabel}
//   - Container class: .modal-shell .card --surface-elevated --border 2px (reuse Card primitive internally)
//
// Migration pattern: the 5 settings/add-vehicle inline modals collapse into <Modal open onClose ...>.
// Lightbox stays separate (richer image-nav UX) but uses Modal primitive as the shell.
```

### 3.6 — `<TextInput>` / `<Select>` / `<Textarea>` — labeled, dark-mode safe, ARIA-correct

- **Target:** new `nuke_frontend/src/components/common/TextInput.tsx`, `Select.tsx`, `Textarea.tsx`
- **Problem:** 23 inline input patterns. Two on bounce-surface routes are unlabeled (`SearchBar.tsx:98-112` placeholder-only; `AuctionListing.tsx:172` bid input placeholder-only). Inputs lack consistent `aria-describedby` for help/error text.
- **Canon:** design-book/TOKENS.md "Input System" — base styles (8px padding, var(--fs-10), 2px var(--border), border-radius:0, var(--bg)) already defined. Focus state: `border-color: var(--border-focus)`, `outline: none` plus V-20 focus-visible.
- **Effort:** M (3 files, ~80 lines each, shared `<FieldShell>` wrapper for label/error/helpText)

```tsx
// All three share a FieldShell that renders <label> + input + helpText/error.
// label is REQUIRED; if visually hidden is needed, pass labelHidden (sr-only class).
// Eliminates the unlabeled-input bug class.

interface FieldShellProps {
  label: string;                       // REQUIRED — eliminates V-09-adjacent ARIA bug class
  labelHidden?: boolean;               // visually-hidden but screen-reader present
  error?: string;                      // renders aria-describedby=errorId, role="alert"
  helpText?: string;                   // aria-describedby=helpId
  required?: boolean;
  children: React.ReactNode;           // the actual input element
  htmlFor: string;                     // generated id for label/input pairing
}

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  labelHidden?: boolean;
  error?: string;
  helpText?: string;
  size?: 'sm' | 'md';
}

// TextInput, Select, Textarea each:
//   - Generate stable id (useId)
//   - Wrap children in FieldShell
//   - Apply .input-base class (already in unified-design-system.css; alias to existing input rules)
//   - aria-invalid={!!error}, aria-describedby={error ? errorId : helpId}
//
// Migration of SearchBar.tsx and AuctionListing.tsx:172 is a 2-line diff each.
```

### 3.7 — `useChartColors()` — Recharts theme bridge

- **Target:** new `nuke_frontend/src/hooks/useChartColors.ts`
- **Problem:** Recharts requires concrete string hex/rgba values for `fill`/`stroke`; can't read CSS variables. 9 chart files hardcode colors. `BidCompareOverlay.tsx` has 3 TODO comments flagging this. Dark mode doesn't propagate to charts.
- **Canon:** design-book/06-third-party.md (Recharts overrides), TOKENS.md "Chart Palette Tokens" (--chart-purple through --chart-olive, plus --success/--warning/--error). The ESLint plugin already allowlists `/recharts/i` paths — but allowlisting hides the dark-mode bug, doesn't fix it. The fix is reading tokens at runtime.
- **Effort:** S hook + M migration (9 files, ~3-line diff each)

```tsx
import { useEffect, useState } from 'react';

interface ChartColors {
  fg: string; muted: string;
  success: string; danger: string; info: string; warning: string;
  border: string; surface: string;
  series: string[];                    // 11 chart-* tokens in palette order
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(() => readTokens());
  useEffect(() => {
    const update = () => setColors(readTokens());
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'data-contrast'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

function readTokens(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const get = (k: string, fallback: string) => normalizeColor(s.getPropertyValue(k).trim()) || fallback;
  return {
    fg:      get('--text', '#2a2a2a'),
    muted:   get('--text-secondary', '#666666'),
    success: get('--success', '#16825d'),
    danger:  get('--error', '#d13438'),
    info:    get('--info', '#0ea5e9'),
    warning: get('--warning', '#b05a00'),
    border:  get('--border', '#bdbdbd'),
    surface: get('--surface', '#ebebeb'),
    series: ['--chart-purple','--chart-green','--chart-gold','--chart-teal','--chart-mauve',
             '--chart-lime','--chart-rose','--chart-slate','--chart-amber','--chart-sage','--chart-olive']
            .map(k => get(k, '#666666')),
  };
}
// normalizeColor: handles "rgb(...)" -> "#rrggbb", passes through hex.
```

### 3.8 — Dark-mode coverage extension (Tailwind compat layer)

- **Target:** edit `nuke_frontend/src/index.css` (add ~14 CSS rules; one block, no new tokens)
- **Problem:** 209 Tailwind utilities used in `src/` have no dark-mode override. Top misses: `bg-blue-50`, `bg-green-50`, `text-blue-600`, `text-green-600`, `border-blue-200`, `border-gray-200/300/400`. Coverage 43.7% → ~85% with one block.
- **Canon:** design-book/08-dark-mode.md — `[data-theme="dark"]` attribute selector pattern, no `dark:` Tailwind utilities (V-14). All overrides remap to existing tokens; zero new tokens.
- **Effort:** S (one drop-in CSS block, audit-appendix already provides the exact rules)

The block is in audit Appendix D verbatim; no design changes from foundation, just landing it. Important constraint per frontend.md "surgical edits": this is an additive ~14-line block, not a rewrite of `index.css`.

### 3.9 — Drop legacy `design-system.css`

- **Target:** edit `nuke_frontend/src/components/image/ImageLightbox.tsx` (drop 1 import line); port `.img-lightbox` and `.close-btn` rules into `unified-design-system.css`; delete `design-system.css`.
- **Problem:** Phase 1 audit said 92 files imported legacy CSS. Stream D corrected this — only **1 file** still does. The legacy file is otherwise dormant. Keeping it alive is a trap for future agents importing legacy tokens.
- **Canon:** frontend.md "Canonical CSS: `src/styles/unified-design-system.css` (legacy `design-system.css` is frozen)."
- **Effort:** S (~30 min as audit T2.3 estimates)

### 3.10 — ESLint rule extensions

- **Target:** edit `nuke_frontend/eslint-plugin-design-system.js` (add 3 rules)
- **Problem:** existing plugin catches `borderRadius`, `boxShadow`, hex colors, gradients, banned fonts. Does **not** catch the regression vectors that matter most for the primitive layer.
- **Canon:** VIOLATIONS.md "ESLint Rule Reference" table — extend, not replace. Each new rule maps to an existing violation entry.
- **Effort:** M (3 rules, ~40 lines each, plus tests)

```js
// Rule: no-div-onclick
//   Detects: <div onClick={...}> and <span onClick={...}> in JSX (V-13-adjacent, ARIA gap)
//   Message: "Use <button> or <Button>, not <div onClick>. Add role+keyboard if truly non-button."
//   Allowlist: contains role="button"|"tab"|"menuitem" AND tabIndex AND onKeyDown
//   Catches the 27 violations enumerated in audit Appendix E

// Rule: require-empty-state
//   AST pattern: ArrayExpression.map(...) inside JSX without preceding length check
//   Message: "Lists must guard against empty results. Use <EmptyState> or `if (!items.length) return ...`."
//   Detection: walk up from CallExpression(callee.property.name === 'map') — if direct JSX parent has no preceding
//     ConditionalExpression / LogicalExpression checking .length, warn.
//   Allowlist: file path /\.test\.|\.stories\./

// Rule: no-large-font-size
//   Catches: fontSize: '14px'|'16px'|'1rem'|'1.25rem' etc. in style props (V-05/V-15)
//   Allowlist: fs-13 (header wordmark), files matching /landing/i (marketing pages exempt)
//   Numeric values > 13 trigger the rule.
```

A fourth optional rule — `no-non-grid-spacing` (catches padding/margin/gap not in {4,8,12,16,20,24,32,40,48}) — is **deferred** per frontend.md "surgical edits"; existing 4px-grid violations are too numerous for a hard error and would require widespread eslint-disable. Defer until base ratchets down.

### 3.11 — Mobile breakpoint discipline (the bounce-surface fix)

- **Target:** edit two files (`pages/BrowseVehicles.tsx:426`, `pages/AuctionMarketplace.tsx:529,578`); decide HomePage treemap fallback (T0.4)
- **Problem:** 9 of 13 public routes break at 375px. `grid-cols: repeat(auto-fill, minmax(220px, 1fr))` overflows below 240px viewport. HomePage treemap has zero responsive breakpoints.
- **Canon:** design-book/04-screens.md "Universal screen rules" — every screen must be usable at 375px (the canonical mobile breakpoint).
- **Effort:** S per grid (5-line CSS edits); separate decision for HomePage treemap (foundation team scopes only the grid fix; HomePage treemap is a projection-team decision).

This is in scope because the grid breakpoint pattern recurs. After fixing these two, codify: every `repeat(auto-fill, minmax(N, 1fr))` grid in primitives must have a `< 480px` fallback. The pattern goes in design-book/04-screens.md as a screen-rule amendment.

---

## 4. First ship

**The trio: `LoadingSkeleton` + `EmptyState` + `useToastError` (entries 3.1, 3.2, 3.3).**

Three files, ~115 lines total, zero new tokens, zero new dependencies (`react-hot-toast` already imported). Ship them in one PR, mount the `<Toaster>` in `App.tsx`, do not migrate any call sites yet — just make the primitives available.

Why this trio, not Card or Modal:

1. **Highest call-site coverage.** Every page that fetches data (effectively every public route) needs at least two of the three. Card/Modal are concentrated in settings and add-vehicle flows; the trio touches the entire bounce surface.
2. **Zero teardown.** Nothing exists today to migrate from. Card replaces inline patterns; the trio replaces *nothing* (text strings, blank divs, silent catches). No code path regresses on day one.
3. **Compounds with future migrations.** When the next agent migrates `Card` into `BrowseVehicles.tsx`, they're already touching the file — they add the `<EmptyState>` and `useToastError` calls in the same surgical edit. Strangler-fig adoption gets free lift.
4. **Closes a click-anxiety asymmetry on its first deploy.** Per the contemplation: one broken interaction (silent RPC failure → blank screen) destroys trust built by four good interactions. The trio is a defense against the worst class of trust-damaging events: failures the user can't see. Even if zero call sites adopt the trio on day one, mounting `<Toaster>` and `<ErrorBoundary>` at App.tsx root means render errors and uncaught promise rejections start surfacing immediately.
5. **Verifiable in one grep.** `grep -r "LOADING…" src/` count before/after; `grep -r "\.catch(() => {})" src/` count before/after. The audit gives baselines (11, 24); future agents measure adoption with ripgrep, not opinion.

---

## 5. Compounding moves

**Adoption strategy: strangler-fig.** Per frontend.md ("surgical edits, not rewrites") and audit guidance ("Don't refactor monoliths atomically"). Migrate one inline pattern when the next functional change touches its file. No flag-day refactor PRs. The primitive layer becomes the path of least resistance, not a forced migration.

**Order of effort, week by week:**

1. Trio ships → primitives available, no migrations forced.
2. ESLint rule `no-div-onclick` ships in warn-only mode for two weeks → inventory the 27 violations live; no build breakage. Promote to error after the count is dropping.
3. Card / Modal / TextInput primitives ship → settings pages and add-vehicle migrate as the next bug fix in those files lands.
4. `useChartColors` ships → 9 chart-file migration is one PR (it's mechanical, all files use the same Recharts API).
5. Dark-mode CSS block + legacy `design-system.css` deletion → one PR, ~30 min.
6. Mobile grid fixes → two surgical CSS edits, ship with the trio if the agent has bandwidth.

**Lint rules that prevent regression** (the foundation team's deliverable beyond components):

- `no-div-onclick` → forbids the next 27 from being added
- `require-empty-state` → forbids new `.map()` over potentially-empty arrays
- `no-large-font-size` → forbids the 14px/16px drift back into the codebase
- existing rules continue as-is

**The compounding logic:** every primitive that ships shrinks the inline-pattern count. Every lint rule that ships shrinks the regression vector. After 4-6 weeks of strangler-fig migrations, the count of inline `<div className="fixed inset-0 ...">` modal patterns goes from 5 to 0; the count of unlabeled inputs goes from 23 to 0; the count of silent RPC catches goes from 24 to 0. The primitives don't need to be adopted everywhere to be successful — they need to be the path of least resistance for the next change.

---

## 6. Constraints

Per frontend.md, design-book canon, and the Auto-mode brief:

- **Surgical edits only.** Each primitive is a new file. ESLint extensions and CSS additions are additive, not rewrites. A bug fix is 3-10 lines, not 400.
- **No new design tokens.** Every recipe above uses existing CSS variables from `unified-design-system.css`. The one exception (`--backdrop` for Modal) is flagged as a TOKEN NEEDED in TOKENS.md (matching the existing pattern for `--z-*` tokens that are also pending).
- **No new design system.** Mirror `Button.tsx`: variant + size + className + class builder. No CSS-in-JS, no styled-components, no new style infrastructure.
- **No new toast library.** `react-hot-toast` is already a dependency. Use it. The `useToastError` hook is a 30-line wrapper, not a replacement.
- **No new icon system.** EmptyState explicitly does not accept an `icon` prop (audit-appendix recipe is overruled here). V-16 forbids decorative icons.
- **No removed canonical rules.** The global `* { border-radius: 0 !important; box-shadow: none !important; }` stays. The Three Absolute Rules stay. The primitive layer enforces them by default; it does not erode them.
- **No skeleton animation.** Audit-appendix used `animate-pulse`; that violates V-10. Skeletons are static `bg-[var(--surface)]` fills.
- **No flag-day refactor.** Strangler-fig adoption only. Each migration ships with a feature change to that file.
- **Out of scope for this team:** intake/forms (intake team owns AddVehicle.tsx and form fields); public-route content (projection team owns HomePage treemap decision, OrganizationProfile content); bundle/CLS (performance team owns vite.config.ts, image dimensions, lazy-loading).

---

## 7. Verification

Each primitive has a measurable adoption metric. Run after every migration PR; trend toward zero on the inline-pattern count, toward N on the import count.

| Primitive | Inline-pattern count (target → 0) | Import count (target ↑) | Detection method |
|---|---|---|---|
| `LoadingSkeleton` | `rg "LOADING\.{1,3}\s*<" src/` count of ad-hoc text fallbacks | `rg "from.*common/LoadingSkeleton" src/` | grep both, compare delta over time |
| `EmptyState` | `rg "\.map\(" src/` count of unguarded `.map()` calls (filter to ones inside JSX, not utility code) | `rg "from.*common/EmptyState" src/` | manual triage initial pass; lint rule `require-empty-state` automates ongoing |
| `useToastError` | `rg "\.catch\(\(\) => \{?\}?\)" src/` count of silent catches | `rg "useToastError" src/` | grep both |
| `Card` | inline `border: 2px solid var(--border)` patterns in `style={...}` JSX | `rg "from.*common/Card" src/` | initial inline-count baseline = 51 (audit) |
| `Modal` | `rg "fixed inset-0" src/` count of inline modal overlays | `rg "from.*common/Modal" src/` | baseline = 5 settings/add-vehicle, plus 2 lightbox sites |
| `TextInput` / `Select` / `Textarea` | inline `<input>` without `<label>` parent or `aria-label` | `rg "from.*common/(TextInput|Select|Textarea)" src/` | accessibility audit re-run; baseline 2 unlabeled on bounce-surface routes |
| `useChartColors` | `rg "fill=\"#" src/` and `rg "stroke=\"#" src/` inside files matching `*Chart*.tsx` or `*recharts*` | `rg "useChartColors" src/` | baseline 9 chart files |
| Dark-mode coverage | Tailwind utilities with no `[data-theme="dark"]` rule (script crawls `src/index.css` overrides vs. `class="..."` usage) | n/a | baseline 43.7%; target ≥85% |
| Legacy CSS holdout | `rg "import.*design-system\.css'" src/` (NOT `unified-design-system.css`) | n/a | baseline 1 (`ImageLightbox.tsx`); target 0; then `rm src/styles/design-system.css` |

**ESLint rule counts:**

- Run `npm run lint -- --rule 'design-system/no-div-onclick: error'` → baseline 27 (audit), target 0 over time.
- `npm run lint -- --rule 'design-system/require-empty-state: error'` → initial inventory unknown; target 0 after migration wave.
- `npm run lint -- --rule 'design-system/no-large-font-size: error'` → initial inventory unknown; target 0.

**Acceptance gate per primitive:** when the inline-pattern count reaches 0 for a primitive, the lint rule that prevents its regression flips from `warn` to `error`. The primitive is then permanent — the codebase enforces its own canon.

---

*"Consistency is the currency of trust, and every exception is a potential trust violation. The primitive layer is where consistency compounds — fix it once at the source and every downstream surface gets less broken by default. The asymmetry that makes one bad click cost four good ones works in our favor too: one well-built primitive earns trust on every use."*
