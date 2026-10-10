-- Extend the existing property intake to native retained description assertions.
-- Existing raw testimony stays intact. No fetch, inference, new queue or capacity.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active
  AND schedule='* * * * *' AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN
  RAISE EXCEPTION 'Listing owner paused or command changed'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('get_field_provenance(uuid,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'u2wY8Sgjto3phRX6hzil7oED8de7tHxGeTskedInvo0='
 OR encode(sha256(convert_to(pg_get_functiondef('seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'HrG1YTGVqXFKHUHanlgT+6Kw6Ljxo5q9LTLQj4ECHog='
 OR encode(sha256(convert_to(pg_get_functiondef('enqueue_retained_listing_properties(uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'fWezkVo2/oA0SFhx7jJr+MoqDHuHhLVs2QFW674D/iQ='
 OR encode(sha256(convert_to(pg_get_functiondef('validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM '0zQgj3IA8ijFKodCECFgVbtVPgSywopXpLRM6wIfz2Y='
 OR encode(sha256(convert_to(pg_get_functiondef('retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'iqnHryXWMai1glMLvyKXXK4RCet/kctxd1JDzSlZkDo=' THEN RAISE EXCEPTION 'Listing property owner changed'; END IF;
 IF encode(sha256(convert_to(pg_get_viewdef('public.vehicle_canonical'::regclass,true),'UTF8')),'base64') IS DISTINCT FROM 'u2eD+mi4Hr57KI8sDflIpJ9X/7COk3wVKBfsojZ0uAc=' THEN
  RAISE EXCEPTION 'Canonical reader changed'; END IF;
 IF NOT EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND projection_version='retained_listing_six_properties_v1') THEN
  RAISE EXCEPTION 'Expected six-property replay epoch missing'; END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_triggerdef(oid),'UTF8')),'base64') FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='retained_listing_property_intake') IS DISTINCT FROM 'i9zHl321C7OXO0P6LNDiIZlFnhTFMDlgLnwdBv3MD/o=' THEN RAISE EXCEPTION 'Arrival trigger changed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.retained_description_powertrain_witness(p_key text,p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
DECLARE sentence text; candidate jsonb; witness jsonb;
BEGIN
 IF p_key NOT IN('engine_configuration','engine_displacement_l','transmission_type') OR p_key IS NULL
  OR p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL; END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+') t LOOP
  IF sentence !~* '^(This\y|The (car|truck|motorcycle|bike|vehicle|engine|conversion)\y|It\y|Finished in\y|Powered by\y|Power (is ((provided|supplied) by|from)|comes from)\y)'
   OR sentence !~* '(\ypowered by\y|(^|, | and )power (is ((provided|supplied) by|from)|comes from)\y)' THEN CONTINUE; END IF;
  IF octet_length(sentence)>500 OR sentence ~* '\y(unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|replaced|spare|uninstalled|other|another)\y|["“”]' THEN RETURN NULL; END IF;
  IF p_key='transmission_type' AND sentence !~* E'\\y(manual|automatic|cvt|semi)[ \t]+(transmission|transaxle|gearbox)\\y' THEN CONTINUE; END IF;
  candidate:=public.retained_powertrain_value(p_key,to_jsonb(sentence));
  IF candidate IS NULL THEN
   IF (p_key='engine_configuration' AND sentence ~* '\y(v|i|inline|flat)[- ]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\y')
    OR (p_key='engine_displacement_l' AND sentence ~* '\d[ ,.-]*(liter|litre|l|cc|ci)\y')
    OR p_key='transmission_type' THEN RETURN NULL; END IF;
   CONTINUE;
  END IF;
  IF witness IS NOT NULL AND witness->'value' IS DISTINCT FROM candidate THEN RETURN NULL; END IF;
  IF witness IS NULL THEN witness:=jsonb_build_object('source_value',sentence,'value',candidate); END IF;
 END LOOP;
 RETURN witness;
END $$;

CREATE OR REPLACE FUNCTION public.retained_description_property_witness(p public.vehicle_observations,p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE d jsonb:=p.structured_data; captured timestamptz;
BEGIN
 IF p.kind::text IS DISTINCT FROM 'listing' OR p.extraction_method IS DISTINCT FROM 'html_description_capture'
  OR p.is_superseded IS DISTINCT FROM false OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
  OR p.source_url IS NULL OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
  OR p.confidence_score IS NULL OR p.confidence_score NOT BETWEEN 0.6 AND 1
  OR p.observed_at IS NULL OR NOT isfinite(p.observed_at) OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at)
  OR d->>'extractor' IS DISTINCT FROM 'extract-bat-core'
  OR d->>'source_text_field' IS DISTINCT FROM 'extract-bat-core.extractDescription'
  OR d->'description_capture' IS DISTINCT FROM 'true'::jsonb OR d->'extractor_input_truncated' IS DISTINCT FROM 'false'::jsonb
  OR d->>'source_capture_basis' IS NULL OR d->>'source_capture_basis' NOT IN('direct_fetch','protected_snapshot')
  OR d->>'source_capture_sha256' IS NULL OR d->>'source_capture_sha256' !~ '^[0-9a-f]{64}$'
  OR d->>'observation_time_basis' IS DISTINCT FROM 'source_capture' OR d->>'source_event_time_status' IS DISTINCT FROM 'unknown'
  OR d->>'source_captured_at' IS NULL OR d->>'source_captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$' THEN RETURN NULL; END IF;
 BEGIN captured:=(d->>'source_captured_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL; END;
 IF captured IS DISTINCT FROM p.observed_at OR captured>p.ingested_at THEN RETURN NULL; END IF;
 RETURN public.retained_description_powertrain_witness(p_key,p.content_text);
END $$;

-- One native custody proof is shared by admission, completion and both readers.
-- Security invoker; no new write privileges or independently asserted facts.
CREATE OR REPLACE FUNCTION public.retained_description_property_matches(p public.vehicle_observations,o public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE k text:=o.structured_data->>'property_key'; w jsonb; d jsonb:=o.structured_data;
BEGIN
 w:=public.retained_description_property_witness(p,k);
 IF w IS NULL THEN RETURN false; END IF;
 RETURN coalesce(
  o.id<>p.id AND o.source_observation_id=p.id AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
  AND o.kind::text='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.observed_at=p.ingested_at AND o.extraction_method='retained_listing_property_projection_v1'
  AND o.source_identifier='retained_listing_'||k||'_v1:'||p.id::text AND o.raw_source_ref='vehicle_observations:'||p.id::text
  AND o.confidence_score BETWEEN 0 AND 0.6 AND o.agent_cost_cents=0 AND o.agent_model IS NULL AND o.content_hash IS NOT NULL
  AND d->k=w->'value' AND d->'source_value'=w->'source_value' AND d->>'normalization_version'='retained_powertrain_v1'
  AND d->>'source_witness_version'='retained_description_powertrain_v1'
  AND d->'source_capture_sha256'=p.structured_data->'source_capture_sha256'
  AND d->>'source_field'='content_text' AND d->>'source_observation_id'=p.id::text
  AND d->>'analysis_kind'='retained_listing_property_projection' AND d->>'projection_version'='retained_listing_'||k||'_v1'
  AND d->>'claim_role'='listing_claim' AND d->>'observed_at_basis'='source_testimony_recorded_at'
  AND d->>'factory_configuration_status'='unknown' AND d->>'current_configuration_status'='unknown' AND d->'independent_source'='false'::jsonb
  AND (d->>'source_recorded_at')::timestamptz=p.ingested_at AND (d->>'source_observed_at')::timestamptz=p.observed_at
  AND d->'source_confidence_score'=to_jsonb(p.confidence_score) AND d->>'source_extraction_method'=p.extraction_method
  AND EXISTS(SELECT FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND EXISTS(SELECT FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations))
  AND EXISTS(SELECT FROM public.observation_properties r WHERE r.id=o.property_id AND r.property_key=k AND r.namespace='core' AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)),false);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.retained_description_powertrain_witness(text,text),public.retained_description_property_witness(public.vehicle_observations,text),public.retained_description_property_matches(public.vehicle_observations,public.vehicle_observations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retained_description_powertrain_witness(text,text),public.retained_description_property_witness(public.vehicle_observations,text),public.retained_description_property_matches(public.vehicle_observations,public.vehicle_observations) TO anon,authenticated,service_role;

DO $owners$
DECLARE f text;a text;b text;
BEGIN
 f:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
 a:='SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;';
 b:=a||$b$
  IF FOUND AND p.extraction_method='html_description_capture' THEN
   IF NOT public.retained_description_property_matches(p,NEW) THEN
    RAISE EXCEPTION 'retained description must match exact source witness' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;$b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Admission source anchor changed'; END IF;
 EXECUTE replace(f,a,b);

 f:=pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure);
 a:=' SELECT EXISTS(';b:=$b$ SELECT EXISTS(SELECT FROM public.vehicle_observations p JOIN public.vehicle_observations o ON o.id=p_result
  WHERE p.id=p_source AND o.property_id=p_property AND public.retained_description_property_matches(p,o)) OR EXISTS($b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Completion source anchor changed'; END IF;
 EXECUTE replace(f,a,b);

 f:=pg_get_functiondef('public.enqueue_retained_listing_properties(uuid)'::regprocedure);
 a:=' GET DIAGNOSTICS n=ROW_COUNT;RETURN n;';
 b:=$b$ GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN (VALUES('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration'),
  ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l'),('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type')) k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=p_source AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;RETURN n+native_count;$b$;
 f:=replace(f,'DECLARE n integer;','DECLARE n integer;native_count integer;');
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Enqueue receipt anchor changed'; END IF;
 EXECUTE replace(f,a,b);

 f:=pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure);
 a:='o.source_observation_id IS NULL OR EXISTS (';
 b:='o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND public.retained_description_property_matches(dp,o)) OR EXISTS (';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Provenance custody anchor changed'; END IF;
 f:=replace(f,a,b);
 a:=$a$'normalization_version',o.structured_data->>'normalization_version',$a$;
 b:=a||$b$
            'source_witness_version',o.structured_data->>'source_witness_version',
            'source_capture_sha256',o.structured_data->>'source_capture_sha256',$b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Provenance witness output changed'; END IF;
 EXECUTE replace(f,a,b);

 f:=pg_get_viewdef('public.vehicle_canonical'::regclass,true);
 a:='o.source_observation_id IS NULL OR (EXISTS (';
 b:='o.source_observation_id IS NULL OR EXISTS (SELECT FROM public.vehicle_observations dp WHERE dp.id=o.source_observation_id AND public.retained_description_property_matches(dp,o)) OR (EXISTS (';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Canonical custody anchor changed'; END IF;
 EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_canonical AS '||replace(f,a,b);
END $owners$;

DROP TRIGGER retained_listing_property_intake ON public.vehicle_observations;
CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations
 FOR EACH ROW WHEN(NEW.kind='listing' AND NEW.extraction_method IN('html_match','html_description_capture'))
 EXECUTE FUNCTION public.trg_enqueue_retained_listing_properties();

ALTER TABLE public.retained_listing_property_replay DROP CONSTRAINT retained_listing_property_replay_projection_version_check;
ALTER TABLE public.retained_listing_property_replay ADD CONSTRAINT retained_listing_property_replay_projection_version_check
 CHECK(projection_version IN('retained_colors_v1','retained_listing_six_properties_v1','retained_description_powertrain_v1'));
UPDATE public.retained_listing_property_replay r SET previous_scan_receipt=to_jsonb(r),
 projection_version='retained_description_powertrain_v1',upper_recorded_at=p.ingested_at,upper_source_id=p.id,
 cursor_recorded_at=NULL,cursor_source_id=NULL,reverse_cursor_recorded_at=NULL,reverse_cursor_source_id=NULL,
 keys_seen=0,work_seeded=0,started_at=clock_timestamp(),last_seed_at=NULL,scan_direction='newest',
 scan_completed_at=CASE WHEN p.id IS NULL THEN clock_timestamp() END
 FROM (SELECT true AS singleton) one LEFT JOIN LATERAL(SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at) ORDER BY ingested_at DESC,id DESC LIMIT 1)p ON true WHERE r.id;
DO $$ DECLARE j bigint;BEGIN SELECT jobid INTO STRICT j FROM cron.job WHERE jobname='project-retained-listing-properties';
 PERFORM cron.alter_job(job_id:=j,active:=false);END $$;
COMMENT ON FUNCTION public.retained_description_powertrain_witness(text,text) IS 'Deterministic native description witness v1: explicit power assertion, exact sentence <=500UTF8bytes, three existing core keys, conflicts/qualifiers omitted; listing claim, no factory/current assertion.';
COMMENT ON FUNCTION public.retained_description_property_witness(public.vehicle_observations,text) IS 'Native extract-bat-core full-description capture custody: actual finite capture clock and SHA, nontruncated source text, source event time unknown; typed value and verbatim sentence or NULL.';
COMMENT ON FUNCTION public.retained_description_property_matches(public.vehicle_observations,public.vehicle_observations) IS 'Shared exact source-child proof for native description intake, queue completion and public readers; rechecks public parent, ratified key, source quote/value/SHA, independent clocks and unknown configuration.';
COMMENT ON COLUMN public.retained_listing_property_replay.projection_version IS 'Finite scan epoch: original colors, six structured properties, or retained_description_powertrain_v1 including three powertrain keys from native descriptions. Existing claims and completed work retained.';
COMMENT ON COLUMN public.retained_listing_property_replay.previous_scan_receipt IS 'Nested dated scan receipts preserved at each vocabulary expansion. Operational visits/keys are not vehicle coverage. No source testimony is rewritten.';
NOTIFY pgrst,'reload schema';
COMMIT;
