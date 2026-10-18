-- search_vehicles_fuzzy runs as its owner, so a logged-out caller gets the indexed path.
--
-- Measured 2026-10-15 00:05Z after 20261015010000: as service_role, search_vehicles_fuzzy('mustnag', 10) took 1.6 s; as
-- anon it ran past 10 s, and the REST RPC returned 500 at anon's 15 s statement timeout. Under row security the
-- planner cannot use idx_vehicles_lower_make_model for anon: lower() is not leakproof, so its index condition cannot
-- run before the policy filter, and every vehicle is read. The old body behaved the same way.
-- The function returns only public rows (v.is_public = true in both branches) and only columns anon already reads
-- (id, year, make, model, vin, primary_image_url, sale_price: has_column_privilege true for anon, 2026-10-15), and the
-- name dictionary is granted to anon. Running it as its owner returns the same rows to every caller; the search_path
-- is pinned so the definer resolves only public objects.
-- Contract: supabase/sql/test_search_fuzzy_runs_as_owner.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure;
  IF v IS DISTINCT FROM 'rM5kSY/R03VaS+Ec2h8M2S3cD77NSg0hjJnUff7Prio=' THEN
    RAISE EXCEPTION 'search_vehicles_fuzzy is not the 20261015010000 body (sha256 %); not changing its security', v;
  END IF;
END $guard$;

ALTER FUNCTION public.search_vehicles_fuzzy(text, integer) SECURITY DEFINER SET search_path = public, pg_temp;

DO $check$
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'search_vehicles_fuzzy did not become security definer';
  END IF;
END $check$;

COMMIT;
