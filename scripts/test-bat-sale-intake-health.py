#!/usr/bin/env python3
"""Real protected sale results, bounded source reads and honest coverage."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'dm_refinement_[A-Za-z0-9_]+', database):
    raise SystemExit('Disposable dm_refinement_* database required')
command = [os.environ.get('NUKE_TEST_PSQL', 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', database]
root = Path(__file__).resolve().parents[1]
migration = root / 'supabase/migrations/20261008100653_bound_retained_sale_intake_health.sql'


def query(sql):
    r = subprocess.run(command + ['-c', sql], capture_output=True, text=True, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def apply(error=None):
    r = subprocess.run(command + ['-f', str(migration)], capture_output=True, text=True, timeout=15)
    if error:
        assert r.returncode != 0 and error in r.stderr, r.stderr
    else:
        assert r.returncode == 0, r.stderr


for file in ('supabase/sql/helpers/bat_sale_intake_fixture.sql',
             'supabase/migrations/20261008001520_automate_bat_archived_sale_intake.sql',
             'supabase/migrations/20261008013347_defer_bat_sale_intake_under_parent_locks.sql'):
    p = subprocess.run(command + ['-f', str(root / file)], capture_output=True, text=True, timeout=15)
    assert p.returncode == 0, p.stderr
query('SELECT fixture_capture(10001)')
query("""DO $$ DECLARE r record;BEGIN FOR r IN SELECT * FROM claim_bat_sale_snapshots('health-first',20) LOOP
 ASSERT finish_bat_sale_snapshot(r.id,'health-first','done',fixture_observation(r.source_snapshot_id));END LOOP;END $$;""")
snapshot_sql = """SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),
 md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM derivation_queue q)),
 md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM listing_page_snapshots s)),
 md5((SELECT jsonb_agg(to_jsonb(s))::text FROM bat_sale_replay_state s)),
 md5((SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid)::text FROM cron.job j))"""
metadata_sql = "SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef,'volatility',provolatile) FROM pg_proc WHERE oid='assay_bat_sale_intake()'::regprocedure"
snapshot = query(snapshot_sql)
metadata = query(metadata_sql)
apply()
print('Assay SHA:', query("SELECT encode(sha256(convert_to(pg_get_functiondef('assay_bat_sale_intake()'::regprocedure),'UTF8')),'base64')"), flush=True)
apply()
assert query(snapshot_sql) == snapshot and query(metadata_sql) == metadata
new_definition = query("SELECT pg_get_functiondef('assay_bat_sale_intake()'::regprocedure)")
query("CREATE OR REPLACE FUNCTION assay_bat_sale_intake() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$")
apply('Protected sale assay owner changed')
query(new_definition)
small = json.loads(query('SELECT assay_bat_sale_intake()'))
assert small['status'] == 'passed' and small['full_qualified_custody_verified'] is True, small
assert small['counts']['qualified_receipts_sampled'] == small['counts']['qualified_receipts_total'] == 1
assert small['counts']['qualified_receipts_capped'] is False
query('SELECT fixture_capture(i) FROM generate_series(10002,10301)i')
for batch in range(15):
    query(f"""DO $$ DECLARE r record;BEGIN FOR r IN SELECT * FROM claim_bat_sale_snapshots('health-{batch}',20) LOOP
     ASSERT finish_bat_sale_snapshot(r.id,'health-{batch}','done',fixture_observation(r.source_snapshot_id));
     END LOOP;END $$;""")
assert query("SELECT count(*) FROM derivation_queue WHERE status='done'") == '301'
snapshot = query(snapshot_sql)
apply()
assert query(snapshot_sql) == snapshot, 'Replay on populated work must not ingest'

# Instrument actual source SHA reads in this disposable fixture. More than200
# raises; the real assay must read each chosen source and preserve its predicates.
# FKs/triggers continue to reference the renamed underlying source table.
query("""ALTER TABLE listing_page_snapshots RENAME TO fixture_source_snapshots;
 CREATE FUNCTION fixture_source_sha(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$ DECLARE n integer;BEGIN
 n:=coalesce(nullif(current_setting('nuke_test.sale_reads',true),''),'0')::integer+1;
 IF n>200 THEN RAISE EXCEPTION 'source read cap exceeded';END IF;
 PERFORM set_config('nuke_test.sale_reads',n::text,true);RETURN value;END $$;
 CREATE VIEW listing_page_snapshots AS SELECT id,platform,success,http_status,fixture_source_sha(html_sha256) html_sha256,
 metadata,html,fetched_at,created_at FROM fixture_source_snapshots;
 GRANT SELECT ON listing_page_snapshots TO service_role;
 CREATE FUNCTION fixture_sale_health_probe() RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE r jsonb;BEGIN
 PERFORM set_config('nuke_test.sale_reads','0',true);r:=assay_bat_sale_intake();
 RETURN r||jsonb_build_object('test_source_reads',current_setting('nuke_test.sale_reads')::integer);END $$;""")
query('ANALYZE derivation_queue;ANALYZE vehicles;ANALYZE fixture_source_snapshots;ANALYZE vehicle_observations')


def read():
    return json.loads(query('SELECT fixture_sale_health_probe()'))


reading = read()
c = reading['counts']
assert c['qualified'] == c['canonical_observations'] == c['qualified_receipts_total'] == 301, reading
assert c['qualified_receipts_sampled'] == reading['test_source_reads'] == 200, reading
assert c['stale_qualified'] == 0 and c['qualified_receipts_capped'] is True, reading
assert reading['status'] == 'partial' and reading['full_qualified_custody_verified'] is False, reading
assert json.loads(query('SET ROLE service_role;SELECT assay_bat_sale_intake()'))['counts']['qualified'] == 301
assert query("SELECT assay_status FROM v_job_health WHERE jobname='qualify-bat-archived-sales'") == 'partial'
for order in ('ASC', 'DESC'):
    vehicle = query(f'SELECT source_vehicle_id FROM derivation_queue ORDER BY completed_at {order},id {order} LIMIT 1')
    query(f"UPDATE vehicles SET is_public=false WHERE id='{vehicle}'")
    reading = read()
    assert reading['status'] == 'failed' and reading['counts']['stale_qualified'] == 1, (order, reading)
    query(f"UPDATE vehicles SET is_public=true WHERE id='{vehicle}'")
snapshot_id = query('SELECT source_snapshot_id FROM derivation_queue ORDER BY completed_at DESC,id DESC LIMIT 1')
query(f"UPDATE fixture_source_snapshots SET html_sha256=repeat('b',64) WHERE id='{snapshot_id}'")
reading = read()
assert reading['status'] == 'failed' and reading['counts']['stale_qualified'] == 1, reading
query(f"UPDATE fixture_source_snapshots SET html_sha256=repeat('a',64) WHERE id='{snapshot_id}'")
query(f"UPDATE fixture_source_snapshots SET metadata=jsonb_set(metadata,'{{parsed_at}}','\"changed\"') WHERE id='{snapshot_id}'")
assert read()['status'] == 'failed'
query(f"UPDATE fixture_source_snapshots SET metadata=jsonb_set(metadata,'{{parsed_at}}','\"2025-06-16T12:00:00Z\"') WHERE id='{snapshot_id}'")
query("CREATE OR REPLACE FUNCTION fixture_source_sha(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_CAPTURE_DO_NOT_REPORT';END $$")
reading = read()
assert reading['status'] == 'unavailable' and reading['sqlstate'] == 'P0001' and reading['full_qualified_custody_verified'] is False
assert 'PRIVATE_CAPTURE' not in json.dumps(reading), reading
assert query("SELECT assay_status FROM v_job_health WHERE jobname='qualify-bat-archived-sales'") == 'unavailable'
query('DROP VIEW listing_page_snapshots;ALTER TABLE fixture_source_snapshots RENAME TO listing_page_snapshots')
query('SELECT fixture_capture(10400)')
query("SELECT defer_bat_sale_snapshot(md5('fixture-capture-10400')::uuid)")
assert read()['counts']['pending'] == 1 and read()['counts']['deferred'] == 1
query("UPDATE bat_sale_replay_state SET started_at=now()-interval '30 minutes',last_seed_at=NULL,last_finished_at=NULL")
assert read()['status'] == 'failed', 'Original15min stall semantics retained'
query('UPDATE bat_sale_replay_state SET started_at=now()')
query("UPDATE derivation_queue SET status='failed' WHERE evidence_id=md5('fixture-capture-10400')::uuid")
assert read()['status'] == 'failed' and read()['counts']['failed'] == 1
assert query("SELECT bool_and(NOT has_function_privilege(r,'assay_bat_sale_intake()','EXECUTE')) FROM unnest(ARRAY['anon','authenticated'])r") == 't'
assert query("SELECT has_function_privilege('service_role','assay_bat_sale_intake()','EXECUTE')") == 't'
assert query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'") == '0'
print('PASS301protected results/exact counters, exactly200real source reads, explicit cap/partial coverage, oldest/newest privacy/SHA/parse withdrawal, unavailable private errors, deferral/stall/failure, unchanged data/ACL/replay/drift and registered health consumer')
