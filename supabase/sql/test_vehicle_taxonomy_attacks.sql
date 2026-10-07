\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Disposable database required'; END IF; END $$;
-- Actual private-table mutation attempt, not just catalog privilege metadata.
SET ROLE service_role;
DO $$ BEGIN
 BEGIN INSERT INTO vehicle_taxonomy_invalidations(vehicle_id) VALUES('11111111-1111-1111-1111-111111111111'); RAISE EXCEPTION 'raw ingress accepted';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS service direct ingress denied'; END;
 BEGIN TRUNCATE vehicle_taxonomy_revisions; RAISE EXCEPTION 'raw truncate accepted';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS service truncate denied'; END;
END $$;
RESET ROLE;
DO $$ DECLARE other_id bigint; BEGIN
 SELECT last_receipt_id INTO other_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='22222222-2222-2222-2222-222222222222';
 BEGIN UPDATE vehicle_taxonomy_recompute_queue SET last_receipt_id=other_id WHERE vehicle_id='11111111-1111-1111-1111-111111111111';
 RAISE EXCEPTION 'foreign receipt accepted'; EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS other-vehicle receipt pointer refused'; END;
END $$;
-- A legacy writer's contradictory computed output invalidates and is repaired.
UPDATE vehicles SET canonical_body_style='COUPE' WHERE id='11111111-1111-1111-1111-111111111111';
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'stale')::boolean,'contradictory output marked stale');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((read_vehicle_taxonomy_fold('11111111-1111-1111-1111-111111111111')->>'canonical_columns_match')::boolean,'contradictory output repaired');
-- A reference is withdrawn without deleting the raw source or old revision.
UPDATE vin_decoded_data SET raw_response='{"ErrorCode":"1,8"}',updated_at=clock_timestamp() WHERE vin='1AAAA000000000001';
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT canonical_body_style IS NULL AND canonical_vehicle_type IS NULL FROM vehicles WHERE id='33333333-3333-3333-3333-000000000001'),'withdrawn factory class withheld');
SELECT fixture_assert((SELECT body_type='Coupe' FROM vin_decoded_data WHERE vin='1AAAA000000000001'),'withdrawn raw source retained');
SELECT fixture_assert((SELECT count(*)=1 FROM vehicle_taxonomy_revisions WHERE vehicle_id='33333333-3333-3333-3333-000000000001' AND canonical_body_style='COUPE'),'earlier qualified revision retained');
-- Keyset pages are bounded even when keys have no physical binding.
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response) VALUES
 ('1FFFFFFFFFFFFFFF6','Coupe','PASSENGER CAR','{"ErrorCode":"0","VIN":"1AAAAAAAAAAAAAAA1"}'),
 ('1GGGGGGGGGGGGGGG7','Coupe','PASSENGER CAR','{"ErrorCode":"0","BodyClass":"Sedan"}');
SELECT fixture_assert(derive_vehicle_taxonomy('1FFFFFFFFFFFFFFF6',NULL)->>'reference_status'='raw_vin_binding','wrong raw VIN cannot qualify reference');
SELECT fixture_assert(derive_vehicle_taxonomy('1GGGGGGGGGGGGGGG7',NULL)->>'reference_status'='raw_projection_mismatch','typed/raw contradiction withheld');
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response)
 SELECT '9AAAA'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','{"ErrorCode":"0"}'::jsonb FROM generate_series(1,101) i;
SELECT replay_vehicle_taxonomy();
SELECT fixture_assert((drain_vehicle_taxonomy_queue()->>'cache_keys_seen')::integer=100,'replay seed bounded100');
SELECT fixture_assert((SELECT scan_completed_at IS NULL FROM vehicle_taxonomy_replay_state),'full key page is not exhaustion');
SELECT drain_vehicle_taxonomy_queue();
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT scan_completed_at IS NOT NULL FROM vehicle_taxonomy_replay_state),'short terminal page exhausts cursor');
-- Fail closed on a retained VIN with more than10 candidate physical parents.
INSERT INTO vehicles(id,vin) SELECT ('44444444-4444-4444-4444-'||lpad(i::text,12,'0'))::uuid,'SHORTBIND11' FROM generate_series(1,11) i;
INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,raw_response) VALUES('SHORTBIND11','Coupe','PASSENGER CAR','{"ErrorCode":"0"}');
SELECT fixture_assert((SELECT binding_overflow_events=1 FROM vehicle_taxonomy_replay_state),'binding overflow observable');
SELECT fixture_assert(assay_vehicle_taxonomy_fold()->>'status'='partial','binding overflow refuses completion claim');
SELECT drain_vehicle_taxonomy_queue();
SELECT fixture_assert((SELECT count(*)=11 FROM vehicles WHERE vin='SHORTBIND11' AND canonical_body_style IS NULL),'short/ambiguous reference never promoted');
