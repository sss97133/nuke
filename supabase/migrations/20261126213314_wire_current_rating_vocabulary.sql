-- One OPEN conditioned-current vocabulary proposal. No values, tables,
-- manual reviews, source designs or runtime consumers are created here.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $proposal$
DECLARE pid constant uuid := '9c1ef313-f482-428e-8c66-75d38c5f3e07';
 agent_key constant text := 'codex-wire-current-rating-vocabulary-20261126';
 p jsonb := $payload${"property_key":"wire_published_current_rating","label":"Published conditional wire current rating","data_type":"numeric","unit":"A","namespace_request":"core","category":"wiring","applies_to_kinds":["specification"],"cardinality":"multi","discriminator_key":"wire_current_rating_condition_key","expected_source_categories":["documentation"],"verification_scope":"class","description":"Attributed published current rating in amperes for an explicitly identified wire class and gauge under source-stated ambient temperature, maximum permitted wire temperature, installation condition and value role. The discriminator must bind that full condition and retain unstated duty or application as unknown. Preserve exact lexical source cells, units, footnotes and retained document/page witnesses. Published indicative guidance is distinct from resistance, operating load, fuse rating, measured conductor temperature and installed-wire qualification. Source withdrawal/currentness and typed condition admission require a separate enforced intake before numerical claims or harness applicability; this vocabulary creates neither thermal facts nor engineering, stock or purchase release."}$payload$::jsonb;
 e jsonb := $evidence$[{"role":"prototype_row","source_table":"document_pages","row_id":"5b962e61-ab64-44d3-855c-bd77c05997e9","document_id":"1d90b4f3-1d6b-40dd-ac58-b5bd0d5e9607","reference_revision":"b818670133f8faa964e6ec0a53c078a2136465d8cfa86bfa70db2c6880a4ab94","file_sha256":"fc99c1dee1ea5336806d070b53a115127d153c6cf3cb9f7759b8fce6314c251e","quote":"Wire  Current Rating   Current Rating    Resistance Resistance\nGauge at 80 °C ambient at 100 °C ambient [ohm/m]    [ohm/1000 ft]","reads":"Source current-rating columns require their own conditioned class property. The resistance columns are separate quantities. No numerical reading, installation state or thermal conclusion is admitted by this proposal."}]$evidence$::jsonb;
 s jsonb := $scope${"source_documents":1,"source_pages":1,"numerical_claims_admitted":0,"scope":"wire material class, not a vehicle instance","next_owner":"existing observation intake and canonical harness parameter compiler after separately enforced condition/source admission"}$scope$::jsonb;
 b jsonb := $compatibility${"human_reviews_written":0,"existing_wire_resistance_properties":"unchanged","vehicle_claims_written":0,"rollback_plan":"Withdraw or supersede through existing proposal workflow, preserving history; no runtime reader changes from submission."}$compatibility$::jsonb;
BEGIN
 IF EXISTS(SELECT FROM public.observation_properties WHERE property_key=p->>'property_key'
  AND proposed_by_proposal_id IS DISTINCT FROM pid) THEN
  RAISE EXCEPTION 'Current-rating property has another owner';
 END IF;
 INSERT INTO public.schema_proposals(id,proposed_by_agent_key,proposal_type,payload,evidence,estimated_scope,backward_compatibility,status)
 VALUES(pid,agent_key,'add_property',p,e,s,b,'open') ON CONFLICT(id) DO NOTHING;
 IF NOT EXISTS(SELECT FROM public.schema_proposals pr WHERE pr.id=pid AND pr.proposed_by_agent_key=agent_key
  AND pr.proposed_by_user_id IS NULL AND pr.proposal_type='add_property' AND pr.payload=p
  AND pr.evidence=e AND pr.estimated_scope=s AND pr.backward_compatibility=b) THEN
  RAISE EXCEPTION 'Current-rating proposal identity or definition changed' USING ERRCODE='23514';
 END IF;
END $proposal$;
COMMIT;
