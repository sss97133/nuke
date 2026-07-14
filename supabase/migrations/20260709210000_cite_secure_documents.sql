-- Let an observation cite the document that proves it.
--
-- vehicle_observations.citation_document_id has a FK to `reference_documents` —
-- the shared reference library (service manuals, brochures). A claim derived from
-- the OWNER'S OWN evidence — a title, a bill of sale, an insurance card — lives in
-- `secure_documents` and had nowhere to point. So the first real derivation
-- (derive-title-ownership) could not write a cited claim: every insert died on
-- vehicle_observations_citation_document_id_fkey.
--
-- The theory (testimony-and-half-lives.md) requires that every observation carry
-- "who said it, when, on what basis." Without this column the basis is a comment.
--
-- Additive: a new nullable FK. Nothing that validated before stops validating.

ALTER TABLE public.vehicle_observations
  ADD COLUMN IF NOT EXISTS citation_secure_document_id uuid
    REFERENCES public.secure_documents(id);

COMMENT ON COLUMN public.vehicle_observations.citation_secure_document_id IS
  'The owner-held document (title, bill of sale) this claim was read from. Distinct from citation_document_id, which cites the shared reference_documents library. A permanent instrument cited here is what allows a document to outrank an owner''s later assertion.';

-- Find every claim proved by a given document, and every document backing a vehicle.
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_citation_secure_doc
  ON public.vehicle_observations (citation_secure_document_id)
  WHERE citation_secure_document_id IS NOT NULL;
