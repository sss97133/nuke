# Nuke valuation threshold backtest (2026-10-22)

**Data:** every sold `vehicle_events` row with a price and a date, excluding duplicate and ask rows: 353,316 events. Comps are time-ordered, so each sale is valued only from earlier sales. A comp is a different vehicle with the same make, the same model string, and a model year within ±2. The 15 most recent earlier comps are used. 90,364 events had no earlier comp. 995 events with no make were skipped. The run was done in 13 SQL chunks by make. Error is measured as APE, the absolute percentage error of the comp median against the actual price.

## Error vs comp count
| comps | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 15 |
|---|---|---|---|---|---|---|---|---|---|
| median APE | 34.5% | 31.0% | 29.2% | 28.1% | 27.9% | 27.4% | 26.9% | 26.7% | 26.4% |

Going from 3 to 4 comps improves median error by 1.1 points. After 4, each extra comp improves it by less than 0.5 points. **Fitted minimum: 4 comps** (was 3). IQR coverage is the share of actual prices that fall inside the comps' 25th–75th percentile range; it rises from 0.28 at 3 comps to 0.435 at 15.

## Error vs estimate age (matched set, n=172,636)
| age | 0d | 90d | 180d | 365d | 730d |
|---|---|---|---|---|---|
| median APE | 27.6% | 28.3% | 28.7% | 30.1% | 32.2% |
| within 20% | .378 | .369 | .362 | .347 | .321 |

180 days is the first age at least 1 point worse than a fresh estimate. **180 days kept**, now supported by the data.

## Stale vs fresh disagreement
| disagreement | 0–10% | 10–15% | ~25% | 60%+ |
|---|---|---|---|---|
| stale-estimate APE vs fresh comps APE | 26.5 vs 26.4 | 28.2 vs 26.3 | 33.6 vs 30.0 | 58.5 vs 38.9 |

Fresh comps beat the stale estimate once they disagree by more than 10%. **Fitted threshold: 10%** (was 25%), and comps now replace the stored estimate when they disagree.

## Calibration: P(actual within 20% of estimate)
The old confidence cap of 0.6 was overconfident: the actual hit rate averages about 0.39. Stored estimates that disagree with comps by 25% or more hit only about 0.30 of the time; the old cap for them was 0.35. Confidence is now read from this lookup table:

| comps \ IQR/median | <10% | 10–20% | 20–30% | 30–50% | ≥50% |
|---|---|---|---|---|---|
| 3–4 | .527 | .432 | .381 | .336 | .276 |
| 5–9 | .578 | .499 | .423 | .364 | .294 |
| 10–15 | .848 | .635 | .503 | .403 | .310 |

Other caps: stale estimates 0.36, estimates that disagree with comps 0.30, the 3x recent-sale guard 0.25, and same-asset sale 0.55.

**Caveats:** stored prices mix hammer and premium-inclusive bases; Broad Arrow and part of Mecum, Barrett-Jackson, Gooding and RM include the premium (see PR #2468). The cohort key is an exact lower-cased model string.
