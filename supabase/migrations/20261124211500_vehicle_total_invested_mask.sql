-- 20261124211500 vehicle_total_invested_mask (vehicle_spend_viewer_v1)
--
-- WHY. Measured as a logged-out client (anon key), 2026-11-24 17:2x PT (lead) and 20:05 PT (packet):
-- get_vehicle_total_invested(p_vehicle_id) answered HTTP 200 with total_invested and every breakdown amount on the proof
-- vehicle. It is SECURITY DEFINER, anon may execute it, and it has no visibility test, so it answered for any vehicle id.
--
-- RULE. One tie test for vehicle money, vehicle_viewer_tied(vehicle_id): the service role, or a signed-in caller who is
-- the vehicle's owner_id / user_id / created_by_user_id / uploaded_by, or vehicle_user_has_access(). It is the test
-- receipts_public_summary applies (20261109140000, 20261124173000).
--   tied                               -> the reader's answer unchanged, plus amounts_visible = true
--   untied, vehicle public, not deleted -> documented_spend 'present' | 'none', components_count, amounts_visible = false;
--                                          total_invested and breakdown are null
--   untied, vehicle not public/deleted -> null
--
-- KEYS. The computing body is kept, renamed get_vehicle_total_invested_unmasked(uuid) and executable by service_role
-- only; get_vehicle_total_invested(uuid) is a wrapper. A later change to how spend is computed (the documented-spend fold,
-- #3694) replaces the _unmasked function, never the wrapper.
--
-- CALLERS (git grep + pg_proc + cron.job, 2026-11-24): nuke_frontend vehicleValuationService (handles amounts_visible =
-- false as no spend shown); no SQL function, cron job, edge function or iOS file calls it.
--
-- REVERT. supabase/sql/revert_20261124211500_vehicle_total_invested_mask.sql.
-- TEST. supabase/sql/test_vehicle_total_invested_mask.sql (disposable PG17).

SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
$$;
COMMENT ON FUNCTION public.vehicle_viewer_tied(uuid) IS
  'vehicle_spend_viewer_v1: true when this caller may see the vehicle''s money: service role, or the signed-in owner_id / user_id / created_by_user_id / uploaded_by, or vehicle_user_has_access. The same test receipts_public_summary applies.';
REVOKE ALL ON FUNCTION public.vehicle_viewer_tied(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_tied(uuid) TO anon, authenticated, service_role;

DO $rename$
BEGIN
  IF to_regprocedure('public.get_vehicle_total_invested_unmasked(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_vehicle_total_invested(uuid) RENAME TO get_vehicle_total_invested_unmasked;
  END IF;
END
$rename$;
REVOKE ALL ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) TO service_role;
COMMENT ON FUNCTION public.get_vehicle_total_invested_unmasked(uuid) IS
  'vehicle_spend_viewer_v1: the spend computation behind get_vehicle_total_invested, unmasked. service_role only; every other caller reads get_vehicle_total_invested.';

CREATE OR REPLACE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id, v.is_public IS TRUE AND v.deleted_at IS NULL AS visible, public.vehicle_viewer_tied(v.id) AS tied
      FROM public.vehicles v WHERE v.id = p_vehicle_id),
  r AS (SELECT public.get_vehicle_total_invested_unmasked(p_vehicle_id) AS j
         WHERE EXISTS (SELECT 1 FROM v WHERE v.tied OR v.visible))
  SELECT CASE
           WHEN (SELECT tied FROM v) THEN (SELECT j FROM r) || jsonb_build_object('amounts_visible', true)
           WHEN (SELECT visible FROM v) THEN jsonb_build_object(
             'amounts_visible', false,
             'documented_spend', CASE WHEN coalesce(((SELECT j FROM r) ->> 'total_invested')::numeric, 0) > 0 THEN 'present' ELSE 'none' END,
             'total_invested', NULL,
             'breakdown', NULL,
             'components_count', (SELECT j FROM r) -> 'components_count')
         END
$$;
COMMENT ON FUNCTION public.get_vehicle_total_invested(uuid) IS
  'vehicle_spend_viewer_v1: documented spend for this caller. Tied (vehicle_viewer_tied): get_vehicle_total_invested_unmasked plus amounts_visible true. Untied on a public vehicle: documented_spend present/none and counts, no amounts. Otherwise null.';
REVOKE ALL ON FUNCTION public.get_vehicle_total_invested(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested(uuid) TO anon, authenticated, service_role;
