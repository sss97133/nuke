-- Disposable PostgreSQL 17 contract; no production source writes.
\set ON_ERROR_STOP on
DO $guard$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int < 170000
    OR to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable PG17 database'; END IF;
END $guard$;
DO $roles$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.jwt',true),'')::jsonb,'{}'::jsonb) $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,is_public boolean,deleted_at timestamptz);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY,display_name text,category text,base_trust_score numeric,updated_at timestamptz);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind text,observed_at timestamptz,ingested_at timestamptz,
  source_id uuid REFERENCES public.observation_sources,source_url text,content_text text,structured_data jsonb,
  confidence text,confidence_score numeric,extraction_method text,submitted_by_user_id uuid,
  citation_excerpt text,citation_page_number integer,citation_document_id uuid,citation_secure_document_id uuid,citation_publication_id uuid,
  is_superseded boolean,superseded_at timestamptz,superseded_by uuid REFERENCES public.vehicle_observations);
CREATE TABLE public.harness_signals(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,is_superseded boolean DEFAULT false);
CREATE TABLE public.harness_nets(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,is_superseded boolean DEFAULT false);
CREATE TABLE public.harness_segments(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,is_superseded boolean DEFAULT false);
CREATE TABLE public.wire_termination_specs(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,endpoint_id uuid,circuit_id uuid,is_superseded boolean DEFAULT false);
CREATE TABLE public.harness_designs(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles);
CREATE TABLE public.harness_endpoints(id uuid PRIMARY KEY,design_id uuid REFERENCES public.harness_designs,is_superseded boolean DEFAULT false);
CREATE TABLE public.vehicle_wiring_overlays(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles);
CREATE TABLE public.vehicle_custom_circuits(id uuid PRIMARY KEY,overlay_id uuid REFERENCES public.vehicle_wiring_overlays);
CREATE TABLE public.harness_evidence(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles,observation_id uuid REFERENCES public.vehicle_observations,
  row_kind text CHECK(row_kind IN ('signal','net','segment','termination','endpoint')),row_id uuid,field text,
  relation text CHECK(relation IN ('supports','needs_bench','open','contradicts')));
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_read ON public.vehicles FOR SELECT USING(is_public OR user_id=auth.uid() OR owner_id=auth.uid() OR uploaded_by=auth.uid());
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY observation_read ON public.vehicle_observations FOR SELECT USING(EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=vehicle_id));
CREATE POLICY owner_statement_private_read ON public.vehicle_observations AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(extraction_method IS DISTINCT FROM 'owner_statement_v1' OR submitted_by_user_id=auth.uid());
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_read ON public.observation_sources FOR SELECT TO authenticated USING(true);
DO $policies$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['harness_signals','harness_nets','harness_segments','wire_termination_specs','harness_designs','harness_evidence','vehicle_wiring_overlays'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY harness_read ON public.%I FOR SELECT USING(EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=vehicle_id))',tbl);
  END LOOP;
END $policies$;
ALTER TABLE public.harness_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY endpoint_read ON public.harness_endpoints FOR SELECT USING(EXISTS(SELECT 1 FROM public.harness_designs d WHERE d.id=design_id));
ALTER TABLE public.vehicle_custom_circuits ENABLE ROW LEVEL SECURITY;
CREATE POLICY circuit_read ON public.vehicle_custom_circuits FOR SELECT USING(EXISTS(SELECT 1 FROM public.vehicle_wiring_overlays ov WHERE ov.id=overlay_id));
GRANT SELECT(id,user_id,owner_id,uploaded_by,is_public,deleted_at) ON public.vehicles TO anon,authenticated;
GRANT SELECT ON public.vehicle_observations,public.observation_sources,public.harness_evidence,public.harness_signals,
  public.harness_nets,public.harness_segments,public.wire_termination_specs,public.harness_designs,public.harness_endpoints,
  public.vehicle_wiring_overlays,public.vehicle_custom_circuits TO anon,authenticated;
CREATE TEMP TABLE prior_table_acl AS SELECT oid,relacl FROM pg_class WHERE relnamespace='public'::regnamespace;
CREATE TEMP TABLE prior_column_acl AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM prior_table_acl);

\i supabase/migrations/20261126004251_harness_evidence_witness.sql

DO $permissions$ BEGIN
  IF has_function_privilege('anon','public.harness_evidence_witness(uuid,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.harness_evidence_witness(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.harness_evidence_witness(uuid,uuid)','EXECUTE')
    OR (SELECT prosecdef FROM pg_proc WHERE oid='public.harness_evidence_witness(uuid,uuid)'::regprocedure)
    THEN RAISE EXCEPTION 'Reader execution authority widened'; END IF;
  IF EXISTS(SELECT 1 FROM prior_table_acl p JOIN pg_class c USING(oid) WHERE c.relacl IS DISTINCT FROM p.relacl)
    OR EXISTS(SELECT 1 FROM prior_column_acl p JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attacl IS DISTINCT FROM p.attacl)
    THEN RAISE EXCEPTION 'Base table/column grants changed'; END IF;
END $permissions$;
CREATE TEMP TABLE witness_fixture(label text PRIMARY KEY,vehicle_id uuid,observation_id uuid);
GRANT SELECT ON witness_fixture TO authenticated;
DO $seed$
DECLARE owner_user uuid='00000000-0000-0000-0000-000000007777'; other_user uuid='00000000-0000-0000-0000-000000008888';
  own uuid=gen_random_uuid(); own_private uuid=gen_random_uuid(); other_public uuid=gen_random_uuid(); other_private uuid=gen_random_uuid();
  deleted uuid=gen_random_uuid(); uploader_only uuid=gen_random_uuid(); src uuid=gen_random_uuid(); label text; v uuid; ov uuid; target_v uuid; ob uuid; target uuid; design uuid; kind text; ep uuid; overlay_id uuid; circuit uuid;
BEGIN
  INSERT INTO public.vehicles VALUES(own,owner_user,NULL,owner_user,true,NULL),(own_private,NULL,owner_user,other_user,false,NULL),
    (other_public,other_user,NULL,other_user,true,NULL),(other_private,other_user,NULL,other_user,false,NULL),
    (deleted,owner_user,NULL,owner_user,true,now()),(uploader_only,other_user,NULL,owner_user,true,NULL);
  INSERT INTO public.observation_sources VALUES(src,'Synthetic maker document','documentation',0.8,'2026-11-25');
  FOREACH label IN ARRAY ARRAY['signal','net','segment','termination','endpoint','historical','private_owner','other_public','other_private',
    'deleted','uploader_only','unlinked','wrong_kind','wrong_domain','foreign_observation','foreign_target','mistyped_target','restricted','unsafe_url',
    'retained_target','foreign_end_endpoint','foreign_end_circuit'] LOOP
    v:=CASE label WHEN 'private_owner' THEN own_private WHEN 'other_public' THEN other_public WHEN 'other_private' THEN other_private
      WHEN 'deleted' THEN deleted WHEN 'uploader_only' THEN uploader_only ELSE own END;
    ov:=CASE WHEN label='foreign_observation' THEN other_public ELSE v END;
    target_v:=CASE WHEN label='foreign_target' THEN other_public ELSE v END;
    ob:=gen_random_uuid(); target:=gen_random_uuid(); design:=gen_random_uuid();
    kind:=CASE WHEN label IN ('signal','net','segment','termination','endpoint') THEN label WHEN label='mistyped_target' THEN 'endpoint'
      WHEN label IN ('foreign_end_endpoint','foreign_end_circuit') THEN 'termination' ELSE 'segment' END;
    IF kind='endpoint' THEN
      INSERT INTO public.harness_designs VALUES(design,target_v); INSERT INTO public.harness_endpoints VALUES(target,design);
    ELSE EXECUTE format('INSERT INTO public.%I VALUES($1,$2)',CASE kind WHEN 'signal' THEN 'harness_signals' WHEN 'net' THEN 'harness_nets'
      WHEN 'termination' THEN 'wire_termination_specs' ELSE 'harness_segments' END) USING target,target_v; END IF;
    IF kind='termination' THEN
      ep:=gen_random_uuid(); overlay_id:=gen_random_uuid(); circuit:=gen_random_uuid();
      INSERT INTO public.harness_designs VALUES(design,CASE WHEN label='foreign_end_endpoint' THEN other_public ELSE target_v END);
      INSERT INTO public.harness_endpoints VALUES(ep,design);
      INSERT INTO public.vehicle_wiring_overlays VALUES(overlay_id,CASE WHEN label='foreign_end_circuit' THEN other_public ELSE target_v END);
      INSERT INTO public.vehicle_custom_circuits VALUES(circuit,overlay_id);
      UPDATE public.wire_termination_specs SET endpoint_id=ep,circuit_id=circuit WHERE id=target;
    END IF;
    IF label='retained_target' THEN UPDATE public.harness_segments SET is_superseded=true WHERE id=target; END IF;
    INSERT INTO public.vehicle_observations(id,vehicle_id,kind,observed_at,ingested_at,source_id,source_url,content_text,structured_data,
      confidence,confidence_score,extraction_method,submitted_by_user_id,citation_excerpt,citation_page_number,is_superseded,superseded_at)
    VALUES(ob,ov,CASE WHEN label='wrong_kind' THEN 'condition' ELSE 'specification' END,'2026-11-20','2026-11-21',src,
      CASE WHEN label='unsafe_url' THEN 'javascript:alert(1)' ELSE 'https://example.com/spec.pdf' END,'Retained attributed wiring claim',
      jsonb_build_object('domain',CASE WHEN label='wrong_domain' THEN 'paint' ELSE 'wiring' END,'value','24 AWG claim','state','open','row_field','wire',
        'property_key','wiring.wire','citation','Document page 4','order',jsonb_build_object('secret','DO NOT PROJECT'),'merchant','Private identity'),
      'medium',0.6,CASE WHEN label='restricted' THEN 'owner_statement_v1' ELSE 'registry_v5_loader' END,other_user,'Quoted specification',4,label='historical',
      CASE WHEN label='historical' THEN now() END);
    IF label<>'unlinked' THEN INSERT INTO public.harness_evidence VALUES(gen_random_uuid(),v,ob,
      CASE WHEN label='mistyped_target' THEN 'signal' ELSE kind END,target,'wire','needs_bench'); END IF;
    INSERT INTO witness_fixture VALUES(label,v,ob);
  END LOOP;
  UPDATE public.vehicle_observations SET superseded_by=(SELECT f.observation_id FROM witness_fixture f WHERE f.label='signal')
    WHERE id=(SELECT f.observation_id FROM witness_fixture f WHERE f.label='historical');
END $seed$;
SET ROLE authenticated;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000007777',false),set_config('test.jwt','{"role":"authenticated","is_anonymous":false}',false);
DO $owner$ DECLARE f record; result jsonb; BEGIN
  FOR f IN SELECT * FROM witness_fixture LOOP
    result:=public.harness_evidence_witness(f.vehicle_id,f.observation_id);
    IF f.label IN ('signal','net','segment','termination','endpoint','historical','private_owner','unsafe_url','retained_target') THEN
      IF result IS NULL OR result->>'visibility'<>'vehicle_owner' OR result->>'vehicle_id'<>f.vehicle_id::text OR result->>'observation_id'<>f.observation_id::text
        OR result->>'content_text'<>'Retained attributed wiring claim' OR jsonb_array_length(result->'evidence_edges')<>1
        OR result ? 'structured_data' OR result->'claim' ? 'order' OR result->'claim' ? 'merchant'
        THEN RAISE EXCEPTION 'Owner witness failed: %',f.label; END IF;
      IF f.label='historical' AND (result->>'historical'<>'true' OR result->>'superseded_by' IS NULL) THEN RAISE EXCEPTION 'History replaced or hidden'; END IF;
      IF f.label='retained_target' AND (result->>'historical'<>'false' OR result#>>'{evidence_edges,0,target_revision}'<>'superseded') THEN RAISE EXCEPTION 'Target and observation histories conflated'; END IF;
      IF f.label='unsafe_url' AND result->>'source_url' IS NOT NULL THEN RAISE EXCEPTION 'Unsafe source URL projected'; END IF;
    ELSIF result IS NOT NULL THEN RAISE EXCEPTION 'Unauthorized/wrong-subject witness exposed: %',f.label; END IF;
  END LOOP;
  IF public.harness_evidence_witness(gen_random_uuid(),gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'Absent witness exposed'; END IF;
END $owner$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000009999',false);
DO $nonowner$ BEGIN IF EXISTS(SELECT 1 FROM witness_fixture WHERE public.harness_evidence_witness(vehicle_id,observation_id) IS NOT NULL)
  THEN RAISE EXCEPTION 'Unrelated user received source'; END IF; END $nonowner$;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000007777',false),set_config('test.jwt','{"role":"authenticated","is_anonymous":true}',false);
DO $anonymous$ BEGIN IF EXISTS(SELECT 1 FROM witness_fixture WHERE public.harness_evidence_witness(vehicle_id,observation_id) IS NOT NULL)
  THEN RAISE EXCEPTION 'Anonymous JWT received source'; END IF; END $anonymous$;
SELECT set_config('test.jwt','{"role":"authenticated"}',false);
DO $missing$ BEGIN IF EXISTS(SELECT 1 FROM witness_fixture WHERE public.harness_evidence_witness(vehicle_id,observation_id) IS NOT NULL)
  THEN RAISE EXCEPTION 'Unqualified JWT received source'; END IF; END $missing$;
SELECT set_config('test.uid','',false),set_config('test.jwt','{"role":"authenticated","is_anonymous":false}',false);
DO $nouser$ BEGIN IF EXISTS(SELECT 1 FROM witness_fixture WHERE public.harness_evidence_witness(vehicle_id,observation_id) IS NOT NULL)
  THEN RAISE EXCEPTION 'Missing user received source'; END IF; END $nouser$;
RESET ROLE;
SELECT 'harness owner witness: typed targets, historical source, RLS, grants, JWT and subject negatives passed' AS result;
