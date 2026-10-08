-- Retained factory references: reuse immutable taxonomy work and canonical
-- observations. One operational queue; no provider/model calls or scalar writes.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';

ALTER TABLE public.vehicle_observations
 ADD COLUMN source_vin text,
 ADD COLUMN source_vin_taxonomy_revision_id bigint,
 ADD CONSTRAINT observation_source_vin_fkey FOREIGN KEY(source_vin) REFERENCES public.vin_decoded_data(vin) NOT VALID,
 ADD CONSTRAINT observation_vin_own_revision FOREIGN KEY(vehicle_id,source_vin_taxonomy_revision_id)
 REFERENCES public.vehicle_taxonomy_revisions(vehicle_id,id) NOT VALID;
-- Both new columns are NULL on all historical rows. NOT VALID avoids scanning
-- the existing8GB/11M-row testimony table; every new/changed binding is checked.
-- Bounded consumers join observations by their existing PK. Reverse-source
-- indexes/legacy validation can be built separately if that access is needed.
ALTER TABLE public.vehicle_taxonomy_replay_state
 ADD COLUMN vin_reference_revision_cursor bigint REFERENCES public.vehicle_taxonomy_revisions(id),
 ADD COLUMN vin_reference_keys_seen bigint NOT NULL DEFAULT 0 CHECK(vin_reference_keys_seen>=0),
 ADD COLUMN vin_reference_started_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN vin_reference_last_seed_at timestamptz,
 ADD COLUMN vin_reference_scan_completed_at timestamptz;

CREATE TABLE public.vin_reference_intake_queue (
 revision_id bigint PRIMARY KEY,
 vehicle_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','done','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 locked_by text, locked_at timestamptz,
 observation_id uuid REFERENCES public.vehicle_observations(id),
 completed_at timestamptz, last_error text,
 FOREIGN KEY(vehicle_id,revision_id) REFERENCES public.vehicle_taxonomy_revisions(vehicle_id,id),
 CHECK((status='claimed')=(locked_by IS NOT NULL AND locked_at IS NOT NULL)),
 CHECK(status='claimed' OR(locked_by IS NULL AND locked_at IS NULL)),
 CHECK((status='done')=(observation_id IS NOT NULL AND completed_at IS NOT NULL)),
 CHECK(status='done' OR(observation_id IS NULL AND completed_at IS NULL))
);
CREATE INDEX vin_reference_intake_due ON public.vin_reference_intake_queue(next_attempt_at,revision_id)
 WHERE status IN('pending','skipped');
CREATE INDEX vin_reference_intake_completed ON public.vin_reference_intake_queue(completed_at DESC)
 WHERE status='done';
ALTER TABLE public.vin_reference_intake_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vin_reference_intake_queue FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vin_reference_intake_queue TO service_role;
CREATE POLICY vin_reference_intake_service_read ON public.vin_reference_intake_queue
 FOR SELECT TO service_role USING(true);

INSERT INTO public.observation_extractors(source_id,slug,display_name,extractor_type,edge_function_name,
 extractor_config,produces_kinds,is_active,schedule_type,rate_limit_per_hour,min_interval_seconds)
SELECT id,'retained-vin-reference-v1','Retained VIN factory reference intake','edge_function','batch-vin-decode',
 '{"use_retained_reference_queue":true,"dry_run":false,"model_calls":0}'::jsonb,
 ARRAY['specification']::public.observation_kind[],true,'cron',80,900
 FROM public.observation_sources WHERE slug='nhtsa';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.observation_extractors WHERE slug='retained-vin-reference-v1') THEN
  RAISE EXCEPTION 'Canonical NHTSA source missing';
 END IF;
END $$;

CREATE FUNCTION public.enqueue_vin_reference_revision(p_revision bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE n integer;
BEGIN
 IF EXISTS(SELECT 1 FROM public.vin_reference_intake_queue WHERE revision_id=p_revision) THEN RETURN false; END IF;
 INSERT INTO public.vin_reference_intake_queue(revision_id,vehicle_id)
 SELECT id,vehicle_id FROM public.vehicle_taxonomy_revisions WHERE id=p_revision
  AND receipt->>'method'='retained_vin_taxonomy_v1' AND receipt->>'reference_status'='accepted'
  AND cache_vin IS NOT NULL ON CONFLICT(revision_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n=1;
END $$;
CREATE FUNCTION public.trg_enqueue_vin_reference_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM public.enqueue_vin_reference_revision(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER taxonomy_revision_factory_intake AFTER INSERT ON public.vehicle_taxonomy_revisions
 FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_vin_reference_revision();

CREATE FUNCTION public.seed_vin_reference_revisions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE s record; r record; seen integer:=0;
BEGIN
 IF (SELECT count(*) FROM public.vin_reference_intake_queue WHERE status IN('pending','claimed'))>=500 THEN RETURN 0; END IF;
 SELECT * INTO s FROM public.vehicle_taxonomy_replay_state WHERE id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR s.vin_reference_scan_completed_at IS NOT NULL THEN RETURN 0; END IF;
 FOR r IN SELECT id FROM public.vehicle_taxonomy_revisions
  WHERE id>coalesce(s.vin_reference_revision_cursor,0) ORDER BY id LIMIT 500 LOOP
  PERFORM public.enqueue_vin_reference_revision(r.id);
  s.vin_reference_revision_cursor:=r.id; seen:=seen+1;
 END LOOP;
 UPDATE public.vehicle_taxonomy_replay_state
 SET vin_reference_revision_cursor=s.vin_reference_revision_cursor,
  vin_reference_keys_seen=vin_reference_keys_seen+seen,vin_reference_last_seed_at=now(),
  vin_reference_scan_completed_at=CASE WHEN seen<500 THEN now() ELSE NULL END WHERE id;
 RETURN seen;
END $$;

CREATE FUNCTION public.read_retained_vin_reference_input(p_revision_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET timezone='UTC' SET statement_timeout='5s' AS $$
 SELECT jsonb_build_object('revision',jsonb_build_object('id',r.id::text,'vehicle_id',r.vehicle_id,
  'cache_vin',r.cache_vin,'receipt',r.receipt),'vehicle',jsonb_build_object('id',v.id,'vin',v.vin,
  'is_public',v.is_public,'deleted_at',v.deleted_at,'listing_kind',v.listing_kind,'status',v.status),
  'cache',jsonb_build_object('vin',c.vin,'provider',c.provider,'decoded_at',c.decoded_at,
  'updated_at',c.updated_at,'body_type',c.body_type,'vehicle_type',c.vehicle_type,'raw_json',c.raw_response::text),
  'extractor_id',(SELECT id FROM public.observation_extractors WHERE slug='retained-vin-reference-v1' AND is_active))
 FROM public.vehicle_taxonomy_revisions r JOIN public.vehicles v ON v.id=r.vehicle_id
 JOIN public.vin_decoded_data c ON c.vin=r.cache_vin WHERE r.id=$1;
$$;

CREATE FUNCTION public.vin_reference_result_matches(p_revision bigint,p_observation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT o.kind='specification' AND o.extraction_method='protected_retained_vin_reference_v1'
  AND o.is_superseded IS FALSE AND o.agent_cost_cents=0 AND s.slug='nhtsa'
  AND o.source_vin=r.cache_vin AND first_r.cache_vin=r.cache_vin
  AND first_r.receipt#>>'{input,raw_sha256}'=r.receipt#>>'{input,raw_sha256}'
  AND (first_r.receipt#>>'{input,source_recorded_at}')::timestamptz=(r.receipt#>>'{input,source_recorded_at}')::timestamptz
  AND o.structured_data#>>'{vin_reference_receipt,method}'='protected_retained_vin_reference_v1'
  AND o.structured_data#>>'{vin_reference_receipt,role}'='factory_reference'
  AND o.structured_data#>'{vin_reference_receipt,physical_configuration_verified}'='false'::jsonb
  AND o.structured_data#>>'{vin_reference_receipt,vehicle_id}'=r.vehicle_id::text
  AND o.structured_data#>>'{vin_reference_receipt,cache_vin}'=r.cache_vin
  AND o.structured_data#>>'{vin_reference_receipt,source_sha256}'=r.receipt#>>'{input,raw_sha256}'
  AND o.observed_at=(r.receipt#>>'{input,source_recorded_at}')::timestamptz
  AND (o.structured_data#>>'{vin_reference_receipt,source_recorded_at}')::timestamptz=o.observed_at
 FROM public.vehicle_taxonomy_revisions r JOIN public.vehicle_observations o ON o.id=$2 AND o.vehicle_id=r.vehicle_id
 JOIN public.vehicle_taxonomy_revisions first_r ON first_r.id=o.source_vin_taxonomy_revision_id AND first_r.vehicle_id=o.vehicle_id
 JOIN public.observation_sources s ON s.id=o.source_id WHERE r.id=$1),false);
$$;

CREATE FUNCTION public.claim_vin_reference_intake(p_worker text,p_limit integer DEFAULT 20)
RETURNS TABLE(revision_id text,vehicle_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='10s' AS $$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'Invalid bounded reference worker';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8 THEN RETURN; END IF;
 PERFORM set_config('app.writer','batch-vin-decode:retained-reference',true);
 PERFORM public.seed_vin_reference_revisions();
 WITH expired AS(SELECT q.revision_id FROM public.vin_reference_intake_queue q
  WHERE q.status='claimed' AND q.locked_at<now()-interval '10 minutes'
  ORDER BY q.locked_at LIMIT 20 FOR UPDATE SKIP LOCKED)
 UPDATE public.vin_reference_intake_queue q SET status=CASE WHEN q.attempts>=3 THEN 'failed' ELSE 'pending' END,
  locked_by=NULL,locked_at=NULL,next_attempt_at=now()+interval '15 minutes',last_error='lease_expired'
 FROM expired e WHERE q.revision_id=e.revision_id;
 RETURN QUERY WITH picked AS(SELECT q.revision_id FROM public.vin_reference_intake_queue q
  WHERE q.status IN('pending','skipped') AND q.next_attempt_at<=now() AND q.attempts<3
  ORDER BY q.next_attempt_at,q.revision_id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.vin_reference_intake_queue q SET status='claimed',locked_by=p_worker,locked_at=now(),attempts=q.attempts+1
 FROM picked p WHERE q.revision_id=p.revision_id RETURNING q.revision_id::text,q.vehicle_id;
END $$;

CREATE FUNCTION public.finish_vin_reference_intake(p_revision bigint,p_worker text,p_status text,
 p_observation uuid DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='5s' AS $$
DECLARE q record;
BEGIN
 IF p_status IS NULL OR p_status NOT IN('done','skipped','retry') OR
  (p_reason IS NOT NULL AND p_reason !~ '^[a-z][a-z0-9_]{0,100}$') THEN RAISE EXCEPTION 'Invalid reference completion'; END IF;
 SELECT * INTO q FROM public.vin_reference_intake_queue WHERE revision_id=p_revision
  AND status='claimed' AND locked_by=p_worker FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_status='done' AND NOT public.vin_reference_result_matches(p_revision,p_observation) THEN
  RAISE EXCEPTION 'Persisted protected reference result does not match work';
 END IF;
 IF p_status<>'done' AND p_observation IS NOT NULL THEN RAISE EXCEPTION 'Only qualified completion has a result'; END IF;
 PERFORM set_config('app.writer','batch-vin-decode:retained-reference',true);
 UPDATE public.vin_reference_intake_queue SET
  status=CASE WHEN p_status='retry' THEN CASE WHEN q.attempts>=3 AND p_reason IS DISTINCT FROM 'batch_budget_deferred' THEN 'failed' ELSE 'pending' END ELSE p_status END,
  attempts=CASE WHEN p_status='skipped' THEN 0 WHEN p_reason='batch_budget_deferred' THEN greatest(q.attempts-1,0) ELSE q.attempts END,
  locked_by=NULL,locked_at=NULL,observation_id=CASE WHEN p_status='done' THEN p_observation END,
  completed_at=CASE WHEN p_status='done' THEN now() END,last_error=CASE WHEN p_status='done' THEN NULL ELSE p_reason END,
  next_attempt_at=now()+CASE WHEN p_status='skipped' THEN interval '1 day' ELSE interval '15 minutes' END
 WHERE revision_id=p_revision;
 RETURN true;
END $$;

CREATE FUNCTION public.guard_vin_reference_work() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND row(NEW.revision_id,NEW.vehicle_id,NEW.created_at) IS DISTINCT FROM
  row(OLD.revision_id,OLD.vehicle_id,OLD.created_at) THEN RAISE EXCEPTION 'Reference work bindings are immutable'; END IF;
 IF NEW.status='done' AND NOT public.vin_reference_result_matches(NEW.revision_id,NEW.observation_id) THEN
  RAISE EXCEPTION 'Reference result binding unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vin_reference_work_bindings BEFORE INSERT OR UPDATE ON public.vin_reference_intake_queue
 FOR EACH ROW EXECUTE FUNCTION public.guard_vin_reference_work();

CREATE FUNCTION public.guard_retained_vin_observation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r record; c record; v record; receipt jsonb; expected_fields jsonb; expected_exclusions jsonb; source_uuid uuid; raw_sha text;
BEGIN
 IF TG_OP='UPDATE' AND(OLD.source_vin IS NOT NULL OR OLD.source_vin_taxonomy_revision_id IS NOT NULL
  OR OLD.extraction_method='protected_retained_vin_reference_v1') THEN
  IF row(NEW.vehicle_id,NEW.source_vin,NEW.source_vin_taxonomy_revision_id,NEW.source_id,NEW.kind,
   NEW.extraction_method,NEW.observed_at,NEW.source_identifier,NEW.source_url,NEW.structured_data,
   NEW.content_hash,NEW.raw_source_ref,NEW.agent_cost_cents,NEW.extraction_metadata,NEW.extractor_id,NEW.subject_type,NEW.subject_id,NEW.property_id)
   IS DISTINCT FROM row(OLD.vehicle_id,OLD.source_vin,OLD.source_vin_taxonomy_revision_id,OLD.source_id,OLD.kind,
   OLD.extraction_method,OLD.observed_at,OLD.source_identifier,OLD.source_url,OLD.structured_data,
   OLD.content_hash,OLD.raw_source_ref,OLD.agent_cost_cents,OLD.extraction_metadata,OLD.extractor_id,OLD.subject_type,OLD.subject_id,OLD.property_id) THEN
   RAISE EXCEPTION 'Retained factory testimony is immutable; use canonical supersession';
  END IF;
  RETURN NEW; -- Later cache changes must not prevent historical supersession.
 END IF;
 IF NEW.source_vin IS NULL AND NEW.source_vin_taxonomy_revision_id IS NULL
  AND NEW.extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
  AND NOT coalesce(NEW.structured_data ? 'vin_reference_receipt',false) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Append a new retained reference instead of promoting old testimony'; END IF;
 receipt:=NEW.structured_data->'vin_reference_receipt';
 SELECT * INTO r FROM public.vehicle_taxonomy_revisions WHERE id=NEW.source_vin_taxonomy_revision_id;
 SELECT * INTO c FROM public.vin_decoded_data WHERE vin=NEW.source_vin;
 SELECT id,vin,is_public,deleted_at,status,listing_kind INTO v FROM public.vehicles WHERE id=NEW.vehicle_id;
 SELECT id INTO source_uuid FROM public.observation_sources WHERE slug='nhtsa';
 IF r.id IS NULL OR c.vin IS NULL OR v.id IS NULL OR source_uuid IS NULL OR
  r.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR r.cache_vin IS DISTINCT FROM c.vin OR
  upper(v.vin) IS DISTINCT FROM c.vin OR c.vin !~ '^[A-HJ-NPR-Z0-9]{17}$' OR
  v.is_public IS DISTINCT FROM true OR v.deleted_at IS NOT NULL OR v.status IS NOT DISTINCT FROM 'merged' OR
  v.listing_kind IS NOT DISTINCT FROM 'non_vehicle_item' OR c.provider IS DISTINCT FROM 'nhtsa' OR
  jsonb_typeof(c.raw_response->'ErrorCode') IS DISTINCT FROM 'string' OR
  btrim(c.raw_response->>'ErrorCode') IS DISTINCT FROM '0' OR upper(c.raw_response->>'VIN') IS DISTINCT FROM c.vin OR
  r.receipt->>'method' IS DISTINCT FROM 'retained_vin_taxonomy_v1' OR
  r.receipt->>'reference_status' IS DISTINCT FROM 'accepted' OR
  r.receipt#>>'{input,cache_vin}' IS DISTINCT FROM c.vin OR upper(r.receipt#>>'{input,vin}') IS DISTINCT FROM c.vin OR
  octet_length(c.raw_response::text)>131072 OR
  c.decoded_at IS NULL OR c.decoded_at>statement_timestamp() OR c.updated_at>statement_timestamp() OR
  (r.receipt#>>'{input,source_recorded_at}')::timestamptz IS DISTINCT FROM c.decoded_at OR
  (r.receipt#>>'{input,cache_updated_at}')::timestamptz IS DISTINCT FROM c.updated_at OR
  nullif(btrim(c.body_type),'') IS DISTINCT FROM nullif(btrim(c.raw_response->>'BodyClass'),'') OR
  nullif(btrim(c.vehicle_type),'') IS DISTINCT FROM nullif(btrim(c.raw_response->>'VehicleType'),'') THEN
  RAISE EXCEPTION 'Retained reference source, parent or clocks do not qualify';
 END IF;
 raw_sha:=encode(sha256(convert_to(c.raw_response::text,'UTF8')),'hex');
 IF r.receipt#>>'{input,raw_sha256}' IS DISTINCT FROM raw_sha OR
  NEW.kind IS DISTINCT FROM 'specification' OR NEW.source_id IS DISTINCT FROM source_uuid OR
  NEW.extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1' OR NEW.agent_cost_cents IS DISTINCT FROM 0 OR
  NEW.property_id IS NOT NULL OR NEW.extractor_id IS DISTINCT FROM
   (SELECT id FROM public.observation_extractors WHERE slug='retained-vin-reference-v1' AND is_active) OR
  NEW.subject_type IS DISTINCT FROM 'vehicle' OR(NEW.subject_id IS NOT NULL AND NEW.subject_id<>NEW.vehicle_id) OR
  NEW.observed_at IS DISTINCT FROM c.decoded_at OR
  receipt->>'method' IS DISTINCT FROM 'protected_retained_vin_reference_v1' OR
  receipt->>'role' IS DISTINCT FROM 'factory_reference' OR
  receipt->'physical_configuration_verified' IS DISTINCT FROM 'false'::jsonb OR
  receipt->>'field_namespace' IS DISTINCT FROM 'nhtsa_vpic_values' OR
  receipt->>'recorded_clock_basis' IS DISTINCT FROM 'retained_provider_decode_recording_not_manufacture_or_physical_observation' OR
  receipt->>'vehicle_id' IS DISTINCT FROM NEW.vehicle_id::text OR receipt->>'cache_vin' IS DISTINCT FROM c.vin OR
  receipt->>'source_sha256' IS DISTINCT FROM raw_sha OR
  (receipt->>'source_recorded_at')::timestamptz IS DISTINCT FROM c.decoded_at OR
  receipt->'raw_reference' IS DISTINCT FROM c.raw_response OR
  NEW.structured_data IS DISTINCT FROM jsonb_build_object('vin_reference_receipt',receipt) OR
  NEW.source_identifier IS DISTINCT FROM('retained-vin:'||v.id||':'||c.vin||':'||raw_sha||':'||
   ((extract(epoch FROM c.decoded_at)*1000000)::bigint)::text) OR
  NEW.raw_source_ref IS DISTINCT FROM('vin_decoded_data:'||c.vin) OR
  NEW.source_url IS DISTINCT FROM('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'||c.vin||'?format=json') THEN
  RAISE EXCEPTION 'Canonical retained factory receipt does not match source';
 END IF;
 SELECT coalesce(jsonb_object_agg(key,btrim(value)),'{}'::jsonb) INTO expected_fields
 FROM jsonb_each_text(c.raw_response)
 WHERE key=ANY(ARRAY['Make','Model','ModelYear','BodyClass','VehicleType','DriveType','EngineCylinders',
  'EngineConfiguration','DisplacementL','DisplacementCC','EngineHP','FuelTypePrimary','Doors','Seats',
  'TransmissionStyle','TransmissionSpeeds','WheelBaseShort','Trim','Series'])
 AND jsonb_typeof(c.raw_response->key)='string' AND btrim(value)<>''
 AND btrim(value) !~* '^(N/?A|Not Applicable|Not Available|Not Reported|Unknown|0 - Not Applicable)$'
 AND CASE WHEN key=ANY(ARRAY['ModelYear','EngineCylinders','DisplacementL','DisplacementCC','EngineHP',
  'Doors','Seats','TransmissionSpeeds','WheelBaseShort']) THEN
  CASE WHEN length(btrim(value))<=64 AND btrim(value) ~ '^[0-9]+(\.[0-9]+)?$' THEN btrim(value)::numeric>0 ELSE false END
  ELSE true END;
 IF expected_fields='{}' OR receipt->'fields' IS DISTINCT FROM expected_fields THEN
  RAISE EXCEPTION 'Factory fields are not the complete supported source projection';
 END IF;
 SELECT coalesce(jsonb_object_agg(key,'unsupported_numeric_reference_value'::text),'{}'::jsonb) INTO expected_exclusions
 FROM jsonb_each_text(c.raw_response)
 WHERE key=ANY(ARRAY['ModelYear','EngineCylinders','DisplacementL','DisplacementCC','EngineHP',
  'Doors','Seats','TransmissionSpeeds','WheelBaseShort'])
 AND jsonb_typeof(c.raw_response->key)='string' AND btrim(value)<>''
 AND btrim(value) !~* '^(N/?A|Not Applicable|Not Available|Not Reported|Unknown|0 - Not Applicable)$'
 AND NOT(expected_fields ? key);
 IF receipt->'field_exclusions' IS DISTINCT FROM expected_exclusions OR
  receipt - ARRAY['method','role','vehicle_id','cache_vin','source_sha256','source_recorded_at',
   'recorded_clock_basis','physical_configuration_verified','field_namespace','fields','field_exclusions','raw_reference'] <> '{}' THEN
  RAISE EXCEPTION 'Unsupported reference receipt additions or exclusions';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_vin_observation_custody BEFORE INSERT OR UPDATE ON public.vehicle_observations
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_vin_observation();

CREATE FUNCTION public.vin_reference_is_current(p_revision bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT v.is_public IS TRUE AND v.deleted_at IS NULL AND v.status IS DISTINCT FROM 'merged'
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND upper(v.vin)=r.cache_vin
  AND c.provider='nhtsa' AND btrim(c.raw_response->>'ErrorCode')='0'
  AND c.decoded_at<=statement_timestamp() AND (c.updated_at IS NULL OR c.updated_at<=statement_timestamp())
  AND r.receipt#>>'{input,raw_sha256}'=encode(sha256(convert_to(c.raw_response::text,'UTF8')),'hex')
  AND (r.receipt#>>'{input,source_recorded_at}')::timestamptz=c.decoded_at
  AND (r.receipt#>>'{input,cache_updated_at}')::timestamptz IS NOT DISTINCT FROM c.updated_at
 FROM public.vehicle_taxonomy_revisions r JOIN public.vehicles v ON v.id=r.vehicle_id
 JOIN public.vin_decoded_data c ON c.vin=r.cache_vin WHERE r.id=$1),false);
$$;

-- Extend the existing cached consumer; do not establish another taxonomy owner.
CREATE OR REPLACE FUNCTION public.read_vehicle_taxonomy_fold(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 SELECT coalesce((SELECT jsonb_build_object('vehicle_id',q.vehicle_id,'receipt_id',r.id,'receipt',r.receipt,
  'computed_at',r.computed_at,'last_verified_at',q.last_verified_at,'last_error',q.last_error,
  'stale',q.next_due_at IS NOT NULL OR q.last_error IS NOT NULL OR q.last_receipt_id IS NULL
     OR q.generation<>(SELECT generation FROM public.vehicle_taxonomy_replay_state WHERE id)
     OR v.deleted_at IS NOT NULL OR v.status IS NOT DISTINCT FROM 'merged'
     OR EXISTS(SELECT 1 FROM public.vehicle_taxonomy_invalidations WHERE vehicle_id=q.vehicle_id)
     OR row(v.canonical_body_style,v.canonical_vehicle_type) IS DISTINCT FROM row(r.canonical_body_style,r.canonical_vehicle_type),
  'canonical_columns_match',r.id IS NOT NULL AND row(v.canonical_body_style,v.canonical_vehicle_type) IS NOT DISTINCT FROM row(r.canonical_body_style,r.canonical_vehicle_type),
  'factory_reference',jsonb_build_object('status',coalesce(work.status,'not_queued'),
   'reason',work.last_error,'observation_id',o.id,'ingested_at',o.ingested_at,'verified_at',work.completed_at,
   'supporting_taxonomy_revision_id',o.source_vin_taxonomy_revision_id::text,
   'receipt',o.structured_data->'vin_reference_receipt','physical_configuration_verified',false,
   'stale',work.status IS DISTINCT FROM 'done' OR NOT public.vin_reference_result_matches(r.id,o.id)
    OR NOT public.vin_reference_is_current(r.id) OR q.next_due_at IS NOT NULL OR q.last_error IS NOT NULL
    OR q.generation<>(SELECT generation FROM public.vehicle_taxonomy_replay_state WHERE id)
    OR EXISTS(SELECT 1 FROM public.vehicle_taxonomy_invalidations WHERE vehicle_id=q.vehicle_id)))
 FROM public.vehicle_taxonomy_recompute_queue q LEFT JOIN public.vehicle_taxonomy_revisions r ON r.id=q.last_receipt_id
 JOIN public.vehicles v ON v.id=q.vehicle_id LEFT JOIN public.vin_reference_intake_queue work ON work.revision_id=r.id
 LEFT JOIN public.vehicle_observations o ON o.id=work.observation_id WHERE q.vehicle_id=$1),
 jsonb_build_object('status','not_queued','stale',true));
$$;

CREATE FUNCTION public.assay_vin_reference_intake() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 WITH work AS(SELECT count(*) FILTER(WHERE status='pending') pending,count(*) FILTER(WHERE status='claimed') claimed,
  count(*) FILTER(WHERE status='done') completed_work,count(DISTINCT observation_id) canonical_observations,
  count(*) FILTER(WHERE status='skipped') refused,count(*) FILTER(WHERE status='failed') failed,
  count(*) FILTER(WHERE status='skipped' AND next_attempt_at<=now()) refusal_rechecks_due,
  max(CASE WHEN status='done' THEN completed_at WHEN status='skipped' THEN next_attempt_at-interval '1 day'
   WHEN status IN('pending','failed') AND attempts>0 THEN next_attempt_at-interval '15 minutes' END) last_finished_at
  FROM public.vin_reference_intake_queue),
 current_failures AS(SELECT count(*) stale_current FROM public.vehicle_taxonomy_recompute_queue t
  JOIN public.vin_reference_intake_queue q ON q.revision_id=t.last_receipt_id AND q.status='done'
  WHERE NOT public.vin_reference_result_matches(q.revision_id,q.observation_id) OR NOT public.vin_reference_is_current(q.revision_id)),
 s AS(SELECT vin_reference_keys_seen keys_seen,vin_reference_started_at started_at,
  vin_reference_last_seed_at last_seed_at,vin_reference_scan_completed_at scan_completed_at
  FROM public.vehicle_taxonomy_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN work.failed>0 THEN 'failed'
  WHEN (s.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+current_failures.stale_current>0)
   AND greatest(s.last_seed_at,work.last_finished_at,s.started_at)<statement_timestamp()-interval '30 minutes' THEN 'failed'
  WHEN s.scan_completed_at IS NULL OR work.pending+work.claimed+work.refusal_rechecks_due+current_failures.stale_current>0 THEN 'partial' ELSE 'passed' END,
  'scope','accepted_retained_nhtsa_taxonomy_revisions_factory_reference_not_physical_configuration',
  'state',to_jsonb(s),'counts',to_jsonb(work)-'last_finished_at'||to_jsonb(current_failures),
  'last_finished_at',work.last_finished_at,'model_calls',0,'provider_calls',0,'physical_configuration_verified',false,
  'refusal_policy','explicit_source_or_parent_unknowns_rechecked_daily') FROM s,work,current_failures;
$$;

REVOKE ALL ON FUNCTION public.enqueue_vin_reference_revision(bigint),public.trg_enqueue_vin_reference_revision(),
 public.seed_vin_reference_revisions(),public.read_retained_vin_reference_input(bigint),
 public.vin_reference_result_matches(bigint,uuid),public.claim_vin_reference_intake(text,integer),
 public.finish_vin_reference_intake(bigint,text,text,uuid,text),public.guard_vin_reference_work(),
 public.guard_retained_vin_observation(),public.vin_reference_is_current(bigint),public.assay_vin_reference_intake()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_retained_vin_reference_input(bigint),public.vin_reference_result_matches(bigint,uuid),
 public.claim_vin_reference_intake(text,integer),public.finish_vin_reference_intake(bigint,text,text,uuid,text),
 public.vin_reference_is_current(bigint),public.assay_vin_reference_intake() TO service_role;

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
 ('vin_reference_intake_queue',NULL,'batch-vin-decode','Bounded retained factory-reference operational work; no caller facts or paid calls.',true,'claim_vin_reference_intake / finish_vin_reference_intake'),
 ('vehicle_taxonomy_replay_state','vin_reference_revision_cursor','batch-vin-decode','Finite scan of existing immutable revision keys; incremental insertion trigger remains active.',true,'seed_vin_reference_revisions'),
 ('vehicle_observations','source_vin','ingest-observation','Typed retained cache source; factory reference only.',true,'ingest-observation retained_vin_reference_v1'),
 ('vehicle_observations','source_vin_taxonomy_revision_id','ingest-observation','Immutable same-parent first supporting taxonomy revision; later identical processing reuses source claim.',true,'ingest-observation retained_vin_reference_v1');

DO $health$
DECLARE v text:=pg_get_viewdef('public.v_job_health'::regclass,true); a text; b text;
BEGIN
 a:='taxonomy_assay AS MATERIALIZED (';
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health owner shape differs'; END IF;
 v:=replace(v,a,'vin_reference_assay AS MATERIALIZED (SELECT public.assay_vin_reference_intake() AS reading), taxonomy_assay AS MATERIALIZED (');
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'qualify-retained-vin-references'::text THEN (SELECT reading->>'status' FROM vin_reference_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health assay differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'qualify-retained-vin-references'::text THEN (SELECT reading FROM vin_reference_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health receipt differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE$s$;
 b:=$s$WHEN j.jobname = 'qualify-retained-vin-references'::text THEN
            CASE WHEN lr.last_run_at IS NULL OR lr.last_run_at<=statement_timestamp()-interval '30 minutes' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM vin_reference_assay)='failed' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM vin_reference_assay)='passed' AND lr.last_status='succeeded' THEN 'passed'::text
                 ELSE 'unknown'::text END
            $s$||a;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health decision differs'; END IF; v:=replace(v,a,b);
 EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '||v;
END $health$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='qualify-retained-vin-references') THEN RAISE EXCEPTION 'Reference job exists'; END IF;
 PERFORM cron.schedule('qualify-retained-vin-references','*/15 * * * *',$cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-vin-decode',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"use_retained_reference_queue":true,"dry_run":false,"batch_size":20}'::jsonb,timeout_milliseconds:=60000);
 $cmd$);
END $$;
COMMENT ON TABLE public.vin_reference_intake_queue IS 'Operational queue, grain one accepted immutable vehicle_taxonomy_revisions PK, with same-parent FK. Existing batch-vin-decode claims at most20 every15min and invokes canonical ingest-observation. Canonical receipt/result lives in vehicle_observations, factory reference only; no physical scalar overwrite or provider/model calls. Service SELECT only, leased function writes, refusal24h/retry15min/pause3. Cached consumer read_vehicle_taxonomy_fold; assay_vin_reference_intake.';
COMMENT ON COLUMN public.vehicle_observations.source_vin IS 'Retained vin_decoded_data source FK; original raw evidence and decode clock are preserved in the immutable factory reference receipt.';
COMMENT ON COLUMN public.vehicle_observations.source_vin_taxonomy_revision_id IS 'Same-parent FK to first supporting immutable taxonomy revision; processing-only revisions deduplicate to this source claim.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_reference_revision_cursor IS 'Last visited immutable revision PK, finite500-key source scan; not a claim or all-fleet completion proof.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_reference_keys_seen IS 'Actual visited revision keys including ineligible receipts; not admitted observations.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_reference_started_at IS 'Database intake migration clock, not source decode time.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_reference_last_seed_at IS 'Actual source keyset progress; skipped seed does not advance this clock.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_reference_scan_completed_at IS 'Short final page clock; incremental revision insertion continues automatically.';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT * FROM(VALUES
 ('revision_id','Immutable accepted taxonomy source revision PK and same-parent FK.'),
 ('vehicle_id','Typed parent through the same-parent revision FK; canonical intake independently requires public real vehicle.'),
 ('status','Operational pending/claimed/done/skipped/failed; only persisted protected receipt can be done.'),
 ('attempts','Transient attempts, bounded3; source refusals reset and budget deferrals restore attempt.'),
 ('next_attempt_at','Database retry due clock; transient15min, semantic refusal24h.'),
 ('created_at','Database work creation clock; not source manufacture/decode time.'),
 ('locked_by','Claim token for completion CAS, only populated with claimed status.'),
 ('locked_at','Database lease acquisition clock; recover after10min.'),
 ('observation_id','Canonical result FK; done requires same-parent/source/hash/clock protected receipt.'),
 ('completed_at','Database verified completion clock; original observation ingested_at stays separate.'),
 ('last_error','Bounded machine reason for transient or withheld source; no raw provider data.')
 ) AS x(name,description) LOOP EXECUTE format('COMMENT ON COLUMN public.vin_reference_intake_queue.%I IS %L',c.name,c.description); END LOOP;
END $$;
COMMENT ON FUNCTION public.claim_vin_reference_intake(text,integer) IS 'Service-only lock/load governed500-key seed and1..20SKIP LOCKED claims; no evidence DML.';
COMMENT ON FUNCTION public.finish_vin_reference_intake(bigint,text,text,uuid,text) IS 'Service-only lease CAS; persisted canonical same-parent/source receipt required before done; explicit refusal24h,transient15min/pause3.';
COMMENT ON FUNCTION public.assay_vin_reference_intake() IS 'Actual old-source progress, work versus distinct observations, current-source staleness and failure assay; no physical or whole-fleet verification claim.';
NOTIFY pgrst,'reload schema';
COMMIT;
