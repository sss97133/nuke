# Pre-mint memo: the state-history dimension (2026-10-14)

**Status:** proposal, docs only. Nothing in this memo has been applied. It runs the SCHEMA_LAW pre-mint checklist for
the highest-ranked abstract need in `v_stacks.needs_missing` that has no memo yet. Every number below is a read-only
production read through `scripts/data/q.sh`, taken between 2026-10-14 08:42Z and 08:44Z. The script's role stops
statements at about 10 s, so every read over `vehicle_location_observations` uses a 1% block sample (`tablesample system(1)
repeatable(14)`). Sample figures are labeled as estimates.

**Recommendation: do not mint a table.** The evidence already sits in `vehicle_location_observations` (dated places,
two-letter US state codes) and `vehicle_events` (the listing episode that supplies each live row's event clock). The
dimension is a fold of those two, so it should be a view: one row per vehicle state spell, with its clocks and sources.
One thing blocks declaring a view as the substrate. `stack_coverage()` resolves a declared table through
`v_schema_atlas`, which lists only ordinary tables (954 rows, all relkind `r`). A declared view would still read
"missing". The smallest repair is in that existing reader (Q7), not a new table.

## The need

```sql
select need, count(*) n_stacks, array_agg(stack_id order by stack_id) stacks
from v_stacks, unnest(needs_missing) need group by need order by n_stacks desc, need limit 12
```

Read 2026-10-14 08:42:07Z; 65 stacks, 107 missing needs in all.

| need | stacks | memo |
|---|---|---|
| text fold | 5 (S04, S05, S19, S34, S36) | open, #910 |
| parts and labor taxonomy | 4 (S07, S31, S55, SB) | open, #922 |
| climate dimension | 3 (S27, SB, SD) | open, #1021 |
| dense dated sales | 3 (S18, S38, S51) | open, #968 |
| odometer observation kind | 3 (S08, S28, SB) | open, #987 |
| option keys | 3 (S12, S14, S30) | merged, #804 |
| S12 | 3 (S42, S57, SC) | a stack dependency, not a substrate |
| **state-history dimension** | **3 (S16, S27, S44)** | **none: this memo** |

Every higher or tied need already has a memo, so this one takes the slot; a duplicate memo would add nothing.

- **The substrate row.** `stack_substrates` holds `state-history dimension` with `declared_table` NULL and the note "The
  states a vehicle has lived in over time, from dated locations (case ledger §13 row 16, 13.2 items 27, 44)". Each of
  the three `stack_needs` rows is `kind abstract, layer dimension`; S16's note reads "from dated locations".
  `stack_coverage()` reports each one as `{"verdict": "missing", "evidence": {"reason": "no table declared for this
  substrate"}}`.
- **The three stacks** (`v_stacks`, 08:42Z):
  - **S44** Cohort migration ("How do cohorts move between states over time?"): coverage 0 of 1. State history is its
    only need.
  - **S16** Provenance depth and exposure history: coverage 0.20. 1 need present, 2 partial (`ownership_transfers`
    from/to identity), 2 missing (`ownership_transfers.auction_event_id` and this one).
  - **S27** Corrosion exposure prior: coverage 0 of 3. Missing: climate dimension (memo #1021), image zone dimension
    and this one.
- **The case ledger.** §13 row 16 names "a state-history dimension from dated locations" as the missing piece of
  provenance depth. 13.2 lists it under the physics of the asset (27) and under cohort migration (44).

## The seven questions

### 1. §1 search before mint: candidates read, no fit proven?

Searched `pg_class` in `public` for `location`, `state_hist`, `registration`, `residen`, `title`, `geograph`,
`county`, `place`, `ownership`, `us_state`, `_states`, `mv_state`, `climate`. Candidates read:

| candidate | rows (est.) | fit |
|---|---|---|
| `vehicle_location_observations` | 593,128 | **The evidence.** One row per place a source gave for a vehicle, with `region_code`, `country_code`, `county_fips`, `observed_at`, `source_platform`, `source_type`, `source_url`, `confidence`. In the 1% sample (6,019 rows): 5,113 carry `region_code`, 5,108 of them a two-letter US code. It is not the dimension itself: rows repeat on every extraction, and on live rows `observed_at` is the read time, not the time the vehicle was in that place (table comment, 2026-10-07). |
| `vehicle_events` | n/a | **The event clock.** It has `source_url`, `started_at`, `ended_at`, `sold_at`. In a 300-row sample of live BaT location rows (`tablesample system(0.2) repeatable(7)`), **300 of 300** join an episode on `(vehicle_id, source_url)`, and 186 of those have `ended_at`. |
| `us_county_boundaries` | 3,231 | The place entity at county grain (declared 2026-10-07); `state_fips` gives the state level. It holds places, not vehicle-over-time rows. |
| `vehicles` (`state`, `registration_state`, `listing_location_*`) | — | Current-value cache columns, one value per vehicle with no history. 1% block sample (10,349 rows): `state` 4,005, `registration_state` 0, `listing_location_observed_at` 2,433. |
| `ownership_transfers`, `vehicle_ownerships`, `deal_ownership` | 140,612 / 13 / 18 | No location columns. |
| `mv_state_market_summary`, `vehicle_map_state_data` | 49 / — | Market aggregates per state, not per vehicle; their refresh job is inactive (`vehicle_location_observations` comment). |
| `device_locations` | 8,034 | Raw pings for the owner's devices, not vehicles at large. Out of scope. |

**No table has the shape** (vehicle × state spell with clocks), and nothing new needs to be stored. Every input exists;
what is missing is the fold.

**The depth exists but is thin.** I took a size-biased vehicle sample: every vehicle with a row in the 1% block sample,
then all rows of those vehicles through `idx_vehicle_location_observations_vehicle_time`. That gave 5,706 vehicles and
29,105 rows. In it:
- 5,093 vehicles carry a state;
- **153 carry two or more distinct states** (2.7%);
- 2,253 have rows on two or more days;
- 542 span more than a year;
- 288 have rows from two or more platforms.

Of the multi-state vehicles' rows, 1,459 are live BaT listing rows (145 vehicles), 280 are Cars & Bids (8 vehicles) and
121 are photo-EXIF sightings (1 vehicle). The rest are hand-loaded copies of `vehicles`. Because the sample is
size-biased, these shares are estimates of the sample, not of the fleet. The full-population count of multi-state
vehicles is **Unknown**: a full scan exceeds the statement limit. The view's first assay should measure it.

### 2. §2 is this a fact class that should be observation rows instead?

The facts are already observation rows (`vehicle_location_observations`, with source, URL and clock). A state spell is
a **computed conclusion** from those observations plus episode clocks. In the four-stage vocabulary of
`data-machine.md`, it is not a new captured observation. It should not be written back as one, or the same testimony
would be counted twice.

### 3. §3 are the DNA columns named canonically, trust in T1/T2/T3, vocabularies CHECKed and documented?

A view inherits its vocabulary. Proposed output columns, using the house names:
- `vehicle_id`
- `state_code`: two-letter US code from `upper(region_code)` where `country_code` is US or null. Non-US rows are
  excluded and counted in the assay.
- `first_seen_at` and `last_seen_at`: the event clock.
- `clock_kind`: `episode_end`, `episode_start`, `observed_event` or `read_time`. Documented in the view comment; a view
  has no CHECK, so the assay enforces the list.
- `source_platforms` (array), `n_observations`, `source_observation_ids` (array, the keys back to the evidence), and
  `confidence` (min of the inputs).

Trust: listing-parsed places are **T3** (scraped seller text). Photo-EXIF sightings are GPS readings from the
uploader's camera; their trust tier is **Unknown** until the image-trust owner rules on it. They should stay
distinguishable by `source_type = 'sighting'`. `vehicle_location_observations` has no `trust` or `is_superseded`
column (catalog, 08:44Z), so the view cannot propagate supersession. That gap belongs to the table's owner and is
recorded here, not solved.

### 4. §4 could a view do this? Are corrections modeled as supersession?

**Yes, a view.** Sketch (not applied):

```sql
-- v_vehicle_state_spells (proposal): one row per vehicle x consecutive run of one state, ordered by event clock
with obs as (
  select o.id, o.vehicle_id, upper(o.region_code) as state_code, o.source_platform, o.source_type, o.confidence,
         coalesce(e.ended_at, e.started_at,
                  case when o.metadata->>'source' is not null or o.source_platform = 'facebook_marketplace'
                       then o.observed_at end) as event_at,
         case when e.ended_at is not null then 'episode_end'
              when e.started_at is not null then 'episode_start'
              when o.metadata->>'source' is not null or o.source_platform = 'facebook_marketplace' then 'observed_event'
              else 'read_time' end as clock_kind,
         o.observed_at
  from vehicle_location_observations o
  left join lateral (select ve.started_at, ve.ended_at from vehicle_events ve
                     where ve.vehicle_id = o.vehicle_id and ve.source_url = o.source_url
                     order by ve.ended_at desc nulls last limit 1) e on true
  where o.region_code ~ '^[A-Za-z]{2}$' and coalesce(o.country_code, 'US') in ('US', 'USA')
)
-- then gaps-and-islands over (vehicle_id order by coalesce(event_at, observed_at)) into spells
```

The view picks the event clock first and falls back to the read time only when labeled so. Repeated reads of one
listing collapse into one spell. A correction to an observation (a new superseding row, once the table supports it)
changes the view's output on the next read without any write. If the planner cost of the lateral join is too high for
an interactive reader, the earned next step under §2 is a **materialized view refreshed by an existing job**. A table
with its own writer is still not needed.

### 5. §5 are invariants constraints or triggers, with attack tests written?

A view has no constraints. Its invariants belong in a PG17 contract test beside the existing ones (`supabase/sql/`),
with one attack per invariant:
1. A live listing row with no matched episode yields `clock_kind = 'read_time'`, never an event clock.
2. Two reads of one listing (same vehicle, URL and state) yield one spell, not two.
3. A non-US or non-two-letter region never yields a `state_code`.
4. A vehicle seen CA → AZ → CA yields three spells in event order, not two states.
5. Each spell's `source_observation_ids` resolve to rows of `vehicle_location_observations` for the same vehicle.

None is written yet. The tests come with the view migration, not with this memo.

### 6. §6 is writer disjointness stated, and are registry rows included?

The view has no writer. The writers of its inputs stay as they are and declared:
- `pipeline_registry` table-level row for `vehicle_location_observations`: owner `extract-bat-core`; `write_via` names
  extract-bat-core, extract-cars-and-bids-core and process-cl-queue.
- Column rows for `county_fips` and `county_name`: owner `trg_key_vehicle_location_county`.

The view migration should add one `pipeline_registry` row for the view (owner: the migration; `do_not_write_directly`
true), so the atlas and the residual can see that the fold has an owner.

### 7. §7 is it a migration file, with a WHY comment, live-verification notes and RLS posture?

Two migrations, one per PR:
1. **The view.** `v_vehicle_state_spells`, with a WHY comment citing this memo, the live counts above re-read on the
   day, and `security_invoker = true`. **RLS posture:** `vehicle_location_observations` admits anon to every row today
   (its table comment), including the exact GPS points and times of photo sightings. The view should exclude
   `source_type = 'sighting'` from any grant to anon, or be granted to `service_role` and named readers only, until the
   image-privacy owner rules. Spells from public listings are public testimony.
2. **The reader repair.** Let `stack_coverage()` resolve a declared substrate through `to_regclass` and accept relkind
   `v` or `m`, judging a view present when its definition parses and it returns a row. Then declare
   `state-history dimension → v_vehicle_state_spells` in `stack_substrates`. The fallback, if the owner of
   `stack_coverage` prefers no reader change, is to declare `vehicle_location_observations` itself. The verdict would
   then mean "evidence present", not "fold present", and that is an overclaim this memo advises against.

## First reader, and what it unblocks

- **First reader: S44 Cohort migration.** It is the stack with state history as its only need: coverage 0 → 1 of 1 once
  the substrate resolves. Its first answer: for a cohort (model × generation), the count of vehicles whose consecutive
  spells change state, by origin and destination state, per year of `first_seen_at`. Report it with the eligible
  population (vehicles with ≥ 2 dated spells) beside the full population.
- **S16 Provenance depth and exposure history:** coverage 0.20 → 0.40 (its other missing need,
  `ownership_transfers.auction_event_id`, stays open).
- **S27 Corrosion exposure prior:** 0 → 1 of 3; it still needs the climate dimension (#1021) and the image zone
  dimension.

The coverage changes above are `stack_coverage` verdict counts, not readiness. Whether the spells answer the stack
questions well is a separate assay. For example, a BaT relist across states is a move of the listing location, which is
evidence of where the vehicle was offered, not where it lived.

## What this memo does not do

It applies no migration, declares no substrate and writes no row. It does not measure the full-population count of
multi-state vehicles (Unknown; the first assay of the view must). It does not rule on the trust tier or public
exposure of photo-EXIF sightings.
