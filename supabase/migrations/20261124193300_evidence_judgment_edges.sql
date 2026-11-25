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
-- The photos a value answer read reach the center through its reading: answer_observation_id -> vehicle_observations
-- -> observation_witnesses (image_id FK vehicle_images, written by trigger project_observation_image_witness). The photos
-- a question cites before it is answered stay in params (a new photo-keyed table needs the owner's approval through
-- schema_proposals: scripts/guardrails/no-new-photo-reader.mjs); that remains a named debt.
-- Clocks: the request's own (created_at, answered_at); this adds none. Writers: the existing judgment RPCs (unchanged)
-- and record_fact_doubt_landing (service_role). No testimony table is written.
--
-- REVERT. DROP FUNCTION record_fact_doubt_landing(uuid,uuid);
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
