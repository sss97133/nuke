-- Listing mileage for events with no auction_end_date, dated by the sale they belong to:
-- 1) that event's own sale_result observation (same source_url, trailing slash ignored) sale_date;
-- 2) else vehicles.sale_date, only when the vehicle has exactly one auction event.
-- Same format/suspect exclusions as dump_lm_usable.sql. Run per vehicle-id chunk (:lo/:hi).
set statement_timeout = '170s';
select string_agg(e.vehicle_id||'|'||to_char(coalesce(s.d, case when (select count(*) from public.auction_events e2 where e2.vehicle_id=e.vehicle_id)=1 then v.sale_date::date end),'YYYY-MM-DD')||'|'||
  coalesce(m.mileage_at_listing::text,'')||'|'||case when m.mileage_tmu then 't' else 'f' end, E'\n') s
from public.auction_event_listing_mileage_usable m
join public.auction_events e on e.id = m.auction_event_id
join public.vehicles v on v.id = e.vehicle_id
left join lateral (
  select min(left(o.structured_data->>'sale_date',10)::date) d from public.vehicle_observations o
  where o.vehicle_id = e.vehicle_id and o.kind = 'sale_result'
    and rtrim(o.source_url,'/') = rtrim(e.source_url,'/')
    and o.structured_data->>'sale_date' ~ '^\d{4}-\d{2}-\d{2}') s on true
where e.auction_end_date is null and e.vehicle_id between 'LO'::uuid and 'HI'::uuid
  and coalesce(s.d, case when (select count(*) from public.auction_events e2 where e2.vehicle_id=e.vehicle_id)=1 then v.sale_date::date end) is not null
  and not exists (select 1 from public.mileage_value_status x
    where x.vehicle_id = e.vehicle_id and x.status = 'suspect' and x.superseded_at is null);
