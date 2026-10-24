# B-J results staging + houselot v9 (run agg_houselot_v9_20261024)

- `fetch_bj_results.py` (run bj_results_v1_20261024): reads barrett-jackson.com's public past-results API
  (`/api/previous-docket-results?slug=<event>&type=vehicles&size=100`), 1 request / 2.5 s, 81 events 1999-2020 → 44,732 lots.
- `ddl.sql` + batch loads → `public.bj_results_stage_v1_20261024` (staging only; no vehicles). Each row cites lot number, lot URL, API URL, price.
  Fee basis: `gross_incl_premium` (B-J results prices include the 10% buyer's premium; 84% of sold prices are a round $100 hammer ×1.10); hammer derived = price/1.10.
- `annot.sql`: 27,968 lots already exist as events; 16,642 sold lots are new.
- `cand9.sql`: the 2,036 cand8 events with no lot → 151 unique staged-lot matches.
- `apply_v9.sql`: v7 gates + engine-word rule + lot VIN = exactly one live pre-existing vehicle (confirmed identity) + held when the cc price equals
  a different existing sale of that vehicle. Inserts one B-J house event per lot on that vehicle and attaches the cc event (same_lot). 9 attached, 5 marks.
- `revert_v9.sql`: no deletes; restores cc events, retires marks, retracts inserted house events in place (event_status cancelled + suspect).
- `revert_stage.sql`: renames staging/candidate tables to retired_*.
