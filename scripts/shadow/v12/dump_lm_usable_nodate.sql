-- Companion to dump_lm_usable.sql for the ~45k events with no auction_end_date: sale date falls back to
-- vehicles.sale_date (as the frozen v10-v12 dumps did). Same format and suspect exclusions. Pass both ids
-- comma-separated in LM_USABLE_DUMP.
set statement_timeout = '170s';
select string_agg(e.vehicle_id||'|'||to_char(v.sale_date::date,'YYYY-MM-DD')||'|'||
  coalesce(m.mileage_at_listing::text,'')||'|'||case when m.mileage_tmu then 't' else 'f' end, E'\n') s
from public.auction_event_listing_mileage_usable m
join public.auction_events e on e.id = m.auction_event_id
join public.vehicles v on v.id = e.vehicle_id
where e.auction_end_date is null and v.sale_date is not null
  and not exists (select 1 from public.mileage_value_status s
    where s.vehicle_id = e.vehicle_id and s.status = 'suspect' and s.superseded_at is null);
