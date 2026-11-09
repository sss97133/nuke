-- Service-only supplied image review, owned by photo-pipeline-orchestrator.
-- No data replay, schedules, model calls, source filing or receipt-part confirmation.
-- Immutable results enter through ingest-observation with analysis_deferred; only
-- their guarded projection can update the established BYOK cache/cover consumer.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.photo_land_classification(uuid)'::regprocedure) <> '7188b49fc54ce68e8299e31df0dfc07c'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.photo_land_trigger()'::regprocedure) <> '4e4570c88d1573124e75d17f4ee2b339' THEN
    RAISE EXCEPTION 'photo landing owner drifted; review current definitions';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid, p_include_classifier boolean)
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
  if p_include_classifier and cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
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
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis',
              coalesce('review:' || (byok->>'observation_id'), byok->>'prompt_version', 'unknown'),
              jsonb_strip_nulls(jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id',
                'observation_id', byok->>'observation_id', 'source_identifier', byok->>'source_identifier')))
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

-- Compatibility entry retains the former full landing contract.
CREATE OR REPLACE FUNCTION public.photo_land_classification(p_image_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.photo_land_classification(p_image_id, true) $$;
REVOKE ALL ON FUNCTION public.photo_land_classification(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_land_classification(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.photo_land_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  -- A deep-result-only update changes camera testimony, not the classifier.
  -- Keep classifier/filing transitions on the original full landing path.
  PERFORM public.photo_land_classification(NEW.id,
    OLD.ai_processing_status IS DISTINCT FROM 'completed'
    OR OLD.ai_scan_metadata->'classification' IS DISTINCT FROM NEW.ai_scan_metadata->'classification'
    OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
    OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'photo_land_trigger failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

-- Admission still uses the existing observation intake and atomic image witness.
-- Lock/check at insertion as well as projection: a withdrawn/moved source must
-- not be admitted merely because an earlier HTTP preflight saw it.
CREATE OR REPLACE FUNCTION public.guard_reviewed_image_analysis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
     OR NEW.extractor_id IS DISTINCT FROM 'photo-pipeline-orchestrator'
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
REVOKE ALL ON FUNCTION public.guard_reviewed_image_analysis() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_reviewed_image_analysis_insert
BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.extraction_method='reviewed_image_analysis_v1')
EXECUTE FUNCTION public.guard_reviewed_image_analysis();

CREATE OR REPLACE FUNCTION public.project_reviewed_image_analysis(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '3s' SET statement_timeout = '10s'
AS $function$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  i public.vehicle_images%ROWTYPE;
  after_i public.vehicle_images%ROWTYPE;
  s jsonb; p jsonb; a jsonb; cover jsonb; replay boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'review_requires_service_role' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.extraction_method IS DISTINCT FROM 'reviewed_image_analysis_v1'
     OR o.extractor_id IS DISTINCT FROM 'photo-pipeline-orchestrator'
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
      'observation_id',o.id,'source_identifier',o.source_identifier,
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
  cover := public.recompute_vehicle_primary_image(o.vehicle_id);
  RETURN jsonb_build_object('success',true,'observation_id',o.id,'image_id',i.id,'vehicle_id',o.vehicle_id,
    'projection_duplicate',coalesce(replay,false),'cover',cover,'model_calls',0);
END;
$function$;
REVOKE ALL ON FUNCTION public.project_reviewed_image_analysis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_reviewed_image_analysis(uuid) TO service_role;
COMMENT ON FUNCTION public.project_reviewed_image_analysis(uuid) IS
  'Owner photo-pipeline-orchestrator. Project one guarded deferred review observation into the existing BYOK image cache and recompute its vehicle cover. Preserves before-image in immutable observation; same-image/source CAS, witness, withdrawal and replay checks. No model, filing, field promotion or component confirmation.';
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('vehicle_images','ai_scan_metadata.byok_deep_analysis','photo-pipeline-orchestrator',
  'Service-only supplied reviewed result; immutable deferred observation and source-bound image projection. No classifier/receipt/field handlers.',true,
  'record_reviewed_analysis -> ingest-observation -> project_reviewed_image_analysis');
COMMIT;

