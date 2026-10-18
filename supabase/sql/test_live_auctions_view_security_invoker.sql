-- Isolated PostgreSQL 17 contract for 20261008061000_live_auctions_view_security_invoker.sql. Synthetic rows only.
--   createdb dm_refinement_live_auctions_view_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_auctions_view_ci -f supabase/sql/test_live_auctions_view_security_invoker.sql
-- Fixtures: minimal monitored_auctions and live_auction_sources with RLS on and no policy for anon or authenticated (a
-- service_role SELECT policy stands in for prod's BYPASSRLS), the API roles with SELECT on both tables and on the view, and the view with its live definition, owned by the superuser running the test (as postgres owns it
-- in prod, with BYPASSRLS), without security_invoker.
-- Covered: before, anon reads the live monitor through the view while the table gives it 0 rows; after, anon and
-- authenticated read 0 rows through the view, service_role reads every live row, the definition is unchanged, the comment
-- records the change, re-apply changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.monitored_auctions') IS NOT NULL THEN
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

CREATE TABLE public.live_auction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text, soft_close_window_seconds integer);
CREATE TABLE public.monitored_auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.live_auction_sources(id),
  external_auction_id text, external_auction_url text, current_bid_cents bigint, bid_count integer, high_bidder_username text,
  reserve_status text, auction_end_time timestamptz, is_in_soft_close boolean DEFAULT false, is_live boolean DEFAULT true,
  updated_at timestamptz DEFAULT now());
ALTER TABLE public.live_auction_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitored_auctions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.live_auction_sources, public.monitored_auctions TO anon, authenticated, service_role;
-- Prod's service_role has BYPASSRLS; the fixture gives it a plain policy instead (the house fixture pattern), with the same effect.
CREATE POLICY service_role_reads ON public.live_auction_sources FOR SELECT TO service_role USING (true);
CREATE POLICY service_role_reads ON public.monitored_auctions FOR SELECT TO service_role USING (true);
-- The live definition (pg_get_viewdef, prod, 2026-10-07).
CREATE VIEW public.live_auctions_view AS
 SELECT ma.id, ma.external_auction_id, ma.external_auction_url, ma.current_bid_cents,
    ma.current_bid_cents::numeric / 100::numeric AS current_bid_dollars, ma.bid_count, ma.high_bidder_username, ma.reserve_status,
    ma.auction_end_time, EXTRACT(epoch FROM ma.auction_end_time - now())::integer AS seconds_remaining, ma.is_in_soft_close,
    ma.updated_at AS last_sync, las.slug AS platform, las.display_name AS platform_name, las.soft_close_window_seconds
   FROM public.monitored_auctions ma
     JOIN public.live_auction_sources las ON las.id = ma.source_id
  WHERE ma.is_live = true
  ORDER BY ma.is_in_soft_close DESC, ma.auction_end_time;
GRANT SELECT ON public.live_auctions_view TO anon, authenticated, service_role;

INSERT INTO public.live_auction_sources (id, slug, display_name, soft_close_window_seconds) VALUES
  ('00000000-0000-0000-0000-000000000001', 'bat', 'Bring a Trailer', 120);
INSERT INTO public.monitored_auctions (source_id, external_auction_id, external_auction_url, current_bid_cents, bid_count, high_bidder_username, reserve_status, auction_end_time, is_live) VALUES
  ('00000000-0000-0000-0000-000000000001', 'lot-1', 'https://example.test/lot/1', 1250000, 12, 'bidder_one', 'reserve_not_met', now() + interval '2 hours', true),
  ('00000000-0000-0000-0000-000000000001', 'lot-2', 'https://example.test/lot/2', 900000, 7, 'bidder_two', 'no_reserve', now() - interval '1 day', false);

SET ROLE anon;
SELECT pg_temp.ok('fixture reproduces the exposure: anon reads the live monitor and its high bidder through the view',
  (SELECT count(*) FROM public.live_auctions_view WHERE high_bidder_username = 'bidder_one') = 1);
SELECT pg_temp.ok('while the table gives anon 0 rows (RLS on, no policy)', (SELECT count(*) FROM public.monitored_auctions) = 0);
RESET ROLE;

\ir ../migrations/20261008061000_live_auctions_view_security_invoker.sql

SELECT pg_temp.ok('the view is security_invoker',
  coalesce((SELECT reloptions::text FROM pg_class WHERE oid = 'public.live_auctions_view'::regclass), '') ILIKE '%security_invoker=true%');
SET ROLE anon;
SELECT pg_temp.ok('anon reads 0 rows through the view', (SELECT count(*) FROM public.live_auctions_view) = 0);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('authenticated reads 0 rows through the view', (SELECT count(*) FROM public.live_auctions_view) = 0);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('service_role reads the live row and not the closed one',
  (SELECT count(*) FROM public.live_auctions_view) = 1
  AND (SELECT platform FROM public.live_auctions_view LIMIT 1) = 'bat');
RESET ROLE;
SELECT pg_temp.ok('the definition is unchanged (same 15 columns, high_bidder_username and seconds_remaining among them)',
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'live_auctions_view') = 15
  AND pg_get_viewdef('public.live_auctions_view'::regclass, true) LIKE '%high_bidder_username%'
  AND pg_get_viewdef('public.live_auctions_view'::regclass, true) LIKE '%seconds_remaining%'
  AND pg_get_viewdef('public.live_auctions_view'::regclass, true) LIKE '%is_live = true%');
SELECT pg_temp.ok('the view comment records the change',
  obj_description('public.live_auctions_view'::regclass, 'pg_class') LIKE '%security_invoker since 2026-10-07 (20261008061000)%');
SELECT pg_temp.ok('the grants are unchanged (anon still holds SELECT; RLS decides the rows)',
  has_table_privilege('anon', 'public.live_auctions_view', 'SELECT'));

\ir ../migrations/20261008061000_live_auctions_view_security_invoker.sql
SELECT pg_temp.ok('re-apply changes nothing',
  coalesce((SELECT reloptions::text FROM pg_class WHERE oid = 'public.live_auctions_view'::regclass), '') ILIKE '%security_invoker=true%'
  AND (SELECT count(*) FROM pg_class WHERE relname = 'live_auctions_view') = 1);
\echo 'live_auctions_view security_invoker contract: all checks passed'
