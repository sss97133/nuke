-- Disposable database only. Reuse the actual receipt, reading and session fixtures.
\set ON_ERROR_STOP on
\ir test_receipt_reading_photo_session.sql
\ir ../migrations/20261127024800_receipt_readings_by_session.sql

-- Two separate source items may cite one photo. Preserve both as readings;
-- the session reader must not manufacture or multiply financial amounts.
DO $$
DECLARE
  v constant uuid := '20000000-0000-0000-0000-000000000001';
  u constant uuid := '20000000-0000-0000-0000-000000000002';
  r constant uuid := '20000000-0000-0000-0000-000000000004';
  item constant uuid := '30000000-0000-0000-0000-000000000005';
  l constant uuid := '20000000-0000-0000-0000-000000000006';
  photo constant uuid := '20000000-0000-0000-0000-000000000008';
  source_row record;
BEGIN
  INSERT INTO receipt_items(id,receipt_id,line_number,description,part_number,total_price)
    VALUES(item,r,2,'radiator clamp','R2',20);
  SELECT * INTO STRICT source_row FROM receipt_work_lines(v,90,8) x WHERE x.item_id=item AND x.link_id=l;
  INSERT INTO garage_derivation_evidence(id,kind,vehicle_id,user_id,subject_key,conclusion,evidence,image_ids,conclusion_detail)
    VALUES('30000000-0000-0000-0000-000000000006','receipt_work_correlation',v,u,'receipt_item:'||item,
      source_row.conclusion,jsonb_build_object('receipt_id',r,'item_id',item,'link_id',l,'description','radiator clamp',
      'part_number','R2','total_price',20,'line_number',2,
      'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),source_row.image_ids,'{}');
  INSERT INTO evidence_judgment_requests(id,department,question_kind,subject_table,subject_id,vehicle_id,user_id,params,answer_schema,status,
      dedupe_key,question_hash,producer_agent,producer_script,producer_version,run_id,answer,created_at)
    VALUES('30000000-0000-0000-0000-000000000007','receipt_work_reconciliation','receipt_part_visible','receipt_items',item,v,u,
      jsonb_build_object('context',source_row.question_context,'candidate_image_ids',source_row.question_context->'candidate_image_ids',
        'description','radiator clamp','part_number','R2','receipt_id',r,'receipt_item_id',item,'vehicle_id',v,'total_price',20,
        'purchase_date',source_row.question_context->'anchor_date','anchor_source',source_row.question_context->'anchor_source',
        'zone',source_row.question_context->'zone','end_hint',source_row.question_context->'end_hint',
        'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),
      '{}','answered','session-other','session-other','test','test','1',gen_random_uuid(),
      jsonb_build_object('visible','yes','installed','cannot_tell','image_id',photo),now());
END $$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.work_sessions, public.vehicle_user_permissions TO authenticated;
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_fixture_select ON public.work_sessions FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.vehicle_user_permissions p WHERE p.vehicle_id=work_sessions.vehicle_id AND p.user_id=auth.uid()
      AND coalesce(p.is_active,true) AND p.role IN ('owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent')));

SELECT set_config('test.role','authenticated',false),set_config('test.uid','20000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $$
DECLARE result jsonb; v constant uuid := '20000000-0000-0000-0000-000000000001';
  s1 constant uuid := '20000000-0000-0000-0000-000000000009';
  s2 constant uuid := '20000000-0000-0000-0000-00000000000a';
BEGIN
  result := public.get_vehicle_receipt_readings_for_session(v,s2);
  ASSERT result -> 'available' = 'true'::jsonb AND jsonb_array_length(result -> 'readings') = 2,
    'the actual cited session should contain two distinct item readings: '||result::text;
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'readings') x WHERE x ->> 'reading_status' = 'current')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'readings') x WHERE x ->> 'reading_status' = 'historical'),
    'current and older readings must remain distinguishable';
  ASSERT (SELECT count(DISTINCT x ->> 'photo_id') FROM jsonb_array_elements(result -> 'readings') x) = 1
     AND (SELECT count(DISTINCT x ->> 'item_id') FROM jsonb_array_elements(result -> 'readings') x) = 2,
    'a shared photo must not collapse separate source items';
  ASSERT (SELECT count(DISTINCT x ->> 'evidence_id') FROM jsonb_array_elements(result -> 'readings') x) = 2
     AND (SELECT count(DISTINCT x ->> 'question_id') FROM jsonb_array_elements(result -> 'readings') x) = 2,
    'each reading must retain its actual source evidence and question keys';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'readings') x WHERE x ?| ARRAY['amount','price','cost','hours']),
    'evidence citations must not manufacture a work value';
  result := public.get_vehicle_receipt_readings_for_session(v,s1);
  ASSERT result -> 'available' = 'true'::jsonb AND result -> 'readings' = '[]'::jsonb,
    'a first-day candidate session must not borrow another session photo';
  PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000003',true);
  result := public.get_vehicle_receipt_readings_for_session(v,s2);
  ASSERT result -> 'available' = 'true'::jsonb AND jsonb_array_length(result -> 'readings') = 2,
    'trusted contributor with session access should see the evidence';
  PERFORM set_config('test.uid','20000000-0000-0000-0000-000000000011',true);
  result := public.get_vehicle_receipt_readings_for_session(v,s2);
  ASSERT result -> 'available' = 'false'::jsonb AND result -> 'readings' = '[]'::jsonb,
    'a viewer without session access must not enumerate receipt evidence';
  RAISE NOTICE 'receipt readings by session cases passed';
END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon','public.get_vehicle_receipt_readings_for_session(uuid,uuid)','EXECUTE')
     AND has_function_privilege('authenticated','public.get_vehicle_receipt_readings_for_session(uuid,uuid)','EXECUTE'),
    'session receipt reader must be signed-in only';
END $$;
