\set ON_ERROR_STOP on
\ir helpers/vehicle_taxonomy_fixture.sql
ALTER TABLE vehicles ADD COLUMN is_public boolean DEFAULT true,ADD COLUMN listing_kind text DEFAULT 'vehicle';
CREATE TYPE public.observation_kind AS ENUM('specification','provenance','condition');
CREATE TABLE observation_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,
 supported_observations public.observation_kind[]);
INSERT INTO observation_sources(slug,supported_observations) VALUES('nhtsa',ARRAY['specification','provenance']::public.observation_kind[]);
CREATE TABLE observation_extractors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid REFERENCES observation_sources,
 slug text UNIQUE,display_name text,extractor_type text,edge_function_name text,extractor_config jsonb,
 produces_kinds public.observation_kind[],is_active boolean,schedule_type text,rate_limit_per_hour integer,min_interval_seconds integer);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid REFERENCES vehicles,
 source_id uuid REFERENCES observation_sources,kind public.observation_kind,observed_at timestamptz,
 ingested_at timestamptz DEFAULT now(),is_superseded boolean DEFAULT false,structured_data jsonb,
 extraction_method text,agent_cost_cents integer,subject_type text DEFAULT 'vehicle',subject_id uuid,property_id uuid,
 source_identifier text,source_url text,raw_source_ref text,content_hash text UNIQUE,extraction_metadata jsonb,
 extractor_id uuid REFERENCES observation_extractors,UNIQUE(source_id,source_identifier,kind));
GRANT SELECT,INSERT,UPDATE ON vehicle_observations TO service_role;
GRANT SELECT ON observation_sources,observation_extractors TO service_role;
\ir ../migrations/20261007223203_vehicle_taxonomy_recompute.sql
-- Exercise the same already-extended health CTE prefix as production.
DO $$ BEGIN EXECUTE 'CREATE OR REPLACE VIEW v_job_health AS '||replace(pg_get_viewdef('v_job_health'::regclass,true),
 'WITH taxonomy_assay AS MATERIALIZED (','WITH bat_sale_assay AS MATERIALIZED (SELECT ''partial''::text AS status), taxonomy_assay AS MATERIALIZED ('); END $$;
\ir ../migrations/20261008023725_retained_vin_reference_intake.sql
CREATE FUNCTION fixture_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
CREATE FUNCTION fixture_reject(sql text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % rejected (%)',label,SQLSTATE; RETURN; END;
 RAISE EXCEPTION 'FAIL % allowed',label; END $$;
SELECT fixture_assert(assay_vin_reference_intake()->>'status'='partial','unstarted source scan is partial');
UPDATE vehicle_taxonomy_replay_state SET vin_reference_started_at=now()-interval '31 minutes';
SELECT fixture_assert(assay_vin_reference_intake()->>'status'='failed','never-started intake stall visible');
UPDATE vehicle_taxonomy_replay_state SET vin_reference_started_at=now();
INSERT INTO vehicles(id,vin) VALUES('10000000-0000-0000-0000-000000000001','1G1YY22G015000001');
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,decoded_at,updated_at,raw_response) VALUES
 ('1G1YY22G015000001','Coupe','PASSENGER CAR','2026-10-01 12:00:00.123456+00','2026-10-01 12:00:01.654321+00',
 '{"VIN":"1G1YY22G015000001","ErrorCode":"0","Make":"CHEVROLET","Model":"Corvette","ModelYear":"2001","BodyClass":"Coupe","VehicleType":"PASSENGER CAR","EngineCylinders":"8","DisplacementL":"5.7","Doors":"2","EngineHP":"unknown","DriveType":"Not Applicable"}');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT count(*)=1 FROM vin_reference_intake_queue),'new revision automatically queued');
SELECT fixture_assert((SELECT count(*)=2 FROM pg_constraint WHERE conrelid='vehicle_observations'::regclass
 AND conname IN('observation_source_vin_fkey','observation_vin_own_revision') AND contype='f' AND NOT convalidated),
 'new nullable source FKs enforce bindings without historical table scan');
SELECT fixture_assert((SELECT source_id=(SELECT id FROM observation_sources WHERE slug='nhtsa') AND
 produces_kinds=ARRAY['specification']::observation_kind[] AND edge_function_name='batch-vin-decode'
 FROM observation_extractors WHERE slug='retained-vin-reference-v1'),'registered typed existing worker route');
SELECT fixture_assert((SELECT schedule='*/15 * * * *' AND active AND command LIKE '%"batch_size":20%'
 FROM cron.job WHERE jobname='qualify-retained-vin-references'),'bounded natural15min job');
SELECT fixture_assert((SELECT assay_status='partial' AND health_status='failed' FROM v_job_health
 WHERE jobname='qualify-retained-vin-references'),'health requires natural execution');
SELECT fixture_assert((SELECT count(*)=18 FROM pg_attribute a WHERE a.attrelid IN
 ('vin_reference_intake_queue'::regclass,'vehicle_observations'::regclass,'vehicle_taxonomy_replay_state'::regclass)
 AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN('revision_id','vehicle_id','status','attempts','next_attempt_at','created_at',
 'locked_by','locked_at','observation_id','completed_at','last_error','source_vin','source_vin_taxonomy_revision_id',
 'vin_reference_revision_cursor','vin_reference_keys_seen','vin_reference_started_at','vin_reference_last_seed_at','vin_reference_scan_completed_at')
 AND col_description(a.attrelid,a.attnum) IS NOT NULL),'new shape columns described');
CREATE TEMP TABLE claim AS SELECT * FROM claim_vin_reference_intake('fixture-worker',20);
SELECT fixture_assert((SELECT count(*)=1 FROM claim),'one qualified reference claimed');
SELECT fixture_assert((SELECT count(*)=0 FROM claim_vin_reference_intake('other-worker',20)),'claims disjoint');
SELECT fixture_assert((SELECT vin_reference_scan_completed_at IS NOT NULL AND vin_reference_keys_seen=1
 FROM vehicle_taxonomy_replay_state),'actual finite source scan complete');
SELECT fixture_assert(NOT finish_vin_reference_intake((SELECT revision_id::bigint FROM claim),'wrong-worker','skipped',NULL,'fixture_reason'),'wrong lease cannot complete');
SELECT fixture_reject(format('SELECT finish_vin_reference_intake(%s,''fixture-worker'',''done'',%L,NULL)',
 (SELECT revision_id FROM claim),'20000000-0000-0000-0000-000000000001'),'HTTP success without persisted result');

-- Synthetic canonical payload, independently specified expected projection.
CREATE FUNCTION fixture_vin_observation(p_revision bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r record; c record; receipt jsonb; identifier text; o uuid;
BEGIN
 SELECT * INTO r FROM vehicle_taxonomy_revisions WHERE id=p_revision;
 SELECT * INTO c FROM vin_decoded_data WHERE vin=r.cache_vin;
 receipt:=jsonb_build_object('method','protected_retained_vin_reference_v1','role','factory_reference',
 'vehicle_id',r.vehicle_id,'cache_vin',c.vin,'source_sha256',r.receipt#>>'{input,raw_sha256}',
 'source_recorded_at',c.decoded_at,'recorded_clock_basis','retained_provider_decode_recording_not_manufacture_or_physical_observation',
 'physical_configuration_verified',false,'field_namespace','nhtsa_vpic_values',
 'fields',jsonb_build_object('Make','CHEVROLET','Model','Corvette','ModelYear','2001','BodyClass',c.body_type,
 'VehicleType',c.vehicle_type,'EngineCylinders','8','DisplacementL','5.7','Doors','2'),
 'field_exclusions','{}'::jsonb,'raw_reference',c.raw_response);
 identifier:='retained-vin:'||r.vehicle_id||':'||c.vin||':'||(r.receipt#>>'{input,raw_sha256}')||':'||((extract(epoch FROM c.decoded_at)*1000000)::bigint)::text;
 INSERT INTO vehicle_observations(vehicle_id,source_id,kind,observed_at,structured_data,extraction_method,agent_cost_cents,
 source_identifier,source_url,raw_source_ref,content_hash,extractor_id,source_vin,source_vin_taxonomy_revision_id,extraction_metadata)
 VALUES(r.vehicle_id,(SELECT id FROM observation_sources WHERE slug='nhtsa'),'specification',c.decoded_at,
 jsonb_build_object('vin_reference_receipt',receipt),'protected_retained_vin_reference_v1',0,identifier,
 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'||c.vin||'?format=json','vin_decoded_data:'||c.vin,
 md5(identifier),(SELECT id FROM observation_extractors WHERE slug='retained-vin-reference-v1'),c.vin,p_revision,
 jsonb_build_object('supporting_taxonomy_revision_id',p_revision::text,'cache_updated_at',c.updated_at))
 ON CONFLICT(source_id,source_identifier,kind) DO NOTHING RETURNING id INTO o;
 RETURN coalesce(o,(SELECT id FROM vehicle_observations WHERE source_identifier=identifier));
END $$;
CREATE TEMP TABLE admitted AS SELECT fixture_vin_observation((SELECT revision_id::bigint FROM claim)) id;
SELECT fixture_assert(finish_vin_reference_intake((SELECT revision_id::bigint FROM claim),'fixture-worker','done',(SELECT id FROM admitted)),'persisted canonical result completes');
SELECT fixture_assert(NOT finish_vin_reference_intake((SELECT revision_id::bigint FROM claim),'fixture-worker','done',(SELECT id FROM admitted)),'completion CAS single use');
SELECT fixture_assert(assay_vin_reference_intake()->>'status'='passed','completed known source slice passes');
SELECT fixture_assert((read_vehicle_taxonomy_fold('10000000-0000-0000-0000-000000000001')#>>'{factory_reference,stale}')::boolean=false,'existing cached reader includes fresh factory reference');
SELECT fixture_assert((SELECT observed_at='2026-10-01 12:00:00.123456+00' AND ingested_at>observed_at
 AND source_vin='1G1YY22G015000001' AND source_vin_taxonomy_revision_id=(SELECT revision_id::bigint FROM claim)
 AND structured_data#>'{vin_reference_receipt,physical_configuration_verified}'='false' FROM vehicle_observations),'typed source and original microsecond clock');
SELECT fixture_reject('UPDATE vehicle_observations SET source_vin=NULL,source_vin_taxonomy_revision_id=NULL,extraction_method=NULL','protected source cannot escape binding');
SELECT fixture_reject('UPDATE vehicle_observations SET structured_data=''{}''','receipt immutable');
SELECT fixture_reject('UPDATE vehicle_observations SET property_id=gen_random_uuid()','factory reference cannot become physical property');
SELECT fixture_reject('UPDATE vin_reference_intake_queue SET vehicle_id=gen_random_uuid()','work parent immutable');
-- Processing-only change creates another revision, not another factory source fact.
UPDATE vehicles SET body_style='pickup' WHERE id='10000000-0000-0000-0000-000000000001';
SELECT drain_vehicle_taxonomy_queue();
CREATE TEMP TABLE later_claim AS SELECT * FROM claim_vin_reference_intake('later-worker',20);
SELECT fixture_assert((SELECT count(*)=1 FROM later_claim),'new processing revision queued');
SELECT fixture_assert(fixture_vin_observation((SELECT revision_id::bigint FROM later_claim))=(SELECT id FROM admitted),'same retained source reuses canonical observation');
SELECT fixture_assert(finish_vin_reference_intake((SELECT revision_id::bigint FROM later_claim),'later-worker','done',(SELECT id FROM admitted)),'later revision may bind original supporting FK');
SELECT fixture_assert((assay_vin_reference_intake()#>>'{counts,completed_work}')::integer=2 AND
 (assay_vin_reference_intake()#>>'{counts,canonical_observations}')::integer=1,'work and distinct observation counts separated');
SELECT fixture_assert((SELECT body_style='pickup' AND canonical_body_style='PICKUP' FROM vehicles),'raw physical input retained');
-- A source correction appends, preserving old testimony and allowing supersession.
UPDATE vin_decoded_data SET body_type='Sedan',raw_response=jsonb_set(raw_response,'{BodyClass}','"Sedan"'),updated_at=now() WHERE vin='1G1YY22G015000001';
SELECT fixture_assert((read_vehicle_taxonomy_fold('10000000-0000-0000-0000-000000000001')#>>'{factory_reference,stale}')::boolean,'cached source correction immediately stale');
UPDATE vehicle_observations SET is_superseded=true WHERE id=(SELECT id FROM admitted);
SELECT drain_vehicle_taxonomy_queue();
CREATE TEMP TABLE corrected_claim AS SELECT * FROM claim_vin_reference_intake('corrected-worker',20);
CREATE TEMP TABLE corrected AS SELECT fixture_vin_observation((SELECT revision_id::bigint FROM corrected_claim)) id;
SELECT fixture_assert((SELECT id FROM corrected)<>(SELECT id FROM admitted),'changed source creates new canonical fact');
SELECT fixture_assert(finish_vin_reference_intake((SELECT revision_id::bigint FROM corrected_claim),'corrected-worker','done',(SELECT id FROM corrected)),'corrected source completes');
SELECT fixture_assert(assay_vin_reference_intake()->>'status'='passed','historical changed receipts do not make current assay permanently stale');
-- New parent visibility causes an explicit rechecked refusal, not an insertion.
UPDATE vehicles SET body_style='sedan' WHERE id='10000000-0000-0000-0000-000000000001';
SELECT drain_vehicle_taxonomy_queue();
CREATE TEMP TABLE refused_claim AS SELECT * FROM claim_vin_reference_intake('refused-worker',20);
UPDATE vehicles SET is_public=false WHERE id='10000000-0000-0000-0000-000000000001';
SELECT fixture_reject(format('SELECT fixture_vin_observation(%s)',(SELECT revision_id FROM refused_claim)),'private parent withheld');
SELECT fixture_assert(finish_vin_reference_intake((SELECT revision_id::bigint FROM refused_claim),'refused-worker','skipped',NULL,'parent_not_public_real_vehicle'),'explicit source refusal completes');
SELECT fixture_assert((SELECT status='skipped' AND attempts=0 AND observation_id IS NULL AND next_attempt_at>now()+interval '23 hours'
 FROM vin_reference_intake_queue WHERE revision_id=(SELECT revision_id::bigint FROM refused_claim)),'semantic refusal rechecks daily without transient failure');
UPDATE vehicles SET is_public=true WHERE id='10000000-0000-0000-0000-000000000001';
UPDATE vin_reference_intake_queue SET next_attempt_at=now() WHERE status='skipped';
CREATE TEMP TABLE retry_claim AS SELECT * FROM claim_vin_reference_intake('retry-worker',20);
SELECT fixture_assert(finish_vin_reference_intake((SELECT revision_id::bigint FROM retry_claim),'retry-worker','retry',NULL,'batch_budget_deferred'),'unstarted work deferred');
SELECT fixture_assert((SELECT attempts=0 AND status='pending' FROM vin_reference_intake_queue WHERE revision_id=(SELECT revision_id::bigint FROM retry_claim)),'budget deferral does not burn retry');
DO $$ DECLARE i integer; r bigint:=(SELECT revision_id::bigint FROM retry_claim); BEGIN FOR i IN 1..3 LOOP
 UPDATE vin_reference_intake_queue SET next_attempt_at=now() WHERE revision_id=r;
 PERFORM * FROM claim_vin_reference_intake('failure-worker',20);
 PERFORM fixture_assert(finish_vin_reference_intake(r,'failure-worker','retry',NULL,'intake_request_failed'),'transient completion');
 END LOOP; END $$;
SELECT fixture_assert((SELECT status='failed' AND attempts=3 FROM vin_reference_intake_queue WHERE revision_id=(SELECT revision_id::bigint FROM retry_claim)),'three transient failures pause');
SELECT fixture_assert(assay_vin_reference_intake()->>'status'='failed','pause visible to health assay');
SELECT fixture_assert(NOT has_table_privilege('service_role','vin_reference_intake_queue','INSERT,UPDATE,DELETE,TRUNCATE'),'service raw queue mutations denied');
SELECT fixture_assert(NOT has_table_privilege('anon','vin_reference_intake_queue','SELECT'),'anonymous queue reads denied');
SELECT fixture_assert(NOT has_function_privilege('anon','read_retained_vin_reference_input(bigint)','EXECUTE') AND
 NOT has_function_privilege('authenticated','claim_vin_reference_intake(text,integer)','EXECUTE'),'API helper and worker writes restricted');
SELECT fixture_assert(NOT has_function_privilege('service_role','seed_vin_reference_revisions()','EXECUTE'),'internal seed not a public service bypass');
GRANT SELECT ON claim TO service_role;
SET ROLE service_role;
SELECT fixture_assert((read_retained_vin_reference_input((SELECT revision_id::bigint FROM claim))#>>'{cache,provider}')='nhtsa','service source reader permitted');
RESET ROLE;
-- Fifty newly retained inputs exercise actual bounded claims and lease recovery.
INSERT INTO vehicles(id,vin) SELECT ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '1GAAA'||lpad(i::text,12,'0') FROM generate_series(1,50) i;
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response)
 SELECT '1GAAA'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','{"ErrorCode":"0"}'::jsonb FROM generate_series(1,50) i;
SELECT drain_vehicle_taxonomy_queue();
SELECT drain_vehicle_taxonomy_queue();
CREATE TEMP TABLE bounded_one AS SELECT * FROM claim_vin_reference_intake('bounded-one',20);
CREATE TEMP TABLE bounded_two AS SELECT * FROM claim_vin_reference_intake('bounded-two',20);
SELECT fixture_assert((SELECT count(*)=20 FROM bounded_one) AND(SELECT count(*)=20 FROM bounded_two),'each real claim bounded20');
SELECT fixture_assert(NOT EXISTS(SELECT 1 FROM bounded_one a JOIN bounded_two b USING(revision_id)),'claimed batches disjoint');
SELECT fixture_assert((SELECT count(*)=10 FROM vin_reference_intake_queue WHERE status='pending'),'unclaimed work retained');
SELECT fixture_assert(NOT vin_reference_result_matches((SELECT revision_id::bigint FROM bounded_one LIMIT 1),(SELECT id FROM corrected)),'other parent canonical result refused');
UPDATE vin_reference_intake_queue SET locked_at=now()-interval '11 minutes',attempts=3
 WHERE revision_id IN(SELECT revision_id::bigint FROM bounded_one LIMIT 10);
UPDATE vin_reference_intake_queue SET locked_at=now()-interval '11 minutes'
 WHERE revision_id IN(SELECT revision_id::bigint FROM bounded_one) AND attempts=1;
SELECT * FROM claim_vin_reference_intake('lease-recovery',20);
SELECT fixture_assert((SELECT count(*)=10 FROM vin_reference_intake_queue WHERE last_error='lease_expired' AND status='failed'), 'exhausted leases pause');
SELECT fixture_assert((SELECT count(*)=10 FROM vin_reference_intake_queue WHERE last_error='lease_expired' AND status='pending' AND next_attempt_at>now()+interval '14 minutes'), 'expired leases recover with backoff');
SELECT fixture_assert(NOT finish_vin_reference_intake((SELECT revision_id::bigint FROM bounded_one LIMIT 1),'bounded-one','skipped',NULL,'fixture_reason'),'expired lease cannot complete');
