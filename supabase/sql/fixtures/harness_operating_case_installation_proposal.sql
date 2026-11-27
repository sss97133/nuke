-- Disposable schema-proposal adapter. No authenticated user, review or source
-- testimony is manufactured; the original metadata registration is exercised.
CREATE TABLE public.schema_proposals(
 id uuid PRIMARY KEY,proposed_by_user_id uuid,proposed_by_agent_key text,
 proposal_type text NOT NULL,payload jsonb NOT NULL,evidence jsonb,
 estimated_scope jsonb,backward_compatibility jsonb,status text NOT NULL,
 proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),gate_measure jsonb,
 claimed_by_user_id uuid,claimed_at timestamptz,resolved_at timestamptz,decision_rationale text,
 promoted_to_id uuid,supersedes_proposal_id uuid,superseded_by uuid,
 motivating_observation_ids uuid[],motivating_pending_claim_ids uuid[]
);
CREATE TABLE public.schema_proposal_reviews(proposal_id uuid,decision text);
CREATE FUNCTION public.schema_proposal_gate_measure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.gate_measure IS DISTINCT FROM(CASE WHEN TG_OP='UPDATE' THEN OLD.gate_measure END)
  AND coalesce(current_setting('nuke.schema_proposal_key_gate',true),'')<>'on' THEN
  RAISE EXCEPTION 'schema_proposals.gate_measure is written only by schema_proposal_key_gate' USING ERRCODE='42501';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER schema_proposal_gate_measure_guard BEFORE INSERT OR UPDATE ON public.schema_proposals
 FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_gate_measure_guard();
\i supabase/migrations/20261126203826_harness_operating_case_proposal.sql
CREATE TEMP TABLE operating_proposal_before AS SELECT to_jsonb(p) AS row FROM public.schema_proposals p;
