# EXPLORE — EXECUTION PLAN FOR A FRESH AGENT (2026-07-12, post-marathon)

You are picking up the Nuke Explore terminal cold. The owner is dissatisfied with how it
LOOKS and with sessions that churn. Your job is to execute this plan, in order, with
proof gates. No relitigating decisions, no novel inventions, no plans-instead-of-outcomes.

## 0. Read first (30 min, non-negotiable, in this order)
1. `docs/features/explore/THEORY.md` — what Explore IS (the loop: EXPLORE→FIND→TRACK→USE),
   the identity law, One Query Language. This governs; do not re-derive.
2. `docs/features/explore/ANALYST_TOOLBOX.md` — the desk gap map, the FIVE moves,
   Data Foundation, refactor law (reading layers, never rebuilds).
3. `apps/nuke-capture-ios/docs/SESSION_HANDOFF_2026-07-12.md` (incl. end-of-night
   addendum) — exact state, running machines, flags, cleanup debt.
4. `apps/nuke-capture-ios/docs/PULSE_EXPERT_PANEL_2026-07-12.md` — design specs already
   produced (cohort header, drill pages, haptics, ZUI). Build from these, don't re-panel.
5. Repo-root `docs/design/HARD_RULES.md` — design canon.

## Ground rules (each one is a scar from this session)
- **Measure prod before theorizing.** Two "architecture problems" were single missing
  indexes (40s→0.3s read; 42.96s→38ms write). Repo ≠ prod; run the probe first.
- **Facts sacred:** never print a mean/median PRICE (distribution/position only; counts
  and years are printable). Missing datum renders honest-empty, never fabricated. Area ∝
  data always. Every metric must be defensible from measured coverage.
- **Screenshot → critique → fix (≥2 iterations) BEFORE showing the owner.** Never point
  him at anything you haven't inspected. Sim: iPhone 17 Pro
  `7086B1BA-4650-4EAB-9959-8D471DA3A6DF`, `SIMCTL_CHILD_NUKE_DEBUG_SCREEN=explore`.
- **Don't mint; inventory first.** The organ probably exists (tonight: unsold denominator
  in bat_listings, canonical_models, 13.9M comments, 628K raw snapshots — all "found").
- **Outcome + proof gate, not a plan.** A task ends at the verified result, with numbers.
- **One heavy DB actor at a time** (db-safety rules). Batch writes, watch lock waiters.
- Worktree `/Users/skylar/.worktrees/foundation-ios`, branch `fable5/ignition-ios`,
  push = TestFlight, CI owns build numbers. Commit only files you intended (other
  sessions' WIP coexists in the worktree — check `git status` before staging).

## State when you start (verify, don't assume)
- BaT devour running detached (`~/bat-backfill/backfill.log`, 5 workers, ~390/hr,
  ~61K tail ≈ 6.5 days, BaT-throttled). Check it's still eating.
- **Canonical swap: DONE + VERIFIED (2026-07-12 21:40).** Pivots are canonical now:
  model dim = **1,455 real nameplate groups** (was 113,327 junk strings), make = **152**
  (was 8,962). Top models are the real market: Porsche 911 20,087 · Corvette 19,399 ·
  Mustang 14,601 · Mercedes SL 8,655 · Camaro 8,469 · Land Cruiser 5,440 · C10 5,083.
  (Headline: the 911 is the single biggest nameplate in the market.) **Unresolved =
  271,882 cars** — the honest work queue for the resolution organs. County map organ
  deployed: mv_vehicle_county = 287,613 located vehicles + county_density_filtered live.
- Live on TestFlight: honest treemap (area=count), Era/Price/Gap lenses, focal pinch-zoom,
  Liquid Glass chrome, haptics, CohortDistributionCard (bell curve + overlay) on the
  cohort leaf, county map (make filter only).
- Prod RPCs ready but partially unwired: pulse metrics (p25/50/75, total_value,
  watch_sum/n, auction_med/market_med), `price_histogram`, `county_density_filtered`
  (deployed by the finisher).

## THE MISSION, in order

### 1. VISUAL QUALITY PASS — "make it look like Bloomberg built it" (the owner's #1 pain)
The bones are right; the finish reads amateur in places. Do a full sweep of Explore with
fresh eyes at retina quality, fix everything cheap, screenshot-proof each fix:
- The Map|Pulse segmented row still sits on an opaque strip — float it (same glass
  treatment as the rest; content edge-to-edge behind ALL chrome).
- Palette tuning: Era/Price/Gap ramps are functional but unloved — refine against real
  screenshots (quantile-rank spreading if cells bunch; keep lightness+hue moving together;
  colorblind-check). One shared lightness envelope across lenses.
- Typography/spacing polish on cells, header, legend, distribution card (tabular digits
  everywhere, consistent paddings, luminance-correct ink).
- Dark mode: verify every surface (screenshots in both appearances).
- Kill the dead code (handoff "CLEANUP DEBT" list) — it's load-bearing for clarity.
- Acceptance: a 6-screenshot board (make view ×3 lenses, drilled view, cohort leaf,
  map) that you would defend to a design director. No band, no collision, no mud.

### 2. Wire canonical identity into iOS (after verifying the swap)
Pivots now return canonical groups + an "Unresolved" group. Make the Unresolved cell
render as a distinct quiet cell (not a fake make) that drills to its cars; header
count stays honest. Verify Model pivot shows real nameplates ("Chevrolet Corvette"),
uncapped (~3.5K groups — the layout already handles all-nodes rendering; verify perf,
if it janks, cells below ~3pt render into a single Canvas layer, views for the rest).

### 3. Analyst Toolbox move 2 — the BaT Liquidity Panel
Per ANALYST_TOOLBOX family 4 + refactor law: build `mv_cohort_metrics` (per canonical
cohort × month: sell-through, median bid depth, watcher→bidder conversion, reserve-met
rate) reading from bat_listings; badge everything "auction slice." iOS: a compact
liquidity card on the cohort leaf under the distribution card. Counts/percentages are
printable; prices are not. Proof: screenshot with real cohort numbers + RPC timing <1s.

### 4. Calendar + hammer_predictions — DEADLINE 2026-07-15
"Ending this week" surface from bat_listings.auction_end_date (watched cohorts first).
Wake the dormant `hammer_predictions` ledger: score the prediction maturing 7/15,
record the methodology, start the public accuracy ledger. Do NOT let the date pass.

### 5. Saved screens → alerts (the retention loop)
Persist MarketQuery as named screens (server-side, owner-scoped), plus server-side
watchlist migration of PulseLists. Notifications: "new match on your screen" /
"watched auction ends in 24h" (11K/wk inflow makes both real).

### Standing flags
- `price_histogram` can exceed anon statement timeout under load → add index/timeout fix.
- `vehicles_by_filters` needs the one-retry pattern the distribution card uses.
- Model taxonomy junk ("Pickup", "Corvette Conver…") shrinks as canonical coverage grows;
  the hard tail needs the image/dossier resolution pass (Data Foundation program).

## What NOT to do
- No new visualization forms. No new tables without inventory proof. No re-paneling
  experts for questions the docs already answer. No "top-N" caps anywhere. No printed
  average prices. No showing the owner anything unscreenshotted. No plans that end at
  a decision — end at the verified outcome or a precisely named wall.
