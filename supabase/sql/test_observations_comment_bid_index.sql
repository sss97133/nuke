-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_comment_bid_index -f this-file.sql
-- Proves, for 20261014044500_rebuild_observations_comment_bid_index.sql, that vehicle_comments_unified stops running the
-- vehicle_observations row policy over every observation of a vehicle once the comment/bid partial index is VALID, and that
-- the rows each reader gets do not change: an anonymous caller still sees no comment with money on it and nothing of a
-- private vehicle, a signed-in stranger the same, the owner all of their own. Production holds the index INVALID
-- (indisvalid = false, indisready = true, 2026-10-14); the contract reproduces that state by clearing indisvalid.
-- Policies, observation_is_public() and the view are the live text (helpers/vehicle_observations_rls_fixture.sql,
-- helpers/vehicle_comments_unified_live_20261014.sql). The rows below are a disposable test database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
\ir helpers/vehicle_observations_rls_fixture.sql

-- The two other arms of the view, with the live policies (a permissive true SELECT policy each) and the columns it reads.
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, comment_text text, posted_at timestamptz,
  author_username text, comment_type text, bid_amount numeric, is_seller boolean, platform text, source_url text, external_identity_id uuid,
  media_urls text[], auction_event_id uuid, content_hash text);
CREATE UNIQUE INDEX auction_comments_vehicle_content_hash_key ON public.auction_comments (vehicle_id, content_hash);
CREATE TABLE public.user_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, target_type text,
  comment_text text, media_urls text[], created_at timestamptz DEFAULT now());
CREATE INDEX idx_user_comments_vehicle ON public.user_comments (vehicle_id);
ALTER TABLE public.auction_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read auction comments" ON public.auction_comments FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view user comments" ON public.user_comments FOR SELECT TO public USING (true);
GRANT SELECT ON public.auction_comments, public.user_comments TO anon, authenticated, service_role;
\ir helpers/vehicle_comments_unified_live_20261014.sql
SELECT md5(pg_get_viewdef('public.vehicle_comments_unified'::regclass, true)) = '561821b0f8495fb238b4a43a5d997e66' AS view_is_live \gset
SELECT md5(pg_get_functiondef('public.observation_is_public(observation_kind, jsonb)'::regprocedure)) = 'a19d4d1abf5af344878d05bf98be0f49' AS fn_is_live \gset

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_plan(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j text;
BEGIN EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO j; RETURN j::jsonb; END $$;
-- How many times the observation row policy probed vehicles while the statement ran (its EXISTS is the only reader of vehicles).
CREATE FUNCTION public.t_policy_probes(p_sql text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(max((x #>> '{}')::bigint), 0)
    FROM jsonb_path_query(public.t_plan(p_sql), '$.** ? (@."Relation Name" == "vehicles")."Actual Loops"') x $$;
CREATE FUNCTION public.t_uses_index(p_sql text, p_index text) RETURNS boolean LANGUAGE sql AS $$
  SELECT strpos(public.t_plan(p_sql)::text, '"Index Name": "' || p_index || '"') > 0 $$;
-- The statements the readers send, and the ids they return (last two hex digits of comment_id, sorted).
CREATE FUNCTION public.t_sql_list(p_vehicle uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($f$ SELECT comment_id, vehicle_id, comment_text, observed_at, author_username, comment_type, bid_amount, is_seller, platform,
                           comment_url, external_identity_id, media_urls, auction_event_id, source_category, source_slug, user_id, is_editable
                      FROM public.vehicle_comments_unified WHERE vehicle_id = %L ORDER BY source_category ASC, comment_id ASC $f$, p_vehicle) $$;
CREATE FUNCTION public.t_sql_count(p_vehicle uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($f$ SELECT comment_id FROM public.vehicle_comments_unified WHERE vehicle_id = %L $f$, p_vehicle) $$;
CREATE FUNCTION public.t_ids(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(right(comment_id, 2), '','' ORDER BY right(comment_id, 2)), '''') FROM (%s) q', p_sql) INTO r;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_plan(text), public.t_policy_probes(text), public.t_uses_index(text, text),
  public.t_sql_list(uuid), public.t_sql_count(uuid), public.t_ids(text) TO anon, authenticated;
SELECT public.t_assert(:'view_is_live'::boolean AND :'fn_is_live'::boolean, 'the fixture is the live view and observation_is_public');

-- O owns K (no auction comments) and the private Q. M is a public auction car with auction comments. S is a signed-in stranger.
INSERT INTO public.vehicles (id, user_id, is_public) VALUES
 ('40000000-0000-0000-0000-00000000004d', NULL, true),
 ('40000000-0000-0000-0000-00000000004b', '30000000-0000-0000-0000-00000000000a', true),
 ('40000000-0000-0000-0000-000000000051', '30000000-0000-0000-0000-00000000000a', false);
INSERT INTO public.auction_comments (id, vehicle_id, comment_text, posted_at, author_username, comment_type, platform, content_hash) VALUES
 ('d0000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000004d', 'first', now() - interval '3 hours', 'u1', 'comment', 'bat', 'h1'),
 ('d0000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-00000000004d', 'second', now() - interval '2 hours', 'u2', 'bid', 'bat', 'h2'),
 ('d0000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-00000000004d', 'third', now() - interval '1 hours', 'u3', 'comment', 'bat', 'h3');
INSERT INTO public.user_comments (id, vehicle_id, user_id, target_type, comment_text) VALUES
 ('e0000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-00000000004b', '30000000-0000-0000-0000-00000000000b', 'vehicle', 'nice truck');
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_observations (id, vehicle_id, observed_at, kind, content_text, structured_data, is_superseded) VALUES
 -- K: comments and bids; c3 carries a payment record (not public); c4 is superseded (the view does not filter it)
 ('c0000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-00000000004b', now() - interval '5 hours', 'comment', 'good',  '{"author_username":"a"}', false),
 ('c0000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-00000000004b', now() - interval '4 hours', 'bid',     'bid 5k', '{"bid_amount":"5000"}', false),
 ('c0000000-0000-0000-0000-0000000000c3', '40000000-0000-0000-0000-00000000004b', now() - interval '3 hours', 'comment', 'paid',  '{"payment":"wire","paid_usd":900}', false),
 ('c0000000-0000-0000-0000-0000000000c4', '40000000-0000-0000-0000-00000000004b', now() - interval '2 hours', 'comment', 'old',   '{"author_username":"b"}', true),
 -- M has auction comments, so its comment observations are not part of the view
 ('c0000000-0000-0000-0000-0000000000c5', '40000000-0000-0000-0000-00000000004d', now() - interval '5 hours', 'comment', 'dup',   '{"author_username":"c"}', false),
 ('c0000000-0000-0000-0000-0000000000c6', '40000000-0000-0000-0000-00000000004d', now() - interval '4 hours', 'bid',     'dup',   '{"bid_amount":"1"}', false),
 -- the private vehicle
 ('c0000000-0000-0000-0000-0000000000c7', '40000000-0000-0000-0000-000000000051', now() - interval '5 hours', 'comment', 'priv',  '{"author_username":"d"}', false);
-- the rest of each car's record: what a scan of "all observations of the vehicle" has to wade through
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, kind, structured_data, is_superseded)
SELECT v, now() - (g || ' minutes')::interval, (ARRAY['condition', 'media', 'specification', 'work_record'])[1 + g % 4]::observation_kind,
       jsonb_build_object('n', g, 'note', repeat('x', 200)), false
  FROM unnest(ARRAY['40000000-0000-0000-0000-00000000004b', '40000000-0000-0000-0000-00000000004d']::uuid[]) v, generate_series(1, 600) g;
-- Production's state: the partial index exists, is ready and is INVALID.
CREATE INDEX idx_observations_vehicle_comment_bid ON public.vehicle_observations (vehicle_id, observed_at DESC)
  WHERE (kind = ANY (ARRAY['comment'::observation_kind, 'bid'::observation_kind]));
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_observations_vehicle_comment_bid'::regclass;
SELECT public.t_assert((SELECT NOT indisvalid AND indisready FROM pg_index WHERE indexrelid = 'public.idx_observations_vehicle_comment_bid'::regclass), 'fixture: invalid and ready, as in production');
ANALYZE;

\set M '''40000000-0000-0000-0000-00000000004d'''
\set K '''40000000-0000-0000-0000-00000000004b'''
\set Q '''40000000-0000-0000-0000-000000000051'''

-- What each reader sees, before the rebuild. Row ids: auction a1 a2 a3 | user f1 | observations c1..c7.
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT public.t_ids(public.t_sql_list(:M)) AS anon_m, public.t_ids(public.t_sql_list(:K)) AS anon_k, public.t_ids(public.t_sql_list(:Q)) AS anon_q,
       public.t_ids(public.t_sql_count(:K)) AS anon_k_count \gset
SELECT public.t_policy_probes(public.t_sql_list(:K)) AS probes_before_k, public.t_policy_probes(public.t_sql_list(:M)) AS probes_before_m,
       public.t_policy_probes(public.t_sql_count(:K)) AS probes_before_count \gset
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
SELECT public.t_ids(public.t_sql_list(:K)) AS s_k, public.t_ids(public.t_sql_list(:Q)) AS s_q \gset
SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
SELECT public.t_ids(public.t_sql_list(:K)) AS o_k, public.t_ids(public.t_sql_list(:Q)) AS o_q \gset
RESET ROLE;
RESET request.jwt.claims;
-- Expected: M shows its three auction comments (its comment observations are hidden by the view's anti-join). K shows
-- the public comment c1, the bid c2 and the superseded c4 and the user comment f1; not the payment record c3. The owner adds c3.
SELECT public.t_assert(:'anon_m' = 'a1,a2,a3', format('anon, M: auction comments only; got %s', :'anon_m'));
SELECT public.t_assert(:'anon_k' = 'c1,c2,c4,f1' AND :'anon_k_count' = 'c1,c2,c4,f1', format('anon, K: c1 c2 c4 f1 without the payment record; got %s', :'anon_k'));
SELECT public.t_assert(:'anon_q' = '', 'anon, Q: nothing of the private vehicle');
SELECT public.t_assert(:'s_k' = 'c1,c2,c4,f1' AND :'s_q' = '', 'a signed-in stranger reads what anon reads');
SELECT public.t_assert(:'o_k' = 'c1,c2,c3,c4,f1' AND :'o_q' = 'c7', format('owner: all of K including the payment record, and Q; got %s / %s', :'o_k', :'o_q'));
SELECT public.t_assert(:probes_before_k >= 500 AND :probes_before_m >= 500 AND :probes_before_count >= 500,
  format('before: with the index invalid the policy runs on the whole vehicle (K %s, M %s, count %s probes)', :probes_before_k, :probes_before_m, :probes_before_count));

-- The migration: the invalid index is dropped and rebuilt valid, same definition.
\ir ../migrations/20261014044500_rebuild_observations_comment_bid_index.sql
SET statement_timeout = '60s'; SET lock_timeout = '5s';
ANALYZE;
SELECT public.t_assert((SELECT indisvalid AND indisready AND NOT indisunique FROM pg_index WHERE indexrelid = 'public.idx_observations_vehicle_comment_bid'::regclass),
  'the index is valid and ready after the rebuild');
SET enable_seqscan = off;
SET ROLE anon; SET request.jwt.claims = '{"role": "anon"}';
SELECT public.t_assert(public.t_uses_index(public.t_sql_list(:K), 'idx_observations_vehicle_comment_bid'), 'anon list read uses the comment/bid index');
SELECT public.t_assert(public.t_uses_index(public.t_sql_count(:K), 'idx_observations_vehicle_comment_bid'), 'anon count read uses the comment/bid index');
SELECT public.t_policy_probes(public.t_sql_list(:K)) AS probes_after_k, public.t_policy_probes(public.t_sql_list(:M)) AS probes_after_m,
       public.t_policy_probes(public.t_sql_count(:K)) AS probes_after_count \gset
SELECT public.t_assert(:probes_after_k <= 6 AND :probes_after_m <= 6 AND :probes_after_count <= 6,
  format('after: the policy runs on the comment and bid rows only (K %s, M %s, count %s probes)', :probes_after_k, :probes_after_m, :probes_after_count));
SELECT public.t_ids(public.t_sql_list(:M)) = :'anon_m' AND public.t_ids(public.t_sql_list(:K)) = :'anon_k' AND public.t_ids(public.t_sql_list(:Q)) = :'anon_q' AS anon_same \gset
SELECT public.t_assert(:'anon_same'::boolean, 'anon reads the same rows after the rebuild');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
SELECT public.t_assert(public.t_ids(public.t_sql_list(:K)) = :'s_k' AND public.t_ids(public.t_sql_list(:Q)) = :'s_q', 'a signed-in stranger reads the same rows after the rebuild');
SET request.jwt.claims = '{"sub": "30000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
SELECT public.t_assert(public.t_ids(public.t_sql_list(:K)) = :'o_k' AND public.t_ids(public.t_sql_list(:Q)) = :'o_q', 'the owner reads the same rows after the rebuild');
RESET ROLE;
RESET request.jwt.claims;
RESET enable_seqscan;

-- A second run keeps the valid index (same oid).
SELECT 'public.idx_observations_vehicle_comment_bid'::regclass::oid AS cb_oid \gset
\ir ../migrations/20261014044500_rebuild_observations_comment_bid_index.sql
SET statement_timeout = '60s';
SELECT public.t_assert('public.idx_observations_vehicle_comment_bid'::regclass::oid = :cb_oid, 'a second run keeps the index');

-- An interrupted build (INVALID again) is rebuilt by the next run.
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_observations_vehicle_comment_bid'::regclass;
\ir ../migrations/20261014044500_rebuild_observations_comment_bid_index.sql
SET statement_timeout = '60s';
SELECT public.t_assert((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = 'public.idx_observations_vehicle_comment_bid'::regclass)
  AND 'public.idx_observations_vehicle_comment_bid'::regclass::oid <> :cb_oid, 'the rerun replaced the invalid index with a valid one');

-- A valid index of that name with another definition stops the migration and is left as found.
DROP INDEX public.idx_observations_vehicle_comment_bid;
CREATE INDEX idx_observations_vehicle_comment_bid ON public.vehicle_observations (vehicle_id);
\set ON_ERROR_STOP off
\echo 'Expected: the definition assertion ERROR below.'
\ir ../migrations/20261014044500_rebuild_observations_comment_bid_index.sql
\set ON_ERROR_STOP on
SET statement_timeout = '60s';
SELECT public.t_assert(pg_get_indexdef('public.idx_observations_vehicle_comment_bid'::regclass) NOT LIKE '%WHERE%', 'a differently defined index is left as found');

SELECT 'observations comment/bid index contract: PASS' AS result;
