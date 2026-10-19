-- Actor-link review: evidence in the queue and an owner-agent approval for distinct claimants.
--
-- The owner (the only active admin) authorized agents to sign on his behalf on 2026-10-19 16:09Z, each signature registered
-- in owner_delegated_signs. Claims by other accounts need a reviewer who is an active admin other than the claimant; that
-- reviewer is the owner, so an agent can review on his behalf without any guard change:
--   approve_actor_link_claim_owner_agent(p_claim_id, p_evidence_ids uuid[], p_authorization_quote, p_agent_session):
--     service-only (EXECUTE + service_role JWT). Only claims whose claimant is not the owner and has signed in at least
--     once; every cited id must be an item actor_link_claim_evidence_read marks approvable for the claim, and at least one
--     cited item must be direct. The rung is the highest the cited items support (as approve_actor_link_claim_owner_delegated).
--     It registers the sign (rpc approve_actor_link_claim_owner_agent, result_ref = claim id) and appends the rung entry
--     with the owner as reviewer and a note naming the agent, the register row and the authorization; the existing guard
--     (distinct active admin, evidence rows exist and support the rung) checks it like any review.
--   actor_link_claims_review_queue(): each pending claim now carries its direct evidence items and an owner_agent_approval
--     block (eligible, reasons, the rpc and its arguments). Nothing is approved by reading the queue.
-- Contract: supabase/sql/test_actor_link_review_owner_agent.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.actor_link_claims_review_queue()'::regprocedure)
      IS DISTINCT FROM 'n0TtkSoGS/wCxqThBh2pJBslk1dMnfkLLFd/j+wBKDg=' THEN
    RAISE EXCEPTION 'actor_link_claims_review_queue differs from the reviewed definition';
  END IF;
END $guard$;

CREATE FUNCTION public.actor_link_owner_agent_eligibility(p_claim_id uuid, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c record;
  reasons text[] := '{}';
  direct_ids jsonb;
BEGIN
  SELECT cl.id, cl.user_id, cl.actor_id, cl.status INTO c FROM public.account_link_claims cl WHERE cl.id = p_claim_id AND cl.actor_id IS NOT NULL;
  IF c.id IS NULL THEN RETURN jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('claim_not_found')); END IF;
  IF c.user_id = public.owner_delegation_owner_id() THEN reasons := array_append(reasons, 'claimant_is_the_owner'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id AND u.last_sign_in_at IS NOT NULL) THEN
    reasons := array_append(reasons, 'claimant_never_signed_in');
  END IF;
  IF c.status NOT IN ('pending', 'approved') THEN reasons := array_append(reasons, 'claim_closed'); END IF;
  SELECT COALESCE(jsonb_agg(e->'row_id' ORDER BY e->>'date' DESC, e->>'row_id'), '[]'::jsonb) INTO direct_ids
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
    WHERE e->>'strength' = 'direct' AND jsonb_array_length(COALESCE(e->'approvable_for', '[]'::jsonb)) > 0;
  IF jsonb_array_length(direct_ids) = 0 THEN reasons := array_append(reasons, 'no_direct_evidence'); END IF;
  RETURN jsonb_build_object('eligible', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons),
    'rpc', 'approve_actor_link_claim_owner_agent',
    'args', jsonb_build_object('p_claim_id', c.id, 'p_evidence_ids', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT x FROM jsonb_array_elements(direct_ids) x LIMIT 50) q)),
    'reviewer', 'an agent on the owner''s behalf (registered in owner_delegated_signs)', 'automatic', false);
END $$;
REVOKE ALL ON FUNCTION public.actor_link_owner_agent_eligibility(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_link_owner_agent_eligibility(uuid, jsonb) TO service_role;

CREATE FUNCTION public.approve_actor_link_claim_owner_agent(p_claim_id uuid, p_evidence_ids uuid[],
  p_authorization_quote text, p_agent_session text DEFAULT 'agent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  ladder constant text[] := ARRAY['unknown','self_claim','work_evidence','co_sign','authenticated_sign'];
  owner_id constant uuid := public.owner_delegation_owner_id();
  c public.account_link_claims%ROWTYPE;
  clock timestamptz := clock_timestamp();
  items jsonb;
  elig jsonb;
  ev jsonb;
  n_cited integer := COALESCE(cardinality(p_evidence_ids), 0);
  n_matched integer;
  n_direct integer;
  has_signed boolean;
  has_work boolean;
  v_rung text;
  sign_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO c FROM public.account_link_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR c.actor_id IS NULL THEN RAISE EXCEPTION 'Actor claim not found'; END IF;
  IF NULLIF(btrim(p_authorization_quote), '') IS NULL THEN RAISE EXCEPTION 'Authorization quote required'; END IF;
  IF n_cited NOT BETWEEN 1 AND 50 OR n_cited <> (SELECT count(DISTINCT x) FROM unnest(p_evidence_ids) x) THEN
    RAISE EXCEPTION 'Cite 1 to 50 distinct evidence ids';
  END IF;
  items := public.actor_link_claim_evidence_read(p_claim_id)->'items';
  elig := public.actor_link_owner_agent_eligibility(p_claim_id, items);
  IF (elig->>'eligible')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Not eligible for an owner-agent review: %', elig->'reasons';
  END IF;

  SELECT count(m.item), count(m.item) FILTER (WHERE m.item->>'strength' = 'direct'),
    COALESCE(jsonb_agg(jsonb_build_object('kind', m.item->>'kind', 'id', m.item->>'row_id') ORDER BY u.ord) FILTER (WHERE m.item IS NOT NULL), '[]'::jsonb),
    COALESCE(bool_or(m.item->'approvable_for' ? 'authenticated_sign'
      AND NOT EXISTS (SELECT 1 FROM public.owner_delegated_signs d WHERE d.result_ref = m.item->>'row_id')), false),
    COALESCE(bool_or(m.item->'approvable_for' ? 'work_evidence'), false)
  INTO n_matched, n_direct, ev, has_signed, has_work
  FROM unnest(p_evidence_ids) WITH ORDINALITY u(id, ord)
  LEFT JOIN LATERAL (SELECT i AS item FROM jsonb_array_elements(items) i
    WHERE i->>'row_id' = u.id::text AND jsonb_array_length(COALESCE(i->'approvable_for', '[]'::jsonb)) > 0 LIMIT 1) m ON true;
  IF n_matched <> n_cited THEN
    RAISE EXCEPTION 'Every cited id must be evidence the finder marks approvable for this claim (% of % are)', n_matched, n_cited;
  END IF;
  IF n_direct = 0 THEN RAISE EXCEPTION 'At least one cited item must be direct evidence'; END IF;
  v_rung := CASE WHEN has_signed THEN 'authenticated_sign' WHEN has_work THEN 'work_evidence' END;
  IF v_rung IS NULL OR array_position(ladder, v_rung) <= COALESCE(array_position(ladder, c.verification_method), 0) THEN
    RAISE EXCEPTION 'The cited evidence supports no rung above %', c.verification_method;
  END IF;

  sign_id := public.owner_delegated_sign_record('approve_actor_link_claim_owner_agent',
    jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id, 'claimant_user_id', c.user_id, 'rung', v_rung,
      'previous_rung', c.verification_method, 'evidence', ev),
    c.id::text, p_authorization_quote, p_agent_session);
  UPDATE public.account_link_claims
    SET verification_method = v_rung, status = 'approved', reviewed_by_user_id = owner_id, reviewed_at = clock,
        rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung', v_rung, 'evidence', ev,
          'reviewer_user_id', owner_id, 'reviewed_at', clock,
          'note', 'reviewed by an agent on the owner''s behalf; owner_delegated_signs ' || sign_id::text
            || '; authorization 2026-10-19T16:09Z')),
        updated_at = clock
    WHERE id = p_claim_id;
  RETURN jsonb_build_object('claim_id', c.id, 'actor_id', c.actor_id, 'rung', v_rung, 'previous_rung', c.verification_method,
    'reviewed_at', clock, 'evidence_rows', jsonb_array_length(ev), 'direct_rows', n_direct,
    'reviewer', 'agent_on_behalf_of_owner', 'owner_delegated_sign_id', sign_id);
END $$;
REVOKE ALL ON FUNCTION public.approve_actor_link_claim_owner_agent(uuid, uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_actor_link_claim_owner_agent(uuid, uuid[], text, text) TO service_role;
COMMENT ON FUNCTION public.approve_actor_link_claim_owner_agent(uuid, uuid[], text, text) IS
  'Service-only. An agent reviews another account''s actor claim on the owner''s behalf: claimant signed in, cited finder evidence approvable with at least one direct item; registered in owner_delegated_signs.';

CREATE OR REPLACE FUNCTION public.actor_link_claims_review_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_service boolean := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  rows_out jsonb;
BEGIN
  IF NOT (is_service OR (uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active))) THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('claim_id', cl.id, 'actor', public.platform_actor_label(cl.actor_id),
      'claimant', public.platform_person_label(cl.user_id), 'claimant_user_id', cl.user_id, 'rung', cl.verification_method,
      'filed_at', cl.created_at, 'evidence_counts', ev->'counts',
      'direct_evidence', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', i->>'kind', 'row_id', i->'row_id', 'date', i->'date',
          'vehicle_label', i->'vehicle_label', 'why', i->'why', 'approvable_for', i->'approvable_for') ORDER BY i->>'date' DESC, i->>'row_id')
        FROM jsonb_array_elements(ev->'items') i WHERE i->>'strength' = 'direct'), '[]'::jsonb),
      'owner_agent_approval', public.actor_link_owner_agent_eligibility(cl.id, ev->'items'),
      'reviewer_must_differ_from_claimant', true,
      'reviewer_is_claimant', uid IS NOT NULL AND uid = cl.user_id) ORDER BY cl.created_at, cl.id), '[]'::jsonb)
    INTO rows_out
    FROM public.account_link_claims cl
    CROSS JOIN LATERAL (SELECT public.actor_link_claim_evidence_read(cl.id) AS ev) e
    WHERE cl.actor_id IS NOT NULL AND cl.status = 'pending';
  RETURN jsonb_build_object('as_of', statement_timestamp(), 'pending', rows_out,
    'coverage', jsonb_build_object('pending_actor_claims', jsonb_array_length(rows_out),
      'owner_agent_eligible', (SELECT count(*) FROM jsonb_array_elements(rows_out) r WHERE (r#>>'{owner_agent_approval,eligible}')::boolean)),
    'approval', jsonb_build_object('writer', 'approve_actor_link_claim', 'access', 'service role; reviewer must be an active admin other than the claimant',
      'owner_agent_writer', 'approve_actor_link_claim_owner_agent',
      'owner_agent_access', 'service role; claimant is not the owner and has signed in; at least one direct cited item; registered in owner_delegated_signs',
      'automatic', false));
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
