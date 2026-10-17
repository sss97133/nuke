-- Synthetic local/CI queue fixture; current queue owners read2026-10-15T03:39Z.
-- Requires test_retained_engine_family_intake_fixture.sql; never production.
-- cron.alter_job below models only scheduler activation, not pg_cron execution.
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Local fixture only';END IF;END $$;
INSERT INTO observation_properties(id,property_key,label,data_type,unit,namespace,category,applies_to_kinds,cardinality,trust_floor,expected_source_categories,ratified_at,verification_scope) VALUES
('66b2f1f6-b714-4ac0-85b6-60ba89529c1a','engine_displacement_l','Engine Displacement','numeric','liters','core','engine',ARRAY['specification']::observation_kind[],'single',0,ARRAY['registry','documentation']::source_category[],'2026-05-17T19:29:08.932116+00:00','class'),
('c0f743ae-dc94-4dfd-98ef-514b76f74a9b','engine_configuration','Engine Configuration','string',NULL,'core','engine',ARRAY['specification']::observation_kind[],'single',0,ARRAY['documentation','registry']::source_category[],'2026-05-17T19:29:08.932116+00:00','class'),
('235aed17-9bd3-4886-90be-9b1a8e2d1844','transmission_type','Transmission Type','enum',NULL,'core','drivetrain',ARRAY['specification']::observation_kind[],'single',0,ARRAY['registry','owner']::source_category[],'2026-05-17T19:29:08.932116+00:00','class'),
('32b51f19-e5cf-4f67-81d9-96c2d30885a1','drivetrain_layout','Drivetrain Layout','enum',NULL,'core','drivetrain',ARRAY['specification']::observation_kind[],'single',0,ARRAY['registry']::source_category[],'2026-05-17T19:29:08.932116+00:00','class'),
('9fc93dd3-3639-439a-8eed-3e9a0f846334','vin','VIN','string',NULL,'core','identity',ARRAY['specification','ownership','provenance']::observation_kind[],'single',0,ARRAY['registry','documentation','dealer']::source_category[],'2026-05-17T19:29:08.932116+00:00','both'),
('ece619f7-c49a-44f7-999f-a41acf5d4dc3','year','Model Year','integer',NULL,'core','identity',ARRAY['specification','listing']::observation_kind[],'single',0,ARRAY['registry','documentation','auction','marketplace']::source_category[],'2026-05-17T19:29:08.932116+00:00','both'),
('efcb8c61-1ff5-4790-890e-2e09118e87e3','exterior_color','Exterior Color','string',NULL,'core','spec',ARRAY['specification','condition']::observation_kind[],'single',0,ARRAY['owner','auction','marketplace']::source_category[],'2026-05-17T19:29:08.932116+00:00','instance'),
('514cacd3-82b4-4330-b3df-e292612ee718','interior_color','Interior Color','string',NULL,'core','spec',ARRAY['specification']::observation_kind[],'single',0,ARRAY['owner','auction']::source_category[],'2026-05-17T19:29:08.932116+00:00','instance'),
('abdd7a7a-02c1-4b09-afc6-1a288207dd2d','mileage_miles','Odometer Reading (mi)','integer','miles','core','condition',ARRAY['condition','listing','work_record']::observation_kind[],'multi',0,ARRAY['documentation','auction','shop','owner']::source_category[],'2026-05-17T19:29:08.932116+00:00','instance');
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
 CHECK ((property_id = ANY (ARRAY['514cacd3-82b4-4330-b3df-e292612ee718'::uuid, 'efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid, 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid, '66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid, '235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid, '32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid, 'abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid, 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid, '8d274b73-a8a6-43bf-9036-5864d0152725'::uuid, 'a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid, '9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid]))),
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
CREATE TABLE public.retained_listing_property_replay(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),upper_recorded_at timestamptz,upper_source_id uuid REFERENCES vehicle_observations(id),
 cursor_recorded_at timestamptz,cursor_source_id uuid REFERENCES vehicle_observations(id),keys_seen bigint NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT now(),last_seed_at timestamptz,scan_completed_at timestamptz,
 previous_scan_receipt jsonb,projection_version text,work_seeded bigint NOT NULL DEFAULT 0,
 reverse_cursor_recorded_at timestamptz,reverse_cursor_source_id uuid REFERENCES vehicle_observations(id),scan_direction text DEFAULT 'newest',
 native_identity_highwater uuid REFERENCES vehicle_observations(id),native_identity_cursor uuid REFERENCES vehicle_observations(id),
 native_identity_keys_seen bigint NOT NULL DEFAULT 0,native_identity_work_seeded bigint NOT NULL DEFAULT 0,native_identity_completed_at timestamptz);
INSERT INTO retained_listing_property_replay(id,scan_completed_at,native_identity_completed_at) VALUES(true,now(),now());
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text UNIQUE,active boolean,schedule text,command text);
CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET active=$2 WHERE jobid=$1$$;
INSERT INTO cron.job VALUES(517,'project-retained-listing-properties',true,'* * * * *','
 SELECT net.http_post(url:=''https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-observation'',
  headers:=jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',''Bearer ''||public.get_service_role_key_for_cron()),
  body:=''{"mode":"retained_listing_property_drain_v1","batch_size":120}''::jsonb,timeout_milliseconds:=60000);
 ');
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_sources uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE n integer;native_count integer;
BEGIN
 IF p_sources IS NULL OR cardinality(p_sources)=0 THEN RETURN 0;END IF;
 IF array_ndims(p_sources)<>1 OR cardinality(p_sources)>500 OR array_position(p_sources,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Expected at most500 nonnull retained source keys';END IF;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat'
 CROSS JOIN (VALUES('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color','interior_color'),
   ('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color','color'),
   ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration','engine_size'),
   ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l','engine_size'),
   ('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type','transmission'),
   ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout','drivetrain')) r(id,property_key,source_field)
 JOIN public.observation_properties k ON k.id=r.id AND k.property_key=r.property_key
  AND k.namespace='core' AND k.deprecated_at IS NULL AND 'specification'=ANY(k.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match'
 AND p.is_superseded IS FALSE AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
 AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
 AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
 AND p.confidence_score BETWEEN 0.6 AND 1
 AND jsonb_typeof(p.structured_data->r.source_field)='string'
 AND nullif(btrim(p.structured_data->>r.source_field),'') IS NOT NULL
 AND length(p.structured_data->>r.source_field)<=500
 AND btrim(p.structured_data->>r.source_field) !~* '^(unknown|n/a|unspecified)$'
 AND (r.property_key IN('interior_color','exterior_color') OR
  public.retained_powertrain_value(r.property_key,p.structured_data->r.source_field) IS NOT NULL)
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN (VALUES('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration'),
  ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l'),('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type'),
  ('abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid,'mileage_miles'),
  ('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color'),('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color'),
  ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout')) k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND (CASE WHEN k.key='mileage_miles' THEN 'condition' ELSE 'specification' END)=ANY(r.applies_to_kinds::text[])
 WHERE p.id=ANY(p_sources) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,k.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid,'year'),('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model'),('9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid,'vin'))k(id,key)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND p.kind='listing' AND p.extraction_method='html_match' AND p.is_superseded IS FALSE
  AND p.property_id IS NULL AND p.subject_type='vehicle' AND p.subject_id IS NULL
  AND p.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$' AND p.confidence_score BETWEEN 0.6 AND 1
  AND isfinite(p.ingested_at) AND (p.observed_at IS NULL OR isfinite(p.observed_at))
  AND public.retained_listing_identity_value(k.key,p.structured_data->k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='craigslist' AND 'listing'=ANY(s.supported_observations)
 JOIN public.observation_properties r ON r.id='abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid AND r.property_key='mileage_miles' AND r.namespace='core' AND r.data_type='integer' AND r.unit='miles' AND r.label='Odometer Reading (mi)' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_odometer_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='craigslist' AND 'listing'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'listing'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_craigslist_year_witness(p) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties r ON r.id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid AND r.property_key='year' AND r.namespace='core' AND r.data_type='integer' AND r.unit IS NULL AND r.label='Model Year' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,'year') IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;n:=n+native_count;
 INSERT INTO public.retained_listing_property_work(source_observation_id,property_id,vehicle_id)
 SELECT p.id,r.id,p.vehicle_id FROM public.vehicle_observations p
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources s ON s.id=p.source_id AND s.slug='bat' AND 'specification'=ANY(s.supported_observations)
 CROSS JOIN(VALUES('8d274b73-a8a6-43bf-9036-5864d0152725'::uuid,'make','Make'),('a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid,'model','Model'))k(id,key,label)
 JOIN public.observation_properties r ON r.id=k.id AND r.property_key=k.key AND r.label=k.label AND r.data_type='string' AND r.unit IS NULL AND r.namespace='core' AND r.deprecated_at IS NULL AND r.ratified_at IS NOT NULL AND 'specification'=ANY(r.applies_to_kinds)
 WHERE p.id=ANY(p_sources) AND public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,k.key) IS NOT NULL
 ON CONFLICT(source_observation_id,property_id) DO NOTHING;
 GET DIAGNOSTICS native_count=ROW_COUNT;RETURN n+native_count;

END $function$
;
CREATE OR REPLACE FUNCTION public.seed_retained_listing_properties()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE s record;p record;n integer:=0;seeded integer:=0;direction text;upper_operator text;sources uuid[];repair_keys uuid[];repair_seeded integer:=0;raw_limit integer:=500;
BEGIN
 IF (SELECT count(*) FROM public.retained_listing_property_work WHERE status IN('pending','claimed'))>=500 THEN RETURN 0;END IF;
 SELECT * INTO s FROM public.retained_listing_property_replay WHERE id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 0;END IF;
 IF s.native_identity_completed_at IS NULL THEN
  SELECT array_agg(x.source_observation_id ORDER BY x.source_observation_id) INTO repair_keys FROM(
   SELECT q.source_observation_id FROM public.retained_listing_property_work q
   WHERE q.property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'
    AND q.source_observation_id>coalesce(s.native_identity_cursor,'00000000-0000-0000-0000-000000000000'::uuid)
    AND q.source_observation_id<=s.native_identity_highwater ORDER BY q.source_observation_id LIMIT 100)x;
  repair_seeded:=public.enqueue_retained_listing_properties(repair_keys);
  UPDATE public.retained_listing_property_replay SET native_identity_cursor=coalesce(repair_keys[cardinality(repair_keys)],native_identity_cursor),
   native_identity_keys_seen=native_identity_keys_seen+coalesce(cardinality(repair_keys),0),
   native_identity_work_seeded=native_identity_work_seeded+repair_seeded,
   native_identity_completed_at=CASE WHEN coalesce(cardinality(repair_keys),0)<100 THEN clock_timestamp() END WHERE id;
  raw_limit:=400;
 END IF;
 IF s.scan_completed_at IS NOT NULL THEN RETURN coalesce(cardinality(repair_keys),0);END IF;
 -- Both tokens are closed constants. Literal ordering and bound operator let
 -- each direction use the existing (kind,ingested_at) index, avoiding a CASE
 -- sort over the baseline or a cached generic OR plan over the unvisited gap.
 direction:=CASE s.scan_direction WHEN 'newest' THEN 'DESC' ELSE 'ASC' END;
 upper_operator:=CASE WHEN s.reverse_cursor_source_id IS NULL THEN '<=' ELSE '<' END;
 FOR p IN EXECUTE format($query$
  SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at)
   AND (ingested_at,id)>($1,$2) AND (ingested_at,id) %s ($3,$4)
  ORDER BY ingested_at %s,id %s LIMIT %s$query$,upper_operator,direction,direction,raw_limit)
 USING coalesce(s.cursor_recorded_at,'-infinity'::timestamptz),
  coalesce(s.cursor_source_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(s.reverse_cursor_recorded_at,s.upper_recorded_at),
  coalesce(s.reverse_cursor_source_id,s.upper_source_id) LOOP
  sources:=array_append(sources,p.id);
  IF s.scan_direction='newest' THEN
   s.reverse_cursor_recorded_at:=p.ingested_at;s.reverse_cursor_source_id:=p.id;
  ELSE s.cursor_recorded_at:=p.ingested_at;s.cursor_source_id:=p.id;END IF;
  n:=n+1;
 END LOOP;
 seeded:=public.enqueue_retained_listing_properties(sources);
 UPDATE public.retained_listing_property_replay SET cursor_recorded_at=s.cursor_recorded_at,
  cursor_source_id=s.cursor_source_id,reverse_cursor_recorded_at=s.reverse_cursor_recorded_at,
  reverse_cursor_source_id=s.reverse_cursor_source_id,scan_direction=CASE s.scan_direction WHEN 'newest' THEN 'oldest' ELSE 'newest' END,
  keys_seen=keys_seen+n,work_seeded=work_seeded+seeded,last_seed_at=clock_timestamp(),
  scan_completed_at=CASE WHEN n<raw_limit THEN clock_timestamp() END WHERE id;
 RETURN n+coalesce(cardinality(repair_keys),0);
END $function$
;
CREATE OR REPLACE FUNCTION public.claim_retained_listing_properties(p_worker text, p_limit integer DEFAULT 20)
 RETURNS TABLE(source_observation_id uuid, property_id uuid, mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '10s'
AS $function$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Invalid bounded listing property worker';END IF;
 -- Paused installation is also a claim barrier for an already-running older worker.
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active) THEN RETURN;END IF;
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
 RETURNING q.source_observation_id,q.property_id,CASE q.property_id
  WHEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid THEN 'retained_listing_interior_color_v1'
  WHEN 'efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid THEN 'retained_listing_exterior_color_v1'
  WHEN 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid THEN 'retained_listing_engine_configuration_v1'
  WHEN '66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid THEN 'retained_listing_engine_displacement_l_v1'
  WHEN '235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid THEN 'retained_listing_transmission_type_v1'
  WHEN '32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid THEN 'retained_listing_drivetrain_layout_v1'
  WHEN 'abdd7a7a-02c1-4b09-afc6-1a288207dd2d'::uuid THEN 'retained_listing_mileage_miles_v1'
  WHEN 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid THEN 'retained_listing_year_v1'
  WHEN '8d274b73-a8a6-43bf-9036-5864d0152725'::uuid THEN 'retained_listing_make_v1'
  WHEN 'a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid THEN 'retained_listing_model_v1'
  WHEN '9fc93dd3-3639-439a-8eed-3e9a0f846334'::uuid THEN 'retained_listing_vin_v1' END;
END $function$
;
CREATE OR REPLACE FUNCTION public.finish_retained_listing_property(p_source uuid, p_property uuid, p_worker text, p_status text, p_result uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
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
 GET DIAGNOSTICS n=ROW_COUNT;IF n=1 AND p_status='done' AND p_property='ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid THEN PERFORM public.enqueue_retained_listing_properties(p_source);END IF;RETURN n=1;
END $function$
;
CREATE OR REPLACE FUNCTION public.assay_retained_listing_properties()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
AS $function$
DECLARE s jsonb;w jsonb;total bigint;sampled bigint;stale bigint;failed bigint;due bigint;distinct_rows bigint;property_counts jsonb;recent_completed bigint;
BEGIN
 SELECT to_jsonb(r) INTO s FROM public.retained_listing_property_replay r WHERE id;
 IF s IS NULL THEN RETURN jsonb_build_object('status','unavailable','reason','replay_state_missing');END IF;
 -- One full-work aggregation supplies every additive queue metric. Only the
 -- small property/status result is materialized; no lifetime row list is held.
 WITH property_status AS MATERIALIZED(
  SELECT property_id,status,count(*) AS work_items,
   count(*) FILTER(WHERE status='claimed' OR(status='pending' AND next_attempt_at<=now())) AS due_items,
   count(*) FILTER(WHERE status='done' AND completed_at>=statement_timestamp()-interval '30 minutes') AS recent_items
  FROM public.retained_listing_property_work GROUP BY property_id,status),
 status_counts AS(SELECT status,sum(work_items)::bigint AS n FROM property_status GROUP BY status)
 SELECT jsonb_object_agg(status,n),
  coalesce(sum(n) FILTER(WHERE status='done'),0)::bigint,
  coalesce(sum(n) FILTER(WHERE status='failed'),0)::bigint,
  (SELECT coalesce(sum(due_items),0)::bigint FROM property_status),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.property_key,x.status) FROM(
   SELECT r.property_key,q.status,sum(q.work_items)::bigint AS work_items FROM property_status q
   JOIN public.observation_properties r ON r.id=q.property_id GROUP BY r.property_key,q.status)x),
  (SELECT coalesce(sum(recent_items),0)::bigint FROM property_status)
 INTO w,total,failed,due,property_counts,recent_completed FROM status_counts;
 -- Preserve global distinctness across properties, including duplicate results.
 -- A grouped/hash alternative spilled more and was slower in the default-memory
 -- 500k local fixture. Keep COUNT DISTINCT; no memory or timeout increase.
 SELECT count(DISTINCT observation_id) INTO distinct_rows
 FROM public.retained_listing_property_work WHERE status='done';
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
  'canonical_observations',distinct_rows,'completed_work',total,
  'property_work',property_counts,
  'recent_window_minutes',30,
  'recent_completed_work',recent_completed,
  'recent_new_claims',(SELECT count(*) FROM public.retained_listing_property_work q
   JOIN public.vehicle_observations o ON o.id=q.observation_id
   WHERE q.status='done' AND q.completed_at>=statement_timestamp()-interval '30 minutes'
    AND o.ingested_at>=statement_timestamp()-interval '30 minutes'),'custody_sampled',sampled,'custody_sample_cap',200,
  'sample_stale',stale,'custody_coverage',CASE WHEN total>sampled THEN 'bounded_sample' ELSE 'all_completed_work' END,
  'full_current_custody_verified',total=sampled AND stale=0,'due',due,'failed',failed,
  'provider_calls',0,'model_calls',0,'role','attributed_retained_listing_claim','factory_configuration_verified',false,
  'measured_at',statement_timestamp());
EXCEPTION WHEN query_canceled THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
 WHEN OTHERS THEN RETURN jsonb_build_object('status','unavailable','reason','read_failed','sqlstate',SQLSTATE);
END $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_source uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
 SELECT CASE WHEN p_source IS NULL THEN 0 ELSE public.enqueue_retained_listing_properties(ARRAY[p_source]) END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_enqueue_retained_listing_properties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN PERFORM public.enqueue_retained_listing_properties(NEW.id);RETURN NEW;END $function$
;
CREATE OR REPLACE FUNCTION public.activate_retained_listing_property_intake()
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '1s'
 SET statement_timeout TO '5s'
AS $function$
DECLARE j bigint;BEGIN
 SELECT jobid INTO j FROM cron.job WHERE jobname='project-retained-listing-properties' AND schedule='* * * * *'
 AND regexp_replace(command,'\s','','g')=regexp_replace($cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ingest-observation',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"mode":"retained_listing_property_drain_v1","batch_size":120}'::jsonb,timeout_milliseconds:=60000);
 $cmd$,'\s','','g');
 IF j IS NULL THEN RAISE EXCEPTION 'Installed fixed listing property contract unavailable';END IF;
 PERFORM cron.alter_job(job_id:=j,active:=true);RETURN true;
END $function$
;
CREATE TRIGGER retained_listing_property_intake AFTER INSERT ON public.vehicle_observations FOR EACH ROW WHEN (((new.kind = 'listing'::observation_kind) AND ((new.extraction_method = ANY (ARRAY['html_match'::text, 'html_description_capture'::text])) OR ((new.extraction_method = 'html_parse'::text) AND (new.source_id = 'd7dad87c-0dc3-4b98-a31a-edf511618f8c'::uuid))))) EXECUTE FUNCTION trg_enqueue_retained_listing_properties();
ALTER TABLE retained_listing_property_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE retained_listing_property_replay ENABLE ROW LEVEL SECURITY;
CREATE POLICY retained_listing_property_work_service_read ON retained_listing_property_work FOR SELECT TO service_role USING(true);
CREATE POLICY retained_listing_property_replay_service_read ON retained_listing_property_replay FOR SELECT TO service_role USING(true);
GRANT SELECT ON retained_listing_property_work,retained_listing_property_replay TO service_role;
REVOKE ALL ON FUNCTION enqueue_retained_listing_properties(uuid[]),enqueue_retained_listing_properties(uuid),
 seed_retained_listing_properties(),claim_retained_listing_properties(text,integer),
 finish_retained_listing_property(uuid,uuid,text,text,uuid),assay_retained_listing_properties(),activate_retained_listing_property_intake() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION enqueue_retained_listing_properties(uuid[]),enqueue_retained_listing_properties(uuid),
 seed_retained_listing_properties(),claim_retained_listing_properties(text,integer),
 finish_retained_listing_property(uuid,uuid,text,text,uuid),assay_retained_listing_properties() TO service_role;

-- Existing public bulk consumer and original metadata columns. No source scalars invented.
ALTER TABLE public.vehicles ADD COLUMN body_style text,
 ADD COLUMN color text,
 ADD COLUMN created_at timestamp with time zone,
 ADD COLUMN drivetrain text,
 ADD COLUMN engine_size text,
 ADD COLUMN engine_type text,
 ADD COLUMN interior_color text,
 ADD COLUMN make text,
 ADD COLUMN mileage integer,
 ADD COLUMN model text,
 ADD COLUMN transmission text,
 ADD COLUMN trim text,
 ADD COLUMN updated_at timestamp with time zone,
 ADD COLUMN vin text,
 ADD COLUMN year integer;
CREATE OR REPLACE FUNCTION public.retained_vehicle_record_property_bindings(p_record jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH fields(origin_column,property_key,normalization_version) AS(VALUES
  ('year','year','retained_record_identity_labels_v1'),('make','make','retained_record_identity_labels_v1'),
  ('model','model','retained_record_identity_labels_v1'),('vin','vin','retained_record_identity_labels_v1'),
  ('trim','trim','retained_record_identity_labels_v1'),('color','exterior_color','retained_record_text_v1'),
  ('interior_color','interior_color','retained_record_text_v1'),
  ('engine_size','engine_configuration','retained_powertrain_v1'),('engine_type','engine_configuration','retained_powertrain_v1'),
  ('engine_size','engine_displacement_l','retained_powertrain_v1'),('transmission','transmission_type','retained_powertrain_v1'),
  ('drivetrain','drivetrain_layout','retained_powertrain_v1')),
 values AS MATERIALIZED(SELECT f.*,p_record->f.origin_column AS source_value,
  CASE WHEN f.normalization_version='retained_powertrain_v1' THEN public.retained_powertrain_value(f.property_key,p_record->f.origin_column)
   WHEN f.property_key IN('year','make','model','vin') THEN public.retained_listing_identity_value(f.property_key,p_record->f.origin_column)
   ELSE public.retained_listing_identity_value('model',p_record->f.origin_column) END AS value FROM fields f),
 bound AS MATERIALIZED(SELECT v.*,r.id AS property_id,r.data_type,r.unit FROM values v JOIN public.observation_properties r
  ON r.property_key=v.property_key AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL AND 'specification'=ANY(r.applies_to_kinds)
  AND r.unit IS NOT DISTINCT FROM CASE WHEN v.property_key='engine_displacement_l' THEN 'liters'::text END
  AND r.data_type=CASE WHEN v.property_key='year' THEN 'integer' WHEN v.property_key='engine_displacement_l' THEN 'numeric'
   WHEN v.property_key IN('transmission_type','drivetrain_layout') THEN 'enum' ELSE 'string' END WHERE v.value IS NOT NULL),
 conflicts AS(SELECT property_id,count(DISTINCT value)>1 AS disagree FROM bound GROUP BY property_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('property_id',b.property_id,'property_key',b.property_key,'data_type',b.data_type,'unit',b.unit,
  'value',b.value,'origin_relation','vehicles','origin_column',b.origin_column,'source_value',b.source_value,
  'normalization_version',b.normalization_version,'status','retained_record_binding','source_attribution_status','unassayed',
  'claim_role','record_metadata','independent_source',false,'factory_configuration_status','unknown','current_configuration_status','unknown',
  'record_columns_disagree',c.disagree) ORDER BY b.property_key,b.origin_column),'[]'::jsonb)
 FROM bound b JOIN conflicts c ON c.property_id=b.property_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_ids uuid[], p_include_typed_claims boolean DEFAULT false)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
BEGIN
 IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids)=0 THEN RETURN;END IF;
 IF array_ndims(p_vehicle_ids)<>1 OR cardinality(p_vehicle_ids)>200 OR array_position(p_vehicle_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Expected at most200 nonnull vehicle keys' USING ERRCODE='22023';END IF;
 IF p_include_typed_claims IS NULL OR (p_include_typed_claims AND cardinality(p_vehicle_ids)>20) THEN RAISE EXCEPTION 'Typed custody reads require at most20 vehicle keys' USING ERRCODE='22023';END IF;
 RETURN QUERY
 WITH requested AS MATERIALIZED(SELECT id,min(ord) AS ord FROM unnest(p_vehicle_ids) WITH ORDINALITY x(id,ord) GROUP BY id),
 gate AS MATERIALIZED(SELECT v.id,r.ord,v.created_at,v.updated_at,
  jsonb_build_object('year',v.year,'make',v.make,'model',v.model,'vin',v.vin,'trim',v.trim,'mileage',v.mileage,
   'color',v.color,'interior_color',v.interior_color,'transmission',v.transmission,'drivetrain',v.drivetrain,
   'engine_type',v.engine_type,'engine_size',v.engine_size,'body_style',v.body_style) AS retained_fields
  FROM requested r JOIN public.vehicles v ON v.id=r.id
  WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
 field_contracts(key,data_type) AS(VALUES('year','integer'),('make','string'),('model','string'),('vin','string'),('trim','string'),
  ('mileage','integer'),('color','string'),('interior_color','string'),('transmission','string'),('drivetrain','string'),
  ('engine_type','string'),('engine_size','string'),('body_style','string'))
 SELECT jsonb_build_object('schema_version','vehicle_data_model_v1','vehicle_id',g.id,'read_at',statement_timestamp(),
  'grain','stored_vehicle_record','physical_identity_status','unresolved',
  'retained_record',jsonb_build_object('origin_relation','vehicles','row_created_at',g.created_at,'row_updated_at',g.updated_at,
   'clock_basis','record_maintenance_not_source_event_or_capture','source_attribution_status','unassayed',
   'factory_configuration_status','unknown','current_configuration_status','unknown',
   'property_bindings',public.retained_vehicle_record_property_bindings(g.retained_fields),
   'attributes',(SELECT jsonb_object_agg(f.key,jsonb_build_object('value',g.retained_fields->f.key,'data_type',f.data_type,
    'origin_column',f.key,'unit',NULL,'unit_status','not_established','value_status',CASE WHEN g.retained_fields->f.key IS NULL OR g.retained_fields->f.key='null'::jsonb THEN 'unrecorded' ELSE 'retained_record_value' END)) FROM field_contracts f)),
  'typed_claims_status',CASE WHEN p_include_typed_claims THEN 'current_core_scope_read' ELSE 'not_requested' END,
  'typed_claims',CASE WHEN p_include_typed_claims THEN coalesce((
   SELECT jsonb_agg(jsonb_build_object('property_id',r.id,'property_key',r.property_key,'data_type',r.data_type,'unit',r.unit,
    'value',c.structured_data->r.property_key,'status','current_canonical_claim','observation_id',c.observation_id,
    'source_id',o.source_id,'source_url',o.source_url,'source_observation_id',o.source_observation_id,
    'kind',o.kind,'extraction_method',o.extraction_method,'confidence_score',o.confidence_score,
    'observed_at',o.observed_at,'ingested_at',o.ingested_at,
    'qualifiers',jsonb_strip_nulls(jsonb_build_object(
     'claim_role',c.structured_data->'claim_role','source_profile',c.structured_data->'source_profile',
     'observed_at_basis',c.structured_data->'observed_at_basis','source_event_time_status',c.structured_data->'source_event_time_status',
     'source_recorded_at',c.structured_data->'source_recorded_at','source_observed_at',c.structured_data->'source_observed_at',
     'source_value',c.structured_data->'source_value','normalization_version',c.structured_data->'normalization_version',
     'source_subject_label',c.structured_data->'source_subject_label','source_make_label',c.structured_data->'source_make_label',
     'model_label_scope',c.structured_data->'model_label_scope','identity_resolution_status',c.structured_data->'identity_resolution_status',
     'factory_configuration_status',c.structured_data->'factory_configuration_status','current_configuration_status',c.structured_data->'current_configuration_status',
     'independent_source',c.structured_data->'independent_source','reported_precision_miles',c.structured_data->'reported_precision_miles',
     'value_is_approximate',c.structured_data->'value_is_approximate','reading_role',c.structured_data->'reading_role',
     'true_mileage_status',c.structured_data->'true_mileage_status','limitation',c.structured_data->'limitation')))
    ORDER BY r.property_key)
   FROM (SELECT * FROM public.vehicle_canonical vc WHERE vc.vehicle_id=g.id OFFSET 0)c
   JOIN public.vehicle_observations o ON o.id=c.observation_id AND o.vehicle_id=g.id AND public.observation_is_public(o.kind,o.structured_data)
   JOIN public.observation_properties r ON r.id=c.property_id AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL
    AND r.property_key IN('year','make','model','vin','interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout','mileage_miles')
   WHERE CASE WHEN r.data_type IN('string','enum') THEN jsonb_typeof(c.structured_data->r.property_key)='string'
    WHEN r.data_type='numeric' THEN jsonb_typeof(c.structured_data->r.property_key)='number'
    WHEN r.data_type='integer' THEN CASE WHEN jsonb_typeof(c.structured_data->r.property_key)='number'
     THEN (c.structured_data->>r.property_key)::numeric=trunc((c.structured_data->>r.property_key)::numeric) ELSE false END
    ELSE false END),'[]'::jsonb) ELSE '[]'::jsonb END,
  'model_scope',jsonb_build_object('retained_record_fields',13,'record_binding_property_keys',11,'canonical_property_keys',11,'complete_vehicle_model',false,
   'source_event_history','not_reconstructed','retained_metadata_is_typed_testimony',false))
 FROM gate g ORDER BY g.ord;
END $function$
;
REVOKE ALL ON FUNCTION get_vehicle_specs(uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_vehicle_specs(uuid[],boolean) TO anon,authenticated,service_role;
