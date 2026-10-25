-- Disposable synthetic contract; no production data. Run: scripts/ci/run-db-contracts.sh test_accounting_expense_footprints.sql
\set ON_ERROR_STOP on
\ir test_accounting_delegation.sql
\ir ../migrations/20261023200300_financial_accounting_records_view.sql
\ir ../migrations/20261023201000_financial_accounting_records_view_grants.sql
\ir ../migrations/20261025083500_accounting_records_bounded_reads.sql
-- test_accounting_delegation.sql leaves owner 1111, reviewer 2222 and other 3333 behind. The trace tables are bare
-- here, with the production row policies that matter: own receipts, own photos, own sessions, own vehicles.
CREATE TABLE IF NOT EXISTS public.vehicles(id uuid PRIMARY KEY, owner_id uuid, user_id uuid, uploaded_by uuid, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor_name text, receipt_date date,
  transaction_date date, purchase_date date, total numeric, total_amount numeric, document_kind text, amount_check text,
  vehicle_id uuid, payment_method text, card_last4 text, file_name text, is_superseded boolean DEFAULT false, duplicate_of uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, taken_at timestamptz,
  fabrication_stage text, source text DEFAULT 'iphoto', is_external boolean, is_superseded boolean, is_duplicate boolean,
  duplicate_of uuid, is_document boolean);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, session_date date, work_type text);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_type text, event_date date, cost_amount numeric,
  source text, title text, service_provider_name text, metadata jsonb);
-- Live table (not created by a repo migration): the owner's own businesses.
CREATE TABLE IF NOT EXISTS public.financial_operator_entities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, entity_name text, name_patterns text[]);
ALTER TABLE financial_operator_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_entities ON financial_operator_entities FOR SELECT USING (auth.uid() = owner_id);
GRANT SELECT ON financial_operator_entities TO authenticated;
INSERT INTO financial_operator_entities(owner_id, entity_name, name_patterns) VALUES
 ('11111111-1111-4111-8111-111111111111','Owner Studio LLC',ARRAY['%owner studio%']);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY; ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY; ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_vehicles ON vehicles FOR SELECT USING (auth.uid() IN (owner_id, user_id, uploaded_by));
CREATE POLICY own_receipts ON receipts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY own_images ON vehicle_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY own_sessions ON work_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY public_timeline ON timeline_events FOR SELECT USING (true);
GRANT SELECT ON vehicles, receipts, vehicle_images, work_sessions, timeline_events TO authenticated;
-- Production grants table SELECT on the financial store to authenticated; its row policies do the scoping.
GRANT SELECT ON financial_documents, financial_document_lines, financial_document_extractions TO authenticated;
\ir ../migrations/20261028190000_accounting_expense_footprints.sql
BEGIN;
CREATE FUNCTION pg_temp.rec(k text, kind text, amount text, section text, category text, local_id text, day text, account text, descr text) RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('record_kind',kind,'source_key',k,'source_sha256',repeat('a',64),'source_row',1,
  'local_id',local_id,'year',left(day,4),'date',day,'account',account,'currency','USD','currency_basis','Synthetic USD','amount',amount,
  'section',section,'category',category,'description',descr,'decision','synthetic','status','synthetic',
  'source_reference','synthetic','bank_links','[]'::jsonb,
  'recognition_status',CASE WHEN kind='retained_bank_movement' THEN 'not_applicable' ELSE 'retained_decision' END,'payment_status','unresolved',
  'vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated') $f$;
CREATE FUNCTION pg_temp.use_cell(k text, use_type text, vehicle uuid, amount text) RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('field_key','expense_use_'||left(k,24),'value_raw',use_type||'; synthetic','value_type','text',
  'value_normalized',jsonb_build_object('source_key',k,'use_type',use_type,'vehicle_id',vehicle,'allocated_amount',amount,
    'unallocated_amount','0','book_amount',amount,'currency','USD','basis','synthetic','destination_label',use_type,
    'status','reviewer_assigned_use','new_expense',false,'payment_match_changed',false),
  'evidence',jsonb_build_object('stage','expense_use_reconciliation','source_key',k,'basis','synthetic')) $f$;
-- Vehicles: V and the five history vehicles H1..H5 are the owner's; P (presence only) too; Z belongs to 3333.
INSERT INTO vehicles(id, owner_id) VALUES
 ('bbbbbbbb-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-0000000000bb','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-0000000000ff','33333333-3333-4333-8333-333333333333');
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','review');
RESET ROLE;
-- The book (one owner revision):
--  L-1 Expense 45.10 (shop parts) 2024-03-02          twin of receipt R1
--  L-2 Expense 12.00 2024-04-10 names photo IMG_7002   cites receipt R2 by file stem although the totals differ
--  B-3 statement line, Owner, -61.25 2024-05-03        receipt R3 is a reclassification candidate
--  B-5 statement line on "Card 4321", July 2024        makes card 4321 a covered card that month (receipt R5)
--  L-6 Expense 20.00 2024-02-15 names order 115-5555555 cites the external order of that number
--  L-H1..L-H5 Expense 100..500 on H1..H5 (vehicle cells) cite the five history episodes: p25 200, median 300
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE
 o uuid:='11111111-1111-4111-8111-111111111111';
 orig jsonb:=jsonb_build_object('sha256',repeat('8',64),'storage_path',o||'/footprints.csv','byte_size',100);
 batch jsonb:=jsonb_build_object('field_key','batch','value_raw','synthetic','evidence',jsonb_build_object('stage','retained'));
 k1 text:=repeat('1',64); k2 text:=repeat('2',64); k3 text:=repeat('3',64); k5 text:=repeat('5',64); k6 text:=repeat('6',64);
 h text[]:=ARRAY[repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64)]; a jsonb;
BEGIN
 a:=ingest_financial_evidence(o,orig,jsonb_build_object('idempotency_key','footprints-1','method','synthetic-owner','version','1',
  'fields',jsonb_build_array(batch,
    pg_temp.use_cell(k1,'shop',NULL,'45.10'), pg_temp.use_cell(repeat('7',64),'shop',NULL,'441.83'), pg_temp.use_cell(k2,'shop',NULL,'12.00'), pg_temp.use_cell(k6,'shop',NULL,'20.00'),
    pg_temp.use_cell(h[1],'vehicle','bbbbbbbb-0000-4000-8000-000000000001','100.00'),
    pg_temp.use_cell(h[2],'vehicle','bbbbbbbb-0000-4000-8000-000000000002','200.00'),
    pg_temp.use_cell(h[3],'vehicle','bbbbbbbb-0000-4000-8000-000000000003','300.00'),
    pg_temp.use_cell(h[4],'vehicle','bbbbbbbb-0000-4000-8000-000000000004','400.00'),
    pg_temp.use_cell(h[5],'vehicle','bbbbbbbb-0000-4000-8000-000000000005','500.00')),
  'accounting_records',jsonb_build_array(
    pg_temp.rec(k1,'retained_ledger_decision','45.10','Expense','Car restoration — parts & materials','L-1','2024-03-02','Checking','Synthetic parts'),
    pg_temp.rec(k2,'retained_ledger_decision','12.00','Expense','Car restoration — parts & materials','L-2','2024-04-10','Checking','Hardware per photo IMG_7002'),
    pg_temp.rec(k3,'retained_bank_movement','-61.25','Owner','Personal','B-3','2024-05-03','Checking','Synthetic card purchase'),
    pg_temp.rec(k5,'retained_bank_movement','-10.00','Owner','Personal','B-5','2024-07-20','Card 4321','Synthetic coffee'),
    pg_temp.rec(k6,'retained_ledger_decision','20.00','Expense','Car restoration — parts & materials','L-6','2024-02-15','Checking','Online order 115-5555555'),
    pg_temp.rec(repeat('7',64),'retained_ledger_decision','441.83','Expense','Car restoration — parts & materials','L-7','2024-10-02','Checking','POS purchase WHEEL WORKS 702'),
    pg_temp.rec(h[1],'retained_ledger_decision','100.00','Expense','Car restoration — parts & materials','L-H1','2024-01-10','Checking','Synthetic'),
    pg_temp.rec(h[2],'retained_ledger_decision','200.00','Expense','Car restoration — parts & materials','L-H2','2024-02-10','Checking','Synthetic'),
    pg_temp.rec(h[3],'retained_ledger_decision','300.00','Expense','Car restoration — parts & materials','L-H3','2024-03-10','Checking','Synthetic'),
    pg_temp.rec(h[4],'retained_ledger_decision','400.00','Expense','Car restoration — parts & materials','L-H4','2024-04-10','Checking','Synthetic'),
    pg_temp.rec(h[5],'retained_ledger_decision','500.00','Expense','Car restoration — parts & materials','L-H5','2024-05-10','Checking','Synthetic'))));
 IF a->>'extraction_run_id' IS NULL THEN RAISE EXCEPTION 'synthetic book not admitted: %', a; END IF;
END $$;
INSERT INTO receipts(user_id, vendor_name, receipt_date, total, document_kind, amount_check, vehicle_id, payment_method, card_last4, file_name, is_superseded) VALUES
 ('11111111-1111-4111-8111-111111111111','Parts Store','2024-03-01',45.10,'parts_service','verified',NULL,'debit_card','9999','IMG_7001.json',false),   -- R1 cited by amount
 ('11111111-1111-4111-8111-111111111111','Hardware Co','2024-04-09',99.99,'parts_service','verified',NULL,NULL,NULL,'1760000000000_IMG_7002.jpeg',false), -- R2 cited by stem
 ('11111111-1111-4111-8111-111111111111','Paint Supply','2024-05-02',61.25,'parts_service','verified',NULL,'credit_card','1111','IMG_7003.json',false), -- R3 booked as Owner
 ('11111111-1111-4111-8111-111111111111','Speed Shop','2024-06-01',140.00,'parts_service','verified','bbbbbbbb-0000-4000-8000-00000000000a','cash',NULL,'IMG_7004.json',false), -- R4 cash gap
 ('11111111-1111-4111-8111-111111111111','Speed Shop','2024-07-05',80.00,'parts_service','plausible',NULL,'credit_card','4321','IMG_7005.json',false), -- R5 covered card
 ('11111111-1111-4111-8111-111111111111','AutoZone 5724','2024-08-01',33.33,'parts_service','plausible',NULL,NULL,NULL,'IMG_7006.json',false), -- R6/R7 one slip twice
 ('11111111-1111-4111-8111-111111111111','AUTOZONE','2024-08-02',33.33,'parts_service','verified',NULL,NULL,NULL,'IMG_7007.json',false),
 ('11111111-1111-4111-8111-111111111111','Restaurant','2024-08-03',500.00,'personal_purchase','verified',NULL,'cash',NULL,'IMG_7008.json',false), -- personal: not a trace
 ('11111111-1111-4111-8111-111111111111','Old Read','2024-08-04',800.00,'parts_service','verified',NULL,'cash',NULL,'IMG_7009.json',true),   -- superseded
 ('11111111-1111-4111-8111-111111111111','Parts Store','2024-08-05',-30.00,'parts_service','verified',NULL,'cash',NULL,'IMG_7010.json',false), -- refund
 ('11111111-1111-4111-8111-111111111111','Parts Store','2023-12-30',70.00,'parts_service','verified',NULL,'cash',NULL,'IMG_7011.json',false), -- other year
 ('33333333-3333-4333-8333-333333333333','Parts Store','2024-06-01',777.00,'parts_service','verified',NULL,'cash',NULL,'IMG_7012.json',false), -- another owner
 ('11111111-1111-4111-8111-111111111111','Tool Truck','2024-02-19',9000.00,'parts_service','verified',NULL,'financing',NULL,'IMG_7013.json',false), -- financed contract
 ('11111111-1111-4111-8111-111111111111','Wheel Works','2024-10-01',440.83,'parts_service','plausible',NULL,NULL,NULL,'IMG_7014.json',false), -- misread total of L-7
 ('11111111-1111-4111-8111-111111111111','Wheel Works','2024-10-20',300.00,'parts_service','verified',NULL,'cash',NULL,'IMG_7015.json',false), -- same vendor, total too far from L-7
 ('11111111-1111-4111-8111-111111111111','Parts Store','2024-03-01',54.10,'parts_service','plausible',NULL,NULL,NULL,'1760000000009_IMG_7001.jpeg',false), -- reread of R1's photo
 ('11111111-1111-4111-8111-111111111111','Bolt Bin','2024-11-05',25.00,'parts_service','plausible',NULL,'cash',NULL,'IMG_7017.json',false),  -- two readings of one photo,
 ('11111111-1111-4111-8111-111111111111','Bolt Bin','2024-11-05',52.00,'parts_service','verified',NULL,'cash',NULL,'1760000000010_IMG_7017.jpeg',false); -- neither booked
-- Photos: V shows primer on three days in September with no cell; H1..H5 each one assembly day inside their cells'
-- windows; P only presence (no stage, no session); Z is another owner's car in primer; a receipt photo on V is skipped.
INSERT INTO vehicle_images(vehicle_id, user_id, taken_at, fabrication_stage, source) VALUES
 ('bbbbbbbb-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','2024-09-01 18:00+00','primer','iphoto'),
 ('bbbbbbbb-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','2024-09-03 18:00+00','primer','iphoto'),
 ('bbbbbbbb-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','2024-09-05 18:00+00',NULL,'iphoto'),
 ('bbbbbbbb-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111','2024-12-20 18:00+00','primer','daily_receipt'),
 ('bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','2024-01-20 18:00+00','assembly','iphoto'),
 ('bbbbbbbb-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','2024-02-20 18:00+00','assembly','iphoto'),
 ('bbbbbbbb-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','2024-03-20 18:00+00','assembly','iphoto'),
 ('bbbbbbbb-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','2024-04-20 18:00+00','assembly','iphoto'),
 ('bbbbbbbb-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','2024-05-20 18:00+00','assembly','iphoto'),
 ('bbbbbbbb-0000-4000-8000-0000000000bb','11111111-1111-4111-8111-111111111111','2024-10-10 18:00+00',NULL,'iphoto'),
 ('bbbbbbbb-0000-4000-8000-0000000000ff','33333333-3333-4333-8333-333333333333','2024-09-01 18:00+00','primer','iphoto');
INSERT INTO timeline_events(vehicle_id, event_type, event_date, cost_amount, source, title) VALUES
 ('bbbbbbbb-0000-4000-8000-00000000000a','service','2024-11-15',350.00,'manual','Storage — 2024-10'),       -- claim gap
 ('bbbbbbbb-0000-4000-8000-00000000000a','service','2024-11-16',90.00,'receipt_extraction','From a receipt'), -- the receipt again
 ('bbbbbbbb-0000-4000-8000-00000000000a','service','2024-06-02',140.00,'manual','Speed shop parts'),        -- same item as R4
 ('bbbbbbbb-0000-4000-8000-00000000000a','auction_ended','2024-07-27',49999.00,'bat','Auction ended, high bid'); -- a bid, not a cost
INSERT INTO timeline_events(vehicle_id, event_type, event_date, cost_amount, source, title, service_provider_name, metadata) VALUES
 ('bbbbbbbb-0000-4000-8000-00000000000a','service','2024-12-01',2000.00,'manual','Upholstery','Trim Shop','{"billing_category":"interior_work"}'),  -- billing entry: payer open
 ('bbbbbbbb-0000-4000-8000-00000000000a','service','2024-12-02',350.00,'manual','Storage — 2024-11','Owner Studio','{"billing_category":"storage"}');  -- the owner's own business charging: income
CREATE TEMP TABLE got AS SELECT * FROM accounting_expense_footprints(NULL::uuid, 2024) LIMIT 0;
GRANT ALL ON got TO authenticated;
CREATE TEMP TABLE got_delegate (LIKE got); GRANT ALL ON got_delegate TO authenticated;
CREATE TEMP TABLE got_top (LIKE got); GRANT ALL ON got_top TO authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
INSERT INTO got SELECT * FROM accounting_expense_footprints('11111111-1111-4111-8111-111111111111', 2024, 200, jsonb_build_array(
  jsonb_build_object('kind','order','ref','114-1234567-7654321','date','2024-02-10','amount','59.90','vendor','Online store','where','mail'),
  jsonb_build_object('kind','order','ref','115-5555555','date','2024-02-12','amount','21.50','vendor','Online store'),
  jsonb_build_object('kind','order','ref','116-0000001','date','2024-06-02','amount','140.00','vendor','Speed Shop'),
  jsonb_build_object('kind','order','ref','bad','date','not-a-date','amount','5')));
INSERT INTO got_top SELECT * FROM accounting_expense_footprints('11111111-1111-4111-8111-111111111111', 2024, 1);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM accounting_expense_footprints('33333333-3333-4333-8333-333333333333', 2024)) THEN RAISE EXCEPTION 'another owner''s footprints for this caller'; END IF;
 BEGIN PERFORM accounting_expense_footprints('11111111-1111-4111-8111-111111111111', 2024, 10, '{"kind":"order"}'::jsonb);
   RAISE EXCEPTION 'an object instead of an array was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
INSERT INTO got_delegate SELECT * FROM accounting_expense_footprints('11111111-1111-4111-8111-111111111111', 2024);
RESET ROLE;
DO $$ DECLARE s record; g record; n int; BEGIN
 -- Cited traces never appear as rows: R1 (amount twin), R2 (file stem), the order named in L-6, the H episodes.
 IF EXISTS (SELECT 1 FROM got WHERE vendor IN ('Parts Store','Hardware Co')) THEN RAISE EXCEPTION 'a cited receipt is listed: %', (SELECT jsonb_agg(to_jsonb(got)) FROM got WHERE vendor IN ('Parts Store','Hardware Co')); END IF;
 IF EXISTS (SELECT 1 FROM got WHERE trace_key = 'external:115-5555555') THEN RAISE EXCEPTION 'an order named in an expense record is listed'; END IF;
 IF EXISTS (SELECT 1 FROM got WHERE vehicle_id::text LIKE 'bbbbbbbb-0000-4000-8000-00000000000%' AND vehicle_id <> 'bbbbbbbb-0000-4000-8000-00000000000a') THEN RAISE EXCEPTION 'a cited work episode is listed'; END IF;
 -- R3: the money is in the book as Owner: a reclassification candidate citing B-3.
 SELECT * INTO g FROM got WHERE vendor = 'Paint Supply';
 IF g.status IS DISTINCT FROM 'booked_not_expense' OR g.cited_by[1] NOT LIKE 'B-3 (Owner, Checking)' OR g.amount <> 61.25 THEN RAISE EXCEPTION 'R3 should be a reclassification candidate: %', to_jsonb(g); END IF;
 -- R4: cash, on a vehicle, verified: a gap at the confidence cap, document amount; the timeline twin and the order twin fold into it.
 SELECT * INTO g FROM got WHERE vendor = 'Speed Shop' AND amount = 140.00;
 IF g.status <> 'uncited' OR g.amount_basis <> 'document' OR g.confidence <> 0.95 OR g.score <> 133.00
    OR g.reasons->>'payment_channel' <> 'cash' OR g.vehicle_id <> 'bbbbbbbb-0000-4000-8000-00000000000a' OR g.look_for NOT LIKE '%in cash%' THEN
  RAISE EXCEPTION 'R4 should be a cash gap at 0.95: %', to_jsonb(g); END IF;
 IF EXISTS (SELECT 1 FROM got WHERE trace_kind = 'timeline_cost' AND amount = 140.00) OR EXISTS (SELECT 1 FROM got WHERE trace_key = 'external:116-0000001') THEN
  RAISE EXCEPTION 'one item was counted twice (receipt, timeline cost, order)'; END IF;
 -- R5: card 4321 has statement lines that month and no matching line: downgraded to 0.75 x 0.5.
 SELECT * INTO g FROM got WHERE vendor = 'Speed Shop' AND amount = 80.00;
 IF g.status <> 'uncited' OR g.confidence <> 0.375 OR g.reasons->>'payment_channel' <> 'covered_card' THEN RAISE EXCEPTION 'R5 covered card: %', to_jsonb(g); END IF;
 -- R6/R7: one slip photographed twice is one trace with both keys and the better amount check.
 SELECT count(*) INTO n FROM got WHERE amount = 33.33;
 IF n <> 1 THEN RAISE EXCEPTION 'duplicate photos of one slip should collapse, got %', n; END IF;
 SELECT * INTO g FROM got WHERE amount = 33.33;
 IF cardinality(g.trace_keys) <> 2 OR g.reasons->>'amount_check' <> 'verified' THEN RAISE EXCEPTION 'collapsed slip keeps both keys: %', to_jsonb(g); END IF;
 -- Near match: same vendor named in L-7, total within 1.00: cited, not listed; the 300.00 slip is too far off: a gap.
 IF EXISTS (SELECT 1 FROM got WHERE vendor = 'Wheel Works' AND amount = 440.83) THEN RAISE EXCEPTION 'a near match was listed as a gap'; END IF;
 IF NOT EXISTS (SELECT 1 FROM got WHERE vendor = 'Wheel Works' AND amount = 300.00 AND status = 'uncited') THEN RAISE EXCEPTION 'a far total on the same vendor must stay a gap'; END IF;
 -- One photo, one trace: R1's photo reread at 54.10 is not a gap; of two unbooked readings of one photo the verified one stands.
 IF EXISTS (SELECT 1 FROM got WHERE amount = 54.10) OR EXISTS (SELECT 1 FROM got WHERE vendor = 'Bolt Bin' AND amount = 25.00) THEN RAISE EXCEPTION 'a reread photo was listed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM got WHERE vendor = 'Bolt Bin' AND amount = 52.00 AND status = 'uncited') THEN RAISE EXCEPTION 'the better reading of an unbooked photo must stand'; END IF;
 -- Excluded: personal, superseded, refund, other year, other owner.
 IF EXISTS (SELECT 1 FROM got WHERE amount IN (500.00, 800.00, 30.00, 70.00, 777.00) OR vendor IN ('Restaurant','Old Read')) THEN RAISE EXCEPTION 'an excluded receipt leaked'; END IF;
 -- V's primer episode: no cell in its window: a gap priced from own history (p25 200, median 300), confidence 0.65.
 SELECT * INTO g FROM got WHERE trace_kind = 'work_episode';
 IF g.trace_key <> 'episode:bbbbbbbb-0000-4000-8000-00000000000a:2024-09-01' OR g.window_end <> '2024-09-05' OR g.amount <> 200.00
    OR g.estimate_mid <> 300.00 OR g.amount_basis <> 'own_history_p25' OR g.confidence <> 0.650 OR g.score <> 130.00
    OR (g.reasons->>'work_days')::int <> 3 THEN RAISE EXCEPTION 'V episode: %', to_jsonb(g); END IF;
 IF (SELECT count(*) FROM got WHERE trace_kind = 'work_episode') <> 1 THEN RAISE EXCEPTION 'presence-only, receipt-photo or other-owner episodes leaked'; END IF;
 -- Timeline storage cost: a claim gap at 0.40; the billing entry at 0.25 asks who paid; the owner's own business's
 -- charge, a receipt extraction and an auction bid are not cost traces.
 SELECT * INTO g FROM got WHERE trace_kind = 'timeline_cost' AND amount = 350.00;
 IF g.amount_basis <> 'claim' OR g.confidence <> 0.400 OR g.trace_date <> '2024-11-15' THEN RAISE EXCEPTION 'timeline claim: %', to_jsonb(g); END IF;
 SELECT * INTO g FROM got WHERE trace_kind = 'timeline_cost' AND amount = 2000.00;
 IF g.confidence <> 0.250 OR g.reasons->>'subtype' <> 'billing_entry' OR g.look_for NOT LIKE '%client paid directly%' THEN RAISE EXCEPTION 'billing entry: %', to_jsonb(g); END IF;
 IF (SELECT count(*) FROM got WHERE trace_kind = 'timeline_cost') <> 2 THEN RAISE EXCEPTION 'own-business, receipt-extraction and auction timeline rows are not cost traces: %', (SELECT jsonb_agg(trace_key||' '||amount) FROM got WHERE trace_kind='timeline_cost'); END IF;
 -- A financed contract total is not a purchase to book as-is: kept, at 0.95 x 0.2, with the financing instruction.
 SELECT * INTO g FROM got WHERE vendor = 'Tool Truck';
 IF g.confidence <> 0.190 OR g.reasons->>'payment_channel' <> 'financing' OR g.look_for NOT LIKE '%financing contract%' THEN RAISE EXCEPTION 'financed receipt: %', to_jsonb(g); END IF;
 -- The uncited order email: 0.9, document amount. The malformed item is ignored.
 SELECT * INTO g FROM got WHERE trace_key = 'external:114-1234567-7654321';
 IF g.status <> 'uncited' OR g.confidence <> 0.900 OR g.amount <> 59.90 THEN RAISE EXCEPTION 'external order: %', to_jsonb(g); END IF;
 IF EXISTS (SELECT 1 FROM got WHERE trace_key LIKE 'external:bad%' OR trace_key LIKE 'external:item-%') THEN RAISE EXCEPTION 'malformed external item used'; END IF;
 -- Ranking: highest amount x confidence first; the summary row last and reconciling with the rows.
 IF (SELECT trace_key FROM got LIMIT 1) IS DISTINCT FROM (SELECT trace_key FROM got WHERE trace_kind <> 'summary' ORDER BY score DESC NULLS LAST LIMIT 1) THEN RAISE EXCEPTION 'not ranked by score'; END IF;
 SELECT * INTO s FROM got WHERE trace_kind = 'summary';
 IF (s.reasons->>'gaps')::int <> (SELECT count(*) FROM got WHERE status = 'uncited') THEN RAISE EXCEPTION 'summary gaps do not reconcile: %', s.reasons; END IF;
 IF (s.reasons->>'reclassification_candidates')::int <> 1 OR (s.reasons->>'near_matches')::int <> 1 OR (s.reasons->>'gap_amount_document')::numeric <> 140.00 + 80.00 + 33.33 + 59.90 + 9000.00 + 300.00 + 52.00
    OR (s.reasons->>'gap_amount_claim')::numeric <> 350.00 + 2000.00 OR (s.reasons->>'gap_amount_estimated_p25')::numeric <> 200.00
    OR s.amount <> 140.00 + 80.00 + 33.33 + 59.90 + 9000.00 + 300.00 + 52.00 + 350.00 + 2000.00
    OR (s.reasons->'by_kind_status'->>'receipt:reread')::int <> 2 OR s.estimate_mid <> 200.00 THEN RAISE EXCEPTION 'summary dollars: % %', to_jsonb(s), s.reasons; END IF;
 IF (s.reasons->'by_kind_status'->>'work_episode:cited_vehicle')::int <> 5 OR (s.reasons->'by_kind_status'->>'receipt:cited_expense')::int <> 2 THEN
  RAISE EXCEPTION 'summary counts cited traces: %', s.reasons; END IF;
 -- Limit 1: the single best gap plus the summary.
 IF (SELECT count(*) FROM got_top) <> 2 OR (SELECT trace_key FROM got_top LIMIT 1) <> (SELECT trace_key FROM got LIMIT 1) THEN RAISE EXCEPTION 'limit: %', (SELECT jsonb_agg(trace_key) FROM got_top); END IF;
 -- A delegate can read the book but not the owner's receipts and photos: nothing rather than a partial answer.
 IF EXISTS (SELECT 1 FROM got_delegate) THEN RAISE EXCEPTION 'a delegate received footprints'; END IF;
 IF has_function_privilege('anon','public.accounting_expense_footprints(uuid,integer,integer,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.accounting_expense_footprints(uuid,integer,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'grants wrong'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE proname = 'accounting_expense_footprints') THEN RAISE EXCEPTION 'the reader must run with the caller''s policies'; END IF;
 IF (SELECT provolatile FROM pg_proc WHERE proname = 'accounting_expense_footprints') <> 's' THEN RAISE EXCEPTION 'the reader must be STABLE (read-only)'; END IF;
 RAISE NOTICE 'PASS accounting_expense_footprints: cited by amount, stem, order number and vendor near match; reclassification; cash, covered-card, financed, duplicate and reread receipts; own-history episode estimate; claims; external orders; ranking, summary, owner-only';
END $$;
ROLLBACK;
