-- Rollback for 20261026070000_lot_chassis_from_url: restore backfill_event_identity_check from 20261026034500, drop the helpers.
create or replace function public.backfill_event_identity_check(p_run_id text, p_limit int default 5000)
returns int language plpgsql set search_path = '' as $$
declare n int;
begin
  with c as (
    select e.id, v.vin,
      coalesce(nullif(e.metadata->>'chassis_number',''), nullif(e.metadata->>'chassis',''), nullif(e.metadata->>'listing_vin',''), nullif(e.metadata->>'vin','')) lot,
      case when nullif(e.metadata->>'chassis_number','') is not null then 'metadata.chassis_number'
           when nullif(e.metadata->>'chassis','') is not null then 'metadata.chassis'
           when nullif(e.metadata->>'listing_vin','') is not null then 'metadata.listing_vin'
           else 'metadata.vin' end src
    from public.vehicle_events e join public.vehicles v on v.id = e.vehicle_id
    where e.identity_check is null and nullif(v.vin,'') is not null
      and coalesce(nullif(e.metadata->>'chassis_number',''), nullif(e.metadata->>'chassis',''), nullif(e.metadata->>'listing_vin',''), nullif(e.metadata->>'vin','')) is not null
    limit p_limit)
  update public.vehicle_events e set
    identity_check = public.event_identity_status(c.lot, c.vin),
    identity_check_lot_id = c.lot, identity_check_vehicle_vin = c.vin,
    identity_check_source = 'event_identity_status_v1:' || c.src,
    identity_check_run_id = p_run_id, identity_check_at = now()
  from c where c.id = e.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backfill_event_identity_check(text, int) from public, anon, authenticated;
drop function if exists public.lot_chassis_pick(text, text);
drop function if exists public.lot_chassis_from_url(text);
