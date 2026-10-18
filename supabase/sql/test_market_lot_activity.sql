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
  platform_source text DEFAULT 'bringatrailer', auction_end_date text,
  year integer DEFAULT 1970, make text DEFAULT 'SYNTHETIC', model text DEFAULT 'FIXTURE',
  high_bid integer DEFAULT 1500, sale_price integer, canonical_make_id uuid,
  updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  primary_image_url text, origin_metadata jsonb DEFAULT '{}', title text
);
CREATE TABLE auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text DEFAULT 'bat', source_url text,
  scraped_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), raw_data jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now(), high_bid numeric DEFAULT 1500, outcome text DEFAULT 'live',
  auction_end_date timestamptz DEFAULT (now()+interval '1 day')
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
CREATE POLICY private_owner_vehicle ON vehicles FOR SELECT TO authenticated USING(id='00000000-0000-0000-0000-000000000002');
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_events ON auction_events FOR SELECT TO anon,authenticated USING(true);
ALTER TABLE auction_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_comments ON auction_comments FOR SELECT TO anon,authenticated USING(true);
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT ON vehicles,auction_events,auction_comments TO anon,authenticated;
ALTER ROLE service_role BYPASSRLS;
CREATE TABLE canonical_makes(id uuid PRIMARY KEY, canonical_name text);
CREATE TABLE hammer_predictions(vehicle_id uuid, model_version integer, predicted_low numeric, predicted_hammer numeric,
  predicted_high numeric, price_tier text, comp_count integer, predicted_at timestamptz DEFAULT now());
ALTER TABLE hammer_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hammer_predictions_live_bands_read ON hammer_predictions FOR SELECT TO anon,authenticated USING(model_version=31);
CREATE TABLE market_indexes(id uuid PRIMARY KEY, index_code text);
CREATE TABLE market_index_values(index_id uuid, value_date date, components_snapshot jsonb, calculation_metadata jsonb);
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;

INSERT INTO vehicles(id,listing_url,auction_end_date)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  'https://bringatrailer.com/listing/current-'||i, (now()+interval '1 day')::text FROM generate_series(1,20) i;
INSERT INTO vehicles(id,listing_url,auction_end_date,is_public) VALUES
  ('00000000-0000-0000-0000-000000000021','https://bringatrailer.com/listing/visibility-unknown',(now()+interval '1 day')::text,NULL);
UPDATE vehicles SET is_public=false WHERE id::text LIKE '%000002';
UPDATE vehicles SET deleted_at=now() WHERE id::text LIKE '%000003';
UPDATE vehicles SET listing_kind='non_vehicle_item' WHERE id::text LIKE '%000004';
UPDATE vehicles SET sale_status='sold' WHERE id::text LIKE '%000005';
UPDATE vehicles SET platform_source='other' WHERE id::text LIKE '%000006';
UPDATE vehicles SET high_bid=1700 WHERE id::text LIKE '%000007';
UPDATE vehicles SET year=NULL,make=NULL,model=NULL WHERE id::text LIKE '%000020';
UPDATE vehicles SET origin_metadata='{"currency":"USD","last_sync":"2026-10-04T00:00:00Z"}';

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
\ir ../migrations/20260927193000_market_pulse_live_board.sql
\ir ../migrations/20260928000000_live_heat_bands_v31.sql

CREATE FUNCTION assert_contract(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
SET ROLE anon;
SELECT assert_contract(jsonb_array_length(market_pulse_live()->'auctions')=17,'old public board reproduces two ineligible lot contributions');
RESET ROLE;
\ir ../migrations/20261004061500_market_board_eligibility_bid_receipt.sql
SET ROLE anon;
SELECT assert_contract(jsonb_array_length(market_pulse_live()->'auctions')=15,'board excludes deleted and nonvehicle lots before aggregation');
SELECT assert_contract((SELECT bool_and(jsonb_array_length(a)=17) FROM jsonb_array_elements(market_pulse_live()->'auctions') a),'compact board preserves seventeen positions');
SELECT assert_contract((SELECT count(*) FROM jsonb_array_elements(market_pulse_live()->'auctions') a WHERE a->>0='00000000-0000-0000-0000-000000000020')=1,'unknown make/year on a real public vehicle remains eligible');
SELECT assert_contract(NOT has_table_privilege('anon','auction_events','UPDATE'),'public caller cannot forge bound source bid');
CREATE TEMP TABLE receipt AS SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],2) d;
SELECT assert_contract((d->>'eligible_lots')::int=1,'public eligible current lot') FROM receipt;
SELECT assert_contract((d->'lots'->0->>'activity_rows')::int=2 AND (d->'lots'->0->>'has_more')::boolean,'per-lot cap and truncation') FROM receipt;
SELECT assert_contract(d->'lots'->0->>'source_read_basis'='direct_fetch','direct source clock exposed') FROM receipt;
SELECT assert_contract(d->'lots'->0->'source_read_at' <> 'null'::jsonb,'versioned actual source clock present') FROM receipt;
SELECT assert_contract(d->'lots'->0->'source_bid_amount'='null'::jsonb AND d->'lots'->0->>'source_bid_match'='unknown','legacy valid clock does not prove an unbound bid amount') FROM receipt;
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
SELECT assert_contract(jsonb_array_length(market_pulse_live()->'auctions')=15,'authenticated owner private row cannot enter public board');
SET ROLE service_role;
SELECT assert_contract(jsonb_array_length(market_pulse_live()->'auctions')=15,'privileged board still enforces explicit public scope');
RESET ROLE;
UPDATE auction_events SET high_bid=1600 WHERE vehicle_id::text LIKE '%000007';
UPDATE auction_events SET raw_data=raw_data || jsonb_build_object('listing_url',source_url,'source_read',
  raw_data->'source_read' || jsonb_build_object('bid_amount_version',1,'bid_amount',high_bid))
  WHERE vehicle_id::text LIKE '%000001' OR vehicle_id::text LIKE '%000007';
UPDATE auction_events SET scraped_at=now(),raw_data=jsonb_build_object('extractor','extract-bat-core','source_read',
  jsonb_build_object('clock_version',1,'at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'basis','direct_fetch',
    'bid_amount_version',1,'bid_amount',high_bid),'listing_url',source_url),updated_at=now()
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
SELECT assert_contract(NOT prosecdef,'board remains SECURITY INVOKER') FROM pg_proc WHERE oid='market_pulse_live()'::regprocedure;
SELECT assert_contract(NOT has_function_privilege('public','market_pulse_live()','EXECUTE'),'board PUBLIC execute remains revoked');
SELECT assert_contract(has_function_privilege('authenticated','market_pulse_live()','EXECUTE') AND has_function_privilege('service_role','market_pulse_live()','EXECUTE'),'existing board read grants preserved');

-- Source bid proof is forward-bound to the same clock, URL, live phase and exact typed price.
SET ROLE anon;
SELECT assert_contract((d->'lots'->0->>'source_bid_amount')::numeric=1500 AND (d->'lots'->0->>'current_bid_at_capture')::numeric=1500
  AND d->'lots'->0->>'source_bid_match'='matched' AND d->'lots'->0->'source_bid_ingested_at'<>'null'::jsonb,
  'bound direct bid agrees with current bid at capture') FROM (SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) d) q;
SELECT assert_contract(d->'lots'->0->'source_bid_currency'='null'::jsonb AND d->'lots'->0->'current_bid_currency_at_capture'='null'::jsonb
  AND d->'lots'->0->>'source_bid_match_basis'='numeric_amount_only_currency_unverified',
  'unversioned currency metadata does not prove USD or money agreement') FROM (SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) d) q;
SELECT assert_contract((d->'lots'->0->>'source_bid_amount')::numeric=1600 AND (d->'lots'->0->>'current_bid_at_capture')::numeric=1700
  AND d->'lots'->0->>'source_bid_match'='mismatched' AND (d->'lots'->0->>'source_read_at')::timestamptz<now()-interval '23 hours',
  'cached alias bid retains old source clock and explicit mismatch') FROM (SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000007'::uuid]) d) q;
RESET ROLE;
UPDATE vehicles SET high_bid=1600 WHERE id::text LIKE '%000001';
SET ROLE anon;
SELECT assert_contract((d->'lots'->0->>'source_bid_amount')::numeric=1500 AND d->'lots'->0->>'source_bid_match'='mismatched',
  'later canonical bid change preserves source value and explicit mismatch') FROM (SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) d) q;
RESET ROLE;
UPDATE vehicles SET high_bid=NULL WHERE id::text LIKE '%000001';
SET ROLE anon;
SELECT assert_contract((d->'lots'->0->>'source_bid_amount')::numeric=1500 AND d->'lots'->0->'current_bid_at_capture'='null'::jsonb
  AND d->'lots'->0->>'source_bid_match'='unknown','missing canonical amount is unknown agreement, not zero')
  FROM (SELECT market_lot_activity(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]) d) q;
RESET ROLE;
UPDATE vehicles SET high_bid=1500 WHERE id::text LIKE '%000001';
CREATE FUNCTION bid_proof_unknown(id uuid,label text) RETURNS void LANGUAGE sql AS $$
  SELECT assert_contract(d->'lots'->0->'source_bid_amount'='null'::jsonb AND d->'lots'->0->>'source_bid_match'='unknown',label)
  FROM (SELECT market_lot_activity(ARRAY[id]) d) q;
$$;
UPDATE auction_events SET high_bid=1601 WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','later partial bid mutation cannot inherit older amount clock');
UPDATE auction_events SET high_bid=1500,raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','"1500"') WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','text amount marker is not numeric evidence');
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','1500') WHERE vehicle_id::text LIKE '%000001';
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{listing_url}','"https://bringatrailer.com/listing/previous-auction"') WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','amount receipt from prior source URL cannot prove current bid');
UPDATE auction_events SET raw_data=jsonb_set(raw_data,'{listing_url}',to_jsonb(source_url)),outcome='sold' WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','completed transaction amount is not current live bid');
UPDATE auction_events SET outcome='live',auction_end_date=now()-interval '1 hour' WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','source episode with unsupported future close has unknown current bid');
UPDATE auction_events SET auction_end_date=now()+interval '1 day',updated_at=now()+interval '1 day' WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','future source-row ingest cannot enter as-of bid proof');
UPDATE auction_events SET updated_at=now(),high_bid=0,raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','0') WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','zero source amount remains unknown rather than an invented bid');
UPDATE auction_events SET high_bid='NaN',raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','"NaN"') WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','nonfinite source amount stays unknown');
UPDATE auction_events SET high_bid=1500,raw_data=jsonb_set(raw_data,'{source_read,bid_amount}','1500') WHERE vehicle_id::text LIKE '%000001';
INSERT INTO auction_events(vehicle_id,source_url,scraped_at,updated_at,high_bid,raw_data)
SELECT vehicle_id,source_url||'/',scraped_at,updated_at,1600,jsonb_set(jsonb_set(raw_data,'{source_read,bid_amount}','1600'),'{listing_url}',to_jsonb(source_url||'/'))
FROM auction_events WHERE vehicle_id::text LIKE '%000001';
SELECT bid_proof_unknown('00000000-0000-0000-0000-000000000001','conflicting current URL aliases at the same source clock stay unknown');
