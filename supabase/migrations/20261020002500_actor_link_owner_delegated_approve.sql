-- Owner-delegated approval of the owner's own actor link claim.
--
-- Actor claims are promoted only by a distinct active admin (account_link_claims_actor_guard). The owner is the only
-- admin, and on 2026-10-19 16:09Z he authorized agents to sign on his behalf with every such signature registered
-- (20261020002000_owner_delegated_signs.sql). This adds one narrow path for his own claims and nobody else's:
--   approve_actor_link_claim_owner_delegated(p_claim_id, p_evidence_ids uuid[], p_authorization_quote, p_agent_session):
--     service-only (EXECUTE + service_role JWT). The claimant must be owner_delegation_owner_id(). Every cited id must be
--     an item actor_link_claim_evidence_read marks approvable for this claim; the rung is the highest those items support
--     (work_evidence from the claimant's work sessions; authenticated_sign only from his own submitted observations
--     that are not themselves delegated signs). It registers the delegated sign, then appends a rung entry naming the
--     owner as reviewer with reviewer 'agent_on_behalf_of_owner', the authorization quote and the register row id.
--   account_link_claims_actor_guard: unchanged except that a promotion may name the claimant as reviewer when the
--     entry carries a registered, unreversed, not-yet-used owner-delegated sign for this claim and the claimant is the
--     owner. Every other check (append-only history, rung rises, evidence rows exist and support the rung) still runs.
-- Contract: supabase/sql/test_actor_link_owner_delegated_approve.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.account_link_claims_actor_guard()'::regprocedure)
      IS DISTINCT FROM '0lmfYH+wvftnp0p91G+3B1E76B3lUvTdrSnYqMYQtm4=' THEN
    RAISE EXCEPTION 'account_link_claims_actor_guard differs from the reviewed definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.account_link_claims_actor_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      OR (entry - ARRAY['rung','evidence','reviewer_user_id','reviewed_at','note','reviewer','authorization_quote','owner_delegated_sign_id']) <> '{}'::jsonb
      OR entry->>'rung' IS DISTINCT FROM NEW.verification_method
      OR COALESCE(array_position(ladder, NEW.verification_method), 0) < 3
      OR array_position(ladder, NEW.verification_method) <= COALESCE(array_position(ladder, OLD.verification_method), 0) THEN
    RAISE EXCEPTION 'A promotion must raise the rung above self_claim and state it in its evidence entry';
  END IF;
  IF (entry->>'reviewer_user_id')::uuid IS DISTINCT FROM NEW.reviewed_by_user_id
      OR (entry->>'reviewed_at')::timestamptz IS DISTINCT FROM NEW.reviewed_at THEN
    RAISE EXCEPTION 'Reviewer and review clock must match the evidence entry';
  END IF;
  IF entry ? 'owner_delegated_sign_id' THEN
    IF NEW.reviewed_by_user_id IS DISTINCT FROM NEW.user_id
        OR NEW.user_id IS DISTINCT FROM public.owner_delegation_owner_id()
        OR entry->>'reviewer' IS DISTINCT FROM 'agent_on_behalf_of_owner'
        OR OLD.rung_evidence @> jsonb_build_array(jsonb_build_object('owner_delegated_sign_id', entry->'owner_delegated_sign_id'))
        OR NOT EXISTS (SELECT 1 FROM public.owner_delegated_signs d WHERE d.id = (entry->>'owner_delegated_sign_id')::uuid
          AND d.owner_user_id = NEW.user_id AND d.rpc = 'approve_actor_link_claim_owner_delegated' AND d.result_ref = NEW.id::text
          AND d.authorization_quote = entry->>'authorization_quote' AND NOT d.rolled_back)
        OR NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = NEW.reviewed_by_user_id AND au.is_active) THEN
      RAISE EXCEPTION 'An owner-delegated review needs the owner''s own claim and an unused registered delegated sign for it';
    END IF;
  ELSIF entry ?| ARRAY['reviewer','authorization_quote'] THEN
    RAISE EXCEPTION 'Delegation fields need a registered owner-delegated sign';
  ELSIF NEW.reviewed_by_user_id = NEW.user_id
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
END $function$;

CREATE FUNCTION public.approve_actor_link_claim_owner_delegated(p_claim_id uuid, p_evidence_ids uuid[],
  p_authorization_quote text, p_agent_session text DEFAULT 'agent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ladder constant text[] := ARRAY['unknown','self_claim','work_evidence','co_sign','authenticated_sign'];
  c public.account_link_claims%ROWTYPE;
  clock timestamptz := clock_timestamp();
  items jsonb;
  ev jsonb;
  n_cited integer := COALESCE(cardinality(p_evidence_ids), 0);
  n_matched integer;
  has_signed boolean;
  has_work boolean;
  v_rung text;
  sign_id uuid;
  entry jsonb;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO c FROM public.account_link_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR c.actor_id IS NULL THEN RAISE EXCEPTION 'Actor claim not found'; END IF;
  IF c.user_id IS DISTINCT FROM public.owner_delegation_owner_id() THEN
    RAISE EXCEPTION 'Only the owner''s own claim can be approved on his behalf';
  END IF;
  IF c.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Claim is closed'; END IF;
  IF NULLIF(btrim(p_authorization_quote), '') IS NULL THEN RAISE EXCEPTION 'Authorization quote required'; END IF;
  IF n_cited NOT BETWEEN 1 AND 50 OR n_cited <> (SELECT count(DISTINCT x) FROM unnest(p_evidence_ids) x) THEN
    RAISE EXCEPTION 'Cite 1 to 50 distinct evidence ids';
  END IF;

  items := public.actor_link_claim_evidence_read(p_claim_id)->'items';
  SELECT count(m.item),
    COALESCE(jsonb_agg(jsonb_build_object('kind', m.item->>'kind', 'id', m.item->>'row_id') ORDER BY u.ord) FILTER (WHERE m.item IS NOT NULL), '[]'::jsonb),
    COALESCE(bool_or(m.item->'approvable_for' ? 'authenticated_sign'
      AND NOT EXISTS (SELECT 1 FROM public.owner_delegated_signs d WHERE d.result_ref = m.item->>'row_id')), false),
    COALESCE(bool_or(m.item->'approvable_for' ? 'work_evidence'), false)
  INTO n_matched, ev, has_signed, has_work
  FROM unnest(p_evidence_ids) WITH ORDINALITY u(id, ord)
  LEFT JOIN LATERAL (SELECT i AS item FROM jsonb_array_elements(items) i
    WHERE i->>'row_id' = u.id::text AND jsonb_array_length(COALESCE(i->'approvable_for', '[]'::jsonb)) > 0 LIMIT 1) m ON true;
  IF n_matched <> n_cited THEN
    RAISE EXCEPTION 'Every cited id must be evidence the finder marks approvable for this claim (% of % are)', n_matched, n_cited;
  END IF;
  v_rung := CASE WHEN has_signed THEN 'authenticated_sign' WHEN has_work THEN 'work_evidence' END;
  IF v_rung IS NULL OR array_position(ladder, v_rung) <= COALESCE(array_position(ladder, c.verification_method), 0) THEN
    RAISE EXCEPTION 'The cited evidence supports no rung above %', c.verification_method;
  END IF;

  sign_id := public.owner_delegated_sign_record('approve_actor_link_claim_owner_delegated',
    jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id, 'rung', v_rung, 'previous_rung', c.verification_method, 'evidence', ev),
    c.id::text, p_authorization_quote, p_agent_session);
  entry := jsonb_build_object('rung', v_rung, 'evidence', ev, 'reviewer_user_id', c.user_id, 'reviewed_at', clock,
    'reviewer', 'agent_on_behalf_of_owner', 'authorization_quote', p_authorization_quote, 'owner_delegated_sign_id', sign_id);
  UPDATE public.account_link_claims
    SET verification_method = v_rung, status = 'approved', reviewed_by_user_id = c.user_id,
        reviewed_at = clock, rung_evidence = rung_evidence || jsonb_build_array(entry), updated_at = clock
    WHERE id = p_claim_id;
  RETURN jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id, 'rung', v_rung, 'previous_rung', c.verification_method,
    'reviewed_at', clock, 'evidence_rows', jsonb_array_length(ev), 'reviewer', 'agent_on_behalf_of_owner',
    'owner_delegated_sign_id', sign_id);
END $$;
REVOKE ALL ON FUNCTION public.approve_actor_link_claim_owner_delegated(uuid, uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_actor_link_claim_owner_delegated(uuid, uuid[], text, text) TO service_role;
COMMENT ON FUNCTION public.approve_actor_link_claim_owner_delegated(uuid, uuid[], text, text) IS
  'Service-only. Promotes the owner''s own actor claim on his behalf to the highest rung the cited finder evidence supports, registered in owner_delegated_signs.';

NOTIFY pgrst, 'reload schema';
COMMIT;
