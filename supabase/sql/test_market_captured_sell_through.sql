-- Empty disposable native PostgreSQL only. All records are synthetic.
\set ON_ERROR_STOP on
\ir test_market_trends_one_read.sql
RESET ROLE;

-- Bring the existing contract's reader to the reviewed canonical-listing version.
CREATE VIEW public.auction_events_canonical WITH(security_invoker=true) AS SELECT * FROM public.auction_events;
REVOKE ALL ON public.auction_events_canonical FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.auction_events_canonical TO anon,authenticated,service_role;
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.get_market_trends(jsonb)'::regprocedure),
    'FROM public.auction_events e JOIN public.vehicles v',
    'FROM public.auction_events_canonical e JOIN public.vehicles v');
END $$;
CREATE TEMP TABLE captured_before_meta AS SELECT proacl,proowner,prosecdef,proconfig
  FROM pg_proc WHERE oid='public.get_market_trends(jsonb)'::regprocedure;
CREATE TEMP TABLE captured_before AS SELECT label,pg_temp.unclocked(get_market_trends(req)) AS receipt FROM scopes;
\ir ../migrations/20261128030020_market_captured_sell_through.sql
\ir ../migrations/20261128030020_market_captured_sell_through.sql
SELECT assert_count(NOT EXISTS(SELECT 1 FROM captured_before b JOIN scopes s USING(label)
  WHERE b.receipt IS DISTINCT FROM pg_temp.unclocked(get_market_trends(s.req))),
  'captured: valid legacy output remains identical after repeated migration');
SELECT assert_count((SELECT b.proacl IS NOT DISTINCT FROM p.proacl AND b.proowner=p.proowner
  AND b.prosecdef=p.prosecdef AND b.proconfig=p.proconfig FROM captured_before_meta b,pg_proc p
  WHERE p.oid='public.get_market_trends(jsonb)'::regprocedure),
  'captured: owner, invoker security, pinned path, five-second timeout and all grants retained');

-- A disjoint event window supplies exact expected outcomes without inherited fixture counts.
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
SELECT ('80000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  ('00000000-0000-0000-0000-'||lpad(CASE i WHEN 7 THEN 2 WHEN 8 THEN 3 WHEN 9 THEN 4
    WHEN 11 THEN 15 WHEN 12 THEN 6 WHEN 13 THEN 6 WHEN 16 THEN 7 ELSE 1 END::text,12,'0'))::uuid,
  'https://bringatrailer.com/listing/captured-'||CASE WHEN i=11 THEN '10' ELSE i::text END,
  date_trunc('day',now())-interval '6 days'+i*interval '1 hour',
  CASE WHEN i IN(2,11,13) THEN 'reserve_not_met' WHEN i=3 THEN 'cancelled'
    WHEN i=4 THEN 'live' WHEN i=6 THEN 'bid_to' WHEN i=17 THEN 'no_sale' ELSE 'sold' END,
  CASE WHEN i=5 THEN 0 ELSE 1000 END
FROM generate_series(1,17) i WHERE i<>15;
-- Conflicting source URL on another parent must be excluded, not latest-wins.
UPDATE auction_events SET auction_end_date=date_trunc('day',now())-interval '6 days'+interval '10 hours'
  WHERE id='80000000-0000-0000-0000-000000000011';
-- Equivalent trailing slash aliases count once.
INSERT INTO auction_events SELECT '80000000-0000-0000-0000-000000000015',vehicle_id,source,source_url||'/',
  auction_end_date,outcome,winning_bid,created_at,updated_at,scraped_at,raw_data
  FROM auction_events WHERE id='80000000-0000-0000-0000-000000000001';
CREATE FUNCTION captured_request() RETURNS jsonb LANGUAGE sql AS $$
 SELECT count_request()||jsonb_build_object('metric','captured_sell_through',
   'reserve_policy','all_recorded_policies','event_from',date_trunc('day',now())-interval '7 days',
   'event_to',date_trunc('day',now())-interval '5 days')
$$;
CREATE FUNCTION captured_total(r jsonb,s text,f text) RETURNS numeric LANGUAGE sql AS $$
 SELECT (x->>f)::numeric FROM jsonb_array_elements(r->'summary') x WHERE x->>'series'=s
$$;
GRANT EXECUTE ON FUNCTION captured_request(),captured_total(jsonb,text,text) TO anon,authenticated;
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(captured_request()),'selected','numerator')=2
 AND captured_total(get_market_trends(captured_request()),'selected','denominator')=3
 AND abs(captured_total(get_market_trends(captured_request()),'selected','ratio')-2::numeric/3)<1e-12,
 'captured: two sale episodes and one explicit no-sale yield2/3; not one count per vehicle');
SELECT assert_count(captured_total(get_market_trends(captured_request()),'selected','withdrawn')=1
 AND captured_total(get_market_trends(captured_request()),'selected','unresolved')=4,
 'captured: cancelled separate; live, bid-to, unsupported sold and unwitnessed no-sale stay unresolved');
SELECT assert_count(captured_total(get_market_trends(captured_request()),'benchmark','numerator')=1
 AND captured_total(get_market_trends(captured_request()),'benchmark','denominator')=2,
 'captured: rest-of-source excludes selected and unresolved membership');
SELECT assert_count(get_market_trends(captured_request())#>>'{coverage,conflicting_alias_episodes}'='1'
 AND (SELECT sum((e->>'denominator_contribution')::int)=5
   AND sum((e->>'numerator_contribution')::int)=3
   AND count(*)=5 FROM jsonb_array_elements(get_market_trends(captured_request())#>'{evidence,contributors}') e),
 'captured: equivalent aliases once; conflicting parents out; sales AND failures contribute');
SELECT assert_count(get_market_trends(captured_request())#>>'{coverage,complete_external_capture}'='false'
 AND get_market_trends(captured_request())#>>'{coverage,platform_sell_through_supported}'='false'
 AND get_market_trends(captured_request())#>>'{reserve_policy_stratified}'='false',
 'captured: ratios never claim platform completeness, settlement or reserve-adjusted comparison');
SELECT assert_count((SELECT bool_and(p->>'ratio' IS NULL) FROM jsonb_array_elements(
 get_market_trends(captured_request())->'series') p WHERE (p->>'denominator')::int=0),
 'captured: empty buckets have null fractions, not zero percent');
SELECT assert_count((SELECT count(*)=1 AND bool_and(e->>'outcome_class'='withdrawn'
  AND e->>'denominator_contribution'='0') FROM jsonb_array_elements(get_market_trends(
  captured_request()||'{"evidence_outcome":"withdrawn"}')#>'{evidence,contributors}') e),
 'captured: excluded withdrawals retain an explicit record drill');
SELECT assert_count((SELECT count(*)=4 AND bool_and(e->>'outcome_class'='unresolved')
 FROM jsonb_array_elements(get_market_trends(captured_request()||
 '{"evidence_outcome":"unresolved","evidence_series":"selected"}')#>'{evidence,contributors}') e),
 'captured: unknown outcomes remain inspectable rather than silently becoming no-sales');
SELECT assert_count((SELECT count(*)=1 AND bool_and(e->>'denominator_contribution'='0'
 AND e->>'outcome_reason'='no_sale_without_affirmative_result_witness')
 FROM jsonb_array_elements(get_market_trends(captured_request()||
 '{"evidence_outcome":"unresolved","evidence_series":"selected"}')#>'{evidence,contributors}') e
 WHERE e->>'source_outcome'='no_sale'),
 'captured: extractor no-sale fallback has no denominator weight without a result witness');
SELECT assert_count(get_market_trends(captured_request()-'reserve_policy')->>'reason'='unsupported_or_missing_reserve_policy'
 AND get_market_trends(captured_request()||'{"knowledge_as_of":"2020-01-01"}')->>'reason'='historical_knowledge_versions_unavailable',
 'captured: explicit reserve policy required; historical knowledge unsupported');
SELECT rejects_count(captured_request()||'{"evidence_offset":1}','continuation missing bucket/series/snapshot');
SELECT rejects_count(captured_request()||'{"evidence_offset":-1}','negative continuation');
SELECT rejects_count(captured_request()||'{"evidence_snapshot_hash":"garbage"}','malformed snapshot');
SELECT rejects_count(count_request()||'{"reserve_policy":"all_recorded_policies"}','new fields on legacy metric');
RESET ROLE;
CREATE TEMP TABLE captured_page AS SELECT captured_request()||jsonb_build_object('evidence_limit',1,
 'evidence_bucket',(date_trunc('day',now())-interval '6 days')::date,'evidence_series','selected') AS req;
ALTER TABLE captured_page ADD COLUMN receipt jsonb;
UPDATE captured_page SET receipt=get_market_trends(req);
GRANT SELECT ON captured_page TO anon,authenticated;
SET ROLE anon;
SELECT assert_count((SELECT receipt#>>'{evidence,next_offset}'='1'
 AND jsonb_array_length(receipt#>'{evidence,contributors}')=1
 AND get_market_trends(req||jsonb_build_object('evidence_offset',1,
   'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))#>>'{evidence,contributors,0,auction_event_id}'
   IS DISTINCT FROM receipt#>>'{evidence,contributors,0,auction_event_id}' FROM captured_page),
 'captured: bounded continuation reaches a distinct contributing source row');
SELECT assert_count((SELECT get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_outcome','no_sale','evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))
 ->>'reason'='evidence_snapshot_changed' FROM captured_page),
 'captured: continuation cannot silently change its outcome selection');
RESET ROLE;
UPDATE auction_events SET winning_bid=999 WHERE id='80000000-0000-0000-0000-000000000007';
SET ROLE anon;
SELECT assert_count((SELECT get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'state'='partial' FROM captured_page),
 'captured: a private source change neither leaks nor invalidates public evidence');
RESET ROLE;
UPDATE auction_events SET winning_bid=1001 WHERE id='80000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT assert_count((SELECT get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'reason'='evidence_snapshot_changed' FROM captured_page),
 'captured: changed public evidence refuses continuation instead of mixing snapshots');
RESET ROLE;
UPDATE auction_events SET winning_bid=1000 WHERE id='80000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT assert_count(captured_total(get_market_trends(captured_request()),'selected','denominator')=3,
 'captured: privileged private-parent visibility cannot alter public denominator');
RESET ROLE;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT ('90000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001',
 'https://bringatrailer.com/listing/captured-cap-'||i,date_trunc('day',now())-interval '6 days','live'
 FROM generate_series(1,2001) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(captured_request())->>'truncated'='true'
 AND (SELECT bool_and(x->>'numerator' IS NULL AND x->>'denominator' IS NULL AND x->>'ratio' IS NULL)
 FROM jsonb_array_elements(get_market_trends(captured_request())->'summary') x)
 AND (SELECT bool_and(x->>'value' IS NULL AND x->>'ratio' IS NULL)
 FROM jsonb_array_elements(get_market_trends(captured_request())->'series') x),
 'captured: cap withholds every summary and plotted fraction');
RESET ROLE;
