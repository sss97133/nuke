-- Exact current custody/build-log/witness owners read 2026-11-11. Synthetic tests only.
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
CREATE OR REPLACE FUNCTION public.validate_retained_listing_property_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
-- retained_bat_sale_properties_v1
DECLARE p public.vehicle_observations%ROWTYPE; v_property_key text; source_field text; projection_mode text;
BEGIN
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
    -- Consistent trunk-first lock order; NOWAIT refuses in-flight changes.
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
      -- Normalize typed timestamps under this guard's session timezone before
      -- comparing JSON: equivalent instants must not fail on offset formatting.
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

CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid, p_include_reported boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$;
 SELECT jsonb_build_object(
  'work_records',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.vehicle_build_log_public(p_vehicle_id) w),
  'reported_work',CASE WHEN p_include_reported IS TRUE THEN (
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'observation_id',c.id,'kind',c.kind,'report_status',c.structured_data->>'report_status',
    'occurrence_status',c.structured_data->>'occurrence_status','performer_id',c.structured_data->'performer_id','performer_status',c.structured_data->>'performer_status',
    'independent_source',c.structured_data->'independent_source','intent_status',c.structured_data->>'intent_status',
    'observed_at_basis',c.structured_data->>'observed_at_basis',
    'reported_date',c.structured_data->>'reported_date','reported_date_label',c.structured_data->>'reported_date_label','date_precision',c.structured_data->>'date_precision',
    'performed_clause',c.structured_data->>'performed_clause','source_value',c.structured_data->>'source_value',
    'source_observation_id',c.source_observation_id,'source_id',c.source_id,'source_url',c.source_url,
    'source_captured_at',c.structured_data->>'source_captured_at','source_recorded_at',c.parent_ingested_at,
    'source_capture_sha256',c.structured_data->>'source_capture_sha256','source_capture_basis',c.structured_data->>'source_capture_basis',
    'source_witness_version',c.structured_data->>'source_witness_version','observed_at',c.observed_at,'ingested_at',c.ingested_at,
    'confidence_score',c.confidence_score) ORDER BY c.structured_data->>'reported_date' DESC,c.id),'[]'::jsonb)
   FROM (SELECT DISTINCT ON (c.source_id,c.source_url,c.structured_data->>'source_value') c.*,p.ingested_at AS parent_ingested_at
    FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
    WHERE c.vehicle_id=p_vehicle_id AND c.kind='activity' AND c.extraction_method='retained_listing_reported_work_v1'
     AND c.is_superseded IS FALSE AND public.retained_reported_work_matches(p,c)
     AND public.public_text(c.structured_data->>'source_value')=c.structured_data->>'source_value'
     AND public.public_text(c.structured_data->>'performed_clause')=c.structured_data->>'performed_clause'
    -- Repeated captures of one listing sentence are one report: the earliest admitted.
    ORDER BY c.source_id,c.source_url,c.structured_data->>'source_value',c.ingested_at,c.id) c
  ) ELSE '[]'::jsonb END) || public.visual_work_build_log(p_vehicle_id);
$function$
;
CREATE OR REPLACE FUNCTION public.project_observation_image_witness()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
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
$function$
;
