-- GM truck cross-model aliases: actual cohort reader, family fold, fit writer and normalizer; disposable PG17 only.
-- Builds on the K10 Custom precedent's fixture. Vehicle IDs and amounts below are synthetic; catalog rows are the live
-- rows (ids, make spelling and alias arrays read 2026-11-21).
\ir test_chevrolet_k10_custom_alias.sql

-- Live catalog state: the precedent already removed 'k10 custom'; the C10 rows still carry the bare 'cheyenne'.
DELETE FROM canonical_models WHERE id IN ('022cef91-1b4b-406d-9f39-d08072175cbd','5d4192f0-9d02-497f-b4a9-c890c42414fa',
 '023c138f-2f9e-4023-a3c3-bbdc2e1c0b43','87fb1e59-3e43-4b01-83ff-d6f679192ccd');
INSERT INTO canonical_models(id,make,canonical_model,canonical_series,year_start,year_end,aliases) VALUES
('022cef91-1b4b-406d-9f39-d08072175cbd','CHEVROLET','C10','C/K',1947,NULL,'{c/10,c10,"C 10",C-10,"c10 cheyenne","c10 custom","c-10 silverado","c10 silverado",cheyenne,"c/k 10",ck10,r-10,r10,"r-10 silverado","r10 silverado"}'),
('5d4192f0-9d02-497f-b4a9-c890c42414fa','Chevrolet','C10','C/K Series',1947,NULL,'{"c 10",c-10,c/10,c10,"c10 cheyenne","c10 custom","c-10 pickup","c10 pickup","c-10 silverado","c10 silverado",cheyenne,r-10,r10,"r-10 silverado","r10 silverado","c10 custom pickup","c10 scottsdale","c10 custom deluxe"}'),
('345a7ab6-4ce8-417e-b2e1-2c539d7de6f2','Chevrolet','C20','C/K Series',1960,1987,'{c20,c-20,"c 20",r20,r-20,"c20 silverado","c-20 silverado","r20 silverado","r-20 silverado","c20 custom pickup","c20 cheyenne","c20 scottsdale","c20 custom","scottsdale c20"}'),
('023c138f-2f9e-4023-a3c3-bbdc2e1c0b43','CHEVROLET','K10','C/K',1960,1987,'{k10,K-10,"K 10","c/k 10 4x4",v10,v-10,"k10 silverado","k-10 silverado","v10 silverado","v-10 silverado"}'),
('87fb1e59-3e43-4b01-83ff-d6f679192ccd','Chevrolet','K10','C/K Series',1960,1987,'{k10,k-10,"k 10","k10 4x4","k-10 4x4",v10,v-10,"k10 silverado","k-10 silverado","v10 silverado","v-10 silverado","k10 custom pickup","k10 cheyenne","k10 cheyenne super custom pickup","k10 scottsdale","k10 scottsdale custom pickup","k10 custom"}'),
('c9f4d39f-b79b-4c15-b00e-1ddde0df9be5','Chevrolet','K5 Blazer','Blazer',1969,1991,'{k5,"k5 blazer",blazer,k-5,"k 5 blazer","full size blazer"}'),
('ca121299-c4e4-4175-b705-0002d458b7d0','GMC','K1500','C/K',1960,NULL,'{k10,k-15,k15,k1500,K-1500,"k1500 sierra","k1500 sierra classic","k15 sierra",k20,k25,k2500,k30,k35,k3500,v-1500,v1500,"v1500 sierra"}'),
('0ad28a5e-0e45-4280-935c-f6cff2154c28','GMC','C1500','C/K',1960,NULL,'{1500,"1500 sierra","1500 sierra classic",c10,c-15,c15,c1500,C-1500,"c1500 sierra","c15 sierra",c20,c25,c2500,c30,c35,c3500,r-1500,r1500,"r1500 sierra"}'),
('fbd96a44-fc26-42e5-aa8e-dc285ee56ff9','GMC','Suburban','Suburban',1935,NULL,'{"gmc suburban",jimmy,suburban,yukon,"yukon denali","yukon xl"}'),
('e982bd2c-d8f5-484b-91ac-850f21d764f3','GMC','Jimmy',NULL,1970,1991,'{jimmy,"full size jimmy","k5 jimmy"}'),
('dbba5e0a-19d6-429f-b1b6-3b51626ae8bf','GMC','Yukon',NULL,NULL,NULL,'{yukon}');
INSERT INTO canonical_makes(id,canonical_name,display_name,aliases)
SELECT '13333333-2222-4222-8222-222222222222','GMC','GMC','{}' WHERE NOT EXISTS (SELECT FROM canonical_makes WHERE canonical_name='GMC');

-- Snapshot of the live reader (pg_get_functiondef read 2026-11-21; body identical to
-- 20260928183000_market_readers_skip_non_vehicle_lots.sql), with the profile columns it reads.
CREATE TABLE make_model_profiles(subject_id uuid PRIMARY KEY, canonical_make text, canonical_model text, grain text,
 year integer, year_start integer, year_end integer, canonical_model_id uuid);
CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE p record; alts text; pattern text;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT string_agg(
           regexp_replace(lower(t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|')
    INTO alts
  FROM (
    SELECT lower(p.canonical_model) AS t
    UNION
    SELECT lower(a) FROM public.canonical_models cm, unnest(cm.aliases) a
     WHERE cm.id = p.canonical_model_id
  ) s
  WHERE t IS NOT NULL AND length(trim(t)) > 0;

  IF alts IS NULL OR alts = '' THEN RETURN; END IF;
  pattern := '\y(' || alts || ')\y';

  IF p.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year, pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %s AND %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year_start, p.year_end, pattern);
  END IF;
END;
$function$;
-- Snapshot of the live class price resolver (body identical to 20261121110000_class_price_cohorts_and_queue.sql and
-- to pg_get_functiondef read 2026-11-21).
CREATE OR REPLACE FUNCTION public.resolve_class_price_cohort(p_make text, p_model text, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_model    text := lower(btrim(coalesce(p_model, '')));
  v_exact    text[]; v_named text[]; v_prof text[];
  v_canon    text; v_name text; v_tier text := 'none'; v_subject uuid;
  v_refusal  text; v_reg_refusal text; v_register boolean := false;
BEGIN
  IF p_make IS NULL OR p_year IS NULL OR v_model = '' THEN
    RETURN jsonb_build_object('tier', 'none', 'register', false, 'refusal', 'vehicle missing year, make or model');
  END IF;

  IF v_model ~ '\y(kit|replica)\y' THEN
    v_refusal := 'the model names a kit or replica, and the year-make-model cohort is of the original';
  ELSE
    -- Per canonical model of the make (case variants of one name are one model): matched exactly (name or alias),
    -- named (its name is a whole word of the model), outside its recorded years (every row that records years excludes
    -- this one), and whether a year profile exists.
    WITH cm AS (
      SELECT lower(c.canonical_model) AS canon, c.year_start, c.year_end, c.aliases
        FROM canonical_models c
       WHERE lower(c.make) = lower(p_make) AND length(btrim(coalesce(c.canonical_model, ''))) > 0),
    per AS (
      SELECT cm.canon,
             bool_or(cm.canon = v_model OR v_model = ANY (SELECT lower(a) FROM unnest(cm.aliases) a)) AS exact,
             bool_or(v_model ~ ('\y' || regexp_replace(cm.canon, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\y')) AS named,
             bool_and(cm.year_start IS NOT NULL OR cm.year_end IS NOT NULL)
               AND bool_and(p_year NOT BETWEEN coalesce(cm.year_start, -1) AND coalesce(cm.year_end, 100000)) AS excluded
        FROM cm GROUP BY cm.canon)
    SELECT array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.exact),
           array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.named AND NOT per.excluded),
           array_agg(per.canon ORDER BY per.canon) FILTER (WHERE per.exact AND EXISTS (
             SELECT 1 FROM make_model_profiles p
              WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = per.canon
                AND p.grain = 'year' AND p.year = p_year))
      INTO v_exact, v_named, v_prof
      FROM per;

    IF cardinality(v_exact) = 1 THEN
      v_canon := v_exact[1]; v_tier := 'exact';
    ELSIF cardinality(v_exact) > 1 THEN
      IF cardinality(v_prof) = 1 THEN
        v_canon := v_prof[1]; v_tier := 'exact';
      ELSE
        v_refusal := format('the model matches %s canonical models exactly (%s)', cardinality(v_exact), array_to_string(v_exact, ', '));
      END IF;
    ELSIF cardinality(v_named) = 1 THEN
      v_canon := v_named[1]; v_tier := 'word';
    ELSIF cardinality(v_named) > 1 THEN
      v_refusal := format('the model names %s canonical models (%s)', cardinality(v_named), array_to_string(v_named, ', '));
    END IF;
  END IF;

  IF v_canon IS NOT NULL THEN
    SELECT c.canonical_model INTO v_name FROM canonical_models c
     WHERE lower(c.make) = lower(p_make) AND lower(c.canonical_model) = v_canon
     ORDER BY c.canonical_model LIMIT 1;
    SELECT p.subject_id INTO v_subject FROM make_model_profiles p
     WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = v_canon
       AND p.grain = 'year' AND p.year = p_year
     LIMIT 1;
    IF v_subject IS NULL THEN
      IF NOT (v_canon = ANY (coalesce(v_named, '{}'))) THEN
        v_reg_refusal := format('%s is matched only through an alias or outside its recorded years, so it is not registered', v_name);
      ELSIF EXISTS (SELECT 1 FROM canonical_models c
                     WHERE lower(c.make) = lower(p_make) AND lower(c.canonical_model) <> v_canon
                       AND v_canon = ANY (SELECT lower(a) FROM unnest(c.aliases) a)) THEN
        v_reg_refusal := format('another canonical model of the make lists %s as an alias, so it is not registered', v_name);
      ELSE
        v_register := true;
      END IF;
    END IF;
  ELSE
    -- No canonical model: a year profile registered under the raw model string, as the refresh read it before.
    SELECT p.subject_id INTO v_subject FROM make_model_profiles p
     WHERE lower(p.canonical_make) = lower(p_make) AND lower(p.canonical_model) = v_model
       AND p.grain = 'year' AND p.year = p_year
     LIMIT 1;
    IF v_subject IS NOT NULL THEN v_tier := 'raw'; END IF;
  END IF;

  RETURN jsonb_build_object('tier', v_tier, 'canonical_model', v_name, 'subject_id', v_subject, 'register', v_register,
    'refusal', v_refusal, 'register_refusal', v_reg_refusal);
END;
$function$;

INSERT INTO make_model_profiles VALUES
 ('c1000000-0000-4000-8000-000000001972','CHEVROLET','C10','year',1972,NULL,NULL,'5d4192f0-9d02-497f-b4a9-c890c42414fa'),
 ('c2000000-0000-4000-8000-000000001972','CHEVROLET','C10','year',1971,NULL,NULL,'022cef91-1b4b-406d-9f39-d08072175cbd'),
 ('c3000000-0000-4000-8000-000000001972','CHEVROLET','K10','year',1972,NULL,NULL,'87fb1e59-3e43-4b01-83ff-d6f679192ccd'),
 ('c4000000-0000-4000-8000-000000001972','CHEVROLET','K5 Blazer','generation',NULL,1969,1972,'c9f4d39f-b79b-4c15-b00e-1ddde0df9be5'),
 ('c5000000-0000-4000-8000-000000001983','GMC','K1500','year',1983,NULL,NULL,'ca121299-c4e4-4175-b705-0002d458b7d0'),
 ('c6000000-0000-4000-8000-000000001987','GMC','Suburban','year',1987,NULL,NULL,'fbd96a44-fc26-42e5-aa8e-dc285ee56ff9');

-- Model labels as recorded on real 1971-72 lots.
INSERT INTO vehicles(id,make,model,sale_date,year) VALUES
 ('d1000000-0000-4000-8000-000000000001','Chevrolet','C10 Cheyenne',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000002','Chevrolet','C10',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000003','Chevrolet','K10 Cheyenne Super',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000004','Chevrolet','K5 Blazer Cheyenne',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000005','Chevrolet','C20 Cheyenne',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000006','Chevrolet','Cheyenne',current_date-1,1972),
 ('d1000000-0000-4000-8000-000000000007','Chevrolet','Cheyenne Super',current_date-1,1971),
 ('d1000000-0000-4000-8000-000000000008','Chevrolet','C-10 Cheyenne',current_date-1,1971),
 ('d1000000-0000-4000-8000-000000000009','GMC','K1500',current_date-1,1983),
 ('d1000000-0000-4000-8000-000000000010','GMC','K2500',current_date-1,1983),
 ('d1000000-0000-4000-8000-000000000011','GMC','K3500 Sierra Classic Crew Cab',current_date-1,1983),
 ('d1000000-0000-4000-8000-000000000012','GMC','Suburban',current_date-1,1987),
 ('d1000000-0000-4000-8000-000000000013','GMC','Jimmy',current_date-1,1987),
 ('d1000000-0000-4000-8000-000000000014','GMC','Yukon Denali',current_date-1,1987);
INSERT INTO mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount)
SELECT id,make,model,year,'Mecum','sold',1000 FROM vehicles WHERE id::text LIKE 'd1000000-%';

-- Stored class prices: one from a C10 year cohort, one from the K10 cohort (the reader 20261121110000 drains).
CREATE TABLE vehicle_class_price(vehicle_id uuid PRIMARY KEY, cohort_subject_id uuid);
CREATE TABLE vehicle_class_price_recompute_queue(vehicle_id uuid PRIMARY KEY, queued_at timestamptz NOT NULL DEFAULT now(),
 attempts smallint NOT NULL DEFAULT 0, last_error text, reason text);
INSERT INTO vehicle_class_price VALUES ('e1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000001972'),
 ('e1000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000001972'),
 ('e1000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000001983'),
 ('e1000000-0000-4000-8000-000000000004','c6000000-0000-4000-8000-000000001987');

CREATE TEMP TABLE c10_1972_before AS SELECT vehicle_id FROM cohort_members('c1000000-0000-4000-8000-000000001972');
SELECT pg_temp.ok('baseline: the bare alias pulls K10, K5 Blazer, C20 and unstated-series Cheyennes into the C10 cohort',
 (SELECT count(*) FROM c10_1972_before)=6
 AND (SELECT count(*) FROM c10_1972_before c JOIN vehicles v ON v.id=c.vehicle_id
      WHERE v.model IN ('K10 Cheyenne Super','K5 Blazer Cheyenne','C20 Cheyenne','Cheyenne'))=4);
SELECT pg_temp.ok('baseline: 3/4- and one-ton GMC trucks join the K1500 cohort; a Jimmy and a Yukon join the Suburban cohort',
 (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c5000000-0000-4000-8000-000000001983') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['K1500','K2500','K3500 Sierra Classic Crew Cab']
 AND (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c6000000-0000-4000-8000-000000001987') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['Jimmy','Suburban','Yukon Denali']);
SELECT pg_temp.ok('baseline: the class price resolver files a K2500 under K1500 and a Jimmy under Suburban',
 resolve_class_price_cohort('GMC','K2500',1983)->>'canonical_model'='K1500'
 AND resolve_class_price_cohort('GMC','K2500',1983)->>'subject_id'='c5000000-0000-4000-8000-000000001983'
 AND resolve_class_price_cohort('GMC','Jimmy',1987)->>'canonical_model'='Suburban'
 AND resolve_class_price_cohort('Chevrolet','Cheyenne',1972)->>'canonical_model'='C10');
REFRESH MATERIALIZED VIEW mv_model_family_names;
REFRESH MATERIALIZED VIEW mv_family_market;
REFRESH MATERIALIZED VIEW mv_family_sales;
SELECT pg_temp.ok('baseline: a bare Cheyenne name is filed under the C10 family',
 (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='cheyenne super')='C10');
CREATE TEMP TABLE cheyenne_totals_before AS SELECT brand,sum(sold) AS sold,sum(usd) AS usd FROM mv_family_market GROUP BY brand;
CREATE TEMP TABLE cheyenne_sources_before AS SELECT id,to_jsonb(v) AS row FROM vehicles v;
CREATE TEMP TABLE cheyenne_normalizer_before AS
 SELECT pg_get_functiondef('normalize_vehicle_model(text,text,integer)'::regprocedure) AS definition;
SELECT record_family_price_index(jsonb_build_object('brand','Chevrolet','family_key',k,'fitted_at',now(),
 'period_kind',NULL,'series','[]'::jsonb,'change',jsonb_build_object('change_12m',0.1,'lo',0.05,'hi',0.15,'n_last12',20,
 'n_prior12',20,'verdict','up','method','hedonic_v1'))) FROM unnest(ARRAY[
 '022cef91-1b4b-406d-9f39-d08072175cbd','023c138f-2f9e-4023-a3c3-bbdc2e1c0b43','a0000000-0000-4000-8000-00000000f17e']) k;

\ir ../migrations/20261121131000_separate_gm_truck_cross_model_aliases.sql
CREATE TEMP TABLE cheyenne_catalog_after AS SELECT id,aliases,notes FROM canonical_models;
\ir ../migrations/20261121131000_separate_gm_truck_cross_model_aliases.sql
SELECT pg_temp.ok('idempotent catalog; both C10 rows keep "c10 cheyenne" and record the superseded aliases',
 NOT EXISTS(SELECT id,aliases,notes FROM canonical_models EXCEPT SELECT * FROM cheyenne_catalog_after)
 AND (SELECT count(*) FROM canonical_models WHERE canonical_model='C10'
      AND NOT EXISTS(SELECT FROM unnest(aliases) a WHERE lower(a)='cheyenne') AND 'c10 cheyenne'=ANY(aliases)
      AND notes LIKE '%[GM truck cross-model alias separation] Superseded aliases: %"cheyenne"%')=2
 AND (SELECT aliases FROM canonical_models WHERE id='87fb1e59-3e43-4b01-83ff-d6f679192ccd') @> ARRAY['k10 cheyenne']);
SELECT pg_temp.ok('C10 cohort keeps C10-named Cheyennes; other trucks and unstated series leave it',
 (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c1000000-0000-4000-8000-000000001972') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['C10','C10 Cheyenne']
 AND (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c2000000-0000-4000-8000-000000001972') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['C-10 Cheyenne']);
SELECT pg_temp.ok('GMC K1500 and Suburban cohorts keep only their own trucks; no GMC row lists k2500 or jimmy but Jimmy',
 (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c5000000-0000-4000-8000-000000001983') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['K1500']
 AND (SELECT array_agg(v.model ORDER BY v.model) FROM cohort_members('c6000000-0000-4000-8000-000000001987') c
   JOIN vehicles v ON v.id=c.vehicle_id)=ARRAY['Suburban']
 AND NOT EXISTS(SELECT FROM canonical_models c, unnest(c.aliases) a WHERE lower(c.make)='gmc' AND lower(a) IN ('k2500','c2500','k3500'))
 AND (SELECT array_agg(canonical_model) FROM canonical_models c WHERE lower(make)='gmc' AND 'jimmy'=ANY(aliases))=ARRAY['Jimmy']
 AND (SELECT aliases FROM canonical_models WHERE id='fbd96a44-fc26-42e5-aa8e-dc285ee56ff9')=ARRAY['gmc suburban','suburban','yukon xl']
 AND (SELECT count(*) FROM canonical_models WHERE notes LIKE '%[GM truck cross-model alias separation]%')=5);
SELECT pg_temp.ok('resolver after: K2500 and bare Cheyenne unresolved; Jimmy resolves to Jimmy; K1500 and C10 unchanged',
 resolve_class_price_cohort('GMC','K2500',1983)->>'tier'='none'
 AND resolve_class_price_cohort('GMC','K2500',1983)->>'subject_id' IS NULL
 AND resolve_class_price_cohort('Chevrolet','Cheyenne',1972)->>'tier'='none'
 AND resolve_class_price_cohort('GMC','Jimmy',1987)->>'canonical_model'='Jimmy'
 AND resolve_class_price_cohort('GMC','K1500',1983)->>'subject_id'='c5000000-0000-4000-8000-000000001983'
 AND resolve_class_price_cohort('Chevrolet','C10',1972)->>'subject_id'='c1000000-0000-4000-8000-000000001972');
SELECT pg_temp.ok('the K10 and K5 Blazer cohorts keep their own trucks',
 EXISTS(SELECT FROM cohort_members('c3000000-0000-4000-8000-000000001972') c JOIN vehicles v ON v.id=c.vehicle_id
        WHERE v.model='K10 Cheyenne Super')
 AND EXISTS(SELECT FROM cohort_members('c4000000-0000-4000-8000-000000001972') c JOIN vehicles v ON v.id=c.vehicle_id
        WHERE v.model='K5 Blazer Cheyenne'));
SELECT pg_temp.ok('normalizer unchanged; a bare Cheyenne is unresolved, series-named Cheyennes keep their series',
 pg_get_functiondef('normalize_vehicle_model(text,text,integer)'::regprocedure)=(SELECT definition FROM cheyenne_normalizer_before)
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','cheyenne',1972)) IS NULL
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','c10 cheyenne',1972))='C10'
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','k10 cheyenne',1972))='K10');
REFRESH MATERIALIZED VIEW mv_model_family_names;
REFRESH MATERIALIZED VIEW mv_family_market;
REFRESH MATERIALIZED VIEW mv_family_sales;
SELECT pg_temp.ok('family names: bare Cheyenne leaves C10; C10 Cheyenne stays; K10 Cheyenne stays K10',
 (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='cheyenne super') IS DISTINCT FROM 'C10'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='c10 cheyenne')='C10'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='k10 cheyenne super')='K10');
SELECT pg_temp.ok('make-level count and dollars conserved; source vehicles unchanged',
 NOT EXISTS((SELECT brand,sum(sold),sum(usd) FROM mv_family_market GROUP BY brand) EXCEPT SELECT * FROM cheyenne_totals_before)
 AND NOT EXISTS(SELECT id,to_jsonb(v) FROM vehicles v EXCEPT SELECT * FROM cheyenne_sources_before));
SELECT pg_temp.ok('the C10 fit is withheld; K10 (gains one name) and an unrelated fit are kept',
 (SELECT method FROM family_price_change WHERE brand='Chevrolet' AND family_key='022cef91-1b4b-406d-9f39-d08072175cbd')
   ='identity_membership_changed_v1'
 AND (SELECT method FROM family_price_change WHERE brand='Chevrolet' AND family_key='023c138f-2f9e-4023-a3c3-bbdc2e1c0b43')='hedonic_v1'
 AND (SELECT method FROM family_price_change WHERE brand='Chevrolet' AND family_key='a0000000-0000-4000-8000-00000000f17e')='hedonic_v1');
SELECT pg_temp.ok('only class prices from a changed cohort are queued, once',
 (SELECT array_agg(vehicle_id::text||':'||reason ORDER BY vehicle_id) FROM vehicle_class_price_recompute_queue)
   =ARRAY['e1000000-0000-4000-8000-000000000001:cohort_membership_changed','e1000000-0000-4000-8000-000000000003:cohort_membership_changed',
          'e1000000-0000-4000-8000-000000000004:cohort_membership_changed']);
SELECT pg_temp.ok('GMC family names: K2500 leaves K1500, Yukon Denali leaves Suburban, K1500 and Jimmy stay',
 (SELECT family FROM mv_model_family_names WHERE make_l='gmc' AND model_l='k2500') IS DISTINCT FROM 'K1500'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='gmc' AND model_l='yukon denali')='Yukon'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='gmc' AND model_l='k1500')='K1500'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='gmc' AND model_l='jimmy')='Jimmy');
