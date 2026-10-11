"""Extractor identity labels in the existing disposable retained replay fixture."""
import json
import re
from pathlib import Path


def run_identity_checks(sql, read, rejects, claim, passed):
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    sql("""INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds,label,data_type,ratified_at)
     VALUES('ece619f7-c49a-44f7-999f-a41acf5d4dc3','year','core',ARRAY['specification','listing'],'Model Year','integer','2026-05-17'),
     ('8d274b73-a8a6-43bf-9036-5864d0152725','make','core',ARRAY['specification','listing'],'Make','string','2026-05-17'),
     ('a79b528f-7d9d-46ca-96f9-96d899e81d10','model','core',ARRAY['specification','listing'],'Model','string','2026-05-17');""")
    source = Path('supabase/functions/ingest-observation/retainedListingIdentity.test.ts').read_text()
    array = source.split('const cases:', 1)[1].split(' = ', 1)[1].split('];', 1)[0] + ']'
    cases = json.loads(re.sub(r',(\s*\])', r'\1', array))

    def insert(first, last, clock):
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,
         extraction_method,confidence_score,structured_data,content_text)
         SELECT ('95000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
         ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
         '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/identity-label-fixture-'||i,
         NULL,{literal(clock)},'html_match',1,
         '{{"year":2001,"make":"Example Manufacturer","model":"Prototype GT"}}'::jsonb,'Retained extractor labels.'
         FROM generate_series({first},{last}) i""")

    def insert_native(first, last, clock):
        metadata = dict(extractor='extract-bat-core', source_text_field='extract-bat-core.extractDescription',
                        description_capture=True, extractor_input_truncated=False, source_capture_basis='direct_fetch',
                        source_capture_sha256='a'*64, source_captured_at='2026-10-09T00:00:00.123456Z',
                        observation_time_basis='source_capture', source_event_time_status='unknown')
        text = 'This vehicle is offered with service records and a clean title. The car is finished in Guards Red over black leather. Power is sent to the rear wheels through a manual gearbox.'
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,
         extraction_method,confidence_score,structured_data,content_text)
         SELECT ('96000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
         ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
         '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/native-presentation-fixture-'||i,
         '2026-10-09T00:00:00.123456Z',{literal(clock)},'html_description_capture',1,
         {literal(json.dumps(metadata))}::jsonb,{literal(text)} FROM generate_series({first},{last}) i""")

    insert(1, 101, '2026-10-10T01:00:00Z')
    insert_native(1, 101, '2026-10-10T01:00:00Z')
    # Production uses enum arrays. The older fixture's text arrays masked42883.
    sql("ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'work_record';")
    sql("ALTER TABLE observation_properties ALTER COLUMN applies_to_kinds TYPE observation_kind[] USING applies_to_kinds::observation_kind[];")
    sql("ALTER TABLE observation_sources ALTER COLUMN supported_observations TYPE observation_kind[] USING supported_observations::observation_kind[];")
    rejects("SELECT (CASE WHEN true THEN 'condition' ELSE 'specification' END)=ANY(applies_to_kinds) FROM observation_properties WHERE property_key='mileage_miles'")
    migration = Path('supabase/migrations/20261010223542_retained_listing_model_fields_projection.sql').read_text()
    historical = sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q")
    previous = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    view_oid = sql("SELECT 'vehicle_canonical'::regclass::oid")
    sql('UPDATE cron.job SET active=false')
    rejects(migration)
    assert sql("SELECT to_regprocedure('retained_listing_identity_value(text,jsonb)') IS NULL") == 't'
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    sql("UPDATE observation_properties SET data_type='string' WHERE property_key='year'")
    rejects(migration)
    sql("UPDATE observation_properties SET data_type='integer' WHERE property_key='year'")
    sql(migration)
    assert sql('SELECT active FROM cron.job') == 'f'
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay') == previous
    assert sql("SELECT 'vehicle_canonical'::regclass::oid") == view_oid
    assert sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q") == historical
    for key, value, expected in cases:
        assert read(f"SELECT coalesce(retained_listing_identity_value({literal(key)},{literal(json.dumps(value))}::jsonb),'null'::jsonb)") == expected
    presentation_source = Path('supabase/functions/ingest-observation/retainedDescriptionPresentation.test.ts').read_text()
    presentation_cases = json.loads(re.sub(r',(\s*\])', r'\1', presentation_source.split('const cases:',1)[1].split(' = ',1)[1].split('];',1)[0]+']'))
    for key, text, expected in presentation_cases:
        parsed=read(f"SELECT coalesce(retained_description_presentation_witness({literal(key)},{literal('This vehicle is offered with service records, factory literature, and a clean title. '+text)}),'null'::jsonb)")
        assert (parsed['value'] if parsed else None)==expected
    passed('identity/presentation property guards, SQL/edge parity, view OID and existing work/receipt preservation')
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    insert(102, 102, '2026-10-10T02:00:00Z')
    insert_native(102, 102, '2026-10-10T02:00:00Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id='95000000-0000-4000-8000-000000000102'") == '3'
    projected = 0
    for _ in range(100):
        batch = claim('identity-label-replay')
        if not batch:
            if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay') == 't':
                break
            continue
        assert all(row['source_observation_id'].startswith(('95000000-','96000000-')) and row['mode'] in
                   ['retained_listing_year_v1', 'retained_listing_make_v1', 'retained_listing_model_v1',
                    'retained_listing_exterior_color_v1','retained_listing_interior_color_v1','retained_listing_drivetrain_layout_v1'] for row in batch)
        sql("""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,
         raw_source_ref,observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
         SELECT gen_random_uuid(),p.vehicle_id,'specification',p.source_id,p.source_url,r.id,
          'retained_listing_'||r.property_key||'_v1:'||p.id,'vehicle_observations:'||p.id,p.ingested_at,
          'retained_listing_property_projection_v1',.6,
          jsonb_build_object(r.property_key,CASE WHEN p.extraction_method='html_description_capture' THEN w.data->'value' ELSE p.structured_data->r.property_key END,
          'source_value',CASE WHEN p.extraction_method='html_description_capture' THEN w.data->'source_value' ELSE p.structured_data->r.property_key END,
          'source_observation_id',p.id,'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
          'source_field',CASE WHEN p.extraction_method='html_description_capture' THEN 'content_text' ELSE r.property_key END,
          'property_key',r.property_key,'projection_version','retained_listing_'||r.property_key||'_v1',
          'analysis_kind','retained_listing_property_projection','source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,
          'source_confidence_score',p.confidence_score,'source_extraction_method',p.extraction_method,
          'normalization_version',CASE WHEN p.extraction_method='html_description_capture' THEN CASE WHEN r.property_key='drivetrain_layout' THEN 'retained_powertrain_v1' ELSE 'retained_color_text_v1' END ELSE 'retained_listing_identity_labels_v1' END,
          'source_witness_version','retained_description_presentation_v1','source_capture_sha256',p.structured_data->'source_capture_sha256',
          'identity_role','extractor_vehicle_label',
          'identity_resolution_status','unverified','source_event_time_status','unknown',
          'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false),
          p.id,'identity-label-'||p.id||'-'||r.property_key,'Exact retained label. Physical identity remains unverified.'
         FROM retained_listing_property_work q JOIN vehicle_observations p ON p.id=q.source_observation_id
         JOIN observation_properties r ON r.id=q.property_id
         CROSS JOIN LATERAL(SELECT retained_description_property_witness(p,r.property_key) data)w
         WHERE q.status='claimed' AND q.locked_by='identity-label-replay'""")
        for row in batch:
            parent, prop = row['source_observation_id'], row['property_id']
            result = sql(f"SELECT id FROM vehicle_observations WHERE source_observation_id='{parent}' AND property_id='{prop}'")
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','wrong-worker','done','{result}')") == 'f'
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','identity-label-replay','done','{result}')") == 't'
        projected += len(batch)
    assert projected == 612
    assert sql("SELECT work_seeded=606 AND projection_version='retained_listing_model_fields_v1' FROM retained_listing_property_replay") == 't'
    parent = '95000000-0000-4000-8000-000000000001'
    vehicle = '60000001-0000-4000-8000-000000000001'
    prop = 'ece619f7-c49a-44f7-999f-a41acf5d4dc3'
    result = sql(f"SELECT observation_id FROM retained_listing_property_work WHERE source_observation_id='{parent}' AND property_id='{prop}'")
    for key, expected in [('year','2001'),('make','Example Manufacturer'),('model','Prototype GT')]:
        reading = next(x for x in read(f"SELECT get_field_provenance('{vehicle}',{literal(key)})")['observations'] if x['source_observation_id'] == parent)
        assert reading['value'] == expected and reading['identity_role'] == 'extractor_vehicle_label'
        assert reading['identity_resolution_status'] == 'unverified' and reading['source_event_time_status'] == 'unknown'
        assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{reading['id']}'") == '1'
    passed('606 baseline identity/presentation claims plus six late claims admitted through existing replay, public exact values/roles/unknown clocks')
    native_parent='96000000-0000-4000-8000-000000000001'
    for key, expected in [('exterior_color','Guards Red'),('interior_color','black'),('drivetrain_layout','RWD')]:
        reading=next(x for x in read(f"SELECT get_field_provenance('{vehicle}',{literal(key)})")['observations'] if x['source_observation_id']==native_parent)
        assert reading['value']==expected and reading['source_witness_version']=='retained_description_presentation_v1'
        assert reading['source_event_time_status']=='unknown' and reading['source_extraction_method']=='html_description_capture'
        assert expected in reading['source_value'] or key=='drivetrain_layout'
        assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{reading['id']}'")=='1'
        for field, value in [('source_witness_version','retained_description_powertrain_v1'),('source_event_time_status','known')]:
            rejects(f"""INSERT INTO vehicle_observations SELECT
             (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
             'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({field:value}))}::jsonb))).*
             FROM vehicle_observations o WHERE id='{reading['id']}'""")
    # Metadata on an admitted claim cannot masquerade as a different property.
    sql(f"""INSERT INTO vehicle_observations SELECT
     (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id','97000000-0000-4000-8000-000000000001',
     'content_hash','synthetic-extra-field','structured_data',o.structured_data||'{{"engine_configuration":"V12"}}'::jsonb))).*
     FROM vehicle_observations o WHERE id='{result}'""")
    assert not any(x['id']=='97000000-0000-4000-8000-000000000001' for x in read(f"SELECT get_field_provenance('{vehicle}','engine_configuration')")['observations'])
    passed('exact native presentation quotes/canonical values, unknown clocks and cross-property reader isolation')
    for key, value in [('identity_resolution_status','verified'),('identity_role','resolved_vehicle'),('year',2002),
                       ('source_value','2001'),('source_field','color'),('source_event_time_status','known')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT
         (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
         'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({key:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    sql("UPDATE observation_properties SET label='Resolved Physical Identity' WHERE property_key='year'")
    assert sql(f"SELECT retained_listing_property_result_matches('{parent}','{prop}','{result}')") == 'f'
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'") == '0'
    sql("UPDATE observation_properties SET label='Model Year' WHERE property_key='year'")
    sql(f"UPDATE vehicle_observations SET structured_data=structured_data||'{{\"year\":2002}}'::jsonb WHERE id='{parent}'")
    assert sql(f"SELECT retained_listing_property_result_matches('{parent}','{prop}','{result}')") == 'f'
    assert not any(x['id'] == result for x in read(f"SELECT get_field_provenance('{vehicle}','year')")['observations'])
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'") == '0'
    rejects(migration)
    for role in ('anon','authenticated'):
        assert sql(f"SELECT has_function_privilege('{role}','claim_retained_listing_properties(text,integer)','EXECUTE')") == 'f'
    passed('forged physical identity/year/source/event assertions refused, stale parent withdrawn from completion and readers')
    from test_retained_canonical_recovery import run_canonical_recovery_checks
    run_canonical_recovery_checks(sql, read, rejects, passed)
