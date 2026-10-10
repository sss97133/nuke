-- The installed worker completed714675 listing-key visits but could enqueue
-- only two color properties. Extend that owner to the four ratified powertrain
-- selectors from PR923; replay the entire finite listing baseline, not a cohort.
-- No fetch, model call, new fact store or added attempt capacity. The existing
--120/minute governor, source qualification, privacy and canonical writer remain.
-- Stage the job paused until CI deploys the matching drain; preserve owner pauses.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='project-retained-listing-properties' AND active
  AND schedule='* * * * *' AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN
  RAISE EXCEPTION 'Listing intake command changed or owner paused';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.enqueue_retained_listing_properties(uuid)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'lz7QSKcYsEX1TVkEPCaptGq8KvdCzz9CaUo728Mc8Ew=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'RRwgUSHdvW84Ql2Uxzq0XUObiFNiE0nUboikj7g6h/c=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'EOgYZUhwfQTd1hhVJW7oZMjpunQXvby9nBXJlOiizh0=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM 'agX0vmjyLd/ZjJe6dY/BaHj6NvtQRAObdayr5AeX0i4=' THEN
  RAISE EXCEPTION 'Listing replay or completion owner changed';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.retained_powertrain_value(text,jsonb)'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM '8PJwvvR+iZeD71bJvtev3hb+Tm4O2NgNUO9WLb6Qmrw=' OR
 encode(sha256(convert_to(pg_get_functiondef('public.validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64')
  IS DISTINCT FROM '0zQgj3IA8ijFKodCECFgVbtVPgSywopXpLRM6wIfz2Y=' THEN
  RAISE EXCEPTION 'Approved powertrain admission owner unavailable';END IF;
 IF (SELECT count(*) FROM public.observation_properties WHERE namespace='core' AND deprecated_at IS NULL
  AND 'specification'=ANY(applies_to_kinds) AND (id,property_key) IN
  (('514cacd3-82b4-4330-b3df-e292612ee718'::uuid,'interior_color'),
   ('efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid,'exterior_color'),
   ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration'),
   ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l'),
   ('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type'),
   ('32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid,'drivetrain_layout')))<>6 OR
  NOT EXISTS(SELECT 1 FROM public.observation_sources WHERE slug='bat' AND 'specification'::public.observation_kind=ANY(supported_observations)) THEN
  RAISE EXCEPTION 'Existing property/source registry changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.retained_listing_property_replay WHERE id) THEN
  RAISE EXCEPTION 'Existing replay receipt missing';END IF;
END $$;

ALTER TABLE public.retained_listing_property_work DROP CONSTRAINT retained_listing_property_work_property_id_check;
ALTER TABLE public.retained_listing_property_work ADD CONSTRAINT retained_listing_property_work_property_id_check CHECK(property_id IN
 ('514cacd3-82b4-4330-b3df-e292612ee718','efcb8c61-1ff5-4790-890e-2e09118e87e3',
  'c0f743ae-dc94-4dfd-98ef-514b76f74a9b','66b2f1f6-b714-4ac0-85b6-60ba89529c1a',
  '235aed17-9bd3-4886-90be-9b1a8e2d1844','32b51f19-e5cf-4f67-81d9-96c2d30885a1'));

CREATE OR REPLACE FUNCTION public.enqueue_retained_listing_properties(p_source uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE n integer;
BEGIN
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
 WHERE p.id=p_source AND p.kind='listing' AND p.extraction_method='html_match'
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
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

-- Rewrite only the closed property dispatch and value proof. Preserve installed
-- OIDs, owners, ACLs, concurrency budgets and all existing completion predicates.
DO $owners$
DECLARE f text;a text;b text;
BEGIN
 f:=pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure);
 a:=$a$CASE q.property_id WHEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid
  THEN 'retained_listing_interior_color_v1' ELSE 'retained_listing_exterior_color_v1' END$a$;
 b:=$b$CASE q.property_id
  WHEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid THEN 'retained_listing_interior_color_v1'
  WHEN 'efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid THEN 'retained_listing_exterior_color_v1'
  WHEN 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid THEN 'retained_listing_engine_configuration_v1'
  WHEN '66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid THEN 'retained_listing_engine_displacement_l_v1'
  WHEN '235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid THEN 'retained_listing_transmission_type_v1'
  WHEN '32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid THEN 'retained_listing_drivetrain_layout_v1' END$b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Property dispatch anchor changed';END IF;
 EXECUTE replace(f,a,b);

 f:=pg_get_functiondef('public.retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure);
 a:=$a$r.property_key IN('interior_color','exterior_color')$a$;
 b:=$b$r.property_key IN('interior_color','exterior_color','engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')$b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Completion property anchor changed';END IF;
 f:=replace(f,a,b);
 a:=$a$CASE r.property_key WHEN 'exterior_color' THEN 'color' ELSE 'interior_color' END$a$;
 b:=$b$CASE r.property_key WHEN 'exterior_color' THEN 'color' WHEN 'interior_color' THEN 'interior_color'
  WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END$b$;
 IF cardinality(string_to_array(f,a))<>3 THEN RAISE EXCEPTION 'Completion source field anchors changed';END IF;
 f:=replace(f,a,b);
 a:='o.structured_data->r.property_key=p.structured_data->('||b||')';
 b:='((r.property_key IN(''interior_color'',''exterior_color'') AND '||a||') OR
  (r.property_key IN(''engine_configuration'',''engine_displacement_l'',''transmission_type'',''drivetrain_layout'')
   AND o.structured_data->r.property_key=public.retained_powertrain_value(r.property_key,p.structured_data->('||b||'))
   AND o.structured_data->''source_value''=p.structured_data->('||b||')
   AND o.structured_data->>''normalization_version''=''retained_powertrain_v1''))';
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Completion value proof anchor changed';END IF;
 EXECUTE replace(f,a,b);
END $owners$;

ALTER TABLE public.retained_listing_property_replay
 ADD COLUMN projection_version text NOT NULL DEFAULT 'retained_colors_v1'
  CHECK(projection_version IN('retained_colors_v1','retained_listing_six_properties_v1')),
 ADD COLUMN previous_scan_receipt jsonb,
 ADD COLUMN work_seeded bigint NOT NULL DEFAULT 0 CHECK(work_seeded>=0);
-- Preserve the previous scan as an operational receipt. Its original testimony
-- and completed source-property rows remain intact; ON CONFLICT reuses them.
UPDATE public.retained_listing_property_replay r SET previous_scan_receipt=to_jsonb(r)-'previous_scan_receipt'-'projection_version'-'work_seeded',
 projection_version='retained_listing_six_properties_v1',upper_recorded_at=p.ingested_at,upper_source_id=p.id,
 cursor_recorded_at=NULL,cursor_source_id=NULL,reverse_cursor_recorded_at=NULL,reverse_cursor_source_id=NULL,
 keys_seen=0,work_seeded=0,started_at=clock_timestamp(),last_seed_at=NULL,scan_direction='newest',
 scan_completed_at=CASE WHEN p.id IS NULL THEN clock_timestamp() END
 FROM (SELECT true AS singleton) one LEFT JOIN LATERAL(SELECT id,ingested_at FROM public.vehicle_observations
  WHERE kind='listing' AND isfinite(ingested_at) ORDER BY ingested_at DESC,id DESC LIMIT 1)p ON true WHERE r.id;
DO $seed$
DECLARE f text:=pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure);
BEGIN
 f:=replace(f,'n integer:=0;direction text','n integer:=0;seeded integer:=0;direction text');
 f:=replace(f,'PERFORM public.enqueue_retained_listing_properties(p.id);','seeded:=seeded+public.enqueue_retained_listing_properties(p.id);');
 f:=replace(f,'keys_seen=keys_seen+n,last_seed_at','keys_seen=keys_seen+n,work_seeded=work_seeded+seeded,last_seed_at');
 EXECUTE f;
END $seed$;
DO $assay$
DECLARE f text:=pg_get_functiondef('public.assay_retained_listing_properties()'::regprocedure);a text;b text;
BEGIN
 a:=$a$'canonical_observations',distinct_rows,'completed_work',total,$a$;
 b:=$b$'canonical_observations',distinct_rows,'completed_work',total,
  'property_work',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.property_key,x.status) FROM (
   SELECT r.property_key,q.status,count(*) AS work_items FROM public.retained_listing_property_work q
   JOIN public.observation_properties r ON r.id=q.property_id GROUP BY r.property_key,q.status)x),
  'recent_window_minutes',30,
  'recent_completed_work',(SELECT count(*) FROM public.retained_listing_property_work
   WHERE status='done' AND completed_at>=statement_timestamp()-interval '30 minutes'),
  'recent_new_claims',(SELECT count(*) FROM public.retained_listing_property_work q
   JOIN public.vehicle_observations o ON o.id=q.observation_id
   WHERE q.status='done' AND q.completed_at>=statement_timestamp()-interval '30 minutes'
    AND o.ingested_at>=statement_timestamp()-interval '30 minutes'),$b$;
 IF cardinality(string_to_array(f,a))<>2 THEN RAISE EXCEPTION 'Installed assay output anchor changed';END IF;
 EXECUTE replace(f,a,b);
END $assay$;
DO $$ DECLARE j bigint;BEGIN
 SELECT jobid INTO STRICT j FROM cron.job WHERE jobname='project-retained-listing-properties';
 PERFORM cron.alter_job(job_id:=j,active:=false);
END $$;
COMMENT ON COLUMN public.retained_listing_property_replay.projection_version IS 'Finite replay epoch vocabulary: retained_colors_v1 or retained_listing_six_properties_v1. Source keys and work_seeded apply to the current epoch; historical completed work remains lifetime, not new coverage.';
COMMENT ON COLUMN public.retained_listing_property_replay.previous_scan_receipt IS 'Prior color-only operational scan row retained verbatim before restarting the finite listing baseline for six properties. Dated source visits are not counts of eligible vehicles or canonical claims.';
COMMENT ON COLUMN public.retained_listing_property_replay.work_seeded IS 'Actual new source-property queue keys inserted by finite replay during this epoch, excluding ON CONFLICT repeats. Not admission count; arrival-trigger work is measured separately by queue status.';
COMMENT ON TABLE public.retained_listing_property_work IS 'Existing service-only source-property operational queue owned by ingest-observation; six exact core property IDs. All-corpus finite listing replay plus future arrivals,120attempts/minute without added capacity,500pending+claimed backpressure, leases/load governor, canonical completion custody. Public BaT html_match testimony only; unsupported/ambiguous fields omitted, factory/current unknown, no fetch or model calls.';
NOTIFY pgrst,'reload schema';
COMMIT;
