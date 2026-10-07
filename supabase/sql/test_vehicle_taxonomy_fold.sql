\set ON_ERROR_STOP on
\ir helpers/vehicle_taxonomy_fixture.sql
-- Existing raw/derived mismatch is seeded before the new trigger, not a production write.
INSERT INTO public.vehicles(id,vin) VALUES
 ('11111111-1111-1111-1111-111111111111','1AAAAAAAAAAAAAAA1'),
 ('22222222-2222-2222-2222-222222222222','1BBBBBBBBBBBBBBB2');
INSERT INTO public.vin_decoded_data(vin,body_type,vehicle_type,raw_response) VALUES
 ('1AAAAAAAAAAAAAAA1','Coupe','PASSENGER CAR','{"ErrorCode":"0"}'),
 ('1BBBBBBBBBBBBBBB2','Sedan','PASSENGER CAR','{"ErrorCode":"1,8"}');
\ir ../migrations/20261007223203_vehicle_taxonomy_recompute.sql
CREATE FUNCTION public.fixture_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
SELECT fixture_assert((SELECT canonical_body_style IS NULL FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'cache insert did not refresh old vehicle');
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1',NULL)->>'canonical_body_style'='COUPE','clean reference normalized');
SELECT fixture_assert(derive_vehicle_taxonomy('1BBBBBBBBBBBBBBB2',NULL)->>'canonical_body_style' IS NULL,'error reference withheld');
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1','pickup')->>'canonical_vehicle_type'='TRUCK','physical body has precedence');
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1','unrecognized')->>'canonical_body_style' IS NULL,'unrecognized physical style does not become factory coupe');
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1',NULL)->>'body_basis'='vin_factory_reference','factory basis labelled');
SELECT fixture_assert((derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1',NULL)->>'physical_configuration_verified')::boolean=false,'physical verification not invented');
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1','  ')->>'canonical_body_style'='COUPE','blank style allows qualified fallback');
SELECT fixture_assert(derive_vehicle_taxonomy('bad',NULL)->>'reference_status'='no_cache','missing cache explicit');
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response,decoded_at,provider) VALUES
 ('SHORT123456','Coupe','PASSENGER CAR','{"ErrorCode":"0"}',now(),'nhtsa'),
 ('1CCCCCCCCCCCCCCC3','Coupe','PASSENGER CAR','{}',now(),'nhtsa'),
 ('1DDDDDDDDDDDDDDD4','Coupe','PASSENGER CAR','{"ErrorCode":"0"}',now()+interval '1 day','nhtsa'),
 ('1EEEEEEEEEEEEEEE5','Coupe','PASSENGER CAR','{"ErrorCode":"0"}',now(),'other');
SELECT fixture_assert(derive_vehicle_taxonomy('SHORT123456',NULL)->>'reference_status'='invalid_vin','short reference withheld');
SELECT fixture_assert(derive_vehicle_taxonomy('1CCCCCCCCCCCCCCC3',NULL)->>'reference_status'='error_code','missing code withheld');
SELECT fixture_assert(derive_vehicle_taxonomy('1DDDDDDDDDDDDDDD4',NULL)->>'reference_status'='future_or_missing_clock','future clock withheld');
SELECT fixture_assert(derive_vehicle_taxonomy('1EEEEEEEEEEEEEEE5',NULL)->>'reference_status'='provider','other provider withheld');
SELECT fixture_assert(derive_vehicle_taxonomy('SHORT123456','sedan')->>'canonical_body_style'='SEDAN','physical style survives bad reference');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='partial','initial replay not prematurely passed');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT canonical_body_style='COUPE' FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'retained source reaches canonical column');
SELECT fixture_assert((SELECT fixture_updates=1 FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'one real update');
SELECT fixture_assert((SELECT canonical_body_style IS NULL AND fixture_updates=0 FROM vehicles WHERE id='22222222-2222-2222-2222-222222222222'),'negative reference receipt causes no fabricated update');
SELECT fixture_assert((SELECT count(*)=2 FROM vehicle_taxonomy_revisions),'two immutable input receipts');
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'stale')::boolean=false,'cached reader fresh');
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'canonical_columns_match')::boolean,'consumer equals canonical values');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='passed','completed fixture replay passes');
SELECT enqueue_vehicle_taxonomy('11111111-1111-1111-1111-111111111111');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT count(*)=2 FROM vehicle_taxonomy_revisions),'identical input reuses receipt');
SELECT fixture_assert((SELECT fixture_updates=1 FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'identical input avoids vehicle update');
UPDATE vin_decoded_data SET body_type='Sedan',raw_response=jsonb_set(raw_response,'{BodyClass}',to_jsonb('Sedan'::text)),updated_at=now() WHERE vin='1AAAAAAAAAAAAAAA1';
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'stale')::boolean,'cache correction invalidates');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT canonical_body_style='SEDAN' FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'correction reaches existing column');
SELECT fixture_assert((SELECT count(*)=3 FROM vehicle_taxonomy_revisions),'correction appends revision');
SELECT fixture_assert((SELECT count(*)=1 FROM vehicle_taxonomy_revisions WHERE canonical_body_style='COUPE'),'prior derived output retained');
UPDATE vehicles SET body_style='pickup' WHERE id='11111111-1111-1111-1111-111111111111';
SELECT fixture_assert((SELECT canonical_body_style='PICKUP' AND canonical_vehicle_type='TRUCK' FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'same helper governs original trigger');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT body_style='pickup' AND vin='1AAAAAAAAAAAAAAA1' FROM vehicles WHERE id='11111111-1111-1111-1111-111111111111'),'worker preserves raw input');
SELECT replay_vehicle_taxonomy();
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'stale')::boolean,'recipe generation makes old verification stale');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT count(*)=4 FROM vehicle_taxonomy_revisions),'replay keeps input revision idempotent');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='passed','new generation assayed');
DO $$ BEGIN
 BEGIN UPDATE vehicle_taxonomy_revisions SET receipt='{}'; RAISE EXCEPTION 'mutable receipt'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='mutable receipt' THEN RAISE; END IF; END;
 BEGIN DELETE FROM vehicle_taxonomy_revisions; RAISE EXCEPTION 'deletable receipt'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='deletable receipt' THEN RAISE; END IF; END;
END $$;
SELECT fixture_assert(NOT has_function_privilege('anon','public.drain_vehicle_taxonomy_queue()','EXECUTE'),'anonymous writer denied');
SELECT fixture_assert(NOT has_function_privilege('authenticated','public.replay_vehicle_taxonomy()','EXECUTE'),'authenticated replay denied');
SELECT fixture_assert(has_function_privilege('service_role','public.drain_vehicle_taxonomy_queue()','EXECUTE'),'service writer permitted');
SELECT fixture_assert(NOT has_table_privilege('service_role','public.vehicle_taxonomy_revisions','INSERT,UPDATE,DELETE,TRUNCATE'),'service raw revision mutation denied');
SELECT fixture_assert(NOT has_table_privilege('anon','public.vehicle_taxonomy_recompute_queue','SELECT'),'private operational state withheld');
SELECT fixture_assert((SELECT count(*)=29 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('vehicle_taxonomy_replay_state','vehicle_taxonomy_recompute_queue','vehicle_taxonomy_revisions','vehicle_taxonomy_invalidations') AND a.attnum>0 AND NOT a.attisdropped AND col_description(c.oid,a.attnum) IS NOT NULL),'all29 columns described');
SELECT fixture_assert((SELECT count(*)=6 FROM pipeline_registry),'owner registrations complete');
SELECT fixture_assert((SELECT command LIKE '%20s%' AND schedule='* * * * *' AND active FROM cron.job WHERE jobname='drain-vehicle-taxonomy'),'bounded standing cron');
SELECT fixture_assert((SELECT assay_status='passed' AND health_status='failed' FROM v_job_health WHERE jobname='drain-vehicle-taxonomy'),'no natural cron evidence not falsely healthy');
-- Real failing record statement; earlier receipts survive, retry/pause/resume tested.
CREATE FUNCTION fixture_fail_taxonomy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.body_style='fixture_fail' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fixture_fail_taxonomy BEFORE UPDATE OF canonical_body_style,canonical_vehicle_type ON vehicles FOR EACH ROW EXECUTE FUNCTION fixture_fail_taxonomy();
UPDATE vehicles SET body_style='fixture_fail' WHERE id='11111111-1111-1111-1111-111111111111';
UPDATE vehicles SET canonical_body_style='COUPE' WHERE id='22222222-2222-2222-2222-222222222222';
UPDATE vehicles SET body_style='fixture_fail' WHERE id='22222222-2222-2222-2222-222222222222';
SELECT drain_vehicle_taxonomy_queue();
-- First parent may already equal its trigger output; force stale fixture only by dropping fixture failure trigger temporarily in this DISPOSABLE test.
DROP TRIGGER fixture_fail_taxonomy ON vehicles;
UPDATE vehicles SET canonical_body_style='COUPE' WHERE id='11111111-1111-1111-1111-111111111111';
CREATE TRIGGER fixture_fail_taxonomy BEFORE UPDATE OF canonical_body_style,canonical_vehicle_type ON vehicles FOR EACH ROW EXECUTE FUNCTION fixture_fail_taxonomy();
SELECT enqueue_vehicle_taxonomy('11111111-1111-1111-1111-111111111111');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT consecutive_failures=1 AND next_due_at>now()+interval '14 minutes' FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111'),'failure backoff');
UPDATE vehicle_taxonomy_recompute_queue SET next_due_at=now() WHERE vehicle_id='11111111-1111-1111-1111-111111111111';
SELECT drain_vehicle_taxonomy_queue();
UPDATE vehicle_taxonomy_recompute_queue SET next_due_at=now() WHERE vehicle_id='11111111-1111-1111-1111-111111111111';
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT consecutive_failures=3 AND next_due_at IS NULL FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111'),'three failures pause');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='failed','assay observes real record failure');
UPDATE vehicles SET body_style='sedan' WHERE id='11111111-1111-1111-1111-111111111111';
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT consecutive_failures=0 AND last_error IS NULL FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='11111111-1111-1111-1111-111111111111'),'changed input resumes paused task');
SELECT fixture_assert((SELECT count(*)=0 FROM pg_stat_activity WHERE wait_event_type='Lock'),'no lock waits');
SET ROLE anon;
SELECT fixture_assert(derive_vehicle_taxonomy('1AAAAAAAAAAAAAAA1',NULL)->>'reference_status'='accepted','public calculation uses existing public reference access');
RESET ROLE;
-- New cache keys behind an exhausted cursor still flow through invalidation.
INSERT INTO vehicles(id,vin)
 SELECT ('33333333-3333-3333-3333-'||lpad(i::text,12,'0'))::uuid,'1AAAA'||lpad(i::text,12,'0') FROM generate_series(1,50) i;
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response)
 SELECT '1AAAA'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','{"ErrorCode":"0"}'::jsonb FROM generate_series(1,50) i;
SELECT fixture_assert((drain_vehicle_taxonomy_queue()->>'processed')::integer=25,'batch bounded25');
SELECT fixture_assert((SELECT count(*)=25 FROM vehicle_taxonomy_recompute_queue WHERE next_due_at IS NOT NULL),'remaining keys stay pending');
SELECT fixture_assert((drain_vehicle_taxonomy_queue()->>'processed')::integer=25,'second bounded batch drains');
SELECT fixture_assert((SELECT count(*)=50 FROM vehicles WHERE id::text LIKE '33333333-%' AND canonical_body_style='COUPE' AND fixture_updates=1),'all50 source cases reach columns once');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='passed','incremental behind-cursor coverage passes');
SELECT fixture_assert((SELECT count(*)=0 FROM vehicle_taxonomy_invalidations),'claimed invalidations consumed without self-loop');
SET ROLE service_role;
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'canonical_columns_match')::boolean,'service cached consumer permitted');
RESET ROLE;
