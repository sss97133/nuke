-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicles_autovacuum -f this-file.sql
-- Proves 20261126030000_vehicles_autovacuum_visibility.sql: public.vehicles carries exactly
-- autovacuum_vacuum_scale_factor 0.02 and autovacuum_vacuum_insert_scale_factor 0.02 beside the storage
-- parameters it already had. No other table changes. The migration runs no VACUUM and leaves no lock_timeout behind.
-- Applying it twice gives the same result.
-- Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'run only on an empty disposable PG17 database named dm_refinement_*';
  END IF;
END $$;

-- Fixture: a vehicles table that already has one unrelated storage parameter, and a neighbour table with none.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, heat_score numeric) WITH (fillfactor = 90);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY);
INSERT INTO public.vehicles SELECT gen_random_uuid(), g FROM generate_series(1, 50) g;

\ir ../migrations/20261126030000_vehicles_autovacuum_visibility.sql
\ir ../migrations/20261126030000_vehicles_autovacuum_visibility.sql

DO $$
DECLARE
  got text[] := (SELECT array_agg(o ORDER BY o) FROM pg_class c, unnest(c.reloptions) o
                  WHERE c.oid = 'public.vehicles'::regclass);
  want text[] := ARRAY['autovacuum_vacuum_insert_scale_factor=0.02', 'autovacuum_vacuum_scale_factor=0.02',
                       'fillfactor=90'];
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'vehicles reloptions %, want %', got, want;
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.vehicle_images'::regclass) IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle_images storage parameters changed';
  END IF;
  IF current_setting('lock_timeout') <> '0' THEN
    RAISE EXCEPTION 'lock_timeout left at % after the migration', current_setting('lock_timeout');
  END IF;
END $$;

-- No hand VACUUM or ANALYZE in the migration: the table's own counters stay at zero.
SELECT pg_stat_force_next_flush();
SELECT pg_stat_clear_snapshot();
DO $$
DECLARE s record;
BEGIN
  SELECT vacuum_count, analyze_count, last_vacuum, last_analyze INTO s
    FROM pg_stat_user_tables WHERE relid = 'public.vehicles'::regclass;
  IF s.vacuum_count <> 0 OR s.analyze_count <> 0 OR s.last_vacuum IS NOT NULL OR s.last_analyze IS NOT NULL THEN
    RAISE EXCEPTION 'migration ran VACUUM or ANALYZE on vehicles (vacuum %, analyze %)', s.vacuum_count, s.analyze_count;
  END IF;
END $$;

SELECT 'test_vehicles_autovacuum_visibility: pass' AS result;
