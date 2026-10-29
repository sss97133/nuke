-- revert DDL (no COMMIT). Run only after revert_data.sql (CHECK cannot narrow while asking rows exist).
drop trigger if exists trg_sale_price_basis_v1_block_asking on public.sale_price_basis_v1;
drop function if exists public.sale_price_basis_v1_block_asking();
create or replace function public.vehicle_event_comp_excluded(p_event_id uuid, p_suspect text[])
 returns boolean language sql stable as $function$
  select (coalesce('source_platform' = any(p_suspect), false)
          and not exists (select 1 from public.price_basis_observation o
                          where o.event_id = p_event_id and o.tbl = 'vehicle_events'
                            and o.rule = 'platform_host_resolution_v1' and o.superseded_at is null
                            and o.observed_status = 'sold'))
      or public.record_is_quarantined('vehicle_events', p_event_id)
$function$;
alter table public.vehicle_events drop constraint if exists vehicle_events_price_kind_check;
alter table public.vehicle_events add constraint vehicle_events_price_kind_check
  check (price_kind = any (array['sale','high_bid_unsold','estimate','unknown']));
