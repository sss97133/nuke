\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Disposable contract database required';
  END IF;
END $$;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
-- Empty type fixture only: no testimony rows are inserted or changed.
CREATE TABLE public.vehicle_events(metadata jsonb);
\ir ../migrations/20261108195216_vehicle_event_metadata_digest.sql
DO $test$
DECLARE v public.vehicle_events; sql_null text; json_null text; prior text; current text;
BEGIN
  sql_null := public.vehicle_event_metadata_digest(v);
  v.metadata := 'null'::jsonb;
  json_null := public.vehicle_event_metadata_digest(v);
  IF sql_null=json_null THEN RAISE EXCEPTION 'SQL NULL and JSON null collide'; END IF;
  v.metadata := jsonb_build_object('images',repeat('gallery/',10000),'source','test');
  prior := public.vehicle_event_metadata_digest(v);
  IF length(prior)<>64 THEN RAISE EXCEPTION 'Digest is not SHA256 hex'; END IF;
  v.metadata := v.metadata||jsonb_build_object('concurrent_gallery_edit',true);
  current := public.vehicle_event_metadata_digest(v);
  IF prior=current THEN RAISE EXCEPTION 'Concurrent metadata edit did not change token'; END IF;
  IF NOT has_function_privilege('service_role','public.vehicle_event_metadata_digest(public.vehicle_events)','EXECUTE')
    OR has_function_privilege('anon','public.vehicle_event_metadata_digest(public.vehicle_events)','EXECUTE')
    OR has_function_privilege('authenticated','public.vehicle_event_metadata_digest(public.vehicle_events)','EXECUTE') THEN
    RAISE EXCEPTION 'Service-only execution boundary changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.vehicle_event_metadata_digest(public.vehicle_events)'::regprocedure
    AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'Function must be immutable invoker with fixed search path';
  END IF;
END $test$;
