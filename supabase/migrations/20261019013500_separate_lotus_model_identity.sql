-- Source-supported Lotus model identities. No vehicle/source testimony changes.
-- https://www.lotuscars.com/en-GB/lotus-story/road-cars/{seven,eleven,2-eleven,3-eleven}
-- 340R retains the manufacturer's Elise relationship; other unassessed names stay unresolved.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
CREATE TEMP TABLE lotus_identity_repair(id uuid PRIMARY KEY,before_model text,after_model text,before_aliases text[],after_aliases text[]) ON COMMIT DROP;
INSERT INTO lotus_identity_repair VALUES
('00000000-0000-4000-f000-000000000175'::uuid,'Seven','Seven',ARRAY['seven','super seven','seven series 2','seven series 3','seven series 4','23b','23','eleven','sport coupe','61','61m','6 tribute','77 replica','7 replica','caterham','locost','climax','espirit','mark ix','type 51r','jim clark','lotus','lx','m250','mark viii','mk6','omega','r27','s3','six','super 7']::text[],ARRAY['seven','super seven','seven series 2','seven series 3','seven series 4','super 7']::text[]),
('2d14d532-2756-4615-8211-91de4f9d8d07'::uuid,'Eleven','Eleven',ARRAY['22','311','70','eleven','mark 10','mk iiib','stalker','type 81 3','xi']::text[],ARRAY['eleven','xi']::text[]),
('c3955721-71ca-4738-be9b-f8d96b263ada'::uuid,'Elise','2-Eleven',ARRAY['2 eleven','2-eleven']::text[],ARRAY['2 eleven','2-eleven']::text[]);
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM lotus_identity_repair r LEFT JOIN public.canonical_models m ON m.id=r.id
 WHERE m.id IS NULL OR m.make IS DISTINCT FROM 'Lotus' OR NOT coalesce(
 ((m.canonical_model=r.before_model AND m.aliases=r.before_aliases) OR
  (m.canonical_model=r.after_model AND m.aliases=r.after_aliases)),false)) THEN
  RAISE EXCEPTION 'Lotus catalog changed; review before identity repair';
 END IF;
END $guard$;
UPDATE public.canonical_models m SET canonical_model=r.after_model,aliases=r.after_aliases,
 notes=concat_ws(E'\n',nullif(m.notes,''),'[2026-10-19 Lotus identity separation] Superseded label/aliases: '||m.canonical_model||' '||to_jsonb(m.aliases)::text||'; references https://www.lotuscars.com/en-GB/lotus-story/road-cars; not physical identity verification.')
FROM lotus_identity_repair r WHERE m.id=r.id AND (m.canonical_model IS DISTINCT FROM r.after_model OR m.aliases IS DISTINCT FROM r.after_aliases);
INSERT INTO public.canonical_models(id,make,canonical_model,aliases,year_start,year_end,notes)
SELECT '153269bb-f6a8-4cbf-93d0-5460e859ae14'::uuid,'Lotus','3-Eleven',ARRAY['3 eleven','3-eleven'],NULL,NULL,
 '[2026-10-19 Lotus identity separation] https://www.lotuscars.com/en-GB/lotus-story/road-cars/3-eleven; not physical identity verification.'
WHERE NOT EXISTS(SELECT FROM public.canonical_models WHERE lower(make)='lotus' AND lower(canonical_model)='3-eleven');
DO $invalidate$
DECLARE r record;
BEGIN
  IF to_regclass('public.family_price_change') IS NOT NULL THEN
    FOR r IN SELECT c.brand, c.family_key FROM public.family_price_change c
             JOIN lotus_identity_repair x ON c.brand = 'Lotus' AND x.id::text = c.family_key
             WHERE c.method IS DISTINCT FROM 'identity_membership_changed_v1' LOOP
      PERFORM public.record_family_price_index(jsonb_build_object('brand', r.brand, 'family_key', r.family_key, 'fitted_at', now(),
        'period_kind', NULL, 'series', '[]'::jsonb, 'change', jsonb_build_object(
          'change_12m', NULL, 'lo', NULL, 'hi', NULL, 'n_last12', 0, 'n_prior12', 0, 'verdict', 'too few to tell',
          'method', 'identity_membership_changed_v1', 'ref_car', jsonb_build_object('basis', 'Model membership corrected; awaiting a new fit'),
          'pairs', NULL, 'rs_change', NULL, 'rs_lo', NULL, 'rs_hi', NULL, 'chips', '[]'::jsonb)));
    END LOOP;
  END IF;
END $invalidate$;
COMMIT;
