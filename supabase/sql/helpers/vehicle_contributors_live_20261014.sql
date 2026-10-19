-- Live row policies of public.vehicle_contributors on 2026-10-14, before
-- 20261014230000_vehicle_contributors_no_self_grant.sql. Test fixture only.
-- Table ACL (relacl, owner excluded): anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt; no PUBLIC.
-- Policy-set hash 2GGlz5/MpLrgQvC04ODQJg+PHrOS3bkWptq9dx20eNE= (6 policies).
CREATE POLICY "Allow authenticated reads" ON public.vehicle_contributors AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Users can manage contributors for vehicles they own" ON public.vehicle_contributors AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = vehicle_contributors.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Users can view contributors for vehicles they own" ON public.vehicle_contributors AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM vehicles
  WHERE ((vehicles.id = vehicle_contributors.vehicle_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid))))));
CREATE POLICY insert_self_contributor ON public.vehicle_contributors AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid)));
CREATE POLICY read_contributors ON public.vehicle_contributors AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY update_self_contributor ON public.vehicle_contributors AS PERMISSIVE FOR UPDATE TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'::uuid)));
