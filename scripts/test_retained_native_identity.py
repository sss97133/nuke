"""Native bindings in the existing localhost-only disposable PG17 fixture.

Synthetic witnesses use CTAS/composites: no new testimony rows are appended.
Actual persistence and public field delivery additionally require runtime proof.
"""
import json
import re
from pathlib import Path


def run_native_identity_checks(sql, read, rejects, claim, passed):
    literal = lambda s: "'" + s.replace("'", "''") + "'"
    # Align only this disposable fixture with the existing ratified registry.
    sql("""UPDATE observation_properties SET data_type=CASE WHEN property_key='drivetrain_layout' THEN 'enum' ELSE 'string' END,
        ratified_at='2026-10-01T00:00:00Z' WHERE property_key IN('drivetrain_layout','interior_color','exterior_color');
        INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds,data_type,ratified_at)
        VALUES('51ccde21-0752-4262-9ffa-11b3f12beee5','trim','core',ARRAY['specification']::observation_kind[],'string','2026-10-01T00:00:00Z');""")
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    snapshot = """SELECT jsonb_build_object(
      'vehicles',(SELECT md5(jsonb_agg(to_jsonb(v) ORDER BY id)::text) FROM vehicles v),
      'observations',(SELECT md5(jsonb_agg(to_jsonb(o) ORDER BY id)::text) FROM vehicle_observations o),
      'sources',(SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM observation_sources s),
      'properties',(SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM observation_properties r),
      'work',(SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q),
      'raw_replay',(SELECT jsonb_build_object('forward',cursor_source_id,'reverse',reverse_cursor_source_id,'upper',upper_source_id,'keys',keys_seen,'seeded',work_seeded,'version',projection_version,'done',scan_completed_at) FROM retained_listing_property_replay WHERE id))"""
    custody_query = "SELECT jsonb_agg(jsonb_build_object('id',o.id,'valid',retained_listing_property_result_matches(o.source_observation_id,o.property_id,o.id)) ORDER BY o.id) FROM vehicle_observations o WHERE o.source_observation_id IS NOT NULL"
    before, custody = read(snapshot), read(custody_query)
    migration = Path('supabase/migrations/20261012013813_bulk_retained_native_identity_projection.sql').read_text()
    sql(migration)
    assert before == read(snapshot) and custody == read(custody_query)
    assert claim('old-worker-before-native-identity-activation') == []
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    corpus = Path('supabase/functions/ingest-observation/retainedDescriptionIdentity.test.ts').read_text()
    cases = json.loads(re.sub(r',(\s*\])', r'\1', '[' + corpus.split('const cases:', 1)[1].split('=[', 1)[1].split('];', 1)[0] + ']'))
    rest = ' The vehicle is offered with service records, factory literature, and a clean title. Identity and configuration remain unverified.'
    for opening, make, model in cases:
        for key, expected in [('make', make), ('model', model)]:
            w = read(f"SELECT coalesce(retained_description_identity_text_witness('{key}',{literal(opening + rest)}),'null'::jsonb)")
            assert (w['value'] if w else None) == expected
            if w:
                assert w['source_value'] == opening and w['source_subject_label'].startswith(w['source_make_label'])
    rejects("SET ROLE anon;SELECT enqueue_retained_listing_properties(ARRAY['9d100000-0000-4000-8000-000000000003'::uuid]);RESET ROLE")
    rejects("SELECT enqueue_retained_listing_properties(array_fill('9d100000-0000-4000-8000-000000000003'::uuid,ARRAY[501]))")
    rejects('SELECT enqueue_retained_listing_properties(ARRAY[NULL::uuid])')
    assert sql('SELECT enqueue_retained_listing_properties(NULL::uuid[])') == '0'
    # Repair every qualifying previously visited original. The unsupported,
    # superseded and private originals remain excluded.
    for _ in range(30):
        sql('SELECT seed_retained_listing_properties()')
        if sql('SELECT native_identity_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id') == 't':
            break
    assert sql('SELECT native_identity_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id') == 't'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9d100000-%' AND property_id IN('8d274b73-a8a6-43bf-9036-5864d0152725','a79b528f-7d9d-46ca-96f9-96d899e81d10')") == '200'
    assert read(snapshot)['raw_replay'] == before['raw_replay']
    assert sql("SELECT enqueue_retained_listing_properties(array_agg(id)) FROM (SELECT id FROM vehicle_observations WHERE id::text LIKE '9d100000-%' LIMIT 500)p") == '0'
    assert sql("SELECT sum(enqueue_retained_listing_properties(id)) FROM vehicle_observations WHERE id::text LIKE '9d100000-%'") == '0'
    assert read(snapshot)['observations'] == before['observations'] and read(custody_query) == custody
    # Read-only composite witnesses exercise exact child contracts for both keys,
    # including a real registered/public parent envelope and original clock precision.
    text = 'This 1977 Ford F-150 Ranger was acquired by its seller.' + rest
    sql(f"""CREATE TABLE native_identity_pairs AS
      WITH parents AS(SELECT jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object('content_text',{literal(text)})) AS p
        FROM vehicle_observations p WHERE id='9d100000-0000-4000-8000-000000000003'),
      readings AS(SELECT p,k.key,k.property,retained_description_property_witness(p,k.key) AS w FROM parents
        CROSS JOIN(VALUES('make','8d274b73-a8a6-43bf-9036-5864d0152725'::uuid),('model','a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid))k(key,property))
      SELECT p,jsonb_populate_record(NULL::vehicle_observations,jsonb_build_object(
        'id',gen_random_uuid(),'vehicle_id',(p).vehicle_id,'source_id',(p).source_id,'source_url',(p).source_url,
        'kind','specification','is_superseded',false,'subject_type','vehicle','subject_id',NULL,
        'source_identifier','retained_listing_'||key||'_v1:'||(p).id,'raw_source_ref','vehicle_observations:'||(p).id,
        'observed_at',(p).ingested_at,'confidence_score',.6,'agent_cost_cents',0,'agent_model',NULL,
        'property_id',property,'source_observation_id',(p).id,'content_hash',gen_random_uuid()::text,
        'extraction_method','retained_listing_property_projection_v1','structured_data',jsonb_build_object(
         key,w->'value','source_value',w->'source_value','source_year_token',w->'source_year_token','source_subject_label',w->'source_subject_label',
         'source_make_label',w->'source_make_label','model_label_scope','publisher_subject_label_remainder',
         'source_profile','bat_description_identity_label_v1','identity_label_basis','native_listing_subject_introduction',
         'identity_role','extractor_vehicle_label','identity_resolution_status','unverified',
         'normalization_version','retained_description_identity_labels_v1','source_witness_version','retained_description_identity_labels_v1',
         'source_capture_sha256',(p).structured_data->'source_capture_sha256','source_observation_id',(p).id::text,
         'property_key',key,'source_field','content_text','analysis_kind','retained_listing_property_projection',
         'projection_version','retained_listing_'||key||'_v1','claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
         'source_extraction_method',(p).extraction_method,'source_recorded_at',(p).ingested_at,'source_observed_at',(p).observed_at,
         'source_confidence_score',(p).confidence_score,'source_event_time_status','unknown','factory_configuration_status','unknown',
         'current_configuration_status','unknown','independent_source',false))) AS o FROM readings;
      SELECT count(*) FROM native_identity_pairs WHERE retained_description_identity_matches(p,o)""")
    assert sql('SELECT count(*) FROM native_identity_pairs WHERE retained_description_identity_matches(p,o)') == '2'
    for key, value in [('source_make_label','BMW'),('model_label_scope','catalog_model'),('source_subject_label','other'),('identity_resolution_status','verified'),('source_capture_sha256','wrong'),('source_year_token','1900'),('source_recorded_at','2026-01-01T00:00:00Z')]:
        patch = literal(json.dumps({key:value}))
        assert sql(f"SELECT count(*) FROM native_identity_pairs WHERE retained_description_identity_matches(p,jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('structured_data',(o).structured_data||{patch}::jsonb)))") == '0'
    assert sql("SELECT count(*) FROM native_identity_pairs WHERE retained_description_identity_matches(p,jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('structured_data',(o).structured_data||jsonb_build_object((o).structured_data->>'property_key','invented'))))") == '0'
    for patch in ("jsonb_build_object('is_superseded',true)","jsonb_build_object('source_url','https://other.invalid/listing/')","jsonb_build_object('observed_at','2026-01-01T00:00:00Z')","jsonb_build_object('subject_type','other')"):
        assert sql(f'SELECT count(*) FROM native_identity_pairs WHERE retained_description_identity_matches(jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||{patch}),o)') == '0'
    assert read(snapshot)['observations'] == before['observations'] and read(custody_query) == custody
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='8d000001-0000-4000-8000-000000000001';RESET ROLE;").splitlines()[-2] == '1'
    for role in ('anon','authenticated','service_role'):
        models = json.loads(sql(f"SET ROLE {role};SELECT jsonb_agg(x) FROM get_vehicle_specs(ARRAY['8d000001-0000-4000-8000-000000000003'::uuid,'8d000001-0000-4000-8000-000000000003'::uuid,'8d000001-0000-4000-8000-000000000101'::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid],true)x;RESET ROLE;").splitlines()[-2])
        assert len(models) == 1
        model = models[0]
        assert model['schema_version'] == 'vehicle_data_model_v1' and len(model['retained_record']['attributes']) == 13
        assert model['retained_record']['source_attribution_status'] == 'unassayed'
        assert model['model_scope']['complete_vehicle_model'] is False and model['model_scope']['retained_metadata_is_typed_testimony'] is False
        assert model['typed_claims'][0]['property_key'] == 'year' and model['typed_claims'][0]['value'] == 1903
        assert model['typed_claims'][0]['qualifiers']['identity_resolution_status'] == 'unverified'
        assert model['typed_claims_status'] == 'current_core_scope_read'
        metadata_only = json.loads(sql(f"SET ROLE {role};SELECT jsonb_agg(x) FROM get_vehicle_specs(ARRAY['8d000001-0000-4000-8000-000000000003'::uuid])x;RESET ROLE;").splitlines()[-2])
        assert metadata_only[0]['typed_claims_status'] == 'not_requested' and metadata_only[0]['typed_claims'] == []
        empty_claims = json.loads(sql(f"SET ROLE {role};SELECT jsonb_agg(x) FROM get_vehicle_specs(ARRAY['8d000001-0000-4000-8000-000000000102'::uuid],true)x;RESET ROLE;").splitlines()[-2])
        assert len(empty_claims) == 1 and empty_claims[0]['typed_claims'] == []
    record = {'year':1977,'make':'Ford','model':'F-150 Ranger','vin':'1FTFW1EF1EFA00001','trim':'Ranger',
        'color':'Red','interior_color':'Black','engine_size':'350ci V8','engine_type':'I6',
        'transmission':'4-speed manual','drivetrain':'4WD','mileage':1234,'body_style':'Truck'}
    bindings = read(f"SELECT retained_vehicle_record_property_bindings({literal(json.dumps(record))}::jsonb)")
    by_key = {}
    for b in bindings:
        by_key.setdefault(b['property_key'],[]).append(b)
        assert b['source_value'] == record[b['origin_column']] and b['source_attribution_status'] == 'unassayed'
        assert b['claim_role'] == 'record_metadata' and b['independent_source'] is False
    assert len(bindings) == 12 and len(by_key) == 11
    assert by_key['engine_displacement_l'][0]['value'] == 5.735472 and by_key['engine_displacement_l'][0]['unit'] == 'liters'
    assert by_key['transmission_type'][0]['value'] == 'manual' and by_key['drivetrain_layout'][0]['value'] == '4WD'
    assert {b['value'] for b in by_key['engine_configuration']} == {'V8','I6'}
    assert all(b['record_columns_disagree'] for b in by_key['engine_configuration'])
    assert 'mileage_miles' not in by_key and 'body_style' not in by_key
    for bad in ({}, {'make':'unknown','model':'N/A','year':'nineteen','engine_size':'V8 or I6','transmission':'unsure','drivetrain':'maybe 4WD'}):
        assert read(f"SELECT retained_vehicle_record_property_bindings({literal(json.dumps(bad))}::jsonb)") == []
    withdrawn = json.loads(sql(f"BEGIN;UPDATE observation_properties SET deprecated_at=clock_timestamp() WHERE property_key='make';SELECT retained_vehicle_record_property_bindings({literal(json.dumps(record))}::jsonb);ROLLBACK;").splitlines()[-2])
    assert all(b['property_key'] != 'make' for b in withdrawn)
    assert read(snapshot)['observations'] == before['observations'] and read(custody_query) == custody
    passed('registered record bindings preserve original values and disagreement; reuse deterministic unit conversion; exclude unsupported values and mileage without unit evidence; registry withdrawal respected')
    rejects("SELECT * FROM get_vehicle_specs(array_fill('8d000001-0000-4000-8000-000000000003'::uuid,ARRAY[201]))")
    rejects('SELECT * FROM get_vehicle_specs(ARRAY[NULL::uuid])')
    rejects("SELECT * FROM get_vehicle_specs(array_fill('8d000001-0000-4000-8000-000000000003'::uuid,ARRAY[21]),true)")
    assert sql('SELECT count(*) FROM get_vehicle_specs(NULL::uuid[])') == '0'
    assert sql('SELECT count(*) FROM get_vehicle_specs(ARRAY[]::uuid[])') == '0'
    passed('native label SQL/JS parity; finite existing-parent repair and enqueue caps; original work/source/vehicle custody conserved')
    passed('public bulk models retain zero-claim records; deduplicate requests; refuse private/missing records; preserve numeric types and source qualifiers; label13 record fields unassayed and incomplete;200-key cap')
    rejects(migration)
