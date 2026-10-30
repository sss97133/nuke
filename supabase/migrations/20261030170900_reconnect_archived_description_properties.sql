-- Reconnect protected archived descriptions to deterministic property admission.
-- Existing source custody, privacy, registry and queue owners remain in force.
-- No raw testimony/vehicle rewrite, external fetch, model or schedule.
-- The new public eligibility boolean returns no protected capture content.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_witness(public.vehicle_observations,text)'::regprocedure),'UTF8')),'base64')<>'4Q/7E3tSWqJOl3SiR2uhgZVPsZy+5H3A+6wJSoREGmM=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.retained_description_presentation_witness(text,text)'::regprocedure),'UTF8')),'base64')<>'a8Xar/ZArhbTa4F3QYj0cuLl3KY7sxTnlVLC4Yhw4jE=' THEN
 RAISE EXCEPTION 'Retained description owners changed; review archive extraction repair';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property)')>2 THEN RAISE EXCEPTION 'Relevant data work active';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.retained_description_presentation_witness(p_key text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;finish text[];interior text[];drive text[];value text;w jsonb;route text[];selectable boolean;qualified_text text;
BEGIN
 IF p_key NOT IN('interior_color','exterior_color','drivetrain_layout') OR p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL;END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+')t LOOP
  finish:=regexp_match(sentence,'(?:^(?:Finished|The (?:car|truck|vehicle|motorcycle|bike) is (?:finished|refinished)|It is (?:finished|refinished)) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) over ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  interior:=regexp_match(sentence,'(?:^The (?:cabin|interior|seats) (?:is|are) (?:trimmed|upholstered|finished) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  route:=regexp_match(sentence,'^(?:Power is (?:sent|delivered|routed)|The \d+(?:\.\d+)?(?:-lit(?:er|re)|ci) (?:V\d{1,2}|inline[- ](?:four|six|\d)|flat[- ](?:four|six|\d)) (?:routes|sends|delivers) power) to (?:the )?','i');
  drive:=CASE WHEN route IS NOT NULL THEN regexp_match(substr(sentence,length(route[1])+1),'^(rear or all four|rear|front) wheels?\y','i') END;
  selectable:=lower(drive[1])='rear or all four';
  IF p_key='drivetrain_layout' AND selectable AND (sentence !~* '\y(dual[- ]range|two[- ]speed|2[- ]speed|part[- ]time) transfer case\y'
   OR sentence ~* '\y(if|when|only|all[- ]wheel|AWD|front[- ]wheel)\y') THEN RETURN NULL;END IF;
  IF p_key='drivetrain_layout' AND NOT coalesce(selectable,false) AND (sentence ~* '^Power is (sent|delivered|routed)\y' OR route IS NOT NULL) AND drive IS NULL THEN RETURN NULL;END IF;
  value:=CASE p_key WHEN 'drivetrain_layout' THEN CASE WHEN drive IS NULL THEN NULL WHEN selectable THEN '4WD' WHEN lower(drive[1])='rear' THEN 'RWD' ELSE 'FWD' END
   WHEN 'exterior_color' THEN finish[1] ELSE coalesce(finish[2],interior[1]) END;
  IF value IS NULL THEN CONTINUE;END IF;
  qualified_text:=CASE WHEN p_key='drivetrain_layout' AND selectable THEN regexp_replace(sentence,'\yrear or all four wheels?\y','selectable wheels','i') ELSE sentence END;
  IF octet_length(sentence)>500 OR qualified_text ~* '\y(unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|spare|uninstalled|other|another)\y|["“”]'
   OR value<>btrim(value,E' \t\r\n') OR value ~* '\yand\y' THEN RETURN NULL;END IF;
  IF p_key='drivetrain_layout' AND NOT coalesce(selectable,false) AND (sentence ~* '\y(if|when|only|transfer case|all four|all[- ]wheel|four[- ]wheel|AWD|4WD)\y'
   OR (value='RWD' AND sentence ~* '\yfront\y') OR (value='FWD' AND sentence ~* '\yrear\y')) THEN RETURN NULL;END IF;
  IF w IS NOT NULL AND w->>'value'<>value THEN RETURN NULL;END IF;
  IF w IS NULL THEN w:=jsonb_build_object('source_value',sentence,'value',value);END IF;
 END LOOP;RETURN w;
END $function$
;
CREATE OR REPLACE FUNCTION public.retained_description_property_witness(p vehicle_observations, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE d jsonb:=p.structured_data; captured timestamptz;
BEGIN
 IF p.kind::text IS DISTINCT FROM 'listing' OR p.extraction_method IS DISTINCT FROM 'html_description_capture'
  OR p.is_superseded IS DISTINCT FROM false OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.source_url IS NULL OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.6 AND 1
  OR p.observed_at IS NULL OR NOT isfinite(p.observed_at) OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
  OR d->>'extractor' IS DISTINCT FROM 'extract-bat-core'
  OR NOT coalesce((d->>'source_text_field'='extract-bat-core.extractDescription' OR
   (d->>'source_capture_basis'='protected_snapshot' AND d->>'source_text_field'='listing_page_snapshots.html:batParser.extractDescription'
    AND p.raw_source_ref ~* '^listing_page_snapshots:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')),false)
  OR d->'description_capture' IS DISTINCT FROM 'true'::jsonb OR d->'extractor_input_truncated' IS DISTINCT FROM 'false'::jsonb
  OR d->>'source_capture_basis' IS NULL OR d->>'source_capture_basis' NOT IN('direct_fetch','protected_snapshot')
  OR d->>'source_capture_sha256' IS NULL OR d->>'source_capture_sha256' !~ '^[0-9a-f]{64}$'
  OR d->>'observation_time_basis' IS DISTINCT FROM 'source_capture' OR d->>'source_event_time_status' IS DISTINCT FROM 'unknown'
  OR d->>'source_captured_at' IS NULL OR d->>'source_captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$' THEN RETURN NULL; END IF;
 BEGIN captured:=(d->>'source_captured_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL; END;
 IF captured IS DISTINCT FROM p.observed_at OR captured>p.ingested_at THEN RETURN NULL; END IF;
 RETURN CASE WHEN p_key IN('make','model') THEN public.retained_description_identity_text_witness(p_key,p.content_text) WHEN p_key='year' THEN public.retained_description_year_text_witness(p.content_text) WHEN p_key='mileage_miles' THEN public.retained_odometer_witness(p.content_text)
  WHEN p_key IN('interior_color','exterior_color','drivetrain_layout') THEN public.retained_description_presentation_witness(p_key,p.content_text)
  ELSE public.retained_description_powertrain_witness(p_key,p.content_text) END;
END $function$
;
-- Native auction field activation follows decoder deployment.
DO $native_guard$ BEGIN
 IF to_regprocedure('public.retained_native_listing_source(public.vehicle_observations)') IS NOT NULL THEN RAISE EXCEPTION 'Native source qualification already owned';END IF;
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN RAISE EXCEPTION 'Retained intake paused or changed';END IF;
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE id='755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid AND slug='barrett-jackson'
  AND 'listing'=ANY(supported_observations) AND NOT('specification'=ANY(supported_observations))) THEN RAISE EXCEPTION 'Native source capability changed';END IF;
 IF NOT EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND record_replay->>'version'='retained_vehicle_properties_v1') THEN RAISE EXCEPTION 'Record replay changed';END IF;
END $native_guard$;
UPDATE public.observation_sources SET supported_observations=array_append(supported_observations,'specification'::public.observation_kind)
 WHERE id='755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid AND slug='barrett-jackson';
CREATE FUNCTION public.retained_native_listing_source(p public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $source$
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
  AND s.metadata->>'vehicle_id'=p.vehicle_id::text AND s.metadata->'vehicle_matched'='true'::jsonb);
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $source$;
REVOKE ALL ON FUNCTION public.retained_native_listing_source(public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_native_listing_source(public.vehicle_observations) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.retained_native_listing_source(public.vehicle_observations) IS
'Current eligibility boolean for existing public Mecum native-JSON extractor claims and protected native-field receipts. Reads exact parent/vehicle/source/snapshot keys only; returns no protected content. Retained extractor claims, not physical identity or factory/current verification. Shared by existing intake, canonical reader and queue owners.';

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.retained_listing_identity_value_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'mlN4ltHWLrFkXYnYRUX8/9O1OllVaxY09sbnDg24cKQ=' THEN RAISE EXCEPTION 'retained_listing_identity_value_matches changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$(p.kind::text='listing' AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old0$,'')))/length($old0$(p.kind::text='listing' AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$(p.kind::text='listing' AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old0$,$new0$((p.kind::text='listing' AND p.extraction_method='html_match' OR (p.kind::text IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND p.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND k IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data))) OR public.retained_native_listing_source(p))$new0$);
 IF (length(f)-length(replace(f,$old1$AND ((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old1$,'')))/length($old1$AND ((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$AND ((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old1$,$new1$AND (((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$')) OR public.retained_native_listing_source(p))$new1$);
 EXECUTE f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.retained_listing_identity_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'H2mJqo+Bu3KfAg+xZ+3XfgamRdzC382J9AB2feo5e0A=' THEN RAISE EXCEPTION 'retained_listing_identity_matches changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$(s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model')))$old0$,'')))/length($old0$(s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model')))$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$(s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model')))$old0$,$new0$((s.slug='bat' OR (s.slug='mecum' AND p.extraction_method='public_lot_index' AND o.structured_data->>'property_key' IN('year','make','model'))) OR public.retained_native_listing_source(p))$new0$);
 EXECUTE f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'B0ynCez8l7CvVmo5elYXyl/h4e5b4jHp6LzTZjvXEhE=' THEN RAISE EXCEPTION 'validate_retained_listing_property_source changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$BEGIN

  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN$old0$,'')))/length($old0$BEGIN

  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$BEGIN

  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN$old0$,$new0$BEGIN
  IF TG_OP='INSERT' AND (NEW.extraction_method='retained_native_fields_v1'
   OR NEW.structured_data->>'source_profile'='retained_native_fields_v1'
   OR (NEW.extraction_method='next_data_json_parse' AND NEW.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid))
   AND current_user NOT IN('postgres','service_role') THEN
   RAISE EXCEPTION 'Native extractor receipts require service role' USING ERRCODE='42501';END IF;
  IF TG_OP='INSERT' AND NEW.source_id='755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid AND NEW.kind::text='specification'
   AND (NEW.extraction_method IS DISTINCT FROM 'retained_listing_property_projection_v1' OR NEW.source_observation_id IS NULL OR NEW.property_id IS NULL) THEN
   RAISE EXCEPTION 'Native specifications require canonical retained source custody' USING ERRCODE='23514';END IF;

  IF TG_OP='UPDATE' AND OLD.extraction_method='protected_cab_listing_capture_v1' THEN$new0$);
 IF (length(f)-length(replace(f,$old1$OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old1$,'')))/length($old1$OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$OR p.extraction_method IS DISTINCT FROM 'html_match'
    OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old1$,$new1$OR NOT ((p.kind::text='listing' AND p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR public.retained_native_listing_source(p))$new1$);
 IF (length(f)-length(replace(f,$old2$IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false$old2$,'')))/length($old2$IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false$old2$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old2$IF NOT FOUND OR p.kind::text IS DISTINCT FROM 'listing' OR p.is_superseded IS DISTINCT FROM false$old2$,$new2$IF NOT FOUND OR p.is_superseded IS DISTINCT FROM false$new2$);
 IF (length(f)-length(replace(f,$old3$s.id=p.source_id AND s.slug='bat') THEN$old3$,'')))/length($old3$s.id=p.source_id AND s.slug='bat') THEN$old3$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old3$s.id=p.source_id AND s.slug='bat') THEN$old3$,$new3$s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))) THEN$new3$);
 EXECUTE f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'vnyvGz3Ve1jkLM695kmNwvD3OvTvUpjSX3ZNjXWYZFU=' THEN RAISE EXCEPTION 'retained_listing_property_result_matches changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$s.id=p.source_id AND s.slug='bat'$old0$,'')))/length($old0$s.id=p.source_id AND s.slug='bat'$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$s.id=p.source_id AND s.slug='bat'$old0$,$new0$s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))$new0$);
 IF (length(f)-length(replace(f,$old1$p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE$old1$,'')))/length($old1$p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE$old1$,$new1$((p.kind='listing' AND p.extraction_method='html_match') OR public.retained_native_listing_source(p)) AND p.is_superseded IS FALSE$new1$);
 IF (length(f)-length(replace(f,$old2$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old2$,'')))/length($old2$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old2$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old2$p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'$old2$,$new2$(p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' OR public.retained_native_listing_source(p))$new2$);
 EXECUTE f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'OzFB1iS8jJlmYNBDRrmrhfFRo8s13GzzmmYdLJt/XGU=' THEN RAISE EXCEPTION 'vehicle_canonical changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$ds.slug = 'bat'::text OR ds.slug = 'mecum'::text AND dp.extraction_method = 'public_lot_index'::text$old0$,'')))/length($old0$ds.slug = 'bat'::text OR ds.slug = 'mecum'::text AND dp.extraction_method = 'public_lot_index'::text$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$ds.slug = 'bat'::text OR ds.slug = 'mecum'::text AND dp.extraction_method = 'public_lot_index'::text$old0$,$new0$ds.slug = 'bat'::text OR ds.slug = 'mecum'::text AND dp.extraction_method = 'public_lot_index'::text OR public.retained_native_listing_source(dp.*)$new0$);
 IF (length(f)-length(replace(f,$old1$rs.id = rp.source_id AND rs.slug = 'bat'::text$old1$,'')))/length($old1$rs.id = rp.source_id AND rs.slug = 'bat'::text$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$rs.id = rp.source_id AND rs.slug = 'bat'::text$old1$,$new1$rs.id = rp.source_id AND (rs.slug = 'bat'::text OR public.retained_native_listing_source(rp.*))$new1$);
 IF (length(f)-length(replace(f,$old2$rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE$old2$,'')))/length($old2$rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE$old2$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old2$rp.kind::text = 'listing'::text AND rp.is_superseded IS FALSE$old2$,$new2$rp.is_superseded IS FALSE$new2$);
 IF (length(f)-length(replace(f,$old3$rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text$old3$,'')))/length($old3$rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text$old3$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old3$rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text$old3$,$new3$((rp.kind::text = 'listing'::text AND rp.extraction_method = 'html_match'::text AND rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text) OR public.retained_native_listing_source(rp.*))$new3$);
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.enqueue_retained_listing_properties(uuid[])'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'pWaMVhwh9e22pgio4A+YEPzXgxbu33gDL1tJS9VRzsE=' THEN RAISE EXCEPTION 'enqueue_retained_listing_properties changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES$old0$,'')))/length($old0$s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES$old0$,$new0$s.id=p.source_id AND (s.slug='bat' OR public.retained_native_listing_source(p))
 CROSS JOIN (VALUES$new0$);
 IF (length(f)-length(replace(f,$old1$p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded$old1$,'')))/length($old1$p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded$old1$,$new1$((p.kind='listing' AND p.extraction_method='html_match') OR public.retained_native_listing_source(p))
 AND p.is_superseded$new1$);
 IF (length(f)-length(replace(f,$old2$AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite$old2$,'')))/length($old2$AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite$old2$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old2$AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite$old2$,$new2$AND (p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' OR public.retained_native_listing_source(p))
 AND isfinite$new2$);
 IF (length(f)-length(replace(f,$old3$s.slug IN('bat','mecum') AND 'specification'$old3$,'')))/length($old3$s.slug IN('bat','mecum') AND 'specification'$old3$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old3$s.slug IN('bat','mecum') AND 'specification'$old3$,$new3$(s.slug IN('bat','mecum') OR public.retained_native_listing_source(p)) AND 'specification'$new3$);
 IF (length(f)-length(replace(f,$old4$((s.slug='bat' AND p.kind='listing' AND p.extraction_method='html_match') OR (s.slug='mecum' AND p.kind IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND k.key IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old4$,'')))/length($old4$((s.slug='bat' AND p.kind='listing' AND p.extraction_method='html_match') OR (s.slug='mecum' AND p.kind IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND k.key IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old4$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old4$((s.slug='bat' AND p.kind='listing' AND p.extraction_method='html_match') OR (s.slug='mecum' AND p.kind IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND k.key IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data)))$old4$,$new4$(((s.slug='bat' AND p.kind='listing' AND p.extraction_method='html_match') OR (s.slug='mecum' AND p.kind IN('listing','sale_result') AND p.extraction_method='public_lot_index' AND k.key IN('year','make','model') AND public.observation_is_public(p.kind,p.structured_data))) OR public.retained_native_listing_source(p))$new4$);
 IF (length(f)-length(replace(f,$old5$((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old5$,'')))/length($old5$((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old5$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old5$((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$'))$old5$,$new5$(((p.extraction_method='html_match' AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$') OR (p.extraction_method='public_lot_index' AND p.source_url ~ '^https://(www[.])?mecum[.]com/lots/[0-9]+/[^/?#]+/?$')) OR public.retained_native_listing_source(p))$new5$);
 EXECUTE f;
END $patch$;

DO $patch$ DECLARE f text;BEGIN
 f:=pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'2kSCR1n5SZyuNd9v9AwJ/ymzXuXAux3YiJDxD6hCIAI=' THEN RAISE EXCEPTION 'seed_retained_listing_properties changed; review native source activation';END IF;
 IF (length(f)-length(replace(f,$old0$WHERE slug IN('bat','mecum','craigslist')$old0$,'')))/length($old0$WHERE slug IN('bat','mecum','craigslist')$old0$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old0$WHERE slug IN('bat','mecum','craigslist')$old0$,$new0$WHERE slug IN('bat','mecum','craigslist','barrett-jackson')$new0$);
 IF (length(f)-length(replace(f,$old1$o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index')$old1$,'')))/length($old1$o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index')$old1$)<>1 THEN RAISE EXCEPTION 'Native source anchor changed';END IF;
 f:=replace(f,$old1$o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index')$old1$,$new1$o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index','next_data_json_parse','retained_native_fields_v1')$new1$);
 EXECUTE f;
END $patch$;
DO $arrival$ BEGIN
 IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake') IS DISTINCT FROM $old$CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN ((((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid)))) OR ((new.kind = ANY (ARRAY['listing'::observation_kind, 'sale_result'::observation_kind])) AND (new.extraction_method = 'public_lot_index'::text) AND (new.source_id = 'fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid)))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties()$old$ THEN RAISE EXCEPTION 'Retained arrival owner changed';END IF;
 EXECUTE $new$CREATE OR REPLACE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW
WHEN ((new.kind='listing'::public.observation_kind AND (new.extraction_method IN('html_match','html_description_capture') OR (new.extraction_method='html_parse' AND new.source_id='d7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid)))
 OR (new.kind IN('listing'::public.observation_kind,'sale_result'::public.observation_kind) AND new.source_id='fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid AND new.extraction_method IN('public_lot_index','next_data_json_parse'))
 OR (new.kind='listing'::public.observation_kind AND new.extraction_method='retained_native_fields_v1' AND new.source_id IN('fee71d50-c59c-4340-b819-cd9a7d074d7f'::uuid,'755185e3-3d21-4373-b806-ddcbf0d5e39c'::uuid)))
EXECUTE FUNCTION public.trg_enqueue_retained_listing_properties()$new$;
END $arrival$;
-- Preserve the exact prior processing checkpoint, then revisit the fixed record
-- horizon for newly supported sources. Existing500-work backpressure stays.
UPDATE public.retained_listing_property_replay SET previous_scan_receipt=coalesce(previous_scan_receipt,'{}'::jsonb)||
 jsonb_build_object('native_fields_replay_previous',jsonb_build_object('record_replay',record_replay,'retained_at',clock_timestamp())),
 record_replay=record_replay||jsonb_build_object('after_vehicle_id','00000000-0000-0000-0000-000000000000',
 'active_vehicle_id',NULL,'after_source_id','00000000-0000-0000-0000-000000000000','vehicles_finished',0,
 'source_keys_seen',0,'work_seeded',0,'started_at',clock_timestamp(),'last_seed_at',NULL,'completed_at',NULL) WHERE id;
DO $locks$ BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN RAISE EXCEPTION 'Lock wait detected; rollback archive extraction repair';END IF;
END $locks$;
NOTIFY pgrst,'reload schema';
COMMIT;

