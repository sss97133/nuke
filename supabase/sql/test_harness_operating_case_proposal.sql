-- Standalone metadata-intake contract. No vehicle/observation/source fixtures.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT starts_with(current_database(),'dm_refinement_') OR EXISTS(
  SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p'))
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement database'; END IF;
END $$;
CREATE TABLE public.schema_proposals(
 id uuid PRIMARY KEY,proposed_by_user_id uuid,proposed_by_agent_key text,
 proposal_type text NOT NULL,payload jsonb NOT NULL,evidence jsonb,
 estimated_scope jsonb,backward_compatibility jsonb,status text NOT NULL,
 proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),gate_measure jsonb,
 CHECK(proposed_by_user_id IS NOT NULL OR proposed_by_agent_key IS NOT NULL),
 CHECK(proposal_type='add_table'),CHECK(status IN('open','under_review','approved','rejected','needs_changes','superseded','withdrawn'))
);
-- Actual live intake guard: no marker or direct gate_measure write is permitted.
CREATE FUNCTION public.schema_proposal_gate_measure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.gate_measure IS DISTINCT FROM(CASE WHEN TG_OP='UPDATE' THEN OLD.gate_measure END)
  AND coalesce(current_setting('nuke.schema_proposal_key_gate',true),'')<>'on'
 THEN RAISE EXCEPTION 'schema_proposals.gate_measure is written only by schema_proposal_key_gate' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schema_proposal_gate_measure_guard BEFORE INSERT OR UPDATE ON public.schema_proposals
 FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_gate_measure_guard();
\i supabase/migrations/20261126203826_harness_operating_case_proposal.sql
CREATE TEMP TABLE original_proposal AS SELECT to_jsonb(p) row FROM public.schema_proposals p;
\i supabase/migrations/20261126203826_harness_operating_case_proposal.sql
DO $test$
DECLARE p public.schema_proposals;t jsonb;names text[];expected text[]:=ARRAY[
 'harness_operating_cases','harness_operating_case_revisions','harness_operating_case_wires',
 'harness_operating_case_elements','harness_operating_case_boundaries','harness_model_dc_runs',
 'harness_model_dc_wire_inputs','harness_model_dc_node_results','harness_model_dc_branch_results','harness_model_dc_issues'];
BEGIN
 IF(SELECT count(*) FROM public.schema_proposals)<>1 THEN RAISE EXCEPTION 'Submission duplicated or absent'; END IF;
 SELECT * INTO STRICT p FROM public.schema_proposals;
 IF p.proposed_by_user_id IS NOT NULL OR p.proposed_by_agent_key IS DISTINCT FROM 'codex-wiring-operating-cases-20261126'
  OR p.status IS DISTINCT FROM 'open' OR p.proposal_type IS DISTINCT FROM 'add_table'
  OR p.gate_measure IS NOT NULL OR coalesce(current_setting('nuke.schema_proposal_key_gate',true),'')<>''
 THEN RAISE EXCEPTION 'Submission invented identity, approval or gate measure'; END IF;
 IF to_jsonb(p) IS DISTINCT FROM(SELECT row FROM original_proposal)
 THEN RAISE EXCEPTION 'Replay changed the original proposal or clock'; END IF;
 IF jsonb_typeof(p.payload->'tables') IS DISTINCT FROM 'array' OR jsonb_array_length(p.payload->'tables')<>10
  OR jsonb_typeof(p.evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p.evidence)<5
 THEN RAISE EXCEPTION 'Missing typed schema/evidence envelope'; END IF;
 SELECT array_agg(x->>'name' ORDER BY x->>'name') INTO names FROM jsonb_array_elements(p.payload->'tables') a(x);
 IF names IS DISTINCT FROM(SELECT array_agg(x ORDER BY x) FROM unnest(expected) a(x))
 THEN RAISE EXCEPTION 'Unexpected or duplicate proposed relation'; END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(p.payload->'tables') LOOP
  IF nullif(t->>'grain','') IS NULL OR jsonb_array_length(t->'primary_key')=0
   OR jsonb_array_length(t->'columns')=0 OR jsonb_array_length(t->'foreign_edges')=0
   OR jsonb_array_length(t->'required_constraints')=0 OR jsonb_array_length(t->'clocks')=0
   OR t->>'access' IS DISTINCT FROM 'Private; RLS; service-only sanctioned writer/reader; no anon/authenticated grants'
  THEN RAISE EXCEPTION 'Incomplete relation contract: %',t->>'name'; END IF;
  IF to_regclass('public.'||(t->>'name')) IS NOT NULL
  THEN RAISE EXCEPTION 'Proposal created a proposed runtime object: %',t->>'name'; END IF;
 END LOOP;
 IF p.payload->'writer_contract'->>'producer' NOT LIKE '%not harness_model_fold%'
  OR p.payload->'worker_contract'->>'signal' NOT LIKE '%never harness_model_signal/public source_epoch%'
  OR p.payload->'worker_contract'->>'followup' NOT LIKE '%private due%'
  OR p.payload->'reader_contract'->>'public' NOT LIKE 'Unchanged;%'
  OR jsonb_array_length(p.payload->'implementation_gates')<10
  OR p.backward_compatibility->>'existing_data_behavior' IS DISTINCT FROM 'preserved_unchanged'
 THEN RAISE EXCEPTION 'Missing owner/currentness/privacy/registration boundary'; END IF;
 IF(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN('r','p'))<>1
 THEN RAISE EXCEPTION 'Submission created unrelated tables'; END IF;
END $test$;
SELECT 'test_harness_operating_case_proposal: PASS' result;
