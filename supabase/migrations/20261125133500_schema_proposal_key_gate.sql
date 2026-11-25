-- schema_proposal_key_gate_v1: an agent's add_property proposals are ratified by a measured gate, not by a person.
--
-- WHY. Ruling (lead, 2026-11-24): proposals do not wait for a reviewer_user_id, and no agent records an owner decision.
-- Today the only path to 'approved' is schema_proposal_reviews (reviewer_user_id FK auth.users) counted by
-- fn_schema_proposal_review_handler. The eight reported-labor-hours keys (20261120060000) have sat open since 2026-11-20.
-- This gate checks what can be measured about a key and its citations, in the shape of receipt_line_rule_promote
-- (measure stored on the row, all or nothing, no person). It ratifies vocabulary only: it admits no observation and
-- promotes no hours. Hours reach a total only through a later gate over landed observations.
--
-- WHAT IT MEASURES, per proposal; every proposal in the call must pass or none is ratified (siblings land together).
--   SHAPE     status open, proposal_type add_property, an agent proposer and no user proposer, one agent for the call.
--   KEY       property_key ~ ^[a-z][a-z0-9_]{1,62}$ and not already an observation_properties key; applies_to_kinds
--             are observation_kind labels and expected_source_categories are source_category labels; the registry's own
--             CHECKs (data_type, cardinality, namespace, scope) decide at apply, inside a subtransaction: a refusal there
--             rolls back every status and registration of the call and is stored as 'apply_refused: <message>'.
--   WITNESS   at least one evidence entry of role prototype_row, and for each: its source_table has a row in
--             schema_proposal_witness_sources (ingested tables only; a proposal or registry table cannot be one), the
--             cited row exists and is not machine-written (its generated marker column, if the rule row names one, is
--             NULL), the quote holds what the category's schema_proposal_quote_rules row asks (labor: an hour term and a
--             figure, at least 21 characters, the shortest real quote on file), the row's text holds the quote verbatim
--             as a whole-token match, and every number the entry reads (low=N, high=N) occurs as a number in the quote.
--             A proposal whose category has no quote rule is refused. Each verbatim citation stores md5 of the cited text.
--   AMENDED   two filed citations stopped short of their own figure; each is extended to the clause in the same row that
--             holds it (6c61e4d4: '... over 1000 hours in it'; 53857788: the hours sentence of the same comment).
--   NOTHING RATIFIED MOVES  observation_properties rows other than the new keys: same count and same content hash
--             before and after the apply.
--   Not assessed (reported in the measure, not passed): enum allowed values, which live only in description text
--             (observation_properties has no values column).
-- On pass: status approved, resolved_at now(), decision_rationale names the gate, gate_measure holds the measure, and
-- fn_schema_proposal_apply registers the key. No schema_proposal_reviews row is written; reviewer stays absent, which
-- means no person reviewed. On refusal: status unchanged, gate_measure holds the reasons.
-- Test: supabase/sql/test_schema_proposal_key_gate.sql (PG17).
--
-- REVERT. DROP FUNCTION public.schema_proposal_key_gate(uuid[]); DROP TRIGGER schema_proposal_gate_measure_guard ON
-- public.schema_proposals; DROP FUNCTION public.schema_proposal_gate_measure_guard(); DROP TABLE
-- public.schema_proposal_witness_sources, public.schema_proposal_quote_rules; ALTER TABLE public.schema_proposals DROP
-- COLUMN gate_measure. The two amended quotes may stay (they are the same rows' words). Keys it registered stay (deprecate them by proposal).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.schema_proposals ADD COLUMN IF NOT EXISTS gate_measure jsonb;
COMMENT ON COLUMN public.schema_proposals.gate_measure IS
  'schema_proposal_key_gate_v1: the measure of the last gate run on this proposal (decision, reasons, per-citation checks). NULL = never gated.';

CREATE TABLE IF NOT EXISTS public.schema_proposal_witness_sources (
  source_table text PRIMARY KEY CHECK (source_table ~ '^[a-z][a-z0-9_]*$'),
  text_column text NOT NULL CHECK (text_column ~ '^[a-z][a-z0-9_]*$'),
  generated_marker_column text CHECK (generated_marker_column ~ '^[a-z][a-z0-9_]*$'),
  note text,
  CONSTRAINT schema_proposal_witness_sources_not_agent_written CHECK (source_table NOT IN
    ('schema_proposals', 'schema_proposal_reviews', 'observation_properties', 'schema_proposal_witness_sources',
     'schema_proposal_quote_rules'))
);
COMMENT ON TABLE public.schema_proposal_witness_sources IS
  'schema_proposal_key_gate_v1: ingested tables a proposal''s prototype_row citation may name, the column holding the cited text, and the column that marks a machine-written row (a cited row with it set is refused). A citation to any other table, or to a proposal or registry table, is refused.';
ALTER TABLE public.schema_proposal_witness_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_proposal_witness_sources FROM anon, authenticated;
GRANT SELECT ON public.schema_proposal_witness_sources TO service_role;
INSERT INTO public.schema_proposal_witness_sources (source_table, text_column, generated_marker_column, note) VALUES
  ('auction_comments', 'comment_text', NULL, 'auction comment body, as ingested'),
  ('build_posts', 'content_text', NULL, 'forum build post body, as ingested'),
  ('vehicles', 'description', 'description_generated_at', 'listing description held on the vehicle; a generated description is refused')
ON CONFLICT (source_table) DO NOTHING;

-- What a quote must hold, per proposal category (lead, 2026-11-25: structure, not length). A quote for a labor key
-- holds a figure and an hour term, as a whole-token match; the length floor sits beside it with its basis.
CREATE TABLE IF NOT EXISTS public.schema_proposal_quote_rules (
  category text PRIMARY KEY,
  term_pattern text NOT NULL,
  figure_required boolean NOT NULL,
  min_quote_chars integer NOT NULL CHECK (min_quote_chars > 0),
  basis text NOT NULL
);
COMMENT ON TABLE public.schema_proposal_quote_rules IS
  'schema_proposal_key_gate_v1: per observation_properties category, the term (case-insensitive regex) and figure a cited quote must hold and its length floor, with the basis. A proposal whose category has no row is refused.';
ALTER TABLE public.schema_proposal_quote_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_proposal_quote_rules FROM anon, authenticated;
GRANT SELECT ON public.schema_proposal_quote_rules TO service_role;
INSERT INTO public.schema_proposal_quote_rules (category, term_pattern, figure_required, min_quote_chars, basis) VALUES
  ('labor', '(hours?|hrs?)([^[:alpha:]]|$)|man[- ]?hours?', true, 21,
   'terms: the unit the two hours keys carry (hour) in its written forms (hour, hours, hr, hrs, man-hours); figure: the reported hours number; 21 characters: the shortest of the 25 prototype quotes on file, 2026-11-25')
ON CONFLICT (category) DO NOTHING;

-- Two filed citations were cut short of their own figure (the hours sentence sits in the same row): extend each to
-- the clause in that row that holds it. The proposals are open; the cited rows do not change.
UPDATE public.schema_proposals p
   SET evidence = (SELECT jsonb_agg(CASE
                     WHEN e->>'row_id' = '6c61e4d4-587f-4faa-9e33-a17dcde4e639' AND e->>'quote' = 'said he had over 1000'
                       THEN e || '{"quote": "said he had over 1000 hours in it"}'::jsonb
                     WHEN e->>'row_id' = '53857788-0d95-48ec-bcc4-e5e70e745da3' AND e->>'quote' = 'the last one being a 1970 GTO'
                       THEN e || '{"quote": "I had 2500 hours in it without the new paint", "reads": "low=2500; stated subject: the 1970 GTO named earlier in the same comment, a different car than the listing"}'::jsonb
                     ELSE e END ORDER BY o)
                   FROM jsonb_array_elements(p.evidence) WITH ORDINALITY x(e, o))
 WHERE p.proposed_by_agent_key = 'claude-reported-labor-hours' AND p.status = 'open'
   AND p.evidence::text ~ '(said he had over 1000"|the last one being a 1970 GTO")';

-- gate_measure is written by the gate only.
CREATE OR REPLACE FUNCTION public.schema_proposal_gate_measure_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $g$
BEGIN
  IF NEW.gate_measure IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.gate_measure END)
     AND coalesce(current_setting('nuke.schema_proposal_key_gate', true), '') <> 'on' THEN
    RAISE EXCEPTION 'schema_proposals.gate_measure is written only by schema_proposal_key_gate' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $g$;
DROP TRIGGER IF EXISTS schema_proposal_gate_measure_guard ON public.schema_proposals;
CREATE TRIGGER schema_proposal_gate_measure_guard BEFORE INSERT OR UPDATE OF gate_measure ON public.schema_proposals
  FOR EACH ROW EXECUTE FUNCTION public.schema_proposal_gate_measure_guard();

CREATE OR REPLACE FUNCTION public.schema_proposal_key_gate(p_proposal_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  pr public.schema_proposals%ROWTYPE;
  ev jsonb;
  src public.schema_proposal_witness_sources%ROWTYPE;
  qr public.schema_proposal_quote_rules%ROWTYPE;
  generated boolean;
  txt text;
  num text;
  reasons text[];
  all_reasons text[] := '{}';
  per jsonb := '[]'::jsonb;
  cites jsonb;
  n_proto int;
  agents text[];
  kinds text[];
  cats text[];
  props_before bigint;
  props_after bigint;
  hash_before text;
  hash_after text;
  measure jsonb;
  decision text;
BEGIN
  IF p_proposal_ids IS NULL OR cardinality(p_proposal_ids) = 0 THEN
    RAISE EXCEPTION 'schema_proposal_key_gate: no proposal ids';
  END IF;
  PERFORM 1 FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.schema_proposals WHERE id = ANY (p_proposal_ids))
     <> (SELECT count(DISTINCT x) FROM unnest(p_proposal_ids) x) THEN
    RAISE EXCEPTION 'schema_proposal_key_gate: unknown proposal id';
  END IF;
  SELECT array_agg(DISTINCT coalesce(proposed_by_agent_key, '')) INTO agents
    FROM public.schema_proposals WHERE id = ANY (p_proposal_ids);
  IF cardinality(agents) <> 1 OR agents[1] = '' THEN
    all_reasons := all_reasons || 'one_agent_per_call'::text;
  END IF;
  SELECT array_agg(e.enumlabel::text) INTO kinds FROM pg_enum e WHERE e.enumtypid = 'public.observation_kind'::regtype;
  SELECT array_agg(e.enumlabel::text) INTO cats FROM pg_enum e WHERE e.enumtypid = 'public.source_category'::regtype;

  FOR pr IN SELECT * FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id LOOP
    reasons := '{}';
    cites := '[]'::jsonb;
    IF pr.status <> 'open' THEN reasons := reasons || ('status_' || pr.status); END IF;
    IF pr.proposal_type <> 'add_property' THEN reasons := reasons || 'not_add_property'::text; END IF;
    IF pr.proposed_by_user_id IS NOT NULL OR pr.proposed_by_agent_key IS NULL THEN
      reasons := reasons || 'not_an_agent_proposal'::text;
    END IF;
    IF coalesce(pr.payload->>'property_key', '') !~ '^[a-z][a-z0-9_]{1,62}$' THEN
      reasons := reasons || 'key_shape'::text;
    ELSIF EXISTS (SELECT 1 FROM public.observation_properties p WHERE p.property_key = pr.payload->>'property_key') THEN
      reasons := reasons || 'key_exists'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pr.payload->'applies_to_kinds', '[]'::jsonb)) k
                WHERE k <> ALL (kinds)) THEN
      reasons := reasons || 'applies_to_kinds_unknown'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(pr.payload->'expected_source_categories', '[]'::jsonb)) c
                WHERE c <> ALL (cats)) THEN
      reasons := reasons || 'source_categories_unknown'::text;
    END IF;

    SELECT * INTO qr FROM public.schema_proposal_quote_rules WHERE category = pr.payload->>'category';
    IF NOT FOUND THEN reasons := reasons || 'no_quote_rule'::text; END IF;

    n_proto := 0;
    FOR ev IN SELECT e FROM jsonb_array_elements(coalesce(pr.evidence, '[]'::jsonb)) e WHERE e->>'role' = 'prototype_row' LOOP
      n_proto := n_proto + 1;
      txt := NULL;
      SELECT * INTO src FROM public.schema_proposal_witness_sources WHERE source_table = ev->>'source_table';
      IF NOT FOUND THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', ev->>'source_table', 'check', 'source_table_not_allowed');
        reasons := reasons || 'citation_source_not_allowed'::text;
        CONTINUE;
      END IF;
      IF coalesce(ev->>'row_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_id_shape');
        reasons := reasons || 'citation_row_missing'::text;
        CONTINUE;
      END IF;
      EXECUTE format('SELECT %I::text FROM public.%I WHERE id = $1', src.text_column, src.source_table)
         INTO txt USING (ev->>'row_id')::uuid;
      IF txt IS NULL THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_missing');
        reasons := reasons || 'citation_row_missing'::text;
        CONTINUE;
      END IF;
      IF src.generated_marker_column IS NOT NULL THEN
        EXECUTE format('SELECT %I IS NOT NULL FROM public.%I WHERE id = $1', src.generated_marker_column, src.source_table)
           INTO generated USING (ev->>'row_id')::uuid;
        IF generated THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'row_generated');
          reasons := reasons || 'citation_row_generated'::text;
          CONTINUE;
        END IF;
      END IF;
      IF qr.category IS NOT NULL THEN
        IF length(btrim(coalesce(ev->>'quote', ''))) < qr.min_quote_chars THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_too_short');
          reasons := reasons || 'citation_quote_too_short'::text;
          CONTINUE;
        END IF;
        IF ev->>'quote' !~* qr.term_pattern THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_no_term');
          reasons := reasons || 'citation_quote_no_term'::text;
          CONTINUE;
        END IF;
        IF qr.figure_required AND ev->>'quote' !~ '[0-9]' THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_no_figure');
          reasons := reasons || 'citation_quote_no_figure'::text;
          CONTINUE;
        END IF;
      END IF;
      -- verbatim, on word boundaries: the characters either side of the quote are not letters or digits
      IF position(ev->>'quote' IN txt) = 0
         OR substr(txt, position(ev->>'quote' IN txt) - 1, 1) ~ '[[:alnum:]]'
         OR substr(txt, position(ev->>'quote' IN txt) + length(ev->>'quote'), 1) ~ '[[:alnum:]]' THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'quote_not_in_row');
        reasons := reasons || 'citation_quote_not_in_row'::text;
        CONTINUE;
      END IF;
      FOR num IN SELECT m[1] FROM regexp_matches(coalesce(ev->>'reads', ''), '(?:low|high)=([0-9]+(?:\.[0-9]+)?)', 'g') m LOOP
        IF NOT EXISTS (SELECT 1 FROM regexp_matches(ev->>'quote', '[0-9]+(?:\.[0-9]+)?', 'g') q
                        WHERE q[1]::numeric = num::numeric) THEN
          cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'read_number_not_in_quote', 'number', num);
          reasons := reasons || 'citation_read_not_in_quote'::text;
        END IF;
      END LOOP;
      IF NOT (cites @> jsonb_build_array(jsonb_build_object('row_id', ev->>'row_id'))) THEN
        cites := cites || jsonb_build_object('row_id', ev->>'row_id', 'source_table', src.source_table, 'check', 'verbatim',
                                             'text_md5', md5(txt));
      END IF;
    END LOOP;
    IF n_proto = 0 THEN reasons := reasons || 'no_prototype_row'::text; END IF;

    per := per || jsonb_build_object('proposal_id', pr.id, 'property_key', pr.payload->>'property_key',
                                     'prototype_rows', n_proto, 'citations', cites,
                                     'reasons', to_jsonb(ARRAY(SELECT DISTINCT r FROM unnest(reasons) r ORDER BY r)));
    all_reasons := all_reasons || reasons;
  END LOOP;

  decision := CASE WHEN cardinality(all_reasons) = 0 THEN 'ratified' ELSE 'refused' END;
  PERFORM set_config('nuke.schema_proposal_key_gate', 'on', true);
  measure := jsonb_build_object(
    'basis', 'schema_proposal_key_gate_v1', 'measured_at', now(), 'decision', decision,
    'proposals', per,
    'not_assessed', jsonb_build_array('enum allowed values: held only in the description text'),
    'reasons', to_jsonb(ARRAY(SELECT DISTINCT r FROM unnest(all_reasons) r ORDER BY r)));

  IF decision = 'ratified' THEN
   BEGIN  -- the registry's own constraints (data_type, cardinality, namespace, scope) decide in a subtransaction
    SELECT count(*), md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
      INTO props_before, hash_before FROM public.observation_properties p;
    UPDATE public.schema_proposals
       SET status = 'approved', resolved_at = now(), gate_measure = measure,
           decision_rationale = 'schema_proposal_key_gate_v1: measured key scope and verbatim citations; no person reviewed'
     WHERE id = ANY (p_proposal_ids);
    FOR pr IN SELECT * FROM public.schema_proposals WHERE id = ANY (p_proposal_ids) ORDER BY id LOOP
      PERFORM public.fn_schema_proposal_apply(pr.id);
    END LOOP;
    SELECT count(*), md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
      INTO props_after, hash_after FROM public.observation_properties p
     WHERE coalesce(p.proposed_by_proposal_id <> ALL (p_proposal_ids), true);
    IF props_after <> props_before OR hash_after <> hash_before THEN
      RAISE EXCEPTION 'schema_proposal_key_gate: a ratified property moved during apply' USING ERRCODE = '23514';
    END IF;
   EXCEPTION WHEN check_violation OR invalid_text_representation OR unique_violation OR not_null_violation THEN
    decision := 'refused';
    measure := measure || jsonb_build_object('decision', decision,
                 'reasons', (measure->'reasons') || to_jsonb('apply_refused: ' || SQLERRM));
    UPDATE public.schema_proposals SET gate_measure = measure WHERE id = ANY (p_proposal_ids) AND status = 'open';
   END;
  ELSE
    -- a refusal never overwrites the measure that ratified an approved row
    UPDATE public.schema_proposals SET gate_measure = measure WHERE id = ANY (p_proposal_ids) AND status = 'open';
  END IF;
  PERFORM set_config('nuke.schema_proposal_key_gate', 'off', true);
  RETURN measure;
END $fn$;
COMMENT ON FUNCTION public.schema_proposal_key_gate(uuid[]) IS
  'schema_proposal_key_gate_v1: ratifies sibling agent add_property proposals by measure (key scope, verbatim citations, nothing ratified moves), all or nothing; stores the measure in schema_proposals.gate_measure. Service role only.';
REVOKE ALL ON FUNCTION public.schema_proposal_key_gate(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_proposal_key_gate(uuid[]) TO service_role;
