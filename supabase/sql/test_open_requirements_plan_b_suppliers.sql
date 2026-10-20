-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay, which applies
-- 20261020050000 and 20261020051000 after the rest of the build). Proves: open_requirements_read rows carry Plan-B
-- suppliers (organizations paid for this kind of work before on Nuke) for skill/tool/equipment/facility requirements only,
-- labelled with record counts and no amounts or ids; facility_read shows work recorded on Nuke; the anchored edits left the
-- rest of each reader unchanged.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- Live columns the readers and create_organization_batch use that the replay fixture omits.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS website text, ADD COLUMN IF NOT EXISTS zip_code text, ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS discovered_via text, ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE pipeline_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE TABLE public.write_receipts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz DEFAULT now(),
  tbl text, op text, rows integer, writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor_name text, receipt_date date,
  transaction_date date, purchase_date date, created_at timestamptz DEFAULT now(), total_amount numeric, is_superseded boolean, is_active boolean);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, description text, category text, total_price numeric);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS direction text, ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS counterparty_org_id uuid, ADD COLUMN IF NOT EXISTS amount_usd numeric;
ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS supplier text, ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
\ir ../migrations/20261007130000_create_organization_batch.sql

UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
UPDATE organizations SET is_public = true, business_name = 'Fixture Shop' WHERE id = '20000000-0000-0000-0000-000000000001';
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('52000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'paint','Door touch-up','pending'),
 ('52000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'inspect','Road test','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('56000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','52000000-0000-0000-0000-000000000001','requirement_kind','skill','description','Paint touch-up for the door','quantity',1,'unit','job'))),
 ('56000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','52000000-0000-0000-0000-000000000002','requirement_kind','inspection','description','Road-test inspection after the brake and paint work','quantity',1,'unit','job')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('56000000-0000-0000-0000-000000000001');
SELECT project_work_order_resource_observation('56000000-0000-0000-0000-000000000002');
RESET ROLE;

-- Purchase records: AutoZone (domain-keyed, created privately) with a paid paint line; an outgoing payment to the public shop.
INSERT INTO receipts(id, user_id, vendor_name, receipt_date, total_amount) VALUES
 ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', 'AutoZone Store #5724', '2024-05-12', 41.17),
 ('a1000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000c', 'AUTO ZONE', '2025-01-03', 12.50);
INSERT INTO receipt_items(receipt_id, description, category, total_price) VALUES ('a1000000-0000-0000-0000-000000000001', 'Rust primer', 'paint', 9.99);
INSERT INTO payment_events(id, scope_type, scope_id, is_superseded, direction, amount_usd, paid_at, counterparty_org_id) VALUES
 ('c3000000-0000-0000-0000-000000000001', 'work_order', '30000000-0000-0000-0000-000000000001', false, 'out', 300, '2023-03-03', '20000000-0000-0000-0000-000000000001');
SELECT t_assert((SELECT r @> '{"organizations_created":1}' FROM (SELECT supply_resolve_counterparties() r) x), 'resolver created AutoZone privately');

CREATE FUNCTION public.req_row(p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT r FROM jsonb_array_elements(open_requirements_read(NULL,100,NULL)->'rows') r WHERE r->>'requirement_id' = p::text $$;
GRANT EXECUTE ON FUNCTION public.req_row(uuid) TO anon, authenticated;

SET ROLE anon;
SELECT as_user(NULL);
SELECT req_row('56000000-0000-0000-0000-000000000001') AS paint \gset
SELECT req_row('56000000-0000-0000-0000-000000000002') AS insp \gset
SELECT facility_read('20000000-0000-0000-0000-000000000001') AS fac \gset
RESET ROLE;
SELECT t_assert((:'paint'::jsonb)->'plan_b_suppliers' @> '[{"organization":{"name":"AutoZone"},"kinds_matched":["paint_materials"],"times":1,
  "label":"paid for this before on Nuke (1 time)","role":"plan_b_supplier","profile_public":false}]'
  AND jsonb_array_length((:'paint'::jsonb)->'plan_b_suppliers') = 1, 'skill requirement: Plan-B supplier paid for paint before');
SELECT t_assert((:'insp'::jsonb)->'plan_b_suppliers' = '[]'::jsonb, 'inspection requirement: no Plan-B suppliers even when its text names paint');
SELECT t_assert((:'paint'::jsonb) ? 'candidates_listed' AND (:'paint'::jsonb)->>'candidates_listed' = '0'
  AND (:'paint'::jsonb) ? 'match' AND (:'paint'::jsonb) ? 'quote_state', 'the rest of the row is unchanged; Plan-B is not a candidate');
SELECT t_assert((:'paint'::jsonb)::text !~ '((^|[^:0-9.])(41\.17|12\.5)([^0-9]|$)|a1000000|Rust primer|10000000-0000-0000-0000-00000000000c)', 'no amounts, record ids, line text or payer');
SELECT t_assert((:'fac'::jsonb)->'work_recorded_on_nuke' @> '{"records":1,"kinds":[{"supply_kind":"paid_counterparty","times":1,"first_on":"2023-03-03"}],
  "by_source":{"payment_events":1}}' AND (:'fac'::jsonb) ? 'members' AND (:'fac'::jsonb) ? 'calendar', 'facility_read: work recorded on Nuke; rest unchanged');
SELECT t_assert((:'fac'::jsonb)::text !~ '((^|[^0-9a-f-])300([^0-9a-f-]|$)|c3000000)', 'facility_read: no payment amount or id');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.open_requirements_read(uuid,integer,text)'::regprocedure), '''plan_b_suppliers''', 'g')) = 1
  AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.facility_read(uuid)'::regprocedure), 'work_recorded_on_nuke', 'g')) = 1,
  'each anchored addition is present exactly once');
