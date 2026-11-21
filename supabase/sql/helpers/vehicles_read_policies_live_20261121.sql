-- The read policies on public.vehicles as read from production on 2026-11-21 (pg_policies: the two policies with
-- cmd SELECT or ALL). For the contract tests only; the text is pg_policies.qual, unedited. vehicles_private_select
-- calls public.vehicle_user_has_access (helpers/vehicle_user_has_access_live_20261121.sql), which must exist first.
CREATE POLICY "vehicles_private_select" ON public.vehicles
  AS PERMISSIVE FOR SELECT TO public
  USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by) OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
CREATE POLICY "vehicles_public_select" ON public.vehicles
  AS PERMISSIVE FOR SELECT TO public
  USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
