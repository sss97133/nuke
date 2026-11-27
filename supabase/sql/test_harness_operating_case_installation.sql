-- Same complete runtime behavior contract, using the real production migration.
\set ON_ERROR_STOP on
\set operating_installation true
\i supabase/sql/test_harness_operating_case_runtime.sql
SELECT public.t_assert((SELECT status='approved' AND resolved_at IS NOT NULL
 AND decision_rationale LIKE '%implementing agent wrote this metadata%'
 AND proposed_by_user_id IS NULL AND gate_measure IS NULL
 AND (to_jsonb(p)-ARRAY['status','resolved_at','decision_rationale'])=
  ((SELECT row FROM operating_proposal_before)-ARRAY['status','resolved_at','decision_rationale'])
 FROM public.schema_proposals p),
 'installation records only authorized build metadata without changing the proposal definition or inventing a user');
SELECT public.t_assert((SELECT count(*)=0 FROM public.schema_proposal_reviews)
 AND coalesce(current_setting('nuke.schema_proposal_key_gate',true),'')='',
 'manual installation creates no human review or measured-key approval context');
