// Synthetic, disposable installed PG17 only; no production connection or credentials.
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const ci=process.env.RETAINED_PROPERTY_TEST_CI==='1';
const exterior=process.env.RETAINED_PROPERTY_TEST_EXTERIOR==='1';
const bin=process.env.PG17_BIN || (ci ? '/usr/bin' : '/opt/homebrew/opt/postgresql@17/bin');
const run=(name,args)=>execFileSync(join(bin,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const base=mkdtempSync(join(tmpdir(),'nuke-retained-property-pg-')),data=join(base,'data'),socket=join(base,'socket');
let started=false;
const reuse=ci ? 'localhost' : process.env.RETAINED_PROPERTY_TEST_SOCKET;
const port=ci ? '5432' : reuse ? '55439' : '58731';
const database=`retained_property_${process.pid}`;
let created=false;
try {
 if(ci && process.env.PGHOST!=='localhost')throw Error('Only localhost CI fixture permitted');
 if(!ci && reuse && reuse!=='/private/tmp')throw Error('Only known local fixture socket is reusable');
 if(!reuse){mkdirSync(socket);run('initdb',['-D',data,'--auth=trust','--no-locale','-E','UTF8']);
 run('pg_ctl',['-D',data,'-l',join(base,'log'),'-o',`-k ${socket} -p ${port} -c listen_addresses=''`,'-w','start']);started=true;}
 run('createdb',['-h',reuse||socket,'-p',port,database]);created=true;
 let projectionTests=false;
 const sql=text=>run('psql',['-h',reuse||socket,'-p',port,'-d',database,'-v','ON_ERROR_STOP=1','-c',
 projectionTests && exterior ? text.replaceAll('interior_color','exterior_color')
 .replaceAll('44444444-4444-4444-8444-444444444444','efcb8c61-1ff5-4790-890e-2e09118e87e3')
 .replaceAll("structured_data->'exterior_color'","structured_data->'color'")
 .replaceAll("'source_field','exterior_color'","'source_field','color'") : text]);
 sql(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
 CREATE TYPE vfc_rank AS ENUM('preferred','normal','deprecated');
 CREATE TYPE observation_kind AS ENUM('listing','sale_result','comment','bid','condition','specification');
 CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,listing_kind text);
 CREATE TABLE observation_sources(id uuid PRIMARY KEY,slug text,supported_observations observation_kind[]);
 CREATE TABLE observation_properties(id uuid PRIMARY KEY,property_key text,namespace text,deprecated_at timestamptz,applies_to_kinds text[]);
 CREATE TABLE pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text);
 CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,kind observation_kind,is_superseded boolean DEFAULT false,
 superseded_by uuid,superseded_at timestamptz,updated_at timestamptz,is_processed boolean,processed_at timestamptz,
 property_id uuid,subject_type text DEFAULT 'vehicle',subject_id uuid,source_id uuid,source_url text,source_identifier text,
 raw_source_ref text,observed_at timestamptz,ingested_at timestamptz DEFAULT now(),extraction_method text,
 confidence_score numeric,structured_data jsonb,content_hash text UNIQUE,content_text text,
 agent_model text,confidence text,extraction_metadata jsonb,rank vfc_rank DEFAULT 'normal',changeset_id uuid);
 ALTER TABLE vehicles ADD COLUMN user_id uuid, ADD COLUMN owner_id uuid, ADD COLUMN uploaded_by uuid;
 ALTER TABLE observation_sources ADD COLUMN base_trust_score numeric;
 ALTER TABLE observation_properties ADD COLUMN discriminator_key text;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
 CREATE FUNCTION observation_is_public(observation_kind,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE TABLE vehicle_field_provenance(vehicle_id uuid,field_name text,primary_source text,total_confidence numeric);
 CREATE TABLE vehicle_images(id uuid,vehicle_id uuid,image_url text,is_sensitive boolean,is_superseded boolean,is_duplicate boolean,vision_gate_status text,image_vehicle_match_status text);
 CREATE TABLE observation_witnesses(id uuid,observation_id uuid,image_id uuid,witness_role text);
 CREATE TABLE vehicle_field_sources(vehicle_id uuid,field_name text,field_value text,source_type text,confidence_score numeric,is_verified boolean,ai_reasoning text,source_image_id uuid,created_at timestamptz);
 CREATE TABLE field_evidence(vehicle_id uuid,field_name text,proposed_value text,source_type text,source_confidence numeric,status text,extraction_context text,raw_extraction_data jsonb,created_at timestamptz);
 INSERT INTO vehicles VALUES('22222222-2222-4222-8222-222222222222',true,null,'vehicle');
 INSERT INTO observation_sources(id,slug,supported_observations) VALUES('4cdc735c-f117-42f2-889f-ba33805639a5','bat',ARRAY['listing','sale_result','comment','bid','condition']::observation_kind[]);
 INSERT INTO observation_properties(id,property_key,namespace,deprecated_at,applies_to_kinds) VALUES('44444444-4444-4444-8444-444444444444','interior_color','core',null,ARRAY['specification']);
 INSERT INTO observation_properties(id,property_key,namespace,deprecated_at,applies_to_kinds) VALUES('efcb8c61-1ff5-4790-890e-2e09118e87e3','exterior_color','core',null,ARRAY['specification']);
 INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,observed_at,ingested_at,extraction_method,confidence_score,structured_data)
 VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','listing',
 '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/test',null,'2026-10-05T00:20:05.123456Z','html_match',0.7,
 '{"interior_color":"Black Vinyl","color":"Signal Red","transmission":"Four-Speed Manual"}');`);
 const priorReader=readFileSync('supabase/migrations/20261005013641_bounded_field_provenance_inputs.sql','utf8');
 sql(priorReader.slice(priorReader.indexOf('CREATE OR REPLACE FUNCTION public.get_field_provenance'),priorReader.indexOf('$function$;')+12));
 const priorView=readFileSync('scripts/discovery/fixtures/vehicle_canonical_20260517.sql','utf8');
 sql(priorView.slice(priorView.indexOf('CREATE OR REPLACE VIEW public.vehicle_canonical'),priorView.indexOf('COMMENT ON VIEW')));
 sql(readFileSync('supabase/migrations/20261005083255_retained_listing_interior_property.sql','utf8'));
 sql(readFileSync('supabase/migrations/20261005134051_retained_listing_exterior_property.sql','utf8'));
 if(process.env.RETAINED_PROPERTY_TEST_POWERTRAIN==='1') {
  // The fixture permits localhost/socket only and is dropped in finally.
  sql(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  INSERT INTO observation_properties(id,property_key,namespace,applies_to_kinds) VALUES
  ('c0f743ae-dc94-4dfd-98ef-514b76f74a9b','engine_configuration','core',ARRAY['specification']),
  ('66b2f1f6-b714-4ac0-85b6-60ba89529c1a','engine_displacement_l','core',ARRAY['specification']),
  ('235aed17-9bd3-4886-90be-9b1a8e2d1844','transmission_type','core',ARRAY['specification']),
  ('32b51f19-e5cf-4f67-81d9-96c2d30885a1','drivetrain_layout','core',ARRAY['specification']);
  UPDATE vehicle_observations SET structured_data=structured_data||'{"engine_size":"302ci V8","drivetrain":"4WD"}'::jsonb;`);
  const garageOwner=readFileSync('supabase/migrations/20261008050000_garage_owner_corrections.sql','utf8');
  sql(garageOwner.slice(garageOwner.indexOf('CREATE OR REPLACE VIEW public.vehicle_canonical'),garageOwner.indexOf('CREATE OR REPLACE FUNCTION public.notify_subscribers_on_observation')));
  sql(readFileSync('supabase/migrations/20261010150757_retained_listing_powertrain_properties.sql','utf8'));
  const cases=readFileSync('supabase/functions/ingest-observation/retainedPowertrain.test.ts','utf8')
    .split('const cases:')[1].split('];')[0].matchAll(/\["([^"]+)","([^"]+)",(null|"[^"]+"|[\d.]+)\]/g);
  let normalizationCases=0;
  for(const [,key,raw,expected] of cases) {
   normalizationCases++;
   const want=JSON.parse(expected);
   const actual=sql(`SELECT coalesce(retained_powertrain_value('${key}','${JSON.stringify(raw).replaceAll("'","''")}'::jsonb)::text,'null')`).trim();
   const value=actual.split('\n').filter(line=>line.trim() && !/retained_powertrain|coalesce|^-|row\)/.test(line.trim())).map(line=>line.trim())[0];
   if(JSON.stringify(JSON.parse(value))!==JSON.stringify(want))throw Error(`SQL normalization mismatch ${raw}: ${actual} expected ${expected}`);
  }
  if(normalizationCases!==25)throw Error('Normalization fixture case format/count changed');
  const insert=`INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,raw_source_ref,
   observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
   SELECT gen_random_uuid(),p.vehicle_id,'specification',p.source_id,p.source_url,r.id,'retained_listing_'||r.property_key||'_v1:'||p.id,
   'vehicle_observations:'||p.id,p.ingested_at,'retained_listing_property_projection_v1',.6,
   jsonb_build_object(r.property_key,retained_powertrain_value(r.property_key,p.structured_data->f.field),
    'source_observation_id',p.id,'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
    'source_field',f.field,'property_key',r.property_key,'projection_version','retained_listing_'||r.property_key||'_v1',
    'analysis_kind','retained_listing_property_projection','source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,
    'source_confidence_score',p.confidence_score,'source_extraction_method',p.extraction_method,
    'source_value',p.structured_data->f.field,'normalization_version','retained_powertrain_v1',
    'factory_configuration_status','unknown','current_configuration_status','unknown','independent_source',false),
   p.id,r.property_key,'Retained extractor powertrain claim. No factory/current verification.'
   FROM vehicle_observations p CROSS JOIN observation_properties r
   CROSS JOIN LATERAL (SELECT CASE r.property_key WHEN 'transmission_type' THEN 'transmission' WHEN 'drivetrain_layout' THEN 'drivetrain' ELSE 'engine_size' END field) f
   WHERE p.id='11111111-1111-4111-8111-111111111111' AND r.property_key IN('engine_configuration','engine_displacement_l','transmission_type','drivetrain_layout')`;
  sql(insert);
  sql(`DO $$ BEGIN
   IF (SELECT count(*) FROM vehicle_canonical)<>4 THEN RAISE EXCEPTION 'missing canonical powertrain properties'; END IF;
   IF (SELECT count(*) FROM vehicle_observations WHERE source_observation_id IS NOT NULL)<>4 THEN RAISE EXCEPTION 'missing children'; END IF;
   IF (SELECT structured_data->>'engine_size' FROM vehicle_observations WHERE source_observation_id IS NULL)<>'302ci V8' THEN RAISE EXCEPTION 'parent changed'; END IF;
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(get_field_provenance('22222222-2222-4222-8222-222222222222','engine_displacement_l')->'observations') x
    WHERE x->>'source_observation_id'='11111111-1111-4111-8111-111111111111'
      AND x->>'observed_at_basis'='source_testimony_recorded_at'
      AND x->>'value'='4.948893' AND x->>'source_value'='302ci V8'
      AND x->>'source_field'='engine_size' AND x->>'normalization_version'='retained_powertrain_v1'
      AND x->>'factory_configuration_status'='unknown' AND x->'independent_source'='false'::jsonb) THEN RAISE EXCEPTION 'reader lost attribution or normalized/source value'; END IF;
  END $$`);
  sql('DELETE FROM vehicle_observations WHERE source_observation_id IS NOT NULL');
  for(const bad of [insert.replace("'source_value',p.structured_data->f.field","'source_value','\"invented\"'::jsonb"),
   insert.replace("'normalization_version','retained_powertrain_v1'","'normalization_version','forged'"),
   insert.replace("'factory_configuration_status','unknown'","'factory_configuration_status','verified'"),
   insert.replace('retained_powertrain_value(r.property_key,p.structured_data->f.field)',"'\"invented\"'::jsonb")]) {
    try{sql(bad);throw Error('forged powertrain accepted');}catch(e){if(!String(e.stderr).includes('ERROR:'))throw e;}
  }
  sql(insert);
  sql(`UPDATE vehicle_observations SET structured_data=structured_data||'{"engine_size":"302ci Small-Block V8"}'::jsonb WHERE source_observation_id IS NULL;
   DO $$ BEGIN
    IF (SELECT count(*) FROM vehicle_canonical)<>2 THEN RAISE EXCEPTION 'changed raw source still readable'; END IF;
    IF EXISTS(SELECT FROM jsonb_array_elements(get_field_provenance('22222222-2222-4222-8222-222222222222','engine_displacement_l')->'observations') x
     WHERE x->>'source_observation_id'='11111111-1111-4111-8111-111111111111') THEN RAISE EXCEPTION 'changed source visible in provenance'; END IF;
   END $$;
   UPDATE vehicle_observations SET structured_data=structured_data||'{"engine_size":"302ci V8"}'::jsonb WHERE source_observation_id IS NULL;`);
  sql(`UPDATE vehicles SET is_public=false;
   DO $$ BEGIN IF EXISTS(SELECT FROM vehicle_canonical) THEN RAISE EXCEPTION 'private parent readable'; END IF; END $$;
   UPDATE vehicles SET is_public=true;
   UPDATE vehicle_observations SET is_superseded=true WHERE source_observation_id IS NULL;
   DO $$ BEGIN IF EXISTS(SELECT FROM vehicle_canonical) THEN RAISE EXCEPTION 'superseded parent readable'; END IF; END $$;`);
  console.log('PASS four powertrain properties: SQL/edge normalization parity, source custody, actual readers, forgery/private/superseded refusals');
 } else {
 projectionTests=true;
 sql(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM observation_sources WHERE id='4cdc735c-f117-42f2-889f-ba33805639a5'
 AND supported_observations=ARRAY['listing','sale_result','comment','bid','condition','specification']::observation_kind[])
 THEN RAISE EXCEPTION 'source kind eligibility missing or existing kinds lost'; END IF; END $$`);
 console.log('PASS exact source specification eligibility; original kinds retained');
 const valid=`INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,raw_source_ref,
 observed_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash,content_text)
 SELECT '55555555-5555-4555-8555-555555555555',vehicle_id,'specification',source_id,source_url,
 '44444444-4444-4444-8444-444444444444','retained_listing_interior_color_v1:'||id::text,'vehicle_observations:'||id::text,
 ingested_at,'retained_listing_property_projection_v1',0.6,
 jsonb_build_object('interior_color',structured_data->'interior_color','source_observation_id',id,
 'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at','source_field','interior_color','property_key','interior_color',
 'projection_version','retained_listing_interior_color_v1','analysis_kind','retained_listing_property_projection',
 'source_recorded_at',ingested_at,'source_observed_at',observed_at,'source_confidence_score',confidence_score,
 'source_extraction_method',extraction_method),id,'stable-source-content','Retained listing claim. No independent corroboration or factory/current verification.'
 FROM vehicle_observations WHERE id='11111111-1111-4111-8111-111111111111'`;
 function rejects(command,label){try{sql(command);}catch(e){if(!String(e.stderr).includes('ERROR:'))throw e;console.log(`PASS ${label}`);return;}throw Error(`unexpected acceptance: ${label}`);}
 sql(valid);console.log('PASS exact source tuple and unknown event clock');
 sql(`DO $$ DECLARE r jsonb; BEGIN
 SELECT x INTO r FROM jsonb_array_elements(get_field_provenance('22222222-2222-4222-8222-222222222222','interior_color')->'observations') x
 WHERE x->>'id'='55555555-5555-4555-8555-555555555555';
 IF r IS NULL OR r->>'source_observation_id'<>'11111111-1111-4111-8111-111111111111'
 OR (r->>'source_recorded_at')::timestamptz<>'2026-10-05T00:20:05.123456Z'::timestamptz
 OR (r->>'observed_at')::timestamptz<>'2026-10-05T00:20:05.123456Z'::timestamptz
 OR r->'source_observed_at'<>'null'::jsonb OR r->>'observed_at_basis'<>'source_testimony_recorded_at'
 OR r->>'source_slug'<>'bat' OR r->>'content' NOT LIKE 'Retained listing claim.%'
 THEN RAISE EXCEPTION 'reader lost parent attribution/clock/claim role'; END IF;
 IF (SELECT count(*) FROM vehicle_canonical)<>1 THEN RAISE EXCEPTION 'canonical parent/child double counted'; END IF;
 IF (SELECT structured_data->>'transmission' FROM vehicle_observations WHERE id='11111111-1111-4111-8111-111111111111')<>'Four-Speed Manual'
 THEN RAISE EXCEPTION 'original envelope altered'; END IF;
 END $$`);console.log('PASS actual public consumer clocks/role/source; one canonical property; original retained');
 const childAbsent=`DO $$ BEGIN
 IF EXISTS(SELECT FROM vehicle_canonical) OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(get_field_provenance('22222222-2222-4222-8222-222222222222','interior_color')->'observations','[]'::jsonb)) x WHERE x->>'id'='55555555-5555-4555-8555-555555555555')
 THEN RAISE EXCEPTION 'ineligible child still readable'; END IF;END $$`;
 sql(`UPDATE vehicle_observations SET is_superseded=true WHERE id='11111111-1111-4111-8111-111111111111'`);sql(childAbsent);
 sql(`UPDATE vehicle_observations SET is_superseded=false WHERE id='11111111-1111-4111-8111-111111111111'`);
 console.log('PASS both consumers exclude superseded parent');
 sql(`UPDATE vehicles SET is_public=false`);sql(childAbsent);sql(`UPDATE vehicles SET is_public=true`);
 console.log('PASS both consumers exclude private parent');
 sql(`UPDATE vehicle_observations SET vehicle_id='99999999-9999-4999-8999-999999999999' WHERE id='11111111-1111-4111-8111-111111111111'`);sql(childAbsent);
 sql(`UPDATE vehicle_observations SET vehicle_id='22222222-2222-4222-8222-222222222222' WHERE id='11111111-1111-4111-8111-111111111111'`);
 console.log('PASS both consumers exclude moved parent');
 rejects(valid,'duplicate');
 rejects(`UPDATE vehicle_observations SET structured_data='{"interior_color":"Fake"}' WHERE source_observation_id IS NOT NULL`,'immutable value');
 rejects(`UPDATE vehicle_observations SET source_observation_id=NULL WHERE source_observation_id IS NOT NULL`,'immutable FK');
 sql(`UPDATE vehicle_observations SET is_superseded=true,superseded_at=now() WHERE source_observation_id IS NOT NULL`);
 console.log('PASS supersession metadata');
 sql(`DELETE FROM vehicle_observations WHERE source_observation_id IS NOT NULL`);
 for(const [name,a,b] of [
 ['value',"'interior_color',structured_data->'interior_color'","'interior_color','invented'"],
 ['vehicle',"vehicle_id,'specification'","'99999999-9999-4999-8999-999999999999','specification'"],
 ['property',"'44444444-4444-4444-8444-444444444444','retained_listing_","'99999999-9999-4999-8999-999999999999','retained_listing_"],
 ['clock',"ingested_at,'retained_listing_property_projection_v1'","ingested_at+interval '0.000001 seconds','retained_listing_property_projection_v1'"],
 ['confidence',"projection_v1',0.6","projection_v1',0.9"],
 ['verified role',"'claim_role','listing_claim'","'claim_role','verified'"],
 ['source field',"'source_field','interior_color'","'source_field','engine_size'"],
 ['projection mode',"'projection_version','retained_listing_interior_color_v1'","'projection_version','forged'"],
 ['recording clock',"'source_recorded_at',ingested_at","'source_recorded_at',ingested_at+interval '0.000001 seconds'"],
 ['missing typed link',"),id,'stable-source-content'","),null::uuid,'stable-source-content'"]])rejects(valid.replace(a,b),name);
 sql(`UPDATE vehicles SET is_public=false`);rejects(valid,'private parent');sql(`UPDATE vehicles SET is_public=true`);
 sql(`UPDATE vehicle_observations SET is_superseded=true`);rejects(valid,'superseded source');
 console.log('All retained listing SQL cases passed');
 }
}finally{if(created)run('dropdb',['-h',reuse||socket,'-p',port,database]);if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);rmSync(base,{recursive:true,force:true});}
