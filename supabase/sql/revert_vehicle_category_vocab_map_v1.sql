-- Revert vehicle_category_vocab_map_v1: restores the previous view definition. No transaction end; run inside your own transaction.
set local lock_timeout = '5s';
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
insert into public.vehicle_category_change_log(run_id, phase, column_default, counts) values ('vehicle_category_vocab_map_v1_20261025','revert',null,'{}'::jsonb);
