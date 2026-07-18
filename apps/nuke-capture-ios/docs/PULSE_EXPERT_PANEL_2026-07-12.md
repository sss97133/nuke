# Pulse Treemap — Expert Panel Synthesis (2026-07-12)

Six domain experts inspected the Pulse in parallel: make-page owner, drill-pages owner,
cohort-endpoint owner, tail-page owner, haptics expert, data-strategy lead. This is the
distilled, actionable synthesis — the build bible. Full reasoning was captured in-session.

---

## THE SPINE (every expert, one idea)

**It's a census, not a pulse.** Area = inventory *count* and color = *era/price* both
describe the dataset's static shape — it reads the same every day (Chevy/Ford always
biggest). finviz's genius is area = market-cap (an **extensive/additive** quantity) and
color = %change (an **intensive** quantity that **moves**). The fix is to honor that grammar:

- **AREA must encode an additive quantity** — count, total $-value, total watchers, sold volume.
- **COLOR must encode an intensive one that VARIES** — median price, price dispersion, days-on-market, momentum, an arbitrage spread.
- **Parent color is recomputed from the pooled child cohort, never averaged** (avg-of-medians = Simpson's paradox).
- **Momentum / DOM / sell-through are color-only, forever** (they don't sum), and are **blocked, not faked**, until the data supports them.

---

## THE TWO FORKS (Skylar's call — experts disagreed)

1. **Entry AREA: count vs total $-value.**
   - *Data lead:* switch default to **Σ canonical_price** — the map reweights to where the
     *money* is; cheap high-count junk stops dominating. Biggest single perceptual upgrade.
   - *Make-page owner:* **keep count** as default — Porsche(39,713) > Toyota(18,182) and
     Ferrari > Honda is the *honest enthusiast-market story* that count already tells for free.
   - *Resolution:* ship BOTH as area modes; the fork is only which is **default**.

2. **Entry COLOR default: era vs a varying signal (dispersion / price-z).**
   - Era is legible but static. Price-dispersion (QCD) or price-z *varies* across the map and
     is defensible today. Recommendation: keep Era as *a* lens, add the varying ones, decide default.

---

## DEFENSIBLE NOW (ship this week — no ingestion upgrade)

From covered data (make/model/year 92%, price 74%, source, geo, watchers-where-present):

| Change | Channel | Why |
|---|---|---|
| Area mode: **total $-value** (Σ price) | AREA | money-weighted market, not noise-weighted |
| Color: **price dispersion** QCD=(P75−P25)/P50 | COLOR | volatility/negotiability — *varies*, high = arbitrage room |
| Color: **median-price z-score** within pivot | COLOR | cheap↔dear, spread across full ramp |
| Color: **watchers-per-listing** (demand density) | COLOR | closest thing to "hot" today (BaT-only, flag it) |
| Color: **auction↔marketplace spread** = med(BaT)/med(marketplace)−1 | COLOR | **the unique feature** — where retail lags auction-discovered value; nobody else renders this |
| Color: **geographic concentration** HHI=Σ share² | COLOR | national commodity vs regional scene |
| Enforce extensive/intensive + parent-recompute-from-pool | engine | kills silent Simpson's errors |

---

## THE PULSE UNLOCK (reframes the parked BaT project)

The parked "BaT write-path / lifecycle capture" work is **not backfill for nobody** — it is
**the entire difference between a census and a pulse.** Everything that makes color *move*
(days-on-market, sell-through, price momentum, price-cut depth, ask-vs-sold) descends from
one capability: **observe each listing repeatedly over time and record its terminal state.**

- Capture: `listing_snapshots` (one append-only row per listing per crawl — the missing time axis).
- Derive nightly: `listing_lifecycle` (first_seen, last_seen, terminal_status ∈ {sold, removed_unsold, still_live}, dom_days, price_cuts, sold_price).
- Honesty guards: **survivorship** — we ingest completed SOLD listings (numerator without denominator); sell-through is *impossible to compute honestly* until we crawl the full index and capture the **unsold denominator**. **Right-censoring** — report median DOM of *completed* listings only (or Kaplan-Meier). **Momentum** needs history: start snapshotting NOW, WoW stable ~T+28–56, guard every cell n≥8 else render neutral.

---

## PER-PAGE BIBLE

### Make (entry)
Keep area=count as the honest default (see fork). Fixes: (1) **fold cell is 30% of the map
rendered as a white void** — biggest bug; make it a doorway (below). (2) **Quantile-rank the
color** (linear year bunches every broad make at olive-mud); 5-stop OKLCH ramp, chroma ≥0.09,
no desaturated midpoint. (3) **Uniform count rule** + luminance-based ink (kill the ransom-note
mix of count/no-count). (4) Separate lens pill from pivot scroller (hairline divider + fade mask).
(5) Wire the legend (label "Era · median yr", tappable). (6) Optional: top-model preview chip on
giant cells; staggered largest-first appear; one honest superlative highlight.

### Drill (model / year)
1. **Make Price scale GLOBAL/absolute** (fixed log bounds like Era) — relative scaling is a
   price-lie-in-hue ($45k Corvette and $250k Daytona both full-gold). Cardinal fix, do first.
2. **Part-of-parent share** in caption: `Corvette · 8,432 · 11%` — the comparison the user wants,
   honest, free. Print `avg_year` too (a year is a fact; a price isn't).
3. **Parent-centroid tick** on the legend so cells read against their parent's center of mass.
4. **Year level is NOT a treemap** — years are ordinal; squarify destroys chronology. Make it a
   **chronological histogram** (x=year, height=count, fill=lens) → generational humps appear.
5. Tappable breadcrumb (needs explicit `[PulseRoute]` path + popTo(depth:)); iOS-18 zoom transition.

### Cohort endpoint (the "raw dog" leaf)
`CohortTerminalView` already has the parts: `get_make_model_terminal` RPC, `DistributionBar`
(box-whisker, median as an **unlabeled tick**), `SalesScatter`. **Reuse them** — extract a
widget-shaped `CohortHeaderCard(make,model,year)` as the grid section header. Vital signs:
identity (drills to provenance) · population + coverage ("27 of 107 carry a sold price") ·
**price DISTRIBUTION as a range band, min/max labeled only, median position-only, NEVER a printed
average** · watchers (labeled "on N of 107") · mileage band · geography. Grid below = holdings,
sorted priced-desc, each cell gets a price chip + a band-position pip. Watch/Save/**Pin-to-widget**
keyed on the cohort title. The header IS the WidgetKit widget (same view, smaller tier).

### Tail ("＋232 makes")
The parent page is flat → the fold looks like junk. The tail page earns itself by being
**structurally richer**: **group by country-of-origin** (USA/UK/Italy/Germany/France/Japan/…
districts, deterministic lookup, unknown→Rest-of-World), color stays on the lens. Add a **Rarity
lens** (inverse-count) so the tiniest marques glow hot — the junk drawer becomes a treasure map.
The fold cell becomes a **doorway**: a `Canvas` micro-mosaic of the top-40 tail makes (real areas,
current lens) + recessed inner shadow + ghosted marquee names (`Facel Vega · Iso · TVR · Bricklin`)
+ `Explore →` pill. "Surprise me" die for serendipity.

### Haptics (full vocabulary — P0 fixes are cheap and high-impact)
One grammar, three metaphors: **TICK** (lateral: lens/pivot change), **DROP** (descend: drill,
weight ↑ with depth), **CATCH/LANDING** (arrive: the cars, watch-latch, boundary). Depth = weight,
monotonic. Rising energy = engage, falling = release.
- **P0 (80% of the feel):** one `Haptics.swift` helper (pre-warmed generators + one shared
  CHHapticEngine). Fix the collision (Watch-on == Watch-off == Save all fire identical `.medium`).
  Add the **silent drill** a haptic: `.soft` make→model, `.medium` model→year, custom **`landing`**
  2-transient on drill-to-cars. Watch-ON = custom **`latch`** (rising + resonant tail), Watch-OFF =
  soft descending, Save = dry `.rigid` (different *texture* so verbs differ eyes-closed).
- Custom Core Haptics only where a UIFeedbackGenerator can't express the shape (landing, latch,
  wall=tail-less thud, ridge=area-scaled scrub, sonar=watched-item surfaced, coalesced 1/layout).
- Anti-patterns: cold-generator latency (prepare in onAppear AND after each fire), one-buzz-per-tile
  on regroup (fire ONCE), `.error` for empty data (use `.warning`), a new engine per event.

---

## RECOMMENDED BUILD ORDER

1. **Haptics P0** — one helper file + ~6 call-site edits; fixes the collision + silent drill. Cheap, huge feel gain, zero forks.
2. **Fold cell → doorway** (mosaic + recess + names) — kills the 30%-void, both make & tail owners flagged it #1.
3. **Drill: Price scale global + part-of-parent share + avg_year caption** — cardinal price-honesty fix + the insight drill pages lack.
4. **New color modes (defensible-now): dispersion / price-z / watchers-per-listing / auction-marketplace spread** — needs RPC work (market_position returns Σprice, P25/P50/P75, source split). This is the census→pulse move that ships without the ingestion upgrade.
5. **Cohort header card** (reuse DistributionBar) — fixes "raw dog."
6. **Year → chronological histogram**; **tappable breadcrumb**; **tail country-grouping**.
7. **Lifecycle capture** (the parked project) → the true movement pulse (DOM/sell-through/momentum). Weeks; needs Skylar's go.
