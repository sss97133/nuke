-- facet_doubt_examined_v1: a fact item that was photographed and re-read without a legible result says so.
--
-- WHY. The doubt loop (scripts/doubts) raises a fact_doubt for a missing or weak item of vehicle_facet_items, a blind
-- reader looks again at the cited frames and answers through answer_evidence_judgment. An answer of cannot_tell or
-- not_visible never reached the reader: the item stayed "missing" with the stock `needed` text ("photo of the
-- cylinder-head casting numbers, or a receipt") although the photos exist and were read. The page asked for evidence
-- that is already on file. The loop was open at its last step.
--
-- WHAT CHANGES.
-- 1. vehicle_fact_doubt_examined(vehicle): STABLE SECURITY DEFINER. One row per item key of the vehicle's current
--    answered fact_doubt requests whose outcome is cannot_tell or not_visible: the key (from params.origin_ref
--    'facet_items:<key>:<status>'), the outcome, how many blind reads there were (the answer plus answer_history),
--    the last answer time, the reader model and the cited image ids. It returns no quote and no transcription: words
--    read from a photo stay in the store. Visibility is the reconstruction's rule (a public vehicle, or the owner, a
--    granted user or the service role).
-- 2. vehicle_facet_items' `examined` CTE gains a branch reading that helper. A missing item with such an answer
--    carries `examined` (label, method fact_doubt, outcome, reads, witness image ids) and its `needed` becomes
--    "a legible read of the marks already photographed" (cannot_tell) or "a photo that shows this" (not_visible).
--    Status is unchanged: the item stays missing, and nothing is established by an unreadable photo. The two
--    as-built transmission keys keep their own examined branch.
--
-- REVERT. Redefine vehicle_facet_items without the branch between the markers facet_doubt_examined_v1 and
-- facet_doubt_examined_v1_end, then DROP FUNCTION public.vehicle_fact_doubt_examined(uuid). Nothing is written.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.vehicle_fact_doubt_examined(p_vehicle_id uuid)
RETURNS TABLE(key text, outcome text, reads integer, answered_at timestamptz, model text, image_ids jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  a AS (
    SELECT split_part(r.params->>'origin_ref', ':', 2) AS key, r.answer->>'outcome' AS outcome,
           1 + CASE WHEN jsonb_typeof(r.answer_history) = 'array' THEN jsonb_array_length(r.answer_history) ELSE 0 END AS reads,
           r.answered_at, r.answer_model AS model,
           CASE WHEN jsonb_typeof(r.answer->'image_ids') = 'array' THEN r.answer->'image_ids' ELSE '[]'::jsonb END AS image_ids,
           row_number() OVER (PARTITION BY split_part(r.params->>'origin_ref', ':', 2)
                              ORDER BY r.answered_at DESC NULLS LAST, r.id) AS rn
    FROM v
    JOIN public.evidence_judgment_requests r ON r.vehicle_id = v.id
    WHERE r.question_kind = 'fact_doubt' AND r.status = 'answered'
      AND split_part(r.params->>'origin_ref', ':', 1) = 'facet_items'
      AND nullif(split_part(r.params->>'origin_ref', ':', 2), '') IS NOT NULL)
  SELECT a.key, a.outcome, a.reads, a.answered_at, a.model, a.image_ids
  FROM a WHERE a.rn = 1 AND a.outcome IN ('cannot_tell', 'not_visible')
$$;
COMMENT ON FUNCTION public.vehicle_fact_doubt_examined(uuid) IS
  'Item keys of one vehicle whose latest answered fact_doubt is cannot_tell or not_visible: key, outcome, number of blind reads, answer time, reader model, cited image ids. No quote or transcription. Read by vehicle_facet_items (facet_doubt_examined_v1).';
REVOKE ALL ON FUNCTION public.vehicle_fact_doubt_examined(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_fact_doubt_examined(uuid) TO anon, authenticated, service_role;

DO $patch$
DECLARE
  d text;
  anchor text := E'  GROUP BY k.key\n),\n-- facet_availability_v1:';
  branch text := $branch$
  UNION ALL
  -- facet_doubt_examined_v1: a blind re-read of the photos on file that could not read the item
  -- (vehicle_fact_doubt_examined). The item stays missing; it stops asking for a photo that exists.
  SELECT e.key,
         jsonb_build_array(jsonb_build_object('label', 'blind re-read of photos on file', 'kind', 'image',
           'method', 'fact_doubt', 'observed_at', e.answered_at, 'reader', e.model, 'reads', e.reads,
           'witness', jsonb_build_object('kind', 'image', 'id', e.image_ids->>0, 'ids', e.image_ids),
           'result', CASE e.outcome WHEN 'cannot_tell' THEN 'photographed; marks not legible'
                                    ELSE 'not visible in the photos on file' END)),
         CASE e.outcome WHEN 'cannot_tell' THEN 'a legible read of the marks already photographed'
                        ELSE 'a photo that shows this' END
  FROM v
  CROSS JOIN LATERAL public.vehicle_fact_doubt_examined(v.id) e
  WHERE e.key NOT IN ('transmission.as_built.type', 'transmission.as_built.model')
  -- facet_doubt_examined_v1_end
$branch$;
  n integer;
BEGIN
  d := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  IF position('facet_doubt_examined_v1' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'facet doubt examined anchor drifted: % matches', n; END IF;
  d := replace(d, anchor, E'  GROUP BY k.key\n' || branch || E'),\n-- facet_availability_v1:');
  EXECUTE d;
END $patch$;
