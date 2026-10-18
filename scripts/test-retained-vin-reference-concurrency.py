#!/usr/bin/env python3
"""Actual backend locks for the disposable canonical retained-reference fixture."""
import os
import re
import select
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"dm_refinement_[A-Za-z0-9_]+", database):
    raise SystemExit("Disposable dm_refinement_* database required")
command = [os.environ.get("NUKE_TEST_PSQL", "psql"), "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", database]


def query(sql):
    return subprocess.run(command + ["-c", sql], check=True, capture_output=True, text=True, timeout=15).stdout.strip()


def hold(sql, expected):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(sql + "\n")
    process.stdin.flush()
    if not select.select([process.stdout], [], [], 10)[0] or process.stdout.readline().strip() != expected:
        process.kill()
        process.communicate()
        raise AssertionError("Fixture lock readiness failed")
    return process


def release(process):
    process.stdin.write("ROLLBACK;\n\\q\n")
    process.stdin.flush()
    _, error = process.communicate(timeout=10)
    if process.returncode:
        raise AssertionError(error)


assert query("SELECT current_database()") == database
vehicle = "10000000-0000-0000-0000-000000000001"
revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
query(f"UPDATE vin_reference_intake_queue SET status='pending',attempts=0,next_attempt_at=now(),locked_by=NULL,locked_at=NULL WHERE revision_id={revision}")
holder = hold(f"BEGIN; SELECT revision_id FROM vin_reference_intake_queue WHERE revision_id={revision} FOR UPDATE;", revision)
try:
    assert query(f"SELECT enqueue_vin_reference_revision({revision})") == "f", "Producer must not contend with existing worker work"
    assert query("SELECT count(*) FROM claim_vin_reference_intake('locked-worker',20)") == "0"
finally:
    release(holder)

# A locked replay-state row skips seeding, while existing durable work still flows.
holder = hold("BEGIN; SELECT id FROM vehicle_taxonomy_replay_state WHERE id FOR UPDATE;", "t")
try:
    assert query("SELECT revision_id FROM claim_vin_reference_intake('state-worker',1)") == revision
    assert query("SELECT count(*) FROM claim_vin_reference_intake('other-worker',20)") == "0"
    observation = query(f"SELECT fixture_vin_observation({revision})")
    assert query(f"SELECT finish_vin_reference_intake({revision},'state-worker','done','{observation}')") == "t"
finally:
    release(holder)

# A source correction earns a new source claim. Parent NO KEY UPDATE locks from
# normal scalar writers do not obstruct canonical observation FK insertion.
query("UPDATE vin_decoded_data SET raw_response=jsonb_set(raw_response,'{fixture_source_revision}','\"2\"'),updated_at=clock_timestamp() WHERE vin='1G1YY22G015000001'")
query("SELECT drain_vehicle_taxonomy_queue()")
revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
assert query("SELECT revision_id FROM claim_vin_reference_intake('parent-worker',1)") == revision
holder = hold(f"BEGIN; SELECT id FROM vehicles WHERE id='{vehicle}' FOR NO KEY UPDATE;", vehicle)
try:
    corrected = query(f"SELECT fixture_vin_observation({revision})")
    assert corrected != observation
    assert query(f"SELECT finish_vin_reference_intake({revision},'parent-worker','done','{corrected}')") == "t"
finally:
    release(holder)

# A busy result FK must abort completion and retain its exact claim. No HTTP
# success can fabricate a completion, and the same lease succeeds after unlock.
query(f"UPDATE vehicles SET body_style='pickup' WHERE id='{vehicle}'")
query("SELECT drain_vehicle_taxonomy_queue()")
revision = query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
assert query("SELECT revision_id FROM claim_vin_reference_intake('result-worker',1)") == revision
holder = hold(f"BEGIN; SELECT id FROM vehicle_observations WHERE id='{corrected}' FOR UPDATE;", corrected)
try:
    try:
        query(f"SELECT finish_vin_reference_intake({revision},'result-worker','done','{corrected}')")
        raise AssertionError("Locked canonical result falsely completed")
    except subprocess.CalledProcessError as error:
        assert "lock timeout" in error.stderr
    assert query(f"SELECT status||':'||locked_by FROM vin_reference_intake_queue WHERE revision_id={revision}") == "claimed:result-worker"
finally:
    release(holder)
assert query(f"SELECT finish_vin_reference_intake({revision},'result-worker','done','{corrected}')") == "t"
assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')#>>'{{factory_reference,stale}}'") == "false"
print("PASS real-backend producer/claim isolation, busy state progress, parent FK insertion, result FK rollback/CAS and cached consumer")
