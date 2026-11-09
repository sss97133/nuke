-- Real PG17, empty disposable database. No live source records or provider calls.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,make text,model text,year integer,vin text,canonical_body_style text);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,image_url text,is_superseded boolean);
CREATE TABLE public.field_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,field_name text,
 proposed_value text,source_type text,source_confidence numeric,extraction_context text,raw_extraction_data jsonb,
 status text DEFAULT 'pending',UNIQUE(vehicle_id,field_name,source_type,proposed_value));
CREATE TABLE public.canonical_body_styles(canonical_name text PRIMARY KEY,display_name text,vehicle_type text,aliases text[],description text,is_active boolean);
CREATE FUNCTION public.normalize_make(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
\ir ../migrations/20261023000000_vehicle_identifiers.sql
\ir ../migrations/20261023000700_identifier_rules_pre1981_seed.sql
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.auth_uid',true),'')::uuid$$;
ALTER TABLE vehicles ADD COLUMN is_public boolean DEFAULT true, ADD COLUMN user_id uuid, ADD COLUMN owner_id uuid,
 ADD COLUMN uploaded_by uuid, ADD COLUMN status text, ADD COLUMN deleted_at timestamptz;
ALTER TABLE vehicle_images ADD COLUMN is_sensitive boolean, ADD COLUMN is_duplicate boolean,
 ADD COLUMN vision_gate_status text, ADD COLUMN image_vehicle_match_status text;
ALTER TABLE vehicle_identifiers ADD COLUMN evidence_class text, ADD COLUMN contributor_id uuid,
 ADD COLUMN source_observation_id uuid, ADD COLUMN independence_key text;
CREATE TABLE contributor_trust(contributor_id uuid,family text,trust_mean numeric);
\ir fixtures/identifier_consensus_before_atomic.sql
\ir ../migrations/20261109200000_atomic_photo_identifier_citation.sql

INSERT INTO vehicles(id,make,model,year,vin) VALUES('11111111-1111-1111-1111-111111111111','Pontiac','Firebird',1973,'2S87D3N000001');
INSERT INTO vehicle_images(id,vehicle_id,image_url,is_superseded) VALUES('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','https://example.invalid/plate.jpg',false);
CREATE FUNCTION public.fixture_vin_read() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('identifiers',jsonb_build_array(jsonb_build_object('kind','vin','value','2S87D3N000001',
   'quote','Dash plate reads 2S87D3N000001','confidence',0.79)),
   'cited_vin',jsonb_build_object('admission_basis','pre1981_physical_plate','evidence_role','vehicle_vin_plate',
   'checksum_ok',NULL,'checksum_status','not_applicable_pre1981','confidence',0.97,
   'model_year_context',1973,'identifier_rule_id',r.rule_id,'identifier_rule_series',r.series,'prompt_version','fixture'))
 FROM identifier_rule_for('Pontiac','Firebird','vin','2S87D3N000001') r
$$;
CREATE FUNCTION public.fixture_land(p_read jsonb DEFAULT fixture_vin_read()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT land_identifier_claims('11111111-1111-1111-1111-111111111111',p_read,'https://example.invalid/plate.jpg',
 'photo-pipeline-fixture','photo','22222222-2222-2222-2222-222222222222',NULL)
$$;

-- Actual concurrent sessions: a withdrawal owns the photo lock before admission
-- reaches it. Admission must wait, reread the committed attachment and refuse.
CREATE EXTENSION dblink;
DO $$ DECLARE connection text; result jsonb; waiting boolean := false; BEGIN
 connection:=format('dbname=%L host=%L port=%L user=%L',current_database(),
   split_part(current_setting('unix_socket_directories'),',',1),current_setting('port'),current_user);
 PERFORM dblink_connect('withdraw',connection);
 PERFORM dblink_connect('admit',connection||' application_name=atomic_vin_fixture');
 PERFORM dblink_exec('withdraw','BEGIN');
 PERFORM dblink_exec('withdraw',$q$UPDATE vehicle_images SET vehicle_id=NULL WHERE id='22222222-2222-2222-2222-222222222222'$q$);
 PERFORM dblink_send_query('admit','SELECT fixture_land()');
 FOR i IN 1..100 LOOP
  SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='atomic_vin_fixture' AND wait_event_type='Lock') INTO waiting;
  EXIT WHEN waiting;
  PERFORM pg_sleep(0.01);
 END LOOP;
 ASSERT waiting,'admission must wait for the physical source row lock';
 -- Image bookkeeping updates the parent while still holding the image lock.
 -- Vehicle-first admission would block this update or form a deadlock.
 PERFORM dblink_exec('withdraw','SET LOCAL statement_timeout=500');
 PERFORM dblink_exec('withdraw','UPDATE vehicles SET model=model');
 PERFORM dblink_exec('withdraw','COMMIT');
 SELECT value INTO result FROM dblink_get_result('admit') AS t(value jsonb);
 ASSERT result->>'status'='source_image_changed',result::text;
 ASSERT NOT EXISTS(SELECT FROM field_evidence) AND NOT EXISTS(SELECT FROM vehicle_identifiers),'withdrawn source writes neither collection';
 PERFORM dblink_disconnect('admit'); PERFORM dblink_disconnect('withdraw');
 RAISE NOTICE 'PASS: concurrent source withdrawal refuses both evidence and identifier writes';
END $$;


UPDATE vehicle_images SET vehicle_id='11111111-1111-1111-1111-111111111111';

DO $$ DECLARE result jsonb; bad jsonb; BEGIN
 UPDATE vehicle_images SET image_url='https://example.invalid/replacement.jpg';
 result:=fixture_land(); ASSERT result->>'status'='source_image_changed','old text cannot cite replacement image bytes';
 UPDATE vehicle_images SET image_url='https://example.invalid/plate.jpg';
 UPDATE vehicles SET year=1974;
 result:=fixture_land(); ASSERT result->>'status'='vin_context_changed',result::text;
 UPDATE vehicles SET year=1973,vin='2S87D3N000002';
 result:=fixture_land(); ASSERT result->>'status'='vin_context_changed',result::text;
 UPDATE vehicles SET vin='2S87D3N000001';
 bad:=jsonb_set(fixture_vin_read(),'{cited_vin,evidence_role}','"body_tag"');
 result:=fixture_land(bad); ASSERT result->>'status'='invalid_vin_citation',result::text;
 ASSERT NOT EXISTS(SELECT FROM field_evidence) AND NOT EXISTS(SELECT FROM vehicle_identifiers);
 result:=fixture_land();
 ASSERT result->>'status'='ok' AND result->>'field_evidence'='1' AND result->>'identifiers'='1',result::text;
 ASSERT (SELECT status='pending' AND proposed_value='2S87D3N000001'
   AND raw_extraction_data->>'photo_id'='22222222-2222-2222-2222-222222222222'
   AND raw_extraction_data->>'quote'='Dash plate reads 2S87D3N000001'
   AND raw_extraction_data->>'checksum_status'='not_applicable_pre1981' FROM field_evidence);
 ASSERT (SELECT source_image_id='22222222-2222-2222-2222-222222222222' AND value='2S87D3N000001' FROM vehicle_identifiers);
 result:=fixture_land(); ASSERT result->>'field_evidence'='0' AND result->>'identifiers'='0','replay is idempotent';
 ASSERT (SELECT vin='2S87D3N000001' FROM vehicles),'canonical VIN unchanged';
 RAISE NOTICE 'PASS: current context, literal source, atomic inserts and idempotence';
END $$;

-- A failed identifier insert rolls back the earlier field-evidence insert.
CREATE FUNCTION public.fixture_reject_identifier() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture rejection'; END$$;
CREATE TRIGGER fixture_reject_identifier BEFORE INSERT ON vehicle_identifiers FOR EACH ROW EXECUTE FUNCTION fixture_reject_identifier();
DO $$ DECLARE before_evidence integer; before_ids integer; reading jsonb; BEGIN
 SELECT count(*) INTO before_evidence FROM field_evidence; SELECT count(*) INTO before_ids FROM vehicle_identifiers;
 UPDATE vehicles SET vin=NULL;
 reading:=jsonb_set(jsonb_set(fixture_vin_read(),'{identifiers,0,value}','"2S87D3N000003"'),'{identifiers,0,quote}','"Dash plate reads 2S87D3N000003"');
 BEGIN
  PERFORM fixture_land(reading); RAISE EXCEPTION 'expected fixture rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'fixture rejection' THEN RAISE; END IF;
 END;
 ASSERT (SELECT count(*) FROM field_evidence)=before_evidence AND (SELECT count(*) FROM vehicle_identifiers)=before_ids,'neither half may survive a failed transaction';
END $$;
DROP TRIGGER fixture_reject_identifier ON vehicle_identifiers;
DO $$ DECLARE result jsonb; BEGIN
 result:=fixture_land('{"identifiers":[{"kind":"vin","value":"1HGCM82633A004352","quote":"modern plate","confidence":0.79}]}');
 ASSERT result->>'status'='ok' AND result->>'identifiers'='1' AND result->>'field_evidence'='0','legacy modern envelope preserved';
 ASSERT NOT has_function_privilege('anon','land_identifier_claims(uuid,jsonb,text,text,text,uuid,uuid)','EXECUTE');
 RAISE NOTICE 'PASS: no public write access or modern input change';
END $$;

-- A later withdrawal removes photo authority at read time while retaining the
-- testimony and any independent document/listing claim.
DO $$ DECLARE result jsonb; BEGIN
 PERFORM land_identifier_claims('11111111-1111-1111-1111-111111111111',
  '{"identifiers":[{"kind":"vin","value":"2S87D3N000001","quote":"listing text","confidence":0.7}]}',
  'https://example.invalid/listing','fixture','listing_text',NULL,NULL);
 result:=identifier_consensus('11111111-1111-1111-1111-111111111111','vin');
 ASSERT EXISTS(SELECT FROM jsonb_array_elements(result->'values') e WHERE (e->>'images')::int>0),'valid current photos retained';
 UPDATE vehicle_images SET vehicle_id=NULL;
 result:=identifier_consensus('11111111-1111-1111-1111-111111111111','vin');
 ASSERT jsonb_array_length(result->'values')=1 AND result->'values'->0->>'images'='0','withdrawn photo loses authority, independent text remains';
 ASSERT (SELECT count(*) FROM vehicle_identifiers WHERE source_kind='photo')=2,'source testimony remains intact';
 UPDATE vehicle_images SET vehicle_id='11111111-1111-1111-1111-111111111111',image_url='https://example.invalid/replacement.jpg';
 result:=identifier_consensus('11111111-1111-1111-1111-111111111111','vin');
 ASSERT result->'values'->0->>'images'='0','replacement image is not authority for the former image reading';
 UPDATE vehicle_images SET image_url='https://example.invalid/plate.jpg';
 UPDATE vehicle_images SET vehicle_id='11111111-1111-1111-1111-111111111111',is_sensitive=true;
 result:=identifier_consensus('11111111-1111-1111-1111-111111111111','vin');
 ASSERT result->'values'->0->>'images'='0','inaccessible photo is not public identifier authority';
 UPDATE vehicle_images SET is_sensitive=false,is_superseded=true;
 result:=identifier_consensus('11111111-1111-1111-1111-111111111111','vin');
 ASSERT result->'values'->0->>'images'='0','superseded photo is withdrawn';
 UPDATE vehicle_images SET is_superseded=false;
 UPDATE vehicles SET is_public=false,user_id='33333333-3333-3333-3333-333333333333';
 ASSERT identifier_consensus('11111111-1111-1111-1111-111111111111','vin') IS NULL,'unrelated viewer cannot read private vehicle';
 PERFORM set_config('test.auth_uid','33333333-3333-3333-3333-333333333333',true);
 ASSERT identifier_consensus('11111111-1111-1111-1111-111111111111','vin') IS NOT NULL,'existing owner access retained';
 PERFORM set_config('test.auth_uid','',true);
 UPDATE vehicles SET is_public=true,deleted_at=now();
 ASSERT identifier_consensus('11111111-1111-1111-1111-111111111111','vin') IS NULL,'deleted vehicle excluded from public read';
 RAISE NOTICE 'PASS: later source withdrawal, independent testimony and access boundaries';
END $$;
