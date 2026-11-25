-- receipt_line_rule_narrowing_v1 + receipt_line_kind_rule_v1: a rule gate that can narrow, and a line_kind classifier.
--
-- WHY. Measured live 2026-11-24 on the proof vehicle:
--   (1) receipt item dea22d75 (a rear body panel to bumper brace) is classified BODY-RUST-PANEL by the active rule
--       op.200.body-rust-panel, so vehicle_labor_appraisal prices it as a welded panel section (one of 7 per-piece
--       panels in body_metal). receipt_line_rule_promote cannot fix that through a rule row: a superseding rule that
--       only unclassifies lines fills none, so the gate refuses it (fills_no_line, evidence_line_not_filled).
--   (2) Which receipt line is a return was a regex inside the labor reader's body ('\mreturn', not core), invisible
--       to every other reader and to the rule gate. Fleet, the same day: 4 live vehicle-linked lines match it, all
--       negative charges, all on one vehicle.
--
-- WHAT CHANGES.
--   (a) receipt_line_rule_promote, NARROWING mode: a proposed rule that supersedes an active rule and fills no line is
--       a narrowing. It is promoted only when the lines it changes are exactly its evidence_item_ids, every one of
--       them was keyed by the superseded rule, and none of them is keyed by any rule afterwards (no reclassification
--       hides in a narrowing). New reasons: unclassifies_lines_not_in_evidence, evidence_line_not_unclassified,
--       narrowing_reclassifies. promotion_measure gains mode ('filling' | 'narrowing'). Filling rules are gated as
--       before, unchanged.
--   (b) receipt_line_rules gains classifier 'line_kind' with output column line_kind (CHECK IN ('return')); the output
--       CHECK gains its branch; receipt_line_rule_propose writes p_key to line_kind for that classifier;
--       receipt_line_rule_hit returns coalesce(operation_code, system_key, line_kind).
-- The labor reader moves its return test onto these rows in the next migration (20261124222000); until then it keeps
-- its own regex, so nothing changes for any reader at this deploy.
-- No rule row is written here: the two rules (op.200.body-rust-panel.no-brace, line_kind.100.return) go through
-- receipt_line_rule_propose after deploy, and their stored gate measurement is the record.
-- Test: supabase/sql/test_receipt_line_rules.sql (PG17), section 20261124221500.
--
-- REVERT. Swap each anchor and replacement below and EXECUTE the three bodies; retire the line_kind rules and move
-- their rows out (the restored classifier CHECK cannot hold them); drop column line_kind; restore the two CHECKs.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- (b) table
ALTER TABLE public.receipt_line_rules ADD COLUMN IF NOT EXISTS line_kind text
  CONSTRAINT receipt_line_rules_line_kind_check CHECK (line_kind IN ('return'));
COMMENT ON COLUMN public.receipt_line_rules.line_kind IS
  'Output of a line_kind rule: what kind of line this is beyond part/labor (return = the line sends a bought part back). NULL for other classifiers.';
ALTER TABLE public.receipt_line_rules DROP CONSTRAINT receipt_line_rules_classifier_check;
ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_classifier_check
  CHECK (classifier IN ('labor_operation', 'system', 'line_kind'));
ALTER TABLE public.receipt_line_rules DROP CONSTRAINT receipt_line_rules_output;
ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_output CHECK (
  (classifier = 'labor_operation' AND operation_code IS NOT NULL AND system_key IS NULL AND line_kind IS NULL)
  OR (classifier = 'system' AND system_key IS NOT NULL AND operation_code IS NULL AND line_kind IS NULL)
  OR (classifier = 'line_kind' AND line_kind IS NOT NULL AND operation_code IS NULL AND system_key IS NULL));

-- (b) hit + propose, (a) promote: anchored patches of the live bodies
DO $patch$
DECLARE
  d text;
  n integer;
  i integer;
  fn text;
  fns text[] := ARRAY['public.receipt_line_rule_hit(text, text, text, text, text, integer)',
                      'public.receipt_line_rule_propose(text, text, integer, text, text, text, text, uuid[], text, text, text, integer, integer, text, text)',
                      'public.receipt_line_rule_promote(text)'];
  anchors text[];
  repls text[];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    d := pg_get_functiondef(fn::regprocedure);
    CONTINUE WHEN position('receipt_line_kind_rule_v1' IN d) > 0 OR position('receipt_line_rule_narrowing_v1' IN d) > 0;
    IF fn LIKE 'public.receipt_line_rule_hit%' THEN
      anchors := ARRAY[$a$coalesce(x.operation_code, x.system_key) AS k,$a$];
      repls := ARRAY[$r$coalesce(x.operation_code, x.system_key, x.line_kind) AS k, /* receipt_line_kind_rule_v1 */$r$];
    ELSIF fn LIKE 'public.receipt_line_rule_propose%' THEN
      anchors := ARRAY[$a$operation_code, system_key,
    scope_vendor_pattern,$a$,
                       $a$CASE WHEN p_classifier = 'system' THEN p_key END,$a$];
      repls := ARRAY[$r$operation_code, system_key, line_kind, /* receipt_line_kind_rule_v1 */
    scope_vendor_pattern,$r$,
                     $r$CASE WHEN p_classifier = 'system' THEN p_key END,
          CASE WHEN p_classifier = 'line_kind' THEN p_key END,$r$];
    ELSE
      anchors := ARRAY[
        $a$  measure jsonb;
$a$,
        $a$    IF n_filled = 0 THEN reasons := array_append(reasons, 'fills_no_line'); END IF;
$a$,
        $a$    IF cardinality(missed_evidence) > 0 THEN reasons := array_append(reasons, 'evidence_line_not_filled'); END IF;
$a$,
        $a$    'decision', CASE WHEN cardinality(reasons) = 0 THEN 'promoted' ELSE 'rejected' END,$a$];
      repls := ARRAY[
        $r$  measure jsonb;
  narrowing boolean := false;  -- receipt_line_rule_narrowing_v1
  n_still_keyed int := 0;
$r$,
        $r$    -- receipt_line_rule_narrowing_v1: a superseding rule that fills nothing narrows the rule it replaces. It may
    -- only unkey exactly its evidence lines, each keyed before by the superseded rule, and none may be keyed after.
    narrowing := r.supersedes_rule_id IS NOT NULL AND n_filled = 0;
    IF narrowing THEN
      SELECT count(DISTINCT x.item_id) INTO n_still_keyed
        FROM _rlr_lines x
        CROSS JOIN LATERAL public.receipt_line_rule_hit(r.classifier, x.description, x.part_number, x.vendor, x.make, x.year) h
       WHERE x.item_id = ANY (changed_ids) AND h.output_key IS NOT NULL;
      IF n_changed = 0 THEN reasons := array_append(reasons, 'fills_no_line'); END IF;
      IF EXISTS (SELECT FROM unnest(changed_ids) c WHERE c <> ALL (r.evidence_item_ids)) THEN
        reasons := array_append(reasons, 'unclassifies_lines_not_in_evidence'); END IF;
      IF EXISTS (SELECT FROM unnest(r.evidence_item_ids) e WHERE e <> ALL (changed_ids)) THEN
        reasons := array_append(reasons, 'evidence_line_not_unclassified'); END IF;
      IF n_still_keyed > 0 THEN reasons := array_append(reasons, 'narrowing_reclassifies'); END IF;
    ELSIF n_filled = 0 THEN reasons := array_append(reasons, 'fills_no_line'); END IF;
$r$,
        $r$    IF NOT narrowing AND cardinality(missed_evidence) > 0 THEN reasons := array_append(reasons, 'evidence_line_not_filled'); END IF;
$r$,
        $r$    'mode', CASE WHEN narrowing THEN 'narrowing' ELSE 'filling' END,
    'decision', CASE WHEN cardinality(reasons) = 0 THEN 'promoted' ELSE 'rejected' END,$r$];
    END IF;
    FOR i IN 1 .. array_length(anchors, 1) LOOP
      n := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
      IF n <> 1 THEN RAISE EXCEPTION '% anchor % drifted: % matches', fn, i, n; END IF;
      d := replace(d, anchors[i], repls[i]);
    END LOOP;
    EXECUTE d;
  END LOOP;
END $patch$;

COMMENT ON FUNCTION public.receipt_line_rule_promote(text) IS
  'Gate for a proposed receipt_line_rules row. Filling (default): promoted only if it fills >= 1 live vehicle-linked line, every line it fills is in its evidence_item_ids, and it changes no keyed line except those of the rule it supersedes. Narrowing (supersedes a rule, fills nothing): promoted only if the lines it unkeys are exactly its evidence_item_ids, all keyed before by the superseded rule, none keyed after. Else rejected. The measurement, with its mode, is stored in promotion_measure.';

