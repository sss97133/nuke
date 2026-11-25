-- receipt_line_edges_v1: each receipt line's classifier output is a stored row with a foreign key to the rule that
-- produced it, instead of a regex every reader re-runs on every read.
--
-- WHY. Measured live 2026-11-24: five readers (vehicle_labor_appraisal, vehicle_build_reconstruction,
-- vehicle_axle_type_evidence, vehicle_machine_shop_lines, vehicle_part_installation_evidence) call
-- receipt_line_system(text) / receipt_line_labor_operation(text) per line per read. The answer is held nowhere, so
-- no row says which rule keyed a line, when, or on what grade, and nothing can count edges per day. Cost: 34 active
-- operation rules exceed Postgres's 32-entry compiled-regex cache, so receipt_line_rule_hit() recompiles on every
-- call: 2.4 s for the 1,072 receipt_items (operation), 0.33 s (system).
--
-- WHAT CHANGES (no reader changes here; readers switch to the stored edge one migration each).
--   receipt_line_edges   grain (receipt_item_id, classifier). Hits only: no row = no active rule matched, so the
--                        unmatched fold is an anti-join. rule_id FK (rule_id, classifier) -> receipt_line_rules; the
--                        typed output key carries its own FK to the book (labor_operations.code,
--                        receipt_line_systems.system_key) and a composite FK to its rule, so an edge's key cannot
--                        differ from the key its rule states. grade: every rule-written edge is 'claim' (a pattern is
--                        a claim, owner rule 2026-11-24); 'established' is refused until a basis column with a foreign
--                        key exists to carry it.
--   receipt_line_edge_runs  one row per full recompute (backfill, rule change, hourly re-verify) with lines written
--                        and deleted. A re-verify that writes rows means a trigger missed them: that is the drift gauge.
--   Writers. receipt_line_edges_refresh(uuid[], text): rule-major first match over the given items (all when NULL),
--                        0.14 s for the fleet (each pattern compiled once). Row triggers on receipt_items (insert,
--                        description / part_number / receipt_id change) write that line through
--                        receipt_line_rule_hit(); a failure warns and never blocks the line landing, and the hourly
--                        re-verify repairs it. Statement triggers on receipt_line_rules recompute every line when the
--                        active rule set changes (promote, supersede, retire). Cron receipt-line-edges-verify, hourly.
-- Scope. Like the text wrappers, the edge writer applies only unscoped rules (vendor / make / year scope is the next
-- migration, keyed by receipts.vendor_organization_id). A part_number rule reads the line's own part_number.
-- Proof: the DO block at the end asserts, for every receipt item and classifier, that the stored edge is the rule
-- receipt_line_rule_hit() picks for its description, and raises otherwise.
-- Test: supabase/sql/test_receipt_line_rules.sql (PG17), section 20261124234000.
--
-- REVERT. SELECT cron.unschedule('receipt-line-edges-verify'); DROP TRIGGER receipt_items_line_edges_ins,
-- receipt_items_line_edges_upd ON receipt_items; DROP TRIGGER receipt_line_rules_edges_ins, _upd, _del ON
-- receipt_line_rules; DROP FUNCTION receipt_line_edges_rules_changed(), receipt_items_line_edges(),
-- receipt_line_edges_refresh(uuid[], text); DROP TABLE receipt_line_edges, receipt_line_edge_runs; drop the four
-- receipt_line_rules_*_key unique constraints added below.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Targets for the composite foreign keys (rule_id is already the primary key; these only let an edge name its rule
-- together with the rule's own output).
DO $$
BEGIN
  IF to_regclass('public.receipt_line_rules_rule_classifier_key') IS NULL THEN
    ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_rule_classifier_key UNIQUE (rule_id, classifier);
  END IF;
  IF to_regclass('public.receipt_line_rules_rule_operation_key') IS NULL THEN
    ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_rule_operation_key UNIQUE (rule_id, classifier, operation_code);
  END IF;
  IF to_regclass('public.receipt_line_rules_rule_system_key') IS NULL THEN
    ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_rule_system_key UNIQUE (rule_id, classifier, system_key);
  END IF;
  IF to_regclass('public.receipt_line_rules_rule_line_kind_key') IS NULL THEN
    ALTER TABLE public.receipt_line_rules ADD CONSTRAINT receipt_line_rules_rule_line_kind_key UNIQUE (rule_id, classifier, line_kind);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.receipt_line_edges (
  receipt_item_id uuid NOT NULL REFERENCES public.receipt_items(id) ON DELETE CASCADE,
  classifier text NOT NULL CHECK (classifier IN ('system', 'labor_operation', 'line_kind')),
  rule_id text NOT NULL,
  system_key text REFERENCES public.receipt_line_systems(system_key),
  operation_code text REFERENCES public.labor_operations(code),
  line_kind text,
  grade text NOT NULL DEFAULT 'claim',
  input_md5 text NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_item_id, classifier),
  CONSTRAINT receipt_line_edges_rule_fk FOREIGN KEY (rule_id, classifier)
    REFERENCES public.receipt_line_rules(rule_id, classifier),
  CONSTRAINT receipt_line_edges_rule_system_fk FOREIGN KEY (rule_id, classifier, system_key)
    REFERENCES public.receipt_line_rules(rule_id, classifier, system_key),
  CONSTRAINT receipt_line_edges_rule_operation_fk FOREIGN KEY (rule_id, classifier, operation_code)
    REFERENCES public.receipt_line_rules(rule_id, classifier, operation_code),
  CONSTRAINT receipt_line_edges_rule_line_kind_fk FOREIGN KEY (rule_id, classifier, line_kind)
    REFERENCES public.receipt_line_rules(rule_id, classifier, line_kind),
  CONSTRAINT receipt_line_edges_output CHECK (
    (classifier = 'system' AND system_key IS NOT NULL AND operation_code IS NULL AND line_kind IS NULL)
    OR (classifier = 'labor_operation' AND operation_code IS NOT NULL AND system_key IS NULL AND line_kind IS NULL)
    OR (classifier = 'line_kind' AND line_kind IS NOT NULL AND system_key IS NULL AND operation_code IS NULL)),
  -- A pattern-written edge is a claim. 'established' needs a keyed basis (catalog part edge, fitted witness), and
  -- no basis column exists yet, so the database refuses it.
  CONSTRAINT receipt_line_edges_grade CHECK (grade = 'claim')
);
COMMENT ON TABLE public.receipt_line_edges IS
  'receipt_line_edges_v1: one row per receipt line and classifier that an active rule keys. rule_id is the basis; grade claim = pattern-matched. Written by receipt_line_edges_refresh (triggers on receipt_items and receipt_line_rules, cron receipt-line-edges-verify). No row = no rule matched.';
CREATE INDEX IF NOT EXISTS receipt_line_edges_rule_idx ON public.receipt_line_edges (rule_id);
CREATE INDEX IF NOT EXISTS receipt_line_edges_operation_idx ON public.receipt_line_edges (operation_code) WHERE operation_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS receipt_line_edges_classified_idx ON public.receipt_line_edges (classified_at);

CREATE TABLE IF NOT EXISTS public.receipt_line_edge_runs (
  run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('backfill', 'rules', 'cron', 'call')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  items integer NOT NULL,
  written integer NOT NULL,
  deleted integer NOT NULL
);
COMMENT ON TABLE public.receipt_line_edge_runs IS
  'One row per full recompute of receipt_line_edges. written/deleted > 0 on a cron run = lines a trigger missed (drift).';

ALTER TABLE public.receipt_line_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_line_edge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_line_edges, public.receipt_line_edge_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_line_edges, public.receipt_line_edge_runs TO service_role;

-- The writer. p_item_ids NULL = every receipt item (a logged run). First match by (priority, rule_id) over the
-- active unscoped rules of each classifier, evaluated rule by rule so each pattern compiles once.
CREATE OR REPLACE FUNCTION public.receipt_line_edges_refresh(p_item_ids uuid[] DEFAULT NULL, p_source text DEFAULT 'call')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  c text;
  r record;
  w int; d int;
  tw int := 0; td int := 0; n int;
  t0 timestamptz := clock_timestamp();
BEGIN
  IF p_item_ids IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('receipt_line_edges_refresh'));
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _rle_items (id uuid PRIMARY KEY, t text, pn text, md5 text, rule_id text) ON COMMIT DROP;
  FOREACH c IN ARRAY ARRAY['system', 'labor_operation', 'line_kind'] LOOP
    TRUNCATE _rle_items;
    INSERT INTO _rle_items (id, t, pn, md5)
    SELECT i.id, lower(coalesce(i.description, '')), lower(coalesce(i.part_number, '')),
           md5(coalesce(i.description, '') || chr(31) || coalesce(i.part_number, ''))
      FROM public.receipt_items i
     WHERE p_item_ids IS NULL OR i.id = ANY (p_item_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    FOR r IN
      SELECT x.rule_id, x.field, x.pattern FROM public.receipt_line_rules x
       WHERE x.classifier = c AND x.status = 'active'
         AND x.scope_vendor_pattern IS NULL AND x.scope_make IS NULL
         AND x.scope_year_min IS NULL AND x.scope_year_max IS NULL
       ORDER BY x.priority, x.rule_id
    LOOP
      UPDATE _rle_items SET rule_id = r.rule_id
       WHERE rule_id IS NULL AND (CASE r.field WHEN 'part_number' THEN pn ELSE t END) ~ r.pattern;
    END LOOP;
    WITH up AS (
      INSERT INTO public.receipt_line_edges AS e
             (receipt_item_id, classifier, rule_id, system_key, operation_code, line_kind, grade, input_md5, classified_at)
      SELECT x.id, c, x.rule_id, k.system_key, k.operation_code, k.line_kind, 'claim', x.md5, now()
        FROM _rle_items x JOIN public.receipt_line_rules k ON k.rule_id = x.rule_id
      ON CONFLICT (receipt_item_id, classifier) DO UPDATE
         SET rule_id = EXCLUDED.rule_id, system_key = EXCLUDED.system_key, operation_code = EXCLUDED.operation_code,
             line_kind = EXCLUDED.line_kind, grade = EXCLUDED.grade, input_md5 = EXCLUDED.input_md5,
             classified_at = EXCLUDED.classified_at
       WHERE (e.rule_id, e.input_md5) IS DISTINCT FROM (EXCLUDED.rule_id, EXCLUDED.input_md5)
      RETURNING 1),
    del AS (
      DELETE FROM public.receipt_line_edges e USING _rle_items x
       WHERE e.receipt_item_id = x.id AND e.classifier = c AND x.rule_id IS NULL
      RETURNING 1)
    SELECT (SELECT count(*) FROM up), (SELECT count(*) FROM del) INTO w, d;
    tw := tw + w; td := td + d;
  END LOOP;
  IF p_item_ids IS NULL THEN
    INSERT INTO public.receipt_line_edge_runs (source, started_at, items, written, deleted)
    VALUES (p_source, t0, n, tw, td);
  END IF;
  RETURN jsonb_build_object('items', n, 'written', tw, 'deleted', td);
END
$fn$;
REVOKE ALL ON FUNCTION public.receipt_line_edges_refresh(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_line_edges_refresh(uuid[], text) TO service_role;

-- One landed or edited line: receipt_line_rule_hit() per classifier (cheap for one line). Never blocks the landing.
CREATE OR REPLACE FUNCTION public.receipt_items_line_edges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  c text; rid text;
  h text := md5(coalesce(NEW.description, '') || chr(31) || coalesce(NEW.part_number, ''));
BEGIN
  BEGIN
    FOREACH c IN ARRAY ARRAY['system', 'labor_operation', 'line_kind'] LOOP
      rid := (SELECT x.rule_id FROM public.receipt_line_rule_hit(c, NEW.description, NEW.part_number) x LIMIT 1);
      IF rid IS NULL THEN
        DELETE FROM public.receipt_line_edges WHERE receipt_item_id = NEW.id AND classifier = c;
      ELSE
        INSERT INTO public.receipt_line_edges AS e
               (receipt_item_id, classifier, rule_id, system_key, operation_code, line_kind, grade, input_md5, classified_at)
        SELECT NEW.id, c, k.rule_id, k.system_key, k.operation_code, k.line_kind, 'claim', h, now()
          FROM public.receipt_line_rules k WHERE k.rule_id = rid
        ON CONFLICT (receipt_item_id, classifier) DO UPDATE
           SET rule_id = EXCLUDED.rule_id, system_key = EXCLUDED.system_key, operation_code = EXCLUDED.operation_code,
               line_kind = EXCLUDED.line_kind, grade = EXCLUDED.grade, input_md5 = EXCLUDED.input_md5,
               classified_at = EXCLUDED.classified_at
         WHERE (e.rule_id, e.input_md5) IS DISTINCT FROM (EXCLUDED.rule_id, EXCLUDED.input_md5);
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'receipt_line_edges: line % not classified (%); cron receipt-line-edges-verify repairs it', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.receipt_items_line_edges() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS receipt_items_line_edges_ins ON public.receipt_items;
CREATE TRIGGER receipt_items_line_edges_ins AFTER INSERT ON public.receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.receipt_items_line_edges();
DROP TRIGGER IF EXISTS receipt_items_line_edges_upd ON public.receipt_items;
CREATE TRIGGER receipt_items_line_edges_upd AFTER UPDATE OF description, part_number, receipt_id ON public.receipt_items
  FOR EACH ROW WHEN (OLD.description IS DISTINCT FROM NEW.description OR OLD.part_number IS DISTINCT FROM NEW.part_number
                     OR OLD.receipt_id IS DISTINCT FROM NEW.receipt_id)
  EXECUTE FUNCTION public.receipt_items_line_edges();

-- The active rule set changed (a rule promoted, superseded, retired, or an active rule edited): recompute every line.
CREATE OR REPLACE FUNCTION public.receipt_line_edges_rules_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE hit boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    hit := EXISTS (SELECT 1 FROM nt WHERE status = 'active');
  ELSIF TG_OP = 'DELETE' THEN
    hit := EXISTS (SELECT 1 FROM ot WHERE status = 'active');
  ELSE
    hit := EXISTS (SELECT 1 FROM ot WHERE status = 'active') OR EXISTS (SELECT 1 FROM nt WHERE status = 'active');
  END IF;
  IF hit THEN
    PERFORM public.receipt_line_edges_refresh(NULL, 'rules');
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.receipt_line_edges_rules_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS receipt_line_rules_edges_ins ON public.receipt_line_rules;
CREATE TRIGGER receipt_line_rules_edges_ins AFTER INSERT ON public.receipt_line_rules
  REFERENCING NEW TABLE AS nt FOR EACH STATEMENT EXECUTE FUNCTION public.receipt_line_edges_rules_changed();
DROP TRIGGER IF EXISTS receipt_line_rules_edges_upd ON public.receipt_line_rules;
CREATE TRIGGER receipt_line_rules_edges_upd AFTER UPDATE ON public.receipt_line_rules
  REFERENCING OLD TABLE AS ot NEW TABLE AS nt FOR EACH STATEMENT EXECUTE FUNCTION public.receipt_line_edges_rules_changed();
DROP TRIGGER IF EXISTS receipt_line_rules_edges_del ON public.receipt_line_rules;
CREATE TRIGGER receipt_line_rules_edges_del AFTER DELETE ON public.receipt_line_rules
  REFERENCING OLD TABLE AS ot FOR EACH STATEMENT EXECUTE FUNCTION public.receipt_line_edges_rules_changed();

-- Backfill.
SELECT public.receipt_line_edges_refresh(NULL, 'backfill');

-- Proof: every stored edge is the rule the per-line reader picks, for every receipt item and classifier.
DO $proof$
DECLARE c text; bad int; n int;
BEGIN
  FOREACH c IN ARRAY ARRAY['system', 'labor_operation', 'line_kind'] LOOP
    SELECT count(*) INTO bad
      FROM public.receipt_items i
      LEFT JOIN public.receipt_line_edges e ON e.receipt_item_id = i.id AND e.classifier = c
     WHERE e.rule_id IS DISTINCT FROM (SELECT x.rule_id FROM public.receipt_line_rule_hit(c, i.description, i.part_number) x LIMIT 1);
    IF bad > 0 THEN
      RAISE EXCEPTION 'receipt_line_edges: % % edges differ from receipt_line_rule_hit', bad, c;
    END IF;
  END LOOP;
  SELECT count(*) INTO bad FROM public.receipt_items i
    LEFT JOIN public.receipt_line_edges s ON s.receipt_item_id = i.id AND s.classifier = 'system'
    LEFT JOIN public.receipt_line_edges o ON o.receipt_item_id = i.id AND o.classifier = 'labor_operation'
   WHERE s.system_key IS DISTINCT FROM public.receipt_line_system(i.description)
      OR o.operation_code IS DISTINCT FROM public.receipt_line_labor_operation(i.description);
  IF bad > 0 THEN
    RAISE EXCEPTION 'receipt_line_edges: % items differ from the text wrappers', bad;
  END IF;
  SELECT count(*) INTO n FROM public.receipt_line_edges;
  RAISE NOTICE 'receipt_line_edges: % edges over % receipt items, equal to receipt_line_rule_hit and the text wrappers',
    n, (SELECT count(*) FROM public.receipt_items);
END
$proof$;

-- Hourly re-verify: writes only what a trigger missed, and logs the run.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'receipt-line-edges-verify';
    PERFORM cron.schedule('receipt-line-edges-verify', '41 * * * *',
                          $job$SELECT public.receipt_line_edges_refresh(NULL, 'cron')$job$);
  END IF;
END
$cron$;
