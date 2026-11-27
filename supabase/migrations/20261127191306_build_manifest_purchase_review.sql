-- A reference invoice for another vehicle cannot establish this device's purchase.
-- Install a cited withdrawal writer, not a replacement purchase or device selection.
-- Existing owner-only evidence_sources keeps the before-image and original testimony.
-- No production rows are changed by this migration. Invoke the private writer only
-- after a sourced review lands through ingest-observation.
BEGIN;
SET LOCAL lock_timeout='2s';

ALTER TABLE public.vehicle_build_manifest
  ADD COLUMN purchase_review_observation_id uuid
  REFERENCES public.vehicle_observations(id),
  ADD CONSTRAINT build_manifest_withdrawn_purchase_unknown CHECK (
    purchase_review_observation_id IS NULL OR (
      purchased IS NULL AND status IS NOT DISTINCT FROM 'identified'
      AND evidence_level IS NOT DISTINCT FROM 'assumed'
    )
  );
CREATE INDEX build_manifest_purchase_review_observation_idx
  ON public.vehicle_build_manifest(purchase_review_observation_id)
  WHERE purchase_review_observation_id IS NOT NULL;
COMMENT ON COLUMN public.vehicle_build_manifest.purchase_review_observation_id IS
  'Current negative purchase-proof review, keyed to vehicle_observations. Set only by correct_build_manifest_purchase_evidence after same-vehicle source/hash validation. NULL purchase means unknown, not not-bought. Original evidence and before-image remain in owner-only evidence_sources; no installed identity or stock is established.';
COMMENT ON COLUMN public.vehicle_build_manifest.purchased IS
  'Legacy procurement assertion, not a stock or installation witness. true asserts purchased; false asserts not purchased; NULL means purchase unknown. A cited negative source review withdraws unsupported true to NULL and retains its before-image privately.';

CREATE FUNCTION public.correct_build_manifest_purchase_evidence(
  p_manifest_id uuid, p_expected_hash text, p_observation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE
  m public.vehicle_build_manifest;
  o public.vehicle_observations;
  snapshot_ jsonb;
  hash_ text;
  at_ timestamptz:=clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'purchase-proof withdrawal requires the private service writer' USING ERRCODE='42501';
  END IF;
  IF p_manifest_id IS NULL OR p_observation_id IS NULL
    OR p_expected_hash IS NULL OR p_expected_hash !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'exact manifest, review observation and expected-state hash required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO m FROM public.vehicle_build_manifest WHERE id=p_manifest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manifest device not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.vehicle_id IS DISTINCT FROM m.vehicle_id
    OR o.is_superseded IS DISTINCT FROM false OR o.superseded_by IS NOT NULL
    OR o.kind::text IS DISTINCT FROM 'expert_opinion'
    OR o.extraction_method IS DISTINCT FROM 'harness_source_model_review_v1'
    OR o.confidence_score IS NULL OR o.confidence_score>0.6
    OR (o.structured_data @> jsonb_build_object(
      'domain','wiring','report_kind','foreign_vehicle_purchase_evidence',
      'manifest_id',m.id,'is_inferred',true,'owner_confirmed',false,
      'reviewed_state_hash',p_expected_hash,'document_subject','other_vehicle'
    )) IS NOT TRUE
    OR (o.structured_data->>'source_document_sha256' ~ '^[0-9a-f]{64}$') IS NOT TRUE
    OR NOT EXISTS(SELECT 1 FROM public.observation_sources s
      WHERE s.id=o.source_id AND s.slug='agent-submission') THEN
    RAISE EXCEPTION 'live same-vehicle attributed foreign-invoice review required' USING ERRCODE='23514';
  END IF;
  IF m.purchase_review_observation_id=p_observation_id THEN
    RETURN jsonb_build_object('status','unchanged','manifest_id',m.id,
      'purchase_state','unknown','review_observation_id',o.id);
  END IF;
  snapshot_:=jsonb_build_object('id',m.id,'vehicle_id',m.vehicle_id,
    'purchased',m.purchased,'status',m.status,'evidence_level',m.evidence_level,
    'invoice_ref',m.invoice_ref,'evidence_sources',m.evidence_sources,'lifecycle_state',m.lifecycle_state,
    'actual_cost',m.actual_cost);
  hash_:=md5(snapshot_::text);
  IF hash_ IS DISTINCT FROM p_expected_hash THEN
    RAISE EXCEPTION 'manifest purchase evidence changed since its source review' USING ERRCODE='40001';
  END IF;
  IF m.purchase_review_observation_id IS NOT NULL OR m.purchased IS DISTINCT FROM true
    OR m.status IS DISTINCT FROM 'purchased' OR m.evidence_level IS DISTINCT FROM 'invoice_proven'
    OR m.lifecycle_state IS NOT NULL OR m.actual_cost IS NOT NULL
    OR m.invoice_ref IS NULL OR btrim(m.invoice_ref)=''
    OR jsonb_typeof(m.evidence_sources) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'only an unbuilt legacy invoice-only purchase claim can be withdrawn' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(m.evidence_sources)=0 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(m.evidence_sources) x
    WHERE (x->>'type'='invoice' AND x->>'ref'=m.invoice_ref) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'mixed, independent or unidentified source evidence requires separate review' USING ERRCODE='23514';
  END IF;
  UPDATE public.vehicle_build_manifest SET purchased=NULL,status='identified',evidence_level='assumed',
    purchase_review_observation_id=o.id,updated_at=at_,
    evidence_sources=m.evidence_sources || jsonb_build_array(jsonb_build_object(
      'type','purchase_provenance_withdrawal','review_observation_id',o.id,
      'method','foreign_vehicle_invoice_withdrawal_v1','recorded_at',at_,
      'actor','service_role:attributed_agent_review','purchase_state','unknown',
      'before',to_jsonb(m)))
  WHERE id=m.id;
  RETURN jsonb_build_object('status','withdrawn','manifest_id',m.id,
    'purchase_state','unknown','review_observation_id',o.id);
END $$;
REVOKE ALL ON FUNCTION public.correct_build_manifest_purchase_evidence(uuid,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.correct_build_manifest_purchase_evidence(uuid,text,uuid) TO service_role;
COMMENT ON FUNCTION public.correct_build_manifest_purchase_evidence(uuid,text,uuid) IS
  'Private sanctioned withdrawal of a legacy manifest purchase proof after a live same-vehicle agent review of a foreign-vehicle invoice. Expected-state CAS; unknown rather than false; immutable review FK and private before-image. Does not promote purchase, choose a device, move testimony, spend money or establish physical stock. Same observation is idempotent.';

CREATE FUNCTION public.guard_build_manifest_purchase_review()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE context_ text; lines_ text[]; frame_ text; protected_ text[]:=ARRAY[
  'id','vehicle_id','purchased','status','evidence_level','lifecycle_state',
  'actual_cost','evidence_sources','purchase_review_observation_id']; changed_ boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.purchase_review_observation_id IS NOT NULL THEN
      RAISE EXCEPTION 'reviewed manifest testimony must be retained' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    changed_:=NEW.purchase_review_observation_id IS NOT NULL;
  ELSE
    changed_:=(OLD.purchase_review_observation_id IS NOT NULL OR NEW.purchase_review_observation_id IS NOT NULL)
      AND EXISTS(SELECT 1 FROM unnest(protected_) k WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k);
  END IF;
  IF changed_ THEN
    GET DIAGNOSTICS context_=PG_CONTEXT;
    lines_:=string_to_array(rtrim(context_,chr(10)||chr(13)),chr(10));
    frame_:=lines_[cardinality(lines_)];
    -- Quoted SQL/comments can contain a forged frame; the final genuine frame
    -- must still be this registered postgres-owned top-level private writer.
    IF current_user<>'postgres' OR frame_ !~
      '^PL/pgSQL function (public\.)?correct_build_manifest_purchase_evidence\(uuid,text,uuid\) line [0-9]+ at SQL statement$'
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.correct_build_manifest_purchase_evidence(uuid,text,uuid)')
        AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND p.prosecdef
        AND p.prokind='f' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')) THEN
      RAISE EXCEPTION 'purchase review and its retained proof require the sanctioned writer' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_build_manifest_purchase_review() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.guard_build_manifest_purchase_review() IS
  'Always-on closure guard for manifest negative purchase reviews. Only the postgres-owned private writer may change reviewed procurement fields or audit; reviewed rows cannot be deleted. Ordinary unrelated device edits remain available. A superseding qualified positive-purchase path must be separately implemented before re-promotion.';
CREATE TRIGGER build_manifest_purchase_review_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.vehicle_build_manifest
  FOR EACH ROW EXECUTE FUNCTION public.guard_build_manifest_purchase_review();
ALTER TABLE public.vehicle_build_manifest ENABLE ALWAYS TRIGGER build_manifest_purchase_review_guard;
COMMIT;
