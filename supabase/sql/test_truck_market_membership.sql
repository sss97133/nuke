-- EMPTY DISPOSABLE LOCAL PG17 ONLY. Synthetic views, no testimony writes/bypass.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() !~ '^(truck_contract|dm_refinement_)' THEN RAISE EXCEPTION 'disposable truck_contract database required'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
CREATE FUNCTION pg_temp.ok(label text, verdict boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF verdict IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE TABLE public.test_scenario AS SELECT 0 AS phase;
CREATE VIEW public.vehicles AS
SELECT x.id::uuid,x.model,'Chevrolet'::text make,current_date-x.n AS sale_date,NULL::date bat_sale_date,
 '2wd'::text drivetrain,NULL::text body_style,NULL::text cab_config,NULL::text series,NULL::text trim,
 NOT ((x.n=1 AND t.phase=3) OR (x.n=1097 AND t.phase=5)) is_public,NULL::timestamptz deleted_at,'vehicle'::text listing_kind,
 NULL::text listing_title,NULL::text title,NULL::text vin,NULL::text primary_image_url
FROM (VALUES (1,'00000000-0000-4000-8000-000000000001','3100 Custom Pickup'),
 (2,'00000000-0000-4000-8000-000000000002','C10 Pickup'),
 (3,'00000000-0000-4000-8000-000000000003','El Camino')
 UNION ALL SELECT n,'00000000-0000-4000-8000-'||lpad(n::text,12,'0'),'C10 Pickup' FROM generate_series(100,1100) n
 ) x(n,id,model) CROSS JOIN public.test_scenario t WHERE x.n<=3 OR t.phase IN (4,5);
CREATE VIEW public.mv_treemap_outcomes AS SELECT id,'Chevrolet'::text brand_name,model,
 1957 AS year,'sold'::text outcome,50000::numeric sold_amount,'Mecum'::text source_name FROM public.vehicles;
CREATE VIEW public.mv_family_market AS
SELECT 'Chevrolet'::text brand,x.family_key,x.family,x.model,lower(x.model) model_key,
 1::bigint sold,1::bigint sold_any,1::bigint offered,50000::bigint usd,1::bigint bat_dated,
 1::bigint bat_sold_12m,0::bigint bat_sold_prior_12m,50000::bigint bat_usd_12m,0::bigint bat_usd_prior_12m,now() as_of
FROM (VALUES ('truck','Pickup','Pickup'),('3100','3100','3100 Custom Pickup'),('c10','C10','C10 Pickup'),('elcamino','El Camino','El Camino')) x(family_key,family,model);
CREATE VIEW public.mv_family_sales AS SELECT id AS vehicle_id,'Chevrolet'::text brand,
 CASE WHEN model='El Camino' THEN 'elcamino' WHEN model='C10 Pickup' THEN 'c10' ELSE '3100' END family_key,
 sale_date,50000::numeric usd,'Mecum'::text source,1957 AS year,model FROM public.vehicles;
CREATE VIEW public.vehicle_observations AS SELECT '00000000-0000-4000-9000-000000000001'::uuid id,
 '00000000-0000-4000-8000-000000000001'::uuid vehicle_id,phase=2 is_superseded,
 'listing'::text kind,'vehicle'::text subject_type,'{"drivetrain":"4wd"}'::jsonb structured_data,
 0.9::numeric confidence_score,now()-interval '1 day' observed_at,now()-interval '1 day' ingested_at FROM public.test_scenario;
CREATE VIEW public.vehicle_field_consensus AS SELECT vehicle_id,'drivetrain'::text field_name,id AS source_observation_id,
 '4wd'::text consensus_value,CASE WHEN t.phase=1 THEN 'unresolved' ELSE 'most_recent' END resolution_method,
 0.9::numeric consensus_confidence,now() as_of_at FROM public.vehicle_observations CROSS JOIN public.test_scenario t;
CREATE VIEW public.vehicle_field_sources AS SELECT id AS vehicle_id,'drivetrain'::text field_name,'2wd'::text field_value,'listing'::text source_type FROM public.vehicles CROSS JOIN public.test_scenario t
WHERE id<>'00000000-0000-4000-8000-000000000001'::uuid OR t.phase IN (2,6);
CREATE VIEW public.field_evidence AS SELECT NULL::uuid vehicle_id,NULL::text field_name,NULL::text proposed_value,NULL::text status WHERE false;
CREATE FUNCTION public.observation_is_public(text,jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(($2->>'public')::boolean,true) $$;
CREATE FUNCTION public.classify_drivetrain(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE lower($1) WHEN '4wd' THEN '4WD' WHEN '2wd' THEN 'RWD' END $$;
\ir ../migrations/20261018223739_truck_market_membership.sql
\ir ../migrations/20261018223739_truck_market_membership.sql
\ir ../migrations/20261019011500_truck_membership_bound_plan.sql
\ir ../migrations/20261019011500_truck_membership_bound_plan.sql
SELECT pg_temp.ok('complete all-time membership excludes El Camino and preserves raw identity',
 (SELECT (j->>'n')::int=2 AND jsonb_array_length(j->'rows')=2 AND NOT (j->>'truncated')::boolean
 AND j->'rows'->0->>1='3100 Custom Pickup' FROM (SELECT public.treemap_family_models('Chevrolet','truck',true) j) s));
SELECT pg_temp.ok('eligible disclosed configuration overrides an unrooted scalar and retains source clock',
 (SELECT j->'rows'->0->>7='4WD' AND j->'rows'->0->>12 IS NOT NULL FROM (SELECT public.treemap_family_models('Chevrolet','truck',true) j) s));
SELECT pg_temp.ok('legacy readers also reposition El Camino but retain standalone family',
 NOT EXISTS (SELECT 1 FROM public.treemap_family_models('Chevrolet','truck') WHERE model='El Camino')
 AND EXISTS (SELECT 1 FROM public.treemap_family_models('Chevrolet','elcamino') WHERE model='El Camino')
 AND public.treemap_family_sales('Chevrolet','truck')->>'n'='2');
UPDATE public.test_scenario SET phase=1;
SELECT pg_temp.ok('same-time disagreement stays conflicting',public.treemap_family_models('Chevrolet','truck',true)->'rows'->0->>7='conflict');
UPDATE public.test_scenario SET phase=2;
SELECT pg_temp.ok('withdrawal cannot resurrect older scalar',public.treemap_family_models('Chevrolet','truck',true)->'rows'->0->>7 IS NULL);
UPDATE public.test_scenario SET phase=3;
SET ROLE anon;
SELECT pg_temp.ok('anonymous reader rechecks current parent privacy',public.treemap_family_models('Chevrolet','truck',true)->>'n'='1');
SELECT pg_temp.ok('unsupported make and unknown family disclose no members',public.treemap_family_models('Porsche','truck',true)->>'n'='0' AND public.treemap_family_models('Chevrolet','missing',true)->>'n'='0');
RESET ROLE;
UPDATE public.test_scenario SET phase=6;
SELECT pg_temp.ok('independent undated rooted claim cannot be ordered behind a dated disclosure',
 public.treemap_family_models('Chevrolet','truck',true)->'rows'->0->>7='conflict');
UPDATE public.test_scenario SET phase=4;
SELECT pg_temp.ok('keyset pages reconcile beyond the first thousand',
 (SELECT (first->>'n')::int=1000 AND (first->>'has_more')::boolean
 AND (public.treemap_family_models('Chevrolet','truck',true,(first->>'next_cursor')::uuid)->>'n')::int=3
 AND NOT (public.treemap_family_models('Chevrolet','truck',true,(first->>'next_cursor')::uuid)->>'has_more')::boolean
 FROM (SELECT public.treemap_family_models('Chevrolet','truck',true) first) s));
SELECT pg_temp.ok('disjoint UUID partitions cannot repeat the same records',
 public.treemap_family_models('Chevrolet','truck',true,NULL,0)->>'n'='1000'
 AND public.treemap_family_models('Chevrolet','truck',true,NULL,1)->>'n'='0');

UPDATE public.test_scenario SET phase=5;
SET ROLE anon;
SELECT pg_temp.ok('a private boundary record is absent from rows and cursor metadata',
 (SELECT (first->>'n')::int=999 AND (first->>'has_more')::boolean
 AND first->>'next_cursor'<>'00000000-0000-4000-8000-000000001097'
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(first->'rows') r WHERE r->>0='00000000-0000-4000-8000-000000001097')
 AND (public.treemap_family_models('Chevrolet','truck',true,(first->>'next_cursor')::uuid)->>'n')::int=3
 FROM (SELECT public.treemap_family_models('Chevrolet','truck',true) first) s));
RESET ROLE;
