# Build-Class Valuation Unlock — the plan

_Written 2026-06-23 after the labor-rate/valuation session. This is the gate that
blocks defensible pricing of builds. Everything below is grounded in the live DB
(project `qkgaybvrernstplzjaam`) and the iOS/edge code as it stands today._

## The one sentence
A resto-mod priced on stock-truck comps is wrong, so the app **deliberately blocks**
the market price for builds and points at the documented-investment floor instead —
and it stays blocked until comps are matched to the vehicle's **build class**. That
build-class signal doesn't exist yet at scale. Building it unblocks everything.

## What's already true (don't rebuild)
- **iOS `VehicleValuation.isThin`** blocks the price unless `comp_method == 'class_stratified'`.
  No vehicle has that, so every build shows "Not priced yet" → falls back to the ledger.
  (`VehicleDetailView.swift`, struct `VehicleValuation`.)
- **`compute-vehicle-valuation`** computes the comp estimate + 8 signals, but **clamps
  condition to neutral (1.0)** on purpose: condition_score is teardown-inclusive, so a
  finished resto-mod scores "project tier" — feeding it would be a condition-blind cut.
  (`getConditionMultiplier`, lines ~399-425.)
- **`get_vehicle_documented_investment`** = the defensible floor (burst-labor + catalog
  parts), now drawing its rate from the honest spitball engine.
- **`resolve_labor_rate`** = reported-wins-else-spitball; graduates to a real market rate
  at ≥30 authenticated shop rates (today: 5 → spitball).
- **`vehicle_condition_scores`** has `lifecycle_state`, `condition_tier`,
  `percentile_within_ymm`, `descriptor_summary` — but only **373 of ~18k** vehicles are
  scored, the taxonomy (worn/ghost/weathered/active_build) isn't a clean finished-vs-
  teardown classifier, and **no edge function writes the table** (one-time backfill).

## The three wires (in dependency order)

### 1. Build-class signal (the prerequisite for everything else)
Classify each vehicle's build state from image + observation evidence:
`stock | driver | restomod | project | in_progress`. Sources: `vehicle_condition_scores.
descriptor_summary`, `vehicle_observations.components_seen`, the burst-activity profile
(a vehicle with deep burst minutes + modern parts is a build, not a survivor).
**Do not cowboy this** — a wrong class mis-prices the car. Validate against known cases
(K5 = restomod) before it feeds anything. Output: a `build_class` column/field with
confidence + DNA, owner-overridable.

### 2. Class-stratified comps → unblock the market price
In `compute-vehicle-valuation`'s `getBasePrice`, when a build class is known, select comps
of the **same class** (restomod priced vs restomods). Set `comp_method = 'class_stratified'`.
That flips iOS `isThin` to false and the real market price shows — defensibly. Until then
the block is correct, not a bug.

### 3. Build-class-aware condition + a live pipeline
- Once build-class is known, stop penalizing a finished build scored from teardown photos:
  score condition **within class** (`percentile_within_ymm` already points this way).
- Stand up the missing writer: a live image→condition/build-class pipeline (edge fn + cron,
  check TOOLS.md / retire one per platform-hygiene) so coverage grows past 373 automatically.
  This is the "data handling perfected → it corrects itself" piece.

## Labor analysis layer (parallel, lower stakes)
- `resolve_labor_rate`'s difficulty/skill/region multipliers are 1.0 — wire them from real
  signals (build complexity, geography) when those exist. Don't fabricate.
- Authenticated market rate needs ≥30 verified shop rates (today 5). Ingesting/deriving
  more shop rates moves the rate from spitball → market. Model the posted-vs-accepted spread
  ("everyone hates paying $160") once acceptance data exists.

## Done-test
A built K5 shows a **defensible market price** (class-stratified comps), its condition
**lifts** value instead of being clamped, and the labor rate reads **market** (not spitball)
— each drillable to its evidence, each honest about its confidence.
