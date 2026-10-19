-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations. The anchor lines other job-loop
-- lanes add (quote/offer dispatch, execution/completion/accounting overlays) are recreated with identity stubs;
-- test_job_loop_replay.sql proves the edit against the real build.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_observations') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid,request_source text,title text,description text,scope_description text,
 quoted_at timestamptz,estimated_total numeric,estimated_cost_cents integer,approved_at timestamptz,scheduled_start timestamptz,
 scheduled_end timestamptz,started_at timestamptz,actual_start timestamptz,completed_at timestamptz,actual_end timestamptz,status text,
 created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.actors(id uuid PRIMARY KEY,name text,actor_type text);
CREATE TABLE public.component_events(id uuid PRIMARY KEY,vehicle_id uuid,work_order_id uuid,metadata jsonb);
CREATE TABLE public.work_order_parts(id uuid PRIMARY KEY,work_order_id uuid,part_name text,status text,job_op_code text);
CREATE TABLE public.work_order_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL REFERENCES work_orders(id),
 line_number integer,task_type text NOT NULL DEFAULT 'other',task_description text,actor_id uuid REFERENCES actors(id),
 status text NOT NULL DEFAULT 'pending',component_event_id uuid,notes text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text,
 accepted_at timestamptz,started_at timestamptz,completed_at timestamptz,actual_payout numeric,paid_at timestamptz,payout_status text);
CREATE TABLE public.work_order_labor(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,hours numeric,ai_estimated boolean);
CREATE TABLE public.work_order_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid);
CREATE TABLE public.work_order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid,status text);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope_type text,scope_id uuid,is_superseded boolean);
CREATE TYPE public.observation_kind AS ENUM ('valuation','condition','specification','work_record');
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,slug text UNIQUE,category text,
 supported_observations public.observation_kind[],updated_at timestamptz);
INSERT INTO observation_sources VALUES ('90000000-0000-0000-0000-000000000001','internal-inference','internal',
 ARRAY['valuation','condition','specification']::public.observation_kind[],now());
CREATE TABLE public.user_tools(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.tool_inventory(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.equipment(id uuid PRIMARY KEY,shop_id uuid);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,source_id uuid,
  content_text text,extraction_method text,confidence_score numeric,structured_data jsonb,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),is_superseded boolean DEFAULT false);
CREATE TABLE public.pipeline_registry(id uuid DEFAULT gen_random_uuid(),table_name text,column_name text,owned_by text,
  description text,do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.t_refused(q text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;

INSERT INTO work_orders(id,vehicle_id,title,status) VALUES
 ('30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Pre-delivery','in_progress'),
 ('30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Other vehicle','pending');
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_description) VALUES
 ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'Shock install'),
 ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'Window motor'),
 ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002',1,'Elsewhere');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,content_text,observed_at,structured_data) VALUES
 ('81000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record',NULL,
  'That price is fair for install the shocks and window motor.','2026-02-24T00:20:00Z','{"who":"BUYER"}'),
 ('81000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record',NULL,
  'Here is the invoice, pay link is not working yet.','2026-03-01T09:21:00Z','{"who":"SELLER"}'),
 ('81000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','work_record',NULL,
  'Window motor done regulator stripped clean and re greased.','2026-03-18T21:36:00Z','{"who":"SELLER"}'),
 ('81000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','work_record',NULL,
  'We paused on both until the shocks arrive.','2026-03-06T18:21:00Z','{"who":"SELLER"}');

\ir ../migrations/20261019005027_work_order_resource_evidence.sql
\ir ../migrations/20261019013808_work_resource_retained_basis.sql
\ir ../migrations/20261019030510_work_resource_actor_candidates.sql
\ir ../migrations/20261019035407_work_order_resource_specifications.sql
\ir ../migrations/20261019045753_work_order_job_path.sql
\ir ../migrations/20261019051336_work_order_scope_operations.sql

-- Recreate the other lanes' anchor lines with identity stubs.
CREATE FUNCTION public.project_work_order_quote_event(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.project_work_order_offer_event(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.work_order_execution_start_overlay(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION public.work_order_completion_overlay(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION public.work_order_accounting_overlay(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $2 $$;
DO $sim$
DECLARE
  pj text := pg_get_functiondef('public.project_work_order_resource_observation(uuid)'::regprocedure);
  jp text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
BEGIN
  pj := replace(pj,$a$'specification','operation') THEN$a$,$a$'specification','operation','quote','quote_acceptance','offer','offer_acceptance') THEN$a$);
  pj := replace(pj,$a$  -- Retained-source links are explicit$a$,$a$  IF event_type IN ('quote','quote_acceptance') THEN
    RETURN public.project_work_order_quote_event(o.id);
  END IF;
  IF event_type IN ('offer','offer_acceptance') THEN
    RETURN public.project_work_order_offer_event(o.id);
  END IF;
  -- Retained-source links are explicit$a$);
  EXECUTE pj;
  jp := replace(jp,$a$  SELECT count(*) INTO n_hist FROM$a$,$a$  execution := public.work_order_execution_start_overlay(w.id, execution);
  SELECT count(*) INTO n_hist FROM$a$);
  jp := replace(jp,$a$  SELECT count(*) INTO n_pay FROM$a$,$a$  completion := public.work_order_completion_overlay(w.id, completion);
  SELECT count(*) INTO n_pay FROM$a$);
  jp := replace(jp,$a$  RETURN jsonb_build_object('work_order_id',w.id$a$,$a$  accounting := public.work_order_accounting_overlay(w.id, accounting);
  RETURN jsonb_build_object('work_order_id',w.id$a$);
  EXECUTE jp;
END $sim$;

\ir ../migrations/20261020002000_work_order_retained_testimony.sql

-- Synthetic interpretations in the guarded disposable database only.
CREATE FUNCTION public.lc(p_basis uuid,p_patch jsonb DEFAULT '{}',p_observed timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE k uuid:=gen_random_uuid(); b record; BEGIN
 SELECT * INTO b FROM vehicle_observations WHERE id=p_basis;
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data)
 VALUES(k,b.vehicle_id,'work_record','90000000-0000-0000-0000-000000000001',COALESCE(p_observed,b.observed_at),
 'retained_work_lifecycle_interpretation_v1',0.6,jsonb_build_object('work_order_resource',jsonb_build_object('version',1,
 'event_type','retained_lifecycle','work_order_id','30000000-0000-0000-0000-000000000001','basis_observation_id',p_basis,
 'speaker_label',b.structured_data->>'who')||p_patch));
 RETURN k; END $$;
CREATE FUNCTION public.proj(p uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT project_work_order_resource_observation(p) $$;
CREATE FUNCTION public.refused(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT t_refused(format('SELECT project_work_order_resource_observation(%L)',p)) $$;
CREATE FUNCTION public.stage(p text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_work_order_job_path('30000000-0000-0000-0000-000000000001')#>ARRAY['stages',p] $$;

SELECT lc('81000000-0000-0000-0000-000000000001','{"lifecycle_stage":"terms_accepted","speaker_side":"client","line_item_id":"50000000-0000-0000-0000-000000000001","basis_excerpt":"is fair for install the shocks and window motor"}') AS t1 \gset
SELECT lc('81000000-0000-0000-0000-000000000001','{"lifecycle_stage":"terms_accepted","speaker_side":"client","line_item_id":"50000000-0000-0000-0000-000000000002","basis_excerpt":"is fair for install the shocks and window motor"}') AS t2 \gset
SELECT lc('81000000-0000-0000-0000-000000000002','{"lifecycle_stage":"invoice_issued","speaker_side":"provider","basis_excerpt":"Here is the invoice"}') AS inv \gset
SELECT lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"operation_completed","speaker_side":"provider","line_item_id":"50000000-0000-0000-0000-000000000002","basis_excerpt":"Window motor done"}') AS done \gset
SELECT lc('81000000-0000-0000-0000-000000000004','{"lifecycle_stage":"work_paused","speaker_side":"provider","basis_excerpt":"We paused on both"}') AS paused \gset
SET ROLE service_role;
SELECT t_assert(stage('terms')#>>'{retained_testimony,claims}'='0','no testimony before projection');
SELECT t_assert(proj(:'t1') @> '{"event_type":"retained_lifecycle","duplicate":false}','retained lifecycle event dispatches to its projector');
SELECT t_assert((proj(:'t1')->>'duplicate')::boolean,'lifecycle replay is idempotent');
SELECT proj(:'t2'); SELECT proj(:'inv'); SELECT proj(:'done'); SELECT proj(:'paused');
SELECT t_assert(stage('terms') @> '{"retained_testimony":{"claims":2,"by_side":{"client":2},"operations":2}}','client acceptance testimony per operation');
SELECT t_assert(stage('terms')->>'customer_acceptance'='not_established' AND stage('terms')->>'approval_clock' IS NULL
 AND stage('terms')->>'state'='absent','testimony never becomes an approval Sign or clock');
SELECT t_assert(stage('completion') @> '{"retained_testimony":{"claims":1,"operations":1,"by_stage":{"operation_completed":1}}}'
 AND stage('completion')->>'state'='absent','completion testimony leaves completion state unchanged');
SELECT t_assert(stage('accounting') @> '{"state":"absent","retained_testimony":{"claims":1,"by_stage":{"invoice_issued":1}}}','invoice report is testimony, not a payment record');
SELECT t_assert(stage('execution') @> '{"retained_testimony":{"claims":1,"by_stage":{"work_paused":1}}}','pause testimony on execution');
SELECT t_assert((stage('completion')#>>'{retained_testimony,latest_message_at}')::timestamptz='2026-03-18T21:36:00Z','testimony keeps the original message clock');
SELECT t_assert(read_work_order_job_path('30000000-0000-0000-0000-000000000001')::text !~ '(Window motor done|is fair for|Here is the invoice|BUYER|SELLER)','job path returns no message text or speaker labels');
SELECT t_assert(work_order_job_path_scoreboard()->'retained_testimony_work_orders' @> '{"terms":1,"completion":1,"accounting":1,"execution":1}','scoreboard counts work orders with testimony');
SELECT t_assert(t_refused($q$UPDATE work_order_retained_testimony SET speaker_side='provider'$q$),'testimony is immutable');
RESET ROLE;
SELECT t_assert(t_refused($q$DELETE FROM work_order_retained_testimony$q$),'even owner cannot delete testimony');

SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000001','{"lifecycle_stage":"terms_accepted","speaker_side":"client","basis_excerpt":"is fine for everything"}')),'excerpt absent from the message refused');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000001','{"lifecycle_stage":"terms_accepted","speaker_side":"client","basis_excerpt":"is fair"}','2026-02-25')),'interpretation on a later clock refused');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000001','{"lifecycle_stage":"terms_accepted","speaker_side":"client","basis_excerpt":"is fair","speaker_label":"SELLER"}')),'speaker label must match the message attribution');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"terms_accepted","speaker_side":"provider","basis_excerpt":"Window motor done"}')),'a provider cannot accept the client terms');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"operation_completed","speaker_side":"provider","basis_excerpt":"Window motor done"}')),'completion must name an operation');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"operation_completed","speaker_side":"provider","basis_excerpt":"Window motor done","line_item_id":"50000000-0000-0000-0000-000000000003"}')),'operation from another work order refused');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"approved","speaker_side":"provider","basis_excerpt":"Window motor done"}')),'unknown lifecycle stage refused');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"work_paused","speaker_side":"provider"}')),'missing excerpt refused');
SELECT t_assert(refused(lc('81000000-0000-0000-0000-000000000003','{"lifecycle_stage":"work_paused","speaker_side":"provider","basis_excerpt":"Window motor done","work_order_id":"30000000-0000-0000-0000-000000000002"}')),'work order on another vehicle refused');
SELECT t_assert(t_refused($q$SELECT project_work_order_retained_testimony('81000000-0000-0000-0000-000000000001')$q$),'a raw message cannot be projected as testimony');

UPDATE vehicle_observations SET is_superseded=true WHERE id='81000000-0000-0000-0000-000000000003';
SET ROLE service_role;
SELECT t_assert(stage('completion')#>>'{retained_testimony,claims}'='0','withdrawn message drops its testimony');
SELECT t_assert(t_refused(format('SELECT project_work_order_resource_observation(%L)',:'done')),'withdrawn message blocks replay');
RESET ROLE;
UPDATE vehicle_observations SET is_superseded=true WHERE id=:'inv';
SET ROLE service_role;
SELECT t_assert(stage('accounting')#>>'{retained_testimony,claims}'='0','withdrawn interpretation drops its testimony');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM work_order_retained_testimony)=5,'withdrawn testimony is retained');

SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_retained_testimony$q$),'anonymous testimony inaccessible');
SELECT t_assert(t_refused($q$SELECT work_order_retained_testimony_overlay('30000000-0000-0000-0000-000000000001','terms','{}')$q$),'anonymous overlay refused');
SELECT t_assert(t_refused(format('SELECT project_work_order_retained_testimony(%L)',:'t1')),'anonymous projection refused');
RESET ROLE;
SET ROLE authenticated;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_retained_testimony$q$),'signed-in stranger cannot read testimony');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM pipeline_registry WHERE table_name='work_order_retained_testimony')=1,'testimony owner registered');
SELECT t_assert((SELECT count(*) FROM information_schema.columns c JOIN pg_class t ON t.relname=c.table_name
 WHERE c.table_name='work_order_retained_testimony' AND col_description(t.oid,c.ordinal_position::int) IS NULL)=0,'every column described');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('project_work_order_retained_testimony','work_order_retained_testimony_overlay');
