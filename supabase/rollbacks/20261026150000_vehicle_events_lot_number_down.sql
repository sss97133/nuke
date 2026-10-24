-- Down for 20261026150000_vehicle_events_lot_number: restore the #2647 attach rule (cited event's lot_number no longer counts).
-- The lot columns and their cited values are kept (never hard-delete); they are inert once the rule is restored.
SET lock_timeout = '10s';
create or replace function public.aggregator_event_attach_basis(p_event_id uuid, p_vehicle_id uuid, p_source_url text,
    p_source_platform text, p_metadata jsonb)
 returns text language plpgsql stable set search_path to '' as $f$
declare
  v_ab jsonb := p_metadata -> 'attach_basis';
  v_lot text;
  v_cited uuid;
begin
  if not public.aggregator_event_is_aggregator(p_source_url, p_source_platform) then return 'not_aggregator'; end if;
  if p_vehicle_id is null then return 'not_aggregator'; end if;
  if exists (select 1 from public.vehicles v where v.id = p_vehicle_id
             and public.aggregator_chassis_vin_match(p_source_url, v.vin)) then
    return 'vin_match';
  end if;
  if jsonb_typeof(v_ab) = 'object' and v_ab ->> 'kind' = 'same_lot'
     and nullif(btrim(v_ab ->> 'citation'), '') is not null
     and nullif(btrim(v_ab ->> 'lot_number'), '') is not null
     and coalesce(v_ab ->> 'cited_event_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_lot := btrim(v_ab ->> 'lot_number');
    v_cited := (v_ab ->> 'cited_event_id')::uuid;
    if exists (select 1 from public.vehicle_events c
               where c.id = v_cited and c.id is distinct from p_event_id and c.vehicle_id = p_vehicle_id
                 and not public.aggregator_event_is_aggregator(c.source_url, c.source_platform)
                 and (c.source_listing_id = v_lot
                      or c.source_url ~* ('(^|[^0-9a-z])(lot[-_/ #]*)?' || regexp_replace(v_lot, '([^0-9A-Za-z])', '\\\1', 'g') || '([^0-9a-z]|$)'))) then
      return 'same_lot';
    end if;
  end if;
  return null;
end
$f$;
