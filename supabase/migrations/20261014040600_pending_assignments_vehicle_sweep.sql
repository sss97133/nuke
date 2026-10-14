-- get_pending_vehicle_assignments names its vehicles in one prefetched sweep instead of one random probe each.
--
-- Measured 2026-10-14. The Dashboard lists a signed-in user's pending vehicle-to-organization link suggestions
-- (Dashboard.tsx -> DashboardService.getPendingVehicleAssignments). pg_stat_statements since 2026-09-29 09:20Z:
-- 10 authenticated calls, mean 3,692 ms, max 7,331 ms. As authenticated for the owner's account: 4,662 ms, 8,902 blocks
-- read from disk, 19,789 rows returned (of 20,248 pending in all: he is an active contributor of 8 organizations, which
-- makes every pending suggestion for those organizations his to see).
-- Cause (EXPLAIN ANALYZE, deploy role): the 19,789 rows name 4,999 distinct vehicles, and each is fetched by its own random
-- index probe into the 6 KB-wide vehicles heap: 0.86 ms each cold, 4.3 s of the 4.5 s. The same ids fetched as one bitmap
-- heap scan (which prefetches; effective_io_concurrency is 200) cost 0.15 ms each on production (Palm Beach County,
-- 9,995 vehicles: 1.5 s, against 1.77 ms each by probes elsewhere).
--
-- Measured on production, owner's id, the exact new body as a temp function: 1,760 ms on a cold look (the live function: 4,662 ms
-- and 7,349 ms on cold looks), 172-183 ms warm (live 161-171 ms), the identical 19,789 rows.
-- After: the same rows in the same order, the vehicle names read once by id as a bitmap heap scan (enable_indexscan is off
-- for that one statement and restored), then joined in memory. Same return shape, same visibility rule (assignments the
-- user may see: pending, on a vehicle they uploaded or own, or of an organization they actively contribute to), same
-- SECURITY DEFINER, same grants (authenticated, service_role). Not changed here, and for Skylar: the Dashboard draws every
-- returned row, 19,789 of them for this account, in one list; a cap or a page there is a product decision.
--
-- The function is replaced only from its 2026-10-14 source (md5 of pg_get_functiondef); any other source stops the
-- migration. Contract: supabase/sql/test_pending_assignments_sweep.sql (CI job pending-assignments-sweep-contract).
-- definer-grants: default reviewed get_pending_vehicle_assignments
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $guard$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.get_pending_vehicle_assignments(uuid)'));
BEGIN
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.get_pending_vehicle_assignments(uuid) does not exist';
  END IF;
  IF md5(v_def) IS DISTINCT FROM '130a2f1e650d66a22a9fa5532de6ed65' AND v_def NOT LIKE '%v_vehicle_ids%' THEN
    RAISE EXCEPTION 'get_pending_vehicle_assignments is not the 2026-10-14 source this migration was written from (md5 %); re-read it', md5(v_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_pending_vehicle_assignments(p_user_id uuid)
 RETURNS TABLE(id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric, evidence_sources text[], created_at timestamp with time zone, vehicle_id uuid, organization_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vehicle_ids uuid[];
  v_ids uuid[];
  v_names text[];
  v_indexscan text := current_setting('enable_indexscan');
BEGIN
  -- The vehicles the assignments the user may see are about.
  SELECT COALESCE(array_agg(DISTINCT pva.vehicle_id), '{}') INTO v_vehicle_ids
  FROM pending_vehicle_assignments pva
  WHERE pva.status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM vehicles v2
        WHERE v2.id = pva.vehicle_id
          AND (v2.uploaded_by = p_user_id OR v2.user_id = p_user_id)
      )
      OR EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = pva.organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      )
    );

  -- Their names, in one bitmap heap scan: a random probe per vehicle is 0.86 ms each cold; the sweep prefetches.
  PERFORM set_config('enable_indexscan', 'off', true);
  SELECT COALESCE(array_agg(v.id), '{}'), COALESCE(array_agg(v.year || ' ' || v.make || ' ' || v.model), '{}')
  INTO v_ids, v_names
  FROM vehicles v
  WHERE v.id = ANY (v_vehicle_ids);
  PERFORM set_config('enable_indexscan', v_indexscan, true);

  RETURN QUERY
  SELECT
    pva.id,
    n.name,
    b.business_name,
    pva.suggested_relationship_type,
    pva.overall_confidence,
    pva.evidence_sources,
    pva.created_at,
    pva.vehicle_id,
    pva.organization_id
  FROM pending_vehicle_assignments pva
  JOIN unnest(v_ids, v_names) AS n(id, name) ON n.id = pva.vehicle_id
  JOIN businesses b ON b.id = pva.organization_id
  WHERE pva.status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM vehicles v2
        WHERE v2.id = pva.vehicle_id
          AND (v2.uploaded_by = p_user_id OR v2.user_id = p_user_id)
      )
      OR EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = pva.organization_id
          AND oc.user_id = p_user_id
          AND oc.status = 'active'
      )
    )
  ORDER BY pva.overall_confidence DESC, pva.created_at DESC;
END;
$function$;

COMMENT ON FUNCTION public.get_pending_vehicle_assignments(uuid) IS
  'A user''s pending vehicle-to-organization link suggestions, most confident first: pending assignments on a vehicle the user uploaded or owns, or of an organization they actively contribute to, with the vehicle''s name and the organization''s name. SECURITY DEFINER; the caller passes their own id. Names the vehicles in one bitmap heap scan instead of a random probe each (4,662 ms cold to 1,760 ms cold for 19,789 rows over 4,999 vehicles, 2026-10-14). Used by the Dashboard.';

COMMIT;
