-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_trends -f this-file.sql (from supabase/sql)
-- Contract for 20261015233000_market_trends_make_resolution.sql. Synthetic IDs only; never run in production.
-- Runs the whole market-trends chain (68 count/privacy contracts and the protected-registry repair), records the
-- reader's output for every scope the chain builds, applies the change twice, and requires the same output (clock
-- fields aside), the same settings, owner and grants, and that each make spelling resolves once. The chain's rows
-- cover recorded, conflicting, ambiguous and unknown makes; three rows added here cover the rest of the rule: a
-- spelling only an alias carries, a spelling that differs from its make's name only by case, and a spelling the chain
-- records with its make id, recorded once without it.
\set ON_ERROR_STOP on
\ir test_market_trends_public_source_labels.sql
RESET ROLE;

CREATE TEMP TABLE chain_counts AS SELECT sum_count(get_market_trends(count_request()), 'selected') AS selected,
  sum_count(get_market_trends(count_request()), 'benchmark') AS benchmark;
INSERT INTO canonical_makes VALUES ('10000000-0000-0000-0000-000000000004', 'FOURTH', NULL);
INSERT INTO vehicles(id, make, canonical_make_id) VALUES
  ('00000000-0000-0000-0000-000000000201', 'syn', NULL),
  ('00000000-0000-0000-0000-000000000202', 'Fourth', NULL),
  ('00000000-0000-0000-0000-000000000203', 'SYNTHETIC', NULL);
INSERT INTO auction_events(id, vehicle_id, source_url, auction_end_date, winning_bid)
  SELECT ('50000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
    'https://bringatrailer.com/listing/fixture-resolution-' || i, date_trunc('day', now()) - interval '1 day' + i * interval '1 second', 2000 + i
  FROM generate_series(201, 203) i;
SELECT assert_count(sum_count(get_market_trends(count_request()), 'selected') = (SELECT selected + 2 FROM chain_counts)
    AND sum_count(get_market_trends(count_request()), 'benchmark') = (SELECT benchmark + 1 FROM chain_counts),
  'make resolution: before the change, an alias-only spelling, a case-only spelling and a spelling without its id resolve');

CREATE FUNCTION pg_temp.unclocked(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(k, pg_temp.unclocked(v)) FROM jsonb_each(j) AS e(k, v)
                                 WHERE k NOT IN ('knowledge_cutoff', 'bucket_elapsed_seconds', 'incomplete_bucket', 'generated_at', 'folded_at')), '{}'::jsonb)
    WHEN 'array' THEN coalesce((SELECT jsonb_agg(pg_temp.unclocked(v) ORDER BY o) FROM jsonb_array_elements(j) WITH ORDINALITY AS a(v, o)), '[]'::jsonb)
    ELSE j END
$$;

CREATE TEMP TABLE scopes AS
  SELECT 'make' AS label, count_request() AS req
  UNION ALL SELECT 'subject', count_request('supported_subject', '30000000-0000-0000-0000-000000000001');
GRANT SELECT ON scopes TO authenticated, anon;
CREATE TEMP TABLE before_out (label text, role text, out jsonb);
GRANT INSERT, SELECT ON before_out TO authenticated, anon;
SET ROLE authenticated;
INSERT INTO before_out SELECT label, 'authenticated', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
SET ROLE anon;
INSERT INTO before_out SELECT label, 'anon', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
RESET ROLE;
CREATE TEMP TABLE before_meta AS SELECT proacl, proowner, prosecdef, proconfig
  FROM pg_proc WHERE oid = 'public.get_market_trends(jsonb)'::regprocedure;

\ir ../migrations/20261015233000_market_trends_make_resolution.sql
\ir ../migrations/20261015233000_market_trends_make_resolution.sql

CREATE TEMP TABLE after_out (label text, role text, out jsonb);
GRANT INSERT, SELECT ON after_out TO authenticated, anon;
SET ROLE authenticated;
INSERT INTO after_out SELECT label, 'authenticated', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
SET ROLE anon;
INSERT INTO after_out SELECT label, 'anon', pg_temp.unclocked(get_market_trends(req)) FROM scopes;
RESET ROLE;

SELECT assert_count((SELECT count(*) FROM before_out) = 4 AND (SELECT count(*) FROM before_out WHERE out IS NULL) = 0,
  'make resolution: the chain''s scopes were read before the change');
SELECT assert_count(NOT EXISTS (SELECT label, role, out FROM before_out EXCEPT SELECT label, role, out FROM after_out)
  AND NOT EXISTS (SELECT label, role, out FROM after_out EXCEPT SELECT label, role, out FROM before_out),
  'make resolution: every scope and role reads the same output after the change, clock fields aside');
SELECT assert_count((SELECT b.proacl IS NOT DISTINCT FROM p.proacl AND b.proowner = p.proowner AND b.prosecdef = p.prosecdef
    AND b.proconfig = p.proconfig FROM before_meta b, pg_proc p WHERE p.oid = 'public.get_market_trends(jsonb)'::regprocedure),
  'make resolution: settings (statement_timeout 5s), owner, security and grants unchanged');
SELECT assert_count((SELECT prosrc LIKE '%make_resolved%' AND prosrc NOT LIKE '%WHERE lower(cm.canonical_name)=lower(b.make)%'
    FROM pg_proc WHERE oid = 'public.get_market_trends(jsonb)'::regprocedure),
  'make resolution: each make spelling resolves once, not per candidate row');
