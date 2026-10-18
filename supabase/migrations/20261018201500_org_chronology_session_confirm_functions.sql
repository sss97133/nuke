-- Brings into git the org-chronology and session-confirm functions that were applied to production by hand on
-- 2026-10-17 (their migration file was lost before commit). Bodies are the live definitions read from production,
-- with one change: get_orphan_sessions returns rows only for the calling account, and no longer runs for anon.
-- Before this, a logged-out caller could pass any user id and read that user's photo locations and image URLs.
-- Grants restate what production holds today for every other function.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.attribute_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid, p_confidence numeric DEFAULT NULL::numeric, p_signal text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_is_primary     boolean;
  v_file_hash      text;
  v_keep_primary   boolean := false;
BEGIN
  IF p_observation_type NOT IN ('image','observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary,false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    -- FIRST-attribution ONLY. Already-attributed -> use relink_testimony to move.
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use relink_testimony() to move an already-attributed image');
    END IF;

    -- Guard: identical content already on target (the (vehicle_id,file_hash) rule).
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
        'observation_id', p_observation_id);
    END IF;

    -- Keep is_primary only if it was primary AND target has no primary yet;
    -- otherwise force false (respect the one-primary-per-vehicle index).
    v_keep_primary := v_is_primary AND NOT EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.is_primary = true
        AND COALESCE(b.is_document,false) = false
        AND COALESCE(b.is_duplicate,false) = false
    );

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           is_primary = v_keep_primary,
           vision_gate_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'::public.vision_gate_enum
             ELSE vision_gate_status
           END,
           is_approved = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN true
             ELSE is_approved
           END,
           approval_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'
             ELSE approval_status
           END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use reattribute_observation() to move an already-attributed observation');
    END IF;
    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, NULL,
    p_observation_id, p_target_vehicle_id,
    'first_attribution: ' || COALESCE(p_reason,'')
      || COALESCE('; confidence=' || p_confidence::text, '')
      || COALESCE('; signal=' || p_signal, ''),
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'first_attribution',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', NULL,
    'new_vehicle_id', p_target_vehicle_id,
    'confidence', p_confidence,
    'signal', p_signal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_add_to_image_set(p_native_album jsonb, p_readings jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid:=auth.uid(); request_key uuid; previous_key uuid; installation uuid;
  observed timestamptz; album jsonb; old public.image_sets%ROWTYPE;
  current_set uuid; current_capture uuid; result uuid; map_key text;
  reading jsonb; image_key uuid; image_count integer; linked integer; reason text;
  receipts jsonb:='[]'::jsonb; witness jsonb; v_inherited_vehicle_id uuid;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'native album capture requires the actual authenticated account' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_native_album) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_native_album))<>7
    OR NOT p_native_album ?& ARRAY['request_id','previous_capture_id','installation_id','observed_at','access_scope','album','contract']
    OR p_native_album->>'contract' IS DISTINCT FROM 'photokit_album_v1'
    OR p_native_album->>'access_scope' IS DISTINCT FROM 'full'
    OR octet_length(p_native_album::text)>25000000 THEN
    RAISE EXCEPTION 'bounded full-scope native album capture required' USING ERRCODE='23514';
  END IF;
  request_key:=(p_native_album->>'request_id')::uuid;
  previous_key:=(p_native_album->>'previous_capture_id')::uuid;
  installation:=(p_native_album->>'installation_id')::uuid;
  observed:=(p_native_album->>'observed_at')::timestamptz;
  album:=p_native_album->'album';
  IF request_key IS NULL OR installation IS NULL OR observed IS NULL OR NOT isfinite(observed)
    OR jsonb_typeof(album) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(album))<>6
    OR NOT album ?& ARRAY['local_id','name','folder_path','source_kind','present','photos']
    OR NULLIF(album->>'local_id','') IS NULL OR length(album->>'local_id')>512
    OR jsonb_typeof(album->'name') NOT IN ('string','null') OR length(album->>'name')>1024
    OR jsonb_typeof(album->'source_kind') IS DISTINCT FROM 'string'
    OR length(album->>'source_kind')>128 OR jsonb_typeof(album->'present') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(album->'folder_path') IS DISTINCT FROM 'array'
    OR jsonb_array_length(album->'folder_path')>100
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(album->'folder_path') p WHERE jsonb_typeof(p)<>'string' OR length(p #>> '{}')>1024)
    OR jsonb_typeof(album->'photos') IS DISTINCT FROM 'array'
    OR jsonb_array_length(album->'photos')>50000
    OR (album->>'present'='false' AND jsonb_array_length(album->'photos')<>0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(album->'photos') p WHERE
      jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>2
      OR NOT p ?& ARRAY['local_id','source_version'] OR NULLIF(p->>'local_id','') IS NULL
      OR length(p->>'local_id')>512 OR jsonb_typeof(p->'source_version') NOT IN ('string','null')
      OR length(p->>'source_version')>128)
    OR (SELECT count(DISTINCT p->>'local_id') FROM jsonb_array_elements(album->'photos') p)<>jsonb_array_length(album->'photos') THEN
    RAISE EXCEPTION 'invalid native source album or membership' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_readings)>200 THEN
    RAISE EXCEPTION 'bounded independent byte witness batch required' USING ERRCODE='23514';
  END IF;
  map_key:='ios-source:'||installation::text||':'||(album->>'local_id');
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||map_key,0));
  SELECT m.image_set_id,s.source_capture_id INTO current_set,current_capture
    FROM public.album_sync_map m LEFT JOIN public.image_sets s ON s.id=m.image_set_id
    WHERE m.user_id=actor AND m.apple_album_id=map_key FOR UPDATE OF m;
  SELECT * INTO old FROM public.image_sets WHERE user_id=actor AND source_capture_id=request_key
    AND source_contract='photokit_album_v1';
  IF FOUND THEN
    IF old.metadata->'capture' IS DISTINCT FROM p_native_album THEN
      RAISE EXCEPTION 'capture request reused with different source content' USING ERRCODE='23514';
    END IF;
    result:=old.id;
  ELSE
    IF previous_key IS DISTINCT FROM current_capture THEN
      RETURN jsonb_build_object('status','predecessor_conflict','current_capture_id',current_capture,'current_set_id',current_set);
    END IF;
    IF current_set IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.image_sets s WHERE s.id=current_set
      AND s.user_id=actor AND s.source_contract='photokit_album_v1'
      AND s.metadata->'capture'->>'installation_id'=installation::text
      AND s.metadata->'capture'->'album'->>'local_id'=album->>'local_id') THEN
      RAISE EXCEPTION 'native map points outside its source lineage' USING ERRCODE='23514';
    END IF;
    SELECT asm.vehicle_id INTO v_inherited_vehicle_id
      FROM public.album_sync_map asm
      JOIN public.vehicles v ON v.id = asm.vehicle_id AND v.owner_id = actor
     WHERE asm.user_id = actor
       AND asm.vehicle_id IS NOT NULL
       AND (
         asm.apple_album_id = map_key
         OR lower(trim(asm.apple_album_name)) = lower(trim(coalesce(album->>'name','')))
       )
     LIMIT 1;
    INSERT INTO public.image_sets(user_id,created_by,vehicle_id,is_personal,name,source_contract,
      source_capture_id,source_predecessor_id,source_observed_at,metadata)
    VALUES(actor,actor,NULL,true,coalesce(album->>'name','Untitled Photos album'),'photokit_album_v1',
      request_key,current_set,observed,jsonb_build_object('source_contract','photokit_album_v1','capture',p_native_album,
      'intake_account_id',actor,'source_observer','photokit','album_author','unknown',
      'physical_vehicle_identity','unresolved')) RETURNING id INTO result;
    INSERT INTO public.album_sync_map(user_id,apple_album_id,apple_album_name,image_set_id,vehicle_id,
      photo_count_apple,photo_count_nuke,sync_direction,last_synced_at)
    VALUES(actor,map_key,coalesce(album->>'name','Untitled Photos album'),result,v_inherited_vehicle_id,
      jsonb_array_length(album->'photos'),0,'apple_to_nuke',now())
    ON CONFLICT(user_id,apple_album_id) DO UPDATE SET image_set_id=EXCLUDED.image_set_id,
      apple_album_name=EXCLUDED.apple_album_name,
      vehicle_id=COALESCE(public.album_sync_map.vehicle_id, EXCLUDED.vehicle_id),
      photo_count_apple=EXCLUDED.photo_count_apple,
      photo_count_nuke=0,last_synced_at=EXCLUDED.last_synced_at;
    current_set:=result; current_capture:=request_key;
  END IF;
  FOR reading IN SELECT value FROM jsonb_array_elements(p_readings) LOOP
    IF jsonb_typeof(reading) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(reading))<>5
      OR NOT reading ?& ARRAY['local_id','source_version','input_sha256','method_version','read_id']
      OR coalesce(reading->>'input_sha256','') !~ '^[a-f0-9]{64}$'
      OR NULLIF(reading->>'method_version','') IS NULL OR length(reading->>'method_version')>256
      OR NULLIF(reading->>'read_id','') IS NULL OR length(reading->>'read_id')>128 THEN
      RAISE EXCEPTION 'invalid independent original-byte witness' USING ERRCODE='23514';
    END IF;
    reason:=NULL;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(album->'photos') p WHERE p->>'local_id'=reading->>'local_id'
      AND p->>'source_version' IS NOT NULL AND p->>'source_version'=reading->>'source_version') THEN
      reason:='source_reference_unqualified';
    ELSE
      SELECT count(*),(array_agg(i.id))[1] INTO image_count,image_key FROM public.vehicle_images i
        WHERE i.user_id=actor AND i.exif_data->>'uuid'=reading->>'local_id'
        AND i.file_hash=reading->>'input_sha256' AND NULLIF(i.image_url,'') IS NOT NULL
        AND i.is_document IS NOT TRUE AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE
        AND coalesce(i.vision_gate_status::text,'approved')='approved';
      IF image_count=0 THEN reason:='original_not_uploaded';
      ELSIF image_count>1 THEN reason:='ambiguous_cloud_original'; END IF;
    END IF;
    IF reason IS NULL THEN
      witness:=reading||jsonb_build_object('contract','native_album_byte_witness_v1');
      INSERT INTO public.image_set_members(image_set_id,image_id,added_by,display_order,notes,role)
      SELECT result,image_key,actor,(p.ordinality-1)::integer,witness::text,'source_context'
        FROM jsonb_array_elements(album->'photos') WITH ORDINALITY p(value,ordinality)
        WHERE p.value->>'local_id'=reading->>'local_id'
      ON CONFLICT(image_set_id,image_id) DO NOTHING;
    END IF;
    receipts:=receipts||jsonb_build_array(jsonb_build_object('read_id',reading->>'read_id',
      'status',coalesce(reason,'linked'),'image_id',CASE WHEN reason IS NULL THEN image_key ELSE NULL END));
  END LOOP;
  SELECT count(*) INTO linked FROM public.image_set_members WHERE image_set_id=result;
  UPDATE public.album_sync_map SET photo_count_nuke=linked WHERE user_id=actor
    AND apple_album_id=map_key AND image_set_id=result;
  RETURN jsonb_build_object('status','retained','image_set_id',result,'capture_id',request_key,
    'is_current',result=current_set,'source_count',jsonb_array_length(album->'photos'),
    'linked_count',linked,'unlinked_count',jsonb_array_length(album->'photos')-linked,'readings',receipts);
END $function$;

CREATE OR REPLACE FUNCTION public.bulk_add_to_image_set(set_id uuid, image_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  img_id UUID;
  added_count INTEGER := 0;
  next_order INTEGER;
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM image_sets 
    WHERE id = set_id 
    AND (
      created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'contributor')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Get next display order
  SELECT COALESCE(MAX(display_order), -1) + 1 
  INTO next_order
  FROM image_set_members
  WHERE image_set_id = set_id;
  
  -- Add each image
  FOREACH img_id IN ARRAY image_ids
  LOOP
    INSERT INTO image_set_members (
      image_set_id,
      image_id,
      display_order,
      added_by
    )
    VALUES (
      set_id,
      img_id,
      next_order,
      auth.uid()
    )
    ON CONFLICT (image_set_id, image_id) DO NOTHING;
    
    IF FOUND THEN
      added_count := added_count + 1;
      next_order := next_order + 1;
    END IF;
  END LOOP;
  
  RETURN added_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_work_sessions_bulk(p_session_ids uuid[], p_confirm boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_ids IS NULL OR array_length(p_session_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF p_confirm THEN
    UPDATE public.work_sessions ws
       SET owner_confirmed_at = COALESCE(ws.owner_confirmed_at, now()),
           owner_confirmed_by = COALESCE(ws.owner_confirmed_by, v_actor),
           updated_at = now()
     WHERE ws.id = ANY(p_session_ids)
       AND (
         ws.user_id = v_actor
         OR EXISTS (
           SELECT 1 FROM public.vehicles v
           WHERE v.id = ws.vehicle_id
             AND (v.owner_id = v_actor OR v.user_id = v_actor)
         )
         OR EXISTS (
           SELECT 1 FROM public.user_vehicle_roles r
           WHERE r.vehicle_id = ws.vehicle_id
             AND r.user_id = v_actor
             AND r.role IN ('owner', 'co_owner')
         )
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    UPDATE public.work_sessions ws
       SET owner_confirmed_at = NULL,
           owner_confirmed_by = NULL,
           updated_at = now()
     WHERE ws.id = ANY(p_session_ids)
       AND (
         ws.user_id = v_actor
         OR EXISTS (
           SELECT 1 FROM public.vehicles v
           WHERE v.id = ws.vehicle_id
             AND (v.owner_id = v_actor OR v.user_id = v_actor)
         )
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_org_page(p_org_id uuid, p_at timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH org AS (
    SELECT b.id, b.business_name, b.business_type, b.city, b.state
    FROM businesses b
    WHERE b.id = p_org_id
  ),
  here AS (
    SELECT ol.latitude::float8 AS lat, ol.longitude::float8 AS lon
    FROM organization_locations ol
    WHERE ol.organization_id = p_org_id
      AND ol.latitude IS NOT NULL
      AND ol.longitude IS NOT NULL
  ),
  links AS (
    SELECT ov.vehicle_id, ov.relationship_type, ov.created_at
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_org_id
      AND coalesce(ov.user_rejected, false) = false
      AND coalesce(ov.hidden_from_public, false) = false
      AND ov.vehicle_id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
    ORDER BY ov.created_at DESC
    LIMIT 2000
  ),
  contact AS (
    SELECT c.vehicle_id, c.last_at, c.hours_24h
    FROM org_vehicle_contact(p_org_id, p_at) c
  ),
  ranked AS (
    SELECT DISTINCT ON (l.vehicle_id)
      l.vehicle_id,
      l.relationship_type,
      l.created_at,
      coalesce(
        c.last_at,
        (SELECT vi.taken_at
         FROM vehicle_images vi
         WHERE vi.vehicle_id = l.vehicle_id
           AND vi.taken_at IS NOT NULL
           AND vi.taken_at <= p_at
           AND vehicle_image_gallery_eligible(vi)
         ORDER BY vi.taken_at DESC
         LIMIT 1)
      ) AS last_at,
      coalesce(c.hours_24h, 0) AS hours_24h
    FROM links l
    LEFT JOIN contact c USING (vehicle_id)
    ORDER BY l.vehicle_id, c.last_at DESC NULLS LAST, l.created_at DESC
  ),
  top AS (
    SELECT r.*, v.year, v.make, v.model, v.primary_image_url
    FROM ranked r
    JOIN vehicles v ON v.id = r.vehicle_id
    WHERE upper(coalesce(v.make, '')) <> 'UNRESOLVED'
      AND v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
    ORDER BY
      relation_weight(r.last_at, p_at) DESC,
      r.last_at DESC NULLS LAST,
      r.created_at DESC
    LIMIT greatest(1, least(p_limit, 200))
  )
  SELECT jsonb_build_object(
    'org', (
      SELECT jsonb_build_object(
        'id', o.id,
        'name', o.business_name,
        'type', o.business_type,
        'city', o.city,
        'state', o.state
      )
      FROM org o
    ),
    'as_of', p_at,
    'half_life_hours', 6,
    'dormant_below', 0.0625,
    'basis', jsonb_build_array(
      'photos within 150 m of the organization''s locations',
      'organization images',
      'timeline events',
      'contractor work'
    ),
    'you', (
      SELECT jsonb_build_object('role', r->>'role', 'relation', r->'relation')
      FROM jsonb_array_elements(user_org_relations(auth.uid(), p_at)->'relations') r
      WHERE auth.uid() IS NOT NULL AND r->>'organization_id' = p_org_id::text
      LIMIT 1
    ),
    'vehicles', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'vehicle_id', t.vehicle_id,
        'year', t.year,
        'make', t.make,
        'model', t.model,
        'relationship_type', t.relationship_type,
        'image_url', coalesce(
          (SELECT vi.image_url
           FROM vehicle_images vi
           WHERE vi.vehicle_id = t.vehicle_id
             AND vi.taken_at IS NOT NULL
             AND vehicle_image_gallery_eligible(vi)
             AND nullif(vi.image_url, '') IS NOT NULL
           ORDER BY
             (CASE WHEN vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL AND EXISTS (
                SELECT 1 FROM here h
                WHERE abs(vi.latitude::float8 - h.lat) < 0.003
                  AND abs(vi.longitude::float8 - h.lon) < 0.003
              ) THEN 1 ELSE 0 END) DESC,
             vi.taken_at DESC
           LIMIT 1),
          (SELECT vi.image_url
           FROM vehicle_images vi
           WHERE vi.vehicle_id = t.vehicle_id
             AND vehicle_image_gallery_eligible(vi)
             AND nullif(vi.image_url, '') IS NOT NULL
           ORDER BY vi.created_at DESC
           LIMIT 1),
          t.primary_image_url
        ),
        'relation', jsonb_build_object(
          'weight', relation_weight(t.last_at, p_at),
          'state', relation_state(relation_weight(t.last_at, p_at)),
          'last_contribution_at', t.last_at,
          'contributions_24h', t.hours_24h
        )
      ) ORDER BY
        relation_weight(t.last_at, p_at) DESC,
        t.last_at DESC NULLS LAST,
        t.created_at DESC)
      FROM top t
    ), '[]'::jsonb),
    'vehicles_considered', (SELECT count(DISTINCT vehicle_id) FROM links),
    'vehicles_total', (
      SELECT count(DISTINCT x.vehicle_id)
      FROM (
        SELECT ov.vehicle_id
        FROM organization_vehicles ov
        JOIN vehicles v ON v.id = ov.vehicle_id
        WHERE ov.organization_id = p_org_id
          AND coalesce(ov.user_rejected, false) = false
          AND coalesce(ov.hidden_from_public, false) = false
          AND upper(coalesce(v.make, '')) <> 'UNRESOLVED'
          AND v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
        LIMIT 10001
      ) x
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_orphan_sessions(p_user_id uuid)
 RETURNS TABLE(session_day date, gps_cell text, photo_count bigint, image_ids uuid[], sample_url text, suggested_vehicle_id uuid, suggested_vehicle_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH user_site_list AS MATERIALIZED (
    SELECT
      s.lat,
      s.lon,
      CASE
        WHEN nullif(trim(s.name), '') IS NOT NULL
          THEN trim(s.name) || ' · ' || round(s.lat::numeric, 3)::text || ',' || round(s.lon::numeric, 3)::text
        ELSE round(s.lat::numeric, 3)::text || ',' || round(s.lon::numeric, 3)::text
      END AS site_cell
    FROM public.user_sites s
    WHERE s.user_id = p_user_id
  ),
  owned_vehicles AS MATERIALIZED (
    SELECT
      v.id AS vehicle_id,
      upper(trim(concat_ws(' ', v.year::text, v.make, v.model))) AS vehicle_label
    FROM public.vehicles v
    WHERE (v.owner_id = p_user_id OR v.user_id = p_user_id)
      AND upper(coalesce(v.make, '')) <> 'UNRESOLVED'
      AND v.id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
  ),
  raw_orphans AS MATERIALIZED (
    SELECT
      vi.id,
      (vi.taken_at)::date AS sday,
      vi.taken_at,
      vi.latitude,
      vi.longitude,
      vi.image_url,
      vi.auto_suggested_vehicle_id,
      COALESCE(
        (
          SELECT usl.site_cell
          FROM user_site_list usl
          WHERE vi.latitude IS NOT NULL
            AND vi.longitude IS NOT NULL
            AND abs(vi.latitude - usl.lat) <= 0.0025
            AND abs(vi.longitude - usl.lon) <= 0.0025
          ORDER BY (power(vi.latitude - usl.lat, 2) + power(vi.longitude - usl.lon, 2)) ASC
          LIMIT 1
        ),
        CASE
          WHEN vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
            THEN round((round(vi.latitude::numeric / 0.002) * 0.002)::numeric, 3)::text
                 || ',' ||
                 round((round(vi.longitude::numeric / 0.002) * 0.002)::numeric, 3)::text
          ELSE 'no-gps'
        END
      ) AS cell
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND p_user_id = (SELECT auth.uid())
      AND vi.vehicle_id IS NULL
      AND vi.source || '' = 'capture_relay_ios'
      AND vi.taken_at IS NOT NULL
      AND nullif(vi.image_url, '') IS NOT NULL
      AND coalesce(vi.is_sensitive, false) = false
      AND coalesce(vi.is_duplicate, false) = false
      AND coalesce(vi.is_superseded, false) = false
      AND coalesce(vi.vision_gate_status::text, 'pending') NOT IN ('rejected_personal', 'rejected_misattributed')
  ),
  grouped AS MATERIALIZED (
    SELECT
      ro.sday AS session_day,
      ro.cell AS gps_cell,
      count(*) AS photo_count,
      array_agg(ro.id ORDER BY ro.taken_at ASC) AS image_ids,
      (array_agg(ro.image_url ORDER BY ro.taken_at ASC))[1] AS sample_url,
      avg(ro.latitude) AS avg_lat,
      avg(ro.longitude) AS avg_lon,
      mode() WITHIN GROUP (ORDER BY ro.auto_suggested_vehicle_id)
        FILTER (WHERE ro.auto_suggested_vehicle_id IS NOT NULL) AS modal_auto_vehicle_id
    FROM raw_orphans ro
    GROUP BY ro.sday, ro.cell
  ),
  day_attributed AS MATERIALIZED (
    SELECT
      sday,
      vehicle_id,
      vehicle_label,
      sum(cnt)::int AS cnt
    FROM (
      SELECT
        ws.session_date AS sday,
        ws.vehicle_id,
        ov.vehicle_label,
        count(*)::int AS cnt
      FROM public.work_sessions ws
      JOIN owned_vehicles ov ON ov.vehicle_id = ws.vehicle_id
      WHERE ws.user_id = p_user_id
        AND ws.vehicle_id IS NOT NULL
      GROUP BY ws.session_date, ws.vehicle_id, ov.vehicle_label
      UNION ALL
      SELECT
        (vi2.taken_at)::date AS sday,
        vi2.vehicle_id,
        ov.vehicle_label,
        count(*)::int AS cnt
      FROM owned_vehicles ov
      JOIN public.vehicle_images vi2 ON vi2.vehicle_id = ov.vehicle_id
      WHERE vi2.user_id = p_user_id
        AND vi2.taken_at IS NOT NULL
        AND coalesce(vi2.is_superseded, false) = false
      GROUP BY (vi2.taken_at)::date, vi2.vehicle_id, ov.vehicle_label
    ) x
    GROUP BY sday, vehicle_id, vehicle_label
  )
  SELECT
    g.session_day,
    g.gps_cell,
    g.photo_count,
    g.image_ids,
    g.sample_url,
    COALESCE(ov_auto.vehicle_id, da_best.vehicle_id) AS suggested_vehicle_id,
    COALESCE(ov_auto.vehicle_label, da_best.vehicle_label) AS suggested_vehicle_label
  FROM grouped g
  LEFT JOIN owned_vehicles ov_auto ON ov_auto.vehicle_id = g.modal_auto_vehicle_id
  LEFT JOIN LATERAL (
    SELECT da.vehicle_id, da.vehicle_label
    FROM day_attributed da
    WHERE da.sday = g.session_day
    ORDER BY da.cnt DESC
    LIMIT 1
  ) da_best ON true
  ORDER BY g.session_day DESC, g.photo_count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.org_vehicle_contact(p_org_id uuid, p_at timestamp with time zone DEFAULT now(), p_radius_m double precision DEFAULT 150, p_max_links integer DEFAULT 2000)
 RETURNS TABLE(vehicle_id uuid, last_at timestamp with time zone, hours_24h integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH here AS (
    SELECT ol.latitude::float8 AS lat, ol.longitude::float8 AS lon
    FROM organization_locations ol
    WHERE ol.organization_id = p_org_id
      AND ol.latitude IS NOT NULL
      AND ol.longitude IS NOT NULL
    UNION
    SELECT o.latitude::float8 AS lat, o.longitude::float8 AS lon
    FROM organizations o
    WHERE o.id = p_org_id
      AND o.latitude IS NOT NULL
      AND o.longitude IS NOT NULL
  ),
  links AS (
    SELECT DISTINCT l.vehicle_id
    FROM (
      SELECT ov.vehicle_id
      FROM organization_vehicles ov
      WHERE ov.organization_id = p_org_id
        AND coalesce(ov.user_rejected, false) = false
        AND ov.vehicle_id <> '14447ecd-293e-4203-9045-90102559c904'::uuid
      ORDER BY ov.created_at DESC
      LIMIT p_max_links
    ) l
  ),
  photos AS (
    SELECT l.vehicle_id, vi.taken_at AS at
    FROM links l
    JOIN LATERAL (
      SELECT x.taken_at, x.latitude::float8 AS lat, x.longitude::float8 AS lon
      FROM vehicle_images x
      WHERE x.vehicle_id = l.vehicle_id
        AND x.taken_at IS NOT NULL
        AND x.taken_at <= p_at
        AND coalesce(x.is_superseded, false) = false
      ORDER BY x.taken_at DESC
      LIMIT 50
    ) vi ON true
    WHERE vi.lat IS NOT NULL
      AND vi.lon IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM here h
        WHERE st_distancesphere(st_makepoint(h.lon, h.lat), st_makepoint(vi.lon, vi.lat)) <= p_radius_m
      )
  ),
  events AS (
    SELECT te.vehicle_id, (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' AS at
    FROM timeline_events te
    WHERE te.organization_id = p_org_id
      AND te.vehicle_id IS NOT NULL
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
    UNION ALL
    SELECT cw.vehicle_id, (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' AS at
    FROM contractor_work_contributions cw
    WHERE cw.organization_id = p_org_id
      AND cw.vehicle_id IS NOT NULL
      AND (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
  )
  SELECT
    e.vehicle_id,
    max(e.at) AS last_at,
    count(DISTINCT date_trunc('hour', e.at)) FILTER (WHERE e.at > p_at - interval '24 hours')::int AS hours_24h
  FROM (SELECT * FROM photos UNION ALL SELECT * FROM events) e
  GROUP BY e.vehicle_id
$function$;

CREATE OR REPLACE FUNCTION public.relation_weight(p_last timestamp with time zone, p_at timestamp with time zone DEFAULT now(), p_half_life interval DEFAULT '06:00:00'::interval)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_last IS NULL OR p_at IS NULL OR p_last > p_at THEN 0::double precision
    WHEN extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life) > 50 THEN 0::double precision
    ELSE power(2::double precision, -extract(epoch FROM (p_at - p_last)) / extract(epoch FROM p_half_life))
  END
$function$;

CREATE OR REPLACE FUNCTION public.user_org_relations(p_user_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH m AS (
    SELECT oc.organization_id, oc.role, oc.status, oc.start_date, oc.end_date, b.business_name, b.business_type
    FROM organization_contributors oc
    LEFT JOIN businesses b ON b.id = oc.organization_id
    WHERE oc.user_id = p_user_id
  ),
  photos AS (
    SELECT m.organization_id, sp.vehicle_id, sp.taken_at, sp.shared_with, sp.vehicle_linked
    FROM m, LATERAL org_site_photos(m.organization_id, p_user_id, p_at - interval '10 years', p_at) sp
  ),
  ev AS (
    SELECT organization_id, 'site_photo'::text AS source, taken_at AS at
    FROM photos
    WHERE shared_with = 0 OR vehicle_linked OR vehicle_id IS NULL
    UNION ALL
    SELECT oi.organization_id, 'org_image', coalesce(oi.taken_at, oi.created_at)
    FROM organization_images oi
    JOIN m USING (organization_id)
    WHERE oi.user_id = p_user_id
      AND coalesce(oi.taken_at, oi.created_at) <= p_at
    UNION ALL
    SELECT te.organization_id, 'timeline_event', (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC'
    FROM timeline_events te
    JOIN m USING (organization_id)
    WHERE te.user_id = p_user_id
      AND (te.event_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
    UNION ALL
    SELECT cw.organization_id, 'work', (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC'
    FROM contractor_work_contributions cw
    JOIN m USING (organization_id)
    WHERE cw.contractor_user_id = p_user_id
      AND (cw.work_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC' <= p_at
  ),
  per_source AS (
    SELECT organization_id, jsonb_object_agg(source, last_at) AS last_by_source
    FROM (SELECT organization_id, source, max(at) AS last_at FROM ev GROUP BY 1, 2) s
    GROUP BY organization_id
  ),
  per_org AS (
    SELECT
      ev.organization_id,
      max(ev.at) AS last_at,
      count(DISTINCT date_trunc('hour', ev.at)) FILTER (WHERE ev.at > p_at - interval '24 hours') AS hours_24h,
      ps.last_by_source
    FROM ev
    JOIN per_source ps USING (organization_id)
    GROUP BY ev.organization_id, ps.last_by_source
  ),
  unresolved AS (
    SELECT organization_id, count(*) AS n
    FROM photos
    WHERE shared_with > 0
      AND vehicle_id IS NOT NULL
      AND NOT vehicle_linked
      AND taken_at > p_at - interval '24 hours'
    GROUP BY organization_id
  ),
  rel AS (
    SELECT
      m.*,
      p.last_at,
      coalesce(p.hours_24h, 0) AS hours_24h,
      coalesce(p.last_by_source, '{}'::jsonb) AS last_by_source,
      coalesce(u.n, 0) AS unresolved_24h,
      relation_weight(p.last_at, p_at) AS weight
    FROM m
    LEFT JOIN per_org p USING (organization_id)
    LEFT JOIN unresolved u USING (organization_id)
  )
  SELECT jsonb_build_object(
    'as_of', p_at,
    'half_life_hours', 6,
    'dormant_below', 0.0625,
    'window_hours', 48,
    'relations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'organization_id', r.organization_id,
        'name', r.business_name,
        'type', r.business_type,
        'role', r.role,
        'membership_status', r.status,
        'start_date', r.start_date,
        'end_date', r.end_date,
        'relation', jsonb_build_object(
          'weight', r.weight,
          'state', relation_state(r.weight),
          'last_contribution_at', r.last_at,
          'contributions_24h', r.hours_24h,
          'last_by_source', r.last_by_source,
          'unresolved_shared_site_photos_24h', r.unresolved_24h))
        ORDER BY r.weight DESC, r.last_at DESC NULLS LAST, r.start_date DESC NULLS LAST)
      FROM rel r), '[]'::jsonb))
$function$;

REVOKE ALL ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.bulk_add_to_image_set(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_image_set(jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.bulk_add_to_image_set(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_image_set(uuid, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_work_sessions_bulk(uuid[], boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_work_sessions_bulk(uuid[], boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_work_sessions_bulk(uuid[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_org_page(uuid, timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_org_page(uuid, timestamp with time zone, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_page(uuid, timestamp with time zone, integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_orphan_sessions(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orphan_sessions(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.org_vehicle_contact(uuid, timestamp with time zone, double precision, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_vehicle_contact(uuid, timestamp with time zone, double precision, integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_vehicle_contact(uuid, timestamp with time zone, double precision, integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.relation_weight(timestamp with time zone, timestamp with time zone, interval) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relation_weight(timestamp with time zone, timestamp with time zone, interval) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.relation_weight(timestamp with time zone, timestamp with time zone, interval) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_org_relations(uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_org_relations(uuid, timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_org_relations(uuid, timestamp with time zone) TO anon, authenticated, service_role;

COMMIT;
