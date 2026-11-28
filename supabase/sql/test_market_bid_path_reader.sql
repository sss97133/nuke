-- Disposable PG17 only. No production source, scheduled fold, inference or worker calls.
\set ON_ERROR_STOP on
\timing on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF; END $$;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF;
END LOOP; END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,
 merged_into_vehicle_id uuid REFERENCES vehicles(id),status text,listing_kind text);
CREATE TABLE auction_events(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),source text,source_url text,
 auction_end_date timestamptz,currency_code text,currency_source text,price_basis text,price_kind text,
 price_kind_source text,price_basis_conflict boolean,winning_bid numeric,outcome text,canonical boolean DEFAULT true);
CREATE VIEW auction_events_canonical WITH(security_invoker=true) AS SELECT * FROM auction_events WHERE canonical;
CREATE TABLE external_identities(id uuid PRIMARY KEY,platform text);
CREATE TABLE auction_comments(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),
 auction_event_id uuid REFERENCES auction_events(id),comment_type text,bid_amount numeric,
 posted_at timestamptz,created_at timestamptz,external_identity_id uuid REFERENCES external_identities(id),bat_comment_id bigint,source_url text);
CREATE INDEX ON auction_comments(auction_event_id);
CREATE INDEX ON auction_events(source,source_url);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_parent ON vehicles FOR SELECT USING(is_public);
ALTER TABLE auction_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_comment_read ON auction_comments FOR SELECT USING(true);
GRANT SELECT ON vehicles,auction_events,auction_events_canonical,external_identities,auction_comments TO anon,authenticated,service_role;
CREATE FUNCTION lot_order_book_read(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('legacy',$1) $$;
CREATE TEMP TABLE legacy_body AS SELECT prosrc,proacl FROM pg_proc WHERE oid='lot_order_book_read(uuid)'::regprocedure;
CREATE TABLE fixture_clock(t timestamptz);INSERT INTO fixture_clock VALUES(now()-interval '1 day');
SET statement_timeout='3s';SET lock_timeout='1s';
\ir ../migrations/20261128060305_market_bid_path_reader.sql
\ir ../migrations/20261128060305_market_bid_path_reader.sql
CREATE FUNCTION pg_temp.check_it(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.check_it((SELECT p.prosrc=b.prosrc AND p.proacl IS NOT DISTINCT FROM b.proacl FROM pg_proc p CROSS JOIN legacy_body b
 WHERE p.oid='lot_order_book_read(uuid)'::regprocedure),'legacy body and ACL preserved');
SELECT pg_temp.check_it(NOT(SELECT prosecdef FROM pg_proc WHERE oid='lot_order_book_read(uuid,jsonb)'::regprocedure),'invoker reader');
SELECT pg_temp.check_it(NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl)x
 WHERE p.oid='lot_order_book_read(uuid,jsonb)'::regprocedure AND x.grantee=0),'no PUBLIC execute');
INSERT INTO vehicles VALUES
 ('10000000-0000-4000-8000-000000000001',true,null,null,null,null),
 ('10000000-0000-4000-8000-000000000002',false,null,null,null,null),
 ('10000000-0000-4000-8000-000000000003',true,now(),null,null,null),
 ('10000000-0000-4000-8000-000000000004',true,null,null,'merged',null),
 ('10000000-0000-4000-8000-000000000005',true,null,null,null,'non_vehicle_item'),
 ('10000000-0000-4000-8000-000000000006',true,null,null,null,null);
INSERT INTO auction_events(id,vehicle_id,source,source_url,auction_end_date)
 SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bat',
 CASE WHEN g<=2 THEN 'https://bringatrailer.com/listing/native-bid-path/' ELSE 'https://bringatrailer.com/listing/native-path-'||g||'/' END,t
 FROM generate_series(1,6)g CROSS JOIN fixture_clock;
INSERT INTO external_identities VALUES ('90000000-0000-4000-8000-000000000001','bat'),
 ('90000000-0000-4000-8000-000000000002','bat'),('90000000-0000-4000-8000-000000000003','cars_and_bids');
INSERT INTO auction_comments
 SELECT ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 CASE WHEN g=9 THEN 'observation' ELSE 'bid' END,
 CASE g WHEN 1 THEN 100 WHEN 2 THEN 200 WHEN 3 THEN 300 WHEN 4 THEN 350 WHEN 5 THEN 325 WHEN 6 THEN 400 WHEN 7 THEN 450 WHEN 8 THEN null ELSE 500 END,
 CASE g WHEN 1 THEN t-interval '60 minutes' WHEN 2 THEN t-interval '30 minutes' WHEN 3 THEN t-interval '10 minutes'
   WHEN 4 THEN t-interval '5 minutes' WHEN 5 THEN t-interval '5 minutes' WHEN 6 THEN null ELSE t-interval '2 minutes' END,
 CASE g WHEN 1 THEN t-interval '59 minutes' WHEN 2 THEN t+interval '5 minutes' WHEN 3 THEN t-interval '9 minutes'
   WHEN 4 THEN t-interval '4 minutes' WHEN 5 THEN t-interval '4 minutes' WHEN 7 THEN null ELSE t-interval '1 minute' END,
 CASE WHEN g IN(1,3) THEN '90000000-0000-4000-8000-000000000001'::uuid WHEN g IN(2,5) THEN '90000000-0000-4000-8000-000000000002'::uuid END,
 g,CASE WHEN g<6 THEN 'https://bringatrailer.com/listing/native-bid-path/#comment-'||g END
 FROM generate_series(1,9)g CROSS JOIN fixture_clock;
CREATE TEMP TABLE first_read AS SELECT lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')r;
SELECT pg_temp.check_it(r->>'state'='partial' AND jsonb_array_length(r->'states')=5
 AND r#>>'{states,4,price}'='350' AND r#>>'{states,4,second_best}'='325'
 AND r#>>'{states,4,entries}'='3' AND r#>>'{states,4,identities}'='2'
 AND r#>>'{states,4,unresolved_entries}'='1' AND r#>>'{states,4,depth_90}'='2' AND r#>>'{states,4,depth_75}'='3',
 'hand-calculated current bid path, repeated identities and lower later bid') FROM first_read;
SELECT pg_temp.check_it(r#>>'{states,4,price_change}'='0' AND r#>>'{states,4,top_two_gap}'='25'
 AND r#>'{states,0,price_change}'='null','high-bid change and distinct-entry top-two gap') FROM first_read;
SELECT pg_temp.check_it(r#>>'{book,1,bid_count}'='2' AND r#>>'{book,1,depth_at_revealed_bid}'='2'
 AND r#>>'{book,1,first_bid_comment_id}'='30000000-0000-4000-8000-000000000002'
 AND r#>>'{book,1,last_bid_comment_id}'='30000000-0000-4000-8000-000000000005'
 AND r#>>'{book,1,highest_bid_comment_id}'='30000000-0000-4000-8000-000000000005',
 'book values name their exact first/last/highest source bids and depth') FROM first_read;
BEGIN;
UPDATE auction_comments SET bid_amount=350 WHERE id='30000000-0000-4000-8000-000000000005';
UPDATE auction_comments SET bid_amount=300 WHERE id='30000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE tied_book AS SELECT lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')r;
SELECT pg_temp.check_it(r#>>'{book,0,depth_at_revealed_bid}'='2' AND r#>>'{book,1,depth_at_revealed_bid}'='2'
 AND r#>>'{states,4,top_two_gap}'='0' AND r#>>'{book,2,highest_bid_comment_id}'='30000000-0000-4000-8000-000000000001',
 'ties share inclusive depth and repeated maximum keeps earliest source bid') FROM tied_book;
ROLLBACK;
SELECT pg_temp.check_it(r#>>'{coverage,bid_marked_unknown_event_time}'='1' AND r#>>'{coverage,bid_marked_unknown_recording_time}'='1'
 AND r#>>'{coverage,bid_marked_unknown_amounts}'='1' AND r#>>'{coverage,amount_without_bid_label}'='1'
 AND r#>>'{summary,bids_in_60_minutes_to_event_cutoff}'='4' AND r#>>'{summary,bids_in_10_minutes_to_event_cutoff}'='2'
 AND r#>>'{amount_context,currency_state}'='unknown' AND r#>'{amount_context,currency_code}'='null'
 AND r->>'historical_forecast_receipt'='false' AND r->>'final_sale_price_used_as_input'='false',
 'coverage gaps, exact open-lower trailing windows and no invented units') FROM first_read;
CREATE TEMP TABLE pinned_request AS SELECT jsonb_build_object('snapshot_hash',r->>'snapshot_hash',
 'event_cutoff',r->>'event_cutoff','recorded_cutoff',r->>'recorded_cutoff')q FROM first_read;
CREATE TEMP TABLE selected_read AS SELECT lot_order_book_read('20000000-0000-4000-8000-000000000001',q||
 jsonb_build_object('selected_bid_comment_id','30000000-0000-4000-8000-000000000003'))r FROM pinned_request;
SELECT pg_temp.check_it(r->>'selected_seq'='3' AND jsonb_array_length(r->'book')=2
 AND (SELECT count(*) FROM jsonb_array_elements(r->'book') b CROSS JOIN LATERAL jsonb_array_elements(b->'supporting_bid_comment_ids'))=3
 AND r->>'snapshot_hash'=(SELECT r->>'snapshot_hash' FROM first_read),'selected source bid keeps same snapshot and source support') FROM selected_read;
CREATE TEMP TABLE reconstructed AS SELECT lot_order_book_read('20000000-0000-4000-8000-000000000001',
 jsonb_build_object('knowledge_mode','recorded_input_reconstruction','cutoff',t-interval '8 minutes'))r FROM fixture_clock;
SELECT pg_temp.check_it(r->>'knowledge_mode'='recorded_input_reconstruction' AND jsonb_array_length(r->'states')=2
 AND r#>>'{states,1,price}'='300' AND r#>>'{states,1,identities}'='1' AND r#>'{states,1,second_best}'='null'
 AND r#>>'{coverage,posted_bids_recorded_after_cutoff}'='1','late-arrival bidder is excluded before recomputing the whole book') FROM reconstructed;
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001',
 jsonb_build_object('knowledge_mode','recorded_input_reconstruction','cutoff',t-interval '8 minutes',
 'selected_bid_comment_id','30000000-0000-4000-8000-000000000002'))->>'reason'='selected_bid_not_in_known_inputs','unknown-at-cutoff bid cannot be selected') FROM fixture_clock;
BEGIN;
UPDATE auction_comments SET bid_amount=300.25 WHERE id='30000000-0000-4000-8000-000000000003';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001',q)->>'reason'='evidence_snapshot_changed','source change refuses old snapshot') FROM pinned_request;
ROLLBACK;
BEGIN;
UPDATE auction_events SET winning_bid=999999,outcome='sold';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001',q)->>'snapshot_hash'=q->>'snapshot_hash','final result does not enter features or fingerprint') FROM pinned_request;
ROLLBACK;
BEGIN;
UPDATE auction_events SET currency_code='EUR',currency_source='synthetic cited page' WHERE id='20000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001',q)->>'reason'='evidence_snapshot_changed','current unit qualification binds snapshot') FROM pinned_request;
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')#>>'{amount_context,currency_state}'='recorded_claim','cited recorded currency preserved without conversion');
ROLLBACK;
DO $$ DECLARE g int;r jsonb; BEGIN
 FOR g IN 2..5 LOOP r:=lot_order_book_read(('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'{}');
  PERFORM pg_temp.check_it(r->>'reason'='unknown_or_ineligible_episode','private/deleted/merged/nonvehicle gate'); END LOOP;
END $$;
BEGIN;
UPDATE auction_events SET source_url='https://bringatrailer.com/listing/native-bid-path' WHERE id='20000000-0000-4000-8000-000000000006';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='ambiguous_source_episode','competing public binding refuses');ROLLBACK;
BEGIN;
UPDATE auction_comments SET vehicle_id='10000000-0000-4000-8000-000000000002' WHERE id='30000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='conflicting_comment_source_relation','valid individual keys with wrong parent refuse');ROLLBACK;
BEGIN;
UPDATE auction_comments SET source_url='https://bringatrailer.com/listing/wrong/' WHERE id='30000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='conflicting_comment_source_relation','conflicting source URL refuses');ROLLBACK;
BEGIN;
UPDATE auction_comments SET external_identity_id='90000000-0000-4000-8000-000000000003' WHERE id='30000000-0000-4000-8000-000000000004';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')#>>'{coverage,eligible_bids_with_other_platform_key}'='1','other platform key stays unresolved');ROLLBACK;
DO $$ DECLARE amount numeric;reason text; BEGIN FOREACH amount IN ARRAY ARRAY[-1::numeric,'NaN'::numeric,'Infinity'::numeric,1.0000001::numeric] LOOP
 UPDATE auction_comments SET bid_amount=amount WHERE id='30000000-0000-4000-8000-000000000001';
 reason:=lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason';
 PERFORM pg_temp.check_it(reason=CASE WHEN amount=-1 THEN 'negative_bid_amount' ELSE 'bid_amount_representation_unsupported' END,'unsafe source amount refuses');
 END LOOP;UPDATE auction_comments SET bid_amount=100 WHERE id='30000000-0000-4000-8000-000000000001';END $$;
BEGIN;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,bid_amount,posted_at,created_at)
 SELECT ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','bid',1000+g,t-interval '7 minutes'+g*interval '0.3 seconds',t-interval '7 minutes'+g*interval '0.3 seconds'
 FROM generate_series(1,495)g CROSS JOIN fixture_clock;
CREATE TEMP TABLE maximum_path AS SELECT lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')r;
SELECT pg_temp.check_it(jsonb_array_length(r->'states')=500 AND jsonb_array_length(r->'book')=498,'500-bid worst-case distinct-entry boundary within caller budget') FROM maximum_path;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,bid_amount,posted_at,created_at)
 SELECT '40000000-0000-4000-8000-000000000999','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','bid',2000,t,t FROM fixture_clock;
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='bid_state_limit_exceeded','501 bids refuses before state matrix');ROLLBACK;
BEGIN;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type)
 SELECT ('50000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','observation' FROM generate_series(1,4991)g;
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')#>>'{coverage,keyed_source_rows}'='5000','5000-row boundary preserves measured population');
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type) VALUES('50000000-0000-4000-8000-000000009999','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','observation');
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='comment_input_limit_exceeded','5001 source rows refuses');ROLLBACK;
BEGIN;
UPDATE auction_comments SET source_url=repeat('x',4194305) WHERE id='30000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'reason'='source_locator_size_exceeded','locator byte limit precedes patterns and serialization');ROLLBACK;
DO $$ DECLARE q jsonb;BEGIN FOREACH q IN ARRAY ARRAY['null'::jsonb,'[]'::jsonb,'{"extra":1}'::jsonb,'{"selected_bid_comment_id":"bad"}'::jsonb,
 '{"knowledge_mode":"future"}'::jsonb,'{"cutoff":"tomorrow"}'::jsonb,'{"snapshot_hash":"bad"}'::jsonb] LOOP
 PERFORM pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001',q)->>'state'='unavailable','malformed requests refuse');END LOOP;END $$;
SET ROLE anon;
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000001','{}')->>'state'='partial','anonymous public reader');
SELECT pg_temp.check_it(lot_order_book_read('20000000-0000-4000-8000-000000000002','{}')->>'reason'='unknown_or_ineligible_episode','anonymous private refusal');RESET ROLE;
SELECT pg_temp.check_it(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','caller budgets unchanged');

-- Independent imperative reference: walk bids once, update per-entry maxima, compare every returned state.
-- This deliberately does not reuse the reader's bid x bid matrix or aggregation CTEs.
CREATE FUNCTION pg_temp.simulate_bid_path(s integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t timestamptz;r jsonb;request jsonb;mode integer;event_to timestamptz;recorded_to timestamptz;
 row record;k text;levels jsonb;known jsonb;n integer;peak numeric;previous_peak numeric;second numeric;entries bigint;identities bigint;d90 bigint;d75 bigint;state jsonb;
BEGIN
 SELECT c.t INTO t FROM fixture_clock c;
 DELETE FROM auction_comments WHERE auction_event_id='20000000-0000-4000-8000-000000000006';
 INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,bid_amount,posted_at,created_at,external_identity_id,bat_comment_id)
 SELECT ('60000000-0000-4000-8000-'||lpad((s*100+g)::text,12,'0'))::uuid,
  '10000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','bid',round(((s*31+g*17)%500+1)::numeric/4,2),
  t-((20-g)/2)*interval '1 minute',t-((20-g)/2)*interval '1 minute'+CASE WHEN (s+g)%4=0 THEN interval '45 minutes' ELSE interval '30 seconds' END,
  CASE (s*13+g*7)%5 WHEN 0 THEN '90000000-0000-4000-8000-000000000001'::uuid WHEN 1 THEN '90000000-0000-4000-8000-000000000002'::uuid
   WHEN 2 THEN '90000000-0000-4000-8000-000000000003'::uuid END,g%7
 FROM generate_series(1,20)g;
 FOR mode IN 0..1 LOOP
  request:=CASE WHEN mode=0 THEN '{}'::jsonb ELSE jsonb_build_object('knowledge_mode','recorded_input_reconstruction','cutoff',t-interval '3 minutes') END;
  r:=lot_order_book_read('20000000-0000-4000-8000-000000000006',request);
  PERFORM pg_temp.check_it(r->>'state'='partial','simulation reader is supported');
  event_to:=(r->>'event_cutoff')::timestamptz;recorded_to:=(r->>'recorded_cutoff')::timestamptz;
  levels:='{}';known:='{}';n:=0;peak:=0;
  FOR row IN SELECT c.* FROM auction_comments c WHERE c.auction_event_id='20000000-0000-4000-8000-000000000006'
   AND c.posted_at BETWEEN t-interval '14 days' AND event_to AND c.created_at<=recorded_to
   ORDER BY c.posted_at,coalesce(c.bat_comment_id,0),(c.id::text) COLLATE "C" LOOP
   n:=n+1;
   k:=CASE WHEN row.external_identity_id IN('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002')
     THEN row.external_identity_id::text ELSE row.id::text END;
   levels:=jsonb_set(levels,ARRAY[k],to_jsonb(greatest(coalesce((levels->>k)::numeric,0),row.bid_amount)));
   IF k=row.external_identity_id::text THEN known:=jsonb_set(known,ARRAY[k],'true');END IF;
   previous_peak:=peak;peak:=greatest(peak,row.bid_amount);
   SELECT count(*),(array_agg(value::numeric ORDER BY value::numeric DESC))[2],
    count(*) FILTER(WHERE value::numeric>=peak*0.9),count(*) FILTER(WHERE value::numeric>=peak*0.75)
    INTO entries,second,d90,d75 FROM jsonb_each_text(levels);
   SELECT count(*) INTO identities FROM jsonb_object_keys(known);
   state:=r->'states'->(n-1);
   PERFORM pg_temp.check_it(state->>'bid_comment_id'=row.id::text AND (state->>'amount')::numeric=row.bid_amount
    AND (state->>'price')::numeric=peak AND (state->>'second_best')::numeric IS NOT DISTINCT FROM second
    AND (state->>'entries')::bigint=entries AND (state->>'identities')::bigint=identities
    AND (state->>'unresolved_entries')::bigint=entries-identities AND (state->>'depth_90')::bigint=d90 AND (state->>'depth_75')::bigint=d75
    AND (state->>'price_change')::numeric IS NOT DISTINCT FROM CASE WHEN n>1 THEN peak-previous_peak END
    AND (state->>'top_two_gap')::numeric IS NOT DISTINCT FROM peak-second,
    'independent simulation state agrees: scenario '||s||', mode '||mode||', state '||n);
  END LOOP;
  PERFORM pg_temp.check_it(jsonb_array_length(r->'states')=n AND jsonb_array_length(r->'book')=entries::integer,'simulation full path/book cardinality');
 END LOOP;
END $$;
SELECT format('SELECT pg_temp.simulate_bid_path(%s);',s) FROM generate_series(1,32)s \gexec
