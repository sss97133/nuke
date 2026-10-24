-- First-class check: does a sale event's lot chassis / VIN match its linked vehicle's VIN?
-- status: match | mismatch | unknown, with the lot id compared, source rule, run id and time.
-- Rollback: supabase/rollbacks/20261026034500_event_vehicle_identity_check_down.sql
create or replace function public.vin_chassis_norm(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(ltrim(regexp_replace(upper(coalesce(p,'')), '[^A-Z0-9]', '', 'g'), '0'), '')
$$;

create or replace function public.event_identity_status(p_lot text, p_vin text) returns text
language sql immutable parallel safe set search_path = '' as $$
  with n as (select public.vin_chassis_norm(p_lot) l, public.vin_chassis_norm(p_vin) v)
  select case
    when l is null or v is null or length(l) < 4 or length(v) < 4 then 'unknown'
    when l = v then 'match'
    -- partial chassis vs full VIN (e.g. lot "50049" vs VIN "...50049"): suffix of >=5 chars
    when length(l) >= 5 and length(v) >= 5 and (right(v, length(l)) = l or right(l, length(v)) = v) then 'match'
    else 'mismatch' end
  from n
$$;

revoke all on function public.vin_chassis_norm(text) from public, anon, authenticated;
revoke all on function public.event_identity_status(text, text) from public, anon, authenticated;

alter table public.vehicle_events
  add column if not exists identity_check text
    check (identity_check in ('match','mismatch','unknown')),
  add column if not exists identity_check_lot_id text,
  add column if not exists identity_check_vehicle_vin text,
  add column if not exists identity_check_source text,
  add column if not exists identity_check_run_id text,
  add column if not exists identity_check_at timestamptz;

comment on column public.vehicle_events.identity_check is
  'Does the event lot chassis/VIN (metadata chassis_number|chassis|listing_vin|vin) match vehicles.vin? match|mismatch|unknown. Mismatch = event likely linked to the wrong vehicle; do not copy its price to the vehicle.';

-- Backfill (run event_identity_check_v1_20261024) is applied out of band in batches via
-- public.backfill_event_identity_check(run_id, limit), only for events where both sides are known.
-- Revert of a run: update vehicle_events set identity_check=null, identity_check_lot_id=null,
--   identity_check_vehicle_vin=null, identity_check_source=null, identity_check_at=null,
--   identity_check_run_id=null where identity_check_run_id='<run>';
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

create index if not exists vehicle_events_identity_mismatch_idx
  on public.vehicle_events (source_platform) where identity_check = 'mismatch';
