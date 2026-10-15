-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder links only, never production data.
-- Contract for 20261016163000_correct_auction_event_link.sql (the auction_events arm of correct_vehicle_event_link)
-- and 20261016181500_correct_auction_event_link_dependents.sql (an auction with comments, links or predictions is
-- held, because they cascade on delete; its guard refuses a drifted body).
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in a disposable database.
-- A hybrid row (a BaT truck that collected a Barrett-Jackson Corvette auction) gives the auction to the Corvette's
-- own vehicle; a duplicate of a lot that vehicle already holds (same lot under www. and a trailing slash) is retired
-- into superseded_rows with its full row; a stale plan, a missing event, a missing citation or reason, an archive
-- request, a missing or deleted target and a caller over the 60 s budget are refused or reported without writes; a
-- replay of the plan writes nothing; only service_role may execute; the migration applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The columns the writer reads or writes, the live unique index, and superseded_rows as live (2026-10-15).
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public.auction_events(
  id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id), source text, source_url text, lot_number text,
  outcome text, winning_bid numeric, merged_from_vehicle_id uuid, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE TABLE public.superseded_rows(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text NOT NULL, row_id uuid NOT NULL, row_data jsonb NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(), asserted_by text NOT NULL, source jsonb NOT NULL, reason text NOT NULL,
  restored_at timestamptz);
-- Dependents as live: comments and links cascade on delete, predictions are set null.
CREATE TABLE public.auction_comments(id uuid PRIMARY KEY, vehicle_id uuid,
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE);
CREATE TABLE public.auction_event_links(id uuid PRIMARY KEY,
  from_auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE,
  to_auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE);
CREATE TABLE public.hammer_predictions(id uuid PRIMARY KEY,
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE SET NULL);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261016163000_correct_auction_event_link.sql
-- A second application replaces the function with the same body.
\ir ../migrations/20261016163000_correct_auction_event_link.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('163000 installs the fingerprint 181500 expects',
    md5(pg_get_functiondef('public.correct_auction_event_link(jsonb,text)'::regprocedure))
      = '5b9ad1c47adf60eb3770a5b276cc4be1'); -- gitleaks:allow (fingerprint)
END $$;
\ir ../migrations/20261016181500_correct_auction_event_link_dependents.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('181500 installs the expected body',
    md5(pg_get_functiondef('public.correct_auction_event_link(jsonb,text)'::regprocedure))
      = 'b61e84bf6d7e28f698823d52959a794a'); -- gitleaks:allow (fingerprint)
END $$;
-- A second application is a no-op that passes its own guard.
\ir ../migrations/20261016181500_correct_auction_event_link_dependents.sql

-- Truck (the hybrid row), the Corvette's own vehicle, a deleted vehicle.
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', NULL),
  ('00000000-0000-0000-0000-0000000000b1', NULL), ('00000000-0000-0000-0000-0000000000d1', now());
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, lot_number, outcome, winning_bid) VALUES
  -- the truck's own BaT auction: stays
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'bat',
   'https://example.invalid/bat/1967-chevrolet-custom-sport-truck/', NULL, 'sold', 3450),
  -- the Corvette's Barrett-Jackson auction on the truck: moves
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://example.invalid/bj/docket/200665', '200665', 'sold', 121000),
  -- a second copy of a lot the Corvette already holds (www. and a trailing slash): retired as a duplicate
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://www.example.invalid/bj/docket/116242/', '116242', 'sold', NULL),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'barrett-jackson',
   'https://example.invalid/bj/docket/116242', '116242', 'sold', 99000),
  -- a second Corvette lot with no copy on the Corvette: a plain move
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://example.invalid/bj/docket/132768', '132768', 'sold', NULL);

CREATE FUNCTION pg_temp.call(rows jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.correct_auction_event_link(rows, 'contract') $$;
CREATE FUNCTION pg_temp.row(ev text, expected text, target text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_id', ev, 'expected_vehicle_id', expected, 'action', 'move', 'to_vehicle_id', target,
    'source', jsonb_build_object('type', 'listing_page_snapshot', 'ref', 'https://example.invalid/bj/docket/200665'),
    'reason', 'the docket car is a Corvette, not the BaT truck') || extra $$;

-- 1. Refusals write nothing.
DO $$ DECLARE n int := (SELECT count(*) FROM public.superseded_rows); BEGIN
  BEGIN PERFORM pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '{"source": {"type": "x"}}')));
    RAISE EXCEPTION 'no ref accepted'; EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('a row without source.ref is refused', SQLERRM LIKE '%no cited source%'); END;
  BEGIN PERFORM pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '{"reason": "short"}')));
    RAISE EXCEPTION 'short reason accepted'; EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('a row without a reason is refused', SQLERRM LIKE '%needs a reason%'); END;
  BEGIN PERFORM pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-0000000000a1', NULL, '{"action": "archive"}')));
    RAISE EXCEPTION 'archive accepted'; EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('archive is not an action (a lot without a vehicle waits for it)', SQLERRM LIKE '%not allowed%'); END;
  BEGIN PERFORM pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1')));
    RAISE EXCEPTION 'deleted target accepted'; EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('a deleted target is refused', SQLERRM LIKE '%missing or deleted%'); END;
  BEGIN PERFORM pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1')));
    RAISE EXCEPTION 'same target accepted'; EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('a move to the vehicle it is on is refused', SQLERRM LIKE '%already belongs%'); END;
  PERFORM pg_temp.ok('refusals wrote nothing', (SELECT count(*) FROM public.superseded_rows) = n
    AND (SELECT vehicle_id FROM public.auction_events WHERE id = '00000000-0000-0000-0000-000000000002')
        = '00000000-0000-0000-0000-0000000000a1');
END $$;

SET statement_timeout = '61s';
DO $$ BEGIN
  BEGIN PERFORM pg_temp.call('[]'::jsonb); RAISE EXCEPTION 'unbounded caller accepted';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.ok('a caller over the 60 s budget is refused', SQLERRM LIKE '%statement_timeout%'); END;
END $$;
SET statement_timeout = '30s';

-- 2. A stale plan and a missing event are reported, not written.
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.call(jsonb_build_array(
    pg_temp.row('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1',
                '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-00000000ffff', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000b1')));
  PERFORM pg_temp.ok('stale plan reported', jsonb_array_length(r -> 'stale') = 1 AND (r ->> 'moved')::int = 0);
  PERFORM pg_temp.ok('missing event reported', r -> 'missing' = '["00000000-0000-0000-0000-00000000ffff"]'::jsonb);
  PERFORM pg_temp.ok('nothing written', NOT EXISTS (SELECT 1 FROM public.superseded_rows));
END $$;

-- 3. The repair: the Corvette's auctions leave the truck; the truck keeps its own.
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.call(jsonb_build_array(
    pg_temp.row('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000b1')));
  PERFORM pg_temp.ok('two moved, one retired as a duplicate',
    (r ->> 'moved')::int = 2 AND (r ->> 'retired_duplicates')::int = 1 AND r ->> 'ok' = 'true');
  PERFORM pg_temp.ok('moved row keeps its content and records its origin',
    (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000b1' AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000000a1'
            AND winning_bid = 121000 AND lot_number = '200665'
       FROM public.auction_events WHERE id = '00000000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.ok('the row before the move is kept',
    (SELECT row_data ->> 'vehicle_id' = '00000000-0000-0000-0000-0000000000a1' AND source ->> 'relinked_to_vehicle'
            = '00000000-0000-0000-0000-0000000000b1' AND reason LIKE '%relinked%'
       FROM public.superseded_rows WHERE row_id = '00000000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.ok('the duplicate is gone from auction_events and whole in superseded_rows',
    NOT EXISTS (SELECT 1 FROM public.auction_events WHERE id = '00000000-0000-0000-0000-000000000003')
    AND (SELECT row_data ->> 'source_url' = 'https://www.example.invalid/bj/docket/116242/'
            AND source ->> 'duplicate_of_event' = '00000000-0000-0000-0000-000000000004'
            AND asserted_by = 'contract'
       FROM public.superseded_rows WHERE row_id = '00000000-0000-0000-0000-000000000003'));
  PERFORM pg_temp.ok('the Corvette holds three auctions, one per lot',
    (SELECT count(*) FROM public.auction_events WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') = 3);
  PERFORM pg_temp.ok('the truck keeps only its own BaT auction',
    (SELECT array_agg(id::text) FROM public.auction_events WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1')
      = ARRAY['00000000-0000-0000-0000-000000000001']);
END $$;

-- 4. Replaying the same plan is stale everywhere and writes nothing more.
DO $$ DECLARE n int := (SELECT count(*) FROM public.superseded_rows); r jsonb; BEGIN
  r := pg_temp.call(jsonb_build_array(pg_temp.row('00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1',
                '00000000-0000-0000-0000-0000000000b1')));
  PERFORM pg_temp.ok('a replay reports stale and missing, no writes',
    jsonb_array_length(r -> 'stale') = 1 AND jsonb_array_length(r -> 'missing') = 1
    AND (SELECT count(*) FROM public.superseded_rows) = n);
END $$;

-- 5. An auction with a comment, a link or a prediction is held: nothing written, nothing cascaded.
INSERT INTO public.auction_events (id, vehicle_id, source, source_url, lot_number, outcome) VALUES
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://example.invalid/bj/docket/300001', '300001', 'sold'),
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://example.invalid/bj/docket/300002', '300002', 'sold'),
  ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a1', 'barrett-jackson',
   'https://example.invalid/bj/docket/300003', '300003', 'sold'),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b1', 'barrett-jackson',
   'https://example.invalid/bj/docket/300001', '300001', 'sold');
INSERT INTO public.auction_comments VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000006');
INSERT INTO public.auction_event_links VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-000000000007');
INSERT INTO public.hammer_predictions VALUES ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000008');
DO $$ DECLARE r jsonb; n int := (SELECT count(*) FROM public.superseded_rows); BEGIN
  r := pg_temp.call(jsonb_build_array(
    pg_temp.row('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
    pg_temp.row('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1')));
  PERFORM pg_temp.ok('a duplicate with a comment, a linked auction and a predicted auction are held',
    jsonb_array_length(r -> 'held') = 3 AND (r ->> 'moved')::int = 0 AND (r ->> 'retired_duplicates')::int = 0);
  PERFORM pg_temp.ok('held rows are untouched and nothing cascaded',
    (SELECT count(*) FROM public.auction_events WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1'
       AND id IN ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007',
                  '00000000-0000-0000-0000-000000000008')) = 3
    AND EXISTS (SELECT 1 FROM public.auction_comments WHERE auction_event_id = '00000000-0000-0000-0000-000000000006')
    AND EXISTS (SELECT 1 FROM public.auction_event_links WHERE to_auction_event_id = '00000000-0000-0000-0000-000000000007')
    AND EXISTS (SELECT 1 FROM public.hammer_predictions WHERE auction_event_id = '00000000-0000-0000-0000-000000000008')
    AND (SELECT count(*) FROM public.superseded_rows) = n);
END $$;

-- 6. A drifted live body is refused by the 181500 guard, then the real chain is restored.
CREATE OR REPLACE FUNCTION public.correct_auction_event_link(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text)
  RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261016181500_correct_auction_event_link_dependents.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted body is not replaced',
  (SELECT prosrc FROM pg_proc WHERE proname = 'correct_auction_event_link') LIKE '%SELECT ''{}''::jsonb%');
DROP FUNCTION public.correct_auction_event_link(jsonb, text);
\ir ../migrations/20261016163000_correct_auction_event_link.sql
\ir ../migrations/20261016181500_correct_auction_event_link_dependents.sql

-- 7. Only service_role executes.
DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot execute', NOT has_function_privilege('anon', 'public.correct_auction_event_link(jsonb,text)', 'EXECUTE'));
  PERFORM pg_temp.ok('authenticated cannot execute',
    NOT has_function_privilege('authenticated', 'public.correct_auction_event_link(jsonb,text)', 'EXECUTE'));
  PERFORM pg_temp.ok('service_role executes', has_function_privilege('service_role', 'public.correct_auction_event_link(jsonb,text)', 'EXECUTE'));
  PERFORM pg_temp.ok('runs as its owner', (SELECT prosecdef FROM pg_proc WHERE proname = 'correct_auction_event_link'));
END $$;
