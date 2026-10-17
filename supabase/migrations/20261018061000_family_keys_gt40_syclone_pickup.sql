-- canonical_models: Ford GT40 (1964-2024), GMC Syclone (1991-1992), Chevrolet Pickup (1918-2005), Chevrolet Silverado
-- 1500/2500/3500 disambiguation from 1988-1998 C1500, GMC Sierra (1967-2024) & C1500 ('1500'), and Ford pre-war
-- Deluxe / Roadster Hi-Boy / 3-Window Coupe / Shelby Super Snake / Fairlane Thunderbolt keys.
--
-- Measured 2026-10-16 on mv_family_market:
-- * Ford GT40 ($45.19M across 11 confirmed sales: GT40, GT40 Prototype, GT40 Mk I, GT40 MkI, GT40 Mk 1, GT40 Mk IV)
--   fell into Ford's "other" family because 'gt40' and 'gt 40' were aliases on Ford GT (year_start = 2004), so every
--   1964-1969 GT40 failed the year >= 2003 gate in mv_family_market. Removing 'gt40'/'gt 40' from Ford GT (2004+) and
--   adding a dedicated Ford GT40 (1964-2024) row surfaces the $45.2M GT40 family.
-- * GMC Syclone (82 sold, $3.56M) had no canonical_models row while GMC Typhoon did.
-- * Chevrolet Pickup (396 sold, $15.51M) and Custom Pickup (95 sold, $4.87M) fell into Chevrolet's "other" family
--   because Ford and GMC had Pickup rows in canonical_models while Chevrolet had none.
-- * Chevrolet Silverado 1500 (68 sold, $1.67M) fell into Chevrolet's "other" family because 'silverado 1500' was listed
--   as an alias on Chevrolet C1500 (1988-1998) and absent from Chevrolet Silverado (1999+), so 1999-2024 Silverado 1500
--   sales matched C1500 by 14-char exact match and failed the 1998 year_end gate.
-- * GMC Sierra (87 sold, $2.16M, years 1967-1998) and GMC 1500 (59 sold, $1.72M) fell into GMC's "other" family because
--   GMC Sierra had year_start = 1999 and GMC C1500 lacked '1500' in its aliases.
-- * Ford Hi-Boy (74 sold, $3.72M, 1928-1934 roadsters), 3-Window Custom Coupe (52 sold, $3.06M, 1932-1937), Deluxe
--   (41 sold, $1.80M, 1930-1956), Cabriolet (40 sold, $2.08M, 1932-1941), Shelby Super Snake (27 sold, $3.47M), and
--   Fairlane Thunderbolt (6 sold, $1.46M) fell into Ford's "other" family.
-- Reference rows, not testimony.
-- Contract: supabase/sql/test_family_keys_gt40_syclone_pickup.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. Remove 'gt40' and 'gt 40' from Ford GT (2004+) so 1964-1969 GT40 sales key to the dedicated GT40 family.
UPDATE public.canonical_models m
   SET aliases = ARRAY(
         SELECT a FROM unnest(coalesce(m.aliases, '{}'::text[])) WITH ORDINALITY AS u(a, ord)
         WHERE lower(btrim(a)) NOT IN ('gt40', 'gt 40')
         ORDER BY ord
       ),
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: moved gt40' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: moved gt40/gt 40 aliases to dedicated Ford GT40 (1964-2024) family.')
       END
 WHERE lower(m.make) = 'ford'
   AND lower(m.canonical_model) = 'gt'
   AND EXISTS (
     SELECT 1 FROM unnest(coalesce(m.aliases, '{}'::text[])) a
     WHERE lower(btrim(a)) IN ('gt40', 'gt 40')
   );

-- 2. Remove 'silverado 1500' from Chevrolet C1500 (1988-1998) so 1999+ Silverado 1500 trucks key to Silverado.
UPDATE public.canonical_models m
   SET aliases = ARRAY(
         SELECT a FROM unnest(coalesce(m.aliases, '{}'::text[])) WITH ORDINALITY AS u(a, ord)
         WHERE lower(btrim(a)) <> 'silverado 1500'
         ORDER BY ord
       ),
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: moved silverado 1500' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: moved silverado 1500 alias to Chevrolet Silverado family.')
       END
 WHERE lower(m.make) = 'chevrolet'
   AND lower(m.canonical_model) = 'c1500'
   AND EXISTS (
     SELECT 1 FROM unnest(coalesce(m.aliases, '{}'::text[])) a
     WHERE lower(btrim(a)) = 'silverado 1500'
   );

-- 3. Widen year bounds on GMC Sierra (1967-2024, covering 1967-1998 trucks recorded as "Sierra") and Ford Deluxe (1930-1956).
UPDATE public.canonical_models m
   SET year_start = 1967,
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: year_start 1967' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: year_start 1967 so 1967-1998 GMC Sierra sales without a C/K prefix key to Sierra.')
       END
 WHERE lower(m.make) = 'gmc'
   AND lower(m.canonical_model) = 'sierra'
   AND (m.year_start IS NULL OR m.year_start > 1967);

UPDATE public.canonical_models m
   SET year_start = 1930,
       year_end = 1956,
       notes = CASE
         WHEN m.notes IS NOT NULL AND position('2026-10-16: 1930-1956' IN m.notes) > 0 THEN m.notes
         ELSE concat_ws(' ', m.notes, '2026-10-16: 1930-1956 bounds covering 1932-1937 Deuce/early Deluxe and post-war Deluxe.')
       END
 WHERE lower(m.make) = 'ford'
   AND lower(m.canonical_model) = 'deluxe'
   AND (m.year_start IS DISTINCT FROM 1930 OR m.year_end IS DISTINCT FROM 1956);

-- 4. Insert missing canonical families: Ford GT40, GMC Syclone, and Chevrolet Pickup.
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes)
SELECT x.id, x.make, x.model, x.y0, x.y1, x.aliases, x.note
FROM (VALUES
  ('00000000-0000-4000-d000-000000001966'::uuid, 'Ford', 'GT40', 1964, 2024,
   ARRAY['gt40', 'gt 40', 'gt-40', 'gt40 mk i', 'gt40 mki', 'gt40 mk 1', 'gt40 mk ii', 'gt40 mkii', 'gt40 mk 2', 'gt40 mk iii', 'gt40 mk iv', 'gt40 prototype'],
   'Added 2026-10-16: dedicated Ford GT40 family (1964-1969 originals + continuation/tribute GT40s).'),
  ('00000000-0000-4000-c000-000000001991'::uuid, 'GMC', 'Syclone', 1991, 1992,
   ARRAY['syclone', 'syclone pickup'],
   'Added 2026-10-16: 1991-1992 GMC Syclone turbo AWD pickup.'),
  ('00000000-0000-4000-b000-000000001928'::uuid, 'Chevrolet', 'Pickup', 1918, 2005,
   ARRAY['pickup', 'custom pickup'],
   'Added 2026-10-16: Chevrolet Pickup / Custom Pickup family matching Ford Pickup and GMC Pickup.')
) AS x(id, make, model, y0, y1, aliases, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.canonical_models m
  WHERE lower(m.make) = lower(x.make) AND lower(m.canonical_model) = lower(x.model)
);

-- 5. Append spellings to existing families.
WITH additions (make_l, model_l, add_aliases, note) AS (VALUES
  ('chevrolet', 'silverado', ARRAY['silverado 1500', 'silverado 2500', 'silverado 2500hd', 'silverado 3500', 'silverado 3500hd'],
   '2026-10-16: added Silverado 1500/2500/3500 series spellings.'),
  ('gmc', 'c1500', ARRAY['1500'],
   '2026-10-16: added 1500 spelling to GMC C1500 matching Chevrolet C1500.'),
  ('ford', 'mustang', ARRAY['shelby super snake', 'mustang shelby super snake', 'super snake', 'shelby'],
   '2026-10-16: added Shelby Super Snake and Shelby spellings to Ford Mustang.'),
  ('ford', 'roadster', ARRAY['hi-boy', 'highboy', 'hi boy', 'hi-boy roadster', 'roadster hi-boy'],
   '2026-10-16: added Hi-Boy / Highboy hot-rod roadster spellings to 1903-1936 Ford Roadster.'),
  ('ford', 'coupe', ARRAY['3 window custom coupe', '3-window custom coupe', '3 window coupe', '3-window coupe', '5 window coupe', '5-window coupe', '5 window custom coupe', '5-window custom coupe', 'cabriolet'],
   '2026-10-16: added 3-Window / 5-Window Coupe and Cabriolet spellings to 1917-1940 Ford Coupe.'),
  ('ford', 'fairlane', ARRAY['thunderbolt', 'fairlane thunderbolt', 'fairlane 500 thunderbolt'],
   '2026-10-16: added 1964 Fairlane Thunderbolt spellings to Ford Fairlane.')
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
    WHERE lower(m.make) = 'ford' AND lower(m.canonical_model) = 'gt40'
  ) THEN
    RAISE EXCEPTION 'Ford GT40 family was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'gmc' AND lower(m.canonical_model) = 'syclone'
  ) THEN
    RAISE EXCEPTION 'GMC Syclone family was not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'ford' AND lower(m.canonical_model) = 'gt'
      AND EXISTS (SELECT 1 FROM unnest(m.aliases) a WHERE lower(btrim(a)) = 'gt40')
  ) THEN
    RAISE EXCEPTION 'Ford GT (2004+) still holds the gt40 alias';
  END IF;
END
$verify$;

COMMIT;
