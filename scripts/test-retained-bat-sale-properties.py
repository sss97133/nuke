#!/usr/bin/env python3
"""Disposable PG17: real custody readers/queue over read-only JSON source views.

No testimony rows are inserted. Only the operational queue receives fixture work.
The arrival-trigger DDL is tested separately on an empty relation after reader checks.
"""
import json
import os
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
database = os.environ.get('PGDATABASE', 'dm_refinement_bat_sale')
host = os.environ.get('PGHOST', '/private/tmp/truck-source-pg')
assert database.startswith('dm_refinement_') and host in ('localhost', '/private/tmp/truck-source-pg')
statements = ["\\set ON_ERROR_STOP on", "CREATE TYPE observation_kind AS ENUM ('listing','sale_result','specification','condition','activity','comment','bid','media','splice');"]
def add(sql):
    statements.append(sql)
def literal(value):
    return "'" + value.replace("'", "''") + "'"
def config(key, value):
    add(f"DO $config$ BEGIN PERFORM set_config('test.{key}',{literal(json.dumps(value))},false); END $config$;")
def check(expression, label):
    add(f"DO $$ BEGIN ASSERT ({expression}), {literal(label)}; END $$;")
def view(name, columns):
    add(f"CREATE VIEW {name} AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.{name}',true),''),'[]')::jsonb) AS r({columns});")

view('vehicle_observations', 'id uuid,vehicle_id uuid,kind observation_kind,source_id uuid,source_url text,source_identifier text,source_observation_id uuid,property_id uuid,subject_type text,subject_id uuid,is_superseded boolean,observed_at timestamptz,ingested_at timestamptz,extraction_method text,structured_data jsonb,confidence_score numeric,raw_source_ref text,agent_model text,agent_cost_cents numeric,content_hash text,content_text text,source_snapshot_id uuid,auction_event_id uuid,source_comment_id uuid,source_vehicle_event_id uuid')
view('vehicles', 'id uuid,is_public boolean,deleted_at timestamptz,listing_kind text')
view('observation_sources', 'id uuid,slug text,supported_observations observation_kind[]')
view('observation_properties', 'id uuid,property_key text,namespace text,deprecated_at timestamptz,ratified_at timestamptz,unit text,data_type text,label text,applies_to_kinds observation_kind[]')
add('CREATE TABLE retained_listing_property_work(source_observation_id uuid,property_id uuid,vehicle_id uuid,PRIMARY KEY(source_observation_id,property_id));')
# Unrelated source adapters are deliberately absent from this narrow fixture.
add('CREATE FUNCTION retained_native_listing_source(vehicle_observations) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;')
for name in ['retained_description_property_matches','retained_craigslist_odometer_matches','retained_craigslist_year_matches','retained_description_year_matches','retained_description_identity_matches']:
    add(f'CREATE FUNCTION {name}(vehicle_observations,vehicle_observations) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;')
for name, args in [('retained_description_property_witness','vehicle_observations,text'),('retained_craigslist_odometer_witness','vehicle_observations'),('retained_craigslist_year_witness','vehicle_observations')]:
    add(f'CREATE FUNCTION {name}({args}) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;')
privacy = (root/'supabase/migrations/20261004175418_observation_private_fields_guard.sql').read_text()
add(privacy[privacy.index('CREATE OR REPLACE FUNCTION'):privacy.index('COMMENT ON FUNCTION')])
add((root/'scripts/discovery/fixtures/retained_bat_sale_baseline_20261031.sql').read_text())
migration = (root/'supabase/migrations/20261101003500_retained_bat_sale_properties.sql').read_text()
eligibility = re.search(r'DO \$eligibility\$.*?\$eligibility\$;', migration, re.S).group()
add(eligibility)
add(eligibility)

parent = dict(id='10000000-0000-4000-8000-000000000001',vehicle_id='20000000-0000-4000-8000-000000000001',kind='sale_result',source_id='4cdc735c-f117-42f2-889f-ba33805639a5',source_url='https://bringatrailer.com/listing/retained-fixture/',subject_type='vehicle',is_superseded=False,observed_at=None,ingested_at='2026-09-28T12:30:00Z',extraction_method='html_match',confidence_score=1,structured_data={'year':1995,'color':'Red'})
vehicle = dict(id=parent['vehicle_id'],is_public=True,listing_kind='vehicle')
registry = dict(id=parent['source_id'],slug='bat',supported_observations=['listing','sale_result','specification'])
properties = [dict(id='ece619f7-c49a-44f7-999f-a41acf5d4dc3',property_key='year',namespace='core',ratified_at='2026-05-17',label='Model Year',data_type='integer',applies_to_kinds=['specification']),dict(id='efcb8c61-1ff5-4790-890e-2e09118e87e3',property_key='exterior_color',namespace='core',ratified_at='2026-05-17',label='Exterior Color',data_type='string',applies_to_kinds=['specification'])]
def projection(key):
    value = parent['structured_data']['color' if key=='exterior_color' else key]
    return dict(id='30000000-0000-4000-8000-000000000001',vehicle_id=parent['vehicle_id'],kind='specification',source_id=parent['source_id'],source_url=parent['source_url'],source_identifier=f'retained_listing_{key}_v1:'+parent['id'],source_observation_id=parent['id'],property_id=properties[key=='exterior_color']['id'],subject_type='vehicle',is_superseded=False,observed_at=parent['ingested_at'],ingested_at='2026-10-31T12:00:00Z',extraction_method='retained_listing_property_projection_v1',confidence_score=.6,raw_source_ref='vehicle_observations:'+parent['id'],agent_cost_cents=0,content_hash='fixture',structured_data={key:value,'source_value':value,'normalization_version':'retained_listing_identity_labels_v1','source_observation_id':parent['id'],'property_key':key,'source_field':'color' if key=='exterior_color' else key,'analysis_kind':'retained_listing_property_projection','projection_version':f'retained_listing_{key}_v1','claim_role':'listing_claim','observed_at_basis':'source_testimony_recorded_at','identity_role':'extractor_vehicle_label','identity_resolution_status':'unverified','source_event_time_status':'unknown','factory_configuration_status':'unknown','current_configuration_status':'unknown','independent_source':False,'source_recorded_at':parent['ingested_at'],'source_observed_at':None,'source_confidence_score':1,'source_extraction_method':'html_match'})
config('vehicles',[vehicle]); config('observation_sources',[registry]); config('observation_properties',properties)
for key in ['year','exterior_color']:
    child=projection(key)
    expr=f"retained_listing_property_result_matches('{parent['id']}','{child['property_id']}','{child['id']}')"
    config('vehicle_observations',[parent,child]); check(expr,f'{key} closed auction assertion accepted')
    config('vehicle_observations',[dict(parent,kind='listing'),child]); check(expr,f'{key} listing unchanged')
    for patch in [dict(is_superseded=True),dict(kind='bid'),dict(extraction_method='backfill-sale-results'),dict(source_url=parent['source_url']+'?query=1'),dict(source_id='40000000-0000-4000-8000-000000000001'),dict(structured_data=dict(parent['structured_data'],seller_name='Private'))]:
        config('vehicle_observations',[dict(parent,**patch),child]); check('NOT '+expr,f'{key} refuses parent {patch}')
    for patch in [dict(observed_at='2026-10-31T12:00:00Z'),dict(source_url='https://bringatrailer.com/listing/other/')]:
        config('vehicle_observations',[parent,dict(child,**patch)]); check('NOT '+expr,f'{key} refuses forged tuple {patch}')
    config('vehicle_observations',[parent,child])
    for patch in [dict(is_public=False),dict(deleted_at='2026-10-01'),dict(listing_kind='non_vehicle_item')]:
        config('vehicles',[dict(vehicle,**patch)]); check('NOT '+expr,f'{key} hidden/nonvehicle refused')
    config('vehicles',[vehicle])
    config('vehicle_observations',[dict(parent,is_superseded=True),child]); check('NOT '+expr,f'{key} withdrawal invalidates result')

config('vehicle_observations',[parent])
queue=f"enqueue_retained_listing_properties(ARRAY['{parent['id']}'::uuid])"
check(queue+'=2','existing queue admits exactly supported identity and color')
check(queue+'=0','queue replay idempotent')
for patch in [dict(is_superseded=True),dict(kind='bid'),dict(source_url=parent['source_url']+'?query=1'),dict(structured_data=dict(parent['structured_data'],seller_name='Private'))]:
    add('TRUNCATE retained_listing_property_work;')
    config('vehicle_observations',[dict(parent,**patch)]); check(queue+'=0','queue refusal '+str(patch))

# Trigger definition validation uses an empty table; no source rows are inserted.
add('ALTER VIEW vehicle_observations RENAME TO fixture_observations; CREATE TABLE vehicle_observations (LIKE fixture_observations);')
add('CREATE FUNCTION trg_enqueue_retained_listing_properties() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;')
prior=(root/'supabase/migrations/20261030170900_reconnect_archived_description_properties.sql').read_text()
trigger=prior.split('EXECUTE $new$',1)[1].split('$new$;',1)[0]
add(trigger+';')
arrival=re.search(r'DO \$arrival\$.*?\$arrival\$;',migration,re.S).group()
add(arrival); add(arrival)
check("(SELECT position('observation_is_public' in pg_get_triggerdef(oid))>0 FROM pg_trigger WHERE tgname='retained_listing_property_intake')",'new arrival has privacy condition')
check("(SELECT count(*)=0 FROM vehicle_observations)",'test never writes source testimony')
add("SELECT 'PASS BaT retained sale custody readers, queue refusal/idempotence and trigger reapply';")
subprocess.run([os.environ.get('NUKE_TEST_PSQL','psql'),'-X','-h',host,'-p',os.environ.get('PGPORT','5432' if host=='localhost' else '55449'),'-d',database,'-q','-v','ON_ERROR_STOP=1'],input='\n'.join(statements),text=True,check=True)
