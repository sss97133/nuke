-- Disposable current owner shapes; no production data or external requests.
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,is_public boolean DEFAULT true,deleted_at timestamptz,listing_kind text,status text);
CREATE TABLE public.listing_page_snapshots(id uuid PRIMARY KEY,platform text,success boolean,http_status integer,html_sha256 text,metadata jsonb,
 html text,fetched_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE);
INSERT INTO public.observation_sources VALUES('22222222-2222-2222-2222-222222222222','bat');
CREATE TABLE public.observation_extractors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid REFERENCES observation_sources,slug text UNIQUE,
 display_name text,extractor_type text,edge_function_name text,extractor_config jsonb,produces_kinds text[],is_active boolean,schedule_type text,
 rate_limit_per_hour integer,min_interval_seconds integer);
INSERT INTO public.observation_extractors(slug) VALUES('fixture-private-reader'),('fixture-comment-reader');
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES vehicles,
 source_snapshot_id uuid REFERENCES listing_page_snapshots,source_id uuid REFERENCES observation_sources,kind text,extraction_method text,
 is_superseded boolean DEFAULT false,structured_data jsonb,ingested_at timestamptz DEFAULT now());
CREATE TABLE public.derivation_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,
 evidence_type text NOT NULL CONSTRAINT derivation_queue_evidence_type_check CHECK(evidence_type IN
 ('secure_document','vehicle_image','receipt','qb_transaction','imessage_conversation','email','artifact','auction_comment')),
 evidence_id uuid NOT NULL,extractor_slug text NOT NULL REFERENCES observation_extractors(slug),
 requested_by text NOT NULL DEFAULT 'trigger',request_note text,status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','claimed','done','failed','skipped')),priority integer NOT NULL DEFAULT 100,
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 3,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,locked_by text,observation_ids uuid[],cost_cents numeric,credential_source text,error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 CONSTRAINT derivation_queue_owner_scope_check CHECK((evidence_type='auction_comment' AND user_id IS NULL) OR(evidence_type<>'auction_comment' AND user_id IS NOT NULL)),
 UNIQUE(evidence_type,evidence_id,extractor_slug));
ALTER TABLE derivation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY derivation_queue_service_all ON derivation_queue FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT ALL ON derivation_queue TO service_role;
GRANT SELECT ON vehicles,listing_page_snapshots,vehicle_observations TO service_role;
CREATE FUNCTION public.claim_derivation_work(p_worker text,p_batch_size integer DEFAULT 5,p_user_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,user_id uuid,evidence_type text,evidence_id uuid,extractor_slug text,attempts integer,request_note text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH picked AS (SELECT q.id FROM derivation_queue q WHERE q.status='pending' AND q.next_attempt_at<=now() AND q.attempts<q.max_attempts
 AND(p_user_id IS NULL OR q.user_id=p_user_id) ORDER BY q.priority,q.created_at LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
 UPDATE derivation_queue q SET status='claimed',locked_at=now(),locked_by=p_worker,attempts=q.attempts+1 FROM picked p WHERE q.id=p.id
 RETURNING q.id,q.user_id,q.evidence_type,q.evidence_id,q.extractor_slug,q.attempts,q.request_note;
$$;
REVOKE ALL ON FUNCTION claim_derivation_work(text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_derivation_work(text,integer,uuid) TO service_role;
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,active boolean DEFAULT true,command text);
CREATE TABLE cron.job_run_details(runid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
CREATE FUNCTION public.assay_vehicle_taxonomy_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"passed"}'::jsonb $$;
CREATE FUNCTION public.get_live_auction_health() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"closing_stream":{"status":"passed"}}'::jsonb $$;
CREATE FUNCTION public.assay_vehicle_metric_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"passed"}'::jsonb $$;
CREATE FUNCTION public.assay_sale_residual_fold() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"passed"}'::jsonb $$;
\ir bat_sale_health_fixture.sql
CREATE FUNCTION fixture_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;
CREATE FUNCTION fixture_reject(sql text,label text,expected_state text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
  IF expected_state IS NOT NULL AND SQLSTATE<>expected_state THEN RAISE; END IF;
  RAISE NOTICE 'PASS % (%)',label,SQLSTATE; RETURN; END;
 RAISE EXCEPTION 'FAIL accepted attack %',label;
END $$;
CREATE FUNCTION fixture_capture(n integer,d jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sid uuid:=md5('fixture-capture-'||n)::uuid; vid uuid:=md5('fixture-vehicle-'||n)::uuid;
BEGIN
 INSERT INTO vehicles(id,is_public,listing_kind) VALUES(vid,coalesce((d->>'is_public')::boolean,true),d->>'listing_kind') ON CONFLICT DO NOTHING;
 INSERT INTO listing_page_snapshots(id,platform,success,http_status,html_sha256,metadata,html)
 VALUES(sid,coalesce(d->>'platform','bat'),true,200,repeat('a',64),
  jsonb_build_object('vehicle_id',vid,'vehicle_matched',true,'parsed_at','2025-06-16T12:00:00Z')||coalesce(d->'metadata','{}'), 'PRIVATE SYNTHETIC HTML');
 RETURN sid;
END $$;
CREATE FUNCTION fixture_observation(sid uuid,d jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
 INSERT INTO vehicle_observations(vehicle_id,source_snapshot_id,source_id,kind,extraction_method,is_superseded,structured_data)
 SELECT (metadata->>'vehicle_id')::uuid,id,'22222222-2222-2222-2222-222222222222',coalesce(d->>'kind','sale_result'),
 coalesce(d->>'method','protected_archived_sale_observation_v1'),coalesce((d->>'superseded')::boolean,false),
 jsonb_build_object('source_sale_receipt',jsonb_build_object('snapshot_id',id,'vehicle_id',metadata->>'vehicle_id',
 'method','protected_archived_sale_observation_v1','source_sha256',html_sha256,'original_parsed_at',metadata->>'parsed_at')||coalesce(d->'receipt','{}'))
 FROM listing_page_snapshots WHERE id=sid RETURNING id INTO oid;
 RETURN oid;
END $$;
