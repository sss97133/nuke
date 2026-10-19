"""Odometer-display custody proof in the existing disposable PG17 intake fixture."""
import json
import re
from pathlib import Path


def run_odometer_checks(sql, read, rejects, claim, passed):
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    sql("""ALTER TABLE observation_properties ADD COLUMN unit text,ADD COLUMN label text,ADD COLUMN data_type text,
     ADD COLUMN verification_scope text,ADD COLUMN cardinality text,ADD COLUMN ratified_at timestamptz;
     INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds,unit,label,data_type,verification_scope,cardinality,ratified_at)
     VALUES('abdd7a7a-02c1-4b09-afc6-1a288207dd2d','mileage_miles','core',ARRAY['condition','listing','work_record'],
     'miles','Odometer Reading (mi)','integer','instance','multi','2026-05-17');""")
    source = Path('supabase/functions/ingest-observation/retainedOdometer.test.ts').read_text()
    array = source.split('const cases:', 1)[1].split(' = ', 1)[1].split('];', 1)[0] + ']'
    cases = json.loads(re.sub(r',(\s*\])', r'\1', array))
    metadata = dict(extractor='extract-bat-core', source_text_field='extract-bat-core.extractDescription',
                    description_capture=True, extractor_input_truncated=False, source_capture_basis='direct_fetch',
                    source_capture_sha256='a'*64, source_captured_at='2026-10-09T00:00:00.123456Z',
                    observation_time_basis='source_capture', source_event_time_status='unknown')
    text = 'This vehicle is offered with service records and a clean title. ' + cases[0][0]

    def insert(first, last, clock):
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,
         extraction_method,confidence_score,structured_data,content_text)
         SELECT ('94000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
         ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
         '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/odometer-fixture-'||i,
         '2026-10-09T00:00:00.123456Z',{literal(clock)},'html_description_capture',1,
         {literal(json.dumps(metadata))}::jsonb,{literal(text)} FROM generate_series({first},{last}) i""")

    insert(1, 101, '2026-10-10T00:00:00Z')
    migration = Path('supabase/migrations/20261010182050_retained_odometer_description_projection.sql').read_text()
    historical = sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q")
    previous = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    sql('UPDATE cron.job SET active=false')
    rejects(migration)
    assert sql("SELECT to_regprocedure('retained_odometer_witness(text)') IS NULL") == 't'
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    sql("UPDATE observation_properties SET label='Actual Mileage' WHERE property_key='mileage_miles'")
    rejects(migration)
    sql("UPDATE observation_properties SET label='Odometer Reading (mi)' WHERE property_key='mileage_miles'")
    sql(migration)
    assert sql('SELECT active FROM cron.job') == 'f'
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay') == previous
    assert sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q") == historical
    for body, expected in cases:
        parsed = read(f"SELECT coalesce(retained_odometer_witness({literal('This vehicle is offered with service records and a clean title. '+body)}),'null'::jsonb)")
        assert (parsed['value'] if parsed else None) == expected
    passed('ratified odometer meaning/pause guards, SQL/edge parity, existing work and nested receipts preserved')
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    insert(102, 102, '2026-10-09T00:00:01Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id='94000000-0000-4000-8000-000000000102'") == '1'
    projected = 0
    while True:
        batch = claim('odometer-replay')
        if not batch:
            if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay') == 't':
                break
            continue
        assert all(row['source_observation_id'].startswith('94000000-') and row['mode'] == 'retained_listing_mileage_miles_v1' for row in batch)
        sql("""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,
         raw_source_ref,observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
         SELECT gen_random_uuid(),p.vehicle_id,'condition',p.source_id,p.source_url,q.property_id,
          'retained_listing_mileage_miles_v1:'||p.id,'vehicle_observations:'||p.id,p.ingested_at,
          'retained_listing_property_projection_v1',.6,
          (w.data-'value')||jsonb_build_object('mileage_miles',w.data->'value','source_observation_id',p.id,
          'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at','source_field','content_text',
          'property_key','mileage_miles','projection_version','retained_listing_mileage_miles_v1',
          'analysis_kind','retained_listing_property_projection','source_recorded_at',p.ingested_at,
          'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,'source_extraction_method',p.extraction_method,
          'normalization_version','retained_odometer_miles_v1','source_witness_version','retained_description_odometer_v1',
          'source_capture_sha256',p.structured_data->'source_capture_sha256','source_observed_at_basis','source_capture',
          'source_event_time_status','unknown','factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false),
          p.id,'odometer-'||p.id,'Retained odometer display claim. True mileage is unknown.'
         FROM retained_listing_property_work q JOIN vehicle_observations p ON p.id=q.source_observation_id
         CROSS JOIN LATERAL(SELECT retained_description_property_witness(p,'mileage_miles') data) w
         WHERE q.status='claimed' AND q.locked_by='odometer-replay'""")
        for row in batch:
            parent, prop = row['source_observation_id'], row['property_id']
            result = sql(f"SELECT id FROM vehicle_observations WHERE source_observation_id='{parent}' AND property_id='{prop}'")
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','wrong-worker','done','{result}')") == 'f'
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','odometer-replay','done','{result}')") == 't'
        projected += len(batch)
    assert projected == 102
    assert sql("SELECT work_seeded=101 AND projection_version='retained_description_odometer_v1' FROM retained_listing_property_replay") == 't'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='done'") == '4016'
    parent = '94000000-0000-4000-8000-000000000001'
    vehicle = '60000001-0000-4000-8000-000000000001'
    result = sql(f"SELECT observation_id FROM retained_listing_property_work WHERE source_observation_id='{parent}'")
    prop = 'abdd7a7a-02c1-4b09-afc6-1a288207dd2d'
    reading = next(x for x in read(f"SELECT get_field_provenance('{vehicle}','mileage_miles')")['observations'] if x['id'] == result)
    assert reading['value'] == '67000' and reading['source_reading_unit'] == 'miles' and reading['reported_precision_miles'] == 1000
    assert reading['value_is_approximate'] and reading['reading_role'] == 'odometer_display' and reading['true_mileage_status'] == 'unknown'
    assert reading['source_observed_at_basis'] == 'source_capture' and reading['source_event_time_status'] == 'unknown'
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'") == '1'
    passed('all101 baseline odometer sources plus late arrival admitted through existing queue, exact public reading/unit/precision/unknown semantics')
    for key, value in [('reading_role','actual_mileage'),('true_mileage_status','verified'),('source_reading_unit','kilometers'),
                       ('reported_precision_miles',1),('value_is_approximate',False),('source_event_time_status','known')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT
         (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
         'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({key:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    sql(f"UPDATE vehicle_observations SET content_text=replace(content_text,'67k miles','68k miles') WHERE id='{parent}'")
    assert sql(f"SELECT retained_listing_property_result_matches('{parent}','{prop}','{result}')") == 'f'
    assert not any(x['id'] == result for x in read(f"SELECT get_field_provenance('{vehicle}','mileage_miles')")['observations'])
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'") == '0'
    rejects(migration)
    for role in ('anon','authenticated'):
        assert sql(f"SELECT has_function_privilege('{role}','claim_retained_listing_properties(text,integer)','EXECUTE')") == 'f'
    passed('forged true-mileage/unit/precision/event semantics refused; changed witness invalidates completion/readers; raw public writes remain denied')
