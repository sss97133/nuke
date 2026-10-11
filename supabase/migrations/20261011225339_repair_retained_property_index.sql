-- Repair the existing typed-property access path, not the observation model.
-- Live 2026-10-11: indisvalid=false, indisready=false, relpages=0; whole-log
-- property counts chose a sequential scan and exceeded the 15-second read cap.
-- Autocommit is required by REINDEX CONCURRENTLY; existing CI uses psql -f.
-- Never raise the 120-second ceiling, pause writers or change testimony.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $$
BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock')
  OR (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
      AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2
  OR EXISTS(SELECT FROM pg_stat_progress_create_index WHERE relid='public.vehicle_observations'::regclass)
 THEN RAISE EXCEPTION 'Observation index repair requires an idle DDL lane';END IF;
 IF NOT EXISTS(SELECT FROM pg_index WHERE indexrelid='public.idx_vehicle_observations_property'::regclass
               AND indrelid='public.vehicle_observations'::regclass AND NOT indisvalid AND NOT indisready)
  OR pg_get_indexdef('public.idx_vehicle_observations_property'::regclass) IS DISTINCT FROM
  'CREATE INDEX idx_vehicle_observations_property ON public.vehicle_observations USING btree (vehicle_id, property_id) WHERE ((property_id IS NOT NULL) AND (is_superseded = false))'
 THEN RAISE EXCEPTION 'Existing invalid property index changed; inspect its current owner';END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname ~ '^idx_vehicle_observations_property_cc(new|old)[0-9]*$')
 THEN RAISE EXCEPTION 'Previous concurrent repair artefact requires inspection';END IF;
END $$;

REINDEX INDEX CONCURRENTLY public.idx_vehicle_observations_property;

DO $$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_index WHERE indexrelid='public.idx_vehicle_observations_property'::regclass
               AND indrelid='public.vehicle_observations'::regclass AND indisvalid AND indisready)
 THEN RAISE EXCEPTION 'Property index repair did not complete';END IF;
END $$;

SELECT count(*) AS lock_waiters_after_repair FROM pg_stat_activity WHERE wait_event_type='Lock';
RESET lock_timeout;
RESET statement_timeout;
