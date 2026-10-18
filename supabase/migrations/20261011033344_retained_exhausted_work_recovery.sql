-- Restore bounded exhausted operational work only after current retained-source qualification.
-- The original lease failure is retained; this does not claim a recovered historical root cause.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM cron.job WHERE jobname='project-retained-listing-properties' AND active AND schedule='* * * * *'
  AND encode(sha256(convert_to(command,'UTF8')),'base64')='w/ElpXz1aw8IfUpuaOrqo4T7qx//QC/kJOCRcCBUho0=') THEN RAISE EXCEPTION 'Listing owner paused or changed';END IF;
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2 THEN RAISE EXCEPTION 'Relevant data work active';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.claim_retained_listing_properties(text,integer)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'ncvsBq569AsAK8l+ZW1NDxa8Mo5eNJsHhFSQ1hd0vfo='
  OR encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_witness(public.vehicle_observations,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'DJp/hGw90lklOyVkfwR2+/VzU3avdiRD7OK7PL8tijQ='
  OR encode(sha256(convert_to(pg_get_functiondef('public.retained_description_powertrain_witness(text,text)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'dIEBT8Ezv1wQtOEkMd/vP/zOEihoK+cIPMw4Kn0XceY='
  OR encode(sha256(convert_to(pg_get_functiondef('public.retained_description_property_matches(public.vehicle_observations,public.vehicle_observations)'::regprocedure),'UTF8')),'base64') IS DISTINCT FROM 'a9mKqkkEQrXvSPYzo6sf7Kd1G40gQV+AQX3luPEYffg=' THEN RAISE EXCEPTION 'Current retained-source owner changed';END IF;
 IF EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND previous_scan_receipt ? 'exhausted_lease_retry_recovery') THEN RAISE EXCEPTION 'Exhausted work already rechecked';END IF;
 IF NOT EXISTS(SELECT FROM public.retained_listing_property_replay WHERE id AND projection_version IN('retained_listing_vin_label_v1','retained_craigslist_odometer_v1')) THEN RAISE EXCEPTION 'Current replay receipt owner unavailable';END IF;
 IF (SELECT count(*) FROM (VALUES
   ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b'::uuid,'engine_configuration','Engine Configuration','string',NULL::text),
   ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a'::uuid,'engine_displacement_l','Engine Displacement','numeric','liters'),
   ('235aed17-9bd3-4886-90be-9b1a8e2d1844'::uuid,'transmission_type','Transmission Type','enum',NULL::text))k(id,key,label,type,unit)
  JOIN public.observation_properties p ON p.id=k.id AND p.property_key=k.key AND p.label=k.label AND p.data_type::text=k.type
   AND p.unit IS NOT DISTINCT FROM k.unit AND p.namespace='core' AND p.ratified_at IS NOT NULL AND p.deprecated_at IS NULL
   AND 'specification'=ANY(p.applies_to_kinds))<>3 THEN RAISE EXCEPTION 'Ratified powertrain meaning changed';END IF;
END $$;
CREATE TEMP TABLE retained_exhausted_recheck_candidates ON COMMIT DROP AS
 SELECT q.source_observation_id,q.property_id,to_jsonb(q) AS previous_work
 FROM (SELECT * FROM public.retained_listing_property_work WHERE status='failed' AND attempts=3 AND
  ((last_error='lease_expired' AND next_attempt_at BETWEEN '2026-10-11T00:04:00.672708Z' AND '2026-10-11T00:05:01.036821Z') OR
   (last_error='canonical_request_failed' AND source_observation_id='b02d4de6-fa8a-4ab4-b219-26f993ca774f' AND property_id='235aed17-9bd3-4886-90be-9b1a8e2d1844'))
  ORDER BY next_attempt_at,source_observation_id,property_id LIMIT 130 FOR UPDATE SKIP LOCKED)q
 JOIN public.vehicle_observations p ON p.id=q.source_observation_id AND p.vehicle_id=q.vehicle_id
 JOIN public.vehicles v ON v.id=p.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
 JOIN public.observation_sources src ON src.id=p.source_id AND src.slug='bat' AND 'specification'=ANY(src.supported_observations)
 JOIN public.observation_properties prop ON prop.id=q.property_id AND prop.namespace='core' AND prop.deprecated_at IS NULL AND prop.ratified_at IS NOT NULL
  AND 'specification'=ANY(prop.applies_to_kinds) AND prop.property_key IN('engine_configuration','engine_displacement_l','transmission_type')
 WHERE public.observation_is_public(p.kind,p.structured_data) AND public.retained_description_property_witness(p,prop.property_key) IS NOT NULL
  AND (q.last_error='lease_expired' OR EXISTS(SELECT FROM public.vehicle_observations o
   WHERE o.source_identifier='retained_listing_transmission_type_v1:'||p.id::text AND o.source_id=p.source_id AND o.kind='specification'
    AND public.retained_description_property_matches(p,o)))
 FOR SHARE OF p,v,src,prop;
DO $$ DECLARE recovered jsonb;BEGIN
 SELECT jsonb_agg(c.previous_work ORDER BY c.source_observation_id,c.property_id) INTO recovered FROM retained_exhausted_recheck_candidates c;
 IF recovered IS NOT NULL THEN
  UPDATE public.retained_listing_property_replay SET previous_scan_receipt=coalesce(previous_scan_receipt,'{}'::jsonb)||
   jsonb_build_object('exhausted_lease_retry_recovery',jsonb_build_object('recovered_at',clock_timestamp(),'cap',130,
    'incident','exhausted_lease_window_and_one_admitted_claim_missing_completion','qualification','current_source_witness_rechecked; historical lease root cause remains unknown',
    'requeued',jsonb_array_length(recovered),'previous_work',recovered)) WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replay receipt owner unavailable';END IF;
  UPDATE public.retained_listing_property_work q SET status='pending',attempts=0,next_attempt_at=clock_timestamp()+interval '1 minute',locked_at=NULL,locked_by=NULL,
   last_error='qualified_exhausted_work_recheck'
  FROM retained_exhausted_recheck_candidates c WHERE q.source_observation_id=c.source_observation_id AND q.property_id=c.property_id;
 END IF;
END $$;
COMMIT;
