-- Whole JSON in this non-unique B-tree INCLUDE rejects legitimate native
-- observations above its tuple limit. Keep the complete testimony in the heap.
-- Live 2026-11-08: current specs readers use consensus/observation PK, keyed
-- listing history and typed-property indexes; this June covering index has zero
-- scans since restart. No reader, permission, source payload or row is changed.
-- Concurrent removal scans no heap. No build or timeout increase is required.
-- CI applies this file through psql in autocommit (not a transaction wrapper).
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset observation_index_prior_
SELECT set_config('statement_timeout',
  CASE WHEN current_setting('statement_timeout')::interval = interval '0'
    OR current_setting('statement_timeout')::interval > interval '10 seconds'
    THEN '10s' ELSE current_setting('statement_timeout') END, false);
SELECT set_config('lock_timeout',
  CASE WHEN current_setting('lock_timeout')::interval = interval '0'
    OR current_setting('lock_timeout')::interval > interval '2 seconds'
    THEN '2s' ELSE current_setting('lock_timeout') END, false);

DO $guard$
DECLARE target oid := to_regclass('public.idx_vobs_specs_covering');
        expected text := 'CREATE INDEX idx_vobs_specs_covering ON public.vehicle_observations USING btree (vehicle_id) INCLUDE (is_superseded, structured_data) WHERE ((NOT COALESCE(is_superseded, false)) AND (structured_data ?| ARRAY[''vin''::text, ''mileage''::text, ''transmission''::text, ''drivetrain''::text, ''body_style''::text, ''color''::text, ''interior_color''::text, ''engine_type''::text, ''fuel_type''::text]))';
        fallback record;
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indexrelid=target AND i.indrelid='public.vehicle_observations'::regclass
      AND c.relkind='i' AND NOT i.indisunique AND NOT i.indisprimary
      AND NOT i.indisreplident AND pg_get_indexdef(target)=expected) THEN
    RAISE EXCEPTION 'Unexpected observation covering index definition; refuse removal';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid=target)
    OR EXISTS (SELECT 1 FROM pg_stat_progress_create_index WHERE index_relid=target) THEN
    RAISE EXCEPTION 'Observation covering index has a constraint or active build';
  END IF;
  -- Verify the exact existing access paths used by current specs/profile reads.
  FOR fallback IN SELECT * FROM (VALUES
    ('vehicle_observations_pkey','CREATE UNIQUE INDEX vehicle_observations_pkey ON public.vehicle_observations USING btree (id)'),
    ('idx_vobs_engagement_contrib','CREATE INDEX idx_vobs_engagement_contrib ON public.vehicle_observations USING btree (vehicle_id, kind, is_superseded, ((structured_data ->> ''authored''::text))) WHERE (vehicle_id IS NOT NULL)'),
    ('idx_vehicle_observations_property','CREATE INDEX idx_vehicle_observations_property ON public.vehicle_observations USING btree (vehicle_id, property_id) WHERE ((property_id IS NOT NULL) AND (is_superseded = false))')
  ) f(name,definition) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.'||fallback.name)
      AND i.indrelid='public.vehicle_observations'::regclass AND i.indisvalid AND i.indisready
      AND pg_get_indexdef(i.indexrelid)=fallback.definition) THEN
      RAISE EXCEPTION 'Required observation reader index % unavailable or changed',fallback.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
    AND state='active' AND query ILIKE '%vehicle_observations%')>2
    OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock') THEN
    RAISE EXCEPTION 'Active observation work or lock wait; defer index removal';
  END IF;
END $guard$;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_vobs_specs_covering;

DO $verify$
BEGIN
  IF to_regclass('public.idx_vobs_specs_covering') IS NOT NULL THEN
    RAISE EXCEPTION 'Observation covering index remains';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock') THEN
    RAISE EXCEPTION 'Lock wait after index removal; stop and investigate';
  END IF;
END $verify$;
SET statement_timeout = :'observation_index_prior_statement_timeout';
SET lock_timeout = :'observation_index_prior_lock_timeout';
