\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
CREATE TEMP TABLE workpaper_properties AS
SELECT proowner,proacl,prosecdef,provolatile,proconfig FROM pg_proc
WHERE oid='public.read_financial_tax_workpapers(uuid,uuid,integer)'::regprocedure;
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('public.read_financial_tax_workpapers(uuid,uuid,integer)'::regprocedure),
  'CREATE OR REPLACE FUNCTION public.read_financial_tax_workpapers(',
  'CREATE OR REPLACE FUNCTION pg_temp.workpaper_preimage(');
END $$;
\ir ../migrations/20261025091500_accounting_workpapers_bounded_reads.sql
\ir ../migrations/20261025091500_accounting_workpapers_bounded_reads.sql
SELECT md5(pg_get_functiondef('public.read_financial_tax_workpapers(uuid,uuid,integer)'::regprocedure)) AS candidate_hash;
DO $$ BEGIN
 IF EXISTS(SELECT * FROM workpaper_properties EXCEPT SELECT proowner,proacl,prosecdef,provolatile,proconfig FROM pg_proc
  WHERE oid='public.read_financial_tax_workpapers(uuid,uuid,integer)'::regprocedure)
 THEN RAISE EXCEPTION 'workpaper owner, grants, definer, volatility or search path changed'; END IF;
END $$;
CREATE FUNCTION pg_temp.normalized_workpaper(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_set(value,'{controls}',coalesce((SELECT jsonb_agg(item ORDER BY item) FROM jsonb_array_elements(value->'controls') item),'[]'::jsonb));
$$;
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO financial_documents(id,owner_id,content_sha256,source_filename,attributes) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111',repeat('a',64),'synthetic.csv','{"intake_mode":"financial_evidence_v1"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','22222222-2222-4222-8222-222222222222',repeat('b',64),'synthetic-other.csv','{"intake_mode":"financial_evidence_v1"}');
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw,is_superseded)
SELECT d.owner_id,d.id,r::uuid,'synthetic-'||n,'synthetic',n=3 OR r LIKE '%bbbbbbb0'
FROM financial_documents d CROSS JOIN (VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0')) runs(r)
CROSS JOIN generate_series(1,3) n;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT d.owner_id,d.id,n,jsonb_build_object('intake_mode','financial_evidence_v1',
 'extraction_run_id',CASE n WHEN 5 THEN 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0' WHEN 6 THEN 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBB1' WHEN 7 THEN 'malformed-run' ELSE 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' END,
 'accounting_record',jsonb_build_object('record_kind',CASE WHEN n=4 THEN 'retained_bank_movement' ELSE 'retained_ledger_decision' END,
 'local_id',CASE WHEN n=3 THEN 'duplicate' ELSE n::text END,'source_key',CASE WHEN n=3 THEN NULL ELSE n::text END,
 'year','2025','account',CASE WHEN n=2 THEN NULL ELSE 'Synthetic account' END,
 'currency',CASE n WHEN 1 THEN 'USD' WHEN 2 THEN 'EUR' ELSE NULL END,
 'section',CASE WHEN n=4 THEN NULL ELSE 'Expense' END,'amount',CASE n WHEN 1 THEN '12.345678' WHEN 2 THEN '-2.50' WHEN 3 THEN NULL ELSE '5.00' END))
FROM financial_documents d CROSS JOIN generate_series(1,7) n;
-- Duplicate retained identities/source keys and multiple current cells retain
-- their original meaning; DISTINCT runs must not duplicate each retained line.
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT owner_id,document_id,8,attributes FROM financial_document_lines WHERE line_number=3;
DO $$ DECLARE u uuid; cursor_id uuid; old_result jsonb; new_result jsonb;
BEGIN
 FOREACH u IN ARRAY ARRAY['11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid] LOOP
  SELECT id INTO cursor_id FROM financial_document_lines WHERE owner_id=u ORDER BY id LIMIT 1;
  old_result:=pg_temp.normalized_workpaper(pg_temp.workpaper_preimage(u,NULL,2));
  new_result:=pg_temp.normalized_workpaper(read_financial_tax_workpapers(u,NULL,2));
  IF old_result IS DISTINCT FROM new_result THEN RAISE EXCEPTION 'first page or full control payload changed'; END IF;
  IF new_result->>'total_rows'<>'5' OR new_result->>'controls_valid'<>'false' OR new_result->>'tax_ready'<>'false'
  THEN RAISE EXCEPTION 'current-run, duplicate-control or tax boundary changed'; END IF;
  IF pg_temp.normalized_workpaper(pg_temp.workpaper_preimage(u,cursor_id,500)) IS DISTINCT FROM
     pg_temp.normalized_workpaper(read_financial_tax_workpapers(u,cursor_id,500))
  THEN RAISE EXCEPTION 'cursor page or unknown-currency payload changed'; END IF;
 END LOOP;
 BEGIN PERFORM read_financial_tax_workpapers(NULL,NULL,1); RAISE EXCEPTION 'null owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM read_financial_tax_workpapers('33333333-3333-4333-8333-333333333333',NULL,1); RAISE EXCEPTION 'unknown owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM read_financial_tax_workpapers(u,NULL,501); RAISE EXCEPTION 'bad limit accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='bad limit accepted' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS unchanged complete workpaper payload, pagination, duplicates, unknown money and current-run text semantics';
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF read_financial_tax_workpapers('11111111-1111-4111-8111-111111111111',NULL,1)->>'total_rows'<>'5' THEN RAISE EXCEPTION 'service-role execution failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.read_financial_tax_workpapers('11111111-1111-4111-8111-111111111111',NULL,1); RAISE EXCEPTION 'authenticated bypassed service admission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.read_financial_tax_workpapers('11111111-1111-4111-8111-111111111111',NULL,1); RAISE EXCEPTION 'anon read workpapers'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

-- Same 70k-line / 67k-field retained-history geometry as the record-page contract.
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
CREATE TEMP TABLE records_scale_runs AS
SELECT d,r,md5('records-document-'||d)::uuid AS document_id,
       md5('records-run-'||d||'-'||r)::uuid AS run_id,
       r=5 AS current_run,13 AS line_count,13 AS field_count
FROM generate_series(1,1000) d CROSS JOIN generate_series(1,5) r
UNION ALL
SELECT 1001,r,md5('records-batch')::uuid,md5('records-batch-'||r)::uuid,r=2,2500,1000
FROM generate_series(1,2) r;
INSERT INTO financial_documents(id,owner_id,source_filename,attributes)
SELECT document_id,'33333333-3333-4333-8333-333333333333','synthetic-'||d||'.csv',
       '{"intake_mode":"financial_evidence_v1"}'::jsonb
FROM records_scale_runs GROUP BY document_id,d;
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw,is_superseded)
SELECT '33333333-3333-4333-8333-333333333333',document_id,run_id,'synthetic-'||n,'synthetic value',NOT current_run
FROM records_scale_runs CROSS JOIN LATERAL generate_series(1,field_count) n;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT '33333333-3333-4333-8333-333333333333',document_id,(r-1)*line_count+n,
       jsonb_build_object('intake_mode','financial_evidence_v1','extraction_run_id',run_id,'accounting_record',
         jsonb_build_object('record_kind','retained_ledger_decision','local_id',d||'-'||r||'-'||n,
           'year','2025','date','2025-01-01','currency','USD','section','Expense','amount','25.00'))
FROM records_scale_runs CROSS JOIN LATERAL generate_series(1,line_count) n;
-- Mirror production's existing access indexes; this migration adds none.
CREATE INDEX ON financial_documents(owner_id);
CREATE INDEX ON financial_document_extractions(owner_id);
CREATE INDEX ON financial_document_extractions(document_id);
CREATE INDEX ON financial_document_extractions(extraction_run_id);
CREATE INDEX ON financial_document_lines(owner_id);
CREATE INDEX ON financial_document_lines(document_id);
ANALYZE financial_documents;
ANALYZE financial_document_extractions;
ANALYZE financial_document_lines;

SET LOCAL ROLE service_role;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE result jsonb; BEGIN
 result:=read_financial_tax_workpapers('33333333-3333-4333-8333-333333333333',NULL,1);
 IF result->>'total_rows'<>'15500' OR jsonb_array_length(result->'records')<>1
    OR (SELECT sum((x->>'rows')::bigint) FROM jsonb_array_elements(result->'controls') x)<>15500
    OR (SELECT sum((x->>'retained_amount')::numeric) FROM jsonb_array_elements(result->'controls') x)<>387500
 THEN RAISE EXCEPTION 'scaled workpaper controls lost or multiplied records'; END IF;
 RAISE NOTICE 'PASS service-only scaled summary: full controls over 15,500 current records, bounded one-record page';
END $$;
RESET ROLE;
ROLLBACK;
