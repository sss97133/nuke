# Projection Team — Fix Plan

**Date:** 2026-05-06
**Team:** Projection (the windshield, not the cockpit)
**Lead:** projection lead
**Scope:** Browser + Archivist surfaces. What strangers see when they land at nuke.ag.
**Status:** working paper. Spec, not status.

---

## 1. Mission

Substrate-as-projection shipped 2026-05-02. Cockpit tools now project atoms into journal pages, work-logs, money flows. The promise was: every cockpit tool is also the visitor surface, because the projection IS the rendering. PROJECT_STATE.md (line 50, 53) claims `/me/money` and `/journal` are LIVE public surfaces; the route registry says otherwise. **Both are unmounted in `routes/DomainRoutes.tsx`.** This team owns the gap between substrate density and visitor experience — turning built-but-invisible code into product surface, and making the Browser scroll and the Archivist drill (per `docs/library/intellectual/contemplations/the-three-users-and-the-finder.md` §I-II). The vehicle profile is the canonical computation surface (per `docs/library/technical/design-book/vehicle-profile-computation-surface.md`); every projection page is a filtered view of the same timeline atoms, not a parallel display system.

---

## 2. Current state

### What is reachable today (public projection surfaces)
- `/` — HomePage (TreemapHomePage when logged out, Hub when authed)
- `/search` — Search
- `/browse` — BrowseVehicles
- `/map` — PublicMap
- `/auctions`, `/auction/:listingId` — auction marketplace + detail
- `/vehicle/:id` — vehicle profile (the computation surface)
- `/profile/:userId` — public user profile
- `/profile/external/:externalIdentityId` — external-identity profile
- `/org/*` — organization module (mix of public + protected internally)
- `/market/*` — Marketplace module: `/market` (dashboard), `/market/segments`, `/market/segments/:slug`, `/market/trends`, `/market/map`
- `/builds/:vehicleId` — BuildDashboard (public, vehicle-scoped)
- `/t/:transferId` — transfer party page
- `/developers`, `/docs/*`, `/api`, `/api/landing` — developer landing surfaces

### What exists as code but visitors cannot reach
- **`/journal`** → `pages/journal/JournalIndex.tsx` (105 lines, full `/api/journal` contract, 90-day density table). Zero references in `routes/`.
- **`/journal/:date`** → `pages/journal/JournalPage.tsx` (247 lines, full `/api/journal/:date` contract, atom-attributed photo grid + work orders + receipts with scope badges, projection_event_id surfaced). Zero references in `routes/`.
- **`/me/money`** → does not exist. `ShopFinancials.tsx` is rendered inline inside `pages/Profile.tsx:960` (own profile, financial tab) and `pages/Capsule.tsx:222`. There is no discoverable URL for it. Stream B grep for `/me/money` returned zero matches.

### What is claimed as live but isn't (PROJECT_STATE.md lies)
- Line 50: "Frontend page at `/me/money` (`ShopFinancials.tsx`) consumes `[project_money_flow]`" — false. No such route.
- Line 53: implies `/journal` is live as a public projection surface — false. Component file exists; route does not.

### What's projecting cleanly
- The vehicle profile (`/vehicle/:id`). The substrate-as-projection paradigm is real here — `VehicleProfileContext.timelineEvents` merges `timeline_events` and `work_sessions` into one render path. Day Card popups load via `get_daily_work_receipt` RPC. This is the model the rest of projection should follow.

### What's not projecting cleanly
- The **organization profile** (`pages/OrganizationProfile.tsx`, 4,268 lines). It uses an `OrganizationIntelligenceService` and a `DynamicTabBar` that compute tabs from intelligence — but the substrate atoms behind those tabs aren't going through the same projection-event pattern as journal. It's a parallel display system. (Out of immediate scope; flagged for compounding work.)
- **MarketDashboard** (`pages/MarketDashboard.tsx` — see audit T1.3). It iterates over arrays without empty-state branches and renders pulse divs without text. The `market_segments` substrate is real; the surface treats it as though it might fail silently.

---

## 3. The fix list

Each fix below has: title, file:line, problem, recipe, canon citation, effort. S = under an hour. M = half-day. L = day. XL = multi-day with backend coordination.

### F1 — Mount `/journal` and `/journal/:date`
- **File:line:** `nuke_frontend/src/routes/DomainRoutes.tsx:106` (lazy import) and `nuke_frontend/src/routes/DomainRoutes.tsx:184` (route block, immediately after the BuildDashboard route at 184, before the line 187 hub-redirects block).
- **Problem:** Two journal pages exist, fully wired to `/api/journal` and `/api/journal/:date`. Neither has a `<Route>` line. PROJECT_STATE.md asserts they're live.
- **Recipe** (exact insertion, two blocks):

  After line 106 (immediately after `BuildDashboard` lazy import), add the imports:
  ```tsx
  // Journal — substrate-projected work-log discovery + day page
  const JournalIndex = React.lazy(() => import('../pages/journal/JournalIndex'));
  const JournalPage  = React.lazy(() => import('../pages/journal/JournalPage'));
  ```

  After line 184 (immediately after `<Route path="/builds/:vehicleId" element={<BuildDashboard />} />`), inside the **Public pages** block, add:
  ```tsx
  {/* Journal — substrate-projected public discovery + per-date page */}
  <Route path="/journal" element={<JournalIndex />} />
  <Route path="/journal/:date" element={<JournalPage />} />
  ```

  Note: `/journal/:date` MUST come after `/journal` in the registry, or react-router v6 will still resolve correctly (path specificity), but ordering keeps the diff readable.

- **Canon:** PROJECT_STATE.md line 53 (claim of liveness); audit T0.1; `the-three-users-and-the-finder.md` §I.3 (the Browser needs surfaces to scroll); `vehicle-profile-computation-surface.md` (every page is a filtered timeline view — journal IS a date-filtered timeline view).
- **Effort:** S (5 minutes; two-block diff).

### F2 — Mount `/me/money` (or correct PROJECT_STATE)
- **File:line:** `nuke_frontend/src/routes/DomainRoutes.tsx:195` — inside the protected-routes block, near `<Route path="/profile" element={<UserProfile />} />`.
- **Problem:** PROJECT_STATE claims this exists. It doesn't. `ShopFinancials.tsx` is currently embedded as a tab inside `Profile.tsx:960` and `Capsule.tsx:222`, with no addressable URL. The substrate (`project_money_flow`) is live; the surface isn't.
- **Recipe options:**
  - **(a) Mount it as a protected route.** Add lazy import after F1's journal imports:
    ```tsx
    const ShopFinancials = React.lazy(() => import('../pages/ShopFinancials'));
    ```
    Then inside the protected-routes block (line 193 `<Route element={<ProtectedRoute />}>`), after `/profile`:
    ```tsx
    <Route path="/me/money" element={<ShopFinancials />} />
    ```
    Tradeoff: ShopFinancials has no AppLayout wrapper — it depends on Supabase queries directly. Verify it doesn't break under direct route mounting (it won't; it's a self-contained component).
  - **(b) Correct PROJECT_STATE.md.** Change line 50 to reflect that ShopFinancials is currently embedded in Profile/Capsule tabs and has no standalone route. Park the standalone surface until there's a reason to ship it.
- **Recommendation:** **(a) Mount it.** It's a 5-line change that makes the cockpit/projection paradigm real for the second projection page. Money flow is the second-most-important Archivist surface after timeline (per `the-three-users-and-the-finder.md` §I.2 — "every column rendered, every source visible").
- **Canon:** PROJECT_STATE.md line 50 (claim); audit T0.2; `the-three-users-and-the-finder.md` §I.2 (Archivist mode = "the Bloomberg terminal" — money flow is exactly that).
- **Effort:** S (10 minutes including verifying ShopFinancials renders standalone).

### F3 — Reaffirm or rewrite PROJECT_STATE.md after F1+F2 land
- **File:line:** `/Users/skylar/nuke/PROJECT_STATE.md:50,53`
- **Problem:** Two false liveness claims pointing at unmounted code. Future agents (and external agents on the API) will trust these claims.
- **Recipe:** After F1 and F2 ship, no edit needed — the claims become true. If F2 takes option (b), edit line 50 to: `"ShopFinancials.tsx renders inside /profile (own) and /capsule. No standalone /me/money route — surface deferred."`
- **Canon:** audit T0.3; this is hygiene, not architecture.
- **Effort:** S.

### F4 — Make journal a real Browser surface (not just a print-CSS density table)
- **File:line:** `nuke_frontend/src/pages/journal/JournalIndex.tsx:17-29`
- **Problem:** The page renders a 90-day density table in inline-styled monochrome — Arial + Courier New, 2px borders, no design tokens. It works as a print artifact; it's invisible as a Browser surface. The Three Users essay names this exact failure mode (§I.3): "the Browser needs beautiful cards, good images, quick summaries." A 90-row dense table with `r.top_vehicle_id.slice(0, 8)` as the only vehicle reference is Archivist-mode cosplay, not Browser-mode utility.
- **Recipe:**
  1. Keep the existing table as the Archivist density view (it's correct for that mode).
  2. Add a Browser-mode default: above the table, render the top 5-10 most-active days as cards — date + photo count + vehicle thumbnail (resolve `top_vehicle_id` to `vehicle_images` hero) + "X photos / Y receipts / $Z out". Click navigates to `/journal/:date`.
  3. Use `var(--bg)`, `var(--surface)`, `var(--border)`, `var(--text)` instead of inline `#000`/`#fff`/`#666`. Replace inline styles with tokens; the page currently violates `frontend.md` (uses Arial which is fine, but hardcodes color values).
  4. **Backend dependency:** the `vw_journal_density` view returns `top_vehicle_id` as a UUID. To render hero thumbnails the page needs the vehicle's hero image URL. Either (i) extend the view to join `vehicle_images` for the hero, or (ii) add a follow-up fetch. Prefer (i) — the projection should be self-sufficient.
- **Canon:** `the-three-users-and-the-finder.md` §II ("one interface, three modes") — the journal needs both Browser (cards) and Archivist (density table) modes; `frontend.md` (zero hardcoded colors).
- **Effort:** M (frontend), plus S backend if extending the view. Total M-L.

### F5 — Make journal day page show vehicle context, not just UUIDs
- **File:line:** `nuke_frontend/src/pages/journal/JournalPage.tsx:172-178, 230-235`
- **Problem:** Both photo cells and receipt rows reduce vehicle attribution to `vehicle_id.slice(0, 8)`. A visitor cannot tell what vehicle is being worked on. The link target `/vehicles/${p.vehicle_id}` is also wrong — the canonical route is `/vehicle/:id` (singular, per DomainRoutes line 135 and design-book screen spec).
- **Recipe:**
  1. Change link from `/vehicles/${p.vehicle_id}` to `/vehicle/${p.vehicle_id}`. (Hard bug: every photo link in the day page is currently broken — it 404s into the catch-all redirect.)
  2. Resolve `vehicle_id` to a YMM string and (optionally) hero thumbnail. Either backend-side (extend `/api/journal/:date` payload to include resolved vehicle YMM per photo) or via a single batched `vehicles?id=in.(...)` query in the page.
  3. Photo grid uses `gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))"` — at 375px viewport that crushes (audit T1.7 same family). Add `@media (max-width: 768px) { grid-template-columns: 1fr }`.
- **Canon:** design-book `04-screens.md` Vehicle Profile route (`/vehicle/:id`); `vehicle-profile-computation-surface.md` §"Do Not Create Parallel Systems" (link to the canonical profile, never invent alternative URLs).
- **Effort:** S for the link fix (a 1-character change). M including YMM resolution + responsive grid.

### F6 — Mobile responsiveness on the public projection routes
- **File:line:**
  - `pages/journal/JournalIndex.tsx:23` — table grid `120px 40px 80px 80px 110px 110px 1fr` overflows 375px viewport.
  - `pages/journal/JournalPage.tsx:95` — photo grid (covered in F5.3).
  - `pages/MarketDashboard.tsx` — covered in audit T1.3 / T1.7.
- **Problem:** Audit appendix A.1 — 9 of 13 public routes are HIGH or CRITICAL mobile risk. Both journal pages are MEDIUM. The Browser persona is mobile-first (per the essay's framing of "scroll the listings" — that's a phone gesture).
- **Recipe:** Add a `@media (max-width: 768px)` block to each page that collapses multi-column grids to single column. For `JournalIndex` density table, hide low-density columns below 600px (keep date + dollars; drop photo count + receipt count). For `JournalPage` photo grid, single column.
- **Canon:** audit T0.4, T1.7; `the-three-users-and-the-finder.md` §III.1 (sidebar adapts to context — same gesture, contents reflow).
- **Effort:** S per page; ~2 hours total.

### F7 — Vehicle profile public render: hero image dimensions
- **File:line:** `nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx:38` (per audit T1.9 / appendix A.2 CLS suspect #2).
- **Problem:** Hero `<img>` lacks `width`/`height` attributes. Browser cannot reserve space; layout shifts on image load. CLS spike on the highest-traffic public route.
- **Recipe:** Wrap in aspect-ratio container (`aspect-ratio: 4/3` matches design-book §Vehicle Profile spec). Three-line CSS change. Foundation team owns the LoadingSkeleton primitive — projection team owns making sure the skeleton matches the loaded layout.
- **Canon:** `04-screens.md` Vehicle Profile §Layout Spec ("4:3 aspect"); audit T1.9; performance-team will handle any further CLS work but this one is structural.
- **Effort:** S.

### F8 — Empty-state branches on MarketDashboard and BrowseVehicles
- **File:line:**
  - `pages/MarketDashboard.tsx:87` (audit T1.3)
  - `pages/BrowseVehicles.tsx:762` (audit T1.3 — second `.map()` over potentially empty array)
- **Problem:** `.map()` over arrays with no length guard. Lists vanish silently on zero-result responses. Frontend rule (`frontend.md` §"No Empty Shells") explicitly forbids this.
- **Recipe:** Wrap each `.map()` with `if (!items?.length) return <EmptyState ... />` (foundation team ships the primitive). Until that primitive lands, inline a minimal version: `<div style={{ padding: 24, fontSize: 12, color: 'var(--text-secondary)' }}>NO RESULTS — TRY DIFFERENT FILTERS</div>`.
- **Canon:** `frontend.md` §"No Empty Shells"; audit T1.3.
- **Effort:** S per file.

### F9 — Organization profile public render: lazy-load tab bodies
- **File:line:** `pages/OrganizationProfile.tsx:38` (`OrganizationOfferingTab` is statically lazy but eagerly resolved on route entry per audit T1.10).
- **Problem:** Path-to-interactive on `/org/:slug` is 618 KB — the worst public-route offender. The substrate is real (org data); the rendering is over-eager.
- **Recipe:** Move `OrganizationOfferingTab` import inside the tab handler so it only loads when the tab is clicked. ~380 KB savings.
- **Canon:** audit T1.10. Performance team handles broader bundle work; this fix is in projection scope because it's a render-decision change (when to load which tab).
- **Effort:** S.

### F10 — Add Browser-mode summary to OrganizationProfile (compounding move, see §5)
- **File:line:** `pages/OrganizationProfile.tsx:1-200` — top of page, before tab bar.
- **Problem:** The org profile drops a stranger straight into a tab bar. There's no Browser-mode summary surface (logo, name, location, # vehicles in inventory, headline metric). Compare to `/vehicle/:id` which has a clear identity header before the tabs.
- **Recipe:** Above the `DynamicTabBar`, render an `<OrganizationSummary>` (new component, ~80 lines) that pulls from existing `OrganizationIntelligenceService` data. Logo + name + location + 3-stat strip + hero photo grid (most recent 4 inventory). This is the Finder Gallery View for an organization.
- **Canon:** `the-three-users-and-the-finder.md` §II ("vehicle profile view modes"); `vehicle-profile-computation-surface.md` §"Progressive Density" (orgs with sparse data should render less, not empty shells).
- **Effort:** M.

### F11 — MarketDashboard: render to substrate, not to placeholders
- **File:line:** `pages/MarketDashboard.tsx` (whole file)
- **Problem:** The market dashboard is a Browser surface for "what's hot in the market." It currently renders pulse divs for loading and silent failures. The substrate (`market_segments`, auction recency aggregates) exists.
- **Recipe:** Audit team owns the design. Projection team owns: (a) ship the empty-state branch (F8), (b) ship the loading skeleton matching the loaded layout, (c) verify the page reads from `market_segments` substrate via the same patterns as `/market/segments`. No new tables; no parallel queries.
- **Canon:** `vehicle-profile-computation-surface.md` §"Do Not Create Parallel Systems"; design-book `04-screens.md` Market Dashboard.
- **Effort:** M.

---

## 4. First ship

**Mount the journal.** F1, alone. Two-block diff in `DomainRoutes.tsx`. Five minutes of typing.

This is defended by four reasons. **One:** it costs nothing (no backend, no design, no migration) and it makes a 350-line projection surface real overnight. **Two:** it converts a PROJECT_STATE lie into a true statement, which restores trust in the project state file as a navigation aid for future agents. **Three:** the journal is the canonical "show me today's work" projection — it's the daily-cadence Archivist surface that proves the substrate-as-projection paradigm to anyone who lands on it. **Four:** unblocking it lets every subsequent fix in this paper (F4 through F6 specifically) start clocking against a reachable URL instead of an imaginary one.

F2 (mounting `/me/money`) is a strong second; it's a 5-line change of equivalent risk. Both should land in the same commit if possible — they're the same architectural move applied to two pages.

After F1+F2 land, F5's broken `/vehicles/:id` link is the first compounding bug to chase — every photo on the journal day page is currently a dead link, and that becomes user-visible the moment the route is mounted.

---

## 5. Compounding moves

Work that makes future projection pages mechanical instead of bespoke.

### C1 — Projection-page template
After F4 ships, the journal pages will have established a pattern: a chrome strip, a page header, a substrate-attribution meta line ("CONFIDENCE X% · Y ATOMS · EVENT abc12345"), a content area, a footer with archive-horizon disclosure. Extract this into `<ProjectionPageShell>` so the next projection page (`/me/money`, future per-vehicle build journals, future per-organization timeline projections) inherits the look and the substrate-provenance display for free. The shell holds the print-CSS-style discipline; new projection pages just supply the content area.

### C2 — Substrate-query hook
Both journal pages do raw `fetch("/api/journal[/...]")`. Per the cross-cutting `archiveFetch` rule and the broader projection vision, all projection surfaces should call substrate via a single hook (`useProjection(viewSlug, params)`) that handles loading/error/empty states uniformly and exposes the projection_event_id for provenance display. This becomes the projection-side analog of the `ingest-observation` rule — one entry point, one provenance pattern.

### C3 — Per-route atom-completeness check
The vehicle profile already has data-quality scoring (`VehicleDossierPanel` per `04-screens.md`). The same idea applied to projection pages: at render time, compute "what fraction of the atoms this view depends on actually exist?" Render a 0-100 dossier badge. For sparse vehicles/orgs/dates, the page renders less (per the Progressive Density doctrine) AND announces what's missing. This makes it impossible to ship a projection surface that lies about its own completeness.

### C4 — Tab-content lazy boundary
F9 is a one-off. The structural fix is: every multi-tab page (org profile, profile, dealer, vehicle profile) should put each tab's body behind a `React.lazy` boundary that only resolves on tab-click, not on route entry. Foundation team would own the wrapper component (`<LazyTabBody>`). Projection team would migrate call sites.

### C5 — Resolve UUIDs to renderable identities at the substrate layer
F5's UUID-shortening hack appears on journal pages, but the same pattern recurs everywhere a substrate row references another atom by id (org_id, vehicle_id, contact_id). The right fix is at the projection-event layer: any substrate query that returns an entity reference should also return a `display_label` and `display_thumbnail_url` resolved server-side. This becomes the contract for what a projection event payload looks like.

---

## 6. Constraints — what this team does NOT do

- **Intake and forms.** AddVehicle, RestorationIntake, Capture, TechCapture, the homepage as a Janitor surface — all owned by the intake team.
- **Primitives.** `<LoadingSkeleton>`, `<EmptyState>`, `<Modal>`, `<Card>`, `<TextInput>`, `<useToastError>` — all owned by the foundation team. Projection team consumes them.
- **Bundle and CLS performance.** Lazy-loading strategy, preload directives, chunking, image dimension reservations as a class — owned by the performance team. Projection team consumes outcomes; the only crossover is F7 and F9, which are render-decision changes (where to put the boundary), not optimization passes.
- **Backend / substrate / migrations.** New tables, new RPCs, new edge functions — owned by the substrate team. F4 and F5 may require small substrate extensions (joining `vehicle_images` for hero thumbs in `vw_journal_density`); those go through the substrate team as receipts.
- **The cockpit.** Internal Skylar-only tools (Capsule, DailyDebrief, AcquisitionPipeline, TeamInbox, BusinessSettings). Cockpit pages may project the same atoms as projection pages, but they're not the windshield.

---

## 7. Verification — how Skylar would know each fix landed

| Fix | Verification |
|---|---|
| **F1** | `curl -I https://nuke.ag/journal` returns 200 (not the SPA fallback redirect to /). Browser at `/journal` shows the density table. Browser at `/journal/2026-05-04` shows the day page (or `insufficient_substrate` empty state for dates with no work). |
| **F2 (option a)** | `curl -I https://nuke.ag/me/money` while authed → renders ShopFinancials. Logged-out → redirects to `/login`. |
| **F3** | `grep -n 'me/money\|/journal' PROJECT_STATE.md` returns lines that match reality (post-F1+F2 they will). |
| **F4** | Visit `/journal` on desktop. Scroll past the chrome strip — top section now has 5-10 day-cards with vehicle thumbnails before the density table starts. Cards use `var(--surface)` not `#fafafa`. |
| **F5** | Click any photo on `/journal/:date` whose `vehicle_id` is non-null — lands on `/vehicle/:id` (singular), 200 OK, real vehicle profile. Pre-fix: 404 → catch-all redirect to `/`. |
| **F6** | Open any of the touched pages at 375px viewport (Chrome devtools mobile preset) — single-column reflow, no horizontal scroll. |
| **F7** | Lighthouse run on `/vehicle/:id` shows CLS < 0.1 (currently the hero swap is the dominant CLS contributor). |
| **F8** | Force a zero-result query on `/market/dashboard` and `/browse?make=zzzz` — visible "NO RESULTS" message instead of blank list. |
| **F9** | Network tab on first load of `/org/:slug` — `OrganizationOfferingTab` chunk is NOT in the initial waterfall. Click the Offering tab — chunk loads then. |
| **F10** | Visit any `/org/:slug` — summary block (logo + name + 3 stats + 4-photo strip) renders above the tab bar. Sparse orgs render fewer stats; never an empty box. |
| **F11** | `/market/dashboard` empty state matches the loaded layout's overall shape; loading skeleton matches it; no silent failures (trigger by killing network briefly). |

---

## 8. Open questions for Skylar

1. **F2 option (a) vs (b)?** Mount `/me/money` now, or correct PROJECT_STATE and defer? The former is 5 minutes; the latter is 30 seconds. Recommendation is (a) but it's your call which projection-page-as-product surface matters next quarter.
2. **F4 backend extension.** Extending `vw_journal_density` to join `vehicle_images` for top-vehicle hero is a substrate-team task. Confirm projection team should file the receipt, or whether substrate team has it queued already.
3. **F10 OrganizationProfile redesign.** The existing 4,268-line file is a known monolith (audit T2.2). Adding a summary header is contained, but it's the seam where a strangler-fig refactor would naturally start. Confirm the team boundary — projection team adds the summary; refactoring the monster is a separate stream.

---

## 9. Out of scope — flagged but not owned

These came up during the read and belong to other teams, but are noted so they don't fall through cracks:

- Audit T0.4 (HomePage treemap mobile breakage) — intake team, since the homepage is a Janitor surface per canon (essay §VII).
- Audit T1.1 (LoadingSkeleton primitive) — foundation team.
- Audit T1.2 (`useToastError` primitive + error-boundary wiring) — foundation team.
- Audit T1.4-T1.6 (a11y: aria-label, focus traps, keyboard nav) — foundation team owns the Modal + tab primitives; projection team will migrate call sites once primitives ship.
- Audit T1.8 (1.2 MB maps preload on every page) — performance team.
- Audit T1.11 (mobile bottom nav coverage) — depends on which routes get added, which is partly a projection-team decision (we want `/journal` and `/market/trends` in the nav once F1 lands).

---

*This paper is the projection team's read of where the substrate-as-projection surface stands today. Cap is 500 lines; current line count well within. Next revision after F1+F2 ship and we can measure whether the mounting move alone unsticks visitor experience or whether the deeper rendering work (F4, F10, F11) is required.*
