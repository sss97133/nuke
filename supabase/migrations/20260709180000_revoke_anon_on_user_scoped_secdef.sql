-- Close the anon hole on SECURITY DEFINER functions that trust a caller-supplied user id.
--
-- THE DEFECT
-- A SECURITY DEFINER function bypasses RLS. If it then authorizes against a
-- *parameter* (`p_user_id`) rather than `auth.uid()`, it authorizes nothing: the
-- caller simply passes whoever's id they like. 116 such functions in `public`
-- had EXECUTE granted to `anon` and/or PUBLIC.
--
-- VERIFIED AGAINST PROD 2026-07-09 (not inferred):
--   * POST /rest/v1/rpc/get_user_garage with the public anon key and an arbitrary
--     p_user_id → HTTP 200, 130 rows, 35 purchase_price values.
--   * POST /rest/v1/rpc/get_user_profile_fast with the anon key → HTTP 200,
--     including the user's email address.
--   * get_user_cash_balance as anon → 42P01 "relation does not exist", NOT 42501
--     "permission denied". The permission check PASSED; only a dropped table from a
--     retired feature stopped it.
--
-- Backing tables still exist for the dangerous ones: add_cash_to_user →
-- user_cash_balances, mcp_create_api_key → api_keys, create_ownership_verification
-- → ownership_verifications, merge_duplicate_vehicles → vehicles.
--
-- THE FIX
-- Revoke EXECUTE from anon and PUBLIC. `authenticated` and `service_role` keep it:
-- all 116 carry an explicit `authenticated=X` grant, so no logged-in path changes,
-- and no write path is lost. 82 of these have zero call sites in nuke_frontend/src;
-- the other 31 are logged-in actions (notifications, uploads, portfolio, merges).
--
-- This is defence in depth, NOT the root fix. Each function should still be
-- rewritten to authorize on auth.uid() (see get_vehicle_build_ledger and
-- supersede_observation for the house pattern). Revoking anon buys the time to do it.
--
-- Written as a catalog-driven loop so it is idempotent and cannot drift from the
-- list above. Re-running it is a no-op once the grants are gone.

DO $$
DECLARE
  r record;
  n_revoked int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND pg_get_function_identity_arguments(p.oid) ~*
          '(p_user_id|p_owner_id|p_profile_id|target_user_id|p_actor_user_id|p_admin_user_id|p_requester_id|p_merged_by_user_id|p_owner_user_id)'
      AND (array_to_string(p.proacl, ' ') ILIKE '%anon=X%'
           OR array_to_string(p.proacl, ' ') LIKE '=X/%')
  LOOP
    -- Idempotent no-op where the grant already exists; guarantees we never strip a
    -- logged-in user's access by revoking PUBLIC out from under them.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
    n_revoked := n_revoked + 1;
  END LOOP;

  RAISE NOTICE 'revoked anon/PUBLIC EXECUTE on % SECURITY DEFINER functions', n_revoked;
END $$;
