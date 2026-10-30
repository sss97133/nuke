"""Mecum identity through the actual TS decoder, SQL custody, queue and public reader.

Synthetic local fixture only. Deployed HTTP admission still needs a runtime canary.
"""
import hashlib
import json
from pathlib import Path
import subprocess


def run_mecum_identity_checks(sql, read, rejects, claim, passed):
    literal = lambda x: "'" + x.replace("'", "''") + "'"
    source_id = 'fee71d50-c59c-4340-b819-cd9a7d074d7f'
    vehicle_id = 'fa000001-0000-4000-8000-000000000001'
    parent_id = 'fa000000-0000-4000-8000-000000000001'
    sql(f"""INSERT INTO observation_sources(id,slug,supported_observations)
      VALUES('{source_id}','mecum',ARRAY['listing','sale_result','bid','condition']::observation_kind[]);
      INSERT INTO vehicles(id,is_public,listing_kind,year,make,model)
      VALUES('{vehicle_id}',true,'vehicle',1971,'Chevrolet','K10 Custom');""")
    source = dict(id=parent_id, vehicle_id=vehicle_id, source_id=source_id, kind='sale_result',
                  extraction_method='public_lot_index', is_superseded=False, property_id=None,
                  subject_type='vehicle', subject_id=None, confidence_score=.7,
                  source_url='https://www.mecum.com/lots/1/1971-chevrolet-k10-custom-pickup/',
                  observed_at='2026-10-01T00:00:00Z', ingested_at='2026-10-01T00:00:01Z',
                  structured_data=dict(year=1971, make='Chevrolet', model='K10 Custom', engine_size='350ci V8'))
    sql(f"""INSERT INTO vehicle_observations(id,vehicle_id,source_id,kind,extraction_method,
      confidence_score,source_url,observed_at,ingested_at,structured_data)
      VALUES('{parent_id}','{vehicle_id}','{source_id}','sale_result','public_lot_index',.7,
      {literal(source['source_url'])},'2026-10-01T00:00:00Z','2026-10-01T00:00:01Z',
      {literal(json.dumps(source['structured_data']))}::jsonb);""")
    assert sql(f"SELECT count(*) FROM retained_listing_property_work WHERE source_observation_id='{parent_id}'") == '0'
    migration = Path('supabase/migrations/20261030053855_admit_retained_mecum_identity_labels.sql').read_text()
    sql(migration)
    assert sql(f"SELECT enqueue_retained_listing_properties(ARRAY['{parent_id}'::uuid])") == '3'
    assert sql(f"SELECT enqueue_retained_listing_properties(ARRAY['{parent_id}'::uuid])") == '0'
    # Prior fixture work does not hide this cohort behind unrelated test leases.
    sql(f"UPDATE retained_listing_property_work SET next_attempt_at=clock_timestamp()-interval '1 day' WHERE source_observation_id='{parent_id}'")
    work = claim('mecum-identity-fixture', 3)
    assert len(work) == 3 and all(x['source_observation_id'] == parent_id for x in work)
    decoder = '''import {deriveRetainedInterior} from "./supabase/functions/ingest-observation/retainedInterior.ts";
const s=JSON.parse(Deno.args[0]);const v={id:s.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"};
console.log(JSON.stringify(["year","make","model"].map(k=>deriveRetainedInterior(s,v,{id:s.source_id,slug:"mecum"},`retained_listing_${k}_v1`))));'''
    derived = json.loads(subprocess.check_output(['deno','eval','--cached-only',decoder,json.dumps(source)],text=True))
    properties = {'year':'ece619f7-c49a-44f7-999f-a41acf5d4dc3',
                  'make':'8d274b73-a8a6-43bf-9036-5864d0152725',
                  'model':'a79b528f-7d9d-46ca-96f9-96d899e81d10'}
    for i, d in enumerate(derived,1):
        key=d['property_key']; prop=properties[key]; child=f'fa000002-0000-4000-8000-{i:012d}'
        assert d['source_slug']=='mecum' and d['structured_data'][key]==source['structured_data'][key]
        def insert(payload, child_id):
            return f"""INSERT INTO vehicle_observations(id,vehicle_id,source_id,kind,property_id,
             source_observation_id,source_url,source_identifier,raw_source_ref,observed_at,extraction_method,
             confidence_score,agent_cost_cents,structured_data,content_hash,content_text)
             VALUES('{child_id}','{vehicle_id}','{source_id}','specification','{prop}','{parent_id}',
             {literal(d['source_url'])},{literal(d['source_identifier'])},{literal(d['raw_source_ref'])},
             {literal(d['observed_at'])},{literal(d['extraction_method'])},.6,0,
             {literal(json.dumps(payload))}::jsonb,'{hashlib.sha256(child_id.encode()).hexdigest()}',{literal(d['content_text'])})"""
        if key=='model':
            forged={**d['structured_data'],'model':'C10'}
            rejects(insert(forged,'fa000003-0000-4000-8000-000000000001'))
        try:
            sql(insert(d['structured_data'],child))
        except subprocess.CalledProcessError as error:
            print(error.stderr, flush=True)
            raise
        assert sql(f"SELECT retained_listing_property_result_matches('{parent_id}','{prop}','{child}')")=='t'
        assert sql(f"SELECT finish_retained_listing_property('{parent_id}','{prop}','mecum-identity-fixture','done','{child}')")=='t'
    model=read(f"SELECT jsonb_agg(x) FROM get_vehicle_specs(ARRAY['{vehicle_id}'::uuid],true)x")[0]
    assert {c['property_key']:c['value'] for c in model['typed_claims']} == {k:source['structured_data'][k] for k in properties}
    assert all(c['source_observation_id']==parent_id and c['qualifiers']['identity_resolution_status']=='unverified' for c in model['typed_claims'])
    public=sql(f"SET ROLE anon;SELECT jsonb_array_length((SELECT x->'typed_claims' FROM get_vehicle_specs(ARRAY['{vehicle_id}'::uuid],true)x));RESET ROLE")
    assert '3' in public.splitlines()
    assert read(f"SELECT get_field_provenance('{vehicle_id}','model')")['observations']
    sql(f"UPDATE vehicle_observations SET is_superseded=true WHERE id='{parent_id}'")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='{vehicle_id}'")=='0'
    assert read(f"SELECT get_field_provenance('{vehicle_id}','model')")['observations']==[]
    sql(f"UPDATE vehicle_observations SET is_superseded=false WHERE id='{parent_id}';UPDATE vehicles SET is_public=false WHERE id='{vehicle_id}'")
    assert sql(f"SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='{vehicle_id}'")=='0'
    assert read(f"SELECT jsonb_agg(x) FROM get_vehicle_specs(ARRAY['{vehicle_id}'::uuid],true)x") is None
    sql(f"UPDATE vehicles SET is_public=true WHERE id='{vehicle_id}'")
    rejects(migration)  # Single guarded activation; a changed/already active contract is refused.
    passed('Mecum literal identity: real TS decoder -> queue -> guarded SQL -> canonical/bulk/provenance/anonymous readers; forged value, supersession and private parent refused')
