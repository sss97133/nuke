-- =========================================================================
-- 20260522_schema_proposal_approval_trigger.sql
-- Date:   2026-05-22
-- Status: PROPOSED — apply after explicit review.
--
-- Closes the "approved-but-unapplied" gap in the institution workflow.
-- After approval, schema_proposals were transitioning to status='approved'
-- but no observation_properties row was being created — the handbook
-- §6 promise ("Approval triggers a deterministic SQL migration") had no
-- biology behind it.
--
-- This migration adds:
--   1. fn_schema_proposal_check_quorum(uuid) — counts approve reviews,
--      compares to per-proposal-type required count.
--   2. fn_schema_proposal_apply(uuid) — executes the schema change
--      deterministically for `add_property` and `add_observation_kind`.
--      Other proposal types (fork_property, modify_trust_tier,
--      deprecate_property, modify_property, add_source, add_source_category)
--      mark status='approved' but leave the schema change to manual
--      application — too much risk to automate without a curator queue UI.
--   3. trg_schema_proposal_review_after_insert — AFTER INSERT trigger on
--      schema_proposal_reviews that calls quorum check + apply.
--
-- Quorum per proposal_type:
--   add_property         → 1 approve
--   add_observation_kind → 1 approve  (ALTER TYPE ADD VALUE)
--   add_source           → 1 approve
--   add_source_category  → 1 approve
--   modify_property      → 1 approve
--   fork_property        → 2 distinct approves (AX-009 false-merge guard)
--   modify_trust_tier    → 2 distinct approves
--   deprecate_property   → 1 approve (manual application — see below)
--
-- A reject decision short-circuits: schema_proposals.status='rejected'
-- regardless of approve count.
--
-- Trust invariant: schema_proposal_reviews rows are testimony and never
-- deleted. The trigger is idempotent — calling it twice on the same
-- proposal is a no-op once status leaves 'open'/'under_review'.
-- =========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_schema_proposal_required_approvals(p_type text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'add_property'         THEN 1
    WHEN 'add_observation_kind' THEN 1
    WHEN 'add_source'           THEN 1
    WHEN 'add_source_category'  THEN 1
    WHEN 'modify_property'      THEN 1
    WHEN 'deprecate_property'   THEN 1
    WHEN 'fork_property'        THEN 2
    WHEN 'modify_trust_tier'    THEN 2
    ELSE 9999
  END
$$;

COMMENT ON FUNCTION public.fn_schema_proposal_required_approvals(text) IS
  'Per-proposal-type quorum table. fork_property needs 2 distinct curators (AX-009 false-merge guard); modify_trust_tier needs 2 (ranking semantics affect whole substrate).';


CREATE OR REPLACE FUNCTION public.fn_schema_proposal_apply(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_proposal     public.schema_proposals%ROWTYPE;
  v_payload      jsonb;
  v_new_prop_id  uuid;
  v_applies_to_kinds public.observation_kind[];
  v_expected_src public.source_category[];
BEGIN
  SELECT * INTO v_proposal FROM public.schema_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_schema_proposal_apply: proposal % not found', p_proposal_id;
  END IF;
  IF v_proposal.status <> 'approved' THEN
    RAISE EXCEPTION 'fn_schema_proposal_apply: proposal % is %, expected approved', p_proposal_id, v_proposal.status;
  END IF;

  v_payload := v_proposal.payload;

  IF v_proposal.proposal_type = 'add_property' THEN
    -- Convert array fields to typed arrays
    IF v_payload ? 'applies_to_kinds' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_payload->'applies_to_kinds'))::public.observation_kind[]
        INTO v_applies_to_kinds;
    END IF;
    IF v_payload ? 'expected_source_categories' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_payload->'expected_source_categories'))::public.source_category[]
        INTO v_expected_src;
    END IF;

    INSERT INTO public.observation_properties
      (property_key, label, data_type, unit, namespace, category,
       applies_to_kinds, cardinality, discriminator_key,
       expected_source_categories, description,
       proposed_by_proposal_id, ratified_at)
    VALUES (
      v_payload->>'property_key',
      v_payload->>'label',
      v_payload->>'data_type',
      v_payload->>'unit',
      COALESCE(v_payload->>'namespace_request', 'pending'),
      v_payload->>'category',
      v_applies_to_kinds,
      COALESCE(v_payload->>'cardinality', 'single'),
      v_payload->>'discriminator_key',
      v_expected_src,
      v_payload->>'description',
      p_proposal_id,
      CASE WHEN COALESCE(v_payload->>'namespace_request','pending') = 'core' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_new_prop_id;

    UPDATE public.schema_proposals SET promoted_to_id = v_new_prop_id WHERE id = p_proposal_id;

  ELSIF v_proposal.proposal_type = 'add_observation_kind' THEN
    -- ALTER TYPE … ADD VALUE … inside a transaction is allowed in PG 12+ but
    -- the new value cannot be used in the same transaction. The trigger
    -- transaction commits when the review is committed, after which the
    -- value is available. Idempotent via IF NOT EXISTS.
    EXECUTE format(
      'ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS %L',
      v_payload->>'kind_value'
    );

  ELSE
    -- Other proposal types are recorded as approved but not auto-applied.
    -- A curator runs the migration manually. Decision_rationale stays
    -- editable; this function does not overwrite it.
    UPDATE public.schema_proposals
       SET decision_rationale = COALESCE(decision_rationale, '') ||
           E'\nAuto-apply skipped: proposal_type ' || v_proposal.proposal_type ||
           ' requires manual application by a curator.'
     WHERE id = p_proposal_id;
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_schema_proposal_apply(uuid) IS
  'Executes the deterministic schema change for an approved proposal. add_property → INSERT into observation_properties. add_observation_kind → ALTER TYPE ADD VALUE. Other types are marked approved but require manual application.';


CREATE OR REPLACE FUNCTION public.fn_schema_proposal_review_handler()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_proposal_type text;
  v_current_status text;
  v_required int;
  v_approves int;
  v_rejects int;
  v_distinct_approvers int;
BEGIN
  SELECT proposal_type, status
    INTO v_proposal_type, v_current_status
    FROM public.schema_proposals
   WHERE id = NEW.proposal_id
   FOR UPDATE;

  -- Already resolved? Don't re-evaluate.
  IF v_current_status IN ('approved','rejected','withdrawn','superseded') THEN
    RETURN NEW;
  END IF;

  v_required := public.fn_schema_proposal_required_approvals(v_proposal_type);

  -- Any reject short-circuits.
  SELECT count(*) INTO v_rejects
    FROM public.schema_proposal_reviews
   WHERE proposal_id = NEW.proposal_id AND decision = 'reject';

  IF v_rejects > 0 THEN
    UPDATE public.schema_proposals
       SET status = 'rejected', resolved_at = now()
     WHERE id = NEW.proposal_id;
    RETURN NEW;
  END IF;

  -- Count distinct approving reviewers (defends against same curator double-tap)
  SELECT count(DISTINCT reviewer_user_id) INTO v_distinct_approvers
    FROM public.schema_proposal_reviews
   WHERE proposal_id = NEW.proposal_id AND decision = 'approve';

  IF v_distinct_approvers >= v_required THEN
    UPDATE public.schema_proposals
       SET status = 'approved', resolved_at = now()
     WHERE id = NEW.proposal_id;
    PERFORM public.fn_schema_proposal_apply(NEW.proposal_id);
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_schema_proposal_review_handler() IS
  'AFTER INSERT trigger on schema_proposal_reviews. Re-evaluates the parent proposal: short-circuits on any reject; promotes to approved when distinct-approver count meets quorum per proposal_type; calls fn_schema_proposal_apply on promotion. Idempotent (skips already-resolved proposals).';


DROP TRIGGER IF EXISTS trg_schema_proposal_review_after_insert
  ON public.schema_proposal_reviews;
CREATE TRIGGER trg_schema_proposal_review_after_insert
  AFTER INSERT ON public.schema_proposal_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_schema_proposal_review_handler();


NOTIFY pgrst, 'reload schema';

COMMIT;

-- =========================================================================
-- Rollback (commented)
-- =========================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_schema_proposal_review_after_insert ON public.schema_proposal_reviews;
-- DROP FUNCTION IF EXISTS public.fn_schema_proposal_review_handler();
-- DROP FUNCTION IF EXISTS public.fn_schema_proposal_apply(uuid);
-- DROP FUNCTION IF EXISTS public.fn_schema_proposal_required_approvals(text);
-- COMMIT;
