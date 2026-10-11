"""Literal source-year labels through complete replay, arrivals and public readers."""
import json
import re
from pathlib import Path


def run_craigslist_year_checks(sql,read,rejects,claim,passed):
    literal=lambda s:"'"+s.replace("'","''")+"'"
    prop='ece619f7-c49a-44f7-999f-a41acf5d4dc3'
    source='d7dad87c-0dc3-4b98-a31a-edf511618f8c'
    # Match the ratified production contract; older identity fixtures had only specification.
    sql(f"UPDATE observation_properties SET applies_to_kinds=ARRAY['specification','listing']::observation_kind[] WHERE id='{prop}'")
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status IN('pending','skipped')")
    sql("""INSERT INTO vehicles SELECT (jsonb_populate_record(NULL::vehicles,to_jsonb(v)||jsonb_build_object(
     'id',('7c000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'is_public',true))).*
     FROM vehicles v CROSS JOIN generate_series(1,102)i WHERE id='6c000001-0000-4000-8000-000000000001'""")
    def parents(first,last,clock):
        for i in range(first,last+1):
            metadata={'raw':{'post_id':str(8000000000+i),'attributes':{'raw':{'year':str(1900+i),'makemodel':'ambiguous retained words','auto_miles':'invalid'}}}}
            sql(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
             'id','9c100000-0000-4000-8000-{i:012d}','vehicle_id','7c000001-0000-4000-8000-{i:012d}',
             'source_identifier','{8000000000+i}','source_url','https://www.craigslist.org/view/d/year-fixture-{i}/yearToken_{i}',
             'ingested_at',{literal(clock)},'content_hash','craigslist-year-parent-{i}',
             'structured_data',jsonb_build_object('year',1990),'extraction_metadata',{literal(json.dumps(metadata))}::jsonb))).*
             FROM vehicle_observations p WHERE id='9b100000-0000-4000-8000-000000000001'""")
    parents(1,101,'2026-10-11T04:00:00.123456Z')
    vehicles=read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')
    prior_work=read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')
    odometer_custody=read("SELECT jsonb_agg(jsonb_build_object('source',source_observation_id,'current',retained_listing_property_result_matches(source_observation_id,property_id,observation_id)) ORDER BY source_observation_id) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9b100000-%' AND status='done'")
    previous=read('SELECT to_jsonb(r) FROM retained_listing_property_replay r WHERE id')
    source_contract=read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")
    trigger=sql("SELECT oid||':'||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='retained_listing_property_intake'")
    view=sql("SELECT 'vehicle_canonical'::regclass::oid")
    migration=Path('supabase/migrations/20261011040007_retained_craigslist_year_projection.sql').read_text()
    sql(migration)
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')==previous
    assert read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')==prior_work
    assert read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")==source_contract
    assert sql("SELECT oid||':'||pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='retained_listing_property_intake'")==trigger
    assert sql("SELECT 'vehicle_canonical'::regclass::oid")==view
    assert claim('older-worker-before-year-activation')==[]
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    corpus=Path('supabase/functions/ingest-observation/retainedCraigslistYear.test.ts').read_text()
    cases=json.loads(re.sub(r',(\s*\])',r'\1',corpus.split('const cases:',1)[1].split(' = ',1)[1].split('];',1)[0]+']'))
    parent='9c100000-0000-4000-8000-000000000001'
    for raw,expected in cases:
        data={'raw':{'post_id':'8000000001','attributes':{'raw':{'year':raw}}}}
        w=read(f"SELECT coalesce(retained_craigslist_year_witness(jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object('extraction_metadata',{literal(json.dumps(data))}::jsonb))),'null'::jsonb) FROM vehicle_observations p WHERE id='{parent}'")
        assert (w['value'] if w else None)==expected
    result=None
    for _ in range(40):
        work=claim('craigslist-year-proof')
        for q in work:
            parent=q['source_observation_id'];assert q['property_id']==prop and q['mode']=='retained_listing_year_v1'
            result=sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,source_id,source_url,source_identifier,raw_source_ref,
             kind,observed_at,confidence_score,agent_cost_cents,agent_model,property_id,source_observation_id,content_hash,extraction_method,content_text,structured_data)
             SELECT gen_random_uuid(),p.vehicle_id,p.source_id,p.source_url,'retained_listing_year_v1:'||p.id,'vehicle_observations:'||p.id,
             'listing',p.ingested_at,.4,0,NULL,'{prop}',p.id,'craigslist-year-child-'||p.id,'retained_listing_property_projection_v1','Retained Craigslist year label.',
             jsonb_build_object('year',w.d->'value','source_value',w.d->'source_value','source_native_post_id',w.d->'source_native_post_id',
              'source_profile','craigslist_year_attribute_v1','year_label_basis','platform_year_attribute_or_title_row',
              'identity_role','extractor_vehicle_label','identity_resolution_status','unverified','normalization_version','retained_listing_year_attribute_v1',
              'source_observation_id',p.id::text,'property_key','year','source_field','extraction_metadata.raw.attributes.raw.year',
              'analysis_kind','retained_listing_property_projection','projection_version','retained_listing_year_v1','claim_role','listing_claim',
              'observed_at_basis','source_testimony_recorded_at','source_extraction_method',p.extraction_method,'source_recorded_at',p.ingested_at,
              'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,'source_event_time_status','unknown',
              'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false)
             FROM vehicle_observations p CROSS JOIN LATERAL(SELECT retained_craigslist_year_witness(p) AS d)w WHERE p.id='{parent}' RETURNING id""").splitlines()[0]
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','craigslist-year-proof','done','{result}')")=='t'
        if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id')=='t':break
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9c100000-%' AND status='done'")=='101'
    parents(102,102,'2026-10-10T00:00:00.123456Z')
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9c100000-%'")=='102'
    assert read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')==vehicles
    # Existing odometer completions still use their original profile and witnesses.
    assert read("SELECT jsonb_agg(jsonb_build_object('source',source_observation_id,'current',retained_listing_property_result_matches(source_observation_id,property_id,observation_id)) ORDER BY source_observation_id) FROM retained_listing_property_work WHERE source_observation_id::text LIKE '9b100000-%' AND status='done'")==odometer_custody
    sql("ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY; CREATE POLICY year_fixture_authenticated_source ON observation_sources FOR SELECT TO authenticated USING(true)")
    for role in ('anon','authenticated'):
        for i in (1,2,3):
            vehicle=f'7c000001-0000-4000-8000-{i:012d}'
            winner=sql(f"SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}'")
            body=json.loads(sql(f"SET ROLE {role};SELECT get_field_provenance('{vehicle}','year');RESET ROLE;").splitlines()[-2])
            o=next(o for o in body['observations'] if o['source_observation_id']==f'9c100000-0000-4000-8000-{i:012d}')
            assert o['value']==str(1900+i) and o['source_value']==str(1900+i) and o['kind']=='listing'
            assert o['source_profile']=='craigslist_year_attribute_v1' and o['year_label_basis']=='platform_year_attribute_or_title_row'
            assert o['identity_resolution_status']=='unverified' and o['source_event_time_status']=='unknown'
            assert sql(f"SET ROLE {role};SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{vehicle}' AND property_id='{prop}';RESET ROLE;").splitlines()[-2]==winner
    assert sql('SET ROLE anon;SELECT count(*) FROM observation_sources;RESET ROLE;').splitlines()[-2]=='0'
    contract=read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")
    sql(f"UPDATE observation_sources SET supported_observations=ARRAY['specification']::observation_kind[] WHERE id='{source}'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='7c000001-0000-4000-8000-000000000001';RESET ROLE;").splitlines()[-2]=='0'
    sql(f"UPDATE observation_sources SET supported_observations=ARRAY['listing']::observation_kind[] WHERE id='{source}'")
    assert read(f"SELECT to_jsonb(s) FROM observation_sources s WHERE id='{source}'")==contract
    sql(f"UPDATE observation_properties SET deprecated_at=clock_timestamp() WHERE id='{prop}'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='7c000001-0000-4000-8000-000000000001';RESET ROLE;").splitlines()[-2]=='0'
    sql(f"UPDATE observation_properties SET deprecated_at=NULL WHERE id='{prop}'")
    sql("UPDATE vehicle_observations SET is_superseded=true WHERE id='9c100000-0000-4000-8000-000000000002'")
    assert sql("SET ROLE anon;SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='7c000001-0000-4000-8000-000000000002';RESET ROLE;").splitlines()[-2]=='0'
    for key,value in [('year',1990),('year_label_basis','vehicle_scalar'),('identity_resolution_status','verified'),('source_event_time_status','known'),('source_native_post_id','wrong')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
         'id',gen_random_uuid(),'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({key:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    sql(f"UPDATE vehicles SET is_public=false WHERE id=(SELECT vehicle_id FROM vehicle_observations WHERE id='{result}')")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE observation_id='{result}'")=='0'
    rejects(migration)
    sql("DROP POLICY year_fixture_authenticated_source ON observation_sources;ALTER TABLE observation_sources DISABLE ROW LEVEL SECURITY")
    passed('Craigslist year SQL/JS parity,101 baseline labels plus late arrival, independent attribute availability, exact public readers, unchanged odometer custody/source contracts/trigger/vehicles and forged identity/year refusal')
