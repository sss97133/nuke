-- PostgreSQL's whole-expression match length must agree with the JS first material boundary.
BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_description_presentation_witness(text,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'vR1agZrSTk8LFkgoCr0BxwR39f/SlEhvibt4NowRfcE=' THEN RAISE EXCEPTION 'Presentation witness owner changed'; END IF;
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active) THEN RAISE EXCEPTION 'Listing owner paused'; END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work active'; END IF;
END $$;
CREATE TEMP TABLE retained_presentation_recheck_candidates ON COMMIT DROP AS
 SELECT q.source_observation_id,q.property_id,to_jsonb(q) AS previous_work,
 public.retained_description_property_witness(p,'interior_color') AS old_witness
 FROM (SELECT * FROM public.retained_listing_property_work
 WHERE status='failed' AND attempts=3 AND last_error='canonical_request_failed'
 AND property_id='514cacd3-82b4-4330-b3df-e292612ee718'
 ORDER BY next_attempt_at,source_observation_id LIMIT 500 FOR UPDATE SKIP LOCKED)q
 JOIN public.vehicle_observations p ON p.id=q.source_observation_id
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties prop ON prop.id=q.property_id AND prop.property_key='interior_color' AND prop.namespace='core' AND prop.deprecated_at IS NULL AND 'specification'=ANY(prop.applies_to_kinds);

CREATE OR REPLACE FUNCTION public.retained_description_presentation_witness(p_key text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE sentence text;finish text[];interior text[];drive text[];value text;w jsonb;
BEGIN
 IF p_key NOT IN('interior_color','exterior_color','drivetrain_layout') OR p_text IS NULL OR octet_length(p_text)<100 OR octet_length(p_text)>32000 THEN RETURN NULL;END IF;
 FOR sentence IN SELECT btrim(t,E' \t\r\n') FROM regexp_split_to_table(p_text,E'(?<=[.!?])[ \t\r\n]+|[\r\n]+')t LOOP
  finish:=regexp_match(sentence,'(?:^(?:Finished|The (?:car|truck|vehicle|motorcycle|bike) is (?:finished|refinished)|It is (?:finished|refinished)) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) over ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  interior:=regexp_match(sentence,'(?:^The (?:cabin|interior|seats) (?:is|are) (?:trimmed|upholstered|finished) in ([A-Za-z][A-Za-z0-9 /()''-]{0,79}?) (leather|vinyl|cloth)(?=[ ,.;]|$)){1,1}?','i');
  drive:=regexp_match(sentence,'^Power is (?:sent|delivered|routed) to (?:the )?(rear|front) wheels\y','i');
  IF p_key='drivetrain_layout' AND sentence ~* '^Power is (sent|delivered|routed)\y' AND drive IS NULL THEN RETURN NULL;END IF;
  value:=CASE p_key WHEN 'drivetrain_layout' THEN CASE WHEN drive IS NULL THEN NULL WHEN lower(drive[1])='rear' THEN 'RWD' ELSE 'FWD' END
   WHEN 'exterior_color' THEN finish[1] ELSE coalesce(finish[2],interior[1]) END;
  IF value IS NULL THEN CONTINUE;END IF;
  IF octet_length(sentence)>500 OR sentence ~* '\y(unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|spare|uninstalled|other|another)\y|["“”]'
   OR value<>btrim(value,E' \t\r\n') OR value ~* '\yand\y' THEN RETURN NULL;END IF;
  IF p_key='drivetrain_layout' AND (sentence ~* '\y(if|when|only|transfer case|all four|all[- ]wheel|four[- ]wheel|AWD|4WD)\y'
   OR (value='RWD' AND sentence ~* '\yfront\y') OR (value='FWD' AND sentence ~* '\yrear\y')) THEN RETURN NULL;END IF;
  IF w IS NOT NULL AND w->>'value'<>value THEN RETURN NULL;END IF;
  IF w IS NULL THEN w:=jsonb_build_object('source_value',sentence,'value',value);END IF;
 END LOOP;RETURN w;
END $function$
;

DO $$ DECLARE recovered jsonb;BEGIN
 SELECT jsonb_agg(c.previous_work ORDER BY c.source_observation_id) INTO recovered
 FROM retained_presentation_recheck_candidates c JOIN public.vehicle_observations p ON p.id=c.source_observation_id
 WHERE public.retained_description_property_witness(p,'interior_color') IS NOT NULL
 AND c.old_witness IS DISTINCT FROM public.retained_description_property_witness(p,'interior_color');
 IF recovered IS NOT NULL THEN
  UPDATE public.retained_listing_property_replay SET previous_scan_receipt=coalesce(previous_scan_receipt,'{}'::jsonb)||
   jsonb_build_object('presentation_regex_retry_recovery',jsonb_build_object('recovered_at',clock_timestamp(),
    'incident','postgres_whole_expression_greed','cap',500,'requeued',jsonb_array_length(recovered),'previous_work',recovered)) WHERE id;
  UPDATE public.retained_listing_property_work q SET status='pending',attempts=0,next_attempt_at=clock_timestamp()+interval '1 minute',locked_at=NULL,locked_by=NULL,
   last_error='presentation_regex_incident_recheck'
  FROM jsonb_array_elements(recovered)r WHERE q.source_observation_id=(r->>'source_observation_id')::uuid AND q.property_id=(r->>'property_id')::uuid;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';COMMIT;
