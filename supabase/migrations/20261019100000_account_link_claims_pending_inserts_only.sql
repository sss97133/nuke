-- A user's own claim insert files a pending, unreviewed claim and nothing more.
--
-- Live on 2026-10-19: alc_insert_own checked only user_id = auth.uid(), so a signed-in user could insert a claim
-- already marked approved or verified, with a reviewer, a review clock, a confidence score or a verification method
-- (directly at /rest/v1/account_link_claims or through the external_identity_claims view, whose INSTEAD OF trigger
-- runs as the caller). Actor claims were already held to a pending self_claim by account_link_claims_actor_guard.
-- After: a user insert must be status pending with no reviewer, review clock, rung evidence or confidence, and a
-- verification method of NULL (external claim) or self_claim (actor claim). Approvals stay with the service paths
-- (approve_external_identity_claim, approve_actor_link_claim, the MCP verify tool). request_external_identity_claim is
-- SECURITY DEFINER and service_role bypasses RLS, so neither is affected. Live rows (2, both pending) are unchanged.
-- Contract: supabase/sql/test_account_link_claims_pending_inserts_only.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
      WHERE polrelid = 'public.account_link_claims'::regclass AND polname = 'alc_insert_own')
      IS DISTINCT FROM '(user_id = ( SELECT auth.uid() AS uid))' THEN
    RAISE EXCEPTION 'alc_insert_own differs from the reviewed definition';
  END IF;
END $guard$;

ALTER POLICY alc_insert_own ON public.account_link_claims WITH CHECK (
  user_id = (SELECT auth.uid())
  AND status = 'pending'
  AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL
  AND rung_evidence = '[]'::jsonb
  AND COALESCE(claim_confidence, 0) = 0
  AND ((actor_id IS NULL AND verification_method IS NULL) OR (actor_id IS NOT NULL AND verification_method = 'self_claim')));
COMMENT ON POLICY alc_insert_own ON public.account_link_claims IS 'A user files only their own pending, unreviewed claim: external (no verification method) or actor (self_claim). Approval is service-only.';
NOTIFY pgrst, 'reload schema';
COMMIT;
