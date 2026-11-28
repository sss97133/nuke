-- Fresh disposable PG17 only; the included chain enforces its empty database guard.
\set ON_ERROR_STOP on
\ir test_market_captured_sell_through.sql
RESET ROLE;
DELETE FROM auction_events WHERE id::text LIKE '90000000-%';
-- Use the actual existing one-argument metadata rule; preserve it exactly alongside the new overload.
CREATE OR REPLACE FUNCTION public.cohort_scope_rule(p_subject_id uuid)
 RETURNS TABLE(canonical_make text, grain text, year integer, year_start integer, year_end integer, pattern text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- The rule cohort_members() applies, as data: make, years and the word-boundary model regex built from the canonical
  -- model and its aliases. NULL pattern = no usable model words (cohort_members() then returns nothing).
  WITH p AS (
    SELECT mp.canonical_make, mp.grain, mp.year, mp.year_start, mp.year_end, mp.canonical_model, mp.canonical_model_id
      FROM public.make_model_profiles mp
     WHERE mp.subject_id = p_subject_id
  ), alts AS (
    SELECT string_agg(regexp_replace(lower(s.t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|') AS a
      FROM (
        SELECT lower(p.canonical_model) AS t FROM p
        UNION
        SELECT lower(al) FROM p JOIN public.canonical_models cm ON cm.id = p.canonical_model_id, unnest(cm.aliases) al
      ) s
     WHERE s.t IS NOT NULL AND length(trim(s.t)) > 0
  )
  SELECT p.canonical_make, p.grain, p.year, p.year_start, p.year_end,
         CASE WHEN alts.a IS NOT NULL AND alts.a <> '' THEN '\y(' || alts.a || ')\y' END
    FROM p CROSS JOIN alts
$fn$;
ALTER TABLE make_model_profiles ADD CONSTRAINT fixture_generation_only_supported CHECK (
 comparison_scope_status<>'supported' OR (grain='generation' AND year_start IS NOT NULL AND year_end IS NOT NULL
 AND year_start<=year_end AND nullif(btrim(comparison_scope_basis),'') IS NOT NULL));
CREATE TEMP TABLE descriptive_before_meta AS SELECT oid,prosrc,proacl,proowner,prosecdef,proconfig
 FROM pg_proc WHERE oid IN('public.get_market_trends(jsonb)'::regprocedure,
 'public.cohort_scope_rule(uuid)'::regprocedure,'public.cohort_members(uuid)'::regprocedure,
 'public.get_market_trends(text,text,integer,integer,text)'::regprocedure);
CREATE TEMP TABLE descriptive_legacy_before AS SELECT label,pg_temp.unclocked(get_market_trends(req)) AS receipt FROM scopes;
CREATE TEMP TABLE descriptive_captured_before AS SELECT pg_temp.unclocked(get_market_trends(captured_request())) AS receipt;
CREATE TEMP TABLE descriptive_registry_before AS TABLE make_model_profiles;
\ir ../migrations/20261128075014_market_descriptive_outcome_scopes.sql
\ir ../migrations/20261128075014_market_descriptive_outcome_scopes.sql
SELECT assert_count(NOT EXISTS(SELECT FROM descriptive_before_meta b JOIN pg_proc p ON p.oid=b.oid
 WHERE b.proacl IS DISTINCT FROM p.proacl OR b.proowner<>p.proowner OR b.prosecdef<>p.prosecdef OR b.proconfig IS DISTINCT FROM p.proconfig
 OR (p.oid<>'public.get_market_trends(jsonb)'::regprocedure AND b.prosrc<>p.prosrc)),
 'descriptive: original scope/member/legacy API bodies and every existing ACL/owner/budget remain unchanged');
SELECT assert_count(NOT EXISTS(SELECT FROM descriptive_legacy_before b JOIN scopes s USING(label)
 WHERE b.receipt IS DISTINCT FROM pg_temp.unclocked(get_market_trends(s.req)))
 AND (SELECT receipt=pg_temp.unclocked(get_market_trends(captured_request())) FROM descriptive_captured_before),
 'descriptive: every existing make/supported-scope response and both metric payloads remain identical');
SELECT assert_count(NOT EXISTS((SELECT * FROM make_model_profiles EXCEPT SELECT * FROM descriptive_registry_before)
 UNION ALL (SELECT * FROM descriptive_registry_before EXCEPT SELECT * FROM make_model_profiles)),
 'descriptive: no registry policy, model bound, label or attribution is promoted or rewritten');
INSERT INTO make_model_profiles VALUES
 ('70000000-0000-4000-8000-000000000001','SYNTHETIC','MODEL','year',1977,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000002','SYNTHETIC','MODEL','model',NULL,1970,1990,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000003','SYNTHETIC','MODEL','generation',NULL,1976,1980,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000004','SYNTHETIC','MODEL','year',1969,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000005','BENCHMARK','MODEL','year',1977,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000006','SYNTHETIC','UNRELATED','year',1977,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000007','SYNTHETIC','MODEL','year',1977,NULL,NULL,NULL,'context_only',NULL),
 ('70000000-0000-4000-8000-000000000008','SYNTHETIC','MODEL','model',NULL,1976,1980,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000009','synthetic','model alias','year',1977,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000010','SYNTHETIC','MODEL','year',NULL,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000011','SYNTHETIC','MODEL','model',NULL,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL);
CREATE FUNCTION descriptive_request(n int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT captured_request()||jsonb_build_object('scope',jsonb_build_object('kind','descriptive_subject',
 'subject_id',('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid))
$$;
GRANT EXECUTE ON FUNCTION descriptive_request(int) TO anon,authenticated;
SET ROLE anon;
SELECT assert_count((SELECT array_agg(right(subject_id::text,3) ORDER BY subject_id)=ARRAY['001','002','009']
 FROM cohort_scope_rule(ARRAY(SELECT subject_id FROM make_model_profiles WHERE subject_id::text LIKE '70000000-%'),
 'captured_sell_through_descriptive') WHERE state='admitted'), 'descriptive: bounded catalog admits exact year/model FK/aliases; wrong make/name/year/key/range and generation refuse');
SELECT assert_count((SELECT count(*)=1 FROM cohort_scope_rule(ARRAY[
 '70000000-0000-4000-8000-000000000001'::uuid,'70000000-0000-4000-8000-000000000001'::uuid],
 'captured_sell_through_descriptive')) AND (SELECT count(*)=0 FROM cohort_scope_rule('{}'::uuid[],'captured_sell_through_descriptive')),
 'descriptive: duplicate candidates do not amplify; known empty catalog is empty');
SELECT assert_count(get_market_trends(descriptive_request())->>'state'='partial'
 AND captured_total(get_market_trends(descriptive_request()),'selected','numerator')=2
 AND captured_total(get_market_trends(descriptive_request()),'selected','denominator')=3
 AND get_market_trends(descriptive_request())#>>'{scope,admission_purpose}'='captured_sell_through_descriptive'
 AND get_market_trends(descriptive_request())#>>'{scope,comparison_scope_status}'='context_only',
 'descriptive: a context-only canonical year subject computes factual captured2/3 without activating valuation policy');
SELECT assert_count(get_market_trends(descriptive_request(2))->>'state'='partial'
 AND get_market_trends(descriptive_request(3))->>'reason'='unsupported_or_unknown_descriptive_subject'
 AND get_market_trends(descriptive_request(4))->>'reason'='unsupported_or_unknown_descriptive_subject'
 AND get_market_trends(descriptive_request(8))->>'reason'='unsupported_or_unknown_descriptive_subject',
 'descriptive: complete model range admitted; unproven generation/partial range and out-of-range year not admitted');
SELECT assert_count(get_market_trends(count_request()||jsonb_build_object('scope',descriptive_request()->'scope'))->>'reason'='scope_purpose_not_supported'
 AND get_market_trends(descriptive_request()||jsonb_build_object('scope',jsonb_build_object('kind','supported_subject',
 'subject_id','70000000-0000-4000-8000-000000000001')))->>'reason'='unsupported_or_unknown_subject',
 'descriptive: new purpose cannot backdoor legacy metric or supported valuation scope');
DO $$ BEGIN
 BEGIN PERFORM cohort_scope_rule(NULL::uuid[],'captured_sell_through_descriptive'); RAISE EXCEPTION 'accepted null array'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM cohort_scope_rule(array_fill('70000000-0000-4000-8000-000000000001'::uuid,ARRAY[1001]),'captured_sell_through_descriptive'); RAISE EXCEPTION 'accepted overcap'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM cohort_scope_rule('{}'::uuid[],'valuation'); RAISE EXCEPTION 'accepted unrelated purpose'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
-- Fresh source cases distinguish exact aliases from unregistered trim words and different model years.
INSERT INTO vehicles(id,make,model,year,canonical_make_id,is_public)
 SELECT ('71000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC',
 CASE i WHEN 1 THEN 'model alias' WHEN 2 THEN 'MODEL Sport' ELSE 'MODEL' END,
 CASE i WHEN 3 THEN 1978 ELSE 1977 END,'10000000-0000-0000-0000-000000000001',i<>4 FROM generate_series(1,4) i;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('72000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('71000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/descriptive-'||i,date_trunc('day',now())-interval '6 days'+interval '12 hours','sold',1000 FROM generate_series(1,4) i;
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(descriptive_request()),'selected','denominator')=4
 AND captured_total(get_market_trends(descriptive_request(2)),'selected','denominator')=5
 AND (SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='71000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id' IN('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004')),
 'descriptive: registered exact alias selected once, year changes membership, unknown trim unresolved, private source excluded');
RESET ROLE;
CREATE TEMP TABLE descriptive_pinned AS SELECT descriptive_request()||jsonb_build_object('evidence_limit',1,
 'evidence_bucket',(date_trunc('day',now())-interval '6 days')::date,'evidence_series','selected') AS req;
ALTER TABLE descriptive_pinned ADD COLUMN receipt jsonb;
UPDATE descriptive_pinned SET receipt=get_market_trends(req);
GRANT SELECT ON descriptive_pinned TO anon,authenticated;
SET ROLE anon;
SELECT assert_count((SELECT get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'state'='partial' FROM descriptive_pinned),
 'descriptive: stable exact cohort continuation is supported');
RESET ROLE;
INSERT INTO canonical_models VALUES('20000000-0000-0000-0000-000000000003','SYNTHETIC','CLASH',ARRAY['model alias'],1970,1990);
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(descriptive_request()),'selected','denominator')=3
 AND (SELECT get_market_trends(req||jsonb_build_object('evidence_offset',1,
 'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'reason'='evidence_snapshot_changed' FROM descriptive_pinned),
 'descriptive: competing registered alias becomes unresolved and invalidates the old cohort evidence page');
RESET ROLE;
SET statement_timeout='1s';
SELECT assert_count((SELECT count(*)=3 FROM cohort_scope_rule(ARRAY(SELECT subject_id FROM make_model_profiles WHERE subject_id::text LIKE '70000000-%'),'captured_sell_through_descriptive') WHERE state='admitted'),
 'descriptive: bounded rule read respects caller one-second budget');
RESET statement_timeout;
SELECT assert_count(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.cohort_scope_rule(uuid[],text)'::regprocedure)
 AND NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.oid='public.cohort_scope_rule(uuid[],text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),
 'descriptive: new metadata helper is invoker with named API execution only');

-- A valid registered year with no captured members remains a measured empty group.
INSERT INTO make_model_profiles VALUES
 ('70000000-0000-4000-8000-000000000012','SYNTHETIC','MODEL','year',1990,NULL,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000013','SYNTHETIC','MODEL','year',1977,1976,1980,'20000000-0000-0000-0000-000000000001','context_only',NULL),
 ('70000000-0000-4000-8000-000000000014','SYNTHETIC','MODEL','model',1977,1970,1990,'20000000-0000-0000-0000-000000000001','context_only',NULL);
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(descriptive_request(12)),'selected','denominator')=0
 AND captured_total(get_market_trends(descriptive_request(12)),'selected','ratio') IS NULL
 AND get_market_trends(descriptive_request(13))->>'state'='unavailable'
 AND get_market_trends(descriptive_request(14))->>'state'='unavailable',
 'descriptive: known empty year has zero denominator and unknown fraction; mixed year/range parameter shapes refuse');
SELECT assert_count((SELECT get_market_trends(req||jsonb_build_object('scope',descriptive_request(9)->'scope',
 'evidence_offset',1,'evidence_snapshot_hash',receipt#>>'{evidence,snapshot_hash}'))->>'reason'='evidence_snapshot_changed' FROM descriptive_pinned),
 'descriptive: another subject cannot continue the first subject snapshot even when its source labels overlap');
DO $$ BEGIN
 BEGIN PERFORM get_market_trends(descriptive_request()||jsonb_build_object('scope',
 (descriptive_request()->'scope')||jsonb_build_object('canonical_make_id','10000000-0000-0000-0000-000000000001')));
 RAISE EXCEPTION 'accepted mixed scope IDs'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT assert_count(captured_total(get_market_trends(descriptive_request()),'selected','denominator')=3,
 'descriptive: authenticated private-row visibility cannot change the public year cohort');
RESET ROLE;
-- Literal registered punctuation is not interpreted as a model regex or omitted word.
UPDATE canonical_models SET aliases=aliases||ARRAY['m+odel'] WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO vehicles(id,make,model,year,canonical_make_id)
 SELECT ('73000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC',
 CASE i WHEN 1 THEN 'm+odel' ELSE 'mmodel' END,1977,'10000000-0000-0000-0000-000000000001' FROM generate_series(1,2) i;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('74000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('73000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/descriptive-punctuation-'||i,date_trunc('day',now())-interval '6 days'+interval '13 hours','sold',2000 FROM generate_series(1,2) i;
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(descriptive_request()),'selected','denominator')=4
 AND (SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='73000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='73000000-0000-4000-8000-000000000002'),
 'descriptive: punctuation-bearing alias resolves literally; regex-like alternate stays unresolved');
RESET ROLE;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT ('75000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001',
 'https://bringatrailer.com/listing/descriptive-cap-'||i,date_trunc('day',now())-interval '6 days','live' FROM generate_series(1,2001) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request())->>'truncated'='true'
 AND (SELECT bool_and(x->>'numerator' IS NULL AND x->>'denominator' IS NULL AND x->>'ratio' IS NULL)
 FROM jsonb_array_elements(get_market_trends(descriptive_request())->'summary') x),
 'descriptive: shared candidate cap still withholds cohort totals and fractions instead of publishing partial zeros');
RESET ROLE;

-- Real registry shape: an ongoing named model has a known first year and an unknown end.
RESET ROLE;
DELETE FROM auction_events WHERE id::text LIKE '75000000-%';
UPDATE canonical_models SET year_end=NULL WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO make_model_profiles VALUES
 ('70000000-0000-4000-8000-000000000015','SYNTHETIC','MODEL','model',NULL,1970,NULL,'20000000-0000-0000-0000-000000000001','context_only',NULL);
SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request())->>'state'='partial'
 AND get_market_trends(descriptive_request())#>>'{scope,year}'='1977'
 AND get_market_trends(descriptive_request(15))->>'state'='partial'
 AND get_market_trends(descriptive_request(15))#>'{scope,year_end}'='null'::jsonb
 AND get_market_trends(descriptive_request(2))->>'state'='unavailable',
 'descriptive: unknown canonical end admits explicit year and matching open-ended model scope; no invented end or stale closed range');
RESET ROLE;
INSERT INTO vehicles(id,make,model,year,canonical_make_id)
 VALUES('76000000-0000-4000-8000-000000000001','SYNTHETIC','MODEL',NULL,'10000000-0000-0000-0000-000000000001');
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 VALUES('77000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',
 'https://bringatrailer.com/listing/descriptive-unknown-year',date_trunc('day',now())-interval '6 days'+interval '14 hours','sold',1000);
SET ROLE anon;
SELECT assert_count((SELECT count(*)=1 FROM jsonb_array_elements(get_market_trends(descriptive_request(15))#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='76000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='76000000-0000-4000-8000-000000000001'),
 'descriptive: unambiguous model label can join model-only scope with unknown vehicle year, never the exact year scope');
RESET ROLE;
INSERT INTO canonical_models VALUES('20000000-0000-0000-0000-000000000004','SYNTHETIC','HISTORIC MODEL',ARRAY['MODEL'],1900,1960);
SET ROLE anon;
SELECT assert_count(NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request(15))#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='76000000-0000-4000-8000-000000000001')
 AND captured_total(get_market_trends(descriptive_request()),'selected','denominator')=4,
 'descriptive: unknown year cannot choose between historic/current alias keys; known exact year still resolves correctly');
RESET ROLE;

INSERT INTO vehicles(id,make,model,year,canonical_make_id)
 VALUES('78000000-0000-4000-8000-000000000001','SYNTHETIC','MODEL',9999,'10000000-0000-0000-0000-000000000001');
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 VALUES('79000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001',
 'https://bringatrailer.com/listing/descriptive-invalid-year',date_trunc('day',now())-interval '6 days'+interval '14 hours','sold',1000);
SET ROLE anon;
SELECT assert_count(NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request(15))#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='78000000-0000-4000-8000-000000000001')
 AND (get_market_trends(descriptive_request(15))#>>'{coverage,unresolved_scope}')::int>0,
 'descriptive: invalid nonnull model year stays unresolved instead of becoming a positive model-only match');
RESET ROLE;

SET ROLE anon;
SELECT assert_count(get_market_trends(descriptive_request(5))#>>'{scope_admission,reason}'='make_key_label_conflict'
 AND get_market_trends(descriptive_request(7))#>>'{scope_admission,reason}'='unresolved_canonical_model'
 AND get_market_trends(descriptive_request(13))#>>'{scope_admission,reason}'='invalid_year_subject_shape',
 'descriptive: rejected scope returns its exact database admission reason instead of silently disappearing');
SELECT assert_count((SELECT count(*)=1 AND bool_and(state='unavailable' AND reason='unknown_subject')
 FROM cohort_scope_rule(ARRAY['70000000-0000-4000-8000-000000000099'::uuid],'captured_sell_through_descriptive')),
 'descriptive: unknown explicit registry key is one unavailable result, not an empty or accepted catalog');
RESET ROLE;

-- Equivalent registry spellings are folded in SQL for a bounded catalog; no client-side alias choice.
SET ROLE anon;
SELECT assert_count((SELECT count(*)=2 AND bool_and(canonical_model='MODEL'
 AND catalog_subject_id='70000000-0000-4000-8000-000000000001'::uuid AND equivalent_catalog_subjects=2)
 AND count(DISTINCT registered_model_label)=2
 FROM cohort_scope_rule(ARRAY['70000000-0000-4000-8000-000000000009'::uuid,
 '70000000-0000-4000-8000-000000000001'::uuid,'70000000-0000-4000-8000-000000000001'::uuid],
 'captured_sell_through_descriptive')),
 'descriptive: SQL folds equivalent label subjects to one deterministic catalog representative; raw labels and distinct source keys remain');
RESET ROLE;

INSERT INTO vehicles(id,make,model,year,canonical_make_id)
 SELECT ('7a000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE i WHEN 1 THEN 'syn' WHEN 2 THEN 'unregistered make spelling' ELSE 'BENCHMARK' END,'MODEL',1977,
 CASE WHEN i=1 THEN NULL ELSE '10000000-0000-0000-0000-000000000001'::uuid END FROM generate_series(1,3) i;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('7b000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('7a000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/descriptive-make-'||i,date_trunc('day',now())-interval '6 days'+interval '15 hours','sold',1000 FROM generate_series(1,3) i;
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(descriptive_request()),'selected','denominator')=6
 AND (SELECT count(*)=2 FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id' IN('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000002'))
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(descriptive_request())#>'{evidence,contributors}') e
 WHERE e->>'vehicle_id'='7a000000-0000-4000-8000-000000000003'),
 'descriptive: resolved make alias and canonical make key feed model resolution; conflicting recognized make remains unresolved');
RESET ROLE;
