-- receipt queue pass 2: vendor specialty (cited catalogs), part fitment, chronology (same-work sessions)
-- + scoped single-receipt linker for writers. Additive; revert: supabase/rollbacks/20261027010000_receipt_queue_evidence_rollback.sql

-- basis becomes text + check so new bases can be used in the same transaction (enum kept, unused)
drop view if exists public.vehicle_receipts;
alter table public.receipt_vehicle_links alter column basis type text using basis::text;
alter table public.receipt_vehicle_links drop constraint if exists rvl_basis_check;
alter table public.receipt_vehicle_links add constraint rvl_basis_check check (basis is null or basis in
  ('vin_exact','cited_document','vehicle_hint','legacy_vehicle_id','user_tie_signal','vendor_specialty','part_fitment','chronology_session'));

-- CJ Pony is not Mustang-only per its catalog (also Bronco, Focus ST, C10, F-100): remove from the hard type gate
create or replace function public.receipt_type_signals(r public.receipts) returns jsonb
language sql stable as $$
  with txt as (select lower(concat_ws(' ',
      r.raw_json #>> '{data_v2,vehicle_hint}', r.raw_extraction #>> '{data,vehicle_hint}',
      r.raw_json #>> '{card_projection,vehicle_hint}', r.raw_extraction #>> '{vehicle,make}', r.raw_extraction #>> '{vehicle,model}',
      r.vendor_name, r.raw_extraction #>> '{data,notes}',
      (select string_agg(coalesce(description,'')||' '||coalesce(category,''),' ') from receipt_items i where i.receipt_id=r.id),
      (select string_agg(x->>'description',' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x)
    )) t)
  select jsonb_build_object(
    'makes', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['gm','ford','porsche','honda','nissan','dodge','jeep','toyota','lexus']) m
       where t ~ case m when 'gm' then '\m(chevrolet|chevy|gmc|cheyenne|scottsdale|corvair)\M' when 'dodge' then '\m(dodge|mopar)\M' when 'toyota' then '\m(toyota|land cruiser)\M' else '\m'||m||'\M' end),
    'truck', (select t ~ '\m(lmc truck|truck|pickup|offroad|off-road|4x4|4wd|suburban|blazer|k5|k10|k20|k1500|k2500|c10|c20|squarebody|bronco|wrangler|cheyenne|scottsdale|transfer case|leaf spring)\M' from txt),
    'car', (select t ~ '\m(mustang|corvette|porsche|911|corvair|maxima|camaro)\M' from txt),
    'models', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['mustang','corvette','bronco','suburban','blazer','corvair','wrangler','maxima']) m where t ~ ('\m'||m||'\M'))
  ) $$;



-- retiring a row (only retired_at changes) must not re-run gates
create or replace function public.receipt_vehicle_links_enforce() returns trigger
language plpgsql as $$
declare r receipts; pd record;
begin
  if TG_OP='UPDATE' and NEW.retired_at is not null and OLD.retired_at is null
     and (NEW.status, NEW.vehicle_id, NEW.basis) is not distinct from (OLD.status, OLD.vehicle_id, OLD.basis) then
    return NEW; end if;
  select * into r from receipts where id=NEW.receipt_id;
  NEW.user_id := r.user_id;
  select * into pd from receipt_page_date(r);
  NEW.page_date := pd.d; NEW.page_date_source := pd.src;
  if NEW.status='linked' then
    NEW.tie_kind := receipt_user_vehicle_tie(r.user_id, NEW.vehicle_id);
    if NEW.tie_kind is null then raise exception 'receipt_vehicle_links: paying user % not tied to vehicle %', r.user_id, NEW.vehicle_id; end if;
    NEW.type_gate := receipt_type_gate(NEW.receipt_id, NEW.vehicle_id);
    if NEW.type_gate='fail' then raise exception 'receipt_vehicle_links: type gate fail receipt % vehicle %', NEW.receipt_id, NEW.vehicle_id; end if;
    if NEW.basis_ref = '{}'::jsonb then raise exception 'receipt_vehicle_links: linked row needs basis_ref'; end if;
  end if;
  return NEW;
end $$;


-- gate split: pure (signals, vehicle) form so callers can precompute signals once per receipt
create or replace function public.receipt_type_gate_sv(s jsonb, v public.vehicles) returns text
language plpgsql stable as $$
declare fam text; cls text; pos boolean := false;
begin
  if v.id is null then return 'fail'; end if;
  cls := receipt_vehicle_class(v);
  fam := case when lower(v.make) in ('chevrolet','chevy','gmc') then 'gm' else lower(v.make) end;
  if jsonb_array_length(s->'makes')>0 then
    if fam is not null and not (s->'makes') ? fam then return 'fail'; end if; pos := true; end if;
  if jsonb_array_length(s->'models')>0 then
    if not exists (select 1 from jsonb_array_elements_text(s->'models') m where lower(coalesce(v.model,'')) like '%'||m||'%') then return 'fail'; end if; pos := true; end if;
  if (s->>'truck')::boolean and not (s->>'car')::boolean and cls='car' then return 'fail'; end if;
  if (s->>'car')::boolean and not (s->>'truck')::boolean and cls='truck' then return 'fail'; end if;
  if ((s->>'truck')::boolean and cls='truck') or ((s->>'car')::boolean and cls='car') then pos := true; end if;
  return case when pos then 'pass' else 'unknown' end;
end $$;
create or replace function public.receipt_type_gate(p_receipt uuid, p_vehicle uuid) returns text
language plpgsql stable as $$
declare r receipts; v vehicles;
begin
  select * into r from receipts where id=p_receipt; select * into v from vehicles where id=p_vehicle;
  if r.id is null or v.id is null then return 'fail'; end if;
  return receipt_type_gate_sv(receipt_type_signals(r), v);
end $$;

create table if not exists public.receipt_vendor_specialties (
  id bigserial primary key,
  vendor_slug text not null,
  vendor_pattern text not null,
  make text,              -- null = any make
  model_pattern text,     -- regex on vehicles.model, null = any
  year_min int, year_max int,
  vehicle_class text check (vehicle_class in ('truck','car')),
  citation_url text not null,
  citation_quote text not null,
  fetched_at date not null
);
alter table public.receipt_vendor_specialties enable row level security;
do $$ begin create policy rvs_read on public.receipt_vendor_specialties for select using (true); exception when duplicate_object then null; end $$;
insert into public.receipt_vendor_specialties(vendor_slug,vendor_pattern,make,model_pattern,year_min,year_max,vehicle_class,citation_url,citation_quote,fetched_at)
select * from (values
 ('cj_pony_parts','cj ?pony','Ford','mustang',1964,2026,null,'https://www.cjponyparts.com/','aftermarket parts and accessories for 1964.5 to present Ford Mustangs, as well as Broncos, Focus STs, and classic trucks like the Chevy C10 and Ford F-100','2026-10-24'::date),
 ('cj_pony_parts','cj ?pony','Ford','bronco',null,null,null,'https://www.cjponyparts.com/','... as well as Broncos ...','2026-10-24'),
 ('cj_pony_parts','cj ?pony','Ford','focus',null,null,null,'https://www.cjponyparts.com/','... Focus STs ...','2026-10-24'),
 ('cj_pony_parts','cj ?pony','Chevrolet','c10|c-10',null,null,null,'https://www.cjponyparts.com/','... classic trucks like the Chevy C10 ...','2026-10-24'),
 ('cj_pony_parts','cj ?pony','Ford','f-?100',null,null,null,'https://www.cjponyparts.com/','... and Ford F-100','2026-10-24'),
 ('toms_offroad','tom.?s ?off ?road','Ford','bronco',1966,1979,null,'https://www.tomsoffroad.com/','The leader in offroad and restoration parts for Ford Broncos and Trucks. 1966-77 / 1978-79 Ford Bronco Parts','2026-10-24'),
 ('toms_offroad','tom.?s ?off ?road','Ford','bronco',2021,2026,null,'https://www.tomsoffroad.com/','6th Gen Ford Bronco Parts','2026-10-24'),
 ('toms_offroad','tom.?s ?off ?road','Ford','\mf-?[0-9]{3}|pickup|truck',null,null,null,'https://www.tomsoffroad.com/','Ford F-Series Truck Parts','2026-10-24'),
 ('lmc_truck','lmc ?truck',null,null,1926,2016,'truck','https://www.lmctruck.com/','Truck Parts & Accessories for Chevy, GMC, Ford and Dodge Trucks and SUVs','2026-10-24'),
 ('offroad_design','off ?road design',null,null,null,null,'truck','https://www.offroaddesign.com/np203-np205-doubler-kit.html','uniquely suited to full size trucks ... Chevy, GM, Dodge, Ford or custom','2026-10-24')
) v where not exists (select 1 from public.receipt_vendor_specialties);

-- coarse work categories for same-work matching
create or replace function public.receipt_work_cats(p text) returns text[] language sql immutable as $$
  select coalesce(array_agg(c order by c),'{}') from (values
    ('brakes','brake|rotor|caliper|\mpads?\M|master cyl'),('engine_oil','\moil\M|oil filter|5w|10w'),('ignition','spark|plug wire|distributor|\mcoil\M|ignition'),
    ('charging','battery|alternator|starter'),('cooling','radiator|coolant|antifreeze|water pump|thermostat|\mhoses?\M'),('belts','\mbelts?\M|serpentine'),
    ('tires_wheels','\mtires?\M|\mwheels?\M|lug nut|\mrims?\M'),('suspension','shock|leaf spring|\mcoil spring|bushing|sway bar|suspension|lift kit'),
    ('driveline','axle|u-?joint|driveshaft|differential|transfer case|transmission|clutch|\mgear'),('exhaust','exhaust|muffler|header|catalytic'),
    ('fuel','fuel|carb|injector|throttle body'),('lighting','headlight|tail ?light|\mbulbs?\M|lamp'),('body_paint','paint|primer|body filler|bondo|clear ?coat|sand ?paper|panel|fender|bumper'),
    ('interior','seat|carpet|dash|headliner|upholstery'),('electrical','wire|wiring|fuse|relay|harness|switch'),('steering','steering|tie rod|pitman|idler arm'),('seals_gaskets','gasket|\mseals?\M|o-?ring'))
    v(c,re) where lower(coalesce(p,'')) ~ re $$;

create or replace function public.receipt_queue_resolve(p_run text, p_receipt uuid default null) returns jsonb
language plpgsql as $$
declare res jsonb;
begin
  drop table if exists _q, _qc, _qe, _qd;
  create temp table _q on commit drop as
  select l.id link_id, l.receipt_id rid, l.hold_reason, l.page_date, l.basis_ref, r.user_id, r.vendor_name,
    lower(concat_ws(' ', r.vendor_name, r.raw_extraction #>> '{data,notes}',
      (select string_agg(coalesce(description,'')||' '||coalesce(category,''),' ') from receipt_items i where i.receipt_id=r.id),
      (select string_agg(coalesce(x->>'description',''),' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x),
      (select string_agg(coalesce(x->>'description',''),' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_extraction#>'{data,line_items}')='array' then r.raw_extraction#>'{data,line_items}' else '[]' end) x))) txt,
    (select array_agg(distinct pn) from (
       select nullif(trim(part_number),'') pn from receipt_items i where i.receipt_id=r.id
       union select nullif(trim(x->>'part_number'),'') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x) p where pn is not null and length(pn)>=4) pns
  from receipt_vehicle_links l join receipts r on r.id=l.receipt_id
  where l.retired_at is null and l.status='held' and l.hold_reason in ('no_identifier','ambiguous_multiple_vehicles','legacy_link_uncorroborated')
    and (p_receipt is null or l.receipt_id=p_receipt);

  -- candidate vehicles: prior candidates if the row had any, otherwise every vehicle tied to the payer
  create temp table _qc on commit drop as
  with ties as (
    select distinct u.user_id, x.vid from (select distinct user_id from _q) u, lateral (
      select id vid from vehicles where owner_id=u.user_id union select id from vehicles where user_id=u.user_id
      union select id from vehicles where uploaded_by=u.user_id
      union select vehicle_id from ownership_verifications where user_id=u.user_id and status in ('approved','expired')
      union select vehicle_id from vehicle_user_permissions where user_id=u.user_id and is_active
      union select vehicle_id from user_vehicle_links where user_id=u.user_id and link_type='owner'
      union select vehicle_id from vehicle_user_relationships where user_id=u.user_id) x where x.vid is not null
  ), prior as (
    select q.rid, (c->>'vehicle')::uuid vid from _q q, jsonb_array_elements(case when jsonb_typeof(q.basis_ref->'candidates')='array' then q.basis_ref->'candidates' else '[]' end) c
    where c->>'vehicle' is not null and c->>'tie' is not null and coalesce(c->>'type_gate','') <> 'fail'
  )
  select q.rid, t.vid from _q q join ties t on t.user_id=q.user_id
    join vehicles v on v.id=t.vid and v.deleted_at is null and v.status is distinct from 'merged'
  where not exists (select 1 from prior p where p.rid=q.rid) or exists (select 1 from prior p where p.rid=q.rid and p.vid=t.vid);
  alter table _q add column sig jsonb;
  update _q q set sig = receipt_type_signals(r) from receipts r where r.id=q.rid;
  delete from _qc c using _q q, vehicles v where q.rid=c.rid and v.id=c.vid and receipt_type_gate_sv(q.sig, v)='fail';

  -- evidence rows per (receipt, vehicle)
  create temp table _qe (rid uuid, vid uuid, kind text, ref jsonb) on commit drop;
  -- vendor specialty
  insert into _qe
  select c.rid, c.vid, 'vendor_specialty', jsonb_build_object('vendor_slug',s.vendor_slug,'citation_url',s.citation_url,'quote',s.citation_quote,'fetched_at',s.fetched_at)
  from _qc c join _q q on q.rid=c.rid join vehicles v on v.id=c.vid
  join receipt_vendor_specialties s on q.vendor_name ~* s.vendor_pattern
  where (s.make is null or lower(v.make)=lower(s.make) or (lower(s.make) in ('chevrolet','gmc') and lower(v.make) in ('chevrolet','gmc')))
    and (s.model_pattern is null or lower(coalesce(v.model,'')) ~ s.model_pattern)
    and (s.year_min is null or v.year >= s.year_min) and (s.year_max is null or v.year <= s.year_max)
    and (s.vehicle_class is null or receipt_vehicle_class(v)=s.vehicle_class);
  -- part fitment (catalog part number with fitment)
  insert into _qe
  select c.rid, c.vid, 'part_fitment', jsonb_build_object('part_number',cp.part_number,'catalog_part',cp.id,'fits_models',cp.fits_models,'years',concat(cp.year_start,'-',cp.year_end))
  from _qc c join _q q on q.rid=c.rid join vehicles v on v.id=c.vid
  join catalog_parts cp on cp.part_number = any(q.pns)
  where cp.fits_models is not null and cp.fits_models::text ~* split_part(coalesce(v.model,'~~'),' ',1)
    and (cp.year_start is null or v.year >= cp.year_start) and (cp.year_end is null or v.year <= cp.year_end);
  -- chronology: work session / image work extraction on the vehicle within 3 days of the page date showing the same work category
  alter table _q add column cats text[];
  update _q set cats = receipt_work_cats(txt);
  insert into _qe
  with ev as materialized (
    select w.vehicle_id vid, w.session_date d, jsonb_build_object('work_session',w.id,'session_date',w.session_date) ref,
      receipt_work_cats(concat_ws(' ',w.title,w.work_description,w.work_type,w.zones_touched::text,w.stages_observed::text)) cats
    from work_sessions w where w.vehicle_id in (select distinct vid from _qc) and w.session_date is not null
    union all
    select e.vehicle_id, coalesce(e.detected_date::date,i.taken_at::date), jsonb_build_object('image_work_extraction',e.id,'image',e.image_id,'image_date',coalesce(e.detected_date::date,i.taken_at::date)),
      receipt_work_cats(concat_ws(' ',e.detected_work_type,e.detected_work_description,e.detected_components::text))
    from image_work_extractions e left join vehicle_images i on i.id=e.image_id where e.vehicle_id in (select distinct vid from _qc)
  )
  select c.rid, c.vid, 'chronology_session', ev.ref || jsonb_build_object('days_from_receipt', ev.d-q.page_date,
      'shared_work',(select to_jsonb(array_agg(x)) from unnest(q.cats) x where x = any(ev.cats)))
  from _qc c join _q q on q.rid=c.rid join ev on ev.vid=c.vid
  where q.page_date is not null and ev.d between q.page_date-3 and q.page_date+3 and q.cats && ev.cats and cardinality(q.cats)>0;

  -- decision: narrow by each evidence kind present for the receipt (intersection); link only if exactly one vehicle remains
  create temp table _qd on commit drop as
  with kinds as (select rid, array_agg(distinct kind) ks from _qe group by rid),
  surv as (
    select c.rid, c.vid from _qc c join kinds k on k.rid=c.rid
    where (select bool_and(exists (select 1 from _qe e where e.rid=c.rid and e.vid=c.vid and e.kind=kk)) from unnest(k.ks) kk)
  ),
  n as (select rid, count(*) n, min(vid::text)::uuid vid from surv group by rid)
  select q.link_id, q.rid, q.hold_reason old_reason, k.ks, coalesce(n.n,0) n, n.vid,
    (select count(distinct vid) from _qc c where c.rid=q.rid) ncand
  from _q q left join kinds k on k.rid=q.rid left join n on n.rid=q.rid;

  update receipt_vehicle_links l set retired_at=now() from _qd d where l.id=d.link_id and (d.ks is not null);
  insert into receipt_vehicle_links(receipt_id, vehicle_id, status, basis, basis_ref, confidence, hold_reason, run_id)
  select d.rid, case when d.n=1 then d.vid end, case when d.n=1 then 'linked' else 'held' end,
    case when d.n=1 then case when 'part_fitment'=any(d.ks) then 'part_fitment' when 'vendor_specialty'=any(d.ks) then 'vendor_specialty' else 'chronology_session' end end,
    jsonb_build_object('pass','queue_evidence','provisional',true,'prior_hold',d.old_reason,'candidates_considered',d.ncand,'survivors',d.n,
      'evidence',(select jsonb_agg(jsonb_build_object('vehicle',e.vid,'kind',e.kind,'ref',e.ref)) from _qe e where e.rid=d.rid and (d.n<>1 or e.vid=d.vid))),
    case when d.n=1 then round(least(0.9,
        (case when 'part_fitment'=any(d.ks) then 0.8 when 'vendor_specialty'=any(d.ks) then 0.7 else 0.6 end + 0.1*(array_length(d.ks,1)-1))
        * receipt_tie_weight(receipt_user_vehicle_tie(r.user_id, d.vid)))::numeric,3) end,
    case when d.n=1 then null when d.n=0 then 'evidence_no_single_vehicle' else 'evidence_multiple_vehicles' end, p_run
  from _qd d join receipts r on r.id=d.rid where d.ks is not null;

  select jsonb_build_object('queue',(select count(*) from _q),'no_evidence',(select count(*) from _qd where ks is null),
    'result',(select jsonb_object_agg(k,c) from (select status||':'||coalesce(basis,hold_reason) k, count(*) c from receipt_vehicle_links where run_id=p_run and retired_at is null group by 1) z)) into res;
  return res;
end $$;

-- scoped linker (both passes) for one receipt
create or replace function public.receipt_vehicle_links_refresh(p_run text, p_receipt uuid) returns jsonb
language plpgsql as $$
declare res jsonb;
begin
  drop table if exists _rb, _rcand, _rcg, _rc;
  create temp table _rb on commit drop as
    select r.* from receipts r where coalesce(r.is_superseded,false)=false and coalesce(r.is_active,true) and (p_receipt is null or r.id=p_receipt);

  -- VIN / chassis identifiers: 17-char must pass check digit; short (8-13) must equal a stored short VIN exactly
  create temp table _rcand on commit drop as
  with vc as (
    select distinct b.id rid, upper(m[1]) vin from _rb b,
      regexp_matches(coalesce(b.raw_extraction::text,'')||' '||coalesce(b.raw_json::text,''), '(?<![A-Za-z0-9])([A-HJ-NPR-Za-hj-npr-z0-9]{8,17})(?![A-Za-z0-9])','g') m
    where upper(m[1]) ~ '[A-Z]' and upper(m[1]) ~ '[0-9]{4}$' and length(m[1]) in (8,9,10,11,12,13,17)
  ), vv as (select * from vc where length(vin)<17 or receipt_vin_check_ok(vin))
  select vv.rid, v.id vid, 'vin_exact'::receipt_vehicle_link_basis basis, jsonb_build_object('vin',vv.vin) ref, 0.97::numeric conf
  from vv cross join lateral (select id from vehicles v where upper(trim(both from v.vin))=vv.vin and v.deleted_at is null and v.status is distinct from 'merged') v;

  insert into _rcand
  select b.id, coalesce(d.vehicle_id, i.vehicle_id), 'cited_document', jsonb_build_object('table',b.source_document_table,'id',b.source_document_id), 0.9
  from _rb b
    left join vehicle_documents d on b.source_document_table='vehicle_documents' and d.id=b.source_document_id
    left join vehicle_images i on b.source_document_table='vehicle_images' and i.id=b.source_document_id
  where coalesce(d.vehicle_id, i.vehicle_id) is not null;

  insert into _rcand
  select b.id, b.vehicle_id, 'legacy_vehicle_id', jsonb_build_object('receipts.vehicle_id',b.vehicle_id,'scope_type',b.scope_type), 0.6
  from _rb b where b.vehicle_id is not null;

  -- vehicle_hint (cited page text) against the payer's tied vehicles only
  insert into _rcand
  with ties as (
    select distinct u.user_id, x.vid from (select distinct user_id from _rb where user_id is not null) u, lateral (
      select id vid from vehicles where owner_id=u.user_id union select id from vehicles where user_id=u.user_id
      union select id from vehicles where uploaded_by=u.user_id
      union select vehicle_id from ownership_verifications where user_id=u.user_id and status in ('approved','expired')
      union select vehicle_id from vehicle_user_permissions where user_id=u.user_id and is_active
      union select vehicle_id from user_vehicle_links where user_id=u.user_id and link_type='owner'
      union select vehicle_id from vehicle_user_relationships where user_id=u.user_id) x where x.vid is not null
  ), hint as (
    select b.id rid, b.user_id, h, (regexp_match(h,'\m(19[0-9]{2}|20[0-2][0-9])\M'))[1]::int yr from _rb b,
      lateral (select coalesce(nullif(b.raw_json #>> '{data_v2,vehicle_hint}','null'), nullif(b.raw_extraction #>> '{data,vehicle_hint}','null')) h) z
    where h is not null and h ~* '[a-z]{2}'
  ), pre as materialized (
    select hn.rid, v.id vid, hn.h from hint hn join ties t on t.user_id=hn.user_id join vehicles v on v.id=t.vid
    where v.deleted_at is null and v.status is distinct from 'merged' and (hn.yr is null or v.year=hn.yr)
      and (lower(hn.h) ~ ('\m'||coalesce(nullif(lower(regexp_replace(split_part(coalesce(v.model,''),' ',1),'[^A-Za-z0-9]','','g')),''),'~~nomodel~~')||'\M')
           or (hn.yr is not null and v.make is not null and lower(hn.h) ~ ('\m'||lower(v.make)||'\M')))
  )
  select rid, vid, 'vehicle_hint', jsonb_build_object('vehicle_hint',h), 0.75 from pre where receipt_type_gate(rid, vid)='pass';

  create temp table _rcg on commit drop as
  select c.*, receipt_user_vehicle_tie(b.user_id, c.vid) tie, receipt_type_gate(c.rid, c.vid) gate
  from (select distinct on (rid, vid, basis) * from _rcand order by rid, vid, basis) c join _rb b on b.id=c.rid;

  create temp table _rc on commit drop as
  with per as (
    select rid,
      count(distinct vid) filter (where tie is not null and gate<>'fail') ok_veh,
      count(distinct vid) filter (where basis in ('vin_exact','cited_document') and tie is not null and gate<>'fail') strong_veh,
      count(*) filter (where tie is null) untied, count(*) filter (where gate='fail' and tie is not null) gatefail
    from _rcg group by rid
  ), ok as (
    select g.*, (g.basis in ('vin_exact','cited_document')) strong,
      count(*) over (partition by g.rid, g.vid) nbases
    from _rcg g where g.tie is not null and g.gate<>'fail'
  ), strongv as (select rid, vid from ok where strong group by 1,2),
  pick as (
    select distinct on (o.rid) o.*, p.ok_veh, p.strong_veh from ok o join per p using (rid)
    order by o.rid, exists (select 1 from strongv s where s.rid=o.rid and s.vid=o.vid) desc, o.conf desc
  )
  select b.id rid, pk.vid, pk.basis, pk.ref, pk.tie, pk.gate, pk.ok_veh, pk.nbases,
    case when pk.rid is not null and (pk.ok_veh=1 or pk.strong_veh=1) and not (pk.basis='legacy_vehicle_id' and pk.gate='unknown' and pk.nbases=1) then 'linked' else 'held' end status,
    round(least(0.99, pk.conf * receipt_tie_weight(pk.tie) * case when pk.gate='pass' then 1 else 0.9 end
      + case when pk.nbases>1 then 0.05*(pk.nbases-1) else 0 end)::numeric,3) conf,
    case
      when pk.rid is not null and pk.ok_veh>1 and pk.strong_veh<>1 then 'ambiguous_multiple_vehicles'
      when pk.rid is not null and pk.basis='legacy_vehicle_id' and pk.gate='unknown' and pk.nbases=1 then 'legacy_link_uncorroborated'
      when pk.rid is not null then null
      when p.gatefail>0 then 'type_gate_fail'
      when p.untied>0 then 'vehicle_not_tied_to_payer'
      when b.scope_type in ('personal','org','income_1099_NEC') then 'non_vehicle_scope_no_identifier'
      else 'no_identifier' end hold_reason,
    (select jsonb_agg(jsonb_build_object('vehicle',vid,'basis',basis,'tie',tie,'type_gate',gate)) from _rcg g where g.rid=b.id) cands
  from _rb b left join per p on p.rid=b.id left join pick pk on pk.rid=b.id;

  update receipt_vehicle_links set retired_at=now() where retired_at is null and receipt_id in (select rid from _rc);
  insert into receipt_vehicle_links(receipt_id, vehicle_id, status, basis, basis_ref, confidence, hold_reason, run_id)
  select rid, case when status='linked' then vid end, status, case when status='linked' then basis end,
    case when status='linked' then ref || jsonb_build_object('bases_agreeing',nbases) else coalesce(jsonb_build_object('candidates',cands),'{}') end,
    case when status='linked' then conf end, case when status='held' then coalesce(hold_reason,'ambiguous_multiple_vehicles') end, p_run
  from _rc;

  select jsonb_object_agg(k, c) into res from (
    select status||':'||coalesce(basis::text, hold_reason) k, count(*) c from receipt_vehicle_links where run_id=p_run and retired_at is null and (p_receipt is null or receipt_id=p_receipt) group by 1) z;
  return res;
end $$;


drop function if exists public.receipt_vehicle_links_refresh(text);
create or replace function public.receipt_vehicle_links_refresh(p_run text) returns jsonb language sql as $$ select public.receipt_vehicle_links_refresh(p_run, null::uuid) $$;

-- writer entry point: payer (or service role) links one receipt; gates still enforced by trigger
create or replace function public.receipt_link_one(p_receipt uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r receipts; a jsonb; b jsonb;
begin
  select * into r from receipts where id=p_receipt;
  if r.id is null then raise exception 'receipt % not found', p_receipt; end if;
  if coalesce(auth.role(),'') <> 'service_role' and r.user_id is distinct from auth.uid() then
    raise exception 'not allowed to link receipt %', p_receipt using errcode='42501'; end if;
  a := receipt_vehicle_links_refresh('writer_'||to_char(now(),'YYYYMMDD'), p_receipt);
  b := receipt_queue_resolve('writer_q_'||to_char(now(),'YYYYMMDD'), p_receipt);
  return (select to_jsonb(l) - 'basis_ref' || jsonb_build_object('basis_ref',l.basis_ref) from receipt_vehicle_links l where l.receipt_id=p_receipt and l.retired_at is null);
end $$;
revoke all on function public.receipt_link_one(uuid) from public, anon;
grant execute on function public.receipt_link_one(uuid) to authenticated, service_role;
revoke all on function public.receipt_vehicle_links_refresh(text, uuid) from public, anon, authenticated;
revoke all on function public.receipt_queue_resolve(text, uuid) from public, anon, authenticated;

create or replace view public.vehicle_receipts with (security_invoker = true) as
select l.receipt_id as id, l.receipt_id, l.vehicle_id, r.user_id,
  coalesce(r.total_amount, r.total) as total_amount, r.vendor_name,
  l.page_date as receipt_date, l.page_date_source,
  (select jsonb_agg(jsonb_build_object('description',i.description,'part_number',i.part_number,'category',i.category,'quantity',i.quantity,'unit_price',i.unit_price,'total_price',i.total_price))
     from public.receipt_items i where i.receipt_id=l.receipt_id) as items,
  l.basis as link_basis, l.basis_ref, l.confidence, l.tie_kind, l.type_gate, l.run_id,
  coalesce((l.basis_ref->>'provisional')::boolean,false) as provisional,
  r.file_url, r.created_at
from public.receipt_vehicle_links l join public.receipts r on r.id=l.receipt_id
where l.status='linked' and l.retired_at is null;
