-- Current retained property owners captured before the McCormick extension.
CREATE OR REPLACE FUNCTION public.retained_native_listing_source(p vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE snap uuid;captured timestamptz;archived timestamptz;
BEGIN
 -- Fast refusal before protected reads; every remaining lookup is a primary key.
 IF p.source_id NOT IN('fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid,'755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid)
  OR p.extraction_method NOT IN('next_data_json_parse','retained_native_fields_v1')
  OR p.kind::text NOT IN('listing','sale_result') OR p.is_superseded IS DISTINCT FROM false
  OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.6 AND 1
  OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at) OR p.ingested_at>statement_timestamp()
  OR (p.observed_at IS NOT NULL AND (NOT isfinite(p.observed_at) OR p.observed_at>statement_timestamp())) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT FROM public.vehicle_observations q JOIN public.vehicles v ON v.id=q.vehicle_id
  JOIN public.observation_sources s ON s.id=q.source_id AND 'specification'=ANY(s.supported_observations)
  WHERE q.id=p.id AND q.vehicle_id=p.vehicle_id AND q.source_id=p.source_id AND q.source_url=p.source_url
   AND q.kind=p.kind AND q.is_superseded IS FALSE AND q.property_id IS NULL AND q.subject_type='vehicle' AND q.subject_id IS NULL
   AND q.extraction_method=p.extraction_method AND q.structured_data=p.structured_data AND q.raw_source_ref IS NOT DISTINCT FROM p.raw_source_ref
   AND q.observed_at IS NOT DISTINCT FROM p.observed_at AND q.ingested_at=p.ingested_at AND q.confidence_score=p.confidence_score
   AND public.observation_is_public(q.kind,q.structured_data)
   AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   AND ((s.slug='mecum' AND q.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$')
     OR(s.slug='barrett-jackson' AND q.source_url ~ '^https://(www[.])?barrett-jackson[.]com/[^/?#]+/docket/vehicle/[^/?#]+/?$'))) THEN RETURN false;END IF;
 IF p.extraction_method='next_data_json_parse' THEN RETURN p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid;END IF;
 IF p.kind::text<>'listing' OR p.structured_data->>'source_profile' IS DISTINCT FROM 'retained_native_fields_v1'
  OR p.structured_data->>'extractor' IS DISTINCT FROM 'batch-extract-snapshots'
  OR p.structured_data->>'source_event_time_status' IS DISTINCT FROM 'unknown'
  OR p.structured_data->>'claim_role' IS DISTINCT FROM 'extractor_claim'
  OR coalesce(p.structured_data->>'source_capture_sha256','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p.raw_source_ref,'') !~ '^listing_page_snapshots:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR p.structured_data->>'source_captured_at' IS NULL OR p.structured_data->>'source_archive_ingested_at' IS NULL THEN RETURN false;END IF;
 snap:=substr(p.raw_source_ref,24)::uuid;
 captured:=(p.structured_data->>'source_captured_at')::timestamptz;
 archived:=(p.structured_data->>'source_archive_ingested_at')::timestamptz;
 IF NOT isfinite(captured) OR NOT isfinite(archived) OR captured IS DISTINCT FROM p.observed_at OR archived<captured OR archived>p.ingested_at THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.listing_page_snapshots s WHERE s.id=snap AND s.success IS TRUE AND s.http_status=200
  AND s.platform=CASE p.source_id WHEN 'fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid THEN 'mecum' ELSE 'barrett-jackson' END
  AND s.listing_url=p.source_url AND s.html_sha256=p.structured_data->>'source_capture_sha256'
  AND s.fetched_at=captured AND s.created_at=archived
  AND ((s.metadata->>'vehicle_id'=p.vehicle_id::text AND s.metadata->'vehicle_matched'='true'::jsonb)
   OR (p.structured_data->>'source_association_basis'='exact_record_url_and_native_labels'
    AND (s.metadata->>'vehicle_id' IS NULL OR s.metadata->>'vehicle_id'=p.vehicle_id::text)
    AND (s.metadata->'vehicle_matched' IS NULL OR s.metadata->'vehicle_matched'='null'::jsonb)
    AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE
     AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
     AND EXISTS(SELECT FROM unnest(ARRAY[v.listing_url,v.discovery_url]) u(url)
      WHERE regexp_replace(regexp_replace(lower(split_part(split_part(u.url,'?',1),'#',1)),'^https?://(www[.])?',''),'/+$','')
       =regexp_replace(regexp_replace(lower(p.source_url),'^https?://(www[.])?',''),'/+$',''))
     AND jsonb_typeof(p.structured_data->'year')='number' AND p.structured_data->>'year'=v.year::text
     AND regexp_replace(lower(p.structured_data->>'make'),'[^a-z0-9]','','g')<>''
     AND regexp_replace(lower(p.structured_data->>'make'),'[^a-z0-9]','','g')=regexp_replace(lower(v.make),'[^a-z0-9]','','g')
     AND regexp_replace(lower(p.structured_data->>'model'),'[^a-z0-9]','','g')<>''
     AND regexp_replace(lower(v.model),'[^a-z0-9]','','g') IN(
      regexp_replace(lower(p.structured_data->>'model'),'[^a-z0-9]','','g'),
      regexp_replace(lower((p.structured_data->>'model')||' '||coalesce(p.structured_data->>'publisher_style_label',p.structured_data->>'trim','')),'[^a-z0-9]','','g'))))));
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_value_matches(p vehicle_observations, o vehicle_observations)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
-- retained_bat_sale_properties_v1
DECLARE k text:=o.structured_data->>'property_key';d jsonb:=o.structured_data;value jsonb;
BEGIN
 value:=public.retained_listing_identity_value(k,p.structured_data->k);
 IF value IS NULL THEN RETURN false;END IF;
 RETURN coalesce((((p.kind='listing' OR (p.kind='sale_result' AND p.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND public.observation_is_public(p.kind,p.structured_data))) AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data))) OR public.retained_native_listing_source(p)) AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND (((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$')) OR public.retained_native_listing_source(p)) AND p.confidence_score BETWEEN 0.6 AND 1
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
  AND (k<>'vin' OR (d->>'vin_identifier_namespace'='standard_17_character_vin_label' AND d->>'vin_format_status'='17_character_format' AND d->>'vin_checksum_status'='not_evaluated'))
  AND d->>'source_event_time_status'='unknown' AND d->>'factory_configuration_status'='unknown'
  AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at
  AND (d->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
,false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION public.retained_listing_identity_value(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE raw text;n numeric;
BEGIN
 IF p_key='year' THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN NULL;END IF;
  n:=(p_value#>>'{}')::numeric;
  RETURN CASE WHEN n=trunc(n) AND n BETWEEN 1800 AND 2100 THEN p_value END;
 ELSIF p_key='vin' THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL;END IF;
  raw:=p_value#>>'{}';
  RETURN CASE WHEN length(raw)=17 AND raw !~ '[^ABCDEFGHJKLMNPRSTUVWXYZ0123456789]'
   AND raw ~ '[0123456789]' AND raw !~ '^(.)\1+$' THEN p_value END;
 ELSIF p_key IN('make','model') THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL;END IF;
  raw:=p_value#>>'{}';
  RETURN CASE WHEN raw=btrim(raw,E' \t\r\n') AND length(raw) BETWEEN 1 AND 120
   AND raw !~ '[[:cntrl:]]' AND raw !~* '^(unknown|unspecified|n/a|none|null|tbd|unidentified|other)$' THEN p_value END;
 END IF;RETURN NULL;
END $function$;
