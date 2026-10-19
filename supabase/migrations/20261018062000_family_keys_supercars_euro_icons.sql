-- canonical_models: Supercar & European collector family keys across Ferrari, McLaren, Lamborghini, Mercedes-Benz,
-- Aston Martin, Audi, Volkswagen, Lancia, Pagani, Tucker, Jaguar, Porsche, and Shelby.
--
-- Measured 2026-10-16 on mv_family_market:
-- * Ferrari LaFerrari (21 sold, $105.04M) and LaFerrari Aperta (2 sold, $12.08M) fell into "other" because
--   canonical_models had "La Ferrari" with a space ('la ferrari') instead of 'laferrari'.
-- * Ferrari F12berlinetta (36 sold, $11.97M) and F12tdf (9 sold, $13.34M) fell into "other" because canonical_models
--   had 'f12 berlinetta' and 'f12 tdf (tour de france)' with spaces instead of 'f12berlinetta' and 'f12tdf'.
-- * Ferrari F512 M (19 sold, $10.38M) and 1976-1982 512 BB (25 sold, $6.84M) fell into "other" because Testarossa
--   (which holds '512 bb' and '512 bbi') had year_start = 1984 and lacked 'f512 m' / 'f512m'.
-- * McLaren F1 / F1 GTR / F1 GTR Longtail (7 sold, $90.95M) and McLaren Speedtail (5 sold, $11.87M) had no rows in
--   canonical_models.
-- * Lamborghini Miura (P400 / P400 S / P400 SV: 31 sold, $54.60M), Countach (Countach / 5000 QV / 25th Anniversary /
--   LP400 / LP5000 S: 45+ sold, $25.10M+), and 350 GT (12 sold, $6.69M) had no rows in canonical_models.
-- * Mercedes-Benz SLS AMG (SLS AMG / Roadster / Black Series: 206 sold, $48.31M) had no row in canonical_models;
--   AMG GT lacked 'gt black series' / 'gt r' / 'gt s' / 'gt c' (21+ sold, $8.24M+); CLK lacked 'clk63 amg' /
--   'clk63 amg black series' (59 sold, $6.77M); S-Class lacked '560sec' / '500sec' / '380sec' (196 sold, $5.98M);
--   E-Class lacked 'e63 s 4matic wagon' / 'e63 s' (68 sold, $5.87M).
-- * Aston Martin DB5 (27 sold, $23.19M) and DB4 (4+ sold, $9.37M+) had no rows in canonical_models.
-- * Audi RS 4 (174 sold, $6.05M) and RS 6 (71 sold, $6.45M) only had spaced aliases ('rs 4', 'rs 6') and missed
--   'rs4', 'rs6', 'rs6 avant'.
-- * Volkswagen Type 2 missed 'type ii' (111 sold, $5.15M).
-- * Lancia Aurelia (18 sold, $21.41M), Tucker 48 (8 sold, $12.42M), Pagani Huayra (5 sold, $12.35M), and Jaguar
--   C-Type (5 sold, $11.23M) & D-Type (3 sold, $7.37M) had no rows in canonical_models.
-- * Porsche 935 (5 sold, $7.36M) had year_end = 1984, excluding the 2019 Porsche 935 tribute cars.
-- * Shelby GT350 had year_end = 1970 and lacked 'gt350r' (7 sold, $8.70M).
-- Reference rows, not testimony.
-- Contract: supabase/sql/test_family_keys_supercars_euro_icons.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. Widen year bounds on Ferrari Testarossa (1976-1996, covering 512 BB through F512 M), Porsche 935 (1976+), and Shelby GT350 (1965+).
UPDATE public.canonical_models m
   SET year_start = 1976,
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: year_start 1976' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: year_start 1976 covering 1976-1984 512 BB/BBi through 1996 F512 M.')
       END
 WHERE lower(m.make) = 'ferrari'
   AND lower(m.canonical_model) = 'testarossa'
   AND (m.year_start IS NULL OR m.year_start > 1976);

UPDATE public.canonical_models m
   SET year_end = NULL,
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: year_end open' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: year_end open so 2019+ Porsche 935 tribute cars key to 935.')
       END
 WHERE lower(m.make) = 'porsche'
   AND lower(m.canonical_model) = '935'
   AND m.year_end IS NOT NULL;

UPDATE public.canonical_models m
   SET year_end = NULL,
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: year_end open' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: year_end open so 2015+ Shelby GT350/GT350R rows under make=Shelby key to GT350.')
       END
 WHERE lower(m.make) = 'shelby'
   AND lower(m.canonical_model) = 'gt350'
   AND m.year_end IS NOT NULL;

-- 2. Ensure Lancia, Pagani, and Tucker exist in canonical_makes so mv_model_family_names joins them cleanly.
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases, is_active)
SELECT x.id, x.make, x.make, x.aliases, true
FROM (VALUES
  ('00000000-0000-4000-a000-000000001906'::uuid, 'Lancia', ARRAY['lancia']),
  ('00000000-0000-4000-a000-000000001992'::uuid, 'Pagani', ARRAY['pagani']),
  ('00000000-0000-4000-a000-000000001948'::uuid, 'Tucker', ARRAY['tucker'])
) AS x(id, make, aliases)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_makes k WHERE lower(k.canonical_name) = lower(x.make)
);

-- 3. Insert missing canonical model families.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes)
SELECT x.id, x.make, x.model, x.y0, x.y1, x.aliases, x.note
FROM (VALUES
  ('00000000-0000-4000-e000-000000001992'::uuid, 'McLaren', 'F1', 1992, 1998,
   ARRAY['f1', 'f1 gtr', 'f1 gtr longtail', 'f1 lm', 'f1 gt'],
   'Added 2026-10-16: McLaren F1 / F1 GTR / F1 LM family.'),
  ('00000000-0000-4000-e000-000000002020'::uuid, 'McLaren', 'Speedtail', 2020, 2022,
   ARRAY['speedtail'],
   'Added 2026-10-16: McLaren Speedtail hyper-GT family.'),
  ('00000000-0000-4000-e000-000000001966'::uuid, 'Lamborghini', 'Miura', 1966, 1973,
   ARRAY['miura', 'miura p400', 'miura p400 s', 'miura p400 sv', 'miura p400s', 'miura p400sv', 'miura sv'],
   'Added 2026-10-16: Lamborghini Miura P400 / S / SV family.'),
  ('00000000-0000-4000-e000-000000001974'::uuid, 'Lamborghini', 'Countach', 1974, 2024,
   ARRAY['countach', 'countach lp400', 'countach lp400 s', 'countach lp400s', 'countach lp500 s', 'countach lp500s', 'countach lp5000 s', 'countach lp5000 qv', 'countach 5000 qv', 'countach 25th anniversary', 'countach lpi 800-4'],
   'Added 2026-10-16: Lamborghini Countach family (1974-1990 + LPI 800-4).'),
  ('00000000-0000-4000-e000-000000001964'::uuid, 'Lamborghini', '350 GT', 1964, 1968,
   ARRAY['350 gt', '350gt', '400 gt', '400gt', '400 gt 2+2'],
   'Added 2026-10-16: Lamborghini 350 GT / 400 GT family.'),
  ('00000000-0000-4000-e000-000000002010'::uuid, 'Mercedes-Benz', 'SLS AMG', 2010, 2015,
   ARRAY['sls amg', 'sls amg roadster', 'sls amg black series', 'sls amg gt', 'sls amg gt final edition', 'sls'],
   'Added 2026-10-16: Mercedes-Benz SLS AMG gullwing & roadster family.'),
  ('00000000-0000-4000-e000-000000001963'::uuid, 'Aston Martin', 'DB5', 1963, 1965,
   ARRAY['db5', 'db5 convertible', 'db5 vantage', 'db5 shooting brake'],
   'Added 2026-10-16: Aston Martin DB5 family.'),
  ('00000000-0000-4000-e000-000000001958'::uuid, 'Aston Martin', 'DB4', 1958, 1963,
   ARRAY['db4', 'db4 gt', 'db4 gt zagato', 'db4 convertible', 'db4 vantage'],
   'Added 2026-10-16: Aston Martin DB4 family.'),
  ('00000000-0000-4000-e000-000000001965'::uuid, 'Aston Martin', 'DB6', 1965, 1971,
   ARRAY['db6', 'db6 vantage', 'db6 volante', 'db6 mk ii'],
   'Added 2026-10-16: Aston Martin DB6 family.'),
  ('00000000-0000-4000-e000-000000001950'::uuid, 'Lancia', 'Aurelia', 1950, 1958,
   ARRAY['aurelia', 'aurelia b20', 'aurelia b24', 'aurelia b24s', 'aurelia b24s spider america', 'aurelia b24 spider america', 'aurelia b24 convertible'],
   'Added 2026-10-16: Lancia Aurelia family.'),
  ('00000000-0000-4000-e000-000000001948'::uuid, 'Tucker', '48', 1947, 1948,
   ARRAY['48', 'tucker 48', 'torpedo'],
   'Added 2026-10-16: 1948 Tucker 48 family.'),
  ('00000000-0000-4000-e000-000000002011'::uuid, 'Pagani', 'Huayra', 2011, 2024,
   ARRAY['huayra', 'huayra roadster', 'huayra bc', 'huayra roadster bc'],
   'Added 2026-10-16: Pagani Huayra family.'),
  ('00000000-0000-4000-e000-000000001951'::uuid, 'Jaguar', 'C-Type', 1951, 2024,
   ARRAY['c-type', 'c type', 'xk120-c'],
   'Added 2026-10-16: Jaguar C-Type family.'),
  ('00000000-0000-4000-e000-000000001954'::uuid, 'Jaguar', 'D-Type', 1954, 2024,
   ARRAY['d-type', 'd type', 'd-type sports racer'],
   'Added 2026-10-16: Jaguar D-Type family.')
) AS x(id, make, model, y0, y1, aliases, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_models m
  WHERE lower(m.make) = lower(x.make) AND lower(m.canonical_model) = lower(x.model)
);

-- 4. Append unspaced / variant spellings to existing families.
WITH additions (make_l, model_l, add_aliases, note) AS (VALUES
  ('ferrari', 'la ferrari', ARRAY['laferrari', 'laferrari aperta', 'la ferrari aperta'],
   '2026-10-16: added unspaced LaFerrari and LaFerrari Aperta spellings.'),
  ('ferrari', 'f12 berlinetta', ARRAY['f12berlinetta', 'f12', 'f12tdf', 'f12 tdf'],
   '2026-10-16: added unspaced F12berlinetta and F12tdf spellings.'),
  ('ferrari', 'testarossa', ARRAY['f512 m', 'f512m', '512 m', '512bb', '512 bbi'],
   '2026-10-16: added F512 M and 512BB spellings to Testarossa / Boxer family.'),
  ('mercedes-benz', 'amg gt', ARRAY['gt black series', 'amg gt black series', 'gt r', 'amg gt r', 'gt r pro', 'amg gt r pro', 'gt s', 'amg gt s', 'gt c', 'amg gt c'],
   '2026-10-16: added AMG GT Black Series, GT R, GT S, and GT C spellings.'),
  ('mercedes-benz', 'clk', ARRAY['clk63 amg', 'clk63 amg black series', 'clk63', 'clk 63 amg', 'clk55', 'clk550'],
   '2026-10-16: added CLK63 AMG Black Series and CLK550 spellings.'),
  ('mercedes-benz', 's-class', ARRAY['560sec', '560 sec', '500sec', '500 sec', '420sec', '420 sec', '380sec', '380 sec'],
   '2026-10-16: added C126 560SEC/500SEC/420SEC/380SEC coupe spellings to S-Class.'),
  ('mercedes-benz', 'e-class', ARRAY['e63', 'e63 s', 'e63 s 4matic', 'e63 s 4matic wagon', 'e63 amg wagon', 'e63 amg s', 'e55', '500e', '500 e', 'e500 limited'],
   '2026-10-16: added E63 S 4MATIC Wagon and 500E spellings to E-Class.'),
  ('audi', 'rs 4', ARRAY['rs4', 'rs4 avant', 'rs4 cabriolet'],
   '2026-10-16: added unspaced RS4 spellings.'),
  ('audi', 'rs 6', ARRAY['rs6', 'rs6 avant', 'rs 6 avant'],
   '2026-10-16: added unspaced RS6 and RS6 Avant spellings.'),
  ('volkswagen', 'type 2', ARRAY['type ii', 'type-2', 'type-ii', '23-window', '21-window', '15-window', '13-window', '11-window'],
   '2026-10-16: added Type II and multi-window Bus spellings to Volkswagen Type 2.'),
  ('shelby', 'gt350', ARRAY['gt350r', 'gt 350r', 'shelby gt350r'],
   '2026-10-16: added GT350R spellings to Shelby GT350.')
)
UPDATE public.canonical_models m
   SET aliases = (
         SELECT array_agg(x ORDER BY ord)
         FROM (
           SELECT DISTINCT ON (lower(btrim(x))) x, ord
           FROM unnest(array_cat(coalesce(m.aliases, '{}'::text[]), a.add_aliases)) WITH ORDINALITY AS u(x, ord)
           WHERE x IS NOT NULL AND btrim(x) <> ''
           ORDER BY lower(btrim(x)), ord
         ) dedup
       ),
       notes = CASE
         WHEN m.notes IS NOT NULL AND position(a.note IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, a.note)
       END
  FROM additions a
 WHERE lower(m.make) = a.make_l
   AND lower(m.canonical_model) = a.model_l
   AND EXISTS (
     SELECT 1 FROM unnest(a.add_aliases) new_a
     WHERE NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(m.aliases, '{}'::text[])) old_a
       WHERE lower(btrim(old_a)) = lower(btrim(new_a))
     )
   );

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'mclaren' AND lower(m.canonical_model) = 'f1'
  ) THEN
    RAISE EXCEPTION 'McLaren F1 family was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'lamborghini' AND lower(m.canonical_model) = 'miura'
  ) THEN
    RAISE EXCEPTION 'Lamborghini Miura family was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'mercedes-benz' AND lower(m.canonical_model) = 'sls amg'
  ) THEN
    RAISE EXCEPTION 'Mercedes-Benz SLS AMG family was not created';
  END IF;
END
$verify$;

COMMIT;
