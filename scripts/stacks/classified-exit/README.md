# Classified exit model: how a `listing_exit_models` row is fitted

The weights behind `classified_ask_board.merit` come from here. `./run.sh [cut-date]` does steps 1 to 4 in one pass and
prints each variant's held-out AUC and whether it clears the gate (AUC minus 2 standard errors above 0.55). Every step is replayable, so a refit can be compared
with the active version on the same outcomes.

1. `OUT=~/nuke-logs/classified-exit ./pull.sh listings` collects Facebook listings with their first/last seen and
   removal clocks, region and production family key (`mv_model_family_names`). The pages are bounded and read-only.
2. `./pull.sh fold` collects the recorded-sale rows of `mv_family_year_prices`.
3. `cd $OUT && duckdb study.duckdb < <repo>/scripts/stacks/classified-exit/study.sql` writes `study2.csv`. Each row is one listing with a known 7-day fate
   (the `v_classified_exit_outcomes` rule) and three things about it:
   - its position among recorded sales: the fold's own window;
   - its position among other Facebook asks of its family first seen in the 365 days before it, with the same window rule;
   - whether it was gone within 7 days.
4. `python3 <repo>/scripts/stacks/classified-exit/fit.py study2.csv <cut-date>` fits a logistic model on listings first seen before the cut and evaluates on
   the rest. It reports four variants (price only, sales, asks, both): held-out AUC with its standard error, single-feature
   AUCs and calibration by quintile.

The feature names match the board's (`log_sold_p50_over_ask`, `share_asked_at_or_below`, ...), so a variant's
`features` and `intercept` go into a `listing_exit_models` row as written. A new version goes in through a migration,
with its counts, dates and AUC in `trained_on` and `evaluated_on`.

Limits:
- A Facebook exit means the listing was missing from a later sweep of the same search. That is not a sale.
- The sale position reads today's fold, which holds sales recorded after a listing was first seen.
- Craigslist exits (404 on revisit) accrue from 2026-10-15; refit on them once a cohort has a known 7-day fate.
- The output files hold listing and vehicle ids. Keep them out of the repo.

## Result, 2026-10-15 (asks only; the sale half waits for the fold's first build)

- Population: 115,375 Facebook listings, 42,232 of them keyed to a family.
- 4,691 of the keyed listings have a known 7-day fate. Exits were recorded only in five weeks (2026-02-23, 03-02, 03-23,
  03-30, 06-08), the weeks the removal sweep ran. Outside those weeks only survivors have a known fate, so those weeks
  are left out. That leaves 1,743 listings with 339 exits (19.4%).
- 952 of the 1,743 are placed among 10+ earlier asks of their family. The split is train before 03-30 (457 listings,
  83 exits) and test from 03-30 (495 listings, 113 exits).
- Held-out AUC:
  - asks model: 0.501 +/- 0.031;
  - price alone: 0.541 +/- 0.028.
- Exit rate by ask position: bottom fifth 23.1%, second 21.7%, middle 17.6%, fourth 25.1%, top fifth 16.1%.

On this label, position among asks does not predict a fast exit, so no model is active.
