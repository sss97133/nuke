-- Live row policies and grant state of public.ownership_transfers on 2026-10-14, before
-- 20261014190000_transfer_party_credentials_owner_only.sql. Test fixture only
-- (test_transfer_party_credentials_owner_only.sql loads it to reproduce the logged-out token read the migration closes).
--
-- Table ACL (pg_class.relacl, owner postgres excluded): anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt;
-- nothing to PUBLIC. Every column holds the table grant (no per-column attacl). Policies:
CREATE POLICY "Parties can update their transfer" ON public.ownership_transfers AS PERMISSIVE FOR UPDATE TO public
  USING (((( SELECT auth.uid() AS uid) = from_user_id) OR (( SELECT auth.uid() AS uid) = to_user_id)));
CREATE POLICY "Parties can view their transfer" ON public.ownership_transfers AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) = from_user_id) OR (( SELECT auth.uid() AS uid) = to_user_id)));
CREATE POLICY "Public can view non-hidden transfers" ON public.ownership_transfers AS PERMISSIVE FOR SELECT TO anon
  USING ((public_visibility <> 'hidden'::text));
