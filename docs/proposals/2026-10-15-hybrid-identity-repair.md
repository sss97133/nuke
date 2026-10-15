# Hybrid vehicle rows: a lot's own sale under another car's identity (proposal, 2026-10-15)

Status: plan. Nothing has been written. The population count comes from `mv_family_year_prices.conflicts` after its
first build (cron `refresh-family-year-prices`, 09:40 UTC). Owner of the plan: lane skylar-08. Readers affected:
skylar-83 (mv_treemap_outcomes, mv_family_market, the brand map). Writer bug: routed to the intake lane by skylar-83.

## What is wrong

Some recorded sales sit under the wrong model, so every cohort, comp and treemap reader counts a C10 or a Chevelle
as a Corvette.

Measured on prod:
- Of 469 recorded 1967 sales whose model starts "corvette", 34 have a source page that names another car.
- Across 1962-72, the refused "Corvette" pages read Impala 38, Camaro 32, Chevelle 16, Corvair 12, El Camino 10,
  Bel Air 9, Nova 7, Biscayne 7, C10 8.
- Three of the six 1967 "Corvettes" recorded at $22,000 or less are other cars.

The fold now refuses such a sale and counts it (case ledger 13.13). The rows themselves still need repair.

## What the rows are (read-only diagnosis, primary-key reads)

Each example row is a hybrid. The row was created from its own lot, BaT or Mecum. That lot's sale, comments and bids
are correctly bound to it. Later, a Barrett-Jackson docket car's identity was laid on top: year/make/model,
`vin`, `discovery_url`, `auction_source` and photos.

| Row | Its own lot and sale | Laid on top |
|---|---|---|
| 50caf39a | BaT 1967 Chevrolet custom sport truck (chassis CE147J125019), sold $3,450 | model "Corvette 427/435 Convertible", VIN 194677S117588 (a Corvette VIN), B-J Scottsdale 2017 docket 200665, 8 B-J photos |
| 5ffec173 | BaT 1967 C10 pickup 116 (chassis CE147S177336), sold $10,999 | model "Corvette Custom Convertible", VIN 136177K153675 (a Chevelle VIN), B-J dockets 116242 and 132768, 14 photos |
| ec816aa9 | Mecum Des Moines 2012 S219 Chevelle, sold $16,000 | VIN 194377S116008 (a Corvette VIN), B-J docket 79129, auction_source barrett-jackson; normalized_model still "Corvette" |

None of the three has a merge proposal, a superseded row or `merged_into_vehicle_id`. So this is not an un-merge.

The likely writer is `extract-barrett-jackson`. It resolves an existing vehicle from forceVehicleId, the queue's
vehicle_id, discovery_url or VIN (`index.ts` ~894-922), then overwrites year/make/model/vin/sale_price on it
(~1003-1005). The exact February run is unknown.

This is the class `correct_vehicle_sale_provenance_batch` v2.3 was extended for on 2026-09-28 ("the row IS its lot's
car ... but year/make/model belong to something else"), now arriving from a second writer.

## Population

Selector run (read-only, `scripts/bat-corrections/select_hybrid_candidates.sh`, 2026-10-15 06:34Z):
- 1967 Corvette: 34 candidates, and all 34 are hybrids. Each has a Barrett-Jackson docket `discovery_url` over
  another platform's lot. These are the same 34 measured above.
- Electra, all years: 3 candidates. 2 are hybrids (B-J dockets over a BaT station wagon and a BaT Special). The third
  is an alias gap, not another car: an '89 Electra Estate Wagon whose page reads "buick estate".

So the conflicts are mostly this one writer's overlays, and a candidate is not a verdict.

1. The fleet count: `sum(conflicts)` over the fold's `sold` rows, by family. This is available after the first build.
   It counts sales whose own page names their model year but no phrase of their family. That's a lower bound,
   because pages without a descriptive slug are not tested.
2. Row selection for the batch: `scripts/bat-corrections/select_hybrid_candidates.sh <out> <family_id>[:<y0>:<y1>]`.
   Per family, it reads `mv_treemap_outcomes` through its cell index (brand, model, year).
   Join the family names, fetch only the matched rows' pages, and apply the same conflict rule.
   - Pages of 20 to 50 families per read, spaced, under the 10 s cap.
   - The output is a private list (vehicle id, current identity, the lot page, the conflicting phrase). It goes to
     ~/nuke-logs, never the repo.
3. Each candidate is then classified:
   - **hybrid:** a B-J `discovery_url` or VIN on a lot row of another platform;
   - **mislabel:** the model is wrong and no foreign identity is present (the 09-28 class);
   - **page ambiguity:** the page names neither car clearly. These are left alone.

## Repair, per hybrid row, in order (sanctioned writers only)

1. **Identity back to the row's own lot.** Use `correct_vehicle_sale_provenance_batch`. Each row is
   `{vehicle_id, source: {type: 'retained_capture' | 'lot_page', ref}, corrections: {year, make, model: {value, expected}}}`.
   The values are read from the row's own retained lot capture, never inferred from the slug alone. A stale `expected`
   is reported and not written. The old values are kept in `provenance_metadata.sale_provenance_corrections`.
2. **VIN.** Use `correct_vehicle_vin(id, expected, value | NULL, source, reason)`. The value is the lot's chassis
   number when the cited text carries it, otherwise NULL with the finding stated. The prior value goes to
   `superseded_rows`.
3. **The Barrett-Jackson car gets its own record** before its testimony leaves the row. Re-land the docket URL through
   the B-J extractor once its resolver no longer matches by the stale discovery_url or VIN. This is the stub rule in
   `.claude/rules/db-safety.md`: no history may be orphaned.
4. **Photos.** Move the B-J photos to that new record, or to the user pool, through `reattribute_observation('image', id, target)`.
5. **`discovery_url` and `auction_source`.** No sanctioned writer covers them. This needs a migration that adds both to
   `correct_vehicle_sale_provenance_batch` `c_allowed`, with the same guards and audit trail. It is the same shape as
   the v2.3 diff that added year/make/model/bat_auction_url.
6. **`normalized_model`.** The `auto_normalize_vehicle_model` trigger keeps the old value when the new model has no
   canonical match: ec816aa9 still reads "Corvette". The writer should set it, or the trigger should be fixed first.
   Otherwise `get_model_market_stats` keeps counting the row.
7. Batches of 20 rows or fewer, through `scripts/bat-corrections/apply_batches.sh`. That script probes load, splits a
   batch on timeout and checks for lock waiters.
8. Afterwards, the next `treemap_refresh_all` (09:10 UTC) and `refresh-family-year-prices` (09:40 UTC) pick the
   repair up. No reader change is needed.

## Prevention (first, or the rows refill)

The B-J resolver must not adopt a row whose own platform lot disagrees with the docket. That fix belongs to the intake
lane. Until it lands, any B-J re-extract can rewrite a repaired row: steps 2 and 5 clear the VIN and `discovery_url`
it matches on, which is why they come before step 3.

## Acceptance cases (before and after, the same reads)

- **50caf39a:** year/make/model from its BaT lot (a 1967 Chevrolet truck), VIN CE147J125019 or NULL, `discovery_url`
  not B-J. Its BaT sale stays. It leaves the 1967 Corvette fold row and joins its truck family.
- **5ffec173:** the same, as a C10. **ec816aa9:** `normalized_model` no longer Corvette.
- **Counterexample, untouched:** a "Corvette Stingray" whose page reads `1967-chevrolet-sting-ray-coupe` (the fold's
  alias rule keeps it), and a sale with no descriptive page.
- **Fleet:** fold `conflicts` falls by the repaired count. The repaired sales' prices appear in their own families'
  rows. A replayed earlier answer (the 1967 Corvette band before the repair) stays reproducible from the corrections log.

## Not in scope

Any merge or delete. Rows whose own lot page cannot be read stay as they are, refused by the fold and counted. The
owner's call is not needed: these are corrections by supersession through sanctioned writers, with sources.
