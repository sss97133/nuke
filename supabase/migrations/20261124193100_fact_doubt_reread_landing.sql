-- fact_doubt_reread_landing_v1: a readable answer to a fact doubt becomes a keyed reading, through the sanctioned writer.
--
-- WHY. The doubt loop (scripts/doubts) asks a blind reader to look again at the photos of a weak item. An answer of
-- cannot_tell or not_visible reaches vehicle_facet_items (20261122070000); an answer of value went nowhere. Measured
-- 2026-11-24: 23 value answers on 6 vehicles (19 answered, 4 withdrawn), none in any reader.
--
-- WHAT CHANGES.
-- 1. fact_doubt_readings_to_land(limit): service role only. The answered value fact_doubts (form property) not yet
--    landed, one row per request: vehicle, property key and id, the value, ONE witness (the first answer image that is a
--    current photo of this vehicle) and every answer image id, its capture time, the reader model, the confidence. A
--    request is landed when a current keyed observation of that property on that vehicle by method fact_doubt_reread_v1
--    carries its request id, or the same value from the same model (a re-ask that read the same thing adds nothing).
--    scripts/doubts/land-fact-doubt-readings.mjs posts each row to ingest-observation (the writer; its physical-reading
--    gate admits or refuses the key and the marking). One read lands one row, never one per cited photo.
-- 2. fact_doubt_evidence_state no longer hashes the loop's own fact_doubt_reread_v1 rows. The state a doubt was raised
--    on is the evidence other than answers to doubts, so landing an answer does not make the doubt it answered
--    "evidence_changed" and re-ask the same question of the same reader. Any other new keyed reading still does.
-- 3. The question rule lives on the registry row: a fact doubt asks a reader to read a physical marking as printed, so it
--    is raised and landed only for a property whose observation_properties.verification_scope is 'instance'. A
--    class-scope property (engine_configuration, transmission_type) is settled by decode rules, not a re-read: trigger
--    evidence_judgment_fact_doubt_scope refuses a new fact_doubt on one, or a revive of an old one to pending (every doubt form: each asks for a reading), and fact_doubt_readings_to_land skips one.
--    Measured 2026-11-24: of 39 property keys asked, engine_configuration is the only class-scope one (4 requests; its
--    one value answer was a displacement, because its registry description is only examples, which the blind task strips).
-- Agreement and disagreement are the fact reader's: one lineage is a reading, a second lineage or paper establishes
-- (20261124193000), two values are a conflict with both sides. Nothing is overwritten.
--
-- REVERT. Restore fact_doubt_evidence_state from 20261120070000; DROP FUNCTION fact_doubt_readings_to_land(integer); DROP
-- TRIGGER evidence_judgment_fact_doubt_scope ON evidence_judgment_requests; DROP FUNCTION evidence_judgment_fact_doubt_scope().
-- Landed rows are testimony: supersede them, never delete. Contract: supabase/sql/test_fact_doubt_reread_landing.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fact_doubt_evidence_state(p_vehicle_id uuid, p_property_key text,
                                                            p_image_ids uuid[], p_item_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'observations', coalesce((SELECT jsonb_agg(jsonb_build_array(o.id, encode(sha256(convert_to(coalesce(o.structured_data::text, ''), 'UTF8')), 'hex'))
                                               ORDER BY o.id)
                                FROM public.vehicle_observations o
                                JOIN public.observation_properties p ON p.id = o.property_id
                               WHERE o.vehicle_id = p_vehicle_id AND p.property_key = p_property_key
                                 AND o.is_superseded IS NOT TRUE
                                 -- fact_doubt_reread_landing_v1: the loop's own landed answers are not new evidence
                                 AND o.extraction_method IS DISTINCT FROM 'fact_doubt_reread_v1'), '[]'::jsonb),
    'image_ids', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT i::text AS x FROM unnest(coalesce(p_image_ids, '{}')) i) s), '[]'::jsonb),
    'item_ids', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT i::text AS x FROM unnest(coalesce(p_item_ids, '{}')) i) s), '[]'::jsonb))
$$;
COMMENT ON FUNCTION public.fact_doubt_evidence_state(uuid, text, uuid[], uuid[]) IS
  'What a fact_doubt trigger hashes on the database side: the key''s current non-superseded keyed observations (id, value hash) on the vehicle, except the doubt loop''s own landed answers (fact_doubt_reread_v1), and the cited frame and receipt-line ids. A new keyed observation or a superseded one changes it; a landed doubt answer, a new photo that is not keyed, a producer version or a clock does not.';

CREATE OR REPLACE FUNCTION public.fact_doubt_readings_to_land(p_limit integer DEFAULT 50)
RETURNS TABLE(request_id uuid, vehicle_id uuid, property_id uuid, property_key text, value text, image_id uuid,
              image_ids jsonb, taken_at timestamptz, model text, confidence numeric, answered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.id, r.vehicle_id, p.id, p.property_key, btrim(r.answer->>'value'), w.id,
         r.answer->'image_ids', w.taken_at, r.answer_model,
         CASE WHEN jsonb_typeof(r.answer->'confidence') = 'number' THEN (r.answer->>'confidence')::numeric END,
         r.answered_at
  FROM public.evidence_judgment_requests r
  JOIN public.observation_properties p ON p.id = r.property_id AND p.property_key = r.params->>'property_key'
  CROSS JOIN LATERAL (
    SELECT i.id, i.taken_at
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.answer->'image_ids') = 'array' THEN r.answer->'image_ids' ELSE '[]'::jsonb END)
           WITH ORDINALITY a(id, n)
      JOIN public.vehicle_images i ON i.id::text = a.id AND i.vehicle_id = r.vehicle_id
     WHERE a.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
     ORDER BY a.n LIMIT 1) w
  WHERE r.question_kind = 'fact_doubt' AND r.status = 'answered' AND r.subject_table = 'observation_properties'
    AND p.verification_scope = 'instance'
    AND r.params->>'doubt_form' = 'property' AND r.answer->>'outcome' = 'value'
    AND nullif(btrim(r.answer->>'value'), '') IS NOT NULL AND nullif(btrim(r.answer_model), '') IS NOT NULL
    -- landed and linked (record_fact_doubt_landing, 20261124193300), or landed and not yet linked
    AND r.answer_observation_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_observations o
       WHERE o.vehicle_id = r.vehicle_id AND o.property_id = p.id AND o.extraction_method = 'fact_doubt_reread_v1'
         AND o.is_superseded IS NOT TRUE
         AND (o.structured_data->>'fact_doubt_request_id' = r.id::text
              OR (o.agent_model = r.answer_model AND o.structured_data->>p.property_key = btrim(r.answer->>'value'))))
  ORDER BY r.answered_at, r.id
  LIMIT greatest(0, least(coalesce(p_limit, 50), 200))
$$;
COMMENT ON FUNCTION public.fact_doubt_readings_to_land(integer) IS
  'Answered value fact_doubts (form property) not yet landed (answer_observation_id null and no landed reading for the request) as a keyed reading: one row per request with one witness photo of the vehicle, every answer image id, capture time, reader model and confidence. Pumped to ingest-observation by scripts/doubts/land-fact-doubt-readings.mjs (method fact_doubt_reread_v1). Service role only.';
REVOKE ALL ON FUNCTION public.fact_doubt_readings_to_land(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fact_doubt_readings_to_land(integer) TO service_role;

-- 3. a fact doubt only on an instance-scope property (the registry row is the rule)
CREATE OR REPLACE FUNCTION public.evidence_judgment_fact_doubt_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_scope text; v_key text;
BEGIN
  IF NEW.question_kind = 'fact_doubt' AND NEW.subject_table = 'observation_properties'
     AND (TG_OP = 'INSERT' OR (NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending')) THEN
    SELECT p.verification_scope, p.property_key INTO v_scope, v_key FROM public.observation_properties p WHERE p.id = NEW.subject_id;
    IF v_scope IS DISTINCT FROM 'instance' THEN
      RAISE EXCEPTION 'fact_doubt on % refused: its registry row is verification_scope %, and a re-read as printed applies only to instance-scope properties',
        coalesce(v_key, NEW.subject_id::text), coalesce(v_scope, 'null') USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS evidence_judgment_fact_doubt_scope ON public.evidence_judgment_requests;
CREATE TRIGGER evidence_judgment_fact_doubt_scope BEFORE INSERT OR UPDATE OF status ON public.evidence_judgment_requests
  FOR EACH ROW EXECUTE FUNCTION public.evidence_judgment_fact_doubt_scope();
