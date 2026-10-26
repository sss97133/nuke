-- price_kind gains 'asking'; asking rows can never feed comps, gross or net.
alter table public.vehicle_events drop constraint if exists vehicle_events_price_kind_check;
alter table public.vehicle_events add constraint vehicle_events_price_kind_check
  check (price_kind = any (array['sale','high_bid_unsold','estimate','unknown','asking'])) not valid;
alter table public.vehicle_events validate constraint vehicle_events_price_kind_check;
comment on column public.vehicle_events.price_kind is
  'What the stored price is: sale | high_bid_unsold | estimate | unknown | asking. Price components (hammer/gross/net) exist only for sale; asking is excluded from comps.';

create or replace function public.vehicle_event_comp_excluded(p_event_id uuid, p_suspect text[])
 returns boolean language sql stable as $function$
  select (coalesce('source_platform' = any(p_suspect), false)
          and not exists (select 1 from public.price_basis_observation o
                          where o.event_id = p_event_id and o.tbl = 'vehicle_events'
                            and o.rule = 'platform_host_resolution_v1' and o.superseded_at is null
                            and o.observed_status = 'sold'))
      or public.record_is_quarantined('vehicle_events', p_event_id)
      or exists (select 1 from public.vehicle_events e where e.id = p_event_id and e.price_kind = 'asking')
$function$;

-- gross/net table: no new or updated row may carry an asking event
create or replace function public.sale_price_basis_v1_block_asking() returns trigger language plpgsql as $f$
begin
  if exists (select 1 from public.vehicle_events e where e.id = new.event_id and e.price_kind = 'asking') then
    raise exception 'sale_price_basis_v1: event % has price_kind=asking; gross/net exist only for sale', new.event_id;
  end if;
  return new;
end $f$;
drop trigger if exists trg_sale_price_basis_v1_block_asking on public.sale_price_basis_v1;
create trigger trg_sale_price_basis_v1_block_asking before insert or update on public.sale_price_basis_v1
  for each row execute function public.sale_price_basis_v1_block_asking();
