-- 20261007020000_allow_external_identity_observation_subject.sql
--
-- Widen vehicle_observations.subject_type to admit 'external_identity', so facts observed about a
-- person/platform-identity (a BaT member's home location at state/country grain, and the lots they
-- bought or listed) can land in the sanctioned dated-fact substrate instead of a metadata sidecar.
--
-- Why now (identity-origin harvest, docs/features/identity-origin/SPEC.md):
--   The member-page harvest reads a BaT member page, lands the fetch as a listing_page_snapshots
--   receipt, and emits the page's facts as observations ABOUT THE PERSON. external_identities.id is a
--   uuid, so the subject is cleanly addressable as subject_id. Today the CHECK admits only
--   vehicle|organization|user|asset, so an identity-subject observation is rejected at the data layer
--   (observationWriter.ts / ingest-observation pass subject_type straight through; the CHECK is the
--   only gate — the former scripts/entity/{observe,validate}.mjs allowlist no longer exists on main).
--
-- SCHEMA_LAW (every value lands with its writer and reader): the writer is the extract-bat-profile-vehicles
--   extension emitting subject_type='external_identity' observations via ingest-observation, and the reader
--   is the bounded location fold into external_identities.metadata plus identity_vehicle_relation(); both
--   are the immediately-following PRs of this same sequence (data-model lead sequences them back-to-back).
--
-- Scope decision (data-model lead, 2026-10-06): external_identity ONLY. Proposal 850c8ad1 (open since
--   2026-07-20) widens the same CHECK for 'publication_page'; it stays OPEN and lands with its own writer
--   in the publication lane. This migration does not touch it.
--
-- NOT VALID is deliberate: new rows are checked; all existing rows already satisfy the prior set, so a
--   VALIDATE would full-scan vehicle_observations (large) and exceed the deploy role's 10s timeout. The
--   constraint is enforced for every write going forward regardless.

SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.vehicle_observations
  DROP CONSTRAINT vehicle_observations_subject_type_chk;

ALTER TABLE public.vehicle_observations
  ADD CONSTRAINT vehicle_observations_subject_type_chk
  CHECK (subject_type = ANY (ARRAY['vehicle'::text, 'organization'::text, 'user'::text, 'asset'::text, 'external_identity'::text]))
  NOT VALID;

-- Governance record. Filed as modify_property because schema_proposals_proposal_type_check has no
-- subject-type slot (add_property | add_observation_kind | add_source | modify_property |
-- add_image_attribute); 850c8ad1 flagged the same gap. Per the toolbox rule we do NOT mint an
-- 'add_subject_type' proposal type for one row.
INSERT INTO public.schema_proposals (id, proposed_at, proposed_by_agent_key, proposal_type, payload, status)
VALUES (
  gen_random_uuid(),
  now(),
  'claude-opus-4-8-identity-origin',
  'modify_property',
  jsonb_build_object(
    'why', 'identity-origin harvest needs identity-subject observations (BaT member-page facts about the person: state/country location, lots bought/listed). external_identities.id is uuid, cleanly addressable. The subject_type CHECK was the only gate blocking it.',
    'change', 'vehicle_observations_subject_type_chk widened to add external_identity (NOT VALID); applied in migration 20261007020000.',
    'subject_type', 'external_identity',
    'subject_table', 'external_identities',
    'subject_pk', 'id (uuid)',
    'writer', 'extract-bat-profile-vehicles extension via ingest-observation (following PR in sequence)',
    'reader', 'bounded location fold into external_identities.metadata + identity_vehicle_relation() (following PR)',
    'not_proposed', 'publication_page remains open proposal 850c8ad1, publication lane, lands with its own writer',
    'proposal_type_is_a_poor_fit', 'filed as modify_property; schema_proposals_proposal_type_check has no subject-type slot and per toolbox rule we did not mint one for a single row',
    'masking', 'identity location is public only at state/country grain (observation_is_public + vo read policy), never street'
  ),
  'open'
);
