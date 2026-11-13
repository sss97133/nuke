-- Actual normalizer, family/sales folds and anonymous reader; disposable PG17 only.
-- Reuse existing fixtures; all vehicle IDs and amounts below are synthetic.
\ir test_fiat_model_identity_separation.sql

INSERT INTO canonical_makes(id,canonical_name,display_name,aliases)
SELECT '13333333-1111-4111-8111-111111111111','Chevrolet','Chevrolet','{}'
WHERE NOT EXISTS (SELECT FROM canonical_makes WHERE canonical_name='Chevrolet');
INSERT INTO canonical_models(id,make,canonical_model,canonical_series,year_start,year_end,aliases) VALUES
('022cef91-1b4b-406d-9f39-d08072175cbd','CHEVROLET','C10','C/K',1947,NULL,ARRAY['c10','c10 custom','k10 custom']),
('5d4192f0-9d02-497f-b4a9-c890c42414fa','Chevrolet','C10','C/K Series',1947,NULL,ARRAY['c10','c10 custom','k10 custom','c10 custom pickup']),
('023c138f-2f9e-4023-a3c3-bbdc2e1c0b43','Chevrolet','K10','C/K',1960,1987,ARRAY['k10']),
('87fb1e59-3e43-4b01-83ff-d6f679192ccd','Chevrolet','K10','C/K Series',1960,1987,ARRAY['k10','k10 custom','k10 custom pickup']);
INSERT INTO vehicles(id,make,model,sale_date) VALUES
('a1111111-1111-4111-8111-111111111111','Chevrolet','K10 Custom',current_date-1),
('a2222222-2222-4222-8222-222222222222','Chevrolet','C10 Custom',current_date-1);
INSERT INTO mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount) VALUES
('a1111111-1111-4111-8111-111111111111','Chevrolet','K10 Custom',1971,'Mecum','sold',1100),
('a2222222-2222-4222-8222-222222222222','Chevrolet','C10 Custom',1971,'Mecum','sold',2200);
-- Existing fold publishes named families at three sales; exercise that real consumer boundary.
INSERT INTO vehicles(id,make,model,sale_date)
SELECT md5(model||g)::uuid,'Chevrolet',model,current_date-1
FROM (VALUES ('K10 Custom'),('C10 Custom')) c(model) CROSS JOIN generate_series(1,2) g;
ALTER TABLE vehicles ADD COLUMN year integer, ADD COLUMN normalized_model text,
 ADD COLUMN normalized_series text, ADD COLUMN generation text, ADD COLUMN model_confidence integer,
 ADD COLUMN is_public boolean DEFAULT true, ADD COLUMN deleted_at timestamptz, ADD COLUMN listing_kind text DEFAULT 'vehicle';
UPDATE vehicles SET year=1971,normalized_model='C10' WHERE model='K10 Custom';
UPDATE vehicles SET generation='Retained generation claim',normalized_series='Retained series claim'
 WHERE id='a1111111-1111-4111-8111-111111111111';
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,extraction_method text,kind text,
 is_superseded boolean,property_id uuid,structured_data jsonb,source_url text,ingested_at timestamptz);
INSERT INTO vehicle_observations VALUES ('b1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111',
 'public_lot_index','listing',false,NULL,'{"year":1971,"make":"Chevrolet","model":"K10 Custom"}',
 'https://www.mecum.com/lots/1/1971-chevrolet-k10-custom-pickup/',now());
CREATE TABLE superseded_rows(source_table text,row_id uuid,row_data jsonb,asserted_by text,source jsonb,reason text);
\ir ../migrations/20261017170000_correct_vehicle_identity.sql
-- Snapshot of the existing live normalization trigger (read 2026-10-30), not a new production writer.
CREATE FUNCTION auto_normalize_vehicle_model() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE norm_result record;
BEGIN
 IF NEW.make IS NOT NULL THEN
  SELECT * INTO norm_result FROM normalize_vehicle_model(NEW.make,NEW.model,NEW.year);
  IF norm_result.canonical_model IS NOT NULL THEN
   NEW.normalized_model:=norm_result.canonical_model;NEW.normalized_series:=norm_result.canonical_series;
   NEW.generation:=norm_result.generation;NEW.model_confidence:=norm_result.confidence;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_normalization BEFORE UPDATE OF model,make,year ON vehicles
 FOR EACH ROW EXECUTE FUNCTION auto_normalize_vehicle_model();
INSERT INTO mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount)
SELECT md5(model||g)::uuid,'Chevrolet',model,1971,'Mecum','sold',1000
FROM (VALUES ('K10 Custom'),('C10 Custom')) c(model) CROSS JOIN generate_series(1,2) g;
REFRESH MATERIALIZED VIEW mv_model_family_names;
REFRESH MATERIALIZED VIEW mv_family_market;
REFRESH MATERIALIZED VIEW mv_family_sales;
SELECT pg_temp.ok('baseline: K10 Custom is wrongly grouped under C10',
 (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='k10 custom')='C10');
CREATE TEMP TABLE truck_sources_before AS SELECT id,to_jsonb(v)-ARRAY['normalized_model','normalized_series','generation','model_confidence'] AS row FROM vehicles v;
CREATE TEMP TABLE truck_outcomes_before AS SELECT id,to_jsonb(o) AS row FROM mv_treemap_outcomes o;
CREATE TEMP TABLE truck_totals_before AS SELECT brand,sum(sold) AS sold,sum(usd) AS usd FROM mv_family_market GROUP BY brand;
CREATE TEMP TABLE truck_normalizer_before AS SELECT pg_get_functiondef('normalize_vehicle_model(text,text,integer)'::regprocedure) AS definition;
SELECT record_family_price_index(jsonb_build_object('brand','Chevrolet','family_key',k,'fitted_at',now(),
 'period_kind',NULL,'series','[]'::jsonb,'change',jsonb_build_object('change_12m',0.1,'lo',0.05,'hi',0.15,'n_last12',20,
 'n_prior12',20,'verdict','up','method','hedonic_v1'))) FROM unnest(ARRAY[
 '022cef91-1b4b-406d-9f39-d08072175cbd','023c138f-2f9e-4023-a3c3-bbdc2e1c0b43']) k;

\ir ../migrations/20261030051409_reissue_chevrolet_k10_alias_case_guard.sql
CREATE TEMP TABLE truck_catalog_after AS SELECT id,aliases,notes FROM canonical_models;
\ir ../migrations/20261030051409_reissue_chevrolet_k10_alias_case_guard.sql
SELECT pg_temp.ok('idempotent catalog and retained superseded aliases',
 NOT EXISTS(SELECT id,aliases,notes FROM canonical_models EXCEPT SELECT * FROM truck_catalog_after)
 AND (SELECT count(*) FROM canonical_models WHERE canonical_model='C10' AND notes LIKE '%k10 custom%')=2);
REFRESH MATERIALIZED VIEW mv_model_family_names;
REFRESH MATERIALIZED VIEW mv_family_market;
REFRESH MATERIALIZED VIEW mv_family_sales;
SELECT pg_temp.ok('K10 Custom now reaches K10; C10 Custom remains C10',
 (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='k10 custom')='K10'
 AND (SELECT family FROM mv_model_family_names WHERE make_l='chevrolet' AND model_l='c10 custom')='C10');
SELECT pg_temp.ok('native intake exact names separate without changing shared normalizer',
 (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','k10 custom',1971))='K10'
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','k10 custom pickup',1971))='K10'
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','c10 custom',1971))='C10'
 AND pg_get_functiondef('normalize_vehicle_model(text,text,integer)'::regprocedure)=(SELECT definition FROM truck_normalizer_before));
SELECT pg_temp.ok('cited profile refreshes its derived identity through the actual writer; uncited profiles unchanged',
 (SELECT normalized_model FROM vehicles WHERE id='a1111111-1111-4111-8111-111111111111')='K10'
 AND (SELECT generation='Retained generation claim' AND normalized_series='Retained series claim'
      FROM vehicles WHERE id='a1111111-1111-4111-8111-111111111111')
 AND (SELECT count(*) FROM vehicles WHERE model='K10 Custom' AND normalized_model='C10')=2
 AND (SELECT count(*) FROM superseded_rows)=1
 AND (SELECT source->>'ref' FROM superseded_rows)='b1111111-1111-4111-8111-111111111111');
SELECT pg_temp.ok('existing GM rule, explicit K10 year bound and unknown negative survive',
 (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','K1500 Silverado',1994))='K1500'
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','k10',1950)) IS NULL
 AND (SELECT canonical_model FROM normalize_vehicle_model('Chevrolet','unassessed',1971)) IS NULL);
SELECT pg_temp.ok('source vehicles and sale testimony unchanged',
 NOT EXISTS(SELECT id,to_jsonb(v)-ARRAY['normalized_model','normalized_series','generation','model_confidence'] FROM vehicles v EXCEPT SELECT * FROM truck_sources_before)
 AND NOT EXISTS(SELECT id,to_jsonb(o) FROM mv_treemap_outcomes o EXCEPT SELECT * FROM truck_outcomes_before));
SELECT pg_temp.ok('make-level count and dollars conserved',
 NOT EXISTS((SELECT brand,sum(sold),sum(usd) FROM mv_family_market GROUP BY brand) EXCEPT SELECT * FROM truck_totals_before));
SELECT pg_temp.ok('both changed model fits withheld',
 (SELECT count(*) FROM family_price_change WHERE brand='Chevrolet' AND method='identity_membership_changed_v1')=2);
SET ROLE anon;
SELECT pg_temp.ok('anonymous K10 sales reader contains K10 Custom and excludes C10 Custom',
 EXISTS(SELECT FROM treemap_family_sales('Chevrolet','023c138f-2f9e-4023-a3c3-bbdc2e1c0b43') WHERE model='K10 Custom')
 AND NOT EXISTS(SELECT FROM treemap_family_sales('Chevrolet','023c138f-2f9e-4023-a3c3-bbdc2e1c0b43') WHERE model='C10 Custom'));
RESET ROLE;
DO $$
BEGIN
 BEGIN
  PERFORM correct_vehicle_identity('a1111111-1111-4111-8111-111111111111',
   '{"year":1971,"make":"Chevrolet","model":"K10 Custom"}','{"model":"C10 Custom"}',
   '{"type":"fixture","ref":"negative-control","title":"1971 Chevrolet C10 Custom","scope":"normalized_model_only"}',
   'Negative control must not replace the retained identity');
  RAISE EXCEPTION 'Derived-only scope accepted a changed source identity';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'Derived model refresh must retain the exact recorded identity' THEN RAISE; END IF;
 END;
END $$;
CREATE TEMP TABLE legacy_identity_receipt AS SELECT
 correct_vehicle_identity('a2222222-2222-4222-8222-222222222222',
  '{"year":null,"make":"Chevrolet","model":"C10 Custom"}','{"model":"C10"}',
  '{"type":"fixture","ref":"legacy-control","title":"Chevrolet C10"}',
  'Preserve the existing ordinary cited model correction path') AS result;
SELECT pg_temp.ok('ordinary cited identity correction keeps its existing behavior',
 (SELECT result->>'status' FROM legacy_identity_receipt)='corrected'
 AND (SELECT model FROM vehicles WHERE id='a2222222-2222-4222-8222-222222222222')='C10');
