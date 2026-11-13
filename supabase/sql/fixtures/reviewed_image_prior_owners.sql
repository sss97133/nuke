-- Prior live owner definitions read 2026-11-09. Functions only; no owner/source rows.
-- Fixture baseline for the guarded migration and its real trigger/selection consumers.

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
END $function$
;

CREATE OR REPLACE FUNCTION public.image_hero_score(meta jsonb, fsize bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a jsonb := meta->'byok_deep_analysis';
  s numeric := 0;
  framing text; az numeric; dist numeric;
BEGIN
  IF a IS NULL THEN RETURN 0; END IF;
  framing := coalesce(a->'camera_pose'->>'framing','');
  BEGIN az := nullif(a->'camera_pose'->>'azimuth_deg','')::numeric; EXCEPTION WHEN others THEN az := NULL; END;
  BEGIN dist := nullif(regexp_replace(coalesce(a->'camera_pose'->>'distance_est',''),'[^0-9.]','','g'),'')::numeric; EXCEPTION WHEN others THEN dist := NULL; END;

  -- what the frame is OF: a whole-vehicle exterior is the hero material
  s := s + CASE a->>'scene_type'
             WHEN 'body_exterior' THEN 1.5
             WHEN 'body_interior' THEN 0.3
             ELSE 0 END;
  -- the car as a finished, whole object
  s := s + CASE WHEN a->'state_observations'->>'completeness' = 'assembled' THEN 0.5 ELSE 0 END;
  s := s + CASE WHEN a->>'build_phase_guess' IN ('final_assembly','drivable','show_finish') THEN 0.5 ELSE 0 END;
  -- framed as a whole car, not a close-up
  s := s + CASE WHEN dist BETWEEN 2 AND 4 THEN 1.0
                WHEN dist BETWEEN 1.5 AND 5 THEN 0.5
                ELSE 0.15 END;
  -- three-quarter/profile angle reads best; head-on/rear-flat less so
  IF az IS NOT NULL THEN
    s := s + (1 - least(least(abs(az-45), least(abs(az-135), least(abs(az-225), abs(az-315)))), 90) / 90.0) * 0.8;
  END IF;
  -- framing language: reward whole-car shots, punish crops / orientation problems / clutter
  s := s + CASE WHEN framing ~* '(profile|three-quarter|3/4|full)' THEN 0.4 ELSE 0 END;
  s := s + CASE WHEN framing ~* '(rotated|window|cowl|windshield|roof and rear|decklid|opening|macro|close)' THEN -0.7 ELSE 0 END;
  s := s + CASE WHEN framing ~* '(dog|tools|packaging|clutter)' THEN -0.3 ELSE 0 END;
  -- people in a hero shot are a distraction
  s := s + CASE WHEN a->'presence'->>'person' = 'true' THEN -1.0 ELSE 0 END;
  -- small nudges: analyst confidence + resolution proxy
  BEGIN s := s + coalesce((a->>'confidence')::numeric, 0) * 0.3; EXCEPTION WHEN others THEN NULL; END;
  s := s + coalesce(fsize, 0) / 1.0e7;
  RETURN s;
END $function$
;

CREATE OR REPLACE FUNCTION public.capture_relay_hint_guard_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare h jsonb; v record; conf numeric; why text;
begin
  h := NEW.ai_scan_metadata->'classification'->'vehicle_hints';
  if h is null or jsonb_typeof(h) <> 'object' then return NEW; end if;
  select make, model into v from public.vehicles where id = NEW.vehicle_id;
  if not found then return NEW; end if;
  conf := coalesce((NEW.ai_scan_metadata->'classification'->>'confidence')::numeric, 0);
  why := public.vehicle_hint_contradiction(h->>'make', h->>'model', v.make, v.model, conf);
  if why is null then return NEW; end if;
  insert into public.image_vehicle_mismatches(image_id,current_vehicle_id,detected_vehicle,expected_vehicle,validation_status,confidence_score,mismatch_reason,mismatch_source,resolved,resolved_at,resolution_action,resolution_notes)
  values (NEW.id, NEW.vehicle_id, jsonb_build_object('make',h->>'make','model',h->>'model','year_range',h->>'year_range'), jsonb_build_object('make',v.make,'model',v.model), 'mismatch', round(conf*100), 'capture_relay_hint_guard: '||why, 'ai_validation', true, now(), 'removed_from_vehicle', 'auto-unfiled (vehicle_id was default/unconfirmed); previous vehicle_id='||NEW.vehicle_id);
  NEW.vehicle_id := null;
  return NEW;
end; $function$
;

CREATE OR REPLACE FUNCTION public.capture_upload_status_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.capture_upload_status_upsert(NEW, case when TG_OP = 'UPDATE' then OLD.ai_processing_status else null end, TG_OP);
  exception when others then
    raise warning 'capture_upload_status_fn failed for %: %', NEW.id, sqlerrm;
  end;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_single_primary_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- If setting this image as primary, clear all other primary flags for this vehicle
    IF NEW.is_primary = true THEN
        UPDATE vehicle_images 
        SET is_primary = false 
        WHERE vehicle_id = NEW.vehicle_id 
        AND id != NEW.id 
        AND is_primary = true;
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.photo_land_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.photo_land_classification(NEW.id);
  return null;
exception when others then
  raise warning 'photo_land_trigger failed for %: %', NEW.id, sqlerrm;
  return null;
end;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.track_user_image_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Most statements touch only rows with no user (scrapers); they return here. Measured on a local PG17 fixture:
  -- 500 one-row UPDATEs took 7 ms with no trigger and with this check, 76 ms when the queries below ran every time.
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE user_id IS NOT NULL) THEN RETURN NULL; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT EXISTS (SELECT 1 FROM new_rows WHERE user_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM old_rows WHERE user_id IS NOT NULL) THEN RETURN NULL; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM old_rows WHERE user_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT n.user_id,
           (coalesce(n.taken_at, n.created_at) AT TIME ZONE 'UTC')::date,
           (n.created_at AT TIME ZONE 'UTC')::date,
           count(*),
           count(*) FILTER (WHERE n.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios'),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status = 'analyzed'),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status IN ('pending','processing','queued')),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.vehicle_id IS NOT NULL),
           count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.taken_at IS NOT NULL)
    FROM new_rows n
    WHERE n.user_id IS NOT NULL
    GROUP BY 1, 2, 3;

    INSERT INTO public.user_image_deep_reads AS d (image_id, user_id, updated_at)
    SELECT n.id, n.user_id, n.updated_at
    FROM new_rows n
    WHERE n.user_id IS NOT NULL AND n.is_superseded IS NOT TRUE AND n.ai_scan_metadata ? 'byok_deep_analysis'
    ON CONFLICT (image_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT c.user_id, c.taken_day, c.created_day, sum(c.n_all), sum(c.n_owned), sum(c.n_capture),
           sum(c.n_capture_analyzed), sum(c.n_capture_pending), sum(c.n_capture_filed), sum(c.n_capture_taken)
    FROM (
      SELECT n.user_id,
             (coalesce(n.taken_at, n.created_at) AT TIME ZONE 'UTC')::date AS taken_day,
             (n.created_at AT TIME ZONE 'UTC')::date AS created_day,
             count(*) AS n_all,
             count(*) FILTER (WHERE n.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')) AS n_owned,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios') AS n_capture,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status = 'analyzed') AS n_capture_analyzed,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.ai_processing_status IN ('pending','processing','queued')) AS n_capture_pending,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.vehicle_id IS NOT NULL) AS n_capture_filed,
             count(*) FILTER (WHERE n.source = 'capture_relay_ios' AND n.taken_at IS NOT NULL) AS n_capture_taken
      FROM new_rows n WHERE n.user_id IS NOT NULL GROUP BY 1, 2, 3
      UNION ALL
      SELECT o.user_id,
             (coalesce(o.taken_at, o.created_at) AT TIME ZONE 'UTC')::date,
             (o.created_at AT TIME ZONE 'UTC')::date,
             -count(*),
             -count(*) FILTER (WHERE o.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios'),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status = 'analyzed'),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status IN ('pending','processing','queued')),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.vehicle_id IS NOT NULL),
             -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.taken_at IS NOT NULL)
      FROM old_rows o WHERE o.user_id IS NOT NULL GROUP BY 1, 2, 3
    ) c
    GROUP BY 1, 2, 3
    HAVING sum(c.n_all) <> 0 OR sum(c.n_owned) <> 0 OR sum(c.n_capture) <> 0 OR sum(c.n_capture_analyzed) <> 0
        OR sum(c.n_capture_pending) <> 0 OR sum(c.n_capture_filed) <> 0 OR sum(c.n_capture_taken) <> 0;

    INSERT INTO public.user_image_deep_reads AS d (image_id, user_id, updated_at)
    SELECT n.id, n.user_id, n.updated_at
    FROM new_rows n
    WHERE n.user_id IS NOT NULL AND n.is_superseded IS NOT TRUE AND n.ai_scan_metadata ? 'byok_deep_analysis'
    ON CONFLICT (image_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at;

    DELETE FROM public.user_image_deep_reads d
    USING new_rows n
    WHERE d.image_id = n.id
      AND (n.user_id IS NULL OR n.is_superseded IS TRUE OR NOT coalesce(n.ai_scan_metadata ? 'byok_deep_analysis', false));

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.user_image_counts (user_id, taken_day, created_day, n_all, n_owned, n_capture,
      n_capture_analyzed, n_capture_pending, n_capture_filed, n_capture_taken)
    SELECT o.user_id,
           (coalesce(o.taken_at, o.created_at) AT TIME ZONE 'UTC')::date,
           (o.created_at AT TIME ZONE 'UTC')::date,
           -count(*),
           -count(*) FILTER (WHERE o.source NOT IN ('bat_import','bat_listing','external_import','organization_import','scraper','scraped')),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios'),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status = 'analyzed'),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.ai_processing_status IN ('pending','processing','queued')),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.vehicle_id IS NOT NULL),
           -count(*) FILTER (WHERE o.source = 'capture_relay_ios' AND o.taken_at IS NOT NULL)
    FROM old_rows o
    WHERE o.user_id IS NOT NULL
    GROUP BY 1, 2, 3;

    DELETE FROM public.user_image_deep_reads d USING old_rows o WHERE d.image_id = o.id;
  END IF;
  RETURN NULL;
END
$function$
;

CREATE OR REPLACE FUNCTION public.capture_upload_status_upsert(p_row vehicle_images, p_old_status text, p_op text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text := coalesce(p_row.ai_processing_status, 'pending');
  v_cls jsonb := p_row.ai_scan_metadata -> 'classification';
  v_rcpt jsonb := p_row.ai_scan_metadata -> 'classification' -> 'classifier_receipt';
  v_flag boolean := coalesce(p_row.ai_scan_metadata ->> 'classifier_failed', 'false') = 'true';
  v_stage text;
  v_step text;
  v_detail jsonb := '{}'::jsonb;
  v_stepdetail jsonb := '{}'::jsonb;
  v_type text;
  v_conf numeric;
  v_err text;
  v_http integer;
  v_fname text;
  v_old public.capture_upload_status%rowtype;
  v_have boolean;
begin
  if p_row.user_id is null then return; end if;
  if v_status = 'failed' or (v_status in ('completed','complete','done') and v_flag) then
    v_stage := 'failed';
  elsif v_status in ('completed','complete','done') then
    v_stage := case when p_row.vehicle_id is not null then 'attached' else 'classified' end;
  elsif v_status in ('processing','in_progress','running','classifying','started') then
    v_stage := 'classifying';
  else
    v_stage := 'uploaded';
  end if;

  select * into v_old from public.capture_upload_status where image_id = p_row.id;
  v_have := found;
  if v_stage = 'uploaded' and v_have and v_old.stage = 'classifying' and p_op = 'UPDATE' and p_old_status is not distinct from p_row.ai_processing_status then
    v_stage := 'classifying';
  end if;

  v_fname := coalesce(nullif(p_row.file_name,''), nullif(p_row.filename,''), nullif(regexp_replace(coalesce(p_row.storage_path,''), '^.*/', ''), ''));

  if v_stage = 'failed' then
    v_err := coalesce(v_rcpt ->> 'error_class', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'error_class', 'unknown');
    v_http := nullif(coalesce(v_rcpt ->> 'http_status', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'http_status'), '')::integer;
    v_detail := jsonb_strip_nulls(jsonb_build_object('error_class', v_err, 'http_status', v_http, 'failure_phase', coalesce(v_rcpt ->> 'failure_phase', p_row.ai_scan_metadata -> 'photo_pipeline' -> 'receipt' ->> 'failure_phase'), 'model', v_rcpt ->> 'model'));
    v_step := 'failed'; v_stepdetail := v_detail;
  elsif v_stage in ('classified','attached') then
    v_type := coalesce(v_cls ->> 'image_type', p_row.image_type);
    v_conf := coalesce(nullif(v_cls ->> 'confidence','')::numeric, p_row.ai_avg_confidence, p_row.ai_detected_angle_confidence);
    v_detail := jsonb_strip_nulls(jsonb_build_object('image_type', v_type, 'confidence', v_conf, 'description', v_cls ->> 'description', 'angle', p_row.ai_detected_angle, 'is_document', p_row.is_document, 'vehicle_id', p_row.vehicle_id));
    v_step := 'done'; v_stepdetail := v_detail;
  elsif v_stage = 'classifying' then
    v_step := 'classifying';
  else
    v_step := 'queued';
  end if;

  if not v_have then
    insert into public.capture_upload_status (image_id, user_id, vehicle_id, attached, filename, storage_path, stage, stage_detail, error_class, http_status, image_type, confidence, current_step, step_detail, step_updated_at, created_at, updated_at)
    values (p_row.id, p_row.user_id, p_row.vehicle_id, p_row.vehicle_id is not null, v_fname, p_row.storage_path, v_stage, v_detail, v_err, v_http, v_type, v_conf, v_step, v_stepdetail, now(), coalesce(p_row.created_at, now()), now())
    on conflict (image_id) do nothing;
    insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_row.id, p_row.user_id, v_step, v_stepdetail, 'trigger');
  elsif (v_old.stage, v_old.vehicle_id, v_old.stage_detail, v_old.filename) is distinct from (v_stage, p_row.vehicle_id, v_detail, v_fname) then
    if v_old.stage is distinct from v_stage then
      if v_stage = 'classifying' and v_old.current_step in ('downloading','reading_text','extracting_fields','matching_vehicle') then
        v_step := v_old.current_step; v_stepdetail := v_old.step_detail;
      end if;
    else
      v_step := v_old.current_step; v_stepdetail := v_old.step_detail;
    end if;
    update public.capture_upload_status set
      vehicle_id = p_row.vehicle_id, attached = p_row.vehicle_id is not null, filename = v_fname, storage_path = p_row.storage_path,
      stage = v_stage, stage_detail = v_detail, error_class = v_err, http_status = v_http, image_type = v_type, confidence = v_conf,
      current_step = v_step, step_detail = v_stepdetail,
      step_updated_at = case when v_step is distinct from v_old.current_step or v_stepdetail is distinct from v_old.step_detail then now() else step_updated_at end,
      updated_at = now()
    where image_id = p_row.id;
    if v_step is distinct from v_old.current_step then
      insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_row.id, p_row.user_id, v_step, v_stepdetail, 'trigger');
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  vi record; cls jsonb; x jsonb; pv text; conf numeric; descr text; vid uuid;
  n_desc int := 0; n_f int := 0; n_t int := 0; n_fe int := 0; n_ang int := 0; n_cam int := 0; rc int;
  ang_key text; ang_id uuid; pose jsonb; byok jsonb; dist numeric; az numeric; el numeric; res jsonb; dq text; pl jsonb;
begin
  select v.id, v.user_id, v.vehicle_id, v.vision_gate_status::text as gate, v.ai_scan_metadata as md
    into vi from public.vehicle_images v where v.id = p_image_id and v.ai_processing_status = 'completed';
  if not found then return jsonb_build_object('skipped', 'not_completed'); end if;
  vid := case when vi.vehicle_id is not null and coalesce(vi.gate, '') not like 'rejected%' then vi.vehicle_id end;
  cls := vi.md->'classification';
  if cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
    x := case when jsonb_typeof(cls->'v2') = 'object' then cls->'v2' else '{}'::jsonb end;
    pv := coalesce(x->>'prompt_version', cls#>>'{classifier_receipt,prompt_version}', 'legacy');
    conf := least(greatest(coalesce(nullif(cls->>'confidence','')::numeric, 0), 0), 1);
    descr := nullif(btrim(coalesce(cls->>'description', '')), '');

    if descr is not null and not exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2') then
      insert into public.image_descriptions(image_id, vehicle_id, description, description_type, source, source_version, confidence, evidence)
      values (p_image_id, vid, descr, 'classifier_v2', 'photo-pipeline-classifier', pv, conf,
              jsonb_build_object('photo_id', p_image_id, 'image_type', cls->>'image_type', 'is_automotive', cls->'is_automotive', 'model', cls#>>'{classifier_receipt,model}'));
      n_desc := 1;
    end if;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select distinct on (s.fn) p_image_id, vi.user_id, vid, s.fn, s.val, s.qt, s.cf, 'classifier_v2', pv, s.meta
    from (
      select e->>'field_name' fn, nullif(btrim(e->>'value'), '') val, nullif(e->>'evidence','') qt,
             least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf, jsonb_build_object('photo_id', p_image_id) meta
        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
      union all
      select 'vin', nullif(btrim(x#>>'{vin,value}'), ''), nullif(x#>>'{vin,evidence}',''),
             least(greatest(nullif(x#>>'{vin,confidence}','')::numeric, 0), 1),
             jsonb_build_object('photo_id', p_image_id, 'checksum_ok', x#>'{vin,checksum_ok}')
        where jsonb_typeof(x->'vin') = 'object'
    ) s where s.fn is not null and s.val is not null
    order by s.fn, s.cf desc nulls last
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
    select p_image_id, vi.user_id, vid, c.fn, c.val, c.qt, c.cf, 'classifier_v2', pv, jsonb_build_object('photo_id', p_image_id)
    from (values
      ('core.image_type', cls->>'image_type', left(descr, 300), conf),
      ('core.is_automotive', cls->>'is_automotive', left(descr, 300), conf),
      ('core.classifier_confidence', cls->>'confidence', null, conf),
      ('core.description', descr, descr, conf),
      ('doc.type', nullif(x->>'document_type', ''), left(descr, 300), conf),
      ('doc.kind', nullif(x->>'document_kind', ''), left(descr, 300), conf)
    ) c(fn, val, qt, cf) where c.val is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_f := n_f + rc;

    insert into public.photo_text_lines(image_id, user_id, vehicle_id, line_idx, text, region, confidence, source, prompt_version)
    select p_image_id, vi.user_id, vid, (t.ord - 1)::int, btrim(t.e->>'text'),
           case when t.e ? 'region' then t.e->'region' end,
           least(greatest(nullif(t.e->>'confidence','')::numeric, 0), 1), 'classifier_v2', pv
    from jsonb_array_elements(case when jsonb_typeof(x->'text_lines') = 'array' then x->'text_lines' else '[]'::jsonb end) with ordinality t(e, ord)
    where nullif(btrim(coalesce(t.e->>'text', '')), '') is not null
    on conflict do nothing;
    get diagnostics rc = row_count; n_t := rc;

    if vid is not null then
      insert into public.field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
      select vid, s.fn, s.val, 'ai_visual', round(s.cf * 100)::int, left('photo-pipeline landing v1: ' || s.qt, 400),
             jsonb_build_object('photo_id', p_image_id, 'image_id', p_image_id, 'quote', s.qt, 'confidence', s.cf, 'extractor', 'photo_land_classification', 'prompt_version', pv)
      from (
        select distinct on (fn, val) e->>'field_name' fn, btrim(e->>'value') val, e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
          from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
         order by fn, val
      ) s
      where s.cf >= 0.6 and nullif(s.qt, '') is not null and nullif(s.val, '') is not null and s.fn is not null
        -- plate stamping codes are identifiers, not attributes; other-vehicle / non-body readings are not evidence about this car
        and not exists (select 1 from public.photo_plate_code_kind(s.qt))
        and public.photo_field_not_about_vehicle(s.fn, s.val, s.qt, descr) is null
      on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing;
      get diagnostics rc = row_count; n_fe := rc;

      begin
        select jsonb_agg(jsonb_build_object('kind', k.kind, 'value', k.code, 'quote', left(k.qt, 400), 'confidence', k.cf)) into pl
        from (select distinct on (pk.kind, pk.code) pk.kind, pk.code, s2.qt, s2.cf
                from (select e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
                        from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e) s2
                cross join lateral public.photo_plate_code_kind(s2.qt) pk
               where s2.cf >= 0.6
               order by pk.kind, pk.code) k;
        if pl is not null then
          perform public.land_identifier_claims(vid, jsonb_build_object('identifiers', pl), null, 'photo_land_classification', 'photo', p_image_id, null);
          update public.vehicle_identifiers set evidence_class = 'plate_stamping'
           where vehicle_id = vid and source_image_id = p_image_id and kind like 'plate\_%' and evidence_class is null;
        end if;
      exception when others then null;
      end;

      ang_key := case x#>>'{angle,value}'
        when 'exterior_front' then 'exterior.front.center'
        when 'exterior_rear' then 'exterior.rear.center'
        when 'interior_dashboard' then 'interior.dash.full'
        when 'engine_bay' then 'engine.bay'
        when 'undercarriage' then 'undercarriage.general'
        when 'detail_shot' then 'detail.general'
        else null end;
      if ang_key is not null and not exists (select 1 from public.image_angle_observations o where o.image_id = p_image_id and o.source = 'classifier_v2') then
        select a.angle_id into ang_id from public.angle_taxonomy a where a.canonical_key = ang_key and a.deprecated_at is null limit 1;
        if ang_id is not null then
          insert into public.image_angle_observations(image_id, vehicle_id, angle_id, confidence, source, source_version, evidence)
          values (p_image_id, vid, ang_id, least(greatest(coalesce(nullif(x#>>'{angle,confidence}','')::numeric, conf), 0), 1), 'classifier_v2', pv,
                  jsonb_build_object('photo_id', p_image_id, 'classifier_angle', x#>>'{angle,value}', 'quote', left(descr, 300)));
          n_ang := 1;
        end if;
      end if;
    end if;
  end if;

  byok := vi.md->'byok_deep_analysis';
  if byok is not null and jsonb_typeof(byok->'camera_pose') = 'object' then
    pose := byok->'camera_pose';
    az := case when (pose->>'azimuth_deg') ~ '^-?[0-9.]+$' then (pose->>'azimuth_deg')::numeric end;
    el := case when (pose->>'elevation_deg') ~ '^-?[0-9.]+$' then (pose->>'elevation_deg')::numeric end;
    dq := pose->>'distance_est';
    dist := case when dq ~* '^[~ ]*[0-9.]+ ?m$' then round((regexp_replace(dq, '[^0-9.]', '', 'g'))::numeric * 1000) end;
    if (az is not null or el is not null) then
      insert into public.image_camera_position(image_id, vehicle_id, subject_key, azimuth_deg, elevation_deg, distance_mm, confidence, source, source_version, evidence)
      values (p_image_id, vid, 'vehicle', az, el, dist,
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis', coalesce(byok->>'prompt_version', 'unknown'),
              jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id'))
      on conflict (image_id, subject_key, source, source_version) do nothing;
      get diagnostics rc = row_count; n_cam := rc;
    end if;
  end if;

  res := jsonb_build_object('descriptions', n_desc, 'fields', n_f, 'text_lines', n_t, 'field_evidence', n_fe, 'angles', n_ang, 'camera', n_cam);
  insert into public.photo_land_progress(image_id, result) values (p_image_id, res)
    on conflict (image_id) do update set landed_at = now(), result = excluded.result;
  return res;
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.project_observation_image_witness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '5s'
AS $projection$
DECLARE
  image_reference text;
  image_key uuid;
  image_vehicle uuid;
BEGIN
  -- Exact legacy share-verdict path is not authenticated testimony promotion.
  IF NEW.kind::text = 'comment'
     AND NEW.structured_data->>'kind_detail' = 'professional_review'
     AND EXISTS (SELECT 1 FROM public.observation_sources s
                 WHERE s.id = NEW.source_id AND s.slug = 'shop') THEN
    RETURN NEW;
  END IF;
  image_reference := NEW.structured_data->>'image_id';
  IF image_reference IS NULL OR lower(btrim(image_reference)) = 'unknown' THEN
    RETURN NEW;
  END IF;
  IF image_reference !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observation_image_reference_invalid';
  END IF;
  image_key := image_reference::uuid;
  -- FOR SHARE prevents a concurrent non-key vehicle reassignment while this
  -- same-vehicle relation is checked and appended. One image row, fixed cost.
  SELECT i.vehicle_id INTO image_vehicle FROM public.vehicle_images i
    WHERE i.id = image_key FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'observation_image_reference_missing';
  END IF;
  IF NEW.vehicle_id IS NULL OR image_vehicle IS NULL OR NEW.vehicle_id <> image_vehicle THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observation_image_vehicle_mismatch';
  END IF;
  INSERT INTO public.observation_witnesses (
    observation_id, image_id, witness_role, capture_method, image_timestamp,
    attestation_notes, added_by_user_id, added_by_agent_key
  ) VALUES (
    NEW.id, image_key, 'derived', 'unknown', NULL,
    'Derived from structured_data.image_id by the observation log insert projection; no assertion of visual correctness, independent source, capture method or capture time.',
    NEW.submitted_by_user_id,
    CASE WHEN NEW.submitted_by_user_id IS NULL THEN 'db:project_observation_image_witness:v1' END
  ) ON CONFLICT (observation_id, image_id, witness_role) DO NOTHING;
  RETURN NEW;
END
$projection$;
