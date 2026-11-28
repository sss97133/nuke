-- Disposable PG17 only. No source writers, inference, folds or worker calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN',r); END IF;
 END LOOP;
END $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,
 merged_into_vehicle_id uuid,status text,listing_kind text);
CREATE TABLE auction_events(id uuid PRIMARY KEY,vehicle_id uuid,source text,source_url text,
 auction_end_date timestamptz,canonical boolean DEFAULT true);
CREATE VIEW auction_events_canonical WITH(security_invoker=true) AS SELECT * FROM auction_events WHERE canonical;
CREATE TABLE external_identities(id uuid PRIMARY KEY,platform text);
CREATE TABLE auction_comments(id uuid PRIMARY KEY,vehicle_id uuid,auction_event_id uuid,comment_type text,
 bid_amount numeric,posted_at timestamptz,created_at timestamptz,is_seller boolean,external_identity_id uuid,
 comment_text text,media_urls text[],bat_comment_id bigint,source_url text);
CREATE INDEX ON auction_comments(auction_event_id);
CREATE INDEX ON auction_events(source,source_url);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_parent ON vehicles FOR SELECT USING(is_public);
ALTER TABLE auction_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_comment_read ON auction_comments FOR SELECT USING(true);
GRANT SELECT ON vehicles,auction_events,auction_events_canonical,external_identities,auction_comments TO anon,authenticated,service_role;
CREATE FUNCTION popup_vehicle_intel(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('legacy',$1) $$;
CREATE TEMP TABLE legacy_body AS SELECT prosrc,proacl FROM pg_proc WHERE oid='popup_vehicle_intel(uuid)'::regprocedure;
SET statement_timeout='3s';
SET lock_timeout='1s';
\ir ../migrations/20261128044336_market_comment_surface_reader.sql
\ir ../migrations/20261128044336_market_comment_surface_reader.sql
CREATE FUNCTION pg_temp.check_it(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.check_it((SELECT p.prosrc=b.prosrc AND p.proacl IS NOT DISTINCT FROM b.proacl
 FROM pg_proc p CROSS JOIN legacy_body b WHERE p.oid='popup_vehicle_intel(uuid)'::regprocedure),'legacy body and ACL unchanged');
SELECT pg_temp.check_it(NOT (SELECT prosecdef FROM pg_proc WHERE oid='popup_vehicle_intel(uuid,uuid,jsonb)'::regprocedure),'new overload is invoker');
SELECT pg_temp.check_it(NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x
 WHERE p.oid='popup_vehicle_intel(uuid,uuid,jsonb)'::regprocedure AND x.grantee=0),'no PUBLIC execute');
INSERT INTO vehicles VALUES
 ('10000000-0000-4000-8000-000000000001',true,null,null,null,null),
 ('10000000-0000-4000-8000-000000000002',false,null,null,null,null),
 ('10000000-0000-4000-8000-000000000003',true,now(),null,null,null),
 ('10000000-0000-4000-8000-000000000004',true,null,null,'merged',null),
 ('10000000-0000-4000-8000-000000000005',true,null,null,null,'non_vehicle_item');
INSERT INTO auction_events SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bat',
 CASE WHEN g<=2 THEN 'https://bringatrailer.com/listing/native-fixture/' ELSE 'https://bringatrailer.com/listing/native-'||g||'/' END,
 now()-interval '1 day',true FROM generate_series(1,5) g;
INSERT INTO external_identities VALUES
 ('90000000-0000-4000-8000-000000000001','bat'),('90000000-0000-4000-8000-000000000002','bat');
INSERT INTO auction_comments SELECT ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','question',null,
 now()-interval '2 days'+g*interval '1 second',CASE WHEN g=25 THEN now()-interval '12 hours' ELSE now()-interval '2 days'+g*interval '1 second' END,
 g%2=0,CASE WHEN g<=20 THEN '90000000-0000-4000-8000-000000000001'::uuid ELSE '90000000-0000-4000-8000-000000000002'::uuid END,
 CASE WHEN g=1 THEN E'\tShow 10 psi?\n' WHEN g=2 THEN '😀 Show 10 psi?'
  WHEN g=3 THEN 'See https://example.org 10 psi?' ELSE 'Show 10 psi?' END,
 null,1000+g,'https://bringatrailer.com/listing/native-fixture/' FROM generate_series(1,25) g;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,posted_at,created_at,comment_text,media_urls,is_seller,source_url) VALUES
 ('30000000-0000-4000-8000-000000000026','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','seller_response',now()-interval '46 hours',now()-interval '46 hours',null,ARRAY['https://bringatrailer.com/retained-media'],true,'https://bringatrailer.com/listing/native-fixture/'),
 ('30000000-0000-4000-8000-000000000027','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','observation',now()-interval '45 hours',now()-interval '45 hours',E' \t\n',ARRAY['',null],null,'https://bringatrailer.com/listing/native-fixture/'),
 ('30000000-0000-4000-8000-000000000028','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','question',now()-interval '2 days',null,'Unknown arrival',null,null,null),
 ('30000000-0000-4000-8000-000000000029','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','question',null,now()-interval '2 days','Unknown event',null,null,null);
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,bid_amount,posted_at,created_at,source_url) VALUES
 ('30000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','bid',100,now()-interval '2 days',now()-interval '2 days','https://bringatrailer.com/listing/native-fixture/');
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,posted_at,created_at,comment_text) VALUES
 ('30000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','sold',now()-interval '1 day',now()-interval '12 hours','Result is not a text feature');

DO $$ DECLARE r jsonb; n jsonb; q jsonb; h text; bad jsonb; g integer; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r->>'state'='partial' AND r->>'method_id'='auction_comment_surface','typed method receipt');
 PERFORM pg_temp.check_it(r#>>'{features,discussion_entries}'='27' AND r#>>'{features,text_entries}'='25','eligible entries exclude unknown clocks/bids/system');
 PERFORM pg_temp.check_it(r#>>'{features,media_only_entries}'='1' AND r#>>'{features,no_captured_text_or_media_entries}'='1','media and whitespace-only entries separated');
 PERFORM pg_temp.check_it(r#>>'{features,whitespace_tokens}'='77' AND r#>>'{features,question_mark_entries}'='25'
  AND r#>>'{features,numeric_unit_marker_entries}'='25','SQL literal patterns and whitespace runs');
 PERFORM pg_temp.check_it(r#>>'{coverage,unknown_event_time}'='1' AND r#>>'{coverage,unknown_recording_time}'='1','unknown clocks explicit');
 PERFORM pg_temp.check_it(r#>>'{features,keyed_participant_count}'='2' AND r#>>'{features,unkeyed_participant_entries}'='2','platform keys, no handle identity inference');
 PERFORM pg_temp.check_it(r#>>'{units,expertise}'='unmeasured' AND r->'historical_forecast_receipt'='false','no inferred expertise or historical forecast badge');
 PERFORM pg_temp.check_it(jsonb_array_length(r#>'{evidence,contributors}')=20 AND r#>>'{evidence,next_offset}'='20','bounded first page');
 PERFORM pg_temp.check_it(r#>>'{features,url_marker_entries}'='1'
  AND r#>'{evidence,contributors,2,url_marker}'='true'
  AND r#>'{evidence,contributors,2,numeric_unit_marker}'='true'
  AND r#>>'{evidence,contributors,2,external_identity_id}'='90000000-0000-4000-8000-000000000001',
  'aggregate patterns and participant identity remain inspectable in their source contribution');
 q:=jsonb_build_object('event_cutoff',r->>'event_cutoff','recorded_cutoff',r->>'recorded_cutoff','offset',20,'snapshot_hash',r#>>'{evidence,snapshot_hash}');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',q);
 PERFORM pg_temp.check_it(n#>>'{evidence,snapshot_hash}'=r#>>'{evidence,snapshot_hash}' AND jsonb_array_length(n#>'{evidence,contributors}')=7,'pinned second page');
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{evidence,contributors}') a,
  jsonb_array_elements(n#>'{evidence,contributors}') b WHERE a->>'comment_id'=b->>'comment_id'),'pages distinct');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',q||'{"evidence_filter":"text"}');
 PERFORM pg_temp.check_it(n->>'reason'='evidence_snapshot_changed','a changed evidence population cannot reuse its snapshot');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  jsonb_build_object('knowledge_mode','recorded_input_reconstruction','cutoff',now()-interval '36 hours'));
 PERFORM pg_temp.check_it(n#>>'{features,discussion_entries}'='26' AND n#>>'{features,text_entries}'='24'
  AND n#>>'{coverage,recorded_after_cutoff}'='1','cutoff excludes late comment arrival; later event is outside the cutoff');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{"evidence_filter":"media_only"}');
 PERFORM pg_temp.check_it(n#>>'{evidence,matching_entries}'='1' AND n#>>'{evidence,contributors,0,media_reference_count}'='1'
  AND n#>'{evidence,contributors,0,whitespace_tokens}'='null','media-only source remains inspectable without invented text');
 FOR bad IN SELECT x FROM jsonb_array_elements('[null,[],1,{"offset":1},{"offset":1.5},{"offset":"20"},{"offset":-1},{"offset":5001},{"knowledge_as_of":"2020-01-01"},{"knowledge_mode":null},{"knowledge_mode":"forecast"},{"evidence_filter":null},{"evidence_filter":"unknown"},{"cutoff":"yesterday"},{"cutoff":"2026-01-01T00:00:00"},{"snapshot_hash":"bad"}]') x LOOP
  n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',bad);
  PERFORM pg_temp.check_it(n->>'state'='unavailable' AND NOT n ? 'features','malformed request refused');
 END LOOP;
 FOR g IN 2..5 LOOP
  n:=popup_vehicle_intel(('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'{}');
  PERFORM pg_temp.check_it(n->>'state'='unavailable' AND NOT n ? 'vehicle_id','private/deleted/merged/nonvehicle parents refuse without identity leak');
 END LOOP;
 UPDATE auction_comments SET comment_text='Changed source' WHERE id='30000000-0000-4000-8000-000000000001';
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',q);
 PERFORM pg_temp.check_it(n->>'reason'='evidence_snapshot_changed' AND NOT n ? 'evidence','source change refuses old continuation');
END $$;
DO $$ DECLARE r jsonb; BEGIN
 UPDATE vehicles SET is_public=true WHERE id='10000000-0000-4000-8000-000000000002';
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r->>'reason'='ambiguous_source_episode','competing public source binding refused');
 UPDATE vehicles SET is_public=false WHERE id='10000000-0000-4000-8000-000000000002';
 UPDATE auction_comments SET vehicle_id='10000000-0000-4000-8000-000000000002' WHERE id='30000000-0000-4000-8000-000000000028';
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r->>'reason'='conflicting_comment_source_relation' AND NOT r ? 'features','cross-parent source refuses');
 UPDATE auction_comments SET vehicle_id='10000000-0000-4000-8000-000000000001' WHERE id='30000000-0000-4000-8000-000000000028';
 UPDATE auction_comments SET source_url='https://bringatrailer.com/listing/another-lot/' WHERE id='30000000-0000-4000-8000-000000000028';
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r->>'reason'='conflicting_comment_source_relation','conflicting source locator refuses');
 UPDATE auction_comments SET source_url=null WHERE id='30000000-0000-4000-8000-000000000028';
 UPDATE auction_comments SET comment_text=repeat('a',4194305) WHERE id='30000000-0000-4000-8000-000000000028';
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r->>'reason'='comment_input_size_exceeded' AND NOT r ? 'features','oversize source is refused before text work');
 UPDATE auction_comments SET comment_text='Unknown arrival' WHERE id='30000000-0000-4000-8000-000000000028';
 UPDATE auction_comments SET created_at='-infinity' WHERE id='30000000-0000-4000-8000-000000000028';
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 PERFORM pg_temp.check_it(r#>>'{features,discussion_entries}'='27' AND r#>>'{coverage,unknown_recording_time}'='1','nonfinite recording clock remains unknown');
END $$;
INSERT INTO auction_events VALUES('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','bat','https://bringatrailer.com/listing/native-cap/',now()-interval '1 day',true);
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,posted_at,created_at,comment_text,source_url)
 SELECT ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000099','observation',now()-interval '2 days',now()-interval '2 days','text',
 'https://bringatrailer.com/listing/native-cap/' FROM generate_series(1,5001) g;
DO $$ DECLARE r jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','{}');
 PERFORM pg_temp.check_it(r->>'reason'='comment_input_limit_exceeded' AND NOT r ? 'features','sentinel refuses partial calculations');
END $$;
DELETE FROM auction_comments WHERE id='40000000-0000-4000-8000-000000005001';
DO $$ DECLARE r jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','{}');
 PERFORM pg_temp.check_it(r#>>'{features,discussion_entries}'='5000' AND r#>>'{features,whitespace_tokens}'='5000','full supported input ceiling');
 PERFORM pg_temp.check_it(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','caller budgets unchanged');
END $$;
SET ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}');
 IF r->>'state'<>'partial' THEN RAISE EXCEPTION 'Anonymous public reading failed'; END IF;
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','{}');
 IF r->>'state'<>'unavailable' OR r ? 'vehicle_id' THEN RAISE EXCEPTION 'Anonymous private gate failed'; END IF;
END $$;
RESET ROLE;
-- Idempotent replay above must not become permission to overwrite an unrelated later body.
CREATE OR REPLACE FUNCTION popup_vehicle_intel(p_vehicle_id uuid,p_auction_event_id uuid,p_request jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"unexpected_body":true}'::jsonb $$;
\echo Expected next: migration refuses the drifted overload and its transaction rolls back.
\set ON_ERROR_STOP off
\ir ../migrations/20261128044336_market_comment_surface_reader.sql
\set ON_ERROR_STOP on
SELECT pg_temp.check_it(popup_vehicle_intel('10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','{}')->'unexpected_body'='true','drift refusal leaves later body unchanged');
