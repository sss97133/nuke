\set ON_ERROR_STOP on
\ir test_accounting_delegation.sql
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
-- test_accounting_delegation.sql leaves owner 1111 and reviewer 2222 (confirmed) and an inactive grant behind. The vehicle
-- access tables are bare here; production has the full ones.
CREATE TABLE IF NOT EXISTS public.vehicles(id uuid PRIMARY KEY, owner_id uuid, user_id uuid, uploaded_by uuid, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE IF NOT EXISTS public.vehicle_ownerships(vehicle_id uuid, owner_profile_id uuid, is_current boolean);
CREATE TABLE IF NOT EXISTS public.ownership_verifications(vehicle_id uuid, user_id uuid, status text);
CREATE TABLE IF NOT EXISTS public.vehicle_contributors(vehicle_id uuid, user_id uuid);
\ir ../migrations/20261025141001_accounting_vehicle_costs.sql
BEGIN;
CREATE FUNCTION pg_temp.rec(k text, amount text, category text, local_id text, day text) RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('record_kind','retained_ledger_decision','source_key',k,'source_sha256',repeat('a',64),'source_row',1,
  'local_id',local_id,'year','2024','date',day,'account','Apple Card','currency','USD','currency_basis','Synthetic USD','amount',amount,
  'section','Expense','category',category,'description','Synthetic '||local_id,'decision','synthetic','status','synthetic',
  'source_reference','synthetic','bank_links','[]'::jsonb,'recognition_status','retained_decision','payment_status','unresolved',
  'vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated') $f$;
CREATE FUNCTION pg_temp.use_cell(k text, use_type text, vehicle uuid, amount text, book text, basis text) RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('field_key','expense_use_'||left(k,24),'value_raw',use_type||'; '||basis,'value_type','text',
  'value_normalized',jsonb_build_object('source_key',k,'use_type',use_type,'vehicle_id',vehicle,'allocated_amount',amount,
    'unallocated_amount','0','book_amount',book,'currency','USD','basis',basis,'destination_label',use_type,
    'status','reviewer_assigned_use','new_expense',false,'payment_match_changed',false),
  'evidence',jsonb_build_object('stage','expense_use_reconciliation','source_key',k,'basis',basis)) $f$;
-- Vehicles: V and W owned by the book owner, D owned by him but deleted. 3333 contributes to V.
INSERT INTO vehicles(id, owner_id, deleted_at) VALUES
 ('aaaaaaaa-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111',NULL),
 ('aaaaaaaa-0000-4000-8000-00000000000b','11111111-1111-4111-8111-111111111111',NULL),
 ('aaaaaaaa-0000-4000-8000-00000000000d','11111111-1111-4111-8111-111111111111',now());
INSERT INTO vehicle_contributors(vehicle_id, user_id) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a','33333333-3333-4333-8333-333333333333');
-- The owner grants correction access to the reviewer.
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','correct');
RESET ROLE;
-- Revision 1 (owner): five booked expenses; ka, kb, kc on V, kd on the deleted D, ke on W.
-- Revision 2 (reviewer, delegated): kb moves to the shop, kc is re-booked at 95.00 while its use still says 80.00,
-- ke moves to V; ka and kd are carried unchanged.
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE
 o uuid:='11111111-1111-4111-8111-111111111111'; rv uuid:='22222222-2222-4222-8222-222222222222';
 v uuid:='aaaaaaaa-0000-4000-8000-00000000000a'; w uuid:='aaaaaaaa-0000-4000-8000-00000000000b'; dv uuid:='aaaaaaaa-0000-4000-8000-00000000000d';
 ka text:=repeat('1',64); kb text:=repeat('2',64); kc text:=repeat('3',64); kd text:=repeat('4',64); ke text:=repeat('5',64); kf text:=repeat('6',64);
 orig jsonb:=jsonb_build_object('sha256',repeat('9',64),'storage_path',o||'/vehicle-costs.csv','byte_size',100);
 batch jsonb:=jsonb_build_object('field_key','batch','value_raw','synthetic','evidence',jsonb_build_object('stage','retained'));
 r1 jsonb; r2 jsonb; a1 jsonb; a2 jsonb; auth jsonb;
BEGIN
 r1:=jsonb_build_object('idempotency_key','vehicle-costs-1','method','synthetic-owner-assign','version','1',
  'fields',jsonb_build_array(batch,
    pg_temp.use_cell(ka,'vehicle',v,'40.00','40.00','Receipt names this truck'),
    pg_temp.use_cell(kb,'vehicle',v,'250.00','250.00','Painter invoice names this truck'),
    pg_temp.use_cell(kc,'vehicle',v,'80.00','80.00','Part fits only this engine'),
    pg_temp.use_cell(kd,'vehicle',dv,'10.00','10.00','Old profile'),
    pg_temp.use_cell(ke,'vehicle',w,'60.00','60.00','First guess'),
    pg_temp.use_cell(kf,'vehicle',v,NULL,'120.00','Packing slip names this truck; shared items still to split')),
  'accounting_records',jsonb_build_array(
    pg_temp.rec(ka,'40.00','Car restoration — parts & materials','L-1','2024-06-01'),
    pg_temp.rec(kb,'250.00','Car restoration — labor (contractors)','L-2','2024-06-02'),
    pg_temp.rec(kc,'80.00','Car restoration — parts & materials','L-3','2024-06-03'),
    pg_temp.rec(kd,'10.00','Car restoration — parts & materials','L-4','2024-06-04'),
    pg_temp.rec(ke,'60.00','Car restoration — parts & materials','L-5','2024-06-05'),
    pg_temp.rec(kf,'120.00','Car restoration — parts & materials','L-6','2024-06-06')));
 a1:=ingest_financial_evidence(o,orig,r1);
 auth:=authorize_financial_access(rv,o,NULL,'correct');
 r2:=jsonb_build_object('idempotency_key','vehicle-costs-2','method','synthetic-reviewer-assign','version','1',
  'supersedes_run_id',a1->>'extraction_run_id',
  'fields',jsonb_build_array(batch,
    pg_temp.use_cell(ka,'vehicle',v,'40.00','40.00','Receipt names this truck'),
    pg_temp.use_cell(kb,'shop',NULL,'250.00','250.00','Shop-wide painting supplies'),
    pg_temp.use_cell(kc,'vehicle',v,'80.00','80.00','Part fits only this engine'),
    pg_temp.use_cell(kd,'vehicle',dv,'10.00','10.00','Old profile'),
    pg_temp.use_cell(ke,'vehicle',v,'60.00','60.00','Work order lists this part'),
    pg_temp.use_cell(kf,'vehicle',v,NULL,'120.00','Packing slip names this truck; shared items still to split')),
  'accounting_records',jsonb_build_array(
    pg_temp.rec(ka,'40.00','Car restoration — parts & materials','L-1','2024-06-01'),
    pg_temp.rec(kb,'250.00','Car restoration — labor (contractors)','L-2','2024-06-02'),
    pg_temp.rec(kc,'95.00','Car restoration — parts & materials','L-3','2024-06-03'),
    pg_temp.rec(kd,'10.00','Car restoration — parts & materials','L-4','2024-06-04'),
    pg_temp.rec(ke,'60.00','Car restoration — parts & materials','L-5','2024-06-05'),
    pg_temp.rec(kf,'120.00','Car restoration — parts & materials','L-6','2024-06-06')));
 a2:=ingest_financial_evidence(o,orig,r2,jsonb_build_object('kind','user','actor_user_id',rv,'owner_user_id',o,'grant_id',auth->>'grant_id'));
 IF a2->>'extraction_run_id' IS NULL THEN RAISE EXCEPTION 'reviewer revision not admitted: %', a2; END IF;
END $$;
CREATE TEMP TABLE seen(who text, ledger text, assigned_by uuid, allocated numeric, basis text, use_id uuid);
GRANT ALL ON seen TO authenticated;
-- The owner on V: L-1 (his own assignment, carried by the reviewer's revision) and L-5 (moved by the reviewer).
-- Left out: L-2 (moved to the shop), L-3 (stale: re-booked at 95.00 after an 80.00 assignment).
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
INSERT INTO seen SELECT 'owner-v', ledger_id, assigned_by, allocated_amount, basis, use_id FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a');
INSERT INTO seen SELECT 'owner-w', ledger_id, assigned_by, allocated_amount, basis, use_id FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000b');
INSERT INTO seen SELECT 'owner-d', ledger_id, assigned_by, allocated_amount, basis, use_id FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000d');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT array_agg(ledger ORDER BY ledger) FROM seen WHERE who='owner-v') IS DISTINCT FROM ARRAY['L-1','L-5','L-6'] THEN
  RAISE EXCEPTION 'owner on V must see exactly L-1, L-5 and L-6: %', (SELECT array_agg(ledger) FROM seen WHERE who='owner-v'); END IF;
 -- An assignment whose amount is still to be split is listed with no amount, never summed and never hidden.
 IF (SELECT allocated FROM seen WHERE who='owner-v' AND ledger='L-6') IS NOT NULL THEN RAISE EXCEPTION 'L-6 has no allocated amount yet'; END IF;
 IF (SELECT assigned_by FROM seen WHERE who='owner-v' AND ledger='L-1') IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'L-1 was assigned by the owner, not by the revision that carried it'; END IF;
 IF (SELECT assigned_by FROM seen WHERE who='owner-v' AND ledger='L-5') IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid THEN
  RAISE EXCEPTION 'L-5 was assigned by the reviewer'; END IF;
 IF (SELECT allocated FROM seen WHERE who='owner-v' AND ledger='L-5') <> 60.00 OR (SELECT basis FROM seen WHERE who='owner-v' AND ledger='L-5') <> 'Work order lists this part' THEN
  RAISE EXCEPTION 'amount and basis come from the current cell'; END IF;
 IF EXISTS (SELECT 1 FROM financial_document_extractions e JOIN seen s ON s.use_id = e.id WHERE e.is_superseded) THEN RAISE EXCEPTION 'a superseded cell was returned'; END IF;
 IF EXISTS (SELECT 1 FROM seen WHERE who IN ('owner-w','owner-d')) THEN RAISE EXCEPTION 'a moved-away or deleted-vehicle use was returned'; END IF;
END $$;
-- The reviewer has the book but no vehicle access: nothing. As a contributor on V: all three rows. After revocation: nothing.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'book grant alone gave vehicle costs'; END IF; END $$;
RESET ROLE;
INSERT INTO vehicle_contributors(vehicle_id, user_id) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a','22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) <> 3 THEN RAISE EXCEPTION 'reviewer with book and vehicle access sees the three rows'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','revoke');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'revoked grant still read costs'; END IF; END $$;
RESET ROLE;
-- A contributor with no accounting grant sees nothing; neither does a request that is not signed in.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'contributor without a grant read book costs'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','anon',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'a request that is not signed in read book costs'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a'); RAISE EXCEPTION 'anon executed the reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.accounting_vehicle_costs(uuid)','EXECUTE') OR NOT has_function_privilege('authenticated','public.accounting_vehicle_costs(uuid)','EXECUTE') THEN RAISE EXCEPTION 'grants wrong'; END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE proname='accounting_vehicle_costs') THEN RAISE EXCEPTION 'reader must check access itself (security definer)'; END IF;
 RAISE NOTICE 'PASS accounting_vehicle_costs: book AND vehicle access, current non-stale uses only, first assigner, anon refused';
END $$;
ROLLBACK;
