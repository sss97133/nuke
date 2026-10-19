-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicles_vin -f this-file.sql
-- Proves, for 20261014054000_vehicles_vin_equality_index.sql, that  vin = 'X'  (what the ingest functions and API routes
-- send) can no longer only be answered by reading the whole table: with the four VIN indexes production has, the planner
-- has no usable index for an unqualified equality (the unique ones are partial on length and status; the expression
-- ones do not match), and after the migration it reads idx_vehicles_vin, for the plain lookup, for  vin = X AND id <> Y,
-- and for an anonymous caller under the vehicles row policies (texteq is leakproof). The rows answered are the same
-- before and after, spelling and case exactly as stored. A second run is a no-op, an interrupted (INVALID) build is
-- replaced, and a valid index of that name with another definition stops the migration.
-- Plans are read with sequential scans disabled, so a table this small shows which index the planner CAN use.
-- The rows below are a disposable test database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET timezone = 'UTC';
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, make text, status text, is_public boolean NOT NULL DEFAULT false,
  user_id uuid, owner_id uuid, uploaded_by uuid, deleted_at timestamptz);
-- The four VIN indexes production has on 2026-10-14 (pg_indexes).
CREATE UNIQUE INDEX vehicles_vin_unique_17char_v2 ON public.vehicles USING btree (vin)
  WHERE ((vin IS NOT NULL) AND (length(vin) = 17) AND (status IS DISTINCT FROM 'merged'::text));
CREATE UNIQUE INDEX vehicles_vin_unique_short_v2 ON public.vehicles USING btree (vin, make)
  WHERE ((vin IS NOT NULL) AND (length(vin) < 17) AND (status IS DISTINCT FROM 'merged'::text));
CREATE INDEX idx_vehicles_vin_upper ON public.vehicles USING btree (upper(vin)) WHERE ((vin IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_vehicles_vin_norm_trim ON public.vehicles USING btree (upper(TRIM(BOTH FROM vin)));
-- The two read policies on vehicles (pg_policy, 2026-10-14).
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT TO public
  USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL) AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)));
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT TO public USING ((is_public = true) OR (auth.role() = 'service_role'));
GRANT SELECT ON public.vehicles TO anon, authenticated;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_plan_text(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := ''; line text;
BEGIN FOR line IN EXECUTE 'EXPLAIN (COSTS OFF) ' || p_sql LOOP r := r || line || E'\n'; END LOOP; RETURN r; END $$;
CREATE FUNCTION public.t_ids(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN EXECUTE format('SELECT coalesce(string_agg(right(id::text, 2), '','' ORDER BY id), '''') FROM (%s) q', p_sql) INTO r; RETURN r; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_plan_text(text), public.t_ids(text) TO anon, authenticated;

-- 60,000 filler rows (40% with a 17-character VIN, 10% with a short one, half of those public) and the probes.
INSERT INTO public.vehicles (id, vin, make, status, is_public)
SELECT gen_random_uuid(),
       CASE WHEN g % 10 < 4 THEN 'F' || lpad(g::text, 16, '0') WHEN g % 10 = 4 THEN 'S' || lpad(g::text, 7, '0') END,
       'Make' || (g % 50), CASE WHEN g % 97 = 0 THEN 'merged' END, g % 2 = 0
  FROM generate_series(1, 60000) g;
INSERT INTO public.vehicles (id, vin, make, status, is_public, user_id) VALUES
 ('a0000000-0000-0000-0000-0000000000a1', 'WDCYC3KH0JX287101', 'Mercedes', NULL,     true,  NULL),
 ('a0000000-0000-0000-0000-0000000000a2', 'SHORTVIN01',        'Ford',     NULL,     true,  NULL),
 ('a0000000-0000-0000-0000-0000000000a3', 'MERGEDVIN00000001', 'Dodge',    'merged', true,  NULL),
 ('a0000000-0000-0000-0000-0000000000a4', 'privatevin0000001', 'Chevrolet', NULL,    false, '30000000-0000-0000-0000-00000000000a'),
 ('a0000000-0000-0000-0000-0000000000a5', 'LONGERTHANSEVENTEENCHARS1', 'BMW', NULL,  true,  NULL),
 ('a0000000-0000-0000-0000-0000000000a6', 'wdcyc3kh0jx287101', 'Mercedes lower', NULL, true, NULL),
 ('a0000000-0000-0000-0000-0000000000a7', 'WDCYC3KH0JX287101 ', 'Mercedes spaced', NULL, true, NULL);
ANALYZE public.vehicles;

\set P1 '''WDCYC3KH0JX287101'''
CREATE FUNCTION public.t_q_eq(p_vin text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT format('SELECT id FROM public.vehicles WHERE vin = %L LIMIT 5', p_vin) $$;
CREATE FUNCTION public.t_q_eq_ne(p_vin text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT format('SELECT id FROM public.vehicles WHERE vin = %L AND id <> %L LIMIT 5', p_vin, 'a0000000-0000-0000-0000-0000000000ff') $$;
GRANT EXECUTE ON FUNCTION public.t_q_eq(text), public.t_q_eq_ne(text) TO anon, authenticated;

-- 1. Before: with sequential scans disabled the planner still has nothing but the table to read for an unqualified equality.
SET enable_seqscan = off;
SELECT public.t_plan_text(public.t_q_eq('WDCYC3KH0JX287101')) AS plan_before_eq,
       public.t_plan_text(public.t_q_eq('SHORTVIN01')) AS plan_before_short \gset
SELECT public.t_assert(:'plan_before_eq' LIKE '%Seq Scan on vehicles%' AND :'plan_before_eq' NOT LIKE '%Index%'
  AND :'plan_before_short' LIKE '%Seq Scan on vehicles%', format('before: no index serves vin = X; plan %s', :'plan_before_eq'));
RESET enable_seqscan;
SELECT public.t_ids(public.t_q_eq('WDCYC3KH0JX287101')) AS r_eq_before, public.t_ids(public.t_q_eq('SHORTVIN01')) AS r_short_before,
       public.t_ids(public.t_q_eq('MERGEDVIN00000001')) AS r_merged_before, public.t_ids(public.t_q_eq('privatevin0000001')) AS r_private_before,
       public.t_ids(public.t_q_eq('wdcyc3kh0jx287101')) AS r_lower_before, public.t_ids(public.t_q_eq('NOSUCHVIN000000001')) AS r_none_before,
       public.t_ids(public.t_q_eq_ne('WDCYC3KH0JX287101')) AS r_ne_before \gset

-- 2. The migration.
\ir ../migrations/20261014054000_vehicles_vin_equality_index.sql
SET statement_timeout = '60s'; SET lock_timeout = '5s';
ANALYZE public.vehicles;
SELECT public.t_assert((SELECT indisvalid AND indisready AND NOT indisunique FROM pg_index WHERE indexrelid = 'public.idx_vehicles_vin'::regclass), 'the index is valid, ready and not unique');

-- 3. After: the index serves the lookup, as the table owner and as anon under the row policies.
SET enable_seqscan = off;
SELECT public.t_assert(public.t_plan_text(public.t_q_eq('WDCYC3KH0JX287101')) LIKE '%idx_vehicles_vin%' AND public.t_plan_text(public.t_q_eq('SHORTVIN01')) LIKE '%idx_vehicles_vin%',
  'after: vin = X reads idx_vehicles_vin, long and short VINs alike');
SELECT public.t_assert(public.t_plan_text(public.t_q_eq_ne('WDCYC3KH0JX287101')) LIKE '%idx_vehicles_vin%', 'after: vin = X AND id <> Y reads idx_vehicles_vin');
SET ROLE anon; SET test.auth_role = 'anon'; SET test.auth_uid = '';
SELECT public.t_assert(public.t_plan_text(public.t_q_eq('WDCYC3KH0JX287101')) LIKE '%idx_vehicles_vin%', 'after: an anonymous caller under the row policies reads idx_vehicles_vin too');
RESET ROLE;
RESET enable_seqscan;
-- Left to itself on a table this size the planner takes the index for a lookup of one row.
SELECT public.t_assert(public.t_plan_text(public.t_q_eq('WDCYC3KH0JX287101')) LIKE '%idx_vehicles_vin%', 'after: the default plan is the index scan');

-- 4. Same rows, spelling and case exactly as stored.
SELECT public.t_assert(public.t_ids(public.t_q_eq('WDCYC3KH0JX287101')) = :'r_eq_before' AND :'r_eq_before' = 'a1'
  AND public.t_ids(public.t_q_eq('SHORTVIN01')) = :'r_short_before' AND :'r_short_before' = 'a2'
  AND public.t_ids(public.t_q_eq('MERGEDVIN00000001')) = :'r_merged_before' AND :'r_merged_before' = 'a3'
  AND public.t_ids(public.t_q_eq('privatevin0000001')) = :'r_private_before' AND :'r_private_before' = 'a4'
  AND public.t_ids(public.t_q_eq('wdcyc3kh0jx287101')) = :'r_lower_before' AND :'r_lower_before' = 'a6'
  AND public.t_ids(public.t_q_eq('NOSUCHVIN000000001')) = :'r_none_before' AND :'r_none_before' = ''
  AND public.t_ids(public.t_q_eq_ne('WDCYC3KH0JX287101')) = :'r_ne_before' AND :'r_ne_before' = 'a1',
  'the same rows come back before and after, case and trailing space exactly as stored');
SET ROLE anon; SET test.auth_role = 'anon'; SET test.auth_uid = '';
SELECT public.t_assert(public.t_ids(public.t_q_eq('privatevin0000001')) = '' AND public.t_ids(public.t_q_eq('WDCYC3KH0JX287101')) = 'a1',
  'anon still reads the public vehicle and never the private one');
RESET ROLE;

-- 5. A second run keeps the index (same oid).
SELECT 'public.idx_vehicles_vin'::regclass::oid AS vin_oid \gset
\ir ../migrations/20261014054000_vehicles_vin_equality_index.sql
SET statement_timeout = '60s';
SELECT public.t_assert('public.idx_vehicles_vin'::regclass::oid = :vin_oid, 'a second run keeps the index');

-- 6. An interrupted build leaves an INVALID index; the next run replaces it.
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_vehicles_vin'::regclass;
\ir ../migrations/20261014054000_vehicles_vin_equality_index.sql
SET statement_timeout = '60s';
SELECT public.t_assert((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = 'public.idx_vehicles_vin'::regclass)
  AND 'public.idx_vehicles_vin'::regclass::oid <> :vin_oid, 'the rerun replaced the invalid index');

-- 7. A valid index of that name with another definition stops the migration and is left as found.
DROP INDEX public.idx_vehicles_vin;
CREATE INDEX idx_vehicles_vin ON public.vehicles (upper(vin));
\set ON_ERROR_STOP off
\echo 'Expected: the definition assertion ERROR below.'
\ir ../migrations/20261014054000_vehicles_vin_equality_index.sql
\set ON_ERROR_STOP on
SET statement_timeout = '60s';
SELECT public.t_assert(pg_get_indexdef('public.idx_vehicles_vin'::regclass) LIKE '%upper(vin)%', 'a differently defined index is left as found');

SELECT 'vehicles vin equality index contract: PASS' AS result;
