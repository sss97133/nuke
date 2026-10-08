#!/usr/bin/env python3
"""Real PG backends: retained-capture producer, separate leases and receipt CAS."""
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


def hold(sql):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(sql + "\n")
    process.stdin.flush()
    if not select.select([process.stdout], [], [], 10)[0]:
        process.kill()
        process.communicate()
        raise AssertionError("Lock holder failed to signal readiness")
    return process, process.stdout.readline().strip()


def release(process):
    process.stdin.write("ROLLBACK;\n\\q\n")
    process.stdin.flush()
    _, error = process.communicate(timeout=10)
    if process.returncode:
        raise AssertionError(error)


assert query("SELECT current_database()") == database
# First claim transaction holds its seed and two queue leases. Second must neither
# wait on the shared seed row nor claim either item.
holder, first = hold("BEGIN; SELECT string_agg(id::text,',') FROM claim_bat_sale_snapshots('parallel-a',2);")
try:
    first_ids = set(first.split(','))
    assert len(first_ids) == 2 and all(re.fullmatch(r"[a-f0-9-]{36}", x) for x in first_ids)
    second = query("SELECT string_agg(id::text,',') FROM claim_bat_sale_snapshots('parallel-b',2)")
    second_ids = set(second.split(','))
    assert len(second_ids) == 2 and first_ids.isdisjoint(second_ids), (first, second)
    assert query("SELECT count(*) FROM derivation_queue WHERE locked_by='parallel-b'") == "2"
finally:
    release(holder)
assert query("SELECT count(*) FROM derivation_queue WHERE locked_by='parallel-a'") == "0"

# Real metadata producer is not blocked by a queue row held by its consumer.
item = query("SELECT id||','||source_snapshot_id FROM derivation_queue WHERE locked_by='parallel-b' ORDER BY id LIMIT 1")
queue_id, snapshot_id = item.split(',')
observation_id = query(f"SELECT fixture_observation('{snapshot_id}')")
holder, locked = hold(f"BEGIN; SELECT id FROM derivation_queue WHERE id='{queue_id}' FOR UPDATE;")
try:
    assert locked == queue_id
    assert query(f"SELECT enqueue_bat_sale_snapshot('{snapshot_id}')") == "f"
    query(f"UPDATE listing_page_snapshots SET metadata=metadata||'{{\"fixture_checked\":true}}'::jsonb WHERE id='{snapshot_id}'")
    assert query(f"SELECT count(*) FROM derivation_queue WHERE evidence_id='{snapshot_id}'") == "1"
    assert query(f"SELECT finish_bat_sale_snapshot('{queue_id}','parallel-b','done','{observation_id}')") == "f"
    assert query(f"SELECT status FROM derivation_queue WHERE id='{queue_id}'") == "claimed"
finally:
    release(holder)
assert query(f"SELECT finish_bat_sale_snapshot('{queue_id}','parallel-b','done','{observation_id}')") == "t"
assert query(f"SELECT read_bat_sale_intake('{snapshot_id}')->>'stale'") == "false"
assert query(f"SELECT finish_bat_sale_snapshot('{queue_id}','parallel-b','done','{observation_id}')") == "f"
assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'") == "0"
print("PASS real-backend disjoint SKIP LOCKED leases, seed exclusion, producer under consumer lock, receipt CAS and cached consumer")
