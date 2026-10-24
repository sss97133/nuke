-- receipt_vehicle_links: typed, gated, cited links between receipts and vehicles.
-- Replaces the dead 4-column vehicle_receipts stub (0 rows) with a view over linked receipts.
-- Gates (enforced by trigger, not by convention):
--   1. tie gate: the paying user (receipts.user_id) must be tied to the vehicle
--   2. type gate: receipt make/model/class signals must not contradict the vehicle
--   3. date: page_date comes only from page-extracted fields, never upload/capture timestamps
-- Additive. Revert: supabase/rollbacks/20261027000000_receipt_vehicle_links_rollback.sql

do $$ begin
  create type public.receipt_vehicle_link_basis as enum
    ('vin_exact','cited_document','vehicle_hint','legacy_vehicle_id','user_tie_signal');
exception when duplicate_object then null; end $$;

create table if not exists public.receipt_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  user_id uuid,
  status text not null check (status in ('linked','held')),
  basis public.receipt_vehicle_link_basis,
  basis_ref jsonb not null default '{}'::jsonb,
  confidence numeric check (confidence between 0 and 1),
  hold_reason text,
  tie_kind text,
  type_gate text check (type_gate in ('pass','unknown','fail')),
  page_date date,
  page_date_source text,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint rvl_held_has_reason check (status <> 'held' or hold_reason is not null),
  constraint rvl_linked_complete check (status <> 'linked' or (vehicle_id is not null and basis is not null and confidence is not null and tie_kind is not null and type_gate in ('pass','unknown'))),
  constraint rvl_date_source check (page_date_source is null or page_date_source in
    ('data_v2.transaction_date','data.transaction_date','receipt_date','transaction_date','purchase_date'))
);
create unique index if not exists rvl_one_active_per_receipt on public.receipt_vehicle_links(receipt_id) where retired_at is null;
create index if not exists rvl_vehicle_linked on public.receipt_vehicle_links(vehicle_id) where retired_at is null and status='linked';
create index if not exists rvl_run on public.receipt_vehicle_links(run_id);
alter table public.receipt_vehicle_links enable row level security;
do $$ begin
  create policy rvl_owner_read on public.receipt_vehicle_links for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- VIN check digit (ISO 3779, 17-char only)
create or replace function public.receipt_vin_check_ok(p text) returns boolean
language plpgsql immutable as $$
declare v text := upper(p); w int[] := array[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  s int := 0; c text; n int; i int; r text;
begin
  if v is null or v !~ '^[A-HJ-NPR-Z0-9]{17}$' then return false; end if;
  if v ~ '(123456|000000|111111)$' then return false; end if;
  for i in 1..17 loop
    c := substr(v,i,1);
    n := case when c ~ '[0-9]' then c::int else
      position(c in 'ABCDEFGH') + case when position(c in 'ABCDEFGH')>0 then 0 else
        case when position(c in 'JKLMN')>0 then position(c in 'JKLMN') when c='P' then 7 when c='R' then 9
             when position(c in 'STUVWXYZ')>0 then position(c in 'STUVWXYZ')+1 else 0 end end end;
    s := s + n*w[i];
  end loop;
  r := case when s % 11 = 10 then 'X' else (s % 11)::text end;
  return substr(v,9,1) = r;
end $$;

-- strongest tie between a user and a vehicle (base tables only; null = no tie)
create or replace function public.receipt_user_vehicle_tie(p_user uuid, p_vehicle uuid) returns text
language sql stable as $$
  select k from (
    select 'vehicles.owner_id' k, 1 r from vehicles where id=p_vehicle and owner_id=p_user
    union all select 'ownership_verifications:approved',1 from ownership_verifications where vehicle_id=p_vehicle and user_id=p_user and status='approved'
    union all select 'vehicle_user_permissions:'||role,2 from vehicle_user_permissions where vehicle_id=p_vehicle and user_id=p_user and is_active and role in ('owner','co_owner')
    union all select 'user_vehicle_links:owner',2 from user_vehicle_links where vehicle_id=p_vehicle and user_id=p_user and link_type='owner'
    union all select 'vehicles.user_id',3 from vehicles where id=p_vehicle and user_id=p_user
    union all select 'vehicle_user_permissions:'||role,4 from vehicle_user_permissions where vehicle_id=p_vehicle and user_id=p_user and is_active and role in ('consigned','previously_owned')
    union all select 'ownership_verifications:'||status,4 from ownership_verifications where vehicle_id=p_vehicle and user_id=p_user and status='expired'
    union all select 'vehicle_user_relationships:'||role,5 from vehicle_user_relationships where vehicle_id=p_vehicle and user_id=p_user
    union all select 'vehicles.uploaded_by',5 from vehicles where id=p_vehicle and uploaded_by=p_user
    union all select 'vehicle_user_permissions:contributor',6 from vehicle_user_permissions where vehicle_id=p_vehicle and user_id=p_user and is_active and role='contributor'
  ) t order by r limit 1 $$;

create or replace function public.receipt_tie_weight(p_tie text) returns numeric language sql immutable as $$
  select case when p_tie is null then 0
    when p_tie in ('vehicles.owner_id','ownership_verifications:approved','vehicle_user_permissions:owner','vehicle_user_permissions:co_owner','user_vehicle_links:owner') then 1.0
    when p_tie='vehicles.user_id' then 0.95
    when p_tie like 'vehicle_user_permissions:contributor' then 0.8
    else 0.85 end $$;

-- page date: only extracted-from-page fields
create or replace function public.receipt_page_date(r public.receipts, out d date, out src text)
language plpgsql stable as $$
declare t text;
begin
  t := r.raw_json #>> '{data_v2,transaction_date}';
  if t ~ '^\d{4}-\d{2}-\d{2}' then d := left(t,10)::date; src := 'data_v2.transaction_date'; return; end if;
  t := r.raw_extraction #>> '{data,transaction_date}';
  if t ~ '^\d{4}-\d{2}-\d{2}' then d := left(t,10)::date; src := 'data.transaction_date'; return; end if;
  if r.receipt_date is not null then d := r.receipt_date; src := 'receipt_date';
  elsif r.transaction_date is not null then d := r.transaction_date; src := 'transaction_date';
  elsif r.purchase_date is not null then d := r.purchase_date; src := 'purchase_date'; end if;
  -- a "page" date equal to the capture day is not trusted as a page date
  if d is not null and r.upload_date is not null and d = (r.upload_date at time zone 'UTC')::date and src not like 'data%' then d := null; src := null; end if;
exception when others then d := null; src := null;
end $$;

-- vehicle-type signals from cited receipt fields (hint, vendor, line items, notes; not raw OCR noise)
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
    'car', (select t ~ '\m(mustang|cj pony|corvette|porsche|911|corvair|maxima|camaro)\M' from txt),
    'models', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['mustang','corvette','bronco','suburban','blazer','corvair','wrangler','maxima']) m where t ~ ('\m'||m||'\M') or (m='mustang' and t ~ 'cj pony'))
  ) $$;

create or replace function public.receipt_vehicle_class(v public.vehicles) returns text language sql immutable as $$
  select case when lower(concat_ws(' ',v.body_style,v.model)) ~ '(truck|pickup|suv|wagon|suburban|blazer|bronco|wrangler|\mk[0-9]|\mc[0-9]|\mr[0-9]|\mv[0-9]|lx|land|cruiser|jimmy|scout)' then 'truck'
    when v.body_style is null and v.model is null then 'unknown' else 'car' end $$;

create or replace function public.receipt_type_gate(p_receipt uuid, p_vehicle uuid) returns text
language plpgsql stable as $$
declare r receipts; v vehicles; s jsonb; fam text; cls text; pos boolean := false;
begin
  select * into r from receipts where id=p_receipt; select * into v from vehicles where id=p_vehicle;
  if r.id is null or v.id is null then return 'fail'; end if;
  s := receipt_type_signals(r); cls := receipt_vehicle_class(v);
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

-- enforcement: no linked row may bypass the gates, whoever writes it
create or replace function public.receipt_vehicle_links_enforce() returns trigger
language plpgsql as $$
declare r receipts; pd record;
begin
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
drop trigger if exists trg_rvl_enforce on public.receipt_vehicle_links;
create trigger trg_rvl_enforce before insert or update on public.receipt_vehicle_links
  for each row execute function public.receipt_vehicle_links_enforce();

-- linker: one active row per receipt; previous active rows retired, never deleted
create or replace function public.receipt_vehicle_links_refresh(p_run text) returns jsonb
language plpgsql as $$
declare res jsonb;
begin
  drop table if exists _rb, _rcand, _rcg, _rc;
  create temp table _rb on commit drop as
    select r.* from receipts r where coalesce(r.is_superseded,false)=false and coalesce(r.is_active,true);

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
    select status||':'||coalesce(basis::text, hold_reason) k, count(*) c from receipt_vehicle_links where run_id=p_run and retired_at is null group by 1) z;
  return res;
end $$;

-- retire the dead stub (0 rows) and replace with a view over gated links
do $$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='vehicle_receipts' and c.relkind='r') then
    if (select count(*) from public.vehicle_receipts) > 0 then raise exception 'vehicle_receipts stub not empty; aborting'; end if;
    alter table public.vehicle_receipts rename to retired_vehicle_receipts_stub_20261027;
  end if;
end $$;

create or replace view public.vehicle_receipts with (security_invoker = true) as
select l.receipt_id as id, l.receipt_id, l.vehicle_id, r.user_id,
  coalesce(r.total_amount, r.total) as total_amount, r.vendor_name,
  l.page_date as receipt_date, l.page_date_source,
  (select jsonb_agg(jsonb_build_object('description',i.description,'part_number',i.part_number,'category',i.category,'quantity',i.quantity,'unit_price',i.unit_price,'total_price',i.total_price))
     from public.receipt_items i where i.receipt_id=l.receipt_id) as items,
  l.basis as link_basis, l.basis_ref, l.confidence, l.tie_kind, l.type_gate, l.run_id,
  r.created_at
from public.receipt_vehicle_links l join public.receipts r on r.id=l.receipt_id
where l.status='linked' and l.retired_at is null;

comment on view public.vehicle_receipts is 'Gated receipt->vehicle links (receipt_vehicle_links). Replaces dead stub table, retired as retired_vehicle_receipts_stub_20261027.';
