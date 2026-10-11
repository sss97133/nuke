-- Runs at the end of the existing disposable schema-proposal contract. Synthetic
-- fixture only; use the actual curator functions and the actual proposal migration.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Requires disposable dm_refinement_* database';
  END IF;
END $$;
INSERT INTO public.observation_properties
  (id, property_key, label, data_type, namespace, description, ratified_at)
VALUES ('3d8394a9-8ea2-4823-ae24-f3fe23f6418e', 'engine_code', 'Engine code',
        'string', 'core', 'Casting / serial number-derived', now());
CREATE TEMP TABLE engine_family_properties_before AS TABLE public.observation_properties;
CREATE TEMP TABLE engine_family_reviews_before AS TABLE public.schema_proposal_reviews;
CREATE TEMP TABLE engine_family_functions_before AS
SELECT oid, pg_get_functiondef(oid) AS definition, proacl, proconfig
FROM pg_proc WHERE oid IN (
  'public.fn_schema_proposal_apply(uuid)'::regprocedure,
  'public.fn_schema_proposal_review_handler()'::regprocedure,
  'public.schema_proposal_evidence_check()'::regprocedure,
  'public.fn_schema_proposal_required_approvals(text)'::regprocedure
);

\ir ../migrations/20261011073134_retained_engine_family_label_proposal.sql
SELECT pg_temp.ok('proposal is open, attributed, evidenced and unpromoted', EXISTS (
  SELECT 1 FROM public.schema_proposals
  WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32' AND status = 'open'
    AND promoted_to_id IS NULL AND proposed_by_user_id IS NULL
    AND proposed_by_agent_key = 'codex-retained-engine-family'
    AND payload->>'property_key' = 'engine_family_label'
    AND jsonb_array_length(evidence) = 5
    AND motivating_observation_ids = ARRAY['74ad2e68-dc1e-443e-b6bc-5164bd90323e'::uuid]
));
SELECT pg_temp.ok('no property or review created; engine_code and all existing properties unchanged',
  NOT EXISTS (TABLE public.observation_properties EXCEPT TABLE engine_family_properties_before)
  AND NOT EXISTS (TABLE engine_family_properties_before EXCEPT TABLE public.observation_properties)
  AND NOT EXISTS (TABLE public.schema_proposal_reviews EXCEPT TABLE engine_family_reviews_before));
SELECT pg_temp.refused('open proposal cannot be applied',
  $$SELECT public.fn_schema_proposal_apply('6b9de10b-1666-4bdf-bb69-7e82d62f8b32')$$,
  'expected approved');
CREATE TEMP TABLE engine_family_proposal_once AS
SELECT * FROM public.schema_proposals WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32';
\ir ../migrations/20261011073134_retained_engine_family_label_proposal.sql
SELECT pg_temp.ok('repeated migration preserves the original proposal and clock',
  NOT EXISTS (TABLE engine_family_proposal_once EXCEPT
    SELECT * FROM public.schema_proposals WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32'));
SELECT pg_temp.ok('curator definitions, grants and settings unchanged', NOT EXISTS (
  SELECT 1 FROM engine_family_functions_before b JOIN pg_proc p ON p.oid = b.oid
  WHERE pg_get_functiondef(p.oid) IS DISTINCT FROM b.definition
    OR p.proacl IS DISTINCT FROM b.proacl OR p.proconfig IS DISTINCT FROM b.proconfig
));
UPDATE public.schema_proposals SET status = 'needs_changes'
WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32';
\echo 'The ERROR below is the expected refusal to overwrite a curator decision.'
\set ON_ERROR_STOP off
\ir ../migrations/20261011073134_retained_engine_family_label_proposal.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('curator decision is preserved on reapplication', EXISTS (
  SELECT 1 FROM public.schema_proposals
  WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32' AND status = 'needs_changes'
    AND promoted_to_id IS NULL
));
UPDATE public.schema_proposals SET status = 'open'
WHERE id = '6b9de10b-1666-4bdf-bb69-7e82d62f8b32';
\echo 'retained engine family proposal: all checks passed; no ratification or admission'
