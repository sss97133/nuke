-- Empty disposable PG17 only; source-supported names with synthetic vehicles/amounts.
\ir test_fiat_model_identity_separation.sql
INSERT INTO public.canonical_makes(id,canonical_name,display_name,aliases) VALUES ('25c96497-6ead-4f24-b62f-7dc6187eeb9f','Lotus','Lotus','{}');
INSERT INTO public.canonical_models(id,make,canonical_model,aliases) VALUES
('014aa896-37c5-40c6-979b-91f7ffb37e83'::uuid,'Lotus','Evora',ARRAY['evora']::text[]),
('ec9b0078-2ee4-42a6-8bd0-d93a8a120576'::uuid,'Lotus','Elise',ARRAY['elise']::text[]),
('02c600b7-31d9-4af0-969e-bf3e53e1d08b'::uuid,'Lotus','Esprit',ARRAY['esprit']::text[]),
('9c2c4c00-5e00-489c-be9c-2a81670a899f'::uuid,'Lotus','Eagle',ARRAY['eagle']::text[]),
('63f7d9b7-89df-42d8-bf41-c58671e56762'::uuid,'Lotus','Europa',ARRAY['europa']::text[]),
('8f8a217f-b072-4daf-ac59-1b78d805a095'::uuid,'Lotus','Monaco',ARRAY['monaco']::text[]),
('47e97102-1d7f-41f5-8928-3c1b17212c6f'::uuid,'Lotus','MEL',ARRAY['mel']::text[]),
('e2193a22-0066-4c8b-96db-8682f1ef28fd'::uuid,'Lotus','Elite',ARRAY['elite']::text[]),
('31597948-246d-427f-b04e-3078af8b55da'::uuid,'Lotus','Eclat',ARRAY['eclat']::text[]),
('7fda24e8-d092-41b8-9129-3326796bbe9e'::uuid,'Lotus','Elan',ARRAY['elan']::text[]),
('8630b9dd-21af-4259-9019-fb721754c9d8'::uuid,'Lotus','Exige',ARRAY['exige']::text[]),
('1f3d52ad-b379-4fe5-b202-7035d4a7f035'::uuid,'Lotus','Spa',ARRAY['spa']::text[]),
('7e5fb8fc-4df6-40db-932b-5f26ebaf5bbc'::uuid,'Lotus','Monza',ARRAY['monza']::text[]),
('b9403441-3cfd-4a3b-8a8a-ca31df1ca3ca'::uuid,'Lotus','Turbo Esprit',ARRAY['turbo esprit']::text[]),
('895c829f-a4aa-4fc2-ba66-06be3b23502b'::uuid,'Lotus','Emira',ARRAY['emira']::text[]),
('8893191f-346f-485b-9e74-0c04744601f4'::uuid,'Lotus','ELETRE',ARRAY['eletre']::text[]),
('076230be-d527-431d-9274-8b78847360f5'::uuid,'Lotus','Elise',ARRAY['340r']::text[]),
('2d14d532-2756-4615-8211-91de4f9d8d07'::uuid,'Lotus','Eleven',ARRAY['22','311','70','eleven','mark 10','mk iiib','stalker','type 81 3','xi']::text[]),
('00000000-0000-4000-f000-000000000176'::uuid,'Lotus','Cortina',ARRAY['cortina','cortina mk1','cortina mk2','elan +2']::text[]),
('00000000-0000-4000-f000-000000000285'::uuid,'Lotus','Type 18',ARRAY['18 formula junior','19 monte carlo','20 formula junior','47 gt','climax type 12','climax type 16','cosworth ford type 49b','e21','excel','t125','turbine powered indy','type 107c','type 12','type 125','type 14','type 16','type 18','type 19','type 20','type 22','type 30','type 34','type 47','type 49b','type 51','type 59','type 61','type 72']::text[]),
('c3955721-71ca-4738-be9b-f8d96b263ada'::uuid,'Lotus','Elise',ARRAY['2 eleven','2-eleven']::text[]),
('00000000-0000-4000-f000-000000000175'::uuid,'Lotus','Seven',ARRAY['seven','super seven','seven series 2','seven series 3','seven series 4','23b','23','eleven','sport coupe','61','61m','6 tribute','77 replica','7 replica','caterham','locost','climax','espirit','mark ix','type 51r','jim clark','lotus','lx','m250','mark viii','mk6','omega','r27','s3','six','super 7']::text[]);
CREATE TEMP TABLE lotus_cases(model text,expected text);
INSERT INTO lotus_cases VALUES ('climax eleven sports-racing two-seater','Eleven'),('eleven le mans','Eleven'),('seven series 2','Seven'),('super seven','Seven'),('2 eleven gt4 supersport','2-Eleven'),('2-eleven roadster','2-Eleven'),('3 eleven','3-Eleven'),('340r','Elise'),('elise 111s','Elise'),('climax',NULL),('lotus',NULL),('type 81 3',NULL);
INSERT INTO public.vehicles(id,make,model,sale_date) SELECT md5('Lotus'||model)::uuid,'Lotus',model,current_date-10 FROM lotus_cases;
INSERT INTO public.mv_treemap_outcomes(id,brand_name,model,year,source_name,outcome,sold_amount) SELECT md5('Lotus'||model)::uuid,'Lotus',model,2007,'Bring a Trailer','sold',12345 FROM lotus_cases;
CREATE TEMP TABLE lotus_sources AS SELECT jsonb_agg(to_jsonb(v) ORDER BY id) AS payload FROM public.vehicles v WHERE make='Lotus';
\ir ../migrations/20261019013500_separate_lotus_model_identity.sql
\ir ../migrations/20261019013500_separate_lotus_model_identity.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;
REFRESH MATERIALIZED VIEW public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_sales;
SELECT pg_temp.ok('all twelve Lotus model cases reach correct families, unsupported aliases unresolved',NOT EXISTS(SELECT FROM lotus_cases c LEFT JOIN public.mv_model_family_names n ON n.make_l='lotus' AND n.model_l=c.model WHERE n.family IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('native intake agrees on named source models',NOT EXISTS(SELECT FROM lotus_cases c CROSS JOIN LATERAL public.normalize_vehicle_model('Lotus',c.model,NULL) n WHERE n.canonical_model IS DISTINCT FROM c.expected));
SELECT pg_temp.ok('Lotus sale count and dollars conserved including unresolved', (SELECT count(*)=12 AND sum(usd)=12*12345 FROM public.mv_family_sales WHERE brand='Lotus'));
SELECT pg_temp.ok('source testimony unchanged',(SELECT payload FROM lotus_sources)=(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vehicles v WHERE make='Lotus'));
SELECT pg_temp.ok('superseded alias testimony preserved in notes',(SELECT notes LIKE '%climax%' FROM canonical_models WHERE id='00000000-0000-4000-f000-000000000175'));
