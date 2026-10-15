-- Isolated PostgreSQL 17 contract for 20261016140000_privacy_mask_email_handle.sql. Stand-in tables with the live column names;
-- synthetic rows and a synthetic address only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_privacy && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_privacy -f supabase/sql/test_privacy_mask_email_handle.sql
-- Covered: the handle is found by sha256 only; every copy of it (comments incl. content_hash, auction_events winner and bid_history,
-- vehicle_events buyer, vehicles.origin_metadata, identity handle and profile url) is replaced by bidder-<8 hex>; each original goes to
-- private.privacy_masked_values; other members' handles are untouched; a second call is a no-op; a non-email handle never matches;
-- the ACL (no anon or authenticated access to the private table or the function).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, handle text, profile_url text,
  display_name text, updated_at timestamptz, UNIQUE (platform, handle));
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, author_username text,
  author_external_identity_id uuid, content_hash text);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, winning_bidder text, high_bidder text, bid_history jsonb);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, buyer_identifier text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, origin_metadata jsonb);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- synthetic: person@example.test and a plain member
INSERT INTO public.external_identities (id, platform, handle, profile_url) VALUES
 ('00000000-0000-0000-0000-0000000000e1', 'pcarmarket', 'person@example.test', 'https://example.test/member/person@example.test/'),
 ('00000000-0000-0000-0000-0000000000e2', 'pcarmarket', 'plainmember', 'https://example.test/member/plainmember/'),
 ('00000000-0000-0000-0000-0000000000e3', 'pcarmarket', '@insta_style', 'https://example.test/member/@insta_style/');
INSERT INTO public.vehicles (id, origin_metadata) VALUES ('00000000-0000-0000-0000-0000000000a1', '{"pcarmarket_buyer_username": "person@example.test", "x": 1}');
INSERT INTO public.auction_comments (vehicle_id, author_username, author_external_identity_id, content_hash) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'person@example.test', '00000000-0000-0000-0000-0000000000e1', 'pcm_v_2026-01-01_person@example.test_100_bid'),
 ('00000000-0000-0000-0000-0000000000a1', 'plainmember', '00000000-0000-0000-0000-0000000000e2', 'pcm_v_2026-01-01_plainmember_90_bid');
INSERT INTO public.auction_events (vehicle_id, winning_bidder, high_bidder, bid_history) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'person@example.test', NULL,
  '[{"user": "person@example.test", "kind": "sold", "amount": 100}, {"user": "plainmember", "kind": "bid", "amount": 90}]');
INSERT INTO public.vehicle_events (vehicle_id, buyer_identifier) VALUES ('00000000-0000-0000-0000-0000000000a1', 'person@example.test');

\ir ../migrations/20261016140000_privacy_mask_email_handle.sql

SET statement_timeout = '30s';
SELECT pg_temp.ok('a non-matching hash masks nothing',
  (public.privacy_mask_email_handle(encode(sha256(convert_to('nobody@example.test', 'UTF8')), 'hex')) ->> 'masked')::boolean IS FALSE);
SELECT pg_temp.ok('an Instagram-style handle never matches',
  (public.privacy_mask_email_handle(encode(sha256(convert_to('@insta_style', 'UTF8')), 'hex')) ->> 'masked')::boolean IS FALSE);
DO $$ BEGIN
  BEGIN PERFORM public.privacy_mask_email_handle('not-a-hash'); RAISE EXCEPTION 'Contract failed: a bad hash was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF; RAISE NOTICE 'PASS a bad hash is refused'; END;
END $$;
DO $$ BEGIN
  SET LOCAL statement_timeout = 0;
  BEGIN PERFORM public.privacy_mask_email_handle(repeat('a', 64)); RAISE EXCEPTION 'Contract failed: statement_timeout 0 was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF; RAISE NOTICE 'PASS an unbounded statement_timeout is refused'; END;
END $$;

SET statement_timeout = '30s';
CREATE TEMP TABLE r AS SELECT public.privacy_mask_email_handle(encode(sha256(convert_to(lower('Person@Example.test'), 'UTF8')), 'hex')) AS j;  -- the caller hashes the lower-cased handle
SELECT pg_temp.ok('the handle is masked', (SELECT (j ->> 'masked')::boolean FROM r));
SELECT pg_temp.ok('the mask is bidder-<8 hex>', (SELECT j ->> 'mask' ~ '^bidder-[0-9a-f]{8}$' FROM r));
SELECT pg_temp.ok('no table holds the address any more',
  NOT EXISTS (SELECT 1 FROM public.external_identities WHERE handle LIKE '%person@%' OR profile_url LIKE '%person@%')
  AND NOT EXISTS (SELECT 1 FROM public.auction_comments WHERE author_username LIKE '%person@%' OR content_hash LIKE '%person@%')
  AND NOT EXISTS (SELECT 1 FROM public.auction_events WHERE winning_bidder LIKE '%person@%' OR bid_history::text LIKE '%person@%')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE buyer_identifier LIKE '%person@%')
  AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE origin_metadata::text LIKE '%person@%'));
SELECT pg_temp.ok('the winner and the bid_history entry carry the same mask',
  (SELECT winning_bidder FROM public.auction_events) = (SELECT j ->> 'mask' FROM r)
  AND (SELECT bid_history -> 0 ->> 'user' FROM public.auction_events) = (SELECT j ->> 'mask' FROM r));
SELECT pg_temp.ok('the plain member and the Instagram-style handle are untouched',
  (SELECT bid_history -> 1 ->> 'user' FROM public.auction_events) = 'plainmember'
  AND EXISTS (SELECT 1 FROM public.external_identities WHERE handle = 'plainmember')
  AND EXISTS (SELECT 1 FROM public.external_identities WHERE handle = '@insta_style')
  AND EXISTS (SELECT 1 FROM public.auction_comments WHERE author_username = 'plainmember'));
SELECT pg_temp.ok('the vehicle metadata keeps its other keys', (SELECT (origin_metadata ->> 'x') = '1' FROM public.vehicles));
SELECT pg_temp.ok('every original went to the private table (comment x2, event x2, buyer, vehicle, identity)',
  (SELECT count(*) FROM private.privacy_masked_values WHERE original_value LIKE '%person@%') = 7
  AND (SELECT count(DISTINCT source) FROM private.privacy_masked_values) = 1
  AND (SELECT min(source) FROM private.privacy_masked_values) = 'privacy mask: email-form handle');
SELECT pg_temp.ok('a second call is a no-op', (public.privacy_mask_email_handle(encode(sha256(convert_to('person@example.test', 'UTF8')), 'hex')) ->> 'masked')::boolean IS FALSE
  AND (SELECT count(*) FROM private.privacy_masked_values) = 7);
SELECT pg_temp.ok('anon and authenticated cannot touch the private table or the function',
  NOT has_table_privilege('anon', 'private.privacy_masked_values', 'SELECT') AND NOT has_table_privilege('authenticated', 'private.privacy_masked_values', 'SELECT')
  AND NOT has_schema_privilege('anon', 'private', 'USAGE')
  AND NOT has_function_privilege('anon', 'public.privacy_mask_email_handle(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.privacy_mask_email_handle(text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.privacy_mask_email_handle(text,text)', 'EXECUTE'));
