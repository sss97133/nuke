-- RLS Audit: vehicles, vehicle_observations, auction_comments
-- Task: 23e13c96-0fcb-42cc-8ddb-60f283609b2d
--
-- Fixes:
-- 1. vehicle_observations: enable RLS (was completely unprotected), add service_role+read policies
-- 2. vehicles.allow_vehicle_inserts: drop (allowed anon inserts) → replace with authenticated-only insert
-- 3. vehicles.vehicles_delete_policy: change from {public} to {authenticated} role

-- ============================================================
-- 1. vehicle_observations — Enable RLS
-- ============================================================
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;

-- Service role has full access (extraction pipeline, edge functions)
CREATE POLICY "vo_service_role_all"
  ON public.vehicle_observations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING  ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Authenticated users can read observations for vehicles they can access
CREATE POLICY "vo_authenticated_read"
  ON public.vehicle_observations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_observations.vehicle_id
        AND (
          v.is_public = true
          OR v.user_id    = auth.uid()
          OR v.owner_id   = auth.uid()
          OR v.uploaded_by = auth.uid()
        )
    )
  );

-- ============================================================
-- 2. vehicles — Fix anon insert vulnerability
-- ============================================================

-- Drop the open public INSERT policy
DROP POLICY IF EXISTS "allow_vehicle_inserts" ON public.vehicles;

-- Replace with authenticated-only INSERT; uploaded_by must match caller
CREATE POLICY "vehicles_authenticated_insert"
  ON public.vehicles
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. vehicles — Fix delete policy role (public → authenticated)
-- ============================================================

-- Drop the {public}-role delete policy and recreate as {authenticated}
DROP POLICY IF EXISTS "vehicles_delete_policy" ON public.vehicles;

CREATE POLICY "vehicles_delete_policy"
  ON public.vehicles
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    (auth.uid() = uploaded_by)
    OR EXISTS (
      SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = vehicles.id
        AND vc.user_id = auth.uid()
        AND vc.role = ANY (ARRAY['moderator'::text, 'owner'::text])
        AND (vc.end_date IS NULL OR vc.end_date > CURRENT_DATE)
    )
  );
