-- HELD POLICY: purpose-specific native privacy testimony for own private subjects.
-- No public approval, global gate/status writes, grants, jobs, or device attestation.
-- Depends on the exact reviewed protected writer from PR2034; refuse drift.
SET statement_timeout = '10s';
SET lock_timeout = '2s';
BEGIN;
DO $guard$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure)
     IS DISTINCT FROM '84089637a85dd777940da3ec75bc22f1' THEN -- gitleaks:allow (public function-body fingerprint, not a credential)
    RAISE EXCEPTION 'private qualification requires reviewed protected writer; rebase and review drift';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.ingest_image_observation(
  p_image_id uuid, p_vehicle_id uuid, p_role text, p_confidence numeric,
  p_observed_by text, p_agent_version text,
  p_confidence_basis jsonb DEFAULT '{}'::jsonb,
  p_is_high_confidence_subject boolean DEFAULT NULL::boolean,
  p_layer_version jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '2s'
AS $function$
DECLARE
  v_existing image_observations%ROWTYPE;
  v_new_id uuid;
  v_visual boolean := coalesce(p_confidence_basis ? 'visual_subjects_v1', false);
  v_reading boolean := coalesce(p_confidence_basis ? 'visual_subject_reading_v1', false);
  v_privacy boolean := coalesce(p_confidence_basis ? 'device_privacy_v1', false);
  v_private_ok boolean;
  v_receipt public.vehicle_images%ROWTYPE;
  v_alias public.vehicle_images%ROWTYPE;
  v_audit public.reattribution_audit%ROWTYPE;
  v_family_ids uuid[];
  v_family_before uuid[];
  v_roots uuid[];
  v_chain_ids uuid[];
  v_audit_ids uuid[];
  v_family_root uuid;
  v_family_leaf uuid;
  v_cursor uuid;
  v_depth integer;
  v_audit_count integer;
  v_previous_audit_at timestamptz;
  v_source_family jsonb;
  v_source_roots uuid[] := '{}';
  v_known_ancestor_duplicate boolean;
  v_native jsonb;
  v_privacy_envelope jsonb;
  v_privacy_input jsonb;
  v_privacy_head image_observations%ROWTYPE;
  v_privacy_heads integer;
  v_protected boolean;
  v_namespace text;
  v_input_key text;
  v_wrapper jsonb;
  v_envelope jsonb;
  v_subject jsonb;
  v_input jsonb;
  v_cluster emergent_vehicle_clusters%ROWTYPE;
  v_cluster_id uuid;
  v_anchor uuid;
  v_user uuid;
  v_members uuid[];
  v_live vehicle_images%ROWTYPE;
  v_run text;
  v_state text;
  v_withdrawal_reason text;
  v_earliest timestamptz;
  v_latest timestamptz;
  v_member uuid;
  v_read_at timestamptz;
  v_frame jsonb;
  v_edge jsonb;
  v_box jsonb;
  v_feature_kinds text[];
  v_derivation jsonb;
  v_object_path text;
  c_origin CONSTANT text := 'https://qkgaybvrernstplzjaam.supabase.co';
BEGIN
  IF p_role NOT IN ('subject','incidental','part','vin') THEN
    RAISE EXCEPTION 'invalid role % (must be subject|incidental|part|vin)', p_role;
  END IF;
  IF p_confidence IS NULL OR p_confidence NOT BETWEEN 0 AND 1
     OR nullif(btrim(p_observed_by),'') IS NULL THEN
    RAISE EXCEPTION 'invalid observation confidence or producer';
  END IF;

  v_protected := v_visual OR v_reading OR v_privacy;
  IF v_visual::int + v_reading::int + v_privacy::int > 1 OR (p_observed_by IN ('visual_subjects_v1','visual_subject_reading_v1','device_privacy_v1') AND NOT v_protected) THEN
    RAISE EXCEPTION 'protected visual producer requires exactly its reserved namespace';
  END IF;
  IF v_protected THEN
    v_namespace := CASE WHEN v_privacy THEN 'device_privacy_v1' WHEN v_reading THEN 'visual_subject_reading_v1' ELSE 'visual_subjects_v1' END;
    v_wrapper := p_confidence_basis -> v_namespace;
    v_envelope := v_wrapper -> 'envelope';
    v_state := coalesce(v_wrapper ->> 'state','active');
    IF jsonb_typeof(v_wrapper) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_envelope) IS DISTINCT FROM 'object'
       OR octet_length(p_confidence_basis::text) > 262144
       OR v_state NOT IN ('active','withdrawn')
       OR p_observed_by <> v_namespace
       OR (v_reading AND (p_agent_version IS DISTINCT FROM 'visual_subject_reading_v1' OR p_role <> 'part'))
       OR p_vehicle_id IS NOT NULL OR p_role NOT IN ('subject','part')
       OR v_envelope ->> 'method' IS DISTINCT FROM (CASE WHEN v_privacy THEN 'device_privacy_v1' ELSE 'visual_subjects_v1' END)
       OR (v_privacy AND (p_agent_version IS DISTINCT FROM 'device_privacy_v1' OR p_role <> 'part' OR p_confidence <> 0
         OR v_envelope ->> 'purpose' IS DISTINCT FROM 'own_private_visual_subjects'))
       OR NOT coalesce(pg_input_is_valid(v_envelope ->> 'user_id','uuid'),false)
       OR (v_visual AND NOT coalesce(pg_input_is_valid(v_wrapper ->> 'anchor_image_id','uuid'),false))
       OR (NOT v_privacy AND (nullif(btrim(v_envelope ->> 'model'),'') IS NULL
         OR nullif(btrim(v_envelope ->> 'provider'),'') IS NULL))
       OR NOT coalesce(pg_input_is_valid(v_envelope ->> 'read_at','timestamptz'),false)
       OR nullif(btrim(p_agent_version),'') IS NULL THEN
      RAISE EXCEPTION 'invalid protected visual subject envelope';
    END IF;
    v_run := CASE WHEN v_privacy THEN md5((v_envelope -> 'native')::text) ELSE v_envelope ->> 'run_key' END;
    IF v_run IS NULL OR length(v_run) NOT BETWEEN 1 AND 128
       OR jsonb_typeof(v_envelope -> 'inputs') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_envelope -> 'subjects') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid visual subject scope';
    END IF;
    IF (v_visual AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 1 AND 14
       OR jsonb_array_length(v_envelope -> 'subjects') NOT BETWEEN 1 AND 14))
       OR (v_reading AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 2 AND 3
       OR jsonb_array_length(v_envelope -> 'subjects') > 3))
       OR (v_privacy AND (jsonb_array_length(v_envelope -> 'inputs') <> 1 OR jsonb_array_length(v_envelope -> 'subjects') <> 0)) THEN
      RAISE EXCEPTION 'visual subject scope exceeds its bounded producer';
    END IF;
    v_user := (v_envelope ->> 'user_id')::uuid;
    PERFORM pg_advisory_xact_lock(hashtextextended('visual_subjects_v1:source-account:' || v_user,0));
    v_read_at := (v_envelope ->> 'read_at')::timestamptz;
    IF NOT isfinite(v_read_at) OR v_read_at > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'invalid visual subject reading clock';
    END IF;
    IF v_privacy THEN
      IF v_wrapper ? 'anchor_image_id' OR v_wrapper ? 'cluster_id'
        OR v_envelope #>> '{inputs,0,image_id}' IS DISTINCT FROM p_image_id::text THEN
        RAISE EXCEPTION 'private privacy receipt cannot select a vehicle or subject';
      END IF;
      v_members := ARRAY[p_image_id];
    ELSIF v_reading THEN
      IF v_wrapper ? 'anchor_image_id' OR v_wrapper ? 'cluster_id'
         OR jsonb_typeof(v_envelope -> 'frames') IS DISTINCT FROM 'array'
         OR jsonb_typeof(v_envelope -> 'unresolved') IS DISTINCT FROM 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_envelope -> 'inputs') i
                    WHERE jsonb_typeof(i) <> 'object' OR NOT coalesce(pg_input_is_valid(i ->> 'image_id','uuid'),false)) THEN
        RAISE EXCEPTION 'reading-only visual receipt cannot select a physical subject';
      END IF;
      v_members := ARRAY(SELECT (i ->> 'image_id')::uuid FROM jsonb_array_elements(v_envelope -> 'inputs') i);
      IF cardinality(v_members) <> (SELECT count(DISTINCT x) FROM unnest(v_members) x)
         OR NOT (p_image_id = ANY(v_members)) THEN
        RAISE EXCEPTION 'reading-only inputs must be unique and include this image';
      END IF;
      -- One image can participate in several independent comparison contexts.
      -- Model/frame revisions supersede within their exact byte-input context;
      -- another peer set must not erase a still-usable paid reading.
      v_input_key := md5(v_namespace || ':' || v_user || ':' || (
        SELECT jsonb_agg(jsonb_build_array(i->>'image_id',i->>'source_sha256',i->>'input_sha256',i->>'representation')
                         ORDER BY i->>'image_id')::text
        FROM jsonb_array_elements(v_envelope -> 'inputs') i));
      IF v_wrapper ? 'input_key' AND v_wrapper ->> 'input_key' IS DISTINCT FROM v_input_key THEN
        RAISE EXCEPTION 'reading-only input key differs from its exact source context';
      END IF;
      p_confidence_basis := jsonb_set(p_confidence_basis,ARRAY[v_namespace,'input_key'],to_jsonb(v_input_key),true);
    ELSE
    v_anchor := (v_wrapper ->> 'anchor_image_id')::uuid;
    -- The anchor persists across later captures. run_key versions a reading;
    -- it must not mint another subject every time more photos arrive.
    v_cluster_id := md5('visual_subjects_v1:' || v_user || ':' || v_anchor)::uuid;
    IF v_wrapper ? 'cluster_id' AND (
       NOT coalesce(pg_input_is_valid(v_wrapper ->> 'cluster_id','uuid'),false)
       OR (v_wrapper ->> 'cluster_id')::uuid IS DISTINCT FROM v_cluster_id) THEN
      RAISE EXCEPTION 'visual subject cluster key differs from its producer scope';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(v_envelope -> 'subjects') s
        WHERE s ->> 'anchor_image_id' = v_anchor::text) <> 1 THEN
      RAISE EXCEPTION 'visual subject anchor must select exactly one subject';
    END IF;
    SELECT s INTO v_subject FROM jsonb_array_elements(v_envelope -> 'subjects') s
      WHERE s ->> 'anchor_image_id' = v_anchor::text;
    IF jsonb_typeof(v_subject -> 'member_image_ids') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_subject -> 'correspondences') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_subject -> 'contradictions') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'visual subject must retain membership and correspondence testimony';
    END IF;
    IF jsonb_array_length(v_subject -> 'member_image_ids') NOT BETWEEN 2 AND 14
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_subject -> 'member_image_ids') m
                  WHERE jsonb_typeof(m) <> 'string' OR NOT pg_input_is_valid(m #>> '{}','uuid')) THEN
      RAISE EXCEPTION 'invalid visual subject member ids';
    END IF;
    v_members := ARRAY(SELECT (m #>> '{}')::uuid FROM jsonb_array_elements(v_subject -> 'member_image_ids') m);
    IF cardinality(v_members) <> (SELECT count(DISTINCT x) FROM unnest(v_members) x)
       OR NOT (v_anchor = ANY(v_members)) OR NOT (p_image_id = ANY(v_members)) THEN
      RAISE EXCEPTION 'visual subject members must be unique and include this image and anchor';
    END IF;
    IF jsonb_typeof(v_envelope -> 'frames') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_subject -> 'contradictions') <> 0
       OR v_subject ->> 'physical_identity' IS DISTINCT FROM 'unresolved' THEN
      RAISE EXCEPTION 'visual subject must retain unresolved frame-qualified interpretation';
    END IF;
    FOREACH v_member IN ARRAY v_members LOOP
      IF (SELECT count(*) FROM jsonb_array_elements(v_envelope -> 'frames') f
          WHERE f ->> 'image_id' = v_member::text) <> 1 THEN
        RAISE EXCEPTION 'visual subject member requires exactly one primary frame';
      END IF;
      SELECT f INTO v_frame FROM jsonb_array_elements(v_envelope -> 'frames') f
        WHERE f ->> 'image_id' = v_member::text;
      v_box := v_frame -> 'bbox';
      IF v_frame ->> 'medium' IS DISTINCT FROM 'photograph'
         OR v_frame ->> 'primary_subject' IS DISTINCT FROM 'vehicle'
         OR (v_member = v_anchor AND v_frame ->> 'view' IS DISTINCT FROM 'exterior')
         OR jsonb_typeof(v_box) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'visual subject requires photographed primary car and exterior anchor';
      END IF;
      IF jsonb_array_length(v_box) <> 4 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_box) x WHERE jsonb_typeof(x) <> 'number'
      ) THEN RAISE EXCEPTION 'invalid primary subject locator'; END IF;
      IF (v_box->>0)::numeric < 0 OR (v_box->>1)::numeric < 0
         OR (v_box->>2)::numeric <= 0 OR (v_box->>3)::numeric <= 0
         OR (v_box->>0)::numeric + (v_box->>2)::numeric > 1.001
         OR (v_box->>1)::numeric + (v_box->>3)::numeric > 1.001 THEN
        RAISE EXCEPTION 'primary subject locator is outside the image';
      END IF;
    END LOOP;
    FOR v_edge IN SELECT e FROM jsonb_array_elements(v_subject -> 'correspondences') e LOOP
      IF NOT coalesce(pg_input_is_valid(v_edge ->> 'left_image_id','uuid'),false)
         OR NOT coalesce(pg_input_is_valid(v_edge ->> 'right_image_id','uuid'),false)
         OR NOT ((v_edge ->> 'left_image_id')::uuid = ANY(v_members))
         OR NOT ((v_edge ->> 'right_image_id')::uuid = ANY(v_members))
         OR v_edge ->> 'left_image_id' = v_edge ->> 'right_image_id'
         OR jsonb_typeof(v_edge -> 'features') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'visual subject has malformed correspondence endpoints';
      END IF;
      v_feature_kinds := ARRAY(SELECT DISTINCT f ->> 'kind' FROM jsonb_array_elements(v_edge -> 'features') f
        WHERE f ->> 'kind' IN ('identifier','body_geometry','fixed_wear','configuration')
          AND nullif(btrim(f ->> 'left_witness'),'') IS NOT NULL
          AND nullif(btrim(f ->> 'right_witness'),'') IS NOT NULL);
      IF cardinality(v_feature_kinds) < 2 OR NOT (v_feature_kinds && ARRAY['identifier','body_geometry']) THEN
        RAISE EXCEPTION 'visual subject correspondence lacks independent identifying witnesses';
      END IF;
    END LOOP;
    IF (WITH RECURSIVE reached(id) AS (
      SELECT v_anchor::text
      UNION
      SELECT CASE WHEN e ->> 'left_image_id' = r.id THEN e ->> 'right_image_id' ELSE e ->> 'left_image_id' END
      FROM reached r CROSS JOIN jsonb_array_elements(v_subject -> 'correspondences') e
      WHERE e ->> 'left_image_id' = r.id OR e ->> 'right_image_id' = r.id
    ) SELECT count(DISTINCT id) FROM reached) <> cardinality(v_members) THEN
      RAISE EXCEPTION 'visual subject correspondence graph is disconnected';
    END IF;
    IF jsonb_typeof(v_envelope -> 'contradictions') = 'array' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_envelope -> 'contradictions') c
      WHERE c ->> 'left_image_id' = ANY(ARRAY(SELECT x::text FROM unnest(v_members) x))
        AND c ->> 'right_image_id' = ANY(ARRAY(SELECT x::text FROM unnest(v_members) x))
    ) THEN RAISE EXCEPTION 'visual subject contains a retained contradiction'; END IF;
    -- A source cannot be two primary physical subjects in one model envelope.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_envelope -> 'subjects') s
               WHERE s ->> 'anchor_image_id' IS DISTINCT FROM v_anchor::text
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'member_image_ids') m
                             WHERE m #>> '{}' = ANY(ARRAY(SELECT x::text FROM unnest(v_members) x)))) THEN
      RAISE EXCEPTION 'visual subject membership overlaps another primary subject';
    END IF;
    END IF; -- Supported subject graph; reading-only receipts retain unknowns without admitting it.
    IF v_state = 'withdrawn' THEN
      v_withdrawal_reason := v_wrapper ->> 'withdrawal_reason';
      IF nullif(btrim(v_withdrawal_reason),'') IS NULL OR length(v_withdrawal_reason) > 1000 THEN
        RAISE EXCEPTION 'visual subject withdrawal requires its reason';
      END IF;
    END IF;
    -- Serialize both cluster creation and revisions. Lock source rows in stable
    -- order so qualification cannot race a concurrent source change in this call.
    IF v_visual THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('visual_subjects_v1:' || v_cluster_id,0));
    END IF;
    FOREACH v_member IN ARRAY (SELECT array_agg(x ORDER BY x) FROM unnest(v_members) x) LOOP
      -- Different proposed clusters may share a source. Serialize that check
      -- too, so concurrent producers cannot each see an unbound source.
      PERFORM pg_advisory_xact_lock(hashtextextended('visual_subjects_v1:member:' || v_member,0));
      IF (SELECT count(*) FROM jsonb_array_elements(v_envelope -> 'inputs') i
          WHERE i ->> 'image_id' = v_member::text) <> 1 THEN
        RAISE EXCEPTION 'visual subject member requires exactly one byte receipt';
      END IF;
      SELECT i INTO v_input FROM jsonb_array_elements(v_envelope -> 'inputs') i
       WHERE i ->> 'image_id' = v_member::text;
      v_family_ids := ARRAY[v_member];
      FOR v_depth IN 1..9 LOOP
        v_family_before := v_family_ids;
        SELECT array_agg(DISTINCT q.id ORDER BY q.id) INTO v_family_ids FROM (
          SELECT unnest(v_family_before) AS id
          UNION ALL SELECT i.superseded_by FROM public.vehicle_images i
            WHERE i.id=ANY(v_family_before) AND i.superseded_by IS NOT NULL
          UNION ALL SELECT a.old_observation_id FROM public.reattribution_audit a
            WHERE a.observation_type='image' AND a.old_observation_id<>a.new_observation_id
              AND (a.old_observation_id=ANY(v_family_before) OR a.new_observation_id=ANY(v_family_before))
          UNION ALL SELECT a.new_observation_id FROM public.reattribution_audit a
            WHERE a.observation_type='image' AND a.old_observation_id<>a.new_observation_id
              AND (a.old_observation_id=ANY(v_family_before) OR a.new_observation_id=ANY(v_family_before))
        ) q;
        IF cardinality(v_family_ids)>9 THEN RAISE EXCEPTION 'source lineage exceeds eight audited edges'; END IF;
        EXIT WHEN v_family_ids=v_family_before;
      END LOOP;
      IF v_family_ids IS DISTINCT FROM v_family_before THEN RAISE EXCEPTION 'source lineage lookup incomplete'; END IF;

      -- Foreign/missing rows cannot become aliases just because a pointer names them.
      IF (SELECT count(*) FROM public.vehicle_images i WHERE i.id=ANY(v_family_ids) AND i.user_id=v_user)
         <> cardinality(v_family_ids) THEN
        RAISE EXCEPTION 'source lineage unavailable for this account';
      END IF;
      PERFORM 1 FROM public.vehicle_images i WHERE i.id=ANY(v_family_ids) ORDER BY i.id FOR SHARE;
      -- Locks serialize source sensitivity/gate/attribution changes. Recheck the entire
      -- family after obtaining them; a prior unfile may have committed while we waited.
      IF EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id=ANY(v_family_ids)
                 AND i.superseded_by IS NOT NULL AND NOT(i.superseded_by=ANY(v_family_ids)))
         OR EXISTS (SELECT 1 FROM public.reattribution_audit a WHERE a.observation_type='image'
                    AND a.old_observation_id<>a.new_observation_id
                    AND ((a.old_observation_id=ANY(v_family_ids) AND NOT(a.new_observation_id=ANY(v_family_ids)))
                      OR (a.new_observation_id=ANY(v_family_ids) AND NOT(a.old_observation_id=ANY(v_family_ids))))) THEN
        RAISE EXCEPTION 'source lineage changed during qualification';
      END IF;
      IF EXISTS (SELECT 1 FROM public.reattribution_audit a WHERE a.observation_type='image'
                 AND a.old_observation_id<>a.new_observation_id AND a.old_observation_id=ANY(v_family_ids)
                 GROUP BY a.old_observation_id HAVING count(*)<>1)
         OR EXISTS (SELECT 1 FROM public.reattribution_audit a WHERE a.observation_type='image'
                 AND a.old_observation_id<>a.new_observation_id AND a.new_observation_id=ANY(v_family_ids)
                 GROUP BY a.new_observation_id HAVING count(*)<>1) THEN
        RAISE EXCEPTION 'source lineage fork requires explicit correction';
      END IF;
      SELECT array_agg(x.id ORDER BY x.id) INTO v_roots FROM unnest(v_family_ids) x(id)
       WHERE NOT EXISTS(SELECT 1 FROM public.reattribution_audit a WHERE a.observation_type='image'
         AND a.old_observation_id<>a.new_observation_id AND a.new_observation_id=x.id);
      IF coalesce(cardinality(v_roots),0)<>1 THEN RAISE EXCEPTION 'source lineage has no unique root'; END IF;
      v_family_root:=v_roots[1];
      SELECT * INTO STRICT v_receipt FROM public.vehicle_images WHERE id=v_member;
      v_cursor:=v_family_root; v_chain_ids:='{}'; v_audit_ids:='{}'; v_previous_audit_at:=NULL;
      LOOP
        IF v_cursor=ANY(v_chain_ids) OR cardinality(v_chain_ids)>=9 THEN
          RAISE EXCEPTION 'source lineage cycle or excessive depth';
        END IF;
        SELECT * INTO STRICT v_alias FROM public.vehicle_images WHERE id=v_cursor;
        IF v_alias.user_id IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'source lineage owner changed'; END IF;
        IF v_state='active' AND cardinality(v_family_ids)>1 THEN
          IF v_alias.file_hash IS DISTINCT FROM v_receipt.file_hash
             OR v_alias.image_url IS DISTINCT FROM v_receipt.image_url
             OR v_alias.storage_path IS DISTINCT FROM v_receipt.storage_path
             OR v_alias.created_at IS DISTINCT FROM v_receipt.created_at
             OR v_alias.taken_at IS DISTINCT FROM v_receipt.taken_at OR v_alias.taken_at IS NULL
             OR jsonb_build_array(v_alias.exif_data->'uuid',v_alias.exif_data->'original_filename',
                v_alias.exif_data->'camera_make',v_alias.exif_data->'camera_model',v_alias.exif_data->'source_type',
                v_alias.exif_data->'Make',v_alias.exif_data->'Model',v_alias.exif_data->'DateTimeOriginal')
                IS DISTINCT FROM jsonb_build_array(v_receipt.exif_data->'uuid',v_receipt.exif_data->'original_filename',
                v_receipt.exif_data->'camera_make',v_receipt.exif_data->'camera_model',v_receipt.exif_data->'source_type',
                v_receipt.exif_data->'Make',v_receipt.exif_data->'Model',v_receipt.exif_data->'DateTimeOriginal')
             OR (nullif(v_alias.exif_data->>'uuid','') IS NULL
               AND (nullif(v_alias.exif_data->>'camera_make','') IS NULL OR nullif(v_alias.exif_data->>'camera_model','') IS NULL)
               AND (nullif(v_alias.exif_data->>'Make','') IS NULL OR nullif(v_alias.exif_data->>'Model','') IS NULL)) THEN
            RAISE EXCEPTION 'source lineage exact witness changed';
          END IF;
        END IF;
        IF v_state='active' AND (v_alias.is_sensitive IS TRUE OR v_alias.is_document IS TRUE
             OR coalesce(v_alias.vision_gate_status::text,'') LIKE 'rejected%') THEN
          RAISE EXCEPTION 'source lineage has a retained exclusion';
        END IF;
        -- A true duplicate flag is retained. Only an already visited, exact audited
        -- ancestor can explain it; the root and unrelated duplicates remain blocked.
        IF v_state='active' AND v_alias.is_duplicate IS TRUE
           AND (cardinality(v_chain_ids)=0 OR v_alias.duplicate_of IS NULL OR NOT(v_alias.duplicate_of=ANY(v_chain_ids))) THEN
          RAISE EXCEPTION 'source lineage duplicate is not an audited ancestor';
        END IF;
        v_chain_ids:=array_append(v_chain_ids,v_cursor);
        SELECT count(*) INTO v_audit_count FROM public.reattribution_audit a
          WHERE a.observation_type='image' AND a.old_observation_id=v_cursor AND a.old_observation_id<>a.new_observation_id;
        IF v_audit_count=0 THEN
          IF v_alias.is_superseded IS TRUE OR v_alias.superseded_by IS NOT NULL OR v_alias.superseded_at IS NOT NULL THEN
            RAISE EXCEPTION 'source lineage is missing supersession audit';
          END IF;
          v_family_leaf:=v_cursor; EXIT;
        END IF;
        SELECT * INTO STRICT v_audit FROM public.reattribution_audit a
          WHERE a.observation_type='image' AND a.old_observation_id=v_cursor AND a.old_observation_id<>a.new_observation_id;
        IF v_alias.is_superseded IS NOT TRUE OR v_alias.superseded_by IS DISTINCT FROM v_audit.new_observation_id
           OR v_alias.vehicle_id IS DISTINCT FROM v_audit.old_vehicle_id
           OR v_audit.created_at IS NULL OR v_alias.superseded_at IS DISTINCT FROM v_audit.created_at
           OR v_audit.created_at<v_alias.created_at
           OR (v_previous_audit_at IS NOT NULL AND v_audit.created_at<v_previous_audit_at) THEN
          RAISE EXCEPTION 'source lineage supersession or audit clock changed';
        END IF;
        v_audit_ids:=array_append(v_audit_ids,v_audit.id); v_previous_audit_at:=v_audit.created_at;
        v_cursor:=v_audit.new_observation_id;
      END LOOP;
      IF cardinality(v_chain_ids)<>cardinality(v_family_ids) THEN RAISE EXCEPTION 'source lineage is disconnected'; END IF;
      SELECT * INTO STRICT v_live FROM public.vehicle_images WHERE id=v_family_leaf;
      v_known_ancestor_duplicate:=v_live.is_duplicate IS TRUE AND cardinality(v_chain_ids)>1
        AND v_live.duplicate_of=ANY(v_chain_ids[1:cardinality(v_chain_ids)-1]);
      v_source_family:=jsonb_build_object('root_image_id',v_family_root,'current_image_id',v_family_leaf,
        'alias_image_ids',to_jsonb(v_chain_ids),'audit_ids',to_jsonb(v_audit_ids),'source_sha256',v_receipt.file_hash);
      v_source_roots := array_append(v_source_roots,v_family_root);
      IF v_wrapper #> ARRAY['source_families',v_member::text] IS NOT NULL
         AND v_wrapper #> ARRAY['source_families',v_member::text] IS DISTINCT FROM v_source_family THEN
        RAISE EXCEPTION 'supplied source family differs from current audited identity';
      END IF;
      p_confidence_basis := jsonb_set(p_confidence_basis,ARRAY[v_namespace,'source_families'],
        coalesce(p_confidence_basis #> ARRAY[v_namespace,'source_families'],'{}'::jsonb) ||
        jsonb_build_object(v_member::text,v_source_family),true);
      IF NOT FOUND OR ((v_state = 'active' OR v_privacy) AND v_live.user_id IS DISTINCT FROM v_user) THEN
        RAISE EXCEPTION 'visual subject source unavailable for this account';
      END IF;
      IF v_visual AND v_state = 'active' AND EXISTS (
        SELECT 1 FROM image_observations o
        WHERE o.image_id = ANY(v_chain_ids) AND o.observed_by = 'visual_subjects_v1' AND o.is_active
          AND o.cluster_id IS NOT NULL AND o.cluster_id <> v_cluster_id
      ) THEN
        RAISE EXCEPTION 'visual subject crosses an existing cluster; explicit correction required';
      END IF;
      IF v_visual AND v_state = 'active' AND EXISTS (
        SELECT 1 FROM image_observations w
        WHERE w.image_id = ANY(v_chain_ids) AND w.cluster_id = v_cluster_id
          AND w.observed_by = 'visual_subjects_v1' AND NOT w.is_active
          AND w.confidence_basis #>> '{visual_subjects_v1,state}' = 'withdrawn'
          AND v_read_at <= w.observed_at
      ) THEN
        RAISE EXCEPTION 'visual subject reading predates its explicit withdrawal';
      END IF;
      -- Purpose qualification is private attributed device testimony. Neither
      -- global approval nor a later source/model revision overrides withdrawal.
      IF v_state = 'active' AND EXISTS (SELECT 1 FROM image_observations w
        WHERE w.image_id = ANY(v_chain_ids) AND w.observed_by = 'device_privacy_v1'
          AND w.confidence_basis #>> '{device_privacy_v1,state}' = 'withdrawn') THEN
        RAISE EXCEPTION 'private privacy withdrawal requires explicit new authority';
      END IF;
      v_private_ok := false;
      v_privacy_envelope := NULL;
      IF v_privacy THEN
        v_privacy_envelope := v_envelope;
      ELSIF v_live.vision_gate_status::text = 'pending' THEN
        SELECT count(*) INTO v_privacy_heads FROM image_observations o
         WHERE o.image_id = v_family_leaf AND o.observed_by = 'device_privacy_v1' AND o.superseded_by IS NULL;
        IF v_privacy_heads = 1 THEN
          SELECT * INTO v_privacy_head FROM image_observations o
           WHERE o.image_id = v_family_leaf AND o.observed_by = 'device_privacy_v1' AND o.superseded_by IS NULL;
          IF v_privacy_head.is_active AND v_privacy_head.confidence_basis #>> '{device_privacy_v1,state}' = 'active' THEN
            v_privacy_envelope := v_privacy_head.confidence_basis #> '{device_privacy_v1,envelope}';
          END IF;
        END IF;
      END IF;
      IF v_privacy_envelope IS NOT NULL AND v_state = 'active' THEN
        v_native := v_privacy_envelope -> 'native';
        v_privacy_input := v_privacy_envelope #> '{inputs,0}';
        v_private_ok := coalesce(
          v_live.source = 'capture_relay_ios' AND v_live.vision_gate_status::text = 'pending'
          AND v_privacy_envelope ->> 'method' = 'device_privacy_v1'
          AND v_privacy_envelope ->> 'purpose' = 'own_private_visual_subjects'
          AND v_privacy_envelope ->> 'user_id' = v_user::text
          AND pg_input_is_valid(v_privacy_envelope ->> 'read_at','timestamptz')
          AND isfinite((v_privacy_envelope ->> 'read_at')::timestamptz)
          AND (v_privacy_envelope ->> 'read_at')::timestamptz <= clock_timestamp() + interval '5 minutes'
          AND jsonb_typeof(v_privacy_envelope -> 'inputs') = 'array'
          AND jsonb_array_length(v_privacy_envelope -> 'inputs') = 1
          AND v_privacy_input ->> 'image_id' = v_family_leaf::text
          AND (CASE WHEN cardinality(v_chain_ids)>1 THEN v_privacy_envelope -> 'source_family' = v_source_family
            ELSE NOT(v_privacy_envelope ? 'source_family') END)
          AND (v_previous_audit_at IS NULL OR ((v_privacy_envelope ->> 'read_at')::timestamptz >= v_previous_audit_at
            AND (v_privacy_input ->> 'captured_at')::timestamptz >= v_previous_audit_at))
          AND v_privacy_input ->> 'source_sha256' = v_live.file_hash
          AND v_privacy_input -> 'source_qualified' = 'true'::jsonb
          AND v_privacy_input ->> 'source_url' = v_live.image_url
          AND v_privacy_input ->> 'storage_path' = v_live.storage_path
          AND (v_privacy_input ->> 'created_at')::timestamptz IS NOT DISTINCT FROM v_live.created_at
          AND (v_privacy_input ->> 'taken_at')::timestamptz IS NOT DISTINCT FROM v_live.taken_at
          AND v_live.storage_path ~ ('^users/' || v_user::text || '/capture-relay/' || v_live.file_hash || '/[A-Za-z0-9._-]+$')
          AND split_part(v_live.storage_path,'/',5) NOT IN ('.','..')
          AND v_live.image_url = c_origin || '/storage/v1/object/public/vehicle-photos/' || v_live.storage_path
          AND v_native ->> 'method' = 'device_privacy_v1'
          AND v_native ->> 'purpose' = 'own_private_visual_subjects'
          AND v_native ->> 'owner_user_id' = v_user::text
          AND v_native -> 'policy_version' = '1'::jsonb
          AND v_native ->> 'source_sha256' = v_live.file_hash
          AND jsonb_typeof(v_native -> 'source_byte_length') = 'number'
          AND (v_native ->> 'source_byte_length')::numeric BETWEEN 1 AND 4194304
          AND (v_native ->> 'source_byte_length')::numeric = trunc((v_native ->> 'source_byte_length')::numeric)
          AND (v_native ->> 'source_byte_length')::numeric = CASE WHEN v_privacy_input ->> 'representation' = 'source'
            THEN (v_privacy_input ->> 'byte_length')::numeric ELSE (v_privacy_input #>> '{derivation,source_byte_length}')::numeric END
          AND v_native -> 'classifier_revision' = '2'::jsonb AND v_native -> 'face_revision' = '3'::jsonb
          AND v_native -> 'os_major' = '26'::jsonb
          AND v_native -> 'classifier_completed' = 'true'::jsonb AND v_native -> 'face_completed' = 'true'::jsonb
          AND v_native -> 'pixels_eligible' = 'true'::jsonb AND v_native -> 'clutter' = 'false'::jsonb
          AND v_native -> 'personal' = 'false'::jsonb AND v_native -> 'face_threshold' = '0.045'::jsonb
          AND jsonb_typeof(v_native -> 'prominent_face') = 'boolean' AND jsonb_typeof(v_native -> 'is_vehicle') = 'boolean'
          AND NOT (v_native -> 'prominent_face' = 'true'::jsonb AND v_native -> 'is_vehicle' = 'false'::jsonb)
          AND jsonb_typeof(v_native -> 'max_core_confidence') = 'number'
          AND (v_native ->> 'max_core_confidence')::numeric BETWEEN 0 AND 1
          AND jsonb_typeof(v_native -> 'total_vehicle_confidence') = 'number'
          AND (v_native ->> 'total_vehicle_confidence')::numeric BETWEEN 0 AND 128
          AND (v_native ->> 'is_vehicle')::boolean = ((v_native ->> 'max_core_confidence')::real > 0.1::real
            OR (v_native ->> 'total_vehicle_confidence')::real > 0.3::real)
          AND pg_input_is_valid(v_native ->> 'observed_at','timestamptz')
          AND isfinite((v_native ->> 'observed_at')::timestamptz)
          AND (v_native ->> 'observed_at')::timestamptz <= (v_privacy_envelope ->> 'read_at')::timestamptz + interval '5 minutes'
          AND jsonb_typeof(v_native -> 'labels') = 'array' AND jsonb_array_length(v_native -> 'labels') <= 12
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_native -> 'labels') l
            WHERE jsonb_typeof(l -> 'identifier') IS DISTINCT FROM 'string' OR length(l ->> 'identifier') NOT BETWEEN 1 AND 120
              OR jsonb_typeof(l -> 'confidence') IS DISTINCT FROM 'number' OR (l ->> 'confidence')::numeric NOT BETWEEN 0 AND 1)
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_native -> 'labels') WITH ORDINALITY l(value,n)
            WHERE n <= 3 AND lower(value ->> 'identifier') IN ('document','text','menu','receipt','paper','printout','poster',
              'advertisement','packaging','envelope','label','book_jacket','business_card','website','web_site','screenshot',
              'spreadsheet','invoice','id_card','form','newspaper','magazine'))
          AND v_native #>> '{decode,contract}' = 'imageio_thumbnail_512_v1'
          AND v_native #> '{decode,max_pixel}' = '512'::jsonb AND v_native #> '{decode,orientation_applied}' = 'true'::jsonb
          AND v_native #>> '{decode,input_sha256}' ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof(v_native #> '{decode,width}') = 'number' AND (v_native #>> '{decode,width}')::numeric BETWEEN 1 AND 512
          AND (v_native #>> '{decode,width}')::numeric = trunc((v_native #>> '{decode,width}')::numeric)
          AND jsonb_typeof(v_native #> '{decode,height}') = 'number' AND (v_native #>> '{decode,height}')::numeric BETWEEN 1 AND 512
          AND (v_native #>> '{decode,height}')::numeric = trunc((v_native #>> '{decode,height}')::numeric)
          AND jsonb_typeof(v_native #> '{decode,byte_length}') = 'number' AND (v_native #>> '{decode,byte_length}')::numeric BETWEEN 1 AND 4194304
          AND (v_native #>> '{decode,byte_length}')::numeric = trunc((v_native #>> '{decode,byte_length}')::numeric),
          false);
      END IF;
      IF v_privacy AND v_state = 'active' AND NOT v_private_ok THEN
        RAISE EXCEPTION 'private device receipt is unsupported, incomplete or differs from exact current source';
      END IF;
      IF v_privacy AND v_state = 'active' AND (
        NOT coalesce(pg_input_is_valid(v_input ->> 'captured_at','timestamptz'),false)
        OR NOT isfinite((v_input ->> 'captured_at')::timestamptz)
        OR (v_input ->> 'captured_at')::timestamptz > v_read_at
        OR (v_input ->> 'representation' = 'source' AND (
          v_input -> 'source_bytes_qualified' IS DISTINCT FROM 'true'::jsonb
          OR v_input ->> 'input_url' IS DISTINCT FROM v_live.image_url
          OR coalesce(v_input ->> 'mime_type','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')))) THEN
        RAISE EXCEPTION 'private device receipt lacks an exact captured original';
      END IF;
      -- Withdrawals preserve the earlier bytes and clocks as testimony. Active
      -- admission requires the currently retained exact originals, not a device
      -- assertion, thumbnail, current vehicle_id, session, or GPS inference.
      IF v_state = 'active' AND (
         v_live.is_superseded IS TRUE OR (v_live.is_duplicate IS TRUE AND NOT v_known_ancestor_duplicate)
         OR v_live.is_document IS TRUE OR v_live.is_sensitive IS TRUE
         OR (coalesce(v_live.vision_gate_status::text,'') <> 'approved' AND NOT v_private_ok)
         OR nullif(btrim(v_live.image_url),'') IS NULL
         OR v_input -> 'source_qualified' IS DISTINCT FROM 'true'::jsonb
         OR coalesce(v_input ->> 'source_sha256','') !~ '^[0-9a-f]{64}$'
         OR v_input ->> 'source_sha256' IS DISTINCT FROM v_live.file_hash
         OR coalesce(v_input ->> 'input_sha256','') !~ '^[0-9a-f]{64}$'
         OR NOT coalesce(pg_input_is_valid(v_input ->> 'created_at','timestamptz'),false)
         OR (v_input ->> 'created_at')::timestamptz IS DISTINCT FROM v_live.created_at
         OR (v_input ->> 'taken_at' IS NOT NULL AND NOT coalesce(pg_input_is_valid(v_input ->> 'taken_at','timestamptz'),false))
         OR (v_input ->> 'taken_at')::timestamptz IS DISTINCT FROM v_live.taken_at
         OR v_read_at < v_live.created_at) THEN
        RAISE EXCEPTION 'visual subject source custody changed or unqualified';
      END IF;
      IF v_state = 'active' THEN
        IF v_input ->> 'representation' = 'source' THEN
          IF v_input ->> 'input_sha256' IS DISTINCT FROM v_live.file_hash THEN
            RAISE EXCEPTION 'visual subject original input hash differs from source';
          END IF;
        ELSIF v_input ->> 'representation' = 'derivative' THEN
          v_derivation := v_input -> 'derivation';
          v_object_path := 'vehicle-photos/' || v_live.storage_path;
          IF v_input -> 'derivation_qualified' IS DISTINCT FROM 'true'::jsonb
             OR v_input -> 'source_bytes_qualified' IS DISTINCT FROM 'false'::jsonb
             OR v_input ->> 'mime_type' IS DISTINCT FROM 'image/jpeg'
             OR v_derivation ->> 'contract' IS DISTINCT FROM 'supabase_content_addressed_render_v1'
             OR v_derivation ->> 'trusted_origin' IS DISTINCT FROM c_origin
             OR v_live.storage_path IS NULL
             OR split_part(v_live.storage_path,'/',1) <> 'users'
             OR split_part(v_live.storage_path,'/',2) <> v_user::text
             OR split_part(v_live.storage_path,'/',3) <> 'capture-relay'
             OR split_part(v_live.storage_path,'/',4) <> v_live.file_hash
             OR array_length(string_to_array(v_live.storage_path,'/'),1) <> 5
             OR split_part(v_live.storage_path,'/',5) !~ '^[A-Za-z0-9._-]+$'
             OR split_part(v_live.storage_path,'/',5) IN ('.','..')
             OR v_derivation ->> 'source_object_path' IS DISTINCT FROM v_object_path
             OR v_derivation ->> 'render_path' IS DISTINCT FROM '/storage/v1/render/image/public/' || v_object_path
             OR v_derivation -> 'parameters' IS DISTINCT FROM '{"width":1600,"height":1600,"resize":"contain","quality":85}'::jsonb
             OR v_derivation ->> 'request_accept' IS DISTINCT FROM 'image/jpeg'
             OR v_derivation ->> 'source_sha256' IS DISTINCT FROM v_live.file_hash
             OR v_derivation ->> 'input_sha256' IS DISTINCT FROM v_input ->> 'input_sha256'
             OR coalesce(v_derivation ->> 'source_mime_type','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')
             OR jsonb_typeof(v_derivation -> 'source_byte_length') IS DISTINCT FROM 'number'
             OR jsonb_typeof(v_input -> 'byte_length') IS DISTINCT FROM 'number'
             OR NOT coalesce(pg_input_is_valid(v_derivation ->> 'source_captured_at','timestamptz'),false) THEN
            RAISE EXCEPTION 'visual subject derivative lacks trusted content-addressed normalization';
          END IF;
          IF (v_derivation ->> 'source_byte_length')::numeric NOT BETWEEN 1 AND 4194304
             OR (v_input ->> 'byte_length')::numeric NOT BETWEEN 1 AND 4194304
             OR NOT isfinite((v_derivation ->> 'source_captured_at')::timestamptz)
             OR (v_derivation ->> 'source_captured_at')::timestamptz > v_read_at THEN
            RAISE EXCEPTION 'visual subject derivative byte receipt is malformed';
          END IF;
          IF v_input ->> 'source_url' IS DISTINCT FROM c_origin || '/storage/v1/object/public/' || v_object_path
             OR v_input ->> 'input_url' IS DISTINCT FROM c_origin || '/storage/v1/render/image/public/' || v_object_path
                || '?width=1600&height=1600&resize=contain&quality=85' THEN
            RAISE EXCEPTION 'visual subject derivative URL differs from its protected contract';
          END IF;
        ELSE
          RAISE EXCEPTION 'visual subject representation is unsupported';
        END IF;
      END IF;
      v_earliest := least(v_earliest,v_live.taken_at);
      v_latest := greatest(v_latest,v_live.taken_at);
    END LOOP;
    IF v_visual AND v_state = 'active' AND (SELECT count(DISTINCT x) FROM unnest(v_source_roots) x) < 2 THEN
      RAISE EXCEPTION 'audited aliases cannot become independent source photos';
    END IF;
    IF v_visual AND v_state = 'active' AND (SELECT count(DISTINCT i ->> 'source_sha256')
      FROM jsonb_array_elements(v_envelope -> 'inputs') i
      WHERE i ->> 'image_id' = ANY(ARRAY(SELECT x::text FROM unnest(v_members) x))) < 2 THEN
      RAISE EXCEPTION 'visual subject requires distinct photographed views';
    END IF;
    IF v_visual THEN
    SELECT * INTO v_cluster FROM emergent_vehicle_clusters WHERE id = v_cluster_id FOR UPDATE;
    IF FOUND THEN
      IF v_cluster.resolved_to_vehicle_id IS NOT NULL OR v_cluster.is_active IS NOT TRUE
         OR v_cluster.resolution_evidence #>> '{visual_subjects_v1,user_id}' IS DISTINCT FROM v_user::text
         OR v_cluster.resolution_evidence #>> '{visual_subjects_v1,anchor_image_id}' IS DISTINCT FROM v_anchor::text THEN
        RAISE EXCEPTION 'visual subject cluster is resolved, withdrawn or belongs to another interpretation';
      END IF;
    ELSIF v_state = 'withdrawn' THEN
      RAISE EXCEPTION 'cannot withdraw a visual subject that has not been retained';
    ELSE
      INSERT INTO emergent_vehicle_clusters(id,cluster_label,earliest_image,latest_image,image_count,resolution_evidence)
      VALUES(v_cluster_id,NULL,v_earliest,v_latest,cardinality(v_members),
        jsonb_build_object('visual_subjects_v1',jsonb_build_object('user_id',v_user,'run_key',v_run,
          'anchor_image_id',v_anchor,'envelope',v_envelope,'identity_status','unresolved',
          'ownership_asserted',false,'global_novelty_asserted',false)));
    END IF;
    END IF; -- Only supported subjects create a cluster.
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('ingest_image_observation:' || p_image_id || ':' ||
      p_observed_by || ':' || coalesce(p_agent_version,''),0));
  END IF;

  SELECT * INTO v_existing FROM image_observations
   WHERE image_id = p_image_id AND observed_by = p_observed_by
     AND agent_version IS NOT DISTINCT FROM p_agent_version
     AND (NOT v_reading OR confidence_basis #>> '{visual_subject_reading_v1,input_key}' = v_input_key)
     AND (is_active OR (v_protected AND superseded_by IS NULL))
   ORDER BY observed_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_reading AND v_existing.confidence_basis #>> '{visual_subject_reading_v1,envelope,user_id}' IS DISTINCT FROM v_user::text THEN
      RAISE EXCEPTION 'reading-only receipt belongs to another account';
    END IF;
    IF v_existing.role = p_role AND v_existing.vehicle_id IS NOT DISTINCT FROM p_vehicle_id
       AND v_existing.cluster_id IS NOT DISTINCT FROM v_cluster_id
       AND v_existing.confidence = p_confidence
       AND v_existing.confidence_basis = coalesce(p_confidence_basis,'{}'::jsonb)
       AND v_existing.layer_version = coalesce(p_layer_version,'{}'::jsonb)
       AND v_existing.is_active = (NOT v_protected OR v_state = 'active') THEN
      RETURN v_existing.id;
    END IF;
    UPDATE image_observations SET is_active = false WHERE id = v_existing.id;
  ELSIF v_reading AND v_state = 'withdrawn' THEN
    RAISE EXCEPTION 'cannot withdraw a visual reading that has not been retained';
  END IF;
  INSERT INTO image_observations(image_id,vehicle_id,cluster_id,role,confidence,confidence_basis,
    layer_version,observed_by,agent_version,is_active)
  VALUES(p_image_id,p_vehicle_id,v_cluster_id,p_role,p_confidence,coalesce(p_confidence_basis,'{}'::jsonb),
    coalesce(p_layer_version,'{}'::jsonb),p_observed_by,p_agent_version,NOT v_protected OR v_state = 'active')
  RETURNING id INTO v_new_id;
  IF v_existing.id IS NOT NULL THEN
    UPDATE image_observations SET superseded_by = v_new_id WHERE id = v_existing.id;
  END IF;
  RETURN v_new_id;
END;
$function$;

COMMIT;
RESET statement_timeout;
RESET lock_timeout;
