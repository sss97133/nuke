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
returns, and reports the spend with `firecrawl_record_spend(source, credits, lots, lane, note, historical)` (`historical` for spend made before the rule or an allocation: it counts toward the observed return, not against the period allowance). In `archiveFetch()` the call belongs in
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

**Owner grants.** An owner decision outside the ranking is a `firecrawl_source_params.owner_grant` (credits, `daily_credits`,
`reserve_floor`, from, until, his words and date). While it is in force `firecrawl_allowance` returns the least of the grant left,
the daily pace left today and the latest hourly balance (`firecrawl_balance_log`) above the reserve floor; with no balance read in
3 h the ranked allowance applies. Bonhams carries one from 2026-10-18: 3,720 credits (80% of the 4,650 left), 532 a day, floor
930, until the period ends 2026-11-04, for the lot pages of lots landed with one photo (`extract-bonhams` `deep_lots`).

### best_v1: what a landed lot is worth, and the loop that improves it (owner, 2026-10-15)

The owner: "best is a metric we have yet to fully develop." So the ranking is a metric that is measured, tested on real spend and
revised, not a one-off table. `best_v1` scores each landed lot from 0 to 1 and is stored with its components in
`firecrawl_lot_score` (metric_version `best_v1`):

    best_v1 = ( 2 x tier + complete + 2 x outcome + unique + group ) / 7, an unknown component counts 0
    tier      model year 1964-1973 = 1, 1974-1991 = 0.6, other = 0.2
    complete  (description + VIN + a photo + a location) / 4
    outcome   (weight 2 since 2026-10-15: the owner's core product is what sold, for how much and how fast, so an ask with no
              observable outcome is half a data point) a realized price = 1; the outcome known without a price (reserve not met, no sale, ended) = 0.5; an ask = 0
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
  (`firecrawl_source_params.paused`) is ranked, takes no credits (they flow down the ranking by the formula), shows what it
  would receive if unpaused as `would_allocate`, and `firecrawl_allowance` returns 0.
- **The loop.** Weekly the job rescored the lots and recomputes. As outcomes arrive (eBay endings, Craigslist removals,
  Cars & Bids results) realized value is added to the metric as `best_v2`, published beside `best_v1` in `firecrawl_lot_score`
  (the key is event and version) with its diff against v1 per source. v2 is not built yet: the first outcome feed is the gap.

### best_v1.1: the lot-level quality component (owner, 2026-10-15)

The owner called eBay "low quality"; lane-ebay's 0-credit audit measured what that means on 1,121 landed lots (no observable
outcome, 29% of the "private" listings use dealer wording, 17% parts or project wording, typed VINs that are not 17 characters,
relists). Those are properties of a lot and apply to every source, so they are lot-level signals in `lot_quality_signal`
(event, signal, value, method, evidence), and `best_v1_1` adds a quality component:

    quality    = checks passed / checks known, over: no dealer wording, no parts or project wording, VIN not noisy
                 (a 1981-or-later VIN that is not 17 characters, a masked VIN, or a typed-VIN conflict), not a relist,
                 and, when recorded, seller_type = private. No check known = unknown, which counts 0.
    best_v1_1  = ( 2 x tier + complete + 2 x outcome + unique + group + quality ) / 8

Method `lexicon_v1` derives the four checks from the stored description, year, VIN and events for every scored lot (the
lexicons are `firecrawl_params` rows `lexicon_dealer` and `lexicon_parts_project`, from the terms lane-ebay used). A lane that
reads the lot better writes the signal with its own method through `record_lot_quality_signals()` and its value overrides the
derived one. v1 and v1.1 are both scored for every lot; `firecrawl_backtest(since, until, 'best_v1_1')` returns either.
Seller type is proposed in `docs/proposals/2026-10-15-seller-type-observation.md`.

**Target classes found by the backtest.**
- *Cars & Bids recapture* (re-fetching a lot whose only snapshot is old, to read its result) is a negative example: lane-online
  measured about 85% of the recapture spend landing on lots that no longer exist (C&B serves its not-found shell with HTTP 200),
  roughly 10-17 credits per real result. Cars & Bids returns 0.291 best_v1 per credit over 30 days, dragged down by it, against
  0.531 for the landing batch alone. A lot whose only snapshot is old and which has no result is the worst target class.
- *Collecting Cars is a trial*, capped at 50 credits (`firecrawl_source_params.credit_cap`): 1964-1991 lots, public listing pages
  only (never the search index), at most 15 a day through daily-capture-master. After 30 scored lots its observed return replaces
  the prior.

### Target classes, scoped gaps and the leftover floor (owner-lead, 2026-10-15)

- **Landing and re-fetch.** A Firecrawl fetch of a URL that already has a successful capture is a *re-fetch*; every other fetch is a
  *landing*. Only landings count in the observed return (`firecrawl_lot_score.fetch_class`) and only landings are allocated; re-fetch
  credits are reported as `refetch_credits_excluded` in the source's inputs and are never funded. Cars & Bids' recapture is the
  negative example (about 85% of it hit removed auctions).
- **Scoped gap.** A source without a whole-source population can still have a lower-bound gap from a scoped census window: a census
  row with `universe_historical` NULL and `raw_response.gap_tier_missing` (the tier-relevant ids the window lists that are not held,
  by slug model year 1964-1991). The gap is labelled `gap_basis = scoped_window`. Cars & Bids: 483 on 2026-10-15.
- **Leftover floor.** A scoped-window source takes no part in the base stage. The credits left after the base stage go, in rank
  order, only to sources whose rank key is at least `min_rank_leftover` (0.5), up to the same caps: a low-return source does not
  soak up leftover just because it has a gap.

### One rank floor, and a target slice (owner-lead, 2026-10-15)

- **One floor.** `min_rank_leftover` (0.5) applies to every source: a rank key below it receives no credits. An earlier version
  applied it only to a source whose gap came from a scoped census window, so KSL (rank 0.313) was funded while Cars & Bids
  (0.336) was not. A source below the floor is paused with the reason in its inputs (KSL) and is released when its rank clears it.
- **Target slice.** A source can be bought for a slice of model years (`slice_year_from`, `slice_year_to`; Cars & Bids 1964-1991, the
  tier years, since it blocks direct reads and Firecrawl is its only path). Its prior value is the mean best_v1.1 of its slice lots,
  its live gap is its supply rate times the slice share of its landed lots, and it pays an overhead (`overhead_credits_per_day`, an
  index page a day) spread over the slice gap as an effective cost per lot. Where no end-time clock exists, the supply rate is the
  scoped census window's ids per day. The observed return counts only fetches and lots since `slice_since`, so the old practice
  does not judge the new one.

### The pipeline runs bounded, behind the IO gate (owner-lead, 2026-10-15)

A one-shot recompute that read from disk for about 11 minutes made pg_cron fail to start 9 jobs, because on this instance a saturated
disk stalls new connections. The recompute is therefore a pipeline of bounded steps, run by `firecrawl_pipeline_step()` from a cron
tick every 5 minutes with a 60 s ceiling, each step behind `firecrawl_io_gate()` (no more than 3 client queries on DataFileRead,
no lock waits, no PostgREST query slower than 2 s; closed gate = do nothing). The steps: the vehicle-group scores weekly
(`firecrawl_refresh_groups`), one stale source sample at a time (`firecrawl_sample_source`: at most `sample_rows_per_source` =
1,500 events joined to vehicles, best_v1 and best_v1.1 per lot, an exact event count), the lots Firecrawl landed since the last
scored lot (`firecrawl_score_lots`, daily), then the allocation (`refresh_firecrawl_target_allocation`), which reads only stored
samples, group scores, census rows, lot scores and credit counts and scans neither `vehicle_events` nor `vehicles`. Samples older
than 6 days are taken again. Runtimes are in `firecrawl_pipeline_log`.

**Where it lives.** Tables `firecrawl_params`, `firecrawl_source_params`, `firecrawl_spend_log`, `firecrawl_target_allocation`, `firecrawl_group_score`, `firecrawl_lot_score`;
functions `refresh_firecrawl_target_allocation` (cron `firecrawl-target-allocation-weekly`, Mondays 05:17Z), `firecrawl_allowance`,
`firecrawl_record_spend`, `firecrawl_score_lots`, `firecrawl_best_v1`, `firecrawl_best_v1_1`, `firecrawl_backtest`, `record_lot_quality_signals`; migrations `20261017010000_firecrawl_target_allocation.sql`, `20261017011000_firecrawl_allocation_supply_clock.sql`, `20261017020000_firecrawl_best_v1.sql`, `20261017030000_firecrawl_best_v1_1_lot_quality.sql`. Read the ranking with
`select * from firecrawl_target_allocation where computed_at = (select max(computed_at) from firecrawl_target_allocation) and vehicle_group = '*'`.
