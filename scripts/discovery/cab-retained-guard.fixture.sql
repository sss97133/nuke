-- Dated 2026-10-18 live canonical guard, unchanged baseline for the disposable PG17 fixture only.
CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p public.vehicle_observations%ROWTYPE; v_property_key text; source_field text; projection_mode text;
BEGIN
  -- The new BaT capability admits only this source-bound report subtype.
  -- Historical unrelated activity may still receive operational/supersession
  -- updates; new insertion or a semantic conversion must satisfy this gate.
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
    -- Corrections use sanctioned supersession; never mutate the derived tuple.
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
    -- One current report per listing sentence; repeated captures of the page
    -- repeat the assertion. A report whose capture was withdrawn no longer counts.
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
  IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false
    OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
    OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
    OR p.source_url IS NULL OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
    OR (p.observed_at IS NOT NULL AND NOT isfinite(p.observed_at))
    OR p.confidence_score IS NULL OR p.confidence_score < 0.6 OR p.confidence_score > 1
    OR jsonb_typeof(p.structured_data->source_field) IS DISTINCT FROM 'string'
    OR nullif(btrim(p.structured_data->>source_field),'') IS NULL
    OR length(p.structured_data->>source_field)>500
    OR btrim(p.structured_data->>source_field) ~* '^(unknown|n/a|unspecified)$'
    OR NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE
      AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
    OR NOT EXISTS (SELECT 1 FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat') THEN
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
