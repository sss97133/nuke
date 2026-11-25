-- receipt_line_witness_gate_v1: a receipt line rule that keys a system or a labor operation is promoted only when every
-- line it cites carries a keyed witness of an independent class that names the same key.
--
-- WHY. receipt_line_rule_promote (20261124163200) checks that a rule fills exactly the lines it cites, which is true
-- by construction for the proposer that wrote the pattern from those lines. Measured 2026-11-24 over the 14 rules it
-- promoted (op.300..op.430): evidence lines with an answered receipt_part_visible installed = yes 21 of 45, with a
-- catalog card 35, with a card name keyed to the same op 30. A fitted part witnesses the installation, not the
-- operation key; a card name matched by the same rule is a second document read by the same reader. Independent
-- readers: 0 of 14. Owner rule 2026-11-24: a value is promoted only through keyed witnesses of the classes its rule
-- row names (AGENTS.md, working language).
--
-- WHAT (rows, keys, gate):
--   receipt_line_witness_classes       witness_class -> independent, the reference it carries, the question kind
--                                       and answer_model pattern a verdict must have. Seeded: second_family_verdict
--                                       (independent: a non-Claude model's answered receipt_line_key verdict naming
--                                       the key; rule proposers run claude -p, so Claude is the proposer's family),
--                                       part_fitted_in_photo, catalog_part_number, catalog_card_name (not independent).
--   receipt_line_witness_requirements  classifier -> requires_independent. labor_operation and system: yes;
--                                       line_kind: no (a return or core credit is printed on the line itself).
--   receipt_line_rule_witnesses        (rule_id, receipt_item_id, witness_class) with a foreign key to the witness:
--                                       catalog_parts.id or evidence_judgment_requests.id, exactly one.
--   receipt_line_rule_witness_record() the only writer: checks the line is cited by the rule, the referenced row
--                                       exists and is what the class says (answered, not superseded, same line,
--                                       model family, same part number), and stores the key it names.
--   receipt_line_rule_promote          edited in place: in filling mode, an evidence line without an independent
--                                       witness naming the key adds reason evidence_line_without_independent_witness;
--                                       when that is the only reason the rule stays 'proposed' (decision
--                                       waiting_on_witness) instead of 'rejected'.
--   trigger on the witness table       a rule waiting on witnesses is re-gated when its last one lands.
--   receipt_line_rule_unwitnessed()   the one definition of "witnessed": the cited lines without a current witness of an
--                                       independent class on the requirement's axis naming the key. Current means the
--                                       verdict is still answered, not superseded, still names the key and its model still
--                                       matches the class. The gate, the re-gate, the lapse and the reader all call it.
--   lapse triggers                     a rule promoted through this gate goes back to 'proposed' (waiting_on_witness) when
--                                       a witness it relied on is deleted, or its verdict changes status, superseded_by,
--                                       answer or answer_model (AFTER DELETE on the witnesses; AFTER UPDATE on
--                                       evidence_judgment_requests, row level, WHEN one of those four changed).
--   receipt_line_rules_active_by_gate  BEFORE INSERT OR UPDATE, any writer and role: a row turns 'active', or an active
--                                       row changes a column that defines the rule (classifier, priority, field, pattern,
--                                       operation_code, system_key, line_kind, scope_*, evidence_item_ids,
--                                       supersedes_rule_id), only inside receipt_line_rule_promote (transaction-local
--                                       setting the gate sets around its own UPDATE). Leaving 'active' (retire, lapse) and
--                                       the gate's measure columns stay open.
--   grants                             service_role loses INSERT, UPDATE, DELETE, TRUNCATE on receipt_line_rules: the
--                                       writers (propose, promote, lapse) are SECURITY DEFINER. Consumer evidence:
--                                       pg_stat_statements (track = top, reset 2026-11-11 22:52Z, 135 deallocations) holds
--                                       10 statements on receipt_line_rules, all role postgres (migrations and reads);
--                                       none by service_role, authenticator, authenticated or anon.
--   receipt_line_rules_witness_state   reader: one row per rule with its witness grade (witnessed / unwitnessed /
--                                       not_required) and the unwitnessed line ids.
-- NO RE-GRADE. Rules active before this gate are not demoted: there is no path back up yet (0 answered receipt_line_key
-- verdicts on 2026-11-25, no asker, and the model-access check of 2026-11-20 found no second family answering). They
-- read as grade 'unwitnessed' in the reader (prediction at deploy: 56 active labor_operation/system rules, 0 witnessed;
-- the narrowing rule and the line_kind rule read not_required). Demotion of those waits for the asker and a
-- second-family answer route; it is a later migration, not this one.
--
-- REVERT. Swap the gate's replacements back (markers receipt_line_witness_gate_v1), drop the triggers, the functions,
-- the view and the three tables.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.receipt_line_witness_classes (
  witness_class        text    PRIMARY KEY CHECK (witness_class ~ '^[a-z][a-z0-9_]*$'),
  independent          boolean NOT NULL,
  ref_column           text    NOT NULL CHECK (ref_column IN ('catalog_part_id', 'judgment_request_id')),
  question_kind        text,
  answer_model_pattern text,
  answer_key_path      text[],
  independence_axis    text    CHECK (independence_axis IN ('reader_family', 'physical_source')),
  basis                text    NOT NULL CHECK (length(basis) >= 20),
  CHECK ((ref_column = 'judgment_request_id') = (question_kind IS NOT NULL)),
  CHECK (independent = (independence_axis IS NOT NULL)),
  CHECK (NOT independent OR ref_column = 'catalog_part_id' OR answer_key_path IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.receipt_line_witness_requirements (
  classifier           text    PRIMARY KEY CHECK (classifier IN ('labor_operation', 'system', 'line_kind')),
  requires_independent boolean NOT NULL,
  independence_axis    text    CHECK (independence_axis IN ('reader_family', 'physical_source')),
  basis                text    NOT NULL CHECK (length(basis) >= 20),
  CHECK (requires_independent = (independence_axis IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.receipt_line_rule_witnesses (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id             text        NOT NULL REFERENCES public.receipt_line_rules (rule_id) ON DELETE CASCADE,
  receipt_item_id     uuid        NOT NULL REFERENCES public.receipt_items (id) ON DELETE CASCADE,
  witness_class       text        NOT NULL REFERENCES public.receipt_line_witness_classes (witness_class),
  catalog_part_id     uuid        REFERENCES public.catalog_parts (id) ON DELETE CASCADE,
  judgment_request_id uuid        REFERENCES public.evidence_judgment_requests (id) ON DELETE CASCADE,
  witnessed_key       text,
  answer_model        text,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(catalog_part_id, judgment_request_id) = 1),
  UNIQUE NULLS NOT DISTINCT (rule_id, receipt_item_id, witness_class, catalog_part_id, judgment_request_id)
);
CREATE INDEX IF NOT EXISTS receipt_line_rule_witnesses_item ON public.receipt_line_rule_witnesses (receipt_item_id);
CREATE INDEX IF NOT EXISTS receipt_line_rule_witnesses_judgment ON public.receipt_line_rule_witnesses (judgment_request_id)
  WHERE judgment_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS receipt_line_rule_witnesses_catalog ON public.receipt_line_rule_witnesses (catalog_part_id)
  WHERE catalog_part_id IS NOT NULL;

ALTER TABLE public.receipt_line_witness_classes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_line_witness_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_line_rule_witnesses       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_line_witness_classes, public.receipt_line_witness_requirements,
              public.receipt_line_rule_witnesses FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.receipt_line_witness_classes, public.receipt_line_witness_requirements,
                public.receipt_line_rule_witnesses TO service_role;

INSERT INTO public.receipt_line_witness_classes
  (witness_class, independent, ref_column, question_kind, answer_model_pattern, answer_key_path, independence_axis, basis) VALUES
  ('second_family_verdict', true, 'judgment_request_id', 'receipt_line_key', '(^|/)(gpt|o[0-9]|gemini|grok)',
   ARRAY['key'], 'reader_family',
   'A second reader family: rule proposers run claude -p (AGENTS.md, model access), and two runs of one model are one reader.'),
  ('part_fitted_in_photo', false, 'judgment_request_id', 'receipt_part_visible', NULL, NULL, NULL,
   'installed = yes witnesses that the part was fitted, not which operation or system the line is.'),
  ('catalog_part_number', false, 'catalog_part_id', NULL, NULL, NULL, NULL,
   'A catalog row with the same part number; receipt-keyed catalog rows carry NULL category (measured 2026-11-24), so it names no key.'),
  ('catalog_card_name', false, 'catalog_part_id', NULL, NULL, NULL, NULL,
   'The card name matched by the same rule pattern is a second document read by the same reader.')
ON CONFLICT (witness_class) DO NOTHING;

INSERT INTO public.receipt_line_witness_requirements (classifier, requires_independent, independence_axis, basis) VALUES
  ('labor_operation', true, 'reader_family', 'An operation key is a reading of one line of one paper: the doubt is the reader, so a second reader family is the witness; the proposer that wrote the pattern cannot be its only witness.'),
  ('system', true, 'reader_family', 'A system key is a reading of one line of one paper: the doubt is the reader, so a second reader family is the witness; the proposer that wrote the pattern cannot be its only witness.'),
  ('line_kind', false, NULL, 'A return or core credit is printed on the line itself; the paper is the witness.')
ON CONFLICT (classifier) DO NOTHING;

-- The writer.
CREATE OR REPLACE FUNCTION public.receipt_line_rule_witness_record(p_rule_id text, p_receipt_item_id uuid,
    p_witness_class text, p_catalog_part_id uuid DEFAULT NULL, p_judgment_request_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE
  r public.receipt_line_rules%ROWTYPE;
  c public.receipt_line_witness_classes%ROWTYPE;
  j public.evidence_judgment_requests%ROWTYPE;
  v_key text; v_model text; v_id bigint; v_pn text; v_cpn text;
BEGIN
  SELECT * INTO r FROM public.receipt_line_rules WHERE rule_id = p_rule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_line_rule_witness_record: no rule %', p_rule_id; END IF;
  IF NOT p_receipt_item_id = ANY (r.evidence_item_ids) THEN
    RAISE EXCEPTION 'receipt_line_rule_witness_record: line % is not cited by rule %', p_receipt_item_id, p_rule_id;
  END IF;
  SELECT * INTO c FROM public.receipt_line_witness_classes WHERE witness_class = p_witness_class;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_line_rule_witness_record: no witness class %', p_witness_class; END IF;
  IF (c.ref_column = 'catalog_part_id') <> (p_catalog_part_id IS NOT NULL)
     OR (c.ref_column = 'judgment_request_id') <> (p_judgment_request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'receipt_line_rule_witness_record: class % takes %', p_witness_class, c.ref_column;
  END IF;

  IF p_judgment_request_id IS NOT NULL THEN
    SELECT * INTO j FROM public.evidence_judgment_requests WHERE id = p_judgment_request_id;
    IF NOT FOUND OR j.status IS DISTINCT FROM 'answered' OR j.superseded_by IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: % is not an answered, current verdict', p_judgment_request_id;
    END IF;
    IF j.question_kind IS DISTINCT FROM c.question_kind THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: class % needs a % question', p_witness_class, c.question_kind;
    END IF;
    IF p_receipt_item_id IS DISTINCT FROM coalesce(j.receipt_item_id, j.subject_id) THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: verdict % is about another line', p_judgment_request_id;
    END IF;
    IF c.answer_model_pattern IS NOT NULL AND coalesce(lower(j.answer_model), '') !~ c.answer_model_pattern THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: answer model % is not of class %', j.answer_model, p_witness_class;
    END IF;
    IF c.witness_class = 'part_fitted_in_photo' AND j.answer->>'installed' IS DISTINCT FROM 'yes' THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: verdict % does not say installed = yes', p_judgment_request_id;
    END IF;
    v_key := CASE WHEN c.answer_key_path IS NOT NULL THEN j.answer #>> c.answer_key_path END;
    v_model := j.answer_model;
  ELSE
    SELECT lower(regexp_replace(coalesce(i.part_number, ''), '[^A-Za-z0-9]', '', 'g')) INTO v_pn
      FROM public.receipt_items i WHERE i.id = p_receipt_item_id;
    SELECT lower(regexp_replace(coalesce(p.part_number, ''), '[^A-Za-z0-9]', '', 'g')) INTO v_cpn
      FROM public.catalog_parts p WHERE p.id = p_catalog_part_id;
    IF v_cpn IS NULL OR v_pn = '' OR v_pn IS DISTINCT FROM v_cpn THEN
      RAISE EXCEPTION 'receipt_line_rule_witness_record: catalog part % does not carry the line''s part number', p_catalog_part_id;
    END IF;
  END IF;

  INSERT INTO public.receipt_line_rule_witnesses
    (rule_id, receipt_item_id, witness_class, catalog_part_id, judgment_request_id, witnessed_key, answer_model)
  VALUES (p_rule_id, p_receipt_item_id, p_witness_class, p_catalog_part_id, p_judgment_request_id, v_key, v_model)
  ON CONFLICT (rule_id, receipt_item_id, witness_class, catalog_part_id, judgment_request_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_witness_record(text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_line_rule_witness_record(text, uuid, text, uuid, uuid) TO service_role;

-- The one definition of witnessed.
CREATE OR REPLACE FUNCTION public.receipt_line_rule_unwitnessed(p_rule_id text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
  SELECT coalesce(array_agg(e ORDER BY e), '{}')
    FROM public.receipt_line_rules r
    JOIN public.receipt_line_witness_requirements q ON q.classifier = r.classifier AND q.requires_independent
   CROSS JOIN LATERAL unnest(r.evidence_item_ids) e
   WHERE r.rule_id = p_rule_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.receipt_line_rule_witnesses w
         JOIN public.receipt_line_witness_classes c ON c.witness_class = w.witness_class
         LEFT JOIN public.evidence_judgment_requests j ON j.id = w.judgment_request_id
        WHERE w.rule_id = r.rule_id AND w.receipt_item_id = e
          AND c.independent AND c.independence_axis = q.independence_axis
          AND w.witnessed_key = coalesce(r.operation_code, r.system_key, r.line_kind)
          AND (w.judgment_request_id IS NULL
               OR (j.status = 'answered' AND j.superseded_by IS NULL
                   AND j.answer #>> c.answer_key_path = w.witnessed_key
                   AND (c.answer_model_pattern IS NULL
                        OR coalesce(lower(j.answer_model), '') ~ c.answer_model_pattern))))
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_unwitnessed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_line_rule_unwitnessed(text) TO service_role;

-- The gate, edited in place (other lanes edit it too, so it is not copied).
DO $patch$
DECLARE
  d text; n int;
  a1 text := E'  n_still_keyed int := 0;\n';
  r1 text := E'  n_still_keyed int := 0;\n  unwitnessed uuid[] := ''{}''; /* receipt_line_witness_gate_v1 */\n';
  a2 text := E'    IF n_changed_outside > 0 THEN reasons := array_append(reasons, ''changes_classified_lines''); END IF;\n';
  r2 text := $r$
    -- receipt_line_witness_gate_v1: every cited line needs a current independent witness naming the rule's key.
    IF NOT narrowing THEN
      unwitnessed := public.receipt_line_rule_unwitnessed(r.rule_id);
      IF cardinality(unwitnessed) > 0 THEN
        reasons := array_append(reasons, 'evidence_line_without_independent_witness');
      END IF;
    END IF;
$r$;
  a3 text := E'    ''mode'', CASE WHEN narrowing THEN ''narrowing'' ELSE ''filling'' END,\n';
  r3 text := E'    ''mode'', CASE WHEN narrowing THEN ''narrowing'' ELSE ''filling'' END,\n    ''unwitnessed_item_ids'', to_jsonb(unwitnessed),\n';
  a4 text := E'    ''decision'', CASE WHEN cardinality(reasons) = 0 THEN ''promoted'' ELSE ''rejected'' END,\n';
  r4 text := E'    ''decision'', CASE WHEN cardinality(reasons) = 0 THEN ''promoted''\n                       WHEN reasons = ARRAY[''evidence_line_without_independent_witness''] THEN ''waiting_on_witness''\n                       ELSE ''rejected'' END,\n';
  a5 text := E'    UPDATE public.receipt_line_rules SET status = ''rejected'', promoted_at = NULL, promotion_measure = measure\n';
  r5 text := E'    UPDATE public.receipt_line_rules\n       SET status = CASE WHEN reasons = ARRAY[''evidence_line_without_independent_witness''] THEN ''proposed'' ELSE ''rejected'' END,\n           promoted_at = NULL, promotion_measure = measure\n';
  a6 text := E'    UPDATE public.receipt_line_rules SET status = ''active'', promoted_at = now() WHERE rule_id = p_rule_id;\n';
  r6 text := E'    PERFORM set_config(''receipt_line_rules.promoting'', p_rule_id, true);  /* receipt_line_witness_gate_v1 */\n    UPDATE public.receipt_line_rules SET status = ''active'', promoted_at = now() WHERE rule_id = p_rule_id;\n    PERFORM set_config(''receipt_line_rules.promoting'', '''', true);\n';
BEGIN
  d := pg_get_functiondef('public.receipt_line_rule_promote(text)'::regprocedure);
  IF position('receipt_line_witness_gate_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2, a3, a4, a5, a6]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'receipt_line_witness_gate anchor drifted: % matches', n; END IF;
  END LOOP;
  d := replace(replace(replace(replace(replace(replace(d, a1, r1), a2, a2 || r2), a3, r3), a4, r4), a5, r5), a6, r6);
  EXECUTE d;
END
$patch$;

-- A rule waiting on witnesses is re-gated when the last one it needs lands.
CREATE OR REPLACE FUNCTION public.receipt_line_rule_witnesses_regate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE r public.receipt_line_rules%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.receipt_line_rules WHERE rule_id = NEW.rule_id;
  IF r.status <> 'proposed' OR r.promotion_measure->>'decision' IS DISTINCT FROM 'waiting_on_witness' THEN RETURN NULL; END IF;
  IF cardinality(public.receipt_line_rule_unwitnessed(r.rule_id)) > 0 THEN
    RETURN NULL;
  END IF;
  PERFORM public.receipt_line_rule_promote(r.rule_id);
  RETURN NULL;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_witnesses_regate() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS receipt_line_rule_witnesses_regate ON public.receipt_line_rule_witnesses;
CREATE TRIGGER receipt_line_rule_witnesses_regate AFTER INSERT ON public.receipt_line_rule_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.receipt_line_rule_witnesses_regate();

-- Lapse: a rule this gate promoted goes back to waiting when a witness it relied on stops being current.
CREATE OR REPLACE FUNCTION public.receipt_line_rule_witness_lapse(p_rule_ids text[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE n int;
BEGIN
  WITH d AS (
    SELECT r.rule_id, public.receipt_line_rule_unwitnessed(r.rule_id) AS u
      FROM public.receipt_line_rules r
     WHERE r.rule_id = ANY (p_rule_ids) AND r.status = 'active'
       AND r.promotion_measure ? 'unwitnessed_item_ids'
       AND r.promotion_measure->>'mode' = 'filling')
  UPDATE public.receipt_line_rules r
     SET status = 'proposed', promoted_at = NULL,
         promotion_measure = r.promotion_measure || jsonb_build_object(
           'decision', 'waiting_on_witness',
           'reasons', jsonb_build_array('evidence_line_without_independent_witness'),
           'unwitnessed_item_ids', to_jsonb(d.u),
           'lapsed', jsonb_build_object('at', now(), 'by', 'receipt_line_witness_gate_v1', 'was_promoted_at', r.promoted_at))
    FROM d
   WHERE d.rule_id = r.rule_id AND cardinality(d.u) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_witness_lapse(text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receipt_line_rule_witnesses_lapse_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
BEGIN
  PERFORM public.receipt_line_rule_witness_lapse(ARRAY(SELECT DISTINCT rule_id FROM ot));
  RETURN NULL;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_witnesses_lapse_on_delete() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS receipt_line_rule_witnesses_lapse ON public.receipt_line_rule_witnesses;
CREATE TRIGGER receipt_line_rule_witnesses_lapse AFTER DELETE ON public.receipt_line_rule_witnesses
  REFERENCING OLD TABLE AS ot FOR EACH STATEMENT EXECUTE FUNCTION public.receipt_line_rule_witnesses_lapse_on_delete();

CREATE OR REPLACE FUNCTION public.receipt_line_rule_witnesses_lapse_on_verdict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
BEGIN
  PERFORM public.receipt_line_rule_witness_lapse(ARRAY(
    SELECT DISTINCT w.rule_id FROM public.receipt_line_rule_witnesses w WHERE w.judgment_request_id = NEW.id));
  RETURN NULL;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rule_witnesses_lapse_on_verdict() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS receipt_line_rule_witness_verdict_changed ON public.evidence_judgment_requests;
CREATE TRIGGER receipt_line_rule_witness_verdict_changed
  AFTER UPDATE OF status, superseded_by, answer, answer_model ON public.evidence_judgment_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.superseded_by IS DISTINCT FROM NEW.superseded_by
        OR OLD.answer IS DISTINCT FROM NEW.answer OR OLD.answer_model IS DISTINCT FROM NEW.answer_model)
  EXECUTE FUNCTION public.receipt_line_rule_witnesses_lapse_on_verdict();

-- Only the gate turns a rule active.
CREATE OR REPLACE FUNCTION public.receipt_line_rules_active_by_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $f$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active'
     AND (OLD.classifier, OLD.priority, OLD.field, OLD.pattern, OLD.operation_code, OLD.system_key, OLD.line_kind,
          OLD.scope_vendor_pattern, OLD.scope_make, OLD.scope_year_min, OLD.scope_year_max, OLD.evidence_item_ids,
          OLD.supersedes_rule_id)
         IS NOT DISTINCT FROM
         (NEW.classifier, NEW.priority, NEW.field, NEW.pattern, NEW.operation_code, NEW.system_key, NEW.line_kind,
          NEW.scope_vendor_pattern, NEW.scope_make, NEW.scope_year_min, NEW.scope_year_max, NEW.evidence_item_ids,
          NEW.supersedes_rule_id) THEN
    RETURN NEW;
  END IF;
  IF current_setting('receipt_line_rules.promoting', true) IS DISTINCT FROM NEW.rule_id THEN
    RAISE EXCEPTION 'receipt_line_rules: rule % turns active or changes while active only through receipt_line_rule_promote', NEW.rule_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION public.receipt_line_rules_active_by_gate() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS receipt_line_rules_active_by_gate ON public.receipt_line_rules;
CREATE TRIGGER receipt_line_rules_active_by_gate BEFORE INSERT OR UPDATE ON public.receipt_line_rules
  FOR EACH ROW WHEN (NEW.status = 'active') EXECUTE FUNCTION public.receipt_line_rules_active_by_gate();
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.receipt_line_rules FROM service_role;

-- The reader: each rule's witness grade.
CREATE OR REPLACE VIEW public.receipt_line_rules_witness_state WITH (security_invoker = true) AS
SELECT r.rule_id, r.classifier, coalesce(r.operation_code, r.system_key, r.line_kind) AS rule_key, r.status,
       q.independence_axis, cardinality(r.evidence_item_ids) AS n_evidence, u.ids AS unwitnessed_item_ids,
       CASE WHEN NOT coalesce(q.requires_independent, false) OR r.promotion_measure->>'mode' = 'narrowing'
              THEN 'not_required'
            WHEN cardinality(u.ids) = 0 THEN 'witnessed'
            ELSE 'unwitnessed' END AS witness_grade
  FROM public.receipt_line_rules r
  LEFT JOIN public.receipt_line_witness_requirements q ON q.classifier = r.classifier
 CROSS JOIN LATERAL (SELECT public.receipt_line_rule_unwitnessed(r.rule_id) AS ids) u;
REVOKE ALL ON public.receipt_line_rules_witness_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.receipt_line_rules_witness_state TO service_role;

COMMENT ON TABLE public.receipt_line_witness_classes IS
'Witness classes for receipt line rules: whether a class is independent of the rule proposer, which row it references (catalog_parts or evidence_judgment_requests), the question kind and answer_model pattern a verdict must carry, and where its answer names the key. Migration 20261125100700.';
COMMENT ON TABLE public.receipt_line_witness_requirements IS
'Per classifier: whether receipt_line_rule_promote requires an independent witness naming the key on every cited line. Migration 20261125100700.';
COMMENT ON TABLE public.receipt_line_rule_witnesses IS
'One keyed witness of one cited line of one rule, written only by receipt_line_rule_witness_record(). Exactly one of catalog_part_id / judgment_request_id. witnessed_key is the key the witness itself names (NULL for classes that name none). Migration 20261125100700.';
