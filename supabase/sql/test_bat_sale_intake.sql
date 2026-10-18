\set ON_ERROR_STOP on
\ir helpers/bat_sale_intake_fixture.sql
SELECT fixture_capture(1);
SELECT fixture_capture(90,'{"is_public":false}');
SELECT fixture_capture(91,'{"metadata":{"vehicle_matched":false}}');
SELECT fixture_capture(92,'{"platform":"other"}');
\ir ../migrations/20261008001520_automate_bat_archived_sale_intake.sql
SELECT fixture_assert((SELECT pg_typeof(produces_kinds)::text='observation_kind[]' AND produces_kinds=ARRAY['sale_result']::observation_kind[] FROM observation_extractors WHERE slug='bat-archived-sale-v1'),'registered kinds use the actual production enum array');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='partial','unstarted scan remains partial');
UPDATE bat_sale_replay_state SET started_at=now()-interval '16 minutes';
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='failed','no fabricated startup progress');
UPDATE bat_sale_replay_state SET started_at=now();
SELECT fixture_assert((SELECT count(*)=1 FROM claim_bat_sale_snapshots('worker1',20)),'retained seed admits only eligible header');
SELECT fixture_assert((SELECT keys_seen=3 AND seed_queued=1 AND scan_completed_at IS NOT NULL FROM bat_sale_replay_state),'finite scan visits failed qualification headers without fabricating observations');
SELECT fixture_assert(NOT enqueue_bat_sale_snapshot(md5('fixture-capture-1')::uuid),'capture work idempotent');
SELECT fixture_assert(NOT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'wrong','skipped',NULL,'source_sale_conflict'),'wrong lease cannot complete');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done')$a$,'missing canonical key refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done','99999999-9999-9999-9999-999999999999')$a$,'nonexistent canonical key refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-90')::uuid))$a$,'wrong parent capture observation refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"kind":"bid"}'))$a$,'wrong kind refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"method":"ai"}'))$a$,'unprotected method refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"superseded":true}'))$a$,'superseded result refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"receipt":{"source_sha256":"bad"}}'))$a$,'receipt SHA mismatch refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"receipt":{"original_parsed_at":"bad"}}'))$a$,'receipt parse clock mismatch refused');
SELECT fixture_reject($a$SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid,'{"receipt":{"snapshot_id":null}}'))$a$,'NULL receipt ancestry refused');
SELECT fixture_assert(finish_bat_sale_snapshot((SELECT id FROM derivation_queue),'worker1','done',fixture_observation(md5('fixture-capture-1')::uuid)),'exact canonical receipt completes');
SELECT fixture_assert((SELECT source_sale_observation_id=observation_ids[1] AND cardinality(observation_ids)=1 AND cost_cents=0 FROM derivation_queue),'typed and array result agree without cost');
SELECT fixture_assert(NOT(read_bat_sale_intake(md5('fixture-capture-1')::uuid)->>'stale')::boolean,'cached reader initially fresh');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='passed','scoped completed known-work assay passes');
SELECT fixture_assert((SELECT health_status='failed' FROM v_job_health WHERE jobname='qualify-bat-archived-sales'),'no cron evidence is not healthy');
INSERT INTO cron.job_run_details(jobid,status,start_time) SELECT jobid,'succeeded',now() FROM cron.job WHERE jobname='qualify-bat-archived-sales';
SELECT fixture_assert((SELECT health_status='passed' AND assay_status='passed' FROM v_job_health WHERE jobname='qualify-bat-archived-sales'),'natural cadence and actual assay combined');
UPDATE vehicles SET is_public=false WHERE id=md5('fixture-vehicle-1')::uuid;
SELECT fixture_assert((read_bat_sale_intake(md5('fixture-capture-1')::uuid)->>'stale')::boolean,'parent privacy makes cached result stale');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='failed' AND assay_bat_sale_intake()#>>'{counts,stale_qualified}'='1','privacy withdrawal also fails coverage assay');
UPDATE vehicles SET is_public=true WHERE id=md5('fixture-vehicle-1')::uuid;
UPDATE listing_page_snapshots SET html_sha256=repeat('b',64) WHERE id=md5('fixture-capture-1')::uuid;
SELECT fixture_assert((read_bat_sale_intake(md5('fixture-capture-1')::uuid)->>'stale')::boolean,'changed capture SHA makes cached result stale');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='failed','changed protected input not silently healthy');
UPDATE listing_page_snapshots SET html_sha256=repeat('a',64) WHERE id=md5('fixture-capture-1')::uuid;
SELECT fixture_assert((SELECT count(*)=1 FROM derivation_queue),'metadata updates do not duplicate completed work');
SELECT fixture_capture(2);
SELECT fixture_assert((SELECT count(*)=1 FROM derivation_queue WHERE status='pending'),'incremental capture behind completed cursor reaches queue');
SELECT fixture_assert((SELECT count(*)=1 FROM claim_bat_sale_snapshots('worker2',1)),'incremental claim');
SELECT fixture_assert(finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker2','retry',NULL,'batch_budget_deferred'),'unstarted budget returns lease');
SELECT fixture_assert((SELECT attempts=0 AND status='pending' AND next_attempt_at>now()+interval '14 minutes' FROM derivation_queue WHERE evidence_id=md5('fixture-capture-2')::uuid),'budget deferral preserves attempts and backoff');
UPDATE derivation_queue SET next_attempt_at=now() WHERE evidence_id=md5('fixture-capture-2')::uuid;
SELECT count(*) FROM claim_bat_sale_snapshots('worker2',1);
SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker2','retry',NULL,'intake_request_failed');
SELECT fixture_assert((SELECT status='pending' AND attempts=1 AND next_attempt_at>now()+interval '14 minutes' FROM derivation_queue WHERE evidence_id=md5('fixture-capture-2')::uuid),'transient backoff');
UPDATE derivation_queue SET next_attempt_at=now() WHERE evidence_id=md5('fixture-capture-2')::uuid;
SELECT count(*) FROM claim_bat_sale_snapshots('worker2',1);
SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker2','retry',NULL,'intake_request_failed');
UPDATE derivation_queue SET next_attempt_at=now() WHERE evidence_id=md5('fixture-capture-2')::uuid;
SELECT count(*) FROM claim_bat_sale_snapshots('worker2',1);
SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker2','retry',NULL,'intake_request_failed');
SELECT fixture_assert((SELECT attempts=3 AND status='failed' FROM derivation_queue WHERE evidence_id=md5('fixture-capture-2')::uuid),'three failures pause record');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='failed','record failure visible in assay');
SELECT fixture_assert((SELECT count(*)=0 FROM claim_bat_sale_snapshots('worker2',20)),'failed record not repeatedly stolen');
SELECT fixture_capture(3);
SELECT count(*) FROM claim_bat_sale_snapshots('worker3',20);
SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker3','skipped',NULL,'current_sourced_sale_unknown');
SELECT fixture_assert((SELECT attempts=0 AND status='skipped' AND next_attempt_at>now()+interval '23 hours' FROM derivation_queue WHERE evidence_id=md5('fixture-capture-3')::uuid),'semantic refusal explicit and daily recheck');
SELECT fixture_assert((SELECT count(*)=0 FROM claim_bat_sale_snapshots('worker3',20)),'refused work does not churn');
UPDATE derivation_queue SET next_attempt_at=now() WHERE evidence_id=md5('fixture-capture-3')::uuid;
SELECT fixture_assert((SELECT count(*)=1 FROM claim_bat_sale_snapshots('worker3',20)),'daily refusal can qualify after current fact repair');
SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE status='claimed'),'worker3','done',fixture_observation(md5('fixture-capture-3')::uuid));
SELECT fixture_assert((SELECT status='done' AND attempts=1 AND error_message IS NULL FROM derivation_queue WHERE evidence_id=md5('fixture-capture-3')::uuid),'later qualified refusal preserves canonical record');
SELECT fixture_capture(4);
SELECT count(*) FROM claim_bat_sale_snapshots('expired',20);
UPDATE derivation_queue SET locked_at=now()-interval '11 minutes' WHERE evidence_id=md5('fixture-capture-4')::uuid;
SELECT fixture_assert((SELECT count(*)=0 FROM claim_bat_sale_snapshots('recovery',20)),'expired lease waits recovery backoff');
SELECT fixture_assert((SELECT status='pending' AND locked_by IS NULL AND error_message='lease_expired' AND next_attempt_at>now()+interval '14 minutes' FROM derivation_queue WHERE evidence_id=md5('fixture-capture-4')::uuid),'lease recovery retained');
-- Legacy user/comment claims and existing API grants keep their original shape.
INSERT INTO derivation_queue(evidence_type,evidence_id,extractor_slug,user_id) VALUES
 ('receipt',gen_random_uuid(),'fixture-private-reader','11111111-1111-1111-1111-111111111111'),
 ('auction_comment',gen_random_uuid(),'fixture-comment-reader',NULL);
SELECT fixture_assert((SELECT count(*)=1 FROM claim_derivation_work('legacy',5,'11111111-1111-1111-1111-111111111111')),'private owner selector conserved');
SELECT fixture_assert((SELECT count(*)=1 FROM claim_derivation_work('legacy',5,NULL)),'public comment selector conserved and source lane excluded');
SELECT fixture_assert(NOT has_function_privilege('anon','claim_bat_sale_snapshots(text,integer)','EXECUTE'),'anon claim denied');
SELECT fixture_assert(NOT has_function_privilege('authenticated','finish_bat_sale_snapshot(uuid,text,text,uuid,text)','EXECUTE'),'signed-in completion denied');
SELECT fixture_assert(NOT has_function_privilege('anon','read_bat_sale_intake(uuid)','EXECUTE'),'anon cached receipt denied');
SELECT fixture_assert(NOT has_function_privilege('authenticated','assay_bat_sale_intake()','EXECUTE'),'signed-in assay denied');
SELECT fixture_assert(NOT has_table_privilege('service_role','bat_sale_replay_state','INSERT,UPDATE,DELETE,TRUNCATE'),'service direct operational mutation denied');
SELECT fixture_assert(has_function_privilege('service_role','claim_derivation_work(text,integer,uuid)','EXECUTE'),'existing dispatcher grant retained');
SET ROLE service_role;
SELECT fixture_assert((read_bat_sale_intake(md5('fixture-capture-1')::uuid)->>'status')='done','actual service cached reader permitted');
SELECT fixture_assert(assay_bat_sale_intake()->>'status'='failed','service assay sees paused work');
RESET ROLE;
SELECT fixture_assert((SELECT count(*)=4 FROM pipeline_registry),'four earned owner registrations');
SELECT fixture_assert((SELECT count(*)=11 FROM pg_attribute a WHERE a.attnum>0 AND NOT a.attisdropped
 AND ((a.attrelid='bat_sale_replay_state'::regclass) OR (a.attrelid='derivation_queue'::regclass AND a.attname LIKE 'source_%'))
 AND col_description(a.attrelid,a.attnum) IS NOT NULL),'all11 earned columns described');
SELECT fixture_assert((SELECT count(*)=4 FROM pg_constraint WHERE contype='f' AND(conrelid='bat_sale_replay_state'::regclass OR(conrelid='derivation_queue'::regclass AND conname LIKE '%source_%'))),'all four new typed ancestry FKs');
SELECT fixture_assert((SELECT active AND schedule='*/5 * * * *' AND command LIKE '%"dry_run":false%' AND command LIKE '%60000%' AND command LIKE '%get_service_role_key_for_cron()%'
 FROM cron.job WHERE jobname='qualify-bat-archived-sales'),'standing existing-owner bounded cron with credential helper');
SELECT fixture_assert((SELECT html='PRIVATE SYNTHETIC HTML' AND html_sha256=repeat('a',64) AND metadata->>'parsed_at'='2025-06-16T12:00:00Z' FROM listing_page_snapshots WHERE id=md5('fixture-capture-1')::uuid),'capture testimony preserved');
