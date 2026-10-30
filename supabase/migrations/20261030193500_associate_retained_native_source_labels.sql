-- Associate retained native labels from older unstamped captures by the exact
-- public record URL and literal native year/make/model. No physical identity
-- resolution, capture rewrite, external fetch, model or capacity change.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_native_listing_source(public.vehicle_observations)'::regprocedure),'UTF8')),'base64')<>'czowBXftTeDMxviW1FQCY8CSNIi1Lmt/PN09oZsdHpQ=' THEN
 RAISE EXCEPTION 'Retained native source owner changed';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_native_listing_source)')>2 THEN
 RAISE EXCEPTION 'Relevant source work active';END IF;
END $guard$;
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
      regexp_replace(lower((p.structured_data->>'model')||' '||coalesce(p.structured_data->>'trim','')),'[^a-z0-9]','','g'))))));
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $function$
;
DO $locks$ BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
 RAISE EXCEPTION 'Lock wait detected; rollback native source association';END IF;
END $locks$;
NOTIFY pgrst,'reload schema';
COMMIT;

