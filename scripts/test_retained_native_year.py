"""Original native introduction labels through replay, arrivals and current readers."""
import json
import re
from pathlib import Path


def run_native_year_checks(sql,read,rejects,claim,passed):
    literal=lambda s:"'"+s.replace("'","''")+"'"
    prop='ece619f7-c49a-44f7-999f-a41acf5d4dc3'
    source='4cdc735c-f117-42f2-889f-ba33805639a5'
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status IN('pending','skipped')")
    template=sql("SELECT p.id FROM vehicle_observations p JOIN vehicles v ON v.id=p.vehicle_id AND v.is_public WHERE p.id::text LIKE '9e100000-%' AND retained_description_property_witness(p,'engine_configuration') IS NOT NULL ORDER BY p.id LIMIT 1")
    assert template
    sql(f"""INSERT INTO vehicles SELECT (jsonb_populate_record(NULL::vehicles,to_jsonb(v)||jsonb_build_object(
     'id',('8d000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'is_public',true))).*
     FROM vehicles v CROSS JOIN generate_series(1,102)i WHERE id=(SELECT vehicle_id FROM vehicle_observations WHERE id='{template}')""")
    rest=' It was acquired in 2026 and has a replacement engine. Its factory configuration and true identity remain unverified.'
    def body(i):
        return ("This 2014 Airstream Interstate 24 Lounge Extended was built on a 2013 Mercedes-Benz Sprinter 3500 chassis." if i==1 else
                "This 2001 BMW X5 4.4i remained with its original owner until 2024." if i==2 else
                f"This {1900+i} Example Vehicle is described by its publisher.")+rest
    def parents(first,last,clock):
        for i in range(first,last+1):
            sql(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
             'id','9d100000-0000-4000-8000-{i:012d}','vehicle_id','8d000001-0000-4000-8000-{i:012d}',
             'ingested_at',{literal(clock)},'content_hash','native-year-parent-{i}','content_text',{literal(body(i))},
             'structured_data',p.structured_data||jsonb_build_object('year',1990)))).*
             FROM vehicle_observations p WHERE id='{template}'""")
    parents(1,101,'2026-10-11T05:00:00.123456Z')
    vehicles=read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')
    prior_work=read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')
    def custody():
        return read("SELECT jsonb_agg(jsonb_build_object('source',source_observation_id,'property',property_id,'current',retained_listing_property_result_matches(source_observation_id,property_id,observation_id)) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work WHERE status='done' AND source_observation_id::text NOT LIKE '9d100000-%'")
    old_custody=custody()
    previous=read('SELECT to_jsonb(r) FROM retained_listing_property_replay r WHERE id')
    contract=read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")
    trigger=sql("SELECT oid||':'||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='retained_listing_property_intake'")
    view=sql("SELECT 'vehicle_canonical'::regclass::oid")
    migration=Path('supabase/migrations/20261011050753_retained_native_description_year_projection.sql').read_text()
    sql(migration)
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')==previous
    assert read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')==prior_work
    assert read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")==contract
    assert sql("SELECT oid||':'||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='retained_listing_property_intake'")==trigger
    assert sql("SELECT 'vehicle_canonical'::regclass::oid")==view
    assert claim('older-worker-before-native-year-activation')==[]
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    corpus=Path('supabase/functions/ingest-observation/retainedDescriptionYear.test.ts').read_text()
    cases=json.loads(re.sub(r',(\s*\])',r'\1','['+corpus.split('const cases:',1)[1].split('=[',1)[1].split('];',1)[0]+']'))
    for opening,year,label in cases:
        w=read(f"SELECT coalesce(retained_description_year_text_witness({literal(opening+rest)}),'null'::jsonb)")
        assert (w['value'] if w else None)==year and (w['source_subject_label'] if w else None)==label
        if w:assert w['source_value']==opening and w['source_year_token']==str(year)
    result=None
    for _ in range(80):
        work=claim('native-year-proof')
        for q in work:
            parent=q['source_observation_id'];assert q['property_id']==prop and q['mode']=='retained_listing_year_v1'
            result=sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,source_identifier,raw_source_ref,
             kind,observed_at,confidence_score,agent_cost_cents,agent_model,property_id,source_observation_id,content_hash,extraction_method,content_text,structured_data)
             SELECT gen_random_uuid(),p.vehicle_id,p.source_id,p.source_url,'retained_listing_year_v1:'||p.id,'vehicle_observations:'||p.id,
             'specification',p.ingested_at,.6,0,NULL,'{prop}',p.id,'native-year-child-'||p.id,'retained_listing_property_projection_v1','Retained native listing year label.',
             jsonb_build_object('year',w.d->'value','source_value',w.d->'source_value','source_year_token',w.d->'source_year_token','source_subject_label',w.d->'source_subject_label',
              'source_profile','bat_description_year_label_v1','year_label_basis','native_listing_subject_introduction',
              'identity_role','extractor_vehicle_label','identity_resolution_status','unverified','normalization_version','retained_description_year_label_v1',
              'source_witness_version','retained_description_year_label_v1','source_capture_sha256',p.structured_data->'source_capture_sha256',
              'source_observation_id',p.id::text,'property_key','year','source_field','content_text','analysis_kind','retained_listing_property_projection',
              'projection_version','retained_listing_year_v1','claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
              'source_extraction_method',p.extraction_method,'source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,
              'source_confidence_score',p.confidence_score,'source_event_time_status','unknown','factory_configuration_status','unknown',
              'current_configuration_status','unknown','independent_source',false)
             FROM vehicle_observations p CROSS JOIN LATERAL(SELECT retained_description_property_witness(p,'year') AS d)w WHERE p.id='{parent}' RETURNING id""").splitlines()[0]
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','native-year-proof','done','{result}')")=='t'
        if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id')=='t':break
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9d100000-%' AND status='done'")=='101'
    parents(102,102,'2026-10-10T00:00:00.123456Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9d100000-%'")=='102'
    assert read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')==vehicles and custody()==old_custody
    sql("ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY;CREATE POLICY native_year_fixture_authenticated ON observation_sources FOR SELECT TO authenticated USING(true)")
    for role in ('anon','authenticated'):
        for i in (1,2,3):
            vehicle=f'8d000001-0000-4000-8000-{i:012d}'
            winner=sql(f"SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}'")
            d=json.loads(sql(f"SET ROLE {role};SELECT get_field_provenance('{vehicle}','year');RESET ROLE;").splitlines()[-2])
            o=next(o for o in d['observations'] if o['source_observation_id']==f'9d100000-0000-4000-8000-{i:012d}')
            expected=2014 if i==1 else 2001 if i==2 else 1900+i
            assert o['value']==str(expected) and o['source_year_token']==str(expected) and o['kind']=='specification'
            assert o['source_value']==body(i).split(' It was acquired',1)[0] and o['year_label_basis']=='native_listing_subject_introduction'
            assert o['source_profile']=='bat_description_year_label_v1' and o['identity_resolution_status']=='unverified' and o['source_event_time_status']=='unknown'
            assert sql(f"SET ROLE {role};SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}';RESET ROLE;").splitlines()[-2]==winner
    assert sql('SET ROLE anon;SELECT count(*) FROM observation_sources;RESET ROLE;').splitlines()[-2]=='0'
    sql(f"UPDATE observation_sources SET supported_observations=ARRAY['listing']::observation_kind[] WHERE id='{source}'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='8d000001-0000-4000-8000-000000000001';RESET ROLE;").splitlines()[-2]=='0'
    values=','.join(literal(k) for k in contract['supported_observations'])
    sql(f"UPDATE observation_sources SET supported_observations=ARRAY[{values}]::observation_kind[] WHERE id='{source}'")
    assert read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")==contract
    sql(f"UPDATE observation_properties SET deprecated_at=clock_timestamp() WHERE id='{prop}'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='8d000001-0000-4000-8000-000000000001';RESET ROLE;").splitlines()[-2]=='0'
    sql(f"UPDATE observation_properties SET deprecated_at=NULL WHERE id='{prop}'")
    sql("UPDATE vehicle_observations SET is_superseded=true WHERE id='9d100000-0000-4000-8000-000000000002'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='8d000001-0000-4000-8000-000000000002';RESET ROLE;").splitlines()[-2]=='0'
    for key,value in [('year',1990),('year_label_basis','vehicle_scalar'),('source_year_token','1974'),('source_subject_label','Other Object'),('identity_resolution_status','verified'),('source_capture_sha256','wrong'),('source_event_time_status','known')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
         'id',gen_random_uuid(),'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({key:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    sql(f"UPDATE vehicles SET is_public=false WHERE id=(SELECT vehicle_id FROM vehicle_observations WHERE id='{result}')")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'")=='0'
    rejects(migration)
    sql("DROP POLICY native_year_fixture_authenticated ON observation_sources;ALTER TABLE observation_sources DISABLE ROW LEVEL SECURITY")
    passed('native year SQL/JS opening-label parity,101 baseline claims plus late arrival, exact public winners, source/property/parent/privacy withdrawals, unchanged prior custody/vehicles/source contracts/trigger and forged year/identity refusal')
