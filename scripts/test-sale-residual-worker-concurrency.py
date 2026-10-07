#!/usr/bin/env python3
"""Two real PG backends; disposable residual-fixture database only."""
import json
import re
import select
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"dm_refinement_[A-Za-z0-9_]+", database):
    raise SystemExit("Disposable dm_refinement_* database required")
command = ["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-d", database]


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
holder = hold("SELECT pg_try_advisory_lock(879104,1);", "t")
try:
    result = json.loads(query("SELECT public.drain_sale_residual_fold()"))
    assert result == {"status": "skipped", "reason": "worker_already_running"}, result
finally:
    release(holder, "SELECT pg_advisory_unlock(879104,1);")

task = query("SELECT public.enqueue_sale_residual_fold('11111111-1111-1111-1111-111111111111','2025-03-01','USD',true)")
assert task.isdigit()
# Work-state fixtures only, never production testimony. Leave just this due key.
query(f"UPDATE public.sale_residual_fold_queue SET enabled=false WHERE id<>{task}")
holder = hold(f"BEGIN; SELECT id FROM public.sale_residual_fold_queue WHERE id={task} FOR UPDATE;", task)
try:
    result = json.loads(query("SELECT public.drain_sale_residual_fold()"))
    assert result == {"status": "idle", "processed": 0}, result
finally:
    release(holder, "ROLLBACK;")
assert query(f"SELECT (next_due_at<=statement_timestamp())::text FROM public.sale_residual_fold_queue WHERE id={task}") == "true"
print("PASS real-backend advisory exclusion and SKIP LOCKED; locked work remains due")
