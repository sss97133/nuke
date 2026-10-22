\set ON_ERROR_STOP on
-- Runs only after the existing guarded relisted-lot fixture and actual native RPC.
-- No new testimony writer: all negative cases alter derived control pointers,
-- or reuse the existing duplicate-holder fixture through the Node harness.
DO $$ BEGIN
  ASSERT current_database()='nuke_soft_close_test','offline database required';
  ASSERT (SELECT count(*)=6 FROM public.vehicle_observations),'actual six-frame canonical intake required';
END $$;
SET statement_timeout='10s';
CREATE TEMP TABLE terminal_before AS
  SELECT id,stream_state->>'terminal_observation_id' AS receipt,vehicle_id
  FROM public.monitored_auctions;
CREATE TEMP TABLE function_authority_before AS
  SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc
  WHERE oid IN ('public.get_live_auction_health(date)'::regprocedure,
    'public.bat_live_pull_run(integer,boolean)'::regprocedure);
-- Move only the disposable scheduling controls into today's eligibility
-- window; native testimony and its original source/receipt clocks stay exact.
UPDATE public.monitored_auctions SET auction_end_time=now()-interval '5 minutes',is_live=false;
UPDATE public.vehicles SET auction_end_date=(now()-interval '5 minutes')::text
  WHERE id='00000000-0000-0000-0000-000000000002';
DO $$ DECLARE result jsonb; BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'measured old reader wrongly leaves the relisted canonical result unresolved';
  result:=public.bat_live_pull_run(0,true);
  ASSERT (result->>'stream_lots')::integer=1 AND (SELECT bool_and(is_live) FROM public.monitored_auctions),
    'measured old dispatcher reactivates the already closed locator monitor';
END $$;

\ir ../migrations/20261021231915_bat_relisted_control_receipts.sql
DO $$ DECLARE result jsonb; before_calls bigint; BEGIN
  SELECT count(*) INTO before_calls FROM net.calls WHERE body->>'mode'='live_stream';
  result:=public.bat_live_pull_run(0,true);
  ASSERT (result->>'stream_lots')::integer=0 AND NOT (SELECT bool_or(is_live) FROM public.monitored_auctions),
    'actual retirement, forced board upsert and recovery all keep the qualified lot retired';
  ASSERT (SELECT count(*) FROM net.calls WHERE body->>'mode'='live_stream')=before_calls,
    'qualified closed lot sends no additional native dispatch';
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=0,
    'reader follows the native canonical holder of exactly this lot';
  ASSERT public.get_live_auction_health('2026-10-04')#>>'{daily_closes,terminal_capture_status}'='failed',
    'historical late native admission still fails QC';
  ASSERT public.get_live_auction_health('2026-10-04')#>>'{closing_stream,status}'='failed',
    'resolving locator mismatch never makes historical integrity pass';
  ASSERT (SELECT count(*)=6 FROM public.vehicle_observations)
    AND NOT EXISTS(SELECT 1 FROM public.vehicle_observations WHERE vehicle_id='00000000-0000-0000-0000-000000000002'),
    'no testimony minted or reattributed';
END $$;
CREATE TEMP TABLE reviewed_functions AS
  SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc
  WHERE oid IN ('public.get_live_auction_health(date)'::regprocedure,
    'public.bat_live_pull_run(integer,boolean)'::regprocedure);
\ir ../migrations/20261021231915_bat_relisted_control_receipts.sql
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM reviewed_functions f
    WHERE pg_get_functiondef(f.oid) IS DISTINCT FROM f.definition),'exact post-state replay is a no-op';
  ASSERT NOT EXISTS(SELECT 1 FROM function_authority_before b JOIN pg_proc p USING(oid)
    WHERE (p.proowner,p.proacl,p.prosecdef,p.proconfig) IS DISTINCT FROM (b.proowner,b.proacl,b.prosecdef,b.proconfig)),
    'owner, execute grants, security mode and configuration unchanged';
END $$;

BEGIN;
UPDATE public.monitored_auctions SET is_live=true,
  stream_state=stream_state-'terminal_observation_id';
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'missing native terminal citation never hides unresolved lot';
  PERFORM public.bat_live_pull_run(0,true);
  ASSERT (SELECT bool_and(is_live) FROM public.monitored_auctions),'uncited lot stays scheduled';
END $$;
ROLLBACK;

BEGIN;
DO $$ BEGIN
  ASSERT EXISTS(SELECT 1 FROM public.vehicle_observations WHERE kind<>'sale_result'),
    'captured fixture must contain a nonterminal native receipt';
END $$;
UPDATE public.monitored_auctions SET is_live=true,
  stream_state=jsonb_set(stream_state,'{terminal_observation_id}',to_jsonb(
    (SELECT id::text FROM public.vehicle_observations WHERE kind<>'sale_result' LIMIT 1)));
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'a same-lot nonterminal reading is not a native terminal result';
END $$;
ROLLBACK;

BEGIN;
UPDATE public.monitored_auctions SET is_live=true,
  vehicle_id='00000000-0000-0000-0000-000000000099';
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'terminal proof for a different locator binding cannot settle this monitor';
END $$;
ROLLBACK;

BEGIN;
UPDATE public.vehicles SET origin_metadata=jsonb_set(origin_metadata,'{external_id}','"different-post"')
  WHERE id='00000000-0000-0000-0000-000000000002';
UPDATE public.monitored_auctions SET is_live=true;
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'a changed native post binding cannot borrow the old terminal receipt';
END $$;
ROLLBACK;

BEGIN;
UPDATE public.monitored_auctions SET is_live=true,
  external_auction_url='https://bringatrailer.com/listing/unrelated-native-proof';
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'a different source episode cannot borrow the receipt';
END $$;
ROLLBACK;

BEGIN;
-- EXISTING_DUPLICATE_HOLDER_FIXTURE
UPDATE public.monitored_auctions SET is_live=true;
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=1,
    'contradictory canonical holders remain a QC failure';
  PERFORM public.bat_live_pull_run(0,true);
  ASSERT (SELECT bool_and(is_live) FROM public.monitored_auctions),'contradictory lot stays scheduled';
END $$;
ROLLBACK;

BEGIN;
UPDATE public.monitored_auctions SET vehicle_id='00000000-0000-0000-0000-000000000005',
  stream_state=stream_state-'terminal_observation_id';
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04')#>>'{closing_stream,eligible_lots}')::integer=0,
    'legacy direct same-vehicle closed-lot path is preserved without requiring a native receipt';
END $$;
ROLLBACK;
SELECT 'relisted monitor control and health contracts passed';
SELECT 'unqualified and conflicting native receipts remain visible';
SELECT 'historical lateness and function authority preserved';
