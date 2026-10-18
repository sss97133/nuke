-- READ-ONLY operator reconciliation; no migration/function/intake/replay.
-- $1 jsonb: {asOf, requests:[{key,field,observationId?,vehicleId?,captureId?,
-- eventId?,propertyKey?,sourceDigest?,parsedStatus?,requiredRole?,regionKey?}]}.
-- 1..50 explicit cached inventory items. parsedStatus is a supplied inventory
-- declaration (e.g. an offline parser receipt), never DB admission/qualification.
-- One row means one requested source region/claim x field, not every source fact.
-- Execute in BEGIN READ ONLY with statement_timeout='5s'. Private receipt only.
-- Source header hashes are compared, never presented as recomputed raw proof.
-- Existing readers expose CURRENT permitted evidence, not historical replay.
-- Reader exposure is independent of requested-relation verification. A visible
-- field may still fail its supplied capture/episode/property/hash contract.
WITH document AS MATERIALIZED (
  SELECT $1::jsonb doc,
    CASE WHEN jsonb_typeof($1::jsonb->'requests')='array' THEN $1::jsonb->'requests' ELSE '[]'::jsonb END items,
    CASE WHEN pg_catalog.pg_input_is_valid($1::jsonb->>'asOf','timestamptz')
      THEN ($1::jsonb->>'asOf')::timestamptz END as_of
), inventory AS MATERIALIZED (
  SELECT item, ord,
    item->>'key' item_key,item->>'field' field_name,item->>'propertyKey' property_key,
    item->>'sourceDigest' expected_digest,
    coalesce(item->>'parsedStatus','unknown') parsed_status,item->>'requiredRole' required_role,
    item->>'regionKey' region_key,
    coalesce((item->>'key') ~ '^[a-z][a-z0-9_]{0,63}$',false)
      AND coalesce((item->>'field') ~ '^[a-z][a-z0-9_]{0,63}$',false)
      AND (item->>'propertyKey' IS NULL OR (item->>'propertyKey') ~ '^[a-z][a-z0-9_]{0,63}$')
      AND (item->>'sourceDigest' IS NULL OR (item->>'sourceDigest') ~ '^[0-9a-f]{64}$')
      AND coalesce(item->>'parsedStatus','unknown') IN ('unknown','unparsed','extracted_unadmitted','admitted')
      AND (item->>'requiredRole' IS NULL OR item->>'requiredRole' IN ('current','factory','previous'))
      AND (item->>'regionKey' IS NULL OR ((item->>'regionKey') ~ '^[a-z][a-z0-9_]{0,63}$' AND item->>'captureId' IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['observationId','vehicleId','captureId','eventId']) k
        WHERE item->>k IS NOT NULL AND NOT ((item->>k) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) valid,
    CASE WHEN item->>'observationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'observationId')::uuid END observation_id,
    CASE WHEN item->>'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'vehicleId')::uuid END vehicle_id,
    CASE WHEN item->>'captureId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'captureId')::uuid END capture_id,
    CASE WHEN item->>'eventId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (item->>'eventId')::uuid END event_id
  FROM document d CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_array_length(d.items)<=50 THEN d.items ELSE '[]'::jsonb END) WITH ORDINALITY x(item,ord)
), boundary AS MATERIALIZED (
  SELECT d.as_of,jsonb_array_length(d.items) requested,
    jsonb_array_length(d.items) BETWEEN 1 AND 50 AND isfinite(d.as_of)
      AND (SELECT coalesce(bool_and(i.valid),false) FROM inventory i)
      AND (SELECT count(*)=count(DISTINCT item_key) FROM inventory) valid,
    (SELECT count(*)=count(DISTINCT ROW(capture_id,region_key,field_name)) FROM inventory WHERE region_key IS NOT NULL) region_unique
  FROM document d
), heads AS MATERIALIZED (
  SELECT i.*, b.as_of, o.id found_observation,o.vehicle_id observation_vehicle,o.kind::text kind,
    o.structured_data,o.source_snapshot_id,o.source_vehicle_event_id,o.property_id,
    o.observed_at,o.ingested_at,o.is_superseded,o.content_text IS NOT NULL testimony_text_retained,
    coalesce(o.structured_data ? i.field_name AND o.structured_data->i.field_name <> 'null'::jsonb,false) field_extracted,
    o.content_hash IS NOT NULL observation_hash_present,
    o.extraction_method IS NOT NULL parser_recorded,
    v.id found_vehicle,v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' parent_public,
    s.id found_capture,s.html IS NOT NULL inline_retained,
    nullif(s.html_storage_path,'') IS NOT NULL offload_locator,
    s.html_sha256 stored_digest,s.fetched_at,s.created_at capture_ingested_at,
    CASE WHEN s.html IS NOT NULL THEN octet_length(s.html)>4194304 ELSE false END raw_size_withheld,
    s.metadata->>'vehicle_id'=coalesce(i.vehicle_id,o.vehicle_id)::text snapshot_parent_attested,
    e.id found_event,e.vehicle_id event_vehicle,
    p.id found_property,p.property_key registered_property,p.deprecated_at,p.applies_to_kinds,
    c.source_observation_id folded_source,c.as_of_at fold_as_of,c.resolution_method,
    c.consensus_value,c.consensus_confidence,o.confidence_score
  FROM inventory i CROSS JOIN boundary b
  LEFT JOIN public.vehicle_observations o ON b.valid AND b.region_unique AND o.id=i.observation_id
  LEFT JOIN public.vehicles v ON v.id=coalesce(i.vehicle_id,o.vehicle_id)
  LEFT JOIN public.listing_page_snapshots s ON b.valid AND s.id=i.capture_id
  LEFT JOIN public.vehicle_events e ON e.id=coalesce(i.event_id,o.source_vehicle_event_id)
  LEFT JOIN public.observation_properties p ON p.id=o.property_id
  LEFT JOIN public.vehicle_field_consensus c ON c.vehicle_id=coalesce(i.vehicle_id,o.vehicle_id)
    AND c.field_name=i.field_name
  WHERE b.valid AND b.region_unique
), checks AS MATERIALIZED (
  SELECT h.*,
    found_observation IS NOT NULL AND observation_vehicle=found_vehicle
      AND (vehicle_id IS NULL OR observation_vehicle=vehicle_id) vehicle_bound,
    coalesce(found_capture IS NOT NULL AND source_snapshot_id=capture_id,false) capture_bound,
    coalesce(found_event IS NOT NULL AND source_vehicle_event_id=found_event
      AND event_vehicle=observation_vehicle AND (event_id IS NULL OR event_id=found_event),false) event_bound,
    CASE WHEN expected_digest IS NULL THEN NULL ELSE stored_digest=expected_digest END digest_agrees,
    coalesce(property_key IS NOT NULL AND found_property IS NOT NULL AND registered_property=property_key
      AND deprecated_at IS NULL AND kind::public.observation_kind=ANY(applies_to_kinds),false) property_bound,
    coalesce(public.observation_is_public(kind::public.observation_kind,structured_data),false) observation_public,
    CASE WHEN observed_at IS NULL OR ingested_at IS NULL OR NOT isfinite(observed_at) OR NOT isfinite(ingested_at) THEN 'unknown'
      WHEN observed_at>as_of OR ingested_at>as_of THEN 'after_cutoff' ELSE 'within_cutoff' END observation_clock,
    CASE WHEN found_capture IS NULL THEN 'not_checked'
      WHEN fetched_at IS NULL OR capture_ingested_at IS NULL OR NOT isfinite(fetched_at) OR NOT isfinite(capture_ingested_at) THEN 'unknown'
      WHEN fetched_at>as_of OR capture_ingested_at>as_of THEN 'after_cutoff' ELSE 'within_cutoff' END capture_clock,
    coalesce(fold_as_of>as_of,false) fold_after_cutoff,
    coalesce(folded_source=found_observation AND is_superseded IS NOT TRUE
      AND observed_at<=fold_as_of AND ingested_at<=fold_as_of
      AND structured_data->>field_name IS NOT DISTINCT FROM consensus_value
      AND confidence_score IS NOT DISTINCT FROM consensus_confidence,false) fold_matches
  FROM heads h
), specs AS MATERIALIZED (
  SELECT v.id,public.get_vehicle_specs(v.id) result FROM public.vehicles v
  WHERE v.id IN (SELECT found_vehicle FROM checks WHERE parent_public AND observation_public
    AND vehicle_bound AND observation_clock='within_cutoff' AND is_superseded IS NOT TRUE)
), exposure AS MATERIALIZED (
  SELECT h.*,
    EXISTS (SELECT 1 FROM specs s CROSS JOIN LATERAL jsonb_array_elements(s.result) f
      WHERE s.id=h.found_vehicle AND f->>'field'=h.field_name
        AND f->>'source_observation_id'=h.found_observation::text) specs_reference_exposed,
    EXISTS (SELECT 1 FROM specs s CROSS JOIN LATERAL jsonb_array_elements(s.result) f
      WHERE s.id=h.found_vehicle AND f->>'field'=h.field_name AND h.vehicle_bound
        AND f->>'source_observation_id'=h.found_observation::text
        AND (f->>'reported_value'=h.structured_data->>h.field_name
          OR f->>'value'=h.structured_data->>h.field_name)) specs_value_exposed,
    coalesce((SELECT bool_or((f->>'reported_conflict')::boolean) FROM specs s
      CROSS JOIN LATERAL jsonb_array_elements(s.result) f
      WHERE s.id=h.found_vehicle AND f->>'field'=h.field_name),false) reader_conflict,
    coalesce((SELECT bool_or(f->>'value' IS NOT NULL) FROM specs s
      CROSS JOIN LATERAL jsonb_array_elements(s.result) f
      WHERE s.id=h.found_vehicle AND f->>'field'=h.field_name),false) scalar_present
  FROM checks h
), stages AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN found_observation IS NULL AND found_capture IS NOT NULL AND parsed_status='extracted_unadmitted' THEN 'parsed_unadmitted'
      WHEN found_observation IS NULL THEN
        CASE WHEN inline_retained THEN 'retained_only'
          WHEN offload_locator THEN 'retention_locator_only' ELSE 'retention_unestablished' END
      WHEN found_vehicle IS NULL THEN 'extracted_unresolved'
      WHEN NOT parent_public OR NOT observation_public THEN 'privacy_withheld'
      WHEN is_superseded IS TRUE THEN 'superseded_retained'
      WHEN NOT vehicle_bound THEN 'extracted_unresolved'
      WHEN observation_clock<>'within_cutoff' OR capture_clock='after_cutoff' OR fold_after_cutoff THEN 'clock_withheld'
      WHEN resolution_method='unresolved' OR reader_conflict THEN 'conflict_withheld'
      WHEN specs_value_exposed THEN 'exposed'
      WHEN fold_matches THEN 'folded'
      WHEN vehicle_bound AND field_extracted AND property_bound THEN 'linked'
      ELSE 'extracted_unresolved' END stage
  FROM exposure x
), requested_relation_checks AS MATERIALIZED (
  SELECT s.*, jsonb_build_object(
    'vehicle',CASE WHEN vehicle_id IS NULL THEN 'not_requested'
      WHEN vehicle_bound THEN 'passed' ELSE 'failed' END,
    'capture',CASE WHEN capture_id IS NULL THEN 'not_requested'
      WHEN capture_bound THEN 'passed' ELSE 'failed' END,
    'episode',CASE WHEN event_id IS NULL THEN 'not_requested'
      WHEN event_bound THEN 'passed' ELSE 'failed' END,
    'property',CASE WHEN property_key IS NULL THEN 'not_requested'
      WHEN property_bound THEN 'passed' ELSE 'failed' END,
    'sourceHeaderDigest',CASE WHEN expected_digest IS NULL THEN 'not_requested'
      WHEN stored_digest IS NULL THEN 'unestablished'
      WHEN digest_agrees THEN 'passed' ELSE 'failed' END,
    'captureClock',CASE WHEN capture_id IS NULL THEN 'not_requested'
      WHEN capture_clock='within_cutoff' THEN 'passed'
      WHEN capture_clock='after_cutoff' THEN 'failed' ELSE 'unestablished' END,
    'sourceRole',CASE WHEN required_role IS NULL THEN 'not_requested' ELSE 'unestablished' END
  ) requested_relation_checks
  FROM stages s
), findings AS MATERIALIZED (
  SELECT s.*, CASE
    WHEN found_observation IS NULL AND found_capture IS NOT NULL AND parsed_status='extracted_unadmitted' THEN 'parsed_claim_not_admitted_or_observation_locator_missing'
    WHEN found_observation IS NULL AND found_capture IS NOT NULL THEN 'missing_extraction_or_observation_locator'
    WHEN found_observation IS NULL THEN 'source_locator_or_retention_unestablished'
    WHEN found_vehicle IS NULL THEN 'unbound_or_contradictory_vehicle'
    WHEN NOT parent_public OR NOT observation_public THEN 'respect_publication_boundary'
    WHEN is_superseded IS TRUE THEN 'follow_sanctioned_supersession'
    WHEN observation_clock<>'within_cutoff' OR capture_clock='after_cutoff' OR fold_after_cutoff THEN 'clock_not_admissible_at_cutoff'
    WHEN NOT vehicle_bound THEN 'unbound_or_contradictory_vehicle'
    WHEN capture_id IS NOT NULL AND NOT capture_bound THEN 'typed_capture_link_missing_or_different'
    WHEN event_id IS NOT NULL AND NOT event_bound THEN 'typed_episode_link_missing_or_different'
    WHEN expected_digest IS NOT NULL AND digest_agrees IS NOT TRUE THEN 'source_header_digest_mismatch_or_missing'
    WHEN NOT field_extracted THEN 'field_not_extracted_original_testimony_retained'
    WHEN required_role IS NOT NULL THEN 'source_role_requires_episode_qualification'
    WHEN property_key IS NOT NULL AND NOT property_bound THEN 'property_unregistered_unbound_or_inapplicable'
    WHEN resolution_method='unresolved' OR reader_conflict THEN 'reported_conflict_not_resolved_truth'
    WHEN folded_source IS NOT NULL AND folded_source<>found_observation THEN 'fold_selected_other_testimony'
    WHEN NOT fold_matches AND NOT specs_value_exposed THEN 'fold_or_bounded_reader_path_unestablished'
    ELSE NULL END finding
  FROM requested_relation_checks s
), ownership AS MATERIALIZED (
  SELECT table_name,jsonb_agg(DISTINCT owned_by ORDER BY owned_by) owners
  FROM public.pipeline_registry
  WHERE table_name IN ('vehicle_observations','listing_page_snapshots','vehicle_field_consensus')
    AND owned_by IS NOT NULL GROUP BY table_name
)
SELECT jsonb_build_object(
  'schemaVersion','intake_reader_reconciliation_v1','status',CASE WHEN b.valid AND b.region_unique THEN 'measured_request_set' ELSE 'refused' END,
  'requestedItems',b.requested,'requestCap',50,'asOf',b.as_of,
  'scope','Explicit cached region/claim inventory only; no inferred source universe or fleet coverage.',
  'readerBasis','Existing current public-parent readers; no historical replay or independent source hash/parser verification.',
  'executionRole',current_user,'databaseWrites',0,
  'distinctObservationFieldPairs',(SELECT count(DISTINCT ROW(found_observation,field_name)) FROM findings WHERE found_observation IS NOT NULL),
  'stageCounts',(SELECT coalesce(jsonb_object_agg(stage,n),'{}'::jsonb) FROM
    (SELECT stage,count(*) n FROM findings GROUP BY stage) counts),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'key',item_key,'regionKey',region_key,'field',field_name,'stage',stage,'finding',finding,
    'inventoryParsedStatus',parsed_status,'requiredRole',required_role,
    'observationId',found_observation,'vehicleId',found_vehicle,'captureId',found_capture,
    'sourceVehicleEventId',source_vehicle_event_id,'propertyId',found_property,
    'retention',jsonb_build_object('inline',inline_retained,'offloadLocatorOnly',offload_locator,
      'originalObservation',found_observation IS NOT NULL,'textPresent',testimony_text_retained,
      'rawSizeWithheld',raw_size_withheld,'headerDigestAgrees',digest_agrees,'rawHashRecomputed',false),
    'links',jsonb_build_object('vehicle',vehicle_bound,'typedCapture',capture_bound,
      'typedEpisode',event_bound,'registeredProperty',property_bound,'snapshotParentAttested',snapshot_parent_attested,
      'sourceQualification','not_established_by_this_assay'),
    'requestedRelations',jsonb_build_object(
      'status',(SELECT CASE WHEN bool_or(value='failed') THEN 'failed'
        WHEN bool_or(value='unestablished') THEN 'unestablished'
        WHEN bool_or(value='passed') THEN 'passed' ELSE 'not_requested' END
        FROM jsonb_each_text(requested_relation_checks)),
      'checks',requested_relation_checks,'basis','explicit_requested_relations_only',
      'sourceQualification','not_established_by_this_assay','rawHashRecomputed',false),
    'clocks',jsonb_build_object('observationEventAt',observed_at,'observationIngestedAt',ingested_at,
      'captureFetchedAt',fetched_at,'captureIngestedAt',capture_ingested_at,'foldAsOf',fold_as_of,
      'observationState',observation_clock,'captureState',capture_clock,'historicalNativeAvailability','unestablished'),
    'reader',jsonb_build_object('specsReference',specs_reference_exposed,'specsValueCurrent',specs_value_exposed,
      'provenanceEvidence',NULL,'provenanceMeasurement','unmeasured_unbounded_owner',
      'scalarPresent',scalar_present,'conflict',reader_conflict,'foldAfterCutoff',fold_after_cutoff,
      'foldMatches',fold_matches,'foldSelectedOther',folded_source IS NOT NULL AND folded_source<>found_observation),
    'relationGaps',(SELECT coalesce(jsonb_agg(reason ORDER BY rank),'[]'::jsonb)
      FROM (VALUES
        (1,'typed_capture_link_missing_or_different',capture_id IS NOT NULL AND found_observation IS NOT NULL AND NOT capture_bound),
        (2,'typed_episode_link_missing_or_different',event_id IS NOT NULL AND found_observation IS NOT NULL AND NOT event_bound),
        (3,'vehicle_relation_unestablished',found_observation IS NOT NULL AND NOT vehicle_bound),
        (4,'requested_property_relation_unestablished',property_key IS NOT NULL AND found_observation IS NOT NULL AND NOT property_bound),
        (5,'field_not_extracted',found_observation IS NOT NULL AND NOT field_extracted),
        (6,'current_fold_not_selected_or_unestablished',parent_public AND observation_public AND field_extracted AND NOT fold_matches),
        (7,'bounded_reader_source_value_unestablished',parent_public AND observation_public AND field_extracted AND NOT specs_value_exposed),
        (8,'provenance_reader_unmeasured_unbounded_owner',parent_public AND observation_public AND field_extracted),
        (9,'source_reported_role_requires_episode_binding',required_role IS NOT NULL),
        (10,'offloaded_bytes_not_verified_here',offload_locator AND NOT inline_retained)
      ) gaps(rank,reason,present) WHERE present),
    'repair',CASE WHEN finding IS NULL THEN NULL ELSE jsonb_build_object(
      'owner',(SELECT owners FROM ownership WHERE table_name=CASE
        WHEN finding IN ('reported_conflict_not_resolved_truth','fold_or_bounded_reader_path_unestablished','fold_selected_other_testimony')
          THEN 'vehicle_field_consensus' ELSE 'vehicle_observations' END),
      'canonicalIntake','ingest-observation','existingReaders',jsonb_build_array('get_vehicle_specs','get_field_provenance'),
      'acceptanceCase',item_key,'action',finding,
      'gate','Reproduce this exact key/hash/field; repair existing owner locally; measure same reader under permitted role. No raw write, replay or admission authorized.') END
  ) ORDER BY ord) FROM findings),'[]'::jsonb)) receipt
FROM boundary b;
