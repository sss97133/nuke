-- Duplicate receipts (receipts.duplicate_of set) must never count twice downstream.
-- 1) duplicates are also marked superseded (is_superseded/superseded_at/superseded_reason), which the evq evidence,
--    investment timeline, nuke_build_class, garage/monthly views and other superseded-aware readers already skip;
-- 2) link writer refuses to link a duplicate (held instead), and vehicle_receipts hides duplicates;
-- 3) receipt rollups that filtered neither flag now exclude duplicate_of rows.
-- get_vehicle_total_invested references work_order_materials, which does not exist in prod (already broken); body checks are off so it can be patched as-is.
-- Additive: no columns dropped, no rows deleted. Data backfill is run separately with a run id + revert.

set check_function_bodies = off;

create or replace function public.receipts_flag_duplicate()
returns trigger language plpgsql as $$
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
end $$;

drop trigger if exists trg_receipts_flag_duplicate on public.receipts;
create trigger trg_receipts_flag_duplicate before insert or update of user_id, vendor_name, total_amount, total, file_name, duplicate_of
  on public.receipts for each row execute function public.receipts_flag_duplicate();

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
    where scope_type = 'vehicle' and duplicate_of is null
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

CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH
    vehicle_te AS (
      SELECT id FROM timeline_events WHERE vehicle_id = p_vehicle_id
    ),
    parts AS (
      SELECT COALESCE(SUM(wop.total_price), 0) AS total,
             COUNT(*) AS cnt
      FROM work_order_parts wop
      WHERE wop.timeline_event_id IN (SELECT id FROM vehicle_te)
    ),
    labor AS (
      SELECT COALESCE(SUM(wol.total_cost), 0) AS total,
             COUNT(*) AS cnt
      FROM work_order_labor wol
      WHERE wol.timeline_event_id IN (SELECT id FROM vehicle_te)
    ),
    materials AS (
      SELECT COALESCE(SUM(wom.total_cost), 0) AS total
      FROM work_order_materials wom
      WHERE wom.timeline_event_id IN (SELECT id FROM vehicle_te)
    ),
    overhead AS (
      SELECT COALESCE(SUM(woo.total_overhead), 0) AS total
      FROM work_order_overhead woo
      WHERE woo.timeline_event_id IN (SELECT id FROM vehicle_te)
    ),
    tools AS (
      SELECT COALESCE(SUM(etu.depreciation_cost), 0) AS total
      FROM event_tools_used etu
      WHERE etu.event_id IN (SELECT id FROM vehicle_te)
    ),
    fin_records AS (
      SELECT COALESCE(SUM(efr.total_cost), 0) AS total
      FROM event_financial_records efr
      WHERE efr.event_id IN (SELECT id FROM vehicle_te)
    ),
    te_costs AS (
      SELECT COALESCE(SUM(cost_amount), 0) AS total
      FROM timeline_events
      WHERE vehicle_id = p_vehicle_id
        AND cost_amount IS NOT NULL AND cost_amount > 0
    ),
    rcpts AS (
      SELECT COALESCE(SUM(r.total), 0) AS total
      FROM receipts r
      WHERE r.scope_type = 'vehicle' AND r.duplicate_of IS NULL
        AND r.scope_id::uuid = p_vehicle_id
        AND r.total IS NOT NULL AND r.total > 0
    ),
    totals AS (
      SELECT
        parts.total  AS parts_total,
        labor.total  AS labor_total,
        materials.total AS materials_total,
        overhead.total AS overhead_total,
        tools.total  AS tools_total,
        fin_records.total AS fin_records_total,
        te_costs.total AS timeline_costs,
        rcpts.total  AS receipts_total,
        parts.cnt    AS parts_cnt,
        labor.cnt    AS labor_cnt,
        GREATEST(
          fin_records.total,
          parts.total + labor.total + materials.total + overhead.total + tools.total,
          te_costs.total,
          rcpts.total
        ) AS total_invested
      FROM parts, labor, materials, overhead, tools, fin_records, te_costs, rcpts
    )
  SELECT jsonb_build_object(
    'total_invested',    t.total_invested,
    'breakdown', jsonb_build_object(
      'parts',                   t.parts_total,
      'labor',                   t.labor_total,
      'materials',               t.materials_total,
      'overhead',                t.overhead_total,
      'tools',                   t.tools_total,
      'financial_records_total', t.fin_records_total
    ),
    'components_count', jsonb_build_object(
      'parts_items',        t.parts_cnt,
      'labor_tasks',        t.labor_cnt,
      'materials_items',    0,
      'events_with_work',   0
    )
  )
  FROM totals t;
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
  FROM receipts WHERE scope_type = 'vehicle' AND duplicate_of IS NULL AND scope_id::uuid = p_vehicle_id;
  
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
    WHERE r.user_id = target_user_id AND r.duplicate_of IS NULL
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
          WHERE ((r.vendor_name IS NOT NULL) AND (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL))
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
          WHERE (r.processing_status = 'completed'::text) AND (r.duplicate_of IS NULL)
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
  WHERE ((scope_type = 'vehicle'::text) AND (duplicate_of IS NULL))
  GROUP BY scope_id;

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
  if NEW.status='linked' then
    NEW.tie_kind := receipt_user_vehicle_tie(r.user_id, NEW.vehicle_id);
    if NEW.tie_kind is null then raise exception 'receipt_vehicle_links: paying user % not tied to vehicle %', r.user_id, NEW.vehicle_id; end if;
    NEW.type_gate := receipt_type_gate(NEW.receipt_id, NEW.vehicle_id);
    if NEW.type_gate='fail' then raise exception 'receipt_vehicle_links: type gate fail receipt % vehicle %', NEW.receipt_id, NEW.vehicle_id; end if;
    if NEW.basis_ref = '{}'::jsonb then raise exception 'receipt_vehicle_links: linked row needs basis_ref'; end if;
  end if;
  return NEW;
end $function$;
