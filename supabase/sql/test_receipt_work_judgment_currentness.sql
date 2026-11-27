-- Disposable database only. Reuse the established reader contract and schema fixtures.
\set ON_ERROR_STOP on
\ir test_receipt_work_context_reader.sql
\ir ../migrations/20261113090000_receipt_work_context_reader.sql
\ir ../migrations/20261114120002_evidence_judgment_candidate_set_equality.sql
\if :{?baseline}
\else
\ir ../migrations/20261127011635_receipt_work_judgment_currentness.sql
\endif

DO $$
DECLARE
  v constant uuid := '10000000-0000-0000-0000-000000000001';
  u constant uuid := '10000000-0000-0000-0000-000000000002';
  r constant uuid := '10000000-0000-0000-0000-000000000003';
  i constant uuid := '10000000-0000-0000-0000-000000000004';
  l constant uuid := '10000000-0000-0000-0000-000000000005';
  f constant uuid := '10000000-0000-0000-0000-000000000006';
  f2 constant uuid := '10000000-0000-0000-0000-00000000000a';
  e constant uuid := '10000000-0000-0000-0000-000000000007';
  oldq constant uuid := '10000000-0000-0000-0000-000000000008';
  newq constant uuid := '10000000-0000-0000-0000-000000000009';
  ctx jsonb; doc jsonb; result jsonb;
BEGIN
  IF to_regprocedure('public.receipt_work_current_judgments(uuid)') IS NOT NULL THEN
    ASSERT NOT has_function_privilege('anon', 'public.receipt_work_current_judgments(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.receipt_work_current_judgments(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.receipt_work_current_judgments(uuid)', 'EXECUTE'),
       'the internal question qualifier must not be a client-readable API';
    ASSERT NOT has_function_privilege('anon', 'public.receipt_work_judgment_qualification(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.receipt_work_judgment_qualification(uuid)', 'EXECUTE'),
       'historical qualification must not expose private question ids to clients';
  END IF;
  INSERT INTO vehicles VALUES (v,u,u,u,false,NULL);
  INSERT INTO receipts(id,user_id,vendor_name,document_kind,receipt_date,is_superseded)
    VALUES(r,u,'Fixture supplier','parts_service','2025-01-01',false);
  INSERT INTO receipt_items(id,receipt_id,line_number,description,part_number,total_price)
    VALUES(i,r,1,'radiator','R1',100);
  INSERT INTO receipt_vehicle_links(id,receipt_id,vehicle_id,user_id,status,basis,confidence,page_date)
    VALUES(l,r,v,u,'linked','cited_document',0.9,'2025-01-01');
  INSERT INTO vehicle_images(id,vehicle_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone)
    VALUES(f,v,'2025-01-02 12:00Z','approved',false,'none','mech_engine_bay');
  SELECT question_context INTO STRICT ctx FROM receipt_work_lines(v,90,8) WHERE item_id=i AND link_id=l;
  doc := jsonb_build_object('receipt_id',r,'item_id',i,'link_id',l,'description','radiator','part_number','R1',
          'total_price',100,'line_number',1,'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL));
  INSERT INTO garage_derivation_evidence(id,kind,vehicle_id,user_id,subject_key,conclusion,evidence,image_ids,conclusion_detail)
    VALUES(e,'receipt_work_correlation',v,u,'receipt_item:'||i,'install_window_photographed',doc,ARRAY[f],'{}');
  INSERT INTO evidence_judgment_requests(id,department,question_kind,subject_table,subject_id,vehicle_id,user_id,params,answer_schema,status,
      dedupe_key,question_hash,producer_agent,producer_script,producer_version,run_id,answer,created_at)
    VALUES(oldq,'receipt_work_reconciliation','receipt_part_visible','receipt_items',i,v,u,
      jsonb_build_object('context',ctx,'candidate_image_ids',ctx->'candidate_image_ids','description','radiator','part_number','R1',
        'receipt_id',r,'receipt_item_id',i,'vehicle_id',v,'total_price',100,'purchase_date',ctx->'anchor_date',
        'anchor_source',ctx->'anchor_source','zone',ctx->'zone','end_hint',ctx->'end_hint',
        'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),
      '{}','answered','current-test','current-test','test','test','1',gen_random_uuid(),
      jsonb_build_object('visible','yes','installed','yes','image_id',f),now());
  PERFORM set_config('test.role','authenticated',true); PERFORM set_config('test.uid',u::text,true);
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,question_id}' = oldq::text, 'current answer missing: '||result::text;
  UPDATE evidence_judgment_requests SET params=jsonb_set(params,'{context,zone_photos_total}','99'::jsonb) WHERE id=oldq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,question_id}' = oldq::text, 'photo count change alone invalidated the same frame set';
  UPDATE evidence_judgment_requests SET params=jsonb_set(params,'{context,zone_photos_total}',ctx->'zone_photos_total') WHERE id=oldq;
  UPDATE evidence_judgment_requests SET answer=jsonb_build_object('visible','no','installed','cannot_tell','quote','not visible in these frames') WHERE id=oldq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,answer,visible}' = 'no', 'negative reading of visible frame set was lost';
  UPDATE evidence_judgment_requests SET answer=jsonb_build_object('visible','yes','installed','yes','image_id',f) WHERE id=oldq;
  IF to_regprocedure('public.receipt_work_judgment_qualification(uuid)') IS NOT NULL THEN
  INSERT INTO vehicle_images(id,vehicle_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone)
    VALUES(f2,v,'2025-01-03 12:00Z','approved',false,'none','mech_engine_bay');
  ASSERT EXISTS (SELECT 1 FROM receipt_work_judgment_qualification(v) q
                 WHERE q.judgment_id=oldq AND q.qualification='historical_photo_context'),
    'new photos must retain the original answer as historical testimony';
  ASSERT NOT EXISTS (SELECT 1 FROM receipt_work_current_judgments(v) q WHERE q.judgment_id=oldq),
    'a historical answer must not count as current for the new frame set';
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb
    AND result #>> '{lines,0,historical_judgment,question_id}' = oldq::text
    AND result #>> '{lines,0,historical_judgment,answer,visible}' = 'yes'
    AND result #>> '{lines,0,historical_judgment,frame,image_id}' = f::text,
    'historical reading and its frame must appear separately: ' || result::text;
  PERFORM set_config('test.uid','10000000-0000-0000-0000-000000000099',true);
  result := get_vehicle_receipt_work_context(v);
  ASSERT result -> 'visible' = 'false'::jsonb AND result -> 'lines' = '[]'::jsonb,
    'a viewer without access must not see historical testimony or its frame';
  INSERT INTO vehicle_grants(vehicle_id,user_id) VALUES (v,'10000000-0000-0000-0000-000000000099');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result -> 'visible' = 'true'::jsonb AND result #> '{lines,0,historical_judgment}' = 'null'::jsonb,
    'a vehicle grant alone must not expose a historical photo or its reading';
  PERFORM set_config('test.uid',u::text,true);
  UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id=f2;
  ASSERT EXISTS (SELECT 1 FROM receipt_work_current_judgments(v) q WHERE q.judgment_id=oldq),
    'returning to the original frame set must restore the current context';
  END IF;

  UPDATE evidence_judgment_requests SET params=jsonb_set(params,'{description}','"different part"') WHERE id=oldq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'question text disagrees with context';
  UPDATE evidence_judgment_requests SET params=jsonb_set(params,'{description}','"radiator"') WHERE id=oldq;
  UPDATE evidence_judgment_requests SET answer=jsonb_set(answer,'{image_id}','"10000000-0000-0000-0000-000000000099"') WHERE id=oldq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'answer citing a different photo was exposed';
  UPDATE evidence_judgment_requests SET answer=jsonb_set(answer,'{image_id}',to_jsonb(f::text)) WHERE id=oldq;
  UPDATE evidence_judgment_requests SET answer=jsonb_set(answer,'{visible}','"no"') WHERE id=oldq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'invisible part cannot establish installation';
  UPDATE evidence_judgment_requests SET answer=jsonb_set(answer,'{visible}','"yes"') WHERE id=oldq;
  UPDATE vehicle_images SET is_sensitive=true WHERE id=f;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'answer citing hidden photo was exposed';
  UPDATE vehicle_images SET is_sensitive=false WHERE id=f;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,question_id}' = oldq::text, 'restored evidence did not restore eligible answer';
  UPDATE vehicle_images SET ai_scan_metadata='{"fixture_withheld":true}'::jsonb WHERE id=f;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'gallery-withheld frame influenced judgment';
  ASSERT result #> '{lines,0,frames}' = '[]'::jsonb AND (result #>> '{lines,0,frames_hidden}')::int = 1,
    'gallery-withheld frame leaked through receipt context';
  UPDATE vehicle_images SET ai_scan_metadata=NULL WHERE id=f;

  -- Same item ID, but its description was corrected. Old answer stays stored, not current.
  UPDATE receipt_items SET description='radiator hose' WHERE id=i;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'old answer reused after correction: '||result::text;
  ASSERT EXISTS (SELECT 1 FROM evidence_judgment_requests WHERE id=oldq AND status='answered'), 'historical answer changed';

  -- A new current question must win over the old answered question, and a different
  -- department or kind for the same item must not be mistaken for an install answer.
  SELECT question_context INTO STRICT ctx FROM receipt_work_lines(v,90,8) WHERE item_id=i AND link_id=l;
  UPDATE garage_derivation_evidence SET evidence=doc||jsonb_build_object('description','radiator hose') WHERE id=e;
  INSERT INTO evidence_judgment_requests(id,department,question_kind,subject_table,subject_id,vehicle_id,user_id,params,answer_schema,status,
      dedupe_key,question_hash,producer_agent,producer_script,producer_version,run_id,created_at)
    VALUES(newq,'receipt_work_reconciliation','receipt_part_visible','receipt_items',i,v,u,
      jsonb_build_object('context',ctx,'candidate_image_ids',ctx->'candidate_image_ids','description','radiator hose','part_number','R1',
        'receipt_id',r,'receipt_item_id',i,'vehicle_id',v,'total_price',100,'purchase_date',ctx->'anchor_date',
        'anchor_source',ctx->'anchor_source','zone',ctx->'zone','end_hint',ctx->'end_hint',
        'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),
      '{}','pending','new-test','new-test','test','test','1',gen_random_uuid(),now());
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,question_id}' = newq::text, 'new question not selected: '||result::text;
  UPDATE evidence_judgment_requests SET department='other' WHERE id=newq;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'unrelated judgment selected: '||result::text;
  UPDATE evidence_judgment_requests SET department='receipt_work_reconciliation' WHERE id=newq;
  UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id=f;
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb, 'question retained after photo withdrawn: '||result::text;
  RAISE NOTICE 'receipt work judgment currentness cases passed';
END $$;
