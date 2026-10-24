# shadow v14 (experiment only; NOT registered, no shadow rows)
v13b's method refit on fresh odometer data. Run from a copy of `scripts/shadow/v12` (plus `meta_v11.npz`).
- Data: `LM_USABLE_DUMP` = `v12/dump_lm_usable.sql` + `v12/dump_lm_usable_nodate.sql` (comma-separated agent-tools ids;
  the second covers ~45.6k events with no `auction_end_date`, dated by `vehicles.sale_date` as the frozen v10-v12 dumps were).
  236,740 (vehicle, date) keys vs 228,889 frozen: +9,018 new (incl. ~6.2k lot-page odometers), 1,167 gone; suspect list 3,008 ids.
  Targets 50,156 (same rows); target odometer missing 2,245 (v12 1,845); comps with odometer 234,383 (v12 229,344). Peak RSS 1.34 GB.
- Selection (`sel_v14.py` -> `sel_v14.json`, forward rolling-origin, training rows only, same pre-registered rule as v13b):
  no-family all .2707 L2 .4335; s.35 .2698/.4264; s.5 .2717/.4283; s.7 .2702/.4260 -> s0.7 swap.
- `eval_v14.py` (`FAM_S=0.7 python3 eval_v14.py v14 sets_v11.npz fwdsets11_ ../v10/gbm_best.json 0`) -> `eval_v14.json`.
  v14 / v13b / v12 / live, coverage 1.0: random all .2591/.2577/.2674/.3357, L2 .4008/.3875/.3909/.3812;
  forward all .2694/.2683/.2778/.3451 (2024-07), .2895/.2865/.2910/.3644 (2025-01), .2456/.2434/.2553/.3533 (2025-07).
  v14 is slightly worse than v13b on every all-level split, so it was not registered. eval_v13b reproduces exactly on v12 data.
