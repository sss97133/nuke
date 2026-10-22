## 2026-10-22 round 4: cumulative comp adjustments (bt4/)
353,223 events, hammer basis, time-ordered; comps = 15 most recent earlier sales, same make, spelling-key model, ±2 years, other vehicle. Scored on 219,094 events with ≥4 comps.

| Step (cumulative) | Median APE | Within 20% | Fitted parameters (grid over all data) |
|---|---|---|---|
| 0 baseline (median of comps) | 26.8% | 0.394 | - |
| 1 + make monthly price index | 26.2% | 0.400 | cohort-demeaned log median, ≥5 sales/month, 6-month trailing window, full pass-through (β=1); per-model-family index was worse (26.3–27.1%) and rejected |
| 2 + sales channel | 26.1% | 0.401 | log effect per platform (bat +.02, C&B −.05, mecum +.04, B-J +.07, bonhams +.08, broad arrow +.13, gooding +.23, RM +.26, eBay −.18); shrinkage k irrelevant |
| 3 + mileage | 23.8% | 0.436 | decile curve of log((subj+1000)/(comps median+1000)), +0.30 (much lower miles) to −0.19 (much higher); odometer-at-sale with fallback to vehicles.mileage (odo-only: 24.3%/0.428) |
| 4 + recency weighting | 23.7% | 0.438 | weighted median, half-life 1460 d (180 d: 24.6%; 365: 23.9%; 730: 23.7%; 2920: 23.7%) |
| 5 + own prior sale (time+channel adj.) | 23.1% | 0.447 | blend weight 0.9 (gap <3y), 0.7 (≥3y); 12,764 events have a prior sale: their within-20% goes from ~0.46 to ~0.61 |
| 6 confidence recalibrated | (same estimates) | Brier 0.2390 → 0.2352 | new P(within20) table by comps/own-sale × adjusted spread (res/conf.json) |

Caveats: platform and mileage effects are fitted in-sample (≤23 parameters on 219k events). Index cohort means use all years (composition only). Gap buckets (1y/3y) and spread buckets are pre-set edges. Prior sales with identical price within 180 days are treated as duplicates and skipped.
Artifacts: bt4/ev.db (sqlite), bt.py engine, res/summary.txt, res/grid_*.txt, res/fit.json, res/conf.json, res/make_index.csv. Revert: advisor-price-index-revert.sql.
