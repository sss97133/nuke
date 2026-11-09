-- Signed garage derivation evidence: every conclusion a garage producer reaches (scene label, place match, place exemplar,
-- sign read, duplicate judgment, seller-history match, relationship role) is a row with its subject, conclusion, confidence,
-- cited evidence, and who/what/when produced it (producer_agent, producer_script, producer_version = git sha + script, model/viewer, run_id).
-- Testimony of a producer, not a fact about the world. Append-only (supersede, never edit or delete), idempotent on dedupe_key.
-- Additive: no existing table or function changes. vehicle_relationship_derivations is NOT reused for relationship_role rows: it is keyed by
-- (vehicle, user) with a closed role set and a title-verification rule, while the producers' role proposals carry no user and use the
-- richer chain roles; they are kept here as kind 'relationship_role' and cite that table's ids in evidence when they come from it.
-- Rollback by run: rollback_garage_derivation_run(run_id, reason, false) supersedes every active row of the run.
-- Full revert: DROP FUNCTION public.rollback_garage_derivation_run(uuid, text, boolean); DROP TABLE public.garage_derivation_evidence;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- Same body as in 20261111200500_garage_listing_org_evidence.sql (CREATE OR REPLACE there too), so either order works.
CREATE OR REPLACE FUNCTION public.derived_rows_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only: supersede, never delete', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by' - 'superseded_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by' - 'superseded_reason') THEN
    RAISE EXCEPTION '% is append-only: only an active row can be superseded', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TABLE public.garage_derivation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('scene_label', 'place_match', 'place_exemplar', 'sign_read', 'duplicate_judgment',
                                     'seller_history_match', 'relationship_role')),
  vehicle_id uuid,                 -- subject vehicle (side A of a duplicate judgment); null when the producer could not resolve one
  other_vehicle_id uuid,           -- side B of a duplicate judgment
  user_id uuid,
  organization_id uuid,
  session_key text,
  subject_key text,                -- other subject identity: listing url, exemplar url, ...
  image_ids uuid[] NOT NULL DEFAULT '{}',
  conclusion text NOT NULL,        -- scene label, org id or 'neither', same/different/unsure, derived role, ...
  conclusion_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,   -- what the conclusion cites (cues, quotes, listing, chain, source rows)
  producer_agent text NOT NULL DEFAULT 'injestion',
  producer_script text NOT NULL,
  producer_version text NOT NULL,  -- '<git sha>:<script>'
  model text,
  viewer integer,
  run_id uuid NOT NULL,
  source_run_id uuid,              -- run of the conclusion this one reads (sign_read <- place_match)
  content_hash text NOT NULL,      -- sha256 of the canonical conclusion payload
  dedupe_key text NOT NULL,
  observed_at timestamptz,         -- when the producer concluded (its own clock)
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text,
  CONSTRAINT garage_derivation_evidence_dedupe UNIQUE (dedupe_key)
);
CREATE INDEX garage_derivation_evidence_run ON public.garage_derivation_evidence (run_id);
CREATE INDEX garage_derivation_evidence_vehicle ON public.garage_derivation_evidence (vehicle_id, kind) WHERE superseded_at IS NULL;
CREATE INDEX garage_derivation_evidence_org ON public.garage_derivation_evidence (organization_id, kind) WHERE superseded_at IS NULL AND organization_id IS NOT NULL;
COMMENT ON TABLE public.garage_derivation_evidence IS
  'Signed conclusions of the garage derivation producers (scripts/garage/*): kind, subject refs, conclusion, confidence, cited evidence, producer_agent/script/version, model and viewer, run_id. Testimony of the producer; append-only (supersede, never edit); idempotent on dedupe_key. Written through PostgREST by scripts/garage producers and scripts/garage/import-derivation-evidence.mjs with the service role. Undo a run with rollback_garage_derivation_run.';

CREATE TRIGGER garage_derivation_evidence_append_only BEFORE UPDATE OR DELETE ON public.garage_derivation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.derived_rows_append_only();
ALTER TABLE public.garage_derivation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY garage_derivation_evidence_service ON public.garage_derivation_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.garage_derivation_evidence FROM anon, authenticated;
GRANT ALL ON public.garage_derivation_evidence TO service_role;

-- Rollback by run_id: supersede (never delete) every active row of the run. Dry run by default; returns the rows it touches.
CREATE FUNCTION public.rollback_garage_derivation_run(p_run_id uuid, p_reason text, p_dry_run boolean DEFAULT true)
RETURNS TABLE(id uuid, kind text, vehicle_id uuid, conclusion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_run_id IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'run id and reason required' USING ERRCODE = '22023';
  END IF;
  IF p_dry_run IS NOT TRUE THEN
    RETURN QUERY
    WITH u AS (
      UPDATE garage_derivation_evidence e SET superseded_at = now(), superseded_reason = 'rollback run ' || p_run_id || ': ' || p_reason
       WHERE e.run_id = p_run_id AND e.superseded_at IS NULL
      RETURNING e.id, e.kind, e.vehicle_id, e.conclusion)
    SELECT u.id, u.kind, u.vehicle_id, u.conclusion FROM u;
  ELSE
    RETURN QUERY SELECT e.id, e.kind, e.vehicle_id, e.conclusion FROM garage_derivation_evidence e
     WHERE e.run_id = p_run_id AND e.superseded_at IS NULL;
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.rollback_garage_derivation_run(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_garage_derivation_run(uuid, text, boolean) TO service_role;
COMMIT;
