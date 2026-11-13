-- Resume supported retained properties for the full stored-vehicle horizon.
-- Existing queue/intake/custody owns every claim; no source/vehicle value is rewritten.
-- No new worker, schedule, capacity, property, access grant, fetch or model call.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN
  RAISE EXCEPTION 'Retained intake paused or changed';
 END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
  AND query ~ '(retained_listing_property|vehicle_observations)')>2 THEN
  RAISE EXCEPTION 'Relevant data work active; defer replay activation';
 END IF;
 IF NOT EXISTS(SELECT FROM public.observation_sources WHERE slug='mecum' AND 'specification'=ANY(supported_observations)) THEN
  RAISE EXCEPTION 'Mecum identity admission must be deployed first';
 END IF;
END $guard$;
ALTER TABLE public.retained_listing_property_replay ADD COLUMN record_replay jsonb;
UPDATE public.retained_listing_property_replay SET record_replay=jsonb_build_object(
 'version','retained_vehicle_properties_v1','grain','stored_vehicle_record',
 'upper_vehicle_id',coalesce((SELECT id FROM public.vehicles ORDER BY id DESC LIMIT 1),'00000000-0000-0000-0000-000000000000'::uuid),
 'after_vehicle_id','00000000-0000-0000-0000-000000000000','active_vehicle_id',NULL,
 'after_source_id','00000000-0000-0000-0000-000000000000','vehicles_finished',0,'source_keys_seen',0,'work_seeded',0,
 'started_at',clock_timestamp(),'last_seed_at',NULL,'completed_at',NULL) WHERE id;
DO $patch$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.seed_retained_listing_properties()'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'bwjCTE1uIGnzpY4HEA/GqoYA01aJsa/XRJdlxy5XB/A=' THEN
  RAISE EXCEPTION 'seed_retained_listing_properties changed; review replay activation';
 END IF;
 f:=replace(f,$old0$raw_limit integer:=500;$old0$,$new0$raw_limit integer:=500;rr jsonb;last_vehicle uuid;active_vehicle uuid;last_source uuid;batch_sources uuid[];supported_sources uuid[];remaining integer;vehicles_visited integer:=0;vehicles_finished integer:=0;$new0$);
 f:=replace(f,$old1$ IF s.scan_completed_at IS NOT NULL THEN RETURN coalesce(cardinality(repair_keys),0);END IF;$old1$,$new1$ IF s.scan_completed_at IS NOT NULL AND s.native_identity_completed_at IS NOT NULL
  AND s.record_replay->>'completed_at' IS NULL THEN
  rr:=s.record_replay;
  IF rr->>'version' IS DISTINCT FROM 'retained_vehicle_properties_v1' THEN
   RAISE EXCEPTION 'Record replay checkpoint missing or changed';
  END IF;
  last_vehicle:=(rr->>'after_vehicle_id')::uuid;
  active_vehicle:=(rr->>'active_vehicle_id')::uuid;
  last_source:=coalesce((rr->>'after_source_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid);
  SELECT array_agg(id) INTO supported_sources FROM public.observation_sources
   WHERE slug IN('bat','mecum','craigslist');
  FOR p IN SELECT v.id,v.is_public,v.deleted_at,v.listing_kind FROM public.vehicles v
   WHERE v.id>last_vehicle AND v.id<=(rr->>'upper_vehicle_id')::uuid ORDER BY v.id LIMIT 500 LOOP
   vehicles_visited:=vehicles_visited+1;
   IF active_vehicle IS DISTINCT FROM p.id THEN
    last_source:='00000000-0000-0000-0000-000000000000'::uuid;
   END IF;
   batch_sources:=NULL;
   remaining:=500-coalesce(cardinality(sources),0);
   IF p.is_public IS TRUE AND p.deleted_at IS NULL AND p.listing_kind IS DISTINCT FROM 'non_vehicle_item' THEN
    SELECT array_agg(x.id ORDER BY x.id) INTO batch_sources FROM(
     SELECT o.id FROM public.vehicle_observations o
     WHERE o.vehicle_id=p.id AND o.source_id=ANY(supported_sources)
      AND o.kind IN('listing','sale_result') AND o.is_superseded IS FALSE AND o.property_id IS NULL
      AND o.subject_type='vehicle' AND o.subject_id IS NULL
      AND o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index')
      AND o.id>last_source ORDER BY o.id LIMIT remaining+1)x;
   END IF;
   IF coalesce(cardinality(batch_sources),0)>remaining THEN
    sources:=coalesce(sources,ARRAY[]::uuid[])||batch_sources[1:remaining];
    active_vehicle:=p.id;last_source:=batch_sources[remaining];
    EXIT;
   END IF;
   sources:=coalesce(sources,ARRAY[]::uuid[])||coalesce(batch_sources,ARRAY[]::uuid[]);
   last_vehicle:=p.id;active_vehicle:=NULL;
   last_source:='00000000-0000-0000-0000-000000000000'::uuid;
   vehicles_finished:=vehicles_finished+1;
   EXIT WHEN cardinality(sources)>=500;
  END LOOP;
  seeded:=public.enqueue_retained_listing_properties(sources);
  rr:=rr||jsonb_build_object('after_vehicle_id',last_vehicle,'active_vehicle_id',active_vehicle,
   'after_source_id',last_source,'vehicles_finished',(rr->>'vehicles_finished')::bigint+vehicles_finished,
   'source_keys_seen',(rr->>'source_keys_seen')::bigint+coalesce(cardinality(sources),0),
   'work_seeded',(rr->>'work_seeded')::bigint+seeded,'last_seed_at',clock_timestamp(),
   'completed_at',CASE WHEN active_vehicle IS NULL AND
    (vehicles_visited<500 AND coalesce(cardinality(sources),0)<500 OR last_vehicle>=(rr->>'upper_vehicle_id')::uuid)
    THEN clock_timestamp() END);
  UPDATE public.retained_listing_property_replay SET record_replay=rr WHERE id;
  RETURN coalesce(cardinality(sources),0);
 END IF;
 IF s.scan_completed_at IS NOT NULL THEN RETURN coalesce(cardinality(repair_keys),0);END IF;$new1$);
 EXECUTE f;
END $patch$;
DO $patch$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.assay_retained_listing_properties()'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'jK1B7ujxFUnh8x2vNbAyNLYH/AsV9i/vMUCdyWOTlNk=' THEN
  RAISE EXCEPTION 'assay_retained_listing_properties changed; review replay activation';
 END IF;
 f:=replace(f,$old0$WHEN s->>'scan_completed_at' IS NULL OR due>0 OR total>sampled THEN 'partial'$old0$,$new0$WHEN s->>'scan_completed_at' IS NULL OR s->'record_replay'->>'completed_at' IS NULL OR due>0 OR total>sampled THEN 'partial'$new0$);
 EXECUTE f;
END $patch$;
COMMENT ON COLUMN public.retained_listing_property_replay.record_replay IS
 'Bounded historical source-property replay over a fixed vehicle-ID horizon. Processing counters are not verified vehicle or fleet-readiness counts. At most500 vehicle visits and500 source keys per seed; existing queue backpressure and all source/privacy/custody gates remain authoritative.';
DO $locks$ BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock wait detected; rollback replay activation';
 END IF;
END $locks$;
COMMIT;
