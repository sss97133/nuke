# shadow v12 (odometer coverage from lot pages + memory fix)

Scripts not listed here are unchanged from `scripts/shadow/v11` (run from a copy of that dir).

- Memory: `mkcache.py` flattens the v11 feature pickles once into `pcache.npz` (float32, int32 ids); `exp_v11.py`/`run4.py` load it when present. Peak RSS per step 0.39-1.34 GB (v11 fwd_sets 1.66-1.72 GB); fwd sets byte-identical to v11's on the same inputs.
- Odometer reads (`odo/`): one polite reader (`fetch.py`, ~1 req/s, B-J every 4th slot because another B-J reader is already running), snippets only. `parse.py` rules: Mecum "Odometer reads* N miles" field, text rules for B-J, TMU, page JSON fallback (0 skipped). "since restoration" readings go in as TMU in the loader. `mkins.py` writes idempotent 1,000-row batches: one `listing_page_snapshots` row per page (snippets only) and an `auction_event_listing_mileage` row citing it (`source_snapshot_id`). Run id `...a5025`.
- Collecting Cars: `odo/ccfetch.py` reads schema.org `mileageFromOdometer` and writes to the new `vehicle_event_listing_mileage` table. Run id `...a5026`, 340 rows.
- Check: `verify50_v12.json`. An independent re-read of 50 random parsed pages (35 Mecum, 15 B-J) found the stored value on all 50 pages.
- Selection: `sel_v11.json` is the forward rolling-origin selection on training rows only. `eval_v12.json` uses the same protocol as v11.
