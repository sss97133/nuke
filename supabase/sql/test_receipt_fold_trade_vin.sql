-- Contract for 20261122001500_receipt_fold_trade_vin (empty disposable database; tables stubbed with the columns the fold
-- reads, the fold and its helpers pasted from the live definitions read 2026-11-21, the migration applied with \ir, twice).
-- Asserts:
--   * the pasted fold is the live one the migration was fingerprinted on (md5), and before the migration a build agreement
--     that prints the subject's VIN and a trade-in's VIN (both vehicles tied to the custodian) is held as ambiguous;
--   * after it, the same paper links to its subject when the trade-in's VIN sits on a line whose category names a trade or
--     payment role, and the link records the trade vehicle in basis_ref.consideration_vehicles; the trade vehicle gets no link;
--   * the roles must come from structure: the VIN only in free text (notes), also on an untagged line, or named as the subject
--     (vehicle_hint) leaves the paper held exactly as before; with no other strong candidate nothing changes;
--   * receipt_line_consideration_role reads the role words only at the start of the category;
--   * a second run of the migration changes nothing.
DO $$ BEGIN
  IF to_regclass('public.receipts') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;

-- live enum and the columns the fold reads (2026-11-21)
CREATE TYPE public.receipt_vehicle_link_basis AS ENUM ('vin_exact', 'cited_document', 'vehicle_hint', 'legacy_vehicle_id', 'user_tie_signal');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, year int, make text, model text, deleted_at timestamptz, status text,
  owner_id uuid, user_id uuid, uploaded_by uuid);
CREATE TABLE public.receipts (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, scope_type text, raw_extraction jsonb, raw_json jsonb,
  is_superseded boolean, is_active boolean, source_document_table text, source_document_id uuid);
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, category text);
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.ownership_verifications (vehicle_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid, user_id uuid, is_active boolean, role text);
CREATE TABLE public.user_vehicle_links (vehicle_id uuid, user_id uuid, link_type text);
CREATE TABLE public.vehicle_user_relationships (vehicle_id uuid, user_id uuid, role text);
CREATE TABLE public.receipt_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid, user_id uuid,
  status text, basis text, basis_ref jsonb, confidence numeric, hold_reason text, tie_kind text, type_gate text, page_date date,
  page_date_source text, run_id text, created_at timestamptz DEFAULT now(), retired_at timestamptz);
-- the type gate reads document signals this contract does not model: every pair passes
CREATE FUNCTION public.receipt_type_gate(p_receipt uuid, p_vehicle uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'pass'::text $$;

-- live definitions, pasted as read (2026-11-21)
CREATE OR REPLACE FUNCTION public.receipt_vin_check_ok(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.receipt_tie_weight(p_tie text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_tie is null then 0
    when p_tie in ('vehicles.owner_id','ownership_verifications:approved','vehicle_user_permissions:owner','vehicle_user_permissions:co_owner','user_vehicle_links:owner') then 1.0
    when p_tie='vehicles.user_id' then 0.95
    when p_tie like 'vehicle_user_permissions:contributor' then 0.8
    else 0.85 end $function$
;
CREATE OR REPLACE FUNCTION public.receipt_user_vehicle_tie(p_user uuid, p_vehicle uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
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
  ) t order by r limit 1 $function$
;
CREATE OR REPLACE FUNCTION public.receipt_vehicle_links_refresh(p_run text, p_receipt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
end $function$
;

SELECT public.assert(md5(pg_get_functiondef('public.receipt_vehicle_links_refresh(text,uuid)'::regprocedure)) = 'da6c69ef750ec54ac8ebbc5168d3b56a', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'the pasted fold is the live definition the migration was fingerprinted on');

-- fixtures: one custodian tied to the build truck (mechanic) and to the trade-in (approved ownership), a third car of the same make
\set u '''11111111-1111-4111-8111-111111111111'''
\set s '''22222222-2222-4222-8222-222222222222'''
\set t '''33333333-3333-4333-8333-333333333333'''
\set doc '''44444444-4444-4444-8444-444444444444'''
INSERT INTO public.vehicles (id, vin, year, make, model) VALUES
  (:s, '1GTEK14H6DJ501481', 1983, 'GMC', 'K1500'),
  (:t, '1GCEK14L9EJ147915', 1984, 'Chevrolet', 'K10 SWB');
INSERT INTO public.vehicle_user_relationships VALUES (:s, :u, 'mechanic');
INSERT INTO public.ownership_verifications VALUES (:t, :u, 'approved');
INSERT INTO public.vehicle_documents VALUES (:doc, :s);
SELECT public.assert(public.receipt_vin_check_ok('1GTEK14H6DJ501481') AND public.receipt_vin_check_ok('1GCEK14L9EJ147915'), 'both fixture VINs pass the check digit');

-- an agreement as land_document_pages writes it: subject VIN in vehicle_hint, notes, and each line's description in
-- raw_extraction.data.line_items (the text the fold scans) with its category on receipt_items
CREATE FUNCTION public.mk(p_id uuid, p_hint text, p_notes text, p_cited boolean, p_lines jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.receipts (id, user_id, scope_type, raw_extraction, raw_json, is_superseded, is_active, source_document_table, source_document_id)
  VALUES (p_id, '11111111-1111-4111-8111-111111111111', 'vehicle',
    jsonb_build_object('data', jsonb_build_object('document_type', 'agreement', 'vehicle_hint', p_hint, 'notes', p_notes,
      'line_items', (SELECT coalesce(jsonb_agg(jsonb_build_object('description', l->>'d')), '[]') FROM jsonb_array_elements(p_lines) l))),
    jsonb_build_object('data_v2', jsonb_build_object('document_type', 'agreement', 'vehicle_hint', p_hint)), false, true,
    CASE WHEN p_cited THEN 'vehicle_documents' END, CASE WHEN p_cited THEN '44444444-4444-4444-8444-444444444444'::uuid END);
  INSERT INTO public.receipt_items (receipt_id, description, category) SELECT p_id, l->>'d', l->>'c' FROM jsonb_array_elements(p_lines) l;
$$;
CREATE FUNCTION public.link(p_id uuid) RETURNS public.receipt_vehicle_links LANGUAGE sql AS $$
  SELECT * FROM public.receipt_vehicle_links WHERE receipt_id = p_id AND retired_at IS NULL $$;

\set r1 '''a0000000-0000-4000-8000-000000000001'''
\set r2 '''a0000000-0000-4000-8000-000000000002'''
\set r3 '''a0000000-0000-4000-8000-000000000003'''
\set r4 '''a0000000-0000-4000-8000-000000000004'''
\set r5 '''a0000000-0000-4000-8000-000000000005'''
-- r1: trade VIN on a line tagged "trade" (and in the terms text)
SELECT public.mk(:r1, '1983 GMC HIGH SIERRA K2500 1GTEK14H6DJ501481', 'Client is providing 1985 k10 shortbed as payment. VIN : 1GCEK14L9EJ147915', true,
  '[{"d": "Paint · Remove grille · 10 min"}, {"d": "Trade · white truck 1GCEK14L9EJ147915", "c": "trade"}]');
-- r2: trade VIN only in free text: roles cannot be told apart
SELECT public.mk(:r2, '1983 GMC HIGH SIERRA K2500 1GTEK14H6DJ501481', 'Trade white truck 1GCEK14L9EJ147915', true,
  '[{"d": "Paint · Remove grille"}]');
-- r3: trade VIN on a tagged line and on an untagged line
SELECT public.mk(:r3, '1983 GMC HIGH SIERRA K2500 1GTEK14H6DJ501481', NULL, true,
  '[{"d": "Trade · 1GCEK14L9EJ147915", "c": "trade"}, {"d": "Inspect 1GCEK14L9EJ147915 frame"}]');
-- r4: the tagged VIN is also the subject the paper names
SELECT public.mk(:r4, '1984 Chevrolet K10 1GCEK14L9EJ147915', NULL, true,
  '[{"d": "Payment · 1GCEK14L9EJ147915", "c": "payment"}]');
-- r5: a tagged VIN and no other strong candidate (no filed document, no subject VIN)
SELECT public.mk(:r5, 'pickup truck', NULL, false,
  '[{"d": "Trade · 1GCEK14L9EJ147915", "c": "trade-in"}]');

-- before: the live fold holds the agreement as ambiguous (the case this migration answers)
SELECT public.receipt_vehicle_links_refresh('before', :r1);
SELECT public.assert((public.link(:r1)).status = 'held' AND (public.link(:r1)).hold_reason = 'ambiguous_multiple_vehicles',
  'before the migration the agreement is held as ambiguous');

\ir ../migrations/20261122001500_receipt_fold_trade_vin.sql
SELECT md5(pg_get_functiondef('public.receipt_vehicle_links_refresh(text,uuid)'::regprocedure)) AS after_md5 \gset
\ir ../migrations/20261122001500_receipt_fold_trade_vin.sql
SELECT public.assert(md5(pg_get_functiondef('public.receipt_vehicle_links_refresh(text,uuid)'::regprocedure)) = :'after_md5',
  'a second run of the migration changes nothing');

SELECT public.assert(public.receipt_line_consideration_role('trade') AND public.receipt_line_consideration_role('Trade-in')
  AND public.receipt_line_consideration_role('trade in') AND public.receipt_line_consideration_role('payment')
  AND public.receipt_line_consideration_role('In exchange') AND public.receipt_line_consideration_role(' consideration'),
  'role words at the start of the category are roles');
SELECT public.assert(NOT public.receipt_line_consideration_role('option A') AND NOT public.receipt_line_consideration_role('Paint')
  AND NOT public.receipt_line_consideration_role('tradesman labor') AND NOT public.receipt_line_consideration_role('down payment')
  AND NOT public.receipt_line_consideration_role(NULL), 'other categories, a longer word and a role word later in the text are not roles');

-- after
SELECT public.receipt_vehicle_links_refresh('after', NULL);
SELECT public.assert((public.link(:r1)).status = 'linked' AND (public.link(:r1)).vehicle_id = :s,
  'the agreement links to its subject when the trade VIN sits on a trade line');
SELECT public.assert((public.link(:r1)).basis_ref->'consideration_vehicles' = jsonb_build_array(jsonb_build_object(
  'vehicle', :t, 'vin', '1GCEK14L9EJ147915', 'role', 'trade', 'rule', '20261122001500')), 'the link records the trade vehicle');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_vehicle_links WHERE receipt_id = :r1 AND retired_at IS NULL AND vehicle_id = :t),
  'the trade vehicle gets no link');
SELECT public.assert((public.link(:r2)).status = 'held' AND (public.link(:r2)).hold_reason = 'ambiguous_multiple_vehicles'
  AND NOT (public.link(:r2)).basis_ref ? 'consideration_vehicles', 'free text alone leaves the paper held as before');
SELECT public.assert((public.link(:r3)).status = 'held' AND (public.link(:r3)).hold_reason = 'ambiguous_multiple_vehicles',
  'a VIN also on an untagged line leaves the paper held');
SELECT public.assert((public.link(:r4)).status = 'held' AND (public.link(:r4)).hold_reason = 'ambiguous_multiple_vehicles',
  'a tagged VIN that the paper names as its subject leaves the paper held');
SELECT public.assert((public.link(:r5)).status = 'linked' AND (public.link(:r5)).vehicle_id = :t
  AND (public.link(:r5)).basis = 'vin_exact' AND NOT (public.link(:r5)).basis_ref ? 'consideration_vehicles',
  'with no other strong candidate nothing changes');
SELECT public.assert((SELECT count(*) FROM public.receipt_vehicle_links WHERE retired_at IS NULL) = 5, 'one current link per receipt');

\echo 'test_receipt_fold_trade_vin: all assertions passed'
