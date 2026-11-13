-- Existing finite replay owner captured before the source routing extension.
CREATE OR REPLACE FUNCTION public.seed_retained_listing_properties()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
DECLARE s record;p record;n integer:=0;seeded integer:=0;direction text;upper_operator text;sources uuid[];repair_keys uuid[];repair_seeded integer:=0;raw_limit integer:=500;rr jsonb;last_vehicle uuid;active_vehicle uuid;last_source uuid;batch_sources uuid[];supported_sources uuid[];remaining integer;vehicles_visited integer:=0;vehicles_finished integer:=0;
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
 IF s.scan_completed_at IS NOT NULL AND s.native_identity_completed_at IS NOT NULL
  AND s.record_replay->>'completed_at' IS NULL THEN
  rr:=s.record_replay;
  IF rr->>'version' IS DISTINCT FROM 'retained_vehicle_properties_v1' THEN
   RAISE EXCEPTION 'Record replay checkpoint missing or changed';
  END IF;
  last_vehicle:=(rr->>'after_vehicle_id')::uuid;
  active_vehicle:=(rr->>'active_vehicle_id')::uuid;
  last_source:=coalesce((rr->>'after_source_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid);
  SELECT array_agg(id) INTO supported_sources FROM public.observation_sources
   WHERE slug IN('bat','mecum','craigslist','barrett-jackson');
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
      AND o.extraction_method IN('html_match','html_description_capture','html_parse','public_lot_index','next_data_json_parse','retained_native_fields_v1')
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
