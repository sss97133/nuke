# v20 (shadow candidate, NOT registered)

v20 is the v18 pipeline (scripts/shadow/v18) rebuilt on refreshed inputs. It is then log-blended with v13b using v19's per-level weights (L0 .25, L1 .75, L2 .5). Those weights are frozen as-is, with no re-tuning against the gate.

## Input changes vs v18/v19
- **Mecum:** vehicle_events from runs `mecum_px_v1_20261024` (82,301) and `mecum_status754_v1_20261024` (568), all `unverified_sale`, gross only.
  - 7,292 rows the v18 dump had are now in `mecum_class_v1_20261024` (tractors, road art, memorabilia, or no fee rate that fits). They are excluded.
  - Mecum ve rows kept after dedupe: 85,073 -> 78,584.
- **Odometer:** the usable aelm view now has 16,458 lot-page readings (Mecum/B-J).
  - 15,902 of them were already in the v18 dump (07:22 PT). The other 556 arrived later and are added here.
  - The readings are all on Mecum/B-J auction_events rows. They share no vehicle_id+date and no lot id with the Mecum vehicle_events rows, so none can be mapped onto those.
  - Comps/targets with mileage: 239,843 -> 240,342.
- **BaT end-date corrections** (`ae_end_date_receipt_v1_20261024`, 23,774 rows, applied 03:58-04:00 PT): 22,743 are priced events in the comps dump, and all 22,743 already carry the corrected date. So v18/v19 already used them, and nothing changes here.

## Selection and gate
- **Selection:** forward rolling-origin on training rows (f5 != 0), using the pre-registered sel18 rule. It picked `nofam` (v18 had picked `s0.5_swap`).
- **Gate:** see eval_v20.json. v20 loses 2025-07, so it is not registered.
