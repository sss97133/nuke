-- Empty disposable PG17. Real captured control/dispatch bodies; existing
-- generic producers and the domain writer are deterministic scheduling stubs.
\set ON_ERROR_STOP on
\i supabase/sql/fixtures/harness_worker_phase_setup.sql
\i supabase/sql/fixtures/harness_worker_consumer_setup.sql
\i supabase/migrations/20261126071000_harness_worker_phase.sql

CREATE FUNCTION pg_temp.reset_phase() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 TRUNCATE public.model_fold_signal,public.model_fold_work,public.model_fold_ticks,public.model_fold_tick_runs,
  public.worker_phase_calls,public.harness_model_state,public.harness_model_evaluations;
 PERFORM set_config('test.harness_mode','',false),set_config('test.vehicle_mode','',false),
  set_config('test.harness_ms','0',false),set_config('test.vehicle_ms','0',false),set_config('test.sweep_ms','0',false),
  set_config('test.auction_yield','false',false),set_config('model_fold.in_tick','',false);
 UPDATE public.platform_config SET config_value=config_value||'{"enabled":true,"signals_enabled":true,"max_attempts":2,"budget_ms":6000,"max_active_backends":60}' WHERE config_key='model_fold';
 INSERT INTO public.model_fold_work(vehicle_id,priority,reasons,first_dirty_at,dirty_at,next_attempt_at,edited_origins)
 VALUES('a0000000-0000-4000-8000-000000000001',2,ARRAY['harness:fixture','generic input'],
 clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '5 minutes',clock_timestamp(),ARRAY[md5('initial origin')::uuid]);
END $$;

SELECT pg_temp.reset_phase();
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='pending' AND fold_stage='vehicle_followup' AND attempts=0
 AND folded_at IS NULL AND folded_key IS NULL AND leased_until IS NULL AND lease_tick IS NULL
 AND reasons=ARRAY['harness:fixture','generic input'] AND edited_origins=ARRAY[md5('initial origin')::uuid]
 FROM public.model_fold_work WHERE vehicle_id=:fb1),'domain does not finish generic work or clear its inputs');
SELECT public.t_assert((SELECT count(*)=1 AND bool_and(phase='harness') FROM public.worker_phase_calls)
 AND (SELECT count(*)=1 AND bool_and(fold_phase='harness' AND harness_status='current' AND harness_evaluation_id IS NOT NULL)
 FROM public.model_fold_tick_runs)
 AND (SELECT folded=0 AND claimed=1 FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1),
 'first tick records a typed domain receipt and reports no completed vehicle fold');
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' AND attempts=0 AND cardinality(edited_origins)=0
 AND folded_key=public.model_fold_logic_key() FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness')
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='vehicle'),
 'following tick completes generic work without repeating the domain');

-- Domain errors keep their own backoff and cannot erase or starve generic work.
SELECT pg_temp.reset_phase();
SELECT set_config('test.harness_mode','error',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT failure_count=1 AND last_error_code='22023' AND retry_after>clock_timestamp()
 FROM public.harness_model_state WHERE vehicle_id=:fb1)
 AND (SELECT fold_stage='vehicle_followup' AND attempts=0 FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT failed=1 AND folded=0 FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1),
 'domain error is recorded without consuming the generic attempt budget');
SELECT set_config('test.harness_mode','',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT failure_count=1 AND last_error_code='22023' FROM public.harness_model_state WHERE vehicle_id=:fb1)
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness'),
 'generic followup runs during domain backoff and cannot manufacture domain success');

-- Busy domain gets a generic followup even while the cursor remains due.
SELECT pg_temp.reset_phase();
SELECT set_config('test.harness_mode','busy',false);
CALL public.model_fold_tick();
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='vehicle')
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness')
 AND (SELECT state='pending' AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'busy domain cannot continuously preempt generic work');

-- New input during either phase stays pending and keeps unconsumed origin IDs.
SELECT pg_temp.reset_phase();
SELECT set_config('test.harness_mode','dirty',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT edited_origins @> ARRAY[md5('initial origin')::uuid,md5('during harness')::uuid]
 AND fold_stage='vehicle_followup' FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'domain phase preserves dirty-event origins');
SELECT set_config('test.harness_mode','',false),set_config('test.vehicle_mode','dirty',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='pending' AND fold_stage='normal' AND edited_origins=ARRAY[md5('during vehicle')::uuid]
 FROM public.model_fold_work WHERE vehicle_id=:fb1),'generic followup preserves a newly landed origin and due domain');
SELECT set_config('test.vehicle_mode','',false);
CALL public.model_fold_tick();
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' AND cardinality(edited_origins)=0 FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT source_epoch=folded_epoch FROM public.harness_model_state WHERE vehicle_id=:fb1),'new source eventually reaches both phases');

-- A domain phase must not reset generic failures. New domain work is not a
-- fresh generic input budget and cannot prevent its eventual dead letter.
SELECT pg_temp.reset_phase();
CALL public.model_fold_tick();
SELECT set_config('test.vehicle_mode','error',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='pending' AND attempts=1 FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'first generic failure retained');
UPDATE public.harness_model_state SET source_epoch=source_epoch+1 WHERE vehicle_id=:fb1;
UPDATE public.model_fold_work SET next_attempt_at=clock_timestamp() WHERE vehicle_id=:fb1;
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT attempts=1 AND fold_stage='vehicle_followup' FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'another domain phase preserves previous generic failures');
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='dead' AND attempts=2 AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'generic dead-letter threshold is unchanged');

-- Global controls run before phase admission. They leave the same pending row.
SELECT pg_temp.reset_phase();
UPDATE public.platform_config SET config_value=config_value||'{"enabled":false}' WHERE config_key='model_fold';
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT count(*)=0 FROM public.model_fold_ticks) AND (SELECT count(*)=0 FROM public.worker_phase_calls),
 'global disabled means no phase or tick');
UPDATE public.platform_config SET config_value=config_value||'{"enabled":true}' WHERE config_key='model_fold';
SELECT set_config('test.auction_yield','true',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT status='skipped' AND skip_reason LIKE 'auction closes:%' FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1)
 AND (SELECT count(*)=0 FROM public.worker_phase_calls),'auction close yield still precedes all work');
SELECT set_config('test.auction_yield','false',false);
UPDATE public.platform_config SET config_value=config_value||'{"max_active_backends":-1}' WHERE config_key='model_fold';
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT status='skipped' AND skip_reason LIKE 'active backends%' FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1)
 AND (SELECT state='pending' AND attempts=0 AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'backend backpressure never leases a domain');

-- Published domain phase has a real same-vehicle evaluation key.
SELECT pg_temp.reset_phase();
CALL public.model_fold_tick();
DO $$
BEGIN
 BEGIN
  INSERT INTO public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,harness_status,harness_evaluation_id)
  SELECT gen_random_uuid(),'a0000000-0000-4000-8000-000000000004','harness','current',id FROM public.harness_model_evaluations LIMIT 1;
  RAISE EXCEPTION 'crossvehicle run linkage accepted' USING ERRCODE='XX001';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.harness_model_due('a0000000-0000-4000-8000-000000000001',md5('x'),2);
  RAISE EXCEPTION 'public dispatcher predicate exposed' USING ERRCODE='XX001';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT 'harness_worker_phase scheduling: PASS' AS result;

-- Public timing gauges count the original vehicle grain separately. Generic
-- revert cannot mark a retained immutable domain evaluation as undone.
SELECT pg_temp.reset_phase();
CALL public.model_fold_tick();
SELECT public.t_assert((public.model_fold_queue_gauge()#>>'{fold_ms_24h,n}')::int=0
 AND (public.model_fold_queue_gauge()#>>'{harness_phases_24h,runs}')::int=1,
 'domain phase is not counted as a general vehicle timing');
CREATE TEMP TABLE phase_revert_result AS SELECT public.model_fold_revert_v1((SELECT tick_id FROM public.model_fold_tick_runs LIMIT 1)) AS result;
SELECT public.t_assert((SELECT (result->>'vehicles')::int=0 FROM phase_revert_result)
 AND (SELECT bool_and(reverted_at IS NULL) FROM public.model_fold_tick_runs)
 AND (SELECT state='pending' AND fold_stage='vehicle_followup' FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT source_epoch=folded_epoch FROM public.harness_model_state WHERE vehicle_id=:fb1)
 AND (SELECT revert_summary->>'harness_receipts_retained'='1' AND status<>'reverted' FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1),
 'generic revert reports retained domain and preserves its receipt and pending followup');
CALL public.model_fold_tick();
SELECT public.t_assert((public.model_fold_queue_gauge()#>>'{fold_ms_24h,n}')::int=1
 AND (public.model_fold_queue_gauge()#>>'{harness_phases_24h,runs}')::int=1,
 'following vehicle timing has its original grain');
TRUNCATE phase_revert_result;
INSERT INTO phase_revert_result SELECT public.model_fold_revert_v1((SELECT tick_id FROM public.model_fold_tick_runs WHERE fold_phase='vehicle' LIMIT 1));
SELECT public.t_assert((SELECT (result->>'vehicles')::int=1 FROM phase_revert_result)
 AND (SELECT state='pending' AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT bool_and(reverted_at IS NULL) FROM public.model_fold_tick_runs WHERE fold_phase='harness'),
 'generic reversal still requeues its vehicle and retains independent domain');

-- The shared due predicate preserves retry exhaustion and code-change revival.
SELECT pg_temp.reset_phase();
SELECT set_config('test.harness_mode','error',false);
CALL public.model_fold_tick();
UPDATE public.harness_model_state SET retry_after=clock_timestamp()-interval '1 minute',failure_count=2 WHERE vehicle_id=:fb1;
SELECT public.t_assert(NOT public.harness_model_due(:fb1,public.harness_model_logic_key(),2),
 'exhausted unchanged interpretation does not re-admit');
SELECT set_config('test.harness_logic','new interpretation',false);
SELECT public.t_assert(public.harness_model_due(:fb1,public.harness_model_logic_key(),2),
 'new code can revive an exhausted interpretation');

-- An interrupted followup lease retains its durable stage and edited origins.
SELECT pg_temp.reset_phase();
CALL public.model_fold_tick();
INSERT INTO public.model_fold_ticks(tick_id,status,pid,started_at)
 VALUES(md5('phase interrupted tick')::uuid,'running',0,clock_timestamp()-interval '2 minutes');
UPDATE public.model_fold_work SET state='leased',lease_tick=md5('phase interrupted tick')::uuid,
 leased_until=clock_timestamp()-interval '1 minute' WHERE vehicle_id=:fb1;
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT fold_stage='vehicle_followup' AND state='pending'
 AND edited_origins=ARRAY[md5('initial origin')::uuid] FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'lease recovery preserves the pending followup and original input');
UPDATE public.model_fold_work SET next_attempt_at=clock_timestamp() WHERE vehicle_id=:fb1;
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness'),
 'recovered followup does not repeat a committed domain');

-- Signals-disabled stops seeder admission, while source invalidation remains.
SELECT pg_temp.reset_phase();
TRUNCATE public.model_fold_work;
INSERT INTO public.harness_model_state(vehicle_id) VALUES(:fb1);
UPDATE public.platform_config SET config_value=config_value||'{"signals_enabled":false}' WHERE config_key='model_fold';
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT count(*)=0 FROM public.worker_phase_calls)
 AND (SELECT count(*)=0 FROM public.model_fold_signal)
 AND (SELECT folded_epoch IS NULL FROM public.harness_model_state WHERE vehicle_id=:fb1),
 'signals disabled does not admit a stale domain');
UPDATE public.platform_config SET config_value=config_value||'{"signals_enabled":true}' WHERE config_key='model_fold';
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness'),
 'enabled seeder uses the same due predicate and existing queue');

-- A non-harness work item keeps the ordinary single-pass worker path.
SELECT pg_temp.reset_phase();
UPDATE public.model_fold_work SET vehicle_id=:mus;
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:mus)
 AND (SELECT count(*)=0 FROM public.worker_phase_calls WHERE phase='harness')
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='vehicle'),
 'unrelated vehicle work keeps its original path');

-- Timing proof uses a REDUCED ceiling and never restores/increases it. The
-- combined direct caller remains compatible and records a domain timeout; the
-- same workloads succeed in two managed commands. Native PostgreSQL verifies
-- the timer; WASM/local timings are not production capacity evidence.
SET statement_timeout='800ms';
SELECT pg_temp.reset_phase();
UPDATE public.platform_config SET config_value=config_value||'{"budget_ms":600}' WHERE config_key='model_fold';
SELECT set_config('test.harness_ms','400',false),set_config('test.vehicle_ms','500',false);
SELECT public.model_fold_one(gen_random_uuid(),:fb1,public.model_fold_config(),'{}');
SELECT public.t_assert((SELECT last_error_code='57014' AND folded_epoch IS NULL FROM public.harness_model_state WHERE vehicle_id=:fb1),
 'combined workload exceeds the reduced statement limit');
SELECT pg_temp.reset_phase();
UPDATE public.platform_config SET config_value=config_value||'{"budget_ms":600}' WHERE config_key='model_fold';
SELECT set_config('test.harness_ms','400',false),set_config('test.vehicle_ms','500',false),set_config('test.sweep_ms','350',false);
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT count(*)=0 FROM public.worker_phase_calls)
 AND (SELECT state='pending' AND fold_stage='normal' AND attempts=0 FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT skip_reason='harness phase reserved for a fresh tick' AND claimed=0 FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1),
 'insufficient remaining time leaves the selected row unchanged');
SELECT set_config('test.sweep_ms','0',false);
CALL public.model_fold_tick();
CALL public.model_fold_tick();
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT source_epoch=folded_epoch AND last_error_code IS NULL FROM public.harness_model_state WHERE vehicle_id=:fb1)
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='harness')
 AND (SELECT count(*)=1 FROM public.worker_phase_calls WHERE phase='vehicle'),
 'separate phases fit the same reduced ceiling without duplicate domain work');
SELECT 'test_harness_worker_phase: PASS' AS result;
