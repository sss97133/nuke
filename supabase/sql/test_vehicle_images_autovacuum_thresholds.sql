-- Isolated PostgreSQL 17 contract for 20261016210000_vehicle_images_autovacuum_thresholds.sql. No rows.
--   createdb dm_refinement_vehicle_images_autovacuum
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_images_autovacuum -f supabase/sql/test_vehicle_images_autovacuum_thresholds.sql
-- Fixture: vehicle_images with the storage parameters it had live on 2026-10-15.
-- Covered: vacuum at 10,000 dead tuples, 50,000 inserts and analyze at 50,000 changes, every scale factor 0, the
-- per-table cost delay kept, no other parameter added, and a second apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, updated_at timestamptz);
ALTER TABLE public.vehicle_images SET (autovacuum_vacuum_threshold = 10000, autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_threshold = 10000, autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 10);

\ir ../migrations/20261016210000_vehicle_images_autovacuum_thresholds.sql

CREATE TABLE pg_temp.expected (opt text PRIMARY KEY);
INSERT INTO pg_temp.expected VALUES
  ('autovacuum_vacuum_threshold=10000'), ('autovacuum_vacuum_scale_factor=0'),
  ('autovacuum_vacuum_insert_threshold=50000'), ('autovacuum_vacuum_insert_scale_factor=0'),
  ('autovacuum_analyze_threshold=50000'), ('autovacuum_analyze_scale_factor=0'), ('autovacuum_vacuum_cost_delay=10');
SELECT pg_temp.ok('vehicle_images storage parameters are exactly the expected seven',
  (SELECT array_agg(o ORDER BY o) FROM unnest((SELECT reloptions FROM pg_class WHERE oid = 'public.vehicle_images'::regclass)) o)
  = (SELECT array_agg(opt ORDER BY opt) FROM pg_temp.expected));

\ir ../migrations/20261016210000_vehicle_images_autovacuum_thresholds.sql
SELECT pg_temp.ok('a second apply leaves the same seven parameters',
  (SELECT array_agg(o ORDER BY o) FROM unnest((SELECT reloptions FROM pg_class WHERE oid = 'public.vehicle_images'::regclass)) o)
  = (SELECT array_agg(opt ORDER BY opt) FROM pg_temp.expected));
