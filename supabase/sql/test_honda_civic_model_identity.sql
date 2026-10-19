-- Empty disposable PG17 only. Actual folds/intake, synthetic IDs and amounts.
\ir test_fiat_model_identity_separation.sql
INSERT INTO public.canonical_makes(id,canonical_name,display_name,aliases) VALUES ('b6b5f3e3-7868-46df-a68f-a1038506771c','Honda','Honda','{}');
INSERT INTO public.canonical_models(id,make,canonical_model,aliases) VALUES
('101393af-bfe8-4bff-a5ec-bc081e64e2d5'::uuid,'Honda','S2000',ARRAY['s2000','s2000 convertible','s2000 cr']::text[]),
('bc8b9613-f0a9-4b1c-a793-686a7d4cefd5'::uuid,'Honda','Acty',ARRAY['acty','acty sdx 4wd 5-speed','acty attack 4wd 5-speed','acty truck','acty van']::text[]),
('9662f34a-48a9-45ab-9c29-d1e70d3b9b5a'::uuid,'Honda','Accord',ARRAY['accord']::text[]),
('832bb174-9d27-40ca-b545-490646bd3639'::uuid,'Honda','CR-V',ARRAY['cr-v']::text[]),
('773a6e78-8d79-4aa7-b6b3-7e98a45b6da8'::uuid,'Honda','Insight',ARRAY['insight']::text[]),
('89bee6ab-3470-40ce-996f-c92ecf99e664'::uuid,'Honda','Fit',ARRAY['fit']::text[]),
('f83daf75-6fc1-4b65-ad7d-cbf6b1f6532c'::uuid,'Honda','Prelude',ARRAY['prelude']::text[]),
('00000000-0000-4000-f000-000000000007'::uuid,'Honda','CRX',ARRAY['crx','cr-x','crx si','cr-x si','crx hf','crx dx']::text[]),
('4b93f1bb-8fce-4a6a-af39-300f5f245ca7'::uuid,'Honda','Civic',ARRAY['civic','civic si','civic type r','civic ex','civic lx','civic hatchback','civic coupe','civic sedan','acty','ra107','reynard','legend','tn360','orthia','az600','s mx','vigor','city','torneo','logo','horizon','concerto','s']::text[]);
CREATE TEMP TABLE honda_cases(model text,expected text);
INSERT INTO honda_cases VALUES ('city cabriolet 5-speed','City'),('legend sedan','Legend'),('civic type r','Civic'),('civic si','Civic'),('civic hatchback','Civic'),('acty truck','Acty'),('s2000 cr','S2000'),('accord','Accord'),('s',NULL),('forman s',NULL),('orthia',NULL),('reynard',NULL);
INSERT INTO public.vehicles(id,make,model,sale_date) SELECT md5('Honda'||model)::uuid,'Honda',model,current_date-1 FROM honda_cases;
INSERT INTO public.mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount) SELECT md5('Honda'||model)::uuid,'Honda',model,1990,'Bring a Trailer','sold',1000 FROM honda_cases;
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
SELECT pg_temp.ok('baseline City and Legend incorrectly belong to Civic',(SELECT family='Civic' FROM public.mv_model_family_names WHERE make_l='honda' AND model_l='city cabriolet 5-speed') AND (SELECT family='Civic' FROM public.mv_model_family_names WHERE make_l='honda' AND model_l='legend sedan'));
CREATE TEMP TABLE honda_sources AS SELECT jsonb_agg(to_jsonb(v) ORDER BY id) AS payload FROM public.vehicles v WHERE make='Honda';
SELECT public.record_family_price_index(jsonb_build_object('brand','Honda','family_key','4b93f1bb-8fce-4a6a-af39-300f5f245ca7','fitted_at',now(),'period_kind',NULL,'series','[]'::jsonb,'change',jsonb_build_object('change_12m',0.2,'lo',0.1,'hi',0.3,'n_last12',100,'n_prior12',100,'verdict','up','method','hedonic_v1')));
\ir ../migrations/20261019021500_separate_honda_civic_model_identity.sql
\ir ../migrations/20261019021500_separate_honda_civic_model_identity.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('twelve Honda cases reach correct model family or remain unresolved',NOT EXISTS(SELECT FROM honda_cases c LEFT JOIN public.mv_model_family_names n ON n.make_l='honda' AND n.model_l=c.model WHERE n.family IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('native intake agrees with corrected Honda models',NOT EXISTS(SELECT FROM honda_cases c CROSS JOIN LATERAL public.normalize_vehicle_model('Honda',c.model,1990) n WHERE n.canonical_model IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('Honda sale counts and dollars conserved',(SELECT count(*)=12 AND sum(usd)=12000 FROM public.mv_family_sales WHERE brand='Honda'));
SELECT pg_temp.ok('original vehicle source fields unchanged',(SELECT payload FROM honda_sources)=(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vehicles v WHERE make='Honda'));
SELECT pg_temp.ok('contaminated Civic fit withheld by public reader',(public.family_price_index_read('Honda','4b93f1bb-8fce-4a6a-af39-300f5f245ca7')->'change'->>'method')='identity_membership_changed_v1' AND (public.family_price_index_read('Honda','4b93f1bb-8fce-4a6a-af39-300f5f245ca7')->'change'->>'change_12m') IS NULL);
SELECT pg_temp.ok('superseded Civic aliases preserved',(SELECT notes LIKE '%reynard%' FROM canonical_models WHERE id='4b93f1bb-8fce-4a6a-af39-300f5f245ca7'));
