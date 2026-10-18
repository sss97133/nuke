-- Held for review: protected visual-subject storage, not a classifier activation,
-- vehicle attribution, profile mint, ownership claim, or public-read grant.
-- Existing ingest_image_observation is service_role-only (live ACL inspected
-- 2026-10-18). Keep its signature and ACL; qualify sources before even a replay.
SET statement_timeout = '10s';
SET lock_timeout = '2s';
BEGIN;

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

  v_protected := v_visual OR v_reading;
  IF (v_visual AND v_reading) OR (p_observed_by IN ('visual_subjects_v1','visual_subject_reading_v1') AND NOT v_protected) THEN
    RAISE EXCEPTION 'protected visual producer requires exactly its reserved namespace';
  END IF;
  IF v_protected THEN
    v_namespace := CASE WHEN v_reading THEN 'visual_subject_reading_v1' ELSE 'visual_subjects_v1' END;
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
       OR v_envelope ->> 'method' IS DISTINCT FROM 'visual_subjects_v1'
       OR NOT coalesce(pg_input_is_valid(v_envelope ->> 'user_id','uuid'),false)
       OR (v_visual AND NOT coalesce(pg_input_is_valid(v_wrapper ->> 'anchor_image_id','uuid'),false))
       OR nullif(btrim(v_envelope ->> 'model'),'') IS NULL
       OR nullif(btrim(v_envelope ->> 'provider'),'') IS NULL
       OR NOT coalesce(pg_input_is_valid(v_envelope ->> 'read_at','timestamptz'),false)
       OR nullif(btrim(p_agent_version),'') IS NULL THEN
      RAISE EXCEPTION 'invalid protected visual subject envelope';
    END IF;
    v_run := v_envelope ->> 'run_key';
    IF v_run IS NULL OR length(v_run) NOT BETWEEN 1 AND 128
       OR jsonb_typeof(v_envelope -> 'inputs') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_envelope -> 'subjects') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid visual subject scope';
    END IF;
    IF (v_visual AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 1 AND 14
       OR jsonb_array_length(v_envelope -> 'subjects') NOT BETWEEN 1 AND 14))
       OR (v_reading AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 2 AND 3
       OR jsonb_array_length(v_envelope -> 'subjects') > 3)) THEN
      RAISE EXCEPTION 'visual subject scope exceeds its bounded producer';
    END IF;
    v_user := (v_envelope ->> 'user_id')::uuid;
    v_read_at := (v_envelope ->> 'read_at')::timestamptz;
    IF NOT isfinite(v_read_at) OR v_read_at > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'invalid visual subject reading clock';
    END IF;
    IF v_reading THEN
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
      SELECT * INTO v_live FROM vehicle_images WHERE id = v_member FOR SHARE;
      IF NOT FOUND OR (v_state = 'active' AND v_live.user_id IS DISTINCT FROM v_user) THEN
        RAISE EXCEPTION 'visual subject source unavailable for this account';
      END IF;
      IF v_visual AND v_state = 'active' AND EXISTS (
        SELECT 1 FROM image_observations o
        WHERE o.image_id = v_member AND o.observed_by = 'visual_subjects_v1' AND o.is_active
          AND o.cluster_id IS NOT NULL AND o.cluster_id <> v_cluster_id
      ) THEN
        RAISE EXCEPTION 'visual subject crosses an existing cluster; explicit correction required';
      END IF;
      IF v_visual AND v_state = 'active' AND EXISTS (
        SELECT 1 FROM image_observations w
        WHERE w.image_id = v_member AND w.cluster_id = v_cluster_id
          AND w.observed_by = 'visual_subjects_v1' AND NOT w.is_active
          AND w.confidence_basis #>> '{visual_subjects_v1,state}' = 'withdrawn'
          AND v_read_at <= w.observed_at
      ) THEN
        RAISE EXCEPTION 'visual subject reading predates its explicit withdrawal';
      END IF;
      -- Withdrawals preserve the earlier bytes and clocks as testimony. Active
      -- admission requires the currently retained exact originals, not a device
      -- assertion, thumbnail, current vehicle_id, session, or GPS inference.
      IF v_state = 'active' AND (
         v_live.is_superseded IS TRUE OR v_live.is_duplicate IS TRUE
         OR v_live.is_document IS TRUE OR v_live.is_sensitive IS TRUE
         OR coalesce(v_live.vision_gate_status::text,'') <> 'approved'
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

COMMENT ON FUNCTION public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb) IS
  'Existing service-only image reading writer. The reserved confidence_basis.visual_subjects_v1 wraps a protected '
  'producer envelope and selected anchor; qualifies live owned source bytes/clocks before replay and creates '
  'unresolved private clusters. visual_subject_reading_v1 retains complete bounded interpretations, including '
  'unknowns, with separate part readings and no cluster. Evidence/layer changes supersede readings; withdrawals remain inactive '
  'testimony. No canonical filing, identity, ownership or global novelty is admitted. 20261018165532.';
COMMIT;
RESET statement_timeout;
RESET lock_timeout;
