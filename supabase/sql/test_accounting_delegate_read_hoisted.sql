\set ON_ERROR_STOP on
\ir test_accounting_delegation.sql
\ir ../migrations/20261023220000_accounting_delegate_read_hoisted.sql
-- test_accounting_delegation.sql leaves its users and a revoked grant behind; reuse them. The fixture schema grants
-- authenticated nothing on the line, cell and concern tables (production does); grant the table reads so the row
-- policies are what decide.
BEGIN;
GRANT SELECT ON financial_document_lines, financial_document_extractions, financial_review_queue TO authenticated;
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY; -- enabled in production; the fixture table is bare
-- The owner grants review again; the book gets a second document with a field, a line and a concern.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','review');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE
 owner uuid:='11111111-1111-4111-8111-111111111111';
 original jsonb:=jsonb_build_object('sha256',repeat('d',64),'storage_path',owner||'/second.pdf','byte_size',100);
 line jsonb:=jsonb_build_object('source_line_key',repeat('b',64),'source_row',2,'source_file_sha256',repeat('c',64),'source_document_sha256',repeat('d',64),'line_number',1,'description_raw','Synthetic part','sku_raw',NULL,'quantity',NULL,'unit_price',NULL,'amount','-12.50','currency',NULL,'raw_line_sha256',repeat('e',64),'evidence_stage','attributed_retained_parse','geometry',NULL,'issues',jsonb_build_array('refund_sign_requires_review'));
 revision jsonb:='{"idempotency_key":"hoisted","method":"synthetic","version":"1","fields":[{"field_key":"purpose","value_raw":"unknown","evidence":{"quote":"source"}}],"concerns":[{"concern_type":"montant_non_corrobore","detail":"synthetic","resolver":"owner"}]}';
BEGIN
 PERFORM ingest_financial_evidence(owner,original,revision||jsonb_build_object('lines',jsonb_build_array(line)));
END $$;
CREATE TEMP TABLE expected AS SELECT
 (SELECT count(*) FROM financial_documents WHERE owner_id='11111111-1111-4111-8111-111111111111') AS docs,
 (SELECT count(*) FROM financial_document_lines WHERE owner_id='11111111-1111-4111-8111-111111111111') AS lines,
 (SELECT count(*) FROM financial_document_extractions WHERE owner_id='11111111-1111-4111-8111-111111111111') AS cells,
 (SELECT count(*) FROM financial_review_queue WHERE owner_id='11111111-1111-4111-8111-111111111111') AS concerns;
GRANT SELECT ON expected TO authenticated;
DO $$ DECLARE e record; BEGIN SELECT * INTO e FROM expected; IF e.docs<1 OR e.lines<1 OR e.cells<1 OR e.concerns<1 THEN RAISE EXCEPTION 'fixture incomplete'; END IF; END $$;
-- The policies now consult the hoisted owner set, not the per-row function.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN ('financial_documents_delegate_read','financial_lines_delegate_read','financial_extractions_delegate_read','financial_concerns_delegate_read') AND qual LIKE '%accounting_readable_owners%')<>4 THEN RAISE EXCEPTION 'delegate policies not hoisted'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%delegate_read' AND qual LIKE '%can_read_accounting_owner%')<>0 THEN RAISE EXCEPTION 'per-row policy function still in use'; END IF;
END $$;
-- The granted reviewer reads the whole book through every table; the other account reads nothing; anon reads nothing.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT array_agg(o) FROM accounting_readable_owners() o)<>ARRAY['11111111-1111-4111-8111-111111111111'::uuid] THEN RAISE EXCEPTION 'readable owners wrong for the reviewer'; END IF;
 IF (SELECT count(*) FROM financial_documents)<>(SELECT docs FROM expected) OR (SELECT count(*) FROM financial_document_lines)<>(SELECT lines FROM expected) OR (SELECT count(*) FROM financial_document_extractions)<>(SELECT cells FROM expected) OR (SELECT count(*) FROM financial_review_queue)<>(SELECT concerns FROM expected) THEN RAISE EXCEPTION 'reviewer does not read the whole shared book'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM accounting_readable_owners()) THEN RAISE EXCEPTION 'ungranted account lists an owner'; END IF;
 IF EXISTS(SELECT 1 FROM financial_documents) THEN RAISE EXCEPTION 'ungranted account read documents'; END IF;
 IF EXISTS(SELECT 1 FROM financial_document_lines) THEN RAISE EXCEPTION 'ungranted account read lines (rls=%)', (SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_document_lines'::regclass); END IF;
 IF EXISTS(SELECT 1 FROM financial_document_extractions) THEN RAISE EXCEPTION 'ungranted account read cells'; END IF;
 IF EXISTS(SELECT 1 FROM financial_review_queue) THEN RAISE EXCEPTION 'ungranted account read concerns'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','anon',true),set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM accounting_readable_owners()) THEN RAISE EXCEPTION 'a non-authenticated claim lists an owner'; END IF;
 IF EXISTS(SELECT 1 FROM financial_documents) THEN RAISE EXCEPTION 'a non-authenticated claim read the book'; END IF;
END $$;
RESET ROLE;
-- Revocation, a banned reviewer, an unconfirmed reviewer and a deleted owner each close the read on the next statement.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
UPDATE accounting_access_grants SET active=false;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_documents) THEN RAISE EXCEPTION 'revoked reviewer still reads'; END IF; END $$;
RESET ROLE;
UPDATE accounting_access_grants SET active=true;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_document_lines) THEN RAISE EXCEPTION 'banned reviewer still reads'; END IF; END $$;
RESET ROLE;
UPDATE auth.users SET banned_until=NULL, email_confirmed_at=NULL WHERE id='22222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_review_queue) THEN RAISE EXCEPTION 'unconfirmed reviewer still reads'; END IF; END $$;
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id='22222222-2222-4222-8222-222222222222';
UPDATE auth.users SET deleted_at=now() WHERE id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM financial_document_extractions) THEN RAISE EXCEPTION 'deleted owner still readable'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS hoisted delegate read: same visibility as the per-row function, one owner set per statement'; END $$;
ROLLBACK;
