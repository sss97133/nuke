# Stack dominoes: from a landed lot to the stacks it feeds (2026-10-15)

Pre-mint memo for migration `20261015034500_stack_dominoes.sql`. Owner direction, 2026-10-14: recognize the stacks of the
data model and the inference data that takes shape as data grows (case ledger 13.1 point 4: sources are pluggable).

## Search before mint
`check-capability-before-mint.mjs` was clear for `stack_input_support`, `stack_cohort_depth`, `snapshot_stack_dominoes`,
`v_stack_dominoes`, `v_source_dominoes` and `v_hypothesis_support` (2026-10-15). Extended, not replaced: `v_stacks`,
`stack_coverage_snapshots` (the daily job now also calls `snapshot_stack_coverage`, which had no schedule),
`source_target_coverage`, `vein_ledger` (the home of pre-registered hypotheses; unchanged).

## What it adds
- `stack_input_support`: per reading, per stack input table and source, rows and clocks. Exact for `vehicle_events` and
  `auction_events`; planner estimates for `bat_bids` and `auction_comments`. Other input tables are not measured per source
  and the view says so (`any_lot_source_unmeasured`).
- `stack_cohort_depth`: per reading, how many (year, make, model) cohorts have at least N sold priced lots on both of two
  sources. The volume a cross-venue test needs. Cohorts are string-equal on lower-cased make and model, so true cohorts are
  undercounted. A source pair absent from a reading was not read (unknown); a row with 0 is a measured zero.
- `v_stack_dominoes` (stack x need), `v_source_dominoes` (source x need), `v_hypothesis_support` (hypothesis x requirement).
- Cron `snapshot-stack-dominoes`, daily 04:25 UTC, `statement_timeout = 300s` as in `refresh-source-target-landed`.

## Reading the domino map
Verdicts are structural (an object exists with rows, a column is filled), taken from the latest `stack_coverage_snapshots`
reading with its date. Landing more lots can change a verdict only for table, column and intake needs that a lot source feeds
and that are not yet present (`verdict_can_change_with_lots`). Abstract layers (place entity, text fold, option keys) do not
move with lots; they wait for a fold.

## Hypotheses (vein_ledger V014 to V019, status active, registered before any cohort was counted)
Thresholds are the registrant's choices, not derived. `v_hypothesis_support` shows current against needed with the
measurement date; `hypothesis_testable` is true, false or NULL (unknown) when a requirement has no reading.

| Id | Hypothesis | Testable when |
|---|---|---|
| V014 | Mecum median hammer differs from BaT for the same year, make and model | 30 cohorts with 10 sold priced lots on each |
| V015 | Barrett-Jackson against BaT, same form | same |
| V016 | Bonhams against BaT, same form | same |
| V017 | Stage auctions agree with each other more than with BaT (|d| Mecum vs Barrett-Jackson smaller) | the three pairs above plus Mecum x Barrett-Jackson, 30 cohorts each |
| V018 | A month-of-close effect exists within BaT model cohorts | 20 cohorts with 60 sold priced BaT lots |
| V019 | Defects flagged by commenters and not stated by the seller predict a lower residual | stack S05 coverage 1.0 (the text fold exists) |

V014 to V016 are raw spreads: mileage and condition are not held, so a pass says venues price differently, not why. The
residual form belongs to the sale-residual fold (S01) and is the next version once that fold covers both venues.
