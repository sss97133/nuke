-- Isolated PostgreSQL 17 contract for 20261108130000/130100/130200 (vehicles.source_listing_key). Synthetic rows only.
--   createdb dm_refinement_listing_key_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_listing_key_ci -f supabase/sql/test_vehicles_source_listing_key.sql
-- Fixture: a minimal public.vehicles. Covered: hagerty_listing_key (case kept, host/slug/query/slash ignored, UUID
-- lowercased, junk NULL); the format CHECK; backfill (earliest duplicate keyed, later duplicate logged, lowercased-only
-- row skipped as case_lost, origin_metadata preferred over the lowercased discovery_url, nothing else written);
-- re-run is a no-op; the unique index refuses a second live holder but allows a soft-deleted one; the data revert
-- and the schema down script.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET TimeZone = 'UTC';
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  discovery_source text,
  discovery_url text,
  origin_metadata jsonb,
  make text
);
INSERT INTO public.vehicles (id, created_at, discovery_source, discovery_url, origin_metadata, make) VALUES
  -- A: earliest copy of listing 2qNt..; origin_metadata keeps the case, discovery_url is the canonical lowercase
  ('00000000-0000-0000-0000-00000000000a', '2026-01-01', 'hagerty', 'https://hagerty.com/marketplace/auction/buick/2qntqutlbqck0dwl0epqnb', '{"discovery_url":"https://www.hagerty.com/marketplace/auction/1912-Buick/2qNtqutlbqCk0DwL0ePQNb"}', 'Buick'),
  -- B: later copy of the same listing, different slug
  ('00000000-0000-0000-0000-00000000000b', '2026-02-01', 'hagerty', 'https://www.hagerty.com/marketplace/auction/buick-model-43/2qNtqutlbqCk0DwL0ePQNb', NULL, 'Buick'),
  -- C: only a lowercased URL: the id's case is gone
  ('00000000-0000-0000-0000-00000000000c', '2026-01-02', 'hagerty', 'https://hagerty.com/marketplace/auction/ford/6dwyp9pb7g3mooxoi3fdii', '{"discovery_url":"https://www.hagerty.com/marketplace/auction/ford/6dwyp9pb7g3mooxoi3fdii"}', 'Ford'),
  -- D: uuid id
  ('00000000-0000-0000-0000-00000000000d', '2026-01-03', 'hagerty', 'https://hagerty.com/marketplace/auction/packard/e7ddd260-b431-47c3-a4a5-a5eeeaa7953b', NULL, 'Packard'),
  -- E: not Hagerty; F: Hagerty with no id in the URL
  ('00000000-0000-0000-0000-00000000000e', '2026-01-04', 'bat', 'https://bringatrailer.com/listing/x', NULL, 'Ford'),
  ('00000000-0000-0000-0000-00000000000f', '2026-01-05', 'hagerty', 'https://hagerty.com/marketplace/auction/slug-only', NULL, 'Ford');
CREATE TEMP TABLE _before AS SELECT id, to_jsonb(v) AS j FROM public.vehicles v;

\i supabase/migrations/20261108130000_vehicles_source_listing_key.sql

SELECT pg_temp.ok('column exists, nullable text', EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'source_listing_key' AND data_type = 'text' AND is_nullable = 'YES'));
SELECT pg_temp.ok('format check is NOT VALID', (SELECT NOT convalidated FROM pg_constraint WHERE conname = 'vehicles_source_listing_key_format'));
SELECT pg_temp.ok('key keeps case, ignores host/slug/query/slash',
  public.hagerty_listing_key('https://www.hagerty.com/marketplace/auction/x/2qNtqutlbqCk0DwL0ePQNb') = 'hagerty:2qNtqutlbqCk0DwL0ePQNb'
  AND public.hagerty_listing_key('http://HAGERTY.com/marketplace/auction/y/2qNtqutlbqCk0DwL0ePQNb/?a=1#z') = 'hagerty:2qNtqutlbqCk0DwL0ePQNb'
  AND public.hagerty_listing_key('https://hagerty.com/marketplace/auction/1920-Packard-Twin-Six%20Touring/Wd8YkMRPFQJ8rgdvav03T') = 'hagerty:Wd8YkMRPFQJ8rgdvav03T');
SELECT pg_temp.ok('uuid id lowercased', public.hagerty_listing_key('https://hagerty.com/marketplace/auction/a/E7DDD260-B431-47C3-A4A5-A5EEEAA7953B') = 'hagerty:e7ddd260-b431-47c3-a4a5-a5eeeaa7953b');
SELECT pg_temp.ok('junk is NULL', public.hagerty_listing_key('https://hagerty.com/marketplace/auction/slug-only') IS NULL
  AND public.hagerty_listing_key('https://bringatrailer.com/listing/x/2qNtqutlbqCk0DwL0ePQNb') IS NULL AND public.hagerty_listing_key(NULL) IS NULL);
DO $$ BEGIN
  BEGIN
    UPDATE public.vehicles SET source_listing_key = 'has space' WHERE id = '00000000-0000-0000-0000-00000000000e';
    RAISE EXCEPTION 'Contract failed: malformed key accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS malformed key refused'; END;
END $$;

\i supabase/migrations/20261108130100_vehicles_source_listing_key_backfill_hagerty.sql

SELECT pg_temp.ok('earliest duplicate keyed, case from origin_metadata',
  (SELECT source_listing_key FROM public.vehicles WHERE id = '00000000-0000-0000-0000-00000000000a') = 'hagerty:2qNtqutlbqCk0DwL0ePQNb');
SELECT pg_temp.ok('later duplicate left NULL and logged with duplicate_of',
  (SELECT source_listing_key FROM public.vehicles WHERE id = '00000000-0000-0000-0000-00000000000b') IS NULL
  AND EXISTS (SELECT FROM public.source_listing_key_backfill_log WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b' AND action = 'skipped_duplicate' AND duplicate_of = '00000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('lowercased-only row skipped as case_lost',
  (SELECT source_listing_key FROM public.vehicles WHERE id = '00000000-0000-0000-0000-00000000000c') IS NULL
  AND EXISTS (SELECT FROM public.source_listing_key_backfill_log WHERE vehicle_id = '00000000-0000-0000-0000-00000000000c' AND action = 'skipped_case_lost'));
SELECT pg_temp.ok('uuid row keyed, no-id row logged skipped_no_id, non-hagerty row untouched',
  (SELECT source_listing_key FROM public.vehicles WHERE id = '00000000-0000-0000-0000-00000000000d') = 'hagerty:e7ddd260-b431-47c3-a4a5-a5eeeaa7953b'
  AND EXISTS (SELECT FROM public.source_listing_key_backfill_log WHERE vehicle_id = '00000000-0000-0000-0000-00000000000f' AND action = 'skipped_no_id')
  AND NOT EXISTS (SELECT FROM public.source_listing_key_backfill_log WHERE vehicle_id = '00000000-0000-0000-0000-00000000000e'));
SELECT pg_temp.ok('nothing but source_listing_key changed',
  NOT EXISTS (SELECT FROM _before b JOIN public.vehicles v USING (id) WHERE (to_jsonb(v) - 'source_listing_key') IS DISTINCT FROM b.j));
SELECT pg_temp.ok('log has one row per hagerty vehicle', (SELECT count(*) FROM public.source_listing_key_backfill_log WHERE run_id = 'hagerty_listing_key_v1_20261102') = 5);
\i supabase/migrations/20261108130100_vehicles_source_listing_key_backfill_hagerty.sql
SELECT pg_temp.ok('re-run is a no-op', (SELECT count(*) FROM public.source_listing_key_backfill_log WHERE run_id = 'hagerty_listing_key_v1_20261102') = 5
  AND (SELECT count(*) FROM public.vehicles WHERE source_listing_key IS NOT NULL) = 2);

\i supabase/migrations/20261108130200_vehicles_source_listing_key_unique_index.sql

SELECT pg_temp.ok('unique index valid', EXISTS (SELECT FROM pg_index WHERE indexrelid = 'public.idx_vehicles_source_listing_key_unique'::regclass AND indisvalid));
DO $$ BEGIN
  BEGIN
    UPDATE public.vehicles SET source_listing_key = 'hagerty:2qNtqutlbqCk0DwL0ePQNb' WHERE id = '00000000-0000-0000-0000-00000000000b';
    RAISE EXCEPTION 'Contract failed: second live holder accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS second live holder refused'; END;
END $$;
UPDATE public.vehicles SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE public.vehicles SET source_listing_key = 'hagerty:2qNtqutlbqCk0DwL0ePQNb' WHERE id = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.ok('soft-deleted holder frees the key', (SELECT count(*) FROM public.vehicles WHERE source_listing_key = 'hagerty:2qNtqutlbqCk0DwL0ePQNb' AND deleted_at IS NULL) = 1);
\i supabase/migrations/20261108130200_vehicles_source_listing_key_unique_index.sql
SELECT pg_temp.ok('index migration re-applies', true);

UPDATE public.vehicles SET deleted_at = NULL, source_listing_key = NULL WHERE id = '00000000-0000-0000-0000-00000000000b';
UPDATE public.vehicles SET source_listing_key = 'hagerty:2qNtqutlbqCk0DwL0ePQNb' WHERE id = '00000000-0000-0000-0000-00000000000a';
\i scripts/vehicles/revert_hagerty_listing_key_v1_20261102.sql
SELECT pg_temp.ok('data revert nulls exactly the run''s keys',
  (SELECT count(*) FROM public.vehicles WHERE source_listing_key IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.source_listing_key_backfill_log WHERE action = 'set' AND reverted_at IS NOT NULL) = 2);

\i supabase/rollbacks/20261108130000_vehicles_source_listing_key_down.sql
SELECT pg_temp.ok('down removes column, index, function, log table',
  NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'source_listing_key')
  AND to_regclass('public.idx_vehicles_source_listing_key_unique') IS NULL
  AND NOT EXISTS (SELECT FROM pg_proc WHERE proname = 'hagerty_listing_key')
  AND to_regclass('public.source_listing_key_backfill_log') IS NULL);
