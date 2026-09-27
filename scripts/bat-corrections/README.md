# BaT sale-data corrections (2026-09-27)

The pass that puts BaT's own record of every lot into prod, through the sanctioned chokepoint
`correct_vehicle_sale_provenance_batch` (migration 20260927020100 + null-spec guard 20260927040000).
Nothing here writes a vehicles row directly; every correction carries the lot URL as its source and
the original value is kept in `vehicles.provenance_metadata.sale_provenance_corrections`.

Truth = the local BaT archive (`scripts/data/bat-archive.duckdb`, built by `npm run bat:archive`):
the listings-filter catalog (sold / date / high bid) + the lot page's own sale record (price paid,
buyer). `BATW` (default `scripts/data/bat-corrections/`) is the working directory; `work.duckdb`
holds `cat`, `lots_detail`, `truth` (built as in build_all.sh's comments), `live`, `pvrows`, `vlots`,
`vtruth`, `corrections`.

Order of operations (each step prints its counts):
1. `export_live_by_slugs.sh slugs.txt live.jsonl` — the live prod rows for a slug list (indexed lookups).
2. `build_all.sh live.jsonl batches/ 100` — before-picture, per-VEHICLE truth (a vehicles row can carry
   several lots: relistings link by URL, by VIN with year/make agreement, and by an exact sale match;
   sale fields follow the latest SOLD lot, auction state the latest lot), null-free batches.
3. `apply_batches.sh batches/ log.jsonl [max] [sleep_s] [max_waits]` — REST probe before each batch
   (stops when prod stays slow), lock-waiter check after each, results logged with stale/missing.
4. Re-run 1+2 → the after-picture and a re-diff that must come back 0.

`drive_reader.sh` feeds lot URLs to the deployed reader (extract-bat-core v4) for lots prod never
had; `gen_missing.sql` lists them. `gen_descriptions.sql` + `lookup_raw.sh` prepare the full BaT
write-ups as `raw_listing_description` receipts (the description card's own read path).
