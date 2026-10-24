# v18: Mecum gross comps and targets (NOT registered)

v13b's method refit with 85,073 Mecum sold events (run `mecum_px_v1_20261024`, gross incl. premium, unverified)
added as comps and targets. Market comps are on the gross basis only (no gross/net mixing). Excluded: untrusted
prices/marks, wrong-vehicle events (v17 drop list), duplicates (make+canon model+year+rounded gross, ±1 day),
suspect-mileage readings. Comps are strictly before the sale date and from other vehicles.

Pipeline: load18 -> targets18 -> feat18/feat4_18 -> sets18 -> attrs18 -> sel18 -> eval18 (each run under guard.sh, peak RSS ≤1.1 GB).
Selection (training rows only, forward rolling-origin, the v13b pre-set rule): pick `s0.5_swap` (sel18.json).

## Gate vs v13b (MdAPE, old test set, n matched 100%)
| split | v18 gross | v13b→gross | v18 hammer-eq | v13b registered |
|---|---|---|---|---|
| random | .2565 | .2579 | .2570 | .2577 |
| fwd 2024-07 | .2692 | .2669 | .2698 | .2683 |
| fwd 2025-01 | .2828 | .2844 | .2836 | .2865 |
| fwd 2025-07 | .2448 | .2436 | .2436 | .2434 |

Fails 2 of 4 forward splits → not registered, no shadow rows written. Full breakdown (level, platform, coverage) in eval_v18.json.
