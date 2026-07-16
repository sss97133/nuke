# Performance Fix Plan

**Team:** Performance (site speed + runtime safety)
**Date:** 2026-05-06
**Author:** performance-team agent
**Scope:** how fast a stranger sees content on nuke.ag, and whether the JS throws on first interaction
**Companion audits:** `UI_AUDIT_2026-05-05.md` (T1.8, T1.9, T1.10, Appendix A.2, Appendix A.3, Appendix F.5)

---

## 1. Mission

Skylar said "site is very slow" on 2026-05-06. The audit confirmed it: the entry page was preloading a 1.2 MB maps chunk that 90% of visitors will never use, vehicle/org heroes shift layout on image load (CLS), `/org/:slug` ships ~618 KB to interactive, and ~12 page files have unguarded `.map()`, raw `JSON.parse`, and uncaught promise rejections that turn an empty API response into a blank screen with a TypeError. **This plan turns those gaps into discrete, measurable fixes — no architectural rewrites, no rechunking, just bandwidth waste removed and runtime guards added.** The Vite chunk strategy is already correct; what's missing is the discipline around what gets preloaded, what reserves layout space, and what crashes on bad input.

---

## 2. Current state

### Initial-load weight on `/` (post-fix, pre-deploy)
| Asset | Uncompressed | Gzip est. |
|---|---|---|
| `index-URqYsp2N.js` (main bundle) | ~387 KB | ~115 KB |
| `vendor--dJefL9v.js` (React + zustand) | 249 KB | ~75 KB |
| `supabase-Dsb38-Dp.js` | 187 KB | ~55 KB |
| `index-DtrpZAYY.css` (app CSS) | 89 KB | ~22 KB |
| `vendor-KQkcjXO7.css` | 6 KB | ~2 KB |
| **`maps-BywiZ4mn.css` (still preloaded — 85 KB)** | 85 KB | ~17 KB |
| **Subtotal (deployed today)** | ~1003 KB | **~286 KB gzip** |
| **Subtotal (after maps-CSS fix)** | ~918 KB | **~269 KB gzip** |

### What's already shipped in this session (NOT yet deployed)
- `vite.config.ts:25-28` — `modulePreload.resolveDependencies` strips any `maps-*.{js,css}` from the entry-page modulepreload list.
- Verified in `dist/index.html` (post-build): the `<link rel="modulepreload" ...maps-*.js>` directive is gone. Entry page no longer preloads the 1.2 MB / 333 KB-gzip maps JS.
- **However:** `dist/index.html:50` still emits `<link rel="stylesheet" crossorigin href="/assets/maps-BywiZ4mn.css">` — that's a `<link rel="stylesheet">` not a `<link rel="modulepreload">`, so the resolveDependencies filter doesn't touch it. CSS is being statically hoisted because both `PublicMap.tsx:3` and `DeckGLMap.tsx:2` do `import 'maplibre-gl/dist/maplibre-gl.css'` at module scope and Vite globalizes it.

### What's still bleeding
1. **maps CSS preloaded on every route** — 85 KB / ~17 KB gzip, never used until `/map` (T1.8 residue)
2. **`/org/:slug` heaviest public route** — 170 KB OrganizationProfile chunk + 172 KB OrganizationOfferingTab chunk. Offering tab is already `React.lazy`, so the 618 KB number from the audit assumes the user has already clicked into Offering. Real `/org/:slug` first-paint without clicking Offering ≈ 446 KB gzip — still the worst public route, due to OrganizationProfile.tsx itself being a 4,268-LOC monolith with 27+ eager imports of its own widgets.
3. **CLS on vehicle hero + org logo** — `<img>` without `width`/`height`, no aspect-ratio container reserving space. (T1.9)
4. **Runtime error class** — Stream A.3 found ~12 files with 20-25 unguarded paths. Highest blast radius: unguarded `.map()` (blank screen + TypeError), raw `JSON.parse` (unhandled SyntaxError), uncaught promise rejections.
5. **Console pollution** — 558 `console.log` lines across `src/`. Audit said 281; current grep is higher. Esbuild minifier doesn't strip them. Each one is a string the JS engine has to evaluate on hot paths.

---

## 3. The fix list

### Fix 1 — Maps CSS preload removal (residue of T1.8)
- **Title:** stop shipping `maps-*.css` to entry page
- **Target:** `src/components/map/PublicMap.tsx:3`, `src/components/map/DeckGLMap.tsx:2`
- **Problem:** Both files do `import 'maplibre-gl/dist/maplibre-gl.css'` at module top. Vite hoists that into the static CSS link soup on `dist/index.html`. Maps users are <10% of public traffic; everyone else pays 85 KB / 17 KB gzip for nothing.
- **Recipe:** Remove the static `import` statements. Inject the CSS at runtime when the map mounts — either:
  - `useEffect(() => { import('maplibre-gl/dist/maplibre-gl.css'); }, [])` on the first map render, or
  - Inject a `<link rel="stylesheet" href="/assets/maps-*.css">` tag dynamically (file path resolved via `import.meta.glob` with `{ as: 'url' }`)
  - Cleanest: use Vite's `?inline` or `?url` import. Convert `import 'maplibre-gl/dist/maplibre-gl.css'` → `import mapStyleHref from 'maplibre-gl/dist/maplibre-gl.css?url'` then `<link rel="stylesheet" href={mapStyleHref}>` inside the map JSX. Vite ships the asset; the link only renders when the component does.
- **Verify:** rebuild, grep `dist/index.html` for `maps-`. Should return zero matches (currently one match for `.css`). On `/map`, network panel should show the maps CSS loading on demand.
- **Effort:** S (15 min including build + verify)

### Fix 2 — Vehicle hero image dimensions (T1.9, CLS)
- **Title:** reserve aspect-ratio space on hero `<img>`
- **Target:** `src/pages/vehicle-profile/VehicleHeroImage.tsx:144-156`
- **Problem:** `<img src={imgUrl} ... style={{ position: 'absolute', inset: 0, ... }} />` has no intrinsic dimensions. The wrapper has `height: var(--h-hero, 420px)` so the *outer* box is reserved — but the inner image swap from `null` → loaded shifts within. More critical: when the entire hero block renders without the image, browsers can't compute aspect ratio for hints like `<img sizes="...">` and content-visibility doesn't kick in.
- **Recipe:** add `width={1600} height={1200}` (or whatever the dominant 4:3 ratio is — verify with a sample of 10 vehicle hero URLs) directly on the `<img>`. The CSS `width:100% height:100% objectFit:fitMode` already takes precedence visually; the attributes give the browser the aspect ratio for paint accounting.
- **Verify:** Lighthouse CLS metric on `/vehicle/:id` before/after. Target: CLS ≤ 0.05 on first navigation.
- **Effort:** S (5 min)

### Fix 3 — Org logo dimensions (T1.9 cont'd)
- **Title:** add width/height to map org-detail logo
- **Target:** `src/components/map/panels/MapOrgDetail.tsx:147` and `:264`
- **Problem:** `<img src={logoUrl} alt={org.name} ... />` and the vehicle thumbnail `<img>` both lack dimensions.
- **Recipe:** vehicle thumbnail at line 264 already has `style={{ width: 40, height: 30 }}` — promote those to attributes: `width={40} height={30}`. For the logo at 147, read the surrounding style block, fix container to a fixed pixel size, set `width`/`height` attrs to match. Org logos are typically square or wide; pick `width={120} height={60}` and `objectFit: contain`.
- **Verify:** Lighthouse CLS on `/map` (after detail panel opens). Element-by-element: Performance pane → Layout Shifts panel → confirm no shifts attributed to org-detail panel.
- **Effort:** S (10 min)

### Fix 4 — `/org/:slug` defer non-default tabs
- **Title:** ensure OrganizationProfile only loads what the default tab needs
- **Target:** `src/pages/OrganizationProfile.tsx` (top of file: lines 1-44)
- **Problem:** OrganizationProfile.tsx already lazy-imports OrganizationOfferingTab (line 38) and most tabs. Good. **But** lines 5-17 are eager imports of:
  - `OrganizationTimelineHeatmap`
  - `SoldInventoryBrowser`
  - `ServiceVehicleCardRich`
  - `extractImageMetadata`
  - `DynamicTabBar`
  - `OrganizationIntelligenceService` (large service)
  - `VehicleThumbnail`
  - `getOrganizationProfileData` + `getOrganizationCompetitiveContext`
  - `AdminNotificationService`
  - `BroadArrowMetricsDisplay`
  - `VehicleCardDense` (3,184 LOC monster — eager!)
  This is what bloats the OrganizationProfile chunk to 170 KB.
- **Recipe:** keep eager: `DynamicTabBar`, `OrganizationIntelligenceService` (used to compute tab list), `VehicleThumbnail`, the two profile-stats services. Move to `React.lazy` (only used inside specific tab panels): `OrganizationTimelineHeatmap` (overview tab only), `SoldInventoryBrowser` (vehicles tab), `ServiceVehicleCardRich` (service tab), `BroadArrowMetricsDisplay` (intelligence widget), `VehicleCardDense` (multiple tabs but inside `Suspense` boundaries already). Audit the file's actual tab routing (lines 2213-3811) and tag each import accordingly.
- **Verify:** rebuild; check `dist/assets/OrganizationProfile-*.js` size; target ≤ 80 KB. Confirm overview-tab still renders with one round-trip on a fresh page load (network tab: count synchronous chunks).
- **Effort:** M (45-60 min including verification of which tab uses what)

### Fix 5 — Unguarded `.map()` over potentially-undefined arrays
- **Title:** `(arr ?? []).map(...)` discipline
- **Targets** (per Stream A.3):
  - `pages/VehiclePortfolio.tsx:319, 345, 273`
  - `pages/settings/WebhooksPage.tsx:183, 328, 351, 429, 544, 571`
  - `pages/settings/UsageDashboardPage.tsx`
  - `routes/modules/marketplace/MarketDashboard.tsx:87`
- **Problem:** `items.map(...)` blows up with `Cannot read properties of undefined (reading 'map')` when the API returns `null`/`undefined` or the state is mid-fetch. Result: white screen and a console TypeError that the user only knows by the absence of the page.
- **Recipe:** at each site, wrap in `(items ?? []).map(...)` or `items?.map(...) ?? null`. Where the array is meant to be non-empty, add an `if (!items?.length) return <EmptyState />;` guard before the map (uses the foundation team's `<EmptyState>` primitive — coordinate via UI_AUDIT_2026-05-05.md Appendix C).
- **Verify:** grep `\.map\(` across these files; each call should be preceded by `?` or `??`. Add an ESLint rule (`eslint-plugin-design-system`) that warns on `\w+\.map\(` where the receiver isn't `Array.from(...)`, an array literal, or known-non-null. (See compounding moves below.)
- **Effort:** M (per file ~10 min × 12 = ~2 hours)

### Fix 6 — Unsafe `JSON.parse`
- **Title:** parse defensively, default on failure
- **Targets** (per Stream A.3):
  - `contexts/VehicleProfileContext` (verify exact line)
  - `pages/DealerAIAssistant.tsx`
  - `pages/PersonalPhotoLibrary.tsx`
  - `contexts/ThemeContext.tsx:182` (already in our grep; confirm)
- **Problem:** `JSON.parse(localStorage.getItem('foo'))` throws `SyntaxError` if the value is corrupt (user manually edited storage, version mismatch after deploy, or the value is `null`/`undefined`). Throws synchronously inside render or effect → component crash, error boundary fires.
- **Recipe:** ship a tiny helper at `src/lib/safeJsonParse.ts`:
  ```ts
  export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  ```
  Replace each call site. No behavior change on the happy path; corrupt storage cleanly degrades to fallback.
- **Verify:** grep `JSON\.parse\(` across `src/`. Every call should be either `safeJsonParse(...)` or have a surrounding try/catch.
- **Effort:** S-M (helper + 4-6 call sites, ~30 min)

### Fix 7 — Uncaught promise rejections
- **Title:** every promise gets a `.catch(toast.error)` or coordinates with `useToastError()`
- **Targets** (per Stream A.3):
  - `pages/LocalDiscover.tsx`
  - `feed/components/DayCard.tsx` (verify)
  - `components/vehicle/VehicleDossierPanel.tsx` (verify)
  - Plus any of the silent-error sites listed in audit T1.2
- **Problem:** `supabase.from(...).select(...).then(setData)` without `.catch` → if the request fails, the user sees stale UI and a `Possibly unhandled promise rejection` in console. Not a crash, but the equivalent of a blank state with no recovery affordance.
- **Recipe:** **Coordinate with foundation team** — they own `useToastError()` per UI_AUDIT_2026-05-05.md Appendix C. Once the hook lands, wrap each promise via `useToastError()(promise)` or chain `.catch(err => toast.error(...))`. Until then, at minimum add `.catch(err => console.error('LocalDiscover load failed', err))` to prevent unhandled rejections — at least the error reaches the console with context.
- **Verify:** open Chrome devtools, throttle network to "offline", visit each page; expect a toast or, at minimum, a labeled console error — never a silent stall.
- **Effort:** M (depends on foundation hook landing first)

### Fix 8 — Unguarded numeric formatting
- **Title:** `(value ?? 0).toFixed(2)` discipline
- **Targets** (per Stream A.3):
  - `pages/AuctionListing.tsx`
  - `pages/InvoiceManager.tsx`
  - `routes/modules/marketplace/MarketDashboard.tsx`
- **Problem:** `value.toFixed(2)` throws if `value` is `null`, `undefined`, or a string. Common when the field hasn't loaded or the API returned a different type than expected.
- **Recipe:** at each site, `typeof value === 'number' ? value.toFixed(2) : '—'` or `(Number(value) || 0).toFixed(2)`. The em-dash fallback is the design-system convention for missing numerics (see `unified-design-system.css`).
- **Verify:** grep `\.toFixed\(` in target files; each call should be preceded by a guard.
- **Effort:** S (~20 min)

### Fix 9 — `console.log` audit (558 instances)
- **Title:** strip dev logs from production hot paths
- **Target:** `src/` (558 matches per current grep; audit said 281 — drift is in our direction)
- **Problem:** `console.log(...)` runs in production. The string interpolation cost is small per call but cumulative over render loops. More importantly: logs leak shape information about the data model to anyone with devtools open. Per platform-hygiene rules and `.claude/rules/agent-coordination.md`, dev-time logs should not ship.
- **Recipe:** two passes:
  1. **Mechanical:** Vite plugin `vite-plugin-remove-console` (or esbuild's `drop: ['console']` setting). One config-line change in `vite.config.ts`. Strips `console.log`/`console.debug` from production builds; preserves `console.error`/`console.warn`.
  2. **Surgical:** grep for `console.log` patterns that look like instrumentation we want to keep (e.g., `console.log('[BIDS]', ...)`) and migrate them to a `logger.debug()` wrapper that's gated on `import.meta.env.DEV`.
- **Verify:** rebuild prod; grep the output bundle for `console.log`. Should be zero or near-zero hits (only inside `console.error`/`warn` paths or strings).
- **Effort:** S (mechanical pass, 10 min) + L (surgical pass, deferred — not a launch blocker)

---

## 4. First ship — deploy what's already built

**The smallest unblocking move is to deploy `vite.config.ts` as it stands today and run a fresh build.**

The `modulePreload.resolveDependencies` change is in source. The build artifact reflects it (verified: `dist/index.html` no longer preloads `maps-*.js`). But the production deploy on `nuke.ag` is still serving the *old* `index.html` that includes the 1.2 MB / 333 KB-gzip phantom preload on every route. **Until we ship, every visitor still pays that toll.** That's the single largest perf delta available to us; it costs zero engineering effort because the work is done. Everything else in this plan compounds on top, but the deploy is the straight line.

Order of ops: (1) `git status` to confirm `vite.config.ts` change is clean, (2) commit + push, (3) Vercel deploy, (4) curl `https://nuke.ag/index.html` and grep for `maps-` — should return only the CSS reference (which Fix 1 will then handle in the next round). Total wall-clock: under 10 minutes.

---

## 5. Compounding moves — make future wins mechanical

### 5.1 Lint rule: no `<img>` without dimensions
Extend `nuke_frontend/eslint-plugin-design-system.js` with a JSX rule that warns on `<img>` elements lacking both `width` and `height` attributes (or a `data-no-dims` opt-out for cases where the parent reserves space via aspect-ratio container). One rule prevents the entire CLS-regression class from re-emerging.

### 5.2 `safeJsonParse` helper as the only allowed pattern
Once `src/lib/safeJsonParse.ts` exists, add a rule (or just CI grep) that fails the build on any `JSON.parse(` not wrapped in try/catch. The codebase's typical pattern is `localStorage`/`sessionStorage` reads; the helper covers 95% of cases.

### 5.3 `useToastError()` adoption (foundation team owns the primitive)
Foundation team is shipping `useToastError()` per UI_AUDIT_2026-05-05.md Appendix C. Performance team's compounding move: once the hook lands, sweep every `.then(setData)` site on the public-facing pages and migrate them. Single PR per page. Once adopted, every new fetch on a public page goes through the same observable error pattern — uncaught-rejection class is closed.

### 5.4 Pre-commit hook: `console.log` lint
Add a pre-commit hook (or the existing CI lint) that fails on a `console.log(` introduced in `src/` outside of `__tests__/`. Forces all new debug logging through `logger.debug()` (DEV-gated). After the mechanical strip, this prevents regression.

### 5.5 Bundle-size budget
Vite supports `build.chunkSizeWarningLimit` (already at 1000 KB). Add a *hard ceiling* via `rollup-plugin-size-snapshot` or a CI script that fails if any per-route gzip total exceeds 400 KB. Right now `/org/:slug` would fail at 446 KB — that's the kind of pressure that makes Fix 4 happen.

---

## 6. Constraints

- **No architectural rewrites.** The Vite chunking strategy is correct (`three`, `maps`, `charts`, `pdf`, `tesseract`, `supabase`, `vendor` all split appropriately). The bundle composition is fine. Wins come from removing waste (preloads, eager imports, unguarded paths), not from re-thinking module boundaries.
- **No Suspense boundary changes** beyond what's needed to lazy-import OrganizationProfile's eager service deps (Fix 4). The existing Suspense fallbacks at the route level are sufficient.
- **Coordinate with foundation team** on `useToastError()`, `<EmptyState>`, `<LoadingSkeleton>` — those are foundation deliverables. This team consumes them but does not duplicate them.
- **No source edits this session.** This is a working paper. Implementation lands in subsequent sessions, one fix per PR for verifiability.

---

## 7. Verification

| Fix | Verification method | Target |
|---|---|---|
| Maps preload deploy | `curl https://nuke.ag/index.html \| grep maps-` | one CSS hit (down from JS+CSS), eventually zero |
| Maps CSS removed | post-rebuild grep of `dist/index.html` for `maps-` | zero hits |
| Vehicle hero CLS | Lighthouse CLS on `/vehicle/:id` | ≤ 0.05 (was estimated 0.15-0.25) |
| Org logo CLS | Lighthouse CLS on `/map` (with detail panel open) | ≤ 0.05 |
| `/org/:slug` chunk size | `ls -la dist/assets/OrganizationProfile-*.js` | ≤ 80 KB (from 170 KB) |
| `/org/:slug` interactive weight | DevTools Network: sum of synchronous JS to TTI | ≤ 350 KB gzip (from 446 KB) |
| Unguarded `.map()` count | `grep -rn '\.\(map\|filter\)\(' src/ \| grep -vE '\?\.|\?\?'` line count | decreasing toward zero |
| `JSON.parse` safety | `grep -rn 'JSON.parse' src/ \| grep -v safeJsonParse` count | zero |
| Uncaught promise count | DevTools console on each public page | zero "Possibly unhandled rejection" |
| `console.log` count | post-build bundle grep `console.log` | zero (mechanical pass) |
| Lighthouse Performance | `/`, `/vehicle/:id`, `/org/:slug` | ≥ 85 mobile, ≥ 95 desktop |
| LCP on `/` | Lighthouse | ≤ 2.0s on simulated 4G |

### Cumulative gain modeling
| Stage | Initial-load gzip on `/` | LCP est. (4G) |
|---|---|---|
| Today (deployed prod) | ~286 KB + 333 KB phantom maps preload = **~619 KB** | ~3.0s |
| After deploy (Fix 0) | ~286 KB | ~1.5s |
| After Fix 1 (maps CSS) | ~269 KB | ~1.4s |
| After Fix 4 (org-profile eager-import audit) | ~269 KB on `/`, **`/org/:slug` from 446 → 350 KB gzip** | unchanged on `/`, big on `/org/` |
| After Fix 9 (console strip) | ~265 KB | marginal |

The first deploy alone is more than half the win.

---

## 8. Open questions / handoffs

- **Coordinate with foundation team** on `useToastError()` arrival. Performance team's Fix 7 depends on it.
- **Coordinate with projection team** on `/org/:slug` route mounting (per UI_AUDIT_2026-05-05.md T0.x); Fix 4 should be sequenced after any route-level changes they're making, to avoid merge conflicts inside OrganizationProfile.tsx.
- **No ISSUES.md additions yet** — the existing audit covers these (T1.8, T1.9, T1.10, A.2, A.3 entries). When fixes land, mark them in `.claude/ISSUES.md` per the QA-loop rule.
- **Browser walk still recommended.** Static analysis got us this far; pixel-level CLS validation and waterfall confirmation need a real Chrome session. When permitted, run Lighthouse against staging post-deploy and capture the delta as the first measurement against this plan.

---

## 9. Out of scope (handed off to other teams)

- Design tokens, primitives (`<Card>`, `<Modal>`, `<TextInput>`) → foundation
- Public route mounting (`/journal`, `/me/money`, T0.1, T0.2) → projection
- Forms / intake (`AddVehicle.tsx`, validation) → intake
- Mobile responsiveness (T0.4, T1.7, T1.11) → either foundation or a dedicated mobile team
- Component splits (T2.2, the 11 monsters) → strangler fig per author touching each file

This team's lane is: bandwidth waste, layout stability, runtime safety. Three properties, measurable, fixable per file:line, no architecture.
