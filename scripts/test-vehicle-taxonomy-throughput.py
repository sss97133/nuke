#!/usr/bin/env python3
"""Actual 250-vehicle migration, source lineage and replay on existing fixtures."""
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008053248_tune_retained_taxonomy_batch_throughput.sql'


def query(sql):
    result = subprocess.run(command + ['-c', sql], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def apply(expect_failure=False):
    result = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=20)
    if expect_failure:
        assert result.returncode != 0 and 'preserve owner pause' in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


job = "jobname='drain-vehicle-taxonomy'"
snapshot_sql = "SELECT md5((SELECT jsonb_agg(to_jsonb(v) ORDER BY id)::text FROM vehicles v)),md5((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM vehicle_taxonomy_revisions r)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY vehicle_id)::text FROM vehicle_taxonomy_recompute_queue q)),md5((SELECT to_jsonb(s)::text FROM vehicle_taxonomy_replay_state s))"
snapshot = query(snapshot_sql)
query(f"UPDATE cron.job SET active=false WHERE {job}")
apply(True)
assert query(f"SELECT active FROM cron.job WHERE {job}") == 'f'
query(f"UPDATE cron.job SET active=true,schedule='*/5 * * * *' WHERE {job}")
apply(True)
query(f"UPDATE cron.job SET schedule='* * * * *' WHERE {job}")
apply()
apply()
assert query(snapshot_sql) == snapshot, 'DDL must not run a replay or change testimony'
assert query("SELECT has_function_privilege('service_role','drain_vehicle_taxonomy_queue()','EXECUTE') AND NOT has_function_privilege('anon','drain_vehicle_taxonomy_queue()','EXECUTE') AND NOT has_function_privilege('authenticated','drain_vehicle_taxonomy_queue()','EXECUTE')") == 't'
query("""INSERT INTO vehicles(id,vin)
 SELECT ('90000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '1GDDD'||lpad(i::text,12,'0') FROM generate_series(1,300)i;
 INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,decoded_at,raw_response)
 SELECT '1GDDD'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','2026-10-01 12:00:00.123456+00',
 '{"ErrorCode":"0","Make":"CHEVROLET","Model":"Corvette","ModelYear":"2001","EngineCylinders":"8","DisplacementL":"5.7","Doors":"2"}'::jsonb
 FROM generate_series(1,300)i;""")

# Busy physical parents allow durable inputs to coalesce, while writes skip.
holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    holder.stdin.write("BEGIN; SELECT count(*) FROM (SELECT id FROM vehicles WHERE id::text LIKE '90000000-%' FOR NO KEY UPDATE) locked;\n")
    holder.stdin.flush()
    assert select.select([holder.stdout], [], [], 10)[0]
    assert holder.stdout.readline().strip() == '300'
    for _ in range(20):
        result = json.loads(query('SELECT drain_vehicle_taxonomy_queue()'))
        assert result['processed'] == 0, result
        if query("SELECT count(*) FROM vehicle_taxonomy_invalidations WHERE vehicle_id::text LIKE '90000000-%'") == '0':
            break
    assert query("SELECT count(*) FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id::text LIKE '90000000-%' AND next_due_at IS NOT NULL") == '300'
    holder.stdin.write("ROLLBACK;\n\\q\n")
    holder.stdin.flush()
    _, error = holder.communicate(timeout=10)
    assert holder.returncode == 0, error
finally:
    if holder.poll() is None:
        holder.kill()
        holder.communicate()

first = json.loads(query('SELECT drain_vehicle_taxonomy_queue()'))
second = json.loads(query('SELECT drain_vehicle_taxonomy_queue()'))
assert first['processed'] == first['changed'] == 250, first
assert second['processed'] == second['changed'] == 50, second
assert query("SELECT count(*) FROM vehicles WHERE id::text LIKE '90000000-%' AND canonical_body_style='COUPE' AND fixture_updates=1") == '300'
assert query("SELECT count(*) FROM vehicle_taxonomy_revisions WHERE vehicle_id::text LIKE '90000000-%' AND receipt->>'reference_status'='accepted' AND (receipt#>>'{input,source_recorded_at}')::timestamptz='2026-10-01 12:00:00.123456+00' AND cache_vin IS NOT NULL") == '300'
assert query("SELECT bool_and((read_vehicle_taxonomy_fold(id)->>'stale')::boolean=false AND (read_vehicle_taxonomy_fold(id)->>'canonical_columns_match')::boolean) FROM vehicles WHERE id::text LIKE '90000000-%'") == 't'
before = query('SELECT count(*) FROM vehicle_taxonomy_revisions')
query("SELECT enqueue_vehicle_taxonomy(id) FROM vehicles WHERE id::text LIKE '90000000-%'")
for _ in range(3):
    result = json.loads(query('SELECT drain_vehicle_taxonomy_queue()'))
    assert result['changed'] == 0, result
assert query('SELECT count(*) FROM vehicle_taxonomy_revisions') == before
assert query("SELECT count(*) FROM vehicles WHERE id::text LIKE '90000000-%' AND fixture_updates=1") == '300'

# In the retained-factory fixture, actual source FKs and canonical completion
# remain valid after the larger producer batch; its reader sees the same fact.
if query("SELECT to_regprocedure('public.fixture_vin_observation(bigint)') IS NOT NULL") == 't':
    query("UPDATE vin_reference_intake_queue SET next_attempt_at=now()+interval '1 day' WHERE status IN('pending','skipped') AND vehicle_id::text NOT LIKE '90000000-%'")
    revision = query("SELECT revision_id FROM claim_vin_reference_intake('bulk-taxonomy',1)")
    observation = query(f'SELECT fixture_vin_observation({revision})')
    assert query(f"SELECT finish_vin_reference_intake({revision},'bulk-taxonomy','done','{observation}')") == 't'
    assert query(f"SELECT observed_at='2026-10-01 12:00:00.123456+00' AND source_vin_taxonomy_revision_id={revision} FROM vehicle_observations WHERE id='{observation}'") == 't'
    vehicle = query(f'SELECT vehicle_id FROM vehicle_taxonomy_revisions WHERE id={revision}')
    assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')#>>'{{factory_reference,stale}}'") == 'false'
print('PASS real250/50 bulk taxonomy: paused/config guards, unchanged DDL data, busy-parent coalescing, original source clocks, single projection updates, idempotent replay, cached consumer and optional protected factory completion')
