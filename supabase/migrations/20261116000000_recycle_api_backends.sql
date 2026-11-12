-- Recycle the API's idle database connections before they exhaust the host's memory.
--
-- Measured on 2026-11-11 (host gauges from the project's metrics endpoint, 8 GB instance):
--   23:35Z, 43 minutes after a restart: 45 PostgREST connections, all idle, as old as the restart.
--           AnonPages 4.52 GB, MemAvailable 0.41 GB, swap in use.
--   23:37Z, after those connections were closed and PostgREST reconnected:
--           AnonPages 1.02 GB, MemAvailable 4.13 GB.
-- So the idle pool held about 3.5 GB, roughly 78 MB a connection. Each connection keeps its own
-- catalog and plan caches, and this schema has about 10,400 relations and 7,400 functions; the pool
-- allows 50 and the connections were never retired. The database froze twice that day (18:22Z and
-- 22:18Z, the second 3 h 42 min after a restart) with memory exhausted and no error line.
--
-- The pool's size and connection lifetime are platform settings outside the repo. This job gives the
-- connections a lifetime from inside the database: it closes PostgREST connections that are idle and
-- older than 15 minutes. PostgREST opens fresh ones on demand. A connection that is running a
-- request is never closed.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.recycle_api_backends(p_max_age interval DEFAULT interval '15 minutes')
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT count(*)::integer
  FROM (
    SELECT pg_terminate_backend(a.pid) AS closed
    FROM pg_stat_activity a
    WHERE a.backend_type = 'client backend'
      AND a.usename = 'authenticator'
      AND a.application_name LIKE 'PostgREST%'
      AND a.state = 'idle'
      AND a.state_change < now() - interval '2 seconds'
      AND a.backend_start < now() - greatest(p_max_age, interval '5 minutes')
  ) t
  WHERE t.closed;
$function$;

COMMENT ON FUNCTION public.recycle_api_backends(interval) IS
  'Closes PostgREST connections that are idle and older than p_max_age (floor 5 minutes) and returns how many. Their private caches grew to about 78 MB each and exhausted the host (2026-11-11). Run by cron recycle-api-backends.';

REVOKE ALL ON FUNCTION public.recycle_api_backends(interval) FROM PUBLIC, anon, authenticated, service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recycle-api-backends') THEN
    PERFORM cron.unschedule('recycle-api-backends');
  END IF;
  PERFORM cron.schedule('recycle-api-backends', '4-59/5 * * * *',
    $cmd$SELECT public.recycle_api_backends()$cmd$);
END
$do$;
