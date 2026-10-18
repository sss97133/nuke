#!/usr/bin/env python3
"""Two real PG backends: taxonomy advisory/queue/parent locks and durable intake."""
import json
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
    return subprocess.run(command + ["-c", sql], check=True, capture_output=True,
                          text=True, timeout=15).stdout.strip()


def hold(sql, expected):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(sql + "\n")
    process.stdin.flush()
    if not select.select([process.stdout], [], [], 10)[0]:
        process.kill()
        process.communicate()
        raise AssertionError("Fixture lock holder did not signal readiness")
    if process.stdout.readline().strip() != expected:
        process.kill()
        process.communicate()
        raise AssertionError("Fixture lock holder did not acquire expected lock")
    return process


def release(process, sql):
    process.stdin.write(sql + "\n\\q\n")
    process.stdin.flush()
    _, error = process.communicate(timeout=10)
    if process.returncode:
        raise AssertionError(error)


assert query("SELECT current_database()") == database
vehicle = "11111111-1111-1111-1111-111111111111"
holder = hold("SELECT pg_try_advisory_lock(879105,1);", "t")
try:
    assert json.loads(query("SELECT drain_vehicle_taxonomy_queue()")) == {"status":"skipped","reason":"worker_active"}
finally:
    release(holder,"SELECT pg_advisory_unlock(879105,1);")
# Intake append completes while current coalesced worker state is locked.
holder=hold(f"BEGIN; SELECT vehicle_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}' FOR UPDATE;",vehicle)
try:
    query("UPDATE vin_decoded_data SET body_type='Convertible',raw_response=jsonb_set(raw_response,'{BodyClass}',to_jsonb('Convertible'::text)),updated_at=clock_timestamp() WHERE vin='1AAAAAAAAAAAAAAA1'")
    assert query(f"SELECT count(*) FROM vehicle_taxonomy_invalidations WHERE vehicle_id='{vehicle}'") == "1"
    before=query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'")
    result=json.loads(query("SELECT drain_vehicle_taxonomy_queue()"))
    assert result["processed"]==0,result
    assert query(f"SELECT count(*) FROM vehicle_taxonomy_invalidations WHERE vehicle_id='{vehicle}'") == "1"
    assert query(f"SELECT last_receipt_id FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'") == before
finally:
    release(holder,"ROLLBACK;")
result=json.loads(query("SELECT drain_vehicle_taxonomy_queue()"))
assert result["processed"]==1,result
assert query(f"SELECT count(*) FROM vehicle_taxonomy_invalidations WHERE vehicle_id='{vehicle}'") == "0"
assert query(f"SELECT read_vehicle_taxonomy_fold('{vehicle}')->>'canonical_columns_match'") == "true"
# A physical input writer holds its own parent: drainer skips, leaves due work.
query(f"SELECT enqueue_vehicle_taxonomy('{vehicle}')")
holder=hold(f"BEGIN; SELECT id FROM vehicles WHERE id='{vehicle}' FOR NO KEY UPDATE;",vehicle)
try:
    result=json.loads(query("SELECT drain_vehicle_taxonomy_queue()"))
    assert result["processed"]==0,result
    assert query(f"SELECT (next_due_at<=statement_timestamp())::text FROM vehicle_taxonomy_recompute_queue WHERE vehicle_id='{vehicle}'") == "true"
finally:
    release(holder,"ROLLBACK;")
assert json.loads(query("SELECT drain_vehicle_taxonomy_queue()"))["processed"]==1
print("PASS real-backend advisory exclusion, intake append under queue lock, retained invalidation, parent SKIP LOCKED and cached consumer")
