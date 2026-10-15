-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_bid_tape -f this-file.sql
-- Contract for 20261017062000_live_bid_tape.sql. Synthetic rows only; never production.
-- Requires: an anonymous reader gets each bid of the window once (the same BaT comment over two transports is one bid),
-- newest first, with its amount, time and scheduled end; bids outside the window, backfilled history, non-stream rows,
-- superseded rows, other kinds and bids on private vehicles are left out; no bidder name leaves the read; the window
-- is clamped to 1-30 minutes; the read runs as its caller.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
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

CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'bid');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), kind public.observation_kind,
  observed_at timestamptz, ingested_at timestamptz DEFAULT now(), source_identifier text, structured_data jsonb,
  is_superseded boolean DEFAULT false);
-- The production read policy's shape for an anonymous reader: rows on public vehicles only.
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_public_read ON public.vehicle_observations FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_observations.vehicle_id AND v.is_public));
GRANT SELECT ON public.vehicles, public.vehicle_observations TO anon;

INSERT INTO public.vehicles (id, is_public) VALUES
  ('00000000-0000-4000-c000-000000000001', true), ('00000000-0000-4000-c000-000000000002', false);
CREATE FUNCTION pg_temp.frame(cid text, amount numeric, end_epoch bigint, who text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('transport', 'x', 'public_live_frame', jsonb_build_object('data', jsonb_build_object(
    'comment', jsonb_build_object('id', cid::bigint, 'type', 'bat-bid', 'bidAmount', amount, 'end_timestamp', end_epoch,
                                  'authorName', who, 'content', 'USD $' || amount || ' bid placed by ' || who))))
$$;
INSERT INTO public.vehicle_observations (vehicle_id, kind, observed_at, ingested_at, source_identifier, structured_data, is_superseded) VALUES
  -- A: one bid 30 s ago, admitted over two transports
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '30 seconds', now() - interval '10 seconds',
   'public-live:9:comment-added:comment:101:a', pg_temp.frame('101', 52000, extract(epoch FROM now() + interval '2 minutes')::bigint, 'bidder_one'), false),
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '30 seconds', now() - interval '5 seconds',
   'public-live:9:comment-added:comment:101:b', pg_temp.frame('101', 52000, extract(epoch FROM now() + interval '2 minutes')::bigint, 'bidder_one'), false),
  -- B: a bid 3 minutes ago
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '3 minutes', now() - interval '2 minutes',
   'public-live:9:comment-added:comment:102:a', pg_temp.frame('102', 50000, NULL, 'bidder_two'), false),
  -- C: 20 minutes ago (outside the default window)
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '20 minutes', now() - interval '19 minutes',
   'public-live:9:comment-added:comment:103:a', pg_temp.frame('103', 45000, NULL, 'bidder_three'), false),
  -- D: backfilled history (ingested now, placed a week ago)
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '7 days', now(),
   'public-live:9:comment-added:comment:104:a', pg_temp.frame('104', 20000, NULL, 'bidder_four'), false),
  -- E: a bid on a private vehicle
  ('00000000-0000-4000-c000-000000000002', 'bid', now() - interval '1 minute', now(),
   'public-live:8:comment-added:comment:105:a', pg_temp.frame('105', 9000, NULL, 'bidder_five'), false),
  -- F: not from the live stream
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '1 minute', now(),
   'archive:9:comment:106', pg_temp.frame('106', 51000, NULL, 'bidder_six'), false),
  -- G: superseded
  ('00000000-0000-4000-c000-000000000001', 'bid', now() - interval '1 minute', now(),
   'public-live:9:comment-added:comment:107:a', pg_temp.frame('107', 51500, NULL, 'bidder_seven'), true),
  -- H: a comment, not a bid
  ('00000000-0000-4000-c000-000000000001', 'comment', now() - interval '1 minute', now(),
   'public-live:9:comment-added:comment:108:a', pg_temp.frame('108', 1, NULL, 'bidder_eight'), false);

\ir ../migrations/20261017062000_live_bid_tape.sql
\ir ../migrations/20261017062000_live_bid_tape.sql

SET ROLE anon;
CREATE TEMP TABLE r5 AS SELECT public.live_bid_tape() AS j;
CREATE TEMP TABLE r30 AS SELECT public.live_bid_tape(30) AS j;
CREATE TEMP TABLE r1 AS SELECT public.live_bid_tape(0) AS j;
RESET ROLE;

SELECT pg_temp.ok('an anonymous reader gets the window''s bids once each, newest first',
  (SELECT jsonb_path_query_array(j, '$.bids[*].id') FROM r5) = '["101", "102"]'::jsonb
  AND (SELECT (j->>'minutes')::int FROM r5) = 5);
SELECT pg_temp.ok('each bid carries its amount, its time and the scheduled end after it',
  (SELECT (j->'bids'->0->>'amount')::numeric FROM r5) = 52000
  AND (SELECT (j->'bids'->0->>'end_at') IS NOT NULL AND (j->'bids'->1->>'end_at') IS NULL FROM r5)
  AND (SELECT (j->'bids'->0->>'vehicle_id')::uuid FROM r5) = '00000000-0000-4000-c000-000000000001');
SELECT pg_temp.ok('a wider window reaches the older bid; backfill, other sources, superseded rows, comments and private cars stay out',
  (SELECT jsonb_path_query_array(j, '$.bids[*].id') FROM r30) = '["101", "102", "103"]'::jsonb);
SELECT pg_temp.ok('the window is clamped to at least a minute',
  (SELECT (j->>'minutes')::int FROM r1) = 1 AND (SELECT jsonb_path_query_array(j, '$.bids[*].id') FROM r1) = '["101"]'::jsonb);
SELECT pg_temp.ok('no bidder name leaves the read',
  NOT EXISTS (SELECT 1 FROM r30 WHERE j::text ~ 'bidder_|authorName|placed by'));
SELECT pg_temp.ok('the read runs as its caller and is executable by anon',
  (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.live_bid_tape(integer)'::regprocedure)
  AND has_function_privilege('anon', 'public.live_bid_tape(integer)', 'EXECUTE'));
