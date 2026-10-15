-- HELD: complete local release preparation; no production authorization.
-- Enables only protected reported-work activity on the existing BaT source.
-- Publisher-reported completion is an unverified activity, never confirmed
-- work_record/work_sessions or labor/value. Existing one-argument reader and
-- general activity RLS stay unchanged. Source capability/anonymous RPC release
-- require their own review before this migration may deploy.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$
DECLARE h text; owned record; target regprocedure; expected_trigger text; source_row public.observation_sources%ROWTYPE; expected_kinds public.observation_kind[];
BEGIN
 h:=encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64');
 IF h NOT IN ('6lHy6FjcSj9f6EtcCMzy/a+jsNGlcciluTeMZcXNDns=','lHH92aGMaoTlbLndFE6wlHxbMb7lnMAZQKT5UVv0fJE=') THEN
  RAISE EXCEPTION 'Retained source owner drift; integrate reviewed migrations first'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.observation_is_public(public.observation_kind,jsonb)'::regprocedure),'UTF8')),'base64') <> 'pmSqNJ65TgNxUjs2UiR8Iv91I3YUPOD+OIAGjaUgYXY=' THEN
  RAISE EXCEPTION 'Observation privacy owner drift'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.vehicle_build_log_public(uuid)'::regprocedure),'UTF8')),'base64') <> 'u2oiPvYZ+jGC7wQloIRsw8fddVbSBVsLNwAwPqJs8dk=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.public_text(text)'::regprocedure),'UTF8')),'base64') <> 'LBJhVqcpD26A4nvcCE3L4+yg51J9+eu0pNuNiIHfqio=' THEN
  RAISE EXCEPTION 'Existing build log owner required'; END IF;

 SELECT * INTO source_row FROM public.observation_sources WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5' FOR UPDATE;
 expected_kinds:=ARRAY['listing','sale_result','comment','bid','condition','specification']::public.observation_kind[];
 IF h<>'6lHy6FjcSj9f6EtcCMzy/a+jsNGlcciluTeMZcXNDns=' THEN expected_kinds:=array_append(expected_kinds,'activity'::public.observation_kind); END IF;
 IF NOT FOUND OR source_row.slug IS DISTINCT FROM 'bat' OR source_row.supported_observations IS DISTINCT FROM expected_kinds THEN
  RAISE EXCEPTION 'Existing BaT source capability drift; review exact source before release'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.observation_sources'::regclass AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Source registry acquired triggers; review registry side effects'; END IF;

 FOR owned IN SELECT * FROM (VALUES
  ('public.retained_reported_work_witnesses(text)','EOnFTu08C+A0pL9mljkiTgVbe1gFQ8UyK0WnynVHHqc='),
  ('public.retained_reported_work_source_qualified(vehicle_observations)','71PonY8kIjdqlPK41O5f+hL7IqoUOz42X/svGb3nX+0='),
  ('public.retained_reported_work_matches(vehicle_observations,vehicle_observations)','v9GQSuuOOxP9TRiHarZZbZ/AZREFONSxXYK1Noe2E3s='),
  ('public.retained_reported_work_result_matches(uuid,uuid)','AEFYeKws5sPz+pmpj8l33ok0DK4iMjNO4msoRSKIsiw='),
  ('public.vehicle_build_log_public(uuid,boolean)','g/p5i1GqH8vtOV8MEjwWDAvQ31vVDkrVcFROPnlI7Mg=')
 ) AS expected(signature,hash) LOOP
  target:=to_regprocedure(owned.signature);
  IF h='6lHy6FjcSj9f6EtcCMzy/a+jsNGlcciluTeMZcXNDns=' THEN
   IF target IS NOT NULL THEN RAISE EXCEPTION 'Reported-work helper/overload collision: %',owned.signature; END IF;
  ELSIF target IS NULL OR encode(sha256(convert_to(pg_get_functiondef(target),'UTF8')),'base64') IS DISTINCT FROM owned.hash THEN
   RAISE EXCEPTION 'Reported-work owner drift: %',owned.signature;
  ELSIF NOT has_function_privilege('service_role',target,'EXECUTE')
    OR (owned.signature NOT LIKE 'public.vehicle_build_log_public%' AND
      (has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')))
    OR (SELECT proowner<>current_user::regrole OR pronargdefaults<>0 FROM pg_proc WHERE oid=target) THEN
   RAISE EXCEPTION 'Reported-work privilege/ownership contract drift: %',owned.signature;
  END IF;
 END LOOP;
 expected_trigger:=CASE WHEN h='6lHy6FjcSj9f6EtcCMzy/a+jsNGlcciluTeMZcXNDns=' THEN 'CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.source_observation_id IS NOT NULL) OR (new.extraction_method = ''retained_listing_property_projection_v1''::text))) EXECUTE FUNCTION validate_retained_listing_property_source()' ELSE 'CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.source_observation_id IS NOT NULL) OR (new.extraction_method = ANY (ARRAY[''retained_listing_property_projection_v1''::text, ''retained_listing_reported_work_v1''::text])) OR ((new.source_id = ''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid) AND (new.kind = ''activity''::observation_kind)))) EXECUTE FUNCTION validate_retained_listing_property_source()' END;
 IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='trg_retained_listing_property_source_insert') IS DISTINCT FROM expected_trigger THEN RAISE EXCEPTION 'Retained insert trigger drift'; END IF;
 expected_trigger:=CASE WHEN h='6lHy6FjcSj9f6EtcCMzy/a+jsNGlcciluTeMZcXNDns=' THEN 'CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW WHEN (((old.source_observation_id IS NOT NULL) OR (new.source_observation_id IS NOT NULL))) EXECUTE FUNCTION validate_retained_listing_property_source()' ELSE 'CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW WHEN (((old.source_observation_id IS NOT NULL) OR (new.source_observation_id IS NOT NULL) OR ((new.source_id = ''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid) AND (new.kind = ''activity''::observation_kind)) OR ((old.source_id = ''4cdc735c-f117-42f2-889f-ba33805639a5''::uuid) AND (old.kind = ''activity''::observation_kind)))) EXECUTE FUNCTION validate_retained_listing_property_source()' END;
 IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass AND tgname='trg_retained_listing_property_source_update') IS DISTINCT FROM expected_trigger THEN RAISE EXCEPTION 'Retained immutable update trigger drift'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.retained_reported_work_witnesses(p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $fn$
DECLARE raw text; sentence text; clause text; assertion text; m text[]; mon integer;
 months text[]:=ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'];
 month_pattern text:='(January|February|March|April|May|June|July|August|September|October|November|December) ([12][0-9]{3})';
 part text:='(?:fuel filter|fuel hoses|exhaust gaskets|tubes|tires|clutch plates|battery|drive chain|brake shoes|springs|fork oil|valve cover gasket|throttle body gasket|spark plugs|ignition wires)';
 action_pattern text; replaced_part text:='(?:tires|front struts|front wheel hubs|transmission oil pan gasket|instrument cluster)';
 separator text:=', an inspection at that time recommended '; at_pos integer; result jsonb:='[]';
BEGIN
 IF p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 OR p_text ~* '\m(not|never) (performed|done|completed)\M' OR p_text ~* '\m(following|below|next)\M[^.!?]{0,200}\m(not|never|planned|proposed|recommended|hypothetical)\M|\m(not|never|planned|proposed|recommended|hypothetical)\M[^.!?]{0,200}\m(following|below|next)\M' THEN RETURN result; END IF;
 action_pattern:='(?:rebuilding the carburetor|repairing an exhaust leak|replacing the '||part||'(?:(?:, |, and | and )'||part||')*)';
 FOR raw IN SELECT regexp_split_to_table(p_text,E'(?<=[.!?])[ \\t\\r\\n]+') LOOP
  sentence:=btrim(raw,E' \t\r\n');
  IF octet_length(sentence)>300 OR sentence ~* '\m(not|no|never|without|or|would|could|might|may|should|planned|proposed|intend|believed|alleged|reportedly|apparently|possibly|by|before|after|if|unless|but|however|instead|actually)\M|[?"“”;:]' THEN CONTINUE; END IF;
  clause:=sentence; at_pos:=strpos(sentence,separator);
  IF at_pos>0 THEN
   IF substr(sentence,at_pos+length(separator)) NOT IN ('replacing the front brake pads and rotors.','flushing the rear differential.') THEN CONTINUE; END IF;
   clause:=left(sentence,at_pos-1);
  END IF;
  assertion:=clause||CASE WHEN at_pos>0 THEN '.' ELSE '' END;
  m:=regexp_match(assertion,'^(?:Work|Service) in '||month_pattern||' included '||action_pattern||'(?:(?:, |, and | and )'||action_pattern||')*[.]$');
  IF m IS NULL THEN m:=regexp_match(assertion,'^The '||replaced_part||'(?:(?:, |, and | and )'||replaced_part||')* (?:was|were) replaced(?: and the fluid flushed)? in '||month_pattern||'[.]$'); END IF;
  IF m IS NULL OR clause ~* '\m(recommend\w*|need\w*|require\w*)\M' THEN CONTINUE; END IF;
  mon:=array_position(months,m[1]);
  IF mon IS NULL OR m[2]::integer<1886 THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) x WHERE x->>'source_value'=sentence) THEN
   result:=result||jsonb_build_array(jsonb_build_object('source_value',sentence,'performed_clause',clause,
    'reported_date',m[2]||'-'||lpad(mon::text,2,'0'),'reported_date_label',m[1]||' '||m[2],'date_precision','month'));
  END IF;
  IF jsonb_array_length(result)>8 THEN RETURN '[]'::jsonb; END IF;
 END LOOP;
 RETURN result;
END $fn$;
COMMENT ON FUNCTION public.retained_reported_work_witnesses(text) IS
'Bounded deterministic publisher assertions of month-dated work. One full sentence and exact performed clause per report; separately scoped inspection recommendations remain source context only. No actual-occurrence, performer, intent, cost, labor or part-identity inference. Canonical writer: ingest-observation.';

CREATE OR REPLACE FUNCTION public.retained_reported_work_source_qualified(p public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE d jsonb:=p.structured_data; captured timestamptz;
BEGIN
 IF p.id IS NULL OR p.vehicle_id IS NULL OR p.source_observation_id IS NOT NULL OR p.kind::text IS DISTINCT FROM 'listing'
 OR p.is_superseded IS DISTINCT FROM false OR p.property_id IS NOT NULL OR p.subject_type IS DISTINCT FROM 'vehicle' OR p.subject_id IS NOT NULL
 OR p.extraction_method IS DISTINCT FROM 'html_description_capture'
 OR p.source_url IS NULL OR p.source_url !~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 OR p.confidence_score IS NULL OR p.confidence_score<.6 OR p.confidence_score>1
 OR p.ingested_at IS NULL OR NOT isfinite(p.ingested_at) OR p.observed_at IS NULL OR NOT isfinite(p.observed_at)
 OR d->>'extractor' IS DISTINCT FROM 'extract-bat-core' OR d->>'source_text_field' IS DISTINCT FROM 'extract-bat-core.extractDescription'
 OR d->'description_capture' IS DISTINCT FROM 'true'::jsonb OR d->'extractor_input_truncated' IS DISTINCT FROM 'false'::jsonb
 OR coalesce(d->>'source_capture_basis','') NOT IN('direct_fetch','protected_snapshot')
 OR coalesce(d->>'source_capture_sha256','') !~ '^[0-9a-f]{64}$'
 OR d->>'observation_time_basis' IS DISTINCT FROM 'source_capture' OR d->>'source_event_time_status' IS DISTINCT FROM 'unknown'
 OR coalesce(d->>'source_captured_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+]00:00)$'
 OR NOT public.observation_is_public(p.kind,p.structured_data)
 OR NOT EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')
 OR NOT EXISTS(SELECT 1 FROM public.observation_sources s WHERE s.id=p.source_id AND s.slug='bat' AND 'activity'=ANY(s.supported_observations)) THEN RETURN false; END IF;
 captured:=(d->>'source_captured_at')::timestamptz;
 RETURN isfinite(captured) AND captured=p.observed_at AND captured<=p.ingested_at;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $fn$;

CREATE OR REPLACE FUNCTION public.retained_reported_work_matches(p public.vehicle_observations,c public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE w jsonb; expected jsonb;
BEGIN
 IF NOT public.retained_reported_work_source_qualified(p) OR c.source_observation_id IS DISTINCT FROM p.id
 OR c.vehicle_id IS DISTINCT FROM p.vehicle_id OR c.source_id IS DISTINCT FROM p.source_id OR c.source_url IS DISTINCT FROM p.source_url
 OR c.kind::text IS DISTINCT FROM 'activity' OR c.is_superseded IS DISTINCT FROM false OR c.property_id IS NOT NULL
 OR c.subject_type IS DISTINCT FROM 'vehicle' OR c.subject_id IS NOT NULL
 OR c.extraction_method IS DISTINCT FROM 'retained_listing_reported_work_v1'
 OR c.raw_source_ref IS DISTINCT FROM 'vehicle_observations:'||p.id::text OR c.observed_at IS DISTINCT FROM p.ingested_at
 OR c.confidence_score IS NULL OR c.confidence_score<0 OR c.confidence_score>.6 OR c.agent_model IS NOT NULL OR c.agent_cost_cents IS DISTINCT FROM 0
 OR c.extractor_id IS NOT NULL OR c.extraction_metadata IS NOT NULL
 OR c.ingested_at IS NULL OR NOT isfinite(c.ingested_at) OR c.ingested_at<p.ingested_at THEN RETURN false; END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(public.retained_reported_work_witnesses(p.content_text)) LOOP
  IF w->>'reported_date'>left(p.structured_data->>'source_captured_at',7) THEN CONTINUE; END IF;
  expected:=w||jsonb_build_object('analysis_kind','retained_reported_work','report_status','publisher_reported_completion',
   'occurrence_status','unverified','performer_id',NULL,'performer_status','unknown','intent_status','unknown','independent_source',false,
   'source_observation_id',p.id,'source_field','content_text','source_witness_version','retained_description_reported_work_v1',
   'observed_at_basis','source_testimony_recorded_at','source_captured_at',p.structured_data->>'source_captured_at',
   'source_capture_sha256',p.structured_data->>'source_capture_sha256','source_capture_basis',p.structured_data->>'source_capture_basis');
  IF (c.structured_data-'source_recorded_at')=expected
   AND (c.structured_data->>'source_recorded_at')::timestamptz=p.ingested_at
   AND c.content_text='Publisher-reported work: '||(w->>'performed_clause')||E'\nOccurrence unverified; performer and intent unknown.'
   AND c.source_identifier='retained_listing_reported_work_v1:'||p.id::text||':'||encode(sha256(convert_to(w->>'source_value','UTF8')),'hex')
  THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $fn$;

DO $custody$
DECLARE d text:=pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure);
BEGIN
 IF strpos(d,'public.retained_reported_work_matches(p,NEW)')=0 THEN
  d:=replace(d,$old$BEGIN
  IF TG_OP = 'UPDATE' THEN$old$,$new$BEGIN
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
  IF TG_OP = 'UPDATE' THEN$new$);
  d:=replace(d,$old$IF NEW.extraction_method='retained_listing_property_projection_v1' THEN$old$,
   $new$IF NEW.extraction_method IN ('retained_listing_property_projection_v1','retained_listing_reported_work_v1') THEN$new$);
  d:=replace(d,$old$  v_property_key := NEW.structured_data->>'property_key';$old$,$new$  IF NEW.extraction_method='retained_listing_reported_work_v1' OR NEW.structured_data->>'analysis_kind'='retained_reported_work' THEN
    SELECT * INTO p FROM public.vehicle_observations WHERE id=NEW.source_observation_id FOR SHARE;
    IF NOT FOUND OR NOT public.retained_reported_work_matches(p,NEW) THEN
      RAISE EXCEPTION 'Retained reported work must match exact public source assertion' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  v_property_key := NEW.structured_data->>'property_key';$new$);
  IF strpos(d,'public.retained_reported_work_matches(p,NEW)')=0 THEN RAISE EXCEPTION 'Retained custody anchor changed'; END IF;
  EXECUTE d;
 END IF;
END $custody$;
-- Include the reserved method with a missing typed source in the existing gate.
DROP TRIGGER IF EXISTS trg_retained_listing_property_source_insert ON public.vehicle_observations;
CREATE TRIGGER trg_retained_listing_property_source_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
 WHEN (NEW.source_observation_id IS NOT NULL OR NEW.extraction_method IN('retained_listing_property_projection_v1','retained_listing_reported_work_v1')
  OR (NEW.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND NEW.kind='activity'))
 EXECUTE FUNCTION public.validate_retained_listing_property_source();
DROP TRIGGER trg_retained_listing_property_source_update ON public.vehicle_observations;
CREATE TRIGGER trg_retained_listing_property_source_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
 WHEN (OLD.source_observation_id IS NOT NULL OR NEW.source_observation_id IS NOT NULL
  OR (NEW.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND NEW.kind='activity')
  OR (OLD.source_id='4cdc735c-f117-42f2-889f-ba33805639a5'::uuid AND OLD.kind='activity'))
 EXECUTE FUNCTION public.validate_retained_listing_property_source();

CREATE OR REPLACE FUNCTION public.retained_reported_work_result_matches(p_source uuid,p_result uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.vehicle_observations p JOIN public.vehicle_observations c ON c.id=p_result
  WHERE p.id=p_source AND public.retained_reported_work_matches(p,c));
$fn$;

CREATE OR REPLACE FUNCTION public.vehicle_build_log_public(p_vehicle_id uuid,p_include_reported boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
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
    'source_captured_at',c.structured_data->>'source_captured_at','source_recorded_at',p.ingested_at,
    'source_capture_sha256',c.structured_data->>'source_capture_sha256','source_capture_basis',c.structured_data->>'source_capture_basis',
    'source_witness_version',c.structured_data->>'source_witness_version','observed_at',c.observed_at,'ingested_at',c.ingested_at,
    'confidence_score',c.confidence_score) ORDER BY c.structured_data->>'reported_date' DESC,c.id),'[]'::jsonb)
   FROM public.vehicle_observations c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
   WHERE c.vehicle_id=p_vehicle_id AND c.kind='activity' AND c.extraction_method='retained_listing_reported_work_v1'
    AND c.is_superseded IS FALSE AND public.retained_reported_work_matches(p,c)
    AND public.public_text(c.structured_data->>'source_value')=c.structured_data->>'source_value'
    AND public.public_text(c.structured_data->>'performed_clause')=c.structured_data->>'performed_clause'
  ) ELSE '[]'::jsonb END);
$fn$;
COMMENT ON FUNCTION public.vehicle_build_log_public(uuid,boolean) IS
'Explicit opt-in reader: work_records preserves the existing masked build log; reported_work contains only source-bound admitted activities, with publisher-claimed month precision, unverified occurrence and unknown performer/intent. Capture, parent recording and child recording clocks stay distinct. Current custody/source eligibility is rechecked. No value or labor accrues from reports.';
REVOKE ALL ON FUNCTION public.retained_reported_work_witnesses(text),public.retained_reported_work_source_qualified(public.vehicle_observations),
 public.retained_reported_work_matches(public.vehicle_observations,public.vehicle_observations),public.retained_reported_work_result_matches(uuid,uuid),
 public.vehicle_build_log_public(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retained_reported_work_witnesses(text),public.retained_reported_work_source_qualified(public.vehicle_observations),
 public.retained_reported_work_matches(public.vehicle_observations,public.vehicle_observations),public.retained_reported_work_result_matches(uuid,uuid) TO service_role;
-- Held with the migration: no deployed grant until release review.
GRANT EXECUTE ON FUNCTION public.vehicle_build_log_public(uuid,boolean) TO anon,authenticated,service_role;
-- Capability enable is last, after both intake custody triggers and reader
-- are installed in this transaction. No trust, source identity or clocks change.
DO $capability$
DECLARE before_row public.observation_sources%ROWTYPE; after_row public.observation_sources%ROWTYPE;
 before_kinds public.observation_kind[]:=ARRAY['listing','sale_result','comment','bid','condition','specification']::public.observation_kind[];
BEGIN
 SELECT * INTO before_row FROM public.observation_sources WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5' FOR UPDATE;
 IF before_row.supported_observations=before_kinds THEN
  UPDATE public.observation_sources SET supported_observations=array_append(supported_observations,'activity'::public.observation_kind)
   WHERE id=before_row.id;
 END IF;
 SELECT * INTO after_row FROM public.observation_sources WHERE id=before_row.id;
 IF (to_jsonb(before_row)-'supported_observations') IS DISTINCT FROM (to_jsonb(after_row)-'supported_observations')
  OR after_row.supported_observations IS DISTINCT FROM array_append(before_kinds,'activity'::public.observation_kind) THEN
  RAISE EXCEPTION 'BaT capability release changed more than the reviewed activity permission'; END IF;
END $capability$;
COMMIT;
