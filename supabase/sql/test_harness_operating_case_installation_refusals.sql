-- Exercise the exact migration text in rollbackable dynamic SQL. psql COPY
-- reads the local tracked file on the client; no server file or OS access.
\set ON_ERROR_STOP on
\i supabase/sql/fixtures/harness_operating_case_setup.sql
\i supabase/migrations/20261126181729_harness_model_dc_compute.sql
\i supabase/sql/fixtures/harness_operating_case_installation_proposal.sql
CREATE TEMP TABLE installation_lines(seq bigint GENERATED ALWAYS AS IDENTITY,line text);
\copy installation_lines(line) FROM 'supabase/migrations/20261127031811_harness_operating_case_runtime_installation.sql' WITH (FORMAT csv,DELIMITER E'\001',QUOTE E'\002',ESCAPE E'\002',NULL E'\003')
CREATE TEMP TABLE installation_body AS
 SELECT regexp_replace(substr(s,strpos(s,E'\nBEGIN;\n')+length(E'\nBEGIN;\n')),E'\nCOMMIT;[\n\r ]*$','') AS sql
 FROM (SELECT string_agg(line,E'\n' ORDER BY seq) s FROM installation_lines) x;
SELECT public.t_assert((SELECT sql LIKE 'SET LOCAL statement_timeout=%' AND sql NOT LIKE '%\nCOMMIT;%' FROM installation_body),
 'client-loaded installer strips only its outer transaction boundaries');
CREATE FUNCTION pg_temp.expect_install_refusal(expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false;state text;before_row jsonb;after_row jsonb;before_worker text;
BEGIN
 SELECT to_jsonb(p) INTO before_row FROM public.schema_proposals p;
 before_worker:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 BEGIN
  EXECUTE (SELECT sql FROM installation_body);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state=returned_sqlstate;
  IF state IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, got % (%)',label,expected,state,SQLERRM;END IF;
  refused:=true;
 END;
 PERFORM public.t_assert(refused,label);
 SELECT to_jsonb(p) INTO after_row FROM public.schema_proposals p;
 PERFORM public.t_assert(before_row IS NOT DISTINCT FROM after_row,
  label||': proposal state and attribution remain unchanged');
 PERFORM public.t_assert(NOT EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'harness_operating_case_%')
  AND NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.model_fold_tick_runs'::regclass AND attname='dc_status' AND NOT attisdropped)
  AND (SELECT pg_get_functiondef(oid)=before_worker FROM pg_proc WHERE oid='public.model_fold_tick()'::regprocedure),
  label||': no partial operating functions, telemetry or worker changes survive');
END $$;

BEGIN;
DELETE FROM public.schema_proposals;
SELECT pg_temp.expect_install_refusal('23514','missing proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET proposed_by_user_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_install_refusal('23514','foreign user proposer');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET proposed_by_agent_key='foreign-agent';
SELECT pg_temp.expect_install_refusal('23514','foreign agent proposer');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET proposal_type='add_column';
SELECT pg_temp.expect_install_refusal('23514','different proposal type');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET payload=payload||'{"foreign":true}';
SELECT pg_temp.expect_install_refusal('23514','changed payload');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET evidence=evidence||'[{}]';
SELECT pg_temp.expect_install_refusal('23514','changed evidence');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET estimated_scope=estimated_scope||'{"foreign":true}';
SELECT pg_temp.expect_install_refusal('23514','changed scope');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET backward_compatibility=backward_compatibility||'{"foreign":true}';
SELECT pg_temp.expect_install_refusal('23514','changed compatibility');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET supersedes_proposal_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_install_refusal('23514','different predecessor proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET superseded_by='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_install_refusal('23514','superseded proposal pointer');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET promoted_to_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_install_refusal('23514','foreign promoted identity');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET motivating_observation_ids=ARRAY['d0000000-0000-4000-8000-000000000001']::uuid[];
SELECT pg_temp.expect_install_refusal('23514','changed motivating observation scope');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET motivating_pending_claim_ids=ARRAY['d0000000-0000-4000-8000-000000000001']::uuid[];
SELECT pg_temp.expect_install_refusal('23514','changed pending-claim scope');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='under_review';
SELECT pg_temp.expect_install_refusal('55000','under_review proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='rejected';
SELECT pg_temp.expect_install_refusal('55000','rejected proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='withdrawn';
SELECT pg_temp.expect_install_refusal('55000','withdrawn proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='superseded';
SELECT pg_temp.expect_install_refusal('55000','superseded proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='needs_changes';
SELECT pg_temp.expect_install_refusal('55000','needs_changes proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET claimed_by_user_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_install_refusal('55000','claimed proposal');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET claimed_at=now();
SELECT pg_temp.expect_install_refusal('55000','claimed proposal clock');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET decision_rationale='separate unresolved review';
SELECT pg_temp.expect_install_refusal('55000','existing decision rationale');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET resolved_at=now();
SELECT pg_temp.expect_install_refusal('55000','existing resolution clock');
ROLLBACK;

BEGIN;
INSERT INTO public.schema_proposal_reviews SELECT id,'approve' FROM public.schema_proposals;
SELECT pg_temp.expect_install_refusal('55000','open unresolved review');
ROLLBACK;

BEGIN;
INSERT INTO public.schema_proposal_reviews SELECT id,'reject' FROM public.schema_proposals;
SELECT pg_temp.expect_install_refusal('55000','reject review');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='approved'; INSERT INTO public.schema_proposal_reviews SELECT id,'reject' FROM public.schema_proposals;
SELECT pg_temp.expect_install_refusal('55000','approved status with rejecting review');
ROLLBACK;

BEGIN;
CREATE TABLE public.harness_model_dc_runs(id uuid);
SELECT pg_temp.expect_install_refusal('55000','partial installation collision');
ROLLBACK;

BEGIN;
UPDATE public.schema_proposals SET status='approved';
INSERT INTO public.schema_proposal_reviews SELECT id,'needs_changes' FROM public.schema_proposals;
SELECT pg_temp.expect_install_refusal('55000','approved status with needs-changes review');
ROLLBACK;

-- Definition drift outside every retained replacement anchor must also refuse.
BEGIN;
DO $drift$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure);
 a text:=$a$if not coalesce((cfg ->> 'enabled')::boolean, false) then return; end if;$a$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Fixture worker control anchor drift';END IF;
 EXECUTE replace(b,a,'if false then return; end if;');
END $drift$;
SELECT pg_temp.expect_install_refusal('23514','worker control drift outside installer patch anchors');
ROLLBACK;
BEGIN;
ALTER PROCEDURE public.model_fold_tick() SECURITY DEFINER;
SELECT pg_temp.expect_install_refusal('23514','worker definer drift');
ROLLBACK;
BEGIN;
ALTER PROCEDURE public.model_fold_tick() SET search_path=public;
SELECT pg_temp.expect_install_refusal('23514','worker transaction configuration drift');
ROLLBACK;
BEGIN;
CREATE ROLE fixture_operating_foreign_owner;
ALTER PROCEDURE public.model_fold_tick() OWNER TO fixture_operating_foreign_owner;
SELECT pg_temp.expect_install_refusal('23514','worker owner drift');
ROLLBACK;
BEGIN;
DO $drift$
DECLARE b text;d text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO b,d FROM pg_proc WHERE oid='public.harness_model_dc_compute(jsonb)'::regprocedure;
 EXECUTE replace(d,b,b||E'\n-- fixture kernel drift\n');
END $drift$;
SELECT pg_temp.expect_install_refusal('23514','kernel interpreter drift');
ROLLBACK;

BEGIN;
GRANT EXECUTE ON PROCEDURE public.model_fold_tick() TO anon;
SELECT pg_temp.expect_install_refusal('23514','worker anonymous execution drift');
ROLLBACK;
BEGIN;
GRANT EXECUTE ON PROCEDURE public.model_fold_tick() TO authenticated;
SELECT pg_temp.expect_install_refusal('23514','worker authenticated execution drift');
ROLLBACK;
BEGIN;
REVOKE EXECUTE ON PROCEDURE public.model_fold_tick() FROM service_role;
SELECT pg_temp.expect_install_refusal('23514','worker service execution drift');
ROLLBACK;

-- A consumer changed after proposal review: DDL and worker edits have already
-- run before this exact-body guard fails. The full attempt must roll back.
BEGIN;
DO $drift$
DECLARE b text;d text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO b,d FROM pg_proc WHERE oid='public.model_fold_queue_gauge()'::regprocedure;
 EXECUTE replace(d,b,b||E'\n-- fixture integration drift\n');
END $drift$;
SELECT pg_temp.expect_install_refusal('P0001','late retained-consumer drift rolls back every installed object');
SELECT public.t_assert(NOT EXISTS(SELECT FROM pg_class WHERE relnamespace='public'::regnamespace
 AND relname IN('harness_operating_cases','harness_operating_case_revisions','harness_operating_case_wires',
 'harness_operating_case_elements','harness_operating_case_boundaries','harness_model_dc_runs','harness_model_dc_wire_inputs',
 'harness_model_dc_node_results','harness_model_dc_branch_results','harness_model_dc_issues')),
 'late installer failure rolls back all ten tables');
ROLLBACK;
-- An approved proposal with only approving reviews keeps that decision intact.
BEGIN;
UPDATE public.schema_proposals SET status='approved',resolved_at='2026-11-26T00:00:00Z',decision_rationale='prior authorized review';
INSERT INTO public.schema_proposal_reviews SELECT id,'approve' FROM public.schema_proposals;
CREATE TEMP TABLE approving_review_before AS SELECT to_jsonb(p) AS row FROM public.schema_proposals p;
DO $install$ BEGIN EXECUTE (SELECT sql FROM installation_body);END $install$;
SELECT public.t_assert((SELECT to_jsonb(p)=(SELECT row FROM approving_review_before) FROM public.schema_proposals p)
 AND (SELECT count(*)=1 AND bool_and(decision='approve') FROM public.schema_proposal_reviews),
 'existing approved proposal and its approving review remain unchanged');
ROLLBACK;

-- A pre-existing approved decision is consumed, not rewritten as agent approval.
UPDATE public.schema_proposals SET status='approved',resolved_at='2026-11-26T00:00:00Z',decision_rationale='prior authorized review';
CREATE TEMP TABLE previously_approved AS SELECT to_jsonb(p) AS row FROM public.schema_proposals p;
\i supabase/migrations/20261127031811_harness_operating_case_runtime_installation.sql
SELECT public.t_assert((SELECT to_jsonb(p)=(SELECT row FROM previously_approved) FROM public.schema_proposals p),
 'installation preserves a pre-existing approved decision and its clock');
SELECT public.t_assert((SELECT count(*)=0 FROM public.schema_proposal_reviews)
 AND coalesce(current_setting('nuke.schema_proposal_key_gate',true),'')='',
 'installation creates no reviewer or measured-key gate marker');
