-- An excluded template requirement derives nothing from the operation it was wrongly attached to.
--
-- 20261020130000 stopped the rust_body templates ("Rust repair and panel welding", "MIG welder", "Body shop bay") from
-- giving template keys when their operation names a fastener ("Replace corroded header bolts (stainless kit)" on the
-- K2500). requirement_capability_keys still matched reviewed keywords against the requirement text plus that operation's
-- text, so the header_bolt keyword keyed all three as exhaust_system (and the stated_by_listing Plan-B tier then listed
-- exhaust shops for rust repair). No keyword row is wrong: header_bolt -> exhaust_system is right for the bolt job itself.
-- The reviewed exclusion now covers the operation entirely: for a requirement requirement_template_excluded() matches,
-- keywords are matched on the requirement's own description only, and the operation's task type derives nothing.
-- Every other requirement keys exactly as before.
-- Contract: supabase/sql/test_requirement_keyword_excluded_operation.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.requirement_capability_keys(jsonb,jsonb)'::regprocedure);
  IF position('THEN NULL ELSE (SELECT li.task_description' IN def) > 0 THEN RAISE EXCEPTION 'requirement_capability_keys: already edited'; END IF;
  anchor := $a$concat_ws(' ', p_requirement->>'description', (SELECT li.task_description FROM public.work_order_line_items li
          WHERE li.id = (p_requirement->>'line_item_id')::uuid))), '[^a-z0-9]+', ' ', 'g')$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'requirement_capability_keys: keyword text anchor found % times', n; END IF;
  def := replace(def, anchor, $r$concat_ws(' ', p_requirement->>'description', CASE WHEN public.requirement_template_excluded(p_requirement) THEN NULL ELSE (SELECT li.task_description FROM public.work_order_line_items li
          WHERE li.id = (p_requirement->>'line_item_id')::uuid) END)), '[^a-z0-9]+', ' ', 'g')$r$);
  anchor := $a$WHERE li.id = (p_requirement->>'line_item_id')::uuid AND co.capability_type IS NOT NULL$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'requirement_capability_keys: operation anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, anchor || $r$ AND NOT public.requirement_template_excluded(p_requirement)$r$);
END $edit$;

COMMENT ON TABLE public.requirement_template_exclusions IS 'Reviewed (20261020130000, 20261020183000): a requirement whose description is <template_slug> (slugged template description) and whose operation text names <operation_word> as a whole word (plural allowed) gets no template keys, no keys from the operation''s task type, and matches reviewed keywords on its own description only. Fastener context for the rust_body templates.';

NOTIFY pgrst, 'reload schema';
COMMIT;
