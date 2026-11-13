-- Recovery for the exact invalid index left by deployment 42516196453.
-- RELEASE HOLD: the 60s build-only timeout below needs the owner's explicit
-- exception to .claude/rules/db-safety.md (postgres role default is 10s).
-- No transaction wrapper: CI applies with psql -f in autocommit.
-- Operational cleanup cron/function timeouts and role defaults are unchanged.
SELECT current_setting('statement_timeout') AS prior_statement_timeout,
       current_setting('lock_timeout') AS prior_lock_timeout \gset stale_index_
SET lock_timeout = '2s';

DO $guard$
DECLARE existing oid := to_regclass('public.idx_vehicles_stale_listing_clock');
        definition text;
BEGIN
  IF existing IS NOT NULL THEN
    SELECT pg_get_indexdef(i.indexrelid) INTO definition FROM pg_index i
      WHERE i.indexrelid=existing AND i.indrelid='public.vehicles'::regclass;
    IF definition IS DISTINCT FROM 'CREATE INDEX idx_vehicles_stale_listing_clock ON public.vehicles USING btree (COALESCE(listing_updated_at, listing_posted_at, updated_at) NULLS FIRST) WHERE ((is_for_sale IS TRUE) AND (deleted_at IS NULL))' THEN
      RAISE EXCEPTION 'Stale listing index definition differs; no recovery performed';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_stat_progress_create_index WHERE index_relid=existing) THEN
      RAISE EXCEPTION 'Stale listing index build already active; no recovery performed';
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND state='active' AND query ILIKE '%vehicles%')>2 THEN
    RAISE EXCEPTION 'Vehicles has active work; defer index recovery';
  END IF;
END $guard$;

-- A valid index is never dropped or rebuilt. The exact-definition guard above
-- also refuses a different same-name object rather than treating it as success.
SELECT EXISTS (SELECT 1 FROM pg_index
  WHERE indexrelid=to_regclass('public.idx_vehicles_stale_listing_clock')
    AND NOT indisvalid) AS drop_invalid \gset stale_index_
\if :stale_index_drop_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_stale_listing_clock;
DO $after_drop$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock') THEN
    RAISE EXCEPTION 'Lock wait detected after invalid index drop; stop and investigate';
  END IF;
END $after_drop$;
\endif

SELECT to_regclass('public.idx_vehicles_stale_listing_clock') IS NULL AS build_missing \gset stale_index_
\if :stale_index_build_missing
DO $before_build$
BEGIN
  IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND state='active' AND query ILIKE '%vehicles%')>2 THEN
    RAISE EXCEPTION 'Vehicles has active work; defer concurrent build';
  END IF;
END $before_build$;
-- One bounded concurrent build only; not a role or function configuration change.
SET statement_timeout = '60s';
CREATE INDEX CONCURRENTLY idx_vehicles_stale_listing_clock
  ON public.vehicles (COALESCE(listing_updated_at, listing_posted_at, updated_at) ASC NULLS FIRST)
  WHERE is_for_sale IS TRUE AND deleted_at IS NULL;
SET statement_timeout = :'stale_index_prior_statement_timeout';
\endif

DO $verify$
DECLARE definition text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO definition FROM pg_index i
  WHERE i.indexrelid=to_regclass('public.idx_vehicles_stale_listing_clock')
    AND i.indrelid='public.vehicles'::regclass AND i.indisvalid AND i.indisready;
  IF definition IS DISTINCT FROM 'CREATE INDEX idx_vehicles_stale_listing_clock ON public.vehicles USING btree (COALESCE(listing_updated_at, listing_posted_at, updated_at) NULLS FIRST) WHERE ((is_for_sale IS TRUE) AND (deleted_at IS NULL))' THEN
    RAISE EXCEPTION 'Stale listing index is not valid/ready with the expected definition';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock') THEN
    RAISE EXCEPTION 'Lock wait detected after index DDL; stop and investigate';
  END IF;
END $verify$;
SET lock_timeout = :'stale_index_prior_lock_timeout';
