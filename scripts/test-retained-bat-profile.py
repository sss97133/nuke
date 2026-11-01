#!/usr/bin/env python3
"""Profile wiring over read-only source views; custody itself is tested separately.

Run after supabase/sql/test_native_listing_profile_evidence.sql in its disposable DB.
"""
import json
import os
from pathlib import Path
import re
import subprocess
root=Path(__file__).resolve().parents[1]
database=os.environ.get('PGDATABASE','dm_refinement_native_listing_ci')
host=os.environ.get('PGHOST','localhost')
assert database.startswith('dm_refinement_') and host in ('localhost','/private/tmp/truck-source-pg')
sql=[]
def add(s): sql.append(s)
def config(key,value):
    encoded=json.dumps(value).replace("'","''")
    add(f"DO $c$ BEGIN PERFORM set_config('test.{key}','{encoded}',false); END $c$;")
def check(expr,label): add(f"DO $$ BEGIN ASSERT ({expr}), '{label}'; END $$;")
baseline=(root/'supabase/sql/test_native_listing_profile_evidence.sql').read_text()
view=next(line for line in baseline.splitlines() if line.startswith('CREATE VIEW public.vehicle_observations'))
add(view.replace('CREATE VIEW','CREATE OR REPLACE VIEW').replace('extraction_metadata jsonb)','extraction_metadata jsonb,source_observation_id uuid,property_id uuid,source_id uuid)'))
# This seam proves the reader calls the canonical predicate and responds to its
# withdrawal. The separate BaT sale fixture executes the actual predicate.
add("CREATE OR REPLACE FUNCTION retained_listing_property_result_matches(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.custody',true),'true')='true'$$;")
migration=(root/'supabase/migrations/20261101003500_retained_bat_sale_properties.sql').read_text()
patch=re.search(r'DO \$profile\$.*?\$profile\$;',migration,re.S).group()
add(patch);add(patch)
vehicle='10000000-0000-0000-0000-000000000001'
parent='20000000-0000-0000-0000-000000000001'
config('vehicles',[dict(id=vehicle,is_public=True,year=1973,make='Chevrolet',model='C10 Pickup',engine_size='350ci V8',transmission='3-Speed Automatic',created_at='2026-09-28')])
config('field_evidence',[])
rows=[dict(id=parent,vehicle_id=vehicle,source_id='4cdc735c-f117-42f2-889f-ba33805639a5',kind='sale_result',extraction_method='html_match',structured_data={'engine_size':'350ci V8'}),dict(id='30000000-0000-0000-0000-000000000001',vehicle_id=vehicle,source_observation_id=parent,property_id='c0f743ae-dc94-4dfd-98ef-514b76f74a9b',kind='specification',extraction_method='retained_listing_property_projection_v1',source_url='https://bringatrailer.com/listing/1973-chevrolet-c10-pickup-33',observed_at='2026-09-28T04:26:14.043085Z',ingested_at='2026-10-31T12:00:00Z',confidence_score=.6,structured_data={'property_key':'engine_configuration','source_value':'350ci V8'})]
config('vehicle_observations',rows)
claim=f"vehicle_profile_read('{vehicle}'::uuid)#>'{{sections,1,facets,0,member}}'"
check(f"({claim})#>>'{{source,id}}'='{parent}'",'profile source drill links original parent')
check(f"({claim})#>>'{{qualification,role}}'='extractor_listing_claim'",'extractor attribution preserved')
check(f"({claim})#>>'{{qualification,current_configuration_status}}'='unknown'",'current configuration remains unknown')
check(f"({claim})->>'observed_at'='2026-09-28T04:26:14.043085+00:00'",'original recording clock preserved')
add("SELECT set_config('test.custody','false',false);")
check(f"({claim})#>>'{{source,kind}}'='legacy'",'withdrawn custody cannot supply profile source')
add("SELECT set_config('test.custody','true',false);")
rows[1]['structured_data']['source_value']='Different Engine'
config('vehicle_observations',rows)
check(f"({claim})#>>'{{source,kind}}'='legacy'",'different source wording cannot qualify displayed facet')
rows[1]['structured_data']['source_value']='350ci V8'
config('vehicle_observations',rows)
config('field_evidence',[dict(vehicle_id=vehicle,field_name='engine_size',source_type='factory_service_manual',source_confidence=95,extracted_at='2026-10-29',status='accepted',proposed_value='350ci V8')])
check(f"({claim})#>>'{{source,method}}'='factory_service_manual'",'accepted evidence retains priority')
add("SELECT 'PASS retained BaT source-to-profile attribution, withdrawal, exact-match and priority';")
subprocess.run([os.environ.get('NUKE_TEST_PSQL','psql'),'-X','-h',host,'-p',os.environ.get('PGPORT','5432' if host=='localhost' else '55449'),'-d',database,'-q','-v','ON_ERROR_STOP=1'],input='\n'.join(sql),text=True,check=True)
