#!/usr/bin/env python3
"""Actual migration proof against the existing disposable retained-VIN fixture."""
import os
from pathlib import Path
import re
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008035155_tune_retained_vin_reference_cadence.sql'


def query(sql):
    return subprocess.run(command + ['-c', sql], check=True, capture_output=True, text=True, timeout=15).stdout.strip()


def apply(expect_failure=None):
    result = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=15)
    if expect_failure:
        assert result.returncode != 0 and expect_failure in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


job = "jobname='qualify-retained-vin-references'"
extractor = "slug='retained-vin-reference-v1'"
snapshot = query("SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY revision_id)::text FROM vin_reference_intake_queue q))")
query(f"UPDATE cron.job SET active=false WHERE {job}")
apply('do not revive a paused or changed job')
assert query(f"SELECT active FROM cron.job WHERE {job}") == 'f'
assert query(f"SELECT rate_limit_per_hour FROM observation_extractors WHERE {extractor}") == '80'
query(f"UPDATE cron.job SET active=true,command=replace(command,'\"batch_size\":20','\"batch_size\":19') WHERE {job}")
apply('do not revive a paused or changed job')
query(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":19','\"batch_size\":20') WHERE {job}")
query(f"UPDATE observation_extractors SET min_interval_seconds=901 WHERE {extractor}")
apply('capacity contract unavailable')
assert query(f"SELECT schedule FROM cron.job WHERE {job}") == '*/15 * * * *'
query(f"UPDATE observation_extractors SET min_interval_seconds=900 WHERE {extractor}")
apply()
assert query(f"SELECT schedule||':'||active::text FROM cron.job WHERE {job}") == '* * * * *:true'
assert query(f"SELECT rate_limit_per_hour||':'||min_interval_seconds FROM observation_extractors WHERE {extractor}") == '1200:60'
assert query("SELECT has_function_privilege('service_role','activate_retained_vin_reference_intake()','EXECUTE')") == 'f'
assert query("SELECT activate_retained_vin_reference_intake()") == 't'
apply()
assert query("SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY revision_id)::text FROM vin_reference_intake_queue q))") == snapshot
print('PASS cadence migration: pause/changed-job/config guards, atomic rollback,20/minute contract, private activation, replay and unchanged testimony/work')
