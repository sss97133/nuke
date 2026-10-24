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

## Alias run (agg_houselot_v4_20261024)
- `model_alias_v1.sql` creates `agg_houselot_model_alias_v1`: cited model-word aliases (make, cc word, house word, years, citation URL + quote).
- `cand4.sql` (psql var `b` = first hex digit) builds `cand4a` (first word equal or cited alias) and `cand4b` (plus every title word
  present as itself, joined to a neighbour such as `srt 10`/`srt10`, or via a cited alias) for events with no cand3 match.
- `apply_agg_houselot_alias.sql` is the normal matcher on cand4a/cand4b: both must be unique and agree, one cc event per house event,
  price-conflict hold unchanged. `python3 batches.py apply_agg_houselot_alias.sql agg_houselot_v4_20261024 OUT`.
- Revert: `revert_agg_houselot_v4_20261024.sql`.

## RM Sotheby's ingest and run agg_houselot_v5_20261024
`rm_ingest/fetch.py` reads each candidate sale from rmsothebys.com `api/search/SearchLots` (3 s between requests; auction codes and dates from `/results/YYYY`).
`match.py` confirms the house: a sold RM lot in a candidate sale with the event's year, make word and at least 60% of its title words (price only breaks ties; a partial title needs the price within 20%).
`mksql.py` inserts each confirmed lot additively (skips a lot already held; reuses a vehicle with the same listing or discovery URL, else creates one): run `rm_ingest_v1_20261024`, cited link, price and currency as RM states, lot number with `lot_number_source_url`.
`cand5.py` builds cand5a (first word) and cand5b (all words) counted over every lot of the candidate sales; `apply_agg_houselot_rm_v5.sql` is the usual matcher with the price hold.
Reverts: `revert_agg_houselot_v5_20261024.sql`, then `rm_ingest/revert_rm_ingest_v1_20261024.sql` (soft: retracts events, sets vehicles.deleted_at).

## FX-aware price hold (agg_houselot_v6_20261024)
`apply_agg_houselot_fx_v6.sql` is the v5 matcher with the price hold in USD: the house and conceptcarz prices are each converted at their
sale-date rate by `fx_usd_rate` (provider order from `fx_rate_provider_preference`: boe for GBP, ecb for EUR), and the rate, its date
and its source are written to `metadata.attach_basis.fx`. A non-USD price with no rate within 7 days stays held (CAD has no rates loaded).
It never attaches to a vehicle created by `rm_ingest_v1_20261024`. Revert: `revert_agg_houselot_v6_20261024.sql`.
Trial 2026-10-24 (rolled back): all 232 v5-held events target rm_ingest vehicles, so 0 attach and the run was not applied.
Of the 11 non-USD held events, only 1 agrees within 20% after conversion (GBP 55,000 at BoE 1.5912 = $87,516 vs 85,000; conceptcarz currency assumed USD).
