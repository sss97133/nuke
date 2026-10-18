-- Extend the existing album owner with immutable, private PhotoKit source captures.
-- Human membership is retained even when a photo has no cloud image. Independent
-- original-byte witnesses qualify links; they never assign a physical vehicle.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.image_sets
  ADD COLUMN source_contract text,
  ADD COLUMN source_capture_id uuid,
  ADD COLUMN source_predecessor_id uuid REFERENCES public.image_sets(id),
  ADD COLUMN source_observed_at timestamptz;
ALTER TABLE public.image_sets ADD CONSTRAINT image_sets_native_source_shape CHECK (
  source_contract IS NULL OR (
    source_contract='photokit_album_v1' AND source_capture_id IS NOT NULL
    AND source_observed_at IS NOT NULL AND isfinite(source_observed_at)
    AND vehicle_id IS NULL AND is_personal IS TRUE AND created_by=user_id
    AND user_id IS NOT NULL AND metadata->>'source_contract'='photokit_album_v1') IS TRUE);
CREATE UNIQUE INDEX image_sets_native_capture_key ON public.image_sets(user_id,source_capture_id)
  WHERE source_contract='photokit_album_v1';
CREATE UNIQUE INDEX image_sets_native_successor_key ON public.image_sets(source_predecessor_id)
  WHERE source_contract='photokit_album_v1' AND source_predecessor_id IS NOT NULL;

CREATE POLICY native_album_private_read ON public.image_sets AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (
    source_contract IS DISTINCT FROM 'photokit_album_v1' OR user_id=auth.uid());

CREATE FUNCTION public.guard_native_album_capture()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_contract='photokit_album_v1' AND (
      auth.uid() IS DISTINCT FROM NEW.user_id OR auth.role() IS DISTINCT FROM 'authenticated'
      OR current_user::regrole::oid IS DISTINCT FROM
        (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.bulk_add_to_image_set(jsonb,jsonb)'::regprocedure)) THEN
      RAISE EXCEPTION 'native source capture requires its account-scoped writer' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.source_contract='photokit_album_v1' OR NEW.source_contract='photokit_album_v1' THEN
    RAISE EXCEPTION 'native album source capture is immutable; append a successor' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_native_album_capture_immutable BEFORE INSERT OR UPDATE ON public.image_sets
FOR EACH ROW EXECUTE FUNCTION public.guard_native_album_capture();

-- Close the old bulk-member door for captured source groups. The member witness
-- must identify a source reference and the same account's actual original bytes.
CREATE FUNCTION public.guard_native_album_member()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE s public.image_sets%ROWTYPE; witness jsonb;
BEGIN
  IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM public.image_sets
    WHERE id=OLD.image_set_id AND source_contract='photokit_album_v1') THEN
    RAISE EXCEPTION 'native source membership witness is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO s FROM public.image_sets WHERE id=NEW.image_set_id;
  IF s.source_contract IS DISTINCT FROM 'photokit_album_v1' THEN RETURN NEW; END IF;
  IF current_user::regrole::oid IS DISTINCT FROM
    (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='public.bulk_add_to_image_set(jsonb,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'native source member requires its account-scoped writer' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'native source membership witness is immutable' USING ERRCODE='23514';
  END IF;
  BEGIN witness:=NEW.notes::jsonb;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'native source byte witness required' USING ERRCODE='23514'; END;
  IF jsonb_typeof(witness) IS DISTINCT FROM 'object'
    OR witness->>'contract' IS DISTINCT FROM 'native_album_byte_witness_v1'
    OR NEW.added_by IS DISTINCT FROM s.user_id
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.metadata->'capture'->'album'->'photos') p
      WHERE p->>'local_id'=witness->>'local_id'
        AND p->>'source_version' IS NOT NULL
        AND p->>'source_version'=witness->>'source_version')
    OR coalesce(witness->>'input_sha256','') !~ '^[a-f0-9]{64}$'
    OR NULLIF(witness->>'method_version','') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id=NEW.image_id AND i.user_id=s.user_id
      AND i.exif_data->>'uuid'=witness->>'local_id' AND i.file_hash=witness->>'input_sha256'
      AND NULLIF(i.image_url,'') IS NOT NULL AND i.is_document IS NOT TRUE
      AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE
      AND coalesce(i.vision_gate_status::text,'approved')='approved') THEN
    RAISE EXCEPTION 'native member must match an eligible same-account original-byte witness' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_native_album_member BEFORE INSERT OR UPDATE ON public.image_set_members
FOR EACH ROW EXECUTE FUNCTION public.guard_native_album_member();

-- An overload of the existing album writer; the legacy signature is unchanged.
-- Replaying an old request never rolls the current pointer back. A new source
-- state names its last acknowledged predecessor, so delayed intake cannot win.
CREATE FUNCTION public.bulk_add_to_image_set(p_native_album jsonb, p_readings jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
  actor uuid:=auth.uid(); request_key uuid; previous_key uuid; installation uuid;
  observed timestamptz; album jsonb; old public.image_sets%ROWTYPE;
  current_set uuid; current_capture uuid; result uuid; map_key text;
  reading jsonb; image_key uuid; image_count integer; linked integer; reason text;
  receipts jsonb:='[]'::jsonb; witness jsonb;
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
    INSERT INTO public.image_sets(user_id,created_by,vehicle_id,is_personal,name,source_contract,
      source_capture_id,source_predecessor_id,source_observed_at,metadata)
    VALUES(actor,actor,NULL,true,coalesce(album->>'name','Untitled Photos album'),'photokit_album_v1',
      request_key,current_set,observed,jsonb_build_object('source_contract','photokit_album_v1','capture',p_native_album,
      'intake_account_id',actor,'source_observer','photokit','album_author','unknown',
      'physical_vehicle_identity','unresolved')) RETURNING id INTO result;
    INSERT INTO public.album_sync_map(user_id,apple_album_id,apple_album_name,image_set_id,vehicle_id,
      photo_count_apple,photo_count_nuke,sync_direction,last_synced_at)
    VALUES(actor,map_key,coalesce(album->>'name','Untitled Photos album'),result,NULL,
      jsonb_array_length(album->'photos'),0,'apple_to_nuke',now())
    ON CONFLICT(user_id,apple_album_id) DO UPDATE SET image_set_id=EXCLUDED.image_set_id,
      apple_album_name=EXCLUDED.apple_album_name,vehicle_id=NULL,photo_count_apple=EXCLUDED.photo_count_apple,
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
  -- A replay can add qualified links, but cannot make a historical snapshot current.
  UPDATE public.album_sync_map SET photo_count_nuke=linked WHERE user_id=actor
    AND apple_album_id=map_key AND image_set_id=result;
  RETURN jsonb_build_object('status','retained','image_set_id',result,'capture_id',request_key,
    'is_current',result=current_set,'source_count',jsonb_array_length(album->'photos'),
    'linked_count',linked,'unlinked_count',jsonb_array_length(album->'photos')-linked,'readings',receipts);
END $fn$;
REVOKE ALL ON FUNCTION public.bulk_add_to_image_set(jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_image_set(jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.bulk_add_to_image_set(jsonb,jsonb) IS
  'Private immutable PhotoKit album source capture and byte-qualified context links. Actual account auth only; explicit predecessor; source membership survives missing uploads. No vehicle identity, ownership, performer or photographer inference.';
COMMENT ON COLUMN public.image_sets.source_predecessor_id IS 'Typed predecessor for an immutable source grouping capture; separate from derived work-session lineage.';
COMMENT ON COLUMN public.image_sets.source_observed_at IS 'App-observed source grouping clock, not photo capture time or album creation time.';
COMMENT ON COLUMN public.image_sets.source_capture_id IS 'Account-scoped stable source request key; replays preserve content and never roll a current pointer back.';
COMMENT ON COLUMN public.image_sets.source_contract IS 'NULL for legacy albums; photokit_album_v1 for private native source grouping captures.';
NOTIFY pgrst,'reload schema';
COMMIT;
