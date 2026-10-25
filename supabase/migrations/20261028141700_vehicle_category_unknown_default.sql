-- vehicles.vehicle_category: a gap means "not yet known", never a guessed 'car'.
-- Additive + reversible: drops the column DEFAULT 'car' (new rows get NULL = unknown),
-- existing values are NOT rewritten. Category is read through vehicle_category_resolved,
-- which prefers cited evidence (vehicle_identity_evidence) and treats stored 'car' as an
-- unverified default (every existing row got 'car' from the default; no writer sets it).
-- Before/after recorded in vehicle_category_change_log. Revert: supabase/sql/revert_vehicle_category_unknown_default_v1.sql
set local lock_timeout = '5s';

create table if not exists public.vehicle_category_change_log (
  id bigserial primary key,
  run_id text not null,
  phase text not null check (phase in ('before','after','revert')),
  column_default text,
  counts jsonb not null,
  captured_at timestamptz not null default now()
);
alter table public.vehicle_category_change_log enable row level security;
revoke all on public.vehicle_category_change_log from anon, authenticated;

insert into public.vehicle_category_change_log(run_id, phase, column_default, counts)
select 'vehicle_category_unknown_default_v1_20261025', 'before',
  (select column_default from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name='vehicle_category'),
  (select jsonb_object_agg(c, n) from (select coalesce(vehicle_category,'<null>') c, count(*) n from public.vehicles group by 1) s);

alter table public.vehicles alter column vehicle_category drop default;
comment on column public.vehicles.vehicle_category is
  'Stored category. NULL = not yet known (no default since 2026-10-25). Rows created before then carry an unverified default ''car''. Read vehicle_category_resolved for an evidence-backed value with confidence.';

create or replace view public.vehicle_category_resolved with (security_invoker = true) as
with ev as (
  select distinct on (e.vehicle_id) e.vehicle_id, e.category, e.confidence, e.source_url, e.run_id, e.extractor
  from public.vehicle_identity_evidence e
  where e.retired_at is null
  order by e.vehicle_id, e.confidence desc, e.created_at desc
), st as (
  select v.id, v.vehicle_category stored,
    case lower(v.vehicle_category)
      when 'motorcycle' then 'motorcycle' when 'boat' then 'boat' when 'truck' then 'truck_utility'
      when 'rv' then 'trailer_rv' else null end stored_mapped
  from public.vehicles v
)
select st.id as vehicle_id,
  st.stored as stored_category,
  case when st.stored is null then 'unknown'
       when st.stored = 'car' then 'unverified_default'
       else 'stored_explicit' end as stored_status,
  ev.category as evidence_category,
  ev.confidence as evidence_confidence,
  ev.source_url as evidence_source_url,
  ev.run_id as evidence_run_id,
  coalesce(ev.category, case when st.stored is not null and st.stored <> 'car' then coalesce(st.stored_mapped, lower(st.stored)) end) as category,
  case when ev.category is not null then 'evidence'
       when st.stored is not null and st.stored <> 'car' then 'stored_explicit' end as category_source,
  case when ev.category is not null then ev.confidence end as category_confidence,
  (ev.category is not null and st.stored is not null and st.stored <> 'car'
     and ev.category <> coalesce(st.stored_mapped, lower(st.stored))) as conflict
from st left join ev on ev.vehicle_id = st.id;

comment on view public.vehicle_category_resolved is
  'category NULL = not yet known. Source order: cited vehicle_identity_evidence (confidence 0-100), then an explicitly stored non-default value (no confidence). Stored ''car'' alone is treated as an unverified default, not evidence.';
grant select on public.vehicle_category_resolved to authenticated, service_role;
