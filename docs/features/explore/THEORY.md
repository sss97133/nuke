# EXPLORE — THE THEORY (governing doc)

> Skylar, 2026-07-12: "I want to explore the data — map, treemap, drill down, fully
> explorable, fully gamified. Like a scientist in a spaceship, an explorer in his ship.
> The whole point is to find what you're looking for in the data. That's the whole
> Bloomberg-terminal foundation. We have the data; we need real graph systems to display
> it, then ways for users to keep track of it, bookmark it, process it into reports,
> create content from it. Look how much content Webull, Robinhood, pump.fun, livestreaming
> produce — we are using ASSETS as our foundation of all that."

This document governs the Explore tab. Read it before building anything there.
A graph is never the deliverable. **The loop is the deliverable.**

## The loop

Explore is a terminal, and a terminal is a four-organ loop:

1. **EXPLORE** — fly the ship. See the whole space, steer anywhere: Map (where),
   Pulse treemap (what), drill (deeper), pinch/zoom (closer). The viewport.
2. **FIND** — the point of flying. Lenses and instruments that answer real questions:
   where's the gap, what's premium, what's rare, what's moving. A lens that can't
   produce a finding a census couldn't is decoration.
3. **TRACK** — keep what you found. Watch/save/pin cohorts and cars; the system watches
   them back and tells you when their state changes. Tracking without change-detection
   is a bookmark graveyard — which is why the time axis is load-bearing.
4. **USE** — make it produce. Reports, shareable market cards, comps for a sale,
   content. Webull/Robinhood/pump.fun are content ecosystems ON TOP of a live market
   feed; the feed's movement is what makes content worth producing. Assets are our feed.

The failure mode this doc exists to prevent (it burned a full day, 2026-07-12): optimizing
one organ's artifact — a graph form, a color ramp — while the loop is missing organs.
A perfect treemap of static data is a poster. Every session asks: **which organ am I
strengthening, and does it feed the loop?**

## Laws

- **Substance before form.** A visualization may only encode what the data defensibly
  contains (measured coverage, honest denominators). If the data can't say it, the fix
  is upstream (capture/compute), never a cleverer graph.
- **Honest geometry.** Area ∝ data, always. Missing datum = neutral, never fabricated.
  No printed average/median prices — structure (position, color, distribution) only.
- **The time axis is the blood supply.** Movement (DOM, sell-through, momentum) is what
  makes FIND daily-fresh, TRACK alertable, and USE publishable. `bat_listings` already
  carries honest outcomes incl. the unsold denominator (90d: 8,674 sold / 1,895 ended =
  82% BaT sell-through, `auction_end_date` = the axis). Marketplace slices need
  lifecycle capture (`listing_snapshots` design: see PULSE_EXPERT_PANEL doc).
- **Gamified = felt and rewarding, not points.** Haptic grammar (TICK/DROP/LANDING),
  zoom-that-drills, serendipity ("surprise me"), findings that feel like discoveries.
- **Every finding is one tap from its evidence** (the cars, the rows) and one tap from
  TRACK (watch it) and USE (share it).

## State of the organs (2026-07-12)

| Organ | Exists | Missing |
|---|---|---|
| EXPLORE | Map choropleth; honest squarified Pulse; drill make→model→year→cars; focal pinch-zoom; Liquid Glass chrome; haptics | seamless zoom-to-drill (ZUI, designed); year-level histogram; tappable breadcrumb |
| FIND | Era / Price / **Gap (auction-vs-marketplace arbitrage — live, unique)** lenses; search | dispersion + demand lenses (RPC data live, unwired); rarity; movement lenses (needs time axis); "surprise me" |
| TRACK | Watch/Save (UserDefaults) + badges | server-side watchlist; change detection + alerts ("your cohort moved"); pin-to-widget |
| USE | ShareLink text stub | cohort instrument header (designed); market cards (images); reports; comps-for-sale flow |

## One Query Language (added 2026-07-12, Skylar: manual filters up top, AI translation below)

Every Explore surface renders the SAME query object — **MarketQuery**
`{filters: make/model/year-range/price-band/era/metro…, groupBy, lens}`:
- **Map** = MarketQuery → `county_density_filtered(p_filters)` (migration 20260713020000).
- **Pulse** = MarketQuery → the pivot RPCs (filters/groupBy/lens already match this shape).
- **Grid/leaf** = MarketQuery → `vehicles_by_filters`.
Manual filter chips are direct editors of the object ("+ more filters" = more chips over
the same grammar — model, year range, price band, era, metro). Never a per-surface filter
system; one grammar, three renderers.

**The search bar is the translator** (per `docs/features/ask-nuke/THEORY.md`, which
governs — the entry for asking IS Explore's search):
- Literal text ("1985 K10") → parses straight to a MarketQuery (today's behavior, kept).
- Natural language ("70s Chevy trucks under 20k") → a **harnessed Claude call** — Nuke
  owns the JSON schema + harness, the model only translates NL → MarketQuery — and the
  surfaces re-render to it. Deterministic output (schema-constrained), cheap, instant.
- A **question** ("what's undervalued in trucks?", "is this K10 worth $18k?") →
  escalates to the ask-nuke projection path: source ladder (owner substrate → corpus →
  cited research), verdict as strike-price grammar, answer lands as a living row on a
  real entity — never chat scrollback. This is the "triggers an agent" tier.
The three tiers are one continuum: filter → translated filter → grounded projection.

## The identity law (added 2026-07-12, Skylar: "if the data is bad we fix the data")

Pivots group by **canonical identity, never raw strings**. Measured: raw `model` has
113,327 distinct strings (junk — trim/casing/free-text) vs `canonical_models` = 3,454
real nameplates; raw `make` 8,962 vs ~300 real. View-side caps (top-300) were masking
this and are banned — "all models" means all 3,454 canonical nameplates, which render
uncapped. The unresolved remainder (canonical make 65%, normalized model 51% today)
appears as ONE honest "unresolved identity · N cars" region — simultaneously true
rendering and the visible work queue that the resolution organs (alias matching, image
analysis, dossier analysis) burn down. The graph exposes the data debt; the data fix
improves the graph. Never patch taxonomy in the view.

## The Analyst's Toolbox

`ANALYST_TOOLBOX.md` (same dir) is the desk-grade gap map — 8 analytics families
(distributions/momentum/relative-value/liquidity/indices/screeners/events/portfolio),
each mapped expects·has·gap·priority against the verified organ inventory. Its law:
**wire the organs that already pump before acquiring anything new** — every P0 there is
assembly, not construction (bat_listings microstructure, price_histogram, the dormant
hammer_predictions ledger maturing 2026-07-15, canonical generations for the year-curve).

## Build order

1. **Canonical pivot rebuild**: mv_market_pulse/mv_market_position on canonical
   identity + "unresolved" group; alias-match backfill (mechanical first pass), then
   image/dossier resolution for the hard tail. (ISSUES.md entry filed; in flight.)
2. **Toolbox move 1 — bell curve + overlay** (price_histogram → cohort screen, A/B +
   period overlay) and **move 2 — the BaT Liquidity Panel** (sell-through, bid depth,
   watcher→bidder conversion, reserve-met, UNSOLD positioning; badged "auction slice").
3. **Toolbox move 3 — auction calendar + wake hammer_predictions** (score the
   2026-07-15 maturity; start the public accuracy ledger).
4. **Toolbox move 4 — saved screens → alerts** (persist MarketQuery as named screens;
   new-match + ending-soon notifications; server-side watchlist). The retention loop.
   NL→MarketQuery translator + ask-nuke escalation layer on top.
5. **Toolbox move 5 — year-curve lens + 3 flagship indices** (%-change, drillable
   constituents, count-weighted).
6. USE: cohort header card → shareable market card. EXPLORE polish: zoom-drill ZUI,
   year histogram, Map|Pulse toggle float.
7. Marketplace lifecycle capture (extends movement + DOM beyond the BaT slice).
