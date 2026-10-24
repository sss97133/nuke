-- Rollback of 20261026101000_vehicle_price_untrusted_marks: restore the 20261026091000 function and view.
-- The marks table is kept (never dropped); it is inert once the readers stop consulting it.
SET lock_timeout = '10s';
create or replace function public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
 returns boolean language sql stable parallel safe as $function$
  select p_sale_price is not null and (
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and (pv.price_verification in ('unverified','contradicted') or 'vehicle_id' = any(coalesce(pv.source_suspect, '{}')))
              and pv.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and (ok.price_verification is null or ok.price_verification = 'verified')
              and ok.sale_truth_role is distinct from 'duplicate'
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification = 'verified' and pv.final_price <> p_sale_price
              and not ('vehicle_id' = any(coalesce(pv.source_suspect, '{}'))))
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.price_verification = 'verified' and ok.final_price = p_sale_price
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
  )
$function$;

create or replace view public.vehicle_sale_price_untrusted_ids as
 with cand as materialized (
   select distinct pv.vehicle_id from public.vehicle_events pv
   where pv.price_verification is not null or 'vehicle_id' = any(coalesce(pv.source_suspect, '{}'))
 )
 select v.id as vehicle_id
   from cand c
   join public.vehicles v on v.id = c.vehicle_id
   join public.vehicle_events ev on ev.vehicle_id = c.vehicle_id
  where v.sale_price is not null
  group by v.id, v.sale_price
 having (coalesce(bool_or((ev.price_verification = any (array['unverified','contradicted']) or 'vehicle_id' = any(coalesce(ev.source_suspect, '{}')))
                          and ev.final_price = v.sale_price::numeric), false)
         and not coalesce(bool_or(ev.final_price = v.sale_price::numeric
                          and (ev.price_verification is null or ev.price_verification = 'verified')
                          and ev.sale_truth_role is distinct from 'duplicate'
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false))
     or (coalesce(bool_or(ev.price_verification = 'verified' and ev.final_price <> v.sale_price::numeric
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false)
         and not coalesce(bool_or(ev.price_verification = 'verified' and ev.final_price = v.sale_price::numeric
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false));

