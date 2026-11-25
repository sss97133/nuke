-- Live definitions read 2026-11-25 01:30 PT (pg_get_functiondef, read-only) of the two owners migration
-- 20261125191500_cached_image_projection_source_key.sql patches by anchor. Loaded verbatim so the migration's hash guards
-- see what production holds. Used by supabase/sql/test_cached_image_projection_source_key.sql.
CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
-- retained_bat_sale_properties_v1
DECLARE p public.vehicle_observations%ROWTYPE; v_property_key text; source_field text; projection_mode text;
BEGIN
  IF NEW.component_subject_id IS NOT NULL OR NEW.extraction_method='retained_component_reading_v1'
   OR EXISTS(SELECT 1 FROM public.observation_properties WHERE id=NEW.property_id AND property_key='component_visible_present')
   OR NEW.structured_data ? 'component_ref' OR NEW.structured_data ? 'component_reading'
   OR (TG_OP='UPDATE' AND OLD.component_subject_id IS NOT NULL) THEN
   IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain']) THEN
     RAISE EXCEPTION 'Component reading is immutable; supersede instead' USING ERRCODE='23514'; END IF;
    RETURN NEW;
   END IF;
   IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Component reading requires service role' USING ERRCODE='42501'; END IF;
   DECLARE image_row public.vehicle_images%ROWTYPE; source_row public.vehicle_observations%ROWTYPE; candidate jsonb; source_pn text; BEGIN
    SELECT * INTO image_row FROM public.vehicle_images WHERE id=(NEW.structured_data->>'image_id')::uuid FOR SHARE NOWAIT;
    SELECT * INTO source_row FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.vehicles WHERE id=NEW.vehicle_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.observation_witnesses WHERE observation_id=source_row.id AND image_id=image_row.id FOR SHARE NOWAIT;
    IF public.component_reading_matches(source_row,NEW,image_row) IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'Component reading source or scope unavailable' USING ERRCODE='23514'; END IF;
    FOR candidate IN SELECT value FROM jsonb_array_elements(NEW.structured_data->'component_receipt_candidates') LOOP
     PERFORM 1 FROM public.receipt_items WHERE id=(candidate->>'receipt_item_id')::uuid FOR SHARE NOWAIT;
     PERFORM 1 FROM public.receipts WHERE id=(candidate->>'receipt_id')::uuid FOR SHARE NOWAIT;
     PERFORM 1 FROM public.receipt_vehicle_links WHERE id=(candidate->>'link_id')::uuid FOR SHARE NOWAIT;
     IF candidate->>'source_table'='vehicle_documents' THEN
      PERFORM 1 FROM public.vehicle_documents WHERE id=(candidate->>'source_id')::uuid FOR SHARE NOWAIT;
     ELSE PERFORM 1 FROM public.vehicle_images WHERE id=(candidate->>'source_id')::uuid FOR SHARE NOWAIT; END IF;
     IF public.component_receipt_candidate(NEW.vehicle_id,candidate,false) IS NULL THEN
      RAISE EXCEPTION 'Component receipt candidate unavailable' USING ERRCODE='23514'; END IF;
     IF candidate->>'association_basis'='same_printed_part_number' THEN
      source_pn:=source_row.structured_data#>>ARRAY['components_seen',NEW.structured_data#>>'{component_reading,path,1}','part_number_guess'];
      IF nullif(public.receipt_product_number(source_pn),'') IS NULL OR public.receipt_product_number(source_pn)
       IS DISTINCT FROM public.receipt_product_number(candidate->>'part_number') THEN
       RAISE EXCEPTION 'Component part-number candidate does not match retained reading' USING ERRCODE='23514'; END IF;
     END IF;
    END LOOP;
   END;
   RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND (NEW.extraction_method='retained_native_fields_v1'
   OR NEW.structured_data->>'source_profile'='retained_native_fields_v1'
   OR (NEW.extraction_method='next_data_json_parse' AND NEW.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid))
   AND current_user NOT IN('postgres','service_role') THEN
   RAISE EXCEPTION 'Native extractor receipts require service role' USING ERRCODE='42501';END IF;
  IF TG_OP='INSERT' AND NEW.source_id='755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid AND NEW.kind::text='specification'
   AND (NEW.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1' OR NEW.source_observation_id IS NULL OR NEW.property_id IS NULL) THEN
   RAISE EXCEPTION 'Native specifications require canonical retained source custody' USING ERRCODE='23514';END IF;

  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN
    IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain']) THEN
      RAISE EXCEPTION 'listing capture receipt is immutable; supersede instead' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.extraction_method='protected_cab_listing_capture_v1' OR NEW.structured_data ? 'listing_capture_receipt' THEN
    IF TG_OP='UPDATE' THEN
      RAISE EXCEPTION 'listing capture receipt is immutable; supersede instead' USING ERRCODE='23514';
    END IF;
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
      RAISE EXCEPTION 'listing capture admission requires service role' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.vehicles WHERE id=NEW.vehicle_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.observation_sources WHERE id=NEW.source_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.auction_events WHERE id=NEW.auction_event_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.listing_page_snapshots WHERE id=NEW.source_snapshot_id FOR SHARE NOWAIT;
    DECLARE q jsonb; expected public.vehicle_observations%ROWTYPE; expected_fields jsonb;
    BEGIN
      q:=public.qualify_cab_listing_capture(NEW.source_observation_id,NEW.source_snapshot_id,NEW.auction_event_id);
      IF q->'ok' IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION 'listing capture custody refused: %',q->>'reason' USING ERRCODE='23514';
      END IF;
      expected:=jsonb_populate_record(NULL::public.vehicle_observations,q->'input');
      SELECT jsonb_object_agg(k,to_jsonb(expected)->k) INTO expected_fields
      FROM jsonb_object_keys((q->'input')-'source_slug'-'defer_analysis') AS keys(k);
      IF NOT (to_jsonb(NEW) @> expected_fields)
        OR NEW.source_comment_id IS NOT NULL OR NEW.source_vehicle_event_id IS NOT NULL OR NEW.ingested_at IS DISTINCT FROM transaction_timestamp()
        OR NEW.is_superseded IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'listing capture input differs from independently qualified receipt' USING ERRCODE='23514';
      END IF;
    END;
    RETURN NEW;
  END IF;
  IF NEW.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND NEW.kind='activity'
    AND (NEW.source_observation_id IS NULL OR NEW.extraction_method IS DISTINCT FROM 'retained_listing_reported_work_v1') THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'BaT activity requires protected retained report admission' USING ERRCODE='23514';
    ELSIF ROW(NEW.source_id,NEW.kind,NEW.vehicle_id,NEW.subject_type,NEW.subject_id,NEW.source_observation_id,NEW.extraction_method,
      NEW.property_id,NEW.source_url,NEW.source_identifier,NEW.raw_source_ref,NEW.observed_at,NEW.ingested_at,NEW.structured_data,NEW.content_text,NEW.content_hash)
      IS DISTINCT FROM ROW(OLD.source_id,OLD.kind,OLD.vehicle_id,OLD.subject_type,OLD.subject_id,OLD.source_observation_id,OLD.extraction_method,
      OLD.property_id,OLD.source_url,OLD.source_identifier,OLD.raw_source_ref,OLD.observed_at,OLD.ingested_at,OLD.structured_data,OLD.content_text,OLD.content_hash) THEN
      RAISE EXCEPTION 'BaT activity conversion requires protected retained report admission' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.source_observation_id IS NOT NULL AND
      ROW(NEW.id,NEW.source_observation_id,NEW.vehicle_id,NEW.kind,NEW.property_id,NEW.subject_type,NEW.subject_id,
        NEW.source_id,NEW.source_url,NEW.source_identifier,NEW.raw_source_ref,NEW.observed_at,NEW.ingested_at,
        NEW.extraction_method,NEW.confidence_score,NEW.structured_data,NEW.content_hash,NEW.content_text)
      IS DISTINCT FROM
      ROW(OLD.id,OLD.source_observation_id,OLD.vehicle_id,OLD.kind,OLD.property_id,OLD.subject_type,OLD.subject_id,
        OLD.source_id,OLD.source_url,OLD.source_identifier,OLD.raw_source_ref,OLD.observed_at,OLD.ingested_at,
        OLD.extraction_method,OLD.confidence_score,OLD.structured_data,OLD.content_hash,OLD.content_text) THEN
      RAISE EXCEPTION 'retained property source tuple is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.source_observation_id IS NOT DISTINCT FROM NEW.source_observation_id THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'retained source links are assigned only on insert' USING ERRCODE='23514';
  END IF;
  IF NEW.source_observation_id IS NULL THEN
    IF NEW.extraction_method IN ('retained_listing_property_projection_v1','retained_listing_reported_work_v1') THEN
      RAISE EXCEPTION 'retained projection requires typed source' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.extraction_method='retained_listing_reported_work_v1' OR NEW.structured_data->>'analysis_kind'='retained_reported_work' THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR NOT public.retained_reported_work_matches(p,NEW) THEN
      RAISE EXCEPTION 'Retained reported work must match exact public source assertion' USING ERRCODE='23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('retained_reported_work:'||NEW.vehicle_id::text||':'||NEW.source_url||':'||md5(NEW.structured_data->>'source_value'),0));
    IF EXISTS(SELECT 1 FROM public.vehicle_observations o JOIN public.vehicle_observations op ON op.id=o.source_observation_id
      WHERE o.vehicle_id=NEW.vehicle_id AND o.kind='activity' AND o.extraction_method='retained_listing_reported_work_v1'
        AND o.source_id=NEW.source_id AND o.source_url=NEW.source_url AND o.is_superseded IS FALSE AND o.id IS DISTINCT FROM NEW.id
        AND o.structured_data->>'source_value'=NEW.structured_data->>'source_value' AND public.retained_reported_work_matches(op,o)) THEN
      RAISE EXCEPTION 'Retained reported work already admitted for this listing sentence' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  v_property_key := NEW.structured_data->>'property_key';
  IF v_property_key IN('year','make','model','vin') THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR NOT (public.retained_listing_identity_matches(p,NEW) OR public.retained_craigslist_year_matches(p,NEW) OR public.retained_description_year_matches(p,NEW) OR public.retained_description_identity_matches(p,NEW)) THEN
     RAISE EXCEPTION 'Retained identity must match exact source label' USING ERRCODE='23514';END IF;
    RETURN NEW;
  END IF;
  IF v_property_key='engine_family_label' THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR NOT public.retained_description_property_matches(p,NEW) THEN
      RAISE EXCEPTION 'retained engine family must match ratified property and exact native source witness' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF v_property_key='interior_color' THEN
    source_field := 'interior_color'; projection_mode := 'retained_listing_interior_color_v1';
  ELSIF v_property_key='exterior_color' THEN
    source_field := 'color'; projection_mode := 'retained_listing_exterior_color_v1';
  ELSIF v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') THEN
    source_field:=CASE v_property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END;
    projection_mode:='retained_listing_'||v_property_key||'_v1';
  ELSIF v_property_key='mileage_miles' THEN
    source_field:='content_text';projection_mode:='retained_listing_mileage_miles_v1';
  ELSE
    RAISE EXCEPTION 'unsupported retained property' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
  IF FOUND AND p.source_id='d7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid THEN
   IF NOT public.retained_craigslist_odometer_matches(p,NEW) THEN RAISE EXCEPTION 'Craigslist odometer must match retained attribute' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  IF FOUND AND p.extraction_method='html_description_capture' THEN
   IF NOT public.retained_description_property_matches(p,NEW) THEN
    RAISE EXCEPTION 'retained description must match exact source witness' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  IF NOT FOUND OR p.is_superseded IS DISTINCT FROM false
    OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
    OR NOT (((p.kind='listing' OR (p.kind='sale_result' AND p.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND public.observation_is_public(p.kind,p.structured_data))) AND p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR public.retained_native_listing_source(p))
    OR p.source_url IS NULL OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
    OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
    OR p.confidence_score IS NULL OR p.confidence_score < 0.6 OR p.confidence_score > 1
    OR jsonb_typeof(p.structured_data->source_field) IS DISTINCT FROM 'string'
    OR nullif(btrim(p.structured_data->>source_field),'') IS NULL
    OR length(p.structured_data->>source_field)>500
    OR btrim(p.structured_data->>source_field) ~* '^(unknown|n/a|unspecified)$'
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
    OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))) THEN
    RAISE EXCEPTION 'ineligible retained listing source' USING ERRCODE='23514';
  END IF;
  IF NEW.vehicle_id IS DISTINCT FROM p.vehicle_id OR NEW.source_id IS DISTINCT FROM p.source_id
    OR NEW.source_url IS DISTINCT FROM p.source_url OR NEW.kind::text IS DISTINCT FROM 'specification'
    OR NEW.subject_type IS DISTINCT FROM 'vehicle' OR NEW.subject_id IS NOT NULL
    OR NEW.observed_at IS DISTINCT FROM p.ingested_at
    OR NEW.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
    OR NEW.source_identifier IS DISTINCT FROM projection_mode||':'||p.id::text
    OR NEW.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text
    OR NEW.confidence_score IS NULL OR NEW.confidence_score<0 OR NEW.confidence_score>0.6
    OR NEW.structured_data->v_property_key IS DISTINCT FROM
      (CASE WHEN v_property_key IN ('interior_color','exterior_color') THEN p.structured_data->source_field
       ELSE public.retained_powertrain_value(v_property_key,p.structured_data->source_field) END)
    OR (v_property_key IN ('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout') AND
      (public.retained_powertrain_value(v_property_key,p.structured_data->source_field) IS NULL
       OR NEW.structured_data->'source_value' IS DISTINCT FROM p.structured_data->source_field
       OR NEW.structured_data->>'normalization_version' IS DISTINCT FROM 'retained_powertrain_v1'
       OR NEW.structured_data->>'factory_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->>'current_configuration_status' IS DISTINCT FROM 'unknown'
       OR NEW.structured_data->'independent_source' IS DISTINCT FROM 'false'::jsonb))
    OR NEW.structured_data->>'source_observation_id' IS DISTINCT FROM p.id::text
    OR NEW.structured_data->>'claim_role' IS DISTINCT FROM 'listing_claim'
    OR NEW.structured_data->>'observed_at_basis' IS DISTINCT FROM 'source_testimony_recorded_at'
    OR NEW.structured_data->>'source_field' IS DISTINCT FROM source_field
    OR NEW.structured_data->>'property_key' IS DISTINCT FROM v_property_key
    OR NEW.structured_data->>'projection_version' IS DISTINCT FROM projection_mode
    OR NEW.structured_data->>'analysis_kind' IS DISTINCT FROM 'retained_listing_property_projection'
    OR (NEW.structured_data->>'source_recorded_at')::timestamptz IS DISTINCT FROM p.ingested_at
    OR (NEW.structured_data->>'source_observed_at')::timestamptz IS DISTINCT FROM p.observed_at
    OR NEW.structured_data->'source_confidence_score' IS DISTINCT FROM to_jsonb(p.confidence_score)
    OR NEW.structured_data->>'source_extraction_method' IS DISTINCT FROM p.extraction_method
    OR NOT EXISTS (SELECT 1 FROM public.observation_properties r WHERE r.id=NEW.property_id
      AND r.property_key=v_property_key AND r.namespace='core' AND r.deprecated_at IS NULL
      AND 'specification'=ANY(r.applies_to_kinds)) THEN
    RAISE EXCEPTION 'retained property must match exact source tuple' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_cached_image_property_batch(p_claims jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  n integer;
  source_row public.observation_sources%ROWTYPE;
  base_score numeric;
  score numeric;
  factors jsonb;
  inserted_ids uuid[];
  receipt jsonb;
  verified_count integer;
BEGIN
  IF jsonb_typeof(p_claims) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'claims must be a JSON array' USING ERRCODE='22023';
  END IF;
  n:=jsonb_array_length(p_claims);
  IF n NOT BETWEEN 1 AND 3000 OR octet_length(p_claims::text)>12000000 THEN
    RAISE EXCEPTION 'cached image batch exceeds bounded intake' USING ERRCODE='22023';
  END IF;
  -- Shape first: casts below cannot convert arbitrary JSON into admissible facts.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_claims) c WHERE
      jsonb_typeof(c) IS DISTINCT FROM 'object'
      OR c->>'source_slug' IS DISTINCT FROM 'photo_pipeline'
      OR c->>'kind' IS DISTINCT FROM 'condition'
      OR c->'agent_inferred' IS DISTINCT FROM 'true'::jsonb
      OR c->'defer_analysis' IS DISTINCT FROM 'true'::jsonb
      OR c->'agent_cost_cents' IS DISTINCT FROM '0'::jsonb
      OR c->>'extraction_method' IS DISTINCT FROM 'cached_byok_property_projection_v1'
      OR coalesce(c->>'content_hash','') !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(c->'source_result_json') IS DISTINCT FROM 'string'
      OR octet_length(c->>'source_result_json') NOT BETWEEN 2 AND 32768
      OR coalesce(c->>'vehicle_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(c->'structured_data') IS DISTINCT FROM 'object'
      OR coalesce(c->'structured_data'->>'image_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(c->'structured_data'->>'source_observation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(c->'structured_data'->>'source_result_hash','') !~ '^[0-9a-f]{64}$'
      OR coalesce(c->>'property_key','') NOT IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state')
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN
        ('source_slug','kind','vehicle_id','property_key','agent_inferred','defer_analysis','observed_at',
         'source_identifier','raw_source_ref','agent_model','agent_tier','extraction_method','agent_cost_cents','structured_data','content_hash','source_result_json'))
    ) THEN RAISE EXCEPTION 'invalid cached image claim shape' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT c->>'source_identifier') FROM jsonb_array_elements(p_claims) c) <> n THEN
    RAISE EXCEPTION 'duplicate or absent claim identity in batch' USING ERRCODE='23514';
  END IF;

  SELECT * INTO source_row FROM public.observation_sources WHERE slug='photo_pipeline' FOR SHARE;
  IF NOT FOUND OR NOT ('condition'::public.observation_kind=ANY(source_row.supported_observations)) THEN
    RAISE EXCEPTION 'canonical photo source unavailable' USING ERRCODE='23514';
  END IF;
  -- Lock exact referenced rows, in a deterministic order, until commit. Privacy,
  -- source testimony, image attribution and registry cannot change mid-admission.
  PERFORM 1 FROM public.vehicles v JOIN (SELECT DISTINCT (c->>'vehicle_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=v.id ORDER BY v.id FOR SHARE OF v;
  PERFORM 1 FROM public.vehicle_images i JOIN (SELECT DISTINCT (c->'structured_data'->>'image_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=i.id ORDER BY i.id FOR SHARE OF i;
  PERFORM 1 FROM public.vehicle_observations o JOIN (SELECT DISTINCT (c->'structured_data'->>'source_observation_id')::uuid id
    FROM jsonb_array_elements(p_claims) c) x ON x.id=o.id ORDER BY o.id FOR SHARE OF o;
  PERFORM 1 FROM public.observation_properties p JOIN (SELECT DISTINCT c->>'property_key' k
    FROM jsonb_array_elements(p_claims) c) x ON x.k=p.property_key ORDER BY p.id FOR SHARE OF p;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_claims) c
    LEFT JOIN public.vehicles v ON v.id=(c->>'vehicle_id')::uuid
    LEFT JOIN public.vehicle_images i ON i.id=(c->'structured_data'->>'image_id')::uuid
    LEFT JOIN public.vehicle_observations o ON o.id=(c->'structured_data'->>'source_observation_id')::uuid
    LEFT JOIN public.observation_properties p ON p.property_key=c->>'property_key'
    CROSS JOIN LATERAL (SELECT CASE c->>'property_key'
      WHEN 'image_visible_rust_severity' THEN 'rust_severity'
      WHEN 'image_visible_paint_stage' THEN 'paint_state' ELSE 'completeness' END source_key) m
    WHERE v.id IS NULL OR v.is_public IS DISTINCT FROM true
      OR v.deleted_at IS NOT NULL OR coalesce(v.listing_kind,'')='non_vehicle_item'
      OR i.id IS NULL OR i.vehicle_id IS DISTINCT FROM v.id
      OR i.vision_gate_status::text IS DISTINCT FROM 'approved'
      OR i.is_sensitive IS TRUE OR i.is_superseded IS TRUE OR i.is_duplicate IS TRUE OR i.is_document IS TRUE
      OR i.image_vehicle_match_status IN ('mismatch','unrelated')
      OR NOT coalesce(((i.source IN ('bat','bat_import') AND i.image_url ~ '^https://([a-zA-Z0-9-]+\.)*bringatrailer\.com/[^?#[:space:]]+$')
        OR (i.source='external_import' AND i.image_url ~ '^https://images\.craigslist\.org/[^?#[:space:]]+$')),false)
      OR o.id IS NULL OR o.vehicle_id IS DISTINCT FROM v.id OR o.kind::text IS DISTINCT FROM 'condition'
      OR public.observation_is_public(o.kind,o.structured_data) IS DISTINCT FROM true
      OR o.is_superseded IS TRUE OR o.structured_data->>'analysis_kind' IS DISTINCT FROM 'image_deep_byok'
      OR o.structured_data->>'image_id' IS DISTINCT FROM i.id::text
      OR o.structured_data->>'scene_type'='receipt_document'
      OR o.confidence::text='low' OR o.confidence_score IS NULL OR o.confidence_score<0.6 OR o.confidence_score>1
      OR o.structured_data->'needs_review'='true'::jsonb OR o.structured_data->'needs_clarification'='true'::jsonb
      OR (o.structured_data ? 'attribution_doubt' AND o.structured_data->'attribution_doubt' NOT IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb))
      OR nullif(btrim(o.agent_model),'') IS NULL OR nullif(btrim(o.extraction_method),'') IS NULL
      OR o.ingested_at IS NULL OR NOT isfinite(o.ingested_at)
      OR p.id IS NULL OR p.deprecated_at IS NOT NULL OR p.namespace IS DISTINCT FROM 'core'
      OR NOT coalesce('condition'::public.observation_kind=ANY(p.applies_to_kinds),false)
      OR p.data_type IS DISTINCT FROM 'enum' OR p.discriminator_key IS DISTINCT FROM 'image_id'
      OR c->>'agent_model' IS DISTINCT FROM o.agent_model
      OR nullif(c->>'agent_tier','') IS DISTINCT FROM nullif(o.agent_tier,'')
      OR (c->>'observed_at')::timestamptz IS DISTINCT FROM o.ingested_at
      OR c->>'raw_source_ref' IS DISTINCT FROM 'vehicle_observations:'||o.id::text
      OR c->>'source_identifier' IS DISTINCT FROM 'byok_image_properties_v1:'||o.id::text||':'||
        (c->'structured_data'->>'source_result_hash')||':'||(c->>'property_key')
      OR encode(sha256(convert_to(c->>'source_result_json','UTF8')),'hex')
        IS DISTINCT FROM c->'structured_data'->>'source_result_hash'
      OR (c->>'source_result_json')::jsonb IS DISTINCT FROM jsonb_build_object(
        'observation_id',o.id,'image_id',i.id,'vehicle_id',v.id,'model',o.agent_model,
        'method',o.extraction_method,'recorded_at',c->'structured_data'->>'source_recorded_at',
        'state_observations',jsonb_build_object(
          'rust_severity',o.structured_data->'state_observations'->'rust_severity',
          'paint_state',o.structured_data->'state_observations'->'paint_state',
          'completeness',o.structured_data->'state_observations'->'completeness'))
      OR jsonb_typeof(c->'structured_data'->(c->>'property_key')) IS DISTINCT FROM 'string'
      OR c->'structured_data'->(c->>'property_key') IS DISTINCT FROM o.structured_data->'state_observations'->m.source_key
      OR NOT CASE c->>'property_key'
        WHEN 'image_visible_rust_severity' THEN c->'structured_data'->>(c->>'property_key') IN ('none','surface','pitting','perforation')
        WHEN 'image_visible_paint_stage' THEN c->'structured_data'->>(c->>'property_key') IN ('bare_metal','primer','sealer','base','clear','aged')
        ELSE c->'structured_data'->>(c->>'property_key') IN ('stripped','partial','assembled') END
      -- Rebuild all provenance from the immutable parent. Timestamp strings are
      -- preserved byte-for-byte for v1 JS hashing but must denote the same clocks.
      OR (c->'structured_data'->>'source_recorded_at')::timestamptz IS DISTINCT FROM o.ingested_at
      OR (c->'structured_data'->>'source_observed_at')::timestamptz IS DISTINCT FROM o.observed_at
      OR c->'structured_data' IS DISTINCT FROM jsonb_build_object(
        c->>'property_key',o.structured_data->'state_observations'->m.source_key,
        'image_id',i.id,'property_key',c->>'property_key','analysis_kind','image_property_projection',
        'projection_version','byok_image_properties_v1','source_observation_id',o.id,
        'source_result_hash',c->'structured_data'->>'source_result_hash',
        'source_extraction_method',o.extraction_method,'source_model_confidence',o.confidence_score,
        'source_recorded_at',c->'structured_data'->>'source_recorded_at',
        'source_observed_at',c->'structured_data'->'source_observed_at',
        'observed_at_basis','source_testimony_recorded_at','capture_at',NULL,'analyzed_at',NULL,
        'claim_role','inferred','source_family','image:'||i.id::text,
        'limitation','Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration.')
  ) THEN RAISE EXCEPTION 'cached image source, privacy, property or provenance changed' USING ERRCODE='23514'; END IF;

  -- An immutable parent/property already admitted under another v1 identity is
  -- a conflict, not a second independent claim. Reuse the image+analysis index;
  -- never search the full observation log for a JSON parent reference.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_claims) c
    JOIN public.vehicle_observations o
      ON o.structured_data->>'image_id'=c->'structured_data'->>'image_id'
      AND o.structured_data->>'analysis_kind'='image_property_projection'
      AND o.source_id=source_row.id AND o.kind='condition'
      AND o.structured_data->>'source_observation_id'=c->'structured_data'->>'source_observation_id'
      AND o.structured_data->>'property_key'=c->>'property_key'
    WHERE o.source_identifier IS DISTINCT FROM c->>'source_identifier'
       OR o.content_hash IS DISTINCT FROM c->>'content_hash') THEN
    RAISE EXCEPTION 'existing immutable parent property has a conflicting projection identity' USING ERRCODE='23514';
  END IF;

  -- Same formula as ingest-observation for this deliberately narrow payload:
  -- explicit vehicle +0.1, no source URL/text/owner claim, inferred cap at 0.6.
  base_score:=least(1.0,coalesce(nullif(source_row.base_trust_score,0),0.5)+0.1);
  score:=least(base_score,0.6);
  factors:=jsonb_build_object('vehicle_match',0.1);
  IF base_score>0.6 THEN factors:=factors||jsonb_build_object('agent_inferred_cap',0.6-base_score); END IF;

  WITH inserted AS (
    INSERT INTO public.vehicle_observations
      (vehicle_id,vehicle_match_confidence,observed_at,source_id,source_identifier,kind,
       content_hash,structured_data,confidence,confidence_score,confidence_factors,
       agent_tier,agent_model,agent_cost_cents,extraction_method,raw_source_ref,property_id,analysis_deferred)
    SELECT (c->>'vehicle_id')::uuid,1.0,(c->>'observed_at')::timestamptz,source_row.id,c->>'source_identifier','condition',
      c->>'content_hash',c->'structured_data',
      CASE WHEN score<0.4 THEN 'low'::public.confidence_level ELSE 'medium'::public.confidence_level END,
      score,factors,nullif(c->>'agent_tier',''),c->>'agent_model',0,c->>'extraction_method',c->>'raw_source_ref',p.id,true
    FROM jsonb_array_elements(p_claims) c JOIN public.observation_properties p ON p.property_key=c->>'property_key'
    ORDER BY c->>'vehicle_id',c->'structured_data'->>'image_id',c->>'source_identifier'
    ON CONFLICT ON CONSTRAINT unique_observation DO NOTHING RETURNING id
  ) SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO inserted_ids FROM inserted;

  -- A second statement sees both our inserts and a concurrent unique-key winner.
  -- Read stored rows + trigger-created witnesses; HTTP success alone is no receipt.
  SELECT count(*),jsonb_agg(jsonb_build_object(
    'index',c.ordinality-1,'observation_id',o.id,'duplicate',NOT(o.id=ANY(inserted_ids)),
    'vehicle_id',o.vehicle_id,'image_id',(o.structured_data->>'image_id')::uuid,
    'property_id',o.property_id,'property_key',p.property_key,'value',o.structured_data->p.property_key,
    'source_observation_id',(o.structured_data->>'source_observation_id')::uuid,
    'source_result_hash',o.structured_data->>'source_result_hash','source_recorded_at',o.structured_data->>'source_recorded_at',
    'confidence_score',o.confidence_score,'witness_id',w.id) ORDER BY c.ordinality)
    INTO verified_count,receipt
  FROM jsonb_array_elements(p_claims) WITH ORDINALITY c(claim,ordinality)
  JOIN public.vehicle_observations o ON o.source_id=source_row.id AND o.kind='condition'
    AND o.source_identifier=c.claim->>'source_identifier' AND o.content_hash=c.claim->>'content_hash'
  JOIN public.observation_properties p ON p.id=o.property_id AND p.property_key=c.claim->>'property_key'
  JOIN public.observation_witnesses w ON w.observation_id=o.id
    AND w.image_id=(c.claim->'structured_data'->>'image_id')::uuid AND w.witness_role='derived'
  WHERE o.vehicle_id=(c.claim->>'vehicle_id')::uuid AND o.structured_data=c.claim->'structured_data'
    AND o.observed_at=(c.claim->>'observed_at')::timestamptz AND o.is_superseded IS NOT TRUE
    AND o.agent_model=c.claim->>'agent_model' AND o.extraction_method=c.claim->>'extraction_method'
    AND o.raw_source_ref=c.claim->>'raw_source_ref' AND o.confidence_score>=0 AND o.confidence_score<=0.6;
  IF verified_count<>n THEN
    RAISE EXCEPTION 'atomic cached property readback incomplete or conflicting' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('success',true,'source_id',source_row.id,'submitted',n,
    'inserted',cardinality(inserted_ids),'duplicates',n-cardinality(inserted_ids),'verified',verified_count,'results',receipt);
END
$function$
;
