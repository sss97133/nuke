begin; set local statement_timeout='55s';
-- Shadow evidence-based vehicle quality score (v1). Additive: new tables and functions only.
-- Does NOT touch vehicles.data_quality_score / quality_grade or their trigger.
-- Rollback: supabase/rollbacks/20261026230000_vehicle_quality_shadow_v1_down.sql (renames to retired_*).

create table if not exists public.vehicle_evidence_source_types (
  source_type    text primary key,
  label          text not null,
  trust          numeric check (trust is null or trust between 0 and 1), -- null = per-row trust from evidence_trust_registry
  half_life_days numeric check (half_life_days is null or half_life_days > 0), -- null = no decay (historical fact)
  saturation_n   numeric not null check (saturation_n > 0),  -- evidence count giving ~63% of the type's weight
  weight         numeric not null check (weight >= 0),
  applies_when   text not null default 'always',             -- 'always' or 'present' (weight only counts when evidence exists)
  evidence_query text not null,                              -- what counts, in words
  basis          text not null,                              -- citation for trust / half-life
  basis_ref      text not null,                              -- table/row the value is taken from
  updated_at     timestamptz not null default now()
);
alter table public.vehicle_evidence_source_types enable row level security;
comment on table public.vehicle_evidence_source_types is 'Cited trust + decay per evidence source type for the shadow vehicle quality score (v1, 2026-10-24).';

insert into public.vehicle_evidence_source_types as t
 (source_type,label,trust,half_life_days,saturation_n,weight,applies_when,evidence_query,basis,basis_ref) values
 ('core_fields','year/make/model present',0.50,null,3,4,'always','count of valid year, make, model on vehicles','self-reported listing fields; trust set at observation_sources median for dealer/classifieds (0.50)','observation_sources category dealer|classifieds median base_trust_score=0.50'),
 ('vin_identity','VIN of expected length',0.90,null,1,14,'always','vehicles.vin length 17 (or >=8 when year<1981)','registry median base_trust_score=0.90 (nhtsa et al.); identity does not decay','observation_sources category registry median=0.90'),
 ('house_sale','house sale event (non-aggregator, not flagged)',0.80,null,3,14,'always','vehicle_events not conceptcarz, source_suspect empty, status sold/ended/unsold','auction category median base_trust_score=0.80; observation_sources auction half-life (30-180d) is listing freshness, not sale-fact decay, so none applied','observation_sources category auction median=0.80'),
 ('house_lot_attach','aggregator event attached by cited same-lot match',0.75,null,2,6,'present','vehicle_events extraction_run_id like agg_houselot% or identity_check=match','attach passed v7 gate (lot, year, price, body, engine); one notch below house_sale since it restates it','scripts/houselot v7-v17 gate; observation_sources aggregator median=0.65 raised by cited lot match'),
 ('aggregator_flagged','aggregator event with source_suspect flag',0.00,null,1,0,'present','vehicle_events with non-empty source_suspect','flagged events are excluded: they are unconfirmed by definition','vehicle_events.source_suspect'),
 ('images','non-duplicate images',0.62,1825,30,14,'always','vehicle_images not duplicate/superseded (first 300), age from taken_at|created_at','marketplace/internal median base_trust_score 0.62-0.65; condition evidence ages, 5-year half-life','observation_sources category marketplace median=0.65, internal=0.65'),
 ('receipts','receipts tied to the vehicle',0.85,3650,5,10,'always','receipts.vehicle_id, not superseded, is_active not false; age from receipt/transaction date','documentation category median base_trust_score=0.85; work records half-life 3650d as in evidence_trust_registry(work_record)','observation_sources documentation median=0.85; evidence_trust_registry half_life_days(work_record)=3650'),
 ('cited_claims','cited claims from listing text and comments',null,null,10,12,'always','evidence_claims (status not rejected) joined to evidence_trust_registry: per-row base_trust and half_life_days','per-row values from evidence_trust_registry (source x author role x claim kind)','evidence_trust_registry'),
 ('cited_observations','observations with a source URL',0.60,1825,15,8,'always','vehicle_observations not superseded with source_url (first 300)','internal/aggregator medians 0.61-0.66; 5-year half-life','observation_sources internal median=0.65, aggregator=0.65'),
 ('field_evidence','cited field values',null,null,10,6,'always','field_evidence / vehicle_field_evidence not rejected/flagged; trust = source confidence/100','per-row source_confidence / confidence_score','field_evidence.source_confidence, vehicle_field_evidence.confidence_score'),
 ('odometer','odometer readings at listing',0.70,730,3,6,'always','vehicle_event_listing_mileage on the vehicle''s events, validation not rejected','listing claim, owner/registry between 0.62-0.90; 2-year half-life since mileage moves','observation_sources owner median=0.86 x listing claim; evidence_trust_registry condition half-life=730'),
 ('fx_citation','sale-date FX citation for non-USD sales',0.95,null,1,2,'present','non-USD vehicle_events with fx_to_usd_source','ECB reference rates (fx_rates provider ecb, eurofxref-hist) at sale date','fx_rates provider=ecb'),
 ('estimate','model estimate (not evidence)',0.00,null,1,0,'present','nuke_estimate/current_value','an estimate is an output, not evidence; the live trigger counts it as 15 points','vehicles.nuke_estimate')
on conflict (source_type) do update set label=excluded.label, trust=excluded.trust, half_life_days=excluded.half_life_days, saturation_n=excluded.saturation_n,
  weight=excluded.weight, applies_when=excluded.applies_when, evidence_query=excluded.evidence_query, basis=excluded.basis, basis_ref=excluded.basis_ref, updated_at=now();

create table if not exists public.vehicle_evq_shadow (
  vehicle_id   uuid primary key references public.vehicles(id),
  shadow_score numeric not null,
  shadow_grade numeric not null,
  components   jsonb not null,
  live_score   integer,
  live_grade   numeric,
  run_id       text not null,
  computed_at  timestamptz not null default now()
);
alter table public.vehicle_evq_shadow enable row level security;
comment on table public.vehicle_evq_shadow is 'Shadow evidence-based quality score; never read by live paths until promoted.';

-- per-type evidence: n = raw count, eff = decayed count, tr = mean trust
create or replace function public.vehicle_evq_shadow_evidence(p uuid)
returns table(source_type text, n numeric, eff numeric, tr numeric)
language sql stable set statement_timeout = '20s' as $f$
with v as (select * from public.vehicles where id = p),
st as (select * from public.vehicle_evidence_source_types),
hl as (select source_type, half_life_days h, trust from st),
d as (select now() t0)
select 'core_fields'::text, x, x, null::numeric from (select ((year between 1885 and 2028)::int + (nullif(trim(make),'') is not null)::int + (nullif(trim(model),'') is not null and length(model)<=80)::int)::numeric x from v) a
union all
select 'vin_identity', x, x, null from (select (coalesce(length(trim(vin)) = 17 or (length(trim(vin)) >= 8 and coalesce(year,0) < 1981), false))::int::numeric x from v) a
union all
select 'house_sale', count(*), count(*), null from public.vehicle_events e where e.vehicle_id = p and coalesce(e.source_url,'') not ilike '%conceptcarz%'
  and cardinality(coalesce(e.source_suspect,'{}')) = 0 and e.event_status in ('sold','ended','unsold','no_sale')
union all
select 'house_lot_attach', count(*), count(*), null from public.vehicle_events e where e.vehicle_id = p and cardinality(coalesce(e.source_suspect,'{}')) = 0
  and (e.extraction_run_id like 'agg_houselot%' or e.identity_check = 'match')
union all
select 'aggregator_flagged', count(*), count(*), null from public.vehicle_events e where e.vehicle_id = p and cardinality(coalesce(e.source_suspect,'{}')) > 0
union all
select 'images', count(*), coalesce(sum(power(0.5, extract(epoch from (d.t0 - a.ts))/86400/(select h from hl where source_type='images'))),0), null
  from (select coalesce(i.taken_at, i.created_at) ts from public.vehicle_images i where i.vehicle_id = p and i.is_duplicate is not true and coalesce(i.is_superseded,false) = false limit 300) a, d
union all
select 'receipts', count(*), coalesce(sum(power(0.5, greatest(0,(current_date - coalesce(r.receipt_date, r.transaction_date, r.created_at::date)))/(select h from hl where source_type='receipts'))),0), null
  from public.receipts r where r.vehicle_id = p and coalesce(r.is_superseded,false) = false and r.is_active is not false
union all
select 'cited_claims', count(*), coalesce(sum(case when g.half_life_days is null then 1 else power(0.5, greatest(0,extract(epoch from (now() - coalesce(c.observed_at,c.created_at)))/86400)/g.half_life_days) end),0), avg(coalesce(g.base_trust,0.5))
  from public.evidence_claims c left join public.evidence_trust_registry g on g.id = c.trust_id
  where c.vehicle_id = p and coalesce(c.status,'') not in ('rejected','retired','superseded')
union all
select 'cited_observations', count(*), coalesce(sum(power(0.5, greatest(0,extract(epoch from (d.t0 - a.ts)))/86400/(select h from hl where source_type='cited_observations'))),0), null
  from (select coalesce(o.observed_at,o.ingested_at) ts from public.vehicle_observations o where o.vehicle_id = p and coalesce(o.is_superseded,false) = false and o.source_url is not null limit 300) a, d
union all
select 'field_evidence', count(*), count(*), avg(c) from (
  select least(100,greatest(0,coalesce(f.source_confidence,50)))/100.0 c from public.field_evidence f where f.vehicle_id = p and coalesce(f.status,'') not in ('rejected','superseded')
  union all
  select least(100,greatest(0,coalesce(f.confidence_score,50)))/100.0 from public.vehicle_field_evidence f where f.vehicle_id = p and f.flagged_as_incorrect is not true) a
union all
select 'odometer', count(*), coalesce(sum(power(0.5, greatest(0,extract(epoch from (now() - coalesce(e.sold_at,e.ended_at,m.created_at))))/86400/(select h from hl where source_type='odometer'))),0), null
  from public.vehicle_events e join public.vehicle_event_listing_mileage m on m.vehicle_event_id = e.id
  where e.vehicle_id = p and coalesce(m.validation::text,'') not ilike '%reject%'
union all
select 'fx_citation', count(*), count(*), null from public.vehicle_events e where e.vehicle_id = p and upper(coalesce(e.currency_code,'USD')) <> 'USD' and e.fx_to_usd_source is not null
union all
select 'estimate', x, x, null from (select ((nuke_estimate is not null) or (current_value is not null))::int::numeric x from v) a
$f$;

-- score = 100 * sum(w * trust * (1 - exp(-eff/sat))) / sum(w over applicable types)
create or replace function public.compute_vehicle_evq_shadow(p uuid)
returns jsonb language sql stable as $f$
with ev as (select * from public.vehicle_evq_shadow_evidence(p)),
j as (select t.source_type, t.weight w, coalesce(ev.tr, t.trust, 0) tr, t.saturation_n s, t.applies_when aw, coalesce(ev.n,0) n, coalesce(ev.eff,0) eff
      from public.vehicle_evidence_source_types t left join ev using (source_type)),
c as (select *, w*tr*(1-exp(-eff/s)) pts, (aw='always' or n>0) and w>0 counts from j)
select jsonb_build_object(
  'score', round(100*coalesce(sum(pts) filter (where counts),0)/nullif(sum(w) filter (where counts),0),1),
  'components', jsonb_object_agg(source_type, jsonb_build_object('n',n,'eff',round(eff,2),'trust',round(tr,3),'w',w,'pts',round(pts,2),'counts',counts)))
from c
$f$;

create or replace function public.vehicle_evq_shadow_refresh(p_ids uuid[], p_run text)
returns integer language sql volatile as $f$
with s as (select v.id, public.compute_vehicle_evq_shadow(v.id) j, v.data_quality_score ls, v.quality_grade lg from public.vehicles v where v.id = any(p_ids)),
ins as (insert into public.vehicle_evq_shadow(vehicle_id, shadow_score, shadow_grade, components, live_score, live_grade, run_id, computed_at)
  select id, coalesce((j->>'score')::numeric,0), round(coalesce((j->>'score')::numeric,0)/10,1), j->'components', ls, lg, p_run, now() from s
  on conflict (vehicle_id) do update set shadow_score=excluded.shadow_score, shadow_grade=excluded.shadow_grade, components=excluded.components,
    live_score=excluded.live_score, live_grade=excluded.live_grade, run_id=excluded.run_id, computed_at=excluded.computed_at returning 1)
select count(*)::int from ins
$f$;
select public.vehicle_evq_shadow_refresh(array(select id from public.vehicles tablesample system(0.01) limit 30),'test') n, (select json_agg(json_build_object('s',shadow_score,'l',live_score)) from public.vehicle_evq_shadow) r; rollback;
