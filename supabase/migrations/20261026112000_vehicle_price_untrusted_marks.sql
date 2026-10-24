-- Durable vehicle-level "this sale price is untrusted" marks (2026-10-24).
-- WHY: vehicle_sale_price_untrusted reads only events still on the vehicle. When a wrong-vehicle aggregator event is moved to its
-- real vehicle (run agg_reattach_v1_20261024), the price it copied onto the old vehicle would lose its only untrusted marker and
-- read as trusted again. A mark pins (vehicle_id, sale_price) as untrusted with a reason and run id; no price is moved.
-- A mark applies only while vehicles.sale_price still equals the marked price, and is retired by setting retired_at (never deleted).
-- Rollback: supabase/rollbacks/20261026112000_vehicle_price_untrusted_marks_down.sql
SET lock_timeout = '10s';

create table if not exists public.vehicle_sale_price_untrusted_marks (
  id bigserial primary key,
  vehicle_id uuid not null,
  sale_price numeric not null,
  reason text not null,
  source_event_id uuid,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create index if not exists vehicle_sale_price_untrusted_marks_vehicle on public.vehicle_sale_price_untrusted_marks (vehicle_id) where retired_at is null;
create unique index if not exists vehicle_sale_price_untrusted_marks_once on public.vehicle_sale_price_untrusted_marks (vehicle_id, sale_price, coalesce(source_event_id, '00000000-0000-0000-0000-000000000000'::uuid), run_id);
alter table public.vehicle_sale_price_untrusted_marks enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.vehicle_sale_price_untrusted_marks from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.vehicle_sale_price_untrusted_marks from authenticated; end if;
end $$;

create or replace function public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
 returns boolean language sql stable parallel safe as $function$
  select p_sale_price is not null and (
    exists (select 1 from public.vehicle_sale_price_untrusted_marks mk where mk.vehicle_id = p_vehicle_id
              and mk.retired_at is null and mk.sale_price = p_sale_price)
    or
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
                          and not ('vehicle_id' = any(coalesce(ev.source_suspect, '{}')))), false))
 union
 select v.id from public.vehicle_sale_price_untrusted_marks mk
   join public.vehicles v on v.id = mk.vehicle_id and v.sale_price::numeric = mk.sale_price
  where mk.retired_at is null;
