-- Phase 1 — evidence-class binding for the agent-write pipeline.
--
-- Every projection_event (governed agent claim) now carries the CLASS of evidence
-- that cites it (image / vin_decode / document / owner_claim / context_atoms) and a
-- structured reference to that evidence. The admissibility rule (a photo can't cite
-- horsepower) is enforced in the connector against the registry binding; these columns
-- make the citation queryable for the wiki view and for projection weighting (Phase 3).
--
-- Backfill is intentionally absent: existing rows predate the binding and stay NULL
-- (testimony is append-only; we don't rewrite history). New claims must populate them.

ALTER TABLE public.projection_event
  ADD COLUMN IF NOT EXISTS evidence_class text,
  ADD COLUMN IF NOT EXISTS evidence_ref   jsonb;

COMMENT ON COLUMN public.projection_event.evidence_class IS
  'Admissible evidence class that cites this claim: image | vin_decode | document | owner_claim | context_atoms. Enforced at submit time against the attribute registry binding (anti-laundering).';
COMMENT ON COLUMN public.projection_event.evidence_ref IS
  'Structured citation for the evidence: e.g. {image_ids:[...]} for image, {rule, vin} for vin_decode, {document_id|url, page} for document, {statement} for owner_claim.';

-- The append-only freeze trigger enumerates the frozen columns by name. We extend it to
-- cover the two new columns so a claim's citation can never be silently rewritten after the
-- fact — the citation is as load-bearing as the value it backs.
CREATE OR REPLACE FUNCTION public.projection_event_freeze_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (
    NEW.id <> OLD.id OR
    NEW.request_envelope <> OLD.request_envelope OR
    NEW.result_envelope <> OLD.result_envelope OR
    NEW.result_kind <> OLD.result_kind OR
    NEW.model_id <> OLD.model_id OR
    NEW.model_caller <> OLD.model_caller OR
    NEW.prompt_sha256 <> OLD.prompt_sha256 OR
    NEW.observation_ids <> OLD.observation_ids OR
    NEW.observed_at <> OLD.observed_at OR
    NEW.recorded_at <> OLD.recorded_at OR
    NEW.evidence_class IS DISTINCT FROM OLD.evidence_class OR
    NEW.evidence_ref   IS DISTINCT FROM OLD.evidence_ref
  ) THEN
    RAISE EXCEPTION 'projection_event rows are append-only.';
  END IF;
  RETURN NEW;
END;
$function$;

-- Queryable: "show me every image-cited claim for this vehicle", etc.
CREATE INDEX IF NOT EXISTS idx_projection_event_evidence_class
  ON public.projection_event (evidence_class)
  WHERE evidence_class IS NOT NULL;
