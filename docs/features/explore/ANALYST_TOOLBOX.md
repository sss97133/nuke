# THE ANALYST'S TOOLBOX — gap map (2026-07-12)

> Skylar: "we want a box of fantastic analysis toolings, top shelf Bloomberg. your job
> is to identify the gaps. we have a lot of under-developed things other dumb agents try
> to throw out but if you know what you're looking at it makes sense. this is where guys
> go to study the market — imagine on your team you have a Wall Street analyst telling
> you what would be nice to have or what's missing."

Produced by the analyst pass against the verified prod inventory. Governing frame:
Bloomberg's moat was that every screen answered "where does this thing trade, how fast,
and versus what?" in two keystrokes. Nuke's auction slice (bat_listings, 18-month daily
tape with honest UNSOLD outcomes) is already terminal-grade; the marketplace slice is a
quote feed without a tape (lifecycle capture pending). Build deep on the slice with a
time axis; build honest breadth on the rest. **Theme: every P0 is wiring an organ that
already pumps — zero new data acquisition.**

## Family-by-family (expects · has · gap · priority)

1. **Distributions (bell curves)** — HAS `price_histogram` RPC (deployed, log-spaced,
   correct: car prices are lognormal) + DistributionBar/SalesScatter + p25/50/75.
   GAP: not wired to any screen; no OVERLAY mode (cohort A vs B, this-period vs last —
   the most-used comparison on any desk); no skew/tail callouts. The no-printed-median
   rule is an asset: the SHAPE is the answer. **P0 — cheapest large win.**
2. **Momentum/trend** — HAS the bat_listings tape (11K/wk, sale_date, honest outcomes).
   GAP: no trend surface; ship a monthly rolling percentile-RIBBON (p25–p75 band
   drifting, no number printed) + sell-through-over-time, badged "auction slice."
   Seasonality: 18mo = 1.5 cycles = confident nonsense; PARK until ~30mo. Marketplace
   DOM blocked on lifecycle capture (correctly unshipped). **P0 (BaT slice).**
3. **Relative value** — HAS venue arbitrage LIVE (Gap lens; Chevy +164% is a finding),
   per-cohort percentiles for any A/B spread, canonical_models as the securities master.
   GAP: the **YEAR-CURVE** — price distribution vs model-year with generation boundaries
   marked (canonical_models has them): the asset class's yield curve, the depreciation
   smile → collectible ramp. Car-native, data-complete, unbuilt. **P1 (the differentiator);
   P0 to surface venue-arb per cohort.** Mileage/condition curves: data gap, don't fake.
4. **Liquidity/microstructure** — the richest untapped vein. HAS per-auction bid_count
   (depth), view_count, watchers, comment_count, reserve_price vs final_bid, honest
   UNSOLD → real 82% sell-through. GAP: no liquidity PANEL: sell-through %, median bid
   depth (counts are printable — the constraint is on prices), watcher→bidder conversion,
   reserve-met rate, and WHERE UNSOLD LOTS CLUSTER in the price distribution (ambitious-
   reserve diagnosis — a seller insight nobody else can show). Hagerty/Classic.com show
   prices; nobody shows depth. **P0 — assembly, not construction.**
5. **Benchmarks/indices** — GAP: no index engine. Honesty rules: publish as % CHANGE
   with drill-to-constituent-sales, never a dollar level; count-weight (cap-weighting is
   equities cosplay); repeat-sale pairs too thin yet (**P2**). **P1: 3–5 flagship cohort
   indices** ("air-cooled 911," "square-body," "Fox-body") — the citable artifact.
6. **Screeners/alerts** — the retention engine (Bloomberg's EQS/ALRT). HAS: the pivot IS
   a screener without a save button; watch/save local-only; 11K/wk inflow. GAP: saved
   screens (persist a MarketQuery as a named screen), "new match on your screen" +
   "watched auction ends in 24h" notifications, watchlist analytics. NL→MarketQuery is
   P1 polish ON TOP of this skeleton. **P0.**
7. **Event/prediction** — HAS auction_end_date on live listings (the calendar is a
   query, not a build) + `hammer_predictions`, a DORMANT Kalshi-shaped ledger with an
   open prediction maturing **2026-07-15 — days away. Score it publicly, start the
   accuracy ledger (publish the misses — the anti-Hagerty move).** Calendar **P0**;
   prediction loop **P1**.
8. **Portfolio (the garage as PORT)** — HAS the owner substrate: receipts = true cost
   basis (printable — the owner's own money), work_sessions, vision atoms. GAP: the
   basis-vs-distribution card — "your '66 Mustang sits HERE in its cohort's curve; your
   documented basis is $X from 47 receipts." Never a printed market value; block when
   the cohort can't defend a position. Full portfolio view **P2** (zero users); the
   basis card **P1** (it's the demo that makes an owner FEEL the terminal).

## What cars need that equities don't
No fungibility → **the distribution IS the price** (the no-median rule is the correct
model, not a limitation — doctrine, not apology). The security master is EARNED
(canonical resolution = index plumbing, not chores). Two venues, one asset → the
auction/marketplace basis is Nuke's proprietary spread. Geography is a factor
(rust-belt vs dry-state — county matview + lat/lon = a factor model waiting, P2). The
year-curve is the yield curve. Condition/provenance = credit quality; receipts/photos
are the underwriting file. No derivatives exist → hammer_predictions is the closest
thing this asset class has to a futures market.

## The Data Foundation (Skylar, 2026-07-12: "paths aren't enough — prices, bids, bid
## velocity, comments, images — it's all there; all our sources should be feeding our db")

Measured: the foundation is largely CAPTURED but DISCONNECTED from the analyst layer —
**auction_comments 13.9M rows** (BaT bids are timestamped comment events → bid-by-bid
velocity is derivable from held data), **vehicle_images 39.9M**, **listing_page_snapshots
628K raw page archives** (deepen extraction from disk, never re-fetch), observations 7.8M.
The program, gated on the write-path fix (throughput):
1. **Bid-timeline extraction** — structured bid events (ts, amount, bidder) from
   auction_comments + snapshots → bid velocity/late-bid dynamics per auction → feeds
   the liquidity panel and hammer predictions.
2. **Re-extraction passes over listing_page_snapshots** — pull what the first pass
   skipped (bid ladders, watcher history, options/spec blocks) from already-saved raw.
3. **Feed audit** — for every source in `vehicles.source` (50+): live cron vs one-time
   load vs dead; probe-before-schedule; success = rows landed (fleet rules). Marketplace
   lifecycle capture rides this.
Third instance tonight of the pattern: the organ existed (unsold denominator, canonical
taxonomy, now comments/images/raw). ALWAYS inventory before acquiring.

## The refactor law (Skylar, 2026-07-12: "bat_listings probably needs to be refactored")

Agreed on the need, constrained on the method: **refactor by reading layer, never by
rebuilding a pumping organ** (strangler fig — the repo's own migration doctrine).
bat_listings is a live daily writer with 18 months of irreplaceable tape; it is never
renamed/reshaped in place. Instead the mecca gets two additive layers, and ALL analyst
tools read them (never the BaT-shaped table directly):
1. **`market_events`** — venue-agnostic auction-event layer (venue, canonical cohort
   keys, start/end, outcome incl. unsold, prices, bid/watch/view counts). Unions
   bat_listings today; Mecum/Barrett-Jackson/marketplace-lifecycle rows land tomorrow
   and every panel gets them for free.
2. **`mv_cohort_metrics`** — per canonical-cohort per month: sell-through, bid depth,
   watcher→bidder conversion, reserve-met rate, percentile bands. The single source for
   the liquidity panel, momentum ribbon, and indices.
The old shape withers when nothing reads it. Same law applies to every legacy organ the
toolbox touches: add the clean interface, migrate the readers, let disuse do the demo.

## THE FIVE MOVES (sequenced; each names its existing organ)
1. **Wire the bell curve + overlay** (price_histogram + DistributionBar) — days of work,
   defines the product's visual identity.
2. **BaT Liquidity Panel** (bat_listings columns, all populated) — the screen no
   competitor can copy without 18 months of tape.
3. **Calendar + wake hammer_predictions** (auction_end_date + the dormant ledger) —
   score the 2026-07-15 maturity, don't let it pass.
4. **Saved screens → alerts** (pivot state + watch/save + 11K/wk inflow) — the
   retention loop; the others make people visit, this makes them return.
5. **Year-curve lens + 3 flagship indices** (percentile RPCs + canonical generations) —
   the citable artifact other people link to.

Excluded deliberately: seasonality (underpowered), cross-market sell-through/DOM
(blocked on lifecycle capture), mileage curves (no captured field), full portfolio
(no users yet), NL search as prerequisite (it's polish on move 4's skeleton).
