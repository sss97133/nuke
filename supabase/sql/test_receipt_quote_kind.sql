-- Contract for 20261121233000_receipt_quote_kind (empty disposable database; dependencies stubbed here, the migration
-- applied with \ir, twice). Asserts:
--   * every replaced definition is, before the migration, the live one it was read from (md5), so the fixture is real;
--   * a document typed estimate/quote/agreement (top-level or nested, as land_document_pages writes it) classifies 'quote',
--     ahead of the parts-vendor rule; a paid invoice that prints "Org. Estimate" in its text does not;
--   * a quote stays linkable (receipt_doc_kind_excluded is unchanged) and is in no spend reader: receipt_work_lines,
--     vehicle_build_reconstruction totals, get_vehicle_total_invested, vehicle_receipts, vehicle_receipts_rollup_v;
--   * vehicle_build_reconstruction states quotes on their own: options separately and never added, the accepted option when
--     one is marked, no amount when several stand, no sum across quote documents, amounts only for a tied viewer;
--   * every spend reader carries the predicate where it was read, and a second run changes nothing.
DO $$ BEGIN
  IF to_regclass('public.receipts') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;

-- live enum labels and the columns the readers name, with their live types (2026-11-21)
CREATE TYPE public.receipt_amount_check AS ENUM ('unchecked', 'verified', 'plausible', 'implausible', 'no_amount');
CREATE TYPE public.observation_kind AS ENUM ('ownership', 'valuation');  -- the two labels the views name
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service', 'vehicle_transaction', 'government_fee', 'fuel', 'insurance_document', 'tax_form', 'financial_statement', 'letter_notice', 'personal_purchase', 'unknown', 'vehicle_sale', 'shipping', 'general_merchandise');
CREATE TABLE public.line_items (id uuid, receipt_id uuid, user_id uuid, part_number text, description text, quantity numeric(10,2), unit_price numeric(10,2), total_price numeric(10,2), category text, transaction_date date, created_at timestamp with time zone);
CREATE TABLE public.payment_events (id uuid, user_id uuid, direction text, amount_usd numeric(14,2), paid_at timestamp with time zone, scope_type text, scope_id uuid, description text, created_at timestamp with time zone, is_superseded boolean, superseded_at timestamp with time zone);
CREATE TABLE public.receipt_items (id uuid, receipt_id uuid, description text, part_number text, category text, quantity numeric, unit_price numeric, total_price numeric, created_at timestamp with time zone, hours numeric);
CREATE TABLE public.receipt_vehicle_links (id uuid, receipt_id uuid, vehicle_id uuid, user_id uuid, status text, basis text, basis_ref jsonb, confidence numeric, tie_kind text, type_gate text, page_date date, page_date_source text, run_id text, created_at timestamp with time zone, retired_at timestamp with time zone);
CREATE TABLE public.receipts (id uuid, user_id uuid, file_url text, processing_status text, vendor_name text, transaction_date date, total_amount numeric(10,2), subtotal numeric(10,2), raw_extraction jsonb, created_at timestamp with time zone, is_active boolean, scope_type text, scope_id text, vehicle_id uuid, purchase_date date, receipt_date date, total numeric, raw_json jsonb, status text, timeline_event_id uuid, part_number text, is_superseded boolean, superseded_at timestamp with time zone, duplicate_of uuid, amount_check public.receipt_amount_check, document_kind public.receipt_doc_kind, document_kind_rule text, document_kind_citation jsonb, document_kind_run_id text, document_kind_classified_at timestamp with time zone);
CREATE TABLE public.vehicle_events (id uuid, vehicle_id uuid, event_status text, started_at timestamp with time zone, ended_at timestamp with time zone, sold_at timestamp with time zone, final_price numeric, extraction_method text, created_at timestamp with time zone);
CREATE TABLE public.vehicle_images (id uuid, vehicle_id uuid, user_id uuid, image_url text, category text, created_at timestamp with time zone, timeline_event_id uuid, taken_at timestamp with time zone, source text, is_sensitive boolean, part text, operation text, materials text[], duplicate_of uuid, is_duplicate boolean, is_superseded boolean, superseded_at timestamp with time zone);
CREATE TABLE public.vehicle_observations (id uuid, vehicle_id uuid, observed_at timestamp with time zone, kind public.observation_kind, structured_data jsonb, confidence text, is_superseded boolean, superseded_at timestamp with time zone, extraction_method text);
CREATE TABLE public.vehicles (id uuid, uploaded_by uuid, make text, model text, year integer, vin text, color text, transmission text, current_value numeric(10,2), purchase_price numeric(10,2), purchase_date date, is_modified boolean, modification_details text, maintenance_notes text, is_public boolean, notes text, created_at timestamp with time zone, bat_sold_price numeric(10,2), bat_listing_title text, sale_status text, status text, deleted_at timestamp with time zone, source text, user_id uuid, description text, owner_id uuid, "trim" text, created_by_user_id uuid, trim_details text, sold_price integer, image_url text, listing_title text, modifications text, nuke_estimate numeric(12,2), cz_estimated_value numeric, observation_count integer, canonical_sold_price numeric, build_class text);
ALTER TABLE public.receipt_items ADD COLUMN line_number int, ADD COLUMN line_date date, ADD COLUMN performer text;
ALTER TABLE public.vehicle_images ADD COLUMN ai_scan_metadata jsonb, ADD COLUMN vehicle_zone text, ADD COLUMN apple_ml_labels text[],
  ADD COLUMN work_session_id uuid;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS merged_into_vehicle_id uuid;
ALTER TABLE public.receipts ADD COLUMN source_document_table text, ADD COLUMN source_document_id uuid;
CREATE TABLE public.receipt_document_kind_rules(rule_id text PRIMARY KEY, priority int, kind public.receipt_doc_kind,
  field text CHECK (field IN ('vendor','doctype','text','items','specialty')), pattern text, note text,
  created_at timestamptz DEFAULT now(), amount_min numeric, amount_max numeric);
-- live rules (2026-11-21, patterns abridged) that a parts vendor, a typed document or part words would hit
INSERT INTO public.receipt_document_kind_rules(rule_id, priority, kind, field, pattern) VALUES
  ('parts_service_vendor', 1, 'parts_service', 'vendor', 'parts|auto ?zone|carquest|napa|o.?reilly|holley|summit racing'),
  ('tax_form_doctype', 11, 'tax_form', 'doctype', '1099|irs_|w-?2'),
  ('bank_doctype', 22, 'financial_statement', 'doctype', 'bank_statement|revenue_center|daily_sales|wire_transfer|bank_transfer'),
  ('letter_doctype', 41, 'letter_notice', 'doctype', 'court_|final_notice|instruction_sheet'),
  ('part_words_items', 120, 'parts_service', 'items', '\y(gaskets?|filters?|brakes?|grille|bumper|fender)\y');
CREATE TABLE public.receipt_vendor_specialties(id serial, vendor_slug text, vendor_pattern text, citation_url text);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- what the line and build readers call, stubbed to say nothing
CREATE FUNCTION public.receipt_line_photo_zone(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.receipt_line_photo_end(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.image_photo_zones(text, text, text, text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT '{}'::text[] $$;
CREATE FUNCTION public.image_photo_end(text, text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.receipt_work_frame_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.receipt_line_system(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p ~* 'brake' THEN 'brakes' END $$;
CREATE FUNCTION public.receipt_line_labor_operation(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.receipt_item_product_card(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.photo_reading_is_print(jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
CREATE FUNCTION public.build_phase_system(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.photo_part_key_system(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.build_system_precedence() RETURNS TABLE(before_system text, after_system text, reason text) LANGUAGE sql IMMUTABLE
  AS $$ SELECT NULL::text, NULL::text, NULL::text WHERE false $$;
CREATE FUNCTION public.receipt_line_strip_list_price(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
CREATE FUNCTION public.text_redact_contact(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
CREATE TABLE public.labor_operations(code text PRIMARY KEY, name text, base_hours numeric, model_year_min int, model_year_max int);
CREATE TABLE public.stage_transition_labor_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_stage text, to_stage text, zone_pattern text,
  description text, estimated_hours_min numeric, estimated_hours_max numeric, estimated_hours_typical numeric, confidence text);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, session_date date, session_type text);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_date date, cost_amount numeric);
CREATE TABLE public.work_order_parts(total_price numeric, timeline_event_id uuid);
CREATE TABLE public.work_order_labor(total_cost numeric, timeline_event_id uuid);

-- Live definitions, verbatim (pg_get_functiondef / pg_get_viewdef, 2026-11-21). Bodies are not checked here (no
-- dependencies are needed to store them); the md5 asserts below prove each is the definition the migration read.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.receipt_doc_kind_excluded(k receipt_doc_kind)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(k::text in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase','vehicle_sale'), false)
$function$;

CREATE OR REPLACE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric, p_line_date date, p_performer text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN d ~* '\m(shipping|freight|handling|delivery|sales tax|tax|discount|coupon|core charge|core exchange|core return|return|deposit|payment|surcharge|fee|subtotal|total)\M'
         OR coalesce(p_part_number, '') ~* '^\{?(shipping|freight|tax|handling)\}?$' THEN 'charge'
    WHEN d ~* 'back[- ]?order' OR d ~* 'qty shipped 0' THEN 'backordered'
    WHEN d ~* 'kit component' THEN 'kit_component'
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part'
  END
  -- the remark is set aside only when other words remain; a line that is nothing but the remark stays a charge
  FROM (SELECT CASE WHEN btrim(stripped, ' ,;()-') = '' THEN raw ELSE stripped END AS d
          FROM (SELECT coalesce(p_description, '') AS raw,
                       regexp_replace(coalesce(p_description, ''),
                                      '\mfree +((standard|ground|economy|expedited) +)?(shipping|delivery|returns?)\M', '', 'gi') AS stripped) r) s
$function$;

CREATE OR REPLACE FUNCTION public.receipt_doc_text(p_rx jsonb, p_rj jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select left(regexp_replace(coalesce(p_rx #>> '{ocr,full_text}', p_rx ->> 'raw_text', p_rx #>> '{what,raw_text}', p_rj #>> '{ocr,full_text}', ''), '\s+', ' ', 'g'), 400)
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.receipt_classify_document(p_vendor text, p_doctype text, p_text text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$ select public.receipt_classify_document(p_vendor, p_doctype, p_text, null, null) $function$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.receipts_set_document_kind()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare c jsonb;
begin
  if coalesce(new.document_kind_rule,'') = 'manual' then return new; end if;
  c := public.receipt_classify_document(new.vendor_name,
         concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type'),
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
end $function$;

CREATE OR REPLACE FUNCTION public.land_document_pages(p_owner uuid, p_vehicle uuid, p_run text, p_docs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base text := p_docs->>'storage_base';
  v_docs jsonb := p_docs->'documents';
  v_method text := coalesce(p_docs->>'method', 'document_page_transcription');
  v_model text := p_docs->>'model';
  d jsonb; pg jsonb; ln jsonb;
  v_out jsonb := '[]';
  v_landed int := 0; v_dupes int := 0; v_errors int := 0;
  v_url text; v_doc_id uuid; v_receipt_id uuid; v_existing uuid;
  v_date date; v_date_basis text; v_pages jsonb; v_lines jsonb; v_n int;
  v_link jsonb; v_title text; v_desc text; v_type text;
  v_money text := '^-?[0-9]{1,9}(\.[0-9]{1,4})?$';
  v_txt text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'land_document_pages: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_owner AND u.deleted_at IS NULL AND u.is_anonymous IS NOT TRUE) THEN
    RAISE EXCEPTION 'land_document_pages: custodian must be an account';
  END IF;
  IF p_vehicle IS NULL OR NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p_vehicle AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'land_document_pages: vehicle must exist and be current';
  END IF;
  IF receipt_user_vehicle_tie(p_owner, p_vehicle) IS NULL THEN
    RAISE EXCEPTION 'land_document_pages: custodian % is not tied to vehicle %', p_owner, p_vehicle;
  END IF;
  IF coalesce(length(p_run), 0) NOT BETWEEN 1 AND 120
     OR v_base !~ '^https://[a-z0-9]+\.supabase\.co$'
     OR jsonb_typeof(v_docs) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_docs) NOT BETWEEN 1 AND 200
     OR length(v_method) NOT BETWEEN 1 AND 120
     OR octet_length(p_docs::text) > 4000000 THEN
    RAISE EXCEPTION 'land_document_pages: invalid envelope';
  END IF;
  -- Nothing that looks like a card number, an e-mail or an OCR dump enters the database.
  -- sha256 names and uuids are not card numbers
  v_txt := regexp_replace(regexp_replace(p_docs::text, '[a-f0-9]{64}', '', 'g'),
                          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g');
  IF v_txt ~ '[0-9]{13,19}' OR v_txt ~ '[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{4}'
     OR v_txt ~* '"(ocr_text|raw_text|full_text|full_ocr)"\s*:' OR v_txt ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' THEN
    RAISE EXCEPTION 'land_document_pages: card numbers, e-mail addresses and OCR text stay out of the record';
  END IF;

  FOR d IN SELECT value FROM jsonb_array_elements(v_docs) LOOP
    BEGIN
      IF jsonb_typeof(d) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('source_key','doc_type','vendor','doc_number','doc_date','date_basis','other_dates','bill_to_name','vehicle_noted','pages','lines','subtotal','discount','shipping','tax','total','payment','handwritten','confidence','notes','vehicle_context'))
         OR coalesce(length(d->>'source_key'), 0) NOT BETWEEN 1 AND 160
         OR coalesce(d->>'doc_type', '') NOT IN ('invoice','receipt','work_order','packing_slip','order_confirmation','alignment_report','estimate','statement','other')
         OR jsonb_typeof(d->'vendor') IS DISTINCT FROM 'object'
         OR coalesce(length(d#>>'{vendor,name}'), 0) NOT BETWEEN 1 AND 200
         OR coalesce(length(d#>>'{vendor,address}'), 0) > 300
         OR coalesce(length(d->>'doc_number'), 0) > 80
         OR (d->>'doc_date' IS NOT NULL AND d->>'doc_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
         OR coalesce(length(d->>'bill_to_name'), 0) > 120
         OR coalesce(length(d->>'vehicle_noted'), 0) > 200
         OR coalesce(length(d->>'notes'), 0) > 1000
         OR coalesce(length(d->>'vehicle_context'), 0) > 500
         OR jsonb_typeof(d->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'pages') NOT BETWEEN 1 AND 20
         OR jsonb_typeof(coalesce(d->'lines', '[]')) IS DISTINCT FROM 'array' OR jsonb_array_length(coalesce(d->'lines', '[]')) > 300
         OR jsonb_typeof(coalesce(d->'other_dates', '[]')) IS DISTINCT FROM 'array'
         OR jsonb_typeof(coalesce(d->'handwritten', '[]')) IS DISTINCT FROM 'array'
         OR (d->'confidence' IS NOT NULL AND (jsonb_typeof(d->'confidence') <> 'number' OR (d->>'confidence')::numeric NOT BETWEEN 0 AND 1))
         OR EXISTS (SELECT 1 FROM unnest(ARRAY['subtotal','discount','shipping','tax','total']) k WHERE d->>k IS NOT NULL AND d->>k !~ v_money)
         OR (d->'payment' IS NOT NULL AND (jsonb_typeof(d->'payment') <> 'object' OR coalesce(length(d#>>'{payment,method}'), 0) > 40
             OR (d#>>'{payment,amount}' IS NOT NULL AND d#>>'{payment,amount}' !~ v_money)
             OR (d#>>'{payment,date}' IS NOT NULL AND d#>>'{payment,date}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(d->'pages') p WHERE jsonb_typeof(p) <> 'object'
             OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('sha256','storage_path','byte_size','page_no','role','source_filename'))
             OR coalesce(p->>'sha256', '') !~ '^[a-f0-9]{64}$'
             OR coalesce(p->>'storage_path', '') NOT LIKE p_owner::text || '/%' OR position('..' in p->>'storage_path') > 0 OR length(p->>'storage_path') > 600
             OR coalesce(p->>'byte_size', '') !~ '^[0-9]{1,9}$' OR (p->>'byte_size')::bigint NOT BETWEEN 1 AND 52428800
             OR coalesce(p->>'page_no', '') !~ '^[0-9]{1,2}$'
             OR coalesce(p->>'role', 'page') NOT IN ('page','continuation','duplicate_confirmation')
             OR coalesce(length(p->>'source_filename'), 0) > 120)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d->'lines', '[]')) l WHERE jsonb_typeof(l) <> 'object'
             OR EXISTS (SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN ('description','part_number','quantity','unit_price','amount','line_date','performer','hours','category'))
             OR coalesce(length(l->>'description'), 0) NOT BETWEEN 1 AND 500
             OR coalesce(length(l->>'part_number'), 0) > 100 OR coalesce(length(l->>'performer'), 0) > 80 OR coalesce(length(l->>'category'), 0) > 60
             OR (l->>'line_date' IS NOT NULL AND l->>'line_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
             OR EXISTS (SELECT 1 FROM unnest(ARRAY['quantity','unit_price','amount','hours']) k WHERE l->>k IS NOT NULL AND l->>k !~ v_money))
      THEN
        RAISE EXCEPTION 'invalid document %', coalesce(d->>'source_key', '?');
      END IF;

      SELECT jsonb_agg(p ORDER BY (p->>'page_no')::int) INTO v_pages FROM jsonb_array_elements(d->'pages') p;
      v_url := v_base || '/storage/v1/object/authenticated/user-documents/' || (v_pages->0->>'storage_path');
      v_date := (d->>'doc_date')::date;
      v_date_basis := CASE WHEN v_date IS NOT NULL THEN coalesce(d->>'date_basis', 'printed_document_date') ELSE 'none' END;
      v_type := d->>'doc_type';
      v_lines := coalesce(d->'lines', '[]');
      v_n := jsonb_array_length(v_lines);

      -- Idempotent on the original: the same first page lands once.
      SELECT vd.id INTO v_existing FROM vehicle_documents vd
       WHERE vd.uploaded_by = p_owner AND vd.vehicle_id = p_vehicle AND vd.file_url = v_url LIMIT 1;
      IF v_existing IS NOT NULL THEN
        SELECT r.id INTO v_receipt_id FROM receipts r WHERE r.source_document_table = 'vehicle_documents' AND r.source_document_id = v_existing LIMIT 1;
        v_dupes := v_dupes + 1;
        v_out := v_out || jsonb_build_object('source_key', d->>'source_key', 'document_id', v_existing, 'receipt_id', v_receipt_id, 'duplicate', true,
          'link', (SELECT jsonb_build_object('status', l.status, 'basis', l.basis, 'confidence', l.confidence, 'hold_reason', l.hold_reason, 'page_date', l.page_date)
                     FROM receipt_vehicle_links l WHERE l.receipt_id = v_receipt_id AND l.retired_at IS NULL LIMIT 1));
        CONTINUE;
      END IF;

      v_title := concat_ws(' ', d#>>'{vendor,name}', replace(v_type, '_', ' '), d->>'doc_number');
      v_desc := concat_ws(' · ',
        CASE WHEN v_date IS NOT NULL THEN 'dated ' || v_date::text || ' (' || v_date_basis || ')' ELSE 'no printed date' END,
        jsonb_array_length(v_pages)::text || ' page' || CASE WHEN jsonb_array_length(v_pages) = 1 THEN '' ELSE 's' END,
        v_n::text || ' line' || CASE WHEN v_n = 1 THEN '' ELSE 's' END,
        CASE WHEN d->>'bill_to_name' IS NOT NULL THEN 'billed to ' || (d->>'bill_to_name') END,
        CASE WHEN d->>'vehicle_noted' IS NOT NULL THEN 'vehicle noted: ' || (d->>'vehicle_noted') END,
        d->>'vehicle_context');

      INSERT INTO vehicle_documents (vehicle_id, uploaded_by, document_type, title, description, file_url, file_type, amount, vendor_name, currency, privacy_level)
      VALUES (p_vehicle, p_owner, v_type, left(v_title, 200), left(v_desc, 1000), v_url, 'image/heic',
              (d->>'total')::numeric, left(d#>>'{vendor,name}', 200), 'USD', 'private')
      RETURNING id INTO v_doc_id;

      INSERT INTO receipts (user_id, created_by, vehicle_id, scope_type, scope_id, file_url, file_name, file_type, upload_date,
        processing_status, status, processed_at, vendor_name, vendor_address, transaction_date, receipt_date, purchase_date, occurred_at,
        invoice_number, subtotal, tax, tax_amount, total, total_amount, currency, payment_method, card_holder, confidence_score,
        source_document_table, source_document_id, ingest_kind, raw_extraction, raw_json)
      VALUES (p_owner, p_owner, p_vehicle, 'vehicle', p_vehicle::text, v_url,
        coalesce(v_pages->0->>'source_filename', (v_pages->0->>'sha256') || '.heic'), 'image/heic', now(),
        'completed', 'processed', now(), left(d#>>'{vendor,name}', 200), left(d#>>'{vendor,address}', 300), v_date, v_date, v_date,
        CASE WHEN v_date IS NOT NULL THEN (v_date::timestamp + interval '12 hours') AT TIME ZONE 'America/Los_Angeles' END,
        d->>'doc_number', (d->>'subtotal')::numeric, (d->>'tax')::numeric, (d->>'tax')::numeric, (d->>'total')::numeric, (d->>'total')::numeric,
        'USD', left(d#>>'{payment,method}', 40), left(d->>'bill_to_name', 120), (d->>'confidence')::numeric,
        'vehicle_documents', v_doc_id, 'import',
        jsonb_build_object('engine', v_method, 'model', v_model, 'run', p_run,
          'data', jsonb_build_object('document_type', v_type, 'transaction_date', v_date, 'vehicle_hint', d->>'vehicle_noted', 'notes', d->>'notes',
            'line_items', (SELECT coalesce(jsonb_agg(jsonb_build_object('description', l->>'description')), '[]') FROM jsonb_array_elements(v_lines) l))),
        jsonb_build_object(
          'data_v2', jsonb_build_object('document_type', v_type, 'transaction_date', v_date, 'vehicle_hint', d->>'vehicle_noted',
            'vendor', d->'vendor', 'document_number', d->>'doc_number', 'payer_as_named', d->>'bill_to_name',
            'subtotal', (d->>'subtotal')::numeric, 'discount', (d->>'discount')::numeric, 'shipping', (d->>'shipping')::numeric,
            'tax', (d->>'tax')::numeric, 'total', (d->>'total')::numeric, 'payment', d->'payment'),
          'document_pages', jsonb_build_object('run', p_run, 'method', v_method, 'model', v_model, 'source_key', d->>'source_key',
            'date_basis', v_date_basis, 'other_dates', coalesce(d->'other_dates', '[]'), 'handwritten', coalesce(d->'handwritten', '[]'),
            'vehicle_context', d->>'vehicle_context', 'pages', v_pages)))
      RETURNING id INTO v_receipt_id;

      INSERT INTO receipt_items (receipt_id, line_number, description, part_number, category, quantity, unit_price, total_price, line_date, hours, performer)
      SELECT v_receipt_id, o, left(l->>'description', 500), left(l->>'part_number', 100), left(l->>'category', 60),
             (l->>'quantity')::numeric, (l->>'unit_price')::numeric, (l->>'amount')::numeric,
             (l->>'line_date')::date, (l->>'hours')::numeric, left(l->>'performer', 80)
        FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x(l, o);

      -- The fold decides the vehicle link exactly as for every other receipt (cited document, page date, type gate, kind).
      v_link := receipt_link_one(v_receipt_id);
      v_landed := v_landed + 1;
      v_out := v_out || jsonb_build_object('source_key', d->>'source_key', 'document_id', v_doc_id, 'receipt_id', v_receipt_id, 'duplicate', false,
        'lines', v_n, 'date', v_date, 'date_basis', v_date_basis,
        'document_kind', (SELECT document_kind::text FROM receipts WHERE id = v_receipt_id),
        'link', CASE WHEN v_link IS NULL THEN NULL ELSE jsonb_build_object('status', v_link->>'status', 'basis', v_link->>'basis',
                  'confidence', v_link->'confidence', 'hold_reason', v_link->>'hold_reason', 'page_date', v_link->>'page_date', 'retired', (v_link->>'retired_at') IS NOT NULL) END);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      v_out := v_out || jsonb_build_object('source_key', coalesce(d->>'source_key', '?'), 'error', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object('run', p_run, 'owner', p_owner, 'vehicle', p_vehicle, 'landed', v_landed, 'duplicates', v_dupes, 'errors', v_errors, 'documents', v_out);
END $function$;

CREATE OR REPLACE FUNCTION public.receipt_work_lines(p_vehicle_id uuid, p_window_days integer DEFAULT 90, p_max_images integer DEFAULT 8)
 RETURNS TABLE(vehicle_id uuid, user_id uuid, receipt_id uuid, item_id uuid, link_id uuid, link_basis text, link_confidence numeric, vendor_name text, document_kind text, line_number integer, description text, part_number text, total_price numeric, line_kind text, zone text, end_hint text, anchor_date date, anchor_source text, conclusion text, confidence numeric, days_to_first_photo integer, zone_photos_total integer, zone_photos_in_window integer, first_photo_day date, image_ids uuid[], day_photos integer, work_session_ids uuid[], timeline_event_ids uuid[], judgment_needed boolean, logic_version text, relationship_status text, source_document_table text, source_document_id uuid, source_page integer, custodian_user_id uuid, printed_line_date date, printed_hours numeric, printed_performer text, reader_ineligible jsonb, question_context jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH v AS (SELECT id, coalesce(owner_id, user_id) AS uid FROM vehicles WHERE id = p_vehicle_id),
  raw AS (
    SELECT l.id AS link_id, l.basis, l.confidence AS link_conf, l.page_date AS page_date_raw, l.page_date_source, l.user_id AS link_user,
           r.id AS receipt_id, r.user_id AS receipt_user, r.vendor_name, r.document_kind::text AS document_kind,
           r.receipt_date AS receipt_date_raw, r.source_document_table, r.source_document_id,
           i.id AS item_id, i.line_number, i.description, i.part_number, i.total_price,
           i.line_date AS printed_line_date, i.hours AS printed_hours, i.performer AS printed_performer
      FROM receipt_vehicle_links l
      JOIN receipts r ON r.id = l.receipt_id
      LEFT JOIN receipt_items i ON i.receipt_id = r.id
     WHERE l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL
       AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
  ),
  checked AS (  -- reader eligibility only: a date after tomorrow cannot anchor later photos (testimony is kept as printed)
    SELECT w.*,
           CASE WHEN w.printed_line_date <= current_date + 1 THEN w.printed_line_date END AS line_date,
           CASE WHEN w.page_date_raw <= current_date + 1 THEN w.page_date_raw END AS page_date,
           CASE WHEN w.receipt_date_raw <= current_date + 1 THEN w.receipt_date_raw END AS receipt_date,
           jsonb_strip_nulls(jsonb_build_object(
             'line_date', CASE WHEN w.printed_line_date > current_date + 1 THEN 'after_today' END,
             'page_date', CASE WHEN w.page_date_raw > current_date + 1 THEN 'after_today' END,
             'receipt_date', CASE WHEN w.receipt_date_raw > current_date + 1 THEN 'after_today' END)) AS ineligible
      FROM raw w
  ),
  lines AS (
    SELECT c.*,
           CASE WHEN c.item_id IS NULL THEN 'receipt'
                ELSE receipt_line_kind(c.description, c.part_number, c.total_price, c.printed_hours, c.printed_line_date,
                                       nullif(btrim(c.printed_performer), '')) END AS kind,
           receipt_line_photo_zone(c.description) AS zone, receipt_line_photo_end(c.description) AS end_hint,
           coalesce(c.line_date, c.page_date, c.receipt_date) AS anchor,
           CASE WHEN c.line_date IS NOT NULL THEN 'line_date' WHEN c.page_date IS NOT NULL THEN coalesce('page_date:' || c.page_date_source, 'page_date')
                WHEN c.receipt_date IS NOT NULL THEN 'receipt_date' END AS anchor_source
      FROM checked c
  ),
  imgs AS MATERIALIZED (
    SELECT x.id, x.taken_at, (x.taken_at AT TIME ZONE 'UTC')::date AS d, x.work_session_id,
           image_photo_zones(x.ai_scan_metadata #>> '{classification,v2,angle,value}', x.vehicle_zone,
                             x.ai_scan_metadata #>> '{byok_deep_analysis,scene_type}', x.apple_ml_labels) AS zones,
           image_photo_end(x.ai_scan_metadata #>> '{classification,v2,angle,value}', x.vehicle_zone) AS img_end
      FROM vehicle_images x
     WHERE x.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(x)
  ),
  zl AS (
    SELECT ln.link_id, ln.item_id,
           count(m.id)::int AS total,
           count(m.id) FILTER (WHERE m.d <= ln.anchor + p_window_days)::int AS in_window,
           min(m.d) AS first_day,
           (array_agg(m.id ORDER BY (m.d <= ln.anchor + p_window_days) DESC, coalesce(m.img_end = ln.end_hint, false) DESC, cardinality(m.zones),
                             md5(m.id::text || coalesce(ln.item_id, ln.receipt_id)::text)))[1:p_max_images] AS ids  -- line-specific spread, not the day's first frames
      FROM lines ln
      LEFT JOIN imgs m ON ln.zone IS NOT NULL AND ln.anchor IS NOT NULL AND m.d >= ln.anchor AND ln.zone = ANY (m.zones)
                     -- a frame of the other end of the car cannot show this line's part
                     AND NOT (ln.end_hint IS NOT NULL AND m.img_end IS NOT NULL AND m.img_end <> ln.end_hint)
     GROUP BY ln.link_id, ln.item_id
  ),
  dl AS (  -- labor / whole-receipt rows: photos of any zone on the anchor day +-1
    SELECT ln.link_id, ln.item_id, count(m.id)::int AS n, (array_agg(m.id ORDER BY m.taken_at))[1:p_max_images] AS ids
      FROM lines ln
      LEFT JOIN imgs m ON ln.anchor IS NOT NULL AND m.d BETWEEN ln.anchor - 1 AND ln.anchor + 1
     GROUP BY ln.link_id, ln.item_id
  ),
  shaped AS (
    SELECT ln.*, zl.total, zl.in_window, zl.first_day, dl.n AS day_n,
           CASE WHEN ln.kind IN ('labor', 'receipt') THEN dl.ids ELSE zl.ids END AS cite_ids,
           CASE
             WHEN ln.kind IN ('charge', 'backordered', 'kit_component', 'note') THEN 'not_work_evidence'
             WHEN ln.anchor IS NULL THEN 'undated_line'
             WHEN ln.kind = 'labor' AND dl.n > 0 THEN 'work_day_photographed'
             WHEN ln.kind = 'labor' THEN 'work_day_unphotographed'
             -- a line-less receipt is a purchase on a day, not work on it
             WHEN ln.kind = 'receipt' AND dl.n > 0 THEN 'receipt_day_photographed'
             WHEN ln.kind = 'receipt' THEN 'receipt_day_unphotographed'
             WHEN ln.zone IS NULL THEN 'part_zone_unknown'
             WHEN zl.in_window > 0 THEN 'install_window_photographed'
             WHEN zl.total > 0 THEN 'photographed_after_window'
             ELSE 'no_zone_photo_after_purchase'
           END AS concl
      FROM lines ln
      JOIN zl ON zl.link_id = ln.link_id AND zl.item_id IS NOT DISTINCT FROM ln.item_id
      JOIN dl ON dl.link_id = ln.link_id AND dl.item_id IS NOT DISTINCT FROM ln.item_id
  )
  SELECT p_vehicle_id, coalesce(s.link_user, s.receipt_user, (SELECT uid FROM v)), s.receipt_id, s.item_id, s.link_id, s.basis, s.link_conf,
         s.vendor_name, s.document_kind, s.line_number, s.description, s.part_number, s.total_price,
         s.kind, s.zone, s.end_hint, s.anchor, s.anchor_source,
         s.concl,
         round(least(1, greatest(0, coalesce(s.link_conf, 0.7) * CASE s.concl
           WHEN 'install_window_photographed' THEN 0.6 WHEN 'photographed_after_window' THEN 0.4
           WHEN 'work_day_photographed' THEN 0.7 WHEN 'work_day_unphotographed' THEN 0.6
           WHEN 'receipt_day_photographed' THEN 0.6 WHEN 'receipt_day_unphotographed' THEN 0.6
           WHEN 'no_zone_photo_after_purchase' THEN 0.6 WHEN 'part_zone_unknown' THEN 0.5
           WHEN 'not_work_evidence' THEN 0.9 ELSE 0.5 END
           -- a link made from same-day photos (chronology_session) is not independent of a same-day-photo conclusion
           * CASE WHEN s.basis = 'chronology_session' AND s.concl IN ('receipt_day_photographed', 'work_day_photographed') THEN 0.5 ELSE 1 END)), 3),
         CASE WHEN s.first_day IS NOT NULL THEN s.first_day - s.anchor END,
         s.total, s.in_window, s.first_day, coalesce(s.cite_ids, '{}'), s.day_n,
         coalesce((SELECT array_agg(w.id ORDER BY w.session_date) FROM work_sessions w WHERE w.vehicle_id = p_vehicle_id
                    AND w.session_date BETWEEN coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor - 1 ELSE s.first_day END, '-infinity'::date)
                                           AND coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor + 1 ELSE s.first_day END, '-infinity'::date)), '{}'),
         coalesce((SELECT array_agg(t.id ORDER BY t.event_date) FROM timeline_events t WHERE t.vehicle_id = p_vehicle_id
                    AND t.event_date BETWEEN coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor - 1 ELSE s.first_day END, '-infinity'::date)
                                         AND coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor + 1 ELSE s.first_day END, '-infinity'::date)), '{}'),
         s.concl IN ('install_window_photographed', 'photographed_after_window'),
         'receipt_work_lines/20261111210000',
         'proposed', s.source_document_table, s.source_document_id,
         NULL::int,  -- page: the line-to-page mapping is unresolved (land_document_pages keeps page metadata per document, not per line)
         s.receipt_user, s.printed_line_date, s.printed_hours, s.printed_performer, s.ineligible,
         -- The canonical context a judgment question is asked in: everything about the source, its custody, the cited link,
         -- the anchor and the candidate frames that the question depends on. A judgment request stores it as
         -- params.context; claims and answers recompute it from current sources and refuse when it differs.
         jsonb_build_object(
           'receipt_id', s.receipt_id, 'item_id', s.item_id, 'line_number', s.line_number,
           'link_id', s.link_id, 'link_basis', s.basis, 'link_confidence', s.link_conf,
           'link_page_date', s.page_date_raw, 'link_page_date_source', s.page_date_source,
           'receipt_date', s.receipt_date_raw, 'vendor_name', s.vendor_name, 'document_kind', s.document_kind,
           'source_document_table', s.source_document_table, 'source_document_id', s.source_document_id, 'custodian_user_id', s.receipt_user,
           'description', s.description, 'part_number', s.part_number, 'total_price', s.total_price,
           'printed_line_date', s.printed_line_date, 'printed_hours', s.printed_hours, 'printed_performer', s.printed_performer,
           'line_kind', s.kind, 'zone', s.zone, 'end_hint', s.end_hint, 'anchor_date', s.anchor, 'anchor_source', s.anchor_source,
           'conclusion', s.concl, 'candidate_image_ids', to_jsonb(coalesce(s.cite_ids, '{}'::uuid[])),
           'zone_photos_total', s.total, 'zone_photos_in_window', s.in_window, 'first_photo_day', s.first_day,
           'window_days', p_window_days, 'max_images', p_max_images, 'logic_version', 'receipt_work_lines/20261111210000')
    FROM shaped s
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
    vehicle_te as (select id from timeline_events where vehicle_id = p_vehicle_id),
    parts as (
      select coalesce(sum(wop.total_price), 0) as total, count(*) as cnt
      from work_order_parts wop where wop.timeline_event_id in (select id from vehicle_te)
    ),
    labor as (
      select coalesce(sum(wol.total_cost), 0) as total, count(*) as cnt
      from work_order_labor wol where wol.timeline_event_id in (select id from vehicle_te)
    ),
    te_costs as (
      select coalesce(sum(cost_amount), 0) as total from timeline_events
      where vehicle_id = p_vehicle_id and cost_amount is not null and cost_amount > 0
    ),
    candidate as (
      select l.receipt_id as id from receipt_vehicle_links l
      where l.vehicle_id = p_vehicle_id and l.status = 'linked' and l.retired_at is null
      union
      select r.id from receipts r
      where (r.vehicle_id = p_vehicle_id or (r.scope_type = 'vehicle' and r.scope_id = p_vehicle_id::text))
        and not exists (select 1 from receipt_vehicle_links l where l.receipt_id = r.id and l.retired_at is null)
    ),
    rcpts as (
      select coalesce(sum(coalesce(r.total_amount, r.total)), 0) as total, count(*) as cnt
      from receipts r join candidate c on c.id = r.id
      where r.duplicate_of is null and r.amount_check in ('verified','plausible') and coalesce(r.is_superseded, false) = false
        and coalesce(r.total_amount, r.total) > 0
        and not public.receipt_doc_kind_excluded(r.document_kind)
    )
  select jsonb_build_object(
    'total_invested', greatest(parts.total + labor.total, te_costs.total, rcpts.total),
    'breakdown', jsonb_build_object(
      'parts', parts.total, 'labor', labor.total, 'materials', 0, 'overhead', 0, 'tools', 0,
      'financial_records_total', 0, 'timeline_costs', te_costs.total, 'receipts', rcpts.total),
    'components_count', jsonb_build_object(
      'parts_items', parts.cnt, 'labor_tasks', labor.cnt, 'materials_items', 0,
      'events_with_work', 0, 'receipts', rcpts.cnt))
  from parts, labor, te_costs, rcpts;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_machine_shop_lines(p_vehicle_id uuid)
 RETURNS TABLE(item_id uuid, shop text, day date, hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH v AS (
    SELECT v.id FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  raw AS (
    SELECT i.id AS item_id, r.vendor_name, i.description, i.part_number, i.total_price, i.hours,
           i.line_date, l.page_date, r.receipt_date, nullif(btrim(i.performer), '') AS performer
      FROM v
      JOIN public.receipt_vehicle_links l ON l.vehicle_id = v.id AND l.status = 'linked' AND l.retired_at IS NULL
      JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
      JOIN public.receipt_items i ON i.receipt_id = r.id)
  SELECT w.item_id,
         nullif(left(btrim(public.text_redact_contact(w.vendor_name)), 300), ''),
         coalesce(CASE WHEN w.line_date <= current_date + 1 THEN w.line_date END,
                  CASE WHEN w.page_date <= current_date + 1 THEN w.page_date END,
                  CASE WHEN w.receipt_date <= current_date + 1 THEN w.receipt_date END),
         w.hours
    FROM raw w
   WHERE public.receipt_line_system(w.description) = 'machining'
     AND (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) IN ('labor', 'note')
          OR (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) = 'part'
              AND w.part_number IS NULL AND lower(w.description) ~
                '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'))
$function$;

CREATE OR REPLACE FUNCTION public.compute_vehicle_investment_proof(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_visible boolean;
  v_doc jsonb;
  v_parts numeric; v_parts_n int;
  v_in numeric; v_out numeric; v_pay_n int;
  v_attr_out numeric; v_attr_in numeric; v_attr_n int;
  v_labor_proj numeric; v_labor_conf numeric; v_labor_n int;
  v_burst_min bigint;
  v_rate_info jsonb; v_rate_usd numeric; v_rate_conf text;
  v_market numeric;
  v_invested_proven numeric; v_invested_attr numeric; v_invested_total numeric;
  v_audit jsonb := '{}'::jsonb;
  v_by_party jsonb := '[]'::jsonb;
BEGIN
  -- Money is the owner's (owner rule, 2026-09-28): the signed-in owner, uploader or a contributor with
  -- access sees it; every other caller gets the same record with its money masked. A private vehicle
  -- reads as NULL for anyone its policies exclude.
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (owner_id, user_id, created_by_user_id, uploaded_by)
            OR public.vehicle_user_has_access(id, auth.uid()))),
         coalesce(is_public, false)
  INTO v_owner, v_visible FROM vehicles WHERE id = p_vehicle_id;
  v_owner := COALESCE(v_owner, false);
  IF NOT (coalesce(v_visible, false) OR v_owner) THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(coalesce(total_amount, total)),0), count(*) INTO v_parts, v_parts_n
  FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;

  SELECT coalesce(sum(amount_usd) filter (where direction='in'  and coalesce(method,'') <> 'owner_attestation'),0),
         coalesce(sum(amount_usd) filter (where direction='out' and coalesce(method,'') <> 'owner_attestation'),0),
         count(*) filter (where coalesce(method,'') <> 'owner_attestation')
  INTO v_in, v_out, v_pay_n
  FROM payment_events WHERE scope_type='vehicle' AND scope_id = p_vehicle_id AND NOT is_superseded;

  SELECT coalesce(sum(amount_usd) filter (where direction='out'),0),
         coalesce(sum(amount_usd) filter (where direction='in'),0), count(*)
  INTO v_attr_out, v_attr_in, v_attr_n
  FROM payment_events WHERE scope_type='vehicle' AND scope_id = p_vehicle_id
    AND NOT is_superseded AND method='owner_attestation';

  SELECT coalesce(sum(total_job_cost) filter (where owner_confirmed_at IS NOT NULL),0), count(*)
  INTO v_labor_conf, v_labor_n
  FROM work_sessions WHERE vehicle_id = p_vehicle_id;

  -- One honest rate source: reported facts win, else market-derived spitball.
  v_rate_info := resolve_labor_rate(p_vehicle_id := p_vehicle_id);
  v_rate_usd  := (v_rate_info->>'rate')::numeric;
  v_rate_conf := v_rate_info->>'rate_confidence';
  v_burst_min := compute_active_minutes_burst_total(p_vehicle_id, 30);
  v_labor_proj := greatest(0, (v_burst_min::numeric / 60) * v_rate_usd * 0.92 - v_labor_conf);

  SELECT estimated_value INTO v_market FROM nuke_estimates
  WHERE vehicle_id = p_vehicle_id ORDER BY confidence_score DESC NULLS LAST LIMIT 1;

  v_invested_proven := v_parts + v_out + v_labor_conf;
  v_invested_attr   := v_invested_proven + v_attr_out;
  v_invested_total  := v_invested_attr + v_labor_proj;

  IF v_owner THEN
    SELECT jsonb_build_object(
      'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'vendor',vendor_name,
          'amount',round(coalesce(total_amount,total)),'date',coalesce(receipt_date,transaction_date,purchase_date),
          'source','receipts') ORDER BY coalesce(total_amount,total) DESC NULLS LAST),'[]'::jsonb)
        FROM receipts WHERE vehicle_id=p_vehicle_id AND superseded_at IS NULL),
      'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'direction',direction,'amount',round(amount_usd),
          'counterparty',counterparty_name,'method',method,'confirmation',confirmation_number,'description',description,
          'source','payment_events') ORDER BY paid_at),'[]'::jsonb)
        FROM payment_events WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded),
      'work_sessions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'date',session_date,
          'cost',round(total_job_cost),'confirmed',owner_confirmed_at IS NOT NULL,'source','work_sessions')
          ORDER BY session_date),'[]'::jsonb)
        FROM work_sessions WHERE vehicle_id=p_vehicle_id)
    ) INTO v_audit;

    SELECT coalesce(jsonb_agg(p ORDER BY (p->>'total')::numeric DESC),'[]'::jsonb)
    INTO v_by_party
    FROM (
      SELECT jsonb_build_object(
        'party', coalesce(nullif(counterparty_name,''),'(unattributed)'),
        'direction', direction, 'count', count(*), 'total', round(sum(amount_usd)),
        'trust', case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end,
        'source','payment_events'
      ) AS p
      FROM payment_events
      WHERE scope_type='vehicle' AND scope_id=p_vehicle_id AND NOT is_superseded
      GROUP BY coalesce(nullif(counterparty_name,''),'(unattributed)'), direction,
               case when coalesce(method,'')='owner_attestation' then 'attributed' else 'proven' end
    ) q;
  END IF;

  v_doc := jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'is_owner_view', v_owner,
    'proven', jsonb_build_object(
      'parts',           jsonb_build_object('value', round(v_parts),      'count', v_parts_n, 'source','receipts',                  'confidence','high'),
      'confirmed_labor', jsonb_build_object('value', round(v_labor_conf),                     'source','work_sessions:owner_confirmed','confidence','high'),
      'money_in',        jsonb_build_object('value', round(v_in),         'count', v_pay_n,   'source','payment_events',            'confidence','high'),
      'money_out',       jsonb_build_object('value', round(v_out),                            'source','payment_events',            'confidence','high')
    ),
    'attributed', jsonb_build_object(
      'cost',   jsonb_build_object('value', round(v_attr_out), 'count', v_attr_n, 'source','payment_events:owner_attestation', 'confidence','owner_stated'),
      'income', jsonb_build_object('value', round(v_attr_in),                     'source','payment_events:owner_attestation', 'confidence','owner_stated')
    ),
    'projected', jsonb_build_object(
      'labor', jsonb_build_object('value', round(v_labor_proj), 'count', v_labor_n,
               'source','work_sessions + vehicle_images burst clustering',
               'method', format('burst %s min ÷ 60 × $%s/hr (%s) × 0.92, net of confirmed', v_burst_min, v_rate_usd, v_rate_info->>'source'),
               'rate_note', v_rate_info->>'note',
               'confidence', coalesce(v_rate_conf, CASE WHEN v_burst_min = 0 THEN 'none' ELSE 'spitball' END))
    ),
    'market', jsonb_build_object('value', round(coalesce(v_market,0)), 'source','nuke_estimates',
              'confidence', CASE WHEN v_market IS NULL THEN 'none' ELSE 'modeled' END),
    'totals', jsonb_build_object(
      'invested_proven',         round(v_invested_proven),
      'invested_with_attributed',round(v_invested_attr),
      'invested_with_projected', round(v_invested_total),
      'proven_income',           round(v_in),
      'net_proven',              round(v_in - v_invested_proven),
      'roi_proven_pct',          CASE WHEN v_invested_proven > 0 THEN round((v_in - v_invested_proven)/v_invested_proven*100) ELSE NULL END
    ),
    'by_party', v_by_party,
    'audit', v_audit
  );
  IF NOT v_owner THEN
    -- Every figure of the owner's money masked; the modeled market estimate is not the owner's money and stays.
    v_doc := public.jsonb_mask_keys(v_doc - 'market',
               ARRAY['value', 'invested_proven', 'invested_with_attributed', 'invested_with_projected',
                     'proven_income', 'net_proven', 'roi_proven_pct', 'method', 'rate_note'])
             || jsonb_build_object('market', v_doc->'market');
  END IF;
  RETURN v_doc || jsonb_build_object('money_masked', NOT v_owner);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_investment_timeline(p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner boolean;
  v_visible boolean;
  v_doc jsonb;
  v_purchase_price numeric;
  v_purchase_date date;
  v_min_receipt_date date;
  v_baseline_date date;
  v_baseline_anchored boolean := false;
  v_points jsonb := '[]'::jsonb;
  v_baseline jsonb := NULL;
  v_n_undated int;
  v_undated_total numeric;
  v_final numeric := 0;
  v_has_baseline boolean := false;
BEGIN
  -- Money is the owner's (owner rule, 2026-09-28): the signed-in owner, uploader or a contributor with
  -- access sees it; every other caller gets the same curve with its amounts masked. A private vehicle
  -- reads as NULL for anyone its policies exclude.
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (owner_id, user_id, created_by_user_id, uploaded_by)
            OR public.vehicle_user_has_access(id, auth.uid()))),
         coalesce(is_public, false), purchase_price, purchase_date
  INTO v_owner, v_visible, v_purchase_price, v_purchase_date
  FROM vehicles WHERE id = p_vehicle;
  v_owner := COALESCE(v_owner, false);
  IF NOT (coalesce(v_visible, false) OR v_owner) THEN
    RETURN NULL;
  END IF;

  SELECT min(coalesce(receipt_date, transaction_date, purchase_date))
  INTO v_min_receipt_date
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NOT NULL;

  SELECT count(*), coalesce(sum(coalesce(total_amount, total)), 0)
  INTO v_n_undated, v_undated_total
  FROM receipts
  WHERE vehicle_id = p_vehicle AND superseded_at IS NULL
    AND coalesce(receipt_date, transaction_date, purchase_date) IS NULL;

  IF v_purchase_price IS NOT NULL AND v_purchase_price > 0 THEN
    IF v_purchase_date IS NOT NULL THEN
      v_baseline_date := v_purchase_date; v_baseline_anchored := false;
    ELSIF v_min_receipt_date IS NOT NULL THEN
      v_baseline_date := v_min_receipt_date; v_baseline_anchored := true;
    END IF;
    IF v_baseline_date IS NOT NULL THEN
      v_has_baseline := true; v_final := v_purchase_price;
    END IF;
  END IF;

  WITH evt AS (
    SELECT v_baseline_date AS d, NULL::uuid AS rid, true AS is_baseline,
           v_purchase_price AS amt, NULL::text AS vn, v_baseline_anchored AS anchored
    WHERE v_has_baseline
    UNION ALL
    SELECT coalesce(r.receipt_date, r.transaction_date, r.purchase_date) AS d,
           r.id AS rid, false AS is_baseline,
           coalesce(r.total_amount, r.total) AS amt, r.vendor_name AS vn, false AS anchored
    FROM receipts r
    WHERE r.vehicle_id = p_vehicle AND r.superseded_at IS NULL
      AND coalesce(r.receipt_date, r.transaction_date, r.purchase_date) IS NOT NULL
  ),
  calc AS (
    SELECT evt.*, row_number() OVER w AS ord, sum(amt) OVER w AS running
    FROM evt
    WINDOW w AS (ORDER BY d, is_baseline DESC, rid NULLS FIRST ROWS UNBOUNDED PRECEDING)
  )
  SELECT
    coalesce(jsonb_agg(
      CASE WHEN is_baseline THEN
        jsonb_build_object('date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'purchase', 'proven', true, 'anchored_date', anchored,
          'source', CASE WHEN v_owner THEN
                      CASE WHEN anchored THEN 'vehicles.purchase_price (date anchored to first receipt)'
                           ELSE 'vehicles.purchase_price' END ELSE NULL END)
      ELSE
        jsonb_build_object('date', d, 'delta', round(amt, 2), 'cumulative', round(running, 2),
          'kind', 'parts', 'proven', true,
          'source', CASE WHEN v_owner THEN coalesce(nullif(vn, ''), 'receipts') ELSE NULL END)
      END
      ORDER BY ord), '[]'::jsonb),
    v_final + coalesce(sum(amt) FILTER (WHERE NOT is_baseline), 0)
  INTO v_points, v_final
  FROM calc;

  IF v_has_baseline THEN
    v_baseline := jsonb_build_object('date', v_baseline_date,
      'delta', round(v_purchase_price, 2), 'cumulative', round(v_purchase_price, 2),
      'kind', 'purchase', 'proven', true, 'anchored_date', v_baseline_anchored,
      'source', CASE WHEN v_owner THEN
                  CASE WHEN v_baseline_anchored THEN 'vehicles.purchase_price (date anchored to first receipt)'
                       ELSE 'vehicles.purchase_price' END ELSE NULL END);
  END IF;

  v_doc := jsonb_build_object('vehicle_id', p_vehicle, 'is_owner_view', v_owner,
    'n_points', jsonb_array_length(v_points),
    'baseline', coalesce(v_baseline, jsonb_build_object('present', false,
                  'note', 'No purchase_price or no dated receipt to anchor a baseline.')),
    'points', v_points,
    'undated', jsonb_build_object('n_undated', v_n_undated, 'undated_total', round(v_undated_total, 2)),
    'final_cumulative_dated', round(v_final, 2),
    'total_with_undated', round(v_final + v_undated_total, 2));
  IF NOT v_owner THEN
    v_doc := public.jsonb_mask_keys(v_doc, ARRAY['delta', 'cumulative', 'undated_total', 'final_cumulative_dated', 'total_with_undated']);
  END IF;
  RETURN v_doc || jsonb_build_object('money_masked', NOT v_owner);
END;
$function$;

CREATE OR REPLACE FUNCTION public.classify_vehicle_build_class(p_vehicle_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids) > 2000 THEN
    RAISE EXCEPTION 'classify_vehicle_build_class takes 0 to 2000 vehicle ids' USING ERRCODE = '22023';
  END IF;
  -- Set-based: one pass over receipts and work sessions for the chunk, then the rule per vehicle.
  WITH ids AS (SELECT DISTINCT u AS id FROM unnest(p_vehicle_ids) u WHERE u IS NOT NULL),
  r AS (SELECT rc.vehicle_id, sum(coalesce(rc.total_amount, rc.total)) AS total
          FROM receipts rc JOIN ids ON ids.id = rc.vehicle_id
         WHERE rc.superseded_at IS NULL GROUP BY rc.vehicle_id),
  w AS (SELECT ws.vehicle_id, count(*)::int AS n
          FROM work_sessions ws JOIN ids ON ids.id = ws.vehicle_id
         WHERE ws.session_type IS DISTINCT FROM 'baseline_backfill' GROUP BY ws.vehicle_id),
  inp AS (SELECT v.id, v.year, v.is_modified, coalesce(r.total, 0) AS receipts, coalesce(w.n, 0) AS sessions,
                 coalesce(lower(concat_ws(' ', v.description, v.bat_listing_title, v.listing_title, v.modifications,
                                          v.modification_details, v.trim_details, v.notes, v.maintenance_notes)), '') AS txt
            FROM vehicles v JOIN ids ON ids.id = v.id
            LEFT JOIN r ON r.vehicle_id = v.id LEFT JOIN w ON w.vehicle_id = v.id),
  cls AS (SELECT inp.*, public.nuke_build_class_rule(inp.receipts, inp.sessions, inp.txt, inp.year) AS j FROM inp)
  INSERT INTO vehicle_build_class AS t (vehicle_id, build_class, coarse_class, confidence, method_version, source_dna, classified_at)
  SELECT cls.id, cls.j->>'build_class',
         CASE WHEN cls.j->>'build_class' IN ('documented_build', 'modified') THEN 'build'
              WHEN cls.j->>'build_class' = 'stock' THEN 'stock' ELSE 'unknown' END,
         cls.j->>'confidence', 'v6_store_rebuild_factory_efi',
         jsonb_build_object('receipts_total_USD', round(cls.receipts), 'work_sessions', cls.sessions,
           'is_modified_flag', cls.is_modified, 'engine_swap', cls.j->'engine_swap', 'build_score', cls.j->'build_score',
           'stock_score', cls.j->'stock_score', 'has_text', length(cls.txt) > 20, 'reasons', cls.j->'reasons'),
         now()
    FROM cls
  ON CONFLICT (vehicle_id) DO UPDATE SET
    build_class = EXCLUDED.build_class, coarse_class = EXCLUDED.coarse_class, confidence = EXCLUDED.confidence,
    method_version = EXCLUDED.method_version, source_dna = EXCLUDED.source_dna, classified_at = EXCLUDED.classified_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nuke_build_class(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_receipts numeric; v_sessions int; v_photos int; v_is_mod boolean; v_text text; v_rule jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id) THEN
    RETURN jsonb_build_object('error','vehicle not found','vehicle_id',p_vehicle_id);
  END IF;

  SELECT coalesce(sum(coalesce(total_amount,total)),0) INTO v_receipts
    FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;
  SELECT count(*) INTO v_sessions
    FROM work_sessions WHERE vehicle_id = p_vehicle_id AND session_type IS DISTINCT FROM 'baseline_backfill';
  SELECT count(*) INTO v_photos FROM vehicle_images WHERE vehicle_id = p_vehicle_id;

  SELECT is_modified,
         lower(concat_ws(' ', description, bat_listing_title, listing_title, modifications,
                              modification_details, trim_details, notes, maintenance_notes))
    INTO v_is_mod, v_text FROM vehicles WHERE id = p_vehicle_id;
  v_text := coalesce(v_text,'');
  v_rule := public.nuke_build_class_rule(v_receipts, v_sessions, v_text, (SELECT year FROM vehicles WHERE id = p_vehicle_id));

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'build_class', v_rule->>'build_class', 'confidence', v_rule->>'confidence',
    'method_version', 'v2_scored_text_unwired',
    'doctrine_note', 'Build class drives class-stratified comps; UNKNOWN stays blocked, never guessed. v2 scores full description text (engine-swap = decisive build tell). Tunable; owner-overridable.',
    'source_dna', jsonb_build_object(
      'receipts_total_USD', round(v_receipts), 'work_sessions', v_sessions, 'photos', v_photos,
      'is_modified_flag', v_is_mod, 'engine_swap', v_rule->'engine_swap',
      'build_score', v_rule->'build_score', 'stock_score', v_rule->'stock_score',
      'has_text', length(v_text) > 20, 'reasons', v_rule->'reasons'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  img_count int := 0;
  approved_img_count int := 0;
  tag_count int := 0;
  recent_events int := 0;
  receipts_total numeric := 0;
  verified_owner boolean := false;
  contrib_count int := 0;
  public_flag boolean := true;
  completeness numeric := 0;
  score numeric := 0;
begin
  -- gallery-eligible photos only (same definition as vehicles.image_count and the public gallery)
  select count(*), count(*) filter (where coalesce(vi.is_approved, true))
    into img_count, approved_img_count
  from public.vehicle_images vi
  where vi.vehicle_id = p_vehicle_id and public.vehicle_image_gallery_eligible(vi);

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='image_tags') then
    select count(*) into tag_count
    from public.image_tags t
    join public.vehicle_images vi on vi.id = t.image_id
    where vi.vehicle_id = p_vehicle_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='timeline_events') then
    select count(*) into recent_events
    from public.timeline_events
    where vehicle_id = p_vehicle_id
      and created_at >= now() - interval '30 days';
  else
    recent_events := 0;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='receipts') then
    select coalesce(sum(total_amount), 0) into receipts_total
    from public.receipts
    where scope_type = 'vehicle' and duplicate_of is null and amount_check in ('verified','plausible')
      and scope_id::text = p_vehicle_id::text
      and coalesce(processing_status, 'parsed') in ('parsed','validated','saved');
  else
    receipts_total := 0;
  end if;

  select coalesce(is_public, true) into public_flag
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  select (
    (case when (v.make is not null and v.make <> '') then 1 else 0 end) +
    (case when (v.model is not null and v.model <> '') then 1 else 0 end) +
    (case when v.year is not null then 1 else 0 end) +
    (case when (v.vin is not null and v.vin <> '') then 1 else 0 end) +
    (case when (v.color is not null and v.color <> '') then 1 else 0 end) +
    (case when (v.engine_size is not null) then 1 else 0 end) +
    (case when (v.transmission is not null and v.transmission <> '') then 1 else 0 end)
  ) / 7.0
  into completeness
  from (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item') v where v.id = p_vehicle_id;

  score := 0;
  score := score + LEAST(40, COALESCE(ln(GREATEST(2, approved_img_count)) * 20, 0));
  score := score + LEAST(15, (tag_count / 50.0) * 15);
  score := score + LEAST(15, (recent_events / 10.0) * 15);
  score := score + LEAST(15, (receipts_total / 5000.0) * 15);
  if verified_owner then score := score + 10; end if;
  score := score + LEAST(5, contrib_count);
  if public_flag then score := score + 5; end if;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  update public.vehicles set value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'receipts_total', receipts_total,
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  where id = p_vehicle_id;

  return score;
end $function$;

CREATE OR REPLACE FUNCTION public.calculate_ai_vehicle_valuation(p_vehicle_id uuid)
 RETURNS TABLE(estimated_value numeric, confidence_score numeric, base_value numeric, parts_value numeric, labor_value numeric, documentation_bonus numeric, condition_adjustment numeric, data_sources text[], breakdown jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_make TEXT;
  v_model TEXT;
  v_year INTEGER;
  v_purchase_price NUMERIC;
  v_current_value NUMERIC;
  v_base_value NUMERIC := 0;
  v_parts_value NUMERIC := 0;
  v_labor_value NUMERIC := 0;
  v_labor_hours NUMERIC := 0;
  v_doc_bonus NUMERIC := 0;
  v_condition_adj NUMERIC := 0;
  v_confidence NUMERIC := 0;
  v_data_sources TEXT[] := ARRAY[]::TEXT[];
  v_image_count INTEGER := 0;
  v_ai_tag_count INTEGER := 0;
  v_part_count INTEGER := 0;
  v_receipt_total NUMERIC := 0;
  v_avg_hourly_rate NUMERIC := 75; -- Standard shop rate
BEGIN
  -- Get vehicle basics
  SELECT make, model, year, purchase_price, current_value
  INTO v_make, v_model, v_year, v_purchase_price, v_current_value
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', p_vehicle_id;
  END IF;
  
  -- Start with base value (purchase price or current value or market avg)
  v_base_value := COALESCE(v_purchase_price, v_current_value, 0);
  
  IF v_base_value > 0 THEN
    v_data_sources := array_append(v_data_sources, 'Purchase Records');
    v_confidence := 30;
  ELSE
    -- Estimate base value from year/make/model
    -- Simple heuristic: classic trucks appreciate over time
    IF v_year BETWEEN 1960 AND 1990 AND v_make IN ('Chevrolet', 'GMC', 'Ford', 'Dodge') THEN
      v_base_value := 15000 + (1990 - v_year) * 200; -- Older = more valuable for classics
    ELSE
      v_base_value := 10000; -- Default estimate
    END IF;
    v_data_sources := array_append(v_data_sources, 'Market Estimate');
    v_confidence := 20;
  END IF;
  
  -- Calculate labor value from timeline events
  SELECT COALESCE(SUM(labor_hours), 0)
  INTO v_labor_hours
  FROM timeline_events
  WHERE vehicle_id = p_vehicle_id
    AND labor_hours IS NOT NULL
    AND labor_hours > 0;
  
  IF v_labor_hours > 0 THEN
    -- Labor adds value but with depreciation (shop pays $75/hr, but only adds $40/hr to value)
    v_labor_value := v_labor_hours * 40;
    v_data_sources := array_append(v_data_sources, 'Documented Labor');
    v_confidence := v_confidence + 20;
  END IF;
  
  -- Calculate parts value using SYSTEM-BASED approach (not per-part)
  -- This is more accurate for restorations where you're seeing multiple images of the same systems
  WITH system_coverage AS (
    SELECT 
      -- Detect which SYSTEMS have documented work (not individual parts)
      MAX(CASE WHEN metadata->>'category' IN ('engine', 'crate_engine') THEN 1 ELSE 0 END) as has_engine_work,
      MAX(CASE WHEN metadata->>'category' IN ('transmission', 'drivetrain', 'transfer_case') THEN 1 ELSE 0 END) as has_drivetrain_work,
      MAX(CASE WHEN metadata->>'category' IN ('body_panel', 'body', 'paint') THEN 1 ELSE 0 END) as has_body_work,
      MAX(CASE WHEN metadata->>'category' IN ('suspension', 'axle') THEN 1 ELSE 0 END) as has_suspension_work,
      MAX(CASE WHEN metadata->>'category' IN ('brake_system', 'brakes') THEN 1 ELSE 0 END) as has_brake_work,
      MAX(CASE WHEN metadata->>'category' IN ('interior', 'seat') THEN 1 ELSE 0 END) as has_interior_work,
      MAX(CASE WHEN metadata->>'category' IN ('electrical', 'lighting', 'wiring') THEN 1 ELSE 0 END) as has_electrical_work,
      MAX(CASE WHEN metadata->>'category' = 'cooling' THEN 1 ELSE 0 END) as has_cooling_work,
      MAX(CASE WHEN metadata->>'category' = 'fuel_system' THEN 1 ELSE 0 END) as has_fuel_work,
      MAX(CASE WHEN metadata->>'category' = 'exhaust' THEN 1 ELSE 0 END) as has_exhaust_work,
      COUNT(DISTINCT metadata->>'part_number') as unique_part_count,
      AVG(confidence) as avg_confidence
    FROM image_tags
    WHERE vehicle_id = p_vehicle_id
      AND metadata->>'ai_supervised' = 'true'
      AND confidence > 0.7
  )
  SELECT 
    unique_part_count,
    -- Estimate based on DOCUMENTED WORK per system
    -- Most vehicles get REPAIRS not full rebuilds, so values are conservative
    LEAST(  -- Cap total parts value at $25k (realistic for most builds)
      (
        has_engine_work * 2000 +           -- Engine work: $2,000
        has_drivetrain_work * 1500 +       -- Drivetrain work: $1,500
        has_body_work * 3000 +             -- Body/paint work: $3,000
        has_suspension_work * 800 +        -- Suspension: $800
        has_brake_work * 400 +             -- Brakes: $400
        has_interior_work * 1000 +         -- Interior: $1,000
        has_electrical_work * 400 +        -- Electrical: $400
        has_cooling_work * 300 +           -- Cooling: $300
        has_fuel_work * 250 +              -- Fuel: $250
        has_exhaust_work * 500             -- Exhaust: $500
      ) * LEAST(avg_confidence, 0.9),  -- Cap confidence multiplier at 0.9
      25000  -- Absolute cap: $25k parts for most restorations
    )
  INTO v_part_count, v_parts_value
  FROM system_coverage;
  
  IF v_part_count > 0 THEN
    v_data_sources := array_append(v_data_sources, 'AI Part Detection');
    v_confidence := v_confidence + 30;
  END IF;
  
  -- Check for receipts (most accurate)
  SELECT COALESCE(SUM(total_amount), 0)
  INTO v_receipt_total
  FROM receipts
  WHERE scope_type = 'vehicle' 
    AND scope_id::uuid = p_vehicle_id
    AND is_active = true;
  
  IF v_receipt_total > 0 THEN
    -- Receipts are hard evidence, override part estimates with actual spending
    v_parts_value := GREATEST(v_parts_value, v_receipt_total);
    v_data_sources := array_append(v_data_sources, 'Verified Receipts');
    v_confidence := v_confidence + 30;
  END IF;
  
  -- Documentation quality bonus
  SELECT COUNT(*)
  INTO v_image_count
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;
  
  SELECT COUNT(*)
  INTO v_ai_tag_count
  FROM image_tags
  WHERE vehicle_id = p_vehicle_id
    AND metadata->>'ai_supervised' = 'true';
  
  -- High documentation = higher confidence and small value bonus
  IF v_image_count > 50 AND v_ai_tag_count > 100 THEN
    v_doc_bonus := v_base_value * 0.05; -- 5% premium for excellent documentation
    v_data_sources := array_append(v_data_sources, 'Comprehensive Documentation');
    v_confidence := LEAST(v_confidence + 10, 95);
  ELSIF v_image_count > 20 THEN
    v_doc_bonus := v_base_value * 0.02; -- 2% premium for good documentation
    v_confidence := LEAST(v_confidence + 5, 95);
  END IF;
  
  -- Condition assessment from AI tags
  -- Look for rust, damage, restoration indicators
  WITH condition_tags AS (
    SELECT 
      COUNT(*) FILTER (WHERE tag_name ILIKE '%rust%' OR tag_name ILIKE '%corrosion%') as rust_count,
      COUNT(*) FILTER (WHERE tag_name ILIKE '%damage%' OR tag_name ILIKE '%broken%') as damage_count,
      COUNT(*) FILTER (WHERE tag_name ILIKE '%paint%' OR tag_name ILIKE '%restored%' OR tag_name ILIKE '%new%') as restoration_count
    FROM image_tags
    WHERE vehicle_id = p_vehicle_id
  )
  SELECT 
    CASE 
      WHEN rust_count > 10 THEN -v_base_value * 0.15  -- Significant rust = -15%
      WHEN rust_count > 5 THEN -v_base_value * 0.08   -- Some rust = -8%
      WHEN restoration_count > 20 THEN v_base_value * 0.10  -- Fresh restoration = +10%
      ELSE 0
    END
  INTO v_condition_adj
  FROM condition_tags;
  
  -- Cap confidence at 95% (never 100%)
  v_confidence := LEAST(v_confidence, 95);
  
  -- Return results
  RETURN QUERY SELECT 
    (v_base_value + v_parts_value + v_labor_value + v_doc_bonus + v_condition_adj)::NUMERIC as estimated_value,
    v_confidence::NUMERIC as confidence_score,
    v_base_value::NUMERIC as base_value,
    v_parts_value::NUMERIC as parts_value,
    v_labor_value::NUMERIC as labor_value,
    v_doc_bonus::NUMERIC as documentation_bonus,
    v_condition_adj::NUMERIC as condition_adjustment,
    v_data_sources as data_sources,
    jsonb_build_object(
      'base_value', v_base_value,
      'parts_detected', v_part_count,
      'parts_value', v_parts_value,
      'labor_hours', v_labor_hours,
      'labor_value', v_labor_value,
      'labor_rate', v_avg_hourly_rate,
      'receipt_total', v_receipt_total,
      'image_count', v_image_count,
      'ai_tag_count', v_ai_tag_count,
      'documentation_bonus', v_doc_bonus,
      'condition_adjustment', v_condition_adj,
      'confidence', v_confidence,
      'data_sources', v_data_sources
    ) as breakdown;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_ai_driven_vehicle_value(p_vehicle_id uuid)
 RETURNS TABLE(total_value numeric, confidence_score integer, breakdown jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_base_value NUMERIC := 3000;
  v_documented_labor_value NUMERIC := 0;
  v_package_count INTEGER := 0;
  v_receipt_total NUMERIC := 0;
  v_rust_count INTEGER := 0;
  v_confidence INTEGER := 10;
  v_final_value NUMERIC;
BEGIN
  -- Sum work packages
  SELECT COALESCE(SUM(estimated_value), 0), COUNT(*)
  INTO v_documented_labor_value, v_package_count
  FROM detect_work_packages(p_vehicle_id);
  
  -- Get receipts
  SELECT COALESCE(SUM(total_amount), 0) INTO v_receipt_total
  FROM receipts WHERE scope_type = 'vehicle' AND duplicate_of IS NULL and amount_check in ('verified','plausible') AND scope_id::uuid = p_vehicle_id;
  
  -- Check rust
  SELECT COUNT(*) INTO v_rust_count
  FROM image_tags WHERE vehicle_id = p_vehicle_id AND tag_name = 'Rust' AND source_type = 'ai';
  
  -- CALCULATE VALUE
  IF v_receipt_total > 0 THEN
    v_final_value := v_receipt_total * 0.70;
    v_confidence := 70;
  ELSIF v_documented_labor_value > 0 THEN
    -- Work documented = value created (DIY rate = 50% of shop rate)
    v_final_value := v_base_value + (v_documented_labor_value * 0.50);
    v_confidence := 55;
  ELSE
    v_final_value := v_base_value;
    v_confidence := 20;
  END IF;
  
  -- Rust penalty
  IF v_rust_count >= 20 THEN
    v_final_value := v_final_value * 0.60;
    v_confidence := LEAST(v_confidence, 50);
  END IF;
  
  RETURN QUERY SELECT
    ROUND(v_final_value, 0)::NUMERIC,
    v_confidence::INTEGER,
    jsonb_build_object(
      'base_value', v_base_value,
      'work_packages_detected', v_package_count,
      'documented_labor_value', v_documented_labor_value,
      'diy_labor_applied', ROUND((v_documented_labor_value * 0.50)::numeric, 0),
      'receipts_total', v_receipt_total,
      'rust_penalty', v_rust_count >= 20,
      'final_value', ROUND(v_final_value, 0),
      'valuation_basis', CASE
        WHEN v_receipt_total > 0 THEN 'Receipts'
        WHEN v_package_count > 0 THEN format('%s work packages documented', v_package_count)
        ELSE 'No evidence'
      END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_vehicle_stats(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_images bigint; v_total_ai_tags bigint; v_labor_hours numeric;
  v_receipts_value numeric; v_last_activity date; v_systems_worked text[];
BEGIN
  SELECT count(*) INTO v_total_images FROM vehicle_images vi WHERE vi.vehicle_id = p_vehicle_id;
  SELECT count(*) INTO v_total_ai_tags FROM image_tags it JOIN vehicle_images vi ON vi.id = it.image_id WHERE vi.vehicle_id = p_vehicle_id;
  SELECT coalesce(sum(te.labor_hours),0) INTO v_labor_hours FROM timeline_events te WHERE te.vehicle_id = p_vehicle_id;
  SELECT coalesce(sum(r.total_amount),0) INTO v_receipts_value FROM receipts r
    WHERE r.scope_type='vehicle' AND r.is_active = true AND r.scope_id::uuid = p_vehicle_id;
  SELECT greatest(
      (SELECT max(vi.uploaded_at::date) FROM vehicle_images vi WHERE vi.vehicle_id = p_vehicle_id),
      (SELECT max(te.event_date) FROM timeline_events te WHERE te.vehicle_id = p_vehicle_id),
      (SELECT max(r.created_at::date) FROM receipts r WHERE r.scope_type='vehicle' AND r.is_active = true AND r.scope_id::uuid = p_vehicle_id)
    ) INTO v_last_activity;
  SELECT array_agg(DISTINCT it.metadata->>'category') FILTER (WHERE it.metadata->>'category' IS NOT NULL)
    INTO v_systems_worked FROM image_tags it JOIN vehicle_images vi ON vi.id = it.image_id WHERE vi.vehicle_id = p_vehicle_id;
  INSERT INTO vehicle_stats_cache (vehicle_id,total_images,total_ai_tags,total_labor_hours,total_receipts_value,last_activity_date,systems_worked,updated_at)
  VALUES (p_vehicle_id,v_total_images,v_total_ai_tags,v_labor_hours,v_receipts_value,v_last_activity,v_systems_worked,now())
  ON CONFLICT (vehicle_id) DO UPDATE SET
    total_images=EXCLUDED.total_images, total_ai_tags=EXCLUDED.total_ai_tags,
    total_labor_hours=EXCLUDED.total_labor_hours, total_receipts_value=EXCLUDED.total_receipts_value,
    last_activity_date=EXCLUDED.last_activity_date, systems_worked=EXCLUDED.systems_worked, updated_at=now();
END; $function$;

CREATE OR REPLACE FUNCTION public.get_daily_work_receipt(p_vehicle_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_uid uuid := auth.uid();
  v_money boolean := false;
  v_visible boolean := false;
  v_session_id uuid;
  v_vehicle_info jsonb;
  v_photos jsonb;
  v_receipts jsonb;
  v_events jsonb;
  v_line_items jsonb;
  v_session_info jsonb;
BEGIN
  -- Get vehicle info
  SELECT jsonb_build_object(
    'id', v.id,
    'year', v.year,
    'make', v.make,
    'model', v.model,
    'vin', v.vin,
    'trim', v.trim
  ) INTO v_vehicle_info
  FROM vehicles v WHERE v.id = p_vehicle_id;

  IF v_vehicle_info IS NULL THEN
    RETURN jsonb_build_object('error', 'Vehicle not found');
  END IF;

  -- Money is the owner's (owner rule, 2026-09-28): costs, receipts and line-item prices reach the
  -- signed-in owner, uploader or a contributor with access; every other caller gets the same record
  -- with its money masked. A private vehicle reads as NULL for anyone its policies exclude.
  SELECT v_uid IS NOT NULL AND (v.user_id = v_uid OR v.owner_id = v_uid OR v.uploaded_by = v_uid
           OR public.vehicle_user_has_access(v.id, v_uid)),
         coalesce(v.is_public, false)
    INTO v_money, v_visible
  FROM vehicles v WHERE v.id = p_vehicle_id;
  IF NOT (coalesce(v_visible, false) OR coalesce(v_money, false)) THEN
    RETURN NULL;
  END IF;

  -- Get work session for this date (if exists)
  SELECT id INTO v_session_id
  FROM work_sessions
  WHERE vehicle_id = p_vehicle_id
  AND session_date = p_date
  LIMIT 1;

  -- Get session info
  SELECT jsonb_build_object(
    'id', ws.id,
    'title', ws.title,
    'session_date', ws.session_date,
    'start_time', ws.start_time,
    'end_time', ws.end_time,
    'duration_minutes', ws.duration_minutes,
    'work_type', ws.work_type,
    'work_description', ws.work_description,
    'status', ws.status,
    'total_parts_cost', ws.total_parts_cost,
    'total_labor_cost', ws.total_labor_cost,
    'total_job_cost', ws.total_job_cost,
    'image_count', ws.image_count
  ) INTO v_session_info
  FROM work_sessions ws
  WHERE ws.id = v_session_id;

  -- Get photos for this date (with thumbnails)
  -- FILTER: exclude gate-rejected, personal, duplicate, and superseded images.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', vi.id,
      'image_url', vi.image_url,
      'thumbnail_url', COALESCE(vi.thumbnail_url, vi.image_url),
      'taken_at', vi.taken_at,
      'source', vi.source,
      'file_name', vi.file_name,
      'area', vi.area,
      'part', vi.part,
      'operation', vi.operation,
      'fabrication_stage', vi.fabrication_stage,
      'image_type', vi.image_type,
      'category', vi.category,
      'caption', vi.caption
    ) ORDER BY vi.taken_at
  ), '[]'::jsonb) INTO v_photos
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
  AND vi.taken_at::date = p_date
  AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed'))
  AND vi.is_duplicate IS NOT TRUE
  AND vi.is_superseded IS NOT TRUE;

  -- Get receipts/parts for this date
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'vendor_name', r.vendor_name,
      'receipt_date', r.receipt_date,
      'total', r.total,
      'total_amount', r.total_amount,
      'items', r.raw_json->'items',
      'order_number', COALESCE(r.raw_json->>'order_number', r.invoice_number),
      'payment_method', r.payment_method
    ) ORDER BY r.vendor_name
  ), '[]'::jsonb) INTO v_receipts
  FROM receipts r
  WHERE r.vehicle_id = p_vehicle_id
  AND r.receipt_date = p_date;

  -- Get component events for this date
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ce.id,
      'event_type', ce.event_type,
      'event_date', ce.event_date,
      'description', ce.description,
      'component_table', ce.component_table,
      'cost_cents', ce.cost_cents,
      'work_order_id', ce.work_order_id
    ) ORDER BY ce.event_date
  ), '[]'::jsonb) INTO v_events
  FROM component_events ce
  WHERE ce.work_order_id IN (
    SELECT wo.id FROM work_orders wo WHERE wo.vehicle_id = p_vehicle_id
  )
  AND ce.event_date = p_date;

  -- Get work order line items that are relevant to this date's events
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'line_number', li.line_number,
      'task_type', li.task_type,
      'task_description', li.task_description,
      'hours_labor', li.hours_labor,
      'parts_cost_cents', li.parts_cost_cents,
      'total_cost_cents', li.total_cost_cents,
      'status', li.status,
      'notes', li.notes
    ) ORDER BY li.line_number
  ), '[]'::jsonb) INTO v_line_items
  FROM work_order_line_items li
  WHERE li.component_event_id IN (
    SELECT ce.id FROM component_events ce
    WHERE ce.work_order_id IN (
      SELECT wo.id FROM work_orders wo WHERE wo.vehicle_id = p_vehicle_id
    )
    AND ce.event_date = p_date
  );

  -- Build the final receipt
  result := jsonb_build_object(
    'receipt_date', p_date,
    'vehicle', v_vehicle_info,
    'work_session', COALESCE(v_session_info, 'null'::jsonb),
    'photos', v_photos,
    'photo_count', jsonb_array_length(v_photos),
    'receipts', v_receipts,
    'parts_count', (
      SELECT COALESCE(sum(jsonb_array_length(r.raw_json->'items')), 0)
      FROM receipts r
      WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date
    ),
    'parts_total', (
      SELECT COALESCE(sum(r.total::numeric), 0)
      FROM receipts r
      WHERE r.vehicle_id = p_vehicle_id AND r.receipt_date = p_date
    ),
    'component_events', v_events,
    'line_items', v_line_items,
    'summary', jsonb_build_object(
      'has_photos', jsonb_array_length(v_photos) > 0,
      'has_parts', jsonb_array_length(v_receipts) > 0,
      'has_events', jsonb_array_length(v_events) > 0,
      'has_session', v_session_id IS NOT NULL,
      'activity_level', CASE
        WHEN jsonb_array_length(v_photos) > 20 THEN 'heavy'
        WHEN jsonb_array_length(v_photos) > 5 THEN 'moderate'
        WHEN jsonb_array_length(v_photos) > 0 THEN 'light'
        WHEN jsonb_array_length(v_receipts) > 0 THEN 'parts_only'
        ELSE 'no_activity'
      END
    )
  );

  IF NOT coalesce(v_money, false) THEN
    result := public.jsonb_mask_money(result);
  END IF;
  RETURN result || jsonb_build_object('money_masked', NOT coalesce(v_money, false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_work_dates(p_vehicle_id uuid, p_start_date date DEFAULT '2026-02-27'::date, p_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  v_out jsonb;
  v_uid uuid := auth.uid();
  v_money boolean := false;
  v_visible boolean := false;
BEGIN
  -- Money is the owner's (owner rule, 2026-09-28): costs, receipts and line-item prices reach the
  -- signed-in owner, uploader or a contributor with access; every other caller gets the same record
  -- with its money masked. A private vehicle reads as NULL for anyone its policies exclude.
  SELECT v_uid IS NOT NULL AND (v.user_id = v_uid OR v.owner_id = v_uid OR v.uploaded_by = v_uid
           OR public.vehicle_user_has_access(v.id, v_uid)),
         coalesce(v.is_public, false)
    INTO v_money, v_visible
  FROM vehicles v WHERE v.id = p_vehicle_id;
  IF NOT (coalesce(v_visible, false) OR coalesce(v_money, false)) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', ws.session_date,
      'title', ws.title,
      'work_type', ws.work_type,
      'image_count', ws.image_count,
      'duration_minutes', ws.duration_minutes,
      'total_parts_cost', ws.total_parts_cost,
      'has_receipts', ws.total_parts_cost > 0,
      'work_description', ws.work_description,
      'status', ws.status
    ) ORDER BY ws.session_date
  ), '[]'::jsonb) INTO result
  FROM work_sessions ws
  WHERE ws.vehicle_id = p_vehicle_id
  AND ws.session_date BETWEEN p_start_date AND p_end_date;

  v_out := jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'date_range', jsonb_build_object('start', p_start_date, 'end', p_end_date),
    'total_sessions', jsonb_array_length(result),
    'total_photos', (
      SELECT count(*) FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id
      AND taken_at::date BETWEEN p_start_date AND p_end_date
      AND (vision_gate_status IS NULL OR vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed'))
      AND is_duplicate IS NOT TRUE
      AND is_superseded IS NOT TRUE
    ),
    'total_parts_spend', (
      SELECT COALESCE(sum(total::numeric), 0)
      FROM receipts
      WHERE vehicle_id = p_vehicle_id
      AND receipt_date BETWEEN p_start_date AND p_end_date
    ),
    'sessions', result
  );
  IF NOT coalesce(v_money, false) THEN
    v_out := public.jsonb_mask_money(v_out);
  END IF;
  RETURN v_out || jsonb_build_object('money_masked', NOT coalesce(v_money, false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_spending_analytics(target_user_id uuid, target_vehicle_id uuid DEFAULT NULL::uuid, start_date timestamp with time zone DEFAULT (now() - '1 mon'::interval), end_date timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_amount DECIMAL(12,2);
    parts_total DECIMAL(12,2);
    tools_total DECIMAL(12,2);
    labor_total DECIMAL(12,2);
    consumables_total DECIMAL(12,2);
    receipt_cnt INTEGER;
BEGIN
    -- Calculate totals
    SELECT
        COALESCE(SUM(r.total_amount), 0),
        COALESCE(SUM(CASE WHEN ri.category IN ('engine', 'transmission', 'suspension', 'brakes', 'electrical', 'exterior', 'interior') THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category = 'tools' THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category = 'labor' THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category IN ('consumables', 'hardware', 'paint') THEN ri.line_total ELSE 0 END), 0),
        COUNT(DISTINCT r.id)
    INTO total_amount, parts_total, tools_total, labor_total, consumables_total, receipt_cnt
    FROM receipts r
    LEFT JOIN receipt_items ri ON r.id = ri.receipt_id
    WHERE r.user_id = target_user_id AND r.duplicate_of IS NULL and r.amount_check in ('verified','plausible')
    AND r.purchase_date >= start_date
    AND r.purchase_date <= end_date
    AND (target_vehicle_id IS NULL OR r.vehicle_id = target_vehicle_id);

    -- Insert analytics record
    INSERT INTO spending_analytics (
        user_id,
        vehicle_id,
        period_start,
        period_end,
        period_type,
        total_spent,
        parts_spent,
        tools_spent,
        labor_spent,
        consumables_spent,
        receipt_count,
        average_receipt_amount
    ) VALUES (
        target_user_id,
        target_vehicle_id,
        start_date,
        end_date,
        'custom',
        total_amount,
        parts_total,
        tools_total,
        labor_total,
        consumables_total,
        receipt_cnt,
        CASE WHEN receipt_cnt > 0 THEN total_amount / receipt_cnt ELSE 0 END
    )
    ON CONFLICT (user_id, vehicle_id, period_start, period_type) DO UPDATE SET
        total_spent = EXCLUDED.total_spent,
        parts_spent = EXCLUDED.parts_spent,
        tools_spent = EXCLUDED.tools_spent,
        labor_spent = EXCLUDED.labor_spent,
        consumables_spent = EXCLUDED.consumables_spent,
        receipt_count = EXCLUDED.receipt_count,
        average_receipt_amount = EXCLUDED.average_receipt_amount,
        updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_build_reconstruction(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH v AS (
    SELECT v.id, v.year,
           (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()
             OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid())))) IS TRUE AS tied
      FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  l AS (
    SELECT k.item_id, k.receipt_id, k.line_kind, k.anchor_date, k.vendor_name, k.description, k.part_number,
           k.total_price, k.printed_hours, k.printed_performer,
           nullif(left(btrim(public.text_redact_contact(public.receipt_item_product_card(k.item_id) ->> 'name')), 160), '') AS product_name,
           coalesce(public.receipt_line_system(k.description), 'unplaced') AS system_key,
           CASE WHEN k.line_kind IN ('part', 'note', 'kit_component') THEN
             -- only an operation that is stored and applies to this model year; anything else is a gap
             (SELECT o.code FROM public.labor_operations o, v
               WHERE o.code = public.receipt_line_labor_operation(k.description)
                 AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
                 AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)) END AS op_code
      FROM (SELECT w.item_id, w.receipt_id, w.anchor_date, w.vendor_name, w.description, w.part_number,
                   w.total_price, w.printed_hours, w.printed_performer,
                   -- a priced line with no part number whose words are work, not a product: shop work billed without hours
                   CASE WHEN w.line_kind = 'part' AND w.part_number IS NULL AND lower(w.description) ~
                          '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
                        THEN 'service' ELSE w.line_kind END AS line_kind
              FROM v CROSS JOIN LATERAL public.receipt_work_lines(v.id) w
             WHERE w.line_kind IN ('part', 'labor', 'note', 'backordered', 'kit_component')) k),
  ops AS (
    -- each stored operation once per vehicle, however many receipt lines point at it
    -- (an operation whose parts fall in two systems sits in the one holding more of them)
    SELECT system_key, code, name, base_hours, part_lines FROM (
      SELECT DISTINCT ON (g.code) g.system_key, g.code, g.name, g.base_hours, sum(g.n) OVER (PARTITION BY g.code) AS part_lines
        FROM (SELECT l.system_key, o.code, o.name, o.base_hours, count(*) AS n
                FROM l JOIN public.labor_operations o ON o.code = l.op_code
                CROSS JOIN v
               WHERE (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
                 AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)
               GROUP BY l.system_key, o.code, o.name, o.base_hours) g
       ORDER BY g.code, g.n DESC, g.system_key) d
    UNION ALL
    -- machine-shop work on the engine means the engine came out and went back in: one stored operation, named as implied
    SELECT 'engine', o.code, o.name, o.base_hours, 0
      FROM public.labor_operations o CROSS JOIN v
     WHERE o.code = 'MECH-ENGINE-RR' AND EXISTS (SELECT 1 FROM l WHERE l.system_key = 'machining' AND l.line_kind IN ('labor', 'service'))
       AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
       AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)),
  rd AS (
    -- the current reviewed reading of each photo a visitor may see: its build phase, and whether the photo is of a print
    SELECT DISTINCT ON (i.id) i.id AS image_id, i.image_url, i.taken_at, o.structured_data ->> 'build_phase_guess' AS phase,
           o.structured_data ->> 'scene_type' AS scene, o.structured_data #>> '{state_observations,paint_state}' AS paint_state,
           public.photo_reading_is_print(o.structured_data) AS is_print
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'reviewed_image_analysis_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false
     ORDER BY i.id, o.id),
  st AS (
    -- build stages a photograph shows. A print's capture day is the day the sheet was photographed, so it carries no day.
    SELECT public.build_phase_system(rd.phase) AS system_key, rd.phase, count(*) AS images, count(*) FILTER (WHERE rd.is_print) AS prints,
           min(rd.taken_at) FILTER (WHERE NOT rd.is_print)::date AS first_day, max(rd.taken_at) FILTER (WHERE NOT rd.is_print)::date AS last_day,
           (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id, 'image_url', t.image_url) ORDER BY t.taken_at, t.image_id)
              FROM (SELECT x.image_id, x.image_url, x.taken_at FROM rd x WHERE x.phase = rd.phase ORDER BY x.taken_at, x.image_id LIMIT 6) t) AS sample,
           (SELECT jsonb_build_object('description', m.description, 'hours_typical', m.estimated_hours_typical, 'hours_min', m.estimated_hours_min,
                     'hours_max', m.estimated_hours_max, 'confidence', m.confidence, 'source', 'stage_transition_labor_map',
                     'transition', m.from_stage || ' > ' || m.to_stage)
              FROM public.stage_transition_labor_map m
             WHERE m.zone_pattern = '*' AND m.from_stage || '>' || m.to_stage = CASE rd.phase WHEN 'teardown' THEN 'raw>disassembled'
                     WHEN 'paint_prep' THEN 'primed>blocked' WHEN 'paint_application' THEN 'blocked>basecoated' END
             ORDER BY m.id LIMIT 1) AS reference
      FROM rd WHERE public.build_phase_system(rd.phase) IS NOT NULL GROUP BY rd.phase),
  pc AS (
    -- photo readings already keyed to a part (photo_map_harvest_v1), on photos a visitor may see
    SELECT public.photo_part_key_system(o.structured_data ->> 'part_key') AS system_key, i.id AS image_id, i.image_url,
           CASE WHEN EXISTS (SELECT 1 FROM rd WHERE rd.image_id = i.id AND rd.is_print) THEN NULL ELSE i.taken_at END AS taken_at, o.id AS observation_id
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'photo_map_harvest_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.photo_part_key_system(o.structured_data ->> 'part_key') IS NOT NULL
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false),
  ph AS (
    SELECT pc.system_key, count(DISTINCT pc.image_id) AS images, count(DISTINCT pc.observation_id) AS readings,
           min(pc.taken_at)::date AS first_day, max(pc.taken_at)::date AS last_day,
           (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id, 'image_url', t.image_url) ORDER BY t.n DESC, t.image_id)
              FROM (SELECT x.image_id, x.image_url, count(*) AS n FROM pc x WHERE x.system_key = pc.system_key
                     GROUP BY x.image_id, x.image_url ORDER BY count(*) DESC, x.image_id LIMIT 6) t) AS sample
      FROM pc GROUP BY pc.system_key),
  sys AS (
    SELECT l.system_key,
           min(l.anchor_date) AS first_day, max(l.anchor_date) AS last_day,
           count(*) FILTER (WHERE l.line_kind = 'part') AS part_lines,
           count(*) FILTER (WHERE l.line_kind = 'backordered') AS backordered_lines,
           count(*) FILTER (WHERE l.line_kind IN ('labor', 'note', 'service')) AS paper_work_lines,
           count(*) FILTER (WHERE l.line_kind IN ('labor', 'note', 'service') AND l.printed_hours IS NULL) AS paper_work_lines_without_hours,
           sum(l.printed_hours) AS paper_hours,
           count(DISTINCT l.printed_performer) FILTER (WHERE nullif(btrim(l.printed_performer), '') IS NOT NULL) AS performers,
           count(*) FILTER (WHERE l.line_kind = 'part' AND l.op_code IS NULL) AS parts_without_reference,
           count(*) FILTER (WHERE l.total_price IS NOT NULL) AS priced_lines,
           sum(l.total_price) AS recorded_amount,
           (SELECT coalesce(jsonb_agg(DISTINCT nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), '')), '[]'::jsonb)
              FROM l x WHERE x.system_key = l.system_key AND x.line_kind IN ('labor', 'note', 'service')) AS shops,
           (SELECT coalesce(jsonb_agg(DISTINCT nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), '')), '[]'::jsonb)
              FROM l x WHERE x.system_key = l.system_key AND x.line_kind = 'part') AS suppliers
      FROM l GROUP BY l.system_key),
  keys AS (SELECT system_key FROM sys UNION SELECT system_key FROM ph UNION SELECT system_key FROM st),
  lf AS (SELECT DISTINCT ON (system_key) system_key, item_id, anchor_date FROM l WHERE anchor_date IS NOT NULL ORDER BY system_key, anchor_date, item_id),
  ll AS (SELECT DISTINCT ON (system_key) system_key, item_id, anchor_date FROM l WHERE anchor_date IS NOT NULL ORDER BY system_key, anchor_date DESC, item_id),
  lw AS (SELECT DISTINCT ON (system_key) system_key, item_id, anchor_date FROM l
          WHERE anchor_date IS NOT NULL AND line_kind IN ('labor', 'note', 'service') ORDER BY system_key, anchor_date, item_id),
  dn AS (
    -- the first dated, non-print photograph showing a system's work as done: the car is assembled or finished, and for paint the
    -- exterior is in view and is not bare metal or primer. A print carries no day (pc.taken_at is null for it; rd.is_print is excluded).
    SELECT DISTINCT ON (c.system_key) c.system_key, c.image_id, c.day FROM (
      SELECT pc.system_key, pc.image_id, pc.taken_at::date AS day
        FROM pc JOIN rd ON rd.image_id = pc.image_id
       WHERE pc.taken_at IS NOT NULL AND NOT rd.is_print AND rd.phase IN ('final_assembly', 'show_finish')
      UNION ALL
      SELECT 'paint', rd.image_id, rd.taken_at::date
        FROM rd WHERE rd.taken_at IS NOT NULL AND NOT rd.is_print AND rd.phase IN ('final_assembly', 'show_finish')
         AND rd.scene = 'body_exterior' AND coalesce(rd.paint_state, '') NOT IN ('bare_metal', 'primer')) c
     ORDER BY c.system_key, c.day, c.image_id),
  win AS (
    SELECT k.system_key, ea.item_id AS e_item, ea.day AS earliest, ea.before_system AS e_before,
           la.id AS l_id, la.day AS latest, la.src AS l_src, la.after_system AS l_after, (lf.system_key IS NOT NULL) AS has_paper
      FROM keys k
      LEFT JOIN lf USING (system_key)
      LEFT JOIN LATERAL (
        SELECT u.item_id, u.day, u.before_system FROM (
          SELECT f.item_id, f.anchor_date AS day, NULL::text AS before_system, 1 AS pri FROM lf f WHERE f.system_key = k.system_key
          UNION ALL
          SELECT g.item_id, g.anchor_date, p.before_system, 2 FROM public.build_system_precedence() p
            JOIN ll g ON g.system_key = p.before_system WHERE p.after_system = k.system_key) u
         ORDER BY u.pri, u.day DESC, u.item_id LIMIT 1) ea ON true
      LEFT JOIN LATERAL (
        SELECT u.id, u.day, u.src, u.after_system FROM (
          SELECT d.image_id AS id, d.day, 'photograph' AS src, NULL::text AS after_system FROM dn d WHERE d.system_key = k.system_key
          UNION ALL
          SELECT w.item_id, w.anchor_date, 'receipt_line', p.after_system FROM public.build_system_precedence() p
            JOIN lw w ON w.system_key = p.after_system WHERE p.before_system = k.system_key) u
         WHERE ea.day IS NULL OR u.day >= ea.day
         ORDER BY u.day, u.src, u.id LIMIT 1) la ON true),
  wj AS (
    SELECT w.system_key,
           jsonb_build_object('earliest', w.earliest, 'latest', w.latest,
             'kind', CASE WHEN w.has_paper AND w.latest IS NOT NULL THEN 'documented'
                          WHEN w.earliest IS NOT NULL AND w.latest IS NOT NULL THEN 'bounded'
                          WHEN w.earliest IS NOT NULL THEN 'open_end' WHEN w.latest IS NOT NULL THEN 'open_start' ELSE 'unknown' END,
             'basis', (SELECT coalesce(jsonb_agg(b), '[]'::jsonb) FROM (
                SELECT jsonb_build_object('end', 'earliest', 'kind', 'receipt_line', 'id', w.e_item, 'day', w.earliest,
                         'phrase', CASE WHEN w.e_before IS NULL THEN 'first line recorded for this system'
                                        ELSE 'last line recorded for ' || w.e_before || ', which comes before ' || w.system_key || ' in build order' END) b
                 WHERE w.earliest IS NOT NULL
                UNION ALL
                SELECT jsonb_build_object('end', 'latest', 'kind', w.l_src, 'id', w.l_id, 'day', w.latest,
                         'phrase', CASE WHEN w.l_src = 'photograph' AND w.system_key = 'paint' THEN 'first photograph showing finished paint'
                                        WHEN w.l_src = 'photograph' THEN 'first photograph of an assembled car showing this system'
                                        ELSE 'first shop work recorded for ' || w.l_after || ', which comes after ' || w.system_key || ' in build order' END)
                 WHERE w.latest IS NOT NULL) x)) AS win
      FROM win w)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE jsonb_build_object(
    'function', 'vehicle_build_reconstruction', 'version', 1, 'vehicle_id', p_vehicle_id, 'as_of', statement_timestamp(),
    'amounts_visible', (SELECT tied FROM v),
    'rule', 'Each current receipt line is read into a car system by its words. Paper hours are the hours printed on shop documents. Reference hours come from labor_operations, each operation once per vehicle. The two are separate lenses and are never added. A build stage seen in a photograph carries the stored hour range for that stage (stage_transition_labor_map) as a third, separate measure; a photograph of a print carries no day. A part with no stored fitting operation is counted as a gap.',
    'totals', (SELECT jsonb_build_object(
        'lines', (SELECT count(*) FROM l),
        'placed_lines', (SELECT count(*) FROM l WHERE system_key <> 'unplaced'),
        'receipts', (SELECT count(DISTINCT receipt_id) FROM l),
        'first_day', (SELECT min(anchor_date) FROM l), 'last_day', (SELECT max(anchor_date) FROM l),
        'part_lines', (SELECT count(*) FROM l WHERE line_kind = 'part'),
        'paper_work_lines', (SELECT count(*) FROM l WHERE line_kind IN ('labor', 'note', 'service')),
        'paper_hours', (SELECT sum(printed_hours) FROM l),
        'reference_hours', (SELECT sum(base_hours) FROM ops),
        'photo_images', (SELECT count(DISTINCT image_id) FROM pc),
        'stage_images', (SELECT sum(images) FROM st),
        'stage_hours', (SELECT jsonb_build_object('typical', sum((reference ->> 'hours_typical')::numeric), 'min', sum((reference ->> 'hours_min')::numeric),
                          'max', sum((reference ->> 'hours_max')::numeric), 'stages', count(*)) FROM st WHERE reference IS NOT NULL),
        'reference_operations', (SELECT count(*) FROM ops),
        'parts_without_reference', (SELECT count(*) FROM l WHERE line_kind = 'part' AND op_code IS NULL),
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN (SELECT sum(total_price) FROM l) END)),
    'systems_without_paper', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
        FROM unnest(ARRAY['engine','machining','fuel','cooling','exhaust','electrical','brakes','steering','suspension','axle',
                          'transmission','body','paint','glass','interior','trim','tires']) k
       WHERE NOT EXISTS (SELECT 1 FROM sys s WHERE s.system_key = k)),
    'systems', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'system_key', k.system_key, 'first_day', s.first_day, 'last_day', s.last_day, 'window', wj.win,
        'photos', CASE WHEN p.system_key IS NOT NULL THEN jsonb_build_object('images', p.images, 'readings', p.readings,
                    'first_day', p.first_day, 'last_day', p.last_day, 'sample', p.sample) END,
        'stages', (SELECT jsonb_agg(jsonb_build_object('phase', t.phase, 'images', t.images, 'prints', t.prints, 'first_day', t.first_day,
                     'last_day', t.last_day, 'sample', t.sample, 'reference', t.reference) ORDER BY t.phase)
                     FROM st t WHERE t.system_key = k.system_key),
        'part_lines', coalesce(s.part_lines, 0), 'backordered_lines', coalesce(s.backordered_lines, 0), 'suppliers', coalesce(s.suppliers, '[]'::jsonb),
        'paper', jsonb_build_object('lines', coalesce(s.paper_work_lines, 0), 'lines_without_hours', coalesce(s.paper_work_lines_without_hours, 0),
                                    'hours', s.paper_hours, 'performers', coalesce(s.performers, 0), 'shops', coalesce(s.shops, '[]'::jsonb),
                                    'subjects', (SELECT coalesce(jsonb_agg(DISTINCT t.subject), '[]'::jsonb) FROM (
                                        SELECT nullif(left(btrim(public.text_redact_contact(r.raw_json #>> '{data_v2,vehicle_hint}')), 200), '') AS subject
                                          FROM public.receipts r
                                         WHERE r.id IN (SELECT x.receipt_id FROM l x WHERE x.system_key = k.system_key AND x.line_kind IN ('labor', 'note', 'service'))) t
                                         WHERE t.subject IS NOT NULL)),
        'reference', jsonb_build_object(
            'hours', (SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = k.system_key),
            'operations', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'hours', o.base_hours,
                             'part_lines', o.part_lines, 'source', 'labor_operations',
                             'basis', CASE WHEN o.part_lines = 0 THEN 'implied_by_machine_shop_work' ELSE 'part_on_receipt' END) ORDER BY o.base_hours DESC, o.code), '[]'::jsonb)
                             FROM ops o WHERE o.system_key = k.system_key),
            'parts_without_reference', coalesce(s.parts_without_reference, 0)),
        'priced_lines', coalesce(s.priced_lines, 0),
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN s.recorded_amount END,
        'lines', (SELECT jsonb_agg(jsonb_build_object(
                    'item_id', x.item_id, 'receipt_id', x.receipt_id, 'kind', x.line_kind, 'day', x.anchor_date,
                    'source', nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), ''),
                    'description', nullif(left(btrim(public.text_redact_contact(CASE WHEN (SELECT tied FROM v) THEN x.description
                                                                  ELSE public.receipt_line_strip_list_price(x.description) END)), 500), ''),
                    'name', x.product_name,
                    'part_number', x.part_number, 'paper_hours', x.printed_hours, 'operation_code', x.op_code,
                    'amount', CASE WHEN (SELECT tied FROM v) THEN x.total_price END)
                    ORDER BY x.anchor_date NULLS LAST, x.item_id)
                    FROM l x WHERE x.system_key = k.system_key))
        ORDER BY coalesce(s.paper_hours, 0) + coalesce((SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = k.system_key), 0) DESC,
                 coalesce(s.part_lines, 0) DESC, coalesce(p.images, 0) DESC, k.system_key), '[]'::jsonb) FROM (SELECT system_key FROM sys UNION SELECT system_key FROM ph UNION SELECT system_key FROM st) k
        LEFT JOIN sys s USING (system_key) LEFT JOIN ph p USING (system_key) LEFT JOIN wj USING (system_key)),
    'reconstructed_systems', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'system_key', k.system_key, 'window', wj.win,
        'photos', CASE WHEN p.system_key IS NOT NULL THEN jsonb_build_object('images', p.images, 'readings', p.readings,
                    'first_day', p.first_day, 'last_day', p.last_day) END,
        'stages', (SELECT jsonb_agg(jsonb_build_object('phase', t.phase, 'images', t.images, 'prints', t.prints, 'first_day', t.first_day,
                     'last_day', t.last_day, 'reference', t.reference) ORDER BY t.phase) FROM st t WHERE t.system_key = k.system_key),
        'stage_hours', (SELECT jsonb_build_object('typical', sum((t.reference ->> 'hours_typical')::numeric), 'min', sum((t.reference ->> 'hours_min')::numeric),
                          'max', sum((t.reference ->> 'hours_max')::numeric), 'stages', count(*))
                          FROM st t WHERE t.system_key = k.system_key AND t.reference IS NOT NULL HAVING count(*) > 0)) ORDER BY k.system_key), '[]'::jsonb)
        FROM keys k LEFT JOIN ph p USING (system_key) LEFT JOIN wj USING (system_key)
       WHERE NOT EXISTS (SELECT 1 FROM sys s WHERE s.system_key = k.system_key))) END
$function$;

RESET check_function_bodies;

CREATE VIEW public.vehicle_receipts WITH (security_invoker=true) AS
SELECT l.receipt_id AS id,
    l.receipt_id,
    l.vehicle_id,
    r.user_id,
    COALESCE(r.total_amount, r.total) AS total_amount,
    r.vendor_name,
    l.page_date AS receipt_date,
    l.page_date_source,
    ( SELECT jsonb_agg(jsonb_build_object('description', i.description, 'part_number', i.part_number, 'category', i.category, 'quantity', i.quantity, 'unit_price', i.unit_price, 'total_price', i.total_price)) AS jsonb_agg
           FROM receipt_items i
          WHERE (i.receipt_id = l.receipt_id)) AS items,
    l.basis AS link_basis,
    l.basis_ref,
    l.confidence,
    l.tie_kind,
    l.type_gate,
    l.run_id,
    COALESCE(((l.basis_ref ->> 'provisional'::text))::boolean, false) AS provisional,
    r.file_url,
    r.created_at
   FROM (receipt_vehicle_links l
     JOIN receipts r ON ((r.id = l.receipt_id)))
  WHERE ((l.status = 'linked'::text) AND (l.retired_at IS NULL) AND (r.duplicate_of IS NULL) AND (NOT receipt_doc_kind_excluded(r.document_kind)));

CREATE VIEW public.vehicle_receipts_rollup_v WITH (security_barrier=true) AS
SELECT g.vehicle_id,
        CASE
            WHEN t.tied THEN g.total_lifetime
            ELSE NULL::numeric
        END AS total_lifetime,
        CASE
            WHEN t.tied THEN g.total_90d
            ELSE NULL::numeric
        END AS total_90d,
        CASE
            WHEN t.tied THEN g.total_365d
            ELSE NULL::numeric
        END AS total_365d,
    g.receipts_count,
    t.tied AS amounts_visible
   FROM ((( SELECT (r.scope_id)::uuid AS vehicle_id,
            sum(
                CASE
                    WHEN (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_lifetime,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '90 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_90d,
            sum(
                CASE
                    WHEN ((COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (r.transaction_date >= ((now() - '365 days'::interval))::date)) THEN r.total_amount
                    ELSE (0)::numeric
                END) AS total_365d,
            count(*) FILTER (WHERE (COALESCE(r.processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
           FROM receipts r
          WHERE ((r.scope_type = 'vehicle'::text) AND (NOT receipt_doc_kind_excluded(r.document_kind)) AND ((r.duplicate_of IS NULL) AND (r.amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))))
          GROUP BY r.scope_id) g
     JOIN vehicles v ON ((v.id = g.vehicle_id)))
     CROSS JOIN LATERAL ( SELECT (o.own OR (( SELECT auth.role() AS role) = 'service_role'::text)) AS tied,
            o.own
           FROM ( SELECT
                        CASE
                            WHEN (( SELECT auth.uid() AS uid) IS NULL) THEN false
                            ELSE (COALESCE((( SELECT auth.uid() AS uid) = ANY (ARRAY[v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by])), false) OR vehicle_user_has_access(v.id, ( SELECT auth.uid() AS uid)))
                        END AS own) o) t)
  WHERE (((v.is_public = true) AND (v.deleted_at IS NULL)) OR t.own);

CREATE VIEW public.v_vehicle_monthly_basis WITH (security_invoker=true) AS
WITH vehicle_first_activity AS (
         SELECT v_1.id AS vehicle_id,
            v_1.user_id,
            LEAST(( SELECT min(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, (r.created_at)::date)) AS min
                   FROM receipts r
                  WHERE ((r.vehicle_id = v_1.id) AND (COALESCE(r.is_active, true) = true) AND (COALESCE(r.is_superseded, false) = false) AND (NOT receipt_doc_kind_excluded(r.document_kind)))), ( SELECT min((pe.paid_at)::date) AS min
                   FROM payment_events pe
                  WHERE ((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = v_1.id) AND (COALESCE(pe.is_superseded, false) = false))), ( SELECT min((vo.observed_at)::date) AS min
                   FROM vehicle_observations vo
                  WHERE ((vo.vehicle_id = v_1.id) AND (vo.kind = 'ownership'::observation_kind) AND (COALESCE(vo.is_superseded, false) = false)))) AS first_activity_date
           FROM vehicles v_1
          WHERE (v_1.user_id IS NOT NULL)
        ), months AS (
         SELECT vfa.vehicle_id,
            vfa.user_id,
            (date_trunc('month'::text, gs.gs))::date AS month
           FROM (vehicle_first_activity vfa
             CROSS JOIN LATERAL generate_series(date_trunc('month'::text, (vfa.first_activity_date)::timestamp without time zone), date_trunc('month'::text, (CURRENT_DATE)::timestamp without time zone), '1 mon'::interval) gs(gs))
          WHERE (vfa.first_activity_date IS NOT NULL)
        ), cum_receipts AS (
         SELECT m_1.vehicle_id,
            m_1.month,
            COALESCE(sum(COALESCE(r.total, r.total_amount, r.subtotal)), (0)::numeric) AS cumulative_receipts_usd
           FROM (months m_1
             LEFT JOIN receipts r ON (((r.vehicle_id = m_1.vehicle_id) AND (COALESCE(r.is_active, true) = true) AND (COALESCE(r.is_superseded, false) = false) AND (NOT receipt_doc_kind_excluded(r.document_kind)) AND (COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, (r.created_at)::date) <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
          GROUP BY m_1.vehicle_id, m_1.month
        ), cum_pay_in AS (
         SELECT m_1.vehicle_id,
            m_1.month,
            COALESCE(sum(pe.amount_usd), (0)::numeric) AS cumulative_payments_in_usd
           FROM (months m_1
             LEFT JOIN payment_events pe ON (((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = m_1.vehicle_id) AND (pe.direction = 'in'::text) AND (COALESCE(pe.is_superseded, false) = false) AND ((pe.paid_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
          GROUP BY m_1.vehicle_id, m_1.month
        ), cum_pay_out AS (
         SELECT m_1.vehicle_id,
            m_1.month,
            COALESCE(sum(pe.amount_usd), (0)::numeric) AS cumulative_payments_out_usd
           FROM (months m_1
             LEFT JOIN payment_events pe ON (((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = m_1.vehicle_id) AND (pe.direction = 'out'::text) AND (COALESCE(pe.is_superseded, false) = false) AND ((pe.paid_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
          GROUP BY m_1.vehicle_id, m_1.month
        ), val_per_month AS (
         SELECT m_1.vehicle_id,
            m_1.month,
            ( SELECT ((vo.structured_data ->> 'value_usd'::text))::numeric AS "numeric"
                   FROM vehicle_observations vo
                  WHERE ((vo.vehicle_id = m_1.vehicle_id) AND (vo.kind = 'valuation'::observation_kind) AND (vo.structured_data ? 'value_usd'::text) AND (COALESCE(vo.is_superseded, false) = false) AND ((vo.observed_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))
                  ORDER BY vo.observed_at DESC
                 LIMIT 1) AS observed_value_usd
           FROM months m_1
        )
 SELECT m.user_id,
    m.vehicle_id,
    m.month,
    v.year,
    v.make,
    v.model,
    v.vin,
    cr.cumulative_receipts_usd,
    cpi.cumulative_payments_in_usd,
    cpo.cumulative_payments_out_usd,
    (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd) AS cost_basis_usd,
    cpi.cumulative_payments_in_usd AS proceeds_usd,
        CASE
            WHEN ((COALESCE(v.sale_status, ''::text) = 'sold'::text) AND (cpi.cumulative_payments_in_usd > (0)::numeric)) THEN 'sold'::text
            WHEN (cpi.cumulative_payments_in_usd > (0)::numeric) THEN 'sold'::text
            WHEN (COALESCE(v.sale_status, ''::text) = 'consigned'::text) THEN 'consigned'::text
            WHEN ((cr.cumulative_receipts_usd > (0)::numeric) OR (cpo.cumulative_payments_out_usd > (0)::numeric)) THEN 'held'::text
            ELSE 'unknown'::text
        END AS holding_status,
    COALESCE(vpm.observed_value_usd, v.nuke_estimate, v.cz_estimated_value, v.current_value) AS estimated_value_usd,
        CASE
            WHEN (cpi.cumulative_payments_in_usd > (0)::numeric) THEN (cpi.cumulative_payments_in_usd - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd))
            ELSE (COALESCE(vpm.observed_value_usd, v.nuke_estimate, v.cz_estimated_value, v.current_value, (0)::numeric) - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd))
        END AS net_position_usd
   FROM (((((months m
     JOIN vehicles v ON ((v.id = m.vehicle_id)))
     LEFT JOIN cum_receipts cr ON (((cr.vehicle_id = m.vehicle_id) AND (cr.month = m.month))))
     LEFT JOIN cum_pay_in cpi ON (((cpi.vehicle_id = m.vehicle_id) AND (cpi.month = m.month))))
     LEFT JOIN cum_pay_out cpo ON (((cpo.vehicle_id = m.vehicle_id) AND (cpo.month = m.month))))
     LEFT JOIN val_per_month vpm ON (((vpm.vehicle_id = m.vehicle_id) AND (vpm.month = m.month))));

CREATE VIEW public.v_garage_asset_summary AS
SELECT v.user_id,
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    v.color,
    LEAST(ps.first_photo_at, (os.first_ownership_at)::date, rs.first_receipt_at) AS acquired_at,
    (es.sold_at)::date AS disposed_at,
        CASE
            WHEN (LEAST(ps.first_photo_at, (os.first_ownership_at)::date, rs.first_receipt_at) IS NULL) THEN NULL::integer
            ELSE (COALESCE((es.sold_at)::date, CURRENT_DATE) - LEAST(ps.first_photo_at, (os.first_ownership_at)::date, rs.first_receipt_at))
        END AS days_held,
    COALESCE(ps.photo_count, (0)::bigint) AS photo_count,
    COALESCE(os.observation_count, (0)::bigint) AS observation_count,
    COALESCE(rs.receipt_count, (0)::bigint) AS receipt_count,
    COALESCE(rs.total_receipts_usd, (0)::numeric) AS total_receipts_usd,
    COALESCE(os.observed_purchase_price, v.purchase_price) AS acquisition_cost_usd,
    COALESCE(es.final_sale_price, os.observed_sale_amount, v.bat_sold_price, v.canonical_sold_price, (v.sold_price)::numeric) AS sale_proceeds_usd,
    COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value, os.observed_valuation) AS estimated_current_value_usd,
        CASE
            WHEN (es.sold_at IS NOT NULL) THEN (COALESCE(es.final_sale_price, os.observed_sale_amount, v.bat_sold_price, v.canonical_sold_price, (v.sold_price)::numeric, (0)::numeric) - COALESCE(rs.total_receipts_usd, (0)::numeric))
            ELSE (COALESCE(v.nuke_estimate, v.cz_estimated_value, v.current_value, os.observed_valuation, (0)::numeric) - COALESCE(rs.total_receipts_usd, (0)::numeric))
        END AS net_position_usd,
    GREATEST(ps.last_photo_at, os.last_observation_at, rs.last_receipt_at, es.last_event_at) AS last_activity_at
   FROM ((((vehicles v
     LEFT JOIN LATERAL ( SELECT count(*) AS photo_count,
            (min(COALESCE(vi.taken_at, vi.created_at)))::date AS first_photo_at,
            max(COALESCE(vi.taken_at, vi.created_at)) AS last_photo_at
           FROM vehicle_images vi
          WHERE ((vi.vehicle_id = v.id) AND (COALESCE(vi.is_duplicate, false) = false) AND (COALESCE(vi.is_superseded, false) = false))) ps ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS observation_count,
            max(vo.observed_at) AS last_observation_at,
            max(((vo.structured_data ->> 'purchase_price'::text))::numeric) FILTER (WHERE (((vo.kind)::text = ANY (ARRAY['ownership'::text, 'provenance'::text])) AND (vo.structured_data ? 'purchase_price'::text))) AS observed_purchase_price,
            max(((vo.structured_data ->> 'value_usd'::text))::numeric) FILTER (WHERE (((vo.kind)::text = ANY (ARRAY['valuation'::text, 'market_value'::text])) AND (vo.structured_data ? 'value_usd'::text))) AS observed_valuation,
            max(((vo.structured_data ->> 'amount_usd'::text))::numeric) FILTER (WHERE (((vo.kind)::text = 'sale_result'::text) AND (vo.structured_data ? 'amount_usd'::text))) AS observed_sale_amount,
            min(vo.observed_at) FILTER (WHERE ((vo.kind)::text = 'ownership'::text)) AS first_ownership_at
           FROM vehicle_observations vo
          WHERE ((vo.vehicle_id = v.id) AND (COALESCE(vo.is_superseded, false) = false))) os ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS receipt_count,
            sum(COALESCE(r.total, r.total_amount, r.subtotal)) AS total_receipts_usd,
            min(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date)) AS first_receipt_at,
            max(COALESCE((r.purchase_date)::timestamp with time zone, (r.transaction_date)::timestamp with time zone, (r.receipt_date)::timestamp with time zone, r.created_at)) AS last_receipt_at
           FROM receipts r
          WHERE ((r.vehicle_id = v.id) AND (COALESCE(r.is_active, true) = true) AND (COALESCE(r.is_superseded, false) = false))) rs ON (true))
     LEFT JOIN LATERAL ( SELECT max(ve.final_price) FILTER (WHERE (ve.event_status = 'sold'::text)) AS final_sale_price,
            max(ve.sold_at) FILTER (WHERE (ve.event_status = 'sold'::text)) AS sold_at,
            max(COALESCE(ve.sold_at, ve.ended_at, ve.started_at)) AS last_event_at
           FROM vehicle_events ve
          WHERE (ve.vehicle_id = v.id)) es ON (true))
  WHERE (v.user_id IS NOT NULL);

CREATE VIEW public.user_receipt_summary WITH (security_invoker=true) AS
WITH vendor_counts AS (
         SELECT r.user_id,
            r.vendor_name,
            count(*) AS receipt_count,
            sum(r.total_amount) AS vendor_total
           FROM receipts r
          WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.vendor_name IS NOT NULL) AND (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL) AND (r.amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check])))
          GROUP BY r.user_id, r.vendor_name
        ), category_totals AS (
         SELECT li.user_id,
            COALESCE(li.category, 'uncategorized'::text) AS category,
            sum(li.total_price) AS category_total,
            count(*) AS item_count
           FROM line_items li
          WHERE ((li.user_id = ( SELECT auth.uid() AS uid)) AND (li.total_price IS NOT NULL))
          GROUP BY li.user_id, COALESCE(li.category, 'uncategorized'::text)
        ), user_stats AS (
         SELECT r.user_id,
            count(DISTINCT r.id) AS total_receipts,
            sum(r.total_amount) AS total_spending,
            min(r.transaction_date) AS first_receipt_date,
            max(r.transaction_date) AS last_receipt_date,
            avg(r.total_amount) AS avg_receipt_amount
           FROM receipts r
          WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL) AND (r.amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check])))
          GROUP BY r.user_id
        )
 SELECT user_id,
    total_receipts,
    total_spending,
    first_receipt_date,
    last_receipt_date,
    avg_receipt_amount,
    COALESCE(( SELECT jsonb_object_agg(vc.vendor_name, jsonb_build_object('count', vc.receipt_count, 'total', vc.vendor_total)) AS jsonb_object_agg
           FROM vendor_counts vc
          WHERE (vc.user_id = us.user_id)), '{}'::jsonb) AS vendor_breakdown,
    COALESCE(( SELECT jsonb_object_agg(ct.category, jsonb_build_object('total', ct.category_total, 'items', ct.item_count)) AS jsonb_object_agg
           FROM category_totals ct
          WHERE (ct.user_id = us.user_id)), '{}'::jsonb) AS spending_by_category
   FROM user_stats us
  WHERE (user_id = ( SELECT auth.uid() AS uid));

CREATE TRIGGER trg_receipts_document_kind BEFORE INSERT OR UPDATE OF vendor_name, raw_extraction, raw_json, total_amount, total
  ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.receipts_set_document_kind();

-- The fixture is the live system: each definition the migration replaces has the md5 it was read with.
CREATE TABLE public.fixture_read(obj text PRIMARY KEY, is_view boolean, md5 text, quoted_after int);
INSERT INTO public.fixture_read VALUES
  ('public.calculate_ai_vehicle_valuation(uuid)', false, '8501123d999e2569ee9ed7358ea82227', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.classify_vehicle_build_class(uuid[])', false, 'ade65f625fb0fcb99adaabf63e955522', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.compute_ai_driven_vehicle_value(uuid)', false, 'ed3a67af71394b015625158d28468d48', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.compute_vehicle_investment_proof(uuid)', false, '114e430ff4f935e79af12c7dcf58a3fc', 2), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.compute_vehicle_value(uuid)', false, '4adf7fa1cbfb451849334d389bf59ad0', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.generate_spending_analytics(uuid,uuid,timestamp with time zone,timestamp with time zone)', false, '0b639865399cc6477daecc20d9cebdfc', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.get_daily_work_receipt(uuid,date)', false, 'b0ead8fc99ecc32dc27ec7b8ddb62b50', 2), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.get_vehicle_investment_timeline(uuid)', false, 'b7b97fe81e6d5f5034df3967e88274c9', 3), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.get_vehicle_total_invested(uuid)', false, 'e34635a3ebf6a83678f82c326bf31fe2', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.get_vehicle_work_dates(uuid,date,date)', false, '0c46778470210a319288fafa703b9a8a', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.land_document_pages(uuid,uuid,text,jsonb)', false, 'e6e785dc9309544936454c3c9fcfec44', 0), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.nuke_build_class(uuid)', false, '9a7242506ea230b4540b2631e5bcd63d', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.receipts_set_document_kind()', false, 'e71a5f5af91532330072febfc3f44447', 0), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.receipt_work_lines(uuid,integer,integer)', false, 'd3f9a149f207dbc9d464426245c519e3', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.update_vehicle_stats(uuid)', false, '6521a9f47bce7eace483a57361cb4c98', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.vehicle_build_reconstruction(uuid)', false, 'a41252a78e33dcd6c49bdcc7da792597', 0), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.vehicle_machine_shop_lines(uuid)', false, 'c55790fffd7eb084310a9d5cbd4fdd6c', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.user_receipt_summary', true, 'd645290a07a09bd41eba5fef460ecc72', 2), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.v_garage_asset_summary', true, '1a2483ae2dd65105769d3db98f1dc8af', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.v_vehicle_monthly_basis', true, '06b3efd0f2aace947cb1a58c8fd8052a', 2), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.vehicle_receipts', true, 'ea6d806798d73dbf2d08d6707a925f5f', 1), -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
  ('public.vehicle_receipts_rollup_v', true, '5a92cac18f62b45716668f02650be57a', 1); -- gitleaks:allow (definition fingerprint read 2026-11-21, not a secret)
SELECT public.assert(md5(CASE WHEN f.is_view THEN pg_get_viewdef(f.obj::regclass) ELSE pg_get_functiondef(f.obj::regprocedure) END) = f.md5,
                     f.obj || ' fixture is not the definition read 2026-11-21') FROM public.fixture_read f;

\ir ../migrations/20261121233000_receipt_quote_kind.sql

-- Each spend reader carries the predicate where it was read; the writer and the lander changed only where named.
SELECT public.assert((length(d) - length(replace(d, 'receipt_doc_kind_quoted', ''))) / length('receipt_doc_kind_quoted') = f.quoted_after
                     OR (f.obj LIKE '%vehicle_build_reconstruction%' AND d LIKE '%receipt_doc_kind_quoted(r.document_kind)%'),
                     f.obj || ' predicate count') FROM public.fixture_read f,
  LATERAL (SELECT CASE WHEN f.is_view THEN pg_get_viewdef(f.obj::regclass) ELSE pg_get_functiondef(f.obj::regprocedure) END AS d) x
 WHERE f.obj NOT LIKE '%receipts_set_document_kind%' AND f.obj NOT LIKE '%land_document_pages%';
SELECT public.assert(pg_get_functiondef('public.receipts_set_document_kind()'::regprocedure) LIKE '%{data_v2,document_type}%', 'writer reads nested type');
SELECT public.assert(pg_get_functiondef('public.land_document_pages(uuid,uuid,text,jsonb)'::regprocedure)
                     LIKE '%''estimate'',''quote'',''agreement''%', 'lander accepts quote and agreement');
SELECT public.assert(NOT public.receipt_doc_kind_excluded('quote'), 'a quote is not excluded: its link to the car stays');
SELECT public.assert(public.receipt_doc_kind_quoted('quote') AND NOT public.receipt_doc_kind_quoted('parts_service')
                     AND NOT public.receipt_doc_kind_quoted(NULL), 'quoted predicate');
SELECT public.assert(public.receipt_line_quote_option('option A') = 'A' AND public.receipt_line_quote_option('Option: 2') = '2'
                     AND public.receipt_line_quote_option('option B (accepted)') = 'B' AND public.receipt_line_quote_option('option B accepted') = 'B'
                     AND public.receipt_line_quote_option('optional extras') IS NULL AND public.receipt_line_quote_option('engine') IS NULL
                     AND public.receipt_line_quote_option(NULL) IS NULL AND public.receipt_line_quote_option('option') IS NULL, 'option labels');

-- Fixtures: three public cars of one owner.
INSERT INTO public.vehicles(id, user_id, owner_id, year, is_public) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 1983, true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 1983, true),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 1983, true);
INSERT INTO public.receipts(id, user_id, vehicle_id, scope_type, scope_id, vendor_name, receipt_date, total_amount, total, amount_check,
                            processing_status, is_active, raw_extraction, raw_json) VALUES
  -- car A: a parts purchase, a paid invoice that prints its original estimate, and an estimate typed as the lander writes it
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'vehicle',
   '00000000-0000-0000-0000-0000000000a1', 'NAPA Auto Parts', '2024-01-08', 100, 100, 'verified', 'completed', true, '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'vehicle',
   '00000000-0000-0000-0000-0000000000a1', 'Corner Garage', '2024-02-01', 140, 140, 'verified', 'completed', true,
   '{"document_type":"invoice","ocr":{"full_text":"INVOICE Org. Estimate 140.00 Current Estimate 140.00 Bal Due 0.00"}}', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'vehicle',
   '00000000-0000-0000-0000-0000000000a1', 'Speedway Parts and Body', '2024-05-01', 2550, 2550, 'verified', 'completed', true,
   '{"data":{"document_type":"estimate"}}', '{"data_v2":{"document_type":"estimate"}}'),
  -- car B: an agreement with two options, one marked accepted
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'vehicle',
   '00000000-0000-0000-0000-0000000000a2', 'Corner Garage', '2024-08-15', NULL, NULL, 'verified', 'completed', true,
   '{"document_type":"agreement"}', '{}'),
  -- car C: two quote documents, one with a printed total and one priced by its lines
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a3', 'vehicle',
   '00000000-0000-0000-0000-0000000000a3', 'Trim Shop', '2024-03-01', 800, 800, 'verified', 'completed', true, '{}', '{"data_v2":{"document_type":"quote"}}'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a3', 'vehicle',
   '00000000-0000-0000-0000-0000000000a3', 'Trim Shop', '2024-09-01', NULL, NULL, 'verified', 'completed', true, '{}', '{"data_v2":{"document_type":"estimate"}}');
INSERT INTO public.receipt_items(id, receipt_id, line_number, description, category, total_price) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 1, 'Brake pads', 'brakes', 100),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b2', 1, 'Install muffler', NULL, 140),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 1, 'Remove grille', 'option A', 500),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 2, 'Front bumper', 'option A', 700),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 3, 'Front bumper, used', 'option B', 900),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 4, 'Repair bumper', 'option C', 400),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 5, 'Shop supplies', NULL, 50),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c2', 1, 'Paint, one colour', 'option A', 1000),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c2', 2, 'Paint, two tone', 'Option: B (accepted)', 1500),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c2', 3, 'Stripe kit', 'option B accepted', 300),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c4', 1, 'Seat covers', NULL, 200),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c4', 2, 'Carpet', NULL, 300);
INSERT INTO public.receipt_vehicle_links(id, receipt_id, vehicle_id, user_id, status, basis)
SELECT gen_random_uuid(), r.id, r.vehicle_id, r.user_id, 'linked', 'cited_document' FROM public.receipts r;

SELECT public.assert((SELECT string_agg(right(id::text, 2) || '=' || document_kind::text, ' ' ORDER BY id) FROM public.receipts)
                     = 'b1=parts_service b2=unknown c1=quote c2=quote c3=quote c4=quote',
                     'typed estimates, agreements and quotes classify quote, ahead of the parts vendor; the paid invoice that prints its estimate does not');

-- Spend readers leave the quote out.
SELECT public.assert((SELECT array_agg(DISTINCT right(receipt_id::text, 2) ORDER BY right(receipt_id::text, 2))
                        FROM public.receipt_work_lines('00000000-0000-0000-0000-0000000000a1')) = ARRAY['b1','b2'], 'receipt_work_lines leaves the quote out');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_work_lines('00000000-0000-0000-0000-0000000000a2')), 'a car with only a quote has no work lines');
SELECT set_config('test.role', 'service_role', false);
SELECT public.assert((public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') #>> '{breakdown,receipts}')::numeric = 240
                     AND (public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') #>> '{components_count,receipts}')::int = 2,
                     'get_vehicle_total_invested counts the two purchases, not the quote');
SELECT public.assert((SELECT count(*) FROM public.vehicle_receipts WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 2,
                     'vehicle_receipts lists purchases only');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.vehicle_receipts WHERE vehicle_id IN ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')),
                     'vehicle_receipts has no quote-only car');

-- The build reader: spend in totals, quotes on their own.
CREATE TEMP TABLE b AS SELECT right(v::text, 2) AS car, public.vehicle_build_reconstruction(v) AS j
  FROM unnest(ARRAY['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3']::uuid[]) v;
SELECT public.assert((j #>> '{totals,receipts}')::int = 2 AND (j #>> '{totals,recorded_amount}')::numeric = 240 AND (j #>> '{totals,lines}')::int = 2,
                     'car A totals are the two purchases') FROM b WHERE car = 'a1';
SELECT public.assert((j #>> '{quoted,documents}')::int = 1 AND j #> '{quoted,amount}' = 'null'::jsonb
                     AND j #>> '{quoted,amount_basis}' = 'options_not_added' AND j #>> '{quoted,first_day}' = '2024-05-01',
                     'car A: three options, none accepted, no amount') FROM b WHERE car = 'a1';
SELECT public.assert(j #> '{quoted,quotes,0,options}' = '[{"label":"A","lines":2,"amount":1200,"accepted":false},
                       {"label":"B","lines":1,"amount":900,"accepted":false},{"label":"C","lines":1,"amount":400,"accepted":false}]'::jsonb
                     AND j #> '{quoted,quotes,0,lines_outside_options}' = '{"lines":1,"amount":50}'::jsonb
                     AND (j #>> '{quoted,quotes,0,lines}')::int = 5,
                     'car A: each option on its own, the shared line apart') FROM b WHERE car = 'a1';
SELECT public.assert((j #>> '{totals,lines}')::int = 0 AND (j #>> '{quoted,amount}')::numeric = 1800
                     AND j #>> '{quoted,amount_basis}' = 'accepted_option', 'car B: the accepted option, never the sum of both') FROM b WHERE car = 'a2';
SELECT public.assert((j #>> '{quoted,documents}')::int = 2 AND j #> '{quoted,amount}' = 'null'::jsonb
                     AND j #>> '{quoted,amount_basis}' = 'documents_not_added'
                     AND (j #>> '{quoted,quotes,0,amount}')::numeric = 800 AND j #>> '{quoted,quotes,0,amount_basis}' = 'printed_total'
                     AND (j #>> '{quoted,quotes,1,amount}')::numeric = 500 AND j #>> '{quoted,quotes,1,amount_basis}' = 'line_sum',
                     'car C: two quotes, each stated, never added') FROM b WHERE car = 'a3';
SELECT set_config('test.role', 'anon', false);
SELECT public.assert((j #>> '{quoted,documents}')::int = 1 AND j #> '{quoted,amount}' = 'null'::jsonb
                     AND j #> '{quoted,quotes,0,amount}' = 'null'::jsonb AND j #> '{quoted,quotes,0,options,0,amount}' = 'null'::jsonb
                     AND j #> '{totals,recorded_amount}' = 'null'::jsonb,
                     'a visitor sees counts and days, no amounts')
  FROM (SELECT public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1') AS j) x;
SELECT public.assert((SELECT public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a2') #>> '{quoted,amount}') IS NULL,
                     'a visitor sees no accepted amount');
SELECT set_config('test.role', '', false);
SELECT public.assert(public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1') ? 'quoted'
                     AND (public.vehicle_build_reconstruction('00000000-0000-0000-0000-0000000000a1') ->> 'version')::int = 1, 'version unchanged');

-- A second run changes nothing.
CREATE TEMP TABLE after_first AS SELECT f.obj, CASE WHEN f.is_view THEN pg_get_viewdef(f.obj::regclass) ELSE pg_get_functiondef(f.obj::regprocedure) END AS d
  FROM public.fixture_read f;
\ir ../migrations/20261121233000_receipt_quote_kind.sql
SELECT public.assert(NOT EXISTS (SELECT 1 FROM after_first a
                      WHERE a.d IS DISTINCT FROM CASE WHEN (SELECT is_view FROM public.fixture_read f WHERE f.obj = a.obj)
                                                      THEN pg_get_viewdef(a.obj::regclass) ELSE pg_get_functiondef(a.obj::regprocedure) END),
                     'second run changes nothing');
SELECT public.assert((SELECT count(*) FROM public.receipt_document_kind_rules WHERE rule_id = 'quote_doctype') = 1, 'one quote rule');

SELECT 'test_receipt_quote_kind: ok';
