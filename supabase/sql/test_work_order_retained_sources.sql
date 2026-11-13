-- Disposable PG17. Full canonical job build, then synthetic source-to-consumer contracts.
\ir test_job_loop_replay.sql

INSERT INTO auth.users VALUES ('11000000-0000-0000-0000-000000000001'),('11000000-0000-0000-0000-000000000002');
INSERT INTO actors VALUES ('61000000-0000-0000-0000-000000000001','Fixture Technician','individual');
INSERT INTO vehicles(id,owner_id,uploaded_by,year,make,model) VALUES
 ('41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001',1983,'GMC','Truck');
INSERT INTO work_orders(id,vehicle_id,customer_id,title,status,completed_at) VALUES
 ('31000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002','Client build','paid','2024-08-29'),
 ('31000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',NULL,'Earlier personal build','in_progress',NULL);
INSERT INTO work_sessions(id,user_id,vehicle_id) VALUES
 ('71000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method) VALUES
 ('72000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','nuke_actor','61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','self_claim');
SELECT public.approve_actor_link_claim('72000000-0000-0000-0000-000000000001','work_evidence',
 '[{"kind":"work_session","id":"71000000-0000-0000-0000-000000000001"}]', '10000000-0000-0000-0000-00000000000a');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,content_text,observed_at,structured_data) VALUES
 ('82000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',
  'Fixture Technician owes Fixture Customer DELIVERY of the completed truck. Report says Sign tier; it is still a retained report.', '2026-07-15',
  '{"trust":"owner_stated","client":"Fixture Customer (private@example.invalid)","obligation":"delivery_to_client","payment_status":"paid_in_full","invoices":[{"amount":999999}]}'),
 ('82000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',
  'Build log row 1', '2024-08-29','{"subject":"client_billing_line","log":"Fixture build log","client":"Fixture Customer (private@example.invalid)","row":1,"item":"Transmission linkage","category":"transmission","billing_column":"Done","billed_usd":888888}'),
 ('82000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',
  'Build log row 2', '2024-08-29','{"subject":"client_billing_line","log":"Fixture build log","client":"Fixture Customer (private@example.invalid)","row":2,"item":"Cooler lines","billing_column":"Later invoice"}'),
 ('82000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',
  'Unrelated document', '2024-08-29','{"subject":"client_billing_line","log":"Other document","client":"Fixture Customer (private@example.invalid)","row":1,"item":"Not this job"}'),
 ('83000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001',
  'Interpretation binds original scope and original responsibility, without a new signature.', '2026-07-15',
  '{"work_order_resource":{"version":1,"event_type":"retained_source_binding","work_order_id":"31000000-0000-0000-0000-000000000001","scope_basis_observation_id":"82000000-0000-0000-0000-000000000002","responsibility_basis_observation_id":"82000000-0000-0000-0000-000000000001","provider_actor_id":"61000000-0000-0000-0000-000000000001","reported_client_label":"Fixture Customer","responsibility_excerpt":"Fixture Technician owes Fixture Customer DELIVERY of the completed truck."}}');

SELECT t_assert((project_work_order_resource_observation('83000000-0000-0000-0000-000000000001')->>'duplicate')::boolean IS FALSE,
 'existing work_resource dispatcher projects source binding');
SELECT t_assert((project_work_order_resource_observation('83000000-0000-0000-0000-000000000001')->>'duplicate')::boolean,
 'identical replay is idempotent');
SELECT t_assert((SELECT count(*)=1 FROM work_order_retained_source_bindings), 'single index row recovers a whole retained document');
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000001',false);
CREATE TEMP TABLE read_receipt AS SELECT work_order_retained_sources_read('31000000-0000-0000-0000-000000000001',NULL,1) r;
SELECT t_assert(r->>'visibility'='included' AND r#>>'{coverage,total_source_entries}'='2'
 AND jsonb_array_length(r->'scope_entries')=1 AND r->>'next_after_source_id' IS NOT NULL,
 'evidenced responsible technician reads paginated original scope, unrelated document excluded') FROM read_receipt;
SELECT t_assert(r#>>'{scope_entries,0,billing_column}'='Done'
 AND r#>>'{scope_entries,0,execution_state}'='not_established_by_billing_entry'
 AND r->>'physical_completion'='not_inferred' AND r->>'money_authorized'='false',
 'Done is retained billing, never physical completion or money authority') FROM read_receipt;
SELECT t_assert(r#>>'{responsibility_reports,0,payment_state}'='paid_in_full'
 AND r#>>'{responsibility_reports,0,delivery_state}'='reported_owed'
 AND r#>>'{responsibility_reports,0,assurance}'='retained_owner_report_not_sign',
 'reported paid and delivery owed coexist without a fabricated Sign') FROM read_receipt;
SELECT t_assert(r::text NOT LIKE '%private@example.invalid%' AND r::text NOT LIKE '%999999%' AND r::text NOT LIKE '%888888%',
 'reader omits raw contacts, payment amounts and billing amounts') FROM read_receipt;
SELECT t_assert(jsonb_array_length(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001',
 (SELECT (r->>'next_after_source_id')::uuid FROM read_receipt),1)->'scope_entries')=1,
 'next page accesses remaining source row');
SELECT t_assert(my_work_orders('responsible')#>>'{coverage,total_for_viewer}'='1'
 AND my_work_orders('responsible')#>>'{rows,0,work_order_id}'='31000000-0000-0000-0000-000000000001'
 AND my_work_orders('responsible')#>>'{rows,0,retained_work,coverage,total_source_entries}'='2',
 'technician queue includes exactly the reported client job, not personal accumulator');
SELECT t_assert(NOT job_reader_is_party(ARRAY['vehicle_access','admin'])
 AND NOT (my_work_orders('responsible')#>'{rows,0,slots}' ? 'performer')
 AND my_work_orders('responsible')#>>'{rows,0,money_visible}'='false',
 'responsible cohort does not add performer or financial rights');
SELECT t_assert((my_work_orders(NULL)#>>'{coverage,total_for_viewer}')::int>=2,
 'legacy all-accessible cohort still includes the earlier personal build');
SELECT t_assert(work_order_job_path_read('31000000-0000-0000-0000-000000000001')#>>'{retained_work,coverage,total_source_entries}'='2',
 'existing JobPage reader carries original source rows');

-- An admin may already access the job, but is not its provider by virtue of admin access.
SELECT set_config('test.auth_uid','10000000-0000-0000-0000-00000000000a',false);
SELECT t_assert(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')->>'visibility'='withheld',
 'unrelated accessible admin does not receive original private scope');
SELECT t_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(my_work_orders('responsible')->'rows') j
 WHERE j->>'work_order_id'='31000000-0000-0000-0000-000000000001'), 'admin access alone is not a work responsibility');
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000a','nuke_actor','61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','self_claim');
SELECT t_assert(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')->>'visibility'='withheld',
 'self-claimed actor cannot read private source rows');
SELECT set_config('test.auth_uid','10000000-0000-0000-0000-00000000000b',false);
SELECT t_assert(t_refused_with($q$SELECT work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')$q$,'unavailable'),
 'unrelated account with no job access is refused');
SELECT set_config('test.auth_uid','',false);
SELECT t_assert(t_refused_with($q$SELECT work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')$q$,'Sign-in required'),
 'anonymous read refused');
SELECT t_assert(NOT has_function_privilege('authenticated','project_work_order_retained_source(uuid)','EXECUTE')
 AND NOT has_table_privilege('authenticated','work_order_retained_source_bindings','SELECT')
 AND NOT has_table_privilege('service_role','work_order_retained_source_bindings','INSERT')
 AND NOT has_function_privilege('authenticated','work_order_retained_sources_for_viewer(uuid,uuid,text[],uuid,integer)','EXECUTE'),
 'private projector and helper cannot be called by a spoofed viewer and direct writes are refused');

-- Changed, withdrawn and reattributed originals lose current-reader eligibility without rewriting history.
BEGIN;
UPDATE vehicle_observations SET is_superseded=true WHERE id='82000000-0000-0000-0000-000000000001';
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000001',true);
SELECT t_assert(my_work_orders('responsible')#>>'{coverage,total_for_viewer}'='0', 'withdrawn duty report no longer populates technician queue');
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000002',true);
SELECT t_assert(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')#>>'{coverage,total_source_entries}'='2'
 AND jsonb_array_length(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')->'responsibility_reports')=0,
 'withdrawing responsibility preserves valid scope for an existing customer');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET is_superseded=true WHERE id='82000000-0000-0000-0000-000000000003';
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000002',true);
SELECT t_assert(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')#>>'{coverage,total_source_entries}'='1',
 'withdrawing a non-basis row removes only that source row');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET is_superseded=true WHERE id='82000000-0000-0000-0000-000000000002';
SELECT t_assert((SELECT count(*)=0 FROM current_work_order_retained_sources()), 'withdrawn scope basis withholds the document binding');
SELECT set_config('test.auth_uid','11000000-0000-0000-0000-000000000001',true);
SELECT t_assert(my_work_orders('responsible')#>>'{coverage,total_for_viewer}'='1'
 AND jsonb_array_length(work_order_retained_sources_read('31000000-0000-0000-0000-000000000001')->'responsibility_reports')=1,
 'withdrawing document scope does not erase independently supported responsibility');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET vehicle_id='40000000-0000-0000-0000-000000000002' WHERE id='82000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT count(*)=0 FROM current_work_order_retained_responsibilities()), 'reattributed responsibility loses eligibility');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET content_text='Changed without supersession' WHERE id='83000000-0000-0000-0000-000000000001';
SELECT t_assert((SELECT count(*)=0 FROM current_work_order_retained_sources()), 'changed interpretation fails immutable fingerprint');
SELECT t_assert(t_refused_with($q$SELECT project_work_order_resource_observation('83000000-0000-0000-0000-000000000001')$q$,'supersede'),
 'changed source cannot overwrite a projected interpretation');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET source_id='90000000-0000-0000-0000-000000000002' WHERE id='83000000-0000-0000-0000-000000000001';
SELECT t_assert(t_refused_with($q$SELECT project_work_order_resource_observation('83000000-0000-0000-0000-000000000001')$q$,'internal-inference'),
 'original sources cannot masquerade as interpretation envelopes');
ROLLBACK;
BEGIN;
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{work_order_resource,work_order_id}',
 '"31000000-0000-0000-0000-000000000002"') WHERE id='83000000-0000-0000-0000-000000000001';
INSERT INTO vehicle_observations SELECT '83000000-0000-0000-0000-000000000002',vehicle_id,kind,source_id,
 source_identifier,content_text,content_hash,extraction_method,confidence,confidence_score,structured_data,observed_at,
 observed_at_basis,source_event_at,source_event_time_precision,ingested_at,is_superseded,submitted_by_user_id,observer_raw,
 superseded_by,superseded_at,lineage_chain FROM vehicle_observations WHERE id='83000000-0000-0000-0000-000000000001';
-- Restore the first interpretation before checking simultaneous active job allocation.
UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{work_order_resource,work_order_id}',
 '"31000000-0000-0000-0000-000000000001"') WHERE id='83000000-0000-0000-0000-000000000001';
SELECT t_assert(t_refused_with($q$SELECT project_work_order_resource_observation('83000000-0000-0000-0000-000000000002')$q$,'already bound'),
 'same whole document cannot be silently assigned to a second active job');
ROLLBACK;
SELECT t_assert(t_refused($q$DELETE FROM work_order_retained_source_bindings$q$), 'typed index is immutable');
SELECT t_assert(NOT EXISTS(SELECT 1 FROM work_order_line_items WHERE work_order_id='31000000-0000-0000-0000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM work_order_assignments WHERE work_order_id='31000000-0000-0000-0000-000000000001')
 AND (SELECT status='paid' AND completed_at='2024-08-29' FROM work_orders WHERE id='31000000-0000-0000-0000-000000000001')
 AND (SELECT owner_id='11000000-0000-0000-0000-000000000002' FROM vehicles WHERE id='41000000-0000-0000-0000-000000000001'),
 'projection does not fabricate operations, assignments, completion, payment or ownership mutations');
