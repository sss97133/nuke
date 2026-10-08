#!/usr/bin/env python3
"""Actual PG reader: exact counters, bounded validators, no forged completeness."""
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
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008062447_bound_retained_vin_intake_health.sql'


def query(sql):
    result = subprocess.run(command + ['-c', sql], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def apply(error=None):
    p = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=15)
    if error:
        assert p.returncode != 0 and error in p.stderr, p.stderr
    else:
        assert p.returncode == 0, p.stderr


assert query('SELECT current_database()') == database
snapshot_sql = """SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),
 md5((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM vehicle_taxonomy_revisions r)),
 md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY revision_id)::text FROM vin_reference_intake_queue q)),
 md5((SELECT jsonb_agg(to_jsonb(s))::text FROM vehicle_taxonomy_replay_state s)),
 md5((SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid)::text FROM cron.job j))"""
snapshot = query(snapshot_sql)
apply()
apply()
assert query(snapshot_sql) == snapshot, 'Reader migration cannot drive ingestion or change clocks/work'
new_definition = query("SELECT pg_get_functiondef('assay_vin_reference_intake()'::regprocedure)")
query("CREATE OR REPLACE FUNCTION assay_vin_reference_intake() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT '{}'::jsonb $$")
apply('assay body drifted')
query(new_definition)

# Existing adversarial fixture work stays explicitly deferred. Add a closed
# synthetic source slice through the real taxonomy producer and receipt CAS.
query("""UPDATE vin_reference_intake_queue SET status='skipped',attempts=0,locked_by=NULL,locked_at=NULL,
 observation_id=NULL,completed_at=NULL,next_attempt_at=now()+interval '1 day',last_error='fixture_existing_work_deferred'
 WHERE status<>'done';
 UPDATE vehicle_taxonomy_replay_state SET vin_reference_scan_completed_at=now();
 INSERT INTO vehicles(id,vin) SELECT ('93000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '1GHLL'||lpad(i::text,12,'0') FROM generate_series(1,301)i;
 INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,decoded_at,raw_response)
 SELECT '1GHLL'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','2026-10-01 12:00:00.123456+00',
 '{"ErrorCode":"0","Make":"CHEVROLET","Model":"Corvette","ModelYear":"2001","BodyClass":"Coupe","VehicleType":"PASSENGER CAR","EngineCylinders":"8","DisplacementL":"5.7","Doors":"2"}'::jsonb
 FROM generate_series(1,301)i;""")
for _ in range(20):
    query('SELECT drain_vehicle_taxonomy_queue()')
    if query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '93000000-%'") == '301':
        break
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '93000000-%'") == '301'
for i in range(6):
    query(f"""DO $$ DECLARE r record; BEGIN FOR r IN SELECT * FROM claim_vin_reference_intake('health-{i}',60) LOOP
     ASSERT finish_vin_reference_intake(r.revision_id::bigint,'health-{i}','done',fixture_vin_observation(r.revision_id::bigint));
     END LOOP; END $$;""")
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '93000000-%' AND status='done'") == '301'

# Instrument the actual protected checker in this disposable database. A cap
# violation raises; the real checker still independently validates every call.
query("ALTER FUNCTION vin_reference_result_matches(bigint,uuid) RENAME TO fixture_original_custody_check")
query("""CREATE FUNCTION vin_reference_result_matches(p_revision bigint,p_observation uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ DECLARE n integer;
 BEGIN n:=coalesce(nullif(current_setting('nuke_test.custody_calls',true),''),'0')::integer+1;
 IF n>200 THEN RAISE EXCEPTION 'validator call cap exceeded'; END IF;
 PERFORM set_config('nuke_test.custody_calls',n::text,true);
 RETURN fixture_original_custody_check(p_revision,p_observation); END $$;
 CREATE FUNCTION fixture_health_probe() RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE r jsonb;
 BEGIN PERFORM set_config('nuke_test.custody_calls','0',true);r:=assay_vin_reference_intake();
 RETURN r||jsonb_build_object('test_custody_calls',current_setting('nuke_test.custody_calls')::integer);END $$;""")
reading = json.loads(query('SELECT fixture_health_probe()'))
assert reading['counts']['current_receipts_total'] >= 301, reading
assert reading['counts']['current_receipts_sampled'] == reading['test_custody_calls'] == 200, reading
assert reading['counts']['current_receipts_capped'] is True and reading['full_current_custody_verified'] is False
assert reading['status'] == 'partial' and reading['counts']['stale_current'] == 0, reading
assert query("SELECT assay_status FROM v_job_health WHERE jobname='qualify-retained-vin-references'") == 'partial'
# Current source withdrawal remains visible; the sample never overrides privacy.
vehicle = query("SELECT vehicle_id FROM vehicle_taxonomy_recompute_queue ORDER BY last_receipt_id DESC NULLS LAST LIMIT 1")
query(f"UPDATE vehicles SET is_public=false WHERE id='{vehicle}'")
reading = json.loads(query('SELECT fixture_health_probe()'))
assert reading['counts']['stale_current'] > 0 and reading['status'] != 'passed', reading
query(f"UPDATE vehicles SET is_public=true WHERE id='{vehicle}'")
query("""CREATE OR REPLACE FUNCTION vin_reference_result_matches(p_revision bigint,p_observation uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_SOURCE_DO_NOT_REPORT';END $$;""")
reading = json.loads(query('SELECT fixture_health_probe()'))
assert reading['status'] == 'unavailable' and reading['sqlstate'] == 'P0001', reading
assert 'PRIVATE_SOURCE' not in json.dumps(reading) and reading['full_current_custody_verified'] is False
assert query("SELECT assay_status FROM v_job_health WHERE jobname='qualify-retained-vin-references'") == 'unavailable'
query("DROP FUNCTION vin_reference_result_matches(bigint,uuid);ALTER FUNCTION fixture_original_custody_check(bigint,uuid) RENAME TO vin_reference_result_matches")
retry_revision = query("SELECT revision_id FROM vin_reference_intake_queue WHERE status='skipped' ORDER BY revision_id LIMIT 1")
for i in range(3):
    query(f"UPDATE vin_reference_intake_queue SET next_attempt_at=now() WHERE revision_id={retry_revision}")
    assert query(f"SELECT revision_id FROM claim_vin_reference_intake('health-retry-{i}',1)") == retry_revision
    assert query(f"SELECT finish_vin_reference_intake({retry_revision},'health-retry-{i}','retry',NULL,'parent_read_failed')") == 't'
reading = json.loads(query('SELECT assay_vin_reference_intake()'))
assert reading['status'] == 'failed' and reading['counts']['failed'] == 1, reading
assert query("SELECT bool_and(NOT has_function_privilege(r,'assay_vin_reference_intake()','EXECUTE')) FROM unnest(ARRAY['anon','authenticated'])r") == 't'
assert query("SELECT has_function_privilege('service_role','assay_vin_reference_intake()','EXECUTE')") == 't'
assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'") == '0'
print('PASS actual reader:301new protected results, exactly200real custody calls, exact counters/cap/partial coverage, privacy withdrawal, unavailable private read errors, exhausted retry failure, drift/ACL/replay/no-intake migration')
