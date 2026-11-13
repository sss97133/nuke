<!-- evidence:start -->
Measured 2026-11-13 04:30 UTC from the live database by [`scripts/data/readme-stats.mjs`](../scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](../.github/workflows/update-stats.yml). Read-only. The unit is the lot, never a prediction row: a model's grade for a lot is its last prediction before the lot's close, against the lot's winning bid in `auction_events`. The close is the scheduled one where live frames hold it, else the final one, else the one the predictor believed (`predicted`). Models with no graded lot are not listed.

| Model | Sold lots graded, of lots ended | Median absolute error | Bias (mean signed error) | Hammer inside its stated band | Close: scheduled / final / predicted |
|---|---|---|---|---|---|
| 33 | 1,677 of 2,358 | 15.7% | −2.1% | 1,285 of 1,677 = 76.6% (80% band) | 1,649 / 28 / 0 |
| 32 | 1,801 of 2,536 | 17.2% | +2.1% | 1,435 of 1,801 = 79.7% (80% band) | 1,755 / 46 / 0 |
| 31 | 4,202 of 6,084 | 26.3% | +21.4% | 3,274 of 4,202 = 77.9% (80% band) | 3,556 / 646 / 0 |
| 30 | 489 of 980 | 30.7% | +16.2% | 365 of 489 = 74.6% (80% band) | 30 / 459 / 0 |
| 24 | 783 of 1,041 | 24.4% | −13.2% | 204 of 783 = 26.1% (50% band) | 8 / 272 / 503 |
| 13 | 11 of 14 | 13.1% | −16.9% | 2 of 11 = 18.2% (band width unknown) | 0 / 0 / 11 |

- **Lots predicted:** 7,666 distinct lots, in 89,839 of 127,214 prediction rows; 37,375 rows are not keyed to a lot yet (`hammer_predictions`, distinct `auction_event_id`).
- **Lots graded:** 5,363 distinct sold lots, and 8,963 model-lot grades in all, because a lot priced by more than one model is graded once for each (`v_prediction_lot_grades`, horizon `last`, with a hammer; the table is `prediction_accuracy`).
- **Stacks:** 66 registered, 65 at status measured; 6 at coverage 0.9 or above; mean coverage 0.22 (`v_stacks`). Order book SA v3: coverage 0.50, 9 of 18 needs present, 3 partial, 6 missing; status showable.
- **Thesis vein V012 v1** (cited by S03; `vein_ledger`, status active): 68,957 distinct buyers, the top 1% took 14% of lots, 39 won 50 or more (discovery run, as of 2026-09-30). Runs that can grade it: 0 of 1 (`vein_runs`).
- **Live-lot reader replay** (cited from PR #771, 2026-10-07; a replay, not a view, so not recomputed here): 2 minutes before the scheduled close the hammer sat inside its 80% band on 257 of 311 lots the live collector followed (closes 2026-10-05 to 06) = 82.6%. Not out-of-sample: the band's shape was chosen after seeing these lots.
<!-- evidence:end -->
