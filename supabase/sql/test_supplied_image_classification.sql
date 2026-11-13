-- Existing real projection/hint/landing owners, disposable PostgreSQL only.
-- The handler fixture proves intake payload/order; this proves the DB trigger
-- consequences of its source-bound coarse projection and subsequent deep read.
\ir test_reviewed_image_analysis.sql

DO $test$
DECLARE vid uuid='20000000-0000-4000-8000-000000000091';
 iid uuid='10000000-0000-4000-8000-000000000091'; history uuid;
 old_version timestamptz; old_classification jsonb; corrected jsonb; deep uuid; n int;
BEGIN
 INSERT INTO vehicles(id,make,model) VALUES(vid,'Fixture make','Fixture model');
 old_classification='{"image_type":"vehicle_interior","confidence":0.95,"vehicle_hints":{"make":"Other make"},"description":"Prior contradictory badge interpretation","classifier_receipt":{"model":"prior-reader"}}';
 corrected='{"image_type":"vehicle_interior","confidence":0.9,"vehicle_hints":{},"description":"Cabin with a bird emblem visible","classifier_receipt":{"model":"reader:interactive-review","prompt_version":"v98"},"v2":{"vehicle_fields":[],"text_lines":[{"text":"R 1 3","confidence":0.9}]}}';
 INSERT INTO vehicle_images(id,vehicle_id,image_url,source,vision_gate_status,ai_scan_metadata)
 VALUES(iid,vid,'https://example.invalid/supplied-cabin.jpg','capture_relay_ios','approved',jsonb_build_object('classification',old_classification,'processing_policy',jsonb_build_object('mode','subscription_review')));
 -- Reproduce the former handler order: processing receipt sees stale hints.
 UPDATE vehicle_images SET ai_scan_metadata=ai_scan_metadata||'{"photo_pipeline":{"receipt":{"outcome":"processing"}}}' WHERE id=iid;
 ASSERT (SELECT vehicle_id IS NULL FROM vehicle_images WHERE id=iid),'old processing-first order unfiles the source';
 -- Fixture setup restores attribution without changing testimony or the guard.
 UPDATE vehicle_images SET vehicle_id=vid WHERE id=iid;
 SELECT updated_at INTO old_version FROM vehicle_images WHERE id=iid;
 -- Same source-only observation shape emitted by the actual handler test.
 INSERT INTO vehicle_observations(vehicle_id,kind,source_id,source_url,source_identifier,observed_at,
   content_text,agent_model,extraction_method,analysis_deferred,structured_data,extraction_metadata)
 SELECT NULL,'media',id,'https://example.invalid/supplied-cabin.jpg','synthetic-supplied-revision',now(),
  corrected->>'description','fixture-model','supplied_image_classification_v1',true,
  jsonb_build_object('source_image_id',iid,'source_vehicle_id',vid,'classification',corrected,'previous_classification',old_classification),
  jsonb_build_object('source',jsonb_build_object('image_url','https://example.invalid/supplied-cabin.jpg','expected_updated_at',old_version))
 FROM observation_sources WHERE slug='photo_pipeline' RETURNING id INTO history;
 UPDATE vehicle_images SET ai_processing_status='completed',ai_scan_metadata=ai_scan_metadata||
  jsonb_build_object('classification',corrected,'classification_review',jsonb_build_object('observation_id',history,'source_identifier','synthetic-supplied-revision'))
 WHERE id=iid AND updated_at=old_version;
 GET DIAGNOSTICS n=ROW_COUNT;
 ASSERT n=1 AND (SELECT vehicle_id=vid AND user_confirmed_vehicle=false FROM vehicle_images WHERE id=iid),'corrected supplied reading survives the unchanged source hint guard';
 ASSERT (SELECT structured_data->'previous_classification'=old_classification AND vehicle_id IS NULL AND analysis_deferred FROM vehicle_observations WHERE id=history),'old reading retained as attributed source history, not a current vehicle fact';
 ASSERT NOT EXISTS(SELECT FROM observation_witnesses WHERE observation_id=history),'source-only history does not invent same-car physical authority';
 ASSERT NOT EXISTS(SELECT FROM field_evidence WHERE vehicle_id=vid),'coarse classification promotes no generic specification';
 ASSERT NOT EXISTS(SELECT FROM vehicle_image_attribution_queue WHERE image_id=iid),'classification does not enqueue identity filing';
 ASSERT (SELECT ai_scan_metadata#>>'{processing_policy,mode}'='subscription_review' FROM vehicle_images WHERE id=iid),'unrelated intake provenance survives';
 ASSERT EXISTS(SELECT FROM photo_text_lines WHERE image_id=iid AND text='R 1 3'),'literal source text still reaches the established landing reader';
 deep=fixture_review(iid,md5('supplied')||md5('supplied'),NULL,'body_interior');
 PERFORM project_reviewed_image_analysis(deep);
 ASSERT EXISTS(SELECT FROM get_image_deep_analysis(iid)),'corrected classification permits the existing deep intake and reader';
 -- A stale supplied version is not silently refreshed after another write.
 UPDATE vehicle_images SET ai_scan_metadata=ai_scan_metadata||'{"unrelated_receipt":true}' WHERE id=iid;
 UPDATE vehicle_images SET ai_scan_metadata=ai_scan_metadata||'{"should_not_land":true}' WHERE id=iid AND updated_at=old_version;
 GET DIAGNOSTICS n=ROW_COUNT;
 ASSERT n=0 AND NOT (SELECT ai_scan_metadata?'should_not_land' FROM vehicle_images WHERE id=iid),'stale source CAS refuses without changing current metadata';
 RAISE NOTICE 'PASS: stale-hint reproduction, retained before-image, coarse landing, source CAS and actual deep reader';
END $test$;
