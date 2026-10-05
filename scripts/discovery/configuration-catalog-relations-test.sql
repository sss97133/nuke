-- Synthetic storage-shaped PG17 acceptance for the actual read-only SELECT.
-- Tests relationship discovery/refusal, not execution of canonical intake or proof
-- that prospective configuration receipts exist in production. Never run in prod.
\set ON_ERROR_STOP on
SET timezone='UTC';
SET statement_timeout='10s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_config_%' OR to_regclass('public.vehicles') IS NOT NULL
   OR to_regnamespace('auth') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires an empty disposable dm_refinement_config_* PG17 database';
 END IF;
END $$;
CREATE TYPE observation_kind AS ENUM ('specification','sale_result','condition','listing','comment','bid','media','splice');
CREATE TABLE vehicles(id uuid PRIMARY KEY,is_public boolean,deleted_at timestamptz,listing_kind text);
CREATE TABLE observation_properties(id uuid PRIMARY KEY,property_key text UNIQUE,data_type text,unit text,
 namespace text,deprecated_at timestamptz,cardinality text,verification_scope text CHECK(verification_scope IN ('class','instance','both')),
 applies_to_kinds observation_kind[],parent_property_id uuid REFERENCES observation_properties(id));
CREATE TABLE vehicle_events(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,
 source_url text,source_platform text);
CREATE TABLE listing_page_snapshots(id uuid PRIMARY KEY,listing_url text,platform text,success boolean,
 http_status int,html_sha256 text,metadata jsonb,fetched_at timestamptz,created_at timestamptz);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles,
 property_id uuid REFERENCES observation_properties,kind observation_kind,subject_type text DEFAULT 'vehicle',
 source_id uuid,source_snapshot_id uuid REFERENCES listing_page_snapshots,
 source_vehicle_event_id uuid REFERENCES vehicle_events,observed_at timestamptz,ingested_at timestamptz,
 is_superseded boolean DEFAULT false,extraction_method text,extraction_metadata jsonb DEFAULT '{}',structured_data jsonb DEFAULT '{}',source_url text);
CREATE TABLE canonical_models(id uuid PRIMARY KEY,body_styles text[]);
CREATE TABLE canonical_body_styles(canonical_name text PRIMARY KEY,is_active boolean,aliases text[]);
CREATE TABLE make_model_profiles(subject_id uuid PRIMARY KEY,canonical_model_id uuid REFERENCES canonical_models,
 comparison_scope_status text CHECK(comparison_scope_status IN ('supported','context_only')),
 grain text,year_start int,year_end int,comparison_scope_basis text,
 CHECK(comparison_scope_status<>'supported' OR (grain='generation' AND year_start IS NOT NULL AND year_end IS NOT NULL
 AND year_start<=year_end AND nullif(btrim(comparison_scope_basis),'') IS NOT NULL)));
CREATE TABLE reference_libraries(id uuid PRIMARY KEY,oem_spec_id uuid);
CREATE TABLE oem_vehicle_specs(id uuid PRIMARY KEY,source_library_id uuid REFERENCES reference_libraries,
 body_style text,engine_displacement_liters numeric,engine_displacement_cid int,engine_config text);
ALTER TABLE reference_libraries ADD FOREIGN KEY(oem_spec_id) REFERENCES oem_vehicle_specs(id);
CREATE TABLE vehicle_reference_links(vehicle_id uuid REFERENCES vehicles,library_id uuid REFERENCES reference_libraries,
 link_type text,linked_at timestamptz,PRIMARY KEY(vehicle_id,library_id));
CREATE TABLE oem_models(id uuid PRIMARY KEY);
CREATE TABLE oem_trim_levels(id uuid PRIMARY KEY);
-- Reuse the actual current public-marking function, not a permissive test stub.
\i supabase/migrations/20261004175418_observation_private_fields_guard.sql
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('synthetic-config-'||k)::uuid $$;
INSERT INTO vehicles VALUES(pg_temp.id('alpha'),true,NULL,'vehicle'),(pg_temp.id('beta'),true,NULL,'vehicle'),
 (pg_temp.id('private'),false,NULL,'vehicle'),(pg_temp.id('deleted'),true,'2020-01-01Z','vehicle'),
 (pg_temp.id('nonvehicle'),true,NULL,'non_vehicle_item');
INSERT INTO observation_properties VALUES
 (pg_temp.id('architecture'),'engine_configuration','string',NULL,'core',NULL,'single','class','{specification}',NULL),
 (pg_temp.id('liters'),'engine_displacement_l','numeric','liters','core',NULL,'single','class','{specification}',pg_temp.id('architecture')),
 (pg_temp.id('code'),'engine_code','string',NULL,'core',NULL,'single','class','{specification}',NULL),
 (pg_temp.id('trim'),'trim','string',NULL,'core',NULL,'single','both','{specification}',NULL),
 (pg_temp.id('pending'),'pending_key','string',NULL,'pending',NULL,'single','both','{specification}',NULL),
 (pg_temp.id('retired'),'retired_key','string',NULL,'deprecated','2021-01-01Z','single','both','{specification}',NULL),
 (pg_temp.id('image'),'image_visible_rust_severity','enum',NULL,'core',NULL,'single','instance','{condition}',NULL);
INSERT INTO canonical_body_styles VALUES('COUPE',true,'{coupe}'),('FASTBACK',true,'{fastback}'),('CONVERTIBLE',true,'{cabriolet}'),('RETIRED',false,'{}');
INSERT INTO canonical_models VALUES(pg_temp.id('modelA'),'{coupe,fastback,cabriolet}'),
 (pg_temp.id('modelB'),'{convertible,sports car}');
INSERT INTO make_model_profiles VALUES(pg_temp.id('profileA'),pg_temp.id('modelA'),'supported','generation',2000,2005,'synthetic supported scope basis'),
 (pg_temp.id('profileB'),pg_temp.id('modelB'),'context_only','model',1990,1999,NULL);
INSERT INTO reference_libraries VALUES(pg_temp.id('libraryA'),NULL),(pg_temp.id('libraryB'),NULL);
INSERT INTO oem_vehicle_specs VALUES(pg_temp.id('specV8'),pg_temp.id('libraryA'),'COUPE',5.0,302,'V8'),
 (pg_temp.id('specI6'),pg_temp.id('libraryA'),'FASTBACK',2.8,170,'I6'),
 (pg_temp.id('specOther'),pg_temp.id('libraryB'),'CONVERTIBLE',2.0,122,'I4');
UPDATE reference_libraries SET oem_spec_id=pg_temp.id('specV8') WHERE id=pg_temp.id('libraryA');
UPDATE reference_libraries SET oem_spec_id=pg_temp.id('specOther') WHERE id=pg_temp.id('libraryB');
INSERT INTO vehicle_reference_links VALUES(pg_temp.id('alpha'),pg_temp.id('libraryA'),'oem_reference','2026-01-01Z'),
 (pg_temp.id('beta'),pg_temp.id('libraryB'),'oem_reference','2026-01-01Z');
INSERT INTO oem_models VALUES(pg_temp.id('oemModelA'));
INSERT INTO oem_trim_levels VALUES(pg_temp.id('trimA'));
INSERT INTO vehicle_events VALUES(pg_temp.id('sale1'),pg_temp.id('alpha'),'https://bringatrailer.com/listing/synthetic-episode-1/','bat'),
 (pg_temp.id('sale2'),pg_temp.id('alpha'),'https://bringatrailer.com/listing/synthetic-episode-2/','bat'),
 (pg_temp.id('wrongParent'),pg_temp.id('beta'),'https://bringatrailer.com/listing/synthetic-episode-1/','bat');
INSERT INTO listing_page_snapshots SELECT pg_temp.id('capture'||i),
 'https://bringatrailer.com/listing/synthetic-episode-'||i||'/','bat',true,200,repeat('a',64),
 jsonb_build_object('vehicle_id',pg_temp.id('alpha'),'vehicle_matched',true),'2026-01-01Z','2026-01-02Z'
 FROM generate_series(1,2) i;
CREATE FUNCTION pg_temp.obs(k text,p text,kind observation_kind,data jsonb,parent text DEFAULT 'alpha',ev text DEFAULT NULL,cap text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE oid uuid=pg_temp.id(k);
BEGIN INSERT INTO vehicle_observations VALUES(oid,pg_temp.id(parent),CASE WHEN p IS NOT NULL THEN pg_temp.id(p) END,kind,'vehicle',
 pg_temp.id('source'),CASE WHEN cap IS NOT NULL THEN pg_temp.id(cap) END,CASE WHEN ev IS NOT NULL THEN pg_temp.id(ev) END,
 '2026-03-01Z','2026-03-02Z',false,CASE WHEN ev IS NOT NULL THEN 'protected_archived_sale_observation_v1' END,'{}',data,
 CASE WHEN ev='sale2' THEN 'https://bringatrailer.com/listing/synthetic-episode-2/'
 ELSE 'https://bringatrailer.com/listing/synthetic-episode-1/' END); RETURN oid; END $$;
SELECT pg_temp.obs('classV8','architecture','specification','{"engine_configuration":"V8"}');
SELECT pg_temp.obs('classOther','liters','specification','{"engine_displacement_l":2.0}','beta');
SELECT pg_temp.obs('envelope',NULL,'sale_result','{"engine_size":"289ci V8","source_configuration_receipt":{"matching_value":null,"source_event_at":null}}','alpha','sale1','capture1');
SELECT pg_temp.obs('resale',NULL,'sale_result','{"engine_size":"I6"}','alpha','sale2','capture2');
SELECT pg_temp.obs('conflict',NULL,'sale_result','{"engine_size":"V8"}','alpha','sale1','capture1');
SELECT pg_temp.obs('trim','trim','specification','{"trim":"Synthetic Sport"}');
SELECT pg_temp.obs('body',NULL,'listing','{"body_style":"FASTBACK"}');
SELECT pg_temp.obs('pendingObs','pending','specification','{"pending_key":"one"}');
SELECT pg_temp.obs('retiredObs','retired','specification','{"retired_key":"one"}');
SELECT pg_temp.obs('badKind','liters','sale_result','{"engine_displacement_l":5.0}');
SELECT pg_temp.obs('badUnitShape','liters','specification','{"engine_displacement_l":"289ci"}');
SELECT pg_temp.obs('nullValue','liters','specification','{"engine_displacement_l":null}');
SELECT pg_temp.obs('privateObs','architecture','specification','{"engine_configuration":"V8"}','private');
SELECT pg_temp.obs('deletedObs','architecture','specification','{"engine_configuration":"V8"}','deleted');
SELECT pg_temp.obs('nonvehicleObs','architecture','specification','{"engine_configuration":"V8"}','nonvehicle');
SELECT pg_temp.obs('privateNames',NULL,'sale_result','{"engine_size":"V8","nested":{"seller_name":"SYNTHETIC PRIVATE PERSON"}}','alpha','sale1','capture1');
SELECT pg_temp.obs('superseded','architecture','specification','{"engine_configuration":"I6"}');
UPDATE vehicle_observations SET is_superseded=true WHERE id=pg_temp.id('superseded');
SELECT pg_temp.obs('unknownClock','architecture','specification','{"engine_configuration":"V8"}');
UPDATE vehicle_observations SET ingested_at=NULL WHERE id=pg_temp.id('unknownClock');
SELECT pg_temp.obs('futureClock','architecture','specification','{"engine_configuration":"V8"}');
UPDATE vehicle_observations SET ingested_at='2027-01-01Z' WHERE id=pg_temp.id('futureClock');
SELECT pg_temp.obs('wrongAncestry',NULL,'sale_result','{"engine_size":"V8"}','alpha','wrongParent','capture1');
SELECT pg_temp.obs('instanceEnum','image','condition','{"image_visible_rust_severity":"surface"}');
SELECT pg_temp.obs('unknownEnum','image','condition','{"image_visible_rust_severity":"synthetic_unknown_member"}');
SELECT pg_temp.obs('wrongEnumShape','image','condition','{"image_visible_rust_severity":4}');
SELECT pg_temp.obs('wrongProperty','code','specification','{"engine_configuration":"V8"}');
-- Load the actual artifact while preserving binds and regex bytes.
CREATE TEMP TABLE query_source(n bigint GENERATED ALWAYS AS IDENTITY,line text);
\copy query_source(line) FROM 'scripts/discovery/configuration-catalog-relations.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')
SELECT 'PREPARE config_relations(jsonb,timestamptz) AS '||string_agg(line,E'\n' ORDER BY n) FROM query_source
\gexec
CREATE FUNCTION pg_temp.assay(request jsonb,cutoff timestamptz DEFAULT '2026-06-01Z') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb; BEGIN EXECUTE format('EXECUTE config_relations(%L::jsonb,%L::timestamptz)',request,cutoff) INTO j; RETURN j; END $$;
CREATE FUNCTION pg_temp.claim(k text,property text,field text DEFAULT NULL,profile text DEFAULT NULL,specs jsonb DEFAULT '[]')
 RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('observation_id',pg_temp.id(k),'property_key',property,
 'source_field',coalesce(field,property),'profile_subject_id',CASE WHEN profile IS NOT NULL THEN pg_temp.id(profile) END,
 'oem_spec_ids',specs) $$;
CREATE FUNCTION pg_temp.assert_ok(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
CREATE TEMP TABLE result AS SELECT pg_temp.assay(jsonb_build_array(
 pg_temp.claim('classV8','engine_configuration',NULL,'profileA'),
 pg_temp.claim('classOther','engine_displacement_l',NULL,'profileB'),
 pg_temp.claim('envelope','engine_configuration','engine_size','profileA',jsonb_build_array(pg_temp.id('specV8'),pg_temp.id('specI6'))),
 pg_temp.claim('resale','engine_configuration','engine_size'),pg_temp.claim('conflict','engine_configuration','engine_size'),
 pg_temp.claim('trim','trim'),pg_temp.claim('body','body_style'),pg_temp.claim('pendingObs','pending_key'),
 pg_temp.claim('retiredObs','retired_key'),pg_temp.claim('badKind','engine_displacement_l'),
 pg_temp.claim('badUnitShape','engine_displacement_l'),pg_temp.claim('nullValue','engine_displacement_l'),
 pg_temp.claim('privateObs','engine_configuration'),pg_temp.claim('deletedObs','engine_configuration'),
 pg_temp.claim('nonvehicleObs','engine_configuration'),pg_temp.claim('privateNames','engine_configuration','engine_size'),
 pg_temp.claim('superseded','engine_configuration'),pg_temp.claim('unknownClock','engine_configuration'),
 pg_temp.claim('futureClock','engine_configuration'),pg_temp.claim('wrongAncestry','engine_configuration','engine_size'),
 pg_temp.claim('wrongProperty','engine_configuration'),pg_temp.claim('missing','new_arbitrary_property'),
 pg_temp.claim('instanceEnum','image_visible_rust_severity'),pg_temp.claim('unknownEnum','image_visible_rust_severity'),
 pg_temp.claim('wrongEnumShape','image_visible_rust_severity'))) AS j;
CREATE FUNCTION pg_temp.r(k text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM result CROSS JOIN LATERAL jsonb_array_elements(j->'claims') x
 WHERE x#>>'{originalEvidence,id}'=pg_temp.id(k)::text $$;
SELECT pg_temp.assert_ok(j#>>'{boundary,complete}'='true' AND jsonb_array_length(j->'claims')=25,'bounded manifest retains every supplied original evidence request') FROM result;
SELECT pg_temp.assert_ok(pg_temp.r('classV8')->>'descriptorStructureReady'='true' AND pg_temp.r('classOther')->>'descriptorStructureReady'='true','cross-model exact property FK and value types discover descriptor structure only');
SELECT pg_temp.assert_ok(pg_temp.r('classV8')#>>'{relations,profileComparisonScopeStatus}'='supported' AND pg_temp.r('classOther')#>>'{relations,profileComparisonScopeStatus}'='context_only','live allowed scope statuses and supported basis preserved');
SELECT pg_temp.assert_ok(pg_temp.r('instanceEnum')->>'descriptorStructureReady'='true' AND pg_temp.r('instanceEnum')#>>'{descriptor,verificationScope}'='instance' AND NOT pg_temp.r('instanceEnum')->'gaps' ? 'class_descriptor_not_instance_equipment','proper instance descriptor structure never classified as factory-class qualification');
SELECT pg_temp.assert_ok(pg_temp.r('instanceEnum')#>>'{claim,valueSemanticValidation}'='unmeasured_canonical_owner_required' AND pg_temp.r('instanceEnum')#>>'{claim,enumMembershipValidated}'='false' AND pg_temp.r('instanceEnum')->>'pricingConfigurationQualified'='false','supported-looking enum string is shape-only and never owner-admitted or pricing qualified');
SELECT pg_temp.assert_ok(pg_temp.r('unknownEnum')#>>'{claim,valueShapeValid}'='true' AND pg_temp.r('unknownEnum')#>>'{claim,enumMembershipValidated}'='false','unsupported enum membership stays explicitly unmeasured despite valid string shape');
SELECT pg_temp.assert_ok(pg_temp.r('wrongEnumShape')->'gaps' ? 'unknown_or_unsupported_value_shape' AND pg_temp.r('wrongEnumShape')->>'descriptorStructureReady'='false','numeric enum payload fails declared string shape');
SELECT pg_temp.assert_ok(pg_temp.r('classOther')#>>'{descriptor,unit}'='liters' AND pg_temp.r('classOther')#>>'{relations,descriptorParentId}'=pg_temp.id('architecture')::text,'existing unit and descriptor self-parent edge retained');
SELECT pg_temp.assert_ok(pg_temp.r('classV8')#>>'{relations,canonicalModelId}'=pg_temp.id('modelA')::text AND pg_temp.r('classOther')#>>'{relations,canonicalModelId}'=pg_temp.id('modelB')::text,'different model/profile typed FK paths without model-specific rules');
SELECT pg_temp.assert_ok(jsonb_array_length(pg_temp.r('classV8')#>'{factoryContext,possibleModelBodies}')=3 AND jsonb_array_length(pg_temp.r('classOther')#>'{factoryContext,possibleModelBodies}')=1,'coupe fastback convertible remain distinct model catalog options');
SELECT pg_temp.assert_ok(pg_temp.r('classV8')#>>'{factoryContext,possibleModelBodies,0,resolutionBasis}'='alias_candidate' AND jsonb_array_length(pg_temp.r('classOther')#>'{factoryContext,unresolvedOrBroadModelBodies}')=1,'case/alias body candidates resolve while broad sports category remains unresolved');
SELECT pg_temp.assert_ok(pg_temp.r('classV8')#>>'{factoryContext,vehicleLibrarySpecEdges,0,oemSpecId}'=pg_temp.id('specV8')::text,'typed vehicle library OEM specification path retained as factory reference');
SELECT pg_temp.assert_ok(jsonb_array_length(pg_temp.r('envelope')#>'{factoryContext,suppliedSpecs}')=2 AND pg_temp.r('envelope')->'gaps' ? 'multiple_factory_options_not_instance_resolution','multiple V8/I6 OEM options retained without choosing first');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')#>>'{episode,typedHeaderAgreement}'='true' AND pg_temp.r('envelope')#>>'{episode,rawReverified}'='false','exact event capture parent headers agree without claiming raw verification');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')->>'sourceFieldRoute'='existing_current_listed_engine_claim_fold_reader_not_sale_configuration' AND pg_temp.r('envelope')->'gaps' ? 'existing_vocabulary_not_admitted_by_current_owner','listed-engine current field route survives absent descriptor admission');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')->'gaps' ? 'unsupported_observation_kind' AND pg_temp.r('envelope')->'gaps' ? 'class_descriptor_not_instance_equipment','sale envelope cannot impersonate specification/class installation proof');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')#>>'{claim,distinctRawClaimValues}'='2' AND pg_temp.r('resale')#>>'{claim,distinctRawClaimValues}'='1','raw disagreement is episode-scoped and earlier resale never collapsed by vehicle');
SELECT pg_temp.assert_ok(pg_temp.r('resale')#>>'{relations,sourceVehicleEventId}'<>pg_temp.r('envelope')#>>'{relations,sourceVehicleEventId}','two sale episode typed identities preserved');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')#>'{claim,normalizedValue}'='null'::jsonb AND pg_temp.r('envelope')#>>'{episode,saleStateApplicability}'='unestablished','generic V8 never inferred as 289 and no capture clock becomes engine-at-sale time');
SELECT pg_temp.assert_ok(pg_temp.r('trim')->>'descriptorStructureReady'='true' AND pg_temp.r('trim')#>>'{descriptor,verificationScope}'='both','existing both-scope trim vocabulary discovered without installed claim');
SELECT pg_temp.assert_ok(pg_temp.r('body')->'gaps' ? 'missing_property_vocabulary' AND pg_temp.r('body')#>'{descriptor,active}'='false'::jsonb,'body catalog existence does not invent an observation property descriptor');
SELECT pg_temp.assert_ok(pg_temp.r('pendingObs')->'gaps' ? 'unratified_or_deprecated_descriptor' AND pg_temp.r('retiredObs')->'gaps' ? 'unratified_or_deprecated_descriptor','pending and deprecated descriptors withheld');
SELECT pg_temp.assert_ok(pg_temp.r('badUnitShape')->'gaps' ? 'unknown_or_unsupported_value_shape' AND pg_temp.r('nullValue')->'gaps' ? 'unknown_or_unsupported_value_shape','string cubic-inch and null values are not normalized numeric liters');
SELECT pg_temp.assert_ok(pg_temp.r('wrongProperty')->'gaps' ? 'missing_or_different_property_fk','different actual descriptor ID never replaced by requested registry key');
SELECT pg_temp.assert_ok(pg_temp.r('privateObs')->'gaps' ? 'ineligible_testimony' AND pg_temp.r('deletedObs')->'gaps' ? 'ineligible_testimony' AND pg_temp.r('nonvehicleObs')->'gaps' ? 'ineligible_testimony','private deleted and nonvehicle parent gates retained');
SELECT pg_temp.assert_ok(pg_temp.r('privateNames')->'gaps' ? 'ineligible_testimony' AND pg_temp.r('privateNames')#>'{claim,rawValueSha256}'='null'::jsonb,'nested private name marking withholds claim fingerprint and projection');
SELECT pg_temp.assert_ok(pg_temp.r('superseded')->'gaps' ? 'ineligible_testimony','superseded original remains discoverable but is not eligible evidence');
SELECT pg_temp.assert_ok(pg_temp.r('unknownClock')->'gaps' ? 'unknown_or_later_recording_clock' AND pg_temp.r('futureClock')->'gaps' ? 'unknown_or_later_recording_clock','unknown/future DB recording clock cannot be substituted by observed_at');
SELECT pg_temp.assert_ok(pg_temp.r('wrongAncestry')#>>'{episode,typedHeaderAgreement}'='false','wrong event parent cannot gain source custody from matching URL');
SELECT pg_temp.assert_ok(pg_temp.r('missing')->'gaps' ? 'missing_original_observation' AND pg_temp.r('missing')->'gaps' ? 'missing_property_vocabulary','missing evidence distinguished from absent vocabulary');
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM result CROSS JOIN LATERAL jsonb_array_elements(j->'claims') c WHERE c->>'pricingConfigurationQualified'<>'false' OR c->'publicConfigurationValue'<>'null'::jsonb),'no diagnostic or factory option silently admitted as pricing/build truth');
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT FROM result WHERE j::text LIKE '%SYNTHETIC PRIVATE PERSON%' OR j::text LIKE '%289ci V8%' OR j::text LIKE '%https://%'),'raw prose names source URLs and equipment strings never leak into receipt');
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(pg_temp.r('classV8')->'repairProposals') p WHERE p->>'gapKind'='existing_vocabulary_not_admitted_by_current_owner' AND p->>'existingOwner'='ingest-observation' AND p->>'originalEvidenceId'=pg_temp.id('classV8')::text AND length(p->>'acceptanceCondition')>30),'actionable existing-owner repair carries original evidence and acceptance condition');
SELECT pg_temp.assert_ok(EXISTS(SELECT FROM jsonb_array_elements(pg_temp.r('body')->'repairProposals') p WHERE p->>'existingOwner'='schema_proposals curator review'),'missing vocabulary routed to existing curator proposal capability');
SELECT pg_temp.assert_ok(pg_temp.r('envelope')#>>'{episode,producerMethod}'='protected_archived_sale_observation_v1' AND pg_temp.r('classV8')#>>'{factoryContext,historicalAvailabilityEstablished}'='false','actual method column retained and current catalog never claims past availability');
SELECT pg_temp.assert_ok(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration',NULL,NULL,jsonb_build_array(pg_temp.id('missingSpec')))))#>'{claims,0,gaps}' ? 'missing_supplied_catalog_reference','unknown supplied OEM ID is explicit rather than silently dropped');
SELECT pg_temp.assert_ok(pg_temp.r('classOther')->'gaps' ? 'unresolved_or_broad_catalog_body_term','broad body category yields actionable existing-catalog repair instead of invented variant');
SELECT pg_temp.assert_ok(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration')||jsonb_build_object('oem_model_ids',jsonb_build_array(pg_temp.id('oemModelA')),'oem_trim_ids',jsonb_build_array(pg_temp.id('trimA')))))#>>'{claims,0,factoryContext,suppliedModels,0,canonicalModelFk}'='false','OEM model/trim IDs remain lexical class candidates without invented canonical FK');
SELECT pg_temp.assert_ok(pg_temp.assay('{}')#>>'{boundary,complete}'='false' AND pg_temp.assay('[{"observation_id":"bad","property_key":"engine_configuration"}]')#>>'{boundary,complete}'='false','non-array and malformed identity manifests refuse without cast error');
SELECT pg_temp.assert_ok(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration')||'{"oem_spec_ids":"bad"}'))#>>'{boundary,complete}'='false','invalid catalog arrays refuse without accidental traversal');
SELECT pg_temp.assert_ok(pg_temp.assay((SELECT jsonb_agg(pg_temp.claim('classV8','engine_configuration')) FROM generate_series(1,50)))#>>'{boundary,complete}'='true' AND pg_temp.assay((SELECT jsonb_agg(pg_temp.claim('classV8','engine_configuration')) FROM generate_series(1,51)))#>>'{boundary,complete}'='false','exact 50/51 claim boundary refuses overflow rather than sample');
SELECT pg_temp.assert_ok(pg_temp.assay((SELECT jsonb_agg(pg_temp.claim('classV8','engine_configuration')) FROM generate_series(1,50)))#>>'{boundary,distinctOriginalEvidenceRequested}'='1','repeated request presentations retain honest distinct original evidence denominator');
INSERT INTO canonical_body_styles VALUES('AMBIGUOUS_STYLE',true,'{cabriolet}');
SELECT pg_temp.assert_ok(jsonb_array_length(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration',NULL,'profileA')))#>'{claims,0,factoryContext,possibleModelBodies}')=4,'shared alias retains multiple catalog candidates without first-row resolution');
DELETE FROM canonical_body_styles WHERE canonical_name='AMBIGUOUS_STYLE';
INSERT INTO reference_libraries SELECT pg_temp.id('fanout'||i),NULL FROM generate_series(1,50) i;
INSERT INTO vehicle_reference_links SELECT pg_temp.id('alpha'),pg_temp.id('fanout'||i),'synthetic','2026-01-01Z' FROM generate_series(1,50) i;
SELECT pg_temp.assert_ok(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration')))#>>'{claims,0,factoryContext,complete}'='false' AND jsonb_array_length(pg_temp.assay(jsonb_build_array(pg_temp.claim('classV8','engine_configuration')))#>'{claims,0,factoryContext,vehicleLibrarySpecEdges}')=0,'51 reference headers refuse partial factory list');
UPDATE listing_page_snapshots SET created_at='2027-01-01Z' WHERE id=pg_temp.id('capture1');
SELECT pg_temp.assert_ok(pg_temp.assay(jsonb_build_array(pg_temp.claim('envelope','engine_configuration','engine_size')))#>>'{claims,0,episode,captureClocksEligible}'='false','late source row ingestion cannot be hidden by earlier fetch or observed clock');
\echo CONFIGURATION_CATALOG_RELATIONS_CONTRACT_PASS
