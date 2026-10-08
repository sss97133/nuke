#!/usr/bin/env python3
"""Observed55P03: source producer/seed survives a real parent FK lock."""
import os
import re
import select
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]


def query(sql):
    return subprocess.run(command + ['-c', sql], check=True, capture_output=True,
                          text=True, timeout=15).stdout.strip()


def hold(sql, expected):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(sql + '\n')
    process.stdin.flush()
    if not select.select([process.stdout], [], [], 10)[0] or process.stdout.readline().strip() != expected:
        process.kill()
        process.communicate()
        raise AssertionError('Lock holder failed to acquire expected fixture row')
    return process


def release(process):
    process.stdin.write('ROLLBACK;\n\\q\n')
    process.stdin.flush()
    _, error = process.communicate(timeout=10)
    if process.returncode:
        raise AssertionError(error)


assert query('SELECT current_database()') == database
vehicle = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1600'
capture = '00000000-0000-4000-8000-000000001600'
query(f"INSERT INTO vehicles(id) VALUES('{vehicle}'); UPDATE bat_sale_replay_state SET scan_completed_at=now();")
parent = hold(f"BEGIN; SELECT id FROM vehicles WHERE id='{vehicle}' FOR UPDATE;", vehicle)
try:
    # This raw INSERT is the actual existing eligibility trigger, not direct queue DML.
    query(f"INSERT INTO listing_page_snapshots(id,platform,success,http_status,html_sha256,metadata,html) VALUES('{capture}','bat',true,200,repeat('a',64),jsonb_build_object('vehicle_id','{vehicle}','vehicle_matched',true,'parsed_at','2025-06-16T12:00:00Z'),'PRIVATE SYNTHETIC HTML')")
    assert query(f"SELECT count(*) FROM derivation_queue WHERE evidence_id='{capture}'") == '0'
    assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'") == '1'
    assert query("SELECT count(*) FROM claim_bat_sale_snapshots('parent-other',20)") == '20'
    assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'") == '1'
    event_id = query(f"SELECT id FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'")
    consumer = hold(f"BEGIN; SELECT id FROM bat_sale_capture_deferrals WHERE id={event_id} FOR UPDATE;", event_id)
    try:
        query(f"UPDATE listing_page_snapshots SET metadata=metadata||'{{\"fixture_concurrent\":true}}'::jsonb WHERE id='{capture}'")
        assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'") == '2'
        assert query('SELECT retry_bat_sale_deferrals()') == '1'
        assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'") == '2'
        assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE id={event_id}") == '1'
    finally:
        release(consumer)
finally:
    release(parent)
assert query('SELECT retry_bat_sale_deferrals()') == '2'
assert query(f"SELECT count(*) FROM derivation_queue WHERE evidence_id='{capture}'") == '1'
assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture}'") == '0'
query(f"UPDATE derivation_queue SET status='claimed',locked_by='earned',locked_at=now(),attempts=1 WHERE evidence_id='{capture}'")
observation = query(f"SELECT fixture_observation('{capture}')")
assert query(f"SELECT finish_bat_sale_snapshot((SELECT id FROM derivation_queue WHERE evidence_id='{capture}'),'earned','done','{observation}')") == 't'
assert query(f"SELECT read_bat_sale_intake('{capture}')->>'stale'") == 'false'

# A retained unqueued source key under the same FK lock must not roll back a
# whole seed page or strand existing claims. Put it at the start of the PK page.
capture2 = '00000000-0000-4000-8000-000000001601'
query(f"INSERT INTO listing_page_snapshots(id,platform,success,http_status,html_sha256,metadata,html) SELECT '{capture2}',platform,success,http_status,html_sha256,metadata,html FROM listing_page_snapshots WHERE id='{capture}'; DELETE FROM derivation_queue WHERE evidence_id='{capture2}'; UPDATE derivation_queue SET status='skipped',next_attempt_at=now()+interval '1 day' WHERE evidence_type='listing_page_snapshot' AND status='pending'; UPDATE bat_sale_replay_state SET snapshot_cursor=NULL,scan_completed_at=NULL,keys_seen=0;")
parent = hold(f"BEGIN; SELECT id FROM vehicles WHERE id='{vehicle}' FOR UPDATE;", vehicle)
try:
    query('SELECT seed_bat_sale_snapshots()')
    assert query('SELECT keys_seen FROM bat_sale_replay_state') == '500'
    assert query(f"SELECT count(*) FROM bat_sale_capture_deferrals WHERE snapshot_id='{capture2}'") == '1'
    assert query(f"SELECT count(*) FROM derivation_queue WHERE evidence_id='{capture2}'") == '0'
finally:
    release(parent)
query('SELECT retry_bat_sale_deferrals()')
assert query(f"SELECT count(*) FROM derivation_queue WHERE evidence_id='{capture2}'") == '1'
assert query(f"SELECT html='PRIVATE SYNTHETIC HTML' AND html_sha256=repeat('a',64) FROM listing_page_snapshots WHERE id='{capture2}'") == 't'
assert query('SELECT count(*) FROM pg_stat_activity WHERE wait_event_type=\'Lock\'') == '0'
print('PASS parent-FK SKIP LOCKED, source producer preserved, unrelated claims, append under consumer lock, no lost capture, later canonical completion and500key seed progress')
