-- canonical_models: Task Force years for the Chevrolet 3100 and 3600, and no Chevrolet series from a body word alone.
--
-- skylar-08's audit of the family keys (2026-10-15):
-- * The 3100 and 3600 families end in 1955. Task Force trucks (1955.5-1959) kept the 3100/3600 series numbers, so they
--   fell outside every family range (the folds allow one year either side) and left the family folds. Both now run to
--   1959.
-- * The C10, C20 and C30 families (1960-1987) carried body and weight words among their spellings: "pickup", "truck",
--   "1/2 ton", "half ton" (C10), "3/4 ton" (C20), "one ton" (C30). A name made only of such words ("Pickup", 707
--   vehicles; "Truck", 127; "Custom Pickup", 66, read 2026-10-15) keyed every such Chevrolet to the 1960-87 series,
--   and a 1946-59 truck then left the folds as out of range. A body or weight word is not evidence of a series, so
--   those names now read as unkeyed (the brand's "other models"); a name with a series in it ("C10 pickup", "3100
--   pickup", "C20") keys as before.
-- Families named for a body word (Ford Pickup, Toyota Pickup, Ford Coupe, ...) are the dictionary's own families and
-- are left as they are. Reference rows, not testimony. mv_model_family_names reads them at its next refresh (daily
-- 04:05 UTC) and the family folds after it; family ids do not change.
-- Contract: supabase/sql/test_family_keys_body_words.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

UPDATE public.canonical_models
   SET year_end = 1959,
       notes = concat_ws(' ', notes, '2026-10-15: year_end 1955 -> 1959; Task Force trucks (1955.5-1959) kept the series number.')
 WHERE lower(make) = 'chevrolet' AND canonical_model IN ('3100', '3600') AND year_end = 1955;

UPDATE public.canonical_models
   SET aliases = ARRAY(SELECT a FROM unnest(aliases) a
                       WHERE lower(btrim(a)) NOT IN ('pickup', 'truck', '1/2 ton', 'half ton', '3/4 ton', 'one ton')),
       notes = concat_ws(' ', notes, '2026-10-15: body and weight words (pickup, truck, 1/2 ton, half ton, 3/4 ton, one ton) '
                                  || 'removed from the spellings; they do not name the series.')
 WHERE lower(make) = 'chevrolet' AND lower(canonical_model) IN ('c10', 'c20', 'c30')
   AND EXISTS (SELECT 1 FROM unnest(aliases) a
               WHERE lower(btrim(a)) IN ('pickup', 'truck', '1/2 ton', 'half ton', '3/4 ton', 'one ton'));

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.canonical_models m, unnest(m.aliases) a
             WHERE lower(m.make) = 'chevrolet' AND lower(m.canonical_model) IN ('c10', 'c20', 'c30')
               AND lower(btrim(a)) IN ('pickup', 'truck', '1/2 ton', 'half ton', '3/4 ton', 'one ton')) THEN
    RAISE EXCEPTION 'a Chevrolet C-series family still carries a body or weight word as a spelling';
  END IF;
  IF EXISTS (SELECT 1 FROM public.canonical_models
             WHERE lower(make) = 'chevrolet' AND canonical_model IN ('3100', '3600') AND year_end < 1959) THEN
    RAISE EXCEPTION 'a Chevrolet 3100/3600 family still ends before 1959';
  END IF;
END
$verify$;

COMMIT;
