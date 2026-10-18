-- Exact current projection owners / gallery predicate, read 2026-10-18. No model or network code.
-- Scoring/BaT lookup are inert dependencies: fixtures use no analyzed or listing-pending frames.
ALTER TABLE public.vehicles ADD COLUMN image_count int DEFAULT 0, ADD COLUMN primary_image_url text;
ALTER TABLE public.vehicle_images ADD COLUMN vehicle_zone text, ADD COLUMN image_vehicle_match_status text,
  ADD COLUMN approval_status text, ADD COLUMN verification_status text, ADD COLUMN redaction_level text;
CREATE FUNCTION public.image_hero_score(jsonb,bigint) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.bat_pending_image_has_listing(uuid,jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old text; v_latest timestamptz;
  v_id uuid; v_url text; v_taken timestamptz; v_zone text; v_tier text := 'none';
  c_owner text[] := ARRAY['iphoto','user_upload','capture_relay','capture_relay_ios','daily_receipt',
                          'photo_auto_sync','drop-folder','owner_import','user-submission','owner_submission'];
BEGIN
  SELECT primary_image_url INTO v_old FROM vehicles WHERE id = p_vehicle_id;

  -- Tier 1 (quality-first): highest hero-scored CONFIRMED frame that has analysis.
  -- Best-of-set, burst-deduped by construction, date-independent.
  SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
    AND image_vehicle_match_status = 'confirmed'
    AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
    AND image_url IS NOT NULL AND image_url <> ''
  ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN v_tier := 'hero_score'; END IF;

  -- Tier 2: any CONFIRMED frame (no analysis yet) — latest.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND image_vehicle_match_status = 'confirmed'
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'confirmed_any'; END IF;
  END IF;

  -- Tiers 3-4: no confirmed frames yet — prior behavior, but rank eligible owner frames
  -- by hero score (still excludes mismatch/unrelated) so the cover is the best available,
  -- not merely the newest.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_hero'; END IF;
  END IF;

  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_latest'; END IF;
  END IF;

  -- Tier 5: any approved non-dup image (scraped-only comps).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(is_primary,false) DESC, COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'any_approved'; END IF;
  END IF;

  IF v_id IS NULL THEN
    -- No frame the public may read: a held frame must not stay the cover, so clear it rather than keep it.
    UPDATE vehicle_images SET is_primary = false
     WHERE vehicle_id = p_vehicle_id AND is_primary = true;
    IF FOUND OR v_old IS NOT NULL THEN
      UPDATE vehicles SET primary_image_url = NULL WHERE id = p_vehicle_id AND primary_image_url IS NOT NULL;
      RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS NOT NULL),'reason','no_public_frame','was',left(v_old,40));
    END IF;
    RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',false,'reason','no_candidate','primary',v_old);
  END IF;

  UPDATE vehicle_images SET is_primary=false WHERE vehicle_id=p_vehicle_id AND is_primary=true AND id<>v_id;
  UPDATE vehicle_images SET is_primary=true  WHERE id=v_id AND COALESCE(is_primary,false)=false;
  UPDATE vehicles SET primary_image_url=v_url WHERE id=p_vehicle_id AND primary_image_url IS DISTINCT FROM v_url;

  RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS DISTINCT FROM v_url),
    'tier',v_tier,'chosen_image_id',v_id,'taken_at',v_taken,'zone',v_zone,'was',left(v_old,40),'now',left(v_url,40));
END $function$;
CREATE OR REPLACE FUNCTION public.sync_vehicle_primary_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_vehicle uuid;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  v_vehicle := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  IF v_vehicle IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.is_primary IS NOT DISTINCT FROM OLD.is_primary
     AND NEW.vision_gate_status IS NOT DISTINCT FROM OLD.vision_gate_status
     AND NEW.is_duplicate IS NOT DISTINCT FROM OLD.is_duplicate
     AND NEW.is_superseded IS NOT DISTINCT FROM OLD.is_superseded
     AND NEW.image_vehicle_match_status IS NOT DISTINCT FROM OLD.image_vehicle_match_status
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url
     AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at THEN
    RETURN NEW;
  END IF;

  PERFORM recompute_vehicle_primary_image(v_vehicle);
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id AND OLD.vehicle_id IS NOT NULL THEN
    PERFORM recompute_vehicle_primary_image(OLD.vehicle_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_vehicle_image_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_id uuid;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN
    RETURN NULL;
  END IF;
  v_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  UPDATE vehicles SET image_count = (
    SELECT count(*) FROM vehicle_images
    WHERE vehicle_id = v_id
      AND is_duplicate IS NOT TRUE
      AND is_superseded IS NOT TRUE
  ) WHERE id = v_id;
  RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
          )
          OR (
            -- listing capture: a photo taken from a public web listing by an extractor, never an upload
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END;
$function$;
CREATE TRIGGER trg_vehicle_images_count AFTER DELETE OR UPDATE OF vehicle_id, is_duplicate ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION update_vehicle_image_count();
CREATE TRIGGER trg_sync_vehicle_primary_image AFTER DELETE OR UPDATE OF is_primary, is_duplicate, image_vehicle_match_status, image_url ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_image();

-- Exact current non-PK unique keys. NULL attribution is intentionally outside both predicates.
CREATE UNIQUE INDEX idx_unique_vehicle_file_hash ON public.vehicle_images USING btree (vehicle_id, file_hash) WHERE ((file_hash IS NOT NULL) AND (vehicle_id IS NOT NULL) AND (COALESCE(is_superseded, false) = false));
CREATE UNIQUE INDEX vehicle_images_one_primary_per_vehicle_idx ON public.vehicle_images USING btree (vehicle_id) WHERE ((vehicle_id IS NOT NULL) AND (is_primary = true) AND ((is_document IS NULL) OR (is_document = false)) AND ((is_duplicate IS NULL) OR (is_duplicate = false)));

-- Exact existing INSERT projection owners seed the cached card fields in the same transaction.
CREATE OR REPLACE FUNCTION public.sync_vehicle_primary_image_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- same self-recursion stop as the row trigger
  FOR v IN SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL LOOP
    PERFORM recompute_vehicle_primary_image(v);
  END LOOP;
  RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_vehicle_image_count_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE vehicles v
     SET image_count = (SELECT count(*) FROM vehicle_images i
                         WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE v.id IN (SELECT DISTINCT n.vehicle_id FROM new_rows n WHERE n.vehicle_id IS NOT NULL);
  RETURN NULL;
END;
$function$;
CREATE TRIGGER trg_vehicle_images_count_insert_stmt AFTER INSERT ON public.vehicle_images REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION update_vehicle_image_count_stmt();
CREATE TRIGGER trg_sync_vehicle_primary_image_insert_stmt AFTER INSERT ON public.vehicle_images REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_vehicle_primary_image_stmt();
