-- Provider issues a quote (Sign). A job is a quote: estimate -> quote (revisions) -> acceptance -> ...
-- issue_work_order_quote lets an authenticated provider put a priced quote version on a work order. Eligible:
-- an active owner of the work order's organization (business_ownership, the predicate work_order_is_accessible
-- uses), or an account whose evidenced identity bridge (viewer_identity_bridge: an approved account_link_claims
-- actor claim at work_evidence, co_sign or authenticated_sign; a self_claim is not enough) names the work order's
-- lead actor or an actor on one of its operations. The work order's customer cannot quote their own job.
-- It writes the same sanctioned server-side path as accept_work_order_quote: one owner-input work_record
-- (signer = auth.uid(), sign clock) whose quote envelope the projector validates and projects in the same
-- transaction (current scope snapshot, sequential version, currency with every amount). The quoting party is the
-- signer. A repeat of the same request returns the existing quote. No payment, deposit collection or messaging.
-- Contract: supabase/sql/test_work_order_quote_issue.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.issue_work_order_quote(p_work_order_id uuid, p_lines jsonb, p_deposit jsonb DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL, p_supersedes_quote_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  issued timestamptz := now();
  w public.work_orders%ROWTYPE;
  issuer_role text;
  owner_source uuid;
  request_key text;
  next_version integer;
  obs_id uuid;
  q public.work_order_quotes%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id;
  IF FOUND AND w.customer_id IS NOT DISTINCT FROM signer THEN
    RAISE EXCEPTION 'The customer cannot quote their own job' USING ERRCODE='42501';
  END IF;
  IF FOUND THEN
    issuer_role := CASE
      WHEN w.organization_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.business_ownership bo
        WHERE bo.business_id=w.organization_id AND bo.owner_id=signer AND bo.status='active') THEN 'organization_owner'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(public.viewer_identity_bridge(signer)->'evidenced_actor_ids') a
        WHERE a::uuid=w.lead_actor_id OR EXISTS (SELECT 1 FROM public.work_order_line_items li
          WHERE li.work_order_id=w.id AND li.actor_id=a::uuid)) THEN 'performer' END;
  END IF;
  IF issuer_role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for quoting' USING ERRCODE='42501'; END IF;
  IF w.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'A quote needs a vehicle-bound work order' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_quote:'||w.id::text,0));
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug='owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-quote-issue',signer,w.id,p_supersedes_quote_id,p_lines,p_deposit,
    p_valid_until)::text);
  SELECT x.* INTO q FROM public.work_order_quotes x JOIN public.vehicle_observations o ON o.id=x.id
    WHERE o.source_id=owner_source AND o.source_identifier='work_order_quote_issue:'||w.id::text
      AND o.content_hash=request_key AND o.is_superseded IS FALSE;
  IF FOUND THEN
    RETURN jsonb_build_object('quote_id',q.id,'version',q.version,'quote_hash',q.quote_hash,'work_order_id',w.id,
      'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind','user','id',signer),
      'issued_by_role',issuer_role,'duplicate',true,'payment_authorized',false,'customer_notified',false);
  END IF;
  SELECT COALESCE(max(version),0)+1 INTO next_version FROM public.work_order_quotes WHERE work_order_id=w.id;
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,source_identifier,observed_at,observed_at_basis,
    source_event_at,source_event_time_precision,kind,content_text,content_hash,structured_data,submitted_by_user_id,
    observer_raw,extraction_method,confidence,confidence_score)
  VALUES(w.vehicle_id,owner_source,'work_order_quote_issue:'||w.id::text,issued,'event_time',issued,'exact','work_record',
    format('Provider issued quote version %s for work order %s.',next_version,w.id),request_key,
    jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','quote','work_order_id',w.id,
      'quote_version',next_version,'supersedes_quote_id',p_supersedes_quote_id,
      'quoting_party',jsonb_build_object('kind','user','id',signer),
      'scope_snapshot',public.work_order_quote_scope_snapshot(w.id),'lines',p_lines,'deposit_requested',p_deposit,
      'valid_until',p_valid_until,'issued_by_role',issuer_role,
      'issuer_organization_id',CASE WHEN issuer_role='organization_owner' THEN w.organization_id END)),
    signer,jsonb_build_object('user_id',signer,'intake_actor','account','issued_by_role',issuer_role),
    'work_order_quote_issue_sign_v1','high',0.95)
  RETURNING id INTO obs_id;
  PERFORM public.project_work_order_resource_observation(obs_id);
  SELECT * INTO q FROM public.work_order_quotes WHERE id=obs_id;
  RETURN jsonb_build_object('quote_id',q.id,'version',q.version,'quote_hash',q.quote_hash,'work_order_id',w.id,
    'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind','user','id',signer),
    'issued_by_role',issuer_role,'issued_at',issued,'duplicate',false,'payment_authorized',false,'customer_notified',false);
END $$;
REVOKE ALL ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid) TO authenticated;
COMMENT ON FUNCTION public.issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid) IS 'Sign: an authenticated provider (active owner of the work order organization, or an evidenced actor bridge to its lead or an operation actor; never the customer) issues a quote version. Writes an owner-input work_record and its quote projection; quoting party = signer. Returns quote id, version and hash. No payment, deposit collection or messaging.';

UPDATE public.pipeline_registry SET write_via='project_work_order_resource_observation(uuid); issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)'
  WHERE table_name='work_order_quotes' AND column_name='id';
NOTIFY pgrst, 'reload schema';
COMMIT;
