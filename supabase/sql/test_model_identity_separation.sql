-- Disposable PG17 only. Model separation rather than maximum alias binding.
-- Real reference names, synthetic vehicle IDs/amounts. Reuse the actual folds and readers.
\ir test_family_sales_fold.sql

INSERT INTO public.canonical_makes(id,canonical_name,display_name,aliases) VALUES
 ('e53dbe0c-e916-40fa-9702-7b2cc17c8cf1','Bultaco','Bultaco','{}'),
 ('c5149a9f-574f-490d-8fc9-4603b7bc8867','Suzuki','Suzuki','{}');
INSERT INTO public.canonical_models(id,make,canonical_model,year_start,year_end,aliases) VALUES
 ('3ff78759-631a-4da2-98cf-b5a3718b69df'::uuid,'Suzuki','Samurai',NULL,NULL,ARRAY['samuari', 'samurai', 'sj410', 'sj413', 'sx4', 'alto', 'lj20v', 'mighty boy', 'fronte', 'cervo', 'swift', 'equator', 'wagon r', 'kei']::text[]),
 ('00000000-0000-4000-f000-000000000217'::uuid,'Suzuki','Jimny',1970,NULL,ARRAY['jimny', 'jimny turbo', 'lj80', 'sidekick', 'x-90', 'x90', 'cappuccino']::text[]),
 ('00000000-0000-4000-f000-000000000216'::uuid,'Suzuki','Carry',NULL,NULL,ARRAY['cara', 'carry', 'carry dump truck', 'carry pickup', 'carry truck', 'da63t', 'every']::text[]),
 ('00000000-0000-4000-f000-000000000711'::uuid,'Suzuki','RM250',NULL,NULL,ARRAY['rm250', 'rm125', 'rm400', 'rm370', 'rm500', 'rm80', 'tm400', 'tm250', 'tm125', 'tm100', 'tm75', 'ts400', 'ts250', 'ts185', 'ts125', 'ts100', 'ts90', 'ts 90r', 'ts50', 'tc125', 'tc90', 'rv90', 'rv125', 'pe250', 'pe175', 'dr350', 'dr650', 'jr50', 'lt500r', 'lt250r', 'tc 185', 'tc 90r', 'rm465', 'rl250', 'rb50', 'lt', 'lt50', 'alt50', 'rh250', 'dsxr', 'rm z450', 'rmz450', 'rm100a', 'rm125a', 'tm125k', 'tm250l', 'rm125m', 'rm370a', 'tc305', 'tm', 'tc250', 'rm250a', 'ts 125', 'tsr 500', 'rn125', 'tc 90j', 'sp600', 'rm60', 'rm 60', 'tc200', 'ts 185', 'ts 185j', 'vanvan', 'rv200', 'tc 125', 'pe250b', 'tm 100', 'dr z400sm', 'dr z', 'lt50h', 'rm125n', 'tm 400', 'tm400j', 'rm 250', 'tc 120', 'tm 125', 'jr 50', 'jr50z', 'lt125', 'ds80', 'ts75', 'quadzilla', 'dr100', 'lt450r', 'dr250', 'tc 100', 'tc100', 'mt50', 'lz 50a', 'quadrunner', 'drm420', '250rm', 'rm100', 'rl 250']::text[]),
 ('00000000-0000-4000-f000-000000000712'::uuid,'Suzuki','Samurai',NULL,NULL,ARRAY['samurai', 'sidekick', 'vitara', 'grand vitara', 'x 90', 'x90', 'lj10', 'lj20', 'lj50', 'lj80', 'sj410', 'sj413', 'sx4', 'alto', 'lj20v', 'mighty boy', 'fronte', 'cervo', 'swift', 'equator', 'wagon r', 'kei']::text[]),
 ('00000000-0000-4000-f000-000000000218'::uuid,'Suzuki','GSX-R',NULL,NULL,ARRAY['bimota sb2', 'gamma 500', 'gs1000', 'gs1000s', 'gs1100e', 'gsx1300r hayabusa', 'gsxr', 'gsx-r1000', 'gsx r1100', 'gsx-r 1100', 'gsx-r1100', 'gsx-r750', 'gsxr 750', 'gt380', 'gt550', 'gt750', 'hayabusa', 'jr50', 're5', 'rg 500', 'rg500', 'rg500 gamma', 'rgb500', 'rm125', 'rm250', 't125', 't500', 't500m', 'tm400', 'tl1000r', 'rg250', 'rg 250', 't10', 'x6', 'gv700gl', 'gt 500', 'gr650', 'gs550e', 'a100', 'gsxr1100r', 'gt750m', 'gsxr750', 'gs650gl', 'gs650', 'gsx1300r', 'xn 85', 'tl1000', 'gsxr1100', 'v strom', 'gt550j', 'boulevard', 'rgv250sp', 'gsx r50', 'gsx1000s', 'colleda', 'hyabusa', 'gt380l', 'gsx', 'gsxr100r', 'gsx 600r', 's32 2', 's32', 'gsx r600', 'gsk 1100', 'tlr 1000', 'gs1150es', 't500r', 'tl1000s', 'burgman', 'bandit', 'ls650', 'vx800', 'gsx r400', 'gv1400', 'gsx r600m', 'titan', 'sv650', 'gs1000e', 'gs750e', 'm15', 'dl1000', 'gs1100es', 't200', 'gs450t', 'vz800', 'b105p', 'b105', 'gs550t', 'gsf250', 'gs1150ef', 'gsxr400', 'tu250x', '250 savage', 'intruder', 'vs700gle', 'gp100', 'gs500e', 'b120p', 'k11p', 'k11', 'gz250', 'm12 2', 'k15', 'an400y', 'fa50', 'gsx600f', 'gsx550e', 'gs850', 'u50', '340 nomad', 'a 100', 'indian custom', 'race bike', 'x']::text[]),
 ('00000000-0000-4000-f000-000000000710'::uuid,'Suzuki','GSX-R',NULL,NULL,ARRAY['gsx r', 'gsxr', 'gs1000', 'gs1000s', 'gs1000sz', 'gs100sz', 'gs1100', 'gs1150', 'gs850g', 'gs750', 'gs550', 'katana', 'hayabusa', 'rg500', 'rg400', 'rgv250', 'gt750', 'gt550', 'gt500', 'gt380', 'gt250', 'gt185', 't500', 't350', 't250', 't20', 're5', 'xn85', 'tl1000r', 'rg250', 'rg 250', 't10', 'x6', 'gv700gl', 'gt 500', 'gr650', 'gs550e', 'a100', 'gsxr1100r', 'gt750m', 'gsxr750', 'gs650gl', 'gs650', 'gsx1300r', 'xn 85', 'tl1000', 'gsxr1100', 'v strom', 'gt550j', 'boulevard', 'rgv250sp', 'gsx r50', 'gsx1000s', 'colleda', 'hyabusa', 'gt380l', 'gsx', 'gsxr100r', 'gsx 600r', 's32 2', 's32', 'gsx r600', 'gsk 1100', 'tlr 1000', 'gs1150es', 't500r', 'tl1000s', 'burgman', 'bandit', 'ls650', 'vx800', 'gsx r400', 'gv1400', 'gsx r600m', 'titan', 'sv650', 'gs1000e', 'gs750e', 'm15', 'dl1000', 'gs1100es', 't200', 'gs450t', 'vz800', 'b105p', 'b105', 'gs550t', 'gsf250', 'gs1150ef', 'gsxr400', 'tu250x', '250 savage', 'intruder', 'vs700gle', 'gp100', 'gs500e', 'b120p', 'k11p', 'k11', 'gz250', 'm12 2', 'k15', 'an400y', 'fa50', 'gsx600f', 'gsx550e', 'gs850', 'u50', '340 nomad', 'a 100', 'indian custom', 'race bike', 'x']::text[]),
 ('00000000-0000-4000-f000-000000000314'::uuid,'Bultaco','Pursang',NULL,NULL,ARRAY['pursang', 'pursang 250', 'pursang 360', 'sherpa', 'matador', 'astro', 'metralla', 'frontera', 'alpina', 'lobito', 'model 23', 'el bandido', 'bandido', 'el bandito', 'metisse', 'mercurio', 'tss', 'mk7', '350', '250', 'el tigre', 'el montadero', '360 tss', 's100']::text[]);

CREATE TEMP TABLE identity_cases(make text, model text, expected text);
INSERT INTO identity_cases VALUES
 ('Bultaco','frontera 370','Frontera'), ('Bultaco','sherpa t 350','Sherpa T'),
 ('Bultaco','sherpa s 125','Sherpa S'), ('Bultaco','matador mk5','Matador'),
 ('Bultaco','astro 360','Astro'), ('Bultaco','metralla mk2','Metralla'),
 ('Bultaco','alpina 350','Alpina'), ('Bultaco','lobito mk6','Lobito'),
 ('Bultaco','tss 250','TSS'), ('Bultaco','pursang 250','Pursang'),
 ('Suzuki','hayabusa','Hayabusa'), ('Suzuki','re5','RE-5'), ('Suzuki','gt750','GT750'),
 ('Suzuki','cappuccino','Cappuccino'), ('Suzuki','gsx-r750','GSX-R'),
 ('Suzuki','jimny turbo','Jimny'), ('Suzuki','rm125','RM125'), ('Suzuki','rm250','RM250'),
 ('Suzuki','carry pickup','Carry'), ('Suzuki','samurai','Samurai'),
 ('Bultaco','350',NULL), ('Suzuki','dr650',NULL), ('Suzuki','swift',NULL);
INSERT INTO public.vehicles(id,make,model,sale_date)
SELECT md5(c.make||c.model||g)::uuid,c.make,c.model,current_date-10
FROM identity_cases c CROSS JOIN generate_series(1,3) g;
INSERT INTO public.mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount)
SELECT md5(c.make||c.model||g)::uuid,c.make,c.model,
       CASE WHEN c.make='Bultaco' THEN 1977 ELSE 2000 END,'Bring a Trailer','sold',1000+g
FROM identity_cases c CROSS JOIN generate_series(1,3) g;
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('baseline: Frontera falsely lands in Pursang',
 (SELECT family FROM public.mv_model_family_names WHERE make_l='bultaco' AND model_l='frontera 370')='Pursang');
SELECT pg_temp.ok('baseline: unrelated Suzuki models land in other model buckets',
 (SELECT family FROM public.mv_model_family_names WHERE make_l='suzuki' AND model_l='hayabusa')='GSX-R'
 AND (SELECT family FROM public.mv_model_family_names WHERE make_l='suzuki' AND model_l='cappuccino')='Jimny');
CREATE TEMP TABLE before_vehicle AS
SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY id)) AS hash FROM public.vehicles v;
CREATE TEMP TABLE before_outcomes AS
SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY id)) AS hash FROM public.mv_treemap_outcomes v;
CREATE TEMP TABLE before_totals AS
SELECT brand,sum(sold) AS sold,sum(usd) AS usd FROM public.mv_family_market GROUP BY brand;

ALTER TABLE public.vehicles ADD mileage integer, ADD transmission text,
 ADD bat_listing_title text, ADD listing_title text, ADD title text;
CREATE TABLE public.auction_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
 source text, auction_end_date timestamptz, outcome text, winning_bid numeric);
\ir ../migrations/20261018050000_family_price_index.sql
SELECT public.record_family_price_index(jsonb_build_object(
 'brand','Suzuki','family_key','00000000-0000-4000-f000-000000000218',
 'fitted_at',now()-interval '1 hour','period_kind',NULL,'series','[]'::jsonb,
 'change',jsonb_build_object('change_12m',0,'lo',-0.01,'hi',0.01,'n_last12',90,
 'n_prior12',90,'verdict','flat','method','hedonic_v1')));
SELECT public.record_family_price_index(jsonb_build_object(
 'brand','Porsche','family_key','00000000-0000-4000-b000-000000000001',
 'fitted_at',now()-interval '1 hour','period_kind',NULL,'series','[]'::jsonb,
 'change',jsonb_build_object('change_12m',0,'lo',-0.01,'hi',0.01,'n_last12',90,
 'n_prior12',90,'verdict','flat','method','hedonic_v1')));
\ir ../migrations/20261018223340_separate_bultaco_suzuki_model_identity.sql
CREATE TEMP TABLE after_catalog AS SELECT id,aliases,notes FROM public.canonical_models;
\ir ../migrations/20261018223340_separate_bultaco_suzuki_model_identity.sql
SELECT pg_temp.ok('idempotent, including superseded alias receipts',
 NOT EXISTS (SELECT id,aliases,notes FROM public.canonical_models EXCEPT SELECT * FROM after_catalog)
 AND (SELECT count(*) FROM public.canonical_models)=(SELECT count(*) FROM after_catalog));
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('declared identities reach their own family; unassessed names stay unresolved',
 NOT EXISTS (SELECT 1 FROM identity_cases c LEFT JOIN public.mv_model_family_names n
 ON n.make_l=lower(c.make) AND n.model_l=c.model WHERE n.family IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('Frontera sales do not enter Pursang',
 NOT EXISTS (SELECT 1 FROM public.mv_family_sales WHERE brand='Bultaco'
 AND family_key='00000000-0000-4000-f000-000000000314' AND model LIKE 'frontera%'));
SELECT pg_temp.ok('unresolved sales stay in the wider market',
 (SELECT count(*) FROM public.mv_family_sales WHERE brand='Bultaco' AND model='350' AND family_key='other')=3);
SELECT pg_temp.ok('brand totals and dollars are preserved',
 NOT EXISTS (SELECT brand,sum(sold),sum(usd) FROM public.mv_family_market GROUP BY brand
 EXCEPT SELECT * FROM before_totals));
SELECT pg_temp.ok('vehicle and source outcome fields are unchanged',
 (SELECT md5(string_agg(jsonb_build_object('id',v.id,'make',v.make,'model',v.model,
 'sale_date',v.sale_date,'bat_sale_date',v.bat_sale_date)::text,',' ORDER BY id)) FROM public.vehicles v)
 = (SELECT hash FROM before_vehicle)
 AND (SELECT md5(string_agg(to_jsonb(v)::text,',' ORDER BY id)) FROM public.mv_treemap_outcomes v)
 = (SELECT hash FROM before_outcomes));
SELECT pg_temp.ok('contaminated price fit is unavailable; unrelated fit survives',
 (public.family_price_index_read('Suzuki','00000000-0000-4000-f000-000000000218')->'change'->>'method')='identity_membership_changed_v1'
 AND (public.family_price_index_read('Suzuki','00000000-0000-4000-f000-000000000218')->'change'->>'change_12m') IS NULL
 AND (public.family_price_index_read('Porsche','00000000-0000-4000-b000-000000000001')->'change'->>'verdict')='flat');
SET ROLE anon;
SELECT pg_temp.ok('anonymous consumer reaches the source model through its own key',
 (SELECT count(*) FROM public.treemap_family_sales('Bultaco',
   (SELECT family_id::text FROM public.mv_model_family_names WHERE make_l='bultaco' AND model_l='frontera 370')))=3
 AND NOT EXISTS (SELECT 1 FROM public.treemap_family_sales('Bultaco','00000000-0000-4000-f000-000000000314') WHERE model='frontera 370'));
RESET ROLE;
