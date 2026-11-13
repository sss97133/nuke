-- Open vocabulary/typed-subject proposals only. Approval is retained testimony
-- through schema_proposal_reviews; this migration never impersonates a curator.
SET statement_timeout='30s';
SET lock_timeout='1s';
DO $proposal$
DECLARE p jsonb; proposal_key uuid; proposal_kind text;
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.fn_schema_proposal_apply(uuid)'::regprocedure))
   IS DISTINCT FROM '4a4d0e932ad8d4ced119d238ab324444' THEN RAISE EXCEPTION 'Proposal owner drift'; END IF;
 FOR proposal_key,proposal_kind,p IN SELECT * FROM (VALUES
 ('4484d8cd-b6fd-41b0-bd00-4415cd58d7c9'::uuid,'add_property',
 '{"property_key":"component_visible_present","label":"Component presence in a qualified view","data_type":"boolean","unit":null,"namespace_request":"core","category":"component","applies_to_kinds":["condition"],"cardinality":"multi","discriminator_key":"component_subject_id","expected_source_categories":["internal"],"verification_scope":"instance","description":"Dated attributed image reading about one registered component position and an explicit view. True means visible present in that view. False requires explicit absence wording plus a scoped, qualified view; not visible and cannot tell are unanswered inspection outcomes, never false. The original reading, photo witness, selector, hash and analysis clock remain attached. Neither value establishes installation date, acquired-unit identity, originality, function, inspection or present-day state; multiple copies or derivations of one source are not independent agreement."}'::jsonb),
 ('7e5032ee-d35f-4176-bc5e-45cc61fcf501'::uuid,'add_column',
 '{"table":"vehicle_observations","columns":[{"column":"component_subject_id","type":"uuid","nullable":true,"references":"subject_taxonomy(subject_id)","keys_text_column":"structured_data.component_ref.key"}],"why":"Existing vehicle subject and property/condition registries lack a typed part-position reference. Reuse subject_taxonomy and source_observation_id; do not mint a unit, a new photo store or a parallel BOM.","rule":"Only the protected retained_component_reading_v1 path derives this FK from an active exact subject_key and binds the original retained analysis selector/hash and current canonical image witness. Same component position does not prove same physical unit across replacement.","writers":["ingest-observation","validate_retained_listing_property_source"],"readers":["vehicle_build_log_public"],"migration":"20261111161505_component_evidence_intake_and_fold.sql"}'::jsonb)
 ) q(id,kind,payload) LOOP
  IF EXISTS(SELECT 1 FROM public.schema_proposals WHERE id=proposal_key) THEN
   IF NOT EXISTS(SELECT 1 FROM public.schema_proposals WHERE id=proposal_key AND proposal_type=proposal_kind
    AND payload=p AND proposed_by_agent_key='codex-component-evidence') THEN RAISE EXCEPTION 'Component proposal changed'; END IF;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.schema_proposals WHERE proposal_type=proposal_kind
   AND status IN('open','under_review','needs_changes','approved') AND (payload->>'property_key'='component_visible_present'
    OR (payload->>'table'='vehicle_observations' AND payload::text LIKE '%component_subject_id%'))) THEN
   RAISE EXCEPTION 'Existing component proposal must be reused'; END IF;
  INSERT INTO public.schema_proposals(id,proposed_by_agent_key,proposal_type,payload,evidence,motivating_observation_ids,estimated_scope,backward_compatibility)
  VALUES(proposal_key,'codex-component-evidence',proposal_kind,p,
   '[{"role":"retained_source_discovery","examples":[{"component_key":"fluid.battery","source_observation_id":"443b0e10-cd2b-4a7b-8a34-f16c1616476d","selector":["components_seen","0","label"]},{"component_key":"engine.alternator","source_observation_id":"27ec71b7-c89f-4ec4-af4f-ae2c50e391ee","selector":["components_seen","0","label"]},{"component_key":"glass.windshield","source_observation_id":"3bc0fe84-dbdf-45dd-a2ac-815ab4e278b9","selector":["components_seen","0","label"]}],"semantic_status":"proposed attributed position mapping; no installation or unit identity inferred","expected_population":"unknown; current assembly templates do not apply to this Firebird"}]',
   ARRAY['443b0e10-cd2b-4a7b-8a34-f16c1616476d'::uuid,'27ec71b7-c89f-4ec4-af4f-ae2c50e391ee','3bc0fe84-dbdf-45dd-a2ac-815ab4e278b9'],
   '{"initial_cases":3,"population_coverage":"unknown","new_paid_inference":false,"existing_intake":"ingest-observation","consumer":"vehicle_build_log_public"}',
   '{"existing_photo_properties":"unchanged whole-image subjects","existing_observations":"unchanged","reviews_written":0,"canonical_admissions":0,"release":"Implementation requires the exact approved vocabulary proposal, the exact filed non-rejected column proposal, and separately authorized checked DDL release."}');
 END LOOP;
END $proposal$;
RESET lock_timeout;
RESET statement_timeout;
