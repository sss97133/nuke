-- Slice 15:
-- 1. Fix cron job `refresh-vehicle-name-dictionary` so it sets `statement_timeout = '300s'`
--    before `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary`
--    (it was failing every night at 03:50:10 UTC under the 10s statement timeout).
-- 2. Strip multi-word generic body/trim suffixes (`custom coupe`, `custom convertible`,
--    `2 door coupe`, `4-speed`, etc.) from catch-all `Custom` / `Deluxe` / `Super` families
--    so 1-word iconic families (`Corvette`, `Camaro`, `Mustang`, `Thunderbird`, `Barracuda`,
--    `Road Runner`, `Satellite`) are never hijacked by 2-word substring matches.
-- 3. Widen pre-war motorcycle year bounds (`Harley-Davidson EL`, `Indian Four`), add
--    `GMC K10`/`C10` to `GMC K1500`/`C1500`, and key 15 additional specialist marques.

BEGIN;

-- 1. Ensure `refresh-vehicle-name-dictionary` runs with a 300s statement_timeout
UPDATE cron.job
SET command = 'SET statement_timeout = ''300s''; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary'
WHERE jobname = 'refresh-vehicle-name-dictionary';

-- 2. Insert 15 specialist / coachbuilt / vintage motorcycle families where not present
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    ('00000000-0000-4000-f000-000000000226'::uuid, 'Nash-Healey', 'Roadster', 1951, NULL::integer,
      ARRAY['roadster', 'le mans', 'nash healey']),
    ('00000000-0000-4000-f000-000000000227'::uuid, 'Intermeccanica', 'Italia', 1959, NULL::integer,
      ARRAY['italia', 'italia spyder', 'speedster', 'kubelwagen', 'indr']),
    ('00000000-0000-4000-f000-000000000228'::uuid, 'Messerschmitt', 'KR200', 1953, NULL::integer,
      ARRAY['kr200', 'kr175']),
    ('00000000-0000-4000-f000-000000000229'::uuid, 'Noble', 'M400', 1999, NULL::integer,
      ARRAY['m400', 'm12', 'm12 gto', 'm12 gto 3r']),
    ('00000000-0000-4000-f000-000000000230'::uuid, 'Diamond T', '201', 1911, NULL::integer,
      ARRAY['201', 't 201', 't 201 pickup', 'model 201', 'pickup']),
    ('00000000-0000-4000-f000-000000000231'::uuid, 'Avanti', 'II', 1965, NULL::integer,
      ARRAY['ii', 'avanti ii', 'convertible', 'coupe']),
    ('00000000-0000-4000-f000-000000000232'::uuid, 'LaSalle', 'Series 50', 1927, NULL::integer,
      ARRAY['series 50', '50', '303', '345', 'series 52']),
    ('00000000-0000-4000-f000-000000000233'::uuid, 'Autobianchi', 'Bianchina', 1957, NULL::integer,
      ARRAY['bianchina', 'bianchina trasformabile', 'trasformabile', 'eden rocc']),
    ('00000000-0000-4000-f000-000000000234'::uuid, 'Daimler', 'SP250', 1950, NULL::integer,
      ARRAY['sp250', 'dart', 'ds420', '250', 'v8']),
    ('00000000-0000-4000-f000-000000000235'::uuid, 'Beck', '550 Spyder', 1950, NULL::integer,
      ARRAY['550 spyder', '550', 'speedster', '904']),
    ('00000000-0000-4000-f000-000000000236'::uuid, 'Ultima', 'GTR', 1983, NULL::integer,
      ARRAY['gtr', 'can am', 'can-am', 'evolution', 'rs']),
    ('00000000-0000-4000-f000-000000000237'::uuid, 'Ariel', 'Square Four', 1931, NULL::integer,
      ARRAY['square four', 'red hunter', 'vh']),
    ('00000000-0000-4000-f000-000000000238'::uuid, 'Brough Superior', 'SS80', 1919, NULL::integer,
      ARRAY['ss80', 'ss100', '11 50', '11-50']),
    ('00000000-0000-4000-f000-000000000239'::uuid, 'Qvale', 'Mangusta', 1999, NULL::integer,
      ARRAY['mangusta']),
    ('00000000-0000-4000-f000-000000000240'::uuid, 'Muntz', 'Jet', 1949, NULL::integer,
      ARRAY['jet'])
)
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases
FROM new_families nf
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
);

-- 3. Replace multi-word generic body/trim aliases on catch-all Custom/Deluxe/Super families
--    with 1-word model roots so they match standalone "Custom" / "Custom Coupe" without
--    hijacking "Corvette Custom Convertible", "Mustang Custom Coupe", or "Barracuda Custom Coupe".
WITH exact_alias_resets(make, canonical_model, clean_aliases) AS (
  VALUES
    ('Chevrolet', 'Custom', ARRAY['custom', 'confederate', 'eagle', 'standard']),
    ('Ford', 'Custom', ARRAY['custom', 'customline', 'custom 300', 'custom 500', 'dearborn deuce', 'model 40', 'standard', 'coe', 'gpw']),
    ('Mercury', 'Custom', ARRAY['custom', 'customline']),
    ('Plymouth', 'Deluxe', ARRAY['special deluxe', 'deluxe', 'custom', 'valiant', 'cranbrook', 'cambridge', 'concord', 'plaza', 'suburban', 'vip']),
    ('Buick', 'Super', ARRAY['super', 'super 8', 'super convertible', 'super eight', 'super estate wagon', 'super riviera', 'custom']),
    ('Willys', 'Americar', ARRAY['americar', 'americar custom coupe', 'gasser'])
)
UPDATE public.canonical_models cm
SET aliases = ear.clean_aliases
FROM exact_alias_resets ear
WHERE lower(cm.make) = lower(ear.make)
  AND lower(cm.canonical_model) = lower(ear.canonical_model);

-- 4. Widen year bounds on pre-war motorcycles, Maserati Coupe, and GMC trucks
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Harley-Davidson', 'EL', 1903, true),
    ('Indian', 'Four', 1901, true),
    ('Maserati', 'Coupe', 1950, true),
    ('Maserati', '3500 GT', 1955, true),
    ('GMC', 'C1500', 1960, true),
    ('GMC', 'K1500', 1960, true),
    ('Plymouth', 'Barracuda', 1964, true),
    ('Plymouth', 'GTX', 1966, true),
    ('Plymouth', 'Duster', 1969, true),
    ('Chevrolet', 'Nova', 1961, true),
    ('Chevrolet', 'Impala', 1956, true),
    ('Chevrolet', 'Chevelle', 1963, true),
    ('Chevrolet', 'C10', 1960, true)
)
UPDATE public.canonical_models cm
SET
  year_start = CASE
    WHEN cm.year_start IS NULL THEN yf.new_year_start
    ELSE LEAST(cm.year_start, yf.new_year_start)
  END,
  year_end = CASE
    WHEN yf.clear_year_end THEN NULL
    ELSE cm.year_end
  END
FROM year_fixes yf
WHERE lower(cm.make) = lower(yf.make)
  AND lower(cm.canonical_model) = lower(yf.canonical_model);

-- 5. Add disambiguating aliases to iconic families and remaining specialist models
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Plymouth', 'Barracuda', ARRAY['cuda', 'cuda custom', 'cuda aar', 'aar cuda', 'hemi cuda', 'barracuda custom']),
    ('Plymouth', 'GTX', ARRAY['gtx custom']),
    ('Plymouth', 'Duster', ARRAY['duster custom', 'duster 340']),
    ('Chevrolet', 'Nova', ARRAY['nova custom', 'nova ss', 'chevy ii']),
    ('Chevrolet', 'Impala', ARRAY['impala custom', 'impala ss']),
    ('Chevrolet', 'Chevelle', ARRAY['chevelle custom', 'malibu']),
    ('Chevrolet', 'C10', ARRAY['c10 custom', 'k10 custom']),
    ('GMC', 'K1500', ARRAY['k10', 'k15', 'k20', 'k25', 'k30', 'k35', 'k2500', 'k3500']),
    ('GMC', 'C1500', ARRAY['c10', 'c15', 'c20', 'c25', 'c30', 'c35', 'c2500', 'c3500']),
    ('Ducati', 'SportClassic', ARRAY['paul smart 1000', 'sport 1000', 'gt 1000', 'mh900e']),
    ('Maserati', '3500 GT', ARRAY['5000 gt', '5000 gt coupe'])
)
UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT x ORDER BY x)
  FROM unnest(coalesce(cm.aliases, '{}'::text[]) || ta.add_aliases) AS x
)
FROM target_additions ta
WHERE lower(cm.make) = lower(ta.make)
  AND lower(cm.canonical_model) = lower(ta.canonical_model);

COMMIT;
