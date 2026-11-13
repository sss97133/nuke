-- Empty disposable database; synthetic sources only. Actual existing custody,
-- image-witness and build-log owners plus the new protected admission contract.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('test.role',true)$$;
CREATE TABLE vehicles(id uuid PRIMARY KEY,user_id uuid,owner_id uuid,uploaded_by uuid,is_public boolean,deleted_at timestamptz);
CREATE FUNCTION vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text,base_trust_score numeric DEFAULT .6,supported_observations text[] DEFAULT ARRAY['condition']);
CREATE TABLE subject_taxonomy(subject_id uuid PRIMARY KEY,subject_key text UNIQUE,display_name text,is_active boolean,domain text,category text);
CREATE TABLE condition_taxonomy(descriptor_id uuid PRIMARY KEY,canonical_key text,deprecated_at timestamptz);
CREATE TABLE observation_properties(id uuid PRIMARY KEY,property_key text,namespace text,data_type text,cardinality text,discriminator_key text,
 ratified_at timestamptz,deprecated_at timestamptz,applies_to_kinds text[],proposed_by_proposal_id uuid);
CREATE TABLE schema_proposals(id uuid PRIMARY KEY,proposal_type text,status text,payload jsonb);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,image_url text,taken_at timestamptz,exif_data jsonb,
 is_document boolean,is_sensitive boolean,redaction_level text,is_duplicate boolean,is_superseded boolean,vision_gate_status text,image_vehicle_match_status text);
ALTER TABLE vehicle_images ADD source text,ADD is_external boolean,ADD is_approved boolean,ADD approval_status text,ADD verification_status text,ADD user_id uuid;
-- Unrelated pending-BaT provenance is deliberately false in this source fixture;
-- the actual gallery owner is loaded verbatim below, not simplified here.
CREATE FUNCTION bat_pending_image_has_listing(uuid,jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,source_id uuid,source_url text,kind text,
 structured_data jsonb DEFAULT '{}',is_superseded boolean DEFAULT false,source_observation_id uuid,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),
 extraction_method text,property_id uuid,descriptor_id uuid,subject_type text DEFAULT 'vehicle',subject_id uuid,observed_at_basis text,
 source_event_at timestamptz,source_event_time_precision text,source_identifier text,raw_source_ref text,confidence_score numeric,
 content_text text,content_hash text,analysis_deferred boolean,submitted_by_user_id uuid,superseded_by uuid,superseded_at timestamptz,lineage_chain jsonb);
ALTER TABLE vehicle_observations ADD vehicle_match_confidence numeric,ADD vehicle_match_signals jsonb,ADD confidence text,ADD confidence_factors jsonb,
 ADD observer_raw jsonb,ADD extractor_id uuid,ADD extraction_metadata jsonb,ADD agent_tier text,ADD agent_model text,
 ADD agent_cost_cents numeric,ADD agent_duration_ms numeric,ADD citation_document_id uuid,ADD citation_secure_document_id uuid,
 ADD citation_page_number integer,ADD citation_excerpt text;
CREATE TABLE observation_witnesses(id uuid DEFAULT gen_random_uuid(),observation_id uuid REFERENCES vehicle_observations(id),image_id uuid REFERENCES vehicle_images(id),
 witness_role text,capture_method text,image_timestamp timestamptz,attestation_notes text,added_by_user_id uuid,added_by_agent_key text,
 UNIQUE(observation_id,image_id,witness_role));
CREATE TABLE vehicle_documents(id uuid PRIMARY KEY,vehicle_id uuid,file_url text);
CREATE TABLE receipts(id uuid PRIMARY KEY,source_document_table text,source_document_id uuid,currency text,is_superseded boolean,duplicate_of uuid);
CREATE TABLE receipt_items(id uuid PRIMARY KEY,receipt_id uuid,description text,part_number text,quantity numeric,total_price numeric);
CREATE TABLE receipt_vehicle_links(id uuid PRIMARY KEY,receipt_id uuid,vehicle_id uuid,status text,retired_at timestamptz,page_date date);
CREATE FUNCTION text_redact_contact(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
CREATE FUNCTION receipt_product_number(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT upper(btrim(coalesce($1,'')))$$;
CREATE FUNCTION receipt_product_eligible(text,text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT nullif($1,'') IS NOT NULL AND $2 !~* 'core (charge|exchange|return)'$$;
-- Existing catalog owner is an explicit controlled dependency here. No installed
-- unit is created from a stock card; the reader delegates its SKU/source policy.
CREATE FUNCTION receipt_item_product_card(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN $1='70000000-0000-4000-8000-000000000003' THEN
 '{"part_number":"153560","name":"Black windshield molding set","price_basis":"current_supplier_quote","quote_price":219.99,"currency":"USD","image_basis":"catalog_stock_image"}'::jsonb END$$;
CREATE FUNCTION public_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
CREATE FUNCTION retained_reported_work_matches(vehicle_observations,vehicle_observations) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION visual_work_build_log(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{"visual_work":[],"master_ledger":{"retained":true}}'::jsonb$$;
CREATE FUNCTION vehicle_build_log_public(uuid) RETURNS TABLE(observation_id uuid) LANGUAGE sql STABLE AS $$SELECT NULL::uuid WHERE false$$;
\ir fixtures/component_evidence_owners_20261111.sql
INSERT INTO schema_proposals VALUES
 ('4484d8cd-b6fd-41b0-bd00-4415cd58d7c9','add_property','approved','{"property_key":"component_visible_present","label":"Component presence in a qualified view","data_type":"boolean","unit":null,"namespace_request":"core","category":"component","applies_to_kinds":["condition"],"cardinality":"multi","discriminator_key":"component_subject_id","expected_source_categories":["internal"],"verification_scope":"instance","description":"Dated attributed image reading about one registered component position and an explicit view. True means visible present in that view. False requires explicit absence wording plus a scoped, qualified view; not visible and cannot tell are unanswered inspection outcomes, never false. The original reading, photo witness, selector, hash and analysis clock remain attached. Neither value establishes installation date, acquired-unit identity, originality, function, inspection or present-day state; multiple copies or derivations of one source are not independent agreement."}'),
 ('7e5032ee-d35f-4176-bc5e-45cc61fcf501','add_column','open','{"table":"vehicle_observations","columns":[{"column":"component_subject_id","type":"uuid","nullable":true,"references":"subject_taxonomy(subject_id)","keys_text_column":"structured_data.component_ref.key"}],"why":"Existing vehicle subject and property/condition registries lack a typed part-position reference. Reuse subject_taxonomy and source_observation_id; do not mint a unit, a new photo store or a parallel BOM.","rule":"Only the protected retained_component_reading_v1 path derives this FK from an active exact subject_key and binds the original retained analysis selector/hash and current canonical image witness. Same component position does not prove same physical unit across replacement.","writers":["ingest-observation","validate_retained_listing_property_source"],"readers":["vehicle_build_log_public"],"migration":"20261111161505_component_evidence_intake_and_fold.sql"}');
INSERT INTO observation_properties VALUES('90000000-0000-4000-8000-000000000001','component_visible_present','core','boolean','multi','component_subject_id',now(),NULL,ARRAY['condition'],'4484d8cd-b6fd-41b0-bd00-4415cd58d7c9');
\ir ../migrations/20261111161505_component_evidence_intake_and_fold.sql
CREATE TRIGGER retained_source BEFORE INSERT OR UPDATE ON vehicle_observations FOR EACH ROW EXECUTE FUNCTION validate_retained_listing_property_source();
CREATE TRIGGER image_witness AFTER INSERT ON vehicle_observations FOR EACH ROW EXECUTE FUNCTION project_observation_image_witness();
CREATE FUNCTION test_assert(value boolean,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF;END$$;
INSERT INTO vehicles VALUES('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',NULL,NULL,true,NULL);
INSERT INTO observation_sources(id,slug) VALUES('80000000-0000-4000-8000-000000000001','photo_pipeline');
INSERT INTO subject_taxonomy VALUES
 ('40000000-0000-4000-8000-000000000001','fluid.battery','Battery',true,'mechanical','fluid'),
 ('40000000-0000-4000-8000-000000000002','engine.alternator','Alternator',true,'mechanical','engine'),
 ('40000000-0000-4000-8000-000000000003','glass.windshield','Windshield',true,'exterior','glass');
INSERT INTO condition_taxonomy VALUES('90000000-0000-4000-8000-000000000002','exterior.glass.fracture',NULL);
INSERT INTO vehicle_images(id,vehicle_id,image_url,taken_at,vision_gate_status,exif_data)
 SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',
  'https://images.example/frame-'||n||'.jpg','2026-10-28 17:20Z','approved','{"capture_time_basis":"retained_exif_label"}' FROM generate_series(1,3)n;
INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,kind,structured_data,extraction_method,observed_at)
 SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
  'https://images.example/frame-'||n||'.jpg','condition',jsonb_build_object('image_id',('20000000-0000-4000-8000-'||lpad(n::text,12,'0')),
  'components_seen',jsonb_build_array(jsonb_build_object('label',CASE n WHEN 1 THEN 'Battery 78PRMJ' WHEN 2 THEN 'Alternator housing' ELSE 'Windshield with silver-gray molding' END,
   'bbox',jsonb_build_array(10,20,800,900),'part_number_guess',CASE WHEN n=1 THEN '78PRMJ' END))),
  'reviewed_image_analysis_v1','2026-11-10 16:25Z' FROM generate_series(1,3)n;
INSERT INTO vehicle_documents VALUES('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','https://private.example/receipt.pdf');
INSERT INTO receipts VALUES('60000000-0000-4000-8000-000000000001','vehicle_documents','50000000-0000-4000-8000-000000000001','USD',false,NULL);
INSERT INTO receipt_items VALUES
 ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Battery (SSB)','78PRMJ',1,313.54),
 ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','Core exchange (SSB)','78PRMJ',1,20),
 ('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','Black windshield molding set','153560',1,180);
INSERT INTO receipt_vehicle_links VALUES('a0000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','linked',NULL,'2025-09-10');
CREATE FUNCTION test_candidate(n integer,basis text DEFAULT 'same_component_role') RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('receipt_item_id',i.id,'receipt_id',r.id,'link_id',l.id,'source_id',r.source_document_id,'source_table',r.source_document_table,
 'source_url_sha256',encode(sha256(convert_to(d.file_url,'UTF8')),'hex'),'description',i.description,'part_number',i.part_number,'association_basis',basis)
 FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id JOIN receipt_vehicle_links l ON l.receipt_id=r.id JOIN vehicle_documents d ON d.id=r.source_document_id
 WHERE i.id=('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION test_component(n integer) RETURNS vehicle_observations LANGUAGE plpgsql AS $$
DECLARE c vehicle_observations; p vehicle_observations; s subject_taxonomy; q jsonb;
BEGIN
 SELECT * INTO p FROM vehicle_observations WHERE id=('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 SELECT * INTO s FROM subject_taxonomy WHERE subject_id=('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 c.id:=gen_random_uuid();c.vehicle_id:=p.vehicle_id;c.source_id:=p.source_id;c.source_url:=p.source_url;c.kind:='condition';c.is_superseded:=false;
 c.component_subject_id:=s.subject_id;c.source_observation_id:=p.id;c.observed_at:=p.observed_at;c.ingested_at:=now();c.extraction_method:='retained_component_reading_v1';
 c.property_id:='90000000-0000-4000-8000-000000000001';c.subject_type:='vehicle';c.observed_at_basis:='source_analysis_time';c.source_event_time_precision:='unknown';
 c.source_identifier:='retained_component_reading_v1:'||p.id||':'||s.subject_id||':component_visible_present';c.raw_source_ref:='vehicle_observations:'||p.id;
 c.confidence_score:=.6;c.content_text:=p.structured_data#>>'{components_seen,0,label}';c.analysis_deferred:=true;
 q:=jsonb_build_object('source_observation_id',p.id,'image_id',p.structured_data->>'image_id','source_url',p.source_url,'path',jsonb_build_array('components_seen','0','label'),
 'value_sha256',encode(sha256(convert_to(c.content_text,'UTF8')),'hex'),'quote',c.content_text,'bbox',p.structured_data#>'{components_seen,0,bbox}',
 'source_role','attributed_retained_image_reading','clock_basis','source_analysis_time','physical_unit_identity','unestablished');
 c.structured_data:=jsonb_build_object('image_id',p.structured_data->>'image_id','component_ref',jsonb_build_object('subject_id',s.subject_id,'key',s.subject_key,'identity_basis','position_only'),
 'component_reading',q,'property_key','component_visible_present','component_visible_present',true,'component_receipt_candidates',
 CASE n WHEN 1 THEN jsonb_build_array(test_candidate(1,'same_printed_part_number')) WHEN 3 THEN jsonb_build_array(test_candidate(3)) ELSE '[]'::jsonb END);
 RETURN c;
END$$;
SELECT set_config('test.role','service_role',false);
INSERT INTO vehicle_observations SELECT (test_component(n)).* FROM generate_series(1,3)n;
SELECT test_assert((SELECT count(*)=6 FROM observation_witnesses),'actual witness projector binds three original and three derived readings');
SELECT set_config('test.role','anon',false);
CREATE TEMP TABLE snapshot AS SELECT vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false) AS value;
SELECT test_assert(jsonb_array_length(value#>'{component_evidence,components}')=3,'three registered positions reach existing reader') FROM snapshot;
SELECT test_assert(value#>>'{component_evidence,expected_population,status}'='unknown','no fake population completion') FROM snapshot;
SELECT test_assert(value#>>'{master_ledger,retained}'='true' AND value->'work_records'='[]'::jsonb,'prior build-log and master ledger retained') FROM snapshot;
SELECT test_assert((SELECT count(*)=3 FROM jsonb_array_elements(value#>'{component_evidence,components}')c
 WHERE c#>>'{presence,readings,0,value}'='present' AND c#>>'{presence,readings,0,clock_basis}'='source_analysis_time'
 AND c->'inspection'='[]'::jsonb AND c->'reported_work'='[]'::jsonb),'presence is dated attribution, no invented install/test') FROM snapshot;
SELECT test_assert(NOT jsonb_path_exists(value,'$.**.documented_amount ? (@ != null)'),'private receipt amounts masked') FROM snapshot;
SELECT test_assert(value::text NOT LIKE '%private.example%','private receipt source URL withheld') FROM snapshot;
SELECT test_assert((SELECT c#>>'{purchase_candidates,0,installation_status}'='unestablished' AND c#>>'{purchase_candidates,0,product,part_number}'='153560'
 FROM jsonb_array_elements(value#>'{component_evidence,components}')c WHERE c->>'component_key'='glass.windshield'),
 'black stock candidate and silver observed molding remain ambiguous candidate, no contradiction or installation') FROM snapshot;
-- Independent receipt source withdrawal does not erase the photograph reading.
UPDATE vehicle_documents SET file_url='https://private.example/replaced.pdf';
SELECT test_assert((SELECT bool_and(c->'purchase_candidates'='[]'::jsonb) FROM jsonb_array_elements(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')c),'receipt replacement withholds old candidate');
UPDATE vehicle_documents SET file_url='https://private.example/receipt.pdf';
UPDATE receipt_vehicle_links SET vehicle_id='10000000-0000-4000-8000-000000000099';
SELECT test_assert((SELECT bool_and(c->'purchase_candidates'='[]'::jsonb) FROM jsonb_array_elements(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')c),'wrong-car receipt link cannot attach a purchase');
DO $$DECLARE c vehicle_observations; BEGIN PERFORM set_config('test.role','service_role',true);c:=test_component(1);
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'wrong-car receipt admitted';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;
UPDATE receipt_vehicle_links SET vehicle_id='10000000-0000-4000-8000-000000000001';
DO $$DECLARE c vehicle_observations; BEGIN
 PERFORM set_config('test.role','service_role',true);
 c:=test_component(1);c.structured_data:=jsonb_set(c.structured_data,'{component_receipt_candidates}',jsonb_build_array(test_candidate(2,'same_printed_part_number')));
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'core exchange accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 c:=test_component(1);c.structured_data:=jsonb_set(c.structured_data,'{component_receipt_candidates}',jsonb_build_array(test_candidate(3,'same_printed_part_number')));
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'wrong SKU accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 c:=test_component(1);c.structured_data:=jsonb_set(c.structured_data,'{component_visible_present}','"not_visible"');
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'unknown presence accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 c:=test_component(1);c.structured_data:=jsonb_set(c.structured_data,'{component_reading,value_sha256}',to_jsonb(repeat('0',64)));
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'changed hash accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;
-- An explicit scoped absence remains an attributed dated reading. Uncertainty,
-- wrong subject scope and a whole-image state never become negative presence.
DO $$DECLARE c vehicle_observations; q jsonb; notes text; invalid_notes text; phrase text; BEGIN
 PERFORM set_config('test.role','service_role',true);
 notes:='Alternator mounting location is fully visible. Alternator is absent.';
 UPDATE vehicle_observations SET structured_data=structured_data||jsonb_build_object('agent_notes',notes)
 WHERE id='30000000-0000-4000-8000-000000000002';
 c:=test_component(2);c.content_text:=notes;
 q:=c.structured_data->'component_reading';q:=q||jsonb_build_object('path',jsonb_build_array('agent_notes'),
  'value_sha256',encode(sha256(convert_to(notes,'UTF8')),'hex'),'quote',notes,'absence',jsonb_build_object('scope','engine.alternator',
  'view_coverage_quote','Alternator mounting location is fully visible.','absence_quote','Alternator is absent.','bbox',q->'bbox'));
 c.structured_data:=c.structured_data||jsonb_build_object('component_reading',q,'component_visible_present',false);
 INSERT INTO vehicle_observations SELECT c.*;
 PERFORM test_assert(component_reading_current(c.id),'explicit qualified absence accepted');
 c.id:=gen_random_uuid();c.structured_data:=jsonb_set(c.structured_data,'{component_reading,absence,scope}','"fluid.battery"');
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'wrong absence scope accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 invalid_notes:='Alternator mounting location is fully visible. Cannot tell if alternator is missing.';
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{agent_notes}',to_jsonb(invalid_notes))
 WHERE id='30000000-0000-4000-8000-000000000002';
 c.id:=gen_random_uuid();c.content_text:=invalid_notes;q:=q||jsonb_build_object('quote',invalid_notes,'value_sha256',encode(sha256(convert_to(invalid_notes,'UTF8')),'hex'));
 q:=jsonb_set(q,'{absence,absence_quote}','"Cannot tell if alternator is missing."');
 c.structured_data:=jsonb_set(c.structured_data,'{component_reading}',q);
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'uncertainty became absence';EXCEPTION WHEN check_violation THEN NULL;END;
 FOREACH phrase IN ARRAY ARRAY['Alternator is not missing.','No evidence Alternator has been removed.','It is unknown whether Alternator is absent.'] LOOP
  invalid_notes:='Alternator mounting location is fully visible. '||phrase;
  UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{agent_notes}',to_jsonb(invalid_notes))
   WHERE id='30000000-0000-4000-8000-000000000002';
  c.id:=gen_random_uuid();c.content_text:=invalid_notes;
  q:=q||jsonb_build_object('quote',invalid_notes,'value_sha256',encode(sha256(convert_to(invalid_notes,'UTF8')),'hex'));
  -- Include both a full negated sentence and a misleading affirmative substring.
  q:=jsonb_set(q,'{absence,absence_quote}',to_jsonb(CASE WHEN phrase LIKE 'No evidence%' THEN 'Alternator has been removed.' ELSE phrase END));
  c.structured_data:=jsonb_set(c.structured_data,'{component_reading}',q);
  BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'negated or hypothetical absence admitted';EXCEPTION WHEN check_violation THEN NULL;END;
 END LOOP;
 -- Restoring an immutable source is only test setup. Production corrections
 -- append/supersede; the reader nevertheless detects direct source drift.
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{agent_notes}',to_jsonb(notes))
 WHERE id='30000000-0000-4000-8000-000000000002';
END$$;
DO $$DECLARE c vehicle_observations; q jsonb; BEGIN
 PERFORM set_config('test.role','service_role',true);
 UPDATE vehicle_observations SET structured_data=structured_data||'{"damage_localized":[{"label":"Glass crack","bbox":[10,20,800,900]}]}'::jsonb
 WHERE id='30000000-0000-4000-8000-000000000003';
 c:=test_component(3);c.property_id:=NULL;c.descriptor_id:='90000000-0000-4000-8000-000000000002';c.content_text:='Glass crack';
 c.source_identifier:='retained_component_reading_v1:'||c.source_observation_id||':'||c.component_subject_id||':exterior.glass.fracture';
 q:=c.structured_data->'component_reading';q:=q||jsonb_build_object('path',jsonb_build_array('damage_localized','0','label'),
  'quote','Glass crack','value_sha256',encode(sha256(convert_to('Glass crack','UTF8')),'hex'));
 c.structured_data:=(c.structured_data-'component_visible_present')||jsonb_build_object('property_key',NULL,'component_reading',q);
 INSERT INTO vehicle_observations SELECT c.*;
 PERFORM test_assert(component_reading_current(c.id),'correct subject-grain condition descriptor accepted');
 c.id:=gen_random_uuid();c.component_subject_id:='40000000-0000-4000-8000-000000000002';
 c.structured_data:=jsonb_set(c.structured_data,'{component_ref}','{"subject_id":"40000000-0000-4000-8000-000000000002","key":"engine.alternator","identity_basis":"position_only"}');
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'glass descriptor attached to alternator';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;
DO $$DECLARE c vehicle_observations; result jsonb; BEGIN
 PERFORM set_config('test.role','service_role',true);c:=test_component(1);INSERT INTO vehicle_observations SELECT c.*;
 SELECT x INTO result FROM jsonb_array_elements(vehicle_build_log_public(c.vehicle_id,false)#>'{component_evidence,components}')x WHERE x->>'component_key'='fluid.battery';
 PERFORM test_assert(jsonb_array_length(result#>'{presence,readings}')=1 AND jsonb_array_length(result#>'{presence,readings,0,observation_ids}')=2,'repeat keying folds once, retains all rows');
 PERFORM test_assert(result#>>'{presence,readings,0,agreement_status}'='not_established','repeat keying does not manufacture agreement');
 BEGIN UPDATE vehicle_observations SET component_subject_id='40000000-0000-4000-8000-000000000002' WHERE id=c.id;
 RAISE EXCEPTION 'component identity mutated';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;
-- Current source mutations remove qualified rows, preserving original history.
DO $$DECLARE old_count int; field text; BEGIN
 SELECT count(*) INTO old_count FROM vehicle_observations;
 FOREACH field IN ARRAY ARRAY['is_sensitive','is_duplicate','is_superseded','is_document'] LOOP
  EXECUTE format('UPDATE vehicle_images SET %I=true WHERE id=$1',field) USING '20000000-0000-4000-8000-000000000001'::uuid;
  PERFORM test_assert(jsonb_array_length(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')=2,'source flag withdrawal');
  EXECUTE format('UPDATE vehicle_images SET %I=false WHERE id=$1',field) USING '20000000-0000-4000-8000-000000000001'::uuid;
 END LOOP;
 UPDATE vehicle_images SET image_url='https://images.example/replacement.jpg' WHERE id='20000000-0000-4000-8000-000000000001';
 PERFORM test_assert(jsonb_array_length(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')=2,'URL replacement withdrawal');
 UPDATE vehicle_images SET image_url='https://images.example/frame-1.jpg' WHERE id='20000000-0000-4000-8000-000000000001';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='30000000-0000-4000-8000-000000000001';
 PERFORM test_assert(jsonb_array_length(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')=2,'source supersession withdrawal');
 PERFORM test_assert((SELECT count(*)=old_count FROM vehicle_observations),'withdrawal preserves history');
END$$;
UPDATE vehicles SET is_public=false;
SELECT test_assert(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)->'component_evidence' IS NULL,'private vehicle no component leak');
UPDATE vehicles SET is_public=true;
UPDATE vehicle_observations SET is_superseded=false WHERE id='30000000-0000-4000-8000-000000000001';
-- A concurrent source write is refused under the exact image-first admission
-- lock, then the committed withdrawal is refused by the same current-source test.
CREATE EXTENSION IF NOT EXISTS dblink;
SELECT dblink_connect('component_race',format('dbname=%L host=%L port=%L user=%L',current_database(),
 split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user));
SELECT dblink_exec('component_race','BEGIN');
SELECT * FROM dblink('component_race','SELECT id::text FROM public.vehicle_images WHERE id=''20000000-0000-4000-8000-000000000001'' FOR UPDATE') AS t(id text);
DO $$DECLARE c vehicle_observations;BEGIN PERFORM set_config('test.role','service_role',true);c:=test_component(1);
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'concurrent source lock bypassed';EXCEPTION WHEN lock_not_available THEN NULL;END;
END$$;
SELECT dblink_exec('component_race','UPDATE public.vehicle_images SET vehicle_id=NULL WHERE id=''20000000-0000-4000-8000-000000000001''');
SELECT dblink_exec('component_race','COMMIT');
SELECT dblink_disconnect('component_race');
DO $$DECLARE c vehicle_observations;BEGIN PERFORM set_config('test.role','service_role',true);c:=test_component(1);
 BEGIN INSERT INTO vehicle_observations SELECT c.*;RAISE EXCEPTION 'withdrawn image admitted';EXCEPTION WHEN check_violation THEN NULL;END;
END$$;
UPDATE vehicle_images SET vehicle_id='10000000-0000-4000-8000-000000000001' WHERE id='20000000-0000-4000-8000-000000000001';
-- The public existing reader runs; the private guard utility is not a new public
-- query surface. No existing grants are broadened.
SET ROLE anon;
SELECT test_assert(jsonb_array_length(vehicle_build_log_public('10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')=3,'anonymous existing reader works');
DO $$ BEGIN
 BEGIN PERFORM component_reading_current('30000000-0000-4000-8000-000000000001');RAISE EXCEPTION 'private guard utility public';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
SELECT 'component evidence fixture PASS' AS result;
