# Advisor valuation backtest (leave-one-out)

Measured 2026-10-21 against live `get_comps` peer medians for 12 recent BaT / Cars & Bids
hammers (sale excluded via `p_exclude_vehicle_id` / asset_id comps). Confidence on the
advisor surface stays capped at **0.6** until median APE and range coverage improve.

| Metric | Value |
|---|---|
| n attempted | 12 |
| n scored (≥3 comps) | 10 |
| median APE | **0.259** (25.9%) |
| mean APE | 0.270 |
| p25–p75 range coverage | 0.50 |
| widened (±15%) coverage | 0.60 |
| errors >40% APE | 3 |

Fit target from the product review: median APE &lt;15% with ~80% interval coverage.
This run does **not** clear that bar, so high confidence remains blocked.

Artifact: `/opt/cursor/artifacts/advisor_sale_backtest.json` (agent run).
