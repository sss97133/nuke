#!/usr/bin/env python3
"""Real migration and 60-record claims on the disposable retained-VIN fixture."""
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
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008051404_tune_retained_vin_batch_throughput.sql'


def query(sql):
    result = subprocess.run(command + ['-c', sql], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def apply(expect_failure=None):
    result = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=15)
    if expect_failure:
        assert result.returncode != 0 and expect_failure in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


job = "jobname='qualify-retained-vin-references'"
extractor = "slug='retained-vin-reference-v1'"
snapshot_sql = "SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY revision_id)::text FROM vin_reference_intake_queue q))"
snapshot = query(snapshot_sql)
query(f"UPDATE cron.job SET active=false WHERE {job}")
apply('preserve owner pause')
assert query(f"SELECT active FROM cron.job WHERE {job}") == 'f'
assert query(f"SELECT rate_limit_per_hour FROM observation_extractors WHERE {extractor}") == '1200'
query(f"UPDATE cron.job SET active=true WHERE {job}")
for changed_batch in ('19', '200'):
    query(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":20}}','\"batch_size\":{changed_batch}}}') WHERE {job}")
    apply('preserve owner pause')
    query(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":{changed_batch}}}','\"batch_size\":20}}') WHERE {job}")
query(f"UPDATE observation_extractors SET min_interval_seconds=61 WHERE {extractor}")
apply('capacity unavailable')
assert query(f"SELECT active AND command LIKE '%\"batch_size\":20}}%' FROM cron.job WHERE {job}") == 't'
query(f"UPDATE observation_extractors SET min_interval_seconds=60 WHERE {extractor}")
apply()
assert query(f"SELECT NOT active AND schedule='* * * * *' AND command LIKE '%\"batch_size\":60}}%' FROM cron.job WHERE {job}") == 't'
assert query(f"SELECT rate_limit_per_hour||':'||min_interval_seconds FROM observation_extractors WHERE {extractor}") == '3600:60'
assert query(snapshot_sql) == snapshot, 'Migration must not rewrite testimony or queued work'
assert query("SELECT bool_and(NOT has_function_privilege(r,'activate_retained_vin_reference_intake()','EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r") == 't'
assert query("SELECT has_function_privilege('service_role','claim_vin_reference_intake(text,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','claim_vin_reference_intake(text,integer)','EXECUTE')") == 't'
for changed_batch in ('61', '600'):
    query(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":60}}','\"batch_size\":{changed_batch}}}') WHERE {job}")
    query("SELECT fixture_reject('SELECT activate_retained_vin_reference_intake()','changed fixed job refuses activation')")
    assert query(f"SELECT active FROM cron.job WHERE {job}") == 'f'
    query(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":{changed_batch}}}','\"batch_size\":60}}') WHERE {job}")
assert query("SELECT activate_retained_vin_reference_intake()") == 't'
apply()  # A completed deployment may repeat, but must stage activation again.
assert query(f"SELECT active FROM cron.job WHERE {job}") == 'f'
apply('preserve owner pause')  # Do not infer why a job was paused.
assert query("SELECT activate_retained_vin_reference_intake()") == 't'
assert query(snapshot_sql) == snapshot

# Keep the old fixture work out of this batch without deleting any testimony.
query("UPDATE vin_reference_intake_queue SET next_attempt_at=now()+interval '1 day' WHERE status IN('pending','skipped')")
query("""INSERT INTO vehicles(id,vin)
 SELECT ('80000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '1GCCC'||lpad(i::text,12,'0') FROM generate_series(1,145) i;
 INSERT INTO vin_decoded_data(vin,body_type,vehicle_type,decoded_at,raw_response)
 SELECT '1GCCC'||lpad(i::text,12,'0'),'Coupe','PASSENGER CAR','2026-10-01 12:00:00.123456+00',
 '{"ErrorCode":"0","Make":"CHEVROLET","Model":"Corvette","ModelYear":"2001","EngineCylinders":"8","DisplacementL":"5.7","Doors":"2"}'::jsonb
 FROM generate_series(1,145) i;""")
for _ in range(12):
    query("SELECT drain_vehicle_taxonomy_queue()")
    if query("SELECT count(*) FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id::text LIKE '80000000-%' AND next_due_at IS NOT NULL") == '0':
        break
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '80000000-%'") == '145'
query("SELECT fixture_reject('SELECT * FROM claim_vin_reference_intake(''too-many'',61)','claim cap61 refused')")
holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    holder.stdin.write("BEGIN; SELECT string_agg(revision_id,',' ORDER BY revision_id) FROM claim_vin_reference_intake('bulk-one',60);\n")
    holder.stdin.flush()
    assert select.select([holder.stdout], [], [], 10)[0], 'First backend claim readiness'
    first = holder.stdout.readline().strip().split(',')
    # This second backend runs while the first sixty claim updates are locked.
    second = query("SELECT revision_id FROM claim_vin_reference_intake('bulk-two',60)").splitlines()
    holder.stdin.write("COMMIT;\n\\q\n")
    holder.stdin.flush()
    _, error = holder.communicate(timeout=10)
    assert holder.returncode == 0, error
finally:
    if holder.poll() is None:
        holder.kill()
        holder.communicate()
default = query("SELECT revision_id FROM claim_vin_reference_intake('bulk-default')").splitlines()
assert len(first) == len(second) == 60 and len(default) == 20
assert not (set(first) & set(second) or set(first + second) & set(default))
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '80000000-%' AND status='pending'") == '5'

revision = first[0]
observation = query(f"SELECT fixture_vin_observation({revision})")
assert query(f"SELECT finish_vin_reference_intake({revision},'bulk-one','done','{observation}')") == 't'
assert query(f"SELECT finish_vin_reference_intake({revision},'bulk-one','done','{observation}')") == 'f'
assert query(f"SELECT observed_at='2026-10-01 12:00:00.123456+00' AND source_vin_taxonomy_revision_id={revision} FROM vehicle_observations WHERE id='{observation}'") == 't'
vehicle = query(f"SELECT vehicle_id FROM vehicle_taxonomy_revisions WHERE id={revision}")
assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')#>>'{{factory_reference,stale}}'") == 'false'
assert query(f"SELECT count(*) FROM vin_reference_intake_queue q WHERE q.locked_by='bulk-one' AND finish_vin_reference_intake(q.revision_id,'bulk-one','retry',NULL,'batch_budget_deferred')") == '59'
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE last_error='batch_budget_deferred' AND attempts=0 AND status='pending'") == '59'

# All sixty expired leases are recovered within the same unchanged 10m/15m policy.
query("UPDATE vin_reference_intake_queue SET locked_at=now()-interval '11 minutes' WHERE locked_by='bulk-two'")
query("SELECT count(*) FROM claim_vin_reference_intake('recover-60',1)")
assert query("SELECT count(*) FROM vin_reference_intake_queue WHERE vehicle_id::text LIKE '80000000-%' AND last_error='lease_expired' AND status='pending' AND locked_by IS NULL AND next_attempt_at>now()+interval '14 minutes'") == '60'
query(f"UPDATE vehicles SET body_style='pickup' WHERE id='{vehicle}'")
query("SELECT drain_vehicle_taxonomy_queue()")
replay = query(f"SELECT revision_id FROM claim_vin_reference_intake('replay',60) WHERE vehicle_id='{vehicle}'")
assert replay and replay != revision
assert query(f"SELECT fixture_vin_observation({replay})") == observation
assert query(f"SELECT finish_vin_reference_intake({replay},'replay','done','{observation}')") == 't'
assert query(f"SELECT source_vin_taxonomy_revision_id={revision} FROM vehicle_observations WHERE id='{observation}'") == 't'
assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')#>>'{{factory_reference,stale}}'") == 'false'
print('PASS throughput migration: owner pause/config guards, atomic rollback, staged60/minute activation, ACLs, unchanged testimony,60/60 disjoint claims, default20, lease recovery, budget deferral, canonical replay and cached consumer')
