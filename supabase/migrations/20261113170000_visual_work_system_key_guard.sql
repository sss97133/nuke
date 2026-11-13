-- Writer gate, first piece: a visual_work_v1 record may not mint a system key.
-- Read on the proof vehicle 2026-11-11 16:53 UTC: 31 current records, 274 cost lines, 18 distinct
-- system_key values, none a registry key; 12 of them (104 lines, 18 records) matched nothing the
-- registry holds. Nothing refused them: the cost fold checks only a key's shape.
-- From this migration on, every line's system_key is either a subject_taxonomy.category in use,
-- or a draft the record itself declares in key_proposals with the nearest existing category
-- (or 'none') and a reason. The draft is the visible wait; filing it in schema_proposals and
-- approving it stay separate, human-reviewed steps. Stored rows are not touched or re-checked.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.visual_work_unplaced_system_keys(jsonb)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='subject_taxonomy' AND column_name='category')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='subject_taxonomy' AND column_name='is_active') THEN
  RAISE EXCEPTION 'visual work key guard owner drifted; inspect current definitions';
 END IF;
END $guard$;

-- The system keys of a record's cost lines that have no place: not a category the registry
-- uses, and not declared as a draft. One function for the trigger and for any reader that
-- counts the wait.
CREATE FUNCTION public.visual_work_unplaced_system_keys(p_doc jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT coalesce(array_agg(DISTINCT x.k ORDER BY x.k),'{}'::text[])
 FROM (SELECT l.line->>'system_key' AS k
   FROM (VALUES (p_doc->'materials'),(p_doc->'operations')) a(arr)
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(a.arr)='array' THEN a.arr ELSE '[]'::jsonb END) l(line)) x
 WHERE x.k IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.subject_taxonomy t WHERE t.category=x.k AND t.is_active IS NOT FALSE)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(p_doc->'key_proposals')='array' THEN p_doc->'key_proposals' ELSE '[]'::jsonb END) p
    WHERE p->>'kind'='system' AND p->>'key'=x.k AND nullif(btrim(p->>'reason'),'') IS NOT NULL
     AND (p->>'nearest_existing'='none' OR EXISTS(SELECT 1 FROM public.subject_taxonomy t
       WHERE t.category=p->>'nearest_existing' AND t.is_active IS NOT FALSE)));
$fn$;
REVOKE ALL ON FUNCTION public.visual_work_unplaced_system_keys(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_work_unplaced_system_keys(jsonb) TO service_role;
COMMENT ON FUNCTION public.visual_work_unplaced_system_keys(jsonb) IS
'System keys in a visual_work_v1 record''s materials and operations that are neither a subject_taxonomy.category in use nor declared in the record''s key_proposals (kind system, key, nearest_existing as a category in use or none, reason). Empty means the record mints no system key.';

CREATE FUNCTION public.guard_visual_work_keys()
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
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_visual_work_keys() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER guard_visual_work_keys_insert
BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.extraction_method='visual_work_v1' OR NEW.structured_data->>'contract'='visual_work_v1')
EXECUTE FUNCTION public.guard_visual_work_keys();
COMMIT;
