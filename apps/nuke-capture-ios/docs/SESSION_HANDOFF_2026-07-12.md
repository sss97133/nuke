# Session Handoff — 2026-07-12 (Pulse marathon, Opus → Fable)

**Read this + `PULSE_EXPERT_PANEL_2026-07-12.md` (the build bible) before touching Explore.**

Repo facts: iOS app LIVE on TestFlight, branch `fable5/ignition-ios`, worktree
`/Users/skylar/.worktrees/foundation-ios`. Push = Xcode Cloud → TestFlight (CI owns build
number). iOS 26 deploy target (full Liquid Glass). Sim: iPhone 17 Pro
`7086B1BA-4650-4EAB-9959-8D471DA3A6DF`, `SIMCTL_CHILD_NUKE_DEBUG_SCREEN=explore`.

---

## THE OPEN QUESTION (Skylar, session end): what IS Explore?

> "the explore tab, what it IS... the big IS. we were making graphs. graphs should be
> easier than this but we struggled a lot. graphs are just data visualizers."

The struggle diagnosis (own it, don't repeat it): the drawing was never the hard part —
**we kept iterating FORM to compensate for missing SUBSTANCE.** The data is a static
census (inventory counts, era, price). A census looks the same every day, so no amount of
treemap/spiral/scatter/color churn could make it feel alive. Every failed graph was the
same failure: decorating a phone book. The fix is upstream (see "census → pulse" below),
not another visualization.

Working thesis for the next session: **Explore = the market-read terminal. Map answers
WHERE, Pulse answers WHAT'S OUT THERE; the missing organ is WHAT'S MOVING** — and that is
a data capability (lifecycle/time-series), not a graph.

---

## SHIPPED THIS SESSION (all on TestFlight, chain 4184f1a65 → 284ea5e7f)

The Pulse treemap is now:
1. **A REAL squarified treemap** — verified Bruls/van Wijk, area = exact data share,
   fake uniform-tail cheat removed (Skylar caught it: "not doing the math is the issue").
2. **Focal pinch-zoom + pan** — squarify ONCE at zoom-1, cells scale ×zoom (self-similar
   canvas W×2.6H, crisp labels, exact focal math: `pan' = f − (f−pan)·(z'/z)`), drag pans
   with flick momentum, clampPan. No ScrollView (can't focal-zoom); NavigationLinks intact.
3. **iOS 26 Liquid Glass chrome** — no white block; glass pivot chips
   (`.buttonStyle(.glass)` in `GlassEffectContainer`), selection = tinted glass (never a
   solid slab), glass color-menu pill, `topInset = 96` keeps the first cell's label clear
   (pan clamps account for it).
4. **Haptics vocabulary** (`Haptics.swift`) — TICK (lens/pivot) / DROP (drill, weight ↑
   with depth) / LANDING (2-transient arrive-at-cars) / latch-vs-rigid Watch/Save.
5. **Color lenses Era + Price** — honest ramps (hue+lightness), luminance-correct ink,
   legend in header. **Fake "velocity" (sell-through) deleted** — it measured sold-flag
   coverage, not liquidity (Mustang 241/5185 flagged = 4.6% "slow": a data artifact).
6. Header: "551,413 listed" + live color key. Watch/Save/Share context menu + persisted
   `PulseLists` badges. County-choropleth Map + make filter (earlier, keep).

## LIVE IN PROD, NOT YET WIRED INTO iOS (the ready payload)

Backend RPCs extended + verified (migration `20260712120000_pulse_metrics_dispersion_arbitrage.sql`,
committed in nuke repo). Both `market_position` and `market_pulse_filtered` now also return:
`total_value, p25, p50, p75, price_n, watch_sum, watch_n, auction_med, market_med`.
- **Arbitrage lens (the killer, unique-to-us):** `auction_med/market_med − 1`. Real signal:
  Chevrolet +164% (auction $38,250 vs marketplace $14,500), Porsche +15% (liquid/tight).
  Guard NULL `market_med` (small groups); exclude-neither mapping documented in migration.
- **Dispersion lens:** QCD = (p75−p25)/p50 — "settled vs wild-west pricing," varies across
  the map, prints no price number.
- **$-value AREA mode:** Σ price (74% coverage) — money-weighted map vs count-weighted.
- **Demand:** watch_sum/watch_n (gate on watch_n; BaT-only ~5%/cohort).
- Timing: market_position 118ms; filtered drill <1s; **unfiltered `market_pulse_filtered`
  ('make', no filter) is 5.85s — never call it; top level stays on market_position.**

## DESIGNED, NOT BUILT (specs in the panel doc + this session's expert verdicts)

- **Ship 2 zoom-to-drill ZUI** ("meat and potatoes"): internal `levels` stack replaces nav
  push for make→model→year (leaf keeps NavigationStack via `Binding<NavigationPath>` —
  a UIScrollView/UIHostingController wrapper would sever NavigationLinks, rejected);
  prefetch children at ~55% viewport coverage (RPC <1s), commit level at 100%, pre-draw
  children INSIDE the cell (generalize the old foldCell mosaic) so the push is visually a
  no-op. **Zoom magnifies, drill renormalizes** — 4,800:1 power law needs drill, not 20× zoom.
- **Cohort endpoint header** (the "raw dog" leaf): reuse `CohortTerminalView`'s
  `DistributionBar` (median = unlabeled tick, extremes only — NEVER print avg/median price)
  + `get_make_model_terminal`; widget-shaped `CohortHeaderCard`; grid = holdings sorted
  priced-desc with band-position pips.
- **Year drill should be a chronological histogram**, not a treemap (years are ordinal).
- Tappable breadcrumb (needs explicit `[PulseRoute]` path), part-of-parent "11% of
  Chevrolet" captions, price lens scale → GLOBAL (currently relative per view = hue lie).

## THE CENSUS→PULSE UNLOCK (parked, needs Skylar's go)

Everything that makes color MOVE (days-on-market, sell-through, momentum, price cuts)
descends from ONE capability: `listing_snapshots` (row per listing per crawl) →
`listing_lifecycle` (first/last_seen, terminal_status incl. **removed_unsold** — the
missing denominator, sold_date, DOM). Survivorship + right-censoring guards specified in
the panel doc. This is also the reframed BaT write-path project (38 triggers, 25-33s/insert
throttle — profile, defer to drain queues, prove sub-second on 50 rows first).

## CLEANUP DEBT

Dead code in `MarketTreemapView.swift` from superseded experiments: `pack`, `tailNode`,
`foldCell`, `hybridLayout`, `PlacedCell`, `seam`, `PulseTailPage` (+ its ExploreView
destination), `isTail`, `tail` state, `tailFooter`, `injectedNodes/injectedTitle` path.
(Note: Ship 2b's nested-mosaic wants foldCell's Canvas approach — harvest before deleting.)
Also: `MarketFieldView.swift` was rejected, deletable. ExploreView landing sed-toggled
map↔treemap for screenshots several times — verify it ends on `.map`.

## HOW TO WORK THIS (what actually worked)

Build → screenshot in sim → critique BEFORE showing. Expert-panel subagents (per-page
owner, haptics, treemap-algorithm, iOS-26-glass, data-strategy) produced the breakthroughs;
Skylar explicitly wants "the team of experts" pattern. Every color/metric must be
defensible from measured coverage — when in doubt, measure prod first (that's how the fake
velocity died). Skylar's rulings this session: industry standard > novelty; the metric is
a haptic control; the phone is a window, not a frame; size must be the math of the data;
native Liquid Glass, no white blockout.
