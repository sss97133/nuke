-- receipt_itemise_retained (migration 20261124203000): a linked receipt's lines held in its own stored reading are
-- itemised into receipt_items by rule rows (receipt_line_sources), once, with the decision recorded per receipt, and
-- the receipts triggers live in production (amount check, document kind, duplicate flag, implausible hold, kind link
-- retirement; definitions copied from production 2026-11-24) leave every vehicle link as it was.
-- Applied with \ir, twice (idempotent). Cases:
--   A what.items (key map part_number/oem_number) itemised, amounts reconcile -> amount_check verified, link kept.
--   B regex-OCR data.line_items that do not reconcile -> held_unreconciled, 0 lines.
--   C regex-OCR data.line_items that reconcile -> itemised from that source.
--   D raw_json.data_v2 with sku/qty/amount keys -> mapped to part_number/quantity/total_price.
--   E a line carrying an e-mail address -> refused_private_text, 0 lines.
--   F lines that would make the total implausible -> held_would_contradict_total, link kept, amount_check unchanged.
--   G no lines anywhere -> no_lines_held; a re-read (raw changes) reopens it and itemises.
--   H already itemised by its writer -> untouched; I held link only -> untouched; J superseded -> untouched.
--   K both what.items and data.line_items -> the higher-priority source wins.
--   L an items rule moves an unknown receipt to parts_service; its link stays.
--   M two readings of one file (upload prefix differs), both with lines -> the earlier is itemised, the later is
--     held_same_file_sibling with the sibling's id; N a reading of a file whose other reading already has lines -> held;
--     superseding M's itemised reading reopens the held one, which is then itemised.
--   anon/authenticated cannot execute the fold or read the tables; a second run itemises nothing new.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_itemise_retained%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_itemise_retained* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service','vehicle_transaction','government_fee','fuel','insurance_document','tax_form','financial_statement','letter_notice','personal_purchase','unknown','vehicle_sale','shipping','general_merchandise','quote');
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked','verified','plausible','implausible','no_amount');
CREATE TABLE public.receipts(id uuid PRIMARY KEY, user_id uuid, created_by uuid, vendor_name text, file_name text, file_url text,
  total numeric, total_amount numeric, subtotal numeric, tax numeric, tax_amount numeric, raw_extraction jsonb, raw_json jsonb,
  is_superseded boolean DEFAULT false, superseded_at timestamptz, superseded_reason text, duplicate_of uuid, duplicate_reason text, content_key text,
  amount_check public.receipt_amount_check, amount_check_reasons jsonb, amount_checked_at timestamptz, amount_check_run_id text,
  document_kind public.receipt_doc_kind, document_kind_rule text, document_kind_citation jsonb, document_kind_classified_at timestamptz, document_kind_run_id text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE,
  line_number int, description text, part_number text, vendor_sku text, category text, quantity numeric, unit_price numeric, total_price numeric,
  created_at timestamptz DEFAULT now(), line_date date, hours numeric, performer text);
CREATE TABLE public.line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, total_price numeric, discount numeric);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id), vehicle_id uuid, user_id uuid,
  status text CHECK (status IN ('linked','held')), basis text, basis_ref jsonb, confidence numeric, hold_reason text, run_id text,
  created_at timestamptz DEFAULT now(), retired_at timestamptz);
CREATE TABLE public.receipt_document_kind_rules(rule_id text PRIMARY KEY, priority int, kind public.receipt_doc_kind, field text, pattern text, note text,
  created_at timestamptz DEFAULT now(), amount_min numeric, amount_max numeric);
CREATE TABLE public.receipt_vendor_specialties(id bigint PRIMARY KEY, vendor_slug text, vendor_pattern text, citation_url text);
INSERT INTO public.receipt_document_kind_rules(rule_id, priority, kind, field, pattern, note) VALUES
  ('test_items_brake', 10, 'parts_service', 'items', 'brake (pad|rotor)', 'test rule: a brake line makes parts paper');

-- Production definitions, 2026-11-24 (pg_get_functiondef / pg_get_triggerdef).
CREATE OR REPLACE FUNCTION public.receipt_amount_check_compute(r receipts)
 RETURNS TABLE(status receipt_amount_check, reasons jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  a numeric := coalesce(r.total_amount, r.total);
  t numeric := coalesce(r.tax_amount, r.tax, 0);
  items numeric; n_items int; kind text; kmax numeric;
  vkey text; v_n int; v_max numeric; v_med numeric;
  why jsonb := '[]'::jsonb; facts jsonb;
begin
  if a is null or a = 0 then
    return query select 'no_amount'::public.receipt_amount_check, jsonb_build_object('amount', a); return;
  end if;
  select sum(i.total_price), count(*) into items, n_items from receipt_items i where i.receipt_id = r.id and i.total_price is not null;
  if coalesce(n_items,0) = 0 then
    select sum(li.total_price - coalesce(li.discount,0)), count(*) into items, n_items
      from line_items li where li.receipt_id = r.id and li.total_price is not null;
  end if;
  kind := public.receipt_document_kind(r.vendor_name, left(coalesce(r.raw_extraction::text, ''), 4000));
  kmax := public.receipt_kind_max(kind);
  vkey := nullif(lower(regexp_replace(coalesce(r.vendor_name,''), '[^a-zA-Z]', '', 'g')), '');
  if length(vkey) >= 4 then
    select count(*), max(abs(coalesce(o.total_amount,o.total))),
           percentile_cont(0.5) within group (order by abs(coalesce(o.total_amount,o.total)))
      into v_n, v_max, v_med
      from receipts o
     where o.id <> r.id and o.duplicate_of is null and coalesce(o.total_amount,o.total) <> 0
       and lower(regexp_replace(coalesce(o.vendor_name,''), '[^a-zA-Z]', '', 'g')) = vkey;
  end if;
  facts := jsonb_build_object('amount', a, 'tax', t, 'items_sum', items, 'items_n', coalesce(n_items,0),
    'subtotal', r.subtotal, 'kind', kind, 'kind_max', kmax, 'vendor_n', coalesce(v_n,0), 'vendor_max', v_max, 'vendor_median', v_med);

  -- 1. arithmetic against the document's own lines
  if coalesce(n_items,0) > 0 and abs(items + t - a) <= greatest(0.05, abs(a) * 0.01) then
    return query select 'verified'::public.receipt_amount_check, facts || jsonb_build_object('basis','items_plus_tax'); return;
  end if;
  if r.subtotal is not null and r.subtotal <> 0 and abs(r.subtotal + t - a) <= greatest(0.05, abs(a) * 0.01) then
    return query select 'verified'::public.receipt_amount_check, facts || jsonb_build_object('basis','subtotal_plus_tax'); return;
  end if;
  if coalesce(n_items,0) > 0 and items > 0 and abs(a) > 3 * (items + t) + 50 then
    why := why || to_jsonb('total far above line items plus tax'::text);
  end if;
  -- 2. receipt type
  if kind = 'non_receipt' then
    why := why || to_jsonb('document is not a purchase receipt'::text);
  elsif abs(a) > kmax then
    why := why || to_jsonb(format('above %s range of %s', kind, kmax));
  end if;
  -- 3. the vendor's own history
  if coalesce(v_n,0) >= 3 and abs(a) > 10 * v_max and abs(a) > 1000 then
    why := why || to_jsonb(format('above vendor range (max %s over %s receipts)', v_max, v_n));
  end if;
  if jsonb_array_length(why) > 0 then
    return query select 'implausible'::public.receipt_amount_check, facts || jsonb_build_object('why', why); return;
  end if;
  return query select 'plausible'::public.receipt_amount_check, facts; return;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipt_classify_document(p_vendor text, p_doctype text, p_text text, p_items text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare ru record; src text; m text; sp record;
begin
  for ru in select * from public.receipt_document_kind_rules order by priority, rule_id loop
    if ru.amount_min is not null and coalesce(p_amount,0) < ru.amount_min then continue; end if;
    if ru.amount_max is not null and coalesce(p_amount,0) > ru.amount_max then continue; end if;
    if ru.field = 'specialty' then
      select s.vendor_slug, s.vendor_pattern, s.citation_url into sp from public.receipt_vendor_specialties s
       where (coalesce(p_vendor,'') || ' ' || coalesce(p_text,'')) ~* s.vendor_pattern order by s.id limit 1;
      if found then
        return jsonb_build_object('kind', ru.kind, 'rule_id', ru.rule_id, 'field', ru.field, 'pattern', sp.vendor_pattern,
          'match', sp.vendor_slug, 'citation_url', sp.citation_url);
      end if;
      continue;
    end if;
    src := case ru.field when 'vendor' then coalesce(p_vendor,'') when 'doctype' then coalesce(p_doctype,'')
                         when 'items' then coalesce(p_items,'') else coalesce(p_text,'') end;
    m := substring(src from ('(?i)' || ru.pattern));
    if src ~* ru.pattern then
      return jsonb_build_object('kind', ru.kind, 'rule_id', ru.rule_id, 'field', ru.field, 'pattern', ru.pattern,
        'match', left(coalesce(m, ''), 120), 'amount_bounds', case when ru.amount_min is not null or ru.amount_max is not null then jsonb_build_object('min', ru.amount_min, 'max', ru.amount_max, 'amount', p_amount) end);
    end if;
  end loop;
  return jsonb_build_object('kind','unknown','rule_id',null);
end $function$
;

CREATE OR REPLACE FUNCTION public.receipt_content_key(p_user uuid, p_vendor text, p_amount numeric, p_file text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when coalesce(regexp_replace(coalesce(p_file,''),'^[0-9]{10,}_',''),'') = '' then null
    else md5(coalesce(p_user::text,'') || '|' || lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'))
             || '|' || coalesce(p_amount::text,'') || '|' || regexp_replace(p_file,'^[0-9]{10,}_','')) end
$function$
;

CREATE OR REPLACE FUNCTION public.receipt_doc_items(p_id uuid, p_rx jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select left(coalesce(string_agg(d, ' | '), ''), 2000) from (
    select description d from public.receipt_items where receipt_id = p_id
    union all select description from public.line_items where receipt_id = p_id
    union all select x->>'description' from jsonb_array_elements(case when jsonb_typeof(p_rx #> '{data,line_items}') = 'array' then p_rx #> '{data,line_items}' else '[]'::jsonb end) x
  ) q where d is not null
$function$
;

CREATE OR REPLACE FUNCTION public.receipt_doc_kind_excluded(k receipt_doc_kind)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(k::text in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase','vehicle_sale'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.receipt_doc_text(p_rx jsonb, p_rj jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select left(regexp_replace(coalesce(p_rx #>> '{ocr,full_text}', p_rx ->> 'raw_text', p_rx #>> '{what,raw_text}', p_rj #>> '{ocr,full_text}', ''), '\s+', ' ', 'g'), 400)
$function$
;

CREATE OR REPLACE FUNCTION public.receipt_document_kind(p_vendor text, p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when coalesce(p_vendor,'')||' '||coalesce(p_text,'') ~* '(certificate shows registered ownership|evidence of insurance card|^\*+important\*+)'
      then 'non_receipt'
    when p_vendor ~* '(bring a trailer|consign|automotive group|truck center|motors\b|auto sales|dealer|bill of sale|wire|funds transfer|check amount)'
      then 'vehicle_transaction'
    when p_vendor ~* '(dmv|state of ?n ?evada|state of [a-z]+|department of motor|county|tax collector|registration)'
      then 'government_fee'
    when p_vendor ~* '(insurance|bristol west|geico|progressive|state farm|hagerty|allstate)'
      then 'insurance'
    else 'parts_service'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.receipt_items_recheck_amount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare rid uuid := coalesce(new.receipt_id, old.receipt_id);
begin
  update receipts set total = total where id = rid;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipt_kind_max(p_kind text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_kind
    when 'vehicle_transaction' then 500000
    when 'government_fee' then 5000
    when 'insurance' then 15000
    when 'non_receipt' then 0
    else 100000 end::numeric
$function$
;

CREATE OR REPLACE FUNCTION public.receipts_document_kind_links()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare run text := coalesce(new.document_kind_run_id, 'document_kind_trigger');
begin
  if public.receipt_doc_kind_excluded(new.document_kind) and not public.receipt_doc_kind_excluded(old.document_kind) then
    update public.receipt_vehicle_links l
       set retired_at = now(),
           basis_ref = coalesce(l.basis_ref,'{}'::jsonb) || jsonb_build_object('excluded_document_kind', new.document_kind, 'rule', new.document_kind_rule, 'run_id', run)
     where l.receipt_id = new.id and l.retired_at is null;
  end if;
  if new.duplicate_of is not null and old.duplicate_of is null then
    with ret as (
      update public.receipt_vehicle_links l set retired_at = now()
       where l.receipt_id = new.id and l.status = 'linked' and l.retired_at is null returning l.*)
    insert into public.receipt_vehicle_links (id, receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, hold_reason, run_id)
    select gen_random_uuid(), ret.receipt_id, ret.vehicle_id, ret.user_id, 'held', ret.basis,
           coalesce(ret.basis_ref,'{}'::jsonb) || jsonb_build_object('duplicate_hold', jsonb_build_object('prev_link_id', ret.id, 'duplicate_of', new.duplicate_of)),
           ret.confidence, 'duplicate_of '||new.duplicate_of::text, 'duplicate_trigger'
      from ret;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipts_flag_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.content_key := public.receipt_content_key(new.user_id, new.vendor_name, coalesce(new.total_amount, new.total), new.file_name);
  if new.duplicate_of is null and new.content_key is not null then
    select r.id into new.duplicate_of from public.receipts r
     where r.content_key = new.content_key and r.id <> new.id and r.duplicate_of is null
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same user, vendor, amount and original file name');
    end if;
  end if;
  if new.duplicate_of is not null and coalesce(new.is_superseded,false) = false then
    -- superseded_by points at payment_events, so the canonical receipt id goes in superseded_reason instead
    new.is_superseded := true;
    new.superseded_at := coalesce(new.superseded_at, now()); new.superseded_reason := coalesce(new.superseded_reason, 'duplicate_of '||new.duplicate_of::text);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipts_hold_implausible_links()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.amount_check = 'implausible' and old.amount_check is distinct from 'implausible' then
    with ret as (
      update receipt_vehicle_links l set retired_at = now()
       where l.receipt_id = new.id and l.status = 'linked' and l.retired_at is null
      returning l.*)
    insert into receipt_vehicle_links (id, receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, hold_reason, run_id)
    select gen_random_uuid(), ret.receipt_id, ret.vehicle_id, ret.user_id, 'held', ret.basis,
           coalesce(ret.basis_ref,'{}'::jsonb) || jsonb_build_object('amount_hold', jsonb_build_object(
             'prev_link_id', ret.id, 'run_id', coalesce(new.amount_check_run_id, 'amount_check_trigger'), 'reasons', new.amount_check_reasons)),
           ret.confidence, 'amount_check implausible', coalesce(new.amount_check_run_id, 'amount_check_trigger')
      from ret;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipts_set_amount_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare c record;
begin
  select * into c from public.receipt_amount_check_compute(new);
  new.amount_check := c.status;
  new.amount_check_reasons := c.reasons;
  new.amount_checked_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.receipts_set_document_kind()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare c jsonb;
begin
  if coalesce(new.document_kind_rule,'') = 'manual' then return new; end if;
  c := public.receipt_classify_document(new.vendor_name,
         concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type',
                   new.raw_extraction #>> '{data,document_type}', new.raw_json #>> '{data_v2,document_type}'),
         public.receipt_doc_text(new.raw_extraction, new.raw_json),
         public.receipt_doc_items(new.id, new.raw_extraction),
         coalesce(new.total_amount, new.total));
  if new.document_kind is distinct from (c->>'kind')::public.receipt_doc_kind then
    new.document_kind := (c->>'kind')::public.receipt_doc_kind;
    new.document_kind_rule := c->>'rule_id';
    new.document_kind_citation := c;
    new.document_kind_classified_at := now();
    new.document_kind_run_id := 'document_kind_trigger';
  end if;
  return new;
end $function$
;
CREATE TRIGGER trg_receipt_items_recheck AFTER INSERT OR DELETE OR UPDATE ON public.receipt_items FOR EACH ROW EXECUTE FUNCTION receipt_items_recheck_amount();
CREATE TRIGGER trg_receipts_amount_check BEFORE INSERT OR UPDATE OF total_amount, total, subtotal, tax_amount, tax, vendor_name, raw_extraction ON public.receipts FOR EACH ROW EXECUTE FUNCTION receipts_set_amount_check();
CREATE TRIGGER trg_receipts_document_kind BEFORE INSERT OR UPDATE OF vendor_name, raw_extraction, raw_json, total_amount, total ON public.receipts FOR EACH ROW EXECUTE FUNCTION receipts_set_document_kind();
CREATE TRIGGER trg_receipts_document_kind_links AFTER UPDATE OF document_kind, duplicate_of ON public.receipts FOR EACH ROW EXECUTE FUNCTION receipts_document_kind_links();
CREATE TRIGGER trg_receipts_flag_duplicate BEFORE INSERT OR UPDATE OF user_id, vendor_name, total_amount, total, file_name, duplicate_of ON public.receipts FOR EACH ROW EXECUTE FUNCTION receipts_flag_duplicate();
CREATE TRIGGER trg_receipts_hold_implausible AFTER UPDATE OF amount_check ON public.receipts FOR EACH ROW EXECUTE FUNCTION receipts_hold_implausible_links();

-- Fixtures. u = custodian, v = vehicle.
\set u '''00000000-0000-4000-8000-0000000000aa'''
\set v '''00000000-0000-4000-8000-0000000000bb'''
INSERT INTO public.receipts(id, user_id, vendor_name, file_name, total_amount, tax_amount, subtotal, raw_extraction, raw_json, is_superseded, created_at) VALUES
 ('00000000-0000-4000-8000-00000000000a', :u, 'Parts Co', 'a.jpg', 33.00, 3.00, 30.00,
   '{"who":{},"what":{"items":[{"description":"brake pad set","part_number":null,"oem_number":"OEM-1","quantity":1,"unit_price":20,"total_price":20,"labor_hours":4},{"description":"rotor","part_number":"R-2","quantity":1,"unit_price":10,"total_price":10}]}}', NULL, false, '2026-01-01'),
 ('00000000-0000-4000-8000-00000000000b', :u, 'Shop B', 'b.jpg', 100.00, 0, NULL,
   '{"engine":"macos_vision_ocr+regex","data":{"line_items":[{"description":"GARBLED 1","total_price":5},{"description":"GARBLED 2","total_price":7}]}}', NULL, false, '2026-01-02'),
 ('00000000-0000-4000-8000-00000000000c', :u, 'Shop C', 'c.jpg', 12.00, 0, NULL,
   '{"engine":"macos_vision_ocr+regex","data":{"line_items":[{"description":"bolt","total_price":5},{"description":"nut","total_price":7}]}}', NULL, false, '2026-01-03'),
 ('00000000-0000-4000-8000-00000000000d', :u, 'Shop D', 'd.jpg', 15.00, 0, NULL,
   '{"engine":"macos_vision_ocr+regex","data":{"line_items":[]}}', '{"data_v2":{"line_items":[{"description":"hose","sku":"SKU-9","qty":"3","amount":"15.00","category":"cooling"}]}}', false, '2026-01-04'),
 ('00000000-0000-4000-8000-00000000000e', :u, 'Shop E', 'e.jpg', 9.00, 0, NULL,
   '{"items":[{"description":"ship to someone@example.com","total_price":9}]}', NULL, false, '2026-01-05'),
 ('00000000-0000-4000-8000-00000000000f', :u, 'Shop F', 'f.jpg', 5000.00, 0, NULL,
   '{"items":[{"description":"one small part","total_price":10}]}', NULL, false, '2026-01-06'),
 ('00000000-0000-4000-8000-000000000010', :u, 'Shop G', 'g.jpg', 40.00, 0, NULL,
   '{"who":{},"what":{"summary":"no lines"}}', NULL, false, '2026-01-07'),
 ('00000000-0000-4000-8000-000000000011', :u, 'Shop H', 'h.jpg', 8.00, 0, NULL,
   '{"items":[{"description":"retained copy","total_price":8}]}', NULL, false, '2026-01-08'),
 ('00000000-0000-4000-8000-000000000012', :u, 'Shop I', 'i.jpg', 8.00, 0, NULL,
   '{"items":[{"description":"held receipt line","total_price":8}]}', NULL, false, '2026-01-09'),
 ('00000000-0000-4000-8000-000000000013', :u, 'Shop J', 'j.jpg', 8.00, 0, NULL,
   '{"items":[{"description":"superseded line","total_price":8}]}', NULL, true, '2026-01-10'),
 ('00000000-0000-4000-8000-000000000014', :u, 'Shop K', 'k.jpg', 20.00, 0, NULL,
   '{"what":{"items":[{"description":"what line","total_price":20}]},"data":{"line_items":[{"description":"data line","total_price":20}]}}', NULL, false, '2026-01-11'),
 ('00000000-0000-4000-8000-000000000015', :u, 'Shop M', '1760000000_m.jpg', 30.00, 0, NULL,
   '{"items":[{"description":"m first reading","total_price":30}]}', NULL, false, '2026-01-12'),
 ('00000000-0000-4000-8000-000000000016', :u, 'Shop M.', '1760009999_m.jpg', 31.00, 0, NULL,
   '{"items":[{"description":"m second reading","total_price":31}]}', NULL, false, '2026-01-13'),
 ('00000000-0000-4000-8000-000000000017', :u, 'Shop H2', 'h.jpg', 9.00, 0, NULL,
   '{"items":[{"description":"another reading of h","total_price":9}]}', NULL, false, '2026-01-14');
INSERT INTO public.receipt_items(receipt_id, line_number, description, total_price) VALUES ('00000000-0000-4000-8000-000000000011', 1, 'written by the landing writer', 8);
INSERT INTO public.receipt_vehicle_links(receipt_id, vehicle_id, user_id, status, basis)
SELECT id, :v, :u, CASE WHEN id = '00000000-0000-4000-8000-000000000012' THEN 'held' ELSE 'linked' END, 'cited_document' FROM public.receipts;

CREATE TEMP TABLE before_state AS
SELECT r.id, r.document_kind, r.amount_check,
  (SELECT count(*) FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL) linked
FROM public.receipts r;
DO $$ BEGIN
  IF (SELECT document_kind FROM public.receipts WHERE id = '00000000-0000-4000-8000-00000000000a') <> 'unknown' THEN
    RAISE EXCEPTION 'fixture A should start unknown (its lines are not yet items)';
  END IF;
END $$;

\ir ../migrations/20261124203000_receipt_itemise_retained_lines.sql
\ir ../migrations/20261124203000_receipt_itemise_retained_lines.sql

DO $$
DECLARE n int; o text; rec record;
BEGIN
  -- A
  SELECT count(*) INTO n FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000a' AND line_source = 'raw_extraction.what.items';
  IF n <> 2 THEN RAISE EXCEPTION 'A: expected 2 lines from what.items, got %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000a' AND line_number = 1 AND part_number = 'OEM-1' AND total_price = 20 AND hours IS NULL) THEN
    RAISE EXCEPTION 'A: key map (oem_number -> part_number) or hours policy wrong';
  END IF;
  IF (SELECT amount_check FROM public.receipts WHERE id = '00000000-0000-4000-8000-00000000000a') <> 'verified' THEN RAISE EXCEPTION 'A: amount_check should be verified by its lines'; END IF;
  -- L (A also carries the brake rule)
  IF (SELECT document_kind FROM public.receipts WHERE id = '00000000-0000-4000-8000-00000000000a') <> 'parts_service' THEN RAISE EXCEPTION 'L: kind should move to parts_service'; END IF;
  -- B
  SELECT outcome INTO o FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-00000000000b';
  IF o IS DISTINCT FROM 'held_unreconciled' OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000b') THEN RAISE EXCEPTION 'B: got %', o; END IF;
  -- C
  IF (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000c' AND line_source = 'raw_extraction.data.line_items') <> 2 THEN RAISE EXCEPTION 'C: reconciled regex lines not itemised'; END IF;
  -- D
  IF NOT EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000d' AND part_number = 'SKU-9' AND quantity = 3 AND total_price = 15 AND category = 'cooling' AND line_source = 'raw_json.data_v2.line_items') THEN
    RAISE EXCEPTION 'D: data_v2 key map wrong';
  END IF;
  -- E
  SELECT outcome INTO o FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-00000000000e';
  IF o IS DISTINCT FROM 'refused_private_text' OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000e') THEN RAISE EXCEPTION 'E: got %', o; END IF;
  -- F
  SELECT outcome INTO o FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-00000000000f';
  IF o IS DISTINCT FROM 'held_would_contradict_total' OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-00000000000f') THEN RAISE EXCEPTION 'F: got %', o; END IF;
  IF (SELECT amount_check FROM public.receipts WHERE id = '00000000-0000-4000-8000-00000000000f') = 'implausible' THEN RAISE EXCEPTION 'F: amount_check must not become implausible'; END IF;
  -- G
  SELECT outcome INTO o FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000010';
  IF o IS DISTINCT FROM 'no_lines_held' THEN RAISE EXCEPTION 'G: got %', o; END IF;
  -- H, I, J
  IF (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000011') <> 1
     OR EXISTS (SELECT 1 FROM public.receipt_itemisation_outcomes WHERE receipt_id IN ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013'))
     OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id IN ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013')) THEN
    RAISE EXCEPTION 'H/I/J: an out-of-scope receipt was touched';
  END IF;
  -- K
  IF (SELECT string_agg(description, ',') FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000014') <> 'what line' THEN RAISE EXCEPTION 'K: priority wrong'; END IF;
  -- M, N
  IF (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000015') <> 1 THEN RAISE EXCEPTION 'M: first reading not itemised'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000016' AND outcome = 'held_same_file_sibling'
                  AND sibling_receipt_id = '00000000-0000-4000-8000-000000000015' AND lines = 0)
     OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000016') THEN RAISE EXCEPTION 'M: second reading not held'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000017' AND outcome = 'held_same_file_sibling'
                  AND sibling_receipt_id = '00000000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'N: not held against the itemised reading'; END IF;
  -- Links: every receipt keeps exactly the linked links it had.
  FOR rec IN SELECT b.id, b.linked, (SELECT count(*) FROM public.receipt_vehicle_links l WHERE l.receipt_id = b.id AND l.status = 'linked' AND l.retired_at IS NULL) now_linked FROM before_state b LOOP
    IF rec.linked <> rec.now_linked THEN RAISE EXCEPTION 'links changed on %: % -> %', rec.id, rec.linked, rec.now_linked; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.receipts WHERE duplicate_of IS NOT NULL) THEN RAISE EXCEPTION 'a duplicate was flagged'; END IF;
  -- Applying twice inserted nothing twice.
  IF (SELECT count(*) FROM public.receipt_items) <> 1 + 2 + 2 + 1 + 1 + 1 THEN RAISE EXCEPTION 'unexpected line total %', (SELECT count(*) FROM public.receipt_items); END IF;
END $$;

-- A re-read reopens G; an unchanged reading is not reconsidered.
SET ROLE service_role;
SELECT public.receipt_itemise_retained(50, 'test-second-run') AS second_run \gset
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.receipt_items) <> 8 THEN RAISE EXCEPTION 'second run itemised again'; END IF;
END $$;
UPDATE public.receipts SET raw_extraction = '{"who":{},"what":{"items":[{"description":"re-read line","total_price":40}]}}' WHERE id = '00000000-0000-4000-8000-000000000010';
SET ROLE service_role;
SELECT public.receipt_itemise_retained(50, 'test-reread') AS reread \gset
RESET ROLE;
DO $$ BEGIN
  IF (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000010') <> 'itemised'
     OR (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'G: a re-read did not reopen the receipt';
  END IF;
END $$;

-- M's itemised reading is superseded: the held reading reopens and is itemised.
UPDATE public.receipts SET is_superseded = true WHERE id = '00000000-0000-4000-8000-000000000015';
SET ROLE service_role;
SELECT public.receipt_itemise_retained(50, 'test-sibling-reopen') AS reopen \gset
RESET ROLE;
DO $$ BEGIN
  IF (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000016') <> 'itemised'
     OR (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000016') <> 1 THEN
    RAISE EXCEPTION 'M: the held sibling did not reopen';
  END IF;
  IF (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000017') <> 'held_same_file_sibling' THEN
    RAISE EXCEPTION 'N: a hold whose sibling is still live reopened';
  END IF;
END $$;

-- Grants.
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.receipt_itemise_retained(integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.receipt_itemise_retained(integer,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.receipt_itemisation_outcomes', 'SELECT')
     OR has_table_privilege('anon', 'public.receipt_line_sources', 'SELECT') THEN
    RAISE EXCEPTION 'grants too wide';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.receipt_itemise_retained(integer,text)', 'EXECUTE') THEN RAISE EXCEPTION 'service role cannot run the fold'; END IF;
END $$;

-- Revert leaves the landing writer's lines and drops only what the migration added.
\ir revert_20261124203000_receipt_itemise_retained_lines.sql
DO $$ BEGIN
  IF to_regclass('public.receipt_itemisation_outcomes') IS NOT NULL OR to_regclass('public.receipt_line_sources') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'receipt_items' AND column_name = 'line_source')
     OR (SELECT count(*) FROM public.receipt_items) <> 1 OR to_regprocedure('public.receipt_itemise_sibling(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'revert incomplete';
  END IF;
END $$;
SELECT 'test_receipt_itemise_retained_lines: ok' AS result;
