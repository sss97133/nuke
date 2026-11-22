# VEHICLE INTELLIGENCE — theory card

**The model:** Every number here is a *projection of measurement*: evidence (comps, bid curves, sentiment, specs) is stored as testimony tuples `(claim, source, method, observed_at, trust)`, and derived values (estimate, deal score, completion %, heat) are recomputed projections over that evidence — never hand-set, never baked as categoricals into schema. Compute flows through queues: writes enqueue into `vehicle_*_recompute_queue`, per-minute `drain_vehicle_*_queue()` crons recompute; valuation is `compute-vehicle-valuation` (confidence-weighted, tier-dependent weights) upserting one row per vehicle into `nuke_estimates`.

**The invariant(s):**
- Never show a price you can't defend — if evidence is thin, BLOCK ("not priced yet"), never emit an honest-low guess. Comps do not price builds.
- Numbers carry source DNA: any value you write must have amount + source + method + observed_at + trust.
- Query `pipeline_registry` BEFORE writing any computed field — each has exactly one owner (e.g. `calculate-vehicle-scores` owns `perf_*_score`).
- Derived fields are recomputed via queue drains, never UPDATEd directly.

**Canonical entrypoints (from CAPABILITY_MAP.md, VEHICLE INTELLIGENCE section):**
- Valuation compute → `compute-vehicle-valuation` edge fn; storage → `nuke_estimates` (776k rows)
- VIN decode → `batch-vin-decode`; lookup API → `api-v1-vin-lookup`
- Profile completeness → `calculate_vehicle_completion_algorithmic` via drain cron
- Derived-field recompute → enqueue `vehicle_{completion,metric,stats}_recompute_queue`; crons run `drain_vehicle_*_queue()`
- Live auction sync → `sync-live-auctions` (cron */15); cleanup → `cleanup_ended_auctions`
- Market trends → `api-v1-market-trends`; admin trends → `auction-trends-stats` + `get_auction_trends_v2`
- Market substrate → `mv_market_pulse`, `marketplace_metro_pulse`, `marketplace_velocity` (actively refreshed MVs)
- Comps → `api-v1-comps`; value trends → `value-trends`; scores → `calculate-vehicle-scores`
- Enrichment → `enrich-factory-specs`, `enrich-msrp`, `enrich-bulk`; geo feed → `map-vehicles`
- History/auction APIs → `api-v1-vehicle-history`, `api-v1-vehicle-auction`

**Do NOT:** write to `vehicle_valuations` (0 rows), `vehicle_valuation_feed`/`clean_vehicle_prices` MVs (0 rows), or invent `vehicle_valuations_components`/`vehicle_price_baselines` (DO NOT EXIST). Don't call `compute_vehicle_value` SQL, `run_valuation_batch_by_quality`, `api-v1-valuations`, `price-analytics` (ghosts), `decode-vin-and-update`, `calculate-market-trends` (0 callers), `calculate-market-indexes`, or `calculate-profile-completeness` edge fn (undeployed). Don't build a new treemap refresh path. Don't archive `predict-hammer-price` — dormant, open `hammer_predictions` prediction matures 2026-07-15. Never mint a new valuation store or sentiment store.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (VEHICLE INTELLIGENCE rows) before minting ANY function/table — the capability almost certainly exists; check `pipeline_registry` for field ownership; check `cron.job WHERE active=true` before trusting a cron is alive; for deal/valuation product work read the deal-system pickup and `docs/features/ask-nuke/THEORY.md`.

## Cohort orbit: where one car sits (owner, 2026-11-21)

Owner's words: "think how marti reports work it widdles down and down to a small set. so in this case theres transam cohort
theres firebird cohort theres replica/clone/reproduction cohort, then most important the cohort of condition which is the
MOST relevent... theres a certain balance and weight that has to be calculated those cohorts are the orbit where this exists
and it may raise the whole cohort cuz its as nice as a 150k real trans am with 80%-95% correct parts versus a beat up
replica or beat up authentic... thats your job to make that not be a problem."

What it requires of the model:

- A valuation is a narrowing through nested cohorts, each with its population and n printed: model family, the series the
  car presents as, the authenticity class (factory, tribute/clone/replica), then condition. A thin layer is still a layer:
  the most specific cohort is reported with its n, never dropped for being small.
- Condition is the heaviest layer. It is computed from keyed photo readings and work records, per section, with the age of
  each piece of work, so a restored tribute and a worn authentic car are comparable on the same scale.
- The weight of each layer is derived (how much of sale-price variance it explains among sold comparables), never typed.
- A statement by the owner or custodian about work done (for example "the transmission was rebuilt", or "the engine-bay
  wiring was redone for the V8") lands as a statement with its date and speaker role, graded below a document or a
  photograph, and is superseded when one appears.
- The cohort run is aimed at a group of vehicles (order 3,000 to 10,000 photographs with their profiles) only after the
  reading-to-key path holds on the proof vehicle: every header item answered from keys, no text search.
