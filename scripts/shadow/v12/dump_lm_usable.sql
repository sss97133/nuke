-- Listing mileage dump for load_v11.py (format vid|YYYY-MM-DD|mileage|tmu, one string in column s).
-- Reads auction_event_listing_mileage_usable (drops rows whose mileage_value_status is suspect) and
-- skips every vehicle with a current suspect mileage_value_status, so a mis-extracted number
-- (speed, mpg, hp, 477-style junk) never reaches the loaders. Save the execute_sql result as
-- /workspace/agent-tools/<id>.txt and pass the id in LM_USABLE_DUMP (see load_v11.py).
select string_agg(e.vehicle_id||'|'||to_char(e.auction_end_date at time zone 'UTC','YYYY-MM-DD')||'|'||
  coalesce(m.mileage_at_listing::text,'')||'|'||case when m.mileage_tmu then 't' else 'f' end, E'\n') s
from public.auction_event_listing_mileage_usable m
join public.auction_events e on e.id = m.auction_event_id
where e.auction_end_date is not null
  and not exists (select 1 from public.mileage_value_status s
    where s.vehicle_id = e.vehicle_id and s.status = 'suspect' and s.superseded_at is null);
