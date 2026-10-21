# Advisor valuation backtest (leave-one-out)

Measured 2026-10-21 against live `get_comps` peer medians for 12 recent BaT / Cars & Bids
hammers (sale excluded via asset_id comps). Confidence on the advisor surface stays capped at
**0.6** until median APE and range coverage clear the fit bar (&lt;15% APE, ~80% coverage).

## After variant-aware comps (deployed)

| Metric | Before | After |
|---|---|---|
| n scored (≥3 comps) | 10 / 12 | 10 / 12 |
| median APE | 0.259 | **0.200** |
| mean APE | 0.270 | 0.234 |
| p25–p75 range coverage | 0.50 | 0.40 |
| widened (±15%) coverage | 0.60 | **0.70** |
| errors >40% APE | 3 | 2 |
| 993 Turbo APE (6e618da0) | 0.676 | **0.000** |

Artifacts: `advisor_sale_backtest.json` (before), `advisor_sale_backtest_after.json` (after).
