-- canonical_models: no Chevrolet series from a weight, dually or drive word alone.
--
-- Follow-up to 20261017001000_family_keys_body_words.sql. Spellings made only of weight, dually or drive words still
-- keyed Chevrolet trucks to a series, read from mv_model_family_names on 2026-10-15: "4x4" keyed names such as
-- "k3500 4x4", "cheyenne 4x4" and "4x4 suburban" to the 1960-87 K10; "dually" and "1 ton" keyed names such as
-- "k3500 dually diesel" (a 1988-2000 one-ton) to the 1960-87 C30. A 1988-on truck then left the family folds as out of
-- range. None of these words names a series, so "4x4" and "4wd" (K10), "three quarter ton" (C20), "1 ton" and "dually"
-- (C30), "dually" (C3500), "3/4 ton 4x4" (K20) and "1 ton 4x4" (K30) leave the spellings, and such names read as unkeyed
-- (the brand's other models) until a family that names their series exists. Spellings with a series in them ("k10
-- 4x4", "1500 4x4", "c10 pickup") stay. The "3 ton" family is named for its weight and is left as it is.
-- Reference rows, not testimony. mv_model_family_names reads them at its next refresh (daily 04:05 UTC) and the family
-- folds after it; family ids do not change.
-- Contract: supabase/sql/test_family_keys_weight_drive_words.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

UPDATE public.canonical_models
   SET aliases = ARRAY(SELECT a FROM unnest(aliases) a
                       WHERE lower(btrim(a)) NOT IN ('4x4', '4wd', 'three quarter ton', '1 ton', 'dually', '3/4 ton 4x4', '1 ton 4x4')),
       notes = concat_ws(' ', notes, '2026-10-15: weight, dually and drive words (4x4, 4wd, three quarter ton, 1 ton, dually, '
                                  || '3/4 ton 4x4, 1 ton 4x4) removed from the spellings; they do not name the series.')
 WHERE lower(make) = 'chevrolet' AND lower(canonical_model) IN ('c20', 'c30', 'c3500', 'k10', 'k20', 'k30')
   AND EXISTS (SELECT 1 FROM unnest(aliases) a
               WHERE lower(btrim(a)) IN ('4x4', '4wd', 'three quarter ton', '1 ton', 'dually', '3/4 ton 4x4', '1 ton 4x4'));

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.canonical_models m, unnest(m.aliases) a
             WHERE lower(m.make) = 'chevrolet' AND lower(m.canonical_model) IN ('c20', 'c30', 'c3500', 'k10', 'k20', 'k30')
               AND lower(btrim(a)) IN ('4x4', '4wd', 'three quarter ton', '1 ton', 'dually', '3/4 ton 4x4', '1 ton 4x4')) THEN
    RAISE EXCEPTION 'a Chevrolet truck family still carries a weight, dually or drive word as a spelling';
  END IF;
END
$verify$;

COMMIT;
