-- business_user_roles is managed by the business's owner, not self-assigned, and its rows (which carry hourly_rate)
-- stop being readable by everyone.
--
-- Live on 2026-10-14: business_user_roles_insert had WITH CHECK only auth.uid() IS NOT NULL, so any signed-in account
-- inserted a staff role for any business_id; business_user_roles_update and _delete were scoped to the caller's own
-- rows with no column limit, so a member could change their own row's business_id or role_type; and
-- business_user_roles_select was USING (true), so anyone (logged out included) read every staff row, including
-- hourly_rate. dealer_inventory's "Dealer members can manage inventory" (ALL) trusts any business_user_roles row for
-- the dealer, so a self-inserted role granted full write over that dealer's 3,092 inventory rows. Population: 2 role
-- rows on 2 businesses.
--
-- After:
--   * INSERT / UPDATE / DELETE for the business's active owner (an active business_ownership row, which an org's
--     creator gets from the create_initial_business_ownership trigger). UPDATE's WITH CHECK requires the new row's
--     business to be one the caller owns too, so a role cannot be moved to another business. A member may still
--     delete their own row (leave).
--   * SELECT is the existing "Business members can view roles" (the member's own rows, or the business owner's view).
--     The blanket USING (true) policy is dropped, so a stranger no longer reads staff rows or hourly_rate. The
--     gating policies (dealer_inventory, business_invite_codes, shop_fee_settings, bat_buyer_monitors) read a row by
--     user_id = auth.uid(), which that policy still admits.
-- Existing rows are untouched. Writers run as the business owner (AddOrganizationData's add-member, businessService).
-- Live policies: supabase/sql/helpers/business_user_roles_live_20261014.sql.
-- Contract: supabase/sql/test_business_user_roles_owner_managed.sql (CI job business-user-roles-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

DO $guard$
DECLARE v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
    INTO v_hash
  FROM pg_policy p WHERE p.polrelid = 'public.business_user_roles'::regclass;
  IF v_hash NOT IN ('Aeb57aKPCTaS2vvvJ32l2IhZBIOPHC3QWvyrLDdQpd0=', 'Ug+M/ts2iJokO/mHu0i1hVqw0VGrkTaiG41pnONgy/4=') THEN
    RAISE EXCEPTION 'business_user_roles policies drifted from the 2026-10-14 read (hash %); not changing them', v_hash;
  END IF;
END $guard$;

DROP POLICY IF EXISTS business_user_roles_select ON public.business_user_roles;

DROP POLICY IF EXISTS business_user_roles_insert ON public.business_user_roles;
CREATE POLICY business_user_roles_insert ON public.business_user_roles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_ownership bo
                      WHERE bo.business_id = business_user_roles.business_id
                        AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active'));

DROP POLICY IF EXISTS business_user_roles_update ON public.business_user_roles;
CREATE POLICY business_user_roles_update ON public.business_user_roles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.business_ownership bo
                 WHERE bo.business_id = business_user_roles.business_id
                   AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_ownership bo
                      WHERE bo.business_id = business_user_roles.business_id
                        AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active'));

DROP POLICY IF EXISTS business_user_roles_delete ON public.business_user_roles;
CREATE POLICY business_user_roles_delete ON public.business_user_roles
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.business_ownership bo
                    WHERE bo.business_id = business_user_roles.business_id
                      AND bo.owner_id = (SELECT auth.uid()) AND bo.status = 'active'));

COMMIT;
