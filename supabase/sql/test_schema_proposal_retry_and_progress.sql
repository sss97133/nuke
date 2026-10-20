-- Extends the existing live-shaped PostgreSQL 17 proposal contract. Synthetic
-- testimony only. Run through test_schema_proposal_add_source_contract.sql.
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    RAISE EXCEPTION 'Requires disposable dm_refinement_* database';
  END IF;
END $$;

-- Reproduce the real failure before installing the repair: the approval committed,
-- its response was lost, and a retry collides with the property it already created.
SELECT pg_temp.refused('a committed add_property cannot currently be retried',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'property')),
  'duplicate key');
CREATE TEMP TABLE retry_properties_before AS TABLE public.observation_properties;
CREATE TEMP TABLE retry_proposals_before AS TABLE public.schema_proposals;
CREATE TEMP TABLE retry_reviews_before AS TABLE public.schema_proposal_reviews;
CREATE TEMP TABLE retry_approval_before AS
SELECT oid, pg_get_functiondef(oid) AS definition, proacl, proconfig
FROM pg_proc WHERE oid IN (
  'public.fn_schema_proposal_review_handler()'::regprocedure,
  'public.schema_proposal_evidence_check()'::regprocedure,
  'public.fn_schema_proposal_required_approvals(text)'::regprocedure
);
CREATE TEMP TABLE retry_apply_before AS
SELECT proacl, prosecdef FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure;

\ir ../migrations/20261011223810_schema_proposal_retry_and_progress.sql

SELECT public.fn_schema_proposal_apply((SELECT id FROM p WHERE name = 'property'));
SELECT public.fn_schema_proposal_apply((SELECT id FROM p WHERE name = 'property'));
SELECT pg_temp.ok('lost-response retries preserve every property, proposal, review and original clock',
  NOT EXISTS (TABLE retry_properties_before EXCEPT TABLE public.observation_properties)
  AND NOT EXISTS (TABLE public.observation_properties EXCEPT TABLE retry_properties_before)
  AND NOT EXISTS (TABLE retry_proposals_before EXCEPT TABLE public.schema_proposals)
  AND NOT EXISTS (TABLE public.schema_proposals EXCEPT TABLE retry_proposals_before)
  AND NOT EXISTS (TABLE retry_reviews_before EXCEPT TABLE public.schema_proposal_reviews)
  AND NOT EXISTS (TABLE public.schema_proposal_reviews EXCEPT TABLE retry_reviews_before));
SELECT pg_temp.ok('pending registry vocabulary is still waiting for ratification, never consumer-ready', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'property'))
  WHERE registration_state = 'pending_ratification' AND definition_matches
    AND consumer_state = 'unverified' AND next_action = 'curator_review'));
SELECT pg_temp.ok('unreviewed engine-family wall remains open even though an apply function exists', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress('6b9de10b-1666-4bdf-bb69-7e82d62f8b32')
  WHERE proposal_status = 'open' AND registration_state = 'not_approved'
    AND registered_id IS NULL AND consumer_state = 'unverified' AND next_action = 'curator_review'));
SELECT pg_temp.refused('retry cannot approve the open engine-family proposal',
  $$SELECT public.fn_schema_proposal_apply('6b9de10b-1666-4bdf-bb69-7e82d62f8b32')$$, 'expected approved');

-- A contextual relationship definition is synthetic test vocabulary. This fixture
-- does not ratify a production role or turn browsing into a professional identity.
INSERT INTO p VALUES ('contextual_role', pg_temp.propose('add_property',
  '{"property_key":"contract_participation","label":"Attributed participation",
    "data_type":"jsonb","namespace_request":"core","cardinality":"multi",
    "applies_to_kinds":["activity"],"expected_source_categories":["documentation"],
    "description":"Actor participation in one cited activity, subject and time; not a permanent persona.",
    "verification_scope":"instance"}'));
SELECT pg_temp.review((SELECT id FROM p WHERE name = 'contextual_role'), '00000000-0000-0000-0000-00000000a001', 'approve');
SELECT public.fn_schema_proposal_apply((SELECT id FROM p WHERE name = 'contextual_role'));
SELECT pg_temp.ok('review still creates core vocabulary; registration does not certify intake or the consumer', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'contextual_role'))
  WHERE proposal_status = 'approved' AND registration_state = 'core_registered'
    AND definition_matches AND consumer_state = 'unverified' AND next_action = 'verify_intake_and_consumer'));

-- Savepoints model external drift without leaving these mutations in the fixture.
BEGIN;
UPDATE public.observation_properties SET description = 'Changed meaning'
WHERE proposed_by_proposal_id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.ok('changed meaning is a registration defect', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'contextual_role'))
  WHERE registration_state = 'registration_drift' AND definition_matches = false));
SELECT pg_temp.refused('retry never overwrites a later definition',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.observation_properties SET proposed_by_proposal_id = NULL
WHERE proposed_by_proposal_id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.refused('an exact definition without this proposal attribution is refused',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.observation_properties SET trust_floor = 0.90
WHERE proposed_by_proposal_id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.refused('changed trust policy is not the original definition',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.observation_properties SET parent_property_id = (SELECT id FROM public.observation_properties WHERE property_key = 'engine_code')
WHERE proposed_by_proposal_id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.refused('changed parent meaning is not the original definition',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.observation_properties SET deprecated_at = now()
WHERE proposed_by_proposal_id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.ok('retired vocabulary requires review', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'contextual_role'))
  WHERE registration_state = 'retired' AND next_action = 'curator_review'));
SELECT pg_temp.refused('retry never resurrects retired vocabulary',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.schema_proposals SET promoted_to_id = '00000000-0000-0000-0000-ffffffffffff'
WHERE id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.refused('missing linked property is not silently recreated',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;
BEGIN;
UPDATE public.schema_proposals SET promoted_to_id = (SELECT promoted_to_id FROM public.schema_proposals WHERE id = (SELECT id FROM p WHERE name = 'property'))
WHERE id = (SELECT id FROM p WHERE name = 'contextual_role');
SELECT pg_temp.refused('foreign registration cannot satisfy this proposal',
  format('SELECT public.fn_schema_proposal_apply(%L)', (SELECT id FROM p WHERE name = 'contextual_role')), 'registration drift');
ROLLBACK;

INSERT INTO p VALUES ('name_collision', pg_temp.propose('add_property',
  '{"property_key":"contract_participation","label":"Permanent persona","data_type":"boolean"}'));
SELECT pg_temp.refused('same name with a different meaning is not reused on approval',
  format('SELECT pg_temp.review(%L, %L, %L)', (SELECT id FROM p WHERE name = 'name_collision'),
    '00000000-0000-0000-0000-00000000a001', 'approve'), 'duplicate key');
SELECT pg_temp.ok('failed approval rolls back its review and status', EXISTS (
  SELECT 1 FROM public.schema_proposals sp WHERE id = (SELECT id FROM p WHERE name = 'name_collision')
    AND status = 'open' AND promoted_to_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.schema_proposal_reviews r WHERE r.proposal_id = sp.id)));
BEGIN;
UPDATE public.schema_proposals SET status = 'approved' WHERE id = (SELECT id FROM p WHERE name = 'name_collision');
SELECT pg_temp.ok('reader distinguishes a name collision from missing vocabulary', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'name_collision'))
  WHERE registration_state = 'name_collision' AND next_action = 'curator_review'));
ROLLBACK;

SELECT pg_temp.ok('source registration never certifies the proposed definition or consumer', EXISTS (
  SELECT 1 FROM public.schema_proposals sp CROSS JOIN LATERAL public.get_schema_proposal_progress(sp.id) pr
  WHERE sp.proposal_type = 'add_source' AND sp.status = 'approved'
    AND pr.registration_state = 'source_registered_definition_unverified'
    AND pr.definition_matches IS NULL AND pr.consumer_state = 'unverified'));
INSERT INTO p VALUES ('manual_table', pg_temp.propose('add_table', '{"table":"never_executed"}'));
BEGIN;
UPDATE public.schema_proposals SET status = 'approved' WHERE id = (SELECT id FROM p WHERE name = 'manual_table');
SELECT pg_temp.ok('approval of manual DDL never appears as completed registration', EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress((SELECT id FROM p WHERE name = 'manual_table'))
  WHERE registration_state = 'manual_verification_required' AND next_action = 'inspect_type_specific_implementation'));
ROLLBACK;
SELECT pg_temp.ok('unknown proposal returns no invented progress', NOT EXISTS (
  SELECT 1 FROM public.get_schema_proposal_progress('00000000-0000-0000-0000-ffffffffffff')));

SELECT pg_temp.ok('approval machinery, apply privileges and invoker boundary are unchanged',
  NOT EXISTS (SELECT 1 FROM retry_approval_before b JOIN pg_proc f ON f.oid = b.oid
    WHERE pg_get_functiondef(f.oid) IS DISTINCT FROM b.definition OR f.proacl IS DISTINCT FROM b.proacl
      OR f.proconfig IS DISTINCT FROM b.proconfig)
  AND (SELECT proacl FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure)
    IS NOT DISTINCT FROM (SELECT proacl FROM retry_apply_before)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_schema_proposal_apply(uuid)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_schema_proposal_progress(uuid)'::regprocedure)
  AND has_function_privilege('service_role', 'public.get_schema_proposal_progress(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_schema_proposal_progress(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_schema_proposal_progress(uuid)', 'EXECUTE'));
SET ROLE anon;
SELECT pg_temp.refused('anonymous reader cannot access proposal progress',
  $$SELECT * FROM public.get_schema_proposal_progress('6b9de10b-1666-4bdf-bb69-7e82d62f8b32')$$, 'permission denied');
RESET ROLE;

CREATE TEMP TABLE retry_def_once AS SELECT pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure) AS d;
\ir ../migrations/20261011223810_schema_proposal_retry_and_progress.sql
SELECT pg_temp.ok('migration can be reapplied with the same definition',
  (SELECT d FROM retry_def_once) = pg_get_functiondef('public.fn_schema_proposal_apply(uuid)'::regprocedure));
\echo 'schema proposal retry and progress: all checks passed; consumer replay remains unverified'
