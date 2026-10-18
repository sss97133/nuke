# Pre-mint memo: the place entity (2026-10-07)

**Status:** proposal, docs only. Nothing in this memo has been applied. It is the SCHEMA_LAW pre-mint checklist for
the abstract need named in the most `v_stacks.needs_missing` lists. Every number below is a read-only production read
through `scripts/data/q.sh`, between 2026-10-07 08:39Z and 08:44Z.

**Recommendation: do not mint.** Declare the existing `us_county_boundaries` as the place entity at county grain in
`stack_substrates`. Key `vehicle_location_observations.county_fips` to it with a NOT VALID foreign key. Leave the state,
region and country levels until a reader needs one (see Q4).

## The need

```sql
select m as need, count(*) as n_stacks, string_agg(stack_id::text, ',' order by stack_id) as stacks
from v_stacks, unnest(needs_missing) m group by m order by n_stacks desc, m limit 12
```

- **The ranking.** `place entity` is missing in **10 of 65 stacks**: S01, S11, S13, S16, S40, S42, S61, SB, SC and SD. The next substrate, `text fold`, is missing in 5.
- **The substrate row.** `stack_substrates.declared_table` is NULL for `place entity`. That is why each of the 10 needs reads "no table declared for this substrate". None of the 61 substrates has a declared table yet.
- **Coverage of the 10 stacks.**
  - Today it is 0.0 for nine of them; SD is at 0.2.
  - `place entity` is the only need of **S01** (County performance surface per model), whose coverage is 0 of 1.
  - It is one of two needs for S11, S40 and S42. Their other need is `identity location` or stack S12.
- **The case ledger.** C8 says "Place is not an entity", and the open repair is "a place entity with hierarchy
  (county → state → region); keys from vehicles, organizations, listings" (`data-machine-cases.md`, case C8). §13 row 1
  names the chain: lot rows → seller location → geocode → county FIPS → residual.

## The seven questions

### 1. §1 search before mint: candidates read, no fit proven?

The name search over `v_schema_atlas` matched place, location, geo, county, fips, zip, address, venue, region, city and site. The candidates were read live:

| Table | Rows | Key | What it is | Fit as the place entity |
|---|---|---|---|---|
| `us_county_boundaries` | 3,231 | PK `fips` (text) | One row per US county: name, `state_fips`, PostGIS `geom`. 56 distinct `state_fips`. | **Fits at county grain.** It has a stable public key (county FIPS) and geometry for point-in-county. No foreign key points at it today (0). |
| `zip_to_fips` | 41,173 | PK `zip` | ZIP → county FIPS lookup: 3,229 distinct FIPS. 244 ZIP rows name a FIPS that is not in `us_county_boundaries`. | A crosswalk into the county key, not an entity. |
| `vehicle_location_observations` | 574,661 | `id`; keys only to vehicles | Dated location testimony per vehicle and source. 337,576 rows (58.7%) carry `county_fips`, with 2,217 distinct values, of which **2,216 exist in `us_county_boundaries`**. 269,508 carry a postal code and 353,051 carry coordinates. Last write 2026-10-07 08:40Z. | The log that keys *to* the place; already county-coded as text. |
| `mv_vehicle_county` (matview) | 287,613 | `vehicle_id` | One county per vehicle by PostGIS point-in-county against `us_county_boundaries` (20260713020000). 2,200 distinct counties. Read by `county_density_filtered()`. | An existing reader of `us_county_boundaries` as the place. |
| `geocoding_cache` | 26,385 | PK `location_string` | Geocoder lookup (lat, lon, city, state, country). | No id to key to (its atlas purpose says so). |
| `city_geocode_lookup` | 12,941 | n/a | City → GPS lookup for backfills. | A lookup, not an entity. |
| `organization_locations` | 4,593 | `id`, FK organization | Addresses of organizations (showrooms, warehouses). | Org-scoped addresses; a future keyed reader of the place, not the place itself. |
| `known_places`, `user_sites`, `device_locations` | small | `id` | The owner's own named places and pings. | Private, per-user; not a public gazetteer. |
| `fb_marketplace_locations` | 582 | n/a | Metro areas for sweep scheduling. | Sweep configuration. |

**No fit for a new table is proven at county grain.** `us_county_boundaries` already carries the key that the busiest
location log (`vehicle_location_observations.county_fips`) uses, with 2,216 of 2,217 codes matching. An existing
reader (`mv_vehicle_county`) already treats it as the place. What does **not** exist is any table for state, region,
country or non-US places. `us_county_boundaries.state_fips` is a code with no name table, and the 56 distinct codes
include territories.

### 2. §2 is this a fact class that should be observation rows instead?
**Split.**
- **Where a thing is, is testimony.** It already lands as observation rows in `vehicle_location_observations`, and for people as identity-subject observations folded by `fold_external_identity_location()`. It needs no new table.
- **The place itself is not testimony.** A county with its FIPS code and boundary is reference data published by the US Census Bureau. It is a dimension that observations key to, and a dimension of this kind already exists. Nothing new is earned at county grain.

### 3. §3 are the DNA columns named canonically, trust in T1/T2/T3, vocabularies CHECKed and documented?
**Not today.** `us_county_boundaries` has only `fips, name, state_fips, geom`.
- **Source and vintage.** It carries no `source` and no release vintage. Which TIGER/Line or Census release loaded it is **Unknown**: no writer is in the repo, and no row write is recorded since the statistics reset.
- **Format checks.** There is no CHECK on the FIPS format.

The declaring migration should add:
- **Comments:** `COMMENT ON TABLE` and `COMMENT ON COLUMN` naming the source as Unknown until it is found, the grain, and the key.
- **CHECKs:** `fips ~ '^[0-9]{5}$'` and `state_fips = left(fips, 2)`. Each needs a check on the 3,231 rows first, then a NOT VALID add if any row fails.

Trust: reference rows from a public registry are not testimony, so no T-level applies. The observations that key to them keep their own trust.

### 4. §4 could a view do this? Are corrections modeled as supersession?
- **County grain needs no view.** The table exists.
- **State grain** could be a view over `us_county_boundaries` (distinct `state_fips`). But it would have codes without names, and `stack_coverage()` measures a substrate through `v_schema_atlas`, a table list. So a declared view would read "no such table". The state level waits for the first reader that needs a state name or boundary (S16's `state-history dimension` is a separate substrate). That reader then decides between a small reference table and a view.
- **Corrections.**
  - A boundary change (Census re-releases, the Connecticut planning-region FIPS change of 2022) is a new vintage row set, not an UPDATE. This needs a `vintage` column before a second vintage is loaded.
  - The text `county_fips` on observations is never rewritten. A re-geocode is a new observation.

### 5. §5 are invariants constraints or triggers, with attack tests written?
The invariants, each as a constraint:
- **Observation key.** `vehicle_location_observations.county_fips` references `us_county_boundaries(fips)`, NOT VALID. The one unmatched code stays unchecked, and new codes must exist.
- **Crosswalk key.** `zip_to_fips.fips` references `us_county_boundaries(fips)`, NOT VALID. 244 rows are left unchecked, and the memo does not decide them.
- **Format.** The FIPS format CHECKs from Q3.

Attack tests belong in a PG17 contract beside the existing ones (`supabase/sql/test_*`, wired in `frontend-tests.yml`):
- an unknown FIPS refused on insert;
- a malformed FIPS refused;
- an existing orphan left readable;
- a county delete refused while observations reference it.

None is written yet; they ship with the migration, not with this memo.

### 6. §6 is writer disjointness stated, and are registry rows included?
- **`us_county_boundaries` has no live writer.** It is reference data loaded once; its loader is Unknown. The declaring migration includes:
  - its `pipeline_registry` table-level row: owned_by "reference load, loader Unknown", `do_not_write_directly` true;
  - the `stack_substrates` declaration (`declared_table`, `declared_at`, `declared_by`).
- **`vehicle_location_observations` writers keep their columns.** Its writers (extract-bat-core, extract-cars-and-bids-core, process-cl-queue, scripts/geocode-backfill.mjs, per its atlas purpose) keep owning `county_fips`. The foreign key changes no writer, and it refuses only a code that is not a county.
- **Unverified.** Whether any of those writers ever writes a code outside the table is not verified beyond the 2,216 of 2,217 match. A writer-by-writer receipt read belongs in the migration's evidence.

### 7. §7 is it a migration file, with a WHY comment, live-verification notes and RLS posture?
- **Migration.** The declaration is a migration file. It cites this memo, re-reads the counts above, and states the before and after measures below.
- **RLS.** `us_county_boundaries` has RLS enabled with **no policy** (`pg_policies` is empty for it and for `zip_to_fips`), so anon and authenticated read nothing, though the default table grants exist. Public county names and boundaries carry no private data. If a public page needs them, the migration should add an explicit SELECT policy; otherwise it should state deny-by-default and name `service_role` as the reader.

## First reader, and what it unblocks
- **First reader: `stack_coverage()`.** Once `stack_substrates.declared_table = 'us_county_boundaries'` is set, the function measures all 10 stacks on that table at once, with no new stack version. That is the registry's "sources are pluggable" rule.
- **First product reader: S01, County performance surface per model.** Its chain lot → seller location → county FIPS is already half-built:
  - `vehicle_location_observations.county_fips` is filled on 58.7% of rows;
  - `mv_vehicle_county` resolves 287,613 vehicles to 2,200 counties.

  Its missing piece after the declaration is the per-county residual fold. That is a fold need, not a substrate.
- **Expected measure after declaration:**
  - S01 coverage 0/1 → 1/1, if `stack_coverage()` finds the table present by rows (3,231 > 0).
  - The other nine stacks each gain one present need of n.
  - `stack_substrates` declared: 0 of 61 → 1 of 61.
- **What stays missing:**
  - `identity location` (S11, S40);
  - `state-history dimension` (S16);
  - `Census dimension` and `climate dimension` (SD, SB);
  - non-US places. US county grain is all this declaration covers, and the denominator for a world map is not met.

## What this memo does not do
- **No database changes.** It does not declare the substrate, add the keys or write the contract. Those are one migration, after review.
- **No new table.** It mints no table for states, regions or countries.
- **No orphan decisions.** It does not decide the 244 `zip_to_fips` rows or the one unmatched observation code.
