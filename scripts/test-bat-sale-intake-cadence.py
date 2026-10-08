#!/usr/bin/env python3
"""Exercise the actual sale cadence migration against the disposable PG fixture."""
import os
from pathlib import Path
import re
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/20261008061121_tune_retained_sale_intake_cadence.sql'


def query(sql):
    return subprocess.run(command + ['-c', sql], check=True, capture_output=True,
                          text=True, timeout=15).stdout.strip()


def apply(expect_failure=None):
    result = subprocess.run(command + ['-f', str(migration)], capture_output=True,
                            text=True, timeout=15)
    if expect_failure:
        assert result.returncode != 0 and expect_failure in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


assert query('SELECT current_database()') == database
job = "jobname='qualify-bat-archived-sales'"
extractor = "slug='bat-archived-sale-v1'"
original_command = query(f'SELECT command FROM cron.job WHERE {job}')
snapshot_sql = """SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),
 md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM derivation_queue q)),
 md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM listing_page_snapshots s)),
 md5((SELECT jsonb_agg(to_jsonb(s))::text FROM bat_sale_replay_state s)),
 md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM bat_sale_capture_deferrals s))"""
snapshot = query(snapshot_sql)
definitions_sql = """SELECT string_agg(pg_get_functiondef(p.oid),'|' ORDER BY p.proname) FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('enqueue_bat_sale_snapshot','claim_bat_sale_snapshots','finish_bat_sale_snapshot',
 'seed_bat_sale_snapshots','retry_bat_sale_deferrals','assay_bat_sale_intake','read_bat_sale_intake')"""
definitions = query(definitions_sql)

query(f'UPDATE cron.job SET active=false WHERE {job}')
apply('preserve owner pause or changed job')
assert query(f'SELECT active FROM cron.job WHERE {job}') == 'f'
assert query(f'SELECT rate_limit_per_hour FROM observation_extractors WHERE {extractor}') == '240'
query(f'UPDATE cron.job SET active=true WHERE {job}')
for before, after in [('"batch_size":20', '"batch_size":200'),
                      ('"dry_run":false', '"dry_run":true'),
                      ('"qualification_version":"v1"', '"qualification_version":"v2"'),
                      ('batch-extract-snapshots', 'derive-dispatch'),
                      ('60000', '120000')]:
    query(f"UPDATE cron.job SET command=replace(command,'{before}','{after}') WHERE {job}")
    apply('preserve owner pause or changed job')
    query(f"UPDATE cron.job SET command=replace(command,'{after}','{before}') WHERE {job}")
query(f"UPDATE observation_extractors SET extractor_config=extractor_config||'{{\"model_calls\":1}}' WHERE {extractor}")
apply('protected-v1 archived sale capacity unavailable')
assert query(f'SELECT schedule FROM cron.job WHERE {job}') == '*/5 * * * *'
query(f"UPDATE observation_extractors SET extractor_config=extractor_config||'{{\"model_calls\":0}}' WHERE {extractor}")
query(f'UPDATE observation_extractors SET min_interval_seconds=301 WHERE {extractor}')
apply('protected-v1 archived sale capacity unavailable')
assert query(f'SELECT rate_limit_per_hour FROM observation_extractors WHERE {extractor}') == '240'
query(f'UPDATE observation_extractors SET min_interval_seconds=300,is_active=false WHERE {extractor}')
apply('protected-v1 archived sale capacity unavailable')
query(f'UPDATE observation_extractors SET is_active=true WHERE {extractor}')
apply()
assert query(f"SELECT schedule||':'||active::text FROM cron.job WHERE {job}") == '* * * * *:true'
assert query(f"SELECT rate_limit_per_hour||':'||min_interval_seconds FROM observation_extractors WHERE {extractor}") == '1200:60'
assert query(f'SELECT command FROM cron.job WHERE {job}') == original_command
apply()
assert query(snapshot_sql) == snapshot
assert query(definitions_sql) == definitions
assert query("SELECT has_function_privilege('anon','claim_bat_sale_snapshots(text,integer)','EXECUTE')") == 'f'
assert query("SELECT has_function_privilege('authenticated','finish_bat_sale_snapshot(uuid,text,text,uuid,text)','EXECUTE')") == 'f'
assert query("SELECT has_table_privilege('service_role','bat_sale_replay_state','UPDATE')") == 'f'
# Faster scheduling still cannot increase a single lease or bypass its bounds.
rejected = subprocess.run(command + ['-c', "SELECT * FROM claim_bat_sale_snapshots('bounded',21)"],
                          capture_output=True, text=True, timeout=15)
assert rejected.returncode != 0 and 'Invalid bounded worker' in rejected.stderr
assert query('SELECT count(*) FROM pg_stat_activity WHERE wait_event_type=\'Lock\'') == '0'
print('PASS actual sale cadence: owner pause/changed command/config guards, atomic rollback, fixed20/minute, replay, unchanged source/queue/observations/readers and API boundaries')
