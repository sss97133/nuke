# Pre-mint memo: the climate dimension (2026-10-13)

**Status:** proposal, docs only. Nothing in this memo has been applied. It is the SCHEMA_LAW pre-mint checklist for
an abstract need in `v_stacks.needs_missing`. Every number below is a read-only production read through
`scripts/data/q.sh`, between 2026-10-13 08:43Z and 08:46Z, unless it says otherwise.

**Recommendation: mint one narrow table only after its source is fetched and checked.** It would be a county-by-period
climate series keyed to the declared place entity (`us_county_boundaries.fips`), in the house observation grammar,
with one loader. Nothing that exists today holds climate. Until a loader is ready, do nothing: an empty table would
move no stack.

## The need

```sql
select need, count(*) n_stacks, array_agg(stack_id order by stack_id) stacks
from (select stack_id, unnest(needs_missing) as need from v_stacks) x
group by 1 order by 2 desc, 1 limit 12
```

| Need | Stacks missing it | Memo |
|---|---|---|
| text fold | 5 (S04, S05, S19, S34, S36) | open, #910 |
| parts and labor taxonomy | 4 (S07, S31, S55, SB) | open, #922 |
| **climate dimension** | **3 (S27, SB, SD)** | **this memo** |
| dense dated sales | 3 (S18, S38, S51) | open, #968 |
| odometer observation kind | 3 (S08, S28, SB) | open, #987 |
| option keys | 3 (S12, S14, S30) | merged, #804 |
| state-history dimension | 3 (S16, S27, S44) | none |

The two needs ahead of it already have open memos, so a second memo would duplicate them. Of the 3-stack ties,
`climate dimension` and `state-history dimension` have no memo, and the tie was broken alphabetically.

- **The substrate row.** In `stack_substrates`, `climate dimension` has `declared_table` NULL. Its note reads
  "Climate per place (case ledger 13.2 item 27, stacks B and D)". 2 of 61 substrates have a declared table: the place
  entity (`us_county_boundaries`) and the platform entity (`observation_sources`). 67 stacks are registered.
- **The three stacks** (`v_stacks`, measured 2026-10-13 08:44Z):

| Stack | Question | Coverage | Missing needs |
|---|---|---|---|
| S27 Corrosion exposure prior | Given where a vehicle has lived and the climate there, how likely is corrosion, zone by zone? | 0.0 (0 of 3) | climate dimension, image zone dimension, state-history dimension |
| SB The car as a bond | Cost to own and value at 1, 3 and 5 years, per county | 0.11 (1 of 9 present, 3 partial) | odometer observation kind, climate dimension, failure-mode dimension, jurisdiction dimension, parts and labor taxonomy |
| SD Ownership as flow | Per cohort and quarter, how do vehicles flow between counties? | 0.4 (2 of 5) | title observations with clocks, Census dimension, climate dimension |

- **The `stack_needs` notes:** SB says "climate per county" and SD says "gravity model: climate". S27 has no note.
  All three are at `layer = dimension`, `kind = abstract`.
- **The case ledger** (`data-machine-cases.md` 13.2): stack B predicts cost of ownership "per county (tax, emissions,
  climate)". Stack D's baseline is "a gravity model (population, income, distance, climate)". Item 27 is "corrosion
  exposure prior (state history, zone dimension, climate dimension)".

**A climate table alone completes none of the three stacks.** It removes one missing need from each. S27 still needs
state history and the image zone dimension. SD still needs title clocks and the Census dimension. SB still needs four.

## The seven questions

### 1. §1 search before mint: candidates read, no fit proven?

Name search over `information_schema.tables` for climate, weather, noaa, rust, humid, salt, region, county, place,
geo, zip, census and dimension. Then a column search over all public tables for climate, humid, precip, snow,
salt, rust_belt, weather and temperature.

| Candidate | Rows | What it is | Fit |
|---|---|---|---|
| `us_county_boundaries` | 3,231 | The declared place entity at county grain: `fips` (PK), `name`, `state_fips`, `geom`. Three foreign keys point at it: `vehicle_location_observations.county_fips`, `zip_to_fips.fips`, `sale_residual_episode_measurements.county_fips`. | **The key, not the home.** Climate is many measures over many periods per county. Adding columns would hold one period and drop the clock. |
| `vehicle_intelligence.climate_history`, `.rust_belt_exposure` | 83,018 rows; **0 filled** and **0 true** | Regex flags on seller descriptions (see its table comment). | Seller mentions, not climate, and empty anyway. |
| `organizations.has_climate_storage` | n/a | A facility attribute (climate-controlled storage). | Different concept. |
| `zip_to_fips`, `geocoding_cache`, `city_geocode_lookup`, `known_places`, `v_place_anchor` | 41,173 (zip_to_fips) | Crosswalks and lookups into the place. | Routes into the county key; holds no climate. |
| `observation_sources` | 0 slugs matching noaa, ncei, weather, climate or nws | The platform and source registry. | No climate source is registered. |
| `source_census` | n/a | Matched by "census". Not read in this run. | Unknown; read it before minting. |

**No fit is proven, so a new organ is earned at county x period grain.** Nothing holds a climate value. The place it
keys to already exists and is declared.

### 2. §2 is this a fact class that should be observation rows instead?

**A published series, stored in the observation grammar.** A county's climate for a period is a published statistic
about a place, not testimony about a vehicle. `vehicle_observations` is the vehicle testimony log, and a county's
climate has no vehicle. The §1 search found no observation table whose subject is a place. The query pattern earns its own table:
- S27 needs a range join (a vehicle's dated counties x climate per period).
- SD needs a per-county, per-quarter join into a gravity model.
- SB needs a per-county lookup.

Per §2, the table still mirrors the observation grammar (§3) rather than inventing a shape.

### 3. §3 DNA columns named canonically, trust in T1/T2/T3, vocabularies CHECKed and documented?

Proposed shape, named `county_climate_observations` (house grammar `*_observations`, §8):

| Column | Meaning |
|---|---|
| `id` | uuid PK |
| `county_fips` | text NOT NULL, FK to `us_county_boundaries(fips)` |
| `measure` | text NOT NULL, CHECK against a written list in the migration comment. First list: mean, minimum and maximum air temperature, precipitation, and days below freezing. Snowfall and road-salt use only if a source carries them (see Q7). |
| `period_start`, `period_end` | date NOT NULL, the climate clock (event time): a month, or a normals window such as 1991-2020 |
| `value`, `unit` | numeric NOT NULL; unit CHECKed per measure (degC, mm, days) |
| `source`, `method`, `observed_at`, `trust`, `confidence_score`, `is_superseded`, `superseded_by`, `structured_data` | The DNA tuple, canonical names. `observed_at` = when the loader read the published file (ingest clock). `trust` = T2 (attributed, published by an agency). |

Live uniqueness: `UNIQUE (county_fips, measure, period_start, period_end, source) WHERE NOT is_superseded`.

### 4. §4 could a view do this? Corrections as supersession?

- **The storage: no.** No relation holds a climate value to view.
- **Everything downstream: yes.** These should be views or folds over the new table: a per-vehicle exposure joined
  through `mv_vehicle_county` (287,613 vehicles with one current county) or a future state-history fold, and the
  per-county features for SB and SD.
- **Corrections:** a revised publication supersedes the old row through
  `superseded_by`. It is never an UPDATE.

### 5. §5 invariants at the data layer, with attack tests?

These would be constraints in the minting migration:
- the county foreign key;
- the measure and unit CHECKs;
- `period_end >= period_start`;
- the partial unique index;
- `trust IN ('T1','T2','T3')`.

The PG17 contract, under `supabase/sql/` in `frontend-tests.yml`, would attack each one. It would insert a county
missing from `us_county_boundaries`, an unknown measure, a wrong unit, an inverted period, a duplicate live row, a
fact-column UPDATE, and an anon or authenticated write.

### 6. §6 writers disjoint, registry rows included?

One writer: a loader that reads the chosen published county series and inserts by supersession. It ships with:
- its `pipeline_registry` table-level row (`owned_by` the loader, `do_not_write_directly` true);
- the `stack_substrates.declared_table` update for `climate dimension`;
- an `observation_sources` row for the publisher. That table is the declared platform entity, so `source` can key to
  it the way #1020 proposes for `source_targets` (open, not merged).

No other writer. Readers never write back.

### 7. §7 migration file, WHY comment, live-verification notes, RLS posture?

- **Migration:** one file, plain `CREATE TABLE` (no `IF NOT EXISTS`, per §1). Its WHY block cites this memo and the
  three stacks. RLS on, with SELECT for anon and authenticated (published public data) and no write grant outside
  the service role.
- **Open before minting (Unknown tonight).** This run made no external fetch:
  - **The source and its grain.** NOAA NCEI's county-level climate divisional series (nClimDiv) and the U.S. Climate
    Normals are the candidates to check. Whether they cover all 3,231 counties in `us_county_boundaries`, and which
    measures, periods and units they publish, is unverified here.
  - **Snowfall and road salt.** S27 asks about corrosion, and road salt is a candidate driver that the first measure
    list does not carry. Which source publishes salt use per county or state, if any, is Unknown.
  - **Non-US places.** The place entity is US-county only. Climate for vehicles outside the US needs a place level
    that does not exist yet.

## First reader and what it would move

- **First reader:** S27's exposure fold, as a view per vehicle and dated county x climate per period.
  - **Today:** it can run only on current county. `mv_vehicle_county` has 287,613 vehicles.
    `vehicle_location_observations` has 587,613 rows, of which 531,821 carry `county_fips` across 2,458 of 3,231
    counties (read between 08:44Z and 08:45Z). The count of distinct vehicles with a county timed out at the 55 s read bound: Unknown.
  - **The full prior** waits for the state-history dimension (also unmemoed, also 3 stacks).
- **Moves:** `n_missing` drops by one in S27, SB and SD. No stack reaches full coverage from this alone, so a
  readiness claim would need the other missing needs listed above.
- **Next memo:** the state-history dimension (S16, S27, S44). It is the other unmemoed 3-stack need, and S27 needs
  both.
