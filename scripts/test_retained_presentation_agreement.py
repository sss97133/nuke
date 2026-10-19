"""Exact material-boundary agreement and receipted operational retry recovery."""
import json
import re
from pathlib import Path


def run_presentation_agreement_checks(sql, read, rejects, claim, passed):
    literal=lambda s:"'"+s.replace("'","''")+"'"
    source=Path('supabase/functions/ingest-observation/retainedPresentationAgreement.test.ts').read_text()
    cases=json.loads(re.sub(r',(\s*\])',r'\1',source.split('const cases:',1)[1].split(' = ',1)[1].split('];',1)[0]+']'))
    text='This vehicle is offered with service records, factory literature, and a clean title. '+cases[0][1]
    assert read(f"SELECT retained_description_presentation_witness('interior_color',{literal(text)})")['value']=='black leather with gray'
    prop='514cacd3-82b4-4330-b3df-e292612ee718'
    sql(f"""INSERT INTO vehicle_observations SELECT
     (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
      'id',('99000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      'vehicle_id','60000001-0000-4000-8000-000000000101',
      'ingested_at','2026-10-11T01:30:00.123456Z',
      'content_hash','presentation-agreement-parent-'||i,'content_text',{literal(text)}))).*
     FROM vehicle_observations p CROSS JOIN generate_series(1,6)i
     WHERE p.id='96000000-0000-4000-8000-000000000101'""")
    sql(f"""UPDATE retained_listing_property_work SET status='failed',attempts=3,last_error='canonical_request_failed',
     next_attempt_at='2026-10-11T00:56:00Z' WHERE source_observation_id::text LIKE '99000000-%' AND property_id='{prop}'""")
    # Prior families' synthetic work stays retained but is not due during this proof.
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status='pending'")
    previous=read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')
    original=read(f"SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id) FROM retained_listing_property_work q WHERE source_observation_id::text LIKE '99000000-%' AND property_id='{prop}'")
    others=read(f"SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE NOT(source_observation_id::text LIKE '99000000-%' AND property_id='{prop}')")
    oid=sql("SELECT 'retained_description_presentation_witness(text,text)'::regprocedure::oid")
    migration=Path('supabase/migrations/20261011013632_retained_presentation_witness_agreement.sql').read_text()
    sql(migration)
    receipt=read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')
    recovery=receipt.pop('presentation_regex_retry_recovery')
    assert receipt==previous and recovery['previous_work']==original and recovery['requeued']==6
    assert read(f"SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE NOT(source_observation_id::text LIKE '99000000-%' AND property_id='{prop}')")==others
    assert sql("SELECT 'retained_description_presentation_witness(text,text)'::regprocedure::oid")==oid
    for key,sentence,expected in cases:
        witness=read(f"SELECT coalesce(retained_description_presentation_witness({literal(key)},{literal('This vehicle is offered with service records, factory literature, and a clean title. '+sentence)}),'null'::jsonb)")
        assert (witness['value'] if witness else None)==expected
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp() WHERE last_error='presentation_regex_incident_recheck'")
    batch=claim('presentation-agreement-proof')
    assert len(batch)==6
    for q in batch:
        parent=q['source_observation_id']
        child=sql(f"""INSERT INTO vehicle_observations SELECT
         (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
          'id',gen_random_uuid(),'vehicle_id',p.vehicle_id,'source_observation_id',p.id,
          'content_hash','presentation-agreement-child-'||p.id,'source_identifier','retained_listing_interior_color_v1:'||p.id,
          'raw_source_ref','vehicle_observations:'||p.id,'structured_data',o.structured_data||jsonb_build_object(
           'interior_color','black','source_value',{literal(cases[0][1])},'source_observation_id',p.id::text,
           'source_recorded_at',p.ingested_at),'observed_at',p.ingested_at))).*
         FROM vehicle_observations o JOIN vehicle_observations p ON p.id='{parent}'
         WHERE o.source_observation_id='96000000-0000-4000-8000-000000000101' AND o.property_id='{prop}' LIMIT1 RETURNING id""".replace('LIMIT1','LIMIT 1')).splitlines()[0]
        assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','presentation-agreement-proof','done','{child}')")=='t'
        assert sql(f"SELECT retained_listing_property_result_matches('{parent}','{prop}','{child}')")=='t'
    winner=sql(f"SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='60000001-0000-4000-8000-000000000101' AND property_id='{prop}'")
    assert sql(f"SELECT source_observation_id::text LIKE '99000000-%' FROM vehicle_observations WHERE id='{winner}'")=='t'
    for role in ('anon','authenticated'):
        observations=json.loads(sql(f"SET ROLE {role}; SELECT get_field_provenance('60000001-0000-4000-8000-000000000101','interior_color'); RESET ROLE;").splitlines()[-2])['observations']
        assert any((o.get('source_observation_id') or '').startswith('99000000-') and o['value']=='black' and o['source_value']==cases[0][1] for o in observations)
        assert sql(f"SET ROLE {role}; SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='60000001-0000-4000-8000-000000000101' AND property_id='{prop}'; RESET ROLE;").splitlines()[-2]==winner
    rejects(migration)
    passed('SQL/JS first-material parity, six receipted retries naturally claimed and source-custody completed, public readers and unchanged prior work')
