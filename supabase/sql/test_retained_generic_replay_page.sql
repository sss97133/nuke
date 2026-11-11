-- Reuse the actual interleaved source migration and its read-only source fixtures.
-- All DML below addresses operational/test tables or JSON settings, never testimony.
\ir test_mccormick_retained_replay.sql
\ir ../migrations/20261111050000_bound_retained_generic_replay_page.sql
\ir ../migrations/20261111050000_bound_retained_generic_replay_page.sql
INSERT INTO public.observation_sources VALUES('4cdc735c-f117-42f2-889f-ba33805639a5','bat');
DO $contract$
DECLARE phase jsonb;baseline jsonb;state jsonb;n integer;empty_baseline jsonb;
BEGIN
 SELECT record_replay#>'{source_replays,mccormicks_identity_v1}' INTO phase FROM public.retained_listing_property_replay;
 IF phase->>'completed_at' IS NULL THEN RAISE EXCEPTION 'fixture source phase must be complete';END IF;
 baseline:=jsonb_build_object('version','retained_vehicle_properties_v1','after_vehicle_id','00000000-0000-0000-0000-000000000000',
  'after_source_id','00000000-0000-0000-0000-000000000000','active_vehicle_id',NULL,'upper_vehicle_id','ffffffff-ffff-4fff-8fff-ffffffffffff',
  'vehicles_finished',0,'source_keys_seen',0,'work_seeded',0,'completed_at',NULL,
  'source_replays',jsonb_build_object('mccormicks_identity_v1',phase));
 UPDATE public.retained_listing_property_replay SET record_replay=baseline;
 DELETE FROM public.retained_listing_property_work;
 PERFORM set_config('test.vehicles',(SELECT jsonb_agg(jsonb_build_object('id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),
  'is_public',true,'listing_kind','vehicle'))::text FROM generate_series(1,30)i),false);
 PERFORM set_config('test.observations',(SELECT jsonb_agg(jsonb_build_object('id','30000000-0000-4000-8000-'||lpad(i::text,12,'0'),
  'vehicle_id','20000000-0000-4000-8000-000000000001','source_id','4cdc735c-f117-42f2-889f-ba33805639a5',
  'kind','listing','extraction_method','html_match','is_superseded',false,'subject_type','vehicle','ingested_at','2026-01-01'))::text
  FROM generate_series(1,30)i),false);
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO state FROM public.retained_listing_property_replay;
 IF n<>25 OR state->>'source_keys_seen'<>'25' OR state->>'work_seeded'<>'100'
  OR state->>'after_source_id'<>'30000000-0000-4000-8000-000000000025'
  OR state->>'active_vehicle_id'<>'20000000-0000-4000-8000-000000000001'
  OR state->>'vehicles_finished'<>'0' OR state->>'completed_at' IS NOT NULL THEN
  RAISE EXCEPTION 'dense vehicle must pause at25 source rows: %',state;END IF;
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO state FROM public.retained_listing_property_replay;
 IF n<>5 OR state->>'source_keys_seen'<>'30' OR state->>'work_seeded'<>'120'
  OR state->>'vehicles_finished'<>'25' OR state->>'completed_at' IS NOT NULL THEN
  RAISE EXCEPTION 'resume must keep remaining sources and visit at most25 vehicles: %',state;END IF;
 n:=public.seed_retained_listing_properties();
 SELECT record_replay INTO state FROM public.retained_listing_property_replay;
 IF n<>0 OR state->>'vehicles_finished'<>'30' OR state->>'completed_at' IS NULL
  OR state#>'{source_replays,mccormicks_identity_v1}'<>phase THEN RAISE EXCEPTION 'completion or source checkpoint changed';END IF;
 PERFORM public.seed_retained_listing_properties();
 IF (SELECT count(*) FROM public.retained_listing_property_work)<>120 THEN RAISE EXCEPTION 'resume skipped or duplicated source work';END IF;
 -- Empty/unsupported vehicles also need a bounded page and a continuation.
 UPDATE public.retained_listing_property_replay SET record_replay=baseline;
 PERFORM set_config('test.observations','[]',false);
 PERFORM public.seed_retained_listing_properties();
 SELECT record_replay INTO state FROM public.retained_listing_property_replay;
 IF state->>'vehicles_finished'<>'25' OR state->>'completed_at' IS NOT NULL THEN RAISE EXCEPTION 'empty vehicle page is unbounded or prematurely complete';END IF;
 PERFORM public.seed_retained_listing_properties();
 SELECT record_replay INTO state FROM public.retained_listing_property_replay;
 IF state->>'vehicles_finished'<>'30' OR state->>'completed_at' IS NULL THEN RAISE EXCEPTION 'empty vehicle page lost continuation';END IF;
 RAISE NOTICE 'PASS:25-vehicle/source generic page, dense-vehicle continuation, no skipped/duplicate work, stable source checkpoint';
END $contract$;
