-- Exact copies (20261113120500): capture_exact_copy_v1 records an unfiled byte-identical copy of a filed photo as that photo's
-- duplicate (signed log row per photo, revertible by run); the ledger shows it as 'duplicate' and counts it; sensitive,
-- private and ambiguous (hash on two vehicles) photos are skipped; dry runs and the cap write nothing; the revert restores
-- the photos and the pinned ledger bodies.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_exact_copy%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_exact_copy* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status, exif_data jsonb, thumbnail_url text, image_url text, file_name text,
  file_hash text, is_duplicate boolean, duplicate_of uuid, is_sensitive boolean);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, set_key text, image_ids uuid[], reason text,
  evidence jsonb DEFAULT '{}', status text DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, state text);
CREATE TABLE public.capture_landing_sets(chunk_id uuid, set_key text, image_ids uuid[], decision text);
CREATE TABLE public.capture_upload_status(image_id uuid PRIMARY KEY, user_id uuid, stage text, error_class text);
CREATE TABLE public.capture_skips(user_id uuid, asset_id text, reason text, taken_at timestamptz, decided_at timestamptz, device text);
CREATE TABLE public.capture_rescan_requests(id uuid, user_id uuid, requested_at timestamptz, finished_at timestamptz);
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

-- the live bodies the migration pins (the revert file carries them)
\i supabase/sql/revert_20261113120500_capture_exact_copy.sql
CREATE FUNCTION pg_temp.fp() RETURNS text LANGUAGE sql AS $$
  SELECT md5(pg_get_functiondef('public.capture_ledger_states(uuid, text, date, date)'::regprocedure)) || md5(pg_get_functiondef('public.capture_ledger_frames(uuid, text, date, date)'::regprocedure))
      || md5(pg_get_functiondef('public.get_capture_ledger(text, date, date, integer)'::regprocedure)) $$;
SELECT pg_temp.fp() AS before_fp \gset

-- owner aa; vehicle b1. 1 filed original (hash H1); 2 = unfiled copy of 1; 3 = sensitive copy of 1; 4 = private copy of 1;
-- 5 = copy of hash H2, which is filed on two vehicles (6 on b1, 7 on b2): ambiguous; 8 = unfiled, unique hash; 9 = another user's copy of H1.
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000b1', 1966, 'Ford', 'Mustang'), ('00000000-0000-4000-8000-0000000000b2', 1973, 'Pontiac', 'Firebird');
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, vision_gate_status, file_hash, is_sensitive) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-06-20 18:00+00', 'approved', 'H1', false),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-20 18:00+00', 'pending', 'H1', false),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-20 18:00+00', 'pending', 'H1', true),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-20 18:00+00', 'rejected_personal', 'H1', false),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-20 18:00+00', 'pending', 'H2', false),
 ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-06-20 18:00+00', 'approved', 'H2', false),
 ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b2', '2026-06-20 18:00+00', 'approved', 'H2', false),
 ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-06-20 18:00+00', 'pending', 'H3', false),
 ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-0000000000cc', NULL, '2026-06-20 18:00+00', 'pending', 'H1', false);
CREATE FUNCTION pg_temp.st(n int) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', NULL, NULL)
  WHERE image_id = ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
SELECT pg_temp.assert_true(pg_temp.st(2) = 'unsorted', 'before: the copy sits unsorted');

\i supabase/migrations/20261113120500_capture_exact_copy.sql
SELECT pg_temp.assert_true(pg_temp.st(2) = 'unsorted', 'after the migration alone nothing moves');
-- dry run writes nothing and sees exactly photo 2 (+1 ambiguous)
SELECT public.capture_exact_copy_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e001') AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'would_mark' = '1' AND (:'r')::jsonb->>'ambiguous_original' = '1'
  AND NOT EXISTS (SELECT 1 FROM capture_exact_copy_log) AND (SELECT is_duplicate FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002') IS NULL,
  'dry run: one copy, one ambiguous, no writes');
-- the cap halts without writing
SELECT public.capture_exact_copy_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e001', NULL, false, 0) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'halted' = 'true' AND NOT EXISTS (SELECT 1 FROM capture_exact_copy_log), 'over the cap: halted, nothing written');
-- the run marks photo 2 only, signed
SELECT public.capture_exact_copy_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e001', NULL, false, 50) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'marked' = '1', 'run: one marked');
SELECT pg_temp.assert_true((SELECT is_duplicate AND duplicate_of = '00000000-0000-4000-8000-000000000001' AND vehicle_id IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002'),
  'the copy points at the filed original and stays unfiled');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(length(signature) = 64) FROM capture_exact_copy_log), 'one signed log row');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM vehicle_images WHERE id IN ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000009') AND is_duplicate),
  'sensitive, private, ambiguous, unique and other-user photos untouched');
SELECT pg_temp.assert_true(pg_temp.st(2) = 'duplicate' AND pg_temp.st(4) = 'private' AND pg_temp.st(8) = 'unsorted', 'ledger: duplicate state; private still wins');
SELECT pg_temp.assert_true((SELECT vehicle_id = '00000000-0000-4000-8000-0000000000b1' AND reason = 'copy_of_filed' FROM public.capture_ledger_states('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', NULL, NULL)
  WHERE image_id = '00000000-0000-4000-8000-000000000002'), 'ledger: the duplicate names the original''s vehicle');
SELECT pg_temp.assert_true((SELECT state FROM public.capture_ledger_frames('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles', NULL, NULL)
  WHERE image_id = '00000000-0000-4000-8000-000000000002') = 'duplicate', 'frames agree with states');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', false);
SELECT pg_temp.assert_true((public.get_capture_ledger('America/Los_Angeles', NULL, NULL, 10)->'totals'->>'duplicate')::int = 1
  AND (public.get_capture_ledger('America/Los_Angeles', NULL, NULL, 10)->'days'->0->>'duplicate')::int = 1, 'get_capture_ledger counts duplicates');
-- a second run finds nothing new; a used run id is refused
SELECT pg_temp.assert_true((public.capture_exact_copy_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e002')->>'would_mark') = '0', 'idempotent');
DO $$ BEGIN
  PERFORM public.capture_exact_copy_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e001', NULL, false, 50);
  RAISE EXCEPTION 'contract failed: a used run id must be refused';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'contract failed%' THEN RAISE; END IF;
END $$;
-- anon cannot run it
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_exact_copy_v1(uuid, uuid, uuid[], boolean, integer)', 'execute'), 'anon cannot run the producer');

-- revert by run, then the file
SELECT pg_temp.assert_true((public.capture_exact_copy_revert_v1('00000000-0000-4000-8000-00000000e001')->>'restored') = '1', 'run revert restores one');
SELECT pg_temp.assert_true((SELECT is_duplicate IS NULL AND duplicate_of IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-000000000002')
  AND pg_temp.st(2) = 'unsorted', 'the copy is back as it was');
\i supabase/sql/revert_20261113120500_capture_exact_copy.sql
SELECT pg_temp.assert_true(pg_temp.fp() = :'before_fp', 'revert restores the pinned ledger bodies');
SELECT pg_temp.assert_true(to_regprocedure('public.capture_exact_copy_v1(uuid, uuid, uuid[], boolean, integer)') IS NULL, 'producer dropped');
SELECT 'capture exact copy contract: ok' AS result;
