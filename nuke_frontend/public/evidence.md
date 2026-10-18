<!-- evidence:start -->
Measured 2026-10-16 06:50 UTC from the live database by [`scripts/data/readme-stats.mjs`](../scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](../.github/workflows/update-stats.yml). Read-only. The unit is the lot, never a prediction row: a model's grade for a lot is its last prediction before the lot's close, against the lot's winning bid in `auction_events`. The close is the scheduled one where live frames hold it, else the final one, else the one the predictor believed (`predicted`). Models with no graded lot are not listed.

| Model | Sold lots graded, of lots ended | Median absolute error | Bias (mean signed error) | Hammer inside its stated band | Close: scheduled / final / predicted |
|---|---|---|---|---|---|
| 31 | 751 of 1,343 | 26.2% | +16.2% | 591 of 751 = 78.7% (80% band) | 282 / 469 / 0 |
| 30 | 489 of 980 | 30.7% | +16.2% | 365 of 489 = 74.6% (80% band) | 30 / 459 / 0 |
| 24 | 747 of 995 | 24.3% | −13.2% | 193 of 747 = 25.8% (50% band) | 0 / 244 / 503 |
| 13 | 10 of 13 | 12.0% | −15.4% | 2 of 10 = 20.0% (band width unknown) | 0 / 0 / 10 |

- **Lots predicted:** 2,290 distinct lots, in 46,094 of 60,670 prediction rows; 14,576 rows are not keyed to a lot yet (`hammer_predictions`, distinct `auction_event_id`).
- **Lots graded:** 1,482 distinct sold lots, and 1,997 model-lot grades in all, because a lot priced by more than one model is graded once for each (`v_prediction_lot_grades`, horizon `last`, with a hammer; the table is `prediction_accuracy`).
- **Stacks:** 66 registered, 65 at status measured; 6 at coverage 0.9 or above; mean coverage 0.19 (`v_stacks`). Order book SA v3: coverage 0.50, 9 of 18 needs present, 3 partial, 6 missing; status showable.
- **Thesis vein V012 v1** (cited by S03; `vein_ledger`, status active): 68,957 distinct buyers, the top 1% took 14% of lots, 39 won 50 or more (discovery run, as of 2026-09-30). Runs that can grade it: 0 of 1 (`vein_runs`).
- **Live-lot reader replay** (cited from PR #771, 2026-10-07; a replay, not a view, so not recomputed here): 2 minutes before the scheduled close the hammer sat inside its 80% band on 257 of 311 lots the live collector followed (closes 2026-10-05 to 06) = 82.6%. Not out-of-sample: the band's shape was chosen after seeing these lots.
<!-- evidence:end -->
