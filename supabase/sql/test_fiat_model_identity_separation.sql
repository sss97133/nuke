-- Disposable PG17 only. Real model names, synthetic vehicle IDs/amounts; no retained private rows.
\ir test_model_identity_separation.sql
INSERT INTO public.canonical_makes(id,canonical_name,display_name,aliases) VALUES ('e54ede77-d649-4511-a5bd-84edb56512f3','Fiat','Fiat','{}');
INSERT INTO public.canonical_models(id,make,canonical_model,year_start,year_end,aliases) VALUES
('9da55c01-a98e-4a60-b60f-35898ffcf86a'::uuid,'Fiat','500',NULL,NULL,ARRAY['1100', '1100d', '1200', '126', '128', '130', '131', '1400', '1500', '1600s', '2300s', '500', '500c', '500d', '500f', '500f jolly', '500 jolly', '500l', '500n', '500r', '509 s', '519s', '600 jolly', 'barchetta', 'campagnola', 'eden roc', 'gamine', 'jolly', 'michelotti shellette', 'model 56', 'model 643', 'multipla', 'nuova 500', 'panda', 'shellette', 'spiaggetta', 'tipo 55', 'tipo 6', 'tipo 642', 'tipo 682', 'topolino', 'type 24/32', 'uno', '127a', '1300', '509', 'coupe 16v', 'project', 'siata 750', 'stabilimenti farina', 'pinin farina', 'bianchina', 'transformable', '1100es', 'gipsy', '110', '525n', 'tipo 1a', '1200tv', '1100b', '508', 'balilla', '127', 'trasformabile', '18p', '2300', 'nuova', 'tipo 2b', 'vetture speciali', 'millecento', '103e', '238']::text[]),
('00000000-0000-4000-f000-000000000189'::uuid,'Fiat','X1/9',1950,NULL,ARRAY['850', '850 spider', '850 sport spider', 'bertone x1/9', 'x1/9']::text[]);

INSERT INTO public.canonical_models(id,make,canonical_model,aliases) VALUES ('32a63235-29c4-403d-9a70-3f92c226cc55','Fiat','124 Spider',ARRAY['124','124 spider','spider']);
-- Synthetic alias-literal control, not a factory-model assertion.
INSERT INTO public.canonical_models(id,make,canonical_model,aliases) VALUES ('ef32ef69-1623-4bb5-83d9-2bf59161ab8c','Fixture','Literal control',ARRAY['prefix_%']);
-- Synthetic truck-date controls preserve the separately held GM lookup behavior.
INSERT INTO public.canonical_models(id,make,canonical_model,aliases,year_start,year_end) VALUES
 ('722604a1-167c-48bd-994a-c78f172b890c','Chevrolet','K1500',ARRAY['k1500'],1980,2000),
 ('d6707248-9655-47df-9a9f-51a45d5be7d5','Chevrolet','Silverado',ARRAY['silverado'],NULL,NULL);
-- Exact pre-repair deployed normalizer, pinned by the migration drift guard.
-- Restore only trailing blanks at runtime to reproduce the exact deployed definition fingerprint.
DO $baseline_fixture$
BEGIN
 EXECUTE replace($baseline_sql$
CREATE OR REPLACE FUNCTION public.normalize_vehicle_model(p_make text, p_raw_model text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(canonical_model text, canonical_series text, generation text, confidence integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  cleaned_model TEXT;
  v_canonical_model TEXT;
  v_canonical_series TEXT;
  v_generation TEXT;
  v_confidence INT := 0;
BEGIN
  IF p_raw_model IS NULL OR p_raw_model = '' THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, 0;
    RETURN;
  END IF;
@TRAILING_SPACE@@TRAILING_SPACE@
  -- Clean the input: lowercase, trim, remove common junk
  cleaned_model := LOWER(TRIM(p_raw_model));
  -- Remove location suffixes like "in Roseville, California"
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+in\s+[a-z]+.*$', '', 'i');
  -- Remove common noise words
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+(truck|vehicle|car|for sale)$', '', 'i');
  -- Normalize spaces
  cleaned_model := REGEXP_REPLACE(cleaned_model, '\s+', ' ', 'g');
@TRAILING_SPACE@@TRAILING_SPACE@
  -- Try exact alias match first
  SELECT cm.canonical_model, cm.canonical_series, cm.generation, 100
  INTO v_canonical_model, v_canonical_series, v_generation, v_confidence
  FROM canonical_models cm
  WHERE (cm.make ILIKE p_make OR p_make IS NULL)
    AND cleaned_model = ANY(cm.aliases)
    AND (p_year IS NULL OR (cm.year_start <= p_year AND (cm.year_end IS NULL OR cm.year_end >= p_year)))
  LIMIT 1;
@TRAILING_SPACE@@TRAILING_SPACE@
  IF v_canonical_model IS NOT NULL THEN
    RETURN QUERY SELECT v_canonical_model, v_canonical_series, v_generation, v_confidence;
    RETURN;
  END IF;
@TRAILING_SPACE@@TRAILING_SPACE@
  -- Try partial match (model contains alias)
  SELECT cm.canonical_model, cm.canonical_series, cm.generation, 75
  INTO v_canonical_model, v_canonical_series, v_generation, v_confidence
  FROM canonical_models cm
  WHERE (cm.make ILIKE p_make OR p_make IS NULL)
    AND EXISTS (
      SELECT 1 FROM unnest(cm.aliases) alias@TRAILING_SPACE@
      WHERE cleaned_model LIKE '%' || alias || '%'
    )
    AND (p_year IS NULL OR (cm.year_start <= p_year AND (cm.year_end IS NULL OR cm.year_end >= p_year)))
  ORDER BY length(cm.canonical_model) DESC  -- Prefer more specific matches
  LIMIT 1;
@TRAILING_SPACE@@TRAILING_SPACE@
  IF v_canonical_model IS NOT NULL THEN
    RETURN QUERY SELECT v_canonical_model, v_canonical_series, v_generation, v_confidence;
    RETURN;
  END IF;
@TRAILING_SPACE@@TRAILING_SPACE@
  -- No match found
  RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, 0;
END;
$function$;
$baseline_sql$,'@TRAILING_SPACE@',chr(32));
END $baseline_fixture$;
CREATE TEMP TABLE fiat_cases(model text,expected text,model_year integer);
INSERT INTO fiat_cases VALUES
 ('1100','1100',1955),('126','126',1980),('127','127',1975),('128','128',1972),
 ('130','130',1974),('131','131',1978),('panda 4x4','Panda',1997),('uno','Uno',1990),
 ('barchetta','Barchetta',1999),('850 sport spider','850',1973),('850 spider','850',1968),
 ('850 berlina','850',1966),('500','500',1967),('500f','500',1967),('nuova 500','500',1958),
 ('topolino','500',1939),('x1/9','X1/9',1980),('bertone x1/9','X1/9',1980),
 ('jolly',NULL,1966),('project',NULL,1974),('nuova',NULL,1974),('gamine',NULL,1968);
INSERT INTO public.vehicles(id,make,model,sale_date)
SELECT md5('Fiat'||model||g)::uuid,'Fiat',model,current_date-10 FROM fiat_cases CROSS JOIN generate_series(1,3) g;
INSERT INTO public.mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount)
SELECT md5('Fiat'||model||g)::uuid,'Fiat',model,model_year,'Bring a Trailer','sold',1000+g
FROM fiat_cases CROSS JOIN generate_series(1,3) g;
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('baseline: Panda is500 and850 Spider isX1/9',
 (SELECT family FROM public.mv_model_family_names WHERE make_l='fiat' AND model_l='panda 4x4')='500'
 AND (SELECT family FROM public.mv_model_family_names WHERE make_l='fiat' AND model_l='850 spider')='X1/9');
SELECT pg_temp.ok('baseline native normalizer refuses unknown ranges and prefers generic display length',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','panda',1997)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','850 sport spider 10',NULL))='124 Spider');
CREATE TEMP TABLE fiat_normalizer_metadata AS
SELECT oid,proowner,proacl FROM pg_proc WHERE oid='public.normalize_vehicle_model(text,text,integer)'::regprocedure;
CREATE TEMP TABLE fiat_raw_before AS
SELECT (SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY id)) FROM public.vehicles v) AS vehicles,
 (SELECT md5(string_agg(to_jsonb(o)::text,',' ORDER BY id)) FROM public.mv_treemap_outcomes o) AS outcomes;
CREATE TEMP TABLE fiat_totals_before AS SELECT sum(sold) AS sold,sum(usd) AS usd FROM public.mv_family_market WHERE brand='Fiat';
SELECT public.record_family_price_index(jsonb_build_object(
 'brand','Fiat','family_key','9da55c01-a98e-4a60-b60f-35898ffcf86a','fitted_at',now()-interval '1 hour',
 'period_kind',NULL,'series','[]'::jsonb,'change',jsonb_build_object('change_12m',0,'lo',-0.01,'hi',0.01,
 'n_last12',80,'n_prior12',80,'verdict','flat','method','hedonic_v1')));
\ir ../migrations/20261019000136_separate_fiat_model_identity.sql
CREATE TEMP TABLE fiat_catalog_after AS SELECT id,aliases,notes FROM public.canonical_models;
\ir ../migrations/20261019000136_separate_fiat_model_identity.sql
SELECT pg_temp.ok('Fiat repair is idempotent, including superseded aliases',
 NOT EXISTS(SELECT id,aliases,notes FROM public.canonical_models EXCEPT SELECT * FROM fiat_catalog_after)
 AND (SELECT count(*) FROM public.canonical_models)=(SELECT count(*) FROM fiat_catalog_after));
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('all22 names separate supported identities from ambiguous tokens',
 NOT EXISTS(SELECT 1 FROM fiat_cases c LEFT JOIN public.mv_model_family_names n
 ON n.make_l='fiat' AND n.model_l=c.model WHERE n.family IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('Topolino remains500; proper X1/9 aliases survive',
 (SELECT family FROM public.mv_model_family_names WHERE make_l='fiat' AND model_l='topolino')='500'
 AND (SELECT family FROM public.mv_model_family_names WHERE make_l='fiat' AND model_l='bertone x1/9')='X1/9');
SELECT pg_temp.ok('Fiat source rows, make-level counts and dollars are preserved',
 (SELECT vehicles FROM fiat_raw_before)=(SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY id)) FROM public.vehicles v)
 AND (SELECT outcomes FROM fiat_raw_before)=(SELECT md5(string_agg(to_jsonb(o)::text,',' ORDER BY id)) FROM public.mv_treemap_outcomes o)
 AND NOT EXISTS(SELECT sum(sold),sum(usd) FROM public.mv_family_market WHERE brand='Fiat' EXCEPT SELECT * FROM fiat_totals_before));
SELECT pg_temp.ok('saved contaminated Fiat fit withheld; unrelated Porsche fit survives',
 (public.family_price_index_read('Fiat','9da55c01-a98e-4a60-b60f-35898ffcf86a')->'change'->>'method')='identity_membership_changed_v1'
 AND (public.family_price_index_read('Fiat','9da55c01-a98e-4a60-b60f-35898ffcf86a')->'change'->>'change_12m') IS NULL
 AND (public.family_price_index_read('Porsche','00000000-0000-4000-b000-000000000001')->'change'->>'verdict')='flat');
SET ROLE anon;
SELECT pg_temp.ok('anonymous Panda sales reach their own key and leave500',
 (SELECT count(*) FROM public.treemap_family_sales('Fiat',
  (SELECT family_id::text FROM public.mv_model_family_names WHERE make_l='fiat' AND model_l='panda 4x4')))=3
 AND NOT EXISTS(SELECT 1 FROM public.treemap_family_sales('Fiat','9da55c01-a98e-4a60-b60f-35898ffcf86a') WHERE model LIKE 'panda%'));
RESET ROLE;

SELECT pg_temp.ok('intake uses supported Fiat names with unknown ranges and supplied years',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','panda 4x4 country club',1997))='Panda'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','850 sport spider',1973))='850'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','topolino',1939))='500');
SELECT pg_temp.ok('specific850 alias outranks generic Spider despite shorter display name',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','850 sport spider 10',1972))='850');
SELECT pg_temp.ok('normalizer preserves other makes and explicit date bounds; does not force unknown tokens',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Porsche','911',2000))='911'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Porsche','911 Carrera',2000))='911'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Porsche','911',1950)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Ford','panda',1997)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','project',1974)) IS NULL);
SELECT pg_temp.ok('same unknown-range correction supports earlier Bultaco and Suzuki repairs',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Bultaco','frontera 370',1977))='Frontera'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Suzuki','hayabusa',2000))='Hayabusa'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Suzuki','re5',1975))='RE-5');

SELECT pg_temp.ok('numeric boundaries preserve distinct and unassessed model codes',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','130',1974))='130'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','1300',1974)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Porsche','9110',2000)) IS NULL);
SELECT pg_temp.ok('literal aliases are not SQL wildcard patterns; whitespace is unknown',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Fixture','prefix_% extra',NULL))='Literal control'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fixture','prefixABC extra',NULL)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Fiat','   ',1997)) IS NULL);

SELECT pg_temp.ok('shared function preserves identity, owner and execution grants',
 (SELECT to_jsonb(p) FROM (SELECT oid,proowner,proacl FROM pg_proc
 WHERE oid='public.normalize_vehicle_model(text,text,integer)'::regprocedure) p)
 =(SELECT to_jsonb(p) FROM fiat_normalizer_metadata p));
SELECT pg_temp.ok('held GM and unqualified lookup paths keep their existing rules',
 (SELECT canonical_model FROM public.normalize_vehicle_model('Chevrolet','K1500 Silverado',1994))='K1500'
 AND (SELECT canonical_model FROM public.normalize_vehicle_model('Chevrolet','Silverado',2015)) IS NULL
 AND (SELECT canonical_model FROM public.normalize_vehicle_model(NULL,'panda',1997)) IS NULL);
