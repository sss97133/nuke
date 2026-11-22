\set ON_ERROR_STOP on
-- Contract for migration 20261114000000_coverage_miss_drain.sql (T6). Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database: scripts/ci/run-db-contracts.sh test_coverage_miss_drain.sql
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'refusing: not a dm_refinement_* database'; END IF;
  IF to_regclass('public.import_queue') IS NOT NULL THEN RAISE EXCEPTION 'refusing: database is not empty'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The production columns the claim reads and writes.
CREATE TABLE public.import_queue (
  id uuid PRIMARY KEY, source_id uuid, listing_url text UNIQUE, raw_data jsonb, status text, priority integer,
  attempts integer, max_attempts integer, created_at timestamptz, next_attempt_at timestamptz,
  locked_at timestamptz, locked_by text, last_attempt_at timestamptz);
INSERT INTO public.import_queue VALUES
  -- the Nov 5 2026 row as it stands in production: pending, attempts 3 (lost claims released with attempts kept)
  ('dcd24793-cb4f-4867-831b-90b7081e02db','db9ff20a-15b6-41f1-ae09-dd31975a77c0',
   'https://bringatrailer.com/?post_type=bat-listing&p=126086136',
   '{"origin":"evaluate_listing","queued_reason":"coverage_miss"}', 'pending', 0, 3, 3,
   '2026-11-05 11:27:51+00', NULL, NULL, NULL, '2026-11-06 00:17:46+00'),
  -- the Nov 9 Cars & Bids miss
  ('fedd9a4d-e3d5-4dfb-b56a-17978b9d1fb1','3422b660-3233-47a4-b44e-97e23bf9e9cb',
   'https://carsandbids.com/auctions/35nB6lll/2026-tesla-model-x-plaid',
   '{"origin":"evaluate_listing","queued_reason":"coverage_miss"}', 'pending', 0, 0, 3,
   '2026-11-09 20:42:01+00', NULL, NULL, NULL, NULL),
  -- not a coverage miss: never claimed by this drain
  ('00000000-0000-0000-0000-000000000001','db9ff20a-15b6-41f1-ae09-dd31975a77c0','https://bringatrailer.com/listing/a/',
   '{}', 'pending', 0, 0, 3, now(), NULL, NULL, NULL, NULL),
  -- coverage misses that must not be claimed: out of attempts / backing off / freshly locked / done
  ('00000000-0000-0000-0000-000000000002',NULL,'https://bringatrailer.com/listing/b/','{"queued_reason":"coverage_miss"}','pending',0,8,3,now(),NULL,NULL,NULL,NULL),
  ('00000000-0000-0000-0000-000000000003',NULL,'https://bringatrailer.com/listing/c/','{"queued_reason":"coverage_miss"}','pending',0,1,3,now(),now()+interval '1 hour',NULL,NULL,NULL),
  ('00000000-0000-0000-0000-000000000004',NULL,'https://bringatrailer.com/listing/d/','{"queued_reason":"coverage_miss"}','pending',0,1,3,now(),NULL,now(),'w',NULL),
  ('00000000-0000-0000-0000-000000000005',NULL,'https://bringatrailer.com/listing/e/','{"queued_reason":"coverage_miss"}','complete',0,1,3,now(),NULL,NULL,NULL,NULL);
CREATE TEMP TABLE before_rows AS SELECT * FROM public.import_queue;

\ir ../migrations/20261114000000_coverage_miss_drain.sql

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.import_queue q JOIN pg_temp.before_rows b USING (id) WHERE row(q.*)::text <> row(b.*)::text)
  THEN RAISE EXCEPTION 'the migration changed import_queue rows'; END IF;
  RAISE NOTICE 'PASS migration changes no rows';
END $$;

DO $$ DECLARE ids text; nov5 record; again int; BEGIN
  SELECT string_agg(id::text, ',' ORDER BY id) INTO ids FROM public.claim_import_queue_coverage_misses(10, 8, 'test-worker');
  IF ids IS DISTINCT FROM 'dcd24793-cb4f-4867-831b-90b7081e02db,fedd9a4d-e3d5-4dfb-b56a-17978b9d1fb1'
  THEN RAISE EXCEPTION 'claimed %', ids; END IF;
  SELECT * INTO nov5 FROM public.import_queue WHERE id = 'dcd24793-cb4f-4867-831b-90b7081e02db';
  IF nov5.status <> 'processing' OR nov5.attempts <> 4 OR nov5.locked_by <> 'test-worker'
  THEN RAISE EXCEPTION 'Nov 5 row after claim: % % %', nov5.status, nov5.attempts, nov5.locked_by; END IF;
  SELECT count(*) INTO again FROM public.claim_import_queue_coverage_misses(10, 8, 'w2');
  IF again <> 0 THEN RAISE EXCEPTION 'a locked row was claimed twice'; END IF;
  RAISE NOTICE 'PASS claims exactly the stuck Nov 5 row and the C&B miss (Nov 5: attempts 3 -> 4, processing)';
END $$;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.claim_import_queue_coverage_misses(integer,integer,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_import_queue_coverage_misses(integer,integer,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_import_queue_coverage_misses(integer,integer,text,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'grant is not service_role only'; END IF;
  RAISE NOTICE 'PASS execute granted to service_role only';
END $$;
