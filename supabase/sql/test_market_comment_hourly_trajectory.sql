-- Repository disposable native PostgreSQL contract only. No service calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF;
END $$;

\ir test_market_comment_surface_reader.sql
-- The base contract ends with an intentionally unexpected body.
DROP FUNCTION popup_vehicle_intel(uuid,uuid,jsonb);
\ir ../migrations/20261128044336_market_comment_surface_reader.sql
CREATE TEMP TABLE legacy_projection AS SELECT q AS request,popup_vehicle_intel(
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',q) AS receipt
 FROM (SELECT jsonb_build_object('knowledge_mode','recorded_input_reconstruction',
 'cutoff',to_char(date_trunc('second',now()-interval '12 hours'),'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'evidence_filter',f) q FROM unnest(ARRAY['all_discussion','text','media_only','no_captured_content']) f) x;
CREATE TEMP TABLE owner_before AS SELECT prosrc,proacl,proconfig FROM pg_proc WHERE oid='popup_vehicle_intel(uuid)'::regprocedure;
\ir ../migrations/20261128124100_market_comment_hourly_trajectory.sql
\ir ../migrations/20261128124100_market_comment_hourly_trajectory.sql
SELECT pg_temp.check_it(NOT EXISTS(SELECT FROM legacy_projection x WHERE x.receipt-'measured_at'
 IS DISTINCT FROM popup_vehicle_intel('10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',x.request)-'measured_at'),'legacy payloads and fingerprints unchanged');
SELECT pg_temp.check_it(NOT EXISTS(SELECT FROM legacy_projection x WHERE x.receipt-'measured_at'
 IS DISTINCT FROM popup_vehicle_intel('10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',x.request||'{"include_trajectory":false}')-'measured_at'),
 'explicit false is the same legacy projection');
SELECT pg_temp.check_it((SELECT p.prosrc=b.prosrc AND p.proacl IS NOT DISTINCT FROM b.proacl AND p.proconfig IS NOT DISTINCT FROM b.proconfig
 FROM pg_proc p CROSS JOIN owner_before b WHERE p.oid='popup_vehicle_intel(uuid)'::regprocedure),'one-argument owner untouched');
SELECT pg_temp.check_it(NOT (SELECT prosecdef FROM pg_proc WHERE oid='popup_vehicle_intel(uuid,uuid,jsonb)'::regprocedure)
 AND NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.oid='popup_vehicle_intel(uuid,uuid,jsonb)'::regprocedure AND a.grantee=0),'invoker and no PUBLIC execute');

INSERT INTO auction_events VALUES('20000000-0000-4000-8000-000000000098','10000000-0000-4000-8000-000000000001',
 'bat','https://bringatrailer.com/listing/native-hours/',date_trunc('day',now())-interval '1 day'+interval '12 hours 30 minutes',true);
-- Six eligible entries at partial-hour and exact-hour boundaries.
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,posted_at,created_at,comment_text,media_urls,is_seller,external_identity_id)
 SELECT ('50000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,e.vehicle_id,e.id,
 CASE WHEN g=3 THEN 'seller_response' ELSE 'observation' END,
 e.auction_end_date-interval '14 days'+CASE g WHEN 1 THEN interval '0' WHEN 2 THEN interval '30 minutes'
 WHEN 3 THEN interval '30 minutes 1 second' WHEN 4 THEN interval '1 hour 30 minutes'
 WHEN 5 THEN interval '13 days 23 hours 30 minutes' ELSE interval '14 days' END,
 e.auction_end_date-interval '1 hour',
 CASE WHEN g IN(3,4) THEN null WHEN g=1 THEN '10 psi?' WHEN g=5 THEN 'https://example.org?' ELSE 'words' END,
 CASE WHEN g=3 THEN ARRAY['https://bringatrailer.com/a.jpg'] ELSE null END,
 CASE WHEN g=3 THEN true WHEN g=4 THEN null ELSE false END,
 CASE WHEN g<=3 THEN '90000000-0000-4000-8000-000000000001'::uuid ELSE null END
 FROM auction_events e CROSS JOIN generate_series(1,6) g WHERE e.id='20000000-0000-4000-8000-000000000098';
-- Bid/system, missing clocks, just-outside bounds and late arrival.
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,bid_amount,posted_at,created_at,comment_text)
 SELECT ('50000000-0000-4000-8000-'||lpad((g+6)::text,12,'0'))::uuid,e.vehicle_id,e.id,
 CASE WHEN g=1 THEN 'bid' WHEN g=2 THEN 'sold' ELSE 'observation' END,CASE WHEN g=1 THEN 100 END,
 CASE WHEN g=3 THEN null WHEN g=4 THEN e.auction_end_date-interval '14 days 1 second'
 WHEN g=5 THEN e.auction_end_date+interval '1 second' ELSE e.auction_end_date-interval '1 hour' END,
 CASE WHEN g=6 THEN null WHEN g=7 THEN e.auction_end_date+interval '1 second' ELSE e.auction_end_date-interval '1 hour' END,
 'not in the eligible trajectory'
 FROM auction_events e CROSS JOIN generate_series(1,7) g WHERE e.id='20000000-0000-4000-8000-000000000098';
CREATE TEMP TABLE hours_receipt AS SELECT popup_vehicle_intel('10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000098',jsonb_build_object('include_trajectory',true,
 'knowledge_mode','recorded_input_reconstruction','cutoff',auction_end_date)) r
 FROM auction_events WHERE id='20000000-0000-4000-8000-000000000098';
DO $$ DECLARE r jsonb; b jsonb; n jsonb; q jsonb; bad jsonb; key text; legacy_key text; start_at timestamptz; BEGIN
 SELECT h.r INTO r FROM hours_receipt h;
 PERFORM pg_temp.check_it(r->>'state'='partial' AND r#>>'{trajectory,method_id}'='auction_comment_hourly_v1','opt-in method receipt');
 PERFORM pg_temp.check_it(r#>>'{features,discussion_entries}'='6' AND r#>>'{features,text_entries}'='4','same eligible partition');
 PERFORM pg_temp.check_it(r#>>'{features,media_only_entries}'='1' AND r#>>'{features,no_captured_text_or_media_entries}'='1','media/no-content partition');
 PERFORM pg_temp.check_it(jsonb_array_length(r#>'{trajectory,buckets}')=337,'bounded dense hours');
 PERFORM pg_temp.check_it(r#>'{evidence,bucket_start}'='null'::jsonb,'no selected bucket initially');
 FOR key,legacy_key IN SELECT * FROM(VALUES('discussion_entries','discussion_entries'),('text_entries','text_entries'),
 ('media_only_entries','media_only_entries'),('no_captured_content_entries','no_captured_text_or_media_entries'),
 ('whitespace_tokens','whitespace_tokens'),('question_mark_entries','question_mark_entries'),('url_marker_entries','url_marker_entries'),
 ('numeric_unit_marker_entries','numeric_unit_marker_entries'),('seller_flagged_entries','seller_flagged_entries'),
 ('unknown_seller_flag_entries','unknown_seller_flag_entries'),('unkeyed_participant_entries','unkeyed_participant_entries')) x(k,l) LOOP
  PERFORM pg_temp.check_it((SELECT sum((x->>key)::numeric) FROM jsonb_array_elements(r#>'{trajectory,buckets}') x)
   =(r->'features'->>legacy_key)::numeric,'hourly total reconciles: '||key);
 END LOOP;
 PERFORM pg_temp.check_it((SELECT sum((x->>'window_seconds')::numeric) FROM jsonb_array_elements(r#>'{trajectory,buckets}') x)=1209600,'clipped windows cover14days');
 b:=r#>'{trajectory,buckets,0}';start_at:=(b->>'bucket_start')::timestamptz;
 PERFORM pg_temp.check_it((b->>'window_seconds')::numeric=1800 AND (b->>'discussion_entries')::int=1
  AND (b->>'entries_per_window_hour')::numeric=2,'first partial-hour denominator');
 b:=r#>'{trajectory,buckets,336}';
 PERFORM pg_temp.check_it((b->>'window_seconds')::numeric=1800 AND (b->>'discussion_entries')::int=2
  AND (b->>'cumulative_discussion_entries')::int=6 AND (b->>'entries_per_window_hour')::numeric=4,'final hour includes exact cutoff');
 PERFORM pg_temp.check_it((SELECT sum((x->>'keyed_participant_count')::int) FROM jsonb_array_elements(r#>'{trajectory,buckets}') x)=2
  AND r#>>'{features,keyed_participant_count}'='1','per-hour identities are not additive people');
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT FROM jsonb_array_elements(r#>'{trajectory,buckets}') x
 WHERE (x->>'window_seconds')::numeric>0 AND (x->>'entries_per_window_hour')::numeric IS DISTINCT FROM
 round((x->>'discussion_entries')::numeric*3600/(x->>'window_seconds')::numeric,6)),'all rates have explicit denominators');
 q:=jsonb_build_object('include_trajectory',true,'knowledge_mode','recorded_input_reconstruction','cutoff',r->>'recorded_cutoff',
 'snapshot_hash',r#>>'{evidence,snapshot_hash}','evidence_bucket',start_at+interval '1 hour');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',q);
 PERFORM pg_temp.check_it(n#>>'{evidence,snapshot_hash}'=r#>>'{evidence,snapshot_hash}'
  AND n#>>'{evidence,matching_entries}'='2','hour selection preserves population snapshot');
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT FROM jsonb_array_elements(n#>'{evidence,contributors}') x
 WHERE date_trunc('hour',(x->>'posted_at')::timestamptz)<>start_at+interval '1 hour'),'exact-hour source contributors');
 PERFORM pg_temp.check_it(n->'features'=r->'features' AND n->'trajectory'=r->'trajectory','selection preserves totals/curve');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',q||jsonb_build_object('evidence_bucket',start_at+interval '3 hours'));
 PERFORM pg_temp.check_it(n#>>'{evidence,matching_entries}'='0' AND n#>'{evidence,contributors}'='[]','zero retained hour source drill');
 FOR bad IN SELECT value FROM jsonb_array_elements('[{"include_trajectory":"true"},{"include_trajectory":null},{"evidence_bucket":"2020-01-01T00:00:00Z"},{"include_trajectory":false,"evidence_bucket":"2020-01-01T00:00:00Z"},{"include_trajectory":true,"evidence_bucket":null},{"include_trajectory":true,"evidence_bucket":"now"},{"include_trajectory":true,"evidence_bucket":"infinity"},{"include_trajectory":true,"evidence_bucket":"2020-01-01T00:00:00Z"}]') LOOP
  n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',bad);
  PERFORM pg_temp.check_it(n->>'state'='unavailable' AND NOT n ? 'trajectory','invalid trajectory request refuses');
 END LOOP;
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',q||jsonb_build_object('evidence_bucket',start_at+interval '1 minute'));
 PERFORM pg_temp.check_it(n->>'reason'='invalid_trajectory_bucket','non-hour boundary refuses');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',(q||'{"include_trajectory":false}'::jsonb)-'evidence_bucket');
 PERFORM pg_temp.check_it(n->>'reason'='evidence_snapshot_changed','legacy and trajectory snapshots cannot cross');
 UPDATE auction_events SET auction_end_date=date_trunc('hour',auction_end_date) WHERE id='20000000-0000-4000-8000-000000000098';
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',
 jsonb_build_object('include_trajectory',true,'knowledge_mode','recorded_input_reconstruction','cutoff',
 (SELECT auction_end_date FROM auction_events WHERE id='20000000-0000-4000-8000-000000000098')));
 b:=n#>'{trajectory,buckets,336}';
 PERFORM pg_temp.check_it((b->>'window_seconds')::numeric=0 AND (b->>'discussion_entries')::int=1
 AND b->'entries_per_window_hour'='null','zero-duration final instant has count and null rate');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098',q);
 PERFORM pg_temp.check_it(n->>'reason'='evidence_snapshot_changed','changed close anchor refuses continuation');
END $$;

-- Exercise the opt-in projection at the same supported 5,000-row ceiling.
DO $$ DECLARE r jsonb; n jsonb; q jsonb; b jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','{"include_trajectory":true}');
 PERFORM pg_temp.check_it(r#>>'{features,discussion_entries}'='5000' AND jsonb_array_length(r#>'{trajectory,buckets}')<=337,'full supported trajectory input ceiling');
 SELECT x INTO b FROM jsonb_array_elements(r#>'{trajectory,buckets}') x WHERE (x->>'discussion_entries')::int=5000;
 q:=jsonb_build_object('include_trajectory',true,'event_cutoff',r->>'event_cutoff','recorded_cutoff',r->>'recorded_cutoff',
  'snapshot_hash',r#>>'{evidence,snapshot_hash}','evidence_bucket',b->>'bucket_start');
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099',q);
 PERFORM pg_temp.check_it(n#>>'{evidence,matching_entries}'='5000' AND n#>>'{evidence,next_offset}'='20','hourly source drill retains page limit');
 r:=n;
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099',q||'{"offset":20}');
 PERFORM pg_temp.check_it(n#>>'{evidence,snapshot_hash}'=r#>>'{evidence,snapshot_hash}' AND jsonb_array_length(n#>'{evidence,contributors}')=20
  AND NOT EXISTS(SELECT FROM jsonb_array_elements(n#>'{evidence,contributors}') AS page_next(entry),
  jsonb_array_elements(r#>'{evidence,contributors}') AS page_first(entry)
  WHERE page_next.entry->>'comment_id'=page_first.entry->>'comment_id'),'distinct second page shares selected hour and source snapshot');
 UPDATE auction_comments SET comment_text='changed retained content' WHERE id='40000000-0000-4000-8000-000000000001';
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099',q);
 PERFORM pg_temp.check_it(n->>'reason'='evidence_snapshot_changed' AND NOT n ? 'trajectory','changed retained source refuses entire old curve');
 UPDATE auction_comments SET comment_text=repeat('x',4194305) WHERE id='40000000-0000-4000-8000-000000000001';
 n:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','{"include_trajectory":true}');
 PERFORM pg_temp.check_it(n->>'reason'='comment_input_size_exceeded' AND NOT n ? 'trajectory','oversize input refuses trajectory');
 UPDATE auction_comments SET comment_text='text' WHERE id='40000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.check_it(current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s','caller budgets preserved');
END $$;
INSERT INTO auction_comments(id,vehicle_id,auction_event_id,comment_type,posted_at,created_at,comment_text)
 VALUES('40000000-0000-4000-8000-000000005001','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000099','observation',now()-interval '2 days',now()-interval '2 days','sentinel');
DO $$ DECLARE r jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','{"include_trajectory":true}');
 PERFORM pg_temp.check_it(r->>'reason'='comment_input_limit_exceeded' AND NOT r ? 'trajectory','5,001-row sentinel refuses partial trajectory');
END $$;
SET ROLE anon;
DO $$ DECLARE r jsonb; BEGIN
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000098','{"include_trajectory":true}');
 IF r->>'state'<>'partial' OR NOT r ? 'trajectory' THEN RAISE EXCEPTION 'Anonymous public trajectory failed'; END IF;
 r:=popup_vehicle_intel('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','{"include_trajectory":true}');
 IF r->>'state'<>'unavailable' OR r ? 'trajectory' OR r ? 'vehicle_id' THEN RAISE EXCEPTION 'Anonymous private gate failed'; END IF;
END $$;
RESET ROLE;
