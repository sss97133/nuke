-- Disposable PG17: schema_proposal_key_gate ratifies an agent's sibling add_property proposals by measure, never by a
-- person (schema_proposal_key_gate_v1). Builds on the live-shaped curator fixture (add_source contract chain, which
-- files the eight reported-labor-hours proposals from 20261120060000). Checks: a citation whose quote is not in its row
-- refuses all eight and registers nothing; a read number absent from its quote and a citation to a table outside the
-- rule rows refuse; a registry CHECK refusing at apply rolls the whole call back; with every cited row holding its quote the eight are approved together, registered once each, with
-- no review row and no other property moved; a second call is refused; anon cannot call it. Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_schema_proposal_add_source_contract.sql

\ir ../migrations/20261125133500_schema_proposal_key_gate.sql
\ir ../migrations/20261125133500_schema_proposal_key_gate.sql
DO $$ BEGIN
  PERFORM pg_temp.ok('two short citations amended to their own figure', (
    SELECT count(*) = 2 FROM public.schema_proposals p, jsonb_array_elements(p.evidence) e
     WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours'
       AND e->>'quote' IN ('said he had over 1000 hours in it', 'I had 2500 hours in it without the new paint'))
    AND NOT EXISTS (SELECT 1 FROM public.schema_proposals p WHERE p.evidence::text ~ '(said he had over 1000"|the last one being a 1970 GTO")'));
END $$;

-- the cited source rows (the live ones hold the quoted sentences inside longer text)
-- guardrail-allow(center-key-fk): auction_comments.id: synthetic fixture table in a disposable test database
CREATE TABLE IF NOT EXISTS public.auction_comments (id uuid PRIMARY KEY, comment_text text);
CREATE TABLE IF NOT EXISTS public.build_posts (id uuid PRIMARY KEY, content_text text);
CREATE TABLE IF NOT EXISTS public.vehicles (id uuid PRIMARY KEY);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS description_generated_at timestamptz;
INSERT INTO public.auction_comments (id, comment_text)
  SELECT DISTINCT (e->>'row_id')::uuid, 'before. ' || (e->>'quote') || ' after.'
    FROM public.schema_proposals p, jsonb_array_elements(p.evidence) e
   WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours' AND e->>'role' = 'prototype_row'
     AND e->>'source_table' = 'auction_comments'
  ON CONFLICT DO NOTHING;
INSERT INTO public.build_posts (id, content_text)
  SELECT DISTINCT (e->>'row_id')::uuid, 'before. ' || (e->>'quote') || ' after.'
    FROM public.schema_proposals p, jsonb_array_elements(p.evidence) e
   WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours' AND e->>'role' = 'prototype_row'
     AND e->>'source_table' = 'build_posts'
  ON CONFLICT DO NOTHING;
INSERT INTO public.vehicles (id, description)
  SELECT DISTINCT (e->>'row_id')::uuid, 'before. ' || (e->>'quote') || ' after.'
    FROM public.schema_proposals p, jsonb_array_elements(p.evidence) e
   WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours' AND e->>'role' = 'prototype_row'
     AND e->>'source_table' = 'vehicles'
  ON CONFLICT DO NOTHING;


CREATE TEMP TABLE gate_ids AS
  SELECT array_agg(id ORDER BY id) AS ids FROM public.schema_proposals WHERE proposed_by_agent_key = 'claude-reported-labor-hours';
CREATE TEMP TABLE gate_props_before AS TABLE public.observation_properties;
CREATE TEMP TABLE gate_reviews_before AS SELECT count(*) AS n FROM public.schema_proposal_reviews;

-- 1. One cited row loses its sentence: all eight refused, nothing registered.
UPDATE public.build_posts SET content_text = 'a different sentence'
 WHERE id = (SELECT min(id::text)::uuid FROM public.build_posts);
DO $$
DECLARE m jsonb;
BEGIN
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('quote missing from its row: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_quote_not_in_row');
  PERFORM pg_temp.ok('refused: all eight still open, measure stored on each', (
    SELECT bool_and(status = 'open' AND gate_measure->>'decision' = 'refused' AND promoted_to_id IS NULL)
      FROM public.schema_proposals WHERE id = ANY ((SELECT ids FROM gate_ids)::uuid[])));
  PERFORM pg_temp.ok('refused: no property registered', (SELECT count(*) FROM public.observation_properties)
                                                          = (SELECT count(*) FROM gate_props_before));
END $$;
UPDATE public.build_posts b SET content_text = 'before. ' || (e->>'quote') || ' after.'
  FROM public.schema_proposals p, jsonb_array_elements(p.evidence) e
 WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours' AND e->>'role' = 'prototype_row'
   AND e->>'source_table' = 'build_posts' AND (e->>'row_id')::uuid = b.id;

-- 2. A read number that is not in its quote, and a citation to a table outside the rule rows, each refuse.
DO $$
DECLARE m jsonb; pid uuid; ev0 jsonb;
BEGIN
  SELECT id, evidence INTO pid, ev0 FROM public.schema_proposals
   WHERE proposed_by_agent_key = 'claude-reported-labor-hours' AND payload->>'property_key' = 'labor_hours_reported_low';
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array((SELECT e || '{"reads": "low=999"}'::jsonb FROM jsonb_array_elements(ev0) e
                                               WHERE e->>'role' = 'prototype_row' LIMIT 1))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('read number absent from quote: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_read_not_in_quote');
  -- a one-character quote is verbatim in any row: refused as too short (ta-skeptic's probe)
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array(jsonb_build_object('role', 'prototype_row', 'source_table', 'build_posts',
                     'row_id', (SELECT min(id::text) FROM public.build_posts), 'quote', 'e', 'reads', ''))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('one-character quote (ta-skeptic2 probe): refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_quote_too_short');
  -- a quote that starts inside a word is not verbatim on word boundaries
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array((SELECT e || jsonb_build_object('quote', substr(e->>'quote', 2))
                                               FROM jsonb_array_elements(ev0) e
                                              WHERE e->>'role' = 'prototype_row' AND e->>'quote' ~ '^[[:alnum:]]{2}' LIMIT 1))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('quote cut inside a word: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_quote_not_in_row');
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array(jsonb_build_object('role', 'prototype_row', 'source_table', 'receipts',
                     'row_id', gen_random_uuid(), 'quote', 'x', 'reads', ''))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('citation outside the rule rows: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_source_not_allowed');
  UPDATE public.schema_proposals SET evidence = ev0 WHERE id = pid;
  -- a quote with a figure but no hour term
  UPDATE public.build_posts SET content_text = content_text || ' We paid 300 dollars for the used part.'
   WHERE id = (SELECT min(id::text)::uuid FROM public.build_posts);
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array(jsonb_build_object('role', 'prototype_row', 'source_table', 'build_posts',
                     'row_id', (SELECT min(id::text) FROM public.build_posts), 'quote', 'We paid 300 dollars for the used part', 'reads', ''))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('no hour term: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_quote_no_term');
  -- an hour term but no figure
  UPDATE public.build_posts SET content_text = content_text || ' It took many hours of patient work.'
   WHERE id = (SELECT min(id::text)::uuid FROM public.build_posts);
  UPDATE public.schema_proposals
     SET evidence = ev0 || jsonb_build_array(jsonb_build_object('role', 'prototype_row', 'source_table', 'build_posts',
                     'row_id', (SELECT min(id::text) FROM public.build_posts), 'quote', 'It took many hours of patient work', 'reads', ''))
   WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('no figure: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_quote_no_figure');
  UPDATE public.schema_proposals SET evidence = ev0 WHERE id = pid;
  -- a machine-written description is not a witness
  UPDATE public.vehicles SET description_generated_at = now() WHERE description IS NOT NULL;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('generated description: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'citation_row_generated');
  UPDATE public.vehicles SET description_generated_at = NULL;
  -- a proposal with no prototype row
  UPDATE public.schema_proposals SET evidence = (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(ev0) e
                                                  WHERE e->>'role' <> 'prototype_row') WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('no prototype row: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'no_prototype_row');
  UPDATE public.schema_proposals SET evidence = ev0 WHERE id = pid;
  -- a category with no quote rule
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{category}', '"no_such_category"') WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('no quote rule: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'no_quote_rule');
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{category}', '"labor"') WHERE id = pid;
  -- an unknown observation kind
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{applies_to_kinds}', '["no_such_kind"]') WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('unknown kind: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'applies_to_kinds_unknown');
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{applies_to_kinds}', '["work_record"]') WHERE id = pid;
  -- not an agent's proposal: a user's (the fixture's auth.users takes an id)
  INSERT INTO auth.users (id) VALUES ('30000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
  UPDATE public.schema_proposals SET proposed_by_user_id = '30000000-0000-0000-0000-000000000001', proposed_by_agent_key = NULL WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('no agent: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'not_an_agent_proposal');
  -- two agents in one call
  UPDATE public.schema_proposals SET proposed_by_user_id = NULL, proposed_by_agent_key = 'another-agent' WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('two agents: refused', m->>'decision' = 'refused' AND m->'reasons' ? 'one_agent_per_call');
  UPDATE public.schema_proposals SET proposed_by_agent_key = 'claude-reported-labor-hours' WHERE id = pid;
  -- gate_measure is written by the gate only
  BEGIN
    UPDATE public.schema_proposals SET gate_measure = '{"decision": "ratified"}' WHERE id = pid;
    RAISE EXCEPTION 'gate_measure written outside the gate';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.ok('gate_measure refused outside the gate', true);
  END;
  -- the registry's own CHECK refuses a data type: the whole call rolls back, nothing registered, all still open
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{data_type}', '"bogus"') WHERE id = pid;
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('registry CHECK refuses at apply: ' || (m->'reasons')::text,
    m->>'decision' = 'refused' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(m->'reasons') r WHERE r LIKE 'apply_refused:%'));
  PERFORM pg_temp.ok('apply refusal rolled back every status and registration', (
    SELECT bool_and(status = 'open' AND promoted_to_id IS NULL) FROM public.schema_proposals
     WHERE id = ANY ((SELECT ids FROM gate_ids)::uuid[]))
    AND (SELECT count(*) FROM public.observation_properties) = (SELECT count(*) FROM gate_props_before));
  UPDATE public.schema_proposals SET payload = jsonb_set(payload, '{data_type}', '"numeric"') WHERE id = pid;
END $$;

-- 3. Every citation holds: the eight are ratified together, by measure, with no person.
DO $$
DECLARE m jsonb;
BEGIN
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('ratified: ' || m::text, m->>'decision' = 'ratified' AND jsonb_array_length(m->'reasons') = 0);
  PERFORM pg_temp.ok('eight approved, each registered once, rationale names the gate', (
    SELECT bool_and(p.status = 'approved' AND p.promoted_to_id IS NOT NULL AND p.resolved_at IS NOT NULL
                    AND p.decision_rationale LIKE 'schema_proposal_key_gate_v1:%' AND p.gate_measure->>'decision' = 'ratified'
                    AND (SELECT count(*) FROM public.observation_properties o WHERE o.proposed_by_proposal_id = p.id
                            AND o.property_key = p.payload->>'property_key') = 1)
      FROM public.schema_proposals p WHERE p.id = ANY ((SELECT ids FROM gate_ids)::uuid[])));
  PERFORM pg_temp.ok('no review row written: no person reviewed', (SELECT count(*) FROM public.schema_proposal_reviews)
                                                                   = (SELECT n FROM gate_reviews_before));
  PERFORM pg_temp.ok('every other property unchanged', NOT EXISTS (
    (SELECT * FROM gate_props_before) EXCEPT
    (SELECT * FROM public.observation_properties WHERE coalesce(proposed_by_proposal_id <> ALL ((SELECT ids FROM gate_ids)::uuid[]), true)))
    AND (SELECT count(*) FROM public.observation_properties) = (SELECT count(*) FROM gate_props_before) + 8);
  m := public.schema_proposal_key_gate((SELECT ids FROM gate_ids));
  PERFORM pg_temp.ok('second call refused', m->>'decision' = 'refused' AND m->'reasons' ? 'status_approved');
  PERFORM pg_temp.ok('second call keeps the ratifying measure on every approved row', (
    SELECT bool_and(gate_measure->>'decision' = 'ratified') FROM public.schema_proposals
     WHERE id = ANY ((SELECT ids FROM gate_ids)::uuid[])));
END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot call the gate', NOT has_function_privilege('anon', 'public.schema_proposal_key_gate(uuid[])', 'EXECUTE'));
  PERFORM pg_temp.ok('service role can', has_function_privilege('service_role', 'public.schema_proposal_key_gate(uuid[])', 'EXECUTE'));
END $$;
\echo schema_proposal_key_gate: ok
