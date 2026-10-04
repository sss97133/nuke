-- Disposable PG17 contract fixture. Applies the actual migration; never run on production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Requires disposable dm_refinement_ database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE vehicles (
  id uuid PRIMARY KEY, listing_url text, is_public boolean DEFAULT true, deleted_at timestamptz,
  listing_kind text DEFAULT 'vehicle', sale_status text DEFAULT 'auction_live',
  platform_source text DEFAULT 'bringatrailer', auction_end_date text
);
CREATE TABLE auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text DEFAULT 'bat', source_url text,
  scraped_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), raw_data jsonb DEFAULT '{}'
);
CREATE UNIQUE INDEX ON auction_events(vehicle_id,source_url);
CREATE TABLE auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, posted_at timestamptz,
  created_at timestamptz DEFAULT now(), comment_type text DEFAULT 'bid', bid_amount numeric,
  bat_comment_id bigint, sequence_number integer
);
CREATE INDEX ON auction_comments(vehicle_id);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicles ON vehicles FOR SELECT TO anon,authenticated USING(is_public);
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_events ON auction_events FOR SELECT TO anon,authenticated USING(true);
ALTER TABLE auction_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_comments ON auction_comments FOR SELECT TO anon,authenticated USING(true);
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT ON vehicles,auction_events,auction_comments TO anon,authenticated;

INSERT INTO vehicles(id,listing_url,auction_end_date)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  'https://bringatrailer.com/listing/current-'||i, (now()+interval '1 day')::text FROM generate_series(1,20) i;
UPDATE vehicles SET is_public=false WHERE id::text LIKE '%000002';
UPDATE vehicles SET deleted_at=now() WHERE id::text LIKE '%000003';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE id::text LIKE '%000004';
UPDATE vehicles SET sale_status='sold' WHERE id::text LIKE '%000005';
UPDATE vehicles SET platform_source='other' WHERE id::text LIKE '%000006';

INSERT INTO auction_events(vehicle_id,source_url,scraped_at,raw_data)
SELECT id,listing_url,now()-interval '2 minutes',jsonb_build_object(
  'extractor','extract-bat-core','source_read',jsonb_build_object(
    'clock_version',1,'at',to_char((now()-interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'basis','direct_fetch')) FROM vehicles WHERE id::text LIKE '%000001';
INSERT INTO auction_events(vehicle_id,source_url,scraped_at,raw_data)
SELECT id,listing_url||'/',now()-interval '1 day',jsonb_build_object(
  'extractor','extract-bat-core','source_read',jsonb_build_object(
    'clock_version',1,'at',to_char((now()-interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'basis','cached_snapshot')) FROM vehicles WHERE id::text LIKE '%000007';
INSERT INTO auction_events(vehicle_id,source_url) SELECT id,listing_url FROM vehicles WHERE id::text LIKE '%000008';
INSERT INTO auction_events(vehicle_id,source_url,raw_data) SELECT id,listing_url,
  '{"extractor":"extract-bat-core","source_read":{"clock_version":1,"at":"bad","basis":"direct_fetch"}}'
  FROM vehicles WHERE id::text LIKE '%000009';

INSERT INTO auction_comments(vehicle_id,source_url,posted_at,bid_amount,bat_comment_id,sequence_number)
SELECT id,listing_url||CASE WHEN i%2=0 THEN '/' ELSE '' END,now()-i*interval '1 minute',1000+i*100,i,i
  FROM vehicles CROSS JOIN generate_series(2,5) i WHERE id::text LIKE '%000001';
-- One repeat of a source interaction is not another bid.
INSERT INTO auction_comments(vehicle_id,source_url,posted_at,bid_amount,bat_comment_id,sequence_number)
SELECT vehicle_id,source_url,posted_at,bid_amount,bat_comment_id,sequence_number FROM auction_comments LIMIT 1;
INSERT INTO auction_comments(vehicle_id,source_url,posted_at,bid_amount,bat_comment_id)
SELECT id,'https://bringatrailer.com/listing/previous-auction/',now()-interval '10 seconds',999999,100
FROM vehicles WHERE id::text LIKE '%000001';
INSERT INTO auction_comments(vehicle_id,posted_at,bid_amount,bat_comment_id)
SELECT id,now()-interval '10 seconds',999998,101 FROM vehicles WHERE id::text LIKE '%000001';
INSERT INTO auction_comments(vehicle_id,source_url,posted_at,created_at,bid_amount,bat_comment_id)
SELECT id,listing_url,now()-interval '10 seconds',now()+interval '1 day',999997,102
FROM vehicles WHERE id::text LIKE '%000001';
INSERT INTO auction_comments(vehicle_id,source_url,posted_at,bid_amount,bat_comment_id)
SELECT id,listing_url,now()+interval '1 day',999996,103 FROM vehicles WHERE id::text LIKE '%000001';

\ir ../migrations/20261004045916_market_lot_activity_source_clock.sql

CREATE FUNCTION assert_contract(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
SET ROLE anon;
CREATE TEMP TABLE receipt AS SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],2) d;
SELECT assert_contract((d->>'eligible_lots')::int=1,'public eligible current lot') FROM receipt;
SELECT assert_contract((d->'lots'->0->>'activity_rows')::int=2 AND (d->'lots'->0->>'has_more')::boolean,'per-lot cap and truncation') FROM receipt;
SELECT assert_contract(d->'lots'->0->>'source_read_basis'='direct_fetch','direct source clock exposed') FROM receipt;
SELECT assert_contract(d->'lots'->0->'source_read_at' <> 'null'::jsonb,'versioned actual source clock present') FROM receipt;
SELECT assert_contract(d ? 'as_of' AND (d->>'per_lot_limit')::int=2 AND (d->>'max_lots')::int=8,'as-of and bounds exposed') FROM receipt;
SELECT assert_contract((SELECT max((b->>'bid_amount')::numeric) FROM jsonb_array_elements(d->'lots'->0->'activity') b)<2000,'old lot/null URL/future event/future ingest excluded') FROM receipt;
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],40)->'lots'->0->>'activity_rows')::int=4,'URL aliases join and repeated source bid deduplicates');
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000007'::uuid])->'lots'->0->>'source_read_basis')='cached_snapshot','cached source provenance preserved');
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000007'::uuid])->'lots'->0->>'source_read_at')::timestamptz<now()-interval '23 hours','cached page is not stamped as a new read');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000008'::uuid])->'lots'->0->'source_read_at'='null'::jsonb,'legacy creation default remains unknown');
SELECT assert_contract(market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000009'::uuid])->'lots'->0->'source_read_at'='null'::jsonb,'invalid source marker remains unknown');
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-000000000005'::uuid,'00000000-0000-0000-0000-000000000006'::uuid])->>'eligible_lots')::int=0,'private/deleted/nonvehicle/closed/other-platform inputs denied');
SELECT assert_contract((market_lot_activity(NULL)->>'eligible_lots')::int=0,'NULL input safe');
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],999)->>'per_lot_limit')::int=40,'row cap clamped');
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],0)->>'per_lot_limit')::int=1,'positive minimum cap');
SELECT assert_contract((market_lot_activity(ARRAY(SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(10,20) i))->>'eligible_lots')::int=8,'maximum eight parent lots');
SELECT assert_contract((market_lot_activity(ARRAY(SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(10,20) i))->>'input_truncated')::boolean,'input truncation explicit');
SELECT assert_contract((market_lot_activity(array_fill('00000000-0000-0000-0000-000000000001'::uuid,ARRAY[8])||ARRAY['00000000-0000-0000-0000-000000000010'::uuid])->>'eligible_lots')::int=1,'duplicate inputs deduplicate and ninth raw input is excluded');
SET ROLE authenticated;
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000002'::uuid])->>'eligible_lots')::int=0,'private parent denied for authenticated public market reader');
RESET ROLE;
UPDATE auction_events SET scraped_at=now(),raw_data=jsonb_build_object('extractor','extract-bat-core','source_read',
  jsonb_build_object('clock_version',1,'at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'basis','direct_fetch'))
  WHERE vehicle_id='00000000-0000-0000-0000-000000000001';
SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type='Lock';
SET ROLE anon;
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid])->'lots'->0->>'source_read_at')::timestamptz>
  (d->'lots'->0->>'source_read_at')::timestamptz,'repeated actual direct read advances source clock') FROM receipt;
SELECT assert_contract((market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid])->'lots'->0->'activity'->0->>'posted_at')::timestamptz<now()-interval '1 minute','source clock update preserves bid event time');
RESET ROLE;
SELECT assert_contract(NOT prosecdef,'reader is SECURITY INVOKER') FROM pg_proc WHERE oid='market_lot_activity(uuid[],integer)'::regprocedure;
SELECT assert_contract(NOT has_function_privilege('public','market_lot_activity(uuid[],integer)','EXECUTE'),'PUBLIC execute revoked');
SELECT assert_contract(has_function_privilege('anon','market_lot_activity(uuid[],integer)','EXECUTE'),'anon public read permitted');
