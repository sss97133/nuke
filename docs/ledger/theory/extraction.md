# EXTRACTION — theory card

**The model:** Fetch once, extract forever. Every external page fetch goes through `_shared/archiveFetch.ts`, which checks `listing_page_snapshots` cache, fetches (direct/Firecrawl), archives raw HTML+markdown, then returns content — so later extraction passes re-parse stored snapshots at $0 instead of re-crawling. Extraction stores raw evidence/observations with source DNA (amount, source, method, observed_at, trust); labels are projections of measurement, computed at render — never baked as categoricals into schema.

**The invariant(s):**
- `archiveFetch()` for ALL external page fetches (raw `fetch()` follows 302→login, caches garbage for 24h — the auth-redirect bug). Only exception: JSON API endpoints.
- Before any network call, check `listing_page_snapshots` — if a snapshot exists, re-extract from it (`batch-extract-snapshots`).
- `auction_comments` (105k rows) is testimony — never delete/overwrite. Extracted values keep provenance; no raw INSERT into testimony tables (write via ingest-observation path).
- Every candidate passes `qualityGate()` (`_shared/extractionQualityGate.ts`) inside `ingest` before landing.

**Canonical entrypoints** (from CAPABILITY_MAP.md, verdict=CANONICAL):
- Ingest ANY listing URL / unknown source → `ingest` edge fn (universal entry; chains archiveFetch + qualityGate)
- Enqueue extraction work → insert into `import_queue` table (the spine, 264k rows)
- Route/drain import_queue → `process-import-queue` (routes to 17 per-source extractors + AI fallback)
- BaT listing → `extract-bat-core` THEN `extract-auction-comments` (two-step); queue drain → `process-bat-extraction-queue` (cron */5); discovery → `bat-url-discovery`; profiles → `extract-bat-profile-vehicles`
- Re-extract from archived snapshots → `batch-extract-snapshots` (reads `listing_page_snapshots`)
- Facebook Marketplace → `extract-facebook-marketplace` + `refine-fb-listing` (+ fb-scraper skill / launchd fleet)
- Per-source extractors → the `extract-*` fn already routed by process-import-queue (craigslist, hagerty, pcarmarket, mecum, bonhams, gooding, rmsothebys, ebay-motors, cars-and-bids, …)
- Generic AI fallback → `extract-vehicle-data-ai`; new source onboarding → `onboard-source`
- Health → `extraction-watchdog` (manual); queue brief → `ralph-wiggum-rlm-extraction-coordinator {action:'brief'}`

**Do NOT:** resurrect the graveyard: smart-extraction-router (ghost — old map wrongly calls it the entry), scrape-vehicle (undeployed; AddVehicle degrades to manual entry — do NOT wire `ingest` into the paste-debounce, it auto-mints before user intent is stated; ingest needs a preview mode first, see .claude/ISSUES.md 2026-07-12), complete-bat-import (undeployed, 404s), sync-bat-listing / unified-scraper-orchestrator / store-auction-listing (zombies), bat-simple-extract, extraction-quality-validator (ghost), import-classic-auction + extract-specialty-builder (routed but UNDEPLOYED — 404 traps). `bat_comments` table DOES NOT EXIST. Never mint a new per-source fn, queue, or sentiment/label column — extend the routed extractor. Never full-scan snapshots without an index (bat-snapshot-parser died scanning 367k rows/59GB). Don't trust inactive cron rows as evidence of life.

**Before you build here:** read `docs/ledger/CAPABILITY_MAP.md` (column 2 is THE entrypoint; column 3 is the graveyard) and `docs/library/technical/extraction-playbook.md` (12 repeated mistakes, method catalog). Check `pipeline_registry` before writing any computed field, and `cron.job WHERE active=true` for what actually runs. If a capability seems missing, it almost certainly exists — search the ledger before minting anything.

## Spending Firecrawl: sources and vehicle groups ranked from the data (owner directive 2026-10-15)

**The rule.** Firecrawl stays at USD 100 a month at most and is spent only on the best targets. The targets are not hand-picked: a
weekly job ranks sources, then vehicle groups, from the data model, and writes the allocation to
`firecrawl_target_allocation`. Every Firecrawl spender asks `firecrawl_allowance(source)` before a batch, stops at the number it
returns, and reports the spend with `firecrawl_record_spend(source, credits, lots, lane)`. In `archiveFetch()` the call belongs in
the Firecrawl branch. A source we can fetch directly or re-read from retained captures costs no credits and is never allocated any;
Firecrawl is for the sources that need it. Budget size is the parameter `firecrawl_params.monthly_credits`: 1,000 now, 100,000 if
the USD 99 Standard plan is taken. Owner tiers: model years 1964-1973 above 1974-1991 above the rest, non-dealer sellers first.

**Source score = value x gap / cost.** Every input is stored, with its date, in the `inputs` jsonb of the source's `'*'` row.
- *Value* (0 to 1, the weighted mean of the components that are known; the tier share counts double; unknown components are
  dropped and listed under `unknown_inputs`, never guessed): tier share of the source's landed lots (1964-1973 weighs 1, 1974-1991
  weighs 0.6, the rest 0.2); outcome observable (share with a realized sale price); completeness per lot (description, VIN, photo);
  uniqueness (share not also listed on another platform); private-seller share. **Private-seller share is not in the data model**:
  there is no seller-type field on `vehicles` or `vehicle_events`, so it stays unknown until one is recorded. It is the first gap to
  close for the owner's non-dealer-first rule.
- *Gap* (lots): for a historical source the known population minus landed lots (the whole-source `source_census` row and
  `mv_source_target_landed`; no population, no gap); for a live source the new supply per day times `live_horizon_days`.
  New supply counts the lots that ENDED in the last 14 days where events carry an end time (at least 20% of the sample), because
  `created_at` is the landing clock and a backfill looks like new supply; a purely live classified source falls back to `created_at`,
  and the clock used is recorded in the inputs.
- *Cost* (credits per full lot): `firecrawl_source_params.credits_per_lot` with its basis, replaced by the observed credits per lot
  in `firecrawl_spend_log` once 50 lots are logged. A source with no Firecrawl cost is scored with the floor cost 0.01, so it ranks
  but receives 0 credits.
- *Inputs are measured on bounded samples*: a source with at most 4,000 events is read in full; a larger one by a 4% TABLESAMPLE of
  `vehicle_events` joined to `vehicles`. Under 30 sampled events the sample-derived inputs are unknown.

**Vehicle-group score = tier weight x sqrt(liquidity rank x information rank) x (1 + own).** A group is a model family by year
band (1964-1973, 1974-1991, other) from `mv_family_sales`. Liquidity = priced sales in the last 12 months. Information value = price
dispersion, (p75 - p25) / median, over 36 months, for groups with at least 8 sales. Own = the owner's vehicles in the group:
verified ownership (`vehicle_ownerships` verified_owner/current, or `vehicle_user_permissions` owner/co_owner) counts 1, a vehicle
merely recorded under the owner's account counts 0.1 (ownership there is unclear). The owner's user id is
`firecrawl_params.owner_user_id`; unset, the input is unknown.

**Allocation.** Sources that consume Firecrawl credits, by value per credit (the score ranks the size of the opportunity; a credit goes
first where it buys the most value), each capped at its gap in credits and at `max_source_share` (0.5) of
the allocatable credits (the monthly credits less `reserve_fraction`, 0.15). Within an allocated source, credits split across the top
20 groups in proportion to group score. `firecrawl_allowance` spreads a source's period allocation over the days left in the
billing period (it resets on `period_start_day`, now the 4th) and subtracts today's spend, so an unspent day rolls forward.

### best_v1: what a landed lot is worth, and the loop that improves it (owner, 2026-10-15)

The owner: "best is a metric we have yet to fully develop." So the ranking is a metric that is measured, tested on real spend and
revised, not a one-off table. `best_v1` scores each landed lot from 0 to 1 and is stored with its components in
`firecrawl_lot_score` (metric_version `best_v1`):

    best_v1 = ( 2 x tier + complete + outcome + unique + group ) / 6, an unknown component counts 0
    tier      model year 1964-1973 = 1, 1974-1991 = 0.6, other = 0.2
    complete  (description + VIN + a photo + a location) / 4
    outcome   a realized price = 1; the outcome known without a price (reserve not met, no sale, ended) = 0.5; an ask = 0
    unique    1 when no other platform holds an event for the same vehicle, else 0
    group     the lot's model family x year band score over the best group score (`firecrawl_group_score`); an illiquid
              or unmatched family = 0
    not in v1 non-dealer seller: the data model has no field for it, so it is listed as unknown on every source

The weights are rows in `firecrawl_params` (`best_w_*`, the tier weights). Unknown counts 0 because no evidence of value is not value.

- **Source value** is the mean best_v1 of the source's landed lots (a sample, same sampling as above), blended with the owner's own
  rating when he gave one (`firecrawl_source_params.owner_judgment`: rating, his words, date; the lots count 2, the rating
  `owner_judgment_weight`). eBay carries "ebay is low quality" (2026-10-15).
- **Observed return** is best_v1 summed over the lots a Firecrawl fetch landed in the last 30 days, per credit spent. Credits are
  the Firecrawl fetches in `listing_page_snapshots` (fetch_method = firecrawl), failed ones included, or the spend log if larger, so
  a gone page, a thin capture and a blocked fetch cost credits and add nothing. `firecrawl_backtest(since, until)` returns it per
  source. Once a source has 30 scored lots its observed best_v1 per credit replaces its prior (mean best_v1 over the cost).
- **Allocation** follows best_v1 per credit, by source and then vehicle group, capped by the gap and the share. A source whose
  landed lots score low loses budget on the next run without anyone changing a parameter. A paused source
  (`firecrawl_source_params.paused`) is ranked and shows `would_allocate`, gets no credits, and `firecrawl_allowance` returns 0.
- **The loop.** Weekly the job rescored the lots and recomputes. As outcomes arrive (eBay endings, Craigslist removals,
  Cars & Bids results) realized value is added to the metric as `best_v2`, published beside `best_v1` in `firecrawl_lot_score`
  (the key is event and version) with its diff against v1 per source. v2 is not built yet: the first outcome feed is the gap.

**Where it lives.** Tables `firecrawl_params`, `firecrawl_source_params`, `firecrawl_spend_log`, `firecrawl_target_allocation`, `firecrawl_group_score`, `firecrawl_lot_score`;
functions `refresh_firecrawl_target_allocation` (cron `firecrawl-target-allocation-weekly`, Mondays 05:17Z), `firecrawl_allowance`,
`firecrawl_record_spend`, `firecrawl_score_lots`, `firecrawl_best_v1`, `firecrawl_backtest`; migrations `20261017010000_firecrawl_target_allocation.sql`, `20261017011000_firecrawl_allocation_supply_clock.sql`, `20261017020000_firecrawl_best_v1.sql`. Read the ranking with
`select * from firecrawl_target_allocation where computed_at = (select max(computed_at) from firecrawl_target_allocation) and vehicle_group = '*'`.
