-- Receipt, reading and claim qualification have different evidence.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='5s';
-- These are the current owner definitions inspected live on 2026-10-30.
-- Refuse to overwrite a concurrent change rather than reconstructing its policy.
DO $owners$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.contributor_intake_after_input(public.vehicle_contributor_invites,text,uuid,text,text)','AsODEuxMbzMtF+REQ8/b62NpeJ0Hdl87VtKUNHkBFR0='),
  ('public.contributor_intake_progress_for(uuid)','94zRsrVZ5zQTmoFrDP3nIdeo3zSBYYyGr+vC4Dk4M7k='),
  ('public.contributor_intake_file(text,jsonb)','rzoa9sQvTUECqb7lkuRU8yOsg6014UKk7L9TQAPMGNw='),
  ('public.claim_contributor_intake_reevaluation(integer)','KRI7hImGcgZRBpHP6DMydGWVbz86Ceab93xipclZ/rM='),
  ('public.finish_contributor_intake_reevaluation(uuid,boolean,jsonb)','2cHEoObBCliES0lWbsPGjfl8E5jmgWIw7wf57XsCkOo=')
 ) f(signature,fingerprint) LOOP
  IF encode(sha256(convert_to(pg_get_functiondef(r.signature::regprocedure),'UTF8')),'base64') IS DISTINCT FROM r.fingerprint THEN
   RAISE EXCEPTION 'Contributor owner changed: %; review before migration',r.signature;
  END IF;
 END LOOP;
END $owners$;
ALTER TABLE public.vehicle_evidence_items
  ADD COLUMN IF NOT EXISTS received_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_received_ref uuid,
  ADD COLUMN IF NOT EXISTS last_received_kind text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_read_status text NOT NULL DEFAULT 'pending'
    CHECK(source_read_status IN ('pending','read','failed')),
  ADD COLUMN IF NOT EXISTS assessment_status text NOT NULL DEFAULT 'unresolved'
    CHECK(assessment_status IN ('supported','contradicted','unresolved')),
  ADD COLUMN IF NOT EXISTS acceptance_rule jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(acceptance_rule)='object'),
  ADD COLUMN IF NOT EXISTS assessment jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(assessment)='object');

ALTER TABLE public.vehicle_evidence_changes
  ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'claim_status_changed'
    CHECK(event_kind IN ('input_received','source_read','claim_assessed','claim_status_changed')),
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_ref uuid,
  ADD COLUMN IF NOT EXISTS review_revision bigint;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_evidence_input_receipt_uniq
 ON public.vehicle_evidence_changes(vehicle_id,item_key,source_kind,source_ref,invite_id)
 WHERE event_kind='input_received';
ALTER TABLE public.contributor_intake_reevaluations
 ADD COLUMN IF NOT EXISTS request_revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS completed_revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS claimed_revision bigint,
 ADD COLUMN IF NOT EXISTS worker_id text,
 ADD COLUMN IF NOT EXISTS lease_token uuid,
 ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS last_error text,
 ADD COLUMN IF NOT EXISTS compute_authority jsonb,
 ADD COLUMN IF NOT EXISTS completed_lease_token uuid;
CREATE INDEX IF NOT EXISTS contributor_review_pending_revision_idx
 ON public.contributor_intake_reevaluations(next_attempt_at,created_at,id)
 WHERE request_revision>completed_revision AND status IN ('queued','claimed','failed');

CREATE OR REPLACE FUNCTION public.contributor_intake_after_input(p_invite public.vehicle_contributor_invites,
  p_action text,p_ref uuid,p_question_key text,p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE it public.vehicle_evidence_items; v_work uuid; v_progress jsonb; v_new boolean;
  v_receipt uuid; v_revision bigint; v_count integer:=0;
  v_owner uuid; v_name text; v_match text:=lower(btrim(coalesce(p_question_key,p_label,'')));
BEGIN
  IF p_ref IS NULL OR p_invite.id IS NULL OR p_action NOT IN ('answer','upload') THEN
    RAISE EXCEPTION 'invalid contributor input';
  END IF;
  -- This receipt is part of admission, not an optional HTTP wake. A replay
  -- cannot count the same answer/file twice or create duplicate testimony.
  INSERT INTO public.contributor_intake_reevaluations(vehicle_id,invite_id,observation_id,image_id)
  VALUES(p_invite.vehicle_id,p_invite.id,CASE WHEN p_action='answer' THEN p_ref END,
    CASE WHEN p_action='upload' THEN p_ref END)
  ON CONFLICT DO NOTHING RETURNING id INTO v_work;
  v_new:=v_work IS NOT NULL;
  SELECT id,request_revision+1 INTO v_work,v_revision FROM public.contributor_intake_reevaluations
   WHERE vehicle_id=p_invite.vehicle_id AND (image_id=p_ref OR observation_id=p_ref) FOR UPDATE;
  IF v_work IS NULL THEN RAISE EXCEPTION 'contributor review source conflict'; END IF;
  FOR it IN SELECT * FROM public.vehicle_evidence_items
    WHERE vehicle_id=p_invite.vehicle_id AND v_match<>''
      AND (lower(coalesce(satisfied_by,''))=v_match OR key=v_match OR lower(label)=v_match)
    ORDER BY key FOR UPDATE
  LOOP
    INSERT INTO public.vehicle_evidence_changes(vehicle_id,item_key,from_status,to_status,
      event_kind,source_kind,source_ref,invite_id,review_revision,reasoning)
    VALUES(p_invite.vehicle_id,it.key,'not_received','received','input_received',
      CASE WHEN p_action='upload' THEN 'image' ELSE 'observation' END,p_ref,p_invite.id,v_revision,
      jsonb_build_object('rule','contributor_input_received_v1',
        'inputs',jsonb_build_object('action',p_action,'input_ref',p_ref,'review_id',v_work,
          'matched_label',v_match,'item_key',it.key),
        'result',jsonb_build_object('received',true,'claim_verified',false)))
    ON CONFLICT DO NOTHING RETURNING id INTO v_receipt;
    IF v_receipt IS NOT NULL THEN
      v_count:=v_count+1;
      UPDATE public.vehicle_evidence_items SET received_count=received_count+1,last_received_ref=p_ref,
        last_received_kind=CASE WHEN p_action='upload' THEN 'image' ELSE 'observation' END,
        source_read_status='pending',received_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=it.id;
    END IF;
  END LOOP;
  IF v_new OR v_count>0 THEN
    SELECT user_id INTO v_owner FROM public.vehicles WHERE id=p_invite.vehicle_id;
    UPDATE public.contributor_intake_reevaluations SET request_revision=v_revision,
      status=CASE WHEN status='claimed' THEN 'claimed' ELSE 'queued' END,
      next_attempt_at=clock_timestamp(),done_at=NULL,
      compute_authority=jsonb_build_object('user_id',v_owner,'mode','retained_readings_only',
        'platform_credential',false,'cost_cents',0) WHERE id=v_work;
  ELSE RETURN public.contributor_intake_progress_for(p_invite.vehicle_id);
  END IF;
  v_progress:=public.contributor_intake_progress_for(p_invite.vehicle_id);
  BEGIN
    SELECT v.user_id INTO v_owner FROM public.vehicles v WHERE v.id=p_invite.vehicle_id;
    SELECT e.display_name INTO v_name FROM public.contributors c
      JOIN public.external_identities e ON e.id=c.external_identity_id WHERE c.id=p_invite.contributor_id;
    IF v_owner IS NOT NULL THEN
      PERFORM public.create_notification(v_owner,'contributor_intake_progress',
        coalesce(v_name,'A contributor')||CASE WHEN p_action='upload' THEN ' sent a file' ELSE ' answered' END,
        'Received. The claim remains subject to its evidence checks.',p_invite.vehicle_id,NULL,
        jsonb_build_object('invite_id',p_invite.id,'action',p_action,'ref_id',p_ref,
          'review_id',v_work,'receipt_only',true,'action_url','/vehicle/'||p_invite.vehicle_id),1);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'Contributor receipt notification failed: %',SQLERRM;
  END;
  RETURN v_progress;
END $$;
-- This first registered acceptance rule establishes an identifier reading. It
-- cannot establish engine internals, originality, service history or a value
-- class. Other claims stay unresolved until their own rule is implemented.
CREATE OR REPLACE FUNCTION public.evaluate_contributor_evidence_item(p_item_id uuid,p_reading_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i public.vehicle_evidence_items; r public.image_observations; v public.vehicle_images;
  e jsonb; d jsonb; o jsonb; x jsonb; identifier text;
BEGIN
  SELECT * INTO i FROM public.vehicle_evidence_items WHERE id=p_item_id;
  IF i.id IS NULL THEN RETURN jsonb_build_object('verdict','unresolved','reason','item_unavailable','qualified',false); END IF;
  IF p_reading_id IS NOT NULL THEN
    SELECT * INTO r FROM public.image_observations WHERE id=p_reading_id AND is_active AND superseded_by IS NULL
      AND observed_by='visual_subject_reading_v1';
  END IF;
  IF i.acceptance_rule->>'kind' IS DISTINCT FROM 'native_vehicle_identifier_v1'
     OR i.key<>'shot_vin_plate' OR i.kind<>'photo' THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','acceptance_rule_unconfigured','qualified',false,
      'source_read',NULL);
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('verdict','unresolved','reason','qualified_source_read_required','qualified',false,'source_read',false); END IF;
  SELECT * INTO v FROM public.vehicle_images WHERE id=r.image_id AND vehicle_id=i.vehicle_id
    AND is_superseded IS NOT TRUE AND is_duplicate IS NOT TRUE AND is_document IS NOT TRUE
    AND doc_flag IS NOT TRUE AND is_sensitive IS NOT TRUE AND nullif(btrim(image_url),'') IS NOT NULL
    AND file_hash ~ '^[a-f0-9]{64}$'
    AND coalesce(vision_gate_status::text,'') NOT IN ('rejected_personal','rejected_misattributed');
  IF v.id IS NULL OR NOT EXISTS(SELECT FROM public.vehicle_evidence_changes c
    WHERE c.vehicle_id=i.vehicle_id AND c.item_key=i.key AND c.source_ref=v.id AND c.source_kind='image'
      AND c.event_kind='input_received') THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','source_unavailable_or_outside_receipt','qualified',false,'source_read',true);
  END IF;
  e:=r.confidence_basis#>'{visual_subject_reading_v1,envelope}';
  d:=coalesce(e->'device_source_context',e->'raw_model_reading');
  IF d->>'kind' IS DISTINCT FROM 'on_device_identity_context_v1'
     OR coalesce(d->>'identity_method_version','') !~ '^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$'
     OR e->>'user_id' IS DISTINCT FROM v.user_id::text THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','identity_method_or_owner_unqualified','qualified',false,'source_read',true);
  END IF;
  SELECT upper(btrim(vin)) INTO identifier FROM public.vehicles WHERE id=i.vehicle_id;
  SELECT value INTO x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e->'inputs')='array' THEN e->'inputs' ELSE '[]'::jsonb END)
    WHERE value->>'image_id'=v.id::text AND value->>'source_sha256'=v.file_hash
      AND value->>'input_sha256'=v.file_hash AND value->'source_qualified'='true'::jsonb LIMIT 1;
  SELECT value INTO o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'observations')='array' THEN d->'observations' ELSE '[]'::jsonb END)
    WHERE value->>'image_id'=v.id::text AND value->'is_document'='false'::jsonb
      AND jsonb_typeof(value->'vin_candidates')='array' AND value->'vin_candidates' ? identifier LIMIT 1;
  IF x IS NULL OR o IS NULL OR identifier IS NULL THEN
    RETURN jsonb_build_object('verdict','unresolved','reason','identifier_or_source_does_not_match','qualified',false,'source_read',true);
  END IF;
  RETURN jsonb_build_object('verdict','supported','qualified',true,'rule','native_vehicle_identifier_v1',
    'property','vehicle_identifier','value',identifier,'source_read',true,'reading_ref',r.id,
    'proof_kind','image','proof_ref',v.id,'source_sha256',v.file_hash,'method',d->>'identity_method_version',
    'read_at',r.observed_at,'observed_at',v.taken_at);
END $$;

-- Reads reevaluate the cited witness, so withdrawal, changed bytes or an
-- unrelated reading cannot leave a cached "proven" flag visible. Preserve the
-- original row and all earlier transitions; this is a current-state projection.
CREATE OR REPLACE FUNCTION public.contributor_evidence_items_for(p_vehicle_id uuid)
RETURNS SETOF public.vehicle_evidence_items LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE i public.vehicle_evidence_items; a jsonb; reading_id uuid;
BEGIN
  FOR i IN SELECT * FROM public.vehicle_evidence_items WHERE vehicle_id=p_vehicle_id ORDER BY position,key LOOP
    reading_id:=CASE WHEN pg_input_is_valid(i.assessment->>'reading_ref','uuid') THEN (i.assessment->>'reading_ref')::uuid END;
    a:=public.evaluate_contributor_evidence_item(i.id,reading_id);
    i.status:=CASE WHEN a->'qualified'='true'::jsonb AND a->>'verdict'='supported' THEN 'proven'
      WHEN a->'qualified'='true'::jsonb AND a->>'verdict'='contradicted' THEN 'contradicted' ELSE 'open' END;
    i.assessment_status:=CASE WHEN a->'qualified'='true'::jsonb THEN a->>'verdict' ELSE 'unresolved' END;
    IF a->'qualified'='true'::jsonb THEN
      i.proof_kind:=a->>'proof_kind'; i.proof_ref:=(a->>'proof_ref')::uuid;
    ELSE
      i.proof_kind:=NULL; i.proof_ref:=NULL;
    END IF;
    RETURN NEXT i;
  END LOOP;
END $$;

UPDATE public.vehicle_evidence_items SET acceptance_rule='{"kind":"native_vehicle_identifier_v1"}'::jsonb
 WHERE key='shot_vin_plate' AND kind='photo' AND acceptance_rule='{}'::jsonb;

-- Reuse a retained file without reassigning its photographer. The branch guard
-- preserves every other current intake/authentication check in the writer.
DO $duplicate_receipt$
DECLARE d text; old_branch text := $old$RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', true);$old$;
  new_branch text := $new$RETURN jsonb_build_object('ok', true, 'image_id', v_id, 'duplicate', true,
      'progress',public.contributor_intake_after_input(i,'upload',v_id,NULL,p_file->>'label'));$new$;
BEGIN
  d:=pg_get_functiondef('public.contributor_intake_file(text,jsonb)'::regprocedure);
  IF (length(d)-length(replace(d,old_branch,'')))/length(old_branch)<>1 THEN
    RAISE EXCEPTION 'Contributor file duplicate branch changed; review before patching';
  END IF;
  EXECUTE replace(d,old_branch,new_branch);
END $duplicate_receipt$;
REVOKE ALL ON FUNCTION public.evaluate_contributor_evidence_item(uuid,uuid),
  public.contributor_evidence_items_for(uuid),
  public.contributor_intake_after_input(public.vehicle_contributor_invites,text,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_contributor_evidence_item(uuid,uuid) TO service_role;
COMMENT ON COLUMN public.vehicle_evidence_items.received_count IS
  'Inputs routed to this item, not proof. Every input remains in the existing input/review and change records.';
COMMENT ON COLUMN public.vehicle_evidence_items.acceptance_rule IS
  'Versioned rule for this particular claim. An unconfigured rule cannot prove the claim; a label is only intake routing.';

-- The existing re-evaluation queue owns leases and the exact processed revision.
-- No legacy row is enrolled and no paid extraction is requested by this handler.
CREATE OR REPLACE FUNCTION public.claim_contributor_intake_reevaluation(
 p_worker text,p_limit integer DEFAULT 1,p_vehicle_id uuid DEFAULT NULL,p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;
BEGIN
 IF nullif(btrim(p_worker),'') IS NULL THEN RAISE EXCEPTION 'worker identity required'; END IF;
 WITH picked AS (
  SELECT id FROM public.contributor_intake_reevaluations q
  WHERE request_revision>completed_revision AND next_attempt_at<=clock_timestamp()
   AND (status IN ('queued','failed') OR (status='claimed' AND lease_expires_at<clock_timestamp()))
   AND (p_vehicle_id IS NULL OR vehicle_id=p_vehicle_id)
   AND (p_user_id IS NULL OR compute_authority->>'user_id'=p_user_id::text)
  ORDER BY next_attempt_at,created_at,id LIMIT greatest(0,least(coalesce(p_limit,1),10)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.contributor_intake_reevaluations q SET status='claimed',worker_id=p_worker,
   claimed_revision=request_revision,lease_token=gen_random_uuid(),
   claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1
  FROM picked WHERE q.id=picked.id RETURNING q.*)
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) INTO rows FROM claimed c;
 RETURN rows;
END $$;

CREATE OR REPLACE FUNCTION public.contributor_retained_reading_for(p_image_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.id FROM public.image_observations r JOIN public.vehicle_images v ON v.id=r.image_id
 CROSS JOIN LATERAL (SELECT r.confidence_basis#>'{visual_subject_reading_v1,envelope}' AS e) envelope
 CROSS JOIN LATERAL (SELECT coalesce(e->'device_source_context',e->'raw_model_reading') AS d) reading
 WHERE v.id=p_image_id AND r.is_active AND r.superseded_by IS NULL
  AND r.observed_by='visual_subject_reading_v1' AND v.user_id IS NOT NULL
  AND v.is_sensitive IS NOT TRUE AND v.is_superseded IS NOT TRUE AND v.is_duplicate IS NOT TRUE
  AND v.is_document IS NOT TRUE AND v.doc_flag IS NOT TRUE
  AND coalesce(v.vision_gate_status::text,'') NOT IN ('rejected_personal','rejected_misattributed')
  AND e->>'user_id'=v.user_id::text AND v.file_hash ~ '^[a-f0-9]{64}$'
  AND d->>'kind'='on_device_identity_context_v1'
  AND d->>'identity_method_version' ~ '^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$'
  AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e->'inputs')='array' THEN e->'inputs' ELSE '[]'::jsonb END) x
   WHERE x->>'image_id'=v.id::text AND x->>'source_sha256'=v.file_hash AND x->>'input_sha256'=v.file_hash
    AND x->'source_qualified'='true'::jsonb)
  AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'observations')='array' THEN d->'observations' ELSE '[]'::jsonb END) o
   WHERE o->>'image_id'=v.id::text AND o->'is_document'='false'::jsonb)
 ORDER BY r.observed_at DESC,r.id DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.finish_contributor_intake_reevaluation(
 p_id uuid,p_worker text,p_revision bigint,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.contributor_intake_reevaluations; i public.vehicle_evidence_items; a jsonb;
 old_a jsonb; reading_id uuid; owner_id uuid; source_read boolean; questions jsonb:='[]';
 question_key text; marker text:='contributor_evidence_review_v1'; v_status text; prior_status text;
 reviews jsonb:='[]'; question_status text; question_hint text;
 receipt_invite uuid;
BEGIN
 SELECT * INTO q FROM public.contributor_intake_reevaluations WHERE id=p_id FOR UPDATE;
 IF q.completed_revision=p_revision AND q.completed_lease_token=p_lease_token THEN
  RETURN jsonb_build_object('status','already_completed','revision',p_revision,'result',q.result);
 END IF;
 IF q.id IS NULL OR q.request_revision=0 OR q.status<>'claimed'
  OR q.lease_token IS NULL OR q.lease_expires_at IS NULL OR q.worker_id IS DISTINCT FROM p_worker
  OR q.claimed_revision IS DISTINCT FROM p_revision OR q.lease_token IS DISTINCT FROM p_lease_token
  OR q.lease_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','lease_lost'); END IF;
 SELECT user_id INTO owner_id FROM public.vehicles WHERE id=q.vehicle_id;
 IF owner_id IS NULL OR q.compute_authority->>'user_id' IS DISTINCT FROM owner_id::text
   OR q.compute_authority->>'mode' IS DISTINCT FROM 'retained_readings_only'
   OR q.compute_authority->'platform_credential' IS DISTINCT FROM 'false'::jsonb
   OR q.compute_authority->'cost_cents' IS DISTINCT FROM '0'::jsonb THEN
  UPDATE public.contributor_intake_reevaluations SET status='failed',last_error='compute_authority_unavailable',
   next_attempt_at=clock_timestamp()+interval '1 day',lease_expires_at=NULL WHERE id=q.id;
  RETURN jsonb_build_object('status','retry','reason','compute_authority_unavailable');
 END IF;
 IF q.image_id IS NOT NULL THEN
  reading_id:=public.contributor_retained_reading_for(q.image_id);
  source_read:=reading_id IS NOT NULL;
 ELSE
  SELECT EXISTS(SELECT FROM public.vehicle_observations o WHERE o.id=q.observation_id
    AND o.vehicle_id=q.vehicle_id AND o.is_superseded IS NOT TRUE) INTO source_read;
 END IF;
 FOR i IN SELECT * FROM public.vehicle_evidence_items it WHERE it.vehicle_id=q.vehicle_id
  AND EXISTS(SELECT FROM public.vehicle_evidence_changes c WHERE c.vehicle_id=it.vehicle_id
   AND c.item_key=it.key AND c.event_kind='input_received'
   AND c.source_ref=coalesce(q.image_id,q.observation_id) AND c.review_revision<=p_revision)
  ORDER BY it.key FOR UPDATE
 LOOP
  SELECT c.invite_id INTO receipt_invite FROM public.vehicle_evidence_changes c
   WHERE c.vehicle_id=q.vehicle_id AND c.item_key=i.key AND c.event_kind='input_received'
    AND c.source_ref=coalesce(q.image_id,q.observation_id) AND c.review_revision<=p_revision
   ORDER BY c.review_revision DESC,c.changed_at DESC,c.id DESC LIMIT 1;
  a:=public.evaluate_contributor_evidence_item(i.id,reading_id);
  -- A later irrelevant input does not erase an earlier still-qualified witness.
  IF a->'qualified' IS DISTINCT FROM 'true'::jsonb AND pg_input_is_valid(i.assessment->>'reading_ref','uuid') THEN
   old_a:=public.evaluate_contributor_evidence_item(i.id,(i.assessment->>'reading_ref')::uuid);
   IF old_a->'qualified'='true'::jsonb THEN a:=old_a; END IF;
  END IF;
  prior_status:=CASE WHEN i.assessment->'qualified'='true'::jsonb THEN i.status ELSE 'open' END;
  v_status:=CASE WHEN a->'qualified'='true'::jsonb AND a->>'verdict'='supported' THEN 'proven'
    WHEN a->'qualified'='true'::jsonb AND a->>'verdict'='contradicted' THEN 'contradicted' ELSE 'open' END;
  UPDATE public.vehicle_evidence_items SET status=v_status,assessment=a,
   assessment_status=CASE WHEN a->'qualified'='true'::jsonb THEN a->>'verdict' ELSE 'unresolved' END,
   source_read_status=CASE WHEN last_received_ref=coalesce(q.image_id,q.observation_id)
     THEN CASE WHEN source_read THEN 'read' ELSE 'pending' END ELSE source_read_status END,
   proof_kind=CASE WHEN a->'qualified'='true'::jsonb THEN a->>'proof_kind' END,
   proof_ref=CASE WHEN a->'qualified'='true'::jsonb THEN (a->>'proof_ref')::uuid END,
   updated_at=clock_timestamp() WHERE id=i.id;
  INSERT INTO public.vehicle_evidence_changes(vehicle_id,item_key,from_status,to_status,event_kind,
   source_kind,source_ref,proof_kind,proof_ref,invite_id,review_revision,reasoning)
  VALUES(q.vehicle_id,i.key,prior_status,v_status,'claim_assessed',
   CASE WHEN q.image_id IS NOT NULL THEN 'image' ELSE 'observation' END,coalesce(q.image_id,q.observation_id),
   CASE WHEN a->'qualified'='true'::jsonb THEN a->>'proof_kind' END,
   CASE WHEN a->'qualified'='true'::jsonb THEN (a->>'proof_ref')::uuid END,receipt_invite,p_revision,
   jsonb_build_object('rule',marker,'review_id',q.id,'revision',p_revision,'source_read',source_read,'result',a));
  reviews:=reviews||jsonb_build_array(jsonb_build_object('item_key',i.key,'assessment',a,'source_read',source_read));
  question_key:='review_'||substr(md5(i.key),1,16);
  -- Do not overwrite an owner's question. Only this handler's own stable key
  -- and marked hint can be refined, through the existing question writer.
 IF NOT EXISTS(SELECT FROM public.contributor_intake_questions cq WHERE cq.vehicle_id=q.vehicle_id
    AND cq.key=question_key AND (cq.created_by IS DISTINCT FROM owner_id OR coalesce(cq.hint,'') NOT LIKE marker||':%')) THEN
   question_status:=CASE WHEN v_status='proven' THEN 'closed' ELSE 'open' END;
   question_hint:=marker||':'||coalesce(a->>'reason',a->>'rule','unresolved');
   IF source_read OR EXISTS(SELECT FROM public.contributor_intake_questions cq
     WHERE cq.vehicle_id=q.vehicle_id AND cq.key=question_key) THEN
    questions:=questions||jsonb_build_array(jsonb_build_object('key',question_key,'invite_id',receipt_invite,
     'prompt','Which dated document or directly observed detail supports '||i.label||'? Include who observed it and when.',
     'hint',question_hint,'round',2,'position',i.position,'status',question_status));
   END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(questions)>0 THEN
  PERFORM public.set_contributor_intake_questions(q.vehicle_id,questions,owner_id);
 END IF;
 UPDATE public.contributor_intake_reevaluations SET completed_revision=p_revision,completed_lease_token=p_lease_token,
  status=CASE WHEN request_revision>p_revision THEN 'queued' ELSE 'done' END,
  result=jsonb_build_object('method',marker,'revision',p_revision,'reviews',reviews,
   'source_read',source_read,'reading_ref',reading_id,'compute_authority',compute_authority),
  done_at=clock_timestamp(),lease_expires_at=NULL,last_error=NULL,next_attempt_at=clock_timestamp()
 WHERE id=q.id RETURNING * INTO q;
 RETURN jsonb_build_object('status',q.status,'revision',p_revision,'result',q.result);
END $$;

CREATE OR REPLACE FUNCTION public.retry_contributor_intake_reevaluation(
 p_id uuid,p_worker text,p_revision bigint,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE changed uuid;
BEGIN
 UPDATE public.contributor_intake_reevaluations SET status='failed',lease_expires_at=NULL,
  last_error='retained_review_interrupted',next_attempt_at=clock_timestamp()+
   make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer)
 WHERE id=p_id AND status='claimed' AND worker_id=p_worker AND claimed_revision=p_revision
  AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() RETURNING id INTO changed;
 RETURN jsonb_build_object('status',CASE WHEN changed IS NULL THEN 'lease_lost' ELSE 'retry' END);
END $$;

-- Old unfenced completion is never a compatibility write path.
CREATE OR REPLACE FUNCTION public.claim_contributor_intake_reevaluation(p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'worker identity required; use leased contributor review'; END $$;
CREATE OR REPLACE FUNCTION public.finish_contributor_intake_reevaluation(p_id uuid,p_ok boolean,p_result jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'revision and lease token required; use leased contributor review'; END $$;

-- A new retained reading wakes the same physical-source row. Completed extraction
-- is reused; it does not create a second input or anonymous testimony.
CREATE OR REPLACE FUNCTION public.wake_contributor_review_after_reading()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.observed_by='visual_subject_reading_v1' THEN
  UPDATE public.contributor_intake_reevaluations SET request_revision=request_revision+1,
   status=CASE WHEN status='claimed' THEN 'claimed' ELSE 'queued' END,
   next_attempt_at=clock_timestamp(),done_at=NULL WHERE image_id=NEW.image_id AND request_revision>0;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_contributor_retained_reading AFTER INSERT OR UPDATE OF is_active,superseded_by
 ON public.image_observations FOR EACH ROW EXECUTE FUNCTION public.wake_contributor_review_after_reading();
CREATE OR REPLACE FUNCTION public.wake_contributor_review_after_answer_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF ROW(NEW.is_superseded,NEW.superseded_by) IS DISTINCT FROM ROW(OLD.is_superseded,OLD.superseded_by) THEN
  UPDATE public.contributor_intake_reevaluations SET request_revision=request_revision+1,
   status=CASE WHEN status='claimed' THEN 'claimed' ELSE 'queued' END,
   next_attempt_at=clock_timestamp(),done_at=NULL WHERE observation_id=NEW.id AND request_revision>0;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_contributor_answer_correction AFTER UPDATE OF is_superseded,superseded_by
 ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.wake_contributor_review_after_answer_change();
REVOKE ALL ON FUNCTION public.claim_contributor_intake_reevaluation(text,integer,uuid,uuid),
 public.contributor_retained_reading_for(uuid),
 public.finish_contributor_intake_reevaluation(uuid,text,bigint,uuid),
 public.retry_contributor_intake_reevaluation(uuid,text,bigint,uuid),
 public.wake_contributor_review_after_reading(),public.wake_contributor_review_after_answer_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contributor_intake_reevaluation(text,integer,uuid,uuid),
 public.finish_contributor_intake_reevaluation(uuid,text,bigint,uuid),
 public.retry_contributor_intake_reevaluation(uuid,text,bigint,uuid) TO service_role;

-- Register the retained-source handler with the existing dispatcher. Its source
-- is the already-owned contributor_link source, not a new testimony channel.
DO $registry$
BEGIN
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE slug='contributor_link') THEN
  RAISE EXCEPTION 'existing contributor_link source required'; END IF;
 IF EXISTS(SELECT FROM public.observation_extractors WHERE slug='contributor-evidence-review-v1'
  AND (edge_function_name IS DISTINCT FROM 'contributor-intake'
   OR extractor_config->>'action' IS DISTINCT FROM 'retained_review')) THEN
  RAISE EXCEPTION 'contributor review registry owner collision'; END IF;
 INSERT INTO public.observation_extractors(source_id,slug,display_name,extractor_type,
  edge_function_name,extractor_config,produces_kinds,is_active,schedule_type)
 SELECT id,'contributor-evidence-review-v1','Contributor retained evidence review','rule_based',
  'contributor-intake','{"action":"retained_review","method":"contributor_evidence_review_v1","paid_extraction":false}'::jsonb,
  '{}'::public.observation_kind[],true,'on_demand' FROM public.observation_sources WHERE slug='contributor_link'
 ON CONFLICT(slug) DO NOTHING;
END $registry$;
DO $describe$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('vehicle_evidence_items','last_received_ref','Most recently offered image/observation id. Receipt routing only; no evidentiary verdict.'),
  ('vehicle_evidence_items','last_received_kind','Species of last_received_ref: image or observation.'),
  ('vehicle_evidence_items','received_at','Receipt clock of the latest distinct input context, timestamptz; not the photographed event time.'),
  ('vehicle_evidence_items','source_read_status','Latest offered source: pending/read/failed. Separate from whether the claim is supported.'),
  ('vehicle_evidence_items','assessment_status','Claim verdict supported/contradicted/unresolved; the reader revalidates its cited witness.'),
  ('vehicle_evidence_items','assessment','Versioned evidence-rule result including method, source hash, reading and proof references; never a trusted passed flag.'),
  ('vehicle_evidence_changes','event_kind','Receipt, reading or claim event species. An input_received transition cannot be interpreted as proven.'),
  ('vehicle_evidence_changes','source_kind','Species of the offered input; distinct from the proof pointer.'),
  ('vehicle_evidence_changes','source_ref','Offered source id. An input reference establishes receipt only.'),
  ('vehicle_evidence_changes','review_revision','Requested/processed revision of the existing physical-source re-evaluation row.'),
  ('contributor_intake_reevaluations','request_revision','Monotone requested review revision; zero preserves unenrolled historical work.'),
  ('contributor_intake_reevaluations','completed_revision','Specific review revision atomically acknowledged with its assessments and questions.'),
  ('contributor_intake_reevaluations','claimed_revision','Immutable requested revision snapshotted by the current lease.'),
  ('contributor_intake_reevaluations','worker_id','Current lease owner; a worker name alone cannot acknowledge work.'),
  ('contributor_intake_reevaluations','lease_token','Unique nonce per claim, checked on review publication, retry and completion.'),
  ('contributor_intake_reevaluations','lease_expires_at','Database-clock expiry, 90 seconds after claim; expired leases may be recovered.'),
  ('contributor_intake_reevaluations','next_attempt_at','Earliest database-clock claim time, including bounded retry backoff.'),
  ('contributor_intake_reevaluations','attempts','Number of leased attempts; source reading/extraction is reused, not charged again.'),
  ('contributor_intake_reevaluations','last_error','Bounded operational failure code. Failure retains requested work.'),
  ('contributor_intake_reevaluations','compute_authority','Owner identity and retained_readings_only zero-cost scope retained with admission. No paid/platform escalation.'),
  ('contributor_intake_reevaluations','completed_lease_token','Nonce of the last atomic completion, for idempotent acknowledgement.')
 ) d(tbl,col,description) LOOP
  EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L',r.tbl,r.col,r.description);
 END LOOP;
END $describe$;
CREATE OR REPLACE FUNCTION public.contributor_intake_progress_for(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proven text[];
  v_items public.vehicle_evidence_items[];
  v_rungs jsonb;
  v_current jsonb;
  v_next jsonb;
  v_last jsonb;
  v_as_of timestamptz := now();
BEGIN
  SELECT array_agg(i) INTO v_items FROM public.contributor_evidence_items_for(p_vehicle_id) i;
  SELECT coalesce(array_agg(key), '{}') INTO v_proven FROM unnest(v_items)
   WHERE vehicle_id = p_vehicle_id AND status = 'proven';
  WITH r AS (
    SELECT g.*, ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) AS req,
           public.evidence_rung_band(p_vehicle_id, g.comps_spec, v_as_of) AS band
      FROM public.vehicle_evidence_rungs g WHERE g.vehicle_id = p_vehicle_id),
  s AS (
    SELECT r.*, (r.req <@ v_proven) AS reached,
           ARRAY(SELECT x FROM unnest(r.req) x WHERE NOT (x = ANY (v_proven))) AS missing
      FROM r),
  t AS (
    SELECT s.*, bool_and(s.reached) OVER (ORDER BY s.position ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS standing
      FROM s)
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'position', t.position, 'label', t.label,
           'band_low', t.band -> 'low', 'band_high', t.band -> 'high', 'band', t.band, 'basis', t.basis,
           'comps_spec', t.comps_spec, 'requirements', t.requirements, 'reached', t.reached, 'standing', t.standing,
           'missing', to_jsonb(t.missing)) ORDER BY t.position), '[]'::jsonb),
         (SELECT jsonb_build_object('key', x.key, 'position', x.position, 'label', x.label,
            'band_low', x.band -> 'low', 'band_high', x.band -> 'high', 'band', x.band, 'basis', x.basis)
            FROM t x WHERE x.standing ORDER BY x.position DESC LIMIT 1)
    INTO v_rungs, v_current
    FROM t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', n.key, 'label', n.label, 'kind', n.kind,
           'satisfied_by', n.satisfied_by, 'question_key', CASE WHEN n.kind = 'question' THEN n.satisfied_by END,
           'for_rung', n.for_rung)
           ORDER BY n.rung_position, n.position, n.key), '[]'::jsonb)
    INTO v_next
    FROM (
      SELECT d.* FROM (
        SELECT DISTINCT ON (it.key) it.key, it.label, it.kind, it.satisfied_by, it.position,
               g.key AS for_rung, g.position AS rung_position
          FROM unnest(v_items) it
          JOIN public.vehicle_evidence_rungs g ON g.vehicle_id = it.vehicle_id AND g.requirements ? it.key
         WHERE it.vehicle_id = p_vehicle_id AND it.status = 'open'
           AND NOT (ARRAY(SELECT x FROM jsonb_array_elements_text(g.requirements) x) <@ v_proven)
         ORDER BY it.key, g.position) d
       ORDER BY d.rung_position, d.position, d.key LIMIT 3) n;
  SELECT jsonb_build_object('at', c.changed_at, 'what', c.item_key, 'from_status', c.from_status, 'to_status', c.to_status,
           'moved_from', c.rung_from, 'moved_to', c.rung_to, 'proof_kind', c.proof_kind, 'proof_ref', c.proof_ref,
           'reasoning', c.reasoning,'event_kind',c.event_kind,'source_kind',c.source_kind,'source_ref',c.source_ref,
           'receipt_kind',c.reasoning#>>'{inputs,action}')
    INTO v_last
    FROM public.vehicle_evidence_changes c WHERE c.vehicle_id = p_vehicle_id AND c.reasoning->>'rule' IN ('contributor_input_received_v1','contributor_evidence_review_v1') ORDER BY c.changed_at DESC,c.id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'as_of', v_as_of,
    'rung', v_current,
    'rungs', v_rungs,
    'proven', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM unnest(v_items) i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'proven'),
    'open', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'note', i.note) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM unnest(v_items) i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'open'),
    'contradicted', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'kind', i.kind,
        'satisfied_by', i.satisfied_by, 'proof_kind', i.proof_kind, 'proof_ref', i.proof_ref, 'note', i.note,
        'updated_at', i.updated_at) ORDER BY i.position, i.key), '[]'::jsonb)
      FROM unnest(v_items) i WHERE i.vehicle_id = p_vehicle_id AND i.status = 'contradicted'),
    'counts', (SELECT jsonb_build_object('proven', count(*) FILTER (WHERE status = 'proven'),
        'open', count(*) FILTER (WHERE status = 'open'), 'contradicted', count(*) FILTER (WHERE status = 'contradicted'))
      FROM unnest(v_items) WHERE vehicle_id = p_vehicle_id),
    'next', v_next,
    'last_change', v_last,
    'received',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',i.key,'label',i.label,'kind',i.kind,
      'received_count',i.received_count,'received_at',i.received_at,'receipt_kind',i.last_received_kind,
      'source_read_status',i.source_read_status,'assessment_status',i.assessment_status)
      ORDER BY i.position,i.key),'[]'::jsonb) FROM unnest(v_items) i WHERE i.received_count>0));
END $$;
COMMIT;
