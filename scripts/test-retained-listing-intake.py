#!/usr/bin/env python3
"""Disposable local/CI PG17 proof using the existing real retained-property fixture/readers."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import sys

host = os.environ.get('PGHOST', '/private/tmp')
port = os.environ.get('PGPORT', '5432' if host == 'localhost' else '55438')
assert len(sys.argv)<=5 and set(sys.argv[2:]) <= {'--two-front','--bulk120','--powertrain'}
database = sys.argv[1] if len(sys.argv)>=2 else 'dm_refinement_listing_intake_ci'
two_front = '--two-front' in sys.argv[2:]
bulk120 = '--bulk120' in sys.argv[2:]
powertrain = '--powertrain' in sys.argv[2:]
assert not powertrain or (two_front and bulk120)
assert host in ('localhost', '/private/tmp') and database.startswith('dm_refinement_listing_')
psql = os.environ.get('NUKE_TEST_PSQL', 'psql')
def sql(text):
    return subprocess.check_output([psql, '-X', '-h', host, '-p', port, '-d', database,
        '-v', 'ON_ERROR_STOP=1', '-At', '-c', text], text=True, stderr=subprocess.PIPE).strip()
def read(text):
    return json.loads(sql(text))
def rejects(text):
    try:
        sql(text)
    except subprocess.CalledProcessError as error:
        assert 'ERROR:' in error.stderr
        return
    raise AssertionError('unexpected acceptance')
def passed(label):
    print('PASS', label, flush=True)

fixture = Path('scripts/discovery/retained-listing-property-test.mjs').read_text()
setup = re.search(r' sql\(`(DO \$\$ BEGIN IF NOT EXISTS[\s\S]+?)`\);', fixture).group(1)
assert '${' not in setup
setup = setup.replace('44444444-4444-4444-8444-444444444444', '514cacd3-82b4-4330-b3df-e292612ee718')
sql(setup)
reader = Path('supabase/migrations/20261005013641_bounded_field_provenance_inputs.sql').read_text()
sql(reader[reader.index('CREATE OR REPLACE FUNCTION public.get_field_provenance'):reader.index('$function$;') + 12])
view = Path('scripts/discovery/fixtures/vehicle_canonical_20260517.sql').read_text()
sql(view[view.index('CREATE OR REPLACE VIEW public.vehicle_canonical'):view.index('COMMENT ON VIEW')])
sql(Path('supabase/migrations/20261005083255_retained_listing_interior_property.sql').read_text())
sql(Path('supabase/migrations/20261005134051_retained_listing_exterior_property.sql').read_text())
sql("""
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
ALTER TABLE vehicle_observations ADD COLUMN agent_cost_cents numeric DEFAULT 0;
CREATE INDEX fixture_kind_time ON vehicle_observations(kind,ingested_at DESC);
CREATE INDEX fixture_source_unique ON vehicle_observations(source_id,source_identifier,kind);
CREATE TABLE observation_extractors(source_id uuid,slug text UNIQUE,display_name text,extractor_type text,
 edge_function_name text,extractor_config jsonb,produces_kinds observation_kind[],is_active boolean,
 schedule_type text,rate_limit_per_hour integer,min_interval_seconds integer);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
CREATE TABLE cron.job_run_details(jobid bigint,status text,start_time timestamptz,return_message text);
CREATE FUNCTION cron.schedule(job_name text,job_schedule text,job_command text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE j bigint;BEGIN INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,job_schedule,job_command) RETURNING jobid INTO j;RETURN j;END $$;
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,active boolean DEFAULT NULL)
 RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET schedule=coalesce($2,job.schedule),command=coalesce($3,job.command),active=coalesce($4,job.active) WHERE jobid=$1 $$;
INSERT INTO vehicles(id,is_public,listing_kind) SELECT ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,true,'vehicle' FROM generate_series(1,600)i;
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data)
SELECT ('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
 '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/fixture-'||i,NULL,
 '2026-09-01'::timestamptz+i*interval '1 microsecond','html_match',0.7,
 jsonb_build_object('interior_color','Exact Black Vinyl','color','Exact Signal Red') FROM generate_series(1,600)i;
""")
for name in ('assay_bat_sale_intake','assay_vehicle_taxonomy_fold','assay_sale_residual_fold','assay_vehicle_metric_fold','assay_vin_reference_intake'):
    sql(f"CREATE FUNCTION {name}() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{\"status\":\"passed\"}}'::jsonb $$")
sql("CREATE FUNCTION get_live_auction_health() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{\"closing_stream\":{\"status\":\"passed\"}}'::jsonb $$")
sql(Path('scripts/discovery/fixtures/v_job_health_20261008.sql').read_text())
migration = Path('supabase/migrations/20261008071324_retained_listing_property_intake.sql').read_text()
if two_front:
    sql("""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data)
    SELECT ('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
     ('60000001-0000-4000-8000-'||lpad(((i-1)%600+1)::text,12,'0'))::uuid,'listing',
     '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/unsupported-'||i,NULL,
     '2026-01-01'::timestamptz,'llm_extraction',0.7,'{}'::jsonb FROM generate_series(1,1500)i;""")
assert sql("SELECT encode(sha256(convert_to(pg_get_functiondef('validate_retained_listing_property_source()'::regprocedure),'UTF8')),'base64')") == 'SWMULpmuOum3+TVBNd+ZsReIk9lCqTFx/Vsa1IoqSOQ='
sql(migration)
assert sql("SELECT active FROM cron.job") == 'f'
assert sql("SELECT count(*) FROM retained_listing_property_work") == '0'
if two_front:
    assert sql('SELECT seed_retained_listing_properties()')=='500'
    assert sql('SELECT count(*) FROM retained_listing_property_work')=='0'
    before_front = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    passed('oldest-first negative control visits500 unsupported tied-clock sources with0work')
    repair = Path('supabase/migrations/20261008082930_prioritize_retained_listing_replay.sql').read_text()
    before_seed = sql("SELECT pg_get_functiondef('seed_retained_listing_properties()'::regprocedure)")
    before_enqueue = sql("SELECT pg_get_functiondef('enqueue_retained_listing_properties(uuid)'::regprocedure)")
    before_command = read('SELECT to_jsonb(command) FROM cron.job')
    rejects(repair)  # staged existing job is paused
    assert sql("SELECT count(*) FROM pg_attribute WHERE attrelid='retained_listing_property_replay'::regclass AND attname='scan_direction'")=='0'
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    sql("UPDATE cron.job SET command=command||' SELECT 1;'")
    rejects(repair)
    sql("UPDATE cron.job SET command="+"'"+before_command.replace("'","''")+"'")
    sql(before_seed.replace('keys_seen=keys_seen+n','keys_seen=keys_seen+n+0'))
    rejects(repair)
    sql(before_seed)
    sql(before_enqueue.replace("p.kind='listing'","p.kind='listing' AND true"))
    rejects(repair)
    sql(before_enqueue)
    assert read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')==before_front
    assert sql("SELECT count(*) FROM pg_attribute WHERE attrelid='retained_listing_property_replay'::regclass AND attname='scan_direction'")=='0'
    before_acl = read("SELECT jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='seed_retained_listing_properties()'::regprocedure")
    sql(repair)
    seed_sha=sql("SELECT encode(sha256(convert_to(pg_get_functiondef('seed_retained_listing_properties()'::regprocedure),'UTF8')),'base64')")
    print('REPAIRED_SEED_SHA',seed_sha,flush=True)
    assert read("SELECT jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='seed_retained_listing_properties()'::regprocedure")==before_acl
    after_front = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    assert all(after_front[k]==v for k,v in before_front.items())
    rejects("UPDATE retained_listing_property_replay SET reverse_cursor_source_id=upper_source_id")
    assert sql("SELECT count(*) FROM pg_constraint WHERE conrelid='retained_listing_property_replay'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%reverse_cursor_source_id%'")=='1'
    passed('paused/command/seed/qualification drift rolls back; existing cursor/highwater/ACL preserved; reverse cursor typed and paired')
assert sql("SELECT seed_retained_listing_properties()") == '500'
assert sql("SELECT count(*) FROM retained_listing_property_work") == '1000'
assert sql("SELECT seed_retained_listing_properties()") == '0'
assert sql("SELECT keys_seen FROM retained_listing_property_replay") == ('1000' if two_front else '500')
if two_front:
    assert sql("SELECT scan_direction FROM retained_listing_property_replay")=='oldest'
    assert sql("SELECT reverse_cursor_recorded_at>'2026-01-01'::timestamptz FROM retained_listing_property_replay")=='t'
    passed('first new500-key page reaches recent supported sources despite1500old unsupported keys; backpressure does not move either front')
assert sql("SELECT assay_status FROM v_job_health WHERE jobname='project-retained-listing-properties'") == 'partial'
passed('real staged migration, exact owner fingerprint, 500-key scan/backpressure without canonical writes')

# Stage the measured120 ceiling only after the real existing intake/replay setup.
if bulk120:
    ceiling = Path('supabase/migrations/20261008104856_raise_retained_listing_batch_ceiling.sql').read_text()
    snapshot = sql("SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text FROM retained_listing_property_work q))")
    owners = sql("SELECT jsonb_agg(jsonb_build_object('name',proname,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN('claim_retained_listing_properties(text,integer)'::regprocedure,'activate_retained_listing_property_intake()'::regprocedure)")
    sql('UPDATE cron.job SET active=false')
    rejects(ceiling)
    assert sql('SELECT active FROM cron.job')=='f'
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    command = read('SELECT to_json(command) FROM cron.job')
    for batch in ('61','600'):
        sql(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":60}}','\"batch_size\":{batch}}}')")
        rejects(ceiling)
        sql("UPDATE cron.job SET command="+"'"+command.replace("'","''")+"'")
    sql('UPDATE observation_extractors SET min_interval_seconds=61')
    rejects(ceiling)
    assert sql('SELECT rate_limit_per_hour FROM observation_extractors')=='3600'
    sql('UPDATE observation_extractors SET min_interval_seconds=60')
    before_claim = sql("SELECT pg_get_functiondef('claim_retained_listing_properties(text,integer)'::regprocedure)")
    sql("CREATE OR REPLACE FUNCTION claim_retained_listing_properties(p_worker text,p_limit integer DEFAULT 20) RETURNS TABLE(source_observation_id uuid,property_id uuid,mode text) LANGUAGE sql AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text WHERE false $$")
    rejects(ceiling)
    assert sql('SELECT rate_limit_per_hour FROM observation_extractors')=='3600'
    sql(before_claim)
    sql(ceiling)
    assert sql('SELECT active FROM cron.job')=='f'
    assert sql("SELECT command LIKE '%\"batch_size\":120}%' FROM cron.job")=='t'
    assert sql("SELECT rate_limit_per_hour=7200 AND min_interval_seconds=60 AND extractor_config->>'batch_size'='120' FROM observation_extractors")=='t'
    assert sql("SELECT jsonb_agg(jsonb_build_object('name',proname,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN('claim_retained_listing_properties(text,integer)'::regprocedure,'activate_retained_listing_property_intake()'::regprocedure)")==owners
    assert sql("SELECT md5((SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM vehicle_observations o)),md5((SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text FROM retained_listing_property_work q))")==snapshot
    for batch in ('121','600'):
        sql(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":120}}','\"batch_size\":{batch}}}')")
        rejects('SELECT activate_retained_listing_property_intake()')
        assert sql('SELECT active FROM cron.job')=='f'
        sql(f"UPDATE cron.job SET command=replace(command,'\"batch_size\":{batch}}}','\"batch_size\":120}}')")
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    sql(ceiling)
    rejects(ceiling)  # A paused job cannot imply a reason to revive it.
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    default = sql("BEGIN;SELECT count(*) FROM claim_retained_listing_properties('default20');ROLLBACK;")
    assert '20' in default.splitlines()
    passed('120staged contract, pause/job/config/owner atomic guards, exact activation/replay, unchanged data/access/default20')

claim_limit = 120 if bulk120 else 60
def claim(worker, limit=None):
    limit = claim_limit if limit is None else limit
    return read(f"SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM claim_retained_listing_properties('{worker}',{limit})q")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    batches = list(pool.map(claim, ['parallel-a', 'parallel-b']))
assert [len(b) for b in batches] == [claim_limit, claim_limit]
assert len({(r['source_observation_id'], r['property_id']) for b in batches for r in b}) == 2*claim_limit
rejects(f"SELECT * FROM claim_retained_listing_properties('too-many',{claim_limit+1})")
passed(f'actual simultaneous {claim_limit}+{claim_limit} SKIPLOCKED claims, distinct source-property keys, {claim_limit+1} refused')

counter = 0
def complete(row, worker):
    global counter
    counter += 1
    output = f'70000000-0000-4000-8000-{counter:012d}'
    source, prop, mode = row['source_observation_id'], row['property_id'], row['mode']
    key = 'interior_color' if 'interior' in mode else 'exterior_color'
    field = 'interior_color' if key == 'interior_color' else 'color'
    sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,
     raw_source_ref,observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
    SELECT '{output}',vehicle_id,'specification',source_id,source_url,'{prop}','{mode}:'||id::text,
     'vehicle_observations:'||id::text,ingested_at,'retained_listing_property_projection_v1',0.6,
     jsonb_build_object('{key}',structured_data->'{field}','source_observation_id',id,'claim_role','listing_claim',
      'observed_at_basis','source_testimony_recorded_at','source_field','{field}','property_key','{key}',
      'projection_version','{mode}','analysis_kind','retained_listing_property_projection','source_recorded_at',ingested_at,
      'source_observed_at',observed_at,'source_confidence_score',confidence_score,'source_extraction_method',extraction_method,
      'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false),
     id,'fixture-canonical-{counter}','Retained listing claim. Unknown factory/current configuration.'
    FROM vehicle_observations WHERE id='{source}';""")
    assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','wrong-worker','done','{output}')") == 'f'
    assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','{worker}','done','{source}')") == 'f'
    assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','{worker}','done','{output}')") == 't'
    assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','{worker}','done','{output}')") == 'f'
    return output

for worker, batch in zip(['parallel-a', 'parallel-b'], batches):
    for row in batch:
        complete(row, worker)
while True:
    batch = claim('replay')
    if not batch:
        break
    for row in batch:
        complete(row, 'replay')
assert counter == 1202
assert sql("SELECT keys_seen FROM retained_listing_property_replay") == ('2101' if two_front else '601')
assert sql("SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay") == 't'
assert sql("SELECT count(*) FROM vehicle_observations WHERE kind='listing' AND source_observation_id IS NOT NULL") == '0'
passed('1202 protected canonical source-property results; wrong worker/result/replayed finish refused; original testimony retained')
if powertrain:
    # Extend the same real intake/replay fixture after its entire color scan.
    # Historical completions stay present while a new projection epoch replays.
    sql("""INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds) VALUES
    ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b','engine_configuration','core',ARRAY['specification']),
    ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a','engine_displacement_l','core',ARRAY['specification']),
    ('235aed17-9bd3-4886-90be-9b1a8e2d1844','transmission_type','core',ARRAY['specification']),
    ('32b51f19-e5cf-4f67-81d9-96c2d30885a1','drivetrain_layout','core',ARRAY['specification']);
    UPDATE vehicle_observations SET structured_data=structured_data||'{"engine_size":"302ci V8","transmission":"Four-Speed Manual","drivetrain":"4WD"}'::jsonb
     WHERE kind='listing' AND extraction_method='html_match';""")
    garage = Path('supabase/migrations/20261008050000_garage_owner_corrections.sql').read_text()
    sql(garage[garage.index('CREATE OR REPLACE VIEW public.vehicle_canonical'):garage.index('CREATE OR REPLACE FUNCTION public.notify_subscribers_on_observation')])
    sql(Path('supabase/migrations/20261010150757_retained_listing_powertrain_properties.sql').read_text())
    scale = Path('supabase/migrations/20261010164331_expand_retained_listing_property_replay.sql').read_text()
    prior_scan = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    prior_colors = sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q")
    owners = read("SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN('enqueue_retained_listing_properties(uuid)'::regprocedure,'claim_retained_listing_properties(text,integer)'::regprocedure,'retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure,'seed_retained_listing_properties()'::regprocedure,'assay_retained_listing_properties()'::regprocedure)")
    sql('UPDATE cron.job SET active=false')
    rejects(scale)
    assert sql("SELECT count(*) FROM pg_attribute WHERE attrelid='retained_listing_property_replay'::regclass AND attname='projection_version'")=='0'
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    fn = sql("SELECT pg_get_functiondef('retained_powertrain_value(text,jsonb)'::regprocedure)")
    sql(fn.replace("p_key='drivetrain_layout'", "p_key='drivetrain_layout' AND true"))
    rejects(scale)
    sql(fn)
    sql(scale)
    assert sql('SELECT active FROM cron.job')=='f'
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay')==prior_scan
    assert sql("SELECT keys_seen=0 AND work_seeded=0 AND projection_version='retained_listing_six_properties_v1' AND scan_completed_at IS NULL AND cursor_source_id IS NULL AND reverse_cursor_source_id IS NULL FROM retained_listing_property_replay")=='t'
    assert sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q")==prior_colors
    assert read("SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN('enqueue_retained_listing_properties(uuid)'::regprocedure,'claim_retained_listing_properties(text,integer)'::regprocedure,'retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure,'seed_retained_listing_properties()'::regprocedure,'assay_retained_listing_properties()'::regprocedure)")==owners
    passed('six-property epoch preserves all1202 color completions, prior scan/OIDs/ACL; pause and normalizer drift roll back atomically')
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    sql("""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data)
    VALUES('90000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','listing',
    '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/late-powertrain',NULL,'2026-08-01','html_match',0.7,
    '{"engine_size":"302ci V8","transmission":"Manual or Automatic","drivetrain":"unknown"}');""")
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id='90000000-0000-4000-8000-000000000001'")=='2'
    assert sql("SELECT enqueue_retained_listing_properties('90000000-0000-4000-8000-000000000001')")=='0'
    projected = 0
    while True:
        batch = claim('powertrain-replay')
        if not batch:
            if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay')=='t': break
            continue
        for row in batch:
            source, prop, mode = row['source_observation_id'], row['property_id'], row['mode']
            key = mode[len('retained_listing_'):-3]
            field = 'transmission' if key=='transmission_type' else 'drivetrain' if key=='drivetrain_layout' else 'engine_size'
            projected += 1
            output=f'91000000-0000-4000-8000-{projected:012d}'
            sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,raw_source_ref,
             observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
             SELECT '{output}',vehicle_id,'specification',source_id,source_url,'{prop}','{mode}:'||id::text,'vehicle_observations:'||id::text,
             ingested_at,'retained_listing_property_projection_v1',0.6,jsonb_build_object('{key}',retained_powertrain_value('{key}',structured_data->'{field}'),
             'source_observation_id',id,'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at','source_field','{field}',
             'property_key','{key}','projection_version','{mode}','analysis_kind','retained_listing_property_projection','source_recorded_at',ingested_at,
             'source_observed_at',observed_at,'source_confidence_score',confidence_score,'source_extraction_method',extraction_method,
             'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false,
             'source_value',structured_data->'{field}','normalization_version','retained_powertrain_v1'),id,'powertrain-canonical-{projected}',
             'Retained powertrain claim. Unknown factory/current configuration.' FROM vehicle_observations WHERE id='{source}';""")
            assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','wrong-worker','done','{output}')")=='f'
            assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','powertrain-replay','done','{source}')")=='f'
            assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','powertrain-replay','done','{output}')")=='t'
    assert projected==2406 #601 baseline parents x4, plus2 from the late ambiguous source
    assert sql('SELECT keys_seen=2102 AND work_seeded=2404 AND scan_completed_at IS NOT NULL FROM retained_listing_property_replay')=='t'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='done'")=='3608'
    assert sql('SELECT seed_retained_listing_properties()')=='0'
    assay=read('SELECT assay_retained_listing_properties()')
    assert assay['sample_stale']==0 and assay['completed_work']==3608
    assert sum(x['work_items'] for x in assay['property_work'])==3608
    assert assay['recent_new_claims']==3608 and assay['recent_completed_work']==3608
    assert sql("SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='22222222-2222-4222-8222-222222222222'")=='6'
    assert any(x.get('source_value')=='302ci V8' for x in read("SELECT get_field_provenance('22222222-2222-4222-8222-222222222222','engine_configuration')")['observations'])
    passed('full2102-key replay reaches all601baseline eligible parents plus late arrival, adds2404powertrain work; exact per-property/30min yield and real public readers')
    # Withdrawing/altering parent testimony invalidates persisted completion too.
    source='60000000-0000-4000-8000-000000000001'
    prop='c0f743ae-dc94-4dfd-98ef-514b76f74a9b'
    result=sql(f"SELECT observation_id FROM retained_listing_property_work WHERE source_observation_id='{source}' AND property_id='{prop}'")
    sql(f"UPDATE vehicle_observations SET structured_data=structured_data||'{{\"engine_size\":\"302ci Small-Block V8\"}}'::jsonb WHERE id='{source}'")
    assert sql(f"SELECT retained_listing_property_result_matches('{source}','{prop}','{result}')")=='f'
    sql('UPDATE vehicles SET is_public=false')
    assert sql('SELECT count(*) FROM vehicle_canonical')=='0'
    assert read('SELECT assay_retained_listing_properties()')['sample_stale']==200
    for role in ('anon','authenticated'):
        assert sql(f"SELECT has_function_privilege('{role}','claim_retained_listing_properties(text,integer)','EXECUTE')")=='f'
    rejects(scale)
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='done'")=='3608'
    passed('changed raw parent invalidates canonical completion; private withdrawals remove readers; public dispatch/raw writes denied; repeat epoch migration refuses')
    sys.exit(0)
if two_front:
    assert sql("SELECT reverse_cursor_recorded_at='2026-01-01'::timestamptz AND cursor_recorded_at='2026-01-01'::timestamptz FROM retained_listing_property_replay")=='t'
    assert sql('SELECT seed_retained_listing_properties()')=='0'
    if not bulk120:
        sql(repair)  # Its original60 command guard predates the120 deployment.
    assert sql('SELECT keys_seen FROM retained_listing_property_replay')=='2101'
    passed('both fronts converge across tied-clock gap:2101unique visits/1202canonical results, no duplicate visit and idempotent replay')

reading = read('SELECT assay_retained_listing_properties()')
assert reading['canonical_observations'] == 1202 and reading['custody_sampled'] == 200 and reading['sample_stale'] == 0
assert reading['status'] == 'partial' and not reading['full_current_custody_verified']
assert sql("SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='22222222-2222-4222-8222-222222222222' AND property_id IN('514cacd3-82b4-4330-b3df-e292612ee718','efcb8c61-1ff5-4790-890e-2e09118e87e3')") == '2'
provenance = read("SELECT get_field_provenance('22222222-2222-4222-8222-222222222222','interior_color')")
assert any(r.get('source_observation_id') == '11111111-1111-4111-8111-111111111111' for r in provenance['observations'])
sql('UPDATE vehicles SET is_public=false')
assert read('SELECT assay_retained_listing_properties()')['sample_stale'] == 200
assert sql('SELECT count(*) FROM vehicle_canonical') == '0'
sql('UPDATE vehicles SET is_public=true')
passed('real public readers retain original source edges/clock; privacy withdrawal excludes claims; 200-capped assay never reports whole-corpus custody')

# A late commit's source recording clock can precede the completed scanner.
sql("""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data)
VALUES('80000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','listing',
 '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/late-clock',NULL,'2026-08-01',
 'html_match',0.7,'{"interior_color":"Late Black","color":"Late Red"}');""")
assert sql("SELECT enqueue_retained_listing_properties('80000000-0000-4000-8000-000000000001')") == '0'
late = claim('late', 20)
assert len(late) == 2
r = late[0]
args = f"'{r['source_observation_id']}','{r['property_id']}','late'"
assert sql(f"SELECT finish_retained_listing_property({args},'deferred')") == 't'
assert sql(f"SELECT attempts FROM retained_listing_property_work WHERE source_observation_id='{r['source_observation_id']}' AND property_id='{r['property_id']}'") == '0'
other = late[1]
assert sql(f"SELECT finish_retained_listing_property('{other['source_observation_id']}','{other['property_id']}','late','refused')") == 't'
assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='skipped' AND attempts=0 AND next_attempt_at>now()+interval '23 hours'") == '1'
for i in range(3):
    sql("UPDATE retained_listing_property_work SET next_attempt_at=now() WHERE status='pending'")
    retry = claim('retry')
    assert len(retry) == 1
    rr = retry[0]
    assert sql(f"SELECT finish_retained_listing_property('{rr['source_observation_id']}','{rr['property_id']}','retry','retry')") == 't'
assert read('SELECT assay_retained_listing_properties()')['failed'] == 1
assert sql("SELECT assay_status FROM v_job_health WHERE jobname='project-retained-listing-properties'") == 'failed'
sql('UPDATE cron.job SET active=false')
assert sql("SELECT health_status FROM v_job_health WHERE jobname='project-retained-listing-properties'") == 'paused'
assert sql('SELECT activate_retained_listing_property_intake()') == 't'
sql("INSERT INTO cron.job_run_details SELECT jobid,'succeeded',now(),NULL FROM cron.job")
assert sql("SELECT health_status FROM v_job_health WHERE jobname='project-retained-listing-properties'") == 'failed'
passed('new out-of-order-clock insert enqueues after finite replay; exact duplicate suppressed; budget/24h refusal/three retries remain distinct')

sql("UPDATE retained_listing_property_work SET attempts=CASE status WHEN 'failed' THEN 3 ELSE 1 END,status='claimed',locked_by='expired-fixture',locked_at=now()-interval '11 minutes' WHERE status IN('failed','skipped')")
assert claim('lease-recovery') == []
assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='failed' AND last_error='lease_expired' AND locked_at IS NULL") == '1'
assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='pending' AND last_error='lease_expired' AND next_attempt_at>now()+interval '14 minutes' AND locked_at IS NULL") == '1'
passed('actual expired leases clear ownership, retry waits15min, exhausted attempt remains failed')

assert sql('SELECT activate_retained_listing_property_intake()') == 't'
sql("UPDATE cron.job SET active=false,command=command||' SELECT 1;' ")
rejects('SELECT activate_retained_listing_property_intake()')
before = sql('SELECT count(*) FROM retained_listing_property_work')
rejects(migration)
assert sql('SELECT count(*) FROM retained_listing_property_work') == before
assert sql('SELECT active FROM cron.job') == 'f'
for role in ('anon', 'authenticated', 'service_role'):
    assert sql(f"SELECT has_function_privilege('{role}','activate_retained_listing_property_intake()','EXECUTE')") == 'f'
    assert sql(f"SELECT has_table_privilege('{role}','retained_listing_property_work','INSERT')") == 'f'
for role in ('anon', 'authenticated'):
    assert sql(f"SELECT has_function_privilege('{role}','claim_retained_listing_properties(text,integer)','EXECUTE')") == 'f'
assert sql("SELECT has_function_privilege('service_role','claim_retained_listing_properties(text,integer)','EXECUTE')") == 't'
assert sql("SELECT count(*) FROM pg_attribute WHERE attrelid IN('retained_listing_property_work'::regclass,'retained_listing_property_replay'::regclass) AND attnum>0 AND NOT attisdropped AND col_description(attrelid,attnum) IS NULL") == '0'
sql("DELETE FROM retained_listing_property_replay")
assert read('SELECT assay_retained_listing_properties()')['status'] == 'unavailable'
passed(f'changed activation contract/repeated migration roll back; API activation/raw writes denied; all {24 if two_front else 21} owned columns described')
print('PASS retained listing intake actual PostgreSQL proof', flush=True)
