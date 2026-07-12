# Session Handoff — 2026-07-12

This session ran very long and tangled several projects together. They're divided
below. **After compaction, run PROJECT A's NEW PROMPT — that's the live thread.**
Projects B and C are context, not the immediate job.

Repo facts (true for all): iOS app is LIVE (TestFlight, PR #278, branch
`fable5/ignition-ios`, worktree `/Users/skylar/.worktrees/foundation-ios`). iOS 26,
Swift 5, SwiftUI, XcodeGen. Supabase project `qkgaybvrernstplzjaam` (anon client in
app). Committing to `fable5/ignition-ios` triggers Xcode Cloud → TestFlight (CI owns
the build number — never bump it).

---

## PROJECT A — iOS Pulse: build an *intelligent* market graph  ◀ RUN THIS

### The state
`Explore` (Sources/NukeCapture/ExploreView.swift) is a market-read terminal with a
`Map | Pulse` toggle. **Map** = an honest US county choropleth (filled by listing
density) + a make filter ("where are the most X") — DONE, keep it. **Pulse** currently
renders `MarketTreemapView` and it is the unresolved piece.

### The hard-won lesson (RESOLVED — this is the conclusion, don't relitigate it)
The answer is a **treemap** — the standard, industry-grade market-heatmap treemap
(finviz convention). It's live: `MarketTreemapView` renders it, complete (ALL makes, no
"Other" bucket), area ∝ count, magnitude ramp, labels only where they fit, and it drills.

The mistake this session was **ditching the treemap to chase novelty.** Skylar's notes
on it (kill the "Other" blob, fix proportions, drop the bad images) were fixes to
*finish* it — I misread them as "start over" and burned hours on a donut, an isotype, a
spiral, and a scatter. Skylar's ruling: **"good = the collective industry standard —
professional / institutional / government / industry-grade." Do NOT invent novel forms.
Execute the standard graph rigorously.** All four novelty attempts were rejected and
deleted; the scatter ("MarketFieldView", still in the tree) was also rejected —
`MarketFieldView.swift` can be deleted.

### What's left to make it institutional-grade (finish THIS, don't restart)
1. **Color a SECOND variable** (currently color = magnitude, redundant with area). finviz
   colors by performance. The data is ready: `market_position(p_dimension,p_limit)` (fast
   matview `mv_market_position`, ~0.3s) returns per make `{volume, sell_through, demand,
   avg_year, median_price}`. Color cells by **sell_through (velocity)** — a diverging
   cold→hot ramp (stagnant→liquid) — so the treemap encodes TWO real variables
   (area = inventory, color = how fast it moves). That is the full market heatmap.
   (`mv_market_position` is make-only; extend it to model/year/etc. for the other pivot
   dims, or fall back to the magnitude ramp on dims without velocity.)
2. **Polish**: de-collide the few labels that overlap in dense regions; a subtle
   "drill/zoom" cue for the tiny tail cells.
3. **Keep** the pivot (9 dims) + recursive drill — both work.

### Data — do this FIRST (the 14s trap)
`market_pulse(p_dimension, p_limit)` → `{name, count, value, median_price, image_url}`
is fast (matview `mv_market_pulse`, ~0.3s). `market_pulse_filtered(...)` adds `avg_year`
but is a **14s live query** — never use it for the landing.
**Bake the axis variables (avg_year, a velocity metric = sold vs active / turnover, a
price band) into the fast matview or a new fast SECURITY DEFINER RPC** so the graph
loads in ~0.3s. Matview + RPCs are in prod; migrations in `nuke/supabase/migrations`.
Management-API query endpoint needs header `User-Agent: curl/8.4.0`. Heavy matview
rebuilds must go via direct psql (management API caps ~10s) — see this session's
migrations for the exact pattern. `vehicles` has `auction_status`, `sale_status`,
`sale_date`, `sale_price`, `mileage`, `color_family`, `bat_watchers` — enough for
volume/velocity/price/age/color axes.

### Canon (read before designing)
`../../docs/design/HARD_RULES.md`. Apple-stock instrument grammar, structure over
decoration, facts sacred (render ONLY returned data, never fabricate), honest
proportions. **Skylar HATES median/average PRICE printed as a number** — you may
*position* by a derived value, but do not print average prices.

### Method — test-first, iterate visually (non-negotiable)
Build → screenshot in the sim → critique like a designer → revise. Never ship the first
attempt. To screenshot the Pulse without the surrounding chrome, temporarily point the
`.treemap` case at your view and default the landing to it, then restore.
```
DEV=7086B1BA-4650-4EAB-9959-8D471DA3A6DF                      # iPhone 17 Pro sim
cd apps/nuke-capture-ios && xcodegen generate
xcodebuild -project NukeCapture-iOS.xcodeproj -scheme NukeCapture-iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath /tmp/nuke-ios-dd build
xcrun simctl install "$DEV" /tmp/nuke-ios-dd/Build/Products/Debug-iphonesimulator/NukeCapture.app
SIMCTL_CHILD_NUKE_DEBUG_SCREEN=explore xcrun simctl launch "$DEV" ag.nuke.capture
xcrun simctl io "$DEV" screenshot out.png
```
Show Skylar via a claude.ai Artifact (embed the resized screenshot) or a TestFlight push.

### Integration (once the form lands)
It's the Pulse landing. Keep the existing **pivot** (9 dims: make/model/year/price/
mileage/color/popularity/metro/day) and the **recursive drill** (tap → deeper → cars,
via `TreemapStep` + `FilteredVehicleGrid` in MarketTreemapView.swift). The intelligent
graph is the make/model level; drilling stays intact.

### The one open question for Skylar
Which relationship does he want to *see* — **where the action is (volume × velocity)**,
the **price structure (price × volume)**, or the **age-to-value curve**? Default to
volume × velocity if he doesn't answer.

---

## PROJECT B — BaT devour: write-path optimization (separate, daylight session)

- **RETIRED 2026-07-12** — the old slow single-path devour was stopped (2 workers,
  276/h = a ~9-day tail; superseded by the write-path fix). State preserved:
  `/Users/skylar/bat-backfill/done.txt` = 3,032 processed (2,083 new cars). It is
  resumable/idempotent — after the write-path fix, re-launch from where it left off at
  5–6 workers (< 1 day). Do NOT restart it slow.
- **Root cause of the slowness (measured):** raw-save already exists
  (`extract-bat-core` archives to `listing_page_snapshots`); the throttle is the
  `vehicles` INSERT firing **~38 triggers** (25–33s/insert → times out under
  concurrency). Not a missing index (resolution cols are indexed), not a BaT block.
- **The fix (needs Skylar's go-ahead — platform-wide write path):** profile which of the
  38 triggers actually cost the time; keep the load-bearing sync ones (VIN uniqueness,
  canonical/taxonomy resolution); defer the rest (evidence, org-link, completion,
  quality, dedup, agent/mailbox, classify) onto the existing drain-queue crons
  (`drain_vehicle_*_queue`). **Prove sub-second inserts on a 50-row test batch before
  the full grind.** Then 5–6 workers safe → closes in <1 day.
- Also: keep BaT concurrency ≤5–6 (12 caused a 500-cascade + egress throttle).

---

## PROJECT C — DONE this session (no action, just don't redo)

Shipped and safe: the `vehicle_observations(source_identifier, kind)` index (fixed a
40s→0.3s platform-wide stall); the county-choropleth Map + make filter; the 9-dimension
Pulse pivot + recursive drill; `market_pulse` / `market_pulse_filtered` /
`vehicles_by_filters` / `county_density_all` / `get_make_heatmap` / `market_map_points`
RPCs; date backfills across sources. All recorded as migrations in
`nuke/supabase/migrations` (dated 2026-07-12).
