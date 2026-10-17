-- Model families and spellings the classifieds feed names but canonical_models lacks (2026-10-15).
--
-- MEASURED 2026-10-15 06:30Z (skylar-08, listing-merit fold): 975 of 1,234 priced Craigslist asks in 48 h key to a
-- family (79.0%). Of the 259 misses, 42 are names newer than the dictionary's last build and 217 have no family. The
-- most frequent: AMC Rebel, Pacer, Ambassador and Gremlin; Dodge B-series vans; Ford E-series written without the
-- hyphen (e350); Suzuki Samurai; Toyota HiAce and "landcruiser"; Volvo 240; Lexus ES300; Mercury Comet Caliente;
-- Chevrolet G20 van, P30, Kodiak and Kingswood; Pontiac Grand Ville; Buick "rivera". A listing without a family has
-- no price position on its card.
--
-- CHANGE: spellings added to existing families (Riviera, E-150/250/350, ES, Land Cruiser, 240 and 260 Series, Ram
-- Van), new families for the rest (model years of each line; the family fold allows a year either side), then
-- mv_model_family_names and mv_family_market refreshed so the feed and the map read them now rather than after the
-- daily refreshes (04:05 and 09:10 UTC). Freightliner and other commercial chassis are left out; misparsed makes
-- ("c10", "chevelle", "am") are an intake fix, not a key. Reference rows, not testimony.
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL OR to_regclass('public.mv_model_family_names') IS NULL THEN
    RAISE EXCEPTION 'apply 20261015090000_model_family_names.sql and 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

-- Spellings on existing families: appended once, on every row of the make and model.
WITH add (make_l, model_l, spellings) AS (VALUES
  ('buick', 'riviera', ARRAY['rivera']),
  ('ford', 'e-150', ARRAY['e150', 'e 150', 'econoline 150']),
  ('ford', 'e-250', ARRAY['e250', 'e 250', 'econoline 250']),
  ('ford', 'e-350', ARRAY['e350', 'e 350', 'econoline 350']),
  ('lexus', 'es', ARRAY['es300', 'es 300', 'es250', 'es330', 'es350']),
  ('toyota', 'land cruiser', ARRAY['landcruiser']),
  ('volvo', '240 series', ARRAY['240', '242', '244', '245']),
  ('volvo', '260 series', ARRAY['260', '262', '264', '265']),
  ('dodge', 'ram van', ARRAY['b100', 'b150', 'b200', 'b250', 'b300', 'b350', 'tradesman'])
)
UPDATE public.canonical_models m
SET aliases = m.aliases || ARRAY(SELECT s FROM unnest(a.spellings) s WHERE NOT (s = ANY (m.aliases)))
FROM add a
WHERE lower(m.make) = a.make_l AND lower(m.canonical_model) = a.model_l
  AND NOT (m.aliases @> a.spellings);

-- New families.
INSERT INTO public.canonical_models (make, canonical_model, year_start, year_end, aliases, notes)
SELECT x.make, x.model, x.y0, x.y1, x.aliases, 'Added 2026-10-15 from the classifieds feed''s unkeyed names.'
FROM (VALUES
  ('AMC', 'Rebel', 1967, 1970, ARRAY['rebel', 'rebel machine', 'rebel sst']),
  ('AMC', 'Pacer', 1975, 1980, ARRAY['pacer']),
  ('AMC', 'Ambassador', 1958, 1974, ARRAY['ambassador']),
  ('AMC', 'Gremlin', 1970, 1978, ARRAY['gremlin', 'gremlin x']),
  ('AMC', 'Hornet', 1970, 1977, ARRAY['hornet']),
  ('AMC', 'Matador', 1971, 1978, ARRAY['matador']),
  ('AMC', 'Eagle', 1980, 1988, ARRAY['eagle', 'eagle wagon']),
  ('Suzuki', 'Samurai', 1985, 1995, ARRAY['samurai', 'sj413', 'sj410']),
  ('Toyota', 'HiAce', 1967, NULL, ARRAY['hiace', 'hi ace', 'hi-ace']),
  ('Mercury', 'Comet', 1960, 1977, ARRAY['comet', 'comet caliente', 'caliente', 'comet cyclone']),
  ('Chevrolet', 'Chevy Van', 1964, 1996, ARRAY['chevy van', 'chevyvan', 'g10', 'g20', 'g30', 'g10 van', 'g20 van', 'g30 van', 'beauville', 'sportvan']),
  ('Chevrolet', 'Kingswood', 1969, 1972, ARRAY['kingswood', 'kingswood estate']),
  ('Chevrolet', 'P30', 1964, 1999, ARRAY['p30', 'p20', 'p10', 'step van']),
  ('Chevrolet', 'Kodiak', 1980, 2009, ARRAY['kodiak']),
  ('Pontiac', 'Grand Ville', 1971, 1975, ARRAY['grand ville', 'grandville'])
) AS x(make, model, y0, y1, aliases)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_models m WHERE lower(m.make) = lower(x.make) AND lower(m.canonical_model) = lower(x.model)
);

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;

DO $check$
DECLARE wrong text;
BEGIN
  SELECT string_agg(n.make_l || ' ' || n.model_l || ' -> ' || coalesce(n.family, 'none'), '; ') INTO wrong
  FROM public.mv_model_family_names n
  JOIN (VALUES ('buick', 'rivera', 'Riviera'), ('ford', 'e350', 'E-350'), ('lexus', 'es300', 'ES'),
               ('toyota', 'landcruiser', 'Land Cruiser'), ('volvo', '240', '240 Series'), ('dodge', 'b200', 'Ram Van'),
               ('amc', 'rebel', 'Rebel'), ('chevrolet', 'kingswood', 'Kingswood'), ('chevrolet', 'g20', 'Chevy Van'),
               ('pontiac', 'grandville convertible', 'Grand Ville')) AS e(make_l, model_l, family)
    ON n.make_l = e.make_l AND n.model_l = e.model_l
  WHERE n.family IS DISTINCT FROM e.family;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'names that should key to their family do not: %', wrong;
  END IF;
END $check$;

COMMIT;
