-- Five functions that answer about an account now answer only that account or the service role.
-- All five run as their owner (SECURITY DEFINER) and none compared the account asked about with the caller
-- (pg_get_functiondef and proacl, live, 2026-11-21):
--   * deals_needing_terms() kept the default EXECUTE for PUBLIC and returned every active consigned permission that
--     has no deal terms yet (vehicle, account, role and note) to any caller, a logged-out one included.
--   * user_deal_positions(uuid) kept the default EXECUTE for PUBLIC and returned the deal terms and amounts of
--     whichever account id was passed (no rows live today).
--   * get_user_vehicle_relationships(uuid) returned the vehicles of whichever account id a signed-in caller
--     passed, the ones that are not public and the deleted ones too.
--   * get_export_analytics(uuid) returned the export totals of whichever account id a signed-in caller passed.
--   * get_user_api_key_info(uuid, text) would return the stored provider credential of whichever account id a
--     signed-in caller passed. Latent: it keeps search_path '' over an unqualified table name, so every call, the
--     service role's too, fails with 42P01 before it reads a row (live call, 2026-11-21). Re-pinning its
--     search_path would have opened it; it is left as it is here and only its EXECUTE changes.
-- The caller test is get_photo_library_stats's (20261005021008), the one 20261021141000 reused: the caller's own
-- id or the service role. The two plpgsql readers raise 42501 before their body runs. The two sql readers keep
-- their language and volatility and return no row to anyone else: deals_needing_terms() now lists the caller's own
-- consigned permissions (every one for the service role), and user_deal_positions(uuid) answers only for the
-- caller's id.
-- A session with no JWT (psql, the SQL editor, a cron job) is not the service role: it gets 42501 from the plpgsql
-- readers and no row from the sql readers. Set request.jwt.claims for the session to call them by hand.
-- Everything else is live's, restated unchanged: bodies, arguments and their defaults, return types, SECURITY
-- DEFINER, function settings and volatility.
-- EXECUTE after: authenticated and service_role on the four readers (not PUBLIC, not anon); service_role alone
-- on get_user_api_key_info.
-- Consumers (git grep and cron.job, 2026-11-21): web listingExportService.ts passes the signed-in user's own id to
-- get_export_analytics; web useQuickVehicles.ts passes a user id to get_user_vehicle_relationships and nothing
-- mounts that hook; scripts/deep-image-analysis-byok.mjs calls get_user_api_key_info with the service key;
-- the two deal readers have no caller in web, iOS, edge functions, scripts or tools; no SQL function, view,
-- policy or cron job calls any of the five.
-- Contract: supabase/sql/test_account_scoped_readers_caller_check.sql (PG17).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.deals_needing_terms()
 RETURNS TABLE(vehicle_id uuid, user_id uuid, permission_role text, permission_context text, deal_jacket_id uuid, has_parties boolean, gap text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  SELECT
    vup.vehicle_id,
    vup.user_id,
    vup.role,
    vup.context,
    dj.id,
    EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id),
    CASE
      WHEN dj.id IS NULL THEN 'no_deal_jacket'
      WHEN NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id) THEN 'no_structured_parties'
      ELSE 'complete'
    END
  FROM vehicle_user_permissions vup
  LEFT JOIN deal_jackets dj ON dj.vehicle_id = vup.vehicle_id
    AND dj.deal_type = 'consignment'
    AND dj.sold_date IS NULL
  WHERE vup.role = 'consigned'
    AND vup.revoked_at IS NULL
    AND COALESCE(vup.is_active, true)
    AND (dj.id IS NULL OR NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id))
    AND (COALESCE(auth.uid() = vup.user_id, false)
         OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role')
  ORDER BY vup.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.user_deal_positions(p_user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(deal_jacket_id uuid, vehicle_id uuid, deal_type text, your_role text, threshold_amount numeric, split_pct numeric, expected_take numeric, actual_amount numeric, deal_status text, sale_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
  SELECT
    dj.id,
    dj.vehicle_id,
    dj.deal_type,
    p.role,
    p.threshold_amount,
    p.split_pct,
    CASE
      WHEN dj.sale_price_inc_doc IS NOT NULL AND p.split_pct IS NOT NULL THEN
        GREATEST(0, (dj.sale_price_inc_doc - COALESCE(p.threshold_amount, 0)) * p.split_pct / 100)
      WHEN p.flat_fee IS NOT NULL THEN p.flat_fee
      ELSE NULL
    END as expected_take,
    p.actual_amount,
    CASE
      WHEN dj.sold_date IS NOT NULL THEN 'closed'
      ELSE 'active'
    END,
    dj.sale_price_inc_doc
  FROM deal_jacket_parties p
  JOIN deal_jackets dj ON dj.id = p.deal_jacket_id
  WHERE p.user_id = p_user_id
    AND (COALESCE(auth.uid() = p_user_id, false)
         OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role')
  ORDER BY dj.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result JSON;
BEGIN
  IF NOT (COALESCE(auth.uid() = p_user_id, false)
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Vehicle relationships require their owner' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'user_added_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'user_id', v.user_id,
            'uploaded_by', v.uploaded_by, 'discovery_url', v.discovery_url,
            'discovery_source', v.discovery_source, 'profile_origin', v.profile_origin,
            'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url,
              'is_primary', true,
              'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM vehicles v
      WHERE v.user_id = p_user_id OR v.uploaded_by = p_user_id
    ),
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'discovery_source', dv.discovery_source,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'discovery_url', v.discovery_url, 'discovery_source', v.discovery_source,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM discovered_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.user_id = p_user_id AND dv.is_active = true
    ),
    'verified_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', ov.vehicle_id,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
      ), '[]'::json)
      FROM ownership_verifications ov
      JOIN vehicles v ON v.id = ov.vehicle_id
      WHERE ov.user_id = p_user_id AND ov.status = 'approved'
    ),
    'permission_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', vup.vehicle_id,
          'role', vup.role,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
      ), '[]'::json)
      FROM vehicle_user_permissions vup
      JOIN vehicles v ON v.id = vup.vehicle_id
      WHERE vup.user_id = p_user_id
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner', 'co_owner')
    )
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_export_analytics(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF NOT (COALESCE(auth.uid() = p_user_id, false)
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Export analytics require their owner' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'total_exports', COUNT(*),
    'by_platform', jsonb_object_agg(COALESCE(platform, 'unknown'), platform_count),
    'by_status', jsonb_object_agg(COALESCE(status, 'unknown'), status_count),
    'total_sold', SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END),
    'total_revenue_cents', SUM(CASE WHEN status = 'sold' THEN sold_price_cents ELSE 0 END),
    'total_commission_cents', SUM(CASE WHEN commission_cents IS NOT NULL THEN commission_cents ELSE 0 END),
    'conversion_rate', ROUND(
      (SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2
    )
  ) INTO v_result
  FROM (
    SELECT platform, status, sold_price_cents, commission_cents,
      COUNT(*) OVER (PARTITION BY platform) as platform_count,
      COUNT(*) OVER (PARTITION BY status) as status_count
    FROM listing_exports WHERE user_id = p_user_id
  ) exports;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.deals_needing_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deals_needing_terms() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_deal_positions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_deal_positions(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_vehicle_relationships(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_vehicle_relationships(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_export_analytics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_export_analytics(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_user_api_key_info(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_api_key_info(uuid, text) TO service_role;

-- The migration checks its own result: no logged-out caller executes any of the five, a signed-in caller never
-- executes the credential reader, and the service role still executes all five.
DO $check$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.deals_needing_terms()', 'public.user_deal_positions(uuid)',
    'public.get_user_vehicle_relationships(uuid)', 'public.get_export_analytics(uuid)',
    'public.get_user_api_key_info(uuid, text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can still execute %', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE on %', f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.get_user_api_key_info(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still execute public.get_user_api_key_info(uuid, text)';
  END IF;
END
$check$;

COMMIT;
