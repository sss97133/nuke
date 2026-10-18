-- Reported work v2: one passive clause, "The <object> was|were <verb> in <Month YYYY>.", with an open object phrase.
-- Additive: retained_reported_work_witnesses (v1) is unchanged and is read first; v2 returns only sentences v1 does not
-- carry, so every admitted v1 report keeps matching under its v1 witness version. The object may not hold a second
-- finite verb (the month would then date only the last clause), the sentence holds exactly one year, and attributed,
-- hedged, negated or recommended sentences are withheld. v1 and v2 together hold at most 8 per page.
-- Only the witness helper is added and the matcher's witness loop changes; admission mode, validator, triggers and
-- the public reader are unchanged. Mirrors descriptionReportedWorkWitnessesV2 (ingest-observation/retainedReportedWork.ts).
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$
DECLARE h text;
BEGIN
 FOR h IN SELECT x FROM (VALUES
  ('public.retained_reported_work_witnesses(text)','EOnFTu08C+A0pL9mljkiTgVbe1gFQ8UyK0WnynVHHqc='),
  ('public.retained_reported_work_source_qualified(vehicle_observations)','71PonY8kIjdqlPK41O5f+hL7IqoUOz42X/svGb3nX+0='),
  ('public.vehicle_build_log_public(uuid,boolean)','5aXkwA9E9XijkcQwJLJAg3zQtgzXZZoMsanz0IU/bSE='),
  ('public.validate_retained_listing_property_source()','4sy0OTUHRs38lbIdSM7QsFamhCkK4jaOaicJ6XEWzLs=')
 ) AS pin(sig,x) WHERE to_regprocedure(sig) IS NULL OR encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(sig)),'UTF8')),'base64')<>x LOOP
  RAISE EXCEPTION 'Reported-work owner drift; integrate reviewed migrations first';
 END LOOP;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_reported_work_matches(vehicle_observations,vehicle_observations)'::regprocedure),'UTF8')),'base64')
  NOT IN ('v9GQSuuOOxP9TRiHarZZbZ/AZREFONSxXYK1Noe2E3s=', 'r3S/P8gBSjWdvleN2UsJa0uNOc5hITY4tHEapUzSzNI=') THEN
  RAISE EXCEPTION 'Reported-work matcher drift'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.retained_reported_work_witnesses_v2(p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $fn$
DECLARE raw text; sentence text; m text[]; mon integer; v1 jsonb; result jsonb:='[]';
 months text[]:=ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'];
 verb text:='(?:replaced|installed|rebuilt|repaired|refinished|repainted|resealed|reupholstered|overhauled|serviced|flushed|refreshed|recharged|fitted|performed)';
 passive text;
BEGIN
 IF p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 OR p_text ~* '\m(not|never) (performed|done|completed)\M' OR p_text ~* '\m(following|below|next)\M[^.!?]{0,200}\m(not|never|planned|proposed|recommended|hypothetical)\M|\m(not|never|planned|proposed|recommended|hypothetical)\M[^.!?]{0,200}\m(following|below|next)\M' THEN RETURN '[]'::jsonb; END IF;
 v1:=public.retained_reported_work_witnesses(p_text);
 passive:='^(?:The|A|An|New) ([A-Za-z0-9][A-Za-z0-9 ,''’/.-]{1,120}) (?:was|were) '||verb||'(?:(?:, |, and | and )'||verb||')* in (January|February|March|April|May|June|July|August|September|October|November|December) ([12][0-9]{3})[.]$';
 FOR raw IN SELECT regexp_split_to_table(p_text,E'(?<=[.!?])[ \\t\\r\\n]+') LOOP
  sentence:=btrim(raw,E' \t\r\n');
  -- The month May before a year is a date, not the hedge "may".
  IF octet_length(sentence)>300 OR regexp_replace(sentence,'\mMay (?=[12][0-9]{3}\M)','','g') ~* '\m(not|no|never|without|or|would|could|might|may|should|planned|proposed|intend|believed|alleged|reportedly|apparently|possibly|by|before|after|if|unless|but|however|instead|actually)\M|[?"“”;:]'
   OR sentence ~* '\m(seller|carfax|autocheck|invoice|records?|receipts?|according|notes?|states?|said|told|tells|describes?|claims?|estimated|approximately|around|circa|reported|recommend\w*|need\w*|require\w*)\M' THEN CONTINUE; END IF;
  IF (SELECT count(*) FROM regexp_matches(sentence,'\m[12][0-9]{3}\M','g'))<>1 THEN CONTINUE; END IF;
  m:=regexp_match(sentence,passive);
  IF m IS NULL OR m[1] ~* '\m(was|were|is|are|has|have|had|been)\M' THEN CONTINUE; END IF;
  mon:=array_position(months,m[2]);
  IF mon IS NULL OR m[3]::integer<1886 THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v1||result) x WHERE x->>'source_value'=sentence) THEN CONTINUE; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('source_value',sentence,'performed_clause',sentence,
   'reported_date',m[3]||'-'||lpad(mon::text,2,'0'),'reported_date_label',m[2]||' '||m[3],'date_precision','month'));
 END LOOP;
 IF jsonb_array_length(v1)+jsonb_array_length(result)>8 THEN RETURN '[]'::jsonb; END IF;
 RETURN result;
END $fn$;
COMMENT ON FUNCTION public.retained_reported_work_witnesses_v2(text) IS
'Reported work v2: single passive month-dated clauses (open object phrase, allowlisted verbs) that v1 does not carry. Same page gate and sentence split as v1; withholds attribution, hedging, negation, recommendation, a second year and a second finite verb in the object. Publisher assertion only: no occurrence, performer, intent, cost, labor or part identity.';

CREATE OR REPLACE FUNCTION public.retained_reported_work_matches(p public.vehicle_observations,c public.vehicle_observations) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE w jsonb; expected jsonb; r record;
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
 FOR r IN SELECT x.value AS w,'retained_description_reported_work_v1' AS ver FROM jsonb_array_elements(public.retained_reported_work_witnesses(p.content_text)) x
  UNION ALL SELECT x.value,'retained_description_reported_work_v2' FROM jsonb_array_elements(public.retained_reported_work_witnesses_v2(p.content_text)) x LOOP
  w:=r.w;
  IF w->>'reported_date'>left(p.structured_data->>'source_captured_at',7) THEN CONTINUE; END IF;
  expected:=w||jsonb_build_object('analysis_kind','retained_reported_work','report_status','publisher_reported_completion',
   'occurrence_status','unverified','performer_id',NULL,'performer_status','unknown','intent_status','unknown','independent_source',false,
   'source_observation_id',p.id,'source_field','content_text','source_witness_version',r.ver,
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

REVOKE ALL ON FUNCTION public.retained_reported_work_witnesses_v2(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retained_reported_work_witnesses_v2(text) TO service_role;
COMMIT;
