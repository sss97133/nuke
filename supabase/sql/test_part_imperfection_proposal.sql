-- Runs at the end of the existing disposable schema-proposal contract, after the reported-labor-hours proposal test.
-- Synthetic fixture only; uses the actual curator functions and the actual proposal migration.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Requires disposable dm_refinement_* database';
  END IF;
END $$;
CREATE TEMP TABLE imperfection_properties_before AS TABLE public.observation_properties;
CREATE TEMP TABLE imperfection_reviews_before AS TABLE public.schema_proposal_reviews;
CREATE TEMP TABLE imperfection_functions_before AS
SELECT oid, pg_get_functiondef(oid) AS definition, proacl, proconfig
FROM pg_proc WHERE oid IN (
  'public.fn_schema_proposal_apply(uuid)'::regprocedure,
  'public.fn_schema_proposal_review_handler()'::regprocedure,
  'public.schema_proposal_evidence_check()'::regprocedure,
  'public.fn_schema_proposal_required_approvals(text)'::regprocedure
);
CREATE TEMP TABLE imperfection_proposals_before AS
SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key IS DISTINCT FROM 'claude-part-imperfection-key';

\ir ../migrations/20261120120000_part_imperfection_proposal.sql

CREATE TEMP VIEW imperfection_proposals AS
SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key = 'claude-part-imperfection-key';

SELECT pg_temp.ok('one open, unpromoted add_property proposal for part_imperfection', (
  SELECT count(*) = 1 AND bool_and(payload->>'property_key' = 'part_imperfection'
    AND status = 'open' AND promoted_to_id IS NULL AND proposal_type = 'add_property'
    AND proposed_by_user_id IS NULL AND resolved_at IS NULL)
  FROM imperfection_proposals));
SELECT pg_temp.ok('boolean condition key on the claim_key discriminator, core namespace, instance scope', (
  SELECT bool_and(payload->>'data_type' = 'boolean' AND payload->>'category' = 'condition'
    AND payload->'applies_to_kinds' = '["condition"]'::jsonb AND payload->>'discriminator_key' = 'claim_key'
    AND payload->>'namespace_request' = 'core' AND payload->>'verification_scope' = 'instance'
    AND payload->>'cardinality' = 'multi')
  FROM imperfection_proposals));
SELECT pg_temp.ok('the description separates this key from component presence and states what a photo cannot establish', (
  SELECT bool_and(payload->>'description' ~ 'component_visible_present' AND payload->>'description' ~ 'does not establish')
  FROM imperfection_proposals));
SELECT pg_temp.ok('three prototype rows cited by observation id, one excluded row, every quote under 15 words', (
  SELECT count(*) FILTER (WHERE e->>'role' = 'prototype_row'
                            AND e->>'row_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') = 3
     AND count(*) FILTER (WHERE e->>'role' = 'excluded_row') = 1
     AND bool_and(e->>'quote' IS NULL OR array_length(regexp_split_to_array(btrim(e->>'quote'), '\s+'), 1) < 15)
  FROM imperfection_proposals p, jsonb_array_elements(p.evidence) e));
SELECT pg_temp.ok('no dollar sign, address or link anywhere in the filing', (
  SELECT NOT EXISTS (
    SELECT 1 FROM imperfection_proposals
    WHERE (payload::text || evidence::text || estimated_scope::text || backward_compatibility::text) ~ '[$@]|https?:')));
SELECT pg_temp.ok('no property or review created; every existing property and proposal unchanged',
  NOT EXISTS (TABLE public.observation_properties EXCEPT TABLE imperfection_properties_before)
  AND NOT EXISTS (TABLE imperfection_properties_before EXCEPT TABLE public.observation_properties)
  AND NOT EXISTS (TABLE public.schema_proposal_reviews EXCEPT TABLE imperfection_reviews_before)
  AND NOT EXISTS (TABLE imperfection_proposals_before EXCEPT
    SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key IS DISTINCT FROM 'claude-part-imperfection-key'));
SELECT pg_temp.refused('an open proposal cannot be applied',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM imperfection_proposals LIMIT 1)),
  'expected approved');
CREATE TEMP TABLE imperfection_proposals_once AS SELECT * FROM imperfection_proposals;
\ir ../migrations/20261120120000_part_imperfection_proposal.sql
SELECT pg_temp.ok('repeated migration preserves the original proposal and its clock',
  NOT EXISTS (TABLE imperfection_proposals_once EXCEPT SELECT * FROM imperfection_proposals)
  AND NOT EXISTS (SELECT * FROM imperfection_proposals EXCEPT TABLE imperfection_proposals_once));
SELECT pg_temp.ok('curator definitions, grants and settings unchanged', NOT EXISTS (
  SELECT 1 FROM imperfection_functions_before b JOIN pg_proc p ON p.oid = b.oid
  WHERE pg_get_functiondef(p.oid) IS DISTINCT FROM b.definition
    OR p.proacl IS DISTINCT FROM b.proacl OR p.proconfig IS DISTINCT FROM b.proconfig));
UPDATE public.schema_proposals SET status = 'needs_changes'
WHERE proposed_by_agent_key = 'claude-part-imperfection-key';
\echo 'The ERROR below is the expected refusal to overwrite a curator decision.'
\set ON_ERROR_STOP off
\ir ../migrations/20261120120000_part_imperfection_proposal.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('curator decision is preserved on reapplication', EXISTS (
  SELECT 1 FROM imperfection_proposals WHERE status = 'needs_changes' AND promoted_to_id IS NULL));
UPDATE public.schema_proposals SET status = 'open' WHERE proposed_by_agent_key = 'claude-part-imperfection-key';
\echo 'part imperfection proposal: all checks passed; no ratification, review or admission'
