-- Live state of public.discovered_persons and its two anon-reachable resolvers on 2026-10-14, before
-- 20261014220000_discovered_persons_owner_only.sql. Test fixture only.
-- discovered_persons relacl (owner excluded): anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt; no PUBLIC.
-- Policy-set hash h5hm2+phM+2AbpNR5TkyYmc+sFV8023Pw834EO2Zqiw= (2 policies).
-- resolve_contact_vehicle(text) and resolve_vehicle_from_input(text,uuid) proacl: {=X,postgres,anon,authenticated,
-- service_role} -- PUBLIC holds EXECUTE. Both are SECURITY INVOKER and fuzzy-match a query string across
-- deal_contacts, work_orders and discovered_persons, returning contact name/email/phone.
CREATE POLICY "Public read discovered persons" ON public.discovered_persons AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Service writes discovered persons" ON public.discovered_persons AS PERMISSIVE FOR ALL TO public
  USING ((auth.role() = 'service_role'::text));
