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

Long runs (2026-09-28): `run_streams.sh <run-dir> [streams] [pace_s]` supervises `drive_reader.sh` over
`<run-dir>/slice_<i>.txt` under launchd + `caffeinate -i` (RunAtLoad, restart on failure), pauses the streams
while the REST p50 is over 1 s, and writes `<run-dir>/DONE` when every slice has had a clean pass. Run dirs
live outside the repo and outside /tmp (e.g. `~/nuke-logs/`): on 2026-09-28 the streams died with the session
that started them, and the reboot then wiped the scratchpad holding their logs.
`fix_taken_at.sh` (BaT link photos stamped with the import time → NULL via `correct_image_provenance`, walked
by created_at day) and `drive_valuation.sh` (force-recompute estimates for a listed set of vehicles, gated
on REST and host load1) were recovered from the 2026-09-27 session transcript; their working dir is `$BATW`
(default `~/nuke-logs/bat-corrections`).

End events written for running lots (2026-10-15): `supersede-live-end-events.mjs` retires the `auction_ended`
timeline rows extract-bat-core wrote before 4.5.0 while a lot was still running (dated its scheduled end, priced at
the bid of that read) through `supersede_timeline_events` (migration 20261016203000), each kept whole in
`superseded_rows`. Dry run by default (`--inline` plans with the migration's own query before it is deployed);
`--apply` only after extract-bat-core 4.5.0 is deployed. Logs: `~/nuke-logs/bat-ended-20261015/`.

BaT results not on the vehicle (2026-10-16): `project-bat-results.mjs` finds BaT lots whose `auction_events` result
(sold / reserve not met) is not on the vehicles row that is that listing. Two cases: `greatest(high_bid, sale_price)`
below the final, or a sold lot without its sale. It projects each through `project_bat_result_to_vehicle` (migrations
20261018041000..043000), and so through `correct_vehicle_sale_provenance_batch`. Only a final with a second witness
is projected: a page-read receipt, a cited correction or the stream's native sale record. Modes: dry run by default,
`--profile` (one batch in a rolled-back transaction), `--apply`. Logs: `~/nuke-logs/bat-close-projection-20261016/`.
