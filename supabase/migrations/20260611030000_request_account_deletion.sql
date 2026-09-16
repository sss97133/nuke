-- ============================================================================
-- Account deletion path — App Store rule 5.1.1(v) compliance
-- ============================================================================
-- Apps with account creation MUST offer in-app account deletion. The iOS app
-- (apps/nuke-capture-ios) calls POST /rest/v1/rpc/request_account_deletion as
-- the signed-in user. This migration provides:
--
--   1. account_deletion_requests — queue table (new-table justification: this
--      is the durable deletion queue required for 5.1.1(v); no existing table
--      records account-deletion intent, and auth.users cannot be safely
--      touched from SQL so a queue + service-role worker is the only safe
--      shape).
--   2. request_account_deletion() — SECURITY DEFINER RPC, authenticated only.
--      Immediately anonymizes the caller's public identity (profiles row) and
--      enqueues a 'pending' deletion request.
--
-- IMPORTANT — trust invariant: account deletion ANONYMIZES identity. It never
-- deletes testimony (vehicle_images / vehicle_observations / vehicle_events).
-- Contributed vehicle data is retained in anonymized form per privacy policy.
--
-- The 'pending' rows are drained by the edge function
-- supabase/functions/process-account-deletions (service role), which disables
-- sign-in via supabase.auth.admin.updateUserById(user_id, { ban_duration:
-- '876000h' }) and stamps processed_at. auth.users is intentionally NOT
-- modified from SQL here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processed', 'failed')),
  processed_at timestamptz
);

COMMENT ON TABLE public.account_deletion_requests IS
  'Queue of in-app account deletion requests (App Store 5.1.1(v)). Rows are written by request_account_deletion() and drained by the process-account-deletions edge function, which bans the auth user via the admin API and stamps processed_at. No FK to auth.users: the request row is the audit record and must outlive the auth user.';

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Owner can see their own request (e.g. to show "deletion pending" in-app).
DROP POLICY IF EXISTS account_deletion_requests_owner_read
  ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_owner_read
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: writes go through the SECURITY DEFINER
-- RPC below and the service-role worker (which bypasses RLS).

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid := auth.uid();
BEGIN
  IF owner IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Enqueue (idempotent — repeat taps of Delete Account are no-ops).
  INSERT INTO public.account_deletion_requests (user_id)
  VALUES (owner)
  ON CONFLICT (user_id) DO NOTHING;

  -- 2. Immediately anonymize public identity. Columns verified to exist on
  --    public.profiles via information_schema on 2026-06-10: username,
  --    full_name, avatar_url, city, state, location, bio (all nullable;
  --    username_lower is GENERATED from username).
  UPDATE public.profiles
  SET username   = 'deleted-' || left(id::text, 8),
      full_name  = 'Deleted User',
      avatar_url = NULL,
      city       = NULL,
      state      = NULL,
      location   = NULL,
      bio        = NULL
  WHERE id = owner;

  RETURN jsonb_build_object(
    'status', 'requested',
    'note', 'identity anonymized; sign-in disabled within 24h; contributed vehicle data is retained in anonymized form per privacy policy'
  );
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'App Store 5.1.1(v) in-app account deletion. Anonymizes the caller''s profiles row immediately and enqueues a pending row in account_deletion_requests. Sign-in disablement cannot be done safely from SQL (auth.users is off-limits); the process-account-deletions edge function (service role, cron/manual) drains pending rows via supabase.auth.admin.updateUserById(user_id, { ban_duration: ''876000h'' }) and stamps processed_at. Testimony tables are never touched — deletion anonymizes identity, never destroys substrate.';

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
