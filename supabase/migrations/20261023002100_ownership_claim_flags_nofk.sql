-- Follow-up to 20261023001000: its ownership_claim_flags step timed out waiting for a lock on vehicles (FK).
-- Same objects without the FK (the writer validates the vehicle), in one transaction with short timeouts.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Unverified-ownership flag (additive). A shell qualifies only if it is on the user's account from their own import,
-- has no photos, no active permission and no ownership verification. Revert sets reverted_at.
CREATE TABLE IF NOT EXISTS public.ownership_claim_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL, user_id uuid NOT NULL, flag text NOT NULL
    CHECK (flag IN ('unverified_ownership')),
  run_id uuid NOT NULL, actor text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}', reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS ownership_claim_flags_live ON public.ownership_claim_flags (vehicle_id, user_id, flag) WHERE reverted_at IS NULL;
ALTER TABLE public.ownership_claim_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ownership_claim_flags_owner_read ON public.ownership_claim_flags;
CREATE POLICY ownership_claim_flags_owner_read ON public.ownership_claim_flags FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.flag_unverified_ownership_shells(p_run_id uuid, p_user uuid, p_vehicle_ids uuid[], p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; n int := 0; skipped jsonb := '[]';
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  FOR v IN SELECT x.id, ve.source, ve.owner_id, ve.user_id FROM unnest(p_vehicle_ids) x(id) LEFT JOIN vehicles ve ON ve.id = x.id LOOP
    IF v.source IS DISTINCT FROM 'owner_import' OR NOT (v.owner_id = p_user OR v.user_id = p_user)
       OR EXISTS (SELECT 1 FROM vehicle_images i WHERE i.vehicle_id = v.id)
       OR EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = v.id AND p.user_id = p_user
                  AND coalesce(p.is_active, true) AND p.revoked_at IS NULL)
       OR EXISTS (SELECT 1 FROM ownership_verifications w WHERE w.vehicle_id = v.id AND w.user_id = p_user) THEN
      skipped := skipped || to_jsonb(v.id); CONTINUE;
    END IF;
    INSERT INTO ownership_claim_flags (vehicle_id, user_id, flag, run_id, actor, evidence, reason)
    VALUES (v.id, p_user, 'unverified_ownership', p_run_id, 'agent:grok-bot',
            jsonb_build_object('source', v.source, 'photos', 0, 'active_permission', false, 'verification', false), p_reason)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'flagged', n, 'skipped', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.ownership_claim_flags_revert(p_run_id uuid)
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE ownership_claim_flags SET reverted_at = now() WHERE run_id = p_run_id AND reverted_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM u
$$;

REVOKE ALL ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_set_unfile_revert(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flag_unverified_ownership_shells(uuid,uuid,uuid[],text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ownership_claim_flags_revert(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_set_unfile_revert(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_unverified_ownership_shells(uuid,uuid,uuid[],text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ownership_claim_flags_revert(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.capture_set_before_image(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_before_image(uuid) TO service_role;
COMMIT;
