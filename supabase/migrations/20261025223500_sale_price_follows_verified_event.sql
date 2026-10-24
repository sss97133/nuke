-- Invariant: vehicles.sale_price follows the latest verified sold event (USD, not a duplicate row).
-- When an event becomes (or changes while) price_verification = 'verified' and event_status = 'sold',
-- the vehicle's sale_price / sale_status / sale_date are synced through the sanctioned chokepoint
-- correct_vehicle_sale_provenance_batch(), citing the event's price_verification_source.
-- Non-USD events are skipped: vehicles has no currency column, so a EUR figure cannot be written there.
-- Rollback: supabase/rollbacks/20261025223500_sale_price_follows_verified_event_down.sql

create or replace function public.sync_vehicle_sale_price_from_verified_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest vehicle_events%rowtype;
  v_price  integer;
  v_cur    integer;
  v_status text;
begin
  if new.vehicle_id is null or new.price_verification is distinct from 'verified' or new.event_status is distinct from 'sold' then
    return null;
  end if;

  select * into v_latest
  from vehicle_events e
  where e.vehicle_id = new.vehicle_id
    and e.price_verification = 'verified'
    and e.event_status = 'sold'
    and e.final_price > 0
    and coalesce(e.sale_truth_role, '') <> 'duplicate'
  order by e.sold_at desc nulls last, e.price_verification_at desc nulls last
  limit 1;

  if not found or v_latest.id <> new.id
     or coalesce(v_latest.currency_code, 'USD') <> 'USD'
     or v_latest.price_verification_source is null then
    return null;
  end if;

  v_price := round(v_latest.final_price)::integer;
  select sale_price, sale_status into v_cur, v_status from vehicles where id = new.vehicle_id;
  if v_cur is not distinct from v_price and v_status is not distinct from 'sold' then
    return null;
  end if;

  perform correct_vehicle_sale_provenance_batch(
    jsonb_build_array(jsonb_build_object(
      'vehicle_id', new.vehicle_id,
      'reason', 'latest verified sold event ' || v_latest.id,
      'source', jsonb_build_object('type', 'verified_vehicle_event', 'ref', v_latest.price_verification_source,
                                   'event_id', v_latest.id, 'run_id', v_latest.price_verification_run_id),
      'corrections', jsonb_build_object(
        'sale_price', jsonb_build_object('value', v_price),
        'sale_status', jsonb_build_object('value', 'sold'),
        'sale_date', jsonb_build_object('value', (v_latest.sold_at at time zone 'UTC')::date)))),
    'trigger:sync_vehicle_sale_price_from_verified_event',
    'sale_price follows the latest verified sold event');
  return null;
end;
$$;

comment on function public.sync_vehicle_sale_price_from_verified_event() is
  'Keeps vehicles.sale_price equal to the latest verified sold USD event, via correct_vehicle_sale_provenance_batch.';

drop trigger if exists trg_sync_vehicle_sale_price_from_verified_event on public.vehicle_events;
create trigger trg_sync_vehicle_sale_price_from_verified_event
  after insert or update of price_verification, final_price, sold_at, event_status, currency_code, sale_truth_role
  on public.vehicle_events
  for each row
  when (new.price_verification = 'verified' and new.event_status = 'sold')
  execute function public.sync_vehicle_sale_price_from_verified_event();
