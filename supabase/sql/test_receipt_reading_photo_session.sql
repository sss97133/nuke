-- Disposable database only. Exercise the actual receipt reader and qualification.
\set ON_ERROR_STOP on
\ir test_receipt_work_judgment_currentness.sql
ALTER TABLE public.work_sessions ADD COLUMN user_id uuid, ADD COLUMN title text, ADD COLUMN session_type text;
ALTER TABLE public.vehicle_images ADD COLUMN user_id uuid;
CREATE TABLE public.organization_vehicles(organization_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), linked_by_user_id uuid);
CREATE TABLE public.organization_contributors(organization_id uuid, user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions(vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, is_active boolean, role text);
CREATE FUNCTION public.organization_vehicle_link_grants(p_vehicle_id uuid, p_linker uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.user_id = p_linker)
$$;
\ir ../migrations/20261127023100_receipt_reading_photo_session.sql

DO $$
DECLARE
  v constant uuid := '20000000-0000-0000-0000-000000000001';
  u constant uuid := '20000000-0000-0000-0000-000000000002';
  stranger constant uuid := '20000000-0000-0000-0000-000000000003';
  public_viewer constant uuid := '20000000-0000-0000-0000-000000000011';
  org_bad constant uuid := '20000000-0000-0000-0000-000000000012';
  org_good constant uuid := '20000000-0000-0000-0000-000000000013';
  org_inactive constant uuid := '20000000-0000-0000-0000-000000000015';
  r constant uuid := '20000000-0000-0000-0000-000000000004';
  item constant uuid := '20000000-0000-0000-0000-000000000005';
  l constant uuid := '20000000-0000-0000-0000-000000000006';
  f1 constant uuid := '20000000-0000-0000-0000-000000000007';
  f2 constant uuid := '20000000-0000-0000-0000-000000000008';
  f3 constant uuid := '20000000-0000-0000-0000-00000000000d';
  f4 constant uuid := '20000000-0000-0000-0000-00000000000e';
  other_vehicle constant uuid := '20000000-0000-0000-0000-00000000000f';
  other_session constant uuid := '20000000-0000-0000-0000-000000000010';
  s1 constant uuid := '20000000-0000-0000-0000-000000000009';
  s2 constant uuid := '20000000-0000-0000-0000-00000000000a';
  e constant uuid := '20000000-0000-0000-0000-00000000000b';
  q constant uuid := '20000000-0000-0000-0000-00000000000c';
  ctx jsonb; result jsonb; candidates uuid[];
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'public.receipt_work_reading_frame_context(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.receipt_work_reading_frame_context(uuid,uuid)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.receipt_work_reading_frame_context(uuid,uuid)', 'EXECUTE'),
     'internal frame-session helper must not be callable by clients';
  ASSERT NOT has_function_privilege('authenticated', 'public.receipt_work_frame_viewer_eligible(public.vehicle_images)', 'EXECUTE'),
    'the image policy helper must not be callable by clients';
  INSERT INTO vehicles VALUES (v,u,u,u,false,NULL);
  INSERT INTO receipts(id,user_id,vendor_name,document_kind,receipt_date,is_superseded)
    VALUES(r,u,'Fixture supplier','parts_service','2025-01-01',false);
  INSERT INTO receipt_items(id,receipt_id,line_number,description,part_number,total_price)
    VALUES(item,r,1,'radiator','R1',100);
  INSERT INTO receipt_vehicle_links(id,receipt_id,vehicle_id,user_id,status,basis,confidence,page_date)
    VALUES(l,r,v,u,'linked','cited_document',0.9,'2025-01-01');
  INSERT INTO work_sessions(id,vehicle_id,user_id,session_date,title,session_type) VALUES
    (s1,v,u,'2025-01-02','First photo day','auto_detected'),
    (s2,v,u,'2025-01-03','Cited photo session','auto_detected');
  INSERT INTO vehicle_images(id,vehicle_id,user_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone,work_session_id,image_url) VALUES
    (f1,v,u,'2025-01-02 12:00Z','approved',false,'none','mech_engine_bay',s1,'https://fixture.invalid/first.jpg'),
    (f2,v,stranger,'2025-01-03 12:00Z','approved',false,'none','mech_engine_bay',s2,'https://fixture.invalid/cited.jpg');
  SELECT x.question_context,x.work_session_ids INTO STRICT ctx,candidates FROM receipt_work_lines(v,90,8) x WHERE x.item_id=item AND x.link_id=l;
  ASSERT candidates = ARRAY[s1], 'the existing candidate session should follow the first photo day';
  INSERT INTO garage_derivation_evidence(id,kind,vehicle_id,user_id,subject_key,conclusion,evidence,image_ids,conclusion_detail)
    VALUES(e,'receipt_work_correlation',v,u,'receipt_item:'||item,'install_window_photographed',
      jsonb_build_object('receipt_id',r,'item_id',item,'link_id',l,'description','radiator','part_number','R1','total_price',100,'line_number',1,
        'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),ARRAY[f1,f2],'{}');
  INSERT INTO evidence_judgment_requests(id,department,question_kind,subject_table,subject_id,vehicle_id,user_id,params,answer_schema,status,
      dedupe_key,question_hash,producer_agent,producer_script,producer_version,run_id,answer,created_at)
    VALUES(q,'receipt_work_reconciliation','receipt_part_visible','receipt_items',item,v,u,
      jsonb_build_object('context',ctx,'candidate_image_ids',ctx->'candidate_image_ids','description','radiator','part_number','R1',
        'receipt_id',r,'receipt_item_id',item,'vehicle_id',v,'total_price',100,'purchase_date',ctx->'anchor_date',
        'anchor_source',ctx->'anchor_source','zone',ctx->'zone','end_hint',ctx->'end_hint',
        'printed_claims',jsonb_build_object('line_date',NULL,'hours',NULL,'performer',NULL)),
      '{}','answered','frame-session-test','frame-session-test','test','test','1',gen_random_uuid(),
      jsonb_build_object('visible','yes','installed','yes','image_id',f2),now());
  PERFORM set_config('test.role','authenticated',true); PERFORM set_config('test.uid',u::text,true);
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,answer,frame_context,image_id}' = f2::text
    AND result #>> '{lines,0,judgment,answer,frame_context,session,id}' = s2::text
    AND result #>> '{lines,0,judgment,answer,frame_context,session,session_date}' = '2025-01-03',
    'the answer must open its actual cited photo session, not the first-day candidate: '||result::text;
  INSERT INTO vehicle_grants(vehicle_id,user_id) VALUES(v,stranger);
  PERFORM set_config('test.uid',stranger::text,true);
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb
     AND result #>> '{lines,0,frames,0,image_id}' = f2::text
     AND jsonb_array_length(result #> '{lines,0,frames}') = 1
     AND (result #>> '{lines,0,frames_hidden}')::int = 1,
    'a viewer may see their own photo, but not a reading derived from an inaccessible frame';
  UPDATE vehicles SET is_public=true WHERE id=v;
  PERFORM set_config('test.uid',public_viewer::text,true);
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,judgment,answer,frame_context,image_id}' = f2::text
    AND result #> '{lines,0,judgment,answer,frame_context,session}' = 'null'::jsonb,
    'a public vehicle does not make a private work-session record public';
  PERFORM set_config('test.uid',u::text,true);
  INSERT INTO vehicle_images(id,vehicle_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone,image_url)
    VALUES(f3,v,'2025-01-04 12:00Z','approved',false,'none','mech_engine_bay','https://fixture.invalid/new.jpg');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,judgment}' = 'null'::jsonb
    AND result #>> '{lines,0,historical_judgment,answer,frame_context,image_id}' = f2::text
    AND result #>> '{lines,0,historical_judgment,answer,frame_context,session,id}' = s2::text,
    'historical readings must retain the cited photo session without becoming current';
  INSERT INTO vehicles VALUES(other_vehicle,u,u,u,false,NULL);
  INSERT INTO work_sessions(id,vehicle_id,user_id,session_date,title,session_type)
    VALUES(other_session,other_vehicle,u,'2025-01-05','Another vehicle','auto_detected');
  INSERT INTO vehicle_images(id,vehicle_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone,work_session_id,image_url)
    VALUES(f4,v,'2025-01-05 12:00Z','approved',false,'none','mech_engine_bay',other_session,'https://fixture.invalid/wrong-session.jpg');
  result := receipt_work_reading_frame_context(v,f4);
  ASSERT result -> 'session' = 'null'::jsonb, 'a session on another vehicle must not be borrowed';
  -- A viewer's own image is available even on a private vehicle, but its
  -- unrelated session remains withheld unless session RLS also permits it.
  INSERT INTO vehicle_images(id,vehicle_id,user_id,taken_at,vision_gate_status,is_sensitive,redaction_level,vehicle_zone,work_session_id,image_url)
    VALUES('20000000-0000-0000-0000-000000000014',v,stranger,'2025-01-06 12:00Z','approved',false,'none','mech_engine_bay',s2,'https://fixture.invalid/own.jpg');
  UPDATE vehicles SET is_public=false WHERE id=v;
  PERFORM set_config('test.uid',stranger::text,true);
  result := receipt_work_reading_frame_context(v,'20000000-0000-0000-0000-000000000014');
  ASSERT result ->> 'image_id' = '20000000-0000-0000-0000-000000000014' AND result -> 'session' = 'null'::jsonb,
    'own photo does not automatically grant a session';
  -- Active organization membership is insufficient when the vehicle link is
  -- untrusted. A trusted organization link grants images, not the session.
  INSERT INTO organization_vehicles VALUES(org_bad,v,stranger);
  INSERT INTO organization_contributors VALUES(org_bad,stranger,'active');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,historical_judgment}' = 'null'::jsonb,
    'untrusted organization link must not reveal the prior reading';
  INSERT INTO organization_vehicles VALUES(org_inactive,v,u);
  INSERT INTO organization_contributors VALUES(org_inactive,stranger,'inactive');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,historical_judgment}' = 'null'::jsonb,
    'inactive organization membership must not reveal the prior reading';
  INSERT INTO organization_vehicles VALUES(org_good,v,u);
  INSERT INTO organization_contributors VALUES(org_good,stranger,'active');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,historical_judgment,answer,frame_context,image_id}' = f2::text
    AND result #> '{lines,0,historical_judgment,answer,frame_context,session}' = 'null'::jsonb,
    'trusted organization member may read the photo but not a private session';
  INSERT INTO vehicle_user_permissions VALUES(v,stranger,false,'mechanic');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,historical_judgment,answer,frame_context,session}' = 'null'::jsonb,
    'inactive session permission must not reveal the session';
  INSERT INTO vehicle_user_permissions VALUES(v,stranger,true,'unrecognized');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #> '{lines,0,historical_judgment,answer,frame_context,session}' = 'null'::jsonb,
    'an unrecognized permission role must not reveal the session';
  INSERT INTO vehicle_user_permissions VALUES(v,stranger,true,'mechanic');
  result := get_vehicle_receipt_work_context(v);
  ASSERT result #>> '{lines,0,historical_judgment,answer,frame_context,session,id}' = s2::text,
    'active permitted mechanic should open the actual cited photo session';
  RAISE NOTICE 'receipt reading photo-session cases passed';
END $$;
