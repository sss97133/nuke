-- Disposable local PostgreSQL fixture only. Run from supabase/sql with psql -f.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean DEFAULT false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.financial_documents(
id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
owner_id uuid NOT NULL,
content_sha256 text,
logical_index integer DEFAULT 1 NOT NULL,
storage_path text,
source_filename text,
page_count integer,
byte_size bigint,
source_kind text DEFAULT 'email_attachment'::text NOT NULL,
source_email_message_id text,
source_email_from text,
source_email_domain text,
source_email_date timestamp with time zone,
doc_type text DEFAULT 'unclassified'::text NOT NULL,
doc_type_confidence numeric,
direction text DEFAULT 'unknown'::text NOT NULL,
document_number text,
deal_number text,
document_date date,
due_date date,
service_period_start date,
service_period_end date,
season_label text,
issuer_name_raw text,
issuer_org_id uuid,
issuer_person_id uuid,
issuer_tax_id text,
recipient_name_raw text,
recipient_org_id uuid,
recipient_person_id uuid,
recipient_tax_id text,
currency text,
amount_ht numeric,
tva_rate numeric,
amount_tva numeric,
amount_ttc numeric,
amount_confidence numeric,
payment_terms_raw text,
payment_terms_days integer,
payment_method_raw text,
bank_iban_masked text,
bank_iban_hash text,
bank_bic text,
deal_id uuid,
publication_id uuid,
issue_id uuid,
issue_canon text,
ocr_text text,
ocr_engine text,
ocr_confidence numeric,
attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
extraction_status text DEFAULT 'pending'::text NOT NULL,
review_status text DEFAULT 'unreviewed'::text NOT NULL,
duplicate_of uuid,
resend_count integer DEFAULT 0 NOT NULL,
privacy_tier text DEFAULT 'private'::text NOT NULL,
created_at timestamp with time zone DEFAULT now(),
updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE financial_documents ADD CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE financial_documents ADD CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text, 'internal'::text, 'unknown'::text])));
ALTER TABLE financial_documents ADD CHECK ((doc_type = ANY (ARRAY['devis'::text, 'facture'::text, 'avoir'::text, 'insertion_order'::text, 'bon_de_commande'::text, 'payment_receipt'::text, 'remittance_advice'::text, 'releve'::text, 'rate_card'::text, 'media_kit'::text, 'contract'::text, 'commission_statement'::text, 'unclassified'::text, 'other'::text])));
ALTER TABLE financial_documents ADD CHECK ((extraction_status = ANY (ARRAY['pending'::text, 'ocr_done'::text, 'extracted'::text, 'resolved'::text, 'verified'::text, 'failed'::text, 'rejected'::text])));
ALTER TABLE financial_documents ADD CHECK ((privacy_tier = ANY (ARRAY['private'::text, 'published'::text, 'mutual'::text, 'aggregate'::text])));
ALTER TABLE financial_documents ADD CHECK ((review_status = ANY (ARRAY['unreviewed'::text, 'auto_accepted'::text, 'needs_review'::text, 'reviewed'::text])));
ALTER TABLE financial_documents ADD CHECK ((source_kind = ANY (ARRAY['email_attachment'::text, 'email_body'::text, 'scan'::text, 'upload'::text, 'bank_export'::text, 'other'::text])));
ALTER TABLE financial_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_read ON financial_documents FOR SELECT TO authenticated USING(owner_id=auth.uid());
-- Mirror live owner mutations so custody bypasses are exercised under real grants.
CREATE POLICY own_insert ON financial_documents FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid());
CREATE POLICY own_update ON financial_documents FOR UPDATE TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY own_delete ON financial_documents FOR DELETE TO authenticated USING(owner_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON financial_documents TO authenticated;
CREATE TABLE public.financial_document_extractions(
id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
owner_id uuid NOT NULL,
document_id uuid NOT NULL,
line_id uuid,
field_key text NOT NULL,
value_raw text NOT NULL,
value_normalized jsonb,
value_type text DEFAULT 'text'::text NOT NULL,
page_number integer,
region jsonb,
ocr_confidence numeric,
extraction_confidence numeric,
extractor text DEFAULT 'ocr_agent'::text NOT NULL,
extractor_model text,
extraction_run_id uuid,
is_superseded boolean DEFAULT false NOT NULL,
superseded_by uuid,
superseded_at timestamp with time zone,
privacy_tier text DEFAULT 'private'::text NOT NULL,
created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE financial_document_extractions ADD CHECK ((privacy_tier = ANY (ARRAY['private'::text, 'published'::text, 'mutual'::text, 'aggregate'::text])));
ALTER TABLE financial_document_extractions ADD CHECK ((value_type = ANY (ARRAY['text'::text, 'amount'::text, 'date'::text, 'number'::text, 'percentage'::text, 'identifier'::text, 'iban'::text, 'bic'::text, 'tax_id'::text, 'currency'::text, 'email'::text, 'phone'::text, 'url'::text, 'event'::text])));
ALTER TABLE financial_document_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_read ON financial_document_extractions FOR SELECT TO authenticated USING(owner_id=auth.uid());
GRANT SELECT ON financial_document_extractions TO authenticated;
CREATE TABLE public.financial_review_queue(
id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
owner_id uuid NOT NULL,
document_id uuid NOT NULL,
concern_type text NOT NULL,
priority text DEFAULT 'medium'::text NOT NULL,
status text DEFAULT 'pending'::text NOT NULL,
detail text,
confidence_factors jsonb DEFAULT '{}'::jsonb NOT NULL,
resolver text NOT NULL,
resolution text,
resolution_notes text,
resolved_by text,
resolved_at timestamp with time zone,
created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE financial_review_queue ADD CHECK ((concern_type = ANY (ARRAY['montant_non_corrobore'::text, 'ecart_arithmetique'::text, 'ecart_tva'::text, 'doublon_suspect'::text, 'piece_illisible'::text, 'tiers_non_identifie'::text, 'hors_perimetre'::text, 'cut_off'::text])));
ALTER TABLE financial_review_queue ADD CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
ALTER TABLE financial_review_queue ADD CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text])));
ALTER TABLE financial_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_read ON financial_review_queue FOR SELECT TO authenticated USING(owner_id=auth.uid());
GRANT SELECT ON financial_review_queue TO authenticated;
CREATE OR REPLACE FUNCTION public.financial_extractions_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.line_id IS DISTINCT FROM OLD.line_id
       OR NEW.field_key IS DISTINCT FROM OLD.field_key
       OR NEW.value_raw IS DISTINCT FROM OLD.value_raw
       OR NEW.value_normalized IS DISTINCT FROM OLD.value_normalized
       OR NEW.value_type IS DISTINCT FROM OLD.value_type
       OR NEW.page_number IS DISTINCT FROM OLD.page_number
       OR NEW.region IS DISTINCT FROM OLD.region
       OR NEW.ocr_confidence IS DISTINCT FROM OLD.ocr_confidence
       OR NEW.extraction_confidence IS DISTINCT FROM OLD.extraction_confidence
       OR NEW.extractor IS DISTINCT FROM OLD.extractor
       OR NEW.extractor_model IS DISTINCT FROM OLD.extractor_model
       OR NEW.extraction_run_id IS DISTINCT FROM OLD.extraction_run_id
       OR NEW.privacy_tier IS DISTINCT FROM OLD.privacy_tier
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'financial_document_extractions is append-only: only supersession columns may change';
    END IF;
    RETURN NEW;
END $function$
;
CREATE TRIGGER immutable BEFORE UPDATE ON financial_document_extractions FOR EACH ROW EXECUTE FUNCTION financial_extractions_immutable();
GRANT USAGE ON SCHEMA auth TO authenticated;
\ir ../migrations/20261022120000_financial_evidence_intake.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111';
 o jsonb := jsonb_build_object('sha256',repeat('a',64),'storage_path',u||'/proof.pdf','byte_size',123,'source_kind','upload');
 r jsonb := '{"idempotency_key":"review1","method":"synthetic-review","version":"1","fields":[{"field_key":"amount","value_raw":"12.34","value_normalized":12.34,"value_type":"amount","evidence":{"source":"synthetic retained receipt","stage":"extracted_claim"}}],"concerns":[{"concern_type":"montant_non_corrobore","resolver":"accountant","detail":"bank evidence missing"}]}';
 a jsonb; b jsonb; c jsonb;
BEGIN
 a:=ingest_financial_evidence(u,o,r,'{"kind":"api_key","agent_id":"33333333-3333-4333-8333-333333333333"}'::jsonb);
 IF NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE value_normalized->'auth_context'->>'agent_id'='33333333-3333-4333-8333-333333333333') THEN RAISE EXCEPTION 'agent attribution lost'; END IF;
 b:=ingest_financial_evidence(u,o,r);
 IF b->>'duplicate'<>'true' OR a->>'document_id'<>b->>'document_id' THEN RAISE EXCEPTION 'retry failed'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,jsonb_set(r,'{version}','"changed"'));
  RAISE EXCEPTION 'accepted conflicting replay';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted conflicting replay' THEN RAISE; END IF; END;
 c:=ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','review2','supersedes_run_id',a->>'extraction_run_id'));
 IF (SELECT count(*) FROM financial_documents)<>1 OR (SELECT count(*) FROM financial_document_extractions)<>2
 OR (SELECT count(*) FROM financial_document_extractions WHERE NOT is_superseded)<>1
 OR (SELECT count(*) FROM financial_review_queue WHERE status='pending')<>2 THEN RAISE EXCEPTION 'revision preservation failed'; END IF;
 IF EXISTS(SELECT 1 FROM financial_documents WHERE amount_ttc IS NOT NULL OR review_status<>'needs_review') THEN RAISE EXCEPTION 'unreviewed amount promoted'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','stale','supersedes_run_id',a->>'extraction_run_id'));
  RAISE EXCEPTION 'accepted stale revision';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted stale revision' THEN RAISE; END IF; END;
 BEGIN
  PERFORM ingest_financial_evidence('22222222-2222-4222-8222-222222222222',o,r);
  RAISE EXCEPTION 'accepted foreign path';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted foreign path' THEN RAISE; END IF; END;
 IF read_financial_evidence(u,(a->>'document_id')::uuid,NULL)->'fields'->0->>'field_key'<>'amount'
 OR read_financial_evidence('22222222-2222-4222-8222-222222222222',(a->>'document_id')::uuid,NULL) IS NOT NULL
 THEN RAISE EXCEPTION 'API reader scope/current fields failed'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','duplicate-fields','supersedes_run_id',c->>'extraction_run_id','fields',(r->'fields')||(r->'fields')));
  RAISE EXCEPTION 'accepted duplicate fields';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted duplicate fields' THEN RAISE; END IF; END;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','partial','supersedes_run_id',c->>'extraction_run_id','fields','[{"field_key":"other","value_raw":"x"}]'::jsonb));
  RAISE EXCEPTION 'accepted partial correction';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted partial correction' THEN RAISE; END IF; END;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','ocr','supersedes_run_id',c->>'extraction_run_id','fields','[{"field_key":"amount","value_raw":"x","evidence":{"ocr_text":"private text"}}]'::jsonb));
  RAISE EXCEPTION 'accepted hidden OCR';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted hidden OCR' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM financial_document_extractions old JOIN financial_document_extractions new ON old.superseded_by=new.id WHERE old.field_key<>new.field_key) THEN RAISE EXCEPTION 'misbound field lineage'; END IF;
 RAISE NOTICE 'PASS replay/conflict, complete revision, stale/partial/duplicate/privacy refusal, exact field lineage and API readback';
END $$;
DO $$
DECLARE mutation text;
BEGIN
 FOREACH mutation IN ARRAY ARRAY[
   'content_sha256=repeat(''b'',64)', 'storage_path=''rebound.pdf''',
   'attributes=attributes - ''intake_mode''', 'attributes=jsonb_set(attributes,''{runs}'',''[]'')',
   'privacy_tier=''published'''
 ] LOOP
   BEGIN
     EXECUTE 'UPDATE financial_documents SET ' || mutation;
     RAISE EXCEPTION 'service custody mutation accepted: %',mutation;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RAISE NOTICE 'PASS service cannot rebind original, remove marker/history, or publish';
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM financial_documents)<>1 OR (SELECT count(*) FROM financial_document_extractions WHERE NOT is_superseded)<>1 THEN RAISE EXCEPTION 'owner reader roundtrip failed'; END IF;
 IF has_function_privilege(current_user,'ingest_financial_evidence(uuid,jsonb,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'unverified direct admission granted'; END IF;
END $$;
DO $$
DECLARE mutation text;
BEGIN
 FOREACH mutation IN ARRAY ARRAY[
   'content_sha256=repeat(''b'',64)', 'storage_path=''rebound.pdf''',
   'attributes=''{}''::jsonb', 'attributes=jsonb_set(attributes,''{runs}'',''[]'')'
 ] LOOP
   BEGIN
     EXECUTE 'UPDATE financial_documents SET ' || mutation;
     RAISE EXCEPTION 'owner custody mutation accepted: %',mutation;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 BEGIN
   DELETE FROM financial_documents;
   RAISE EXCEPTION 'owner deleted admitted original';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   INSERT INTO financial_documents(owner_id,attributes) VALUES(auth.uid(),'{"intake_mode":"financial_evidence_v1","runs":[]}');
   RAISE EXCEPTION 'owner forged admission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   INSERT INTO financial_documents(owner_id,attributes) VALUES(auth.uid(),'{"runs":[]}');
   RAISE EXCEPTION 'owner forged unmarked revision history';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO financial_documents(owner_id,source_filename) VALUES(auth.uid(),'legacy');
 UPDATE financial_documents SET source_filename='legacy-updated' WHERE source_filename='legacy';
 BEGIN
   UPDATE financial_documents SET attributes='{"intake_mode":"financial_evidence_v1"}' WHERE source_filename='legacy-updated';
   RAISE EXCEPTION 'owner promoted legacy original';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 DELETE FROM financial_documents WHERE source_filename='legacy-updated';
 RAISE NOTICE 'PASS authenticated OLD/NEW custody, forgery and history guards; legacy unaffected';
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM financial_documents) OR EXISTS(SELECT 1 FROM financial_document_extractions) OR EXISTS(SELECT 1 FROM financial_review_queue) THEN RAISE EXCEPTION 'cross-owner read leak'; END IF;
 RAISE NOTICE 'PASS owner readback and cross-owner RLS refusal';
END $$;
ROLLBACK;
