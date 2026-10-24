# House-lot matcher for flagged conceptcarz events

Runs agg_houselot_v1_20261024 and agg_houselot_v2_20261024 move conceptcarz (aggregator) events that run
agg_attach_audit_v1_20261024 flagged as attached to the wrong vehicle onto the vehicle of a cited house event. The attach guard
`trg_guard_aggregator_event_attach` (#2647) accepts only a `same_lot` basis whose cited event carries the lot number.
Price and date never count.

Steps (each file runs in a rolled-back transaction first; statement_timeout 50s):
1. `stage_house.sql`: house events (bj / mecum / rm / bonhams, house taken from the URL host) into `agg_houselot_v1_20261024_house`.
   Run per house with `:'h'` (house) and `:'pat'` (for example `%mecum.com%`); split mecum and bonhams by id prefix to stay under 50s.
2. `cand2.sql` and `cand3.sql` per id-prefix batch `:'b'`: candidates with the same house, a sale window of ±2 days (or the
   month ±2 days when the conceptcarz date is a month placeholder), and the same year and make.
   - cand2 needs the first model token to match.
   - cand3 also needs every title token to appear in the house lot slug.
   - `n_cand` = number of candidates.
3. `apply_agg_houselot.sql`, written per batch by `batches.py`: moves an event only when
   - it is unique under both cand2 and cand3;
   - it is the only conceptcarz event matched to that house event;
   - the house event has a citable lot number (source_listing_id, `vehicle_events.lot_number` with its page, or the Bonhams `/lot/N/`);
   - it is not a verified sale;
   - no price conflict: a house sold price that is known and more than 20% off the conceptcarz price blocks the move.
     Price can only block a match, never make one.

   Each run writes `backup_<run>`, retires nothing and creates or merges no vehicles. It marks the old vehicle's copied sale
   price untrusted. Revert: `revert_<run>.sql`.
4. `bj_lot_fill.py`: fills `vehicle_events.lot_number` (migration 20261026150000) from Barrett-Jackson docket pages already
   read by run bj_charity_read_v1_20261023, citing each page. Run bj_lot_fill_v1_20261024; revert
   `revert_bj_lot_fill_v1_20261024.sql`.
5. `agg_held_yearflag_v1_20261024.sql`: held VIN-match events where the vehicle's year is the wrong one get
   `vehicles.data_quality_flags.year_suspect` (flag only, no move).
