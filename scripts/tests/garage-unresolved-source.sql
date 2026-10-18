-- Extend the real isolated correction fixture; no production connection.
\ir garage-owner-corrections.sql
\ir ../../supabase/migrations/20261008080000_garage_unresolved_source_statements.sql
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','authenticated',false);
CREATE FUNCTION fixture_unresolved(label text DEFAULT 'Synthetic shared vehicle') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('unresolved_vehicle',jsonb_build_object('label',label,'stated_roles',jsonb_build_array('shared_interest'))) $$;
CREATE TEMP TABLE fixture_unresolved_result(id uuid);
INSERT INTO fixture_unresolved_result SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001',NULL,'00000000-0000-4000-8000-000000000060',
 fixture_unresolved(),'This is a shared vehicle; its exact identity is unresolved');
SELECT fixture_assert((SELECT vehicle_id IS NULL AND property_id IS NULL FROM vehicle_observations WHERE id=(SELECT id FROM fixture_unresolved_result)),
 'unresolved source invents neither vehicle nor core property');
SELECT fixture_assert((SELECT count(*) FROM vehicles)=1,'raw subject does not mint a vehicle');
SELECT fixture_assert((SELECT count(*) FROM vehicle_canonical)=0,'unresolved private source is not canonical');
SELECT fixture_assert((SELECT id FROM fixture_unresolved_result)=record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001',NULL,'00000000-0000-4000-8000-000000000060',
 fixture_unresolved(),'This is a shared vehicle; its exact identity is unresolved'),'stable raw source replay');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001',NULL,'00000000-0000-4000-8000-000000000061',
 fixture_claim('owner_current'),'Cannot assert an identified property without an identity')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000061',
 fixture_unresolved(),'Cannot label an identified asset as unresolved')$q$,'23514');
SELECT fixture_fails($q$SELECT record_garage_owner_correction(
 '00000000-0000-4000-8000-000000000001',NULL,'00000000-0000-4000-8000-000000000061',
 fixture_unresolved(repeat('x',161)),'Bounded label')$q$,'23514');
SET ROLE authenticated;
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections())=2,'existing clients remain identified-only');
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections(p_include_unresolved=>true))=3,'new account reader sees pending source beside identified corrections');
SELECT fixture_assert((SELECT source_excerpt FROM get_my_garage_owner_corrections(p_include_unresolved=>true) WHERE vehicle_id IS NULL)
 ='This is a shared vehicle; its exact identity is unresolved','exact source excerpt reaches account reader');
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000002',false);
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections('00000000-0000-4000-8000-000000000001',true))=0,'other account cannot read raw source');
RESET ROLE;
SELECT set_config('fixture.user_id','00000000-0000-4000-8000-000000000001',false);
-- Identification is a new explicitly sourced statement, not an edit or nearest-model match.
SELECT record_garage_owner_correction('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',
 '00000000-0000-4000-8000-000000000062',fixture_claim('shared_interest'),'Explicitly identified shared vehicle',NULL,(SELECT id FROM fixture_unresolved_result));
SELECT fixture_assert((SELECT vehicle_id IS NULL AND property_id IS NULL AND is_superseded IS TRUE FROM vehicle_observations WHERE id=(SELECT id FROM fixture_unresolved_result)),
 'identification preserves original unresolved source');
SELECT fixture_assert((SELECT count(*) FROM get_my_garage_owner_corrections(p_include_unresolved=>true) WHERE vehicle_id IS NULL)=0,'superseded raw subject leaves pending projection');
SELECT set_config('fixture.user_id','',false);
SELECT set_config('fixture.role','service_role',false);
SELECT fixture_fails($q$SELECT record_garage_owner_correction('00000000-0000-4000-8000-000000000002',NULL,
 '00000000-0000-4000-8000-000000000063',fixture_unresolved(),'Service must cite actual owner authorization')$q$,'42501');
SELECT 'PASS: raw unresolved source, compatibility, privacy, replay and explicitly identified supersession';
