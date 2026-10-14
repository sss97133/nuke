-- Live row policies of public.business_user_roles on 2026-10-14, before
-- 20261014210000_business_user_roles_owner_managed.sql. Test fixture only.
-- Table ACL (relacl, owner excluded): anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt; nothing to PUBLIC.
-- Policy-set hash Aeb57aKPCTaS2vvvJ32l2IhZBIOPHC3QWvyrLDdQpd0= (5 policies).
CREATE POLICY "Business members can view roles" ON public.business_user_roles AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM business_ownership
  WHERE ((business_ownership.business_id = business_user_roles.business_id) AND (business_ownership.owner_id = ( SELECT auth.uid() AS uid)) AND (business_ownership.status = 'active'::text))))));
CREATE POLICY business_user_roles_delete ON public.business_user_roles AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY business_user_roles_insert ON public.business_user_roles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY business_user_roles_select ON public.business_user_roles AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY business_user_roles_update ON public.business_user_roles AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
