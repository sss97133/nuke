-- Disposable PG17: receipt_line_witness_gate_v1 (migration 20261125100700), on top of the receipt line rules fixture.
-- Covers: no rule is demoted by the migration (no re-grade; the reader grades them unwitnessed); a new proposal without an independent witness
-- waits as 'proposed' (decision waiting_on_witness), not 'rejected'; the writer refuses a line the rule does not cite,
-- an unanswered or superseded verdict, a verdict about another line, a Claude answer for second_family_verdict, a
-- catalog part with another part number; a non-independent witness promotes nothing; the last independent witness
-- naming the key re-gates and promotes the rule, and its edge lands; a verdict naming another key promotes nothing; a
-- superseded, re-answered or deleted verdict lapses the rule back to waiting and removes its edge; a direct UPDATE or
-- INSERT to 'active' is refused; a provider-prefixed model name matches; the migration runs twice; anon cannot write.
-- Run from the repo root in an empty database named dm_refinement_<name>. Synthetic fixtures only.
\set ON_ERROR_STOP on
\ir test_receipt_line_rules.sql
RESET ROLE;

-- The live columns the writer reads (the rules fixture has a narrower evidence_judgment_requests, no catalog_parts).
ALTER TABLE public.evidence_judgment_requests
  ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS answer jsonb, ADD COLUMN IF NOT EXISTS answer_model text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid, ADD COLUMN IF NOT EXISTS receipt_item_id uuid,
  ADD COLUMN IF NOT EXISTS subject_id uuid;
-- guardrail-allow(center-key-fk): catalog_parts: disposable fixture with the live columns the writer reads
CREATE TABLE public.catalog_parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text);

CREATE TABLE public._before AS
SELECT rule_id, classifier, status,
       (status = 'active' AND promotion_measure->>'basis' = 'receipt_line_rule_promote'
        AND coalesce(promotion_measure->>'mode', 'filling') = 'filling'
        AND classifier IN ('labor_operation', 'system')) AS demote
  FROM public.receipt_line_rules;
SELECT public.assert((SELECT count(*) FROM public._before WHERE demote) > 0, 'fixture has gate-promoted filling rules');

\i supabase/migrations/20261125100700_receipt_line_witness_gate.sql
\i supabase/migrations/20261125100700_receipt_line_witness_gate.sql

-- No re-grade: every rule keeps its status; the reader grades the gate-promoted filling op/system rules unwitnessed.
SELECT public.assert(r.status = b.status, 'held: ' || r.rule_id)
  FROM public.receipt_line_rules r JOIN public._before b USING (rule_id);
SELECT public.assert(s.witness_grade = 'unwitnessed' AND cardinality(s.unwitnessed_item_ids) > 0, 'graded: ' || s.rule_id)
  FROM public.receipt_line_rules_witness_state s JOIN public._before b USING (rule_id) WHERE b.demote;
SELECT public.assert(s.witness_grade = 'not_required', 'line_kind not required: ' || s.rule_id)
  FROM public.receipt_line_rules_witness_state s WHERE s.classifier = 'line_kind';
-- The model pattern takes a provider prefix and refuses Claude.
SELECT public.assert('openai/gpt-5' ~ answer_model_pattern AND 'gpt-5' ~ answer_model_pattern
                     AND 'google/gemini-3-pro' ~ answer_model_pattern AND NOT 'claude-opus-5-5' ~ answer_model_pattern
                     AND NOT 'anthropic/claude-sonnet-5-5' ~ answer_model_pattern, 'model pattern')
  FROM public.receipt_line_witness_classes WHERE witness_class = 'second_family_verdict';
SELECT public.assert(position('receipt_line_witness_gate_v1' IN pg_get_functiondef('public.receipt_line_rule_promote(text)'::regprocedure)) > 0,
                     'gate patched');

-- A new filling proposal with no witness waits.
INSERT INTO public.labor_operations (code, base_hours) VALUES ('TRIM-WITNESS-TEST', 1) ON CONFLICT DO NOTHING;
INSERT INTO public.receipt_items (id, receipt_id, description, part_number)
SELECT '00000000-0000-0000-0000-00000000f001', i.receipt_id, 'wiper arm assembly', 'WA-100'
  FROM public.receipt_items i WHERE i.id = '00000000-0000-0000-0000-0000000000c2';
SELECT public.assert(m->>'decision' = 'waiting_on_witness' AND m->'reasons' = '["evidence_line_without_independent_witness"]'
                     AND m->'unwitnessed_item_ids' ? '00000000-0000-0000-0000-00000000f001', 'waits: ' || m::text)
  FROM public.receipt_line_rule_propose('op.900.wiper', 'labor_operation', 900, '\ywiper arm\y', 'TRIM-WITNESS-TEST',
         'test: wiper', 'test', ARRAY['00000000-0000-0000-0000-00000000f001']::uuid[]) m;
SELECT public.assert(status = 'proposed', 'waiting rule stays proposed') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- A broad rule still is rejected, not waiting.
SELECT public.assert(m->>'decision' = 'rejected', 'broad still rejected: ' || m::text)
  FROM public.receipt_line_rule_propose('op.910.any', 'labor_operation', 910, '.', 'TRIM-WITNESS-TEST', 'test', 'test',
         ARRAY['00000000-0000-0000-0000-00000000f001']::uuid[]) m;

-- Verdict rows.
INSERT INTO public.evidence_judgment_requests (id, question_kind, status, answer, answer_model, receipt_item_id, superseded_by) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'receipt_line_key', 'answered', '{"key":"TRIM-WITNESS-TEST"}', 'claude-opus-5-5', '00000000-0000-0000-0000-00000000f001', NULL),
  ('00000000-0000-0000-0000-00000000e002', 'receipt_line_key', 'pending',  NULL, NULL, '00000000-0000-0000-0000-00000000f001', NULL),
  ('00000000-0000-0000-0000-00000000e003', 'receipt_line_key', 'answered', '{"key":"TRIM-WITNESS-TEST"}', 'gpt-5', '00000000-0000-0000-0000-0000000000c2', NULL),
  ('00000000-0000-0000-0000-00000000e004', 'receipt_line_key', 'answered', '{"key":"TRIM-WITNESS-TEST"}', 'gpt-5', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-00000000e005', 'receipt_part_visible', 'answered', '{"installed":"yes"}', 'claude-opus-5-5', '00000000-0000-0000-0000-00000000f001', NULL),
  ('00000000-0000-0000-0000-00000000e006', 'receipt_line_key', 'answered', '{"key":"TRIM-WITNESS-TEST"}', 'gemini-3-pro', '00000000-0000-0000-0000-00000000f001', NULL),
  ('00000000-0000-0000-0000-00000000e007', 'receipt_line_key', 'answered', '{"key":"OTHER-OP"}', 'gpt-5', '00000000-0000-0000-0000-00000000f001', NULL),
  ('00000000-0000-0000-0000-00000000e008', 'receipt_line_key', 'answered', '{"key":"TRIM-WITNESS-TEST"}', 'openai/gpt-5', '00000000-0000-0000-0000-00000000f001', NULL);
INSERT INTO public.catalog_parts (id, part_number) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'wa 100'), ('00000000-0000-0000-0000-00000000ca02', 'WA-999');

CREATE FUNCTION public.refuses_priv(sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; RAISE EXCEPTION 'FAIL: accepted: %', sql;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
CREATE FUNCTION public.refuses(sql text, needle text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; RAISE EXCEPTION 'FAIL: accepted: %', sql;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' OR position(needle IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-0000000000c2', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e003')$$, 'not cited');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e001')$$, 'is not of class');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e002')$$, 'not an answered');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e004')$$, 'not an answered');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e005')$$, 'needs a receipt_line_key');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'catalog_part_number', '00000000-0000-0000-0000-00000000ca02', NULL)$$, 'part number');
SELECT public.refuses($$SELECT public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'catalog_part_number', NULL, '00000000-0000-0000-0000-00000000e006')$$, 'takes catalog_part_id');

-- Witnesses that are not independent land and promote nothing.
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'catalog_part_number', '00000000-0000-0000-0000-00000000ca01', NULL) IS NOT NULL, 'catalog witness lands');
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'part_fitted_in_photo', NULL, '00000000-0000-0000-0000-00000000e005') IS NOT NULL, 'fitted witness lands');
SELECT public.assert(status = 'proposed', 'non-independent witnesses promote nothing') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- An independent verdict naming another key lands and promotes nothing.
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e007') IS NOT NULL, 'other-key witness lands');
SELECT public.assert(status = 'proposed', 'other key promotes nothing') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- Direct writes cannot skip the gate, as postgres (the test's role) and as service_role.
SELECT public.refuses_priv($$UPDATE public.receipt_line_rules SET status = 'active' WHERE rule_id = 'op.900.wiper'$$);
-- The skeptic's one line: an active rule's pattern rewritten while it stays active.
SELECT public.refuses_priv(format($$UPDATE public.receipt_line_rules SET status = 'active', pattern = '.' WHERE rule_id = %L$$,
                                  (SELECT rule_id FROM public.receipt_line_rules WHERE status = 'active' AND classifier = 'labor_operation' LIMIT 1)));
SELECT public.refuses_priv(format($$UPDATE public.receipt_line_rules SET evidence_item_ids = evidence_item_ids || '00000000-0000-0000-0000-00000000dead'::uuid WHERE rule_id = %L$$,
                                  (SELECT rule_id FROM public.receipt_line_rules WHERE status = 'active' AND classifier = 'system' LIMIT 1)));
SELECT rule_id AS active_op FROM public.receipt_line_rules WHERE status = 'active' AND classifier = 'labor_operation' LIMIT 1 \gset
SET ROLE service_role;
SELECT public.refuses_priv(format($$UPDATE public.receipt_line_rules SET status = 'active', pattern = '.' WHERE rule_id = %L$$, :'active_op'));
SELECT public.refuses_priv($$DELETE FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper'$$);
RESET ROLE;
-- Leaving active stays open (a retire or a lapse is never a promotion), and so does the gate's own measure.
BEGIN;
UPDATE public.receipt_line_rules SET status = 'retired', retired_at = now()
 WHERE rule_id = (SELECT rule_id FROM public.receipt_line_rules WHERE status = 'active' AND classifier = 'system' LIMIT 1);
ROLLBACK;
SELECT public.assert(NOT has_table_privilege('service_role', 'public.receipt_line_rules', 'UPDATE')
                     AND NOT has_table_privilege('service_role', 'public.receipt_line_rules', 'INSERT')
                     AND NOT has_table_privilege('service_role', 'public.receipt_line_rules', 'DELETE'), 'service_role cannot write rules');
SELECT public.refuses_priv($$INSERT INTO public.receipt_line_rules (rule_id, classifier, priority, pattern, operation_code, status, source)
                             VALUES ('op.990.direct', 'labor_operation', 990, '\ydirect\y', 'TRIM-WITNESS-TEST', 'active', 'test')$$);
-- The independent one naming the key re-gates and promotes; its edge lands.
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e006') IS NOT NULL, 'independent witness lands');
SELECT public.assert(status = 'active' AND promotion_measure->>'decision' = 'promoted', 'promoted on its witness: ' || promotion_measure::text)
  FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
SELECT public.assert(EXISTS (SELECT 1 FROM public.receipt_line_edges WHERE receipt_item_id = '00000000-0000-0000-0000-00000000f001'
                                AND rule_id = 'op.900.wiper' AND operation_code = 'TRIM-WITNESS-TEST'), 'edge landed');
-- The same witness twice is one row.
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e006') IS NULL, 'idempotent');
SELECT public.assert(witness_grade = 'witnessed', 'reader: witnessed') FROM public.receipt_line_rules_witness_state WHERE rule_id = 'op.900.wiper';

-- Lapse 1: the verdict is superseded. The rule waits again and its edge goes.
UPDATE public.evidence_judgment_requests SET superseded_by = '00000000-0000-0000-0000-00000000e008' WHERE id = '00000000-0000-0000-0000-00000000e006';
SELECT public.assert(status = 'proposed' AND promoted_at IS NULL AND promotion_measure->>'decision' = 'waiting_on_witness'
                     AND promotion_measure->'lapsed' IS NOT NULL, 'lapsed on supersede: ' || promotion_measure::text)
  FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.receipt_line_edges WHERE rule_id = 'op.900.wiper'), 'edge gone on lapse');
-- A current second-family verdict (provider-prefixed name) promotes it again.
SELECT public.assert(public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e008') IS NOT NULL, 'prefixed witness lands');
SELECT public.assert(status = 'active', 'promoted again') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- Lapse 2: the verdict's answer changes to another key.
UPDATE public.evidence_judgment_requests SET answer = '{"key":"OTHER-OP"}' WHERE id = '00000000-0000-0000-0000-00000000e008';
SELECT public.assert(status = 'proposed', 'lapsed on answer change') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
UPDATE public.evidence_judgment_requests SET answer = '{"key":"TRIM-WITNESS-TEST"}' WHERE id = '00000000-0000-0000-0000-00000000e008';
SELECT public.assert(status = 'proposed', 'a restored answer does not promote by itself') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
SELECT public.receipt_line_rule_promote('op.900.wiper');
SELECT public.assert(status = 'active', 'gate promotes on the current witness') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- Lapse 3: the verdict row is deleted (the witness goes by cascade).
DELETE FROM public.evidence_judgment_requests WHERE id = '00000000-0000-0000-0000-00000000e008';
SELECT public.assert(status = 'proposed' AND NOT EXISTS (SELECT 1 FROM public.receipt_line_edges WHERE rule_id = 'op.900.wiper'),
                     'lapsed on delete') FROM public.receipt_line_rules WHERE rule_id = 'op.900.wiper';
-- Lapse never touches a rule the gate did not promote.
SELECT public.assert(public.receipt_line_rule_witness_lapse(ARRAY(SELECT rule_id FROM public._before)) = 0, 'legacy rules never lapse');

-- Grants.
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.receipt_line_rule_witness_record('op.900.wiper', '00000000-0000-0000-0000-00000000f001', 'second_family_verdict', NULL, '00000000-0000-0000-0000-00000000e006');
    RAISE EXCEPTION 'FAIL: anon wrote a witness';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.receipt_line_rule_witnesses;
    RAISE EXCEPTION 'FAIL: anon read witnesses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo test_receipt_line_witness_gate: PASS
