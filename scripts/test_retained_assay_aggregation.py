"""Exact assay differential and synthetic scale proof in the existing PG17 fixture."""
import json
from pathlib import Path


def run_assay_aggregation_checks(sql, read, rejects, passed):
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    name = 'public.assay_retained_listing_properties'
    before_name = name + '_aggregation_before'
    original = sql(f"SELECT pg_get_functiondef('{name}()'::regprocedure)")
    sql(original.replace(f'FUNCTION {name}(', f'FUNCTION {before_name}('))
    snapshot = """SELECT jsonb_build_object(
      'identity',(SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'security',prosecdef,
        'config',proconfig,'volatility',provolatile,'parallel',proparallel,'cost',procost)
        FROM pg_proc WHERE oid='public.assay_retained_listing_properties()'::regprocedure),
      'work',(SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q),
      'replay',(SELECT md5(to_jsonb(r)::text) FROM retained_listing_property_replay r WHERE id),
      'job',(SELECT md5(to_jsonb(j)::text) FROM cron.job j WHERE jobname='project-retained-listing-properties'),
      'observations',(SELECT md5(jsonb_agg(to_jsonb(o) ORDER BY id)::text) FROM vehicle_observations o),
      'custody',md5(pg_get_functiondef('retained_listing_property_result_matches(uuid,uuid,uuid)'::regprocedure)),
      'reader',md5(pg_get_viewdef('vehicle_canonical'::regclass,true)),
      'indexes',(SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes
        WHERE schemaname='public' AND tablename IN('retained_listing_property_work','retained_listing_property_replay')))
    """
    initial = read(snapshot)
    migration = Path('supabase/migrations/20261013144500_consolidate_retained_listing_assay.sql').read_text()
    sql(f'ALTER FUNCTION {name}() COST 101')
    rejects(migration)
    sql(original)
    assert read(snapshot) == initial
    sql(original.replace("'factory_configuration_verified',false", "'factory_configuration_verified',true"))
    rejects(migration)
    sql(original)
    sql(migration)
    assert read(snapshot) == initial
    repaired = sql(f"SELECT pg_get_functiondef('{name}()'::regprocedure)")
    sql(migration)  # Exact already-applied definition is a no-op.
    assert sql(f"SELECT pg_get_functiondef('{name}()'::regprocedure)") == repaired
    assert read(snapshot) == initial
    sql(f'ALTER FUNCTION {name}() COST 101')
    rejects(migration)
    sql(repaired)
    passed('assay migration: exact baseline/repaired drift refuse; identical retry is a no-op; OID/ACL/config/data/queue/custody/readers/indexes unchanged')

    def equal(label, setup='', expected=None):
        # Both functions share one statement clock and snapshot; compare every
        # field, including measured_at, source_scan, nulls and array ordering.
        output = sql(f"BEGIN;{setup}\nSELECT jsonb_build_object('before',{before_name}(),'after',{name}());ROLLBACK;")
        pair = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
        assert pair['before'] == pair['after'], (label, pair)
        if expected:
            for key, value in expected.items():
                assert pair['after'][key] == value, (label, key, pair['after'])
        return pair['after']

    current = equal('real retained replay')
    assert current['status'] != 'unavailable'
    assert sql("SELECT assay_status FROM v_job_health WHERE jobname='project-retained-listing-properties'") == current['status']
    equal('empty complete work', 'DELETE FROM retained_listing_property_work;', {
        'work': {}, 'property_work': None, 'completed_work': 0, 'canonical_observations': 0,
        'recent_completed_work': 0, 'recent_new_claims': 0, 'failed': 0, 'due': 0,
        'custody_sampled': 0, 'sample_stale': 0, 'full_current_custody_verified': True})
    equal('missing replay', 'DELETE FROM retained_listing_property_replay;', {
        'status': 'unavailable', 'reason': 'replay_state_missing'})
    equal('incomplete empty replay', "DELETE FROM retained_listing_property_work;UPDATE retained_listing_property_replay SET scan_completed_at=NULL;", {'status': 'partial'})
    equal('complete small population with actual custody', """CREATE TEMP TABLE kept_work ON COMMIT DROP AS
      SELECT source_observation_id,property_id FROM retained_listing_property_work
      WHERE status='done' AND retained_listing_property_result_matches(source_observation_id,property_id,observation_id)
      ORDER BY source_observation_id,property_id LIMIT 12;
      DELETE FROM retained_listing_property_work q WHERE NOT EXISTS(SELECT 1 FROM kept_work k
        WHERE k.source_observation_id=q.source_observation_id AND k.property_id=q.property_id);
      UPDATE retained_listing_property_replay SET scan_completed_at=now();""", {
        'status': 'passed', 'completed_work': 12, 'custody_sampled': 12,
        'sample_stale': 0, 'full_current_custody_verified': True})
    mixed = """CREATE TEMP TABLE picked_work ON COMMIT DROP AS
      SELECT row_number() OVER(ORDER BY source_observation_id,property_id) AS i,q.*
      FROM retained_listing_property_work q WHERE status='done' ORDER BY source_observation_id,property_id LIMIT 12;
      DELETE FROM retained_listing_property_work;
      INSERT INTO retained_listing_property_work(source_observation_id,property_id,vehicle_id,status,attempts,
        next_attempt_at,locked_by,locked_at,observation_id,completed_at)
      SELECT source_observation_id,property_id,vehicle_id,
        CASE i WHEN 5 THEN 'pending' WHEN 6 THEN 'pending' WHEN 7 THEN 'claimed'
          WHEN 8 THEN 'skipped' WHEN 9 THEN 'failed' ELSE 'done' END,1,
        CASE WHEN i=6 THEN now()+interval '1 day' ELSE now() END,
        CASE WHEN i=7 THEN 'assay-fixture' END,CASE WHEN i=7 THEN now() END,
        CASE WHEN i=2 THEN (SELECT observation_id FROM picked_work WHERE i=1)
          WHEN i<=4 OR i>=10 THEN observation_id END,
        CASE WHEN i=10 THEN statement_timestamp()-interval '31 minutes'
          WHEN i=11 THEN statement_timestamp()-interval '30 minutes'
          WHEN i=12 THEN statement_timestamp()+interval '1 minute'
          WHEN i<=4 THEN statement_timestamp()-interval '10 minutes' END
      FROM picked_work;"""
    measured = equal('mixed states, duplicate result, exact recent boundary and future completion', mixed, {
        'work': {'done': 7, 'pending': 2, 'claimed': 1, 'skipped': 1, 'failed': 1},
        'completed_work': 7, 'canonical_observations': 6, 'recent_completed_work': 6,
        'failed': 1, 'due': 2, 'custody_sampled': 7, 'status': 'failed'})
    assert sum(row['work_items'] for row in measured['property_work']) == 12
    equal('withdrawn private parents', 'UPDATE vehicles SET is_public=false;', {'status': 'failed', 'sample_stale': 200})
    equal('custody cancellation retains unavailable', """CREATE OR REPLACE FUNCTION
      public.retained_listing_property_result_matches(p_source uuid,p_property uuid,p_result uuid) RETURNS boolean LANGUAGE plpgsql STABLE
      AS $$ BEGIN RAISE EXCEPTION 'fixture query cancellation' USING ERRCODE='57014';END $$;""",
      {'status': 'unavailable', 'reason': 'read_failed', 'sqlstate': '57014'})
    assert read(snapshot) == initial
    passed('exact full-JSON differential: real replay, empty/missing/incomplete, all states, global duplicate IDs, 30min/future clocks, private custody and cancellation')

    # Disposable synthetic work-shaped heap. LIKE copies checks/indexes but no
    # testimony FKs; this is explicitly not a canonical custody performance case.
    # Run the actual old/new assay definitions with only the work relation/name
    # substituted. A four-row observation clock relation exercises the unchanged
    # recent join without rewriting immutable fixture testimony. Real custody
    # remains installed and correctly rejects these synthetic missing parents.
    old_bench = original.replace(f'FUNCTION {name}(', 'FUNCTION pg_temp.assay_before(').replace(
        'public.retained_listing_property_work', 'pg_temp.assay_work').replace(
        'public.vehicle_observations', 'pg_temp.assay_observations')
    new_bench = repaired.replace(f'FUNCTION {name}(', 'FUNCTION pg_temp.assay_after(').replace(
        'public.retained_listing_property_work', 'pg_temp.assay_work').replace(
        'public.vehicle_observations', 'pg_temp.assay_observations')
    grouped = "SELECT count(*) FROM(SELECT observation_id FROM pg_temp.assay_work WHERE status='done' AND observation_id IS NOT NULL GROUP BY observation_id)x"
    distinct = "SELECT count(*),count(DISTINCT observation_id) FROM pg_temp.assay_work WHERE status='done'"
    assert "SELECT count(DISTINCT observation_id) INTO distinct_rows" in repaired
    selected = "SELECT count(DISTINCT observation_id) FROM pg_temp.assay_work WHERE status='done'"
    consolidated = repaired[repaired.index(' WITH property_status AS MATERIALIZED('):repaired.index(' -- Preserve global distinctness')]
    consolidated = consolidated.replace('INTO w,total,failed,due,property_counts,recent_completed ', '').replace(
        'public.retained_listing_property_work', 'pg_temp.assay_work').strip().rstrip(';')
    plan_queries = [
        ('old_distinct', distinct), ('grouped_candidate', grouped), ('selected_distinct', selected),
        ('old_status', "SELECT status,count(*) FROM pg_temp.assay_work GROUP BY status"),
        ('old_failed', "SELECT count(*) FROM pg_temp.assay_work WHERE status='failed'"),
        ('old_due', "SELECT count(*) FROM pg_temp.assay_work WHERE status='claimed' OR(status='pending' AND next_attempt_at<=now())"),
        ('old_property', "SELECT r.property_key,q.status,count(*) FROM pg_temp.assay_work q JOIN public.observation_properties r ON r.id=q.property_id GROUP BY r.property_key,q.status"),
        ('old_recent', "SELECT count(*) FROM pg_temp.assay_work WHERE status='done' AND completed_at>=statement_timestamp()-interval '30 minutes'"),
        ('consolidated', consolidated),
        ('whole_before', 'SELECT pg_temp.assay_before()'), ('whole_after', 'SELECT pg_temp.assay_after()'),
        ('whole_after_repeat', 'SELECT pg_temp.assay_after()'), ('whole_before_repeat', 'SELECT pg_temp.assay_before()'),
    ]
    values = ','.join('('+literal(label)+','+literal(query)+')' for label, query in plan_queries)
    output = sql(f"""BEGIN;
      CREATE TEMP TABLE assay_work (LIKE public.retained_listing_property_work INCLUDING ALL) ON COMMIT DROP;
      INSERT INTO assay_work(source_observation_id,property_id,vehicle_id,status,attempts,next_attempt_at,
        locked_by,locked_at,observation_id,completed_at)
      SELECT ('e1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        CASE WHEN i%2=0 THEN '514cacd3-82b4-4330-b3df-e292612ee718'::uuid ELSE 'efcb8c61-1ff5-4790-890e-2e09118e87e3'::uuid END,
        '22222222-2222-4222-8222-222222222222'::uuid,
        CASE WHEN i<=498000 THEN 'done' ELSE (ARRAY['claimed','pending','skipped','failed'])[i%4+1] END,1,
        CASE WHEN i%8=5 THEN now()+interval '1 day' ELSE now() END,
        CASE WHEN i>498000 AND i%4=0 THEN 'fixture' END,
        CASE WHEN i>498000 AND i%4=0 THEN now() END,
        CASE WHEN i<=498000 THEN ('e2000000-0000-4000-8000-'||lpad((i%490000)::text,12,'0'))::uuid END,
        CASE WHEN i<=498000 THEN statement_timestamp()-CASE WHEN i%4=0 THEN interval '10 minutes' ELSE interval '1 day' END END
      FROM generate_series(1,500000)i;
      ANALYZE assay_work;
      CREATE TEMP TABLE assay_observations(id uuid PRIMARY KEY,ingested_at timestamptz) ON COMMIT DROP;
      INSERT INTO assay_observations SELECT ('e2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        statement_timestamp()+CASE i WHEN 4 THEN interval '-10 minutes' WHEN 8 THEN interval '-31 minutes'
          WHEN 12 THEN interval '1 minute' ELSE interval '-30 minutes' END FROM(VALUES(4),(8),(12),(16))x(i);
      ANALYZE assay_observations;
      {old_bench};{new_bench};
      CREATE TEMP TABLE plans(label text,plan jsonb) ON COMMIT DROP;
      DO $plans$ DECLARE spec record;p jsonb;BEGIN
        FOR spec IN SELECT * FROM(VALUES {values})q(label,query) LOOP
          EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '||spec.query INTO p;
          INSERT INTO plans VALUES(spec.label,p->0);
        END LOOP;
      END $plans$;
      SELECT jsonb_build_object('work_mem',current_setting('work_mem'),
        'hash_mem_multiplier',current_setting('hash_mem_multiplier'),
        'rows',(SELECT count(*) FROM assay_work),'heap_bytes',pg_relation_size('pg_temp.assay_work'),
        'before',pg_temp.assay_before(),'after',pg_temp.assay_after(),
        'plans',(SELECT jsonb_object_agg(label,plan) FROM plans));ROLLBACK;""")
    receipt = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
    assert receipt['rows'] == 500000
    assert receipt['before'] == receipt['after']
    assert receipt['after']['completed_work'] == 498000
    assert receipt['after']['canonical_observations'] == 490000
    assert receipt['after']['due'] == 750
    assert receipt['after']['recent_completed_work'] == 124500
    assert receipt['after']['recent_new_claims'] == 6  # Row count, not distinct IDs; inclusive cutoff, no invented future clamp.
    assert sum(row['work_items'] for row in receipt['after']['property_work']) == 500000
    assert receipt['after']['status'] != 'unavailable'

    def nodes(plan):
        yield plan
        for child in plan.get('Plans', []):
            yield from nodes(child)

    summary = {key: receipt[key] for key in ('rows', 'heap_bytes', 'work_mem', 'hash_mem_multiplier')}
    summary['plans'] = {}
    for label, plan in receipt['plans'].items():
        summary['plans'][label] = {
            'execution_ms': plan['Execution Time'],
            'temp_read_blocks': plan['Plan'].get('Temp Read Blocks', 0),
            'temp_written_blocks': plan['Plan'].get('Temp Written Blocks', 0),
            'nodes': [{key: node[key] for key in ('Node Type', 'Strategy', 'Actual Rows', 'Sort Method',
                'Sort Space Used', 'HashAgg Batches', 'Peak Memory Usage', 'Disk Usage') if key in node}
                for node in nodes(plan['Plan'])]}
    scans = [node for node in nodes(receipt['plans']['consolidated']['Plan']) if node.get('Relation Name') == 'assay_work']
    assert len(scans) == 1 and scans[0]['Actual Rows'] == 500000
    print('ASSAY_AGGREGATION_LOCAL_RECEIPT '+json.dumps(summary, separators=(',', ':')), flush=True)
    passed('500000-row actual assay differential: exact full work/status/property/distinct counts; one additive scan; default-resource plan/time/temp-IO receipt')
    sql(f'DROP FUNCTION {before_name}()')
