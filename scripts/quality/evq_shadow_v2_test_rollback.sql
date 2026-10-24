begin; set local statement_timeout='55s';
-- evq shadow v2 (additive, shadow-only; live data_quality_score / quality_grade untouched)
-- 1) odometer wiring fix: v1 read only vehicle_event_listing_mileage (340 rows); cited readings live in
--    auction_event_listing_mileage (~252k, keyed by auction_event_id -> auction_events.vehicle_id).
-- 2) as-of evidence (p_asof) for forward calibration: events/odometer after the as-of date are excluded and decay is aged to it.
--    Listing-content sources (images, claims, observations, field evidence) carry ingestion timestamps, not content dates,
--    so they are not time-filtered; ages are clamped at the as-of date.
-- 3) calibration params table + score-from-components using either cited priors or a fitted run.
-- Rollback: supabase/rollbacks/20261026233000_vehicle_evq_shadow_v2_down.sql

update public.vehicle_evidence_source_types set
  evidence_query = 'auction_event_listing_mileage via auction_events.vehicle_id, plus vehicle_event_listing_mileage via vehicle_events; readings on events ending after as-of excluded',
  basis_ref = basis_ref || ' | v2: source auction_event_listing_mileage (cited source_url)', updated_at = now()
where source_type = 'odometer' and basis_ref not like '%| v2:%';

create or replace function public.vehicle_evq_shadow_evidence_v2(p uuid, p_asof timestamptz default null)
returns table(source_type text, n numeric, eff numeric, tr numeric)
language sql stable set statement_timeout = '20s' as $f$
with v as (select * from public.vehicles where id = p),
d as (select coalesce(p_asof, now()) t0, p_asof is not null asof),
hl as (select t.source_type st, t.half_life_days h from public.vehicle_evidence_source_types t),
dec as (select 1),
ev as (select e.*, coalesce(e.sold_at, e.ended_at) ts from public.vehicle_events e, d
       where e.vehicle_id = p and (not d.asof or coalesce(e.sold_at, e.ended_at) < d.t0 - interval '1 day'))
select 'core_fields'::text, x, x, null::numeric from (select ((year between 1885 and 2028)::int + (nullif(trim(make),'') is not null)::int + (nullif(trim(model),'') is not null and length(model)<=80)::int)::numeric x from v) a
union all
select 'vin_identity', x, x, null from (select (coalesce(length(trim(vin)) = 17 or (length(trim(vin)) >= 8 and coalesce(year,0) < 1981), false))::int::numeric x from v) a
union all
select 'house_sale', count(*), count(*), null from ev e where coalesce(e.source_url,'') not ilike '%conceptcarz%'
  and cardinality(coalesce(e.source_suspect,'{}')) = 0 and e.event_status in ('sold','ended','unsold','no_sale')
union all
select 'house_lot_attach', count(*), count(*), null from ev e where cardinality(coalesce(e.source_suspect,'{}')) = 0
  and (e.extraction_run_id like 'agg_houselot%' or e.identity_check = 'match')
union all
select 'aggregator_flagged', count(*), count(*), null from ev e where cardinality(coalesce(e.source_suspect,'{}')) > 0
union all
select 'images', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(a.ts, d.t0))))/86400/(select h from hl where st='images'))),0), null
  from (select coalesce(i.taken_at, i.created_at) ts from public.vehicle_images i where i.vehicle_id = p and i.is_duplicate is not true and coalesce(i.is_superseded,false) = false limit 300) a, d
union all
select 'receipts', count(*), coalesce(sum(power(0.5, greatest(0, (d.t0::date - coalesce(r.receipt_date, r.transaction_date, r.created_at::date)))/(select h from hl where st='receipts'))),0), null
  from public.receipts r, d where r.vehicle_id = p and coalesce(r.is_superseded,false) = false and r.is_active is not false
   and (not d.asof or coalesce(r.receipt_date, r.transaction_date) is null or coalesce(r.receipt_date, r.transaction_date) <= d.t0::date)
union all
select 'cited_claims', count(*), coalesce(sum(case when g.half_life_days is null then 1 else power(0.5, greatest(0, extract(epoch from (d.t0 - least(coalesce(c.observed_at,c.created_at), d.t0))))/86400/g.half_life_days) end),0), avg(coalesce(g.base_trust,0.5))
  from public.evidence_claims c left join public.evidence_trust_registry g on g.id = c.trust_id, d
  where c.vehicle_id = p and coalesce(c.status,'') not in ('rejected','retired','superseded')
union all
select 'cited_observations', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(a.ts, d.t0))))/86400/(select h from hl where st='cited_observations'))),0), null
  from (select coalesce(o.observed_at,o.ingested_at) ts from public.vehicle_observations o where o.vehicle_id = p and coalesce(o.is_superseded,false) = false and o.source_url is not null limit 300) a, d
union all
select 'field_evidence', count(*), count(*), avg(c) from (
  select least(100,greatest(0,coalesce(f.source_confidence,50)))/100.0 c from public.field_evidence f where f.vehicle_id = p and coalesce(f.status,'') not in ('rejected','superseded')
  union all
  select least(100,greatest(0,coalesce(f.confidence_score,50)))/100.0 from public.vehicle_field_evidence f where f.vehicle_id = p and f.flagged_as_incorrect is not true) a
union all
select 'odometer', count(*), coalesce(sum(power(0.5, greatest(0, extract(epoch from (d.t0 - least(o.ts, d.t0))))/86400/(select h from hl where st='odometer'))),0), null
  from (select coalesce(a.auction_end_date, m.created_at) ts from public.auction_events a join public.auction_event_listing_mileage m on m.auction_event_id = a.id
          where a.vehicle_id = p and m.mileage_at_listing is not null
        union all
        select coalesce(e.sold_at, e.ended_at, m.created_at) from public.vehicle_events e join public.vehicle_event_listing_mileage m on m.vehicle_event_id = e.id
          where e.vehicle_id = p and coalesce(m.validation::text,'') not ilike '%reject%') o, d
  where not d.asof or o.ts <= d.t0 + interval '1 day'
union all
select 'fx_citation', count(*), count(*), null from ev e where upper(coalesce(e.currency_code,'USD')) <> 'USD' and e.fx_to_usd_source is not null
union all
select 'estimate', x, x, null from (select ((nuke_estimate is not null) or (current_value is not null))::int::numeric x from v) a
$f$;

create table if not exists public.vehicle_evq_calibration (
  run_id        text not null,
  source_type   text not null references public.vehicle_evidence_source_types(source_type),
  weight        numeric not null check (weight >= 0),
  saturation_n  numeric not null check (saturation_n > 0),
  prior_weight  numeric not null,
  prior_saturation_n numeric not null,
  fit           jsonb not null default '{}'::jsonb,   -- objective, folds, monotonicity, data provenance
  created_at    timestamptz not null default now(),
  primary key (run_id, source_type)
);
alter table public.vehicle_evq_calibration enable row level security;
comment on table public.vehicle_evq_calibration is 'Fitted weight/saturation per evidence type (trust and half-life stay the cited priors). Shadow only.';

create table if not exists public.vehicle_evq_calib_sample (
  vehicle_id    uuid not null references public.vehicles(id),
  sale_event_id uuid not null,
  sale_date     date not null,
  components    jsonb not null,
  run_id        text not null,
  computed_at   timestamptz not null default now(),
  primary key (vehicle_id, sale_event_id)
);
alter table public.vehicle_evq_calib_sample enable row level security;
comment on table public.vehicle_evq_calib_sample is 'As-of-sale-date evidence components for sold vehicles used to calibrate the evq shadow score.';

-- components with n/eff/tr only (score applied separately)
create or replace function public.vehicle_evq_components_v2(p uuid, p_asof timestamptz default null)
returns jsonb language sql stable as $f$
select jsonb_object_agg(t.source_type, jsonb_build_object('n',coalesce(e.n,0),'eff',round(coalesce(e.eff,0),3),'trust',round(coalesce(e.tr,t.trust,0),4)))
from public.vehicle_evidence_source_types t left join public.vehicle_evq_shadow_evidence_v2(p, p_asof) e using (source_type)
$f$;

-- score from components; p_run null = cited priors, else fitted weight/saturation from vehicle_evq_calibration
create or replace function public.vehicle_evq_score_from_components(c jsonb, p_run text default null)
returns numeric language sql stable as $f$
with j as (
  select t.source_type, coalesce(k.weight, t.weight) w, coalesce(k.saturation_n, t.saturation_n) s, t.applies_when aw,
         coalesce((c->t.source_type->>'n')::numeric,0) n, coalesce((c->t.source_type->>'eff')::numeric,0) eff,
         coalesce((c->t.source_type->>'trust')::numeric, t.trust, 0) tr
  from public.vehicle_evidence_source_types t left join public.vehicle_evq_calibration k on k.run_id = p_run and k.source_type = t.source_type)
select round(100*coalesce(sum(w*tr*(1-exp(-eff/s))) filter (where (aw='always' or n>0) and w>0),0)
       / nullif(sum(w) filter (where (aw='always' or n>0) and w>0),0),2) from j
$f$;

create or replace function public.vehicle_evq_calib_sample_refresh(p_rows jsonb, p_run text)
returns integer language sql volatile as $f$
with r as (select (x->>'v')::uuid v, (x->>'eid')::uuid eid, (x->>'d')::date d from jsonb_array_elements(p_rows) x),
ins as (insert into public.vehicle_evq_calib_sample(vehicle_id, sale_event_id, sale_date, components, run_id)
  select r.v, r.eid, r.d, public.vehicle_evq_components_v2(r.v, r.d::timestamptz), p_run from r join public.vehicles vv on vv.id = r.v
  on conflict (vehicle_id, sale_event_id) do update set components = excluded.components, run_id = excluded.run_id, computed_at = now() returning 1)
select count(*)::int from ins
$f$;

alter table public.vehicle_evq_shadow add column if not exists components_v2 jsonb;
alter table public.vehicle_evq_shadow add column if not exists prior_score_v2 numeric;
alter table public.vehicle_evq_shadow add column if not exists calibrated_score numeric;
alter table public.vehicle_evq_shadow add column if not exists calib_run text;

-- v2 refresh: current-date components, prior score, and (if p_calib given) calibrated score
create or replace function public.vehicle_evq_shadow_refresh_v2(p_ids uuid[], p_run text, p_calib text default null)
returns integer language sql volatile as $f$
with s as (select v.id, public.vehicle_evq_components_v2(v.id, null) c, v.data_quality_score ls, v.quality_grade lg from public.vehicles v where v.id = any(p_ids)),
sc as (select s.*, public.vehicle_evq_score_from_components(c, null) ps, case when p_calib is null then null else public.vehicle_evq_score_from_components(c, p_calib) end cs from s),
ins as (insert into public.vehicle_evq_shadow(vehicle_id, shadow_score, shadow_grade, components, live_score, live_grade, run_id, computed_at, components_v2, prior_score_v2, calibrated_score, calib_run)
  select id, coalesce(ps,0), round(coalesce(ps,0)/10,1), c, ls, lg, p_run, now(), c, ps, cs, p_calib from sc
  on conflict (vehicle_id) do update set shadow_score=excluded.shadow_score, shadow_grade=excluded.shadow_grade, components=excluded.components,
    live_score=excluded.live_score, live_grade=excluded.live_grade, run_id=excluded.run_id, computed_at=excluded.computed_at,
    components_v2=excluded.components_v2, prior_score_v2=excluded.prior_score_v2, calibrated_score=excluded.calibrated_score, calib_run=excluded.calib_run returning 1)
select count(*)::int from ins
$f$;

-- recompute scores from stored components (no evidence re-read)
create or replace function public.vehicle_evq_shadow_rescore(p_calib text)
returns integer language sql volatile as $f$
with u as (update public.vehicle_evq_shadow set calibrated_score = public.vehicle_evq_score_from_components(components_v2, p_calib), calib_run = p_calib
           where components_v2 is not null returning 1)
select count(*)::int from u
$f$;
select public.vehicle_evq_shadow_refresh_v2(array(select vehicle_id from public.vehicle_evq_shadow limit 20)||array(select a.vehicle_id from auction_events a join auction_event_listing_mileage m on m.auction_event_id=a.id where a.vehicle_id is not null limit 10),'test') n,
 public.vehicle_evq_components_v2((select a.vehicle_id from auction_events a join auction_event_listing_mileage m on m.auction_event_id=a.id where a.vehicle_id is not null limit 1), '2024-01-01')->'odometer' asof_odo;
select count(*) filter (where (components_v2->'odometer'->>'n')::numeric>0) with_odo, count(*) filter (where components_v2 is not null) n2 from public.vehicle_evq_shadow;
rollback;
