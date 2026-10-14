-- Live definitions read 2026-10-14 from production (pg_get_functiondef), the base for
-- 20261014050000_build_manifest_money_owner_only.sql. Reference only; not a migration.

-- compute_build_spend_profile: prosrc sha256 (base64) ZOinUbSTWQ5S5Z+aG8x9jmvlZCXFACj7tmW+B0jqNTA=; SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.compute_build_spend_profile(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  result jsonb;
BEGIN
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
    )
  ) INTO result
  FROM spend_summary ss
  CROSS JOIN by_category bc
  CROSS JOIN by_month bm
  CROSS JOIN by_vendor bv
  CROSS JOIN manifest_stats ms;

  RETURN result;
END;
$function$;

-- wiring_tech_manifest_summary: prosrc sha256 (base64) Xw7fUSGpSHHp662g8RLF6Je9utx4fKawwgYaK3FQnsc=; SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.wiring_tech_manifest_summary(p_vehicle_id uuid)
 RETURNS TABLE(devices_total integer, devices_purchased integer, devices_pending integer, spent_usd integer, pending_usd integer, total_spec_usd integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*)::int                                             AS devices_total,
    COUNT(*) FILTER (WHERE purchased)::int                    AS devices_purchased,
    COUNT(*) FILTER (WHERE NOT purchased OR purchased IS NULL)::int AS devices_pending,
    COALESCE(SUM(price) FILTER (WHERE purchased), 0)::int     AS spent_usd,
    COALESCE(SUM(price) FILTER (WHERE NOT purchased OR purchased IS NULL), 0)::int AS pending_usd,
    COALESCE(SUM(price), 0)::int                              AS total_spec_usd
  FROM vehicle_build_manifest
  WHERE vehicle_id = p_vehicle_id;
$function$;
