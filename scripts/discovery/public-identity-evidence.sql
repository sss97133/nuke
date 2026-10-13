-- Existing public-reader-coverage acquisition, not a readiness verdict or new DB API.
-- Bind $1::jsonb: {mode,vehicleIds:[1..200 UUIDs],cursor:null|{vehicleId,observationId},
-- candidateIds:[1..100 UUIDs for custody]}. Inventory returns 100 plausible keys plus
-- explicit lookahead. Counts exhaust the declared active typed/legacy paths, never
-- every possible evidence owner. A caller must reject changed inventories/owner SHA,
-- consume every candidate page, and keep failed/cancelled batches unassessed.
-- Run only through the existing READ ONLY, statement_timeout=5s, lock_timeout=1s
-- bounded reader. No source text, private vehicle values, new state or schema writes.
WITH input AS MATERIALIZED (SELECT $1::jsonb AS j),
raw_keys AS MATERIALIZED (
 SELECT value AS key FROM input, jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(j->'vehicleIds')='array' THEN j->'vehicleIds' ELSE '[]'::jsonb END)
), raw_candidates AS MATERIALIZED (
 SELECT value AS key FROM input, jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(j->'candidateIds')='array' THEN j->'candidateIds' ELSE '[]'::jsonb END)
), requested AS MATERIALIZED (
 SELECT CASE WHEN key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN key::uuid END AS id FROM raw_keys
), candidate_ids AS MATERIALIZED (
 SELECT CASE WHEN key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN key::uuid END AS id FROM raw_candidates
), params AS MATERIALIZED (
 SELECT j->>'mode' AS mode,
  CASE WHEN j#>>'{cursor,vehicleId}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (j#>>'{cursor,vehicleId}')::uuid END AS after_vehicle,
  CASE WHEN j#>>'{cursor,observationId}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (j#>>'{cursor,observationId}')::uuid END AS after_observation,
  coalesce(jsonb_typeof(j)='object' AND j->>'mode' IN ('inventory','custody')
   AND (SELECT count(*) BETWEEN 1 AND 200 AND count(id)=count(*) AND count(DISTINCT id)=count(*) FROM requested)
   AND (j->'cursor' IS NULL OR j->'cursor'='null'::jsonb OR (j->>'mode'='inventory' AND jsonb_typeof(j->'cursor')='object'
    AND j#>>'{cursor,vehicleId}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    AND j#>>'{cursor,observationId}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    AND lower(j#>>'{cursor,vehicleId}') IN (SELECT id::text FROM requested)))
   AND CASE WHEN j->>'mode'='custody' THEN jsonb_typeof(j->'candidateIds')='array'
    AND (SELECT count(*) BETWEEN 1 AND 100 AND count(id)=count(*) AND count(DISTINCT id)=count(*) FROM candidate_ids)
    ELSE (j->'candidateIds' IS NULL OR j->'candidateIds'='[]'::jsonb) END,false) AS valid
 FROM input
), properties(property_key,id) AS (VALUES
 ('year','ece619f7-c49a-44f7-999f-a41acf5d4dc3'::uuid),
 ('make','8d274b73-a8a6-43bf-9036-5864d0152725'::uuid),
 ('model','a79b528f-7d9d-46ca-96f9-96d899e81d10'::uuid)
), owner_functions AS MATERIALIZED (
 SELECT encode(sha256(convert_to(string_agg(p.oid::regprocedure::text||E'\n'||pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid::regprocedure::text),'UTF8')),'hex') AS sha
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
  'retained_listing_property_result_matches','observation_is_public','retained_listing_identity_value',
  'retained_listing_identity_matches','retained_listing_identity_value_matches',
  'retained_description_identity_matches','retained_description_identity_value_matches','retained_description_identity_text_witness',
  'retained_description_year_matches','retained_description_year_value_matches','retained_description_year_text_witness',
  'retained_description_property_witness','retained_description_property_matches','retained_description_property_value_matches',
  'retained_craigslist_year_matches','retained_craigslist_year_value_matches','retained_craigslist_year_witness',
  'retained_craigslist_odometer_matches','retained_craigslist_odometer_value_matches','retained_craigslist_odometer_witness')
), gate AS MATERIALIZED (
 SELECT v.id,v.year,v.make,v.model FROM requested r JOIN public.vehicles v ON v.id=r.id CROSS JOIN params p
 WHERE p.valid AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
), typed AS MATERIALIZED (
 SELECT o.id,o.vehicle_id,k.property_key,o.source_observation_id,o.extraction_method,
  o.structured_data->>'source_profile' AS profile,
  coalesce(o.is_superseded IS FALSE AND o.rank::text IS DISTINCT FROM 'deprecated'
   AND o.extraction_method='retained_listing_property_projection_v1' AND o.source_observation_id IS NOT NULL
   AND o.structured_data->>'property_key'=k.property_key
   AND ((o.structured_data->>'normalization_version'='retained_listing_identity_labels_v1'
     AND o.structured_data->>'source_profile' IS NULL)
    OR (k.property_key='year' AND o.structured_data->>'source_profile' IN ('bat_description_year_label_v1','craigslist_year_attribute_v1'))
    OR (k.property_key IN ('make','model') AND o.structured_data->>'source_profile'='bat_description_identity_label_v1')),false) AS plausible
 FROM gate g JOIN public.vehicle_observations o ON o.vehicle_id=g.id
 JOIN properties k ON k.id=o.property_id CROSS JOIN params p
 WHERE p.mode='inventory' AND o.is_superseded IS NOT TRUE
), typed_counts AS MATERIALIZED (
 SELECT vehicle_id,property_key,count(*) AS total,count(*) FILTER (WHERE plausible) AS plausible
 FROM typed GROUP BY vehicle_id,property_key
), legacy AS MATERIALIZED (
 SELECT g.id AS vehicle_id,fe.field_name AS property_key,fe.proposed_value AS value,
  'field_evidence'::text AS origin,
  coalesce(fe.raw_extraction_data->>'source_observation_id',fe.raw_extraction_data->>'observation_id') IS NOT NULL AS linked
 FROM gate g JOIN public.field_evidence fe ON fe.vehicle_id=g.id CROSS JOIN params p
 WHERE p.mode='inventory' AND fe.field_name IN ('year','make','model') AND fe.status IS DISTINCT FROM 'rejected' AND fe.status IS DISTINCT FROM 'superseded'
 UNION ALL
 SELECT g.id,fs.field_name,fs.field_value,'vehicle_field_sources',
  coalesce(fs.metadata->>'source_observation_id',fs.metadata->>'observation_id') IS NOT NULL
 FROM gate g JOIN public.vehicle_field_sources fs ON fs.vehicle_id=g.id CROSS JOIN params p
 WHERE p.mode='inventory' AND fs.field_name IN ('year','make','model')
), legacy_counts AS MATERIALIZED (
 SELECT l.vehicle_id,l.property_key,count(*) AS total,count(*) FILTER (WHERE linked) AS linked,
  count(*) FILTER (WHERE lower(btrim(l.value))=lower(btrim(CASE l.property_key WHEN 'year' THEN g.year::text WHEN 'make' THEN g.make ELSE g.model END))) AS matching
 FROM legacy l JOIN gate g ON g.id=l.vehicle_id GROUP BY l.vehicle_id,l.property_key
), subjects AS MATERIALIZED (
 SELECT r.id,jsonb_build_object('vehicleId',r.id,'publicEligible',g.id IS NOT NULL)
  || CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('values',jsonb_build_object('year',g.year,'make',g.make,'model',g.model),
   'identitySha256',encode(sha256(convert_to(jsonb_build_object('year',g.year,'make',g.make,'model',g.model)::text,'UTF8')),'hex'),
   'facets',(SELECT jsonb_object_agg(k.property_key,jsonb_build_object(
    'typedCount',coalesce(t.total,0),'plausibleCount',coalesce(t.plausible,0),'otherTypedCount',coalesce(t.total-t.plausible,0),
    'legacyCount',coalesce(l.total,0),'legacyMatchingCount',coalesce(l.matching,0),'legacyLinkedCount',coalesce(l.linked,0)))
    FROM properties k LEFT JOIN typed_counts t ON t.vehicle_id=r.id AND t.property_key=k.property_key
    LEFT JOIN legacy_counts l ON l.vehicle_id=r.id AND l.property_key=k.property_key)) ELSE '{}'::jsonb END AS value
 FROM requested r CROSS JOIN params p LEFT JOIN gate g ON g.id=r.id WHERE p.valid AND p.mode='inventory'
), candidate_page AS MATERIALIZED (
 SELECT t.* FROM typed t CROSS JOIN params p WHERE t.plausible
 AND (p.after_vehicle IS NULL OR (t.vehicle_id,t.id)>(p.after_vehicle,p.after_observation))
 ORDER BY t.vehicle_id,t.id LIMIT 101
), emitted_candidates AS MATERIALIZED (
 SELECT * FROM candidate_page ORDER BY vehicle_id,id LIMIT 100
), custody_base AS MATERIALIZED (
 SELECT i.id AS requested_id,g.id AS vehicle_id,k.property_key,o AS child,s AS original,source_registry.slug AS publisher,
  g.year,g.make,g.model,
  coalesce(g.id IS NOT NULL AND public.observation_is_public(o.kind,o.structured_data),false) AS child_public,
  coalesce(g.id IS NOT NULL AND s.id IS NOT NULL AND s.vehicle_id=g.id
   AND public.observation_is_public(s.kind,s.structured_data),false) AS source_public
 FROM candidate_ids i CROSS JOIN params p
 LEFT JOIN public.vehicle_observations o ON o.id=i.id AND o.vehicle_id IN (SELECT id FROM gate)
 LEFT JOIN gate g ON g.id=o.vehicle_id
 LEFT JOIN properties k ON k.id=o.property_id
 LEFT JOIN public.vehicle_observations s ON s.id=o.source_observation_id
 LEFT JOIN public.observation_sources source_registry ON source_registry.id=s.source_id
 WHERE p.valid AND p.mode='custody'
), custody_checks AS MATERIALIZED (
 SELECT b.*,
  coalesce(child_public AND source_public AND property_key IS NOT NULL
   AND (child).is_superseded IS FALSE AND (child).rank::text IS DISTINCT FROM 'deprecated'
   AND (child).extraction_method='retained_listing_property_projection_v1'
   AND (child).structured_data->>'property_key'=property_key
   AND (((child).structured_data->>'normalization_version'='retained_listing_identity_labels_v1' AND (child).structured_data->>'source_profile' IS NULL)
    OR (property_key='year' AND (child).structured_data->>'source_profile' IN ('bat_description_year_label_v1','craigslist_year_attribute_v1'))
    OR (property_key IN ('make','model') AND (child).structured_data->>'source_profile'='bat_description_identity_label_v1')),false) AS supported,
  coalesce(isfinite((child).ingested_at) AND isfinite((original).ingested_at)
   AND (child).ingested_at<=statement_timestamp() AND (original).ingested_at<=statement_timestamp()
   AND ((original).observed_at IS NULL OR (isfinite((original).observed_at) AND (original).observed_at<=statement_timestamp()))
   AND isfinite((child).observed_at) AND (child).observed_at<=statement_timestamp(),false) AS clocks_valid,
  coalesce(CASE WHEN property_key='year' THEN jsonb_typeof((child).structured_data->'year')='number'
   AND (child).structured_data->'year'=to_jsonb(year)
   WHEN property_key IN ('make','model') THEN jsonb_typeof((child).structured_data->property_key)='string'
    AND lower(btrim((child).structured_data->>property_key))=lower(btrim(CASE property_key WHEN 'make' THEN make ELSE model END))
   ELSE false END,false) AS matches_displayed
 FROM custody_base b
), custody_matches AS MATERIALIZED (
 SELECT c.*,CASE WHEN supported AND clocks_valid THEN
  public.retained_listing_property_result_matches((child).source_observation_id,(child).property_id,(child).id)
 ELSE false END AS custody_matches FROM custody_checks c
), custody_results AS MATERIALIZED (
 SELECT requested_id,jsonb_build_object('observationId',requested_id,
  'vehicleId',CASE WHEN child_public THEN vehicle_id END,'propertyKey',CASE WHEN child_public THEN property_key END,
  'publicEligible',child_public,'matchesDisplayedValue',child_public AND matches_displayed,
  'custodyMatches',coalesce(custody_matches,false),'qualified',coalesce(custody_matches AND matches_displayed,false),
  'reason',CASE WHEN NOT child_public THEN 'child_unavailable_or_ineligible'
    WHEN NOT source_public THEN 'source_unavailable_or_ineligible'
    WHEN NOT supported THEN 'unsupported_method_or_property'
    WHEN NOT clocks_valid THEN 'invalid_recording_clocks'
    WHEN NOT custody_matches THEN 'source_custody_mismatch'
    WHEN NOT matches_displayed THEN 'displayed_value_disagreement' ELSE 'qualified_attributed_label' END)
  || CASE WHEN child_public THEN jsonb_build_object('identitySha256',
   encode(sha256(convert_to(jsonb_build_object('year',year,'make',make,'model',model)::text,'UTF8')),'hex')) ELSE '{}'::jsonb END
  || CASE WHEN child_public AND source_public THEN jsonb_build_object(
   'sourceObservationId',(original).id,'sourceId',(original).source_id,'attributedPublisher',publisher,
   'sourceRecordedAt',(original).ingested_at,'sourceObservedAt',(original).observed_at,
   'claimRecordedAt',(child).ingested_at,'claimObservedAt',(child).observed_at,
   'sourceEventTimeStatus','unknown','identityResolutionStatus','unverified',
   'modelLabelScope',(child).structured_data->>'model_label_scope') ELSE '{}'::jsonb END AS value
 FROM custody_matches
)
SELECT jsonb_build_object('schemaVersion','public_identity_evidence_v1','mode',p.mode,
 'status',CASE WHEN p.valid THEN 'read' ELSE 'refused' END,'reason',CASE WHEN NOT p.valid THEN 'invalid_input' END,
 'measuredAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'ownerSha256',f.sha,'facetScope',jsonb_build_array('year','make','model'),
 'subjects',coalesce((SELECT jsonb_agg(value ORDER BY id) FROM subjects),'[]'::jsonb),
 'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object('vehicleId',vehicle_id,'propertyKey',property_key,
  'observationId',id,'sourceObservationId',source_observation_id,'method',extraction_method,'profile',profile) ORDER BY vehicle_id,id) FROM emitted_candidates),'[]'::jsonb),
 'hasMore',(SELECT count(*)>100 FROM candidate_page),
 'nextCursor',CASE WHEN (SELECT count(*)>100 FROM candidate_page) THEN
  (SELECT jsonb_build_object('vehicleId',vehicle_id,'observationId',id) FROM emitted_candidates ORDER BY vehicle_id DESC,id DESC LIMIT 1) END,
 'candidatePageExhausted',p.valid AND p.mode='inventory' AND (SELECT count(*)<=100 FROM candidate_page),
 'inventoryExhausted',p.valid AND p.mode='inventory',
 'results',coalesce((SELECT jsonb_agg(value ORDER BY requested_id) FROM custody_results),'[]'::jsonb),
 'scope','active typed Y/M/M properties plus legacy field_evidence/vehicle_field_sources; other evidence owners unassayed; no readiness verdict') AS receipt
FROM params p CROSS JOIN owner_functions f;
