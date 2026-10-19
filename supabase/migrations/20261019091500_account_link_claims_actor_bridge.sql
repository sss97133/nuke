-- Identity bridge: an account claims a canonical work actor through the existing claim owner, account_link_claims.
--
-- A claim names exactly one target: an external platform identity (platform + handle, resolved to
-- external_identity_id when known; the MCP link flow leaves it null until it resolves) or an actor
-- (platform 'nuke_actor', handle = actor id). Actor claims carry an evidence rung in verification_method:
--   unknown < self_claim < work_evidence < co_sign < authenticated_sign
-- A user inserts only a pending self_claim for themselves (existing alc_insert_own policy; users have no UPDATE
-- policy). Anything above self_claim is a reviewed promotion: approve_actor_link_claim (service-only) appends one
-- entry {rung, evidence[{kind,id}], reviewer_user_id, reviewed_at, note?} to rung_evidence. A guard trigger checks
-- every write, from any role: the history is append-only, the rung only rises, the reviewer is an active admin
-- other than the claimant, and every evidence row exists:
--   work_evidence      needs the claimant's own work_sessions row
--   co_sign            needs a current work_order_resource_attestations row not attributed to the claimant
--   authenticated_sign needs a current observation the claimant submitted, or a work session they confirmed
-- Nothing matches accounts to actors by name, phone or email; the reviewer judges the evidence, the database only
-- refuses promotions without it. External-identity claims, their view and approval path are unchanged except
-- that the external_identity_claims view no longer lists actor claims.
-- Contract: supabase/sql/test_account_link_claims_actor_bridge.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.account_link_claims'::regclass AND attname='actor_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'account_link_claims.actor_id already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_link_claims WHERE platform='nuke_actor') THEN
    RAISE EXCEPTION 'platform nuke_actor already in use';
  END IF;
END $guard$;

ALTER TABLE public.account_link_claims
  ADD COLUMN actor_id uuid REFERENCES public.actors(id) ON DELETE RESTRICT,
  ADD COLUMN rung_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT account_link_claims_one_target CHECK (
    (actor_id IS NULL AND platform <> 'nuke_actor') OR
    (actor_id IS NOT NULL AND external_identity_id IS NULL AND platform = 'nuke_actor' AND handle = actor_id::text)),
  ADD CONSTRAINT account_link_claims_actor_rung CHECK (
    actor_id IS NULL OR (
      verification_method IN ('unknown','self_claim','work_evidence','co_sign','authenticated_sign')
      AND status IN ('pending','approved','rejected','expired')
      AND (status <> 'approved' OR verification_method IN ('work_evidence','co_sign','authenticated_sign'))
      AND (verification_method IN ('unknown','self_claim') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)))),
  ADD CONSTRAINT account_link_claims_rung_evidence_array CHECK (
    jsonb_typeof(rung_evidence) = 'array' AND (actor_id IS NOT NULL OR rung_evidence = '[]'::jsonb));
CREATE INDEX account_link_claims_actor ON public.account_link_claims(actor_id) WHERE actor_id IS NOT NULL;
COMMENT ON COLUMN public.account_link_claims.actor_id IS 'Claimed canonical work actor (exclusive with an external identity target; platform nuke_actor, handle = actor id). A claim, not an identity match.';
COMMENT ON COLUMN public.account_link_claims.rung_evidence IS 'Append-only reviewed promotions of an actor claim: [{rung, evidence[{kind,id}], reviewer_user_id, reviewed_at, note?}]. Writer: approve_actor_link_claim.';

CREATE FUNCTION public.account_link_claims_actor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  ladder constant text[] := ARRAY['unknown','self_claim','work_evidence','co_sign','authenticated_sign'];
  entry jsonb;
  ev jsonb;
  all_exist boolean;
  n_own_sessions integer;
  n_other_attestations integer;
  n_signed integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NOT NULL AND (NEW.verification_method IS DISTINCT FROM 'self_claim'
        OR NEW.status IS DISTINCT FROM 'pending' OR NEW.reviewed_by_user_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
        OR NEW.rung_evidence <> '[]'::jsonb OR COALESCE(NEW.claim_confidence, 0) <> 0) THEN
      RAISE EXCEPTION 'An actor claim starts as a pending self_claim; promotion needs reviewed evidence';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.actor_id IS DISTINCT FROM NEW.actor_id THEN RAISE EXCEPTION 'Claim target is immutable'; END IF;
  IF NEW.actor_id IS NULL THEN RETURN NEW; END IF;
  IF (OLD.user_id, OLD.platform, OLD.handle, COALESCE(OLD.claim_confidence, 0))
      IS DISTINCT FROM (NEW.user_id, NEW.platform, NEW.handle, COALESCE(NEW.claim_confidence, 0)) THEN
    RAISE EXCEPTION 'Actor claim identity fields are immutable';
  END IF;
  IF NEW.rung_evidence = OLD.rung_evidence THEN
    IF (OLD.verification_method, OLD.reviewed_by_user_id, OLD.reviewed_at)
        IS DISTINCT FROM (NEW.verification_method, NEW.reviewed_by_user_id, NEW.reviewed_at) THEN
      RAISE EXCEPTION 'A rung changes only with an appended reviewed evidence entry';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('rejected','expired') THEN
      RAISE EXCEPTION 'An actor claim can only be closed (rejected or expired) without a promotion';
    END IF;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.rung_evidence) IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.rung_evidence) <> jsonb_array_length(OLD.rung_evidence) + 1
      OR (NEW.rung_evidence - (jsonb_array_length(NEW.rung_evidence) - 1)) <> OLD.rung_evidence THEN
    RAISE EXCEPTION 'Rung evidence is append-only, one entry per promotion';
  END IF;
  IF OLD.status NOT IN ('pending','approved') OR NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an open or approved claim can be promoted, and a promotion approves it';
  END IF;
  entry := NEW.rung_evidence -> -1;
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR (entry - ARRAY['rung','evidence','reviewer_user_id','reviewed_at','note']) <> '{}'::jsonb
      OR entry->>'rung' IS DISTINCT FROM NEW.verification_method
      OR COALESCE(array_position(ladder, NEW.verification_method), 0) < 3
      OR array_position(ladder, NEW.verification_method) <= COALESCE(array_position(ladder, OLD.verification_method), 0) THEN
    RAISE EXCEPTION 'A promotion must raise the rung above self_claim and state it in its evidence entry';
  END IF;
  IF (entry->>'reviewer_user_id')::uuid IS DISTINCT FROM NEW.reviewed_by_user_id
      OR (entry->>'reviewed_at')::timestamptz IS DISTINCT FROM NEW.reviewed_at THEN
    RAISE EXCEPTION 'Reviewer and review clock must match the evidence entry';
  END IF;
  IF NEW.reviewed_by_user_id = NEW.user_id
      OR NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = NEW.reviewed_by_user_id AND au.is_active) THEN
    RAISE EXCEPTION 'Reviewer must be an active admin other than the claimant';
  END IF;
  IF entry ? 'note' AND (jsonb_typeof(entry->'note') <> 'string' OR length(entry->>'note') > 2000) THEN
    RAISE EXCEPTION 'Review note must be text up to 2000 characters';
  END IF;
  ev := entry->'evidence';
  IF jsonb_typeof(ev) IS DISTINCT FROM 'array' OR jsonb_array_length(ev) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Evidence row ids required (1 to 50)';
  END IF;
  SELECT bool_and(jsonb_typeof(e) = 'object' AND (e - ARRAY['kind','id']) = '{}'::jsonb AND CASE e->>'kind'
        WHEN 'work_session' THEN EXISTS (SELECT 1 FROM public.work_sessions s
          WHERE s.id = (e->>'id')::uuid AND s.user_id = NEW.user_id)
        WHEN 'observation' THEN EXISTS (SELECT 1 FROM public.vehicle_observations o
          WHERE o.id = (e->>'id')::uuid AND o.is_superseded IS FALSE)
        WHEN 'attestation' THEN EXISTS (SELECT 1 FROM public.work_order_resource_attestations a
          JOIN public.vehicle_observations o ON o.id = a.id WHERE a.id = (e->>'id')::uuid AND o.is_superseded IS FALSE)
        ELSE false END),
      count(*) FILTER (WHERE e->>'kind' = 'work_session'),
      count(*) FILTER (WHERE e->>'kind' = 'attestation' AND EXISTS (SELECT 1 FROM public.work_order_resource_attestations a
        WHERE a.id = (e->>'id')::uuid AND a.attestor_user_id IS DISTINCT FROM NEW.user_id)),
      count(*) FILTER (WHERE (e->>'kind' = 'observation' AND EXISTS (SELECT 1 FROM public.vehicle_observations o
          WHERE o.id = (e->>'id')::uuid AND o.submitted_by_user_id = NEW.user_id))
        OR (e->>'kind' = 'work_session' AND EXISTS (SELECT 1 FROM public.work_sessions s
          WHERE s.id = (e->>'id')::uuid AND s.owner_confirmed_by = NEW.user_id AND s.owner_confirmed_at IS NOT NULL)))
    INTO all_exist, n_own_sessions, n_other_attestations, n_signed
    FROM jsonb_array_elements(ev) e;
  IF all_exist IS NOT TRUE THEN
    RAISE EXCEPTION 'Every evidence entry must be {kind,id} naming an existing current row (work_session of the claimant, observation, attestation)';
  END IF;
  IF (NEW.verification_method = 'work_evidence' AND n_own_sessions = 0)
      OR (NEW.verification_method = 'co_sign' AND n_other_attestations = 0)
      OR (NEW.verification_method = 'authenticated_sign' AND n_signed = 0) THEN
    RAISE EXCEPTION 'Evidence does not support rung %', NEW.verification_method;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.account_link_claims_actor_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER account_link_claims_actor_guard BEFORE INSERT OR UPDATE ON public.account_link_claims
  FOR EACH ROW EXECUTE FUNCTION public.account_link_claims_actor_guard();

CREATE FUNCTION public.approve_actor_link_claim(p_claim_id uuid, p_rung text, p_evidence jsonb,
  p_reviewer_user_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.account_link_claims%ROWTYPE;
  clock timestamptz := clock_timestamp();
  entry jsonb;
BEGIN
  SELECT * INTO c FROM public.account_link_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR c.actor_id IS NULL THEN RAISE EXCEPTION 'Actor claim not found'; END IF;
  IF p_reviewer_user_id IS NULL THEN RAISE EXCEPTION 'Reviewer required'; END IF;
  entry := jsonb_build_object('rung', p_rung, 'evidence', COALESCE(p_evidence, '[]'::jsonb),
    'reviewer_user_id', p_reviewer_user_id, 'reviewed_at', clock)
    || CASE WHEN p_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', p_note) END;
  UPDATE public.account_link_claims
    SET verification_method = p_rung, status = 'approved', reviewed_by_user_id = p_reviewer_user_id,
        reviewed_at = clock, rung_evidence = rung_evidence || jsonb_build_array(entry), updated_at = clock
    WHERE id = p_claim_id;
  RETURN jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id, 'rung', p_rung, 'previous_rung', c.verification_method,
    'reviewed_at', clock, 'evidence_rows', jsonb_array_length(entry->'evidence'));
END $$;
REVOKE ALL ON FUNCTION public.approve_actor_link_claim(uuid, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_actor_link_claim(uuid, text, jsonb, uuid, text) TO service_role;
COMMENT ON FUNCTION public.approve_actor_link_claim(uuid, text, jsonb, uuid, text) IS 'Service-only reviewed promotion of an actor claim above self_claim. Requires evidence row ids ([{kind: work_session|observation|attestation, id}]) and an active admin reviewer other than the claimant; appends to rung_evidence with the review clock. Never matches by name, phone or email.';

CREATE OR REPLACE VIEW public.external_identity_claims WITH (security_invoker = true) AS
  SELECT id, external_identity_id, user_id AS requested_by_user_id, proof_type, proof_url, notes, status,
    reviewed_by_user_id, reviewed_at, created_at, updated_at
  FROM public.account_link_claims
  WHERE actor_id IS NULL;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'account_link_claims', 'rung_evidence', 'approve_actor_link_claim',
  'Append-only reviewed actor-claim promotions with evidence row ids; guarded by account_link_claims_actor_guard.',
  true, 'approve_actor_link_claim(uuid,text,jsonb,uuid,text)'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name='account_link_claims' AND column_name='rung_evidence');
NOTIFY pgrst, 'reload schema';
COMMIT;
