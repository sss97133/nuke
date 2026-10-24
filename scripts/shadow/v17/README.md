# shadow v17 (experiment only; NOT registered, no shadow rows, no live estimates)
v13b's method (`eval_v13b.py`, learned families s0.35 c0.3 gap0.7, L2 family-median base) refit on training data
cleaned of aggregator events attached to the wrong vehicle (run `agg_attach_audit_v1_20261024`, #2647).
Run from a copy of `scripts/shadow/v12` + `meta_v11.npz`: `bash run17.sh` (A: unfiltered reproduction, B: v17).

## Where wrong-vehicle aggregator rows could enter
- Comps/targets come from `shadow_sale_prices` = `auction_events` + a collecting_cars-only `vehicle_events` branch.
  `auction_events` has 0 conceptcarz rows; 0 flagged events are collecting_cars. So no aggregator event is a comp or target.
- Indirect: a comp whose (vehicle, sale date) equals a flagged event's (11,636 flagged, 10,838 dated;
  `dump_flagged_v17.sql` -> `drop_vid_date.txt`): **44 comps** (40 bat, 4 barrett-jackson), each priced identically
  to the conceptcarz copy. 12 auction_end_date backfills landed on a flagged event's date. v17 drops all 44 (`V17_DROP`).
- 0 test targets sit on a flagged vehicle. The comp Z/N sets (`sets_v11.npz`, `fwdsets11_*`) are built from target rows
  and are byte-identical A vs B; the 44 comps reach the model only through `fam.py` (learned families from comps).

## Result (MdAPE all-level, coverage 1.0; `eval_v17.json`, `eval_v13brep.json`)
| split | v17 | v13b (rescored, cleaned test set) |
|---|---|---|
| random | .2567 | .2577 |
| fwd 2024-07-01 | .2677 | .2683 |
| fwd 2025-01-01 | .2842 | .2865 |
| fwd 2025-07-01 | .2462 | .2434 |
Pre-set rule: register only if better than v13b on all four. v17 loses 2025-07-01 -> NOT registered.
v13b on the cleaned test set (`rescore_clean.py`, drops targets on flagged vehicles: 0 dropped) = its registered
numbers exactly; the unfiltered rerun (A) reproduces all 16 v13b cells exactly.

## 2026-10-24 correction: stale comp-set cache
The filtered run B reused run A's `pcache.npz`: `exp_v11.py` loaded the cache whenever it existed, and `mkcache.py`
re-saved what it had loaded. So the 44-comp wrong-vehicle drop reached `feat_v11.pkl` but never the comp sets, and
`eval_v17.json` actually scored the unfiltered comp sets. Fix (in `scripts/shadow/v12/exp_v11.py` and `mkcache.py`):
the cache stores the sha256 of `feat_v11.pkl` + `feat4_v11.pkl`. A cache with a different hash, or no hash, is
rebuilt; `mkcache.py` always rebuilds. Re-scored with `rerun17.sh` (peak RSS 1.29 GB) → `eval_v17fix.json`:

| split | v17 (fixed) | stale v17 | v13b |
|---|---|---|---|
| random | .2591 | .2567 | .2577 |
| fwd 2024-07 | .2695 | .2677 | .2683 |
| fwd 2025-01 | .2851 | .2842 | .2865 |
| fwd 2025-07 | .2434 | .2462 | .2434 |

Corrected v17 beats v13b on 1 of 4 splits (and ties 2025-07), so it is still not registered.
