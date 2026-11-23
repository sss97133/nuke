# Auction "action zone": DRAFT CONTRACT, NOT BUILT, NOT APPLIED

**What the owner asked for.** On an auction card's price rail, the price where bidding usually heats up, worked out from comparable auctions' bid curves.

**What exists (checked live 2026-11-21, SELECT only):**

- **`live_finish_estimates()`** is the client reader for the projected hammer range.
  - Model 33. Returns `fresh: true` with estimate, low, high, grade, coverage, factors and analog lots.
  - Model 33 has 1,680 scored lots. Median absolute error is 15.4%. The low–high band held 77.1% of the time (`prediction_accuracy`).
- **`hammer_predictions`** holds model 32/33 rows.
  - Client RLS exposes only `model_version = 31` rows, and model 31's median error is 26%.
  - So the phone must use `live_finish_estimates`, not this table.
- **`bid_curve_v31()`** is a static, immutable curve: bid as a share of the final price, by hours before close, in 4 tiers.
  - It describes how much of the hammer price is usually reached at a given time.
  - It does not give a price zone where activity starts, and it carries no per-cohort or per-lot validation.
- **`heat_of()` and `v_heat_tag_backtest`** give a hot/cold tag for a lot, with a track record.
  - They describe a lot's state, not a price zone.

**Gap.** No reader states "for lots like this one, bidding accelerates from $X to $Y". The rail must not draw one until that reader exists.

**Proposed reader** (owner approval needed before any SQL is written or applied):

- **Signature:** `auction_action_zone(p_vehicle_ids uuid[])`, STABLE, readable by anon and authenticated.
- **Comparable lots:** the same ones `live_finish_estimates` already uses as analogs, all closed.
- **Per comparable lot**, from `external_auction_bids` / `bat_bids` (amounts and timestamps only, never identities):
  - Find the bid price at which the bid rate first exceeds k × the lot's median rate.
  - Measure it over the last 48 h of the auction, then normalise it by the lot's final price.
- **Zone:** the 25th–75th percentile of those normalised onsets across the cohort, multiplied by this lot's projected hammer. It returns `n_lots` and `thin`.
- **Time left:** the reader also returns the share of comparable lots that were still below the zone at this many hours left.
- **Validation before it reaches the rail:**
  - Backtest on lots closed in the last 90 days.
  - The zone must contain the actual acceleration point at least 60% of the time, measured like `prediction_accuracy`.
  - Below that bar, the rail keeps showing only the current bid and the projected hammer band.
