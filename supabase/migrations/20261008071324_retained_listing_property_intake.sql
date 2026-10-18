-- Automate the two existing retained-listing property selectors. Canonical
-- admission, source FK, public reader and unknown configuration roles stay owned
-- by ingest-observation; this queue holds work, never a second fact log.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64')
    IS DISTINCT FROM 'SWMULpmuOum3+TVBNd+ZsReIk9lCqTFx/Vsa1IoqSOQ=' THEN
  RAISE EXCEPTION 'Retained listing admission owner changed'; END IF;
 IF (SELECT count(*) FROM public.observation_properties WHERE namespace='core' AND deprecated_at IS NULL
   AND 'specification'=ANY(applies_to_kinds)
   AND ((property_key='interior_color' AND id='514cacd3-82b4-4330-b3df-e292612ee718')
     OR (property_key='exterior_color' AND id='efcb8c61-1ff5-4790-890e-2e09118e87e3')))<>2
   OR NOT EXISTS(SELECT 1 FROM public.observation_sources WHERE slug='bat'
      AND 'specification'::public.observation_kind=ANY(supported_observations)) THEN
  RAISE EXCEPTION 'Existing BaT property contracts unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='project-retained-listing-properties') THEN
  RAISE EXCEPTION 'Listing property job already owned'; END IF;
 IF encode(sha256(convert_to(pg_get_viewdef('public.v_job_health'::regclass,true),'UTF8')),'base64') IS DISTINCT FROM 'qdgriWVtTou4f4jreejxtEQWYHnBVBoKhb5LHxlOdcY=' THEN
  RAISE EXCEPTION 'Installed job health owner changed'; END IF;
END $$;

CREATE TABLE public.retained_listing_property_work (
 source_observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id),
 property_id uuid NOT NULL REFERENCES public.observation_properties(id),
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','done','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 locked_by text,locked_at timestamptz,
 observation_id uuid REFERENCES public.vehicle_observations(id),
 completed_at timestamptz,last_error text,
 PRIMARY KEY(source_observation_id,property_id),
 CHECK(property_id IN('514cacd3-82b4-4330-b3df-e292612ee718','efcb8c61-1ff5-4790-890e-2e09118e87e3')),
 CHECK((status='claimed')=(locked_by IS NOT NULL AND locked_at IS NOT NULL)),
 CHECK(status='claimed' OR (locked_by IS NULL AND locked_at IS NULL)),
 CHECK((status='done')=(observation_id IS NOT NULL AND completed_at IS NOT NULL)),
 CHECK(status='done' OR (observation_id IS NULL AND completed_at IS NULL))
);
CREATE INDEX retained_listing_property_due ON public.retained_listing_property_work(next_attempt_at,source_observation_id,property_id)
 WHERE status IN('pending','skipped');
CREATE INDEX retained_listing_property_completed ON public.retained_listing_property_work(completed_at DESC,source_observation_id,property_id)
 WHERE status='done';
CREATE INDEX retained_listing_property_backlog ON public.retained_listing_property_work(status)
 WHERE status IN('pending','claimed');
CREATE INDEX retained_listing_property_claimed ON public.retained_listing_property_work(locked_at)
 WHERE status='claimed';
CREATE TABLE public.retained_listing_property_replay (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 upper_recorded_at timestamptz,upper_source_id uuid REFERENCES public.vehicle_observations(id),
 cursor_recorded_at timestamptz,cursor_source_id uuid REFERENCES public.vehicle_observations(id),
 keys_seen bigint NOT NULL DEFAULT 0 CHECK(keys_seen>=0),
 started_at timestamptz NOT NULL DEFAULT now(),last_seed_at timestamptz,scan_completed_at timestamptz,
 CHECK((upper_recorded_at IS NULL)=(upper_source_id IS NULL)),
 CHECK((cursor_recorded_at IS NULL)=(cursor_source_id IS NULL))
);
-- Trigger and finite upper bound share this transaction. New arrivals enqueue
-- independently of recording-clock order, including an older transaction that
-- commits after the scanner has passed its clock.
CREATE FUNCTION public.enqueue_retained_listing_properties(p_source uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color'),
   ('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'color')) r(id,source_field)
 WHERE p.id=p_source AND p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded IS FALSE AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND p.confidence_score BETWEEN 0.6 AND 1
 AND jsonb_typeof(p.structured_data->r.source_field)='string'
 AND nullif(btrim(p.structured_data->>r.source_field),'') IS NOT NULL
 AND length(p.structured_data->>r.source_field)<=500
 AND btrim(p.structured_data->>r.source_field) !~* '^(unknown|n/a|unspecified)$'
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE FUNCTION public.trg_enqueue_retained_listing_properties() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.enqueue_retained_listing_properties(NEW.id);RETURN NEW;END $$;
CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations
 FOR EACH ROW WHEN(NEW.kind='listing' AND NEW.extraction_method='html_match')
 EXECUTE FUNCTION public.trg_enqueue_retained_listing_properties();
INSERT INTO public.retained_listing_property_replay(id,upper_recorded_at,upper_source_id,scan_completed_at)
 SELECT true,p.ingested_at,p.id,CASE WHEN p.id IS NULL THEN now() END
 FROM (SELECT true AS singleton) one LEFT JOIN LATERAL(
  SELECT id,ingested_at FROM public.vehicle_observations WHERE kind='listing' AND isfinite(ingested_at)
   ORDER BY ingested_at DESC,id DESC LIMIT 1)p ON true;

CREATE FUNCTION public.seed_retained_listing_properties() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='5s' AS $$
DECLARE s record;p record;n integer:=0;
BEGIN
 IF (SELECT count(*) FROM public.retained_listing_property_work WHERE status IN('pending','claimed'))>=500 THEN RETURN 0;END IF;
 SELECT * INTO s FROM public.retained_listing_property_replay WHERE id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR s.scan_completed_at IS NOT NULL THEN RETURN 0;END IF;
 FOR p IN SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at) AND (ingested_at,id)<=(s.upper_recorded_at,s.upper_source_id)
  AND (ingested_at,id)>(coalesce(s.cursor_recorded_at,'-infinity'::timestamptz),
    coalesce(s.cursor_source_id,'00000000-0000-0000-0000-000000000000'::uuid))
  ORDER BY ingested_at,id LIMIT 500 LOOP
  PERFORM public.enqueue_retained_listing_properties(p.id);
  s.cursor_recorded_at:=p.ingested_at;s.cursor_source_id:=p.id;n:=n+1;
 END LOOP;
 UPDATE public.retained_listing_property_replay SET cursor_recorded_at=s.cursor_recorded_at,
  cursor_source_id=s.cursor_source_id,keys_seen=keys_seen+n,last_seed_at=clock_timestamp(),
  scan_completed_at=CASE WHEN n<500 THEN clock_timestamp() END WHERE id;
 RETURN n;
END $$;

CREATE FUNCTION public.retained_listing_property_result_matches(p_source uuid,p_property uuid,p_result uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='3s' AS $$
 SELECT EXISTS(SELECT 1 FROM public.vehicle_observations o
 JOIN public.vehicle_observations p ON p.id=p_source
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 JOIN public.observation_properties r ON r.id=p_property AND r.namespace='core' AND r.deprecated_at IS NULL
 WHERE o.id=p_result AND o.id<>p.id AND o.source_observation_id=p.id AND o.property_id=r.id
 AND o.vehicle_id=p.vehicle_id AND o.source_id=p.source_id AND o.source_url=p.source_url
 AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
 AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND p.confidence_score BETWEEN 0.6 AND 1 AND isfinite(p.ingested_at)
 AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND o.kind='specification' AND o.is_superseded IS FALSE AND o.subject_type='vehicle' AND o.subject_id IS NULL
 AND o.extraction_method='retained_listing_property_projection_v1' AND o.observed_at=p.ingested_at
 AND o.raw_source_ref='vehicle_observations:'||p.id::text AND o.confidence_score BETWEEN 0 AND 0.6
 AND o.agent_cost_cents=0 AND o.content_hash IS NOT NULL
 AND r.property_key IN('interior_color','exterior_color') AND 'specification'=ANY(r.applies_to_kinds)
 AND o.source_identifier='retained_listing_'||r.property_key||'_v1:'||p.id::text
 AND o.structured_data->>'source_observation_id'=p.id::text
 AND o.structured_data->>'property_key'=r.property_key AND o.structured_data->>'claim_role'='listing_claim'
 AND o.structured_data->>'observed_at_basis'='source_testimony_recorded_at'
 AND o.structured_data->>'source_field'=CASE r.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END
 AND o.structured_data->r.property_key=p.structured_data->(CASE r.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END)
 AND o.structured_data->>'projection_version'='retained_listing_'||r.property_key||'_v1'
 AND o.structured_data->>'analysis_kind'='retained_listing_property_projection'
 AND (o.structured_data->>'source_recorded_at')::timestamptz=p.ingested_at
 AND (o.structured_data->>'source_observed_at')::timestamptz IS NOT DISTINCT FROM p.observed_at
 AND o.structured_data->'source_confidence_score'=to_jsonb(p.confidence_score)
 AND o.structured_data->>'source_extraction_method'=p.extraction_method
 AND o.structured_data->>'factory_configuration_status'='unknown'
 AND o.structured_data->>'current_configuration_status'='unknown'
 AND o.structured_data->'independent_source'='false'::jsonb);
$$;

CREATE FUNCTION public.claim_retained_listing_properties(p_worker text,p_limit integer DEFAULT 20)
RETURNS TABLE(source_observation_id uuid,property_id uuid,mode text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='10s' AS $$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 60 THEN
  RAISE EXCEPTION 'Invalid bounded listing property worker';END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8 THEN RETURN;END IF;
 PERFORM set_config('app.writer','ingest-observation:retained-listing',true);
 PERFORM public.seed_retained_listing_properties();
 WITH expired AS(SELECT q.source_observation_id,q.property_id FROM public.retained_listing_property_work q
  WHERE q.status='claimed' AND q.locked_at<now()-interval '10 minutes' ORDER BY q.locked_at LIMIT 60 FOR UPDATE SKIP LOCKED)
 UPDATE public.retained_listing_property_work q SET status=CASE WHEN q.attempts>=3 THEN 'failed' ELSE 'pending' END,
  locked_by=NULL,locked_at=NULL,next_attempt_at=now()+interval '15 minutes',last_error='lease_expired'
 FROM expired e WHERE q.source_observation_id=e.source_observation_id AND q.property_id=e.property_id;
 RETURN QUERY WITH picked AS(SELECT q.source_observation_id,q.property_id FROM public.retained_listing_property_work q
  WHERE q.status IN('pending','skipped') AND q.next_attempt_at<=now() AND q.attempts<3
  ORDER BY q.next_attempt_at,q.source_observation_id,q.property_id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.retained_listing_property_work q SET status='claimed',locked_by=p_worker,locked_at=now(),attempts=q.attempts+1
 FROM picked p WHERE q.source_observation_id=p.source_observation_id AND q.property_id=p.property_id
 RETURNING q.source_observation_id,q.property_id,CASE q.property_id WHEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid
  THEN 'retained_listing_interior_color_v1' ELSE 'retained_listing_exterior_color_v1' END;
END $$;
CREATE FUNCTION public.finish_retained_listing_property(p_source uuid,p_property uuid,p_worker text,p_status text,p_result uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='5s' AS $$
DECLARE q public.retained_listing_property_work%ROWTYPE;n integer;
BEGIN
 IF p_status NOT IN('done','refused','retry','deferred') OR p_status IS NULL THEN RAISE EXCEPTION 'Invalid completion';END IF;
 SELECT * INTO q FROM public.retained_listing_property_work WHERE source_observation_id=p_source AND property_id=p_property FOR UPDATE;
 IF NOT FOUND OR q.status<>'claimed' OR q.locked_by IS DISTINCT FROM p_worker THEN RETURN false;END IF;
 IF p_status='done' AND (p_result IS NULL OR NOT public.retained_listing_property_result_matches(p_source,p_property,p_result)
  OR NOT EXISTS(SELECT 1 FROM public.vehicle_observations WHERE id=p_result AND vehicle_id=q.vehicle_id)) THEN RETURN false;END IF;
 IF p_status<>'done' AND p_result IS NOT NULL THEN RETURN false;END IF;
 UPDATE public.retained_listing_property_work SET
  status=CASE p_status WHEN 'done' THEN 'done' WHEN 'refused' THEN 'skipped'
   WHEN 'deferred' THEN 'pending' ELSE CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END END,
  attempts=CASE p_status WHEN 'refused' THEN 0 WHEN 'deferred' THEN greatest(attempts-1,0) ELSE attempts END,
  next_attempt_at=clock_timestamp()+CASE p_status WHEN 'refused' THEN interval '24 hours'
   WHEN 'deferred' THEN interval '1 minute' ELSE interval '15 minutes' END,
  locked_by=NULL,locked_at=NULL,observation_id=CASE WHEN p_status='done' THEN p_result END,
  completed_at=CASE WHEN p_status='done' THEN clock_timestamp() END,
  last_error=CASE p_status WHEN 'done' THEN NULL WHEN 'refused' THEN 'source_ineligible'
   WHEN 'deferred' THEN 'batch_budget_deferred' ELSE 'canonical_request_failed' END
 WHERE source_observation_id=p_source AND property_id=p_property;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n=1;
END $$;

CREATE FUNCTION public.assay_retained_listing_properties() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
DECLARE s jsonb;w jsonb;total bigint;sampled bigint;stale bigint;failed bigint;due bigint;distinct_rows bigint;
BEGIN
 SELECT to_jsonb(r) INTO s FROM public.retained_listing_property_replay r WHERE id;
 IF s IS NULL THEN RETURN jsonb_build_object('status','unavailable','reason','replay_state_missing');END IF;
 SELECT jsonb_object_agg(status,n) INTO w FROM(SELECT status,count(*) n FROM public.retained_listing_property_work GROUP BY status)x;
 SELECT count(*),count(DISTINCT observation_id) INTO total,distinct_rows FROM public.retained_listing_property_work WHERE status='done';
 SELECT count(*) INTO failed FROM public.retained_listing_property_work WHERE status='failed';
 SELECT count(*) INTO due FROM public.retained_listing_property_work WHERE status='claimed' OR(status='pending' AND next_attempt_at<=now());
 WITH sample AS MATERIALIZED(
  (SELECT source_observation_id,property_id,observation_id FROM public.retained_listing_property_work WHERE status='done'
   ORDER BY completed_at,source_observation_id,property_id LIMIT 100)
  UNION
  (SELECT source_observation_id,property_id,observation_id FROM public.retained_listing_property_work WHERE status='done'
   ORDER BY completed_at DESC,source_observation_id DESC,property_id DESC LIMIT 100))
 SELECT count(*),count(*) FILTER(WHERE NOT public.retained_listing_property_result_matches(source_observation_id,property_id,observation_id))
 INTO sampled,stale FROM sample;
 RETURN jsonb_build_object('status',CASE WHEN failed>0 OR stale>0 THEN 'failed'
  WHEN s->>'scan_completed_at' IS NULL OR due>0 OR total>sampled THEN 'partial' ELSE 'passed' END,
  'method','retained_listing_property_projection_v1','source_scan',s,'work',coalesce(w,'{}'::jsonb),
  'canonical_observations',distinct_rows,'completed_work',total,'custody_sampled',sampled,'custody_sample_cap',200,
  'sample_stale',stale,'custody_coverage',CASE WHEN total>sampled THEN 'bounded_sample' ELSE 'all_completed_work' END,
  'full_current_custody_verified',total=sampled AND stale=0,'due',due,'failed',failed,
  'provider_calls',0,'model_calls',0,'role','attributed_retained_listing_claim','factory_configuration_verified',false,
  'measured_at',statement_timestamp());
EXCEPTION WHEN query_canceled THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
 WHEN OTHERS THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
END $$;

-- Extend the installed monitor's three existing assay branches. Preserve the
-- complete definition, security options/ACL and every other species' behavior.
DO $health$
DECLARE v text:=pg_get_viewdef('public.v_job_health'::regclass,true);a text;b text;
BEGIN
 a:='vin_reference_assay AS MATERIALIZED (';
 IF cardinality(string_to_array(v,a))<>2 THEN RAISE EXCEPTION 'Job health source anchor changed';END IF;
 v:=replace(v,a,'retained_listing_assay AS MATERIALIZED (SELECT public.assay_retained_listing_properties() AS reading), '||a);
 a:=$s$WHEN j.jobname = 'qualify-retained-vin-references'::text THEN ( SELECT vin_reference_assay.reading ->> 'status'::text
               FROM vin_reference_assay)$s$;
 b:=replace(replace(a,'qualify-retained-vin-references','project-retained-listing-properties'),'vin_reference_assay','retained_listing_assay');
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health status anchor changed';END IF;v:=replace(v,a,b||E'\n            '||a);
 a:=$s$WHEN j.jobname = 'qualify-retained-vin-references'::text THEN ( SELECT vin_reference_assay.reading
               FROM vin_reference_assay)$s$;
 b:=replace(replace(a,'qualify-retained-vin-references','project-retained-listing-properties'),'vin_reference_assay','retained_listing_assay');
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health detail anchor changed';END IF;v:=replace(v,a,b||E'\n            '||a);
 a:=$s$WHEN j.jobname = 'qualify-retained-vin-references'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:30:00'::interval) THEN 'failed'::text
                WHEN (( SELECT vin_reference_assay.reading ->> 'status'::text
                   FROM vin_reference_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT vin_reference_assay.reading ->> 'status'::text
                   FROM vin_reference_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END$s$;
 b:=replace(replace(replace(a,'qualify-retained-vin-references','project-retained-listing-properties'),
  'vin_reference_assay','retained_listing_assay'),'00:30:00','00:05:00');
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health freshness anchor changed';END IF;v:=replace(v,a,b||E'\n            '||a);
 EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '||v;
END $health$;

INSERT INTO public.observation_extractors(source_id,slug,display_name,extractor_type,edge_function_name,extractor_config,
 produces_kinds,is_active,schedule_type,rate_limit_per_hour,min_interval_seconds)
SELECT id,'retained-listing-properties-v1','Retained listing property intake','edge_function','ingest-observation',
 '{"mode":"retained_listing_property_drain_v1","batch_size":60,"model_calls":0,"assay_rpc":"assay_retained_listing_properties"}'::jsonb,
 ARRAY['specification']::public.observation_kind[],true,'cron',3600,60 FROM public.observation_sources WHERE slug='bat';
DO $$ DECLARE j bigint;BEGIN
 j:=cron.schedule('project-retained-listing-properties','* * * * *',$cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-observation',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"mode":"retained_listing_property_drain_v1","batch_size":60}'::jsonb,timeout_milliseconds:=60000);
 $cmd$);
 PERFORM cron.alter_job(job_id:=j,active:=false);
END $$;
CREATE FUNCTION public.activate_retained_listing_property_intake() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='1s' SET statement_timeout='5s' AS $$
DECLARE j bigint;BEGIN
 SELECT jobid INTO j FROM cron.job WHERE jobname='project-retained-listing-properties' AND schedule='* * * * *'
 AND regexp_replace(command,'\s','','g')=regexp_replace($cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-observation',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"mode":"retained_listing_property_drain_v1","batch_size":60}'::jsonb,timeout_milliseconds:=60000);
 $cmd$,'\s','','g');
 IF j IS NULL THEN RAISE EXCEPTION 'Installed fixed listing property contract unavailable';END IF;
 PERFORM cron.alter_job(job_id:=j,active:=true);RETURN true;
END $$;

ALTER TABLE public.retained_listing_property_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retained_listing_property_replay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_listing_property_work,public.retained_listing_property_replay FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.retained_listing_property_work,public.retained_listing_property_replay TO service_role;
CREATE POLICY retained_listing_property_work_service_read ON public.retained_listing_property_work FOR SELECT TO service_role USING(true);
CREATE POLICY retained_listing_property_replay_service_read ON public.retained_listing_property_replay FOR SELECT TO service_role USING(true);
REVOKE ALL ON FUNCTION public.enqueue_retained_listing_properties(uuid),public.trg_enqueue_retained_listing_properties(),
 public.seed_retained_listing_properties(),public.retained_listing_property_result_matches(uuid,uuid,uuid),
 public.claim_retained_listing_properties(text,integer),public.finish_retained_listing_property(uuid,uuid,text,text,uuid),
 public.assay_retained_listing_properties(),public.activate_retained_listing_property_intake() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_retained_listing_properties(text,integer),
 public.finish_retained_listing_property(uuid,uuid,text,text,uuid),public.assay_retained_listing_properties(),
 public.retained_listing_property_result_matches(uuid,uuid,uuid) TO service_role;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
 ('retained_listing_property_work',NULL,'ingest-observation','Source observation/property keyed operational work; canonical facts stay in vehicle_observations. Verified leased completion only.',true,'claim_retained_listing_properties/finish_retained_listing_property'),
 ('retained_listing_property_replay',NULL,'ingest-observation','Finite retained-listing keyset scan; new inserts enqueue independently. Source coverage is explicit, not fleet verification.',true,'seed_retained_listing_properties');
COMMENT ON TABLE public.retained_listing_property_work IS 'Work grain: one retained source observation FK × existing core property FK, with vehicle/result FKs. Existing ingest-observation selector admission produces exact attributed color claims; no paid/model calls, new testimony inference or physical scalar writes.60/minute attempts, load/lock governor,10min lease,15min retry/3attempt failure,24h explicit refusal,1min unstarted-budget defer. Read-only service table; assay_retained_listing_properties and existing get_field_provenance/vehicle_canonical consumers.';
COMMENT ON TABLE public.retained_listing_property_replay IS 'Singleton operational finite replay over listing (recording clock,PK),500-key pages below500pending work; indexed kind/time scan. Immutable baseline upper tuple at installation; new listing insert trigger covers out-of-order commit clocks. keys_seen is visited sources, not new data. Canonical current-source admission and consumer qualification remain mandatory.';
DO $$ DECLARE c record;BEGIN
 FOR c IN SELECT * FROM(VALUES
 ('source_observation_id','Original retained listing PK/FK; one source-property work key, not new testimony.'),
 ('property_id','Existing interior_color or exterior_color property PK/FK; no vocabulary minted.'),
 ('vehicle_id','Vehicle PK/FK captured at enqueue; completion verifies current same-parent source/result binding.'),
 ('status','Operational pending/claimed/done/skipped/failed; done requires persisted canonical tuple.'),
 ('attempts','Transient attempt count0..3; explicit refusal resets, unstarted budget defers restore attempt.'),
 ('next_attempt_at','Worker scheduling clock; not source observation time.'),('created_at','Database work enqueue clock.'),
 ('locked_by','Bounded worker lease token; only while claimed.'),('locked_at','Database lease acquisition clock.'),
 ('observation_id','Persisted canonical property observation FK; only after source/result CAS.'),
 ('completed_at','Persisted-result acknowledgement clock; source time remains on original observation.'),
 ('last_error','Fixed sanitized operational reason; no source payloads or provider errors.'))x(name,description)
 LOOP EXECUTE format('COMMENT ON COLUMN public.retained_listing_property_work.%I IS %L',c.name,c.description);END LOOP;
 FOR c IN SELECT * FROM(VALUES('id','Singletontrue work-state key.'),
 ('upper_recorded_at','Installation baseline upper recording clock; paired with original source PK, not event time.'),
 ('upper_source_id','Installation baseline upper source PK/FK; paired recording clock bounds finite scan.'),
 ('cursor_recorded_at','Last visited source recording clock, not acquisition completeness.'),
 ('cursor_source_id','Last visited original source PK/FK; exact tuple keyset position.'),
 ('keys_seen','Actual source keys visited including ineligible rows; not new observations.'),
 ('started_at','Database replay installation clock.'),('last_seed_at','Actual last source-page progress clock.'),
 ('scan_completed_at','Short final baseline page clock; new source inserts continue independently.'))x(name,description)
 LOOP EXECUTE format('COMMENT ON COLUMN public.retained_listing_property_replay.%I IS %L',c.name,c.description);END LOOP;
END $$;
COMMENT ON FUNCTION public.assay_retained_listing_properties() IS 'Service-only exact operational counters/finite source progress plus at most200oldest/newest canonical source-binding checks. Explicit partial when capped, sanitized unavailable on errors; never fleet or physical verification. No fact writes.';
COMMENT ON FUNCTION public.activate_retained_listing_property_intake() IS 'Deployment-owner-only exact fixed60/minute activation after ingest-observation deploy succeeds. All API roles denied; changed command remains paused.';
COMMENT ON FUNCTION public.claim_retained_listing_properties(text,integer) IS 'Service-only1..60(default20), governed500-source seed, SKIPLOCKED leases; source selectors only, no fact writes.';
COMMENT ON FUNCTION public.finish_retained_listing_property(uuid,uuid,text,text,uuid) IS 'Service-only worker lease CAS; done requires current canonical source/property/parent/clock/unknown-role binding. Fixed refusals/retries/deferred work retain explicit failure.';
NOTIFY pgrst,'reload schema';
COMMIT;
