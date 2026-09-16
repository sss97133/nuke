-- Identity-first image ingestion.
--
-- THE BUG: every ingest path (iOS SupabaseService.uploadPhoto, daily-receipt
-- process-photo-cascade, the iphoto/imessage/work-photos import scripts) writes
-- the LEAF (vehicle_images) FIRST and stamps ownership at insert time
-- (is_external=false, documented_by_user_id=<signer>), before any content
-- identity or endpoint provenance exists. So the content-identity shells
-- image_identities / image_appearances stayed empty (and got marked DROP), and
-- a saved/received photo lands as the user's own documented work.
--
-- THE FIX: one ordered chokepoint -- identity (root) -> appearance (this
-- endpoint's instance) -> classify own-vs-reference from endpoint provenance ->
-- leaf (linked, ownership DERIVED). A user's endpoint is their live photo
-- library (the original lives there, full EXIF); a scrape's endpoint is a URL.
--
-- Refs: docs/architecture/IMAGE_OWNERSHIP_ONTOLOGY.md (trust hierarchy),
-- docs/library/reference/encyclopedia/05-image-as-butterfly-node.md.

-- 1. Un-deprecate the content-identity shells. Their emptiness was the symptom
--    of leaf-before-root, not evidence they were unneeded.
COMMENT ON TABLE public.image_identities IS
  'Content-identity ROOT: one row per unique image content (perceptual phash_hex unique, exact content_hash_sha256). The same picture seen from many endpoints collapses to ONE identity. Written FIRST by ingest_image_identity_first().';
COMMENT ON TABLE public.image_appearances IS
  'Per-endpoint INSTANCE of a content identity (FK image_identity_id). One row per sighting -- user library, scrape URL, received, screenshot -- carrying THIS endpoint''s provenance/trust in source_type + metadata. Written SECOND, before the vehicle_images leaf.';

-- 2. Grow source_type to hold photo-endpoint trust classes. It was locked to an
--    OEM-document vocabulary (it was built for the reference_documents library).
ALTER TABLE public.image_appearances
  DROP CONSTRAINT IF EXISTS image_appearances_source_type_check;
ALTER TABLE public.image_appearances
  ADD CONSTRAINT image_appearances_source_type_check CHECK (
    source_type = ANY (ARRAY[
      -- original photo-endpoint classes (the user's live library = source of originals)
      'camera_capture','direct_upload','local_filesystem',
      -- reference / not-the-user's-work classes
      'received','screenshot','listing_scrape',
      -- pre-existing document-import classes (kept for back-compat)
      'dropbox','google_drive','email_attachment','website','social_media','publication','mcp'
    ])
  );

-- 3. The missing leaf -> root edge. Nullable; NOT VALID skips the 34.5M-row scan
--    (new writes are still checked). Partial index stays tiny (all-NULL today).
ALTER TABLE public.vehicle_images
  ADD COLUMN IF NOT EXISTS image_identity_id uuid;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_images_image_identity_id_fkey') THEN
    ALTER TABLE public.vehicle_images
      ADD CONSTRAINT vehicle_images_image_identity_id_fkey
      FOREIGN KEY (image_identity_id) REFERENCES public.image_identities(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $mig$;
CREATE INDEX IF NOT EXISTS idx_vehicle_images_identity
  ON public.vehicle_images (image_identity_id) WHERE image_identity_id IS NOT NULL;

-- 4. Trigger patch: stop the trigger-layer re-stamp. documented_by_user_id is
--    who did the documented WORK; it must NOT be derived from user_id (the
--    library HOLDER) for reference/external images. Only this one condition is
--    added; legacy behavior (own photos, scraped null-user rows) is unchanged.
CREATE OR REPLACE FUNCTION public.vehicle_images_default_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  resolved uuid;
BEGIN
  resolved := COALESCE(
    NEW.user_id,
    NEW.documented_by_user_id,
    NEW.submitted_by,
    NEW.imported_by,
    NEW.ghost_user_id
    -- auth.uid() REMOVED: scraped images must not inherit the runner's identity
  );

  IF resolved IS NOT NULL THEN
    NEW.user_id := COALESCE(NEW.user_id, resolved);
    -- A reference/external image is in the holder's library but is NOT their
    -- documented work -- do not auto-attribute it to them. (identity-first)
    IF NEW.documented_by_user_id IS NULL AND NOT COALESCE(NEW.is_external, false) THEN
      NEW.documented_by_user_id := resolved;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. The ordered ingestion chokepoint.
CREATE OR REPLACE FUNCTION public.ingest_image_identity_first(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_image_url text;
  v_sha text;
  v_phash_hex text;
  v_source text;
  v_source_type text;
  v_source_identifier text;
  v_owner_verified boolean;
  v_is_own boolean;
  v_is_external boolean;
  v_documented_by uuid;
  v_trust_class text;
  v_trust_score int;
  v_identity_id uuid;
  v_appearance_id uuid;
  v_image_id uuid;
  v_existing uuid;
BEGIN
  -- effective user: a JWT caller can never impersonate another user
  v_uid := COALESCE(auth.uid(), nullif(p_payload->>'user_id','')::uuid);

  v_image_url := nullif(p_payload->>'image_url','');
  IF v_image_url IS NULL THEN
    RAISE EXCEPTION 'ingest_image_identity_first: image_url is required';
  END IF;

  v_sha := nullif(p_payload->>'content_sha256','');
  -- identity key: perceptual first; fall back to exact-hash so phash_hex (NOT
  -- NULL) is always satisfied and callers can adopt before computing a phash.
  v_phash_hex := COALESCE(
    nullif(p_payload->>'phash_hex',''),
    CASE WHEN v_sha IS NOT NULL THEN 'sha256:'||v_sha END
  );
  IF v_phash_hex IS NULL THEN
    RAISE EXCEPTION 'ingest_image_identity_first: need phash_hex or content_sha256';
  END IF;

  v_source            := COALESCE(nullif(p_payload->>'source',''),'user_upload');
  v_source_type       := COALESCE(nullif(p_payload->>'source_type',''),'direct_upload');
  v_source_identifier := nullif(p_payload->>'source_identifier','');
  v_owner_verified    := (p_payload->>'owner_verified')::boolean;

  -- CLASSIFY own-vs-reference + trust from endpoint provenance (pure function of inputs).
  v_is_own := v_source_type IN ('camera_capture','direct_upload','local_filesystem')
              AND COALESCE(v_owner_verified, true);
  v_is_external   := NOT v_is_own;
  v_documented_by := CASE WHEN v_is_own THEN v_uid END;

  v_trust_class := CASE
    WHEN NOT v_is_own AND v_source_type IN ('camera_capture','direct_upload','local_filesystem') THEN 'forwarded'
    WHEN v_source_type = 'camera_capture' THEN 'owner_captured'
    WHEN v_source_type IN ('direct_upload','local_filesystem') THEN 'owner_uploaded'
    WHEN v_source_type IN ('website','social_media','listing_scrape','publication') THEN 'platform_listing'
    WHEN v_source_type = 'mcp' THEN 'agent_submitted'
    WHEN v_source_type IN ('dropbox','google_drive','email_attachment','received') THEN 'forwarded'
    WHEN v_source_type = 'screenshot' THEN 'screenshot'
    ELSE 'unknown' END;
  v_trust_score := CASE v_trust_class
    WHEN 'owner_captured' THEN 85 WHEN 'owner_uploaded' THEN 80
    WHEN 'platform_listing' THEN 70 WHEN 'agent_submitted' THEN 60
    WHEN 'forwarded' THEN 50 WHEN 'screenshot' THEN 40 ELSE 30 END;

  -- STEP 1 (ROOT): content-identity node, UPSERT on phash_hex.
  INSERT INTO image_identities (
    phash_hex, content_hash_sha256, phash,
    first_seen_source, first_seen_path, original_filename, mime_type, file_size_bytes,
    width_px, height_px, exif_data, camera_make, camera_model,
    taken_at, gps_latitude, gps_longitude, photographer_id
  ) VALUES (
    v_phash_hex, v_sha,
    CASE WHEN nullif(p_payload->>'phash_bytes','') IS NOT NULL THEN decode(p_payload->>'phash_bytes','hex') END,
    v_source, p_payload->>'source_path', nullif(p_payload->>'original_filename',''),
    nullif(p_payload->>'mime_type',''), nullif(p_payload->>'file_size_bytes','')::bigint,
    nullif(p_payload->>'width_px','')::int, nullif(p_payload->>'height_px','')::int,
    COALESCE(p_payload->'exif_data','{}'::jsonb),
    nullif(p_payload->>'camera_make',''), nullif(p_payload->>'camera_model',''),
    nullif(p_payload->>'taken_at','')::timestamptz,
    nullif(p_payload->>'gps_latitude','')::numeric, nullif(p_payload->>'gps_longitude','')::numeric,
    CASE WHEN v_is_own THEN v_uid END
  )
  ON CONFLICT (phash_hex) DO UPDATE SET
    observation_count   = image_identities.observation_count + 1,
    content_hash_sha256 = COALESCE(image_identities.content_hash_sha256, EXCLUDED.content_hash_sha256),
    camera_make         = COALESCE(image_identities.camera_make, EXCLUDED.camera_make),
    camera_model        = COALESCE(image_identities.camera_model, EXCLUDED.camera_model),
    taken_at            = COALESCE(image_identities.taken_at, EXCLUDED.taken_at),
    gps_latitude        = COALESCE(image_identities.gps_latitude, EXCLUDED.gps_latitude),
    gps_longitude       = COALESCE(image_identities.gps_longitude, EXCLUDED.gps_longitude),
    photographer_id     = COALESCE(image_identities.photographer_id, EXCLUDED.photographer_id),
    updated_at          = now()
  RETURNING id INTO v_identity_id;

  -- STEP 2 (INSTANCE): this endpoint's appearance, deduped on (identity, type, identifier).
  IF v_source_identifier IS NOT NULL THEN
    SELECT id INTO v_appearance_id FROM image_appearances
     WHERE image_identity_id = v_identity_id
       AND source_type = v_source_type
       AND source_identifier = v_source_identifier
     LIMIT 1;
  END IF;
  IF v_appearance_id IS NULL THEN
    INSERT INTO image_appearances (
      image_identity_id, source_type, source_path, source_filename, source_identifier,
      content_hash, seen_by, metadata
    ) VALUES (
      v_identity_id, v_source_type, p_payload->>'source_path', nullif(p_payload->>'source_filename',''),
      v_source_identifier, v_sha, v_uid,
      jsonb_build_object('trust_class', v_trust_class, 'trust_score', v_trust_score,
                         'is_own', v_is_own, 'channel', v_source)
    ) RETURNING id INTO v_appearance_id;
  END IF;

  -- STEP 3 (LEAF): vehicle_images, linked to the root, ownership DERIVED. Idempotent on (file_hash, source).
  IF v_sha IS NOT NULL THEN
    SELECT id INTO v_existing FROM vehicle_images
     WHERE file_hash = v_sha AND source = v_source LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE vehicle_images
       SET image_identity_id = COALESCE(image_identity_id, v_identity_id)
     WHERE id = v_existing;
    v_image_id := v_existing;
  ELSE
    INSERT INTO vehicle_images (
      image_identity_id, image_url, storage_path, user_id, documented_by_user_id,
      documented_by_device, is_external, source, file_hash, perceptual_hash, phash, dhash,
      vehicle_id, taken_at, latitude, longitude, mime_type, file_size,
      exif_data, ai_scan_metadata, apple_ml_labels, category, image_type
    ) VALUES (
      v_identity_id, v_image_url, nullif(p_payload->>'storage_path',''), v_uid, v_documented_by,
      nullif(p_payload->>'documented_by_device',''), v_is_external, v_source, v_sha,
      v_phash_hex, nullif(p_payload->>'phash_hex',''), nullif(p_payload->>'dhash',''),
      nullif(p_payload->>'vehicle_id','')::uuid,
      nullif(p_payload->>'taken_at','')::timestamptz,
      nullif(p_payload->>'gps_latitude','')::numeric, nullif(p_payload->>'gps_longitude','')::numeric,
      nullif(p_payload->>'mime_type',''), nullif(p_payload->>'file_size_bytes','')::bigint,
      COALESCE(p_payload->'exif_data','{}'::jsonb),
      jsonb_build_object('identity_first', jsonb_build_object(
        'identity_id', v_identity_id, 'appearance_id', v_appearance_id,
        'trust_class', v_trust_class, 'trust_score', v_trust_score, 'is_own', v_is_own)),
      CASE WHEN p_payload ? 'apple_ml_labels'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'apple_ml_labels')) END,
      COALESCE(nullif(p_payload->>'category',''), CASE WHEN v_is_own THEN 'general' ELSE 'reference' END),
      COALESCE(nullif(p_payload->>'image_type',''),'general')
    ) RETURNING id INTO v_image_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'identity_id', v_identity_id,
    'appearance_id', v_appearance_id,
    'image_id', v_image_id,
    'is_own', v_is_own,
    'is_external', v_is_external,
    'documented_by_user_id', v_documented_by,
    'trust_class', v_trust_class,
    'trust_score', v_trust_score,
    'reused_leaf', (v_existing IS NOT NULL)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.ingest_image_identity_first(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.ingest_image_identity_first(jsonb) IS
  'Identity-first image ingestion chokepoint: image_identities (root, UPSERT on phash_hex) -> image_appearances (this endpoint instance) -> vehicle_images (leaf, linked, ownership derived from endpoint provenance). Replaces the leaf-first direct INSERT in iOS uploadPhoto and the import scripts. Payload: image_url(req), phash_hex|content_sha256(req), source, source_type, source_identifier, owner_verified, camera_make/model, taken_at, gps_latitude/longitude, width_px/height_px, mime_type, file_size_bytes, exif_data, apple_ml_labels, vehicle_id, user_id.';
