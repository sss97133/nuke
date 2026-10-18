-- Separate factory model identities previously used as catch-all browse buckets.
-- Source testimony and vehicle rows are unchanged. Broad market context remains under the make.
-- New model names: Barcelona Motorcycle Museum Bultaco exhibition catalogue and Suzuki Digital Library.
-- https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf
-- https://www.globalsuzuki.com/motorcycle/smgs/digital-archive/
-- https://www.globalsuzuki.com/globalnews/2010/0121.html
-- Unknown production ranges remain NULL; a named exhibit does not establish a whole production range.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TEMP TABLE model_identity_repair (id uuid PRIMARY KEY, make text, model text, before_aliases text[], after_aliases text[]) ON COMMIT DROP;
INSERT INTO model_identity_repair VALUES
  ('3ff78759-631a-4da2-98cf-b5a3718b69df'::uuid, 'Suzuki', 'Samurai', ARRAY['samuari', 'samurai', 'sj410', 'sj413', 'sx4', 'alto', 'lj20v', 'mighty boy', 'fronte', 'cervo', 'swift', 'equator', 'wagon r', 'kei']::text[], ARRAY['samuari', 'samurai', 'sj410', 'sj413']::text[]),
  ('00000000-0000-4000-f000-000000000217'::uuid, 'Suzuki', 'Jimny', ARRAY['jimny', 'jimny turbo', 'lj80', 'sidekick', 'x-90', 'x90', 'cappuccino']::text[], ARRAY['jimny', 'jimny turbo', 'lj80']::text[]),
  ('00000000-0000-4000-f000-000000000216'::uuid, 'Suzuki', 'Carry', ARRAY['cara', 'carry', 'carry dump truck', 'carry pickup', 'carry truck', 'da63t', 'every']::text[], ARRAY['carry', 'carry dump truck', 'carry pickup', 'carry truck', 'da63t']::text[]),
  ('00000000-0000-4000-f000-000000000711'::uuid, 'Suzuki', 'RM250', ARRAY['rm250', 'rm125', 'rm400', 'rm370', 'rm500', 'rm80', 'tm400', 'tm250', 'tm125', 'tm100', 'tm75', 'ts400', 'ts250', 'ts185', 'ts125', 'ts100', 'ts90', 'ts 90r', 'ts50', 'tc125', 'tc90', 'rv90', 'rv125', 'pe250', 'pe175', 'dr350', 'dr650', 'jr50', 'lt500r', 'lt250r', 'tc 185', 'tc 90r', 'rm465', 'rl250', 'rb50', 'lt', 'lt50', 'alt50', 'rh250', 'dsxr', 'rm z450', 'rmz450', 'rm100a', 'rm125a', 'tm125k', 'tm250l', 'rm125m', 'rm370a', 'tc305', 'tm', 'tc250', 'rm250a', 'ts 125', 'tsr 500', 'rn125', 'tc 90j', 'sp600', 'rm60', 'rm 60', 'tc200', 'ts 185', 'ts 185j', 'vanvan', 'rv200', 'tc 125', 'pe250b', 'tm 100', 'dr z400sm', 'dr z', 'lt50h', 'rm125n', 'tm 400', 'tm400j', 'rm 250', 'tc 120', 'tm 125', 'jr 50', 'jr50z', 'lt125', 'ds80', 'ts75', 'quadzilla', 'dr100', 'lt450r', 'dr250', 'tc 100', 'tc100', 'mt50', 'lz 50a', 'quadrunner', 'drm420', '250rm', 'rm100', 'rl 250']::text[], ARRAY['rm250', 'rm250a', 'rm 250', '250rm']::text[]),
  ('00000000-0000-4000-f000-000000000712'::uuid, 'Suzuki', 'Samurai', ARRAY['samurai', 'sidekick', 'vitara', 'grand vitara', 'x 90', 'x90', 'lj10', 'lj20', 'lj50', 'lj80', 'sj410', 'sj413', 'sx4', 'alto', 'lj20v', 'mighty boy', 'fronte', 'cervo', 'swift', 'equator', 'wagon r', 'kei']::text[], ARRAY['samurai', 'sj410', 'sj413']::text[]),
  ('00000000-0000-4000-f000-000000000218'::uuid, 'Suzuki', 'GSX-R', ARRAY['bimota sb2', 'gamma 500', 'gs1000', 'gs1000s', 'gs1100e', 'gsx1300r hayabusa', 'gsxr', 'gsx-r1000', 'gsx r1100', 'gsx-r 1100', 'gsx-r1100', 'gsx-r750', 'gsxr 750', 'gt380', 'gt550', 'gt750', 'hayabusa', 'jr50', 're5', 'rg 500', 'rg500', 'rg500 gamma', 'rgb500', 'rm125', 'rm250', 't125', 't500', 't500m', 'tm400', 'tl1000r', 'rg250', 'rg 250', 't10', 'x6', 'gv700gl', 'gt 500', 'gr650', 'gs550e', 'a100', 'gsxr1100r', 'gt750m', 'gsxr750', 'gs650gl', 'gs650', 'gsx1300r', 'xn 85', 'tl1000', 'gsxr1100', 'v strom', 'gt550j', 'boulevard', 'rgv250sp', 'gsx r50', 'gsx1000s', 'colleda', 'hyabusa', 'gt380l', 'gsx', 'gsxr100r', 'gsx 600r', 's32 2', 's32', 'gsx r600', 'gsk 1100', 'tlr 1000', 'gs1150es', 't500r', 'tl1000s', 'burgman', 'bandit', 'ls650', 'vx800', 'gsx r400', 'gv1400', 'gsx r600m', 'titan', 'sv650', 'gs1000e', 'gs750e', 'm15', 'dl1000', 'gs1100es', 't200', 'gs450t', 'vz800', 'b105p', 'b105', 'gs550t', 'gsf250', 'gs1150ef', 'gsxr400', 'tu250x', '250 savage', 'intruder', 'vs700gle', 'gp100', 'gs500e', 'b120p', 'k11p', 'k11', 'gz250', 'm12 2', 'k15', 'an400y', 'fa50', 'gsx600f', 'gsx550e', 'gs850', 'u50', '340 nomad', 'a 100', 'indian custom', 'race bike', 'x']::text[], ARRAY['gsxr', 'gsx-r1000', 'gsx r1100', 'gsx-r 1100', 'gsx-r1100', 'gsx-r750', 'gsxr 750', 'gsxr1100r', 'gsxr750', 'gsxr1100', 'gsx r600', 'gsx r400', 'gsx r600m', 'gsxr400']::text[]),
  ('00000000-0000-4000-f000-000000000710'::uuid, 'Suzuki', 'GSX-R', ARRAY['gsx r', 'gsxr', 'gs1000', 'gs1000s', 'gs1000sz', 'gs100sz', 'gs1100', 'gs1150', 'gs850g', 'gs750', 'gs550', 'katana', 'hayabusa', 'rg500', 'rg400', 'rgv250', 'gt750', 'gt550', 'gt500', 'gt380', 'gt250', 'gt185', 't500', 't350', 't250', 't20', 're5', 'xn85', 'tl1000r', 'rg250', 'rg 250', 't10', 'x6', 'gv700gl', 'gt 500', 'gr650', 'gs550e', 'a100', 'gsxr1100r', 'gt750m', 'gsxr750', 'gs650gl', 'gs650', 'gsx1300r', 'xn 85', 'tl1000', 'gsxr1100', 'v strom', 'gt550j', 'boulevard', 'rgv250sp', 'gsx r50', 'gsx1000s', 'colleda', 'hyabusa', 'gt380l', 'gsx', 'gsxr100r', 'gsx 600r', 's32 2', 's32', 'gsx r600', 'gsk 1100', 'tlr 1000', 'gs1150es', 't500r', 'tl1000s', 'burgman', 'bandit', 'ls650', 'vx800', 'gsx r400', 'gv1400', 'gsx r600m', 'titan', 'sv650', 'gs1000e', 'gs750e', 'm15', 'dl1000', 'gs1100es', 't200', 'gs450t', 'vz800', 'b105p', 'b105', 'gs550t', 'gsf250', 'gs1150ef', 'gsxr400', 'tu250x', '250 savage', 'intruder', 'vs700gle', 'gp100', 'gs500e', 'b120p', 'k11p', 'k11', 'gz250', 'm12 2', 'k15', 'an400y', 'fa50', 'gsx600f', 'gsx550e', 'gs850', 'u50', '340 nomad', 'a 100', 'indian custom', 'race bike', 'x']::text[], ARRAY['gsx r', 'gsxr', 'gsxr1100r', 'gsxr750', 'gsxr1100', 'gsx r600', 'gsx r400', 'gsx r600m', 'gsxr400']::text[]),
  ('00000000-0000-4000-f000-000000000314'::uuid, 'Bultaco', 'Pursang', ARRAY['pursang', 'pursang 250', 'pursang 360', 'sherpa', 'matador', 'astro', 'metralla', 'frontera', 'alpina', 'lobito', 'model 23', 'el bandido', 'bandido', 'el bandito', 'metisse', 'mercurio', 'tss', 'mk7', '350', '250', 'el tigre', 'el montadero', '360 tss', 's100']::text[], ARRAY['pursang', 'pursang 250', 'pursang 360']::text[]);

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM model_identity_repair r LEFT JOIN public.canonical_models m ON m.id = r.id
             WHERE m.id IS NULL OR m.make IS DISTINCT FROM r.make OR m.canonical_model IS DISTINCT FROM r.model
                OR (m.aliases IS DISTINCT FROM r.before_aliases AND m.aliases IS DISTINCT FROM r.after_aliases)) THEN
    RAISE EXCEPTION 'model alias catalog changed; review identity repair before applying';
  END IF;
END $guard$;

UPDATE public.canonical_models m
SET aliases = r.after_aliases,
    notes = concat_ws(E'\n', nullif(m.notes, ''), '[2026-10-18 identity separation] Superseded broad-bucket aliases: ' || to_jsonb(m.aliases)::text)
FROM model_identity_repair r
WHERE m.id = r.id AND m.aliases IS DISTINCT FROM r.after_aliases;

-- Reuse an existing exact make/model row, never mint a second competing identity.
WITH named(id, make, model, aliases, source) AS (VALUES
  ('1165da59-15e8-49cd-8ed1-6ba6ad9faf4f'::uuid, 'Bultaco', 'Sherpa T', ARRAY['sherpa t']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('ea75c31d-a555-41c9-8cdd-b262b3d0df40'::uuid, 'Bultaco', 'Sherpa S', ARRAY['sherpa s']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('7ff2aa06-b564-4c45-ad26-b9f8e05cced8'::uuid, 'Bultaco', 'Matador', ARRAY['matador']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('6b5af555-e2c5-44c9-a204-18eadc6798d6'::uuid, 'Bultaco', 'Astro', ARRAY['astro']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('d8ba3b22-61be-48e7-bb6d-cf83fa6a21fa'::uuid, 'Bultaco', 'Metralla', ARRAY['metralla']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('236e11c9-6f06-4742-8707-b4d49407b736'::uuid, 'Bultaco', 'Frontera', ARRAY['frontera']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('ab2776d7-ea2b-47ff-b696-0f58410c9da3'::uuid, 'Bultaco', 'Alpina', ARRAY['alpina']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('6404df08-ad5e-49bb-837a-7ccb3f398563'::uuid, 'Bultaco', 'Lobito', ARRAY['lobito']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('db40adc3-729e-41ee-b183-ab6323afce2c'::uuid, 'Bultaco', 'TSS', ARRAY['tss']::text[], 'https://www.museumoto.com/DOCS/dossier_bultaco_2014_en.pdf'),
  ('aabfc39b-89ad-4fb1-a083-962ca33384ca'::uuid, 'Suzuki', 'Hayabusa', ARRAY['hayabusa', 'gsx1300r hayabusa', 'gsx1300r', 'hyabusa']::text[], 'https://www.globalsuzuki.com/motorcycle/smgs/digital-archive/'),
  ('cb03c17b-09c5-42c9-bb94-59d706d63a39'::uuid, 'Suzuki', 'RE-5', ARRAY['re5', 're 5']::text[], 'https://www.globalsuzuki.com/motorcycle/smgs/digital-archive/'),
  ('f9c9cc35-0f68-4857-ae20-816ff91baf3a'::uuid, 'Suzuki', 'GT750', ARRAY['gt750', 'gt750m', 'gt 750']::text[], 'https://www.globalsuzuki.com/motorcycle/smgs/digital-archive/'),
  ('be4132a8-ba01-4751-b5a0-a1d27b40e8a4'::uuid, 'Suzuki', 'Cappuccino', ARRAY['cappuccino']::text[], 'https://www.globalsuzuki.com/globalnews/2010/0121.html'),
  ('02ef4107-3cef-4202-b2fa-7b13336feb1a'::uuid, 'Suzuki', 'RM125', ARRAY['rm125', 'rm 125', 'rm125a', 'rm125m', 'rm125n']::text[], 'https://www.globalsuzuki.com/motorcycle/smgs/digital-archive/'))
INSERT INTO public.canonical_models (id, make, canonical_model, aliases, year_start, year_end, notes)
SELECT n.id, n.make, n.model, n.aliases, NULL, NULL, '[2026-10-18 identity separation] Model-name reference: ' || n.source || '; not a verified physical vehicle identity.'
FROM named n
WHERE NOT EXISTS (SELECT 1 FROM public.canonical_models m WHERE lower(m.make) = lower(n.make) AND lower(m.canonical_model) = lower(n.model));

-- A fit made with superseded membership is not a fit for the corrected model. Use its existing writer.
-- The old reference aliases survive above; the pre-repair fit receipt is retained privately by the operator.
DO $invalidate$
DECLARE r record;
BEGIN
  IF to_regclass('public.family_price_change') IS NOT NULL THEN
    FOR r IN SELECT c.brand, c.family_key FROM public.family_price_change c
             JOIN model_identity_repair x ON x.make = c.brand AND x.id::text = c.family_key
             WHERE c.method <> 'identity_membership_changed_v1' LOOP
      PERFORM public.record_family_price_index(jsonb_build_object('brand', r.brand, 'family_key', r.family_key, 'fitted_at', now(),
        'period_kind', NULL, 'series', '[]'::jsonb, 'change', jsonb_build_object(
          'change_12m', NULL, 'lo', NULL, 'hi', NULL, 'n_last12', 0, 'n_prior12', 0, 'verdict', 'too few to tell',
          'method', 'identity_membership_changed_v1', 'ref_car', jsonb_build_object('basis', 'Model membership corrected; awaiting a new fit'),
          'pairs', NULL, 'rs_change', NULL, 'rs_lo', NULL, 'rs_hi', NULL, 'chips', '[]'::jsonb)));
    END LOOP;
  END IF;
END $invalidate$;

COMMIT;
