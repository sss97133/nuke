-- Synthetic local regression: a valid work card must not disappear because its
-- source says invoice/customer. No production testimony is imported or changed.
\set ON_ERROR_STOP on
\ir test_visual_work_build_log.sql
\ir fixtures/visual_work_contact_owner_20261110.sql
CREATE TEMP TABLE text_owner_before AS SELECT
 md5(pg_get_functiondef('public.public_text(text)'::regprocedure)) AS public_text_hash,
 md5(pg_get_functiondef('public.vehicle_build_log_public(uuid)'::regprocedure)) AS legacy_hash,
 (SELECT proacl FROM pg_proc WHERE oid='public.visual_work_build_log(uuid)'::regprocedure) AS helper_acl;
UPDATE vehicles SET deleted_at=NULL,is_public=true;
UPDATE receipt_items SET description='Customer coordination on invoice; contact fixture@example.test or 202-555-0123' WHERE line_number=2;
UPDATE vehicle_observations SET structured_data=structured_data||jsonb_build_object(
 'title','Invoice-backed upholstery work',
 'summary','The invoice records a $210 charge on a customer-supplied assembly; paid status is not established.',
 'customer_name','Synthetic Person', 'customer_address','123 Example Road, Example City',
 'gaps',jsonb_build_array('The invoice does not establish installation or payment.','Call 202-555-0123 or fixture@example.test for source context.'),
 'receipt_links',jsonb_set(structured_data->'receipt_links','{1,description}',to_jsonb('Customer coordination on invoice; contact fixture@example.test or 202-555-0123'::text)),
 'visual_sources',jsonb_set(structured_data->'visual_sources','{1,caption}',to_jsonb('Finished customer-supplied seat; fixture@example.test'::text)))
 WHERE extraction_method='visual_work_v1';
DO $$ BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT NOT (vehicle_build_log_public('10000000-0000-0000-0000-000000000001',false)?'visual_work'),
  'Reproduce the old invoice/customer veto before applying the fix';
END $$;
\ir ../migrations/20261110053000_visual_work_receipt_text.sql
DO $$ DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; j jsonb; saved jsonb; h text;
BEGIN
 j:=vehicle_build_log_public(v,false);
 ASSERT jsonb_array_length(j->'visual_work')=1,j::text;
 ASSERT j#>>'{visual_work,0,title}'='Invoice-backed upholstery work';
 ASSERT j#>>'{visual_work,0,summary}'='The invoice records a $210 charge on a customer-supplied assembly; paid status is not established.';
 ASSERT j#>>'{visual_work,0,receipts,1,description}'='Customer coordination on invoice; contact [contact through Nuke] or [contact through Nuke]';
 ASSERT j#>>'{visual_work,0,images,1,caption}'='Finished customer-supplied seat; [contact through Nuke]';
 ASSERT j#>>'{visual_work,0,gaps,0}'='The invoice does not establish installation or payment.';
 ASSERT j#>>'{visual_work,0,gaps,1}'='Call [contact through Nuke] or [contact through Nuke] for source context.';
 ASSERT j::text NOT LIKE '%fixture@example.test%' AND j::text NOT LIKE '%202-555-0123%';
 ASSERT j::text NOT LIKE '%Synthetic Person%' AND j::text NOT LIKE '%123 Example Road%';
 ASSERT j::text NOT LIKE '%private.example%' AND j#>'{visual_work,0,receipts,1,amount}'='null';
 ASSERT j#>>'{visual_work,0,receipts,1,hours}'='3.5' AND j#>'{visual_work,0,receipts,0,hours}'='null';
 ASSERT j#>>'{work_records,0,item}'='Legacy control';
 ASSERT (SELECT public_text_hash=md5(pg_get_functiondef('public.public_text(text)'::regprocedure))
   AND legacy_hash=md5(pg_get_functiondef('public.vehicle_build_log_public(uuid)'::regprocedure))
   AND helper_acl IS NOT DISTINCT FROM (SELECT proacl FROM pg_proc WHERE oid='public.visual_work_build_log(uuid)'::regprocedure)
   FROM text_owner_before),'Existing global text/legacy readers and grants must remain unchanged';
 ASSERT public.public_text('Customer invoice') IS NULL,'Global policy remains unchanged';
 SELECT structured_data INTO saved FROM vehicle_observations WHERE extraction_method='visual_work_v1';
 UPDATE vehicle_observations SET structured_data=jsonb_set(saved,'{summary}',to_jsonb('   '::text)) WHERE extraction_method='visual_work_v1';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work'),'Blank required text still refuses';
 UPDATE vehicle_observations SET structured_data=jsonb_set(saved,'{summary}',to_jsonb(repeat('x',400))) WHERE extraction_method='visual_work_v1';
 ASSERT length(vehicle_build_log_public(v,false)#>>'{visual_work,0,summary}')=300,'Existing length bound remains';
 UPDATE vehicle_observations SET structured_data=saved WHERE extraction_method='visual_work_v1';
 UPDATE receipt_vehicle_links SET retired_at=now();
 j:=vehicle_build_log_public(v,false);
 ASSERT jsonb_array_length(j->'visual_work')=1 AND j#>'{visual_work,0,receipts}'='[]';
 UPDATE receipt_vehicle_links SET retired_at=NULL;
 UPDATE vehicle_images SET is_sensitive=true WHERE image_url LIKE '%before.jpg';
 ASSERT NOT (vehicle_build_log_public(v,false)?'visual_work'),'Current-source eligibility still controls the card';
 RAISE NOTICE 'visual work receipt text: real prior-veto reproduction, legitimate text, contact redaction, bounds, grants, amounts and withdrawal pass';
END $$;
