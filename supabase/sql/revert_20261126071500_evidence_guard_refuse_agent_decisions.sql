-- Revert of supabase/migrations/20261126071500_evidence_guard_refuse_agent_decisions.sql: restores the
-- 20261021220000 bodies of evidence_insert_guard() and evidence_writer_names() byte for byte, which reopens the latent
-- path (an 'agent:' decision from a service-role caller whose outermost frame is named decide_evidence). Ship it only
-- as a reviewed migration (copy it under supabase/migrations with a new version); never apply it by hand.
-- Guard: each body must be the 20261126071500 body or already the 20261021220000 one; the end md5s are asserted.
--   evidence_insert_guard  32d257037fcd12703ee4cdd0903e6aca -> 8d9b6e3a8bcbf640c83d720287d69276
--   evidence_writer_names  dbc8779323dd88c31f1e28fca2a377a2 -> f58bf0e4845ea6eb8e8d5e13773ceca1
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_guard text; v_names text;
BEGIN
  SELECT md5(prosrc) INTO v_guard FROM pg_proc WHERE oid = 'public.evidence_insert_guard()'::regprocedure;
  SELECT md5(prosrc) INTO v_names FROM pg_proc WHERE oid = 'public.evidence_writer_names()'::regprocedure;
  IF v_guard NOT IN ('32d257037fcd12703ee4cdd0903e6aca', '8d9b6e3a8bcbf640c83d720287d69276') THEN
    RAISE EXCEPTION 'evidence_insert_guard body drifted (md5 %); refusing to replace it', v_guard;
  END IF;
  IF v_names NOT IN ('dbc8779323dd88c31f1e28fca2a377a2', 'f58bf0e4845ea6eb8e8d5e13773ceca1') THEN
    RAISE EXCEPTION 'evidence_writer_names body drifted (md5 %); refusing to replace it', v_names;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.evidence_writer_names() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ARRAY[
    -- M1w: runs, proposals, answers, decisions
    'evidence_open_run','evidence_close_run','evidence_record_answers','propose_image_candidates',
    'propose_capture_time_claims','confirm_capture_times_by_rule','propose_evidence_links','propose_account_entities',
    'propose_change_claim','propose_claim_support','record_day_context','decide_evidence',
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
    IF NEW.decided_by LIKE 'human:%' AND (v_role <> 'authenticated' OR v_writer <> 'decide_evidence'
         OR substr(NEW.decided_by, 7) IS DISTINCT FROM (SELECT auth.uid())::text) THEN
      RAISE EXCEPTION 'evidence_decisions: an owner decision comes only from the owner''s own session' USING ERRCODE = '42501';
    END IF;
    -- (v5, rules-channels v4 #3) and only from a step-up (aal2) session; the session facts are stamped
    IF NEW.decided_by LIKE 'human:%' THEN
      IF coalesce((SELECT auth.jwt())->>'aal', '') <> 'aal2' THEN
        RAISE EXCEPTION 'evidence_decisions: an owner decision needs a step-up (aal2) session' USING ERRCODE = '42501';
      END IF;
      NEW.detail := NEW.detail || jsonb_build_object('aal', (SELECT auth.jwt())->>'aal',
                      'session_id', (SELECT auth.jwt())->>'session_id',
                      'amr', (SELECT jsonb_agg(DISTINCT e->>'method') FROM jsonb_array_elements(coalesce((SELECT auth.jwt())->'amr', '[]'::jsonb)) e));
    END IF;
    IF NEW.decided_by LIKE 'agent:%' AND (v_role <> 'service_role' OR v_writer <> 'decide_evidence') THEN
      RAISE EXCEPTION 'evidence_decisions: an agent decision comes only from a service-role job through decide_evidence' USING ERRCODE = '42501';
    END IF;
    NEW.detail := NEW.detail || jsonb_build_object('api_role', v_role, 'outer_writer', v_writer);
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.evidence_insert_guard()'::regprocedure) <> '8d9b6e3a8bcbf640c83d720287d69276'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.evidence_writer_names()'::regprocedure) <> 'f58bf0e4845ea6eb8e8d5e13773ceca1' THEN
    RAISE EXCEPTION 'revert did not restore the 20261021220000 bodies';
  END IF;
END $$;
COMMIT;
