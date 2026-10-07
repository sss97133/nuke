-- Run in an empty dm_refinement_* PG17 database; no live testimony or jobs.
\set ON_ERROR_STOP on
\ir test_sale_residuals_by_ymm.sql
CREATE TABLE public.make_model_profiles(subject_id uuid PRIMARY KEY,grain text,year integer,canonical_make text,canonical_model text);
INSERT INTO public.make_model_profiles VALUES('11111111-1111-1111-1111-111111111111','year',1970,'Synthetic','Coupe');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
INSERT INTO public.vehicles SELECT DISTINCT (e->>'vehicleId')::uuid FROM public.fixture_sales;
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
-- Preserve the same synthetic owner, adding the registered key its production
-- counterpart returns. The separate integration test uses the actual parser.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure);
 IF position($s$'cohort',jsonb_build_object('complete'$s$ IN d)=0 THEN RAISE EXCEPTION 'Fixture owner shape changed'; END IF;
 d:=replace(d,$s$'cohort',jsonb_build_object('complete'$s$,
 $s$'cohort',jsonb_build_object('key',(SELECT subject_id FROM public.make_model_profiles WHERE year=$1 AND lower(canonical_make)=lower($2) AND lower(canonical_model)=lower($3)),'complete'$s$);
 EXECUTE d;
END $$;
\ir helpers/sale_residual_worker_fixture.sql
CREATE TEMP TABLE original_health_columns AS SELECT column_name,data_type,ordinal_position FROM information_schema.columns
 WHERE table_schema='public' AND table_name='v_job_health';
\ir ../migrations/20261007192300_sale_residual_standing_fold.sql
SELECT pg_temp.ok('pilot enqueues twelve closed months, not a fleet',
 (SELECT count(*)=12 AND count(DISTINCT subject_id)=1 AND bool_and(month::timestamptz+interval '1 month'<=statement_timestamp()) FROM sale_residual_fold_queue));
SELECT pg_temp.ok('initial pilot starts with the assayed month when still in rolling scope',
 (SELECT month FROM sale_residual_fold_queue ORDER BY id LIMIT 1)=
 (SELECT month FROM (SELECT (date_trunc('month',statement_timestamp())-make_interval(months=>i))::date AS month
  FROM generate_series(1,12) i) months ORDER BY months.month=date '2026-03-01' DESC,months.month DESC LIMIT 1));
SELECT pg_temp.ok('one finite scheduled task per five minutes',
 (SELECT schedule='*/5 * * * *' AND active AND command LIKE '%statement_timeout=''35s''%' FROM cron.job WHERE jobname='drain-sale-residual-fold'));
SELECT pg_temp.ok('new tables are registered and every column described',
 (SELECT count(*)=4 FROM pipeline_registry WHERE table_name LIKE 'sale_residual_%')
 AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  WHERE c.relname IN ('sale_residual_fold_queue','sale_residual_fold_runs','sale_residual_episode_measurements','sale_residual_episode_locations')
   AND a.attnum>0 AND NOT a.attisdropped AND col_description(c.oid,a.attnum) IS NULL));
SELECT pg_temp.ok('job-health columns and grants remain compatible',
 NOT EXISTS((SELECT * FROM original_health_columns EXCEPT SELECT column_name,data_type,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='v_job_health'))
 AND NOT has_table_privilege('anon','v_job_health','SELECT') AND has_table_privilege('service_role','v_job_health','SELECT'));
SELECT pg_temp.ok('enqueue alone cannot pass a yield assay',assay_sale_residual_fold()->>'status'='partial');
SELECT pg_temp.ok('receipt tables reject direct service-role DML and truncate',
 NOT has_table_privilege('service_role','sale_residual_fold_runs','INSERT,UPDATE,DELETE,TRUNCATE')
 AND NOT has_table_privilege('service_role','sale_residual_episode_measurements','INSERT,UPDATE,DELETE,TRUNCATE')
 AND NOT has_table_privilege('service_role','sale_residual_episode_locations','INSERT,UPDATE,DELETE,TRUNCATE')
 AND NOT has_function_privilege('anon','drain_sale_residual_fold()','EXECUTE'));
DO $$ BEGIN
 BEGIN PERFORM enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111',date_trunc('month',now())::date); RAISE EXCEPTION 'accepted open month';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted open month' THEN RAISE; END IF; END;
END $$;
-- Keep the test focused on two explicit keys; automatic seed must not revive
-- disabled existing keys, nor reset completed/failed work on every cron run.
UPDATE sale_residual_fold_queue SET enabled=false;
CREATE TEMP TABLE task AS SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01') AS id;
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-04-01');
UPDATE sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE id=(SELECT id FROM task);
CREATE TEMP TABLE first_run AS SELECT drain_sale_residual_fold() AS output;
SELECT pg_temp.ok('one due task lands keyed residuals and witnesses',
 (SELECT output->>'status'='processed' AND output->>'processed'='1' AND output->>'new_revision'='true'
  AND output->>'episodes_landed'='2' AND output->>'location_edges_landed'='2' FROM first_run)
 AND (SELECT count(*)=1 FROM sale_residual_fold_runs)
 AND (SELECT count(*)=2 FROM sale_residual_episode_measurements)
 AND (SELECT count(*)=2 FROM sale_residual_episode_locations)
 AND (SELECT last_verified_at IS NOT NULL AND next_due_at>now()+interval '5 hours' FROM sale_residual_fold_queue WHERE id=(SELECT id FROM task)));
SELECT pg_temp.ok('other due task remains available after bounded drain',
 (SELECT count(*)=1 FROM sale_residual_fold_queue WHERE enabled AND last_verified_at IS NULL));
SELECT pg_temp.ok('cached reader exposes the complete immutable receipt without rescanning',
 read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')#>>'{receipt,coverage,residuals}'='2'
 AND read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')->>'stale'='false');
CREATE TEMP TABLE prior_receipt AS SELECT * FROM sale_residual_fold_runs;
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true);
UPDATE sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE id=(SELECT id FROM task);
CREATE TEMP TABLE replay AS SELECT drain_sale_residual_fold() AS output;
SELECT pg_temp.ok('later-clock identical-input replay reuses immutable revision',
 (SELECT output->>'new_revision'='false' AND output->>'episodes_landed'='0' FROM replay)
 AND (SELECT count(*)=1 FROM sale_residual_fold_runs)
 AND NOT EXISTS(SELECT 1 FROM prior_receipt p JOIN sale_residual_fold_runs r USING(id) WHERE p.receipt<>r.receipt));
-- Synthetic retained evidence changes; never do this to production testimony.
UPDATE fixture_sales SET e=jsonb_set(e,'{amount}','300') WHERE e->>'sourceKey' LIKE '%-11';
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true);
UPDATE sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE id=(SELECT id FROM task);
SELECT drain_sale_residual_fold();
SELECT pg_temp.ok('changed evidence appends a revision and retains earlier receipt',
 (SELECT count(*)=2 FROM sale_residual_fold_runs)
 AND (SELECT count(*)=4 FROM sale_residual_episode_measurements)
 AND NOT EXISTS(SELECT 1 FROM prior_receipt p JOIN sale_residual_fold_runs r USING(id) WHERE p.receipt<>r.receipt)
 AND read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')#>>'{receipt,sales,0,amount}'='300');
DO $$ BEGIN
 BEGIN UPDATE sale_residual_fold_runs SET receipt='{}' WHERE id=(SELECT id FROM prior_receipt); RAISE EXCEPTION 'mutated receipt';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='mutated receipt' THEN RAISE; END IF; END;
 BEGIN DELETE FROM sale_residual_episode_measurements WHERE run_id=(SELECT id FROM prior_receipt); RAISE EXCEPTION 'deleted episode';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='deleted episode' THEN RAISE; END IF; END;
 BEGIN DELETE FROM sale_residual_episode_locations WHERE run_id=(SELECT id FROM prior_receipt); RAISE EXCEPTION 'deleted witness';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='deleted witness' THEN RAISE; END IF; END;
 BEGIN UPDATE sale_residual_fold_queue SET last_run_id=(SELECT id FROM prior_receipt) WHERE id<>(SELECT id FROM task); RAISE EXCEPTION 'cross-task pointer';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT pg_temp.ok('typed witness and vehicle/county foreign keys are present',
 (SELECT count(*)>=7 FROM pg_constraint WHERE contype='f' AND conrelid IN
  ('sale_residual_fold_queue'::regclass,'sale_residual_fold_runs'::regclass,'sale_residual_episode_measurements'::regclass,'sale_residual_episode_locations'::regclass)));
-- Failure remains visible even though a SQL cron can return successfully.
UPDATE fixture_contract SET error='synthetic source refusal';
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true);
DO $$ DECLARE i integer; r jsonb; BEGIN
 FOR i IN 1..3 LOOP
  UPDATE sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE id=(SELECT id FROM task);
  r:=drain_sale_residual_fold(); PERFORM pg_temp.ok('caught reader failure does not discard retry accounting',r->>'status'='failed');
 END LOOP;
END $$;
SELECT pg_temp.ok('third failure pauses task, retains its receipt and makes cached reader stale',
 (SELECT NOT enabled AND consecutive_failures=3 AND last_run_id IS NOT NULL FROM sale_residual_fold_queue WHERE id=(SELECT id FROM task))
 AND assay_sale_residual_fold()->>'status'='failed'
 AND read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')->>'stale'='true');
SELECT seed_sale_residual_fold_pilot();
SELECT pg_temp.ok('normal seed never silently resumes failed or disabled tasks',
 (SELECT NOT enabled FROM sale_residual_fold_queue WHERE id=(SELECT id FROM task))
 AND (SELECT count(*)=0 FROM sale_residual_fold_queue WHERE subject_id='22222222-2222-2222-2222-222222222222' AND enabled));
INSERT INTO cron.job_run_details(jobid,status,start_time,return_message)
 SELECT jobid,'succeeded',statement_timestamp(),'1 row' FROM cron.job WHERE jobname='drain-sale-residual-fold';
SELECT pg_temp.ok('existing job health uses yield assay despite successful cron return',
 (SELECT health_status='failed' AND assay_status='failed' FROM v_job_health WHERE jobname='drain-sale-residual-fold'));
UPDATE fixture_contract SET error=NULL;
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true);
UPDATE sale_residual_fold_queue SET next_due_at='2020-01-01' WHERE id=(SELECT id FROM task);
SELECT drain_sale_residual_fold();
SELECT pg_temp.ok('explicit replay recovers the paused task without duplicating known revision',
 (SELECT enabled AND consecutive_failures=0 AND last_error IS NULL FROM sale_residual_fold_queue WHERE id=(SELECT id FROM task))
 AND (SELECT count(*)=2 FROM sale_residual_fold_runs));
BEGIN;
SELECT drain_sale_residual_fold();
SELECT pg_temp.ok('completed source yield and successful cron can pass the existing health owner',
 assay_sale_residual_fold()->>'status'='passed'
 AND (SELECT health_status='passed' FROM v_job_health WHERE jobname='drain-sale-residual-fold'));
UPDATE sale_residual_fold_queue SET last_verified_at=now()-interval '7 hours' WHERE id=(SELECT id FROM task);
SELECT pg_temp.ok('stale verification fails assay and is exposed by cached reader',
 assay_sale_residual_fold()->>'status'='failed'
 AND read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')->>'stale'='true');
ROLLBACK;
BEGIN;
DO $$ DECLARE i integer:=0; BEGIN
 WHILE (SELECT count(*) FROM sale_residual_fold_queue WHERE enabled)<100 LOOP
  PERFORM enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111',(date '1990-01-01'+make_interval(months=>i))::date); i:=i+1;
 END LOOP;
 BEGIN PERFORM enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2010-01-01'); RAISE EXCEPTION 'capacity bypassed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='capacity bypassed' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
SELECT pg_temp.ok('bounded write receipts name actual landed derived rows',
 (SELECT sum(rows)=2 FROM write_receipts WHERE tbl='sale_residual_fold_runs' AND op='INSERT' AND writer='drain_sale_residual_fold')
 AND (SELECT sum(rows)=4 FROM write_receipts WHERE tbl='sale_residual_episode_measurements' AND op='INSERT'));
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('actual service role can read cached output and invoke sanctioned replay',
 read_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01')#>>'{receipt,coverage,residuals}'='2');
SELECT enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true);
DO $$ BEGIN
 BEGIN UPDATE public.sale_residual_fold_runs SET method=method; RAISE EXCEPTION 'service raw write leaked';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.sale_residual_fold_runs CASCADE; RAISE EXCEPTION 'service truncate leaked';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
