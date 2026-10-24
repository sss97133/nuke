-- v16 listing-mileage dump keyed by the sale event it belongs to (no date-window matching).
-- Output: vehicle_id|auction_event_id|end_day|mileage|tmu. end_day = auction_events.auction_end_date only;
-- end dates filled 2026-10-24 are cited in auction_event_end_date_provenance (run ae_end_date_receipt_v1_20261024).
-- Never dates from vehicles.sale_date or from sale_result observations with extraction_method
-- 'backfill-sale-results' (copies of stale vehicles.sale_date stamps). Run per vehicle-id chunk (LO/HI).
set statement_timeout = '170s';
select string_agg(e.vehicle_id||'|'||e.id||'|'||to_char(e.auction_end_date at time zone 'UTC','YYYY-MM-DD')||'|'||
  coalesce(m.mileage_at_listing::text,'')||'|'||case when m.mileage_tmu then 't' else 'f' end, E'\n') s
from public.auction_event_listing_mileage_usable m
join public.auction_events e on e.id = m.auction_event_id
where e.auction_end_date is not null and e.vehicle_id between 'LO'::uuid and 'HI'::uuid
  and not exists (select 1 from public.mileage_value_status x
    where x.vehicle_id = e.vehicle_id and x.status = 'suspect' and x.superseded_at is null);
