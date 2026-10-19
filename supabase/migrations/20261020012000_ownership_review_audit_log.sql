-- Ownership review path: approve_ownership_verification works again.
--
-- Live on 2026-10-19 approve_ownership_verification (service-only) failed on every call: it INSERTs into
-- verification_audit_log and UPDATEs verification_queue, and both tables were dropped (20260927180000 lists it dead for
-- that reason). admin_approve_ownership_verification (calls it) and admin_reject_ownership_verification (INSERTs into
-- verification_audit_log) failed the same way. No live table holds the same record: security_audit_log and
-- org_audit_log are other subjects, and the review queue (with verification_reviewers) has no live successor.
--   * verification_audit_log is recreated minimal (the columns these writers use, the original action and actor_type
--     vocabularies), service-only, append-only.
--   * approve_ownership_verification is unchanged except that the dropped-queue UPDATE is removed. Grants unchanged
--     (CREATE OR REPLACE keeps the ACL: postgres, service_role). admin_reject_ownership_verification works unchanged.
-- The same path also broke one step earlier: trg_recompute_value_on_ov runs recompute_value_from_ov as the writer, and
-- compute_vehicle_value has been service-only since 20260927170000, so a signed-in user's own pending submission (and an
-- admin approving through the RLS admin policy) failed with permission denied. recompute_value_from_ov now runs as its
-- owner and recomputes only when a row enters or leaves 'approved' (the transitions only admins and the service role can
-- make); pending inserts and document edits never changed the computed value.
-- assign_verification_to_reviewer (queue + reviewers) stays dead; nothing live calls it.
-- Contract: supabase/sql/test_ownership_review_audit_log.sql (PG17; reproduces the break first).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.approve_ownership_verification(uuid,uuid,text)'::regprocedure)
      IS DISTINCT FROM 'Gt2MtrKZrsxpIrWY/zpLSf6xg1loMZw3Dq00Ddnj6ks=' THEN
    RAISE EXCEPTION 'approve_ownership_verification differs from the reviewed definition';
  END IF;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.recompute_value_from_ov()'::regprocedure)
      IS DISTINCT FROM '9m0uYoVoiPiC+izrwDMJGdKt667X4aiVQgcejiPc/h4=' THEN
    RAISE EXCEPTION 'recompute_value_from_ov differs from the reviewed definition';
  END IF;
  IF to_regclass('public.verification_audit_log') IS NOT NULL THEN
    RAISE EXCEPTION 'verification_audit_log already exists';
  END IF;
END $guard$;

CREATE TABLE public.verification_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid REFERENCES public.ownership_verifications(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('submitted', 'document_uploaded', 'ai_processing_started', 'ai_processing_completed',
    'human_review_assigned', 'human_review_completed', 'approved', 'rejected', 'document_accessed', 'document_deleted',
    'escalated_to_supervisor')),
  actor_id uuid REFERENCES auth.users(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'reviewer', 'supervisor', 'admin')),
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_audit_log_verification ON public.verification_audit_log (verification_id, created_at);
ALTER TABLE public.verification_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.verification_audit_log TO service_role;
COMMENT ON TABLE public.verification_audit_log IS
  'Append-only review log of ownership_verifications decisions (approve_ownership_verification, admin_reject_ownership_verification). Service-only.';

CREATE FUNCTION public.verification_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'verification_audit_log is append-only';
END $$;
CREATE TRIGGER verification_audit_log_append_only BEFORE UPDATE OR DELETE ON public.verification_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.verification_audit_log_append_only();

CREATE OR REPLACE FUNCTION public.approve_ownership_verification(p_verification_id uuid, p_reviewer_id uuid, p_review_notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  verification_record ownership_verifications%ROWTYPE;
BEGIN
  -- Get verification record
  SELECT * INTO verification_record
  FROM ownership_verifications
  WHERE id = p_verification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  -- Update verification status only - DO NOT modify vehicles table
  UPDATE ownership_verifications
  SET
    status = 'approved',
    human_reviewer_id = p_reviewer_id,
    human_review_notes = p_review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_verification_id;

  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    p_verification_id, 'approved', p_reviewer_id, 'reviewer',
    jsonb_build_object('review_notes', p_review_notes)
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_value_from_ov()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (TG_OP = 'INSERT' and NEW.status = 'approved') or (TG_OP = 'DELETE' and OLD.status = 'approved')
     or (TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status and 'approved' in (OLD.status, NEW.status)) then
    perform public.compute_vehicle_value(coalesce(NEW.vehicle_id, OLD.vehicle_id));
  end if;
  return coalesce(NEW, OLD);
end $function$;
REVOKE ALL ON FUNCTION public.recompute_value_from_ov() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
