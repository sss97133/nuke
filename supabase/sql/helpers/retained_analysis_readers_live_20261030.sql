-- Exact retained-state dependencies read from live owners,2026-10-30.
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
$function$
;
CREATE OR REPLACE FUNCTION public.compute_auction_readiness(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v RECORD; ne RECORD;
  d_identity smallint := 0; d_photo smallint := 0; d_doc smallint := 0;
  d_desc smallint := 0; d_market smallint := 0; d_condition smallint := 0;
  composite numeric; tier text;
  gaps jsonb := '[]'::jsonb; coaching jsonb := '[]'::jsonb;
  cnt int; signal_cnt int;
  photo_zones_present text[] := '{}'; photo_zones_missing text[] := '{}';
  mvps_complete boolean := false; penalties jsonb := '[]'::jsonb;
  mvps_result RECORD;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'vehicle_not_found'); END IF;

  -- DIM 1: IDENTITY (0.15)
  IF v.year IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing year','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.make IS NOT NULL AND length(v.make) > 0 THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing make','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.model IS NOT NULL AND length(v.model) > 0 THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','Missing model','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.vin IS NOT NULL AND length(v.vin) >= 11 THEN d_identity := d_identity + 20;
  ELSIF v.vin IS NOT NULL AND length(v.vin) > 0 THEN d_identity := d_identity + 10; gaps := gaps || jsonb_build_object('dimension','identity','gap','Partial VIN','points',10,'action','DATA_SUPPLY');
  ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No VIN','points',20,'action','DATA_SUPPLY'); END IF;
  IF v.title IS NOT NULL AND length(v.title) > 10 THEN d_identity := d_identity + 10; END IF;
  IF v.color IS NOT NULL THEN d_identity := d_identity + 5; END IF;
  IF v.interior_color IS NOT NULL THEN d_identity := d_identity + 5; END IF;
  IF v.engine_type IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No engine info','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.transmission IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No transmission info','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.mileage IS NOT NULL THEN d_identity := d_identity + 10; ELSE gaps := gaps || jsonb_build_object('dimension','identity','gap','No mileage','points',10,'action','DATA_SUPPLY'); END IF;
  d_identity := LEAST(d_identity, 100);

  -- DIM 2: PHOTO (0.20)
  SELECT count(*) INTO cnt FROM vehicle_images WHERE vehicle_id = p_vehicle_id AND (ai_processing_status IS NULL OR ai_processing_status != 'failed');
  IF cnt = 0 THEN d_photo := 0; gaps := gaps || jsonb_build_object('dimension','photo','gap','No photos','points',100,'action','PHOTO_UPLOAD','coaching_prompt','Start with exterior 3/4 front view in good light');
  ELSIF cnt < 5 THEN d_photo := 15; gaps := gaps || jsonb_build_object('dimension','photo','gap','Only '||cnt||' photos','points',60,'action','PHOTO_UPLOAD');
  ELSIF cnt < 20 THEN d_photo := 35; gaps := gaps || jsonb_build_object('dimension','photo','gap',cnt||' photos — 40+ is competitive','points',30,'action','PHOTO_UPLOAD');
  ELSIF cnt < 40 THEN d_photo := 55; ELSIF cnt < 80 THEN d_photo := 75; ELSE d_photo := 90; END IF;

  -- Collect actual zones present
  SELECT array_agg(DISTINCT vehicle_zone) INTO photo_zones_present
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id AND vi.vehicle_zone IS NOT NULL;
  photo_zones_present := COALESCE(photo_zones_present, '{}');

  -- MVPS check using proper zone alias mapping
  SELECT * INTO mvps_result FROM check_mvps_zone_coverage(photo_zones_present);
  mvps_complete := mvps_result.mvps_complete;
  photo_zones_missing := mvps_result.zones_missing;

  IF mvps_complete THEN d_photo := GREATEST(d_photo, 70); END IF;
  IF array_length(photo_zones_present, 1) IS NOT NULL AND array_length(photo_zones_present, 1) >= 12 THEN d_photo := GREATEST(d_photo, 85); END IF;

  -- Add gap for each missing MVPS zone
  IF NOT mvps_complete AND array_length(photo_zones_missing, 1) > 0 THEN
    FOR cnt IN 1..LEAST(array_length(photo_zones_missing, 1), 3) LOOP
      gaps := gaps || jsonb_build_object(
        'dimension', 'photo',
        'gap', 'Missing required zone: ' || photo_zones_missing[cnt],
        'points', 8,
        'action', 'PHOTO_UPLOAD'
      );
    END LOOP;
  END IF;

  d_photo := LEAST(d_photo, 100);

  -- DIM 3: DOCS (0.15)
  SELECT count(*) INTO cnt FROM vehicle_documents WHERE vehicle_id = p_vehicle_id;
  IF cnt = 0 THEN d_doc := 5; gaps := gaps || jsonb_build_object('dimension','doc','gap','No documents uploaded','points',60,'action','DOC_UPLOAD');
  ELSIF cnt < 3 THEN d_doc := 25; ELSIF cnt < 6 THEN d_doc := 50; ELSE d_doc := 70; END IF;
  SELECT count(*) INTO cnt FROM timeline_events WHERE vehicle_id = p_vehicle_id AND event_type IN ('service','maintenance','repair');
  IF cnt = 0 THEN gaps := gaps || jsonb_build_object('dimension','doc','gap','No maintenance history','points',30,'action','DATA_SUPPLY');
  ELSIF cnt < 5 THEN d_doc := d_doc + 10; ELSE d_doc := d_doc + 25; END IF;
  -- Title status bonus
  IF v.title_status IS NOT NULL AND length(v.title_status) > 0 THEN
    d_doc := d_doc + 15;
    IF lower(v.title_status) = 'clean' THEN d_doc := d_doc + 5; END IF;
  ELSE
    gaps := gaps || jsonb_build_object('dimension','doc','gap','Title status unknown','points',15,'action','DATA_SUPPLY');
  END IF;
  d_doc := LEAST(d_doc, 100);

  -- DIM 4: DESCRIPTION (0.10)
  IF v.description IS NOT NULL AND length(v.description) > 500 THEN d_desc := 40;
  ELSIF v.description IS NOT NULL AND length(v.description) > 100 THEN d_desc := 20; gaps := gaps || jsonb_build_object('dimension','desc','gap','Description under 500 chars','points',20,'action','NARRATIVE_WRITE');
  ELSE d_desc := 5; gaps := gaps || jsonb_build_object('dimension','desc','gap','No or very short description','points',35,'action','NARRATIVE_WRITE'); END IF;
  IF v.highlights IS NOT NULL AND length(v.highlights) > 2 THEN d_desc := d_desc + 15; ELSE gaps := gaps || jsonb_build_object('dimension','desc','gap','No highlights listed','points',15,'action','DATA_SUPPLY'); END IF;
  IF v.known_flaws IS NOT NULL AND length(v.known_flaws) > 2 THEN d_desc := d_desc + 10; ELSE gaps := gaps || jsonb_build_object('dimension','desc','gap','Known flaws not disclosed','points',10,'action','DATA_SUPPLY'); END IF;
  IF v.equipment IS NOT NULL AND length(v.equipment) > 2 THEN d_desc := d_desc + 10; END IF;
  IF v.modifications IS NOT NULL AND length(v.modifications) > 2 THEN d_desc := d_desc + 10; END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'comment';
  IF cnt >= 20 THEN d_desc := d_desc + 15; ELSIF cnt >= 5 THEN d_desc := d_desc + 8; END IF;
  d_desc := LEAST(d_desc, 100);

  -- DIM 5: MARKET (0.20)
  SELECT * INTO ne FROM nuke_estimates WHERE vehicle_id = p_vehicle_id ORDER BY calculated_at DESC LIMIT 1;
  IF ne.estimated_value IS NOT NULL THEN d_market := d_market + 10;
    IF ne.confidence_score >= 50 THEN d_market := d_market + 10; END IF;
    IF ne.confidence_score >= 70 THEN d_market := d_market + 5; END IF;
  ELSE gaps := gaps || jsonb_build_object('dimension','market','gap','No Nuke Estimate','points',25,'action','VERIFY_CLAIM'); END IF;
  IF ne.input_count IS NOT NULL THEN
    IF ne.input_count >= 3 THEN d_market := d_market + 15; END IF;
    IF ne.input_count >= 5 THEN d_market := d_market + 5; END IF; END IF;
  IF coalesce(v.heat_score, ne.heat_score) IS NOT NULL AND coalesce(v.heat_score, ne.heat_score) > 50 THEN d_market := d_market + 5; END IF;
  IF coalesce(v.deal_score, ne.deal_score) IS NOT NULL AND coalesce(v.deal_score, ne.deal_score) > 50 THEN d_market := d_market + 5; END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'listing'
    AND (content_text ILIKE '%no sale%' OR content_text ILIKE '%withdrawn%' OR content_text ILIKE '%reserve not met%');
  IF cnt = 0 THEN d_market := d_market + 10; ELSE d_market := d_market + 3; END IF;
  IF v.sale_price IS NOT NULL OR v.sold_price IS NOT NULL OR v.canonical_sold_price IS NOT NULL THEN d_market := d_market + 10; END IF;
  IF v.price_confidence IS NOT NULL AND v.price_confidence = 'high' THEN d_market := d_market + 5; END IF;
  -- Count only signals a widget produced. A failed run is stored as a placeholder row (severity info, no score, value_json holding
  -- only the error); it is not an analysis and does not count: score IS NULL AND value_json ? 'error'.
  SELECT count(*) INTO signal_cnt FROM analysis_signals WHERE vehicle_id = p_vehicle_id AND severity IN ('ok', 'info')
    AND NOT (score IS NULL AND value_json ? 'error');
  IF signal_cnt >= 3 THEN d_market := d_market + 5; END IF;
  IF signal_cnt >= 6 THEN d_market := d_market + 5; END IF;
  d_market := LEAST(d_market, 100);

  -- DIM 6: CONDITION (0.20)
  IF v.condition_rating IS NOT NULL THEN d_condition := LEAST((v.condition_rating * 10)::smallint, 80);
    IF v.condition_rating >= 8 THEN d_condition := d_condition + 10; END IF;
  ELSE d_condition := 5; gaps := gaps || jsonb_build_object('dimension','condition','gap','No condition rating','points',70,'action','DATA_SUPPLY'); END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'condition';
  IF cnt > 0 THEN d_condition := GREATEST(d_condition, 50); d_condition := d_condition + 10; END IF;
  IF v.ownership_verified THEN d_condition := d_condition + 10; END IF;
  d_condition := LEAST(d_condition, 100);

  -- COMPOSITE
  composite := round(d_identity*0.15 + d_photo*0.20 + d_doc*0.15 + d_desc*0.10 + d_market*0.20 + d_condition*0.20);
  composite := LEAST(composite, 100);
  IF composite >= 85 THEN tier := 'TIER_1_EXCEPTIONAL';
  ELSIF composite >= 70 THEN tier := 'TIER_2_COMPETITIVE';
  ELSIF composite >= 50 THEN tier := 'TIER_3_VIABLE';
  ELSIF composite >= 30 THEN tier := 'TIER_4_INCOMPLETE';
  ELSE tier := 'DISCOVERY_ONLY'; END IF;

  SELECT jsonb_agg(g ORDER BY (g->>'points')::int DESC) INTO coaching FROM jsonb_array_elements(gaps) AS g;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'composite_score', composite::smallint, 'tier', tier,
    'identity_score', d_identity, 'photo_score', d_photo, 'doc_score', d_doc,
    'desc_score', d_desc, 'market_score', d_market, 'condition_score', d_condition,
    'top_gaps', COALESCE(coaching,'[]'::jsonb), 'coaching_plan', COALESCE(coaching,'[]'::jsonb),
    'photo_zones_present', to_jsonb(photo_zones_present), 'photo_zones_missing', to_jsonb(photo_zones_missing),
    'mvps_complete', mvps_complete, 'rejection_penalties', penalties
  );
END;
$function$
;

