"""Native description proof inside the disposable existing listing-intake PG fixture."""
import json
from pathlib import Path


def run_description_checks(sql, read, rejects, claim, passed):
    def literal(value):
        return "'" + value.replace("'", "''") + "'"

    sql("UPDATE vehicles SET is_public=true")
    migration = Path('supabase/migrations/20261010175046_retained_description_powertrain_projection.sql').read_text()
    cases = json.loads(Path('supabase/functions/ingest-observation/retainedDescriptionPowertrainCases.ts').read_text().split(' = ', 1)[1].rstrip(';\n'))
    text = cases[0][1]
    metadata = dict(extractor='extract-bat-core', source_text_field='extract-bat-core.extractDescription',
                    description_capture=True, extractor_input_truncated=False, source_capture_basis='direct_fetch',
                    source_capture_sha256='a'*64, source_captured_at='2026-10-09T00:00:00.123456Z',
                    observation_time_basis='source_capture', source_event_time_status='unknown')

    def insert_parents(first, last, recorded):
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,
          extraction_method,confidence_score,structured_data,content_text)
         SELECT ('93000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
          ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
          '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/native-fixture-'||i,
          '2026-10-09T00:00:00.123456Z',{literal(recorded)},'html_description_capture',1,
          {literal(json.dumps(metadata))}::jsonb,{literal(text)} FROM generate_series({first},{last}) i""")

    insert_parents(1, 101, '2026-10-10T00:00:00Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '93000000-%'") == '0'
    previous = read('SELECT to_jsonb(r) FROM retained_listing_property_replay r')
    historical = sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q")
    sql('UPDATE cron.job SET active=false')
    rejects(migration)
    assert sql("SELECT to_regprocedure('retained_description_powertrain_witness(text,text)') IS NULL") == 't'
    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    validator = sql("SELECT pg_get_functiondef('validate_retained_listing_property_source()'::regprocedure)")
    sql(validator.replace("p.kind::text IS DISTINCT FROM 'listing'", "p.kind::text IS DISTINCT FROM 'listing' OR false"))
    rejects(migration)
    sql(validator)
    sql(migration)
    assert sql('SELECT active FROM cron.job') == 'f'
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay') == previous
    assert sql("SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q") == historical
    for key, body, expected in cases:
        witness = read(f"SELECT coalesce(retained_description_powertrain_witness({literal(key)},{literal(body)}),'null'::jsonb)")
        assert (witness['value'] if witness else None) == expected, (key, body, witness, expected)
    passed('native sentence SQL/edge parity; owner pause/drift guards; old work and nested scan receipts preserved')

    assert sql('SELECT activate_retained_listing_property_intake()') == 't'
    insert_parents(102, 102, '2026-10-09T00:00:01Z')  # late commit below the finite upper clock
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id='93000000-0000-4000-8000-000000000102'") == '3'
    assert sql("SELECT enqueue_retained_listing_properties('93000000-0000-4000-8000-000000000102')") == '0'
    projected = 0
    while True:
        batch = claim('native-replay')
        if not batch:
            if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay') == 't':
                break
            continue
        assert all(row['source_observation_id'].startswith('93000000-') for row in batch)
        claimed = ','.join(literal(row['source_observation_id']) for row in batch)
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,
         raw_source_ref,observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
         SELECT gen_random_uuid(),p.vehicle_id,'specification',p.source_id,p.source_url,r.id,
          'retained_listing_'||r.property_key||'_v1:'||p.id,'vehicle_observations:'||p.id,p.ingested_at,
          'retained_listing_property_projection_v1',.6,jsonb_build_object(r.property_key,w.data->'value',
          'source_value',w.data->'source_value','source_observation_id',p.id,'claim_role','listing_claim',
          'observed_at_basis','source_testimony_recorded_at','source_field','content_text','property_key',r.property_key,
          'projection_version','retained_listing_'||r.property_key||'_v1','analysis_kind','retained_listing_property_projection',
          'source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,
          'source_extraction_method',p.extraction_method,'normalization_version','retained_powertrain_v1',
          'source_witness_version','retained_description_powertrain_v1','source_capture_sha256',p.structured_data->'source_capture_sha256',
          'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false),
          p.id,'native-'||p.id||':'||r.property_key,'Retained listing description claim. Unknown factory/current configuration.'
         FROM retained_listing_property_work q JOIN vehicle_observations p ON p.id=q.source_observation_id
         JOIN observation_properties r ON r.id=q.property_id CROSS JOIN LATERAL
          (SELECT retained_description_property_witness(p,r.property_key) data) w
         WHERE q.status='claimed' AND q.locked_by='native-replay' AND p.id IN({claimed})""")
        for row in batch:
            source, prop = row['source_observation_id'], row['property_id']
            result = sql(f"SELECT id FROM vehicle_observations WHERE source_observation_id='{source}' AND property_id='{prop}'")
            assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','wrong-worker','done','{result}')") == 'f'
            assert sql(f"SELECT finish_retained_listing_property('{source}','{prop}','native-replay','done','{result}')") == 't'
        projected += len(batch)
    assert projected == 306
    assert sql("SELECT work_seeded=303 AND projection_version='retained_description_powertrain_v1' FROM retained_listing_property_replay") == 't'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='done'") == '3914'
    source = '93000000-0000-4000-8000-000000000001'
    vehicle = '60000001-0000-4000-8000-000000000001'
    prop = 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'
    result = sql(f"SELECT observation_id FROM retained_listing_property_work WHERE source_observation_id='{source}' AND property_id='{prop}'")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND observation_id IN(SELECT id FROM vehicle_observations WHERE source_observation_id='{source}')") == '3'
    prov = read(f"SELECT get_field_provenance('{vehicle}','engine_configuration')")
    assert any(x.get('source_field') == 'content_text' and x.get('source_value') == text.split('. ')[1]
               and x.get('source_witness_version') == 'retained_description_powertrain_v1'
               and x.get('source_capture_sha256') == 'a'*64 for x in prov['observations'])
    passed('finite full replay adds303 native keys plus3 late arrival keys; actual quote/SHA/clocks in both readers; canonical finish proof')

    def absent():
        assert sql(f"SELECT retained_listing_property_result_matches('{source}','{prop}','{result}')") == 'f'
        assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id IN(SELECT id FROM vehicle_observations WHERE source_observation_id='{source}')") == '0'
        assert not any(x.get('source_observation_id') == source for x in read(f"SELECT coalesce(get_field_provenance('{vehicle}','engine_configuration'),'{{\"observations\":[]}}'::jsonb)")['observations'])

    for key, value in [('extractor_input_truncated', True), ('source_capture_sha256', 'b'*64),
                       ('source_captured_at', '2026-10-09T00:00:00.123455Z'), ('source_captured_at', 'invalid')]:
        sql(f"UPDATE vehicle_observations SET structured_data=structured_data||{literal(json.dumps({key:value}))}::jsonb WHERE id='{source}'")
        absent()
        sql(f"UPDATE vehicle_observations SET structured_data={literal(json.dumps(metadata))}::jsonb WHERE id='{source}'")
    sql(f"UPDATE vehicle_observations SET content_text=replace(content_text,'1.8-liter','2.0-liter') WHERE id='{source}'")
    # Config/transmission values are unchanged but their exact witness changed.
    absent()
    sql(f"UPDATE vehicle_observations SET content_text={literal(text)},is_superseded=true WHERE id='{source}'")
    absent()
    sql(f"UPDATE vehicle_observations SET is_superseded=false WHERE id='{source}'")
    sql(f"UPDATE vehicles SET is_public=false WHERE id='{vehicle}'")
    absent()
    sql(f"UPDATE vehicles SET is_public=true WHERE id='{vehicle}'")
    for field, value in [('source_value', 'forged'), ('source_capture_sha256', 'b'*64), ('source_witness_version', 'forged'),
                         ('factory_configuration_status', 'verified')]:
        rejects(f"""INSERT INTO vehicle_observations
         SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
          'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({field:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    rejects(f"UPDATE vehicle_observations SET structured_data=structured_data||'{{\"engine_configuration\":\"V8\"}}'::jsonb WHERE id='{result}'")
    rejects(migration)
    for role in ('anon','authenticated'):
        assert sql(f"SELECT has_function_privilege('{role}','claim_retained_listing_properties(text,integer)','EXECUTE')") == 'f'
    passed('quote/hash/capture/truncation/privacy/supersession withdrawals invalidate readers and completion; forged tuples and repeat migration refused')
    run_interpretation_correction_checks(sql, read, rejects, passed)


def run_interpretation_correction_checks(sql, read, rejects, passed):
    """Synthetic legacy interpretation repair, not a sale-time or accuracy assay.

    The successor was admitted by the real retained-property validator above.
    Only the deliberately wrong legacy interpretation is fixture-seeded here;
    supersession itself must use the unchanged owner relay, never a flag edit.
    """
    def literal(value):
        return "'" + value.replace("'", "''") + "'"

    vehicle = '60000001-0000-4000-8000-000000000001'
    control = '60000001-0000-4000-8000-000000000002'
    source = '93000000-0000-4000-8000-000000000001'
    prop = 'c0f743ae-dc94-4dfd-98ef-514b76f74a9b'
    wrong = 'ce000000-0000-4000-8000-000000000001'
    actor = 'ce000001-0000-4000-8000-000000000001'
    successor = sql(f"SELECT observation_id FROM retained_listing_property_work WHERE source_observation_id='{source}' AND property_id='{prop}'")
    assert sql(f"SELECT retained_listing_property_result_matches('{source}','{prop}','{successor}')") == 't'
    sql(f"""ALTER TABLE vehicle_observations ADD COLUMN IF NOT EXISTS lineage_chain uuid[];
      CREATE TABLE vehicle_ownerships(vehicle_id uuid,owner_profile_id uuid,is_current boolean);
      CREATE TABLE ownership_verifications(vehicle_id uuid,user_id uuid,status text);
      CREATE TABLE vehicle_contributors(vehicle_id uuid,user_id uuid);
      CREATE TABLE reattribution_audit(observation_type text,old_observation_id uuid,old_vehicle_id uuid,
        new_observation_id uuid,new_vehicle_id uuid,reason text,actor_user_id uuid);
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $role$
        SELECT current_setting('role',true) $role$;
      UPDATE vehicles SET owner_id='{actor}' WHERE id='{vehicle}';
      INSERT INTO vehicle_observations(id,vehicle_id,kind,property_id,source_id,source_url,
        raw_source_ref,observed_at,ingested_at,extraction_method,agent_model,confidence_score,
        structured_data,content_hash,content_text)
      SELECT '{wrong}',vehicle_id,'specification','{prop}',source_id,source_url,
        'vehicle_observations:'||id,observed_at,'2026-10-10T00:00:01Z','llm_extraction',
        'synthetic_mistaken_interpretation_v0',.99,
        jsonb_build_object('engine_configuration','V8','source_observation_id',id,
          'factory_configuration_status','unknown','current_configuration_status','unknown'),
        'synthetic-mistaken-engine-interpretation','Synthetic wrong interpretation; original prose says inline-four.'
      FROM vehicle_observations WHERE id='{source}';""")
    relay = Path('supabase/migrations/20260927180000_supersede_observation_owner_relay.sql').read_text()
    sql(relay[relay.index('create function public.supersede_observation_relay'):])

    def answer(relation='public.vehicle_canonical', subject=vehicle):
        return read(f"""SELECT jsonb_agg(jsonb_build_object('property_id',property_id,
          'observation_id',observation_id,'value',structured_data,'content',content_text)
          ORDER BY property_id,observation_id) FROM {relation} WHERE vehicle_id='{subject}'""")

    before = answer()
    assert next(x for x in before if x['property_id'] == prop)['value']['engine_configuration'] == 'V8'
    unaffected = answer(subject=control)
    other_properties = [x for x in before if x['property_id'] != prop]
    before_provenance = read(f"SELECT get_field_provenance('{vehicle}','engine_configuration')")
    assert any(x['id'] == wrong for x in before_provenance['observations'])
    # sql() opens a connection per call: fixture-only persisted inputs/view are
    # needed here, rather than connection-local temporary objects. The entire
    # database is disposable and guarded against production by the test driver.
    # Replay these typed inputs and the exact selector, not merely its output;
    # this two-vehicle scope does not establish a historical RPC.
    sql(f"CREATE TABLE correction_frozen_inputs AS SELECT to_jsonb(o) AS input FROM vehicle_observations o WHERE vehicle_id IN('{vehicle}','{control}')")
    selector = sql("SET search_path=''; SELECT pg_get_viewdef('public.vehicle_canonical'::regclass,true); RESET search_path;").splitlines()[1:-1]
    selector = '\n'.join(selector)
    assert 'public.vehicle_observations' in selector
    frozen_relation = "jsonb_populate_recordset(NULL::public.vehicle_observations,(SELECT jsonb_agg(input) FROM public.correction_frozen_inputs))"
    sql('CREATE VIEW correction_frozen_answer AS ' + selector.replace('public.vehicle_observations', frozen_relation))
    assert answer('public.correction_frozen_answer') == before
    preserved = sql(f"SELECT md5(jsonb_agg(to_jsonb(o)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'] ORDER BY id)::text) FROM vehicle_observations o WHERE id IN('{source}','{wrong}','{successor}')")
    correction = f"SELECT supersede_observation_relay('{wrong}','{successor}','{actor}','synthetic owner engine correction')"
    def relay(query=correction):
        # Role and invocation must share one connection. The definer's auth.role
        # mock reads the caller's role setting, rather than current_user.
        return json.loads(sql(f'SET ROLE service_role; {query}; RESET ROLE;').splitlines()[-2])

    rejects('SET ROLE authenticated; ' + correction)
    rejects('SET ROLE anon; ' + correction)
    rejects('SET ROLE service_role; ' + f"SELECT supersede_observation_relay('{wrong}','{successor}','{control}','synthetic wrong actor')")
    first = relay()
    assert first['superseded'] and not first['already'] and first['superseded_by'] == successor
    after = answer()
    selected = next(x for x in after if x['property_id'] == prop)
    assert selected['observation_id'] == successor and selected['value']['engine_configuration'] == 'I4'
    assert selected['value']['factory_configuration_status'] == 'unknown'
    assert selected['value']['current_configuration_status'] == 'unknown'
    assert [x for x in after if x['property_id'] != prop] == other_properties
    assert answer(subject=control) == unaffected
    provenance = read(f"SELECT get_field_provenance('{vehicle}','engine_configuration')")
    assert not any(x['id'] == wrong for x in provenance['observations'])
    assert any(x['id'] == successor and x['source_observation_id'] == source for x in provenance['observations'])
    assert preserved == sql(f"SELECT md5(jsonb_agg(to_jsonb(o)-ARRAY['is_superseded','superseded_by','superseded_at','lineage_chain'] ORDER BY id)::text) FROM vehicle_observations o WHERE id IN('{source}','{wrong}','{successor}')")
    assert sql(f"SELECT superseded_by='{successor}' AND superseded_at IS NOT NULL AND lineage_chain=ARRAY['{successor}'::uuid] FROM vehicle_observations WHERE id='{wrong}'") == 't'
    assert relay()['already']
    assert sql('SELECT count(*) FROM reattribution_audit') == '1'
    assert sql(f"SELECT actor_user_id='{actor}' AND reason='superseded via synthetic owner engine correction' FROM reattribution_audit") == 't'
    assert answer() == after and answer(subject=control) == unaffected
    assert answer('public.correction_frozen_answer') == before
    passed('sanctioned semantic supersession: V8 interpretation -> admitted I4 claim; original testimony/audit/retry/control preserved; exact canonical selector replays frozen earlier inputs (not historical RPC or accuracy proof)')
