-- Empty disposable PG17 only; inherited fixtures and all added rows are synthetic.
\set ON_ERROR_STOP on
\ir test_market_scope_exclusion_evidence.sql
RESET ROLE;
DELETE FROM auction_events WHERE id::text LIKE '83000000-%';
ALTER TABLE canonical_makes ADD COLUMN display_name text, ADD COLUMN short_name text;
CREATE TABLE mv_model_family_names(make_l text,model_l text,vehicles bigint DEFAULT 1,make text,
 family_id uuid,family text,matched text,year_start int,year_end int,PRIMARY KEY(make_l,model_l));
GRANT SELECT ON mv_model_family_names TO anon,authenticated,service_role;
CREATE TABLE public.mv_family_market(
 brand text,family_key text,family text,model text,model_key text,sold bigint DEFAULT 1,
 sold_any bigint DEFAULT 1,offered bigint DEFAULT 1,usd bigint DEFAULT 100,bat_dated bigint DEFAULT 1,
 bat_sold_12m bigint DEFAULT 1,bat_sold_prior_12m bigint DEFAULT 1,
 bat_usd_12m bigint DEFAULT 100,bat_usd_prior_12m bigint DEFAULT 100,as_of timestamptz DEFAULT '2026-11-28Z');
GRANT SELECT ON mv_family_market TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text, p_family_key text)
 RETURNS TABLE(model text, sold bigint, sold_any bigint, offered bigint, usd bigint, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Colorado', 'Avalanche', 'SSR', 'LUV', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'C2500', 'K2500', 'C3500', 'K3500', 'Canyon', 'Hummer EV Pickup'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  matched_models AS (
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    JOIN target_keys tk ON tk.family_key = m.family_key
    WHERE m.brand = p_brand AND m.sold > 0
    UNION
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    WHERE m.brand = p_brand AND m.sold > 0
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND m.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND m.model ILIKE '%sierra%'
        )
      )
  )
  SELECT model, sold, sold_any, offered, usd, bat_dated,
         bat_sold_12m, bat_sold_prior_12m, bat_usd_12m, bat_usd_prior_12m, as_of
  FROM matched_models
  ORDER BY usd DESC, model_key
  LIMIT 200;
$function$;

REVOKE ALL ON FUNCTION public.treemap_family_models(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_models(text,text) TO anon,authenticated,service_role;
INSERT INTO mv_family_market(brand,family_key,family,model,model_key,sold,usd) VALUES
 ('Chevrolet','camaro','Camaro','Camaro Coupe 6-Speed','camaro coupe 6-speed',1,800),
 ('Chevrolet','k5','K5 Blazer','K5 Blazer Cheyenne','k5 blazer cheyenne',1,600),
 ('Chevrolet','pickup','Pickup','Pickup','pickup',1,500),
 ('Chevrolet','c10','C10','C10 Silverado','c10 silverado',1,400),
 ('Chevrolet','silverado','Silverado','Silverado','silverado',1,300),
 ('Chevrolet','other',NULL,'unmapped Silverado trim','unmapped silverado trim',1,200),
 ('Chevrolet','zero','C20','C20','c20',0,900),
 ('Chevrolet','exclude','El Camino','El Camino','el camino',1,900),
 ('GMC','pickup','Pickup','Pickup','pickup',1,600),
 ('GMC','c15','C1500','C1500 Sierra','c1500 sierra',1,500),
 ('GMC','sierra','Sierra','Sierra','sierra',1,400),
 ('GMC','other',NULL,'Sierra label only','sierra label only',1,300),
 ('GMC','exclude','Caballero','Caballero','caballero',1,900),
 ('Ford','pickup','Pickup','Pickup','pickup',1,500),
 ('Ford','f150','F-150','F-150','f-150',1,400),
 ('Ford','mustang','Mustang','Mustang','mustang',1,900);
-- Exercise both the legacy 200-row presentation cap and the new 1000-key
-- admission cap. Neither cap can silently change the old model list.
INSERT INTO mv_family_market(brand,family_key,family,model,model_key,usd)
 SELECT 'Chevrolet','extra-'||i,'C10','Extra '||i,'extra '||i,10000+i FROM generate_series(1,1001) i;
CREATE TEMP TABLE family_list_scopes AS
 SELECT DISTINCT brand,family_key FROM mv_family_market
 UNION SELECT 'unknown','unknown' UNION SELECT 'chevrolet','camaro' UNION SELECT 'Chevrolet',NULL;
CREATE TEMP TABLE family_list_before AS
 SELECT s.*,coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM treemap_family_models(s.brand,s.family_key) m),'[]') receipt
 FROM family_list_scopes s;
CREATE TEMP TABLE family_meta_before AS SELECT oid,proowner,proacl,proconfig,prosecdef,prosrc
 FROM pg_proc WHERE oid IN('public.treemap_family_models(text,text)'::regprocedure,'public.get_market_trends(jsonb)'::regprocedure);
CREATE TEMP TABLE family_legacy_before AS
 SELECT label,req,pg_temp.unclocked(get_market_trends(req)) receipt FROM scopes
 UNION ALL SELECT 'descriptive',descriptive_request(),pg_temp.unclocked(get_market_trends(descriptive_request()))
 UNION ALL SELECT 'captured make',captured_request(),pg_temp.unclocked(get_market_trends(captured_request()))
 UNION ALL SELECT label||' captured',r,pg_temp.unclocked(get_market_trends(r)) FROM(
 SELECT label,req||jsonb_build_object('metric','captured_sell_through','reserve_policy','all_recorded_policies',
 'event_from',captured_request()->>'event_from','event_to',captured_request()->>'event_to') r FROM scopes) x;
\ir ../migrations/20261128102621_recorded_market_family_scope.sql
\ir ../migrations/20261128102621_recorded_market_family_scope.sql
SELECT assert_count(NOT EXISTS(SELECT FROM family_list_before b WHERE b.receipt IS DISTINCT FROM
 coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM treemap_family_models(b.brand,b.family_key) m),'[]')),
 'family recipe: every legacy model list unchanged, including unknown/case/other and both caps');
SELECT assert_count(NOT EXISTS(SELECT FROM family_meta_before b JOIN pg_proc p USING(oid)
 WHERE b.proowner<>p.proowner OR b.proacl IS DISTINCT FROM p.proacl OR b.proconfig IS DISTINCT FROM p.proconfig
 OR b.prosecdef<>p.prosecdef), 'family recipe: existing owners, grants, budgets and invoker metadata preserved');
SELECT assert_count(NOT EXISTS(SELECT FROM family_legacy_before b WHERE b.receipt IS DISTINCT FROM
 pg_temp.unclocked(get_market_trends(b.req))), 'family recipe: all existing market payloads preserved');
SET ROLE anon;
SELECT assert_count(treemap_family_models('Chevrolet','camaro','recorded_family_rule')->>'family'='Camaro'
 AND treemap_family_models('CHEVROLET','camaro','recorded_family_rule')->>'state'='available'
 AND treemap_family_models('Chevrolet','unknown','recorded_family_rule')->>'state'='unavailable',
 'family recipe: existing family keys and unique case spelling, explicit unknown-key refusal');
SELECT assert_count(treemap_family_models('Chevrolet','pickup','recorded_family_rule')->>'reason'='family_rule_key_cap_exceeded'
 AND treemap_family_models('Chevrolet','silverado','recorded_family_rule')->'model_contains'='["silverado"]'
 AND treemap_family_models('GMC','sierra','recorded_family_rule')->'model_contains'='["sierra"]'
 AND treemap_family_models('Ford','pickup','recorded_family_rule')->'family_keys'='["f150", "pickup"]',
 'family recipe: explicit over-cap and original declared series/umbrella recipes');
SELECT assert_count(treemap_family_models('Chevrolet','other','recorded_family_rule')->>'bucket_kind'='unresolved_or_rare'
 AND treemap_family_models('Chevrolet','camaro','recorded_family_rule')->>'dictionary_row_clock'='unavailable'
 AND treemap_family_models('Chevrolet','camaro','recorded_family_rule')->>'factory_configuration_verified'='false',
 'family recipe: mixed other bucket, unknown dictionary clock and no factory promotion remain explicit');
DO $$ BEGIN
 BEGIN PERFORM treemap_family_models('Chevrolet','camaro','valuation');
 RAISE EXCEPTION 'accepted valuation purpose'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
SELECT assert_count((SELECT NOT prosecdef AND proconfig=ARRAY['search_path=public, pg_temp'] FROM pg_proc
 WHERE oid='public.treemap_family_models(text,text,text)'::regprocedure)
 AND NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.oid='public.treemap_family_models(text,text,text)'::regprocedure AND a.grantee=0),
 'family recipe: invoker with pinned path and no PUBLIC execute');

DELETE FROM auction_events;
-- Five representative auction episodes: two decorated Camaro labels and three
-- K5 labels, including two same-name canonical model rows. All keys synthetic.
DELETE FROM mv_family_market;
INSERT INTO canonical_makes(id,canonical_name,aliases) VALUES
 ('94000000-0000-4000-8000-000000000001','CHEVROLET',ARRAY['Chevy']),
 ('94000000-0000-4000-8000-000000000002','GMC','{}'),
 ('94000000-0000-4000-8000-000000000003','Ford','{}');
INSERT INTO canonical_models(id,make,canonical_model,aliases,year_start,year_end) VALUES
 ('95000000-0000-4000-8000-000000000001','Chevrolet','Camaro',ARRAY['camaro','shared'],1967,2026),
 ('95000000-0000-4000-8000-000000000002','Chevrolet','K5 Blazer',ARRAY['k5 blazer','blazer','shared'],1969,1991),
 ('95000000-0000-4000-8000-000000000003','Chevrolet','K5 Blazer',ARRAY['blazer k5'],1969,1991),
 ('95000000-0000-4000-8000-000000000004','Chevrolet','Pickup',ARRAY['truck'],1900,2026),
 ('95000000-0000-4000-8000-000000000005','Chevrolet','Silverado',ARRAY['silverado'],1999,2026),
 ('95000000-0000-4000-8000-000000000006','Chevrolet','C10',ARRAY['c10'],1960,1987),
 ('95000000-0000-4000-8000-000000000007','Chevrolet','El Camino',ARRAY['el camino'],1959,1987);
INSERT INTO mv_family_market(brand,family_key,family,model,model_key)
 SELECT 'Chevrolet',id::text,canonical_model,canonical_model,lower(canonical_model)
 FROM canonical_models WHERE id::text LIKE '95000000-%' AND id<>'95000000-0000-4000-8000-000000000003';
INSERT INTO mv_family_market(brand,family_key,family,model,model_key) VALUES
 ('Chevrolet','other',NULL,'unmapped','unmapped');
INSERT INTO vehicles(id,make,model,year,canonical_make_id)
 SELECT ('91000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Chevrolet',
 CASE WHEN i<=2 THEN 'Camaro Coupe 6-Speed' WHEN i=3 THEN 'K5 Blazer 4×4'
 WHEN i=4 THEN 'K5 Blazer' ELSE 'K5 Blazer Cheyenne 4''4' END,
 CASE WHEN i<=2 THEN 1969 WHEN i=3 THEN 1971 WHEN i=4 THEN 1978 ELSE 1973 END,
 '94000000-0000-4000-8000-000000000001'::uuid FROM generate_series(1,5) i;
INSERT INTO mv_model_family_names(make_l,model_l,make,family_id,family,matched,year_start,year_end)
 SELECT DISTINCT lower(v.make),lower(v.model),'CHEVROLET',r.id,r.canonical_model,
 CASE WHEN v.year=1969 THEN 'camaro' ELSE 'k5 blazer' END,r.year_start,r.year_end
 FROM vehicles v JOIN canonical_models r ON r.id=CASE WHEN v.year=1969
 THEN '95000000-0000-4000-8000-000000000001'::uuid ELSE '95000000-0000-4000-8000-000000000002'::uuid END
 WHERE v.id::text LIKE '91000000-%';
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT ('92000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('91000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/family-'||i,date_trunc('day',now())-interval '6 days'+i*interval '1 minute',
 CASE WHEN i<=2 THEN 'reserve_not_met' ELSE 'sold' END FROM generate_series(1,5) i;
CREATE FUNCTION family_request(k int DEFAULT 1,y int DEFAULT NULL,m text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT captured_request()||jsonb_build_object('scope',jsonb_strip_nulls(jsonb_build_object(
 'kind','recorded_family','canonical_make_id','94000000-0000-4000-8000-000000000001',
 'family_key',('95000000-0000-4000-8000-'||lpad(k::text,12,'0')),'year',y,'model_name',m)))
$$;
GRANT EXECUTE ON FUNCTION family_request(int,int,text) TO anon,authenticated;
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(1,1969)),'selected','numerator')=0
 AND captured_total(get_market_trends(family_request(1,1969)),'selected','denominator')=2
 AND captured_total(get_market_trends(family_request(1,1969)),'selected','ratio')=0,
 'recorded family: both decorated Camaro episodes are evidenced RNM, so known 0/2 rather than unknown or sold');
SELECT assert_count(captured_total(get_market_trends(family_request(2)),'selected','numerator')=3
 AND captured_total(get_market_trends(family_request(2)),'selected','denominator')=3
 AND (SELECT bool_and(e#>>'{membership,recorded_family_id}'='95000000-0000-4000-8000-000000000002'
 AND e#>>'{membership,current_longest_family_count}'='1')
 FROM jsonb_array_elements(get_market_trends(family_request(2))#>'{evidence,contributors}') e WHERE e->>'series'='selected'),
 'recorded family: all three K5 spellings use one registered family; duplicate same-name rows are witnesses, not two competing families');
SELECT assert_count(captured_total(get_market_trends(family_request(2,1971)),'selected','denominator')=1
 AND captured_total(get_market_trends(family_request(2,NULL,' K5 BLAZER ')),'selected','denominator')=1
 AND captured_total(get_market_trends(family_request(2,NULL,'K5 Blazer%')),'selected','denominator')=0,
 'recorded family: optional exact year and literal model label narrow the same recipe; percent is not a wildcard');
SELECT assert_count(captured_total(get_market_trends(family_request(2)||jsonb_build_object('scope',
 family_request(2)->'scope'||'{"year_start":1970,"year_end":1973}')),'selected','denominator')=2,
 'recorded family: an inclusive declared year range narrows the same episode population');
SELECT rejects_count(family_request(2)||jsonb_build_object('scope',family_request(2)->'scope'||'{"year_start":1970}'),'range requires both bounds');
SELECT rejects_count(family_request(2)||jsonb_build_object('scope',family_request(2)->'scope'||'{"year_start":1980,"year_end":1970}'),'inverted range refused');
SELECT rejects_count(family_request(2,1971)||jsonb_build_object('scope',family_request(2,1971)->'scope'||'{"year_start":1970,"year_end":1980}'),'range and exact year cannot be conflated');
SELECT assert_count(get_market_trends((family_request(1)-'reserve_policy')||'{"metric":"recorded_sale_events"}')->>'reason'='scope_purpose_not_supported'
 AND get_market_trends(jsonb_set(family_request(1),'{scope,family_key}','"other"'))->>'reason'='mixed_other_bucket_not_a_family_scope'
 AND get_market_trends(jsonb_set(family_request(1),'{scope,family_key}','"unknown"'))->>'reason'='unknown_recorded_family',
 'recorded family: no valuation promotion, mixed-other guessing, unknown-key broadening or legacy metric change');
SELECT rejects_count(jsonb_set(family_request(1),'{scope,year}','"1969"'),'year must be typed number');
SELECT rejects_count(jsonb_set(family_request(1),'{scope,year}','1969.5'),'no fractional year');
SELECT rejects_count(jsonb_set(family_request(1),'{scope,year}','1777'),'no invalid year');
SELECT rejects_count(jsonb_set(family_request(1),'{scope,subject_id}','"70000000-0000-4000-8000-000000000001"'),'no mixed scope keys');
RESET ROLE;
-- Additional failure classes. Manually stated expected reasons are independent
-- of the implementation's classification expressions.
CREATE TEMP TABLE family_failure_cases(i,model,year,expected_reason) AS VALUES
 (6,'Camaro Fresh Label',1969,'dictionary_name_missing'),
 (7,'Camaro Unmapped',1969,'unmapped_recorded_model'),
 (8,'Shared',1969,'ambiguous_longest_registered_family_phrases'),
 (9,'Camaro Stale Family',1969,'stale_dictionary_family_or_phrase'),
 (10,'Camaro Retired Alias',1969,'stale_dictionary_family_or_phrase'),
 (11,'Camaro Coupe 6-Speed',1777,'invalid_recorded_year'),
 (12,'Camaro Coupe 6-Speed',NULL,NULL),
 (13,'Camaro Coupe 6-Speed',1960,'recorded_year_outside_family_range'),
 (14,NULL,1969,'missing_recorded_model_label'),
 (15,'Camaro Coupe 6-Speed',1969,NULL), -- private
 (16,'Camaro Coupe 6-Speed',1969,NULL), -- deleted
 (17,'Camaro Coupe 6-Speed',1969,NULL); -- nonvehicle
INSERT INTO vehicles(id,make,model,year,canonical_make_id,is_public,deleted_at,listing_kind)
 SELECT ('91000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Chevrolet',model,year,
 '94000000-0000-4000-8000-000000000001'::uuid,i<>15,CASE WHEN i=16 THEN now() END,
 CASE WHEN i=17 THEN 'non_vehicle_item' ELSE 'vehicle' END FROM family_failure_cases;
INSERT INTO mv_model_family_names(make_l,model_l,make,family_id,family,matched,year_start,year_end) VALUES
 ('chevrolet','camaro unmapped','CHEVROLET',NULL,NULL,NULL,NULL,NULL),
 ('chevrolet','shared','CHEVROLET','95000000-0000-4000-8000-000000000001','Camaro','shared',1967,2026),
 ('chevrolet','camaro stale family','CHEVROLET','95000000-0000-4000-8000-000000000002','K5 Blazer','k5 blazer',1969,1991),
 ('chevrolet','camaro retired alias','CHEVROLET','95000000-0000-4000-8000-000000000001','Camaro','retired alias',1967,2026);
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date)
 SELECT ('92000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('91000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/family-'||i,date_trunc('day',now())-interval '6 days'+i*interval '1 minute'
 FROM family_failure_cases;
GRANT SELECT ON family_failure_cases TO anon,authenticated;
SET ROLE anon;
SELECT assert_count(NOT EXISTS(SELECT FROM family_failure_cases f WHERE f.expected_reason IS NOT NULL AND NOT EXISTS(
 SELECT FROM jsonb_array_elements(get_market_trends(family_request(1))#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='91000000-0000-4000-8000-'||lpad(f.i::text,12,'0') AND e->>'membership_reason'=f.expected_reason)),
 'recorded family: missing/unmapped names, competing longest phrases, stale family/alias, invalid year, outside range and missing model all explain exact source/key failures');
SELECT assert_count(captured_total(get_market_trends(family_request(1)),'selected','denominator')=3
 AND (SELECT count(*)=0 FROM jsonb_array_elements(get_market_trends(family_request(1))#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id' IN('91000000-0000-4000-8000-000000000015','91000000-0000-4000-8000-000000000016','91000000-0000-4000-8000-000000000017'))
 AND get_market_trends(family_request(1))#>'{scope_exclusions,total}'=get_market_trends(family_request(1))#>'{coverage,unresolved_scope}',
 'recorded family: unknown year is allowed only without exact year; private/deleted/nonvehicle rows consume no count or exclusion slot');
SELECT assert_count(EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(family_request(1,1969))#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='91000000-0000-4000-8000-000000000012' AND e->>'membership_reason'='missing_recorded_year')
 AND get_market_trends(family_request(1))#>>'{scope_exclusions,contract_version}'='2'
 AND (SELECT bool_and(NOT(e ? 'exact_registered_model_count') AND e ? 'membership')
 FROM jsonb_array_elements(get_market_trends(family_request(1))#>'{scope_exclusions,records}') e),
 'recorded family: exact-year unknown is unresolved; version2explanations never pretend family counts are exact model matches');
RESET ROLE;
CREATE TEMP TABLE family_pinned AS SELECT r,get_market_trends(r) payload FROM(
 SELECT family_request(1)||jsonb_build_object('evidence_bucket',(date_trunc('day',now())-interval '6 days')::date,
 'evidence_series','selected','evidence_limit',1) r) x;
GRANT SELECT ON family_pinned TO anon,authenticated;
UPDATE canonical_models SET aliases=aliases||ARRAY['new recorded alias'] WHERE id='95000000-0000-4000-8000-000000000003';
SET ROLE anon;
SELECT assert_count((SELECT get_market_trends(r)#>'{summary}'=payload#>'{summary}'
 AND get_market_trends(r)#>>'{evidence,snapshot_hash}'<>payload#>>'{evidence,snapshot_hash}'
 AND get_market_trends(r||jsonb_build_object('evidence_offset',1,'evidence_snapshot_hash',payload#>>'{evidence,snapshot_hash}'))->>'reason'='evidence_snapshot_changed'
 FROM family_pinned), 'recorded family: late registry witness changes invalidate continuation even with identical visible fractions');
RESET ROLE;
-- The model list's sold>0 and200row presentation filter is never used as the
-- auction population. A no-sale/never-priced label keeps its source episode.
UPDATE mv_family_market SET sold=0 WHERE family_key='95000000-0000-4000-8000-000000000001';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(1,1969)),'selected','denominator')=2,
 'recorded family: no-sale cohort does not vanish through a sales-only model list');
RESET ROLE;
INSERT INTO vehicles(id,make,model,year,canonical_make_id) VALUES
 ('91000000-0000-4000-8000-000000000020','Chevrolet','C10 Silverado',1974,'94000000-0000-4000-8000-000000000001'),
 ('91000000-0000-4000-8000-000000000021','Chevrolet','El Camino',1974,'94000000-0000-4000-8000-000000000001'),
 ('91000000-0000-4000-8000-000000000022','Unknown make','Camaro Coupe 6-Speed',1969,NULL);
INSERT INTO mv_model_family_names(make_l,model_l,make,family_id,family,matched,year_start,year_end) VALUES
 ('chevrolet','c10 silverado','CHEVROLET','95000000-0000-4000-8000-000000000006','C10','c10',1960,1987),
 ('chevrolet','el camino','CHEVROLET','95000000-0000-4000-8000-000000000007','El Camino','el camino',1959,1987);
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date)
 SELECT ('92000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('91000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'https://bringatrailer.com/listing/family-'||i,date_trunc('day',now())-interval '6 days'+i*interval '1 minute'
 FROM generate_series(20,22) i;
-- Equivalent aliases once, contradictory aliases unresolved with both keys.
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT '92000000-0000-4000-8000-000000000023',vehicle_id,source_url||'/',auction_end_date,outcome
 FROM auction_events WHERE id='92000000-0000-4000-8000-000000000001';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(1,1969)),'selected','denominator')=2
 AND (SELECT count(*)=1 AND bool_and(e#>>'{membership,series_name_contains}'='silverado')
 FROM jsonb_array_elements(get_market_trends(family_request(5))#>'{evidence,contributors}') e WHERE e->>'series'='selected')
 AND captured_total(get_market_trends(family_request(4)),'selected','denominator')=1,
 'recorded family: equivalent source aliases once; explicit Silverado source-word grouping includes old C10; pickup includes C10 and excludes El Camino');
SELECT assert_count(EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(family_request(1))#>'{scope_exclusions,records}') e
 WHERE e->>'membership_reason'='unresolved_make'), 'recorded family: unknown make never becomes benchmark or selected');
RESET ROLE;
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome)
 SELECT '92000000-0000-4000-8000-000000000024','91000000-0000-4000-8000-000000000003',
 source_url||'/',auction_end_date,outcome FROM auction_events WHERE id='92000000-0000-4000-8000-000000000002';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(1,1969)),'selected','denominator')=1
 AND EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(family_request(1))#>'{scope_exclusions,records}') e
 WHERE e->>'membership_reason'='conflicting_listing_aliases' AND jsonb_array_length(e->'source_event_ids')=2),
 'recorded family: conflicting source-parent aliases are excluded and explained with both source keys');
RESET ROLE;
-- Simulate the existing canonical-source owner's withdrawal/supersession without
-- changing the reader. Native source fixture only, never a testimony repair.
ALTER TABLE auction_events ADD COLUMN fixture_superseded boolean DEFAULT false;
CREATE OR REPLACE VIEW auction_events_canonical WITH(security_invoker=true) AS
 SELECT * FROM auction_events WHERE fixture_superseded IS NOT TRUE;
UPDATE auction_events SET fixture_superseded=true WHERE vehicle_id='91000000-0000-4000-8000-000000000001';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(1,1969)),'selected','denominator')=0,
 'recorded family: canonical-source withdrawal removes superseded evidence; no raw-row resurrection');
RESET ROLE;
UPDATE auction_events SET updated_at=now()+interval '1 day' WHERE vehicle_id='91000000-0000-4000-8000-000000000004';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(2)),'selected','denominator')=2,
 'recorded family: future source write stays outside knowledge; a separate valid episode on the alias-conflicted parent remains');
RESET ROLE;
-- Changed dictionary bounds are stale relative to the current registry.
UPDATE mv_model_family_names SET year_start=1970 WHERE model_l='k5 blazer cheyenne 4''4';
SET ROLE anon;
SELECT assert_count(captured_total(get_market_trends(family_request(2)),'selected','denominator')=1
 AND EXISTS(SELECT FROM jsonb_array_elements(get_market_trends(family_request(2))#>'{scope_exclusions,records}') e
 WHERE e->>'vehicle_id'='91000000-0000-4000-8000-000000000005' AND e->>'membership_reason'='stale_dictionary_family_or_phrase'),
 'recorded family: stale family bounds refuse current membership rather than inventing compatibility');
RESET ROLE;
INSERT INTO canonical_models(id,make,canonical_model,aliases,year_start,year_end)
 SELECT ('96000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Chevrolet','Overflow '||i,'{}',1900,2026
 FROM generate_series(1,1001) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(family_request(1))->>'reason'='family_registry_model_cap_exceeded',
 'recorded family: bounded current registry sentinel refuses over-cap instead of emitting partial membership fractions');
RESET ROLE;
DELETE FROM canonical_models WHERE id::text LIKE '96000000-%';
INSERT INTO auction_events(id,vehicle_id,source_url,auction_end_date,outcome,winning_bid)
 SELECT ('97000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'91000000-0000-4000-8000-000000000005',
 'https://bringatrailer.com/listing/family-overflow-'||i,date_trunc('day',now())-interval '6 days','sold',1000
 FROM generate_series(1,2001) i;
SET ROLE anon;
SELECT assert_count(get_market_trends(family_request(1))#>>'{scope_exclusions,state}'='unavailable'
 AND get_market_trends(family_request(1))#>'{scope_exclusions,total}'='null'::jsonb
 AND get_market_trends(family_request(1))#>'{scope_exclusions,records}'='[]'::jsonb
 AND captured_total(get_market_trends(family_request(1)),'selected','denominator') IS NULL,
 'recorded family: candidate cap withholds fractions, exact unresolved totals and source explanations together');
RESET ROLE;
