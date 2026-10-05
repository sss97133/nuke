\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT current_database()='nuke_soft_close_test','offline database required';
END $$;

-- Real metadata/extension/bid frames establish an expired scheduled end;
-- the source result is deliberately withheld until the next intake.
SET ROLE service_role;
SELECT public.ingest_bat_live_events((SELECT jsonb_agg(f)
  FROM public.fixture_frames CROSS JOIN LATERAL jsonb_array_elements(doc->'frames') f
  WHERE f->>'kind'<>'sale_result'),'[]'::jsonb);
RESET ROLE;
DO $$ DECLARE reading jsonb; BEGIN
  reading:=public.get_live_auction_health('2026-10-04'::date)->'daily_closes';
  ASSERT (reading->>'expected_known_lots')::integer=1,'monitor and caches deduplicate by source episode';
  ASSERT (reading->>'confirmed_closed_lots')::integer=0,'deadline never mints a terminal outcome';
  ASSERT (reading->>'unresolved_lots')::integer=1,'missing source result remains visible';
  ASSERT (reading->>'overdue_result_lots')::integer=1,'past deadline lacks a result after grace';
  ASSERT reading->>'status'='failed','missing result fails the settlement assay';
  ASSERT public.get_live_auction_health('2026-10-04'::date)#>>'{closing_stream,status}'='failed',
    'existing job-health path receives the settlement failure';
END $$;

-- A known canonical source episode can also be missing its monitor. Exercise
-- the actual existing scheduler; these are derived control/entity-cache edits
-- in a rolled-back offline scenario, never testimony writes.
BEGIN;
UPDATE public.vehicles SET sale_status='not_sold';
UPDATE public.vehicle_events SET ended_at=now()-interval '10 minutes';
DELETE FROM public.monitored_auctions;
DO $$ DECLARE reading jsonb; BEGIN
  reading:=public.bat_live_pull_run(3);
  RAISE NOTICE 'offline recovery scheduler: %; source eligibility: %', reading,
    (SELECT jsonb_agg(jsonb_build_object(
      'event_type',e.event_type,'event_platform',e.source_platform,'vehicle_platform',v.platform_source,
      'source_origin',v.origin_metadata->>'source','native_post',v.origin_metadata->>'external_id',
      'source_matches',rtrim(v.listing_url,'/')=rtrim(e.source_url,'/'),
      'recent_end',e.ended_at>now()-interval '24 hours','closing_end',e.ended_at<=now()+interval '15 minutes',
      'terminal_outcome',EXISTS(SELECT 1 FROM auction_events a WHERE a.vehicle_id=e.vehicle_id
        AND rtrim(a.source_url,'/')=rtrim(e.source_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled'))))
      FROM vehicle_events e JOIN vehicles v ON v.id=e.vehicle_id);
  ASSERT (reading->>'stream_lots')::integer=1,
    'known unresolved source enters the existing stream independently of board status';
  ASSERT (SELECT count(*)=1 AND bool_and(is_live) FROM public.monitored_auctions),
    'one canonical monitor is recovered without minting a new vehicle';
  ASSERT EXISTS(SELECT 1 FROM net.calls WHERE body->>'mode'='live_stream'),
    'reconciled inventory reaches the existing automatic native worker';
END $$;
ROLLBACK;

SET ROLE service_role;
SELECT public.ingest_bat_live_events((SELECT jsonb_agg(f)
  FROM public.fixture_frames CROSS JOIN LATERAL jsonb_array_elements(doc->'frames') f
  WHERE f->>'kind'='sale_result'),'[]'::jsonb);
RESET ROLE;
DO $$ DECLARE reading jsonb; BEGIN
  reading:=public.get_live_auction_health('2026-10-04'::date)->'daily_closes';
  ASSERT (reading->>'expected_known_lots')::integer=1 AND
    (reading->>'confirmed_closed_lots')::integer=1,'native result settles exactly one known lot';
  ASSERT (reading->>'sold_lots')::integer=1,'source sale qualifies sold';
  ASSERT (reading->>'unresolved_lots')::integer=0,'source admission closes the result gap';
  ASSERT (reading->>'native_terminal_receipt_lots')::integer=1,'result has its independently admitted native receipt';
  ASSERT (reading->>'late_native_terminal_admission_lots')::integer=1,
    'hours-later fixture replay is explicitly late admission, never live capture';
  ASSERT reading->>'source_inventory_completeness'='unverified','known inventory never claims all-source enumeration';
  ASSERT reading->>'continuous_capture_completeness' LIKE 'unverified%',
    'a recovered result never certifies historical continuous capture';
  ASSERT reading->>'status'='passed','known result reconciliation passes';
  ASSERT reading->>'terminal_capture_status'='failed','late recovery fails native terminal capture';
  ASSERT public.get_live_auction_health('2026-10-04'::date)#>>'{closing_stream,status}'='failed',
    'settled results cannot hide a historical capture failure from job health';
END $$;

-- Derived control fixtures only; source testimony remains unchanged.
BEGIN;
INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live,stream_state)
SELECT source_id,'same-source-alias',external_auction_url||'/',vehicle_id,auction_end_time,false,stream_state
FROM public.monitored_auctions;
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04'::date)#>>'{daily_closes,expected_known_lots}')::integer=1,
    'trailing slash monitor alias and both caches count once';
END $$;
ROLLBACK;

BEGIN;
INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live)
SELECT source_id,'another-episode','https://bringatrailer.com/listing/another-episode-fixture',vehicle_id,
  '2026-10-04T19:00:00Z',false FROM public.monitored_auctions;
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-10-04'::date)#>>'{daily_closes,unresolved_lots}')::integer=1,
    'same vehicle sold in another source episode cannot settle a missing episode';
  ASSERT public.get_live_auction_health('2026-10-04'::date)#>>'{closing_stream,status}'='failed',
    'clock-retired unresolved lot still fails health';
END $$;
ROLLBACK;

BEGIN;
INSERT INTO public.monitored_auctions(source_id,external_auction_id,external_auction_url,vehicle_id,auction_end_time,is_live)
SELECT m.source_id,'dst-'||v.n,'https://bringatrailer.com/listing/dst-fixture-'||v.n,m.vehicle_id,v.ends,false
FROM public.monitored_auctions m CROSS JOIN (VALUES
  (1,'2026-11-01T07:30:00Z'::timestamptz),
  (2,'2026-11-02T07:30:00Z'::timestamptz),
  (3,'2026-11-02T08:30:00Z'::timestamptz)) v(n,ends);
DO $$ BEGIN
  ASSERT (public.get_live_auction_health('2026-11-01'::date)#>>'{daily_closes,expected_known_lots}')::integer=2,
    'Pacific fall-back day spans 25 hours';
  ASSERT (public.get_live_auction_health('2026-11-02'::date)#>>'{daily_closes,expected_known_lots}')::integer=1,
    'next local day begins at its own midnight';
END $$;
ROLLBACK;

DO $$ BEGIN
  ASSERT public.get_live_auction_health('2030-01-01'::date)#>>'{daily_closes,status}'='idle',
    'empty known inventory stays idle';
  ASSERT public.get_live_auction_health('2030-01-01'::date)#>>'{daily_closes,source_inventory_completeness}'='unverified',
    'empty is not proof of no source auctions';
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_live_auction_health(date)'::regprocedure),
    'dated overload retains caller table privileges';
END $$;
SET ROLE anon;
DO $$ DECLARE denied boolean:=false; BEGIN
  ASSERT public.get_live_auction_health() ? 'daily_closes','existing no-argument public contract remains readable';
  BEGIN PERFORM public.get_live_auction_health('2026-10-04'::date);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  ASSERT denied,'dated overload grants no new table access';
END $$;
RESET ROLE;
SELECT 'daily close reconciliation passed';
