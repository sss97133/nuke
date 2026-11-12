-- A source for pre-1981 GM VIN decodes. NHTSA's VPIC decodes only 17-character VINs, so a 1972-1980 GM car VIN
-- (for example the 13-character Firebird layout: division, series, body, engine letter, year, plant, serial) had no
-- admitted decode and its year, model and series reached the profile with no source. decode-vin-and-update now
-- decodes those VINs by the chart cited here and lands one specification observation under this slug.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

INSERT INTO public.observation_sources
  (slug, display_name, category, base_url, supported_observations, requires_auth, notes, base_trust_score)
VALUES
  ('gm_vin_chart', 'GM VIN chart (pre-1981)', 'registry', 'https://news.classicindustries.com/trans-am-firebird-vin-decoder',
   ARRAY['specification']::public.observation_kind[], false,
   'Positional decode of a pre-1981 GM car VIN by a published chart (Classic Industries Firebird VIN decoder, retrieved 2026-11-11): series, body, engine letter, model year and assembly plant. States factory configuration only; it is not evidence of the current engine or trim.',
   0.9)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
