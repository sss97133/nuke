-- Receipt amount checks. OCR'd totals are cross-checked before anything counts
-- them. Additive: a new enum, four new columns, functions and triggers. Amounts
-- are never changed; a receipt whose amount is implausible is flagged and its
-- vehicle link is held.
--
-- amount_check:
--   verified    total matches line items plus tax, or subtotal plus tax (within 1%)
--   plausible   no contradiction: fits the receipt type's range and the vendor's range
--   implausible a check failed; reasons are in amount_check_reasons
--   no_amount   no total read
--   unchecked   not computed yet (default)
-- Rollups and get_vehicle_total_invested count only verified and plausible.
set check_function_bodies = off;

do $$ begin
  create type public.receipt_amount_check as enum ('unchecked','verified','plausible','implausible','no_amount');
exception when duplicate_object then null; end $$;

alter table public.receipts
  add column if not exists amount_check public.receipt_amount_check not null default 'unchecked',
  add column if not exists amount_check_reasons jsonb,
  add column if not exists amount_checked_at timestamptz,
  add column if not exists amount_check_run_id text;

create index if not exists receipts_amount_check_idx on public.receipts (amount_check);

-- What kind of document the receipt is, read from the vendor line and the
-- extraction text. Each kind has an amount range.
create or replace function public.receipt_document_kind(p_vendor text, p_text text)
returns text language sql immutable as $$
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
$$;

create or replace function public.receipt_kind_max(p_kind text)
returns numeric language sql immutable as $$
  select case p_kind
    when 'vehicle_transaction' then 500000
    when 'government_fee' then 5000
    when 'insurance' then 15000
    when 'non_receipt' then 0
    else 100000 end::numeric
$$;

-- Computes the check for one receipt row. Reads line items and other receipts
-- from the same vendor; never writes.
create or replace function public.receipt_amount_check_compute(r public.receipts)
returns table (status public.receipt_amount_check, reasons jsonb)
language plpgsql stable as $$
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
end $$;

create or replace function public.receipts_set_amount_check()
returns trigger language plpgsql as $$
declare c record;
begin
  select * into c from public.receipt_amount_check_compute(new);
  new.amount_check := c.status;
  new.amount_check_reasons := c.reasons;
  new.amount_checked_at := now();
  return new;
end $$;

drop trigger if exists trg_receipts_amount_check on public.receipts;
create trigger trg_receipts_amount_check before insert or update of total_amount, total, subtotal, tax_amount, tax, vendor_name, raw_extraction
  on public.receipts for each row execute function public.receipts_set_amount_check();

-- A receipt that becomes implausible has its linked vehicle link held
-- (old row retired, held row inserted; nothing is deleted).
create or replace function public.receipts_hold_implausible_links()
returns trigger language plpgsql as $$
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
end $$;

drop trigger if exists trg_receipts_hold_implausible on public.receipts;
create trigger trg_receipts_hold_implausible after update of amount_check on public.receipts
  for each row execute function public.receipts_hold_implausible_links();

-- Line items arriving or changing re-run the check on their receipt.
create or replace function public.receipt_items_recheck_amount()
returns trigger language plpgsql as $$
declare rid uuid := coalesce(new.receipt_id, old.receipt_id);
begin
  update receipts set total = total where id = rid;
  return null;
end $$;

drop trigger if exists trg_receipt_items_recheck on public.receipt_items;
create trigger trg_receipt_items_recheck after insert or update or delete on public.receipt_items
  for each row execute function public.receipt_items_recheck_amount();
drop trigger if exists trg_line_items_recheck on public.line_items;
create trigger trg_line_items_recheck after insert or update or delete on public.line_items
  for each row execute function public.receipt_items_recheck_amount();


-- Rollups count only verified and plausible amounts.
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
  select count(*), count(*) filter (where coalesce(is_approved, true))
    into img_count, approved_img_count
  from public.vehicle_images
  where vehicle_id = p_vehicle_id;

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

create or replace view public.user_receipt_summary as  WITH vendor_counts AS (
         SELECT r.user_id,
            r.vendor_name,
            count(*) AS receipt_count,
            sum(r.total_amount) AS vendor_total
           FROM receipts r
          WHERE ((r.vendor_name IS NOT NULL) AND (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL and r.amount_check in ('verified','plausible')))
          GROUP BY r.user_id, r.vendor_name
        ), category_totals AS (
         SELECT li.user_id,
            COALESCE(li.category, 'uncategorized'::text) AS category,
            sum(li.total_price) AS category_total,
            count(*) AS item_count
           FROM line_items li
          WHERE (li.total_price IS NOT NULL)
          GROUP BY li.user_id, COALESCE(li.category, 'uncategorized'::text)
        ), user_stats AS (
         SELECT r.user_id,
            count(DISTINCT r.id) AS total_receipts,
            sum(r.total_amount) AS total_spending,
            min(r.transaction_date) AS first_receipt_date,
            max(r.transaction_date) AS last_receipt_date,
            avg(r.total_amount) AS avg_receipt_amount
           FROM receipts r
          WHERE (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL and r.amount_check in ('verified','plausible'))
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
   FROM user_stats us;

create or replace view public.vehicle_receipts_rollup_v as  SELECT (scope_id)::uuid AS vehicle_id,
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
  WHERE ((scope_type = 'vehicle'::text) AND (duplicate_of IS NULL and amount_check in ('verified','plausible')))
  GROUP BY scope_id;

-- vehicle_receipts lists linked receipts; implausible ones are never linked (held
-- by the enforce trigger), and receipts without an amount stay listed.
create or replace view public.vehicle_receipts with (security_invoker = true) as  SELECT l.receipt_id AS id,
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
  WHERE ((l.status = 'linked'::text) AND (l.retired_at IS NULL) AND (r.duplicate_of IS NULL));


create or replace function public.get_vehicle_total_invested(p_vehicle_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path = public
as $function$
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
