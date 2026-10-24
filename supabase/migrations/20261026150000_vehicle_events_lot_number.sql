-- vehicle_events.lot_number: the auction house's lot number as a first-class, cited column.
-- WHY (2026-10-24): 31,293 Barrett-Jackson house events carry no lot number (source_listing_id is empty and the docket URL ends
-- in the item id, not the lot), so a conceptcarz event matched to one of them cannot cite a lot and stays blocked
-- (run agg_houselot_v1_20261024). The lot numbers are on the docket pages already read by run bj_charity_read_v1_20261023.
-- COLUMNS: lot_number (as the house prints it, e.g. '509', '510.1'); lot_number_source_url (the page it was read from);
--   lot_number_run_id; lot_number_read_at. All four are set together or not at all (check vehicle_events_lot_number_cited).
-- GUARD: aggregator_event_attach_basis also accepts a same_lot citation whose cited event's lot_number equals the cited lot.
--   Everything else in the rule is unchanged; price and date still never count.
-- Rollback: supabase/rollbacks/20261026150000_vehicle_events_lot_number_down.sql
SET lock_timeout = '10s';

alter table public.vehicle_events
  add column if not exists lot_number text,
  add column if not exists lot_number_source_url text,
  add column if not exists lot_number_run_id text,
  add column if not exists lot_number_read_at timestamptz;

alter table public.vehicle_events drop constraint if exists vehicle_events_lot_number_cited;
alter table public.vehicle_events add constraint vehicle_events_lot_number_cited check (
  (lot_number is null and lot_number_source_url is null and lot_number_run_id is null and lot_number_read_at is null)
  or (nullif(btrim(lot_number), '') is not null and nullif(btrim(lot_number_source_url), '') is not null
      and nullif(btrim(lot_number_run_id), '') is not null and lot_number_read_at is not null)) not valid;

comment on column public.vehicle_events.lot_number is
'Auction house lot number as printed by the house (e.g. 509, 510.1). Set only with lot_number_source_url (the page read), lot_number_run_id and lot_number_read_at. Unit: none. Grain: one vehicle listing. Clock: n/a.';
comment on column public.vehicle_events.lot_number_source_url is 'Page the lot_number was read from (citation).';
comment on column public.vehicle_events.lot_number_run_id is 'Run that wrote lot_number.';
comment on column public.vehicle_events.lot_number_read_at is 'When the cited page was read.';

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
                      or (c.lot_number = v_lot and c.lot_number_source_url is not null)
                      or c.source_url ~* ('(^|[^0-9a-z])(lot[-_/ #]*)?' || regexp_replace(v_lot, '([^0-9A-Za-z])', '\\\1', 'g') || '([^0-9a-z]|$)'))) then
      return 'same_lot';
    end if;
  end if;
  return null;
end
$f$;
