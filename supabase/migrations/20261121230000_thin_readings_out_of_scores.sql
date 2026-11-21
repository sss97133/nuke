-- Automatic photo readings stay out of scores and evidence.
--
-- Why. A photo read automatically is stored as a 'condition' observation under the tier 'subscription automatic'
-- (needs_clarification true, one sentence that names it automatic). It states nothing a reviewer checked. Five
-- readers counted it, or showed it, as if it were a reviewed condition observation. Each change below is one predicate
-- line in the live body of the function; nothing else in any body changes.
--  1. compute_auction_readiness(uuid): the condition presence test (floor of 50 and the +10) ignores automatic-tier rows
--     and superseded rows. recompute_ars_dimension stores that whole result, so the stored condition score follows.
--  2. get_user_day_receipt(uuid,date): the per-photo reading lateral ignores superseded and automatic-tier rows, so the
--     day viewer's narrative, analyzed_by and analyzed_at come from a reviewed reading or from none.
--  3. visual_work_uncited_keyed_photos(uuid,jsonb): the keyed-value CTE ignores automatic-tier rows, so a thin keyed value
--     is not a claim a work record must cite (this backs the visual-work insert guard and the gate report).
--  4. actor_link_evidence_items(uuid,uuid) and actor_link_claim_evidence_read(uuid): the frames lateral ignores
--     automatic-tier rows, so a thin reading is not a 'corroborating' evidence item.
-- Each reader calls the tier helper image_reading_tier_is_automatic(text). A row with no tier (a legacy reading) and a
-- row under a reviewed tier still count everywhere. A missing 'image_reading_tiers' config row means nothing is
-- automatic, so nothing is hidden.
-- Observation counts are not changed here, because the count metric counts every attached row and a tier filter cannot
-- be answered from the index.
-- Not changed here either: image_stage_coverage(uuid) (a separate decision on its sub-counts).
-- Each body below is production's live body of 2026-11-21 with the predicate lines marked (20261121230000); signatures, return
-- types, volatility, SECURITY setting, SET clauses, owner and grants are unchanged (CREATE OR REPLACE keeps owner and grants).
-- The migration refuses unless each live body is the one it was written from (md5 of prosrc) or already this one, so a body
-- changed in between is never overwritten. The repository's latest definition is then the one production runs
-- (scripts/ci/function-drift-check.mjs).
-- Contract: supabase/sql/test_thin_readings_out_of_scores.sql
-- Revert: supabase/sql/revert_20261121230000_thin_readings_out_of_scores.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $do$
declare
  r record;
  v_md5 text;
begin
  if to_regprocedure('public.image_reading_tier_is_automatic(text)') is null then
    raise exception 'image_reading_tier_is_automatic(text) is not live (20261120140000 must be applied first)';
  end if;
  for r in select * from (values
      ('public.compute_auction_readiness(uuid)', '19ee0abbfe2d3de7ee225c5df90acc67', '2a2a4c3a2b9f6d9cf2f7f6087030241e'),
      ('public.get_user_day_receipt(uuid,date)', 'cf19cf335b9d08fddc47f6329e203a0e', 'da8b99c06758ca0da01b10e37ac4b287'),
      ('public.visual_work_uncited_keyed_photos(uuid,jsonb)', '9bd9bf992a8b97f8a03dd6e26183a4bd', 'a24c91a7d581e8b07bde8287f56b8990'),
      ('public.actor_link_evidence_items(uuid,uuid)', 'cad427c36ad728e4e72f7da892c043ef', 'a54d40ff87799efaa1e028ed40cd281b'),
      ('public.actor_link_claim_evidence_read(uuid)', '20007b3f1fde0d6110020aca494c76d2', '6046dc96ab23882d632a5a29748ffbf4')
    ) as t(fn, was, becomes)
  loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.fn);
    if v_md5 is null then raise exception '% is not live', r.fn; end if;
    if v_md5 not in (r.was, r.becomes) then
      raise exception '% is not the body this migration was written against (md5 %); refusing to replace it', r.fn, v_md5;
    end if;
  end loop;
end $do$;

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
    AND score IS NOT NULL AND NOT(value_json ? 'error')
    AND coalesce(value_json->>'assessment_status','') NOT IN ('not_assessed','unresolved','widget_not_configured');
  IF signal_cnt >= 3 THEN d_market := d_market + 5; END IF;
  IF signal_cnt >= 6 THEN d_market := d_market + 5; END IF;
  d_market := LEAST(d_market, 100);

  -- DIM 6: CONDITION (0.20)
  IF v.condition_rating IS NOT NULL THEN d_condition := LEAST((v.condition_rating * 10)::smallint, 80);
    IF v.condition_rating >= 8 THEN d_condition := d_condition + 10; END IF;
  ELSE d_condition := 5; gaps := gaps || jsonb_build_object('dimension','condition','gap','No condition rating','points',70,'action','DATA_SUPPLY'); END IF;
  SELECT count(*) INTO cnt FROM vehicle_observations WHERE vehicle_id = p_vehicle_id AND kind = 'condition'
    AND is_superseded IS NOT TRUE AND NOT public.image_reading_tier_is_automatic(agent_tier);  -- (20261121230000) a thin reading is not a condition observation
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
$function$;

CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_facets jsonb;
  v_gaps jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at,
           'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''),
           'components', s.components,
           'part_numbers', s.part_numbers,
           'intent', COALESCE(s.confirmed_intent, s.model_intent),
           'intent_confidence', s.intent_confidence,
           'intent_confirmed', s.intent_confirmed,
           'owner_note', s.owner_note,
           'analyzed_by', s.analyzed_by,
           'analyzed_at', s.analyzed_at
         ) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.structured_data->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'components_seen','[]'::jsonb)) c
              WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(t->>'text')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'text_regions','[]'::jsonb)) t
              WHERE t->>'text' IS NOT NULL) AS part_numbers,
           a.structured_data->>'intent' AS model_intent,
           a.structured_data->>'intent_confirmed_value' AS confirmed_intent,
           NULLIF(a.structured_data->>'intent_confidence','')::numeric AS intent_confidence,
           NULLIF(a.structured_data->>'intent_owner_confirmed','')::boolean AS intent_confirmed,
           -- Owner's own words about this frame (latest), surfaced as primary voice.
           -- Prune by vehicle_id FIRST (idx_observations_vehicle_comment_bid) so this
           -- never seq-scans the 7.5M-row observations table — it lands on the handful
           -- of comments for this vehicle, then filters to this image.
           (SELECT oc.content_text
              FROM vehicle_observations oc
              WHERE oc.vehicle_id = vi.vehicle_id
                AND oc.kind = 'comment'
                AND oc.structured_data->>'analysis_kind' = 'owner_comment'
                AND oc.structured_data->>'image_id' = vi.id::text
              ORDER BY oc.observed_at DESC
              LIMIT 1) AS owner_note,
           a.agent_model AS analyzed_by,
           a.ingested_at AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
      SELECT o.structured_data, o.agent_model, o.ingested_at
      FROM vehicle_observations o
      WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
        AND o.structured_data->>'image_id' = vi.id::text
        AND o.is_superseded IS NOT TRUE
        AND NOT public.image_reading_tier_is_automatic(o.agent_tier)  -- (20261121230000) a thin reading is not shown as the photo's reading
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_image_gallery_eligible IS TRUE AND vi.is_sensitive IS NOT TRUE
        AND vi.is_document IS NOT TRUE AND vi.doc_flag IS NOT TRUE AND EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=vi.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL)))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END,
           'session_type', ws.session_type
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date
    AND (v_is_owner OR EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=ws.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL));

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  -- 20261029090000: gaps over 60 minutes between this user's consecutive photos that day (the same rows the photo
  -- list reads, without its 60-row cap), each with the owner testimony session that covers it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'start', g.prev_at, 'end', g.taken_at,
           'minutes', floor(extract(epoch FROM g.taken_at - g.prev_at) / 60)::integer,
           'vehicle_id', CASE WHEN g.prev_vehicle_id = g.vehicle_id THEN g.vehicle_id END,
           'before_image_id', g.prev_id, 'after_image_id', g.id,
           'testimony_id', t.id) ORDER BY g.prev_at), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT vi.id, vi.vehicle_id, vi.taken_at,
           lag(vi.id) OVER w AS prev_id, lag(vi.vehicle_id) OVER w AS prev_vehicle_id, lag(vi.taken_at) OVER w AS prev_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_image_gallery_eligible IS TRUE AND vi.is_sensitive IS NOT TRUE
        AND vi.is_document IS NOT TRUE AND vi.doc_flag IS NOT TRUE AND EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=vi.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL)))
      AND v_is_owner
    WINDOW w AS (ORDER BY vi.taken_at, vi.id)
  ) g
  LEFT JOIN LATERAL (
    SELECT ws.id FROM work_sessions ws
    WHERE ws.user_id = p_user_id AND ws.session_date = p_date AND ws.session_type = 'owner_testimony'
      AND tstzrange(ws.start_time, ws.end_time) && tstzrange(g.prev_at, g.taken_at)
    ORDER BY ws.start_time, ws.id LIMIT 1
  ) t ON true
  WHERE g.prev_at IS NOT NULL AND g.taken_at - g.prev_at > interval '60 minutes';

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts),
    'gaps', jsonb_array_length(v_gaps)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'gaps', v_gaps,
    'facets', v_facets
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.visual_work_uncited_keyed_photos(p_vehicle_id uuid, p_doc jsonb)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 WITH refs AS (
  SELECT lower(v.ref->>'image_id') AS image_id,
   CASE WHEN jsonb_typeof(v.ref->'keyed_claim_ids')='array' THEN v.ref->'keyed_claim_ids' ELSE '[]'::jsonb END AS cited
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_doc->'visual_sources')='array' THEN p_doc->'visual_sources' ELSE '[]'::jsonb END) v(ref)
  WHERE coalesce(v.ref->>'image_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
 keyed AS (
  SELECT r.image_id,k.id::text AS claim_id
  FROM (SELECT DISTINCT image_id FROM refs) r
  JOIN public.observation_witnesses w ON w.image_id=r.image_id::uuid
  JOIN public.vehicle_observations k ON k.id=w.observation_id
  WHERE k.vehicle_id=p_vehicle_id AND k.is_superseded IS NOT TRUE
   AND NOT public.image_reading_tier_is_automatic(k.agent_tier)  -- (20261121230000) a thin keyed value is not a claim a work record must cite
   AND (k.descriptor_id IS NOT NULL OR k.property_id IS NOT NULL))
 SELECT coalesce(array_agg(DISTINCT r.image_id ORDER BY r.image_id),'{}'::text[])
 FROM refs r
 WHERE (jsonb_array_length(r.cited)=0 AND EXISTS(SELECT 1 FROM keyed k WHERE k.image_id=r.image_id))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.cited) c
    WHERE jsonb_typeof(c.value) IS DISTINCT FROM 'string'
     OR NOT EXISTS(SELECT 1 FROM keyed k WHERE k.image_id=r.image_id AND k.claim_id=c.value#>>'{}'));
$function$;

CREATE OR REPLACE FUNCTION public.actor_link_evidence_items(p_user uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE items jsonb;
BEGIN
  IF p_user IS NULL OR p_actor IS NULL THEN RETURN '[]'::jsonb; END IF;
    WITH acts AS (
      SELECT 'component event'::text AS src, ce.id AS src_id, ce.vehicle_id, ce.event_date::date AS d_from, ce.event_date::date AS d_to,
        ce.org_id, ce.evidence_ids
      FROM public.component_events ce WHERE ce.actor_id = p_actor AND ce.vehicle_id IS NOT NULL AND ce.event_date IS NOT NULL
      UNION ALL
      SELECT 'work order operation', li.id, w.vehicle_id,
        COALESCE(lce.event_date::date, COALESCE(w.started_at, w.actual_start, w.created_at)::date),
        COALESCE(lce.event_date::date, COALESCE(w.completed_at, w.actual_end, now())::date),
        w.organization_id, NULL::uuid[]
      FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
      LEFT JOIN public.component_events lce ON lce.id = li.component_event_id
      WHERE li.actor_id = p_actor AND w.vehicle_id IS NOT NULL
    ), sessions AS (
      SELECT DISTINCT ON (s.id) s.id, s.vehicle_id, s.session_date, a.src,
        (a.d_from = a.d_to AND s.session_date = a.d_from) AS direct
      FROM acts a JOIN public.work_sessions s ON s.user_id = p_user AND s.vehicle_id = a.vehicle_id
        AND s.session_date BETWEEN a.d_from AND a.d_to
      ORDER BY s.id, (a.d_from = a.d_to AND s.session_date = a.d_from) DESC
    ), sourced AS (
      SELECT DISTINCT ON (o.id) o.id, o.vehicle_id, o.observed_at::date AS d, x.why FROM (
        SELECT li.source_observation_id AS oid, 'source of an operation attributed to the actor' AS why
          FROM public.work_order_line_items li WHERE li.actor_id = p_actor AND li.source_observation_id IS NOT NULL
        UNION ALL
        SELECT unnest(ce.evidence_ids), 'evidence listed on a component event attributed to the actor'
          FROM public.component_events ce WHERE ce.actor_id = p_actor AND ce.evidence_ids IS NOT NULL) x
      JOIN public.vehicle_observations o ON o.id = x.oid AND o.submitted_by_user_id = p_user AND o.is_superseded IS FALSE
      ORDER BY o.id
    ), frames AS (
      SELECT DISTINCT ON (ob.id) ob.id, img.vehicle_id, img.taken_at::date AS d, a.src
      FROM acts a
      CROSS JOIN LATERAL (SELECT vi.id, vi.vehicle_id, vi.taken_at FROM public.vehicle_images vi
        WHERE vi.vehicle_id = a.vehicle_id AND vi.user_id = p_user AND vi.is_external IS FALSE
          AND vi.taken_at >= a.d_from AND vi.taken_at < a.d_to + 1 ORDER BY vi.taken_at LIMIT 200) img
      CROSS JOIN LATERAL (SELECT o.id FROM public.vehicle_observations o
        WHERE (o.structured_data->>'image_id') = img.id::text AND (o.structured_data->>'analysis_kind') = 'image_deep_byok'
          AND o.is_superseded IS FALSE
          AND NOT public.image_reading_tier_is_automatic(o.agent_tier)  -- (20261121230000) a thin reading is not corroboration
          LIMIT 5) ob
      ORDER BY ob.id
    ), orgs AS (
      SELECT DISTINCT oc.organization_id, org.business_name, org.name
      FROM acts a JOIN public.organizations org ON org.id = a.org_id AND org.is_verified IS TRUE
      JOIN public.organization_contributors oc ON oc.organization_id = org.id AND oc.user_id = p_user AND oc.status = 'active'
    ), all_items AS (
      SELECT 'work_session' AS kind, s.id AS row_id, s.vehicle_id, s.session_date AS d,
        'your work session on the vehicle of a ' || s.src || ' attributed to the actor, '
          || CASE WHEN s.direct THEN 'on the same day' ELSE 'within the work order window' END AS why,
        CASE WHEN s.direct THEN 'direct' ELSE 'corroborating' END AS strength, jsonb_build_array('work_evidence') AS approvable_for
      FROM sessions s
      UNION ALL
      SELECT 'observation', o.id, o.vehicle_id, o.d, 'an observation you submitted: ' || o.why, 'direct', jsonb_build_array('authenticated_sign')
      FROM sourced o
      UNION ALL
      SELECT 'observation', f.id, f.vehicle_id, f.d, 'analysis of your photo of the vehicle during a ' || f.src || ' attributed to the actor',
        'corroborating', '[]'::jsonb FROM frames f
      UNION ALL
      SELECT 'org_membership', g.organization_id, NULL::uuid, NULL::date,
        'you are an active member of verified organization ' || COALESCE(g.business_name, g.name, 'unnamed') || ', which the actor worked for',
        'corroborating', '[]'::jsonb FROM orgs g
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'row_id', i.row_id,
        'vehicle_label', (SELECT NULLIF(concat_ws(' ', v.year, v.make, v.model), '') FROM public.vehicles v WHERE v.id = i.vehicle_id),
        'date', i.d, 'why', i.why, 'strength', i.strength, 'approvable_for', i.approvable_for)
      ORDER BY CASE i.strength WHEN 'direct' THEN 0 ELSE 1 END, i.kind, i.d DESC NULLS LAST, i.row_id), '[]'::jsonb)
      INTO items FROM all_items i;
  RETURN items;
END $function$;

CREATE OR REPLACE FUNCTION public.actor_link_claim_evidence_read(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_service boolean := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  is_admin boolean;
  c record;
  items jsonb;
BEGIN
  SELECT cl.id, cl.user_id, cl.actor_id, cl.status, cl.verification_method, cl.created_at INTO c
    FROM public.account_link_claims cl WHERE cl.id = p_claim_id AND cl.actor_id IS NOT NULL;
  is_admin := uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = uid AND au.is_active);
  IF c.id IS NULL OR NOT (is_service OR is_admin OR (uid IS NOT NULL AND uid = c.user_id)) THEN
    RAISE EXCEPTION 'Claim unavailable';
  END IF;

  WITH acts AS (
    SELECT 'component event'::text AS src, ce.id AS src_id, ce.vehicle_id, ce.event_date::date AS d_from, ce.event_date::date AS d_to,
      ce.org_id, ce.evidence_ids
    FROM public.component_events ce WHERE ce.actor_id = c.actor_id AND ce.vehicle_id IS NOT NULL AND ce.event_date IS NOT NULL
    UNION ALL
    SELECT 'work order operation', li.id, w.vehicle_id,
      COALESCE(lce.event_date::date, COALESCE(w.started_at, w.actual_start, w.created_at)::date),
      COALESCE(lce.event_date::date, COALESCE(w.completed_at, w.actual_end, now())::date),
      w.organization_id, NULL::uuid[]
    FROM public.work_order_line_items li JOIN public.work_orders w ON w.id = li.work_order_id
    LEFT JOIN public.component_events lce ON lce.id = li.component_event_id
    WHERE li.actor_id = c.actor_id AND w.vehicle_id IS NOT NULL
  ), sessions AS (
    SELECT DISTINCT ON (s.id) s.id, s.vehicle_id, s.session_date, a.src,
      (a.d_from = a.d_to AND s.session_date = a.d_from) AS direct
    FROM acts a JOIN public.work_sessions s ON s.user_id = c.user_id AND s.vehicle_id = a.vehicle_id
      AND s.session_date BETWEEN a.d_from AND a.d_to
    ORDER BY s.id, (a.d_from = a.d_to AND s.session_date = a.d_from) DESC
  ), sourced AS (
    SELECT DISTINCT ON (o.id) o.id, o.vehicle_id, o.observed_at::date AS d, x.why FROM (
      SELECT li.source_observation_id AS oid, 'source of an operation attributed to the actor' AS why
        FROM public.work_order_line_items li WHERE li.actor_id = c.actor_id AND li.source_observation_id IS NOT NULL
      UNION ALL
      SELECT unnest(ce.evidence_ids), 'evidence listed on a component event attributed to the actor'
        FROM public.component_events ce WHERE ce.actor_id = c.actor_id AND ce.evidence_ids IS NOT NULL) x
    JOIN public.vehicle_observations o ON o.id = x.oid AND o.submitted_by_user_id = c.user_id AND o.is_superseded IS FALSE
    ORDER BY o.id
  ), frames AS (
    SELECT DISTINCT ON (ob.id) ob.id, img.vehicle_id, img.taken_at::date AS d, a.src
    FROM acts a
    CROSS JOIN LATERAL (SELECT vi.id, vi.vehicle_id, vi.taken_at FROM public.vehicle_images vi
      WHERE vi.vehicle_id = a.vehicle_id AND vi.user_id = c.user_id AND vi.is_external IS FALSE
        AND vi.taken_at >= a.d_from AND vi.taken_at < a.d_to + 1 ORDER BY vi.taken_at LIMIT 200) img
    CROSS JOIN LATERAL (SELECT o.id FROM public.vehicle_observations o
      WHERE (o.structured_data->>'image_id') = img.id::text AND (o.structured_data->>'analysis_kind') = 'image_deep_byok'
        AND o.is_superseded IS FALSE
        AND NOT public.image_reading_tier_is_automatic(o.agent_tier)  -- (20261121230000) a thin reading is not corroboration
        LIMIT 5) ob
    ORDER BY ob.id
  ), orgs AS (
    SELECT DISTINCT oc.organization_id, org.business_name, org.name
    FROM acts a JOIN public.organizations org ON org.id = a.org_id AND org.is_verified IS TRUE
    JOIN public.organization_contributors oc ON oc.organization_id = org.id AND oc.user_id = c.user_id AND oc.status = 'active'
  ), all_items AS (
    SELECT 'work_session' AS kind, s.id AS row_id, s.vehicle_id, s.session_date AS d,
      'your work session on the vehicle of a ' || s.src || ' attributed to the actor, '
        || CASE WHEN s.direct THEN 'on the same day' ELSE 'within the work order window' END AS why,
      CASE WHEN s.direct THEN 'direct' ELSE 'corroborating' END AS strength, jsonb_build_array('work_evidence') AS approvable_for
    FROM sessions s
    UNION ALL
    SELECT 'observation', o.id, o.vehicle_id, o.d, 'an observation you submitted: ' || o.why, 'direct', jsonb_build_array('authenticated_sign')
    FROM sourced o
    UNION ALL
    SELECT 'observation', f.id, f.vehicle_id, f.d, 'analysis of your photo of the vehicle during a ' || f.src || ' attributed to the actor',
      'corroborating', '[]'::jsonb FROM frames f
    UNION ALL
    SELECT 'org_membership', g.organization_id, NULL::uuid, NULL::date,
      'you are an active member of verified organization ' || COALESCE(g.business_name, g.name, 'unnamed') || ', which the actor worked for',
      'corroborating', '[]'::jsonb FROM orgs g
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'row_id', i.row_id,
      'vehicle_label', (SELECT NULLIF(concat_ws(' ', v.year, v.make, v.model), '') FROM public.vehicles v WHERE v.id = i.vehicle_id),
      'date', i.d, 'why', i.why, 'strength', i.strength, 'approvable_for', i.approvable_for)
    ORDER BY CASE i.strength WHEN 'direct' THEN 0 ELSE 1 END, i.kind, i.d DESC NULLS LAST, i.row_id), '[]'::jsonb)
    INTO items FROM all_items i;

  RETURN jsonb_build_object('as_of', statement_timestamp(),
    'claim', jsonb_build_object('claim_id', c.id, 'actor', public.platform_actor_label(c.actor_id), 'rung', c.verification_method,
      'status', c.status, 'filed_at', c.created_at),
    'viewer', jsonb_build_object('role', CASE WHEN is_service THEN 'service' WHEN is_admin THEN 'admin' ELSE 'claimant' END),
    'items', items,
    'counts', jsonb_build_object('total', jsonb_array_length(items),
      'direct', (SELECT count(*) FROM jsonb_array_elements(items) e WHERE e->>'strength' = 'direct'),
      'corroborating', (SELECT count(*) FROM jsonb_array_elements(items) e WHERE e->>'strength' = 'corroborating'),
      'by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT e->>'kind' k, count(*) n FROM jsonb_array_elements(items) e GROUP BY 1) x), '{}'::jsonb)),
    'approval', jsonb_build_object('writer', 'approve_actor_link_claim', 'access', 'service role with a distinct active admin reviewer',
      'work_evidence_needs', 'at least one work_session item', 'auto_approved', false),
    'not_assessed', jsonb_build_array('whether the claimant is the person who did the work (reviewer judgement)',
      'who appears in photos', 'name, phone or e-mail similarity (never used)', 'photos beyond 200 per operation'));
END $function$;

do $do$
declare
  r record;
  v_md5 text;
begin
  for r in select * from (values
      ('public.compute_auction_readiness(uuid)', '2a2a4c3a2b9f6d9cf2f7f6087030241e'),
      ('public.get_user_day_receipt(uuid,date)', 'da8b99c06758ca0da01b10e37ac4b287'),
      ('public.visual_work_uncited_keyed_photos(uuid,jsonb)', 'a24c91a7d581e8b07bde8287f56b8990'),
      ('public.actor_link_evidence_items(uuid,uuid)', 'a54d40ff87799efaa1e028ed40cd281b'),
      ('public.actor_link_claim_evidence_read(uuid)', '6046dc96ab23882d632a5a29748ffbf4')
    ) as t(fn, want)
  loop
    select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.fn);
    if v_md5 is distinct from r.want then
      raise exception '% did not become the body this file names (md5 %)', r.fn, coalesce(v_md5, 'null');
    end if;
  end loop;
end $do$;

commit;
