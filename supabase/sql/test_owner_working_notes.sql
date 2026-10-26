-- Disposable synthetic contract for owner_working_notes; no production data.
\set ON_ERROR_STOP on
\ir test_accounting_delegation.sql
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
-- test_accounting_delegation.sql leaves owner 1111, reviewer 2222 (confirmed), stranger 3333 and an inactive grant.
\ir ../migrations/20261028200000_owner_working_notes_reader.sql
BEGIN;
-- The owner grants the reviewer read access to the book.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','review');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
-- One workbook: a build table naming vehicle V in its title, a rent table with month rows naming org O on two rows and
-- related party R in its title, and a table whose only vehicle mention is ambiguous between V and W.
DO $$ DECLARE
 o uuid:='11111111-1111-4111-8111-111111111111';
 v text:='aaaaaaaa-0000-4000-8000-00000000000a'; w text:='aaaaaaaa-0000-4000-8000-00000000000b';
 org text:='bbbbbbbb-0000-4000-8000-00000000000c'; rel text:='cccccccc-0000-4000-8000-00000000000d';
 orig jsonb:=jsonb_build_object('sha256',repeat('7',64),'storage_path',o||'/financial/'||repeat('7',64)||'.numbers','byte_size',100);
 src jsonb:=jsonb_build_object('trust_tier','owner_working_notes_contextual','not_books',true,
   'artifact',jsonb_build_object('form','numbers','filename','synthetic.numbers','location','notes/synthetic.numbers'),
   'period',jsonb_build_object('from','2024-01-01','to','2024-12-31','basis','title','file_modified_at','2024-12-31T00:00:00+00:00'));
 t1 jsonb:=jsonb_build_object('trust_tier','owner_working_notes_contextual','sheet','Build','table','Synthetic truck budget',
   'header',jsonb_build_array('part','cost'),'rows_total',3,'period',jsonb_build_object('from','2024-02-01','to','2024-03-31','basis','title'),
   'keys',jsonb_build_object('vehicles',jsonb_build_array(jsonb_build_object('vehicle_id',v,'label','1970 Synthetic Truck','match','ymm_unique','scope','table')),
     'organizations','[]'::jsonb,'related_parties','[]'::jsonb,'deals','[]'::jsonb,'people','[]'::jsonb),
   'rows',jsonb_build_array(jsonb_build_object('r',2,'d',null,'t','part=paint; cost=100','a','100'),
                            jsonb_build_object('r',3,'d',null,'t','part=tires; cost=50','a','50')),
   'continued_in',jsonb_build_array('working_notes_table_1_rows_1'));
 t1c jsonb:=jsonb_build_object('trust_tier','owner_working_notes_contextual','table_index',1,
   'rows',jsonb_build_array(jsonb_build_object('r',4,'d',null,'t','part=wheels; cost=25','a','25')));
 t2 jsonb:=jsonb_build_object('trust_tier','owner_working_notes_contextual','sheet','Rent','table','Synthetic rent',
   'header',jsonb_build_array('month','paid'),'rows_total',3,'period',jsonb_build_object('from','2024-01-01','to','2024-03-01','basis','cell_dates'),
   'keys',jsonb_build_object('vehicles','[]'::jsonb,'organizations',jsonb_build_array(jsonb_build_object('organization_id',org,'name','Synthetic Org')),
     'related_parties',jsonb_build_array(jsonb_build_object('entity_id',rel,'name','Synthetic related','pattern','SYN')),'deals','[]'::jsonb,'people','[]'::jsonb),
   'rows',jsonb_build_array(jsonb_build_object('r',2,'d','2024-01-01','t','month=January; paid=10','a','10','o',jsonb_build_array(0)),
                            jsonb_build_object('r',3,'d','2024-02-01','t','month=February; paid=10','a','10'),
                            jsonb_build_object('r',4,'d','2024-03-01','t','month=March; paid=10','a','10','o',jsonb_build_array(0))));
 t3 jsonb:=jsonb_build_object('trust_tier','owner_working_notes_contextual','sheet','List','table','Synthetic list',
   'header','[]'::jsonb,'rows_total',2,'period',jsonb_build_object('from','2025-06-01','to','2025-06-30','basis','title'),
   'keys',jsonb_build_object('vehicles',jsonb_build_array(jsonb_build_object('vehicle_id',null,'match','ymm_ambiguous','text','70 truck',
       'candidates',jsonb_build_array(jsonb_build_object('vehicle_id',v),jsonb_build_object('vehicle_id',w))),
       jsonb_build_object('vehicle_id',w,'label','1971 Synthetic Truck','match','ymm_unique','scope','rows')),
     'organizations','[]'::jsonb,'related_parties','[]'::jsonb,'deals','[]'::jsonb,'people','[]'::jsonb),
   'rows',jsonb_build_array(jsonb_build_object('r',2,'d',null,'t','70 truck','a',null,'v',jsonb_build_array(0)),
                            jsonb_build_object('r',3,'d',null,'t','71 truck','a',null,'v',jsonb_build_array(1))));
 cell jsonb; r1 jsonb; r2 jsonb;
BEGIN
 r1:=ingest_financial_evidence(o,orig,jsonb_build_object('idempotency_key','working-notes-1','method','owner-working-notes','version','numbers-context-v1',
  'fields',jsonb_build_array(
    jsonb_build_object('field_key','working_notes_source','value_raw','synthetic','value_normalized',src,'evidence',jsonb_build_object('stage','owner_working_notes')),
    jsonb_build_object('field_key','working_notes_table_1','value_raw','synthetic','value_normalized',t1,'evidence',jsonb_build_object('stage','owner_working_notes')),
    jsonb_build_object('field_key','working_notes_table_1_rows_1','value_raw','synthetic','value_normalized',t1c,'evidence',jsonb_build_object('stage','owner_working_notes')),
    jsonb_build_object('field_key','working_notes_table_2','value_raw','synthetic','value_normalized',t2,'evidence',jsonb_build_object('stage','owner_working_notes')),
    jsonb_build_object('field_key','working_notes_table_3','value_raw','synthetic','value_normalized',t3,'evidence',jsonb_build_object('stage','owner_working_notes')))));
 PERFORM set_config('nwn.doc', r1->>'document_id', true);
 PERFORM set_config('nwn.run1', r1->>'extraction_run_id', true);
 -- Never books: no lines and no accounting records exist for the notes document.
 IF EXISTS (SELECT 1 FROM financial_document_lines WHERE document_id=(r1->>'document_id')::uuid) THEN RAISE EXCEPTION 'notes produced book lines'; END IF;
END $$;

-- The owner reads by vehicle, organization, related party and period.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
 o uuid:='11111111-1111-4111-8111-111111111111'; v uuid:='aaaaaaaa-0000-4000-8000-00000000000a'; w uuid:='aaaaaaaa-0000-4000-8000-00000000000b';
 org uuid:='bbbbbbbb-0000-4000-8000-00000000000c'; rel uuid:='cccccccc-0000-4000-8000-00000000000d'; j jsonb;
BEGIN
 j:=owner_working_notes(o);
 IF j->>'trust_tier'<>'owner_working_notes_contextual' OR (j->>'tables_matched')::int<>3 THEN RAISE EXCEPTION 'index read wrong: %', j; END IF;
 IF j::text ~ '"(sum|total_amount)"' THEN RAISE EXCEPTION 'reader totalled amounts'; END IF;
 -- Vehicle named in a title: whole table, continuation rows included, in sheet order. The ambiguous mention comes last.
 j:=owner_working_notes(o, v);
 IF (j->>'tables_matched')::int<>2 OR j->'tables'->0->>'vehicle_match'<>'table' OR j->'tables'->1->>'vehicle_match'<>'candidate' THEN RAISE EXCEPTION 'vehicle tables wrong: %', j; END IF;
 IF jsonb_array_length(j->'tables'->0->'rows')<>3 OR j->'tables'->0->'rows'->2->>'r'<>'4' OR j->'tables'->0->>'workbook'<>'synthetic.numbers' THEN RAISE EXCEPTION 'continuation rows lost: %', j->'tables'->0; END IF;
 IF jsonb_array_length(j->'tables'->1->'rows')<>1 OR j->'tables'->1->'rows'->0->>'t'<>'70 truck' THEN RAISE EXCEPTION 'candidate rows wrong: %', j->'tables'->1; END IF;
 -- Vehicle named on one row only: that row only.
 j:=owner_working_notes(o, w);
 IF (j->>'tables_matched')::int<>1 OR j->'tables'->0->>'vehicle_match'<>'rows' OR jsonb_array_length(j->'tables'->0->'rows')<>2 THEN RAISE EXCEPTION 'row vehicle wrong: %', j; END IF;
 -- Organization: the rows that name it. Related party in the title: the whole table.
 j:=owner_working_notes(o, NULL, org);
 IF (j->>'tables_matched')::int<>1 OR jsonb_array_length(j->'tables'->0->'rows')<>2 OR j->'tables'->0->>'organization_match'<>'organization' THEN RAISE EXCEPTION 'org rows wrong: %', j; END IF;
 j:=owner_working_notes(o, NULL, rel);
 IF jsonb_array_length(j->'tables'->0->'rows')<>3 OR j->'tables'->0->>'organization_match'<>'related_party' THEN RAISE EXCEPTION 'related party wrong: %', j; END IF;
 -- Period: overlapping tables only; dated rows outside the window drop.
 j:=owner_working_notes(o, NULL, NULL, '2024-02-15', '2024-02-28');
 IF (j->>'tables_matched')::int<>2 THEN RAISE EXCEPTION 'period overlap wrong: %', j; END IF;
 IF (SELECT jsonb_array_length(x->'rows') FROM jsonb_array_elements(j->'tables') x WHERE x->>'table'='Synthetic rent')<>0 THEN RAISE EXCEPTION 'out-of-window dated rows kept'; END IF;
 IF (owner_working_notes(o, NULL, NULL, '2026-01-01', NULL)->>'tables_matched')::int<>0 THEN RAISE EXCEPTION 'future window matched'; END IF;
 -- Bounds.
 j:=owner_working_notes(o, NULL, NULL, NULL, NULL, 1, 1);
 IF jsonb_array_length(j->'tables')<>1 OR (j->>'tables_matched')::int<>3 OR jsonb_array_length(j->'tables'->0->'rows')>1 THEN RAISE EXCEPTION 'bounds ignored: %', j; END IF;
 IF jsonb_array_length(owner_working_notes(o, NULL, NULL, NULL, NULL, 999, 999)->'tables')<>3 THEN RAISE EXCEPTION 'clamped read lost tables'; END IF;
END $$;
RESET ROLE;

-- The delegate reads the book; a stranger gets nothing; anon cannot execute.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (owner_working_notes('11111111-1111-4111-8111-111111111111')->>'tables_matched')::int<>3 THEN RAISE EXCEPTION 'delegate cannot read notes'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (owner_working_notes('11111111-1111-4111-8111-111111111111')->>'tables_matched')::int<>0 THEN RAISE EXCEPTION 'stranger read private notes'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.owner_working_notes(uuid,uuid,uuid,date,date,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'anon can execute'; END IF;
END $$;

-- A superseding run replaces the cells: the old table 3 disappears when the correction drops its vehicle key.
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE
 o uuid:='11111111-1111-4111-8111-111111111111'; w uuid:='aaaaaaaa-0000-4000-8000-00000000000b';
 orig jsonb:=jsonb_build_object('sha256',repeat('7',64),'storage_path',o||'/financial/'||repeat('7',64)||'.numbers','byte_size',100);
 prior jsonb; f jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('field_key',field_key,'value_raw',value_raw,
   'value_normalized',CASE WHEN field_key='working_notes_table_3' THEN jsonb_set(value_normalized->'value','{keys,vehicles}','[]') ELSE value_normalized->'value' END,
   'evidence',value_normalized->'evidence')) INTO f
 FROM financial_document_extractions WHERE extraction_run_id=current_setting('nwn.run1')::uuid;
 PERFORM ingest_financial_evidence(o,orig,jsonb_build_object('idempotency_key','working-notes-2','method','owner-working-notes','version','numbers-context-v1',
   'supersedes_run_id',current_setting('nwn.run1'),'fields',f));
 IF (owner_working_notes(o, w)->>'tables_matched')::int<>0 THEN RAISE EXCEPTION 'superseded keys still read'; END IF;
 IF (owner_working_notes(o)->>'tables_matched')::int<>3 THEN RAISE EXCEPTION 'current run lost tables'; END IF;
END $$;
ROLLBACK;
\echo 'owner_working_notes contract passed'
