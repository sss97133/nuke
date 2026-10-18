-- Porsche model families the brand map's drill misfiled or missed, from its "Other models" list (2026-10-15).
--
-- MEASURED 2026-10-15 05:06Z (treemap_brand_families / treemap_family_models, logged out): the Carrera GT (26 sales,
-- $42.6M) sat inside the 911 family, because the 911 row's alias "carrera" was the longest phrase its name matched;
-- the 911SC written as one word (124 sales, $7.6M) and GT3 RS names without "911" matched no family; the 959, 935,
-- 917, 956, 962 and 934 have no canonical_models row, so their sales sat in "Other models" (959 Komfort 13 sales
-- $21.1M, 935 8 $18.6M, 917K 2 $14.1M, 956 1 $10.1M, 962/962C 7 $11.0M, 934 and 934/5 9 $9.5M). Porsche: 97.2% of
-- 27,510 confirmed sales in named families before this.
--
-- CHANGE: canonical_models rows for those seven cars (model years of the factory programs; the family fold allows a
-- year either side), five spellings added to the 911 row's aliases, then mv_model_family_names and mv_family_market
-- refreshed so the drill reads them now rather than after the daily refreshes (04:05 and 09:10 UTC). The phrase
-- "carrera gt" is longer than "carrera", so the Carrera GT now keys to its own family. Reference rows, not testimony.
--
-- EXPECTED after: Porsche families include Carrera GT, 959, 935, 917, 956, 962 and 934; no 911 model name is
-- "Carrera GT"; 911SC sales count in the 911.
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.canonical_models WHERE lower(make) = 'porsche' AND canonical_model = '911') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one Porsche 911 row in canonical_models';
  END IF;
  IF to_regclass('public.mv_family_market') IS NULL OR to_regclass('public.mv_model_family_names') IS NULL THEN
    RAISE EXCEPTION 'apply 20261015090000_model_family_names.sql and 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

INSERT INTO public.canonical_models (make, canonical_model, year_start, year_end, aliases, notes)
SELECT 'Porsche', x.model, x.y0, x.y1, x.aliases, x.notes || ' Added 2026-10-15 from the brand map''s Other models.'
FROM (VALUES
  ('Carrera GT', 2004, 2006, ARRAY['carrera gt', '980'], 'Type 980 supercar; its own family, not a 911.'),
  ('959', 1986, 1993, ARRAY['959', '959 komfort', '959 sport'], 'Type 959.'),
  ('935', 1976, 1984, ARRAY['935'], 'Type 935 racing car (factory and customer).'),
  ('917', 1969, 1973, ARRAY['917', '917k'], 'Type 917 racing car.'),
  ('956', 1982, 1984, ARRAY['956'], 'Type 956 Group C car.'),
  ('962', 1984, 1994, ARRAY['962', '962c'], 'Type 962 racing car.'),
  ('934', 1976, 1977, ARRAY['934', '934/5'], 'Type 934 racing car.')
) AS x(model, y0, y1, aliases, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_models m WHERE lower(m.make) = 'porsche' AND lower(m.canonical_model) = lower(x.model)
);

UPDATE public.canonical_models m
SET aliases = m.aliases || ARRAY(
  SELECT a FROM unnest(ARRAY['911sc', '911 sc', 'gt3', 'gt3 rs', 'gt2 rs']) a WHERE NOT (a = ANY (m.aliases))
)
WHERE lower(m.make) = 'porsche' AND m.canonical_model = '911'
  AND NOT (m.aliases @> ARRAY['911sc', '911 sc', 'gt3', 'gt3 rs', 'gt2 rs']);

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_model_family_names;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = 'carrera gt' AND family <> 'Carrera GT') THEN
    RAISE EXCEPTION 'carrera gt still keys to another family';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mv_model_family_names WHERE make_l = 'porsche' AND model_l = '911sc' AND family IS DISTINCT FROM '911') THEN
    RAISE EXCEPTION '911sc does not key to the 911';
  END IF;
END $check$;

COMMIT;
