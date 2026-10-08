#!/usr/bin/env python3
"""Real protected source -> cached typed property, without new testimony."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008095444_expose_factory_displacement_property.sql'
vehicle = '10000000-0000-0000-0000-000000000001'
vin = '1G1YY22G015000001'


def query(sql):
    r = subprocess.run(command + ['-c', sql], capture_output=True, text=True, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def apply(error=None):
    r = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=15)
    if error:
        assert r.returncode != 0 and error in r.stderr, r.stderr
    else:
        assert r.returncode == 0, r.stderr


def read():
    return json.loads(query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')"))


query("""CREATE TABLE observation_properties(id uuid PRIMARY KEY,property_key text UNIQUE,
 namespace text,data_type text,unit text,verification_scope text,cardinality text,
 applies_to_kinds observation_kind[],deprecated_at timestamptz);
 INSERT INTO observation_properties VALUES('66000000-0000-0000-0000-000000000001',
 'engine_displacement_l','core','numeric','liters','class','single',ARRAY['specification']::observation_kind[],NULL);
 GRANT SELECT ON observation_properties TO service_role;""")
snapshot_sql = """SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),
 md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY revision_id)::text FROM vin_reference_intake_queue q)),
 md5((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM vehicle_taxonomy_revisions r)),
 md5((SELECT jsonb_agg(to_jsonb(v) ORDER BY id)::text FROM vehicles v)),
 md5((SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid)::text FROM cron.job j))"""
snapshot = query(snapshot_sql)
before = read()
metadata_sql = "SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef,'volatility',provolatile) FROM pg_proc WHERE oid='read_vehicle_taxonomy_fold(uuid)'::regprocedure"
metadata = query(metadata_sql)
apply()
new_definition = query("SELECT pg_get_functiondef('read_vehicle_taxonomy_fold(uuid)'::regprocedure)")
print('Reader SHA:', query("SELECT encode(sha256(convert_to(pg_get_functiondef('read_vehicle_taxonomy_fold(uuid)'::regprocedure),'UTF8')),'base64')"), flush=True)
after = read()
projection = after['factory_reference'].pop('property_projections')['engine_displacement_l']
assert after == before, 'All existing reader fields must retain their semantics'
assert projection['value'] == 5.7 and projection['data_type'] == 'numeric' and projection['unit'] == 'liters'
assert projection['verification_scope'] == 'class' and projection['claim_role'] == 'factory_reference'
assert projection['physical_configuration_verified'] is False and projection['source_value'] == '5.7'
assert projection['source_observation_id'] == before['factory_reference']['observation_id']
receipt = before['factory_reference']['receipt']
for key in ('source_sha256', 'source_recorded_at', 'recorded_clock_basis'):
    assert projection[key] == receipt[key]
assert projection['ingested_at'] == before['factory_reference']['ingested_at']
assert projection['supporting_taxonomy_revision_id'] == before['factory_reference']['supporting_taxonomy_revision_id']
assert query(snapshot_sql) == snapshot, 'Migration must not move data, work or source clocks'
assert query(metadata_sql) == metadata, 'Reader owner/ACL/security/config/volatility changed'
assert json.loads(query(f"SET ROLE service_role;SELECT read_vehicle_taxonomy_fold('{vehicle}')"))['factory_reference']['property_projections']
assert query("SELECT bool_and(NOT has_function_privilege(r,'read_vehicle_taxonomy_fold(uuid)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated'])r") == 't'
assert json.loads(query("SELECT read_vehicle_taxonomy_fold('99000000-0000-0000-0000-000000000099')")) == {'status': 'not_queued', 'stale': True}
apply()
assert query(snapshot_sql) == snapshot, 'Idempotent replay must not ingest'
query("CREATE OR REPLACE FUNCTION read_vehicle_taxonomy_fold(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$")
apply('Taxonomy reader owner changed')
query(new_definition)

# Registry edits cannot turn a class reference into instance testimony, an enum,
# another unit or a deprecated property, even after this migration was deployed.
for change in ("unit='cc'", "verification_scope='instance'", "data_type='enum'",
               "cardinality='many'", "namespace='other'", "deprecated_at=now()",
               "applies_to_kinds=ARRAY['condition']::observation_kind[]"):
    query('UPDATE observation_properties SET ' + change)
    assert read()['factory_reference']['property_projections'] == {}, change
    apply('Factory displacement property contract changed')
    query("UPDATE observation_properties SET unit='liters',verification_scope='class',data_type='numeric',cardinality='single',namespace='core',deprecated_at=NULL,applies_to_kinds=ARRAY['specification']::observation_kind[]")

query(f"UPDATE vehicles SET is_public=false WHERE id='{vehicle}'")
assert read()['factory_reference']['stale'] is True and read()['factory_reference']['property_projections'] == {}
query(f"UPDATE vehicles SET is_public=true WHERE id='{vehicle}'")
observation = before['factory_reference']['observation_id']
query(f"UPDATE vehicle_observations SET is_superseded=true WHERE id='{observation}'")
assert read()['factory_reference']['property_projections'] == {}
query(f"UPDATE vehicle_observations SET is_superseded=false WHERE id='{observation}'")

# The real source producer/CAS admits a changed valid value. The former source
# stays retained; a stale source is unusable before the replacement completes.
query("""UPDATE vin_reference_intake_queue SET status='skipped',locked_by=NULL,locked_at=NULL,
 observation_id=NULL,completed_at=NULL,next_attempt_at=now()+interval '1 day',last_error='fixture_deferred'
 WHERE status<>'done';""")
fixture = query("SELECT pg_get_functiondef('fixture_vin_observation(bigint)'::regprocedure)")
original_fixture = fixture
assert "'DisplacementL','5.7'" in fixture
query(fixture.replace("'DisplacementL','5.7'", "'DisplacementL',c.raw_response->>'DisplacementL'"))
for expected in ('5.7000', '6.12345678901234567890123456789', '0.000001'):
    query(f"UPDATE vin_decoded_data SET raw_response=jsonb_set(raw_response,'{{DisplacementL}}',to_jsonb('{expected}'::text)),updated_at=clock_timestamp() WHERE vin='{vin}'")
    assert read()['factory_reference']['stale'] is True and read()['factory_reference']['property_projections'] == {}
    query('SELECT drain_vehicle_taxonomy_queue()')
    revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
    assert query("SELECT revision_id FROM claim_vin_reference_intake('property-fixture',1)") == revision
    replacement = query(f'SELECT fixture_vin_observation({revision})')
    assert query(f"SELECT finish_vin_reference_intake({revision},'property-fixture','done','{replacement}')") == 't'
    assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')#>>'{{factory_reference,property_projections,engine_displacement_l,value}}'") == expected
    assert read()['factory_reference']['property_projections']['engine_displacement_l']['source_observation_id'] == replacement

# An absent field is a qualified receipt with no property. Unit-bearing text and
# malformed/zero values invalidate old custody rather than becoming measurements.
query(f"UPDATE vin_decoded_data SET raw_response=raw_response-'DisplacementL',updated_at=clock_timestamp() WHERE vin='{vin}'")
query('SELECT drain_vehicle_taxonomy_queue()')
fixture = query("SELECT pg_get_functiondef('fixture_vin_observation(bigint)'::regprocedure)")
query(fixture.replace(",'DisplacementL',c.raw_response->>'DisplacementL'", ''))
revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
assert query("SELECT revision_id FROM claim_vin_reference_intake('missing-fixture',1)") == revision
replacement = query(f'SELECT fixture_vin_observation({revision})')
assert query(f"SELECT finish_vin_reference_intake({revision},'missing-fixture','done','{replacement}')") == 't'
assert read()['factory_reference']['stale'] is False and read()['factory_reference']['property_projections'] == {}
for invalid in ('0', '-1', '5.7L', '1e3', 'NaN', '1' * 65):
    query(f"UPDATE vin_decoded_data SET raw_response=jsonb_set(raw_response,'{{DisplacementL}}',to_jsonb('{invalid}'::text)),updated_at=clock_timestamp() WHERE vin='{vin}'")
    assert read()['factory_reference']['stale'] is True and read()['factory_reference']['property_projections'] == {}

# Leave the shared disposable fixture's canonical producer/source contract ready
# for the existing subsequent cadence, bulk and health checks in this CI job.
query(original_fixture)
query(f"UPDATE vin_decoded_data SET raw_response=jsonb_set(raw_response,'{{DisplacementL}}',to_jsonb('5.7'::text)),updated_at=clock_timestamp() WHERE vin='{vin}'")
query('SELECT drain_vehicle_taxonomy_queue()')
revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
assert query("SELECT revision_id FROM claim_vin_reference_intake('restore-fixture',1)") == revision
replacement = query(f'SELECT fixture_vin_observation({revision})')
assert query(f"SELECT finish_vin_reference_intake({revision},'restore-fixture','done','{replacement}')") == 't'

assert query(f"SELECT count(*) FROM vehicle_observations WHERE id='{observation}'") == '1', 'Original evidence retained'
assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'") == '0'
print('PASS typed liters/class consumer, exact source/recording/ingestion clocks, unchanged existing reader, data/ACL/replay/drift guards, registry/visibility/supersession withdrawal, source correction precision, missing/invalid values and retained history')
