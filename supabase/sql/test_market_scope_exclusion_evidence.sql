-- Fresh disposable PG17 only. The included chain enforces the empty-database guard.
\set ON_ERROR_STOP on
\ir test_market_descriptive_outcome_scopes.sql
RESET ROLE;
CREATE TEMP TABLE exclusion_meta_before AS SELECT oid,proacl,proowner,prosecdef,proconfig,prosrc FROM pg_proc
 WHERE oid IN('public.get_market_trends(jsonb)'::regprocedure,'public.cohort_scope_rule(uuid[],text)'::regprocedure);
CREATE TEMP TABLE exclusion_payload_before AS
 SELECT label,req,pg_temp.unclocked(get_market_trends(req)) payload FROM scopes
 UNION ALL SELECT 'captured make',captured_request(),pg_temp.unclocked(get_market_trends(captured_request()))
 UNION ALL SELECT label||' captured',req,pg_temp.unclocked(get_market_trends(req)) FROM(
 SELECT label,req||jsonb_build_object('metric','captured_sell_through','reserve_policy','all_recorded_policies') req FROM scopes) s
 UNION ALL SELECT 'descriptive',descriptive_request(),pg_temp.unclocked(get_market_trends(descriptive_request()));
\ir ../migrations/20261128085914_market_scope_exclusion_evidence.sql
\ir ../migrations/20261128085914_market_scope_exclusion_evidence.sql
SELECT assert_count(NOT EXISTS(SELECT FROM exclusion_meta_before b JOIN pg_proc p USING(oid)
 WHERE b.proacl IS DISTINCT FROM p.proacl OR b.proowner<>p.proowner OR b.prosecdef<>p.prosecdef
 OR b.proconfig IS DISTINCT FROM p.proconfig
 OR(p.oid<>'public.get_market_trends(jsonb)'::regprocedure AND b.prosrc<>p.prosrc)),
 'scope exclusions: invoker, all ACLs/owners/budgets and metadata rule body unchanged');
SELECT assert_count(NOT EXISTS(SELECT FROM exclusion_payload_before b
 WHERE b.label<>'descriptive' AND b.payload IS DISTINCT FROM pg_temp.unclocked(get_market_trends(b.req))),
 'scope exclusions: every legacy and captured make/supported payload remains identical');
SELECT assert_count((SELECT jsonb_set(payload,'{evidence,snapshot_hash}','null')=
 jsonb_set(pg_temp.unclocked(get_market_trends(req))-'scope_exclusions','{evidence,snapshot_hash}','null')
 FROM exclusion_payload_before WHERE label='descriptive'),
 'scope exclusions: descriptive classification, counts and outcome evidence unchanged apart from additive explanation and bound fingerprint');

DELETE FROM auction_events;
SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request())#>'{scope_exclusions,total}'='0'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,records}'='[]'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,reason_counts}'='[]'::jsonb,
 'scope exclusions: known empty explanation remains empty, not a catalog failure');
RESET ROLE;
INSERT INTO vehicles(id,make,model,year,canonical_make_id,is_public,deleted_at,listing_kind)
 SELECT ('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE i WHEN 6 THEN 'unknown make' WHEN 7 THEN 'BENCHMARK' ELSE 'SYNTHETIC' END,
 CASE i WHEN 1 THEN 'MODEL' WHEN 3 THEN 'model alias' WHEN 26 THEN 'MODEL' ELSE 'MODEL unregistered trim' END,
 CASE i WHEN 4 THEN NULL WHEN 5 THEN 1777 WHEN 26 THEN 1978 ELSE 1977 END,
 CASE WHEN i=6 THEN NULL ELSE '10000000-0000-0000-0000-000000000001'::uuid END,
 i<>8,CASE WHEN i=9 THEN now() END,CASE WHEN i=10 THEN 'non_vehicle_item' ELSE 'vehicle' END
 FROM generate_series(1,32) i;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('82000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/scope-evidence-'||CASE WHEN i=12 THEN 11 ELSE i END,
 date_trunc('day',now())-interval '6 days'+interval '12 hours'+i*interval '1 minute','sold',1000
 FROM generate_series(1,32) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request())#>'{scope_exclusions,total}'='26'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,records_truncated}'='true'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,omitted_records}'='6'::jsonb
 AND jsonb_array_length(get_market_trends(descriptive_request())#>'{scope_exclusions,records}')=20
 AND (SELECT sum((x->>'episodes')::integer)=26 FROM jsonb_array_elements(
 get_market_trends(descriptive_request())#>'{scope_exclusions,reason_counts}') x),
 'scope exclusions: exact episode/reason totals, bounded20source rows and explicit6omitted; duplicate listing aliases count once');
SELECT assert_count(NOT EXISTS(SELECT FROM jsonb_array_elements(
 get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e WHERE e->>'vehicle_id' IN(
 '81000000-0000-4000-8000-000000000008','81000000-0000-4000-8000-000000000009','81000000-0000-4000-8000-000000000010'))
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,total}'=
 get_market_trends(descriptive_request())#>'{coverage,unresolved_scope}',
 'scope exclusions: private/deleted/nonvehicle parents never contribute to explanatory totals or source rows');
SELECT assert_count((SELECT count(*)=1 FROM jsonb_array_elements(
 get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='81000000-0000-4000-8000-000000000003'
 AND e->>'membership_reason'='ambiguous_exact_registered_model_keys'
 AND e->>'requested_canonical_model_id'='20000000-0000-0000-0000-000000000001'
 AND e->>'exact_registered_model_count'='2' AND jsonb_array_length(e->'matching_model_ids')=2),
 'scope exclusions: ambiguous membership carries requested and matching model keys without choosing a winner');
SELECT assert_count((SELECT count(DISTINCT e->>'membership_reason')=6 FROM jsonb_array_elements(
 get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e)
 AND (SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e
 WHERE e->>'membership_reason'='conflicting_listing_aliases' AND jsonb_array_length(e->'source_event_ids')=2)
 AND (SELECT bool_and(e->>'source_read_basis'='unknown' AND e->'source_observed_at'='null'::jsonb)
 FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e),
 'scope exclusions: source alias conflict, unknown make, invalid/missing year, missing label and ambiguous key remain distinct; no source clock invented');
RESET ROLE;
CREATE TEMP TABLE exclusion_pinned AS SELECT req,get_market_trends(req) receipt FROM(
 SELECT descriptive_request()||jsonb_build_object('evidence_bucket',(date_trunc('day',now())-interval '6 days')::date,
 'evidence_series','selected','evidence_limit',1) req) r;
GRANT SELECT ON exclusion_pinned TO anon,authenticated;
INSERT INTO canonical_models VALUES('20000000-0000-0000-0000-000000000099','SYNTHETIC','ANOTHER CLASH',ARRAY['model alias'],1970,1990);
SET ROLE anon;
SELECT assert_count((SELECT receipt#>'{summary}'=get_market_trends(req)#>'{summary}'
 AND receipt#>'{scope_exclusions,reason_counts}'=get_market_trends(req)#>'{scope_exclusions,reason_counts}'
 AND receipt#>>'{evidence,snapshot_hash}'<>get_market_trends(req)#>>'{evidence,snapshot_hash}'
 AND get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'reason'='evidence_snapshot_changed'
 FROM exclusion_pinned),
 'scope exclusions: changed matching keys invalidate continuation even when both fractions and unresolved reason totals remain unchanged');
RESET ROLE;
INSERT INTO canonical_models
 SELECT ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC','CLASH '||i,
 ARRAY['model alias'],1970,1990 FROM generate_series(100,123) i;
SET ROLE anon;
SELECT assert_count((SELECT count(*)=1 FROM jsonb_array_elements(
 get_market_trends(descriptive_request())#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='81000000-0000-4000-8000-000000000003'
 AND e->>'exact_registered_model_count'='27' AND e->>'matching_model_keys_truncated'='true'
 AND jsonb_array_length(e->'matching_model_ids')=20),
 'scope exclusions: ambiguous registry keys retain exact27count while their returned key list is capped at20');
RESET ROLE;
CREATE TEMP TABLE exclusion_keyset_pinned AS SELECT req,get_market_trends(req) receipt FROM exclusion_pinned;
GRANT SELECT ON exclusion_keyset_pinned TO anon,authenticated;
UPDATE canonical_models SET aliases=ARRAY['unrelated alias'] WHERE id='20000000-0000-0000-0000-000000000123';
INSERT INTO canonical_models VALUES('20000000-0000-0000-0000-000000000124','SYNTHETIC','CLASH 124',ARRAY['model alias'],1970,1990);
SET ROLE anon;
SELECT assert_count((SELECT receipt#>'{summary}'=get_market_trends(req)#>'{summary}'
 AND receipt#>'{scope_exclusions,reason_counts}'=get_market_trends(req)#>'{scope_exclusions,reason_counts}'
 AND(SELECT e->'matching_model_ids' FROM jsonb_array_elements(receipt#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='81000000-0000-4000-8000-000000000003')=
 (SELECT e->'matching_model_ids' FROM jsonb_array_elements(get_market_trends(req)#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='81000000-0000-4000-8000-000000000003')
 AND receipt#>>'{evidence,snapshot_hash}'<>get_market_trends(req)#>>'{evidence,snapshot_hash}'
 FROM exclusion_keyset_pinned),
 'scope exclusions: a changed key beyond the20key display cap still changes the fingerprint when visible keys and counts stay the same');
RESET ROLE;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('83000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'81000000-0000-4000-8000-000000000001',
 'https://bringatrailer.com/listing/scope-cap-'||i,date_trunc('day',now())-interval '6 days','sold',1000
 FROM generate_series(1,2001) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request())#>>'{scope_exclusions,state}'='unavailable'
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,total}'='null'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,records}'='[]'::jsonb
 AND get_market_trends(descriptive_request())#>'{scope_exclusions,reason_counts}'='null'::jsonb,
 'scope exclusions: capped candidate population refuses explanatory totals and rows with outcome fractions');
RESET ROLE;
