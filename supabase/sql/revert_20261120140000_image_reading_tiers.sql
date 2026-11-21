-- Revert of 20261120140000_image_reading_tiers.sql: the guard and the projection go back to the bodies production held on
-- 2026-11-20 (read with pg_get_functiondef before the change; md5 4cce782e45863596f359e44bf1c602a6 and c5d8f9b483490c82c90b23e7fc0cb042), and the two helpers are removed.
-- The config row platform_config 'image_reading_tiers' stays: it is data, nothing reads it once the bodies are restored (the
-- keyed-values migration's own tier test falls back to the literal 'automatic' tier when the row is absent, and reads it when present,
-- the same way), and deleting it would lose any later edit of the tier list. Remove it by hand if wanted:
--   delete from platform_config where config_key = 'image_reading_tiers';
-- Observations a thin reading superseded while the migration was live stay superseded (testimony is never edited back).
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.guard_reviewed_image_analysis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public.vehicle_images%ROWTYPE;
  s jsonb := NEW.extraction_metadata->'reviewed_image';
  v jsonb := NEW.structured_data;
  p jsonb := NEW.extraction_metadata->'reviewer_provenance';
BEGIN
  IF NEW.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1' THEN RETURN NEW; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'review_requires_service_role' USING ERRCODE='42501'; END IF;
  IF NEW.kind::text <> 'condition' OR NEW.analysis_deferred IS DISTINCT FROM true
     OR NEW.extractor_id IS NOT NULL
     OR NEW.is_superseded IS TRUE OR NEW.property_id IS NOT NULL
     OR v->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
     OR v->>'is_inferred' IS DISTINCT FROM 'true'
     OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_images:' || (v->>'image_id')
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE id=NEW.source_id AND slug='photo_pipeline')
     OR NEW.source_identifier IS DISTINCT FROM 'reviewed_image_analysis_v1:' || (v->>'image_id') || ':' || (NEW.extraction_metadata->>'review_hash')
     OR coalesce(NEW.extraction_metadata->>'review_hash','') !~ '^[0-9a-f]{64}$'
     OR coalesce(s->>'reviewed_sha256','') !~ '^[0-9a-f]{64}$'
     OR coalesce(s->>'reviewed_url','') !~ '^https://'
     OR NEW.source_url IS DISTINCT FROM s->>'image_url'
     OR NEW.observed_at IS DISTINCT FROM (s->>'reviewed_at')::timestamptz
     OR NEW.observed_at > now() + interval '5 minutes'
     OR coalesce(NEW.agent_model,'')='' OR NEW.agent_model IS DISTINCT FROM p->>'agent_model'
     OR coalesce(NEW.agent_tier,'')='' OR NEW.agent_tier IS DISTINCT FROM p->>'agent_tier'
     OR coalesce(p->>'extraction_method','')='' OR coalesce(p->>'run_id','')=''
     OR v->>'vehicle_id' IS DISTINCT FROM NEW.vehicle_id::text
     OR jsonb_typeof(v->'camera_pose') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'state_observations') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'components_seen') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v->'workshop_signals') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v->'presence') IS DISTINCT FROM 'object'
     OR coalesce(v->>'scene_type','')='' OR coalesce(v->>'build_phase_guess','')=''
     OR coalesce(v->>'intent','')='' OR jsonb_typeof(v->'confidence') IS DISTINCT FROM 'number'
     OR (v->>'confidence')::numeric NOT BETWEEN 0 AND 1
     OR NEW.confidence_score IS NULL OR NEW.confidence_score NOT BETWEEN 0 AND 0.6
     OR NEW.content_text IS DISTINCT FROM v->>'narrative_one_line' THEN
    RAISE EXCEPTION 'invalid_review_observation' USING ERRCODE='23514';
  END IF;
  SELECT * INTO i FROM public.vehicle_images WHERE id=(v->>'image_id')::uuid FOR SHARE;
  IF NOT FOUND OR i.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR i.image_url IS DISTINCT FROM s->>'image_url'
     OR i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz THEN
    RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
  END IF;
  IF i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE
     OR i.is_document IS TRUE OR i.doc_flag IS TRUE
     OR coalesce(i.vision_gate_status::text,'approved') <> 'approved'
     OR coalesce(i.image_vehicle_match_status,'pending') IN ('mismatch','unrelated') THEN
    RAISE EXCEPTION 'review_source_withdrawn' USING ERRCODE='23514';
  END IF;
  -- The previous complete result survives even for a legacy cache that never
  -- retained an observation pointer. This is a before-image, not owner testimony.
  NEW.extraction_metadata := NEW.extraction_metadata || jsonb_build_object(
    'prior_analysis', i.ai_scan_metadata->'byok_deep_analysis');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_reviewed_image_analysis(p_observation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  i public.vehicle_images%ROWTYPE;
  after_i public.vehicle_images%ROWTYPE;
  s jsonb; p jsonb; a jsonb; cover jsonb; replay boolean;
  placed_id uuid; placed_vehicle uuid; placed_role text; reference_scene boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'review_requires_service_role' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1'
     OR o.extractor_id IS NOT NULL
     OR o.kind::text <> 'condition' OR o.is_superseded IS TRUE OR o.analysis_deferred IS DISTINCT FROM true
     OR o.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
     OR NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE id=o.source_id AND slug='photo_pipeline') THEN
    RAISE EXCEPTION 'review_observation_not_eligible' USING ERRCODE='23514';
  END IF;
  s := o.extraction_metadata->'reviewed_image';
  p := o.extraction_metadata->'reviewer_provenance';
  SELECT * INTO i FROM public.vehicle_images WHERE id=(o.structured_data->>'image_id')::uuid FOR UPDATE;
  IF NOT FOUND OR i.vehicle_id IS DISTINCT FROM o.vehicle_id OR i.image_url IS DISTINCT FROM s->>'image_url'
     OR NOT EXISTS (SELECT 1 FROM public.observation_witnesses w WHERE w.observation_id=o.id AND w.image_id=i.id AND w.witness_role='derived') THEN
    RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
  END IF;
  IF i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE
     OR i.is_document IS TRUE OR i.doc_flag IS TRUE
     OR coalesce(i.vision_gate_status::text,'approved') <> 'approved'
     OR coalesce(i.image_vehicle_match_status,'pending') IN ('mismatch','unrelated') THEN
    RAISE EXCEPTION 'review_source_withdrawn' USING ERRCODE='23514';
  END IF;
  replay := i.ai_scan_metadata->'byok_deep_analysis'->>'observation_id'=o.id::text;
  IF EXISTS(SELECT 1 FROM public.image_observations io WHERE io.image_id=i.id
    AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
    AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=o.id::text
    AND io.confidence_basis#>>'{reviewed_image_analysis_v1,state}'='withdrawn') THEN
    RAISE EXCEPTION 'review_source_previously_withdrawn' USING ERRCODE='23514';
  END IF;
  IF replay IS NOT TRUE THEN
    IF i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz
       OR i.ai_scan_metadata->'byok_deep_analysis' IS DISTINCT FROM o.extraction_metadata->'prior_analysis' THEN
      -- Missing key and JSON null are equivalent only for an absent prior result.
      IF i.updated_at IS DISTINCT FROM (s->>'expected_updated_at')::timestamptz
         OR coalesce(i.ai_scan_metadata->'byok_deep_analysis','null'::jsonb) IS DISTINCT FROM o.extraction_metadata->'prior_analysis' THEN
        RAISE EXCEPTION 'review_source_changed' USING ERRCODE='23514';
      END IF;
    END IF;
    a := o.structured_data - ARRAY['image_id','vehicle_id','analysis_kind','witness_image_id','is_inferred'];
    a := a || jsonb_build_object('analyzed_at',s->>'reviewed_at','prompt_version','reviewed_image_analysis_v1',
      'observation_id',o.id,'source_identifier',o.source_identifier,'vehicle_id',o.vehicle_id,
      'agent_model',o.agent_model,'agent_tier',o.agent_tier,'extraction_method',p->>'extraction_method',
      'run_id',p->>'run_id','agent_duration_ms',p->'agent_duration_ms',
      'agent_cost_cents',p->'agent_cost_cents','cost_basis',p->>'cost_basis');
    UPDATE public.vehicle_images SET ai_scan_metadata=coalesce(ai_scan_metadata,'{}'::jsonb) || jsonb_build_object('byok_deep_analysis',a)
      WHERE id=i.id AND vehicle_id=o.vehicle_id AND image_url=s->>'image_url'
        AND updated_at=(s->>'expected_updated_at')::timestamptz RETURNING * INTO after_i;
    IF NOT FOUND OR after_i.vehicle_id IS DISTINCT FROM i.vehicle_id OR after_i.image_url IS DISTINCT FROM i.image_url
       OR after_i.vision_gate_status IS DISTINCT FROM i.vision_gate_status THEN
      -- In particular, an existing hint guard may attempt to unfile an image.
      -- Refuse/roll back its whole projection transaction, never bypass it.
      RAISE EXCEPTION 'review_source_changed_during_projection' USING ERRCODE='23514';
    END IF;
  END IF;
  -- The canonical deep-analysis path includes the existing search/convergence
  -- row, not just its BYOK cache and timeline observation. Keep this in the same
  -- source-locked transaction: a failed placement rolls back the projection.
  -- The role describes this frame. Reference/unknown scenes do not assert that
  -- the photographed object is the vehicle; a body/detail reading is never a
  -- high-confidence identity vote merely because a review was completed.
  reference_scene := coalesce(o.structured_data->>'scene_type','unknown') NOT IN
    ('body_exterior','body_interior','engine_bay','undercarriage','data_plate',
     'wheel_assembly','fabrication_in_progress','paint_booth','road_test','off_property');
  placed_vehicle := CASE WHEN reference_scene THEN NULL ELSE o.vehicle_id END;
  placed_role := CASE WHEN reference_scene THEN 'incidental'
    WHEN o.structured_data->>'scene_type' IN ('body_exterior','road_test','off_property') THEN 'subject'
    ELSE 'part' END;
  placed_id := public.ingest_image_observation(i.id, placed_vehicle, placed_role,
    least(greatest(coalesce(o.confidence_score,0),0),0.6), 'caller-byok','reviewed_image_analysis_v1',
    jsonb_build_object('reviewed_image_analysis_v1',jsonb_build_object(
      'observation_id',o.id,'source_identifier',o.source_identifier,'vehicle_id',o.vehicle_id,
      'image_url',s->>'image_url','reviewed_url',s->>'reviewed_url',
      'reviewed_sha256',s->>'reviewed_sha256','reviewed_at',s->>'reviewed_at',
      'scene_type',o.structured_data->>'scene_type',
      'evidence_role',CASE WHEN reference_scene THEN 'reference' ELSE 'physical_observation' END)),
    false, jsonb_build_object('method','reviewed_image_analysis_v1'));
  IF placed_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.image_observations io
    WHERE io.id=placed_id AND io.image_id=i.id AND io.vehicle_id IS NOT DISTINCT FROM placed_vehicle
      AND io.is_active AND io.observed_by='caller-byok' AND io.agent_version='reviewed_image_analysis_v1'
      AND io.confidence_basis#>>'{reviewed_image_analysis_v1,observation_id}'=o.id::text
      AND io.confidence_basis#>>'{reviewed_image_analysis_v1,image_url}'=i.image_url) THEN
    RAISE EXCEPTION 'review_search_projection_not_persisted' USING ERRCODE='23514';
  END IF;
  cover := public.recompute_vehicle_primary_image(o.vehicle_id);
  RETURN jsonb_build_object('success',true,'observation_id',o.id,'image_id',i.id,'vehicle_id',o.vehicle_id,
    'projection_duplicate',coalesce(replay,false),'image_observation_id',placed_id,
    'search_vehicle_id',placed_vehicle,'cover',cover,'model_calls',0);
END;
$function$;

drop function if exists public.image_reading_thin_violation(jsonb, jsonb);
drop function if exists public.image_reading_tier_is_reviewed(text, boolean);
drop function if exists public.image_reading_tier_is_automatic(text);
drop function if exists public.image_reading_thin_envelope_violation(jsonb, jsonb);
commit;
