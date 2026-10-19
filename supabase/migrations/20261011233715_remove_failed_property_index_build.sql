-- Remove only the extra invalid index left by this session's timed-out
-- REINDEX CONCURRENTLY (Supabase CI38184410285). The original index and all
-- observations remain unchanged. This cleanup does not deliver the repair.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $$
BEGIN
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock')
  OR (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
      AND query ~ '(vehicle_observations|retained_listing_property|vehicle_canonical|get_field_provenance)')>2
  OR EXISTS(SELECT FROM pg_stat_progress_create_index WHERE relid='public.vehicle_observations'::regclass)
 THEN RAISE EXCEPTION 'Failed index cleanup requires an idle DDL lane';END IF;
 IF NOT EXISTS(SELECT FROM pg_index WHERE indexrelid='public.idx_vehicle_observations_property_ccnew'::regclass
               AND indrelid='public.vehicle_observations'::regclass AND NOT indisvalid AND indisready
               AND NOT indisunique AND NOT indisprimary)
  OR pg_get_indexdef('public.idx_vehicle_observations_property_ccnew'::regclass) IS DISTINCT FROM
  'CREATE INDEX idx_vehicle_observations_property_ccnew ON public.vehicle_observations USING btree (vehicle_id, property_id) WHERE ((property_id IS NOT NULL) AND (is_superseded = false))'
  OR NOT EXISTS(SELECT FROM pg_index WHERE indexrelid='public.idx_vehicle_observations_property'::regclass
                AND indrelid='public.vehicle_observations'::regclass AND NOT indisvalid AND NOT indisready)
 THEN RAISE EXCEPTION 'Failed build state changed; inspect before cleanup';END IF;
END $$;

DROP INDEX CONCURRENTLY public.idx_vehicle_observations_property_ccnew;

SELECT count(*) AS lock_waiters_after_cleanup FROM pg_stat_activity WHERE wait_event_type='Lock';
RESET lock_timeout;
RESET statement_timeout;
