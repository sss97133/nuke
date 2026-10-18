#!/usr/bin/env python3
"""Synthetic PG17 proof of the staged sale owner and parallel protected leases."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import sys

assert len(sys.argv) in (2,3) and (len(sys.argv)==2 or sys.argv[2]=='--throughput')
throughput = len(sys.argv)==3
database = sys.argv[1]
assert re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database)
assert os.environ.get('PGHOST', '/private/tmp') in ('localhost', '/private/tmp')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
root = Path(__file__).resolve().parents[1]
stage = (root/'supabase/migrations/20261008111928_stage_direct_bat_sale_queue_drain.sql').read_text()
activation = re.search(r'DO \$activate\$[\s\S]+?END \$activate\$;',
    (root/'.github/workflows/supabase-deploy.yml').read_text()).group(0)

def query(text):
    r = subprocess.run(command + ['-c', text], capture_output=True, text=True, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()

def rejects(text, reason=None):
    r = subprocess.run(command + ['-c', text], capture_output=True, text=True, timeout=15)
    assert r.returncode and 'ERROR:' in r.stderr and (reason is None or reason in r.stderr), r.stderr

def quoted(value):
    return "'" + value.replace("'", "''") + "'"

for file in ('supabase/sql/helpers/bat_sale_intake_fixture.sql',
             'supabase/migrations/20261008001520_automate_bat_archived_sale_intake.sql',
             'supabase/migrations/20261008013347_defer_bat_sale_intake_under_parent_locks.sql',
             'supabase/migrations/20261008061121_tune_retained_sale_intake_cadence.sql',
             'supabase/migrations/20261008100653_bound_retained_sale_intake_health.sql'):
    r = subprocess.run(command + ['-f', str(root/file)], capture_output=True, text=True, timeout=15)
    assert r.returncode == 0, r.stderr
query('SELECT fixture_capture(i) FROM generate_series(20001,20100)i')
snapshot = """SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),
 md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM derivation_queue q)),
 md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM listing_page_snapshots s)),
 md5((SELECT jsonb_agg(to_jsonb(v) ORDER BY id)::text FROM vehicles v)),
 md5((SELECT jsonb_agg(to_jsonb(s))::text FROM bat_sale_replay_state s))"""
before = query(snapshot)
metadata = "SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='claim_bat_sale_snapshots(text,integer)'::regprocedure"
owner = query(metadata)
unchanged = """SELECT string_agg(pg_get_functiondef(oid),'|' ORDER BY proname) FROM pg_proc WHERE oid IN(
 'guard_bat_sale_work()'::regprocedure,'enqueue_bat_sale_snapshot(uuid)'::regprocedure,
 'finish_bat_sale_snapshot(uuid,text,text,uuid,text)'::regprocedure,'seed_bat_sale_snapshots()'::regprocedure,
 'retry_bat_sale_deferrals()'::regprocedure,'read_bat_sale_intake(uuid)'::regprocedure,'assay_bat_sale_intake()'::regprocedure)"""
unchanged_before = query(unchanged)
job = "jobname='qualify-bat-archived-sales'"
old_command = json.loads(query(f'SELECT to_json(command) FROM cron.job WHERE {job}'))
query(f'UPDATE cron.job SET active=false WHERE {job}')
rejects(stage, 'preserve owner pause')
assert query('SELECT rate_limit_per_hour FROM observation_extractors WHERE slug=\'bat-archived-sale-v1\'') == '1200'
query(f'UPDATE cron.job SET active=true WHERE {job}')
for old, new in [('"batch_size":20}', '"batch_size":30}'), ('"qualification_version":"v1"', '"qualification_version":"episode_v2"')]:
    query(f'UPDATE cron.job SET command=replace(command,{quoted(old)},{quoted(new)}) WHERE {job}')
    rejects(stage, 'preserve owner pause')
    query(f'UPDATE cron.job SET command={quoted(old_command)} WHERE {job}')
query("UPDATE observation_extractors SET min_interval_seconds=61 WHERE slug='bat-archived-sale-v1'")
rejects(stage, 'Registered protected-v1 sale contract changed')
query("UPDATE observation_extractors SET min_interval_seconds=60 WHERE slug='bat-archived-sale-v1'")
old_claim = query("SELECT pg_get_functiondef('claim_bat_sale_snapshots(text,integer)'::regprocedure)")
query(old_claim.replace('p_limit NOT BETWEEN 1 AND 20', 'p_limit NOT BETWEEN 1 AND 21'))
rejects(stage, 'Protected sale claim owner changed')
assert query("SELECT edge_function_name||':'||rate_limit_per_hour FROM observation_extractors WHERE slug='bat-archived-sale-v1'") == 'batch-extract-snapshots:1200'
query(old_claim)
query(stage)
assert query(snapshot) == before and query(metadata) == owner and query(unchanged) == unchanged_before
assert query(f'SELECT active FROM cron.job WHERE {job}') == 'f'
assert query("SELECT edge_function_name||':'||rate_limit_per_hour FROM observation_extractors WHERE slug='bat-archived-sale-v1'") == 'ingest-observation:2400'
assert query("SELECT encode(sha256(convert_to(pg_get_functiondef('claim_bat_sale_snapshots(text,integer)'::regprocedure),'UTF8')),'base64')") == 'GA2BidAHRpM+bbXoaSgEninREgjbRoE39lsfs7VHEu4='
new_command = json.loads(query(f'SELECT to_json(command) FROM cron.job WHERE {job}'))
query(f'UPDATE cron.job SET command=replace(command,\'"batch_size":40}}\',\'"batch_size":41}}\') WHERE {job}')
rejects(activation, 'activation contract changed')
assert query(f'SELECT active FROM cron.job WHERE {job}') == 'f'
query(f'UPDATE cron.job SET command={quoted(new_command)} WHERE {job}')
query("UPDATE observation_extractors SET is_active=false WHERE slug='bat-archived-sale-v1'")
rejects(activation, 'activation contract changed')
query("UPDATE observation_extractors SET is_active=true WHERE slug='bat-archived-sale-v1'")
new_claim = query("SELECT pg_get_functiondef('claim_bat_sale_snapshots(text,integer)'::regprocedure)")
query(new_claim.replace('p_limit NOT BETWEEN 1 AND 40', 'p_limit NOT BETWEEN 1 AND 41'))
rejects(activation, 'activation contract changed')
query(new_claim)
query(activation)
query(activation)
query(stage)  # Reviewed active replay re-stages; unknown pauses cannot revive.
rejects(stage, 'preserve owner pause')
query(activation)
assert query(snapshot) == before
assert '20' in query("BEGIN;SELECT count(*) FROM claim_bat_sale_snapshots('default20');ROLLBACK").splitlines()
rejects("SELECT * FROM claim_bat_sale_snapshots('unbounded',41)", 'Invalid bounded worker')
print('PASS staged40 pause/job/config/owner atomic guards; real CI activation; data/ACL/default20/recovery/source owners unchanged', flush=True)

def claim(worker):
    return json.loads(query(f"SELECT jsonb_agg(to_jsonb(q)) FROM claim_bat_sale_snapshots('{worker}',40)q"))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    batches = list(pool.map(claim, ['direct-a', 'direct-b']))
assert [len(b) for b in batches] == [40,40]
assert len({r['id'] for b in batches for r in b}) == 80
first, other = batches[0][0], batches[1][0]
other_result = query(f"SELECT fixture_observation('{other['source_snapshot_id']}')")
assert query(f"SELECT finish_bat_sale_snapshot('{first['id']}','wrong','done','{other_result}')") == 'f'
rejects(f"SELECT finish_bat_sale_snapshot('{first['id']}','direct-a','done','{other_result}')")
for worker in ('direct-a','direct-b'):
    query(f"""DO $$ DECLARE r record;oid uuid;BEGIN
      FOR r IN SELECT * FROM derivation_queue WHERE status='claimed' AND locked_by='{worker}' LOOP
       SELECT id INTO oid FROM vehicle_observations WHERE source_snapshot_id=r.source_snapshot_id LIMIT 1;
       IF oid IS NULL THEN oid:=fixture_observation(r.source_snapshot_id);END IF;
       ASSERT finish_bat_sale_snapshot(r.id,'{worker}','done',oid);
      END LOOP;END $$;""")
assert query("SELECT count(*) FROM derivation_queue WHERE status='done'") == '80'
assert query('SELECT count(*) FROM vehicle_observations') == '80'
read = json.loads(query(f"SELECT read_bat_sale_intake('{first['source_snapshot_id']}')"))
assert not read['stale'] and read['receipt']['original_parsed_at'] == '2025-06-16T12:00:00Z'
query(f"UPDATE vehicles SET is_public=false WHERE id='{first['source_vehicle_id']}'")
assert json.loads(query(f"SELECT read_bat_sale_intake('{first['source_snapshot_id']}')"))['stale']
query(f"UPDATE vehicles SET is_public=true WHERE id='{first['source_vehicle_id']}'")
assert query("SELECT has_function_privilege('anon','claim_bat_sale_snapshots(text,integer)','EXECUTE')") == 'f'
assert query("SELECT has_function_privilege('authenticated','finish_bat_sale_snapshot(uuid,text,text,uuid,text)','EXECUTE')") == 'f'
assert query("SELECT has_table_privilege('service_role','bat_sale_replay_state','UPDATE')") == 'f'
assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'") == '0'
print('PASS actual parallel40+40 disjoint leases and80 protected persisted results; wrong worker/result, privacy, source clocks and API doors', flush=True)

if throughput:
    parallel_stage = (root/'supabase/migrations/20261008133638_tune_retained_sale_parallel_throughput.sql').read_text()
    query('SELECT fixture_capture(i) FROM generate_series(20201,20460)i')
    parallel_before = query(snapshot)
    query(f'UPDATE cron.job SET active=false WHERE {job}')
    rejects(parallel_stage, 'preserve owner pause')
    query(f'UPDATE cron.job SET active=true WHERE {job}')
    query("UPDATE observation_extractors SET rate_limit_per_hour=2401 WHERE slug='bat-archived-sale-v1'")
    rejects(parallel_stage, 'Registered protected-v1 sale contract changed')
    query("UPDATE observation_extractors SET rate_limit_per_hour=2400 WHERE slug='bat-archived-sale-v1'")
    query(new_claim.replace('p_limit NOT BETWEEN 1 AND 40', 'p_limit NOT BETWEEN 1 AND 41'))
    rejects(parallel_stage, 'Protected sale claim owner changed')
    query(new_claim)
    query(f'UPDATE cron.job SET command=replace(command,\'"batch_size":40}}\',\'"batch_size":41}}\') WHERE {job}')
    rejects(parallel_stage, 'preserve owner pause')
    query(f'UPDATE cron.job SET command={quoted(new_command)} WHERE {job}')
    query(parallel_stage)
    assert query(snapshot)==parallel_before and query(metadata)==owner and query(unchanged)==unchanged_before
    assert query(f'SELECT active FROM cron.job WHERE {job}')=='f'
    assert query("SELECT edge_function_name||':'||rate_limit_per_hour FROM observation_extractors WHERE slug='bat-archived-sale-v1'")=='ingest-observation:7200'
    assert query("SELECT encode(sha256(convert_to(pg_get_functiondef('claim_bat_sale_snapshots(text,integer)'::regprocedure),'UTF8')),'base64')")=='xXb1hN6EnQDCcuDEtG+SZJ0nwwYuI6Tfu4u3ocNdsPE='
    assert query(f"SELECT encode(sha256(convert_to(command,'UTF8')),'base64') FROM cron.job WHERE {job}")=='AWFMWVBSwPlq8ZF2/FpDJNe4z/bmRc5IHjyW5qha2XY='
    query("UPDATE observation_extractors SET rate_limit_per_hour=2400 WHERE slug='bat-archived-sale-v1'")
    rejects(activation, 'activation contract changed')
    query("UPDATE observation_extractors SET rate_limit_per_hour=7200 WHERE slug='bat-archived-sale-v1'")
    query(new_claim)  #40 claim with120 command must fail the paired contract.
    rejects(activation, 'activation contract changed')
    query(new_claim.replace('p_limit NOT BETWEEN 1 AND 40','p_limit NOT BETWEEN 1 AND 120'))
    query(activation)
    query(parallel_stage)
    rejects(parallel_stage, 'preserve owner pause')
    query(activation)
    assert query(snapshot)==parallel_before and query(metadata)==owner
    assert '20' in query("BEGIN;SELECT count(*) FROM claim_bat_sale_snapshots('default20');ROLLBACK").splitlines()
    rejects("SELECT * FROM claim_bat_sale_snapshots('unbounded',121)", 'Invalid bounded worker')
    print('PASS staged120 paired job/claim/rate guards, replay, CI activation and default20; zero source/testimony/ACL drift',flush=True)
    def claim120(worker):
        return json.loads(query(f"SELECT jsonb_agg(to_jsonb(q)) FROM claim_bat_sale_snapshots('{worker}',120)q"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        batches120=list(pool.map(claim120,['parallel-a','parallel-b']))
    assert [len(b) for b in batches120]==[120,120]
    assert len({r['id'] for b in batches120 for r in b})==240
    a,b=batches120[0][0],batches120[1][0]
    b_result=query(f"SELECT fixture_observation('{b['source_snapshot_id']}')")
    assert query(f"SELECT finish_bat_sale_snapshot('{a['id']}','wrong','done','{b_result}')")=='f'
    rejects(f"SELECT finish_bat_sale_snapshot('{a['id']}','parallel-a','done','{b_result}')")
    for worker in ('parallel-a','parallel-b'):
        query(f"""DO $$ DECLARE r record;oid uuid;BEGIN
          FOR r IN SELECT * FROM derivation_queue WHERE status='claimed' AND locked_by='{worker}' LOOP
           SELECT id INTO oid FROM vehicle_observations WHERE source_snapshot_id=r.source_snapshot_id LIMIT 1;
           IF oid IS NULL THEN oid:=fixture_observation(r.source_snapshot_id);END IF;
           ASSERT finish_bat_sale_snapshot(r.id,'{worker}','done',oid);
          END LOOP;END $$;""")
    assert query("SELECT count(*) FROM derivation_queue WHERE status='done'")=='320'
    assert query('SELECT count(*) FROM vehicle_observations')=='320'
    read120=json.loads(query(f"SELECT read_bat_sale_intake('{a['source_snapshot_id']}')"))
    assert not read120['stale'] and read120['receipt']['original_parsed_at']=='2025-06-16T12:00:00Z'
    query(f"UPDATE vehicles SET is_public=false WHERE id='{a['source_vehicle_id']}'")
    assert json.loads(query(f"SELECT read_bat_sale_intake('{a['source_snapshot_id']}')"))['stale']
    query(f"UPDATE vehicles SET is_public=true WHERE id='{a['source_vehicle_id']}'")
    assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'")=='0'
    print('PASS actual parallel120+120 disjoint leases and240 protected results; CAS/parent privacy/source clocks preserved',flush=True)
