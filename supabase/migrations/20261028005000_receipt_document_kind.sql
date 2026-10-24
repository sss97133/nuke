-- Typed document kind for receipts, set by a cited, deterministic rule set.
-- Non-purchase documents (tax forms, financial statements, insurance notices, letters) and
-- personal purchases (vet, grocery, restaurant, utility) are excluded from vehicle receipts and
-- spend rollups up front: their links are stored retired instead of sitting held.
-- Also: a receipt that later becomes a duplicate now has its linked links held (previously only
-- links written after the flag were held).

do $$ begin
  create type public.receipt_doc_kind as enum ('parts_service','vehicle_transaction','government_fee','fuel',
    'insurance_document','tax_form','financial_statement','letter_notice','personal_purchase','unknown');
exception when duplicate_object then null; end $$;

create table if not exists public.receipt_document_kind_rules (
  rule_id text primary key,
  priority int not null,
  kind public.receipt_doc_kind not null,
  field text not null check (field in ('vendor','doctype','text')),
  pattern text not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.receipt_document_kind_rules enable row level security;
comment on table public.receipt_document_kind_rules is 'Ordered case-insensitive regex rules; first match by priority wins. vendor = vendor_name, doctype = extracted document_type, text = first 400 chars of OCR text (whitespace collapsed).';
insert into public.receipt_document_kind_rules (rule_id, priority, kind, field, pattern) values
  ('parts_service_vendor',1,'parts_service','vendor','parts|auto ?zone|carquest|napa|o.?reilly|holley|summit racing|lmc truck|cj pony|snap-on|harbor freight|true value|home hardware|lowe|home depot|offroad|racing|speedway motors|car care|service order|great people, great products'),
  ('tax_form_1099',10,'tax_form','text','form 1099|1099-[a-z]{1,3}\y|unemployment compensation|form w-2|irs payment|internal revenue service'),
  ('tax_form_doctype',11,'tax_form','doctype','1099|irs_|w-?2'),
  ('bank_statement',20,'financial_statement','text','statement period|account statement|summary of account activity|new balance|previous balance|beginning balance|ending balance|minimum payment due'),
  ('bank_statement_vendor',21,'financial_statement','vendor','^(account statement|summary of account|boulder dam credit union|america first|wells fargo bank|check amount)'),
  ('bank_doctype',22,'financial_statement','doctype','bank_statement|revenue_center|daily_sales|wire_transfer|bank_transfer'),
  ('insurance_notice',30,'insurance_document','text','policy number|policy term|declarations page|evidence of insurance|insurance card|do-not-call|go paperless|notice of cancellation'),
  ('insurance_vendor',31,'insurance_document','vendor','insurance|bristol west|geico|progressive|state farm|hagerty|allstate|farmers'),
  ('letter',40,'letter_notice','text','^.{0,250}(dear [a-z]+|to whom it may concern)|sincerely,|court appearance|jury|certificate of completion|mission president|ccw|defensive driving'),
  ('letter_doctype',41,'letter_notice','doctype','court_|final_notice|instruction_sheet'),
  ('personal_vet',50,'personal_purchase','vendor','animal|veterinar|vca |\ypet\y'),
  ('personal_vet_text',51,'personal_purchase','text','animal hospital|veterinar|canine|feline|rabies|neuter'),
  ('personal_grocery',52,'personal_purchase','vendor','albertsons|smith.?s food|vons|safeway|walmart supercenter|trader joe|whole foods|costco|ikea'),
  ('personal_food',53,'personal_purchase','vendor','bakery|cafe|caf[eé]|restaurant|pizza|grill|eden to go|starbucks|mcdonald|taco|burger|coffee|dillinger|arsenale'),
  ('personal_utility',54,'personal_purchase','text','utility bill|electric bill|nv energy|southwest gas|water service'),
  ('vehicle_txn',60,'vehicle_transaction','vendor','bring a trailer|consign|automotive group|truck center|auto sales|dealer|bill of sale|motor vehicle purchase order'),
  ('gov_fee',70,'government_fee','vendor','dmv|state of ?n ?evada|department of motor|county|tax collector|registration|city of boulder'),
  ('fuel',80,'fuel','vendor','arco|gasoline|sinclair|chevron|shell|7-eleven|circle k|maverik|76 ')
on conflict (rule_id) do nothing;

alter table public.receipts
  add column if not exists document_kind public.receipt_doc_kind,
  add column if not exists document_kind_rule text,
  add column if not exists document_kind_citation jsonb,
  add column if not exists document_kind_run_id text,
  add column if not exists document_kind_classified_at timestamptz;
create index if not exists receipts_document_kind_idx on public.receipts (document_kind);

create or replace function public.receipt_doc_kind_excluded(k public.receipt_doc_kind)
returns boolean language sql immutable as $f$
  select coalesce(k in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase'), false)
$f$;

create or replace function public.receipt_doc_text(p_rx jsonb, p_rj jsonb)
returns text language sql immutable as $f$
  select left(regexp_replace(coalesce(p_rx #>> '{ocr,full_text}', p_rx ->> 'raw_text', p_rx #>> '{what,raw_text}', p_rj #>> '{ocr,full_text}', ''), '\s+', ' ', 'g'), 400)
$f$;

-- Returns {kind, rule_id, field, match}; kind 'unknown' with rule_id null when nothing matches.
create or replace function public.receipt_classify_document(p_vendor text, p_doctype text, p_text text)
returns jsonb language plpgsql stable as $f$
declare ru record; src text; m text[];
begin
  for ru in select * from public.receipt_document_kind_rules order by priority, rule_id loop
    src := case ru.field when 'vendor' then coalesce(p_vendor,'') when 'doctype' then coalesce(p_doctype,'') else coalesce(p_text,'') end;
    m := regexp_match(src, ru.pattern, 'i');
    if m is not null then
      return jsonb_build_object('kind', ru.kind, 'rule_id', ru.rule_id, 'field', ru.field, 'pattern', ru.pattern,
        'match', left(substring(src from ('(?i)' || ru.pattern)), 120));
    end if;
  end loop;
  return jsonb_build_object('kind','unknown','rule_id',null);
end $f$;

create or replace function public.receipts_set_document_kind()
returns trigger language plpgsql as $f$
declare c jsonb;
begin
  if coalesce(new.document_kind_rule,'') = 'manual' then return new; end if;
  c := public.receipt_classify_document(new.vendor_name,
         concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type'),
         public.receipt_doc_text(new.raw_extraction, new.raw_json));
  if new.document_kind is distinct from (c->>'kind')::public.receipt_doc_kind then
    new.document_kind := (c->>'kind')::public.receipt_doc_kind;
    new.document_kind_rule := c->>'rule_id';
    new.document_kind_citation := c;
    new.document_kind_classified_at := now();
    new.document_kind_run_id := 'document_kind_trigger';
  end if;
  return new;
end $f$;
drop trigger if exists trg_receipts_document_kind on public.receipts;
create trigger trg_receipts_document_kind before insert or update of vendor_name, raw_extraction, raw_json
  on public.receipts for each row execute function public.receipts_set_document_kind();

-- Retire links of excluded documents; hold linked links of receipts that become duplicates.
create or replace function public.receipts_document_kind_links()
returns trigger language plpgsql as $f$
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
end $f$;
drop trigger if exists trg_receipts_document_kind_links on public.receipts;
create trigger trg_receipts_document_kind_links after update of document_kind, duplicate_of
  on public.receipts for each row execute function public.receipts_document_kind_links();

CREATE OR REPLACE FUNCTION public.receipt_vehicle_links_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare r receipts; pd record;
begin
  if TG_OP='UPDATE' and NEW.retired_at is not null and OLD.retired_at is null
     and (NEW.status, NEW.vehicle_id, NEW.basis) is not distinct from (OLD.status, OLD.vehicle_id, OLD.basis) then
    return NEW; end if;
  select * into r from receipts where id=NEW.receipt_id;
  NEW.user_id := r.user_id;
  select * into pd from receipt_page_date(r);
  NEW.page_date := pd.d; NEW.page_date_source := pd.src;
  -- a non-purchase or personal document never becomes a vehicle receipt: the link is stored retired
  if TG_OP='INSERT' and public.receipt_doc_kind_excluded(r.document_kind) and NEW.retired_at is null then
    NEW.retired_at := now();
    NEW.basis_ref := coalesce(NEW.basis_ref,'{}'::jsonb) || jsonb_build_object('excluded_document_kind', r.document_kind, 'rule', r.document_kind_rule);
    return NEW;
  end if;
  -- a duplicate reading of another receipt never counts as a linked receipt
  if NEW.status='linked' and r.duplicate_of is not null then
    NEW.status := 'held';
    NEW.hold_reason := 'duplicate_of '||r.duplicate_of::text;
  end if;
  -- an implausible OCR amount is held until a person or a re-read clears it
  if NEW.status='linked' and r.amount_check='implausible' then
    NEW.status := 'held';
    NEW.hold_reason := 'amount_check implausible';
  end if;
  if NEW.status='linked' then
    NEW.tie_kind := receipt_user_vehicle_tie(r.user_id, NEW.vehicle_id);
    if NEW.tie_kind is null then raise exception 'receipt_vehicle_links: paying user % not tied to vehicle %', r.user_id, NEW.vehicle_id; end if;
    NEW.type_gate := receipt_type_gate(NEW.receipt_id, NEW.vehicle_id);
    if NEW.type_gate='fail' then raise exception 'receipt_vehicle_links: type gate fail receipt % vehicle %', NEW.receipt_id, NEW.vehicle_id; end if;
    if NEW.basis_ref = '{}'::jsonb then raise exception 'receipt_vehicle_links: linked row needs basis_ref'; end if;
  end if;
  return NEW;
end $function$;

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

create or replace view public.vehicle_receipts with (security_invoker=true) as
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

create or replace view public.vehicle_receipts_rollup_v as
 SELECT (scope_id)::uuid AS vehicle_id,
    sum(
        CASE
            WHEN (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN total_amount
            ELSE (0)::numeric
        END) AS total_lifetime,
    sum(
        CASE
            WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '90 days'::interval))::date)) THEN total_amount
            ELSE (0)::numeric
        END) AS total_90d,
    sum(
        CASE
            WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '365 days'::interval))::date)) THEN total_amount
            ELSE (0)::numeric
        END) AS total_365d,
    count(*) FILTER (WHERE (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
   FROM receipts
  WHERE ((scope_type = 'vehicle'::text) AND (NOT receipt_doc_kind_excluded(document_kind)) AND ((duplicate_of IS NULL) AND (amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))))
  GROUP BY scope_id;

create or replace view public.v_vehicle_monthly_basis with (security_invoker=true) as
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

-- Revert: see the schema revert below (restores prior view/function definitions).
-- -- Schema revert for 20261028005000 (run data revert first).
-- drop trigger if exists trg_receipts_document_kind_links on public.receipts;
-- drop trigger if exists trg_receipts_document_kind on public.receipts;
-- CREATE OR REPLACE FUNCTION public.receipt_vehicle_links_enforce()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
-- declare r receipts; pd record;
-- begin
--   if TG_OP='UPDATE' and NEW.retired_at is not null and OLD.retired_at is null
--      and (NEW.status, NEW.vehicle_id, NEW.basis) is not distinct from (OLD.status, OLD.vehicle_id, OLD.basis) then
--     return NEW; end if;
--   select * into r from receipts where id=NEW.receipt_id;
--   NEW.user_id := r.user_id;
--   select * into pd from receipt_page_date(r);
--   NEW.page_date := pd.d; NEW.page_date_source := pd.src;
--   -- a duplicate reading of another receipt never counts as a linked receipt
--   if NEW.status='linked' and r.duplicate_of is not null then
--     NEW.status := 'held';
--     NEW.hold_reason := 'duplicate_of '||r.duplicate_of::text;
--   end if;
--   -- an implausible OCR amount is held until a person or a re-read clears it
--   if NEW.status='linked' and r.amount_check='implausible' then
--     NEW.status := 'held';
--     NEW.hold_reason := 'amount_check implausible';
--   end if;
--   if NEW.status='linked' then
--     NEW.tie_kind := receipt_user_vehicle_tie(r.user_id, NEW.vehicle_id);
--     if NEW.tie_kind is null then raise exception 'receipt_vehicle_links: paying user % not tied to vehicle %', r.user_id, NEW.vehicle_id; end if;
--     NEW.type_gate := receipt_type_gate(NEW.receipt_id, NEW.vehicle_id);
--     if NEW.type_gate='fail' then raise exception 'receipt_vehicle_links: type gate fail receipt % vehicle %', NEW.receipt_id, NEW.vehicle_id; end if;
--     if NEW.basis_ref = '{}'::jsonb then raise exception 'receipt_vehicle_links: linked row needs basis_ref'; end if;
--   end if;
--   return NEW;
-- end $function$;
-- CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid)
--  RETURNS jsonb
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--   with
--     vehicle_te as (select id from timeline_events where vehicle_id = p_vehicle_id),
--     parts as (
--       select coalesce(sum(wop.total_price), 0) as total, count(*) as cnt
--       from work_order_parts wop where wop.timeline_event_id in (select id from vehicle_te)
--     ),
--     labor as (
--       select coalesce(sum(wol.total_cost), 0) as total, count(*) as cnt
--       from work_order_labor wol where wol.timeline_event_id in (select id from vehicle_te)
--     ),
--     te_costs as (
--       select coalesce(sum(cost_amount), 0) as total from timeline_events
--       where vehicle_id = p_vehicle_id and cost_amount is not null and cost_amount > 0
--     ),
--     candidate as (
--       select l.receipt_id as id from receipt_vehicle_links l
--       where l.vehicle_id = p_vehicle_id and l.status = 'linked' and l.retired_at is null
--       union
--       select r.id from receipts r
--       where (r.vehicle_id = p_vehicle_id or (r.scope_type = 'vehicle' and r.scope_id = p_vehicle_id::text))
--         and not exists (select 1 from receipt_vehicle_links l where l.receipt_id = r.id and l.retired_at is null)
--     ),
--     rcpts as (
--       select coalesce(sum(coalesce(r.total_amount, r.total)), 0) as total, count(*) as cnt
--       from receipts r join candidate c on c.id = r.id
--       where r.duplicate_of is null and r.amount_check in ('verified','plausible') and coalesce(r.is_superseded, false) = false
--         and coalesce(r.total_amount, r.total) > 0
--     )
--   select jsonb_build_object(
--     'total_invested', greatest(parts.total + labor.total, te_costs.total, rcpts.total),
--     'breakdown', jsonb_build_object(
--       'parts', parts.total, 'labor', labor.total, 'materials', 0, 'overhead', 0, 'tools', 0,
--       'financial_records_total', 0, 'timeline_costs', te_costs.total, 'receipts', rcpts.total),
--     'components_count', jsonb_build_object(
--       'parts_items', parts.cnt, 'labor_tasks', labor.cnt, 'materials_items', 0,
--       'events_with_work', 0, 'receipts', rcpts.cnt))
--   from parts, labor, te_costs, rcpts;
-- $function$;
-- create or replace view public.vehicle_receipts with (security_invoker=true) as
--  SELECT l.receipt_id AS id,
--     l.receipt_id,
--     l.vehicle_id,
--     r.user_id,
--     COALESCE(r.total_amount, r.total) AS total_amount,
--     r.vendor_name,
--     l.page_date AS receipt_date,
--     l.page_date_source,
--     ( SELECT jsonb_agg(jsonb_build_object('description', i.description, 'part_number', i.part_number, 'category', i.category, 'quantity', i.quantity, 'unit_price', i.unit_price, 'total_price', i.total_price)) AS jsonb_agg
--            FROM receipt_items i
--           WHERE (i.receipt_id = l.receipt_id)) AS items,
--     l.basis AS link_basis,
--     l.basis_ref,
--     l.confidence,
--     l.tie_kind,
--     l.type_gate,
--     l.run_id,
--     COALESCE(((l.basis_ref ->> 'provisional'::text))::boolean, false) AS provisional,
--     r.file_url,
--     r.created_at
--    FROM (receipt_vehicle_links l
--      JOIN receipts r ON ((r.id = l.receipt_id)))
--   WHERE ((l.status = 'linked'::text) AND (l.retired_at IS NULL) AND (r.duplicate_of IS NULL));
-- create or replace view public.vehicle_receipts_rollup_v as
--  SELECT (scope_id)::uuid AS vehicle_id,
--     sum(
--         CASE
--             WHEN (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) THEN total_amount
--             ELSE (0)::numeric
--         END) AS total_lifetime,
--     sum(
--         CASE
--             WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '90 days'::interval))::date)) THEN total_amount
--             ELSE (0)::numeric
--         END) AS total_90d,
--     sum(
--         CASE
--             WHEN ((COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text])) AND (transaction_date >= ((now() - '365 days'::interval))::date)) THEN total_amount
--             ELSE (0)::numeric
--         END) AS total_365d,
--     count(*) FILTER (WHERE (COALESCE(processing_status, 'parsed'::text) = ANY (ARRAY['validated'::text, 'saved'::text]))) AS receipts_count
--    FROM receipts
--   WHERE ((scope_type = 'vehicle'::text) AND ((duplicate_of IS NULL) AND (amount_check = ANY (ARRAY['verified'::receipt_amount_check, 'plausible'::receipt_amount_check]))))
--   GROUP BY scope_id;
-- create or replace view public.v_vehicle_monthly_basis with (security_invoker=true) as
--  WITH vehicle_first_activity AS (
--          SELECT v_1.id AS vehicle_id,
--             v_1.user_id,
--             LEAST(( SELECT min(COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, (r.created_at)::date)) AS min
--                    FROM receipts r
--                   WHERE ((r.vehicle_id = v_1.id) AND (COALESCE(r.is_active, true) = true) AND (COALESCE(r.is_superseded, false) = false))), ( SELECT min((pe.paid_at)::date) AS min
--                    FROM payment_events pe
--                   WHERE ((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = v_1.id) AND (COALESCE(pe.is_superseded, false) = false))), ( SELECT min((vo.observed_at)::date) AS min
--                    FROM vehicle_observations vo
--                   WHERE ((vo.vehicle_id = v_1.id) AND (vo.kind = 'ownership'::observation_kind) AND (COALESCE(vo.is_superseded, false) = false)))) AS first_activity_date
--            FROM vehicles v_1
--           WHERE (v_1.user_id IS NOT NULL)
--         ), months AS (
--          SELECT vfa.vehicle_id,
--             vfa.user_id,
--             (date_trunc('month'::text, gs.gs))::date AS month
--            FROM (vehicle_first_activity vfa
--              CROSS JOIN LATERAL generate_series(date_trunc('month'::text, (vfa.first_activity_date)::timestamp without time zone), date_trunc('month'::text, (CURRENT_DATE)::timestamp without time zone), '1 mon'::interval) gs(gs))
--           WHERE (vfa.first_activity_date IS NOT NULL)
--         ), cum_receipts AS (
--          SELECT m_1.vehicle_id,
--             m_1.month,
--             COALESCE(sum(COALESCE(r.total, r.total_amount, r.subtotal)), (0)::numeric) AS cumulative_receipts_usd
--            FROM (months m_1
--              LEFT JOIN receipts r ON (((r.vehicle_id = m_1.vehicle_id) AND (COALESCE(r.is_active, true) = true) AND (COALESCE(r.is_superseded, false) = false) AND (COALESCE(r.purchase_date, r.transaction_date, r.receipt_date, (r.created_at)::date) <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
--           GROUP BY m_1.vehicle_id, m_1.month
--         ), cum_pay_in AS (
--          SELECT m_1.vehicle_id,
--             m_1.month,
--             COALESCE(sum(pe.amount_usd), (0)::numeric) AS cumulative_payments_in_usd
--            FROM (months m_1
--              LEFT JOIN payment_events pe ON (((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = m_1.vehicle_id) AND (pe.direction = 'in'::text) AND (COALESCE(pe.is_superseded, false) = false) AND ((pe.paid_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
--           GROUP BY m_1.vehicle_id, m_1.month
--         ), cum_pay_out AS (
--          SELECT m_1.vehicle_id,
--             m_1.month,
--             COALESCE(sum(pe.amount_usd), (0)::numeric) AS cumulative_payments_out_usd
--            FROM (months m_1
--              LEFT JOIN payment_events pe ON (((pe.scope_type = 'vehicle'::text) AND (pe.scope_id = m_1.vehicle_id) AND (pe.direction = 'out'::text) AND (COALESCE(pe.is_superseded, false) = false) AND ((pe.paid_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))))
--           GROUP BY m_1.vehicle_id, m_1.month
--         ), val_per_month AS (
--          SELECT m_1.vehicle_id,
--             m_1.month,
--             ( SELECT ((vo.structured_data ->> 'value_usd'::text))::numeric AS "numeric"
--                    FROM vehicle_observations vo
--                   WHERE ((vo.vehicle_id = m_1.vehicle_id) AND (vo.kind = 'valuation'::observation_kind) AND (vo.structured_data ? 'value_usd'::text) AND (COALESCE(vo.is_superseded, false) = false) AND ((vo.observed_at)::date <= (((m_1.month + '1 mon'::interval) - '1 day'::interval))::date))
--                   ORDER BY vo.observed_at DESC
--                  LIMIT 1) AS observed_value_usd
--            FROM months m_1
--         )
--  SELECT m.user_id,
--     m.vehicle_id,
--     m.month,
--     v.year,
--     v.make,
--     v.model,
--     v.vin,
--     cr.cumulative_receipts_usd,
--     cpi.cumulative_payments_in_usd,
--     cpo.cumulative_payments_out_usd,
--     (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd) AS cost_basis_usd,
--     cpi.cumulative_payments_in_usd AS proceeds_usd,
--         CASE
--             WHEN ((COALESCE(v.sale_status, ''::text) = 'sold'::text) AND (cpi.cumulative_payments_in_usd > (0)::numeric)) THEN 'sold'::text
--             WHEN (cpi.cumulative_payments_in_usd > (0)::numeric) THEN 'sold'::text
--             WHEN (COALESCE(v.sale_status, ''::text) = 'consigned'::text) THEN 'consigned'::text
--             WHEN ((cr.cumulative_receipts_usd > (0)::numeric) OR (cpo.cumulative_payments_out_usd > (0)::numeric)) THEN 'held'::text
--             ELSE 'unknown'::text
--         END AS holding_status,
--     COALESCE(vpm.observed_value_usd, v.nuke_estimate, v.cz_estimated_value, v.current_value) AS estimated_value_usd,
--         CASE
--             WHEN (cpi.cumulative_payments_in_usd > (0)::numeric) THEN (cpi.cumulative_payments_in_usd - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd))
--             ELSE (COALESCE(vpm.observed_value_usd, v.nuke_estimate, v.cz_estimated_value, v.current_value, (0)::numeric) - (cr.cumulative_receipts_usd + cpo.cumulative_payments_out_usd))
--         END AS net_position_usd
--    FROM (((((months m
--      JOIN vehicles v ON ((v.id = m.vehicle_id)))
--      LEFT JOIN cum_receipts cr ON (((cr.vehicle_id = m.vehicle_id) AND (cr.month = m.month))))
--      LEFT JOIN cum_pay_in cpi ON (((cpi.vehicle_id = m.vehicle_id) AND (cpi.month = m.month))))
--      LEFT JOIN cum_pay_out cpo ON (((cpo.vehicle_id = m.vehicle_id) AND (cpo.month = m.month))))
--      LEFT JOIN val_per_month vpm ON (((vpm.vehicle_id = m.vehicle_id) AND (vpm.month = m.month))));
-- drop function if exists public.receipts_document_kind_links();
-- drop function if exists public.receipts_set_document_kind();
-- drop function if exists public.receipt_classify_document(text,text,text);
-- drop function if exists public.receipt_doc_text(jsonb,jsonb);
-- drop index if exists receipts_document_kind_idx;
-- alter table public.receipts drop column if exists document_kind, drop column if exists document_kind_rule,
--   drop column if exists document_kind_citation, drop column if exists document_kind_run_id, drop column if exists document_kind_classified_at;
-- drop function if exists public.receipt_doc_kind_excluded(public.receipt_doc_kind);
-- drop table if exists public.receipt_document_kind_rules;
-- drop type if exists public.receipt_doc_kind;
