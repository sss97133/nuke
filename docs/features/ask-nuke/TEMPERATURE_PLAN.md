# Temperature plan: a precomputed, calibrated temperature for every live lot

Status: plan only (2026-09-30). No migration ships with it. It follows the owner notes in `THEORY.md`
("the auction temperature", 2026-09-29, and "hot is a calibrated spectrum, with its why", 2026-09-30) and builds on
`live_lot_temperature(p_vehicle_id)` (PR #482), which counts one lot on request.

**Goal.** Every live BaT lot carries a temperature that the board and the homepage can rank by without a per-lot RPC.
The temperature is a percentile inside the lot's own table (same model, at the same hours to close). It is
recomputed on the live pull's cadence, and every number it prints has a basis: the measure, the comparison set and
that set's size.

## 1. What exists today (measured 2026-09-30, about 15:15Z)

- **The live pull.** It is the cron job `bat-live-pull` (`* * * * *`, `bat_live_pull_run(3)`); its health check is
  `bat-live-pull-check` (every 15 min). Its state is `live_auction_sources.scraping_config->'live_pull'` on the
  `bat` row:
  - reader `extract-bat-core`;
  - 3 lots a run;
  - cadence: 60 min under 12 h, 360 min from 12 to 48 h, and 1,440 min beyond;
  - it pauses when REST p50 goes above 2,000 ms;
  - last run 15:14Z: 3 read, 0 failed, 13 comment rows landed, REST p50 9 ms.

  A lot's own read time is the upsert of its `auction_events` row.
- **The live board tag** (`heatOf`, `MarketPulse.tsx`). This is price only: the bid over (band p50 × the tier's
  bid-curve share at this many hours). It reads hot at 1.25× and cold at 0.8×. Phase 1 (this PR) prints its why:
  "HOT · bid 1.6× typical at 2 h out · 91 comps".
- **`live_lot_temperature`.** This counts PRICE, BIDS and BIDDERS against up to 300 same-make-and-model vehicles at
  the same hours to close. It runs in 0.33 s warm and 4.0 s cold as anon, one lot at a time, on the vehicle page.
- **`auction_comments`.**
  - About 18.4M rows (`v_schema_atlas.est_rows` 18,427,860), 10.4 GB.
  - Indexes lead with `vehicle_id` (`auction_comments_vehicle_content_hash_key`), `auction_event_id`,
    `author_username`, `author_bat_user_id` and `author_external_identity_id`.
  - Nothing indexes `posted_at` or `hours_until_close`, except a partial index for unscored comments.
  - `bid_increment` is empty on live-pull rows (0 of 67 bids on 8 lots checked).
  - `author_bat_user_id` and `author_external_identity_id` are empty on live-pull rows (0 of 237 checked);
    `author_username` is present.
- **`hammer_predictions`** (49,496 rows, read about 1.19M times). This is the per-lot, per-moment prediction organ.
  - Columns: `vehicle_id`, `current_bid`, `bid_count`, `unique_bidders`, `hours_remaining`, `bid_velocity`,
    `comp_median`, `comp_count`, `model_version`, `predicted_*`, `confidence_score`, `buy_recommendation`,
    `actual_hammer`, `prediction_error_*`, `scored_at`, `predicted_at` and `notes`.
  - Model 31 is the live band (1,362 lots, last written 14:40Z). Models 13 and 24 are older live predictors, with
    607 rows scored against `actual_hammer`.
- **`mv_bidder_profiles`** (337,348 rows, idle, keyed by username). This holds total bids, auctions entered, wins,
  average and maximum bid, and first and last seen. It is stale, but it has the shape the "weight" input needs.

## 2. Inputs, per live lot, as of its last read (`h` = hours from that read to the close)

| Input | Measure | Source |
|---|---|---|
| **Price percentile** | the high bid against the high bid each comparable sold lot had at `h` | `auction_comments` bid rows (as `live_lot_temperature`) |
| **Bids** | bid count so far, against comparables at `h` | same |
| **Distinct bidders** | distinct bidders so far, against comparables at `h` | same (counted, never returned) |
| **Comment pace** | non-bid comments in the last 6 h and in total, each against comparables over the same window before their close | `auction_comments` comment rows |
| **Bid steps** | the median step and the largest step in the last 6 h, against the lot's own median step (the Phase 1 weight) and against comparables | bid rows, consecutive differences |
| **Bidder weight** | for each distinct bidder: prior BaT auctions entered, prior wins and prior maximum bid, all counted only from lots that closed before this one opened. Then the lot's share of "heavy" bidders (top quartile of the department by prior maximum bid) against comparables | `auction_comments` history by `author_username` (indexed), or a refreshed `mv_bidder_profiles` |
| **Commenter weight** | the same, for commenters: prior comments and prior lots commented on, plus `bat_author_likes` where present | same |

Rules:
- Usernames are grouped server-side only. No output carries a username, and no output identifies one person.
- A bidder's or commenter's weight uses only lots that closed before the scored lot opened, so the backtest has no
  leakage.

## 3. Calibration: one spectrum, drillable

- **Comparable set.** Take finished BaT lots of the same make and model, one per listing slug, each counted from its
  own rows posted `h` or more hours before its close (as in #482).
  - Below 8 comparables, widen to the same make.
  - Below 8 at make, widen to the department (the board's make grouping for now; the department taxonomy is the
    Explore lane's).
  - The level used (`model`, `make` or `department`) and `n` are stored and printed with the why.
- **Score per input.** Use the mid-rank percentile inside the comparable set: `(below + same/2) / n`, as in
  `LiveLotStripsView`.
- **Temperature.** This is the mean of the input percentiles present, each input needing 8 or more comparables. It is
  then re-ranked as a percentile against every live lot's temperature at the same hour. The number means the same on
  every table: a $20k Mustang with a battle in its comments and a quiet $175k Porsche each score inside their own
  table, so dollar size never sets the heat.
  - Weights between inputs start equal.
  - The backtest (§6) may move them only if the change beats equal weights out of sample.
- **Labels** are cut on the spectrum: HOT at the 80th percentile or above, COLD at the 20th or below. Each label
  prints its top two contributing inputs as counts against typical, for example "33 bids vs 23 typical at 5 h out ·
  14 bidders vs 11 · bid 23rd percentile · 305 comps (model)".
- **Drill-down.** The homepage ranks all live lots by temperature. Filtering to a department or make re-ranks inside
  it (the percentile is recomputed within the filter, client-side, from the stored per-input percentiles).
- **Coverage (hygiene).** Each input stores how many comparables carry full bid and comment history. Below the floor
  it stores null and the page says "not enough comparables", never a guess.

## 4. Storage (SCHEMA_LAW pre-mint checklist)

SCHEMA_LAW lives in the sibling repo (`lofficiel-concierge/supabase/SCHEMA_LAW.md`, cited by
`docs/architecture/MULTI_SURFACE_BRIEF_2026-07-27.md`). Its seven questions, answered:

1. **§1 search before mint.** Candidates read: `hammer_predictions`, `auction_events` (`market_insights` jsonb,
   `sentiment_arc`), `monitored_auctions`, `market_index_values`, `vehicle_observations` and `mv_bidder_profiles`.
   - `hammer_predictions` fits. It is already "one row per lot per scoring moment", keyed by `vehicle_id` +
     `model_version` + `predicted_at`. It carries `bid_count`, `unique_bidders`, `hours_remaining`, `comp_count`,
     `confidence_score`, and `actual_hammer` for scoring. Models 13 and 24 used it exactly this way.
   - No new table.
2. **§2 observation first?** A temperature is a derived score, not testimony about the vehicle. It doesn't belong in
   `vehicle_observations`. The bid and comment facts it is computed from are already testimony rows in
   `auction_comments`.
3. **§3 DNA and vocabularies.**
   - Source: `model_version` 40 ("temperature v1"), listed in the migration comment next to 30 and 31.
   - Method: the function name, in `notes`.
   - `observed_at` = `predicted_at` (the lot's read time).
   - Confidence: `confidence_score` = min(n) / 30, capped at 1.
   - Trust T3: scraped and derived.
4. **§4 view or column?**
   - One column is needed: `hammer_predictions.signals jsonb`, holding per input its value, typical (median of
     comparables), percentile, n and level, plus the composite.
   - The board reads it through a view, `v_live_lot_temperature`: the latest model-40 row per live lot.
   - Rows are appended per read and never updated. Older rows stay as the lot's temperature history.
5. **§5 invariants.** The writer refuses to write a percentile with n < 8: a CHECK on `signals`, or a guard in the
   writer function.
   - Attack tests: a lot with 7 comparables; a lot whose comparables close after it opened; a lot with no bids.
6. **§6 writer disjointness.**
   - One writer, `score_live_lot_temperature(p_vehicle_id)` (SQL, SECURITY DEFINER), called at the end of the live
     pull's per-lot read.
   - It writes only `model_version = 40` rows.
   - Models 30 and 31 stay owned by `scripts/market/live-bands.mjs`.
7. **§7 ledger.** One migration adds the column, the view, the function and the call. It goes out as one commit
   through `supabase-deploy.yml`, with `statement_timeout` and `lock_timeout` set.
   - `ALTER TABLE … ADD COLUMN signals jsonb` is metadata-only (no default), so the lock is brief.
   - RLS: public read, as `hammer_predictions` has today (the board already reads model 31 through
     `market_pulse_live()`).
   - Live verification notes go in the comment.

Username-level history for weights, if precomputed, stays inside the database: a refreshed `mv_bidder_profiles`
with no anon grant. The only thing that leaves it is the per-lot share.

## 5. Query cost

Nothing may scan `auction_comments` by time. With 18.4M rows and no `posted_at` or `hours_until_close` index, a
"last hour everywhere" query is a seq scan over 10 GB. Every read goes through an index that leads with
`vehicle_id` or `author_username`:

- **Per scored lot** (about 3 lots a minute, the pull's rate):
  - The lot's own rows: about 30–100 by `vehicle_id`.
  - Comparables: up to 300 vehicles × their rows by `vehicle_id`. This is `live_lot_temperature`'s shape, measured
    at 0.33 s warm and 4.0 s cold for one lot.
  - Bidder weight: for about 10–20 distinct usernames, their prior rows through `idx_auction_comments_author_username_full`.
    A heavy bidder has thousands of rows, so the lookup is capped at the latest 500 rows per username and the cap is
    stated in the output.
  - Budget: under 5 s cold per lot, inside the job's 50 s `statement_timeout` for 3 lots.
- **Cache the comparables.** A lot's comparable set (the slugs and their per-hour bid, bidder and comment counts)
  changes only when a new comparable closes. Compute it once per (make, model) per day into the same `signals`
  (or a model-41 "cohort" row). Per-lot scoring then touches only the lot's own rows and its bidders.
- **Board read.** The view picks the latest model-40 row per live lot (about 1,250 rows) through
  `idx_hammer_predictions_vehicle`, or a new `(model_version, vehicle_id, predicted_at desc)` index if the plan
  needs one. `market_pulse_live()` gains one column from it.
- **Measure before merge.** `EXPLAIN (ANALYZE, BUFFERS)` under `SET LOCAL ROLE anon` and `transaction_read_only`,
  cold and warm, on the SL500 (f8c68f0e), a busy Porsche and a thin make. Put the numbers in the migration comment.

Phase 1's movement read already follows this rule: one `vehicle_id=in.(8 ids)` read, ordered by `posted_at`, limit
40. It is an index scan over 380 rows and ran in 1.1 ms as anon.

## 6. The backtest

- **Sample.** Every BaT lot sold or not sold from 2026-06-27 to 2026-09-26 with comment and bid rows (the hot/cold
  backtest used 10,065 sold). Score each at `h` ∈ {120, 96, 72, 48, 24, 12, 6, 2} hours before close, from rows
  posted before that moment only.
- **No leakage.**
  - Comparables are lots that closed before the scored lot's `h` moment.
  - Bidder and commenter history comes from lots closed before the scored lot opened.
  - The spectrum's re-ranking uses only lots live at the same moment.
- **Outcomes, per temperature decile and per `h`:**
  1. The share that sold (not reserve-not-met).
  2. The share that finished above the p50 of their comparables.
  3. Final price over the bid at `h` (the "run-up"), against comparables' run-up.
- **Report it the way the current tag's backtest is reported** ("of cars tagged hot 12 h out, 91.5% finished above
  the middle"), by department and price tier. This must show that a low-dollar HOT lot is as predictive inside its
  table as a high-dollar one.
- **Bar to ship.**
  - The composite beats the price-only tag on outcome 2 at every `h`, in the last month held out.
  - Each input kept earns its place: dropping it lowers held-out accuracy.
  - Otherwise the input stays on the page as a count against typical, but out of the score.
- **Run it** in DuckDB over the local archive (as `scripts/market/live-bands.sql` does), not in prod. Only the
  chosen weights and the backtest table reach the repo: this doc, plus a `BACKTEST` constant beside `heatOf`'s.

## 7. Order of work

1. Backtest (offline). This settles which inputs and cut points ship.
2. Migration: the `signals` column, `score_live_lot_temperature`, the view, and the call from the live pull. Verify
   live: the model-40 row count grows at about 3 lots a minute, `bat-live-pull` REST p50 stays under 2 s, and
   `v_job_health` is green.
3. Board: `market_pulse_live()` returns the temperature and its top-two why. `heatOf` becomes a reader of it, and
   the Phase 1 tag format stays.
4. Drill: department and make filters re-rank by stored percentiles.

Open questions for the owner:
- The department taxonomy for the widening step: is the board's make grouping enough for v1?
- Whether commenter weight should count likes (`bat_author_likes`) or only history.
