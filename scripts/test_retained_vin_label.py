"""Literal VIN labels, exact source custody and whole-source replay in the owned fixture."""
import json
import re
from pathlib import Path


def run_vin_label_checks(sql,read,rejects,claim,passed):
    literal=lambda s:"'"+s.replace("'","''")+"'"
    prop='9fc93dd3-3639-439a-8eed-3e9a0f846334'
    for kind in ('ownership','provenance'):
        sql(f"ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS '{kind}'")
    sql(f"""INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds,label,data_type,ratified_at)
     VALUES('{prop}','vin','core',ARRAY['specification','ownership','provenance']::observation_kind[],'VIN','string','2026-05-17')""")
    # Isolate prior families' synthetic recovery work without dropping it.
    sql("UPDATE retained_listing_property_work SET status='skipped',attempts=0,next_attempt_at=clock_timestamp()+interval '24 hours',last_error='fixture_prior_family_deferred' WHERE status='pending'")
    sql("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin text")
    sql("UPDATE vehicles SET vin='1FTFW1E80JFA99999' WHERE id='60000001-0000-4000-8000-000000000001'")
    vehicles_before=read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')
    def parents(first,last,clock):
        sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,
         extraction_method,confidence_score,structured_data,content_text)
         SELECT ('98000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
         ('60000001-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'listing',
         '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/vin-label-fixture-'||i,
         NULL,{literal(clock)},'html_match',1,
         jsonb_build_object('vin','1FTFW1E80JFA'||lpad(i::text,5,'0')),'Retained extractor VIN label.' FROM generate_series({first},{last})i""")
    parents(1,101,'2026-10-10T20:00:00Z')
    old_work=read('SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q')
    old_receipt=read('SELECT to_jsonb(r) FROM retained_listing_property_replay r WHERE id')
    sql('UPDATE cron.job SET active=true')
    migration=Path('supabase/migrations/20261011002640_retained_listing_vin_label_projection.sql').read_text()
    sql(migration)
    assert read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')==old_receipt
    assert read(f"SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE property_id<>'{prop}'")==old_work
    assert sql("SELECT active FROM cron.job WHERE jobname='project-retained-listing-properties'")=='f'
    assert claim('older-worker-during-installation')==[]
    assert sql('SELECT keys_seen FROM retained_listing_property_replay WHERE id')=='0'
    assert sql('SELECT activate_retained_listing_property_intake()')=='t'
    source=Path('supabase/functions/ingest-observation/retainedVinLabel.test.ts').read_text()
    array=source.split('const cases:',1)[1].split(' = ',1)[1].split('];',1)[0]+']'
    cases=json.loads(re.sub(r',(\s*\])',r'\1',array))
    for value,expected in cases:
        assert read(f"SELECT coalesce(retained_listing_identity_value('vin',{literal(json.dumps(value))}::jsonb),'null'::jsonb)")==expected
    passed('SQL/JS VIN literal parity; existing work and nested receipts preserved; matching worker activation barrier remains')
    result=None;worker='vin-label-fixture'
    for _ in range(30):
        work=claim(worker)
        for row in work:
            assert row['property_id']==prop and row['mode']=='retained_listing_vin_v1'
            parent=row['source_observation_id']
            result=sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_identifier,
             source_url,raw_source_ref,observed_at,extraction_method,confidence_score,property_id,
             source_observation_id,content_hash,agent_cost_cents,agent_model,structured_data,content_text)
             SELECT gen_random_uuid(),p.vehicle_id,'specification',p.source_id,'retained_listing_vin_v1:'||p.id,
             p.source_url,'vehicle_observations:'||p.id,p.ingested_at,'retained_listing_property_projection_v1',.6,
             '{prop}',p.id,'vin-label-fixture:'||p.id,0,NULL,
             jsonb_build_object('vin',p.structured_data->'vin','source_value',p.structured_data->'vin','source_field','vin',
              'property_key','vin','source_observation_id',p.id::text,'normalization_version','retained_listing_identity_labels_v1',
              'identity_role','extractor_vehicle_label','identity_resolution_status','unverified',
              'vin_identifier_namespace','standard_17_character_vin_label','vin_format_status','17_character_format','vin_checksum_status','not_evaluated',
              'source_event_time_status','unknown','factory_configuration_status','unknown','current_configuration_status','unknown',
              'independent_source',false,'analysis_kind','retained_listing_property_projection','projection_version','retained_listing_vin_v1',
              'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at','source_recorded_at',p.ingested_at,
              'source_observed_at',p.observed_at,'source_confidence_score',p.confidence_score,'source_extraction_method',p.extraction_method),
              'Unverified retained VIN label.' FROM vehicle_observations p WHERE p.id='{parent}' RETURNING id""").splitlines()[0]
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','{worker}','done','{result}')")=='t'
        if sql('SELECT scan_completed_at IS NOT NULL FROM retained_listing_property_replay WHERE id')=='t':break
    assert sql(f"SELECT count(*) FROM retained_listing_property_work WHERE property_id='{prop}' AND status='done'")=='101'
    parents(102,102,'2026-10-10T00:00:00Z')
    assert sql(f"SELECT count(*) FROM retained_listing_property_work WHERE property_id='{prop}'")=='102'
    assert read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')==vehicles_before
    sql("ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY; CREATE POLICY vin_fixture_authenticated_source ON observation_sources FOR SELECT TO authenticated USING(true)")
    for role in ('anon','authenticated'):
        body=json.loads(sql(f"SET ROLE {role}; SELECT get_field_provenance('60000001-0000-4000-8000-000000000001','vin'); RESET ROLE;").splitlines()[-2])
        reading=next(o for o in body['observations'] if o['source_observation_id']=='98000000-0000-4000-8000-000000000001')
        assert reading['value']=='1FTFW1E80JFA00001' and reading['vin_checksum_status']=='not_evaluated'
        assert reading['identity_resolution_status']=='unverified' and reading['vin_identifier_namespace']=='standard_17_character_vin_label'
        assert sql(f"SET ROLE {role}; SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='60000001-0000-4000-8000-000000000001' AND property_id='{prop}'; RESET ROLE;").splitlines()[-2]=='1'
    assert sql('SET ROLE anon; SELECT count(*) FROM observation_sources; RESET ROLE;').splitlines()[-2]=='0'
    for field,value in [('vin_checksum_status','verified'),('vin_identifier_namespace','legacy_chassis'),('vin','30867S100001'),('identity_resolution_status','verified')]:
        rejects(f"""INSERT INTO vehicle_observations SELECT
         (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),
          'content_hash',gen_random_uuid()::text,'structured_data',o.structured_data||{literal(json.dumps({field:value}))}::jsonb))).*
         FROM vehicle_observations o WHERE id='{result}'""")
    rejects(migration)
    sql('DROP POLICY vin_fixture_authenticated_source ON observation_sources; ALTER TABLE observation_sources DISABLE ROW LEVEL SECURITY')
    passed('finite VIN baseline101 plus late source arrival; public namespace-qualified provenance/canonical claims; no physical VIN overwrite, provider call or legacy-namespace folding')
