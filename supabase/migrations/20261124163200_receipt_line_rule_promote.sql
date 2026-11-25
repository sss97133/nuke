-- How a receipt line rule is accepted without an agent typing into a function and without the owner reviewing:
-- a proposed receipt_line_rules row is promoted by a measured gate, and the measurement is stored on the row.
--
-- Why not schema_proposals: its review step needs a reviewer_user_id (an auth user) and an unknown proposal_type
-- needs 9999 approvals (fn_schema_proposal_required_approvals); the owner reviews nothing. The gate below is the
-- reviewer, and its record is the rule row itself (promotion_measure), readable beside the rule.
--
-- What this adds (additive; revert: supabase/sql/revert_20261124163200_receipt_line_rule_promote.sql):
--   receipt_line_rule_promote(rule_id)  for a proposed rule: activates it (and retires the rule it names in
--     supersedes_rule_id) inside a subtransaction, classifies every live vehicle-linked receipt line before and after,
--     and keeps the change only when
--       1. it fills at least one line that had no key of its classifier,
--       2. every line it fills is one of its evidence_item_ids (a rule reaches only lines its proposer cited; later
--          lines it matches are what it was written for),
--       3. it changes no line that already had a key, except lines the superseded rule keyed.
--     Otherwise the rule is set rejected. Either way promotion_measure records lines compared, filled, changed, the
--     reasons and the item ids. A taken priority is a rejection with its reason; a pattern that does not compile never
--     lands (receipt_line_rules_check_pattern).
--   receipt_line_rule_propose(...)      inserts a proposed rule (proposer named) and runs the gate in one call.
-- Both are service role only. Contract: supabase/sql/test_receipt_line_rules.sql (section "promote").

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE FUNCTION public.receipt_line_rule_promote(p_rule_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $f$
DECLARE
  r public.receipt_line_rules%ROWTYPE;
  n_compared int;
  n_filled int := 0;
  n_changed int := 0;
  n_changed_outside int := 0;
  filled_ids uuid[] := '{}';
  beyond_ids uuid[] := '{}';
  missed_evidence uuid[] := '{}';
  changed_ids uuid[] := '{}';
  reasons text[] := '{}';
  measure jsonb;
BEGIN
  SELECT * INTO r FROM public.receipt_line_rules WHERE rule_id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_line_rule_promote: no rule %', p_rule_id; END IF;
  IF r.status <> 'proposed' THEN
    RAISE EXCEPTION 'receipt_line_rule_promote: rule % is %, not proposed', p_rule_id, r.status;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rlr_lines (item_id uuid, description text, part_number text, vendor text,
                                              make text, year int, before_rule text, before_key text) ON COMMIT DROP;
  TRUNCATE _rlr_lines;
  INSERT INTO _rlr_lines
  SELECT i.id, i.description, i.part_number, r2.vendor_name, v.make, v.year, h.rule_id, h.output_key
    FROM public.receipt_items i
    JOIN public.receipts r2 ON r2.id = i.receipt_id
    JOIN public.receipt_vehicle_links l ON l.receipt_id = r2.id AND l.status = 'linked' AND l.retired_at IS NULL
    JOIN public.vehicles v ON v.id = l.vehicle_id
    LEFT JOIN LATERAL public.receipt_line_rule_hit(r.classifier, i.description, i.part_number, r2.vendor_name, v.make, v.year) h ON true
   WHERE r2.is_superseded IS NOT TRUE AND r2.duplicate_of IS NULL
     AND NOT public.receipt_doc_kind_quoted(r2.document_kind)
     AND NOT public.receipt_doc_kind_excluded(r2.document_kind);
  SELECT count(*) INTO n_compared FROM _rlr_lines;

  BEGIN
    IF r.supersedes_rule_id IS NOT NULL THEN
      UPDATE public.receipt_line_rules SET status = 'retired', retired_at = now()
       WHERE rule_id = r.supersedes_rule_id AND status = 'active';
      IF NOT FOUND THEN reasons := array_append(reasons, 'superseded_rule_not_active'); END IF;
    END IF;
    UPDATE public.receipt_line_rules SET status = 'active', promoted_at = now() WHERE rule_id = p_rule_id;

    WITH a AS (
      SELECT x.item_id, x.before_rule, x.before_key, h.output_key AS after_key
        FROM _rlr_lines x
        LEFT JOIN LATERAL public.receipt_line_rule_hit(r.classifier, x.description, x.part_number, x.vendor, x.make, x.year) h ON true
    )
    SELECT count(DISTINCT item_id) FILTER (WHERE before_key IS NULL AND after_key IS NOT NULL),
           count(DISTINCT item_id) FILTER (WHERE before_key IS NOT NULL AND after_key IS DISTINCT FROM before_key),
           count(DISTINCT item_id) FILTER (WHERE before_key IS NOT NULL AND after_key IS DISTINCT FROM before_key
                                             AND before_rule IS DISTINCT FROM r.supersedes_rule_id),
           coalesce(array_agg(DISTINCT item_id) FILTER (WHERE before_key IS NULL AND after_key IS NOT NULL), '{}'),
           coalesce(array_agg(DISTINCT item_id) FILTER (WHERE before_key IS NOT NULL AND after_key IS DISTINCT FROM before_key), '{}')
      INTO n_filled, n_changed, n_changed_outside, filled_ids, changed_ids
      FROM a;

    SELECT coalesce(array_agg(f), '{}') INTO beyond_ids FROM unnest(filled_ids) f WHERE f <> ALL (r.evidence_item_ids);
    SELECT coalesce(array_agg(e), '{}') INTO missed_evidence FROM unnest(r.evidence_item_ids) e WHERE e <> ALL (filled_ids);

    IF cardinality(r.evidence_item_ids) = 0 THEN reasons := array_append(reasons, 'no_evidence_item_ids'); END IF;
    IF n_filled = 0 THEN reasons := array_append(reasons, 'fills_no_line'); END IF;
    IF cardinality(beyond_ids) > 0 THEN reasons := array_append(reasons, 'fills_lines_not_in_evidence'); END IF;
    IF cardinality(missed_evidence) > 0 THEN reasons := array_append(reasons, 'evidence_line_not_filled'); END IF;
    IF n_changed_outside > 0 THEN reasons := array_append(reasons, 'changes_classified_lines'); END IF;

    IF cardinality(reasons) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'RL001', MESSAGE = 'gate refused';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'RL001' THEN NULL;
    WHEN unique_violation THEN reasons := array_append(reasons, 'priority_taken');
    WHEN check_violation THEN reasons := array_append(reasons, ('check_violation: ' || SQLERRM));
  END;

  measure := jsonb_build_object(
    'basis', 'receipt_line_rule_promote', 'measured_at', now(),
    'population', 'live vehicle-linked receipt lines (item x vehicle), not superseded, duplicate, quote or excluded kind',
    'lines_compared', n_compared, 'lines_filled', n_filled, 'lines_changed', n_changed,
    'lines_changed_outside_superseded', n_changed_outside,
    'filled_item_ids', to_jsonb(filled_ids), 'changed_item_ids', to_jsonb(changed_ids),
    'filled_beyond_evidence_item_ids', to_jsonb(beyond_ids), 'evidence_not_filled_item_ids', to_jsonb(missed_evidence),
    'decision', CASE WHEN cardinality(reasons) = 0 THEN 'promoted' ELSE 'rejected' END,
    'reasons', to_jsonb(reasons));

  IF cardinality(reasons) = 0 THEN
    UPDATE public.receipt_line_rules SET promotion_measure = measure WHERE rule_id = p_rule_id;
  ELSE
    UPDATE public.receipt_line_rules SET status = 'rejected', promoted_at = NULL, promotion_measure = measure
     WHERE rule_id = p_rule_id;
  END IF;
  RETURN measure;
END $f$;
COMMENT ON FUNCTION public.receipt_line_rule_promote(text) IS
  'Gate for a proposed receipt_line_rules row: promoted only if it fills >= 1 live vehicle-linked line, every line it fills is in its evidence_item_ids, and it changes no keyed line except those of the rule it supersedes; else rejected. The measurement is stored in promotion_measure.';

CREATE FUNCTION public.receipt_line_rule_propose(
  p_rule_id text, p_classifier text, p_priority int, p_pattern text, p_key text, p_source text,
  p_proposed_by_agent_key text, p_evidence_item_ids uuid[], p_field text DEFAULT 'description',
  p_scope_vendor_pattern text DEFAULT NULL, p_scope_make text DEFAULT NULL, p_scope_year_min int DEFAULT NULL,
  p_scope_year_max int DEFAULT NULL, p_supersedes_rule_id text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $f$
BEGIN
  INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, field, pattern, operation_code, system_key,
    scope_vendor_pattern, scope_make, scope_year_min, scope_year_max, status, source, proposed_by_agent_key,
    evidence_item_ids, supersedes_rule_id, note)
  VALUES (p_rule_id, p_classifier, p_priority, p_field, p_pattern,
          CASE WHEN p_classifier = 'labor_operation' THEN p_key END, CASE WHEN p_classifier = 'system' THEN p_key END,
          p_scope_vendor_pattern, p_scope_make, p_scope_year_min, p_scope_year_max, 'proposed', p_source,
          p_proposed_by_agent_key, coalesce(p_evidence_item_ids, '{}'), p_supersedes_rule_id, p_note);
  RETURN public.receipt_line_rule_promote(p_rule_id);
END $f$;
COMMENT ON FUNCTION public.receipt_line_rule_propose(text, text, int, text, text, text, text, uuid[], text, text, text, int, int, text, text) IS
  'Insert a proposed receipt_line_rules row and run receipt_line_rule_promote on it; returns the gate measurement.';

REVOKE ALL ON FUNCTION public.receipt_line_rule_promote(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_line_rule_propose(text, text, int, text, text, text, text, uuid[], text, text, text, int, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_line_rule_promote(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.receipt_line_rule_propose(text, text, int, text, text, text, text, uuid[], text, text, text, int, int, text, text) TO service_role;
