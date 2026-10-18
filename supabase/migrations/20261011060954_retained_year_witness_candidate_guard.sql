-- Current native-year reader cost: skip already-ineligible tuples before parsing.
-- The dense fixed50-vehicle all-field read timed out in year witness initialization;
-- the same50 year-only UUID-bound slice passed4.15s. No eligibility or replay change.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query~'(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work active';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_year_text_witness(text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'ar6uCflxCNidr9ecI+L7pXDielLIKZLsLVV0bt3DVLg=' THEN RAISE EXCEPTION 'Native year owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_year_value_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'UUCQuAtbuns8UpTB4yqze45H7YYCpyGKb8mLlizQ/o8=' THEN RAISE EXCEPTION 'Native year owner changed';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.retained_description_year_text_witness(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;m text[];n integer;
BEGIN
 IF p_text IS NULL OR octet_length(p_text) NOT BETWEEN 100 AND 32000 THEN RETURN NULL;END IF;
 sentence:=btrim((regexp_split_to_array(p_text,E'(?<=[.!?])[ \\t\\r\\n]+|[\\r\\n]+'))[1],E' \t\r\n');
 IF octet_length(sentence)>500 THEN RETURN NULL;END IF;
 m:=regexp_match(sentence COLLATE pg_catalog."C",$re$(?:^This ([0-9]{4}) ([A-Za-z][A-Za-z0-9 ./'’′+-]{0,119}?) (?:is|was|has|had|remained|features)\y){1,1}?$re$);
 IF m IS NULL OR m[2] ~* '\y(engine|motor|transmission|transaxle|gearbox|chassis|frame|body|panel|parts|replica|scale|memorabilia|artwork|collection)\y'
  OR m[2] ~* '^model\y' THEN RETURN NULL;END IF;
 n:=m[1]::integer;IF n NOT BETWEEN 1800 AND 2100 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('value',n,'source_value',sentence,'source_year_token',m[1],'source_subject_label',m[2]);
END $function$
;
CREATE OR REPLACE FUNCTION public.retained_description_year_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE w jsonb;d jsonb:=o.structured_data;
BEGIN
 -- These are already necessary conditions below. Refuse unrelated candidates
 -- before the native parser, including other fields of the same source parent.
 IF o.property_id IS DISTINCT FROM 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid
  OR o.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1'
  OR d->>'source_profile' IS DISTINCT FROM 'bat_description_year_label_v1' THEN RETURN false;END IF;
 w:=public.retained_description_property_witness(p,'year');
 IF w IS NULL THEN RETURN false;END IF;
 RETURN coalesce(o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
  AND o.property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid
  AND o.source_identifier='retained_listing_year_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->'year'=w->'value' AND d->'source_value'=w->'source_value' AND d->'source_year_token'=w->'source_year_token'
  AND d->'source_subject_label'=w->'source_subject_label'
  AND d->>'source_profile'='bat_description_year_label_v1' AND d->>'year_label_basis'='native_listing_subject_introduction'
  AND d->>'identity_role'='extractor_vehicle_label' AND d->>'identity_resolution_status'='unverified'
  AND d->>'normalization_version'='retained_description_year_label_v1' AND d->>'source_witness_version'='retained_description_year_label_v1'
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_observation_id'=p.id::text AND d->>'property_key'='year' AND d->>'source_field'='content_text'
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_year_v1' AND d->>'claim_role'='listing_claim'
  AND d->>'observed_at_basis'='source_testimony_recorded_at' AND d->>'source_extraction_method'=p.extraction_method
  AND CASE WHEN pg_catalog.pg_input_is_valid(d->>'source_recorded_at','timestamptz') AND pg_catalog.pg_input_is_valid(d->>'source_observed_at','timestamptz')
   THEN (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at ELSE false END
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score)
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown'
  AND d->'independent_source'='false'::jsonb,false);
END $function$
;
COMMIT;
