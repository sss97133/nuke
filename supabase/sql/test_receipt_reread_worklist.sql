-- receipt_reread_worklist + receipt_record_reread (migration 20261124207000): a held receipt's own paper is re-read and
-- the reading is stored beside the old one; the itemise fold reopens it. Cases: L local original, regex lines that do not
-- add up (held_unreconciled) -> on the list as local; S stored file, no lines (no_lines_held) -> on the list as storage,
-- re-read with 2 lines that add up -> itemised from the reread source, off the list; O obs:// -> not on the list and
-- refused; a reading with a card number is refused; a second reread keeps the first in reread_history; grants; revert.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_reread%' OR to_regclass('public.receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_reread* database';
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

\ir ../migrations/20261124203000_receipt_itemise_retained_lines.sql
\set u '''00000000-0000-4000-8000-0000000000aa'''
\set v '''00000000-0000-4000-8000-0000000000bb'''
INSERT INTO public.receipts(id, user_id, vendor_name, file_name, file_url, total_amount, tax_amount, raw_extraction) VALUES
 ('00000000-0000-4000-8000-000000000001', :u, 'Shop L', 'IMG_1.json', 'file:///x/IMG_1.json', 100, 0, '{"engine":"macos_vision_ocr+regex","source_file":"/Users/x/RECEIPTS/IMG_1.jpeg","data":{"line_items":[{"description":"thing","total_price":7}]}}'),
 ('00000000-0000-4000-8000-000000000002', :u, 'Shop S', 'IMG_2.jpeg', 'https://p.supabase.co/storage/v1/object/public/vehicle-data/v/IMG_2.jpeg', 30, 0, '{}'),
 ('00000000-0000-4000-8000-000000000003', :u, 'Doc O', 'obs-doc', 'obs://00000000-0000-4000-8000-000000000099', 40, 0, '{}');
INSERT INTO public.receipt_vehicle_links(receipt_id, vehicle_id, user_id, status, basis) SELECT id, :v, user_id, 'linked', 'cited_document' FROM public.receipts;
SELECT public.receipt_itemise_retained(50, 'test-first') AS first_run \gset

\ir ../migrations/20261124207000_receipt_reread_worklist.sql
\ir ../migrations/20261124207000_receipt_reread_worklist.sql
CREATE TEMP TABLE rr(k text, v jsonb);

DO $$ BEGIN
  IF (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000001') <> 'held_unreconciled'
     OR (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000002') <> 'no_lines_held' THEN
    RAISE EXCEPTION 'fixtures: fold outcomes not as expected';
  END IF;
  IF (SELECT count(*) FROM public.receipt_reread_worklist) <> 2
     OR (SELECT source_kind || ' ' || source FROM public.receipt_reread_worklist WHERE receipt_id = '00000000-0000-4000-8000-000000000001') <> 'local /Users/x/RECEIPTS/IMG_1.jpeg'
     OR (SELECT source_kind FROM public.receipt_reread_worklist WHERE receipt_id = '00000000-0000-4000-8000-000000000002') <> 'storage' THEN
    RAISE EXCEPTION 'worklist wrong';
  END IF;
  IF (SELECT count(*) FROM public.receipt_line_sources WHERE source_key = 'raw_extraction.reread.line_items') <> 1 THEN RAISE EXCEPTION 'source row'; END IF;
END $$;

INSERT INTO rr SELECT 's2', public.receipt_record_reread('00000000-0000-4000-8000-000000000002', '{"document_type":"receipt","total":30,"line_items":[{"description":"part a","part_number":"A1","quantity":1,"amount":10},{"description":"part b","quantity":2,"unit_price":10,"amount":20}]}', 'claude-cli test subscription', 'storage');
INSERT INTO rr SELECT 's3', public.receipt_record_reread('00000000-0000-4000-8000-000000000003', '{"line_items":[]}', 'claude-cli test subscription', 'none');
INSERT INTO rr SELECT 's1bad', public.receipt_record_reread('00000000-0000-4000-8000-000000000001', '{"payment":"4111 1111 1111 1111","line_items":[]}', 'claude-cli test subscription', 'local');
INSERT INTO rr SELECT 's1a', public.receipt_record_reread('00000000-0000-4000-8000-000000000001', '{"line_items":[{"description":"thing","amount":7}]}', 'claude-cli test subscription', 'local');
DO $$ BEGIN
  IF NOT ((SELECT v FROM rr WHERE k='s2')->>'stored')::boolean OR ((SELECT v FROM rr WHERE k='s2')->>'lines')::int <> 2 THEN RAISE EXCEPTION 'S not stored: %', (SELECT v FROM rr WHERE k='s2'); END IF;
  IF ((SELECT v FROM rr WHERE k='s3')->>'reason') <> 'not_on_worklist' THEN RAISE EXCEPTION 'O not refused: %', (SELECT v FROM rr WHERE k='s3'); END IF;
  IF ((SELECT v FROM rr WHERE k='s1bad')->>'reason') <> 'refused_private_text' THEN RAISE EXCEPTION 'card number not refused: %', (SELECT v FROM rr WHERE k='s1bad'); END IF;
  IF NOT ((SELECT v FROM rr WHERE k='s1a')->>'stored')::boolean THEN RAISE EXCEPTION 'L not stored'; END IF;
  -- the old reading is intact beside the reread
  IF (SELECT raw_extraction->>'engine' FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001') <> 'macos_vision_ocr+regex'
     OR (SELECT raw_extraction #>> '{reread,prompt_version}' FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001') <> 'document-read-v1' THEN
    RAISE EXCEPTION 'old reading not kept';
  END IF;
  -- L leaves the list once re-read
  IF EXISTS (SELECT 1 FROM public.receipt_reread_worklist WHERE receipt_id IN ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')) THEN RAISE EXCEPTION 'reread rows still listed'; END IF;
END $$;
-- a second reread (prompt version bumped by a later reader) keeps the first in history: simulate by clearing the version mark
UPDATE public.receipts SET raw_extraction = jsonb_set(raw_extraction, '{reread,prompt_version}', '"document-read-v0"') WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO rr SELECT 's1b', public.receipt_record_reread('00000000-0000-4000-8000-000000000001', '{"line_items":[]}', 'claude-cli test subscription', 'local');
DO $$ BEGIN
  IF jsonb_array_length((SELECT raw_extraction->'reread_history' FROM public.receipts WHERE id = '00000000-0000-4000-8000-000000000001')) <> 1 THEN RAISE EXCEPTION 'history not kept'; END IF;
END $$;

SELECT public.receipt_itemise_retained(50, 'test-after-reread') AS after_run \gset
DO $$ BEGIN
  IF (SELECT outcome || ' ' || source_key || ' ' || lines FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000002') <> 'itemised raw_extraction.reread.line_items 2'
     OR (SELECT count(*) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000002' AND line_source = 'raw_extraction.reread.line_items') <> 2
     OR (SELECT sum(total_price) FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000002') <> 30 THEN
    RAISE EXCEPTION 'S not itemised from the reread: %', (SELECT row_to_json(o) FROM public.receipt_itemisation_outcomes o WHERE receipt_id = '00000000-0000-4000-8000-000000000002');
  END IF;
  -- an empty reread is not a usable source; the regex lines still do not add up, so the receipt stays held, and off the list
  IF (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000001') <> 'held_unreconciled'
     OR EXISTS (SELECT 1 FROM public.receipt_items WHERE receipt_id = '00000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.receipt_reread_worklist WHERE receipt_id = '00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'L: an empty reread should leave it held and off the list, got %', (SELECT outcome FROM public.receipt_itemisation_outcomes WHERE receipt_id = '00000000-0000-4000-8000-000000000001');
  END IF;
  IF has_function_privilege('anon', 'public.receipt_record_reread(uuid,jsonb,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.receipt_record_reread(uuid,jsonb,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.receipt_record_reread(uuid,jsonb,text,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.receipt_reread_worklist', 'SELECT') OR NOT has_table_privilege('service_role', 'public.receipt_reread_worklist', 'SELECT') THEN
    RAISE EXCEPTION 'grants';
  END IF;
END $$;

\ir revert_20261124207000_receipt_reread_worklist.sql
DO $$ BEGIN
  IF to_regclass('public.receipt_reread_worklist') IS NOT NULL OR to_regprocedure('public.receipt_record_reread(uuid,jsonb,text,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.receipt_line_sources WHERE source_key = 'raw_extraction.reread.line_items') THEN
    RAISE EXCEPTION 'revert incomplete';
  END IF;
END $$;
SELECT 'test_receipt_reread_worklist: ok' AS result;
