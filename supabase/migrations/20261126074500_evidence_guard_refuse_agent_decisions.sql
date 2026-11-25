-- fix(evidence_insert_guard): refuse agent decisions from any caller
--
-- Rule (db-safety.md, Testimony): no agent records an owner decision. The live guard (20261021220000) refused an
-- 'agent:%' evidence_decisions row only when the caller was NOT (role service_role AND outermost writer
-- decide_evidence). A service-role call whose outermost PL/pgSQL frame is any function named decide_evidence could
-- therefore record one. No function of that name exists live (pg_proc, 2026-11-25), so the path was latent.
--
-- This migration changes two function bodies and no row:
--   evidence_insert_guard()  refuses decided_by LIKE 'agent:%' outright, for every role and every writer;
--   evidence_writer_names()  drops 'decide_evidence' until the owner-confirmation loop ships (it re-lists the name
--                            in its own reviewed migration); with no writer of that name, the owner session
--                            (role authenticated) writes nothing, which is the live state today (0 writers live).
-- evidence_caller_check(), the 27 triggers (still ENABLE ALWAYS), RLS and grants are untouched: CREATE OR REPLACE keeps
-- each function's owner and ACL. evidence_writer_names() stays IMMUTABLE with the same pinned search_path.
--
-- Guard: each body's md5(prosrc) must be the 20261021220000 body (live 2026-11-25) or already this one (re-apply is a
-- no-op); anything else raises and changes nothing. The after-md5s are asserted at the end.
--   evidence_insert_guard  8d9b6e3a8bcbf640c83d720287d69276 -> 32d257037fcd12703ee4cdd0903e6aca
--   evidence_writer_names  f58bf0e4845ea6eb8e8d5e13773ceca1 -> dbc8779323dd88c31f1e28fca2a377a2
-- Revert: supabase/sql/revert_20261126074500_evidence_guard_refuse_agent_decisions.sql.
-- Contract: supabase/sql/test_image_evidence_tables.sql applies 20261021220000 and then this file.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_guard text; v_names text;
BEGIN
  SELECT md5(prosrc) INTO v_guard FROM pg_proc WHERE oid = 'public.evidence_insert_guard()'::regprocedure;
  SELECT md5(prosrc) INTO v_names FROM pg_proc WHERE oid = 'public.evidence_writer_names()'::regprocedure;
  IF v_guard NOT IN ('8d9b6e3a8bcbf640c83d720287d69276', '32d257037fcd12703ee4cdd0903e6aca') THEN
    RAISE EXCEPTION 'evidence_insert_guard body drifted (md5 %); refusing to replace it', v_guard;
  END IF;
  IF v_names NOT IN ('f58bf0e4845ea6eb8e8d5e13773ceca1', 'dbc8779323dd88c31f1e28fca2a377a2') THEN
    RAISE EXCEPTION 'evidence_writer_names body drifted (md5 %); refusing to replace it', v_names;
  END IF;
END $$;

-- The writers that may be the OUTERMOST function of a call that writes the evidence tables. decide_evidence is not
-- listed until the owner-confirmation loop ships; its migration adds it back.
CREATE OR REPLACE FUNCTION public.evidence_writer_names() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ARRAY[
    -- M1w: runs, proposals, answers
    'evidence_open_run','evidence_close_run','evidence_record_answers','propose_image_candidates',
    'propose_capture_time_claims','confirm_capture_times_by_rule','propose_evidence_links','propose_account_entities',
    'propose_change_claim','propose_claim_support','record_day_context',
    -- M1p: promotion path
    'evidence_record_reverts','evidence_probe_write','promote_image','record_promotion_failure',
    'evidence_repin_after_merge','publish_image']::text[]
$$;

CREATE OR REPLACE FUNCTION public.evidence_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_c text; v_role text; v_writer text;
BEGIN
  v_c := public.evidence_caller_check(TG_TABLE_NAME);
  v_role := split_part(v_c, ':', 1); v_writer := split_part(v_c, ':', 2);
  IF TG_TABLE_NAME = 'evidence_decisions' THEN
    -- No agent records an owner decision: refused for every role and every writer, whatever the writer list holds.
    IF NEW.decided_by LIKE 'agent:%' THEN
      RAISE EXCEPTION 'evidence_decisions: no agent records an owner decision (agent: refused from every caller)' USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_by LIKE 'human:%' AND (v_role <> 'authenticated' OR v_writer <> 'decide_evidence'
         OR substr(NEW.decided_by, 7) IS DISTINCT FROM (SELECT auth.uid())::text) THEN
      RAISE EXCEPTION 'evidence_decisions: an owner decision comes only from the owner''s own session' USING ERRCODE = '42501';
    END IF;
    -- an owner decision only from a step-up (aal2) session; the session facts are stamped
    IF NEW.decided_by LIKE 'human:%' THEN
      IF coalesce((SELECT auth.jwt())->>'aal', '') <> 'aal2' THEN
        RAISE EXCEPTION 'evidence_decisions: an owner decision needs a step-up (aal2) session' USING ERRCODE = '42501';
      END IF;
      NEW.detail := NEW.detail || jsonb_build_object('aal', (SELECT auth.jwt())->>'aal',
                      'session_id', (SELECT auth.jwt())->>'session_id',
                      'amr', (SELECT jsonb_agg(DISTINCT e->>'method') FROM jsonb_array_elements(coalesce((SELECT auth.jwt())->'amr', '[]'::jsonb)) e));
    END IF;
    NEW.detail := NEW.detail || jsonb_build_object('api_role', v_role, 'outer_writer', v_writer);
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE v_guard text; v_names text;
BEGIN
  SELECT md5(prosrc) INTO v_guard FROM pg_proc WHERE oid = 'public.evidence_insert_guard()'::regprocedure;
  SELECT md5(prosrc) INTO v_names FROM pg_proc WHERE oid = 'public.evidence_writer_names()'::regprocedure;
  IF v_guard <> '32d257037fcd12703ee4cdd0903e6aca' OR v_names <> 'dbc8779323dd88c31f1e28fca2a377a2' THEN
    RAISE EXCEPTION 'after-md5 mismatch: evidence_insert_guard %, evidence_writer_names %', v_guard, v_names;
  END IF;
  IF 'decide_evidence' = ANY (public.evidence_writer_names()) THEN
    RAISE EXCEPTION 'evidence_writer_names still lists decide_evidence';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'A'
        AND tgname ~ '_(insert_guard|append_only|no_truncate)$'
        AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (
          'evidence_runs','image_vehicle_candidates','image_capture_time_claims','evidence_links',
          'evidence_account_entities','vehicle_change_claims','vehicle_change_claim_support',
          'user_day_vehicle_context','evidence_decisions'))) <> 27 THEN
    RAISE EXCEPTION 'expected 27 evidence guard triggers fired ALWAYS';
  END IF;
END $$;
COMMIT;
