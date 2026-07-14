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
