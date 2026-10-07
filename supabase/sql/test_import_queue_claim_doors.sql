-- Isolated PostgreSQL 17 contract for 20261008060000_close_import_queue_claim_doors.sql. Synthetic rows only.
--   createdb dm_refinement_import_queue_claim_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_import_queue_claim_ci -f supabase/sql/test_import_queue_claim_doors.sql
-- Fixtures: a minimal import_queue with RLS on and the service_role policy, the API roles, the two claim functions with their
-- live bodies and signatures and the live ACL (EXECUTE for PUBLIC, anon, authenticated, service_role), and fixture copies of
-- the two describe sentences that record the open door.
-- Covered: before, anon claims and reads a pending row through the definer function; after, anon and authenticated hold no
-- EXECUTE and anon is refused with insufficient_privilege, service_role still claims, the function comments record the
-- change, the two describe sentences are rewritten, re-apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.import_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.import_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, listing_url text NOT NULL UNIQUE, listing_year integer,
  status text DEFAULT 'pending', priority integer DEFAULT 0, attempts integer DEFAULT 0, max_attempts integer DEFAULT 3,
  locked_at timestamptz, locked_by text, next_attempt_at timestamptz, last_attempt_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
ALTER TABLE public.import_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_queue TO anon, authenticated, service_role;
CREATE POLICY import_queue_service_role ON public.import_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMENT ON TABLE public.import_queue IS
'Work queue and ledger of listing URLs (fixture copy of the 20261008053000 describe). Access: RLS is on with one policy, import_queue_service_role (ALL, service_role). Paths around RLS: claim_import_queue_batch and claim_import_queue_batch_by_domain are SECURITY DEFINER with EXECUTE for anon and authenticated, so an anonymous call claims up to 200 pending rows (status processing, attempts plus 1, a lock under any worker id) and returns them in full; claim_import_queue_batch_by_source_id runs with the rights of the caller and claims nothing for anon. Clocks: created_at is when the URL was queued (database clock).';
COMMENT ON COLUMN public.import_queue.locked_by IS
'Worker id of the claim (fixture copy): the p_worker_id the caller passes to a claim function. An anonymous caller of claim_import_queue_batch can set any value. Cleared with locked_at.';

-- The live bodies (prod, 2026-10-07), unchanged.
CREATE FUNCTION public.claim_import_queue_batch(p_batch_size integer DEFAULT 20, p_max_attempts integer DEFAULT 3, p_priority_only boolean DEFAULT false, p_source_id uuid DEFAULT NULL::uuid, p_worker_id text DEFAULT NULL::text, p_lock_ttl_seconds integer DEFAULT 900)
RETURNS SETOF public.import_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_ttl INTERVAL := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lock_ttl_seconds, 900), 3600)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT iq.id FROM public.import_queue iq
    WHERE iq.status = 'pending' AND COALESCE(iq.attempts, 0) < COALESCE(p_max_attempts, 3)
      AND (iq.next_attempt_at IS NULL OR iq.next_attempt_at <= v_now)
      AND (iq.locked_at IS NULL OR iq.locked_at < (v_now - v_lock_ttl))
      AND (NOT COALESCE(p_priority_only, FALSE) OR COALESCE(iq.priority, 0) > 0)
      AND (p_source_id IS NULL OR iq.source_id = p_source_id)
    ORDER BY COALESCE(iq.priority, 0) DESC, iq.listing_year DESC NULLS LAST, iq.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 20), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.import_queue iq
    SET status = 'processing', attempts = COALESCE(iq.attempts, 0) + 1, locked_at = v_now, locked_by = COALESCE(p_worker_id, 'unknown'), last_attempt_at = v_now
    WHERE iq.id IN (SELECT id FROM candidates)
    RETURNING iq.*
  )
  SELECT * FROM claimed;
END;
$function$;
CREATE FUNCTION public.claim_import_queue_batch_by_domain(p_domain_pattern text, p_batch_size integer DEFAULT 20, p_max_attempts integer DEFAULT 3, p_worker_id text DEFAULT NULL::text, p_lock_ttl_seconds integer DEFAULT 900)
RETURNS SETOF public.import_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_ttl INTERVAL := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lock_ttl_seconds, 900), 3600)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT iq.id FROM public.import_queue iq
    WHERE iq.status = 'pending' AND COALESCE(iq.attempts, 0) < COALESCE(p_max_attempts, 3)
      AND (iq.next_attempt_at IS NULL OR iq.next_attempt_at <= v_now)
      AND (iq.locked_at IS NULL OR iq.locked_at < (v_now - v_lock_ttl))
      AND iq.listing_url LIKE p_domain_pattern
    ORDER BY COALESCE(iq.priority, 0) DESC, iq.listing_year DESC NULLS LAST, iq.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 20), 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.import_queue iq
    SET status = 'processing', attempts = COALESCE(iq.attempts, 0) + 1, locked_at = v_now, locked_by = COALESCE(p_worker_id, 'unknown'), last_attempt_at = v_now
    WHERE iq.id IN (SELECT id FROM candidates)
    RETURNING iq.*
  )
  SELECT * FROM claimed;
END;
$function$;
-- The live ACL on 2026-10-07.
GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) TO PUBLIC, anon, authenticated, service_role;

INSERT INTO public.import_queue (listing_url, listing_year, priority) VALUES
  ('https://example.test/listing/1', 1972, 3), ('https://example.test/listing/2', 1985, 0), ('https://other.test/listing/3', 1969, 0);

SET ROLE anon;
SELECT pg_temp.ok('fixture reproduces the exposure: anon claims and reads a pending row through the definer function',
  (SELECT count(*) FROM public.claim_import_queue_batch(1, 3, false, NULL, 'anyone', 900)) = 1);
SELECT pg_temp.ok('fixture reproduces the exposure: anon claims through the domain variant too',
  (SELECT count(*) FROM public.claim_import_queue_batch_by_domain('https://other.test/%', 1, 3, 'anyone', 900)) = 1);
SELECT pg_temp.ok('anon reads nothing from the table itself (RLS)', (SELECT count(*) FROM public.import_queue) = 0);
RESET ROLE;
SELECT pg_temp.ok('the two anonymous claims landed (status processing, locked_by anyone)',
  (SELECT count(*) FROM public.import_queue WHERE status = 'processing' AND locked_by = 'anyone' AND attempts = 1) = 2);

\ir ../migrations/20261008060000_close_import_queue_claim_doors.sql

SELECT pg_temp.ok('anon and authenticated hold no EXECUTE on either claim function',
  NOT has_function_privilege('anon', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE'));
SELECT pg_temp.ok('service_role keeps EXECUTE on both',
  has_function_privilege('service_role', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE'));
SET ROLE anon;
DO $$ BEGIN
  PERFORM * FROM public.claim_import_queue_batch(1, 3, false, NULL, 'anon-again', 900);
  RAISE EXCEPTION 'Contract failed: anon still claims rows after the migration';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS anon is refused with insufficient_privilege';
END $$;
DO $$ BEGIN
  PERFORM * FROM public.claim_import_queue_batch_by_domain('https://%', 1, 3, 'anon-again', 900);
  RAISE EXCEPTION 'Contract failed: anon still claims rows through the domain variant after the migration';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS anon is refused by the domain variant too';
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM * FROM public.claim_import_queue_batch(1, 3, false, NULL, 'user-jwt', 900);
  RAISE EXCEPTION 'Contract failed: a signed-in account still claims rows after the migration';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS a signed-in account is refused';
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('service_role still claims the remaining pending row',
  (SELECT count(*) FROM public.claim_import_queue_batch(5, 3, false, NULL, 'process-import-queue:test', 900)) = 1);
RESET ROLE;
SELECT pg_temp.ok('no pending row is left and no row was changed by the refused calls',
  (SELECT count(*) FROM public.import_queue WHERE status = 'pending') = 0
  AND (SELECT count(*) FROM public.import_queue WHERE locked_by IN ('anon-again', 'user-jwt')) = 0);
SELECT pg_temp.ok('the function comments record the closed door',
  obj_description('public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)'::regprocedure, 'pg_proc') LIKE '%EXECUTE for service_role only since 2026-10-07 (20261008060000%'
  AND obj_description('public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)'::regprocedure, 'pg_proc') LIKE '%EXECUTE for service_role only since 2026-10-07 (20261008060000%');
SELECT pg_temp.ok('the describe sentence on the table was rewritten in place and the rest of the comment kept',
  obj_description('public.import_queue'::regclass, 'pg_class') LIKE '%Paths around RLS: none since 2026-10-07 (20261008060000).%'
  AND obj_description('public.import_queue'::regclass, 'pg_class') NOT LIKE '%so an anonymous call claims up to 200%'
  AND obj_description('public.import_queue'::regclass, 'pg_class') LIKE 'Work queue and ledger of listing URLs%'
  AND obj_description('public.import_queue'::regclass, 'pg_class') LIKE '%Clocks: created_at is when the URL was queued (database clock).');
SELECT pg_temp.ok('the locked_by sentence was rewritten in place',
  col_description('public.import_queue'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.import_queue'::regclass AND attname = 'locked_by'))
    LIKE '%Until 2026-10-07 (20261008060000) an anonymous caller of claim_import_queue_batch could set any value;%Cleared with locked_at.');

\ir ../migrations/20261008060000_close_import_queue_claim_doors.sql
SELECT pg_temp.ok('re-apply changes nothing: the rewritten sentence appears once and the grants are the same',
  (length(obj_description('public.import_queue'::regclass, 'pg_class')) - length(replace(obj_description('public.import_queue'::regclass, 'pg_class'), 'Paths around RLS: none since 2026-10-07', '')))
    / length('Paths around RLS: none since 2026-10-07') = 1
  AND NOT has_function_privilege('anon', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE'));
\echo 'import_queue claim doors contract: all checks passed'
