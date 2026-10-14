-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vo_keyed_indexes -f this-file.sql
-- Proves, for 20261014043000_vehicle_observations_keyed_partial_indexes.sql, that the reads keyed on a specification's
-- JSON property (the profile sidebar's purchased-parts count, the inventory / table / lifecycle pages, the wiring facts)
-- run the row policy only on the keyed rows once the partial indexes exist, and that nothing a stranger may not read
-- appears: a purchased part with money on it, a wiring fact with a billing record, a private vehicle's rows, and a
-- garage owner correction stay out of anon and of a signed-in stranger, and stay in for the owner.
-- Policies and observation_is_public() are the live text (helpers/vehicle_observations_rls_fixture.sql).
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
\ir helpers/vehicle_observations_rls_fixture.sql

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- How many times the row policy probed vehicles while the statement ran (the policy's EXISTS is the only reader of vehicles),
-- and whether the plan reads a given index. Run as the caller, so row security applies to the explained statement.
CREATE FUNCTION public.t_plan(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j text;
BEGIN EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO j; RETURN j::jsonb; END $$;
CREATE FUNCTION public.t_policy_probes(p_sql text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(max((x #>> '{}')::bigint), 0)
    FROM jsonb_path_query(public.t_plan(p_sql), '$.** ? (@."Relation Name" == "vehicles")."Actual Loops"') x $$;
CREATE FUNCTION public.t_uses_index(p_sql text, p_index text) RETURNS boolean LANGUAGE sql AS $$
  SELECT strpos(public.t_plan(p_sql)::text, '"Index Name": "' || p_index || '"') > 0 $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_plan(text), public.t_policy_probes(text),
  public.t_uses_index(text, text) TO anon, authenticated;

SELECT md5(pg_get_functiondef('public.observation_is_public(observation_kind, jsonb)'::regprocedure)) = 'a19d4d1abf5af344878d05bf98be0f49' AS fixture_is_live \gset
SELECT public.t_assert(:'fixture_is_live'::boolean, 'observation_is_public is the live definition');

-- O owns the public vehicle P and the private vehicle Q. S is a signed-in stranger.
INSERT INTO public.vehicles (id, user_id, is_public) VALUES
 ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', true),
 ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', false);
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, kind, structured_data, is_superseded, extraction_method, submitted_by_user_id, subject_type, subject_id) VALUES
 -- lifecycle rows on P
 ('a0000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000001', now() - interval '1 day',  'specification', '{"lifecycle_status":"purchased","part":"Alternator"}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-000000000001', now() - interval '2 days', 'specification', '{"lifecycle_status":"purchased","part":"Pump","paid_usd":210.5,"order_number":"A-1"}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-000000000001', now() - interval '3 days', 'specification', '{"lifecycle_status":"needed","part":"Harness"}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000001', now() - interval '4 days', 'specification', '{"lifecycle_status":"purchased","part":"Old part"}', true, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000a5', '40000000-0000-0000-0000-000000000001', now() - interval '5 days', 'specification', '{"lifecycle_status":"purchased","part":"Owner note"}', false, 'garage_owner_correction_v1', '30000000-0000-0000-0000-00000000000a', 'user', '30000000-0000-0000-0000-00000000000a'),
 ('a0000000-0000-0000-0000-0000000000a6', '40000000-0000-0000-0000-000000000001', now() - interval '6 days', 'condition',     '{"lifecycle_status":"purchased","note":"not a specification"}', false, NULL, NULL, 'vehicle', NULL),
 -- wiring facts on P
 ('a0000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000001', now() - interval '1 day',  'specification', '{"domain":"wiring","plug":"P1","value":"red"}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000b2', '40000000-0000-0000-0000-000000000001', now() - interval '2 days', 'specification', '{"domain":"wiring","plug":"P2","billing":{"billed_usd":10}}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000b3', '40000000-0000-0000-0000-000000000001', now() - interval '3 days', 'specification', '{"domain":"wiring","plug":"P3","value":"old"}', true, NULL, NULL, 'vehicle', NULL),
 -- the private vehicle Q
 ('a0000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000002', now() - interval '1 day',  'specification', '{"lifecycle_status":"purchased","part":"Private part"}', false, NULL, NULL, 'vehicle', NULL),
 ('a0000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-000000000002', now() - interval '1 day',  'specification', '{"domain":"wiring","plug":"Q1"}', false, NULL, NULL, 'vehicle', NULL);
-- the rest of the vehicle's record: what a scan of "all live observations" has to wade through
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, kind, structured_data, is_superseded)
SELECT '40000000-0000-0000-0000-000000000001', now() - (g || ' minutes')::interval,
       (ARRAY['condition', 'media', 'specification', 'work_record'])[1 + g % 4]::observation_kind,
       jsonb_build_object('n', g, 'note', repeat('x', 200)), false
  FROM generate_series(1, 600) g;
ANALYZE public.vehicle_observations;

-- The three statements the callers send (PostgREST shapes, literals in place of $n).
CREATE FUNCTION public.t_sql_lifecycle_count(p_vehicle uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($f$ SELECT id FROM public.vehicle_observations WHERE vehicle_id = %L AND kind = 'specification' AND is_superseded = false
                    AND structured_data->>'lifecycle_status' = 'purchased' $f$, p_vehicle) $$;
CREATE FUNCTION public.t_sql_lifecycle_page(p_vehicle uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($f$ SELECT id, kind, observed_at, structured_data FROM public.vehicle_observations WHERE vehicle_id = %L AND is_superseded = false
                    AND kind = 'specification' AND NOT structured_data->>'lifecycle_status' IS NULL ORDER BY observed_at DESC LIMIT 1000 $f$, p_vehicle) $$;
CREATE FUNCTION public.t_sql_wiring(p_vehicle uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($f$ SELECT vo.id, vo.structured_data, vo.source_url, vo.citation_excerpt, vo.citation_page_number, vo.confidence,
                           row_to_json(s.*)::jsonb AS source
                      FROM public.vehicle_observations vo
                      LEFT JOIN LATERAL (SELECT os.slug, os.display_name FROM public.observation_sources os WHERE os.id = vo.source_id LIMIT 1) s ON true
                     WHERE vo.vehicle_id = %L AND vo.kind = 'specification' AND vo.is_superseded = false
                       AND vo.structured_data->>'domain' = 'wiring' LIMIT 3000 $f$, p_vehicle) $$;
GRANT EXECUTE ON FUNCTION public.t_sql_lifecycle_count(uuid), public.t_sql_lifecycle_page(uuid), public.t_sql_wiring(uuid) TO anon, authenticated;
-- ids a statement returns, as a sorted list of the last hex digits; empty string for none.
CREATE FUNCTION public.t_ids(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(right(id::text, 2), '','' ORDER BY right(id::text, 2)), '''') FROM (%s) q', p_sql) INTO r;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.t_ids(text) TO anon, authenticated;

\set P '''40000000-0000-0000-0000-000000000001'''
\set Q '''40000000-0000-0000-0000-000000000002'''

-- 1. Before the indexes: the row policy probes vehicles once per live observation of the vehicle (every kind, every key).
SET ROLE anon;
SET request.jwt.claims = '{"role": "anon"}';
SELECT public.t_policy_probes(public.t_sql_lifecycle_count(:P)) AS probes_before_lifecycle \gset
SELECT public.t_policy_probes(public.t_sql_wiring(:P)) AS probes_before_wiring \gset
RESET ROLE;
SELECT public.t_assert(:probes_before_lifecycle >= 500 AND :probes_before_wiring >= 500,
  format('before: the policy runs on the whole vehicle (lifecycle %s, wiring %s probes)', :probes_before_lifecycle, :probes_before_wiring));

-- 2. The migration.
\ir ../migrations/20261014043000_vehicle_observations_keyed_partial_indexes.sql
SET statement_timeout = '60s';
SET lock_timeout = '5s';
ANALYZE public.vehicle_observations;
SELECT public.t_assert((SELECT count(*) FROM pg_index WHERE indexrelid IN ('public.idx_vobs_spec_lifecycle'::regclass, 'public.idx_vobs_spec_wiring'::regclass)
                         AND indisvalid AND indisready AND NOT indisunique) = 2, 'both indexes are valid, ready and not unique');
-- Whatever the planner would do with another choice of settings, it must be able to use them under row security.
SET enable_seqscan = off;

-- 3. After: the same statements, and what each caller sees.
SET ROLE anon;
SET request.jwt.claims = '{"role": "anon"}';
SELECT public.t_assert(public.t_uses_index(public.t_sql_lifecycle_count(:P), 'idx_vobs_spec_lifecycle'), 'anon count uses the lifecycle index');
SELECT public.t_assert(public.t_uses_index(public.t_sql_lifecycle_page(:P), 'idx_vobs_spec_lifecycle'), 'anon ordered page uses the lifecycle index');
SELECT public.t_assert(public.t_uses_index(public.t_sql_wiring(:P), 'idx_vobs_spec_wiring'), 'anon wiring facts use the wiring index');
SELECT public.t_policy_probes(public.t_sql_lifecycle_count(:P)) AS probes_after_lifecycle \gset
SELECT public.t_policy_probes(public.t_sql_lifecycle_page(:P)) AS probes_after_page \gset
SELECT public.t_policy_probes(public.t_sql_wiring(:P)) AS probes_after_wiring \gset
SELECT public.t_assert(:probes_after_lifecycle <= 6 AND :probes_after_page <= 6 AND :probes_after_wiring <= 6,
  format('after: the policy runs on the keyed rows only (lifecycle %s, page %s, wiring %s probes)', :probes_after_lifecycle, :probes_after_page, :probes_after_wiring));
-- anon: public rows only. a1 purchased; a3 needed; w1 wiring. Money (a2, b2), the correction (a5), the other kind (a6), the
-- superseded (a4, b3) and the private vehicle (c1, c2) stay out.
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:P)) = 'a1', 'anon: one purchased part on the public vehicle');
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_page(:P)) = 'a1,a3', 'anon: lifecycle page is a1 and a3 only');
SELECT public.t_assert(public.t_ids(public.t_sql_wiring(:P)) = 'b1', 'anon: one public wiring fact, none with a billing record');
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:Q)) = '' AND public.t_ids(public.t_sql_wiring(:Q)) = '', 'anon: nothing of the private vehicle');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:P)) = 'a1' AND public.t_ids(public.t_sql_lifecycle_page(:P)) = 'a1,a3'
  AND public.t_ids(public.t_sql_wiring(:P)) = 'b1', 'a signed-in stranger reads what anon reads');
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:Q)) = '' AND public.t_ids(public.t_sql_wiring(:Q)) = '', 'a signed-in stranger reads nothing of the private vehicle');
-- the owner: everything of P and Q that is live, including money and the garage correction; not the superseded rows
SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:P)) = 'a1,a2,a5', format('owner: purchased parts a1, a2, a5; got %s', public.t_ids(public.t_sql_lifecycle_count(:P))));
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_page(:P)) = 'a1,a2,a3,a5', 'owner: lifecycle page a1, a2, a3, a5');
SELECT public.t_assert(public.t_ids(public.t_sql_wiring(:P)) = 'b1,b2', 'owner: both wiring facts, the billing record included');
SELECT public.t_assert(public.t_ids(public.t_sql_lifecycle_count(:Q)) = 'c1' AND public.t_ids(public.t_sql_wiring(:Q)) = 'c2', 'owner: the private vehicle''s rows');
SELECT public.t_assert(public.t_uses_index(public.t_sql_lifecycle_count(:P), 'idx_vobs_spec_lifecycle'), 'the owner''s count uses the index as well');
RESET ROLE;
RESET request.jwt.claims;
RESET enable_seqscan;

-- 4. A second run is a no-op and leaves both indexes as they were.
SELECT c.oid AS lc_oid FROM pg_class c WHERE c.relname = 'idx_vobs_spec_lifecycle' \gset
SELECT c.oid AS wr_oid FROM pg_class c WHERE c.relname = 'idx_vobs_spec_wiring' \gset
\ir ../migrations/20261014043000_vehicle_observations_keyed_partial_indexes.sql
SET statement_timeout = '60s';
SELECT public.t_assert('public.idx_vobs_spec_lifecycle'::regclass::oid = :lc_oid AND 'public.idx_vobs_spec_wiring'::regclass::oid = :wr_oid,
  'a second run keeps the indexes');

-- 5. An interrupted build leaves an INVALID index: the next run drops it and builds a valid one.
DROP INDEX public.idx_vobs_spec_wiring;
\set ON_ERROR_STOP off
\echo 'Expected: one duplicate-key ERROR from the unique build below, which leaves an invalid index.'
CREATE UNIQUE INDEX CONCURRENTLY idx_vobs_spec_wiring ON public.vehicle_observations (vehicle_id) WHERE kind = 'specification';
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT NOT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vobs_spec_wiring'::regclass), 'the failed build left an invalid index');
\ir ../migrations/20261014043000_vehicle_observations_keyed_partial_indexes.sql
SET statement_timeout = '60s';
SELECT public.t_assert((SELECT indisvalid AND indisready AND NOT indisunique FROM pg_index WHERE indexrelid = 'public.idx_vobs_spec_wiring'::regclass)
  AND pg_get_indexdef('public.idx_vobs_spec_wiring'::regclass) LIKE '%''wiring''%', 'the rerun replaced the invalid index with the real one');

-- 6. A valid index of the same name with another definition stops the migration instead of being trusted.
DROP INDEX public.idx_vobs_spec_wiring;
CREATE INDEX idx_vobs_spec_wiring ON public.vehicle_observations (vehicle_id);
\set ON_ERROR_STOP off
\echo 'Expected: the definition assertion ERROR below.'
\ir ../migrations/20261014043000_vehicle_observations_keyed_partial_indexes.sql
\set ON_ERROR_STOP on
SET statement_timeout = '60s';
SELECT public.t_assert(pg_get_indexdef('public.idx_vobs_spec_wiring'::regclass) NOT LIKE '%WHERE%', 'a differently defined index is left as found');
DROP INDEX public.idx_vobs_spec_wiring;
\ir ../migrations/20261014043000_vehicle_observations_keyed_partial_indexes.sql
SET statement_timeout = '60s';
SELECT public.t_assert((SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vobs_spec_wiring'::regclass), 'restored');

SELECT 'vehicle_observations keyed indexes contract: PASS' AS result;
