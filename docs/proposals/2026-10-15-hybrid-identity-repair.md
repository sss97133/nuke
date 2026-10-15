# Hybrid vehicle rows: a lot's own sale under another car's identity (proposal, 2026-10-15)

Status (2026-10-15 14:25Z): prevention landed, so the first rows have been repaired.
- **Prevention:** extract-barrett-jackson refuses a different car and fills identity only (#1438); the Mecum page path
  was fixed in #1468.
- **Repaired:** the five acceptance rows. See "Executed" below.
- **Next:** the 30 Conceptcarz rows and the fleet count. The count comes from `mv_family_year_prices.conflicts` after
  the fold's first build (cron `refresh-family-year-prices`, 18:40 UTC).

Owner: lane skylar-08. Readers affected: skylar-83's mv_treemap_outcomes, mv_family_market and the brand map.

## Executed (2026-10-15, sanctioned writers only, verified logged out)

The finding that shapes the recipe: every Barrett-Jackson docket car checked already has its own vehicle row. Each
was created by B-J intake with the docket URL as `discovery_url`, carries the same photos and lot, and is public
with its own price. So no stub is needed. The hybrid's B-J testimony moves to that row, and the hybrid goes back to
its own lot.

| Hybrid | Own lot (identity restored) | Docket car's own row |
|---|---|---|
| 50caf39a | BaT Custom Sport Truck, $3,450, chassis CE147J125019 | e36c3a39 (Scottsdale 2017 #200665) |
| 5ffec173 | BaT C10 Pickup 3-Speed, $10,999, CE147S177336 | 55293150 (#116242), 1b0aa807 (#132768), ed4cd723 (#232190) |
| 14f36621 | BaT Chevelle SS 396, $58,000, 138177A178138 | 85c9e395 (Scottsdale 2019 #221963) |
| d3727d2e | BaT Buick Special, $106,000, VIN unknown (the lot's chassis field is description text) | ec2798fd (Palm Beach 2007 #49226) |
| ec816aa9 | Mecum lot 132893 Chevelle, $16,000, VIN unknown | 0dbb2abc (Las Vegas 2009 #79129) |

Per row, in order:
1. `correct_vehicle_sale_provenance_batch`: model, `discovery_url` (back to the own lot), `auction_source`,
   `normalized_model` and `normalized_series`. The source is the retained lot capture.
2. `correct_vehicle_vin`: the own lot's chassis number, or NULL with the finding stated.
3. `correct_vehicle_vin` with `fill_empty`: the docket car's row gets the VIN its own lot page names. All five
   docket rows had none; the VIN had been laid on the hybrid.
4. `correct_auction_event_link` (new, #1546): the hybrid's B-J auctions go to the docket rows. All 8 were
   duplicates of a lot the docket row already held, so they were retired with their full rows in `superseded_rows`.
5. `reattribute_observation` (onto-existing-copy branch, #1553): each B-J photo on the hybrid is superseded onto the
   docket row's identical copy. Nothing is duplicated.

### Fleet pass: B-J auctions on the wrong car (2026-10-15 14:30Z on)

All 78,328 Barrett-Jackson auction_events were read by heap block range: 38,652 lots on 47,569 vehicle ids. 5,496
existing vehicles hold 2+ lots, 23,500 auctions in all. Each auction was compared with its vehicle and with its lot's
own docket row (`vehicles.discovery_url`):

| Class | Auctions | Action |
|---|---|---|
| The vehicle's own lot | 9,202 | kept |
| Same year and a shared model word (a resale, or the same car under two records) | 6,881 | held for merge review |
| Another car (different year or model), whose docket row exists | 5,987 | moved by `correct_auction_event_link`; 5,973 were duplicates of a lot the docket row already held |
| Another car with no docket row | 1,430 | waits for that car's row |

Held out of the move:
- 12 rows whose docket row is deleted;
- 3 priced rows whose price disagrees with the docket row's copy ($43,200 vs $20,900, $2,505 vs $71,500, $250,000 vs
  $102,600).

One row already retired showed the same disagreement ($3,000 vs a kept $4,950). Its full row is in superseded_rows.

Profiling found that `auction_comments` and `auction_event_links` cascade on delete. Since #1561 the writer holds any
auction with comments, links or predictions. None of the planned rows had any (read 14:44Z).

**Orphans.** 14,246 B-J auctions point at 7,503 vehicle ids that no longer exist. The FK is NOT VALID. In a sample,
the auctions were created 2026-02-01..27 and their vehicle_events are orphaned too. There are no merge proposals, so
the vehicles were hard-deleted.
- 3,603 go to their lot's docket row (almost all duplicates). 62 priced ones are held because the docket copy is
  unpriced or its price disagrees.
- 5,128 lots have no vehicle; 4,753 of them carry a price. lane-online-auctions (skylar-f7) is re-landing them and
  sends the lot-to-vehicle map for the relink. The list is at ~/nuke-logs/bj-orphan-lots-no-vehicle-20261015.json.

**BaT-lot hybrids, fleet (15:15–16:00Z).** 38,179 live vehicles hold B-J auctions. Each one with a BaT listing was
compared with its own lot in the local BaT archive (`lots`: title, year, make, model, chassis).
- 473 carry a B-J discovery_url and an identity that differs from their own lot. 445 differ clearly (a different year,
  or a model with no word or prefix in common). 271 of those carry the lot's exact BaT top bid as their sale price,
  166 have no price, and 8 have a price matching neither (held).
- The other 437 were repaired with the recipe above:
  - model, year and make go back to the lot. The model is the full lot title after the make: the archive model
    field keeps only three words.
  - discovery_url goes back to the BaT URL. It is NULL for 9 rows whose BaT URL another row already holds (duplicate
    records, on the merge list).
  - auction_source becomes bat.
  - 121 normalized models left from the docket car (e.g. "Thunderbird" on an E-350) are retracted to unknown.
  - 352 VINs become the lot's chassis number. 72 were held because another row holds that chassis (duplicates);
    7 were retracted to unknown.
  - At the 347 docket rows: 2,580 B-J photos were superseded onto identical copies and 416 B-J auctions retired as
    duplicates.
- Make changes were dropped on rows with a short VIN, because (vin, make) is unique and the target pair already
  existed on a duplicate record.

**Mecum-lot hybrids (skylar-b7's list, 241 rows).** 226 already carry their Mecum lot's identity; only the link and
venue had been overlaid.
- 240 rows: auction_source becomes mecum, and discovery_url goes to the Mecum lot (175) or NULL (53, duplicates).
- 56 B-J vehicle_events moved to docket rows that lacked them (correct_vehicle_event_link).
- 454 B-J auctions retired as duplicates; 2,294 photos superseded onto copies.
- 15 rows whose identity also differs from their Mecum slug wait for a retained capture: identity is never changed
  from a slug alone.

B-J lots with no vehicle row are re-landed by lane-online-auctions and relinked from its map, which grows as lots
land. Lists:
- ~/nuke-logs/bj-orphan-lots-no-vehicle-20261015.json (5,128 lots, 4,753 priced);
- ~/nuke-logs/bj-misattached-lots-no-vehicle-20261015.json (1,261);
- ~/nuke-logs/bj-hybrid-lots-no-vehicle-20261015.json (169).

The merge-review list of same-car pairs is ~/nuke-logs/bj-same-car-merge-review-20261015.json (5,737 pairs).

**Conceptcarz-origin rows are the main collector.** 2,695 of the 5,496 multi-lot vehicles have a listing_url of the
form `conceptcarz://event/<id>/<title>`; 1,522 are public and 2,535 carry a B-J discovery_url. Their `sale_result`
observation carries the B-J docket's price and the import date. Example: 0e88264f, titled "1967 Chevrolet Camaro
SS", shows $71,500 on 2026-02-26, which is the Scottsdale 2013 Corvette docket's sale. So these look like duplicate
records of B-J lots, not separate cars. Their identity is a merge-review question. This pass does not rewrite them;
it only moves the auctions of other cars off them.

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

Where the 36 hybrids' own records come from:

| Own record | Rows | Example |
|---|---|---|
| Conceptcarz auction-results records (`listing_url` of the form `conceptcarz://event/<id>/<title>`) | 30 | `conceptcarz://event/1205/1967 Chevrolet Camaro SS`, now labeled "Corvette 2 Door Coupe" with a B-J Scottsdale 2013 docket |
| BaT lots | 4 | The local archive (`scripts/data/bat-archive.duckdb`, `lots`) holds each lot's own title, year, make, model and VIN |
| RM Sotheby's lot | 1 | |
| No own link | 1 | |

For a BaT lot, the archive is the citation for its identity. Its VIN is not trusted blindly: one archive VIN is free
text, so the check digit decides between the archive VIN and NULL.

For a Conceptcarz row, the own record is that result's title. The B-J writer also overwrites `sale_price`. So
whether the row's price is the Conceptcarz car's result or the docket car's must be settled per row:
- compare the Conceptcarz event's result with the docket's;
- only then correct the identity and, if needed, the price.

This makes the Conceptcarz rows the larger and harder half of the batch.

1. **The fleet count, from the fold's first build (2026-10-15 18:45Z).** It counts sales whose own page names their
   model year but no phrase of their family. It is a lower bound, because pages without a descriptive slug are not
   tested.
   - Exact on single-year rows (`year_from = year_to`, so no sale is counted twice): 6,317 refused beside 206,146
     kept, 3.0%, on 1,463 of 4,281 rows. Every sold row together reports 25,917, but windows overlap.
   - Largest by family: BMW M3 902 (vs 2,667 kept), Corvette 243 (vs 13,498), Firebird 208, BMW Z3 187, Mustang 172,
     Jaguar XK 138, BMW M5 133, C10 128, Bel Air 112, Sierra and Silverado 107 each.
   - The BMW counts are a fold bug, not hybrids: the rule kept only aliases of 3+ characters, so "m3", "z3", "m5"
     and "x5" named nothing. Fixed in `mv_family_year_prices_v2` (20261017053000), which skylar-b7's venue swap
     installs.
   - The fold read this morning's outcomes, so today's repairs (above) show at the next treemap refresh.
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

### A second writer: extract-mecum's page path (intake-flow, 2026-10-15 07:30Z)

The Mecum page path also overwrote year/make/model on every vehicle it updated. Fixed in #1468: identity becomes
fill-only, and a disagreeing lot goes to the revision queue as a relink.

A bounded read covers vehicles linked to a page-path event since 2026-10-14:
- 879 vehicles in all;
- 71 that also carry another platform's events;
- 7 of those 71 disagree with the other platform's slug or title on year or make.

Three of the 7 look real:
- b68e146c, a "1956 Nimbus 750" whose BaT event is a 1969 Ferrari 365 GT;
- 503d8097, a "1955 Chevrolet 3100" whose BaT event is a 1959 Apache pickup;
- ec13809c, a 1967 Lancia Flavia against a 1966 BaT slug, which may be a model-year difference.

The other four are naming differences (Hi-Boy/highboy, Shelby/Ford, Hummer H1/AM General).

The lists are private: `~/nuke-logs/mecum-hybrid-candidates-20261015.json` and
`~/nuke-logs/mecum-hybrid-disagreeing-ids-20261015.json`. This count is a bound, not the population, because an
overwrite on a vehicle with no second platform cannot be told apart from the vehicle's own values. The repair steps
below apply unchanged. For these rows, "its own lot" is the platform whose event predates the Mecum page write.

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
