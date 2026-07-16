-- 20260617000200_contributor_role_verification.sql
--
-- KEYSTONE STEP 4 — contributor-role claim→verify substrate.
-- Design: docs/library/technical/engineering-manual/20-polymorphic-subject-build-guide.md §7.
-- Approved by Skylar 2026-06-17.
--
-- WHY: today an `organization_contributors` row has role + status but NO record
-- of HOW the role was established. So "technician at Ernie's" is effectively a
-- self-claim, yet the mode switcher (deriveModes) trusts these roles to build a
-- person's work modes. This applies the proof discipline to people↔org links,
-- parallel to `organization_ownership_verifications` for ownership.
--
-- The FSM (status pending → active) gains a verification BASIS:
--   self_claimed   — asserted by the user, unverified (the honest default for
--                    every existing row).
--   owner_approval — confirmed by an org owner/manager.
--   proof_of_work  — auto-verifiable: the user has formation proof (activities /
--                    observations / documented work) tied to this org. This is
--                    proof-of-work-not-pay-to-play applied to roles — you earn the
--                    title by the work, not by typing it. (Auto-promote RPC is a
--                    follow-up; this migration provides the substrate it writes.)
--   document       — backed by an uploaded document (employment, license, etc.).
--
-- SAFETY: small table, purely additive. Constant default = metadata-only.
-- Existing rows become verification_method='self_claimed' — TRUTHFUL: they were
-- never verified. No status is silently upgraded. CHECK added NOT VALID (instant).

ALTER TABLE organization_contributors
  ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'self_claimed',
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_evidence jsonb;

COMMENT ON COLUMN organization_contributors.verification_method IS
  'How the role was established: self_claimed|owner_approval|proof_of_work|document. Default self_claimed (unverified). See engineering-manual/20 §7.';
COMMENT ON COLUMN organization_contributors.verified_by IS
  'User who verified the role (owner/manager) for owner_approval; NULL for proof_of_work/system.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_contributors_verification_method_chk'
  ) THEN
    ALTER TABLE organization_contributors
      ADD CONSTRAINT organization_contributors_verification_method_chk
      CHECK (verification_method IN ('self_claimed','owner_approval','proof_of_work','document')) NOT VALID;
  END IF;
END $$;
