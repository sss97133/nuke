-- Civic model aliases must not admit distinct Honda models or the generic token s.
-- https://global.honda/en/heritage/episodes/1972announcingthecivic.html
-- Retain source testimony and superseded reference aliases; unassessed names stay unresolved.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT FROM public.canonical_models WHERE id='4b93f1bb-8fce-4a6a-af39-300f5f245ca7' AND make='Honda' AND canonical_model='Civic'
 AND (aliases=ARRAY['civic','civic si','civic type r','civic ex','civic lx','civic hatchback','civic coupe','civic sedan','acty','ra107','reynard','legend','tn360','orthia','az600','s mx','vigor','city','torneo','logo','horizon','concerto','s']::text[] OR aliases=ARRAY['civic','civic si','civic type r','civic ex','civic lx','civic hatchback','civic coupe','civic sedan']::text[])) THEN
 RAISE EXCEPTION 'Honda Civic catalog changed; review before repair'; END IF;
END $guard$;
UPDATE public.canonical_models SET aliases=ARRAY['civic','civic si','civic type r','civic ex','civic lx','civic hatchback','civic coupe','civic sedan']::text[],
 notes=concat_ws(E'\n',nullif(notes,''),'[2026-10-19 Honda Civic separation] Superseded broad aliases: '||to_jsonb(aliases)::text||'; https://global.honda/en/heritage/episodes/1972announcingthecivic.html')
WHERE id='4b93f1bb-8fce-4a6a-af39-300f5f245ca7' AND aliases IS DISTINCT FROM ARRAY['civic','civic si','civic type r','civic ex','civic lx','civic hatchback','civic coupe','civic sedan']::text[];
INSERT INTO public.canonical_models(id,make,canonical_model,aliases,year_start,year_end,notes)
SELECT '3c3c1a65-520b-49ab-afa0-3bbee787c615'::uuid,'Honda','City',ARRAY['city'],NULL,NULL,
 '[2026-10-19 Honda Civic separation] Model reference https://global.honda/en/heritage/episodes/1981city.html; source testimony remains attributed, not verified physical identity.'
WHERE NOT EXISTS(SELECT FROM public.canonical_models WHERE lower(make)='honda' AND lower(canonical_model)='city');
INSERT INTO public.canonical_models(id,make,canonical_model,aliases,year_start,year_end,notes)
SELECT '50b8057d-8f64-4502-9fd6-75b590efc9f4'::uuid,'Honda','Legend',ARRAY['legend'],NULL,NULL,
 '[2026-10-19 Honda Civic separation] Model reference https://global.honda/jp/news/1985/4851022.html; source testimony remains attributed, not verified physical identity.'
WHERE NOT EXISTS(SELECT FROM public.canonical_models WHERE lower(make)='honda' AND lower(canonical_model)='legend');
-- The saved fit was trained on superseded model membership; use its existing writer.
DO $invalidate$ BEGIN
 IF EXISTS(SELECT FROM public.family_price_change WHERE brand='Honda' AND family_key='4b93f1bb-8fce-4a6a-af39-300f5f245ca7' AND method IS DISTINCT FROM 'identity_membership_changed_v1') THEN
 PERFORM public.record_family_price_index(jsonb_build_object('brand','Honda','family_key','4b93f1bb-8fce-4a6a-af39-300f5f245ca7','fitted_at',now(),
 'period_kind',NULL,'series','[]'::jsonb,'change',jsonb_build_object('change_12m',NULL,'lo',NULL,'hi',NULL,'n_last12',0,'n_prior12',0,
 'verdict','too few to tell','method','identity_membership_changed_v1','ref_car',jsonb_build_object('basis','Civic model membership corrected; awaiting qualified refit'),
 'pairs',NULL,'rs_change',NULL,'rs_lo',NULL,'rs_hi',NULL,'chips','[]'::jsonb)));
 END IF;
END $invalidate$;
COMMIT;
