-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_finish_33_inputs -f this-file.sql
-- Contract for 20261018012000_live_finish_33_inputs.sql. Synthetic rows only; never production.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in a disposable database, never production.
--   * service_role executes it; PUBLIC, anon and authenticated cannot; a definer with a pinned path and a 10 s timeout;
--   * a null, empty or oversized (201) list is refused before anything is read; 200 lots are read;
--   * each named lot's facts come back, a lot with no comments included; unnamed lots never;
--   * comments: posted rows only, ordered by lot and time, author as md5(lower(name)) so distinct authors survive
--     case changes; no username and no comment text leave the function; the payload names its columns.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.auction_comments') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'Contract failed: % (statement succeeded)', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean), pg_temp.fails(text, text) TO anon, authenticated, service_role;

-- The columns the function reads, with their live types (2026-10-15), plus columns that must never leave.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, mileage integer, transmission text, vin text, image_count integer, title text,
  owner_email text, description text);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, content_hash text,
  posted_at timestamptz, comment_type text, author_username text, is_seller boolean, has_question boolean, bid_amount numeric,
  word_count integer, comment_text text, UNIQUE (vehicle_id, content_hash));
INSERT INTO public.vehicles VALUES
  ('00000000-0000-4000-8000-000000000001', 11000, '6-Speed Manual', '1G1FJ1R65M0123005', 120, '2021 Chevrolet Camaro ZL1 1LE 6-Speed', 'owner@example.invalid', 'long text'),
  ('00000000-0000-4000-8000-000000000002', NULL, NULL, NULL, 40, '1967 Ford Mustang Coupe', NULL, NULL),
  ('00000000-0000-4000-8000-000000000003', 5, 'Automatic', NULL, 10, 'not named in the call', NULL, NULL);
INSERT INTO public.auction_comments (vehicle_id, content_hash, posted_at, comment_type, author_username, is_seller, has_question, bid_amount, word_count, comment_text) VALUES
  ('00000000-0000-4000-8000-000000000001', 'a', now() - interval '3 hours', 'bid', 'FastBidder', false, false, 50000, 6, 'secret bid words'),
  ('00000000-0000-4000-8000-000000000001', 'b', now() - interval '2 hours', 'question', 'curious_one', false, true, NULL, 9, 'secret question text?'),
  ('00000000-0000-4000-8000-000000000001', 'c', now() - interval '1 hour', 'bid', 'fastbidder', false, false, 52000, 6, 'secret bid words again'),
  ('00000000-0000-4000-8000-000000000001', 'd', now() - interval '30 minutes', 'seller_response', 'TheSeller', true, false, NULL, 30, 'secret seller text'),
  ('00000000-0000-4000-8000-000000000001', 'e', NULL, 'observation', 'nobody', false, false, NULL, 3, 'secret unposted'),
  ('00000000-0000-4000-8000-000000000003', 'f', now() - interval '1 hour', 'bid', 'other', false, false, 9000, 6, 'secret other lot');

\ir ../migrations/20261018012000_live_finish_33_inputs.sql
\ir ../migrations/20261018012000_live_finish_33_inputs.sql

SELECT pg_temp.ok('only service_role executes it',
  has_function_privilege('service_role', 'public.live_finish_33_inputs(uuid[])', 'execute')
  AND NOT has_function_privilege('anon', 'public.live_finish_33_inputs(uuid[])', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.live_finish_33_inputs(uuid[])', 'execute')
  AND NOT has_function_privilege('public', 'public.live_finish_33_inputs(uuid[])', 'execute'));
SELECT pg_temp.ok('a definer with a pinned search_path and a 10 s statement timeout',
  p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp', 'statement_timeout=10s'] AND p.provolatile = 's')
FROM pg_proc p WHERE p.proname = 'live_finish_33_inputs';

SET ROLE service_role;
SELECT pg_temp.fails('a null list is refused', $s$SELECT public.live_finish_33_inputs(NULL)$s$);
SELECT pg_temp.fails('an empty list is refused', $s$SELECT public.live_finish_33_inputs(ARRAY[]::uuid[])$s$);
SELECT pg_temp.fails('201 lots are refused', $s$SELECT public.live_finish_33_inputs(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)))$s$);
SELECT pg_temp.ok('200 lots are read', jsonb_typeof(public.live_finish_33_inputs(
  ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 198)) || ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']::uuid[])->'lots') = 'array');
DO $$
DECLARE b jsonb := public.live_finish_33_inputs(ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']::uuid[]);
  t text := b::text;
BEGIN
  PERFORM pg_temp.ok('the payload names its columns',
    b->'lot_columns' = '["vehicle_id","mileage","transmission","vin","image_count","title"]'::jsonb
    AND b->'comment_columns' = '["vehicle_id","posted_at","comment_type","author_key","is_seller","has_question","bid_amount","word_count"]'::jsonb
    AND b->>'as_of' IS NOT NULL);
  PERFORM pg_temp.ok('both named lots, the one with no comments included, and nothing else',
    (SELECT array_agg(x->>0 ORDER BY x->>0) FROM jsonb_array_elements(b->'lots') x)
      = ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  PERFORM pg_temp.ok('the listing facts as stored',
    (SELECT x FROM jsonb_array_elements(b->'lots') x WHERE x->>0 = '00000000-0000-4000-8000-000000000001')
      = '["00000000-0000-4000-8000-000000000001", 11000, "6-Speed Manual", "1G1FJ1R65M0123005", 120, "2021 Chevrolet Camaro ZL1 1LE 6-Speed"]'::jsonb);
  PERFORM pg_temp.ok('the lot with no comments has none, and its missing facts are null',
    NOT EXISTS (SELECT FROM jsonb_array_elements(b->'comments') x WHERE x->>0 = '00000000-0000-4000-8000-000000000002')
    AND (SELECT x->1 = 'null'::jsonb AND x->3 = 'null'::jsonb FROM jsonb_array_elements(b->'lots') x WHERE x->>0 = '00000000-0000-4000-8000-000000000002'));
  PERFORM pg_temp.ok('posted comment rows only, in time order',
    jsonb_array_length(b->'comments') = 4
    AND (SELECT array_agg(x->>2 ORDER BY o) FROM jsonb_array_elements(b->'comments') WITH ORDINALITY e(x, o)) = ARRAY['bid', 'question', 'bid', 'seller_response']);
  PERFORM pg_temp.ok('authors leave as md5(lower(name)): the same bidder in two cases is one key',
    (SELECT count(DISTINCT x->>3) FROM jsonb_array_elements(b->'comments') x) = 3
    AND (SELECT x->>3 FROM jsonb_array_elements(b->'comments') WITH ORDINALITY e(x, o) WHERE o = 1) = md5('fastbidder'));
  PERFORM pg_temp.ok('seller, question, bid and word count as stored',
    (SELECT x->4 = 'true'::jsonb AND (x->>7)::int = 30 FROM jsonb_array_elements(b->'comments') x WHERE x->>2 = 'seller_response')
    AND (SELECT x->5 = 'true'::jsonb FROM jsonb_array_elements(b->'comments') x WHERE x->>2 = 'question')
    AND (SELECT max((x->>6)::numeric) FROM jsonb_array_elements(b->'comments') x) = 52000);
  PERFORM pg_temp.ok('no username, comment text, owner contact or description leaves',
    position('FastBidder' IN t) = 0 AND position('fastbidder' IN t) = 0 AND position('curious_one' IN t) = 0 AND position('TheSeller' IN t) = 0
    AND position('secret' IN t) = 0 AND position('example.invalid' IN t) = 0 AND position('long text' IN t) = 0);
  PERFORM pg_temp.ok('an unnamed lot''s rows never leave', position('00000000-0000-4000-8000-000000000003' IN t) = 0);
END $$;
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.fails('anon cannot call it', $s$SELECT public.live_finish_33_inputs(ARRAY['00000000-0000-4000-8000-000000000001']::uuid[])$s$);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.fails('authenticated cannot call it', $s$SELECT public.live_finish_33_inputs(ARRAY['00000000-0000-4000-8000-000000000001']::uuid[])$s$);
RESET ROLE;
