-- Runs at the end of the existing disposable schema-proposal contract, after the engine-family proposal test.
-- Synthetic fixture only; uses the actual curator functions and the actual proposal migration.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Requires disposable dm_refinement_* database';
  END IF;
END $$;
CREATE TEMP TABLE labor_properties_before AS TABLE public.observation_properties;
CREATE TEMP TABLE labor_reviews_before AS TABLE public.schema_proposal_reviews;
CREATE TEMP TABLE labor_functions_before AS
SELECT oid, pg_get_functiondef(oid) AS definition, proacl, proconfig
FROM pg_proc WHERE oid IN (
  'public.fn_schema_proposal_apply(uuid)'::regprocedure,
  'public.fn_schema_proposal_review_handler()'::regprocedure,
  'public.schema_proposal_evidence_check()'::regprocedure,
  'public.fn_schema_proposal_required_approvals(text)'::regprocedure
);
CREATE TEMP TABLE labor_proposals_before AS
SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key IS DISTINCT FROM 'claude-reported-labor-hours';

\ir ../migrations/20261120060000_reported_labor_hours_proposal.sql

CREATE TEMP VIEW labor_proposals AS
SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key = 'claude-reported-labor-hours';

SELECT pg_temp.ok('eight open, unpromoted add_property proposals, one per key', (
  SELECT count(*) = 8 AND count(DISTINCT payload->>'property_key') = 8
    AND bool_and(status = 'open' AND promoted_to_id IS NULL AND proposal_type = 'add_property'
                 AND proposed_by_user_id IS NULL AND resolved_at IS NULL)
  FROM labor_proposals));
SELECT pg_temp.ok('the keys are exactly the intended eight', (
  SELECT array_agg(payload->>'property_key' ORDER BY payload->>'property_key') @> ARRAY[
    'labor_hours_reported_high', 'labor_hours_reported_low', 'labor_scope', 'labor_speaker_role',
    'labor_statement_kind', 'labor_stated_subject', 'labor_system_key', 'labor_time_basis']
  FROM labor_proposals));
SELECT pg_temp.ok('every proposal asks for core, work_record, instance scope and cites prototype rows', (
  SELECT bool_and(payload->>'namespace_request' = 'core' AND payload->'applies_to_kinds' = '["work_record"]'::jsonb
    AND payload->>'verification_scope' = 'instance' AND payload->>'discriminator_key' = 'quote_hash'
    AND jsonb_array_length(evidence) >= 4
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(evidence) e
                WHERE e->>'role' = 'prototype_row' AND e->>'source_table' IN ('build_posts', 'auction_comments', 'vehicles')
                  AND e->>'row_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  FROM labor_proposals));
SELECT pg_temp.ok('hours keys are numeric hours; every other qualifier is an enum except the stated subject', (
  SELECT bool_and(CASE WHEN payload->>'property_key' LIKE 'labor_hours_reported_%'
                       THEN payload->>'data_type' = 'numeric' AND payload->>'unit' = 'hour'
                       WHEN payload->>'property_key' = 'labor_stated_subject' THEN payload->>'data_type' = 'string'
                       ELSE payload->>'data_type' = 'enum' END)
  FROM labor_proposals));
SELECT pg_temp.ok('every cited quote is under 15 words; no dollar sign, address or link anywhere in the filing', (
  SELECT NOT EXISTS (
    SELECT 1 FROM labor_proposals p, jsonb_array_elements(p.evidence) e
    WHERE array_length(regexp_split_to_array(btrim(coalesce(e->>'quote', '')), '\s+'), 1) >= 15)
  AND NOT EXISTS (
    SELECT 1 FROM labor_proposals
    WHERE (payload::text || evidence::text || estimated_scope::text || backward_compatibility::text) ~ '[$@]|https?:')));
SELECT pg_temp.ok('the system key description names the shared system keys', (
  SELECT bool_and(payload->>'description' ~ 'engine, machining, fuel, cooling, exhaust, electrical, brakes, steering, suspension, axle, transmission, body, paint, glass, interior, trim, tires')
  FROM labor_proposals WHERE payload->>'property_key' = 'labor_system_key'));
SELECT pg_temp.ok('no property or review created; every existing property and proposal unchanged',
  NOT EXISTS (TABLE public.observation_properties EXCEPT TABLE labor_properties_before)
  AND NOT EXISTS (TABLE labor_properties_before EXCEPT TABLE public.observation_properties)
  AND NOT EXISTS (TABLE public.schema_proposal_reviews EXCEPT TABLE labor_reviews_before)
  AND NOT EXISTS (TABLE labor_proposals_before EXCEPT
    SELECT * FROM public.schema_proposals WHERE proposed_by_agent_key IS DISTINCT FROM 'claude-reported-labor-hours'));
SELECT pg_temp.refused('an open proposal cannot be applied',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM labor_proposals LIMIT 1)),
  'expected approved');
CREATE TEMP TABLE labor_proposals_once AS SELECT * FROM labor_proposals;
\ir ../migrations/20261120060000_reported_labor_hours_proposal.sql
SELECT pg_temp.ok('repeated migration preserves every original proposal and clock',
  NOT EXISTS (TABLE labor_proposals_once EXCEPT SELECT * FROM labor_proposals)
  AND NOT EXISTS (SELECT * FROM labor_proposals EXCEPT TABLE labor_proposals_once));
SELECT pg_temp.ok('curator definitions, grants and settings unchanged', NOT EXISTS (
  SELECT 1 FROM labor_functions_before b JOIN pg_proc p ON p.oid = b.oid
  WHERE pg_get_functiondef(p.oid) IS DISTINCT FROM b.definition
    OR p.proacl IS DISTINCT FROM b.proacl OR p.proconfig IS DISTINCT FROM b.proconfig));
UPDATE public.schema_proposals SET status = 'needs_changes'
WHERE proposed_by_agent_key = 'claude-reported-labor-hours' AND payload->>'property_key' = 'labor_scope';
\echo 'The ERROR below is the expected refusal to overwrite a curator decision.'
\set ON_ERROR_STOP off
\ir ../migrations/20261120060000_reported_labor_hours_proposal.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('curator decision is preserved on reapplication', EXISTS (
  SELECT 1 FROM labor_proposals WHERE payload->>'property_key' = 'labor_scope'
    AND status = 'needs_changes' AND promoted_to_id IS NULL));
UPDATE public.schema_proposals SET status = 'open'
WHERE proposed_by_agent_key = 'claude-reported-labor-hours' AND payload->>'property_key' = 'labor_scope';
\echo 'reported labor hours proposal: all checks passed; no ratification, review or admission'
