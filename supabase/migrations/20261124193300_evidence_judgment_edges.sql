-- evidence_judgment_edges_v1: the question store's links become foreign keys.
--
-- WHY. evidence_judgment_requests had one foreign key (vehicle_id -> vehicles). What a question is about lived in a
-- polymorphic subject_id (subject_table names the table), the photos it cited and the photos its answer read lived in
-- jsonb (params.cited_image_ids, params.candidate_image_ids, answer.image_ids), and the reading a fact doubt's value
-- answer produced was found by matching jsonb text. Readers joined all of it by text (board, 2026-11-24, measured from
-- pg_constraint). Measured 2026-11-24: 680 fact_doubt rows (subject observation_properties), 15,076 receipt_part_visible
-- rows (subject receipt_items), 0 subjects missing from their table; 6,555 image references naming 581 photos.
--
-- WHAT. Grain unchanged (one row per question).
--   property_id      uuid, stored generated from subject_id when subject_table = 'observation_properties', FK observation_properties.
--   receipt_item_id  uuid, stored generated from subject_id when subject_table = 'receipt_items', FK receipt_items.
--   answer_observation_id uuid FK vehicle_observations: the keyed reading a value answer became (written only by
--                    record_fact_doubt_landing, below, after the sanctioned writer ingest-observation landed it).
--   evidence_judgment_images (request_id FK evidence_judgment_requests, image_id FK vehicle_images, role cited |
--                    candidate | answer): one row per photo a question cited or offered, or its answer read. Kept by a
--                    trigger on every insert and on every change of params or answer, so a re-ask, a re-answer or a
--                    reopen recomputes the request's rows; an id that is not a vehicle_images row is not linked.
-- Clocks: the request's own (created_at, answered_at); this adds none. Writers: the existing judgment RPCs (unchanged),
-- the trigger, and record_fact_doubt_landing (service_role). No testimony table is written.
--
-- REVERT. DROP FUNCTION record_fact_doubt_landing(uuid,uuid); DROP TRIGGER evidence_judgment_images_sync ON
-- evidence_judgment_requests; DROP FUNCTION evidence_judgment_images_sync(); DROP TABLE evidence_judgment_images;
-- ALTER TABLE evidence_judgment_requests DROP COLUMN answer_observation_id, DROP COLUMN receipt_item_id, DROP COLUMN property_id.
-- Contract: supabase/sql/test_evidence_judgment_edges.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.evidence_judgment_requests
  ADD COLUMN IF NOT EXISTS property_id uuid
    GENERATED ALWAYS AS (CASE WHEN subject_table = 'observation_properties' THEN subject_id END) STORED
    REFERENCES public.observation_properties(id),
  ADD COLUMN IF NOT EXISTS receipt_item_id uuid
    GENERATED ALWAYS AS (CASE WHEN subject_table = 'receipt_items' THEN subject_id END) STORED
    REFERENCES public.receipt_items(id),
  ADD COLUMN IF NOT EXISTS answer_observation_id uuid REFERENCES public.vehicle_observations(id);

CREATE INDEX IF NOT EXISTS evidence_judgment_requests_property_idx
  ON public.evidence_judgment_requests (vehicle_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS evidence_judgment_requests_receipt_item_idx
  ON public.evidence_judgment_requests (receipt_item_id) WHERE receipt_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS evidence_judgment_requests_answer_observation_key
  ON public.evidence_judgment_requests (answer_observation_id) WHERE answer_observation_id IS NOT NULL;

COMMENT ON COLUMN public.evidence_judgment_requests.property_id IS
  'The observation_properties key a fact_doubt question is about (subject_id when subject_table = observation_properties). evidence_judgment_edges_v1.';
COMMENT ON COLUMN public.evidence_judgment_requests.receipt_item_id IS
  'The receipt line a receipt question is about (subject_id when subject_table = receipt_items). evidence_judgment_edges_v1.';
COMMENT ON COLUMN public.evidence_judgment_requests.answer_observation_id IS
  'The keyed reading (vehicle_observations) a value answer became, landed by ingest-observation and linked by record_fact_doubt_landing. evidence_judgment_edges_v1.';

CREATE TABLE IF NOT EXISTS public.evidence_judgment_images (
  request_id uuid NOT NULL REFERENCES public.evidence_judgment_requests(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id),
  role text NOT NULL CHECK (role IN ('cited', 'candidate', 'answer')),
  ord integer NOT NULL,
  PRIMARY KEY (request_id, image_id, role)
);
CREATE INDEX IF NOT EXISTS evidence_judgment_images_image_idx ON public.evidence_judgment_images (image_id);
ALTER TABLE public.evidence_judgment_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidence_judgment_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evidence_judgment_images TO service_role;
COMMENT ON TABLE public.evidence_judgment_images IS
  'Photos a judgment question cited (params.cited_image_ids), offered (params.candidate_image_ids) or its answer read (answer.image_ids), by foreign key. Kept by trigger evidence_judgment_images_sync; never written by hand. evidence_judgment_edges_v1.';

CREATE OR REPLACE FUNCTION public.evidence_judgment_images_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.evidence_judgment_images WHERE request_id = NEW.id;
  INSERT INTO public.evidence_judgment_images (request_id, image_id, role, ord)
  SELECT NEW.id, s.id::uuid, s.role, min(s.ord)
  FROM (
    SELECT 'cited' AS role, e.v AS id, e.ord FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.params->'cited_image_ids') = 'array' THEN NEW.params->'cited_image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
    UNION ALL
    SELECT 'candidate', e.v, e.ord FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.params->'candidate_image_ids') = 'array' THEN NEW.params->'candidate_image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
    UNION ALL
    SELECT 'answer', e.v, e.ord FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.answer->'image_ids') = 'array' THEN NEW.answer->'image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
  ) s
  WHERE s.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = s.id::uuid)
  GROUP BY s.id, s.role;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.evidence_judgment_images_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS evidence_judgment_images_sync ON public.evidence_judgment_requests;
CREATE TRIGGER evidence_judgment_images_sync
  AFTER INSERT OR UPDATE OF params, answer ON public.evidence_judgment_requests
  FOR EACH ROW EXECUTE FUNCTION public.evidence_judgment_images_sync();

-- Backfill: the trigger's rule over the rows already stored (about 6.6k references).
INSERT INTO public.evidence_judgment_images (request_id, image_id, role, ord)
SELECT r.id, s.id::uuid, s.role, min(s.ord)
FROM public.evidence_judgment_requests r
CROSS JOIN LATERAL (
  SELECT 'cited' AS role, e.v AS id, e.ord FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(r.params->'cited_image_ids') = 'array' THEN r.params->'cited_image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
  UNION ALL
  SELECT 'candidate', e.v, e.ord FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(r.params->'candidate_image_ids') = 'array' THEN r.params->'candidate_image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
  UNION ALL
  SELECT 'answer', e.v, e.ord FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(r.answer->'image_ids') = 'array' THEN r.answer->'image_ids' ELSE '[]' END) WITH ORDINALITY e(v, ord)
) s
WHERE s.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.id = s.id::uuid)
GROUP BY r.id, s.id, s.role
ON CONFLICT DO NOTHING;

-- The edge from a value answer to the reading it became. Refuses anything but the reading the sanctioned writer landed
-- for this very request: same vehicle, same property, method fact_doubt_reread_v1, the request id in its record, current.
CREATE OR REPLACE FUNCTION public.record_fact_doubt_landing(p_request_id uuid, p_observation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.evidence_judgment_requests%ROWTYPE;
  ok boolean;
BEGIN
  SELECT * INTO r FROM public.evidence_judgment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.question_kind <> 'fact_doubt' OR r.status <> 'answered' OR r.answer->>'outcome' <> 'value' THEN
    RAISE EXCEPTION 'not an answered value fact doubt' USING ERRCODE = '22023';
  END IF;
  IF r.answer_observation_id IS NOT NULL THEN RETURN r.answer_observation_id = p_observation_id; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_observations o
    WHERE o.id = p_observation_id AND o.vehicle_id = r.vehicle_id AND o.property_id = r.property_id
      AND o.extraction_method = 'fact_doubt_reread_v1' AND o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL
      AND o.structured_data->>'fact_doubt_request_id' = r.id::text) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'observation is not this request''s landed reading' USING ERRCODE = '22023'; END IF;
  UPDATE public.evidence_judgment_requests SET answer_observation_id = p_observation_id WHERE id = p_request_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_fact_doubt_landing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fact_doubt_landing(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.record_fact_doubt_landing(uuid, uuid) IS
  'Links an answered value fact doubt to the keyed reading ingest-observation landed for it (answer_observation_id). Idempotent; refuses any other observation. evidence_judgment_edges_v1.';
