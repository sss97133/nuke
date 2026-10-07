-- Owner: leave retained data flowing, 2026-10-07. Extend the qualified S01
-- reader, not the sale parser. Pre-mint/live ownership and bounded pilot:
-- docs/proposals/2026-10-07-sale-residual-worker.md. One task per five minutes;
-- rolling12 closed pilot months; six-hour polling invalidation; no paid calls.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';

CREATE TABLE public.sale_residual_fold_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES public.make_model_profiles(subject_id),
  month date NOT NULL CHECK (isfinite(month) AND month>=date '1990-01-01' AND month=date_trunc('month',month)::date),
  currency text NOT NULL CHECK (currency IN ('USD','EUR','GBP')),
  enabled boolean NOT NULL DEFAULT true,
  next_due_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_verified_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 3),
  last_error text,
  last_run_id bigint,
  UNIQUE(subject_id,month,currency)
);
CREATE INDEX sale_residual_fold_due ON public.sale_residual_fold_queue(next_due_at,id) WHERE enabled;

CREATE TABLE public.sale_residual_fold_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_id bigint NOT NULL REFERENCES public.sale_residual_fold_queue(id),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  method text NOT NULL CHECK (method='sale_residual_month_start_v2'),
  evidence_as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object' AND receipt->>'status' IN ('computed','insufficient_baseline')),
  UNIQUE(queue_id,input_sha256),
  UNIQUE(id,queue_id)
);
ALTER TABLE public.sale_residual_fold_queue ADD CONSTRAINT sale_residual_latest_own_task
  FOREIGN KEY(last_run_id,id) REFERENCES public.sale_residual_fold_runs(id,queue_id);

CREATE TABLE public.sale_residual_episode_measurements (
  run_id bigint NOT NULL REFERENCES public.sale_residual_fold_runs(id),
  source_key text NOT NULL CHECK (btrim(source_key)<>''),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  event_day date NOT NULL CHECK (isfinite(event_day)),
  snapshot_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount>0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  log_residual numeric CHECK (log_residual::text NOT IN ('NaN','Infinity','-Infinity')),
  county_fips text REFERENCES public.us_county_boundaries(fips),
  geography_status text NOT NULL CHECK (geography_status IN ('same_listing_county','same_listing_county_missing','same_listing_county_conflict','location_scan_limit')),
  PRIMARY KEY(run_id,source_key),
  CHECK ((geography_status='same_listing_county')=(county_fips IS NOT NULL))
);
CREATE INDEX sale_residual_episode_vehicle ON public.sale_residual_episode_measurements(vehicle_id,run_id);
CREATE INDEX sale_residual_episode_county ON public.sale_residual_episode_measurements(county_fips,run_id) WHERE county_fips IS NOT NULL;

CREATE TABLE public.sale_residual_episode_locations (
  run_id bigint NOT NULL,
  source_key text NOT NULL,
  location_observation_id uuid NOT NULL REFERENCES public.vehicle_location_observations(id),
  PRIMARY KEY(run_id,source_key,location_observation_id),
  FOREIGN KEY(run_id,source_key) REFERENCES public.sale_residual_episode_measurements(run_id,source_key)
);
CREATE INDEX sale_residual_location_witness ON public.sale_residual_episode_locations(location_observation_id);

CREATE FUNCTION public.reject_sale_residual_revision_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Sale residual revisions and witness edges are immutable; append a new revision'; END $$;
CREATE TRIGGER sale_residual_runs_immutable BEFORE UPDATE OR DELETE ON public.sale_residual_fold_runs
  FOR EACH ROW EXECUTE FUNCTION public.reject_sale_residual_revision_change();
CREATE TRIGGER sale_residual_episodes_immutable BEFORE UPDATE OR DELETE ON public.sale_residual_episode_measurements
  FOR EACH ROW EXECUTE FUNCTION public.reject_sale_residual_revision_change();
CREATE TRIGGER sale_residual_locations_immutable BEFORE UPDATE OR DELETE ON public.sale_residual_episode_locations
  FOR EACH ROW EXECUTE FUNCTION public.reject_sale_residual_revision_change();

-- Service may read and use the writers, but cannot bypass immutable storage.
ALTER TABLE public.sale_residual_fold_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_residual_fold_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_residual_episode_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_residual_episode_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_residual_fold_queue,public.sale_residual_fold_runs,
  public.sale_residual_episode_measurements,public.sale_residual_episode_locations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sale_residual_fold_queue,public.sale_residual_fold_runs,
  public.sale_residual_episode_measurements,public.sale_residual_episode_locations TO service_role;
CREATE POLICY sale_residual_queue_read ON public.sale_residual_fold_queue FOR SELECT TO service_role USING(true);
CREATE POLICY sale_residual_runs_read ON public.sale_residual_fold_runs FOR SELECT TO service_role USING(true);
CREATE POLICY sale_residual_episodes_read ON public.sale_residual_episode_measurements FOR SELECT TO service_role USING(true);
CREATE POLICY sale_residual_locations_read ON public.sale_residual_episode_locations FOR SELECT TO service_role USING(true);
REVOKE ALL ON SEQUENCE public.sale_residual_fold_queue_id_seq,public.sale_residual_fold_runs_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.enqueue_sale_residual_fold(p_subject_id uuid,p_month date,p_currency text DEFAULT 'USD',p_replay boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET timezone='UTC' SET statement_timeout='5s' SET lock_timeout='1s'
AS $$
DECLARE v_id bigint; v_enabled boolean;
BEGIN
  IF p_month IS NULL OR NOT isfinite(p_month) OR p_month<date '1990-01-01'
     OR p_month<>date_trunc('month',p_month)::date
     OR p_month::timestamptz+interval '1 month'>statement_timestamp()
     OR p_currency IS NULL OR p_currency NOT IN ('USD','EUR','GBP')
     OR NOT EXISTS(SELECT 1 FROM public.make_model_profiles WHERE subject_id=p_subject_id AND grain='year' AND year IS NOT NULL) THEN
    RAISE EXCEPTION 'A registered year cohort, closed UTC month and supported currency are required';
  END IF;
  PERFORM pg_advisory_xact_lock(879104,2);
  SELECT id,enabled INTO v_id,v_enabled FROM public.sale_residual_fold_queue
    WHERE subject_id=p_subject_id AND month=p_month AND currency=p_currency;
  IF v_id IS NOT NULL AND NOT coalesce(p_replay,false) THEN RETURN v_id; END IF;
  IF (v_id IS NULL OR NOT v_enabled) AND (SELECT count(*) FROM public.sale_residual_fold_queue WHERE enabled)>=100 THEN
    RAISE EXCEPTION 'Enabled residual task capacity100 reached; inspect assay before expansion';
  END IF;
  PERFORM set_config('app.writer','drain_sale_residual_fold',true);
  INSERT INTO public.sale_residual_fold_queue(subject_id,month,currency)
    VALUES(p_subject_id,p_month,p_currency)
    ON CONFLICT(subject_id,month,currency) DO UPDATE SET enabled=true,next_due_at=statement_timestamp(),consecutive_failures=0,last_error=NULL
    RETURNING id INTO v_id;
  INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
    VALUES('sale_residual_fold_queue',CASE WHEN v_enabled IS NULL THEN 'INSERT' ELSE 'UPDATE' END,1,
      'drain_sale_residual_fold',session_user,current_setting('application_name',true),txid_current());
  RETURN v_id;
END $$;

CREATE FUNCTION public.seed_sale_residual_fold_pilot() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET timezone='UTC' SET statement_timeout='5s' SET lock_timeout='1s'
AS $$
DECLARE v_subject uuid; v_count integer; v_rows integer; v_month date;
BEGIN
  SELECT count(*),(array_agg(subject_id))[1] INTO v_count,v_subject FROM public.make_model_profiles
    WHERE grain='year' AND year=1963 AND lower(canonical_make)='chevrolet' AND lower(canonical_model)='corvette';
  IF v_count<>1 THEN RAISE EXCEPTION 'Pilot cohort is missing or ambiguous; no cohort minted'; END IF;
  PERFORM set_config('app.writer','drain_sale_residual_fold',true);
  UPDATE public.sale_residual_fold_queue SET enabled=false WHERE subject_id=v_subject AND currency='USD' AND enabled
    AND month<(date_trunc('month',statement_timestamp())-interval '12 months')::date;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows>0 THEN
    INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
      VALUES('sale_residual_fold_queue','UPDATE',v_rows,'drain_sale_residual_fold',session_user,current_setting('application_name',true),txid_current());
  END IF;
  -- Start with the already runtime-assayed pilot month while it is in scope;
  -- then newest first. This is only initial key order, not a second scheduler.
  FOR v_month IN SELECT month FROM (SELECT
    (date_trunc('month',statement_timestamp())-make_interval(months=>i))::date AS month
    FROM generate_series(1,12) i) months ORDER BY months.month=date '2026-03-01' DESC,months.month DESC LOOP
    PERFORM public.enqueue_sale_residual_fold(v_subject,v_month,'USD',false);
  END LOOP;
  RETURN 12;
END $$;

CREATE FUNCTION public.drain_sale_residual_fold() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET timezone='UTC' SET statement_timeout='30s' SET lock_timeout='1s'
AS $$
DECLARE
  q record; r jsonb; v_semantic jsonb; v_hash text; v_run bigint;
  v_new boolean; v_episodes integer:=0; v_edges integer:=0; v_started timestamptz:=clock_timestamp(); v_error text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(879104,1) THEN RETURN jsonb_build_object('status','skipped','reason','worker_already_running'); END IF;
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock')
     OR (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND state='active' AND pid<>pg_backend_pid())>8 THEN
    RETURN jsonb_build_object('status','skipped','reason','lock_or_load_governor');
  END IF;
  PERFORM public.seed_sale_residual_fold_pilot();
  SELECT t.*,m.year,m.canonical_make,m.canonical_model INTO q
    FROM public.sale_residual_fold_queue t JOIN public.make_model_profiles m ON m.subject_id=t.subject_id
    WHERE t.enabled AND t.next_due_at<=statement_timestamp()
    ORDER BY t.next_due_at,t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','idle','processed',0); END IF;
  PERFORM set_config('app.writer','drain_sale_residual_fold',true);
  BEGIN
    r:=public.sale_residuals_by_ymm(q.year,q.canonical_make,q.canonical_model,q.month,q.currency);
    IF r ? 'error' OR r->>'method' IS DISTINCT FROM 'sale_residual_month_start_v2'
       OR r#>>'{cohort,key}' IS DISTINCT FROM q.subject_id::text
       OR r#>>'{coverage,source_population_complete}' IS DISTINCT FROM 'true'
       OR r->>'status' IS NULL OR r->>'status' NOT IN ('computed','insufficient_baseline')
       OR jsonb_typeof(r->'sales') IS DISTINCT FROM 'array'
       OR jsonb_array_length(r->'sales')>500 THEN
      RAISE EXCEPTION 'Qualified residual receipt unavailable or incompatible';
    END IF;
    v_semantic:=jsonb_set(r-ARRAY['computed_at','evidence_as_of'],'{source_receipt}',
      (r->'source_receipt')-ARRAY['computed_at','evidence_as_of']);
    v_hash:=encode(extensions.digest(v_semantic::text,'sha256'),'hex');
    INSERT INTO public.sale_residual_fold_runs(queue_id,input_sha256,method,evidence_as_of,receipt)
      VALUES(q.id,v_hash,r->>'method',(r->>'evidence_as_of')::timestamptz,r)
      ON CONFLICT(queue_id,input_sha256) DO NOTHING RETURNING id INTO v_run;
    v_new:=FOUND;
    IF v_new THEN
      INSERT INTO public.sale_residual_episode_measurements(run_id,source_key,vehicle_id,event_day,snapshot_id,amount,log_residual,county_fips,geography_status)
        SELECT v_run,s->>'source_key',(s->>'vehicle_id')::uuid,(s->>'event_day')::date,(s->>'snapshot_id')::uuid,
          (s->>'amount')::numeric,(s->>'log_residual')::numeric,s->>'county_fips',s->>'geography_status'
        FROM jsonb_array_elements(r->'sales') s;
      GET DIAGNOSTICS v_episodes=ROW_COUNT;
      INSERT INTO public.sale_residual_episode_locations(run_id,source_key,location_observation_id)
        SELECT v_run,s->>'source_key',l.value::uuid FROM jsonb_array_elements(r->'sales') s
        CROSS JOIN LATERAL jsonb_array_elements_text(s->'location_observation_ids') l;
      GET DIAGNOSTICS v_edges=ROW_COUNT;
      INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
        SELECT tbl,'INSERT',n,'drain_sale_residual_fold',session_user,current_setting('application_name',true),txid_current()
        FROM (VALUES('sale_residual_fold_runs',1),('sale_residual_episode_measurements',v_episodes),('sale_residual_episode_locations',v_edges)) a(tbl,n) WHERE n>0;
    ELSE
      SELECT id INTO STRICT v_run FROM public.sale_residual_fold_runs WHERE queue_id=q.id AND input_sha256=v_hash;
    END IF;
    UPDATE public.sale_residual_fold_queue SET last_run_id=v_run,last_verified_at=statement_timestamp(),last_attempt_at=statement_timestamp(),
      next_due_at=statement_timestamp()+interval '6 hours',consecutive_failures=0,last_error=NULL WHERE id=q.id;
    INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
      VALUES('sale_residual_fold_queue','UPDATE',1,'drain_sale_residual_fold',session_user,current_setting('application_name',true),txid_current());
    IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock') THEN RAISE EXCEPTION 'Lock governor stopped fold'; END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    UPDATE public.sale_residual_fold_queue SET consecutive_failures=least(3,consecutive_failures+1),
      enabled=consecutive_failures+1<3,next_due_at=statement_timestamp()+interval '15 minutes',
      last_attempt_at=statement_timestamp(),last_error=left(v_error,300) WHERE id=q.id;
    INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
      VALUES('sale_residual_fold_queue','UPDATE',1,'drain_sale_residual_fold',session_user,current_setting('application_name',true),txid_current());
    RETURN jsonb_build_object('status','failed','processed',0,'task_id',q.id,'reason','receipt_or_write_failed');
  END;
  RETURN jsonb_build_object('status','processed','processed',1,'task_id',q.id,'run_id',v_run,
    'new_revision',v_new,'episodes_landed',v_episodes,'location_edges_landed',v_edges,
    'duration_ms',round(extract(epoch FROM clock_timestamp()-v_started)*1000));
END $$;

CREATE FUNCTION public.read_sale_residual_fold(p_subject_id uuid,p_month date,p_currency text DEFAULT 'USD') RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s'
AS $$
 SELECT coalesce((SELECT jsonb_build_object('task_id',q.id,'run_id',r.id,'receipt',r.receipt,
   'last_verified_at',q.last_verified_at,'enabled',q.enabled,'consecutive_failures',q.consecutive_failures,'last_error',q.last_error,
   'stale',q.last_verified_at IS NULL OR q.last_verified_at<statement_timestamp()-interval '6 hours 10 minutes' OR NOT q.enabled OR q.last_error IS NOT NULL,
   'verification_basis','same_qualified_input_hash_at_last_verification_original_receipt_cutoff_preserved')
  FROM public.sale_residual_fold_queue q LEFT JOIN public.sale_residual_fold_runs r ON r.id=q.last_run_id
  WHERE q.subject_id=$1 AND q.month=$2 AND q.currency=$3),jsonb_build_object('status','not_queued','stale',true));
$$;

CREATE FUNCTION public.assay_sale_residual_fold() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s'
AS $$
 WITH tasks AS MATERIALIZED (SELECT q.*,r.receipt FROM public.sale_residual_fold_queue q
   LEFT JOIN public.sale_residual_fold_runs r ON r.id=q.last_run_id WHERE q.enabled OR q.consecutive_failures=3),
 counts AS (SELECT count(*) AS tasks,count(*) FILTER(WHERE enabled AND next_due_at<=statement_timestamp()) AS due,
   count(*) FILTER(WHERE last_verified_at IS NULL) AS unassayed,
   count(*) FILTER(WHERE last_error IS NOT NULL) AS failed,
   count(*) FILTER(WHERE consecutive_failures=3) AS paused_failures,
   count(*) FILTER(WHERE enabled AND last_verified_at<statement_timestamp()-interval '6 hours 10 minutes') AS stale,
   coalesce(sum((receipt#>>'{coverage,residuals}')::integer),0) AS residuals,
   coalesce(sum((receipt#>>'{coverage,county_residuals}')::integer),0) AS county_residuals,
   min(next_due_at) FILTER(WHERE enabled AND next_due_at<=statement_timestamp()) AS oldest_due_at,
   max(last_verified_at) AS last_verified_at FROM tasks)
 SELECT jsonb_build_object('status',CASE WHEN tasks=0 THEN 'idle' WHEN paused_failures>0 OR stale>0 THEN 'failed'
   WHEN unassayed>0 OR failed>0 THEN 'partial' ELSE 'passed' END,
   'scope','registered_pilot_and_explicit_cohort_month_tasks','counts',to_jsonb(counts),
   'cadence','one_task_per_5_minutes_each_success_due_in_6_hours','invalidation','bounded_polling_active_months') FROM counts;
$$;

REVOKE ALL ON FUNCTION public.reject_sale_residual_revision_change(),public.enqueue_sale_residual_fold(uuid,date,text,boolean),
  public.seed_sale_residual_fold_pilot(),public.drain_sale_residual_fold(),public.read_sale_residual_fold(uuid,date,text),
  public.assay_sale_residual_fold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_sale_residual_fold(uuid,date,text,boolean),public.seed_sale_residual_fold_pilot(),
  public.drain_sale_residual_fold(),public.read_sale_residual_fold(uuid,date,text),public.assay_sale_residual_fold() TO service_role;

-- COMMENT ON is the atlas contract, including every column's grain and clock.
COMMENT ON TABLE public.sale_residual_fold_queue IS 'Bounded S01 cohort-month work state, one row per registered make_model_profiles subject x closed UTC month x currency. Writer drain_sale_residual_fold and its enqueue/seed helpers; mutable work state,100 enabled tasks, one task/5min,6h refresh,15min retry and pause after3 failures. Derived work only, not testimony. Consumer read_sale_residual_fold and assay_sale_residual_fold.';
COMMENT ON COLUMN public.sale_residual_fold_queue.id IS 'Surrogate task key; immutable identity of one cohort-month-currency request.';
COMMENT ON COLUMN public.sale_residual_fold_queue.subject_id IS 'FK to existing registered year cohort make_model_profiles.subject_id; no duplicate cohort entity.';
COMMENT ON COLUMN public.sale_residual_fold_queue.month IS 'First UTC day of target closed event month, since1990; baseline uses preceding36 months.';
COMMENT ON COLUMN public.sale_residual_fold_queue.currency IS 'Declared source price unit USD/EUR/GBP; no FX conversion.';
COMMENT ON COLUMN public.sale_residual_fold_queue.enabled IS 'Whether this task participates in the bounded standing drain; false for archived months or paused retries.';
COMMENT ON COLUMN public.sale_residual_fold_queue.next_due_at IS 'Database scheduling clock; success+6h, failure+15min, explicit replay immediately.';
COMMENT ON COLUMN public.sale_residual_fold_queue.created_at IS 'Database statement clock when work key first entered queue, not sale time.';
COMMENT ON COLUMN public.sale_residual_fold_queue.last_verified_at IS 'Latest successful canonical input re-evaluation clock; unchanged inputs reuse old immutable receipt, whose original evidence cutoff stays intact.';
COMMENT ON COLUMN public.sale_residual_fold_queue.last_attempt_at IS 'Database statement clock of latest completed attempt, successful or caught failure.';
COMMENT ON COLUMN public.sale_residual_fold_queue.consecutive_failures IS '0..3 consecutive caught reader/write failures; third pauses task until explicit sanctioned replay.';
COMMENT ON COLUMN public.sale_residual_fold_queue.last_error IS 'Up to300 characters of last caught failure; NULL after a successful fold or explicit replay.';
COMMENT ON COLUMN public.sale_residual_fold_queue.last_run_id IS 'Latest supported immutable revision; composite FK enforces that it belongs to this task.';
COMMENT ON TABLE public.sale_residual_fold_runs IS 'Immutable S01 calculation receipts, one row per task x qualified input SHA256; append-only definer writer drain_sale_residual_fold. Full baseline/source/coverage receipt permits inspection without a live-log scan. Derived retrospective measurement, not new testimony or historical known-at backtest. Service read only.';
COMMENT ON COLUMN public.sale_residual_fold_runs.id IS 'Immutable revision key referenced by source-episode measurements and queue current pointer.';
COMMENT ON COLUMN public.sale_residual_fold_runs.queue_id IS 'FK to cohort-month-currency work key; same semantic input cannot append twice for this key.';
COMMENT ON COLUMN public.sale_residual_fold_runs.input_sha256 IS 'SHA256 of canonical JSON receipt after excluding only root and source-owner calculation/evidence-cutoff clocks; source knownAt clocks, coverage, method and witness IDs remain.';
COMMENT ON COLUMN public.sale_residual_fold_runs.method IS 'Calculation method from existing owner, currently sale_residual_month_start_v2; changed contract requires reviewed migration.';
COMMENT ON COLUMN public.sale_residual_fold_runs.evidence_as_of IS 'Knowledge cutoff of first calculation of this revision; later unchanged verification does not rewrite it.';
COMMENT ON COLUMN public.sale_residual_fold_runs.created_at IS 'Database statement clock when revision was appended, not commit proof or source event time.';
COMMENT ON COLUMN public.sale_residual_fold_runs.receipt IS 'Complete immutable owner output: disjoint36month baseline, qualified source episodes with capture hashes/parser/clocks, target residuals, geographic witnesses, exclusions and retrospective caveats.';
COMMENT ON TABLE public.sale_residual_episode_measurements IS 'Derived S01 episode residuals, one row per calculation revision x normalized qualified source listing key. Writer drain_sale_residual_fold; append-only, service read only. Same vehicle may have multiple source-sale episodes. Consumer cached receipt and relational vehicle/county drill.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.run_id IS 'FK to immutable baseline/source calculation revision.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.source_key IS 'Normalized source episode key qualified and deduplicated by valuation_by_ymm; one per revision.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.vehicle_id IS 'FK to canonical vehicle; physical-vehicle grain remains separate from sale-episode grain.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.event_day IS 'Qualified source sale event day inside target month, not ingestion clock.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.snapshot_id IS 'Polymorphic qualified capture ID inside canonical source receipt; no universal capture entity exists to justify a fabricated FK.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.amount IS 'Positive finite published bid excluding fees, in parent receipt currency; attributed source value, no FX or price adjustment.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.log_residual IS 'ln(amount/prior36month episode median); NULL for fewer than10 baseline sales.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.county_fips IS 'FK to canonical US county, supported by same-listing location witnesses; current key, not verified geography at sale.';
COMMENT ON COLUMN public.sale_residual_episode_measurements.geography_status IS 'Same-listing county, missing, conflicting or scan-limit refusal as qualified by the existing reader.';
COMMENT ON TABLE public.sale_residual_episode_locations IS 'Immutable evidence bridge: one source-episode revision x retained same-listing location witness. FKs to residual episode and original vehicle_location_observations; writer drain_sale_residual_fold. No location testimony copied or changed.';
COMMENT ON COLUMN public.sale_residual_episode_locations.run_id IS 'Composite FK with source_key to one immutable residual episode.';
COMMENT ON COLUMN public.sale_residual_episode_locations.source_key IS 'Source listing episode within the parent revision, never just latest vehicle location.';
COMMENT ON COLUMN public.sale_residual_episode_locations.location_observation_id IS 'FK to retained attributed location observation accepted by exact listing identity, clocks, country/entity, confidence and conflict rules.';
COMMENT ON FUNCTION public.drain_sale_residual_fold() IS 'S01 standing derived writer: governor, existing pilot seed, one due cohort/month, canonical calculation, immutable input-keyed receipts/episodes/witness edges,6h refresh or15min retry/pause3. No testimony writes or paid calls. Cron finite35s outer budget.';
COMMENT ON FUNCTION public.enqueue_sale_residual_fold(uuid,date,text,boolean) IS 'Sanctioned bounded registered-cohort work intake; unique subject/month/currency, max100 enabled tasks. Default does not revive paused tasks; explicit replay enables/retries immediately.';
COMMENT ON FUNCTION public.seed_sale_residual_fold_pilot() IS 'Maintain only existing unambiguous1963Corvette registered cohort rolling12 closed UTC months. Older pilot keys archived; failures not silently re-enabled. No entity creation.';
COMMENT ON FUNCTION public.read_sale_residual_fold(uuid,date,text) IS 'Service-only cached S01 reader; returns immutable receipt, original cutoff, last input verification clock and explicit staleness/failure state; no source-log scan.';
COMMENT ON FUNCTION public.assay_sale_residual_fold() IS 'Service-only bounded yield/freshness assay over active or failure-paused tasks; current residual/county counts, due/unassayed/failed work. Integrates existing v_job_health; enqueue/cron success alone cannot pass initial assay.';

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
 ('sale_residual_fold_queue',NULL,'drain_sale_residual_fold','Bounded S01 cohort-month work; helpers enqueue and seed, writer updates verification/retry state.',true,'enqueue_sale_residual_fold / drain_sale_residual_fold'),
 ('sale_residual_fold_runs',NULL,'drain_sale_residual_fold','Immutable qualified input/baseline calculation receipts; unique task/input digest.',true,'drain_sale_residual_fold'),
 ('sale_residual_episode_measurements',NULL,'drain_sale_residual_fold','Append-only source-episode residual measurements keyed to existing vehicle/county entities.',true,'drain_sale_residual_fold'),
 ('sale_residual_episode_locations',NULL,'drain_sale_residual_fold','Append-only residual-episode to retained location-witness edges.',true,'drain_sale_residual_fold');

-- Extend the live job-health owner in place; refuse drift instead of replacing
-- unrelated job semantics. pg_get_viewdef is code, not job commands/credentials.
DO $health$
DECLARE v text; original text; a text; b text;
BEGIN
  original:=pg_get_viewdef('public.v_job_health'::regclass,true); v:=original;
  a:='WITH stream_assay AS MATERIALIZED (';
  b:='WITH residual_assay AS MATERIALIZED (SELECT public.assay_sale_residual_fold() AS reading), stream_assay AS MATERIALIZED (';
  IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health CTE differs; refusing patch'; END IF;
  v:=replace(v,a,b);
  a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)$s$;
  b:=a||$s$
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN (SELECT reading->>'status' FROM residual_assay)$s$;
  IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job assay status differs; refusing patch'; END IF; v:=replace(v,a,b);
  a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)$s$;
  b:=a||$s$
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN (SELECT reading FROM residual_assay)$s$;
  IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job assay receipt differs; refusing patch'; END IF; v:=replace(v,a,b);
  a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE$s$;
  b:=$s$WHEN j.jobname = 'drain-sale-residual-fold'::text THEN
            CASE WHEN lr.last_run_at IS NULL OR lr.last_run_at<=statement_timestamp()-interval '15 minutes' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM residual_assay)='failed' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM residual_assay)='passed' AND lr.last_status='succeeded' THEN 'passed'::text
                 ELSE 'unknown'::text END
            $s$||a;
  IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health decision differs; refusing patch'; END IF; v:=replace(v,a,b);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '||v;
END $health$;

SELECT public.seed_sale_residual_fold_pilot();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='drain-sale-residual-fold') THEN RAISE EXCEPTION 'Residual job already exists; inspect owner'; END IF;
  PERFORM cron.schedule('drain-sale-residual-fold','*/5 * * * *',$cmd$
    SET statement_timeout='35s';
    SELECT set_config('app.writer','drain_sale_residual_fold',false);
    SELECT public.drain_sale_residual_fold();
  $cmd$);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
