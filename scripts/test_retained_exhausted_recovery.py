"""Receipted exhausted-work recovery through existing source guards and completion CAS."""
import json
from pathlib import Path


def run_exhausted_recovery_checks(sql,read,rejects,claim,passed):
    props=['c0f743ae-dc94-4dfd-98ef-514b76f74a9b','66b2f1f6-b714-4ac0-85b6-60ba89529c1a','235aed17-9bd3-4886-90be-9b1a8e2d1844']
    # Older synthetic powertrain fixtures omitted production ratification metadata.
    sql(f"UPDATE observation_properties SET ratified_at='2026-05-17' WHERE id=ANY(ARRAY{props}::uuid[])")
    sql("UPDATE observation_properties SET label='Engine Configuration',data_type='string',unit=NULL WHERE property_key='engine_configuration'")
    sql("UPDATE observation_properties SET label='Engine Displacement',data_type='numeric',unit='liters' WHERE property_key='engine_displacement_l'")
    sql("UPDATE observation_properties SET label='Transmission Type',data_type='enum',unit=NULL WHERE property_key='transmission_type'")
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status IN('pending','skipped')")
    template=sql("SELECT p.id FROM vehicle_observations p JOIN vehicles v ON v.id=p.vehicle_id AND v.is_public AND v.deleted_at IS NULL WHERE p.id::text LIKE '93000000-%' AND retained_description_property_witness(p,'engine_configuration') IS NOT NULL AND retained_description_property_witness(p,'engine_displacement_l') IS NOT NULL AND retained_description_property_witness(p,'transmission_type') IS NOT NULL LIMIT 1")
    assert template
    for i in range(1,47):
        parent='b02d4de6-fa8a-4ab4-b219-26f993ca774f' if i==43 else f'9e100000-0000-4000-8000-{i:012d}'
        sql(f"""INSERT INTO vehicles SELECT (jsonb_populate_record(NULL::vehicles,to_jsonb(v)||jsonb_build_object(
         'id','6e100001-0000-4000-8000-{i:012d}','is_public',true))).* FROM vehicles v
         WHERE id=(SELECT vehicle_id FROM vehicle_observations WHERE id='{template}')""")
        sql(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
         'id','{parent}','vehicle_id','6e100001-0000-4000-8000-{i:012d}','content_hash','exhausted-recovery-parent-{i}'))).*
         FROM vehicle_observations p WHERE id='{template}'""")
        assert sql(f"SELECT enqueue_retained_listing_properties('{parent}')") in ('0','3','6','7')
        if i!=43:
            sql(f"UPDATE retained_listing_property_work SET status='failed',attempts=3,last_error='lease_expired',next_attempt_at='2026-10-11T00:04:00.672708Z'::timestamptz+interval '{i} seconds' WHERE source_observation_id='{parent}' AND property_id=ANY(ARRAY{props}::uuid[])")
        else:
            sql(f"UPDATE retained_listing_property_work SET status='failed',attempts=3,last_error='canonical_request_failed',next_attempt_at='2026-10-10T23:55:06.661265Z' WHERE source_observation_id='{parent}' AND property_id='{props[2]}'")
        if i in (1,43):
            for prop in (props if i==1 else [props[2]]):
                child=sql(f"""INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
                 'id',gen_random_uuid(),'vehicle_id',p.vehicle_id,'source_observation_id',p.id,'content_hash','exhausted-recovery-child-'||p.id||'-'||o.property_id,
                 'source_identifier','retained_listing_'||(o.structured_data->>'property_key')||'_v1:'||p.id,
                 'raw_source_ref','vehicle_observations:'||p.id,'observed_at',p.ingested_at,
                 'structured_data',o.structured_data||jsonb_build_object('source_observation_id',p.id::text,'source_recorded_at',p.ingested_at)))).*
                 FROM vehicle_observations o JOIN vehicle_observations p ON p.id='{parent}'
                 WHERE o.source_observation_id='{template}' AND o.property_id='{prop}' AND retained_description_property_matches((SELECT p2 FROM vehicle_observations p2 WHERE p2.id='{template}'),o) LIMIT 1 RETURNING id""").splitlines()[0]
                assert child
    sql("UPDATE retained_listing_property_work SET next_attempt_at='2026-10-11T00:03:59Z' WHERE source_observation_id='9e100000-0000-4000-8000-000000000041'")
    sql("UPDATE vehicles SET is_public=false WHERE id='6e100001-0000-4000-8000-000000000042'")
    sql("UPDATE vehicle_observations SET is_superseded=true WHERE id='9e100000-0000-4000-8000-000000000044'")
    sql("UPDATE retained_listing_property_work SET attempts=2 WHERE source_observation_id='9e100000-0000-4000-8000-000000000045'")
    sql("UPDATE retained_listing_property_work SET last_error='unrelated_failure' WHERE source_observation_id='9e100000-0000-4000-8000-000000000046'")
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()+interval '24 hours' WHERE status IN('pending','skipped')")
    target="(source_observation_id::text LIKE '9e100000-%' AND source_observation_id::text<'9e100000-0000-4000-8000-000000000041' AND property_id=ANY(ARRAY"+str(props)+"::uuid[])) OR(source_observation_id='b02d4de6-fa8a-4ab4-b219-26f993ca774f' AND property_id='"+props[2]+"')"
    previous=read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')
    original=read(f'SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE {target}')
    others=read(f'SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE NOT({target})')
    vehicles=read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')
    observations=sql('SELECT count(*) FROM vehicle_observations')
    migration=Path('supabase/migrations/20261011033344_retained_exhausted_work_recovery.sql').read_text()
    sql("UPDATE cron.job SET active=false")
    rejects(migration)
    sql("UPDATE cron.job SET active=true")
    sql(migration)
    receipt=read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')
    recovery=receipt.pop('exhausted_lease_retry_recovery')
    assert recovery['requeued']==121 and recovery['previous_work']==original and receipt==previous
    assert read(f'SELECT jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id) FROM retained_listing_property_work q WHERE NOT({target})')==others
    assert sql('SELECT count(*) FROM vehicle_observations')==observations
    assert read('SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vehicles v')==vehicles
    rejects(migration)
    sql("UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp() WHERE last_error='qualified_exhausted_work_recheck'")
    work=claim('exhausted-recovery-proof')+claim('exhausted-recovery-proof')
    assert len(work)==121
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='claimed' AND attempts=1 AND locked_by='exhausted-recovery-proof'")=='121'
    for q in work:
        parent=q['source_observation_id'];prop=q['property_id']
        child=sql(f"SELECT id FROM vehicle_observations o WHERE source_observation_id='{parent}' AND property_id='{prop}' AND retained_listing_property_result_matches('{parent}','{prop}',o.id) LIMIT 1")
        if child:
            assert sql(f"SELECT finish_retained_listing_property('{parent}','{prop}','exhausted-recovery-proof','done','{child}')")=='t'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='done' AND source_observation_id IN('9e100000-0000-4000-8000-000000000001','b02d4de6-fa8a-4ab4-b219-26f993ca774f')")=='4'
    passed('121 currently qualified exhausted items requeued with exact prior receipts; outside-window/private/unrelated work and all testimony/vehicles unchanged; owner pause/repeat refused; admitted-child completion uses existing CAS')
