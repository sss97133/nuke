-- Writer gate, second piece: every cost line of a visual_work_v1 record names the part of the
-- vehicle it is about, in the registry's words.
-- Read on the proof vehicle 2026-11-11 17:47 UTC: 274 cost lines, none with a part key. 192 of
-- the 221 material lines carry the receipt's part number inside physical_material_key, and 189
-- of those already cite the receipt line that prints that number. physical_material_key is the
-- cost fold's line identity and stays as it is; what was missing is a key another row can meet.
-- The vehicle's 446 keyed photo claims carry structured_data.part_key (364 named, 81 distinct),
-- so a cost line with the same part_key is the first join between a purchase and a photo.
-- From this migration on, each materials/operations line carries part_key: a
-- subject_taxonomy.subject_key in use, one of the closed answers not_a_part / cannot_tell, or a
-- draft the record declares in key_proposals (kind part, key, nearest existing subject key or
-- none, reason). Stored rows are not touched or re-checked.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.visual_work_unplaced_part_keys(jsonb)') IS NOT NULL
  OR to_regprocedure('public.visual_work_unplaced_system_keys(jsonb)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass
       AND tgname='guard_visual_work_keys_insert' AND NOT tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='subject_taxonomy' AND column_name='subject_key') THEN
  RAISE EXCEPTION 'visual work key guard owner drifted; inspect current definitions';
 END IF;
END $guard$;

-- What is wrong with a record's part keys: each distinct part_key that has no place, then one
-- entry counting the cost lines that carry none. Empty means every line is keyed to a part.
CREATE FUNCTION public.visual_work_unplaced_part_keys(p_doc jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH lines AS (
  -- The value is judged exactly as it will be stored: a padded key is not the registry's key.
  SELECT CASE WHEN jsonb_typeof(l.line->'part_key')='string' AND btrim(l.line->>'part_key')<>'' THEN l.line->>'part_key' END AS k
  FROM (VALUES (p_doc->'materials'),(p_doc->'operations')) a(arr)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.arr)='array' THEN a.arr ELSE '[]'::jsonb END) l(line)),
 unplaced AS (
  SELECT DISTINCT x.k FROM lines x
  WHERE x.k IS NOT NULL AND x.k NOT IN ('not_a_part','cannot_tell')
   AND NOT EXISTS(SELECT 1 FROM public.subject_taxonomy t WHERE t.subject_key=x.k AND t.is_active IS NOT FALSE)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_doc->'key_proposals')='array' THEN p_doc->'key_proposals' ELSE '[]'::jsonb END) p
     WHERE p->>'kind'='part' AND p->>'key'=x.k AND nullif(btrim(p->>'reason'),'') IS NOT NULL
      AND (p->>'nearest_existing'='none' OR EXISTS(SELECT 1 FROM public.subject_taxonomy t
        WHERE t.subject_key=p->>'nearest_existing' AND t.is_active IS NOT FALSE))))
 SELECT coalesce((SELECT array_agg(u.k ORDER BY u.k) FROM unplaced u),'{}'::text[])
  || CASE WHEN (SELECT count(*) FROM lines WHERE k IS NULL)>0
      THEN ARRAY[format('(no part_key on %s cost lines)',(SELECT count(*) FROM lines WHERE k IS NULL))]
      ELSE '{}'::text[] END;
$fn$;
REVOKE ALL ON FUNCTION public.visual_work_unplaced_part_keys(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_work_unplaced_part_keys(jsonb) TO service_role;
COMMENT ON FUNCTION public.visual_work_unplaced_part_keys(jsonb) IS
'Part keys in a visual_work_v1 record''s materials and operations that are not a subject_taxonomy.subject_key in use, not a closed answer (not_a_part, cannot_tell) and not declared in the record''s key_proposals (kind part, key, nearest_existing as a subject key in use or none, reason); plus one entry counting the lines with no part_key. Empty means every cost line is keyed to a part.';

CREATE OR REPLACE FUNCTION public.guard_visual_work_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE missing text[];
BEGIN
 missing:=public.visual_work_unplaced_system_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  -- The writer returns only the message, so the legal moves are in it.
  RAISE EXCEPTION 'unregistered_system_key: %. Use a subject_taxonomy.category already in use, or declare each new key in structured_data.key_proposals as {"kind":"system","key":...,"nearest_existing":<a category in use, or "none">,"reason":...}',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_unplaced_part_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'unregistered_part_key: %. Every materials and operations line needs part_key, the part of the vehicle it is about: a subject_taxonomy.subject_key in use (the keyed photo claims on this vehicle use the same keys in structured_data.part_key), "not_a_part" for a consumable or a charge, "cannot_tell", or a new key declared in structured_data.key_proposals as {"kind":"part","key":...,"nearest_existing":<a subject_key in use, or "none">,"reason":...}. physical_material_key stays the line id.',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_visual_work_keys() FROM PUBLIC,anon,authenticated;
COMMIT;
