-- The build manifest's money, invoices, supplier contacts, evidence sources and notes reach the owner only.
--
-- Measured 2026-10-14 ~04:40Z with the anon key (counts only): vehicle_build_manifest ("Public read" policy,
-- qual true, and full table grants to anon and authenticated) returned 141 rows with 138 price, 52
-- invoice_ref, 4 actual_cost and 3 supplier_contact values; evidence_sources carries client-invoice package
-- amounts and 11 notes carry dollar figures. wiring_tech_manifest_summary (SECURITY DEFINER, EXECUTE for anon)
-- returned spent, pending and total dollars. build_cost_comparison, device_installation_status and
-- harness_workstation (141 rows each) and invoice_learned_pricing (157 rows: unit prices, source invoices,
-- shops) were readable by anon; no web, iOS or edge-function code reads those four (edge functions use the
-- service role). The web masked prices client-side only (BuildManifestPanel "$•••").
--
-- Now: anon and authenticated keep SELECT on the 59 public manifest columns and lose the nine owner fields;
-- owners read those through vehicle_build_manifest_owner_fields(vehicle_id), which resolves the caller once
-- (owner, uploader or a contributor with access: the rule of #1001, #1037 and 20261013170000) and returns no
-- rows to anyone else. wiring_tech_manifest_summary keeps its signature and returns null dollars to
-- non-owners. compute_build_spend_profile becomes SECURITY DEFINER (it reads the now-restricted price column)
-- and returns counts plus money_masked = true to non-owners. The four unused readers lose anon and
-- authenticated access. Built from the live definitions in
-- supabase/sql/helpers/build_manifest_money_live_20261014.sql, guarded by their source hashes; the last block
-- checks this migration's own result.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';

DO $guard$
DECLARE a text; b text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a FROM pg_proc WHERE oid = 'public.compute_build_spend_profile(uuid)'::regprocedure;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO b FROM pg_proc WHERE oid = 'public.wiring_tech_manifest_summary(uuid)'::regprocedure;
  IF a IS DISTINCT FROM 'ZOinUbSTWQ5S5Z+aG8x9jmvlZCXFACj7tmW+B0jqNTA='
     OR b IS DISTINCT FROM 'Xw7fUSGpSHHp662g8RLF6Je9utx4fKawwgYaK3FQnsc=' THEN
    RAISE EXCEPTION 'compute_build_spend_profile or wiring_tech_manifest_summary differs from the reviewed definition';
  END IF;
  IF to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_user_has_access is missing';
  END IF;
END $guard$;

-- 1. The table: public columns for everyone, nothing else; writes stay with the service role (policy "Service write").
REVOKE ALL ON public.vehicle_build_manifest FROM anon, authenticated;
GRANT SELECT (id, vehicle_id, device_name, device_category, manufacturer, model_number, part_number,
  catalog_part_id, supplier, purchased, pin_count, endpoint_description, power_draw_amps, signal_type,
  requires_shielding, connector_type, wire_gauge_recommended, location_zone, install_guide_url,
  wiring_diagram_url, datasheet_url, device_pin_map_id, pct_complete, missing_fields, status, created_at,
  updated_at, sourcing_difficulty, lead_time_days, supplier_type, layer, pos_x_pct, pos_y_pct, pdm_controlled,
  pdm_channel_group, product_image_url, wire_status, integration_decision, open_questions, evidence_level,
  harness_relevant, device_category_v2, device_family_v2, location_zone_v2, taxonomy_v2_notes, tier, pos_x_m,
  pos_y_m, pos_z_m, pos_source, weight_lbs, length_in, width_in, height_in, truck_runs_without_this,
  pdm_channel_id, interface_id, lifecycle_state, subsystem)
  ON public.vehicle_build_manifest TO anon, authenticated;

-- 2. The owner's fields, for the owner only.
CREATE OR REPLACE FUNCTION public.vehicle_build_manifest_owner_fields(p_vehicle_id uuid)
RETURNS TABLE(id uuid, price numeric, price_source text, invoice_ref text, quoted_cost numeric,
              actual_cost numeric, cost_source text, supplier_contact text, evidence_sources jsonb, notes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_owner boolean;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
            OR public.vehicle_user_has_access(v.id, auth.uid())))
    INTO v_owner FROM public.vehicles v WHERE v.id = p_vehicle_id;
  IF NOT coalesce(v_owner, false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.id, m.price, m.price_source, m.invoice_ref, m.quoted_cost, m.actual_cost, m.cost_source,
           m.supplier_contact, m.evidence_sources::jsonb, m.notes
    FROM public.vehicle_build_manifest m
    WHERE m.vehicle_id = p_vehicle_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.vehicle_build_manifest_owner_fields(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_build_manifest_owner_fields(uuid) TO anon, authenticated, service_role;

-- 3. Same signature and grants; the dollars are null unless the caller is the owner.
CREATE OR REPLACE FUNCTION public.wiring_tech_manifest_summary(p_vehicle_id uuid)
 RETURNS TABLE(devices_total integer, devices_purchased integer, devices_pending integer, spent_usd integer, pending_usd integer, total_spec_usd integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer AS (
    SELECT coalesce((SELECT auth.uid() IS NOT NULL AND (auth.uid() IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                              OR public.vehicle_user_has_access(v.id, auth.uid()))
                     FROM public.vehicles v WHERE v.id = p_vehicle_id), false) AS is_owner)
  SELECT
    COUNT(*)::int                                             AS devices_total,
    COUNT(*) FILTER (WHERE purchased)::int                    AS devices_purchased,
    COUNT(*) FILTER (WHERE NOT purchased OR purchased IS NULL)::int AS devices_pending,
    CASE WHEN (SELECT is_owner FROM viewer) THEN COALESCE(SUM(price) FILTER (WHERE purchased), 0)::int END AS spent_usd,
    CASE WHEN (SELECT is_owner FROM viewer) THEN COALESCE(SUM(price) FILTER (WHERE NOT purchased OR purchased IS NULL), 0)::int END AS pending_usd,
    CASE WHEN (SELECT is_owner FROM viewer) THEN COALESCE(SUM(price), 0)::int END AS total_spec_usd
  FROM vehicle_build_manifest
  WHERE vehicle_id = p_vehicle_id;
$function$;

-- 4. SECURITY DEFINER now (it reads price); the owner gets the live document plus money_masked = false,
--    everyone else the device counts and money_masked = true.
CREATE OR REPLACE FUNCTION public.compute_build_spend_profile(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_owner boolean;
BEGIN
  SELECT (auth.uid() IS NOT NULL AND (auth.uid() IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
            OR public.vehicle_user_has_access(v.id, auth.uid())))
    INTO v_owner FROM public.vehicles v WHERE v.id = p_vehicle_id;
  IF NOT coalesce(v_owner, false) THEN
    SELECT jsonb_build_object(
      'manifest', jsonb_build_object(
        'total_devices', count(*),
        'purchased', count(CASE WHEN purchased THEN 1 END),
        'purchased_pct', round(count(CASE WHEN purchased THEN 1 END)::numeric / NULLIF(count(*), 0) * 100, 1)),
      'money_masked', true)
      INTO result
    FROM vehicle_build_manifest WHERE vehicle_id = p_vehicle_id;
    RETURN result;
  END IF;

  WITH spend_summary AS (
    SELECT
      coalesce(sum(total_amount), 0) as total_documented_spend,
      coalesce(sum(CASE WHEN confidence >= 0.5 THEN total_amount ELSE 0 END), 0) as attributed_spend,
      coalesce(sum(CASE WHEN confidence < 0.5 THEN total_amount ELSE 0 END), 0) as unattributed_spend,
      coalesce(sum(CASE WHEN enhanced_confidence >= 0.7 THEN total_amount ELSE 0 END), 0) as high_conf_spend,
      count(*) as total_transactions
    FROM qb_transactions
    WHERE vehicle_id = p_vehicle_id
  ),
  by_category AS (
    SELECT jsonb_object_agg(
      coalesce(category, 'unknown'),
      jsonb_build_object('count', cnt, 'spend', spend)
    ) as categories
    FROM (
      SELECT category, count(*) as cnt, sum(total_amount) as spend
      FROM qb_transactions
      WHERE vehicle_id = p_vehicle_id
      GROUP BY category
    ) sub
  ),
  by_month AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'month', month_date::date,
        'spend', sum_amount,
        'count', cnt
      ) ORDER BY month_date
    ) as timeline
    FROM (
      SELECT date_trunc('month', "date") as month_date,
             sum(total_amount) as sum_amount,
             count(*) as cnt
      FROM qb_transactions
      WHERE vehicle_id = p_vehicle_id
      GROUP BY date_trunc('month', "date")
    ) sub
  ),
  by_vendor AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'vendor', vendor_name,
        'spend', spend,
        'count', cnt,
        'avg_confidence', avg_conf
      ) ORDER BY spend DESC
    ) as vendors
    FROM (
      SELECT vendor_name, sum(total_amount) as spend, count(*) as cnt,
             round(avg(coalesce(enhanced_confidence, confidence))::numeric, 3) as avg_conf
      FROM qb_transactions
      WHERE vehicle_id = p_vehicle_id AND vendor_name IS NOT NULL
      GROUP BY vendor_name
      ORDER BY spend DESC
      LIMIT 20
    ) sub
  ),
  manifest_stats AS (
    SELECT
      count(*) as total_devices,
      count(CASE WHEN purchased THEN 1 END) as purchased_count,
      count(price) as priced_count,
      coalesce(sum(price), 0) as total_manifest_value,
      coalesce(sum(CASE WHEN purchased THEN price ELSE 0 END), 0) as purchased_value,
      round(count(CASE WHEN purchased THEN 1 END)::numeric / NULLIF(count(*), 0) * 100, 1) as purchased_pct,
      round(count(price)::numeric / NULLIF(count(*), 0) * 100, 1) as priced_pct
    FROM vehicle_build_manifest
    WHERE vehicle_id = p_vehicle_id
  )
  SELECT jsonb_build_object(
    'total_documented_spend', ss.total_documented_spend,
    'attributed_spend', ss.attributed_spend,
    'unattributed_spend', ss.unattributed_spend,
    'high_confidence_spend', ss.high_conf_spend,
    'total_transactions', ss.total_transactions,
    'by_category', coalesce(bc.categories, '{}'::jsonb),
    'by_month', coalesce(bm.timeline, '[]'::jsonb),
    'by_vendor', coalesce(bv.vendors, '[]'::jsonb),
    'manifest', jsonb_build_object(
      'total_devices', ms.total_devices,
      'purchased', ms.purchased_count,
      'priced', ms.priced_count,
      'total_value', ms.total_manifest_value,
      'purchased_value', ms.purchased_value,
      'purchased_pct', ms.purchased_pct,
      'priced_pct', ms.priced_pct
    ),
    'money_masked', false
  ) INTO result
  FROM spend_summary ss
  CROSS JOIN by_category bc
  CROSS JOIN by_month bm
  CROSS JOIN by_vendor bv
  CROSS JOIN manifest_stats ms;

  RETURN result;
END;
$function$;

-- 5. Readers no client uses that carry the same money: service role only.
REVOKE ALL ON public.build_cost_comparison, public.device_installation_status, public.harness_workstation,
  public.wiring_enrichment_dashboard, public.invoice_learned_pricing FROM anon, authenticated;

-- 6. This migration's own result.
DO $check$
BEGIN
  IF has_column_privilege('anon', 'public.vehicle_build_manifest', 'price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicle_build_manifest', 'invoice_ref', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicle_build_manifest', 'notes', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicle_build_manifest', 'evidence_sources', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.vehicle_build_manifest', 'device_name', 'SELECT')
     OR has_table_privilege('anon', 'public.vehicle_build_manifest', 'UPDATE')
     OR has_table_privilege('anon', 'public.build_cost_comparison', 'SELECT')
     OR has_table_privilege('authenticated', 'public.invoice_learned_pricing', 'SELECT')
     OR NOT has_function_privilege('anon', 'public.vehicle_build_manifest_owner_fields(uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.compute_build_spend_profile(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'build manifest money grants did not land as written';
  END IF;
END $check$;

COMMIT;
