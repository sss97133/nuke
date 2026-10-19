-- canonical_models: 1987 R/V Squarebody series codes on Chevrolet C/K trucks, GMC C15/K15/R/V series codes, and Ford
-- Shelby / Boss / Mach 1 Mustang spellings.
--
-- Measured 2026-10-16 on mv_family_market:
-- * In 1987, GM renamed the 2WD C10/C20/C30 Squarebody trucks to R10/R20/R30 and the 4WD K10/K20/K30 trucks to
--   V10/V20/V30 (while "Silverado" remained a trim package from 1975-1987 before becoming the model name in 1999).
--   Because R10/R20/R30 and V10/V20/V30 were absent from the C10/C20/C30/K10/K20/K30 aliases, 1975-1987 trucks named
--   "R10 Silverado", "V10 Silverado", "V30 HD Silverado", or "C10 Silverado" matched the single word "silverado" to the
--   1999+ Silverado family, failed the year_start (1999) gate in mv_family_market, and fell into Chevrolet's "other"
--   family (74 confirmed sales). Adding the R/V series codes and "<series> silverado" two-word phrases keys them to
--   their C/K series by longest-phrase match.
-- * On GMC, the 1960-1987 C/K trucks used C15/C25/C35, K15/K25/K35, and 1987 R1500/R2500/R3500, V1500/V2500/V3500
--   badges with "Sierra" / "Sierra Classic" trim packages. Adding those series spellings to GMC's C1500/K1500/C2500/
--   K2500/C3500/K3500 rows keys them to their series instead of the 1999+ Sierra family.
-- * On Ford, 175 confirmed Shelby GT350 / GT500 sales recorded with make = 'Ford' and model = 'Shelby GT350' or
--   'Shelby GT500' (without the word "Mustang") fell into Ford's "other" family. Adding 'shelby gt350', 'shelby gt350h',
--   'shelby gt500', 'shelby gt500kr', 'boss 302', 'boss 429', and 'mach 1' to Ford Mustang's aliases keys them to the
--   Mustang family.
-- Reference rows, not testimony. Family ids do not change.
-- Contract: supabase/sql/test_family_keys_squarebody_shelby.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

WITH additions (make_l, model_l, add_aliases, note) AS (VALUES
  ('chevrolet', 'c10', ARRAY['r10', 'r-10', 'c10 silverado', 'c-10 silverado', 'r10 silverado', 'r-10 silverado'],
   '2026-10-16: added 1987 R10 and C10/R10 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('chevrolet', 'c20', ARRAY['r20', 'r-20', 'c20 silverado', 'c-20 silverado', 'r20 silverado', 'r-20 silverado'],
   '2026-10-16: added 1987 R20 and C20/R20 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('chevrolet', 'c30', ARRAY['r30', 'r-30', 'c30 silverado', 'c-30 silverado', 'r30 silverado', 'r-30 silverado'],
   '2026-10-16: added 1987 R30 and C30/R30 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('chevrolet', 'k10', ARRAY['v10', 'v-10', 'k10 silverado', 'k-10 silverado', 'v10 silverado', 'v-10 silverado'],
   '2026-10-16: added 1987 V10 and K10/V10 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('chevrolet', 'k20', ARRAY['v20', 'v-20', 'k20 silverado', 'k-20 silverado', 'v20 silverado', 'v-20 silverado'],
   '2026-10-16: added 1987 V20 and K20/V20 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('chevrolet', 'k30', ARRAY['v30', 'v-30', 'k30 silverado', 'k-30 silverado', 'v30 silverado', 'v-30 silverado', 'v30 hd silverado'],
   '2026-10-16: added 1987 V30 and K30/V30 Silverado trim spellings so 1975-1987 Squarebody trucks do not key to 1999+ Silverado.'),
  ('gmc', 'c1500', ARRAY['c15', 'c-15', 'r1500', 'r-1500', 'c15 sierra', 'c1500 sierra', 'r1500 sierra', '1500 sierra', '1500 sierra classic'],
   '2026-10-16: added C15/R1500 and Sierra trim spellings for 1960-1987 GMC half-ton 2WD trucks.'),
  ('gmc', 'k1500', ARRAY['k15', 'k-15', 'v1500', 'v-1500', 'k15 sierra', 'k1500 sierra', 'v1500 sierra', 'k1500 sierra classic'],
   '2026-10-16: added K15/V1500 and Sierra trim spellings for 1960-1987 GMC half-ton 4WD trucks.'),
  ('gmc', 'c2500', ARRAY['c25', 'c-25', 'r2500', 'r-2500', 'c25 sierra', 'c2500 sierra', 'r2500 sierra', '2500 sierra', '2500 sierra classic'],
   '2026-10-16: added C25/R2500 and Sierra trim spellings for 1960-1987 GMC three-quarter-ton 2WD trucks.'),
  ('gmc', 'k2500', ARRAY['k25', 'k-25', 'v2500', 'v-2500', 'k25 sierra', 'k2500 sierra', 'v2500 sierra', 'k2500 sierra classic'],
   '2026-10-16: added K25/V2500 and Sierra trim spellings for 1960-1987 GMC three-quarter-ton 4WD trucks.'),
  ('gmc', 'c3500', ARRAY['c35', 'c-35', 'r3500', 'r-3500', 'c35 sierra', 'c3500 sierra', 'r3500 sierra', '3500 sierra', '3500 sierra classic'],
   '2026-10-16: added C35/R3500 and Sierra trim spellings for 1960-1987 GMC one-ton 2WD trucks.'),
  ('gmc', 'k3500', ARRAY['k35', 'k-35', 'v3500', 'v-3500', 'k35 sierra', 'k3500 sierra', 'v3500 sierra', 'v3500 sierra classic'],
   '2026-10-16: added K35/V3500 and Sierra trim spellings for 1960-1987 GMC one-ton 4WD trucks.'),
  ('ford', 'mustang', ARRAY['shelby gt350', 'shelby gt350h', 'shelby gt350r', 'shelby gt500', 'shelby gt500kr', 'boss 302', 'boss 429', 'mach 1'],
   '2026-10-16: added Shelby GT350/GT500, Boss 302/429, and Mach 1 spellings to Ford Mustang.')
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
  IF EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'chevrolet' AND lower(m.canonical_model) = 'c10'
      AND NOT EXISTS (SELECT 1 FROM unnest(m.aliases) a WHERE lower(btrim(a)) = 'r10')
  ) THEN
    RAISE EXCEPTION 'Chevrolet C10 is missing its 1987 R10 Squarebody spelling';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.canonical_models m
    WHERE lower(m.make) = 'ford' AND lower(m.canonical_model) = 'mustang'
      AND NOT EXISTS (SELECT 1 FROM unnest(m.aliases) a WHERE lower(btrim(a)) = 'shelby gt350')
  ) THEN
    RAISE EXCEPTION 'Ford Mustang is missing its Shelby GT350 spelling';
  END IF;
END
$verify$;

COMMIT;
