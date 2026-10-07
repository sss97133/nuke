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
