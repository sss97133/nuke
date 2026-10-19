"""Whole-source Craigslist auto_miles replay with exact raw attributes and public readers."""
import json
import re
from pathlib import Path


def run_craigslist_odometer_checks(sql,read,rejects,claim,passed):
    literal=lambda s:"'"+s.replace("'","''")+"'"
    prop='abdd7a7a-02c1-4b09-afc6-1a288207dd2d'
    source='d7dad87c-0dc3-4b98-a31a-edf511618f8c'
    sql(f"""INSERT INTO observation_sources SELECT
     (jsonb_populate_record(NULL::observation_sources,to_jsonb(s)||jsonb_build_object(
      'id','{source}','slug','craigslist','base_trust_score',.4,'supported_observations',jsonb_build_array('listing')))).*
     FROM observation_sources s WHERE slug='bat'""")
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status IN('pending','skipped')")
    sql("""INSERT INTO vehicles SELECT
     (jsonb_populate_record(NULL::vehicles,to_jsonb(v)||jsonb_build_object(
      'id',('6c000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid))).*
     FROM vehicles v CROSS JOIN generate_series(1,102)i WHERE id='60000001-0000-4000-8000-000000000101'""")
    def parents(first,last,clock):
        for i in range(first,last+1):
            raw={'auto_miles':format(43000+i,',')}
            if i==2:raw['odometer_broken']='odometer broken'
            if i==3:raw['odometer_rolled_over']='odometer rolled over'
            metadata={'raw':{'post_id':str(7000000000+i),'attributes':{'raw':raw,'odometer_raw':raw['auto_miles'],
             'odometer':43000+i,'odometer_broken':i==2,'odometer_rolled_over':i==3}}}
            sql(f"""INSERT INTO vehicle_observations SELECT
             (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
              'id','9b100000-0000-4000-8000-{i:012d}','vehicle_id','6c000001-0000-4000-8000-{i:012d}',
              'source_id','{source}','source_identifier','{7000000000+i}',
              'source_url','https://www.craigslist.org/view/d/fixture-{i}/abcDEF_{i}',
              'ingested_at',{literal(clock)},'observed_at',NULL,'confidence_score',.4,
              'extraction_method','html_parse','content_hash','craigslist-odometer-parent-{i}',
              'structured_data',jsonb_build_object('mileage',999999),'extraction_metadata',{literal(json.dumps(metadata))}::jsonb))).*
             FROM vehicle_observations p WHERE id='98000000-0000-4000-8000-000000000001'""")
    parents(1,101,'2026-10-11T02:00:00.123456Z')
    vehicles=read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')
    original=read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')
    previous=read('SELECT to_jsonb(r) FROM retained_listing_property_replay r WHERE id')
    source_contract=read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")
    migration=Path('supabase/migrations/20261011021057_retained_craigslist_odometer_projection.sql').read_text()
    sql(migration)
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')==previous
    assert read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')==original
    assert read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")==source_contract
    assert claim('older-handler-before-craigslist-activation')==[]
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    corpus=Path('supabase/functions/ingest-observation/retainedCraigslistOdometer.test.ts').read_text()
    cases=json.loads(re.sub(r',(\s*\])',r'\1',corpus.split('const cases:',1)[1].split(' = ',1)[1].split('];',1)[0]+']'))
    parent='9b100000-0000-4000-8000-000000000001'
    for post,valid in [('7000000001',True),('7000000002',False)]:
        assert (read(f"SELECT coalesce(retained_craigslist_odometer_witness(jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object('source_url','https://sfbay.craigslist.org/eby/cto/d/example-car/{post}.html'))),'null'::jsonb) FROM vehicle_observations p WHERE id='{parent}'") is not None)==valid
    for raw,expected in cases:
        data={'raw':{'post_id':'7000000001','attributes':{'raw':{'auto_miles':raw},'odometer_raw':raw,
         'odometer':expected,'odometer_broken':False,'odometer_rolled_over':False}}}
        witness=read(f"SELECT coalesce(retained_craigslist_odometer_witness(jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object('extraction_metadata',{literal(json.dumps(data))}::jsonb))),'null'::jsonb) FROM vehicle_observations p WHERE id='{parent}'")
        assert (witness['value'] if witness else None)==expected
    result=None
    for _ in range(30):
        work=claim('craigslist-odometer-proof')
        for q in work:
            parent=q['source_observation_id'];assert q['property_id']==prop and q['mode']=='retained_listing_mileage_miles_v1'
            result=sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,source_identifier,
             raw_source_ref,kind,observed_at,confidence_score,agent_cost_cents,agent_model,property_id,source_observation_id,
             content_hash,extraction_method,content_text,structured_data)
             SELECT gen_random_uuid(),p.vehicle_id,p.source_id,p.source_url,'retained_listing_mileage_miles_v1:'||p.id,
             'vehicle_observations:'||p.id,'listing',p.ingested_at,.4,0,NULL,'{prop}',p.id,'craigslist-odometer-child-'||p.id,
             'retained_listing_property_projection_v1','Retained Craigslist auto_miles listing label.',
             jsonb_build_object('mileage_miles',w.d->'value','source_value',w.d->'source_value','source_reading_value',w.d->'value',
              'source_native_post_id',w.d->'source_native_post_id','odometer_broken',w.d->'odometer_broken','odometer_rolled_over',w.d->'odometer_rolled_over',
              'source_profile','craigslist_auto_miles_v1','reading_role','listing_odometer_label','true_mileage_status','unknown',
              'source_reading_unit','miles','reading_unit_basis','platform_auto_miles_attribute','reported_precision_miles',1,'value_is_approximate',false,
              'normalization_version','retained_odometer_miles_v1','source_observation_id',p.id::text,'property_key','mileage_miles',
              'source_field','extraction_metadata.raw.attributes.raw.auto_miles','analysis_kind','retained_listing_property_projection',
              'projection_version','retained_listing_mileage_miles_v1','claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
              'source_extraction_method',p.extraction_method,'source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,
              'source_event_time_status','unknown','factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false)
             FROM vehicle_observations p CROSS JOIN LATERAL(SELECT retained_craigslist_odometer_witness(p) AS d)w
             WHERE p.id='{parent}' RETURNING id""").splitlines()[0]
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','craigslist-odometer-proof','done','{result}')")=='t'
        if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id')=='t':break
    assert sql(f"SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9b100000-%' AND status='done'")=='101'
    parents(102,102,'2026-10-10T00:00:00.123456Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9b100000-%'")=='102'
    assert read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')==vehicles
    sql("ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY; CREATE POLICY craigslist_fixture_authenticated_source ON observation_sources FOR SELECT TO authenticated USING(true)")
    for role in ('anon','authenticated'):
        for i in (1,2,3):
            vehicle=f'6c000001-0000-4000-8000-{i:012d}'
            winner=sql(f"SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}'")
            assert sql(f"SELECT source_observation_id::text LIKE '9b100000-%' FROM vehicle_observations WHERE id='{winner}'")=='t'
            body=json.loads(sql(f"SET ROLE {role}; SELECT get_field_provenance('{vehicle}','mileage_miles'); RESET ROLE;").splitlines()[-2])
            reading=next(o for o in body['observations'] if o['source_observation_id']==f'9b100000-0000-4000-8000-{i:012d}')
            assert reading['value']==str(43000+i) and reading['source_value']==format(43000+i,',')
            assert reading['odometer_broken']==(i==2) and reading['odometer_rolled_over']==(i==3)
            assert reading['reading_role']=='listing_odometer_label' and reading['true_mileage_status']=='unknown'
            assert sql(f"SET ROLE {role}; SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}'; RESET ROLE;").splitlines()[-2]==winner
    assert sql('SET ROLE anon; SELECT count(*) FROM observation_sources; RESET ROLE;').splitlines()[-2]=='0'
    for key,value in [('odometer_broken',True),('mileage_miles',999999),('reading_role','odometer_display'),('source_event_time_status','known'),('source_native_post_id','wrong')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT
         (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
          'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({key:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    sql(f"UPDATE vehicles SET is_public=false WHERE id=(SELECT vehicle_id FROM vehicle_observations WHERE id='{result}')")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'")=='0'
    rejects(migration)
    sql("DROP POLICY craigslist_fixture_authenticated_source ON observation_sources; ALTER TABLE observation_sources DISABLE ROW LEVEL SECURITY")
    passed('Craigslist raw-attribute SQL/JS parity,101 baseline claims plus late arrival, disclosures/unknowns/source-kind/RLS preserved, exact public winners, forged claims refused and physical vehicles unchanged')
