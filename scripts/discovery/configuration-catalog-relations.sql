-- Read-only worker diagnostic, not a migration, admitted claim or public reader.
-- $1 jsonb: 1..50 objects {observation_id,property_key,source_field?,profile_subject_id?,
--   oem_model_ids?:uuid[<=20],oem_trim_ids?:uuid[<=20],oem_spec_ids?:uuid[<=20]}.
-- $2 timestamptz: optional knowledge boundary. Missing clocks stay unknown.
-- IDs select evidence; property_key/catalog IDs are requested candidate resolutions,
-- never authority to assign property_id, installed equipment or historical identity.
-- Exact PK/key/vehicle-index traversal only. Reference fan-out has a 51-row sentinel.
-- No raw prose, HTML, source URLs, names or catalog notes are returned. No source fetch.
-- Admission rule snapshot: main3be ingest-observation/imageProperties.ts admits only
-- three image keys. Other registry keys require owner review; no new method is minted.
-- Source receipts/headers are inspected, NOT raw-reverified; catalog/class readiness
-- cannot qualify sale-time configuration. Broader price population remains available.
WITH request AS MATERIALIZED (
 SELECT $1::jsonb AS manifest,$2::timestamptz AS evidence_as_of,
   CASE WHEN jsonb_typeof($1::jsonb)='array' THEN $1::jsonb ELSE '[]'::jsonb END AS entries
), inputs AS MATERIALIZED (
 SELECT i.ordinality AS n,i.value AS raw,
   CASE WHEN i.value->>'observation_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     THEN (i.value->>'observation_id')::uuid END AS observation_id,
   i.value->>'property_key' AS property_key,coalesce(i.value->>'source_field',i.value->>'property_key') AS source_field,
   CASE WHEN i.value->>'profile_subject_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     THEN (i.value->>'profile_subject_id')::uuid END AS profile_id,
   jsonb_typeof(i.value)='object'
     AND coalesce(i.value->>'property_key' ~ '^[a-z][a-z0-9_]{0,79}$',false)
     AND coalesce(coalesce(i.value->>'source_field',i.value->>'property_key') ~ '^[a-z][a-z0-9_]{0,79}$',false)
     AND coalesce(i.value->>'observation_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)
     AND (NOT i.value ? 'profile_subject_id' OR i.value->'profile_subject_id'='null'::jsonb
       OR coalesce(i.value->>'profile_subject_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false))
     AND NOT EXISTS (
       SELECT FROM (VALUES ('oem_model_ids'),('oem_trim_ids'),('oem_spec_ids')) k(key)
       WHERE i.value ? k.key AND (jsonb_typeof(i.value->k.key)<>'array'
         OR jsonb_array_length(CASE WHEN jsonb_typeof(i.value->k.key)='array' THEN i.value->k.key ELSE '[]'::jsonb END)>20
         OR EXISTS (SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.value->k.key)='array' THEN i.value->k.key ELSE '[]'::jsonb END) x
           WHERE jsonb_typeof(x)<>'string' OR coalesce(x#>>'{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false) IS NOT TRUE))) AS valid
 FROM request r CROSS JOIN LATERAL jsonb_array_elements(r.entries) WITH ORDINALITY i
 LIMIT 51
), boundary AS MATERIALIZED (
 SELECT r.evidence_as_of,coalesce(jsonb_typeof(r.manifest)='array'
   AND jsonb_array_length(r.entries) BETWEEN 1 AND 50
   AND (r.evidence_as_of IS NULL OR isfinite(r.evidence_as_of))
   AND NOT EXISTS(SELECT FROM inputs WHERE valid IS NOT TRUE),false) AS valid,
   jsonb_array_length(r.entries) AS requested
 FROM request r
), claims AS MATERIALIZED (
 SELECT i.n,i.raw,i.observation_id,i.property_key,i.source_field,i.profile_id,b.evidence_as_of,
   o.id AS found_id,o.vehicle_id,o.property_id,o.kind::text AS kind,o.subject_type,
   o.source_id,o.source_snapshot_id,o.source_vehicle_event_id,o.observed_at,o.ingested_at,
   o.is_superseded,o.extraction_method,
   o.structured_data->i.source_field AS value,o.structured_data->'source_configuration_receipt' AS configuration_receipt,
   o.source_url AS observation_url,public.observation_is_public(o.kind,o.structured_data) AS public_row_marking,
   v.id AS parent_id,v.is_public,v.deleted_at,v.listing_kind,
   p.id AS descriptor_id,p.data_type,p.unit,p.namespace,p.deprecated_at,p.cardinality,
   p.verification_scope,p.applies_to_kinds,p.parent_property_id,
   pp.id AS parent_descriptor_id,
   e.id AS event_id,e.vehicle_id AS event_vehicle_id,e.source_url AS event_url,
   e.source_platform AS event_platform,
   s.id AS snapshot_id,s.listing_url AS snapshot_url,s.platform AS snapshot_platform,
   s.success AS snapshot_success,s.http_status,s.html_sha256,s.metadata AS snapshot_metadata,
   s.fetched_at,s.created_at AS capture_ingested_at,
   m.subject_id AS profile_found_id,m.canonical_model_id,m.comparison_scope_status,
   cm.id AS canonical_model_found_id,cm.body_styles AS model_body_options
 FROM inputs i CROSS JOIN boundary b
 LEFT JOIN public.vehicle_observations o ON o.id=i.observation_id
 LEFT JOIN public.vehicles v ON v.id=o.vehicle_id
 LEFT JOIN public.observation_properties p ON p.property_key=i.property_key
 LEFT JOIN public.observation_properties pp ON pp.id=p.parent_property_id
 LEFT JOIN public.vehicle_events e ON e.id=o.source_vehicle_event_id
 LEFT JOIN public.listing_page_snapshots s ON s.id=o.source_snapshot_id
 LEFT JOIN public.make_model_profiles m ON m.subject_id=i.profile_id
 LEFT JOIN public.canonical_models cm ON cm.id=m.canonical_model_id
 WHERE b.valid
), reference_paths AS MATERIALIZED (
 SELECT c.n,l.library_id,l.link_type,l.linked_at,r.oem_spec_id,
   s.id AS spec_id,s.source_library_id,
   s.body_style,s.engine_displacement_liters,s.engine_displacement_cid,s.engine_config
 FROM claims c CROSS JOIN LATERAL (
   SELECT x.library_id,x.link_type,x.linked_at FROM public.vehicle_reference_links x
   WHERE x.vehicle_id=c.parent_id AND c.is_public IS TRUE AND c.deleted_at IS NULL
     AND c.listing_kind IS DISTINCT FROM 'non_vehicle_item'
   ORDER BY x.library_id LIMIT 51
 ) l
 LEFT JOIN public.reference_libraries r ON r.id=l.library_id
 LEFT JOIN public.oem_vehicle_specs s ON s.id=r.oem_spec_id
), supplied_options AS MATERIALIZED (
 SELECT DISTINCT c.n,k.key,(x#>>'{}')::uuid AS id
 FROM claims c CROSS JOIN (VALUES ('oem_model_ids'),('oem_trim_ids'),('oem_spec_ids')) k(key)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.raw->k.key,'[]'::jsonb)) x
), catalog AS MATERIALIZED (
 SELECT c.n,
   (SELECT count(*) FROM reference_paths r WHERE r.n=c.n)<=50 AS reference_complete,
   (SELECT count(*) FROM reference_paths r WHERE r.n=c.n) AS reference_header_count,
   coalesce((SELECT jsonb_agg(jsonb_build_object('libraryId',r.library_id,'linkTypeRecorded',r.link_type IS NOT NULL,
     'linkedAt',r.linked_at,'oemSpecId',r.oem_spec_id,'specExists',r.spec_id IS NOT NULL,
     'specSourceLibraryId',r.source_library_id,'role','factory_reference_option',
     'installedEquipmentProved',false) ORDER BY r.library_id)
     FROM reference_paths r WHERE r.n=c.n
       AND (SELECT count(*) FROM reference_paths r2 WHERE r2.n=c.n)<=50),'[]'::jsonb) AS reference_edges,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'role','supplied_factory_option',
     'bodyStyleCatalogToken',CASE WHEN s.body_style IN (SELECT canonical_name FROM public.canonical_body_styles WHERE is_active) THEN s.body_style END,'engineLiters',CASE WHEN s.engine_displacement_liters::text NOT IN ('NaN','Infinity','-Infinity') THEN s.engine_displacement_liters END,
     'engineCid',s.engine_displacement_cid,'engineConfigValuePresent',s.engine_config IS NOT NULL,
     'sourceLibraryId',s.source_library_id,'installedEquipmentProved',false) ORDER BY s.id)
     FROM supplied_options x JOIN public.oem_vehicle_specs s ON s.id=x.id
     WHERE x.n=c.n AND x.key='oem_spec_ids'),'[]'::jsonb) AS supplied_specs,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'role','supplied_model_candidate',
     'canonicalModelFk',false,'installedEquipmentProved',false) ORDER BY m.id)
     FROM supplied_options x JOIN public.oem_models m ON m.id=x.id
     WHERE x.n=c.n AND x.key='oem_model_ids'),'[]'::jsonb) AS supplied_models,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'role','supplied_trim_candidate',
     'canonicalModelFk',false,'installedEquipmentProved',false) ORDER BY t.id)
     FROM supplied_options x JOIN public.oem_trim_levels t ON t.id=x.id
     WHERE x.n=c.n AND x.key='oem_trim_ids'),'[]'::jsonb) AS supplied_trims,
   (SELECT count(*) FROM supplied_options x WHERE x.n=c.n) AS supplied_header_count,
   coalesce((SELECT jsonb_agg(jsonb_build_object('catalog',x.key,'id',x.id) ORDER BY x.key,x.id)
     FROM supplied_options x
     LEFT JOIN public.oem_vehicle_specs os ON x.key='oem_spec_ids' AND os.id=x.id
     LEFT JOIN public.oem_models om ON x.key='oem_model_ids' AND om.id=x.id
     LEFT JOIN public.oem_trim_levels ot ON x.key='oem_trim_ids' AND ot.id=x.id
     WHERE x.n=c.n AND coalesce(os.id,om.id,ot.id) IS NULL),'[]'::jsonb) AS unresolved_supplied_ids,
   coalesce((SELECT jsonb_agg(jsonb_build_object('canonicalName',bs.canonical_name,
       'catalogTermSha256',encode(sha256(convert_to(t.term,'UTF8')),'hex'),
       'resolutionBasis',CASE WHEN t.term=bs.canonical_name THEN 'exact_catalog_key'
         WHEN lower(t.term)=lower(bs.canonical_name) THEN 'case_candidate' ELSE 'alias_candidate' END,
       'role','catalog_possible_body','instanceFk',false) ORDER BY t.term,bs.canonical_name)
     FROM unnest(c.model_body_options) t(term) JOIN public.canonical_body_styles bs
       ON bs.is_active IS TRUE AND (lower(bs.canonical_name)=lower(t.term)
         OR lower(t.term)=ANY(bs.aliases))) ,'[]'::jsonb) AS model_bodies,
   coalesce((SELECT jsonb_agg(jsonb_build_object(
       'catalogTermSha256',encode(sha256(convert_to(t.term,'UTF8')),'hex'),
       'status','unresolved_or_broad_category_not_exact_variant') ORDER BY t.term)
     FROM unnest(c.model_body_options) t(term) WHERE NOT EXISTS(
       SELECT FROM public.canonical_body_styles bs WHERE bs.is_active IS TRUE
         AND (lower(bs.canonical_name)=lower(t.term) OR lower(t.term)=ANY(bs.aliases)))),'[]'::jsonb) AS unresolved_model_bodies
 FROM claims c
), measured AS MATERIALIZED (
 SELECT c.*,a.reference_complete,a.reference_header_count,a.reference_edges,a.supplied_specs,
   a.supplied_models,a.supplied_trims,a.supplied_header_count,a.model_bodies,a.unresolved_model_bodies,a.unresolved_supplied_ids,
   coalesce(c.parent_id IS NOT NULL AND c.is_public IS TRUE AND c.deleted_at IS NULL
     AND c.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND c.subject_type='vehicle'
     AND c.is_superseded IS FALSE AND c.public_row_marking IS TRUE AND c.source_id IS NOT NULL,false) AS testimony_eligible,
   c.ingested_at IS NOT NULL AND isfinite(c.ingested_at)
     AND (c.evidence_as_of IS NULL OR c.ingested_at<=c.evidence_as_of) AS knowledge_eligible,
   c.descriptor_id IS NOT NULL AND c.namespace='core' AND c.deprecated_at IS NULL AS registry_active,
   c.property_id=c.descriptor_id AS property_linked,
   coalesce(c.kind=ANY(c.applies_to_kinds::text[]),false) AS kind_allowed,
   CASE c.data_type WHEN 'numeric' THEN jsonb_typeof(c.value)='number'
     WHEN 'integer' THEN jsonb_typeof(c.value)='number' AND c.value::text ~ '^-?[0-9]+$'
     WHEN 'string' THEN jsonb_typeof(c.value)='string'
     WHEN 'boolean' THEN jsonb_typeof(c.value)='boolean'
     WHEN 'jsonb' THEN c.value IS NOT NULL AND c.value<>'null'::jsonb
     ELSE false END AS value_shape_valid,
   coalesce(c.source_vehicle_event_id IS NOT NULL AND c.event_id IS NOT NULL
     AND c.source_snapshot_id IS NOT NULL AND c.snapshot_id IS NOT NULL
     AND c.event_vehicle_id=c.vehicle_id AND c.snapshot_metadata->>'vehicle_id'=c.vehicle_id::text
     AND c.snapshot_metadata->>'vehicle_matched'='true'
     AND c.event_platform=c.snapshot_platform AND c.observation_url IS NOT NULL
     AND c.observation_url=c.event_url AND c.observation_url=c.snapshot_url
     AND c.snapshot_success IS TRUE AND c.http_status BETWEEN 200 AND 299
     AND c.html_sha256 ~ '^[0-9a-fA-F]{64}$',false) AS typed_headers_agree,
   coalesce(c.fetched_at IS NOT NULL AND isfinite(c.fetched_at)
     AND c.capture_ingested_at IS NOT NULL AND isfinite(c.capture_ingested_at)
     AND (c.evidence_as_of IS NULL OR greatest(c.fetched_at,c.capture_ingested_at)<=c.evidence_as_of),false) AS capture_clocks_eligible,
   c.property_key IN ('image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state') AS current_key_admitted
 FROM claims c JOIN catalog a ON a.n=c.n
), disagreements AS MATERIALIZED (
 SELECT vehicle_id,source_vehicle_event_id,property_key,
   count(DISTINCT encode(sha256(convert_to(value::text,'UTF8')),'hex')) AS distinct_raw_values
 FROM measured WHERE testimony_eligible AND knowledge_eligible AND value IS NOT NULL AND value<>'null'::jsonb
 GROUP BY vehicle_id,source_vehicle_event_id,property_key
), diagnoses AS MATERIALIZED (
 SELECT m.*,coalesce(d.distinct_raw_values,0) AS distinct_raw_values,
   array_remove(ARRAY[
     CASE WHEN found_id IS NULL THEN 'missing_original_observation' END,
     CASE WHEN found_id IS NOT NULL AND NOT testimony_eligible THEN 'ineligible_testimony' END,
     CASE WHEN NOT knowledge_eligible THEN 'unknown_or_later_recording_clock' END,
     CASE WHEN descriptor_id IS NULL THEN 'missing_property_vocabulary' END,
     CASE WHEN descriptor_id IS NOT NULL AND NOT registry_active THEN 'unratified_or_deprecated_descriptor' END,
     CASE WHEN descriptor_id IS NOT NULL AND property_linked IS NOT TRUE THEN 'missing_or_different_property_fk' END,
     CASE WHEN descriptor_id IS NOT NULL AND NOT current_key_admitted THEN 'existing_vocabulary_not_admitted_by_current_owner' END,
     CASE WHEN descriptor_id IS NOT NULL AND NOT kind_allowed THEN 'unsupported_observation_kind' END,
     CASE WHEN descriptor_id IS NOT NULL AND value_shape_valid IS NOT TRUE THEN 'unknown_or_unsupported_value_shape' END,
     CASE WHEN descriptor_id IS NOT NULL AND verification_scope='class' THEN 'class_descriptor_not_instance_equipment' END,
     CASE WHEN NOT typed_headers_agree THEN 'missing_or_inconsistent_typed_episode_custody' END,
     CASE WHEN source_snapshot_id IS NOT NULL AND NOT capture_clocks_eligible THEN 'unknown_or_later_capture_recording_clock' END,
     CASE WHEN distinct_raw_values>1 THEN 'conflicting_raw_claims_in_same_bound_or_unbound_group' END,
     CASE WHEN NOT reference_complete THEN 'reference_fanout_cap_refusal' END,
     CASE WHEN jsonb_array_length(unresolved_supplied_ids)>0 THEN 'missing_supplied_catalog_reference' END,
     CASE WHEN jsonb_array_length(unresolved_model_bodies)>0 THEN 'unresolved_or_broad_catalog_body_term' END,
     CASE WHEN jsonb_array_length(reference_edges)+jsonb_array_length(supplied_specs)>1 THEN 'multiple_factory_options_not_instance_resolution' END,
     'source_configuration_role_time_and_normalization_unestablished',
     'no_qualified_configuration_claim_for_pricing_consumer'
   ],NULL) AS gaps
 FROM measured m LEFT JOIN disagreements d ON d.vehicle_id=m.vehicle_id
   AND d.source_vehicle_event_id IS NOT DISTINCT FROM m.source_vehicle_event_id AND d.property_key=m.property_key
), receipts AS MATERIALIZED (
 SELECT d.n,jsonb_build_object(
   'originalEvidence',jsonb_build_object('table','vehicle_observations','id',d.observation_id,'exists',d.found_id IS NOT NULL),
   'propertyRequest',d.property_key,'originalSourceField',d.source_field,
   'sourceFieldRoute',CASE WHEN d.source_field='engine_size' THEN 'existing_current_listed_engine_claim_fold_reader_not_sale_configuration' ELSE 'inspect_existing_field_owner' END,'sourceFieldRouteResult','capability_only_row_fold_result_not_assayed_here',
   'relations',jsonb_build_object(
     'vehicleId',d.vehicle_id,'propertyId',d.property_id,'requestedDescriptorId',d.descriptor_id,
     'descriptorParentId',d.parent_property_id,'descriptorParentExists',d.parent_descriptor_id IS NOT NULL,
     'sourceId',d.source_id,'sourceVehicleEventId',d.source_vehicle_event_id,'sourceSnapshotId',d.source_snapshot_id,
     'profileSubjectId',d.profile_found_id,'canonicalModelId',d.canonical_model_id,
     'canonicalModelExists',d.canonical_model_found_id IS NOT NULL,
     'profileComparisonScopeStatus',d.comparison_scope_status),
   'descriptor',jsonb_build_object('active',d.registry_active,'dataType',d.data_type,'unit',d.unit,
     'cardinality',d.cardinality,'verificationScope',d.verification_scope,'kindAllowed',d.kind_allowed,
     'propertyFkMatches',coalesce(d.property_linked,false),'currentKeyAdmissionSupported',d.current_key_admitted,
     'admissionRuleSource','ingest-observation/imageProperties.ts:isSupportedImagePropertyKey'),
   'claim',jsonb_build_object('publicMarkedHeaderEligible',d.testimony_eligible,
     'recordedAt',d.ingested_at,'recordingClockEligible',d.knowledge_eligible,
     'observedAt',d.observed_at,'observedClockBasis','writer_defined_not_sale_time',
     'valueShape',jsonb_typeof(d.value),'valueShapeValid',coalesce(d.value_shape_valid,false),
     'rawValueSha256',CASE WHEN d.testimony_eligible AND d.knowledge_eligible AND d.value IS NOT NULL
       THEN encode(sha256(convert_to(d.value::text,'UTF8')),'hex') END,
     'distinctRawClaimValues',d.distinct_raw_values,'normalizedValue',NULL,
     'valueRole','source_reported_unqualified','unitAttribution','unestablished'),
   'episode',jsonb_build_object('typedHeaderAgreement',d.typed_headers_agree,
     'headerComparison','exact_URL_and_platform_only_aliases_unresolved',
     'rawReverified',false,'producerMethod',d.extraction_method,'captureAt',d.fetched_at,'sourceRecordedAt',d.capture_ingested_at,
     'captureClocksEligible',d.capture_clocks_eligible,'configurationEventAt',NULL,
     'configurationReceiptPresent',jsonb_typeof(d.configuration_receipt)='object',
     'configurationReceiptRole','candidate_accounting_only_no_normalized_equipment',
     'saleStateApplicability','unestablished'),
   'factoryContext',jsonb_build_object('complete',d.reference_complete,'referenceHeadersRead',d.reference_header_count,
     'vehicleLibrarySpecEdges',d.reference_edges,'suppliedSpecs',d.supplied_specs,
     'suppliedModels',d.supplied_models,'suppliedTrims',d.supplied_trims,
     'suppliedHeaders',d.supplied_header_count,'unresolvedSuppliedIds',d.unresolved_supplied_ids,'currentCatalogOnly',true,'historicalAvailabilityEstablished',false,'possibleModelBodies',d.model_bodies,'unresolvedOrBroadModelBodies',d.unresolved_model_bodies,
     'matchingBasis','existing_typed_reference_edges_or_explicit_candidate_IDs_no_text_inference',
     'installedEquipmentProved',false),
   'readinessBasis','current_catalog_schema_not_historical_or_installed_proof',
   'classStructureReady',d.testimony_eligible AND d.knowledge_eligible AND d.registry_active
     AND d.property_linked IS TRUE AND d.kind_allowed AND d.value_shape_valid IS TRUE,
   'pricingConfigurationQualified',false,'publicConfigurationValue',NULL,
   'gaps',to_jsonb(d.gaps),
   'repairProposals',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'priority',g.priority,'gapKind',g.gap,'existingOwner',g.owner,'owningPath',g.path,
     'originalEvidenceId',d.observation_id,'propertyDescriptorId',d.descriptor_id,
     'sourceVehicleEventId',d.source_vehicle_event_id,'sourceSnapshotId',d.source_snapshot_id,
     'proposedRelationshipOrRole',g.relation,'acceptanceCondition',g.acceptance,
     'proposalStatus','read_only_candidate_not_submitted_or_admitted') ORDER BY g.priority,g.gap)
     FROM (VALUES
       (5,'missing_original_observation','existing discovery caller / ingest-observation','vehicle_observations.id',
         'resolve exact original evidence ID before planning a relationship',
         'Existing cached receipt or indexed original lookup identifies the source row; do not invent or admit replacement testimony'),
       (10,'ineligible_testimony','ingest-observation / existing privacy policy','observation_is_public',
         'preserve private/superseded testimony without public equipment projection',
         'Only existing public eligibility and actual source consent can permit the intended reader; do not remove private markers'),
       (20,'missing_property_vocabulary','schema_proposals curator review','schema_proposals / observation_properties',
         'propose a descriptor or link existing descriptor/catalog class with motivating original evidence',
         'Curator resolves the existing proposal with explicit type/unit/scope/kind; never mint vocabulary during a read'),
       (20,'unratified_or_deprecated_descriptor','schema_proposals curator review','observation_properties',
         'resolve active descriptor identity instead of assigning pending/deprecated ID',
         'Existing curator ratification/supersession supplies an active exact descriptor'),
       (30,'existing_vocabulary_not_admitted_by_current_owner','ingest-observation','supabase/functions/ingest-observation/imageProperties.ts',
         'review canonical admission and value normalization for the existing descriptor; do not map engine_size to engine architecture',
         'Actual canonical handler and custody guard accept exact supported typed claim and refuse wrong kind/unit/source/role; no new method implied'),
       (40,'missing_or_different_property_fk','ingest-observation','supabase/functions/ingest-observation/index.ts',
         'bind new sanctioned claim to existing property_id while retaining original evidence and supersession',
         'Canonical writer supplies exact descriptor ID and source-bound value; legacy original row remains unchanged'),
       (40,'unsupported_observation_kind','ingest-observation / descriptor curator','observation_properties.applies_to_kinds',
         'review claim kind and source role rather than widening all fields',
         'Exact registry applies_to_kinds and canonical validator agree for this established source role'),
       (45,'class_descriptor_not_instance_equipment','observation_properties curator / ingest-observation','observation_properties.verification_scope',
         'separate factory class option from this vehicle/episode source-reported equipment',
         'Instance or both scope is explicitly justified and ratified; a factory catalog alone never supplies instance truth'),
       (50,'unknown_or_unsupported_value_shape','ingest-observation / existing source parser','observation_properties.data_type/unit',
         'normalize supported original source span with explicit units and preserve ambiguous/multiple claims',
         'Deterministic owner validates exact value/unit; V8 does not become 289 and string liters do not become numeric liters'),
       (50,'missing_or_inconsistent_typed_episode_custody','ingest-observation','validate_comment_observation_source',
         'connect exact admitted original event/capture/source/parent ancestry',
         'Existing canonical custody guard and independent raw verifier agree; do not reparent or backfill original testimony'),
       (50,'unknown_or_later_recording_clock','ingest-observation','vehicle_observations.ingested_at',
         'preserve unknown recording time or evaluate at a later explicit evidence boundary',
         'Actual DB-owned original row recording clock is finite and within requested cutoff; observed_at is not a substitute'),
       (50,'unknown_or_later_capture_recording_clock','archiveFetch / ingest-observation','listing_page_snapshots.created_at/fetched_at',
         'retain original capture and DB-recording clocks separately',
         'Original protected clocks and derived admission time each satisfy explicit evidence cutoff'),
       (55,'conflicting_raw_claims_in_same_bound_or_unbound_group','ingest-observation / existing consensus owner','vehicle_observations / detect_field_conflicts',
         'retain each author/source/arrival and normalize before deciding contradictory equipment',
         'Equivalent values collapse only under sanctioned unit/role normalization; contradictions remain visible and unqualified'),
       (60,'reference_fanout_cap_refusal','existing discovery caller','configuration-catalog-relations.sql',
         'walk declared exact reference population with explicit completeness',
         'No partial first-50 reference list is treated as complete'),
       (60,'missing_supplied_catalog_reference','existing OEM/catalog owner unresolved','oem_models / oem_trim_levels / oem_vehicle_specs',
         'resolve supplied exact class option ID without fuzzy replacement',
         'Existing catalog record and sanctioned identity mapping establish the class reference; missing rows remain explicit'),
       (65,'unresolved_or_broad_catalog_body_term','existing canonical catalog owner unresolved','canonical_models.body_styles / canonical_body_styles',
         'review current class category versus exact body variant and candidate aliases',
         'Existing catalog curator supplies explicit category/variant relation; sports-car category never silently becomes coupe'),
       (65,'multiple_factory_options_not_instance_resolution','reference_libraries / OEM catalog owner unresolved','vehicle_reference_links / oem_vehicle_specs',
         'retain all factory options and seek exact instance/equipment evidence',
         'One verified source-bound equipment claim resolves comparison dimension; never choose first OEM row'),
       (70,'source_configuration_role_time_and_normalization_unestablished','ingest-observation / batParser','supabase/functions/_shared/batParser.ts',
         'attribute normalized claim to exact source episode and distinguish factory/former/replacement/listed roles',
         'Pinned raw span/hash/parser, source role, unit and sale-state relevance are established; parse/capture/observed times are not engine-at-sale time'),
       (80,'no_qualified_configuration_claim_for_pricing_consumer','valuation_by_ymm / selectSourceSalePopulation','existing canonical sale reader / batComps.ts',
         'consume eligible exact episode-bound claims as explicit required comparison dimensions',
         'Reader returns claim evidence IDs, normalized dimensions, scope and both clocks; retains broader candidate market and conflict/unknown coverage')
     ) g(priority,gap,owner,path,relation,acceptance) WHERE g.gap=ANY(d.gaps)),'[]'::jsonb)
   ) AS receipt
 FROM diagnoses d
)
SELECT jsonb_build_object('contractVersion','configuration_catalog_relations_v1',
 'stage','read_only_diagnostic_not_admission_or_pricing',
 'boundary',jsonb_build_object('complete',b.valid,'requestedClaims',b.requested,'maximumClaims',50,
   'distinctOriginalEvidenceRequested',(SELECT count(DISTINCT observation_id) FROM inputs),'maximumSuppliedIDsPerCatalog',20,'maximumReferencesPerClaim',50,'evidenceAsOf',b.evidence_as_of,
   'refusal',CASE WHEN NOT b.valid THEN 'invalid_manifest_or_claim_cap_refuses_all_no_sample' END),
 'claims',coalesce((SELECT jsonb_agg(receipt ORDER BY n) FROM receipts),'[]'::jsonb))
FROM boundary b;
