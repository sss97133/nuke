\set ON_ERROR_STOP on
\ir test_financial_evidence.sql
\ir ../migrations/20261023235500_read_financial_evidence_original_ref.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('a',64),'storage_path',u||'/statement.pdf','byte_size',100,'source_filename','statement.pdf');
 r jsonb:='{"idempotency_key":"one","method":"original-ref-test","version":"1","fields":[{"field_key":"capture","value_raw":"captured","evidence":{"stage":"retained"}}]}';
 a jsonb; doc jsonb;
BEGIN
 a:=ingest_financial_evidence(u,o,r);
 doc:=read_financial_evidence(u,(a->>'document_id')::uuid,NULL)->'document';
 -- The delegated original download reads these two keys; without them every request was refused.
 IF doc->>'owner_id' IS DISTINCT FROM u::text THEN RAISE EXCEPTION 'reader must return the document owner: %', doc; END IF;
 IF doc->>'storage_path' IS DISTINCT FROM u||'/statement.pdf' THEN RAISE EXCEPTION 'reader must return the stored path: %', doc; END IF;
 IF doc->>'content_sha256'<>repeat('a',64) OR doc->>'id'<>a->>'document_id' OR doc->>'source_filename'<>'statement.pdf' THEN RAISE EXCEPTION 'existing document keys changed: %', doc; END IF;
 IF read_financial_evidence(u,NULL,repeat('a',64))->'document'->>'storage_path' IS DISTINCT FROM u||'/statement.pdf' THEN RAISE EXCEPTION 'sha selector must return the same reference'; END IF;
 -- Another owner's selector never reaches this document.
 IF read_financial_evidence('22222222-2222-4222-8222-222222222222',(a->>'document_id')::uuid,NULL) IS NOT NULL THEN RAISE EXCEPTION 'reader crossed owners'; END IF;
END $$;
-- Still service-only.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 BEGIN PERFORM read_financial_evidence('11111111-1111-4111-8111-111111111111',NULL,repeat('a',64)); RAISE EXCEPTION 'authenticated caller reached the reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.read_financial_evidence(uuid,uuid,text)','EXECUTE') OR has_function_privilege('authenticated','public.read_financial_evidence(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'reader grant widened'; END IF;
 RAISE NOTICE 'PASS read_financial_evidence returns the original reference (owner_id, storage_path) and stays service-only';
END $$;
ROLLBACK;
