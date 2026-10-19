-- Preserve source RLS: canonical view proves metadata in its existing owner context.
-- Pure row predicates expose no table reads; intake/completion wrappers retain current-source checks.
BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN RAISE EXCEPTION 'Listing owner paused or changed';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work active; retry when idle';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_listing_identity_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'tiMLLBThgZ58YTiA7XYipVL0MFhPxR0uZ2THIZmS/iQ=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM '/dis/gNE1kRTjC/8xge9PkbddgvZOlNvtRshKu1TWSE=' OR
 encode(sha256(convert_to(pg_get_viewdef('public.vehicle_canonical'::regclass,true),'UTF8')),'base64') IS DISTINCT FROM 'VWwGwZT7wy4Xhht2vgJZC1u7J1OsTbyiljEJzmcKR28=' THEN RAISE EXCEPTION 'Retained canonical owner changed';END IF;
 IF to_regprocedure('public.retained_description_property_value_matches(public.vehicle_observations,public.vehicle_observations)') IS NOT NULL OR to_regprocedure('public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations)') IS NOT NULL THEN RAISE EXCEPTION 'Pure predicate already owned';END IF;
 IF NOT EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND projection_version='retained_listing_model_fields_v1') THEN RAISE EXCEPTION 'Recovery replay unavailable';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.retained_listing_identity_value_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE k text:=o.structured_data->>'property_key';d jsonb:=o.structured_data;value jsonb;
BEGIN
 value:=public.retained_listing_identity_value(k,p.structured_data->k);
 IF value IS NULL THEN RETURN false;END IF;
 RETURN coalesce(p.kind::text='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=value AND d->'source_value'=p.structured_data->k AND d->>'normalization_version'='retained_listing_identity_labels_v1'
  AND d->>'source_observation_id'=p.id::text AND d->>'property_key'=k AND d->>'source_field'=k
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1'
  AND d->>'claim_role'='listing_claim' AND d->>'observed_at_basis'='source_testimony_recorded_at'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified'
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown'
  AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at
  AND (d->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
,false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(public.retained_listing_identity_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core'
   AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND r.unit IS NULL
   AND r.data_type=CASE WHEN o.structured_data->>'property_key'='year' THEN 'integer' ELSE 'string' END
   AND r.label=CASE o.structured_data->>'property_key' WHEN 'year' THEN 'Model Year' WHEN 'make' THEN 'Make' ELSE 'Model' END
   AND 'specification'=ANY(r.applies_to_kinds)),false);
$$;

CREATE OR REPLACE FUNCTION public.retained_description_property_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE k text:=o.structured_data->>'property_key'; w jsonb; d jsonb:=o.structured_data;
BEGIN
 w:=public.retained_description_property_witness(p,k);
 IF w IS NULL THEN RETURN false; END IF;
 RETURN coalesce(
  o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text=CASE WHEN k='mileage_miles' THEN 'condition' ELSE 'specification' END AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.observed_at=p.ingested_at AND o.extraction_method='retained_listing_property_projection_v1'
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=w->'value' AND d->'source_value'=w->'source_value' AND d->>'normalization_version'=CASE WHEN k='mileage_miles' THEN 'retained_odometer_miles_v1' WHEN k IN('interior_color','exterior_color') THEN 'retained_color_text_v1' ELSE 'retained_powertrain_v1' END
  AND d->>'source_witness_version'=CASE WHEN k='mileage_miles' THEN 'retained_description_odometer_v1' WHEN k IN('interior_color','exterior_color','drivetrain_layout') THEN 'retained_description_presentation_v1' ELSE 'retained_description_powertrain_v1' END
  AND (k NOT IN('interior_color','exterior_color','drivetrain_layout') OR d->>'source_event_time_status'='unknown')
  AND (k<>'mileage_miles' OR (d->'source_reading_value'=w->'source_reading_value' AND d->'source_reading_unit'=w->'source_reading_unit'
   AND d->'reported_precision_miles'=w->'reported_precision_miles' AND d->'value_is_approximate'=w->'value_is_approximate'
   AND d->'reading_role'=w->'reading_role' AND d->'true_mileage_status'=w->'true_mileage_status'
   AND d->>'source_observed_at_basis'='source_capture' AND d->>'source_event_time_status'='unknown'))
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_field'='content_text' AND d->>'source_observation_id'=p.id::text
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1'
  AND d->>'claim_role'='listing_claim' AND d->>'observed_at_basis'='source_testimony_recorded_at'
  AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
,false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$
;
REVOKE ALL ON FUNCTION public.retained_description_property_value_matches(public.vehicle_observations,public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_description_property_value_matches(public.vehicle_observations,public.vehicle_observations) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.retained_description_property_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(public.retained_description_property_value_matches(p,o)
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND o.kind::text=ANY(s.supported_observations::text[]))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=o.structured_data->>'property_key' AND r.namespace='core' AND r.deprecated_at IS NULL AND o.kind::text=ANY(r.applies_to_kinds::text[])),false);
$$;
CREATE OR REPLACE VIEW public.vehicle_canonical AS  WITH ranked AS (
         SELECT o.vehicle_id,
            o.property_id,
            o.id AS observation_id,
            o.structured_data,
            o.content_text,
            o.confidence_score,
            o.observed_at,
            o.source_id,
            o.rank,
            o.kind,
            o.changeset_id,
            op.discriminator_key,
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END AS discriminator_value,
            row_number() OVER (PARTITION BY o.vehicle_id, o.property_id, (
                CASE
                    WHEN op.discriminator_key IS NOT NULL THEN o.structured_data ->> op.discriminator_key
                    ELSE '__single__'::text
                END) ORDER BY (
                CASE o.rank::text
                    WHEN 'preferred'::text THEN 0
                    WHEN 'normal'::text THEN 1
                    WHEN 'deprecated'::text THEN 2
                    ELSE 3
                END), (COALESCE(o.confidence_score, 0::numeric)) DESC, o.observed_at DESC) AS rn
           FROM vehicle_observations o
             JOIN observation_properties op ON op.id = o.property_id
          WHERE o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'::text AND o.is_superseded = false AND (o.source_observation_id IS NULL OR (EXISTS ( SELECT
                   FROM vehicle_observations dp
                   JOIN observation_sources ds ON ds.id=dp.source_id AND ds.slug='bat'
                   JOIN vehicles dv ON dv.id=dp.vehicle_id AND dv.is_public IS TRUE AND dv.deleted_at IS NULL AND dv.listing_kind IS DISTINCT FROM 'non_vehicle_item'
                   JOIN observation_properties dr ON dr.id=o.property_id AND dr.property_key=o.structured_data->>'property_key' AND dr.namespace='core' AND dr.deprecated_at IS NULL
                  WHERE dp.id=o.source_observation_id AND (
                   (o.kind::text=ANY(ds.supported_observations::text[]) AND o.kind::text=ANY(dr.applies_to_kinds::text[])
                    AND retained_description_property_value_matches(dp.*,o.*)) OR
                   ('specification'=ANY(ds.supported_observations) AND 'specification'=ANY(dr.applies_to_kinds)
                    AND dr.ratified_at IS NOT NULL AND dr.unit IS NULL
                    AND dr.data_type=CASE WHEN dr.property_key='year' THEN 'integer' ELSE 'string' END
                    AND dr.label=CASE dr.property_key WHEN 'year' THEN 'Model Year' WHEN 'make' THEN 'Make' ELSE 'Model' END
                    AND retained_listing_identity_value_matches(dp.*,o.*))))) OR (EXISTS ( SELECT 1
                   FROM vehicle_observations rp
                     JOIN observation_sources rs ON rs.id = rp.source_id AND rs.slug = 'bat'::text
                     JOIN vehicles rv ON rv.id = rp.vehicle_id AND rv.is_public IS TRUE AND rv.deleted_at IS NULL AND rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text
                     JOIN observation_properties rk ON rk.id = o.property_id AND (rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text, 'engine_configuration'::text, 'engine_displacement_l'::text, 'transmission_type'::text, 'drivetrain_layout'::text])) AND rk.namespace = 'core'::text AND rk.deprecated_at IS NULL
                  WHERE rp.id = o.source_observation_id AND rp.id <> o.id AND rp.vehicle_id = o.vehicle_id AND rp.source_id = o.source_id AND rp.source_url = o.source_url AND rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE AND rp.property_id IS NULL AND rp.subject_type = 'vehicle'::text AND rp.subject_id IS NULL AND rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text AND rp.confidence_score >= 0.6 AND rp.confidence_score <= 1::numeric AND isfinite(rp.ingested_at) AND o.kind::text = 'specification'::text AND o.extraction_method = 'retained_listing_property_projection_v1'::text AND (o.structured_data ->> 'source_observation_id'::text) = rp.id::text AND (o.structured_data -> rk.property_key) =
                        CASE
                            WHEN rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text]) THEN rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'exterior_color'::text THEN 'color'::text
                                ELSE 'interior_color'::text
                            END
                            ELSE retained_powertrain_value(rk.property_key, rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'transmission_type'::text THEN 'transmission'::text
                                WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                                ELSE 'engine_size'::text
                            END)
                        END AND ((rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])) OR (o.structured_data -> 'source_value'::text) = (rp.structured_data ->
                        CASE rk.property_key
                            WHEN 'transmission_type'::text THEN 'transmission'::text
                            WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                            ELSE 'engine_size'::text
                        END) AND (o.structured_data ->> 'normalization_version'::text) = 'retained_powertrain_v1'::text) AND (o.structured_data ->> 'claim_role'::text) = 'listing_claim'::text AND (o.structured_data ->> 'observed_at_basis'::text) = 'source_testimony_recorded_at'::text AND o.observed_at = rp.ingested_at AND o.confidence_score >= 0::numeric AND o.confidence_score <= 0.6))) AND o.property_id IS NOT NULL AND o.rank::text <> 'deprecated'::text
        )
 SELECT vehicle_id,
    property_id,
    observation_id,
    structured_data,
    content_text,
    confidence_score,
    observed_at,
    source_id,
    kind,
    rank,
    changeset_id,
    discriminator_value
   FROM ranked
  WHERE rn = 1;;

-- Revisit only exhausted operational requests from the enum-comparison incident.
-- Retain exact pre-recheck work receipts in the existing replay receipt, never testimony.
DO $$ DECLARE receipt jsonb; BEGIN
 PERFORM set_config('app.writer','ingest-observation:retained-listing',true);
 WITH picked AS MATERIALIZED (
  SELECT q.* FROM public.retained_listing_property_work q
  WHERE q.status='failed' AND q.attempts=3 AND q.last_error='canonical_request_failed'
   AND q.property_id IN('c0f743ae-dc94-4dfd-98ef-514b76f74a9b','66b2f1f6-b714-4ac0-85b6-60ba89529c1a','235aed17-9bd3-4886-90be-9b1a8e2d1844')
   AND q.next_attempt_at BETWEEN '2026-10-10T23:10:48Z'::timestamptz AND '2026-10-10T23:51:55Z'::timestamptz
  ORDER BY q.next_attempt_at,q.source_observation_id,q.property_id LIMIT 500 FOR UPDATE SKIP LOCKED
 ), repaired AS (
  UPDATE public.retained_listing_property_work q SET status='pending',attempts=0,next_attempt_at=clock_timestamp()+interval '1 minute',
   last_error='enum_membership_incident_recheck'
  FROM picked p WHERE q.source_observation_id=p.source_observation_id AND q.property_id=p.property_id
  RETURNING q.source_observation_id,q.property_id
 ) SELECT jsonb_build_object('recovered_at',clock_timestamp(),'incident','20261010_enum_membership',
  'cap',500,'requeued',(SELECT count(*) FROM repaired),
  'previous_work',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY next_attempt_at,source_observation_id,property_id) FROM picked p),'[]'::jsonb)) INTO receipt;
 UPDATE public.retained_listing_property_replay SET previous_scan_receipt=coalesce(previous_scan_receipt,'{}'::jsonb)||
  jsonb_build_object('enum_failure_retry_recovery',receipt) WHERE id;
END $$;
COMMIT;
