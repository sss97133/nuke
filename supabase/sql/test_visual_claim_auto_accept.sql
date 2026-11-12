-- Empty disposable PG17 only. Never run against a populated application DB.
-- psql -X -v ON_ERROR_STOP=1 -d dm_refinement_visual_claims -f this-file.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,engine_type text,trim text,color text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,is_superseded boolean DEFAULT false);
CREATE TABLE public.field_evidence(id uuid PRIMARY KEY,vehicle_id uuid,field_name text,proposed_value text,
  source_type text,source_confidence integer,status text DEFAULT 'pending',raw_extraction_data jsonb,
  created_at timestamptz DEFAULT now(),assigned_at timestamptz,assigned_by text,
  supporting_signals jsonb,contradicting_signals jsonb);
CREATE TABLE public.vehicle_field_provenance(vehicle_id uuid,field_name text,current_value text,total_confidence integer,
  confidence_factors jsonb,primary_source text,supporting_sources text[],conflicting_sources jsonb,
  last_verified_at timestamptz,last_verified_by text,updated_at timestamptz,PRIMARY KEY(vehicle_id,field_name));
-- Only the original migration's schedule receipt is stubbed. No worker runs.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobname text,active boolean);
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job VALUES ($1,true); SELECT 1::bigint $$;
\ir ../migrations/20261023130000_cited_evidence_auto_accept.sql

INSERT INTO vehicles VALUES('10000000-0000-4000-8000-000000000001',NULL,NULL,'Blue');
INSERT INTO vehicle_images VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',false);
INSERT INTO field_evidence(id,vehicle_id,field_name,proposed_value,source_type,source_confidence,raw_extraction_data,created_at) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','engine_type','Badge text','ai_visual',99,
  '{"photo_id":"20000000-0000-4000-8000-000000000001","quote":"lettering on a removable cover"}','2026-01-01'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','trim','Fender script','ai_visual',99,
  '{"photo_id":"20000000-0000-4000-8000-000000000001","quote":"lettering on the fender"}','2026-01-01'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','color','Blue','ai_visual',99,
  '{"photo_id":"20000000-0000-4000-8000-000000000001","quote":"visible blue paint"}','2026-01-01'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','engine_type','Documented engine','receipt',80,
  '{"document_id":"synthetic-receipt-source"}','2026-01-02');
CREATE FUNCTION t_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
-- Prove the original failure with the actual old function, then undo it.
BEGIN;
SELECT accept_cited_field_evidence('40000000-0000-4000-8000-000000000001',1);
SELECT t_assert((SELECT engine_type='Badge text' FROM vehicles),'old rule promotes attached-image lettering');
ROLLBACK;
CREATE TABLE before_ai AS SELECT * FROM field_evidence WHERE source_type='ai_visual';
CREATE TABLE before_acl AS SELECT proacl FROM pg_proc WHERE oid='public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure;
\ir ../migrations/20261109181000_hold_visual_claim_auto_accept.sql
\ir ../migrations/20261109181000_hold_visual_claim_auto_accept.sql
-- The held rows must not consume the limit and starve the next producer.
SELECT accept_cited_field_evidence('40000000-0000-4000-8000-000000000002',1);
SELECT t_assert((SELECT engine_type='Documented engine' AND trim IS NULL AND color='Blue' FROM vehicles),'other producer still runs; AI does not fill or agree');
SELECT t_assert((SELECT status='accepted' FROM field_evidence WHERE source_type='receipt'),'existing document path retained');
SELECT t_assert(NOT EXISTS((SELECT * FROM before_ai EXCEPT SELECT * FROM field_evidence)
  UNION ALL (SELECT * FROM field_evidence WHERE source_type='ai_visual' EXCEPT SELECT * FROM before_ai)),
  'AI testimony and status remain byte-for-byte unchanged');
SELECT t_assert(NOT EXISTS(SELECT FROM cited_evidence_accept_log l JOIN field_evidence f ON f.id=l.evidence_id WHERE f.source_type='ai_visual'),
  'no new AI promotion or manufactured provenance');
SELECT t_assert((SELECT proacl IS NOT DISTINCT FROM (SELECT proacl FROM before_acl) FROM pg_proc
  WHERE oid='public.accept_cited_field_evidence(uuid,integer,uuid)'::regprocedure),'function permissions unchanged');
SELECT t_assert((accept_cited_field_evidence('40000000-0000-4000-8000-000000000003',200)->>'accepted')::int=0,
  'repeated run retains AI claims pending');
SELECT 'visual claim auto-accept guard: PASS' AS result;
