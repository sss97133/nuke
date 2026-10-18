-- Read-only replay of public.live_lot_temperature_at (20261007123000): does the 80% band hold the hammer?
-- Run each query through the read path, never a write path:
--   bash scripts/data/q.sh "$(sed -n '/^-- QUERY 1/,/^-- END 1/p' scripts/market/replay-live-lot-reader.sql | grep -v '^--')"
-- Edit the dates in the first line of the query you run. Each call reads about 100 to 250 ms, so keep a run under
-- 150 lots (the read path times out at 55 s; 147 lots took 37 s) and split a longer period by day or by hour.
--
-- QUERY 1: T-2 on lots the public live collector followed (exact scheduled close from the frames). The default window
--   is lots that close after this change froze (2026-10-07 17:00Z to 19:00Z; repeat for 19:00Z to midnight): a hold-out no
--   design choice has seen.
--   p_at = scheduled close - 120 s; the clock given is the scheduled close; the bid and bidders are the lot's own bid
--   rows at or before p_at. The scheduled close is the earliest previous_scheduled_end in the lot's live frames
--   (the stored auction_end_date is the FINAL close after soft-close extensions: a read 120 s before it already sees the
--   hammer, 311 of 311 lots on 2026-10-04..06). Lots whose bid log does not reproduce the hammer are left out and counted.
--   Output: one row, with the denominators.
-- QUERY 1
with since as (select timestamptz '2026-10-07 17:00:00+00' as t, timestamptz '2026-10-07 19:00:00+00' as u),
m as (select ma.vehicle_id, ma.external_auction_id slug from monitored_auctions ma where ma.stream_state ? 'last_frame_received_at'),
fr as (select o.vehicle_id, min((o.structured_data->>'previous_scheduled_end')::timestamptz) o_true
       from vehicle_observations o where o.vehicle_id in (select vehicle_id from m) and o.extraction_method = 'bat_public_live_v1' group by 1),
lots as (
  select e.id ae_id, e.winning_bid hammer, fr.o_true
  from m join fr using (vehicle_id)
  join auction_events e on e.vehicle_id = m.vehicle_id and substring(e.source_url from '/listing/([^/?#]+)') = m.slug, since
  where e.outcome = 'sold' and e.winning_bid > 0 and e.auction_end_date >= since.t and e.auction_end_date < since.u
),
st as (
  select l.*,
    (select max(c.bid_amount) from auction_comments c where c.auction_event_id = l.ae_id and c.comment_type = 'bid' and c.bid_amount > 0 and c.posted_at <= l.o_true - interval '120 seconds') bid2,
    (select count(distinct c.author_username) from auction_comments c where c.auction_event_id = l.ae_id and c.comment_type = 'bid' and c.bid_amount > 0 and c.posted_at <= l.o_true - interval '120 seconds') k2,
    (select max(c.bid_amount) from auction_comments c where c.auction_event_id = l.ae_id and c.comment_type = 'bid' and c.bid_amount > 0) log_max
  from lots l
),
r as materialized (
  select st.*, public.live_lot_temperature_at(st.ae_id, st.bid2, st.k2::integer, st.o_true - interval '120 seconds', st.o_true) read
  from st where st.bid2 is not null and st.log_max = st.hammer
)
select (select count(*) from lots) as sold_lots_followed,
       (select count(*) from st where bid2 is not null and log_max = hammer) as log_reproduces_hammer_and_bid_at_t2,
       count(*) filter (where read->'band' is not null and read->>'band' <> 'null') as band_available,
       count(*) filter (where (read->'band'->>'high')::numeric >= hammer) as band_holds,
       round(100.0 * count(*) filter (where (read->'band'->>'high')::numeric >= hammer)
             / nullif(count(*) filter (where read->'band' is not null and read->>'band' <> 'null'), 0), 1) as hold_pct,
       count(*) filter (where (read->'prior'->>'low')::numeric <= hammer and hammer <= (read->'prior'->>'high')::numeric) as prior_holds,
       count(*) filter (where read->'prior' is not null and read->>'prior' <> 'null') as prior_available
from r
-- END 1
--
-- QUERY 2: the hours regime on closed lots. A reproducible sample (md5 of the id) of sold BaT lots that closed in a
--   month, read h hours before their final close with the lot's own bid rows at that time. The final close stands in
--   for the clock the page showed, an error of a few minutes (the extension) that is under 2% of the 80th ratio from
--   1 h out. Change h (3 places) for 6 h or 1 h. Lots whose bid log does not reproduce the hammer are left out.
-- QUERY 2
with pick as (
  select e.id ae_id, e.auction_end_date f, e.winning_bid hammer
  from auction_events e
  where e.source = 'bat' and e.outcome = 'sold' and e.winning_bid > 0
    and e.auction_end_date >= '2026-09-01' and e.auction_end_date < '2026-09-27'
    and e.source_url ~ 'bringatrailer\.com/listing/'
  order by md5(e.id::text) limit 100
),
st as (
  select p.*,
    (select max(c.bid_amount) from auction_comments c where c.auction_event_id = p.ae_id and c.comment_type = 'bid' and c.bid_amount > 0 and c.posted_at <= p.f - interval '24 hours') bid_h,
    (select count(distinct c.author_username) from auction_comments c where c.auction_event_id = p.ae_id and c.comment_type = 'bid' and c.bid_amount > 0 and c.posted_at <= p.f - interval '24 hours') k_h,
    (select max(c.bid_amount) from auction_comments c where c.auction_event_id = p.ae_id and c.comment_type = 'bid' and c.bid_amount > 0) log_max
  from pick p
),
r as materialized (
  select st.*, public.live_lot_temperature_at(st.ae_id, st.bid_h, st.k_h::integer, st.f - interval '24 hours', st.f) read
  from st where st.bid_h is not null and st.log_max = st.hammer
)
select count(*) as read_lots,
       count(*) filter (where read->>'band' <> 'null') as band_available,
       count(*) filter (where (read->'band'->>'high')::numeric >= hammer) as band_holds,
       round(100.0 * count(*) filter (where (read->'band'->>'high')::numeric >= hammer)
             / nullif(count(*) filter (where read->>'band' <> 'null'), 0), 1) as hold_pct,
       count(*) filter (where read->'cohort_miss' is not null and read->>'cohort_miss' <> 'null') as cohort_miss_reported
from r
-- END 2
--
-- QUERY 3: per-lot grades of the stored bands (hammer_predictions), lots as the unit; shaped to become the writer of the
--   per-lot grades. A lot is a BaT listing slug. The key is the lot, never vehicle_id -> bat_listings: a prediction's
--   vehicle_id is mapped to its slug through vehicles.listing_url, else through the lot URL on its vehicle_observations
--   (model 24 carries 4,622 vehicle ids for 1,081 lots, 3,932 of the ids have no vehicles row), and the outcome is the
--   sold row of auction_events for that slug (bat_listings.sale_price also holds the high bid of reserve-not-met lots).
--   One row per model version, lot and horizon: 'last' is the latest prediction made before the close; 24h, 12h, 6h and 2h
--   the latest one made at least that long before it (point in time). Read 2026-10-07: model 24 'last' 750 lots, band
--   held 193 (25.7%); model 31 749 lots, held 589 (78.6%). To summarize, wrap it in a select over band_held by model and horizon.
-- QUERY 3
with ids as (   -- every vehicle id a prediction carries, mapped to its lot (the BaT listing slug)
  select h.vehicle_id from hammer_predictions h where h.model_version in (24, 31) group by 1
), idlot as (
  select ids.vehicle_id,
         coalesce(lower(substring(v.listing_url from 'bringatrailer\.com/listing/([^/?#]+)')),
                  (select lower(substring(x.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) from vehicle_observations x
                   where x.vehicle_id = ids.vehicle_id and x.source_url ~ 'bringatrailer\.com/listing/' limit 1)) slug
  from ids left join vehicles v on v.id = ids.vehicle_id
), lot as (     -- the outcome by the lot: the sold row of auction_events for the slug (bid_to is a reserve-not-met high bid, not a sale)
  select distinct on (lower(substring(e.source_url from 'bringatrailer\.com/listing/([^/?#]+)')))
         lower(substring(e.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) slug, e.id auction_event_id, e.winning_bid hammer, e.auction_end_date close_at
  from auction_events e
  where e.outcome = 'sold' and e.winning_bid > 0 and e.source_url ~ 'bringatrailer\.com/listing/'
  order by lower(substring(e.source_url from 'bringatrailer\.com/listing/([^/?#]+)')), e.updated_at desc
), p as (
  select h.id prediction_id, h.model_version, h.vehicle_id, h.predicted_at, h.hours_remaining, h.predicted_low lo, h.predicted_hammer mid, h.predicted_high hi,
         il.slug, lot.auction_event_id, lot.hammer,
         coalesce(lot.close_at, h.predicted_at + h.hours_remaining * interval '1 hour') close_at
  from hammer_predictions h
  join idlot il on il.vehicle_id = h.vehicle_id
  join lot on lot.slug = il.slug
  where h.model_version in (24, 31)
), g as (       -- a prediction counts only if it was made before the close; hours_before_close is its horizon
  select p.*, extract(epoch from (close_at - predicted_at)) / 3600.0 hours_before_close
  from p where predicted_at <= close_at
), h as (       -- fixed horizons: the latest prediction made at least H hours before the close (point in time), plus the last one
  select g.*, hz.horizon,
         row_number() over (partition by g.model_version, g.slug, hz.horizon order by g.predicted_at desc) rn
  from g join (values ('last', 0.0), ('24h', 24.0), ('12h', 12.0), ('6h', 6.0), ('2h', 2.0)) hz(horizon, min_hours) on g.hours_before_close >= hz.min_hours
)
select model_version, slug lot, auction_event_id, horizon, prediction_id, predicted_at, round(hours_before_close::numeric, 1) as hours_to_close,
       lo predicted_low, mid predicted_hammer, hi predicted_high, hammer actual_hammer,
       round(abs(mid - hammer) / hammer * 100, 2) abs_error_pct, (hammer between lo and hi) band_held
from h where rn = 1
-- END 3
--
-- QUERY 4: where the grading join breaks, counted per key path (read 2026-10-07; the result is in the PR).
-- QUERY 4
with ids as (   -- every vehicle id a prediction carries, with the model version that used it
  select h.model_version, h.vehicle_id, max(h.external_listing_id::text)::uuid ext_id from hammer_predictions h where h.model_version in (24, 31) group by 1, 2
), idlot as (
  select ids.*, v.id v_id,
         coalesce(lower(substring(v.listing_url from 'bringatrailer\.com/listing/([^/?#]+)')),
                  (select lower(substring(x.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) from vehicle_observations x
                   where x.vehicle_id = ids.vehicle_id and x.source_url ~ 'bringatrailer\.com/listing/' limit 1)) slug
  from ids left join vehicles v on v.id = ids.vehicle_id
), paths as (
  select idlot.*,
    exists (select 1 from auction_events e where e.vehicle_id = idlot.vehicle_id and e.outcome = 'sold' and e.winning_bid > 0) ae_sold_by_vehicle_id,
    exists (select 1 from bat_listings b where b.vehicle_id = idlot.vehicle_id and b.sale_price > 0) bat_priced_by_vehicle_id,
    exists (select 1 from external_listings x where x.vehicle_id = idlot.vehicle_id and x.listing_status = 'sold' and x.final_price > 0) ext_sold_by_vehicle_id,
    (idlot.ext_id is not null and exists (select 1 from external_listings x where x.id = idlot.ext_id and x.listing_status = 'sold' and x.final_price > 0)) ext_sold_by_listing_id
  from idlot
)
select model_version,
  count(*) as vehicle_ids,
  count(distinct slug) as lots,
  count(*) filter (where v_id is null) as ids_with_no_vehicle_row,
  count(*) filter (where ext_id is not null) as ids_with_an_external_listing_id,
  count(*) filter (where ext_id is not null and not exists (select 1 from external_listings x where x.id = paths.ext_id)) as external_listing_ids_with_no_row,
  count(distinct slug) filter (where ae_sold_by_vehicle_id) as lots_sold_by_vehicle_id_to_auction_events,
  count(distinct slug) filter (where bat_priced_by_vehicle_id) as lots_priced_by_vehicle_id_to_bat_listings,
  count(distinct slug) filter (where ext_sold_by_vehicle_id or ext_sold_by_listing_id) as lots_sold_by_vehicle_or_listing_id_to_external_listings,
  count(distinct slug) filter (where exists (select 1 from auction_events e where lower(substring(e.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) = paths.slug and e.outcome = 'sold' and e.winning_bid > 0)) as lots_sold_by_lot_key_to_auction_events,
  count(distinct slug) filter (where exists (select 1 from bat_listings b where lower(substring(b.bat_listing_url from 'bringatrailer\.com/listing/([^/?#]+)')) = paths.slug and b.sale_price > 0)) as lots_priced_by_lot_key_to_bat_listings
from paths group by model_version order by model_version
-- END 4
