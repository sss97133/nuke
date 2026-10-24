import json
T=json.load(open('trigdefs.json'));ac=T[0]['def'];rs=T[1]['def']
RUN='rm_fix2_v1_20261024'
# --- patch auto_classify_vehicle
a=ac.replace("  v_make_id uuid;\n","  v_make_id uuid;\n  v_era boolean := false;\n",1)
old_sel="    v_make := lower(btrim(NEW.make));\n    SELECT cm.id INTO v_make_id"
assert old_sel in a
a=a.replace(old_sel,"""    v_make := lower(btrim(NEW.make));
    -- era rules (rm_fix2_v1_20261024): a make text whose meaning depends on the model year; null canonical_make_id = do not map
    SELECT r.canonical_make_id, true INTO v_make_id, v_era FROM public.canonical_make_era_rules r
     WHERE lower(r.make_text) = v_make AND NEW.year IS NOT NULL
       AND (r.year_min IS NULL OR NEW.year >= r.year_min) AND (r.year_max IS NULL OR NEW.year <= r.year_max)
     ORDER BY r.id LIMIT 1;
    IF coalesce(v_era, false) THEN
      NEW.canonical_make_id := v_make_id;
    ELSE
    SELECT cm.id INTO v_make_id""",1)
old_end="      NEW.canonical_make_id := NULL;\n    END IF;\n"
assert a.count(old_end)==1
a=a.replace(old_end,old_end+"    END IF;\n",1)
# --- patch resync
old_r="  SELECT v.id, v.make, v.canonical_make_id, r.id\n  FROM public.vehicles v\n"
assert old_r in rs
r2=rs.replace(old_r,"""  SELECT v.id, v.make, v.canonical_make_id, CASE WHEN er.hit THEN er.cmid ELSE r.id END
  FROM public.vehicles v
  LEFT JOIN LATERAL (SELECT true hit, er0.canonical_make_id cmid FROM public.canonical_make_era_rules er0
     WHERE lower(er0.make_text) = lower(btrim(v.make)) AND v.year IS NOT NULL
       AND (er0.year_min IS NULL OR v.year >= er0.year_min) AND (er0.year_max IS NULL OR v.year <= er0.year_max)
     ORDER BY er0.id LIMIT 1) er ON true
""",1)
W=open('wrap_apply.sql').read()
NV={'15657474-0f66-4c77-b1e2-24b7ad5f9f36':'poster','b3194de3-687c-4b86-a03f-0bcb4e0eb21c':'artwork','9682d861-60d0-45a6-b6fc-f43d86329bac':'poster','c0d285f5-fbc5-48d1-9936-7c9ad7c360ac':'poster','0e2cc499-7ce3-4e87-a315-e91d4afabb14':'award','795e0569-cc7c-4506-a107-2ecac33a20b8':'artwork','2faf9828-4414-49c6-8783-2fce6b1ae404':'gas_pump'}
nvvals=','.join(f"('{k}'::uuid,'{v}')" for k,v in NV.items())
AM={'bc3905aa-2447-4190-ab88-f6986647bc51':('American Underslung','Traveler Toy Tonneau'),'40f361dc-207b-49b4-98f9-2f4820797fe3':('American LaFrance','Type 40 Combination Truck'),'983a3b82-95e7-41b5-9ddb-15cc38d0e47c':('American LaFrance',"'Senior' 400 Series Squad Truck"),'9497e992-9e6d-4735-924d-583a22656c4f':('American Eagle','Touring')}
amvals=','.join("('%s'::uuid,'%s','%s')"%(k,m,mo.replace("'","''")) for k,(m,mo) in AM.items())
MB=['9400a7aa-6752-4df1-b7c9-c97a64ec055e','95e92ed2-4e35-4a20-b3af-c96ba2375ee5','76110072-40d2-4e96-9de8-f5df3c33faf1','23d0ee17-4c87-4195-825a-1effb2b5c240']
mbvals=','.join(f"'{x}'::uuid" for x in MB)
sql=f"""-- Run {RUN}. Additive and reversible; revert: revert_{RUN}.sql
-- Part 1: attach records from agg_houselot_v5_20261024 stored the RM page URL as attach_basis.lot_number. Replace with the cited house event lot_number.
create table if not exists public.backup_{RUN}_attach (event_id uuid primary key, old_attach_basis jsonb not null, new_lot text not null, run_id text not null, fixed_at timestamptz not null default now());
alter table public.backup_{RUN}_attach enable row level security;
with g as (
  select e.id, e.metadata->'attach_basis' ab, btrim(he.lot_number) lot, he.source_url, he.lot_number_source_url
  from public.backup_agg_houselot_v5_20261024 b
  join public.vehicle_events e on e.id=b.event_id and e.vehicle_id=b.to_vehicle_id and e.metadata->'attach_basis'->>'run_id'='agg_houselot_v5_20261024'
  join public.vehicle_events he on he.id=b.cited_event_id and (e.metadata->'attach_basis'->>'cited_event_id')::uuid=he.id
  where e.metadata->'attach_basis'->>'lot_number' like '%/%' and nullif(btrim(he.lot_number),'') is not null and he.lot_number_source_url is not null and he.lot_number !~ '/'
), bk as (
  insert into public.backup_{RUN}_attach (event_id, old_attach_basis, new_lot, run_id) select id, ab, lot, '{RUN}' from g on conflict (event_id) do nothing returning event_id
)
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', (e.metadata->'attach_basis') || jsonb_build_object(
    'lot_number', g.lot,
    'citation', 'rm-sothebys house lot '||g.lot||' '||g.source_url||' (lot read from '||g.lot_number_source_url||')',
    'lot_fix', jsonb_build_object('run_id','{RUN}','old_lot_number', g.ab->>'lot_number')))
from g join bk on bk.event_id=g.id where e.id=g.id;
-- Going forward: an attach_basis lot_number must not be URL-shaped (NOT VALID: checks new and updated rows).
alter table public.vehicle_events add constraint vehicle_events_attach_lot_not_url check (
  (metadata->'attach_basis'->>'lot_number') is null or (metadata->'attach_basis'->>'lot_number') !~* '(/|://|^www\\.|\\.(com|net|org|co\\.uk)\\M)') not valid;

-- Part 2: 7 RM lots that are not vehicles. Existing typed fields: vehicles.listing_kind ('non_vehicle_item', check vehicles_listing_kind_check)
-- and vehicle_events.lot_category ('automobilia', check vehicle_events_lot_category_check). Subtype kept in origin_metadata.asset_subtype.
create table if not exists public.backup_{RUN}_nonvehicle (vehicle_id uuid primary key, old_listing_kind text, old_origin_metadata jsonb, event_id uuid, old_lot_category text, old_lot_category_source text, old_ne_stale boolean, run_id text not null, at timestamptz not null default now());
alter table public.backup_{RUN}_nonvehicle enable row level security;
create temp table nv(vehicle_id uuid, subtype text) on commit drop;
insert into nv values {nvvals};
insert into public.backup_{RUN}_nonvehicle (vehicle_id, old_listing_kind, old_origin_metadata, event_id, old_lot_category, old_lot_category_source, old_ne_stale, run_id)
select v.id, v.listing_kind, v.origin_metadata, e.id, e.lot_category, e.lot_category_source, (select bool_or(is_stale) from public.nuke_estimates n where n.vehicle_id=v.id), '{RUN}'
from nv join public.vehicles v on v.id=nv.vehicle_id join public.vehicle_events e on e.vehicle_id=v.id and e.extraction_run_id='rm_ingest_v1_20261024'
on conflict (vehicle_id) do nothing;
update public.vehicles v set listing_kind='non_vehicle_item',
  origin_metadata = coalesce(v.origin_metadata,'{{}}'::jsonb) || jsonb_build_object('asset_subtype', nv.subtype, 'asset_class_source', 'RM lot title (event metadata.title); run {RUN}')
from nv where v.id=nv.vehicle_id;
update public.vehicle_events e set lot_category='automobilia', lot_category_source='RM lot title: '||(e.metadata->>'title')||' ({RUN})'
from nv where e.vehicle_id=nv.vehicle_id and e.extraction_run_id='rm_ingest_v1_20261024';
update public.nuke_estimates n set is_stale=true from nv where n.vehicle_id=nv.vehicle_id;
-- Comps and valuations skip non_vehicle_item rows (each vehicles reference wrapped in a listing_kind filter; old bodies in the revert file).
{W}

-- Part 3: era-dependent makes, cited.
create table if not exists public.canonical_make_citations (id bigserial primary key, canonical_make_id uuid references public.canonical_makes(id), make_text text, claim text not null, source_url text not null, run_id text not null, created_at timestamptz not null default now());
alter table public.canonical_make_citations enable row level security;
create table if not exists public.canonical_make_era_rules (id bigserial primary key, make_text text not null, year_min integer, year_max integer, canonical_make_id uuid references public.canonical_makes(id), rule text not null, source_url text not null, run_id text not null, created_at timestamptz not null default now());
alter table public.canonical_make_era_rules enable row level security;
insert into public.canonical_makes (canonical_name, display_name, aliases, country_of_origin, founded_year, parent_company, is_active) values
 ('MERCEDES-DMG','Mercedes (DMG, pre-1926)','{{}}','Germany',1900,'Daimler-Motoren-Gesellschaft',false),
 ('AMERICAN UNDERSLUNG','American Underslung','{{American Underslung}}','USA',1906,'American Motor Car Company (Indianapolis)',false),
 ('AMERICAN LAFRANCE','American LaFrance','{{American LaFrance,American La France,American-LaFrance}}','USA',1903,null,false),
 ('AMERICAN EAGLE','American Eagle','{{American Eagle}}','USA',1911,'Eagle Motor Car Company (Detroit, Martin Burzynski)',false)
on conflict (canonical_name) do nothing;
insert into public.canonical_make_citations (canonical_make_id, make_text, claim, source_url, run_id)
select cm.id, x.mt, x.claim, x.url, '{RUN}' from (values
 ('MERCEDES-DMG','Mercedes','Mercedes was a Daimler-Motoren-Gesellschaft brand; Mercedes-Benz was formed by the 1926 merger of DMG and Benz & Cie.','https://en.wikipedia.org/wiki/Mercedes-Benz'),
 ('AMERICAN UNDERSLUNG','American Underslung','American Motor Car Company, Indianapolis 1906-1913, pioneered the underslung chassis; cars officially named American Underslung from 1912.','https://en.wikipedia.org/wiki/American_Motor_Car_Company'),
 ('AMERICAN LAFRANCE','American LaFrance','American LaFrance, fire apparatus maker founded 1903 (Elmira, NY).','https://en.wikipedia.org/wiki/American_LaFrance'),
 ('AMERICAN EAGLE','American Eagle','1911 one-off built by Martin Burzynski, Eagle Motor Car Company, Detroit; unrelated to AMC.','https://rmsothebys.com/auctions/hf18/lots/r0104-1911-american-eagle-touring/'),
 ('AMC','American','American Motors Corporation was formed in 1954 (Nash-Kelvinator + Hudson); a pre-1954 make text American is not AMC.','https://en.wikipedia.org/wiki/American_Motors_Corporation')
) x(cn,mt,claim,url) join public.canonical_makes cm on cm.canonical_name=x.cn;
insert into public.canonical_make_era_rules (make_text, year_min, year_max, canonical_make_id, rule, source_url, run_id)
select 'Mercedes', null::int, 1925, (select id from public.canonical_makes where canonical_name='MERCEDES-DMG'), 'make text Mercedes with model year <= 1925 is the DMG marque, not Mercedes-Benz', 'https://en.wikipedia.org/wiki/Mercedes-Benz', '{RUN}'
union all select 'American', null::int, 1953, null::uuid, 'make text American with model year <= 1953 predates AMC (1954); do not map', 'https://en.wikipedia.org/wiki/American_Motors_Corporation', '{RUN}';
{a};
{r2};
create table if not exists public.backup_{RUN}_makes (vehicle_id uuid primary key, old_make text, old_model text, old_canonical_make_id uuid, old_make_source text, old_model_source text, run_id text not null, at timestamptz not null default now());
alter table public.backup_{RUN}_makes enable row level security;
create temp table am(vehicle_id uuid, make text, model text) on commit drop;
insert into am values {amvals};
insert into public.backup_{RUN}_makes (vehicle_id, old_make, old_model, old_canonical_make_id, old_make_source, old_model_source, run_id)
select v.id, v.make, v.model, v.canonical_make_id, v.make_source, v.model_source, '{RUN}' from public.vehicles v where v.id in (select vehicle_id from am) or v.id in ({mbvals}) on conflict do nothing;
update public.vehicles v set make=am.make, model=am.model, make_source='{RUN}: RM lot title; canonical_makes '||am.make||' (cited in canonical_make_citations)', model_source='{RUN}: RM lot title after make'
from am where v.id=am.vehicle_id and v.make='American';
update public.vehicles v set canonical_make_id=(select id from public.canonical_makes where canonical_name='MERCEDES-DMG'), make_source='{RUN}: make Mercedes kept; era rule canonical_make_era_rules (<=1925 = DMG)'
where v.id in ({mbvals}) and v.make='Mercedes';
"""
open('apply.sql','w').write(sql)
rev=f"""-- Revert {RUN}
begin; set local statement_timeout='50s';
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', b.old_attach_basis) from public.backup_{RUN}_attach b where e.id=b.event_id and e.metadata->'attach_basis'->'lot_fix'->>'run_id'='{RUN}';
alter table public.vehicle_events drop constraint if exists vehicle_events_attach_lot_not_url;
update public.vehicles v set listing_kind=b.old_listing_kind, origin_metadata=b.old_origin_metadata from public.backup_{RUN}_nonvehicle b where v.id=b.vehicle_id;
update public.vehicle_events e set lot_category=b.old_lot_category, lot_category_source=b.old_lot_category_source from public.backup_{RUN}_nonvehicle b where e.id=b.event_id;
update public.nuke_estimates n set is_stale=b.old_ne_stale from public.backup_{RUN}_nonvehicle b where n.vehicle_id=b.vehicle_id and b.old_ne_stale is not null;
update public.vehicles v set make=b.old_make, model=b.old_model, make_source=b.old_make_source, model_source=b.old_model_source from public.backup_{RUN}_makes b where v.id=b.vehicle_id;
{open('wrap_revert.sql').read()}
{ac};
{rs};
update public.vehicles v set canonical_make_id=b.old_canonical_make_id from public.backup_{RUN}_makes b where v.id=b.vehicle_id;
delete from public.canonical_make_era_rules where run_id='{RUN}';
-- new canonical_makes rows and citations are left in place (no vehicles point at them after this revert); remove with:
-- delete from public.canonical_make_citations where run_id='{RUN}'; delete from public.canonical_makes where canonical_name in ('MERCEDES-DMG','AMERICAN UNDERSLUNG','AMERICAN LAFRANCE','AMERICAN EAGLE');
commit;
"""
open('revert.sql','w').write(rev)
