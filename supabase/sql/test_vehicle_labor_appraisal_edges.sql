-- Disposable PG17: labor rules reference their stage transitions and operations by foreign key (labor_edges_v1), the
-- reader reads those rows, and its output is unchanged except logic_version and the transition_id on each priced step.
-- Builds on the pair-operations contract. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_vehicle_labor_appraisal_pairs.sql
RESET ROLE;

-- Output minus as_of, logic_version and the new transition_id keys; missing_evidence compared as a set of codes (the
-- operation rows list codes alphabetically, the old jsonb array in its written order).
CREATE FUNCTION public._no_tr(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace((jsonb_set(j - 'as_of' - 'logic_version', '{segments}', coalesce((
           SELECT jsonb_agg(CASE WHEN x.s ? 'missing_evidence' THEN jsonb_set(x.s, '{missing_evidence}', (
                    SELECT coalesce(jsonb_agg(t ORDER BY t), '[]'::jsonb)
                      FROM jsonb_array_elements_text(x.s->'missing_evidence') m,
                           regexp_split_to_table(m, '[:,]') t)) ELSE x.s END ORDER BY x.i)
             FROM jsonb_array_elements(j->'segments') WITH ORDINALITY AS x(s, i)), '[]'::jsonb)))::text,
                        '(, )?"transition_id": ("[0-9a-f-]+"|null)(, )?', '\3', 'g')
$$;
-- The base fixture's rules name operations its labor_operations table never held (live holds all of them); the foreign
-- key needs the rows. No base hours: these are keys, and none is priced from here.
INSERT INTO labor_operations(code, name, base_hours, system) VALUES
  ('BODY-RUST-PANEL', 'Rust repair panel', NULL, 'body'), ('ELEC-WIRING-HARNESS', 'Wiring harness', NULL, 'electrical'),
  ('INT-CARPET-RR', 'Carpet R&R', NULL, 'interior'), ('INT-DOOR-PANELS', 'Door panels R&R (pair)', NULL, 'interior'),
  ('INT-HEADLINER-RR', 'Headliner R&R', NULL, 'interior')
ON CONFLICT (code) DO NOTHING;
SET test.auth_role = 'anon';
CREATE TEMP TABLE _edges_before AS SELECT v.id, public.vehicle_labor_appraisal(v.id) AS j FROM vehicles v;
RESET ROLE;

\ir ../migrations/20261124213000_labor_rule_edges.sql
\ir ../migrations/20261124213000_labor_rule_edges.sql

DO $$
DECLARE d text; bad int;
BEGIN
  d := pg_get_functiondef('public.vehicle_labor_appraisal(uuid)'::regprocedure);
  PERFORM public.assert(position('estimate_labor_from_delta' IN d) = 0, 'no text lookup of transitions');
  PERFORM public.assert(position('->''operations''' IN d) = 0 AND position('{per_piece,operations}' IN d) = 0, 'no jsonb operation arrays read');
  SELECT count(*) INTO bad FROM labor_stage_rules WHERE evidence_requirements::text LIKE '%"operations"%'
                                                  OR jsonb_typeof(evidence_requirements->'paint_chain') = 'array';
  PERFORM public.assert(bad = 0, 'arrays left the rule rows');
  PERFORM public.assert((SELECT count(*) FROM labor_stage_rule_operations o JOIN labor_stage_rules r ON r.id = o.rule_id
                          WHERE r.segment_key = 'body_metal') = 2, 'body metal: evidence + per_piece operation rows');
  PERFORM public.assert((SELECT count(*) FROM labor_stage_rule_transitions t JOIN labor_stage_rules r ON r.id = t.rule_id
                          WHERE r.segment_key = 'chassis') = 1, 'chassis prices one transition');
END $$;

SET test.auth_role = 'anon';
DO $$
DECLARE r record; a jsonb; n int := 0; s jsonb;
BEGIN
  FOR r IN SELECT * FROM _edges_before LOOP
    a := public.vehicle_labor_appraisal(r.id);
    PERFORM public.assert((a IS NULL) = (r.j IS NULL), format('visibility unchanged for %s', r.id));
    CONTINUE WHEN a IS NULL;
    PERFORM public.assert(public._no_tr(a) = public._no_tr(r.j), format('vehicle %s changed: before %s after %s', r.id, r.j, a));
    n := n + 1;
  END LOOP;
  PERFORM public.assert(n >= 3, format('compared %s public vehicles', n));
  a := public.vehicle_labor_appraisal('10000000-0000-0000-0000-000000000001');
  PERFORM public.assert(a->>'logic_version' = 'vehicle_labor_appraisal/20261124213000.1', 'logic version');
  s := public._seg('10000000-0000-0000-0000-000000000001', 'chassis');
  PERFORM public.assert(s->>'status' <> 'ok' OR (s#>>'{stage_steps,0,transition_id}') IS NOT NULL, format('priced step carries its transition: %s', s));
END $$;
RESET ROLE;

-- A row lands, the next read changes: drop body metal's per-piece operation and the segment has no pieces.
DELETE FROM labor_stage_rule_operations o USING labor_stage_rules r
 WHERE r.id = o.rule_id AND r.segment_key = 'body_metal' AND o.role = 'per_piece';
SET test.auth_role = 'anon';
DO $$
BEGIN
  PERFORM public.assert(public._seg('10000000-0000-0000-0000-000000000001', 'body_metal')->>'status' = 'no evidence',
    'per-piece mode reads the operation rows');
END $$;
RESET ROLE;
DO $$
BEGIN
  BEGIN
    INSERT INTO labor_stage_rule_operations SELECT id, 'NO-SUCH-OP', 'evidence' FROM labor_stage_rules LIMIT 1;
    RAISE EXCEPTION 'unknown operation code was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
\echo vehicle_labor_appraisal_edges: ok
